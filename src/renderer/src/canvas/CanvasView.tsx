import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import {
  boundsOf,
  canvasFrom,
  formatCanvas,
  newCanvasId,
  overlaps,
  PRESET_COLORS,
  RELATIONS,
  withRelation,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type InkNode,
  type Rect,
  type Relation,
  type Side
} from '../../../shared/canvas'
import { CloseButton } from '../components/CloseButton'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { Icon, type IconName } from '../components/Icon'
import { SidebarButton } from '../components/SidebarButton'
import { snapAxis, type Anchor } from '../annotations/snap'
import { strokeOutline } from '../../../shared/ink'
import { vaultUrl } from '../editor/links'
import { draggingFiles } from '../lib/drop'
import { registerFlush } from '../lib/flush'
import { registerCanvas } from '../lib/open'
import { parentOf } from '../lib/tree'
import { useApp } from '../store'
import {
  fitCamera,
  grow,
  panBy,
  toWorld,
  viewRect,
  wheelZoom,
  zoomAt,
  zoomStep,
  type Camera
} from './camera'
import { CanvasEdges, EdgeLabels } from './CanvasEdges'
import { CanvasNodeView } from './CanvasNodeView'
import { createCanvasDoc, type CanvasDoc } from './doc'
import { geometryOf, type EdgeGeometry } from './edges'
import {
  addNodes,
  bringToFront,
  connect,
  copyItems,
  drawOrder,
  groupAround,
  isEmpty,
  moveNodes,
  movingSet,
  nearestSide,
  nodeAt,
  nodeById,
  nodesIn,
  NOTHING,
  nudge,
  pasteItems,
  removeItems,
  resized,
  updateEdge,
  updateNode,
  withStroke,
  type Handle,
  type Selection
} from './ops'
import { TEMPLATES } from './shapes'

type Tool = 'select' | 'hand' | 'text' | 'pen'

const TOOLS: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: 'select', icon: 'cursor', label: 'Select', key: 'V' },
  { tool: 'hand', icon: 'hand', label: 'Pan', key: 'H' },
  { tool: 'text', icon: 'text', label: 'Text box', key: 'T' },
  { tool: 'pen', icon: 'pen', label: 'Pen', key: 'P' }
]

const RELATION_LABELS: Record<Relation, string> = {
  association: 'Association',
  directed: 'Directed association',
  inheritance: 'Inheritance',
  realization: 'Realization',
  dependency: 'Dependency',
  aggregation: 'Aggregation',
  composition: 'Composition'
}

const SNAP_PX = 6
const CLIPBOARD_KIND = 'marginalia-canvas'
const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}
const NOOP = (): void => {}
// Pen strokes this close in time and place go into one drawing.
const INK_JOIN_MS = 4000

const cameraKey = (path: string): string => `canvas-camera:${useApp.getState().vault?.root}:${path}`

function loadCamera(path: string): Camera | null {
  try {
    const value = JSON.parse(localStorage.getItem(cameraKey(path)) ?? 'null')
    return value && typeof value.zoom === 'number' ? value : null
  } catch {
    return null
  }
}

function saveCamera(path: string, camera: Camera): void {
  try {
    localStorage.setItem(cameraKey(path), JSON.stringify(camera))
  } catch {
    // Only a convenience.
  }
}

/** The image's own size, scaled down to at most 480 wide, for a new image box. */
function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 480 / (img.naturalWidth || 480))
      resolve({
        width: Math.round((img.naturalWidth || 480) * scale),
        height: Math.round((img.naturalHeight || 320) * scale)
      })
    }
    img.onerror = () => resolve({ width: 480, height: 320 })
    img.src = src
  })
}

type Drag =
  | { kind: 'pan'; x: number; y: number; camera: Camera }
  | { kind: 'marquee'; from: { x: number; y: number }; add: Selection }
  | {
      kind: 'move'
      from: { x: number; y: number }
      ids: Set<string>
      started: boolean
      clicked: string
      shift: boolean
    }
  | { kind: 'resize'; id: string; handle: Handle; from: { x: number; y: number }; rect: Rect }
  | { kind: 'connect'; id: string; side: Side }
  | { kind: 'ink'; points: [number, number, number][] }

export function CanvasView({ path, title }: { path: string; title: string }): React.JSX.Element {
  const [doc, setDoc] = useState<CanvasDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lectureMode = useApp((s) => s.lectureMode)
  const toggleLecture = useApp((s) => s.toggleLecture)

  useEffect(() => {
    const api = window.api.vault
    const { showError } = useApp.getState()
    let cancelled = false
    let current: CanvasDoc | null = null
    let saved = ''
    let dirty = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopDoc = NOOP

    const save = async (): Promise<void> => {
      clearTimeout(timer)
      if (!current || !dirty) return
      const text = formatCanvas(current.getState().data)
      dirty = false
      if (text === saved) return
      try {
        await api.writeText(path, text)
        saved = text
      } catch (err) {
        dirty = true
        showError(`Canvas not saved: ${(err as Error).message}`)
      }
    }

    api
      .readText(path)
      .then((text) => {
        if (cancelled) return
        saved = text
        current = createCanvasDoc(canvasFrom(text))
        stopDoc = current.subscribe((state, previous) => {
          if (state.data === previous.data || reloading) return
          dirty = true
          clearTimeout(timer)
          timer = setTimeout(save, 1000)
        })
        setDoc(current)
      })
      .catch((err: Error) => !cancelled && setError(err.message))

    // Changes made elsewhere (Obsidian, a sync) come in when nothing here is unsaved.
    let reloading = false
    const stopWatching = api.onChanged(async () => {
      if (!current || dirty) return
      const text = await api.readText(path).catch(() => null)
      if (text === null || text === saved || !current) return
      let data: CanvasData
      try {
        data = canvasFrom(text)
      } catch {
        return
      }
      saved = text
      reloading = true
      current.getState().reload(data)
      reloading = false
    })
    const unregister = registerFlush(save)

    return () => {
      cancelled = true
      stopWatching()
      unregister()
      void save().finally(stopDoc)
    }
  }, [path])

  return (
    <div className="canvas-pane">
      {error ? (
        <>
          <div className="pane-toolbar">
            <SidebarButton />
            <span className="pane-title">{title}</span>
            <CloseButton path={path} />
          </div>
          <p className="pdf-message">
            Could not open this canvas: {error}. The file is left as it is.
          </p>
        </>
      ) : doc ? (
        <CanvasSurface
          path={path}
          title={title}
          doc={doc}
          lectureMode={lectureMode}
          onToggleLecture={() => void toggleLecture()}
        />
      ) : null}
    </div>
  )
}

function CanvasSurface({
  path,
  title,
  doc,
  lectureMode,
  onToggleLecture
}: {
  path: string
  title: string
  doc: CanvasDoc
  lectureMode: boolean
  onToggleLecture(): void
}): React.JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const data = useStore(doc, (s) => s.data)
  const selection = useStore(doc, (s) => s.selection)
  const editing = useStore(doc, (s) => s.editing)
  const ghost = useStore(doc, (s) => s.ghost)
  const canUndo = useStore(doc, (s) => s.past.length > 0)
  const canRedo = useStore(doc, (s) => s.future.length > 0)
  const ink = useApp((s) => s.ink)
  const penColors = useApp((s) => s.settings.penColors)
  const snapping = useApp((s) => s.settings.snapping)

  const [size, setSize] = useState({ width: 0, height: 0 })
  const [camera, setCameraState] = useState<Camera>(
    () => loadCamera(path) ?? { x: 0, y: 0, zoom: 1 }
  )
  const cameraRef = useRef(camera)
  const [tool, setTool] = useState<Tool>('select')
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const [draft, setDraft] = useState<{
    from: Rect
    fromSide: Side
    to: { x: number; y: number }
  } | null>(null)
  const [liveInk, setLiveInk] = useState<[number, number, number][] | null>(null)
  const [panning, setPanning] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const drag = useRef<Drag | null>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const space = useRef(false)
  const lastInk = useRef<{ id: string; at: number } | null>(null)
  const newBox = useRef<string | null>(null)

  const setCamera = useCallback((next: Camera | ((c: Camera) => Camera)) => {
    const value = typeof next === 'function' ? next(cameraRef.current) : next
    cameraRef.current = value
    setCameraState(value)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => saveCamera(path, camera), 300)
    return () => clearTimeout(timer)
  }, [path, camera])

  // The first time a canvas opens, everything in it shows.
  const fitted = useRef(!!loadCamera(path))
  useLayoutEffect(() => {
    const el = surfaceRef.current!
    const observer = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight }
      setSize(next)
      if (!fitted.current && next.width > 0) {
        fitted.current = true
        setCamera(fitCamera(boundsOf(doc.getState().data.nodes), next.width, next.height))
      }
    })
    observer.observe(el)
    el.focus({ preventScroll: true })
    return () => observer.disconnect()
  }, [doc, setCamera])

  const fit = useCallback(() => {
    setCamera(fitCamera(boundsOf(doc.getState().data.nodes), size.width, size.height))
  }, [doc, size, setCamera])

  const zoomBy = useCallback(
    (direction: 1 | -1) =>
      setCamera((c) => zoomAt(c, zoomStep(c.zoom, direction), size.width / 2, size.height / 2)),
    [size, setCamera]
  )

  useEffect(
    () =>
      registerCanvas({
        path,
        doc,
        view: () => viewRect(cameraRef.current, size.width, size.height),
        reveal: (rect) => {
          const view = viewRect(cameraRef.current, size.width, size.height)
          if (overlaps(view, rect) && rect.width < view.width) return
          setCamera((c) => ({
            ...c,
            x: rect.x + rect.width / 2 - size.width / 2 / c.zoom,
            y: rect.y + rect.height / 2 - size.height / 2 / c.zoom
          }))
        }
      }),
    [path, doc, size, setCamera]
  )

  // React's wheel listener is passive and cannot stop the page from zooming.
  useEffect(() => {
    const el = surfaceRef.current!
    const onWheel = (e: WheelEvent): void => {
      if ((e.target as HTMLElement).closest('.canvas-editor, .canvas-edge-panel')) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey) {
        setCamera((c) =>
          zoomAt(c, wheelZoom(c.zoom, e.deltaY), e.clientX - r.left, e.clientY - r.top)
        )
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY
        setCamera((c) => panBy(c, dx, dy))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setCamera])

  const worldOf = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = surfaceRef.current!.getBoundingClientRect()
    return toWorld(cameraRef.current, e.clientX - r.left, e.clientY - r.top)
  }

  const viewCenter = (): { x: number; y: number } =>
    toWorld(cameraRef.current, size.width / 2, size.height / 2)

  // What is shown: Claude's proposal over the canvas while I decide.
  const shown = ghost?.data ?? data
  const proposals = useMemo(() => {
    const map = new Map<string, 'ghost' | 'removed'>()
    if (!ghost) return map
    const mine = new Map<string, unknown>([...data.nodes, ...data.edges].map((i) => [i.id, i]))
    const theirs = new Set([...ghost.data.nodes, ...ghost.data.edges].map((i) => i.id))
    for (const item of [...ghost.data.nodes, ...ghost.data.edges]) {
      if (mine.get(item.id) !== item) map.set(item.id, 'ghost')
    }
    for (const id of mine.keys()) if (!theirs.has(id)) map.set(id, 'removed')
    return map
  }, [ghost, data])
  const removed = useMemo(
    () => (ghost ? data.nodes.filter((n) => proposals.get(n.id) === 'removed') : []),
    [ghost, data, proposals]
  )

  const byId = useMemo(
    () => new Map([...shown.nodes, ...removed].map((n) => [n.id, n])),
    [shown, removed]
  )
  const allEdges = useMemo(
    () =>
      ghost
        ? [...shown.edges, ...data.edges.filter((e) => proposals.get(e.id) === 'removed')]
        : shown.edges,
    [ghost, shown, data, proposals]
  )
  const geometries = useMemo(() => {
    const map = new Map<string, EdgeGeometry>()
    for (const edge of allEdges) {
      const g = geometryOf(edge, byId)
      if (g) map.set(edge.id, g)
    }
    return map
  }, [allEdges, byId])

  const view = viewRect(camera, size.width, size.height)
  const near = grow(view, 0.5)
  const chosen = useMemo(() => new Set(selection.nodes), [selection])
  const chosenEdges = useMemo(() => new Set(selection.edges), [selection])
  const ordered = drawOrder([...shown.nodes, ...removed]).filter(
    (n) => overlaps(near, n) || chosen.has(n.id) || n.id === editing
  )
  const groups = ordered.filter((n) => n.type === 'group')
  const boxes = ordered.filter((n) => n.type !== 'group')
  const single = selection.nodes.length === 1 && !selection.edges.length ? selection.nodes[0] : null

  // Editing text: the new box and its text are one undo step; an empty new box goes away.
  const startEdit = (id: string): void => {
    const s = doc.getState()
    if (s.editing) return
    s.begin()
    s.select({ nodes: [id], edges: [] })
    s.edit(id)
  }
  const onText = useCallback(
    (text: string) => {
      const s = doc.getState()
      const id = s.editing
      if (!id) return
      const node = nodeById(s.data, id)
      if (!node) return
      s.update((d) => updateNode(d, id, node.type === 'group' ? { label: text } : { text }))
    },
    [doc]
  )
  const onDone = useCallback(() => {
    const s = doc.getState()
    const id = s.editing
    const node = id ? nodeById(s.data, id) : undefined
    s.edit(null)
    if (node && id === newBox.current && node.type === 'text' && !node.text.trim() && !node.shape) {
      s.cancel()
      s.select(NOTHING)
    } else {
      s.end()
    }
    newBox.current = null
    surfaceRef.current?.focus({ preventScroll: true })
  }, [doc])

  const addBox = (node: CanvasNode, edit: boolean): void => {
    const s = doc.getState()
    if (edit) {
      s.begin()
      s.update((d) => addNodes(d, [node]))
      newBox.current = node.id
      s.select({ nodes: [node.id], edges: [] })
      s.edit(node.id)
    } else {
      s.change((d) => addNodes(d, [node]))
      s.select({ nodes: [node.id], edges: [] })
    }
  }

  const textBoxAt = (x: number, y: number, width = 240, height = 80): CanvasNode => ({
    id: newCanvasId(),
    type: 'text',
    text: '',
    x: Math.round(x - width / 2),
    y: Math.round(y - height / 2),
    width,
    height
  })

  const addImage = async (
    data: Uint8Array,
    ext: string,
    at: { x: number; y: number }
  ): Promise<void> => {
    const { showError } = useApp.getState()
    try {
      const rel = await window.api.vault.saveAsset(path, data, ext)
      const file = `${parentOf(path)}/${rel}`
      const { width, height } = await imageSize(vaultUrl(file))
      addBox(
        {
          id: newCanvasId(),
          type: 'file',
          file,
          x: Math.round(at.x - width / 2),
          y: Math.round(at.y - height / 2),
          width,
          height
        },
        false
      )
    } catch (err) {
      showError(`Image not added: ${(err as Error).message}`)
    }
  }

  // Snapping a moved set of boxes: its edges and middle to those of the other boxes on screen.
  const snapMove = (
    ids: Set<string>,
    start: CanvasData,
    dx: number,
    dy: number,
    alt: boolean
  ): { dx: number; dy: number; gx: number | null; gy: number | null } => {
    const moving = start.nodes.filter((n) => ids.has(n.id))
    const box = boundsOf(moving)
    if (!box || !snapping || alt) return { dx, dy, gx: null, gy: null }
    const others = start.nodes.filter(
      (n) => !ids.has(n.id) && n.type !== 'group' && overlaps(near, n)
    )
    const xs = others.flatMap((n) => [n.x, n.x + n.width / 2, n.x + n.width])
    const ys = others.flatMap((n) => [n.y, n.y + n.height / 2, n.y + n.height])
    const anchorsX: Anchor[] = [0, box.width / 2, box.width].map((offset) => ({
      offset,
      targets: xs
    }))
    const anchorsY: Anchor[] = [0, box.height / 2, box.height].map((offset) => ({
      offset,
      targets: ys
    }))
    const threshold = SNAP_PX / cameraRef.current.zoom
    const sx = snapAxis(box.x + dx, anchorsX, threshold)
    const sy = snapAxis(box.y + dy, anchorsY, threshold)
    return { dx: sx.pos - box.x, dy: sy.pos - box.y, gx: sx.guide, gy: sy.guide }
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return
    const el = surfaceRef.current!
    const target = e.target as HTMLElement
    if (target.closest('.canvas-edge-panel, .canvas-ghost-bar')) return
    el.focus({ preventScroll: true })
    const at = worldOf(e)
    const s = doc.getState()
    if (e.button === 1 || tool === 'hand' || space.current || ghost) {
      e.preventDefault()
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, camera: cameraRef.current }
      setPanning(true)
    } else if (tool === 'pen') {
      drag.current = { kind: 'ink', points: [[at.x, at.y, e.pressure || 0.5]] }
      setLiveInk(drag.current.points)
    } else {
      const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as
        Handle | undefined
      const side = target.closest<HTMLElement>('[data-connect]')?.dataset.connect as
        Side | undefined
      const nodeId = target.closest<HTMLElement>('[data-node]')?.dataset.node
      const edgeId = target.closest<HTMLElement>('[data-edge]')?.dataset.edge
      if (handle && nodeId) {
        const node = nodeById(s.data, nodeId)!
        s.begin()
        drag.current = { kind: 'resize', id: nodeId, handle, from: at, rect: node }
      } else if (side && nodeId) {
        drag.current = { kind: 'connect', id: nodeId, side }
        setDraft({ from: nodeById(s.data, nodeId)!, fromSide: side, to: at })
      } else if (nodeId) {
        if (s.editing === nodeId) return
        const already = s.selection.nodes.includes(nodeId)
        if (e.shiftKey) {
          s.select({
            nodes: already
              ? s.selection.nodes.filter((id) => id !== nodeId)
              : [...s.selection.nodes, nodeId],
            edges: s.selection.edges
          })
        } else if (!already) {
          s.select({ nodes: [nodeId], edges: [] })
        }
        const ids = movingSet(s.data, doc.getState().selection.nodes)
        drag.current = {
          kind: 'move',
          from: at,
          ids,
          started: false,
          clicked: nodeId,
          shift: e.shiftKey
        }
      } else if (edgeId) {
        const already = s.selection.edges.includes(edgeId)
        s.select(
          e.shiftKey
            ? {
                nodes: s.selection.nodes,
                edges: already
                  ? s.selection.edges.filter((id) => id !== edgeId)
                  : [...s.selection.edges, edgeId]
              }
            : { nodes: [], edges: [edgeId] }
        )
        return
      } else if (tool === 'text') {
        addBox(textBoxAt(at.x, at.y), true)
        setTool('select')
        return
      } else {
        drag.current = { kind: 'marquee', from: at, add: e.shiftKey ? s.selection : NOTHING }
        if (!e.shiftKey) s.select(NOTHING)
      }
    }
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const at = worldOf(e)
    pointer.current = at
    const d = drag.current
    if (!d) return
    const s = doc.getState()
    switch (d.kind) {
      case 'pan':
        setCamera({ ...d.camera, ...panBy(d.camera, d.x - e.clientX, d.y - e.clientY) })
        return
      case 'ink':
        d.points.push([at.x, at.y, e.pressure || 0.5])
        setLiveInk([...d.points])
        return
      case 'connect':
        setDraft((dr) => (dr ? { ...dr, to: at } : dr))
        return
      case 'marquee': {
        const rect = {
          x: Math.min(d.from.x, at.x),
          y: Math.min(d.from.y, at.y),
          width: Math.abs(at.x - d.from.x),
          height: Math.abs(at.y - d.from.y)
        }
        setMarquee(rect)
        const inside = nodesIn(s.data, rect)
        s.select({ nodes: [...new Set([...d.add.nodes, ...inside])], edges: d.add.edges })
        return
      }
      case 'resize': {
        const node = nodeById(s.data, d.id)
        const keep = e.shiftKey || node?.type === 'file' || node?.type === 'ink'
        const rect = resized(d.rect, d.handle, at.x - d.from.x, at.y - d.from.y, keep)
        s.update((data) => updateNode(data, d.id, rect))
        return
      }
      case 'move': {
        const dx = at.x - d.from.x
        const dy = at.y - d.from.y
        if (!d.started) {
          if (Math.hypot(dx, dy) * cameraRef.current.zoom < 3) return
          d.started = true
          s.begin()
        }
        const snapped = snapMove(d.ids, s.started(), dx, dy, e.altKey)
        setGuides({ x: snapped.gx, y: snapped.gy })
        s.update((data) => moveNodes(data, s.started(), d.ids, snapped.dx, snapped.dy))
      }
    }
  }

  // `time` is the pointer event's own time stamp.
  const finishInk = (points: [number, number, number][], time: number): void => {
    if (points.length < 2) return
    const s = doc.getState()
    const last = lastInk.current
    const recent =
      last && time - last.at < INK_JOIN_MS ? (nodeById(s.data, last.id) as InkNode) : null
    const node = withStroke(recent ?? null, {
      color: ink.penColor,
      width: ink.penWidth,
      points
    })
    s.change((d) => (node.id === recent?.id ? updateNode(d, node.id, node) : addNodes(d, [node])))
    lastInk.current = { id: node.id, at: time }
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const d = drag.current
    drag.current = null
    const s = doc.getState()
    if (!d) return
    setPanning(false)
    if (d.kind === 'ink') {
      finishInk(d.points, e.timeStamp)
      setLiveInk(null)
    } else if (d.kind === 'connect') {
      setDraft(null)
      const at = worldOf(e)
      const from = nodeById(s.data, d.id)
      if (!from) return
      const target = nodeAt(s.data, at.x, at.y, new Set([d.id]))
      if (target) {
        const edge = connect(s.data, d.id, target.id, {
          fromSide: d.side,
          toSide: nearestSide(target, at.x, at.y)
        })
        if (edge) {
          s.change((data) => ({ ...data, edges: [...data.edges, edge] }))
          s.select({ nodes: [], edges: [edge.id] })
        }
      } else if (
        Math.hypot(at.x - (from.x + from.width / 2), at.y - (from.y + from.height / 2)) > 60
      ) {
        // Let go on empty space: a new box there, connected, ready to type in (like Obsidian).
        const box = textBoxAt(at.x, at.y)
        s.begin()
        s.update((data) => {
          const withBox = addNodes(data, [box])
          const edge = connect(withBox, d.id, box.id, { fromSide: d.side })
          return edge ? { ...withBox, edges: [...withBox.edges, edge] } : withBox
        })
        newBox.current = box.id
        s.select({ nodes: [box.id], edges: [] })
        s.edit(box.id)
      }
    } else if (d.kind === 'move') {
      setGuides({ x: null, y: null })
      if (d.started) {
        // What I moved lands on top, in the same undo step as the move.
        s.update((data) =>
          bringToFront(
            data,
            [...d.ids].filter((id) => nodeById(data, id)?.type !== 'group')
          )
        )
        s.end()
      } else if (!d.shift) {
        s.select({ nodes: [d.clicked], edges: [] })
      }
    } else if (d.kind === 'resize') {
      s.end()
    } else if (d.kind === 'marquee') {
      setMarquee(null)
    }
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    if (tool !== 'select' || ghost) return
    const target = e.target as HTMLElement
    if (target.closest('.canvas-edge-panel, .canvas-ghost-bar, .canvas-editor')) return
    const s = doc.getState()
    const nodeId = target.closest<HTMLElement>('[data-node]')?.dataset.node
    const edgeId = target.closest<HTMLElement>('[data-edge]')?.dataset.edge
    if (nodeId) {
      const node = nodeById(s.data, nodeId)
      if (!node) return
      if (node.type === 'text' || node.type === 'group') startEdit(nodeId)
      else if (node.type === 'file' && !/\.(png|jpe?g|gif|webp|svg)$/i.test(node.file)) {
        const page = /page=(\d+)/.exec(node.subpath ?? '')?.[1]
        useApp.getState().openFile(node.file, page ? Number(page) : undefined)
      } else if (node.type === 'link' && /^https?:\/\//i.test(node.url)) window.open(node.url)
    } else if (edgeId) {
      s.select({ nodes: [], edges: [edgeId] })
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('.canvas-edge-panel input[name="label"]')?.focus()
      )
    } else {
      const at = worldOf(e)
      addBox(textBoxAt(at.x, at.y), true)
    }
  }

  const deleteSelection = (): void => {
    const s = doc.getState()
    if (isEmpty(s.selection)) return
    s.change((d) => removeItems(d, s.selection))
    s.select(NOTHING)
  }

  const duplicate = (): void => {
    const s = doc.getState()
    if (!s.selection.nodes.length) return
    const copies = copyItems(s.data, s.selection.nodes, 30, 30)
    s.change((d) => ({
      ...d,
      nodes: [...d.nodes, ...copies.nodes],
      edges: [...d.edges, ...copies.edges]
    }))
    s.select({ nodes: copies.nodes.map((n) => n.id), edges: [] })
  }

  const copy = async (cut: boolean): Promise<void> => {
    const s = doc.getState()
    if (!s.selection.nodes.length) return
    const items = copyItems(s.data, s.selection.nodes, 0, 0)
    await navigator.clipboard.writeText(JSON.stringify({ kind: CLIPBOARD_KIND, ...items }))
    if (cut) deleteSelection()
  }

  const makeGroup = (): void => {
    const s = doc.getState()
    const group = groupAround(s.data, s.selection.nodes)
    if (!group) return
    s.change((d) => addNodes(d, [group]))
    s.select({ nodes: [group.id], edges: [] })
  }

  const ungroup = (): void => {
    const s = doc.getState()
    const groups = s.selection.nodes.filter((id) => nodeById(s.data, id)?.type === 'group')
    if (!groups.length) return
    s.change((d) => ({ ...d, nodes: d.nodes.filter((n) => !groups.includes(n.id)) }))
    s.select(NOTHING)
  }

  const recolor = (color: string | undefined): void => {
    const s = doc.getState()
    const { nodes, edges } = s.selection
    if (isEmpty(s.selection)) return
    s.change((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (nodes.includes(n.id) ? withColor(n, color) : n)),
      edges: d.edges.map((e) => (edges.includes(e.id) ? withColor(e, color) : e))
    }))
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    const s = doc.getState()
    const ctrl = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (key === ' ') {
      space.current = true
      e.preventDefault()
      return
    }
    if (ctrl && key === 'z') e.shiftKey ? s.redo() : s.undo()
    else if (ctrl && key === 'y') s.redo()
    else if (ctrl && key === 'a') s.select({ nodes: s.data.nodes.map((n) => n.id), edges: [] })
    else if (ctrl && key === 'd') duplicate()
    else if (ctrl && key === 'c') void copy(false)
    else if (ctrl && key === 'x') void copy(true)
    else if (ctrl && key === 'g') (e.shiftKey ? ungroup : makeGroup)()
    else if (ctrl && key === '0') setCamera((c) => zoomAt(c, 1, size.width / 2, size.height / 2))
    else if (ctrl && (key === '=' || key === '+')) zoomBy(1)
    else if (ctrl && key === '-') zoomBy(-1)
    else if (e.shiftKey && e.code === 'Digit1') fit()
    else if (key === 'delete' || key === 'backspace') deleteSelection()
    else if (key === 'escape') {
      s.select(NOTHING)
      setTool('select')
    } else if (key === 'enter' && single) startEdit(single)
    else if (key.startsWith('arrow') && s.selection.nodes.length) {
      const step = e.shiftKey ? 10 : 1
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
      s.change((d) => nudge(d, s.selection.nodes, dx, dy))
    } else if (!ctrl && !e.altKey) {
      const found = TOOLS.find((t) => t.key.toLowerCase() === key)
      if (!found) return
      setTool(found.tool)
    } else return
    e.preventDefault()
  }

  const onPaste = (e: React.ClipboardEvent): void => {
    if ((e.target as HTMLElement).closest('input, textarea')) return
    const at = pointer.current ?? viewCenter()
    const image = [...e.clipboardData.files].find((f) => IMAGE_TYPES[f.type])
    e.preventDefault()
    if (image) {
      void image
        .arrayBuffer()
        .then((buf) => addImage(new Uint8Array(buf), IMAGE_TYPES[image.type], at))
      return
    }
    const text = e.clipboardData.getData('text/plain')
    if (!text.trim()) return
    const s = doc.getState()
    try {
      const items = JSON.parse(text)
      if (items?.kind === CLIPBOARD_KIND && Array.isArray(items.nodes)) {
        const pasted = pasteItems(s.data, items, Math.round(at.x), Math.round(at.y))
        s.change(() => pasted.data)
        s.select(pasted.selection)
        return
      }
    } catch {
      // Plain text: a new box with it.
    }
    addBox({ ...textBoxAt(at.x, at.y, 280, 120), text } as CanvasNode, false)
  }

  const onDrop = (e: React.DragEvent): void => {
    if (!draggingFiles(e)) return
    const images = [...e.dataTransfer.files].filter((f) => IMAGE_TYPES[f.type])
    if (!images.length) return
    // Workspace imports dropped PDFs; images are mine.
    e.preventDefault()
    const at = worldOf(e)
    images.forEach((file, i) => {
      void file.arrayBuffer().then((buf) =>
        addImage(new Uint8Array(buf), IMAGE_TYPES[file.type], {
          x: at.x + i * 40,
          y: at.y + i * 40
        })
      )
    })
  }

  const shapesMenu = (e: React.MouseEvent): void => {
    const r = e.currentTarget.getBoundingClientRect()
    const items: MenuItem[] = TEMPLATES.flatMap((section, i): MenuItem[] => [
      ...(i ? [{ separator: true } as MenuItem] : []),
      { custom: <p className="menu-heading">{section.section}</p> },
      ...section.items.map((t): MenuItem => ({
        label: t.name,
        hint: t.hint,
        onSelect: () => {
          const c = viewCenter()
          const node = t.make(c.x, c.y)
          addBox(node, false)
        }
      }))
    ])
    setMenu({ x: r.left, y: r.bottom + 4, items })
  }

  const edge =
    selection.edges.length === 1 && !selection.nodes.length
      ? data.edges.find((x) => x.id === selection.edges[0])
      : undefined
  const edgeAt = edge ? geometries.get(edge.id)?.middle : undefined

  const transform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`
  const nodeView = (n: CanvasNode): React.JSX.Element => (
    <CanvasNodeView
      key={n.id}
      node={n}
      selected={chosen.has(n.id)}
      handles={single === n.id && !ghost}
      editing={editing === n.id}
      proposal={proposals.get(n.id)}
      onText={editing === n.id ? onText : NOOP}
      onDone={editing === n.id ? onDone : NOOP}
    />
  )

  return (
    <>
      <div className="pane-toolbar canvas-toolbar">
        <SidebarButton />
        <span className="pane-title">{title}</span>
        <div className="annotation-toolbar" role="toolbar" aria-label="Canvas tools">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              className={tool === t.tool ? 'icon-button pressed' : 'icon-button'}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              aria-pressed={tool === t.tool}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setTool(t.tool)}
            >
              <Icon name={t.icon} />
            </button>
          ))}
          <button
            className="icon-button"
            title="Add a shape"
            aria-label="Shapes"
            aria-haspopup="menu"
            onPointerDown={(e) => e.preventDefault()}
            onClick={shapesMenu}
          >
            <Icon name="shapes" />
          </button>
          {tool === 'pen' && (
            <div className="ink-swatches">
              {penColors.map((c) => (
                <button
                  key={c}
                  className="swatch"
                  style={{ background: c }}
                  aria-label={`Pen colour ${c}`}
                  aria-pressed={ink.penColor === c}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() =>
                    useApp.setState({ ink: { ...useApp.getState().ink, penColor: c } })
                  }
                />
              ))}
            </div>
          )}
          {!isEmpty(selection) && (
            <>
              <span className="toolbar-divider" />
              <div className="ink-swatches" aria-label="Colour">
                <button
                  className="swatch none"
                  title="No colour"
                  aria-label="No colour"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => recolor(undefined)}
                />
                {Object.entries(PRESET_COLORS).map(([preset, name]) => (
                  <button
                    key={preset}
                    className="swatch"
                    style={{ background: `var(--nb-${name})` }}
                    title={name[0].toUpperCase() + name.slice(1)}
                    aria-label={`Colour ${name}`}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => recolor(preset)}
                  />
                ))}
              </div>
              {selection.nodes.length > 1 && (
                <button
                  className="icon-button"
                  title="Group (Ctrl+G)"
                  aria-label="Group"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={makeGroup}
                >
                  <Icon name="group" />
                </button>
              )}
            </>
          )}
          <span className="toolbar-divider" />
          <button
            className="icon-button"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={!canUndo}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => doc.getState().undo()}
          >
            <Icon name="undo" />
          </button>
          <button
            className="icon-button"
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
            disabled={!canRedo}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => doc.getState().redo()}
          >
            <Icon name="redo" />
          </button>
        </div>
        <div className="canvas-zoom">
          <button
            className="icon-button"
            aria-label="Zoom out"
            title="Zoom out (Ctrl+-)"
            onClick={() => zoomBy(-1)}
          >
            <Icon name="minus" />
          </button>
          <button
            className="text-button canvas-zoom-value"
            title="Back to 100% (Ctrl+0)"
            onClick={() => setCamera((c) => zoomAt(c, 1, size.width / 2, size.height / 2))}
          >
            {Math.round(camera.zoom * 100)}%
          </button>
          <button
            className="icon-button"
            aria-label="Zoom in"
            title="Zoom in (Ctrl+=)"
            onClick={() => zoomBy(1)}
          >
            <Icon name="plus" />
          </button>
          <button
            className="icon-button"
            aria-label="Zoom to fit"
            title="Show everything (Shift+1)"
            onClick={fit}
          >
            <Icon name="fit" />
          </button>
        </div>
        <button
          className="icon-button"
          title="Export this canvas as a PDF"
          aria-label="Export as PDF"
          onClick={() => useApp.getState().exportCanvas(path)}
        >
          <Icon name="export" />
        </button>
        <button
          className={lectureMode ? 'icon-button pressed' : 'icon-button'}
          title={`Lecture mode (${useApp.getState().settings.hotkeys.lecture})`}
          aria-label="Lecture mode"
          aria-pressed={lectureMode}
          onClick={onToggleLecture}
        >
          <Icon name="columns" />
        </button>
        <CloseButton path={path} />
      </div>
      <div
        ref={surfaceRef}
        className={`canvas-surface tool-${tool}${panning ? ' panning' : ''}`}
        tabIndex={0}
        data-path={path}
        aria-label={`Canvas ${title}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (e.key === ' ') space.current = false
        }}
        onPaste={onPaste}
        onDragOver={(e) => {
          if (draggingFiles(e)) e.preventDefault()
        }}
        onDrop={onDrop}
        style={{ '--canvas-zoom': camera.zoom } as React.CSSProperties}
      >
        <div className="canvas-world" style={{ transform }}>
          {groups.map(nodeView)}
          <CanvasEdges
            edges={allEdges.filter((e) => geometries.has(e.id))}
            geometries={geometries}
            selected={chosenEdges}
            proposals={proposals}
            draft={draft}
            guides={{ ...guides, view }}
          />
          {boxes.map(nodeView)}
          <EdgeLabels edges={allEdges} geometries={geometries} />
          {liveInk && (
            <svg className="canvas-edges" aria-hidden>
              <path
                d={strokeOutline(
                  {
                    id: '',
                    tool: 'pen',
                    author: 'me',
                    color: ink.penColor,
                    width: ink.penWidth,
                    points: liveInk
                  },
                  true
                )}
                fill={ink.penColor}
              />
            </svg>
          )}
          {marquee && (
            <div
              className="canvas-marquee"
              style={{
                left: marquee.x,
                top: marquee.y,
                width: marquee.width,
                height: marquee.height
              }}
            />
          )}
        </div>
        {!shown.nodes.length && (
          <p className="canvas-hint muted">
            Double-click to add a text box, or add a shape from the toolbar. Drag a dot on a
            box&apos;s edge to another box to connect them. Space or the middle mouse button drags
            the view, Ctrl+wheel zooms.
          </p>
        )}
        {edge && edgeAt && !ghost && (
          <EdgePanel
            key={edge.id}
            edge={edge}
            at={{ x: (edgeAt.x - camera.x) * camera.zoom, y: (edgeAt.y - camera.y) * camera.zoom }}
            doc={doc}
          />
        )}
        {ghost && (
          <div className="canvas-ghost-bar">
            <span>Claude&apos;s change</span>
            <button className="button primary" onClick={() => ghost.decide(true)}>
              Accept
            </button>
            <button className="button" onClick={() => ghost.decide(false)}>
              Reject
            </button>
          </div>
        )}
        {menu && (
          <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
        )}
      </div>
    </>
  )
}

function withColor<T extends { color?: string }>(item: T, color: string | undefined): T {
  const next = { ...item, color }
  if (!color) delete next.color
  return next
}

/** A selected arrow: its relation, label and multiplicities, by the middle of the arrow. */
function EdgePanel({
  edge,
  at,
  doc
}: {
  edge: CanvasEdge
  at: { x: number; y: number }
  doc: CanvasDoc
}): React.JSX.Element {
  // Typing in a field is one undo step, from focus to blur.
  const field = (name: 'label' | 'fromLabel' | 'toLabel', label: string): React.JSX.Element => (
    <label>
      <span className="muted">{label}</span>
      <input
        name={name}
        value={edge[name] ?? ''}
        onFocus={() => doc.getState().begin()}
        onBlur={() => doc.getState().end()}
        onChange={(e) => {
          const value = e.target.value
          doc.getState().update((d) =>
            updateEdge(d, edge.id, (x) => {
              const next = { ...x, [name]: value }
              if (!value) delete next[name]
              return next
            })
          )
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
        }}
      />
    </label>
  )
  return (
    <div
      className="canvas-edge-panel"
      style={{ left: at.x, top: at.y + 16 }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <label>
        <span className="muted">Relation</span>
        <select
          value={edge.relation ?? ''}
          onChange={(e) =>
            doc
              .getState()
              .change((d) =>
                updateEdge(d, edge.id, (x) =>
                  withRelation(x, (e.target.value || undefined) as Relation | undefined)
                )
              )
          }
        >
          <option value="">Arrow</option>
          {RELATIONS.map((r) => (
            <option key={r} value={r}>
              {RELATION_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      {field('fromLabel', 'Start')}
      {field('label', 'Label')}
      {field('toLabel', 'End')}
      <button
        className="text-button"
        title="Swap start and end"
        onClick={() =>
          doc.getState().change((d) =>
            updateEdge(d, edge.id, (x) => ({
              ...x,
              fromNode: x.toNode,
              toNode: x.fromNode,
              fromSide: x.toSide,
              toSide: x.fromSide,
              fromLabel: x.toLabel,
              toLabel: x.fromLabel
            }))
          )
        }
      >
        Swap
      </button>
    </div>
  )
}
