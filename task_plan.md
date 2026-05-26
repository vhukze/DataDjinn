# AI 赋能数据库连接工具规划

## 目标

构建一个跨平台桌面数据库工具：先完成稳定的数据库连接、结构浏览、SQL 查询与结果展示底座，再逐步接入 AI 能力，让用户可以通过自然语言理解数据结构、生成 SQL、解释结果，并最终通过 MCP 对外暴露数据库操作能力。

## 当前判断

原始 `1.md` 方向正确，但第一阶段范围偏大，建议避免一开始同时追求三平台打包、多数据库完整支持、MCP 服务、AI 预留和完整 GUI。第一阶段应以“能稳定跑起来、能安全查库、结构清晰可扩展”为核心。

## 范围原则

- 第一阶段优先可运行 MVP，不追求完整产品化。
- 第一阶段默认只读查询，禁止写操作。
- 数据库支持先从 SQLite + MySQL 或 SQLite + PostgreSQL 开始，第三种数据库放到后续阶段。
- MCP 和 AI 能力先设计接口边界，不在第一阶段强行做完整集成。
- 打包先验证 Windows，本地开发运行优先于安装包体验。

## 阶段 0：第一步落地决策与技术边界

**状态：ready**

### 目标

把第一步落地范围确认成一个可执行、可验证、不会被大型开源项目复杂度拖住的 MVP 起点。

### 已确认决策

| 事项 | 决策 | 原因 |
|---|---|---|
| 代码策略 | 自建项目底座，参考开源项目，不直接 fork 大型项目 | 保持代码轻、可控，避免许可证和复杂架构负担 |
| 桌面端 | Electron + React + TypeScript | 与目标跨平台桌面工具匹配，生态成熟 |
| 构建工具 | electron-vite | 比传统 Electron 模板更轻，适合快速启动 |
| UI | antd | 表单、树、表格、布局适合数据库客户端 |
| SQL 编辑器 | Monaco Editor | SQL 编辑体验成熟，后续可做补全 |
| 状态管理 | Zustand | 简单、轻量，适合 MVP |
| 本地后端 | Python + FastAPI | 便于数据库访问、AI/MCP 后续扩展 |
| 数据库访问 | SQLAlchemy | 统一连接、执行、元数据读取入口 |
| 第一批数据库 | SQLite + MySQL | SQLite 便于本地验证，MySQL 使用广泛；PostgreSQL 放下一批 |
| 前后端通信 | REST API | 第一阶段简单稳定，后续可再加 IPC/MCP |
| MCP | 第一阶段不集成，只预留服务层函数命名 | 避免过早引入 Agent 协议复杂度 |
| AI | 第一阶段不接 LLM，只预留上下文组织能力 | 先保证数据库工具底座可用 |
| 打包 | 第一阶段只验证 Windows | 当前开发环境是 Windows，优先闭环 |

### 第一阶段明确不做

- Chat2DB、DbGate、data-peek、DBHub、FastMCP 等开源项目只作为参考。
- 不直接复制、不粘贴、不 fork、不作为子模块引入对方项目源码。
- 即使借鉴某个功能思路，也要按本项目技术栈重新设计并本地实现，保证代码与对方项目无关。
- 不做完整 AI 对话、NL2SQL、结果解释。
- 不做完整 MCP Server。
- 不做密码持久化。
- 不做多工作区、多标签页、高级导入导出。
- 不承诺第一阶段支持三平台安装包。

### 可参考开源项目

| 项目 | 第一阶段用途 | 注意事项 |
|---|---|---|
| data-peek | 重点参考 Electron + React + TypeScript + Monaco 的桌面客户端结构和交互 | 源码 MIT，但预构建二进制存在商业使用许可说明；只参考设计更稳 |
| DbGate | 参考成熟数据库客户端的连接、结构树、结果表格和多数据库能力边界 | GPL-3.0，不建议直接复制代码进本项目 |
| Chat2DB | 参考 AI 数据库工具的产品形态、AI 入口、SQL 工作台设计 | 许可证存在附加限制，商业复用需谨慎 |
| DBHub | 第二阶段参考 MCP 工具设计 | TypeScript MCP Server，不是 Python FastMCP/SQLAlchemy 底座 |
| FastMCP | 第二阶段如需 Python MCP Server 时使用 | 第一阶段不进入关键路径 |

### 第一阶段 MVP 功能边界

- 应用能启动桌面窗口。
- 本地 FastAPI 后端能启动。
- 前端能显示后端健康状态。
- 用户能创建 SQLite 或 MySQL 连接。
- 用户能浏览表和字段。
- 用户能执行单条只读 SQL 查询。
- 查询结果能用表格展示。
- 查询默认限制行数，禁止多语句和写操作。

### 产出

- 可运行的项目骨架。
- 明确的前后端目录结构。
- 明确的开发启动命令。
- 第一阶段接口清单。

## 阶段 1：工程骨架与本地运行闭环

**状态：complete**

### 目标

搭建最小可运行项目，让 Electron 前端、React 页面、FastAPI 后端、REST API 调用形成闭环。

### 推荐目录结构

```text
AiDB/
├── electron/
│   ├── main.ts
│   └── preload.ts
├── src/
│   ├── components/
│   │   ├── AppStatus.tsx
│   │   ├── ConnectionTree.tsx
│   │   ├── SqlEditor.tsx
│   │   └── ResultTable.tsx
│   ├── pages/
│   │   └── HomePage.tsx
│   ├── services/
│   │   └── api.ts
│   ├── store/
│   │   └── useDbStore.ts
│   ├── App.tsx
│   └── main.tsx
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── health.py
│   │   │   ├── connections.py
│   │   │   └── query.py
│   │   ├── db/
│   │   │   ├── connection_manager.py
│   │   │   ├── metadata.py
│   │   │   └── readonly_query.py
│   │   └── schemas/
│   │       ├── connection.py
│   │       └── query.py
│   ├── requirements.txt
│   └── run.py
├── package.json
├── task_plan.md
├── findings.md
└── progress.md
```

### 前端初始化任务

- 使用 electron-vite 初始化 React + TypeScript 项目。
- 安装 `antd`、`@ant-design/icons`、`@monaco-editor/react`、`zustand`。
- 创建首页三段式布局：左侧连接树、中间 SQL 编辑器、底部结果区域。
- 先实现 `AppStatus`，展示后端健康检查结果。
- 在 `src/services/api.ts` 统一封装 API base URL 和请求方法。

### 后端初始化任务

- 创建 Python 虚拟环境。
- 安装 `fastapi`、`uvicorn`、`sqlalchemy`、`pymysql`、`python-dotenv`、`sqlparse`。
- 创建 `backend/app/main.py`，挂载 API 路由。
- 实现 `GET /api/health`，返回应用状态和版本。
- 预创建连接、元数据、只读查询三个服务文件，但第一步只实现健康检查。

### 开发启动方式

- 前端：`npm run dev`。
- 后端：`python backend/run.py`。
- 第一阶段先允许前后端分开启动。
- 后续再加入一键并发启动脚本，例如 `npm run dev:all`。

### 第一批 API 合约

| 接口 | 阶段 | 说明 |
|---|---|---|
| `GET /api/health` | 阶段 1 | 前后端通信验证 |
| `POST /api/connections/test` | 阶段 2 | 测试连接参数 |
| `POST /api/connections` | 阶段 2 | 创建内存连接会话 |
| `DELETE /api/connections/{connection_id}` | 阶段 2 | 断开连接 |
| `GET /api/connections/{connection_id}/tables` | 阶段 3 | 读取表列表 |
| `GET /api/connections/{connection_id}/tables/{table_name}/columns` | 阶段 3 | 读取字段信息 |
| `POST /api/query` | 阶段 4 | 执行只读查询 |

### 阶段 1 验收标准

- `npm run dev` 能打开 Electron 窗口。
- `python backend/run.py` 能启动 FastAPI 服务。
- 浏览器或前端能访问 `GET /api/health`。
- Electron 首页显示“后端已连接”或明确错误信息。
- 项目目录符合规划，后续阶段能直接添加连接管理和 SQL 查询。

### 产出

- 前端可运行。
- 后端可运行。
- 前后端通信可验证。
- 第一阶段后续功能的目录和接口边界已落好。

## 阶段 2：数据库连接管理 MVP

**状态：complete**

### 目标

实现本地会话级数据库连接管理，让用户可以创建连接、测试连接、断开连接。

### 任务

- 实现连接参数表单：数据库类型、主机、端口、用户名、密码、数据库名、SQLite 文件路径。
- 后端实现 `POST /api/connections/test`。
- 后端实现 `POST /api/connections`，返回 `connection_id`。
- 后端实现 `DELETE /api/connections/{connection_id}`。
- 后端维护内存连接会话，不在第一阶段持久化密码。
- 前端实现连接列表和连接状态展示。

### 产出

- 用户可以创建并测试数据库连接。
- 用户可以断开连接。
- 连接会话在当前应用运行期间可用。

## 阶段 3：数据库结构浏览器

**状态：complete**

### 目标

实现左侧结构树，支持查看数据库中的表和字段。

### 任务

- 后端实现 `GET /api/connections/{connection_id}/tables`。
- 后端实现 `GET /api/connections/{connection_id}/tables/{table_name}/columns`。
- 前端使用 antd Tree 异步加载连接、表、字段。
- 字段信息至少展示名称、类型、是否可为空、主键信息。
- 对加载失败、连接失效、无表等情况做基础提示。

### 产出

- 用户可以浏览表列表。
- 用户可以查看字段结构。

## 阶段 4：只读 SQL 编辑器与结果展示

**状态：complete**

### 目标

实现手写 SQL 查询能力，并以表格展示结果。

### 任务

- 前端集成 Monaco Editor。
- 后端实现 `POST /api/query`。
- 查询接口接收 `connection_id` 和 `sql`。
- 查询接口只允许单条只读查询。
- 默认限制返回行数，避免误查大表。
- 前端使用 antd Table 展示列和数据。
- 支持查询中、成功、失败、空结果等状态。

### 产出

- 用户可以执行 SELECT 查询。
- 用户可以查看查询结果。
- 查询错误能以可读方式展示。

## 阶段 5：安全与稳定性加固

**状态：pending**

### 目标

让 MVP 不会轻易执行危险 SQL，并具备基本异常处理能力。

### 任务

- 统一后端 API 响应格式。
- 统一前端错误提示。
- 引入 SQL 解析或更可靠的只读判断，避免仅用 `SELECT` 前缀判断。
- 限制多语句执行。
- 设置查询超时。
- 设置默认分页或行数上限。
- 记录后端错误日志。

### 产出

- 查询默认安全只读。
- 常见异常可诊断。
- 前端不会因后端错误崩溃。

## 阶段 6：Windows 本地打包验证

**状态：pending**

### 目标

验证项目可以在 Windows 上作为桌面应用运行。

### 任务

- 配置 Electron 打包。
- 明确 Python 后端随应用启动的方式。
- 验证开发环境和打包环境的后端进程管理。
- 先完成 Windows 打包，不急于三平台发布。
- 编写本地运行说明。

### 产出

- Windows 上可启动的桌面应用。
- README 中有开发运行和打包说明。

## 阶段 7：AI 能力预研与第二阶段设计

**状态：pending**

### 目标

在基础数据库工具稳定后，设计 AI 赋能能力，而不是在底座未稳时直接接入。

### 候选能力

- 自然语言生成 SQL。
- 根据表结构解释数据库含义。
- SQL 错误修复建议。
- 查询结果解释和可视化建议。
- 基于 MCP 暴露 `list_tables`、`describe_table`、`execute_readonly_sql`。

### 产出

- AI 功能优先级列表。
- MCP 工具接口设计。
- LLM 调用边界与安全策略。

## 关键决策

| 决策 | 结论 | 原因 |
|---|---|---|
| 第一阶段目标 | 可运行只读数据库工具 MVP | 降低范围风险 |
| 数据库支持 | 第一批 SQLite + MySQL，PostgreSQL 下一批 | SQLite 便于本地验证，MySQL 使用广泛 |
| 开源复用 | 自建底座，参考 data-peek、DbGate、Chat2DB | 避免许可证和复杂架构风险 |
| MCP | 第一阶段预留服务层命名，第二阶段集成 | 避免底座未稳时引入复杂度 |
| AI | 第二阶段接入 | 先保证工具本身可靠 |
| 安全 | 默认只读、限制行数、禁止多语句 | 数据库工具风险高 |

## 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 第一阶段范围过大 | 延期、质量下降 | 收敛为 MVP |
| 只用字符串判断 SELECT 不安全 | 可能绕过只读限制 | 使用 SQL 解析并禁止多语句 |
| Electron 打包 Python 后端复杂 | 打包阶段卡住 | 开发期先分进程运行，后期再处理打包 |
| 多数据库差异 | 元数据查询和连接参数复杂 | 第一批只做 SQLite + MySQL |
| 开源项目许可证 | 直接复制代码可能引入限制 | 第一阶段只参考架构和交互，不复制大段实现 |
| 密码保存不当 | 安全风险 | 第一阶段不持久化密码 |

## 错误记录

| 错误 | 尝试 | 处理 |
|---|---|---|
| 未在项目根目录找到 `1.md` | 搜索当前目录 | 在父目录 `C:\Users\vhukze\IdeaProjects\1.md` 找到 |

## 下一步建议

先完成阶段 0 和阶段 1：初始化项目骨架，跑通 Electron 前端、FastAPI 后端和健康检查接口。完成后再进入数据库连接管理。