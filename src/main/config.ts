import { promises as fs } from 'fs'
import path from 'path'
import { DEFAULT_CLAUDE_SETTINGS, EFFORTS, MODELS, type ClaudeSettings } from '../shared/claude'
import { settingsFrom, type AppSettings } from '../shared/settings'
import { writeFileAtomic } from './vault/atomic'

const MAX_RECENT = 10

export type StoredClaudeSettings = Omit<ClaudeSettings, 'hasApiKey'>

interface AppConfig {
  recentVaults: string[]
  settings: AppSettings
  claude: StoredClaudeSettings
  /** Encrypted with Electron's safeStorage (DPAPI on Windows), base64. */
  apiKey: string | null
}

export function claudeSettings(raw: unknown): StoredClaudeSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_CLAUDE_SETTINGS
  const pick = <T>(list: readonly T[], value: unknown, fallback: T): T =>
    list.includes(value as T) ? (value as T) : fallback
  return {
    model: pick(MODELS, r.model, d.model),
    effort: pick(EFFORTS, r.effort, d.effort),
    askBeforeEditing: typeof r.askBeforeEditing === 'boolean' ? r.askBeforeEditing : true,
    webSearch: r.webSearch === true,
    instructions: typeof r.instructions === 'string' ? r.instructions : ''
  }
}

/** App-wide settings that do not belong to one vault, stored in Electron's userData folder. */
export class ConfigStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  async read(): Promise<AppConfig> {
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(await fs.readFile(this.file, 'utf8'))
    } catch {
      // Missing or damaged: start from defaults. It only holds recent vaults and preferences.
    }
    return {
      recentVaults: Array.isArray(parsed.recentVaults) ? parsed.recentVaults : [],
      settings: settingsFrom(parsed.settings),
      claude: claudeSettings(parsed.claude),
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : null
    }
  }

  /** Read-modify-write, one at a time. */
  update(change: (config: AppConfig) => AppConfig): Promise<void> {
    const run = this.queue.then(async () => {
      const next = change(await this.read())
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      await writeFileAtomic(this.file, JSON.stringify(next, null, 2) + '\n')
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  addRecentVault(root: string): Promise<void> {
    return this.update((config) => {
      const others = config.recentVaults.filter((p) => p.toLowerCase() !== root.toLowerCase())
      return { ...config, recentVaults: [root, ...others].slice(0, MAX_RECENT) }
    })
  }
}
