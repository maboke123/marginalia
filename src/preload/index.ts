import { contextBridge, ipcRenderer } from 'electron'
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
    onChanged: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on('vault:changed', handler)
      return () => ipcRenderer.removeListener('vault:changed', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
