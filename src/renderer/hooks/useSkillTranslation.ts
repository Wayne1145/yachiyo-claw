import type { SkillInfo } from '@shared/types/skills'
import { useCallback, useEffect, useRef, useState } from 'react'
import { translateTexts } from '@/packages/translation'
import { settingsStore, useLanguage, useSettingsStore } from '@/stores/settingsStore'

interface UseSkillTranslationResult {
  translatedSkills: SkillInfo[]
  getTranslatedName: (skill: SkillInfo) => string | undefined
  isTranslating: boolean
  translationEnabled: boolean
  toggleTranslation: () => void
}

function getSkillTranslationKey(skill: SkillInfo): string {
  return skill.isBuiltin ? `builtin:${skill.name}` : `user:${skill.path}`
}

export function useSkillTranslation(skills: SkillInfo[]): UseSkillTranslationResult {
  const language = useLanguage()
  const translationEnabled = useSettingsStore((state) => state.skills?.translationEnabled ?? true)
  const [translatedSkills, setTranslatedSkills] = useState<SkillInfo[]>(skills)
  const [translatedNameMap, setTranslatedNameMap] = useState<Map<string, string>>(new Map())
  const [isTranslating, setIsTranslating] = useState(false)
  const cacheRef = useRef<Map<string, string>>(new Map())

  const toggleTranslation = () => {
    settingsStore.setState((state) => ({
      skills: {
        ...state.skills,
        translationEnabled: !state.skills?.translationEnabled,
      },
    }))
  }

  useEffect(() => {
    if (!translationEnabled || language === 'en') {
      setTranslatedSkills(skills)
      setTranslatedNameMap(new Map())
      setIsTranslating(false)
      return
    }

    let cancelled = false

    const translateSkills = async () => {
      setIsTranslating(true)

      try {
        const uncachedNames: string[] = []
        const uncachedNameKeys: string[] = []
        const uncachedDescriptions: string[] = []
        const uncachedKeys: string[] = []

        for (const skill of skills) {
          const translationKey = getSkillTranslationKey(skill)

          const nameCacheKey = `name:${translationKey}:${language}:${skill.name}`
          if (!cacheRef.current.has(nameCacheKey)) {
            uncachedNames.push(skill.name)
            uncachedNameKeys.push(nameCacheKey)
          }

          const descriptionCacheKey = `description:${translationKey}:${language}:${skill.description}`
          if (!cacheRef.current.has(descriptionCacheKey)) {
            uncachedDescriptions.push(skill.description)
            uncachedKeys.push(descriptionCacheKey)
          }
        }

        if (uncachedNames.length > 0) {
          const translatedNames = await translateTexts(uncachedNames, language)
          if (cancelled) return
          for (let i = 0; i < uncachedNameKeys.length; i++) {
            cacheRef.current.set(uncachedNameKeys[i], translatedNames[i] ?? uncachedNames[i])
          }
        }

        if (uncachedDescriptions.length > 0) {
          const translatedDescriptions = await translateTexts(uncachedDescriptions, language)
          if (cancelled) return
          for (let i = 0; i < uncachedKeys.length; i++) {
            cacheRef.current.set(uncachedKeys[i], translatedDescriptions[i] ?? uncachedDescriptions[i])
          }
        }

        if (cancelled) return

        const nameMap = new Map<string, string>()
        const allTranslated = skills.map((skill) => {
          const translationKey = getSkillTranslationKey(skill)
          const nameCacheKey = `name:${translationKey}:${language}:${skill.name}`
          const descriptionCacheKey = `description:${translationKey}:${language}:${skill.description}`

          const translatedName = cacheRef.current.get(nameCacheKey)
          if (translatedName && translatedName !== skill.name) {
            nameMap.set(translationKey, translatedName)
          }

          const translatedDescription = cacheRef.current.get(descriptionCacheKey)
          return {
            ...skill,
            description: translatedDescription ?? skill.description,
          }
        })

        setTranslatedNameMap(nameMap)
        setTranslatedSkills(allTranslated)
      } catch {
        if (!cancelled) {
          setTranslatedNameMap(new Map())
          setTranslatedSkills(skills)
        }
      } finally {
        if (!cancelled) {
          setIsTranslating(false)
        }
      }
    }

    void translateSkills()

    return () => {
      cancelled = true
    }
  }, [skills, language, translationEnabled])

  const getTranslatedName = useCallback(
    (skill: SkillInfo) => {
      return translatedNameMap.get(getSkillTranslationKey(skill))
    },
    [translatedNameMap]
  )

  return {
    translatedSkills,
    getTranslatedName,
    isTranslating,
    translationEnabled,
    toggleTranslation,
  }
}
