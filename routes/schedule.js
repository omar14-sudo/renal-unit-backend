const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');

// نقطة النهاية: GET /api/schedule/daily
router.get('/daily', async (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'الرجاء تحديد تاريخ (date).' });
    try {
        const allPatients = await dbAll('SELECT id, name, medical_id, dialysis_days, dialysis_shift FROM patients ORDER BY name ASC');
        const scheduledSessions = await dbAll(`
            SELECT ss.patient_id, ss.machine_id, ss.shift, p.name AS patient_name,
                   p.medical_id, p.dialysis_days, p.dialysis_shift, m.serial_number AS machine_serial_number,
                   m.ward AS machine_ward, m.internal_unit AS machine_internal_unit
            FROM session_schedule ss
            JOIN patients p ON ss.patient_id = p.id
            LEFT JOIN machines m ON ss.machine_id = m.id
            WHERE ss.schedule_date = date(?)
        `, [date]);
        const scheduledPatients = scheduledSessions.map(s => ({
            id: s.patient_id, name: s.patient_name, medical_id: s.medical_id,
            dialysis_days: s.dialysis_days, dialysis_shift: s.dialysis_shift, machine_id: s.machine_id,
            machine_serial_number: s.machine_serial_number, machine_ward: s.machine_ward,
            machine_internal_unit: s.machine_internal_unit, shift: s.shift
        }));
        const scheduledPatientIds = new Set(scheduledPatients.map(p => p.id));
        const unscheduledPatients = allPatients.filter(p => !scheduledPatientIds.has(p.id));
        const allMachines = await dbAll('SELECT id, serial_number, ward, internal_unit, status FROM machines WHERE status = "نشط" OR status = "تحت الصيانة"');
        res.json({ scheduledPatients, unscheduledPatients, allMachines });
    } catch (err) {
        console.error('❌ فشل في جلب جدول الجلسات اليومي:', err.message);
        res.status(500).json({ error: 'فشل في جلب جدول الجلسات اليومي', details: err.message });
    }
});

// نقطة النهاية: GET /api/schedule/weekly
router.get('/weekly', async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'الرجاء تحديد تاريخي بداية ونهاية.' });
    try {
        const schedule = await dbAll(`
            SELECT ss.id, ss.patient_id, ss.machine_id, ss.schedule_date, ss.shift, ss.notes,
                   p.name AS patient_name, p.medical_id, p.virus_status, m.serial_number AS machine_serial_number,
                   m.ward AS machine_ward, m.internal_unit AS machine_internal_unit
            FROM session_schedule ss
            JOIN patients p ON ss.patient_id = p.id
            JOIN machines m ON ss.machine_id = m.id
            WHERE ss.schedule_date BETWEEN date(?) AND date(?)
            ORDER BY ss.schedule_date ASC, ss.shift ASC
        `, [startDate, endDate]);
        const machines = await dbAll('SELECT id, serial_number, brand, model, ward, internal_unit, status FROM machines ORDER BY serial_number ASC');
        const scheduledPatientIdsInPeriod = new Set(schedule.map(s => s.patient_id));
        const allPatients = await dbAll('SELECT id, name, medical_id, virus_status FROM patients ORDER BY name ASC');
        const trulyUnscheduled = allPatients.filter(p => !scheduledPatientIdsInPeriod.has(p.id));
        res.json({ schedule, machines, unscheduled_patients: trulyUnscheduled });
    } catch (err) {
        console.error('❌ فشل في جلب جدول الجلسات الأسبوعي:', err.message);
        res.status(500).json({ error: 'فشل في جلب جدول الجلسات الأسبوعي', details: err.message });
    }
});

// نقطة النهاية: POST /api/schedule/entry (لإنشاء حجز جديد)
router.post('/entry', async (req, res) => {
    const { patient_id, machine_id, schedule_date, shift, notes } = req.body;
    if (!patient_id || !machine_id || !schedule_date || !shift) return res.status(400).json({ error: 'الرجاء توفير البيانات المطلوبة.' });
    try {
        const existingBooking = await dbGet('SELECT * FROM session_schedule WHERE machine_id = ? AND schedule_date = ? AND shift = ?', [machine_id, schedule_date, shift]);
        if (existingBooking) return res.status(409).json({ error: 'الماكينة محجوزة بالفعل.' });
        const existingPatientBooking = await dbGet('SELECT * FROM session_schedule WHERE patient_id = ? AND schedule_date = ?', [patient_id, schedule_date]);
        if (existingPatientBooking) return res.status(409).json({ error: 'المريض لديه حجز بالفعل في هذا التاريخ.' });
        const result = await dbRun('INSERT INTO session_schedule (patient_id, machine_id, schedule_date, shift, notes) VALUES (?, ?, ?, ?, ?)', [patient_id, machine_id, schedule_date, shift, notes]);
        res.status(201).json({ message: '✅ تم حجز الموعد بنجاح', id: result.lastID });
    } catch (err) {
        console.error('❌ فشل في حجز الموعد:', err.message);
        res.status(500).json({ error: 'فشل في حجز الموعد', details: err.message });
    }
});

// نقطة النهاية: DELETE /api/schedule/entry/:id (لإلغاء حجز)
router.delete('/entry/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await dbRun('DELETE FROM session_schedule WHERE id = ?', [id]);
        if (result.changes === 0) return res.status(404).json({ error: 'الحجز غير موجود.' });
        res.json({ message: '✅ تم إلغاء الحجز بنجاح.' });
    } catch (err) {
        console.error('❌ فشل في إلغاء الحجز:', err.message);
        res.status(500).json({ error: 'فشل في إلغاء الحجز', details: err.message });
    }
});

// نقطة النهاية: GET /api/schedule/predicted-roster
router.get('/predicted-roster', async (req, res) => {
    const { month, dialysis_unit } = req.query;
    if (!month) return res.status(400).json({ error: 'الرجاء تحديد الشهر.' });
    try {
        let query = `SELECT id, name, dialysis_days FROM patients WHERE referral_expiry >= date('now') AND dialysis_days IS NOT NULL AND dialysis_days != ''`;
        const params = [];

        if (dialysis_unit) {
            query += ` AND dialysis_unit = ?`;
            params.push(dialysis_unit);
        }

        query += ` ORDER BY name ASC`;

        const activePatientsWithSchedule = await dbAll(query, params);
        const actualSessionsInMonth = await dbAll(`SELECT patient_id, session_date FROM sessions WHERE strftime('%Y-%m', session_date) = ?`, [month]);
        res.json({ patients: activePatientsWithSchedule, sessions: actualSessionsInMonth });
    } catch (err) {
        console.error('❌ فشل في جلب بيانات الجدول المتوقع:', err.message);
        res.status(500).json({ error: 'فشل في جلب البيانات', details: err.message });
    }
});

// =================================================================
// ||   *** START: الكود الجديد لتسجيل الجلسات المتوقعة *** ||
// =================================================================
router.post('/record-predicted-sessions', async (req, res) => {
    const { sessions } = req.body;

    if (!sessions || !Array.isArray(sessions) || sessions.length === 0) {
        return res.status(400).json({ error: 'لا توجد جلسات لتسجيلها.' });
    }

    let addedCount = 0;
    let failedCount = 0;
    const errors = [];

    // استخدام حلقة for...of لضمان تنفيذ العمليات بشكل تسلسلي
    for (const session of sessions) {
        const { patient_id, session_date } = session;

        try {
            // التحقق مرة أخرى من عدم وجود الجلسة قبل إضافتها
            const existing = await dbGet('SELECT id FROM sessions WHERE patient_id = ? AND session_date = ?', [patient_id, session_date]);
            if (!existing) {
                await dbRun('INSERT INTO sessions (patient_id, session_date) VALUES (?, ?)', [patient_id, session_date]);
                addedCount++;
            }
        } catch (err) {
            failedCount++;
            errors.push(`فشل تسجيل جلسة للمريض ${patient_id} بتاريخ ${session_date}: ${err.message}`);
            console.error(`Error recording session for patient ${patient_id} on ${session_date}:`, err.message);
        }
    }

    if (failedCount > 0) {
        return res.status(500).json({ error: `فشل تسجيل ${failedCount} جلسة.`, details: errors });
    }

    res.status(201).json({ message: `تم تسجيل ${addedCount} جلسة بنجاح.` });
});
// =================================================================
// ||    *** END: الكود الجديد لتسجيل الجلسات المتوقعة *** ||
// =================================================================
// =================================================================
// ||   *** START: الكود الجديد لعكس حالة الجلسة الواحدة *** ||
// =================================================================
router.post('/toggle-session', async (req, res) => {
    const { patient_id, session_date } = req.body;

    if (!patient_id || !session_date) {
        return res.status(400).json({ error: 'بيانات الجلسة غير مكتملة.' });
    }

    try {
        // تحقق إذا كانت الجلسة موجودة بالفعل
        const existingSession = await dbGet('SELECT id FROM sessions WHERE patient_id = ? AND session_date = ?', [patient_id, session_date]);

        if (existingSession) {
            // إذا كانت موجودة، قم بحذفها
            await dbRun('DELETE FROM sessions WHERE id = ?', [existingSession.id]);
            res.json({ status: 'deleted', message: 'تم حذف تسجيل الجلسة.' });
        } else {
            // إذا لم تكن موجودة، قم بإضافتها
            const result = await dbRun('INSERT INTO sessions (patient_id, session_date) VALUES (?, ?)', [patient_id, session_date]);
            res.status(201).json({ status: 'created', message: 'تم تسجيل الجلسة بنجاح.', new_id: result.lastID });
        }
    } catch (err) {
        console.error('❌ فشل في عكس حالة الجلسة:', err.message);
        res.status(500).json({ error: 'فشل في تحديث حالة الجلسة', details: err.message });
    }
});
// =================================================================
// ||    *** END: الكود الجديد لعكس حالة الجلسة الواحدة *** ||
//
module.exports = router;