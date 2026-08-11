<p align="center">
  <img src="resources/logo-horizontal.svg" alt="DataDjinn" width="360" />
</p>

<p align="center">
  <strong>AI 驱动的桌面数据库管理工具</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-blue?logo=windows" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-39.x-9feaf9?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19.x-61dafb?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/python-3.13+-3776AB?logo=python" alt="Python" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-blue?logo=apache" alt="License" />
</p>

---

## 📖 简介

DataDjinn 是一款**跨时代**的本地数据库桌面客户端，将传统数据库管理能力与 **AI 自然语言交互**深度融合。无需编写 SQL，用中文描述需求即可完成查询、建表、改表等操作 —— AI 会自动读取你的数据库结构，生成并执行正确的 SQL。

### 核心能力

- 🧠 **AI 对话式数据库操作** —— 接入任意 OpenAI 兼容 API，AI 深度理解 Schema 上下文，支持自然语言查数据、建表、修改表结构；受控写操作会继承当前库与模式
- 🤖 **AI 流式思考与上下文管理** —— AI 回复与思考过程支持流式展示；自动主上下文与手动补充上下文分开管理，支持临时主上下文、层级去重、折叠显示、容量统计、自动压缩和重启后会话恢复
- 🔗 **多数据库支持** —— SQLite / MySQL / PostgreSQL / Oracle / 达梦 DM / 高斯数据库 / MongoDB / Redis / ClickHouse
- 🛰️ **SSH 隧道连接** —— 新建和编辑连接时可直接配置 SSH 主机、密码或私钥认证，并支持单独测试 SSH 隧道连通性
- ✨ **焕新工作区界面** —— 连接树、欢迎页、表格预览、查询窗口和 AI 面板统一升级为更轻盈的桌面工作区风格
- ✍️ **专业 SQL / 命令编辑器** —— 基于 Monaco Editor，支持关键字、当前库表及语句关联字段补全，并可按当前数据库方言格式化 SQL；支持 MongoDB Shell 风格语句和 Redis 常用命令，多标签页并行工作
- ⚡ **高效 SQL 执行** —— 自动识别并高亮当前语句，每条 SQL 首行可直接执行；SQL 超时可在设置中配置，默认 15 分钟
- 🗂️ **连接组织、迁移与查询历史** —— 新建连接可直接选择或创建分组，右键可复制连接信息和 JDBC URL；支持加密导出/导入 DataDjinn 连接包、导入 DBeaver 数据源、自动保存查询工作区，并从历史列表快速恢复
- 🧭 **连接树与数据预览** —— 支持连接分组、排序、连接/库/模式/表/视图/MongoDB 集合/Redis DB 浏览和可导航搜索；表格预览与查询结果支持 WHERE 过滤、分页、Excel 式多单元格选择、批量编辑、草稿标记、列顺序拖拽和列宽调整
- 🧩 **手动驱动数据库管理** —— 支持在驱动管理中统一维护达梦、高斯等需要手动配置驱动的数据库类型
- 🧰 **Redis Key 管理** —— 支持 Redis DB 勾选浏览、Key 列表查看、String / Hash / List / Set / ZSet 新增编辑删除和统一提交
- 📦 **备份 / 导出 / 导入** —— 备份用于完整恢复，导出用于数据交换；SQL 导出支持结构、数据、结构 + 数据三种内容，MongoDB / Redis 支持 JSON 导出
- 🔐 **密码安全存储** —— Windows DPAPI 加密，仅当前用户可解密
- 🎨 **深色 / 浅色主题** —— 自适应系统主题，手动切换也支持
- 🪶 **无边框窗口** —— 自定义标题栏，简洁沉浸
- ⬆️ **应用更新** —— 安装版支持自动下载并重启安装，绿色版支持检测新版本并下载 zip 后手动替换

---

## 🖥️ 截图

> 启动应用后，左侧树管理连接与 Schema，中央 SQL 编辑器编写查询，右侧 AI 面板用自然语言操作数据库。

### 创建连接
<img width="1792" height="974" alt="image" src="https://github.com/user-attachments/assets/844bbe20-4e4b-4079-9170-daa761d78be5" />

### SQL 编辑与 AI 问答
<img width="1792" height="974" alt="image" src="https://github.com/user-attachments/assets/5ecdf166-6dae-4d5c-9f9e-31bbfbffd900" />

### 数据预览与 AI 分析
<img width="1792" height="974" alt="image" src="https://github.com/user-attachments/assets/390a5e77-5411-46c7-8033-0d8af80c1b10" />

### AI 设置

<img width="1792" height="974" alt="image" src="https://github.com/user-attachments/assets/46c59551-ef81-4ff1-99bf-1ec3ef05bd2f" />


---

## 🗄️ 支持的数据库

| 数据库 | 驱动 | 说明 |
|--------|------|------|
| **SQLite** | sqlite3 | 本地文件数据库，即开即用 |
| **MySQL** | PyMySQL | 支持 5.x / 8.x |
| **PostgreSQL** | psycopg 3 | 支持 12+ |
| **Oracle** | python-oracledb | 支持连接、Schema 浏览、表/视图/触发器/序列等对象浏览、表预览、WHERE 过滤、DDL 查看、新建用户以及新建表 / 修改表主要能力 |
| **达梦 DM** | 外部 JDBC jar / dmPython pyd / dmPython whl 驱动 | 国产数据库，支持 DM8；可在驱动管理中添加驱动，并在连接信息中选择指定驱动，默认打包不内置达梦 DLL |
| **高斯数据库** | 外部 JDBC jar 驱动 | 国产数据库；可在驱动管理中添加高斯 JDBC 驱动，并在连接信息中选择指定驱动 |
| **MongoDB** | PyMongo | 支持连接、数据库/集合浏览、字段推断、集合预览、只读查询、创建集合、插入测试数据和 JSON 导出 |
| **Redis** | redis-py | 支持连接、DB 勾选浏览、Key 列表、String / Hash / List / Set / ZSet 新增编辑删除、常用命令执行和 JSON 导出；兼容禁用 `CONFIG` 命令的受限服务 |
| **ClickHouse** | clickhouse-connect | 支持连接、数据库/表浏览、只读查询、表结构查看和 SQL 执行；查询直接使用目标数据库和请求级超时设置，减少额外网络往返 |

---

## 🧠 AI 功能

DataDjinn 内置 AI 对话面板，接入 **OpenAI 兼容 API**（如 OpenAI、DeepSeek、通义千问、本地 Ollama 等）。

### AI 能做什么

| 场景 | 示例 |
|------|------|
| 自然语言查询 | "查询近 30 天下单超过 3 次的用户" |
| 创建表 / 集合 / Key | "创建一个员工表，包含姓名、部门、入职日期" / "创建一个 users 集合并添加 10 条测试数据" / "生成 Redis HSET 测试命令" |
| 修改表结构 | "给用户表增加一个手机号字段" |
| 探索数据 | "这个库有哪些表？orders 表结构是什么？" / "这个 Redis DB 里有哪些 Key？" |
| SQL / 命令分析 | "这段 SQL 为什么慢，帮我优化" / "解释这个 Redis 命令会做什么" |

### 特色设计

- **全局问答** —— 未选择上下文时也可提问，AI 可读取当前连接概览并整理回答
- **产品知识库** —— 可直接询问快捷键修改、连接导出、驱动配置和其他 DataDjinn 使用方法
- **会话恢复** —— AI 对话及完整回复自动保存，重新打开应用后可继续查看和提问
- **焦点上下文** —— 当前选中的连接、库、模式、表、集合、Redis DB / Key 可直接作为 AI 分析对象
- **多上下文管理** —— 当前库或模式作为主上下文，手动添加的库和模式作为补充上下文；无主上下文时首个手动项可临时执行数据库工具，PostgreSQL / 高斯支持数据库与模式层级切换和去重
- **查询窗口联动** —— AI 可读取当前 SQL / 命令编辑器内容，也可把生成内容追加写入查询窗口
- **Schema 感知** —— AI 自动获取当前数据库的表结构、集合信息或 Redis Key 概览作为上下文
- **自动压缩** —— 长对话自动总结压缩，突破 token 上限
- **Plan-Execute 模式** —— 复杂操作先生成执行计划，确认后逐步执行
- **工具调用** —— AI 通过内置工具执行 SQL、MongoDB 语句和 Redis 命令，预览数据并读取 Schema

---

## 📦 备份、导出与导入

| 功能 | 用途 | 说明 |
|------|------|------|
| 备份 | 完整恢复 | 生成可恢复当前数据库的 SQL 备份文件，适合回滚或迁移前留档 |
| 导出 | 数据交换 | 支持按数据库、模式或表导出 SQL / CSV；MongoDB / Redis 导出为 JSON |
| 导入 | 数据写入 | 支持执行 SQL 文件和导入 CSV 文件，执行结果会展示成功、失败与可复制错误信息 |

MySQL SQL 备份和导入会在执行期间临时关闭外键检查，避免因表依赖顺序导致恢复失败。

Redis / MongoDB 导出为 JSON，适合迁移前留档、人工检查或和其他工具进行数据交换。

连接列表支持导出为加密的 `.ddj` 文件，完整保留连接参数、密码、SSH 隧道配置、分组和排序结构；另一台设备输入口令后即可导入恢复。

---

## 🚀 快速开始

### 下载安装

从 [Releases](https://github.com/vhukze/DataDjinn/releases) 下载最新版本：

- `DataDjinn-x.x.x-setup.exe` —— Windows NSIS 安装包（推荐）
- `DataDjinn-x.x.x-win.zip` —— Windows 解压即用版

当前最新版本：`v0.2.17`。

解压版无需安装，解压后双击 `DataDjinn.exe` 即可运行。已内置 Python 运行时和所有后端依赖，无需额外安装任何环境。

### 开发环境搭建

**前置要求**
- Node.js 20+
- Python 3.13+
- npm

```bash
# 1. 克隆仓库
git clone git@github.com:vhukze/DataDjinn.git
cd DataDjinn

# 2. 安装前端依赖
npm install

# 3. 创建 Python 虚拟环境并安装后端依赖
cd backend
python -m venv .venv
.venv\Scripts\activate       # Windows
pip install -r requirements.txt
cd ..

# 4. 启动开发模式（前后端热重载）
npm run dev
```

### 打包

```bash
# 构建完整 Windows 包（安装包 + 解压版）
npm run build:win:all
```

构建产物在 `dist/` 目录：
- `DataDjinn-x.x.x-setup.exe` — Windows NSIS 安装包
- `DataDjinn-x.x.x-win.zip` — Windows 解压版

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────┐
│              Electron 主进程              │
│  ┌──────────────┐  ┌──────────────────┐ │
│  │ 窗口管理      │  │ 后端进程管理      │ │
│  │ (无边框窗口)  │  │ (Python 子进程)   │ │
│  └──────────────┘  └──────────────────┘ │
├─────────────────────────────────────────┤
│             React 渲染进程               │
│  ┌──────────────┐  ┌──────────────────┐ │
│  │ Ant Design 6 │  │ Monaco Editor    │ │
│  │ UI 组件      │  │ SQL 编辑器       │ │
│  └──────────────┘  └──────────────────┘ │
│  ┌──────────────────────────────────┐   │
│  │ Zustand 状态管理                  │   │
│  └──────────────────────────────────┘   │
├─────────────────────────────────────────┤
│        Python FastAPI 后端               │
│  ┌──────────────┐  ┌──────────────────┐ │
│  │ SQLAlchemy   │  │ AI Agent         │ │
│  │ PyMongo/Redis│  │ (OpenAI 兼容)    │ │
│  └──────────────┘  └──────────────────┘ │
│  ┌──────────────────────────────────┐   │
│  │ DPAPI 密码加密                    │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 39 |
| 前端 | React 19 + TypeScript + Vite 7 |
| UI 组件库 | Ant Design 6 |
| SQL 编辑器 | Monaco Editor |
| 状态管理 | Zustand |
| 后端框架 | FastAPI (Python) |
| ORM / 数据驱动 | SQLAlchemy 2.0 + PyMongo + redis-py |
| AI SDK | OpenAI Python |
| 打包 | electron-builder + PyInstaller |

---

## 📂 项目结构

```
DataDjinn/
├── src/                      # Electron + React 源码
│   ├── main/                 # 主进程（窗口、IPC、后端启动）
│   ├── preload/              # 预加载脚本（安全桥接）
│   └── renderer/             # 渲染进程（React UI）
│       └── src/
│           ├── App.tsx        # 主界面
│           ├── components/    # 组件
│           │   ├── AIPanel/   # AI 对话面板
│           │   └── SqlEditor.tsx  # SQL 编辑器
│           └── context/       # React Context（主题等）
├── backend/                  # Python 后端
│   └── app/
│       ├── main.py           # FastAPI 入口
│       ├── api/              # API 路由
│       │   ├── connections.py # 连接管理
│       │   ├── drivers.py     # 外部驱动管理
│       │   ├── query.py      # SQL 执行
│       │   ├── metadata.py   # Schema 读取
│       │   ├── backup.py     # 备份、导出、导入接口
│       │   └── ai_router.py  # AI 对话接口
│       ├── db/               # 数据库层
│       │   ├── connection_manager.py  # 连接池 + 密码加密
│       │   ├── driver_manager.py      # 达梦外部驱动管理
│       │   ├── redis_utils.py         # Redis 工具函数
│       │   ├── sql_executor.py        # SQL 执行器
│       │   ├── backup_manager.py      # 备份、导出、导入管理
│       │   ├── readonly_query.py      # 只读查询 / MongoDB / Redis 命令执行
│       │   └── metadata.py            # 元数据读取与表格 / Redis 数据编辑
│       └── ai/               # AI Agent
│           └── agent.py      # AI 工具调用 Planner
├── resources/                # 应用图标
├── electron-builder.yml      # 打包配置
└── package.json              # 项目配置
```

---

## ⌨️ 开发命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发模式（热重载） |
| `npm run build:win:all` | 构建 Windows 安装包 + 解压版 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 代码检查 |
| `npm run format` | Prettier 格式化 |

---

## 📄 License

[Apache-2.0](LICENSE)

---

<p align="center">
  Made with ❤️ by vhukze
</p>
