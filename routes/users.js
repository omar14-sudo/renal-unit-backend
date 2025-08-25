const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../utils/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); 
const { protect, authorize } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_12345';

// --- GET /api/users - جلب كل المستخدمين ---
router.get('/', async (req, res) => {
    try {
        const users = await dbAll("SELECT id, username, full_name, role, is_active FROM users ORDER BY full_name");
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'فشل جلب المستخدمين.' });
    }
});

// --- POST /api/users - إنشاء مستخدم جديد ---
router.post('/', async (req, res) => {
    const { username, password, full_name, role } = req.body;
    if (!username || !password || !full_name || !role) {
        return res.status(400).json({ error: 'الرجاء ملء كل الحقول المطلوبة.' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = `INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)`;
        const result = await dbRun(sql, [username.toLowerCase(), hashedPassword, full_name, role]);
        res.status(201).json({ message: '✅ تم إنشاء المستخدم بنجاح.', id: result.lastID });
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'اسم المستخدم هذا موجود بالفعل.' });
        }
        res.status(500).json({ error: 'فشل إنشاء المستخدم.' });
    }
});

// --- PUT /api/users/:id - تعديل مستخدم ---
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { full_name, role, is_active, password } = req.body;
    try {
        if (password && password.length > 0) {
            const hashedPassword = await bcrypt.hash(password, 10);
            await dbRun(`UPDATE users SET full_name = ?, role = ?, is_active = ?, password_hash = ? WHERE id = ?`, [full_name, role, is_active, hashedPassword, id]);
        } else {
            await dbRun(`UPDATE users SET full_name = ?, role = ?, is_active = ? WHERE id = ?`, [full_name, role, is_active, id]);
        }
        res.json({ message: '✅ تم تحديث بيانات المستخدم.' });
    } catch (err) {
        res.status(500).json({ error: 'فشل تحديث المستخدم.' });
    }
});

// --- DELETE /api/users/:id - حذف مستخدم ---
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    if (id === '1') {
        return res.status(403).json({ error: 'لا يمكن حذف مدير النظام الافتراضي.' });
    }
    try {
        await dbRun('DELETE FROM users WHERE id = ?', [id]);
        res.json({ message: '✅ تم حذف المستخدم.' });
    } catch (err) {
        res.status(500).json({ error: 'فشل حذف المستخدم.' });
    }
});

// --- POST /api/users/login - تسجيل الدخول ---
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }
    try {
        const user = await dbGet("SELECT * FROM users WHERE username = ? AND is_active = 1", [username.toLowerCase()]);
        if (!user) {
            return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
        }
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
        }
        const payload = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
        res.json({ message: '✅ تم تسجيل الدخول بنجاح!', token });
    } catch (err) {
        console.error('❌ فشل في عملية تسجيل الدخول:', err.message);
        res.status(500).json({ error: 'حدث خطأ في الخادم.' });
    }
});

module.exports = router;