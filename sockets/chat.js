// sockets/chat.js - WebSocket для реального времени чатов
const jwt = require('jsonwebtoken');

module.exports = (io) => {
  // Хранилище подключенных пользователей
  const users = new Map(); // userId -> socketId

  // Middleware для аутентификации WebSocket
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Токен не предоставлен'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;

      next();
    } catch (error) {
      next(new Error('Неверный токен'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`✅ User ${socket.userId} connected`);

    // Добавляем пользователя в онлайн
    users.set(socket.userId, socket.id);

    // Отправляем пользователю список онлайн пользователей
    socket.emit('users:online', Array.from(users.keys()));

    // Оповещаем всех о новом онлайн пользователе
    socket.broadcast.emit('user:online', socket.userId);

    // Присоединение к комнате чата
    socket.on('chat:join', (chatId) => {
      socket.join(`chat:${chatId}`);
      console.log(`User ${socket.userId} joined chat ${chatId}`);
    });

    // Покинуть комнату чата
    socket.on('chat:leave', (chatId) => {
      socket.leave(`chat:${chatId}`);
      console.log(`User ${socket.userId} left chat ${chatId}`);
    });

    // Отправка сообщения
    socket.on('message:send', (data) => {
      const { chatId, message } = data;

      // Отправляем сообщение всем в комнате кроме отправителя
      socket.to(`chat:${chatId}`).emit('message:new', {
        chatId,
        message: {
          ...message,
          sender_id: socket.userId
        }
      });
    });

    // Печатает сообщение (typing indicator)
    socket.on('typing:start', (data) => {
      const { chatId } = data;
      socket.to(`chat:${chatId}`).emit('user:typing', {
        chatId,
        userId: socket.userId
      });
    });

    socket.on('typing:stop', (data) => {
      const { chatId } = data;
      socket.to(`chat:${chatId}`).emit('user:stop-typing', {
        chatId,
        userId: socket.userId
      });
    });

    // Прочитано
    socket.on('message:read', (data) => {
      const { chatId, messageId } = data;
      socket.to(`chat:${chatId}`).emit('message:read', {
        chatId,
        messageId,
        readBy: socket.userId
      });
    });

    // Отключение
    socket.on('disconnect', () => {
      console.log(`❌ User ${socket.userId} disconnected`);

      // Удаляем из онлайн
      users.delete(socket.userId);

      // Оповещаем всех об отключении
      socket.broadcast.emit('user:offline', socket.userId);
    });
  });

  // Функция для отправки уведомления пользователю
  const sendNotification = (userId, notification) => {
    const socketId = users.get(userId);
    if (socketId) {
      io.to(socketId).emit('notification:new', notification);
    }
  };

  return { sendNotification };
};
