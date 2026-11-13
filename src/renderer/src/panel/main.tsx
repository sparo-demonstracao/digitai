import { createRoot } from 'react-dom/client'
import '@fontsource-variable/instrument-sans'
import './panel.css'
import { Panel } from './Panel'

// Com Mica (Windows 11) o fundo da página fica transparente para o material do Windows aparecer.
if (new URLSearchParams(location.search).get('material') === 'mica') {
  document.documentElement.classList.add('mica')
}

async function start() {
  // Fora do Electron (pré-visualização no navegador) usa dados de exemplo.
  if (!('painel' in window)) {
    const { installMock } = await import('./mock')
    installMock()
  }
  createRoot(document.getElementById('root')!).render(<Panel />)
}

void start()
