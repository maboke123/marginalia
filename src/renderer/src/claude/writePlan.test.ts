import { describe, expect, it } from 'vitest'
import { applyChanges, mapPosition, parseAnswer, placeInsert, planWrite } from './writePlan'

const apply = applyChanges

describe('parseAnswer', () => {
  it('takes plain text as new text', () => {
    expect(parseAnswer('$\\alpha^*$')).toEqual({ insert: '$\\alpha^*$', edits: [] })
    expect(parseAnswer('```markdown\n$x$\n```')).toEqual({ insert: '$x$', edits: [] })
  })

  it('keeps the fence of a chart or code', () => {
    const chart = '```mermaid\ngraph TD\n  A-->B\n```'
    expect(parseAnswer(chart).insert).toBe(chart)
  })

  it('reads FIND/REPLACE blocks with LaTeX left as it is', () => {
    const answer = [
      '<<<<<<< FIND',
      'Update rule: $x_{k+1} = x_k - \\alpha \\nabla f(x_k)$',
      '=======',
      'Update rule: $v_{k+1} = \\beta v_k + \\nabla f(x_k)$',
      '>>>>>>> REPLACE',
      '<<<<<<< FIND',
      'Old remark.',
      '=======',
      '>>>>>>> REPLACE',
      'With $\\beta = 0.9$.'
    ].join('\n')
    expect(parseAnswer(answer)).toEqual({
      insert: 'With $\\beta = 0.9$.',
      edits: [
        {
          find: 'Update rule: $x_{k+1} = x_k - \\alpha \\nabla f(x_k)$',
          replace: 'Update rule: $v_{k+1} = \\beta v_k + \\nabla f(x_k)$'
        },
        { find: 'Old remark.', replace: '' }
      ]
    })
  })
})

describe('planWrite', () => {
  const note = 'Rule: $x - \\alpha g$\nOld remark.\n/claude use momentum\n'
  const request = { from: note.indexOf('/claude'), to: note.indexOf('\n', note.indexOf('/claude')) }

  it('changes the text above and takes out a request line that adds nothing', () => {
    const { changes, missing } = planWrite(note, request, {
      insert: '',
      edits: [{ find: '$x - \\alpha g$', replace: '$x - \\alpha v$' }]
    })
    expect(missing).toEqual([])
    expect(apply(note, changes)).toBe('Rule: $x - \\alpha v$\nOld remark.\n')
  })

  it('removes text and adds new text in one go', () => {
    const { changes } = planWrite(note, request, {
      insert: 'Momentum: $v = \\beta v + g$',
      edits: [{ find: 'Old remark.\n', replace: '' }]
    })
    expect(apply(note, changes)).toBe('Rule: $x - \\alpha g$\nMomentum: $v = \\beta v + g$\n')
  })

  it('picks the occurrence nearest the request and tolerates spacing', () => {
    const text = '$a$ first\n\n$a$ second\n/claude change it\n'
    const req = { from: text.indexOf('/claude'), to: text.length - 1 }
    const { changes } = planWrite(text, req, {
      insert: '',
      edits: [{ find: '$a$  second', replace: '$b$ second' }]
    })
    expect(apply(text, changes)).toBe('$a$ first\n\n$b$ second\n')
  })

  it('keeps a cursor in place through the changes', () => {
    const changes = [
      { from: 2, to: 5, insert: 'abcdef' },
      { from: 10, to: 12, insert: '' }
    ]
    expect(applyChanges('0123456789AB', changes)).toBe('01abcdef56789')
    expect(mapPosition(1, changes)).toBe(1)
    expect(mapPosition(7, changes)).toBe(10)
    expect(mapPosition(12, changes)).toBe(13)
  })

  it('reports what it cannot find instead of guessing', () => {
    const { changes, missing } = planWrite(note, request, {
      insert: 'x',
      edits: [{ find: 'not in the note', replace: 'y' }]
    })
    expect(missing).toEqual(['not in the note'])
    expect(changes).toHaveLength(1)
  })
})

describe('placeInsert', () => {
  const at = (text: string): number => text.indexOf('/claude')

  it('leaves a one-line answer where the request was', () => {
    const text = 'Rule: /claude formula'
    expect(placeInsert(text, at(text), '$x$')).toBe('$x$')
  })

  it('puts a block after text on its own line', () => {
    const text = 'Risk /claude formula'
    expect(placeInsert(text, at(text), '$$\nR\n$$')).toBe('\n\n$$\nR\n$$')
    expect(placeInsert(text, at(text), '| a |\n| - |')).toBe('\n\n| a |\n| - |')
  })

  it('keeps a block inside the list item of the request', () => {
    const item = '\t- Online: 24 Oct /claude chart'
    expect(placeInsert(item, at(item), '```mermaid\ngraph TD\n```')).toBe(
      '\n\t  ```mermaid\n\t  graph TD\n\t  ```'
    )
    const indented = '- item\n\n    /claude more'
    expect(placeInsert(indented, at(indented), 'a\n\nb')).toBe('a\n\n    b')
  })
})
