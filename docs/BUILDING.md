# 构建 Yachiyo Claw

当前主开发目标是 Android 11+。所有可下载工具链与缓存都必须位于仓库工作区，不依赖全局 Node、Java、Gradle 或 Android SDK。

## 准备本地工具链

在仓库根目录运行纯 PowerShell bootstrap。它读取 `toolchain.lock.json`，下载并校验锁定的 Node、JDK 和 Android command-line tools，再安装锁定的 Android SDK 包：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-toolchain.ps1
```

首次安装 Android SDK 时，必须显式进入交互式许可证流程。脚本不会自动输入 `y`，请阅读 `sdkmanager` 展示的条款后自行确认：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-toolchain.ps1 -AcceptAndroidLicenses
```

只校验现有环境且不下载、不修改文件：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-toolchain.ps1 -VerifyOnly
```

默认代理为 `http://127.0.0.1:7890`，可通过 `YACHIYO_PROXY_URL` 覆盖。固定工具归档和 Android SDK 安装暂存都位于 `.tools/downloads/`；所有解压目录都位于 `.tools/` 内。脚本会拒绝越出这些目录的锁文件路径或 ZIP 条目，并在安装完成后清理隔离暂存目录。

## 工作区目录

| 目录 | 内容 | 是否提交 |
| --- | --- | --- |
| `.tools/` | Node、Corepack、JDK、Android SDK | 否 |
| `.cache/` | pnpm、npm、Gradle、Android user home、临时文件 | 否 |
| `.research/` | 上游源码与官方文档快照 | 否 |
| `.models/` | 开发用模型权重 | 否 |
| `android/` | Capacitor 原生 Android 工程 | 是，生成的 assets/build 除外 |

精确版本和下载校验值记录在 `toolchain.lock.json`。环境入口是 `scripts/yachiyo-env.ps1`；它只修改子进程环境，不改系统级环境变量。

## 代理

默认代理为 `http://127.0.0.1:7890`。可以只对当前命令覆盖：

```powershell
$env:YACHIYO_PROXY_URL = 'http://127.0.0.1:7890'
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 doctor
```

脚本同时为 Node 下载和 Gradle/Maven 写入工作区代理配置。`NO_PROXY` 保留 localhost 与 loopback。Gradle 仅支持这里的 HTTP/HTTPS 代理；SOCKS 代理只能用于 bootstrap 下载，不能传给 `yachiyo-env.ps1 gradle`。

## 安装依赖

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 doctor
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm install --frozen-lockfile --ignore-scripts
```

当前 Windows 桌面依赖 `zipfile@0.5.12` 没有 Node 22 预编译包，其源码构建还要求 Windows SDK。Android 构建不使用该桌面原生模块，因此 Android-only 环境采用 `--ignore-scripts`，不需要安装多 GB 的 Windows SDK。

## Android 构建

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm check
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm test:android-foundation
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm run mobile:sync:android
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 gradle testDebugUnitTest --no-daemon --max-workers=1 --no-watch-fs
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 gradle assembleDebug --no-daemon --max-workers=1 --no-watch-fs
```

CI 还会用 `aapt` 对合并权限做 allowlist、扫描移动 bundle 中的遥测域名和调试产物，并用 `apksigner verify` 校验 APK。新增权限、遥测端点或签名策略必须显式更新安全评审，不能只修改 allowlist 让构建变绿。

Debug APK 输出到：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

安装到已授权设备：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 adb devices
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

当前最小设备 smoke 是冷启动包名并确认进程存在；涉及 UI、Keystore、深链、后台或权限的变更还要执行对应 instrumentation/UI 用例并保存设备与 Android 版本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 adb shell am force-stop io.github.yachiyoclaw
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 adb shell monkey -p io.github.yachiyoclaw -c android.intent.category.LAUNCHER 1
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 adb shell pidof io.github.yachiyoclaw
```

没有已连接设备时，只能报告“主机构建与单元测试通过”，不能声称安装、启动、Keystore 或视觉验收完成。

`mobile:sync:android` 必须在 Gradle 构建前执行。它会构建 Android 专用 renderer、递归删除 sourcemap，再同步 Web assets 与 Capacitor 插件。不要调用 `mobile:sync`，因为该聚合命令还要求本项目当前不维护的 iOS 工程。

Android 启动图由原创品牌 SVG 确定性生成。Android-only 依赖安装使用 `--ignore-scripts` 时，首次生成前只需重建白名单中的 `sharp`；随后修改 `assets/brand/yachiyo-claw-mark.svg` 后直接运行生成命令：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm rebuild sharp
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm run mobile:assets:yachiyo
```

## 当前上游基线

首次安装使用 `--ignore-scripts` 时，未修改 Chatbox 上游的结果如下：

| 命令 | 基线结果 | 原因 |
| --- | --- | --- |
| `pnpm check` | 首次失败，生成 route tree 后通过 | `routeTree.gen.ts` 在首次 Vite 构建时生成且被 Git 忽略 |
| `pnpm test` | 1127 通过、1 个断言失败、54 跳过；另 4 个 suite 在收集阶段失败 | 一个上游测试硬编码 POSIX 路径；Android-only 安装跳过 Electron 下载，4 个 desktop suite 无法导入 |
| `pnpm build:web` | bundle 成功，清理阶段失败 | 上游缺少 sourcemap runner；Yachiyo 已补齐 |

Android 主机门禁是 `pnpm check`、`test:android-foundation`、`mobile:sync:android`、`testDebugUnitTest`、`assembleDebug` 和 APK 审计。共享 Provider/会话层里程碑及公开发布还必须运行 `pnpm test` 和 `pnpm build:web`；已知上游失败需要记录精确用例、基线提交和跟踪项，不能被当成通过。桌面 Electron 测试失败也不能混入 Android 回归统计。

## Windows Gradle 文件占用

部分 Windows 安全软件会短暂占用 Gradle 8.6+ 的 transform 临时目录，表现为 `Could not move temporary workspace ... to immutable location`。这是 Gradle 的已知 Windows 文件占用问题，不是 Android 源码错误。

优先做法是为工作区专用的 `.tools/jdk-21/bin/java.exe` 和 `.cache/gradle` 配置安全软件的最小范围例外，或在 Linux CI 构建；不要关闭整机防护。问题跟踪见 [Gradle #31438](https://github.com/gradle/gradle/issues/31438)。
