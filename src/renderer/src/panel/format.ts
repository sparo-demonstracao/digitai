import type { HistoryEntry } from '../../../shared/painel'

const APP_NAMES: Record<string, string> = {
  'claude.exe': 'Claude',
  'chrome.exe': 'Chrome',
  'msedge.exe': 'Edge',
  'firefox.exe': 'Firefox',
  'brave.exe': 'Brave',
  'notepad.exe': 'Bloco de notas',
  'whatsapp.exe': 'WhatsApp',
  'whatsapp.root.exe': 'WhatsApp',
  'slack.exe': 'Slack',
  'discord.exe': 'Discord',
  'telegram.exe': 'Telegram',
  'ms-teams.exe': 'Teams',
  'outlook.exe': 'Outlook',
  'olk.exe': 'Outlook',
  'code.exe': 'VS Code',
  'cursor.exe': 'Cursor',
  'windowsterminal.exe': 'Terminal',
  'winword.exe': 'Word',
  'excel.exe': 'Excel',
  'notion.exe': 'Notion',
  'obsidian.exe': 'Obsidian',
  'explorer.exe': 'Explorador de Arquivos'
}

export function appName(processName: string): string {
  if (!processName) return 'App desconhecido'
  const known = APP_NAMES[processName.toLowerCase()]
  if (known) return known
  const bare = processName.replace(/\.exe$/i, '')
  return bare.charAt(0).toUpperCase() + bare.slice(1)
}

// "google/gemini-4-argon" → "Gemini 4 Argon"; "claude-haiku-5-5" → "Claude Haiku 5.5"
export function modelName(model?: string): string {
  if (!model) return ''
  const bare = model.includes('/') ? model.slice(model.indexOf('/') + 1) : model
  const words: string[] = []
  for (const part of bare.split('-')) {
    const last = words[words.length - 1]
    // Números seguidos formam a versão: 5-5 → 5.5
    if (/^\d+$/.test(part) && last && /^\d+(\.\d+)*$/.test(last)) words[words.length - 1] = `${last}.${part}`
    else words.push(/^gpt$/i.test(part) ? 'GPT' : part.charAt(0).toUpperCase() + part.slice(1))
  }
  return words.join(' ')
}

const number = new Intl.NumberFormat('pt-BR')
export const formatNumber = (n: number): string => number.format(n)

export function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0
}

/** Duração do áudio, como um relógio: 0:08, 1:42. */
export function clock(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Tempo de processamento: 3,5 s · 820 ms. */
export function seconds(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s`
}

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const longDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
const longDateYear = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export const timeOf = (iso: string): string => time.format(new Date(iso))

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** "Hoje", "Ontem" ou "terça-feira, 13 de outubro". */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (dayKey(d) === dayKey(now)) return 'Hoje'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(d) === dayKey(yesterday)) return 'Ontem'
  const label = (d.getFullYear() === now.getFullYear() ? longDate : longDateYear).format(d)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** "Quarta-feira, 14 de outubro de 2026, 14:13"; no meio de uma frase, use capitalize = false. */
export function fullDate(iso: string, capitalize = true): string {
  const label = longDateYear.format(new Date(iso))
  return `${capitalize ? label.charAt(0).toUpperCase() + label.slice(1) : label}, ${timeOf(iso)}`
}

export interface DayGroup {
  label: string
  entries: HistoryEntry[]
}

export function groupByDay(entries: HistoryEntry[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const entry of entries) {
    const label = dayLabel(entry.at)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }
  return groups
}

/** Remove acentos e caixa para a busca: "voce" encontra "você". */
export function searchable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}


/** Mensagem limpa de um erro vindo do processo principal. */
export function ipcMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
