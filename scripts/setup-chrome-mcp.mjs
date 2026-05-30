#!/usr/bin/env node

/**
 * Unified Chrome MCP setup script.
 *
 * Usage:
 *   node scripts/setup-chrome-mcp.mjs           # Run full setup (fix-permissions → register → doctor)
 *   node scripts/setup-chrome-mcp.mjs doctor    # Run a single sub-command
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

if (process.env.AHCODE_SKIP_CHROME_MCP_SETUP === '1') {
  process.exit(0)
}

let cliPath
try {
  cliPath = require.resolve('@ahcode/mcp-chrome-bridge/dist/cli.js')
} catch {
  console.warn(
    '[setup-chrome-mcp] @ahcode/mcp-chrome-bridge not found, skipping Chrome MCP setup.',
  )
  process.exit(0)
}

const userArgs = process.argv.slice(2)

function getChromeMcpLogDir() {
  const home = homedir()
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Logs', 'mcp-chrome-bridge')
  }
  if (process.platform === 'win32') {
    return join(
      process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'),
      'mcp-chrome-bridge',
      'logs',
    )
  }
  return join(
    process.env.XDG_STATE_HOME || join(home, '.local', 'state'),
    'mcp-chrome-bridge',
    'logs',
  )
}

if (userArgs.length > 0) {
  // Forward single sub-command
  execFileSync('node', [cliPath, ...userArgs], { stdio: 'inherit' })
} else {
  // Full setup sequence
  const steps = [
    ['fix-permissions'],
    ['register', '--browser', 'chrome'],
    ['doctor'],
  ]

  mkdirSync(getChromeMcpLogDir(), { recursive: true })

  for (let i = 0; i < steps.length; i++) {
    const args = steps[i]
    const isLast = i === steps.length - 1
    if (isLast) console.log(`\n[${i + 1}/${steps.length}] ${args.join(' ')}`)
    execFileSync('node', [cliPath, ...args], {
      stdio: isLast ? 'inherit' : 'pipe',
    })
  }

  console.log('\nChrome MCP setup complete!')
}
