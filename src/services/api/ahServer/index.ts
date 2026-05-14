import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../../types/message.js'
import type { Tools } from '../../../Tool.js'
import { toolToAPISchema } from '../../../utils/api.js'
import { logForDebugging } from '../../../utils/debug.js'
import {
  createAssistantAPIErrorMessage,
  normalizeContentFromAPI,
} from '../../../utils/messages.js'
import type { SDKAssistantMessageError } from '../../../entrypoints/agentSdkTypes.js'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import type { Options } from '../claude.js'
import {
  createAhServerChatCompletion,
  getAhServerResponseError,
} from '../../ahServerAuth.js'
import { unwrapSerializedTextBlock } from '../serializedTextBlock.js'

async function* parseSSE(response: Response): AsyncGenerator<unknown, void> {
  if (!response.body) {
    throw new Error('ah_server response did not include a body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    let splitAt = buffer.indexOf('\n\n')
    while (splitAt >= 0) {
      const frame = buffer.slice(0, splitAt)
      buffer = buffer.slice(splitAt + 2)
      const data = frame
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')

      if (data && data !== '[DONE]') {
        yield JSON.parse(data) as unknown
      }

      splitAt = buffer.indexOf('\n\n')
    }
  }

  const tail = buffer.trim()
  if (tail.startsWith('data:')) {
    const data = tail.slice(5).trimStart()
    if (data && data !== '[DONE]') {
      yield JSON.parse(data) as unknown
    }
  }
}

function isAnthropicStreamEvent(event: unknown): event is { type: string } {
  return Boolean(
    event &&
      typeof event === 'object' &&
      'type' in event &&
      typeof (event as { type?: unknown }).type === 'string',
  )
}

export async function* queryModelAhServer(
  messages: Message[],
  systemPrompt: SystemPrompt,
  tools: Tools,
  signal: AbortSignal,
  options: Options,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  try {
    const requestModel = options.model
    const toolSchemas = await Promise.all(
      tools.map(tool =>
        toolToAPISchema(tool, {
          getToolPermissionContext: options.getToolPermissionContext,
          tools,
          agents: options.agents,
          allowedAgentTypes: options.allowedAgentTypes,
          model: requestModel,
        }),
      ),
    )

    const standardTools = toolSchemas.filter(
      (tool): tool is BetaToolUnion & { type: string } => {
        const anyTool = tool as unknown as Record<string, unknown>
        return (
          anyTool.type !== 'advisor_20260301' &&
          anyTool.type !== 'computer_20250124'
        )
      },
    )

    logForDebugging(
      `[AH Server] Calling model=${requestModel}, messages=${messages.length}, tools=${standardTools.length}`,
    )

    const response = await createAhServerChatCompletion({
      body: {
        model: requestModel,
        messages,
        systemPrompt,
        tools: standardTools,
        toolChoice: options.toolChoice,
        stream: true,
        options: {
          maxOutputTokens: options.maxOutputTokensOverride,
          temperature: options.temperatureOverride,
          effort: options.effortValue,
          outputFormat: options.outputFormat,
        },
      },
      signal,
      fetchOverride: options.fetchOverride as unknown as typeof fetch,
    })

    if (!response.ok) {
      throw new Error(
        `request failed (${response.status}): ${await getAhServerResponseError(response)}`,
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream')) {
      throw new Error(
        `expected text/event-stream response, got ${contentType || 'unknown content type'}`,
      )
    }

    const contentBlocks: Record<number, any> = {}
    const collectedMessages: AssistantMessage[] = []
    let partialMessage: any
    let ttftMs = 0
    const start = Date.now()

    for await (const event of parseSSE(response)) {
      if (!isAnthropicStreamEvent(event)) continue

      if (event.type === 'error') {
        const errorMessage =
          typeof (event as any).error?.message === 'string'
            ? (event as any).error.message
            : 'ah_server returned a stream error'
        yield createAssistantAPIErrorMessage({
          content: `AH Server API Error: ${errorMessage}`,
          apiError: 'api_error',
          error: new Error(errorMessage) as unknown as SDKAssistantMessageError,
        })
        continue
      }

      switch (event.type) {
        case 'message_start':
          partialMessage = (event as any).message
          ttftMs = Date.now() - start
          break
        case 'content_block_start': {
          const index = (event as any).index
          const contentBlock = (event as any).content_block
          if (contentBlock?.type === 'tool_use') {
            contentBlocks[index] = { ...contentBlock, input: '' }
          } else if (contentBlock?.type === 'text') {
            contentBlocks[index] = { ...contentBlock, text: '' }
          } else if (contentBlock?.type === 'thinking') {
            contentBlocks[index] = {
              ...contentBlock,
              thinking: '',
              signature: '',
            }
          } else {
            contentBlocks[index] = { ...contentBlock }
          }
          break
        }
        case 'content_block_delta': {
          const index = (event as any).index
          const delta = (event as any).delta
          const block = contentBlocks[index]
          if (!block || !delta) break
          if (delta.type === 'text_delta') {
            block.text = (block.text ?? '') + (delta.text ?? '')
          } else if (delta.type === 'input_json_delta') {
            block.input = (block.input ?? '') + (delta.partial_json ?? '')
          } else if (delta.type === 'thinking_delta') {
            block.thinking = (block.thinking ?? '') + (delta.thinking ?? '')
          } else if (delta.type === 'signature_delta') {
            block.signature = (block.signature ?? '') + (delta.signature ?? '')
          }
          break
        }
        case 'content_block_stop': {
          const index = (event as any).index
          const block = contentBlocks[index]
          if (!block || !partialMessage) break
          const message: AssistantMessage = {
            message: {
              ...partialMessage,
              content: normalizeContentFromAPI(
                [unwrapSerializedTextBlock(block)],
                tools,
                options.agentId,
              ),
            },
            requestId: undefined,
            type: 'assistant',
            uuid: randomUUID(),
            timestamp: new Date().toISOString(),
          }
          collectedMessages.push(message)
          yield message
          break
        }
      }

      yield {
        type: 'stream_event',
        event,
        ...(event.type === 'message_start' ? { ttftMs } : undefined),
      } as StreamEvent
    }

    if (collectedMessages.length === 0) {
      logForDebugging('[AH Server] Stream completed without assistant blocks', {
        level: 'warn',
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logForDebugging(`[AH Server] Error: ${message}`, { level: 'error' })
    yield createAssistantAPIErrorMessage({
      content: `AH Server API Error: ${message}`,
      apiError: 'api_error',
      error: (error instanceof Error
        ? error
        : new Error(String(error))) as unknown as SDKAssistantMessageError,
    })
  }
}
