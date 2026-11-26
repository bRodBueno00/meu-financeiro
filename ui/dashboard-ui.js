/* ============================================================
   UI — DASHBOARD
   renderDashboard, filtros, gráficos canvas, tops, projeção.
   Depende de: state.js, utils.js, domain/dashboard.js,
               domain/balance.js, domain/categories.js,
               ui/navigation.js.
   ============================================================ */

"use strict";

// ==========================================
// RENDER DASHBOARD
// ==========================================

function renderDashboard() {
    try {
        const range = getDashRange();

        let totalIncome = 0;
        let totalDebit = 0;
        let totalInvoice = 0;
        let totalGoals = 0;
        let lastClosing = null;

        forEachMonthInRange(range.start, range.end, m => {
            const t = computeMonthTotals(m);
            totalIncome += t.income;
            totalDebit += t.debit;
            totalInvoice += t.invoice;
            totalGoals += (t.goalContributions || 0);
            lastClosing = t.closing;
        });

        if (lastClosing === null) lastClosing = getOpeningBalance(range.start);

        const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

        setText("dashKpiIncome", money(totalIncome));
        setText("dashKpiDebit", money(totalDebit + totalGoals));
        setText("dashKpiInvoice", money(totalInvoice));
        setText("dashKpiBalance", money(lastClosing));

        const percent = totalIncome > 0 ? Math.min(100, Math.round(((totalDebit + totalGoals) / totalIncome) * 100)) : 0;
        setText("dashComparePercent", `${percent}%`);

        const fill = $("dashCompareFill");
        if (fill) {
            fill.style.width = `${percent}%`;
            fill.classList.remove("warn", "danger");
            if (percent >= 100) fill.classList.add("danger");
            else if (percent >= 70) fill.classList.add("warn");
        }

        const hint = $("dashCompareHint");
        if (hint) {
            if (totalIncome === 0 && totalDebit === 0) {
                hint.textContent = "Sem lançamentos no período.";
            } else if (percent < 70) {
                hint.textContent = `Você está gastando ${percent}% do que entra. Boa margem.`;
            } else if (percent < 100) {
                hint.textContent = `Atenção: ${percent}% da sua entrada está indo para saídas.`;
            } else {
                hint.textContent = `Alerta: suas saídas superam as entradas.`;
            }
        }

        const periodLabel = $("dashPeriodLabel");
        if (periodLabel) {
            const fmt = d => d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
            periodLabel.textContent = `${fmt(range.start)} → ${fmt(range.end)}`;
        }

        renderCharts(range);
        renderTopLists(range);
        renderProjection();
        updateDashShortcutButtons();
        updateFilterBadge();

        if (typeof renderGoalsDashboardBlock === "function") {
            renderGoalsDashboardBlock(range);
        }
    } catch (error) {
        console.error("Erro ao renderizar dashboard:", error);
    }
}

function renderProjection() {
    const container = $("projectionList");
    if (!container) return;

    container.innerHTML = "";

    const today = new Date();
    const baseDate = new Date(today.getFullYear(), today.getMonth(), 1, 12);

    for (let i = 0; i < dashProjectionMonths; i++) {
        const monthDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1, 12);
        const t = computeMonthTotals(monthDate);

        const row = document.createElement("div");
        row.className = "dash-projection-row";

        const label = monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        const nameEl = document.createElement("strong");
        nameEl.textContent = label;

        const valueEl = document.createElement("span");
        valueEl.className = "dash-projection-value";
        if (t.closing < 0) valueEl.classList.add("negative");
        valueEl.textContent = money(t.closing);

        row.append(nameEl, valueEl);
        container.appendChild(row);
    }
}

function updateDashShortcutButtons() {
    document.querySelectorAll(".dash-shortcut").forEach(btn => {
        const months = btn.getAttribute("data-months");
        const range = btn.getAttribute("data-range");
        let active = false;

        if (months && !dashPeriod.customStart && !dashPeriod.customEnd && !dashPeriod.yearOnly) {
            active = Number(months) === Number(dashPeriod.months);
        }
        if (range === "year" && dashPeriod.yearOnly) active = true;
        if (range === "custom" && (dashPeriod.customStart || dashPeriod.customEnd)) active = true;

        btn.classList.toggle("active", active);
    });
}

function applyDashPreset(months) {
    dashPeriod = { months };
    const customEl = $("dashCustomRange");
    if (customEl) customEl.classList.add("hidden");
    renderDashboard();
}

function applyDashYear() {
    dashPeriod = { yearOnly: true };
    const customEl = $("dashCustomRange");
    if (customEl) customEl.classList.add("hidden");
    renderDashboard();
}

function applyDashCustom() {
    const customEl = $("dashCustomRange");
    if (customEl) customEl.classList.remove("hidden");

    const startEl = $("dashStart");
    const endEl = $("dashEnd");
    const now = new Date();

    if (startEl && !startEl.value) {
        const d = new Date(now.getFullYear(), now.getMonth() - 11, 1, 12);
        startEl.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    if (endEl && !endEl.value) {
        endEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }

    dashPeriod = {
        customStart: startEl ? startEl.value : null,
        customEnd: endEl ? endEl.value : null
    };

    renderDashboard();
}

safeOn("dashStart", "change", applyDashCustom);
safeOn("dashEnd", "change", applyDashCustom);

safeOn("toggleProjectionButton", "click", () => {
    projectionSectionOpen = !projectionSectionOpen;
    const section = $("projectionSection");
    if (section) section.classList.toggle("hidden", !projectionSectionOpen);
    const icon = $("toggleProjectionIcon");
    if (icon) icon.textContent = projectionSectionOpen ? "▾" : "▸";
    if (projectionSectionOpen) renderProjection();
});

safeOn("projectionMonths", "input", () => {
    const el = $("projectionMonths");
    if (!el) return;
    const v = Number(el.value);
    if (Number.isFinite(v) && v >= 1 && v <= 24) {
        dashProjectionMonths = v;
        renderProjection();
    }
});

safeOn("dashOpenTransactionsMenu", "click", () => openTransactionsMenu());
safeOn("dashOpenRecurringMenu", "click", () => openRecurringMenu());

function bindDashShortcuts() {
    document.querySelectorAll(".dash-shortcut").forEach(btn => {
        btn.addEventListener("click", () => {
            const months = btn.getAttribute("data-months");
            const range = btn.getAttribute("data-range");

            if (months) applyDashPreset(Number(months));
            else if (range === "year") applyDashYear();
            else if (range === "custom") applyDashCustom();
        });
    });
}

// ==========================================
// FILTROS — UI
// ==========================================

function getAvailableFilterCategories() {
    const list = [];
    categories.forEach(cat => {
        if (cat.id === OUTROS_ID) return;
        const types = (cat.types || []).filter(t => t === "debit" || t === "credit");
        if (types.length === 0) return;
        list.push({ id: cat.id, name: cat.name, color: cat.color, types });
    });
    return list;
}

function renderFiltersDropdown() {
    const container = $("filterCategoriesList");
    if (!container) return;

    container.innerHTML = "";

    const list = getAvailableFilterCategories();

    if (list.length === 0) {
        const p = document.createElement("p");
        p.className = "helper";
        p.textContent = "Nenhuma categoria cadastrada ainda.";
        container.appendChild(p);
        return;
    }

    const groups = { debit: "Débito", credit: "Crédito" };

    Object.keys(groups).forEach(type => {
        const groupItems = list.filter(c => c.types.includes(type));
        if (groupItems.length === 0) return;

        const title = document.createElement("div");
        title.className = "filter-subcategory-title";
        title.textContent = groups[type];
        container.appendChild(title);

        groupItems.forEach(cat => {
            const label = document.createElement("label");
            label.className = "filter-check-item";

            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = chartFilters.categoryKeys.has(cat.id);
            input.addEventListener("change", () => {
                if (input.checked) chartFilters.categoryKeys.add(cat.id);
                else chartFilters.categoryKeys.delete(cat.id);
                renderDashboard();
            });

            const dot = document.createElement("span");
            dot.className = "filter-cat-dot";
            dot.style.background = cat.color;

            const name = document.createElement("span");
            name.textContent = cat.name;

            label.append(input, dot, name);
            container.appendChild(label);
        });
    });

    const title = document.createElement("div");
    title.className = "filter-subcategory-title";
    title.textContent = "Especial";
    container.appendChild(title);

    const invLabel = document.createElement("label");
    invLabel.className = "filter-check-item";

    const invInput = document.createElement("input");
    invInput.type = "checkbox";
    invInput.checked = chartFilters.categoryKeys.has("invoice");
    invInput.addEventListener("change", () => {
        if (invInput.checked) chartFilters.categoryKeys.add("invoice");
        else chartFilters.categoryKeys.delete("invoice");
        renderDashboard();
    });

    const invDot = document.createElement("span");
    invDot.className = "filter-cat-dot";
    invDot.style.background = "#1d4ed8";

    const invName = document.createElement("span");
    invName.textContent = "Fatura do cartão";

    invLabel.append(invInput, invDot, invName);
    container.appendChild(invLabel);
}

function updateFilterBadge() {
    const badge = $("dashFilterBadge");
    if (!badge) return;

    let count = 0;
    if (!chartFilters.types.debit) count++;
    if (!chartFilters.types.invoice) count++;
    if (!chartFilters.types.goals) count++;
    if (!chartFilters.origins.oneTime) count++;
    if (!chartFilters.origins.recurring) count++;
    if (chartFilters.categoryKeys.size > 0) count++;
    if (chartFilters.minValue !== null) count++;
    if (chartFilters.maxValue !== null) count++;

    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
}

safeOn("filterTypeDebit", "change", () => {
    const el = $("filterTypeDebit");
    if (!el) return;
    if (!el.checked && !chartFilters.types.invoice && !chartFilters.types.goals) { el.checked = true; return; }
    chartFilters.types.debit = el.checked;
    renderDashboard();
});

safeOn("filterTypeInvoice", "change", () => {
    const el = $("filterTypeInvoice");
    if (!el) return;
    if (!el.checked && !chartFilters.types.debit && !chartFilters.types.goals) { el.checked = true; return; }
    chartFilters.types.invoice = el.checked;
    renderDashboard();
});

safeOn("filterTypeGoals", "change", () => {
    const el = $("filterTypeGoals");
    if (!el) return;
    if (!el.checked && !chartFilters.types.debit && !chartFilters.types.invoice) { el.checked = true; return; }
    chartFilters.types.goals = el.checked;
    renderDashboard();
});

safeOn("filterOriginOneTime", "change", () => {
    const el = $("filterOriginOneTime");
    if (!el) return;
    if (!el.checked && !chartFilters.origins.recurring) { el.checked = true; return; }
    chartFilters.origins.oneTime = el.checked;
    renderDashboard();
});

safeOn("filterOriginRecurring", "change", () => {
    const el = $("filterOriginRecurring");
    if (!el) return;
    if (!el.checked && !chartFilters.origins.oneTime) { el.checked = true; return; }
    chartFilters.origins.recurring = el.checked;
    renderDashboard();
});

safeOn("filterMinValue", "input", () => {
    const el = $("filterMinValue");
    if (!el) return;
    const v = parseFloat(el.value.replace(",", "."));
    chartFilters.minValue = Number.isFinite(v) && v >= 0 ? v : null;
    renderDashboard();
});

safeOn("filterMaxValue", "input", () => {
    const el = $("filterMaxValue");
    if (!el) return;
    const v = parseFloat(el.value.replace(",", "."));
    chartFilters.maxValue = Number.isFinite(v) && v > 0 ? v : null;
    renderDashboard();
});

safeOn("toggleFiltersButton", "click", () => {
    filtersDropdownOpen = !filtersDropdownOpen;
    const dd = $("filtersDropdown");
    if (dd) dd.classList.toggle("hidden", !filtersDropdownOpen);
    const icon = $("toggleFiltersIcon");
    if (icon) icon.textContent = filtersDropdownOpen ? "▴" : "▾";
    if (filtersDropdownOpen) renderFiltersDropdown();
});

document.querySelectorAll("[data-cat-action]").forEach(btn => {
    btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-cat-action");
        if (action === "all") {
            getAvailableFilterCategories().forEach(c => chartFilters.categoryKeys.add(c.id));
            chartFilters.categoryKeys.add("invoice");
        } else {
            chartFilters.categoryKeys.clear();
        }
        renderFiltersDropdown();
        renderDashboard();
    });
});

safeOn("clearFiltersButton", "click", () => {
    chartFilters = {
        types: { debit: true, invoice: true, goals: true },
        origins: { oneTime: true, recurring: true },
        categoryKeys: new Set(),
        minValue: null,
        maxValue: null
    };
    const minEl = $("filterMinValue"); if (minEl) minEl.value = "";
    const maxEl = $("filterMaxValue"); if (maxEl) maxEl.value = "";
    const fd = $("filterTypeDebit"); if (fd) fd.checked = true;
    const fi = $("filterTypeInvoice"); if (fi) fi.checked = true;
    const fg = $("filterTypeGoals"); if (fg) fg.checked = true;
    const oo = $("filterOriginOneTime"); if (oo) oo.checked = true;
    const or = $("filterOriginRecurring"); if (or) or.checked = true;
    renderFiltersDropdown();
    renderDashboard();
});

// ==========================================
// CHARTS — HELPERS
// ==========================================

function getChartColors() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    return {
        text: isDark ? "#cbd5e1" : "#475569",
        grid: isDark ? "#2a3752" : "#e2e8f0",
        income: isDark ? "#4ade80" : "#16a34a",
        debit: isDark ? "#f87171" : "#dc2626",
        line: isDark ? "#60a5fa" : "#2563eb",
        lineFill: isDark ? "rgba(96, 165, 250, .18)" : "rgba(37, 99, 235, .12)",
        bg: isDark ? "#1a2438" : "#f1f5f9"
    };
}

function getTooltip() {
    if (chartTooltipEl && document.body.contains(chartTooltipEl)) return chartTooltipEl;
    const el = document.createElement("div");
    el.className = "chart-tooltip";
    document.body.appendChild(el);
    chartTooltipEl = el;
    return el;
}

function showTooltip(x, y, html) {
    const tt = getTooltip();
    tt.innerHTML = html;
    tt.classList.add("visible");

    const rect = tt.getBoundingClientRect();
    let left = x + 12;
    let top = y - rect.height - 10;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top < 8) top = y + 12;

    tt.style.left = `${left}px`;
    tt.style.top = `${top}px`;
}

function hideTooltip() {
    const tt = getTooltip();
    tt.classList.remove("visible");
}

function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(200, Math.floor(rect.width));
    const cssHeight = Math.max(120, Math.floor(rect.height));
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: cssWidth, height: cssHeight };
}

// ==========================================
// CHART — BARRAS
// ==========================================

function drawBarsChart() {
    const canvas = $("chartBars");
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const colors = getChartColors();

    ctx.clearRect(0, 0, width, height);

    const range = getDashRange();
    const months = [];
    const filteredEntries = getFilteredExpenseEntries(range);

    const filteredByMonth = new Map();
    filteredEntries.forEach(e => {
        if (!filteredByMonth.has(e.monthKey)) filteredByMonth.set(e.monthKey, 0);
        filteredByMonth.set(e.monthKey, filteredByMonth.get(e.monthKey) + e.amount);
    });

    forEachMonthInRange(range.start, range.end, m => {
        const key = monthKey(m);
        const t = computeMonthTotals(m);
        months.push({
            label: m.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
            monthDate: m,
            income: t.income,
            debit: filteredByMonth.get(key) || 0
        });
    });

    if (months.length === 0) {
        ctx.fillStyle = colors.text;
        ctx.font = "13px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Sem dados no período", width / 2, height / 2);
        chartBarsState = null;
        return;
    }

    const padL = 12;
    const padR = 12;
    const padT = 16;
    const padB = 36;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    const maxVal = Math.max(...months.map(m => Math.max(m.income, m.debit)), 1);
    const yScale = chartH / maxVal;

    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
        const y = padT + (chartH / 3) * i;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(width - padR, y);
        ctx.stroke();
    }

    const slotW = chartW / months.length;
    const gap = Math.max(2, slotW * 0.12);
    const barW = Math.max(4, (slotW - gap * 2) / 2 - 2);

    const bars = [];

    months.forEach((m, i) => {
        const slotX = padL + i * slotW;
        const baseY = padT + chartH;
        const cx = slotX + slotW / 2;

        const incH = m.income * yScale;
        const debH = m.debit * yScale;

        const incX = cx - barW - 1;
        const debX = cx + 1;

        if (incH > 0) {
            ctx.fillStyle = colors.income;
            ctx.fillRect(incX, baseY - incH, barW, incH);
            bars.push({ kind: "income", x: incX, y: baseY - incH, w: barW, h: incH, month: m });
        }
        if (debH > 0) {
            ctx.fillStyle = colors.debit;
            ctx.fillRect(debX, baseY - debH, barW, debH);
            bars.push({ kind: "debit", x: debX, y: baseY - debH, w: barW, h: debH, month: m });
        }

        const showEvery = months.length > 8 ? 2 : 1;
        if (i % showEvery === 0 || i === months.length - 1) {
            ctx.fillStyle = colors.text;
            ctx.font = "10px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(m.label, cx, baseY + 8);
        }
    });

    chartBarsState = { bars, canvas, width, height };
}

function bindBarsChart() {
    const canvas = $("chartBars");
    if (!canvas || canvas.dataset.bound === "1") return;
    canvas.dataset.bound = "1";

    function findBar(evt) {
        if (!chartBarsState) return null;
        const rect = canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        for (const b of chartBarsState.bars) {
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
        }
        return null;
    }

    canvas.addEventListener("mousemove", e => {
        const bar = findBar(e);
        if (bar) {
            const monthName = bar.month.monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
            const type = bar.kind === "income" ? "Entradas" : "Saídas";
            const val = bar.kind === "income" ? bar.month.income : bar.month.debit;
            showTooltip(e.clientX, e.clientY, `${type}: ${money(val)}<small>${monthName}</small>`);
        } else hideTooltip();
    });

    canvas.addEventListener("mouseleave", hideTooltip);

    canvas.addEventListener("click", e => {
        const bar = findBar(e);
        if (!bar) return;
        const monthName = bar.month.monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        const type = bar.kind === "income" ? "Entradas" : "Saídas";
        const val = bar.kind === "income" ? bar.month.income : bar.month.debit;
        showTooltip(e.clientX, e.clientY, `${type}: ${money(val)}<small>${monthName}</small>`);
        setTimeout(hideTooltip, 2200);
    });
}

// ==========================================
// CHART — LINHA
// ==========================================

function drawLineChart() {
    const canvas = $("chartLine");
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const colors = getChartColors();

    ctx.clearRect(0, 0, width, height);

    const range = getDashRange();
    const months = [];
    forEachMonthInRange(range.start, range.end, m => {
        const t = computeMonthTotals(m);
        months.push({
            label: m.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
            monthDate: m,
            closing: t.closing
        });
    });

    if (months.length === 0) {
        ctx.fillStyle = colors.text;
        ctx.font = "13px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Sem dados no período", width / 2, height / 2);
        chartLineState = null;
        return;
    }

    const padL = 12;
    const padR = 12;
    const padT = 16;
    const padB = 36;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    const values = months.map(m => m.closing);
    const minV = Math.min(...values, 0);
    const maxV = Math.max(...values, 0);
    const span = Math.max(1, maxV - minV);

    const xStep = months.length > 1 ? chartW / (months.length - 1) : 0;

    function yFor(v) {
        return padT + chartH - ((v - minV) / span) * chartH;
    }

    if (minV < 0 && maxV > 0) {
        const y0 = yFor(0);
        ctx.strokeStyle = colors.grid;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, y0);
        ctx.lineTo(width - padR, y0);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    ctx.strokeStyle = colors.grid;
    for (let i = 0; i <= 3; i++) {
        const y = padT + (chartH / 3) * i;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(width - padR, y);
        ctx.stroke();
    }

    const points = months.map((m, i) => ({
        x: padL + xStep * i,
        y: yFor(m.closing),
        month: m
    }));

    if (points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, padT + chartH);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, padT + chartH);
        ctx.closePath();
        ctx.fillStyle = colors.lineFill;
        ctx.fill();
    }

    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    points.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = colors.line;
        ctx.fill();
        ctx.strokeStyle = colors.bg;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    });

    const showEvery = months.length > 8 ? 2 : 1;
    months.forEach((m, i) => {
        if (i % showEvery !== 0 && i !== months.length - 1) return;
        const x = padL + xStep * i;
        ctx.fillStyle = colors.text;
        ctx.font = "10px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(m.label, x, padT + chartH + 8);
    });

    chartLineState = { points, canvas };
}

function bindLineChart() {
    const canvas = $("chartLine");
    if (!canvas || canvas.dataset.bound === "1") return;
    canvas.dataset.bound = "1";

    function findPoint(evt) {
        if (!chartLineState) return null;
        const rect = canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        for (const p of chartLineState.points) {
            const dx = x - p.x;
            const dy = y - p.y;
            if (dx * dx + dy * dy < 20 * 20) return p;
        }
        return null;
    }

    canvas.addEventListener("mousemove", e => {
        const p = findPoint(e);
        if (p) {
            const monthName = p.month.monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
            showTooltip(e.clientX, e.clientY, `Saldo: ${money(p.month.closing)}<small>${monthName}</small>`);
        } else hideTooltip();
    });

    canvas.addEventListener("mouseleave", hideTooltip);

    canvas.addEventListener("click", e => {
        const p = findPoint(e);
        if (!p) return;
        const monthName = p.month.monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        showTooltip(e.clientX, e.clientY, `Saldo: ${money(p.month.closing)}<small>${monthName}</small>`);
        setTimeout(hideTooltip, 2200);
    });
}

function renderCharts() {
    drawBarsChart();
    drawLineChart();
    bindBarsChart();
    bindLineChart();
}

// ==========================================
// TOP CATEGORIAS / DESCRIÇÕES
// ==========================================

function renderTopLists(range) {
    const entries = getFilteredExpenseEntries(range);
    const byCat = aggregateByCategory(entries).slice(0, 5);
    const byDesc = aggregateByDescription(entries, selectedCategoryKey);

    const catContainer = $("topCategoriesList");
    const descContainer = $("topDescriptionsList");
    const descTitle = $("topDescriptionsTitle");
    const clearBtn = $("clearCategoryFilter");

    if (catContainer) {
        catContainer.innerHTML = "";

        if (byCat.length === 0) {
            const p = document.createElement("p");
            p.className = "dash-top-empty";
            p.textContent = "Sem saídas no período.";
            catContainer.appendChild(p);
        } else {
            byCat.forEach(c => {
                const item = document.createElement("div");
                item.className = "dash-top-item";
                if (selectedCategoryKey === c.key) item.classList.add("selected");

                const dot = document.createElement("span");
                dot.className = "dash-top-item-dot";
                dot.style.background = c.color;

                const name = document.createElement("span");
                name.className = "dash-top-item-name";
                name.textContent = c.name;

                const value = document.createElement("span");
                value.className = "dash-top-item-value";
                value.textContent = money(c.value);

                item.append(dot, name, value);

                item.addEventListener("click", () => {
                    if (selectedCategoryKey === c.key) selectedCategoryKey = null;
                    else selectedCategoryKey = c.key;
                    renderTopLists(getDashRange());
                });

                catContainer.appendChild(item);
            });
        }
    }

    if (descContainer) {
        descContainer.innerHTML = "";

        if (byDesc.length === 0) {
            const p = document.createElement("p");
            p.className = "dash-top-empty";
            p.textContent = selectedCategoryKey
                ? "Sem descrições nessa categoria."
                : "Sem descrições no período.";
            descContainer.appendChild(p);
        } else {
            byDesc.forEach(d => {
                const item = document.createElement("div");
                item.className = "dash-top-item";
                item.style.cursor = "default";

                const dot = document.createElement("span");
                dot.className = "dash-top-item-dot";
                dot.style.background = d.color;

                const name = document.createElement("span");
                name.className = "dash-top-item-name";
                name.textContent = d.name;

                const value = document.createElement("span");
                value.className = "dash-top-item-value";
                value.textContent = money(d.value);

                item.append(dot, name, value);
                descContainer.appendChild(item);
            });
        }
    }

    if (descTitle) {
        const catName = selectedCategoryKey
            ? (aggregateByCategory(entries).find(c => c.key === selectedCategoryKey)?.name || null)
            : null;

        descTitle.textContent = catName
            ? `Top descrições — ${catName}`
            : "Top descrições";
        descTitle.classList.toggle("filtered", !!selectedCategoryKey);
    }

    if (clearBtn) {
        clearBtn.classList.toggle("hidden", !selectedCategoryKey);
    }
}

safeOn("clearCategoryFilter", "click", () => {
    selectedCategoryKey = null;
    renderTopLists(getDashRange());
});