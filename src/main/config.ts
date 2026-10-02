import { promises as fs } from 'fs'
import path from 'path'
import { writeFileAtomic } from './vault/atomic'

const MAX_RECENT = 10

interface AppConfig {
  recentVaults: string[]
}

/** App-wide settings that do not belong to one vault, stored in Electron's userData folder. */
export class ConfigStore {
  constructor(private readonly file: string) {}

  async read(): Promise<AppConfig> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'))
      return { recentVaults: Array.isArray(parsed.recentVaults) ? parsed.recentVaults : [] }
    } catch {
      return { recentVaults: [] }
    }
  }

  async addRecentVault(root: string): Promise<void> {
    const config = await this.read()
    const others = config.recentVaults.filter((p) => p.toLowerCase() !== root.toLowerCase())
    config.recentVaults = [root, ...others].slice(0, MAX_RECENT)
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify(config, null, 2) + '\n')
  }
}
