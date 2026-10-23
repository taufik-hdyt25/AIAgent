# 📁 Direktori Kerja Intiva (Projects Sandbox)

Folder ini adalah ruang lingkup kerja (*workspace sandbox*) khusus proyek **Intiva** pada Raspberry Pi.

---

## 🔒 Aturan Eksekusi Raspberry Pi
1. **Scope Restriction:** Seluruh proyek coding pada Raspberry Pi **wajib** ditempatkan dan dieksekusi di dalam folder `projects/intiva/` ini (misal: `projects/intiva/<nama-proyek>`).
2. **Boundary Safety:** TH Agent dilarang mengeksekusi proyek di luar folder ini saat mode Pi / Intiva aktif untuk menjaga keamanan sistem host dan isolasi resource.
3. **Penyimpanan:** Setiap sub-proyek di dalam folder ini memiliki git repository, docker-compose, atau arsitektur mandiri.
