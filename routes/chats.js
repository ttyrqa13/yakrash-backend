// routes/chats.js - Управление чатами
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

// Получить все чаты пользователя
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*,
              CASE 
                WHEN c.user1_id = $1 THEN u2.id
                ELSE u1.id
              END as other_user_id,
              CASE 
                WHEN c.user1_id = $1 THEN u2.name
                ELSE u1.name
              END as other_user_name,
              CASE 
                WHEN c.user1_id = $1 THEN u2.username
                ELSE u1.username
              END as other_user_username,
              CASE 
                WHEN c.user1_id = $1 THEN u2.avatar_url
                ELSE u1.avatar_url
              END as other_user_avatar,
              (SELECT COUNT(*) FROM messages 
               WHERE chat_id = c.id 
               AND sender_id != $1 
               AND is_read = false) as unread_count
       FROM chats c
       LEFT JOIN users u1 ON c.user1_id = u1.id
       LEFT JOIN users u2 ON c.user2_id = u2.id
       WHERE c.user1_id = $1 OR c.user2_id = $1
       ORDER BY c.last_message_time DESC NULLS LAST`,
      [req.userId]
    );

    res.json({
      success: true,
      chats: result.rows
    });

  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Ошибка получения чатов' });
  }
});

// Получить или создать чат с пользователем
router.post('/with/:userId', auth, async (req, res) => {
  try {
    const otherUserId = parseInt(req.params.userId);

    if (otherUserId === req.userId) {
      return res.status(400).json({ error: 'Нельзя создать чат с самим собой' });
    }

    // Проверка существования пользователя
    const userCheck = await db.query(
      'SELECT id FROM users WHERE id = $1',
      [otherUserId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Поиск существующего чата
    const existing = await db.query(
      `SELECT * FROM chats 
       WHERE (user1_id = $1 AND user2_id = $2) 
       OR (user1_id = $2 AND user2_id = $1)`,
      [req.userId, otherUserId]
    );

    let chat;

    if (existing.rows.length > 0) {
      chat = existing.rows[0];
    } else {
      // Создание нового чата
      const newChat = await db.query(
        `INSERT INTO chats (user1_id, user2_id, type)
         VALUES ($1, $2, 'direct')
         RETURNING *`,
        [Math.min(req.userId, otherUserId), Math.max(req.userId, otherUserId)]
      );
      chat = newChat.rows[0];
    }

    res.json({
      success: true,
      chat
    });

  } catch (error) {
    console.error('Get or create chat error:', error);
    res.status(500).json({ error: 'Ошибка создания чата' });
  }
});

// Получить сообщения чата
router.get('/:chatId/messages', auth, async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const { limit = 50, before } = req.query;

    // Проверка доступа к чату
    const chat = await db.query(
      'SELECT * FROM chats WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [chatId, req.userId]
    );

    if (chat.rows.length === 0) {
      return res.status(403).json({ error: 'Нет доступа к этому чату' });
    }

    let query = `
      SELECT m.*,
             u.name as sender_name,
             u.avatar_url as sender_avatar
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = $1
    `;
    const params = [chatId];
    let paramIndex = 2;

    if (before) {
      query += ` AND m.id < $${paramIndex++}`;
      params.push(before);
    }

    query += ` ORDER BY m.created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const result = await db.query(query, params);

    // Пометить сообщения как прочитанные
    await db.query(
      `UPDATE messages 
       SET is_read = true, read_at = CURRENT_TIMESTAMP
       WHERE chat_id = $1 AND sender_id != $2 AND is_read = false`,
      [chatId, req.userId]
    );

    res.json({
      success: true,
      messages: result.rows.reverse() // Возвращаем в хронологическом порядке
    });

  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Ошибка получения сообщений' });
  }
});

// Отправить сообщение
router.post('/:chatId/messages', auth, async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    // Проверка доступа к чату
    const chat = await db.query(
      'SELECT * FROM chats WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [chatId, req.userId]
    );

    if (chat.rows.length === 0) {
      return res.status(403).json({ error: 'Нет доступа к этому чату' });
    }

    // Создание сообщения
    const message = await db.query(
      `INSERT INTO messages (chat_id, sender_id, text)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [chatId, req.userId, text.trim()]
    );

    // Обновление last_message в чате
    await db.query(
      `UPDATE chats 
       SET last_message = $1, last_message_time = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [text.trim().substring(0, 100), chatId]
    );

    res.status(201).json({
      success: true,
      message: message.rows[0]
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Ошибка отправки сообщения' });
  }
});

// Удалить чат
router.delete('/:chatId', auth, async (req, res) => {
  try {
    const chatId = req.params.chatId;

    // Проверка прав (только участники чата)
    const chat = await db.query(
      'SELECT * FROM chats WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [chatId, req.userId]
    );

    if (chat.rows.length === 0) {
      return res.status(403).json({ error: 'Нет доступа к этому чату' });
    }

    // Удаление чата (каскадно удалятся все сообщения)
    await db.query('DELETE FROM chats WHERE id = $1', [chatId]);

    res.json({
      success: true,
      message: 'Чат удален'
    });

  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({ error: 'Ошибка удаления чата' });
  }
});

// Пометить все сообщения как прочитанные
router.post('/:chatId/read', auth, async (req, res) => {
  try {
    const chatId = req.params.chatId;

    // Проверка доступа
    const chat = await db.query(
      'SELECT * FROM chats WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [chatId, req.userId]
    );

    if (chat.rows.length === 0) {
      return res.status(403).json({ error: 'Нет доступа к этому чату' });
    }

    await db.query(
      `UPDATE messages 
       SET is_read = true, read_at = CURRENT_TIMESTAMP
       WHERE chat_id = $1 AND sender_id != $2 AND is_read = false`,
      [chatId, req.userId]
    );

    res.json({
      success: true,
      message: 'Сообщения помечены как прочитанные'
    });

  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ error: 'Ошибка обновления статуса' });
  }
});

module.exports = router;
