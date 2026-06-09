# DataDjinn v0.1.16

## Highlights

- 新增 GitHub Actions macOS 构建与发布链路，打 tag 后可同时产出 Windows 和 macOS 安装包
- 优化表格页内搜索交互，搜索框打开/关闭、结果导航、中文输入法与高亮行为更稳定
- 补齐 Electron 主进程与后端构建脚本的跨平台兼容，为 macOS 安装版运行做准备

## What's Changed

- 发布流水线从单一 `windows-latest` 扩展为 Windows + macOS 双平台构建
- GitHub Release 现在会自动汇总上传 Windows 安装包、Windows 压缩包、macOS `dmg` 和 macOS 压缩包
- 后端构建脚本改为跨平台 Python 解析与调用，不再写死 Windows `.venv\\Scripts\\python.exe`
- `build:backend`、`build:mac`、`build:linux`、`build:unpack` 统一串上后端构建，避免只打前端壳
- `dmPython` / `dmSQLAlchemy` 依赖改为仅 Windows 安装，避免 macOS / Linux 流水线安装失败
- PyInstaller 的 `--add-data` 参数改为按平台选择分隔符，修复非 Windows 平台后端打包兼容问题
- Electron 主进程补齐 macOS 开发态与安装态后端可执行文件查找路径
- 表格页内搜索继续优化：
  - 搜索按钮保留在工具栏，与 `DDL` 按钮同一行
  - 搜索框右侧关闭按钮恢复正常
  - 上一个 / 下一个导航改为局部状态，连续点击更顺
  - 修复输入后高亮时序错乱问题
  - 普通文本搜索改为更轻量的匹配路径，减少大量命中时的高亮开销

## Notes

- 当前版本号为 `v0.1.16`
- 本次发布重点是 macOS 发布链路和表格页内搜索性能优化
- 发布前已完成前端 TypeScript 校验
