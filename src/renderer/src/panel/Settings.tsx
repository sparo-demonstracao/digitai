import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { KeyCheck, KeyName, ProviderName, SettingsPatch, SettingsView } from '../../../shared/painel'
import { ipcMessage } from './format'
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, CloseIcon } from './icons'

const SERVICE_NAMES: Record<KeyName, string> = {
  openrouter: 'OpenRouter',
  groq: 'Groq',
  openai: 'OpenAI',
  anthropic: 'Anthropic'
}

const PROVIDERS: { value: ProviderName; label: string }[] = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'groq', label: 'Groq' },
  { value: 'openai', label: 'OpenAI' }
]

const CLEANUP_PROVIDERS: { value: 'openrouter' | 'anthropic'; label: string }[] = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'anthropic', label: 'Anthropic (chave própria)' }
]

const CLEANUP_MODELS = [
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' }
]

// Medido em testes com frases faladas típicas (out/2026), via OpenRouter: os dois primeiros levam ~1,5–2,5 s.
const CLEANUP_MODEL_NOTES: Record<string, string> = {
  'claude-haiku-5-5': 'Rápido e o mais barato.',
  'claude-sonnet-5-5': 'Texto mais caprichado, quase tão rápido. Custa umas 25 vezes mais que o Haiku.',
  'claude-opus-5-5': 'O mais capaz, mais lento e mais caro.'
}

const LANGUAGES = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' },
  { value: '', label: 'Detectar sozinho' }
]

// ---------- peças ----------

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="group" aria-label={title}>
      <h2 className="group__title">{title}</h2>
      <div className="group__card">{children}</div>
    </section>
  )
}

function Row({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row__text">
        <p className="row__label">{label}</p>
        {note && <p className="row__note">{note}</p>}
      </div>
      <div className="row__control">{children}</div>
    </div>
  )
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="select">
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon />
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' switch--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__thumb" />
    </button>
  )
}

// ---------- chave de API ----------

function KeyRow({ name, state, onSave }: { name: KeyName; state: { set: boolean; hint: string }; onSave: (value: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [check, setCheck] = useState<KeyCheck | null>(null)
  const [checking, setChecking] = useState(false)

  // Trocou o serviço: a linha passa a ser de outra chave.
  useEffect(() => {
    setEditing(false)
    setValue('')
    setCheck(null)
  }, [name])

  const verify = async () => {
    setChecking(true)
    try {
      setCheck(await window.painel.verifyKey(name))
    } catch (err) {
      setCheck({ ok: false, message: ipcMessage(err) })
    } finally {
      setChecking(false)
    }
  }

  const submit = async () => {
    if (!value.trim()) return
    if (await onSave(value.trim())) {
      setEditing(false)
      setValue('')
      void verify()
    }
  }

  const note = check ? (
    <span className={check.ok ? 'note--ok' : 'note--erro'}>{check.message}</span>
  ) : state.set ? undefined : (
    'Nenhuma chave salva.'
  )

  return (
    <Row label={`Chave da ${SERVICE_NAMES[name]}`} note={note}>
      {editing ? (
        <div className="key-edit">
          <input
            className="field"
            type="password"
            autoFocus
            spellCheck={false}
            placeholder="Cole a chave aqui"
            aria-label={`Nova chave da ${SERVICE_NAMES[name]}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={!value.trim()}>
            Salvar
          </button>
          <button type="button" className="button" onClick={() => setEditing(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <>
          {state.set && <span className="key-mask">•••• {state.hint}</span>}
          {state.set && (
            <button type="button" className="button" onClick={() => void verify()} disabled={checking}>
              {checking ? 'Verificando…' : 'Verificar'}
            </button>
          )}
          <button type="button" className="button" onClick={() => setEditing(true)}>
            {state.set ? 'Trocar' : 'Adicionar'}
          </button>
        </>
      )}
    </Row>
  )
}

// ---------- modelo ----------

function ModelField({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      className="field field--wide"
      spellCheck={false}
      aria-label="Modelo de transcrição"
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onSave(draft.trim())}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

// No OpenRouter, os dois modelos que valem a pena para ditado (medidos em out/2026).
const OPENROUTER_TRANSCRIPTION_MODELS = [
  {
    value: 'google/gemini-4-argon',
    label: 'Gemini 4 Argon',
    note: 'O mais preciso, inclusive com nomes em inglês. Cerca de 3 s, sem muita variação.'
  },
  {
    value: 'openai/whisper-large-v3-turbo',
    label: 'Whisper Turbo (Groq)',
    note: 'Geralmente o mais rápido (1 a 2 s), mas às vezes demora mais. Erra nomes em inglês: ligue a limpeza e coloque os nomes no Dicionário.'
  }
]

function TranscriptionModelRow({ view, onSave }: { view: SettingsView; onSave: (model: string) => void }) {
  const current = view.model || view.defaultModels.openrouter
  const known = OPENROUTER_TRANSCRIPTION_MODELS.find((m) => m.value === current)
  // Um modelo escrito à mão no .env continua aparecendo como opção.
  const options = known ? OPENROUTER_TRANSCRIPTION_MODELS : [...OPENROUTER_TRANSCRIPTION_MODELS, { value: current, label: current, note: '' }]
  return (
    <Row label="Modelo" note={known?.note}>
      <Select
        label="Modelo de transcrição"
        value={current}
        options={options}
        onChange={(model) => onSave(model === view.defaultModels.openrouter ? '' : model)}
      />
    </Row>
  )
}

// ---------- atalho ----------

const MODIFIERS: Record<string, { token: string; label: string; order: number }> = {
  ControlLeft: { token: 'leftctrl', label: 'Ctrl esquerdo', order: 0 },
  ControlRight: { token: 'rightctrl', label: 'Ctrl direito', order: 0 },
  ShiftLeft: { token: 'leftshift', label: 'Shift esquerdo', order: 1 },
  ShiftRight: { token: 'rightshift', label: 'Shift direito', order: 1 },
  AltLeft: { token: 'leftalt', label: 'Alt esquerdo', order: 2 },
  AltRight: { token: 'rightalt', label: 'Alt direito', order: 2 },
  MetaLeft: { token: 'win', label: 'Win', order: 3 },
  MetaRight: { token: 'win', label: 'Win', order: 3 },
  // Modificador sem lado conhecido (alguns teclados e macros só marcam a tecla como pressionada)
  AnyCtrl: { token: 'ctrl', label: 'Ctrl', order: 0 },
  AnyShift: { token: 'shift', label: 'Shift', order: 1 },
  AnyAlt: { token: 'alt', label: 'Alt', order: 2 },
  AnyMeta: { token: 'win', label: 'Win', order: 3 }
}

const FLAGS: [keyof KeyboardEvent, string, string[]][] = [
  ['ctrlKey', 'AnyCtrl', ['ControlLeft', 'ControlRight']],
  ['shiftKey', 'AnyShift', ['ShiftLeft', 'ShiftRight']],
  ['altKey', 'AnyAlt', ['AltLeft', 'AltRight']],
  ['metaKey', 'AnyMeta', ['MetaLeft', 'MetaRight']]
]

// Junta os modificadores marcados no evento que não vieram como tecla própria.
function syncFlags(e: KeyboardEvent, down: Set<string>): void {
  for (const [flag, virtual, real] of FLAGS) {
    if (e[flag] && !real.some((c) => down.has(c))) down.add(virtual)
    if (!e[flag]) down.delete(virtual)
  }
}

function plainKey(code: string): { token: string; label: string; typing: boolean } | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return { token: letter[1].toLowerCase(), label: letter[1], typing: true }
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return { token: digit[1], label: digit[1], typing: true }
  if (code === 'Space') return { token: 'space', label: 'Espaço', typing: true }
  const f = /^F([1-9]|1[0-2])$/.exec(code)
  if (f) return { token: `f${f[1]}`, label: `F${f[1]}`, typing: false }
  return null
}

function describe(codes: string[]): { spec?: string; label: string; error?: string } {
  const mods = codes.filter((c) => MODIFIERS[c]).map((c) => MODIFIERS[c]).sort((a, b) => a.order - b.order)
  const others = codes.filter((c) => !MODIFIERS[c])
  const keys = others.map(plainKey)
  const uniqueMods = mods.filter((m, i) => mods.findIndex((x) => x.token === m.token) === i)
  const label = [...uniqueMods.map((m) => m.label), ...keys.map((k) => k?.label ?? '?')].join(' + ')
  if (keys.some((k) => !k)) return { label, error: 'Essa tecla não pode ser usada no atalho. Use letras, números, Espaço ou F1–F12.' }
  if (keys.length > 1) return { label, error: 'Use no máximo uma tecla além de Ctrl, Alt, Shift ou Win.' }
  if (uniqueMods.length === 0 && keys[0]?.typing) {
    return { label, error: 'Combine com Ctrl, Alt, Shift ou Win para não atrapalhar a digitação.' }
  }
  return { label, spec: [...uniqueMods.map((m) => m.token), ...keys.map((k) => k!.token)].join('+') }
}

function HotkeyField({ label, onSave }: { label: string; onSave: (spec: string) => Promise<boolean> }) {
  const [recording, setRecording] = useState(false)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  // Referência estável: a gravação não pode reiniciar quando o componente renderiza de novo.
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  useEffect(() => {
    if (!recording) return
    // O atalho global fica pausado: senão, gravar Alt+V iniciaria um ditado.
    void window.painel.pauseHotkey(true)
    const down = new Set<string>()
    let combo: string[] = []

    const onDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') {
        setRecording(false)
        return
      }
      down.add(e.code)
      syncFlags(e, down)
      if (down.size >= combo.length) combo = [...down]
      setPreview(describe(combo).label)
    }
    const onUp = (e: KeyboardEvent) => {
      e.preventDefault()
      down.delete(e.code)
      syncFlags(e, down)
      // Termina ao soltar a tecla comum (ex.: o V de Alt+V) ou quando tudo foi solto (atalho só de modificadores).
      const releasedPlainKey = !MODIFIERS[e.code] && combo.includes(e.code)
      if (combo.length === 0 || (!releasedPlainKey && down.size > 0)) return
      const result = describe(combo)
      setRecording(false)
      if (result.error || !result.spec) setError(result.error ?? 'Atalho inválido.')
      else void saveRef.current(result.spec)
    }
    const stop = () => setRecording(false)

    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', stop)
      void window.painel.pauseHotkey(false)
    }
  }, [recording])

  return (
    <div className="hotkey-wrap">
      <button
        type="button"
        className={`button hotkey${recording ? ' hotkey--recording' : ''}`}
        onClick={() => {
          setError('')
          setPreview('')
          setRecording((r) => !r)
        }}
      >
        {recording ? preview || 'Pressione o atalho…' : label}
      </button>
      {error && <p className="note--erro hotkey__error">{error}</p>}
    </div>
  )
}

// ---------- dicionário ----------

function VocabularyField({ words, onChange }: { words: string[]; onChange: (words: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const word = draft.trim().replace(/,/g, '')
    setDraft('')
    if (!word || words.some((w) => w.toLowerCase() === word.toLowerCase())) return
    onChange([...words, word])
  }
  return (
    <div className="vocab">
      <p className="row__note">Nomes, marcas e termos que o DigitAI deve escrever exatamente assim.</p>
      <div className="chips">
        {words.map((word) => (
          <span className="chip" key={word}>
            {word}
            <button type="button" aria-label={`Remover ${word}`} onClick={() => onChange(words.filter((w) => w !== word))}>
              <CloseIcon />
            </button>
          </span>
        ))}
        <input
          className="chip-input"
          aria-label="Adicionar palavra ao dicionário"
          placeholder={words.length ? 'Adicionar palavra' : 'Ex.: Sparo, n8n, Railway'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add()
            }
          }}
          onBlur={add}
        />
      </div>
    </div>
  )
}

// ---------- tela ----------

export function Settings({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(0)

  useEffect(() => {
    window.painel
      .settings()
      .then(setView)
      .catch((err) => setError(ipcMessage(err)))
  }, [])

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(0), 1600)
    return () => clearTimeout(t)
  }, [saved])

  const save = async (patch: SettingsPatch): Promise<boolean> => {
    setError('')
    try {
      setView(await window.painel.saveSettings(patch))
      setSaved(Date.now())
      onSaved()
      return true
    } catch (err) {
      setError(ipcMessage(err))
      return false
    }
  }

  return (
    <div className="settings">
      <button type="button" className="back" onClick={onBack}>
        <ChevronLeftIcon />
        Ditados
      </button>
      <h1 className="headline">Configurações</h1>
      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}

      {view && (
        <>
          <Group title="Transcrição">
            <Row label="Serviço" note="Quem transforma a sua voz em texto.">
              <Select label="Serviço de transcrição" value={view.provider} options={PROVIDERS} onChange={(provider) => void save({ provider })} />
            </Row>
            <KeyRow
              name={view.provider}
              state={view.keys[view.provider]}
              onSave={(value) => save({ keys: { [view.provider]: value } })}
            />
            {view.provider === 'openrouter' ? (
              <TranscriptionModelRow view={view} onSave={(model) => void save({ model })} />
            ) : (
              <Row label="Modelo" note="Deixe em branco para usar o recomendado.">
                <ModelField value={view.model} placeholder={view.defaultModels[view.provider]} onSave={(model) => void save({ model })} />
              </Row>
            )}
          </Group>

          <Group title="Atalho">
            <Row label="Segure para falar" note="Clique e pressione a combinação. Um toque rápido continua sendo o atalho normal do app.">
              <HotkeyField label={view.hotkeyLabel} onSave={(hotkey) => save({ hotkey })} />
            </Row>
            {!view.hotkeyLabel.includes('Espaço') && (
              <Row label="Falar sem segurar" note="Com o atalho pressionado, toque Espaço e pode soltar. Aperte o atalho de novo para terminar (até 15 minutos).">
                <span className="keys">{view.hotkeyLabel} + Espaço</span>
              </Row>
            )}
          </Group>

          <Group title="Idioma">
            <Row label="Idioma principal" note="Termos em outras línguas continuam saindo como foram falados.">
              <Select label="Idioma principal" value={view.language} options={LANGUAGES} onChange={(language) => void save({ language })} />
            </Row>
          </Group>

          <Group title="Limpeza do texto">
            <Row label="Limpar com Claude" note="Tira “é…”, “tipo” e repetições e aplica autocorreções.">
              <Toggle label="Limpar com Claude" checked={view.cleanup} onChange={(cleanup) => void save({ cleanup })} />
            </Row>
            {view.cleanup && (
              <>
                <Row
                  label="Usar"
                  note={
                    view.cleanupProvider === 'openrouter' && view.provider === 'openrouter'
                      ? 'Usa a mesma chave da OpenRouter da transcrição.'
                      : undefined
                  }
                >
                  <Select
                    label="Serviço da limpeza"
                    value={view.cleanupProvider}
                    options={CLEANUP_PROVIDERS}
                    onChange={(cleanupProvider) => void save({ cleanupProvider })}
                  />
                </Row>
                <Row label="Modelo" note={CLEANUP_MODEL_NOTES[view.cleanupModel]}>
                  <Select
                    label="Modelo da limpeza"
                    value={view.cleanupModel}
                    options={CLEANUP_MODELS}
                    onChange={(cleanupModel) => void save({ cleanupModel })}
                  />
                </Row>
                {/* A chave só aparece aqui quando não é a mesma já mostrada na transcrição. */}
                {view.cleanupProvider === 'anthropic' && (
                  <KeyRow name="anthropic" state={view.keys.anthropic} onSave={(value) => save({ keys: { anthropic: value } })} />
                )}
                {view.cleanupProvider === 'openrouter' && view.provider !== 'openrouter' && (
                  <KeyRow name="openrouter" state={view.keys.openrouter} onSave={(value) => save({ keys: { openrouter: value } })} />
                )}
              </>
            )}
          </Group>

          <Group title="Dicionário">
            <VocabularyField words={view.vocabulary} onChange={(vocabulary) => void save({ vocabulary })} />
          </Group>
        </>
      )}

      <div className={`toast${saved ? ' toast--on' : ''}`} role="status" aria-live="polite">
        {saved ? (
          <>
            <CheckIcon />
            Salvo
          </>
        ) : null}
      </div>
    </div>
  )
}
