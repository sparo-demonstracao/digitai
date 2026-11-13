import { contextBridge, ipcRenderer } from 'electron'
import type { AudioPayload, BarStateMessage, DitadoApi, RecCommandMessage } from '../shared/ipc'

const api: DitadoApi = {
  onCommand: (cb) => {
    ipcRenderer.on('rec:command', (_e, msg: RecCommandMessage) => cb(msg))
  },
  onState: (cb) => {
    ipcRenderer.on('bar:state', (_e, msg: BarStateMessage) => cb(msg))
  },
  sendAudio: (payload: AudioPayload) => ipcRenderer.send('rec:audio', payload),
  sendError: (id, message) => ipcRenderer.send('rec:error', { id, message }),
  cardAction: (action, entryId) => ipcRenderer.send('bar:acao', { action, entryId }),
  setMouse: (mode) => ipcRenderer.send('bar:mouse', mode)
}

contextBridge.exposeInMainWorld('ditado', api)
