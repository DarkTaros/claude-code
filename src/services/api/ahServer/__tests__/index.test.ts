import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type {
  AssistantMessage,
  StreamEvent,
} from '../../../../types/message.js'

let nextSSE = ''
let lastRequestBody: Record<string, any> | null = null

mock.module('../../../ahServerAuth.js', () => ({
  createAhServerChatCompletion: async (params: { body: unknown }) => {
    lastRequestBody = params.body as Record<string, any>
    return new Response(nextSSE, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    })
  },
  fetchAhServerModels: async () => ({
    models: [
      {
        id: 'public-model',
        name: 'Public Model',
      },
    ],
    defaultModel: 'public-model',
  }),
  getAhServerResponseError: async () => 'request failed',
}))

mock.module('../../../../utils/api.js', () => ({
  toolToAPISchema: async (tool: any) => tool,
}))

mock.module('../../../../utils/messages.js', () => ({
  normalizeMessagesForAPI: (messages: any) => messages,
  normalizeContentFromAPI: (blocks: any[]) => blocks,
  createAssistantAPIErrorMessage: (opts: any) => ({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: opts.content }],
      apiError: opts.apiError,
    },
    uuid: 'error-uuid',
    timestamp: new Date().toISOString(),
  }),
}))

mock.module('../../../../utils/debug.js', () => ({
  logForDebugging: () => {},
}))

function openAIChunk(data: Record<string, unknown>) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'public-model',
    ...data,
  })}\n\n`
}

async function collectAhServerOutputs(model = 'public-model') {
  const { queryModelAhServer } = await import('../index.js')
  const assistantMessages: AssistantMessage[] = []
  const streamEvents: StreamEvent[] = []

  for await (const item of queryModelAhServer(
    [
      {
        type: 'user',
        message: { role: 'user', content: 'hello' },
        uuid: 'user-uuid',
        timestamp: new Date().toISOString(),
      } as any,
    ],
    [] as any,
    [],
    new AbortController().signal,
    {
      model,
      tools: [],
      agents: [],
    } as any,
  )) {
    if (item.type === 'assistant') {
      assistantMessages.push(item as AssistantMessage)
    } else if (item.type === 'stream_event') {
      streamEvents.push(item as StreamEvent)
    }
  }

  return { assistantMessages, streamEvents }
}

beforeEach(() => {
  nextSSE = ''
  lastRequestBody = null
})

afterEach(() => {
  nextSSE = ''
  lastRequestBody = null
})

describe('queryModelAhServer', () => {
  test('sends OpenAI chat completion requests and consumes OpenAI text streams', async () => {
    nextSSE =
      openAIChunk({
        choices: [
          { index: 0, delta: { content: '收到' }, finish_reason: null },
        ],
      }) +
      openAIChunk({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }) +
      'data: [DONE]\n\n'

    const { assistantMessages } = await collectAhServerOutputs()

    expect(lastRequestBody).toMatchObject({
      model: 'public-model',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    })
    expect(assistantMessages).toHaveLength(1)
    expect((assistantMessages[0]!.message.content as any[])[0]).toMatchObject({
      type: 'text',
      text: '收到',
    })
  })

  test('resolves the startup default placeholder before sending requests', async () => {
    nextSSE =
      openAIChunk({
        choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
      }) +
      openAIChunk({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }) +
      'data: [DONE]\n\n'

    const { assistantMessages } = await collectAhServerOutputs('default')

    expect(lastRequestBody?.model).toBe('public-model')
    expect(assistantMessages).toHaveLength(1)
  })

  test('converts OpenAI tool_calls streams to internal tool_use events', async () => {
    nextSSE =
      openAIChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'bash', arguments: '{"command":"ls"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }) +
      openAIChunk({
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      }) +
      'data: [DONE]\n\n'

    const { streamEvents } = await collectAhServerOutputs()

    expect(
      streamEvents.some(
        event =>
          (event as any).event?.type === 'content_block_start' &&
          (event as any).event?.content_block?.type === 'tool_use' &&
          (event as any).event?.content_block?.name === 'bash',
      ),
    ).toBe(true)
  })

  test('rejects legacy Anthropic SSE instead of auto-detecting protocols', async () => {
    nextSSE =
      'event: message_start\n' +
      'data: {"type":"message_start","message":{"role":"assistant"}}\n\n'

    const { assistantMessages } = await collectAhServerOutputs()

    expect(assistantMessages).toHaveLength(1)
    expect((assistantMessages[0]!.message as any).apiError).toBe('api_error')
    expect(JSON.stringify(assistantMessages[0]!.message.content)).toContain(
      'non-OpenAI chat completion chunk',
    )
  })
})
