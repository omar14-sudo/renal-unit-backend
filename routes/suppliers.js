const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');

// ✅ GET: جلب كل الموردين مع البحث
router.get('/', async (req, res) => {
    try {
        const { search } = req.query;
        let sql = 'SELECT * FROM suppliers';
        const params = [];

        if (search) {
            sql += ' WHERE name LIKE ? OR contact_person LIKE ? OR phone LIKE ? OR email LIKE ?';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        sql += ' ORDER BY name ASC';

        const suppliers = await dbAll(sql, params);
        res.json(suppliers);
    } catch (err) {
        console.error('❌ فشل في جلب الموردين:', err.message);
        res.status(500).json({ error: 'فشل في جلب الموردين' });
    }
});

// ✅ GET: جلب مورد واحد
router.get('/:id', async (req, res) => {
    try {
        const supplier = await dbGet('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
        if (supplier) res.json(supplier);
        else res.status(404).json({ error: 'المورد غير موجود.' });
    } catch (err) {
        console.error('❌ فشل في جلب المورد:', err.message);
        res.status(500).json({ error: 'فشل في جلب بيانات المورد' });
    }
});

// ✅ POST: إضافة مورد
router.post('/', async (req, res) => {
    try {
        const { name, contact_person, phone, email, address, notes } = req.body;

        if (!name) return res.status(400).json({ error: 'اسم المورد مطلوب.' });

        const sql = `INSERT INTO suppliers (name, contact_person, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?)`;
        const result = await dbRun(sql, [name, contact_person, phone, email, address, notes]);

        res.status(201).json({ message: '✅ تم إضافة المورد بنجاح', id: result.lastID });
    } catch (err) {
        console.error('❌ فشل في إضافة المورد:', err.message);
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'المورد بهذا الاسم موجود بالفعل.' });
        }
        res.status(500).json({ error: 'فشل في إضافة المورد' });
    }
});

// ✅ PUT: تعديل بيانات مورد
router.put('/:id', async (req, res) => {
    try {
        const { name, contact_person, phone, email, address, notes } = req.body;

        if (!name) return res.status(400).json({ error: 'اسم المورد مطلوب.' });

        const sql = `UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?`;
        const result = await dbRun(sql, [name, contact_person, phone, email, address, notes, req.params.id]);

        if (result.changes === 0) return res.status(404).json({ error: 'المورد غير موجود.' });

        res.json({ message: '✅ تم تعديل بيانات المورد' });
    } catch (err) {
        console.error('❌ فشل في تعديل المورد:', err.message);
        res.status(500).json({ error: 'فشل في تعديل المورد' });
    }
});

// ✅ DELETE: حذف مورد
router.delete('/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM suppliers WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: 'المورد غير موجود للحذف.' });

        res.json({ message: '✅ تم حذف المورد بنجاح' });
    } catch (err) {
        console.error('❌ فشل في حذف المورد:', err.message);
        res.status(500).json({ error: 'فشل في حذف المورد' });
    }
});

module.exports = router;