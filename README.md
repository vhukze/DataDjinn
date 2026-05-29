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

- 🧠 **AI 对话式数据库操作** —— 接入任意 OpenAI 兼容 API，AI 深度理解 Schema 上下文，支持自然语言查数据、建表、修改表结构
- 🔗 **多数据库支持** —— SQLite / MySQL / PostgreSQL / 达梦 DM
- ✍️ **专业 SQL 编辑器** —— 基于 Monaco Editor，语法高亮、智能补全、多标签页
- 🧭 **连接树与数据预览** —— 支持连接、库、模式、表、视图等对象浏览，表格预览支持行列选择、列顺序拖拽和单元格编辑
- 📦 **备份 / 导出 / 导入** —— 备份用于完整恢复，导出用于数据交换；SQL 导出支持结构、数据、结构 + 数据三种内容
- 🔐 **密码安全存储** —— Windows DPAPI 加密，仅当前用户可解密
- 🎨 **深色 / 浅色主题** —— 自适应系统主题，手动切换也支持
- 🪶 **无边框窗口** —— 自定义标题栏，简洁沉浸

---

## 🖥️ 截图

> 启动应用后，左侧树管理连接与 Schema，中央 SQL 编辑器编写查询，右侧 AI 面板用自然语言操作数据库。

---

## 🗄️ 支持的数据库

| 数据库 | 驱动 | 说明 |
|--------|------|------|
| **SQLite** | sqlite3 | 本地文件数据库，即开即用 |
| **MySQL** | PyMySQL | 支持 5.x / 8.x |
| **PostgreSQL** | psycopg 3 | 支持 12+ |
| **达梦 DM** | dmPython | 国产数据库，支持 DM8 |

---

## 🧠 AI 功能

DataDjinn 内置 AI 对话面板，接入 **OpenAI 兼容 API**（如 OpenAI、DeepSeek、通义千问、本地 Ollama 等）。

### AI 能做什么

| 场景 | 示例 |
|------|------|
| 自然语言查询 | "查询近 30 天下单超过 3 次的用户" |
| 创建表 | "创建一个员工表，包含姓名、部门、入职日期" |
| 修改表结构 | "给用户表增加一个手机号字段" |
| 探索数据 | "这个库有哪些表？orders 表结构是什么？" |
| SQL 分析 | "这段 SQL 为什么慢，帮我优化" |

### 特色设计

- **全局问答** —— 未选择上下文时也可提问，AI 可读取当前连接概览并整理回答
- **焦点上下文** —— 当前选中的连接、库、模式、表可直接作为 AI 分析对象
- **查询窗口联动** —— AI 可读取当前 SQL 编辑器内容，也可把生成的 SQL 追加写入查询窗口
- **Schema 感知** —— AI 自动获取当前数据库的表结构作为上下文
- **自动压缩** —— 长对话自动总结压缩，突破 token 上限
- **Plan-Execute 模式** —— 复杂操作先生成执行计划，确认后逐步执行
- **工具调用** —— AI 通过内置工具执行 SQL、预览数据、读取 Schema

---

## 📦 备份、导出与导入

| 功能 | 用途 | 说明 |
|------|------|------|
| 备份 | 完整恢复 | 生成可恢复当前数据库的 SQL 备份文件，适合回滚或迁移前留档 |
| 导出 | 数据交换 | 支持按数据库、模式或表导出 SQL / CSV，SQL 可选择仅结构、仅数据或结构 + 数据 |
| 导入 | 数据写入 | 支持执行 SQL 文件和导入 CSV 文件，执行结果会展示成功、失败与可复制错误信息 |

MySQL SQL 备份和导入会在执行期间临时关闭外键检查，避免因表依赖顺序导致恢复失败。

---

## 🚀 快速开始

### 下载安装

从 [Releases](https://github.com/vhukze/DataDjinn/releases) 下载最新版本：

- `DataDjinn-x.x.x-setup.exe` —— NSIS 安装包（推荐）
- `DataDjinn-x.x.x-win.zip` —— 解压即用版

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

### 打包发布

```bash
# 构建完整 Windows 包（安装包 + 解压版）
npm run build:win:all
```

构建产物在 `dist/` 目录：
- `DataDjinn-x.x.x-setup.exe` — NSIS 安装包
- `DataDjinn-x.x.x-win.zip` — 解压版

### 自动发布 Release

推送 `v*.*.*` 格式的 tag 会触发 GitHub Actions 自动构建 Windows 安装包和解压版，并创建 GitHub Release。

```bash
# 1. 修改 package.json 中的 version，例如 0.1.1
# 2. 提交版本改动
git add package.json package-lock.json
git commit -m "chore: release v0.1.1"

# 3. 创建并推送 tag
git tag v0.1.1
git push origin main
git push origin v0.1.1
```

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
│  │ 多数据库引擎  │  │ (OpenAI 兼容)    │ │
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
| ORM | SQLAlchemy 2.0 |
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
│       │   ├── query.py      # SQL 执行
│       │   ├── metadata.py   # Schema 读取
│       │   ├── backup.py     # 备份、导出、导入接口
│       │   └── ai_router.py  # AI 对话接口
│       ├── db/               # 数据库层
│       │   ├── connection_manager.py  # 连接池 + 密码加密
│       │   ├── sql_executor.py        # SQL 执行器
│       │   ├── backup_manager.py      # 备份、导出、导入管理
│       │   ├── readonly_query.py      # 只读查询
│       │   └── metadata.py            # 元数据读取
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
