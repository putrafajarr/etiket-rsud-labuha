# PANDUAN MEMINDAHKAN SERVER ETIKET KE PC LAIN

Panduan mudah untuk menjadikan komputer/PC lain di ruang IT sebagai Server Pusat E-Tiket RSUD Labuha.

---

### Langkah 1: Copy Folder Project ke Flashdisk
Dari laptop ini, copy seluruh folder project:
* Lokasi folder: `D:\project\IT\Etiket`
* Paste folder tersebut ke Flashdisk (USB Drive).
* Bawa Flashdisk ke PC yang ingin dijadikan server, lalu paste ke drive `D:\` atau `C:\` di PC tersebut (contoh: `D:\Etiket`).

> **PENTING**: File rahasia `.env` (berisi kunci koneksi database Supabase) sudah otomatis terbawa jika Anda meng-copy foldernya langsung lewat Flashdisk.

---

### Langkah 2: Install Node.js di PC Tersebut (Hanya Sekali)
Di PC yang baru:
1. Buka browser dan buka: **https://nodejs.org**
2. Unduh versi **LTS (Recommended For Most Users)**.
3. Install file yang diunduh (klik *Next* sampai selesai).

---

### Langkah 3: Jalankan Server (Selesai!)
Buka folder `Etiket` di PC tersebut:
1. **Untuk langsung menyalakan server**:
   * Klik dua kali file **`START_SERVER_ETIKET.bat`**.
   * Server lokal dan Cloudflare Tunnel akan langsung menyala!
   * Di layar akan langsung tertulis alamat IP server PC tersebut (contoh: `http://192.168.0.xxx:3000`).

2. **Agar server otomatis hidup setiap kali PC dinyalakan**:
   * Klik dua kali file **`PASANG_AUTO_START_DI_PC_INI.bat`**.
   * Selesai! Setiap kali PC dinyalakan atau restart sehabis mati lampu, server e-tiket akan otomatis langsung berjalan sendiri di latar belakang tanpa perlu dibuka manual.

---

### Langkah 4: Hubungkan APK Android & QR Code
1. Buka APK di HP Anda.
2. Masuk ke **Pengaturan** -> klik **Ganti IP Server di APK**.
3. Masukkan alamat IP yang muncul di PC tersebut (contoh: `http://192.168.0.xxx:3000`).
4. Klik **Simpan**. Sekarang APK dan seluruh ruangan terhubung ke PC server baru!

