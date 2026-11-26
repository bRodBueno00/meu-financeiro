/* ============================================================
   DOMÍNIO — SALDO
   Saldo de abertura, fechamento mensal, valores do dia.
   Depende de: state.js (transactions, initialBalances, selectedDate),
               utils.js (monthKey, localDate),
               invoice.js (getInvoiceAmount, getInvoiceDueDate),
               recurring.js (getOccurrencesForMonth) — via app.js.
   ============================================================ */

"use strict";

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

function getDayValues(date, actual, scheduled) {
    const dayActual = actual.filter(x => x.date === date);
    const dayScheduled = scheduled.filter(x => x.occurrenceDate === date);
    const all = [...dayActual, ...dayScheduled];

    const income = all.filter(x => x.type === "income").reduce((s, x) => s + x.amount, 0);
    const credit = all.filter(x => x.type === "credit").reduce((s, x) => s + x.amount, 0);
    let debit = all.filter(x => x.type === "debit").reduce((s, x) => s + x.amount, 0);

    // MÓDULO METAS: aportes do dia reduzem o saldo, mas não são despesa
    if (typeof getGoalContributionsForDate === "function") {
        debit += getGoalContributionsForDate(date);
    }

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
