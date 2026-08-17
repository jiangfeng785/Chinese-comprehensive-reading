// backend/src/routes/session.routes.js
// ==================== 会话管理路由 ====================
// 提供接口: 创建阅读会话、更新会话状态、获取会话详情
// 核心规则: 同一学生 + 同一文章仅允许一条有效会话
//   - 存在 active 会话 -> 复用, 不新建
//   - 存在 completed/abandoned 会话 -> 禁止新建, 不可重复答题

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');

const router = express.Router();

/**
 * POST /api/session/create
 * 创建或复用阅读会话
 *
 * 规则:
 *   1. 同学生+同文章存在 active 会话 -> 返回该会话 (复用)
 *   2. 同学生+同文章存在 abandoned 会话 -> 重新激活 (允许继续答题)
 *   3. 同学生+同文章存在 completed 会话 -> 拒绝创建 (禁止重复答题)
 *   4. 无有效会话 -> 创建新会话
 *
 * @param {string} req.body.student_code - 学生编号
 * @param {string} req.body.article_id - 文章编号
 * @param {string} [req.body.question_id] - 题目编号 (可选)
 * @param {string} [req.body.experiment_group] - 实验组别 (可选)
 * @param {string} [req.body.user_agent] - 用户代理字符串 (可选)
 * @returns {Object} data - session_id, time_anchor, session_start, is_reused, accumulated_duration
 */
router.post('/create', async (req, res) => {
  try {
    const {
      student_code,
      article_id,
      question_id = null,
      experiment_group = null,
      user_agent = null,
    } = req.body;

    // 参数校验
    if (!student_code || !article_id) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: student_code, article_id',
      });
    }

    // ==================== 查询现有有效会话 ====================
    const [existingSessions] = await pool.execute(
      `SELECT session_id, status, time_anchor, session_start
       FROM sessions
       WHERE student_code = ? AND article_id = ?
       ORDER BY session_start DESC`,
      [student_code, article_id]
    );

    // 规则1: 存在 active 会话 -> 复用
    const activeSession = existingSessions.find(s => s.status === 'active');
    if (activeSession) {
      // 更新心跳 (用户重新进入了页面)
      await pool.execute(
        `UPDATE sessions SET last_heartbeat = NOW(3) WHERE session_id = ?`,
        [activeSession.session_id]
      );

      // 查累计有效学习时长 (所有已有 session 的时长之和, 不含当前 active)
      // 使用 COALESCE(session_end, last_heartbeat) 确保未正常关闭的 session 也有时长
      const [durRows] = await pool.execute(
        `SELECT COALESCE(SUM(
           TIMESTAMPDIFF(SECOND, session_start, COALESCE(session_end, last_heartbeat))
         ), 0) AS accumulated
         FROM sessions
         WHERE student_code = ? AND session_id != ?`,
        [student_code, activeSession.session_id]
      );
      const accumulatedDuration = Number(durRows[0]?.accumulated || 0);

      console.log(`[Session] 复用进行中会话: ${activeSession.session_id}, 学生: ${student_code}, 文章: ${article_id}`);
      return res.json({
        success: true,
        data: {
          session_id: activeSession.session_id,
          time_anchor: activeSession.time_anchor,
          session_start: activeSession.session_start,
          is_reused: true,
          accumulated_duration: accumulatedDuration,
        },
      });
    }

    // 规则2a: 存在 abandoned 会话 -> 重新激活 (学生中途退出, 允许继续答题)
    const abandonedSession = existingSessions.find(s => s.status === 'abandoned');
    if (abandonedSession) {
      await pool.execute(
        `UPDATE sessions SET status = 'active', session_end = NULL, last_heartbeat = NOW(3) WHERE session_id = ?`,
        [abandonedSession.session_id]
      );

      const [durRowsAb] = await pool.execute(
        `SELECT COALESCE(SUM(
           TIMESTAMPDIFF(SECOND, session_start, COALESCE(session_end, last_heartbeat))
         ), 0) AS accumulated
         FROM sessions
         WHERE student_code = ? AND session_id != ?`,
        [student_code, abandonedSession.session_id]
      );
      const accumulatedDurationAb = Number(durRowsAb[0]?.accumulated || 0);

      console.log(`[Session] 重新激活已放弃会话: ${abandonedSession.session_id}, 学生: ${student_code}, 文章: ${article_id}`);
      return res.json({
        success: true,
        data: {
          session_id: abandonedSession.session_id,
          time_anchor: abandonedSession.time_anchor,
          session_start: abandonedSession.session_start,
          is_reused: true,
          accumulated_duration: accumulatedDurationAb,
        },
      });
    }

    // 规则2b: 存在 completed 会话 -> 禁止重复答题
    const completedSession = existingSessions.find(s => s.status === 'completed');
    if (completedSession) {
      return res.status(409).json({
        success: false,
        message: '该文章已完成阅读，不可重复答题',
        code: 'ALREADY_COMPLETED',
        data: {
          existing_session_id: completedSession.session_id,
          existing_status: completedSession.status,
        },
      });
    }

    // 规则3: 无有效会话 -> 创建新会话
    const sessionId = uuidv4();
    const timeAnchor = Date.now();

    await pool.execute(
      `INSERT INTO sessions
        (session_id, student_code, article_id, question_id, session_start, last_heartbeat, status, time_anchor, experiment_group, user_agent)
       VALUES (?, ?, ?, ?, NOW(3), NOW(3), 'active', ?, ?, ?)`,
      [sessionId, student_code, article_id, question_id, timeAnchor, experiment_group, user_agent]
    );

    // 查累计有效学习时长 (该学生所有历史 session 的时长之和)
    // 使用 COALESCE(session_end, last_heartbeat) 确保未正常关闭的 session 也有时长
    const [durRows2] = await pool.execute(
      `SELECT COALESCE(SUM(
         TIMESTAMPDIFF(SECOND, session_start, COALESCE(session_end, last_heartbeat))
       ), 0) AS accumulated
       FROM sessions
       WHERE student_code = ? AND session_id != ?`,
      [student_code, sessionId]
    );
    const accumulatedDuration2 = Number(durRows2[0]?.accumulated || 0);

    console.log(`[Session] 创建会话: ${sessionId}, 学生: ${student_code}, 文章: ${article_id}`);

    res.json({
      success: true,
      data: {
        session_id: sessionId,
        time_anchor: timeAnchor,
        session_start: new Date().toISOString(),
        is_reused: false,
        accumulated_duration: accumulatedDuration2,
      },
    });
  } catch (error) {
    console.error('[Session] 创建会话失败:', error);
    res.status(500).json({ success: false, message: '创建会话失败: ' + error.message });
  }
});

/**
 * POST /api/session/end
 * 结束阅读会话 (学生提交答案或离开时调用)
 *
 * @param {string} req.body.session_id - 会话ID
 * @param {string} [req.body.status='completed'] - 结束状态: completed | abandoned
 * @param {*} [req.body.calibration_quality] - 眼动校准质量 (可选)
 * @returns {Object} message - 操作结果描述
 */
router.post('/end', async (req, res) => {
  try {
    const { session_id, status = 'completed', calibration_quality = null } = req.body;

    if (!session_id) {
      return res.status(400).json({ success: false, message: '缺少 session_id' });
    }

    await pool.execute(
      `UPDATE sessions SET session_end = NOW(3), last_heartbeat = NOW(3), status = ?, calibration_quality = ? WHERE session_id = ?`,
      [status, calibration_quality, session_id]
    );

    console.log(`[Session] 结束会话: ${session_id}, 状态: ${status}`);
    res.json({ success: true, message: '会话已结束' });
  } catch (error) {
    console.error('[Session] 结束会话失败:', error);
    res.status(500).json({ success: false, message: '结束会话失败: ' + error.message });
  }
});

/**
 * POST /api/session/heartbeat
 * 心跳上报 (前端每 30 秒调用一次)
 * 用于在页面异常关闭时仍能估算学习时长
 *
 * @param {string} req.body.session_id - 会话ID
 * @returns {Object} success - 操作是否成功
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id) {
      return res.status(400).json({ success: false, message: '缺少 session_id' });
    }
    await pool.execute(
      `UPDATE sessions SET last_heartbeat = NOW(3) WHERE session_id = ? AND status = 'active'`,
      [session_id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('[Session] 心跳更新失败:', error);
    res.status(500).json({ success: false, message: '心跳更新失败: ' + error.message });
  }
});

/**
 * GET /api/session/:session_id
 * 获取会话详情 (含统计数据)
 *
 * @param {string} req.params.session_id - 会话ID
 * @returns {Object} data - 完整的会话记录行
 */
router.get('/:session_id', async (req, res) => {
  try {
    const { session_id } = req.params;

    const [rows] = await pool.execute(
      `SELECT * FROM sessions WHERE session_id = ?`,
      [session_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '会话不存在' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('[Session] 查询会话失败:', error);
    res.status(500).json({ success: false, message: '查询失败: ' + error.message });
  }
});

/**
 * GET /api/session/check/:student_code/:article_id
 * 检查某学生对某文章的会话状态 (前端用于判断是否可进入答题)
 *
 * @param {string} req.params.student_code - 学生编号
 * @param {string} req.params.article_id - 文章编号
 * @returns {Object} data - has_session, has_active, has_completed, can_start, latest_session_id, latest_status
 */
router.get('/check/:student_code/:article_id', async (req, res) => {
  try {
    const { student_code, article_id } = req.params;

    const [rows] = await pool.execute(
      `SELECT session_id, status, session_start, session_end, time_anchor
       FROM sessions
       WHERE student_code = ? AND article_id = ?
       ORDER BY session_start DESC`,
      [student_code, article_id]
    );

    if (rows.length === 0) {
      return res.json({ success: true, data: { has_session: false, can_start: true } });
    }

    const latest = rows[0];
    const hasActive = rows.some(s => s.status === 'active');
    const hasCompleted = rows.some(s => s.status === 'completed');

    // 仅当无进行中且无已完成会话时, 才允许新建 (abandoned 可重新激活)
    res.json({
      success: true,
      data: {
        has_session: true,
        has_active: hasActive,
        has_completed: hasCompleted,
        can_start: !hasActive && !hasCompleted,
        latest_session_id: latest.session_id,
        latest_status: latest.status,
      },
    });
  } catch (error) {
    console.error('[Session] 检查会话状态失败:', error);
    res.status(500).json({ success: false, message: '查询失败: ' + error.message });
  }
});

module.exports = router;
