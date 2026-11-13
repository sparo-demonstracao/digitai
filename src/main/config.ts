import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import dotenv from 'dotenv'
import type { KeyName, SettingsPatch, SettingsView } from '../shared/painel'

export type TranscribeProvider = 'groq' | 'openai' | 'openrouter'
export type CleanupProvider = 'openrouter' | 'anthropic'

export interface Config {
  transcribeProvider: TranscribeProvider
  transcribeApiKey: string
  transcribeModel: string
  cleanupProvider: CleanupProvider // OpenRouter (mesma chave da transcrição) ou Anthropic direto
  cleanupApiKey: string
  claudeModel: string // id da Anthropic (claude-haiku-5-5); no OpenRouter vira anthropic/claude-haiku-5.5
  cleanup: boolean
  language: string
  hotkey: string
  vocabulary: string[]
  testText: string // modo de teste: pula a transcrição e cola este texto
  testAudio: string // modo de teste: transcreve este arquivo WAV no lugar do microfone
  envPath: string
}

export const DEFAULT_MODELS: Record<TranscribeProvider, string> = {
  groq: 'whisper-large-v3-turbo',
  openai: 'gpt-4o-mini-transcribe',
  // Melhor resultado num teste com nomes próprios e termos em inglês (out/2026), em ~3 s por frase.
  openrouter: 'google/gemini-4-argon'
}

// Modelos oferecidos para a limpeza, do mais rápido ao mais capaz.
export const CLEANUP_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] as const

/** "claude-haiku-5-5" → "anthropic/claude-haiku-5.5" (nome do mesmo modelo no OpenRouter). */
export function openRouterModelId(model: string): string {
  if (model.includes('/')) return model
  return `anthropic/${model.replace(/-(\d+)-(\d+)$/, '-$1.$2')}`
}

export const SERVICE_NAMES: Record<KeyName, string> = {
  openrouter: 'OpenRouter',
  groq: 'Groq',
  openai: 'OpenAI',
  anthropic: 'Anthropic'
}

const KEY_VARS: Record<KeyName, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY'
}

// Em desenvolvimento o .env fica na raiz do projeto; instalado, fica na pasta de dados do app.
export function envFilePath(): string {
  const candidates = [join(process.cwd(), '.env'), join(app.getPath('userData'), '.env')]
  return candidates.find((p) => existsSync(p)) ?? candidates[app.isPackaged ? 1 : 0]
}

type Getter = (key: string, fallback?: string) => string

function readEnv(envPath = envFilePath()): Getter {
  const parsed = existsSync(envPath) ? dotenv.parse(readFileSync(envPath)) : {}
  // Aceita o nome em maiúsculas ou minúsculas (OPENAI_API_key também vale); valor preenchido ganha de vazio.
  const file: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    const upper = key.toUpperCase()
    if (value.trim() || !(upper in file)) file[upper] = value
  }
  // O arquivo (que o painel edita) manda; variáveis de ambiente só valem para o que ele não define.
  return (key, fallback = '') => {
    const fromFile = file[key]?.trim()
    if (fromFile) return fromFile
    const fromEnv = process.env[key]?.trim()
    if (fromEnv) return fromEnv
    return fromFile ?? fallback
  }
}

function providerOf(get: Getter): TranscribeProvider {
  const name = get('TRANSCRIBE_PROVIDER', 'openrouter').toLowerCase()
  return name in DEFAULT_MODELS ? (name as TranscribeProvider) : 'openrouter'
}

export function loadConfig(): Config {
  const envPath = envFilePath()
  const get = readEnv(envPath)
  const provider = providerOf(get)
  const anthropicKey = get(KEY_VARS.anthropic)
  const cleanupName = get('CLEANUP_PROVIDER').toLowerCase()
  // Sem escolha salva: Anthropic se houver a chave dela, senão OpenRouter.
  const cleanupProvider: CleanupProvider =
    cleanupName === 'anthropic' || cleanupName === 'openrouter' ? cleanupName : anthropicKey ? 'anthropic' : 'openrouter'

  return {
    transcribeProvider: provider,
    transcribeApiKey: get(KEY_VARS[provider]),
    transcribeModel: get('TRANSCRIBE_MODEL') || DEFAULT_MODELS[provider],
    cleanupProvider,
    cleanupApiKey: cleanupProvider === 'anthropic' ? anthropicKey : get(KEY_VARS.openrouter),
    claudeModel: get('CLAUDE_MODEL', 'claude-haiku-5-5'),
    cleanup: get('CLEANUP', 'on').toLowerCase() !== 'off',
    language: get('LANGUAGE', 'pt').toLowerCase(),
    hotkey: get('HOTKEY', 'leftalt+v').toLowerCase(),
    vocabulary: get('DICIONARIO')
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean),
    testText: get('TESTE_TEXTO'),
    testAudio: get('TESTE_AUDIO'),
    envPath
  }
}

export function readKey(name: KeyName): string {
  return readEnv()(KEY_VARS[name])
}

// Retorna a lista de problemas que impedem o ditado de funcionar.
// Sem a chave da Anthropic o ditado funciona: só pula a limpeza e cola a transcrição como veio.
export function configProblems(config: Config): string[] {
  const problems: string[] = []
  if (!config.transcribeApiKey && !config.testText) {
    problems.push(`Falta a chave da ${SERVICE_NAMES[config.transcribeProvider]}`)
  }
  return problems
}

export function cleanupActive(config: Config): boolean {
  return config.cleanup && !!config.cleanupApiKey
}

/** O que a tela de configurações mostra. As chaves nunca saem inteiras: só os 4 últimos caracteres. */
export function settingsView(hotkeyLabel: string): SettingsView {
  const get = readEnv()
  const config = loadConfig()
  const keys = {} as SettingsView['keys']
  for (const name of Object.keys(KEY_VARS) as KeyName[]) {
    const value = get(KEY_VARS[name])
    keys[name] = { set: !!value, hint: value ? value.slice(-4) : '' }
  }
  return {
    provider: config.transcribeProvider,
    model: get('TRANSCRIBE_MODEL'),
    defaultModels: DEFAULT_MODELS,
    cleanup: config.cleanup,
    cleanupProvider: config.cleanupProvider,
    cleanupModel: config.claudeModel,
    language: get('LANGUAGE', 'pt').toLowerCase(),
    hotkey: config.hotkey,
    hotkeyLabel,
    vocabulary: config.vocabulary,
    keys
  }
}

// Valores com espaço, # ou aspas vão entre aspas duplas; quebras de linha e aspas internas saem.
function envValue(value: string): string {
  const clean = value.replace(/[\r\n"]/g, '').trim()
  return /[\s#']/.test(clean) ? `"${clean}"` : clean
}

/** Grava as mudanças no .env, mantendo comentários, ordem e as demais linhas. */
export function saveSettings(patch: SettingsPatch): void {
  const updates: Record<string, string> = {}
  if (patch.provider) {
    updates.TRANSCRIBE_PROVIDER = patch.provider
    // Trocar de serviço volta para o modelo recomendado dele, a menos que um modelo venha junto.
    if (patch.model === undefined) updates.TRANSCRIBE_MODEL = ''
  }
  if (patch.model !== undefined) updates.TRANSCRIBE_MODEL = patch.model.trim()
  if (patch.cleanup !== undefined) updates.CLEANUP = patch.cleanup ? 'on' : 'off'
  if (patch.cleanupProvider !== undefined) updates.CLEANUP_PROVIDER = patch.cleanupProvider
  if (patch.cleanupModel !== undefined) updates.CLAUDE_MODEL = patch.cleanupModel
  if (patch.language !== undefined) updates.LANGUAGE = patch.language
  if (patch.hotkey !== undefined) updates.HOTKEY = patch.hotkey
  if (patch.vocabulary !== undefined) updates.DICIONARIO = patch.vocabulary.map((w) => w.replace(/,/g, ' ').trim()).filter(Boolean).join(', ')
  for (const [name, value] of Object.entries(patch.keys ?? {}) as [KeyName, string][]) {
    updates[KEY_VARS[name]] = value.trim()
  }
  if (Object.keys(updates).length === 0) return

  const path = envFilePath()
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : []
  for (const [key, value] of Object.entries(updates)) {
    const matches = (line: string) => new RegExp(`^\\s*${key}\\s*=`, 'i').test(line)
    const line = `${key}=${envValue(value)}`
    const index = lines.findIndex(matches)
    if (index < 0) {
      if (lines.length && lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, line)
      else lines.push(line)
      continue
    }
    lines[index] = line
    // Remove repetições da mesma variável (ex.: OPENAI_API_key escrito à mão mais abaixo).
    for (let i = lines.length - 1; i > index; i--) if (matches(lines[i])) lines.splice(i, 1)
  }
  const tmp = path + '.tmp'
  writeFileSync(tmp, lines.join('\n'), 'utf8')
  renameSync(tmp, path)
}
