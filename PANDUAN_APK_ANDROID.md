# PANDUAN APLIKASI ANDROID E-TIKET IT RSUD LABUHA

Sistem E-Tiket IT RSUD Labuha dirancang untuk dapat dijalankan di Smartphone Android melalui 2 metode:

---

## METODE 1: INSTALASI INSTAN (PWA - PROGRESSIVE WEB APP)
> **Paling Direkomendasikan untuk Staf Ruangan / Poli & Teknisi RSUD**  
> *Keunggulan*: Tidak perlu compile Android Studio, hemat memori HP, langsung update otomatis dari server.

1. Buka browser **Google Chrome** di HP Android Anda.
2. Akses alamat server:
   - Jaringan Lokal RSUD: `http://<IP_KOMPUTER_SERVER>:3000` (Contoh: `http://192.168.1.100:3000`)
   - Domain Rumah Sakit: `http://etiket.rsudlabuha.id` (Jika sudah ada domain)
3. Ketuk ikon titik tiga (⋮) di pojok kanan atas browser Chrome.
4. Pilih **"Instal aplikasi"** atau **"Tambahkan ke Layar Utama"** (*Add to Home Screen*).
5. Ikon **ETIKET RSUD** akan muncul di menu aplikasi HP Android Anda layaknya aplikasi native, bisa dibuka tanpa address bar browser dan mendukung kamera untuk foto kendala!

---

## METODE 2: BUILD FILE NATIVE ANDROID (.APK) VIA CAPACITOR
Jika rumah sakit mewajibkan pembagian file mentah `.apk` untuk dipasang secara manual (sideload):

### Prasyarat:
1. Terpasang **Node.js** dan **Android Studio** di komputer pengembang.
2. Android SDK Command-line Tools terpasang di Android Studio.

### Langkah-langkah Pembuatan File .APK:
1. Di folder proyek utama `d:\project\IT\Etiket`, jalankan perintah:
   ```bash
   npm install @capacitor/core @capacitor/cli @capacitor/android
   ```
2. Buka file `android/capacitor.config.json`, sesuaikan `"url"` dengan IP server lokal RSUD Labuha atau domain publik RSUD:
   ```json
   "server": {
     "url": "http://192.168.1.100:3000",
     "cleartext": true
   }
   ```
3. Inisialisasi folder proyek native Android:
   ```bash
   npx cap add android
   npx cap sync
   ```
4. Buka proyek di Android Studio:
   ```bash
   npx cap open android
   ```
5. Di Android Studio:
   - Pilih menu **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)**.
   - File APK siap dipasang di semua smartphone Android staf & teknisi RSUD Labuha!

