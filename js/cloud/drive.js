const STORAGE_KEY = "meuFinanceiroDados_v2";

const CLIENT_ID = "127934343018-kpdvptdrvp8ov899cjii6okrmv2u17d2.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "MeuFinanceiro";
const FILE_NAME = "financeiro.json";
const RECURRING_FILE_NAME = "recorrentes.json";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

// ==========================================
// GOOGLE DRIVE
// ==========================================

function setCloudStatus(text) {
    const el = $("cloudStatus");
    if (el) el.textContent = text;
}

function updateCloudButtons() {
    const logged = !!accessToken;
    const loginBtn = $("googleLoginButton");
    const logoutBtn = $("googleLogoutButton");
    const syncBtn = $("syncNowButton");
    if (loginBtn) loginBtn.classList.toggle("hidden", logged);
    if (logoutBtn) logoutBtn.classList.toggle("hidden", !logged);
    if (syncBtn) syncBtn.classList.toggle("hidden", !logged);
}

function initGoogleAuth() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
        setTimeout(initGoogleAuth, 300);
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (response) => {
            if (response.error) { setCloudStatus("Drive: falha no login"); return; }

            accessToken = response.access_token;
            const expiresIn = Number(response.expires_in || 3600);
            localStorage.setItem("meuFinanceiroToken", JSON.stringify({
                token: accessToken,
                expiresAt: Date.now() + expiresIn * 1000
            }));

            setCloudStatus("Drive: conectado");
            updateCloudButtons();
            document.dispatchEvent(new CustomEvent("drive:login"));
            await loadFromDrive();
        }
    });

    tokenClient.requestAccessToken({ prompt: "" });
}

function loginGoogle() {
    if (!tokenClient) {
        alert("A biblioteca do Google ainda não carregou. Aguarde e tente novamente.");
        return;
    }
    tokenClient.requestAccessToken({ prompt: "" });
}

function logoutGoogle() {
    if (accessToken && window.google && google.accounts.oauth2) {
        google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    currentFileId = null;
    currentRecurringFileId = null;
    localStorage.removeItem("meuFinanceiroToken");
    setCloudStatus("Drive: desconectado");
    updateCloudButtons();
    document.dispatchEvent(new CustomEvent("drive:logout"));
}

async function driveFetch(url, options = {}) {
    const opts = {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` }
    };
    const response = await fetch(url, opts);
    if (response.status === 401) {
        logoutGoogle();
        throw new Error("Sessão expirada. Faça login novamente.");
    }
    return response;
}

async function findOrCreateFolder() {
    const query = encodeURIComponent(
        `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const res = await driveFetch(`${DRIVE_API}/files?q=${query}&fields=files(id,name)`);
    const data = await res.json();
    if (data.files && data.files.length > 0) return data.files[0].id;

    const createRes = await driveFetch(`${DRIVE_API}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
    });
    const created = await createRes.json();
    return created.id;
}

async function findFileInFolder(folderId, fileName) {
    const query = encodeURIComponent(
        `name='${fileName}' and '${folderId}' in parents and trashed=false`
    );
    const res = await driveFetch(`${DRIVE_API}/files?q=${query}&fields=files(id,name,modifiedTime)`);
    const data = await res.json();
    if (data.files && data.files.length > 0) return data.files[0];
    return null;
}

async function loadFromDrive() {
    if (!accessToken) return;
    try {
        setCloudStatus("Drive: carregando...");
        const folderId = await findOrCreateFolder();
        const file = await findFileInFolder(folderId, FILE_NAME);
        const recurringFile = await findFileInFolder(folderId, RECURRING_FILE_NAME);

        if (!file && !recurringFile) {
            setCloudStatus("Drive: conectado (sem arquivo ainda)");
            currentFileId = null;
            currentRecurringFileId = null;
            return;
        }

        if (file) {
            currentFileId = file.id;
            const res = await driveFetch(`${DRIVE_API}/files/${file.id}?alt=media`);
            applyDataSnapshot(await res.json());
        }

        if (recurringFile) {
            currentRecurringFileId = recurringFile.id;
            const res = await driveFetch(`${DRIVE_API}/files/${recurringFile.id}?alt=media`);
            applyRecurringSnapshot(await res.json());
        }

        rebuildSavedDescriptions();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...getDataSnapshot(), recurring }));
        setCloudStatus("Drive: dados carregados");
    } catch (error) {
        setCloudStatus("Drive: erro ao carregar");
        console.error(error);
    } finally {
        refreshCurrentView();
    }
}

function scheduleCloudSave() {
    if (!accessToken) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveToDrive(), 1200);
}

async function uploadOrUpdateFile(folderId, fileName, currentId, body) {
    if (!currentId) {
        const existing = await findFileInFolder(folderId, fileName);
        if (existing) currentId = existing.id;
    }

    if (!currentId) {
        const metadata = { name: fileName, mimeType: "application/json", parents: [folderId] };
        const form = new FormData();
        form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        form.append("file", new Blob([body], { type: "application/json" }));

        const res = await driveFetch(
            `${UPLOAD_API}/files?uploadType=multipart&fields=id`,
            { method: "POST", body: form }
        );
        const created = await res.json();
        return created.id;
    }

    const res = await driveFetch(
        `${UPLOAD_API}/files/${currentId}?uploadType=media`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body }
    );
    if (!res.ok) throw new Error("Falha ao atualizar arquivo");
    return currentId;
}

async function saveToDrive() {
    if (!accessToken) return;
    try {
        setCloudStatus("Drive: salvando...");
        const folderId = await findOrCreateFolder();
        const financeiroBody = JSON.stringify(getDataSnapshot(), null, 2);
        const recurringBody = JSON.stringify(getRecurringSnapshot(), null, 2);

        currentFileId = await uploadOrUpdateFile(folderId, FILE_NAME, currentFileId, financeiroBody);
        currentRecurringFileId = await uploadOrUpdateFile(folderId, RECURRING_FILE_NAME, currentRecurringFileId, recurringBody);

        setCloudStatus("Drive: salvo ✓");
    } catch (error) {
        setCloudStatus("Drive: erro ao salvar");
        console.error(error);
    }
}
