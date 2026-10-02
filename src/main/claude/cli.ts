import { app, safeStorage } from 'electron'
import path from 'path'
import type { ConfigStore } from '../config'
import { VaultError } from '../vault/names'

/**
 * The Claude Code CLI that ships with the Agent SDK. Used by the chat (through the SDK) and
 * by the terminal tab. In the installed app it sits in app.asar.unpacked, because Windows
 * cannot start an .exe from inside app.asar (electron-builder's asarUnpack puts it there).
 */
export function claudeExecutable(): string {
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`
  const dir = path.dirname(require.resolve(`${pkg}/package.json`))
  const file = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude')
  return app.isPackaged ? file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) : file
}

/** The API key saved in settings, if any. */
export async function storedApiKey(config: ConfigStore): Promise<string | null> {
  const { apiKey } = await config.read()
  if (!apiKey) return null
  try {
    return safeStorage.decryptString(Buffer.from(apiKey, 'base64'))
  } catch {
    throw new VaultError('The stored API key cannot be read on this account; enter it again')
  }
}

/** Environment for the CLI: my login, or the key from settings, never a key from Windows. */
export function claudeEnvironment(apiKey: string | null): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: `marginalia-poc/${app.getVersion()}`
  }
  // Set when the app is started from a Claude Code terminal; the CLI would think it is nested.
  delete env.CLAUDECODE
  delete env.ELECTRON_RUN_AS_NODE
  // A key in the environment would silently switch billing from the subscription to the API.
  // Only a key entered in the app's settings is used.
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey
  else delete env.ANTHROPIC_API_KEY
  return env
}
