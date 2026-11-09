// State aplikasi
let currentSettings = {};
let availableOptions = { piModels: [] };
let currentCustomModels = {};

// DOM Elements
const form = document.getElementById("settingsForm");
const botTokenInput = document.getElementById("botToken");
const toggleTokenBtn = document.getElementById("toggleTokenVisibility");
const eyeIcon = document.getElementById("eyeIcon");
const btnTestToken = document.getElementById("btnTestToken");
const tokenTestResult = document.getElementById("tokenTestResult");
const botResultName = document.getElementById("botResultName");
const botResultUser = document.getElementById("botResultUser");
const botTelegramLink = document.getElementById("botTelegramLink");

const allowedIdsInput = document.getElementById("allowedIds");
const idChipsContainer = document.getElementById("idChipsContainer");

const cliEngineSelect = document.getElementById("cliEngine");
const cmdMaxTurnsInput = document.getElementById("cmdMaxTurns");
const piModelSelect = document.getElementById("piModel");
const piServerUrlInput = document.getElementById("piServerUrl");
const btnGetPiModels = document.getElementById("btnGetPiModels");
const groupPiModel = document.getElementById("groupPiModel");
const scopeRoleRootRadio = document.getElementById("scopeRoleRoot");
const scopeRoleCustomRadio = document.getElementById("scopeRoleCustom");
const scopeRoleBadge = document.getElementById("scopeRoleBadge");
const customFoldersContainer = document.getElementById("customFoldersContainer");
const customFoldersInput = document.getElementById("customFoldersInput");
const piSandboxToggle = document.getElementById("piSandboxToggle");
const piSandboxBadge = document.getElementById("piSandboxBadge");
const timeoutInput = document.getElementById("timeoutMs");
const timeoutFormatted = document.getElementById("timeoutFormatted");
const maxTimeoutInput = document.getElementById("maxTimeoutMs");
const maxTimeoutFormatted = document.getElementById("maxTimeoutFormatted");

const badgeEngine = document.getElementById("badgeEngine");
const badgeModel = document.getElementById("badgeModel");
const badgeToken = document.getElementById("badgeToken");
const badgeHost = document.getElementById("badgeHost");

const piServerApiKeyInput = document.getElementById("piServerApiKey");
const togglePiServerKeyBtn = document.getElementById("togglePiServerKey");
const eyePiServerIcon = document.getElementById("eyePiServerIcon");
const badgePiServerKey = document.getElementById("badgePiServerKey");

// Automation & GitHub Elements
const githubTokenInput = document.getElementById("githubToken");
const toggleGithubKeyBtn = document.getElementById("toggleGithubKey");
const eyeGithubIcon = document.getElementById("eyeGithubIcon");
const watcherEnabledCheckbox = document.getElementById("watcherEnabled");
const autoAnalyzeCheckbox = document.getElementById("autoAnalyze");
const autoFixCheckbox = document.getElementById("autoFix");
const deployCommandInput = document.getElementById("deployCommand");
const btnTestDeploy = document.getElementById("btnTestDeploy");

// Sentry & Server Health Elements
const sentryEnabledCheckbox = document.getElementById("sentryEnabled");
const sentryAutoHealCheckbox = document.getElementById("sentryAutoHeal");
const sentryIntervalSelect = document.getElementById("sentryInterval");
const sentryDiskThresholdInput = document.getElementById("sentryDiskThreshold");
const btnAuditSentry = document.getElementById("btnAuditSentry");
const sentryAuditResult = document.getElementById("sentryAuditResult");
const sentryAuditText = document.getElementById("sentryAuditText");

// Voice / Whisper Elements
const voiceProviderSelect = document.getElementById("voiceProvider");
const voiceLanguageSelect = document.getElementById("voiceLanguage");
const groqApiKeyInput = document.getElementById("groqApiKey");
const openaiApiKeyInput = document.getElementById("openaiApiKey");
const toggleGroqKeyBtn = document.getElementById("toggleGroqKey");
const toggleOpenaiKeyBtn = document.getElementById("toggleOpenaiKey");
const badgeGroqKey = document.getElementById("badgeGroqKey");
const badgeOpenaiKey = document.getElementById("badgeOpenaiKey");

const statusPill = document.getElementById("statusPill");
const statusText = document.getElementById("statusText");
const btnReload = document.getElementById("btnReload");
const btnSubmit = document.getElementById("btnSubmit");
const saveSpinner = document.getElementById("saveSpinner");
const saveBtnText = document.getElementById("saveBtnText");
const toastContainer = document.getElementById("toastContainer");

// Toast Notification
function showToast(message, type = "success", duration = 4000) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
  toast.innerHTML = `<span><strong>${icon}</strong></span><span>${message}</span>`;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(20px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Format milliseconds to human readable
function formatMs(ms) {
  const minutes = Math.round(Number(ms) / 60000);
  if (minutes >= 60) {
    const hours = (minutes / 60).toFixed(1);
    return `${hours} Jam (${ms} ms)`;
  }
  return `${minutes} Menit (${ms} ms)`;
}

// Render User ID Chips
function renderIdChips(rawString) {
  idChipsContainer.innerHTML = "";
  if (!rawString) return;

  const ids = rawString
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const id of ids) {
    const chip = document.createElement("span");
    chip.className = "id-chip";
    chip.innerHTML = `👤 ID: ${id}`;
    idChipsContainer.appendChild(chip);
  }
}

// Toggle Token Visibility
toggleTokenBtn.addEventListener("click", () => {
  const isPassword = botTokenInput.type === "password";
  botTokenInput.type = isPassword ? "text" : "password";
  eyeIcon.innerHTML = isPassword
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
});

if (togglePiServerKeyBtn && piServerApiKeyInput) {
  togglePiServerKeyBtn.addEventListener("click", () => {
    const isPass = piServerApiKeyInput.type === "password";
    piServerApiKeyInput.type = isPass ? "text" : "password";
    eyePiServerIcon.innerHTML = isPass
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
  });
}

if (toggleGithubKeyBtn && githubTokenInput) {
  toggleGithubKeyBtn.addEventListener("click", () => {
    const isPass = githubTokenInput.type === "password";
    githubTokenInput.type = isPass ? "text" : "password";
    eyeGithubIcon.innerHTML = isPass
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
  });
}

// Update Live Badges
function updateBadges(settings, system) {
  badgeEngine.textContent = "Pi Coding Agent";
  badgeModel.textContent = settings.PI_MODEL || "openai/gpt-oss-120b";

  if (settings.BOT_TOKEN && settings.BOT_TOKEN.length > 20) {
    badgeToken.innerHTML = `<span style="color: #34d399;">✓ Terkonfigurasi</span>`;
  } else {
    badgeToken.innerHTML = `<span style="color: #f87171;">Belum Diisi</span>`;
  }

  if (system) {
    badgeHost.textContent = `${system.platform} (${system.nodeVersion})`;
  }

  statusPill.className = "status-pill online";
  statusText.textContent = "Server Online & Siap";
}

// Load Settings from API
async function loadSettings() {
  statusPill.className = "status-pill";
  statusText.textContent = "Memuat data...";

  try {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.error || "Gagal memuat");

    currentSettings = data.settings;
    availableOptions = data.options || {};
    currentCustomModels = data.customModels || {};

    // Populate inputs
    botTokenInput.value = currentSettings.BOT_TOKEN || "";
    allowedIdsInput.value = currentSettings.ALLOWED_TELEGRAM_IDS || "";
    renderIdChips(currentSettings.ALLOWED_TELEGRAM_IDS);

    renderAllowedModelsChips();
    loadPiProviders();

    // Populate Engine Select
    if (cliEngineSelect) {
      cliEngineSelect.value = currentSettings.CLI_ENGINE === "commandcode" ? "commandcode" : "pi";
    }
    if (cmdMaxTurnsInput) {
      cmdMaxTurnsInput.value = currentSettings.CMD_MAX_TURNS || "300";
    }

    // Populate Pi Models Select
    if (piModelSelect) {
      piModelSelect.innerHTML = "";
      for (const m of (availableOptions.piModels || [])) {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = `${m.name} ${m.badge ? `[${m.badge}]` : ""}`;
        opt.selected = m.id === currentSettings.PI_MODEL;
        piModelSelect.appendChild(opt);
      }
    }

    // Populate Pi Server inputs
    if (piServerUrlInput) {
      piServerUrlInput.value = currentSettings.PI_SERVER_URL || "";
    }
    if (piServerApiKeyInput) {
      piServerApiKeyInput.value = currentSettings.PI_SERVER_API_KEY || "";
    }

    // Populate Workspace Access Role & Scope
    if (data.sandboxConfig) {
      const isCustom = data.sandboxConfig.role === "custom" || Boolean(data.sandboxConfig.piSandbox);
      if (scopeRoleCustomRadio && scopeRoleRootRadio) {
        scopeRoleCustomRadio.checked = isCustom;
        scopeRoleRootRadio.checked = !isCustom;
      }
      if (customFoldersInput) {
        customFoldersInput.value = data.sandboxConfig.customFolders || data.sandboxConfig.restrictedDir || "";
      }
      if (customFoldersContainer) {
        customFoldersContainer.style.display = isCustom ? "block" : "none";
      }
      if (scopeRoleBadge) {
        scopeRoleBadge.textContent = isCustom ? "Custom (Dibatasi)" : "Root (Akses Penuh)";
        scopeRoleBadge.style.color = isCustom ? "#f59e0b" : "#34d399";
      }
    }

    // Status Badges
    if (data.authStatus) {
      if (badgePiServerKey) {
        if (data.authStatus.hasPiServerKey) {
          badgePiServerKey.className = "badge badge-primary";
          badgePiServerKey.innerHTML = "✓ Key Terpasang";
        } else {
          badgePiServerKey.className = "badge";
          badgePiServerKey.innerHTML = "Belum Diisi";
        }
      }
    }

    // Populate Timeout (idle & maksimal)
    timeoutInput.value = currentSettings.TASK_TIMEOUT_MS || "900000";
    timeoutFormatted.textContent = formatMs(timeoutInput.value);
    if (maxTimeoutInput) {
      maxTimeoutInput.value = currentSettings.TASK_MAX_TIMEOUT_MS || "14400000";
      if (maxTimeoutFormatted) maxTimeoutFormatted.textContent = formatMs(maxTimeoutInput.value);
    }

    // Populate GitHub Token & Deploy Command
    if (githubTokenInput) {
      githubTokenInput.value = currentSettings.GITHUB_TOKEN || "";
    }
    if (deployCommandInput) {
      deployCommandInput.value = currentSettings.DEPLOY_COMMAND || "";
    }

    // Populate Sentry Config
    if (data.sentryConfig) {
      if (sentryEnabledCheckbox) sentryEnabledCheckbox.checked = data.sentryConfig.enabled !== false;
      if (sentryAutoHealCheckbox) sentryAutoHealCheckbox.checked = data.sentryConfig.autoHeal !== false;
      if (sentryIntervalSelect) sentryIntervalSelect.value = String(data.sentryConfig.checkIntervalMinutes || 5);
      if (sentryDiskThresholdInput) sentryDiskThresholdInput.value = String(data.sentryConfig.diskThresholdPercent || 88);
      if (Array.isArray(data.sentryConfig.targetContainers)) {
        monitoredContainers = [...data.sentryConfig.targetContainers];
      }
    }

    if (data.dockerStatus) {
      isDockerHostAvailable = data.dockerStatus.available !== false;
      if (Array.isArray(data.dockerStatus.containers)) {
        liveContainerStatusMap.clear();
        for (const c of data.dockerStatus.containers) {
          liveContainerStatusMap.set(c.name, c);
        }
      }
    }

    renderContainerGrid();

    // Populate Voice Config
    if (data.voiceConfig) {
      if (voiceProviderSelect) voiceProviderSelect.value = data.voiceConfig.provider || "groq";
      if (voiceLanguageSelect) voiceLanguageSelect.value = data.voiceConfig.language || "id";
      if (groqApiKeyInput) groqApiKeyInput.value = currentSettings.GROQ_API_KEY || data.voiceConfig.groqApiKey || "";
      if (openaiApiKeyInput) openaiApiKeyInput.value = currentSettings.OPENAI_API_KEY || data.voiceConfig.openaiApiKey || "";
    }

    if (badgeGroqKey) {
      badgeGroqKey.style.display = (currentSettings.GROQ_API_KEY || data.voiceConfig?.groqApiKey) ? "inline-block" : "none";
    }
    if (badgeOpenaiKey) {
      badgeOpenaiKey.style.display = (currentSettings.OPENAI_API_KEY || data.voiceConfig?.openaiApiKey) ? "inline-block" : "none";
    }

    // Ambil data status otomasi
    try {
      const autoRes = await fetch("/api/automation");
      if (autoRes.ok) {
        const autoData = await autoRes.json();
        if (autoData.ok) {
          if (watcherEnabledCheckbox) {
            watcherEnabledCheckbox.checked = autoData.watchConfig?.enabled !== false;
          }
          if (autoAnalyzeCheckbox) {
            autoAnalyzeCheckbox.checked = autoData.watchConfig?.autoAnalyze !== false;
          }
          if (autoFixCheckbox) {
            autoFixCheckbox.checked = Boolean(autoData.watchConfig?.autoFix);
          }
          if (deployCommandInput && autoData.deployConfig?.defaultCommand) {
            deployCommandInput.value = autoData.deployConfig.defaultCommand;
          }
        }
      }
    } catch (_) {}

    // Update Badges
    updateBadges(currentSettings, data.system);
    updateToggleBadges();

    if (badgeVoice) {
      const hasVoice = Boolean(
        currentSettings.GROQ_API_KEY ||
        data.voiceConfig?.groqApiKey ||
        currentSettings.OPENAI_API_KEY ||
        data.voiceConfig?.openaiApiKey
      );
      badgeVoice.textContent = hasVoice
        ? `${(data.voiceConfig?.provider || "groq").toUpperCase()} Siap`
        : "Belum Ada Key";
      badgeVoice.style.color = hasVoice ? "var(--accent-emerald)" : "var(--accent-amber)";
    }

    // Otomatis test token jika sudah ada
    if (currentSettings.BOT_TOKEN && currentSettings.BOT_TOKEN.length > 25) {
      testBotToken(currentSettings.BOT_TOKEN, true);
    }
  } catch (err) {
    statusPill.className = "status-pill offline";
    statusText.textContent = "Koneksi Terputus";
    showToast(`Gagal memuat pengaturan: ${err.message}`, "error");
  }
}

// Test Bot Token via Telegram API
async function testBotToken(token, silent = false) {
  if (!token) {
    if (!silent) showToast("Silakan masukkan token bot terlebih dahulu.", "error");
    return;
  }

  btnTestToken.disabled = true;
  const originalHtml = btnTestToken.innerHTML;
  btnTestToken.innerHTML = `<span>Memeriksa...</span>`;

  try {
    const res = await fetch("/api/test-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    const data = await res.json();
    if (data.ok && data.bot) {
      tokenTestResult.classList.remove("hidden");
      botResultName.textContent = `${data.bot.name} (ID: ${data.bot.id})`;
      botResultUser.textContent = `@${data.bot.username}`;
      botTelegramLink.href = `https://t.me/${data.bot.username}`;
      botTelegramLink.style.display = "inline-flex";

      if (!silent) {
        showToast(`Token Valid! Terhubung ke bot @${data.bot.username}`, "success");
      }
    } else {
      tokenTestResult.classList.remove("hidden");
      botResultName.textContent = "Token Tidak Valid";
      botResultUser.textContent = data.error || "Gagal verifikasi ke Telegram";
      botTelegramLink.style.display = "none";
      if (!silent) {
        showToast(data.error || "Token bot tidak valid", "error");
      }
    }
  } catch (err) {
    if (!silent) {
      showToast(`Gagal menghubungkan ke Telegram: ${err.message}`, "error");
    }
  } finally {
    btnTestToken.disabled = false;
    btnTestToken.innerHTML = originalHtml;
  }
}

// Event Listeners
btnTestToken.addEventListener("click", () => {
  testBotToken(botTokenInput.value.trim());
});

allowedIdsInput.addEventListener("input", (e) => {
  renderIdChips(e.target.value);
});

timeoutInput.addEventListener("input", (e) => {
  timeoutFormatted.textContent = formatMs(e.target.value);
});

if (maxTimeoutInput) {
  maxTimeoutInput.addEventListener("input", (e) => {
    if (maxTimeoutFormatted) maxTimeoutFormatted.textContent = formatMs(e.target.value);
  });
}

function updateScopeView() {
  const isCustom = scopeRoleCustomRadio?.checked;
  if (customFoldersContainer) {
    customFoldersContainer.style.display = isCustom ? "block" : "none";
  }
  if (scopeRoleBadge) {
    scopeRoleBadge.textContent = isCustom ? "Custom (Dibatasi)" : "Root (Akses Penuh)";
    scopeRoleBadge.style.color = isCustom ? "#f59e0b" : "#34d399";
  }
}

if (scopeRoleRootRadio) scopeRoleRootRadio.addEventListener("change", updateScopeView);
if (scopeRoleCustomRadio) scopeRoleCustomRadio.addEventListener("change", updateScopeView);

if (piSandboxToggle) {
  piSandboxToggle.addEventListener("change", () => {
    const isPi = piSandboxToggle.checked;
    if (piSandboxBadge) {
      piSandboxBadge.textContent = isPi ? "Aktif (Hanya intiva)" : "Nonaktif (Full Access)";
      piSandboxBadge.className = `switch-status-text ${isPi ? "on" : "off"}`;
    }
  });
}

// Preset buttons
document.querySelectorAll(".btn-preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    const ms = btn.getAttribute("data-ms");
    timeoutInput.value = ms;
    timeoutFormatted.textContent = formatMs(ms);
  });
});

document.querySelectorAll(".btn-preset-max").forEach((btn) => {
  btn.addEventListener("click", () => {
    const ms = btn.getAttribute("data-ms");
    if (!maxTimeoutInput) return;
    maxTimeoutInput.value = ms;
    if (maxTimeoutFormatted) maxTimeoutFormatted.textContent = formatMs(ms);
  });
});

// Allowed Models Manager Elements
const allowedEngineLabel = document.getElementById("allowedEngineLabel");
const btnResetDefaultModels = document.getElementById("btnResetDefaultModels");
const allowedModelsChips = document.getElementById("allowedModelsChips");
const inputNewModelId = document.getElementById("inputNewModelId");
const btnAddAllowedModel = document.getElementById("btnAddAllowedModel");

function getActiveEngineKey() {
  return { engine: "pi", key: "piModels", label: "PI CODING AGENT", select: piModelSelect };
}

function applyPiModelOptions(models, selectedId) {
  availableOptions.piModels = Array.isArray(models) ? models : [];
  if (currentCustomModels) currentCustomModels.piModels = availableOptions.piModels;

  if (!piModelSelect) return;
  piModelSelect.innerHTML = "";
  for (const m of availableOptions.piModels) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.name}${m.badge ? ` [${m.badge}]` : ""}`;
    piModelSelect.appendChild(opt);
  }

  const selected = selectedId && availableOptions.piModels.some((m) => m.id === selectedId)
    ? selectedId
    : availableOptions.piModels[0]?.id;
  if (selected) {
    piModelSelect.value = selected;
    if (badgeModel) badgeModel.textContent = selected;
  }

  renderAllowedModelsChips();
}

function renderAllowedModelsChips() {
  if (!allowedModelsChips) return;
  const { engine, key, label } = getActiveEngineKey();
  if (allowedEngineLabel) allowedEngineLabel.textContent = label;

  const customList = currentCustomModels && Array.isArray(currentCustomModels[key]) ? currentCustomModels[key] : null;
  const optList = availableOptions && Array.isArray(availableOptions[key]) ? availableOptions[key] : [];
  const currentModels = customList !== null ? customList : optList;
  allowedModelsChips.innerHTML = "";

  if (currentModels.length === 0) {
    allowedModelsChips.innerHTML = `<span style="font-size: 0.8rem; color: #64748b; font-style: italic;">Belum ada model yang diizinkan untuk engine ini. Silakan tambahkan model baru di bawah.</span>`;
    return;
  }

  for (const m of currentModels) {
    const chip = document.createElement("span");
    chip.style.cssText = "display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.25); border-radius: 6px; font-size: 0.8rem; color: #93c5fd; font-family: monospace;";

    const modelId = typeof m === "object" ? (m.id || m.name || "") : String(m);
    const modelName = typeof m === "object" ? (m.name || m.id || "") : String(m);

    const textSpan = document.createElement("span");
    textSpan.textContent = modelName || modelId;
    chip.appendChild(textSpan);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.innerHTML = "&times;";
    delBtn.title = `Hapus model ${modelId} dari daftar yang diizinkan`;
    delBtn.style.cssText = "background: none; border: none; color: #f87171; font-size: 1.1rem; cursor: pointer; padding: 0 2px; line-height: 1; font-weight: bold;";
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeAllowedModel(engine, modelId);
    });

    chip.appendChild(delBtn);
    allowedModelsChips.appendChild(chip);
  }
}

async function addAllowedModel(engine, modelId, name) {
  if (!modelId) return;
  try {
    const res = await fetch("/api/custom-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", engine, modelId, name }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Gagal menambah model");
    currentCustomModels = data.customModels || {};
    const { key } = getActiveEngineKey();
    if (data.options) {
      if (!availableOptions) availableOptions = {};
      availableOptions[key] = data.options;
    }
    renderAllowedModelsChips();
    await loadSettings();
    showToast(data.message || "Model berhasil ditambahkan!", "success");
  } catch (err) {
    showToast(`Gagal: ${err.message}`, "error");
  }
}

async function removeAllowedModel(engine, modelId) {
  if (!modelId) return;
  try {
    const res = await fetch("/api/custom-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", engine, modelId }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Gagal menghapus model");
    currentCustomModels = data.customModels || {};
    const { key } = getActiveEngineKey();
    if (data.options) {
      if (!availableOptions) availableOptions = {};
      availableOptions[key] = data.options;
    }

    if (piModelSelect && piModelSelect.value === modelId) {
      piModelSelect.selectedIndex = 0;
      if (badgeModel) badgeModel.textContent = piModelSelect.value;
    }

    renderAllowedModelsChips();
    await loadSettings();
    showToast(data.message || "Model berhasil dihapus!", "info");
  } catch (err) {
    showToast(`Gagal: ${err.message}`, "error");
  }
}

async function resetAllowedModels(engine) {
  try {
    const res = await fetch("/api/custom-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset", engine }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Gagal mereset model");
    currentCustomModels = data.customModels || {};
    const { key } = getActiveEngineKey();
    if (data.options) {
      if (!availableOptions) availableOptions = {};
      availableOptions[key] = data.options;
    }
    renderAllowedModelsChips();
    await loadSettings();
    showToast("Daftar model dikembalikan ke default!", "success");
  } catch (err) {
    showToast(`Gagal reset: ${err.message}`, "error");
  }
}

if (btnAddAllowedModel && inputNewModelId) {
  btnAddAllowedModel.addEventListener("click", async () => {
    const val = inputNewModelId.value.trim();
    if (!val) {
      showToast("Ketik ID model terlebih dahulu!", "warning");
      return;
    }
    const { engine } = getActiveEngineKey();
    await addAllowedModel(engine, val);
    inputNewModelId.value = "";
  });

  inputNewModelId.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnAddAllowedModel.click();
    }
  });
}

if (btnResetDefaultModels) {
  btnResetDefaultModels.addEventListener("click", async () => {
    const { engine, label } = getActiveEngineKey();
    if (confirm(`Kembalikan daftar model untuk ${label} ke default bawaan?`)) {
      await resetAllowedModels(engine);
    }
  });
}

if (piModelSelect) {
  piModelSelect.addEventListener("change", () => {
    badgeModel.textContent = piModelSelect.value;
  });
}

// ===== Provider Pi (multi-provider models.json) =====
const piProvidersList = document.getElementById("piProvidersList");
const piProviderDefaultBadge = document.getElementById("piProviderDefaultBadge");
const piProviderId = document.getElementById("piProviderId");
const piProviderName = document.getElementById("piProviderName");
const piProviderBaseUrl = document.getElementById("piProviderBaseUrl");
const piProviderApi = document.getElementById("piProviderApi");
const piProviderApiKey = document.getElementById("piProviderApiKey");
const piProviderModels = document.getElementById("piProviderModels");
const btnSavePiProvider = document.getElementById("btnSavePiProvider");
const btnNewPiProvider = document.getElementById("btnNewPiProvider");

let piProvidersCache = [];

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clearPiProviderForm() {
  if (piProviderId) piProviderId.value = "";
  if (piProviderName) piProviderName.value = "";
  if (piProviderBaseUrl) piProviderBaseUrl.value = "";
  if (piProviderApi) piProviderApi.value = "openai-completions";
  if (piProviderApiKey) piProviderApiKey.value = "";
  if (piProviderModels) piProviderModels.value = "";
}

function fillPiProviderForm(provider) {
  if (!provider) return;
  if (piProviderId) piProviderId.value = provider.id || "";
  if (piProviderName) piProviderName.value = provider.name || "";
  if (piProviderBaseUrl) piProviderBaseUrl.value = provider.baseUrl || "";
  if (piProviderApi) piProviderApi.value = provider.api || "openai-completions";
  if (piProviderApiKey) piProviderApi.value = "";
  if (piProviderModels) {
    piProviderModels.value = (provider.models || [])
      .map((m) => (m.name && m.name !== m.id ? `${m.id} | ${m.name}` : m.id))
      .join("\n");
  }
  piProviderId && piProviderId.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderPiProviders() {
  if (!piProvidersList) return;
  piProvidersList.innerHTML = "";

  if (!piProvidersCache.length) {
    piProvidersList.innerHTML = `<span style="font-size: 0.8rem; color: #64748b; font-style: italic;">Belum ada provider di ~/.pi/agent/models.json.</span>`;
    return;
  }

  for (const p of piProvidersCache) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.2); border-radius:8px;";

    const info = document.createElement("div");
    info.style.cssText = "min-width:0;";
    info.innerHTML = `
      <div style="font-family:monospace; font-size:0.85rem; color:#93c5fd;">
        ${escapeHtml(p.id)} ${p.isDefault ? '<span style="font-size:0.65rem; background:#059669; color:#fff; padding:1px 6px; border-radius:4px; margin-left:4px;">DEFAULT</span>' : ""}
      </div>
      <div style="font-size:0.72rem; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
        ${escapeHtml(p.name || p.id)} · ${escapeHtml(p.baseUrl)} · ${(p.models || []).length} model · key: ${p.hasApiKey ? escapeHtml(p.apiKeyMasked || "set") : "none"}
      </div>`;
    row.appendChild(info);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex; gap:6px; flex-shrink:0;";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.style.cssText = "font-size:0.72rem; padding:4px 8px; background:#2563eb; color:#fff; border:none; border-radius:4px; cursor:pointer;";
    editBtn.addEventListener("click", () => fillPiProviderForm(p));
    actions.appendChild(editBtn);

    if (!p.isDefault) {
      const defBtn = document.createElement("button");
      defBtn.type = "button";
      defBtn.textContent = "Jadikan Default";
      defBtn.style.cssText = "font-size:0.72rem; padding:4px 8px; background:#059669; color:#fff; border:none; border-radius:4px; cursor:pointer;";
      defBtn.addEventListener("click", () => setDefaultPiProvider(p.id));
      actions.appendChild(defBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "Hapus";
    delBtn.style.cssText = "font-size:0.72rem; padding:4px 8px; background:none; color:#f87171; border:1px solid rgba(248,113,113,0.4); border-radius:4px; cursor:pointer;";
    delBtn.addEventListener("click", () => deletePiProviderFromUi(p.id));
    actions.appendChild(delBtn);

    row.appendChild(actions);
    piProvidersList.appendChild(row);
  }
}

async function loadPiProviders() {
  try {
    const res = await fetch("/api/pi-providers");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Gagal memuat provider");
    piProvidersCache = data.providers || [];
    if (piProviderDefaultBadge) {
      piProviderDefaultBadge.textContent = `Default: ${data.defaultProvider || "local-pi"}`;
    }
    renderPiProviders();
  } catch (err) {
    if (piProvidersList) {
      piProvidersList.innerHTML = `<span style="font-size:0.8rem; color:#f87171;">Gagal memuat provider: ${escapeHtml(err.message)}</span>`;
    }
  }
}

function parsePiProviderModels(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [idPart, ...rest] = line.split("|");
      const id = idPart.trim();
      if (!id) return null;
      const name = rest.join("|").trim() || id;
      return { id, name };
    })
    .filter(Boolean);
}

async function savePiProviderFromUi() {
  const id = piProviderId ? piProviderId.value.trim() : "";
  const baseUrl = piProviderBaseUrl ? piProviderBaseUrl.value.trim() : "";
  if (!id || !baseUrl) {
    showToast("ID provider dan Base URL wajib diisi.", "warning");
    return;
  }

  const payload = {
    action: "save",
    id,
    name: piProviderName ? piProviderName.value.trim() : "",
    baseUrl,
    api: piProviderApi ? piProviderApi.value : "openai-completions",
    models: parsePiProviderModels(piProviderModels ? piProviderModels.value : ""),
  };
  const key = piProviderApiKey ? piProviderApiKey.value.trim() : "";
  if (key) payload.apiKey = key;

  if (btnSavePiProvider) btnSavePiProvider.disabled = true;
  try {
    const res = await fetch("/api/pi-providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Gagal menyimpan provider");
    piProvidersCache = data.providers || [];
    if (piProviderDefaultBadge) {
      piProviderDefaultBadge.textContent = `Default: ${data.defaultProvider || "local-pi"}`;
    }
    renderPiProviders();
    if (Array.isArray(data.piModels)) applyPiModelOptions(data.piModels, data.piModel);
    showToast(data.message || "Provider disimpan!", "success");
  } catch (err) {
    showToast(`Gagal: ${err.message}`, "error");
  } finally {
    if (btnSavePiProvider) btnSavePiProvider.disabled = false;
  }
}

async function setDefaultPiProvider(id) {
  try {
    const res = await fetch("/api/pi-providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-default", id }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Gagal mengubah default");
    piProvidersCache = data.providers || [];
    if (piProviderDefaultBadge) {
      piProviderDefaultBadge.textContent = `Default: ${data.defaultProvider || id}`;
    }
    renderPiProviders();
    if (Array.isArray(data.piModels)) applyPiModelOptions(data.piModels, data.piModel);
    showToast(data.message || "Provider default diubah.", "success");
  } catch (err) {
    showToast(`Gagal: ${err.message}`, "error");
  }
}

async function deletePiProviderFromUi(id) {
  if (!confirm(`Hapus provider '${id}' dari models.json?`)) return;
  try {
    const res = await fetch("/api/pi-providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Gagal menghapus provider");
    piProvidersCache = data.providers || [];
    if (piProviderDefaultBadge) {
      piProviderDefaultBadge.textContent = `Default: ${data.defaultProvider || "local-pi"}`;
    }
    renderPiProviders();
    if (Array.isArray(data.piModels)) applyPiModelOptions(data.piModels, data.piModel);
    showToast(data.message || "Provider dihapus.", "info");
  } catch (err) {
    showToast(`Gagal: ${err.message}`, "error");
  }
}

if (btnSavePiProvider) {
  btnSavePiProvider.addEventListener("click", savePiProviderFromUi);
}
if (btnNewPiProvider) {
  btnNewPiProvider.addEventListener("click", clearPiProviderForm);
}

// ===== CLIProxyAPI OAuth (Antigravity / Claude / Codex) =====
const cpaStatusBadge = document.getElementById("cpaStatusBadge");
const cpaStatusText = document.getElementById("cpaStatusText");
const cpaProvider = document.getElementById("cpaProvider");
const btnCpaLogin = document.getElementById("btnCpaLogin");
const btnCpaRefresh = document.getElementById("btnCpaRefresh");
const cpaLoginBox = document.getElementById("cpaLoginBox");
const cpaAuthUrl = document.getElementById("cpaAuthUrl");
const cpaCallbackUrl = document.getElementById("cpaCallbackUrl");
const btnCpaSubmitCallback = document.getElementById("btnCpaSubmitCallback");
const cpaOAuthStatus = document.getElementById("cpaOAuthStatus");

let cpaState = "";
let cpaPollTimer = null;

function setCpaOAuthStatus(text, color) {
  if (!cpaOAuthStatus) return;
  cpaOAuthStatus.textContent = text;
  cpaOAuthStatus.style.color = color || "#94a3b8";
}

async function loadCpaStatus() {
  if (!cpaStatusBadge) return;
  try {
    const res = await fetch("/api/cliproxy/status");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Gagal memuat status");

    if (data.reachable) {
      cpaStatusBadge.className = "badge badge-primary";
      cpaStatusBadge.innerHTML = "✓ Online";
    } else {
      cpaStatusBadge.className = "badge";
      cpaStatusBadge.innerHTML = "✕ Offline";
    }

    const creds = Array.isArray(data.credentials) ? data.credentials : [];
    const credText = creds.length
      ? creds.map((c) => `${c.provider || "?"}${c.label ? ` (${c.label})` : ""}`).join(", ")
      : "belum ada akun";
    cpaStatusText.textContent =
      `${data.url} · ${data.modelCount || 0} model · akun: ${credText}` +
      (data.errors?.management ? ` · management: ${data.errors.management}` : "");
  } catch (err) {
    cpaStatusBadge.className = "badge";
    cpaStatusBadge.innerHTML = "✕ Error";
    if (cpaStatusText) cpaStatusText.textContent = err.message;
  }
}

function stopCpaPolling() {
  if (cpaPollTimer) {
    clearInterval(cpaPollTimer);
    cpaPollTimer = null;
  }
}

function pollCpaOAuthStatus() {
  stopCpaPolling();
  if (!cpaState) return;
  cpaPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/cliproxy/oauth/status?state=${encodeURIComponent(cpaState)}`);
      const data = await res.json();
      if (!data.ok) {
        setCpaOAuthStatus(`Status error: ${data.error || "unknown"}`, "#f87171");
        return;
      }
      const status = data.status || "wait";
      if (status === "ok") {
        setCpaOAuthStatus("✅ Login berhasil, kredensial tersimpan.", "#34d399");
        stopCpaPolling();
        loadCpaStatus();
      } else if (status === "error") {
        setCpaOAuthStatus(`❌ Login gagal: ${data.error || "unknown"}`, "#f87171");
        stopCpaPolling();
      } else if (status === "wait") {
        setCpaOAuthStatus("⏳ Menunggu callback / proses token...", "#facc15");
      }
    } catch (err) {
      setCpaOAuthStatus(`Gagal cek status: ${err.message}`, "#f87171");
    }
  }, 2500);
}

async function startCpaLogin() {
  const provider = cpaProvider ? cpaProvider.value : "antigravity";
  if (btnCpaLogin) btnCpaLogin.disabled = true;
  setCpaOAuthStatus("Memulai OAuth...", "#94a3b8");
  try {
    const res = await fetch(`/api/cliproxy/oauth/start?provider=${encodeURIComponent(provider)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Gagal memulai OAuth");

    cpaState = data.state || "";
    if (cpaLoginBox) cpaLoginBox.style.display = "block";
    if (cpaAuthUrl) {
      cpaAuthUrl.href = data.url;
      cpaAuthUrl.textContent = data.url;
    }
    if (cpaCallbackUrl) cpaCallbackUrl.value = "";
    setCpaOAuthStatus("Buka URL di atas, login, lalu tempel URL callback yang gagal dimuat.", "#facc15");
    pollCpaOAuthStatus();
    window.open(data.url, "_blank", "noopener");
  } catch (err) {
    setCpaOAuthStatus(`❌ ${err.message}`, "#f87171");
  } finally {
    if (btnCpaLogin) btnCpaLogin.disabled = false;
  }
}

async function submitCpaCallback() {
  const redirectUrl = cpaCallbackUrl ? cpaCallbackUrl.value.trim() : "";
  if (!redirectUrl) {
    setCpaOAuthStatus("Tempel URL callback lengkap terlebih dahulu.", "#f87171");
    return;
  }
  if (btnCpaSubmitCallback) btnCpaSubmitCallback.disabled = true;
  setCpaOAuthStatus("Mengirim callback...", "#94a3b8");
  try {
    const res = await fetch("/api/cliproxy/oauth/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: cpaProvider ? cpaProvider.value : undefined,
        redirectUrl,
        state: cpaState || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Callback gagal");
    setCpaOAuthStatus("Callback diterima, menunggu proses token...", "#facc15");
    pollCpaOAuthStatus();
  } catch (err) {
    setCpaOAuthStatus(`❌ ${err.message}`, "#f87171");
  } finally {
    if (btnCpaSubmitCallback) btnCpaSubmitCallback.disabled = false;
  }
}

if (btnCpaLogin) btnCpaLogin.addEventListener("click", startCpaLogin);
if (btnCpaRefresh) btnCpaRefresh.addEventListener("click", loadCpaStatus);
if (btnCpaSubmitCallback) btnCpaSubmitCallback.addEventListener("click", submitCpaCallback);
loadCpaStatus();

// ===== Modal: Kelola Kredensial CLIProxyAPI =====
const btnManageCredentials = document.getElementById("btnManageCredentials");
const credModal = document.getElementById("credModal");
const credModalClose = document.getElementById("credModalClose");
const credList = document.getElementById("credList");
const credRefreshBtn = document.getElementById("credRefreshBtn");
const credLoginBtn = document.getElementById("credLoginBtn");

function openCredModal() {
  if (!credModal) return;
  credModal.classList.remove("hidden");
  credModal.setAttribute("aria-hidden", "false");
  loadCredentials();
}

function closeCredModal() {
  if (!credModal) return;
  credModal.classList.add("hidden");
  credModal.setAttribute("aria-hidden", "true");
}

function credPills(c) {
  const pills = [];
  if (c.disabled) pills.push('<span class="cred-pill off">nonaktif</span>');
  else if (c.cooling) pills.push('<span class="cred-pill warn">cooling</span>');
  else pills.push('<span class="cred-pill ok">aktif</span>');

  if (c.failed > 0) pills.push(`<span class="cred-pill warn">failed ${c.failed}</span>`);
  if (c.inferenceVerified) pills.push('<span class="cred-pill ok">verified</span>');
  if (c.provider) pills.push(`<span class="cred-pill info">${escapeHtml(c.provider)}</span>`);
  return pills.join(" ");
}

function renderCredentials(credentials) {
  if (!credList) return;
  credList.innerHTML = "";

  const list = Array.isArray(credentials) ? credentials : [];
  if (!list.length) {
    credList.innerHTML = '<div class="cred-empty">Belum ada kredensial. Klik "Login Baru" untuk menambahkan akun.</div>';
    return;
  }

  for (const c of list) {
    const item = document.createElement("div");
    item.className = "cred-item" + (c.disabled ? " is-disabled" : "");

    const main = document.createElement("div");
    main.className = "cred-main";
    main.innerHTML = `
      <div class="cred-email">${escapeHtml(c.email || c.label || c.name)}</div>
      <div class="cred-meta">${credPills(c)}</div>`;
    item.appendChild(main);

    const actions = document.createElement("div");
    actions.className = "cred-actions";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "cred-btn toggle";
    toggleBtn.textContent = c.disabled ? "Aktifkan" : "Nonaktifkan";
    toggleBtn.addEventListener("click", () => toggleCredential(c.name, !c.disabled));
    actions.appendChild(toggleBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "cred-btn danger";
    delBtn.textContent = "Hapus";
    delBtn.addEventListener("click", () => deleteCredential(c.name, c.email || c.label || c.name));
    actions.appendChild(delBtn);

    item.appendChild(actions);
    credList.appendChild(item);
  }
}

async function loadCredentials() {
  if (!credList) return;
  try {
    const res = await fetch("/api/cliproxy/credentials");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Gagal memuat kredensial");
    renderCredentials(data.credentials || []);
  } catch (err) {
    credList.innerHTML = `<div class="cred-empty" style="color:#f87171;">Gagal memuat: ${escapeHtml(err.message)}</div>`;
  }
}

async function postCredential(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "Aksi gagal");
  if (Array.isArray(data.credentials)) renderCredentials(data.credentials);
  return data;
}

async function toggleCredential(name, disabled) {
  try {
    await postCredential("/api/cliproxy/credentials/status", { name, disabled });
    showToast(disabled ? "Kredensial dinonaktifkan." : "Kredensial diaktifkan.", "success");
    loadCpaStatus();
  } catch (err) {
    showToast(`Gagal: ${err.message}`, "error");
  }
}

async function deleteCredential(name, label) {
  if (!confirm(`Hapus kredensial '${label || name}'? Tindakan ini permanen.`)) return;
  try {
    await postCredential("/api/cliproxy/credentials/delete", { name });
    showToast("Kredensial dihapus.", "info");
    loadCpaStatus();
  } catch (err) {
    showToast(`Gagal: ${err.message}`, "error");
  }
}

async function refreshCredentials() {
  if (credRefreshBtn) credRefreshBtn.disabled = true;
  try {
    await postCredential("/api/cliproxy/credentials/refresh", {});
    showToast("Kredensial di-refresh.", "success");
    loadCpaStatus();
  } catch (err) {
    showToast(`Gagal: ${err.message}`, "error");
  } finally {
    if (credRefreshBtn) credRefreshBtn.disabled = false;
  }
}

if (btnManageCredentials) btnManageCredentials.addEventListener("click", openCredModal);
if (credModalClose) credModalClose.addEventListener("click", closeCredModal);
if (credRefreshBtn) credRefreshBtn.addEventListener("click", refreshCredentials);
if (credLoginBtn) {
  credLoginBtn.addEventListener("click", () => {
    closeCredModal();
    startCpaLogin();
  });
}
if (credModal) {
  credModal.addEventListener("click", (e) => {
    if (e.target === credModal) closeCredModal();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && credModal && !credModal.classList.contains("hidden")) {
    closeCredModal();
  }
});

// Handler Get Model dari Pi
if (btnGetPiModels) {
  btnGetPiModels.addEventListener("click", async () => {
    const baseUrl = piServerUrlInput ? piServerUrlInput.value : "";
    const apiKey = piServerApiKeyInput ? piServerApiKeyInput.value.trim() : "";
    if (!baseUrl.trim()) {
      showToast("Harap masukkan link / URL server Pi terlebih dahulu!", "warning");
      if (piServerUrlInput) piServerUrlInput.focus();
      return;
    }

    const prevHtml = btnGetPiModels.innerHTML;
    btnGetPiModels.disabled = true;
    btnGetPiModels.innerHTML = `<span>⏳ Mengambil...</span>`;

    try {
      const res = await fetch("/api/models/sync-pi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Gagal mengambil model dari server Pi");
      }

      const models = data.models || [];
      const activeModel = data.activeModel || (models[0] ? models[0].id : "");

      // Update URL field jika dinormalisasi
      if (data.baseUrl && piServerUrlInput) {
        piServerUrlInput.value = data.baseUrl;
      }

      // Update state
      availableOptions.piModels = models;
      if (!currentCustomModels) currentCustomModels = {};
      currentCustomModels.piModels = models;
      currentSettings.PI_MODEL = activeModel;
      currentSettings.PI_SERVER_URL = data.baseUrl || baseUrl;

      // Update Pi Model Select dropdown
      if (piModelSelect) {
        piModelSelect.innerHTML = "";
        for (const m of models) {
          const opt = document.createElement("option");
          opt.value = m.id;
          opt.textContent = `${m.name} [Pi Server]`;
          if (m.id === activeModel) {
            opt.selected = true;
          }
          piModelSelect.appendChild(opt);
        }
        piModelSelect.value = activeModel;
      }

      // Update badge model
      badgeModel.textContent = activeModel || "openai/gpt-oss-120b";

      // Re-render chips manager
      renderAllowedModelsChips();

      showToast(`🎉 Berhasil mengambil ${models.length} model dari Pi! Model aktif: ${activeModel}`, "success");
    } catch (err) {
      showToast(`Gagal: ${err.message}`, "error");
    } finally {
      btnGetPiModels.disabled = false;
      btnGetPiModels.innerHTML = prevHtml;
    }
  });
}


btnReload.addEventListener("click", () => {
  loadSettings();
  showToast("Pengaturan disegarkan.", "info");
});

// Submit Form
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    BOT_TOKEN: botTokenInput.value.trim(),
    ALLOWED_TELEGRAM_IDS: allowedIdsInput.value.trim(),
    CLI_ENGINE: cliEngineSelect ? cliEngineSelect.value : (currentSettings.CLI_ENGINE || "pi"),
    CMD_MAX_TURNS: cmdMaxTurnsInput ? (cmdMaxTurnsInput.value.trim() || "300") : (currentSettings.CMD_MAX_TURNS || "300"),
    PI_MODEL: piModelSelect ? piModelSelect.value : (currentSettings.PI_MODEL || "openai/gpt-oss-120b"),
    PI_SERVER_API_KEY: piServerApiKeyInput ? piServerApiKeyInput.value.trim() : "",
    PI_SERVER_URL: piServerUrlInput ? piServerUrlInput.value.trim() : "",
    scopeRole: scopeRoleCustomRadio?.checked ? "custom" : "root",
    customFolders: customFoldersInput ? customFoldersInput.value.trim() : "",
    sandboxConfig: {
      role: scopeRoleCustomRadio?.checked ? "custom" : "root",
      customFolders: customFoldersInput ? customFoldersInput.value.trim() : "",
      piSandbox: Boolean(scopeRoleCustomRadio?.checked),
    },
    piSandbox: scopeRoleCustomRadio ? scopeRoleCustomRadio.checked : false,
    TASK_TIMEOUT_MS: timeoutInput.value.trim(),
    TASK_MAX_TIMEOUT_MS: maxTimeoutInput ? maxTimeoutInput.value.trim() : "14400000",
    GITHUB_TOKEN: githubTokenInput ? githubTokenInput.value.trim() : "",
    DEPLOY_COMMAND: deployCommandInput ? deployCommandInput.value.trim() : "",
    GROQ_API_KEY: groqApiKeyInput ? groqApiKeyInput.value.trim() : "",
    OPENAI_API_KEY: openaiApiKeyInput ? openaiApiKeyInput.value.trim() : "",
    voiceConfig: {
      provider: voiceProviderSelect ? voiceProviderSelect.value : "groq",
      language: voiceLanguageSelect ? voiceLanguageSelect.value : "id",
      groqApiKey: groqApiKeyInput ? groqApiKeyInput.value.trim() : "",
      openaiApiKey: openaiApiKeyInput ? openaiApiKeyInput.value.trim() : "",
      model: voiceProviderSelect?.value === "groq" ? "whisper-large-v3-turbo" : "whisper-1",
    },
    sentryConfig: {
      enabled: sentryEnabledCheckbox ? sentryEnabledCheckbox.checked : true,
      autoHeal: sentryAutoHealCheckbox ? sentryAutoHealCheckbox.checked : true,
      checkIntervalMinutes: sentryIntervalSelect ? Number(sentryIntervalSelect.value) : 5,
      diskThresholdPercent: sentryDiskThresholdInput ? Number(sentryDiskThresholdInput.value) : 88,
      targetContainers: monitoredContainers,
    },
  };

  btnSubmit.disabled = true;
  saveSpinner.classList.remove("hidden");
  saveBtnText.textContent = "Menyimpan...";

  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Gagal menyimpan");
    }

    // Juga perbarui pengaturan otomasi (/api/automation)
    await fetch("/api/automation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: watcherEnabledCheckbox ? watcherEnabledCheckbox.checked : true,
        autoAnalyze: autoAnalyzeCheckbox ? autoAnalyzeCheckbox.checked : true,
        autoFix: autoFixCheckbox ? autoFixCheckbox.checked : false,
        deployCommand: deployCommandInput ? deployCommandInput.value.trim() : undefined,
      }),
    }).catch(() => {});

    currentSettings = { ...currentSettings, ...payload };
    updateBadges(currentSettings);
    showToast("Pengaturan & Otomasi berhasil disimpan!", "success");
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  } finally {
    btnSubmit.disabled = false;
    saveSpinner.classList.add("hidden");
    saveBtnText.textContent = "Simpan Pengaturan";
  }
});

// Listener untuk Test Deploy via Web UI
if (btnTestDeploy) {
  btnTestDeploy.addEventListener("click", async () => {
    btnTestDeploy.disabled = true;
    const origHtml = btnTestDeploy.innerHTML;
    btnTestDeploy.innerHTML = `<span>Menjalankan...</span>`;

    try {
      showToast("Memulai eksekusi deployment di server...", "info");
      const res = await fetch("/api/deploy/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customCommand: deployCommandInput ? deployCommandInput.value.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (data.ok && data.result?.success) {
        showToast(`✅ Deploy Berhasil (${data.result.durationSec}s)! Perintah: ${data.result.command}`, "success", 6000);
      } else {
        showToast(`❌ Deploy Gagal (Exit ${data.result?.code}): ${data.result?.output || data.error}`, "error", 8000);
      }
    } catch (err) {
      showToast(`Error menghubungi server: ${err.message}`, "error");
    } finally {
      btnTestDeploy.disabled = false;
      btnTestDeploy.innerHTML = origHtml;
    }
  });
}

// Toggle visibility password untuk Groq & OpenAI
if (toggleGroqKeyBtn && groqApiKeyInput) {
  toggleGroqKeyBtn.addEventListener("click", () => {
    groqApiKeyInput.type = groqApiKeyInput.type === "password" ? "text" : "password";
  });
}
if (toggleOpenaiKeyBtn && openaiApiKeyInput) {
  toggleOpenaiKeyBtn.addEventListener("click", () => {
    openaiApiKeyInput.type = openaiApiKeyInput.type === "password" ? "text" : "password";
  });
}

// Sentry Dynamic Containers State
let monitoredContainers = [];
let isDockerHostAvailable = true;
const liveContainerStatusMap = new Map();

const localDockerNotice = document.getElementById("localDockerNotice");
const dockerEnvBadge = document.getElementById("dockerEnvBadge");
const containerConfigControls = document.getElementById("containerConfigControls");
const newContainerInput = document.getElementById("newContainerInput");
const btnAddContainer = document.getElementById("btnAddContainer");
const containerHealthGrid = document.getElementById("containerHealthGrid");

// Render Grid Kontainer secara dinamis
function renderContainerGrid() {
  if (!containerHealthGrid) return;

  if (!isDockerHostAvailable) {
    if (localDockerNotice) localDockerNotice.style.display = "flex";
    if (dockerEnvBadge) {
      dockerEnvBadge.textContent = "💻 Mode Lokal";
      dockerEnvBadge.className = "switch-status-text off";
    }
    if (containerConfigControls) containerConfigControls.style.display = "none";
    return;
  }

  if (localDockerNotice) localDockerNotice.style.display = "none";
  if (containerConfigControls) containerConfigControls.style.display = "block";
  if (dockerEnvBadge) {
    dockerEnvBadge.textContent = "🟢 VPS Docker Aktif";
    dockerEnvBadge.className = "switch-status-text on";
  }

  containerHealthGrid.innerHTML = "";

  if (monitoredContainers.length === 0) {
    containerHealthGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 1.25rem; text-align: center; color: var(--text-muted); font-size: 0.85rem; border: 1px dashed var(--border-subtle); border-radius: var(--radius-md);">
        Belum ada kontainer yang dipantau. Tambahkan nama kontainer di atas untuk memantau.
      </div>
    `;
    return;
  }

  for (const name of monitoredContainers) {
    const card = document.createElement("div");
    card.className = "container-health-card";

    const statusInfo = liveContainerStatusMap.get(name);
    const isExited = statusInfo ? !statusInfo.running : false;
    const statusText = statusInfo ? (statusInfo.running ? "Running" : "Exited") : "Terdaftar";

    card.innerHTML = `
      <div class="container-health-info" style="flex: 1;">
        <span class="container-health-name font-mono">${name}</span>
        <span class="container-health-desc">${statusText}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 0.6rem;">
        <span class="container-status-dot ${isExited ? "exited" : ""}" title="${statusText}"></span>
        <button type="button" class="btn-del-container" data-container="${name}" title="Hapus dari pantauan" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.9rem; padding: 2px 4px; border-radius: 4px;">✕</button>
      </div>
    `;

    const delBtn = card.querySelector(".btn-del-container");
    if (delBtn) {
      delBtn.addEventListener("click", () => {
        monitoredContainers = monitoredContainers.filter((c) => c !== name);
        renderContainerGrid();
        showToast(`Kontainer ${name} dihapus dari pantauan.`, "info");
      });
    }

    containerHealthGrid.appendChild(card);
  }
}

if (btnAddContainer && newContainerInput) {
  const handleAdd = () => {
    const val = newContainerInput.value.trim();
    if (!val) return;
    if (monitoredContainers.includes(val)) {
      showToast(`Kontainer ${val} sudah ada di daftar pantauan.`, "info");
      return;
    }
    monitoredContainers.push(val);
    newContainerInput.value = "";
    renderContainerGrid();
    showToast(`Kontainer ${val} ditambahkan ke daftar pantauan!`, "success");
  };

  btnAddContainer.addEventListener("click", handleAdd);
  newContainerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  });
}

// Listener untuk Audit Server Sentry via Web UI
if (btnAuditSentry) {
  btnAuditSentry.addEventListener("click", async () => {
    btnAuditSentry.disabled = true;
    const origHtml = btnAuditSentry.innerHTML;
    btnAuditSentry.innerHTML = `<span>Mengaudit server...</span>`;

    try {
      showToast("Menjalankan audit kesehatan server & kontainer...", "info");
      const res = await fetch("/api/sentry/check", { method: "POST" });
      const data = await res.json();
      if (data.ok && data.summary) {
        if (sentryAuditResult) sentryAuditResult.style.display = "block";
        if (sentryAuditText) sentryAuditText.textContent = data.summary;

        if (data.dockerStatus) {
          isDockerHostAvailable = data.dockerStatus.available !== false;
          if (Array.isArray(data.dockerStatus.containers)) {
            liveContainerStatusMap.clear();
            for (const c of data.dockerStatus.containers) {
              liveContainerStatusMap.set(c.name, c);
            }
          }
        }
        renderContainerGrid();

        showToast(
          data.health?.healthy ? "✅ Seluruh kontainer & disk prima!" : "⚠️ Peringatan kesehatan server terdeteksi",
          data.health?.healthy ? "success" : "warning",
          5000
        );
      } else {
        showToast(`Audit gagal: ${data.error || "Gagal memproses"}`, "error");
      }
    } catch (err) {
      showToast(`Gagal menghubungi server: ${err.message}`, "error");
    } finally {
      btnAuditSentry.disabled = false;
      btnAuditSentry.innerHTML = origHtml;
    }
  });
}

// Dynamic Switch Badges
const sentryStatusBadge = document.getElementById("sentryStatusBadge");
const healStatusBadge = document.getElementById("healStatusBadge");
const badgeSentry = document.getElementById("badgeSentry");
const badgeVoice = document.getElementById("badgeVoice");

function updateToggleBadges() {
  if (sentryStatusBadge && sentryEnabledCheckbox) {
    const isOn = sentryEnabledCheckbox.checked;
    sentryStatusBadge.textContent = isOn ? "Aktif" : "Nonaktif";
    sentryStatusBadge.className = `switch-status-text ${isOn ? "on" : "off"}`;
    if (badgeSentry) {
      badgeSentry.textContent = isOn ? "🟢 24/7 Aktif" : "🔴 Nonaktif";
      badgeSentry.style.color = isOn ? "var(--accent-emerald)" : "var(--accent-rose)";
    }
  }
  if (healStatusBadge && sentryAutoHealCheckbox) {
    const isOn = sentryAutoHealCheckbox.checked;
    healStatusBadge.textContent = isOn ? "Aktif" : "Nonaktif";
    healStatusBadge.className = `switch-status-text ${isOn ? "on" : "off"}`;
  }
}

if (sentryEnabledCheckbox) {
  sentryEnabledCheckbox.addEventListener("change", updateToggleBadges);
}
if (sentryAutoHealCheckbox) {
  sentryAutoHealCheckbox.addEventListener("change", updateToggleBadges);
}

// Tab Switching Navigation (Segmented Control)
const tabButtons = document.querySelectorAll(".tab-btn");
const cards = document.querySelectorAll(".card[data-section]");

function activateTab(tabId) {
  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
  });

  cards.forEach((card) => {
    const section = card.getAttribute("data-section");
    if (tabId === "all" || section === tabId) {
      card.style.display = "";
      card.classList.add("tab-content-panel");
    } else {
      card.style.display = "none";
      card.classList.remove("tab-content-panel");
    }
  });
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabId = btn.getAttribute("data-tab");
    activateTab(tabId);
  });
});

// Initialize on page load
loadSettings();
