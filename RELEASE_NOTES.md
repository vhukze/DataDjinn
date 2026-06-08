# DataDjinn v0.1.15

## Highlights

- 补强高斯数据库支持，完善 JDBC 连接、跨库查询、建表、改表和表数据编辑流程。
- 优化表格预览区单元格交互，修复单击选中、拖动选择和双击编辑的卡顿与失效问题。
- 调整 JPype vendor 处理方式，构建时自动准备本地依赖，仓库不再跟踪生成的二进制 vendor 目录。

## What's Changed

- 高斯数据库连接改为显式关闭 JDBC autoCommit，并兼容 autoCommit 状态下 rollback 报错的问题。
- 高斯 / PostgreSQL 场景下支持通过连接工厂切换目标数据库，补齐 SQL 执行、只读查询、表预览和表数据提交的跨库路径。
- 高斯建表和改表复用 PostgreSQL 结构设计能力，并针对高斯 identity 语法差异避免生成不兼容的 `INCREMENT BY` 片段。
- 表结构读取增强唯一约束、自增步长、字段注释和检查约束解析，修复部分 PostgreSQL 对象注释查询参数类型异常。
- 表格预览单元格选中改为绑定真实单元格内容，避免滚动后选中背景漂移。
- 双击单元格编辑改为原地 DOM 输入框，减少 React / AntD Table 重渲染带来的进入和退出编辑延迟。
- 单击选中、拖动选择和点击其它位置提交编辑的交互链路重新梳理，降低快速操作时的卡顿和状态残留。
- JPype vendor 目录改为构建时由 `prepare_jpype_vendor.py` 生成，不再把 `backend/vendor/jpype15` 二进制目录作为源码跟踪内容。

## Notes

- 当前版本号为 `v0.1.15`。
- 本次发布包含前端表格交互、后端高斯兼容和构建依赖管理改动。
- 发布前已完成前端 TypeScript 校验。
