# 📡 Meta Conversions API (CAPI) - Server-Side Tracking Server

Microsserviço em **Node.js (Express)** para rastreamento de conversões *server-side* integrado à **API de Conversões da Meta (Facebook Graph API)**.

Desenvolvido para mitigar perdas de dados causadas por bloqueadores de anúncios (AdBlock) e restrições de privacidade do iOS 14.5+ (ATT), garantindo alta taxa de **Event Match Quality (EMQ)** e precisão na atribuição de campanhas de tráfego pago.

---

## 🚀 Destaques Técnicos

- **Maximização de EMQ (Event Match Quality):**
  - Normalização rigorosa de dados cadastrais (remoção de acentuação, espaços e conversão para caixa baixa antes do hash).
  - Criptografia SHA-256 para dados sensíveis em conformidade com LGPD/GDPR (`em`, `ph`, `fn`, `ln`, `ct`, `st`, `zp`, `country`, `external_id`).
- **Segurança contra Injeção de Vendas:**
  - Validação criptográfica de assinatura de webhook (HMAC-SHA1) com `crypto.timingSafeEqual` para proteção contra ataques de temporização (*timing attacks*).
- **Desduplicação de Eventos:**
  - Geração padronizada de `event_id` (`purchase_{idPedido}`) para garantir que o Facebook desduplique compras disparadas em paralelo pelo pixel do navegador.
- **Atribuição Avançada (`fbc` e `fbp`):**
  - Montagem automática do parâmetro `fbc` (`fb.1.{timestamp}.{fbclid}`) a partir dos parâmetros de rastreamento do checkout (`src` / `utm_content`).
- **Processamento Assíncrono Não-Bloqueante:**
  - Responde `200 OK` imediatamente ao gateway de pagamento para evitar reenvio desnecessário de webhooks (evitando duplicações) e despacha o evento para a Meta em segundo plano.
- **Padrão Adaptador (Extensível):**
  - Camada de adaptação desacoplada: pronto para Kiwify e facilmente extensível para Hotmart, Eduzz, Stripe, PerfectPay, etc.

---

## 🛠️ Tecnologias Utilizadas

- **Runtime:** Node.js
- **Framework:** Express
- **HTTP Client:** Axios
- **Criptografia:** `crypto` (nativo do Node.js)
- **Variáveis de Ambiente:** Dotenv

---

## ⚙️ Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto baseado no `.env.example`:

```bash
cp .env.example .env
```

```env
PORT=3000
PIXEL_ID=seu_pixel_id_aqui
ACCESS_TOKEN=seu_access_token_da_meta
TEST_EVENT_CODE=                # Opcional: código de evento de teste do Gerenciador de Eventos
WEBHOOK_SECRET=                 # Segredo de validação da assinatura
VALUE_IN_CENTS=true             # 'true' se o webhook enviar valores em centavos
API_VERSION=v21.0
```

---

## 📦 Instalação e Execução

```bash
# Instalar dependências
npm install

# Iniciar servidor
npm start
```

O servidor iniciará por padrão na porta `3000`:
- **Webhook de Compras:** `POST /webhook`
- **Health Check:** `GET /health`

---

## 🧪 Estrutura de Rotas

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/health` | Verificação de disponibilidade do servidor (uptime/health check) |
| `POST` | `/webhook` | Recebe notificações de compra do gateway e envia para a Meta |

---

## 🛡️ Segurança e Privacidade

- Nenhum dado pessoal bruto (PII) é enviado em texto claro ou exposto em logs.
- Arquivos de credenciais (`.env`) e chaves secretas são ignorados pelo controle de versão (`.gitignore`).
