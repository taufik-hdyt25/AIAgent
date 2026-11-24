import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config/env.js";

const AUTONOMY_CONFIG_FILE =
  process.env.AUTONOMY_CONFIG_FILE || path.join(DATA_DIR, "autonomy_config.json");

export const AUTONOMY_MODES = ["orchestrator", "balanced", "strict"];
export const DEFAULT_AUTONOMY_MODE = "orchestrator";

let autonomyCache = null;

function normalizeMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "orchestrator" || raw === "orkestrator") return "orchestrator";
  if (raw === "balanced" || raw === "seimbang") return "balanced";
  if (raw === "strict" || raw === "ketat") return "strict";
  return null;
}

/**
 * Mode otonomi menentukan seberapa sering agent boleh berhenti untuk bertanya.
 * - orchestrator: developer memberi tujuan, agent memecah & mengeksekusi sampai tuntas.
 * - balanced: bertanya hanya jika target proyek ambigu atau aksi berisiko.
 * - strict: meminta konfirmasi sebelum aksi destruktif/tidak bisa dibatalkan.
 */
export async function getAutonomyConfig() {
  if (autonomyCache) return autonomyCache;

  let mode = normalizeMode(process.env.AGENT_MODE) || null;
  try {
    const parsed = JSON.parse(await readFile(AUTONOMY_CONFIG_FILE, "utf8"));
    mode = normalizeMode(parsed?.mode) || mode;
  } catch (_) {}

  autonomyCache = {
    mode: mode || DEFAULT_AUTONOMY_MODE,
    updatedAt: new Date().toISOString(),
  };
  return autonomyCache;
}

export async function saveAutonomyConfig({ mode } = {}) {
  const current = await getAutonomyConfig();
  const resolved = normalizeMode(mode) || current.mode;
  autonomyCache = { mode: resolved, updatedAt: new Date().toISOString() };
  await writeFile(AUTONOMY_CONFIG_FILE, JSON.stringify(autonomyCache, null, 2) + "\n", "utf8");
  return autonomyCache;
}

const ORCHESTRATOR_DIRECTIVE = `
MODE ORKESTRATOR (AKTIF — DEFAULT, WAJIB DIPATUHI):
0. Bedakan dulu jenis pesan: PERTANYAAN/diskusi -> jawab langsung tanpa menyentuh file. PERINTAH KERJA -> eksekusi sampai tuntas. Ragu di antara keduanya -> jawab singkat lalu kerjakan bagian yang jelas.
1. Developer adalah orkestrator: dia memberi TUJUAN, kamu yang memecah menjadi langkah teknis dan mengeksekusi semuanya sampai tuntas dalam satu putaran.
2. DILARANG meminta izin atau konfirmasi. Contoh yang DILARANG: "Mau saya buatkan sekarang?", "Boleh saya lanjut?", "Apakah Anda yakin?", "Sudah siap, lanjut ya?", "Konfirmasi dulu bro".
3. DILARANG menutup balasan dengan pertanyaan penawaran. Balasan diakhiri dengan HASIL KERJA dan status akhir, bukan tawaran langkah berikutnya.
4. Jika instruksi kurang detail: ambil asumsi teknis paling masuk akal, LANGSUNG KERJAKAN, lalu tulis asumsi yang kamu ambil di bagian akhir laporan. Jangan menunda pekerjaan untuk bertanya.
5. Jika target proyek tidak disebut jelas: pakai proyek yang sedang aktif/terakhir, atau pilih kandidat paling relevan dari './projects'. Sebutkan pilihanmu, lalu kerjakan. Hanya tanyakan balik jika ada lebih dari satu target yang sama-sama masuk akal dan pekerjaan benar-benar tidak bisa dilanjutkan dengan aman.
6. Kamu HANYA boleh bertanya jika benar-benar terblokir dan tidak ada jalan lain: (a) target proyek tetap ambigu setelah pemeriksaan konteks, (b) kredensial/secret pihak ketiga yang belum ada dan tidak bisa dibuat sendiri, atau (c) aksi destruktif permanen di luar repo (hapus database, hapus file produksi). Jangan bertanya ulang untuk instruksi fitur, update, atau fix yang sudah jelas.
7. Aturan berlaku untuk SEMUA proyek, bukan hanya AIAgent. Setelah setiap development/perubahan kode: jalankan pemeriksaan keamanan yang relevan terhadap OWASP Top 10, validasi input, autentikasi/otorisasi, secrets, dependency, serta konfigurasi deployment; perbaiki temuan yang diperkenalkan oleh perubahan.
8. Setelah perubahan, WAJIB lanjutkan sampai live: jalankan tes dan build yang sesuai, commit dan push, deploy/build ulang, restart/reload service terkait, lalu verifikasi service atau endpoint/UI yang benar-benar berjalan. Antrean tugas tidak boleh dijadikan alasan untuk melewati atau menunda langkah apa pun pada tugas ini. Hindari restart langsung sebelum balasan/tugas selesai terkirim—gunakan deferred restart bila perlu. Jangan mengklaim deploy jika tidak dapat diverifikasi.
9. Setelah validasi berhasil, commit dan push perubahan ke remote Git proyek terkait. Setelah push, verifikasi SHA HEAD terhadap branch remote. Jangan pernah men-stage atau menyertakan file rahasia, artefak runtime, atau perubahan lain yang tidak terkait.
10. Selesaikan alur: baca kode -> ubah -> audit keamanan -> test/build -> commit & push -> verifikasi remote -> deploy/restart -> verifikasi live -> lapor ringkas. Untuk pesan kerja yang jelas, jangan berhenti di analisis, jangan hanya memberi instruksi, dan jangan meminta konfirmasi.
11. Jangan mengatakan "sudah", "berhasil", "selesai", "sudah push", atau "sudah build" bila command terkait gagal, belum dijalankan, atau belum diverifikasi. Tulis status GAGAL/BELUM TERVERIFIKASI secara eksplisit.
`.trim();

const BALANCED_DIRECTIVE = `
MODE SEIMBANG (AKTIF):
0. PERTANYAAN/diskusi -> jawab langsung. PERINTAH KERJA -> eksekusi langsung.
1. Eksekusi langsung tanpa konfirmasi untuk pekerjaan yang jelas maksudnya.
2. Bertanya HANYA jika: target proyek ambigu di antara beberapa kandidat, atau permintaan berpotensi destruktif dan tidak bisa dibatalkan.
3. Jangan menutup balasan dengan tawaran/pertanyaan basa-basi. Akhiri dengan hasil kerja.
`.trim();

const STRICT_DIRECTIVE = `
MODE KETAT (AKTIF):
0. PERTANYAAN/diskusi -> jawab langsung. PERINTAH KERJA -> eksekusi langsung.
1. Eksekusi perubahan kode secara langsung untuk instruksi yang jelas.
2. Minta konfirmasi sebelum aksi destruktif atau sulit dibatalkan (hapus data, force push, reset, drop, hapus container/volume).
3. Selain itu, jangan bertanya dan jangan menutup balasan dengan tawaran.
`.trim();

export function buildAutonomyDirective(mode = DEFAULT_AUTONOMY_MODE) {
  const resolved = normalizeMode(mode) || DEFAULT_AUTONOMY_MODE;
  if (resolved === "strict") return STRICT_DIRECTIVE;
  if (resolved === "balanced") return BALANCED_DIRECTIVE;
  return ORCHESTRATOR_DIRECTIVE;
}

export function getAutonomyLabel(mode = DEFAULT_AUTONOMY_MODE) {
  const resolved = normalizeMode(mode) || DEFAULT_AUTONOMY_MODE;
  if (resolved === "strict") return "Ketat (konfirmasi aksi berisiko)";
  if (resolved === "balanced") return "Seimbang (tanya jika ambigu)";
  return "Orkestrator (eksekusi langsung)";
}
