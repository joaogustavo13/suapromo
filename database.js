// Camada de Banco de Dados Híbrida (PostgreSQL em Nuvem / Fallback JSON Local)
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

let pool = null;
let usePostgres = false;
let cachedSettings = readJson(SETTINGS_FILE, {});

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

// Inicializa conexão e tabelas
async function initDatabase() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log('📁 DATABASE_URL não configurada. Usando armazenamento JSON local em /data.');
    return false;
  }

  try {
    const isSslNeeded = dbUrl.includes('render.com') || dbUrl.includes('supabase') || dbUrl.includes('neon') || dbUrl.includes('postgres://');
    pool = new Pool({
      connectionString: dbUrl,
      ssl: isSslNeeded ? { rejectUnauthorized: false } : false
    });

    // Criação de tabelas se não existirem
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id VARCHAR(64) PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS app_messages (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64),
        username VARCHAR(255),
        phone VARCHAR(64),
        product_id VARCHAR(64),
        product_title TEXT,
        product_image TEXT,
        product_link TEXT,
        question TEXT,
        question_audio TEXT,
        reply TEXT,
        reply_audio TEXT,
        status VARCHAR(32) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        replied_at TIMESTAMPTZ
      );

      -- Garante novas colunas de áudio, foto e histórico de conversa caso a tabela já exista
      ALTER TABLE app_messages ADD COLUMN IF NOT EXISTS question_audio TEXT;
      ALTER TABLE app_messages ADD COLUMN IF NOT EXISTS reply_audio TEXT;
      ALTER TABLE app_messages ADD COLUMN IF NOT EXISTS question_image TEXT;
      ALTER TABLE app_messages ADD COLUMN IF NOT EXISTS reply_image TEXT;
      ALTER TABLE app_messages ADD COLUMN IF NOT EXISTS history JSONB DEFAULT '[]';

      CREATE TABLE IF NOT EXISTS app_subscriptions (
        endpoint TEXT PRIMARY KEY,
        user_id VARCHAR(64),
        subscription JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(64) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    usePostgres = true;
    console.log('🐘 PostgreSQL conectado e tabelas sincronizadas com sucesso! Dados 100% persistentes.');

    // Sincroniza configurações globais no PostgreSQL
    try {
      const settingsRes = await pool.query("SELECT value FROM app_settings WHERE key = 'global'");
      const fileSettings = readJson(SETTINGS_FILE, {});
      if (settingsRes.rows.length > 0) {
        const pgSettings = settingsRes.rows[0].value || {};
        cachedSettings = { ...fileSettings, ...pgSettings };

        // Preserva valores essenciais do arquivo se vierem em branco do banco antigo
        if (!cachedSettings.telegramBotToken && fileSettings.telegramBotToken) {
          cachedSettings.telegramBotToken = fileSettings.telegramBotToken;
        }
        if (!cachedSettings.telegramChatId && fileSettings.telegramChatId) {
          cachedSettings.telegramChatId = fileSettings.telegramChatId;
        }
        if (!cachedSettings.adminPassword && fileSettings.adminPassword) {
          cachedSettings.adminPassword = fileSettings.adminPassword;
        }
        console.log('⚙️ [Settings] Configurações carregadas do PostgreSQL com sucesso.');
      } else {
        cachedSettings = { ...fileSettings };
      }

      // Sincroniza de volta no banco para garantir que token e chat ID estejam gravados
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('global', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [JSON.stringify(cachedSettings)]
      );
      console.log('⚙️ [Settings] Configurações sincronizadas no PostgreSQL.');
    } catch (setErr) {
      console.warn('⚠️ Erro ao carregar/salvar app_settings do PostgreSQL:', setErr.message);
    }

    // Migração inicial: se a tabela de mensagens estiver vazia, importa do JSON local
    const countRes = await pool.query('SELECT COUNT(*) FROM app_messages');
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      const initialMessages = readJson(MESSAGES_FILE, []);
      for (const m of initialMessages) {
        await pool.query(
          `INSERT INTO app_messages (id, user_id, username, phone, product_id, product_title, product_image, product_link, question, reply, status, created_at, replied_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (id) DO NOTHING`,
          [m.id, m.userId, m.username, m.phone || null, m.productId, m.productTitle, m.productImage, m.productLink, m.question, m.reply, m.status, m.createdAt, m.repliedAt]
        );
      }
      console.log(`[Database] Migradas ${initialMessages.length} mensagens iniciais para o PostgreSQL.`);
    }

    // Consolida conversas duplicadas por user_id (1 chat único por cliente)
    await consolidateDuplicateChatsPostgres();

    return true;
  } catch (err) {
    console.error('❌ Erro ao conectar ao PostgreSQL, mantendo fallback JSON:', err.message);
    usePostgres = false;
    consolidateDuplicateChatsJson();
    return false;
  }
}

async function consolidateDuplicateChatsPostgres() {
  try {
    const res = await pool.query('SELECT * FROM app_messages ORDER BY created_at ASC');
    if (res.rows.length <= 1) return;

    const byUser = new Map();
    for (const row of res.rows) {
      const uid = row.user_id || row.id;
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid).push(formatMessageRow(row));
    }

    for (const [uid, rows] of byUser.entries()) {
      if (rows.length <= 1) continue;

      const primary = rows[0];
      let mergedHistory = [];
      let latest = rows[rows.length - 1];

      for (const r of rows) {
        const items = (r.history || []).map((entry, idx) => {
          if (idx === 0 && entry.sender === 'client' && !entry.productTitle && r.productTitle) {
            return {
              ...entry,
              productId: r.productId,
              productTitle: r.productTitle,
              productImage: r.productImage,
              productLink: r.productLink
            };
          }
          return entry;
        });
        mergedHistory.push(...items);
      }

      mergedHistory.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

      const hasPending = rows.some(r => r.status === 'pending') || latest.status === 'pending';
      const finalStatus = hasPending && mergedHistory[mergedHistory.length - 1]?.sender === 'client' ? 'pending' : latest.status;

      await pool.query(
        `UPDATE app_messages
         SET phone = COALESCE($1, phone),
             product_id = COALESCE($2, product_id),
             product_title = COALESCE($3, product_title),
             product_image = COALESCE($4, product_image),
             product_link = COALESCE($5, product_link),
             question = $6,
             question_audio = $7,
             reply = $8,
             reply_audio = $9,
             status = $10,
             history = $11,
             created_at = $12,
             replied_at = $13
         WHERE id = $14`,
        [
          latest.phone || primary.phone,
          latest.productId || primary.productId,
          latest.productTitle || primary.productTitle,
          latest.productImage || primary.productImage,
          latest.productLink || primary.productLink,
          latest.question,
          latest.questionAudio,
          latest.reply,
          latest.replyAudio,
          finalStatus,
          JSON.stringify(mergedHistory),
          latest.createdAt,
          latest.repliedAt,
          primary.id
        ]
      );

      const idsToDelete = rows.slice(1).map(r => r.id);
      await pool.query('DELETE FROM app_messages WHERE id = ANY($1::text[])', [idsToDelete]);
      console.log(`🔄 [Database] Consolidadas ${rows.length} conversas do cliente ${uid} em 1 chat único.`);
    }
  } catch (err) {
    console.warn('⚠️ Erro ao consolidar conversas por usuário:', err.message);
  }
}

function consolidateDuplicateChatsJson() {
  const list = readJson(MESSAGES_FILE, []);
  if (list.length <= 1) return;
  const byUser = new Map();
  // Mais antigas primeiro para manter ordem cronológica
  const sorted = [...list].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  for (const m of sorted) {
    const uid = m.userId || m.id;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(m);
  }
  const consolidated = [];
  for (const [, rows] of byUser.entries()) {
    if (rows.length === 1) {
      consolidated.push(rows[0]);
      continue;
    }
    const primary = { ...rows[0] };
    const latest = rows[rows.length - 1];
    const mergedHistory = [];
    for (const r of rows) {
      const hist = Array.isArray(r.history) && r.history.length > 0 ? r.history : [
        { id: 'msg_q_' + r.id, sender: 'client', text: r.question || '', audio: r.questionAudio || null, productId: r.productId, productTitle: r.productTitle, productImage: r.productImage, productLink: r.productLink, createdAt: r.createdAt },
        ...(r.reply || r.replyAudio ? [{ id: 'msg_r_' + r.id, sender: 'admin', text: r.reply || '', audio: r.replyAudio || null, createdAt: r.repliedAt || r.createdAt }] : [])
      ];
      mergedHistory.push(...hist);
    }
    mergedHistory.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    primary.history = mergedHistory;
    primary.phone = latest.phone || primary.phone;
    primary.productId = latest.productId || primary.productId;
    primary.productTitle = latest.productTitle || primary.productTitle;
    primary.productImage = latest.productImage || primary.productImage;
    primary.productLink = latest.productLink || primary.productLink;
    primary.question = latest.question;
    primary.questionAudio = latest.questionAudio;
    primary.reply = latest.reply;
    primary.replyAudio = latest.replyAudio;
    primary.status = mergedHistory[mergedHistory.length - 1]?.sender === 'client' ? 'pending' : latest.status;
    primary.createdAt = latest.createdAt;
    primary.repliedAt = latest.repliedAt;
    consolidated.push(primary);
  }
  consolidated.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  writeJson(MESSAGES_FILE, consolidated);
}

// --- MENSAGENS ---

function formatMessageRow(r) {
  let hist = [];
  if (Array.isArray(r.history)) {
    hist = r.history;
  } else if (typeof r.history === 'string' && r.history.trim()) {
    try { hist = JSON.parse(r.history); } catch (e) {}
  }
  // Se histórico estiver vazio, popula com question e reply para retrocompatibilidade
  if (!hist || hist.length === 0) {
    hist = [];
    if (r.question || r.question_audio) {
      hist.push({
        id: 'msg_q_' + r.id,
        sender: 'client',
        text: r.question || '',
        audio: r.question_audio || null,
        productId: r.product_id || null,
        productTitle: r.product_title || null,
        productImage: r.product_image || null,
        productLink: r.product_link || null,
        createdAt: r.created_at
      });
    }
    if (r.reply || r.reply_audio) {
      hist.push({
        id: 'msg_r_' + r.id,
        sender: 'admin',
        text: r.reply || '',
        audio: r.reply_audio || null,
        createdAt: r.replied_at || r.created_at
      });
    }
  }

  return {
    id: r.id,
    userId: r.user_id,
    username: r.username,
    phone: r.phone,
    productId: r.product_id,
    productTitle: r.product_title,
    productImage: r.product_image,
    productLink: r.product_link,
    question: r.question,
    questionAudio: r.question_audio || null,
    questionImage: r.question_image || null,
    reply: r.reply,
    replyAudio: r.reply_audio || null,
    replyImage: r.reply_image || null,
    status: r.status,
    history: hist,
    createdAt: r.created_at,
    repliedAt: r.replied_at
  };
}

async function getMessages(userId = null) {
  if (usePostgres) {
    try {
      let query = 'SELECT * FROM app_messages';
      const params = [];
      if (userId) {
        query += ' WHERE user_id = $1';
        params.push(userId);
      }
      query += ' ORDER BY created_at DESC';
      const res = await pool.query(query, params);
      return res.rows.map(formatMessageRow);
    } catch (err) {
      console.error('Erro getMessages Postgres:', err);
    }
  }

  // Fallback JSON
  const messages = readJson(MESSAGES_FILE, []).map(m => {
    if (!m.history || !Array.isArray(m.history) || m.history.length === 0) {
      const hist = [];
      if (m.question || m.questionAudio) {
        hist.push({
          id: 'msg_q_' + m.id,
          sender: 'client',
          text: m.question || '',
          audio: m.questionAudio || null,
          productId: m.productId || null,
          productTitle: m.productTitle || null,
          productImage: m.productImage || null,
          productLink: m.productLink || null,
          createdAt: m.createdAt
        });
      }
      if (m.reply || m.replyAudio) {
        hist.push({
          id: 'msg_r_' + m.id,
          sender: 'admin',
          text: m.reply || '',
          audio: m.replyAudio || null,
          createdAt: m.repliedAt || m.createdAt
        });
      }
      m.history = hist;
    }
    return m;
  });

  if (userId) {
    return messages.filter(m => m.userId === userId);
  }
  return messages;
}

async function addMessage(msg) {
  const newEntry = {
    id: 'sub_' + crypto.randomUUID().slice(0, 8),
    sender: 'client',
    text: msg.question || '',
    audio: msg.questionAudio || null,
    image: msg.questionImage || null,
    productId: msg.productId || null,
    productTitle: msg.productTitle || null,
    productImage: msg.productImage || null,
    productLink: msg.productLink || null,
    createdAt: msg.createdAt
  };

  // Agrupa TUDO em 1 única conversa por userId!
  if (usePostgres) {
    try {
      const existingRes = await pool.query(
        'SELECT * FROM app_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [msg.userId]
      );

      if (existingRes.rows.length > 0) {
        const existing = formatMessageRow(existingRes.rows[0]);
        const updatedHistory = [...(existing.history || []), newEntry];
        const updRes = await pool.query(
          `UPDATE app_messages
           SET username = COALESCE($1, username),
               phone = COALESCE($2, phone),
               product_id = COALESCE($3, product_id),
               product_title = COALESCE($4, product_title),
               product_image = COALESCE($5, product_image),
               product_link = COALESCE($6, product_link),
               question = $7,
               question_audio = $8,
               question_image = $9,
               status = 'pending',
               history = $10,
               created_at = $11
           WHERE id = $12 RETURNING *`,
          [
            msg.username || existing.username,
            msg.phone || existing.phone,
            msg.productId || existing.productId,
            msg.productTitle || existing.productTitle,
            msg.productImage || existing.productImage,
            msg.productLink || existing.productLink,
            msg.question || '',
            msg.questionAudio || null,
            msg.questionImage || null,
            JSON.stringify(updatedHistory),
            msg.createdAt,
            existing.id
          ]
        );
        return formatMessageRow(updRes.rows[0]);
      }

      // Primeira conversa deste cliente
      msg.history = [newEntry];
      await pool.query(
        `INSERT INTO app_messages (id, user_id, username, phone, product_id, product_title, product_image, product_link, question, question_audio, question_image, reply, reply_audio, reply_image, status, history, created_at, replied_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          msg.id,
          msg.userId,
          msg.username,
          msg.phone || null,
          msg.productId,
          msg.productTitle,
          msg.productImage,
          msg.productLink,
          msg.question || '',
          msg.questionAudio || null,
          msg.questionImage || null,
          msg.reply || null,
          msg.replyAudio || null,
          msg.replyImage || null,
          msg.status || 'pending',
          JSON.stringify(msg.history),
          msg.createdAt,
          msg.repliedAt || null
        ]
      );
      return msg;
    } catch (err) {
      console.error('Erro addMessage Postgres:', err);
    }
  }

  // Fallback JSON: também agrupa em 1 única conversa por userId
  const messages = readJson(MESSAGES_FILE, []);
  const existingIdx = messages.findIndex(m => m.userId === msg.userId);
  if (existingIdx !== -1) {
    const existing = messages[existingIdx];
    const hist = Array.isArray(existing.history) && existing.history.length > 0 ? [...existing.history] : [
      {
        id: 'msg_q_' + existing.id,
        sender: 'client',
        text: existing.question || '',
        audio: existing.questionAudio || null,
        image: existing.questionImage || null,
        productId: existing.productId || null,
        productTitle: existing.productTitle || null,
        productImage: existing.productImage || null,
        productLink: existing.productLink || null,
        createdAt: existing.createdAt
      }
    ];
    hist.push(newEntry);
    existing.username = msg.username || existing.username;
    existing.phone = msg.phone || existing.phone;
    existing.productId = msg.productId || existing.productId;
    existing.productTitle = msg.productTitle || existing.productTitle;
    existing.productImage = msg.productImage || existing.productImage;
    existing.productLink = msg.productLink || existing.productLink;
    existing.question = msg.question || '';
    existing.questionAudio = msg.questionAudio || null;
    existing.questionImage = msg.questionImage || null;
    existing.status = 'pending';
    existing.history = hist;
    existing.createdAt = msg.createdAt;
    messages.splice(existingIdx, 1);
    messages.unshift(existing);
    writeJson(MESSAGES_FILE, messages);
    return existing;
  }

  msg.history = [newEntry];
  messages.unshift(msg);
  writeJson(MESSAGES_FILE, messages);
  return msg;
}

async function updateMessageReply(id, reply, repliedAt, replyAudio = null, replyImage = null) {
  let existing = null;
  if (usePostgres) {
    try {
      const check = await pool.query('SELECT * FROM app_messages WHERE id = $1', [id]);
      if (check.rows.length > 0) existing = formatMessageRow(check.rows[0]);
    } catch (e) {}
  } else {
    const list = readJson(MESSAGES_FILE, []);
    existing = list.find(m => m.id === id);
  }

  const history = existing ? [...(existing.history || [])] : [];
  history.push({
    id: 'sub_' + crypto.randomUUID().slice(0, 8),
    sender: 'admin',
    text: reply || '',
    audio: replyAudio || null,
    image: replyImage || null,
    createdAt: repliedAt
  });

  let updatedMsg = null;
  if (usePostgres) {
    try {
      const res = await pool.query(
        `UPDATE app_messages 
         SET reply = $1, reply_audio = $2, reply_image = $3, status = 'answered', replied_at = $4, history = $5 
         WHERE id = $6 RETURNING *`,
        [reply, replyAudio, replyImage, repliedAt, JSON.stringify(history), id]
      );
      if (res.rows.length > 0) {
        updatedMsg = formatMessageRow(res.rows[0]);
      }
    } catch (err) {
      console.error('Erro updateMessageReply Postgres:', err);
    }
  }

  const messages = readJson(MESSAGES_FILE, []);
  const index = messages.findIndex(m => m.id === id);
  if (index !== -1) {
    messages[index].reply = reply;
    messages[index].replyAudio = replyAudio || null;
    messages[index].replyImage = replyImage || null;
    messages[index].status = 'answered';
    messages[index].repliedAt = repliedAt;
    messages[index].history = history;
    writeJson(MESSAGES_FILE, messages);
    if (!updatedMsg) updatedMsg = messages[index];
  }
  return updatedMsg;
}

// Cliente envia réplica/resposta na conversa existente (chat contínuo)
async function addCustomerReply(id, text, audio = null, createdAt, image = null) {
  let existing = null;
  if (usePostgres) {
    try {
      const check = await pool.query('SELECT * FROM app_messages WHERE id = $1', [id]);
      if (check.rows.length > 0) existing = formatMessageRow(check.rows[0]);
    } catch (e) {}
  } else {
    const list = readJson(MESSAGES_FILE, []);
    existing = list.find(m => m.id === id);
  }

  if (!existing) return null;

  const history = [...(existing.history || [])];
  history.push({
    id: 'sub_' + crypto.randomUUID().slice(0, 8),
    sender: 'client',
    text: text || '',
    audio: audio || null,
    image: image || null,
    createdAt: createdAt
  });

  let updatedMsg = null;
  if (usePostgres) {
    try {
      const res = await pool.query(
        `UPDATE app_messages 
         SET question = $1, question_audio = $2, question_image = $3, status = 'pending', history = $4 
         WHERE id = $5 RETURNING *`,
        [text || existing.question, audio || existing.questionAudio, image || existing.questionImage, JSON.stringify(history), id]
      );
      if (res.rows.length > 0) {
        updatedMsg = formatMessageRow(res.rows[0]);
      }
    } catch (err) {
      console.error('Erro addCustomerReply Postgres:', err);
    }
  }

  const messages = readJson(MESSAGES_FILE, []);
  const index = messages.findIndex(m => m.id === id);
  if (index !== -1) {
    messages[index].question = text || messages[index].question;
    messages[index].questionAudio = audio || messages[index].questionAudio;
    messages[index].questionImage = image || messages[index].questionImage;
    messages[index].status = 'pending';
    messages[index].history = history;
    writeJson(MESSAGES_FILE, messages);
    if (!updatedMsg) updatedMsg = messages[index];
  }
  return updatedMsg;
}

async function deleteMessage(id) {
  if (usePostgres) {
    try {
      await pool.query('DELETE FROM app_messages WHERE id = $1', [id]);
    } catch (err) {
      console.error('Erro deleteMessage Postgres:', err);
    }
  }

  let messages = readJson(MESSAGES_FILE, []);
  messages = messages.filter(m => m.id !== id);
  writeJson(MESSAGES_FILE, messages);
}

// --- USUÁRIOS ---

async function getUserByUsername(username) {
  if (usePostgres) {
    try {
      const res = await pool.query('SELECT * FROM app_users WHERE LOWER(username) = LOWER($1)', [username]);
      if (res.rows.length > 0) {
        const r = res.rows[0];
        return {
          id: r.id,
          username: r.username,
          password: r.password,
          createdAt: r.created_at
        };
      }
      return null;
    } catch (err) {
      console.error('Erro getUserByUsername Postgres:', err);
    }
  }

  const users = readJson(USERS_FILE, []);
  return users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null;
}

async function createUser(user) {
  if (usePostgres) {
    try {
      await pool.query(
        'INSERT INTO app_users (id, username, password, created_at) VALUES ($1, $2, $3, $4)',
        [user.id, user.username, user.password, user.createdAt]
      );
    } catch (err) {
      console.error('Erro createUser Postgres:', err);
    }
  }

  const users = readJson(USERS_FILE, []);
  users.push(user);
  writeJson(USERS_FILE, users);
}

// --- INSCRIÇÕES PUSH ---

async function getAllSubscriptions() {
  if (usePostgres) {
    try {
      const res = await pool.query('SELECT * FROM app_subscriptions');
      const grouped = {};
      for (const r of res.rows) {
        const uid = r.user_id || 'anonymous';
        if (!grouped[uid]) grouped[uid] = [];
        grouped[uid].push(r.subscription);
      }
      return grouped;
    } catch (err) {
      console.error('Erro getAllSubscriptions Postgres:', err);
    }
  }

  return readJson(SUBSCRIPTIONS_FILE, {});
}

async function saveSubscription(userId, subscription) {
  if (!subscription || !subscription.endpoint) return;

  const effectiveUserId = userId || 'anonymous';

  if (usePostgres) {
    try {
      await pool.query(
        `INSERT INTO app_subscriptions (endpoint, user_id, subscription, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, subscription = $3`,
        [subscription.endpoint, effectiveUserId, JSON.stringify(subscription)]
      );
    } catch (err) {
      console.error('Erro saveSubscription Postgres:', err);
    }
  }

  const subscriptions = readJson(SUBSCRIPTIONS_FILE, {});
  if (!subscriptions[effectiveUserId]) {
    subscriptions[effectiveUserId] = [];
  }
  for (const k in subscriptions) {
    if (k !== effectiveUserId) {
      subscriptions[k] = subscriptions[k].filter(s => s.endpoint !== subscription.endpoint);
    }
  }
  const exists = subscriptions[effectiveUserId].some(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    subscriptions[effectiveUserId].push(subscription);
    writeJson(SUBSCRIPTIONS_FILE, subscriptions);
  }
}

async function removeSubscription(endpoint) {
  if (usePostgres) {
    try {
      await pool.query('DELETE FROM app_subscriptions WHERE endpoint = $1', [endpoint]);
    } catch (err) {
      console.error('Erro removeSubscription Postgres:', err);
    }
  }

  const subscriptions = readJson(SUBSCRIPTIONS_FILE, {});
  for (const k in subscriptions) {
    subscriptions[k] = (subscriptions[k] || []).filter(s => s.endpoint !== endpoint);
  }
  writeJson(SUBSCRIPTIONS_FILE, subscriptions);
}

function isUsingPostgres() {
  return usePostgres;
}

function getSettings() {
  return cachedSettings;
}

async function saveSettings(newSettings) {
  cachedSettings = { ...cachedSettings, ...newSettings };
  writeJson(SETTINGS_FILE, cachedSettings);
  if (usePostgres) {
    try {
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('global', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [JSON.stringify(cachedSettings)]
      );
    } catch (err) {
      console.error('Erro saveSettings Postgres:', err);
    }
  }
  return cachedSettings;
}

module.exports = {
  initDatabase,
  getMessages,
  addMessage,
  updateMessageReply,
  addCustomerReply,
  deleteMessage,
  getUserByUsername,
  createUser,
  getAllSubscriptions,
  saveSubscription,
  removeSubscription,
  isUsingPostgres,
  getSettings,
  saveSettings,
  readJson,
  writeJson
};
