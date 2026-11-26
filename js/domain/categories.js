/* ============================================================
   DOMÍNIO — CATEGORIAS
   Regras e helpers de categoria (lista única com flag types).
   Não contém UI (modais ficam em ui/categories-ui.js).
   Depende de: state.js (categories, nextCategoryColorIndex),
               utils.js ($).
   ============================================================ */

"use strict";

const CATEGORY_PALETTE = [
    "#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c",
    "#0891b2", "#ca8a04", "#db2777", "#4f46e5", "#059669",
    "#b45309", "#7c3aed", "#0d9488", "#e11d48", "#65a30d", "#0369a1"
];

const OUTROS_ID = "outros";

const ALL_TYPES = ["income", "credit", "debit"];
const TYPE_LABELS = { income: "Entrada", credit: "Crédito", debit: "Débito" };

function ensureOthersCategory() {
    if (!Array.isArray(categories)) categories = [];
    const existing = categories.find(c => c.id === OUTROS_ID);
    if (!existing) {
        categories.unshift({
            id: OUTROS_ID,
            name: "Outros",
            color: "#64748b",
            types: [...ALL_TYPES]
        });
    } else {
        existing.types = [...ALL_TYPES];
        existing.name = "Outros";
        existing.color = "#64748b";
    }
}

function nextColor() {
    const color = CATEGORY_PALETTE[nextCategoryColorIndex % CATEGORY_PALETTE.length];
    nextCategoryColorIndex++;
    return color;
}

function getCategoryById(id) {
    if (!id) return null;
    return categories.find(c => c.id === id) || null;
}

function getCategoryName(id) {
    if (!id) return "Outros";
    const cat = getCategoryById(id);
    return cat ? cat.name : "Outros";
}

function getCategoryColor(id) {
    if (!id) return "#64748b";
    const cat = getCategoryById(id);
    return cat ? cat.color : "#64748b";
}

function categorySupportsType(id, type) {
    const cat = getCategoryById(id);
    if (!cat) return id === OUTROS_ID;
    return Array.isArray(cat.types) && cat.types.includes(type);
}

function categoriesForType(type) {
    return categories.filter(c => Array.isArray(c.types) && c.types.includes(type));
}

function normalizeCategoryId(id, type) {
    if (!id) return OUTROS_ID;
    const cat = getCategoryById(id);
    if (!cat) return OUTROS_ID;
    if (type && !cat.types.includes(type)) return OUTROS_ID;
    return cat.id;
}

function populateCategorySelect(selectId, type, selectedId = OUTROS_ID) {
    const select = $(selectId);
    if (!select) return;

    select.innerHTML = "";

    const list = categoriesForType(type);

    list.forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat.id;
        opt.textContent = cat.name;
        select.appendChild(opt);
    });

    select.value = normalizeCategoryId(selectedId, type);
}

function resolveCategoryType(buttonType, targetSelectId) {
    if (targetSelectId === "transactionCategory") {
        const typeEl = $("transactionType");
        return typeEl ? typeEl.value : "income";
    }
    if (targetSelectId === "standaloneCategory") return currentTransactionsType;
    if (targetSelectId === "recurringCategory") return currentRecurringType;
    if (targetSelectId === "recurringEditCategory") {
        if (editingRecurringId) {
            const item = recurring.find(x => x.id === editingRecurringId);
            if (item) return item.type;
        }
        return currentRecurringType;
    }
    return "income";
}