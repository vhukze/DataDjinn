# Findings

## 2026-05-22：对 `1.md` 初步计划的评估

### 值得保留的方向

- Electron + React + TypeScript 适合做跨平台桌面数据库工具。
- antd 能快速搭建企业级后台类界面，适合连接树、表单、表格等场景。
- Monaco Editor 适合 SQL 编辑体验。
- Python + FastAPI 适合作为本地后端，便于后续接入 AI 和 MCP。
- SQLAlchemy 适合屏蔽不同数据库连接和元数据访问差异。
- 将 `list_tables`、`describe_table`、`execute_sql` 抽象为服务层能力，方向正确。

### 主要问题

1. 第一阶段范围偏大。
   - 同时包含工程初始化、三种数据库、结构浏览、SQL 编辑器、CSV 导出、MCP 工具、打包、GitHub README，1-2 周风险较高。

2. MCP 过早进入关键路径。
   - MCP 对后续 AI Agent 很重要，但第一阶段真正要验证的是数据库工具底座，不应让 MCP 阻塞基础功能。

3. 安全策略过于粗略。
   - “只放行 SELECT 开头”不够可靠，可能被注释、多语句、数据库方言绕过。需要禁止多语句、设置查询超时、限制返回行数，后续引入 SQL 解析。

4. 多数据库支持应收敛。
   - SQLite、MySQL、PostgreSQL 的连接方式、元数据、驱动安装和错误处理差异较多。第一阶段建议 SQLite + 一种服务端数据库。

5. Electron 打包 Python 后端会成为独立复杂点。
   - 开发期可以前后端分开启动，打包期再处理 Python 进程和资源路径，不建议一开始把“三平台安装包”作为必达目标。

6. 密码持久化没有明确边界。
   - 第一阶段建议只做内存会话，不保存密码。后续如需保存，应使用系统钥匙串或安全存储方案。

### 调整建议

- 将第一阶段定义为“可运行只读数据库工具 MVP”。
- 阶段拆分为：技术决策、工程骨架、连接管理、结构浏览、SQL 查询、安全加固、Windows 打包、AI/MCP 设计。
- 先跑通健康检查，再做数据库连接，再做结构树，最后做查询编辑器。
- MCP 和 AI 不删除，但放入第二阶段，第一阶段只保持服务层边界清晰。

## 2026-05-22：可复用开源项目初步调研

### 桌面数据库客户端方向

1. Chat2DB
   - 定位：AI 驱动数据库工具和 SQL 客户端。
   - 相关性：同时覆盖数据库客户端、AI、SQL 编辑、Electron/Web、React、Ant Design、Monaco Editor 等方向。
   - 许可证：搜索结果显示为 Apache 2.0 加 Chat2DB 附加许可证，需要在正式复用代码前进一步核验许可证边界。
   - 建议用法：优先作为产品形态、交互布局、SQL 工作台、AI 能力设计参考；直接复制代码前需谨慎确认许可。

2. data-peek
   - 定位：Electron + React + TypeScript 的桌面数据库客户端。
   - 相关性：与计划中的桌面客户端形态接近，使用 Monaco SQL 编辑器。
   - 差异：UI 技术栈更偏 shadcn/ui + Tailwind，不是 antd。
   - 建议用法：参考项目结构、连接管理、编辑器和桌面端交互；不建议强行照搬 UI。

3. DbGate
   - 定位：开源数据库管理工具，支持多数据库和桌面端。
   - 相关性：适合参考多数据库连接、结构浏览、查询结果展示、导入导出等成熟功能。
   - 建议用法：作为数据库客户端能力边界参考，不建议第一阶段照搬其完整复杂度。

4. Plotly Falcon
   - 定位：Electron + React SQL 编辑工具。
   - 问题：项目已归档，技术栈较旧。
   - 建议用法：最多作为历史交互参考，不建议复用。

### MCP / 数据库 Agent 方向

1. DBHub
   - 定位：Bytebase 的数据库 MCP Server。
   - 相关性：支持 PostgreSQL、MySQL、SQL Server、MariaDB、SQLite，提供 MCP 数据库工具能力。
   - 重要发现：DBHub 是 TypeScript 项目，不是 Python + FastMCP + SQLAlchemy 项目；原 `1.md` 对它的技术栈判断需要修正。
   - 许可证：MIT。
   - 建议用法：第二阶段参考 MCP 工具设计和安全边界；第一阶段不作为 Python 后端底座直接集成。

2. FastMCP
   - 定位：Python MCP server/client 框架。
   - 许可证：Apache-2.0。
   - 建议用法：第二阶段如要用 Python 暴露 MCP，优先考虑 FastMCP。

3. OpenLinkSoftware mcp-sqlalchemy-server
   - 定位：基于 FastAPI、pyodbc、SQLAlchemy 的 MCP server。
   - 许可证：MIT。
   - 建议用法：参考 SQLAlchemy 和 MCP 结合方式，但不应在第一阶段强行引入。

4. sqlalchemy-fastmcp
   - 定位：SQLAlchemy MCP Server 包，支持 MySQL 和 SQLite 等。
   - 建议用法：作为后续 MCP 方案候选；正式使用前需核验许可证和维护状态。

### 结论

- Chat2DB、data-peek、DbGate、DBHub、FastMCP 等项目只作为产品形态、交互、架构边界和能力设计参考。
- 不直接复用、不复制、不粘贴对方项目源码，不把大型项目作为子模块或 fork 底座。
- 即使借鉴某个功能思路，也必须按本项目技术栈和目录结构重新设计、重新实现，形成与对方项目无关的本地适配代码。
- 第一阶段代码底座自建，保持 Electron + React + TypeScript + FastAPI + SQLAlchemy 的简单架构。
- MCP 相关项目放到第二阶段参考，特别是 DBHub 的工具边界、FastMCP 的 Python MCP 组织方式。
