export interface ErrorHelpEntry {
  code: string
  title: string
  reason: string
  resolutions: string[]
}

export const ERROR_HELP_ENTRIES: readonly ErrorHelpEntry[] = [
  {
    code: 'download_host_private',
    title: '下载器拒绝访问局域网地址',
    reason: '下载地址解析到了局域网、回环或其他非公网 IP。应用会拦截这类地址，避免下载功能被用于访问设备所在网络的内部服务。',
    resolutions: ['使用可从公网访问的 HTTPS 下载地址。', '检查代理、DNS 或镜像服务是否把下载域名解析到了内网地址。', '不要通过关闭安全校验来解决此问题。'],
  },
  {
    code: 'download_host_unresolved',
    title: '无法解析下载服务器地址',
    reason: '设备无法通过当前网络或 DNS 找到下载服务器。',
    resolutions: ['检查网络连接和 DNS 设置。', '确认下载地址的域名拼写正确。', '如使用代理或镜像，检查其地址是否仍可访问。'],
  },
  {
    code: 'download_url_rejected',
    title: '下载地址不符合安全要求',
    reason: '下载器只接受符合安全规则的 URL，例如公开 HTTPS 地址。',
    resolutions: ['改用公开的 HTTPS 下载地址。', '移除 URL 中的用户名、密码和非标准参数。'],
  },
  {
    code: 'download_url_port_rejected',
    title: '下载地址端口不受支持',
    reason: '下载地址使用了下载器安全策略不允许的端口。',
    resolutions: ['使用标准 HTTPS 端口 443 发布下载文件。', '联系插件发布者提供符合要求的下载地址。'],
  },
  {
    code: 'download_storage_unavailable',
    title: '无法写入应用存储',
    reason: '应用无法创建或写入下载文件。',
    resolutions: ['释放设备存储空间后重试。', '确认应用存储没有被系统限制或损坏。'],
  },
  {
    code: 'download_integrity_failed',
    title: '下载文件完整性校验失败',
    reason: '下载内容与预期校验值不一致，文件可能不完整或已被替换。',
    resolutions: ['删除该下载任务并重新下载。', '确认下载地址来自可信发布者。', '网络代理或镜像异常时，切换网络后重试。'],
  },
  {
    code: 'download_size_mismatch',
    title: '下载文件大小不一致',
    reason: '服务器声明的文件大小与实际下载内容不一致。',
    resolutions: ['重新下载。', '更换下载源或联系发布者修复文件。'],
  },
  {
    code: 'plugin_package_digest_mismatch',
    title: '插件包完整性校验失败',
    reason: '下载的插件包哈希与发布信息不一致，因此安装已停止。',
    resolutions: ['重新加载插件市场后再下载。', '确认网络、代理和镜像没有替换文件。', '联系插件发布者更新市场中的校验信息。'],
  },
  {
    code: 'plugin_marketplace_identity_mismatch',
    title: '插件身份与市场信息不一致',
    reason: '插件包中的标识、版本或发布信息与市场条目不匹配。',
    resolutions: ['不要安装该文件。', '刷新市场后重试。', '联系市场或插件发布者修正发布信息。'],
  },
  {
    code: 'plugin_download_wait_timeout',
    title: '等待插件下载超时',
    reason: '插件下载任务在等待期限内没有完成。',
    resolutions: ['在下载管理中查看任务状态。', '恢复或重新创建下载任务后再安装。'],
  },
]

export function errorCodeFromMessage(message: string | undefined): string | undefined {
  const code = message?.trim().split(':', 1)[0]
  return code && /^[a-z][a-z0-9_.-]+$/i.test(code) ? code : undefined
}

export function getErrorHelp(code: string | undefined): ErrorHelpEntry | undefined {
  return ERROR_HELP_ENTRIES.find((entry) => entry.code === code)
}

export function formatErrorWithCode(message: string, code: string | undefined): string {
  return code ? `${message}（错误代码：${code}）` : message
}
