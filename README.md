# L2 中文阅读 GenAI 阅读平台

> 一个基于生成式 AI 的二级（L2）中文阅读理解实验平台，面向中文学习者，支持阅读-答题-AI 辅助-眼动追踪全流程数据采集。

## 目录

- [项目简介](#项目简介)
- [技术栈](#技术栈)
- [项目目录结构](#项目目录结构)
- [环境要求](#环境要求)
- [本地开发运行步骤](#本地开发运行步骤)
- [生产部署说明](#生产部署说明)
- [接口简要说明](#接口简要说明)
- [注意事项与常见问题](#注意事项与常见问题)

---

## 项目简介

**L2 中文阅读 GenAI 阅读平台**是一个面向中文二语学习者（L2 Learners）的阅读理解实验系统。平台将 GenAI（DeepSeek 大模型）融入阅读学习全流程，支持以下核心功能：

- **阅读任务管理**：提供多篇文章与配套选择题，学生按阶段阅读并作答
- **AI 辅助阅读**：学生可在阅读过程中向 AI 提问，获取实时解答与文章结构总结
- **眼动追踪采集**：基于 WebGazer.js 进行网页端眼动校准与注视数据采集，记录学生阅读时的注意力分布
- **行为时序日志**：全量记录学生的页面操作行为（标记、笔记、翻页、答题切换等），供学习行为分析
- **个人学习记录**：学生可查看自己的答题历史、笔记、AI 对话记录与学习时长统计
- **实验数据导出**：管理员可导出全部实验数据（答题、行为日志、AI 交互、眼动数据）为 CSV

### 面向用户

- **学生（实验参与者）**：通过编号登录，完成阅读-答题-AI 交互任务
- **研究者/教师**：查看参与者学习记录，导出实验数据用于分析

---

## 技术栈

### 前端

| 技术 | 版本 | 说明 |
|------|------|------|
| Vue 3 | ^3.5.40 | 渐进式前端框架（Composition API + `<script setup>`） |
| Vite | ^8.2.0 | 下一代前端构建工具，开发服务器 + 生产打包 |
| Vue Router | ^4.6.4 | 官方路由管理器（hash 模式） |
| Pinia | ^4.0.2 | 轻量级状态管理库 |
| Axios | ^1.19.0 | HTTP 客户端，封装 API 请求 |
| WebGazer.js | 外部 CDN | 浏览器端眼动追踪库（校准 + 注视采集） |

### 后端

| 技术 | 版本 | 说明 |
|------|------|------|
| Express | ^5.1.0 | Node.js Web 框架（REST API） |
| mysql2 | ^3.14.0 | MySQL 驱动（promise 模式，连接池） |
| OpenAI SDK | ^7.4.0 | 用于调用 DeepSeek API（兼容 OpenAI 接口格式） |
| dotenv | ^17.4.2 | 环境变量管理 |
| cors | ^2.8.6 | 跨域资源共享中间件 |
| uuid | ^11.1.0 | UUID 生成（会话 ID） |

### 数据库

| 技术 | 说明 |
|------|------|
| MySQL 8.0 | 关系型数据库，字符集 utf8mb4 |

### 部署相关

| 技术 | 说明 |
|------|------|
| PM2 | Node.js 生产环境进程管理器 |
| Nginx | 反向代理 + 静态资源服务 |
| Vite Build | 前端生产构建，输出 `dist/` 静态文件 |

---

## 项目目录结构

```
reading_platform/
├── backend/                          # 后端服务
│   ├── .env                          # 环境变量配置（数据库、API Key）
│   ├── package.json                  # 后端依赖声明
│   ├── server.js                     # Express 应用入口
│   ├── data/
│   │   └── articles.json             # 题库数据（文章 + 题目 + 解析）
│   └── src/
│       ├── config/
│       │   └── db.js                 # MySQL 连接池配置
│       ├── routes/                   # REST API 路由
│       │   ├── session.routes.js     # 阅读会话管理（创建/复用/结束/心跳）
│       │   ├── answer.routes.js      # 答题记录（保存/提交/查询）
│       │   ├── behavior.routes.js    # 行为时序日志采集
│       │   ├── aiInteraction.routes.js # AI 交互记录持久化
│       │   ├── eyeTracking.routes.js # 眼动追踪数据采集
│       │   ├── ai.routes.js          # DeepSeek AI 流式对话接口
│       │   ├── articleRoutes.js      # 题库管理接口
│       │   ├── profile.routes.js     # 个人学习记录查询
│       │   └── export.routes.js      # 实验数据 CSV 导出
│       └── services/
│           └── deepseek.service.js   # DeepSeek AI 调用封装
│
├── frontend/                         # 前端应用
│   ├── index.html                    # HTML 入口
│   ├── package.json                  # 前端依赖声明
│   ├── vite.config.js                # Vite 构建配置（代理 + 别名）
│   ├── public/
│   │   ├── favicon.svg
│   │   ├── mindmaps/                 # 预生成思维导图图片（36篇）
│   │   └── videos/                   # 阅读辅助视频
│   └── src/
│       ├── main.js                   # Vue 应用入口
│       ├── App.vue                   # 根组件
│       ├── style.css                 # 全局样式
│       ├── assets/
│       │   └── hero.png              # 登录页背景图
│       ├── router/
│       │   └── index.js              # 路由配置
│       ├── stores/
│       │   └── useAuthStore.js       # 认证状态管理（Pinia）
│       ├── pages/                    # 页面组件
│       │   ├── LoginPage.vue         # 登录页
│       │   ├── CalibrationPage.vue   # 眼动校准页
│       │   ├── ReadingTaskPage.vue   # 阅读任务主页面（核心）
│       │   └── ProfilePage.vue       # 个人学习记录页
│       └── utils/
│           ├── api.js                # API 请求封装（Axios 实例）
│           ├── constants.js          # 常量定义
│           ├── tracker.js            # 行为事件追踪器
│           └── eyeTracker.js         # 眼动追踪模块
│
├── database/
│   └── schema.sql                    # MySQL 建表脚本（5张表）
│
├── .gitignore                        # Git 忽略规则
└── README.md                         # 本文件
```

---

## 环境要求

### 必需环境

| 软件 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | 18.0+ | 推荐使用 LTS 版本（如 20.x / 22.x） |
| MySQL | 8.0+ | 需支持 utf8mb4 字符集 |
| npm | 9.0+ | 随 Node.js 安装 |

### 可选工具

| 软件 | 说明 |
|------|------|
| PM2 | 后端生产环境进程管理 |
| Nginx | 生产部署反向代理 |
| Git | 版本控制 |

### 浏览器要求

- Chrome / Edge 90+（推荐，WebGazer 眼动追踪需要）
- 需要摄像头权限（眼动校准阶段）

---

## 本地开发运行步骤

### 1. 克隆仓库

```bash
git clone https://github.com/jiangfeng785/reading_platform.git
cd reading_platform
```

### 2. 配置 MySQL 数据库

```bash
# 登录 MySQL
mysql -u root -p

# 执行建表脚本
source database/schema.sql;
```

建表脚本会自动创建 `reading_platform` 数据库及 5 张数据表：
- `sessions` — 阅读会话主表
- `answers` — 答题记录表
- `behavior_logs` — 行为时序日志表
- `ai_interactions` — AI 交互记录表
- `eye_tracking_data` — 眼动追踪数据表

### 3. 安装后端依赖

```bash
cd backend
npm install
```

### 4. 配置后端环境变量

在 `backend/` 目录下创建 `.env` 文件（参考以下模板）：

```env
# 服务端口
PORT=5000

# MySQL 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=reading_platform
DB_CONNECTION_LIMIT=10

# DeepSeek API 配置
DEEPSEEK_API_KEY=sk-your-api-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# 提示词版本号 (用于追踪提示词变更对实验结果的影响)
PROMPT_VERSION=v1.0
```

> **注意**：请将 `DB_PASSWORD` 和 `DEEPSEEK_API_KEY` 替换为你自己的值。如无 DeepSeek API Key，AI 对话功能将不可用，但其他功能正常。

### 5. 启动后端服务

```bash
cd backend
npm run dev
```

启动成功后会显示：

```
[DB] MySQL 连接池已就绪

========================================
  阅读实验平台后端已启动
  地址: http://localhost:5000
  API 测试: http://localhost:5000/api/test
========================================
```

### 6. 安装前端依赖

```bash
cd frontend
npm install
```

### 7. 启动前端开发服务器

```bash
cd frontend
npm run dev
```

Vite 开发服务器默认运行在 `http://localhost:5173`，已配置代理将 `/api` 请求转发到后端 `localhost:5000`。

### 8. 访问应用

打开浏览器访问 `http://localhost:5173`，输入任意参与者编号（如 `test001`）和任意密码即可登录。

---

## 生产部署说明

### 前端打包

```bash
cd frontend
npm run build
```

构建产物输出到 `frontend/dist/` 目录，包含静态 HTML/JS/CSS 资源及 `public/` 下的图片和视频。

### 后端生产启动（PM2）

**禁止使用 `npm run dev` 用于生产环境**，应使用 PM2 管理进程：

```bash
# 全局安装 PM2（仅需一次）
npm install -g pm2

# 启动后端服务
cd backend
pm2 start server.js --name reading-platform-backend

# 查看运行状态
pm2 status

# 查看日志
pm2 logs reading-platform-backend

# 设置开机自启
pm2 startup
pm2 save
```

### Nginx 反向代理配置

Nginx 负责两件事：托管前端静态文件 + 将 API 请求代理到后端。

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态资源
    root /path/to/reading_platform/frontend/dist;
    index index.html;

    # 前端路由（Vue Router hash 模式，无需 try_files 配置）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理到后端
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 眼动数据批量上传可能较大，提高请求体大小限制
        client_max_body_size 15m;

        # AI 流式接口需要长连接支持
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```

**关键提示**：

- 本项目前端路由使用 **hash 模式**（URL 带 `#`），Nginx 无需额外配置 `try_files` 回退逻辑，静态资源直接由 `location /` 托管即可
- API 代理路径 `/api/` 对应后端所有路由（`/api/session`、`/api/answers` 等）
- `proxy_buffering off` 是 AI 流式对话（SSE）正常工作的必要配置
- `client_max_body_size` 需调大以支持眼动数据批量上传

### 域名部署与备案

- 使用域名访问需在服务器安全组开放 80（HTTP）/ 443（HTTPS）端口
- 中国大陆服务器需完成 ICP 备案后方可使用域名访问
- HTTPS 部署推荐使用 Let's Encrypt 免费证书（`certbot`）

---

## 接口简要说明

所有接口前缀为 `/api`，以下为核心模块接口概览：

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 参与者登录（模拟登录，任意编号+密码） |

### 会话管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/session/start` | 创建/复用阅读会话 |
| POST | `/api/session/end` | 结束会话 |
| POST | `/api/session/heartbeat` | 心跳上报（30秒间隔，用于时长估算） |

### 答题记录

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/answers/save` | 保存答案（支持多次修改） |
| POST | `/api/answers/submit` | 提交最终答案（触发判分，锁定会话） |
| GET | `/api/answers/student/:student_code` | 查询学生答题记录 |

### 行为日志

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/behavior/log` | 上报单条行为事件 |
| POST | `/api/behavior/batch` | 批量上报行为事件 |

### AI 交互

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/chat` | AI 流式对话（DeepSeek，SSE） |
| POST | `/api/ai/summarize` | AI 生成文章结构总结 |
| POST | `/api/ai-interactions` | 持久化 AI 交互记录 |

### 眼动追踪

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/eye-tracking` | 上眼动追踪数据（注视点/AOI/校准） |

### 题库管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/articles` | 获取全部文章与题目 |

### 个人记录

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/profile/:student_code` | 查询学习统计、答题记录、笔记、排行榜 |

### 数据导出

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/export/answers` | 导出答题数据 CSV |
| GET | `/api/export/behavior` | 导出行为日志 CSV |
| GET | `/api/export/ai-interactions` | 导出 AI 交互 CSV |
| GET | `/api/export/eye-tracking` | 导出眼动数据 CSV |
| GET | `/api/export/sessions` | 导出会话数据 CSV |

> 导出接口仅限管理员编号（默认 `test`）访问。

---

## 注意事项与常见问题

### 开发环境

**Q: 启动后端报 `ER_ACCESS_DENIED_ERROR`？**
A: 检查 `.env` 中的 `DB_USER` 和 `DB_PASSWORD` 是否与你的 MySQL 配置一致。

**Q: 前端页面能打开但 API 请求返回 502？**
A: 后端服务未启动。先在 `backend/` 目录执行 `npm run dev` 启动后端，确保 `http://localhost:5000/api/test` 可正常访问。

**Q: AI 对话功能无响应？**
A: 检查 `.env` 中 `DEEPSEEK_API_KEY` 是否有效。API Key 失效后，其他功能不受影响。

**Q: 眼动校准页面摄像头无法打开？**
A: 确保使用 Chrome 或 Edge 浏览器，并在浏览器设置中允许该网站访问摄像头。`localhost` 环境下浏览器允许 HTTP 摄像头访问；部署到 HTTP（非 HTTPS）域名后，摄像头 API 将被浏览器阻止，必须使用 HTTPS。

**Q: 登录后刷新页面状态丢失？**
A: 认证信息使用 `sessionStorage` 存储，关闭标签页后自动清除，这是预期行为（实验场景需要参与者每次重新登录）。

### 数据与逻辑

**Q: 同一篇文章重复进入会怎样？**
A: 系统实行会话去重：同一学生+同一文章仅保留一条有效会话。已完成（completed）的会话会阻止重答（返回 409），学生只能查看记录；abandoned 状态的会话会被重新激活。

**Q: 学习时长如何计算？**
A: 通过前端每 30 秒发送心跳 + 页面卸载时 `sendBeacon` 上报结束时间。SQL 中使用 `TIMESTAMPDIFF(SECOND, session_start, COALESCE(session_end, last_heartbeat))` 计算，异常关闭也有兜底时长。

**Q: 切换浏览器标签页（后台）时计时是否中断？**
A: 是的。`visibilitychange` 事件监听页面可见性，切到后台时暂停计时器并停止眼动追踪，恢复前台时重新开始计时。

**Q: 时区显示有偏移？**
A: 后端 `db.js` 中 `timezone: '+00:00'`，返回时间给前端时已通过 `.replace(/Z$/, '')` 去除 UTC 后缀，前端按本地时间解析。如遇到时间偏差，检查后端路由中 `toISOString()` 是否已去除 `Z`。

### 生产部署

**Q: 部署后前端路由 404？**
A: 本项目使用 hash 模式路由（URL 含 `#`），通常不会出现此问题。如使用 history 模式则需在 Nginx 配置 `try_files $uri $uri/ /index.html`。

**Q: AI 流式接口部署后不返回数据？**
A: Nginx 必须设置 `proxy_buffering off`，否则 SSE 事件会被缓冲导致前端无法实时接收。

**Q: 导出的 CSV 中文乱码？**
A: CSV 文件已添加 UTF-8 BOM 头（`\uFEFF`），用 Excel 打开应正常显示。如仍乱码，检查 Nginx 是否对 `.csv` 文件强制设置了非 UTF-8 的 `charset`。

**Q: 眼动追踪在生产环境不工作？**
A: WebGazer 需要摄像头权限，仅 HTTPS 环境可用（`localhost` 除外）。部署时必须配置 SSL 证书。
