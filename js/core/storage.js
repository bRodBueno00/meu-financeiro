/* ============================================================
   ESTADO GLOBAL — state.js
   Declara as variáveis de estado do app em um só lugar.
   Não contém lógica: apenas declarações.
   Deve ser carregado ANTES de app.js e goals.js.
   ============================================================ */

"use strict";

/* ----- Dados principais ----- */
let transactions = [];
let recurring = [];
let categories = [];
let initialBalances = {};
let invoiceSettings = {};
let recurringMonthOverrides = {};
let savedDescriptions = [];

/* ----- Seleção e navegação ----- */
let selectedDate = new Date();
let currentView = "painel";

/* ----- Categorias ----- */
let nextCategoryColorIndex = 0;

/* ----- Formulários / modais ----- */
let pendingTransactionType = null;
let pendingTransactionDate = null;
let editingRecurringId = null;
let currentRecurringType = "income";
let currentTransactionsType = "income";
let editingCategoryId = null;
let pendingCategoryTarget = null;

/* ----- Painel ----- */
let calendarSectionOpen = false;
let backupSectionOpen = false;

/* ----- Dashboard ----- */
let dashPeriod = { months: 12 };
let dashProjectionMonths = 6;
let projectionSectionOpen = false;
let filtersDropdownOpen = false;

let chartFilters = {
    types: { debit: true, invoice: true, goals: true },
    origins: { oneTime: true, recurring: true },
    categoryKeys: new Set(),
    minValue: null,
    maxValue: null
};

let selectedCategoryKey = null;

let chartTooltipEl = null;
let chartBarsState = null;
let chartLineState = null;

/* ----- Google Drive ----- */
let tokenClient = null;
let accessToken = null;
let currentFileId = null;
let currentRecurringFileId = null;
let saveTimer = null;

/* ----- Exclusão ----- */
let deleteScope = "all";
