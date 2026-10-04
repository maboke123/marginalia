export type NodeKind = 'notebook' | 'section' | 'markdown' | 'pdf'

import type { AnnotationFile, LoadedAnnotations } from './annotations'
import type { AppSettings } from './settings'
import type {
  CompleteRequest,
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
  /** PDF path -> the note linked to it in lecture mode. */
  notes: Record<string, string>
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
    /** Saves image bytes into the assets folder next to a note or PDF; returns the path relative to it. */
    saveAsset(note: string, data: Uint8Array, extension: string): Promise<string>
    /** Asks for image files and copies them into the note's assets folder. */
    importImages(note: string): Promise<string[]>
    /** The note that goes with a PDF in lecture mode, if one was linked and still exists. */
    linkedNote(pdf: string): Promise<string | null>
    linkedPdf(note: string): Promise<string | null>
    setLinkedNote(pdf: string, note: string | null): Promise<void>
    readAnnotations(pdf: string): Promise<LoadedAnnotations>
    writeAnnotations(pdf: string, file: AnnotationFile): Promise<void>
    /** Asks where to save, then writes a copy with the annotations drawn in. Null when cancelled. */
    exportPdf(pdf: string): Promise<ExportedPdf | null>
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
  transcribe: {
    status(): Promise<TranscribeStatus>
    /** Downloads the missing parts; progress arrives through onInstallProgress. */
    install(parts: TranscribePart[]): Promise<void>
    onInstallProgress(listener: (part: TranscribePart, done: number) => void): () => void
    /** Starts a live recording into a new transcript note in `folder`; returns its path. */
    start(folder: string, transcribeLive: boolean): Promise<string>
    /** The slide I opened, from this moment of the recording on. */
    slide(moment: { at: number; pdf: string; page: number }): Promise<void>
    /** Compressed audio of the recording, kept next to the transcript. */
    audio(data: Uint8Array): Promise<void>
    chunk(chunk: LiveChunk): Promise<void>
    /** Resolves once everything sent so far is transcribed. */
    stop(): Promise<void>
    onStatus(listener: (status: RecordingStatus) => void): () => void
    /** Asks for a video or audio file; null when cancelled. */
    pickRecording(): Promise<string | null>
    /** Queues a recording file for transcription; returns the job id. Progress via onJob. */
    transcribeFile(request: TranscribeFileRequest): Promise<string>
    /** Queues a transcript recorded without live transcription; returns the job id. */
    transcribeRecorded(request: TranscribeRecordedRequest): Promise<string>
    cancelJob(id: string): Promise<void>
    onJob(listener: (job: TranscribeJob) => void): () => void
  }
  terminal: {
    /** Starts the CLI in the vault folder, or attaches to the running one (with its output). */
    start(cols: number, rows: number): Promise<TerminalSession>
    stop(): Promise<void>
    input(data: string): void
    resize(cols: number, rows: number): void
    onData(listener: (data: string) => void): () => void
    onExit(listener: (code: number) => void): () => void
  }
  claude: {
    settings(): Promise<ClaudeSettings>
    setSettings(update: ClaudeSettingsUpdate): Promise<ClaudeSettings>
    /** Resolves when Claude has finished answering; the answer arrives through onEvent. */
    send(request: ChatRequest): Promise<void>
    stop(): Promise<void>
    /** One request, one answer: text to put into a note (/claude in the editor). */
    complete(request: CompleteRequest): Promise<string>
    cancelComplete(id: string): Promise<void>
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
    /** Adds an entry to feedback.md in the app's data folder. */
    saveFeedback(entry: FeedbackEntry): Promise<void>
    /** Opens feedback.md in the default editor. */
    openFeedback(): Promise<void>
    /** Build version, 0.1.<commit count> for a deployed build. */
    version: string
  }
  files: {
    /** Absolute path of a file dropped from Explorer. */
    pathFor(file: File): string
  }
}

export interface TerminalSession {
  /** Recent output of a session that was already running, to redraw the screen. */
  output: string
}

/** Pieces of the speech-to-text setup, downloaded on first use. */
export type TranscribePart = 'program' | 'vad' | 'small' | 'accurate'

export interface TranscribeStatus {
  installed: Record<TranscribePart, boolean>
  /** Download sizes in bytes. */
  sizes: Record<TranscribePart, number>
}

/** About 30 s of a lecture being recorded, cut at a pause. */
export interface LiveChunk {
  /** 16 kHz mono 16-bit samples. */
  pcm: Uint8Array
  /** Seconds from the start of the recording. */
  at: number
  /** "nl", "en" or "auto". */
  language: string
  /** Markdown link to the slide that was on screen, if any. */
  marker?: string
  /** Text of that slide, so course terms are spelled right. */
  prompt?: string
}

export interface TranscribeFileRequest {
  folder: string
  /** Absolute path of the video or audio file. */
  source: string
  model: 'small' | 'accurate'
  /** "nl", "en" or "auto". */
  language: string
}

/** A transcript recorded without live transcription, to be transcribed from its audio. */
export interface TranscribeRecordedRequest {
  /** Vault path of the transcript note. */
  note: string
  model: 'small' | 'accurate'
  language: string
}

export type TranscribeJobPhase = 'waiting' | 'downloading' | 'reading' | 'transcribing' | 'writing'

/** A recording file being transcribed in the background. */
export interface TranscribeJob {
  id: string
  /** File name of the recording. */
  name: string
  folder: string
  phase: TranscribeJobPhase
  /** Of the current phase, 0 to 100. */
  percent: number
  /** Set when done. */
  transcript?: string
  error?: string
}

export interface RecordingStatus {
  /** Vault path of the transcript note. */
  transcript: string
  /** Chunks waiting to be transcribed. */
  pending: number
  /** Seconds of the recording that are in the transcript. */
  transcribedTo: number
  error: string | null
}

export interface FeedbackEntry {
  text: string
  /** What was open, e.g. "ML/les_3/B2 Decision trees.pdf, page 31". */
  context?: string
}

export interface ExportedPdf {
  /** Absolute path of the new file. */
  path: string
  /** Rotated pages, copied without their annotations. */
  skippedPages: number
  /** Images on pages whose file was gone, left out of the copy. */
  missingImages: number
  /** The PDF changed since it was annotated, so annotations may sit on the wrong slides. */
  pdfChanged: boolean
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
