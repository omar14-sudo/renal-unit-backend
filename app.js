require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const path = require('path');
const reportsRouter = require('./routes/reports');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());
app.get('/', (req, res) => {
    res.redirect('/login.html');
});
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/patients', require('./routes/patients'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/machines', require('./routes/machines'));
app.use('/api/statistics', require('./routes/statistics'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/maintenances', require('./routes/maintenances'));
app.use('/api/lab', require('./routes/lab'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/purchase-orders', require('./routes/purchase-orders'));
app.use('/api/supplies', require('./routes/supplies'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/alerts', require('./routes/alerts')); 
app.use('/api/archive', require('./routes/archive.js'));
app.use('/api', require('./routes/data_management.js'));
app.use('/api/roster', require('./routes/roster.js'));
app.use('/api/users', require('./routes/users.js'));
app.use('/api/water-log', require('./routes/water_log.js'));
app.use('/api/export', exportRoutes);

app.listen(PORT, () => {
  console.log(`🚀 السيرفر شغال على http://localhost:${PORT}`);
});

module.exports = app; // ليكون قابلاً للاستيراد إذا لزم الأمر، لكنه ليس ضرورياً للخادم المباشر