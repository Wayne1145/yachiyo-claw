# 主题使用与清单格式

Yachiyo Claw 的第三方主题是声明式 JSON 数据，只能覆盖公开的颜色 token。主题不能包含 JavaScript、
HTML、CSS 文件、字体、图片、网络请求或原生能力。

## 安装和切换

在 **设置 > 主题外观** 中可以：

- 粘贴 JSON 清单；
- 从系统文件选择器导入 `.json`；
- 从公开 HTTPS 地址下载主题；
- 安装前临时预览；
- 在主题库中切换、预览或删除主题。

预览只在主题页停留期间有效，离开页面会恢复已启用主题。从 URL 导入时，Android 使用统一下载器；
应用被系统回收后，完成的下载会恢复到主题预览流程。安装主题后会持久保存，删除正在使用的主题会恢复
内置的 Yachiyo 浅粉主题。

## v1 清单

清单最大为 64 KiB，必须是严格 JSON 对象：

```json
{
  "schemaVersion": 1,
  "id": "sakura-light",
  "name": "Sakura Light",
  "version": "1.0.0",
  "author": {
    "name": "Example Author",
    "url": "https://example.com"
  },
  "mode": "light",
  "tokens": {
    "tint-brand": "#d87597",
    "background-primary": "#fffafb",
    "border-primary": "#eadde2"
  }
}
```

`id` 使用小写 kebab-case，`mode` 为 `light`、`dark` 或 `both`。`tokens` 对所有配色模式生效，也可以
使用 `light.tokens` 和 `dark.tokens` 添加模式专属覆盖：

```json
{
  "schemaVersion": 1,
  "id": "sakura-dual",
  "name": "Sakura Dual",
  "version": "1.0.0",
  "mode": "both",
  "light": { "tokens": { "tint-brand": "#d87597", "background-primary": "#ffffff" } },
  "dark": { "tokens": { "tint-brand": "#f1a9c1", "background-primary": "#171316" } }
}
```

颜色值只接受十六进制、`rgb`/`rgba` 和 `hsl`/`hsla`。`url()`、`@import`、表达式、任意 CSS 属性和未知
token 会被拒绝。完整的公开 token 列表以
[`src/shared/themes/theme.ts`](../src/shared/themes/theme.ts) 中的 `THEME_TOKEN_KEYS` 为准。

## 远程主题安全

远程地址必须是无账号信息的公开 HTTPS URL。下载器限制重定向、文件大小和私网地址，下载完成后仍会
按同一严格 schema 解析。主题没有签名或作者身份验证机制；URL 导入只保护传输过程，用户应自行核对
来源。主题仅改变颜色，不会获得插件、Agent、文件或网络权限。
