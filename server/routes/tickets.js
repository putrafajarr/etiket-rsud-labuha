const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../config/db');
const NotificationManager = require('../services/notification');

// Setup multer for photo uploads
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `tkt_${Date.now()}_${Math.round(Math.random() * 1E6)}${ext}`;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Helper to generate ticket number: TKT-202611-0001
async function generateTicketNumber() {
  const now = new Date();
  const yearMonth = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0');
  const countRow = await query.get(`
    SELECT COUNT(*) as count FROM tickets 
    WHERE ticket_no LIKE 'TKT-${yearMonth}-%'
  `);
  const seq = (countRow.count + 1).toString().padStart(4, '0');
  return `TKT-${yearMonth}-${seq}`;
}

// GET all tickets with filtering
router.get('/', async (req, res) => {
  try {
    const { status, priority, roomId, categoryId, search, techId } = req.query;
    let sql = `
      SELECT t.*, u.name as tech_name, u.phone as tech_phone
      FROM tickets t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      sql += ' AND t.status = ?';
      params.push(status);
    }
    if (priority && priority !== 'all') {
      sql += ' AND t.priority = ?';
      params.push(priority);
    }
    if (roomId) {
      sql += ' AND t.room_id = ?';
      params.push(roomId);
    }
    if (categoryId) {
      sql += ' AND t.category_id = ?';
      params.push(categoryId);
    }
    if (techId) {
      sql += ' AND t.assigned_to = ?';
      params.push(techId);
    }
    if (search) {
      sql += ' AND (t.ticket_no LIKE ? OR t.title LIKE ? OR t.reporter_name LIKE ? OR t.room_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    sql += " ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, t.created_at DESC";

    const tickets = await query.all(sql, params);
    res.json(tickets);
  } catch (err) {
    console.error('Fetch tickets error:', err);
    res.status(500).json({ error: 'Gagal mengambil data tiket' });
  }
});

// GET lightweight latest ticket alert for mobile background service polling
router.get('/latest-alert', async (req, res) => {
  try {
    const sinceId = parseInt(req.query.sinceId, 10);
    const maxRow = await query.get('SELECT MAX(id) as maxId FROM tickets');
    const latestId = maxRow && maxRow.maxId ? maxRow.maxId : 0;
    const openRow = await query.get("SELECT COUNT(*) as openCount FROM tickets WHERE status = 'open'");
    const openCount = openRow ? openRow.openCount : 0;

    let newTickets = [];
    if (!Number.isNaN(sinceId) && sinceId >= 0) {
      newTickets = await query.all(`
        SELECT id, ticket_no, room_name, category_name, reporter_name, reporter_phone, title, priority, status, assigned_to, created_at
        FROM tickets
        WHERE id > ?
        ORDER BY id ASC
        LIMIT 5
      `, [sinceId]);
    }

    res.json({ latestId, openCount, newTickets });
  } catch (err) {
    console.error('Latest alert error:', err);
    res.status(500).json({ error: 'Gagal memeriksa alert tiket' });
  }
});

// GET ticket detail by ID or Ticket Number
router.get('/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    let ticket;
    if (identifier.startsWith('TKT-')) {
      ticket = await query.get(`
        SELECT t.*, u.name as tech_name, u.phone as tech_phone
        FROM tickets t
        LEFT JOIN users u ON t.assigned_to = u.id
        WHERE t.ticket_no = ?
      `, [identifier]);
    } else {
      ticket = await query.get(`
        SELECT t.*, u.name as tech_name, u.phone as tech_phone
        FROM tickets t
        LEFT JOIN users u ON t.assigned_to = u.id
        WHERE t.id = ?
      `, [identifier]);
    }

    if (!ticket) {
      return res.status(404).json({ error: 'Tiket tidak ditemukan' });
    }

    // Get logs for this ticket
    const logs = await query.all(`
      SELECT * FROM ticket_logs WHERE ticket_id = ? ORDER BY created_at ASC
    `, [ticket.id]);

    res.json({ ticket, logs });
  } catch (err) {
    console.error('Detail ticket error:', err);
    res.status(500).json({ error: 'Gagal mengambil detail tiket' });
  }
});

// POST create new ticket (Jalur 1 Web/QR, Jalur 2 Mobile App, Jalur 3 Bot)
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const {
      room_id, category_id,
      reporter_name, reporter_phone, reporter_email, reporter_role,
      title, description, priority = 'medium', channel = 'web_qr'
    } = req.body;

    const finalDescription = (description || '').trim();
    const finalTitle = (title && title.trim()) ? title.trim() : (finalDescription.length > 70 ? finalDescription.substring(0, 70) + '...' : finalDescription || 'Laporan Kendala IT');

    if (!room_id || !reporter_name || !reporter_phone || !finalDescription) {
      return res.status(400).json({ error: 'Ruangan, Nama Pelapor, No. WhatsApp, dan Rincian kendala wajib diisi' });
    }

    // Get room details
    const room = await query.get('SELECT name FROM rooms WHERE id = ?', [room_id]);
    const room_name = room ? room.name : 'Ruangan Umum';

    // Get category details
    let category_name = 'Umum';
    let sla_resolve_hours = 4;
    if (category_id) {
      const cat = await query.get('SELECT name, sla_resolve_hours FROM categories WHERE id = ?', [category_id]);
      if (cat) {
        category_name = cat.name;
        sla_resolve_hours = cat.sla_resolve_hours || 4;
      }
    }

    const ticket_no = await generateTicketNumber();
    const photo_url = req.file ? `/uploads/${req.file.filename}` : null;

    // Calculate SLA target
    const now = new Date();
    const targetResolveTime = new Date(now.getTime() + (sla_resolve_hours * 3600 * 1000)).toISOString();

    const result = await query.run(`
      INSERT INTO tickets (
        ticket_no, room_id, room_name, category_id, category_name,
        reporter_name, reporter_phone, reporter_email, reporter_role,
        title, description, photo_url, priority, channel, status,
        target_resolve_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
    `, [
      ticket_no, room_id, room_name, category_id || null, category_name,
      reporter_name, reporter_phone, reporter_email || null, reporter_role || 'Staff Ruangan',
      finalTitle, finalDescription, photo_url, priority, channel, targetResolveTime
    ]);

    const ticketId = result.lastID;

    // Log action
    await query.run(`
      INSERT INTO ticket_logs (ticket_id, user_name, action, notes)
      VALUES (?, ?, 'TIKET DIBUAT', ?)
    `, [ticketId, reporter_name, `Tiket dibuat melalui jalur ${channel}`]);

    // Fetch created ticket
    const createdTicket = await query.get('SELECT * FROM tickets WHERE id = ?', [ticketId]);

    // Trigger Multi-channel notifications & Socket.io broadcast
    const io = req.app.get('io');
    NotificationManager.notifyTicketCreated(createdTicket, io).catch(e => console.error('Notif error:', e));

    res.status(201).json({
      message: 'Tiket berhasil dibuat',
      ticket: createdTicket
    });
  } catch (err) {
    console.error('Create ticket error:', err);
    res.status(500).json({ error: 'Gagal membuat tiket: ' + err.message });
  }
});

// PATCH assign technician to ticket
router.patch('/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const { technician_id, assigned_by_name = 'Helpdesk IT' } = req.body;

    if (!technician_id) {
      return res.status(400).json({ error: 'ID teknisi wajib disertakan' });
    }

    const currentTicket = await query.get('SELECT * FROM tickets WHERE id = ?', [id]);
    if (!currentTicket) {
      return res.status(404).json({ error: 'Tiket tidak ditemukan' });
    }

    if (currentTicket.status === 'resolved' || currentTicket.status === 'closed') {
      return res.status(400).json({ error: 'Tiket ini telah selesai dikerjakan dan dikunci secara permanen. Tidak dapat diubah atau diotak-atik lagi.' });
    }

    const tech = await query.get('SELECT id, name, phone, email FROM users WHERE id = ?', [technician_id]);
    if (!tech) {
      return res.status(404).json({ error: 'Teknisi tidak ditemukan' });
    }

    const now = new Date().toISOString();
    const actionDesc = currentTicket.assigned_to 
      ? `Tiket didisposisikan / dialihkan dari ${currentTicket.assigned_to_name || 'Petugas Sebelumnya'} ke ${tech.name}`
      : `Tiket diambil / dikunci oleh teknisi: ${tech.name}`;

    await query.run(`
      UPDATE tickets 
      SET assigned_to = ?, assigned_to_name = ?, assigned_at = ?, status = 'in_progress', updated_at = ?
      WHERE id = ?
    `, [tech.id, tech.name, now, now, id]);

    // Log action
    await query.run(`
      INSERT INTO ticket_logs (ticket_id, user_name, action, notes)
      VALUES (?, ?, 'PENUGASAN TEKNISI', ?)
    `, [id, assigned_by_name, `Tiket dialihkan ke teknisi: ${tech.name}`]);

    const updatedTicket = await query.get('SELECT * FROM tickets WHERE id = ?', [id]);
    const io = req.app.get('io');
    NotificationManager.notifyTicketAssigned(updatedTicket, tech, io).catch(e => console.error(e));

    res.json({ message: 'Teknisi berhasil ditugaskan', ticket: updatedTicket });
  } catch (err) {
    console.error('Assign tech error:', err);
    res.status(500).json({ error: 'Gagal menugaskan teknisi' });
  }
});

// PATCH update status (in_progress, pending, resolved, closed)
router.patch('/:id/status', upload.single('proof_photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, user_name = 'Teknisi IT', notes, pending_reason } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status baru wajib disertakan' });
    }

    const now = new Date().toISOString();
    let proof_photo_url = req.file ? `/uploads/${req.file.filename}` : null;

    const currentTicket = await query.get('SELECT * FROM tickets WHERE id = ?', [id]);
    if (!currentTicket) {
      return res.status(404).json({ error: 'Tiket tidak ditemukan' });
    }

    if (currentTicket.status === 'resolved' || currentTicket.status === 'closed') {
      return res.status(400).json({ error: 'Tiket ini telah selesai dikerjakan dan dikunci secara permanen. Tidak dapat diubah atau diotak-atik lagi.' });
    }

    let sql = 'UPDATE tickets SET status = ?, updated_at = ?';
    const params = [status, now];

    if (proof_photo_url) {
      sql += ', proof_photo_url = ?';
      params.push(proof_photo_url);
    }
    if (notes) {
      sql += ', resolution_notes = ?';
      params.push(notes);
    }
    if (pending_reason) {
      sql += ', pending_reason = ?';
      params.push(pending_reason);
    }

    if (status === 'in_progress' && !currentTicket.actual_response_time) {
      sql += ', actual_response_time = ?';
      params.push(now);
    }
    if (status === 'resolved') {
      sql += ', resolved_at = ?';
      params.push(now);
    }
    if (status === 'closed') {
      sql += ', closed_at = ?';
      params.push(now);
    }

    sql += ' WHERE id = ?';
    params.push(id);

    await query.run(sql, params);

    // Log action
    await query.run(`
      INSERT INTO ticket_logs (ticket_id, user_name, action, notes)
      VALUES (?, ?, ?, ?)
    `, [id, user_name, `STATUS DIUBAH: ${status.toUpperCase()}`, notes || pending_reason || `Status tiket diperbarui menjadi ${status}`]);

    const updatedTicket = await query.get('SELECT * FROM tickets WHERE id = ?', [id]);
    const io = req.app.get('io');

    if (status === 'resolved') {
      NotificationManager.notifyTicketResolved(updatedTicket, io).catch(e => console.error(e));
    } else if (io) {
      io.emit('ticket_updated', { ticket: updatedTicket, action: status });
    }

    res.json({ message: 'Status berhasil diperbarui', ticket: updatedTicket });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Gagal memperbarui status' });
  }
});

// POST submit satisfaction rating (Rating Bintang 1-5)
router.post('/:id/rate', async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating harus antara 1 sampai 5 bintang' });
    }

    await query.run(`
      UPDATE tickets 
      SET satisfaction_rating = ?, satisfaction_feedback = ?, status = 'closed', closed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [rating, feedback || null, id]);

    await query.run(`
      INSERT INTO ticket_logs (ticket_id, user_name, action, notes)
      VALUES (?, 'Pelapor', 'PENILAIAN KEPUASAN', ?)
    `, [id, `Memberikan rating ${rating} Bintang: "${feedback || 'Tanpa komentar'}"`]);

    res.json({ message: 'Terima kasih atas penilaian kepuasan Anda' });
  } catch (err) {
    console.error('Rating error:', err);
    res.status(500).json({ error: 'Gagal menyimpan penilaian' });
  }
});

// DELETE ticket (Admin cleanup)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await query.run('DELETE FROM notifications_log WHERE ticket_id = ?', [id]);
    await query.run('DELETE FROM ticket_logs WHERE ticket_id = ?', [id]);
    await query.run('DELETE FROM tickets WHERE id = ?', [id]);
    res.json({ message: 'Tiket berhasil dihapus secara permanen dari Supabase' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus tiket: ' + err.message });
  }
});

module.exports = router;

