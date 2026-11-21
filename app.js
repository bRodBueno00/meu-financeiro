const STORAGE_KEY = "meuFinanceiroDados_v2";

// ==========================================
// CONFIGURAÇÃO GOOGLE DRIVE
// ==========================================
const CLIENT_ID = "127934343018-kpdvptdrvp8ov899cjii6okrmv2u17d2.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "MeuFinanceiro";
const FILE_NAME = "financeiro.json";
const RECURRING_FILE_NAME = "recorrentes.json";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

let tokenClient = null;
let accessToken = null;
let currentFileId = null;
let currentRecurringFileId = null;
let saveTimer = null;

let transactions = [];
let recurring = [];
let selectedDate = new Date();

let initialBalances = {};
let invoiceSettings = {};
let recurringMonthOverrides = {};
let savedDescriptions = [];

let categories = { income: [], credit: [], debit: [] };
let nextCategoryColorIndex = 0;

let pendingTransactionType = null;
let pendingTransactionDate = null;

let editingRecurringId = null;

let currentRecurringType = "income";
let currentTransactionsType = "income";
let currentCategoriesType = "income";
let editingCategoryId = null;

let pendingCategoryTarget = null;

let calendarSectionOpen = false;
let backupSectionOpen = false;
let currentView = "painel";

const $ = id => document.getElementById(id);

const CATEGORY_PALETTE = [
    "#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c",
    "#0891b2", "#ca8a04", "#db2777", "#4f46e5", "#059669",
    "#b45309", "#7c3aed", "#0d9488", "#e11d48", "#65a30d", "#0369a1"
];

const OUTROS_ID = "outros";

const money = value => Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
});

function localDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function parseDate(value) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
}

function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(value) {
    return parseDate(value).toLocaleDateString("pt-BR");
}

function makeId() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + Math.random();
}

function suggestedDateInSelectedMonth() {
    const today = new Date();
    const day = today.getDate();
    const lastDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
    const safeDay = Math.min(day, lastDay);
    return localDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), safeDay, 12));
}

function safeOn(id, event, handler) {
    const el = $(id);
    if (!el) {
        console.warn("Elemento não encontrado:", id);
        return;
    }
    el.addEventListener(event, handler);
}

// ==========================================
// CATEGORIAS
// ==========================================

function ensureOthersCategory() {
    ["income", "credit", "debit"].forEach(type => {
        if (!Array.isArray(categories[type])) categories[type] = [];
        if (!categories[type].some(c => c.id === OUTROS_ID)) {
            categories[type].unshift({ id: OUTROS_ID, name: "Outros", color: "#64748b" });
        }
    });
}

function nextColor() {
    const color = CATEGORY_PALETTE[nextCategoryColorIndex % CATEGORY_PALETTE.length];
    nextCategoryColorIndex++;
    return color;
}

function getCategoryById(type, id) {
    if (!categories[type]) return null;
    return categories[type].find(c => c.id === id) || null;
}

function getCategoryName(type, id) {
    if (!id) return "Outros";
    const cat = getCategoryById(type, id);
    return cat ? cat.name : "Outros";
}

function getCategoryColor(type, id) {
    if (!id) return "#64748b";
    const cat = getCategoryById(type, id);
    return cat ? cat.color : "#64748b";
}

function normalizeCategoryId(type, id) {
    if (!id) return OUTROS_ID;
    if (getCategoryById(type, id)) return id;
    return OUTROS_ID;
}

function populateCategorySelect(selectId, type, selectedId = OUTROS_ID) {
    const select = $(selectId);
    if (!select) return;

    select.innerHTML = "";

    const list = categories[type] || [];

    list.forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat.id;
        opt.textContent = cat.name;
        select.appendChild(opt);
    });

    select.value = normalizeCategoryId(type, selectedId);
}

function resolveCategoryType(buttonType, targetSelectId) {
    if (targetSelectId === "transactionCategory") {
        const typeEl = $("transactionType");
        return typeEl ? typeEl.value : currentCategoriesType;
    }
    if (targetSelectId === "standaloneCategory") {
        return currentTransactionsType;
    }
    if (targetSelectId === "recurringCategory") {
        return currentRecurringType;
    }
    if (targetSelectId === "recurringEditCategory") {
        if (editingRecurringId) {
            const item = recurring.find(x => x.id === editingRecurringId);
            if (item) return item.type;
        }
        return currentRecurringType;
    }
    return currentCategoriesType;
}

function openNewCategoryModal(targetSelectId, buttonType) {
    pendingCategoryTarget = {
        selectId: targetSelectId,
        type: resolveCategoryType(buttonType, targetSelectId)
    };

    const labels = {
        income: "Entrada",
        credit: "Crédito",
        debit: "Débito"
    };

    const labelEl = $("newCategoryTypeLabel");
    if (labelEl) labelEl.textContent = `Tipo: ${labels[pendingCategoryTarget.type] || ""}`;

    const form = $("newCategoryForm");
    if (form) form.reset();

    const modal = $("newCategoryModal");
    if (modal) modal.classList.remove("hidden");

    const input = $("newCategoryName");
    if (input) input.focus();
}

function closeNewCategoryModal() {
    const modal = $("newCategoryModal");
    if (modal) modal.classList.add("hidden");
    pendingCategoryTarget = null;
}

safeOn("closeNewCategoryModal", "click", closeNewCategoryModal);

safeOn("newCategoryModal", "click", event => {
    if (event.target === $("newCategoryModal")) closeNewCategoryModal();
});

safeOn("newCategoryForm", "submit", event => {
    event.preventDefault();

    if (!pendingCategoryTarget) return;

    const name = ($("newCategoryName").value || "").trim();
    if (!name) return;

    const type = pendingCategoryTarget.type;
    const exists = categories[type].some(
        c => c.name.toLowerCase() === name.toLowerCase()
    );

    if (exists) {
        alert("Já existe uma categoria com esse nome para este tipo de lançamento.");
        return;
    }

    const newCat = {
        id: makeId(),
        name,
        color: nextColor()
    };

    categories[type].push(newCat);

    saveData();

    populateCategorySelect(pendingCategoryTarget.selectId, type, newCat.id);

    closeNewCategoryModal();
});

// ==========================================
// GERENCIAR CATEGORIAS (botão ⚙️)
// ==========================================

function openCategoriesListForType(type) {
    currentCategoriesType = type;

    const labels = {
        income: "Categorias de entrada",
        credit: "Categorias de saída no crédito",
        debit: "Categorias de saída no débito"
    };

    const title = $("categoriesListTitle");
    if (title) title.textContent = labels[type] || "Categorias";

    const typeLabel = $("categoriesListTypeLabel");
    if (typeLabel) typeLabel.textContent = "Categorias atuais:";

    const modal = $("categoriesListModal");
    if (modal) modal.classList.remove("hidden");

    renderCategoriesList();
}

function closeCategoriesListModal() {
    const modal = $("categoriesListModal");
    if (modal) modal.classList.add("hidden");
}

function renderCategoriesList() {
    const container = $("categoriesListContainer");
    if (!container) return;

    container.innerHTML = "";

    const list = categories[currentCategoriesType] || [];

    list.forEach(cat => {
        const row = document.createElement("div");
        row.className = "planning-item";

        const info = document.createElement("div");
        info.className = "item-info";

        const nameWrap = document.createElement("div");
        nameWrap.style.display = "flex";
        nameWrap.style.alignItems = "center";
        nameWrap.style.gap = "8px";

        const dot = document.createElement("span");
        dot.className = "category-dot";
        dot.style.background = cat.color;

        const name = document.createElement("strong");
        name.textContent = cat.name;

        nameWrap.append(dot, name);
        info.appendChild(nameWrap);

        if (cat.id === OUTROS_ID) {
            const details = document.createElement("small");
            details.textContent = "Categoria padrão (não editável)";
            info.appendChild(details);
        }

        const actions = document.createElement("div");
        actions.className = "item-actions";

        if (cat.id !== OUTROS_ID) {
            const editBtn = document.createElement("button");
            editBtn.className = "outline-button";
            editBtn.textContent = "Editar";
            editBtn.addEventListener("click", () => openCategoryEditModal(cat));
            actions.appendChild(editBtn);

            const remove = document.createElement("button");
            remove.className = "delete-button";
            remove.textContent = "✕";
            remove.title = "Excluir categoria";
            remove.addEventListener("click", () => deleteCategory(cat));
            actions.appendChild(remove);
        }

        row.append(info, actions);
        container.appendChild(row);
    });
}

function openCategoryEditModal(cat) {
    editingCategoryId = cat.id;
    const input = $("categoryEditName");
    if (input) input.value = cat.name;
    const modal = $("categoryEditModal");
    if (modal) modal.classList.remove("hidden");
}

function closeCategoryEditModal() {
    const modal = $("categoryEditModal");
    if (modal) modal.classList.add("hidden");
    editingCategoryId = null;
}

function deleteCategory(cat) {
    const type = currentCategoriesType;

    const inUse = transactions.some(t => t.type === type && t.categoryId === cat.id)
        || recurring.some(r => r.type === type && r.categoryId === cat.id);

    if (inUse) {
        if (!confirm(`A categoria "${cat.name}" está em uso. Os lançamentos serão movidos para "Outros". Continuar?`)) {
            return;
        }

        transactions.forEach(t => {
            if (t.type === type && t.categoryId === cat.id) t.categoryId = OUTROS_ID;
        });
        recurring.forEach(r => {
            if (r.type === type && r.categoryId === cat.id) r.categoryId = OUTROS_ID;
        });
    } else {
        if (!confirm(`Excluir a categoria "${cat.name}"?`)) return;
    }

    categories[type] = categories[type].filter(c => c.id !== cat.id);

    saveData();
    updateDashboard();
    renderCategoriesList();
}

safeOn("closeCategoriesListModal", "click", closeCategoriesListModal);

safeOn("categoriesListModal", "click", event => {
    if (event.target === $("categoriesListModal")) closeCategoriesListModal();
});

safeOn("closeCategoryEditModal", "click", closeCategoryEditModal);

safeOn("categoryEditModal", "click", event => {
    if (event.target === $("categoryEditModal")) closeCategoryEditModal();
});

safeOn("categoryEditForm", "submit", event => {
    event.preventDefault();

    if (!editingCategoryId) return;

    const input = $("categoryEditName");
    const newName = input ? input.value.trim() : "";
    if (!newName) return;

    const type = currentCategoriesType;
    const exists = categories[type].some(
        c => c.id !== editingCategoryId && c.name.toLowerCase() === newName.toLowerCase()
    );

    if (exists) {
        alert("Já existe uma categoria com esse nome para este tipo de lançamento.");
        return;
    }

    const cat = categories[type].find(c => c.id === editingCategoryId);
    if (cat) cat.name = newName;

    saveData();
    updateDashboard();
    closeCategoryEditModal();
    renderCategoriesList();
});

document.addEventListener("click", event => {
    const newBtn = event.target.closest("[data-new-category]");
    if (newBtn) {
        openNewCategoryModal(
            newBtn.getAttribute("data-new-category"),
            newBtn.getAttribute("data-category-type")
        );
        return;
    }

    const manageBtn = event.target.closest("[data-manage-category]");
    if (manageBtn) {
        const targetId = manageBtn.getAttribute("data-manage-category");
        const type = resolveCategoryType(
            manageBtn.getAttribute("data-category-type"),
            targetId
        );
        openCategoriesListForType(type);
        return;
    }
});

// ==========================================
// PERSISTÊNCIA LOCAL + DRIVE
// ==========================================

function getDataSnapshot() {
    return {
        version: 18,
        transactions,
        initialBalances,
        invoiceSettings,
        recurringMonthOverrides,
        savedDescriptions,
        categories,
        nextCategoryColorIndex
    };
}

function getRecurringSnapshot() {
    return {
        version: 6,
        recurring
    };
}

function registerDescription(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return;

    const exists = savedDescriptions.some(
        d => d.toLowerCase() === trimmed.toLowerCase()
    );

    if (!exists) {
        savedDescriptions.push(trimmed);
        savedDescriptions.sort((a, b) =>
            a.localeCompare(b, "pt-BR", { sensitivity: "base" })
        );
    }
}

function rebuildSavedDescriptions() {
    const set = new Map();

    const add = name => {
        const trimmed = (name || "").trim();
        if (!trimmed) return;
        const key = trimmed.toLowerCase();
        if (!set.has(key)) {
            set.set(key, trimmed);
        }
    };

    transactions.forEach(t => add(t.description));
    recurring.forEach(r => add(r.description));
    savedDescriptions.forEach(d => add(d));

    savedDescriptions = Array.from(set.values()).sort((a, b) =>
        a.localeCompare(b, "pt-BR", { sensitivity: "base" })
    );
}

function applyDataSnapshot(data) {
    transactions = (data.transactions || []).map(item => ({
        ...item,
        type: item.type === "expense" ? "debit" : item.type,
        categoryId: item.categoryId || OUTROS_ID
    }));

    initialBalances = data.initialBalances || {};
    invoiceSettings = data.invoiceSettings || {};
    recurringMonthOverrides = data.recurringMonthOverrides || {};

    if (Array.isArray(data.savedDescriptions)) {
        savedDescriptions = data.savedDescriptions.slice();
    } else {
        savedDescriptions = [];
    }

    if (data.categories && typeof data.categories === "object") {
        categories = {
            income: Array.isArray(data.categories.income) ? data.categories.income.map(c => ({ ...c })) : [],
            credit: Array.isArray(data.categories.credit) ? data.categories.credit.map(c => ({ ...c })) : [],
            debit: Array.isArray(data.categories.debit) ? data.categories.debit.map(c => ({ ...c })) : []
        };
    } else {
        categories = { income: [], credit: [], debit: [] };
    }

    nextCategoryColorIndex = Number.isInteger(data.nextCategoryColorIndex)
        ? data.nextCategoryColorIndex
        : 0;

    ensureOthersCategory();

    if (Array.isArray(data.recurring)) {
        recurring = data.recurring.map(item => ({
            ...item,
            type: item.type === "expense" ? "debit" : item.type,
            categoryId: item.categoryId || OUTROS_ID
        }));
    } else if (Array.isArray(data.plans)) {
        recurring = data.plans.map(plan => ({
            id: plan.id || makeId(),
            description: plan.description,
            type: plan.type === "expense" ? "debit" : plan.type,
            categoryId: OUTROS_ID,
            frequency: plan.repeat === "yearly" ? "yearly" : "monthly",
            dayOfMonth: parseDate(plan.date).getDate(),
            versions: [
                {
                    amount: plan.amount,
                    startDate: plan.date,
                    endDate: plan.repeat === "once" ? plan.date : null
                }
            ]
        }));
    }

    rebuildSavedDescriptions();
}

function applyRecurringSnapshot(data) {
    if (data && Array.isArray(data.recurring)) {
        recurring = data.recurring.map(item => ({
            ...item,
            type: item.type === "expense" ? "debit" : item.type,
            categoryId: item.categoryId || OUTROS_ID
        }));

        rebuildSavedDescriptions();
    }
}

function saveData() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            ...getDataSnapshot(),
            recurring
        }));
    } catch (error) {
        alert("Não foi possível salvar os dados localmente. Exporte um backup.");
    }

    scheduleCloudSave();
}

function loadData() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);

        if (!saved) {
            ensureOthersCategory();
            return;
        }

        const data = JSON.parse(saved);

        if (Array.isArray(data)) {
            transactions = data.map(item => ({
                ...item,
                type: item.type === "expense" ? "debit" : item.type,
                categoryId: item.categoryId || OUTROS_ID
            }));
            ensureOthersCategory();
            rebuildSavedDescriptions();
            return;
        }

        applyDataSnapshot(data);

        if (Array.isArray(data.recurring)) {
            recurring = data.recurring.map(item => ({
                ...item,
                type: item.type === "expense" ? "debit" : item.type,
                categoryId: item.categoryId || OUTROS_ID
            }));
        }

        rebuildSavedDescriptions();

    } catch (error) {
        console.error("Erro ao carregar dados:", error);
    }
}

// ==========================================
// GOOGLE DRIVE
// ==========================================

function setCloudStatus(text) {
    const el = $("cloudStatus");
    if (el) el.textContent = text;
}

function updateCloudButtons() {
    const logged = !!accessToken;
    const loginBtn = $("googleLoginButton");
    const logoutBtn = $("googleLogoutButton");
    const syncBtn = $("syncNowButton");
    if (loginBtn) loginBtn.classList.toggle("hidden", logged);
    if (logoutBtn) logoutBtn.classList.toggle("hidden", !logged);
    if (syncBtn) syncBtn.classList.toggle("hidden", !logged);
}

function initGoogleAuth() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
        setTimeout(initGoogleAuth, 300);
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (response) => {
            if (response.error) {
                setCloudStatus("Drive: falha no login");
                return;
            }

            accessToken = response.access_token;

            const expiresIn = Number(response.expires_in || 3600);
            localStorage.setItem(
                "meuFinanceiroToken",
                JSON.stringify({
                    token: accessToken,
                    expiresAt: Date.now() + expiresIn * 1000
                })
            );

            setCloudStatus("Drive: conectado");
            updateCloudButtons();

            await loadFromDrive();
        }
    });

    tokenClient.requestAccessToken({ prompt: "" });
}

function loginGoogle() {
    if (!tokenClient) {
        alert("A biblioteca do Google ainda não carregou. Aguarde e tente novamente.");
        return;
    }
    tokenClient.requestAccessToken({ prompt: "" });
}

function logoutGoogle() {
    if (accessToken && window.google && google.accounts.oauth2) {
        google.accounts.oauth2.revoke(accessToken, () => {});
    }

    accessToken = null;
    currentFileId = null;
    currentRecurringFileId = null;
    localStorage.removeItem("meuFinanceiroToken");
    setCloudStatus("Drive: desconectado");
    updateCloudButtons();
}

async function driveFetch(url, options = {}) {
    const opts = {
        ...options,
        headers: {
            ...(options.headers || {}),
            Authorization: `Bearer ${accessToken}`
        }
    };

    const response = await fetch(url, opts);

    if (response.status === 401) {
        logoutGoogle();
        throw new Error("Sessão expirada. Faça login novamente.");
    }

    return response;
}

async function findOrCreateFolder() {
    const query = encodeURIComponent(
        `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );

    const res = await driveFetch(
        `${DRIVE_API}/files?q=${query}&fields=files(id,name)`
    );

    const data = await res.json();

    if (data.files && data.files.length > 0) {
        return data.files[0].id;
    }

    const createRes = await driveFetch(`${DRIVE_API}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: FOLDER_NAME,
            mimeType: "application/vnd.google-apps.folder"
        })
    });

    const created = await createRes.json();
    return created.id;
}

async function findFileInFolder(folderId, fileName) {
    const query = encodeURIComponent(
        `name='${fileName}' and '${folderId}' in parents and trashed=false`
    );

    const res = await driveFetch(
        `${DRIVE_API}/files?q=${query}&fields=files(id,name,modifiedTime)`
    );

    const data = await res.json();

    if (data.files && data.files.length > 0) {
        return data.files[0];
    }

    return null;
}

async function loadFromDrive() {
    if (!accessToken) return;

    try {
        setCloudStatus("Drive: carregando...");

        const folderId = await findOrCreateFolder();

        const file = await findFileInFolder(folderId, FILE_NAME);
        const recurringFile = await findFileInFolder(folderId, RECURRING_FILE_NAME);

        if (!file && !recurringFile) {
            setCloudStatus("Drive: conectado (sem arquivo ainda)");
            currentFileId = null;
            currentRecurringFileId = null;
            return;
        }

        if (file) {
            currentFileId = file.id;
            const res = await driveFetch(`${DRIVE_API}/files/${file.id}?alt=media`);
            const data = await res.json();
            applyDataSnapshot(data);
        }

        if (recurringFile) {
            currentRecurringFileId = recurringFile.id;
            const res = await driveFetch(`${DRIVE_API}/files/${recurringFile.id}?alt=media`);
            const data = await res.json();
            applyRecurringSnapshot(data);
        }

        rebuildSavedDescriptions();

        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            ...getDataSnapshot(),
            recurring
        }));

        setCloudStatus("Drive: dados carregados");
    } catch (error) {
        setCloudStatus("Drive: erro ao carregar");
        console.error(error);
    } finally {
        try {
            updateDashboard();
        } catch (e) {
            console.error("Erro ao atualizar painel após carregar Drive:", e);
        }
    }
}

function scheduleCloudSave() {
    if (!accessToken) return;

    if (saveTimer) clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
        saveToDrive();
    }, 1200);
}

async function uploadOrUpdateFile(folderId, fileName, currentId, body) {
    if (!currentId) {
        const existing = await findFileInFolder(folderId, fileName);
        if (existing) currentId = existing.id;
    }

    if (!currentId) {
        const metadata = {
            name: fileName,
            mimeType: "application/json",
            parents: [folderId]
        };

        const form = new FormData();
        form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        form.append("file", new Blob([body], { type: "application/json" }));

        const res = await driveFetch(
            `${UPLOAD_API}/files?uploadType=multipart&fields=id`,
            { method: "POST", body: form }
        );

        const created = await res.json();
        return created.id;
    }

    const res = await driveFetch(
        `${UPLOAD_API}/files/${currentId}?uploadType=media`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body
        }
    );

    if (!res.ok) throw new Error("Falha ao atualizar arquivo");
    return currentId;
}

async function saveToDrive() {
    if (!accessToken) return;

    try {
        setCloudStatus("Drive: salvando...");

        const folderId = await findOrCreateFolder();

        const financeiroBody = JSON.stringify(getDataSnapshot(), null, 2);
        const recurringBody = JSON.stringify(getRecurringSnapshot(), null, 2);

        currentFileId = await uploadOrUpdateFile(
            folderId, FILE_NAME, currentFileId, financeiroBody
        );

        currentRecurringFileId = await uploadOrUpdateFile(
            folderId, RECURRING_FILE_NAME, currentRecurringFileId, recurringBody
        );

        setCloudStatus("Drive: salvo ✓");
    } catch (error) {
        setCloudStatus("Drive: erro ao salvar");
        console.error(error);
    }
}

// ==========================================
// CONFIGURAÇÃO DA FATURA
// ==========================================

function getInvoiceConfig(date = selectedDate) {
    const key = monthKey(date);

    return invoiceSettings[key] || {
        start: 14,
        end: 15,
        due: 20
    };
}

function saveInvoiceConfig() {
    const start = Number($("invoiceStart").value);
    const end = Number($("invoiceEnd").value);
    const due = Number($("invoiceDueDay").value);

    if (
        !Number.isInteger(start) || start < 1 || start > 31 ||
        !Number.isInteger(end) || end < 1 || end > 31 ||
        !Number.isInteger(due) || due < 1 || due > 31
    ) {
        alert("Informe dias válidos entre 1 e 31.");
        return;
    }

    invoiceSettings[monthKey(selectedDate)] = { start, end, due };

    saveData();
    updateDashboard();

    alert("Configuração da fatura salva para este mês.");
}

function renderInvoiceSettings() {
    const config = getInvoiceConfig();

    $("invoiceStart").value = config.start;
    $("invoiceEnd").value = config.end;
    $("invoiceDueDay").value = config.due;
}

// ==========================================
// SALDO INICIAL AUTOMÁTICO
// ==========================================

function getOpeningBalance(date, depth = 0) {
    const key = monthKey(date);

    if (Object.prototype.hasOwnProperty.call(initialBalances, key)) {
        return Number(initialBalances[key]);
    }

    if (depth >= 120) return 0;

    const previousMonth = new Date(
        date.getFullYear(),
        date.getMonth() - 1,
        1,
        12
    );

    return calculateMonthClosing(previousMonth, depth + 1);
}

function calculateMonthClosing(date, depth = 0) {
    if (depth >= 120) return 0;

    const year = date.getFullYear();
    const month = date.getMonth();

    const actual = transactions.filter(item =>
        item.date.startsWith(monthKey(date))
    );

    const scheduled = getOccurrencesForMonth(date);

    const opening = getOpeningBalance(date, depth);

    let balance = opening;

    const days = new Date(year, month + 1, 0).getDate();

    const invoice = getInvoiceAmount(date);
    const invoiceDue = getInvoiceDueDate(date);

    for (let day = 1; day <= days; day++) {
        const currentDay = localDate(new Date(year, month, day, 12));

        const values = getDayValues(currentDay, actual, scheduled);

        let debit = values.debit;

        if (currentDay === invoiceDue) debit += invoice;

        balance += values.income - debit;
    }

    return balance;
}

function saveInitialBalance() {
    const raw = $("initialBalance").value;
    const value = Number(raw);

    if (raw.trim() === "" || !Number.isFinite(value)) {
        alert("Informe um saldo inicial válido.");
        return;
    }

    initialBalances[monthKey(selectedDate)] = Math.round(value * 100) / 100;

    saveData();
    updateDashboard();

    alert("Saldo inicial salvo com sucesso.");
}

// ==========================================
// LANÇAMENTOS RECORRENTES
// ==========================================

function getVersionForDate(item, date) {
    if (!item.versions || !item.versions.length) return null;

    const target = localDate(new Date(date.getFullYear(), date.getMonth(), 1, 12));

    const sorted = [...item.versions].sort((a, b) =>
        a.startDate.localeCompare(b.startDate)
    );

    let chosen = null;

    for (const v of sorted) {
        if (v.startDate <= target) {
            if (!v.endDate || v.endDate >= target) {
                chosen = v;
            }
        }
    }

    return chosen;
}

function getOverrideKey(itemId, date) {
    return `${itemId}|${monthKey(date)}`;
}

function recurringIsActiveInMonth(item, date) {
    const year = date.getFullYear();
    const month = date.getMonth();

    if (!item.versions || !item.versions.length) return null;

    const firstVersionStart = [...item.versions]
        .map(v => v.startDate)
        .sort()[0];

    const start = parseDate(firstVersionStart);

    const version = getVersionForDate(item, new Date(year, month, 1, 12));
    if (!version) return null;

    let occurrence = null;

    if (item.frequency === "yearly") {
        if (year < start.getFullYear()) return null;
        if (month !== start.getMonth()) return null;

        const last = new Date(year, month + 1, 0, 12);
        const day = Math.min(item.dayOfMonth || start.getDate(), last.getDate());
        occurrence = localDate(new Date(year, month, day, 12));
    } else {
        const fm = new Date(year, month, 1, 12);
        if (fm < new Date(start.getFullYear(), start.getMonth(), 1, 12)) {
            return null;
        }

        const last = new Date(year, month + 1, 0, 12);
        const day = Math.min(item.dayOfMonth || start.getDate(), last.getDate());
        occurrence = localDate(new Date(year, month, day, 12));
    }

    if (occurrence < version.startDate) return null;
    if (version.endDate && occurrence > version.endDate) return null;

    const overrideKey = getOverrideKey(item.id, date);
    const override = recurringMonthOverrides[overrideKey];

    const effectiveAmount = override !== undefined
        ? override
        : version.amount;

    return {
        occurrence,
        version,
        amount: effectiveAmount,
        hasOverride: override !== undefined
    };
}

function getOccurrencesForMonth(date) {
    const occurrences = [];

    if (!Array.isArray(recurring)) return occurrences;

    recurring.forEach(item => {
        try {
            const result = recurringIsActiveInMonth(item, date);
            if (result) {
                occurrences.push({
                    ...item,
                    amount: result.amount,
                    occurrenceDate: result.occurrence,
                    hasOverride: result.hasOverride
                });
            }
        } catch (e) {
            console.error("Erro ao processar recorrente:", item, e);
        }
    });

    return occurrences;
}

function getMonthlyOccurrences() {
    return getOccurrencesForMonth(selectedDate);
}

// ==========================================
// FATURA DO CARTÃO
// ==========================================

function getInvoiceMonthFromDate(dateStr) {
    if (!dateStr) return null;

    const purchase = parseDate(dateStr);
    const year = purchase.getFullYear();
    const month = purchase.getMonth();

    const candidates = [
        new Date(year, month, 1, 12),
        new Date(year, month + 1, 1, 12)
    ];

    for (const candidate of candidates) {
        const config = getInvoiceConfig(candidate);

        const previousLastDay = new Date(
            candidate.getFullYear(),
            candidate.getMonth(),
            0
        ).getDate();

        const currentLastDay = new Date(
            candidate.getFullYear(),
            candidate.getMonth() + 1,
            0
        ).getDate();

        const periodStart = new Date(
            candidate.getFullYear(),
            candidate.getMonth() - 1,
            Math.min(config.start, previousLastDay),
            12
        );

        const periodEnd = new Date(
            candidate.getFullYear(),
            candidate.getMonth(),
            Math.min(config.end, currentLastDay),
            12
        );

        if (purchase >= periodStart && purchase <= periodEnd) {
            return monthKey(candidate);
        }
    }

    return null;
}

function getInvoiceMonth(transaction) {
    return getInvoiceMonthFromDate(transaction.date);
}

function getInvoiceAmount(date = selectedDate) {
    try {
        const key = monthKey(date);

        const manualCredit = transactions
            .filter(item => item.type === "credit" && getInvoiceMonth(item) === key)
            .reduce((sum, item) => sum + item.amount, 0);

        const prevDate = new Date(date.getFullYear(), date.getMonth() - 1, 1, 12);

        const monthsToScan = [prevDate, date];

        let recurringCredit = 0;
        monthsToScan.forEach(scanDate => {
            getOccurrencesForMonth(scanDate).forEach(item => {
                if (item.type !== "credit") return;
                if (getInvoiceMonthFromDate(item.occurrenceDate) === key) {
                    recurringCredit += item.amount;
                }
            });
        });

        return manualCredit + recurringCredit;
    } catch (e) {
        console.error("Erro em getInvoiceAmount:", e);
        return 0;
    }
}

function getInvoiceDueDate(date = selectedDate) {
    const config = getInvoiceConfig(date);

    const lastDay = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0
    ).getDate();

    const due = Math.min(config.due, lastDay);

    return localDate(new Date(date.getFullYear(), date.getMonth(), due, 12));
}

// ==========================================
// VALORES DIÁRIOS
// ==========================================

function getDayValues(date, actual, scheduled) {
    const dayActual = actual.filter(x => x.date === date);
    const dayScheduled = scheduled.filter(x => x.occurrenceDate === date);

    const all = [...dayActual, ...dayScheduled];

    const income = all
        .filter(x => x.type === "income")
        .reduce((sum, x) => sum + x.amount, 0);

    const credit = all
        .filter(x => x.type === "credit")
        .reduce((sum, x) => sum + x.amount, 0);

    const debit = all
        .filter(x => x.type === "debit")
        .reduce((sum, x) => sum + x.amount, 0);

    return { income, credit, debit, all };
}

// ==========================================
// SALDO DE HOJE
// ==========================================

function getTodayBalance() {
    const today = new Date();

    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();

    const actual = transactions.filter(item =>
        item.date.startsWith(monthKey(selectedDate))
    );

    const scheduled = getMonthlyOccurrences();

    const invoice = getInvoiceAmount();
    const invoiceDue = getInvoiceDueDate();

    let balance = getOpeningBalance(selectedDate);

    const selectedKey = monthKey(selectedDate);
    const todayKey = monthKey(today);

    let limitDay;

    if (selectedKey < todayKey) {
        limitDay = new Date(year, month + 1, 0).getDate();
    } else if (selectedKey > todayKey) {
        return 0;
    } else {
        limitDay = today.getDate();
    }

    for (let day = 1; day <= limitDay; day++) {
        const currentDay = localDate(new Date(year, month, day, 12));
        const values = getDayValues(currentDay, actual, scheduled);

        let debit = values.debit;
        if (currentDay === invoiceDue) debit += invoice;

        balance += values.income - debit;
    }

    return balance;
}

// ==========================================
// ATUALIZAÇÃO DO PAINEL
// ==========================================

function updateDashboard() {
    try {
        const actual = transactions.filter(item =>
            item.date.startsWith(monthKey(selectedDate))
        );

        const scheduled = getMonthlyOccurrences();

        const incomeActual = actual
            .filter(x => x.type === "income")
            .reduce((sum, x) => sum + x.amount, 0);

        const debitActual = actual
            .filter(x => x.type === "debit")
            .reduce((sum, x) => sum + x.amount, 0);

        const incomePlanned = scheduled
            .filter(x => x.type === "income")
            .reduce((sum, x) => sum + x.amount, 0);

        const debitPlanned = scheduled
            .filter(x => x.type === "debit")
            .reduce((sum, x) => sum + x.amount, 0);

        const invoice = getInvoiceAmount();
        const opening = getOpeningBalance(selectedDate);

        const totalIncome = incomeActual + incomePlanned;
        const totalExpenses = debitActual + debitPlanned + invoice;
        const closing = opening + totalIncome - totalExpenses;

        const setText = (id, value) => {
            const el = $(id);
            if (el) el.textContent = value;
        };

        setText("balance", money(closing));
        setText("totalIncome", money(totalIncome));
        setText("totalInvoice", money(invoice));
        setText("totalExpenses", money(debitActual + debitPlanned));
        setText("todayBalance", money(getTodayBalance()));

        setText("currentMonth",
            selectedDate.toLocaleDateString("pt-BR", {
                month: "long",
                year: "numeric"
            })
        );

        const monthLabel = selectedDate.toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric"
        });

        setText("balanceConfigMonthLabel", `Mês de configuração: ${monthLabel}`);
        setText("invoiceConfigMonthLabel", `Mês de configuração: ${monthLabel}`);

        const initialBalanceEl = $("initialBalance");
        if (initialBalanceEl) initialBalanceEl.value = opening.toFixed(2);

        const hasManualBalance = Object.prototype.hasOwnProperty.call(
            initialBalances,
            monthKey(selectedDate)
        );

        setText("initialBalanceInfo",
            hasManualBalance
                ? "Este mês possui um saldo inicial definido manualmente. Para voltar ao automático, exclua esse ajuste."
                : "Preenchido automaticamente com o saldo final do mês anterior. Você pode alterar e salvar manualmente."
        );

        setText("invoiceAmount", money(invoice));
        setText("invoiceDue", formatDate(getInvoiceDueDate()));

        renderInvoiceSettings();
        renderDailyCalendar(actual, scheduled);
    } catch (error) {
        console.error("Erro em updateDashboard:", error);
    }
}

// ==========================================
// NAVEGAÇÃO ENTRE ABAS (Painel / Dashboard)
// ==========================================

function setActiveTab(view) {
    currentView = view;

    const tabPainel = $("tabPainel");
    const tabDashboard = $("tabDashboard");
    const painelView = $("painelView");
    const dashboardView = $("dashboardView");
    const painelHeader = $("painelHeaderContent");

    if (tabPainel) tabPainel.classList.toggle("active", view === "painel");
    if (tabDashboard) tabDashboard.classList.toggle("active", view === "dashboard");

    if (painelView) painelView.classList.toggle("hidden", view !== "painel");
    if (dashboardView) dashboardView.classList.toggle("hidden", view !== "dashboard");
    if (painelHeader) painelHeader.classList.toggle("hidden", view !== "painel");
}

safeOn("tabPainel", "click", () => setActiveTab("painel"));
safeOn("tabDashboard", "click", () => setActiveTab("dashboard"));

// ==========================================
// CALENDÁRIO FINANCEIRO
// ==========================================

function renderDailyCalendar(actual, scheduled) {
    const container = $("dailyList");
    if (!container) return;
    container.innerHTML = "";

    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();

    const days = new Date(year, month + 1, 0).getDate();

    const today = localDate(new Date());

    const invoiceAmount = getInvoiceAmount();
    const invoiceDueDate = getInvoiceDueDate();

    let runningBalance = getOpeningBalance(selectedDate);

    for (let day = 1; day <= days; day++) {
        const date = localDate(new Date(year, month, day, 12));

        const values = getDayValues(date, actual, scheduled);

        let debit = values.debit;

        if (date === invoiceDueDate) debit += invoiceAmount;

        runningBalance += values.income - debit;

        const row = document.createElement("div");
        row.className = "daily-row";

        if (date === today) row.classList.add("today");

        const dayElement = document.createElement("div");
        dayElement.className = "day-cell";

        const dayNumber = document.createElement("span");
        dayNumber.textContent = String(day).padStart(2, "0");

        const weekday = document.createElement("small");
        weekday.textContent = parseDate(date).toLocaleDateString(
            "pt-BR",
            { weekday: "short" }
        );

        dayElement.append(dayNumber, weekday);

        const incomeCell = createEditableCell(
            values.income, "income-cell", "income", date
        );

        const creditCell = createEditableCell(
            values.credit, "credit-cell", "credit", date
        );

        const debitCell = createEditableCell(
            debit,
            "debit-cell",
            "debit",
            date,
            date === invoiceDueDate && invoiceAmount > 0
                ? "Inclui a fatura do cartão"
                : ""
        );

        const balanceCell = document.createElement("div");
        balanceCell.className = "money-cell balance-cell";

        if (runningBalance < 0) balanceCell.classList.add("negative");

        balanceCell.textContent = money(runningBalance);

        row.append(dayElement, incomeCell, creditCell, debitCell, balanceCell);

        container.appendChild(row);
    }
}

// ==========================================
// LANÇAMENTO PELO CALENDÁRIO
// ==========================================

function createEditableCell(value, className, type, date, tooltip = "") {
    const cell = document.createElement("div");

    cell.className = `money-cell ${className}`;
    cell.textContent = value > 0 ? money(value) : "+";

    cell.title = tooltip || "Toque para ver e gerenciar os lançamentos";

    cell.addEventListener("click", () => {
        openDayTransactionsModal(date, type);
    });

    return cell;
}

function openDayTransactionsModal(date, type) {
    const modal = $("dayTransactionsModal");
    const list = $("dayTransactionsList");
    if (!modal || !list) return;

    $("dayModalTitle").textContent = `Lançamentos de ${formatDate(date)}`;

    const actual = transactions.filter(item =>
        item.date.startsWith(monthKey(selectedDate))
    );
    const scheduled = getMonthlyOccurrences();
    const values = getDayValues(date, actual, scheduled);

    const invoiceAmount = getInvoiceAmount();
    const invoiceDueDate = getInvoiceDueDate();
    const isInvoiceDay = date === invoiceDueDate && invoiceAmount > 0;

    const labels = {
        income: "Entrada",
        credit: "Crédito",
        debit: "Débito"
    };

    let items = [];

    if (type === "income") {
        items = values.all.filter(x => x.type === "income");
    } else if (type === "credit") {
        items = values.all.filter(x => x.type === "credit");
    } else if (type === "debit") {
        items = values.all.filter(x => x.type === "debit");
    }

    list.innerHTML = "";

    if (items.length === 0 && !(type === "debit" && isInvoiceDay)) {
        const empty = document.createElement("p");
        empty.className = "empty-message";
        empty.textContent = "Nenhum lançamento nesta categoria.";
        list.appendChild(empty);
    } else {
        items.forEach(item => {
            const row = document.createElement("div");
            row.className = "day-transaction-item";

            const info = document.createElement("div");
            info.className = "item-info";

            const name = document.createElement("strong");
            name.textContent = item.description || labels[item.type];

            const details = document.createElement("small");
            const catName = getCategoryName(item.type, item.categoryId);

            if (item.occurrenceDate) {
                details.textContent = `${labels[item.type]} • ${catName} • Recorrente`;
            } else {
                details.textContent = `${labels[item.type]} • ${catName}`;
            }

            info.append(name, details);

            const actions = document.createElement("div");
            actions.className = "item-actions";

            const value = document.createElement("span");
            value.className = "item-value " +
                (item.type === "income" ? "green" :
                 item.type === "credit" ? "blue" : "red");

            value.textContent =
                `${item.type === "income" ? "+" : "-"} ${money(item.amount)}`;

            if (!item.occurrenceDate) {
                value.style.cursor = "pointer";
                value.style.textDecoration = "underline dashed";
                value.title = "Clique para editar o valor";
                value.addEventListener("click", () => {
                    editTransaction(item);
                });
            }

            actions.append(value);

            if (!item.occurrenceDate) {
                const remove = document.createElement("button");
                remove.className = "delete-button";
                remove.textContent = "✕";
                remove.title = "Excluir lançamento";

                remove.addEventListener("click", () => {
                    if (item.installmentGroupId) {
                        if (!confirm("Este lançamento faz parte de uma compra parcelada. Excluir todas as parcelas?")) {
                            return;
                        }
                        transactions = transactions.filter(x => x.installmentGroupId !== item.installmentGroupId);
                    } else {
                        if (!confirm("Excluir este lançamento?")) return;
                        transactions = transactions.filter(x => x.id !== item.id);
                    }

                    saveData();
                    updateDashboard();
                    closeDayModal();
                });

                actions.append(remove);
            }

            row.append(info, actions);
            list.appendChild(row);
        });

        if (type === "debit" && isInvoiceDay) {
            const row = document.createElement("div");
            row.className = "day-transaction-item";

            const info = document.createElement("div");
            info.className = "item-info";

            const name = document.createElement("strong");
            name.textContent = "Fatura do cartão";

            const details = document.createElement("small");
            details.textContent = "Débito";

            info.append(name, details);

            const actions = document.createElement("div");
            actions.className = "item-actions";

            const value = document.createElement("span");
            value.className = "item-value red";
            value.textContent = `- ${money(invoiceAmount)}`;

            actions.append(value);
            row.append(info, actions);
            list.appendChild(row);
        }
    }

    $("addDayTransactionButton").onclick = () => {
        closeDayModal();
        openTransactionForm(type, date);
    };

    modal.classList.remove("hidden");
}

function closeDayModal() {
    const modal = $("dayTransactionsModal");
    if (modal) modal.classList.add("hidden");
}

function editTransaction(item) {
    if (item.installmentGroupId) {
        const installmentInfo = item.installmentNumber && item.installmentTotal
            ? ` (parcela ${item.installmentNumber}/${item.installmentTotal})`
            : "";
        const novoValorStr = prompt(
            `Editar valor da parcela de "${item.description}"${installmentInfo}.\n\nDigite o novo valor desta parcela:`,
            item.amount
        );

        if (novoValorStr === null) return;

        const novoValor = parseFloat(novoValorStr.replace(",", "."));

        if (!isNaN(novoValor) && novoValor > 0) {
            item.amount = Math.round(novoValor * 100) / 100;
            saveData();
            updateDashboard();
            closeDayModal();
        } else if (novoValorStr.trim() !== "") {
            alert("Valor inválido.");
        }
        return;
    }

    const novoValorStr = prompt(
        `Editar valor de "${item.description}".\n\nDigite o novo valor (ou deixe em branco para manter):`,
        item.amount
    );

    if (novoValorStr === null) return;

    const novoValor = parseFloat(novoValorStr.replace(",", "."));

    if (!isNaN(novoValor) && novoValor > 0) {
        const index = transactions.findIndex(x => x.id === item.id);
        if (index !== -1) {
            transactions[index].amount = Math.round(novoValor * 100) / 100;
        }
        saveData();
        updateDashboard();
        closeDayModal();
    } else if (novoValorStr.trim() !== "") {
        alert("Valor inválido.");
    }
}

// ==========================================
// SUGESTÕES DE DESCRIÇÃO (DATALIST)
// ==========================================

function populateDescriptionOptions(targetInputId, datalistId) {
    const input = $(targetInputId);
    const datalist = $(datalistId);

    if (!input || !datalist) return;

    datalist.innerHTML = "";

    savedDescriptions.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        datalist.appendChild(opt);
    });
}

function attachDatalist(inputId, datalistId) {
    const input = $(inputId);
    const datalist = $(datalistId);

    if (!input || !datalist) return;

    input.setAttribute("list", datalistId);
}

// ==========================================
// FORMULÁRIO DE NOVO LANÇAMENTO (CALENDÁRIO)
// ==========================================

function openTransactionForm(type, date) {
    pendingTransactionType = type;
    pendingTransactionDate = date;

    const modal = $("transactionFormModal");
    if (!modal) return;

    $("transactionFormTitle").textContent = "Novo lançamento";
    $("transactionDescription").value = "";
    $("transactionAmount").value = "";
    $("transactionDate").value = date;
    $("transactionType").value = type;
    $("transactionInstallments").value = "1";

    populateCategorySelect("transactionCategory", type, OUTROS_ID);

    updateInstallmentVisibility();
    populateDescriptionOptions("transactionDescription", "transactionDescriptionList");

    modal.classList.remove("hidden");
}

function closeTransactionForm() {
    const modal = $("transactionFormModal");
    if (modal) modal.classList.add("hidden");
    const form = $("transactionForm");
    if (form) form.reset();
    pendingTransactionType = null;
    pendingTransactionDate = null;
}

function updateInstallmentVisibility() {
    const typeEl = $("transactionType");
    const container = $("installmentContainer");
    if (!typeEl || !container) return;

    const type = typeEl.value;

    if (type === "credit") {
        container.classList.remove("hidden");
    } else {
        container.classList.add("hidden");
        const installmentsEl = $("transactionInstallments");
        if (installmentsEl) installmentsEl.value = "1";
    }

    const catEl = $("transactionCategory");
    populateCategorySelect("transactionCategory", type, catEl ? catEl.value : OUTROS_ID);
}

safeOn("transactionType", "change", updateInstallmentVisibility);
safeOn("closeTransactionForm", "click", closeTransactionForm);

safeOn("transactionForm", "submit", event => {
    event.preventDefault();

    const description = $("transactionDescription").value.trim();
    const totalAmount = Number($("transactionAmount").value);
    const type = $("transactionType").value;
    const date = $("transactionDate").value;
    const installments = type === "credit"
        ? Number($("transactionInstallments").value)
        : 1;
    const categoryId = normalizeCategoryId(type, $("transactionCategory").value);

    if (!description || !Number.isFinite(totalAmount) || totalAmount <= 0 || !date) {
        alert("Preencha os dados corretamente.");
        return;
    }

    registerDescription(description);

    if (type === "credit" && installments > 1) {
        const baseDate = parseDate(date);
        const installmentAmount = Math.round((totalAmount / installments) * 100) / 100;
        const groupId = makeId();

        let accumulated = 0;

        for (let i = 0; i < installments; i++) {
            const installmentDate = new Date(
                baseDate.getFullYear(),
                baseDate.getMonth() + i,
                baseDate.getDate(),
                12
            );

            const isLast = i === installments - 1;
            const amount = isLast
                ? Math.round((totalAmount - accumulated) * 100) / 100
                : installmentAmount;

            accumulated += amount;

            transactions.push({
                id: makeId(),
                description: `${description} (${i + 1}/${installments})`,
                amount,
                type: "credit",
                categoryId,
                date: localDate(installmentDate),
                installmentGroupId: groupId,
                installmentNumber: i + 1,
                installmentTotal: installments,
                originalDescription: description
            });
        }
    } else {
        transactions.push({
            id: makeId(),
            description,
            amount: Math.round(totalAmount * 100) / 100,
            type,
            categoryId,
            date
        });
    }

    rebuildSavedDescriptions();

    saveData();
    updateDashboard();
    closeTransactionForm();
});

// ==========================================
// MENU DE LANÇAMENTOS DO MÊS
// ==========================================

function openTransactionsMenu() {
    const modal = $("transactionsMenu");
    if (!modal) return;
    modal.classList.remove("hidden");
    const monthLabel = selectedDate.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric"
    });
    const label = $("transactionsMonthLabel");
    if (label) label.textContent = `Lançamentos de ${monthLabel}`;
}

function closeTransactionsMenu() {
    const modal = $("transactionsMenu");
    if (modal) modal.classList.add("hidden");
}

function openTransactionsList(type) {
    currentTransactionsType = type;

    const labels = {
        income: "Entradas do mês",
        credit: "Saídas no crédito do mês",
        debit: "Saídas no débito do mês"
    };

    const title = $("transactionsListTitle");
    if (title) title.textContent = labels[type];

    const monthLabel = selectedDate.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric"
    });
    const monthLabelEl = $("transactionsListMonthLabel");
    if (monthLabelEl) monthLabelEl.textContent = `Lançamentos de ${monthLabel}`;

    const formContainer = $("transactionFormContainer");
    if (formContainer) formContainer.classList.add("hidden");
    const modal = $("transactionsListModal");
    if (modal) modal.classList.remove("hidden");

    renderTransactionsList();
}

function closeTransactionsListModal() {
    const modal = $("transactionsListModal");
    if (modal) modal.classList.add("hidden");
    const formContainer = $("transactionFormContainer");
    if (formContainer) formContainer.classList.add("hidden");
}

function renderTransactionsList() {
    const container = $("transactionsListContainer");
    if (!container) return;

    container.innerHTML = "";

    const monthTransactions = transactions.filter(item =>
        item.date.startsWith(monthKey(selectedDate)) &&
        item.type === currentTransactionsType
    );

    if (monthTransactions.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-message";
        empty.textContent = "Nenhum lançamento válido para este mês.";
        container.appendChild(empty);
        return;
    }

    monthTransactions
        .sort((a, b) => a.date.localeCompare(b.date))
        .forEach(item => {
            const row = document.createElement("div");
            row.className = "planning-item";

            const info = document.createElement("div");
            info.className = "item-info";

            const name = document.createElement("strong");
            name.textContent = item.description;

            const details = document.createElement("small");
            let detailText = formatDate(item.date);
            detailText += ` • ${getCategoryName(item.type, item.categoryId)}`;
            if (item.installmentGroupId && item.installmentNumber && item.installmentTotal) {
                detailText += ` • Parcela ${item.installmentNumber}/${item.installmentTotal}`;
            }
            details.textContent = detailText;

            info.append(name, details);

            const actions = document.createElement("div");
            actions.className = "item-actions";

            const value = document.createElement("span");
            value.className = "item-value " +
                (item.type === "income" ? "green" :
                 item.type === "credit" ? "blue" : "red");
            value.textContent =
                `${item.type === "income" ? "+" : "-"} ${money(item.amount)}`;

            const editBtn = document.createElement("button");
            editBtn.className = "outline-button";
            editBtn.textContent = "Editar";
            editBtn.addEventListener("click", () => {
                editTransaction(item);
                renderTransactionsList();
            });

            const remove = document.createElement("button");
            remove.className = "delete-button";
            remove.textContent = "✕";
            remove.title = "Excluir lançamento";

            remove.addEventListener("click", () => {
                if (item.installmentGroupId) {
                    if (!confirm("Este lançamento faz parte de uma compra parcelada. Excluir todas as parcelas?")) {
                        return;
                    }
                    transactions = transactions.filter(x => x.installmentGroupId !== item.installmentGroupId);
                } else {
                    if (!confirm("Excluir este lançamento?")) return;
                    transactions = transactions.filter(x => x.id !== item.id);
                }

                saveData();
                updateDashboard();
                renderTransactionsList();
            });

            actions.append(value, editBtn, remove);
            row.append(info, actions);
            container.appendChild(row);
        });
}

// ==========================================
// FORMULÁRIO DO MENU DE LANÇAMENTOS DO MÊS
// ==========================================

function openStandaloneTransactionForm() {
    const formContainer = $("transactionFormContainer");
    if (formContainer) formContainer.classList.remove("hidden");
    const form = $("standaloneTransactionForm");
    if (form) form.reset();

    const dateEl = $("standaloneDate");
    if (dateEl) dateEl.value = suggestedDateInSelectedMonth();
    const installmentsEl = $("standaloneInstallments");
    if (installmentsEl) installmentsEl.value = "1";

    populateCategorySelect("standaloneCategory", currentTransactionsType, OUTROS_ID);

    updateStandaloneInstallmentVisibility();
    populateDescriptionOptions("standaloneDescription", "standaloneDescriptionList");
}

function updateStandaloneInstallmentVisibility() {
    const container = $("standaloneInstallmentContainer");
    if (!container) return;

    if (currentTransactionsType === "credit") {
        container.classList.remove("hidden");
    } else {
        container.classList.add("hidden");
        const installmentsEl = $("standaloneInstallments");
        if (installmentsEl) installmentsEl.value = "1";
    }
}

safeOn("closeStandaloneForm", "click", () => {
    const formContainer = $("transactionFormContainer");
    if (formContainer) formContainer.classList.add("hidden");
});

safeOn("standaloneTransactionForm", "submit", event => {
    event.preventDefault();

    const description = $("standaloneDescription").value.trim();
    const totalAmount = Number($("standaloneAmount").value);
    const type = currentTransactionsType;
    const date = $("standaloneDate").value;
    const installments = type === "credit"
        ? Number($("standaloneInstallments").value)
        : 1;
    const categoryId = normalizeCategoryId(type, $("standaloneCategory").value);

    if (!description || !Number.isFinite(totalAmount) || totalAmount <= 0 || !date) {
        alert("Preencha os dados corretamente.");
        return;
    }

    registerDescription(description);

    if (type === "credit" && installments > 1) {
        const baseDate = parseDate(date);
        const installmentAmount = Math.round((totalAmount / installments) * 100) / 100;
        const groupId = makeId();

        let accumulated = 0;

        for (let i = 0; i < installments; i++) {
            const installmentDate = new Date(
                baseDate.getFullYear(),
                baseDate.getMonth() + i,
                baseDate.getDate(),
                12
            );

            const isLast = i === installments - 1;
            const amount = isLast
                ? Math.round((totalAmount - accumulated) * 100) / 100
                : installmentAmount;

            accumulated += amount;

            transactions.push({
                id: makeId(),
                description: `${description} (${i + 1}/${installments})`,
                amount,
                type: "credit",
                categoryId,
                date: localDate(installmentDate),
                installmentGroupId: groupId,
                installmentNumber: i + 1,
                installmentTotal: installments,
                originalDescription: description
            });
        }
    } else {
        transactions.push({
            id: makeId(),
            description,
            amount: Math.round(totalAmount * 100) / 100,
            type,
            categoryId,
            date
        });
    }

    rebuildSavedDescriptions();

    saveData();
    updateDashboard();

    const form = $("standaloneTransactionForm");
    if (form) form.reset();
    const formContainer = $("transactionFormContainer");
    if (formContainer) formContainer.classList.add("hidden");
    renderTransactionsList();
});

// ==========================================
// MENU DE LANÇAMENTOS RECORRENTES
// ==========================================

function openRecurringMenu() {
    const modal = $("recurringMenu");
    if (!modal) return;
    modal.classList.remove("hidden");
    const monthLabel = selectedDate.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric"
    });
    const label = $("recurringMonthLabel");
    if (label) label.textContent = `Válidos em ${monthLabel}`;
}

function closeRecurringMenu() {
    const modal = $("recurringMenu");
    if (modal) modal.classList.add("hidden");
}

function openRecurringList(type) {
    currentRecurringType = type;

    const labels = {
        income: "Entradas recorrentes",
        credit: "Saídas no crédito recorrentes",
        debit: "Saídas no débito recorrentes"
    };

    const title = $("recurringListTitle");
    if (title) title.textContent = labels[type];

    const monthLabel = selectedDate.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric"
    });
    const monthLabelEl = $("recurringListMonthLabel");
    if (monthLabelEl) monthLabelEl.textContent = `Válidos em ${monthLabel}`;

    const formContainer = $("recurringFormContainer");
    if (formContainer) formContainer.classList.add("hidden");
    const modal = $("recurringListModal");
    if (modal) modal.classList.remove("hidden");

    renderRecurringList();
}

function closeRecurringListModal() {
    const modal = $("recurringListModal");
    if (modal) modal.classList.add("hidden");
    const formContainer = $("recurringFormContainer");
    if (formContainer) formContainer.classList.add("hidden");
}

function renderRecurringList() {
    const container = $("recurringListContainer");
    if (!container) return;

    container.innerHTML = "";

    const activeItems = recurring.filter(item =>
        item.type === currentRecurringType &&
        recurringIsActiveInMonth(item, selectedDate)
    );

    if (activeItems.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-message";
        empty.textContent = "Nenhum lançamento recorrente válido para este mês.";
        container.appendChild(empty);
        return;
    }

    const withOccurrence = activeItems.map(item => {
        const result = recurringIsActiveInMonth(item, selectedDate);
        return {
            item,
            occurrence: result ? result.occurrence : "",
            amount: result ? result.amount : item.versions[0].amount
        };
    });

    withOccurrence.sort((a, b) => {
        if (a.occurrence !== b.occurrence) {
            return a.occurrence.localeCompare(b.occurrence);
        }
        if (currentRecurringType === "income") {
            return b.amount - a.amount;
        }
        return a.amount - b.amount;
    });

    withOccurrence.forEach(entry => {
        container.appendChild(buildRecurringRow(entry.item));
    });
}

function getActiveVersionDisplay(item) {
    const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12);
    const version = getVersionForDate(item, monthStart);
    return version || item.versions[item.versions.length - 1];
}

function buildRecurringRow(item) {
    const row = document.createElement("div");
    row.className = "planning-item";

    const info = document.createElement("div");
    info.className = "item-info";

    const name = document.createElement("strong");
    name.textContent = item.description;

    const version = getActiveVersionDisplay(item);

    const activeResult = recurringIsActiveInMonth(item, selectedDate);
    const displayAmount = activeResult ? activeResult.amount : version.amount;
    const hasOverride = activeResult && activeResult.hasOverride;

    const details = document.createElement("small");
    const end = version.endDate
        ? `até ${formatDate(version.endDate)}`
        : "sem data fim";
    details.textContent = `${getCategoryName(item.type, item.categoryId)} • Início ${formatDate(version.startDate)} • ${end}` +
        (hasOverride ? " • Ajustado neste mês" : "");

    info.append(name, details);

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const value = document.createElement("span");
    value.className = "item-value " +
        (item.type === "income" ? "green" :
         item.type === "credit" ? "blue" : "red");
    value.textContent =
        `${item.type === "income" ? "+" : "-"} ${money(displayAmount)}`;

    const editBtn = document.createElement("button");
    editBtn.className = "outline-button";
    editBtn.textContent = "Editar";
    editBtn.addEventListener("click", () => {
        openRecurringEditModal(item);
    });

    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.textContent = "✕";
    remove.title = "Excluir lançamento recorrente";

    remove.addEventListener("click", () => {
        if (!confirm(`Excluir o lançamento recorrente "${item.description}"?`)) return;
        recurring = recurring.filter(x => x.id !== item.id);
        saveData();
        updateDashboard();
        renderRecurringList();
    });

    actions.append(value, editBtn, remove);
    row.append(info, actions);

    return row;
}

// ==========================================
// MODAL DE EDIÇÃO DE RECORRENTE
// ==========================================

function openRecurringEditModal(item) {
    editingRecurringId = item.id;

    const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12);
    const currentVersion = getVersionForDate(item, monthStart)
        || item.versions[item.versions.length - 1];

    const overrideKey = getOverrideKey(item.id, selectedDate);
    const hasOverride = recurringMonthOverrides[overrideKey] !== undefined;
    const currentAmount = hasOverride
        ? recurringMonthOverrides[overrideKey]
        : currentVersion.amount;

    const monthLabel = selectedDate.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric"
    });

    $("recurringEditDescription").value = item.description;
    $("recurringEditAmount").value = currentAmount;
    $("recurringEditCurrentMonthLabel").textContent =
        `Mês de edição: ${monthLabel}`;

    populateCategorySelect("recurringEditCategory", item.type, item.categoryId);

    $("recurringEditExplanation").textContent =
        `Valor base atual da recorrência: ${money(currentVersion.amount)}. ` +
        `Se marcar a opção abaixo, o novo valor será aplicado somente em ${monthLabel}. ` +
        `Caso contrário, passará a valer de ${monthLabel} em diante.`;

    $("recurringEditOnlyThisMonth").checked = hasOverride;

    $("recurringEditResetContainer").classList.toggle("hidden", !hasOverride);

    populateDescriptionOptions("recurringEditDescription", "recurringEditDescriptionList");

    const modal = $("recurringEditModal");
    if (modal) modal.classList.remove("hidden");
}

function closeRecurringEditModal() {
    const modal = $("recurringEditModal");
    if (modal) modal.classList.add("hidden");
    editingRecurringId = null;
}

safeOn("closeRecurringEditModal", "click", closeRecurringEditModal);

safeOn("recurringEditModal", "click", event => {
    if (event.target === $("recurringEditModal")) closeRecurringEditModal();
});

safeOn("recurringEditResetButton", "click", () => {
    if (!editingRecurringId) return;

    const overrideKey = getOverrideKey(editingRecurringId, selectedDate);

    if (recurringMonthOverrides[overrideKey] === undefined) {
        alert("Não há ajuste para remover neste mês.");
        return;
    }

    delete recurringMonthOverrides[overrideKey];
    saveData();
    updateDashboard();
    renderRecurringList();
    closeRecurringEditModal();
});

safeOn("recurringEditForm", "submit", event => {
    event.preventDefault();

    if (!editingRecurringId) return;

    const item = recurring.find(x => x.id === editingRecurringId);
    if (!item) {
        closeRecurringEditModal();
        return;
    }

    const description = $("recurringEditDescription").value.trim();
    const amountValue = Number($("recurringEditAmount").value);
    const categoryId = normalizeCategoryId(item.type, $("recurringEditCategory").value);

    if (!description) {
        alert("Informe a descrição.");
        return;
    }

    if (!Number.isFinite(amountValue) || amountValue <= 0) {
        alert("Informe um valor válido.");
        return;
    }

    const roundedValue = Math.round(amountValue * 100) / 100;
    const onlyThisMonth = $("recurringEditOnlyThisMonth").checked;

    const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12);
    const currentVersion = getVersionForDate(item, monthStart)
        || item.versions[item.versions.length - 1];

    item.description = description;
    item.categoryId = categoryId;
    registerDescription(description);

    if (onlyThisMonth) {
        const overrideKey = getOverrideKey(item.id, selectedDate);

        if (roundedValue === currentVersion.amount) {
            delete recurringMonthOverrides[overrideKey];
        } else {
            recurringMonthOverrides[overrideKey] = roundedValue;
        }
    } else {
        const changeMonthStartStr = localDate(monthStart);

        const previousMonthEnd = new Date(
            monthStart.getFullYear(),
            monthStart.getMonth(),
            0,
            12
        );
        const previousMonthEndStr = localDate(previousMonthEnd);

        const sorted = [...item.versions].sort((a, b) =>
            a.startDate.localeCompare(b.startDate)
        );

        const affectedVersion = sorted.find(v => {
            const vStart = v.startDate;
            const vEnd = v.endDate || "9999-12-31";
            return changeMonthStartStr >= vStart && changeMonthStartStr <= vEnd;
        });

        if (!affectedVersion) {
            const laterVersion = sorted.find(v => v.startDate > changeMonthStartStr);
            if (laterVersion) {
                alert("Já existe uma alteração de valor posterior a esta data. Edite a versão correta.");
                return;
            }

            item.versions.push({
                amount: roundedValue,
                startDate: changeMonthStartStr,
                endDate: null
            });
        } else {
            const wasOpen = !affectedVersion.endDate;
            const originalEnd = affectedVersion.endDate;

            if (roundedValue !== affectedVersion.amount) {
                affectedVersion.endDate = previousMonthEndStr;

                const newVersion = {
                    amount: roundedValue,
                    startDate: changeMonthStartStr,
                    endDate: wasOpen ? null : originalEnd
                };

                item.versions.push(newVersion);

                item.versions.sort((a, b) => a.startDate.localeCompare(b.startDate));
            }
        }

        const monthPrefix = monthKey(selectedDate);
        Object.keys(recurringMonthOverrides).forEach(k => {
            if (!k.startsWith(`${item.id}|`)) return;
            const keyMonth = k.split("|")[1];
            if (keyMonth >= monthPrefix) {
                delete recurringMonthOverrides[k];
            }
        });
    }

    rebuildSavedDescriptions();

    saveData();
    updateDashboard();
    renderRecurringList();
    closeRecurringEditModal();
});

// ==========================================
// FORMULÁRIO DE NOVO RECORRENTE
// ==========================================

safeOn("openRecurringMenu", "click", openRecurringMenu);
safeOn("closeRecurringMenu", "click", closeRecurringMenu);

safeOn("openIncomeRecurring", "click", () => openRecurringList("income"));
safeOn("openCreditRecurring", "click", () => openRecurringList("credit"));
safeOn("openDebitRecurring", "click", () => openRecurringList("debit"));

safeOn("openRecurringForm", "click", () => {
    const formContainer = $("recurringFormContainer");
    if (formContainer) formContainer.classList.remove("hidden");
    const form = $("recurringForm");
    if (form) form.reset();

    const startEl = $("recurringStart");
    if (startEl) startEl.value = suggestedDateInSelectedMonth();

    populateCategorySelect("recurringCategory", currentRecurringType, OUTROS_ID);
    populateDescriptionOptions("recurringDescription", "recurringDescriptionList");
});

safeOn("closeRecurringForm", "click", () => {
    const formContainer = $("recurringFormContainer");
    if (formContainer) formContainer.classList.add("hidden");
});

safeOn("closeRecurringListModal", "click", closeRecurringListModal);

safeOn("recurringListModal", "click", event => {
    if (event.target === $("recurringListModal")) closeRecurringListModal();
});

safeOn("recurringForm", "submit", event => {
    event.preventDefault();

    const description = $("recurringDescription").value.trim();
    const amount = Number($("recurringAmount").value);
    const startDate = $("recurringStart").value;
    const frequency = $("recurringFrequency").value;
    const categoryId = normalizeCategoryId(currentRecurringType, $("recurringCategory").value);

    if (!description || !Number.isFinite(amount) || amount <= 0 || !startDate) {
        alert("Preencha os dados corretamente.");
        return;
    }

    registerDescription(description);

    recurring.push({
        id: makeId(),
        description,
        type: currentRecurringType,
        categoryId,
        frequency,
        dayOfMonth: parseDate(startDate).getDate(),
        versions: [
            {
                amount: Math.round(amount * 100) / 100,
                startDate,
                endDate: null
            }
        ]
    });

    rebuildSavedDescriptions();

    saveData();
    updateDashboard();

    const form = $("recurringForm");
    if (form) form.reset();

    const startEl = $("recurringStart");
    if (startEl) startEl.value = suggestedDateInSelectedMonth();

    const formContainer = $("recurringFormContainer");
    if (formContainer) formContainer.classList.add("hidden");
    renderRecurringList();
});

// ==========================================
// MENU DE LANÇAMENTOS DO MÊS (EVENTOS)
// ==========================================

safeOn("openTransactionsMenu", "click", openTransactionsMenu);
safeOn("closeTransactionsMenu", "click", closeTransactionsMenu);

safeOn("openIncomeTransactions", "click", () => openTransactionsList("income"));
safeOn("openCreditTransactions", "click", () => openTransactionsList("credit"));
safeOn("openDebitTransactions", "click", () => openTransactionsList("debit"));

safeOn("openTransactionForm", "click", () => {
    openStandaloneTransactionForm();
});

safeOn("closeTransactionsListModal", "click", closeTransactionsListModal);

safeOn("transactionsListModal", "click", event => {
    if (event.target === $("transactionsListModal")) closeTransactionsListModal();
});

safeOn("transactionsMenu", "click", event => {
    if (event.target === $("transactionsMenu")) closeTransactionsMenu();
});

// ==========================================
// NAVEGAÇÃO ENTRE MESES
// ==========================================

function navigateMonth(offset) {
    selectedDate = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth() + offset,
        1,
        12
    );

    try {
        updateDashboard();
    } catch (e) {
        console.error("Erro ao atualizar painel:", e);
    }

    if ($("recurringListModal") && !$("recurringListModal").classList.contains("hidden")) {
        try {
            renderRecurringList();
            const monthLabel = selectedDate.toLocaleDateString("pt-BR", {
                month: "long",
                year: "numeric"
            });
            $("recurringListMonthLabel").textContent = `Válidos em ${monthLabel}`;
        } catch (e) {
            console.error("Erro ao atualizar lista de recorrentes:", e);
        }
    }

    if ($("recurringMenu") && !$("recurringMenu").classList.contains("hidden")) {
        const monthLabel = selectedDate.toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric"
        });
        $("recurringMonthLabel").textContent = `Válidos em ${monthLabel}`;
    }

    if ($("transactionsListModal") && !$("transactionsListModal").classList.contains("hidden")) {
        try {
            renderTransactionsList();
            const monthLabel = selectedDate.toLocaleDateString("pt-BR", {
                month: "long",
                year: "numeric"
            });
            $("transactionsListMonthLabel").textContent = `Lançamentos de ${monthLabel}`;
        } catch (e) {
            console.error("Erro ao atualizar lista de lançamentos:", e);
        }
    }

    if ($("transactionsMenu") && !$("transactionsMenu").classList.contains("hidden")) {
        const monthLabel = selectedDate.toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric"
        });
        $("transactionsMonthLabel").textContent = `Lançamentos de ${monthLabel}`;
    }
}

safeOn("prevMonth", "click", () => navigateMonth(-1));
safeOn("nextMonth", "click", () => navigateMonth(1));

safeOn("goToCurrentMonth", "click", () => {
    const now = new Date();
    selectedDate = new Date(now.getFullYear(), now.getMonth(), 1, 12);

    try {
        updateDashboard();
    } catch (e) {
        console.error("Erro ao atualizar painel:", e);
    }

    if ($("recurringListModal") && !$("recurringListModal").classList.contains("hidden")) {
        try {
            renderRecurringList();
        } catch (e) {
            console.error(e);
        }
    }

    if ($("recurringMenu") && !$("recurringMenu").classList.contains("hidden")) {
        const monthLabel = selectedDate.toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric"
        });
        $("recurringMonthLabel").textContent = `Válidos em ${monthLabel}`;
    }

    if ($("transactionsListModal") && !$("transactionsListModal").classList.contains("hidden")) {
        try {
            renderTransactionsList();
        } catch (e) {
            console.error(e);
        }
    }

    if ($("transactionsMenu") && !$("transactionsMenu").classList.contains("hidden")) {
        const monthLabel = selectedDate.toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric"
        });
        $("transactionsMonthLabel").textContent = `Lançamentos de ${monthLabel}`;
    }
});

// ==========================================
// SWIPE ENTRE MESES
// ==========================================

let touchStartX = 0;
let touchStartY = 0;
let touchTracking = false;

function isInteractiveTarget(target) {
    if (!target) return false;
    return !!target.closest(
        "input, select, textarea, button, label, a, .money-cell, .delete-button, .outline-button, .checkbox-option, .modal-card, .month-selector, .app-tabs, .category-row"
    );
}

const swipeArea = $("mainContent");

if (swipeArea) {
    swipeArea.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) {
            touchTracking = false;
            return;
        }

        if (isInteractiveTarget(e.target)) {
            touchTracking = false;
            return;
        }

        touchTracking = true;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    swipeArea.addEventListener("touchend", (e) => {
        if (!touchTracking) return;
        touchTracking = false;

        const touch = e.changedTouches[0];
        if (!touch) return;

        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;

        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        const minDistance = 60;

        if (absX < minDistance) return;
        if (absX < absY * 1.4) return;

        if (deltaX < 0) {
            navigateMonth(1);
        } else {
            navigateMonth(-1);
        }
    }, { passive: true });
}

// ==========================================
// EXPANDIR/RECOLHER SEÇÕES
// ==========================================

function setCalendarSectionOpen(open) {
    calendarSectionOpen = open;
    const section = $("calendarSection");
    if (section) section.classList.toggle("hidden", !open);
    const icon = $("toggleCalendarIcon");
    if (icon) icon.textContent = open ? "▾" : "▸";
}

function setBackupSectionOpen(open) {
    backupSectionOpen = open;
    const section = $("backupSection");
    if (section) section.classList.toggle("hidden", !open);
    const icon = $("toggleBackupIcon");
    if (icon) icon.textContent = open ? "▾" : "▸";
}

safeOn("toggleCalendarButton", "click", () => {
    setCalendarSectionOpen(!calendarSectionOpen);
});

safeOn("toggleBackupButton", "click", () => {
    setBackupSectionOpen(!backupSectionOpen);
});

// ==========================================
// EXCLUSÃO SELETIVA DE LANÇAMENTOS
// ==========================================

let deleteScope = "all";

function openDeleteOptions(scope) {
    deleteScope = scope;

    const modal = $("deleteOptionsModal");
    if (!modal) return;

    const monthName = selectedDate.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric"
    });

    $("deleteModalTitle").textContent = scope === "all"
        ? "Apagar todos os registros"
        : "Apagar registros do mês";

    $("deleteModalDescription").textContent = scope === "all"
        ? "Escolha quais categorias deseja apagar de todo o aplicativo. Esta ação não pode ser desfeita."
        : `Escolha quais categorias deseja apagar de ${monthName}. Os lançamentos recorrentes continuarão cadastrados. Esta ação não pode ser desfeita.`;

    $("deleteOneTimeCheckbox").checked = true;
    $("deleteRecurringCheckbox").checked = true;

    modal.classList.remove("hidden");
}

function closeDeleteOptions() {
    const modal = $("deleteOptionsModal");
    if (modal) modal.classList.add("hidden");
}

function confirmSelectedDeletion() {
    const deleteOneTime = $("deleteOneTimeCheckbox").checked;
    const deleteRecurring = $("deleteRecurringCheckbox").checked;

    if (!deleteOneTime && !deleteRecurring) {
        alert("Marque pelo menos uma opção para continuar.");
        return;
    }

    if (deleteScope === "all") {
        if (deleteOneTime) transactions = [];

        if (deleteRecurring) {
            recurring = [];
            recurringMonthOverrides = {};
        }

        if (deleteOneTime && deleteRecurring) {
            initialBalances = {};
            invoiceSettings = {};
            savedDescriptions = [];
        }

        $("backupMessage").textContent = "";
        $("recurringMenu").classList.add("hidden");
        $("recurringListModal").classList.add("hidden");
        $("recurringFormContainer").classList.add("hidden");
        $("transactionsMenu").classList.add("hidden");
        $("transactionsListModal").classList.add("hidden");
        $("transactionFormContainer").classList.add("hidden");

        selectedDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
    } else {
        const key = monthKey(selectedDate);
        const monthPrefix = `${key}-`;

        if (deleteOneTime) {
            transactions = transactions.filter(item =>
                !item.date.startsWith(monthPrefix) &&
                !(item.type === "credit" && getInvoiceMonth(item) === key)
            );
        }

        if (deleteRecurring) {
            recurring = recurring.filter(item => {
                const firstVersion = [...item.versions].sort((a, b) =>
                    a.startDate.localeCompare(b.startDate)
                )[0];

                const itemStart = firstVersion.startDate;
                const lastVersionEnd = [...item.versions]
                    .map(v => v.endDate || "9999-12-31")
                    .sort()
                    .pop();

                const monthStart = `${monthPrefix}01`;
                const monthEnd = `${monthPrefix}31`;

                const overlaps = !(lastVersionEnd < monthStart || itemStart > monthEnd);

                if (!overlaps) return true;

                return false;
            });

            Object.keys(recurringMonthOverrides).forEach(k => {
                if (k.split("|")[1] === key) {
                    delete recurringMonthOverrides[k];
                }
            });
        }

        if (deleteOneTime && deleteRecurring) {
            delete initialBalances[key];
            delete invoiceSettings[key];
        }
    }

    rebuildSavedDescriptions();

    saveData();

    closeDeleteOptions();
    updateDashboard();

    alert(deleteScope === "all"
        ? "A exclusão selecionada foi concluída."
        : "Os registros selecionados deste mês foram apagados."
    );
}

safeOn("resetAppButton", "click", () => {
    openDeleteOptions("all");
});

safeOn("resetMonthButton", "click", () => {
    openDeleteOptions("month");
});

safeOn("cancelDeleteButton", "click", closeDeleteOptions);
safeOn("confirmDeleteButton", "click", confirmSelectedDeletion);

safeOn("deleteOptionsModal", "click", event => {
    if (event.target === $("deleteOptionsModal")) closeDeleteOptions();
});

safeOn("closeDayModalButton", "click", closeDayModal);

safeOn("dayTransactionsModal", "click", event => {
    if (event.target === $("dayTransactionsModal")) closeDayModal();
});

safeOn("transactionFormModal", "click", event => {
    if (event.target === $("transactionFormModal")) closeTransactionForm();
});

safeOn("recurringMenu", "click", event => {
    if (event.target === $("recurringMenu")) closeRecurringMenu();
});

// ==========================================
// SALVAR CONFIGURAÇÕES
// ==========================================

safeOn("saveInitialBalance", "click", saveInitialBalance);
safeOn("saveInvoiceSettings", "click", saveInvoiceConfig);

// ==========================================
// BOTÕES DE CONFIGURAÇÃO (SALDO E FATURA)
// ==========================================

safeOn("openBalanceConfig", "click", () => {
    updateDashboard();
    const modal = $("balanceConfigModal");
    if (modal) modal.classList.remove("hidden");
});

safeOn("closeBalanceConfig", "click", () => {
    const modal = $("balanceConfigModal");
    if (modal) modal.classList.add("hidden");
});

safeOn("balanceConfigModal", "click", event => {
    if (event.target === $("balanceConfigModal")) {
        const modal = $("balanceConfigModal");
        if (modal) modal.classList.add("hidden");
    }
});

safeOn("openInvoiceConfig", "click", () => {
    updateDashboard();
    const modal = $("invoiceConfigModal");
    if (modal) modal.classList.remove("hidden");
});

safeOn("closeInvoiceConfig", "click", () => {
    const modal = $("invoiceConfigModal");
    if (modal) modal.classList.add("hidden");
});

safeOn("invoiceConfigModal", "click", event => {
    if (event.target === $("invoiceConfigModal")) {
        const modal = $("invoiceConfigModal");
        if (modal) modal.classList.add("hidden");
    }
});

// ==========================================
// EXPORTAÇÃO DE BACKUP
// ==========================================

safeOn("exportButton", "click", () => {
    const backup = {
        application: "Meu Financeiro",
        version: 18,
        exportedAt: new Date().toISOString(),
        ...getDataSnapshot(),
        recurring
    };

    const blob = new Blob(
        [JSON.stringify(backup, null, 2)],
        { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `backup-financeiro-${localDate(new Date())}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    const msg = $("backupMessage");
    if (msg) msg.textContent = "Backup gerado. Guarde o arquivo em uma pasta segura.";
});

// ==========================================
// IMPORTAÇÃO DE BACKUP
// ==========================================

safeOn("importFile", "change", async event => {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const data = JSON.parse(await file.text());

        if (!Array.isArray(data.transactions)) {
            throw new Error("Arquivo inválido.");
        }

        if (!confirm("A importação substituirá os dados atuais. Deseja continuar?")) {
            return;
        }

        applyDataSnapshot(data);

        if (Array.isArray(data.recurring)) {
            recurring = data.recurring.map(item => ({
                ...item,
                type: item.type === "expense" ? "debit" : item.type,
                categoryId: item.categoryId || OUTROS_ID
            }));
        }

        rebuildSavedDescriptions();

        saveData();
        updateDashboard();

        const msg = $("backupMessage");
        if (msg) msg.textContent = "Backup importado com sucesso!";
    } catch (error) {
        alert("Não foi possível importar. Verifique o arquivo JSON.");
    }

    event.target.value = "";
});

// ==========================================
// BOTÕES DO GOOGLE DRIVE
// ==========================================

safeOn("googleLoginButton", "click", loginGoogle);
safeOn("googleLogoutButton", "click", logoutGoogle);
safeOn("syncNowButton", "click", async () => {
    await saveToDrive();
    await loadFromDrive();
});

// ==========================================
// TEMA CLARO / ESCURO
// ==========================================

(function initTheme() {
    const THEME_KEY = "meuFinanceiroTheme";
    const root = document.documentElement;

    function getSystemTheme() {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    function applyTheme(theme) {
        root.setAttribute("data-theme", theme);

        const icon = $("themeToggleIcon");
        if (icon) icon.textContent = theme === "dark" ? "☀️" : "🌙";

        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute("content", theme === "dark" ? "#060b14" : "#101827");
        }
    }

    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved === "dark" || saved === "light" ? saved : getSystemTheme());

    const btn = $("themeToggle");
    if (btn) {
        btn.addEventListener("click", () => {
            const current = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
            const next = current === "dark" ? "light" : "dark";
            applyTheme(next);
            localStorage.setItem(THEME_KEY, next);
        });
    }

    if (window.matchMedia) {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
            if (!localStorage.getItem(THEME_KEY)) {
                applyTheme(e.matches ? "dark" : "light");
            }
        });
    }
})();

// ==========================================
// DASHBOARD
// ==========================================

let dashPeriod = { months: 12 };
let dashProjectionMonths = 6;
let projectionSectionOpen = false;

function getDashRange() {
    const now = new Date();

    if (dashPeriod.customStart || dashPeriod.customEnd) {
        const start = dashPeriod.customStart
            ? parseDate(dashPeriod.customStart + "-01")
            : new Date(now.getFullYear(), now.getMonth() - 11, 1, 12);
        const end = dashPeriod.customEnd
            ? new Date(parseDate(dashPeriod.customEnd + "-01").getFullYear(),
                    parseDate(dashPeriod.customEnd + "-01").getMonth() + 1, 0, 12)
            : new Date(now.getFullYear(), now.getMonth() + 1, 0, 12);
        return { start, end };
    }

    if (dashPeriod.yearOnly) {
        return {
            start: new Date(now.getFullYear(), 0, 1, 12),
            end: new Date(now.getFullYear(), 11, 31, 12)
        };
    }

    const months = dashPeriod.months || 12;
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1, 12);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12);
    return { start, end };
}

function forEachMonthInRange(start, end, cb) {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12);
    const limit = new Date(end.getFullYear(), end.getMonth(), 1, 12);

    while (cursor <= limit) {
        cb(new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12));
        cursor.setMonth(cursor.getMonth() + 1);
    }
}

function computeMonthTotals(date) {
    const key = monthKey(date);

    const actual = transactions.filter(item => item.date.startsWith(key));
    const scheduled = getOccurrencesForMonth(date);

    const incomeActual = actual
        .filter(x => x.type === "income")
        .reduce((s, x) => s + x.amount, 0);

    const incomePlanned = scheduled
        .filter(x => x.type === "income")
        .reduce((s, x) => s + x.amount, 0);

    const debitActual = actual
        .filter(x => x.type === "debit")
        .reduce((s, x) => s + x.amount, 0);

    const debitPlanned = scheduled
        .filter(x => x.type === "debit")
        .reduce((s, x) => s + x.amount, 0);

    const invoice = getInvoiceAmount(date);
    const opening = getOpeningBalance(date);
    const closing = opening + (incomeActual + incomePlanned)
        - (debitActual + debitPlanned + invoice);

    return {
        key,
        date,
        income: incomeActual + incomePlanned,
        debit: debitActual + debitPlanned,
        invoice,
        opening,
        closing
    };
}

function renderDashboard() {
    const { start, end } = getDashRange();

    let totalIncome = 0;
    let totalDebit = 0;
    let totalInvoice = 0;

    forEachMonthInRange(start, end, m => {
        const t = computeMonthTotals(m);
        totalIncome += t.income;
        totalDebit += t.debit;
        totalInvoice += t.invoice;
    });

    const balance = totalIncome - totalDebit - totalInvoice;

    const setText = (id, v) => {
        const el = $(id);
        if (el) el.textContent = v;
    };

    setText("dashKpiIncome", money(totalIncome));
    setText("dashKpiDebit", money(totalDebit));
    setText("dashKpiInvoice", money(totalInvoice));
    setText("dashKpiBalance", money(balance));

    const percent = totalIncome > 0
        ? Math.min(100, Math.round((totalDebit / totalIncome) * 100))
        : 0;

    setText("dashComparePercent", `${percent}%`);

    const fill = $("dashCompareFill");
    if (fill) {
        fill.style.width = `${percent}%`;
        fill.classList.toggle("warn", percent >= 70 && percent < 100);
        fill.classList.toggle("danger", percent >= 100);
    }

    const hint = $("dashCompareHint");
    if (hint) {
        if (totalIncome === 0 && totalDebit === 0) {
            hint.textContent = "Sem lançamentos no período.";
        } else if (percent < 70) {
            hint.textContent = `Você está gastando ${percent}% do que entra. Boa margem.`;
        } else if (percent < 100) {
            hint.textContent = `Atenção: ${percent}% da sua entrada está indo para saídas no débito.`;
        } else {
            hint.textContent = `Alerta: suas saídas no débito superam as entradas.`;
        }
    }

    const periodLabel = $("dashPeriodLabel");
    if (periodLabel) {
        const fmt = d => d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
        periodLabel.textContent = `${fmt(start)} → ${fmt(end)}`;
    }

    renderProjection();
}

function renderProjection() {
    const container = $("projectionList");
    if (!container) return;

    container.innerHTML = "";

    const today = new Date();
    const baseDate = new Date(today.getFullYear(), today.getMonth(), 1, 12);

    let accumulated = calculateMonthClosing(
        new Date(today.getFullYear(), today.getMonth() - 1, 1, 12)
    );

    for (let i = 0; i < dashProjectionMonths; i++) {
        const monthDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1, 12);
        const t = computeMonthTotals(monthDate);

        accumulated = t.closing;

        const row = document.createElement("div");
        row.className = "dash-projection-row";

        const label = monthDate.toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric"
        });

        const nameEl = document.createElement("strong");
        nameEl.textContent = label;

        const valueEl = document.createElement("span");
        valueEl.className = "dash-projection-value";
        if (accumulated < 0) valueEl.classList.add("negative");
        valueEl.textContent = money(accumulated);

        row.append(nameEl, valueEl);
        container.appendChild(row);
    }
}

function updateDashShortcutButtons() {
    document.querySelectorAll(".dash-shortcut").forEach(btn => {
        const months = btn.getAttribute("data-months");
        const range = btn.getAttribute("data-range");

        let active = false;

        if (months && !dashPeriod.customStart && !dashPeriod.customEnd && !dashPeriod.yearOnly) {
            active = Number(months) === Number(dashPeriod.months);
        }
        if (range === "year" && dashPeriod.yearOnly) active = true;
        if (range === "custom" && (dashPeriod.customStart || dashPeriod.customEnd)) active = true;

        btn.classList.toggle("active", active);
    });
}

function applyDashPreset(months) {
    dashPeriod = { months };
    const customEl = $("dashCustomRange");
    if (customEl) customEl.classList.add("hidden");
    updateDashShortcutButtons();
    renderDashboard();
}

function applyDashYear() {
    dashPeriod = { yearOnly: true };
    const customEl = $("dashCustomRange");
    if (customEl) customEl.classList.add("hidden");
    updateDashShortcutButtons();
    renderDashboard();
}

function applyDashCustom() {
    const customEl = $("dashCustomRange");
    if (customEl) customEl.classList.remove("hidden");

    const startEl = $("dashStart");
    const endEl = $("dashEnd");

    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth() - 11, 1, 12);
    const defaultEnd = now;

    if (startEl && !startEl.value) {
        startEl.value = `${defaultStart.getFullYear()}-${String(defaultStart.getMonth() + 1).padStart(2, "0")}`;
    }
    if (endEl && !endEl.value) {
        endEl.value = `${defaultEnd.getFullYear()}-${String(defaultEnd.getMonth() + 1).padStart(2, "0")}`;
    }

    dashPeriod = {
        customStart: startEl ? startEl.value : null,
        customEnd: endEl ? endEl.value : null
    };

    updateDashShortcutButtons();
    renderDashboard();
}

document.querySelectorAll(".dash-shortcut").forEach(btn => {
    btn.addEventListener("click", () => {
        const months = btn.getAttribute("data-months");
        const range = btn.getAttribute("data-range");

        if (months) applyDashPreset(Number(months));
        else if (range === "year") applyDashYear();
        else if (range === "custom") applyDashCustom();
    });
});

safeOn("dashStart", "change", () => {
    const startEl = $("dashStart");
    const endEl = $("dashEnd");
    dashPeriod.customStart = startEl ? startEl.value : null;
    dashPeriod.customEnd = endEl ? endEl.value : null;
    dashPeriod.months = null;
    dashPeriod.yearOnly = false;
    updateDashShortcutButtons();
    renderDashboard();
});

safeOn("dashEnd", "change", () => {
    const startEl = $("dashStart");
    const endEl = $("dashEnd");
    dashPeriod.customStart = startEl ? startEl.value : null;
    dashPeriod.customEnd = endEl ? endEl.value : null;
    dashPeriod.months = null;
    dashPeriod.yearOnly = false;
    updateDashShortcutButtons();
    renderDashboard();
});

safeOn("toggleProjectionButton", "click", () => {
    projectionSectionOpen = !projectionSectionOpen;
    const section = $("projectionSection");
    if (section) section.classList.toggle("hidden", !projectionSectionOpen);
    const icon = $("toggleProjectionIcon");
    if (icon) icon.textContent = projectionSectionOpen ? "▾" : "▸";
    if (projectionSectionOpen) renderProjection();
});

safeOn("projectionMonths", "input", () => {
    const el = $("projectionMonths");
    if (!el) return;
    const v = Number(el.value);
    if (Number.isFinite(v) && v >= 1 && v <= 24) {
        dashProjectionMonths = v;
        renderProjection();
    }
});

safeOn("dashOpenTransactionsMenu", "click", openTransactionsMenu);
safeOn("dashOpenRecurringMenu", "click", openRecurringMenu);

const _originalSetActiveTab = setActiveTab;
setActiveTab = function (view) {
    _originalSetActiveTab(view);
    if (view === "dashboard") {
        updateDashShortcutButtons();
        renderDashboard();
    }
};

// Aplica o preset padrão de 12 meses
applyDashPreset(12);

// ==========================================
// INICIALIZAÇÃO
// ==========================================

ensureOthersCategory();

attachDatalist("transactionDescription", "transactionDescriptionList");
attachDatalist("recurringDescription", "recurringDescriptionList");
attachDatalist("recurringEditDescription", "recurringEditDescriptionList");
attachDatalist("standaloneDescription", "standaloneDescriptionList");

loadData();

populateDescriptionOptions("transactionDescription", "transactionDescriptionList");
populateDescriptionOptions("recurringDescription", "recurringDescriptionList");
populateDescriptionOptions("standaloneDescription", "standaloneDescriptionList");

updateDashboard();
updateCloudButtons();
setCalendarSectionOpen(false);
setBackupSectionOpen(false);
setActiveTab("painel");
initGoogleAuth();