var entries = [
  ['download_host_private', '下载器拒绝访问局域网地址', '下载地址解析到了局域网、回环或其他非公网 IP。应用会拦截这类地址，避免下载功能被用于访问内部服务。', '使用可从公网访问的 HTTPS 地址；检查代理、DNS 或镜像是否把域名解析到内网；不要关闭安全校验。'],
  ['download_host_unresolved', '无法解析下载服务器地址', '设备无法通过当前网络或 DNS 找到下载服务器。', '检查网络和 DNS 设置；确认域名拼写；检查代理或镜像服务。'],
  ['download_url_rejected', '下载地址不符合安全要求', '下载器只接受符合安全规则的公开 HTTPS 地址。', '改用公开 HTTPS 地址；移除 URL 中的账号信息。'],
  ['download_url_port_rejected', '下载地址端口不受支持', '下载地址使用了下载器安全策略不允许的端口。', '使用标准 HTTPS 端口 443；联系发布者提供符合要求的地址。'],
  ['download_storage_unavailable', '无法写入应用存储', '应用无法创建或写入下载文件。', '释放设备存储空间；确认应用存储没有被系统限制。'],
  ['download_integrity_failed', '下载文件完整性校验失败', '下载内容与预期校验值不一致，文件可能不完整或已被替换。', '删除任务后重新下载；确认下载源可信；切换异常的代理或镜像。'],
  ['download_size_mismatch', '下载文件大小不一致', '服务器声明的文件大小与实际内容不一致。', '重新下载；更换下载源或联系发布者。'],
  ['plugin_package_digest_mismatch', '插件包完整性校验失败', '插件包哈希与发布信息不一致，安装已停止。', '重新加载市场后下载；检查网络、代理和镜像；联系发布者修复校验信息。'],
  ['plugin_marketplace_identity_mismatch', '插件身份与市场信息不一致', '插件包中的标识、版本或发布信息与市场条目不匹配。', '不要安装该文件；刷新市场；联系市场或发布者修正信息。'],
  ['plugin_download_wait_timeout', '等待插件下载超时', '插件下载任务在等待期限内没有完成。', '在下载管理中查看任务；恢复或重新创建下载任务后再安装。']
]

function categoryFor(code) {
  return code.indexOf('download_') === 0 ? '下载' : '插件'
}

function renderView(query) {
  var needle = String(query || '').trim().toLowerCase()
  var matches = entries.filter(function (entry) {
    return entry.join(' ').toLowerCase().indexOf(needle) !== -1
  })
  return {
    schemaVersion: 1,
    title: '错误帮助中心',
    children: [
      { type: 'heading', key: 'title', content: '错误帮助中心', level: 2 },
      { type: 'text', key: 'intro', content: '按错误代码查找原因与安全的处理方式。', dimmed: true },
      { type: 'alert', key: 'safety', tone: 'info', content: '下载地址被拦截时，请优先检查网络、DNS 与代理配置；不要关闭安全校验。' },
      {
        type: 'card',
        key: 'search-panel',
        title: '查找错误',
        children: [
          { type: 'textInput', key: 'search', label: '错误代码或关键词', placeholder: '例如 download_host_private', value: query || '', onChange: { type: 'invoke', handler: 'search' } },
          { type: 'text', key: 'result-count', content: '找到 ' + matches.length + ' 条匹配结果。', size: 'xs', dimmed: true }
        ]
      },
      {
        type: 'list',
        key: 'results',
        items: matches.map(function (entry) {
          return {
            key: entry[0],
            title: entry[1],
            badge: categoryFor(entry[0]),
            icon: 'info',
            description: '错误代码：' + entry[0] + ' · 原因：' + entry[2] + ' · 处理方式：' + entry[3]
          }
        })
      }
    ]
  }
}

yachiyo.registerTool('render', function () {
  return renderView('')
})

yachiyo.registerTool('search', function (args) {
  return renderView(args && typeof args.value === 'string' ? args.value : '')
})
