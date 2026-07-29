/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ComponentProps, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { AndroidShellTab } from '@/mobile/android-app-shell'
import { AndroidMainTabPager } from './AndroidMainTabPager'
import { AndroidPagerGestureLockProvider } from './android-pager-gesture-lock'

const haptics = vi.hoisted(() => ({ selection: vi.fn(async () => true) }))

vi.mock('@/utils/mobile-haptics', () => ({
  flowGlassHaptics: {
    selection: haptics.selection,
  },
}))

function TestIcon() {
  return <svg aria-hidden />
}

const items: ComponentProps<typeof AndroidMainTabPager>['items'] = [
  { id: 'chat', label: '聊天', icon: TestIcon, order: 100, route: '/' },
  { id: 'tasks', label: '任务', icon: TestIcon, order: 200, route: '/tasks' },
  { id: 'interactive', label: '交互式', icon: TestIcon, order: 300, route: '/interactive' },
  { id: 'settings', label: '设置', icon: TestIcon, order: 400, route: '/settings' },
]

class PointerEventMock extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  readonly isPrimary: boolean

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'touch'
    this.isPrimary = init.isPrimary ?? true
  }
}

function PagerHarness({
  onChange = vi.fn(),
  touchExplorationEnabled = false,
  initialActiveTab = 'chat',
}: {
  onChange?: (tab: AndroidShellTab) => void
  touchExplorationEnabled?: boolean
  initialActiveTab?: AndroidShellTab
}) {
  const [activeTab, setActiveTab] = useState<AndroidShellTab>(initialActiveTab)
  return (
    <AndroidPagerGestureLockProvider>
      <AndroidMainTabPager
        activeTab={activeTab}
        items={items}
        onChange={(tab) => {
          onChange(tab)
          setActiveTab(tab)
        }}
        interactionState={{
          systemGestureInsetsCssPx: { left: 0, right: 0 },
          touchExplorationEnabled,
        }}
        renderSource={(activity) => (
          <div data-testid={`source-${activeTab}`} data-activity={activity}>
            <input aria-label="draft" />
          </div>
        )}
        renderPreview={(tab) => <div data-testid={`preview-${tab}`}>{tab}</div>}
      >
        fallback
      </AndroidMainTabPager>
    </AndroidPagerGestureLockProvider>
  )
}

function dispatchPointer(target: Element, type: string, init: PointerEventInit, timeStamp: number): void {
  const event = new PointerEventMock(type, { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'timeStamp', { configurable: true, value: timeStamp })
  fireEvent(target, event)
}

describe('AndroidMainTabPager', () => {
  let clientWidthDescriptor: PropertyDescriptor | undefined
  let pointerCaptureDescriptor: PropertyDescriptor | undefined
  let releasePointerCaptureDescriptor: PropertyDescriptor | undefined
  let hasPointerCaptureDescriptor: PropertyDescriptor | undefined
  let rectSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    await i18n.changeLanguage('zh-Hans')
    haptics.selection.mockClear()
    vi.stubGlobal('PointerEvent', PointerEventMock)
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    pointerCaptureDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture')
    releasePointerCaptureDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'releasePointerCapture')
    hasPointerCaptureDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.classList?.contains('yachiyo-main-tab-pager') ? 360 : 120
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => true),
    })
    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.classList?.contains('yachiyo-main-tab-pager') ? 360 : 120
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 800, width, height: 800, toJSON: () => ({}) }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    rectSpy.mockRestore()
    const restore = (name: string, descriptor: PropertyDescriptor | undefined) => {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, name)
    }
    restore('clientWidth', clientWidthDescriptor)
    restore('setPointerCapture', pointerCaptureDescriptor)
    restore('releasePointerCapture', releasePointerCaptureDescriptor)
    restore('hasPointerCapture', hasPointerCaptureDescriptor)
  })

  it('renders one lens, previews only the requested distant tab, and commits aria-current with one haptic', async () => {
    const onChange = vi.fn()
    const { container } = render(<PagerHarness onChange={onChange} />)

    expect(container.querySelectorAll('.yachiyo-bottom-nav-lens')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '设置' }))

    expect(screen.getByTestId('preview-settings')).toBeTruthy()
    expect(screen.queryByTestId('preview-tasks')).toBeNull()
    expect(screen.getByRole('button', { name: '聊天' }).getAttribute('aria-current')).toBe('page')

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('settings'), { timeout: 2500 })
    await waitFor(() => expect(screen.getByRole('button', { name: '设置' }).getAttribute('aria-current')).toBe('page'))
    expect(haptics.selection).toHaveBeenCalledOnce()
  })

  it('tracks a one-page drag, marks the source preview, and commits the adjacent page', async () => {
    const onChange = vi.fn()
    const { container } = render(<PagerHarness onChange={onChange} />)
    const track = container.querySelector('.yachiyo-main-tab-pager') as HTMLElement

    fireEvent.pointerDown(track, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 240, clientY: 300 })
    fireEvent.pointerMove(track, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 90, clientY: 304 })
    expect(screen.getByTestId('preview-tasks')).toBeTruthy()
    expect(screen.getByTestId('source-chat').dataset.activity).toBe('preview')
    fireEvent.pointerUp(track, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 90, clientY: 304 })

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('tasks'), { timeout: 2500 })
    expect(haptics.selection).toHaveBeenCalledOnce()
  })

  it('cancels an active page gesture as soon as a second touch begins', async () => {
    const onChange = vi.fn()
    const { container } = render(<PagerHarness onChange={onChange} />)
    const track = container.querySelector('.yachiyo-main-tab-pager') as HTMLElement

    fireEvent.pointerDown(track, {
      pointerId: 31,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 240,
      clientY: 300,
    })
    fireEvent.pointerMove(track, {
      pointerId: 31,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 100,
      clientY: 302,
    })
    expect(screen.getByTestId('preview-tasks')).toBeTruthy()

    fireEvent.pointerDown(track, {
      pointerId: 32,
      pointerType: 'touch',
      isPrimary: false,
      clientX: 180,
      clientY: 320,
    })
    await waitFor(() => expect(screen.queryByTestId('preview-tasks')).toBeNull(), { timeout: 2500 })
    fireEvent.pointerUp(track, {
      pointerId: 31,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 100,
      clientY: 302,
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(haptics.selection).not.toHaveBeenCalled()
  })

  it('does not capture gestures from inputs or while touch exploration is active', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(<PagerHarness onChange={onChange} />)
    const track = container.querySelector('.yachiyo-main-tab-pager') as HTMLElement
    const input = screen.getByRole('textbox', { name: 'draft' })

    fireEvent.pointerDown(input, { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: 200, clientY: 300 })
    fireEvent.pointerMove(track, { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: 40, clientY: 302 })
    expect(screen.queryByTestId('preview-tasks')).toBeNull()

    rerender(<PagerHarness onChange={onChange} touchExplorationEnabled />)
    fireEvent.pointerDown(track, { pointerId: 10, pointerType: 'touch', isPrimary: true, clientX: 220, clientY: 300 })
    fireEvent.pointerMove(track, { pointerId: 10, pointerType: 'touch', isPrimary: true, clientX: 40, clientY: 302 })
    expect(screen.queryByTestId('preview-tasks')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not begin a page gesture while a portaled menu is open', () => {
    const onChange = vi.fn()
    const { container } = render(<PagerHarness onChange={onChange} />)
    const track = container.querySelector('.yachiyo-main-tab-pager') as HTMLElement
    const portal = document.createElement('div')
    portal.dataset.portal = 'true'
    portal.innerHTML = '<div role="menu"><button role="menuitem">Action</button></div>'
    document.body.appendChild(portal)

    fireEvent.pointerDown(track, {
      pointerId: 15,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 240,
      clientY: 300,
    })
    fireEvent.pointerMove(track, {
      pointerId: 15,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 40,
      clientY: 302,
    })

    expect(screen.queryByTestId('preview-tasks')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    portal.remove()
  })

  it('cancels an active page gesture when a portaled layer opens', async () => {
    const onChange = vi.fn()
    const { container } = render(<PagerHarness onChange={onChange} />)
    const track = container.querySelector('.yachiyo-main-tab-pager') as HTMLElement

    fireEvent.pointerDown(track, {
      pointerId: 16,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 240,
      clientY: 300,
    })
    fireEvent.pointerMove(track, {
      pointerId: 16,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 100,
      clientY: 302,
    })
    expect(screen.getByTestId('preview-tasks')).toBeTruthy()

    const portal = document.createElement('div')
    portal.innerHTML = '<div class="mantine-Popover-dropdown">Actions</div>'
    document.body.appendChild(portal)

    await waitFor(() => expect(screen.queryByTestId('preview-tasks')).toBeNull(), { timeout: 2500 })
    fireEvent.pointerUp(track, {
      pointerId: 16,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 100,
      clientY: 302,
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(haptics.selection).not.toHaveBeenCalled()
    portal.remove()
  })

  it('redirects rapid taps from the current presentation and only commits the newest target', async () => {
    const onChange = vi.fn()
    render(<PagerHarness onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '任务' }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('tasks'), { timeout: 2500 })
    expect(onChange).not.toHaveBeenCalledWith('settings')
    expect(haptics.selection).toHaveBeenCalledOnce()
  })

  it('uses the pointerup sample so pausing after a fast move cancels a short drag', async () => {
    const onChange = vi.fn()
    const { container } = render(<PagerHarness onChange={onChange} />)
    const track = container.querySelector('.yachiyo-main-tab-pager') as HTMLElement

    dispatchPointer(
      track,
      'pointerdown',
      { pointerId: 21, pointerType: 'touch', isPrimary: true, clientX: 240, clientY: 300 },
      100
    )
    dispatchPointer(
      track,
      'pointermove',
      { pointerId: 21, pointerType: 'touch', isPrimary: true, clientX: 210, clientY: 300 },
      120
    )
    dispatchPointer(
      track,
      'pointerup',
      { pointerId: 21, pointerType: 'touch', isPrimary: true, clientX: 210, clientY: 300 },
      320
    )

    await waitFor(() => expect(screen.queryByTestId('preview-tasks')).toBeNull(), { timeout: 2500 })
    expect(onChange).not.toHaveBeenCalled()
    expect(haptics.selection).not.toHaveBeenCalled()
  })

  it('cancels an in-flight transition when the committed source tab is tapped', async () => {
    const onChange = vi.fn()
    render(<PagerHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.getByTestId('preview-settings')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '聊天' }))

    await waitFor(() => expect(screen.queryByTestId('preview-settings')).toBeNull(), { timeout: 2500 })
    expect(onChange).not.toHaveBeenCalled()
    expect(haptics.selection).not.toHaveBeenCalled()
  })

  it('does not coerce a non-navigation plugin page to the Chat index', () => {
    const onChange = vi.fn()
    const { container } = render(<PagerHarness onChange={onChange} initialActiveTab="plugin-hidden" />)
    const track = container.querySelector('.yachiyo-main-tab-pager') as HTMLElement

    expect(screen.getByRole('button', { name: '聊天' }).getAttribute('aria-current')).toBeNull()
    expect(container.querySelector('.yachiyo-bottom-nav-lens')?.hasAttribute('hidden')).toBe(true)
    fireEvent.pointerDown(track, {
      pointerId: 41,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 240,
      clientY: 300,
    })
    fireEvent.pointerMove(track, {
      pointerId: 41,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 90,
      clientY: 300,
    })

    expect(screen.queryByTestId('preview-tasks')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
})
