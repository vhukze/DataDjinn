# DataDjinn v0.2.12

## Highlights

- SQL 编辑器新增按数据库方言格式化，并完善当前语句表字段的上下文补全
- 表格筛选与行选择更符合 Windows 交互习惯，支持 Shift 连选和拖动到边缘自动滚动
- AI 内置 DataDjinn 产品知识库，会话回复可完整保存并在重启后继续查看
- 增强受限 Redis、SQL 语法错误和 PostgreSQL 函数错误场景的兼容性

## What's Changed

### SQL 编辑器与查询

- 右上角新增 SQL 格式化按钮，按 SQLite、MySQL、PostgreSQL、高斯、Oracle、达梦和 ClickHouse 等方言生成换行与层级缩进；支持格式化当前语句或跨多条 SQL 的选区
- 补全会根据当前语句 `FROM` / `JOIN` 引用的表，在 `SELECT`、`WHERE`、`ON`、`GROUP BY`、`ORDER BY`、`HAVING` 和 `SET` 等位置提示字段
- 优化未写分号时的多条 SQL 识别；行首执行按钮始终位于语句首行，点击不会触发展开或收起
- 查询错误信息支持鼠标选择和复制；SQL 语法错误不再被误判为后端中断，也不会关闭连接或重载连接树
- PostgreSQL 不支持 `GROUP_CONCAT` 时会准确提示改用 `string_agg`，不再显示“数据库不存在”或混入高斯数据库描述

### 表格交互

- WHERE 输入框只在有效字段前缀位置显示匹配提示，空白、关键字、条件值或完整表达式不会拦截 Enter 查询
- 行号选择支持 Ctrl 多选、Shift 连续范围选择，以及拖动到表格上下边缘后自动滚动继续选择
- 修复连续空白单元格选区中出现视觉间隔的问题

### AI 与连接兼容

- 新增 DataDjinn 产品知识库，可直接询问快捷键修改、连接导出、驱动配置和其他软件用法
- 修复 AI 流式回复结束时末尾内容未完整持久化，重新打开应用后最后一条回复被截断的问题
- Redis 即使禁用了 `CONFIG GET databases` 也可以加载数据库列表，无需为客户端额外开放高权限命令

## Notes

- 当前版本号：`v0.2.12`
- GitHub Release 将自动构建并发布 Windows 安装包
