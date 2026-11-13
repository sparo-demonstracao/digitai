/// <reference types="vite/client" />

import type { DitadoApi } from './shared/ipc'
import type { PainelApi } from './shared/painel'

declare global {
  interface Window {
    ditado: DitadoApi
    painel: PainelApi
  }
}
