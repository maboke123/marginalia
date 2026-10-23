import { compartments, type CanvasNode, type Relation } from '../../../shared/canvas'

type Kind = Relation | 'arrow'

const HELP: Record<Kind, { label: string; meaning: string; read(a: string, b: string): string }> = {
  arrow: {
    label: 'Arrow',
    meaning: 'A plain arrow, without a UML meaning.',
    read: (a, b) => `from ${a} to ${b}`
  },
  association: {
    label: 'Association',
    meaning: 'The two know each other; numbers at the ends say how many.',
    read: (a, b) => `${a} is linked to ${b}`
  },
  directed: {
    label: 'Directed association',
    meaning: 'Only the start knows the end (it keeps a reference to it).',
    read: (a, b) => `${a} knows ${b}, not the other way round`
  },
  inheritance: {
    label: 'Inheritance',
    meaning:
      'The start is a subclass of the end and inherits what it has. Hollow triangle at the parent.',
    read: (a, b) => `${a} is a kind of ${b}`
  },
  realization: {
    label: 'Realization',
    meaning: 'The start implements the interface at the end. Dashed line, hollow triangle.',
    read: (a, b) => `${a} implements ${b}`
  },
  dependency: {
    label: 'Dependency',
    meaning: 'The start uses the end for a moment: a parameter, a local variable. Dashed line.',
    read: (a, b) => `${a} uses ${b}`
  },
  aggregation: {
    label: 'Aggregation',
    meaning:
      'The start is a whole, the end a part that can exist on its own. Hollow diamond at the whole.',
    read: (a, b) => `${a} has ${b}, which can exist without it`
  },
  composition: {
    label: 'Composition',
    meaning:
      'The start owns the end: the part lives and dies with the whole. Filled diamond at the whole.',
    read: (a, b) => `${a} owns ${b}, which cannot exist without it`
  }
}

export const relationLabel = (relation: Relation | undefined): string =>
  HELP[relation ?? 'arrow'].label

/** A box as named in a sentence: a class's name, the first line of other text. */
export function boxName(node: CanvasNode | undefined): string {
  if (!node) return 'this box'
  if (node.type === 'file') return node.file.split('/').pop()!
  if (node.type === 'group') return node.label || 'this group'
  if (node.type !== 'text') return 'this box'
  const head = node.shape === 'class' ? compartments(node.text)[0] : node.text
  const line = head
    .split('\n')
    .map((l) => l.replace(/[*_`#«»<>]/g, '').trim())
    .filter((l) => l && !/^(interface|abstract|enumeration)$/i.test(l))
    .pop()
  return line || 'this box'
}

/** What an arrow between two boxes says, as one sentence with their names. */
export function relationSentence(
  relation: Relation | undefined,
  from: CanvasNode | undefined,
  to: CanvasNode | undefined
): string {
  const help = HELP[relation ?? 'arrow']
  return `${help.label}: ${help.read(boxName(from), boxName(to))}.`
}

export const relationMeaning = (relation: Relation | undefined): string =>
  HELP[relation ?? 'arrow'].meaning
