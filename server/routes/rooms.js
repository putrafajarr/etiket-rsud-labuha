const express = require('express');
const router = express.Router();
const os = require('os');
const { query } = require('../config/db');
const QRCodeService = require('../services/qrcodeService');

// Helper to determine reachable LAN IP or custom host for mobile QR scans
async function getReachableBaseUrl(req) {
  if (req.query.customHost && req.query.customHost.trim().length > 0) {
    let custom = req.query.customHost.trim();
    if (!custom.startsWith('http://') && !custom.startsWith('https://')) {
      custom = `${req.protocol}://${custom}`;
    }
    return custom;
  }

  // Check if custom server / domain was set via dashboard menu
  try {
    const setting = await query.get("SELECT value FROM system_settings WHERE key = 'app_server_url'");
    if (setting && setting.value && setting.value.trim().length > 0) {
      let custom = setting.value.trim();
      if (!custom.startsWith('http://') && !custom.startsWith('https://')) {
        custom = `${req.protocol}://${custom}`;
      }
      return custom;
    }
  } catch (e) {}

  let host = req.get('host') || 'localhost:3000';
  // If host is localhost or loopback, auto-substitute with local LAN / Wi-Fi IP so phones can scan!
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    const interfaces = os.networkInterfaces();
    let localIp = null;
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254')) {
          if (name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('wireless') || iface.address.startsWith('192.168.1.')) {
            localIp = iface.address;
            break;
          }
          if (!localIp) localIp = iface.address;
        }
      }
      if (localIp && (localIp.startsWith('192.168.1.') || name.toLowerCase().includes('wi-fi'))) break;
    }
    if (localIp) {
      const port = host.split(':')[1] || '3000';
      host = `${localIp}:${port}`;
    }
  }
  return `${req.protocol}://${host}`;
}

// GET all rooms
router.get('/', async (req, res) => {
  try {
    const rooms = await query.all('SELECT * FROM rooms WHERE is_active = 1 ORDER BY building ASC, name ASC');
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat daftar ruangan' });
  }
});

// GET QR code for a specific room
router.get('/:id/qr', async (req, res) => {
  try {
    const { id } = req.params;
    const room = await query.get('SELECT * FROM rooms WHERE id = ?', [id]);
    if (!room) return res.status(404).json({ error: 'Ruangan tidak ditemukan' });

    const baseUrl = await getReachableBaseUrl(req);
    const qrDataUrl = await QRCodeService.generateRoomQR(baseUrl, room.code, room.id);
    res.json({ room, qrDataUrl, reportUrl: `${baseUrl}/lapor.html?room=${encodeURIComponent(room.code)}&id=${room.id}` });
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat QR Code' });
  }
});

// GET all QR codes with room metadata for batch printing
router.get('/all/qrcodes', async (req, res) => {
  try {
    const rooms = await query.all('SELECT * FROM rooms WHERE is_active = 1 ORDER BY building, name');
    const baseUrl = await getReachableBaseUrl(req);

    const results = [];
    for (const r of rooms) {
      const qrDataUrl = await QRCodeService.generateRoomQR(baseUrl, r.code, r.id);
      results.push({
        ...r,
        qrDataUrl,
        reportUrl: `${baseUrl}/lapor.html?room=${encodeURIComponent(r.code)}&id=${r.id}`
      });
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat QR batch' });
  }
});

// POST add room
router.post('/', async (req, res) => {
  try {
    const { name, code, building, floor, pic_name, pic_phone } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'Nama dan kode ruangan wajib diisi' });

    const result = await query.run(`
      INSERT INTO rooms (name, code, building, floor, pic_name, pic_phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [name, code, building, floor, pic_name, pic_phone]);

    res.status(201).json({ id: result.lastID, message: 'Ruangan berhasil ditambahkan' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menambah ruangan: ' + err.message });
  }
});

// PUT update room
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, building, floor, pic_name, pic_phone } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'Nama dan kode ruangan wajib diisi' });

    await query.run(`
      UPDATE rooms 
      SET name = ?, code = ?, building = ?, floor = ?, pic_name = ?, pic_phone = ?
      WHERE id = ?
    `, [name, code, building, floor, pic_name, pic_phone, id]);

    res.json({ message: 'Data ruangan berhasil diperbarui' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui ruangan: ' + err.message });
  }
});

// DELETE (Hard delete with cascade cleanup)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Unassign users linked to this room
    await query.run('UPDATE users SET room_id = NULL WHERE room_id = ?', [id]);

    // Cleanup tickets & logs linked to this room so deletion never fails
    const tickets = await query.all('SELECT id FROM tickets WHERE room_id = ?', [id]);
    if (tickets && tickets.length > 0) {
      for (const t of tickets) {
        await query.run('DELETE FROM notifications_log WHERE ticket_id = ?', [t.id]);
        await query.run('DELETE FROM ticket_logs WHERE ticket_id = ?', [t.id]);
      }
      await query.run('DELETE FROM tickets WHERE room_id = ?', [id]);
    }

    // Permanently remove room from database
    await query.run('DELETE FROM rooms WHERE id = ?', [id]);
    res.json({ message: 'Ruangan berhasil dihapus secara permanen dari Supabase' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus ruangan: ' + err.message });
  }
});

// RESTORE room
router.patch('/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    await query.run('UPDATE rooms SET is_active = 1 WHERE id = ?', [id]);
    res.json({ message: 'Ruangan berhasil diaktifkan kembali' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengaktifkan ruangan: ' + err.message });
  }
});

module.exports = router;

