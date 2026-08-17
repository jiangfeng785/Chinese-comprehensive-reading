// backend/src/routes/behavior.routes.js
// ==================== 行为时序日志路由 ====================
// 提供接口: 批量写入行为事件日志
// 设计: 前端累积事件后批量上传, 减少请求次数, 提升性能

const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

/**
 * POST /api/behavior/batch
 * 批量写入行为时序日志
 *
 * @param {Array} req.body.events - 事件数组, 每条事件包含:
 * @param {string} req.body.events[].session_id - 会话ID
 * @param {string} [req.body.events[].student_code] - 学生编号 (可选)
 * @param {string} req.body.events[].event_type - 事件类型 (见 schema.sql 中的枚举说明)
 * @param {number} req.body.events[].event_timestamp - 事件时间戳 (Unix epoch 毫秒, 与眼动数据同基准)
 * @param {string} [req.body.events[].article_id] - 关联文章编号 (可选)
 * @param {string} [req.body.events[].question_id] - 关联题目编号 (可选)
 * @param {Object} [req.body.events[].event_data] - 事件详细数据 (JSON对象, 可选)
 * @returns {Object} data.inserted - 实际写入的记录数
 */
router.post('/batch', async (req, res) => {
  try {
    const { events } = req.body;

    if (!events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ success: false, message: 'events 不能为空' });
    }

    // 批量插入 SQL 构建
    // 使用 VALUES 语法批量插入, 比循环单条插入效率高
    const placeholders = [];
    const values = [];

    for (const evt of events) {
      if (!evt.session_id || !evt.event_type || !evt.event_timestamp) {
        console.warn('[Behavior] 跳过不完整事件:', evt);
        continue;
      }

      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        evt.session_id,
        evt.student_code || null,
        evt.event_type,
        evt.event_timestamp,
        evt.article_id || null,
        evt.question_id || null,
        evt.event_data ? JSON.stringify(evt.event_data) : null,
        new Date() // server_received_at (使用 NOW(3) 不行, 批量插入需手动传值)
      );
    }

    if (values.length === 0) {
      return res.status(400).json({ success: false, message: '没有有效的事件数据' });
    }

    const sql = `INSERT INTO behavior_logs 
      (session_id, student_code, event_type, event_timestamp, article_id, question_id, event_data, server_received_at)
      VALUES ${placeholders.join(', ')}`;

    const [result] = await pool.execute(sql, values);

    console.log(`[Behavior] 批量写入 ${result.affectedRows} 条行为日志`);

    res.json({
      success: true,
      message: `成功写入 ${result.affectedRows} 条行为日志`,
      data: { inserted: result.affectedRows },
    });
  } catch (error) {
    console.error('[Behavior] 批量写入失败:', error);
    res.status(500).json({ success: false, message: '写入失败: ' + error.message });
  }
});

/**
 * POST /api/behavior/single
 * 写入单条行为日志 (紧急事件或实时性要求高的场景使用)
 *
 * @param {string} req.body.session_id - 会话ID
 * @param {string} [req.body.student_code] - 学生编号 (可选)
 * @param {string} req.body.event_type - 事件类型
 * @param {number} req.body.event_timestamp - 事件时间戳 (Unix epoch 毫秒)
 * @param {string} [req.body.article_id] - 关联文章编号 (可选)
 * @param {string} [req.body.question_id] - 关联题目编号 (可选)
 * @param {Object} [req.body.event_data] - 事件详细数据 (JSON对象, 可选)
 * @returns {Object} data.log_id - 新建日志的自增ID
 */
router.post('/single', async (req, res) => {
  try {
    const {
      session_id, student_code, event_type, event_timestamp,
      article_id = null, question_id = null, event_data = null,
    } = req.body;

    if (!session_id || !event_type || !event_timestamp) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    const [result] = await pool.execute(
      `INSERT INTO behavior_logs 
        (session_id, student_code, event_type, event_timestamp, article_id, question_id, event_data, server_received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
      [
        session_id, student_code, event_type, event_timestamp,
        article_id, question_id,
        event_data ? JSON.stringify(event_data) : null,
      ]
    );

    res.json({ success: true, data: { log_id: result.insertId } });
  } catch (error) {
    console.error('[Behavior] 写入失败:', error);
    res.status(500).json({ success: false, message: '写入失败: ' + error.message });
  }
});

/**
 * GET /api/behavior/:session_id
 * 获取某会话的所有行为日志 (按事件时间戳升序排序)
 *
 * @param {string} req.params.session_id - 会话ID
 * @returns {Array} data - 行为日志记录数组
 */
router.get('/:session_id', async (req, res) => {
  try {
    const { session_id } = req.params;
    const [rows] = await pool.execute(
      `SELECT * FROM behavior_logs WHERE session_id = ? ORDER BY event_timestamp ASC`,
      [session_id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[Behavior] 查询失败:', error);
    res.status(500).json({ success: false, message: '查询失败: ' + error.message });
  }
});

module.exports = router;
