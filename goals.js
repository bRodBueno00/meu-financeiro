/* ============================================================
   MÓDULO METAS — goals.js
   Depende de app.js (carregado antes) e expõe funções globais
   consumidas por app.js via hooks (typeof === "function").
   Persistência local em chave separada; Drive em metas.json.
   ============================================================ */

(function () {
    "use strict";

    // ----- Constantes -----
    const GOALS_STORAGE_KEY = "meuFinanceiroMetas_v1";
    const GOALS_DRIVE_FILE = "metas.json";
    const GOALS_SNAPSHOT_VERSION = 1;

    // ----- Estado -----
    let goals = [];
    let goalContributions = [];
    let goalsCurrentFileId = null;
    let goalsSaveTimer = null;
    let goalsLoaded = false;

    let goalsFilter = "active";          // active | done | archived | all
    let editingGoalId = null;            // null = criando
    let contributingGoalId = null;       // meta recebendo aporte
    let viewingGoalId = null;            // meta no modal de detalhe

    // ============================================================
    // UTILITÁRIOS LOCAIS (não colidem com app.js)
    // ============================================================

    function goalsEl(id) {
    return document.getElementById(id);
    }

    function goalsLocalToday() {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
    }

    function goalsTodayStr() {
        const d = goalsLocalToday();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    function goalsClamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    // ============================================================
    // CÁLCULOS DE META
    // ============================================================

    function monthsUntilDeadline(deadline) {
        if (!deadline) return null;
        const d = parseDate(deadline);
        if (!d) return null;
        const today = goalsLocalToday();
        const months = (d.getFullYear() - today.getFullYear()) * 12 + (d.getMonth() - today.getMonth());
        return months;
    }

    function getContributedAmount(goalId) {
        return goalContributions
            .filter(c => c.goalId === goalId)
            .reduce((s, c) => s + Number(c.amount || 0), 0);
    }

    function getGoalProgress(goal) {
        const contributed = getContributedAmount(goal.id);
        const target = Number(goal.targetAmount || 0);
        const percent = target > 0 ? goalsClamp((contributed / target) * 100, 0, 100) : 0;
        const remaining = Math.max(0, target - contributed);
        const isDone = contributed >= target && target > 0;
        const monthsLeft = monthsUntilDeadline(goal.deadline);

        // Aporte mensal sugerido
        let suggestedMonthly = 0;
        if (!isDone && remaining > 0) {
            if (monthsLeft !== null && monthsLeft > 0) {
                suggestedMonthly = remaining / monthsLeft;
            } else if (monthsLeft !== null && monthsLeft <= 0) {
                suggestedMonthly = null; // prazo vencido — não sugere
            } else {
                suggestedMonthly = null; // sem prazo
            }
        }

        // Aporte mensal efetivo (respeita modo manual)
        let effectiveMonthly = suggestedMonthly;
        if (goal.planMode === "manual" && Number(goal.monthlyPlan) > 0) {
            effectiveMonthly = Number(goal.monthlyPlan);
        }

        // Planejado acumulado = aporte efetivo × meses desde criação
        let plannedAccumulated = null;
        if (effectiveMonthly !== null && effectiveMonthly > 0) {
            const created = parseDate(goal.createdAt);
            const today = goalsLocalToday();
            const elapsed = (today.getFullYear() - created.getFullYear()) * 12
                + (today.getMonth() - created.getMonth()) + 1;
            plannedAccumulated = effectiveMonthly * Math.max(0, elapsed);
        }

        // Status
        let status;
        if (goal.archivedAt) {
            status = "archived";
        } else if (isDone) {
            status = "done";
        } else if (!goal.deadline) {
            status = "no-deadline";
        } else if (monthsLeft !== null && monthsLeft < 0) {
            status = "late";
        } else if (plannedAccumulated !== null && contributed < plannedAccumulated * 0.85) {
            status = "at-risk";
        } else {
            status = "on-track";
        }

        return {
            contributed,
            target,
            percent,
            remaining,
            isDone,
            monthsLeft,
            suggestedMonthly,
            effectiveMonthly,
            plannedAccumulated,
            status
        };
    }

    function goalStatusLabel(status) {
        switch (status) {
            case "done": return "Concluída";
            case "late": return "Atrasada";
            case "at-risk": return "Em risco";
            case "on-track": return "No prazo";
            case "no-deadline": return "Sem prazo";
            case "archived": return "Arquivada";
            default: return "—";
        }
    }

    function goalStatusBadgeClass(status) {
        switch (status) {
            case "done": return "goal-badge-done";
            case "late": return "goal-badge-late";
            case "at-risk": return "goal-badge-at-risk";
            case "on-track": return "goal-badge-on-track";
            case "no-deadline": return "goal-badge-no-deadline";
            case "archived": return "goal-badge-archived";
            default: return "goal-badge-no-deadline";
        }
    }

    // ============================================================
    // PERSISTÊNCIA — localStorage (chave separada)
    // ============================================================

    function getGoalsSnapshot() {
        return {
            version: GOALS_SNAPSHOT_VERSION,
            goals,
            goalContributions
        };
    }

    function saveGoalsData() {
        try {
            localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(getGoalsSnapshot()));
        } catch (e) {
            console.error("Erro ao salvar metas localmente:", e);
            alert("Não foi possível salvar os dados de metas localmente.");
        }
        scheduleGoalsCloudSave();
    }

    function loadGoalsData() {
        try {
            const raw = localStorage.getItem(GOALS_STORAGE_KEY);
            if (!raw) {
                goalsLoaded = true;
                return;
            }
            const data = JSON.parse(raw);
            applyGoalsSnapshot(data);
        } catch (e) {
            console.error("Erro ao carregar metas:", e);
        } finally {
            goalsLoaded = true;
        }
    }

    function applyGoalsSnapshot(data) {
        if (!data || typeof data !== "object") return;

        goals = Array.isArray(data.goals) ? data.goals.map(g => ({
            id: g.id || makeGoalId(),
            name: g.name || "Sem nome",
            targetAmount: Number(g.targetAmount || 0),
            deadline: g.deadline || null,
            priority: g.priority || "medium",
            color: g.color || "#2563eb",
            note: g.note || "",
            createdAt: g.createdAt || goalsTodayStr(),
            archivedAt: g.archivedAt || null,
            planMode: g.planMode === "manual" ? "manual" : "auto",
            monthlyPlan: Number(g.monthlyPlan || 0)
        })) : [];

        goalContributions = Array.isArray(data.goalContributions)
            ? data.goalContributions.map(c => ({
                id: c.id || makeGoalId(),
                goalId: c.goalId,
                amount: Number(c.amount || 0),
                date: c.date,
                monthKey: c.monthKey || (c.date ? c.date.slice(0, 7) : null)
            })).filter(c => c.goalId && c.amount > 0)
            : [];
    }

    function makeGoalId() {
        return crypto.randomUUID
            ? crypto.randomUUID()
            : "g" + Date.now() + Math.random().toString(16).slice(2);
    }

    // ============================================================
    // GOOGLE DRIVE — arquivo metas.json
    // ============================================================

    function goalsCloudAvailable() {
        return typeof accessToken !== "undefined" && !!accessToken
            && typeof driveFetch === "function"
            && typeof findOrCreateFolder === "function"
            && typeof uploadOrUpdateFile === "function";
    }

    function scheduleGoalsCloudSave() {
        if (!goalsCloudAvailable()) return;
        if (goalsSaveTimer) clearTimeout(goalsSaveTimer);
        goalsSaveTimer = setTimeout(() => saveGoalsToDrive(), 1500);
    }

    async function saveGoalsToDrive() {
        if (!goalsCloudAvailable()) return;
        try {
            const folderId = await findOrCreateFolder();
            const body = JSON.stringify(getGoalsSnapshot(), null, 2);
            goalsCurrentFileId = await uploadOrUpdateFile(
                folderId, GOALS_DRIVE_FILE, goalsCurrentFileId, body
            );
        } catch (e) {
            console.error("Erro ao salvar metas no Drive:", e);
        }
    }

    async function loadGoalsFromDrive() {
        if (!goalsCloudAvailable()) return;
        try {
            const folderId = await findOrCreateFolder();

            // Reaproveita findFileInFolder do app.js, que é interno.
            // Como ele não é global, refazemos a busca aqui de forma simples:
            const q = encodeURIComponent(
                `name='${GOALS_DRIVE_FILE}' and '${folderId}' in parents and trashed=false`
            );
            const res = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name,modifiedTime)`);
            const data = await res.json();
            if (!data.files || data.files.length === 0) return;

            goalsCurrentFileId = data.files[0].id;
            const fileRes = await driveFetch(`${DRIVE_API}/files/${goalsCurrentFileId}?alt=media`);
            applyGoalsSnapshot(await fileRes.json());
            localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(getGoalsSnapshot()));
        } catch (e) {
            console.error("Erro ao carregar metas do Drive:", e);
        }
    }

    // Sincronização de metas com o Drive — disparada por eventos do app.js
    document.addEventListener("drive:login", () => {
        loadGoalsFromDrive().then(() => {
            refreshGoalsUI();
            if (typeof refreshCurrentView === "function") refreshCurrentView();
        });
    });

    document.addEventListener("drive:logout", () => {
        goalsCurrentFileId = null;
    });

    // ============================================================
    // HOOKS CONSUMIDOS PELO app.js
    // ============================================================

    // Aportes do dia (usado por getDayValues)
    window.getGoalContributionsForDate = function (date) {
        if (!goalContributions.length) return 0;
        return goalContributions
            .filter(c => c.date === date)
            .reduce((s, c) => s + Number(c.amount || 0), 0);
    };

    // Aportes do dia como objetos (usado pelo modal do dia)
    window.getGoalContributionObjectsByDate = function (date) {
        return goalContributions.filter(c => c.date === date);
    };

    // Abre edição de aporte (usado pelo modal do dia)
    window.openGoalContributionEdit = function (contributionId) {
        const c = goalContributions.find(x => x.id === contributionId);
        if (!c) return;
        openContributionModal(c.goalId, c.id);
    };

    // Exclui aporte (usado pelo modal do dia)
    window.deleteGoalContributionById = function (contributionId) {
        const c = goalContributions.find(x => x.id === contributionId);
        if (!c) return;
        if (!confirm("Excluir este aporte?")) return;

        goalContributions = goalContributions.filter(x => x.id !== contributionId);
        saveGoalsData();
        refreshGoalsUI();
        if (typeof refreshCurrentView === "function") refreshCurrentView();
    };

    // Nome da meta por id (usado pelo modal do dia)
    window.getGoalName = function (goalId) {
        const g = goals.find(x => x.id === goalId);
        return g ? g.name : "Meta";
    };

    // Cor da meta por id (usado pelo modal do dia)
    window.getGoalColor = function (goalId) {
        const g = goals.find(x => x.id === goalId);
        return g ? g.color : "#64748b";
    };

    // Aportes do mês (usado por computeMonthTotals)
    window.getGoalContributionsForMonth = function (date) {
        const key = monthKey(date);
        return goalContributions
            .filter(c => (c.monthKey || (c.date ? c.date.slice(0, 7) : "")) === key)
            .reduce((s, c) => s + Number(c.amount || 0), 0);
    };

    // Bloco no Painel (usado por updatePainel)
    window.renderGoalsPanelBlock = function () {
        const container = goalsEl("goalsPanelBlock");
        if (!container) return;
        container.innerHTML = "";

        const activeGoals = goals.filter(g => !g.archivedAt && !getGoalProgress(g).isDone);
        if (activeGoals.length === 0) {
            const p = document.createElement("p");
            p.className = "helper";
            p.textContent = "Nenhuma meta ativa no momento.";
            container.appendChild(p);
            return;
        }

        const monthKeyValue = monthKey(
            typeof selectedDate !== "undefined" ? selectedDate : goalsLocalToday()
        );

        let planned = 0;
        let realized = 0;
        activeGoals.forEach(g => {
            const prog = getGoalProgress(g);
            if (prog.effectiveMonthly !== null && prog.effectiveMonthly > 0) {
                planned += prog.effectiveMonthly;
            }
            realized += goalContributions
                .filter(c => c.goalId === g.id && (c.monthKey || c.date.slice(0, 7)) === monthKeyValue)
                .reduce((s, c) => s + Number(c.amount || 0), 0);
        });

        const summary = document.createElement("div");
        summary.className = "goals-panel-summary";

        const plannedCard = document.createElement("div");
        plannedCard.innerHTML = `<small>Planejado</small><strong>${money(planned)}</strong>`;

        const realizedCard = document.createElement("div");
        realizedCard.innerHTML = `<small>Aportado no mês</small><strong>${money(realized)}</strong>`;

        summary.append(plannedCard, realizedCard);
        container.appendChild(summary);

        const missing = Math.max(0, planned - realized);
        const message = document.createElement("div");
        message.className = "goals-panel-message" + (missing > 0 ? " warn" : "");
        message.textContent = missing > 0
            ? `Faltam ${money(missing)} para cumprir o plano de aportes deste mês.`
            : `Plano de aportes deste mês cumprido. 👏`;
        container.appendChild(message);

    };

    // Bloco no Dashboard (usado por renderDashboard)
    window.renderGoalsDashboardBlock = function (range) {
        const container = goalsEl("goalsDashboardBlock");
        if (!container) return;
        container.innerHTML = "";

        const activeGoals = goals.filter(g => !g.archivedAt);
        if (activeGoals.length === 0) {
            const p = document.createElement("p");
            p.className = "helper";
            p.textContent = "Nenhuma meta cadastrada.";
            container.appendChild(p);
            return;
        }

        // KPIs agregados
        let totalContributed = 0;
        let totalTarget = 0;
        let realizedInRange = 0;
        let plannedInRange = 0;

        activeGoals.forEach(g => {
            const prog = getGoalProgress(g);
            totalContributed += prog.contributed;
            totalTarget += prog.target;
        });

        if (range && range.start && range.end) {
            goalContributions.forEach(c => {
                const d = parseDate(c.date);
                if (d && d >= range.start && d <= range.end) {
                    realizedInRange += Number(c.amount || 0);
                }
            });

            const start = new Date(range.start.getFullYear(), range.start.getMonth(), 1, 12);
            const end = new Date(range.end.getFullYear(), range.end.getMonth(), 1, 12);
            activeGoals.forEach(g => {
                const prog = getGoalProgress(g);
                if (prog.effectiveMonthly && prog.effectiveMonthly > 0) {
                    const created = parseDate(g.createdAt);
                    let cursor = new Date(start);
                    while (cursor <= end) {
                        if (cursor >= created) plannedInRange += prog.effectiveMonthly;
                        cursor.setMonth(cursor.getMonth() + 1);
                    }
                }
            });
        }

        const pct = totalTarget > 0 ? (totalContributed / totalTarget) * 100 : 0;

        const kpis = document.createElement("div");
        kpis.className = "goals-dash-kpis";

        const kpi1 = document.createElement("div");
        kpi1.className = "goals-dash-kpi accent-green";
        kpi1.innerHTML = `<small>Total aportado (todas as metas)</small><strong>${money(totalContributed)}</strong>`;

        const kpi2 = document.createElement("div");
        kpi2.className = "goals-dash-kpi";
        kpi2.innerHTML = `<small>Progresso geral</small><strong>${pct.toFixed(1)}%</strong>`;

        const kpi3 = document.createElement("div");
        kpi3.className = "goals-dash-kpi";
        kpi3.innerHTML = `<small>Aportado no período</small><strong>${money(realizedInRange)}</strong>`;

        const kpi4 = document.createElement("div");
        kpi4.className = "goals-dash-kpi accent-red";
        const diff = plannedInRange - realizedInRange;
        kpi4.innerHTML = `<small>Planejado − Realizado no período</small><strong class="${diff > 0 ? "negative" : ""}">${money(diff)}</strong>`;

        kpis.append(kpi1, kpi2, kpi3, kpi4);
        container.appendChild(kpis);
    };

    // View principal (usado por refreshCurrentView)
    window.renderGoalsView = function () {
        renderGoalsSummary();
        renderGoalsList();
    };

    // Hook: retorna aportes no range, no mesmo formato de entry usado pelo dashboard
    window.getGoalEntriesForRange = function (range, filters) {
        if (!filters || !filters.types || !filters.types.goals) return [];
        const out = [];
        forEachMonthInRange(range.start, range.end, monthDate => {
            const key = monthKey(monthDate);
            goalContributions.forEach(c => {
                if ((c.monthKey || (c.date ? c.date.slice(0, 7) : "")) !== key) return;
                if (filters.minValue !== null && c.amount < filters.minValue) return;
                if (filters.maxValue !== null && c.amount > filters.maxValue) return;
                const goal = goals.find(g => g.id === c.goalId);
                out.push({
                    monthKey: key,
                    amount: c.amount,
                    categoryId: "goal:" + c.goalId,
                    categoryName: goal ? `Meta: ${goal.name}` : "Meta",
                    categoryColor: goal ? goal.color : "#64748b",
                    description: goal ? `Aporte — ${goal.name}` : "Aporte em meta",
                    recurring: false,
                    isGoal: true
                });
            });
        });
        return out;
    };

    // Ganchos de backup/reset usados pelo app.js
    window.getGoalsBackupBlock = function () {
        return { goals, goalContributions };
    };

    window.applyGoalsBackupBlock = function (block) {
        if (!block || typeof block !== "object") return;
        applyGoalsSnapshot({
            version: GOALS_SNAPSHOT_VERSION,
            goals: block.goals || [],
            goalContributions: block.goalContributions || []
        });
        localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(getGoalsSnapshot()));
        refreshGoalsUI();
    };

    window.clearAllGoalsData = function () {
        goals = [];
        goalContributions = [];
        goalsCurrentFileId = null;
        localStorage.removeItem(GOALS_STORAGE_KEY);
        refreshGoalsUI();
    };

    window.clearGoalsDataForMonth = function (year, monthIndex) {
        const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
        goalContributions = goalContributions.filter(c => {
            const mk = c.monthKey || (c.date ? c.date.slice(0, 7) : "");
            return mk !== key;
        });
        localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(getGoalsSnapshot()));
        refreshGoalsUI();
    };

    // ============================================================
    // RENDER — Aba Metas
    // ============================================================

    function renderGoalsSummary() {
        const container = goalsEl("goalsSummary");
        if (!container) return;
        container.innerHTML = "";

        const active = goals.filter(g => !g.archivedAt && !getGoalProgress(g).isDone);
        if (active.length === 0) return; // sem resumo se não há ativas

        const totalContributed = active.reduce((s, g) => s + getGoalProgress(g).contributed, 0);
        const totalPlanned = active.reduce((s, g) => {
            const p = getGoalProgress(g);
            return s + (p.effectiveMonthly || 0);
        }, 0);

        const card1 = document.createElement("div");
        card1.className = "goals-summary-card";
        card1.innerHTML = `<small>Já aportado (ativas)</small><strong>${money(totalContributed)}</strong>`;

        const card2 = document.createElement("div");
        card2.className = "goals-summary-card";
        card2.innerHTML = `<small>Plano mensal (ativas)</small><strong>${money(totalPlanned)}</strong>`;

        container.append(card1, card2);
    }

    function renderGoalsList() {
        const container = goalsEl("goalsList");
        if (!container) return;
        container.innerHTML = "";

        const filtered = goals.filter(g => {
            const prog = getGoalProgress(g);
            switch (goalsFilter) {
                case "active": return !g.archivedAt && !prog.isDone;
                case "done": return !g.archivedAt && prog.isDone;
                case "archived": return !!g.archivedAt;
                case "all": return true;
                default: return true;
            }
        });

        // Ordenação: prioridade (high > medium > low), depois prazo, depois nome
        const priorityRank = { high: 0, medium: 1, low: 2 };
        filtered.sort((a, b) => {
            const pa = priorityRank[a.priority] ?? 1;
            const pb = priorityRank[b.priority] ?? 1;
            if (pa !== pb) return pa - pb;
            const da = a.deadline || "9999-99";
            const db = b.deadline || "9999-99";
            if (da !== db) return da.localeCompare(db);
            return a.name.localeCompare(b.name, "pt-BR");
        });

        if (filtered.length === 0) {
            const empty = document.createElement("div");
            empty.className = "goals-empty";
            empty.innerHTML = `<strong>Nenhuma meta aqui.</strong>Crie uma nova meta ou ajuste o filtro.`;
            container.appendChild(empty);
            return;
        }

        filtered.forEach(goal => {
            container.appendChild(buildGoalCard(goal));
        });
    }

    function buildGoalCard(goal) {
        const prog = getGoalProgress(goal);
        const card = document.createElement("div");
        card.className = "goal-card";
        if (prog.isDone) card.classList.add("is-done");
        if (prog.status === "late") card.classList.add("is-late");

        // Header
        const header = document.createElement("div");
        header.className = "goal-card-header";

        const titleWrap = document.createElement("div");
        titleWrap.className = "goal-card-title";

        const dot = document.createElement("span");
        dot.className = "goal-card-dot";
        dot.style.background = goal.color;

        const nameWrap = document.createElement("div");
        const name = document.createElement("div");
        name.className = "goal-card-name";
        name.textContent = goal.name;
        nameWrap.appendChild(name);

        if (goal.note) {
            const note = document.createElement("span");
            note.className = "goal-card-note";
            note.textContent = goal.note;
            nameWrap.appendChild(note);
        }

        titleWrap.append(dot, nameWrap);

        const badge = document.createElement("span");
        badge.className = "goal-card-badge " + goalStatusBadgeClass(prog.status);
        badge.textContent = goalStatusLabel(prog.status);

        header.append(titleWrap, badge);

        // Barra
        const track = document.createElement("div");
        track.className = "goal-progress-track";
        const fill = document.createElement("div");
        fill.className = "goal-progress-fill";
        fill.style.width = prog.percent + "%";
        fill.style.background = goal.color;
        track.appendChild(fill);

        // Valores
        const values = document.createElement("div");
        values.className = "goal-card-values";

        const v1 = document.createElement("div");
        v1.innerHTML = `<small>Aportado</small><strong class="positive">${money(prog.contributed)}</strong>`;

        const v2 = document.createElement("div");
        v2.innerHTML = `<small>Faltando</small><strong class="${prog.remaining > 0 ? "negative" : ""}">${money(prog.remaining)}</strong>`;

        const v3 = document.createElement("div");
        v3.innerHTML = `<small>${goal.deadline ? "Prazo" : "Sem prazo"}</small><strong>${goal.deadline ? formatMonth(goal.deadline) : "—"}</strong>`;

        const v4 = document.createElement("div");
        v4.innerHTML = `<small>Aporte mensal</small><strong>${prog.effectiveMonthly && prog.effectiveMonthly > 0 ? money(prog.effectiveMonthly) : "—"}</strong>`;

        values.append(v1, v2, v3, v4);

        // Ações
        const actions = document.createElement("div");
        actions.className = "goal-card-actions";

        const contributeBtn = document.createElement("button");
        contributeBtn.className = "primary-button";
        contributeBtn.textContent = "Aportar";
        contributeBtn.addEventListener("click", () => openContributionModal(goal.id));

        const moreBtn = document.createElement("button");
        moreBtn.className = "icon-button";
        moreBtn.textContent = "⋯";
        moreBtn.title = "Detalhes";
        moreBtn.addEventListener("click", () => openDetailModal(goal.id));

        actions.append(contributeBtn, moreBtn);

        card.append(header, track, values, actions);
        return card;
    }

    // ============================================================
    // MODAIS — Formulário de meta
    // ============================================================

    function openGoalForm(goalId) {
        editingGoalId = goalId || null;
        const title = goalsEl("goalFormTitle");
        const subtitle = goalsEl("goalFormSubtitle");
        const form = goalsEl("goalForm");
        if (form) form.reset();

        if (goalId) {
            const g = goals.find(x => x.id === goalId);
            if (!g) return;
            if (title) title.textContent = "Editar meta";
            if (subtitle) subtitle.textContent = "Altere os dados da meta.";

            if (goalsEl("goalName")) goalsEl("goalName").value = g.name;
            if (goalsEl("goalTargetAmount")) goalsEl("goalTargetAmount").value = g.targetAmount;
            if (goalsEl("goalDeadline")) goalsEl("goalDeadline").value = g.deadline || "";
            if (goalsEl("goalPriority")) goalsEl("goalPriority").value = g.priority;
            if (goalsEl("goalColor")) goalsEl("goalColor").value = g.color;
            if (goalsEl("goalNote")) goalsEl("goalNote").value = g.note || "";

            const isManual = g.planMode === "manual";
            if (goalsEl("goalPlanManualToggle")) goalsEl("goalPlanManualToggle").checked = isManual;
            if (goalsEl("goalPlanManualContainer")) goalsEl("goalPlanManualContainer").classList.toggle("hidden", !isManual);
            if (goalsEl("goalPlanManual")) goalsEl("goalPlanManual").value = isManual ? g.monthlyPlan : "";
        } else {
            if (title) title.textContent = "Nova meta";
            if (subtitle) subtitle.textContent = "Defina o objetivo e o prazo (opcional).";
            if (goalsEl("goalPlanManualContainer")) goalsEl("goalPlanManualContainer").classList.add("hidden");
        }

        updateGoalPlanPreview();
        goalsEl("goalFormModal").classList.remove("hidden");
        if (goalsEl("goalName")) goalsEl("goalName").focus();
    }

    function closeGoalForm() {
        goalsEl("goalFormModal").classList.add("hidden");
        editingGoalId = null;
    }

    function updateGoalPlanPreview() {
        const preview = goalsEl("goalPlanPreview");
        const valueEl = goalsEl("goalPlanPreviewValue");
        const hintEl = goalsEl("goalPlanPreviewHint");
        if (!preview) return;

        const target = Number(goalsEl("goalTargetAmount")?.value || 0);
        const deadline = goalsEl("goalDeadline")?.value || "";
        const manual = goalsEl("goalPlanManualToggle")?.checked;

        if (manual) {
            preview.classList.add("hidden");
            return;
        }
        if (!target || !deadline) {
            preview.classList.add("hidden");
            return;
        }

        const months = monthsUntilDeadline(deadline);
        preview.classList.remove("hidden");

        if (months === null) {
            valueEl.textContent = "—";
            hintEl.textContent = "Prazo inválido.";
            return;
        }
        if (months <= 0) {
            valueEl.textContent = "—";
            hintEl.textContent = "O prazo já passou. Considere ajustar o mês.";
            return;
        }

        const monthly = target / months;
        valueEl.textContent = money(monthly) + " / mês";
        hintEl.textContent = `Para chegar em ${months} ${months === 1 ? "mês" : "meses"}, o aporte mensal seria ${money(monthly)}. O app não avalia se esse valor é viável — é apenas referência.`;
    }

    // ============================================================
    // MODAIS — Aporte
    // ============================================================

    let editingContributionId = null;

    function openContributionModal(goalId, contributionId) {
        const goal = goals.find(g => g.id === goalId);
        if (!goal) return;
        contributingGoalId = goalId;
        editingContributionId = contributionId || null;

        const label = goalsEl("goalContributionGoalLabel");
        if (label) label.textContent = `Meta: ${goal.name}`;

        const form = goalsEl("goalContributionForm");
        if (form) form.reset();

        if (editingContributionId) {
            const c = goalContributions.find(x => x.id === editingContributionId);
            if (c) {
                if (goalsEl("goalContributionAmount")) goalsEl("goalContributionAmount").value = c.amount;
                if (goalsEl("goalContributionDate")) goalsEl("goalContributionDate").value = c.date;
                if (label) label.textContent = `Editando aporte — ${goal.name}`;
            }
        } else {
            if (goalsEl("goalContributionDate")) goalsEl("goalContributionDate").value = goalsTodayStr();
        }

        updateContributionImpactHint();

        goalsEl("goalContributionModal").classList.remove("hidden");
        if (goalsEl("goalContributionAmount")) goalsEl("goalContributionAmount").focus();
    }

    function closeContributionModal() {
        goalsEl("goalContributionModal").classList.add("hidden");
        contributingGoalId = null;
        editingContributionId = null;
    }

    function updateContributionImpactHint() {
        const hint = goalsEl("goalContributionImpactHint");
        if (!hint) return;
        const amt = Number(goalsEl("goalContributionAmount")?.value || 0);
        if (!amt) { hint.textContent = ""; return; }
        hint.textContent = `Este aporte será descontado do saldo do mês correspondente e creditado na meta. Não entra no comparativo de gastos.`;
    }

    // ============================================================
    // MODAIS — Detalhe
    // ============================================================

    function openDetailModal(goalId) {
        const goal = goals.find(g => g.id === goalId);
        if (!goal) return;
        viewingGoalId = goalId;

        const prog = getGoalProgress(goal);

        if (goalsEl("goalDetailTitle")) goalsEl("goalDetailTitle").textContent = goal.name;
        if (goalsEl("goalDetailMeta")) {
            const parts = [];
            parts.push(`Alvo: ${money(prog.target)}`);
            parts.push(goal.deadline ? `Prazo: ${formatMonth(goal.deadline)}` : "Sem prazo");
            parts.push(`Prioridade: ${goal.priority === "high" ? "Alta" : goal.priority === "low" ? "Baixa" : "Média"}`);
            goalsEl("goalDetailMeta").textContent = parts.join(" • ");
        }

        const progress = goalsEl("goalDetailProgress");
        if (progress) {
            progress.innerHTML = "";
            const track = document.createElement("div");
            track.className = "goal-progress-track";
            const fill = document.createElement("div");
            fill.className = "goal-progress-fill";
            fill.style.width = prog.percent + "%";
            fill.style.background = goal.color;
            track.appendChild(fill);
            progress.appendChild(track);

            const stats = document.createElement("div");
            stats.className = "goal-detail-stats";
            stats.innerHTML = `
                <div><small>Aportado</small><strong>${money(prog.contributed)}</strong></div>
                <div><small>Faltando</small><strong>${money(prog.remaining)}</strong></div>
                <div><small>Aporte mensal</small><strong>${prog.effectiveMonthly && prog.effectiveMonthly > 0 ? money(prog.effectiveMonthly) : "—"}</strong></div>
                <div><small>Progresso</small><strong>${prog.percent.toFixed(1)}%</strong></div>
            `;
            progress.appendChild(stats);
        }

        const contribs = goalsEl("goalDetailContributions");
        if (contribs) {
            contribs.innerHTML = "";
            const title = document.createElement("h4");
            title.textContent = "Histórico de aportes";
            contribs.appendChild(title);

            const list = goalContributions
                .filter(c => c.goalId === goalId)
                .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

            if (list.length === 0) {
                const p = document.createElement("p");
                p.className = "helper";
                p.textContent = "Nenhum aporte registrado ainda.";
                contribs.appendChild(p);
            } else {
                list.forEach(c => {
                    const row = document.createElement("div");
                    row.className = "goal-contribution-row";

                    const dateEl = document.createElement("span");
                    dateEl.className = "goal-contribution-date";
                    dateEl.textContent = formatDate(c.date);

                    const amtEl = document.createElement("span");
                    amtEl.className = "goal-contribution-amount";
                    amtEl.textContent = money(c.amount);

                    const del = document.createElement("button");
                    del.className = "delete-button";
                    del.textContent = "✕";
                    del.title = "Excluir aporte";
                    del.addEventListener("click", () => deleteContribution(c.id));

                    row.append(dateEl, amtEl, del);
                    contribs.appendChild(row);
                });
            }
        }

        // Botão arquivar
        const archiveBtn = goalsEl("goalDetailArchiveButton");
        if (archiveBtn) {
            archiveBtn.textContent = goal.archivedAt ? "Desarquivar" : "Arquivar";
            archiveBtn.onclick = () => toggleArchiveGoal(goal.id);
        }

        goalsEl("goalDetailModal").classList.remove("hidden");
    }

    function closeDetailModal() {
        goalsEl("goalDetailModal").classList.add("hidden");
        viewingGoalId = null;
    }

    // ============================================================
    // CRUD
    // ============================================================

    function handleGoalFormSubmit(event) {
        event.preventDefault();

        const name = (goalsEl("goalName")?.value || "").trim();
        const targetAmount = Number(goalsEl("goalTargetAmount")?.value || 0);
        const deadline = goalsEl("goalDeadline")?.value || null;
        const priority = goalsEl("goalPriority")?.value || "medium";
        const color = goalsEl("goalColor")?.value || "#2563eb";
        const note = (goalsEl("goalNote")?.value || "").trim();
        const manual = !!goalsEl("goalPlanManualToggle")?.checked;
        const monthlyPlan = manual ? Number(goalsEl("goalPlanManual")?.value || 0) : 0;

        if (!name) { alert("Informe um nome para a meta."); return; }
        if (!targetAmount || targetAmount <= 0) { alert("Informe um valor-alvo válido."); return; }
        if (manual && (!monthlyPlan || monthlyPlan <= 0)) {
            alert("Informe um aporte mensal manual válido (ou desmarque a opção).");
            return;
        }

        if (editingGoalId) {
            const goal = goals.find(g => g.id === editingGoalId);
            if (!goal) return;
            goal.name = name;
            goal.targetAmount = targetAmount;
            goal.deadline = deadline || null;
            goal.priority = priority;
            goal.color = color;
            goal.note = note;
            goal.planMode = manual ? "manual" : "auto";
            goal.monthlyPlan = manual ? monthlyPlan : 0;
        } else {
            goals.push({
                id: makeGoalId(),
                name,
                targetAmount,
                deadline: deadline || null,
                priority,
                color,
                note,
                createdAt: goalsTodayStr(),
                archivedAt: null,
                planMode: manual ? "manual" : "auto",
                monthlyPlan: manual ? monthlyPlan : 0
            });
        }

        saveGoalsData();
        closeGoalForm();
        refreshGoalsUI();
    }

    function handleContributionSubmit(event) {
        event.preventDefault();
        if (!contributingGoalId) return;

        const amount = Number(goalsEl("goalContributionAmount")?.value || 0);
        const date = goalsEl("goalContributionDate")?.value || goalsTodayStr();

        if (!amount || amount <= 0) { alert("Informe um valor válido."); return; }
        if (!date) { alert("Informe uma data."); return; }

        if (editingContributionId) {
            const c = goalContributions.find(x => x.id === editingContributionId);
            if (c) {
                c.amount = amount;
                c.date = date;
                c.monthKey = date.slice(0, 7);
            }
        } else {
            goalContributions.push({
                id: makeGoalId(),
                goalId: contributingGoalId,
                amount,
                date,
                monthKey: date.slice(0, 7)
            });
        }

        saveGoalsData();
        closeContributionModal();

        refreshGoalsUI();
        if (typeof refreshCurrentView === "function") refreshCurrentView();
    }

    function deleteContribution(id) {
        const c = goalContributions.find(x => x.id === id);
        if (!c) return;
        if (!confirm("Excluir este aporte?")) return;

        goalContributions = goalContributions.filter(x => x.id !== id);
        saveGoalsData();
        refreshGoalsUI();
        if (typeof refreshCurrentView === "function") refreshCurrentView();
        if (viewingGoalId) openDetailModal(viewingGoalId);
    }

    function toggleArchiveGoal(id) {
        const goal = goals.find(g => g.id === id);
        if (!goal) return;
        if (goal.archivedAt) {
            goal.archivedAt = null;
        } else {
            if (!confirm(`Arquivar a meta "${goal.name}"? Ela não aparecerá nas metas ativas, mas o histórico é mantido.`)) return;
            goal.archivedAt = goalsTodayStr();
        }
        saveGoalsData();
        refreshGoalsUI();
        closeDetailModal();
    }

    // ============================================================
    // NAVEGAÇÃO E UI
    // ============================================================

    function switchToGoalsTab() {
        // Reaproveita a lógica de troca de abas se existir; senão, faz manual
        if (typeof currentView !== "undefined") {
            // segue o padrão do app: usa variáveis globais de view
            // Não temos acesso direto à função que troca abas no app.js,
            // então simulamos o clique na aba Metas.
        }
        const tab = goalsEl("tabMetas");
        if (tab) tab.click();
    }

    function refreshGoalsUI() {
        if (goalsEl("goalsSummary")) renderGoalsSummary();
        if (goalsEl("goalsList")) renderGoalsList();
    }

    // ============================================================
    // LISTENERS
    // ============================================================

    function bindGoalListeners() {
        // Aba Metas
        safeOn("tabMetas", "click", () => {
            const painel = goalsEl("painelView");
            const dash = goalsEl("dashboardView");
            const metas = goalsEl("metasView");
            const headerPainel = goalsEl("painelHeaderContent");

            if (painel) painel.classList.add("hidden");
            if (dash) dash.classList.add("hidden");
            if (metas) metas.classList.remove("hidden");
            if (headerPainel) headerPainel.classList.add("hidden");

            document.querySelectorAll(".app-tab").forEach(b => b.classList.remove("active"));
            const t = goalsEl("tabMetas");
            if (t) t.classList.add("active");

            renderGoalsView();
        });

        // Ao trocar para Painel ou Dashboard, esconde a view de Metas
        ["tabPainel", "tabDashboard"].forEach(id => {
            const btn = goalsEl(id);
            if (!btn) return;
            btn.addEventListener("click", () => {
                const metas = goalsEl("metasView");
                if (metas) metas.classList.add("hidden");
                const t = goalsEl("tabMetas");
                if (t) t.classList.remove("active");
                if (id === "tabPainel") {
                    const headerPainel = goalsEl("painelHeaderContent");
                    if (headerPainel) headerPainel.classList.remove("hidden");
                }
            });
        });

        // Botão nova meta
        safeOn("openNewGoalButton", "click", () => openGoalForm(null));

        // Filtros
        document.querySelectorAll(".goals-filter-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                document.querySelectorAll(".goals-filter-chip").forEach(c => c.classList.remove("active"));
                chip.classList.add("active");
                goalsFilter = chip.getAttribute("data-goal-filter") || "active";
                renderGoalsList();
            });
        });

        // Form de meta
        safeOn("goalForm", "submit", handleGoalFormSubmit);
        safeOn("closeGoalFormModal", "click", closeGoalForm);
        safeOn("goalFormModal", "click", e => {
            if (e.target === goalsEl("goalFormModal")) closeGoalForm();
        });

        // Preview do plano
        safeOn("goalTargetAmount", "input", updateGoalPlanPreview);
        safeOn("goalDeadline", "change", updateGoalPlanPreview);
        safeOn("goalPlanManualToggle", "change", () => {
            const manual = !!goalsEl("goalPlanManualToggle")?.checked;
            if (goalsEl("goalPlanManualContainer")) {
                goalsEl("goalPlanManualContainer").classList.toggle("hidden", !manual);
            }
            updateGoalPlanPreview();
        });

        // Aporte
        safeOn("goalContributionForm", "submit", handleContributionSubmit);
        safeOn("closeGoalContributionModal", "click", closeContributionModal);
        safeOn("goalContributionModal", "click", e => {
            if (e.target === goalsEl("goalContributionModal")) closeContributionModal();
        });
        safeOn("goalContributionAmount", "input", updateContributionImpactHint);

        // Detalhe
        safeOn("closeGoalDetailModal", "click", closeDetailModal);
        safeOn("goalDetailModal", "click", e => {
            if (e.target === goalsEl("goalDetailModal")) closeDetailModal();
        });
    }

    // ============================================================
    // INICIALIZAÇÃO
    // ============================================================

    function initGoals() {
        loadGoalsData();
        bindGoalListeners();

       // Se app.js já estiver logado no Drive, carrega metas na inicialização
        if (goalsCloudAvailable()) {
            loadGoalsFromDrive().then(() => {
                refreshGoalsUI();
                if (typeof refreshCurrentView === "function") refreshCurrentView();
            });
        }

        // Redesenha a view atual com os dados de metas já carregados
        if (typeof refreshCurrentView === "function") refreshCurrentView();
    }

    // Aguarda DOM pronto (o script é carregado no fim do body, então já está)
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initGoals);
    } else {
        initGoals();
    }

})();