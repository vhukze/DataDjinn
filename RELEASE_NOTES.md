# DataDjinn v0.1.6

本版本聚焦 Redis 一等数据源支持、连接保存体验、表格预览效率和发布打包能力，以下为相对 v0.1.5 的产品级变更。

## 新增

- 新增 Redis 连接支持：
  - 支持配置 Redis 主机、端口、ACL 用户名、密码和默认 DB 序号。
  - 支持连接测试、保存连接、打开连接、关闭连接和连接信息持久化。
  - 连接打开后可展示 Redis 服务版本。
- 新增 Redis DB / Key 浏览能力：
  - 按 `db0`、`db1` 等 Redis DB 展示服务端配置的 DB 列表。
  - 默认勾选有数据的 DB，空 DB 可在连接右侧勾选后查看。
  - Redis DB 节点双击打开数据浏览页，不再展开 Key 树，避免大量 Key 卡顿。
- 新增 Redis Key 数据查看与编辑：
  - 支持浏览 Redis DB 下的 Key 列表，展示类型、TTL、长度、内存占用和值预览。
  - 支持 String、Hash、List、Set、ZSet 的新增、编辑、删除和统一提交。
  - Stream 支持查看，不支持直接编辑。
  - TTL 展示改为中文可读文案。
- 新增 Redis 查询窗口命令支持：
  - 支持 `SCAN` / `KEYS` 查看 Key。
  - 支持 `GET`、`HGETALL`、`LRANGE`、`SMEMBERS`、`ZRANGE`、`XRANGE`、`TYPE`、`TTL` 查看数据。
  - 支持 `SET`、`HSET`、`LPUSH`、`RPUSH`、`SADD`、`ZADD`、`DEL`、`EXPIRE` 等基础写入命令。
- 新增 Redis JSON 导出：
  - 支持按 DB 或单个 Key 导出为 JSON。
  - 导出内容包含 Key 类型、TTL 和序列化后的值。
- AI Agent 新增 Redis 上下文理解：
  - 可识别 Redis 连接、DB、Key 和当前查询窗口内容。
  - 可辅助生成 Redis 常用命令、查看 Key、写入测试数据并解释结果。
- 表格预览新增 WHERE 条件栏：
  - 支持输入 `id = 2` 这类过滤条件后回车查询。
  - 支持当前表字段补全。
  - 刷新、分页和切换每页条数时保留 WHERE 条件。
- 表格预览分页新增“首页”和“末页”。

## 优化

- 连接保存体验优化：
  - “创建连接”文案调整为“保存连接”。
  - 保存连接不再强制要求数据库可连通，连接失败时仍可保存配置。
  - 测试连接保留为独立操作。
- 表格预览性能优化：
  - 默认每页预览条数从 1000 降为 300，减少大表滚动卡顿。
  - 每页条数支持 300 / 500 / 1000 切换。
  - 多工作页切换时减少隐藏页重新渲染带来的刷新感。
- 连接树右键菜单优化：
  - 所有连接右键菜单移除刷新、编辑、删除，统一使用连接右侧按钮。
  - Redis 连接右键菜单移除“新建库”，符合 Redis 固定编号 DB 模型。
- 达梦连接体验优化：
  - JDBC JVM 检测支持从系统 `Path` 中的 `java.exe` 反推 `jvm.dll`，不再强依赖 `JAVA_HOME`。
  - JVM 缺失提示补充 Path 配置说明。
- 错误提示优化：
  - MySQL 主机或端口不可达时，提示改为检查主机、端口、服务和防火墙。
  - Redis 连接超时、连接失败、认证失败、DB 序号超范围等错误改为中文可理解提示。
- 非 SQL 数据库导出体验优化：
  - MongoDB / Redis 默认使用 JSON 导出格式。
  - 导出文件选择器支持 JSON 文件类型。
- Redis 命令补全优化：SQL 编辑器增加 Redis 常用命令关键字补全。

## 修复

- 修复 Redis 只显示有数据 DB，导致空 DB 不方便进入和新增 Key 的问题。
- 修复 Redis DB 节点可展开造成的交互误导。
- 修复 Redis 打开连接失败时可能显示 `Timeout reading from socket` 等英文底层错误的问题。
- 修复 MongoDB / Redis 等非 SQL 连接不支持 SQL 文件执行时可能进入 SQL 文件执行器的问题。
- 修复 README 快速开始中带有发布流程描述的问题，README 仅保留当前版本能力说明。

## 打包说明

- Windows Release 仍提供安装包和解压版。
- Redis 驱动 `redis-py` 已纳入后端依赖和打包隐藏导入。
- 达梦驱动仍不默认内置到发布包中；如需连接达梦，请在驱动管理中添加本机可用的 JDBC jar、dmPython pyd 或 dmPython whl 驱动。
- 使用 JDBC 驱动连接达梦需要本机安装可用的 64 位 JDK/JRE。
