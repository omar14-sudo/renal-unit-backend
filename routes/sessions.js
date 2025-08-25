const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');

// ✅ GET: كل الجلسات مع بحث وتصفية
router.get('/', async (req, res) => {
    try {
        const { date, patient_id, status, search } = req.query;
        let sql = `SELECT s.*, p.name AS patient_name, p.medical_id FROM sessions s 
                   JOIN patients p ON s.patient_id = p.id`;
        const conditions = [];
        const params = [];

        if (date) {
            conditions.push('s.session_date = ?');
            params.push(date);
        }
        if (patient_id) {
            conditions.push('s.patient_id = ?');
            params.push(patient_id);
        }
        if (status) {
            conditions.push('s.status = ?');
            params.push(status);
        }
        if (search) {
            conditions.push('(p.name LIKE ? OR p.medical_id LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY s.session_date DESC, s.id DESC';

        const rows = await dbAll(sql, params);
        res.json({ data: rows });
    } catch (err) {
        console.error('❌ فشل في جلب الجلسات:', err.message);
        res.status(500).json({ error: 'فشل في جلب الجلسات' });
    }
});


router.get('/by-date/:date', async (req, res) => {
    const { date } = req.params;
    const { virus_status, dialysis_unit } = req.query; // ✅ استقبال فلتر الوحدة الداخلية

    if (!date) {
        return res.status(400).json({ error: 'الرجاء تحديد تاريخ.' });
    }

    try {
        const dayOfWeek = new Date(date).getDay();
        const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayShortName = dayMap[dayOfWeek];

        let withSessionParams = [date];
        let withoutSessionParams = [`%${dayShortName}%`];
        
        let conditions = [];

        if (virus_status) {
            conditions.push('p.virus_status = ?');
            withSessionParams.push(virus_status);
            withoutSessionParams.push(virus_status);
        }
        
        // ✅ جديد: إضافة شرط فلتر الوحدة الداخلية
        if (dialysis_unit) {
            conditions.push('p.dialysis_unit = ?');
            withSessionParams.push(dialysis_unit);
            withoutSessionParams.push(dialysis_unit);
        }

        const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

        const withSession = await dbAll(`
            SELECT p.id, p.name, p.medical_id
            FROM sessions s JOIN patients p ON s.patient_id = p.id
            WHERE s.session_date = date(?) ${whereClause}
            ORDER BY p.name ASC
        `, withSessionParams);

        const withSessionIds = new Set(withSession.map(p => p.id));

        const withoutSession = await dbAll(`
            SELECT id, name, medical_id FROM patients p
            WHERE dialysis_days LIKE ? ${whereClause} AND id NOT IN (SELECT id FROM patients WHERE id IN (${Array.from(withSessionIds).join(',') || '0'}))
            ORDER BY name ASC
        `, withoutSessionParams);

        res.json({
            with_session: withSession,
            without_session: withoutSession
        });

    } catch (err) {
        console.error('❌ فشل في جلب الجلسات حسب التاريخ:', err.message);
        res.status(500).json({ error: 'فشل في جلب الجلسات حسب التاريخ', details: err.message });
    }
});


// =================================================================
// ||   *** START: الكود المصحح والمطور لإضافة جلسة جديدة *** ||
// =================================================================
router.post('/', async (req, res) => {
    // تم حذف time من هنا لأنه غير موجود في الجدول
    const { patient_id, session_date, notes, blood_transfusion_bags = 0 } = req.body;

    if (!patient_id || !session_date) {
        return res.status(400).json({ error: 'الحقول الأساسية مطلوبة: معرف المريض، تاريخ الجلسة.' });
    }

    try {
        // --- القاعدة 1: منع تسجيل جلسات مستقبلية ---
        const today = new Date();
        today.setHours(0, 0, 0, 0); // لضمان المقارنة بالتاريخ فقط
        const sessionDate = new Date(session_date);

        if (sessionDate > today) {
            return res.status(400).json({ error: 'لا يمكن تسجيل جلسات في تاريخ مستقبلي.' });
        }

        // --- القاعدة 2: منع تسجيل أكثر من جلسة في نفس اليوم للمريض ---
        const existingSession = await dbGet('SELECT id FROM sessions WHERE patient_id = ? AND session_date = ?', [patient_id, session_date]);
        if (existingSession) {
            return res.status(409).json({ error: 'يوجد بالفعل جلسة مسجلة لهذا المريض في نفس اليوم.' });
        }

        // --- تم تعديل استعلام الإضافة هنا (حذف عمود time) ---
        const sql = `INSERT INTO sessions (patient_id, session_date, notes, blood_transfusion_bags) 
                     VALUES (?, ?, ?, ?)`;
        
        const result = await dbRun(sql, [patient_id, session_date, notes, blood_transfusion_bags]);
        
        // --- القاعدة 3 (التحذير): سيتم إضافتها لاحقًا إذا احتجنا إليها ---
        // حاليًا، نرسل رسالة نجاح قياسية

        res.status(201).json({ message: '✅ تمت إضافة الجلسة بنجاح', id: result.lastID });

    } catch (err) {
        console.error('❌ فشل في إضافة الجلسة:', err.message);
        // التحقق من نوع الخطأ لإرسال رسالة مناسبة
        if (err.message.includes('SQLITE_ERROR')) {
             res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات أثناء إضافة الجلسة.' });
        } else {
             res.status(500).json({ error: 'فشل في إضافة الجلسة', details: err.message });
        }
    }
});
// =================================================================
// ||    *** END: الكود المصحح والمطور لإضافة جلسة جديدة *** ||
// =================================================================


// ✅ PUT: تعديل جلسة (تم تعديله أيضًا لإزالة عمود time)
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // تم حذف time من هنا
        const { patient_id, session_date, notes, blood_transfusion_bags, machine_id, machine_hours_operated } = req.body;

        // تم تعديل الاستعلام هنا
        const sql = `UPDATE sessions SET patient_id = ?, session_date = ?, notes = ?, blood_transfusion_bags = ?, machine_id = ?, machine_hours_operated = ? WHERE id = ?`;

        const result = await dbRun(sql, [patient_id, session_date, notes, blood_transfusion_bags, machine_id, machine_hours_operated, id]);
        if (result.changes === 0) return res.status(404).json({ error: 'الجلسة غير موجودة.' });

        res.json({ message: '✅ تم تحديث الجلسة بنجاح' });
    } catch (err) {
        console.error('❌ فشل في تحديث الجلسة:', err.message);
        res.status(500).json({ error: 'فشل في تحديث الجلسة', details: err.message });
    }
});


// ✅ PUT: تعديل جلسة من صفحة المرضى (نقل دم وملاحظات)
router.put('/transfusion/:id', async (req, res) => {
    const { id } = req.params;
    const { blood_transfusion_bags, notes } = req.body;

    if (blood_transfusion_bags === undefined || notes === undefined) {
        return res.status(400).json({ error: 'الرجاء توفير عدد أكياس الدم والملاحظات.' });
    }
    
    // التحقق من أن عدد الأكياس هو رقم صحيح وموجب
    const bags = Number(blood_transfusion_bags);
    if (!Number.isInteger(bags) || bags < 0) {
        return res.status(400).json({ error: 'عدد أكياس الدم يجب أن يكون رقمًا صحيحًا وموجبًا.' });
    }

    try {
        const sql = `UPDATE sessions SET blood_transfusion_bags = ?, notes = ? WHERE id = ?`;
        const result = await dbRun(sql, [bags, notes, id]);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'الجلسة المحددة غير موجودة.' });
        }
        res.json({ message: '✅ تم تحديث بيانات الجلسة بنجاح.' });
    } catch (err) {
        console.error('❌ فشل في تحديث بيانات نقل الدم:', err.message);
        res.status(500).json({ error: 'فشل في تحديث بيانات الجلسة.' });
    }
});


// ✅ DELETE: حذف جلسة
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await dbRun(`DELETE FROM sessions WHERE id = ?`, [id]);

        if (result.changes === 0) return res.status(404).json({ error: 'الجلسة غير موجودة للحذف.' });

        res.json({ message: '✅ تم حذف الجلسة بنجاح' });
    } catch (err) {
        console.error('❌ فشل في حذف الجلسة:', err.message);
        res.status(500).json({ error: 'فشل في حذف الجلسة' });
    }
});

// ✅ GET: جلب جلسات مريض معين حسب الشهر (للاستخدام في patients.html)
router.get('/patient/:patientId', async (req, res) => {
    const { patientId } = req.params;
    const { month } = req.query;

    if (!patientId) {
        return res.status(400).json({ error: 'الرجاء تحديد معرف المريض.' });
    }

    let sql = `SELECT * FROM sessions WHERE patient_id = ?`;
    const params = [patientId];

    if (month) {
        sql += ` AND strftime('%Y-%m', session_date) = ?`;
        params.push(month);
    }

    sql += ` ORDER BY session_date DESC`;

    try {
        const sessions = await dbAll(sql, params);
        res.json(sessions);
    } catch (err) {
        console.error('❌ فشل في جلب جلسات المريض:', err.message);
        res.status(500).json({ error: 'فشل في جلب جلسات المريض', details: err.message });
    }
});

// ✅ POST: تحديث الجلسات لمريض في تاريخ معين (إضافة/إزالة) من manage-sessions.html
router.post('/update-by-date', async (req, res) => {
    const { date, added, removed } = req.body;

    if (!date || (!added && !removed)) {
        return res.status(400).json({ error: 'الرجاء توفير تاريخ وقائمة مرضى للإضافة أو الإزالة.' });
    }

    let addedCount = 0;
    let removedCount = 0;

    try {
        if (removed && removed.length > 0) {
            for (const patientId of removed) {
                const deleteResult = await dbRun(`DELETE FROM sessions WHERE patient_id = ? AND session_date = date(?)`, [patientId, date]);
                if (deleteResult.changes > 0) removedCount += deleteResult.changes;
            }
        }

        if (added && added.length > 0) {
            for (const patientId of added) {
                const existingSession = await dbGet(`SELECT id FROM sessions WHERE patient_id = ? AND session_date = date(?)`, [patientId, date]);
                if (!existingSession) {
                    const insertResult = await dbRun(`INSERT INTO sessions (patient_id, session_date) VALUES (?, ?)`, [patientId, date]);
                    if (insertResult.changes > 0) addedCount += insertResult.changes;
                }
            }
        }

        res.json({
            message: `✅ تم تحديث الجلسات بنجاح. تمت إضافة ${addedCount} جلسة وحذف ${removedCount} جلسة.`,
            addedCount,
            removedCount
        });

    } catch (err) {
        console.error('❌ فشل في تحديث الجلسات حسب التاريخ:', err.message);
        res.status(500).json({ error: 'فشل في تحديث الجلسات حسب التاريخ', details: err.message });
    }
});

// نقطة نهاية لمعالجة تسجيلات الجلسات المتعددة (من sessions.html)
router.post('/bulk', async (req, res) => {
    const { session_date, sessions_data } = req.body;

    if (!session_date || !sessions_data || !Array.isArray(sessions_data)) {
        return res.status(400).json({ error: 'الرجاء توفير تاريخ الجلسة وبيانات الجلسات كقائمة.' });
    }

    let updatedCount = 0;
    let addedCount = 0;
    let failedEntries = [];

    try {
        for (const session of sessions_data) {
            const { patient_id, shift, machine_id, machine_hours_operated } = session;

            if (!patient_id) {
                failedEntries.push({ patient_id, reason: 'معرف المريض مفقود.' });
                continue;
            }

            try {
                const existingSession = await dbGet(`SELECT id FROM sessions WHERE patient_id = ? AND session_date = date(?)`, [patient_id, session_date]);

                if (existingSession) {
                    const updateSql = `UPDATE sessions SET shift = ?, machine_id = ?, machine_hours_operated = ? WHERE id = ?`;
                    await dbRun(updateSql, [shift, machine_id, machine_hours_operated, existingSession.id]);
                    updatedCount++;
                } else {
                    const insertSql = `INSERT INTO sessions (patient_id, session_date, shift, machine_id, machine_hours_operated) VALUES (?, ?, ?, ?, ?)`;
                    await dbRun(insertSql, [patient_id, session_date, shift, machine_id, machine_hours_operated]);
                    addedCount++;
                }
            } catch (entryErr) {
                failedEntries.push({ patient_id, reason: entryErr.message });
                console.error(`Error processing session for patient ${patient_id}:`, entryErr.message);
            }
        }

        let message = `✅ تم معالجة ${addedCount + updatedCount} جلسة بنجاح.`;
        if (failedEntries.length > 0) {
            message += ` ⚠️ فشل معالجة ${failedEntries.length} جلسة.`;
            return res.status(200).json({ message: message, details: failedEntries });
        }

        res.json({ message: message });

    } catch (err) {
        console.error('❌ فشل في معالجة الجلسات بالجملة:', err.message);
        res.status(500).json({ error: 'فشل في معالجة الجلسات بالجملة', details: err.message });
    }
});



module.exports = router;