import { describe, expect, test } from 'bun:test'
import { unwrapSerializedTextBlock } from '../serializedTextBlock.js'

describe('unwrapSerializedTextBlock', () => {
  test('unwraps a serialized text content block', () => {
    const block = {
      type: 'text',
      text: JSON.stringify({
        type: 'text',
        text: '可以，有接近一键的做法。\n\n```bash\njava -version\n```',
      }),
    }

    expect(unwrapSerializedTextBlock(block)).toEqual({
      type: 'text',
      text: '可以，有接近一键的做法。\n\n```bash\njava -version\n```',
    })
  })

  test('leaves normal text and unrelated JSON untouched', () => {
    const normal = { type: 'text', text: 'plain answer' }
    const json = { type: 'text', text: '{"ok":true}' }

    expect(unwrapSerializedTextBlock(normal)).toBe(normal)
    expect(unwrapSerializedTextBlock(json)).toBe(json)
  })
})
