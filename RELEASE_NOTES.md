# DataDjinn v0.1.4

本版本新增应用更新能力，并继续包含达梦 DM 连接与驱动管理增强：支持按连接选择已添加的达梦驱动，完善 JDBC、dmPython pyd、dmPython whl 三类外部驱动的连接、元数据读取和数据预览体验。

## 新增

- 新增达梦驱动管理能力：
  - 支持手动添加达梦 JDBC jar 驱动。
  - 支持手动添加 dmPython pyd 驱动。
  - 支持手动添加 dmPython whl 驱动，并校验 Python ABI、Windows 平台和文件格式兼容性。
  - 支持测试、删除已添加的达梦驱动。
- 达梦连接信息新增“达梦驱动”选择项：
  - 每个达梦连接可独立选择已添加的驱动。
  - 不再依赖全局自动选择驱动，避免多个达梦驱动混用时连接行为不明确。
- 达梦 JDBC 连接支持：
  - 支持通过 JDBC jar + JVM 连接达梦。
  - 自动查找可用 JVM，并将 JDBC jar 加入 JVM classpath。
  - 后端打包保留 JDBC 桥接依赖 `jaydebeapi` / `JPype1`。
- 达梦 whl 驱动支持：
  - 支持添加并加载 Windows / 当前 Python 版本匹配的 dmPython whl。
  - whl 会解压到应用数据目录后加载，支持其中的 native `.pyd` / `.dll` 文件。
- 达梦 Schema 创建支持：
  - 在达梦中“新增数据库”按达梦语义创建 Schema。
  - 创建成功后返回实际 Schema 名称，并刷新连接树。
- 新增应用更新能力：
  - 安装版支持检查更新、下载更新并重启安装。
  - 绿色版支持检查 GitHub Release 新版本，下载新版 zip 后由用户手动解压替换。
  - 支持启动时自动检查更新、手动检查更新、跳过指定版本和查看发布页。

## 优化

- 达梦驱动管理表格优化：
  - 长驱动名称和路径支持省略展示，避免表格被撑变形。
  - 操作列固定显示，测试和删除按钮更容易访问。
- 达梦连接错误提示优化：
  - 后端未捕获异常统一返回 JSON 错误详情，前端不再只显示 `Internal Server Error`。
  - Electron 请求层兼容非 JSON 错误响应，避免错误解析失败。
  - whl 驱动加载失败时展示更明确的 Python 版本、平台和搜索路径信息。
- 达梦 JDBC 元数据兼容性优化：
  - JDBC 返回的 Java String 会转换为 Python 字符串，避免元数据和查询结果校验失败。
  - 表数据中的 Java 值会转换为 JSON 可序列化类型。
- 达梦数据预览优化：
  - 过滤内部分页辅助列 `_DATADJINN_RN` / `__DATADJINN_RN`，表格只展示真实业务字段。
  - 日期、时间、Decimal、bytes 等结果值会转换为前端可展示格式。

## 修复

- 修复选择 JDBC 驱动时仍尝试导入 dmPython 的问题。
- 修复 JVM 自动探测到失效 Java 路径导致 JDBC 连接失败的问题。
- 修复 JDBC jar 未加入 classpath 导致 `DmDriver is not found` 的问题。
- 修复 JDBC 连接被 SQLite 方言误处理导致 `create_function` 报错的问题。
- 修复 JDBC 自定义方言缺少 DBAPI 信息导致创建 Schema 失败的问题。
- 修复 JDBC 连接池 pre-ping 与自定义方言不兼容的问题。
- 修复达梦新建 Schema 使用 `CREATE DATABASE` 导致错误码 `-2007` 的问题。
- 修复达梦 Schema 列表查询使用不存在的 `SYSOBJECTS.SCHNAME` 字段导致打开连接失败的问题。
- 修复新建空 Schema 后不显示在连接树中的问题。
- 修复达梦 JDBC 查看表数据时列名或行值为 Java 对象导致响应校验/序列化失败的问题。

## 打包说明

- Windows Release 仍提供安装包和解压版。
- 达梦驱动仍不默认内置到发布包中；如需连接达梦，请在驱动管理中添加本机可用的 JDBC jar、dmPython pyd 或 dmPython whl 驱动。
- 使用 JDBC 驱动连接达梦需要本机安装可用的 64 位 JDK/JRE。
