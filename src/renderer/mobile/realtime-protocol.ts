import { normalizeVadThreshold, type RealtimeSettings } from './realtime-settings'
export interface RealtimeHistoryItem {
  role: 'user' | 'assistant'
  text: string
}

export function realtimeHistoryEvent(protocol: RealtimeSettings['protocol'], item: RealtimeHistoryItem) {
  return {
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: item.role,
      content: [
        { type: item.role === 'user' ? 'input_text' : protocol === 'openai' ? 'output_text' : 'text', text: item.text },
      ],
    },
  }
}

export function realtimeEndpoint(settings: RealtimeSettings): string {
  const url = new URL(settings.endpoint)
  if (url.protocol !== 'wss:' || url.username || url.password || url.hash) throw new Error('realtime_wss_required')
  for (const key of url.searchParams.keys())
    if (/key|token|auth/i.test(key)) throw new Error('realtime_credentials_in_url_forbidden')
  if (!settings.model.trim()) throw new Error('realtime_model_required')
  url.searchParams.set('model', settings.model.trim())
  return url.href
}

export function realtimeSessionUpdate(settings: RealtimeSettings, instructions: string, tools: unknown[] = []) {
  const common = { instructions, tools, tool_choice: 'auto' }
  if (settings.protocol === 'dashscope')
    return {
      type: 'session.update',
      session: {
        ...common,
        modalities: ['text', 'audio'],
        voice: settings.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'gummy-realtime-v1' },
        turn_detection: realtimeTurnDetection(settings.vadThreshold),
      },
    }
  return {
    type: 'session.update',
    session: {
      ...common,
      type: 'realtime',
      model: settings.model,
      output_modalities: ['audio'],
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'gpt-4o-mini-transcribe' },
          turn_detection: realtimeTurnDetection(settings.vadThreshold),
        },
        output: { format: { type: 'audio/pcm', rate: 24000 }, voice: settings.voice },
      },
    },
  }
}

function realtimeTurnDetection(threshold: number) {
  return {
    type: 'server_vad',
    threshold: normalizeVadThreshold(threshold),
    prefix_padding_ms: 300,
    silence_duration_ms: 650,
  }
}
export function realtimeVadUpdate(protocol: RealtimeSettings['protocol'], threshold: number) {
  const turn_detection = realtimeTurnDetection(threshold)
  return {
    type: 'session.update',
    session: protocol === 'dashscope' ? { turn_detection } : { type: 'realtime', audio: { input: { turn_detection } } },
  }
}

export function realtimeImageEvent(protocol: RealtimeSettings['protocol'], data: string) {
  return protocol === 'dashscope'
    ? { type: 'input_image_buffer.append', image: data }
    : {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${data}` }],
        },
      }
}

export function realtimeTextEvent(text: string, id?: string) {
  return {
    type: 'conversation.item.create',
    item: { type: 'message', ...(id ? { id } : {}), role: 'user', content: [{ type: 'input_text', text }] },
  }
}
