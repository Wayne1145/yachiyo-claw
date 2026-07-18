import dayjs from 'dayjs'
import { useEffect, useRef, useState } from 'react'
import { checkYachiyoGitHubUpdate } from '@shared/releases/yachiyo'
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
  const [version, _setVersion] = useState('')
  const [needCheckUpdate, setNeedCheckUpdate] = useState(false)
  const updateCheckTimer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    const handler = async () => {
      try {
        const status = await loadVersionStatus(
          checkRemoteUpdates,
          () => platform.getVersion(),
          (version) => checkYachiyoGitHubUpdate(version)
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

  return {
    version,
    versionLoaded: !!version,
    // Kept for route compatibility; the upstream store-review gate is not part of Yachiyo Claw.
    isExceeded: false,
    isExceededResolved: true,
    needCheckUpdate,
  }
}
