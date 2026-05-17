import { stat } from 'fs/promises'
import { join } from 'path'

export const PLUGIN_MANIFEST_DIR = '.ahcode-plugin'
export const LEGACY_CLAUDE_PLUGIN_MANIFEST_DIR = '.claude-plugin'

const PLUGIN_MANIFEST_DIRS = [
  PLUGIN_MANIFEST_DIR,
  LEGACY_CLAUDE_PLUGIN_MANIFEST_DIR,
] as const

export function getPluginManifestPath(root: string, fileName: string): string {
  return join(root, PLUGIN_MANIFEST_DIR, fileName)
}

export function getPluginManifestCandidatePaths(
  root: string,
  fileName: string,
): string[] {
  return PLUGIN_MANIFEST_DIRS.map(dir => join(root, dir, fileName))
}

export async function findPluginManifestPath(
  root: string,
  fileName: string,
): Promise<string> {
  for (const candidate of getPluginManifestCandidatePaths(root, fileName)) {
    try {
      await stat(candidate)
      return candidate
    } catch {
      // Try the next manifest directory.
    }
  }
  return getPluginManifestPath(root, fileName)
}

export function hasPluginManifestDir(dirEntries: string[]): boolean {
  return PLUGIN_MANIFEST_DIRS.some(dir => dirEntries.includes(dir))
}
