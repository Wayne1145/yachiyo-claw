const HTTP_EXPLANATIONS: Record<number, string> = {
  400: '请求参数无效。请检查模型名称、接口格式和提供商设置。',
  401: 'API 密钥无效或已过期。请检查密钥后重试。',
  402: '账户余额或额度不足。请检查提供商的计费状态。',
  403: '当前 API 密钥没有访问此模型或接口的权限。',
  404: '找不到请求的模型或接口。请检查模型 ID 和 API 地址。',
  408: '请求超时。请检查网络连接，或稍后重试。',
  409: '请求与服务端当前状态冲突。请稍后重试。',
  413: '请求内容过大。请减少上下文、附件或图片大小。',
  422: '服务端无法处理请求参数。请检查模型能力和参数设置。',
  429: '请求过于频繁或额度暂时受限。请稍后重试。',
  500: '提供商内部错误。这通常是临时故障，请稍后重试。',
  501: '提供商尚未支持此接口或功能。',
  502: '提供商网关收到无效响应。这通常是临时故障。',
  503: '提供商服务暂时不可用，可能正在维护或过载。',
  504: '提供商网关等待上游响应超时。请稍后重试。',
}

export function explainRequestError(error: string, responseBody = '', status?: number): string {
  if (status && HTTP_EXPLANATIONS[status]) return HTTP_EXPLANATIONS[status]
  const value = `${error}\n${responseBody}`.toLowerCase()
  if (/invalid[_ -]?api[_ -]?key|incorrect api key|authentication|unauthori[sz]ed/.test(value)) {
    return HTTP_EXPLANATIONS[401]
  }
  if (/insufficient[_ -]?quota|billing|payment|credit|balance/.test(value)) return HTTP_EXPLANATIONS[402]
  if (/model.{0,40}(not found|does not exist|unknown)|unknown model/.test(value)) return HTTP_EXPLANATIONS[404]
  if (/rate[_ -]?limit|too many requests|resource exhausted/.test(value)) return HTTP_EXPLANATIONS[429]
  if (/context[_ -]?length|maximum context|prompt is too long|token.{0,20}(exceed|limit)/.test(value)) {
    return '对话已超过模型上下文上限。请压缩上下文、减少附件或新建对话。'
  }
  if (/certificate|ssl|tls|handshake/.test(value)) {
    return 'TLS 安全连接失败。请检查系统时间、证书、代理和 API 地址。'
  }
  if (/local_model_memory_insufficient/.test(value)) return '设备可用内存不足，无法安全加载该本地模型。'
  if (/local_inference_process_crashed/.test(value)) return '本地推理进程异常退出。请尝试更小的模型或量化版本。'
  if (/local_model_chat_template/.test(value)) return '本地模型的聊天模板暂不受支持。请换用带标准 ChatML/Gemma 模板的 GGUF。'
  if (/local_model_(not_downloaded|file_missing)|local_model_not_available/.test(value)) {
    return '本地模型文件不可用。请在本地模型页确认下载完整并重新加载。'
  }
  if (/timeout|timed out/.test(value)) return HTTP_EXPLANATIONS[408]
  return '请求未能完成。请查看下方错误详情，检查网络、API 地址、密钥和模型设置后重试。'
}

export function parseHttpStatus(error: string, extraStatus?: unknown): number | undefined {
  if (typeof extraStatus === 'number' && extraStatus >= 400 && extraStatus <= 599) return extraStatus
  if (typeof extraStatus === 'string' && /^\d{3}$/.test(extraStatus)) {
    const parsed = Number(extraStatus)
    if (parsed >= 400 && parsed <= 599) return parsed
  }
  const match = error.match(/(?:status code|http)\s*:?[\s-]*(\d{3})/i)
  return match ? Number(match[1]) : undefined
}
