import Anthropic from '@anthropic-ai/sdk'
import { openRouterModelId, type Config } from './config'
import { buildCleanupMessage, categorize, CLEANUP_SYSTEM_PROMPT } from './prompts'
import type { ActiveWindow } from './win32'
import { log } from './logger'

let client: Anthropic | null = null
let clientKey = ''

function getClient(apiKey: string): Anthropic {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 })
    clientKey = apiKey
  }
  return client
}

// Sonnet 5.5 e Opus 5.5 podem recusar por engano; o fallback do servidor responde com outro modelo.
const WITH_SERVER_FALLBACK = new Set(['claude-sonnet-5-5', 'claude-opus-5-5'])

/** Limpeza direto na Anthropic, com a chave da Anthropic. */
async function cleanupWithAnthropic(user: string, config: Config): Promise<string | null> {
  const params = {
    model: config.claudeModel,
    max_tokens: 8000,
    // Ditado precisa de resposta rápida: pouco raciocínio (no Haiku 5.5 costuma ser nenhum).
    output_config: { effort: 'low' as const },
    system: CLEANUP_SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: user }]
  }
  try {
    const response = WITH_SERVER_FALLBACK.has(config.claudeModel)
      ? await getClient(config.cleanupApiKey).beta.messages.create({
          ...params,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default'
        })
      : await getClient(config.cleanupApiKey).messages.create(params)

    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      log.warn(`Limpeza ignorada (stop_reason=${response.stop_reason}); colando texto bruto`)
      return null
    }
    return response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) log.error('Chave da Anthropic inválida; colando texto bruto')
    else if (err instanceof Anthropic.RateLimitError) log.warn('Limite da Anthropic atingido; colando texto bruto')
    else if (err instanceof Anthropic.APIConnectionError) log.warn(`Sem conexão com a Anthropic (${err.message}); colando texto bruto`)
    else if (err instanceof Anthropic.APIError) log.error(`Erro da Anthropic ${err.status}: ${err.message}; colando texto bruto`)
    else log.error(`Falha na limpeza: ${String(err)}; colando texto bruto`)
    return null
  }
}

/** Limpeza pelo OpenRouter, com a mesma chave usada na transcrição. */
async function cleanupWithOpenRouter(user: string, config: Config): Promise<string | null> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.cleanupApiKey}`, 'Content-Type': 'application/json', 'X-Title': 'DigitAI' },
      body: JSON.stringify({
        model: openRouterModelId(config.claudeModel),
        max_tokens: 8000,
        reasoning: { effort: 'low', exclude: true },
        messages: [
          { role: 'system', content: CLEANUP_SYSTEM_PROMPT },
          { role: 'user', content: user }
        ]
      }),
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      log.warn(`Limpeza pelo OpenRouter falhou (HTTP ${res.status}): ${body.slice(0, 200)}; colando texto bruto`)
      return null
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] }
    const choice = data.choices?.[0]
    if (choice?.finish_reason === 'length') {
      log.warn('Limpeza cortada no limite de tamanho; colando texto bruto')
      return null
    }
    return (choice?.message?.content ?? '').trim()
  } catch (err) {
    log.warn(`Sem conexão com o OpenRouter na limpeza (${String(err)}); colando texto bruto`)
    return null
  }
}

/**
 * Limpa e formata a transcrição com Claude.
 * Em qualquer falha devolve o texto bruto: é melhor colar algo do que perder o que a pessoa falou.
 */
export async function cleanupText(rawText: string, win: ActiveWindow | null, config: Config): Promise<string> {
  if (!config.cleanup || !config.cleanupApiKey || !rawText.trim()) return rawText
  const user = buildCleanupMessage(rawText, win, categorize(win), config.vocabulary)
  const text =
    config.cleanupProvider === 'openrouter' ? await cleanupWithOpenRouter(user, config) : await cleanupWithAnthropic(user, config)
  return text || rawText
}
