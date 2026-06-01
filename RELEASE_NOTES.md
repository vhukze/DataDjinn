# DataDjinn v0.1.7

本版本用于修复达梦 JDBC 连接问题。

## 修复

- 修复 Windows 打包版本使用达梦 JDBC 连接时报 `Can't find org.jpype.jar support library` 的问题。
- 后端打包时显式收集 JPype 子模块和 `org.jpype.jar` 支持库，确保 JDBC + JPype 启动 JVM 时可以找到必要的支持文件。

## 打包说明

- Windows Release 仍提供安装包和解压版。
- 如需使用达梦 JDBC 连接，请确保目标机器安装了可用的 64 位 JDK/JRE，并在达梦驱动管理中添加对应 JDBC jar。
