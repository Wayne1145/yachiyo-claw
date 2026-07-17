<p align="center">
  <img src="../assets/brand/yachiyo-claw-mark.svg" width="112" alt="Yachiyo Claw Lunar Operator 标记" />
</p>

<h1 align="center">Yachiyo Claw</h1>

[English](../README.md)

Yachiyo Claw 是一个开源的 Android AI 聊天客户端与手机本地 Agent。它保留 Chatbox 的多 Provider 对话能力，并增加直接运行在 Android 进程中的 Agent、可选本地模型，以及通过无障碍、无线 ADB、Shizuku/Sui 或 root 调用设备能力的受控后端。

> [!IMPORTANT]
> 项目仍处于早期开发阶段。Android 壳层已经可以编译 Debug APK，但尚未发布签名安装包；高权限设备自动化与本地推理仍是路线图任务，不能视为已完成功能。

## 当前进度

| 模块 | 状态 |
| --- | --- |
| Android 11+ Capacitor 壳层 | 已能编译 Debug APK |
| Chatbox 会话与 Provider Registry | 已保留并接入 |
| OpenAI Chat Completions 与 Responses | 已保留基础，Android 流式状态与错误处理已加固 |
| 工作区内可复现工具链 | 已锁定版本、校验归档并提供幂等 bootstrap |
| Android Keystore 密钥保护 | Settings、API Key 与登录 token 已保护，并有安全恢复流程 |
| Tool Policy Broker 契约 | v1 版本化契约与隐私安全审计投影已实现 |
| Android CI | 类型检查、安全聚焦测试、Gradle 测试、APK 构建及内容审计 |
| 无障碍 / ADB / Shizuku / root 后端 | 计划中 |
| LiteRT-LM 可下载本地模型 | 计划中 |
| WorkManager 后台任务与定时计划 | 计划中 |

完整里程碑和验收条件见[路线图](ROADMAP.md)，信任边界与不可绕过的安全约束见[安全模型](SECURITY_MODEL.md)。

## 核心边界

模型不能直接获得 shell、ADB、Shizuku、root、无障碍或 Android API。模型只能请求版本化的结构化工具；原生 Policy Broker 负责校验参数、评估风险、请求确认、选择可完成任务的最低权限后端、限制超时并写入审计记录。

原生 JSON-Schema Tool 是执行基础，Skill 用于组合工具，经过明确授权的 HTTP MCP 用于第三方扩展。

## 产品目标

- 面向 Android 11 以上的现代骁龙与天玑设备。
- API 优先，新手只需粘贴 API Key 即可开始。
- 支持 OpenAI-compatible Chat Completions、Responses API 与现有全类型 Provider。
- 可选下载约 1B、2B、4B 的手机本地模型，单个下载上限 15 GB。
- 内置屏幕观察、手势、应用、系统、文件、后台任务和定时工具。
- 分离权限受限的商店版与功能完整、能力差异清晰的 GitHub 侧载版。
- 采用克制的现代界面，清楚展示计划、权限、执行与验证状态。

## 构建

所有工具链、缓存、研究源码和开发模型都位于工作区。默认网络代理为 `http://127.0.0.1:7890`，可通过 `YACHIYO_PROXY_URL` 覆盖。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-toolchain.ps1 -VerifyOnly
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 doctor
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm check
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm test:android-foundation
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm run mobile:sync:android
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 gradle testDebugUnitTest --no-daemon --max-workers=1 --no-watch-fs
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 gradle assembleDebug --no-daemon --max-workers=1 --no-watch-fs
```

环境准备、上游基线问题和 APK 安装说明见[构建文档](BUILDING.md)。

## 上游项目

- [Chatbox](https://github.com/chatboxai/chatbox)：会话、UI、Provider Registry 与任务界面基础。
- [OpenDroid](https://github.com/yashab-cyber/opendroid)：Android 动作目录、Agent Loop 与模型管理参考。
- [Google AI Edge Gallery](https://github.com/google-ai-edge/gallery)：LiteRT-LM、工具调用、Skills 与模型管理参考。
- [Shizuku API](https://github.com/RikkaApps/Shizuku-API)、[libsu](https://github.com/topjohnwu/libsu) 与 [libadb-android](https://github.com/MuntashirAkon/libadb-android)：高权限后端基础组件。

所有组件都只会在 Yachiyo 的策略边界后选择性接入；上游权限清单和下载代码不会未经审计直接复制。

## 安全与发布

- API Key 和特权凭据必须由 Android Keystore 支持的加密层保护。
- 删除、外部发送、账号、购买、消息和隐私敏感动作默认需要参数级确认。
- 密码字段与敏感屏幕内容不会进入观察结果和日志。
- 项目不会尝试绕过 `FLAG_SECURE`、Android 系统确认页、受限设置或厂商安全限制。
- 自动化无障碍能力不能被描述为天然符合 Play 政策；商店版与侧载版会清楚显示能力差异。

## 名称与独立性

名称灵感来自《超时空辉夜姬》中的月见八千代。产品采用原创的“Lunar Operator”抽象身份，不使用角色立绘、服装轮廓、声线、台词、音乐、官方 Logo 或影片素材。

Yachiyo Claw 是独立开源项目，与影片、创作者、Netflix 或任何权利方无关联。工作名称在公开发布前仍需完成商标检索。

## 许可证

本仓库沿用 Chatbox Community Edition 的 [GPL-3.0](../LICENSE)。第三方库与模型权重保留各自许可证和使用条款；发布包会包含必要的 NOTICE 与软件物料清单。
