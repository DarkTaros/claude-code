import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  UserMessage,
} from '../../../types/message.js'
import type { Tools } from '../../../Tool.js'
import { toolToAPISchema } from '../../../utils/api.js'
import { logForDebugging } from '../../../utils/debug.js'
import {
  createAssistantAPIErrorMessage,
  normalizeMessagesForAPI,
  normalizeContentFromAPI,
} from '../../../utils/messages.js'
import type { SDKAssistantMessageError } from '../../../entrypoints/agentSdkTypes.js'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import type { Options } from '../claude.js'
import {
  createAhServerChatCompletion,
  fetchAhServerModels,
  getAhServerResponseError,
} from '../../ahServerAuth.js'
import { unwrapSerializedTextBlock } from '../serializedTextBlock.js'
import {
  adaptOpenAIStreamToAnthropic,
  anthropicMessagesToOpenAI,
  anthropicToolChoiceToOpenAI,
  anthropicToolsToOpenAI,
} from '@ant/model-provider'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions.mjs'

const AH_SERVER_BOOTSTRAP_FALLBACK_MODEL = 'default'

async function resolveAhServerRequestModel(model: string): Promise<string> {
  if (model !== AH_SERVER_BOOTSTRAP_FALLBACK_MODEL) return model

  const response = await fetchAhServerModels()
  if (!response.defaultModel) {
    throw new Error(
      'AH Server model list is loaded but does not include a default model.',
    )
  }
  return response.defaultModel
}

function parseOpenAIChunkData(data: string): ChatCompletionChunk {
  const parsed = JSON.parse(data) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ah_server returned a non-object OpenAI chunk')
  }

  if ('error' in parsed) {
    const error = (parsed as { error?: { message?: unknown } }).error
    throw new Error(
      typeof error?.message === 'string'
        ? error.message
        : 'ah_server returned a stream error',
    )
  }

  const record = parsed as Record<string, unknown>
  if (
    record.object !== 'chat.completion.chunk' ||
    !Array.isArray(record.choices)
  ) {
    throw new Error('ah_server returned a non-OpenAI chat completion chunk')
  }

  return parsed as ChatCompletionChunk
}

async function* parseOpenAIChatCompletionSSE(
  response: Response,
): AsyncGenerator<ChatCompletionChunk, void> {
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

      if (!data && frame.trim()) {
        throw new Error('ah_server returned a malformed SSE frame')
      }

      if (data && data !== '[DONE]') {
        yield parseOpenAIChunkData(data)
      }

      splitAt = buffer.indexOf('\n\n')
    }
  }

  const tail = buffer.trim()
  if (tail.startsWith('data:')) {
    const data = tail.slice(5).trimStart()
    if (data && data !== '[DONE]') {
      yield parseOpenAIChunkData(data)
    }
  } else if (tail) {
    throw new Error('ah_server returned a malformed SSE frame')
  }
}

function isOpenAIConvertibleMessage(
  msg: Message,
): msg is AssistantMessage | UserMessage {
  return msg.type === 'assistant' || msg.type === 'user'
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
    const requestModel = await resolveAhServerRequestModel(options.model)
    const messagesForAPI = normalizeMessagesForAPI(messages, tools)
    const openAIConvertibleMessages = messagesForAPI.filter(
      isOpenAIConvertibleMessage,
    )
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
    const openaiMessages = anthropicMessagesToOpenAI(
      openAIConvertibleMessages,
      systemPrompt,
    )
    const openaiTools = anthropicToolsToOpenAI(standardTools)
    const openaiToolChoice = anthropicToolChoiceToOpenAI(options.toolChoice)

    logForDebugging(
      `[AH Server] Calling model=${requestModel}, messages=${openaiMessages.length}, tools=${openaiTools.length}`,
    )

    const response = await createAhServerChatCompletion({
      body: {
        model: requestModel,
        messages: openaiMessages,
        ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
        ...(openaiToolChoice ? { tool_choice: openaiToolChoice } : {}),
        stream: true,
        ...(typeof options.maxOutputTokensOverride === 'number'
          ? { max_tokens: options.maxOutputTokensOverride }
          : {}),
        ...(typeof options.temperatureOverride === 'number'
          ? { temperature: options.temperatureOverride }
          : {}),
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

    const adaptedStream = adaptOpenAIStreamToAnthropic(
      parseOpenAIChatCompletionSSE(response),
      requestModel,
    )
    for await (const event of adaptedStream) {
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
