import { registerPlugin } from '@capacitor/core'
import type { PluginFetchRequest, PluginFetchResponse } from '@/plugins/network-proxy'

interface YachiyoPluginNetworkPlugin {
  fetch(options: PluginFetchRequest & { allowedDomains: string[]; requestId: string }): Promise<PluginFetchResponse>
  cancel(options: { requestId: string }): Promise<{ cancelled: boolean }>
}

export const yachiyoPluginNetworkNative = registerPlugin<YachiyoPluginNetworkPlugin>('YachiyoPluginNetwork')
