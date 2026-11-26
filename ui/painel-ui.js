/* ============================================================
   UI — PAINEL
   updatePainel, calendário diário, modal do dia, expandir seções.
   Depende de: state.js, utils.js, storage.js,
               domain/invoice.js, domain/recurring.js,
               domain/balance.js, domain/categories.js,
               ui/navigation.js.
   ============================================================ */

"use strict";

// ==========================================
// PAINEL — TOTAIS
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

    const goalContribs = (typeof getGoalContributionsForMonth === "function")
        ? getGoalContributionsForMonth(selectedDate)
        : 0;

    const totalIncome = incomeActual + incomePlanned;
    const totalExpenses = debitActual + debitPlanned + invoice + goalContribs;
    const closing = opening + totalIncome - totalExpenses;

    const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

    setText("balance", money(closing));
    setText("totalIncome", money(totalIncome));
    setText("totalInvoice", money(invoice));
    setText("totalExpenses", money(debitActual + debitPlanned + goalContribs));
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

    // MÓDULO METAS: bloco "Metas do mês" no Painel
    if (typeof renderGoalsPanelBlock === "function") {
        renderGoalsPanelBlock();
    }
}

// ==========================================
// CALENDÁRIO DIÁRIO
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
        let debitTooltip = "";
        if (date === invoiceDueDate && invoiceAmount > 0) debitTooltip = "Inclui a fatura do cartão";

        const goalContribsDay = (typeof getGoalContributionsForDate === "function")
            ? getGoalContributionsForDate(date)
            : 0;
        if (goalContribsDay > 0) {
            const txt = `Inclui ${money(goalContribsDay)} em aportes de metas`;
            debitTooltip = debitTooltip ? `${debitTooltip}. ${txt}` : txt;
        }

        const debitCell = createEditableCell(debit, "debit-cell", "debit", date, debitTooltip);

        if (goalContribsDay > 0) {
            const star = document.createElement("span");
            star.textContent = " *";
            star.style.opacity = ".7";
            star.style.fontSize = ".85em";
            debitCell.appendChild(star);
        }

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

    const dayGoalContribs = (type === "debit" && typeof getGoalContributionObjectsByDate === "function")
        ? getGoalContributionObjectsByDate(date)
        : [];

    list.innerHTML = "";

    if (items.length === 0 && dayGoalContribs.length === 0 && !(type === "debit" && isInvoiceDay)) {
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

        if (type === "debit") {
            dayGoalContribs.forEach(c => {
                const row = document.createElement("div");
                row.className = "day-transaction-item";

                const info = document.createElement("div");
                info.className = "item-info";

                const name = document.createElement("strong");
                const goalName = typeof getGoalName === "function" ? getGoalName(c.goalId) : "Meta";
                name.textContent = `Aporte — ${goalName}`;

                const details = document.createElement("small");
                const badge = document.createElement("span");
                badge.textContent = "Meta";
                badge.style.cssText = "display:inline-block;padding:1px 6px;border-radius:6px;font-size:9px;font-weight:bold;margin-right:6px;color:#fff;background:" +
                    (typeof getGoalColor === "function" ? getGoalColor(c.goalId) : "#64748b");
                details.appendChild(badge);
                const detailsText = document.createTextNode("Aporte em meta");
                details.appendChild(detailsText);

                info.append(name, details);

                const actions = document.createElement("div");
                actions.className = "item-actions";

                const value = document.createElement("span");
                value.className = "item-value red";
                value.style.cursor = "pointer";
                value.style.textDecoration = "underline dashed";
                value.textContent = `- ${money(c.amount)}`;
                value.addEventListener("click", () => {
                    if (typeof openGoalContributionEdit === "function") openGoalContributionEdit(c.id);
                    closeDayModal();
                });

                const remove = document.createElement("button");
                remove.className = "delete-button";
                remove.textContent = "✕";
                remove.addEventListener("click", () => {
                    if (typeof deleteGoalContributionById === "function") {
                        deleteGoalContributionById(c.id);
                        closeDayModal();
                    }
                });

                actions.append(value, remove);
                row.append(info, actions);
                list.appendChild(row);
            });
        }

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
// LISTENERS DO MODAL DO DIA
// ==========================================

safeOn("closeDayModalButton", "click", closeDayModal);

safeOn("dayTransactionsModal", "click", event => {
    if (event.target === $("dayTransactionsModal")) closeDayModal();
});

safeOn("transactionFormModal", "click", event => {
    if (event.target === $("transactionFormModal")) closeTransactionForm();
});