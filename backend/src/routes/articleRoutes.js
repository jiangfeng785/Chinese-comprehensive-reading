// backend/src/routes/articleRoutes.js
// ==================== 题库管理路由 (从 Fastify 迁移到 Express) ====================
// 负责题库（阅读文章）的读取与导入，数据以 JSON 文件存储，不入 MySQL。
// 提供接口:
//   GET  /api/articles    - 获取题库
//   POST /api/articles    - 导入/更新题库
//
// 题库仍以 JSON 文件形式存储 (data/articles.json), 不入 MySQL
// (题库是配置数据, 与实验采集数据分离)

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const ARTICLES_FILE = path.join(__dirname, '../../data/articles.json');

/**
 * 读取题库文件并解析为数组。
 * 文件不存在或解析失败时返回空数组，保证调用方始终拿到数组。
 * @returns {Array<object>} 题库文章数组
 */
function readArticles() {
  try {
    const data = fs.readFileSync(ARTICLES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

/**
 * 将题库数组写入 JSON 文件。
 * 写入前确保目标目录存在（递归创建），保证首次写入不报错。
 * @param {Array<object>} articles - 待持久化的题库文章数组
 * @returns {void}
 */
function writeArticles(articles) {
  const dir = path.dirname(ARTICLES_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2), 'utf8');
}

/**
 * GET /api/articles
 * 获取题库
 * @returns {object} { success: boolean, data: Array<object> }
 */
router.get('/', (req, res) => {
  const articles = readArticles();
  res.json({ success: true, data: articles });
});

/**
 * POST /api/articles
 * 导入/更新题库
 * 请求体: { articles: [...] }
 * 校验：必须为数组且首元素包含 id 与 title 字段
 * @returns {object} { success: boolean, message?: string }
 */
router.post('/', (req, res) => {
  const { articles } = req.body;
  if (!articles || !Array.isArray(articles)) {
    return res.status(400).json({ success: false, message: '无效的题库格式' });
  }
  // 抽查首元素结构，防止导入格式错误的数据
  if (articles.length > 0 && (!articles[0].id || !articles[0].title)) {
    return res.status(400).json({ success: false, message: '题库结构错误: 缺少 id 或 title' });
  }
  writeArticles(articles);
  res.json({ success: true, message: `成功导入 ${articles.length} 篇文章` });
});

module.exports = router;
