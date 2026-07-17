import { Device } from '@capacitor/device'
import { tool } from 'ai'
import { z } from 'zod'
import { executeRootShell, getAgentBackend } from '@/mobile/agent-broker'
import { requestAgentApproval } from '@/mobile/agent-approval'
import { yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'

type DeviceOperationListener = () => void | Promise<void>
const operationListeners = new Set<DeviceOperationListener>()

export function onAndroidDeviceOperation(listener: DeviceOperationListener): () => void {
  operationListeners.add(listener)
  return () => operationListeners.delete(listener)
}

async function notifyDeviceOperation(): Promise<void> {
  await Promise.all([...operationListeners].map((listener) => listener()))
}

async function exec(command: string) {
  await notifyDeviceOperation()
  return executeRootShell(command, 30_000)
}

async function accessibility(options: Parameters<typeof yachiyoDeviceAccessNative.accessibilityAction>[0]) {
  await notifyDeviceOperation()
  const result = await yachiyoDeviceAccessNative.accessibilityAction(options)
  return {
    stdout: result.output || (result.success ? 'ok' : ''),
    stderr: result.success ? '' : 'accessibility_action_failed',
    exitCode: result.success ? 0 : 1,
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function createAndroidDeviceToolSet(sessionId?: string) {
  const description = `
You can control the Android device through structured tools.
Observe the current UI before acting, use the physical coordinates returned in node bounds,
and observe again after each action. Use android_keyevent with HOME, BACK, or RECENTS for navigation.
${
  getAgentBackend() === 'accessibility'
    ? 'This backend uses AccessibilityService gestures and does not provide a shell.'
    : 'A privileged shell is available for advanced Android commands.'
}
`
  const approve = (title: string, detail: string, risk: 'safe' | 'dangerous' = 'safe') =>
    requestAgentApproval({ sessionId, title, detail, risk })
  const denied = () => ({ stdout: '', stderr: '用户拒绝了此操作', exitCode: 126 })

  const android_device_info = tool({
    description:
      'Read basic information about this Android device, including manufacturer, model, Android version, SDK version, and whether it is virtual. This is read-only and does not require approval.',
    inputSchema: z.object({}),
    execute: async () => {
      const info = await Device.getInfo()
      return {
        platform: info.platform,
        manufacturer: info.manufacturer,
        model: info.model,
        name: info.name,
        operatingSystem: info.operatingSystem,
        osVersion: info.osVersion,
        androidSdkVersion: info.androidSDKVersion,
        isVirtual: info.isVirtual,
        webViewVersion: info.webViewVersion,
      }
    },
  })

  const android_observe = tool({
    description: 'Read the current Android UI hierarchy and visible window metadata.',
    inputSchema: z.object({}),
    execute: async () =>
      getAgentBackend() === 'accessibility'
        ? accessibility({ action: 'observe' })
        : exec(
            'uiautomator dump /data/local/tmp/yachiyo-window.xml >/dev/null 2>&1; cat /data/local/tmp/yachiyo-window.xml; echo; dumpsys window | grep -E "mCurrentFocus|mFocusedApp"'
          ),
  })

  const android_tap = tool({
    description: 'Tap a physical screen coordinate.',
    inputSchema: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }),
    execute: async ({ x, y }) => {
      if (!(await approve('点击屏幕', `坐标：(${x}, ${y})`))) return denied()
      return getAgentBackend() === 'accessibility'
        ? accessibility({ action: 'tap', x, y })
        : exec(`input tap ${x} ${y}`)
    },
  })

  const android_swipe = tool({
    description: 'Swipe between physical screen coordinates.',
    inputSchema: z.object({
      start_x: z.number().int().nonnegative(),
      start_y: z.number().int().nonnegative(),
      end_x: z.number().int().nonnegative(),
      end_y: z.number().int().nonnegative(),
      duration_ms: z.number().int().min(50).max(5_000).optional(),
    }),
    execute: async ({ start_x, start_y, end_x, end_y, duration_ms }) => {
      if (!(await approve('滑动屏幕', `(${start_x}, ${start_y}) → (${end_x}, ${end_y})`))) return denied()
      return getAgentBackend() === 'accessibility'
        ? accessibility({
            action: 'swipe',
            startX: start_x,
            startY: start_y,
            endX: end_x,
            endY: end_y,
            duration: duration_ms ?? 350,
          })
        : exec(`input swipe ${start_x} ${start_y} ${end_x} ${end_y} ${duration_ms ?? 350}`)
    },
  })

  const android_type_text = tool({
    description: 'Type text into the currently focused Android input.',
    inputSchema: z.object({ text: z.string().max(4_000) }),
    execute: async ({ text }) => {
      const preview = text.length > 160 ? `${text.slice(0, 160)}…` : text
      if (!(await approve('输入文字', preview))) return denied()
      return getAgentBackend() === 'accessibility'
        ? accessibility({ action: 'text', text })
        : exec(`input text ${shellQuote(text.replace(/ /g, '%s'))}`)
    },
  })

  const android_keyevent = tool({
    description: 'Send an Android system navigation action such as HOME, BACK, or RECENTS.',
    inputSchema: z.object({ key: z.union([z.string().max(40), z.number().int().nonnegative()]) }),
    execute: async ({ key }) => {
      if (!(await approve('执行系统导航', String(key)))) return denied()
      return getAgentBackend() === 'accessibility'
        ? accessibility({ action: 'global', key: String(key) })
        : exec(`input keyevent ${shellQuote(String(key))}`)
    },
  })

  const android_launch_app = tool({
    description: 'Launch an installed Android app by package name.',
    inputSchema: z.object({ package_name: z.string().regex(/^[a-zA-Z0-9_.]+$/) }),
    execute: async ({ package_name }) => {
      if (!(await approve('启动应用', package_name))) return denied()
      return getAgentBackend() === 'accessibility'
        ? accessibility({ action: 'launch', packageName: package_name })
        : exec(`monkey -p ${shellQuote(package_name)} -c android.intent.category.LAUNCHER 1`)
    },
  })

  return {
    description,
    tools: {
      android_device_info,
      android_observe,
      android_tap,
      android_swipe,
      android_type_text,
      android_keyevent,
      android_launch_app,
    },
  }
}

export default createAndroidDeviceToolSet()
