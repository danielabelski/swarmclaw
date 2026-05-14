import type { GenerationModelPreference } from '@/lib/server/build-llm'
import type { AppSettings } from '@/types'

type DreamGenerationSettings = Pick<AppSettings, 'dreamProvider' | 'dreamModel' | 'dreamCredentialId' | 'dreamEndpoint'> | Record<string, unknown> | null | undefined

function optionalSettingString(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || undefined
}

export function resolveDreamGenerationPreference(settings: DreamGenerationSettings): GenerationModelPreference | undefined {
  const record = (settings || {}) as Record<string, unknown>
  const provider = optionalSettingString(record.dreamProvider)
  if (!provider) return undefined

  return {
    provider,
    model: optionalSettingString(record.dreamModel),
    credentialId: optionalSettingString(record.dreamCredentialId),
    apiEndpoint: optionalSettingString(record.dreamEndpoint),
  }
}
