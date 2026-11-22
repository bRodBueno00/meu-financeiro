const STORAGE_KEY = "meuFinanceiroDados_v2";

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

// ===== CATEGORIAS (LISTA ÚNICA) =====
// categories = [{ id, name, color, types: ["income","credit","debit"] }]
let categories = [];
let nextCategoryColorIndex = 0;

let pendingTransactionType = null;
let pendingTransactionDate = null;

let editingRecurringId = null;

let currentRecurringType = "income";
let currentTransactionsType = "income";

let editingCategoryId = null;

let pendingCategoryTarget = null;

let calendarSectionOpen = false;
let backupSectionOpen = false;
let currentView = "painel";

let dashPeriod = { months: 12 };
let dashProjectionMonths = 6;
let projectionSectionOpen = false;
let filtersDropdownOpen = false;

let chartFilters = {
    types: { debit: true, invoice: true },
    origins: { oneTime: true, recurring: true },
    categoryKeys: new Set(),
    minValue: null,
    maxValue: null
};

let selectedCategoryKey = null;

let chartTooltipEl = null;
let chartBarsState = null;
let chartLineState = null;

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
    if (!el) return;
    el.addEventListener(event, handler);
}

// ==========================================
// CATEGORIAS — LISTA ÚNICA COM FLAG types
// ==========================================

const ALL_TYPES = ["income", "credit", "debit"];
const TYPE_LABELS = { income: "Entrada", credit: "Crédito", debit: "Débito" };

function ensureOthersCategory() {
    if (!Array.isArray(categories)) categories = [];
    const existing = categories.find(c => c.id === OUTROS_ID);
    if (!existing) {
        categories.unshift({
            id: OUTROS_ID,
            name: "Outros",
            color: "#64748b",
            types: [...ALL_TYPES]
        });
    } else {
        existing.types = [...ALL_TYPES];
        existing.name = "Outros";
        existing.color = "#64748b";
    }
}

function nextColor() {
    const color = CATEGORY_PALETTE[nextCategoryColorIndex % CATEGORY_PALETTE.length];
    nextCategoryColorIndex++;
    return color;
}

function getCategoryById(id) {
    if (!id) return null;
    return categories.find(c => c.id === id) || null;
}

function getCategoryName(id) {
    if (!id) return "Outros";
    const cat = getCategoryById(id);
    return cat ? cat.name : "Outros";
}

function getCategoryColor(id) {
    if (!id) return "#64748b";
    const cat = getCategoryById(id);
    return cat ? cat.color : "#64748b";
}

function categorySupportsType(id, type) {
    const cat = getCategoryById(id);
    if (!cat) return id === OUTROS_ID;
    return Array.isArray(cat.types) && cat.types.includes(type);
}

function categoriesForType(type) {
    return categories.filter(c => Array.isArray(c.types) && c.types.includes(type));
}

function normalizeCategoryId(id, type) {
    if (!id) return OUTROS_ID;
    const cat = getCategoryById(id);
    if (!cat) return OUTROS_ID;
    if (type && !cat.types.includes(type)) return OUTROS_ID;
    return cat.id;
}

function populateCategorySelect(selectId, type, selectedId = OUTROS_ID) {
    const select = $(selectId);
    if (!select) return;

    select.innerHTML = "";

    const list = categoriesForType(type);

    list.forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat.id;
        opt.textContent = cat.name;
        select.appendChild(opt);
    });

    select.value = normalizeCategoryId(selectedId, type);
}

function resolveCategoryType(buttonType, targetSelectId) {
    if (targetSelectId === "transactionCategory") {
        const typeEl = $("transactionType");
        return typeEl ? typeEl.value : "income";
    }
    if (targetSelectId === "standaloneCategory") return currentTransactionsType;
    if (targetSelectId === "recurringCategory") return currentRecurringType;
    if (targetSelectId === "recurringEditCategory") {
        if (editingRecurringId) {
            const item = recurring.find(x => x.id === editingRecurringId);
            if (item) return item.type;
        }
        return currentRecurringType;
    }
    return "income";
}

// ---- Modal de nova categoria (com checkboxes por tipo) ----

function openNewCategoryModal(targetSelectId, buttonType) {
    const currentType = resolveCategoryType(buttonType, targetSelectId);
    pendingCategoryTarget = { selectId: targetSelectId, currentType };

    const form = $("newCategoryForm");
    if (form) form.reset();

    ALL_TYPES.forEach(t => {
        const cb = $(`newCategoryType_${t}`);
        if (cb) cb.checked = (t === currentType);
    });

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

    const nameInput = $("newCategoryName");
    const name = nameInput ? nameInput.value.trim() : "";
    if (!name) return;

    const selectedTypes = ALL_TYPES.filter(t => {
        const cb = $(`newCategoryType_${t}`);
        return cb && cb.checked;
    });

    if (selectedTypes.length === 0) {
        alert("Selecione pelo menos um tipo para a categoria.");
        return;
    }

    const exists = categories.some(
        c => c.name.toLowerCase() === name.toLowerCase()
    );
    if (exists) {
        alert("Já existe uma categoria com esse nome.");
        return;
    }

    const newCat = { id: makeId(), name, color: nextColor(), types: selectedTypes };
    categories.push(newCat);

    saveData();

    const targetType = pendingCategoryTarget.currentType;
    if (newCat.types.includes(targetType)) {
        populateCategorySelect(pendingCategoryTarget.selectId, targetType, newCat.id);
    } else {
        populateCategorySelect(pendingCategoryTarget.selectId, targetType);
    }

    closeNewCategoryModal();
    renderFiltersDropdown();
    refreshOpenCategorySelects();
});

// ---- Modal de gestão de categorias (lista única) ----

function openCategoriesList() {
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

    const sorted = [...categories].sort((a, b) => {
        if (a.id === OUTROS_ID) return -1;
        if (b.id === OUTROS_ID) return 1;
        return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    });

    sorted.forEach(cat => {
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

        const details = document.createElement("small");
        if (cat.id === OUTROS_ID) {
            details.textContent = "Categoria padrão universal (não editável)";
        } else {
            const typesLabel = cat.types.map(t => TYPE_LABELS[t]).join(" • ");
            details.textContent = typesLabel || "Nenhum tipo";
        }
        info.appendChild(details);

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

    ALL_TYPES.forEach(t => {
        const cb = $(`categoryEditType_${t}`);
        if (cb) cb.checked = cat.types.includes(t);
    });

    const modal = $("categoryEditModal");
    if (modal) modal.classList.remove("hidden");
}

function closeCategoryEditModal() {
    const modal = $("categoryEditModal");
    if (modal) modal.classList.add("hidden");
    editingCategoryId = null;
}

function deleteCategory(cat) {
    const inUse = transactions.some(t => t.categoryId === cat.id)
        || recurring.some(r => r.categoryId === cat.id);

    if (inUse) {
        if (!confirm(`A categoria "${cat.name}" está em uso. Os lançamentos serão movidos para "Outros". Continuar?`)) return;

        transactions.forEach(t => { if (t.categoryId === cat.id) t.categoryId = OUTROS_ID; });
        recurring.forEach(r => { if (r.categoryId === cat.id) r.categoryId = OUTROS_ID; });
    } else {
        if (!confirm(`Excluir a categoria "${cat.name}"?`)) return;
    }

    categories = categories.filter(c => c.id !== cat.id);
    chartFilters.categoryKeys.delete(cat.id);

    saveData();
    updatePainel();
    renderCategoriesList();
    renderFiltersDropdown();
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

    const selectedTypes = ALL_TYPES.filter(t => {
        const cb = $(`categoryEditType_${t}`);
        return cb && cb.checked;
    });

    if (selectedTypes.length === 0) {
        alert("Selecione pelo menos um tipo para a categoria.");
        return;
    }

    const exists = categories.some(
        c => c.id !== editingCategoryId && c.name.toLowerCase() === newName.toLowerCase()
    );
    if (exists) {
        alert("Já existe uma categoria com esse nome.");
        return;
    }

    const cat = categories.find(c => c.id === editingCategoryId);
    if (cat) {
        cat.name = newName;
        cat.types = selectedTypes;
    }

    saveData();
    updatePainel();
    closeCategoryEditModal();
    renderCategoriesList();
    renderFiltersDropdown();
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
        openCategoriesList();
    }
});

// ==========================================
// PERSISTÊNCIA
// ==========================================

function getDataSnapshot() {
    return {
        version: 19,
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
    return { version: 6, recurring };
}

function registerDescription(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return;

    const exists = savedDescriptions.some(d => d.toLowerCase() === trimmed.toLowerCase());
    if (!exists) {
        savedDescriptions.push(trimmed);
        savedDescriptions.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
    }
}

function rebuildSavedDescriptions() {
    const set = new Map();
    const add = name => {
        const trimmed = (name || "").trim();
        if (!trimmed) return;
        const key = trimmed.toLowerCase();
        if (!set.has(key)) set.set(key, trimmed);
    };

    transactions.forEach(t => add(t.description));
    recurring.forEach(r => add(r.description));
    savedDescriptions.forEach(d => add(d));

    savedDescriptions = Array.from(set.values()).sort((a, b) =>
        a.localeCompare(b, "pt-BR", { sensitivity: "base" })
    );
}

// ---- Migração de categorias antigas para lista única ----

function migrateCategories(data) {
    // Já é lista (novo formato)
    if (Array.isArray(data.categories)) {
        return data.categories.map(c => ({
            id: c.id || makeId(),
            name: c.name || "Sem nome",
            color: c.color || nextColor(),
            types: Array.isArray(c.types) && c.types.length ? c.types.slice() : [...ALL_TYPES]
        }));
    }

    // Formato antigo { income:[], credit:[], debit:[] }
    if (data.categories && typeof data.categories === "object") {
        const merged = new Map();
        const order = [];

        ALL_TYPES.forEach(type => {
            const arr = Array.isArray(data.categories[type]) ? data.categories[type] : [];
            arr.forEach(c => {
                const key = (c.name || "").trim().toLowerCase();
                if (!key) return;
                if (!merged.has(key)) {
                    merged.set(key, {
                        id: c.id || makeId(),
                        name: c.name,
                        color: c.color || nextColor(),
                        types: []
                    });
                    order.push(key);
                }
                const entry = merged.get(key);
                if (!entry.types.includes(type)) entry.types.push(type);
            });
        });

        const list = order.map(k => merged.get(k));

        // Unifica "Outros" — mantém um só com id OUTROS_ID
        const outrosEntries = list.filter(c => c.name.toLowerCase() === "outros");
        if (outrosEntries.length > 0) {
            outrosEntries[0].id = OUTROS_ID;
            outrosEntries[0].name = "Outros";
            outrosEntries[0].color = "#64748b";
            outrosEntries[0].types = [...ALL_TYPES];
            // remove duplicatas de "outros"
            const othersId = OUTROS_ID;
            const seen = new Set();
            for (let i = list.length - 1; i >= 0; i--) {
                if (list[i].name.toLowerCase() === "outros") {
                    if (seen.has(othersId)) {
                        // mescla ids? na migração antiga os "outros" tinham o mesmo id "outros"
                        list.splice(i, 1);
                    } else {
                        seen.add(othersId);
                    }
                }
            }
        }

        return list;
    }

    return [];
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
    savedDescriptions = Array.isArray(data.savedDescriptions) ? data.savedDescriptions.slice() : [];

    categories = migrateCategories(data);
    nextCategoryColorIndex = Number.isInteger(data.nextCategoryColorIndex) ? data.nextCategoryColorIndex : 0;

    ensureOthersCategory();

    if (Array.isArray(data.recurring)) {
        recurring = data.recurring.map(item => ({
            ...item,
            type: item.type === "expense" ? "debit" : item.type,
            categoryId: item.categoryId || OUTROS_ID
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
        if (!saved) { ensureOthersCategory(); return; }

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
        ensureOthersCategory();
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
            if (response.error) { setCloudStatus("Drive: falha no login"); return; }

            accessToken = response.access_token;
            const expiresIn = Number(response.expires_in || 3600);
            localStorage.setItem("meuFinanceiroToken", JSON.stringify({
                token: accessToken,
                expiresAt: Date.now() + expiresIn * 1000
            }));

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
        headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` }
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
    const res = await driveFetch(`${DRIVE_API}/files?q=${query}&fields=files(id,name)`);
    const data = await res.json();
    if (data.files && data.files.length > 0) return data.files[0].id;

    const createRes = await driveFetch(`${DRIVE_API}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
    });
    const created = await createRes.json();
    return created.id;
}

async function findFileInFolder(folderId, fileName) {
    const query = encodeURIComponent(
        `name='${fileName}' and '${folderId}' in parents and trashed=false`
    );
    const res = await driveFetch(`${DRIVE_API}/files?q=${query}&fields=files(id,name,modifiedTime)`);
    const data = await res.json();
    if (data.files && data.files.length > 0) return data.files[0];
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
            applyDataSnapshot(await res.json());
        }

        if (recurringFile) {
            currentRecurringFileId = recurringFile.id;
            const res = await driveFetch(`${DRIVE_API}/files/${recurringFile.id}?alt=media`);
            applyRecurringSnapshot(await res.json());
        }

        rebuildSavedDescriptions();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...getDataSnapshot(), recurring }));
        setCloudStatus("Drive: dados carregados");
    } catch (error) {
        setCloudStatus("Drive: erro ao carregar");
        console.error(error);
    } finally {
        refreshCurrentView();
    }
}

function scheduleCloudSave() {
    if (!accessToken) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveToDrive(), 1200);
}

async function uploadOrUpdateFile(folderId, fileName, currentId, body) {
    if (!currentId) {
        const existing = await findFileInFolder(folderId, fileName);
        if (existing) currentId = existing.id;
    }

    if (!currentId) {
        const metadata = { name: fileName, mimeType: "application/json", parents: [folderId] };
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
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body }
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

        currentFileId = await uploadOrUpdateFile(folderId, FILE_NAME, currentFileId, financeiroBody);
        currentRecurringFileId = await uploadOrUpdateFile(folderId, RECURRING_FILE_NAME, currentRecurringFileId, recurringBody);

        setCloudStatus("Drive: salvo ✓");
    } catch (error) {
        setCloudStatus("Drive: erro ao salvar");
        console.error(error);
    }
}

// ==========================================
// FATURA
// ==========================================

function getInvoiceConfig(date = selectedDate) {
    const key = monthKey(date);
    return invoiceSettings[key] || { start: 14, end: 15, due: 20 };
}

function saveInvoiceConfig() {
    const startEl = $("invoiceStart");
    const endEl = $("invoiceEnd");
    const dueEl = $("invoiceDueDay");
    if (!startEl || !endEl || !dueEl) return;

    const start = Number(startEl.value);
    const end = Number(endEl.value);
    const due = Number(dueEl.value);

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
    refreshCurrentView();
    alert("Configuração da fatura salva para este mês.");
}

function renderInvoiceSettings() {
    const config = getInvoiceConfig();
    const startEl = $("invoiceStart");
    const endEl = $("invoiceEnd");
    const dueEl = $("invoiceDueDay");
    if (startEl) startEl.value = config.start;
    if (endEl) endEl.value = config.end;
    if (dueEl) dueEl.value = config.due;
}

// ==========================================
// SALDO
// ==========================================

function getOpeningBalance(date, depth = 0) {
    const key = monthKey(date);
    if (Object.prototype.hasOwnProperty.call(initialBalances, key)) {
        return Number(initialBalances[key]);
    }
    if (depth >= 120) return 0;

    const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1, 12);
    return calculateMonthClosing(previousMonth, depth + 1);
}

function calculateMonthClosing(date, depth = 0) {
    if (depth >= 120) return 0;

    const year = date.getFullYear();
    const month = date.getMonth();

    const actual = transactions.filter(item => item.date.startsWith(monthKey(date)));
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
    const input = $("initialBalance");
    if (!input) return;

    const raw = input.value;
    const value = Number(raw);

    if (raw.trim() === "" || !Number.isFinite(value)) {
        alert("Informe um saldo inicial válido.");
        return;
    }

    initialBalances[monthKey(selectedDate)] = Math.round(value * 100) / 100;
    saveData();
    refreshCurrentView();
    alert("Saldo inicial salvo com sucesso.");
}

// ==========================================
// RECORRENTES
// ==========================================

function getVersionForDate(item, date) {
    if (!item.versions || !item.versions.length) return null;

    const target = localDate(new Date(date.getFullYear(), date.getMonth(), 1, 12));
    const sorted = [...item.versions].sort((a, b) => a.startDate.localeCompare(b.startDate));

    let chosen = null;
    for (const v of sorted) {
        if (v.startDate <= target) {
            if (!v.endDate || v.endDate >= target) chosen = v;
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

    const firstVersionStart = [...item.versions].map(v => v.startDate).sort()[0];
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
        if (fm < new Date(start.getFullYear(), start.getMonth(), 1, 12)) return null;

        const last = new Date(year, month + 1, 0, 12);
        const day = Math.min(item.dayOfMonth || start.getDate(), last.getDate());
        occurrence = localDate(new Date(year, month, day, 12));
    }

    if (occurrence < version.startDate) return null;
    if (version.endDate && occurrence > version.endDate) return null;

    const override = recurringMonthOverrides[getOverrideKey(item.id, date)];
    const effectiveAmount = override !== undefined ? override : version.amount;

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

        const previousLastDay = new Date(candidate.getFullYear(), candidate.getMonth(), 0).getDate();
        const currentLastDay = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();

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
        let recurringCredit = 0;

        [prevDate, date].forEach(scanDate => {
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
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const due = Math.min(config.due, lastDay);
    return localDate(new Date(date.getFullYear(), date.getMonth(), due, 12));
}

function getDayValues(date, actual, scheduled) {
    const dayActual = actual.filter(x => x.date === date);
    const dayScheduled = scheduled.filter(x => x.occurrenceDate === date);
    const all = [...dayActual, ...dayScheduled];

    const income = all.filter(x => x.type === "income").reduce((s, x) => s + x.amount, 0);
    const credit = all.filter(x => x.type === "credit").reduce((s, x) => s + x.amount, 0);
    const debit = all.filter(x => x.type === "debit").reduce((s, x) => s + x.amount, 0);

    return { income, credit, debit, all };
}

function getTodayBalance() {
    const today = new Date();
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();

    const actual = transactions.filter(item => item.date.startsWith(monthKey(selectedDate)));
    const scheduled = getMonthlyOccurrences();
    const invoice = getInvoiceAmount();
    const invoiceDue = getInvoiceDueDate();

    let balance = getOpeningBalance(selectedDate);

    const selectedKey = monthKey(selectedDate);
    const todayKey = monthKey(today);

    let limitDay;
    if (selectedKey < todayKey) limitDay = new Date(year, month + 1, 0).getDate();
    else if (selectedKey > todayKey) return 0;
    else limitDay = today.getDate();

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
// PAINEL
// ==========================================

function updatePainel() {
    const actual = transactions.filter(item => item.date.startsWith(monthKey(selectedDate)));
    const scheduled = getMonthlyOccurrences();

    const incomeActual = actual.filter(x => x.type === "income").reduce((s, x) => s + x.amount, 0);
    const debitActual = actual.filter(x => x.type === "debit").reduce((s, x) => s + x.amount, 0);
    const incomePlanned = scheduled.filter(x => x.type === "income").reduce((s, x) => s + x.amount, 0);
    const debitPlanned = scheduled.filter(x => x.type === "debit").reduce((s, x) => s + x.amount, 0);

    const invoice = getInvoiceAmount();
    const opening = getOpeningBalance(selectedDate);

    const totalIncome = incomeActual + incomePlanned;
    const totalExpenses = debitActual + debitPlanned + invoice;
    const closing = opening + totalIncome - totalExpenses;

    const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

    setText("balance", money(closing));
    setText("totalIncome", money(totalIncome));
    setText("totalInvoice", money(invoice));
    setText("totalExpenses", money(debitActual + debitPlanned));
    setText("todayBalance", money(getTodayBalance()));

    const monthLabel = selectedDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    setText("currentMonth", monthLabel);
    setText("balanceConfigMonthLabel", `Mês de configuração: ${monthLabel}`);
    setText("invoiceConfigMonthLabel", `Mês de configuração: ${monthLabel}`);

    const initialBalanceEl = $("initialBalance");
    if (initialBalanceEl) initialBalanceEl.value = opening.toFixed(2);

    const hasManualBalance = Object.prototype.hasOwnProperty.call(initialBalances, monthKey(selectedDate));
    setText("initialBalanceInfo",
        hasManualBalance
            ? "Este mês possui um saldo inicial definido manualmente. Para voltar ao automático, exclua esse ajuste."
            : "Preenchido automaticamente com o saldo final do mês anterior. Você pode alterar e salvar manualmente."
    );

    setText("invoiceAmount", money(invoice));
    setText("invoiceDue", formatDate(getInvoiceDueDate()));

    renderInvoiceSettings();
    renderDailyCalendar(actual, scheduled);
}

// ==========================================
// DASHBOARD — BASE
// ==========================================

function getDashRange() {
    const now = new Date();

    if (dashPeriod.customStart || dashPeriod.customEnd) {
        const start = dashPeriod.customStart
            ? parseDate(dashPeriod.customStart + "-01")
            : new Date(now.getFullYear(), now.getMonth() - 11, 1, 12);
        const endParsed = dashPeriod.customEnd ? parseDate(dashPeriod.customEnd + "-01") : null;
        const end = endParsed
            ? new Date(endParsed.getFullYear(), endParsed.getMonth() + 1, 0, 12)
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

    const incomeActual = actual.filter(x => x.type === "income").reduce((s, x) => s + x.amount, 0);
    const incomePlanned = scheduled.filter(x => x.type === "income").reduce((s, x) => s + x.amount, 0);
    const debitActual = actual.filter(x => x.type === "debit").reduce((s, x) => s + x.amount, 0);
    const debitPlanned = scheduled.filter(x => x.type === "debit").reduce((s, x) => s + x.amount, 0);

    const invoice = getInvoiceAmount(date);
    const opening = getOpeningBalance(date);
    const closing = opening + (incomeActual + incomePlanned) - (debitActual + debitPlanned + invoice);

    return { key, date, income: incomeActual + incomePlanned, debit: debitActual + debitPlanned, invoice, opening, closing };
}

// ==========================================
// FILTROS
// ==========================================

function transactionPassesFilter(amount) {
    if (chartFilters.minValue !== null && amount < chartFilters.minValue) return false;
    if (chartFilters.maxValue !== null && amount > chartFilters.maxValue) return false;
    return true;
}

function categoryPassesFilter(categoryId) {
    if (chartFilters.categoryKeys.size === 0) return true;
    return chartFilters.categoryKeys.has(categoryId);
}

function getFilteredExpenseEntries(range) {
    const entries = [];

    forEachMonthInRange(range.start, range.end, monthDate => {
        const key = monthKey(monthDate);

        if (chartFilters.types.debit && chartFilters.origins.oneTime) {
            transactions.forEach(t => {
                if (t.type !== "debit") return;
                if (!t.date.startsWith(key)) return;
                if (!transactionPassesFilter(t.amount)) return;
                const cid = normalizeCategoryId(t.categoryId, "debit");
                if (!categoryPassesFilter(cid)) return;

                entries.push({
                    monthKey: key,
                    amount: t.amount,
                    categoryId: cid,
                    categoryName: getCategoryName(cid),
                    categoryColor: getCategoryColor(cid),
                    description: t.description || "Sem descrição",
                    recurring: false
                });
            });
        }

        if (chartFilters.types.debit && chartFilters.origins.recurring) {
            getOccurrencesForMonth(monthDate).forEach(r => {
                if (r.type !== "debit") return;
                if (!transactionPassesFilter(r.amount)) return;
                const cid = normalizeCategoryId(r.categoryId, "debit");
                if (!categoryPassesFilter(cid)) return;

                entries.push({
                    monthKey: key,
                    amount: r.amount,
                    categoryId: cid,
                    categoryName: getCategoryName(cid),
                    categoryColor: getCategoryColor(cid),
                    description: r.description || "Sem descrição",
                    recurring: true
                });
            });
        }

        if (chartFilters.types.invoice && chartFilters.origins.oneTime) {
            const invoice = getInvoiceAmount(monthDate);
            if (invoice > 0 && transactionPassesFilter(invoice)) {
                if (categoryPassesFilter("invoice")) {
                    entries.push({
                        monthKey: key,
                        amount: invoice,
                        categoryId: "invoice",
                        categoryName: "Fatura do cartão",
                        categoryColor: "#1d4ed8",
                        description: "Fatura do cartão",
                        recurring: false
                    });
                }
            }
        }
    });

    return entries;
}

function aggregateByCategory(entries) {
    const map = new Map();

    entries.forEach(e => {
        const key = e.categoryId;
        if (!map.has(key)) {
            map.set(key, {
                key,
                name: e.categoryName,
                color: e.categoryColor,
                value: 0
            });
        }
        map.get(key).value += e.amount;
    });

    return Array.from(map.values()).sort((a, b) => b.value - a.value);
}

function aggregateByDescription(entries, filterCategoryKey = null) {
    const map = new Map();

    entries.forEach(e => {
        if (filterCategoryKey && e.categoryId !== filterCategoryKey) return;

        const key = e.description.trim().toLowerCase();
        if (!map.has(key)) {
            map.set(key, {
                key,
                name: e.description,
                color: e.categoryColor,
                value: 0,
                categoryKey: e.categoryId
            });
        }
        map.get(key).value += e.amount;
    });

    return Array.from(map.values()).sort((a, b) => b.value - a.value).slice(0, 5);
}

// ==========================================
// RENDER DASHBOARD
// ==========================================

function renderDashboard() {
    try {
        const range = getDashRange();

        let totalIncome = 0;
        let totalDebit = 0;
        let totalInvoice = 0;
        let lastClosing = null;

        forEachMonthInRange(range.start, range.end, m => {
            const t = computeMonthTotals(m);
            totalIncome += t.income;
            totalDebit += t.debit;
            totalInvoice += t.invoice;
            lastClosing = t.closing;
        });

        if (lastClosing === null) lastClosing = getOpeningBalance(range.start);

        const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

        setText("dashKpiIncome", money(totalIncome));
        setText("dashKpiDebit", money(totalDebit));
        setText("dashKpiInvoice", money(totalInvoice));
        setText("dashKpiBalance", money(lastClosing));

        const percent = totalIncome > 0 ? Math.min(100, Math.round((totalDebit / totalIncome) * 100)) : 0;
        setText("dashComparePercent", `${percent}%`);

        const fill = $("dashCompareFill");
        if (fill) {
            fill.style.width = `${percent}%`;
            fill.classList.remove("warn", "danger");
            if (percent >= 100) fill.classList.add("danger");
            else if (percent >= 70) fill.classList.add("warn");
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
            periodLabel.textContent = `${fmt(range.start)} → ${fmt(range.end)}`;
        }

        renderCharts(range);
        renderTopLists(range);
        renderProjection();
        updateDashShortcutButtons();
        updateFilterBadge();
    } catch (error) {
        console.error("Erro ao renderizar dashboard:", error);
    }
}

function renderProjection() {
    const container = $("projectionList");
    if (!container) return;

    container.innerHTML = "";

    const today = new Date();
    const baseDate = new Date(today.getFullYear(), today.getMonth(), 1, 12);

    for (let i = 0; i < dashProjectionMonths; i++) {
        const monthDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1, 12);
        const t = computeMonthTotals(monthDate);

        const row = document.createElement("div");
        row.className = "dash-projection-row";

        const label = monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        const nameEl = document.createElement("strong");
        nameEl.textContent = label;

        const valueEl = document.createElement("span");
        valueEl.className = "dash-projection-value";
        if (t.closing < 0) valueEl.classList.add("negative");
        valueEl.textContent = money(t.closing);

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
    renderDashboard();
}

function applyDashYear() {
    dashPeriod = { yearOnly: true };
    const customEl = $("dashCustomRange");
    if (customEl) customEl.classList.add("hidden");
    renderDashboard();
}

function applyDashCustom() {
    const customEl = $("dashCustomRange");
    if (customEl) customEl.classList.remove("hidden");

    const startEl = $("dashStart");
    const endEl = $("dashEnd");
    const now = new Date();

    if (startEl && !startEl.value) {
        const d = new Date(now.getFullYear(), now.getMonth() - 11, 1, 12);
        startEl.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    if (endEl && !endEl.value) {
        endEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }

    dashPeriod = {
        customStart: startEl ? startEl.value : null,
        customEnd: endEl ? endEl.value : null
    };

    renderDashboard();
}

safeOn("dashStart", "change", applyDashCustom);
safeOn("dashEnd", "change", applyDashCustom);

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

safeOn("dashOpenTransactionsMenu", "click", () => openTransactionsMenu());
safeOn("dashOpenRecurringMenu", "click", () => openRecurringMenu());

function bindDashShortcuts() {
    document.querySelectorAll(".dash-shortcut").forEach(btn => {
        btn.addEventListener("click", () => {
            const months = btn.getAttribute("data-months");
            const range = btn.getAttribute("data-range");

            if (months) applyDashPreset(Number(months));
            else if (range === "year") applyDashYear();
            else if (range === "custom") applyDashCustom();
        });
    });
}

// ==========================================
// FILTROS — UI
// ==========================================

function getAvailableFilterCategories() {
    const list = [];
    categories.forEach(cat => {
        if (cat.id === OUTROS_ID) return;
        const types = (cat.types || []).filter(t => t === "debit" || t === "credit");
        if (types.length === 0) return;
        list.push({ id: cat.id, name: cat.name, color: cat.color, types });
    });
    return list;
}

function renderFiltersDropdown() {
    const container = $("filterCategoriesList");
    if (!container) return;

    container.innerHTML = "";

    const list = getAvailableFilterCategories();

    if (list.length === 0) {
        const p = document.createElement("p");
        p.className = "helper";
        p.textContent = "Nenhuma categoria cadastrada ainda.";
        container.appendChild(p);
        return;
    }

    const groups = { debit: "Débito", credit: "Crédito" };

    Object.keys(groups).forEach(type => {
        const groupItems = list.filter(c => c.types.includes(type));
        if (groupItems.length === 0) return;

        const title = document.createElement("div");
        title.className = "filter-subcategory-title";
        title.textContent = groups[type];
        container.appendChild(title);

        groupItems.forEach(cat => {
            const label = document.createElement("label");
            label.className = "filter-check-item";

            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = chartFilters.categoryKeys.has(cat.id);
            input.addEventListener("change", () => {
                if (input.checked) chartFilters.categoryKeys.add(cat.id);
                else chartFilters.categoryKeys.delete(cat.id);
                renderDashboard();
            });

            const dot = document.createElement("span");
            dot.className = "filter-cat-dot";
            dot.style.background = cat.color;

            const name = document.createElement("span");
            name.textContent = cat.name;

            label.append(input, dot, name);
            container.appendChild(label);
        });
    });

    const title = document.createElement("div");
    title.className = "filter-subcategory-title";
    title.textContent = "Especial";
    container.appendChild(title);

    const invLabel = document.createElement("label");
    invLabel.className = "filter-check-item";

    const invInput = document.createElement("input");
    invInput.type = "checkbox";
    invInput.checked = chartFilters.categoryKeys.has("invoice");
    invInput.addEventListener("change", () => {
        if (invInput.checked) chartFilters.categoryKeys.add("invoice");
        else chartFilters.categoryKeys.delete("invoice");
        renderDashboard();
    });

    const invDot = document.createElement("span");
    invDot.className = "filter-cat-dot";
    invDot.style.background = "#1d4ed8";

    const invName = document.createElement("span");
    invName.textContent = "Fatura do cartão";

    invLabel.append(invInput, invDot, invName);
    container.appendChild(invLabel);
}

function updateFilterBadge() {
    const badge = $("dashFilterBadge");
    if (!badge) return;

    let count = 0;
    if (!chartFilters.types.debit) count++;
    if (!chartFilters.types.invoice) count++;
    if (!chartFilters.origins.oneTime) count++;
    if (!chartFilters.origins.recurring) count++;
    if (chartFilters.categoryKeys.size > 0) count++;
    if (chartFilters.minValue !== null) count++;
    if (chartFilters.maxValue !== null) count++;

    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
}

safeOn("filterTypeDebit", "change", () => {
    const el = $("filterTypeDebit");
    if (!el) return;
    if (!el.checked && !chartFilters.types.invoice) { el.checked = true; return; }
    chartFilters.types.debit = el.checked;
    renderDashboard();
});

safeOn("filterTypeInvoice", "change", () => {
    const el = $("filterTypeInvoice");
    if (!el) return;
    if (!el.checked && !chartFilters.types.debit) { el.checked = true; return; }
    chartFilters.types.invoice = el.checked;
    renderDashboard();
});

safeOn("filterOriginOneTime", "change", () => {
    const el = $("filterOriginOneTime");
    if (!el) return;
    if (!el.checked && !chartFilters.origins.recurring) { el.checked = true; return; }
    chartFilters.origins.oneTime = el.checked;
    renderDashboard();
});

safeOn("filterOriginRecurring", "change", () => {
    const el = $("filterOriginRecurring");
    if (!el) return;
    if (!el.checked && !chartFilters.origins.oneTime) { el.checked = true; return; }
    chartFilters.origins.recurring = el.checked;
    renderDashboard();
});

safeOn("filterMinValue", "input", () => {
    const el = $("filterMinValue");
    if (!el) return;
    const v = parseFloat(el.value.replace(",", "."));
    chartFilters.minValue = Number.isFinite(v) && v >= 0 ? v : null;
    renderDashboard();
});

safeOn("filterMaxValue", "input", () => {
    const el = $("filterMaxValue");
    if (!el) return;
    const v = parseFloat(el.value.replace(",", "."));
    chartFilters.maxValue = Number.isFinite(v) && v > 0 ? v : null;
    renderDashboard();
});

safeOn("toggleFiltersButton", "click", () => {
    filtersDropdownOpen = !filtersDropdownOpen;
    const dd = $("filtersDropdown");
    if (dd) dd.classList.toggle("hidden", !filtersDropdownOpen);
    const icon = $("toggleFiltersIcon");
    if (icon) icon.textContent = filtersDropdownOpen ? "▴" : "▾";
    if (filtersDropdownOpen) renderFiltersDropdown();
});

document.querySelectorAll("[data-cat-action]").forEach(btn => {
    btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-cat-action");
        if (action === "all") {
            getAvailableFilterCategories().forEach(c => chartFilters.categoryKeys.add(c.id));
            chartFilters.categoryKeys.add("invoice");
        } else {
            chartFilters.categoryKeys.clear();
        }
        renderFiltersDropdown();
        renderDashboard();
    });
});

safeOn("clearFiltersButton", "click", () => {
    chartFilters = {
        types: { debit: true, invoice: true },
        origins: { oneTime: true, recurring: true },
        categoryKeys: new Set(),
        minValue: null,
        maxValue: null
    };
    const minEl = $("filterMinValue"); if (minEl) minEl.value = "";
    const maxEl = $("filterMaxValue"); if (maxEl) maxEl.value = "";
    const fd = $("filterTypeDebit"); if (fd) fd.checked = true;
    const fi = $("filterTypeInvoice"); if (fi) fi.checked = true;
    const oo = $("filterOriginOneTime"); if (oo) oo.checked = true;
    const or = $("filterOriginRecurring"); if (or) or.checked = true;
    renderFiltersDropdown();
    renderDashboard();
});

// ==========================================
// CHARTS — HELPERS
// ==========================================

function getChartColors() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    return {
        text: isDark ? "#cbd5e1" : "#475569",
        grid: isDark ? "#2a3752" : "#e2e8f0",
        income: isDark ? "#4ade80" : "#16a34a",
        debit: isDark ? "#f87171" : "#dc2626",
        line: isDark ? "#60a5fa" : "#2563eb",
        lineFill: isDark ? "rgba(96, 165, 250, .18)" : "rgba(37, 99, 235, .12)",
        bg: isDark ? "#1a2438" : "#f1f5f9"
    };
}

function getTooltip() {
    if (chartTooltipEl && document.body.contains(chartTooltipEl)) return chartTooltipEl;
    const el = document.createElement("div");
    el.className = "chart-tooltip";
    document.body.appendChild(el);
    chartTooltipEl = el;
    return el;
}

function showTooltip(x, y, html) {
    const tt = getTooltip();
    tt.innerHTML = html;
    tt.classList.add("visible");

    const rect = tt.getBoundingClientRect();
    let left = x + 12;
    let top = y - rect.height - 10;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top < 8) top = y + 12;

    tt.style.left = `${left}px`;
    tt.style.top = `${top}px`;
}

function hideTooltip() {
    const tt = getTooltip();
    tt.classList.remove("visible");
}

function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(200, Math.floor(rect.width));
    const cssHeight = Math.max(120, Math.floor(rect.height));
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: cssWidth, height: cssHeight };
}

// ==========================================
// CHART — BARRAS
// ==========================================

function drawBarsChart() {
    const canvas = $("chartBars");
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const colors = getChartColors();

    ctx.clearRect(0, 0, width, height);

    const range = getDashRange();
    const months = [];
    const filteredEntries = getFilteredExpenseEntries(range);

    const filteredByMonth = new Map();
    filteredEntries.forEach(e => {
        if (!filteredByMonth.has(e.monthKey)) filteredByMonth.set(e.monthKey, 0);
        filteredByMonth.set(e.monthKey, filteredByMonth.get(e.monthKey) + e.amount);
    });

    forEachMonthInRange(range.start, range.end, m => {
        const key = monthKey(m);
        const t = computeMonthTotals(m);
        months.push({
            label: m.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
            monthDate: m,
            income: t.income,
            debit: filteredByMonth.get(key) || 0
        });
    });

    if (months.length === 0) {
        ctx.fillStyle = colors.text;
        ctx.font = "13px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Sem dados no período", width / 2, height / 2);
        chartBarsState = null;
        return;
    }

    const padL = 12;
    const padR = 12;
    const padT = 16;
    const padB = 36;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    const maxVal = Math.max(...months.map(m => Math.max(m.income, m.debit)), 1);
    const yScale = chartH / maxVal;

    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
        const y = padT + (chartH / 3) * i;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(width - padR, y);
        ctx.stroke();
    }

    const slotW = chartW / months.length;
    const gap = Math.max(2, slotW * 0.12);
    const barW = Math.max(4, (slotW - gap * 2) / 2 - 2);

    const bars = [];

    months.forEach((m, i) => {
        const slotX = padL + i * slotW;
        const baseY = padT + chartH;
        const cx = slotX + slotW / 2;

        const incH = m.income * yScale;
        const debH = m.debit * yScale;

        const incX = cx - barW - 1;
        const debX = cx + 1;

        if (incH > 0) {
            ctx.fillStyle = colors.income;
            ctx.fillRect(incX, baseY - incH, barW, incH);
            bars.push({ kind: "income", x: incX, y: baseY - incH, w: barW, h: incH, month: m });
        }
        if (debH > 0) {
            ctx.fillStyle = colors.debit;
            ctx.fillRect(debX, baseY - debH, barW, debH);
            bars.push({ kind: "debit", x: debX, y: baseY - debH, w: barW, h: debH, month: m });
        }

        const showEvery = months.length > 8 ? 2 : 1;
        if (i % showEvery === 0 || i === months.length - 1) {
            ctx.fillStyle = colors.text;
            ctx.font = "10px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(m.label, cx, baseY + 8);
        }
    });

    chartBarsState = { bars, canvas, width, height };
}

function bindBarsChart() {
    const canvas = $("chartBars");
    if (!canvas || canvas.dataset.bound === "1") return;
    canvas.dataset.bound = "1";

    function findBar(evt) {
        if (!chartBarsState) return null;
        const rect = canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        for (const b of chartBarsState.bars) {
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
        }
        return null;
    }

    canvas.addEventListener("mousemove", e => {
        const bar = findBar(e);
        if (bar) {
            const monthName = bar.month.monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
            const type = bar.kind === "income" ? "Entradas" : "Saídas";
            const val = bar.kind === "income" ? bar.month.income : bar.month.debit;
            showTooltip(e.clientX, e.clientY, `${type}: ${money(val)}<small>${monthName}</small>`);
        } else hideTooltip();
    });

    canvas.addEventListener("mouseleave", hideTooltip);

    canvas.addEventListener("click", e => {
        const bar = findBar(e);
        if (!bar) return;
        const monthName = bar.month.monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        const type = bar.kind === "income" ? "Entradas" : "Saídas";
        const val = bar.kind === "income" ? bar.month.income : bar.month.debit;
        showTooltip(e.clientX, e.clientY, `${type}: ${money(val)}<small>${monthName}</small>`);
        setTimeout(hideTooltip, 2200);
    });
}

// ==========================================
// CHART — LINHA
// ==========================================

function drawLineChart() {
    const canvas = $("chartLine");
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const colors = getChartColors();

    ctx.clearRect(0, 0, width, height);

    const range = getDashRange();
    const months = [];
    forEachMonthInRange(range.start, range.end, m => {
        const t = computeMonthTotals(m);
        months.push({
            label: m.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
            monthDate: m,
            closing: t.closing
        });
    });

    if (months.length === 0) {
        ctx.fillStyle = colors.text;
        ctx.font = "13px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Sem dados no período", width / 2, height / 2);
        chartLineState = null;
        return;
    }

    const padL = 12;
    const padR = 12;
    const padT = 16;
    const padB = 36;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    const values = months.map(m => m.closing);
    const minV = Math.min(...values, 0);
    const maxV = Math.max(...values, 0);
    const span = Math.max(1, maxV - minV);

    const xStep = months.length > 1 ? chartW / (months.length - 1) : 0;

    function yFor(v) {
        return padT + chartH - ((v - minV) / span) * chartH;
    }

    if (minV < 0 && maxV > 0) {
        const y0 = yFor(0);
        ctx.strokeStyle = colors.grid;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, y0);
        ctx.lineTo(width - padR, y0);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    ctx.strokeStyle = colors.grid;
    for (let i = 0; i <= 3; i++) {
        const y = padT + (chartH / 3) * i;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(width - padR, y);
        ctx.stroke();
    }

    const points = months.map((m, i) => ({
        x: padL + xStep * i,
        y: yFor(m.closing),
        month: m
    }));

    if (points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, padT + chartH);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, padT + chartH);
        ctx.closePath();
        ctx.fillStyle = colors.lineFill;
        ctx.fill();
    }

    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    points.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = colors.line;
        ctx.fill();
        ctx.strokeStyle = colors.bg;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    });

    const showEvery = months.length > 8 ? 2 : 1;
    months.forEach((m, i) => {
        if (i % showEvery !== 0 && i !== months.length - 1) return;
        const x = padL + xStep * i;
        ctx.fillStyle = colors.text;
        ctx.font = "10px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(m.label, x, padT + chartH + 8);
    });

    chartLineState = { points, canvas };
}

function bindLineChart() {
    const canvas = $("chartLine");
    if (!canvas || canvas.dataset.bound === "1") return;
    canvas.dataset.bound = "1";

    function findPoint(evt) {
        if (!chartLineState) return null;
        const rect = canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        for (const p of chartLineState.points) {
            const dx = x - p.x;
            const dy = y - p.y;
            if (dx * dx + dy * dy < 20 * 20) return p;
        }
        return null;
    }

    canvas.addEventListener("mousemove", e => {
        const p = findPoint(e);
        if (p) {
            const monthName = p.month.monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
            showTooltip(e.clientX, e.clientY, `Saldo: ${money(p.month.closing)}<small>${monthName}</small>`);
        } else hideTooltip();
    });

    canvas.addEventListener("mouseleave", hideTooltip);

    canvas.addEventListener("click", e => {
        const p = findPoint(e);
        if (!p) return;
        const monthName = p.month.monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        showTooltip(e.clientX, e.clientY, `Saldo: ${money(p.month.closing)}<small>${monthName}</small>`);
        setTimeout(hideTooltip, 2200);
    });
}

function renderCharts() {
    drawBarsChart();
    drawLineChart();
    bindBarsChart();
    bindLineChart();
}

// ==========================================
// TOP CATEGORIAS / DESCRIÇÕES
// ==========================================

function renderTopLists(range) {
    const entries = getFilteredExpenseEntries(range);
    const byCat = aggregateByCategory(entries).slice(0, 5);
    const byDesc = aggregateByDescription(entries, selectedCategoryKey);

    const catContainer = $("topCategoriesList");
    const descContainer = $("topDescriptionsList");
    const descTitle = $("topDescriptionsTitle");
    const clearBtn = $("clearCategoryFilter");

    if (catContainer) {
        catContainer.innerHTML = "";

        if (byCat.length === 0) {
            const p = document.createElement("p");
            p.className = "dash-top-empty";
            p.textContent = "Sem saídas no período.";
            catContainer.appendChild(p);
        } else {
            byCat.forEach(c => {
                const item = document.createElement("div");
                item.className = "dash-top-item";
                if (selectedCategoryKey === c.key) item.classList.add("selected");

                const dot = document.createElement("span");
                dot.className = "dash-top-item-dot";
                dot.style.background = c.color;

                const name = document.createElement("span");
                name.className = "dash-top-item-name";
                name.textContent = c.name;

                const value = document.createElement("span");
                value.className = "dash-top-item-value";
                value.textContent = money(c.value);

                item.append(dot, name, value);

                item.addEventListener("click", () => {
                    if (selectedCategoryKey === c.key) selectedCategoryKey = null;
                    else selectedCategoryKey = c.key;
                    renderTopLists(getDashRange());
                });

                catContainer.appendChild(item);
            });
        }
    }

    if (descContainer) {
        descContainer.innerHTML = "";

        if (byDesc.length === 0) {
            const p = document.createElement("p");
            p.className = "dash-top-empty";
            p.textContent = selectedCategoryKey
                ? "Sem descrições nessa categoria."
                : "Sem descrições no período.";
            descContainer.appendChild(p);
        } else {
            byDesc.forEach(d => {
                const item = document.createElement("div");
                item.className = "dash-top-item";
                item.style.cursor = "default";

                const dot = document.createElement("span");
                dot.className = "dash-top-item-dot";
                dot.style.background = d.color;

                const name = document.createElement("span");
                name.className = "dash-top-item-name";
                name.textContent = d.name;

                const value = document.createElement("span");
                value.className = "dash-top-item-value";
                value.textContent = money(d.value);

                item.append(dot, name, value);
                descContainer.appendChild(item);
            });
        }
    }

    if (descTitle) {
        const catName = selectedCategoryKey
            ? (aggregateByCategory(entries).find(c => c.key === selectedCategoryKey)?.name || null)
            : null;

        descTitle.textContent = catName
            ? `Top descrições — ${catName}`
            : "Top descrições";
        descTitle.classList.toggle("filtered", !!selectedCategoryKey);
    }

    if (clearBtn) {
        clearBtn.classList.toggle("hidden", !selectedCategoryKey);
    }
}

safeOn("clearCategoryFilter", "click", () => {
    selectedCategoryKey = null;
    renderTopLists(getDashRange());
});

// ==========================================
// ABAS
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

    if (view === "dashboard") renderDashboard();
    else updatePainel();
}

function refreshCurrentView() {
    if (currentView === "dashboard") renderDashboard();
    else updatePainel();
}

safeOn("tabPainel", "click", () => setActiveTab("painel"));
safeOn("tabDashboard", "click", () => setActiveTab("dashboard"));

// ==========================================
// CALENDÁRIO
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
        weekday.textContent = parseDate(date).toLocaleDateString("pt-BR", { weekday: "short" });

        dayElement.append(dayNumber, weekday);

        const incomeCell = createEditableCell(values.income, "income-cell", "income", date);
        const creditCell = createEditableCell(values.credit, "credit-cell", "credit", date);
        const debitCell = createEditableCell(debit, "debit-cell", "debit", date,
            date === invoiceDueDate && invoiceAmount > 0 ? "Inclui a fatura do cartão" : ""
        );

        const balanceCell = document.createElement("div");
        balanceCell.className = "money-cell balance-cell";
        if (runningBalance < 0) balanceCell.classList.add("negative");
        balanceCell.textContent = money(runningBalance);

        row.append(dayElement, incomeCell, creditCell, debitCell, balanceCell);
        container.appendChild(row);
    }
}

function createEditableCell(value, className, type, date, tooltip = "") {
    const cell = document.createElement("div");
    cell.className = `money-cell ${className}`;
    cell.textContent = value > 0 ? money(value) : "+";
    cell.title = tooltip || "Toque para ver e gerenciar os lançamentos";
    cell.addEventListener("click", () => openDayTransactionsModal(date, type));
    return cell;
}

function openDayTransactionsModal(date, type) {
    const modal = $("dayTransactionsModal");
    const list = $("dayTransactionsList");
    if (!modal || !list) return;

    const title = $("dayModalTitle");
    if (title) title.textContent = `Lançamentos de ${formatDate(date)}`;

    const actual = transactions.filter(item => item.date.startsWith(monthKey(selectedDate)));
    const scheduled = getMonthlyOccurrences();
    const values = getDayValues(date, actual, scheduled);

    const invoiceAmount = getInvoiceAmount();
    const invoiceDueDate = getInvoiceDueDate();
    const isInvoiceDay = date === invoiceDueDate && invoiceAmount > 0;

    const labels = { income: "Entrada", credit: "Crédito", debit: "Débito" };

    let items = [];
    if (type === "income") items = values.all.filter(x => x.type === "income");
    else if (type === "credit") items = values.all.filter(x => x.type === "credit");
    else if (type === "debit") items = values.all.filter(x => x.type === "debit");

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
            const catName = getCategoryName(item.categoryId);
            details.textContent = item.occurrenceDate
                ? `${labels[item.type]} • ${catName} • Recorrente`
                : `${labels[item.type]} • ${catName}`;

            info.append(name, details);

            const actions = document.createElement("div");
            actions.className = "item-actions";

            const value = document.createElement("span");
            value.className = "item-value " +
                (item.type === "income" ? "green" : item.type === "credit" ? "blue" : "red");
            value.textContent = `${item.type === "income" ? "+" : "-"} ${money(item.amount)}`;

            if (!item.occurrenceDate) {
                value.style.cursor = "pointer";
                value.style.textDecoration = "underline dashed";
                value.addEventListener("click", () => editTransaction(item));
            }

            actions.append(value);

            if (!item.occurrenceDate) {
                const remove = document.createElement("button");
                remove.className = "delete-button";
                remove.textContent = "✕";
                remove.addEventListener("click", () => {
                    if (item.installmentGroupId) {
                        if (!confirm("Este lançamento faz parte de uma compra parcelada. Excluir todas as parcelas?")) return;
                        transactions = transactions.filter(x => x.installmentGroupId !== item.installmentGroupId);
                    } else {
                        if (!confirm("Excluir este lançamento?")) return;
                        transactions = transactions.filter(x => x.id !== item.id);
                    }
                    saveData();
                    refreshCurrentView();
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

    const addBtn = $("addDayTransactionButton");
    if (addBtn) {
        addBtn.onclick = () => {
            closeDayModal();
            openTransactionForm(type, date);
        };
    }

    modal.classList.remove("hidden");
}

function closeDayModal() {
    const modal = $("dayTransactionsModal");
    if (modal) modal.classList.add("hidden");
}

function editTransaction(item) {
    if (item.installmentGroupId) {
        const info = item.installmentNumber && item.installmentTotal
            ? ` (parcela ${item.installmentNumber}/${item.installmentTotal})` : "";
        const novoValorStr = prompt(
            `Editar valor da parcela de "${item.description}"${info}.\n\nDigite o novo valor desta parcela:`,
            item.amount
        );
        if (novoValorStr === null) return;
        const novoValor = parseFloat(novoValorStr.replace(",", "."));
        if (!isNaN(novoValor) && novoValor > 0) {
            item.amount = Math.round(novoValor * 100) / 100;
            saveData();
            refreshCurrentView();
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
        if (index !== -1) transactions[index].amount = Math.round(novoValor * 100) / 100;
        saveData();
        refreshCurrentView();
        closeDayModal();
    } else if (novoValorStr.trim() !== "") {
        alert("Valor inválido.");
    }
}

// ==========================================
// DATALISTS
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
// FORMULÁRIOS DE LANÇAMENTO
// ==========================================

function openTransactionForm(type, date) {
    pendingTransactionType = type;
    pendingTransactionDate = date;

    const modal = $("transactionFormModal");
    if (!modal) return;

    const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
    setVal("transactionDescription", "");
    setVal("transactionAmount", "");
    setVal("transactionDate", date);
    setVal("transactionType", type);
    setVal("transactionInstallments", "1");

    const title = $("transactionFormTitle");
    if (title) title.textContent = "Novo lançamento";

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
    if (type === "credit") container.classList.remove("hidden");
    else {
        container.classList.add("hidden");
        const instEl = $("transactionInstallments");
        if (instEl) instEl.value = "1";
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
    const installments = type === "credit" ? Number($("transactionInstallments").value) : 1;
    const categoryId = normalizeCategoryId($("transactionCategory").value, type);

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
                baseDate.getFullYear(), baseDate.getMonth() + i, baseDate.getDate(), 12
            );
            const isLast = i === installments - 1;
            const amount = isLast
                ? Math.round((totalAmount - accumulated) * 100) / 100
                : installmentAmount;
            accumulated += amount;

            transactions.push({
                id: makeId(),
                description: `${description} (${i + 1}/${installments})`,
                amount, type: "credit", categoryId,
                date: localDate(installmentDate),
                installmentGroupId: groupId,
                installmentNumber: i + 1,
                installmentTotal: installments,
                originalDescription: description
            });
        }
    } else {
        transactions.push({
            id: makeId(), description,
            amount: Math.round(totalAmount * 100) / 100,
            type, categoryId, date
        });
    }

    rebuildSavedDescriptions();
    saveData();
    refreshCurrentView();
    closeTransactionForm();
});

// ==========================================
// MENU DE LANÇAMENTOS
// ==========================================

function openTransactionsMenu() {
    const modal = $("transactionsMenu");
    if (!modal) return;
    modal.classList.remove("hidden");
    const monthLabel = selectedDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
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

    const monthLabel = selectedDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const label = $("transactionsListMonthLabel");
    if (label) label.textContent = `Lançamentos de ${monthLabel}`;

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
        item.date.startsWith(monthKey(selectedDate)) && item.type === currentTransactionsType
    );

    if (monthTransactions.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-message";
        empty.textContent = "Nenhum lançamento válido para este mês.";
        container.appendChild(empty);
        return;
    }

    monthTransactions.sort((a, b) => a.date.localeCompare(b.date)).forEach(item => {
        const row = document.createElement("div");
        row.className = "planning-item";

        const info = document.createElement("div");
        info.className = "item-info";

        const name = document.createElement("strong");
        name.textContent = item.description;

        const details = document.createElement("small");
        let detailText = formatDate(item.date);
        detailText += ` • ${getCategoryName(item.categoryId)}`;
        if (item.installmentGroupId) {
            detailText += ` • Parcela ${item.installmentNumber}/${item.installmentTotal}`;
        }
        details.textContent = detailText;

        info.append(name, details);

        const actions = document.createElement("div");
        actions.className = "item-actions";

        const value = document.createElement("span");
        value.className = "item-value " +
            (item.type === "income" ? "green" : item.type === "credit" ? "blue" : "red");
        value.textContent = `${item.type === "income" ? "+" : "-"} ${money(item.amount)}`;

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
        remove.addEventListener("click", () => {
            if (item.installmentGroupId) {
                if (!confirm("Este lançamento faz parte de uma compra parcelada. Excluir todas as parcelas?")) return;
                transactions = transactions.filter(x => x.installmentGroupId !== item.installmentGroupId);
            } else {
                if (!confirm("Excluir este lançamento?")) return;
                transactions = transactions.filter(x => x.id !== item.id);
            }
            saveData();
            refreshCurrentView();
            renderTransactionsList();
        });

        actions.append(value, editBtn, remove);
        row.append(info, actions);
        container.appendChild(row);
    });
}

function openStandaloneTransactionForm() {
    const formContainer = $("transactionFormContainer");
    if (formContainer) formContainer.classList.remove("hidden");
    const form = $("standaloneTransactionForm");
    if (form) form.reset();

    const dateEl = $("standaloneDate");
    if (dateEl) dateEl.value = suggestedDateInSelectedMonth();
    const instEl = $("standaloneInstallments");
    if (instEl) instEl.value = "1";

    populateCategorySelect("standaloneCategory", currentTransactionsType, OUTROS_ID);
    updateStandaloneInstallmentVisibility();
    populateDescriptionOptions("standaloneDescription", "standaloneDescriptionList");
}

function updateStandaloneInstallmentVisibility() {
    const container = $("standaloneInstallmentContainer");
    if (!container) return;

    if (currentTransactionsType === "credit") container.classList.remove("hidden");
    else {
        container.classList.add("hidden");
        const instEl = $("standaloneInstallments");
        if (instEl) instEl.value = "1";
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
    const installments = type === "credit" ? Number($("standaloneInstallments").value) : 1;
    const categoryId = normalizeCategoryId($("standaloneCategory").value, type);

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
                baseDate.getFullYear(), baseDate.getMonth() + i, baseDate.getDate(), 12
            );
            const isLast = i === installments - 1;
            const amount = isLast
                ? Math.round((totalAmount - accumulated) * 100) / 100
                : installmentAmount;
            accumulated += amount;

            transactions.push({
                id: makeId(),
                description: `${description} (${i + 1}/${installments})`,
                amount, type: "credit", categoryId,
                date: localDate(installmentDate),
                installmentGroupId: groupId,
                installmentNumber: i + 1,
                installmentTotal: installments,
                originalDescription: description
            });
        }
    } else {
        transactions.push({
            id: makeId(), description,
            amount: Math.round(totalAmount * 100) / 100,
            type, categoryId, date
        });
    }

    rebuildSavedDescriptions();
    saveData();
    refreshCurrentView();

    const form = $("standaloneTransactionForm");
    if (form) form.reset();
    const formContainer = $("transactionFormContainer");
    if (formContainer) formContainer.classList.add("hidden");
    renderTransactionsList();
});

// ==========================================
// RECORRENTES
// ==========================================

function openRecurringMenu() {
    const modal = $("recurringMenu");
    if (!modal) return;
    modal.classList.remove("hidden");
    const monthLabel = selectedDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
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

    const monthLabel = selectedDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const label = $("recurringListMonthLabel");
    if (label) label.textContent = `Válidos em ${monthLabel}`;

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
        item.type === currentRecurringType && recurringIsActiveInMonth(item, selectedDate)
    );

    if (activeItems.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-message";
        empty.textContent = "Nenhum lançamento recorrente válido para este mês.";
        container.appendChild(empty);
        return;
    }

    activeItems.sort((a, b) => a.description.localeCompare(b.description))
        .forEach(item => container.appendChild(buildRecurringRow(item)));
}

function buildRecurringRow(item) {
    const row = document.createElement("div");
    row.className = "planning-item";

    const info = document.createElement("div");
    info.className = "item-info";

    const name = document.createElement("strong");
    name.textContent = item.description;

    const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12);
    const version = getVersionForDate(item, monthStart) || item.versions[item.versions.length - 1];
    const activeResult = recurringIsActiveInMonth(item, selectedDate);
    const displayAmount = activeResult ? activeResult.amount : version.amount;

    const details = document.createElement("small");
    const end = version.endDate ? `até ${formatDate(version.endDate)}` : "sem data fim";
    details.textContent = `${getCategoryName(item.categoryId)} • Início ${formatDate(version.startDate)} • ${end}`;

    info.append(name, details);

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const value = document.createElement("span");
    value.className = "item-value " +
        (item.type === "income" ? "green" : item.type === "credit" ? "blue" : "red");
    value.textContent = `${item.type === "income" ? "+" : "-"} ${money(displayAmount)}`;

    const editBtn = document.createElement("button");
    editBtn.className = "outline-button";
    editBtn.textContent = "Editar";
    editBtn.addEventListener("click", () => openRecurringEditModal(item));

    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.textContent = "✕";
    remove.addEventListener("click", () => {
        if (!confirm(`Excluir o lançamento recorrente "${item.description}"?`)) return;
        recurring = recurring.filter(x => x.id !== item.id);
        saveData();
        refreshCurrentView();
        renderRecurringList();
    });

    actions.append(value, editBtn, remove);
    row.append(info, actions);
    return row;
}

function openRecurringEditModal(item) {
    editingRecurringId = item.id;

    const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12);
    const currentVersion = getVersionForDate(item, monthStart) || item.versions[item.versions.length - 1];
    const overrideKey = getOverrideKey(item.id, selectedDate);
    const hasOverride = recurringMonthOverrides[overrideKey] !== undefined;
    const currentAmount = hasOverride ? recurringMonthOverrides[overrideKey] : currentVersion.amount;

    const monthLabel = selectedDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
    setVal("recurringEditDescription", item.description);
    setVal("recurringEditAmount", currentAmount);

    const monthEl = $("recurringEditCurrentMonthLabel");
    if (monthEl) monthEl.textContent = `Mês de edição: ${monthLabel}`;

    populateCategorySelect("recurringEditCategory", item.type, item.categoryId);

    const explEl = $("recurringEditExplanation");
    if (explEl) {
        explEl.textContent =
            `Valor base atual da recorrência: ${money(currentVersion.amount)}. ` +
            `Se marcar a opção abaixo, o novo valor será aplicado somente em ${monthLabel}. ` +
            `Caso contrário, passará a valer de ${monthLabel} em diante.`;
    }

    const onlyEl = $("recurringEditOnlyThisMonth");
    if (onlyEl) onlyEl.checked = hasOverride;

    const resetEl = $("recurringEditResetContainer");
    if (resetEl) resetEl.classList.toggle("hidden", !hasOverride);

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
    refreshCurrentView();
    renderRecurringList();
    closeRecurringEditModal();
});

safeOn("recurringEditForm", "submit", event => {
    event.preventDefault();
    if (!editingRecurringId) return;

    const item = recurring.find(x => x.id === editingRecurringId);
    if (!item) { closeRecurringEditModal(); return; }

    const description = $("recurringEditDescription").value.trim();
    const amountValue = Number($("recurringEditAmount").value);
    const categoryId = normalizeCategoryId($("recurringEditCategory").value, item.type);

    if (!description || !Number.isFinite(amountValue) || amountValue <= 0) {
        alert("Preencha os dados corretamente.");
        return;
    }

    const roundedValue = Math.round(amountValue * 100) / 100;
    const onlyThisMonth = $("recurringEditOnlyThisMonth").checked;

    const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12);
    const currentVersion = getVersionForDate(item, monthStart) || item.versions[item.versions.length - 1];

    item.description = description;
    item.categoryId = categoryId;
    registerDescription(description);

    if (onlyThisMonth) {
        const overrideKey = getOverrideKey(item.id, selectedDate);
        if (roundedValue === currentVersion.amount) delete recurringMonthOverrides[overrideKey];
        else recurringMonthOverrides[overrideKey] = roundedValue;
    } else {
        const changeMonthStartStr = localDate(monthStart);
        const previousMonthEndStr = localDate(new Date(monthStart.getFullYear(), monthStart.getMonth(), 0, 12));
        const sorted = [...item.versions].sort((a, b) => a.startDate.localeCompare(b.startDate));

        const affectedVersion = sorted.find(v => {
            const vStart = v.startDate;
            const vEnd = v.endDate || "9999-12-31";
            return changeMonthStartStr >= vStart && changeMonthStartStr <= vEnd;
        });

        if (affectedVersion) {
            if (roundedValue !== affectedVersion.amount) {
                const wasOpen = !affectedVersion.endDate;
                const originalEnd = affectedVersion.endDate;
                affectedVersion.endDate = previousMonthEndStr;
                item.versions.push({
                    amount: roundedValue,
                    startDate: changeMonthStartStr,
                    endDate: wasOpen ? null : originalEnd
                });
                item.versions.sort((a, b) => a.startDate.localeCompare(b.startDate));
            }
        } else {
            item.versions.push({ amount: roundedValue, startDate: changeMonthStartStr, endDate: null });
            item.versions.sort((a, b) => a.startDate.localeCompare(b.startDate));
        }
    }

    rebuildSavedDescriptions();
    saveData();
    refreshCurrentView();
    renderRecurringList();
    closeRecurringEditModal();
});

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
    const categoryId = normalizeCategoryId($("recurringCategory").value, currentRecurringType);

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
        versions: [{ amount: Math.round(amount * 100) / 100, startDate, endDate: null }]
    });

    rebuildSavedDescriptions();
    saveData();
    refreshCurrentView();

    const form = $("recurringForm");
    if (form) form.reset();
    const startEl = $("recurringStart");
    if (startEl) startEl.value = suggestedDateInSelectedMonth();

    const formContainer = $("recurringFormContainer");
    if (formContainer) formContainer.classList.add("hidden");
    renderRecurringList();
});

safeOn("openTransactionsMenu", "click", openTransactionsMenu);
safeOn("closeTransactionsMenu", "click", closeTransactionsMenu);
safeOn("openIncomeTransactions", "click", () => openTransactionsList("income"));
safeOn("openCreditTransactions", "click", () => openTransactionsList("credit"));
safeOn("openDebitTransactions", "click", () => openTransactionsList("debit"));
safeOn("openTransactionForm", "click", openStandaloneTransactionForm);
safeOn("closeTransactionsListModal", "click", closeTransactionsListModal);

safeOn("transactionsListModal", "click", event => {
    if (event.target === $("transactionsListModal")) closeTransactionsListModal();
});

safeOn("transactionsMenu", "click", event => {
    if (event.target === $("transactionsMenu")) closeTransactionsMenu();
});

// ==========================================
// NAVEGAÇÃO DE MESES
// ==========================================

function navigateMonth(offset) {
    selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + offset, 1, 12);
    updatePainel();
}

safeOn("prevMonth", "click", () => navigateMonth(-1));
safeOn("nextMonth", "click", () => navigateMonth(1));

safeOn("goToCurrentMonth", "click", () => {
    const now = new Date();
    selectedDate = new Date(now.getFullYear(), now.getMonth(), 1, 12);
    updatePainel();
});

// ==========================================
// SWIPE
// ==========================================

let touchStartX = 0, touchStartY = 0, touchTracking = false;

function isInteractiveTarget(target) {
    if (!target) return false;
    return !!target.closest(
        "input, select, textarea, button, label, a, .money-cell, .delete-button, .outline-button, .checkbox-option, .modal-card, .month-selector, .app-tabs, .category-row, .dash-sticky, canvas, .chart-wrapper, .dash-top-item, .filter-check-item, .filter-mini-btn"
    );
}

const swipeArea = $("mainContent");
if (swipeArea) {
    swipeArea.addEventListener("touchstart", e => {
        if (e.touches.length !== 1) { touchTracking = false; return; }
        if (isInteractiveTarget(e.target)) { touchTracking = false; return; }
        touchTracking = true;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    swipeArea.addEventListener("touchend", e => {
        if (!touchTracking) return;
        touchTracking = false;
        const touch = e.changedTouches[0];
        if (!touch) return;

        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        const ax = Math.abs(dx), ay = Math.abs(dy);

        if (ax < 60 || ax < ay * 1.4) return;
        if (currentView !== "painel") return;

        if (dx < 0) navigateMonth(1);
        else navigateMonth(-1);
    }, { passive: true });
}

// ==========================================
// EXPANDIR SEÇÕES
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

safeOn("toggleCalendarButton", "click", () => setCalendarSectionOpen(!calendarSectionOpen));
safeOn("toggleBackupButton", "click", () => setBackupSectionOpen(!backupSectionOpen));

// ==========================================
// EXCLUSÃO
// ==========================================

let deleteScope = "all";

function openDeleteOptions(scope) {
    deleteScope = scope;
    const modal = $("deleteOptionsModal");
    if (!modal) return;

    const monthName = selectedDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    const titleEl = $("deleteModalTitle");
    if (titleEl) {
        titleEl.textContent = scope === "all" ? "Apagar todos os registros" : "Apagar registros do mês";
    }

    const descEl = $("deleteModalDescription");
    if (descEl) {
        descEl.textContent = scope === "all"
            ? "Escolha o que deseja apagar em todo o aplicativo. Esta ação não pode ser desfeita. No modo completo, as categorias personalizadas também serão removidas."
            : `Escolha o que deseja apagar de ${monthName}. Os lançamentos recorrentes continuarão cadastrados. As categorias são preservadas. Esta ação não pode ser desfeita.`;
    }

    const oneEl = $("deleteOneTimeCheckbox");
    if (oneEl) oneEl.checked = true;
    const recEl = $("deleteRecurringCheckbox");
    if (recEl) recEl.checked = true;

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
        if (deleteRecurring) { recurring = []; recurringMonthOverrides = {}; }
        if (deleteOneTime && deleteRecurring) {
            initialBalances = {};
            invoiceSettings = {};
            savedDescriptions = [];

            // Apaga categorias personalizadas — mantém apenas "Outros"
            categories = [];
            ensureOthersCategory();
            nextCategoryColorIndex = 0;
            chartFilters.categoryKeys.clear();
            selectedCategoryKey = null;
        }
        const msg = $("backupMessage");
        if (msg) msg.textContent = "";
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
                const firstVersion = [...item.versions].sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
                const lastVersionEnd = [...item.versions].map(v => v.endDate || "9999-12-31").sort().pop();
                const mStart = `${monthPrefix}01`;
                const mEnd = `${monthPrefix}31`;
                return lastVersionEnd < mStart || firstVersion.startDate > mEnd;
            });

            Object.keys(recurringMonthOverrides).forEach(k => {
                if (k.split("|")[1] === key) delete recurringMonthOverrides[k];
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
    refreshCurrentView();
    alert(deleteScope === "all" ? "A exclusão selecionada foi concluída." : "Os registros selecionados deste mês foram apagados.");
}

safeOn("resetAppButton", "click", () => openDeleteOptions("all"));
safeOn("resetMonthButton", "click", () => openDeleteOptions("month"));
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

safeOn("saveInitialBalance", "click", saveInitialBalance);
safeOn("saveInvoiceSettings", "click", saveInvoiceConfig);

safeOn("openBalanceConfig", "click", () => {
    updatePainel();
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
    updatePainel();
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
// BACKUP
// ==========================================

safeOn("exportButton", "click", () => {
    const backup = {
        application: "Meu Financeiro",
        version: 19,
        exportedAt: new Date().toISOString(),
        ...getDataSnapshot(),
        recurring
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
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

safeOn("importFile", "change", async event => {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.transactions)) throw new Error("Arquivo inválido.");
        if (!confirm("A importação substituirá os dados atuais. Deseja continuar?")) return;

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
        refreshCurrentView();

        const msg = $("backupMessage");
        if (msg) msg.textContent = "Backup importado com sucesso!";
    } catch (error) {
        alert("Não foi possível importar. Verifique o arquivo JSON.");
    }
    event.target.value = "";
});

safeOn("googleLoginButton", "click", loginGoogle);
safeOn("googleLogoutButton", "click", logoutGoogle);
safeOn("syncNowButton", "click", async () => {
    await saveToDrive();
    await loadFromDrive();
});

// ==========================================
// TEMA
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
        if (meta) meta.setAttribute("content", theme === "dark" ? "#060b14" : "#101827");
    }

    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved === "dark" || saved === "light" ? saved : getSystemTheme());

    safeOn("themeToggle", "click", () => {
        const current = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
        const next = current === "dark" ? "light" : "dark";
        applyTheme(next);
        localStorage.setItem(THEME_KEY, next);
        if (currentView === "dashboard") renderDashboard();
    });

    if (window.matchMedia) {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
            if (!localStorage.getItem(THEME_KEY)) {
                applyTheme(e.matches ? "dark" : "light");
                if (currentView === "dashboard") renderDashboard();
            }
        });
    }
})();

// ==========================================
// REDRAW EM RESIZE
// ==========================================

let resizeTimer = null;
window.addEventListener("resize", () => {
    if (currentView !== "dashboard") return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (currentView === "dashboard") renderDashboard();
    }, 150);
});

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

bindDashShortcuts();
renderFiltersDropdown();
updateFilterBadge();

updatePainel();
renderDashboard();
updateCloudButtons();
setCalendarSectionOpen(false);
setBackupSectionOpen(false);
setActiveTab("painel");
initGoogleAuth();
