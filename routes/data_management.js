const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { db } = require('../utils/db'); // استيراد كائن قاعدة البيانات مباشرة

const dbPath = path.join(__dirname, '..', 'database.sqlite');
const backupDir = path.join(__dirname, '..', 'backups');

// التأكد من وجود مجلد النسخ الاحتياطي
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
}

// ✅ POST /api/backup - لإنشاء نسخة احتياطية جديدة
router.post('/backup', (req, res) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `backup-${timestamp}.sqlite`;
        const backupFilePath = path.join(backupDir, backupFileName);

        // نسخ ملف قاعدة البيانات
        fs.copyFileSync(dbPath, backupFilePath);

        res.status(201).json({ message: '✅ تم إنشاء نسخة احتياطية بنجاح.', file: backupFileName });
    } catch (err) {
        console.error('❌ فشل في إنشاء نسخة احتياطية:', err.message);
        res.status(500).json({ error: 'فشل في إنشاء نسخة احتياطية.' });
    }
});

// ✅ GET /api/backups - لجلب قائمة بالنسخ الاحتياطية الموجودة
router.get('/backups', (req, res) => {
    try {
        const files = fs.readdirSync(backupDir)
            .filter(file => file.endsWith('.sqlite'))
            .map(file => {
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                return {
                    name: file,
                    size: (stats.size / 1024).toFixed(2), // بالكيلوبايت
                    created: stats.birthtime
                };
            })
            .sort((a, b) => b.created - a.created); // ترتيب من الأحدث للأقدم

        res.json(files);
    } catch (err) {
        console.error('❌ فشل في جلب قائمة النسخ الاحتياطية:', err.message);
        res.status(500).json({ error: 'فشل في جلب قائمة النسخ الاحتياطية.' });
    }
});

// ✅ GET /api/export/partial - لتصدير الجداول الأساسية كملف SQL
router.get('/export/partial', (req, res) => {
    const tablesToExport = ['patients', 'staff', 'sessions', 'machines', 'medical_supplies'];
    let sqlDump = `
-- Partial SQL Dump generated on ${new Date().toISOString()}
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
`;

    const getTableDataPromises = tablesToExport.map(tableName => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM ${tableName};`, (err, rows) => {
                if (err) return reject(err);
                if (rows.length === 0) return resolve('');

                let tableDump = `\n-- Data for table ${tableName}\n`;
                rows.forEach(row => {
                    const columns = Object.keys(row).join(', ');
                    const values = Object.values(row).map(val => {
                        if (val === null) return 'NULL';
                        // تحويل النص ليناسب SQL (استبدال ' ب '')
                        return `'${String(val).replace(/'/g, "''")}'`;
                    }).join(', ');
                    tableDump += `INSERT INTO ${tableName} (${columns}) VALUES (${values});\n`;
                });
                resolve(tableDump);
            });
        });
    });

    Promise.all(getTableDataPromises)
        .then(dumps => {
            sqlDump += dumps.join('');
            sqlDump += 'COMMIT;\n';
            
            res.setHeader('Content-Type', 'application/sql');
            res.setHeader('Content-Disposition', 'attachment; filename="partial-export.sql"');
            res.send(sqlDump);
        })
        .catch(err => {
            console.error('❌ فشل في تصدير البيانات الجزئي:', err.message);
            res.status(500).send('-- Failed to generate SQL dump.');
        });
});


module.exports = router;