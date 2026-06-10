# DataDjinn v0.1.20

## Highlights

- 修复 macOS `dmg` 构建失败问题
- 打包时显式排除 CI 生成的 `backend/.venv`，避免符号链接 Python 被误打进安装包
- 重新触发 macOS 发布流水线，验证新的 `dmg` 产物

## What's Changed

- `electron-builder.yml` 新增 `backend/.venv` 排除规则
- 避免 `electron-builder` 在 macOS runner 上处理指向系统 Python 的虚拟环境符号链接
- 保持原有后端发布结构不变，仅修复安装包构建阶段的资源收集问题

## Notes

- 当前版本号为 `v0.1.20`
- 本次发布重点是修复 macOS 安装包构建失败
- 发布前已完成前端 TypeScript 校验和后端 Python 语法校验
