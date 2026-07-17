import { compareVersions } from 'compare-versions'
import dayjs from 'dayjs'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { remoteConfigAtom } from '@/stores/atoms'
import { CHATBOX_BUILD_CHANNEL, CHATBOX_BUILD_PLATFORM } from '@/variables'
import * as remote from '../packages/remote'
import platform from '../platform'

function getInitialTime() {
  let initialTime = parseInt(localStorage.getItem('initial-time') || '')
  if (!initialTime) {
    initialTime = Date.now()
    localStorage.setItem('initial-time', `${initialTime}`)
  }

  return initialTime
}

export function isFirstDay(): boolean {
  const initialTime = getInitialTime()
  const today = dayjs()
  const installDay = dayjs(initialTime)

  // Compare only the date part (year, month, day) in user's local timezone
  // This ensures the comparison is based on the user's current timezone,
  // which is more intuitive for the user experience
  return today.isSame(installDay, 'day')
}

export async function loadVersionStatus(
  checkRemoteUpdates: boolean,
  getVersion: () => Promise<string>,
  checkNeedUpdate: (version: string) => Promise<boolean>
): Promise<{ needCheckUpdate: boolean; version: string }> {
  const version = await getVersion()
  if (!checkRemoteUpdates) {
    return { needCheckUpdate: false, version }
  }
  return { needCheckUpdate: await checkNeedUpdate(version), version }
}

export default function useVersion({ checkRemoteUpdates = true }: { checkRemoteUpdates?: boolean } = {}) {
  const remoteConfig = useAtomValue(remoteConfigAtom)
  const [version, _setVersion] = useState('')
  const [needCheckUpdate, setNeedCheckUpdate] = useState(false)
  const isStoreReviewPlatform =
    CHATBOX_BUILD_PLATFORM === 'ios' ||
    (CHATBOX_BUILD_PLATFORM === 'android' && CHATBOX_BUILD_CHANNEL === 'google_play')
  const isExceeded = useMemo(
    () =>
      isStoreReviewPlatform &&
      Date.now() - getInitialTime() < 24 * 3600 * 1000 &&
      version &&
      remoteConfig.current_version &&
      compareVersions(version, remoteConfig.current_version) === 1,
    [version, remoteConfig, isStoreReviewPlatform]
  )
  const updateCheckTimer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    const handler = async () => {
      try {
        const status = await loadVersionStatus(
          checkRemoteUpdates,
          () => platform.getVersion(),
          async (version) => {
            const config = await platform.getConfig()
            const settings = await platform.getSettings()
            const os = await platform.getPlatform()
            return await remote.checkNeedUpdate(version, os, config, settings)
          }
        )
        _setVersion(status.version)
        setNeedCheckUpdate(status.needCheckUpdate)
      } catch (e) {
        console.error('Failed to check for updates:', e)
      }
    }
    void handler()
    if (checkRemoteUpdates) {
      updateCheckTimer.current = setInterval(handler, 2 * 60 * 60 * 1000)
    }
    return () => {
      if (updateCheckTimer.current) {
        clearInterval(updateCheckTimer.current)
        updateCheckTimer.current = undefined
      }
    }
  }, [checkRemoteUpdates])

  // True when all async data needed to evaluate isExceeded has loaded.
  // On non-store platforms this is always true (no defense to evaluate).
  // On store platforms we must wait for both version AND remoteConfig.current_version
  // before the guide-navigation guard in __root.tsx can make a reliable decision.
  const isExceededResolved = isStoreReviewPlatform ? !!(version && remoteConfig.current_version) : true

  return {
    version,
    versionLoaded: !!version,
    isExceeded,
    isExceededResolved,
    needCheckUpdate,
  }
}
