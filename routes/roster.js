const express = require('express');
const router = express.Router();
const { dbAll, dbRun } = require('../utils/db');
const ExcelJS = require('exceljs');
const { protect } = require('../middleware/auth');

// نقطة النهاية: GET /api/roster/:monthYear
// لجلب بيانات الروستر للشهر المحدد مع إمكانية الفلترة بالمسمى الوظيفي
router.get('/:monthYear', async (req, res) => {
    const { monthYear } = req.params;
    const { job_title } = req.query; 

    if (!monthYear) {
        return res.status(400).json({ error: 'الشهر مطلوب.' });
    }

    try {
        let staffSql = "SELECT id, name, default_shift FROM staff";
        const params = [];
        if (job_title) {
            staffSql += " WHERE job_title = ?";
            params.push(job_title);
        }
        staffSql += " ORDER BY name ASC";
        
        const staff = await dbAll(staffSql, params);
        
        const changes = await dbAll(
            `SELECT staff_id, shift_date, new_shift_type FROM shift_changes WHERE strftime('%Y-%m', shift_date) = ?`,
            [monthYear]
        );
        
        res.json({ staff, changes });

    } catch (err) {
        console.error('❌ فشل تحميل الروستر:', err.message);
        res.status(500).json({ error: 'فشل تحميل الروستر' });
    }
});

// نقطة النهاية: POST /api/roster
// لحفظ كل تغييرات الروستر للشهر المحدد
router.post('/', async (req, res) => {
    const { monthYear, rosterChanges } = req.body;

    if (!monthYear || !rosterChanges) {
        return res.status(400).json({ error: 'بيانات الروستر غير مكتملة.' });
    }

    try {
        await dbRun('BEGIN TRANSACTION;');
        for (const change of rosterChanges) {
            const { staff_id, day, shift_code } = change;
            const shift_date = `${monthYear}-${String(day).padStart(2, '0')}`;
            
            // نستخدم INSERT OR REPLACE لضمان تحديث القيمة إذا كانت موجودة أو إضافتها إذا لم تكن
            await dbRun(
                `INSERT OR REPLACE INTO shift_changes (staff_id, shift_date, new_shift_type) VALUES (?, ?, ?)`,
                [staff_id, shift_date, shift_code]
            );
        }
        await dbRun('COMMIT;');
        res.json({ message: '✅ تم حفظ تغييرات الروستر بنجاح.' });
    } catch (err) {
        await dbRun('ROLLBACK;');
        console.error('❌ فشل حفظ الروستر:', err.message);
        res.status(500).json({ error: 'فشل حفظ الروستر' });
    }
});

// نقطة النهاية: GET /api/roster/export/:monthYear
// لتصدير الروستر إلى ملف Excel
router.get('/export/:monthYear', async (req, res) => {
    const { monthYear } = req.params;
    const { job_title } = req.query;

    try {
        // نفس منطق جلب البيانات من المسار الأول
        let staffSql = "SELECT id, name, default_shift FROM staff";
        const params = [];
        if (job_title) {
            staffSql += " WHERE job_title = ?";
            params.push(job_title);
        }
        staffSql += " ORDER BY name ASC";
        const staffList = await dbAll(staffSql, params);
        const changes = await dbAll(`SELECT staff_id, shift_date, new_shift_type FROM shift_changes WHERE strftime('%Y-%m', shift_date) = ?`, [monthYear]);

        // بناء هيكل بيانات الروستر
        const shiftHours = { 'M': 8, 'A': 8, 'L': 12, 'N': 12, 'NM': 18, 'AN': 18 };
        const rosterData = staffList.map(staff => {
            const staffShifts = {};
            let totalHours = 0;
            const daysInMonth = new Date(monthYear.split('-')[0], monthYear.split('-')[1], 0).getDate();
            for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = `${monthYear}-${String(day).padStart(2, '0')}`;
                const change = changes.find(c => c.staff_id === staff.id && c.shift_date === dateStr);
                const shiftCode = change ? change.new_shift_type : (staff.default_shift || '');
                staffShifts[day] = shiftCode;
                totalHours += shiftHours[shiftCode] || 0;
            }
            return { name: staff.name, shifts: staffShifts, totalHours };
        });

        // إنشاء ملف Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(`Roster ${monthYear}`);
        const daysInMonth = new Date(monthYear.split('-')[0], monthYear.split('-')[1], 0).getDate();

        // بناء الهيدر
        const columns = [{ header: 'الموظف', key: 'name', width: 25 }];
        for (let i = 1; i <= daysInMonth; i++) {
            columns.push({ header: i.toString(), key: `day${i}`, width: 5 });
        }
        columns.push({ header: 'الإجمالي', key: 'totalHours', width: 10 });
        worksheet.columns = columns;

        // إضافة البيانات
        rosterData.forEach(staff => {
            const row = { name: staff.name, totalHours: staff.totalHours };
            for (let day = 1; day <= daysInMonth; day++) {
                row[`day${day}`] = staff.shifts[day];
            }
            worksheet.addRow(row);
        });
        
        // التنسيقات
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FF0D6EFD'} };
        worksheet.columns.forEach(column => {
            column.alignment = { vertical: 'middle', horizontal: 'center' };
            column.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        });
        worksheet.getColumn('name').alignment = { vertical: 'middle', horizontal: 'right' };
        worksheet.views = [{ rightToLeft: true }];
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Roster-${monthYear}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();

    } catch(err) {
        console.error("Error exporting roster", err);
        res.status(500).send("Could not generate Excel file.");
    }
});




module.exports = router;