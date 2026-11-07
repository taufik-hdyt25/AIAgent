const DEFAULT_URL = "http://127.0.0.1:8317";

function baseUrl() {
  return (process.env.CLIPROXY_URL || DEFAULT_URL).replace(/\/+$/, "");
}

function mgmtKey() {
  return process.env.CLIPROXY_MGMT_KEY || process.env.CLIPROXY_MANAGEMENT_KEY || "";
}

function clientKey() {
  return process.env.CLIPROXY_CLIENT_KEY || process.env.PI_SERVER_API_KEY || "";
}

async function request(path, { method = "GET", headers = {}, body, key = "mgmt", timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const h = { Accept: "application/json", ...headers };
    if (key === "mgmt" && mgmtKey()) h.Authorization = `Bearer ${mgmtKey()}`;
    if (key === "client" && clientKey()) h.Authorization = `Bearer ${clientKey()}`;
    if (body !== undefined) h["Content-Type"] = "application/json";

    const res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err.name === "AbortError" ? "Timeout menghubungi CLIProxyAPI" : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getCpaStatus() {
  const modelsRes = await request("/v1/models", { key: "client", timeoutMs: 6000 });
  const credsRes = await request("/v8/management/credentials", { key: "mgmt", timeoutMs: 6000 });

  const models = Array.isArray(modelsRes.data?.data)
    ? modelsRes.data.data
    : Array.isArray(modelsRes.data?.models)
    ? modelsRes.data.models
    : [];
  const credentials = Array.isArray(credsRes.data?.data)
    ? credsRes.data.data
    : Array.isArray(credsRes.data?.credentials)
    ? credsRes.data.credentials
    : Array.isArray(credsRes.data)
    ? credsRes.data
    : [];

  return {
    ok: true,
    url: baseUrl(),
    reachable: modelsRes.ok || credsRes.ok || modelsRes.status > 0,
    modelsOk: modelsRes.ok,
    managementOk: credsRes.ok,
    modelCount: models.length,
    models: models.map((m) => ({ id: m.id || m.name, name: m.name || m.id })),
    credentials: credentials.map((c) => ({
      id: c.id || c.ID || c.file_name || c.FileName || "",
      provider: c.provider || c.Provider || c.type || "",
      label: c.label || c.Label || c.email || "",
      status: c.status || c.Status || "",
    })),
    errors: {
      models: modelsRes.ok ? null : modelsRes.error || `HTTP ${modelsRes.status}`,
      management: credsRes.ok ? null : credsRes.error || `HTTP ${credsRes.status}`,
    },
  };
}

export async function startCpaOAuth(provider = "antigravity") {
  const allowed = ["antigravity", "claude", "codex", "kimi", "kimi-ai", "xai", "devin", "meta"];
  const p = String(provider || "").toLowerCase();
  if (!allowed.includes(p)) throw new Error(`Provider OAuth tidak didukung: ${provider}`);

  const res = await request(`/v8/management/oauth/auth-url?provider=${encodeURIComponent(p)}`, {
    key: "mgmt",
  });
  if (!res.ok || res.data?.status === "error" || !res.data?.url) {
    throw new Error(res.error || res.data?.error || `Gagal membuat URL login (HTTP ${res.status})`);
  }
  return { provider: p, url: res.data.url, state: res.data.state || "" };
}

export async function getCpaOAuthStatus(state) {
  if (!state) throw new Error("state wajib diisi.");
  const res = await request(`/v8/management/oauth/status?state=${encodeURIComponent(state)}`, {
    key: "mgmt",
  });
  if (!res.ok) {
    throw new Error(res.error || res.data?.error || `Gagal cek status (HTTP ${res.status})`);
  }
  return res.data || {};
}

export async function submitCpaOAuthCallback({ provider, redirectUrl, state, code, error }) {
  const payload = {};
  if (provider) payload.provider = provider;
  if (redirectUrl) payload.redirect_url = redirectUrl;
  if (state) payload.state = state;
  if (code) payload.code = code;
  if (error) payload.error = error;

  if (!redirectUrl && !(state && (code || error))) {
    throw new Error("Masukkan URL callback lengkap (mengandung code & state).");
  }

  const res = await request("/v8/management/oauth/callback", {
    method: "POST",
    key: "mgmt",
    body: payload,
    timeoutMs: 20000,
  });
  if (!res.ok || (res.data && res.data.status === "error")) {
    throw new Error(res.error || res.data?.error || `Callback gagal (HTTP ${res.status})`);
  }
  return res.data || { status: "ok" };
}
