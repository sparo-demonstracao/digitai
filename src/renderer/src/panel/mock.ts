// Dados de exemplo para ver o painel no navegador, sem o Electron. Nunca roda dentro do app.
import type { HistoryEntry, KeyName, PainelApi, PanelData, SettingsView } from '../../../shared/painel'

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function entry(partial: Partial<HistoryEntry> & Pick<HistoryEntry, 'at' | 'app' | 'durationMs'>): HistoryEntry {
  return {
    id: Math.random().toString(36).slice(2),
    status: 'ok',
    window: '',
    rawText: partial.finalText ?? '',
    finalText: '',
    provider: 'openrouter',
    model: 'google/gemini-4-argon',
    cleaned: false,
    audioFile: 'exemplo.wav',
    audioMime: 'audio/wav',
    timings: { transcribeMs: 2900, cleanupMs: 0, totalMs: 3300 },
    ...partial
  }
}

const entries: HistoryEntry[] = [
  entry({
    at: ago(4),
    app: 'claude.exe',
    window: 'Claude',
    durationMs: 21_400,
    finalText:
      'Quero que o painel mostre tudo o que eu ditei, com o áudio, o app onde o texto foi colado e quanto tempo cada etapa levou. Se der, deixa a busca funcionando sem acento também.',
    timings: { transcribeMs: 3480, cleanupMs: 0, totalMs: 3970 }
  }),
  entry({
    at: ago(19),
    app: 'whatsapp.root.exe',
    window: 'WhatsApp',
    durationMs: 6_200,
    rawText: 'é tipo amanhã às três não às quatro eu passo aí pra gente gravar o vídeo',
    finalText: 'Amanhã às 4 eu passo aí pra gente gravar o vídeo',
    cleaned: true,
    timings: { transcribeMs: 2610, cleanupMs: 640, totalMs: 3420 }
  }),
  entry({
    at: ago(47),
    app: 'chrome.exe',
    window: 'Caixa de entrada (12) - Gmail - Google Chrome',
    durationMs: 33_800,
    rawText:
      'oi Pedro tudo bem segue a proposta da automação do atendimento no WhatsApp com n8n o prazo é de duas semanas e o valor fica em quatro mil reais qualquer dúvida me chama abraço',
    finalText:
      'Oi, Pedro, tudo bem?\n\nSegue a proposta da automação do atendimento no WhatsApp com n8n. O prazo é de duas semanas e o valor fica em R$ 4.000.\n\nQualquer dúvida, me chama.\n\nAbraço',
    cleaned: true,
    timings: { transcribeMs: 3890, cleanupMs: 1120, totalMs: 5210 }
  }),
  entry({
    at: ago(63),
    app: 'claude.exe',
    window: 'Claude',
    durationMs: 4_100,
    status: 'erro',
    error: 'Sem conexão com a OpenRouter. O áudio ficou salvo para transcrever depois.',
    provider: 'openai',
    model: 'gpt-4o-mini-transcribe'
  }),
  entry({
    at: ago(60 * 26),
    app: 'cursor.exe',
    window: 'palpites.py - bolao-palpites - Cursor',
    durationMs: 12_900,
    finalText: 'Refatora a função que calcula o placar ótimo para aceitar o mata-mata valendo o dobro e escreve um teste com o jogo Brasil e Argentina.',
    timings: { transcribeMs: 3010, cleanupMs: 0, totalMs: 3380 }
  }),
  entry({
    at: ago(60 * 27),
    app: 'notepad.exe',
    window: 'roteiro-video.txt - Bloco de notas',
    durationMs: 48_300,
    finalText:
      'Abertura: mostrar o app ditando um e-mail inteiro em dez segundos. Depois explicar que a transcrição roda no OpenRouter com o Gemini e que o texto é colado onde o cursor está, em qualquer programa.',
    timings: { transcribeMs: 4410, cleanupMs: 0, totalMs: 4800 }
  }),
  entry({
    at: ago(60 * 50),
    app: 'slack.exe',
    window: 'Slack',
    durationMs: 2_300,
    finalText: 'Fechado, subo hoje à noite.',
    audioFile: undefined
  })
]

// Um tom curto, só para o botão "Ouvir" ter o que tocar.
function toneWav(seconds = 1.2, rate = 16_000): Uint8Array {
  const n = Math.floor(seconds * rate)
  const buffer = new ArrayBuffer(44 + n * 2)
  const view = new DataView(buffer)
  const ascii = (o: number, t: string) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + n * 2, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.sin((i / rate) * 2 * Math.PI * 330) * 6000, true)
  return new Uint8Array(buffer)
}

const settings: SettingsView = {
  provider: 'openrouter',
  model: '',
  defaultModels: { openrouter: 'google/gemini-4-argon', groq: 'whisper-large-v3-turbo', openai: 'gpt-4o-mini-transcribe' },
  cleanup: true,
  cleanupProvider: 'openrouter',
  cleanupModel: 'claude-haiku-5-5',
  language: 'pt',
  hotkey: 'leftalt+v',
  hotkeyLabel: 'Alt esquerdo + V',
  vocabulary: ['Sparo', 'n8n', 'Railway'],
  keys: {
    openrouter: { set: true, hint: '3f9a' },
    groq: { set: false, hint: '' },
    openai: { set: true, hint: 'x7Qk' },
    anthropic: { set: false, hint: '' }
  }
}

export function installMock(): void {
  const data: PanelData = { entries, hotkeyLabel: 'Alt esquerdo + V', cleanupOn: false }
  const api: PainelApi = {
    load: async () => ({ ...data, entries: [...data.entries] }),
    copy: async (text) => {
      await navigator.clipboard?.writeText(text).catch(() => undefined)
    },
    remove: async (id) => {
      data.entries = data.entries.filter((e) => e.id !== id)
    },
    audio: async (id) => (data.entries.find((e) => e.id === id)?.audioFile ? { data: toneWav(), mimeType: 'audio/wav' } : null),
    retranscribe: async (id) => {
      await new Promise((r) => setTimeout(r, 1200))
      const current = data.entries.find((e) => e.id === id)!
      const updated: HistoryEntry = {
        ...current,
        status: 'ok',
        error: undefined,
        rawText: 'Testando o ditado depois de colocar crédito.',
        finalText: 'Testando o ditado depois de colocar crédito.',
        provider: 'openrouter',
        model: 'google/gemini-4-argon',
        retranscribedAt: new Date().toISOString(),
        timings: { transcribeMs: 2750, cleanupMs: 0, totalMs: 2750 }
      }
      data.entries = data.entries.map((e) => (e.id === id ? updated : e))
      return updated
    },
    onChanged: () => undefined,
    settings: async () => ({ ...settings }),
    saveSettings: async (patch) => {
      if (patch.hotkey) settings.hotkeyLabel = patch.hotkey.split('+').map((p) => p.toUpperCase()).join(' + ')
      Object.assign(settings, { ...patch, keys: settings.keys })
      for (const [name, value] of Object.entries(patch.keys ?? {})) {
        settings.keys[name as KeyName] = { set: !!value, hint: String(value).slice(-4) }
      }
      if (patch.provider && patch.model === undefined) settings.model = ''
      return { ...settings }
    },
    verifyKey: async (name) => {
      await new Promise((r) => setTimeout(r, 700))
      return name === 'openrouter'
        ? { ok: true, message: 'Chave funcionando. Saldo: US$ 2,78.' }
        : { ok: false, message: 'A Anthropic recusou esta chave. Confira se ela foi copiada inteira.' }
    },
    pauseHotkey: async () => undefined,
    onShow: () => undefined
  }
  ;(window as unknown as { painel: PainelApi }).painel = api
}
