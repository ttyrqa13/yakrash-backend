// config/database.js - Подключение к PostgreSQL
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false
});

// Тест подключения
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Подключение к PostgreSQL успешно');
    client.release();
  } catch (err) {
    console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
    process.exit(1);
  }
}

// Запрос к БД с обработкой ошибок
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

module.exports = {
  pool,
  query,
  testConnection
};
