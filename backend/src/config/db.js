// backend/src/config/db.js
// ==================== MySQL 连接池配置 ====================
// 使用 mysql2/promise 创建连接池, 支持高并发批量写入

const mysql = require('mysql2/promise');
require('dotenv').config();

// 创建数据库连接池
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'reading_platform',
  waitForConnections: true,
  // 连接池上限, 环境变量未配置或解析失败时回退为 10
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
  // 确保中文正确存储
  charset: 'utf8mb4_unicode_ci',
  // 时区设置为 +00:00, 服务器自行处理时区转换
  timezone: '+00:00',
});

/**
 * 测试数据库连接是否可用。
 * 从连接池获取一个连接并执行 ping, 成功后释放;
 * 失败则打印排查指引并抛出异常, 由调用方决定是否退出进程。
 * @returns {Promise<void>}
 * @throws {Error} 当连接获取或 ping 失败时抛出
 */
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('[DB] MySQL 连接池已就绪');
  } catch (error) {
    console.error('[DB] MySQL 连接失败:', error.message);
    console.error('[DB] 请检查:');
    console.error('  1. MySQL 服务是否已启动');
    console.error('  2. backend/.env 中的数据库配置是否正确');
    console.error('  3. database/schema.sql 是否已执行建表');
    throw error;
  }
}

module.exports = { pool, testConnection };
