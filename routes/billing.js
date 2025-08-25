const express = require('express');
const router = express.Router();
const { dbGet, dbAll } = require('../utils/db');
const ExcelJS = require('exceljs');
const path = require('path');

// دالة مساعدة لجلب إعدادات الأسعار من app_settings
async function getBillingPrices() {
    try {
        const settings = await dbGet("SELECT price_per_session, price_per_blood_bag FROM app_settings WHERE id = 1");
        if (settings) {
            return {
                price_per_session: settings.price_per_session || 200,
                price_per_blood_bag: settings.price_per_blood_bag || 150
            };
        }
    } catch (e) {
        console.warn("Failed to fetch billing settings, using default prices:", e.message);
    }
    return {
        price_per_session: 200,
        price_per_blood_bag: 150
    };
}

// ✅ GET: جلب بيانات فاتورة لمريض واحد لشهر معين
router.get('/invoice', async (req, res) => {
    const { patientId, month } = req.query;

    if (!patientId || !month) {
        return res.status(400).json({ error: 'الرجاء تحديد معرف المريض والشهر.' });
    }

    try {
        const patient = await dbGet('SELECT id, name, medical_id, national_id, referral_place FROM patients WHERE id = ?', [patientId]);
        if (!patient) {
            return res.status(404).json({ error: 'المريض غير موجود.' });
        }

        const sessions = await dbAll(`
            SELECT
                id,
                session_date,
                blood_transfusion_bags
            FROM
                sessions
            WHERE
                patient_id = ? AND strftime('%Y-%m', session_date) = ?
            ORDER BY session_date ASC
        `, [patientId, month]);

        const session_count = sessions.length;
        const total_bags = sessions.reduce((sum, s) => sum + (s.blood_transfusion_bags || 0), 0);

        const prices = await getBillingPrices();

        const total_sessions_price = session_count * prices.price_per_session;
        const total_blood_price = total_bags * prices.price_per_blood_bag;
        const grand_total = total_sessions_price + total_blood_price;

        let first_session_date = null;
        let last_session_date = null;
        if (sessions.length > 0) {
            first_session_date = sessions[0].session_date;
            last_session_date = sessions[sessions.length - 1].session_date;
        }

        res.json({
            patient,
            billingMonth: month,
            prices,
            session_count,
            total_bags,
            total_sessions_price,
            total_blood_price,
            grand_total,
            first_session_date,
            last_session_date
        });

    } catch (err) {
        console.error('❌ فشل في جلب بيانات الفاتورة:', err.message);
        res.status(500).json({ error: 'فشل في جلب بيانات الفاتورة', details: err.message });
    }
});

// ✅ GET: جلب بيانات الفواتير المجمعة لشهر معين
router.get('/bulk-invoice-data/:month', async (req, res) => {
    const { month } = req.params;

    if (!month) {
        return res.status(400).json({ error: 'الرجاء تحديد الشهر لبيانات الفواتير المجمعة.' });
    }

    try {
        const patientsWithSessions = await dbAll(`
            SELECT DISTINCT p.id, p.name, p.medical_id, p.national_id, p.referral_place
            FROM patients p
            JOIN sessions s ON p.id = s.patient_id
            WHERE strftime('%Y-%m', s.session_date) = ?
            ORDER BY p.name ASC
        `, [month]);

        const prices = await getBillingPrices();
        const allInvoicesData = [];

        for (const patient of patientsWithSessions) {
            const sessions = await dbAll(`
                SELECT
                    session_date,
                    blood_transfusion_bags
                FROM
                    sessions
                WHERE
                    patient_id = ? AND strftime('%Y-%m', session_date) = ?
                ORDER BY session_date ASC
            `, [patient.id, month]);

            const session_count = sessions.length;
            const total_bags = sessions.reduce((sum, s) => sum + (s.blood_transfusion_bags || 0), 0);

            const total_sessions_price = session_count * prices.price_per_session;
            const total_blood_price = total_bags * prices.price_per_blood_bag;
            const grand_total = total_sessions_price + total_blood_price;

            let first_session_date = null;
            let last_session_date = null;
            if (sessions.length > 0) {
                first_session_date = sessions[0].session_date;
                last_session_date = sessions[sessions.length - 1].session_date;
            }

            allInvoicesData.push({
                patient,
                billingMonth: month,
                prices,
                session_count,
                total_bags,
                total_sessions_price,
                total_blood_price,
                grand_total,
                first_session_date,
                last_session_date
            });
        }

        res.json(allInvoicesData);

    } catch (err) {
        console.error('❌ فشل في جلب بيانات الفواتير المجمعة:', err.message);
        res.status(500).json({ error: 'فشل في جلب بيانات الفواتير المجمعة', details: err.message });
    }
});

// ✅ GET: تصدير الفواتير الشهرية إلى ملف Excel
router.get('/export/:month', async (req, res) => {
    const { month } = req.params;
    const { unit } = req.query; // ✅ قراءة الوحدة من الرابط

    if (!month) {
        return res.status(400).json({ error: 'الرجاء تحديد الشهر لتصدير الفواتير.' });
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(`Invoices ${month}`);

        // ✅ تم إضافة عمود "الوحدة الداخلية" لملف الإكسيل
        worksheet.columns = [
            { header: 'رقم الفاتورة', key: 'invoice_id', width: 20 },
            { header: 'اسم المريض', key: 'patient_name', width: 30 },
            { header: 'الرقم الطبي', key: 'medical_id', width: 15 },
            { header: 'الوحدة الداخلية', key: 'dialysis_unit', width: 25 },
            { header: 'الرقم القومي', key: 'national_id', width: 20 },
            { header: 'تاريخ الإحالة', key: 'referral_date', width: 15 },
            { header: 'جهة التغطية', key: 'referral_place', width: 25 },
            { header: 'فترة المطالبة', key: 'claim_period', width: 30 },
            { header: 'عدد الجلسات', key: 'session_count', width: 15 },
            { header: 'سعر الجلسة', key: 'price_per_session', width: 15 },
            { header: 'إجمالي الجلسات', key: 'total_sessions_price', width: 18 },
            { header: 'عدد أكياس الدم', key: 'total_bags', width: 15 },
            { header: 'سعر كيس الدم', key: 'price_per_blood_bag', width: 15 },
            { header: 'إجمالي الدم', key: 'total_blood_price', width: 18 },
            { header: 'الإجمالي الكلي', key: 'grand_total', width: 18 },
        ];

        // ✅ بناء استعلام قاعدة البيانات بشكل ديناميكي بناءً على الوحدة
        let patientsQuery = `
            SELECT DISTINCT p.id, p.name, p.medical_id, p.national_id, p.referral_place, p.referral_date, p.dialysis_unit
            FROM patients p
            JOIN sessions s ON p.id = s.patient_id
            WHERE strftime('%Y-%m', s.session_date) = ?
        `;
        const queryParams = [month];

        if (unit && unit !== 'all') {
            patientsQuery += ` AND p.dialysis_unit = ?`;
            queryParams.push(unit);
        }

        patientsQuery += ` ORDER BY p.name ASC`;
        
        const patientsWithSessions = await dbAll(patientsQuery, queryParams);

        const prices = await getBillingPrices();
        let invoiceCounter = 0;

        for (const patient of patientsWithSessions) {
            const sessions = await dbAll(`
                SELECT
                    session_date,
                    blood_transfusion_bags
                FROM
                    sessions
                WHERE
                    patient_id = ? AND strftime('%Y-%m', session_date) = ?
                ORDER BY session_date ASC
            `, [patient.id, month]);

            const session_count = sessions.length;
            const total_bags = sessions.reduce((sum, s) => sum + (s.blood_transfusion_bags || 0), 0);

            const total_sessions_price = session_count * prices.price_per_session;
            const total_blood_price = total_bags * prices.price_per_blood_bag;
            const grand_total = total_sessions_price + total_blood_price;

            let first_session_date = null;
            let last_session_date = null;
            if (sessions.length > 0) {
                first_session_date = sessions[0].session_date;
                last_session_date = sessions[sessions.length - 1].session_date;
            }
            const claim_period = first_session_date && last_session_date ? `من ${first_session_date} إلى ${last_session_date}` : month;
            invoiceCounter++;

            // ✅ إضافة بيانات "الوحدة الداخلية" عند إضافة صف جديد
            worksheet.addRow({
                invoice_id: `INV-${month.replace('-', '')}-${patient.id}`,
                patient_name: patient.name,
                medical_id: patient.medical_id,
                dialysis_unit: patient.dialysis_unit, // <-- البيان الجديد
                national_id: patient.national_id,
                referral_date: patient.referral_date,
                referral_place: patient.referral_place,
                claim_period: claim_period,
                session_count: session_count,
                price_per_session: prices.price_per_session,
                total_sessions_price: total_sessions_price,
                total_bags: total_bags,
                price_per_blood_bag: prices.price_per_blood_bag,
                total_blood_price: total_blood_price,
                grand_total: grand_total,
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=' + encodeURIComponent(`Monthly_Invoices_${month}.xlsx`));

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('❌ فشل في تصدير الفواتير الشهرية إلى Excel:', err.message);
        res.status(500).json({ error: 'فشل في تصدير الفواتير الشهرية إلى Excel', details: err.message });
    }
});

module.exports = router;