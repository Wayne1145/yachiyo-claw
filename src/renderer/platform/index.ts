import { CHATBOX_BUILD_TARGET } from '@/variables'
import DesktopPlatform from './desktop_platform'
import type { Platform } from './interfaces'
import MobilePlatform from './mobile_platform'
import TestPlatform from './test_platform'
import WebPlatform from './web_platform'

function initPlatform(): Platform {
  // 测试环境使用 TestPlatform
  if (process.env.NODE_ENV === 'test') {
    return new TestPlatform()
  }
  if (CHATBOX_BUILD_TARGET === 'mobile_app') {
    return new MobilePlatform()
  } else if (typeof window !== 'undefined' && window.electronAPI) {
    return new DesktopPlatform(window.electronAPI)
  } else {
    return new WebPlatform()
  }
}

export default initPlatform()
