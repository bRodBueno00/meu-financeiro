/* ============================================================
   UI — TEMA
   Tema claro/escuro (toggle, preferência do sistema) e redraw em resize.
   Depende de: state.js (currentView), utils.js ($, safeOn).
   ============================================================ */

"use strict";

(function initTheme() {
    const THEME_KEY = "meuFinanceiroTheme";
    const root = document.documentElement;

    function getSystemTheme() {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    function applyTheme(theme) {
        root.setAttribute("data-theme", theme);
        const icon = $("themeToggleIcon");
        if (icon) icon.textContent = theme === "dark" ? "☀️" : "🌙";
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", theme === "dark" ? "#060b14" : "#101827");
    }

    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved === "dark" || saved === "light" ? saved : getSystemTheme());

    safeOn("themeToggle", "click", () => {
        const current = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
        const next = current === "dark" ? "light" : "dark";
        applyTheme(next);
        localStorage.setItem(THEME_KEY, next);
        if (currentView === "dashboard") renderDashboard();
    });

    if (window.matchMedia) {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
            if (!localStorage.getItem(THEME_KEY)) {
                applyTheme(e.matches ? "dark" : "light");
                if (currentView === "dashboard") renderDashboard();
            }
        });
    }
})();

// ==========================================
// REDRAW EM RESIZE
// ==========================================

let resizeTimer = null;
window.addEventListener("resize", () => {
    if (currentView !== "dashboard") return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (currentView === "dashboard") renderDashboard();
    }, 150);
});