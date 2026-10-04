import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { appendFeedback, ensureFeedbackFile } from './feedback'

describe('feedback', () => {
  it('appends checklist items under a header, keeping earlier ones', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-'))
    const file = path.join(dir, 'feedback.md')
    await appendFeedback(
      file,
      {
        text: 'Text tool cannot edit a box\n\nIt makes a new one instead',
        context: 'ML/B2.pdf, page 31'
      },
      new Date(2026, 9, 4, 14, 5)
    )
    await appendFeedback(file, { text: '  Sizes too big  ' }, new Date(2026, 9, 4, 15, 30))
    await ensureFeedbackFile(file)

    const text = await fs.readFile(file, 'utf8')
    expect(text).toMatch(/^# Marginalia feedback\n/)
    expect(text.split('# Marginalia feedback')).toHaveLength(2)
    expect(text).toContain(
      '\n- [ ] **2026-10-04 14:05** · ML/B2.pdf, page 31\n' +
        '  Text tool cannot edit a box\n\n  It makes a new one instead\n'
    )
    expect(text).toContain('\n- [ ] **2026-10-04 15:30**\n  Sizes too big\n')
    await fs.rm(dir, { recursive: true, force: true })
  })
})
