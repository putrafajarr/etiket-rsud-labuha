const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initDb } = require('./config/db');
const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const roomRoutes = require('./routes/rooms');
const categoryRoutes = require('./routes/categories');
const userRoutes = require('./routes/users');
const settingRoutes = require('./routes/settings');
const reportRoutes = require('./routes/reports');
const webhookRoutes = require('./routes/webhook');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
  }
});

// Attach socket.io to app so routes can broadcast events
app.set('io', io);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/downloads', express.static(path.join(__dirname, '..', 'downloads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/webhook', webhookRoutes);

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`[Socket.io] Client terhubung: ${socket.id}`);

  socket.on('join_technician_room', (techId) => {
    socket.join(`tech_${techId}`);
    console.log(`[Socket.io] Teknisi ${techId} join room`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;

// Initialize DB and start server
initDb().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('========================================================');
    console.log(`🏥 SIM-ETIKET IT RSUD LABUHA BERJALAN`);
    console.log(`🌐 Server URL: http://localhost:${PORT}`);
    console.log(`📱 Portal Lapor Cepat (QR): http://localhost:${PORT}/lapor.html`);
    console.log(`🔍 Lacak Tiket: http://localhost:${PORT}/track.html`);
    console.log(`🏷 Cetak Stiker QR Ruangan: http://localhost:${PORT}/qrcodes.html`);
    console.log('========================================================');
  });
}).catch(err => {
  console.error('Fatal: Gagal menginisialisasi database:', err);
});

