const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { dbAll } = require('../utils/db');

// 🟢 POST /api/export/partial
router.post('/partial', async (req, res) => {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'يرجى تحديد تاريخ البداية والنهاية.' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const daysInMonth = (new Date(end.getFullYear(), end.getMonth() + 1, 0)).getDate(); // لو احتجناها

    try {
        // جلب كل الجلسات خلال الفترة
        const rows = await dbAll(`
            SELECT p.id, p.name, p.medical_id, p.dialysis_unit, s.session_date
            FROM sessions s
            JOIN patients p ON s.patient_id = p.id
            WHERE date(s.session_date) BETWEEN ? AND ?
            ORDER BY p.name
        `, [startDate, endDate]);

        // إنشاء Map لتجميع أيام الجلسات لكل مريض
        const patientMap = new Map();
        for (const row of rows) {
            if (!patientMap.has(row.id)) {
    patientMap.set(row.id, {
        name: row.name,
        medical_id: row.medical_id,
        dialysis_unit: row.dialysis_unit || '',
        days: new Set()
    });
}

            const sessionDay = new Date(row.session_date).getDate();
            patientMap.get(row.id).days.add(sessionDay);
        }

        // بناء ملف Excel
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('تقرير الجلسات');

        // رأس الأعمدة
        const header = ['الاسم', 'الرقم الطبي', 'الوحدة الداخلية'];

        const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

        for (let i = 0; i < totalDays; i++) {
            const date = new Date(start);
            date.setDate(start.getDate() + i);
            const day = date.getDate();
            header.push(day.toString());
        }
        sheet.addRow(header);

        // الصفوف لكل مريض
        for (const patient of patientMap.values()) {
            const row = [patient.name, patient.medical_id, patient.dialysis_unit];

            for (let i = 0; i < totalDays; i++) {
                const date = new Date(start);
                date.setDate(start.getDate() + i);
                const day = date.getDate();
                row.push(patient.days.has(day) ? '✔' : '');
            }
            sheet.addRow(row);
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader(
  'Content-Disposition',
  `attachment; filename*=UTF-8''${encodeURIComponent('تقرير_الجلسات_' + startDate + '_إلى_' + endDate)}.xlsx`
);



        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('❌ فشل التصدير:', err.message);
        res.status(500).json({ error: 'فشل في إنشاء ملف التصدير.' });
    }
});


module.exports = router;
