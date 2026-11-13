import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { HistoryEntry } from '../shared/painel'

// Áudios guardados para ouvir e transcrever de novo; os mais antigos saem (~10 s de WAV ≈ 320 KB).
const MAX_AUDIOS = 300

export function historyFile(): string {
  return join(app.getPath('userData'), 'historico.jsonl')
}

function audioDir(): string {
  return join(app.getPath('userData'), 'audios')
}

export function newHistoryId(): string {
  return randomUUID()
}

// Registros antigos não tinham id nem status.
function normalize(raw: Partial<HistoryEntry> & { at: string }): HistoryEntry {
  return {
    id: raw.id ?? `antigo-${raw.at}`,
    status: raw.status ?? 'ok',
    app: raw.app ?? '',
    window: raw.window ?? '',
    durationMs: raw.durationMs ?? 0,
    rawText: raw.rawText ?? '',
    finalText: raw.finalText ?? '',
    timings: raw.timings ?? { transcribeMs: 0, cleanupMs: 0, totalMs: 0 },
    ...raw
  } as HistoryEntry
}

function readAll(): HistoryEntry[] {
  if (!existsSync(historyFile())) return []
  const entries: HistoryEntry[] = []
  for (const line of readFileSync(historyFile(), 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      entries.push(normalize(JSON.parse(line)))
    } catch {
      // linha corrompida: ignora em vez de perder o histórico inteiro
    }
  }
  return entries
}

// Reescreve o arquivo inteiro de forma atômica (arquivo temporário + renomear).
function writeAll(entries: HistoryEntry[]): void {
  const tmp = historyFile() + '.tmp'
  writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''), 'utf8')
  renameSync(tmp, historyFile())
}

/** Todos os ditados, mais recentes primeiro. */
export function listHistory(): HistoryEntry[] {
  return readAll().reverse()
}

export function findHistory(id: string): HistoryEntry | undefined {
  return readAll().find((e) => e.id === id)
}

// Uma linha JSON por ditado. Na fase do dicionário isso vira um banco SQLite.
export function saveHistory(entry: HistoryEntry): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    appendFileSync(historyFile(), JSON.stringify(entry) + '\n', 'utf8')
  } catch {
    // histórico é opcional
  }
}

export function updateHistory(id: string, patch: Partial<HistoryEntry>): HistoryEntry | null {
  const entries = readAll()
  const index = entries.findIndex((e) => e.id === id)
  if (index < 0) return null
  const updated = { ...entries[index], ...patch, id }
  // JSON.stringify descarta campos undefined, então `error: undefined` apaga o erro antigo.
  entries[index] = updated
  writeAll(entries)
  return updated
}

export function deleteHistory(id: string): void {
  const entries = readAll()
  const entry = entries.find((e) => e.id === id)
  if (!entry) return
  writeAll(entries.filter((e) => e.id !== id))
  if (entry.audioFile) rmSync(join(audioDir(), entry.audioFile), { force: true })
}

/** Guarda o áudio do ditado e devolve o nome do arquivo. */
export function saveAudio(id: string, data: Uint8Array, mimeType: string): string | undefined {
  try {
    mkdirSync(audioDir(), { recursive: true })
    const file = `${id}.${mimeType.includes('wav') ? 'wav' : 'webm'}`
    writeFileSync(join(audioDir(), file), data)
    pruneAudios()
    return file
  } catch {
    return undefined
  }
}

export function readAudio(entry: HistoryEntry): Buffer | null {
  if (!entry.audioFile) return null
  const path = join(audioDir(), entry.audioFile)
  return existsSync(path) ? readFileSync(path) : null
}

function pruneAudios(): void {
  const files = readdirSync(audioDir())
  if (files.length <= MAX_AUDIOS) return
  files
    .map((name) => ({ name, time: statSync(join(audioDir(), name)).mtimeMs }))
    .sort((a, b) => a.time - b.time)
    .slice(0, files.length - MAX_AUDIOS)
    .forEach(({ name }) => rmSync(join(audioDir(), name), { force: true }))
}
