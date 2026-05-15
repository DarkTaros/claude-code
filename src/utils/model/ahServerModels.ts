import { getGlobalConfig } from '../config.js'

const AH_SERVER_BOOTSTRAP_FALLBACK_MODEL = 'default'

export function getCachedAhServerModelIds(): string[] {
  return (getGlobalConfig().additionalModelOptionsCache ?? [])
    .map(option => option.value)
    .filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    )
}

export function getCachedAhServerDefaultModel(): string | undefined {
  return getCachedAhServerModelIds()[0]
}

export function isCachedAhServerModel(model: unknown): model is string {
  return (
    typeof model === 'string' && getCachedAhServerModelIds().includes(model)
  )
}

export function assertCachedAhServerModel(model: unknown): string {
  if (isCachedAhServerModel(model)) return model
  const modelList = getCachedAhServerModelIds()
  if (modelList.length === 0) {
    if (model === AH_SERVER_BOOTSTRAP_FALLBACK_MODEL) {
      return AH_SERVER_BOOTSTRAP_FALLBACK_MODEL
    }
    throw new Error(
      'AH Server model list is not loaded. Check AH_SERVER_BASE_URL and run /login again.',
    )
  }
  throw new Error(
    `Model "${String(model)}" is not available from AH Server. Run /model and choose one of: ${modelList.join(', ')}.`,
  )
}

export function requireCachedAhServerDefaultModel(): string {
  const model = getCachedAhServerDefaultModel()
  if (!model) {
    return AH_SERVER_BOOTSTRAP_FALLBACK_MODEL
  }
  return model
}
