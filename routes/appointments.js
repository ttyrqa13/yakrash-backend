// routes/appointments.js - Управление записями
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

// Получить все записи пользователя
router.get('/', auth, async (req, res) => {
  try {
    const { type, status, filter } = req.query;
    
    let query = `
      SELECT a.*, 
             u.name as client_user_name,
             u.avatar_url as client_avatar
      FROM appointments a
      LEFT JOIN users u ON a.client_id = u.id
      WHERE a.master_id = $1
    `;
    const params = [req.userId];
    let paramIndex = 2;

    // Фильтр по типу (personal / salon)
    if (type) {
      query += ` AND a.type = $${paramIndex++}`;
      params.push(type);
    }

    // Фильтр по статусу (upcoming / past / completed / cancelled)
    if (status) {
      query += ` AND a.status = $${paramIndex++}`;
      params.push(status);
    }

    // Фильтр upcoming/past по времени
    if (filter === 'upcoming') {
      query += ` AND a.appointment_time >= NOW()`;
    } else if (filter === 'past') {
      query += ` AND a.appointment_time < NOW()`;
    }

    query += ` ORDER BY a.appointment_time DESC`;

    const result = await db.query(query, params);

    res.json({
      success: true,
      appointments: result.rows
    });

  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ error: 'Ошибка получения записей' });
  }
});

// Получить запись по ID
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*, 
              u.name as client_user_name,
              u.avatar_url as client_avatar,
              m.name as master_name
       FROM appointments a
       LEFT JOIN users u ON a.client_id = u.id
       LEFT JOIN users m ON a.master_id = m.id
       WHERE a.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }

    const appointment = result.rows[0];

    // Проверка прав доступа
    if (appointment.master_id !== req.userId && appointment.client_id !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа к этой записи' });
    }

    res.json({
      success: true,
      appointment
    });

  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({ error: 'Ошибка получения записи' });
  }
});

// Создать запись
router.post('/', auth, async (req, res) => {
  try {
    const {
      clientName,
      clientPhone,
      clientId,
      service,
      appointmentTime,
      duration,
      comment,
      type,
      salonId,
      reminderMinutes
    } = req.body;

    // Валидация
    if (!clientName || !clientPhone || !service || !appointmentTime) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }

    const result = await db.query(
      `INSERT INTO appointments 
       (master_id, client_id, client_name, client_phone, service, 
        appointment_time, duration, comment, type, salon_id, reminder_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        req.userId,
        clientId || null,
        clientName,
        clientPhone,
        service,
        appointmentTime,
        duration || 60,
        comment || null,
        type || 'personal',
        salonId || null,
        JSON.stringify(reminderMinutes || [-1])
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Запись создана',
      appointment: result.rows[0]
    });

  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ error: 'Ошибка создания записи' });
  }
});

// Обновить запись
router.put('/:id', auth, async (req, res) => {
  try {
    const appointmentId = req.params.id;

    // Проверка прав
    const existing = await db.query(
      'SELECT master_id FROM appointments WHERE id = $1',
      [appointmentId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }

    if (existing.rows[0].master_id !== req.userId) {
      return res.status(403).json({ error: 'Нет прав для редактирования' });
    }

    const {
      clientName,
      clientPhone,
      service,
      appointmentTime,
      duration,
      comment,
      reminderMinutes,
      status
    } = req.body;

    // Формирование запроса
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (clientName) {
      updates.push(`client_name = $${paramIndex++}`);
      values.push(clientName);
    }
    if (clientPhone) {
      updates.push(`client_phone = $${paramIndex++}`);
      values.push(clientPhone);
    }
    if (service) {
      updates.push(`service = $${paramIndex++}`);
      values.push(service);
    }
    if (appointmentTime) {
      updates.push(`appointment_time = $${paramIndex++}`);
      values.push(appointmentTime);
    }
    if (duration) {
      updates.push(`duration = $${paramIndex++}`);
      values.push(duration);
    }
    if (comment !== undefined) {
      updates.push(`comment = $${paramIndex++}`);
      values.push(comment);
    }
    if (reminderMinutes) {
      updates.push(`reminder_minutes = $${paramIndex++}`);
      values.push(JSON.stringify(reminderMinutes));
    }
    if (status) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    values.push(appointmentId);

    const result = await db.query(
      `UPDATE appointments SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    res.json({
      success: true,
      message: 'Запись обновлена',
      appointment: result.rows[0]
    });

  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ error: 'Ошибка обновления записи' });
  }
});

// Удалить запись
router.delete('/:id', auth, async (req, res) => {
  try {
    const appointmentId = req.params.id;

    // Проверка прав
    const existing = await db.query(
      'SELECT master_id FROM appointments WHERE id = $1',
      [appointmentId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }

    if (existing.rows[0].master_id !== req.userId) {
      return res.status(403).json({ error: 'Нет прав для удаления' });
    }

    await db.query('DELETE FROM appointments WHERE id = $1', [appointmentId]);

    res.json({
      success: true,
      message: 'Запись удалена'
    });

  } catch (error) {
    console.error('Delete appointment error:', error);
    res.status(500).json({ error: 'Ошибка удаления записи' });
  }
});

// Получить записи салона (для админки)
router.get('/salon/all', auth, async (req, res) => {
  try {
    // Проверка прав
    const user = await db.query(
      'SELECT is_salon_owner FROM users WHERE id = $1',
      [req.userId]
    );

    if (!user.rows[0]?.is_salon_owner) {
      return res.status(403).json({ error: 'Нет прав доступа' });
    }

    const result = await db.query(
      `SELECT a.*,
              c.name as client_user_name,
              m.name as master_name
       FROM appointments a
       LEFT JOIN users c ON a.client_id = c.id
       LEFT JOIN users m ON a.master_id = m.id
       WHERE a.salon_id = $1
       ORDER BY a.appointment_time DESC`,
      [req.userId]
    );

    res.json({
      success: true,
      appointments: result.rows
    });

  } catch (error) {
    console.error('Get salon appointments error:', error);
    res.status(500).json({ error: 'Ошибка получения записей салона' });
  }
});

// Создать запись клиента в салоне (админка)
router.post('/salon/client', auth, async (req, res) => {
  try {
    // Проверка прав
    const user = await db.query(
      'SELECT is_salon_owner FROM users WHERE id = $1',
      [req.userId]
    );

    if (!user.rows[0]?.is_salon_owner) {
      return res.status(403).json({ error: 'Нет прав доступа' });
    }

    const {
      clientId,
      masterId,
      service,
      appointmentTime,
      duration,
      comment
    } = req.body;

    // Валидация
    if (!clientId || !masterId || !service || !appointmentTime) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }

    // Получение данных клиента
    const client = await db.query(
      'SELECT name, phone FROM users WHERE id = $1',
      [clientId]
    );

    if (client.rows.length === 0) {
      return res.status(404).json({ error: 'Клиент не найден' });
    }

    const result = await db.query(
      `INSERT INTO appointments 
       (master_id, client_id, client_name, client_phone, service, 
        appointment_time, duration, comment, type, salon_id, reminder_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'salon', $9, '[-1]')
       RETURNING *`,
      [
        masterId,
        clientId,
        client.rows[0].name,
        client.rows[0].phone,
        service,
        appointmentTime,
        duration || 60,
        comment || null,
        req.userId
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Запись клиента создана',
      appointment: result.rows[0]
    });

  } catch (error) {
    console.error('Create salon client appointment error:', error);
    res.status(500).json({ error: 'Ошибка создания записи' });
  }
});

module.exports = router;
