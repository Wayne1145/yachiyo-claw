/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAndroidRetainedState } from './android-retained-state'

function RetainedInput({ stateKey }: { stateKey?: string }) {
  const [value, setValue] = useAndroidRetainedState(stateKey, '')
  return <input aria-label="draft" value={value} onChange={(event) => setValue(event.currentTarget.value)} />
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useAndroidRetainedState', () => {
  it('restores an unfinished draft in process without writing browser storage', () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
    const first = render(<RetainedInput stateKey="test:composer-draft" />)
    fireEvent.change(screen.getByRole('textbox', { name: 'draft' }), { target: { value: 'unfinished text' } })
    first.unmount()

    render(<RetainedInput stateKey="test:composer-draft" />)
    expect((screen.getByRole('textbox', { name: 'draft' }) as HTMLInputElement).value).toBe('unfinished text')
    expect(storageWrite).not.toHaveBeenCalled()
  })

  it('does not retain state when no Android retention key is supplied', () => {
    const first = render(<RetainedInput />)
    fireEvent.change(screen.getByRole('textbox', { name: 'draft' }), { target: { value: 'desktop draft' } })
    first.unmount()

    render(<RetainedInput />)
    expect((screen.getByRole('textbox', { name: 'draft' }) as HTMLInputElement).value).toBe('')
  })

  it('saves the old key and loads the new key across A to B to A switches', () => {
    const view = render(<RetainedInput stateKey="test:session-a" />)
    const draft = () => screen.getByRole('textbox', { name: 'draft' }) as HTMLInputElement
    fireEvent.change(draft(), { target: { value: 'alpha' } })

    view.rerender(<RetainedInput stateKey="test:session-b" />)
    expect(draft().value).toBe('')
    fireEvent.change(draft(), { target: { value: 'beta' } })

    view.rerender(<RetainedInput stateKey="test:session-a" />)
    expect(draft().value).toBe('alpha')
    view.rerender(<RetainedInput stateKey="test:session-b" />)
    expect(draft().value).toBe('beta')
  })
})
