const express = require('express');
const router = express.Router();
const { query } = require('../config/db');

// GET all active IT issue categories
router.get('/', async (req, res) => {
  try {
    const categories = await query.all(
      'SELECT * FROM categories WHERE is_active = 1 OR is_active IS NULL ORDER BY id ASC'
    );
    res.json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Gagal memuat kategori kendala' });
  }
});

module.exports = router;

