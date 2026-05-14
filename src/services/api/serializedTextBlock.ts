export function unwrapSerializedTextBlock(block: any): any {
  if (block?.type !== 'text' || typeof block.text !== 'string') return block
  const text = block.text.trim()
  if (!looksLikeSerializedTextBlock(text)) return block

  try {
    const parsed = JSON.parse(text) as unknown
    const unwrapped = extractSerializedTextBlockText(parsed)
    return unwrapped == null ? block : { ...block, text: unwrapped }
  } catch {
    return block
  }
}

function looksLikeSerializedTextBlock(text: string): boolean {
  return (
    text.startsWith('{"type":"text"') ||
    text.startsWith('{"type": "text"') ||
    text.startsWith('[{"type":"text"') ||
    text.startsWith('[{"type": "text"')
  )
}

function extractSerializedTextBlockText(value: unknown): string | null {
  if (Array.isArray(value)) {
    const texts = value
      .map(extractSerializedTextBlockText)
      .filter((text): text is string => text != null)
    return texts.length === value.length && texts.length > 0
      ? texts.join('\n')
      : null
  }

  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.type !== 'text' || typeof record.text !== 'string') return null

  const allowedKeys = new Set(['type', 'text', 'citations'])
  if (Object.keys(record).some(key => !allowedKeys.has(key))) return null

  return record.text
}
