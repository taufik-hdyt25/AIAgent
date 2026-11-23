# TH Agent Universal AI API

Dokumentasi endpoint AI universal TH Agent untuk digunakan oleh TH Blog, Content Studio, Telegram, autopost, dan aplikasi internal lain.

Endpoint ini menyediakan satu pintu akses ke provider dan model AI yang terhubung di TH Agent. Aplikasi pemanggil tidak perlu menyimpan API key provider atau mengetahui detail konfigurasi provider.

## Endpoint

```http
POST /api/ai
```

Endpoint dapat diakses melalui host dan port Web Server TH Agent, misalnya:

```text
http://127.0.0.1:PORT/api/ai
```

Gunakan HTTPS atau jaringan internal yang terlindungi jika endpoint diakses di luar mesin yang sama.

## Autentikasi

Kirim API key internal melalui header Bearer:

```http
Authorization: Bearer YOUR_TH_ADMIN_AGENT_API_KEY
Content-Type: application/json
```

Konfigurasi pada environment TH Agent:

```dotenv
TH_ADMIN_AGENT_API_KEY=isi-secret-yang-kuat
```

API key ini berbeda dari API key provider AI. Client hanya membutuhkan API key internal TH Agent.

> Jangan menaruh API key di frontend, repository publik, log, atau payload request.

## Kontrak request

Field utama:

| Field | Wajib | Tipe | Keterangan |
|---|---:|---|---|
| `app` | Disarankan | string | Identitas aplikasi pemanggil, misalnya `th-blog` atau `content-studio`. |
| `task` | Disarankan | string | Jenis pekerjaan, misalnya `autopost`, `seo`, atau `video-script`. |
| `mode` | Tidak | string | `generate` atau `structured`. Default: `generate`. |
| `profile` | Tidak | string | Profil/pola pekerjaan yang dipakai sebagai konteks. |
| `prompt` | Kondisional | string | Instruksi utama untuk model. Wajib jika `input` kosong. |
| `input` | Kondisional | object | Data tambahan untuk model. Wajib jika `prompt` tidak diberikan. |
| `schema` | Untuk structured | object | Bentuk data JSON yang diharapkan. |
| `language` | Tidak | string | Bahasa output, misalnya `id` atau `en`. Default: `id`. |
| `provider` | Tidak | string | Provider terhubung di TH Agent yang ingin digunakan. |
| `model` | Tidak | string | Model yang tersedia pada provider terhubung. |

Batas ukuran body request adalah 128 KB.

## Pemilihan provider dan model

Client tidak harus memakai model utama Telegram/TH Agent.

### Menggunakan konfigurasi aktif TH Agent

Jika `provider` dan `model` tidak dikirim, TH Agent menggunakan provider dan model aktif pada konfigurasi TH Agent:

```json
{
  "app": "th-blog",
  "task": "autopost",
  "mode": "generate",
  "profile": "blog-article",
  "language": "id",
  "prompt": "Buat artikel SEO tentang manfaat olahraga pagi."
}
```

### Memilih provider dan model tertentu

```json
{
  "app": "th-blog",
  "task": "autopost",
  "mode": "generate",
  "provider": "groq",
  "model": "llama-3.1-8b-instant",
  "prompt": "Buat artikel SEO tentang manfaat olahraga pagi."
}
```

### Hanya memilih model

Jika hanya `model` dikirim, TH Agent mencari provider terhubung yang memiliki model tersebut:

```json
{
  "app": "content-studio",
  "task": "video-script",
  "mode": "generate",
  "model": "claude-3-5-sonnet",
  "prompt": "Buat script video vertikal berdurasi 60 detik."
}
```

### Hanya memilih provider

Jika hanya `provider` dikirim, TH Agent menggunakan model aktif apabila model tersebut tersedia pada provider yang dipilih. Jika tidak, request ditolak dan client harus memilih model yang tersedia.

Provider dan model harus terdaftar di konfigurasi provider TH Agent, yang dikelola melalui Web UI atau file konfigurasi Pi:

```text
~/.pi/agent/models.json
```

Error yang mungkin diterima:

- `PROVIDER_UNAVAILABLE`: provider belum terhubung atau tidak terdaftar.
- `MODEL_UNAVAILABLE`: model tidak tersedia pada provider yang dipilih.

## Mode `generate`

Dipakai untuk menghasilkan teks biasa seperti artikel, caption, script, rewrite, deskripsi, atau metadata berbentuk teks.

```bash
curl -X POST "http://127.0.0.1:8317/api/ai" \
  -H "Authorization: Bearer $TH_ADMIN_AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "app": "th-blog",
    "task": "autopost",
    "mode": "generate",
    "profile": "blog-article",
    "language": "id",
    "prompt": "Buat artikel 700 kata tentang manfaat olahraga pagi untuk pekerja kantoran."
  }'
```

Contoh response:

```json
{
  "ok": true,
  "requestId": "uuid",
  "app": "th-blog",
  "task": "autopost",
  "mode": "generate",
  "model": "llama-3.1-8b-instant",
  "content": "Artikel hasil generasi AI...",
  "durationMs": 4200
}
```

## Mode `structured`

Dipakai ketika client membutuhkan output JSON yang dapat langsung diproses aplikasi.

```json
{
  "app": "th-blog",
  "task": "seo",
  "mode": "structured",
  "profile": "blog-seo",
  "language": "id",
  "prompt": "Buat metadata SEO dari artikel berikut.",
  "input": {
    "article": "Isi artikel yang akan dianalisis..."
  },
  "schema": {
    "title": "string",
    "description": "string",
    "keywords": ["string"]
  }
}
```

Contoh response:

```json
{
  "ok": true,
  "requestId": "uuid",
  "app": "th-blog",
  "task": "seo",
  "mode": "structured",
  "model": "llama-3.1-8b-instant",
  "content": "{\"title\":\"...\",\"description\":\"...\",\"keywords\":[\"...\"]}",
  "data": {
    "title": "Judul SEO",
    "description": "Deskripsi SEO",
    "keywords": ["olahraga", "kesehatan"]
  },
  "durationMs": 4200
}
```

Client sebaiknya membaca field `data` pada mode `structured`. Field `content` disediakan sebagai representasi JSON mentah.

## Format error

Semua error menggunakan format berikut:

```json
{
  "ok": false,
  "requestId": "uuid",
  "error": {
    "code": "MODEL_UNAVAILABLE",
    "message": "Model tidak tersedia pada provider yang dipilih"
  }
}
```

Kode error umum:

| HTTP | Code | Keterangan |
|---:|---|---|
| 400 | `INVALID_MODE` | Mode bukan `generate` atau `structured`. |
| 400 | `INVALID_INPUT` | `prompt` dan `input` sama-sama kosong atau format input tidak valid. |
| 400 | `INVALID_PROVIDER` | Format provider tidak valid. |
| 400 | `INVALID_MODEL` | Format model tidak valid. |
| 400 | `PROVIDER_UNAVAILABLE` | Provider tidak terhubung di TH Agent. |
| 400 | `MODEL_UNAVAILABLE` | Model tidak tersedia pada provider yang dipilih. |
| 401 | - | Bearer API key tidak ada atau salah. |
| 403 | `FORBIDDEN` | IP client tidak masuk allowlist, jika allowlist diaktifkan. |
| 413 | `BODY_TOO_LARGE` | Body request melebihi 128 KB. |
| 429 | - | Rate limit terlampaui. |
| 502 | `GENERATION_FAILED` | Model/provider gagal menyelesaikan request. |
| 503 | `INTEGRATION_NOT_CONFIGURED` | API key internal atau konfigurasi belum tersedia. |
| 504 | `TIMEOUT` | Generasi melebihi batas waktu. |

## Batasan keamanan

Mode `/api/ai` saat ini hanya menyediakan generation tanpa akses agent coding. Request dijalankan dengan pembatasan:

```text
--no-tools
--no-mcp
--no-session
--no-extensions
--no-skills
--no-prompt-templates
--no-context-files
```

Dengan demikian, aplikasi eksternal tidak otomatis mendapatkan akses terminal, filesystem, session Telegram, atau project workspace TH Agent.

Gunakan endpoint ini untuk pekerjaan seperti:

- artikel
- caption
- SEO
- script video
- rewrite
- klasifikasi sederhana
- output JSON terstruktur

Jangan mengirim secret provider, token, password, atau data sensitif yang tidak diperlukan ke dalam `prompt` atau `input`.

## Rekomendasi integrasi client

1. Simpan URL endpoint dan API key di environment client.
2. Gunakan `requestId` untuk logging dan tracing.
3. Tangani error `MODEL_UNAVAILABLE` dengan memilih model lain yang tersedia.
4. Jangan menganggap response berhasil hanya berdasarkan HTTP status; cek `ok === true`.
5. Untuk mode `structured`, validasi kembali `data` menggunakan schema aplikasi.
6. Terapkan retry terbatas hanya untuk error timeout atau kegagalan sementara.
7. Jangan retry otomatis untuk `INVALID_*`, `PROVIDER_UNAVAILABLE`, atau `MODEL_UNAVAILABLE` tanpa mengubah request.

Contoh environment pada aplikasi client:

```dotenv
TH_AGENT_AI_URL=http://127.0.0.1:8317/api/ai
TH_AGENT_AI_KEY=isi-secret-yang-sama-dengan-TH_ADMIN_AGENT_API_KEY
```

Contoh JavaScript:

```js
export async function generateWithThAgent(payload) {
  const response = await fetch(process.env.TH_AGENT_AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TH_AGENT_AI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.error?.message || `TH Agent AI request failed: ${response.status}`);
  }
  return result;
}
```

## Catatan versi

Endpoint ini menggunakan provider dan model yang terhubung di TH Agent. Daftar model dapat berubah ketika provider diubah, model disinkronkan, atau konfigurasi `~/.pi/agent/models.json` diperbarui.

Mode `agent` untuk coding, test, build, dan deploy tidak termasuk dalam kontrak `/api/ai` saat ini. Kemampuan tersebut harus dibuat sebagai jalur terpisah dengan policy project, sandbox, timeout, audit, dan verifikasi delivery yang lebih ketat.
