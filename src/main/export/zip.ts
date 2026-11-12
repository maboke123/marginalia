import { crc32, deflateRawSync } from 'zlib'

export interface ZipEntry {
  /** Path inside the zip, with forward slashes. */
  name: string
  data: Uint8Array
}

// DOS time and date of 1 January 2026 00:00: fixed, so the same files give the same zip.
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1

/** A zip file (deflated, UTF-8 names) of the entries, in their order. */
export function zipFiles(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const packed = deflateRawSync(entry.data)
    // PDFs barely compress; storing them as they are is smaller then.
    const deflated = packed.length < entry.data.length
    const body = deflated ? packed : Buffer.from(entry.data)
    const crc = crc32(entry.data)
    const header = (central: boolean): Buffer => {
      const b = Buffer.alloc(central ? 46 : 30)
      let at = 0
      const u32 = (v: number): void => {
        b.writeUInt32LE(v >>> 0, at)
        at += 4
      }
      const u16 = (v: number): void => {
        b.writeUInt16LE(v, at)
        at += 2
      }
      u32(central ? 0x02014b50 : 0x04034b50)
      if (central) u16(20)
      u16(20)
      u16(0x0800)
      u16(deflated ? 8 : 0)
      u16(DOS_TIME)
      u16(DOS_DATE)
      u32(crc)
      u32(body.length)
      u32(entry.data.length)
      u16(name.length)
      u16(0)
      if (central) {
        u16(0)
        u16(0)
        u16(0)
        u32(0)
        u32(offset)
      }
      return b
    }
    const local = Buffer.concat([header(false), name, body])
    locals.push(local)
    centrals.push(Buffer.concat([header(true), name]))
    offset += local.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
