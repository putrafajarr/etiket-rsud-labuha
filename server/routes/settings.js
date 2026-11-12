const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');
const WhatsAppService = require('../services/whatsapp');
const TelegramService = require('../services/telegram');
const EmailService = require('../services/email');

// GET all settings
router.get('/', async (req, res) => {
  try {
    const rows = await query.all('SELECT * FROM system_settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat pengaturan' });
  }
});

// POST save settings
router.post('/', async (req, res) => {
  try {
    const settings = req.body;
    for (const [key, value] of Object.entries(settings)) {
      await query.run(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `, [key, String(value)]);
    }

    // Automatically synchronize capacitor.config.json in root and android assets if app_server_url was updated!
    if (settings.app_server_url && settings.app_server_url.trim().length > 0) {
      try {
        let targetUrl = settings.app_server_url.trim();
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          targetUrl = `http://${targetUrl}`;
        }
        const targetPaths = [
          path.join(__dirname, '../../capacitor.config.json'),
          path.join(__dirname, '../../android/app/src/main/assets/capacitor.config.json')
        ];
        for (const configPath of targetPaths) {
          if (fs.existsSync(configPath)) {
            const configContent = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            configContent.server = configContent.server || {};
            configContent.server.url = targetUrl;
            configContent.server.cleartext = true;
            fs.writeFileSync(configPath, JSON.stringify(configContent, null, 2), 'utf8');
            console.log('[Settings] Synchronized with server URL:', configPath, targetUrl);
          }
        }
      } catch (syncErr) {
        console.error('Failed to sync capacitor.config.json:', syncErr);
      }
    }

    res.json({ message: 'Pengaturan berhasil disimpan' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan pengaturan: ' + err.message });
  }
});

// POST test send WhatsApp
router.post('/test-wa', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Nomor WhatsApp wajib diisi' });

    const testMsg = `*TEST NOTIFIKASI WHATSAPP - E-TIKET IT RSUD LABUHA*\n` +
      `Halo, ini adalah pesan uji coba integrasi WhatsApp Gateway Sistem E-Tiket IT RSUD Labuha.\n` +
      `Waktu Server: ${new Date().toLocaleString('id-ID')}\n` +
      `Status: TERHUBUNG & BERFUNGSI NORMAL.`;

    const result = await WhatsAppService.send(phone, testMsg);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST test send Telegram
router.post('/test-telegram', async (req, res) => {
  try {
    const { chatId } = req.body;
    const testMsg = `<b>🔔 UJI COBA BOT TELEGRAM - RSUD LABUHA</b>\n\n` +
      `Notifikasi ini adalah tes koneksi Bot Telegram E-Tiket IT RSUD Labuha.\n` +
      `Waktu: <code>${new Date().toLocaleString('id-ID')}</code>\n` +
      `Status: <b>BERHASIL TERHUBUNG</b>.`;

    const result = await TelegramService.send(testMsg, chatId || null);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST test send Email
router.post('/test-email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Alamat email wajib diisi' });

    const dummyTicket = {
      ticket_no: 'TKT-TEST-0001',
      room_name: 'Ruang Uji Coba Server IT',
      category_name: 'SIMRS & Jaringan',
      reporter_name: 'Administrator IT',
      priority: 'high',
      status: 'open',
      title: 'Uji Coba Pengiriman Notifikasi Email SMTP',
      description: 'Ini adalah pesan email pengujian sistem E-Tiket Helpdesk IT RSUD Labuha.'
    };

    const html = EmailService.generateTemplate(
      dummyTicket,
      'Uji Coba Pengiriman Email Notifikasi',
      'Jika Anda menerima email ini, berarti konfigurasi SMTP Server E-Tiket IT RSUD Labuha telah berhasil terhubung dengan benar.'
    );

    const result = await EmailService.send(email, '[RSUD LABUHA] Tes Koneksi Email E-Tiket IT', html);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET notification log history
router.get('/logs', async (req, res) => {
  try {
    const logs = await query.all('SELECT * FROM notifications_log ORDER BY created_at DESC LIMIT 100');
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat log notifikasi' });
  }
});

module.exports = router;

