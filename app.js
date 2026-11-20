const STORAGE_KEY = "meuFinanceiroDados_v2";

// ==========================================
// CONFIGURAÇÃO GOOGLE DRIVE
// ==========================================
const CLIENT_ID = "127934343018-kpdvptdrvp8ov899cjii6okrmv2u17d2.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "MeuFinanceiro";
const FILE_NAME = "financeiro.json";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

let tokenClient = null;
let accessToken = null;
let currentFileId = null;
let saveTimer = null;

let transactions = [];
let plans = [];
let selectedDate = new Date();

let initialBalances = {};
let invoiceSettings = {};
let skippedOccurrences = [];
let planOverrides = {};

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
        version: 4,
        transactions,
        plans,
        initialBalances,
        invoiceSettings,
        skippedOccurrences,
        planOverrides
    };
}

function applyDataSnapshot(data) {
    transactions = (data.transactions || []).map(item => ({
        ...item,
        type: item.type === "expense" ? "debit" : item.type
    }));

    plans = (data.plans || []).map(item => ({
        ...item,
        type: item.type === "expense" ? "debit" : item.type
    }));

    initialBalances = data.initialBalances || {};
    invoiceSettings = data.invoiceSettings || {};
    skippedOccurrences = Array.isArray(data.skippedOccurrences)
        ? data.skippedOccurrences
        : [];
    planOverrides = data.planOverrides || {};
}

function saveData() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(getDataSnapshot()));
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

async function findFileInFolder(folderId) {
    const query = encodeURIComponent(
        `name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`
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
        const file = await findFileInFolder(folderId);

        if (!file) {
            setCloudStatus("Drive: conectado (sem arquivo ainda)");
            currentFileId = null;
            return;
        }

        currentFileId = file.id;

        const res = await driveFetch(`${DRIVE_API}/files/${file.id}?alt=media`);
        const data = await res.json();

        applyDataSnapshot(data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(getDataSnapshot()));

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

async function saveToDrive() {
    if (!accessToken) return;

    try {
        setCloudStatus("Drive: salvando...");

        const folderId = await findOrCreateFolder();

        if (!currentFileId) {
            const existing = await findFileInFolder(folderId);
            if (existing) currentFileId = existing.id;
        }

        const body = JSON.stringify(getDataSnapshot(), null, 2);

        if (!currentFileId) {
            const metadata = {
                name: FILE_NAME,
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
            currentFileId = created.id;
        } else {
            const res = await driveFetch(
                `${UPLOAD_API}/files/${currentFileId}?uploadType=media`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body
                }
            );

            if (!res.ok) throw new Error("Falha ao atualizar arquivo");
        }

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
// PROGRAMAÇÕES RECORRENTES
// ==========================================

function getOccurrencesForMonth(date) {
    const year = date.getFullYear();
    const month = date.getMonth();

    const first = new Date(year, month, 1, 12);
    const last = new Date(year, month + 1, 0, 12);

    const occurrences = [];

    plans.forEach(plan => {
        const start = parseDate(plan.date);

        if (plan.repeat === "once") {
            if (monthKey(start) === monthKey(date)) {
                occurrences.push({ ...plan, occurrenceDate: plan.date });
            }
            return;
        }

        if (plan.repeat === "monthly") {
            if (first < new Date(start.getFullYear(), start.getMonth(), 1, 12)) {
                return;
            }

            const day = Math.min(start.getDate(), last.getDate());
            const occurrence = localDate(new Date(year, month, day, 12));

            if (occurrence >= plan.date) {
                occurrences.push({ ...plan, occurrenceDate: occurrence });
            }
            return;
        }

        if (plan.repeat === "yearly") {
            if (year < start.getFullYear()) return;

            if (month === start.getMonth()) {
                const day = Math.min(start.getDate(), last.getDate());
                const occurrence = localDate(new Date(year, month, day, 12));

                if (occurrence >= plan.date) {
                    occurrences.push({ ...plan, occurrenceDate: occurrence });
                }
            }
        }
    });

    return occurrences
        .filter(item =>
            !skippedOccurrences.includes(`${item.id}|${item.occurrenceDate}`)
        )
        .map(item => {
            const monthKeyStr = monthKey(date);
            const overrideKey = `${item.id}|${monthKeyStr}`;
            
            if (planOverrides[overrideKey] !== undefined) {
                return { ...item, amount: planOverrides[overrideKey] };
            }
            return item;
        });
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
    renderPlans();
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

        deleteDay.addEventListener("click", () => {
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
        `Deseja excluir os ${count} lançamento(s) manual(is) do dia ${formatDate(date)}?\n\n` +
        "As programações recorrentes não serão excluídas."
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

    cell.title = tooltip || "Toque para adicionar um lançamento";

    cell.addEventListener("click", () => {
        addCalendarTransaction(type, date);
    });

    return cell;
}

function addCalendarTransaction(type, date) {
    const labels = {
        income: "Entrada",
        credit: "Gasto no crédito",
        debit: "Gasto no débito"
    };

    const amountInput = prompt(
        `${labels[type]} em ${formatDate(date)}\n\nDigite o valor em reais:`
    );

    if (amountInput === null || amountInput.trim() === "") return;

    const amount = Number(amountInput.trim().replace(",", "."));

    if (!Number.isFinite(amount) || amount <= 0) {
        alert("Digite um valor válido.");
        return;
    }

    const description = prompt("Descrição breve (opcional):");

    if (description === null) return;

    transactions.push({
        id: makeId(),
        description: description.trim() || labels[type],
        amount: Math.round(amount * 100) / 100,
        type,
        date
    });

    saveData();
    updateDashboard();
}

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
            details.textContent = `${formatDate(item.date)} • ${labels[item.type]}`;

            info.append(name, details);

            const actions = document.createElement("div");
            actions.className = "item-actions";

            const value = document.createElement("span");
            value.className = "item-value " +
                (item.type === "income" ? "green" :
                 item.type === "credit" ? "blue" : "red");

            value.textContent =
                `${item.type === "income" ? "+" : "-"} ${money(item.amount)}`;

            const remove = document.createElement("button");
            remove.className = "delete-button";
            remove.textContent = "✕";
            remove.title = "Excluir lançamento";

            remove.addEventListener("click", () => {
                if (!confirm("Excluir este lançamento?")) return;

                transactions = transactions.filter(x => x.id !== item.id);

                saveData();
                updateDashboard();
            });

            actions.append(value, remove);
            row.append(info, actions);
            container.appendChild(row);
        });
}

// ==========================================
// LISTA DE PROGRAMAÇÕES
// ==========================================

function renderPlans() {
    const container = $("planningList");
    container.innerHTML = "";

    if (!plans.length) {
        const empty = document.createElement("p");
        empty.className = "empty-message";
        empty.textContent = "Nenhuma programação cadastrada.";
        container.appendChild(empty);
        return;
    }

    const repeatNames = {
        once: "Uma vez",
        monthly: "Todo mês",
        yearly: "Todo ano"
    };

    plans.forEach(plan => {
        const row = document.createElement("div");
        row.className = "planning-item";

        const info = document.createElement("div");
        info.className = "item-info";

        const name = document.createElement("strong");
        name.textContent = plan.description;

        const details = document.createElement("small");
        details.textContent =
            `${formatDate(plan.date)} • ${repeatNames[plan.repeat]}`;

        info.append(name, details);

        const actions = document.createElement("div");
        actions.className = "item-actions";

        const key = `${plan.id}|${monthKey(selectedDate)}`;
        const isOverridden = planOverrides[key] !== undefined;
        const displayAmount = isOverridden ? planOverrides[key] : plan.amount;

        const value = document.createElement("span");
        value.className = "item-value " +
            (plan.type === "income" ? "green" : "red");
        
        value.style.cursor = "pointer";
        value.style.textDecoration = "underline dashed";
        value.title = "Clique para editar o valor apenas para este mês";

        value.textContent =
            `${plan.type === "income" ? "+" : "-"} ${money(displayAmount)}`;

        value.addEventListener("click", () => {
            const msg = `Editar valor de "${plan.description}" para o mês de ${selectedDate.toLocaleDateString("pt-BR", {month: "long", year: "numeric"})}.\n\nDigite o novo valor (ou deixe em branco para restaurar o valor original):`;
            const novoValorStr = prompt(msg, displayAmount);

            if (novoValorStr === null) return;

            const novoValor = parseFloat(novoValorStr.replace(",", "."));

            if (novoValorStr.trim() === "") {
                delete planOverrides[key];
            } else if (!isNaN(novoValor) && novoValor > 0) {
                planOverrides[key] = Math.round(novoValor * 100) / 100;
            } else {
                alert("Valor inválido.");
                return;
            }

            saveData();
            updateDashboard();
        });

        const remove = document.createElement("button");
        remove.className = "delete-button";
        remove.textContent = "✕";
        remove.title = "Excluir programação";

        remove.addEventListener("click", () => {
            if (!confirm("Excluir esta programação e suas próximas ocorrências?")) return;

            plans = plans.filter(x => x.id !== plan.id);

            saveData();
            updateDashboard();
        });

        actions.append(value, remove);
        row.append(info, actions);
        container.appendChild(row);
    });
}

// ==========================================
// FORMULÁRIO DE PROGRAMAÇÃO
// ==========================================

$("openPlanning").addEventListener("click", () => {
    $("planningFormContainer").classList.toggle("hidden");
});

$("closePlanning").addEventListener("click", () => {
    $("planningFormContainer").classList.add("hidden");
    $("planningForm").reset();
});

$("planningForm").addEventListener("submit", event => {
    event.preventDefault();

    const description = $("planDescription").value.trim();
    const amount = Number($("planAmount").value);
    const type = $("planType").value;
    const date = $("planDate").value;
    const repeat = $("planRepeat").value;

    if (!description || !Number.isFinite(amount) || amount <= 0 || !date) {
        alert("Preencha os dados corretamente.");
        return;
    }

    plans.push({
        id: makeId(),
        description,
        amount: Math.round(amount * 100) / 100,
        type,
        date,
        repeat
    });

    saveData();

    $("planningForm").reset();
    $("planDate").value = localDate(new Date());
    $("planningFormContainer").classList.add("hidden");

    updateDashboard();
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
        : `Escolha quais categorias deseja apagar de ${monthName}. As programações recorrentes continuarão cadastradas para os outros meses. Esta ação não pode ser desfeita.`;

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
            plans = [];
            skippedOccurrences = [];
            planOverrides = {};
        }

        if (deleteOneTime && deleteRecurring) {
            initialBalances = {};
            invoiceSettings = {};
        }

        $("backupMessage").textContent = "";
        $("planningForm").reset();
        $("planningFormContainer").classList.add("hidden");
        $("planDate").value = localDate(new Date());

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
            plans = plans.filter(plan =>
                !(plan.repeat === "once" && plan.date.startsWith(monthPrefix))
            );

            const monthPlans = getOccurrencesForMonth(selectedDate);

            monthPlans.forEach(item => {
                if (item.repeat !== "once") {
                    const exclusion = `${item.id}|${item.occurrenceDate}`;

                    if (!skippedOccurrences.includes(exclusion)) {
                        skippedOccurrences.push(exclusion);
                    }
                }
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
        : "Os registros selecionados deste mês foram apagados. As programações recorrentes dos outros meses foram preservadas."
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
        version: 4,
        exportedAt: new Date().toISOString(),
        ...getDataSnapshot()
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

        if (!Array.isArray(data.transactions) || !Array.isArray(data.plans)) {
            throw new Error("Arquivo inválido.");
        }

        const validTypes = ["income", "credit", "debit", "expense"];

        const validTransactions = data.transactions.every(item =>
            item.id &&
            typeof item.description === "string" &&
            Number.isFinite(item.amount) &&
            item.amount > 0 &&
            validTypes.includes(item.type) &&
            /^\d{4}-\d{2}-\d{2}$/.test(item.date)
        );

        const validPlans = data.plans.every(item =>
            item.id &&
            typeof item.description === "string" &&
            Number.isFinite(item.amount) &&
            item.amount > 0 &&
            ["income", "debit", "expense"].includes(item.type) &&
            ["once", "monthly", "yearly"].includes(item.repeat) &&
            /^\d{4}-\d{2}-\d{2}$/.test(item.date)
        );

        if (!validTransactions || !validPlans) {
            throw new Error("Dados inválidos.");
        }

        if (!confirm("A importação substituirá os dados atuais. Deseja continuar?")) {
            return;
        }

        applyDataSnapshot(data);

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

$("planDate").value = localDate(new Date());

updateDashboard();
updateCloudButtons();
initGoogleAuth();
