/* ============================================================
   DOMÍNIO — FATURA DO CARTÃO
   Regras do ciclo de fatura (período configurável por mês).
   Depende de: state.js (invoiceSettings, selectedDate),
               utils.js (monthKey, localDate, parseDate).
   ============================================================ */

"use strict";

function getInvoiceConfig(date = selectedDate) {
    const key = monthKey(date);
    return invoiceSettings[key] || { start: 13, end: 12, due: 21 };
}

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