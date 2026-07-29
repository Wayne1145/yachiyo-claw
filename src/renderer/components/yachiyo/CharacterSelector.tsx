import { Menu, UnstyledButton } from '@mantine/core'
import { IconChevronDown } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getSessionCharacter,
  listCharacterProfiles,
  selectSessionCharacter,
  type CharacterProfile,
} from '@/mobile/character-profiles'

export function CharacterSelector({
  sessionId,
  compact = false,
  onOpen,
}: {
  sessionId?: string
  compact?: boolean
  onOpen?: () => void
}) {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState(listCharacterProfiles)
  const [selected, setSelected] = useState(() => getSessionCharacter(sessionId))
  useEffect(() => {
    const refresh = () => {
      setProfiles(listCharacterProfiles())
      setSelected(getSessionCharacter(sessionId))
    }
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
        <UnstyledButton
          className="yachiyo-character-selector"
          data-compact={compact ? 'true' : undefined}
          aria-label={t('切换人格')}
          title={compact ? selected.name : undefined}
          onClick={onOpen}
        >
          <img src={selected.avatar} alt="" />
          {!compact && <span>{selected.name}</span>}
          {!compact && <IconChevronDown size={13} />}
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown className="yachiyo-composer-popover yachiyo-composer-character-menu">
        {profiles.map((profile: CharacterProfile) => (
          <Menu.Item
            key={profile.id}
            leftSection={<img src={profile.avatar} alt="" className="yachiyo-character-menu-avatar" />}
            onClick={() => {
              if (sessionId) void selectSessionCharacter(sessionId, profile)
              setSelected(profile)
            }}
          >
            {profile.name}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
