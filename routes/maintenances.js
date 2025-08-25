const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');

// ✅ GET: جميع سجلات الصيانة
router.get('/', async (req, res) => {
    try {
        const maintenances = await dbAll(`
            SELECT m.*, mc.name AS machine_name
            FROM maintenances m
            LEFT JOIN machines mc ON m.machine_id = mc.id
            ORDER BY m.date DESC
        `);
        res.json({ data: maintenances });
    } catch (err) {
        console.error('❌ فشل في جلب سجلات الصيانة:', err.message);
        res.status(500).json({ error: 'فشل في جلب سجلات الصيانة' });
    }
});

// ✅ GET: سجل صيانة واحد
router.get('/:id', async (req, res) => {
    try {
        const maintenance = await dbGet(`
            SELECT m.*, mc.name AS machine_name
            FROM maintenances m
            LEFT JOIN machines mc ON m.machine_id = mc.id
            WHERE m.id = ?
        `, [req.params.id]);

        if (maintenance) res.json(maintenance);
        else res.status(404).json({ error: 'السجل غير موجود' });
    } catch (err) {
        console.error('❌ فشل في جلب سجل الصيانة:', err.message);
        res.status(500).json({ error: 'فشل في جلب السجل' });
    }
});

// ✅ POST: إضافة سجل صيانة
router.post('/', async (req, res) => {
    try {
        const { machine_id, date, type, technician, description, notes } = req.body;

        if (!machine_id || !date || !type) {
            return res.status(400).json({ error: 'يجب تحديد الماكينة، التاريخ، ونوع الصيانة.' });
        }

        const sql = `INSERT INTO maintenances (machine_id, date, type, technician, description, notes)
                     VALUES (?, ?, ?, ?, ?, ?)`;

        const result = await dbRun(sql, [machine_id, date, type, technician, description, notes]);
        res.status(201).json({ message: 'تم إضافة سجل الصيانة بنجاح', id: result.lastID });
    } catch (err) {
        console.error('❌ فشل في إضافة السجل:', err.message);
        res.status(500).json({ error: 'فشل في إضافة السجل' });
    }
});

// ✅ PUT: تعديل سجل صيانة
router.put('/:id', async (req, res) => {
    try {
        const { machine_id, date, type, technician, description, notes } = req.body;

        const sql = `UPDATE maintenances SET machine_id = ?, date = ?, type = ?, technician = ?, description = ?, notes = ? WHERE id = ?`;

        const result = await dbRun(sql, [machine_id, date, type, technician, description, notes, req.params.id]);

        if (result.changes === 0) return res.status(404).json({ error: 'السجل غير موجود' });

        res.json({ message: 'تم تعديل سجل الصيانة بنجاح' });
    } catch (err) {
        console.error('❌ فشل في تعديل سجل الصيانة:', err.message);
        res.status(500).json({ error: 'فشل في تعديل السجل' });
    }
});

// ✅ DELETE: حذف سجل صيانة
router.delete('/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM maintenances WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: 'السجل غير موجود للحذف' });

        res.json({ message: 'تم حذف سجل الصيانة بنجاح' });
    } catch (err) {
        console.error('❌ فشل في حذف السجل:', err.message);
        res.status(500).json({ error: 'فشل في حذف السجل' });
    }
});

module.exports = router;