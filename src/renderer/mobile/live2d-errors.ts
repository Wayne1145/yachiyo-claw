export type Live2DErrorPhase =
  | 'import'
  | 'storage'
  | 'core'
  | 'webgl'
  | 'settings'
  | 'moc'
  | 'texture'
  | 'render'

export type Live2DErrorCode =
  | 'L2D-IMP-001'
  | 'L2D-IMP-002'
  | 'L2D-IMP-003'
  | 'L2D-IMP-004'
  | 'L2D-CFG-001'
  | 'L2D-CFG-002'
  | 'L2D-CFG-003'
  | 'L2D-CFG-004'
  | 'L2D-STORE-001'
  | 'L2D-CORE-001'
  | 'L2D-CORE-002'
  | 'L2D-WEBGL-001'
  | 'L2D-WEBGL-002'
  | 'L2D-ASSET-001'
  | 'L2D-MOC-001'
  | 'L2D-MOC-002'
  | 'L2D-TEX-001'
  | 'L2D-TEX-002'
  | 'L2D-CTX-001'
  | 'L2D-RUN-999'

export interface Live2DUserError {
  code: Live2DErrorCode
  phase: Live2DErrorPhase
  title: string
  explanation: string
  resolution: string
  retryable: boolean
  technicalDetail?: string
  resource?: string
  httpStatus?: number
}

type Live2DErrorDefinition = Omit<Live2DUserError, 'technicalDetail' | 'resource' | 'httpStatus'>

const LIVE2D_ERRORS: Record<Live2DErrorCode, Live2DErrorDefinition> = {
  'L2D-IMP-001': {
    code: 'L2D-IMP-001', phase: 'import', title: 'Live2D 压缩包无法读取',
    explanation: '选择的文件不是有效 ZIP，或者压缩包已经损坏。', resolution: '请重新导出或重新下载模型压缩包。', retryable: true,
  },
  'L2D-IMP-002': {
    code: 'L2D-IMP-002', phase: 'import', title: 'Live2D 压缩包过大',
    explanation: '压缩包超过 256 MB 的导入上限。', resolution: '请压缩纹理或移除模型包中的无关资源。', retryable: false,
  },
  'L2D-IMP-003': {
    code: 'L2D-IMP-003', phase: 'import', title: 'Live2D 文件数量过多',
    explanation: '压缩包包含超过 2000 个文件。', resolution: '请清理无关文件后重新打包。', retryable: false,
  },
  'L2D-IMP-004': {
    code: 'L2D-IMP-004', phase: 'import', title: 'Live2D 解压体积过大',
    explanation: '模型解压后的资源总量超过 1 GB。', resolution: '请降低纹理分辨率或精简模型资源。', retryable: false,
  },
  'L2D-CFG-001': {
    code: 'L2D-CFG-001', phase: 'settings', title: '缺少 Live2D 模型配置',
    explanation: '压缩包中没有找到 Cubism 4 的 .model3.json 文件。', resolution: '请使用 Cubism 4 格式重新导出模型。', retryable: false,
  },
  'L2D-CFG-002': {
    code: 'L2D-CFG-002', phase: 'settings', title: 'Live2D 模型配置无效',
    explanation: 'model3.json 无法解析，或不包含必需的 Moc 和纹理配置。', resolution: '请检查导出的 model3.json 并重新打包。', retryable: false,
  },
  'L2D-CFG-003': {
    code: 'L2D-CFG-003', phase: 'settings', title: 'Live2D 模型路径不安全',
    explanation: '模型包包含绝对路径、上级目录路径或冲突文件名。', resolution: '请重新打包，并只使用模型目录内的相对路径。', retryable: false,
  },
  'L2D-CFG-004': {
    code: 'L2D-CFG-004', phase: 'settings', title: 'Live2D 引用资源缺失',
    explanation: 'model3.json 引用的模型、纹理、物理或表情资源不存在。', resolution: '请补齐错误详情中列出的文件后重新打包。', retryable: false,
  },
  'L2D-STORE-001': {
    code: 'L2D-STORE-001', phase: 'storage', title: 'Live2D 模型无法保存',
    explanation: '应用存储空间不足，或 WebView 暂时拒绝了模型存储。', resolution: '请释放存储空间、重启应用后重新导入。', retryable: true,
  },
  'L2D-CORE-001': {
    code: 'L2D-CORE-001', phase: 'core', title: 'Live2D Cubism Core 缺失',
    explanation: '应用无法加载内置 Cubism Core 运行库。', resolution: '请重新启动应用；若仍失败，请重新安装完整 APK。', retryable: true,
  },
  'L2D-CORE-002': {
    code: 'L2D-CORE-002', phase: 'core', title: 'Live2D Cubism Core 初始化失败',
    explanation: 'Cubism Core 文件已读取，但没有成功建立运行环境。', resolution: '请更新 Android System WebView 并重启应用。', retryable: true,
  },
  'L2D-WEBGL-001': {
    code: 'L2D-WEBGL-001', phase: 'webgl', title: '当前设备无法创建 WebGL',
    explanation: 'Android WebView 没有提供可用的 WebGL 渲染上下文。', resolution: '请更新 Android System WebView，并确认没有禁用硬件加速。', retryable: true,
  },
  'L2D-WEBGL-002': {
    code: 'L2D-WEBGL-002', phase: 'webgl', title: 'Live2D 渲染能力不足',
    explanation: '设备的纹理或渲染缓冲限制不足以加载当前模型。', resolution: '请切换到省电画质，或使用更小的模型和纹理。', retryable: true,
  },
  'L2D-ASSET-001': {
    code: 'L2D-ASSET-001', phase: 'settings', title: 'Live2D 资源加载失败',
    explanation: '模型配置或引用资源无法从应用存储中读取。', resolution: '请重试；导入模型可删除后重新导入。', retryable: true,
  },
  'L2D-MOC-001': {
    code: 'L2D-MOC-001', phase: 'moc', title: 'Live2D Moc 文件不兼容',
    explanation: 'Cubism Core 无法读取 .moc3，文件可能损坏或由不兼容版本导出。', resolution: '请使用兼容的 Cubism 4 版本重新导出模型。', retryable: false,
  },
  'L2D-MOC-002': {
    code: 'L2D-MOC-002', phase: 'moc', title: 'Live2D 模型实例创建失败',
    explanation: 'Moc 已读取，但 Cubism Core 无法为它创建模型实例，通常与内存或模型复杂度有关。', resolution: '请关闭高负载页面、切换省电画质，或精简模型后重试。', retryable: true,
  },
  'L2D-TEX-001': {
    code: 'L2D-TEX-001', phase: 'texture', title: 'Live2D 纹理无法读取',
    explanation: '模型纹理缺失、损坏或无法被 Android WebView 解码。', resolution: '请检查错误详情中的纹理文件，并使用 PNG 或 WebP 重新导出。', retryable: false,
  },
  'L2D-TEX-002': {
    code: 'L2D-TEX-002', phase: 'texture', title: 'Live2D 纹理尺寸过大',
    explanation: '纹理尺寸超过当前设备的 WebGL 上限。', resolution: '请将纹理缩小到设备支持的尺寸后重新导入。', retryable: false,
  },
  'L2D-CTX-001': {
    code: 'L2D-CTX-001', phase: 'render', title: 'Live2D 渲染上下文已丢失',
    explanation: 'WebGL 上下文丢失，并且自动降档恢复仍然失败。', resolution: '请关闭其他高负载页面，然后点击重试。', retryable: true,
  },
  'L2D-RUN-999': {
    code: 'L2D-RUN-999', phase: 'render', title: 'Live2D 内部错误',
    explanation: '加载流程遇到了尚未分类的内部异常，原始诊断已保留。', resolution: '请点击重试；若持续出现，请复制技术详情用于定位。', retryable: true,
  },
}

export class YachiyoLive2DError extends Error {
  readonly diagnostic: Live2DUserError

  constructor(diagnostic: Live2DUserError) {
    super(`${diagnostic.code}: ${diagnostic.title}`)
    this.name = 'YachiyoLive2DError'
    this.diagnostic = diagnostic
  }
}

export function createLive2DError(
  code: Live2DErrorCode,
  detail?: Partial<Pick<Live2DUserError, 'technicalDetail' | 'resource' | 'httpStatus'>>
): YachiyoLive2DError {
  return new YachiyoLive2DError({ ...LIVE2D_ERRORS[code], ...detail })
}

function describeUnknown(reason: unknown): string {
  if (reason instanceof Error) return [reason.name, reason.message, reason.stack].filter(Boolean).join('\n').slice(0, 5000)
  if (typeof reason === 'string') return reason.slice(0, 5000)
  try {
    return JSON.stringify(reason).slice(0, 5000)
  } catch {
    return String(reason).slice(0, 5000)
  }
}

function safeResource(resource: unknown): string | undefined {
  if (typeof resource !== 'string' || !resource) return undefined
  if (/^(?:blob|data):/i.test(resource)) return 'local-model-resource'
  try {
    const parsed = new URL(resource)
    return parsed.pathname.split('/').filter(Boolean).slice(-3).join('/') || parsed.protocol
  } catch {
    return resource.split(/[?#]/, 1)[0].slice(0, 300)
  }
}

export function normalizeLive2DError(
  reason: unknown,
  context: { phase: Live2DErrorPhase; resource?: string } = { phase: 'render' }
): Live2DUserError {
  if (reason instanceof YachiyoLive2DError) return reason.diagnostic
  const message = reason instanceof Error ? reason.message : String(reason ?? '')
  const stack = reason instanceof Error ? reason.stack || '' : ''
  const structuredReason = reason as { url?: unknown; status?: unknown } | null
  const status = typeof structuredReason?.status === 'number' ? structuredReason.status : undefined
  const detail = {
    technicalDetail: describeUnknown(reason),
    resource: safeResource(structuredReason?.url) || safeResource(context.resource),
    httpStatus: status,
  }

  if (/unknown error/i.test(message)) {
    return createLive2DError(/createModel|fromMoc/i.test(stack) ? 'L2D-MOC-002' : 'L2D-MOC-001', detail).diagnostic
  }
  if (/network error|failed to load resource|status\s\d+/i.test(message)) {
    return createLive2DError('L2D-ASSET-001', detail).diagnostic
  }
  if (/texture loading|image decode|texture/i.test(message)) {
    return createLive2DError('L2D-TEX-001', detail).diagnostic
  }
  if (/invalid moc|moc data|moc3/i.test(message)) {
    return createLive2DError('L2D-MOC-001', detail).diagnostic
  }
  const phaseCode: Partial<Record<Live2DErrorPhase, Live2DErrorCode>> = {
    import: 'L2D-IMP-001', storage: 'L2D-STORE-001', core: 'L2D-CORE-002',
    webgl: 'L2D-WEBGL-002', settings: 'L2D-CFG-002', moc: 'L2D-MOC-001',
    texture: 'L2D-TEX-001', render: 'L2D-RUN-999',
  }
  return createLive2DError(phaseCode[context.phase] || 'L2D-RUN-999', detail).diagnostic
}
