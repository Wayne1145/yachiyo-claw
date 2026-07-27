# Skills 使用说明

Skill 是供模型读取的可复用工作说明。启用的 Skill 会被加入 Agent 的可用上下文；它不是 Android 权限，
也不会因为文档中写了某条命令就自动获得执行能力。

## 浏览和安装

在 **设置 > Skills** 中，页面会直接显示 SkillHub/热门推荐和搜索入口，不需要先导入文件。Android 支持：

- 从推荐或搜索结果安装；
- 从 `skills.sh` 链接定位 GitHub 中的 Skill；
- 输入 GitHub 仓库地址，扫描并选择其中的 `SKILL.md` 目录；
- 安装 SkillHub 提供的固定 revision 包。

实际包体通过统一下载器传输，并在应用重启后恢复安装事务。下载后会限制文件数量、路径、展开体积和
脚本类型；路径穿越、符号链接、摘要不符或清单外文件会被拒绝。来源提供 ECDSA P-256 签名时会在受支持
Android 版本上验证；哈希只能证明字节未变化，不能单独证明作者身份。

## 启用、更新和删除

安装成功的 Skill 默认加入已启用列表。可以在已安装列表单独启用或停用，停用不会删除文件。来源为
GitHub 或 SkillHub 的 Skill 可以执行真实 revision/版本更新检查；当前界面只报告是否存在更新，不会在
后台静默替换内容。确认来源后重新安装，或先删除再从原来源安装新版本。本地创建的 Skill 没有远程更新源。

删除 Skill 会移除它的文件和启用状态。Android 不显示桌面端“打开 Skills 文件夹”按钮，因为应用私有
目录不应通过广泛存储权限暴露。

## 脚本型 Skill

普通 Skill 只有说明文本。脚本型 Skill 必须声明固定入口、运行时、文件大小、SHA-256、超时、工作目录
和能力。Android 支持 shell、Python 和 JavaScript 入口，并在执行前再次校验文件摘要。

脚本执行需要用户显式开启，并且每次运行仍经过危险操作审批和 Tool Broker。脚本会被写入应用私有的
PRoot/Alpine 环境，在 Skill 私有目录或 `/workspace` 中由 `/bin/sh`、`python3` 或 `node` 执行，输出有
大小和超时限制。PRoot 不是容器或内核安全边界：脚本可能修改共享 Linux rootfs、访问工作区，或通过
Linux 工具自行联网。只应为完全信任的 Skill 开启脚本执行。

未签名 Skill 会显示额外警告。Root、Shizuku 和无障碍属于独立的手机控制域；Skill 脚本不会因为手机
控制已开启就绕过自身的脚本授权和审批。

## 编写 Skill

一个最小 Skill 目录至少包含 `SKILL.md`，其名称、描述和所需工具应清晰、可复查。不要在 Skill 文档或
脚本中嵌入 API Key、OAuth token 或设备私密数据。Agent 自己编写的 Skill 也按用户 Skill 处理，必须经过
同样的启用和脚本执行边界。

SkillHub、`skills.sh` 和 GitHub 内容均由第三方发布。安装前请阅读对应许可证、安全报告和依赖要求；
Yachiyo Claw 的 GPLv3 不会改变第三方 Skill 的许可证。
