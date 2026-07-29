# 移动端 Vibe Coding

Yachiyo Claw 把 Android 手机作为轻量开发主机，而不是缩小版桌面 IDE。“开发”入口复用现有 Task、Provider、Sandbox、Workspace 与 Tool Broker；普通聊天和手机控制 Agent 保持独立。

## 平台能力

| 目标 | 手机本地构建 | 手机本地验证 | 状态 |
| --- | --- | --- | --- |
| Static Web、Vite、PWA | 是 | 受控 loopback WebView | 正式支持 |
| Capacitor Debug APK | 是 | 系统安装器安装并查询版本 | 正式支持 |
| Java/Kotlin Debug APK | 是 | 系统安装器安装并查询版本 | Beta |
| Node、Python、Linux ARM64 | 项目命令 | PRoot 工作区 | 工作区支持 |
| React Native、Flutter、NDK、浏览器扩展 | 工具链不完整 | 不承诺 | 源码支持 |
| Windows、macOS、iOS、Linux x86_64、Docker | 否 | 否 | 需要远程构建 |

源码生成、构建完成与验证完成是三个不同状态。远程目标在没有 `RemoteBuildProvider` 时只能准备和导出源码。

## 工作流

1. 创建 Web/PWA/Android 模板，或通过 SAF 导入目录。
2. Agent 读取项目并提出带文件基线 SHA-256 的 ChangeSet。
3. 在“改动”页按文件查看、应用或拒绝；哈希冲突会停止应用。
4. 在“运行”页启动单一持久构建任务，查看限长日志，或取消任务。
5. Web 使用仅限 loopback 的受控预览；APK 只从 Target Profile 声明的 Debug 路径收集。
6. APK 显示包名、版本、签名、权限、大小与摘要，经确认后交给 Android 系统安装器。应用回到前台时重新查询已安装版本。
7. SAF 项目修改后标记为尚未写回；重启不会自动重放写入、安装或其他副作用。

## 限制

- V1 不管理 Release 密钥、商店发布、NDK/CMake、Flutter、Rust、Go、Wine、MinGW 或 Docker。
- Android 工具链至少需要 4 GB 可用空间，建议 8 GB；Web 至少需要 1 GB。
- ARM64 AAPT2 使用固定摘要的兼容二进制，仍需按设备矩阵验证。x86_64 与 ARM64 的结果分别记录。
- PRoot 不是 VM、容器或内核安全边界。所有命令仍受审批、超时、输出上限和审计约束。
