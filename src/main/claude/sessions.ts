import { existsSync } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

/** Claude Code keeps conversations in one folder per working directory under this. */
export function projectsDir(env: NodeJS.ProcessEnv = process.env): string {
  const config = env['CLAUDE_CONFIG_DIR']?.trim()
  return path.join(config || path.join(os.homedir(), '.claude'), 'projects')
}

// Longer names get a hash suffix from the CLI that is not worth copying here.
const MAX_KEY = 200

/** The CLI's folder name for a working directory, or null when it would be hashed. */
export function projectKey(cwd: string): string | null {
  const key = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  return key.length <= MAX_KEY ? key : null
}

/** The project folder that holds a conversation, or null. */
export async function findSession(root: string, sessionId: string): Promise<string | null> {
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const dir of dirs) {
    if (dir.isDirectory() && existsSync(path.join(root, dir.name, `${sessionId}.jsonl`))) {
      return path.join(root, dir.name)
    }
  }
  return null
}

/**
 * Moves a conversation to the conversations of another folder, where the VS Code extension
 * lists it. The CLI resumes a conversation from any folder and keeps writing where the file
 * is, so the app and VS Code go on in the very same chat. Returns false when it cannot.
 */
export async function moveSession(root: string, sessionId: string, cwd: string): Promise<boolean> {
  const key = projectKey(cwd)
  if (!key) return false
  const from = await findSession(root, sessionId)
  if (!from) return false
  const to = path.join(root, key)
  // NTFS ignores case, and the CLI and VS Code differ in the case of the drive letter.
  if (from.toLowerCase() === to.toLowerCase()) return true
  await fs.mkdir(to, { recursive: true })
  const file = `${sessionId}.jsonl`
  if (existsSync(path.join(to, file))) return false
  await fs.rename(path.join(from, file), path.join(to, file))
  // Subagent transcripts and large tool results of the conversation live next to it.
  const extra = path.join(from, sessionId)
  if (existsSync(extra) && !existsSync(path.join(to, sessionId))) {
    await fs.rename(extra, path.join(to, sessionId))
  }
  return true
}
