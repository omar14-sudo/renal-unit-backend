const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');
const { protect } = require('../middleware/auth'); // استدعاء حارس الـ API

// ✅ GET /api/water-log - جلب السجلات مع فلترة وتقسيم
router.get('/', protect, async (req, res) => {
    try {
        const { page = 1, limit = 20, startDate, endDate } = req.query;
        const offset = (page - 1) * limit;

        let whereClauses = [];
        const params = [];

        if (startDate && endDate) {
            whereClauses.push(`date(log_date) BETWEEN date(?) AND date(?)`);
            params.push(startDate, endDate);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const dataSql = `SELECT * FROM water_treatment_log ${whereSql} ORDER BY log_date DESC LIMIT ? OFFSET ?`;
        const countSql = `SELECT COUNT(*) as total FROM water_treatment_log ${whereSql}`;

        const rows = await dbAll(dataSql, [...params, parseInt(limit), offset]);
        const countRow = await dbGet(countSql, params);
        
        res.json({ data: rows, total: countRow.total, totalPages: Math.ceil(countRow.total / limit) });
    } catch (err) {
        console.error('❌ فشل في جلب سجل محطة المياه:', err.message);
        res.status(500).json({ error: 'فشل في جلب السجلات' });
    }
});

// ✅ POST /api/water-log - إضافة سجل جديد
router.post('/', protect, async (req, res) => {
    try {
        const { 
            log_date, technician_name, chlorine_level_before, chlorine_level_after,
            water_hardness, ph_level, ro_inlet_pressure, ro_outlet_pressure,
            ro_reject_pressure, conductivity, notes 
        } = req.body;

        if (!log_date || !technician_name) {
            return res.status(400).json({ error: 'تاريخ التسجيل واسم الفني حقول مطلوبة.' });
        }

        const sql = `
            INSERT INTO water_treatment_log (
                log_date, technician_name, chlorine_level_before, chlorine_level_after,
                water_hardness, ph_level, ro_inlet_pressure, ro_outlet_pressure,
                ro_reject_pressure, conductivity, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        await dbRun(sql, [
            log_date, technician_name, chlorine_level_before, chlorine_level_after,
            water_hardness, ph_level, ro_inlet_pressure, ro_outlet_pressure,
            ro_reject_pressure, conductivity, notes
        ]);

        res.status(201).json({ message: '✅ تم حفظ قراءة محطة المياه بنجاح.' });
    } catch (err) {
        console.error('❌ فشل في إضافة سجل محطة المياه:', err.message);
        res.status(500).json({ error: 'فشل في حفظ السجل.' });
    }
});

module.exports = router;