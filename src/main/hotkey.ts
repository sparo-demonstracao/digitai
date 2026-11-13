import { EventEmitter } from 'node:events'
import { installKeyboardHook, isKeyDown, maskModifierRelease, tapKey, type RawKeyEvent } from './win32'
import { log } from './logger'

const DEBUG = !!process.env['DEBUG_TECLAS']

// Até esse tempo, Ctrl+S (ou outro atalho com tecla comum) conta como toque normal e é reenviado ao app.
export const TAP_MS = 300

const VK_SPACE = 0x20 // com o atalho pressionado, trava o microfone
const VK_ESCAPE = 0x1b

/**
 * Microfone travado (falar sem segurar o atalho):
 * none → normal; holding → Espaço tocado, atalho ainda pressionado; free → atalho solto, continua gravando;
 * stopping → atalho pressionado de novo, e ao soltar o ditado termina.
 */
type LockState = 'none' | 'holding' | 'free' | 'stopping'

// Modificadores aceitos; cada um vale por qualquer uma das teclas físicas listadas (virtual-key codes).
const MODIFIERS: Record<string, number[]> = {
  ctrl: [0xa2, 0xa3],
  leftctrl: [0xa2],
  rightctrl: [0xa3],
  shift: [0xa0, 0xa1],
  leftshift: [0xa0],
  rightshift: [0xa1],
  alt: [0xa4, 0xa5],
  leftalt: [0xa4],
  rightalt: [0xa5],
  win: [0x5b, 0x5c]
}
const ALL_MODIFIER_VKS = [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0x5b, 0x5c]

const LABELS: Record<string, string> = {
  ctrl: 'Ctrl',
  leftctrl: 'Ctrl esquerdo',
  rightctrl: 'Ctrl direito',
  shift: 'Shift',
  leftshift: 'Shift esquerdo',
  rightshift: 'Shift direito',
  alt: 'Alt',
  leftalt: 'Alt esquerdo',
  rightalt: 'Alt direito',
  win: 'Win',
  space: 'Espaço'
}

// Tecla comum que completa o atalho (ex.: o "s" de leftctrl+s).
function triggerVk(name: string): number | null {
  if (name === 'space') return 0x20
  if (/^[a-z]$/.test(name)) return name.toUpperCase().charCodeAt(0)
  if (/^[0-9]$/.test(name)) return name.charCodeAt(0)
  const f = /^f([1-9]|1[0-2])$/.exec(name)
  return f ? 0x6f + Number(f[1]) : null
}

export interface HotkeyEvents {
  down: []
  up: []
  cancel: []
  tap: [] // toque rápido: foi reenviado ao app como atalho normal
  lock: [] // Espaço com o atalho pressionado: segue gravando depois de soltar
}

/**
 * Detecta "segurar o atalho" com um gancho global de teclado do Windows.
 *
 * - Só modificadores (ex.: ctrl+win): as teclas passam normalmente para o app.
 * - Com tecla comum (ex.: leftctrl+s): essa tecla é engolida enquanto o atalho está ativo,
 *   para o app não receber Ctrl+S. Um toque rápido (< TAP_MS) é reenviado, então Ctrl+S
 *   continua salvando. Se houver outro modificador junto (Ctrl+Shift+S), nada é interceptado.
 * - Espaço com o atalho pressionado trava o microfone: dá para soltar e continuar falando;
 *   apertar e soltar o atalho de novo termina o ditado.
 */
export class HoldHotkey extends EventEmitter<HotkeyEvents> {
  private groups: number[][] = []
  private trigger: number | null = null
  private needsMask = false
  private maskWithCtrl = false
  private held = new Set<number>()
  private active = false
  private swallowingTrigger = false
  private swallowingSpace = false
  private lock: LockState = 'none'
  private activatedAt = 0
  private currentVk = -1
  private unhook: (() => void) | null = null
  private paused = false
  spec = ''
  label = ''

  constructor(spec: string) {
    super()
    this.setSpec(spec)
  }

  /** Troca o atalho com o app rodando (ex.: quando o .env é editado). */
  setSpec(spec: string): void {
    const parts = spec.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean)
    const groups: number[][] = []
    let trigger: number | null = null
    for (const part of parts) {
      if (MODIFIERS[part]) {
        groups.push(MODIFIERS[part])
        continue
      }
      const vk = triggerVk(part)
      if (vk === null || trigger !== null) {
        throw new Error(
          `Atalho inválido "${spec}". Use modificadores (${Object.keys(MODIFIERS).join(', ')}) e no máximo uma tecla (a-z, 0-9, space, f1-f12).`
        )
      }
      trigger = vk
    }
    if (groups.length === 0 && trigger === null) throw new Error('Atalho vazio')

    this.groups = groups
    this.trigger = trigger
    // Soltar Win ou Alt sem outra tecla abre o menu Iniciar / a barra de menus; precisamos mascarar.
    // Com Alt a máscara é um toque de Ctrl, que não serve se o próprio atalho usa Ctrl (ele está seguro).
    const hasAlt = parts.some((p) => p.endsWith('alt'))
    this.needsMask = hasAlt || parts.includes('win')
    this.maskWithCtrl = hasAlt && !parts.some((p) => p.endsWith('ctrl'))
    this.label = parts.map((p) => LABELS[p] ?? p.toUpperCase()).join(' + ')
    this.spec = spec
    this.forgetKeys()
  }

  /** Atalho com tecla comum: tem toque rápido e precisa de um instante antes do bipe. */
  get hasTrigger(): boolean {
    return this.trigger !== null
  }

  // A tecla do evento atual ainda não aparece no estado do Windows; as outras conferimos,
  // porque um keyup perdido (ex.: depois de Win+L) deixaria uma tecla "presa".
  private isHeld(vk: number): boolean {
    if (vk === this.currentVk) return true
    if (!this.held.has(vk)) return false
    if (isKeyDown(vk)) return true
    this.held.delete(vk)
    return false
  }

  private modifiersHeld(): boolean {
    return this.groups.every((g) => g.some((vk) => this.isHeld(vk)))
  }

  private extraModifierHeld(): boolean {
    const ours = new Set(this.groups.flat())
    return ALL_MODIFIER_VKS.some((vk) => !ours.has(vk) && this.isHeld(vk))
  }

  private isHotkeyModifier(vk: number): boolean {
    return this.groups.some((g) => g.includes(vk))
  }

  private emitLater(event: keyof HotkeyEvents): void {
    setImmediate(() => this.emit(event))
  }

  private activate(): void {
    this.active = true
    this.activatedAt = Date.now()
    if (this.needsMask) {
      const withCtrl = this.maskWithCtrl
      setImmediate(() => maskModifierRelease(withCtrl))
    }
    // Travado, apertar o atalho de novo não começa outro ditado: ao soltar, termina o atual.
    if (this.lock === 'free') this.lock = 'stopping'
    else this.emitLater('down')
  }

  /** Solta o atalho: toque rápido vira o atalho normal do app; senão encerra o ditado. */
  private release(): void {
    this.active = false
    if (this.lock === 'holding') {
      this.lock = 'free'
      return
    }
    if (this.lock === 'stopping') {
      this.lock = 'none'
      this.emitLater('up')
      return
    }
    if (this.trigger !== null && Date.now() - this.activatedAt < TAP_MS) {
      const trigger = this.trigger
      // Modificadores já soltos precisam ser reenviados junto com a tecla.
      const missing = this.groups.filter((g) => !g.some((vk) => this.isHeld(vk))).map((g) => g[0])
      setImmediate(() => tapKey(trigger, missing))
      this.emitLater('tap')
    } else {
      this.emitLater('up')
    }
  }

  /** Desliga o atalho temporariamente (ex.: enquanto a pessoa grava um atalho novo no painel). */
  setPaused(paused: boolean): void {
    this.paused = paused
    this.reset()
  }

  private onKey(e: RawKeyEvent): boolean {
    if (e.own || this.paused) return false // teclas que o próprio app simulou (Ctrl+V, máscara, reenvio)
    const { vk, down } = e
    this.currentVk = down ? vk : -1
    try {
      if (DEBUG) log.info(`[teclas] ${down ? 'down' : 'up'} 0x${vk.toString(16)} ativo=${this.active}`)
      return down ? this.onDown(vk) : this.onUp(vk)
    } finally {
      this.currentVk = -1
    }
  }

  private onDown(vk: number): boolean {
    const repeat = this.held.has(vk)
    this.held.add(vk)

    if (vk === VK_SPACE && this.swallowingSpace) return true // repetição automática
    if (vk === VK_SPACE && this.active && this.trigger !== VK_SPACE) {
      // O Espaço é engolido: com Alt pressionado ele abriria o menu da janela.
      this.swallowingSpace = true
      if (this.lock === 'none') {
        this.lock = 'holding'
        this.emitLater('lock')
      }
      return true
    }

    if (vk === this.trigger) {
      if (this.swallowingTrigger) return true // repetição automática enquanto segura
      if (!this.active && this.modifiersHeld() && !this.extraModifierHeld()) {
        this.swallowingTrigger = true
        this.activate()
        return true
      }
      return false
    }

    if (this.active) {
      if (!repeat && !this.isHotkeyModifier(vk)) {
        // Travado, só o Esc descarta: uma tecla esbarrada não pode jogar fora minutos de fala.
        // Esse Esc é engolido; com Alt pressionado ele mandaria a janela para trás (Alt+Esc).
        if (this.lock !== 'none') {
          if (vk !== VK_ESCAPE) return false
          this.active = false
          this.lock = 'none'
          this.emitLater('cancel')
          return true
        }
        // Outra tecla no meio (Esc, Ctrl+Win+Seta...): cancela e deixa a tecla seguir.
        this.active = false
        this.lock = 'none'
        this.emitLater('cancel')
      }
      return false
    }

    if (this.trigger === null && this.isHotkeyModifier(vk) && this.modifiersHeld()) this.activate()
    return false
  }

  private onUp(vk: number): boolean {
    this.held.delete(vk)

    if (vk === VK_SPACE && this.swallowingSpace) {
      this.swallowingSpace = false
      return true
    }

    if (vk === this.trigger && this.swallowingTrigger) {
      this.swallowingTrigger = false
      if (this.active) this.release()
      return true
    }
    if (this.active && this.isHotkeyModifier(vk)) this.release()
    return false
  }

  /** Teclas do atalho ainda pressionadas (para não colar com Win/Alt seguro). */
  isAnyHeld(): boolean {
    return this.swallowingTrigger || this.groups.some((g) => g.some((vk) => isKeyDown(vk)))
  }

  start(): void {
    this.unhook = installKeyboardHook((e) => this.onKey(e))
  }

  /** Esquece o estado das teclas (ex.: ao bloquear a tela). */
  reset(): void {
    this.held.clear()
    this.forgetKeys()
  }

  private forgetKeys(): void {
    this.active = false
    this.swallowingTrigger = false
    this.swallowingSpace = false
    // Um ditado travado continua: o atalho de novo ainda termina ele.
    if (this.lock !== 'none') this.lock = 'free'
  }

  /** O ditado acabou por outro motivo (limite de tempo, erro no microfone): sai do modo travado. */
  unlock(): void {
    if (this.lock !== 'stopping') this.lock = 'none'
  }

  stop(): void {
    this.unhook?.()
    this.unhook = null
  }
}
