# Yachiyo Claw 插件平台安全评审

审计日期：2026-07-27
审计范围：插件清单、安装/更新、Worker 运行时、Host API、授权、设备与 Linux 沙箱桥接、管理 UI。

## 结论

当前实现可以进入 Android 发布候选验收。此前同源 Blob Worker 可访问应用 IndexedDB 的发布阻断
已复现并修复：插件 Worker 现在由不带 `allow-same-origin` 的 sandbox iframe 创建，获得 opaque
origin，并继承 `connect-src 'none'` 等严格 CSP。不存在降级到同源 Worker 的回退路径。

正式发布前仍必须在 Android 11、13、15/16 WebView 上运行应用内“插件运行时测试”，确认结果为
`origin=null`、IndexedDB/OPFS/Cache 不可用、直接网络请求失败且 Capacitor 不存在。设备控制还需用
已验签测试插件完成一次“授权、审批、执行、撤销、中断”流程。

## 攻击结果

| 攻击面 | 结果 | 证据或机制 |
|---|---|---|
| `fetch` / XHR / WebSocket 直连 | 已拦截 | 生产 bootstrap 恶意探针均返回 `TypeError`；frame CSP 为 `connect-src 'none'` |
| IndexedDB / Cache Storage | 已拦截 | 构造器及其原型描述符已清除；真实探针为不可用；Worker origin 为 `null` |
| 外部 `importScripts` | 已拦截 | 恶意探针返回 `NetworkError`；script CSP 不允许远端与 `data:` |
| `new Function('return this')()` | 已拦截提权 | 能取回 Worker global，但其 origin 仍为 `null`，无法恢复宿主 origin 权限 |
| 嵌套 Worker | 已拦截 | 生产探针创建失败；bootstrap 移除入口，继承 CSP 继续约束子资源 |
| Capacitor 原生桥 | 已拦截 | Worker 中为 `undefined`；插件代码不在 frame 或主 realm 执行 |
| localStorage、会话审批配置、审计 key | 已拦截 | Worker 无 localStorage，且 opaque origin 无宿主存储 |
| 白名单外 Host API / 伪造 invocation id | 已拦截 | 显式方法表、principal + entry digest 绑定、invocation id 回归测试 |
| 函数、循环结构、超大 RPC | 已拦截 | structured clone + 纯 JSON schema，1 MiB RPC 上限 |
| 白名单外域名或跨域重定向 | 已拦截 | 每一跳手动处理并重新校验 exact host；不使用自动重定向 |
| 私网 IP、loopback、link-local、CGNAT、IPv6 ULA | 已拦截 | Android `PluginNetworkPolicy` 单元测试与原生策略 |
| URL、请求头、请求体、响应体滥用 | 已拦截 | URL 8 KiB、头 32 KiB、请求体 256 KiB、响应 512 KiB |
| 插件修改或继承其他主体授权 | 已拦截 | 授权不暴露给 Worker；摘要绑定；插件不能继承 core 的“此对话允许” |
| 未签名插件取得设备控制 | 已拦截 | 安装阶段始终 denied；只有市场验签记录可在详情页单独授权 |
| 市场索引替换签名公钥 | 已拦截 | 官方签名者公钥随已签名 App 固化；远端索引自带的新公钥不会成为信任根 |
| 设备参数在审批后被替换 | 已拦截 | 参数摘要 + 一次性原生 nonce，原生执行时消费 |
| 撤销后继续执行 | 已拦截 | runtime dispose 触发 AbortController；网络、沙箱任务均有原生取消路径 |
| 插件伪造审批 UI | 已拦截 | 插件只返回受限声明式 view，无 HTML、CSS、DOM、overlay 或 modal 能力 |
| HTML/脚本字符串注入 | 已拦截 | React 文本渲染；view schema 无 raw HTML/style/className |
| 死循环、并发与消息洪泛 | 已拦截 | 单插件并发 1、调用/加载超时终止、消息队列 256、空闲回收 |
| 巨量工具/返回值/磁盘写入 | 已拦截 | 工具 8/插件、32 全局、结果裁剪、代码/数据/总量配额 |
| 压缩包穿越、符号链接、摘要不符 | 已拦截 | 双向文件清单、逐文件 SHA-256、入口摘要、路径/数量/解压大小上限 |
| 更新失败或恶意降级 | 已拦截 | 不可变版本目录、原子 registry 指针、禁止降级、失败回退、保留 3 个历史版本 |

浏览器级探针使用当前生产 `buildOpaquePluginFrameDocument()` 与真实 Worker bootstrap，而不是 mock。
最近一次结果：

```json
{
  "origin": "null",
  "escapedOrigin": "null",
  "indexedDBOpen": "Error",
  "fetchAttempt": "TypeError",
  "cacheOpen": "TypeError",
  "importAttempt": "NetworkError",
  "nestedWorker": "TypeError",
  "xhrAttempt": "TypeError",
  "webSocketAttempt": "TypeError",
  "localStorage": "undefined",
  "capacitor": "undefined"
}
```

## 残余风险

1. `sandbox` 不是安全 VM。PRoot 不提供内核级隔离，插件虽然只有私有 `/workspace`，仍共享 Linux
   rootfs，并可通过 curl、Node 或 Python 自行联网。因此沙箱授权可绕开 `network` 域名白名单，UI
   必须始终把它作为高风险能力说明。
2. 原生网络代理不再使用会二次解析 DNS 的 `HttpURLConnection`。每一跳只解析一次，拒绝解析集
   中任意私网地址后，socket 直接连接到该已验证 IP；TLS 仍按原域名执行 SNI 与 HTTPS 证书校验。
   残余风险收敛为系统 DNS 解析器或 TLS/WebView 本身被攻破，而不再存在检查和连接间的 DNS
   rebinding TOCTOU。
3. WebView 引擎漏洞超出应用隔离层能力。插件代码是不可信 JavaScript；浏览器沙箱逃逸只能通过
   及时更新系统 WebView、限制市场签名发布者和快速撤销插件来缓解。
4. 显示名允许重复且 Unicode 同形字无法可靠判断。管理页始终同时显示不可伪造的 manifest id、
   版本、来源与签名状态；市场审核仍需人工检查冒名插件。
5. 审计对插件不可达，但仍属于应用本地数据，不是远程不可篡改日志。取得应用调试权限、root 或
   WebView 引擎执行权的攻击者可以修改它。
6. 官方市场签名密钥轮换需要先发布包含新公钥的 App 版本；构建脚本不会临时生成或自动信任新密钥。

## 可重复验证

插件平台发布前必须运行真实 Chromium 隔离探针：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm test:plugin-isolation
```

结果必须同时满足：Worker origin 与逃逸后 origin 均为 `null`、IndexedDB/OPFS/Cache 均不可打开、字体通道出网失败、
探针泄漏端点收到的请求数为 `0`。单元测试不能替代这些 Chromium/WebView 运行时属性验证。

## 设备验收项

- Android 11、13、15/16：运行恶意隔离探针。
- 验签插件：设备授权默认关闭，安装时不能勾选，详情页有独立红色警告。
- 手动审批、智能审批、完全控制：插件 principal 不继承 core 会话授权。
- 执行中的网络、设备与沙箱调用：停止 Agent 或撤销插件能力后立即中断。
- Android 11/12：ECDSA P-256 市场包验签成功；错误签名和篡改包失败。
- 3200 x 1440 与 2608 x 1200 竖屏：安装弹窗、权限详情、活动日志无横向溢出。
