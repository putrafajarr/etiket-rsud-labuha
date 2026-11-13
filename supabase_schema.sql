-- SCHEMA DATABASE SIM-ETIKET RSUD LABUHA UNTUK SUPABASE (POSTGRESQL)

-- 1. Tabel Pengaturan Sistem
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  description TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabel Master Ruangan RSUD
CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  building VARCHAR(100),
  floor VARCHAR(50),
  pic_name VARCHAR(150),
  pic_phone VARCHAR(50),
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabel Kategori Kendala IT
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  icon VARCHAR(50) DEFAULT 'wrench',
  default_priority VARCHAR(20) DEFAULT 'medium',
  sla_response_minutes INTEGER DEFAULT 30,
  sla_resolve_hours INTEGER DEFAULT 4,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabel Petugas & User IT
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name VARCHAR(150) NOT NULL,
  role VARCHAR(50) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(150),
  room_id INTEGER REFERENCES rooms(id),
  specialization VARCHAR(150),
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Tabel Tiket Laporan Kerusakan
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  ticket_no VARCHAR(50) UNIQUE NOT NULL,
  room_id INTEGER REFERENCES rooms(id),
  room_name VARCHAR(255) NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  category_name VARCHAR(150) NOT NULL,
  reporter_name VARCHAR(150) NOT NULL,
  reporter_phone VARCHAR(50) NOT NULL,
  reporter_email VARCHAR(150),
  reporter_role VARCHAR(100) DEFAULT 'Staff Ruangan',
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  photo_url TEXT,
  priority VARCHAR(20) DEFAULT 'medium',
  channel VARCHAR(50) DEFAULT 'web_qr',
  status VARCHAR(30) DEFAULT 'open',
  assigned_to INTEGER REFERENCES users(id),
  assigned_to_name VARCHAR(150),
  assigned_at TIMESTAMP WITH TIME ZONE,
  target_response_time TIMESTAMP WITH TIME ZONE,
  actual_response_time TIMESTAMP WITH TIME ZONE,
  target_resolve_time TIMESTAMP WITH TIME ZONE,
  actual_resolve_time TIMESTAMP WITH TIME ZONE,
  sla_status VARCHAR(30) DEFAULT 'on_track',
  pending_reason TEXT,
  resolution_notes TEXT,
  proof_photo_url TEXT,
  satisfaction_rating INTEGER,
  satisfaction_feedback TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP WITH TIME ZONE,
  closed_at TIMESTAMP WITH TIME ZONE
);

-- 6. Tabel Log Penanganan Tiket
CREATE TABLE IF NOT EXISTS ticket_logs (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER,
  user_name VARCHAR(150) NOT NULL,
  action VARCHAR(100) NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Tabel Log Notifikasi Gateway (WA, Telegram, Email)
CREATE TABLE IF NOT EXISTS notifications_log (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER,
  channel VARCHAR(50) NOT NULL,
  recipient VARCHAR(150) NOT NULL,
  title VARCHAR(255),
  message TEXT NOT NULL,
  status VARCHAR(50) NOT NULL,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- SEED DATA DEFAULT RSUD LABUHA
-- 1. Pengaturan Default
INSERT INTO system_settings (key, value, description) VALUES
('rsud_name', 'RSUD LABUHA', 'Nama Resmi Rumah Sakit'),
('rsud_subtext', 'Kabupaten Halmahera Selatan - Maluku Utara', 'Wilayah Instansi'),
('rsud_address', 'Jl. Trans Halmahera, Labuha, Kab. Halmahera Selatan, Maluku Utara', 'Alamat Lengkap RSUD'),
('rsud_phone', '(0927) 21118', 'Nomor Telepon RSUD'),
('rsud_email', 'it.rsudlabuha@gmail.com', 'Email Resmi IT RSUD'),
('wa_gateway_enabled', '1', 'Aktifkan Pengiriman WhatsApp (1/0)'),
('wa_gateway_provider', 'fonnte', 'Provider: fonnte, wablas, whacenter, generic'),
('wa_api_token', 'SAMPLE_FONNTE_TOKEN_RSUD', 'API Token WhatsApp Gateway'),
('wa_api_url', 'https://api.fonnte.com/send', 'URL Endpoint Kirim WhatsApp'),
('telegram_enabled', '1', 'Aktifkan Notifikasi Telegram (1/0)'),
('telegram_bot_token', '123456789:SAMPLE_BOT_TOKEN_RSUD_LABUHA', 'Token Bot Telegram dari @BotFather'),
('telegram_chat_id', '-100123456789', 'Chat ID Grup Tim IT RSUD Labuha'),
('email_enabled', '1', 'Aktifkan Pengiriman Email (1/0)'),
('smtp_host', 'smtp.gmail.com', 'Host SMTP'),
('smtp_port', '587', 'Port SMTP (587 TLS / 465 SSL)'),
('smtp_user', 'simrs.rsudlabuha@gmail.com', 'User Email Pengirim'),
('smtp_pass', 'app_password_here', 'Password / App Password Email'),
('smtp_from_name', 'Helpdesk IT RSUD Labuha', 'Nama Pengirim Email'),
('sla_critical_hours', '1', 'SLA Penyelesaian Darurat (Jam)'),
('sla_high_hours', '3', 'SLA Penyelesaian Prioritas Tinggi (Jam)'),
('sla_medium_hours', '8', 'SLA Penyelesaian Prioritas Sedang (Jam)'),
('sla_low_hours', '24', 'SLA Penyelesaian Prioritas Rendah (Jam)'),
('auto_assign_enabled', '0', 'Auto-assign tiket ke teknisi idle (1/0)')
ON CONFLICT (key) DO NOTHING;

-- 2. Master Ruangan Default
INSERT INTO rooms (name, code, building, floor, pic_name, pic_phone) VALUES
('Instalasi Gawat Darurat (IGD)', 'IGD-01', 'Gedung Utama', 'Lantai 1', 'dr. Tri - Kepala IGD', '081234567801'),
('Poli Umum / Penyakit Dalam', 'POLI-01', 'Gedung Rawat Jalan', 'Lantai 1', 'Ns. Fatimah', '081234567802'),
('Poli Gigi & Mulut', 'POLI-02', 'Gedung Rawat Jalan', 'Lantai 1', 'drg. Arman', '081234567803'),
('Poli Anak', 'POLI-03', 'Gedung Rawat Jalan', 'Lantai 1', 'Ns. Rahma', '081234567804'),
('Poli Bedah', 'POLI-04', 'Gedung Rawat Jalan', 'Lantai 1', 'dr. Hendra, Sp.B', '081234567805'),
('Poli Kebidanan & Kandungan (Obgyn)', 'POLI-05', 'Gedung Rawat Jalan', 'Lantai 1', 'Bdn. Halimah', '081234567806'),
('Poli Mata & Saraf', 'POLI-06', 'Gedung Rawat Jalan', 'Lantai 1', 'Ns. Rudi', '081234567807'),
('Rawat Inap Melati (Kelas 1 & 2)', 'RANAP-01', 'Gedung Rawat Inap', 'Lantai 1', 'Ns. Dewi - Karu Melati', '081234567808'),
('Rawat Inap Mawar (Kelas 3)', 'RANAP-02', 'Gedung Rawat Inap', 'Lantai 2', 'Ns. Wahyu - Karu Mawar', '081234567809'),
('Rawat Inap Teratai (VIP & VVIP)', 'RANAP-03', 'Gedung VIP', 'Lantai 1', 'Ns. Sri - Karu Teratai', '081234567810'),
('ICU / ICCU & Perinatologi', 'ICU-01', 'Gedung Rawat Khusus', 'Lantai 1', 'dr. Faisal, Sp.An', '081234567811'),
('Kamar Operasi (OK / Bedah Sentral)', 'OK-01', 'Gedung Bedah', 'Lantai 2', 'Ns. Hasan - Karu OK', '081234567812'),
('Laboratorium Patologi Klinik', 'LAB-01', 'Gedung Penunjang', 'Lantai 1', 'dr. Linda, Sp.PK', '081234567813'),
('Instalasi Radiologi & USG', 'RAD-01', 'Gedung Penunjang', 'Lantai 1', 'Sdr. Ilham, AMR', '081234567814'),
('Farmasi / Apotek Rawat Jalan', 'FAR-01', 'Gedung Rawat Jalan', 'Lantai 1', 'apt. Nurdin, S.Farm', '081234567815'),
('Farmasi / Depo Apotek IGD & Rawat Inap', 'FAR-02', 'Gedung Utama', 'Lantai 1', 'apt. Siska, S.Farm', '081234567816'),
('Rekam Medis (Admisi & Filing)', 'RM-01', 'Gedung Utama', 'Lantai 1', 'Ibu Nurul, A.Md.RMIK', '081234567817'),
('Kasir & Billing Pasien', 'KASIR-01', 'Gedung Utama', 'Lantai 1', 'Sdr. Rizal', '081234567818'),
('Loket Pendaftaran Pasien (Admisi)', 'ADM-01', 'Gedung Utama', 'Lantai 1', 'Sdr. Andi', '081234567819'),
('Instalasi Gizi & Dapur', 'GIZI-01', 'Gedung Penunjang', 'Lantai 1', 'Ibu Mariam, S.Gz', '081234567820'),
('Bagian Keuangan & Perencanaan', 'KEU-01', 'Gedung Administrasi', 'Lantai 2', 'Pak Sukardi, SE', '081234567821'),
('Tata Usaha, HRD & Kepegawaian', 'TU-01', 'Gedung Administrasi', 'Lantai 2', 'Ibu Hasna, S.Sos', '081234567822'),
('Ruang SIMRS & Helpdesk IT', 'IT-01', 'Gedung Administrasi', 'Lantai 2', 'Tim IT RSUD Labuha', '081234567899'),
('Ruang Direktur & Manajemen', 'DIR-01', 'Gedung Manajemen', 'Lantai 2', 'Sekretariat Direksi', '081234567800')
ON CONFLICT (code) DO NOTHING;

-- 3. Master Kategori Default
INSERT INTO categories (name, code, description, icon, default_priority, sla_response_minutes, sla_resolve_hours) VALUES
('SIMRS & Aplikasi Khanza / HIS', 'SIMRS', 'Masalah login, billing kasir error, resep elektronik tidak muncul, bridging BPJS VClaim', 'database', 'high', 15, 2),
('Jaringan, LAN & WiFi', 'NETWORK', 'Internet putus, WiFi RTO, kabel LAN rusak, switch hub mati di ruangan', 'wifi', 'high', 20, 3),
('Komputer, PC & Laptop', 'HARDWARE', 'Komputer mati total, layar biru (BSOD), lambat, terserang virus / ransomware', 'monitor', 'medium', 30, 4),
('Printer, Scanner & Barcode SEP', 'PRINTER', 'Printer macet (paper jam), hasil cetak bergaris, tinta habis, scanner rekam medis mati', 'printer', 'medium', 30, 4),
('Alat Medis Terhubung PC / SIMRS', 'MED-DEV', 'Komputer Lab Sysmex, Radiologi PACS / CR, USG video capture, EKG digital', 'heart-pulse', 'critical', 10, 1),
('CCTV & Telepon PABX / Intercom', 'CCTV', 'Kamera CCTV blank, panggilan telepon antar poli/ruangan mati', 'video', 'low', 60, 8),
('Email, Akun & Keamanan Data', 'SECURITY', 'Reset password user SIMRS, permohonan hak akses staf baru', 'lock', 'low', 30, 4)
ON CONFLICT (code) DO NOTHING;

-- 4. Akun Petugas IT Resmi (Password default: superadmin & purafajar = admin123, teknisi = teknisi123)
INSERT INTO users (username, password_hash, name, role, phone, email, room_id, specialization) VALUES
('superadmin', '$2a$10$954t8u7o1c8b74PZJ0wR6eh4wR2bSfZcTj3mP5eO6iB9x3K7K9nOe', 'Super Administrator IT RSUD', 'superadmin', '081234567890', 'superadmin@rsudlabuha.id', 23, 'Super Administrator'),
('purafajar', '$2a$10$954t8u7o1c8b74PZJ0wR6eh4wR2bSfZcTj3mP5eO6iB9x3K7K9nOe', 'Pura Fajar Widianto', 'kepala_it', '081234567891', 'purafajar@rsudlabuha.id', 23, 'Koordinator SIMRS & IT'),
('irsad', '$2a$10$a1w8FzK0Z6s7p8q9r0s1tu2v3w4x5y6z7A8B9C0D1E2F3G4H5I6Je', 'Irsad Suryadi', 'teknisi', '081234567892', 'irsad@rsudlabuha.id', 23, 'Teknisi Jaringan & Hardware'),
('yuliana', '$2a$10$a1w8FzK0Z6s7p8q9r0s1tu2v3w4x5y6z7A8B9C0D1E2F3G4H5I6Je', 'Yuliana ode la sida', 'helpdesk', '081234567893', 'yuliana@rsudlabuha.id', 23, 'Helpdesk IT & Dispatcher'),
('faisal', '$2a$10$a1w8FzK0Z6s7p8q9r0s1tu2v3w4x5y6z7A8B9C0D1E2F3G4H5I6Je', 'Faisal F Taran', 'teknisi', '081234567894', 'faisal@rsudlabuha.id', 23, 'Teknisi SIMRS & Alat Medis')
ON CONFLICT (username) DO NOTHING;
