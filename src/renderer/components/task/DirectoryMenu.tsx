import { Flex, Menu, type MenuProps, Text, UnstyledButton } from '@mantine/core'
import { IconCheck, IconChevronDown, IconFolder, IconFolderPlus } from '@tabler/icons-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { TASK_DEFAULT_DIRECTORY } from '@shared/constants/task'
import platform from '@/platform'
import { recentDirectoriesStore, useRecentDirectories } from '@/stores/recentDirectoriesStore'

interface DirectoryMenuProps {
  currentDirectory: string
  onSelect: (path: string) => void
  menuProps?: Partial<MenuProps>
}

function getDirName(fullPath: string) {
  return fullPath.split('/').filter(Boolean).pop() || fullPath
}

export default function DirectoryMenu({ currentDirectory, onSelect, menuProps }: DirectoryMenuProps) {
  const { t } = useTranslation()
  const recentDirs = useRecentDirectories()
  const filteredDirs = recentDirs.filter((d) => d !== TASK_DEFAULT_DIRECTORY)
  const hasDirectory = currentDirectory !== TASK_DEFAULT_DIRECTORY

  const handleChooseDirectory = useCallback(async () => {
    if (!platform.openDirectoryDialog) return
    const result = await platform.openDirectoryDialog()
    if (result.canceled || !result.path) return
    recentDirectoriesStore.getState().addDirectory(result.path)
    onSelect(result.path)
  }, [onSelect])

  const handleSelectRecent = useCallback(
    (dir: string) => {
      recentDirectoriesStore.getState().addDirectory(dir)
      onSelect(dir)
    },
    [onSelect]
  )

  const dirName = getDirName(currentDirectory)

  return (
    <Menu position="top-start" shadow="md" width={280} {...menuProps}>
      <Menu.Target>
        <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
          {hasDirectory ? (
            <IconFolder size={16} className="text-[var(--chatbox-tint-secondary)] shrink-0" />
          ) : (
            <IconFolderPlus size={16} className="text-[var(--chatbox-tint-secondary)] shrink-0" />
          )}
          <Text size="sm" className="text-[var(--chatbox-tint-secondary)] truncate max-w-[160px]">
            {hasDirectory ? dirName : t('Add Directory')}
          </Text>
          <IconChevronDown size={14} className="text-[var(--chatbox-tint-tertiary)] shrink-0" />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        {hasDirectory && !filteredDirs.includes(currentDirectory) && (
          <>
            <Menu.Item
              leftSection={<IconFolder size={16} />}
              rightSection={<IconCheck size={16} color="var(--mantine-color-blue-5)" />}
              onClick={() => handleSelectRecent(currentDirectory)}
              styles={{ itemLabel: { overflow: 'hidden' } }}
            >
              <Flex direction="column" gap={0}>
                <Text size="sm" fw={500} truncate>
                  {getDirName(currentDirectory)}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  {currentDirectory}
                </Text>
              </Flex>
            </Menu.Item>
            {filteredDirs.length > 0 && <Menu.Divider />}
          </>
        )}
        {filteredDirs.length > 0 && (
          <>
            <Menu.Label>{t('Recent')}</Menu.Label>
            {filteredDirs.map((dir) => (
              <Menu.Item
                key={dir}
                leftSection={<IconFolder size={16} />}
                rightSection={
                  dir === currentDirectory ? <IconCheck size={16} color="var(--mantine-color-blue-5)" /> : null
                }
                onClick={() => handleSelectRecent(dir)}
                styles={{ itemLabel: { overflow: 'hidden' } }}
              >
                <Flex direction="column" gap={0}>
                  <Text size="sm" fw={500} truncate>
                    {getDirName(dir)}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {dir}
                  </Text>
                </Flex>
              </Menu.Item>
            ))}
            <Menu.Divider />
          </>
        )}
        <Menu.Item leftSection={<IconFolderPlus size={16} />} onClick={handleChooseDirectory}>
          {t('Choose a different folder')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
