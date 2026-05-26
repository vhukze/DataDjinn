# Progress

## 2026-05-22

### 用户目标

用户希望做一个 AI 赋能的数据库连接工具，并提供了初步计划文档 `1.md`，要求评估计划是否有问题，并基于该计划重新生成规划。

### 已完成

- 检查当前项目目录 `C:\Users\vhukze\IdeaProjects\AiDB`，未发现 `1.md` 和既有规划文件。
- 在父目录 `C:\Users\vhukze\IdeaProjects\1.md` 找到初稿。
- 阅读并评估初稿。
- 识别出范围过大、MCP 过早、安全策略不足、多数据库复杂度、Python 后端打包复杂度、密码存储边界不清等问题。
- 创建 `task_plan.md`，将项目拆成 8 个阶段。
- 创建 `findings.md`，记录对初稿的评估和调整建议。
- 创建 `progress.md`，记录本次规划过程。

### 当前状态

规划文件已生成，下一步适合从阶段 0 和阶段 1 开始：明确技术边界并初始化可运行的 Electron + React + TypeScript 前端和 FastAPI 后端。

### 待用户确认

- 是否按更新后的方案开始阶段 1：初始化 Electron + React + TypeScript 前端和 FastAPI 后端。
- 是否确认第一批数据库为 SQLite + MySQL，PostgreSQL 放下一批。
- 是否确认第一阶段只参考开源项目，不直接复制大型项目代码。

## 2026-05-22：开源项目调研与第一步落地细化

### 已完成

- 调研数据库客户端与 MCP 相关开源项目。
- 确认 data-peek 是最贴近 Electron + React + TypeScript + Monaco 的参考项目。
- 确认 DbGate 适合参考成熟数据库客户端功能边界，但 GPL-3.0 不适合直接复制进项目。
- 确认 Chat2DB 适合参考 AI 数据库工具产品形态，但许可证存在附加限制，商业复用需谨慎。
- 确认 DBHub 是 TypeScript MCP Server，不是 Python + FastMCP + SQLAlchemy 项目，原初稿判断需要修正。
- 将 `task_plan.md` 中阶段 0 更新为“第一步落地决策与技术边界”。
- 将 `task_plan.md` 中阶段 1 更新为详细工程骨架、本地运行闭环、目录结构、依赖、API 合约和验收标准。

### 当前推荐

第一步采用自建底座：Electron + React + TypeScript + antd + Monaco + Zustand + Python FastAPI + SQLAlchemy。开源项目只用于参考，不直接并入。第一批数据库建议 SQLite + MySQL。

### 用户确认的开源边界

- Chat2DB、data-peek、DbGate、DBHub、FastMCP 等项目都只作为参考。
- 不直接复用、不复制、不粘贴、不 fork、不作为子模块引入对方项目源码。
- 即使借鉴某个功能思路，也必须按 AiDB 本地技术栈重新设计并实现，保证代码与对方项目无关。

## 2026-05-22：DataDjinn 项目目录与后端环境初始化

### 已完成

- 确认项目名称为 DataDjinn。
- 在当前工作区创建 `DataDjinn` 子目录作为正式项目目录。
- 复制 `task_plan.md`、`findings.md`、`progress.md` 到 `DataDjinn` 项目目录。
- 检查本机环境：Node v24.14.1、npm 11.11.0、Python 3.13.9、pip 25.2。
- 创建 `DataDjinn/backend` 后端目录。
- 创建 Python 虚拟环境 `DataDjinn/backend/.venv`。
- 安装后端依赖：FastAPI、uvicorn、SQLAlchemy、PyMySQL、python-dotenv、sqlparse。
- 创建 FastAPI 最小应用和 `GET /api/health` 健康检查接口。
- 验证 FastAPI 应用可导入：`DataDjinn API 0.1.0`。

### 正在进行

- Electron + React + TypeScript 前端脚手架已创建并合并进 `DataDjinn`。
- `package.json` 项目名已从 `datadjinn-scaffold` 改为 `datadjinn`。
- 前端依赖安装过程中曾遇到 `read ECONNRESET`，后续分批安装成功。
- 已安装前端依赖：antd、@ant-design/icons、zustand、@monaco-editor/react。
- 已将默认 Electron 欢迎页替换为 DataDjinn 工作台页面。
- 已接入 `GET /api/health` 健康检查展示。
- 已运行 `npm run typecheck`，类型检查通过。
- 运行验证时发现 Electron CSP 阻止连接 `http://127.0.0.1:8000`，已在 `src/renderer/index.html` 增加 `connect-src` 允许本地后端。
- CSP 修改后再次运行 `npm run typecheck`，类型检查通过。

## 2026-05-23：数据库连接管理 MVP 初版

### 已完成

- 后端新增连接参数模型：`backend/app/schemas/connection.py`。
- 后端新增 SQLAlchemy 连接管理器：`backend/app/db/connection_manager.py`。
- 后端新增连接管理接口：`backend/app/api/connections.py`。
- FastAPI 已注册连接管理路由：`/api/connections/test`、`/api/connections`、`/api/connections/{connection_id}`。
- 前端连接管理面板已从占位提示升级为连接列表和新建连接弹窗。
- 前端支持 SQLite / MySQL 两种连接表单。
- 前端支持测试连接、创建连接、断开连接。
- 已运行 `npm run typecheck`，类型检查通过。
- 已用 SQLite 验证 `POST /api/connections/test` 和 `POST /api/connections` 接口成功。

### 注意事项

- MySQL 表单和后端连接逻辑已实现，但尚未连接真实 MySQL 实例验证。
- SQLite 验证创建了本地测试文件：`data/test.sqlite`。
- PowerShell 输出中文响应时出现编码显示异常，但接口返回和功能验证成功。

## 2026-05-23：数据库结构浏览器

### 已完成

- 后端新增元数据响应模型：`backend/app/schemas/metadata.py`。
- 后端新增 SQLAlchemy Inspector 元数据读取：`backend/app/db/metadata.py`。
- 后端新增结构浏览接口：`GET /api/connections/{connection_id}/tables`。
- 后端新增字段浏览接口：`GET /api/connections/{connection_id}/tables/{table_name}/columns`。
- 前端左侧从连接列表升级为异步加载数据库结构树。
- 前端支持展开连接查看“表”节点，展开表查看字段、类型、主键和非空信息。
- 已运行 `npm run typecheck`，类型检查通过。
- 已使用临时 8010 端口验证 SQLite 表和字段接口成功。

### 注意事项

- 当前正在运行的 8000 端口后端可能还是旧进程，需要重启后端才能在界面里使用新结构浏览接口。
- 验证用 SQLite 文件包含 `users` 测试表：`data/metadata-check.sqlite`。

## 2026-05-23：只读 SQL 编辑器与结果展示

### 已完成

- 后端新增查询请求/响应模型：`backend/app/schemas/query.py`。
- 后端新增只读查询执行器：`backend/app/db/readonly_query.py`。
- 后端新增查询接口：`POST /api/query`。
- 查询接口默认限制返回 500 行，并使用 `limit + 1` 判断是否截断。
- 查询接口只允许单条 `SELECT` 或 `WITH` 查询，写操作返回 400。
- 前端接入 Monaco Editor 作为 SQL 编辑器。
- 前端新增连接选择、执行按钮、查询结果表格。
- 前端对 `NULL` 值做灰色显示，结果表格支持分页和横向滚动。
- 已运行 `npm run typecheck`，类型检查通过。
- 已使用临时 8011 端口验证 SQLite 查询成功，`delete from users` 被 400 拦截。

### 注意事项

- 当前运行中的 8000 后端和前端可能需要重启/刷新才能加载查询接口和 SQL 工作区更新。
- 验证用 SQLite 文件包含 `users` 测试表：`data/query-check.sqlite`。

## 2026-05-23：表数据预览与查询窗口入口

### 已完成

- 后端新增表数据预览接口：`GET /api/connections/{connection_id}/tables/{table_name}/preview`。
- 后端新增 `preview_table`，通过 SQLAlchemy 方言安全引用表名并复用查询结果限制逻辑。
- 前端右侧工作区默认切换为表数据预览，避免默认加载 Monaco 编辑器。
- 前端支持双击左侧表名，在右侧展示该表数据。
- 顶部新增“新建查询窗口”按钮，点击后再打开 SQL 编辑器并执行手写 SQL。
- 已运行 `npm run typecheck`，类型检查通过。
- 已验证后端 API 路由导入成功，预览路由已注册。
- 已用 SQLite 验证 `preview_table` 和只读 SQL 查询函数均返回 `users` 表数据。

### 注意事项

- 由于当前环境没有浏览器自动化工具，界面双击和按钮交互还需要在 Electron 或浏览器页面中手动确认。
- 当前运行中的 8000 后端和前端可能需要重启/刷新才能加载最新前后端代码。

## 2026-05-23：右侧多标签工作区

### 已完成

- 确认 `data/metadata-check.sqlite` 的 `users` 表存在但没有数据，所以右侧表格为空是测试库数据状态导致。
- 右侧工作区改为可关闭的标签页。
- 双击左侧表名会打开或激活对应表名标签页，并加载表数据。
- 顶部“新建查询窗口”每次点击都会创建一个新的查询标签页。
- 每个查询标签页独立保存连接、SQL 内容、加载状态和查询结果。
- 支持同时打开多个表预览标签和多个查询窗口标签。
- 已运行 `npm run typecheck`，类型检查通过。
- 已验证后端表预览函数和只读 SQL 查询函数仍可正常返回数据。

### 注意事项

- 修改后需要刷新前端或重启 `npm run dev` 才能看到最新标签页工作区。

## 2026-05-23：基础数据库客户端体验补齐

### 已完成

- 表节点新增右键菜单：预览数据、生成 SELECT 查询、复制表名。
- 生成 SELECT 查询会打开新的查询标签页，并根据 SQLite/MySQL 方言引用表名。
- 表预览标签新增刷新按钮。
- 查询和预览错误会展示在当前标签页内，不只依赖全局消息提示。
- 结果区域新增状态栏，展示标签类型、连接名、表名、行数和截断状态。
- 查询编辑器暂时使用稳定的 `Input.TextArea`，避免 Monaco 加载卡住影响基础功能验证。
- 已运行 `npm run typecheck`，类型检查通过。
- 已验证后端表预览函数和只读 SQL 查询函数仍可正常返回数据。

### 注意事项

- 修改后需要刷新前端或重启 `npm run dev` 才能看到最新功能。

## 2026-05-23：修改表字段属性 MVP

### 已完成

- 左侧表节点支持整行双击打开表预览。
- 表节点右键菜单新增“修改表”。
- 修改表弹框展示字段名、类型、可空和主键。
- 后端新增 `PUT /api/connections/{connection_id}/tables/{table_name}/columns`。
- SQLite 保存采用重建表方式，当前只支持修改已有字段的类型、可空和单字段主键，不支持新增、删除或重命名字段。
- 前端保存按钮已接入后端接口，保存成功后关闭弹框。
- 已运行 `npm --prefix DataDjinn run typecheck`，类型检查通过。
- 已使用 `data/demo.sqlite` 的副本验证 SQLite 表结构保存后数据行数保持不变。
- 已验证 API 函数调用可以返回保存后的字段结构。

### 注意事项

- SQLite 修改字段属性会重建表，当前 MVP 暂未保留索引、触发器和外键约束。
- 保存前如果把已有 NULL 数据的字段改为非空，SQLite 插入临时表时会失败并回滚。

## 2026-05-23：MySQL 修改表字段属性支持

### 已完成

- 后端表结构保存入口从 SQLite 专用函数改为按数据库方言分发的通用 `update_table_columns`。
- SQLite 继续使用重建表方式保存字段类型、可空和单字段主键。
- MySQL 新增 `ALTER TABLE ... MODIFY COLUMN` 保存字段类型和可空属性。
- MySQL 主键变化时会先删除旧主键，再追加新单字段主键。
- 前端修改表弹框和保存流程继续复用同一个接口。
- 修改表提示文案已更新为 SQLite/MySQL 共用。
- 已运行 `npm --prefix DataDjinn run typecheck`，类型检查通过。
- 已验证后端导入和路由注册成功。
- 已验证 SQLite 通用保存入口回归通过，数据行数保持不变。
- 已验证 MySQL 字段 DDL 生成逻辑。

### 注意事项

- 当前环境没有真实 MySQL 实例，因此 MySQL 保存功能尚未做端到端实库验证。
- MySQL 当前只支持修改已有字段的类型、可空和单字段主键，不支持新增、删除、重命名字段，也暂不处理索引/外键迁移。

## 2026-05-23：连接持久化与安全密码保存

### 已完成

- 后端连接配置会持久化到 `backend/data/connections.json`。
- 连接密码使用 Windows DPAPI 按当前系统用户加密后保存，文件中不落盘明文密码。
- 后端启动时会读取持久化连接并尝试自动恢复可连接的 SQLite/MySQL 连接。
- 如果某个持久化连接暂时无法恢复，不会阻塞后端整体启动。
- 后端新增 `GET /api/connections/{connection_id}/password`，用于按需解密返回连接密码。
- 前端连接树对保存了密码的连接显示小眼睛按钮，点击后弹框展示密码，并可用输入框自带小眼睛切换显示原文。
- 已验证后端应用导入成功。
- 已验证 DPAPI 密码加密和解密成功。
- 已验证 SQLite 连接持久化流程成功，并清理验证用持久化连接。
- 已运行 `npm --prefix DataDjinn run typecheck`，类型检查通过。

### 注意事项

- 密码密文只能由当前 Windows 用户在本机解密，换用户或换机器通常无法直接解密。
- 当前环境没有真实 MySQL 实例，因此 MySQL 自动恢复仍需后续连接真实实例端到端验证。

## 2026-05-23：表数据编辑 MVP

### 已完成

- 后端新增 `PUT /api/connections/{connection_id}/tables/{table_name}/data` 表数据提交接口。
- 支持按主键删除行、更新已有行和插入新增行。
- 表数据编辑要求目标表存在主键；无主键表暂不允许提交编辑。
- 前端表预览标签新增 DataGrip 风格工具栏：刷新、新增行、删除行、提交。
- 双击表格单元格可以进入编辑，编辑结果先暂存在前端。
- 新增、修改、删除行有不同底色/删除线状态；点击提交后才写入数据库。
- 已验证后端应用导入成功。
- 已运行 `npm --prefix DataDjinn run typecheck`，类型检查通过。
- 已用 SQLite 临时表验证新增、更新、删除提交逻辑成功。

### 注意事项

- 当前 MVP 对更新/删除依赖主键定位行，暂不支持无主键表编辑提交。
- MySQL 使用同一套 SQLAlchemy 提交逻辑，但当前环境没有真实 MySQL 实例，仍需后续端到端验证。

## 2026-05-23：新建连接入口与 MySQL 多库浏览

### 已完成

- 新建连接入口改为先下拉选择数据库类型：SQLite 文件连接 / MySQL 服务器连接。
- 根据选择的数据库类型打开对应表单并填入默认值。
- MySQL 连接不再要求填写数据库名；默认数据库改为可选项。
- 后端 MySQL Engine 支持不指定 database 连接服务器。
- 后端新增 `GET /api/connections/{connection_id}/databases` 获取数据库列表。
- 后端表、字段、预览、表结构修改、表数据提交接口均支持通过 `database` 参数指定 MySQL 数据库。
- 前端结构树支持 MySQL 层级：连接 -> 数据库 -> 表 -> 字段。
- MySQL 表预览、生成 SELECT、修改表、编辑数据都会携带数据库名。
- 已运行 `npm --prefix DataDjinn run typecheck`，类型检查通过。
- 已验证后端应用导入成功。
- 已使用本地 MySQL `127.0.0.1:3306` 验证不指定 database 连接和列库成功。

### 注意事项

- SQLite 仍保持原来的连接 -> 表 -> 字段结构。
- MySQL 系统库 `information_schema`、`mysql`、`performance_schema`、`sys` 默认不展示。

## 2026-05-23：编辑连接功能

### 已完成

- 后端新增 `GET /api/connections/{connection_id}`，返回完整连接配置（含解密密码）供编辑弹框回填。
- 后端新增 `PUT /api/connections/{connection_id}`，更新前先验证新连接可用再替换旧引擎并持久化。
- 前端连接节点新增编辑按钮（铅笔图标），点击后弹出连接编辑弹框。
- 弹框复用新建连接表单，标题和确认按钮根据新增/编辑模式动态切换。
- 已运行 `npm --prefix DataDjinn run typecheck`，类型检查通过。
- 已验证后端导入成功。

### 注意事项

- 编辑弹框会返回已解密密码，方便用户修改后在对话框中直接查看/调整。
- 更新连接时会先测试新配置是否可用，失败不会覆盖旧连接。

## 2026-05-23：连接刷新功能

### 已完成

- 连接节点新增刷新按钮（旋转箭头图标），点击后重置当前连接树节点的子节点。
- 再次展开连接会重新从后端拉取数据库/表结构。
- 已运行 `npm --prefix DataDjinn run typecheck`，类型检查通过。

### 注意事项

- MySQL 连接编辑后如果修改了数据库相关配置，需要点击刷新按钮再展开连接，才能看到最新的数据库列表。

## 2026-05-23：修复 bug.md 中 3 个问题

### 已完成

- 删除根目录旧 `progress.md`，以 `DataDjinn/progress.md` 为唯一进度源。
- `refreshConnectionNode` 区分连接类型：SQLite 恢复默认"表"子节点，MySQL 清空子节点后主动调用 `loadTreeData` 重新加载数据库列表。
- 新增 `cleanFormValues` 函数，保存/测试连接前按 `database_type` 清洗表单字段，避免 SQLite/MySQL 表单切换时隐藏字段和密码泄露。
- 已运行 `npm --prefix DataDjinn run typecheck`，类型检查通过。

## 2026-05-23：MySQL 系统库展示与双击修复

### 已完成

- MySQL `list_databases` 移除系统库硬过滤，`SHOW DATABASES` 返回全部数据库（含 `information_schema`、`mysql`、`performance_schema`、`sys`）。
- 删除 `renderTreeTitle` 中表标题 `span` 的 `onDoubleClick`，统一由 `Tree.onDoubleClick` 处理双击表预览，消除重复触发。
- 已运行 `npm --prefix DataDjinn run typecheck`，类型检查通过。
- 已验证后端导入成功。

## 2026-05-23：连接右键菜单、新增数据库与运行 SQL 文件

### 已完成

**后端：**
- `POST /api/connections/{connection_id}/databases` — MySQL 创建数据库，数据库名校验（字母/数字/下划线，首字符非数字，1-64 长度）。
- SQLite 调用该接口返回 400，提示通过新增文件连接创建数据库。
- `POST /api/connections/{connection_id}/sql-file` — 接收 SQL 内容和可选目标数据库，使用 `sqlparse.split` 分割多条语句，单事务执行，失败回滚，返回成功/失败计数和错误列表。
- MySQL 未指定默认库时要求传入目标数据库。

**前端：**
- 连接节点新增右键菜单：刷新、编辑连接、新增数据库、运行 SQL 文件、断开连接。
- MySQL 连接点击"新增数据库"弹出输入框，确认后调用后端创建并刷新连接树。
- SQLite 连接点击"新增数据库"复用现有新建 SQLite 文件连接弹框。
- "运行 SQL 文件"通过 Electron `dialog.showOpenDialog` 选择 `.sql` 文件，执行前展示风险提示、文件名、连接名、目标数据库输入框。
- 执行完成后展示成功/失败摘要，含错误详情。

**Electron：**
- 主进程新增 `select-sql-file` IPC handler，调用 `dialog.showOpenDialog` + `fs.readFile`。
- preload 暴露 `api.selectSqlFile()`，类型声明已更新。

**验证：**
- 已运行 `npm --prefix DataDjinn run typecheck`，类型检查通过。
- 已验证后端导入成功。