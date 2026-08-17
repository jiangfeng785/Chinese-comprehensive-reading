// backend/src/routes/profile.routes.js
// 个人记录查询路由 - 学生统计、记录列表与排行榜
// 接口:
//   GET /api/profile/:student_code                    - 个人统计 + 记录列表 + 排行榜
//   GET /api/profile/:student_code/records/:article_id - 按文章查笔记 + AI对话记录
// 积分规则: 每答对 1 道题 = 1 分; 累计学习时长 = 所有 session 时长之和 (不限 completed)

const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

/**
 * 判断答案是否正确 (模糊匹配)
 * 前端存的是完整选项文本如 "A. 医院", correct_answer 存的是字母如 "A"
 *
 * @param {string} answer - 学生提交的答案 (完整文本或字母)
 * @param {string} correctAnswer - 正确答案 (字母如 "A")
 * @returns {boolean} 是否答对
 */
function checkAnswerCorrect(answer, correctAnswer) {
  if (!answer || !correctAnswer) return false;
  const a = String(answer).trim().toUpperCase();
  const c = String(correctAnswer).trim().toUpperCase();
  if (c.length === 1 && a.startsWith(c)) return true;
  return a.includes(c);
}

/**
 * GET /api/profile/:student_code
 * 返回个人统计、记录列表 (笔记 + AI对话, 按文章聚合) 和排行榜
 *
 * @param {string} req.params.student_code - 学生编号
 * @returns {Object} JSON - { success, stats, records, leaderboard }
 */
router.get('/:student_code', async (req, res) => {
  try {
    const { student_code } = req.params;

    if (!student_code) {
      return res.status(400).json({ success: false, message: '缺少 student_code' });
    }

    // ==================== 1. 累计有效学习时长 (所有 session) ====================
    // COALESCE(session_end, last_heartbeat): 未正常关闭的 session 用最后心跳时间兜底
    const [durationRows] = await pool.execute(
      `SELECT
         COALESCE(SUM(
           TIMESTAMPDIFF(SECOND, session_start, COALESCE(session_end, last_heartbeat))
         ), 0) AS total_duration
       FROM sessions
       WHERE student_code = ?`,
      [student_code]
    );
    const totalDuration = Number(durationRows[0]?.total_duration || 0);

    // ==================== 2. 已完成题目数量 ====================
    // DISTINCT CONCAT(article_id, '-', question_id) 去重同一篇文章的同一题目
    const [answerCountRows] = await pool.execute(
      `SELECT COUNT(DISTINCT CONCAT(article_id, '-', question_id)) AS completed_questions
       FROM answers
       WHERE student_code = ? AND final_answer IS NOT NULL`,
      [student_code]
    );
    const completedQuestions = answerCountRows[0]?.completed_questions || 0;

    // ==================== 3. 独立初读正确率 & 修正后正确率 ====================
    // 子查询取每个 (学生,文章,题目) 的最新一条答题记录, 避免重复提交干扰统计
    const [answerRows] = await pool.execute(
      `SELECT a.*
       FROM answers a
       INNER JOIN (
         SELECT student_code, article_id, question_id,
                MAX(final_submitted_at) AS max_ts
         FROM answers
         WHERE student_code = ? AND final_answer IS NOT NULL
         GROUP BY student_code, article_id, question_id
       ) latest ON a.student_code = latest.student_code
               AND a.article_id = latest.article_id
               AND a.question_id = latest.question_id
               AND a.final_submitted_at = latest.max_ts
       WHERE a.student_code = ?`,
      [student_code, student_code]
    );

    let initialCorrect = 0;
    let finalCorrect = 0;
    let fixedByAI = 0;
    let totalAnswered = answerRows.length;

    for (const a of answerRows) {
      const ic = checkAnswerCorrect(a.initial_answer, a.correct_answer);
      const fc = checkAnswerCorrect(a.final_answer, a.correct_answer);
      if (ic) initialCorrect++;
      if (fc) finalCorrect++;
      if (!ic && fc) fixedByAI++;
    }

    const initialAccuracy = totalAnswered > 0
      ? Math.round((initialCorrect / totalAnswered) * 100)
      : 0;
    const finalAccuracy = totalAnswered > 0
      ? Math.round((finalCorrect / totalAnswered) * 100)
      : 0;

    // ==================== 4. 积分 (每答对1道题 = 1分) ====================
    const score = finalCorrect;

    // ==================== 5. 个人排名 ====================
    const [allStudents] = await pool.execute(
      `SELECT DISTINCT student_code FROM sessions ORDER BY student_code`
    );

    const leaderboard = [];

    for (const s of allStudents) {
      const sc = s.student_code;
      if (!sc) continue;

      const [sAnswers] = await pool.execute(
        `SELECT a.*
         FROM answers a
         INNER JOIN (
           SELECT student_code, article_id, question_id,
                  MAX(final_submitted_at) AS max_ts
           FROM answers
           WHERE student_code = ? AND final_answer IS NOT NULL
           GROUP BY student_code, article_id, question_id
         ) latest ON a.student_code = latest.student_code
                 AND a.article_id = latest.article_id
                 AND a.question_id = latest.question_id
                 AND a.final_submitted_at = latest.max_ts
         WHERE a.student_code = ?`,
        [sc, sc]
      );

      let sFinalCorrect = 0;
      for (const a of sAnswers) {
        if (checkAnswerCorrect(a.final_answer, a.correct_answer)) sFinalCorrect++;
      }

      leaderboard.push({
        student_code: sc,
        score: sFinalCorrect,
        completed_questions: sAnswers.length,
        is_me: sc === student_code,
      });
    }

    leaderboard.sort((a, b) => b.score - a.score);
    const myRank = leaderboard.findIndex(l => l.is_me) + 1;
    const topLeaderboard = leaderboard.slice(0, 20);

    // ==================== 6. 记录列表 (笔记 + AI对话, 按文章聚合) ====================
    // 6a. 笔记事件
    const [noteEvents] = await pool.execute(
      `SELECT
         bl.event_type, bl.event_timestamp, bl.article_id,
         bl.event_data, bl.session_id, s.session_start
       FROM behavior_logs bl
       LEFT JOIN sessions s ON bl.session_id = s.session_id
       WHERE bl.student_code = ? AND bl.event_type IN ('NOTE_CREATE', 'NOTE_EDIT')
       ORDER BY bl.event_timestamp DESC`,
      [student_code]
    );

    // 6a-2. 文本标记事件 (标黄/下划线)
    const [markEvents] = await pool.execute(
      `SELECT
         bl.event_type, bl.event_timestamp, bl.article_id,
         bl.event_data, bl.session_id
       FROM behavior_logs bl
       WHERE bl.student_code = ? AND bl.event_type = 'TEXT_HIGHLIGHT'
       ORDER BY bl.event_timestamp ASC`,
      [student_code]
    );

    // 6a-3. 查标记关联笔记 (NOTE_EDIT 中带 mark_id 的记录, 按时间 DESC 取最新)
    const [markNoteEvents] = await pool.execute(
      `SELECT
         bl.event_data, bl.article_id, bl.event_timestamp
       FROM behavior_logs bl
       WHERE bl.student_code = ? AND bl.event_type = 'NOTE_EDIT'
       ORDER BY bl.event_timestamp DESC`,
      [student_code]
    );

    // 构建 article_id -> { mark_id -> note_content } 映射
    const articleMarkNoteMap = {};
    for (const evt of markNoteEvents) {
      if (!evt.event_data) continue;
      try {
        const ed = typeof evt.event_data === 'string'
          ? JSON.parse(evt.event_data)
          : evt.event_data;
        if (ed.mark_id && ed.action !== 'delete_mark') {
          const aid = evt.article_id;
          if (!articleMarkNoteMap[aid]) articleMarkNoteMap[aid] = {};
          if (!(ed.mark_id in articleMarkNoteMap[aid])) {
            articleMarkNoteMap[aid][ed.mark_id] = ed.note_content || '';
          }
        }
      } catch (e) { /* skip */ }
    }

    // 6b. AI 交互记录
    const [aiEvents] = await pool.execute(
      `SELECT
         ai.interaction_id, ai.ai_module, ai.user_question, ai.ai_response,
         ai.article_id, ai.request_timestamp, ai.session_id,
         s.session_start
       FROM ai_interactions ai
       LEFT JOIN sessions s ON ai.session_id = s.session_id
       WHERE ai.student_code = ? AND ai.status = 'success'
       ORDER BY ai.request_timestamp DESC`,
      [student_code]
    );

    // 6c. 查每篇文章的答题提交时间
    const [submitTimeRows] = await pool.execute(
      `SELECT article_id, MAX(final_submitted_at) AS submitted_at
       FROM answers
       WHERE student_code = ? AND final_submitted_at IS NOT NULL
       GROUP BY article_id`,
      [student_code]
    );

    const articleSubmitTime = {};
    for (const r of submitTimeRows) {
      if (r.article_id && r.submitted_at) {
        // MySQL 返回的是本地时间, 去掉 Z 后缀避免前端按 UTC 再次偏移
        const iso = new Date(r.submitted_at).toISOString();
        articleSubmitTime[r.article_id] = iso.replace(/Z$/, '');
      }
    }

    // 按文章聚合: 每篇文章一条记录卡片, 包含笔记内容, 标记, AI 对话列表
    const articleMap = {};

    // 处理文本标记 (标黄/下划线)
    for (const evt of markEvents) {
      const aid = evt.article_id;
      if (!aid) continue;

      if (!articleMap[aid]) {
        articleMap[aid] = {
          article_id: aid,
          session_id: evt.session_id,
          note_content: '',
          note_type: '',
          note_updated_at: null,
          marks: [],
          ai_chats: [],
          latest_timestamp: evt.event_timestamp,
        };
      }

      if (evt.event_data) {
        try {
          const ed = typeof evt.event_data === 'string'
            ? JSON.parse(evt.event_data)
            : evt.event_data;
          if (ed.mark_text && ed.mark_type) {
            const mid = ed.mark_id || null;
            const noteMap = articleMarkNoteMap[aid] || {};
            articleMap[aid].marks.push({
              text: ed.mark_text,
              type: ed.mark_type,
              mark_id: mid,
              note: mid ? (noteMap[mid] || '') : '',
            });
          }
        } catch (e) { /* skip */ }
      }

      if (evt.event_timestamp > articleMap[aid].latest_timestamp) {
        articleMap[aid].latest_timestamp = evt.event_timestamp;
      }
    }

    // 处理笔记
    for (const evt of noteEvents) {
      const aid = evt.article_id;
      if (!aid) continue;

      let noteContent = '';
      let noteType = '';

      if (evt.event_data) {
        try {
          const ed = typeof evt.event_data === 'string'
            ? JSON.parse(evt.event_data)
            : evt.event_data;
          if (ed.note_content) {
            noteContent = ed.note_content;
            noteType = ed.action === 'ai_add_to_note' ? 'ai' : 'manual';
          } else if (ed.content) {
            noteContent = ed.content;
            noteType = 'ai';
          } else if (ed.mark_id) {
            noteContent = ed.note_content || '';
            noteType = 'mark';
          }
        } catch (e) { /* skip */ }
      }

      if (!articleMap[aid]) {
        articleMap[aid] = {
          article_id: aid,
          session_id: evt.session_id,
          note_content: '',
          note_type: '',
          note_updated_at: null,
          marks: [],
          ai_chats: [],
          latest_timestamp: evt.event_timestamp,
        };
      }

      // 取内容最长的笔记
      if (noteContent.length > articleMap[aid].note_content.length) {
        articleMap[aid].note_content = noteContent;
        articleMap[aid].note_type = noteType;
        articleMap[aid].note_updated_at = new Date(evt.event_timestamp).toISOString().replace(/Z$/, '');
      }

      // 更新最新时间
      if (evt.event_timestamp > articleMap[aid].latest_timestamp) {
        articleMap[aid].latest_timestamp = evt.event_timestamp;
      }
    }

    // 处理 AI 对话
    for (const ai of aiEvents) {
      const aid = ai.article_id;
      if (!aid) continue;

      if (!articleMap[aid]) {
        articleMap[aid] = {
          article_id: aid,
          session_id: ai.session_id,
          note_content: '',
          note_type: '',
          note_updated_at: null,
          marks: [],
          ai_chats: [],
          latest_timestamp: ai.request_timestamp,
        };
      }

      articleMap[aid].ai_chats.push({
        ai_module: ai.ai_module,
        user_question: ai.user_question,
        ai_response: ai.ai_response,
        timestamp: new Date(ai.request_timestamp).toISOString().replace(/Z$/, ''),
      });

      if (ai.request_timestamp > articleMap[aid].latest_timestamp) {
        articleMap[aid].latest_timestamp = ai.request_timestamp;
      }
    }

    // 转为数组, 按最新时间降序, 附加答题提交时间
    const records = Object.values(articleMap)
      .map(r => ({
        ...r,
        submitted_at: articleSubmitTime[r.article_id] || null,
      }))
      .sort((a, b) => new Date(b.latest_timestamp) - new Date(a.latest_timestamp));

    // ==================== 返回结果 ====================
    const stats = {
      total_duration: totalDuration,
      completed_questions: completedQuestions,
      initial_correct: initialCorrect,
      initial_accuracy: initialAccuracy,
      final_correct: finalCorrect,
      final_accuracy: finalAccuracy,
      fixed_by_ai: fixedByAI,
      total_answered: totalAnswered,
      score: score,
      rank: myRank,
      total_students: allStudents.length,
    };

    res.json({
      success: true,
      stats,
      records,
      leaderboard: topLeaderboard,
    });
  } catch (error) {
    console.error('[Profile] 查询个人记录失败:', error);
    res.status(500).json({ success: false, message: '查询失败: ' + error.message });
  }
});

/**
 * GET /api/profile/:student_code/records/:article_id
 * 按文章查询笔记和 AI 对话记录 (供再次进入时恢复)
 *
 * @param {string} req.params.student_code - 学生编号
 * @param {string} req.params.article_id - 文章ID
 * @returns {Object} JSON - { success, data: { article_id, note_content, note_type, marks, ai_chats } }
 */
router.get('/:student_code/records/:article_id', async (req, res) => {
  try {
    const { student_code, article_id } = req.params;

    if (!student_code || !article_id) {
      return res.status(400).json({ success: false, message: '缺少参数' });
    }

    const aid = parseInt(article_id);

    // 1. 查笔记事件 (取内容最长的)
    const [noteEvents] = await pool.execute(
      `SELECT event_type, event_timestamp, event_data
       FROM behavior_logs
       WHERE student_code = ? AND article_id = ?
         AND event_type IN ('NOTE_CREATE', 'NOTE_EDIT')
       ORDER BY event_timestamp DESC`,
      [student_code, aid]
    );

    let noteContent = '';
    let noteType = '';

    for (const evt of noteEvents) {
      if (!evt.event_data) continue;
      try {
        const ed = typeof evt.event_data === 'string'
          ? JSON.parse(evt.event_data)
          : evt.event_data;
        let content = '';
        let type = '';
        if (ed.note_content) {
          content = ed.note_content;
          type = ed.action === 'ai_add_to_note' ? 'ai' : 'manual';
        } else if (ed.content) {
          content = ed.content;
          type = 'ai';
        } else if (ed.mark_id) {
          content = ed.note_content || '';
          type = 'mark';
        }
        if (content.length > noteContent.length) {
          noteContent = content;
          noteType = type;
        }
      } catch (e) { /* skip */ }
    }

    // 2. 查文本标记 (标黄/下划线)
    const [markEvents] = await pool.execute(
      `SELECT event_data, event_timestamp
       FROM behavior_logs
       WHERE student_code = ? AND article_id = ?
         AND event_type = 'TEXT_HIGHLIGHT'
       ORDER BY event_timestamp ASC`,
      [student_code, aid]
    );

    // 2b. 查标记关联的笔记 (NOTE_EDIT 事件中带 mark_id 的记录)
    const [markNoteEvents] = await pool.execute(
      `SELECT event_data, event_timestamp
       FROM behavior_logs
       WHERE student_code = ? AND article_id = ?
         AND event_type = 'NOTE_EDIT'
       ORDER BY event_timestamp DESC`,
      [student_code, aid]
    );

    // 构建 mark_id -> note_content 映射 (取最新的非空笔记)
    const markNoteMap = {};
    for (const evt of markNoteEvents) {
      if (!evt.event_data) continue;
      try {
        const ed = typeof evt.event_data === 'string'
          ? JSON.parse(evt.event_data)
          : evt.event_data;
        if (ed.mark_id && ed.action !== 'delete_mark') {
          if (!(ed.mark_id in markNoteMap)) {
            markNoteMap[ed.mark_id] = ed.note_content || '';
          }
        }
      } catch (e) { /* skip */ }
    }

    const marks = [];
    for (const evt of markEvents) {
      if (!evt.event_data) continue;
      try {
        const ed = typeof evt.event_data === 'string'
          ? JSON.parse(evt.event_data)
          : evt.event_data;
        if (ed.mark_text && ed.mark_type) {
          const mid = ed.mark_id || null;
          marks.push({
            text: ed.mark_text,
            type: ed.mark_type,
            mark_id: mid,
            note: mid ? (markNoteMap[mid] || '') : '',
          });
        }
      } catch (e) { /* skip */ }
    }

    // 3. 查 AI 对话记录
    // 4. AI 对话列表
    const [aiEvents] = await pool.execute(
      `SELECT ai_module, user_question, ai_response, request_timestamp
       FROM ai_interactions
       WHERE student_code = ? AND article_id = ? AND status = 'success'
       ORDER BY request_timestamp ASC`,
      [student_code, aid]
    );

    const aiChats = aiEvents.map(ai => ({
      ai_module: ai.ai_module,
      user_question: ai.user_question,
      ai_response: ai.ai_response,
      timestamp: new Date(ai.request_timestamp).toISOString().replace(/Z$/, ''),
    }));

    res.json({
      success: true,
      data: {
        article_id: aid,
        note_content: noteContent,
        note_type: noteType,
        marks: marks,
        ai_chats: aiChats,
      },
    });
  } catch (error) {
    console.error('[Profile] 查询文章记录失败:', error);
    res.status(500).json({ success: false, message: '查询失败: ' + error.message });
  }
});

module.exports = router;
