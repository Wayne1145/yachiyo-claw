import { t } from 'i18next'

export function getToolName(toolName: string): string {
  // Use translation keys that i18next cli can detect
  const toolNames: Record<string, string> = {
    query_knowledge_base: t('Query Knowledge Base'),
    get_files_meta: t('Get Files Meta'),
    read_file_chunks: t('Read File Chunks'),
    list_files: t('List Files'),
    web_search: t('Web Search'),
    file_search: t('File Search'),
    code_search: t('Code Search'),
    terminal: t('Terminal'),
    create_file: t('Create File'),
    edit_file: t('Edit File'),
    delete_file: t('Delete File'),
    read_file: t('Read File'),
    parse_link: t('Parse Link'),
  }

  return toolNames[toolName] || toolName
}
