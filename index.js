require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();

// Guardamos o corpo BRUTO da requisição.
// Sem isso é impossível validar a assinatura do webhook,
// porque a assinatura é calculada em cima dos bytes originais.
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

const {
  PIXEL_ID,
  ACCESS_TOKEN,
  TEST_EVENT_CODE,          // remover do .env quando for para produção
  WEBHOOK_SECRET,           // segredo da plataforma, para validar a assinatura
  VALUE_IN_CENTS = 'true',  // 'true' se a plataforma manda valor em centavos
  API_VERSION = 'v21.0'
} = process.env;

// ---------------------------------------------------------------
// NORMALIZAÇÃO
// O hash só bate com o da Meta se o texto for tratado igual antes.
// Regra: sem acento, sem espaço nas pontas, tudo minúsculo.
// ---------------------------------------------------------------

const semAcento = (texto) =>
  texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const normalizar = (valor) => {
  if (valor === undefined || valor === null) return '';
  return semAcento(String(valor)).trim().toLowerCase();
};

// Retorna null quando não há dado — assim o campo é OMITIDO do payload
// em vez de ir vazio ou com placeholder (o que derruba o EMQ).
const hash = (valor) => {
  const limpo = normalizar(valor);
  if (!limpo) return null;
  return crypto.createHash('sha256').update(limpo).digest('hex');
};

// Telefone: só dígitos, com código do país e SEM o "+"  -> 5521987654321
const normalizarTelefone = (valor) => {
  if (!valor) return null;
  let digitos = String(valor).replace(/\D/g, '');
  if (digitos.length < 10) return null;
  if (!digitos.startsWith('55')) digitos = '55' + digitos;
  return digitos;
};

// CEP: só dígitos
const normalizarCep = (valor) => {
  if (!valor) return null;
  const digitos = String(valor).replace(/\D/g, '');
  return digitos || null;
};

// Cidade: sem acento, sem espaço nenhum (exigência da Meta) -> "riodejaneiro"
const normalizarCidade = (valor) => {
  if (!valor) return null;
  const limpo = normalizar(valor).replace(/[^a-z]/g, '');
  return limpo || null;
};

// Estado: sigla de 2 letras minúsculas -> "rj"
const normalizarEstado = (valor) => {
  if (!valor) return null;
  const limpo = normalizar(valor).replace(/[^a-z]/g, '');
  return limpo.length === 2 ? limpo : (limpo || null);
};

// Só adiciona a chave no objeto se realmente existir valor.
const adicionar = (destino, chave, valorHash) => {
  if (valorHash) destino[chave] = [valorHash];
};

// ---------------------------------------------------------------
// fbc — o parâmetro mais valioso do user_data
// Formato exigido: fb.1.{timestamp_em_MILISSEGUNDOS}.{fbclid}
// O fbclid vem na URL quando a pessoa clica no anúncio.
// Você precisa capturá-lo na landing page e fazer ele chegar
// até aqui, via campo de rastreamento do checkout (src, utm_content...).
// ---------------------------------------------------------------
const montarFbc = (fbclid, fbcPronto, timestampMs) => {
  if (fbcPronto && String(fbcPronto).startsWith('fb.')) return fbcPronto;
  if (!fbclid) return null;
  return `fb.1.${timestampMs}.${fbclid}`;
};

// ---------------------------------------------------------------
// VALOR
// Nunca adivinhe a unidade. Configure por plataforma no .env.
// Adivinhar é como um R$197 vira R$1,97 e destrói a campanha.
// ---------------------------------------------------------------
const converterValor = (bruto) => {
  const numero = Number(String(bruto ?? 0).replace(',', '.'));
  if (!Number.isFinite(numero) || numero <= 0) return 0;
  return VALUE_IN_CENTS === 'true' ? numero / 100 : numero;
};

// ---------------------------------------------------------------
// SEGURANÇA
// Sem isso, qualquer um que descobrir sua URL injeta vendas falsas
// no pixel do seu cliente.
// Cada plataforma assina de um jeito — ajuste o algoritmo e o local
// da assinatura conforme a documentação dela.
// ---------------------------------------------------------------
const assinaturaValida = (req) => {
  if (!WEBHOOK_SECRET) return true; // sem segredo configurado: modo teste
  const recebida = req.query.signature || req.get('x-webhook-signature');
  if (!recebida) return false;

  const calculada = crypto
    .createHmac('sha1', WEBHOOK_SECRET) // algumas plataformas usam sha256
    .update(req.rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculada),
      Buffer.from(String(recebida))
    );
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------
// ADAPTADOR
// A ÚNICA parte que muda quando você troca de plataforma.
// Ele traduz o formato de cada uma para um formato interno único.
// ---------------------------------------------------------------
const adaptarKiwify = (body) => {
  const cliente = body?.Customer || {};
  const nomeCompleto = (cliente.full_name || '').trim();
  const partes = nomeCompleto ? nomeCompleto.split(/\s+/) : [];

  return {
    idPedido: body?.order_id || body?.order_ref || null,
    pago: String(body?.order_status || '').toLowerCase() === 'paid',
    valorBruto: body?.Commissions?.charge_amount ?? body?.order_value,
    moeda: body?.Commissions?.currency || 'BRL',
    email: cliente.email,
    telefone: cliente.mobile,
    primeiroNome: partes[0] || null,
    sobrenome: partes.length > 1 ? partes[partes.length - 1] : null,
    cidade: cliente.city,
    estado: cliente.state,
    cep: cliente.zipcode,
    pais: 'br',
    documento: cliente.CPF,
    // O fbclid precisa vir de algum campo de rastreamento que VOCÊ preencheu
    // na landing page. Ajuste conforme onde você o colocou.
    fbclid: body?.TrackingParameters?.src || body?.TrackingParameters?.utm_content || null,
    fbp: body?.TrackingParameters?.fbp || null,
    urlOrigem: body?.checkout_link || null
  };
};

// Para adicionar uma plataforma nova, escreva outro adaptador
// e aponte a rota para ele. O motor abaixo não muda.

// ---------------------------------------------------------------
// MOTOR — escrito uma vez, serve para todas as plataformas
// ---------------------------------------------------------------
const enviarParaMeta = async (pedido) => {
  const agoraSegundos = Math.floor(Date.now() / 1000);

  const user_data = {};

  adicionar(user_data, 'em', hash(pedido.email));
  adicionar(user_data, 'ph', hash(normalizarTelefone(pedido.telefone)));
  adicionar(user_data, 'fn', hash(pedido.primeiroNome));
  adicionar(user_data, 'ln', hash(pedido.sobrenome));
  adicionar(user_data, 'ct', hash(normalizarCidade(pedido.cidade)));
  adicionar(user_data, 'st', hash(normalizarEstado(pedido.estado)));
  adicionar(user_data, 'zp', hash(normalizarCep(pedido.cep)));
  adicionar(user_data, 'country', hash(pedido.pais));          // país TAMBÉM vai hasheado
  adicionar(user_data, 'external_id', hash(pedido.documento)); // CPF como ID do cliente

  // fbc e fbp NÃO são hasheados — vão em texto puro.
  const fbc = montarFbc(pedido.fbclid, pedido.fbc, Date.now());
  if (fbc) user_data.fbc = fbc;
  if (pedido.fbp) user_data.fbp = pedido.fbp;

  const evento = {
    event_name: 'Purchase',
    event_time: agoraSegundos,
    // event_id: o crachá do evento. Garante que a Meta não conte
    // a mesma venda duas vezes se o pixel do navegador também disparar.
    event_id: pedido.idPedido ? `purchase_${pedido.idPedido}` : undefined,
    action_source: 'website',
    user_data,
    custom_data: {
      value: converterValor(pedido.valorBruto),
      currency: pedido.moeda || 'BRL',
      order_id: pedido.idPedido || undefined
    }
  };

  if (pedido.urlOrigem) evento.event_source_url = pedido.urlOrigem;

  const payload = { data: [evento] };
  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

  // Token vai no CORPO, não na URL — URL aparece em log de servidor e proxy.
  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`;

  const resposta = await axios.post(
    url,
    { ...payload, access_token: ACCESS_TOKEN },
    { timeout: 10000 }
  );

  // fbtrace_id é o número de protocolo da Meta. Guarde: é ele que
  // resolve a discussão quando o cliente disser que faltou uma venda.
  console.log('OK Meta |', 'pedido:', pedido.idPedido,
              '| eventos recebidos:', resposta.data?.events_received,
              '| fbtrace:', resposta.data?.fbtrace_id);
};

// ---------------------------------------------------------------
// ROTA
// ---------------------------------------------------------------
app.post('/webhook', (req, res) => {
     console.log(JSON.stringify(req.body, null, 2));
  if (!assinaturaValida(req)) {
    console.warn('Assinatura inválida — requisição rejeitada.');
    return res.status(401).send({ error: 'assinatura invalida' });
  }

  // Confirmamos o recebimento IMEDIATAMENTE.
  // Se demorássemos, a plataforma acharia que falhou e reenviaria
  // o mesmo webhook — gerando venda duplicada no pixel.
  res.status(200).send({ ok: true });

  // O processamento acontece depois da resposta.
  (async () => {
    try {
      const pedido = adaptarKiwify(req.body);

      // Nunca logue o corpo inteiro: contém CPF, e-mail e telefone.
      console.log('Webhook recebido | pedido:', pedido.idPedido,
                  '| pago:', pedido.pago);

      // Boleto gerado e Pix não pago NÃO são venda.
      if (!pedido.pago) {
        console.log('Ignorado: pedido ainda não aprovado.');
        return;
      }

      if (!PIXEL_ID || !ACCESS_TOKEN) {
        console.warn('PIXEL_ID ou ACCESS_TOKEN ausentes no .env.');
        return;
      }

      await enviarParaMeta(pedido);
    } catch (erro) {
      // O erro é NOSSO, não da plataforma que chamou o webhook.
      // Por isso já devolvemos 200 lá em cima.
      console.error('Falha ao enviar para a Meta:',
        erro.response ? JSON.stringify(erro.response.data) : erro.message);
    }
  })();
});

// Rota de saúde: útil para monitorar se o serviço está no ar.
app.get('/health', (req, res) => res.status(200).send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));