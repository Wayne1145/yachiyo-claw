# Feature/Plugin 迁移验证报告

报告日期：2026-07-27
目标版本：Yachiyo Claw `0.0.11`

## 范围与结论

本次迁移把原先散落在页面、会话工具构建器和启动代码中的内置能力收敛为 **Tier A Feature 模块**，并
在其上增加受限的 **Tier B 第三方插件**。内置高权限能力仍是应用签名代码；第三方插件不能替换、覆盖或
伪装成内置模块。

代码级迁移已经完成，当前会话工具构建已切换到注册表路径，设置、UI 贡献、提示词、生命周期、原生桥
健康检查和依赖解析均有回归测试。第三方插件安装、更新、回滚、权限、运行时、Host API、下载恢复和
声明式 UI 已形成闭环。发布前仍需完成 Android 11、13、15/16 的真实 WebView 隔离探针与已验签插件
设备控制矩阵；该设备验收不能由 Vitest 或 JVM 单元测试替代。

## 已迁移的内置能力

注册表当前包含 19 个内置 Feature：核心 Agent、MCP、知识库、会话附件 RAG、会话文件、Web 搜索、
Linux 沙箱、工作区、手机控制、长期记忆、摄像头、Skills、第三方插件、Live2D 交互、定时任务、本地
模型、语音、角色卡和更新器。

每个 manifest 声明：

- 全局唯一 id、名称、描述、支持平台和默认状态；
- `privileged`、`sandboxed` 或 `inert` 信任等级；
- 模块依赖、工具所有权、Android 权限和所需原生插件；
- UI、提示词、工具集和生命周期贡献在 renderer 注册表中的归属。

注册表会检测重复 id、缺失依赖和依赖环，按平台及用户 override 解析启用集合。Android 启动时只检查
已启用模块声明的原生桥；缺失桥会令对应功能不可用，而不会让后续调用落到未受控实现。

## 行为等价与切换证据

- `buildToolsForSession()` 已委托给 Feature 工具注册表，代表性 Web 搜索、手机控制、Linux 沙箱和普通
  会话组合会生成确定的工具及隐藏指令。
- 工具所有权测试确认：关闭 `workspace`/`skills` 会移除项目交付和 Skill 编写工具，但不会误删独立的
  `sandbox_bash`。
- UI 注册表按平台、用户 override 和排序过滤贡献，并对 Android 底部导航执行五项上限。
- Feature 设置通过中心 `SettingsSchema` 保存；各模块本地缓存使用版本化命名空间，非法内容回退默认值。
- 生命周期启动失败按模块隔离，清理按逆序执行且幂等；一个清理失败不会跳过其他模块清理。
- 提示词块与工具集按已启用 Feature 解析，第三方插件工具仍需经过会话开关和逐能力授权。

关键回归测试：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm exec vitest run `
  src/shared/features/registry.test.ts `
  src/renderer/features/builtin-toolsets.equivalence.test.ts `
  src/renderer/features/builtin-toolsets.ownership.test.ts `
  src/renderer/features/feature-settings.test.ts `
  src/renderer/features/ui-registry.test.ts `
  src/renderer/features/lifecycle-runner.test.ts `
  src/renderer/features/native-health.test.ts
```

## 第三方插件闭环

已实现并具有自动化覆盖的路径包括：

- 严格 manifest、文件双向清单、路径/配额/摘要校验和安全解压；
- 本地 ZIP、公开 HTTPS、GitHub Release 和内置签名市场来源；
- 与模型、更新、Linux、Skills、主题共用的持久下载器和安装意图恢复；
- 不可变版本目录、原子 active pointer、失败回退、最多三个历史版本和显式回滚；
- 插件级启停、能力授权/撤销、健康熔断、活动审计和完整卸载；
- opaque-origin Worker、无直接网络的 CSP、纯数据 RPC、调用 principal + entry digest 绑定；
- 加密插件数据/授权、旧明文与旧 Keystore envelope 的首次读取迁移；
- 声明式页面、Agent 工具、设置入口和导航标签的启用/授权/版本/健康门控；
- `network`、`sandbox` 和已验签 `device` Host API 的策略、审批、取消和配额。

建议发布候选至少运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm exec vitest run `
  src/shared/plugins `
  src/renderer/plugins `
  src/renderer/components/yachiyo/PluginCenter.test.tsx
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm test:plugin-isolation
```

`test:plugin-isolation` 必须使用真实 Chromium 属性验证 `origin=null`，且 IndexedDB、OPFS、Cache、直接
网络、嵌套 Worker 和 Capacitor 逃逸均不可用。详细攻击面结果见 [security-review.md](security-review.md)。

## 兼容性与数据迁移

- Feature 状态新增在现有 Settings 中，未设置的用户按 manifest 默认值运行；无效 override 不扩大权限。
- 插件注册表每次读取都重新验证 manifest id 与生成路径，非法行会被移除，不能影响文件系统路径。
- 旧版明文插件 KV 和旧上下文格式的加密 envelope 只在成功解析后原位改写为新的 Keystore 绑定格式。
- 插件更新不会移动现用代码目录；只有新版本完整落盘、验证并登记后才修改 active pointer。
- 新增能力、入口摘要变化、更新和回滚不会继承旧 `device` 权限。

本版本没有把旧内置高权限模块“转换”为第三方插件，也没有把现有聊天、Provider 或 Agent 数据移动到
插件命名空间，因此不存在第三方代码读取历史会话或密钥的兼容通道。

## 发布前设备验收

以下项目在完成前必须保持为发布门禁，而不是写成已通过：

1. Android 11、13、15/16 上运行插件运行时隔离测试，记录 WebView 版本和探针 JSON。
2. 已验签测试插件完成设备权限默认关闭、独立授权、三种审批模式、参数绑定执行、撤销和任务中断。
3. 本地 ZIP 连续勾选多项安装权限，完成安装、页面/设置/工具贡献、启停、更新、回滚和卸载闭环。
4. `1200x2608`、`1440x3200` 竖屏及横屏检查安装弹窗、权限详情、活动记录和插件页面无横向溢出。
5. 在市场索引推送到 `main` 后，从默认远程 URL 下载并验签示例包；离线或 404 时必须显示可恢复错误。

设备结果应附构建 SHA、APK 版本/包名、设备/API/WebView、测试插件摘要和截图路径，不得把调试代理或
测试签名私钥提交到仓库。
