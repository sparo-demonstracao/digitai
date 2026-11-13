// Tipos trocados entre o processo principal e o painel de histórico.

export type HistoryStatus = 'ok' | 'erro'

export interface HistoryTimings {
  transcribeMs: number
  cleanupMs: number
  totalMs: number
}

export interface HistoryEntry {
  id: string
  at: string // ISO
  status: HistoryStatus
  error?: string // motivo, quando status = 'erro'
  app: string // executável onde o texto foi colado (ex.: chrome.exe)
  window: string // título da janela no momento do ditado
  durationMs: number // duração do áudio
  rawText: string // como veio da transcrição
  finalText: string // o que foi colado
  provider?: string // serviço de transcrição
  model?: string
  cleaned?: boolean // a limpeza com Claude rodou
  cleanupModel?: string // modelo que limpou (ex.: claude-haiku-5-5)
  audioFile?: string // nome do arquivo na pasta de áudios
  audioMime?: string
  timings: HistoryTimings
  retranscribedAt?: string
}

export interface PanelData {
  entries: HistoryEntry[] // mais recentes primeiro
  hotkeyLabel: string
  cleanupOn: boolean
}

export interface PanelAudio {
  data: Uint8Array
  mimeType: string
}

export type ProviderName = 'openrouter' | 'groq' | 'openai'
export type KeyName = ProviderName | 'anthropic'

export interface SettingsView {
  provider: ProviderName
  model: string // vazio = modelo recomendado do serviço
  defaultModels: Record<ProviderName, string>
  cleanup: boolean
  cleanupProvider: 'openrouter' | 'anthropic'
  cleanupModel: string // claude-haiku-5-5, claude-sonnet-5-5 ou claude-opus-5-5
  language: string // pt, en, es ou vazio (detectar)
  hotkey: string
  hotkeyLabel: string
  vocabulary: string[]
  keys: Record<KeyName, { set: boolean; hint: string }> // hint = 4 últimos caracteres
}

export interface SettingsPatch {
  provider?: ProviderName
  model?: string
  cleanup?: boolean
  cleanupProvider?: 'openrouter' | 'anthropic'
  cleanupModel?: string
  language?: string
  hotkey?: string
  vocabulary?: string[]
  keys?: Partial<Record<KeyName, string>>
}

export interface KeyCheck {
  ok: boolean
  message: string
}

export type PanelView = 'ditados' | 'configuracoes'

export interface PainelApi {
  load(): Promise<PanelData>
  copy(text: string): Promise<void>
  remove(id: string): Promise<void>
  audio(id: string): Promise<PanelAudio | null>
  retranscribe(id: string): Promise<HistoryEntry>
  onChanged(cb: () => void): void
  settings(): Promise<SettingsView>
  saveSettings(patch: SettingsPatch): Promise<SettingsView>
  verifyKey(name: KeyName): Promise<KeyCheck>
  pauseHotkey(paused: boolean): Promise<void> // enquanto grava um atalho novo
  onShow(cb: (view: PanelView) => void): void
}
