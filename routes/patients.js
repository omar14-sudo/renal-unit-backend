const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');
const ExcelJS = require('exceljs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { protect } = require('../middleware/auth');

const upload = multer({ dest: 'uploads/' });

// ✅ GET: جلب قائمة المرضى (تم تحديثه ليدعم فلتر اليوم وحساب العمر)
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 15, search = '', referral_place = '', status = '', dialysis_day = '', dialysis_unit = '', all = 'false' } = req.query;

        if (all === 'true') {
            const allPatients = await dbAll(`
                SELECT id, name, medical_id, referral_expiry,
                       CASE
                           WHEN dob IS NOT NULL AND dob != ''
                           THEN CAST(strftime('%Y', 'now') - strftime('%Y', dob) - 
                                    (CASE WHEN strftime('%m%d', 'now') < strftime('%m%d', dob) THEN 1 ELSE 0 END) AS INTEGER)
                           ELSE NULL
                       END AS age
                FROM patients ORDER BY name ASC
            `);
            return res.json({ data: allPatients });
        }

        const offset = (page - 1) * limit;
        let whereClauses = [];
        let params = [];

        if (search) {
            whereClauses.push(`(name LIKE ? OR medical_id LIKE ? OR national_id LIKE ?)`);
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (referral_place) {
            whereClauses.push(`referral_place LIKE ?`);
            params.push(`%${referral_place}%`);
        }
        
        if (dialysis_day) {
            whereClauses.push(`dialysis_days LIKE ?`);
            params.push(`%${dialysis_day}%`);
        }

        if (dialysis_unit) {
            whereClauses.push(`dialysis_unit = ?`);
            params.push(dialysis_unit);
        }

        if (status) {
            const today = new Date().toISOString().split('T')[0];
            const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            if (status === 'active') { whereClauses.push(`referral_expiry >= date(?)`); params.push(today); }
            else if (status === 'expiring') { whereClauses.push(`referral_expiry BETWEEN date(?) AND date(?)`); params.push(today, thirtyDaysFromNow); }
            else if (status === 'expired') { whereClauses.push(`referral_expiry < date(?)`); params.push(today); }
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const dataSql = `
            SELECT *, 
                   CASE
                       WHEN dob IS NOT NULL AND dob != ''
                       THEN CAST(strftime('%Y', 'now') - strftime('%Y', dob) - 
                                (CASE WHEN strftime('%m%d', 'now') < strftime('%m%d', dob) THEN 1 ELSE 0 END) AS INTEGER)
                       ELSE NULL
                   END AS age
            FROM patients ${whereSql} ORDER BY name ASC LIMIT ? OFFSET ?
        `;
        const countSql = `SELECT COUNT(*) as total FROM patients ${whereSql}`;

        const rows = await dbAll(dataSql, [...params, parseInt(limit), offset]);
        const countRow = await dbGet(countSql, params);

        res.json({ data: rows, total: countRow.total, page: parseInt(page), totalPages: Math.ceil(countRow.total / limit) });
    } catch (err) {
        console.error('❌ خطأ في جلب قائمة المرضى:', err.message);
        res.status(500).json({ error: 'فشل في جلب قائمة المرضى' });
    }
});

// ✅ GET: حسب تاريخ الإضافة
router.get('/by-added-date', async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'يجب تحديد تاريخ البداية والنهاية.' });
    }
    try {
        const sql = `SELECT id, name, medical_id, added_date FROM patients WHERE added_date BETWEEN date(?) AND date(?) ORDER BY added_date DESC`;
        const rows = await dbAll(sql, [startDate, endDate]);
        res.json({ data: rows });
    } catch (err) {
        console.error('❌ فشل في جلب المرضى الجدد:', err.message);
        res.status(500).json({ error: 'فشل في جلب قائمة المرضى الجدد.' });
    }
});

// ✅ GET: مريض واحد
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const patient = await dbGet(`
            SELECT *, 
                   CASE
                       WHEN dob IS NOT NULL AND dob != ''
                       THEN CAST(strftime('%Y', 'now') - strftime('%Y', dob) - 
                                (CASE WHEN strftime('%m%d', 'now') < strftime('%m%d', dob) THEN 1 ELSE 0 END) AS INTEGER)
                       ELSE NULL
                   END AS age
            FROM patients WHERE id = ?
        `, [id]);
        if (patient) res.json(patient);
        else res.status(404).json({ error: 'المريض غير موجود.' });
    } catch (err) {
        console.error('❌ خطأ في جلب بيانات مريض واحد:', err.message);
        res.status(500).json({ error: 'فشل في جلب بيانات المريض' });
    }
});

// ✅ POST: إضافة مريض
router.post('/', async (req, res) => {
    const { name, medical_id, national_id, phone, address, added_date, referral_date, referral_duration_months, referral_place, dialysis_unit, blood_type, chronic_diseases, virus_status, dob, gender, patient_notes, dialysis_days, dialysis_shift } = req.body;

    if (!name || !medical_id || !added_date || !referral_date || !dialysis_unit || !virus_status) {
        return res.status(400).json({ error: 'الحقول الأساسية مطلوبة.' });
    }

    const duration = parseInt(referral_duration_months, 10) || 12;
    const expiryDate = new Date(referral_date);
    expiryDate.setMonth(expiryDate.getMonth() + duration);
    const referral_expiry = expiryDate.toISOString().split('T')[0];

    const sql = `INSERT INTO patients (name, medical_id, national_id, phone, address, added_date, referral_date, referral_expiry, referral_place, dialysis_unit, blood_type, chronic_diseases, virus_status, dob, gender, patient_notes, dialysis_days, dialysis_shift) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    try {
        const result = await dbRun(sql, [name, medical_id, national_id, phone, address, added_date, referral_date, referral_expiry, referral_place, dialysis_unit, blood_type, chronic_diseases, virus_status, dob, gender, patient_notes, dialysis_days, dialysis_shift]);
        res.status(201).json({ message: "✅ تم إضافة المريض بنجاح", id: result.lastID });
    } catch (err) {
        console.error('❌ فشل إضافة المريض:', err.message);
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'الرقم الطبي أو القومي موجود بالفعل لمريض آخر.' });
        }
        res.status(500).json({ error: 'فشل إضافة المريض.' });
    }
});

// ✅ PUT: تعديل مريض
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, phone, address, added_date, referral_date, referral_duration_months, referral_place, dialysis_unit, blood_type, chronic_diseases, virus_status, patient_notes, dialysis_days, dialysis_shift } = req.body;

    if (!name || !added_date || !referral_date || !dialysis_unit || !virus_status) {
        return res.status(400).json({ error: 'الحقول الأساسية مطلوبة.' });
    }

    const duration = parseInt(referral_duration_months, 10) || 12;
    const expiryDate = new Date(referral_date);
    expiryDate.setMonth(expiryDate.getMonth() + duration);
    const referral_expiry = expiryDate.toISOString().split('T')[0];

    const sql = `UPDATE patients SET name = ?, phone = ?, address = ?, added_date = ?, referral_date = ?, referral_expiry = ?, referral_place = ?, dialysis_unit = ?, blood_type = ?, chronic_diseases = ?, virus_status = ?, patient_notes = ?, dialysis_days = ?, dialysis_shift = ? WHERE id = ?`;

    try {
        const result = await dbRun(sql, [name, phone, address, added_date, referral_date, referral_expiry, referral_place, dialysis_unit, blood_type, chronic_diseases, virus_status, patient_notes, dialysis_days, dialysis_shift, id]);
        if (result.changes === 0) return res.status(404).json({ error: 'المريض غير موجود.' });
        res.json({ message: "✅ تم تحديث بيانات المريض بنجاح" });
    } catch (err) {
        console.error('❌ فشل في تعديل بيانات المريض:', err.message);
        res.status(500).json({ error: 'فشل في تعديل البيانات.' });
    }
});

// ✅ DELETE: حذف مريض
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const sql = `DELETE FROM patients WHERE id = ?`;
    try {
        const result = await dbRun(sql, [id]);
        if (result.changes === 0) return res.status(404).json({ error: 'المريض غير موجود للحذف.' });
        res.json({ message: '✅ تم حذف المريض بنجاح.' });
    } catch (err) {
        console.error('❌ فشل حذف المريض:', err.message);
        res.status(500).json({ error: 'فشل حذف المريض.' });
    }
});

// ✅ GET: تنزيل نموذج Excel للمرضى
router.get('/template/download', async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Patients');

    worksheet.columns = [
        { header: 'الاسم الكامل*', key: 'name', width: 30 },
        { header: 'الرقم الطبي*', key: 'medical_id', width: 20 },
        { header: 'الرقم القومي*', key: 'national_id', width: 20 },
        { header: 'تاريخ الميلاد (YYYY-MM-DD)', key: 'dob', width: 20 },
        { header: 'الجنس (ذكر/أنثى)', key: 'gender', width: 15 },
        { header: 'فصيلة الدم (A+,O-..)', key: 'blood_type', width: 15 },
        { header: 'رقم الهاتف', key: 'phone', width: 20 },
        { header: 'العنوان', key: 'address', width: 30 },
        { header: 'تاريخ الإضافة (YYYY-MM-DD)*', key: 'added_date', width: 25 },
        { header: 'تاريخ الإحالة (YYYY-MM-DD)*', key: 'referral_date', width: 25 },
        { header: 'مكان الإحالة (الجهة الخارجية)', key: 'referral_place', width: 30 },
        { header: 'الوحدة الداخلية* (مستشفى طيبة/وحدة الكلى القديمة/وحدة كلى الكيمان)', key: 'dialysis_unit', width: 40 },
        { header: 'حالة الفيروسات* (سلبي/ايجابي فيروس C/ايجابي فيروس B/الجراي زون)', key: 'virus_status', width: 45 },
        { header: 'الأمراض المزمنة (فاصلة بين كل مرض)', key: 'chronic_diseases', width: 30 },
        { header: 'أيام الغسيل الثابتة (Sat,Sun,Mon,Tue,Wed,Thu مفصولة بفاصلة)', key: 'dialysis_days', width: 50 },
        { header: 'الشفت (1,2,3,4)', key: 'dialysis_shift', width: 15 },
        { header: 'ملاحظات المريض', key: 'patient_notes', width: 40 }
    ];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=' + encodeURIComponent('patients_template.xlsx'));

    await workbook.xlsx.write(res);
    res.end();
});

// ✅ POST: استيراد بيانات المرضى من ملف Excel
router.post('/import', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'الرجاء تحميل ملف Excel.' });
    }

    const filePath = req.file.path;
    const workbook = new ExcelJS.Workbook();
    let importedCount = 0;
    let failedEntries = [];

    try {
        await workbook.xlsx.readFile(filePath);
        const worksheet = workbook.getWorksheet(1);

        const rows = worksheet.getSheetValues();
        rows.shift();

        for (const rowData of rows) {
            if (!rowData || rowData.every(cell => cell === null || cell === undefined || String(cell).trim() === '')) {
                continue;
            }

            const name = String(rowData[1] || '').trim();
            const medical_id = String(rowData[2] || '').trim();
            const national_id = String(rowData[3] || '').trim();
            const dob_excel = rowData[4];
            const gender = String(rowData[5] || '').trim();
            const blood_type = String(rowData[6] || '').trim();
            const phone = String(rowData[7] || '').trim();
            const address = String(rowData[8] || '').trim();
            const added_date_excel = rowData[9];
            const referral_date_excel = rowData[10];
            const referral_place = String(rowData[11] || '').trim();
            const dialysis_unit = String(rowData[12] || '').trim();
            const virus_status = String(rowData[13] || '').trim();
            const chronic_diseases = String(rowData[14] || '').trim();
            const dialysis_days = String(rowData[15] || '').trim();
            const dialysis_shift = String(rowData[16] || '').trim();
            const patient_notes = String(rowData[17] || '').trim();

            const parseExcelDate = (excelDate) => {
                if (!excelDate) return null;
                try {
                    if (typeof excelDate === 'number') {
                        const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
                        return date.toISOString().split('T')[0];
                    } else if (excelDate instanceof Date) {
                        return excelDate.toISOString().split('T')[0];
                    } else {
                        const parsedDate = new Date(excelDate);
                        if (!isNaN(parsedDate.getTime())) {
                            return parsedDate.toISOString().split('T')[0];
                        }
                    }
                } catch (e) {
                    console.warn(`Could not parse date: ${excelDate}`, e);
                }
                return null;
            };

            const dob = parseExcelDate(dob_excel);
            const added_date = parseExcelDate(added_date_excel);
            const referral_date = parseExcelDate(referral_date_excel);

            let referral_expiry = null;
            if (referral_date) {
                const expiryDate = new Date(referral_date);
                expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                referral_expiry = expiryDate.toISOString().split('T')[0];
            }

            if (!name || !medical_id || !national_id || !added_date || !referral_date || !dialysis_unit || !virus_status) {
                failedEntries.push({ row: name || medical_id, reason: 'حقول أساسية مفقودة: الاسم، الرقم الطبي، القومي، تاريخ الإضافة، تاريخ الإحالة، الوحدة، الفيروسات.' });
                continue;
            }

            try {
                const sql = `INSERT INTO patients (name, medical_id, national_id, phone, address, added_date, referral_date, referral_expiry, referral_place, dialysis_unit, blood_type, chronic_diseases, virus_status, dob, gender, patient_notes, dialysis_days, dialysis_shift)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                await dbRun(sql, [name, medical_id, national_id, phone, address, added_date, referral_date, referral_expiry, referral_place, dialysis_unit, blood_type, chronic_diseases, virus_status, dob, gender, patient_notes, dialysis_days, dialysis_shift]);
                importedCount++;
            } catch (insertErr) {
                let reason = insertErr.message;
                if (insertErr.message.includes('UNIQUE constraint failed')) {
                    reason = 'الرقم الطبي أو القومي موجود بالفعل.';
                }
                failedEntries.push({ row: name || medical_id, reason: reason });
            }
        }

        let message = `✅ تم استيراد ${importedCount} مريض بنجاح.`;
        if (failedEntries.length > 0) {
            message += ` ⚠️ فشل استيراد ${failedEntries.length} مريض: ${failedEntries.map(f => `${f.row} (${f.reason})`).join(', ')}`;
            return res.status(200).json({ message: message, details: failedEntries });
        }
        res.status(201).json({ message: message });

    } catch (err) {
        console.error('❌ فشل في استيراد المرضى:', err.message);
        res.status(500).json({ error: 'فشل في استيراد المرضى: ' + err.message });
    } finally {
        if (req.file && req.file.path) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Failed to delete temp file:', err);
            });
        }
    }
});

// ✅ GET: تصدير جميع المرضى إلى Excel
router.get('/export/all', async (req, res) => {
    try {
        const patients = await dbAll(`
            SELECT *, 
                   CASE
                       WHEN dob IS NOT NULL AND dob != ''
                       THEN CAST(strftime('%Y', 'now') - strftime('%Y', dob) - 
                                (CASE WHEN strftime('%m%d', 'now') < strftime('%m%d', dob) THEN 1 ELSE 0 END) AS INTEGER)
                       ELSE NULL
                   END AS age
            FROM patients ORDER BY name ASC
        `);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('All Patients');

        worksheet.columns = [
            { header: 'الاسم الكامل', key: 'name', width: 30 },
            { header: 'الرقم الطبي', key: 'medical_id', width: 20 },
            { header: 'الرقم القومي', key: 'national_id', width: 20 },
            { header: 'العمر', key: 'age', width: 15 },
            { header: 'تاريخ الميلاد', key: 'dob', width: 20 },
            { header: 'الجنس', key: 'gender', width: 15 },
            { header: 'فصيلة الدم', key: 'blood_type', width: 15 },
            { header: 'رقم الهاتف', key: 'phone', width: 20 },
            { header: 'العنوان', key: 'address', width: 30 },
            { header: 'تاريخ الإضافة', key: 'added_date', width: 25 },
            { header: 'تاريخ الإحالة', key: 'referral_date', width: 25 },
            { header: 'انتهاء الإحالة', key: 'referral_expiry', width: 25 },
            { header: 'مكان الإحالة', key: 'referral_place', width: 30 },
            { header: 'الوحدة الداخلية', key: 'dialysis_unit', width: 30 },
            { header: 'حالة الفيروسات', key: 'virus_status', width: 25 },
            { header: 'الأمراض المزمنة', key: 'chronic_diseases', width: 30 },
            { header: 'أيام الغسيل الثابتة', key: 'dialysis_days', width: 50 },
            { header: 'الشفت', key: 'dialysis_shift', width: 15 },
            { header: 'ملاحظات المريض', key: 'patient_notes', width: 40 }
        ];

        worksheet.addRows(patients);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=' + encodeURIComponent('all_patients_data.xlsx'));

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('❌ فشل في تصدير بيانات المرضى:', err.message);
        res.status(500).json({ error: 'فشل في تصدير بيانات المرضى.' });
    }
});

module.exports = router;