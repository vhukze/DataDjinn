# DataDjinn v0.1.21

## Highlights

- 修复 macOS `dmg` 构建失败问题
- 收紧 Electron 安装包文件收集范围，避免源码目录中的 `backend/.venv` 被扫描进安装包
- macOS 发布流水线在 Electron 打包前主动清理 CI 虚拟环境，避免符号链接 Python 再次触发安全拦截

## What's Changed

- `electron-builder.yml` 改为以 `out/**/*` 为主的白名单打包，并显式排除源码 `backend/`、`dist/`、`docs/` 等目录
- `.github/workflows/release.yml` 在 macOS 构建阶段增加 `backend/.venv` 清理步骤
- 保持后端仍通过 `extraResources` 注入安装包，不改变现有运行时目录结构

## Notes

- 当前版本号为 `v0.1.21`
- 本次发布重点是修复 macOS 安装包构建失败
- 发布前已完成前端 TypeScript 校验和后端 Python 语法校验
