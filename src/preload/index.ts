import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ChatEvent, ToolCall } from '../shared/claude'
import type { IpcResult, MarginaliaApi, RecordingStatus, TranscribePart } from '../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result: IpcResult<T> = await ipcRenderer.invoke(channel, ...args)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const api: MarginaliaApi = {
  vault: {
    current: () => invoke('vault:current'),
    recent: () => invoke('vault:recent'),
    pick: () => invoke('vault:pick'),
    open: (root) => invoke('vault:open', root),
    tree: () => invoke('vault:tree'),
    createFolder: (parent, name) => invoke('vault:createFolder', parent, name),
    createNote: (parent, name) => invoke('vault:createNote', parent, name),
    rename: (path, name) => invoke('vault:rename', path, name),
    move: (path, parent, before) => invoke('vault:move', path, parent, before),
    trash: (path) => invoke('vault:trash', path),
    reveal: (path) => invoke('vault:reveal', path),
    setColor: (notebook, color) => invoke('vault:setColor', notebook, color),
    pickPdfs: () => invoke('vault:pickPdfs'),
    importPdfs: (parent, sources) => invoke('vault:importPdfs', parent, sources),
    readFile: (path) => invoke('vault:readFile', path),
    lastPage: (path) => invoke('vault:lastPage', path),
    setLastPage: (path, page) => invoke('vault:setLastPage', path, page),
    readText: (note) => invoke('vault:readText', note),
    writeText: (note, text) => invoke('vault:writeText', note, text),
    saveAsset: (note, data, extension) => invoke('vault:saveAsset', note, data, extension),
    importImages: (note) => invoke('vault:importImages', note),
    linkedNote: (pdf) => invoke('vault:linkedNote', pdf),
    linkedPdf: (note) => invoke('vault:linkedPdf', note),
    setLinkedNote: (pdf, note) => invoke('vault:setLinkedNote', pdf, note),
    readAnnotations: (pdf) => invoke('vault:readAnnotations', pdf),
    writeAnnotations: (pdf, file) => invoke('vault:writeAnnotations', pdf, file),
    exportPdf: (pdf) => invoke('vault:exportPdf', pdf),
    onChanged: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on('vault:changed', handler)
      return () => ipcRenderer.removeListener('vault:changed', handler)
    }
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (change) => invoke('settings:set', change)
  },
  search: {
    query: (query) => invoke('search:query', query),
    pending: () => invoke('search:pending'),
    storePdf: (path, stamp, pages) => invoke('search:storePdf', path, stamp, pages)
  },
  transcribe: {
    status: () => invoke('transcribe:status'),
    install: (parts) => invoke('transcribe:install', parts),
    onInstallProgress: (listener) => {
      const handler = (_e: unknown, p: { part: TranscribePart; done: number }): void =>
        listener(p.part, p.done)
      ipcRenderer.on('transcribe:install-progress', handler)
      return () => ipcRenderer.removeListener('transcribe:install-progress', handler)
    },
    start: (folder) => invoke('record:start', folder),
    audio: (data) => invoke('record:audio', data),
    chunk: (chunk) => invoke('record:chunk', chunk),
    stop: () => invoke('record:stop'),
    onStatus: (listener) => {
      const handler = (_e: unknown, status: RecordingStatus): void => listener(status)
      ipcRenderer.on('record:status', handler)
      return () => ipcRenderer.removeListener('record:status', handler)
    }
  },
  terminal: {
    start: (cols, rows) => invoke('terminal:start', cols, rows),
    stop: () => invoke('terminal:stop'),
    input: (data) => ipcRenderer.send('terminal:input', data),
    resize: (cols, rows) => ipcRenderer.send('terminal:resize', cols, rows),
    onData: (listener) => {
      const handler = (_e: unknown, data: string): void => listener(data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },
    onExit: (listener) => {
      const handler = (_e: unknown, code: number): void => listener(code)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    }
  },
  claude: {
    settings: () => invoke('claude:settings'),
    setSettings: (update) => invoke('claude:setSettings', update),
    send: (request) => invoke('claude:send', request),
    stop: () => invoke('claude:stop'),
    complete: (request) => invoke('claude:complete', request),
    cancelComplete: (id) => invoke('claude:cancelComplete', id),
    history: (chat) => invoke('claude:history', chat),
    newChat: (chat) => invoke('claude:newChat', chat),
    onEvent: (listener) => {
      const handler = (_e: unknown, chat: string, event: ChatEvent): void => listener(chat, event)
      ipcRenderer.on('claude:event', handler)
      return () => ipcRenderer.removeListener('claude:event', handler)
    },
    onToolCall: (listener) => {
      const handler = (_e: unknown, call: ToolCall): void => listener(call)
      ipcRenderer.on('claude:tool', handler)
      return () => ipcRenderer.removeListener('claude:tool', handler)
    },
    replyTool: (reply) => ipcRenderer.send('claude:tool-reply', reply)
  },
  app: {
    onBeforeClose: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on('app:before-close', handler)
      return () => ipcRenderer.removeListener('app:before-close', handler)
    },
    readyToClose: () => ipcRenderer.send('app:ready-to-close'),
    saveFeedback: (entry) => invoke('app:feedback', entry),
    openFeedback: () => invoke('app:openFeedback'),
    version: ipcRenderer.sendSync('app:version') as string
  },
  files: {
    pathFor: (file) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('api', api)
