# Rencana Produk: Otomasi Konten Video hingga Publikasi

## Tujuan
Membangun aplikasi yang menerima topik konten melalui Telegram, menghasilkan paket video pendek berbantuan AI, menyediakan tinjauan/approval, menerbitkan ke akun media sosial yang terhubung, serta menyimpan riwayat dan status setiap pekerjaan di web.

## Asumsi dan batas MVP
- Bentuk konten awal: video vertikal pendek (9:16), satu bahasa yang dapat dipilih, dengan caption.
- Telegram adalah kanal input dan notifikasi; dashboard web adalah pusat kontrol dan riwayat.
- MVP tidak melakukan publikasi otomatis tanpa persetujuan manusia. Pengguna dapat mengaktifkan auto-publish per platform setelah koneksi dan aturan konten diverifikasi.
- Mulai dengan satu integrasi sosial yang API resminya mendukung publikasi video untuk akun yang sesuai; platform berikutnya ditambahkan sebagai adapter. Tidak mengandalkan scraping atau otomasi browser untuk melewati pembatasan platform.
- Integrasi provider AI/media bersifat adapter. Kunci API disimpan server-side dan tidak ditulis ke log atau riwayat.

## Alur pengguna
1. Pengguna mengirim topik ke bot Telegram, misalnya `/create 5 fakta unik tentang ...`.
2. Bot membuat pekerjaan dan mengembalikan ID serta tautan ke dashboard.
3. Pipeline membuat brief, naskah, caption/hashtag, storyboard, voice-over, aset visual, dan video final.
4. Sistem menjalankan pemeriksaan durasi, rasio, audio, kelengkapan aset, dan kebijakan dasar; kegagalan masuk status perlu revisi.
5. Pengguna melihat preview dan metadata di dashboard, lalu menyetujui, meminta regenerasi bagian tertentu, atau membatalkan.
6. Scheduler menerbitkan pekerjaan yang disetujui (atau auto-publish yang diaktifkan), menyimpan ID dan URL posting, lalu mengirim notifikasi Telegram.
7. Dashboard menyediakan filter, pencarian, preview, status, jadwal, log proses yang aman, dan aksi retry/cancel.

## Status pekerjaan
`queued → scripting → generating_assets → rendering → quality_check → awaiting_approval → scheduled → publishing → published`
Status terminal/pengecualian: `failed`, `cancelled`, `rejected`. Setiap transisi menyimpan waktu dan ringkasan error yang sudah disanitasi.

## Komponen arsitektur
- **Web app/API:** dashboard, autentikasi, pengelolaan proyek/brand, koneksi platform, approval, dan API pekerjaan.
- **Telegram bot:** menerima perintah/topik, mengirim preview/status, dan menyediakan callback untuk approve/reject.
- **Database relasional:** pengguna, integrasi terenkripsi, pekerjaan, aset, transisi status, jadwal, dan hasil publikasi.
- **Object storage:** naskah/metadata terstruktur serta file audio/video; file besar tidak disimpan sebagai blob di database.
- **Queue + worker:** pekerjaan asinkron, batas konkurensi, retry bertahap, timeout, idempotency, serta pemisahan tahap generate/render/publish.
- **Pipeline AI melalui provider interface:** LLM untuk brief/script, layanan voice dan visual/video melalui adapter, FFmpeg untuk render deterministik.
- **Social publisher adapters:** OAuth resmi, token terenkripsi, pemeriksaan izin, refresh token, rate-limit handling, dan rekonsiliasi status.

## Fase implementasi
### Fase 0 — Fondasi dan validasi integrasi
- Pilih platform pertama dan verifikasi persyaratan akun, izin aplikasi, format media, serta jalur review/API publishing resmi.
- Tetapkan provider generasi naskah, suara, visual/video, biaya per video, dan batas resource.
- Buat model data, state machine, threat model singkat, serta kontrak adapter.

### Fase 1 — Vertical slice tanpa publish
- Bot Telegram `/create`, `/status`, `/cancel`.
- API/dashboard untuk membuat dan melihat pekerjaan.
- Queue/worker persisten dengan status, retry terbatas, dan timeout.
- Generate brief/naskah/caption, unggah aset uji, render video 9:16, simpan hasil.
- Halaman riwayat dan preview; approval/reject/regenerate.

### Fase 2 — Kualitas dan operasional
- Template brand, suara, bahasa, durasi, dan jadwal.
- Pemeriksaan kualitas otomatis, observability, audit log, batas biaya, rate limit, serta pembersihan aset usang.
- Idempotency untuk mencegah render atau posting duplikat.

### Fase 3 — Publikasi terkontrol
- Implementasi satu adapter platform berdasarkan API resmi yang terverifikasi.
- OAuth/connect-disconnect, status izin, publikasi terjadwal, polling/reconciliation, dan penanganan token kadaluarsa.
- Approval wajib sebagai default; auto-publish opt-in dengan batas akun dan jadwal.

### Fase 4 — Perluasan
- Adapter platform tambahan setelah API/izin masing-masing tervalidasi.
- Analitik performa, eksperimen variasi konten, kalender editorial, dan workflow multi-brand.

## Entitas data minimum
- `users`, `social_accounts` (token terenkripsi), `content_jobs`, `job_events`, `assets`, `approval_actions`, `publish_attempts`, `brand_profiles`.
- Setiap pekerjaan menyimpan input/topik, konfigurasi, versi prompt/provider, output metadata, referensi aset, status, jadwal, serta ID/URL posting.

## Persyaratan keamanan dan reliabilitas
- OAuth/token dan API key hanya server-side, dienkripsi saat tersimpan, tidak pernah dimasukkan ke Telegram/log.
- Validasi webhook Telegram, autentikasi dashboard, CSRF/session protection, pembatasan ukuran upload, dan isolasi aset per pengguna.
- Webhook/status callback diverifikasi; endpoint publish idempotent dan memiliki audit trail.
- Batas waktu/ukuran/concurrency untuk proses media; worker dapat dilanjutkan setelah restart.
- Retensi dan penghapusan konten/kredensial dapat dikonfigurasi.

## Kriteria penerimaan MVP
- Topik Telegram menghasilkan satu job yang dapat ditelusuri dengan ID.
- Job tetap tercatat dan status pulih setelah restart worker.
- Pengguna dapat melihat video/metadata di web, approve/reject, dan meminta retry yang tidak menggandakan job.
- Kegagalan provider ditampilkan sebagai error yang aman dan dapat ditindaklanjuti.
- Publikasi hanya aktif setelah integrasi resmi, izin akun, dan tes pada akun yang sesuai; semua percobaan tercatat dan tidak duplikatif.
- Auto-publish nonaktif secara default.

## Risiko / keputusan yang harus dipastikan pada Fase 0
- API publishing dan izin berbeda per platform dan jenis akun; akses produksi tidak boleh diasumsikan tersedia.
- Generasi video/voice dapat mahal dan memerlukan waktu/resource signifikan; tetapkan budget per job dan kuota.
- Hak cipta, kemiripan suara/wajah, musik, disclosure konten sintetis, dan kebijakan platform perlu dipertimbangkan dalam desain serta template.
- Kualitas generasi tidak deterministik; approval manusia menjadi kontrol utama MVP.

## Belum dilakukan
Dokumen ini adalah rencana eksekusi, bukan aplikasi yang sudah dibangun. Belum ada pemilihan provider/platform final, implementasi kode, deployment, maupun klaim integrasi live.
