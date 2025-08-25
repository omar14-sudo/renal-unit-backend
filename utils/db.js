const path = require('path');

// سنقوم بتعريف المتغيرات ولكن لن نقوم بالاتصال مباشرة
let db;
let dbGet, dbAll, dbRun;

if (process.env.NODE_ENV === 'production') {
  // --- إعدادات التشغيل أونلاين (Production) ---
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  console.log('✅ الاتصال بقاعدة البيانات PostgreSQL تم بنجاح (Production)');

  // إعادة تعريف الدوال لتعمل مع PostgreSQL
  dbGet = async (sql, params = []) => {
    const client = await pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows[0];
    } finally {
      client.release();
    }
  };

  dbAll = async (sql, params = []) => {
    const client = await pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } finally {
      client.release();
    }
  };

  dbRun = async (sql, params = []) => {
    const client = await pool.connect();
    try {
      const result = await client.query(sql, params);
      // PostgreSQL's `run` equivalent returns rowCount
      return { changes: result.rowCount };
    } finally {
      client.release();
    }
  };
  
  db = pool; // يمكن استخدام pool مباشرة للاستعلامات المعقدة

} else {
  // --- إعدادات التطوير المحلي (Development) ---
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(__dirname, '..', 'database.sqlite');

  const sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('❌ خطأ في الاتصال بقاعدة البيانات SQLite:', err.message);
    else console.log('✅ الاتصال بقاعدة البيانات SQLite تم بنجاح:', dbPath);
  });

  // استخدام الدوال الأصلية لـ SQLite
  dbGet = (sql, params = []) => new Promise((resolve, reject) =>
    sqliteDb.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  );

  dbAll = (sql, params = []) => new Promise((resolve, reject) =>
    sqliteDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );

  dbRun = (sql, params = []) => new Promise((resolve, reject) =>
    sqliteDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    })
  );

  db = sqliteDb;
}

module.exports = { db, dbGet, dbAll, dbRun };