// backend/src/routes/aiInteraction.routes.js
// ==================== AI 交互记录路由 ====================
// 提供接口: 存储完整AI对话记录、查询AI交互历史
// 注意: 本路由仅负责持久化 AI 交互元数据, 不负责调用大模型
//       大模型调用仍在 ai.routes.js 中完成, 前端在收到回复后调用本接口存储

const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

/**
 * POST /api/ai-interactions/save
 * 存储完整AI对话记录 (仅持久化, 不调用大模型)
 *
 * @param {Object} req.body - 请求体
 * @param {string} req.body.session_id - 会话ID
 * @param {string} req.body.student_code - 学生编号
 * @param {string} req.body.ai_module - AI功能模块: sentence | passage | hint | free_chat
 * @param {string} req.body.user_question - 学生原始提问内容
 * @param {string} [req.body.ai_response] - AI完整回复内容
 * @param {string} [req.body.article_excerpt] - 对应的文章原文片段
 * @param {number} [req.body.article_id] - 关联文章编号
 * @param {number} [req.body.question_id] - 关联题目编号
 * @param {string} [req.body.model_name='deepseek-chat'] - 大模型名称
 * @param {number} req.body.request_timestamp - 发起提问时间戳 (Unix epoch 毫秒)
 * @param {number} [req.body.response_timestamp] - 接收回复时间戳
 * @param {string} [req.body.status='success'] - 交互状态: success | failed | timeout
 * @param {string} [req.body.error_message] - 错误信息
 * @returns {Object} JSON - { success, message, data: { interaction_id } }
 */
router.post('/save', async (req, res) => {
  try {
    const {
      session_id, student_code, ai_module, user_question,
      ai_response = null, article_excerpt = null,
      article_id = null, question_id = null,
      model_name = 'deepseek-chat',
      request_timestamp, response_timestamp = null,
      status = 'success', error_message = null,
    } = req.body;

    // 参数校验
    if (!session_id || !student_code || !ai_module || !user_question || !request_timestamp) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: session_id, student_code, ai_module, user_question, request_timestamp',
      });
    }

    // 计算响应耗时
    let responseDurationMs = null;
    if (response_timestamp) {
      responseDurationMs = response_timestamp - request_timestamp;
    }

    // 获取提示词版本号 (从环境变量读取)
    const promptVersion = process.env.PROMPT_VERSION || 'v1.0';

    // 写入 AI 交互记录 (15 个字段, response_duration_ms 由时间戳差值计算)
    const [result] = await pool.execute(
      `INSERT INTO ai_interactions 
        (session_id, student_code, ai_module, user_question, article_excerpt, 
         article_id, question_id, ai_response, model_name, prompt_version,
         request_timestamp, response_timestamp, response_duration_ms, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session_id, student_code, ai_module, user_question,
        article_excerpt, article_id, question_id,
        ai_response, model_name, promptVersion,
        request_timestamp, response_timestamp, responseDurationMs,
        status, error_message,
      ]
    );

    res.json({
      success: true,
      message: 'AI交互记录已保存',
      data: { interaction_id: result.insertId },
    });
  } catch (error) {
    console.error('[AI-Interaction] 保存失败:', error);
    res.status(500).json({ success: false, message: '保存失败: ' + error.message });
  }
});

/**
 * GET /api/ai-interactions/:session_id
 * 获取某会话的所有AI交互记录 (按请求时间升序)
 *
 * @param {string} req.params.session_id - 会话ID
 * @returns {Object} JSON - { success, data: ai_interactions[] }
 */
router.get('/:session_id', async (req, res) => {
  try {
    const { session_id } = req.params;
    const [rows] = await pool.execute(
      `SELECT * FROM ai_interactions WHERE session_id = ? ORDER BY request_timestamp ASC`,
      [session_id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[AI-Interaction] 查询失败:', error);
    res.status(500).json({ success: false, message: '查询失败: ' + error.message });
  }
});

module.exports = router;
