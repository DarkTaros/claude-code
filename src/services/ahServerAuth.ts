import { z } from 'zod/v4'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'

export class AhServerConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AhServerConfigError'
  }
}

export class AhServerAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AhServerAuthError'
  }
}

export class AhServerHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AhServerHttpError'
    this.status = status
  }
}

export function isAhServerLoginStateInvalidError(error: unknown) {
  return (
    error instanceof AhServerConfigError ||
    error instanceof AhServerAuthError ||
    (error instanceof AhServerHttpError && error.status === 401)
  )
}

const startResponseSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUri: z.string(),
  expiresIn: z.number(),
  interval: z.number(),
  expiresAt: z.string(),
})

const tokenSuccessSchema = z.object({
  accessToken: z.string(),
  tokenType: z.string(),
  expiresAt: z.string(),
  expiresIn: z.number(),
  user: z
    .object({
      id: z.string(),
      email: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      picture: z.string().nullable().optional(),
    })
    .optional(),
})

const tokenErrorSchema = z.object({
  error: z.string(),
})

const cliModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  capabilities: z.record(z.string(), z.boolean()).optional(),
})

const cliModelsResponseSchema = z.object({
  models: z.array(cliModelSchema),
  defaultModel: z.string().nullable().optional(),
})

export type AhCliAuthStart = z.infer<typeof startResponseSchema>
export type AhCliAuthToken = z.infer<typeof tokenSuccessSchema>
export type AhCliModel = z.infer<typeof cliModelSchema>
export type AhCliModelsResponse = z.infer<typeof cliModelsResponseSchema>

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '')
}

export function getAhServerBaseUrl() {
  const baseUrl =
    process.env.AH_SERVER_BASE_URL?.trim() ||
    getSettings_DEPRECATED()?.ahServerAuth?.baseUrl?.trim()
  if (!baseUrl) {
    throw new AhServerConfigError(
      'Missing AH server URL. Set AH_SERVER_BASE_URL or run /login and choose AH SSO.',
    )
  }
  try {
    return normalizeBaseUrl(new URL(baseUrl).toString())
  } catch {
    throw new AhServerConfigError(
      'AH server URL must be a full URL, for example http://localhost:8787.',
    )
  }
}

export function getAhServerAccessToken() {
  const token = getSettings_DEPRECATED()?.ahServerAuth?.accessToken?.trim()
  if (!token) {
    throw new AhServerAuthError(
      'Missing AH SSO login. Run /login and choose AH SSO.',
    )
  }
  return token
}

export function getAhServerAuthHeaders(token = getAhServerAccessToken()) {
  return {
    authorization: `Bearer ${token}`,
  }
}

async function parseJsonResponse(response: Response) {
  try {
    return await response.json()
  } catch {
    throw new Error(
      `ah_server returned non-JSON response (${response.status}).`,
    )
  }
}

async function parseErrorResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const json = (await response.json()) as unknown
      if (json && typeof json === 'object') {
        const error = (json as { error?: unknown }).error
        if (typeof error === 'string') return error
        if (error && typeof error === 'object') {
          const message = (error as { message?: unknown }).message
          if (typeof message === 'string') return message
        }
      }
    } catch {
      // Fall through to text parsing below.
    }
  }
  const text = await response.text().catch(() => '')
  return text || response.statusText || `HTTP ${response.status}`
}

export async function startAhCliAuth(): Promise<
  AhCliAuthStart & { baseUrl: string }
> {
  const baseUrl = getAhServerBaseUrl()
  const response = await fetch(`${baseUrl}/api/cli/auth/start`, {
    method: 'POST',
    headers: { accept: 'application/json' },
  })

  const json = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(`ah_server login start failed (${response.status}).`)
  }

  const parsed = startResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error('ah_server login start response is invalid.')
  }

  return { ...parsed.data, baseUrl }
}

export async function pollAhCliAuthToken(params: {
  baseUrl: string
  deviceCode: string
  signal?: AbortSignal
}): Promise<AhCliAuthToken | 'authorization_pending'> {
  const response = await fetch(`${params.baseUrl}/api/cli/auth/token`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ device_code: params.deviceCode }),
    signal: params.signal,
  })

  const json = await parseJsonResponse(response)
  if (response.ok) {
    const parsed = tokenSuccessSchema.safeParse(json)
    if (!parsed.success) {
      throw new Error('ah_server token response is invalid.')
    }
    return parsed.data
  }

  const parsedError = tokenErrorSchema.safeParse(json)
  const error = parsedError.success
    ? parsedError.data.error
    : `http_${response.status}`
  if (error === 'authorization_pending') {
    return 'authorization_pending'
  }
  if (error === 'expired_token') {
    throw new Error('AH SSO login code expired. Please run /login again.')
  }
  if (error === 'access_denied') {
    throw new Error('AH SSO login was denied.')
  }
  throw new Error(`ah_server token request failed: ${error}`)
}

export async function fetchAhServerModels(params?: {
  baseUrl?: string
  token?: string
  signal?: AbortSignal
  fetchOverride?: typeof fetch
}): Promise<AhCliModelsResponse> {
  const baseUrl = params?.baseUrl ?? getAhServerBaseUrl()
  const fetchFn = params?.fetchOverride ?? (globalThis.fetch as typeof fetch)
  const response = await fetchFn(`${baseUrl}/api/cli/models`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...getAhServerAuthHeaders(params?.token),
    },
    signal: params?.signal,
  })

  if (!response.ok) {
    const message = `ah_server models request failed (${response.status}): ${await parseErrorResponse(response)}`
    throw new AhServerHttpError(response.status, message)
  }

  const json = await parseJsonResponse(response)
  const parsed = cliModelsResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error('ah_server models response is invalid.')
  }
  return parsed.data
}

export async function createAhServerChatCompletion(params: {
  body: unknown
  signal: AbortSignal
  fetchOverride?: typeof fetch
}): Promise<Response> {
  const baseUrl = getAhServerBaseUrl()
  const fetchFn = params.fetchOverride ?? (globalThis.fetch as typeof fetch)
  return fetchFn(`${baseUrl}/api/cli/chat/completions`, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream, application/json',
      'content-type': 'application/json',
      ...getAhServerAuthHeaders(),
    },
    body: JSON.stringify(params.body),
    signal: params.signal,
  })
}

export async function getAhServerResponseError(response: Response) {
  return parseErrorResponse(response)
}
