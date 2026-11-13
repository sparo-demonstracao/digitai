// Tipos trocados entre o processo principal e a barra flutuante.

export type BarState = 'idle' | 'recording' | 'processing' | 'done' | 'error' | 'info' | 'card'

export type RecCommand = 'start' | 'stop' | 'cancel'

export type CardAction = 'colar' | 'copiar' | 'painel'

/** O que a barra faz com o mouse: ignora (cliques atravessam), acompanha o movimento ou aceita cliques. */
export type BarMouse = 'ignore' | 'watch' | 'interactive'

/** Cartão clicável que substitui a barrinha por alguns segundos (ex.: transcrição que deu certo na nova tentativa). */
export interface BarCard {
  entryId: string
  title: string
  text: string
  actions: CardAction[]
  tone?: 'ok' | 'erro'
}

/** Microfone travado: a barra mostra um cadeado e o tempo gravado. */
export interface BarLock {
  elapsedMs: number // já gravado quando travou
  limitMs: number // depois disso o ditado termina sozinho
}

export interface BarStateMessage {
  state: BarState
  message?: string
  card?: BarCard
  lock?: BarLock
}

export interface RecCommandMessage {
  command: RecCommand
  id: number
  quiet?: boolean // cancelar sem bipe (toque rápido no atalho)
  beepDelayMs?: number // espera mínima antes do bipe de início
}

export interface AudioPayload {
  id: number
  data: Uint8Array
  mimeType: string
  durationMs: number
  peak: number // volume máximo (0 a 1) durante a gravação
}

export interface DitadoApi {
  onCommand(cb: (msg: RecCommandMessage) => void): void
  onState(cb: (msg: BarStateMessage) => void): void
  sendAudio(payload: AudioPayload): void
  sendError(id: number, message: string): void
  cardAction(action: CardAction, entryId: string): void
  setMouse(mode: BarMouse): void
}
