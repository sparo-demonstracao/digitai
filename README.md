# DigitAI

Digitação por voz em qualquer app do Windows: **segure o atalho, fale e solte**. O texto é transcrito por IA e colado onde está o cursor (e-mail, WhatsApp Web, Word, VS Code, qualquer campo de texto).

Leve em segundo plano (cerca de 100 MB de memória e CPU zerada parado), com histórico de tudo o que você ditou e tela de configurações própria.

> **Sua chave de API fica só no seu computador.** Este repositório não tem nenhuma chave: cada pessoa usa a sua, colada na tela de Configurações do app.

---

## Instalação (passo a passo)

Funciona no **Windows 10 e 11**.

### 1. Instale o Node.js

Baixe a versão **LTS** em https://nodejs.org e instale (é só ir clicando em "Próximo").

### 2. Baixe o DigitAI

**Jeito mais fácil:** nesta página, clique no botão verde **Code** → **Download ZIP**. Depois clique com o botão direito no arquivo baixado → **Extrair tudo** e coloque a pasta onde quiser (ex.: `Documentos\digitai`).

**Ou, se você usa Git:**

```bash
git clone https://github.com/sparo-demonstracao/digitai.git
```

### 3. Instale as dependências

Abra a pasta do DigitAI no Explorador de Arquivos, clique na barra de endereço, digite `cmd` e aperte **Enter**. Na janela preta que abrir, rode:

```bash
npm install
```

```bash
npm run build
```

Isso demora alguns minutos só na primeira vez.

### 4. Abra o app

Dê dois cliques no arquivo **`DigitAI.vbs`** dentro da pasta.

O painel do DigitAI abre, uma barrinha aparece embaixo, no centro da tela, e o ícone do app aparece na bandeja (perto do relógio).

Dica: clique com o botão direito no `DigitAI.vbs` → **Enviar para** → **Área de trabalho (criar atalho)** para abrir pelo atalho daqui pra frente.

---

## Como colocar sua chave de API

O DigitAI usa um serviço de IA para transcrever sua voz. A forma mais simples é o **OpenRouter**: uma chave só serve para a transcrição e para a limpeza do texto.

### 1. Crie sua chave no OpenRouter

1. Entre em https://openrouter.ai e crie uma conta.
2. Coloque um pouco de crédito em https://openrouter.ai/settings/credits (alguns dólares duram muito: uma frase de 10 segundos custa menos de US$ 0,002).
3. Vá em https://openrouter.ai/keys → **Create Key**, dê um nome (ex.: `DigitAI`) e **copie a chave** (começa com `sk-or-`).

### 2. Cole a chave no DigitAI

1. No painel do DigitAI, clique no **ícone de engrenagem** (ao lado da busca). Também dá para abrir pelo ícone da bandeja → **Configurações**.
2. Em **Serviço**, deixe **OpenRouter**.
3. Em **Chave**, clique em **Adicionar**, cole a chave e confirme.
4. Clique em **Verificar**: se aparecer o seu saldo, está tudo certo.

Pronto. A chave é salva num arquivo `.env` dentro da pasta do app, só no seu computador. Esse arquivo nunca vai para o GitHub.

**Outras opções** (também na tela de Configurações):

- **Groq** (https://console.groq.com/keys): Whisper, mais barato, mas erra mais nomes próprios.
- **OpenAI** (https://platform.openai.com/api-keys).
- **Anthropic** (https://console.anthropic.com/settings/keys): opcional, só para a limpeza do texto com Claude usando chave própria.

---

## Como usar

1. Clique num campo de texto qualquer.
2. **Segure Alt esquerdo + V**, fale e solte. O texto aparece onde está o cursor.

O atalho pode ser trocado em **Configurações → Atalho** (clique e pressione a combinação que quiser).

### Falar por vários minutos sem segurar

Com o atalho pressionado, toque **Espaço** e pode soltar tudo: o microfone continua gravando e a barrinha mostra um cadeado e o tempo. Para terminar, **aperte o atalho de novo**. Com o atalho pressionado, **Esc** descarta a gravação. O limite é de 15 minutos.

### Painel

Clique no ícone da bandeja (ou abra o `DigitAI.vbs` de novo) para ver tudo o que você ditou: ouvir o áudio, copiar, transcrever de novo ou excluir.

### Quando a transcrição falha

Se a internet ou o serviço falhar, o DigitAI guarda o áudio e tenta de novo sozinho. Quando der certo, aparece um cartão **Transcrição pronta** com os botões **Colar** e **Copiar**. Se não der, o ditado fica no painel com o botão **Transcrever áudio** para tentar depois.

---

## Configurações disponíveis

| Opção | O que faz |
|---|---|
| Serviço e chave | Onde a voz é transcrita (OpenRouter, Groq ou OpenAI) |
| Modelo | Modelo de transcrição |
| Atalho | Combinação de teclas para ditar |
| Idioma | Idioma principal da fala |
| Limpeza com Claude | Tira "éé", repetições e ajusta pontuação antes de colar |
| Dicionário | Palavras que devem sair escritas certo (nomes, marcas, termos técnicos) |

## Limitações conhecidas

- Não cola em janelas abertas como administrador (o Windows bloqueia).
- Atalhos com Ctrl e Alt juntos podem ativar o menu de alguns apps ao soltar o Alt. Alt + tecla (ex.: Alt + V) funciona bem.
- A primeira sílaba pode ser cortada se você começar a falar antes do bipe de início.

## Para desenvolvedores

```bash
npm run dev        # modo desenvolvimento
npm run build      # gera a pasta out/ usada pelo DigitAI.vbs
npm run typecheck
```

| Etapa | Arquivo |
|---|---|
| Atalho global (segurar/soltar, Espaço trava, Esc cancela) | `src/main/hotkey.ts` |
| Gravação do microfone e onda na barra | `src/renderer/src/recorder.ts`, `Bar.tsx` |
| Transcrição, áudio longo em pedaços | `src/main/transcribe.ts`, `src/main/wav.ts` |
| Limpeza e estilo por app | `src/main/cleanup.ts`, `src/main/prompts.ts` |
| Colar com Ctrl+V e devolver o clipboard | `src/main/paste.ts` |
| API do Windows (app em foco, teclas) | `src/main/win32.ts` |
| Histórico e áudios (`%APPDATA%\DigitAI`) | `src/main/history.ts` |
| Painel e Configurações | `src/renderer/src/panel/` |

O log fica em `%APPDATA%\DigitAI\logs\digitai.log` e pode ser aberto pelo menu da bandeja.
