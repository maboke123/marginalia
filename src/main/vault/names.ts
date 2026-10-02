import { promises as fs } from 'fs'
import path from 'path'

export class VaultError extends Error {}

export const DATA_DIR = '.marginalia'
export const ORDER_FILE = '_order.json'
export const SIDECAR_SUFFIX = '.annotations.json'
export const ASSETS_DIR = 'assets'

const INVALID_CHARS = /[<>:"/\\|?*]/
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function validateName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new VaultError('Name cannot be empty')
  if (INVALID_CHARS.test(trimmed) || [...trimmed].some((c) => c.charCodeAt(0) < 32)) {
    throw new VaultError('Name cannot contain any of these characters: < > : " / \\ | ? *')
  }
  if (trimmed.endsWith('.')) throw new VaultError('Name cannot end with a dot')
  if (trimmed.startsWith('.')) throw new VaultError('Name cannot start with a dot')
  if (RESERVED.test(trimmed)) throw new VaultError(`"${trimmed}" is reserved by Windows`)
  if (trimmed === ORDER_FILE || trimmed.endsWith(SIDECAR_SUFFIX)) {
    throw new VaultError(`"${trimmed}" is used by the app itself`)
  }
  return trimmed
}

export function isHidden(name: string, isDir: boolean): boolean {
  if (name.startsWith('.')) return true
  if (isDir) return name === ASSETS_DIR
  return !/\.(md|pdf)$/i.test(name)
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * `New section`, `New section (2)`, `New section (3)`, ... until the name is free.
 * With `alsoFree`, the name plus each of those suffixes must be free too.
 */
export async function uniqueName(
  dir: string,
  base: string,
  ext = '',
  alsoFree: string[] = []
): Promise<string> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`
    const taken = await Promise.all(
      [name, ...alsoFree.map((suffix) => name + suffix)].map((p) => exists(path.join(dir, p)))
    )
    if (!taken.includes(true)) return name
  }
}

export function resolveInVault(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  const back = path.relative(root, abs)
  if (back === '..' || back.startsWith('..' + path.sep) || path.isAbsolute(back)) {
    throw new VaultError('Path is outside the vault')
  }
  return abs
}

export function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}
