import { registerPlugin } from '@capacitor/core'
import type { UsageEntry } from '@/mobile/usage-statistics'
export const yachiyoUsageNative = registerPlugin<{ readEntries(): Promise<{ entries: UsageEntry[] }> }>('YachiyoUsage')
