// backend/server.js
// ==================== 阅读实验平台后端服务 ====================
// 技术栈: Express + mysql2/promise + DeepSeek AI
//
// 职责:
//   1. 提供 REST API 接口, 接收前端采集的行为/答题/AI/眼动数据
//   2. 持久化所有数据到 MySQL, 供后续实验分析
//   3. 保留原有 AI 流式对话接口 (DeepSeek) 和题库管理接口
//   4. 开发环境开启 CORS 跨域

require('dotenv').config();

const express = require('express');
const cors = require('cors');
// 数据库连接池
const { testConnection } = require('./src/config/db');

// 路由模块
const sessionRoutes = require('./src/routes/session.routes');
const answerRoutes = require('./src/routes/answer.routes');
const behaviorRoutes = require('./src/routes/behavior.routes');
const aiInteractionRoutes = require('./src/routes/aiInteraction.routes');
const eyeTrackingRoutes = require('./src/routes/eyeTracking.routes');
const aiRoutes = require('./src/routes/ai.routes');
const articleRoutes = require('./src/routes/articleRoutes');
const profileRoutes = require('./src/routes/profile.routes');
const exportRoutes = require('./src/routes/export.routes');

// ==================== 创建 Express 应用 ====================
const app = express();

// 请求体大小限制 (10MB, 支持眼动数据批量上传)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS 跨域 (开发环境允许所有来源)
app.use(cors({
  origin: true,
  credentials: true,
}));

// ==================== 健康检查 ====================
/**
 * 健康检查接口, 返回服务运行状态与当前时间戳。
 * @param {import('express').Request} req - Express 请求对象
 * @param {import('express').Response} res - Express 响应对象
 */
app.get('/api/test', (req, res) => {
  res.json({ message: '后端服务运行正常', timestamp: Date.now() });
});

// ==================== 登录接口 (保留原有逻辑) ====================
/**
 * 参与者登录接口。
 * @param {import('express').Request} req - 请求体需包含 user_code 与 password
 * @param {import('express').Response} res - 返回登录结果与临时 user_id
 */
app.post('/api/auth/login', (req, res) => {
  const { user_code, password } = req.body;

  if (!user_code || user_code.trim() === '') {
    return res.status(400).json({
      success: false,
      message: '参与者编号不能为空',
    });
  }

  // 模拟登录 (实际项目可查数据库验证)
  res.json({
    success: true,
    user_id: String(Date.now()), // 临时 user_id
    user_code: user_code.trim(),
    message: '登录成功',
  });
});

// ==================== 数据采集路由 ====================
// 会话管理
app.use('/api/session', sessionRoutes);

// 答题记录
app.use('/api/answers', answerRoutes);

// 行为时序日志
app.use('/api/behavior', behaviorRoutes);

// AI 交互记录
app.use('/api/ai-interactions', aiInteractionRoutes);

// 眼动追踪数据
app.use('/api/eye-tracking', eyeTrackingRoutes);

// 原有 AI 流式对话接口 (保留)
app.use('/api/ai', aiRoutes);

// 原有题库管理接口 (保留)
app.use('/api/articles', articleRoutes);

// 个人记录查询接口
app.use('/api/profile', profileRoutes);

// 实验数据导出接口
app.use('/api/export', exportRoutes);

// ==================== 全局错误处理 ====================
/**
 * 全局错误处理中间件, 捕获路由抛出的异常并统一返回错误响应。
 * @param {Error} err - 捕获到的错误对象
 * @param {import('express').Request} req - Express 请求对象
 * @param {import('express').Response} res - Express 响应对象
 * @param {import('express').NextFunction} next - Express next 函数
 */
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || '服务器内部错误',
  });
});

// ==================== 启动服务器 ====================
const PORT = process.env.PORT || 5000;

/**
 * 启动服务器: 先验证数据库连接, 再监听指定端口。
 * @returns {Promise<void>}
 */
async function start() {
  // 先测试数据库连接, 失败则抛出异常终止启动
  await testConnection();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`  阅读实验平台后端已启动`);
    console.log(`  地址: http://localhost:${PORT}`);
    console.log(`  API 测试: http://localhost:${PORT}/api/test`);
    console.log(`========================================\n`);
  });
}

start();
