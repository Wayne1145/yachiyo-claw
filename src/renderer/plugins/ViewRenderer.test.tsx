/**
 * @vitest-environment jsdom
 */
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parsePluginView } from '@shared/plugins/view-schema'
import { ViewRenderer } from './ViewRenderer'

// Mantine's color-scheme manager needs matchMedia, which jsdom doesn't provide.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia

function renderView(json: unknown, onAction = vi.fn()) {
  const view = parsePluginView(json)
  render(
    <MantineProvider>
      <ViewRenderer view={view} onAction={onAction} />
    </MantineProvider>,
  )
  return onAction
}

const view = (children: unknown[]) => ({ schemaVersion: 1, children })

describe('ViewRenderer', () => {
  it('renders injection payloads as inert text', () => {
    renderView(
      view([
        { type: 'text', key: 't', content: '<script>alert(1)</script>' },
        { type: 'codeBlock', key: 'c', content: '<img src=x onerror="steal()">' },
      ]),
    )
    // The strings appear as literal text; no script/img elements exist in the DOM.
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
    expect(screen.getByText('<img src=x onerror="steal()">')).toBeTruthy()
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
  })

  it('forwards button actions as data with the declared payload', () => {
    const onAction = renderView(
      view([
        {
          type: 'button',
          key: 'b',
          label: '刷新',
          action: { type: 'invoke', handler: 'refresh', payload: { from: 'ui' } },
        },
      ]),
    )
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'invoke', handler: 'refresh', payload: { from: 'ui' } })
  })

  it('forwards switch changes with the checked state as extra data', () => {
    const onAction = renderView(
      view([
        {
          type: 'switch',
          key: 's',
          label: '自动刷新',
          checked: false,
          onChange: { type: 'invoke', handler: 'toggle' },
        },
      ]),
    )
    fireEvent.click(screen.getByRole('switch'))
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'invoke', handler: 'toggle' }, { checked: true })
  })

  it('falls back to the default icon for unknown icon names without crashing', () => {
    renderView(
      view([
        {
          type: 'button',
          key: 'b',
          label: '打开',
          icon: 'not-a-real-icon',
          action: { type: 'invoke', handler: 'open' },
        },
      ]),
    )
    expect(screen.getByRole('button', { name: '打开' })).toBeTruthy()
  })

  it('renders list items with actions and keeps commit-on-blur inputs controlled host-side', () => {
    const onAction = renderView(
      view([
        {
          type: 'list',
          key: 'l',
          items: [
            {
              key: 'i1',
              title: '项目一',
              description: '描述',
              action: { type: 'invoke', handler: 'openItem', payload: { id: 1 } },
            },
          ],
        },
        {
          type: 'textInput',
          key: 'city',
          label: '城市',
          value: '东京',
          onChange: { type: 'invoke', handler: 'setCity' },
        },
      ]),
    )
    fireEvent.click(screen.getByText('项目一'))
    expect(onAction).toHaveBeenCalledWith({ type: 'invoke', handler: 'openItem', payload: { id: 1 } })

    const input = screen.getByLabelText('城市') as HTMLInputElement
    fireEvent.change(input, { target: { value: '京都' } })
    // Draft state is host-side; the plugin is only notified on commit (blur).
    expect(onAction).toHaveBeenCalledTimes(1)
    fireEvent.blur(input)
    expect(onAction).toHaveBeenCalledWith({ type: 'invoke', handler: 'setCity' }, { value: '京都' })
  })
})
