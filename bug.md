# Bug Check

## 2026-05-24

### 当前状态

- 已解决的问题已从本文件删除。
- 当前暂无未解决问题。

### 未解决问题

- 暂无。

### 验证结果

- 本次复验通过：当前未记录未解决问题。
- 本次复验通过：问题 29 的代码路径仍有效，`toggleOrLoadTreeNode` 和 `onExpand` 都会在无 children 的可加载节点上主动调用 `reloadNodeChildren`。
- 本次复验通过：问题 30 的代码路径仍有效，结果表格 `pagination={false}`，分页已外置到 `.result-pagination`，表格 body 使用 flex/height 撑满剩余区域。
- 本次复验通过：问题 31 的代码路径仍有效，`WorkspaceTab.limit`、`changeTabLimit`、`withLimitQuery` 已接入，分页切换 500/1000 会重新请求查询或预览接口。
- 本次复验通过：`npm run typecheck` 通过。
- 本次复验通过：后端导入检查通过，输出 `DataDjinn API 0.1.0`。
- 问题 29 已解决：抽出 `toggleOrLoadTreeNode`，双击 connection/database/pg-schema/tables-root 时，如果节点没有 children 会主动调用 `reloadNodeChildren` 请求并写入 children；`onExpand` 展开无 children 的可加载节点时也会主动加载，避免受控 `expandedKeys` 绕过 `loadData`。
- 问题 30 已解决：结果表格改为 `pagination={false}`，底部使用外置 `.result-pagination` 承载分页；`.result-table-shell` / `.result-table` / Ant Table 内部容器改为 flex 撑满，表格 body 占据剩余空间，分页固定在结果区域底部。
- 问题 31 已解决：`WorkspaceTab` 增加 `limit` 状态，查询和预览默认 1000；分页切换 500/1000 时更新当前 tab limit 并重新请求 `/query` 或 `/preview?limit=...`，提交表数据后的刷新也按当前 limit 返回。
- `npm run typecheck` 通过。
- 后端导入检查通过：`DataDjinn API 0.1.0`。

- 本次验证通过：问题 26 已解决。`createDatabase` 新建库成功后会追加 `selectedDatabases`，同步更新 `selectedDatabasesRef.current`，并通过延迟刷新确保 `refreshConnectionNode` 读取到新选择，新库应自动显示。
- 本次验证通过：问题 28 已解决。`openConnectionById`、`closeConnectionById`、编辑连接保存路径当前均不再调用 `refreshTree` 整树重建；关闭/编辑连接改为局部更新当前连接节点 children。剩余 `refreshTree` 调用只在首次加载、新建连接、删除连接等允许整体同步的场景。
- 本次验证通过：`npm run typecheck` 通过。
- 本次验证通过：后端导入检查通过，输出 `DataDjinn API 0.1.0`。
- 本次验证通过：问题 27 已解决。`renderEditableCell` 当前对 `null` / `undefined` 编辑态使用 `defaultValue=''`，`editableValue` 会把空字符串或 `null` 文本转成真实 `null`，不再把真实 null 默认编辑成字符串 `NULL`。
- 本次验证通过：`npm run typecheck` 通过。
- 本次验证通过：后端导入检查通过，输出 `DataDjinn API 0.1.0`。
- 本次验证通过：`src/renderer/src/App.tsx` 已不存在 `openedDatabases`、`openedSchemas`、`isDatabaseOpen`、`isSchemaOpen`、`toggleDatabaseOpen`、`toggleSchemaOpen`。
- 本次验证通过：库/模式右键菜单已不存在“打开库/关闭库/打开数据库/关闭数据库/打开模式/关闭模式”和“请先打开”菜单项，只保留连接上的打开/关闭功能。
- 本次验证通过：MySQL database、PostgreSQL database、PostgreSQL schema 节点当前均为 `isLeaf: false`，不再因库/模式未打开被当成叶子节点。
- 本次验证通过：右键打开连接后，MySQL/PostgreSQL 会调用 `reloadNodeChildren({ key: connKey, kind: 'connection', connectionId, closed: false, isLeaf: false })` 加载第一层库节点；双击 database / pg-schema 当前只切换展开状态，不再走库/模式打开状态机。
- `npm run typecheck` 通过。
- 后端导入检查通过：`backend/.venv` 中执行 `from app.main import app; print(app.title, app.version)` 输出 `DataDjinn API 0.1.0`。
- `npm run typecheck` 通过。
- 后端导入检查通过：`DataDjinn API 0.1.0`。
- 问题 21 已解决：MySQL 库关闭状态右键菜单当前包含“打开库”、刷新，以及置灰的“新建表（请先打开）”“运行 SQL 文件（请先打开）”；双击打开也已修复。
- 问题 23 已解决：PG schema 关闭状态右键菜单当前包含“打开模式”、刷新，以及置灰的“新建表（请先打开）”“运行 SQL 文件（请先打开）”；双击打开也已修复。
- 问题 22 已解决：`new-table` 菜单项当前条件为 `!node.closed && !isPgDb`，PG database 节点不再显示“新建表”，PG schema 仍可显示“新建表”。
- 问题 20 已解决：SQLite 打开连接时已按连接类型分支处理，不再调用 `reloadNodeChildren`，而是直接用 `buildConnectionNode(connection).children` 保留 `tables-root` 的“表”入口。
- 问题 19 已解决：`delete_connection` 当前先判断并删除 `_stored_connections`，再可选 dispose engine，关闭状态连接也会返回删除成功。
- 问题 20 已解决：打开 MySQL/PostgreSQL 连接后已自动展开并主动加载第一层库节点。
- 问题 16 已解决：库/模式选择已持久化到 `localStorage`，加载时会用 `filterPersistedValues` 清理过期值并在为空时回退到当前可用列表。
- 问题 16 已解决：`loadChildrenForNode` 当前使用局部 `nextSelected` / `nextSelectedSchemas` 同时更新 state 和生成 children，避免同一次加载读取过滤前旧值。
- 问题 16 已解决：新建 PostgreSQL 模式后当前只追加 `databaseCreateName` 到已有选择，不再用完整 `schemaNames` 覆盖用户选择。
- 问题 17 已解决：Tree `onDoubleClick` 当前已包含 `pg-schema`，PG 模式节点可通过双击切换展开。
- 问题 18 已解决：`.query-toolbar .ant-select-selector` 和 `.query-toolbar .ant-btn` 当前已局部覆盖为 `border-radius: 0 !important`，查询工具栏控件不再继承全局圆角。
- 问题 16 大部分已解决：重启持久化、过期项过滤、空交集回退、新建 PG 模式后追加选择均已实现；仍保留当前这一次树加载可能读取过滤前旧选择值的异步 state 风险。
- 问题 14 已解决：`refreshConnectionNode` 和 `loadChildrenForNode` 当前通过 `selectedDatabasesRef.current` 读取最新库选择，避免刷新链路读取旧闭包里的 `selectedDatabases`。
- 问题 15 已解决：`createTable` 当前会检查 `/sql-file` 返回的 `failed_count` / `errors`，失败时不再提示“表创建成功”；建表 SQL 当前也已移除非 PostgreSQL 的表级 `AUTO_INCREMENT` 拼接。
