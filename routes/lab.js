const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');
const { protect } = require('../middleware/auth');

// --- نقاط نهاية إدارة أنواع التحاليل (lab_test_types) ---

// ✅ GET: جلب كل أنواع التحاليل
router.get('/test-types', async (req, res) => {
    try {
        const testTypes = await dbAll('SELECT * FROM lab_test_types ORDER BY test_name ASC');
        res.json(testTypes);
    } catch (err) {
        console.error('❌ فشل في جلب أنواع التحاليل:', err.message);
        res.status(500).json({ error: 'فشل في جلب أنواع التحاليل.' });
    }
});

// ✅ GET: جلب نوع تحليل واحد
router.get('/test-types/:id', async (req, res) => {
    try {
        const testType = await dbGet('SELECT * FROM lab_test_types WHERE id = ?', [req.params.id]);
        if (testType) res.json(testType);
        else res.status(404).json({ error: 'نوع التحليل غير موجود.' });
    } catch (err) {
        console.error('❌ فشل في جلب نوع التحليل:', err.message);
        res.status(500).json({ error: 'فشل في جلب نوع التحليل.' });
    }
});

// ✅ POST: إضافة نوع تحليل جديد
router.post('/test-types', async (req, res) => {
    try {
        const { test_name, unit, result_type, normal_range_low, normal_range_high, normal_value_text } = req.body;

        if (!test_name || !result_type) {
            return res.status(400).json({ error: 'اسم التحليل ونوع النتيجة مطلوبان.' });
        }

        const sql = `INSERT INTO lab_test_types (test_name, unit, result_type, normal_range_low, normal_range_high, normal_value_text)
                     VALUES (?, ?, ?, ?, ?, ?)`;

        const result = await dbRun(sql, [test_name, unit, result_type, normal_range_low, normal_range_high, normal_value_text]);
        res.status(201).json({ message: '✅ تم إضافة نوع التحليل بنجاح', id: result.lastID });
    } catch (err) {
        console.error('❌ فشل في إضافة نوع التحليل:', err.message);
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'نوع التحليل هذا موجود بالفعل.' });
        }
        res.status(500).json({ error: 'فشل في إضافة نوع التحليل.' });
    }
});

// ✅ PUT: تعديل نوع تحليل
router.put('/test-types/:id', async (req, res) => {
    try {
        const { test_name, unit, result_type, normal_range_low, normal_range_high, normal_value_text } = req.body;
        const { id } = req.params;

        if (!test_name || !result_type) {
            return res.status(400).json({ error: 'اسم التحليل ونوع النتيجة مطلوبان.' });
        }

        const sql = `UPDATE lab_test_types SET test_name = ?, unit = ?, result_type = ?, normal_range_low = ?, normal_range_high = ?, normal_value_text = ? WHERE id = ?`;

        const result = await dbRun(sql, [test_name, unit, result_type, normal_range_low, normal_range_high, normal_value_text, id]);

        if (result.changes === 0) return res.status(404).json({ error: 'نوع التحليل غير موجود.' });

        res.json({ message: '✅ تم تعديل نوع التحليل بنجاح' });
    } catch (err) {
        console.error('❌ فشل في تعديل نوع التحليل:', err.message);
        res.status(500).json({ error: 'فشل في تعديل نوع التحليل.' });
    }
});

// ✅ DELETE: حذف نوع تحليل
router.delete('/test-types/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM lab_test_types WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: 'نوع التحليل غير موجود للحذف.' });

        res.json({ message: '✅ تم حذف نوع التحليل بنجاح.' });
    } catch (err) {
        console.error('❌ فشل في حذف نوع التحليل:', err.message);
        res.status(500).json({ error: 'فشل في حذف نوع التحليل.' });
    }
});

// --- نقاط نهاية إدارة نتائج التحاليل (lab_results) ---

// ✅ GET: جلب نتائج تحليل لمريض معين
router.get('/results/patient/:patientId', async (req, res) => {
    const { patientId } = req.params;
    const { month } = req.query;

    if (!patientId) {
        return res.status(400).json({ error: 'الرجاء تحديد معرف المريض.' });
    }

    let sql = `
        SELECT
            lr.*,
            ttt.test_name,
            ttt.unit,
            ttt.result_type,
            ttt.normal_range_low,
            ttt.normal_range_high,
            ttt.normal_value_text
        FROM
            lab_results lr
        JOIN
            patients p ON lr.patient_id = p.id
        JOIN
            lab_test_types ttt ON lr.test_id = ttt.id
        WHERE
            lr.patient_id = ?
    `;
    const params = [patientId];

    if (month) {
        sql += ` AND strftime('%Y-%m', lr.result_date) = ?`;
        params.push(month);
    }

    sql += ` ORDER BY lr.result_date DESC`;

    try {
        const results = await dbAll(sql, params);
        res.json(results);
    } catch (err) {
        console.error('❌ فشل في جلب نتائج التحاليل للمريض:', err.message);
        res.status(500).json({ error: 'فشل في جلب نتائج التحاليل للمريض.' });
    }
});

// ✅ GET: جلب نتيجة تحليل واحدة
router.get('/results/:id', async (req, res) => {
    try {
        const result = await dbGet(`
            SELECT
                lr.*,
                ttt.test_name,
                ttt.unit,
                ttt.result_type,
                ttt.normal_range_low,
                ttt.normal_range_high,
                ttt.normal_value_text
            FROM
                lab_results lr
            JOIN
                lab_test_types ttt ON lr.test_id = ttt.id
            WHERE
                lr.id = ?
        `, [req.params.id]);
        if (result) res.json(result);
        else res.status(404).json({ error: 'نتيجة التحليل غير موجودة.' });
    } catch (err) {
        console.error('❌ فشل في جلب نتيجة التحليل:', err.message);
        res.status(500).json({ error: 'فشل في جلب نتيجة التحليل.' });
    }
});

// ✅ POST: إضافة نتيجة تحليل جديدة
router.post('/results', async (req, res) => {
    try {
        const { patient_id, test_id, result_value, result_date, notes } = req.body;

        if (!patient_id || !test_id || !result_value || !result_date) {
            return res.status(400).json({ error: 'معرف المريض، نوع التحليل، النتيجة، وتاريخ النتيجة مطلوبة.' });
        }

        const sql = `INSERT INTO lab_results (patient_id, test_id, result_value, result_date, notes) VALUES (?, ?, ?, ?, ?)`;

        const result = await dbRun(sql, [patient_id, test_id, result_value, result_date, notes]);
        res.status(201).json({ message: '✅ تم إضافة نتيجة التحليل بنجاح', id: result.lastID });
    } catch (err) {
        console.error('❌ فشل في إضافة نتيجة التحليل:', err.message);
        res.status(500).json({ error: 'فشل في إضافة نتيجة التحليل.' });
    }
});

// ✅ PUT: تعديل نتيجة تحليل
router.put('/results/:id', async (req, res) => {
    try {
        const { patient_id, test_id, result_value, result_date, notes } = req.body;
        const { id } = req.params;

        if (!test_id || !result_value || !result_date) {
            return res.status(400).json({ error: 'نوع التحليل، النتيجة، وتاريخ النتيجة مطلوبة.' });
        }

        const sql = `UPDATE lab_results SET test_id = ?, result_value = ?, result_date = ?, notes = ? WHERE id = ?`;

        const result = await dbRun(sql, [test_id, result_value, result_date, notes, id]);

        if (result.changes === 0) return res.status(404).json({ error: 'نتيجة التحليل غير موجودة.' });

        res.json({ message: '✅ تم تعديل نتيجة التحليل بنجاح' });
    } catch (err) {
        console.error('❌ فشل في تعديل نتيجة التحليل:', err.message);
        res.status(500).json({ error: 'فشل في تعديل نتيجة التحليل.' });
    }
});

// ✅ DELETE: حذف نتيجة تحليل
router.delete('/results/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM lab_results WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: 'نتيجة التحليل غير موجودة للحذف.' });

        res.json({ message: '✅ تم حذف نتيجة التحليل بنجاح.' });
    } catch (err) {
        console.error('❌ فشل في حذف نتيجة التحليل:', err.message);
        res.status(500).json({ error: 'فشل في حذف نتيجة التحليل.' });
    }
});

router.get('/patient/:patientId', async (req, res) => {
    const { patientId } = req.params;

    try {
        const results = await dbAll(`
            SELECT
                lr.id,
                lr.result_value,
                lr.result_date,
                lr.notes,
                ttt.test_name,
                ttt.unit,
                ttt.normal_range_low,
                ttt.normal_range_high
            FROM
                lab_results lr
            JOIN
                lab_test_types ttt ON lr.test_id = ttt.id
            WHERE
                lr.patient_id = ?
            ORDER BY
                lr.result_date ASC
        `, [patientId]);
        
        res.json(results);

    } catch (err) {
        console.error(`❌ فشل في جلب تحاليل المريض ${patientId}:`, err.message);
        res.status(500).json({ error: 'فشل في جلب بيانات التحاليل', details: err.message });
    }
});

module.exports = router;