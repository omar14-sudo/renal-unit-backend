const express = require('express');
const router = express.Router();
const { dbGet, dbAll } = require('../utils/db');

// ✅ نقطة نهاية جديدة: جلب كل الإحصائيات المطلوبة للوحة المعلومات
router.get('/', async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'يرجى تحديد فترة زمنية (startDate و endDate) لتقرير الإحصائيات.' });
    }


try {
    const today = new Date().toISOString().split('T')[0];

    // حسابات الفترة الحالية
    const totalPatientsCurrent = await dbGet('SELECT COUNT(*) as total FROM patients');
    const activeReferralsCurrent = await dbGet("SELECT COUNT(*) as total FROM patients WHERE referral_expiry >= date(?)", [endDate]);
    const expiredReferralsCurrent = await dbGet("SELECT COUNT(*) as total FROM patients WHERE referral_expiry < date(?)", [today]); // تأكد من أن هذا السطر يستخدم today
    const newPatientsCurrent = await dbGet("SELECT COUNT(*) as total FROM patients WHERE added_date BETWEEN date(?) AND date(?)", [startDate, endDate]);
    const totalSessionsCurrent = await dbGet("SELECT COUNT(*) as total FROM sessions WHERE session_date BETWEEN date(?) AND date(?)", [startDate, endDate]);
    const sessionsWithBloodCurrent = await dbGet("SELECT COUNT(*) as total FROM sessions WHERE session_date BETWEEN date(?) AND date(?) AND blood_transfusion_bags > 0", [startDate, endDate]);
    const preventiveMaintenancesCurrent = await dbGet("SELECT COUNT(*) as total FROM preventive_maintenances WHERE maintenance_date BETWEEN date(?) AND date(?)", [startDate, endDate]);
    const curativeMaintenancesCurrent = await dbGet("SELECT COUNT(*) as total FROM curative_maintenances WHERE report_date BETWEEN date(?) AND date(?)", [startDate, endDate]);
    const totalStaff = await dbGet("SELECT COUNT(*) as total FROM staff");


    // حسابات الفترة السابقة (للمقارنة)
    const prevEndDate = new Date(startDate);
    prevEndDate.setDate(prevEndDate.getDate() - 1);
    const prevStartDate = new Date(prevEndDate);
    const diffTime = Math.abs(new Date(endDate).getTime() - new Date(startDate).getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    prevStartDate.setDate(prevStartDate.getDate() - diffDays);

    const activeReferralsPrevious = await dbGet("SELECT COUNT(*) as total FROM patients WHERE referral_expiry >= date(?)", [prevEndDate.toISOString().split('T')[0]]);
    const newPatientsPrevious = await dbGet("SELECT COUNT(*) as total FROM patients WHERE added_date BETWEEN date(?) AND date(?)", [prevStartDate.toISOString().split('T')[0], prevEndDate.toISOString().split('T')[0]]);
    const totalSessionsPrevious = await dbGet("SELECT COUNT(*) as total FROM sessions WHERE session_date BETWEEN date(?) AND date(?)", [prevStartDate.toISOString().split('T')[0], prevEndDate.toISOString().split('T')[0]]);
    const sessionsWithBloodPrevious = await dbGet("SELECT COUNT(*) as total FROM sessions WHERE session_date BETWEEN date(?) AND date(?) AND blood_transfusion_bags > 0", [prevStartDate.toISOString().split('T')[0], prevEndDate.toISOString().split('T')[0]]);
    const expiredReferralsPrevious = await dbGet("SELECT COUNT(*) as total FROM patients WHERE referral_expiry < date(?)", [prevEndDate.toISOString().split('T')[0]]); // تأكد أن هذا السطر صحيح أيضًا

        // توزيعات (Distributions)
        const genderDistribution = await dbAll("SELECT gender, COUNT(*) as count FROM patients GROUP BY gender");
        const virusStatusDistribution = await dbAll("SELECT virus_status, COUNT(*) as count FROM patients GROUP BY virus_status");
        const ageDistribution = await dbAll(`
            SELECT
                CASE
                    WHEN dob IS NULL THEN 'غير محدد'
                    WHEN (strftime('%Y', 'now') - strftime('%Y', dob)) < 18 THEN 'أقل من 18'
                    WHEN (strftime('%Y', 'now') - strftime('%Y', dob)) BETWEEN 18 AND 45 THEN '18-45'
                    WHEN (strftime('%Y', 'now') - strftime('%Y', dob)) BETWEEN 46 AND 65 THEN '46-65'
                    ELSE 'أكبر من 65'
                END as age_group,
                COUNT(*) as count
            FROM patients
            GROUP BY age_group
            ORDER BY
                CASE age_group
                    WHEN 'أقل من 18' THEN 1
                    WHEN '18-45' THEN 2
                    WHEN '46-65' THEN 3
                    WHEN 'أكبر من 65' THEN 4
                    ELSE 5
                END;
        `);

        // اتجاهات (Trends)
        const sessionsMonthlyTrend = await dbAll(`
            SELECT
                strftime('%Y-%m', session_date) as month,
                COUNT(*) as session_count
            FROM sessions
            WHERE session_date BETWEEN date(?) AND date(?)
            GROUP BY month
            ORDER BY month ASC;
        `, [startDate, endDate]);

        const newPatientsMonthlyTrend = await dbAll(`
            SELECT
                strftime('%Y-%m', added_date) as month,
                COUNT(*) as patient_count
            FROM patients
            WHERE added_date BETWEEN date(?) AND date(?)
            GROUP BY month
            ORDER BY month ASC;
        `, [startDate, endDate]);
		const patientCountByUnit = await dbAll("SELECT dialysis_unit, COUNT(*) as count FROM patients WHERE is_archived = 0 GROUP BY dialysis_unit");	
        // قائمة أهم المرضى (Top Lists)
        const topPatientsBySessions = await dbAll(`
            SELECT p.name, p.medical_id, COUNT(s.id) as session_count
            FROM sessions s
            JOIN patients p ON s.patient_id = p.id
            WHERE s.session_date BETWEEN date(?) AND date(?)
            GROUP BY p.id
            ORDER BY session_count DESC
            LIMIT 10;
        `, [startDate, endDate]);

        res.json({
            currentPeriod: {
                total_patients: totalPatientsCurrent.total,
                active_referrals: activeReferralsCurrent.total,
                expired_referrals: expiredReferralsCurrent.total,
                new_patients: newPatientsCurrent.total,
                total_sessions: totalSessionsCurrent.total,
                sessions_with_blood: sessionsWithBloodCurrent.total,
                preventive_maintenances: preventiveMaintenancesCurrent.total,
                curative_maintenances: curativeMaintenancesCurrent.total
            },
            previousPeriod: {
                active_referrals: activeReferralsPrevious.total,
                expired_referrals: expiredReferralsPrevious.total,
                new_patients: newPatientsPrevious.total,
                total_sessions: totalSessionsPrevious.total,
                sessions_with_blood: sessionsWithBloodPrevious.total
            },
            other_stats: {
                total_staff: totalStaff.total
            },
            distributions: {
                gender: genderDistribution.reduce((acc, item) => ({ ...acc, [item.gender || 'غير محدد']: item.count }), {}),
                virus_status: virusStatusDistribution.reduce((acc, item) => ({ ...acc, [item.virus_status || 'غير محدد']: item.count }), {}),
                age: ageDistribution.reduce((acc, item) => ({ ...acc, [item.age_group || 'غير محدد']: item.count }), {}),
			    patient_by_unit: patientCountByUnit.reduce((acc, item) => ({ ...acc, [item.dialysis_unit || 'غير محددة']: item.count }), {}),
              },
            trends: {
                sessions_monthly: sessionsMonthlyTrend,
                new_patients_monthly: newPatientsMonthlyTrend
            },
            top_lists: {
                patients_by_sessions: topPatientsBySessions
            }
        });

    } catch (err) {
        console.error('❌ فشل في توليد إحصائيات لوحة المعلومات:', err.message);
        res.status(500).json({ error: 'فشل في توليد إحصائيات لوحة المعلومات', details: err.message });
    }
});

// ✅ تقرير: عدد الجلسات لكل ماكينة (لا تزال موجودة، لكن قد لا تستخدمها الواجهة الأمامية)
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

// ✅ تقرير: عدد الجلسات لكل مريض (لا تزال موجودة، لكن قد لا تستخدمها الواجهة الأمامية)
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

// ✅ المرضى حسب حالة التحويل (لا تزال موجودة، لكن قد لا تستخدمها الواجهة الأمامية)
router.get('/referral-status', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const nearExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const active = await dbGet("SELECT COUNT(*) as total FROM patients WHERE referral_expiry >= date(?)", [today]);
        const expiring = await dbGet("SELECT COUNT(*) as total FROM patients WHERE referral_expiry BETWEEN date(?) AND date(?)", [today, nearExpiry]);
        const expired = await dbGet("SELECT COUNT(*) as total FROM patients WHERE referral_expiry < date(?)", [today]);

        res.json({
            active: active.total,
            expiring: expiring.total,
            expired: expired.total
        });
    } catch (err) {
        console.error('❌ فشل في جلب حالة التحويل:', err.message);
        res.status(500).json({ error: 'فشل في جلب الإحصائيات' });
    }
});

// ✅ إحصائية توزيع المرضى حسب فصيلة الدم (لا تزال موجودة، لكن قد لا تستخدمها الواجهة الأمامية)
router.get('/blood-type', async (req, res) => {
    try {
        const rows = await dbAll("SELECT blood_type, COUNT(*) as total FROM patients GROUP BY blood_type");
        res.json({ data: rows });
    } catch (err) {
        console.error('❌ فشل في إحصائيات فصيلة الدم:', err.message);
        res.status(500).json({ error: 'فشل في جلب البيانات' });
    }
});

module.exports = router;