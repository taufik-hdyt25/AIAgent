# TH Admin → TH Agent Integration API

Dokumen ini untuk menghubungkan **TH Admin** ke **TH Agent** (server AI Agent) agar TH Admin bisa memakai model utama Agent untuk membuat deskripsi aplikasi dan dokumen legal.

Status: **aktif & teruji** (health check `200 OK` per 2026-11-22).

> API key **tidak** disimpan di repository publik ini. Ambil dari server Agent (lihat bagian "Mendapatkan API key" di bawah). Jangan pernah mengirim key ke browser/APK atau membagikannya ke publik.

---

## 1. Kredensial

| Item | Nilai |
|---|---|
| Base URL (publik) | `https://ai.thstudio.web.id` |
| Base URL (dari server yang sama) | `http://127.0.0.1:3030` |
| Auth header | `Authorization: Bearer <API_KEY>` |
| API key | `<API_KEY>` |
| Model utama aktif | `gpt-6-luna` |
| Provider | `a2-codex` |
| Engine | `pi` |

Domain `https://ai.thstudio.web.id` (HTTPS via nginx) diteruskan ke TH Agent di port 3030. Web UI di root dilindungi Basic Auth; endpoint integrasi memakai Bearer token.

Contoh header:

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
Accept: application/json
```

API key ini **hanya untuk server-to-server**. Simpan di secret/env server TH Admin, bukan di kode frontend.

---

## 2. Endpoint

### 2.1 Health check

```http
GET /api/ai-generate/health
Authorization: Bearer <API_KEY>
```

Response sukses:

```json
{ "ok": true, "data": { "status": "ok" } }
```

Response gagal:

```json
{ "ok": false, "error": { "code": "UNAUTHORIZED", "message": "Invalid or missing bearer token" } }
```

Health check tidak membocorkan konfigurasi maupun rahasia.

### 2.2 Generate

```http
POST /api/ai-generate
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

Body:

```json
{
  "task": "app_description | privacy_policy | terms_of_service",
  "model": "opsional-model-id",
  "input": {
    "language": "id",
    "app": {
      "name": "Nama aplikasi",
      "description": "Deskripsi singkat atau kosong",
      "fullDescription": "Deskripsi lengkap atau kosong",
      "platform": "Android"
    },
    "context": {
      "repositorySummary": "Ringkasan konteks repository yang sudah dibaca TH Admin",
      "developerDataPractices": "Keterangan praktik data dari pengembang"
    }
  }
}
```

Ketentuan field:

- `task` wajib, salah satu: `app_description`, `privacy_policy`, `terms_of_service`.
- `model` opsional. Jika diisi, **harus sama** dengan model utama aktif (`gpt-6-luna`). Meminta model lain akan ditolak `400 MODEL_UNAVAILABLE` (tidak ada silent fallback).
- `input` wajib berupa object.
- Parameter yang tidak dikenal diabaikan.
- Semua isi `input` diperlakukan sebagai **data tidak tepercaya**; instruksi yang tertanam di dalamnya tidak akan dieksekusi.

---

## 3. Response

### 3.1 Sukses — `app_description`

```json
{
  "ok": true,
  "data": {
    "shortDescription": "Aplikasi ...",
    "fullDescription": "Aplikasi ...\n\nFitur utama: ..."
  }
}
```

Batas: `shortDescription` maksimal 500 karakter, `fullDescription` maksimal 12.000 karakter.

### 3.2 Sukses — `privacy_policy` / `terms_of_service`

```json
{
  "ok": true,
  "data": {
    "content": "<h1>Kebijakan Privasi</h1><p>...</p>"
  }
}
```

`content` adalah HTML sederhana yang sudah disanitasi. Tag yang diizinkan: `h1`, `h2`, `h3`, `p`, `ul`, `ol`, `li`, `strong`, `em`, `br`. `script`, `style`, `iframe`, dan `form` akan dibuang.

### 3.3 Error

```json
{
  "ok": false,
  "error": {
    "code": "GENERATION_FAILED",
    "message": "The active model could not complete this request"
  }
}
```

| HTTP | Code | Arti |
|---|---|---|
| 400 | `INVALID_JSON` | Body bukan JSON valid |
| 400 | `INVALID_TASK` | `task` tidak didukung |
| 400 | `INVALID_INPUT` | `input` bukan object |
| 400 | `INVALID_MODEL` | `model` bukan string / terlalu panjang |
| 400 | `MODEL_UNAVAILABLE` | Model yang diminta bukan model utama aktif |
| 401 | `UNAUTHORIZED` | Bearer token salah / tidak ada |
| 403 | `FORBIDDEN` | IP client tidak diizinkan |
| 413 | `BODY_TOO_LARGE` | Body melebihi 128 KB |
| 429 | `RATE_LIMITED` | Lebih dari 10 request/menit dari IP yang sama |
| 500 | `REQUEST_FAILED` | Gagal memproses request |
| 502 | `GENERATION_FAILED` | Model gagal menyelesaikan generasi / output tidak valid |
| 503 | `INTEGRATION_NOT_CONFIGURED` | `TH_ADMIN_AGENT_API_KEY` belum di-set di Agent |
| 503 | `MODEL_UNAVAILABLE` | Model utama tidak dikonfigurasi / provider sedang down |
| 503 | `ENGINE_UNSUPPORTED` | Engine Agent aktif bukan `pi` |
| 504 | `TIMEOUT` | Generasi melebihi batas waktu |

---

## 4. Batas & konfigurasi

| Batas | Nilai |
|---|---|
| Ukuran body request | 128 KB |
| Timeout baca body | 15 detik |
| Rate limit | 10 request / menit / IP |
| Timeout generasi | 240 detik (default), bisa diatur 30–600 detik |
| Max output model | 48.000 karakter |

Konfigurasi di server Agent (`~/.th-agent/.env`):

```bash
TH_ADMIN_AGENT_API_KEY=<API_KEY>
TH_ADMIN_ALLOWED_IPS=          # opsional, pisahkan dengan koma. Kosong = semua IP diizinkan
TH_ADMIN_AGENT_TIMEOUT_MS=240000
```

Setelah mengubah `.env`, restart service:

```bash
systemctl --user restart th-agent
```

Endpoint TH Admin dikecualikan dari Basic Auth Web UI, jadi autentikasinya murni memakai Bearer token di atas.

---

## 5. Contoh integrasi

### curl

```bash
curl -X POST "https://ai.thstudio.web.id/api/ai-generate" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "app_description",
    "input": {
      "language": "id",
      "app": {
        "name": "TH Blog",
        "description": "Platform blog modern",
        "fullDescription": "",
        "platform": "Android"
      },
      "context": {
        "repositorySummary": "Aplikasi blog dengan editor, komentar, dan dashboard admin.",
        "developerDataPractices": "Email pengguna disimpan untuk login; tidak ada tracking pihak ketiga."
      }
    }
  }'
```

### Node.js / TypeScript (server-side)

```ts
const res = await fetch("https://ai.thstudio.web.id/api/ai-generate", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.TH_ADMIN_AGENT_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    task: "privacy_policy",
    input: {
      language: "id",
      app: { name: "TH Blog", platform: "Android" },
      context: {
        repositorySummary: "Aplikasi blog dengan login email.",
        developerDataPractices: "Email dan nama pengguna disimpan; tidak ada iklan.",
      },
    },
  }),
  signal: AbortSignal.timeout(300_000),
});

const json = await res.json();
if (!json.ok) throw new Error(`${json.error.code}: ${json.error.message}`);
console.log(json.data);
```

### PHP

```php
$ch = curl_init('https://ai.thstudio.web.id/api/ai-generate');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 300,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer <API_KEY>',
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode([
        'task' => 'app_description',
        'input' => [
            'language' => 'id',
            'app' => ['name' => 'TH Blog', 'platform' => 'Android'],
            'context' => [
                'repositorySummary' => 'Aplikasi blog dengan login email.',
                'developerDataPractices' => 'Email dan nama pengguna disimpan.',
            ],
        ],
    ]),
]);
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$json = json_decode($body, true);
```

---

## 6. Catatan operasional

- Log server mencatat `task`, `model`, `durationMs`, dan `status` beserta task ID. API key dan isi konten **tidak** dicatat.
- Untuk dokumen legal, hasil adalah **draft yang perlu direview**, bukan nasihat hukum. Detail yang tidak diberikan akan ditandai sebagai placeholder.
- Jangan mengirim `input` lebih dari 128 KB. Ringkas `repositorySummary` dan `developerDataPractices` sebelum dikirim.
- Jika TH Admin berjalan di server lain, pastikan port `3030` dapat diakses dari IP server TH Admin (firewall / security group). Disarankan juga mengisi `TH_ADMIN_ALLOWED_IPS` dengan IP server TH Admin.
- Jika provider `a2-codex` mati, endpoint health tetap `ok` (tidak membocorkan konfigurasi), tetapi `generate` akan mengembalikan `503 MODEL_UNAVAILABLE` / `502 GENERATION_FAILED`.

---

## 7. Ringkasan handoff

1. **Endpoint:** `POST https://ai.thstudio.web.id/api/ai-generate`
2. **Auth:** header `Authorization: Bearer <API_KEY>`
3. **Model:** `gpt-6-luna` (opsional dikirim eksplisit; model lain ditolak)
4. **Health:** `GET https://ai.thstudio.web.id/api/ai-generate/health`
