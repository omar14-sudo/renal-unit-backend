const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');
const ExcelJS = require('exceljs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });

// ✅ GET: جلب كل الماكينات
router.get('/', async (req, res) => {
    try {
        const { status, ward } = req.query;
        let sql = 'SELECT * FROM machines';
        const conditions = [];
        const params = [];

        if (status) {
            conditions.push('status = ?');
            params.push(status);
        }
        if (ward) {
            conditions.push('ward = ?');
            params.push(ward);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }
        sql += ' ORDER BY serial_number ASC';

        const machines = await dbAll(sql, params);
        res.json(machines);
    } catch (err) {
        console.error('❌ فشل في جلب الماكينات:', err.message);
        res.status(500).json({ error: 'فشل في جلب الماكينات' });
    }
});

// ✅ GET: جلب ماكينة واحدة
router.get('/:id', async (req, res) => {
    try {
        const machine = await dbGet('SELECT * FROM machines WHERE id = ?', [req.params.id]);
        if (machine) res.json(machine);
        else res.status(404).json({ error: 'الماكينة غير موجودة' });
    } catch (err) {
        console.error('❌ فشل في جلب بيانات الماكينة:', err.message);
        res.status(500).json({ error: 'فشل في جلب بيانات الماكينة' });
    }
});

// ✅ POST: إضافة ماكينة جديدة
router.post('/', async (req, res) => {
    try {
        const { serial_number, brand, model, ward, internal_unit, status, last_maintenance, notes } = req.body;

        if (!serial_number || !ward || !internal_unit || !status) {
            return res.status(400).json({ error: 'الرقم المسلسل، العنبر، الوحدة الداخلية، والحالة مطلوبة.' });
        }

        const sql = `INSERT INTO machines (serial_number, brand, model, ward, internal_unit, status, last_maintenance, notes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

        const result = await dbRun(sql, [serial_number, brand, model, ward, internal_unit, status, last_maintenance, notes]);
        res.status(201).json({ message: '✅ تم إضافة الماكينة بنجاح', id: result.lastID });
    } catch (err) {
        console.error('❌ فشل في إضافة الماكينة:', err.message);
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'الماكينة برقم تسلسلي موجود بالفعل.' });
        }
        res.status(500).json({ error: 'فشل في إضافة الماكينة.' });
    }
});

// ✅ PUT: تعديل ماكينة
router.put('/:id', async (req, res) => {
    try {
        const { brand, model, ward, internal_unit, status, last_maintenance, notes } = req.body;
        const { id } = req.params;

        if (!ward || !internal_unit || !status) {
             return res.status(400).json({ error: 'العنبر، الوحدة الداخلية، والحالة مطلوبة.' });
        }

        const sql = `UPDATE machines SET brand = ?, model = ?, ward = ?, internal_unit = ?, status = ?, last_maintenance = ?, notes = ? WHERE id = ?`;

        const result = await dbRun(sql, [brand, model, ward, internal_unit, status, last_maintenance, notes, id]);

        if (result.changes === 0) return res.status(404).json({ error: 'الماكينة غير موجودة.' });

        res.json({ message: '✅ تم تعديل بيانات الماكينة بنجاح' });
    } catch (err) {
        console.error('❌ فشل في تعديل الماكينة:', err.message);
        res.status(500).json({ error: 'فشل في تعديل بيانات الماكينة.' });
    }
});

// ✅ DELETE: حذف ماكينة
router.delete('/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM machines WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: 'الماكينة غير موجودة للحذف.' });

        res.json({ message: '✅ تم حذف الماكينة بنجاح.' });
    } catch (err) {
        console.error('❌ فشل في حذف الماكينة:', err.message);
        res.status(500).json({ error: 'فشل في حذف الماكينة.' });
    }
});

// ✅ GET: تنزيل نموذج Excel للماكينات
router.get('/template/download', async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Machines');

    worksheet.columns = [
        { header: 'الرقم المسلسل', key: 'serial_number', width: 20 },
        { header: 'الماركة', key: 'brand', width: 15 },
        { header: 'الموديل', key: 'model', width: 15 },
        { header: 'العنبر', key: 'ward', width: 20 },
        { header: 'الوحدة الداخلية', key: 'internal_unit', width: 20 },
        { header: 'حالة الجهاز', key: 'status', width: 15 },
        { header: 'تاريخ آخر صيانة (YYYY-MM-DD)', key: 'last_maintenance', width: 25 },
        { header: 'ملاحظات (اختياري)', key: 'notes', width: 30 }
    ];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=' + encodeURIComponent('machines_template.xlsx'));

    await workbook.xlsx.write(res);
    res.end();
});

// ✅ POST: استيراد بيانات الماكينات من ملف Excel
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

            const serial_number = String(rowData[1] || '').trim();
            const brand = String(rowData[2] || '').trim();
            const model = String(rowData[3] || '').trim();
            const ward = String(rowData[4] || '').trim();
            const internal_unit = String(rowData[5] || '').trim();
            const status = String(rowData[6] || '').trim();
            const last_maintenance_excel = rowData[7];
            const notes = String(rowData[8] || '').trim();

            let last_maintenance = null;
            if (last_maintenance_excel) {
                try {
                    if (typeof last_maintenance_excel === 'number') {
                        const date = new Date(Math.round((last_maintenance_excel - 25569) * 86400 * 1000));
                        last_maintenance = date.toISOString().split('T')[0];
                    } else if (last_maintenance_excel instanceof Date) {
                        last_maintenance = last_maintenance_excel.toISOString().split('T')[0];
                    } else {
                        const parsedDate = new Date(last_maintenance_excel);
                        if (!isNaN(parsedDate.getTime())) {
                            last_maintenance = parsedDate.toISOString().split('T')[0];
                        }
                    }
                } catch (dateErr) {
                    console.warn(`Could not parse last_maintenance date for row: ${rowData[1]} - ${last_maintenance_excel}`);
                }
            }

            if (!serial_number || !ward || !internal_unit || !status) {
                failedEntries.push({ row: serial_number, reason: 'حقول أساسية مفقودة (الرقم المسلسل، العنبر، الوحدة الداخلية، الحالة).' });
                continue;
            }

            try {
                const sql = `INSERT INTO machines (serial_number, brand, model, ward, internal_unit, status, last_maintenance, notes)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
                await dbRun(sql, [serial_number, brand, model, ward, internal_unit, status, last_maintenance, notes]);
                importedCount++;
            } catch (insertErr) {
                let reason = insertErr.message;
                if (insertErr.message.includes('UNIQUE constraint failed')) {
                    reason = 'الرقم المسلسل موجود بالفعل.';
                }
                failedEntries.push({ row: serial_number, reason: reason });
            }
        }

        let message = `✅ تم استيراد ${importedCount} ماكينة بنجاح.`;
        if (failedEntries.length > 0) {
            message += ` ⚠️ فشل استيراد ${failedEntries.length} ماكينة: ${failedEntries.map(f => `${f.row} (${f.reason})`).join(', ')}`;
            return res.status(200).json({ message: message, details: failedEntries });
        }
        res.status(201).json({ message: message });

    } catch (err) {
        console.error('❌ فشل في استيراد الماكينات:', err.message);
        res.status(500).json({ error: 'فشل في استيراد الماكينات: ' + err.message });
    } finally {
        if (req.file && req.file.path) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Failed to delete temp file:', err);
            });
        }
    }
});

module.exports = router;