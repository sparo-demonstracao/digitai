import Anthropic from '@anthropic-ai/sdk'
import type { KeyCheck, KeyName } from '../shared/painel'
import { SERVICE_NAMES } from './config'

const INVALID = (name: KeyName): KeyCheck => ({ ok: false, message: `A ${SERVICE_NAMES[name]} recusou esta chave. Confira se ela foi copiada inteira.` })

const LISTING_URLS: Partial<Record<KeyName, string>> = {
  groq: 'https://api.groq.com/openai/v1/models',
  openai: 'https://api.openai.com/v1/models'
}

const dollars = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Testa a chave com uma chamada que não gasta nada (consulta de saldo ou lista de modelos). */
export async function verifyKey(name: KeyName, key: string): Promise<KeyCheck> {
  if (!key) return { ok: false, message: 'Nenhuma chave salva.' }
  try {
    if (name === 'anthropic') {
      const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 10_000 })
      await client.models.list({ limit: 1 })
      return { ok: true, message: 'Chave funcionando.' }
    }

    const headers = { Authorization: `Bearer ${key}` }
    const signal = AbortSignal.timeout(10_000)
    if (name === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/credits', { headers, signal })
      if (res.status === 401 || res.status === 403) return INVALID(name)
      if (!res.ok) return { ok: false, message: `O OpenRouter respondeu com erro ${res.status}. Tente de novo.` }
      const { data } = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } }
      const left = (data?.total_credits ?? 0) - (data?.total_usage ?? 0)
      return {
        ok: left > 0,
        message: left > 0 ? `Chave funcionando. Saldo: US$ ${dollars(left)}.` : 'A chave funciona, mas a conta está sem saldo.'
      }
    }

    const res = await fetch(LISTING_URLS[name]!, { headers, signal })
    if (res.status === 401 || res.status === 403) return INVALID(name)
    if (!res.ok) return { ok: false, message: `A ${SERVICE_NAMES[name]} respondeu com erro ${res.status}. Tente de novo.` }
    return { ok: true, message: 'Chave funcionando.' }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return INVALID(name)
    if (err instanceof Anthropic.APIError && !(err instanceof Anthropic.APIConnectionError)) {
      return { ok: false, message: `A Anthropic respondeu com erro ${err.status}. Tente de novo.` }
    }
    return { ok: false, message: `Sem conexão com a ${SERVICE_NAMES[name]}. Confira a internet.` }
  }
}
