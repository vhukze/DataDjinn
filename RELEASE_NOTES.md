# DataDjinn v0.1.23

## Highlights

- 修复 macOS `dmg` 构建失败问题
- 收紧 Electron 安装包文件收集范围，避免源码目录中的 `backend/.venv` 被扫描进安装包
- 修正 macOS 流水线中 `backend/.venv` 的清理时机，保证后端先完成构建，再进入 Electron 打包
- 修复 macOS 流水线直接调用 `electron-builder` 导致命令不可用的问题

## What's Changed

- `electron-builder.yml` 改为以 `out/**/*` 为主的白名单打包，并显式排除源码 `backend/`、`dist/`、`docs/` 等目录
- `.github/workflows/release.yml` 改为先执行 `build:backend`、`build:frontend`，再删除 `backend/.venv`，最后通过 `npx electron-builder --mac` 打包
- 保持后端仍通过 `extraResources` 注入安装包，不改变现有运行时目录结构

## Notes

- 当前版本号为 `v0.1.23`
- 本次发布重点是修复 macOS 安装包构建失败
- 发布前已完成前端 TypeScript 校验和后端 Python 语法校验
