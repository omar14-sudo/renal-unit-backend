/* init-db.js - النسخة النهائية والمجمعة لكل الجداول */
const sqlite3 = require('sqlite3').verbose();
const dbRun = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(err) { if (err) { console.error('❌ SQL Error:', err.message); reject(err); } else { resolve(this); } }));
const bcrypt = require('bcryptjs');

async function initializeDatabase() {
    console.log("⏳ تهيئة قاعدة البيانات...");
    const db = new sqlite3.Database('./database.sqlite');
    try {
        await dbRun(db, `PRAGMA foreign_keys = ON;`);
        console.log("✅ إنشاء الجداول...");

        // --- الجداول الأساسية ---
        await dbRun(db, `CREATE TABLE IF NOT EXISTS patients (id INTEGER PRIMARY KEY, name TEXT NOT NULL, medical_id TEXT UNIQUE NOT NULL, national_id TEXT UNIQUE, phone TEXT, address TEXT, added_date TEXT, referral_date TEXT, referral_expiry TEXT, referral_place TEXT, dialysis_unit TEXT, blood_type TEXT, chronic_diseases TEXT, virus_status TEXT, dob TEXT, gender TEXT, patient_notes TEXT, dialysis_days TEXT, dialysis_shift TEXT)`);
        // تم إضافة 'notes TEXT' لجدول machines
        await dbRun(db, `CREATE TABLE IF NOT EXISTS machines (id INTEGER PRIMARY KEY, serial_number TEXT UNIQUE NOT NULL, brand TEXT, model TEXT, ward TEXT, internal_unit TEXT, status TEXT DEFAULT 'نشط', last_maintenance TEXT, notes TEXT)`);
        await dbRun(db, `CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY, name TEXT NOT NULL, national_id TEXT UNIQUE, phone TEXT, address TEXT, job_title TEXT, specialization TEXT, current_position TEXT, employment_status TEXT, appointment_date TEXT, work_start_date TEXT, grade TEXT, default_shift TEXT)`);
        await dbRun(db, `CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL, session_date TEXT NOT NULL, shift TEXT, notes TEXT, blood_transfusion_bags INTEGER DEFAULT 0, machine_id INTEGER, machine_hours_operated REAL DEFAULT 0, created_at TEXT DEFAULT (date('now', 'localtime')), FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE, FOREIGN KEY(machine_id) REFERENCES machines(id) ON DELETE SET NULL)`);
        
        // --- المخزن والموردين ---
        await dbRun(db, `CREATE TABLE IF NOT EXISTS medical_supplies (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, quantity INTEGER DEFAULT 0, expiry_date TEXT)`);
        await dbRun(db, `CREATE TABLE IF NOT EXISTS inventory_log (id INTEGER PRIMARY KEY, supply_id INTEGER NOT NULL, change_amount INTEGER NOT NULL, new_quantity INTEGER NOT NULL, notes TEXT, timestamp TEXT DEFAULT (date('now', 'localtime')), FOREIGN KEY(supply_id) REFERENCES medical_supplies(id) ON DELETE CASCADE)`);
        await dbRun(db, `CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, contact_person TEXT, phone TEXT, email TEXT, address TEXT, notes TEXT, created_at TEXT DEFAULT (date('now', 'localtime')))`);
        await dbRun(db, `CREATE TABLE IF NOT EXISTS purchase_orders (id INTEGER PRIMARY KEY, supplier_id INTEGER NOT NULL, order_date TEXT NOT NULL, expected_delivery_date TEXT, status TEXT NOT NULL DEFAULT 'Pending', notes TEXT, created_at TEXT DEFAULT (date('now', 'localtime')), FOREIGN KEY (supplier_id) REFERENCES suppliers(id))`);
        await dbRun(db, `CREATE TABLE IF NOT EXISTS purchase_order_items (id INTEGER PRIMARY KEY, purchase_order_id INTEGER NOT NULL, supply_id INTEGER NOT NULL, quantity_ordered INTEGER NOT NULL DEFAULT 1, unit_price REAL DEFAULT 0, FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE, FOREIGN KEY (supply_id) REFERENCES medical_supplies(id))`);
        
        // --- الصيانة والتحاليل والجدولة ---
        await dbRun(db, `CREATE TABLE IF NOT EXISTS preventive_maintenances (id INTEGER PRIMARY KEY, machine_id INTEGER NOT NULL, maintenance_date TEXT NOT NULL, technician_name TEXT, notes TEXT, visitor_name TEXT, section TEXT, FOREIGN KEY(machine_id) REFERENCES machines(id) ON DELETE CASCADE)`);
        await dbRun(db, `CREATE TABLE IF NOT EXISTS curative_maintenances (id INTEGER PRIMARY KEY, machine_id INTEGER NOT NULL, report_date TEXT NOT NULL, request_number TEXT, repair_date TEXT, engineer_name TEXT, cost REAL DEFAULT 0, parts_details TEXT, failure_description TEXT, repair_notes TEXT, FOREIGN KEY(machine_id) REFERENCES machines(id) ON DELETE CASCADE)`);
        await dbRun(db, `CREATE TABLE IF NOT EXISTS lab_test_types (
            id INTEGER PRIMARY KEY,
            test_name TEXT UNIQUE NOT NULL,
            unit TEXT,
            result_type TEXT DEFAULT 'number',
            normal_range_low REAL,
            normal_range_high REAL,
            normal_value_text TEXT
        )`);
        await dbRun(db, `CREATE TABLE IF NOT EXISTS lab_results (id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL, test_id INTEGER NOT NULL, result_value TEXT NOT NULL, result_date TEXT NOT NULL, notes TEXT, FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE, FOREIGN KEY(test_id) REFERENCES lab_test_types(id) ON DELETE CASCADE)`);
        await dbRun(db, `CREATE TABLE IF NOT EXISTS session_schedule (id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL, machine_id INTEGER NOT NULL, schedule_date TEXT NOT NULL, shift TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Scheduled', notes TEXT, FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE, FOREIGN KEY(machine_id) REFERENCES machines(id) ON DELETE CASCADE, UNIQUE(machine_id, schedule_date, shift))`);

        // جدول إعدادات التطبيق (لأسعار الفواتير وغيرها)
        await dbRun(db, `CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY DEFAULT 1,
            price_per_session REAL DEFAULT 1450,
            price_per_blood_bag REAL DEFAULT 950
        )`);
		await dbRun(db, `CREATE TABLE IF NOT EXISTS daily_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date DATE NOT NULL UNIQUE,
    report_status TEXT NOT NULL,
    final_data TEXT NOT NULL,
    confirmed_by_user TEXT,
    confirmed_at DATETIME
)`);
		
		await dbRun(db, `
            CREATE TABLE IF NOT EXISTS shift_changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                staff_id INTEGER NOT NULL,
                shift_date TEXT NOT NULL,
                new_shift_type TEXT NOT NULL,
                substitute_staff_id INTEGER,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE,
                FOREIGN KEY(substitute_staff_id) REFERENCES staff(id) ON DELETE SET NULL,
                UNIQUE(staff_id, shift_date)
            )
        `);
		        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'doctor', 'nurse', 'clerk')),
                is_active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            )
        `);
		
		
		
		
        
        // إنشاء مستخدم افتراضي بصلاحيات مدير
        const adminPassword = 'admin';
        const hashedPassword = await bcrypt.hash(adminPassword, 10); // 10 هو عدد جولات التشفير
        
        await dbRun(db, 
            `INSERT OR IGNORE INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)`,
            ['admin', hashedPassword, 'مدير النظام', 'admin']
        );
		
		
        await dbRun(db, `INSERT OR IGNORE INTO app_settings (id, price_per_session, price_per_blood_bag) VALUES (1, 1450, 950)`);
		
		        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS water_treatment_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_date TEXT NOT NULL,
                technician_name TEXT NOT NULL,
                chlorine_level_before REAL,
                chlorine_level_after REAL,
                water_hardness REAL,
                ph_level REAL,
                ro_inlet_pressure REAL,
                ro_outlet_pressure REAL,
                ro_reject_pressure REAL,
                conductivity REAL,
                notes TEXT
            )
        `);

        console.log("\n🎉 تهانينا! كل الجداول تم إنشاؤها بالهيكل الصحيح والنهائي.");
    } catch (error) {
        console.error("❌ خطأ فادح أثناء إنشاء الجداول:", error);
    } finally {
        db.close(() => console.log("✅ تم إغلاق الاتصال بقاعدة البيانات."));
    }
}
initializeDatabase();