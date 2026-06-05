# DataDjinn Agent Handoff

## 1. 项目定位

- 项目名：`DataDjinn`
- 形态：本地桌面数据库管理工具
- 目标：把传统数据库客户端能力和 AI 辅助能力整合到一个 Electron 桌面应用里
- 当前已发布版本：`v0.1.13`
- 当前主分支：`main`

核心能力包括：

- 多数据库连接与管理
- 表 / 视图 / 集合 / Redis Key 浏览
- 数据预览、过滤、分页、导入、导出、备份
- 表结构创建与修改
- AI 问答、SQL 生成、受控数据库操作

## 2. 技术栈

### 桌面层

- `Electron 39`
- `electron-builder`

### 前端

- `React 19`
- `TypeScript`
- `Vite 7`
- `Ant Design 6`
- `Monaco Editor`
- `Zustand`

### 后端

- `FastAPI`
- `SQLAlchemy 2.x`
- `PyMySQL`
- `psycopg`
- `PyMongo`
- `redis-py`
- `clickhouse-connect`

### AI

- OpenAI 兼容 API
- 后端 AI 逻辑在 `backend/app/ai`

## 3. 当前支持的数据库

- `SQLite`
- `MySQL`
- `PostgreSQL`
- `达梦 DM`
- `MongoDB`
- `Redis`
- `ClickHouse`

## 4. 关键目录与模块职责

### 根目录

- `README.md`
  - 对外说明、功能概览、开发启动方式
- `RELEASE_NOTES.md`
  - 当前版本 Release 文案
- `bug.md`
  - 用户要求“处理问题”时优先读取
- `vplan.md`
  - 用户要求“出方案”或“实现方案”时关联使用

### Electron 主进程

- `src/main/index.ts`
  - 主窗口
  - IPC
  - 更新逻辑
  - 文件选择
  - 与前端通信
- `src/main/backend.ts`
  - 开发态 / 生产态后端拉起逻辑
  - 健康检查
  - 后端端口与启动等待

### 预加载层

- `src/preload/index.d.ts`
  - 暴露到前端的 API 类型定义

### 前端

- `src/renderer/src/App.tsx`
  - 核心页面
  - 非常大，包含大量主流程逻辑
  - 连接树、数据表格、表设计器、设置弹框、更新弹框、导入导出等都在这里
- `src/renderer/src/assets/main.css`
  - 大量页面样式
- `src/renderer/src/components/AIPanel`
  - AI 相关交互
- `src/renderer/src/components/SqlEditor.tsx`
  - SQL / Mongo / Redis 编辑器

### 后端

- `backend/run.py`
  - 后端启动入口
- `backend/app/api`
  - FastAPI 路由
- `backend/app/db/connection_manager.py`
  - 各数据库连接创建
  - 达梦 / ClickHouse 驱动接入关键点
- `backend/app/db/metadata.py`
  - 表结构、元数据、建表、改表核心逻辑
- `backend/app/db/readonly_query.py`
  - 预览查询、只读查询结果处理
- `backend/app/db/sql_executor.py`
  - SQL 执行
- `backend/app/schemas`
  - Pydantic schema
- `backend/app/ai`
  - AI Agent 逻辑

## 5. 本地开发与启动

### 前端开发模式

```powershell
npm run dev
```

说明：

- 开发态前端会自动拉起后端
- 不需要再手动先开后端
- 自动拉起逻辑在 `src/main/backend.ts`

### 后端单独启动

```powershell
cd backend
.\.venv\Scripts\python.exe run.py
```

### 依赖安装

前端：

```powershell
npm install
```

后端：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 6. 常用构建命令

完整 Windows 发版构建：

```powershell
npm run build:win:all
```

仅安装包：

```powershell
npm run build:win:installer
```

仅绿色版：

```powershell
npm run build:win:zip
```

仅前端：

```powershell
npm run build:frontend
```

仅后端：

```powershell
npm run build:backend
```

## 7. 常用校验命令

如果环境里 `npm` 正常可用，优先做这些检查：

```powershell
npm run typecheck:node
npm run typecheck:web
```

后端语法校验可用：

```powershell
cd backend
.\.venv\Scripts\python.exe -m py_compile app\api\metadata.py app\db\metadata.py app\db\readonly_query.py app\schemas\metadata.py
```

## 8. v0.1.11 相对 v0.1.10 的关键改动

- 新增 `ClickHouse` 支持
- 新增可视化建表能力
- 增强修改表能力
  - 表注释
  - 字段注释
  - 唯一
  - 自增
  - 自增步长
  - 最小值 / 最大值
- 表设计器 UI 重构
  - 字段主行只显示名称、类型、注释
  - 详细属性放到展开区
- 修复编辑表时字段注释不回显
- 修复达梦查询结果中 `CLOB` / `Text` 大字段只显示对象引用的问题
- 优化开发态前端自动拉起后端
- 补强安装版在线更新状态识别
- 修复部分页面和设置弹框中文乱码

## 9. 本轮改动涉及的重点文件

- `backend/app/api/metadata.py`
- `backend/app/db/metadata.py`
- `backend/app/db/readonly_query.py`
- `backend/app/schemas/metadata.py`
- `src/main/backend.ts`
- `src/main/index.ts`
- `src/preload/index.d.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/assets/main.css`
- `package.json`
- `package-lock.json`
- `RELEASE_NOTES.md`

## 10. 数据库相关特殊说明

### 达梦 DM

- 默认不直接内置完整达梦驱动方案
- 通过“设置 -> 驱动管理”添加驱动
- 目前支持：
  - `JDBC jar`
  - `dmPython pyd`
  - `dmPython whl`
- 达梦相关问题优先看：
  - `backend/app/db/connection_manager.py`
  - `backend/app/db/readonly_query.py`
  - `backend/app/db/metadata.py`

### ClickHouse

- 使用 `clickhouse-connect`
- SQLAlchemy 方言模块：
  - `clickhouse_connect.cc_sqlalchemy.dialect`
- 如果提示缺少方言，优先检查后端依赖安装和构建打包是否包含相关模块

### PostgreSQL

- 需要注意 `database` 和 `schema` 的层次
- 当前建表 / 改表逻辑里对 `pg_database` 做过补充支持

### Redis / MongoDB

- 不是传统 SQL 数据库流程
- 相关浏览、导出、编辑逻辑不要按关系型数据库假设来改

## 11. 已知实现特点与历史坑点

### 11.1 开发态前端自动拉起后端

关键逻辑在 `src/main/backend.ts`，已经处理过：

- 优先使用 `backend\.venv\Scripts\python.exe`
- 自动补上 `PYTHONPATH`
- 可从 `.venv\pyvenv.cfg` 回退定位 Python

如果这里退化，常见现象是：

- 前端一直显示“服务启动中”
- 健康检查失败
- 用户误以为后端没启动

### 11.2 App.tsx 很大

- `src/renderer/src/App.tsx` 目前是核心大文件
- 许多功能都在同一个文件里
- 处理问题时先精准定位相关函数和状态，不要盲改整段逻辑

### 11.3 中文乱码问题出现过

- 之前出现过页面文案编码污染
- 尤其是：
  - 设置弹框
  - 达梦名称
  - 列提示文字
- 如果用户反馈乱码，先确认：
  - 是源码真的有乱码
  - 还是前端旧 bundle 没刷新

### 11.4 发布时工作区可能不是干净的

- 可能会有内部文件变更：
  - `vplan.md`
  - `docs/`
- 这些不一定应该进入 release commit

## 12. 常见问题排查手册

### 前端一直显示“服务启动中”

1. 先单独启动后端确认后端是否正常：

```powershell
cd backend
.\.venv\Scripts\python.exe run.py
```

2. 再看前端开发态是否真正拉起后端
3. 检查 `src/main/backend.ts`
4. 检查健康检查接口是否可访问

### 前端启动后页面还是旧内容

1. 先重启 `npm run dev`
2. 再确认不是旧 bundle 缓存
3. 再检查源码是否真的已修改到对应文案

### 达梦查询结果里大字段显示对象引用

优先检查：

- `backend/app/db/readonly_query.py`
- 大对象读取逻辑是否仍保留
  - `getSubString`
  - `read()`

### 编辑表时字段注释没有回显

优先检查：

- `backend/app/db/metadata.py`
- `list_columns()` 是否返回 `comment`

### ClickHouse 连接时报方言缺失

优先检查：

- `backend/requirements.txt`
- `backend/app/db/connection_manager.py`
- 打包脚本是否包含：
  - `clickhouse_connect`
  - `clickhouse_connect.cc_sqlalchemy`
  - `clickhouse_connect.cc_sqlalchemy.dialect`

### 安装版在线更新异常

优先检查：

- `src/main/index.ts`
- 前端更新弹框逻辑
- `installerDownloaded` 状态联动

## 13. 发布流程备忘

当前版本发布方式已经走通过一次，标准流程如下：

1. 更新版本号
   - `package.json`
   - `package-lock.json`
2. 更新 `RELEASE_NOTES.md`
3. 做最基本校验
   - 前端 typecheck
   - 后端语法校验
4. 提交发布 commit
5. 打 tag
6. 推送 `main`
7. 推送 tag
8. 创建 GitHub Release

本次实际发布信息：

- release commit：`d7a8268`
- release tag：`v0.1.11`
- release url：
  - `https://github.com/vhukze/DataDjinn/releases/tag/v0.1.11`

## 14. 发版 / CSDN 持续记录规则

后续每次发版和每次发 CSDN 帖子后，都要立即开始进入下一轮持续记录。

### 14.1 发版记录

- 使用文件：`docs/release_record.md`
- 作用：
  - 记录“下一次发版”相对“上一次已发布版本”的对外变化
- 记录内容应包含：
  - 新增功能
  - 修改过的功能
  - 优化过的问题
  - 有用户感知的兼容性修复
- 下次发版时：
  - 先读取 `docs/release_record.md`
  - 再整理成新的 `RELEASE_NOTES.md` / GitHub Release 文案

### 14.2 CSDN 帖子记录

- 使用文件：`docs/csdn_record.md`
- 作用：
  - 记录“下一篇帖子”相对“上一次已发布帖子基线”的对外变化
- 下次发帖时：
  - 先读取 `docs/csdn_record.md`
  - 再整理成一篇新的帖子
- 帖子正文里必须带上项目地址：
  - `https://github.com/vhukze/DataDjinn`

### 14.3 记录边界

记录的是“相对上次已发布基线，真正值得对外表达的变化”，包括：

- 新增功能
- 功能修改
- 体验优化
- 有意义的问题修复

但不要把“同一版本开发过程中，为了把一个尚未发布的新功能修到可用而产生的内部修 bug 过程”拆成独立记录项。

正确示例：

- 上次版本没有达梦，这次版本新增了达梦支持

不应这样记录：

- 新增达梦支持
- 修复达梦连接报错
- 修复达梦查询报错

如果这些报错只是“达梦支持在本次版本开发过程中的持续修正”，那对外应合并表达为：

- 新增达梦支持

只有当某个能力已经在上一个正式版本里对外发布过，而这一次又针对它做了新的修改、优化或问题修复，才应该单独记为一条。

### 14.4 记录时机

- 每次正式发版完成后：
  - 立即重置并开始维护新的 `docs/release_record.md`
- 每次正式发帖完成后：
  - 立即重置并开始维护新的 `docs/csdn_record.md`
- 平时开发过程中：
  - 只有确认这项变化相对上次已发布基线具有独立对外价值时，才写入记录

## 15. CSDN / 外部内容说明

- `docs/csdn_baseline.md`
  - 记录上次帖子基线
- `docs/csdn_post.md`
  - 当前准备发布或参考的帖子正文
- `docs/release_record.md`
  - 下一次发版前的持续记录
- `docs/csdn_record.md`
  - 下一次发帖前的持续记录

这些文件偏运营内容，不一定应该进入正式版本提交。

### 提交规则

- 允许提交：
  - `AGENTS.md`
  - `AGENT.md`
- 默认不要提交：
  - `docs/` 下的记录文件
  - `bug.md`
  - `vplan.md`
- 如果用户手动删除了某个无用文件，不要自动把这类删除操作一起带进提交，除非用户明确要求提交该删除

## 16. 新会话推荐接手顺序

1. 先读本文件 `AGENTS.md`
2. 再看 `README.md`
3. 再看最新 `RELEASE_NOTES.md`
4. 若问题与表结构相关，优先看：
   - `src/renderer/src/App.tsx`
   - `backend/app/db/metadata.py`
   - `backend/app/api/metadata.py`
5. 若问题与启动相关，优先看：
   - `src/main/backend.ts`
   - `src/main/index.ts`
6. 若问题与数据库连接相关，优先看：
   - `backend/app/db/connection_manager.py`
7. 若用户说“处理问题”，再读 `bug.md`
8. 若用户说“出方案 / 实现方案”，再读 `vplan.md`

## 17. 给后续 Agent 的工作原则

- 不要默认回滚用户已有修改
- 先确认问题属于源码、环境、缓存还是构建产物
- 优先小范围修复，不要轻易大拆 `App.tsx`
- 涉及达梦、ClickHouse、更新机制时，先看已有兼容逻辑，再决定是否改
- 发布前注意检查是否把 `docs/`、`vplan.md` 这类内部文件错误带入 release commit
- 整理发布说明或帖子前，优先读取持续记录文件，而不是只翻 `git diff`
- 除 `AGENTS.md` / `AGENT.md` 外，记录类文件默认不进入正式提交
## 18. README 发版同步规则
- 每次正式发布新版本时，必须同步检查并更新 `README.md`
- 如果本次版本新增了功能、支持了新的数据库、补充了重要体验优化或有对外可感知的能力变化，需要把这些内容补充到 `README.md`
- `README.md` 中如果写了当前最新版本、最新 tag 或版本号，发版时必须同步改成最新发布版本
- 以后发版时，README 更新属于固定检查项，和版本号、发布说明、tag 一样必须检查，不能遗漏
