// 保持窗口大小位置变化的代码，很大程度参考了 VSCODE 的实现
// /Users/benn/Documents/w/vscode/src/vs/platform/windows/electron-main/windowImpl.ts

import { screen, type Display, type Rectangle } from 'electron'
import { store } from './store-node'

export interface IWindowState {
  width?: number
  height?: number
  x?: number
  y?: number
  mode?: WindowMode
  readonly display?: number
}

export enum WindowMode {
  Maximized,
  Normal,
  Minimized, // not used anymore, but also cannot remove due to existing stored UI state (needs migration)
  Fullscreen,
}

// 需要限制窗口最小宽高，否则可能会出现缩小时（比如按最大窗口启动后，双击状态栏缩小）缩小到几像素大小的情况
export const minWidth = 280
export const minHeight = 450

export function defaultWindowState(mode = WindowMode.Normal): IWindowState {
  return {
    width: 1024,
    height: 768,
    mode,
  }
}

const storeKey = 'windowState'

export function getState(): [IWindowState, boolean? /* has multiple displays */] {
  const state = getCache()
  return restoreWindowState(state)
}

export function saveState(win: Electron.BrowserWindow): void {
  let [x, y] = win.getPosition()
  let [width, height] = win.getSize()
  let mode = WindowMode.Normal
  if (win.isFullScreen()) {
    mode = WindowMode.Fullscreen
    // when we are in fullscreen, we want to persist the last non-fullscreen x/y position and width/height
    const [originalState] = getState()
    x = originalState.x ?? x
    y = originalState.y ?? y
    width = originalState.width ?? width
    height = originalState.height ?? height
  } else if (win.isMaximized()) {
    mode = WindowMode.Maximized
  }
  setCache({
    width,
    height,
    x,
    y,
    mode,
    // mode?: WindowMode;
    // readonly display?: number;
  })
}

function restoreWindowState(state?: IWindowState): [IWindowState, boolean? /* has multiple displays */] {
  let hasMultipleDisplays = false
  if (state) {
    try {
      const displays = screen.getAllDisplays()
      hasMultipleDisplays = displays.length > 1

      state = validateWindowState(state, displays)
    } catch (err) {
      // this.logService.warn(`Unexpected error validating window state: ${err}\n${err.stack}`); // somehow display API can be picky about the state to validate
    }
  }

  return [state || defaultWindowState(), hasMultipleDisplays]
}

function validateWindowState(state: IWindowState, displays: Display[]): IWindowState | undefined {
  // this.logService.trace(`window#validateWindowState: validating window state on ${displays.length} display(s)`, state);

  if (
    typeof state.x !== 'number' ||
    typeof state.y !== 'number' ||
    typeof state.width !== 'number' ||
    typeof state.height !== 'number'
  ) {
    // this.logService.trace('window#validateWindowState: unexpected type of state values');

    return undefined
  }

  if (state.width <= 0 || state.height <= 0) {
    // this.logService.trace('window#validateWindowState: unexpected negative values');

    return undefined
  }

  // 防止过度缩小
  if (state.width < minWidth) {
    state.width = minWidth
  }
  if (state.height < minHeight) {
    state.height = minHeight
  }

  // Single Monitor: be strict about x/y positioning
  // macOS & Linux: these OS seem to be pretty good in ensuring that a window is never outside of it's bounds.
  // Windows: it is possible to have a window with a size that makes it fall out of the window. our strategy
  //          is to try as much as possible to keep the window in the monitor bounds. we are not as strict as
  //          macOS and Linux and allow the window to exceed the monitor bounds as long as the window is still
  //          some pixels (128) visible on the screen for the user to drag it back.
  if (displays.length === 1) {
    const displayWorkingArea = getWorkingArea(displays[0])
    if (displayWorkingArea) {
      // this.logService.trace('window#validateWindowState: 1 monitor working area', displayWorkingArea);

      function ensureStateInDisplayWorkingArea(): void {
        if (!state || typeof state.x !== 'number' || typeof state.y !== 'number' || !displayWorkingArea) {
          return
        }

        if (state.x < displayWorkingArea.x) {
          // prevent window from falling out of the screen to the left
          state.x = displayWorkingArea.x
        }

        if (state.y < displayWorkingArea.y) {
          // prevent window from falling out of the screen to the top
          state.y = displayWorkingArea.y
        }
      }

      // ensure state is not outside display working area (top, left)
      ensureStateInDisplayWorkingArea()

      if (state.width > displayWorkingArea.width) {
        // prevent window from exceeding display bounds width
        state.width = displayWorkingArea.width
      }

      if (state.height > displayWorkingArea.height) {
        // prevent window from exceeding display bounds height
        state.height = displayWorkingArea.height
      }

      if (state.x > displayWorkingArea.x + displayWorkingArea.width - 128) {
        // prevent window from falling out of the screen to the right with
        // 128px margin by positioning the window to the far right edge of
        // the screen
        state.x = displayWorkingArea.x + displayWorkingArea.width - state.width
      }

      if (state.y > displayWorkingArea.y + displayWorkingArea.height - 128) {
        // prevent window from falling out of the screen to the bottom with
        // 128px margin by positioning the window to the far bottom edge of
        // the screen
        state.y = displayWorkingArea.y + displayWorkingArea.height - state.height
      }

      // again ensure state is not outside display working area
      // (it may have changed from the previous validation step)
      ensureStateInDisplayWorkingArea()
    }

    return state
  }

  // Multi Montior (fullscreen): try to find the previously used display
  if (state.display && state.mode === WindowMode.Fullscreen) {
    const display = displays.find((d) => d.id === state.display)
    if (display && typeof display.bounds?.x === 'number' && typeof display.bounds?.y === 'number') {
      // this.logService.trace('window#validateWindowState: restoring fullscreen to previous display');

      const defaults = defaultWindowState(WindowMode.Fullscreen) // make sure we have good values when the user restores the window
      defaults.x = display.bounds.x // carefull to use displays x/y position so that the window ends up on the correct monitor
      defaults.y = display.bounds.y

      return defaults
    }
  }

  // Multi Monitor (non-fullscreen): ensure window is within display bounds
  let display: Display | undefined
  let displayWorkingArea: Rectangle | undefined
  try {
    display = screen.getDisplayMatching({ x: state.x, y: state.y, width: state.width, height: state.height })
    displayWorkingArea = getWorkingArea(display)
  } catch (error) {
    // Electron has weird conditions under which it throws errors
    // e.g. https://github.com/microsoft/vscode/issues/100334 when
    // large numbers are passed in
  }

  if (
    display && // we have a display matching the desired bounds
    displayWorkingArea && // we have valid working area bounds
    state.x + state.width > displayWorkingArea.x && // prevent window from falling out of the screen to the left
    state.y + state.height > displayWorkingArea.y && // prevent window from falling out of the screen to the top
    state.x < displayWorkingArea.x + displayWorkingArea.width && // prevent window from falling out of the screen to the right
    state.y < displayWorkingArea.y + displayWorkingArea.height // prevent window from falling out of the screen to the bottom
  ) {
    // this.logService.trace('window#validateWindowState: multi-monitor working area', displayWorkingArea);

    return state
  }

  return undefined
}

function getWorkingArea(display: Display): Rectangle | undefined {
  // Prefer the working area of the display to account for taskbars on the
  // desktop being positioned somewhere (https://github.com/microsoft/vscode/issues/50830).
  //
  // Linux X11 sessions sometimes report wrong display bounds, so we validate
  // the reported sizes are positive.
  if (display.workArea.width > 0 && display.workArea.height > 0) {
    return display.workArea
  }

  if (display.bounds.width > 0 && display.bounds.height > 0) {
    return display.bounds
  }

  return undefined
}

function setCache(state: IWindowState) {
  store.set(storeKey, state)
}

function getCache(): IWindowState {
  const state = store.get(storeKey) as IWindowState | undefined
  if (!state) {
    return defaultWindowState()
  }
  return state
}
