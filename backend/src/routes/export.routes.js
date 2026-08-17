// backend/src/routes/export.routes.js
// 实验数据导出路由 - 管理员导出参与者实验数据 (CSV/JSON)
// 权限: 仅管理员 (student_code = 'test') 可访问; 数据按 学生→文章→题目 分层排序

const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

// 管理员账号白名单
const ADMIN_CODES = ['test'];

/**
 * 中间件: 检查管理员权限
 * 仅 student_code = 'test' 可访问导出接口
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @param {Function} next - 下一个中间件
 */
function requireAdmin(req, res, next) {
  const studentCode = req.query.student_code || req.headers['x-student-code'];
  if (!studentCode || !ADMIN_CODES.includes(studentCode)) {
    return res.status(403).json({
      success: false,
      message: '无导出权限, 仅管理员账号可使用',
    });
  }
  next();
}

// ==================== CSV 转义辅助 ====================

/**
 * CSV 字段转义 - 包含逗号/引号/换行的字段用双引号包裹并转义内部引号
 * @param {*} val - 任意值
 * @returns {string} 转义后的 CSV 字段
 */
function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * 将数组拼接为一行 CSV (各字段经 csvEscape 转义后用逗号连接)
 * @param {Array} arr - 字段值数组
 * @returns {string} CSV 行
 */
function csvRow(arr) {
  return arr.map(csvEscape).join(',');
}

/**
 * GET /api/export/admin/all?student_code=test
 * 管理员导出全部参与者实验数据 (CSV)
 *
 * 数据组织: 按学生编号 -> 文章ID -> 题目ID 分层排序
 * 包含 5 个数据段:
 *   1. SESSION INFO    - 会话基础信息
 *   2. ANSWERS         - 答题记录 (含 initial_answer / final_answer / is_correct)
 *   3. BEHAVIOR LOGS   - 全时序行为事件
 *   4. AI INTERACTIONS - AI交互完整日志
 *   5. EYE TRACKING    - 眼动追踪数据
 *
 * @returns {CSV} UTF-8 BOM CSV 文件下载
 */
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    // ==================== 查询全部数据 (按学生→文章→题目排序) ====================

    // 所有会话 (按学生→文章→开始时间排序)
    const [sessions] = await pool.execute(
      `SELECT
         session_id, student_code, article_id, question_id,
         session_start, session_end, status, time_anchor,
         calibration_quality, experiment_group, user_agent
       FROM sessions
       ORDER BY student_code, article_id, session_start ASC`
    );

    if (sessions.length === 0) {
      return res.status(404).json({ success: false, message: '无实验数据' });
    }

    // 所有答题记录 (按学生→文章→题目→提交时间排序)
    const [answers] = await pool.execute(
      `SELECT
         answer_id, session_id, student_code, article_id, question_id,
         initial_answer, final_answer, correct_answer, is_correct,
         answer_history, first_answered_at, final_submitted_at
       FROM answers
       ORDER BY student_code, article_id, question_id, final_submitted_at ASC`
    );

    // 所有行为日志 (按学生→文章→时间戳排序, NULL article_id 排最后)
    const [behaviors] = await pool.execute(
      `SELECT
         log_id, session_id, student_code, event_type, event_timestamp,
         article_id, question_id, event_data, server_received_at
       FROM behavior_logs
       ORDER BY student_code ASC,
                COALESCE(article_id, 999999) ASC,
                event_timestamp ASC`
    );

    // 所有 AI 交互记录 (按学生→文章→请求时间排序)
    const [aiInteractions] = await pool.execute(
      `SELECT
         interaction_id, session_id, student_code, ai_module,
         user_question, article_excerpt, article_id, question_id,
         ai_response, model_name, prompt_version,
         request_timestamp, response_timestamp, response_duration_ms,
         status, error_message
       FROM ai_interactions
       ORDER BY student_code ASC,
                COALESCE(article_id, 999999) ASC,
                request_timestamp ASC`
    );

    // 所有眼动追踪数据 (JOIN sessions 获取 article_id 用于排序)
    const [eyeData] = await pool.execute(
      `SELECT
         e.eye_data_id, e.session_id, e.student_code, e.timestamp,
         e.aoi_type, e.fixation_duration_ms, e.fixation_x, e.fixation_y,
         e.transition_from, e.transition_event, e.calibration_quality,
         e.data_missing, e.raw_data, e.server_received_at,
         s.article_id
       FROM eye_tracking_data e
       LEFT JOIN sessions s ON e.session_id = s.session_id
       ORDER BY e.student_code ASC,
                COALESCE(s.article_id, 999999) ASC,
                e.timestamp ASC`
    );

    // ==================== 构建 CSV ====================
    const parts = [];

    // ---- Section 1: SESSION INFO ----
    parts.push('=== SESSION INFO ===');
    parts.push('session_id,student_code,article_id,question_id,session_start,session_end,status,time_anchor,calibration_quality,experiment_group');
    for (const s of sessions) {
      parts.push(csvRow([
        s.session_id, s.student_code, s.article_id, s.question_id || '',
        s.session_start, s.session_end, s.status, s.time_anchor,
        s.calibration_quality || '', s.experiment_group || ''
      ]));
    }
    parts.push('');

    // ---- Section 2: ANSWERS ----
    parts.push('=== ANSWERS ===');
    parts.push('answer_id,session_id,student_code,article_id,question_id,initial_answer,final_answer,correct_answer,is_correct,first_answered_at,final_submitted_at');
    for (const a of answers) {
      parts.push(csvRow([
        a.answer_id, a.session_id, a.student_code, a.article_id, a.question_id,
        a.initial_answer || '', a.final_answer || '', a.correct_answer || '',
        a.is_correct !== null ? a.is_correct : '',
        a.first_answered_at, a.final_submitted_at || ''
      ]));
    }
    parts.push('');

    // ---- Section 3: BEHAVIOR LOGS ----
    parts.push('=== BEHAVIOR LOGS ===');
    parts.push('log_id,session_id,student_code,event_type,event_timestamp,article_id,question_id,event_data,server_received_at');
    for (const b of behaviors) {
      const ed = b.event_data
        ? (typeof b.event_data === 'string' ? b.event_data : JSON.stringify(b.event_data))
        : '';
      parts.push(csvRow([
        b.log_id, b.session_id, b.student_code, b.event_type, b.event_timestamp,
        b.article_id || '', b.question_id || '', ed, b.server_received_at
      ]));
    }
    parts.push('');

    // ---- Section 4: AI INTERACTIONS ----
    parts.push('=== AI INTERACTIONS ===');
    parts.push('interaction_id,session_id,student_code,ai_module,user_question,article_excerpt,article_id,question_id,ai_response,model_name,prompt_version,request_timestamp,response_timestamp,response_duration_ms,status,error_message');
    for (const ai of aiInteractions) {
      parts.push(csvRow([
        ai.interaction_id, ai.session_id, ai.student_code, ai.ai_module,
        ai.user_question, ai.article_excerpt || '', ai.article_id || '', ai.question_id || '',
        ai.ai_response || '', ai.model_name, ai.prompt_version,
        ai.request_timestamp, ai.response_timestamp || '', ai.response_duration_ms || '',
        ai.status || '', ai.error_message || ''
      ]));
    }
    parts.push('');

    // ---- Section 5: EYE TRACKING DATA ----
    parts.push('=== EYE TRACKING DATA ===');
    parts.push('eye_data_id,session_id,student_code,timestamp,aoi_type,fixation_duration_ms,fixation_x,fixation_y,transition_from,transition_event,calibration_quality,data_missing');
    for (const e of eyeData) {
      parts.push(csvRow([
        e.eye_data_id, e.session_id, e.student_code, e.timestamp,
        e.aoi_type, e.fixation_duration_ms || '', e.fixation_x || '', e.fixation_y || '',
        e.transition_from || '', e.transition_event !== null ? e.transition_event : '',
        e.calibration_quality || '', e.data_missing !== null ? e.data_missing : ''
      ]));
    }

    // ==================== 输出 CSV ====================
    const csv = '\uFEFF' + parts.join('\n'); // BOM for Excel UTF-8

    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="experiment_all_${timestamp}.csv"`);
    res.send(csv);

    console.log(`[Export] 管理员导出完成: ${sessions.length} 会话, ${answers.length} 答题, ${behaviors.length} 行为, ${aiInteractions.length} AI交互, ${eyeData.length} 眼动`);
  } catch (error) {
    console.error('[Export] 管理员导出失败:', error);
    res.status(500).json({ success: false, message: '导出失败: ' + error.message });
  }
});

/**
 * GET /api/export/admin/student/:target_code?student_code=test
 * 管理员导出单个学生的全部实验数据 (CSV)
 *
 * @param {string} req.params.target_code - 目标学生编号
 * @returns {CSV} UTF-8 BOM CSV 文件下载
 */
router.get('/admin/student/:target_code', requireAdmin, async (req, res) => {
  try {
    const { target_code } = req.params;

    const [sessions] = await pool.execute(
      `SELECT * FROM sessions WHERE student_code = ? ORDER BY article_id, session_start ASC`,
      [target_code]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ success: false, message: `学生 ${target_code} 无实验数据` });
    }

    const sessionIds = sessions.map(s => s.session_id);
    const placeholders = sessionIds.map(() => '?').join(',');

    const [answers] = await pool.execute(
      `SELECT * FROM answers WHERE session_id IN (${placeholders}) ORDER BY article_id, question_id, final_submitted_at ASC`,
      sessionIds
    );

    const [behaviors] = await pool.execute(
      `SELECT * FROM behavior_logs WHERE session_id IN (${placeholders}) ORDER BY COALESCE(article_id, 999999) ASC, event_timestamp ASC`,
      sessionIds
    );

    const [aiInteractions] = await pool.execute(
      `SELECT * FROM ai_interactions WHERE session_id IN (${placeholders}) ORDER BY COALESCE(article_id, 999999) ASC, request_timestamp ASC`,
      sessionIds
    );

    // 眼动数据无 article_id 字段, 通过 JOIN sessions 获取
    const [eyeData] = await pool.execute(
      `SELECT e.*, s.article_id
       FROM eye_tracking_data e
       LEFT JOIN sessions s ON e.session_id = s.session_id
       WHERE e.session_id IN (${placeholders})
       ORDER BY COALESCE(s.article_id, 999999) ASC, e.timestamp ASC`,
      sessionIds
    );

    // 构建 CSV (与 admin/all 同格式)
    const parts = [];

    parts.push('=== SESSION INFO ===');
    parts.push('session_id,student_code,article_id,question_id,session_start,session_end,status,time_anchor,calibration_quality,experiment_group');
    for (const s of sessions) {
      parts.push(csvRow([s.session_id, s.student_code, s.article_id, s.question_id || '', s.session_start, s.session_end, s.status, s.time_anchor, s.calibration_quality || '', s.experiment_group || '']));
    }
    parts.push('');

    parts.push('=== ANSWERS ===');
    parts.push('answer_id,session_id,student_code,article_id,question_id,initial_answer,final_answer,correct_answer,is_correct,first_answered_at,final_submitted_at');
    for (const a of answers) {
      parts.push(csvRow([a.answer_id, a.session_id, a.student_code, a.article_id, a.question_id, a.initial_answer || '', a.final_answer || '', a.correct_answer || '', a.is_correct !== null ? a.is_correct : '', a.first_answered_at, a.final_submitted_at || '']));
    }
    parts.push('');

    parts.push('=== BEHAVIOR LOGS ===');
    parts.push('log_id,session_id,student_code,event_type,event_timestamp,article_id,question_id,event_data,server_received_at');
    for (const b of behaviors) {
      const ed = b.event_data ? (typeof b.event_data === 'string' ? b.event_data : JSON.stringify(b.event_data)) : '';
      parts.push(csvRow([b.log_id, b.session_id, b.student_code, b.event_type, b.event_timestamp, b.article_id || '', b.question_id || '', ed, b.server_received_at]));
    }
    parts.push('');

    parts.push('=== AI INTERACTIONS ===');
    parts.push('interaction_id,session_id,student_code,ai_module,user_question,article_excerpt,article_id,question_id,ai_response,model_name,prompt_version,request_timestamp,response_timestamp,response_duration_ms,status,error_message');
    for (const ai of aiInteractions) {
      parts.push(csvRow([ai.interaction_id, ai.session_id, ai.student_code, ai.ai_module, ai.user_question, ai.article_excerpt || '', ai.article_id || '', ai.question_id || '', ai.ai_response || '', ai.model_name, ai.prompt_version, ai.request_timestamp, ai.response_timestamp || '', ai.response_duration_ms || '', ai.status || '', ai.error_message || '']));
    }
    parts.push('');

    parts.push('=== EYE TRACKING DATA ===');
    parts.push('eye_data_id,session_id,student_code,timestamp,aoi_type,fixation_duration_ms,fixation_x,fixation_y,transition_from,transition_event,calibration_quality,data_missing');
    for (const e of eyeData) {
      parts.push(csvRow([e.eye_data_id, e.session_id, e.student_code, e.timestamp, e.aoi_type, e.fixation_duration_ms || '', e.fixation_x || '', e.fixation_y || '', e.transition_from || '', e.transition_event !== null ? e.transition_event : '', e.calibration_quality || '', e.data_missing !== null ? e.data_missing : '']));
    }

    const csv = '\uFEFF' + parts.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="experiment_${target_code}_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);

    console.log(`[Export] 导出学生 ${target_code} 数据: ${sessions.length} 会话`);
  } catch (error) {
    console.error('[Export] 单学生导出失败:', error);
    res.status(500).json({ success: false, message: '导出失败: ' + error.message });
  }
});

/**
 * GET /api/export/session/:session_id (JSON)
 * 导出某会话的完整实验数据 (JSON 格式)
 *
 * @param {string} req.params.session_id - 会话ID
 * @returns {Object} JSON - { success, data: { session, answers, behavior_logs, ai_interactions, eye_tracking_data } }
 */
router.get('/session/:session_id', async (req, res) => {
  try {
    const { session_id } = req.params;

    const [sessionRows] = await pool.execute(
      `SELECT * FROM sessions WHERE session_id = ?`,
      [session_id]
    );

    if (sessionRows.length === 0) {
      return res.status(404).json({ success: false, message: '会话不存在' });
    }

    const [answerRows] = await pool.execute(
      `SELECT * FROM answers WHERE session_id = ? ORDER BY question_id`,
      [session_id]
    );
    const [behaviorRows] = await pool.execute(
      `SELECT * FROM behavior_logs WHERE session_id = ? ORDER BY event_timestamp ASC`,
      [session_id]
    );
    const [aiRows] = await pool.execute(
      `SELECT * FROM ai_interactions WHERE session_id = ? ORDER BY request_timestamp ASC`,
      [session_id]
    );
    const [eyeRows] = await pool.execute(
      `SELECT * FROM eye_tracking_data WHERE session_id = ? ORDER BY timestamp ASC`,
      [session_id]
    );

    res.json({
      success: true,
      data: {
        session: sessionRows[0],
        answers: answerRows,
        behavior_logs: behaviorRows,
        ai_interactions: aiRows,
        eye_tracking_data: eyeRows,
      },
    });
  } catch (error) {
    console.error('[Export] 导出失败:', error);
    res.status(500).json({ success: false, message: '导出失败: ' + error.message });
  }
});

module.exports = router;
