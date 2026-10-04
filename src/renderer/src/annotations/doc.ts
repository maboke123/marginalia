import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  EMPTY_PAGE,
  type AnnotationPages,
  type Highlight,
  type PageAnnotations,
  type PageImage,
  type Stroke,
  type TextBox
} from '../../../shared/annotations'

export type Kind = 'strokes' | 'highlights' | 'textBoxes' | 'images'

export interface ItemOfKind {
  strokes: Stroke
  highlights: Highlight
  textBoxes: TextBox
  images: PageImage
}

export interface Selection {
  page: number
  kind: Kind
  id: string
}

/** An annotation Claude proposes, drawn faintly until it is accepted or rejected. */
export interface Ghost {
  page: number
  textBox?: TextBox
  highlight?: Highlight
  decide(accept: boolean): void
}

const HISTORY_LIMIT = 200

export interface DocState {
  pages: AnnotationPages
  past: AnnotationPages[]
  future: AnnotationPages[]
  selection: Selection | null
  /** Text box whose Markdown is being typed. */
  editing: Selection | null
  ghost: Ghost | null

  /** Applies one change as one undo step. */
  change(fn: (pages: AnnotationPages) => AnnotationPages): void
  /**
   * For drags and typing: `begin`, any number of `update`s, then `end` (one undo step if
   * anything changed) or `cancel` (back to how it was at `begin`, no undo step).
   */
  begin(): void
  update(fn: (pages: AnnotationPages) => AnnotationPages): void
  end(): void
  cancel(): void
  undo(): void
  redo(): void
  select(selection: Selection | null): void
  edit(selection: Selection | null): void
  setGhost(ghost: Ghost | null): void
}

export type AnnotationDoc = StoreApi<DocState>

export function createAnnotationDoc(pages: AnnotationPages): AnnotationDoc {
  let snapshot: AnnotationPages | null = null

  return createStore<DocState>((set, get) => {
    function push(previous: AnnotationPages, next: AnnotationPages): void {
      if (previous === next) return
      set({ pages: next, past: [...get().past, previous].slice(-HISTORY_LIMIT), future: [] })
    }

    // After undo or redo the selected item may no longer exist.
    function validSelection(pages: AnnotationPages): Selection | null {
      const s = get().selection
      return s && findItem(pages, s) ? s : null
    }

    return {
      pages,
      past: [],
      future: [],
      selection: null,
      editing: null,
      ghost: null,

      change: (fn) => push(get().pages, fn(get().pages)),

      begin() {
        snapshot = get().pages
      },
      update: (fn) => set({ pages: fn(get().pages) }),
      end() {
        if (snapshot) push(snapshot, get().pages)
        snapshot = null
      },
      cancel() {
        if (snapshot) set({ pages: snapshot })
        snapshot = null
      },

      undo() {
        const { past, pages, future } = get()
        if (!past.length) return
        const previous = past[past.length - 1]
        set({
          pages: previous,
          past: past.slice(0, -1),
          future: [pages, ...future],
          selection: validSelection(previous),
          editing: null
        })
      },
      redo() {
        const { past, pages, future } = get()
        if (!future.length) return
        const [next, ...rest] = future
        set({
          pages: next,
          past: [...past, pages],
          future: rest,
          selection: validSelection(next),
          editing: null
        })
      },

      select: (selection) => set({ selection }),
      edit: (editing) => set({ editing, selection: editing }),
      setGhost: (ghost) => set({ ghost })
    }
  })
}

export function pageOf(pages: AnnotationPages, page: number): PageAnnotations {
  return pages[String(page)] ?? EMPTY_PAGE
}

/** Returns new pages with one page changed; pages left empty are dropped from the file. */
export function updatePage(
  pages: AnnotationPages,
  page: number,
  fn: (p: PageAnnotations) => PageAnnotations
): AnnotationPages {
  const next = { ...fn(pageOf(pages, page)) }
  if (!next.images?.length) delete next.images
  const copy = { ...pages }
  const empty =
    !next.strokes.length && !next.highlights.length && !next.textBoxes.length && !next.images
  // A blank page stays until it is removed on purpose, even with nothing on it.
  if (empty && !next.blank) {
    delete copy[String(page)]
  } else {
    copy[String(page)] = next
  }
  return copy
}

export function addItem<K extends Kind>(
  pages: AnnotationPages,
  page: number,
  kind: K,
  item: ItemOfKind[K]
): AnnotationPages {
  return updatePage(pages, page, (p) => ({ ...p, [kind]: [...itemsOf(p, kind), item] }))
}

export function removeItems(
  pages: AnnotationPages,
  page: number,
  kind: Kind,
  ids: Iterable<string>
): AnnotationPages {
  const remove = new Set(ids)
  if (!remove.size) return pages
  return updatePage(pages, page, (p) => ({
    ...p,
    [kind]: itemsOf(p, kind).filter((item) => !remove.has(item.id))
  }))
}

export function replaceItem<K extends Kind>(
  pages: AnnotationPages,
  page: number,
  kind: K,
  item: ItemOfKind[K]
): AnnotationPages {
  return updatePage(pages, page, (p) => ({
    ...p,
    [kind]: itemsOf(p, kind).map((old) => (old.id === item.id ? item : old))
  }))
}

export function findItem<K extends Kind>(
  pages: AnnotationPages,
  ref: { page: number; kind: K; id: string }
): ItemOfKind[K] | undefined {
  return itemsOf(pageOf(pages, ref.page), ref.kind).find((item) => item.id === ref.id)
}

export function itemsOf<K extends Kind>(page: PageAnnotations, kind: K): ItemOfKind[K][] {
  return (page[kind] ?? []) as ItemOfKind[K][]
}

export function newId(prefix: 's' | 'h' | 't' | 'i'): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}
