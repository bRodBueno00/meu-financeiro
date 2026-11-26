/* ============================================================
   UI — LANÇAMENTOS PONTUAIS
   Formulários, menu, listagem e datalists de descrição.
   Depende de: state.js, utils.js, storage.js,
               domain/categories.js, ui/navigation.js.
   ============================================================ */

"use strict";

// ---- Data sugerida para o mês selecionado ----

function suggestedDateInSelectedMonth() {
    const today = new Date();
    const day = today.getDate();
    const lastDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
    const safeDay = Math.min(day, lastDay);
    return localDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), safeDay, 12));
}

function installmentDateClamped(baseDate, monthOffset) {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth() + monthOffset;
    const lastDay = new Date(year, month + 1, 0, 12).getDate();
    const day = Math.min(baseDate.getDate(), lastDay);
    return new Date(year, month, day, 12);
}

// ---- Datalists de descrição ----

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
// FORMULÁRIO DE LANÇAMENTO (modal)
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
            const installmentDate = installmentDateClamped(baseDate, i);
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

// ==========================================
// FORMULÁRIO STANDALONE (dentro do menu de lançamentos)
// ==========================================

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
// LISTENERS DO MENU DE LANÇAMENTOS
// ==========================================

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