import AutoLaunch from 'auto-launch'
import { getSettings } from './store-node'

// 开机自启动
let _autoLaunch: AutoLaunch | null = null

export function get() {
  if (!_autoLaunch) {
    _autoLaunch = new AutoLaunch({ name: 'Chatbox' })
  }
  return _autoLaunch
}

export async function sync() {
  const autoLaunch = get()
  const settings = getSettings()
  const isEnabled = await autoLaunch.isEnabled()
  if (!isEnabled && settings.autoLaunch) {
    await autoLaunch.enable()
    return
  }
  if (isEnabled && !settings.autoLaunch) {
    await autoLaunch.disable()
    return
  }
}

export async function ensure(enable: boolean) {
  const autoLaunch = get()
  const isEnabled = await autoLaunch.isEnabled()
  if (!isEnabled && enable) {
    await autoLaunch.enable()
    return
  }
  if (isEnabled && !enable) {
    await autoLaunch.disable()
    return
  }
}
