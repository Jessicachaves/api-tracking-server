require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Puxando as variáveis do arquivo .env
const PIXEL_ID = process.env.PIXEL_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const TEST_EVENT_CODE = process.env.TEST_EVENT_CODE;

const hashData = (data) => {
    if (!data) return '';
    return crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');
};

app.post('/webhook', async (req, res) => {
    try {
        console.log("DADOS RECEBIDOS:", JSON.stringify(req.body, null, 2));

        // 1. Pegando e tratando os dados principais
        const email_cliente = req.body?.Customer?.email || req.body?.email_cliente || 'email@naoenviado.com';
        
        let valorBruto = req.body?.order_value || req.body?.Commissions?.charge_amount || req.body?.valor_compra || 0;
        const valor_compra = (valorBruto > 0 && !valorBruto.toString().includes('.')) ? (valorBruto / 100) : valorBruto;
        const moeda = req.body?.moeda || 'BRL';

        // 2. Tratando os dados adicionais que vieram da Kiwify
        const telefoneLimpo = req.body?.Customer?.mobile ? req.body.Customer.mobile.replace(/\D/g, '') : '';
        const cpfLimpo = req.body?.Customer?.CPF ? req.body.Customer.CPF.replace(/\D/g, '') : '';
        const nomePartes = req.body?.Customer?.full_name ? req.body.Customer.full_name.trim().split(' ') : [''];
        const primeiroNome = nomePartes[0];
        const sobrenome = nomePartes.length > 1 ? nomePartes[nomePartes.length - 1] : '';

        // 3. Montando o pacote completo para a Meta
        const metaPayload = {
            data: [
                {
                    event_name: 'Purchase',
                    event_time: Math.floor(Date.now() / 1000),
                    action_source: 'website',
                    user_data: {
                        em: [hashData(email_cliente)],
                        ph: [hashData(telefoneLimpo)],
                        fn: [hashData(primeiroNome)],
                        ln: [hashData(sobrenome)],
                        ct: [hashData(req.body?.Customer?.city?.toLowerCase() || '')],
                        st: [hashData(req.body?.Customer?.state?.toLowerCase() || '')],
                        zp: [hashData(req.body?.Customer?.zipcode || '')],
                        country: ['br']
                    },
                    custom_data: {
                        value: valor_compra,
                        currency: moeda
                    }
                }
            ]
        };

        // Aqui embaixo continua o resto do código que envia para a Meta (axios.post, etc)

        // Se tivermos um código de teste no .env, adicionamos ao payload
        if (TEST_EVENT_CODE) {
            metaPayload.test_event_code = TEST_EVENT_CODE;
        }

        const url = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
        
        // Vamos deixar o axios ativado agora para quando tivermos o token real
        if (PIXEL_ID && ACCESS_TOKEN) {
            const response = await axios.post(url, metaPayload);
            console.log('✅ Status da Meta:', response.status);
        } else {
             console.log('⚠️ Chaves não configuradas no .env. Requisição não enviada para a Meta.');
        }

        console.log('📦 Payload gerado:');
        console.dir(metaPayload, { depth: null });
        
        res.status(200).send({ message: 'Webhook recebido com sucesso!' });

    } catch (error) {
        // Se a Meta der erro, ela manda detalhes no error.response.data
        console.error('❌ Erro:', error.response ? error.response.data : error.message);
        res.status(500).send({ error: 'Falha no processamento' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});