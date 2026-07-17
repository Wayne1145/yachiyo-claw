# Dependency split for Electron Vite

依据 electron-vite 的建议，本次调整将所有仅用于 renderer（前端打包）的依赖移动到 `devDependencies`，仅保留主进程（`src/main`）和 preload（`src/preload`）在运行时需要的依赖在 `dependencies` 中。

## Runtime dependencies（保留在 `dependencies`）

- @libsql/client
- @mastra/libsql
- @mastra/rag
- @modelcontextprotocol/sdk
- @mozilla/readability
- @sentry/node
- ai
- auto-launch
- chardet
- cohere-ai
- electron
- electron-debug
- electron-devtools-installer
- electron-log
- electron-store
- electron-updater
- epub
- fs-extra
- iconv-lite
- linkedom
- lodash
- ofetch
- officeparser
- sanitize-filename
- uuid

## 主要变动

- 新增 `@libsql/client` 到 `dependencies`（主进程知识库类型定义及运行时需求）。
- 将 `electron`、`electron-debug`、`electron-devtools-installer` 从 `devDependencies` 挪到 `dependencies`（主进程运行时直接使用）。
- 其余原本在 `dependencies` 中、仅被 renderer 使用的依赖全部移动到 `devDependencies`，以符合 electron-vite 关于依赖归类的最佳实践。

## 后续操作

- 运行 `npm install` 以更新本地安装目录和锁文件。
- 如需验证，可执行 `npm run build`/`npm start` 确认依赖拆分未影响构建与运行。
