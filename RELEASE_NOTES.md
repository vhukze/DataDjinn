# DataDjinn v0.1.24

## Highlights

- 恢复 Windows 安装包的原有内容结构，解决安装包体积异常缩小后在部分安全软件环境中无法打开的问题
- 保留 macOS `dmg` 构建修复，继续支持通过 GitHub Actions 正常产出 mac 安装包

## What's Changed

- `electron-builder.yml` 恢复 Windows 原有打包文件收集结构，重新生成两百多兆级别的安装包
- `.github/workflows/release.yml` 保留 macOS 构建链路修复：先构建后端与前端，再清理 `backend/.venv`，最后通过 `npx electron-builder --mac` 打包
- Windows 与 macOS 的发布策略分离处理，避免修复 mac 构建时误影响 Windows 安装包内容

## Notes

- 当前版本号为 `v0.1.24`
- 本次发布重点是恢复 Windows 安装包兼容性，并保留 macOS 打包修复
- 发布前已完成前端 TypeScript 校验和后端 Python 语法校验
