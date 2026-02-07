// routes/auth.js - Маршруты авторизации
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');

// Регистрация
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').trim().isLength({ min: 2 }),
  body('username').trim().isLength({ min: 4, max: 20 }).matches(/^[a-z0-9_]+$/i),
  body('phone').optional().trim(),
  body('city').optional().trim(),
  body('services').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name, username, phone, city, services } = req.body;

    // Проверка существующего пользователя
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email или username уже занят' });
    }

    // Хеширование пароля
    const passwordHash = await bcrypt.hash(password, 10);

    // Создание пользователя
    const result = await db.query(
      `INSERT INTO users (name, username, email, password_hash, phone, city, is_master, services) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING id, name, username, email, phone, city, is_master, services`,
      [name, username, email, passwordHash, phone || null, city || null, 
       services && services.length > 0, JSON.stringify(services || [])]
    );

    const user = result.rows[0];

    // Создание JWT токена
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Пользователь создан',
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        city: user.city,
        isMaster: user.is_master,
        services: user.services
      }
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Ошибка при регистрации' });
  }
});

// Вход
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Поиск пользователя
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const user = result.rows[0];

    // Проверка блокировки
    if (user.is_blocked) {
      return res.status(403).json({ error: 'Аккаунт заблокирован' });
    }

    // Проверка пароля
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    // Обновление last_login
    await db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Создание JWT токена
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      success: true,
      message: 'Вход выполнен',
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        city: user.city,
        isMaster: user.is_master,
        isSalonOwner: user.is_salon_owner,
        isAdmin: user.is_admin,
        services: user.services,
        subscribedSalonId: user.subscribed_salon_id,
        avatarUrl: user.avatar_url
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Ошибка при входе' });
  }
});

// Получение текущего пользователя
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Не авторизован' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await db.query(
      'SELECT id, name, username, email, phone, city, avatar_url, is_master, is_salon_owner, is_admin, is_blocked, services, subscribed_salon_id FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const user = result.rows[0];

    if (user.is_blocked) {
      return res.status(403).json({ error: 'Аккаунт заблокирован' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        city: user.city,
        avatarUrl: user.avatar_url,
        isMaster: user.is_master,
        isSalonOwner: user.is_salon_owner,
        isAdmin: user.is_admin,
        services: user.services,
        subscribedSalonId: user.subscribed_salon_id
      }
    });

  } catch (error) {
    console.error('Get me error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Неверный токен' });
    }
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
