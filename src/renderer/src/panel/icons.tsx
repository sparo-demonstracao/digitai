// Ícones de traço simples, na cor do texto ao redor.
import type { ReactNode } from 'react'

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

/** Símbolo do DigitAI: uma onda de voz, como a da barrinha flutuante. */
export function BrandMark({ size = 18 }: { size?: number }) {
  const bars = [5, 10, 15, 9, 5]
  return (
    <svg className="brand-mark" viewBox="0 0 20 18" width={size} height={size * 0.9} aria-hidden>
      {bars.map((h, i) => (
        <rect key={i} x={1 + i * 4} y={(18 - h) / 2} width="2.4" height={h} rx="1.2" fill="currentColor" />
      ))}
    </svg>
  )
}

export const CopyIcon = () => (
  <Icon>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </Icon>
)

export const CheckIcon = () => (
  <Icon>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
)

export const PlayIcon = () => (
  <Icon>
    <path d="M7 4.5v15l12-7.5z" />
  </Icon>
)

export const PauseIcon = () => (
  <Icon>
    <path d="M8 5v14M16 5v14" />
  </Icon>
)

export const RetryIcon = () => (
  <Icon>
    <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
)

export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
)

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
)

export const SettingsIcon = () => (
  <Icon>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
)

export const ChevronLeftIcon = () => (
  <Icon>
    <path d="m15 18-6-6 6-6" />
  </Icon>
)

export const ChevronDownIcon = () => (
  <Icon size={14}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const CloseIcon = () => (
  <Icon size={12}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
)
