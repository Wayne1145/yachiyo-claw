export interface ErrorHelpEntry {
  title: string
  detail: string
}

const ERROR_HELP: Readonly<Record<string, ErrorHelpEntry>> = {
  download_host_private: {
    title: '下载器拒绝访问局域网地址',
    detail: '为避免服务端请求伪造，应用内下载器只允许访问公开网络地址。',
  },
  download_https_required: {
    title: '下载地址必须使用 HTTPS',
    detail: '请改用可信的 HTTPS 下载地址后重试。',
  },
  plugin_package_digest_mismatch: {
    title: '插件包完整性校验失败',
    detail: '下载内容与发布信息不一致，应用已停止安装。',
  },
  plugin_signature_invalid: {
    title: '插件签名无效',
    detail: '插件包无法验证为声明的发布者，请联系插件作者。',
  },
}

export function errorCodeFromMessage(message: string): string {
  const match = message.trim().match(/^([a-z][a-z0-9_.-]{1,119})(?::|$)/i)
  return match?.[1] ?? ''
}

export function formatErrorWithCode(message: string, code: string): string {
  if (!code || message.includes(`错误代码：${code}`)) return message
  return `${message}（错误代码：${code}）`
}

export function getErrorHelp(code: string): ErrorHelpEntry | undefined {
  return code ? ERROR_HELP[code] : undefined
}
