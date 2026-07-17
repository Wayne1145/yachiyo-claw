import * as store from './store-node'
import { app } from 'electron'
import { ofetch } from 'ofetch'

// Measurement Protocol 参考文档
// https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference?hl=zh-cn&client_type=gtag
// https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events?client_type=gtag&hl=zh-cn#required_parameters

// 事件名、参数名，必须是字母、数字、下划线的组合

const measurement_id = `G-B365F44W6E`
const api_secret = `3H5zJ3WTSAm-4jOajRDP7A`

export async function event(name: string, params: any = {}) {
  const clientId = store.getConfig().uuid
  const res = await ofetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${measurement_id}&api_secret=${api_secret}`,
    {
      method: 'POST',
      body: {
        user_id: clientId,
        client_id: clientId,
        events: [
          {
            name: name,
            params: {
              app_name: 'chatbox',
              app_version: app.getVersion(),
              chatbox_platform_type: 'desktop',
              chatbox_platform: 'desktop',
              app_platform: process.platform,
              ...params,
            },
          },
        ],
      },
    }
  )
  return res
}
