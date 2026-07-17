import { Button, Select, TextInput, Textarea } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { listCharacterProfiles, saveCharacterProfile, type CharacterProfile } from '@/mobile/character-profiles'

export const Route = createFileRoute('/settings/characters')({ component: CharactersSettings })

function CharactersSettings() {
  const [profiles, setProfiles] = useState(listCharacterProfiles)
  const [editing, setEditing] = useState<CharacterProfile>(profiles[0])
  const update = (patch: Partial<CharacterProfile>) => setEditing((current) => ({ ...current, ...patch }))
  const save = () => { saveCharacterProfile(editing); setProfiles(listCharacterProfiles()) }
  const create = () => setEditing({
    id: `character-${Date.now()}`, name: '新角色', avatar: '/live2d/yachiyo/avatar.png', prompt: '',
    live2dModelId: '', defaultTtsProvider: 'bing', defaultTtsModel: 'edge-read-aloud',
  })
  return (
    <main className="yachiyo-character-settings">
      <header><h1>角色设定</h1><Button size="xs" onClick={create}>新建角色</Button></header>
      <div className="yachiyo-character-cards">
        {profiles.map((profile) => (
          <button key={profile.id} type="button" data-selected={profile.id === editing.id} onClick={() => setEditing(profile)}>
            <img src={profile.avatar} alt="" /><span><strong>{profile.name}</strong><small>{profile.defaultLlmModel || '跟随对话模型'}</small></span>
          </button>
        ))}
      </div>
      <section className="yachiyo-character-editor">
        <TextInput label="名称" value={editing.name} onChange={(e) => update({ name: e.currentTarget.value })} />
        <TextInput label="头像地址或 data URL" value={editing.avatar} onChange={(e) => update({ avatar: e.currentTarget.value })} />
        <Textarea label="角色提示词" minRows={8} autosize value={editing.prompt} onChange={(e) => update({ prompt: e.currentTarget.value })} />
        <TextInput label="Live2D 模型 ID" value={editing.live2dModelId} onChange={(e) => update({ live2dModelId: e.currentTarget.value })} />
        <TextInput label="默认 LLM 模型" value={editing.defaultLlmModel || ''} onChange={(e) => update({ defaultLlmModel: e.currentTarget.value })} />
        <Select label="默认 TTS" value={editing.defaultTtsProvider} data={[{value:'bing',label:'Bing 免费语音'},{value:'android-system',label:'Android 系统 TTS'},{value:'openai-compatible',label:'OpenAI 兼容 TTS'}]} onChange={(value) => value && update({ defaultTtsProvider: value as CharacterProfile['defaultTtsProvider'] })} />
        <TextInput label="默认 TTS 模型/音色" value={editing.defaultTtsModel} onChange={(e) => update({ defaultTtsModel: e.currentTarget.value })} />
        <Button onClick={save}>保存角色</Button>
      </section>
    </main>
  )
}
