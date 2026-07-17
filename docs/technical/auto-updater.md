# 自动更新系统

> Last updated: 2026-04

桌面端使用 **electron-updater** 实现自动更新。本文档描述更新机制、状态管理和测试方法。

---

## 架构概览

```
Main Process                           Renderer Process
┌──────────────────────┐               ┌──────────────────────┐
│  AppUpdater          │               │  updateStore         │
│  (app-updater.ts)    │   IPC events  │  (Zustand)           │
│                      │──────────────>│                      │
│  - electron-updater  │  updater:*    │  状态机:             │
│  - 5 URL fallback    │               │  idle → checking →   │
│  - 1h 定时检查       │               │    ├→ up-to-date     │
│  - isChecking 互斥   │               │    ├→ available →    │
│                      │               │    │  downloading →   │
│                      │<──────────────│    │  downloaded      │
│  updater:check       │   IPC invoke  │    └→ error          │
│  install-update      │               │                      │
└──────────────────────┘               └──────────┬───────────┘
                                                  │
                                       ┌──────────┴───────────┐
                                       │                      │
                                  Sidebar.tsx           about.tsx
                                  (banner:              (完整 UI:
                                   downloaded           检查/进度/
                                   时显示)               错误/安装)
```

## Main 进程 (`src/main/app-updater.ts`)

### AppUpdater 类

构造时接收 `getWindow: () => BrowserWindow | null`，用于向 renderer 发送事件。

**核心行为：**

1. **启动检查**：如果用户开启了 `autoUpdate` 设置，延迟 5 秒后执行第一次检查，之后每小时检查一次
2. **手动检查**：renderer 通过 `updater:check` IPC 触发
3. **自动下载**：`autoDownload = true`，发现更新后自动下载
4. **退出时安装**：`autoInstallOnAppQuit = true`

### Feed URL Fallback

为应对 CDN 或 DNS 故障，`tryUpdate()` 会依次尝试 5 个 feed URL：

```
chatboxai.app → api.chatboxai.app → api.ai-chatbox.com
→ api.chatboxapp.xyz → api.chatboxai.com
```

- 每次尝试通过 `autoUpdater.setFeedURL()` 切换源
- 中间失败的 error 事件被 `suppressError` 标志屏蔽，避免 UI 闪烁
- 仅当全部失败时抛出异常，由调用方统一处理错误

### IPC 通道

| 通道 | 方向 | 用途 |
|------|------|------|
| `updater:checking` | main → renderer | 开始检查 |
| `updater:available` | main → renderer | 发现新版本（含 version） |
| `updater:not-available` | main → renderer | 已是最新 |
| `updater:progress` | main → renderer | 下载进度（percent, bytesPerSecond, transferred, total） |
| `updater:downloaded` | main → renderer | 下载完成（含 version） |
| `updater:error` | main → renderer | 更新失败（含 message） |
| `updater:check` | renderer → main | 手动触发检查（invoke） |
| `install-update` | renderer → main | 退出并安装（invoke） |

### 互斥与防御

- `isChecking` 标志防止并发检查
- `ipcMain.removeHandler()` 在注册前调用，防止双重注册
- `sendToRenderer()` 检查窗口是否已销毁

## Renderer 状态管理 (`src/renderer/stores/updateStore.ts`)

### 状态机

```
                    ┌────────────────┐
                    │     idle       │◄─────────────┐
                    └───────┬────────┘              │
                            │ check                 │ 3s timeout
                    ┌───────▼────────┐              │
                    │   checking     │──────► up-to-date
                    └───────┬────────┘
                            │
                 ┌──────────┼──────────┐
                 │          │          │
         ┌───────▼──┐  ┌───▼────┐  ┌──▼─────┐
         │ available │  │ error  │  │  idle   │
         └───────┬───┘  └────────┘  └────────┘
                 │                  (dev mode,
         ┌───────▼───────┐         null result)
         │  downloading  │
         └───────┬───────┘
                 │
         ┌───────▼───────┐
         │  downloaded   │
         └───────────────┘
```

### Store 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `UpdateStatus` | 当前状态 |
| `progress` | `number` | 下载进度 0-100 |
| `version` | `string \| null` | 新版本号 |
| `error` | `string \| null` | 错误信息 |
| `dismissedVersion` | `string \| null` | 用户忽略的版本号 |

### 关键逻辑

- **幂等初始化**：`initUpdateListeners()` 用 `initialized` 标志保证只执行一次
- **进度去重**：相同百分比不触发 re-render
- **up-to-date 自动消失**：3 秒后自动回到 idle
- **dismiss 机制**：记录用户忽略的版本，同版本不再显示 banner

## UI 层

### About 页面 (`src/renderer/routes/about.tsx`)

`DesktopUpdateSection` 组件根据 `status` 渲染不同 UI：

| 状态 | 显示内容 |
|------|---------|
| `idle` | "检查更新" 按钮 |
| `checking` | 加载中按钮 |
| `available` | "新版本可用 vX.Y.Z" |
| `downloading` | 进度条 + 百分比 |
| `downloaded` | "重启并更新" 按钮 |
| `error` | 错误信息 + 重试按钮 + 官网下载链接 |
| `up-to-date` | "已是最新版本"（3 秒后消失） |

**安全超时**：手动检查 30 秒后如果仍在 `checking` 状态，自动重置为 `idle`。

Mobile 和 Web 平台不使用 electron-updater，显示外部链接跳转到应用商店或官网。

### Sidebar (`src/renderer/Sidebar.tsx`)

- `SidebarUpdateBanner`：仅在 `downloaded` 状态显示，点击触发安装
- `useShowUpdateDot`：About 链接上的红点指示器
  - Desktop：`downloaded` 时显示
  - Mobile：基于远程 API 的 `needCheckUpdate`

## 平台适配

更新相关 API 通过平台抽象层暴露（`src/renderer/platform/interfaces.ts`）：

| 方法 | Desktop | Mobile/Web |
|------|---------|------------|
| `onUpdaterChecking` | ✅ IPC 监听 | ❌ 不存在 |
| `onUpdaterAvailable` | ✅ IPC 监听 | ❌ |
| `onUpdaterNotAvailable` | ✅ IPC 监听 | ❌ |
| `onUpdaterProgress` | ✅ IPC 监听 | ❌ |
| `onUpdaterDownloaded` | ✅ IPC 监听 | ❌ |
| `onUpdaterError` | ✅ IPC 监听 | ❌ |
| `checkForUpdate` | ✅ IPC invoke | ❌ |
| `installUpdate` | ✅ IPC invoke | ❌ |

`initUpdateListeners()` 通过 `if (platform.onUpdaterXxx)` 检查方法是否存在，非 Desktop 平台自动跳过。

## 配置

用户设置中有两个相关选项（存储在 settings store）：

| 设置 | 说明 |
|------|------|
| `autoUpdate` | 是否启用自动检查（控制定时器是否启动） |
| `betaUpdate` | 是否接收 beta 通道更新 |

注意：`autoUpdate` 设置在 AppUpdater 构造时读取一次，运行期间切换不会立即生效，需重启应用。

## 测试

### 单元测试

```bash
pnpm test -- --run src/renderer/stores/updateStore.test.ts
```

覆盖：状态机转换、dismiss 逻辑、up-to-date 超时重置、进度去重。

### 手动测试（本地打包）

1. **打包测试版本**

   ```bash
   pnpm build
   UPDATE_CHANNEL=latest pnpm exec electron-builder build --publish never
   ```

   产物在 `release/build/`，包含 arm64 和 x64 两个 DMG。

2. **测试场景清单**

   | 场景 | 操作 | 预期结果 |
   |------|------|---------|
   | 自动检查 | 启动应用，等待 5 秒 | 如有更新，Sidebar 底部出现 banner |
   | 手动检查 | About 页面点击"检查更新" | 显示 checking → 结果 |
   | 已是最新 | 当前版本 = 最新版本时检查 | 显示"已是最新版本"，3 秒后消失 |
   | 下载进度 | 有更新可用时 | About 页面显示进度条 |
   | 安装更新 | 下载完成后 | Sidebar banner + About 页"重启并更新"按钮 |
   | 更新失败 | 断网后检查更新 | About 页面显示错误 + 重试 + 官网下载链接 |
   | Sidebar banner | 下载完成 | 底部品牌色 banner，点击触发安装 |
   | About 红点 | 下载完成 | Sidebar 的 About 链接显示红点 |
   | Mobile | 移动端打开 About | 显示外部链接按钮，不崩溃 |

3. **模拟更新失败**

   断网测试：关闭 Wi-Fi 后点击"检查更新"，验证错误提示和重试功能。

4. **验证 Feed URL Fallback**

   查看日志文件确认 fallback 行为：

   ```bash
   # macOS
   tail -f ~/Library/Logs/xyz.chatboxapp.app/main.log | grep auto_updater
   ```

   正常情况下第一个 URL 成功即返回；如果失败会看到 `attempt failed: <url>` 日志。

### 本地更新服务器测试

通过搭建本地 HTTP 服务器模拟更新流程，可以测试完整的「发现更新 → 下载 → 安装」链路。

#### 原理

electron-updater 的 `setFeedURL(url)` 指向一个 HTTP 服务器，检查更新时会请求 `{url}/{channel}-mac.yml`（macOS）或 `{url}/{channel}.yml`（Windows）。这个 YAML 文件描述了最新版本号和安装包下载地址。我们可以：

1. 打包一个**低版本**应用作为"当前版本"
2. 打包一个**高版本**应用作为"更新包"
3. 用本地 HTTP 服务器 serve 更新包和 YAML 元数据
4. 修改代码让 feed URL 指向本地服务器

#### 步骤

**Step 1: 打包"旧版本"（当前安装的版本）**

将 `release/app/package.json` 的版本号设为较低值（如 `1.0.0`）：

```bash
# 修改版本号
cd release/app
# 编辑 package.json 中的 version 为 "1.0.0"

# 打包
cd ../..
pnpm build
UPDATE_CHANNEL=latest pnpm exec electron-builder build --publish never
```

安装这个 DMG 作为测试用的"旧版本"。

**Step 2: 打包"新版本"（更新包）**

将 `release/app/package.json` 的版本号改为更高值（如 `1.1.0`）：

```bash
# 修改版本号为 "1.1.0"
pnpm build
UPDATE_CHANNEL=latest pnpm exec electron-builder build --publish never
```

打包完成后 `release/build/` 中会生成：
- `Chatbox-1.1.0-arm64-mac.zip` + `.blockmap`
- `Chatbox-1.1.0-arm64.dmg` + `.blockmap`
- `latest-mac.yml`（自动生成的元数据文件）

**Step 3: 启动本地更新服务器**

```bash
# 在 release/build/ 目录下启动 HTTP 服务
cd release/build
npx serve -l 8080
```

此时 `http://localhost:8080/latest-mac.yml` 应该可以访问。验证：

```bash
curl http://localhost:8080/latest-mac.yml
```

应返回类似：

```yaml
version: 1.1.0
files:
  - url: Chatbox-1.1.0-arm64-mac.zip
    sha512: ...
    size: ...
path: Chatbox-1.1.0-arm64-mac.zip
sha512: ...
releaseDate: '2026-04-04T...'
```

**Step 4: 修改 feed URL 指向本地**

临时修改 `src/main/app-updater.ts` 中的 feedUrls：

```typescript
const feedUrls = [
  'http://localhost:8080',
]
```

然后重新打包"旧版本"（Step 1 的版本号），安装并启动。

**Step 5: 触发更新**

打开 About 页面，点击"检查更新"。应该看到：
1. `checking` → `available`（发现 1.1.0）
2. 自动开始下载（进度条）
3. 下载完成 → Sidebar banner + "重启并更新"按钮
4. 点击安装 → 应用重启并升级到 1.1.0

#### 简化方案（仅测试 UI 状态）

如果只想测试 UI 各状态的显示效果而不需要真实下载，可以在开发模式下直接操作 store：

```bash
# 启动开发服务
pnpm dev
```

打开 DevTools Console，手动设置状态：

```javascript
// 模拟各种状态
window.__updateStore?.setState({ status: 'checking' })
window.__updateStore?.setState({ status: 'available', version: '2.0.0' })
window.__updateStore?.setState({ status: 'downloading', progress: 45 })
window.__updateStore?.setState({ status: 'downloaded', version: '2.0.0', progress: 100 })
window.__updateStore?.setState({ status: 'error', error: 'Network timeout' })
window.__updateStore?.setState({ status: 'up-to-date' })
```

注意：需要先在 `updateStore.ts` 中临时暴露 store 到 window（仅用于调试）：

```typescript
if (process.env.NODE_ENV === 'development') {
  ;(window as any).__updateStore = useUpdateStore
}
```

### 开发模式注意事项

- 开发模式下 `autoUpdater.checkForUpdates()` 返回 `null` 且不触发任何事件
- `AppUpdater` 会检测这种情况并手动发送 `updater:not-available`
- 要测试完整更新流程，必须使用打包后的版本

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/main/app-updater.ts` | Main 进程更新逻辑 |
| `src/renderer/stores/updateStore.ts` | Renderer 状态管理 |
| `src/renderer/stores/updateStore.test.ts` | 单元测试 |
| `src/renderer/routes/about.tsx` | About 页面更新 UI |
| `src/renderer/Sidebar.tsx` | Sidebar 更新 banner |
| `src/preload/index.ts` | IPC 桥接（createListener） |
| `src/renderer/platform/desktop_platform.ts` | 平台适配层 |
| `src/renderer/platform/interfaces.ts` | 平台接口定义 |
| `src/shared/electron-types.ts` | Electron IPC 类型 |
