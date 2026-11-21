/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RealtimeVadControl, RealtimeVoiceControls } from './RealtimeVoiceControls'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
describe('Realtime call controls', () => {
  it('keeps call, microphone and camera actions available when details collapse', () => {
    const onMicrophone = vi.fn()
    render(
      <RealtimeVoiceControls
        state="connected"
        speaking={false}
        microphoneMuted={false}
        cameraEnabled={false}
        muted={false}
        level={0.6}
        onCall={vi.fn()}
        onMicrophone={onMicrophone}
        onCamera={vi.fn()}
        onMute={vi.fn()}
      />
    )
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('60')
    fireEvent.click(screen.getByRole('button', { name: '收起通话详情' }))
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByRole('button', { name: '结束通话' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开摄像头' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭麦克风' }))
    expect(onMicrophone).toHaveBeenCalledOnce()
  })
  it('overlays the live level and threshold on the same track', () => {
    const onChange = vi.fn()
    const { container } = render(<RealtimeVadControl value={0.5} level={0.72} connected onChange={onChange} />)
    expect(container.querySelector('.yachiyo-vad-track [role="meter"]')?.getAttribute('aria-valuenow')).toBe('72')
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.35' } })
    expect(onChange).toHaveBeenCalledWith(0.35)
    expect(screen.queryByRole('button', { name: '测试麦克风' })).toBeNull()
  })
})
