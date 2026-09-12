import { CHATBOX_BUILD_TARGET } from '@/variables'
import type { Platform } from './interfaces'
import MobilePlatform from './mobile_platform'
import TestPlatform from './test_platform'
import WebPlatform from './web_platform'

function initPlatform(): Platform {
  // 测试环境使用 TestPlatform
  if (process.env.NODE_ENV === 'test') return new TestPlatform()
  // The Android app is the product; the web platform only serves browser previews of the same bundle.
  if (CHATBOX_BUILD_TARGET === 'mobile_app') return new MobilePlatform()
  return new WebPlatform()
}

export default initPlatform()
