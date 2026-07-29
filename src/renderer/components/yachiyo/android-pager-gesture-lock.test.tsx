/** @vitest-environment jsdom */

import { act, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AndroidPagerGestureLockProvider,
  hasOpenAndroidPagerBlockingLayer,
  useAndroidPagerGestureLock,
  useAndroidPagerGesturesLocked,
} from './android-pager-gesture-lock'

function LockState({ explicit = false }: { explicit?: boolean }) {
  useAndroidPagerGestureLock(explicit)
  const locked = useAndroidPagerGesturesLocked()
  return <output data-testid="lock-state">{locked ? 'locked' : 'unlocked'}</output>
}

function LockHarness() {
  const [explicit, setExplicit] = useState(false)
  return (
    <AndroidPagerGestureLockProvider>
      <button type="button" onClick={() => setExplicit((value) => !value)}>
        toggle explicit
      </button>
      <LockState explicit={explicit} />
    </AndroidPagerGestureLockProvider>
  )
}

function mockElementRect(element: HTMLElement, width = 120, height = 48) {
  element.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, right: width, bottom: height, left: 0, width, height, toJSON: () => ({}) }) as DOMRect
}

function appendPortal(markup: string): HTMLElement {
  const portal = document.createElement('div')
  portal.dataset.testPortal = 'true'
  portal.innerHTML = markup
  portal.querySelectorAll<HTMLElement>('*').forEach((element) => mockElementRect(element))
  document.body.appendChild(portal)
  return portal
}

afterEach(() => {
  document.querySelectorAll('[data-test-portal="true"]').forEach((portal) => portal.remove())
})

describe('android pager gesture lock', () => {
  it.each([
    ['menu', '<div class="mantine-Menu-dropdown">Menu</div>'],
    ['popover', '<div class="mantine-Popover-dropdown">Popover</div>'],
    ['combobox', '<div class="mantine-Combobox-dropdown">Combobox</div>'],
    ['explicit layer', '<div data-yachiyo-pager-gesture-lock="true">Custom</div>'],
  ])('recognizes a visible %s portal', (_label, markup) => {
    appendPortal(markup)
    expect(hasOpenAndroidPagerBlockingLayer()).toBe(true)
  })

  it('ignores tooltips and hidden or closed blocking layers', () => {
    appendPortal('<div role="tooltip">Hint</div>')
    appendPortal('<div role="menu" hidden>Hidden</div>')
    appendPortal('<div data-vaul-drawer data-state="closed">Closed</div>')

    expect(hasOpenAndroidPagerBlockingLayer()).toBe(false)
  })

  it('ignores mounted blocking-layer shells with no visible geometry', () => {
    const portal = appendPortal('<div class="mantine-Modal-root"><div role="dialog">Closed dialog</div></div>')
    portal.querySelectorAll<HTMLElement>('*').forEach((element) => mockElementRect(element, 0, 0))

    expect(hasOpenAndroidPagerBlockingLayer()).toBe(false)
  })

  it('tracks portaled layer insertion, visibility, and removal', async () => {
    render(<LockHarness />)
    expect(screen.getByTestId('lock-state').textContent).toBe('unlocked')

    const portal = appendPortal('<div role="listbox">Options</div>')
    await waitFor(() => expect(screen.getByTestId('lock-state').textContent).toBe('locked'))

    const listbox = portal.firstElementChild as HTMLElement
    act(() => listbox.setAttribute('aria-hidden', 'true'))
    await waitFor(() => expect(screen.getByTestId('lock-state').textContent).toBe('unlocked'))

    act(() => listbox.removeAttribute('aria-hidden'))
    await waitFor(() => expect(screen.getByTestId('lock-state').textContent).toBe('locked'))

    act(() => portal.remove())
    await waitFor(() => expect(screen.getByTestId('lock-state').textContent).toBe('unlocked'))
  })

  it('keeps explicit and portal locks independent', async () => {
    render(<LockHarness />)
    act(() => screen.getByRole('button', { name: 'toggle explicit' }).click())
    await waitFor(() => expect(screen.getByTestId('lock-state').textContent).toBe('locked'))

    const portal = appendPortal('<div role="dialog">Dialog</div>')
    await waitFor(() => expect(screen.getByTestId('lock-state').textContent).toBe('locked'))
    act(() => screen.getByRole('button', { name: 'toggle explicit' }).click())
    expect(screen.getByTestId('lock-state').textContent).toBe('locked')

    act(() => portal.remove())
    await waitFor(() => expect(screen.getByTestId('lock-state').textContent).toBe('unlocked'))
  })
})
