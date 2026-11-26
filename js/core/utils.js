/* ============================================================
   UTILITÁRIOS — utils.js
   Funções puras usadas em todo o app: dinheiro, datas, DOM.
   Não depende de estado nem de outros arquivos.
   Deve ser carregado ANTES de app.js e goals.js.
   ============================================================ */

"use strict";

/* ----- DOM ----- */

const $ = id => document.getElementById(id);

function safeOn(id, event, handler) {
    const el = $(id);
    if (!el) return;
    el.addEventListener(event, handler);
}

/* ----- Dinheiro ----- */

function money(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });
}

/* ----- Datas ----- */

function localDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function parseDate(value) {
    const parts = value.split("-").map(Number);
    if (parts.length === 2) return new Date(parts[0], parts[1] - 1, 1, 12);
    return new Date(parts[0], parts[1] - 1, parts[2], 12);
}

function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(value) {
    return parseDate(value).toLocaleDateString("pt-BR");
}

/* ----- IDs ----- */

function makeId() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + Math.random();
}

function formatMonth(value) {
    return parseDate(value).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
}