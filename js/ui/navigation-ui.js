/* ============================================================
   UI — NAVEGAÇÃO
   Abas (Painel/Dashboard), navegação de meses, swipe.
   Depende de: state.js (currentView, selectedDate),
               utils.js ($, safeOn).
   ============================================================ */

"use strict";

function setActiveTab(view) {
    currentView = view;

    const tabPainel = $("tabPainel");
    const tabDashboard = $("tabDashboard");
    const painelView = $("painelView");
    const dashboardView = $("dashboardView");
    const painelHeader = $("painelHeaderContent");

    if (tabPainel) tabPainel.classList.toggle("active", view === "painel");
    if (tabDashboard) tabDashboard.classList.toggle("active", view === "dashboard");

    if (painelView) painelView.classList.toggle("hidden", view !== "painel");
    if (dashboardView) dashboardView.classList.toggle("hidden", view !== "dashboard");
    if (painelHeader) painelHeader.classList.toggle("hidden", view !== "painel");

    if (view === "dashboard") renderDashboard();
    else updatePainel();
}

function refreshCurrentView() {
    if (currentView === "dashboard") renderDashboard();
    else if (currentView === "metas" && typeof renderGoalsView === "function") renderGoalsView();
    else updatePainel();
}

safeOn("tabPainel", "click", () => setActiveTab("painel"));
safeOn("tabDashboard", "click", () => setActiveTab("dashboard"));

// ==========================================
// NAVEGAÇÃO DE MESES
// ==========================================

function navigateMonth(offset) {
    selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + offset, 1, 12);
    updatePainel();
}

safeOn("prevMonth", "click", () => navigateMonth(-1));
safeOn("nextMonth", "click", () => navigateMonth(1));

safeOn("goToCurrentMonth", "click", () => {
    const now = new Date();
    selectedDate = new Date(now.getFullYear(), now.getMonth(), 1, 12);
    updatePainel();
});

// ==========================================
// SWIPE
// ==========================================

let touchStartX = 0, touchStartY = 0, touchTracking = false;

function isInteractiveTarget(target) {
    if (!target) return false;
    return !!target.closest(
        "input, select, textarea, button, label, a, .money-cell, .delete-button, .outline-button, .checkbox-option, .modal-card, .month-selector, .app-tabs, .category-row, .dash-sticky, canvas, .chart-wrapper, .dash-top-item, .filter-check-item, .filter-mini-btn"
    );
}

const swipeArea = $("mainContent");
if (swipeArea) {
    swipeArea.addEventListener("touchstart", e => {
        if (e.touches.length !== 1) { touchTracking = false; return; }
        if (isInteractiveTarget(e.target)) { touchTracking = false; return; }
        touchTracking = true;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    swipeArea.addEventListener("touchend", e => {
        if (!touchTracking) return;
        touchTracking = false;
        const touch = e.changedTouches[0];
        if (!touch) return;

        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        const ax = Math.abs(dx), ay = Math.abs(dy);

        if (ax < 60 || ax < ay * 1.4) return;
        if (currentView !== "painel") return;

        if (dx < 0) navigateMonth(1);
        else navigateMonth(-1);
    }, { passive: true });
}