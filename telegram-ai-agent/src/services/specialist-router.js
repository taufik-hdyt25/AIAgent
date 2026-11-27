const WRITER_RE = /\b(caption|copywriting|artikel|blog|seo|konten|promosi|promo|iklan|marketing|play\s*store|deskripsi\s*(app|aplikasi|produk)?|release\s*notes|headline|hashtag|ide\s*(topik|konten)|judul|script\s*video|terjemah|translate|storytelling|tagline|slogan)\b/gi;
const CODER_RE = /\b(code|kode|coding|bug|error|fix|perbaiki|debug|build|compile|deploy|server|vps|nginx|pm2|systemd|docker|sql|postgres|psql|prisma|git|commit|push|pull|rebase|api|endpoint|kotlin|gradle|android|apk|aab|next\.?js|react|typescript|javascript|node|python|bash|shell|log|ssh|port|crash|exception|401|404|500|502|503|oom|heap)\b/gi;

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

export function resolveSpecialist({ userMessage = "", targetProject = null, modelOverride = null } = {}) {
  const enabled = process.env.PI_AUTO_SPECIALIST !== "false";
  const coderProvider = process.env.PI_CODER_PROVIDER || process.env.PI_PROVIDER || "a2-codex";
  const coderModel = process.env.PI_CODER_MODEL || process.env.PI_MODEL || "gemini-4-hydrogen-xhigh";
  const writerProvider = process.env.PI_WRITER_PROVIDER || "a2-codex";
  const writerModel = process.env.PI_WRITER_MODEL || "gemini-3-flash";

  if (!enabled || modelOverride) {
    return {
      role: "default",
      provider: process.env.PI_PROVIDER || coderProvider,
      model: modelOverride || process.env.PI_MODEL || coderModel,
      systemHint: "",
    };
  }

  const text = String(userMessage || "");
  const writerHits = countMatches(text, WRITER_RE);
  const coderHits = countMatches(text, CODER_RE);

  if (writerHits > 0 && coderHits === 0) {
    return {
      role: "writer",
      provider: writerProvider,
      model: writerModel,
      systemHint:
        "[Specialist Mode: Content & Marketing Writer] Fokus pada copywriting, SEO, caption, dan komunikasi natural berbahasa Indonesia. Jangan mengubah file kode kecuali diminta.",
    };
  }

  if (coderHits > 0 || targetProject) {
    return {
      role: "coder",
      provider: coderProvider,
      model: coderModel,
      systemHint: "",
    };
  }

  return {
    role: "coder",
    provider: coderProvider,
    model: coderModel,
    systemHint: "",
  };
}
