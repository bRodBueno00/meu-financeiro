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

let pendingTransactionType = null;
let pendingTransactionDate = null;

const $ = id => document.getElementById(id);

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

// ==========================================
// PERSISTÊNCIA LOCAL + DRIVE
// ==========================================

function getDataSnapshot() {
    return {
        version: 7,
        transactions,
        initialBalances,
        invoiceSettings
    };
}

function getRecurringSnapshot() {
    return {
        version: 2,
        recurring
    };
}

function applyDataSnapshot(data) {
    transactions = (data.transactions || []).map(item => ({
        ...item,
        type: item.type === "expense" ? "debit" : item.type
    }));

    initialBalances = data.initialBalances || {};
    invoiceSettings = data.invoiceSettings || {};

    if (Array.isArray(data.recurring)) {
        recurring = data.recurring.map(item => ({
            ...item,
            type: item.type === "expense" ? "debit" : item.type
        }));
    } else if (Array.isArray(data.plans)) {
        recurring = data.plans.map(plan => ({
            id: plan.id || makeId(),
            description: plan.description,
            amount: plan.amount,
            type: plan.type === "expense" ? "debit" : plan.type,
            startDate: plan.date,
            endDate: plan.repeat === "once" ? plan.date : null,
            hasEndDate: plan.repeat === "once",
            dayOfMonth: parseDate(plan.date).getDate(),
            frequency: plan.repeat === "yearly" ? "yearly" : "monthly"
        }));
    }
}

function applyRecurringSnapshot(data) {
    if (data && Array.isArray(data.recurring)) {
        recurring = data.recurring.map(item => ({
            ...item,
            type: item.type === "expense" ? "debit" : item.type
        }));
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

        if (!saved) return;

        const data = JSON.parse(saved);

        if (Array.isArray(data)) {
            transactions = data.map(item => ({
                ...item,
                type: item.type === "expense" ? "debit" : item.type
            }));
            return;
        }

        applyDataSnapshot(data);

        if (Array.isArray(data.recurring)) {
            recurring = data.recurring.map(item => ({
                ...item,
                type: item.type === "expense" ? "debit" : item.type
            }));
        }

    } catch (error) {
        alert("Erro ao carregar os dados salvos.");
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
    $("googleLoginButton").classList.toggle("hidden", logged);
    $("googleLogoutButton").classList.toggle("hidden", !logged);
    $("syncNowButton").classList.toggle("hidden", !logged);
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

    restoreToken();
}

function restoreToken() {
    try {
        const raw = localStorage.getItem("meuFinanceiroToken");
        if (!raw) return;

        const data = JSON.parse(raw);

        if (data.expiresAt && data.expiresAt > Date.now() + 60000) {
            accessToken = data.token;
            setCloudStatus("Drive: conectado");
            updateCloudButtons();
            loadFromDrive();
        } else {
            localStorage.removeItem("meuFinanceiroToken");
        }
    } catch (e) {
        // ignora
    }
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

        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            ...getDataSnapshot(),
            recurring
        }));

        setCloudStatus("Drive: dados carregados");
        updateDashboard();
    } catch (error) {
        setCloudStatus("Drive: erro ao carregar");
        console.error(error);
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

function recurringIsActiveInMonth(item, date) {
    const year = date.getFullYear();
    const month = date.getMonth();

    const start = parseDate(item.startDate);

    if (item.frequency === "yearly") {
        if (year < start.getFullYear()) return null;
        if (month !== start.getMonth()) return null;

        const last = new Date(year, month + 1, 0, 12);
        const day = Math.min(item.dayOfMonth || start.getDate(), last.getDate());
        const occurrence = localDate(new Date(year, month, day, 12));

        if (occurrence < item.startDate) return null;
        if (item.endDate && occurrence > item.endDate) return null;

        return occurrence;
    }

    const first = new Date(year, month, 1, 12);
    if (first < new Date(start.getFullYear(), start.getMonth(), 1, 12)) {
        return null;
    }

    const last = new Date(year, month + 1, 0, 12);
    const day = Math.min(item.dayOfMonth || start.getDate(), last.getDate());
    const occurrence = localDate(new Date(year, month, day, 12));

    if (occurrence < item.startDate) return null;
    if (item.endDate && occurrence > item.endDate) return null;

    return occurrence;
}

function getOccurrencesForMonth(date) {
    const occurrences = [];

    recurring.forEach(item => {
        const occurrence = recurringIsActiveInMonth(item, date);
        if (occurrence) {
            occurrences.push({ ...item, occurrenceDate: occurrence });
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

function getInvoiceMonth(transaction) {
    const purchase = parseDate(transaction.date);
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

function getInvoiceAmount(date = selectedDate) {
    const key = monthKey(date);

    return transactions
        .filter(item =>
            item.type === "credit" && getInvoiceMonth(item) === key
        )
        .reduce((sum, item) => sum + item.amount, 0);
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

    const credit = dayActual
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

    const creditActual = actual
        .filter(x => x.type === "credit")
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

    $("balance").textContent = money(closing);
    $("totalIncome").textContent = money(totalIncome);
    $("totalExpenses").textContent = money(totalExpenses);

    $("received").textContent = money(incomeActual);
    $("creditTotal").textContent = money(creditActual);
    $("debitTotal").textContent = money(debitActual);

    $("todayBalance").textContent = money(getTodayBalance());

    $("currentMonth").textContent =
        selectedDate.toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric"
        });

    $("initialBalance").value = opening.toFixed(2);

    const hasManualBalance = Object.prototype.hasOwnProperty.call(
        initialBalances,
        monthKey(selectedDate)
    );

    $("initialBalanceInfo").textContent = hasManualBalance
        ? "Este mês possui um saldo inicial definido manualmente. Para voltar ao automático, exclua esse ajuste."
        : "Preenchido automaticamente com o saldo final do mês anterior. Você pode alterar e salvar manualmente.";

    $("invoiceAmount").textContent = money(invoice);
    $("invoiceDue").textContent = formatDate(getInvoiceDueDate());

    renderInvoiceSettings();
    renderDailyCalendar(actual, scheduled);
    renderTransactions(actual);
}

// ==========================================
// CALENDÁRIO FINANCEIRO
// ==========================================

function renderDailyCalendar(actual, scheduled) {
    const container = $("dailyList");
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

        const top = document.createElement("div");
        top.className = "day-top";

        const dayNumber = document.createElement("span");
        dayNumber.textContent = String(day).padStart(2, "0");

        const deleteDay = document.createElement("button");
        deleteDay.className = "delete-day-button";
        deleteDay.textContent = "✕";
        deleteDay.title = "Excluir lançamentos manuais deste dia";
        deleteDay.setAttribute(
            "aria-label",
            `Excluir lançamentos manuais do dia ${day}`
        );

        deleteDay.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteDayTransactions(date);
        });

        top.append(dayNumber, deleteDay);

        const weekday = document.createElement("small");
        weekday.textContent = parseDate(date).toLocaleDateString(
            "pt-BR",
            { weekday: "short" }
        );

        dayElement.append(top, weekday);

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
// EXCLUIR LANÇAMENTOS MANUAIS DO DIA
// ==========================================

function deleteDayTransactions(date) {
    const dayTransactions = transactions.filter(item => item.date === date);

    if (dayTransactions.length === 0) {
        alert("Não existem lançamentos manuais neste dia.");
        return;
    }

    const count = dayTransactions.length;

    const confirmed = confirm(
        `Deseja excluir os ${count} lançamento(s) manual(is) do dia ${formatDate(date)}?`
    );

    if (!confirmed) return;

    transactions = transactions.filter(item => item.date !== date);

    saveData();
    updateDashboard();
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
        items = actual.filter(x => x.type === "credit" && x.date === date);
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
            details.textContent = item.occurrenceDate
                ? `${labels[item.type]} • Recorrente`
                : labels[item.type];

            info.append(name, details);

            const actions = document.createElement("div");
            actions.className = "item-actions";

            const value = document.createElement("span");
            value.className = "item-value " +
                (item.type === "income" ? "green" :
                 item.type === "credit" ? "blue" : "red");

            value.textContent =
                `${item.type === "income" ? "+" : "-"} ${money(item.amount)}`;

            value.addEventListener("click", () => {
                if (item.occurrenceDate) {
                    openRecurringMenu();
                } else {
                    editTransaction(item);
                }
            });

            const remove = document.createElement("button");
            remove.className = "delete-button";
            remove.textContent = "✕";
            remove.title = "Excluir lançamento";

            remove.addEventListener("click", () => {
                if (item.occurrenceDate) {
                    if (!confirm(`Este é um lançamento recorrente. Excluir a série inteira "${item.description}"?`)) return;
                    recurring = recurring.filter(x => x.id !== item.id);
                } else if (item.installmentGroupId) {
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

            actions.append(value, remove);
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
    $("dayTransactionsModal").classList.add("hidden");
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
// FORMULÁRIO DE NOVO LANÇAMENTO
// ==========================================

function openTransactionForm(type, date) {
    pendingTransactionType = type;
    pendingTransactionDate = date;

    const modal = $("transactionFormModal");

    $("transactionFormTitle").textContent = "Novo lançamento";
    $("transactionDescription").value = "";
    $("transactionAmount").value = "";
    $("transactionDate").value = date;
    $("transactionType").value = type;
    $("transactionInstallments").value = "1";

    updateInstallmentVisibility();

    modal.classList.remove("hidden");
}

function closeTransactionForm() {
    $("transactionFormModal").classList.add("hidden");
    $("transactionForm").reset();
    pendingTransactionType = null;
    pendingTransactionDate = null;
}

function updateInstallmentVisibility() {
    const type = $("transactionType").value;
    const container = $("installmentContainer");

    if (type === "credit") {
        container.classList.remove("hidden");
    } else {
        container.classList.add("hidden");
        $("transactionInstallments").value = "1";
    }
}

$("transactionType").addEventListener("change", updateInstallmentVisibility);
$("closeTransactionForm").addEventListener("click", closeTransactionForm);

$("transactionForm").addEventListener("submit", event => {
    event.preventDefault();

    const description = $("transactionDescription").value.trim();
    const totalAmount = Number($("transactionAmount").value);
    const type = $("transactionType").value;
    const date = $("transactionDate").value;
    const installments = type === "credit"
        ? Number($("transactionInstallments").value)
        : 1;

    if (!description || !Number.isFinite(totalAmount) || totalAmount <= 0 || !date) {
        alert("Preencha os dados corretamente.");
        return;
    }

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
            date
        });
    }

    saveData();
    updateDashboard();
    closeTransactionForm();
});

// ==========================================
// HISTÓRICO DE LANÇAMENTOS
// ==========================================

function renderTransactions(items) {
    const container = $("transactionList");
    container.innerHTML = "";

    $("transactionCount").textContent = `${items.length} registros`;
    $("emptyMessage").style.display = items.length ? "none" : "block";

    const labels = {
        income: "Entrada",
        credit: "Crédito",
        debit: "Débito"
    };

    [...items]
        .sort((a, b) => b.date.localeCompare(a.date))
        .forEach(item => {
            const row = document.createElement("div");
            row.className = "transaction";

            const info = document.createElement("div");
            info.className = "transaction-info";

            const name = document.createElement("strong");
            name.textContent = item.description;

            const details = document.createElement("small");
            let detailText = `${formatDate(item.date)} • ${labels[item.type]}`;
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

            value.style.cursor = "pointer";
            value.style.textDecoration = "underline dashed";
            value.title = "Clique para editar o valor";

            value.textContent =
                `${item.type === "income" ? "+" : "-"} ${money(item.amount)}`;

            value.addEventListener("click", () => {
                editTransaction(item);
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
            });

            actions.append(value, remove);
            row.append(info, actions);
            container.appendChild(row);
        });
}

// ==========================================
// MENU DE LANÇAMENTOS RECORRENTES
// ==========================================

function openRecurringMenu() {
    $("recurringMenu").classList.remove("hidden");
    $("recurringFormContainer").classList.add("hidden");
    renderRecurringList();
}

function closeRecurringMenu() {
    $("recurringMenu").classList.add("hidden");
}

function renderRecurringList() {
    const incomesContainer = $("recurringIncomeList");
    const expensesContainer = $("recurringExpenseList");

    incomesContainer.innerHTML = "";
    expensesContainer.innerHTML = "";

    const incomes = recurring.filter(item => item.type === "income");
    const expenses = recurring.filter(item => item.type !== "income");

    if (incomes.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-message";
        empty.textContent = "Nenhuma entrada recorrente cadastrada.";
        incomesContainer.appendChild(empty);
    } else {
        incomes.forEach(item => {
            incomesContainer.appendChild(buildRecurringRow(item));
        });
    }

    if (expenses.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-message";
        empty.textContent = "Nenhuma saída recorrente cadastrada.";
        expensesContainer.appendChild(empty);
    } else {
        expenses.forEach(item => {
            expensesContainer.appendChild(buildRecurringRow(item));
        });
    }
}

function buildRecurringRow(item) {
    const row = document.createElement("div");
    row.className = "planning-item";

    const info = document.createElement("div");
    info.className = "item-info";

    const name = document.createElement("strong");
    name.textContent = item.description;

    const details = document.createElement("small");
    const end = item.endDate
        ? `até ${formatDate(item.endDate)}`
        : "sem data fim";
    details.textContent = `Início ${formatDate(item.startDate)} • ${end}`;

    info.append(name, details);

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const value = document.createElement("span");
    value.className = "item-value " +
        (item.type === "income" ? "green" : "red");
    value.textContent =
        `${item.type === "income" ? "+" : "-"} ${money(item.amount)}`;

    const editBtn = document.createElement("button");
    editBtn.className = "outline-button";
    editBtn.textContent = "Editar";
    editBtn.addEventListener("click", () => {
        editRecurringFromMenu(item);
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

function editRecurringFromMenu(item) {
    const descricao = prompt("Descrição:", item.description);
    if (descricao === null) return;

    if (!descricao.trim()) {
        alert("Descrição não pode ficar em branco.");
        return;
    }

    const valorStr = prompt(
        `Valor (R$). Atual: ${money(item.amount)}\n\n` +
        `Se você alterar o valor, o valor anterior será encerrado no mês anterior ao atual, ` +
        `e o novo valor passará a valer a partir do mês atual.`,
        item.amount
    );
    if (valorStr === null) return;

    const valor = parseFloat(valorStr.replace(",", "."));
    if (isNaN(valor) || valor <= 0) {
        alert("Valor inválido.");
        return;
    }

    const inicioStr = prompt("Data início (AAAA-MM-DD):", item.startDate);
    if (inicioStr === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicioStr)) {
        alert("Data início inválida.");
        return;
    }

    const temFim = confirm(
        "Este lançamento tem data fim?\n\nOK = Sim (informar data fim)\nCancelar = Não (sem data fim)"
    );

    let fim = null;

    if (temFim) {
        const fimStr = prompt("Data fim (AAAA-MM-DD):", item.endDate || "");
        if (fimStr === null) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fimStr)) {
            alert("Data fim inválida.");
            return;
        }
        fim = fimStr;
    }

    const roundedValue = Math.round(valor * 100) / 100;
    const description = descricao.trim();
    const valueChanged = roundedValue !== item.amount;
    const startChanged = inicioStr !== item.startDate;
    const endChanged = (fim || null) !== (item.endDate || null);

    if (valueChanged && !startChanged) {
        const currentMonth = new Date();
        const currentMonthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1, 12);
        const currentMonthStartStr = localDate(currentMonthStart);

        const previousMonthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 0, 12);
        const previousMonthEndStr = localDate(previousMonthEnd);

        const originalStart = parseDate(item.startDate);

        if (originalStart < currentMonthStart) {
            const oldRecord = {
                ...item,
                id: makeId(),
                description: description,
                endDate: previousMonthEndStr,
                hasEndDate: true
            };

            const newRecord = {
                ...item,
                id: makeId(),
                description: description,
                amount: roundedValue,
                startDate: currentMonthStartStr,
                endDate: fim,
                hasEndDate: temFim,
                dayOfMonth: parseDate(currentMonthStartStr).getDate()
            };

            recurring = recurring.filter(x => x.id !== item.id);
            recurring.push(oldRecord, newRecord);
        } else {
            const index = recurring.findIndex(x => x.id === item.id);
            if (index !== -1) {
                recurring[index] = {
                    ...recurring[index],
                    description: description,
                    amount: roundedValue,
                    startDate: inicioStr,
                    endDate: fim,
                    hasEndDate: temFim,
                    dayOfMonth: parseDate(inicioStr).getDate()
                };
            }
        }
    } else {
        const index = recurring.findIndex(x => x.id === item.id);
        if (index !== -1) {
            recurring[index] = {
                ...recurring[index],
                description: description,
                amount: roundedValue,
                startDate: inicioStr,
                endDate: fim,
                hasEndDate: temFim,
                dayOfMonth: parseDate(inicioStr).getDate()
            };
        }
    }

    saveData();
    updateDashboard();
    renderRecurringList();
}

// ==========================================
// FORMULÁRIO DE NOVO RECORRENTE
// ==========================================

$("openRecurringMenu").addEventListener("click", openRecurringMenu);
$("closeRecurringMenu").addEventListener("click", closeRecurringMenu);
$("openRecurringForm").addEventListener("click", () => {
    $("recurringFormContainer").classList.remove("hidden");
    $("recurringForm").reset();
    $("recurringStart").value = localDate(new Date());
    $("recurringHasEnd").checked = false;
    $("recurringEndContainer").classList.add("hidden");
});

$("closeRecurringForm").addEventListener("click", () => {
    $("recurringFormContainer").classList.add("hidden");
});

$("recurringHasEnd").addEventListener("change", () => {
    if ($("recurringHasEnd").checked) {
        $("recurringEndContainer").classList.remove("hidden");
    } else {
        $("recurringEndContainer").classList.add("hidden");
        $("recurringEnd").value = "";
    }
});

$("recurringForm").addEventListener("submit", event => {
    event.preventDefault();

    const description = $("recurringDescription").value.trim();
    const amount = Number($("recurringAmount").value);
    const type = $("recurringType").value;
    const startDate = $("recurringStart").value;
    const hasEnd = $("recurringHasEnd").checked;
    const endDate = hasEnd ? $("recurringEnd").value : null;
    const frequency = $("recurringFrequency").value;

    if (!description || !Number.isFinite(amount) || amount <= 0 || !startDate) {
        alert("Preencha os dados corretamente.");
        return;
    }

    if (hasEnd && !endDate) {
        alert("Informe a data fim.");
        return;
    }

    if (hasEnd && endDate < startDate) {
        alert("A data fim deve ser maior ou igual à data início.");
        return;
    }

    recurring.push({
        id: makeId(),
        description,
        amount: Math.round(amount * 100) / 100,
        type,
        startDate,
        endDate,
        hasEndDate: hasEnd,
        dayOfMonth: parseDate(startDate).getDate(),
        frequency
    });

    saveData();
    updateDashboard();

    $("recurringForm").reset();
    $("recurringStart").value = localDate(new Date());
    $("recurringHasEnd").checked = false;
    $("recurringEndContainer").classList.add("hidden");
    $("recurringFormContainer").classList.add("hidden");
    renderRecurringList();
});

// ==========================================
// NAVEGAÇÃO ENTRE MESES
// ==========================================

$("prevMonth").addEventListener("click", () => {
    selectedDate = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth() - 1,
        1,
        12
    );
    updateDashboard();
});

$("nextMonth").addEventListener("click", () => {
    selectedDate = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth() + 1,
        1,
        12
    );
    updateDashboard();
});

$("goToCurrentMonth").addEventListener("click", () => {
    const now = new Date();
    selectedDate = new Date(now.getFullYear(), now.getMonth(), 1, 12);
    updateDashboard();
});

// ==========================================
// EXCLUSÃO SELETIVA DE LANÇAMENTOS
// ==========================================

let deleteScope = "all";

function openDeleteOptions(scope) {
    deleteScope = scope;

    const modal = $("deleteOptionsModal");

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
    $("deleteOptionsModal").classList.add("hidden");
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
        }

        if (deleteOneTime && deleteRecurring) {
            initialBalances = {};
            invoiceSettings = {};
        }

        $("backupMessage").textContent = "";
        $("recurringMenu").classList.add("hidden");
        $("recurringFormContainer").classList.add("hidden");

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
                const itemStart = item.startDate;
                const itemEnd = item.endDate || "9999-12-31";
                const monthStart = `${monthPrefix}01`;
                const monthEnd = `${monthPrefix}31`;

                const overlaps = !(itemEnd < monthStart || itemStart > monthEnd);

                if (!overlaps) return true;

                return false;
            });
        }

        if (deleteOneTime && deleteRecurring) {
            delete initialBalances[key];
            delete invoiceSettings[key];
        }
    }

    saveData();

    closeDeleteOptions();
    updateDashboard();

    alert(deleteScope === "all"
        ? "A exclusão selecionada foi concluída."
        : "Os registros selecionados deste mês foram apagados."
    );
}

$("resetAppButton").addEventListener("click", () => {
    openDeleteOptions("all");
});

$("resetMonthButton").addEventListener("click", () => {
    openDeleteOptions("month");
});

$("cancelDeleteButton").addEventListener("click", closeDeleteOptions);
$("confirmDeleteButton").addEventListener("click", confirmSelectedDeletion);

$("deleteOptionsModal").addEventListener("click", event => {
    if (event.target === $("deleteOptionsModal")) closeDeleteOptions();
});

$("closeDayModalButton").addEventListener("click", closeDayModal);

$("dayTransactionsModal").addEventListener("click", event => {
    if (event.target === $("dayTransactionsModal")) closeDayModal();
});

$("transactionFormModal").addEventListener("click", event => {
    if (event.target === $("transactionFormModal")) closeTransactionForm();
});

$("recurringMenu").addEventListener("click", event => {
    if (event.target === $("recurringMenu")) closeRecurringMenu();
});

// ==========================================
// SALVAR CONFIGURAÇÕES
// ==========================================

$("saveInitialBalance").addEventListener("click", saveInitialBalance);
$("saveInvoiceSettings").addEventListener("click", saveInvoiceConfig);

// ==========================================
// EXPORTAÇÃO DE BACKUP
// ==========================================

$("exportButton").addEventListener("click", () => {
    const backup = {
        application: "Meu Financeiro",
        version: 7,
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

    $("backupMessage").textContent =
        "Backup gerado. Guarde o arquivo em uma pasta segura.";
});

// ==========================================
// IMPORTAÇÃO DE BACKUP
// ==========================================

$("importFile").addEventListener("change", async event => {
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
                type: item.type === "expense" ? "debit" : item.type
            }));
        }

        saveData();
        updateDashboard();

        $("backupMessage").textContent = "Backup importado com sucesso!";
    } catch (error) {
        alert("Não foi possível importar. Verifique o arquivo JSON.");
    }

    event.target.value = "";
});

// ==========================================
// BOTÕES DO GOOGLE DRIVE
// ==========================================

$("googleLoginButton").addEventListener("click", loginGoogle);
$("googleLogoutButton").addEventListener("click", logoutGoogle);
$("syncNowButton").addEventListener("click", async () => {
    await saveToDrive();
    await loadFromDrive();
});

// ==========================================
// INICIALIZAÇÃO
// ==========================================

loadData();

$("recurringStart") && ($("recurringStart").value = localDate(new Date()));

updateDashboard();
updateCloudButtons();
initGoogleAuth();
