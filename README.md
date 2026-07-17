<p align="center">
  <img src="assets/brand/yachiyo-avatar.png" width="168" alt="Yachiyo Claw" />
</p>

<h1 align="center">Yachiyo Claw</h1>

<p align="center">
  面向 Android 的开源 AI 聊天、手机 Agent 与 Live2D 实时交互应用
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-e78aaa" alt="GPL-3.0" /></a>
  <img src="https://img.shields.io/badge/Android-11%2B-3ddc84" alt="Android 11+" />
  <img src="https://img.shields.io/badge/status-early%20preview-f3a6bf" alt="Early preview" />
</p>

Yachiyo Claw 是一个 Android 优先的 AI 客户端。它在 Chatbox 的多模型对话基础上加入了直接运行于 Android 应用中的设备 Agent、Live2D 交互式对话、语音与摄像头输入、角色人格、Skills、MCP、共享会话和定时任务。

项目面向希望“粘贴 API Key 后直接使用”的用户，同时为熟悉 Android 的用户提供无障碍、Shizuku 和 root 三种设备执行后端。

> [!IMPORTANT]
> 项目仍处于早期预览阶段，目前提供可自行构建的 Debug APK，尚未发布正式签名版本。Agent 能够操作真实设备，请先在备用机或模拟器中测试，并根据任务选择合适的审批模式。

## 已实现功能

### 对话与模型

- Yachiyo API 开箱配置，API 主机固定为 `https://api.yachiyo8000.cn/v1`，支持服务端模型列表。
- 支持 OpenAI-compatible Chat Completions，并保留 Chatbox 的 Responses API 与多 Provider 适配层。
- 普通聊天和 Agent 使用统一会话入口，可在同一上下文中启用或关闭 Agent 能力。
- 本地保存会话、历史记录和模型选择；会话支持删除、收藏与 Fork。
- 角色卡支持头像、Soul 人格、用户画像、记忆、默认 LLM、TTS 和 Live2D 模型。

### Android Agent

- Root、Shizuku 和无障碍三种执行后端，可按设备条件切换。
- 内置屏幕观察、点击、滑动、文字输入、系统按键、应用启动和设备信息读取工具。
- Agent 人格与隐藏运行指令分离，切换角色不会覆盖工具使用规则。
- 支持手动审批、AI 预审和完全控制模式；危险操作可单次允许或在当前会话中允许。
- 支持自选工作目录、权限向导、Root 状态缓存、执行审计与取消任务。
- 仅在 Agent 真正操作设备时显示屏幕边缘光效、操作状态胶囊和停止按钮。
- 支持安装/编写 Skills、连接 MCP Server，以及独立的 Soul、User、Memory 编辑。

### Live2D 实时交互

- 独立“交互式”页面，可继承任意聊天上下文并切换聊天或 Agent 模式。
- 内置八千代 Live2D 模型，并支持导入包含 `.model3.json` 的 ZIP 模型包。
- 自动读取模型的表情与动作名称，模型可通过 `[action]` 标记按语音进度触发表情和动作。
- 支持流式回答、分段 TTS、语音输入、静音、嘴型同步和自动消失的半透明对话气泡。
- 支持前后摄像头预览、拖动小窗和由模型主动调用的拍照工具。
- ASR/TTS Provider 可配置；默认提供本地语音识别路径和 Edge TTS 模板。

### Android 应用体验

- 浅色粉白主题、胶囊控件、页面过渡动画以及竖屏/横屏布局。
- 针对常见全面屏比例和接近 9:21 的高分辨率设备进行布局适配。
- 手动创建一次、每日或每周 Agent 任务；应用运行或重新激活时执行到期任务。
- API Key、登录令牌及敏感设置使用 Android Keystore 支持的加密存储。
- Android CI 包含 TypeScript 检查、基础测试、原生日志隐私检查、Gradle 单测和 Debug APK 构建。

## 尚未完成

- LiteRT/MediaPipe 本地模型下载与 1B-4B 模型端侧推理。
- 基于 WorkManager 的可靠后台唤醒；当前定时任务依赖应用进程存活或再次打开应用。
- 正式签名、版本升级、Release APK 和完整的 Android 11/13/15-16 发布矩阵测试。
- 更完整的设备工具、长期记忆检索、Skill 市场和 MCP 移动端管理体验。

开发计划与验收条件见 [ROADMAP](docs/ROADMAP.md)，权限和执行边界见 [SECURITY_MODEL](docs/SECURITY_MODEL.md)。

## Agent 执行结构

```mermaid
flowchart LR
    USER["用户与角色人格"] --> MODEL["云端或本地模型"]
    MODEL --> LOOP["Agent Loop"]
    LOOP --> TOOLS["结构化 Tools / Skills / MCP"]
    TOOLS --> BROKER["审批、策略与审计"]
    BROKER --> ACCESS["Accessibility"]
    BROKER --> SHIZUKU["Shizuku"]
    BROKER --> ROOT["Root"]
```

模型输出不会直接执行 Shell、Shizuku、root 或无障碍动作。设备操作必须经过结构化工具、审批策略和原生执行层。

## 本地构建

### 要求

- Windows 10/11 PowerShell
- Android 11 或更高版本的设备/模拟器
- 所有 Node、JDK、Android SDK、Gradle 缓存和下载内容均保存在本工作区

### 初始化与验证

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-toolchain.ps1
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm install
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm check
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm test:android-foundation
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm run check:android-native-logs
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm run mobile:sync:android
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 gradle testDebugUnitTest
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 gradle assembleDebug
```

构建产物位于：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

更完整的环境说明见 [BUILDING.md](docs/BUILDING.md)。网络受限时可设置 `YACHIYO_PROXY_URL`，开发脚本默认兼容 `http://127.0.0.1:7890`。

## 引用与致谢

Yachiyo Claw 没有把所有参考项目的代码直接合并进来。下表区分了代码基础、已使用依赖与产品/架构参考；各项目继续遵循各自许可证。

### 代码基础与核心生态

| 项目                                                                                          | 本项目中的用途                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [chatboxai/chatbox](https://github.com/chatboxai/chatbox)                                     | 上游代码基础：会话、Provider、消息渲染、设置与工具框架 |
| [ionic-team/capacitor](https://github.com/ionic-team/capacitor)                               | Web/React 与 Android 原生能力桥接                      |
| [vercel/ai](https://github.com/vercel/ai)                                                     | 模型流式输出与结构化工具调用                           |
| [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MCP 客户端和工具协议支持                               |
| [guansss/pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)                 | PixiJS Live2D 渲染与模型控制                           |

### Agent、交互与产品设计参考

| 项目                                                                                  | 参考内容                                      |
| ------------------------------------------------------------------------------------- | --------------------------------------------- |
| [AAswordman/Operit](https://github.com/AAswordman/Operit)                             | Android Agent、权限后端、工具与移动端任务体验 |
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)             | Agent 审批模式、Skills、记忆与自我扩展工作流  |
| [Open-LLM-VTuber/open-llm-vtuber](https://github.com/Open-LLM-VTuber/open-llm-vtuber) | Live2D、流式语音、表情动作标记和实时交互流程  |
| [moeru-ai/airi](https://github.com/moeru-ai/airi)                                     | 角色卡、Live2D 角色体验和交互界面设计         |
| [google-ai-edge/gallery](https://github.com/google-ai-edge/gallery)                   | Android 端侧模型、LiteRT-LM 和模型管理方向    |
| [yashab-cyber/opendroid](https://github.com/yashab-cyber/opendroid)                   | Android 动作目录、Agent Loop 与设备自动化调研 |

### Android 高权限能力参考

| 项目                                                                            | 参考内容                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------ |
| [RikkaApps/Shizuku](https://github.com/RikkaApps/Shizuku)                       | Shizuku 用户端授权与运行环境                     |
| [RikkaApps/Shizuku-API](https://github.com/RikkaApps/Shizuku-API)               | Shizuku API 接入方式                             |
| [topjohnwu/libsu](https://github.com/topjohnwu/libsu)                           | Root Shell、RootService 与多 Root 管理器兼容思路 |
| [MuntashirAkon/libadb-android](https://github.com/MuntashirAkon/libadb-android) | Android 设备内 ADB 能力调研                      |

应用内 MCP 推荐目录中的第三方 Server 来自 Chatbox 上游注册表，它们不会随 Yachiyo Claw 自动安装；实际启用时请分别阅读对应仓库的许可证、权限和隐私说明。

## 名称与素材说明

名称和视觉灵感来自《超时空辉夜姬》中的月见八千代。仓库中的角色头像和 Live2D 模型仅用于本开源项目的角色交互演示，相关角色、图像和模型素材的权利归其各自作者与权利方所有。Live2D 运行库及模型说明见 [NOTICE](src/renderer/public/live2d/NOTICE.md)。

Yachiyo Claw 是独立的开源项目，与影片制作方、发行方、Netflix、Live2D Inc. 或其他权利方不存在隶属或官方合作关系。

## License

本仓库基于 Chatbox Community Edition 继续开发，并以 [GPL-3.0](LICENSE) 发布。第三方源码、库、角色素材、Live2D 模型和模型权重保留各自许可证与使用条款。

Copyright (c) NewDreamStudio and contributors.
