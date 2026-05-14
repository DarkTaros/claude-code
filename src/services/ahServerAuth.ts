import { z } from 'zod/v4'

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

export type AhCliAuthStart = z.infer<typeof startResponseSchema>
export type AhCliAuthToken = z.infer<typeof tokenSuccessSchema>

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '')
}

function getAhServerBaseUrl() {
  const baseUrl = process.env.AH_SERVER_BASE_URL?.trim()
  if (!baseUrl) {
    throw new Error(
      'Missing AH_SERVER_BASE_URL. Set it to your ah_server URL, for example http://localhost:8787.',
    )
  }
  try {
    return normalizeBaseUrl(new URL(baseUrl).toString())
  } catch {
    throw new Error(
      'AH_SERVER_BASE_URL must be a full URL, for example http://localhost:8787.',
    )
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
