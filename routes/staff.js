const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');

// ✅ GET: كل الموظفين (تم تطويره ليدعم البحث والتقسيم)
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 15, search = '', employment_status = '' } = req.query;
        const offset = (page - 1) * limit;

        let conditions = [];
        const params = [];

        if (search) {
            conditions.push(`(name LIKE ? OR national_id LIKE ?)`);
            params.push(`%${search}%`, `%${search}%`);
        }

        // ✅ إضافة شرط الفلترة بحالة التوظيف
        if (employment_status) {
            conditions.push(`employment_status = ?`);
            params.push(employment_status);
        }
        
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const dataSql = `SELECT * FROM staff ${whereClause} ORDER BY name ASC LIMIT ? OFFSET ?`;
        const countSql = `SELECT COUNT(*) as total FROM staff ${whereClause}`;

        const rows = await dbAll(dataSql, [...params, parseInt(limit), offset]);
        const countRow = await dbGet(countSql, params);

        res.json({ data: rows, total: countRow.total, totalPages: Math.ceil(countRow.total / limit) });

    } catch (err) {
        console.error('❌ فشل في جلب الموظفين:', err.message);
        res.status(500).json({ error: 'فشل في جلب الموظفين' });
    }
});

// ✅ GET: موظف واحد
router.get('/:id', async (req, res) => {
    try {
        const row = await dbGet('SELECT * FROM staff WHERE id = ?', [req.params.id]);
        if (row) res.json(row);
        else res.status(404).json({ error: 'الموظف غير موجود.' });
    } catch (err) {
        console.error('❌ فشل في جلب الموظف:', err.message);
        res.status(500).json({ error: 'فشل في جلب بيانات الموظف' });
    }
});


// =================================================================
// ||   *** START: الكود المصحح والمطور لإضافة موظف *** ||
// =================================================================
// ✅ POST: إضافة موظف (تم تحديثه ليشمل كل الحقول الجديدة)
router.post('/', async (req, res) => {
    try {
        // استقبال كل البيانات من النموذج الجديد
        const {
            name, national_id, phone, address, job_title, specialization,
            employment_status, appointment_date, work_start_date, grade, default_shift
        } = req.body;

        // التحقق من الحقول الأساسية الجديدة
        if (!name || !job_title || !grade) {
            return res.status(400).json({ error: 'الاسم، المسمى الوظيفي، والدرجة هي حقول مطلوبة.' });
        }

        const sql = `
            INSERT INTO staff (
                name, national_id, phone, address, job_title, specialization, 
                employment_status, appointment_date, work_start_date, grade, default_shift
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const result = await dbRun(sql, [
            name, national_id, phone, address, job_title, specialization,
            employment_status, appointment_date, work_start_date, grade, default_shift
        ]);

        res.status(201).json({ message: 'تم إضافة الموظف بنجاح', id: result.lastID });
    } catch (err) {
        console.error('❌ فشل في إضافة الموظف:', err.message);
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'الرقم القومي موجود بالفعل لموظف آخر.' });
        }
        res.status(500).json({ error: 'فشل في إضافة الموظف' });
    }
});
// =================================================================
// ||    *** END: الكود المصحح والمطور لإضافة موظف *** ||
// =================================================================


// ✅ PUT: تعديل بيانات موظف (تم تحديثه ليشمل كل الحقول الجديدة)
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name, national_id, phone, address, job_title, specialization,
            employment_status, appointment_date, work_start_date, grade, default_shift
        } = req.body;
        
        if (!name || !job_title || !grade) {
            return res.status(400).json({ error: 'الاسم، المسمى الوظيفي، والدرجة هي حقول مطلوبة.' });
        }

        const sql = `
            UPDATE staff SET 
                name = ?, national_id = ?, phone = ?, address = ?, job_title = ?, 
                specialization = ?, employment_status = ?, appointment_date = ?, 
                work_start_date = ?, grade = ?, default_shift = ?
            WHERE id = ?
        `;
        
        const result = await dbRun(sql, [
            name, national_id, phone, address, job_title, specialization,
            employment_status, appointment_date, work_start_date, grade, default_shift, id
        ]);

        if (result.changes === 0) return res.status(404).json({ error: 'الموظف غير موجود.' });

        res.json({ message: 'تم تعديل بيانات الموظف بنجاح' });
    } catch (err) {
        console.error('❌ فشل في تعديل الموظف:', err.message);
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'الرقم القومي موجود بالفعل لموظف آخر.' });
        }
        res.status(500).json({ error: 'فشل في تعديل الموظف' });
    }
});

// ✅ DELETE: حذف موظف
router.delete('/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM staff WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: 'الموظف غير موجود.' });

        res.json({ message: 'تم حذف الموظف بنجاح' });
    } catch (err) {
        console.error('❌ فشل في حذف الموظف:', err.message);
        res.status(500).json({ error: 'فشل في حذف الموظف' });
    }
});


router.post('/shift-change', async (req, res) => {
    const { staff_id, shift_date, new_shift_type, substitute_staff_id, notes } = req.body;

    if (!staff_id || !shift_date || !new_shift_type) {
        return res.status(400).json({ error: 'الرجاء توفير الموظف، تاريخ الوردية، ونوع الوردية الجديد.' });
    }

    // نستخدم INSERT OR REPLACE للاستفادة من قيد UNIQUE(staff_id, shift_date)
    // إذا كان هناك تغيير مسجل بالفعل لنفس الموظف في نفس اليوم، سيتم استبداله بالجديد.
    const sql = `
        INSERT OR REPLACE INTO shift_changes (staff_id, shift_date, new_shift_type, substitute_staff_id, notes)
        VALUES (?, ?, ?, ?, ?)
    `;

    try {
        await dbRun(sql, [staff_id, shift_date, new_shift_type, substitute_staff_id || null, notes]);
        res.status(201).json({ message: '✅ تم تسجيل تغيير الوردية بنجاح.' });
    } catch (err) {
        console.error('❌ فشل في تسجيل تغيير الوردية:', err.message);
        res.status(500).json({ error: 'فشل في تسجيل تغيير الوردية', details: err.message });
    }
});
router.get('/job-titles/all', async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT DISTINCT job_title 
            FROM staff 
            WHERE job_title IS NOT NULL AND job_title != '' 
            ORDER BY job_title ASC
        `);
        // إرجاع مصفوفة من النصوص مباشرة
        res.json(rows.map(row => row.job_title));
    } catch (err) {
        console.error('❌ فشل في جلب المسميات الوظيفية:', err.message);
        res.status(500).json({ error: 'فشل في جلب المسميات الوظيفية' });
    }
});
module.exports = router;