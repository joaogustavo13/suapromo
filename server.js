const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

// Inicia o robô autônomo de ofertas do Mercado Livre a cada 30 minutos
startAutoMiningCron(30);

// --- ROTAS DE PRODUTOS & AUTOMAÇÃO ---

// Produtos da vitrine
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

// Acionamento manual do robô autônomo
app.post('/api/miner/run', async (req, res) => {
  try {
    const result = await runAutonomousMining();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- AUTENTICAÇÃO SIMPLES (NOME + SENHA) ---

app.post('/api/auth/login-or-register', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password || !username.trim() || !password.trim()) {
    return res.status(400).json({ error: 'Nome de usuário e senha são obrigatórios.' });
  }

  const cleanUser = username.trim().toLowerCase();
  const users = readJson(USERS_FILE, []);

  const existing = users.find(u => u.username.toLowerCase() === cleanUser);

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
    users.push(newUser);
    writeJson(USERS_FILE, users);
    return res.json({
      success: true,
      action: 'registered',
      user: { id: newUser.id, username: newUser.displayName }
    });
  }
});

// --- SISTEMA DE MENSAGENS DO CLIENTE ---

// Mensagens do usuário logado
app.get('/api/user/messages', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

  const messages = readJson(MESSAGES_FILE, []);
  const userMessages = messages.filter(m => m.userId === userId);
  userMessages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(userMessages);
});

// Usuário envia uma dúvida sobre um produto
app.post('/api/user/messages', (req, res) => {
  const { userId, username, productId, productTitle, productImage, productLink, question } = req.body;

  if (!userId || !question || !question.trim()) {
    return res.status(400).json({ error: 'Usuário e pergunta são obrigatórios.' });
  }

  const messages = readJson(MESSAGES_FILE, []);
  const now = new Date().toISOString();

  const newMsg = {
    id: 'msg_' + crypto.randomUUID().slice(0, 8),
    userId,
    username: username || 'Usuário',
    productId: productId || null,
    productTitle: productTitle || null,
    productImage: productImage || null,
    productLink: productLink || null,
    question: question.trim(),
    reply: null,
    status: 'pending', // 'pending' | 'answered'
    createdAt: now,
    repliedAt: null
  };

  messages.unshift(newMsg);
  writeJson(MESSAGES_FILE, messages);

  // Avisa painel do admin
  io.to('admin-room').emit('admin:new_question', newMsg);

  res.status(201).json({ success: true, message: newMsg });
});

// --- ADMINISTRAÇÃO DAS MENSAGENS ---

// Lista todas as dúvidas
app.get('/api/admin/messages', (req, res) => {
  const messages = readJson(MESSAGES_FILE, []);
  messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(messages);
});

// Dono responde à dúvida
app.post('/api/admin/reply/:id', (req, res) => {
  const { id } = req.params;
  const { reply } = req.body;

  if (!reply || !reply.trim()) {
    return res.status(400).json({ error: 'Resposta não pode ser vazia.' });
  }

  const messages = readJson(MESSAGES_FILE, []);
  const index = messages.findIndex(m => m.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Mensagem não encontrada.' });
  }

  const now = new Date().toISOString();
  messages[index].reply = reply.trim();
  messages[index].status = 'answered';
  messages[index].repliedAt = now;

  writeJson(MESSAGES_FILE, messages);

  // Notifica via Socket o usuário (Web Notification se estiver online)
  io.to(`user_${messages[index].userId}`).emit('user:message_answered', messages[index]);
  io.to('admin-room').emit('admin:message_updated', messages[index]);

  res.json({ success: true, message: messages[index] });
});

// Exclui mensagem
app.delete('/api/admin/message/:id', (req, res) => {
  let messages = readJson(MESSAGES_FILE, []);
  messages = messages.filter(m => m.id !== req.params.id);
  writeJson(MESSAGES_FILE, messages);
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

  // Admin entra na sala admin
  socket.on('admin:join', () => {
    socket.join('admin-room');
  });
});

// Inicialização
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🤖 Robô Autônomo & Sistema com Nome e Senha Ativos!`);
  console.log(`🌐 Vitrine: http://localhost:${PORT}`);
  console.log(`💬 Painel Admin: http://localhost:${PORT}/admin.html`);
  console.log(`=======================================================`);
});
