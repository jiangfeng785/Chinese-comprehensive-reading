-- ============================================================================
-- 阅读实验平台 - MySQL 建表脚本
-- 数据库名: reading_platform
-- 字符集: utf8mb4 (支持 emoji 和生僻字)
-- 
-- 表结构概览:
--   1. sessions           - 阅读会话主表 (一次完整阅读实验的唯一标识)
--   2. answers            - 答题记录表 (支持多次修改, 记录初答/终答/修改历史)
--   3. behavior_logs      - 行为时序日志表 (全量操作行为流水)
--   4. ai_interactions    - AI 交互记录表 (提问/回复/模型/提示词版本)
--   5. eye_tracking_data  - 眼动追踪数据表 (注视/切换/校准, 与行为日志共用时间戳)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS reading_platform
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE reading_platform;

-- ============================================================================
-- 1. 阅读会话主表 sessions
--    每个学生每次进入阅读任务创建一条会话记录
--    session_id 是所有其他表的外键关联源
-- ============================================================================
CREATE TABLE sessions (
  session_id        VARCHAR(36)   NOT NULL COMMENT '会话唯一ID (UUID), 全局唯一, 作为所有数据表关联主键',
  student_code      VARCHAR(50)   NOT NULL COMMENT '学生编号 (登录时输入的 user_code, 如 test001)',
  article_id        INT           NOT NULL COMMENT '阅读文章编号 (题库中文章的 id)',
  question_id       INT           DEFAULT NULL COMMENT '当前主题目编号 (若实验聚焦单题, 可填; 多题则为 NULL)',
  
  -- 会话状态
  session_start    DATETIME(3)   NOT NULL COMMENT '会话开始时间 (毫秒精度, 服务器时间)',
  session_end      DATETIME(3)   DEFAULT NULL COMMENT '会话结束时间 (学生提交或离开时写入)',
  last_heartbeat   DATETIME(3)   DEFAULT NULL COMMENT '最近一次心跳时间 (前端每30秒上报, 用于页面异常关闭时估算时长)',
  status           ENUM('active','completed','abandoned') DEFAULT 'active' COMMENT '会话状态: active=进行中, completed=已完成, abandoned=已放弃',
  
  -- 统一时间基准: 服务器启动时生成的基准时间戳, 用于对齐前端时间与眼动时间
  time_anchor      BIGINT        NOT NULL COMMENT '统一时间锚点 (Unix epoch 毫秒), 前端获取后用于所有事件的时间戳计算',
  
  -- 眼动校准质量
  calibration_quality VARCHAR(20) DEFAULT NULL COMMENT '眼动校准质量标记: good/fair/poor/null(未校准)',
  
  -- 实验元数据
  experiment_group VARCHAR(20)  DEFAULT NULL COMMENT '实验分组 (如 A/B/control/experiment, 供后续分组分析)',
  user_agent       TEXT         DEFAULT NULL COMMENT '浏览器 User-Agent (设备信息)',
  
  PRIMARY KEY (session_id),
  INDEX idx_student (student_code),
  INDEX idx_article (article_id),
  INDEX idx_start (session_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阅读会话主表';

-- ============================================================================
-- 2. 答题记录表 answers
--    每个学生会话内每道题目一条记录
--    支持多次修改: initial_answer 记录首次答案, final_answer 记录最终答案
--    answer_history 以 JSON 格式存储完整修改时序链
-- ============================================================================
CREATE TABLE answers (
  answer_id        BIGINT        NOT NULL AUTO_INCREMENT COMMENT '答题记录自增主键',
  session_id       VARCHAR(36)   NOT NULL COMMENT '关联会话ID (外键 -> sessions.session_id)',
  student_code     VARCHAR(50)   NOT NULL COMMENT '学生编号 (冗余存储, 方便直接查询)',
  article_id       INT           NOT NULL COMMENT '文章编号 (冗余存储)',
  question_id      INT           NOT NULL COMMENT '题目编号 (该文章内的题目序号)',
  
  -- 答案内容
  initial_answer   VARCHAR(500)  DEFAULT NULL COMMENT '首次答案 (阶段一保存, 如 "A"/"B" 或文本)',
  final_answer     VARCHAR(500)  DEFAULT NULL COMMENT '最终提交答案 (阶段三提交)',
  correct_answer   VARCHAR(500)  DEFAULT NULL COMMENT '正确答案 (后端从题库查填)',
  
  -- 答题修改历史 (JSON 数组, 记录每次修改的时间戳+旧值+新值)
  -- 示例: [{"timestamp":"2026-01-01 10:00:00.123","old_value":"A","new_value":"B"}, ...]
  answer_history   JSON          DEFAULT NULL COMMENT '答案修改时序历史 (JSON数组, 每次修改追加一条)',
  
  -- 时间戳
  first_answered_at DATETIME(3)  DEFAULT NULL COMMENT '首次答题时间',
  final_submitted_at DATETIME(3) DEFAULT NULL COMMENT '最终提交时间',
  
  -- 判分
  is_correct       TINYINT(1)   DEFAULT NULL COMMENT '是否正确: 1=正确, 0=错误, NULL=未判分',
  
  PRIMARY KEY (answer_id),
  UNIQUE KEY uk_session_question (session_id, question_id) COMMENT '同一会话同一题目仅一条记录, 通过 answer_history 追踪修改',
  INDEX idx_session (session_id),
  INDEX idx_student_article (student_code, article_id),
  INDEX idx_question (question_id),
  CONSTRAINT fk_answers_session FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='答题记录表';

-- ============================================================================
-- 3. 行为时序日志表 behavior_logs
--    记录学生在阅读过程中的每一步操作, 形成完整行为链
--    每条记录独立, 按时间排序可还原完整操作序列
-- ============================================================================
CREATE TABLE behavior_logs (
  log_id            BIGINT       NOT NULL AUTO_INCREMENT COMMENT '日志自增主键',
  session_id        VARCHAR(36) NOT NULL COMMENT '关联会话ID (外键 -> sessions.session_id)',
  student_code      VARCHAR(50) NOT NULL COMMENT '学生编号 (冗余存储)',
  
  -- 事件信息
  event_type        VARCHAR(50) NOT NULL COMMENT '事件类型 (见下方枚举说明)',
  event_timestamp   BIGINT      NOT NULL COMMENT '事件发生时间戳 (Unix epoch 毫秒, 与眼动数据共用同一时间基准)',
  
  -- 事件上下文 (按事件类型不同, 填充不同字段)
  article_id        INT         DEFAULT NULL COMMENT '事件关联的文章编号 (如切题、答题时)',
  question_id       INT         DEFAULT NULL COMMENT '事件关联的题目编号 (如答题、修改答案时)',
  
  -- 事件载荷 (JSON, 存储事件特有数据)
  -- 示例:
  --   答题修改: {"old_answer":"A","new_answer":"B"}
  --   高亮行为: {"highlighted_text":"人工智能","position":{"start":120,"end":124}}
  --   笔记编辑: {"note_content":"我的笔记内容...","action":"create|edit"}
  --   进入AI面板: {"panel":"ai_assistant"}
  --   AI提问前快照: {"question_id":1,"current_answer":"A"}
  event_data        JSON        DEFAULT NULL COMMENT '事件详细数据 (JSON格式, 按事件类型存储不同结构)',
  
  -- 服务器接收时间 (用于检测网络延迟和验证前端时间戳)
  server_received_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '服务器接收到该事件的时间',
  
  PRIMARY KEY (log_id),
  INDEX idx_session (session_id),
  INDEX idx_event_type (event_type),
  INDEX idx_timestamp (event_timestamp),
  INDEX idx_student_event (student_code, event_type),
  CONSTRAINT fk_behavior_session FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='行为时序日志表';

-- ============================================================================
-- event_type 枚举值说明 (behavior_logs.event_type 字段):
-- 
--   值                        | 说明
--   --------------------------|------------------------------------------------
--   SESSION_START             | 阅读会话开始 (进入任务页面)
--   ENTER_AI_PANEL            | 进入AI对话面板
--   PRE_AI_ANSWER_SNAPSHOT    | AI交互前答题快照 (记录学生当前答案状态)
--   ANSWER_MODIFY             | 每次答案修改操作 (event_data 记录 old->new)
--   TEXT_HIGHLIGHT            | 文本高亮行为 (event_data 记录高亮文本+位置)
--   NOTE_CREATE               | 新建笔记
--   NOTE_EDIT                 | 编辑笔记
--   AI_QUESTION_SENT          | 发起AI提问 (event_data 记录原始问题内容)
--   AI_REPLY_RECEIVED         | 接收AI回复 (event_data 记录回复摘要, 完整内容见 ai_interactions)
--   ANSWER_SUBMIT             | 最终答题提交
--   ARTICLE_SWITCH            | 切换文章
--   QUESTION_NAVIGATE          | 切换题目 (上一题/下一题)
--   STAGE_CHANGE              | 阶段切换 (1->2->3)
-- ============================================================================

-- ============================================================================
-- 4. AI 交互记录表 ai_interactions
--    每次学生与AI的一次完整对话: 学生提问 -> AI回复
--    记录使用的AI功能模块、原始问题、完整回复、文章片段、模型名称、提示词版本
-- ============================================================================
CREATE TABLE ai_interactions (
  interaction_id    BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'AI交互记录自增主键',
  session_id        VARCHAR(36) NOT NULL COMMENT '关联会话ID (外键 -> sessions.session_id)',
  student_code      VARCHAR(50) NOT NULL COMMENT '学生编号 (冗余存储)',
  
  -- AI 功能模块
  ai_module         VARCHAR(30) NOT NULL COMMENT '使用的AI功能模块: sentence(理解句子) | passage(分析文段) | hint(给提示) | free_chat(自由提问)',
  
  -- 学生原始提问
  user_question     TEXT         NOT NULL COMMENT '学生原始提问内容 (完整原文)',
  
  -- 文章原文片段 (提问时关联的上下文)
  article_excerpt   TEXT         DEFAULT NULL COMMENT '对应的文章原文片段 (学生选中的文本或相关段落)',
  article_id        INT          DEFAULT NULL COMMENT '关联文章编号',
  question_id       INT          DEFAULT NULL COMMENT '关联题目编号 (如提问时正在看某题)',
  
  -- AI 回复
  ai_response       MEDIUMTEXT   DEFAULT NULL COMMENT 'AI完整回复内容 (完整原文, MEDIUMTEXT 支持长文本)',
  
  -- 模型与提示词信息
  model_name        VARCHAR(50)  NOT NULL DEFAULT 'deepseek-chat' COMMENT '调用的大模型名称 (如 deepseek-chat)',
  prompt_version    VARCHAR(20)  NOT NULL DEFAULT 'v1.0' COMMENT '当前生效的提示词版本号 (用于追踪提示词变更对结果的影响)',
  
  -- 时间信息
  request_timestamp BIGINT       NOT NULL COMMENT '发起AI提问时间戳 (Unix epoch 毫秒, 与行为日志共用时间基准)',
  response_timestamp BIGINT     DEFAULT NULL COMMENT '接收AI回复时间戳 (Unix epoch 毫秒)',
  response_duration_ms INT      DEFAULT NULL COMMENT 'AI响应耗时 (毫秒, = response_timestamp - request_timestamp)',
  
  -- 交互状态
  status           ENUM('success','failed','timeout') DEFAULT 'success' COMMENT '交互状态: success=成功, failed=失败, timeout=超时',
  error_message    TEXT         DEFAULT NULL COMMENT '错误信息 (status 非 success 时填写)',
  
  PRIMARY KEY (interaction_id),
  INDEX idx_session (session_id),
  INDEX idx_student (student_code),
  INDEX idx_module (ai_module),
  INDEX idx_request_time (request_timestamp),
  CONSTRAINT fk_ai_session FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI交互记录表';

-- ============================================================================
-- 5. 眼动追踪数据表 eye_tracking_data
--    接收前端转发的眼动设备数据, 与行为日志共用同一套时间戳基准
--    支持后续行为事件与眼动数据的时间对齐分析
-- ============================================================================
CREATE TABLE eye_tracking_data (
  eye_data_id       BIGINT      NOT NULL AUTO_INCREMENT COMMENT '眼动数据自增主键',
  session_id        VARCHAR(36) NOT NULL COMMENT '关联会话ID (外键 -> sessions.session_id)',
  student_code      VARCHAR(50) NOT NULL COMMENT '学生编号 (冗余存储)',
  
  -- 时间戳 (与行为日志共用同一时间基准)
  timestamp         BIGINT      NOT NULL COMMENT '眼动事件时间戳 (Unix epoch 毫秒, 与 behavior_logs.event_timestamp 同基准)',
  
  -- 兴趣区域 (Area of Interest)
  aoi_type          VARCHAR(30) NOT NULL COMMENT '兴趣区域类型: reading(阅读文本区) | question(题目区域) | options(答题选项区) | ai_chat(AI对话区域) | note(笔记标记区域) | other(其他)',
  
  -- 注视指标
  fixation_duration_ms INT      DEFAULT NULL COMMENT '在该兴趣区域的注视时长 (毫秒)',
  fixation_x        DECIMAL(8,2) DEFAULT NULL COMMENT '注视点 X 坐标 (屏幕像素)',
  fixation_y        DECIMAL(8,2) DEFAULT NULL COMMENT '注视点 Y 坐标 (屏幕像素)',
  
  -- 区域切换事件
  transition_from   VARCHAR(30) DEFAULT NULL COMMENT '切换来源区域 (从哪个区域切换到此区域, 首次进入为 NULL)',
  transition_event  TINYINT(1)  DEFAULT 0 COMMENT '是否为区域切换事件: 1=是, 0=否 (非切换的常规注视数据为0)',
  
  -- 数据质量
  calibration_quality VARCHAR(20) DEFAULT NULL COMMENT '眼动校准质量标记: good/fair/poor (记录该数据点时的校准状态)',
  data_missing       TINYINT(1)  DEFAULT 0 COMMENT '数据缺失标记: 1=该时间点眼动数据缺失/断连, 0=正常',
  
  -- 原始数据 (可选, 存储眼动设备原始JSON, 供后续深度分析)
  raw_data          JSON        DEFAULT NULL COMMENT '眼动设备原始数据 (JSON格式, 保留全部原始字段供后续分析)',
  
  -- 服务器接收时间
  server_received_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '服务器接收到该数据的时间',
  
  PRIMARY KEY (eye_data_id),
  INDEX idx_session (session_id),
  INDEX idx_timestamp (timestamp),
  INDEX idx_aoi (aoi_type),
  INDEX idx_session_aoi (session_id, aoi_type),
  INDEX idx_student_timestamp (student_code, timestamp),
  CONSTRAINT fk_eye_session FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='眼动追踪数据表';

-- ============================================================================
-- 验证: 查看所有表结构
-- ============================================================================
-- SHOW TABLES;
-- DESCRIBE sessions;
-- DESCRIBE answers;
-- DESCRIBE behavior_logs;
-- DESCRIBE ai_interactions;
-- DESCRIBE eye_tracking_data;
