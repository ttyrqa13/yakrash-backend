// routes/users.js - Управление пользователями
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Настройка multer для загрузки аватарок
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/avatars';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${req.userId}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10485760 }, // 10MB вместо 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Неподдерживаемый формат. Разрешены: JPEG, PNG, WebP, GIF'));
    }
  }
});

// Получение пользователя по ID
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, username, email, phone, city, avatar_url, 
              is_master, is_salon_owner, is_admin, is_blocked, 
              services, subscribed_salon_id, created_at
       FROM users WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновление профиля
router.put('/me', auth, async (req, res) => {
  try {
    const { name, username, phone, city, services } = req.body;
    const userId = req.userId;

    // Проверка уникальности username если изменился
    if (username) {
      const existing = await db.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username, userId]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Username уже занят' });
      }
    }

    // Формирование SQL запроса
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (username) {
      updates.push(`username = $${paramIndex++}`);
      values.push(username);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(phone);
    }
    if (city) {
      updates.push(`city = $${paramIndex++}`);
      values.push(city);
    }
    if (services) {
      updates.push(`services = $${paramIndex++}`);
      values.push(JSON.stringify(services));
      updates.push(`is_master = $${paramIndex++}`);
      values.push(services.length > 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    values.push(userId);

    const result = await db.query(
      `UPDATE users SET ${updates.join(', ')} 
       WHERE id = $${paramIndex}
       RETURNING id, name, username, email, phone, city, avatar_url, 
                 is_master, is_salon_owner, is_admin, services, subscribed_salon_id`,
      values
    );

    res.json({
      success: true,
      message: 'Профиль обновлен',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Ошибка при обновлении профиля' });
  }
});

// Загрузка аватарки
router.post('/me/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // Удаление старого аватара
    const oldAvatar = await db.query(
      'SELECT avatar_url FROM users WHERE id = $1',
      [req.userId]
    );

    if (oldAvatar.rows[0]?.avatar_url) {
      const oldPath = path.join(__dirname, '..', oldAvatar.rows[0].avatar_url);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (err) {
          console.error('Error deleting old avatar:', err);
        }
      }
    }

    // Обновление в БД
    await db.query(
      'UPDATE users SET avatar_url = $1 WHERE id = $2',
      [avatarUrl, req.userId]
    );

    res.json({
      success: true,
      message: 'Аватар загружен',
      avatarUrl
    });

  } catch (error) {
    console.error('Upload avatar error:', error);
    
    // Удаляем загруженный файл если была ошибка БД
    if (req.file) {
      const filePath = path.join(__dirname, '..', 'uploads', 'avatars', req.file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    res.status(500).json({ 
      error: 'Ошибка при загрузке аватара',
      details: error.message 
    });
  }
});

// НОВЫЙ РОУТ: Удаление аватарки
router.delete('/me/avatar', auth, async (req, res) => {
  try {
    // Получение текущего аватара
    const user = await db.query(
      'SELECT avatar_url FROM users WHERE id = $1',
      [req.userId]
    );

    if (!user.rows[0]?.avatar_url) {
      return res.status(404).json({ error: 'Аватар не установлен' });
    }

    const avatarPath = path.join(__dirname, '..', user.rows[0].avatar_url);
    
    // Удаление файла
    if (fs.existsSync(avatarPath)) {
      fs.unlinkSync(avatarPath);
    }

    // Обновление БД
    await db.query(
      'UPDATE users SET avatar_url = NULL WHERE id = $1',
      [req.userId]
    );

    res.json({
      success: true,
      message: 'Аватар удален'
    });

  } catch (error) {
    console.error('Delete avatar error:', error);
    res.status(500).json({ error: 'Ошибка при удалении аватара' });
  }
});

// Удаление профиля
router.delete('/me', auth, async (req, res) => {
  try {
    // Удаление аватара
    const user = await db.query(
      'SELECT avatar_url FROM users WHERE id = $1',
      [req.userId]
    );

    if (user.rows[0]?.avatar_url) {
      const avatarPath = path.join(__dirname, '..', user.rows[0].avatar_url);
      if (fs.existsSync(avatarPath)) {
        fs.unlinkSync(avatarPath);
      }
    }

    // Удаление пользователя (каскадно удалятся все связанные данные)
    await db.query('DELETE FROM users WHERE id = $1', [req.userId]);

    res.json({
      success: true,
      message: 'Профиль удален'
    });

  } catch (error) {
    console.error('Delete profile error:', error);
    res.status(500).json({ error: 'Ошибка при удалении профиля' });
  }
});

// Поиск салонов
router.get('/search/salons', auth, async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.length < 2) {
      return res.status(400).json({ error: 'Запрос должен быть минимум 2 символа' });
    }

    const result = await db.query(
      `SELECT id, name, username, city, avatar_url
       FROM users 
       WHERE is_salon_owner = true 
       AND (username ILIKE $1 OR name ILIKE $1)
       LIMIT 20`,
      [`%${query}%`]
    );

    res.json({
      success: true,
      salons: result.rows
    });

  } catch (error) {
    console.error('Search salons error:', error);
    res.status(500).json({ error: 'Ошибка поиска' });
  }
});

// Подписаться на салон
router.post('/subscribe/:salonId', auth, async (req, res) => {
  try {
    const salonId = parseInt(req.params.salonId);

    // Проверка существования салона
    const salon = await db.query(
      'SELECT id, is_salon_owner FROM users WHERE id = $1',
      [salonId]
    );

    if (salon.rows.length === 0 || !salon.rows[0].is_salon_owner) {
      return res.status(404).json({ error: 'Салон не найден' });
    }

    // Подписка
    await db.query(
      'UPDATE users SET subscribed_salon_id = $1 WHERE id = $2',
      [salonId, req.userId]
    );

    res.json({
      success: true,
      message: 'Вы подписались на салон'
    });

  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: 'Ошибка подписки' });
  }
});

// Отписаться от салона
router.delete('/subscribe', auth, async (req, res) => {
  try {
    await db.query(
      'UPDATE users SET subscribed_salon_id = NULL WHERE id = $1',
      [req.userId]
    );

    res.json({
      success: true,
      message: 'Вы отписались от салона'
    });

  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: 'Ошибка отписки' });
  }
});

// Получить подписчиков салона (для админки)
router.get('/salon/subscribers', auth, async (req, res) => {
  try {
    // Проверка прав
    const user = await db.query(
      'SELECT is_salon_owner FROM users WHERE id = $1',
      [req.userId]
    );

    if (!user.rows[0]?.is_salon_owner) {
      return res.status(403).json({ error: 'Нет прав доступа' });
    }

    const { type } = req.query; // 'clients' или 'masters'

    let query;
    if (type === 'masters') {
      query = `SELECT id, name, username, phone, city, avatar_url, services
               FROM users 
               WHERE subscribed_salon_id = $1 AND is_master = true
               ORDER BY name`;
    } else {
      query = `SELECT id, name, username, phone, city, avatar_url
               FROM users 
               WHERE subscribed_salon_id = $1 AND is_master = false AND is_salon_owner = false
               ORDER BY name`;
    }

    const result = await db.query(query, [req.userId]);

    res.json({
      success: true,
      subscribers: result.rows
    });

  } catch (error) {
    console.error('Get subscribers error:', error);
    res.status(500).json({ error: 'Ошибка получения подписчиков' });
  }
});

module.exports = router;
