const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('../../server/routes/auth');
const ticketRoutes = require('../../server/routes/tickets');
const roomRoutes = require('../../server/routes/rooms');
const userRoutes = require('../../server/routes/users');
const settingRoutes = require('../../server/routes/settings');
const reportRoutes = require('../../server/routes/reports');
const webhookRoutes = require('../../server/routes/webhook');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express router for all API endpoints
const router = express.Router();
router.use('/auth', authRoutes);
router.use('/tickets', ticketRoutes);
router.use('/rooms', roomRoutes);
router.use('/users', userRoutes);
router.use('/settings', settingRoutes);
router.use('/reports', reportRoutes);
router.use('/webhook', webhookRoutes);

// Mount router on multiple paths for Netlify rewrite compatibility
app.use('/.netlify/functions/api', router);
app.use('/api', router);
app.use('/', router);

module.exports.handler = serverless(app);

