import { Button, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { getSpeechSettings, saveSpeechSettings, type SpeechSettings } from '@/mobile/speech-settings'

export const Route = createFileRoute('/settings/speech')({ component: SpeechSettingsPage })

function SpeechSettingsPage() {
  const [value, setValue] = useState(getSpeechSettings)
  const patch = (next: Partial<SpeechSettings>) => setValue((current) => ({ ...current, ...next }))
  return (
    <main className="yachiyo-character-settings">
      <Title order={1}>语音服务</Title>
      <Text c="dimmed" mb="md">ASR 默认在手机本地识别；TTS 默认 Bing，失败时使用 Android 系统语音。</Text>
      <section className="yachiyo-character-editor">
        <Select label="ASR 提供商" value={value.asrProvider} data={[{value:'android-local',label:'Android 本地 SpeechRecognizer'},{value:'openai-compatible',label:'OpenAI 兼容 /audio/transcriptions'}]} onChange={(v) => v && patch({asrProvider:v as SpeechSettings['asrProvider']})} />
        <TextInput label="ASR 模型" value={value.asrModel} onChange={(e) => patch({asrModel:e.currentTarget.value})} />
        <Select label="TTS 提供商" value={value.ttsProvider} data={[{value:'bing',label:'Bing Edge 免费语音'},{value:'android-system',label:'Android 系统 TTS'},{value:'openai-compatible',label:'OpenAI 兼容 /audio/speech'}]} onChange={(v) => v && patch({ttsProvider:v as SpeechSettings['ttsProvider']})} />
        <TextInput label="TTS 模型" value={value.ttsModel} onChange={(e) => patch({ttsModel:e.currentTarget.value})} />
        <TextInput label="音色" value={value.voice} onChange={(e) => patch({voice:e.currentTarget.value})} />
        <Stack gap="xs"><Button onClick={() => saveSpeechSettings(value)}>保存语音设置</Button></Stack>
      </section>
    </main>
  )
}
