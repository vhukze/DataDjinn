# DataDjinn v0.1.19

## Highlights

- 新增 Oracle 数据库支持，采用 `python-oracledb` 原生驱动接入
- 补齐 Oracle 的连接、Schema 浏览、表预览、DDL 查看与表结构设计主链路
- 继续保持 Windows / macOS 发布产物输出，本次将额外产出一版 `dmg` 供安装验证

## What's Changed

- 后端新增 Oracle 连接创建与连通性检测
- Oracle 查询执行支持 `ALTER SESSION SET CURRENT_SCHEMA` 上下文切换
- Oracle 只读查询与表预览补齐 `ROWNUM` 分页
- Oracle 元数据浏览支持 Schema、表、视图、触发器、存储过程、函数、序列、索引
- Oracle 补齐表注释、字段注释、列唯一、自增步长、最小值/最大值等表设计主要能力
- SQL 编辑器新增 Oracle 方言关键字与标识符引用支持
- 前端连接表单与左侧资源树补齐 Oracle 类型入口和基础交互

## Notes

- 当前版本号为 `v0.1.19`
- 本次发布重点是 Oracle 支持补齐，并验证 macOS `dmg` 发布产物
- 发布前已完成前端 TypeScript 校验和后端 Python 语法校验
