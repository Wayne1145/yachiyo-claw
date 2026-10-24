import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconCamera,
  IconCameraOff,
  IconChevronDown,
  IconChevronUp,
  IconMicrophone,
  IconMicrophoneOff,
  IconPhone,
  IconPhoneOff,
  IconVolume,
  IconVolumeOff,
} from '@tabler/icons-react'

export function RealtimeVoiceControls(props: {
  state: 'disconnected' | 'connecting' | 'connected'
  speaking: boolean
  microphoneMuted: boolean
  cameraEnabled: boolean
  muted: boolean
  level: number
  onCall(): void
  onMicrophone(): void
  onCamera(): void
  onMute(): void
}) {
  const { t } = useTranslation()
  const [compact, setCompact] = useState(false)
  const active = props.state !== 'disconnected'
  const status =
    props.state === 'connecting'
      ? '正在连接…'
      : !active
        ? '准备好后，开始通话'
        : props.microphoneMuted
          ? '麦克风已关闭'
          : props.speaking
            ? '八千代正在说话'
            : '正在聆听'
  return (
    <div className="yachiyo-realtime-console" data-compact={compact}>
      <div className="yachiyo-realtime-status">
        <span role="status">{t(status)}</span>
        <button
          type="button"
          className="yachiyo-realtime-fold"
          aria-label={String(t(compact ? '展开通话详情' : '收起通话详情'))}
          onClick={() => setCompact(!compact)}
        >
          {compact ? <IconChevronUp size={17} /> : <IconChevronDown size={17} />}
        </button>
      </div>
      {!compact && (
        <div
          className="yachiyo-realtime-volume"
          role="meter"
          aria-label={String(t('麦克风收音音量'))}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(props.level * 100)}
        >
          <span style={{ width: `${props.level * 100}%` }} />
        </div>
      )}
      <div className="yachiyo-realtime-actions">
        <button
          type="button"
          className="yachiyo-realtime-call"
          data-active={active}
          aria-label={String(t(active ? '结束通话' : '开始通话'))}
          onClick={props.onCall}
          aria-busy={props.state === 'connecting'}
        >
          {active ? <IconPhoneOff size={22} /> : <IconPhone size={22} />}
          <span>{t(props.state === 'connecting' ? '取消连接' : active ? '结束通话' : '开始通话')}</span>
        </button>
        <button
          type="button"
          aria-label={String(t(props.microphoneMuted ? '打开麦克风' : '关闭麦克风'))}
          aria-pressed={!props.microphoneMuted}
          onClick={props.onMicrophone}
        >
          {props.microphoneMuted ? <IconMicrophoneOff size={22} /> : <IconMicrophone size={22} />}
        </button>
        <button
          type="button"
          aria-label={String(t(props.cameraEnabled ? '关闭摄像头' : '打开摄像头'))}
          aria-pressed={props.cameraEnabled}
          onClick={props.onCamera}
        >
          {props.cameraEnabled ? <IconCamera size={22} /> : <IconCameraOff size={22} />}
        </button>
        <button
          type="button"
          aria-label={String(t(props.muted ? '打开通话声音' : '关闭通话声音'))}
          aria-pressed={!props.muted}
          onClick={props.onMute}
        >
          {props.muted ? <IconVolumeOff size={22} /> : <IconVolume size={22} />}
        </button>
      </div>
    </div>
  )
}

/** Preview never runs alongside native call capture; stopping it releases every track. */
export function RealtimeVadControl({
  value,
  level,
  connected,
  onChange,
}: {
  value: number
  level: number
  connected: boolean
  onChange(value: number): void
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState(false)
  const [previewLevel, setPreviewLevel] = useState(0)
  const [error, setError] = useState(false)
  const frame = useRef(0)
  useEffect(() => {
    if (!preview || connected) return
    let disposed = false
    let stream: MediaStream | undefined
    let audio: AudioContext | undefined
    setError(false)
    void navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true }, video: false })
      .then(async (media) => {
        if (disposed) {
          media.getTracks().forEach((track) => track.stop())
          return
        }
        stream = media
        audio = new AudioContext()
        await audio.resume()
        if (disposed) return
        const analyser = audio.createAnalyser()
        analyser.fftSize = 1024
        audio.createMediaStreamSource(media).connect(analyser)
        const samples = new Float32Array(analyser.fftSize)
        let lastAt = 0
        const update = (now: number) => {
          if (disposed) return
          if (now - lastAt > 90) {
            analyser.getFloatTimeDomainData(samples)
            const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
            setPreviewLevel(Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 0.000001)) + 60) / 60)))
            lastAt = now
          }
          frame.current = requestAnimationFrame(update)
        }
        frame.current = requestAnimationFrame(update)
      })
      .catch(() => {
        if (!disposed) {
          setError(true)
          setPreview(false)
        }
      })
    return () => {
      disposed = true
      cancelAnimationFrame(frame.current)
      stream?.getTracks().forEach((track) => track.stop())
      void audio?.close().catch(() => undefined)
      setPreviewLevel(0)
    }
  }, [preview, connected])
  const current = connected ? level : previewLevel
  return (
    <div className="yachiyo-vad-control">
      <label htmlFor="yachiyo-vad-threshold">
        {t('麦克风自动激活阈值')}
        <strong>{Math.round(value * 100)}%</strong>
      </label>
      <div className="yachiyo-vad-track">
        <div
          className="yachiyo-realtime-volume"
          role="meter"
          aria-label={String(t('当前收音音量'))}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(current * 100)}
        >
          <span style={{ width: `${current * 100}%` }} />
        </div>
        <input
          id="yachiyo-vad-threshold"
          aria-label={String(t('麦克风自动激活阈值'))}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      <small>{t('向左更灵敏，向右过滤噪音。音量仅供参考，实际断句由服务端判断。')}</small>
      {!connected && (
        <button type="button" className="yachiyo-realtime-test-mic" onClick={() => setPreview(!preview)}>
          {t(preview ? '停止测试麦克风' : '测试麦克风')}
        </button>
      )}
      {error && <small role="alert">{t('无法打开麦克风，请检查录音权限')}</small>}
    </div>
  )
}
