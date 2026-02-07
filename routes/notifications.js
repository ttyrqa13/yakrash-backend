// routes/notifications.js - Управление уведомлениями
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

// Получить все уведомления
router.get('/', auth, async (req, res) => {
  try {
    const { is_read, limit = 50 } = req.query;

    let query = `
      SELECT n.*,
             a.appointment_time,
             a.service
      FROM notifications n
      LEFT JOIN appointments a ON n.appointment_id = a.id
      WHERE n.user_id = $1
    `;
    const params = [req.userId];
    let paramIndex = 2;

    if (is_read !== undefined) {
      query += ` AND n.is_read = $${paramIndex++}`;
      params.push(is_read === 'true');
    }

    query += ` ORDER BY n.created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const result = await db.query(query, params);

    res.json({
      success: true,
      notifications: result.rows
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Ошибка получения уведомлений' });
  }
});

// Получить количество непрочитанных
router.get('/unread/count', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.userId]
    );

    res.json({
      success: true,
      count: parseInt(result.rows[0].count)
    });

  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Ошибка получения количества' });
  }
});

// Пометить уведомление как прочитанное
router.post('/:id/read', auth, async (req, res) => {
  try {
    const notificationId = req.params.id;

    // Проверка прав
    const notification = await db.query(
      'SELECT user_id FROM notifications WHERE id = $1',
      [notificationId]
    );

    if (notification.rows.length === 0) {
      return res.status(404).json({ error: 'Уведомление не найдено' });
    }

    if (notification.rows[0].user_id !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    await db.query(
      'UPDATE notifications SET is_read = true WHERE id = $1',
      [notificationId]
    );

    res.json({
      success: true,
      message: 'Уведомление прочитано'
    });

  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

// Пометить все уведомления как прочитанные
router.post('/read-all', auth, async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [req.userId]
    );

    res.json({
      success: true,
      message: 'Все уведомления прочитаны'
    });

  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

// Удалить уведомление
router.delete('/:id', auth, async (req, res) => {
  try {
    const notificationId = req.params.id;

    // Проверка прав
    const notification = await db.query(
      'SELECT user_id FROM notifications WHERE id = $1',
      [notificationId]
    );

    if (notification.rows.length === 0) {
      return res.status(404).json({ error: 'Уведомление не найдено' });
    }

    if (notification.rows[0].user_id !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    await db.query('DELETE FROM notifications WHERE id = $1', [notificationId]);

    res.json({
      success: true,
      message: 'Уведомление удалено'
    });

  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// Отправить рассылку (для владельцев салонов)
router.post('/broadcast', auth, async (req, res) => {
  try {
    // Проверка прав
    const user = await db.query(
      'SELECT is_salon_owner FROM users WHERE id = $1',
      [req.userId]
    );

    if (!user.rows[0]?.is_salon_owner) {
      return res.status(403).json({ error: 'Нет прав доступа' });
    }

    const { audience, title, message } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }

    // Получение списка получателей
    let recipients = [];

    if (audience === 'clients') {
      const result = await db.query(
        'SELECT id FROM users WHERE subscribed_salon_id = $1 AND is_master = false AND is_salon_owner = false',
        [req.userId]
      );
      recipients = result.rows.map(r => r.id);
    } else if (audience === 'masters') {
      const result = await db.query(
        'SELECT id FROM users WHERE subscribed_salon_id = $1 AND is_master = true',
        [req.userId]
      );
      recipients = result.rows.map(r => r.id);
    } else if (audience === 'all') {
      const result = await db.query(
        'SELECT id FROM users WHERE subscribed_salon_id = $1',
        [req.userId]
      );
      recipients = result.rows.map(r => r.id);
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'Нет получателей для рассылки' });
    }

    // Создание уведомлений для каждого получателя
    const values = recipients.map(userId => 
      `(${userId}, 'broadcast', '${title.replace(/'/g, "''")}', '${message.replace(/'/g, "''")}')`
    ).join(',');

    await db.query(
      `INSERT INTO notifications (user_id, type, title, message)
       VALUES ${values}`
    );

    res.json({
      success: true,
      message: `Рассылка отправлена ${recipients.length} получателям`
    });

  } catch (error) {
    console.error('Send broadcast error:', error);
    res.status(500).json({ error: 'Ошибка отправки рассылки' });
  }
});

module.exports = router;
