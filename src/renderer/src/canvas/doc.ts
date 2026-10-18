import { createStore, type StoreApi } from 'zustand/vanilla'
import type { CanvasData } from '../../../shared/canvas'
import { NOTHING, type Selection } from './ops'

/** A change Claude proposes: the canvas as it would be, drawn over mine until I decide. */
export interface CanvasGhost {
  data: CanvasData
  decide(accept: boolean): void
}

const HISTORY_LIMIT = 200

export interface CanvasDocState {
  data: CanvasData
  past: CanvasData[]
  future: CanvasData[]
  selection: Selection
  /** The node whose text (or group label) is being typed, or the edge whose label is. */
  editing: string | null
  ghost: CanvasGhost | null

  /** Applies one change as one undo step. */
  change(fn: (data: CanvasData) => CanvasData): void
  /** For drags and typing: `begin`, `update`s, then `end` (one undo step) or `cancel`. */
  begin(): void
  update(fn: (data: CanvasData) => CanvasData): void
  end(): void
  cancel(): void
  /** The canvas as it was at `begin`, for drags that measure from the start. */
  started(): CanvasData
  undo(): void
  redo(): void
  select(selection: Selection): void
  edit(id: string | null): void
  setGhost(ghost: CanvasGhost | null): void
  /** Takes the file as it is on disk now, without an undo step (a change made elsewhere). */
  reload(data: CanvasData): void
}

export type CanvasDoc = StoreApi<CanvasDocState>

export function createCanvasDoc(data: CanvasData): CanvasDoc {
  let snapshot: CanvasData | null = null

  return createStore<CanvasDocState>((set, get) => {
    function push(previous: CanvasData, next: CanvasData): void {
      if (previous === next) return
      set({ data: next, past: [...get().past, previous].slice(-HISTORY_LIMIT), future: [] })
    }

    // After undo or redo, chosen items may be gone.
    function stillThere(data: CanvasData): Selection {
      const { nodes, edges } = get().selection
      const nodeIds = new Set(data.nodes.map((n) => n.id))
      const edgeIds = new Set(data.edges.map((e) => e.id))
      return {
        nodes: nodes.filter((id) => nodeIds.has(id)),
        edges: edges.filter((id) => edgeIds.has(id))
      }
    }

    return {
      data,
      past: [],
      future: [],
      selection: NOTHING,
      editing: null,
      ghost: null,

      change(fn) {
        if (!snapshot) return push(get().data, fn(get().data))
        // A drag is going on (Claude can edit meanwhile): the change also goes into what
        // `cancel` returns to, with its own undo step.
        const before = snapshot
        snapshot = fn(snapshot)
        if (before !== snapshot) {
          set({ past: [...get().past, before].slice(-HISTORY_LIMIT), future: [] })
        }
        set({ data: fn(get().data) })
      },

      begin() {
        snapshot = get().data
      },
      update: (fn) => set({ data: fn(get().data) }),
      end() {
        if (snapshot) push(snapshot, get().data)
        snapshot = null
      },
      cancel() {
        if (snapshot) set({ data: snapshot })
        snapshot = null
      },
      started: () => snapshot ?? get().data,

      undo() {
        const { past, data, future } = get()
        if (!past.length) return
        const previous = past[past.length - 1]
        set({
          data: previous,
          past: past.slice(0, -1),
          future: [data, ...future],
          editing: null,
          selection: stillThere(previous)
        })
      },
      redo() {
        const { past, data, future } = get()
        if (!future.length) return
        const [next, ...rest] = future
        set({
          data: next,
          past: [...past, data],
          future: rest,
          editing: null,
          selection: stillThere(next)
        })
      },

      select: (selection) => set({ selection }),
      edit: (editing) => set({ editing }),
      setGhost: (ghost) => set({ ghost }),
      reload(next) {
        // Undo would bring back the old file over what came from disk.
        set({ data: next, past: [], future: [], editing: null, selection: NOTHING })
      }
    }
  })
}
