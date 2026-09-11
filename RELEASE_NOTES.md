# DataDjinn v0.3.14

## What's Changed

### 安装版在线更新可靠性

- 修复安装版下载完成后重启安装时，旧进程尚未退出导致安装器静默退出的问题。
- 更新启动器会确认主程序进程已完全退出后再启动安装包，不再依赖固定延时。
- 新增 Windows 进程级更新通用用例，持续验证安装器不会在旧进程存活时启动，并会在其退出后自动启动。

### MCP 与连接树体验

- MCP 扩展更新至 `1.0.5`，补充连接生命周期、推荐调用顺序、支持数据库和查询语法说明。
- 关闭状态的连接保持正常文字亮度，仅用状态指示区分是否已打开。

## Notes

- 当前版本号：`v0.3.14`
- 支持从 `v0.3.13` 直接升级。

**Full Changelog**: https://github.com/vhukze/DataDjinn/compare/v0.3.13...v0.3.14

---

# DataDjinn v0.3.13

## What's Changed

### MCP 扩展更新稳定性

- 修复 MCP 扩展更新时 Windows 偶发 `EPERM` 导致暂存失败的问题。
- 串行化后台重试与立即替换，避免并发移动同一扩展目录导致 `ENOENT`。
- 替换失败时自动恢复旧版本 `current` 目录，避免 MCP 服务不可用。
- 扩展页面正确显示待重启状态和立即替换操作。

## Notes

- MCP 扩展已更新至 `1.0.4`，主程序升级后可在“设置 -> 扩展”中检测更新。
- Git 表数据版本管理仍处于试验阶段，建议先在测试数据验证后再用于生产数据回退或审计。
- 当前版本号：`v0.3.13`
- 支持从 `v0.3.12` 直接升级。

**Full Changelog**: https://github.com/vhukze/DataDjinn/compare/v0.3.12...v0.3.13

---

# DataDjinn v0.3.12

## What's Changed

### 在线更新修复

- 修复安装版通过 GitHub Release 下载更新时可能返回 HTTP 403 的问题。
- 安装包更新改为应用直接下载公开 Release 资产，并使用 `latest.yml` 中的 SHA-512 校验安装包完整性。
- 下载完成后自动退出应用并启动安装程序，不再依赖不稳定的 `electron-updater` 下载链路。
- 更新弹框会显示 GitHub Release 中的版本更新内容。

## Notes

- Git 表数据版本管理仍处于试验阶段，建议先在测试数据验证后再用于生产数据回退或审计。
- 当前版本号：`v0.3.12`
- 支持从 `v0.3.11` 直接升级。

**Full Changelog**: https://github.com/vhukze/DataDjinn/compare/v0.3.11...v0.3.12
