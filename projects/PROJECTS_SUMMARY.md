# Projects Summary & Architecture Registry

> ⚡ _Dokumen ini otomatis diperbarui oleh TH Agent Project Indexer._
> Berfungsi sebagai peta arsitektur instan agar AI tidak perlu membaca proyek dari nol.

---

## 1. THQuiz (TH Quiz Android App)

- **Direktori:** `projects/THQuiz`
- **Stack:** Android Native (SDK 36, Min SDK 26), Kotlin, Jetpack Compose, Material 3, Dagger Hilt, Coroutines, KSP, Kotlinx Serialization
- **Application ID:** `com.thstudio.thquiz` (Versi 1.3 / VersionCode 4)
- **Git:** Branch `main` (https://github.com/taufik-hdyt25/thquiz-android-app.git)
- **File Utama:** `app/src/main/java/com/thstudio/thquiz/MainActivity.kt`, `app/src/main/AndroidManifest.xml`, `app/build.gradle.kts`
- **Fitur Utama:** Quiz interaktif, Leaderboard, Daily Quiz, Level Progression, Reward Withdrawal, Multi-kategori pertanyaan
- **Perintah Penting:** `./gradlew assembleDebug`, `./gradlew assembleRelease`, `./gradlew build`

---

## 2. ai-podcast-live

- **Direktori:** `projects/ai-podcast-live`
- **Stack:** Next.js 16 (App Router), React, TypeScript, Tailwind CSS, Three.js, TikTok Live Connector
- **Docker Containers:** `ai-podcast-live` (Port: `3005:3000`)
- **Git:** Branch `main` (git@github.com:taufik-hdyt25/ai-podcast-live.git)
- **File Utama:** `src/app/page.tsx`, `src/app/studio/page.tsx`, `src/app/tiktok/page.tsx`
- **Perintah Penting:** `npm run dev`, `npm run build`, `./deploy-to-vps.sh`

---

## 3. ai-host-tiktok

- **Direktori:** `projects/ai-host-tiktok`
- **Stack:** Next.js (App Router), React, TypeScript, Tailwind CSS
- **Git:** Branch `main` (https://github.com/taufik-hdyt25/ai-host-tiktok.git)
- **File Utama:** `src/app/page.tsx`, `src/app/layout.tsx`
- **Perintah Penting:** `npm run dev`, `npm run build`

---

## 4. th-blog

- **Direktori:** `projects/th-blog`
- **Stack:** Next.js 16 (App Router), React, TypeScript, Tailwind CSS, Prisma ORM
- **Docker Containers:** `th-blogs-app`, `th-blogs-db` (Port: `3000:3000`, `5433:5432`)
- **Git:** Branch `th-blog` (https://github.com/taufik-hdyt25/th-blog.git)
- **Perintah Penting:** `npm run dev`, `npm run build`, `npm run start`

---

## 5. wa-chat-bot

- **Direktori:** `projects/wa-chat-bot`
- **Stack:** Node.js / Baileys WA Bot & Web Dashboard
- **Docker Containers:** `wa-bot`, `wa-dashboard` (Port: `3001:3001`, `3333:3000`)
- **Git:** Branch `main` (https://github.com/taufik-hdyt25/wa-chat-bot.git)

---

<<<<<<< HEAD
_Terakhir diperbarui: 2026-10-23T11:22:07.632Z_
=======
_Terakhir diperbarui: 2026-10-23T15:55:00.000Z_

> > > > > > > 611e111 (docs: register THQuiz and ai-host-tiktok in projects summary)
