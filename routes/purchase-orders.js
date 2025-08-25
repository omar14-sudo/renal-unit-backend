const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');

// ✅ GET: جلب جميع أوامر الشراء
router.get('/', async (req, res) => {
    try {
        const orders = await dbAll(`
            SELECT po.*, s.name AS supplier_name
            FROM purchase_orders po
            JOIN suppliers s ON po.supplier_id = s.id
            ORDER BY po.order_date DESC, po.id DESC
        `);
        res.json(orders);
    } catch (err) {
        console.error('❌ فشل في جلب أوامر الشراء:', err.message);
        res.status(500).json({ error: 'فشل في جلب أوامر الشراء' });
    }
});

// ✅ GET: جلب تفاصيل أمر شراء واحد مع أصنافه
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const details = await dbGet(`
            SELECT po.*, s.name AS supplier_name
            FROM purchase_orders po
            JOIN suppliers s ON po.supplier_id = s.id
            WHERE po.id = ?
        `, [id]);

        if (!details) {
            return res.status(404).json({ error: 'أمر الشراء غير موجود.' });
        }

        const items = await dbAll(`
            SELECT poi.*, ms.name AS supply_name
            FROM purchase_order_items poi
            JOIN medical_supplies ms ON poi.supply_id = ms.id
            WHERE poi.purchase_order_id = ?
        `, [id]);

        res.json({ details, items });
    } catch (err) {
        console.error('❌ فشل في جلب تفاصيل أمر الشراء:', err.message);
        res.status(500).json({ error: 'فشل في جلب تفاصيل أمر الشراء' });
    }
});

// ✅ POST: إضافة أمر شراء جديد
router.post('/', async (req, res) => {
    const { supplier_id, order_date, expected_delivery_date, notes, items } = req.body;

    if (!supplier_id || !order_date || !items || items.length === 0) {
        return res.status(400).json({ error: 'معرف المورد، تاريخ الطلب، والأصناف مطلوبة.' });
    }

    try {
        await dbRun('BEGIN TRANSACTION;');

        const orderResult = await dbRun(
            'INSERT INTO purchase_orders (supplier_id, order_date, expected_delivery_date, notes) VALUES (?, ?, ?, ?)',
            [supplier_id, order_date, expected_delivery_date, notes]
        );
        const purchaseOrderId = orderResult.lastID;

        for (const item of items) {
            await dbRun(
                'INSERT INTO purchase_order_items (purchase_order_id, supply_id, quantity_ordered, unit_price) VALUES (?, ?, ?, ?)',
                [purchaseOrderId, item.supply_id, item.quantity_ordered, item.unit_price]
            );
        }

        await dbRun('COMMIT;');
        res.status(201).json({ message: '✅ تم إنشاء أمر الشراء بنجاح', id: purchaseOrderId });
    } catch (err) {
        await dbRun('ROLLBACK;');
        console.error('❌ فشل في إضافة أمر الشراء:', err.message);
        res.status(500).json({ error: 'فشل في إضافة أمر الشراء', details: err.message });
    }
});

// ✅ PUT: تأكيد استلام أمر شراء وتحديث المخزون
router.put('/:id/complete', async (req, res) => {
    const { id } = req.params;

    try {
        const order = await dbGet('SELECT * FROM purchase_orders WHERE id = ?', [id]);
        if (!order) {
            return res.status(404).json({ error: 'أمر الشراء غير موجود.' });
        }
        if (order.status === 'Completed') {
            return res.status(400).json({ error: 'أمر الشراء هذا تم استلامه بالفعل.' });
        }

        const items = await dbAll('SELECT supply_id, quantity_ordered FROM purchase_order_items WHERE purchase_order_id = ?', [id]);
        if (items.length === 0) {
            return res.status(400).json({ error: 'لا توجد أصناف في أمر الشراء هذا لتحديث المخزون.' });
        }

        await dbRun('BEGIN TRANSACTION;');

        for (const item of items) {
            const updateResult = await dbRun(
                `UPDATE medical_supplies SET quantity = quantity + ? WHERE id = ?`,
                [item.quantity_ordered, item.supply_id]
            );
            if (updateResult.changes === 0) {
                throw new Error(`فشل تحديث كمية المستلزم ID: ${item.supply_id}. ربما المستلزم غير موجود.`);
            }
            const currentSupply = await dbGet('SELECT quantity FROM medical_supplies WHERE id = ?', [item.supply_id]);
            await dbRun(
                `INSERT INTO inventory_log (supply_id, change_amount, new_quantity, notes) VALUES (?, ?, ?, ?)`,
                [item.supply_id, item.quantity_ordered, currentSupply.quantity, `استلام أمر شراء رقم ${id}`]
            );
        }

        await dbRun('UPDATE purchase_orders SET status = ? WHERE id = ?', ['Completed', id]);

        await dbRun('COMMIT;');
        res.json({ message: '✅ تم تأكيد الاستلام وتحديث المخزون بنجاح.' });

    } catch (err) {
        await dbRun('ROLLBACK;');
        console.error('❌ فشل في تأكيد استلام أمر الشراء وتحديث المخزون:', err.message);
        res.status(500).json({ error: 'فشل في تأكيد استلام أمر الشراء وتحديث المخزون', details: err.message });
    }
});

module.exports = router;