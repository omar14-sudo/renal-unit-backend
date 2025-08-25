const express = require('express');
const router = express.Router();
const { dbAll } = require('../utils/db');

// ✅ GET: جلب نتائج التحاليل المخبرية الحرجة
router.get('/critical-labs', async (req, res) => {
    try {
        const criticalResults = await dbAll(`
            SELECT
                lr.id,
                lr.patient_id,
                lr.test_id,
                lr.result_value,
                lr.result_date,
                p.name AS patient_name,
                p.medical_id,
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
                (ttt.result_type = 'number' AND
                 (CAST(lr.result_value AS REAL) < ttt.normal_range_low OR
                  CAST(lr.result_value AS REAL) > ttt.normal_range_high))
                OR
                (ttt.result_type = 'text' AND ttt.normal_value_text IS NOT NULL AND
                 LOWER(TRIM(lr.result_value)) != LOWER(TRIM(ttt.normal_value_text)))
            ORDER BY
                lr.result_date DESC, patient_name ASC
            LIMIT 20;
        `);

        res.json(criticalResults);
    } catch (err) {
        console.error('❌ فشل في جلب تنبيهات التحاليل الحرجة:', err.message);
        res.status(500).json({ error: 'فشل في جلب تنبيهات التحاليل الحرجة', details: err.message });
    }
});

module.exports = router;