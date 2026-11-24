const https = require('https');

// Envia mensagem para o Telegram do dono do site caso configurado
async function notifyTelegram(botToken, chatId, messageText) {
  if (!botToken || !chatId) {
    return { success: false, reason: 'Telegram não configurado' };
  }

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      chat_id: chatId.trim(),
      text: messageText,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${botToken.trim()}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const resp = JSON.parse(data);
          if (resp.ok) {
            console.log('[Notifier] Notificação enviada para o Telegram com sucesso!');
            resolve({ success: true });
          } else {
            console.error('[Notifier] Erro Telegram:', resp.description);
            resolve({ success: false, error: resp.description });
          }
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Notifier] Falha na requisição Telegram:', err.message);
      resolve({ success: false, error: err.message });
    });

    req.write(postData);
    req.end();
  });
}

// Formata número de WhatsApp brasileiro e gera o link direto
function generateWhatsAppLink(phone, clientName, productTitle, replyText) {
  if (!phone) return '';
  // Limpa caracteres não numéricos
  let clean = phone.replace(/\D/g, '');
  if (!clean) return '';

  // Se não tiver DDI 55, adiciona
  if (clean.length === 10 || clean.length === 11) {
    clean = '55' + clean;
  }

  const greeting = clientName ? `Olá ${clientName}!` : 'Olá!';
  const prodReference = productTitle ? ` sobre "${productTitle}"` : '';
  const text = replyText 
    ? `${greeting} Aqui é do suporte de ofertas do Mercado Livre. Vi sua dúvida${prodReference}:\n\n${replyText}`
    : `${greeting} Aqui é do suporte de ofertas do Mercado Livre. Vi sua mensagem no site${prodReference}! Como posso te ajudar?`;

  return `https://wa.me/${clean}?text=${encodeURIComponent(text)}`;
}

module.exports = { notifyTelegram, generateWhatsAppLink };
