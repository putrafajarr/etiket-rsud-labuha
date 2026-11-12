const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');

// GET all technicians with active task counts
router.get('/technicians', async (req, res) => {
  try {
    const technicians = await query.all(`
      SELECT 
        u.id, u.name, u.phone, u.email, u.specialization,
        COUNT(CASE WHEN t.status IN ('assigned', 'in_progress') THEN 1 END) as active_tickets,
        COUNT(CASE WHEN t.status IN ('resolved', 'closed') THEN 1 END) as resolved_tickets,
        AVG(t.satisfaction_rating) as avg_rating
      FROM users u
      LEFT JOIN tickets t ON u.id = t.assigned_to
      WHERE u.role = 'teknisi' AND u.is_active = 1
      GROUP BY u.id
      ORDER BY active_tickets ASC, u.name ASC
    `);

    res.json(technicians);
  } catch (err) {
    console.error('Fetch tech error:', err);
    res.status(500).json({ error: 'Gagal memuat data teknisi' });
  }
});

// GET all users
router.get('/', async (req, res) => {
  try {
    const users = await query.all(`
      SELECT id, username, name, role, phone, email, room_id, specialization, is_active, created_at
      FROM users
      ORDER BY role, name
    `);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat data pengguna' });
  }
});

// POST add user
router.post('/', async (req, res) => {
  try {
    const { username, password, name, role, phone, email, specialization, room_id } = req.body;
    if (!username || !password || !name || !role) {
      return res.status(400).json({ error: 'Data wajib belum lengkap' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const result = await query.run(`
      INSERT INTO users (username, password_hash, name, role, phone, email, specialization, room_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [username, password_hash, name, role, phone, email, specialization, room_id || null]);

    res.status(201).json({ id: result.lastID, message: 'Pengguna berhasil dibuat' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menambah pengguna: ' + err.message });
  }
});

// PUT edit user
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, name, role, phone, email, specialization, password } = req.body;

    if (!name || !role) {
      return res.status(400).json({ error: 'Nama dan peran (role) wajib diisi' });
    }

    if (username && username.trim().length > 0) {
      const existing = await query.get('SELECT id FROM users WHERE username = ? AND id != ?', [username.trim(), id]);
      if (existing) {
        return res.status(400).json({ error: 'Username "' + username + '" sudah digunakan oleh akun lain' });
      }
    }

    if (password && password.trim().length > 0) {
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password.trim(), salt);
      if (username && username.trim().length > 0) {
        await query.run(`
          UPDATE users 
          SET username = ?, name = ?, role = ?, phone = ?, email = ?, specialization = ?, password_hash = ?
          WHERE id = ?
        `, [username.trim(), name, role, phone, email, specialization, password_hash, id]);
      } else {
        await query.run(`
          UPDATE users 
          SET name = ?, role = ?, phone = ?, email = ?, specialization = ?, password_hash = ?
          WHERE id = ?
        `, [name, role, phone, email, specialization, password_hash, id]);
      }
    } else {
      if (username && username.trim().length > 0) {
        await query.run(`
          UPDATE users 
          SET username = ?, name = ?, role = ?, phone = ?, email = ?, specialization = ?
          WHERE id = ?
        `, [username.trim(), name, role, phone, email, specialization, id]);
      } else {
        await query.run(`
          UPDATE users 
          SET name = ?, role = ?, phone = ?, email = ?, specialization = ?
          WHERE id = ?
        `, [name, role, phone, email, specialization, id]);
      }
    }

    res.json({ message: 'Data pengguna berhasil diperbarui' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui pengguna: ' + err.message });
  }
});

// DELETE user
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await query.run('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
    res.json({ message: 'Pengguna berhasil dinonaktifkan' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menonaktifkan pengguna: ' + err.message });
  }
});

module.exports = router;

