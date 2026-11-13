import { contextBridge, ipcRenderer } from 'electron'
import type { PainelApi, PanelView } from '../shared/painel'

const api: PainelApi = {
  load: () => ipcRenderer.invoke('painel:dados'),
  copy: (text) => ipcRenderer.invoke('painel:copiar', text),
  remove: (id) => ipcRenderer.invoke('painel:excluir', id),
  audio: (id) => ipcRenderer.invoke('painel:audio', id),
  retranscribe: (id) => ipcRenderer.invoke('painel:retranscrever', id),
  onChanged: (cb) => {
    ipcRenderer.on('painel:mudou', () => cb())
  },
  settings: () => ipcRenderer.invoke('painel:config'),
  saveSettings: (patch) => ipcRenderer.invoke('painel:salvar-config', patch),
  verifyKey: (name) => ipcRenderer.invoke('painel:verificar-chave', name),
  pauseHotkey: (paused) => ipcRenderer.invoke('painel:pausar-atalho', paused),
  onShow: (cb) => {
    ipcRenderer.on('painel:mostrar', (_e, view: PanelView) => cb(view))
  }
}

contextBridge.exposeInMainWorld('painel', api)
