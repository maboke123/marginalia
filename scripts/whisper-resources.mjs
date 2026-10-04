// Puts whisper.cpp, the small model and the VAD model in resources/whisper, which the
// installer ships (electron-builder.yml extraResources), so speech to text works without a
// download. Files are checked against the hashes in src/main/transcribe/parts.json; copies
// already downloaded by the app are reused. Usage: node scripts/whisper-resources.mjs
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { createReadStream, existsSync, promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const parts = JSON.parse(
  await fs.readFile(path.join(root, 'src/main/transcribe/parts.json'), 'utf8')
)
const target = path.join(root, 'resources', 'whisper')
const models = path.join(target, 'models')
const bin = path.join(target, 'bin', 'Release')
// Where the app downloads them; reused so a first build does not download again.
const appData = process.env.APPDATA ?? ''
const downloaded = ['Marginalia', 'marginalia-poc'].map((d) =>
  path.join(appData, d, 'whisper', 'models')
)

const sha256 = async (file) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function fetchTo(part, file) {
  const { url, sha256: expected } = parts[part]
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`)
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()))
  if ((await sha256(file)) !== expected) throw new Error(`Wrong hash for ${url}`)
}

await fs.mkdir(models, { recursive: true })
for (const part of ['small', 'vad']) {
  const { file, size, sha256: expected } = parts[part]
  const dest = path.join(models, file)
  const stat = await fs.stat(dest).catch(() => null)
  if (stat?.size === size) continue
  const local = downloaded.map((d) => path.join(d, file)).find((f) => existsSync(f))
  if (local && (await sha256(local)) === expected) {
    await fs.copyFile(local, dest)
    console.log(`${file}: copied from ${path.dirname(local)}`)
  } else {
    console.log(`${file}: downloading`)
    await fetchTo(part, dest)
  }
}

if (!existsSync(path.join(bin, 'whisper-cli.exe'))) {
  console.log('whisper.cpp: downloading')
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'whisper-'))
  const zip = path.join(temp, parts.program.file)
  await fetchTo('program', zip)
  // Windows' own tar unpacks zip files.
  execFileSync(path.join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'tar.exe'), [
    '-xf',
    zip,
    '-C',
    temp
  ])
  // Only the command-line program and its libraries; the zip also has tests and other tools.
  await fs.mkdir(bin, { recursive: true })
  const release = path.join(temp, 'Release')
  for (const name of await fs.readdir(release)) {
    if (name === 'whisper-cli.exe' || name.endsWith('.dll')) {
      await fs.copyFile(path.join(release, name), path.join(bin, name))
    }
  }
  await fs.rm(temp, { recursive: true, force: true })
}

const size = async (dir) => {
  let total = 0
  for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += (await fs.stat(path.join(e.parentPath, e.name))).size
  }
  return total
}
console.log(`Speech to text ready to ship: ${Math.round((await size(target)) / 1e6)} MB`)
