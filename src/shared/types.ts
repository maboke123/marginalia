export type NodeKind = 'notebook' | 'section' | 'markdown' | 'pdf'

import type { AnnotationFile, LoadedAnnotations } from './annotations'
import type { AppSettings } from './settings'
import type {
  ChatEvent,
  ChatHistoryItem,
  ChatRequest,
  ClaudeSettings,
  ClaudeSettingsUpdate,
  ToolCall,
  ToolReply
} from './claude'

export interface VaultNode {
  /** File or folder name on disk, including extension. */
  name: string
  /** Path relative to the vault root, always with forward slashes. */
  path: string
  kind: NodeKind
  children?: VaultNode[]
}

export interface VaultInfo {
  root: string
  name: string
}

export interface VaultTree {
  nodes: VaultNode[]
  /** Notebook name -> colour name. */
  colors: Record<string, NotebookColor>
}

export const NOTEBOOK_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'pink',
  'gray'
] as const

export type NotebookColor = (typeof NOTEBOOK_COLORS)[number]

/**
 * Where to put a moved item among its new siblings.
 * `undefined` leaves the manual order alone, `null` appends, a name inserts before that sibling.
 */
export type Position = string | null | undefined

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

export interface MarginaliaApi {
  vault: {
    current(): Promise<VaultInfo | null>
    recent(): Promise<string[]>
    pick(): Promise<VaultInfo | null>
    open(root: string): Promise<VaultInfo>
    tree(): Promise<VaultTree>
    createFolder(parent: string, name: string): Promise<string>
    createNote(parent: string, name: string): Promise<string>
    rename(path: string, name: string): Promise<string>
    move(path: string, parent: string, before?: Position): Promise<string>
    trash(path: string): Promise<boolean>
    reveal(path: string): Promise<void>
    setColor(notebook: string, color: NotebookColor | null): Promise<void>
    /** Opens a file dialog; returns absolute paths of the chosen PDFs (empty when cancelled). */
    pickPdfs(): Promise<string[]>
    /** Copies PDFs from anywhere on disk into a section; returns their vault paths. */
    importPdfs(parent: string, sources: string[]): Promise<string[]>
    readFile(path: string): Promise<Uint8Array>
    lastPage(path: string): Promise<number | null>
    setLastPage(path: string, page: number): Promise<void>
    readText(note: string): Promise<string>
    writeText(note: string, text: string): Promise<void>
    /** Saves image bytes into the note's assets folder; returns the link relative to the note. */
    saveAsset(note: string, data: Uint8Array, extension: string): Promise<string>
    /** Asks for image files and copies them into the note's assets folder. */
    importImages(note: string): Promise<string[]>
    readAnnotations(pdf: string): Promise<LoadedAnnotations>
    writeAnnotations(pdf: string, file: AnnotationFile): Promise<void>
    onChanged(listener: () => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    /** Saves a change and returns all settings as stored. */
    set(change: Partial<AppSettings>): Promise<AppSettings>
  }
  search: {
    query(query: string): Promise<SearchResult>
    /** PDFs whose text the renderer should extract and hand over with storePdf. */
    pending(): Promise<PdfToIndex[]>
    storePdf(path: string, stamp: string, pages: string[]): Promise<void>
  }
  claude: {
    settings(): Promise<ClaudeSettings>
    setSettings(update: ClaudeSettingsUpdate): Promise<ClaudeSettings>
    /** Resolves when Claude has finished answering; the answer arrives through onEvent. */
    send(request: ChatRequest): Promise<void>
    stop(): Promise<void>
    history(chat: string): Promise<ChatHistoryItem[]>
    /** Forgets the section's conversation, so the next message starts a new one. */
    newChat(chat: string): Promise<void>
    onEvent(listener: (chat: string, event: ChatEvent) => void): () => void
    onToolCall(listener: (call: ToolCall) => void): () => void
    replyTool(reply: ToolReply): void
  }
  app: {
    /** The window is about to close; save everything, then call readyToClose(). */
    onBeforeClose(listener: () => void): () => void
    readyToClose(): void
  }
  files: {
    /** Absolute path of a file dropped from Explorer. */
    pathFor(file: File): string
  }
}

export interface SearchHit {
  path: string
  kind: 'pdf' | 'markdown'
  /** PDF page, 1-based. */
  page?: number
  /** Line in the note where the matching paragraph starts, 1-based. */
  line?: number
  snippet: string
  /** [start, end) of the matched words in `snippet`. */
  marks: [number, number][]
}

export interface SearchResult {
  hits: SearchHit[]
  /** More hits exist than were returned. */
  truncated: boolean
  /** PDFs whose text is not indexed yet, so they are not searched. */
  unindexed: number
}

export interface PdfToIndex {
  path: string
  /** Changes when the file changes (mtime and size). */
  stamp: string
}
