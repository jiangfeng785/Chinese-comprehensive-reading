// backend/src/routes/answer.routes.js
// ==================== 答题记录路由 ====================
// 提供接口: 保存/更新答题记录 (支持多次修改)
// 设计: 同一会话同一题目仅一条记录, 通过 answer_history (JSON) 追踪修改链

const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

/**
 * POST /api/answers/save
 * 保存或更新答题记录 (同一会话同一题目仅一条记录, 通过 answer_history 追踪修改链)
 *
 * @param {string} req.body.session_id - 会话ID
 * @param {string} req.body.student_code - 学生编号
 * @param {string} req.body.article_id - 文章编号
 * @param {string} req.body.question_id - 题目编号
 * @param {string} req.body.answer - 当前答案 (如 "A" / "B" 或文本)
 * @param {('initial'|'final')} [req.body.answer_type='initial'] - initial: 首次保存/阶段一 | final: 最终提交/阶段三
 * @param {number} req.body.timestamp - 事件时间戳 (Unix epoch 毫秒)
 * @param {string} [req.body.correct_answer] - 正确答案 (可选, 前端不传则后端不填)
 * @returns {Object} message - 操作结果描述
 */
router.post('/save', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const {
      session_id,
      student_code,
      article_id,
      question_id,
      answer,
      answer_type = 'initial',
      timestamp,
      correct_answer = null,
    } = req.body;

    // 参数校验
    if (!session_id || !student_code || !article_id || !question_id || !answer) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: session_id, student_code, article_id, question_id, answer',
      });
    }

    await conn.beginTransaction();

    // 查询是否已有该题目的答题记录
    const [existing] = await conn.execute(
      `SELECT answer_id, initial_answer, final_answer, answer_history, first_answered_at
       FROM answers 
       WHERE session_id = ? AND question_id = ?`,
      [session_id, question_id]
    );

    if (existing.length === 0) {
      // ========== 首次答题: 插入新记录 ==========
      const historyEntry = JSON.stringify([{
        timestamp: timestamp,
        action: answer_type,
        old_value: null,
        new_value: answer,
      }]);

      // 判分 (模糊匹配: 答案 "A. 医院" 匹配正确答案 "A")
      let isCorrect = null;
      if (answer_type === 'final' && correct_answer) {
        isCorrect = answer.trim().toUpperCase().startsWith(correct_answer.trim().toUpperCase()) ? 1 : 0;
      }

      await conn.execute(
        `INSERT INTO answers 
          (session_id, student_code, article_id, question_id, 
           initial_answer, final_answer, answer_history, 
           first_answered_at, final_submitted_at, correct_answer, is_correct)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), ?, ?, ?)`,
        [
          session_id, student_code, article_id, question_id,
          answer_type === 'initial' ? answer : null, // initial_answer
          answer, // final_answer (当前值)
          historyEntry,
          answer_type === 'final' ? new Date() : null, // final_submitted_at
          correct_answer,
          isCorrect,
        ]
      );
    } else {
      // ========== 已有记录: 更新答案并追加历史 ==========
      const record = existing[0];
      const oldAnswer = record.final_answer;
      
      // 解析历史记录数组
      let historyArr = [];
      if (record.answer_history) {
        historyArr = typeof record.answer_history === 'string' 
          ? JSON.parse(record.answer_history) 
          : record.answer_history;
      }

      // 追加本次修改记录
      historyArr.push({
        timestamp: timestamp,
        action: answer_type,
        old_value: oldAnswer,
        new_value: answer,
      });

      // 构建更新语句
      const updates = [];
      const params = [];

      updates.push('final_answer = ?');
      params.push(answer);

      updates.push('answer_history = ?');
      params.push(JSON.stringify(historyArr));

      // 若为最终提交, 更新提交时间和判分
      if (answer_type === 'final') {
        updates.push('final_submitted_at = NOW(3)');
        if (correct_answer) {
          updates.push('correct_answer = ?');
          params.push(correct_answer);
          updates.push('is_correct = ?');
          // 模糊匹配: 答案 "A. 医院" 匹配正确答案 "A"
          params.push(answer.trim().toUpperCase().startsWith(correct_answer.trim().toUpperCase()) ? 1 : 0);
        }
      }

      params.push(session_id, question_id);

      await conn.execute(
        `UPDATE answers SET ${updates.join(', ')} WHERE session_id = ? AND question_id = ?`,
        params
      );
    }

    await conn.commit();
    console.log(`[Answer] 保存答案: 学生=${student_code}, 题目=${question_id}, 答案=${answer}, 类型=${answer_type}`);

    res.json({ success: true, message: '答案已保存' });
  } catch (error) {
    await conn.rollback();
    console.error('[Answer] 保存失败:', error);
    res.status(500).json({ success: false, message: '保存答案失败: ' + error.message });
  } finally {
    conn.release();
  }
});

/**
 * GET /api/answers/:session_id
 * 获取某会话的所有答题记录
 *
 * @param {string} req.params.session_id - 会话ID
 * @returns {Array} data - 答题记录数组, 按 question_id 排序
 */
router.get('/:session_id', async (req, res) => {
  try {
    const { session_id } = req.params;
    const [rows] = await pool.execute(
      `SELECT * FROM answers WHERE session_id = ? ORDER BY question_id`,
      [session_id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[Answer] 查询失败:', error);
    res.status(500).json({ success: false, message: '查询失败: ' + error.message });
  }
});

/**
 * GET /api/answers/student/:student_code
 * 获取某学生的所有答题记录 (跨会话, 用于刷新后恢复进度)
 *
 * @param {string} req.params.student_code - 学生编号
 * @returns {Object} data - 按 article_id 分组, 同一文章同一题目仅保留最新一条
 *   每条包含: question_id, article_id, initial_answer, final_answer, correct_answer,
 *   first_answered_at, final_submitted_at, is_correct
 */
router.get('/student/:student_code', async (req, res) => {
  try {
    const { student_code } = req.params;

    if (!student_code) {
      return res.status(400).json({ success: false, message: '缺少 student_code' });
    }

    const [rows] = await pool.execute(
      `SELECT 
         answer_id, session_id, student_code, article_id, question_id,
         initial_answer, final_answer, correct_answer,
         first_answered_at, final_submitted_at, is_correct
       FROM answers 
       WHERE student_code = ? 
       ORDER BY article_id, question_id, final_submitted_at DESC`,
      [student_code]
    );

    // 按 article_id 分组, 同一文章同一题目只取最新一条 (查询已按 final_submitted_at DESC 排序, 故首次命中即最新)
    const articleMap = {};
    for (const row of rows) {
      const key = `${row.article_id}`;
      if (!articleMap[key]) {
        articleMap[key] = [];
      }
      // 同一 question_id 仅保留第一条 (即最新的一条, 因已按提交时间倒序)
      const existing = articleMap[key].find(a => a.question_id === row.question_id);
      if (!existing) {
        articleMap[key].push(row);
      }
    }

    res.json({ success: true, data: articleMap });
  } catch (error) {
    console.error('[Answer] 查询学生答题记录失败:', error);
    res.status(500).json({ success: false, message: '查询失败: ' + error.message });
  }
});

module.exports = router;
