const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const ReportGenerator = require('../services/reportGenerator');

// GET analytics & KPI summary
router.get('/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = '';
    const params = [];
    if (startDate) {
      dateFilter += ' AND created_at >= ?';
      params.push(startDate + ' 00:00:00');
    }
    if (endDate) {
      dateFilter += ' AND created_at <= ?';
      params.push(endDate + ' 23:59:59');
    }

    const totalRow = await query.get(`SELECT COUNT(*) as count FROM tickets WHERE 1=1 ${dateFilter}`, params);
    const openRow = await query.get(`SELECT COUNT(*) as count FROM tickets WHERE status = "open" ${dateFilter}`, params);
    const assignedRow = await query.get(`SELECT COUNT(*) as count FROM tickets WHERE status = "assigned" ${dateFilter}`, params);
    const inProgressRow = await query.get(`SELECT COUNT(*) as count FROM tickets WHERE status = "in_progress" ${dateFilter}`, params);
    const pendingRow = await query.get(`SELECT COUNT(*) as count FROM tickets WHERE status = "pending" ${dateFilter}`, params);
    const resolvedRow = await query.get(`SELECT COUNT(*) as count FROM tickets WHERE status IN ("resolved", "closed") ${dateFilter}`, params);
    const avgRatingRow = await query.get(`SELECT AVG(satisfaction_rating) as avg_rating FROM tickets WHERE satisfaction_rating IS NOT NULL ${dateFilter}`, params);

    // Priority distribution
    const priorityStats = await query.all(`
      SELECT priority, COUNT(*) as count 
      FROM tickets 
      WHERE 1=1 ${dateFilter}
      GROUP BY priority
    `, params);

    // Category distribution
    const categoryStats = await query.all(`
      SELECT category_name, COUNT(*) as count 
      FROM tickets 
      WHERE 1=1 ${dateFilter}
      GROUP BY category_name
      ORDER BY count DESC
    `, params);

    // Top rooms with issues
    const roomStats = await query.all(`
      SELECT room_name, COUNT(*) as count 
      FROM tickets 
      WHERE 1=1 ${dateFilter}
      GROUP BY room_name
      ORDER BY count DESC
      LIMIT 10
    `, params);

    // Channel breakdown
    const channelStats = await query.all(`
      SELECT channel, COUNT(*) as count 
      FROM tickets 
      WHERE 1=1 ${dateFilter}
      GROUP BY channel
    `, params);

    // SLA Met vs Overdue
    const slaStats = await query.all(`
      SELECT 
        COUNT(CASE WHEN status IN ('resolved', 'closed') AND actual_resolve_time <= target_resolve_time THEN 1 END) as met,
        COUNT(CASE WHEN status IN ('resolved', 'closed') AND actual_resolve_time > target_resolve_time THEN 1 END) as breached,
        COUNT(CASE WHEN status NOT IN ('resolved', 'closed') AND CURRENT_TIMESTAMP > target_resolve_time THEN 1 END) as overdue_active
      FROM tickets
      WHERE 1=1 ${dateFilter}
    `, params);

    const total = totalRow.count || 0;
    const resolved = resolvedRow.count || 0;
    const slaMet = (slaStats[0] && slaStats[0].met) || 0;
    const slaBreached = (slaStats[0] && slaStats[0].breached) || 0;
    const totalEvaluatedSla = slaMet + slaBreached;
    const slaCompliance = totalEvaluatedSla > 0 ? Math.round((slaMet / totalEvaluatedSla) * 100) : 100;

    res.json({
      total,
      open: (openRow.count || 0) + (assignedRow.count || 0),
      inProgress: inProgressRow.count || 0,
      pending: pendingRow.count || 0,
      resolved,
      avgRating: avgRatingRow.avg_rating ? parseFloat(avgRatingRow.avg_rating).toFixed(1) : '5.0',
      slaCompliance,
      priorityStats,
      categoryStats,
      roomStats,
      channelStats
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Gagal memuat statistik' });
  }
});

// GET export Excel file
router.get('/export-excel', async (req, res) => {
  try {
    const { startDate, endDate, roomId, status } = req.query;
    const workbook = await ReportGenerator.generateExcel({ startDate, endDate, roomId, status });

    const filename = `Laporan_ETIKET_RSUD_LABUHA_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).send('Gagal mengekspor file Excel');
  }
});

// GET printable HTML report
router.get('/print-html', async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;
    const html = await ReportGenerator.generatePrintableHtml({ startDate, endDate, status });
    res.send(html);
  } catch (err) {
    console.error('Print HTML error:', err);
    res.status(500).send('Gagal membuat halaman cetak');
  }
});

module.exports = router;

