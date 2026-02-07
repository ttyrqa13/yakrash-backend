// middleware/auth.js - Проверка JWT токена
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    // Получение токена из заголовка
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Не авторизован',
        message: 'Токен не предоставлен'
      });
    }

    const token = authHeader.substring(7); // Убираем "Bearer "

    // Проверка токена
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Добавляем userId в request
    req.userId = decoded.userId;

    next();

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Токен истек',
        message: 'Пожалуйста, войдите снова'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Неверный токен',
        message: 'Токен недействителен'
      });
    }

    return res.status(500).json({ 
      error: 'Ошибка авторизации',
      message: error.message
    });
  }
};
