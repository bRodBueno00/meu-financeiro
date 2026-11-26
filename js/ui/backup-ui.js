/* ============================================================
   UI — BACKUP E EXCLUSÃO
   Exportar/importar JSON, apagar todos os dados / do mês.
   Depende de: state.js, utils.js, storage.js,
               domain/invoice.js, domain/categories.js,
               ui/navigation.js.
   ============================================================ */

"use strict";

// ==========================================
// EXCLUSÃO
// ==========================================

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

            categories = [];
            ensureOthersCategory();
            nextCategoryColorIndex = 0;
            chartFilters.categoryKeys.clear();
            selectedCategoryKey = null;
        }
        if (typeof clearAllGoalsData === "function") {
            clearAllGoalsData();
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

        if (typeof clearGoalsDataForMonth === "function") {
            clearGoalsDataForMonth(selectedDate.getFullYear(), selectedDate.getMonth());
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

    if (typeof getGoalsBackupBlock === "function") {
        backup.goals = getGoalsBackupBlock();
    }

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

        if (data.goals && typeof applyGoalsBackupBlock === "function") {
            applyGoalsBackupBlock(data.goals);
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
