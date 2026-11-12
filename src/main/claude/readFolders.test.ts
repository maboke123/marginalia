import { describe, expect, it } from 'vitest'
import { claudeSettings } from '../config'
import { inReadFolder, withReadFolders } from './prompt'

const code = 'C:\\Users\\student\\code\\oss-project'

describe('folders Claude may read', () => {
  it('lets read tools into the folder and below, not next to it', () => {
    expect(inReadFolder({ file_path: `${code}\\src\\Main.java` }, [code])).toBe(true)
    expect(inReadFolder({ path: code }, [code])).toBe(true)
    expect(inReadFolder({ path: `${code.toUpperCase()}\\src` }, [code])).toBe(true)
    expect(inReadFolder({ path: `${code}-old\\src` }, [code])).toBe(false)
    expect(inReadFolder({ file_path: `${code}\\..\\secrets.txt` }, [code])).toBe(false)
    expect(inReadFolder({ pattern: '**/*.java' }, [code])).toBe(false)
    expect(inReadFolder({ path: 'src' }, [code])).toBe(false)
  })

  it('names the folders in the prompt only when there are any', () => {
    expect(withReadFolders('Prompt', [])).toBe('Prompt')
    expect(withReadFolders('Prompt', [code])).toContain(`- ${code}`)
  })

  it('keeps only absolute folders, once each', () => {
    const settings = claudeSettings({ readFolders: [code, code, 'relative\\dir', 3] })
    expect(settings.readFolders).toEqual([code])
    expect(claudeSettings({}).readFolders).toEqual([])
  })
})
