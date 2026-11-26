/* ============================================================
   UI — RECORRENTES
   Menu, listagem, edição (com override por mês) e formulário.
   Depende de: state.js, utils.js, storage.js,
               domain/categories.js, domain/recurring.js,
               ui/navigation.js.
   ============================================================ */

"use strict";

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