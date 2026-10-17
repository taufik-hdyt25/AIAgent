// State aplikasi
let currentSettings = {};
let availableOptions = { agyModels: [], claudeModels: [] };

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

const engineRadios = document.querySelectorAll('input[name="CLI_ENGINE"]');
const agyModelSelect = document.getElementById("agyModel");
const claudeModelSelect = document.getElementById("claudeModel");
const universalModelSelect = document.getElementById("universalModel");
const groupAgyModel = document.getElementById("groupAgyModel");
const groupClaudeModel = document.getElementById("groupClaudeModel");
const groupUniversalModel = document.getElementById("groupUniversalModel");
const autoApproveCheckbox = document.getElementById("autoApprove");
const timeoutInput = document.getElementById("timeoutMs");
const timeoutFormatted = document.getElementById("timeoutFormatted");

const badgeEngine = document.getElementById("badgeEngine");
const badgeModel = document.getElementById("badgeModel");
const badgeToken = document.getElementById("badgeToken");
const badgeHost = document.getElementById("badgeHost");

const claudeAuthRadios = document.querySelectorAll('input[name="CLAUDE_AUTH_TYPE"]');
const agyAuthRadios = document.querySelectorAll('input[name="AGY_AUTH_TYPE"]');
const anthropicApiKeyInput = document.getElementById("anthropicApiKey");
const geminiApiKeyInput = document.getElementById("geminiApiKey");
const universalApiKeyInput = document.getElementById("universalApiKey");
const universalBaseUrlInput = document.getElementById("universalBaseUrl");
const toggleAnthropicKeyBtn = document.getElementById("toggleAnthropicKey");
const toggleGeminiKeyBtn = document.getElementById("toggleGeminiKey");
const toggleUniversalKeyBtn = document.getElementById("toggleUniversalKey");
const eyeAnthropicIcon = document.getElementById("eyeAnthropicIcon");
const eyeGeminiIcon = document.getElementById("eyeGeminiIcon");
const eyeUniversalIcon = document.getElementById("eyeUniversalIcon");
const badgeClaudeSession = document.getElementById("badgeClaudeSession");
const badgeAgySession = document.getElementById("badgeAgySession");
const badgeUniversalKey = document.getElementById("badgeUniversalKey");

// Automation & GitHub Elements
const githubTokenInput = document.getElementById("githubToken");
const toggleGithubKeyBtn = document.getElementById("toggleGithubKey");
const eyeGithubIcon = document.getElementById("eyeGithubIcon");
const autoAnalyzeCheckbox = document.getElementById("autoAnalyze");
const autoFixCheckbox = document.getElementById("autoFix");
const deployCommandInput = document.getElementById("deployCommand");
const btnTestDeploy = document.getElementById("btnTestDeploy");

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

if (toggleAnthropicKeyBtn && anthropicApiKeyInput) {
  toggleAnthropicKeyBtn.addEventListener("click", () => {
    const isPass = anthropicApiKeyInput.type === "password";
    anthropicApiKeyInput.type = isPass ? "text" : "password";
    eyeAnthropicIcon.innerHTML = isPass
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
  });
}

if (toggleGeminiKeyBtn && geminiApiKeyInput) {
  toggleGeminiKeyBtn.addEventListener("click", () => {
    const isPass = geminiApiKeyInput.type === "password";
    geminiApiKeyInput.type = isPass ? "text" : "password";
    eyeGeminiIcon.innerHTML = isPass
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
  });
}

if (toggleUniversalKeyBtn && universalApiKeyInput) {
  toggleUniversalKeyBtn.addEventListener("click", () => {
    const isPass = universalApiKeyInput.type === "password";
    universalApiKeyInput.type = isPass ? "text" : "password";
    eyeUniversalIcon.innerHTML = isPass
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

// Helper untuk menyembunyikan/menampilkan select model sesuai engine
function syncEngineView(engine) {
  if (groupAgyModel) groupAgyModel.style.display = engine === "agy" ? "block" : "none";
  if (groupClaudeModel) groupClaudeModel.style.display = engine === "claude" ? "block" : "none";
  if (groupUniversalModel) groupUniversalModel.style.display = engine === "universal" ? "block" : "none";
}

// Update Live Badges
function updateBadges(settings, system) {
  if (settings.CLI_ENGINE === "claude") {
    badgeEngine.textContent = "Claude Code";
    badgeModel.textContent = settings.CLAUDE_MODEL || "sonnet";
  } else if (settings.CLI_ENGINE === "universal") {
    badgeEngine.textContent = "Universal API";
    badgeModel.textContent = settings.UNIVERSAL_MODEL || "deepseek-chat";
  } else {
    badgeEngine.textContent = "Antigravity (agy)";
    badgeModel.textContent = settings.AGY_MODEL || "gemini-3.8-flash-medium";
  }
  
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

    // Populate inputs
    botTokenInput.value = currentSettings.BOT_TOKEN || "";
    allowedIdsInput.value = currentSettings.ALLOWED_TELEGRAM_IDS || "";
    renderIdChips(currentSettings.ALLOWED_TELEGRAM_IDS);

    // Populate Engine Radio
    const activeEngine = currentSettings.CLI_ENGINE || "agy";
    for (const r of engineRadios) {
      r.checked = r.value === activeEngine;
    }
    syncEngineView(activeEngine);

    // Populate AGY Models Select
    agyModelSelect.innerHTML = "";
    for (const m of (availableOptions.agyModels || [])) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.name} ${m.badge ? `[${m.badge}]` : ""}`;
      opt.selected = m.id === currentSettings.AGY_MODEL;
      agyModelSelect.appendChild(opt);
    }

    // Populate Claude Models Select
    claudeModelSelect.innerHTML = "";
    for (const m of (availableOptions.claudeModels || [])) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.name} ${m.badge ? `[${m.badge}]` : ""}`;
      opt.selected = m.id === currentSettings.CLAUDE_MODEL;
      claudeModelSelect.appendChild(opt);
    }

    // Populate Universal Models Select
    if (universalModelSelect) {
      universalModelSelect.innerHTML = "";
      for (const m of (availableOptions.universalModels || [])) {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = `${m.name} ${m.badge ? `[${m.badge}]` : ""}`;
        opt.selected = m.id === (currentSettings.UNIVERSAL_MODEL || "deepseek-chat");
        universalModelSelect.appendChild(opt);
      }
    }

    // Populate Universal API inputs
    if (universalBaseUrlInput) {
      universalBaseUrlInput.value = currentSettings.UNIVERSAL_BASE_URL || "https://api.deepseek.com/v1";
    }
    if (universalApiKeyInput) {
      universalApiKeyInput.value = currentSettings.UNIVERSAL_API_KEY || "";
    }

    // Populate Auto Approve
    autoApproveCheckbox.checked =
      currentSettings.AGY_AUTO_APPROVE_PERMISSIONS === "true" ||
      currentSettings.AGY_AUTO_APPROVE_PERMISSIONS === true;

    // Populate Auth Mode & API Keys
    const claudeAuth = currentSettings.CLAUDE_AUTH_TYPE || "oauth";
    for (const r of claudeAuthRadios) {
      r.checked = r.value === claudeAuth;
    }
    if (anthropicApiKeyInput) {
      anthropicApiKeyInput.value = currentSettings.ANTHROPIC_API_KEY || "";
    }

    const agyAuth = currentSettings.AGY_AUTH_TYPE || "oauth";
    for (const r of agyAuthRadios) {
      r.checked = r.value === agyAuth;
    }
    if (geminiApiKeyInput) {
      geminiApiKeyInput.value = currentSettings.GEMINI_API_KEY || "";
    }

    // Status Badges
    if (data.authStatus) {
      if (badgeClaudeSession) {
        if (data.authStatus.claudeSessionActive) {
          badgeClaudeSession.className = "badge badge-primary";
          badgeClaudeSession.innerHTML = "✓ Sesi Aktif";
        } else {
          badgeClaudeSession.className = "badge";
          badgeClaudeSession.innerHTML = "Belum Login";
        }
      }

      if (badgeAgySession) {
        if (data.authStatus.agySessionActive) {
          badgeAgySession.className = "badge badge-primary";
          badgeAgySession.innerHTML = "✓ Sesi Aktif";
        } else {
          badgeAgySession.className = "badge";
          badgeAgySession.innerHTML = "Belum Login";
        }
      }

      if (badgeUniversalKey) {
        if (data.authStatus.hasUniversalKey) {
          badgeUniversalKey.className = "badge badge-primary";
          badgeUniversalKey.innerHTML = "✓ Key Terpasang";
        } else {
          badgeUniversalKey.className = "badge";
          badgeUniversalKey.innerHTML = "Belum Diisi";
        }
      }
    }

    // Populate Timeout
    timeoutInput.value = currentSettings.TASK_TIMEOUT_MS || "900000";
    timeoutFormatted.textContent = formatMs(timeoutInput.value);

    // Populate GitHub Token & Deploy Command
    if (githubTokenInput) {
      githubTokenInput.value = currentSettings.GITHUB_TOKEN || "";
    }
    if (deployCommandInput) {
      deployCommandInput.value = currentSettings.DEPLOY_COMMAND || "";
    }

    // Ambil data status otomasi
    try {
      const autoRes = await fetch("/api/automation");
      if (autoRes.ok) {
        const autoData = await autoRes.json();
        if (autoData.ok) {
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

// Preset buttons
document.querySelectorAll(".btn-preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    const ms = btn.getAttribute("data-ms");
    timeoutInput.value = ms;
    timeoutFormatted.textContent = formatMs(ms);
  });
});

// Radio change
engineRadios.forEach((r) => {
  r.addEventListener("change", () => {
    syncEngineView(r.value);
    if (r.value === "claude") {
      badgeEngine.textContent = "Claude Code";
      badgeModel.textContent = claudeModelSelect.value;
    } else if (r.value === "universal") {
      badgeEngine.textContent = "Universal API";
      badgeModel.textContent = universalModelSelect ? universalModelSelect.value : "deepseek-chat";
    } else {
      badgeEngine.textContent = "Antigravity (agy)";
      badgeModel.textContent = agyModelSelect.value;
    }
  });
});

agyModelSelect.addEventListener("change", () => {
  const selectedEngine = document.querySelector('input[name="CLI_ENGINE"]:checked')?.value;
  if (selectedEngine === "agy") {
    badgeModel.textContent = agyModelSelect.value;
  }
});

claudeModelSelect.addEventListener("change", () => {
  const selectedEngine = document.querySelector('input[name="CLI_ENGINE"]:checked')?.value;
  if (selectedEngine === "claude") {
    badgeModel.textContent = claudeModelSelect.value;
  }
});

if (universalModelSelect) {
  universalModelSelect.addEventListener("change", () => {
    const selectedEngine = document.querySelector('input[name="CLI_ENGINE"]:checked')?.value;
    if (selectedEngine === "universal") {
      badgeModel.textContent = universalModelSelect.value;
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

  const selectedEngine = document.querySelector('input[name="CLI_ENGINE"]:checked')?.value || "agy";
  const selectedClaudeAuth = document.querySelector('input[name="CLAUDE_AUTH_TYPE"]:checked')?.value || "oauth";
  const selectedAgyAuth = document.querySelector('input[name="AGY_AUTH_TYPE"]:checked')?.value || "oauth";

  const payload = {
    BOT_TOKEN: botTokenInput.value.trim(),
    ALLOWED_TELEGRAM_IDS: allowedIdsInput.value.trim(),
    CLI_ENGINE: selectedEngine,
    AGY_MODEL: agyModelSelect.value,
    CLAUDE_MODEL: claudeModelSelect.value,
    UNIVERSAL_MODEL: universalModelSelect ? universalModelSelect.value : "",
    UNIVERSAL_API_KEY: universalApiKeyInput ? universalApiKeyInput.value.trim() : "",
    UNIVERSAL_BASE_URL: universalBaseUrlInput ? universalBaseUrlInput.value.trim() : "",
    CLAUDE_AUTH_TYPE: selectedClaudeAuth,
    AGY_AUTH_TYPE: selectedAgyAuth,
    ANTHROPIC_API_KEY: anthropicApiKeyInput ? anthropicApiKeyInput.value.trim() : "",
    GEMINI_API_KEY: geminiApiKeyInput ? geminiApiKeyInput.value.trim() : "",
    AGY_AUTO_APPROVE_PERMISSIONS: autoApproveCheckbox.checked ? "true" : "false",
    TASK_TIMEOUT_MS: timeoutInput.value.trim(),
    GITHUB_TOKEN: githubTokenInput ? githubTokenInput.value.trim() : "",
    DEPLOY_COMMAND: deployCommandInput ? deployCommandInput.value.trim() : "",
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

// Initialize on page load
loadSettings();
