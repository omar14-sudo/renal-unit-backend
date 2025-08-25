const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');


// --- Helper function for pagination ---
async function getPaginatedData(req, res, tableName, searchFields = []) {
    try {
        const { page = 1, limit = 15, search = '' } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = '';
        const params = [];

        if (search && searchFields.length > 0) {
            const searchConditions = searchFields.map(field => `${field} LIKE ?`).join(' OR ');
            whereClause = `WHERE ${searchConditions}`;
            searchFields.forEach(() => params.push(`%${search}%`));
        }

        const dataSql = `SELECT * FROM ${tableName} ${whereClause} ORDER BY archived_at DESC LIMIT ? OFFSET ?`;
        const countSql = `SELECT COUNT(*) as total FROM ${tableName} ${whereClause}`;

        const rows = await dbAll(dataSql, [...params, parseInt(limit), offset]);
        const countRow = await dbGet(countSql, params);

        res.json({ data: rows, total: countRow.total, page: parseInt(page), totalPages: Math.ceil(countRow.total / limit) });
    } catch (err) {
        console.error(`❌ فشل في جلب أرشيف ${tableName}:`, err.message);
        res.status(500).json({ error: `فشل في جلب أرشيف ${tableName}` });
    }
}




// --- Helper function for pagination ---
async function getPaginatedData(req, res, tableName, searchFields = []) {
    try {
        const { page = 1, limit = 15, search = '' } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = '';
        const params = [];

        if (search && searchFields.length > 0) {
            const searchConditions = searchFields.map(field => `${field} LIKE ?`).join(' OR ');
            whereClause = `WHERE ${searchConditions}`;
            searchFields.forEach(() => params.push(`%${search}%`));
        }

        const dataSql = `SELECT * FROM ${tableName} ${whereClause} ORDER BY archived_at DESC LIMIT ? OFFSET ?`;
        const countSql = `SELECT COUNT(*) as total FROM ${tableName} ${whereClause}`;

        const rows = await dbAll(dataSql, [...params, parseInt(limit), offset]);
        const countRow = await dbGet(countSql, params);

        res.json({ data: rows, total: countRow.total, page: parseInt(page), totalPages: Math.ceil(countRow.total / limit) });
    } catch (err) {
        console.error(`❌ فشل في جلب أرشيف ${tableName}:`, err.message);
        res.status(500).json({ error: `فشل في جلب أرشيف ${tableName}` });
    }
}



// =================================================================
// ||        *** START: الكود الجديد لأرشفة مريض *** ||
// =================================================================
// ✅ POST: أرشفة مريض يدوياً (النسخة النهائية والصحيحة)
// ✅ POST: أرشفة مريض (نقل + حذف) - النسخة النهائية والمصححة
router.post('/patient-manual', async (req, res) => {
    const { patientIds, archiveReason, archiveDetails, date_of_death } = req.body;

    if (!patientIds || !Array.isArray(patientIds) || patientIds.length === 0 || !archiveReason) {
        return res.status(400).json({ error: 'بيانات الأرشفة غير مكتملة.' });
    }

    try {
        for (const patientId of patientIds) {
            const patient = await dbGet('SELECT * FROM patients WHERE id = ?', [patientId]);
            if (!patient) continue;

            // استثناء الأعمدة غير المرغوب فيها من النسخ
            const { is_archived, ...patientDataToCopy } = patient;

            // بناء البيانات النهائية التي سيتم إضافتها لجدول الأرشيف
            const dataToArchive = {
                ...patientDataToCopy,
                archive_reason: archiveReason,
                archive_details: archiveDetails,
                date_of_death: (archiveReason === 'وفاة') ? date_of_death : null
            };
            
            const columns = Object.keys(dataToArchive).join(', ');
            const placeholders = Object.keys(dataToArchive).map(() => '?').join(', ');
            const values = Object.values(dataToArchive);

            // استخدام INSERT OR REPLACE لتجنب أي أخطاء تكرار
            await dbRun(`INSERT OR REPLACE INTO archived_patients (${columns}) VALUES (${placeholders})`, values);
            
            // حذف المريض من الجدول الأساسي
            await dbRun('DELETE FROM patients WHERE id = ?', [patientId]);
        }
        res.json({ message: `تمت أرشفة ${patientIds.length} مريض بنجاح.` });
    } catch (err) {
        console.error('❌ فشل في أرشفة المريض:', err.message);
        res.status(500).json({ error: 'فشل في عملية الأرشفة.', details: err.message });
    }
});
// =================================================================
// ||         *** END: الكود الجديد لأرشفة مريض *** ||
// =================================================================


// ✅ POST: استعادة مريض من الأرشيف
router.post('/patient-unarchive', async (req, res) => {
    const { patientId } = req.body;

    try {
        const archivedPatient = await dbGet('SELECT * FROM archived_patients WHERE id = ?', [patientId]);
        if (!archivedPatient) {
            return res.status(404).json({ error: 'المريض غير موجود في الأرشيف.' });
        }
        
        // استثناء أعمدة الأرشيف قبل إعادة المريض
        const { archive_reason, archive_details, archived_at, date_of_death, ...patientData } = archivedPatient;

        // إعادة تعيين حالة الأرشفة إلى صفر (نشط) وتفريغ حقول الأرشفة
        patientData.is_archived = 0;
        patientData.archive_reason = null;
        patientData.archive_details = null;
        patientData.date_of_death = null;
        
        const columns = Object.keys(patientData).join(', ');
        const placeholders = Object.keys(patientData).map(() => '?').join(', ');
        const values = Object.values(patientData);

        // استخدام INSERT OR REPLACE لتجنب أخطاء التكرار
        await dbRun(`INSERT OR REPLACE INTO patients (${columns}) VALUES (${placeholders})`, values);
        
        // حذف المريض من الأرشيف بعد استعادته
        await dbRun('DELETE FROM archived_patients WHERE id = ?', [patientId]);

        res.json({ message: 'تم استعادة المريض بنجاح.' });
    } catch (err) {
        console.error('❌ فشل استعادة المريض:', err.message);
        res.status(500).json({ error: 'فشل استعادة المريض من الأرشيف.', details: err.message });
    }
});
async function getPaginatedData(req, res, tableName, searchFields = []) {
    try {
        const { page = 1, limit = 15, search = '' } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = '';
        const params = [];

        if (search && searchFields.length > 0) {
            const searchConditions = searchFields.map(field => `${field} LIKE ?`).join(' OR ');
            whereClause = `WHERE ${searchConditions}`;
            searchFields.forEach(() => params.push(`%${search}%`));
        }

        const dataSql = `SELECT * FROM ${tableName} ${whereClause} ORDER BY archived_at DESC LIMIT ? OFFSET ?`;
        const countSql = `SELECT COUNT(*) as total FROM ${tableName} ${whereClause}`;

        const rows = await dbAll(dataSql, [...params, parseInt(limit), offset]);
        const countRow = await dbGet(countSql, params);

        res.json({ data: rows, total: countRow.total, page: parseInt(page), totalPages: Math.ceil(countRow.total / limit) });
    } catch (err) {
        console.error(`❌ فشل في جلب أرشيف ${tableName}:`, err.message);
        res.status(500).json({ error: `فشل في جلب أرشيف ${tableName}` });
    }
}

router.get('/patients', (req, res) => {
    getPaginatedData(req, res, 'archived_patients', ['name', 'medical_id', 'national_id', 'archive_reason']);
});

router.get('/staff', (req, res) => {
    getPaginatedData(req, res, 'archived_staff', ['name', 'national_id', 'job_title']);
});

router.get('/sessions', (req, res) => {
    getPaginatedData(req, res, 'archived_sessions', ['patient_name', 'patient_medical_id', 'session_date']);
});




module.exports = router;