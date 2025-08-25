const express = require('express');
const router = express.Router();

const { dbAll, dbGet } = require('../utils/db');

// ✅ تقرير: عدد الجلسات لكل ماكينة
router.get('/sessions-per-machine', async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT m.name AS machine_name, COUNT(s.id) AS session_count
            FROM sessions s
            JOIN machines m ON s.machine_id = m.id
            GROUP BY s.machine_id
            ORDER BY session_count DESC
        `);
        res.json({ data: rows });
    } catch (err) {
        console.error('❌ فشل في توليد التقرير:', err.message);
        res.status(500).json({ error: 'فشل في توليد تقرير الجلسات لكل ماكينة' });
    }
});

// ✅ تقرير: عدد الجلسات لكل مريض
router.get('/sessions-per-patient', async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT p.name AS patient_name, p.medical_id, COUNT(s.id) AS session_count
            FROM sessions s
            JOIN patients p ON s.patient_id = p.id
            GROUP BY s.patient_id
            ORDER BY session_count DESC
        `);
        res.json({ data: rows });
    } catch (err) {
        console.error('❌ فشل في توليد التقرير:', err.message);
        res.status(500).json({ error: 'فشل في توليد تقرير الجلسات لكل مريض' });
    }
});

// ✅ تقرير: ملخص الجلسات في فترة زمنية
router.get('/summary', async (req, res) => {
    const { from, to } = req.query;

    if (!from || !to) {
        return res.status(400).json({ error: 'يرجى تحديد الفترة الزمنية من/إلى' });
    }

    try {
        const totalSessions = await dbGet(`
            SELECT COUNT(*) as total FROM sessions WHERE session_date BETWEEN date(?) AND date(?)
        `, [from, to]);

        const sessionsPerDay = await dbAll(`
            SELECT session_date AS date, COUNT(*) as count FROM sessions
            WHERE session_date BETWEEN date(?) AND date(?)
            GROUP BY session_date
            ORDER BY session_date ASC
        `, [from, to]);

        res.json({
            total_sessions: totalSessions.total,
            sessions_by_date: sessionsPerDay
        });
    } catch (err) {
        console.error('❌ فشل في توليد تقرير الفترة:', err.message);
        res.status(500).json({ error: 'فشل في توليد التقرير' });
    }
});

// ✅ تقرير: متابعة وصيانة الماكينات لفترة معينة
router.get('/machines-maintenance', async (req, res) => {
    const { periodType, reportDate } = req.query;

    if (!periodType || !reportDate) {
        return res.status(400).json({ error: 'الرجاء تحديد نوع الفترة وتاريخ التقرير.' });
    }

    let startDate, endDate;

    try {
        const year = parseInt(reportDate.substring(0, 4));
        let month = 1;

        if (periodType === 'monthly') {
            month = parseInt(reportDate.substring(5, 7));
            startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            endDate = new Date(year, month, 0).toISOString().split('T')[0];
        } else if (periodType === 'quarterly') {
            const quarter = Math.ceil(parseInt(reportDate.substring(5, 7)) / 3);
            month = (quarter - 1) * 3 + 1;
            startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            endDate = new Date(year, month + 3, 0).toISOString().split('T')[0];
        } else if (periodType === 'semi-annually') {
            const half = Math.ceil(parseInt(reportDate.substring(5, 7)) / 6);
            month = (half - 1) * 6 + 1;
            startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            endDate = new Date(year, month + 6, 0).toISOString().split('T')[0];
        } else if (periodType === 'annually') {
            startDate = `${year}-01-01`;
            endDate = `${year}-12-31`;
        } else {
            return res.status(400).json({ error: 'نوع الفترة غير صالح.' });
        }

        const machines = await dbAll(`SELECT id, serial_number, brand, model, ward, internal_unit, status, last_maintenance, notes FROM machines ORDER BY serial_number ASC`);

        const machinesWithMaintenance = [];

        for (const machine of machines) {
            const preventiveMaintenances = await dbAll(`
                SELECT * FROM preventive_maintenances
                WHERE machine_id = ? AND maintenance_date BETWEEN date(?) AND date(?)
                ORDER BY maintenance_date DESC
            `, [machine.id, startDate, endDate]);

            const curativeMaintenances = await dbAll(`
                SELECT * FROM curative_maintenances
                WHERE machine_id = ? AND report_date BETWEEN date(?) AND date(?)
                ORDER BY report_date DESC
            `, [machine.id, startDate, endDate]);

            machinesWithMaintenance.push({
                ...machine,
                preventive_maintenances: preventiveMaintenances,
                curative_maintenances: curativeMaintenances
            });
        }

        res.json({
            periodType,
            reportDate,
            startDate,
            endDate,
            machines: machinesWithMaintenance
        });

    } catch (err) {
        console.error('❌ فشل في توليد تقرير متابعة وصيانة الماكينات:', err.message);
        res.status(500).json({ error: 'فشل في توليد تقرير متابعة وصيانة الماكينات', details: err.message });
    }
});

// ✅ تقرير: جلب بيانات المرضى وكروتهم الشهرية
router.get('/monthly-cards', async (req, res) => {
    const { month } = req.query; // ex: '2025-05'

    if (!month) {
        return res.status(400).json({ error: 'الرجاء تحديد الشهر المطلوب.' });
    }

    try {
        // 1. جلب قائمة ID المرضى الفريدة الذين لديهم جلسات في هذا الشهر
        const patientsWithSessions = await dbAll(
            `SELECT DISTINCT p.id, p.name, p.medical_id 
             FROM patients p
             JOIN sessions s ON p.id = s.patient_id
             WHERE strftime('%Y-%m', s.session_date) = ?
             ORDER BY p.name ASC`,
            [month]
        );

        if (patientsWithSessions.length === 0) {
            return res.json([]); // إرجاع مصفوفة فارغة إذا لم يوجد مرضى
        }

        // 2. لكل مريض، جلب قائمة جلساته في هذا الشهر
        const responseData = [];
        for (const patient of patientsWithSessions) {
            const sessions = await dbAll(
                `SELECT session_date 
                 FROM sessions 
                 WHERE patient_id = ? AND strftime('%Y-%m', session_date) = ?
                 ORDER BY session_date ASC`,
                [patient.id, month]
            );

            // إضافة بيانات المريض وجلساته إلى الاستجابة النهائية
            responseData.push({
                ...patient,
                sessions: sessions.map(s => s.session_date) // إرجاع مصفوفة من تواريخ الجلسات كنصوص
            });
        }

        res.json(responseData);

    } catch (err) {
        console.error('❌ فشل في جلب بيانات الكروت الشهرية:', err.message);
        res.status(500).json({ error: 'فشل في جلب بيانات الكروت الشهرية', details: err.message });
    }
});
router.get('/generate', async (req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ error: 'يجب تحديد تاريخ التقرير.' });
    }

    try {
        // 1. إحصائيات الجلسات لليوم المحدد، مقسمة حسب الوحدة ونوع الفيروس
        const sessionsQuery = `
            SELECT 
                p.dialysis_unit,
                p.virus_status,
                COUNT(s.id) as session_count
            FROM sessions s
            JOIN patients p ON s.patient_id = p.id
            WHERE s.session_date = ? AND p.is_archived = 0
            GROUP BY p.dialysis_unit, p.virus_status
        `;
        const sessionStats = await dbAll(sessionsQuery, [date]);

        // 2. إحصائيات المرضى والماكينات لكل وحدة داخلية
        const patientsQuery = `SELECT dialysis_unit, COUNT(*) as patient_count FROM patients WHERE is_archived = 0 GROUP BY dialysis_unit`;
        const machinesQuery = `SELECT internal_unit, COUNT(*) as machine_count FROM machines GROUP BY internal_unit`;
        
        const patientCounts = await dbAll(patientsQuery);
        const machineCounts = await dbAll(machinesQuery);

        // 3. تجميع كل البيانات في كائن واحد منظم
        const units = {};
        
        // إضافة عدد المرضى
        patientCounts.forEach(pc => {
            if (!pc.dialysis_unit) return;
            if (!units[pc.dialysis_unit]) units[pc.dialysis_unit] = { patient_count: 0, machine_count: 0, sessions: { total: 0, negative: 0, positive_b: 0, positive_c: 0 } };
            units[pc.dialysis_unit].patient_count = pc.patient_count;
        });

        // إضافة عدد الماكينات
        machineCounts.forEach(mc => {
            if (!mc.internal_unit) return;
            if (!units[mc.internal_unit]) units[mc.internal_unit] = { patient_count: 0, machine_count: 0, sessions: { total: 0, negative: 0, positive_b: 0, positive_c: 0 } };
            units[mc.internal_unit].machine_count = mc.machine_count;
        });
        
        // إضافة إحصائيات الجلسات
        let totalSessionsToday = { total: 0, negative: 0, positive_b: 0, positive_c: 0 };
        sessionStats.forEach(ss => {
            if (!ss.dialysis_unit) return;
            if (!units[ss.dialysis_unit]) units[ss.dialysis_unit] = { patient_count: 0, machine_count: 0, sessions: { total: 0, negative: 0, positive_b: 0, positive_c: 0 } };
            
            units[ss.dialysis_unit].sessions.total += ss.session_count;
            totalSessionsToday.total += ss.session_count;

            if (ss.virus_status === 'سلبي') {
                 units[ss.dialysis_unit].sessions.negative += ss.session_count;
                 totalSessionsToday.negative += ss.session_count;
            } else if (ss.virus_status === 'ايجابي فيروس B') {
                 units[ss.dialysis_unit].sessions.positive_b += ss.session_count;
                 totalSessionsToday.positive_b += ss.session_count;
            } else if (ss.virus_status === 'ايجابي فيروس C') {
                 units[ss.dialysis_unit].sessions.positive_c += ss.session_count;
                 totalSessionsToday.positive_c += ss.session_count;
            }
        });

        res.json({
            reportDate: date,
            totalSessions: totalSessionsToday,
            unitDetails: units
        });

    } catch (err) {
        console.error('Error generating daily report:', err);
        res.status(500).json({ error: 'فشل في تحضير التقرير اليومي.', details: err.message });
    }
});


/**
 * ## POST /api/reports/confirm
 * يقوم بحفظ التقرير النهائي المعتمد في قاعدة البيانات (Upsert Logic).
 */
router.post('/confirm', async (req, res) => {
    const { report_date, final_data, user } = req.body;

    if (!report_date || !final_data) {
        return res.status(400).json({ error: 'بيانات التقرير غير مكتملة.' });
    }
    
    const finalDataStr = JSON.stringify(final_data);

    try {
        const existingReport = await dbGet('SELECT id FROM daily_reports WHERE report_date = ?', [report_date]);

        if (existingReport) {
            // تحديث التقرير الموجود
            const updateSql = `UPDATE daily_reports SET report_status = ?, final_data = ?, confirmed_by_user = ?, confirmed_at = CURRENT_TIMESTAMP WHERE id = ?`;
            await dbRun(updateSql, ['CONFIRMED', finalDataStr, user || 'SYSTEM', existingReport.id]);
            res.json({ message: '✅ تم تحديث التقرير اليومي بنجاح.' });
        } else {
            // إضافة تقرير جديد
            const insertSql = `INSERT INTO daily_reports (report_date, report_status, final_data, confirmed_by_user) VALUES (?, ?, ?, ?)`;
            await dbRun(insertSql, [report_date, 'CONFIRMED', finalDataStr, user || 'SYSTEM']);
            res.status(201).json({ message: '✅ تم حفظ التقرير اليومي بنجاح.' });
        }
    } catch (err) {
        console.error('Error confirming daily report:', err);
        res.status(500).json({ error: 'فشل حفظ التقرير في قاعدة البيانات.', details: err.message });
    }
});


/**
 * ## GET /api/reports?date=YYYY-MM-DD
 * يجلب تقريرًا معتمدًا ومحفوظًا مسبقًا من قاعدة البيانات.
 */
router.get('/', async (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'يجب تحديد التاريخ.' });
    try {
        const report = await dbGet('SELECT * FROM daily_reports WHERE report_date = ?', [date]);
        if (report) {
            // تحويل النص المحفوظ إلى JSON قبل إرساله
            report.final_data = JSON.parse(report.final_data);
            res.json(report);
        } else {
            res.status(404).json({ message: 'لا يوجد تقرير معتمد لهذا اليوم.' });
        }
    } catch (err) {
        console.error('Error fetching daily report:', err);
        res.status(500).json({ error: 'فشل في جلب التقرير.', details: err.message });
    }
});
// ✅ تقرير: جلب المرضى الذين لم يحضروا جلسات في شهر معين
// ✅ تقرير: جلب المرضى الذين لم يحضروا جلسات (النسخة النهائية مع فلتر الوحدة الداخلية)
router.get('/missed-sessions', async (req, res) => {
    const { month, dialysis_unit } = req.query; // ✅ تم التعديل ليستقبل dialysis_unit

    if (!month) {
        return res.status(400).json({ error: 'يرجى تحديد الشهر المطلوب للتقرير.' });
    }

    try {
        let sql = `
            SELECT id, name, medical_id, phone, dialysis_unit
            FROM patients
            WHERE
                is_archived = 0
                AND strftime('%Y-%m', added_date) <= ?
                AND id NOT IN (
                    SELECT DISTINCT patient_id
                    FROM sessions
                    WHERE strftime('%Y-%m', session_date) = ?
                )
        `;
        const params = [month, month];

        // ✅ جديد: إضافة شرط فلتر الوحدة الداخلية إذا كانت موجودة
        if (dialysis_unit) {
            sql += ` AND dialysis_unit = ?`;
            params.push(dialysis_unit);
        }

        sql += ` ORDER BY name ASC;`;

        const patientsWhoMissed = await dbAll(sql, params);

        res.json(patientsWhoMissed);

    } catch (err) {
        console.error('❌ فشل في جلب تقرير المتغيبين عن الجلسات:', err.message);
        res.status(500).json({ error: 'فشل في جلب التقرير', details: err.message });
    }
});
module.exports = router;