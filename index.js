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
        // Imprime o que chegou no log para a gente poder analisar
        console.log("DADOS RECEBIDOS:", JSON.stringify(req.body, null, 2));

        // Busca o email e o valor onde eles realmente estão (Kiwify ou Teste)
        const email_cliente = req.body?.Customer?.email || req.body?.email_cliente || 'email@naoenviado.com';
        const valor_compra = req.body?.order_value || req.body?.Commissions?.charge_amount || req.body?.valor_compra || 0;
        const moeda = req.body?.moeda || 'BRL';

        const metaPayload = {
            data: [
                {
                    event_name: 'Purchase',
                    event_time: Math.floor(Date.now() / 1000),
                    action_source: 'website',
                    user_data: {
                        em: [hashData(email_cliente)]
                    },
                    custom_data: {
                        value: valor_compra,
                        currency: moeda
                    }
                }
            ]
        };

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