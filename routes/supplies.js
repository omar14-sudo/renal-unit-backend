const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');

// ✅ GET: جلب كل المستلزمات مع دعم البحث والتصفية حسب الحالة (مخزون منخفض، منتهي الصلاحية)
router.get('/', async (req, res) => {
    try {
        const { search, status } = req.query;
        let sql = 'SELECT * FROM medical_supplies';
        const conditions = [];
        const params = [];

        if (search) {
            conditions.push('(name LIKE ? OR type LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        if (status) {
            const today = new Date().toISOString().split('T')[0];
            if (status === 'low_stock') {
                conditions.push('quantity < ?');
                params.push(10); // مثال: الكمية أقل من 10 تعتبر مخزونًا منخفضًا
            } else if (status === 'expired') {
                conditions.push('expiry_date < ?');
                params.push(today);
            } else if (status === 'expiring_soon') {
                const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                conditions.push('expiry_date BETWEEN ? AND ?');
                params.push(today, thirtyDaysFromNow);
            }
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY name ASC';

        const supplies = await dbAll(sql, params);
        res.json(supplies);
    } catch (err) {
        console.error('❌ فشل في جلب المستلزمات:', err.message);
        res.status(500).json({ error: 'فشل في جلب المستلزمات' });
    }
});

// ✅ GET: جلب مستلزم واحد
router.get('/:id', async (req, res) => {
    try {
        const supply = await dbGet('SELECT * FROM medical_supplies WHERE id = ?', [req.params.id]);
        if (supply) res.json(supply);
        else res.status(404).json({ error: 'المستلزم غير موجود' });
    } catch (err) {
        console.error('❌ فشل في جلب بيانات المستلزم:', err.message);
        res.status(500).json({ error: 'فشل في جلب بيانات المستلزم' });
    }
});

// ✅ POST: إضافة مستلزم جديد
router.post('/', async (req, res) => {
    try {
        const { name, type, quantity = 0, expiry_date } = req.body;

        if (!name || !type) {
            return res.status(400).json({ error: 'اسم المستلزم والنوع مطلوبان.' });
        }

        const sql = `INSERT INTO medical_supplies (name, type, quantity, expiry_date) VALUES (?, ?, ?, ?)`;
        const result = await dbRun(sql, [name, type, quantity, expiry_date]);

        res.status(201).json({ message: '✅ تم إضافة المستلزم بنجاح', id: result.lastID });
    } catch (err) {
        console.error('❌ فشل في إضافة المستلزم:', err.message);
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'المستلزم بهذا الاسم موجود بالفعل.' });
        }
        res.status(500).json({ error: 'فشل في إضافة المستلزم' });
    }
});

// ✅ PUT: تعديل مستلزم
router.put('/:id', async (req, res) => {
    try {
        const { name, type, expiry_date } = req.body;
        const { id } = req.params;

        const sql = `UPDATE medical_supplies SET name = ?, type = ?, expiry_date = ? WHERE id = ?`;

        const result = await dbRun(sql, [name, type, expiry_date, id]);
        if (result.changes === 0) return res.status(404).json({ error: 'المستلزم غير موجود.' });

        res.json({ message: '✅ تم تعديل بيانات المستلزم بنجاح' });
    } catch (err) {
        console.error('❌ فشل في تعديل المستلزم:', err.message);
        res.status(500).json({ error: 'فشل في تعديل المستلزم' });
    }
});

// ✅ POST: تعديل كمية المستلزم (إضافة/سحب)
router.post('/adjust/:id', async (req, res) => {
    try {
        const { change_amount, notes } = req.body;
        const { id } = req.params;

        if (change_amount === undefined || isNaN(change_amount)) {
            return res.status(400).json({ error: 'الرجاء تحديد كمية صحيحة للتعديل.' });
        }

        const currentSupply = await dbGet('SELECT quantity FROM medical_supplies WHERE id = ?', [id]);
        if (!currentSupply) {
            return res.status(404).json({ error: 'المستلزم غير موجود.' });
        }

        const newQuantity = currentSupply.quantity + parseInt(change_amount);
        if (newQuantity < 0) {
            return res.status(400).json({ error: 'الكمية الجديدة لا يمكن أن تكون سالبة.' });
        }

        const updateSql = `UPDATE medical_supplies SET quantity = ? WHERE id = ?`;
        const logSql = `INSERT INTO inventory_log (supply_id, change_amount, new_quantity, notes) VALUES (?, ?, ?, ?)`;

        await dbRun(updateSql, [newQuantity, id]);
        await dbRun(logSql, [id, change_amount, newQuantity, notes]);

        res.json({ message: '✅ تم تعديل الكمية بنجاح', newQuantity: newQuantity });
    } catch (err) {
        console.error('❌ فشل في تعديل كمية المستلزم:', err.message);
        res.status(500).json({ error: 'فشل في تعديل الكمية' });
    }
});

// ✅ POST: تسجيل استخدام (سحب كمية)
router.post('/log-usage/:id', async (req, res) => {
    try {
        const { quantity_used, notes } = req.body;
        const { id } = req.params;

        if (!quantity_used || quantity_used <= 0 || isNaN(quantity_used)) {
            return res.status(400).json({ error: 'الرجاء تحديد كمية استخدام صحيحة وموجبة.' });
        }

        const currentSupply = await dbGet('SELECT quantity FROM medical_supplies WHERE id = ?', [id]);
        if (!currentSupply) {
            return res.status(404).json({ error: 'المستلزم غير موجود.' });
        }

        const remainingQuantity = currentSupply.quantity - parseInt(quantity_used);
        if (remainingQuantity < 0) {
            return res.status(400).json({ error: `الكمية المستخدمة (${quantity_used}) أكبر من الكمية المتاحة (${currentSupply.quantity}).` });
        }

        const updateSql = `UPDATE medical_supplies SET quantity = ? WHERE id = ?`;
        const logSql = `INSERT INTO inventory_log (supply_id, change_amount, new_quantity, notes) VALUES (?, ?, ?, ?)`;

        await dbRun(updateSql, [remainingQuantity, id]);
        await dbRun(logSql, [id, -quantity_used, remainingQuantity, notes]);

        res.json({ message: '✅ تم تسجيل الاستخدام بنجاح', remainingQuantity: remainingQuantity });
    } catch (err) {
        console.error('❌ فشل في تسجيل استخدام المستلزم:', err.message);
        res.status(500).json({ error: 'فشل في تسجيل الاستخدام' });
    }
});

// ✅ DELETE: حذف مستلزم
router.delete('/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM medical_supplies WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: 'المستلزم غير موجود.' });

        res.json({ message: '✅ تم حذف المستلزم بنجاح' });
    } catch (err) {
        console.error('❌ فشل في حذف المستلزم:', err.message);
        res.status(500).json({ error: 'فشل في حذف المستلزم' });
    }
});

module.exports = router;