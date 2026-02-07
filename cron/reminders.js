// cron/reminders.js - Автоматическая отправка напоминаний
const db = require('../config/database');
const nodemailer = require('nodemailer');

// Настройка SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Функция для отправки email
async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({
      from: `"ЯКраш" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html
    });
    console.log(`✅ Email sent to ${to}`);
    return true;
  } catch (error) {
    console.error(`❌ Email send error to ${to}:`, error.message);
    return false;
  }
}

// Форматирование даты для email
function formatDateTime(isoString) {
  const date = new Date(isoString);
  const options = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow'
  };
  return date.toLocaleString('ru-RU', options);
}

// HTML шаблон email
function createEmailTemplate(appointment, minutesBefore) {
  const timeText = minutesBefore === 1440 ? 'завтра' :
                   minutesBefore === 180 ? 'через 3 часа' :
                   minutesBefore === 60 ? 'через 1 час' :
                   minutesBefore === 30 ? 'через 30 минут' :
                   minutesBefore === 15 ? 'через 15 минут' :
                   `через ${minutesBefore} минут`;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #E87FAF, #D94E8C); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { margin: 0; font-size: 28px; }
        .content { background: #fff; padding: 30px; border: 1px solid #ddd; border-top: none; }
        .appointment-box { background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #E87FAF; }
        .appointment-box strong { color: #D94E8C; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        .button { display: inline-block; padding: 12px 24px; background: #E87FAF; color: white; text-decoration: none; border-radius: 6px; margin-top: 15px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>💗 Напоминание о записи</h1>
        </div>
        <div class="content">
          <p>Здравствуйте!</p>
          <p>Напоминаем, что у вас запись <strong>${timeText}</strong>:</p>
          
          <div class="appointment-box">
            <p><strong>Услуга:</strong> ${appointment.service}</p>
            <p><strong>Дата и время:</strong> ${formatDateTime(appointment.appointment_time)}</p>
            ${appointment.comment ? `<p><strong>Комментарий:</strong> ${appointment.comment}</p>` : ''}
            <p><strong>Клиент:</strong> ${appointment.client_name}</p>
            <p><strong>Телефон:</strong> ${appointment.client_phone}</p>
          </div>
          
          <p>Ждем вас!</p>
          
          <a href="${process.env.FRONTEND_URL}" class="button">Открыть ЯКраш</a>
        </div>
        <div class="footer">
          <p>ЯКраш - приложение для мастеров красоты</p>
          <p>Это автоматическое письмо, не отвечайте на него</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Главная функция проверки напоминаний (запускается каждую минуту)
async function checkReminders() {
  try {
    console.log('🔔 Checking reminders...');

    // Получаем все записи на ближайшие 24 часа
    const appointments = await db.query(
      `SELECT a.*, u.email, u.name as master_name
       FROM appointments a
       LEFT JOIN users u ON a.master_id = u.id
       WHERE a.status = 'upcoming'
       AND a.appointment_time > NOW()
       AND a.appointment_time <= NOW() + INTERVAL '24 hours'
       AND u.email IS NOT NULL`
    );

    if (appointments.rows.length === 0) {
      console.log('No upcoming appointments');
      return;
    }

    const now = new Date();

    for (const appointment of appointments.rows) {
      const appointmentTime = new Date(appointment.appointment_time);
      const minutesUntil = Math.floor((appointmentTime - now) / 1000 / 60);

      // Получаем настройки напоминаний
      let reminderMinutes = appointment.reminder_minutes || [];
      
      // Если -1 (по умолчанию), используем стандартные напоминания
      if (reminderMinutes.includes(-1)) {
        reminderMinutes = [1440, 180, 60]; // 24ч, 3ч, 1ч
      }

      // Удаляем нулевые значения (без напоминания)
      reminderMinutes = reminderMinutes.filter(m => m > 0);

      // Получаем уже отправленные напоминания
      const sentReminders = appointment.reminders_sent || [];

      // Проверяем каждое напоминание
      for (const reminderMin of reminderMinutes) {
        // Проверяем, не отправляли ли уже это напоминание
        if (sentReminders.includes(reminderMin)) {
          continue;
        }

        // Проверяем, пора ли отправить (с погрешностью ±2 минуты)
        if (Math.abs(minutesUntil - reminderMin) <= 2) {
          console.log(`Sending reminder for appointment ${appointment.id} (${reminderMin} minutes before)`);

          // Создаем уведомление в БД
          await db.query(
            `INSERT INTO notifications (user_id, type, title, message, appointment_id)
             VALUES ($1, 'appointment_reminder', $2, $3, $4)`,
            [
              appointment.master_id,
              'Напоминание о записи',
              `Запись через ${reminderMin === 1440 ? '24 часа' : 
                           reminderMin === 180 ? '3 часа' :
                           reminderMin === 60 ? '1 час' :
                           reminderMin + ' минут'}: ${appointment.service}`,
              appointment.id
            ]
          );

          // Отправляем email
          const emailSent = await sendEmail(
            appointment.email,
            `Напоминание о записи - ${appointment.service}`,
            createEmailTemplate(appointment, reminderMin)
          );

          if (emailSent) {
            // Добавляем в список отправленных
            sentReminders.push(reminderMin);

            // Обновляем в БД
            await db.query(
              'UPDATE appointments SET reminders_sent = $1 WHERE id = $2',
              [JSON.stringify(sentReminders), appointment.id]
            );
          }
        }
      }
    }

    console.log('✅ Reminders check completed');

  } catch (error) {
    console.error('❌ Reminders check error:', error);
  }
}

module.exports = checkReminders;
