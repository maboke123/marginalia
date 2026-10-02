import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ChatEvent, ToolCall } from '../shared/claude'
import type { IpcResult, MarginaliaApi } from '../shared/types'

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
    readAnnotations: (pdf) => invoke('vault:readAnnotations', pdf),
    writeAnnotations: (pdf, file) => invoke('vault:writeAnnotations', pdf, file),
    onChanged: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on('vault:changed', handler)
      return () => ipcRenderer.removeListener('vault:changed', handler)
    }
  },
  claude: {
    settings: () => invoke('claude:settings'),
    setSettings: (update) => invoke('claude:setSettings', update),
    send: (request) => invoke('claude:send', request),
    stop: () => invoke('claude:stop'),
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
    readyToClose: () => ipcRenderer.send('app:ready-to-close')
  },
  files: {
    pathFor: (file) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('api', api)
