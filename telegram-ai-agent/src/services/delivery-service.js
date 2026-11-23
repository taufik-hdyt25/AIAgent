import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 60000;
const PUSH_TIMEOUT_MS = 120000;
const BUILD_TIMEOUT_MS = 300000;
const MAX_SCANNED_REPOS = 12;
const AGENT_GIT_IDENTITY = { name: "TH Agent", email: "th-agent@thstudio.web.id" };

const SENSITIVE_PATH_PATTERN =
  /(^|\/)(\.env($|\.)|\.env\..*|id_(rsa|ed25519|dsa|ecdsa)(\.pub)?|.*\.(pem|p12|pfx|key))$/i;

const SAFE_GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "true",
  GCM_INTERACTIVE: "never",
  GIT_SSH_COMMAND:
    process.env.GIT_SSH_COMMAND ||
    "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15",
};

function gitEnv() {
  const env = { ...SAFE_GIT_ENV };
  delete env.BOT_TOKEN;
  delete env.ALLOWED_TELEGRAM_IDS;
  return env;
}

async function run(command, args, { cwd, timeout = GIT_TIMEOUT_MS, env = gitEnv() } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env,
    });
    return { ok: true, code: 0, stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() };
  } catch (err) {
    return {
      ok: false,
      code: typeof err.code === "number" ? err.code : 1,
      stdout: String(err.stdout || "").trim(),
      stderr: String(err.stderr || err.message || "").trim(),
    };
  }
}

function git(cwd, args, opts = {}) {
  return run("git", args, { cwd, ...opts });
}

export function isDeliveryEnabled(env = process.env) {
  return String(env.AUTO_DELIVERY_ENABLED ?? "true").toLowerCase() !== "false";
}

function parsePorcelainPaths(stdout) {
  const paths = [];
  for (const line of String(stdout || "").split("\n")) {
    if (!line.trim()) continue;
    let rest = line.slice(3).trim();
    if (rest.includes(" -> ")) rest = rest.split(" -> ").pop().trim();
    rest = rest.replace(/^"(.*)"$/, "$1").trim();
    if (rest) paths.push(rest);
  }
  return paths;
}

/**
 * Ambil kondisi repo: branch, HEAD, daftar perubahan, dan jumlah commit lokal
 * yang belum terkirim ke upstream.
 */
export async function inspectRepo(dir) {
  if (!dir) return null;
  const inside = await git(dir, ["rev-parse", "--is-inside-work-tree"], { timeout: 15000 });
  if (!inside.ok || inside.stdout !== "true") return null;

  const top = await git(dir, ["rev-parse", "--show-toplevel"], { timeout: 15000 });
  const repoDir = top.ok && top.stdout ? top.stdout : path.resolve(dir);

  const branchRes = await git(repoDir, ["symbolic-ref", "--short", "HEAD"], { timeout: 15000 });
  const branch = branchRes.ok ? branchRes.stdout : null;

  const headRes = await git(repoDir, ["rev-parse", "HEAD"], { timeout: 15000 });
  const head = headRes.ok ? headRes.stdout : null;

  const statusRes = await git(repoDir, ["status", "--porcelain=v1", "-uall"], { timeout: 30000 });
  const changePaths = statusRes.ok ? parsePorcelainPaths(statusRes.stdout) : [];

  let ahead = 0;
  let hasUpstream = false;
  if (branch) {
    const upstream = await git(repoDir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
      timeout: 15000,
    });
    hasUpstream = Boolean(upstream.ok && upstream.stdout);
    if (hasUpstream) {
      const count = await git(repoDir, ["rev-list", "--count", "@{u}..HEAD"], { timeout: 30000 });
      ahead = count.ok ? Number.parseInt(count.stdout, 10) || 0 : 0;
    }
  }

  return {
    dir: repoDir,
    branch,
    head,
    changePaths,
    changes: changePaths,
    ahead,
    hasUpstream,
    dirty: changePaths.length > 0,
  };
}

export function repoSignature(state) {
  if (!state) return "none";
  return [state.head || "-", state.branch || "-", state.ahead, state.changePaths.join(";")].join("|");
}

function agentRepoCandidates(env = process.env, projectRoots = []) {
  const candidates = [
    env.AGENT_REPO_DIR,
    env.WORKSPACE_DIR,
    path.resolve(process.cwd(), "projects/AIAgent"),
    path.resolve(process.cwd(), "../projects/AIAgent"),
  ];
  for (const root of projectRoots.filter(Boolean)) {
    candidates.push(path.resolve(root, "AIAgent"));
  }
  if (env.DELIVERY_EXTRA_REPOS) {
    candidates.push(...String(env.DELIVERY_EXTRA_REPOS).split(path.delimiter));
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function hasGitDir(dir) {
  try {
    const stats = await fsp.stat(path.join(dir, ".git"));
    return stats.isDirectory() || stats.isFile();
  } catch (_) {
    return false;
  }
}

/**
 * Repo kandidat: working directory task, subfolder proyek satu level di bawahnya,
 * dan checkout repo TH Agent sendiri (workspace/AGENT_REPO_DIR).
 */
export async function listCandidateRepos(searchDir, { env = process.env, includeAgentRepo = true } = {}) {
  const dirs = new Set();
  const add = async (dir) => {
    const state = await inspectRepo(dir);
    if (state) dirs.add(state.dir);
  };

  if (searchDir) {
    await add(searchDir);
    try {
      const entries = await fsp.readdir(searchDir, { withFileTypes: true });
      for (const entry of entries) {
        if (dirs.size >= MAX_SCANNED_REPOS) break;
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const candidate = path.join(searchDir, entry.name);
        if (!(await hasGitDir(candidate))) continue;
        await add(candidate);
      }
    } catch (_) {}
  }

  if (includeAgentRepo) {
    for (const candidate of agentRepoCandidates(env, [searchDir])) {
      await add(candidate);
    }
  }

  return [...dirs];
}

export async function takeDeliveryBaseline(searchDir, options = {}) {
  const enabled = options.enabled ?? isDeliveryEnabled(options.env || process.env);
  if (!enabled) return null;
  const repos = await listCandidateRepos(searchDir, options);
  const snapshot = new Map();
  for (const dir of repos) {
    const state = await inspectRepo(dir);
    snapshot.set(dir, {
      signature: repoSignature(state),
      head: state?.head || null,
      paths: new Set(state?.changePaths || []),
    });
  }
  return { repos, snapshot, startedAt: Date.now() };
}

/** Path yang berubah SETELAH baseline (file untracked lama tidak ikut). */
export function newlyChangedPaths(baselineEntry, state) {
  if (!state) return [];
  const before = baselineEntry?.paths || new Set();
  const beforeHead = baselineEntry?.head || null;
  if (beforeHead && state.head && beforeHead !== state.head) {
    // Agent sudah commit sendiri; biarkan repo bersih dan cukup push.
    return [];
  }
  return state.changePaths.filter((p) => !before.has(p));
}

async function verifyPush(repoDir, branch, expectedHead) {
  const state = await inspectRepo(repoDir);
  if (!state) return { verified: false, reason: "repo tidak terbaca" };
  if (!branch) return { verified: false, reason: "detached HEAD tanpa branch" };

  // `ahead === 0` saja tidak cukup: repo bisa saja tertinggal dari remote.
  // Sumber kebenaran delivery adalah SHA branch remote yang sama persis dengan HEAD.
  const remote = await git(repoDir, ["ls-remote", "--heads", "origin", branch], { timeout: 30000 });
  if (!remote.ok) return { verified: false, reason: remote.stderr || "gagal membaca remote" };
  const remoteSha = remote.stdout.split(/\s+/)[0] || "";
  if (expectedHead && remoteSha === expectedHead) return { verified: true, reason: "remote = HEAD" };
  return {
    verified: false,
    reason: remoteSha
      ? `remote ${remoteSha.slice(0, 7)} != HEAD ${String(expectedHead).slice(0, 7)}`
      : `branch ${branch} belum ada di remote`,
  };
}

export async function commitAndPush(repoDir, { message, paths = null, env = process.env } = {}) {
  const before = await inspectRepo(repoDir);
  if (!before) return { repo: repoDir, ok: false, skipped: true, reason: "bukan git repo" };

  const sensitive = (paths || before.changePaths).filter((p) => SENSITIVE_PATH_PATTERN.test(p));
  const stagePaths = paths ? paths.filter((p) => !sensitive.includes(p)) : null;

  if (!before.dirty && before.ahead === 0) {
    // Agent bisa saja sudah commit+push sendiri. Tetap verifikasi HEAD terhadap
    // remote agar laporan Telegram tidak pernah menganggap pekerjaan "selesai"
    // hanya karena working tree kebetulan bersih.
    const verification = await verifyPush(before.dir, before.branch, before.head);
    return {
      repo: before.dir,
      branch: before.branch,
      ok: verification.verified || !before.branch,
      changed: false,
      committed: null,
      pushed: false,
      pushVerified: verification.verified,
      pushError: verification.verified ? null : verification.reason,
      skippedSensitive: sensitive,
    };
  }

  let committed = null;
  let commitError = null;
  const hasSomethingToCommit = stagePaths ? stagePaths.length > 0 : true;

  if (hasSomethingToCommit) {
    const add = await git(repoDir, ["add", "--", ...(stagePaths || ["."])]);
    if (!add.ok) {
      commitError = `git add gagal: ${add.stderr || add.stdout}`;
    } else {
      const commitMessage = String(message || "chore(agent): perubahan otomatis").slice(0, 200);
      const commit = await git(repoDir, [
        "-c",
        `user.name=${env.GIT_AUTHOR_NAME || AGENT_GIT_IDENTITY.name}`,
        "-c",
        `user.email=${env.GIT_AUTHOR_EMAIL || AGENT_GIT_IDENTITY.email}`,
        "commit",
        "-m",
        commitMessage,
      ]);
      if (commit.ok) {
        const head = await git(repoDir, ["rev-parse", "--short", "HEAD"]);
        committed = head.ok ? head.stdout : "(unknown)";
      } else if (/nothing to commit|no changes added/i.test(commit.stdout + commit.stderr)) {
        committed = null;
      } else {
        commitError = `git commit gagal: ${commit.stderr || commit.stdout}`;
      }
    }
  }

  if (commitError) {
    return {
      repo: before.dir,
      branch: before.branch,
      ok: false,
      changed: true,
      committed: null,
      pushed: false,
      files: before.changePaths.length,
      error: commitError,
      skippedSensitive: sensitive,
    };
  }

  const after = await inspectRepo(repoDir);
  const needsPush = Boolean(committed) || (after?.ahead || 0) > 0;

  let pushed = false;
  let pushError = null;
  if (needsPush) {
    const args = ["push"];
    if (!after?.hasUpstream) args.push("-u", "origin", after?.branch || "HEAD");
    const res = await git(repoDir, args, { timeout: PUSH_TIMEOUT_MS });
    pushed = res.ok;
    if (!res.ok) pushError = res.stderr || res.stdout || "git push gagal tanpa output";
  }

  let verification = { verified: false, reason: "tidak ada push" };
  if (needsPush && pushed) {
    const headRes = await git(repoDir, ["rev-parse", "HEAD"]);
    verification = await verifyPush(after?.dir || repoDir, after?.branch, headRes.ok ? headRes.stdout : null);
  }

  return {
    repo: after?.dir || before.dir,
    branch: after?.branch || before.branch,
    ok: !needsPush || (pushed && verification.verified),
    changed: true,
    committed,
    files: before.changePaths.length,
    pushed,
    pushVerified: verification.verified,
    pushError: pushError || (needsPush && !verification.verified ? verification.reason : null),
    skippedSensitive: sensitive,
  };
}

async function readPackageJson(dir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8"));
  } catch (_) {
    return null;
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function resolveRuntimeBin() {
  const argv1 = process.argv[1] || "";
  if (argv1 && /th-agent-bin|bot\.bundle\.js$/.test(argv1) && fs.existsSync(argv1)) {
    return argv1;
  }
  const candidate = path.join(os.homedir(), ".th-agent", "th-agent-bin");
  return fs.existsSync(candidate) ? candidate : null;
}

export async function runProjectBuild(repoDir) {
  const pkg = await readPackageJson(repoDir);
  if (!pkg) return { ran: false, reason: "tidak ada package.json" };

  const script = pkg.scripts?.bundle ? "bundle" : pkg.scripts?.build ? "build" : null;
  if (!script) return { ran: false, reason: "tidak ada script build/bundle" };

  const res = await run(npmCommand(), ["run", script], {
    cwd: repoDir,
    timeout: BUILD_TIMEOUT_MS,
    env: { ...gitEnv(), CI: "true", NONINTERACTIVE: "1" },
  });
  const output = `${res.stdout || ""}${res.stderr ? `\n${res.stderr}` : ""}`.trim();
  return {
    ran: true,
    ok: res.ok,
    script,
    command: `npm run ${script}`,
    outputTail: output.split("\n").filter(Boolean).slice(-8).join("\n"),
  };
}

async function findAgentDir(repoDir) {
  const nested = path.join(repoDir, "telegram-ai-agent");
  const nestedPkg = await readPackageJson(nested);
  if (nestedPkg?.name === "th-agent") return { agentDir: nested, pkg: nestedPkg };
  const directPkg = await readPackageJson(repoDir);
  if (directPkg?.name === "th-agent") return { agentDir: repoDir, pkg: directPkg };
  return null;
}

async function replaceRuntimeBin(agentDir, runtimeBin) {
  const built = path.join(agentDir, "dist", "bot.bundle.js");
  if (!fs.existsSync(built)) return { replaced: false, reason: "dist/bot.bundle.js tidak ditemukan" };
  if (!runtimeBin) return { replaced: false, reason: "lokasi binary runtime tidak diketahui" };

  const temp = `${runtimeBin}.tmp-${process.pid}`;
  await fsp.copyFile(built, temp);
  await fsp.chmod(temp, 0o755);
  await fsp.rename(temp, runtimeBin);
  return { replaced: true, runtimeBin };
}

/**
 * Build repository agent sendiri lalu pasang bundle baru ke binary runtime.
 * Binary lama tetap utuh kalau build gagal, jadi bot tidak pernah "mati".
 */
export async function rebuildAgentBundle(repoDir) {
  const found = await findAgentDir(repoDir);
  if (!found) return { ran: false, reason: "bukan repo TH Agent" };

  const build = await runProjectBuild(found.agentDir);
  if (!build.ran || !build.ok) {
    return { ...build, replaced: false, agentDir: found.agentDir };
  }

  const runtimeBin = resolveRuntimeBin();
  const replaced = await replaceRuntimeBin(found.agentDir, runtimeBin);
  return { ...build, ...replaced, agentDir: found.agentDir };
}

export async function isAgentServiceActive() {
  if (process.platform === "darwin") {
    const res = await run("launchctl", ["list", "com.taufik.th-agent"], { timeout: 5000 });
    return res.ok;
  }
  const res = await run("systemctl", ["--user", "is-active", "th-agent"], { timeout: 5000 });
  return res.ok && res.stdout === "active";
}

export function scheduleAgentRestart(delayMs = 1500) {
  const timer = setTimeout(() => {
    try {
      if (process.platform === "darwin") {
        spawn("launchctl", ["kickstart", "-k", `gui/${process.getuid?.() ?? 501}/com.taufik.th-agent`], {
          detached: true,
          stdio: "ignore",
        }).unref();
      } else {
        spawn("systemctl", ["--user", "restart", "th-agent"], {
          detached: true,
          stdio: "ignore",
        }).unref();
      }
    } catch (_) {}
    setTimeout(() => process.exit(0), 8000).unref?.();
  }, delayMs);
  timer.unref?.();
  return timer;
}

const CLAIM_PATTERNS = {
  push: /(sudah|telah|berhasil|udah|done|sukses)[^\n]{0,40}\b(push|di-?push)\b|\b(push|di-?push)\b[^\n]{0,25}\b(berhasil|sukses|selesai|udah|sudah|done)\b/i,
  build: /(sudah|telah|berhasil|udah|done|sukses)[^\n]{0,40}\b(build|di-?build|bundl\w*)\b|\b(build|di-?build)\b[^\n]{0,25}\b(berhasil|sukses|selesai|udah|sudah|done)\b/i,
  deploy: /(sudah|telah|berhasil|udah|done|sukses)[^\n]{0,40}\b(deploy|di-?deploy|restart|live)\b|\b(deploy|di-?deploy)\b[^\n]{0,25}\b(berhasil|sukses|selesai|udah|sudah|done)\b/i,
};

export function detectUnverifiedClaims(text, delivery) {
  if (!text || !delivery || !Array.isArray(delivery.repos)) return [];
  const inspected = delivery.repos.filter((r) => !r.skipped);
  if (!inspected.length) return [];

  const anyPushed = inspected.some((r) => r.pushVerified);
  const anyBuildOk = inspected.some((r) => r.build?.ok || r.bundle?.ok || r.bundle?.replaced);
  const anyRestart = Boolean(delivery.restartRequired);

  const warnings = [];
  if (CLAIM_PATTERNS.push.test(text) && !anyPushed) {
    warnings.push("klaim *push* tidak terverifikasi: tidak ada commit yang terkonfirmasi sampai di remote.");
  }
  if (CLAIM_PATTERNS.build.test(text) && !anyBuildOk) {
    warnings.push("klaim *build* tidak terverifikasi: tidak ada build/bundle yang berhasil dijalankan.");
  }
  if (CLAIM_PATTERNS.deploy.test(text) && !anyRestart && !anyBuildOk) {
    warnings.push("klaim *deploy/restart* tidak terverifikasi oleh sistem.");
  }
  return warnings;
}

function shortRepoName(dir) {
  return path.basename(String(dir || "")) || String(dir || "");
}

export function formatDeliveryReport(result) {
  if (!result || result.disabled) return "";
  const repos = (result.repos || []).filter((r) => !r.skipped);
  const lines = [];

  for (const repo of repos) {
    const name = shortRepoName(repo.repo);
    if (!repo.changed) {
      lines.push(`• \`${name}\`: tidak ada perubahan (tidak ada commit/push).`);
      continue;
    }

    const bits = [];
    if (repo.error) {
      bits.push(`❌ ${repo.error}`);
    } else {
      if (repo.committed) bits.push(`commit \`${repo.committed}\``);
      if (repo.pushVerified) bits.push(`push ke \`${repo.branch || "remote"}\` terverifikasi ✓`);
      else if (repo.pushed && !repo.pushVerified) {
        bits.push(`⚠️ push terkirim tapi belum terverifikasi (${repo.pushError || "unknown"})`);
      } else if (repo.pushError) bits.push(`⚠️ push gagal: ${String(repo.pushError).slice(0, 200)}`);
      else if (!repo.committed) bits.push("tidak ada perubahan");
    }
    lines.push(`• \`${name}\`: ${bits.join(" · ")}`);
    if (repo.deliveryVerified === false) {
      lines.push("  ↳ ❌ delivery belum terverifikasi penuh — jangan anggap tugas selesai");
    }

    if (repo.skippedSensitive?.length) {
      lines.push(`  ↳ ⚠️ ${repo.skippedSensitive.length} file sensitif tidak di-commit: ${repo.skippedSensitive.slice(0, 3).join(", ")}`);
    }

    if (repo.bundle?.ran) {
      if (repo.bundle.ok && repo.bundle.replaced) {
        lines.push(`  ↳ bundle: ✓ \`${repo.bundle.command || "npm run bundle"}\`, binary runtime diperbarui`);
      } else if (repo.bundle.ok) {
        lines.push(`  ↳ bundle: ✓ ${repo.bundle.command || "build"} (${repo.bundle.reason || "binary tidak diganti"})`);
      } else {
        lines.push(`  ↳ bundle: ❌ \`${repo.bundle.command || "build"}\` gagal`);
      }
    } else if (repo.build?.ran) {
      lines.push(repo.build.ok ? `  ↳ build: ✓ \`${repo.build.command}\`` : `  ↳ build: ❌ \`${repo.build.command}\` gagal`);
    } else if (repo.build?.deferred) {
      lines.push("  ↳ build: ⏸️ ditunda (masih ada antrean chat)");
    }
  }

  if (result.restartRequired) {
    lines.push("  ↳ restart service: dijadwalkan setelah balasan terkirim");
  }

  if (result.repos?.some((repo) => repo.deliveryVerified === false)) {
    lines.push("⚠️ *Status akhir: BELUM SELESAI / BELUM TERVERIFIKASI penuh.*");
  }

  if (!lines.length) return "";
  return `📦 *Delivery Check (otomatis)*\n${lines.join("\n")}`;
}

/**
 * Verifikasi & lengkapi hasil kerja: commit+push perubahan baru, build ulang,
 * dan rebuild bundle bila repo TH Agent sendiri yang berubah.
 * Hanya path yang BERUBAH sejak baseline yang di-commit, sehingga pekerjaan
 * lain yang sudah dirty sebelumnya tidak ikut terbawa.
 */
export async function finalizeDelivery({
  searchDir = process.cwd(),
  baseline = null,
  userMessage = "",
  queueLength = 0,
  env = process.env,
} = {}) {
  if (!isDeliveryEnabled(env)) return { disabled: true, repos: [], restartRequired: false };

  const repos = await listCandidateRepos(searchDir, { env });
  const results = [];
  const touched = new Set();

  for (const dir of repos) {
    const state = await inspectRepo(dir);
    if (!state) continue;

    const previous = baseline?.snapshot?.get(dir);
    const signature = repoSignature(state);
    if (previous && previous.signature === signature) {
      results.push({ repo: state.dir, branch: state.branch, changed: false, skipped: false });
      continue;
    }

    touched.add(state.dir);
    const newPaths = previous ? newlyChangedPaths(previous, state) : state.changePaths;
    const message = `chore(agent): ${String(userMessage || "update otomatis").split("\n")[0].slice(0, 160)}`;
    const pushResult = await commitAndPush(state.dir, { message, paths: newPaths, env });

    const entry = {
      repo: pushResult.repo || state.dir,
      branch: pushResult.branch ?? state.branch,
      changed: true,
      committed: pushResult.committed || null,
      files: pushResult.files ?? newPaths.length,
      pushed: Boolean(pushResult.pushed),
      pushVerified: Boolean(pushResult.pushVerified),
      pushError: pushResult.error || pushResult.pushError || null,
      skippedSensitive: pushResult.skippedSensitive || [],
      error: pushResult.ok ? null : pushResult.error || null,
    };

    const agentInfo = await findAgentDir(entry.repo);
    if (agentInfo) {
      entry.bundle = await rebuildAgentBundle(entry.repo);
    } else {
      // Build tidak boleh ditunda hanya karena ada antrean Telegram. Penundaan
      // inilah yang sebelumnya membuat bot melapor selesai padahal artefak
      // runtime belum diperbarui.
      entry.build = await runProjectBuild(entry.repo);
    }

    // Delivery hanya dianggap sukses jika setiap tahap yang relevan benar-benar
    // terverifikasi. Status ini dipakai oleh dispatcher untuk menahan klaim
    // "selesai" saat push/build gagal.
      const buildResult = entry.bundle || entry.build;
    entry.deliveryVerified = Boolean(
      (!entry.changed || entry.pushVerified) &&
      (!buildResult?.ran || buildResult.ok) &&
      (!entry.bundle?.ran || (entry.bundle.ok && (entry.bundle.replaced || entry.bundle.reason)))
    );

    results.push(entry);
  }

  let restartRequired = false;
  const selfChanged = results.some((r) => r.bundle?.replaced);
  if (selfChanged && queueLength === 0) {
    if (await isAgentServiceActive()) {
      restartRequired = true;
    } else {
      const self = results.find((r) => r.bundle?.replaced);
      if (self) self.bundle.reason = "restart manual diperlukan (service manager tidak aktif)";
    }
  }

  return {
    repos: results,
    touched: [...touched],
    restartRequired,
    checkedAt: new Date().toISOString(),
  };
}
