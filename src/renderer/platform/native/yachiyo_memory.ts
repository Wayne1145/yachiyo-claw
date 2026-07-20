import { registerPlugin } from '@capacitor/core'

interface YachiyoMemoryPlugin {
  read(options: { key: string }): Promise<{ found: boolean; value?: string }>
  write(options: { key: string; value: string }): Promise<void>
  remove(options: { key: string }): Promise<{ removed: boolean }>
  clear(): Promise<void>
}

export const yachiyoMemoryNative = registerPlugin<YachiyoMemoryPlugin>('YachiyoMemory')

export function readNativeMemoryBlob(key: string): Promise<{ found: boolean; value?: string }> {
  return yachiyoMemoryNative.read({ key })
}

export function writeNativeMemoryBlob(key: string, value: string): Promise<void> {
  return yachiyoMemoryNative.write({ key, value })
}

export function removeNativeMemoryBlob(key: string): Promise<{ removed: boolean }> {
  return yachiyoMemoryNative.remove({ key })
}

export function clearNativeMemory(): Promise<void> {
  return yachiyoMemoryNative.clear()
}
