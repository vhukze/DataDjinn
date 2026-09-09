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
