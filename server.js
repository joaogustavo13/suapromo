const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
const db = require('./database');
const { runAutonomousMining, startAutoMiningCron } = require('./auto-miner');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');

// Inicializa banco de dados (PostgreSQL se DATABASE_URL estiver configurada, ou JSON local)
db.initDatabase().then(() => {
  setupTelegramWebhook();
}).catch(err => {
  console.error('Erro ao inicializar banco de dados:', err);
});

// Middlewares
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helpers JSON
function readJson(file, defaultValue = []) {
  try {
    if (!fs.existsSync(file)) return defaultValue;
    const content = fs.readFileSync(file, 'utf8');
    return JSON.parse(content || JSON.stringify(defaultValue));
  } catch (err) {
    return defaultValue;
  }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

// Configuração VAPID Web Push (Notificações mesmo com navegador/site fechado)
const initialSettings = readJson(SETTINGS_FILE, {});
if (initialSettings.vapidPublicKey && initialSettings.vapidPrivateKey) {
  try {
    webpush.setVapidDetails(
      'mailto:contato@suapromo.com',
      initialSettings.vapidPublicKey,
      initialSettings.vapidPrivateKey
    );
    console.log('✅ WebPush configurado com chaves VAPID.');
  } catch (err) {
    console.error('Erro ao configurar VAPID WebPush:', err);
  }
}

// Envia Push Notification para dispositivos inscritos de um usuário específico
async function sendPushNotificationToUser(userId, payload) {
  const subscriptions = readJson(SUBSCRIPTIONS_FILE, {});
  const userSubs = subscriptions[userId] || [];
  console.log(`[WebPush] Disparando push para userId ${userId}. Dispositivos registrados: ${userSubs.length}`);
  if (userSubs.length === 0) return;

  const validSubs = [];
  for (const sub of userSubs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      console.log(`[WebPush] ✅ Push entregue com sucesso: ${sub.endpoint.substring(0, 40)}...`);
      validSubs.push(sub);
    } catch (err) {
      console.warn(`[WebPush] ❌ Erro envio para ${userId}:`, err.statusCode || err.message);
      // Se 410 (Gone) ou 404 (Not Found), a inscrição foi revogada no dispositivo
      if (err.statusCode !== 410 && err.statusCode !== 404) {
        validSubs.push(sub);
      }
    }
  }

  if (validSubs.length !== userSubs.length) {
    subscriptions[userId] = validSubs;
    writeJson(SUBSCRIPTIONS_FILE, subscriptions);
  }
}

// Dispara Notificação Push para TODOS os celulares/computadores cadastrados no site (logados ou não)
async function broadcastPushNotification(payload) {
  const subscriptions = await db.getAllSubscriptions();
  const allEndpoints = new Set();
  const allSubs = [];

  for (const key in subscriptions) {
    const raw = subscriptions[key];
    const list = Array.isArray(raw) ? raw : [raw];
    for (const sub of list) {
      if (sub && sub.endpoint && !allEndpoints.has(sub.endpoint)) {
        allEndpoints.add(sub.endpoint);
        allSubs.push(sub);
      }
    }
  }

  console.log(`[WebPush Broadcast] Disparando para todos os ${allSubs.length} celulares/dispositivos cadastrados...`);
  if (allSubs.length === 0) return { success: true, count: 0 };

  let successCount = 0;
  for (const sub of allSubs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      console.log(`[WebPush Broadcast] ✅ Push entregue: ${sub.endpoint.substring(0, 45)}...`);
      successCount++;
    } catch (err) {
      console.warn(`[WebPush Broadcast] ❌ Erro em dispositivo:`, err.statusCode || err.message);
      if (err.statusCode === 410 || err.statusCode === 404) {
        await db.removeSubscription(sub.endpoint);
      }
    }
  }

  console.log(`[WebPush Broadcast] Concluído: ${successCount}/${allSubs.length} celulares notificados.`);
  return { success: true, sent: successCount, total: allSubs.length };
}

// --- NOTIFICAÇÃO AO DONO (ROBÔ TELEGRAM) ---
function sendAudioToTelegram(token, chatId, msg) {
  return new Promise((resolve) => {
    try {
      const match = (msg.questionAudio || '').match(/^data:audio\/([a-zA-Z0-9.-]+);base64,(.+)$/);
      if (!match) return resolve(false);

      const ext = match[1].includes('mp4') ? 'm4a' : (match[1].includes('webm') ? 'webm' : 'ogg');
      const audioBuffer = Buffer.from(match[2], 'base64');

      const phoneInfo = msg.phone ? `\n📱 WhatsApp: ${msg.phone}` : '';
      const prodInfo = msg.productTitle ? `\n🏷️ Oferta: ${msg.productTitle}` : '';
      const caption = `🎤 ÁUDIO DO CLIENTE NO SUA PROMO!\n\n` +
        `👤 Cliente: ${msg.username}${phoneInfo}${prodInfo}\n\n` +
        `👉 Toque para ouvir o áudio do cliente e responda no painel:`;

      const inlineKeyboard = {
        inline_keyboard: [
          [{ text: '💬 Abrir Painel e Responder', url: 'https://suapromo.onrender.com/admin.html' }]
        ]
      };

      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      const parts = [];
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${String(chatId).trim()}\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="reply_markup"\r\n\r\n${JSON.stringify(inlineKeyboard)}\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="audio_${msg.id}.${ext}"\r\nContent-Type: audio/${ext}\r\n\r\n`));
      parts.push(audioBuffer);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

      const fullLen = parts.reduce((a, b) => a + b.length, 0);

      const req = https.request({
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${String(token).trim()}/sendAudio`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': fullLen
        },
        timeout: 20000
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.ok) {
              console.log('🤖 [Telegram Bot] ✅ Áudio do cliente enviado ao Telegram do dono!');
              resolve(true);
            } else {
              console.warn('🤖 [Telegram Bot] ❌ Erro envio áudio Telegram:', data.description);
              resolve(false);
            }
          } catch (e) {
            resolve(false);
          }
        });
      });

      req.on('error', err => {
        console.error('🤖 [Telegram Bot] Erro de rede ao enviar áudio:', err.message);
        resolve(false);
      });

      parts.forEach(p => req.write(p));
      req.end();
    } catch (err) {
      console.error('🤖 [Telegram Bot] Exceção ao enviar áudio:', err.message);
      resolve(false);
    }
  });
}

async function notifyOwnerViaTelegram(msg) {
  const settings = db.getSettings();
  const token = process.env.TELEGRAM_BOT_TOKEN || settings.telegramBotToken;
  const chatId = process.env.TELEGRAM_CHAT_ID || settings.telegramChatId;

  if (!token || !chatId) {
    console.warn('🤖 [Telegram Bot] Token ou Chat ID não configurados.');
    return false;
  }

  // Se o cliente enviou áudio, despacha o arquivo de áudio diretamente para o Telegram do dono!
  if (msg.questionAudio && msg.questionAudio.startsWith('data:audio/')) {
    return sendAudioToTelegram(token, chatId, msg);
  }

  const phoneInfo = msg.phone ? `\n📱 WhatsApp do Cliente: ${msg.phone}` : '';
  const prodInfo = msg.productTitle ? `\n🏷️ Oferta: ${msg.productTitle}` : '';

  const text = `🔥 NOVA DÚVIDA RECEBIDA NO SUA PROMO!\n\n` +
    `👤 Cliente: ${msg.username}${phoneInfo}${prodInfo}\n` +
    `💬 Dúvida: "${msg.question}"\n\n` +
    `👉 Toque no botão abaixo para responder pelo painel:`;

  return new Promise((resolve) => {
    try {
      const payload = JSON.stringify({
        chat_id: String(chatId).trim(),
        text,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💬 Abrir Painel e Responder', url: 'https://suapromo.onrender.com/admin.html' }
            ]
          ]
        }
      });

      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${String(token).trim()}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.ok) {
              console.log('🤖 [Telegram Bot] ✅ Dono avisado com sucesso no Telegram!');
              resolve(true);
            } else {
              console.warn('🤖 [Telegram Bot] ❌ Erro do Telegram:', data.description);
              resolve(false);
            }
          } catch (e) {
            console.error('🤖 [Telegram Bot] ❌ Erro ao parsear resposta:', e.message);
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        console.error('🤖 [Telegram Bot] ❌ Erro de conexão:', err.message);
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        console.error('🤖 [Telegram Bot] ❌ Timeout com Telegram API');
        resolve(false);
      });

      req.write(payload);
      req.end();
    } catch (err) {
      console.error('🤖 [Telegram Bot] ❌ Exceção:', err.message);
      resolve(false);
    }
  });
}

function setupTelegramWebhook() {
  const settings = db.getSettings();
  const token = process.env.TELEGRAM_BOT_TOKEN || settings.telegramBotToken;
  if (!token) return;

  const webhookUrl = 'https://suapromo.onrender.com/api/telegram-webhook';
  const postData = JSON.stringify({ url: webhookUrl, drop_pending_updates: true });

  const req = https.request({
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${String(token).trim()}/setWebhook`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('🤖 [Telegram Webhook] Resposta setWebhook:', body);
    });
  });
  req.on('error', err => console.warn('Erro ao configurar webhook Telegram:', err.message));
  req.write(postData);
  req.end();
}

// Inicia o robô autônomo de ofertas do Mercado Livre a cada 30 minutos
startAutoMiningCron(30);

// --- SEGURANÇA & SESSÃO ADMIN ---
const adminSessions = new Set();

function getAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD.trim();
  const settings = db.getSettings();
  return settings.adminPassword || 'Paquistao01';
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: 'Acesso negado. Senha de administrador obrigatória.' });
  }
  next();
}

// Login do Administrador
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const correct = getAdminPassword();

  if (!password || password !== correct) {
    return res.status(401).json({ error: 'Senha de administrador incorreta.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.add(token);

  res.json({ success: true, token });
});

// Verificação de sessão do admin
app.get('/api/admin/verify', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token && adminSessions.has(token)) {
    return res.json({ valid: true });
  }
  res.status(401).json({ valid: false });
});

// Logout do Admin
app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) adminSessions.delete(token);
  res.json({ success: true });
});

// Alterar senha do admin
app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.trim().length < 4) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 4 caracteres.' });
  }

  const settings = db.getSettings();
  settings.adminPassword = newPassword.trim();
  await db.saveSettings(settings);

  res.json({ success: true, message: 'Senha alterada com sucesso!' });
});

// --- ROTAS DE PRODUTOS & AUTOMAÇÃO ---

// Produtos da vitrine (público)
app.get('/api/products', (req, res) => {
  let products = readJson(PRODUCTS_FILE, []);
  const { search, category } = req.query;

  if (category && category !== 'Todos') {
    products = products.filter(p => p.category && p.category.toLowerCase() === category.toLowerCase());
  }

  if (search) {
    const q = search.toLowerCase();
    products = products.filter(p => 
      (p.title && p.title.toLowerCase().includes(q)) || 
      (p.category && p.category.toLowerCase().includes(q)) ||
      (p.badge && p.badge.toLowerCase().includes(q))
    );
  }

  res.json(products);
});

// Configurações públicas
app.get('/api/settings', (req, res) => {
  const settings = db.getSettings();
  const { adminPassword, ...publicSettings } = settings;
  res.json(publicSettings);
});

// Acionamento manual do robô autônomo (protegido)
app.post('/api/miner/run', requireAdmin, async (req, res) => {
  try {
    const result = await runAutonomousMining();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- AUTENTICAÇÃO SIMPLES (NOME + SENHA) ---

app.post('/api/auth/login-or-register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password || !username.trim() || !password.trim()) {
    return res.status(400).json({ error: 'Nome de usuário e senha são obrigatórios.' });
  }

  const cleanUser = username.trim().toLowerCase();
  const existing = await db.getUserByUsername(cleanUser);

  if (existing) {
    // Login
    if (existing.password !== password) {
      return res.status(401).json({ error: 'Senha incorreta para este usuário.' });
    }
    return res.json({
      success: true,
      action: 'login',
      user: { id: existing.id, username: existing.displayName || existing.username }
    });
  } else {
    // Cadastro automático
    const newUser = {
      id: 'usr_' + crypto.randomUUID().slice(0, 8),
      username: cleanUser,
      displayName: username.trim(),
      password: password,
      createdAt: new Date().toISOString()
    };
    await db.createUser(newUser);
    return res.json({
      success: true,
      action: 'registered',
      user: { id: newUser.id, username: newUser.displayName || newUser.username }
    });
  }
});

// --- SISTEMA DE MENSAGENS DO CLIENTE ---

// Mensagens do usuário logado
app.get('/api/user/messages', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

  const userMessages = await db.getMessages(userId);
  res.json(userMessages);
});

// Usuário envia uma dúvida sobre um produto (texto ou áudio)
app.post('/api/user/messages', async (req, res) => {
  const { userId, username, productId, productTitle, productImage, productLink, phone, question, questionAudio } = req.body;

  if (!userId || ((!question || !question.trim()) && !questionAudio)) {
    return res.status(400).json({ error: 'Envie sua dúvida em texto ou por áudio.' });
  }

  const now = new Date().toISOString();

  const newMsg = {
    id: 'msg_' + crypto.randomUUID().slice(0, 8),
    userId,
    username: username || 'Usuário',
    phone: phone ? phone.trim() : null,
    productId: productId || null,
    productTitle: productTitle || null,
    productImage: productImage || null,
    productLink: productLink || null,
    question: (question && question.trim()) || '🎤 [Dúvida em Áudio]',
    questionAudio: questionAudio || null,
    reply: null,
    replyAudio: null,
    status: 'pending', // 'pending' | 'answered'
    createdAt: now,
    repliedAt: null
  };

  await db.addMessage(newMsg);

  // Avisa painel do admin via Socket
  io.to('admin-room').emit('admin:new_question', newMsg);

  // 1. Robô avisa o Dono no Telegram na hora (garante envio antes de responder)
  try {
    await notifyOwnerViaTelegram(newMsg);
  } catch (tgErr) {
    console.error('Erro ao notificar Telegram:', tgErr.message);
  }

  // 2. Dispara Web Push de alerta para os aparelhos do Dono
  sendPushNotificationToUser('admin', {
    title: 'Sua Promo 💬 Nova Dúvida Recebida!',
    body: `${newMsg.username}: "${newMsg.question.substring(0, 50)}"`,
    icon: '/icons/icon-192.png',
    url: '/admin.html'
  });

  res.status(201).json({ success: true, message: newMsg });
});

// --- WEBHOOK PARA COMANDOS NO BOT DO TELEGRAM ---
app.post('/api/telegram-webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const update = req.body;
    if (!update || !update.message) return;
    const fromId = update.message.chat && update.message.chat.id;
    const text = (update.message.text || '').trim();

    const settings = db.getSettings();
    const token = process.env.TELEGRAM_BOT_TOKEN || settings.telegramBotToken;
    if (!token || !fromId) return;

    const messages = await db.getMessages();
    const pendingCount = messages.filter(m => m.status === 'pending').length;

    let replyText = `🤖 Olá, João! O Robô do Sua Promo está 100% ONLINE e ATIVO! 🔥\n\n` +
      `📊 Status do Sistema:\n` +
      `• Dúvidas pendentes: ${pendingCount}\n` +
      `• Monitor de Ofertas: Ativo\n` +
      `• Notificações WebPush: Ativas\n\n` +
      `Sempre que qualquer visitante enviar uma pergunta em qualquer produto, você receberá um alerta imediato aqui!`;

    const payload = JSON.stringify({
      chat_id: fromId,
      text: replyText,
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Abrir Painel do Dono', url: 'https://suapromo.onrender.com/admin.html' }],
          [{ text: '🛒 Ver Vitrine de Ofertas', url: 'https://suapromo.onrender.com' }]
        ]
      }
    });

    const opt = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${String(token).trim()}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const tgReq = https.request(opt);
    tgReq.on('error', err => console.warn('Erro resposta webhook:', err.message));
    tgReq.write(payload);
    tgReq.end();
  } catch (err) {
    console.error('Erro processando webhook Telegram:', err.message);
  }
});

// --- CONFIGURAÇÃO DO ROBÔ DE ALERTAS (TELEGRAM) ---

app.get('/api/admin/settings/telegram', requireAdmin, (req, res) => {
  const settings = db.getSettings();
  res.json({
    token: process.env.TELEGRAM_BOT_TOKEN || settings.telegramBotToken || '',
    chatId: process.env.TELEGRAM_CHAT_ID || settings.telegramChatId || '',
    isEnvConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
  });
});

app.post('/api/admin/settings/telegram', requireAdmin, async (req, res) => {
  const { token, chatId } = req.body;
  const settings = db.getSettings();
  settings.telegramBotToken = (token && token.trim()) || '';
  settings.telegramChatId = (chatId && chatId.trim()) || '';
  await db.saveSettings(settings);
  setupTelegramWebhook();
  res.json({ success: true, settings: { telegramBotToken: settings.telegramBotToken, telegramChatId: settings.telegramChatId } });
});

app.post('/api/admin/test-telegram', requireAdmin, async (req, res) => {
  const ok = await notifyOwnerViaTelegram({
    username: 'Teste do Sistema',
    question: 'Robô de alertas configurado com sucesso! Você será avisado aqui sempre que alguém fizer uma pergunta.',
    productTitle: 'Robô Sua Promo Ativo'
  });

  if (ok) {
    res.json({ success: true, message: 'Alerta de teste enviado para o seu Telegram!' });
  } else {
    res.status(400).json({ error: 'Falha ao enviar mensagem no Telegram. Verifique se o Token e o Chat ID estão corretos e se você deu /start no bot.' });
  }
});

// --- ADMINISTRAÇÃO DAS MENSAGENS (PROTEGIDAS COM requireAdmin) ---

// Lista todas as dúvidas
app.get('/api/admin/messages', requireAdmin, async (req, res) => {
  const messages = await db.getMessages();
  res.json(messages);
});

// Dono responde à dúvida (texto ou áudio)
app.post('/api/admin/reply/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { reply, replyAudio } = req.body;

  if ((!reply || !reply.trim()) && !replyAudio) {
    return res.status(400).json({ error: 'Envie uma resposta em texto ou por áudio.' });
  }

  const now = new Date().toISOString();
  const effectiveReply = (reply && reply.trim()) || '🎤 [Resposta em Áudio]';
  const updatedMsg = await db.updateMessageReply(id, effectiveReply, now, replyAudio || null);

  if (!updatedMsg) {
    return res.status(404).json({ error: 'Mensagem não encontrada.' });
  }

  // Notifica via Socket o usuário (se estiver com a página aberta)
  io.to(`user_${updatedMsg.userId}`).emit('user:message_answered', updatedMsg);
  io.to('admin-room').emit('admin:message_updated', updatedMsg);

  // Notifica via Web Push para TODOS os celulares cadastrados (mesmo site fechado)
  const pushBody = replyAudio
    ? 'Temos uma resposta em áudio para você! Toque para ouvir.'
    : 'Temos uma promoção para você! Toque para conferir.';

  await broadcastPushNotification({
    title: 'Sua Promo 🔥',
    body: pushBody,
    icon: '/icons/icon-192.png',
    url: '/'
  });

  res.json({ success: true, message: updatedMsg });
});

// --- ROTAS DE WEB PUSH NOTIFICATION ---

// Retorna chave pública VAPID para o cliente se inscrever no navegador
app.get('/api/push-public-key', (req, res) => {
  const settings = db.getSettings();
  res.json({ publicKey: settings.vapidPublicKey || '' });
});

// Salva inscrição Push do dispositivo (funciona logado ou NÃO LOGADO / visitante)
app.post('/api/user/push-subscription', async (req, res) => {
  const { userId, subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Inscrição push inválida.' });
  }

  const effectiveUserId = userId || 'anonymous';
  await db.saveSubscription(effectiveUserId, subscription);
  console.log(`[WebPush] ✅ Dispositivo registrado para ${effectiveUserId}.`);

  res.json({ success: true });
});

// Disparo Manual de Push para TODOS os celulares (Admin)
app.post('/api/admin/broadcast-push', requireAdmin, async (req, res) => {
  const { title, body } = req.body;
  const payload = {
    title: (title && title.trim()) || 'Sua Promo 🔥',
    body: (body && body.trim()) || 'Temos uma promoção para você! Toque para conferir.',
    icon: '/icons/icon-192.png',
    url: '/'
  };
  const result = await broadcastPushNotification(payload);
  res.json(result);
});

// Rota de status para ver quantos celulares/computadores estão inscritos
app.get('/api/admin/push-stats', requireAdmin, async (req, res) => {
  const subscriptions = await db.getAllSubscriptions();
  const userCount = Object.keys(subscriptions).length;
  let totalDevices = 0;
  for (const uid in subscriptions) {
    totalDevices += (subscriptions[uid] || []).length;
  }
  res.json({ userCount, totalDevices, isUsingPostgres: db.isUsingPostgres() });
});

// Exclui mensagem
app.delete('/api/admin/message/:id', requireAdmin, async (req, res) => {
  await db.deleteMessage(req.params.id);
  res.json({ success: true });
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
  // Usuário entra na sua sala pessoal
  socket.on('user:join', ({ userId }) => {
    if (userId) {
      socket.join(`user_${userId}`);
    }
  });

  // Admin entra na sala admin COM VERIFICAÇÃO DE TOKEN
  socket.on('admin:join', ({ token } = {}) => {
    if (token && adminSessions.has(token)) {
      socket.join('admin-room');
      socket.isAdmin = true;
    }
  });
});

// Inicialização
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🔒 Painel Admin com Autenticação de Segurança Ativa!`);
  console.log(`🌐 Vitrine: http://localhost:${PORT}`);
  console.log(`💬 Painel Admin: http://localhost:${PORT}/admin.html`);
  console.log(`=======================================================`);
});
