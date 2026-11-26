/* ============================================================
   DOMÍNIO — RECORRÊNCIAS
   Versionamento de valor, overrides por mês, ocorrências do mês.
   Depende de: state.js (recurring, recurringMonthOverrides),
               utils.js (localDate, parseDate, monthKey).
   ============================================================ */

"use strict";

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