import { Menu, UnstyledButton } from '@mantine/core'
import { IconChevronDown } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import {
  getSessionCharacter,
  listCharacterProfiles,
  selectSessionCharacter,
  type CharacterProfile,
} from '@/mobile/character-profiles'

export function CharacterSelector({ sessionId }: { sessionId?: string }) {
  const [profiles, setProfiles] = useState(listCharacterProfiles)
  const [selected, setSelected] = useState(() => getSessionCharacter(sessionId))
  useEffect(() => {
    const refresh = () => { setProfiles(listCharacterProfiles()); setSelected(getSessionCharacter(sessionId)) }
    window.addEventListener('yachiyo-characters-changed', refresh)
    window.addEventListener('yachiyo-session-character-changed', refresh)
    refresh()
    return () => {
      window.removeEventListener('yachiyo-characters-changed', refresh)
      window.removeEventListener('yachiyo-session-character-changed', refresh)
    }
  }, [sessionId])

  return (
    <Menu position="top-end" shadow="md">
      <Menu.Target>
        <UnstyledButton className="yachiyo-character-selector" aria-label="切换人格">
          <img src={selected.avatar} alt="" /><span>{selected.name}</span><IconChevronDown size={13} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        {profiles.map((profile: CharacterProfile) => (
          <Menu.Item
            key={profile.id}
            leftSection={<img src={profile.avatar} alt="" className="yachiyo-character-menu-avatar" />}
            onClick={() => { if (sessionId) void selectSessionCharacter(sessionId, profile); setSelected(profile) }}
          >{profile.name}</Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
