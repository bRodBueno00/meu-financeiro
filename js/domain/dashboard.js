/* ============================================================
   DOMÍNIO — DASHBOARD
   Período, totais mensais, filtros e agregações.
   Depende de: state.js (transactions, dashPeriod, chartFilters),
               utils.js (parseDate, monthKey),
               invoice.js (getInvoiceAmount),
               recurring.js (getOccurrencesForMonth),
               balance.js (getOpeningBalance).
   ============================================================ */

"use strict";

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

    // MÓDULO METAS: aportes do mês (saída dedicada, fora do comparativo de gastos)
    const goalContributions = (typeof getGoalContributionsForMonth === "function")
        ? getGoalContributionsForMonth(date)
        : 0;

    const closing = opening + (incomeActual + incomePlanned)
        - (debitActual + debitPlanned + invoice + goalContributions);

    return {
        key, date,
        income: incomeActual + incomePlanned,
        debit: debitActual + debitPlanned,
        invoice,
        goalContributions,
        opening,
        closing
    };
}

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

    // MÓDULO METAS: contribui com aportes no mesmo formato
    if (typeof getGoalEntriesForRange === "function") {
        const goalEntries = getGoalEntriesForRange(range, chartFilters);
        goalEntries.forEach(e => entries.push(e));
    }

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