// backend/src/routes/eyeTracking.routes.js
// ==================== 眼动追踪数据路由 ====================
// 提供接口: 批量接收并持久化眼动数据流
// 设计: 眼动设备通过前端推送数据, 前端打上统一时间戳后转发到后端
//       后端批量写入 MySQL, 与 behavior_logs 共用同一时间基准

const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

/**
 * POST /api/eye-tracking/batch
 * 批量写入眼动追踪数据
 *
 * @param {string} req.body.session_id - 会话ID
 * @param {Array} req.body.data_points - 眼动数据数组, 每条包含:
 * @param {number} req.body.data_points[].timestamp - 数据时间戳 (Unix epoch 毫秒, 与行为日志同基准)
 * @param {('reading'|'question'|'options'|'ai_chat'|'note'|'other')} req.body.data_points[].aoi_type - 兴趣区域类型
 * @param {number} [req.body.data_points[].fixation_duration_ms] - 注视时长 (毫秒, 可选)
 * @param {number} [req.body.data_points[].fixation_x] - 注视点 X 坐标 (可选)
 * @param {number} [req.body.data_points[].fixation_y] - 注视点 Y 坐标 (可选)
 * @param {string} [req.body.data_points[].transition_from] - 切换来源区域 (可选)
 * @param {number} [req.body.data_points[].transition_event=0] - 是否为区域切换事件 (0/1, 默认0)
 * @param {*} [req.body.data_points[].calibration_quality] - 校准质量 (可选)
 * @param {number} [req.body.data_points[].data_missing=0] - 数据缺失标记 (0/1, 默认0)
 * @param {Object} [req.body.data_points[].raw_data] - 原始数据 (JSON对象, 可选)
 * @returns {Object} data.inserted - 实际写入的记录数
 */
router.post('/batch', async (req, res) => {
  try {
    const { session_id, data_points } = req.body;

    if (!session_id || !data_points || !Array.isArray(data_points) || data_points.length === 0) {
      return res.status(400).json({ success: false, message: 'session_id 和 data_points 不能为空' });
    }

    // 查询学生编号 (从会话表获取)
    const [sessionRows] = await pool.execute(
      `SELECT student_code FROM sessions WHERE session_id = ?`,
      [session_id]
    );

    if (sessionRows.length === 0) {
      return res.status(404).json({ success: false, message: '会话不存在' });
    }

    const studentCode = sessionRows[0].student_code;

    // 批量插入 SQL 构建
    const placeholders = [];
    const values = [];

    for (const dp of data_points) {
      if (!dp.timestamp || !dp.aoi_type) {
        console.warn('[EyeTracking] 跳过不完整数据点:', dp);
        continue;
      }

      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        session_id,
        studentCode,
        dp.timestamp,
        dp.aoi_type,
        dp.fixation_duration_ms || null,
        dp.fixation_x || null,
        dp.fixation_y || null,
        dp.transition_from || null,
        dp.transition_event || 0,
        dp.calibration_quality || null,
        dp.data_missing || 0,
        dp.raw_data ? JSON.stringify(dp.raw_data) : null,
        new Date() // server_received_at
      );
    }

    if (values.length === 0) {
      return res.status(400).json({ success: false, message: '没有有效的眼动数据' });
    }

    const sql = `INSERT INTO eye_tracking_data 
      (session_id, student_code, timestamp, aoi_type, 
       fixation_duration_ms, fixation_x, fixation_y, 
       transition_from, transition_event, calibration_quality, 
       data_missing, raw_data, server_received_at)
      VALUES ${placeholders.join(', ')}`;

    const [result] = await pool.execute(sql, values);

    console.log(`[EyeTracking] 批量写入 ${result.affectedRows} 条眼动数据, 会话: ${session_id}`);

    res.json({
      success: true,
      message: `成功写入 ${result.affectedRows} 条眼动数据`,
      data: { inserted: result.affectedRows },
    });
  } catch (error) {
    console.error('[EyeTracking] 批量写入失败:', error);
    res.status(500).json({ success: false, message: '写入失败: ' + error.message });
  }
});

/**
 * GET /api/eye-tracking/:session_id
 * 获取某会话的所有眼动数据 (按时间戳升序排序)
 *
 * @param {string} req.params.session_id - 会话ID
 * @param {string} [req.query.aoi_type] - 筛选特定兴趣区域类型 (可选)
 * @returns {Array} data - 眼动数据记录数组
 */
router.get('/:session_id', async (req, res) => {
  try {
    const { session_id } = req.params;
    const { aoi_type } = req.query;

    let sql = `SELECT * FROM eye_tracking_data WHERE session_id = ?`;
    const params = [session_id];

    if (aoi_type) {
      sql += ` AND aoi_type = ?`;
      params.push(aoi_type);
    }

    sql += ` ORDER BY timestamp ASC`;

    const [rows] = await pool.execute(sql, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[EyeTracking] 查询失败:', error);
    res.status(500).json({ success: false, message: '查询失败: ' + error.message });
  }
});

module.exports = router;
