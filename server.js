// server.js - Главный файл сервера YaKrash
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN.split(','),
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN.split(','),
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Логирование запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Подключение к БД
const db = require('./config/database');
db.testConnection();

// Маршруты API
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const appointmentRoutes = require('./routes/appointments');
const chatRoutes = require('./routes/chats');
const notificationRoutes = require('./routes/notifications');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/notifications', notificationRoutes);

// Статические файлы (аватарки, загрузки)
app.use('/uploads', express.static('uploads'));

// Главная страница API
app.get('/api', (req, res) => {
  res.json({
    message: 'YaKrash API v1.0',
    status: 'running',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      appointments: '/api/appointments',
      chats: '/api/chats',
      notifications: '/api/notifications'
    }
  });
});

// WebSocket для чатов
const chatSocket = require('./sockets/chat');
chatSocket(io);

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: true,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({
    error: true,
    message: 'Endpoint not found'
  });
});

// Cron задачи для напоминаний
const reminderCron = require('./cron/reminders');
cron.schedule('* * * * *', reminderCron); // Каждую минуту проверяем

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ YaKrash Backend запущен на порту ${PORT}`);
  console.log(`🌍 API доступен на http://localhost:${PORT}/api`);
  console.log(`💬 WebSocket доступен`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM получен, завершаем сервер...');
  server.close(() => {
    console.log('Сервер остановлен');
    db.pool.end();
    process.exit(0);
  });
});

module.exports = { app, io };
