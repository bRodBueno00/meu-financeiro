/* ============================================================
   UI — CATEGORIAS
   Modais de nova categoria, edição e lista de gerenciamento.
   Depende de: state.js, utils.js, storage.js, domain/categories.js.
   ============================================================ */

"use strict";

// ---- Modal de nova categoria (com checkboxes por tipo) ----

function openNewCategoryModal(targetSelectId, buttonType) {
    const currentType = resolveCategoryType(buttonType, targetSelectId);
    pendingCategoryTarget = { selectId: targetSelectId, currentType };

    const form = $("newCategoryForm");
    if (form) form.reset();

    ALL_TYPES.forEach(t => {
        const cb = $(`newCategoryType_${t}`);
        if (cb) cb.checked = (t === currentType);
    });

    const modal = $("newCategoryModal");
    if (modal) modal.classList.remove("hidden");

    const input = $("newCategoryName");
    if (input) input.focus();
}

function closeNewCategoryModal() {
    const modal = $("newCategoryModal");
    if (modal) modal.classList.add("hidden");
    pendingCategoryTarget = null;
}

safeOn("closeNewCategoryModal", "click", closeNewCategoryModal);

safeOn("newCategoryModal", "click", event => {
    if (event.target === $("newCategoryModal")) closeNewCategoryModal();
});

safeOn("newCategoryForm", "submit", event => {
    event.preventDefault();
    if (!pendingCategoryTarget) return;

    const nameInput = $("newCategoryName");
    const name = nameInput ? nameInput.value.trim() : "";
    if (!name) return;

    const selectedTypes = ALL_TYPES.filter(t => {
        const cb = $(`newCategoryType_${t}`);
        return cb && cb.checked;
    });

    if (selectedTypes.length === 0) {
        alert("Selecione pelo menos um tipo para a categoria.");
        return;
    }

    const exists = categories.some(
        c => c.name.toLowerCase() === name.toLowerCase()
    );
    if (exists) {
        alert("Já existe uma categoria com esse nome.");
        return;
    }

    const newCat = { id: makeId(), name, color: nextColor(), types: selectedTypes };
    categories.push(newCat);

    saveData();

    const targetType = pendingCategoryTarget.currentType;
    if (newCat.types.includes(targetType)) {
        populateCategorySelect(pendingCategoryTarget.selectId, targetType, newCat.id);
    } else {
        populateCategorySelect(pendingCategoryTarget.selectId, targetType);
    }

    closeNewCategoryModal();
    renderFiltersDropdown();
    refreshOpenCategorySelects();
});

// ---- Modal de gestão de categorias (lista única) ----

function openCategoriesList() {
    const modal = $("categoriesListModal");
    if (modal) modal.classList.remove("hidden");
    renderCategoriesList();
}

function closeCategoriesListModal() {
    const modal = $("categoriesListModal");
    if (modal) modal.classList.add("hidden");
}

function renderCategoriesList() {
    const container = $("categoriesListContainer");
    if (!container) return;

    container.innerHTML = "";

    const sorted = [...categories].sort((a, b) => {
        if (a.id === OUTROS_ID) return -1;
        if (b.id === OUTROS_ID) return 1;
        return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    });

    sorted.forEach(cat => {
        const row = document.createElement("div");
        row.className = "planning-item";

        const info = document.createElement("div");
        info.className = "item-info";

        const nameWrap = document.createElement("div");
        nameWrap.style.display = "flex";
        nameWrap.style.alignItems = "center";
        nameWrap.style.gap = "8px";

        const dot = document.createElement("span");
        dot.className = "category-dot";
        dot.style.background = cat.color;

        const name = document.createElement("strong");
        name.textContent = cat.name;

        nameWrap.append(dot, name);
        info.appendChild(nameWrap);

        const details = document.createElement("small");
        if (cat.id === OUTROS_ID) {
            details.textContent = "Categoria padrão universal (não editável)";
        } else {
            const typesLabel = cat.types.map(t => TYPE_LABELS[t]).join(" • ");
            details.textContent = typesLabel || "Nenhum tipo";
        }
        info.appendChild(details);

        const actions = document.createElement("div");
        actions.className = "item-actions";

        if (cat.id !== OUTROS_ID) {
            const editBtn = document.createElement("button");
            editBtn.className = "outline-button";
            editBtn.textContent = "Editar";
            editBtn.addEventListener("click", () => openCategoryEditModal(cat));
            actions.appendChild(editBtn);

            const remove = document.createElement("button");
            remove.className = "delete-button";
            remove.textContent = "✕";
            remove.title = "Excluir categoria";
            remove.addEventListener("click", () => deleteCategory(cat));
            actions.appendChild(remove);
        }

        row.append(info, actions);
        container.appendChild(row);
    });
}

function openCategoryEditModal(cat) {
    editingCategoryId = cat.id;
    const input = $("categoryEditName");
    if (input) input.value = cat.name;

    ALL_TYPES.forEach(t => {
        const cb = $(`categoryEditType_${t}`);
        if (cb) cb.checked = cat.types.includes(t);
    });

    const modal = $("categoryEditModal");
    if (modal) modal.classList.remove("hidden");
}

function closeCategoryEditModal() {
    const modal = $("categoryEditModal");
    if (modal) modal.classList.add("hidden");
    editingCategoryId = null;
}

function deleteCategory(cat) {
    const inUse = transactions.some(t => t.categoryId === cat.id)
        || recurring.some(r => r.categoryId === cat.id);

    if (inUse) {
        if (!confirm(`A categoria "${cat.name}" está em uso. Os lançamentos serão movidos para "Outros". Continuar?`)) return;

        transactions.forEach(t => { if (t.categoryId === cat.id) t.categoryId = OUTROS_ID; });
        recurring.forEach(r => { if (r.categoryId === cat.id) r.categoryId = OUTROS_ID; });
    } else {
        if (!confirm(`Excluir a categoria "${cat.name}"?`)) return;
    }

    categories = categories.filter(c => c.id !== cat.id);
    chartFilters.categoryKeys.delete(cat.id);

    saveData();
    updatePainel();
    renderCategoriesList();
    renderFiltersDropdown();
}

safeOn("closeCategoriesListModal", "click", closeCategoriesListModal);

safeOn("categoriesListModal", "click", event => {
    if (event.target === $("categoriesListModal")) closeCategoriesListModal();
});

safeOn("closeCategoryEditModal", "click", closeCategoryEditModal);

safeOn("categoryEditModal", "click", event => {
    if (event.target === $("categoryEditModal")) closeCategoryEditModal();
});

safeOn("categoryEditForm", "submit", event => {
    event.preventDefault();
    if (!editingCategoryId) return;

    const input = $("categoryEditName");
    const newName = input ? input.value.trim() : "";
    if (!newName) return;

    const selectedTypes = ALL_TYPES.filter(t => {
        const cb = $(`categoryEditType_${t}`);
        return cb && cb.checked;
    });

    if (selectedTypes.length === 0) {
        alert("Selecione pelo menos um tipo para a categoria.");
        return;
    }

    const exists = categories.some(
        c => c.id !== editingCategoryId && c.name.toLowerCase() === newName.toLowerCase()
    );
    if (exists) {
        alert("Já existe uma categoria com esse nome.");
        return;
    }

    const cat = categories.find(c => c.id === editingCategoryId);
    if (cat) {
        cat.name = newName;
        cat.types = selectedTypes;
    }

    saveData();
    updatePainel();
    closeCategoryEditModal();
    renderCategoriesList();
    renderFiltersDropdown();
});

document.addEventListener("click", event => {
    const newBtn = event.target.closest("[data-new-category]");
    if (newBtn) {
        openNewCategoryModal(
            newBtn.getAttribute("data-new-category"),
            newBtn.getAttribute("data-category-type")
        );
        return;
    }

    const manageBtn = event.target.closest("[data-manage-category]");
    if (manageBtn) {
        openCategoriesList();
    }
});