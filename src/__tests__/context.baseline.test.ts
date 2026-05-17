import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  resetStateForTests,
  setOriginalCwd,
  setProjectRoot,
} from '../bootstrap/state'
import {
  getSystemContext,
  getUserContext,
  setSystemPromptInjection,
} from '../context'
import { clearMemoryFileCaches } from '../utils/ahcodemd'
import {
  cleanupTempDir,
  createTempDir,
  writeTempFile,
} from '../../tests/mocks/file-system'

let tempDir = ''
let projectAhcodeMdContent = ''

beforeEach(async () => {
  tempDir = await createTempDir('context-baseline-')
  projectAhcodeMdContent = `baseline-${Date.now()}`

  resetStateForTests()
  setOriginalCwd(tempDir)
  setProjectRoot(tempDir)
  await writeTempFile(tempDir, 'AHCODE.md', projectAhcodeMdContent)

  clearMemoryFileCaches()
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
  setSystemPromptInjection(null)
  delete process.env.AHCODE_DISABLE_AHCODE_MDS
})

afterEach(async () => {
  clearMemoryFileCaches()
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
  setSystemPromptInjection(null)
  delete process.env.AHCODE_DISABLE_AHCODE_MDS
  resetStateForTests()
  if (tempDir) {
    await cleanupTempDir(tempDir)
  }
})

describe('context baseline', () => {
  test('getUserContext includes currentDate and project AHCODE.md content', async () => {
    const ctx = await getUserContext()

    expect(ctx.currentDate).toContain("Today's date is")
    expect(ctx.ahcodeMd).toContain(projectAhcodeMdContent)
  })

  test('AHCODE_DISABLE_AHCODE_MDS suppresses claudeMd loading', async () => {
    process.env.AHCODE_DISABLE_AHCODE_MDS = '1'

    const ctx = await getUserContext()

    expect(ctx.currentDate).toContain("Today's date is")
    expect(ctx.ahcodeMd).toBeUndefined()
  })

  test('setSystemPromptInjection clears the memoized user-context cache', async () => {
    const first = await getUserContext()
    process.env.AHCODE_DISABLE_AHCODE_MDS = '1'

    const second = await getUserContext()
    expect(first.ahcodeMd).toContain(projectAhcodeMdContent)
    expect(second.ahcodeMd).toContain(projectAhcodeMdContent)

    setSystemPromptInjection('cache-break')

    const third = await getUserContext()
    expect(third.ahcodeMd).toBeUndefined()
  })

  test('getSystemContext reflects system prompt injection after cache invalidation', async () => {
    const first = await getSystemContext()
    expect(first.gitStatus).toBeUndefined()
    expect(first.cacheBreaker).toBeUndefined()

    setSystemPromptInjection('baseline-cache-break')

    const second = await getSystemContext()
    if ('cacheBreaker' in second) {
      expect(second.cacheBreaker).toContain('baseline-cache-break')
    } else {
      expect(second.gitStatus).toBeUndefined()
    }
  })
})
