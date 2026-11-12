# SISTEM INFORMASI E-TIKET IT & SIMRS RSUD LABUHA
**Kabupaten Halmahera Selatan, Maluku Utara**

Sistem E-Tiket Helpdesk IT terintegrasi penuh untuk Rumah Sakit Umum Daerah (RSUD) Labuha. Memfasilitasi pelaporan kendala jaringan, SIMRS Khanza/HIS, hardware, printer, dan alat medis terhubung PC dengan notifikasi otomatis multi-channel (**WhatsApp**, **Telegram**, **Email**, dan **Audio Alarm**), serta laporan rekapitulasi (**Excel & Cetak PDF Kop Surat Resmi**).

---

## 🌟 FITUR UTAMA & 3 JALUR AKSES

### 1. Jalur 1: Web Responsif & Cetak Stiker QR Code Ruangan
- **Tanpa Perlu Download**: Pegawai/perawat/dokter cukup scan stiker QR Code yang tertempel di meja kerja ruangan/poli menggunakan kamera HP mereka atau membuka URL via browser komputer ruangan.
- Ruangan otomatis terkunci dan terisi saat diakses via QR.
- Unggah foto layar error, kabel rusak, atau printer macet langsung dari kamera HP.
- Lacak status perbaikan secara publik hanya dengan memasukkan Nomor Tiket atau No. HP.

### 2. Jalur 2: Aplikasi Android (.APK / PWA Native Experience)
- **Installable PWA**: Bisa langsung diinstal di smartphone Android tanpa harus compile Android Studio melalui menu *"Tambahkan ke Layar Utama / Instal Aplikasi"*.
- **Android APK Build**: Disediakan template konfigurasi Capacitor untuk build file mentah `.apk` siap pasang via Android Studio.
- **Portal Khusus Teknisi Lapangan**: Memudahkan teknisi IT saat berkeliling bangsal/rawat inap untuk melihat tiket tugas, update status perbaikan, dan foto bukti selesai.

### 3. Jalur 3: Integrasi Bot Chat (WhatsApp & Telegram Webhook)
- **Bot WhatsApp**: Menerima pesan format `LAPOR#RUANGAN#KENDALA` atau cek status `STATUS <NO_TIKET>`.
- **Bot Telegram**: Menerima perintah `/lapor <ruangan> <kendala>` dan `/status <no_tiket>` langsung dari grup IT RSUD.

---

## 🔔 NOTIFIKASI MULTI-CHANNEL TERPADU

| Channel | Fungsi Notifikasi |
|---|---|
| **WhatsApp Gateway** | Konfirmasi tiket ke pelapor, notifikasi penugasan ke teknisi, link rating kepuasan saat selesai |
| **Telegram Bot API** | Peringatan instan ke Grup IT RSUD Labuha dengan badge prioritas (Kritis/Tinggi/Sedang) |
| **Email SMTP** | Pengiriman surat elektronik formal dengan template resmi RSUD Labuha |
| **Realtime Web Alert** | Bunyi sirine alarm otomatis di layar Helpdesk IT setiap ada tiket darurat/kritis masuk |

---

## 📊 LAPORAN & ANALITIK
1. **Ekspor Excel (.xlsx)**:
   - Sheet 1: Rekapitulasi seluruh tiket lengkap dengan nomor, tanggal, ruangan, kategori, teknisi, solusi, dan rating.
   - Sheet 2: Kinerja teknisi (jumlah penugasan, penyelesaian, % selesai, rata-rata rating kepuasan).
2. **Cetak Laporan Resmi (PDF)**:
   - Dilengkapi **Kop Surat Resmi Pemerintah Kabupaten Halmahera Selatan - RSUD Labuha**.
   - Lembar tanda tangan resmi Kepala Instalasi SIMRS & IT dan Direktur RSUD Labuha.
   - Indikator kepatuhan SLA (*Service Level Agreement*).

---

## 🚀 CARA MENJALANKAN SISTEM

### 1. Instalasi Dependensi
Jalankan di terminal:
```bash
npm install
```

### 2. Menjalankan Server
```bash
npm start
```
Atau mode pengembangan dengan hot-reload:
```bash
npm run dev
```

Server akan aktif di: **`http://localhost:3000`**

---

## 🧭 PANDUAN HALAMAN UTAMA

- **Dashboard Admin / IT Helpdesk**:  
  `http://localhost:3000/`  
  *(Kanban board tiket, penugasan teknisi, analitik, pengaturan gateway, dan audit log)*
- **Portal Lapor Cepat (Stiker QR)**:  
  `http://localhost:3000/lapor.html`  
  *(Formulir pelaporan simpel untuk perawat, dokter, dan staf ruangan)*
- **Pelacakan Status Tiket & Rating**:  
  `http://localhost:3000/track.html`  
  *(Pencarian status pengerjaan tiket dan input rating bintang 1-5)*
- **Cetak Stiker QR Seluruh Ruangan (Siap Print A4)**:  
  `http://localhost:3000/qrcodes.html`  
  *(Grid stiker QR code semua poli dan instalasi RSUD Labuha)*

---

## 👥 AKUN PENGGUNA DEFAULT (SEEDED)

| Username | Password | Role | Keterangan |
|---|---|---|---|
| `superadmin` | `admin123` | Super Admin | Akses seluruh sistem |
| `helpdesk` | `admin123` | Helpdesk | Dispatcher tiket |
| `teknisi1` | `teknisi123` | Teknisi IT | Ahmad Fauzi (Hardware & LAN) |
| `teknisi2` | `teknisi123` | Teknisi IT | Budi Santoso (SIMRS & DB) |
| `teknisi3` | `teknisi123` | Teknisi IT | Reza Pratama (Medis & Printer) |

---

## 📂 STRUKTUR FOLDER
```
d:\project\IT\Etiket/
├── server/
│   ├── server.js              # Entry point Express + Socket.io
│   ├── config/db.js           # Database SQLite & Auto-Seed RSUD Labuha
│   ├── services/
│   │   ├── notification.js    # Multi-channel notification engine
│   │   ├── whatsapp.js        # WhatsApp Gateway integration
│   │   ├── telegram.js        # Telegram Bot API integration
│   │   ├── email.js           # SMTP Nodemailer RSUD templates
│   │   ├── reportGenerator.js # Excel (.xlsx) & Official PDF Generator
│   │   └── qrcodeService.js   # Room & Ticket QR Code generator
│   └── routes/                # RESTful API routes
├── public/
│   ├── index.html             # Admin & Technician Main Dashboard
│   ├── lapor.html             # Quick Room Report Page (QR Code Ready)
│   ├── track.html             # Public Ticket Tracker & Rating
│   ├── qrcodes.html           # Room QR Code Stickers Sheet
│   ├── manifest.json          # PWA Android Manifest
│   ├── sw.js                  # PWA Service Worker
│   ├── css/custom.css         # Styling & print styles
│   └── js/                    # Client controllers & Web Audio Alarm
└── android/
    ├── README.md              # Panduan build APK via Android Studio
    └── capacitor.config.json  # Konfigurasi Capacitor Android
```

&copy; 2026 Tim SIMRS & IT RSUD Labuha, Halmahera Selatan.

