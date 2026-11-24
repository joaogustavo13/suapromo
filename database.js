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

      -- Garante novas colunas de áudio caso a tabela já exista
      ALTER TABLE app_messages ADD COLUMN IF NOT EXISTS question_audio TEXT;
      ALTER TABLE app_messages ADD COLUMN IF NOT EXISTS reply_audio TEXT;

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

    return true;
  } catch (err) {
    console.error('❌ Erro ao conectar ao PostgreSQL, mantendo fallback JSON:', err.message);
    usePostgres = false;
    return false;
  }
}

// --- MENSAGENS ---

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
      return res.rows.map(r => ({
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
        reply: r.reply,
        replyAudio: r.reply_audio || null,
        status: r.status,
        createdAt: r.created_at,
        repliedAt: r.replied_at
      }));
    } catch (err) {
      console.error('Erro getMessages Postgres:', err);
    }
  }

  // Fallback JSON
  const messages = readJson(MESSAGES_FILE, []);
  if (userId) {
    return messages.filter(m => m.userId === userId);
  }
  return messages;
}

async function addMessage(msg) {
  if (usePostgres) {
    try {
      await pool.query(
        `INSERT INTO app_messages (id, user_id, username, phone, product_id, product_title, product_image, product_link, question, question_audio, reply, reply_audio, status, created_at, replied_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
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
          msg.reply || null,
          msg.replyAudio || null,
          msg.status || 'pending',
          msg.createdAt,
          msg.repliedAt || null
        ]
      );
    } catch (err) {
      console.error('Erro addMessage Postgres:', err);
    }
  }

  // Mantém arquivo JSON atualizado também
  const messages = readJson(MESSAGES_FILE, []);
  messages.unshift(msg);
  writeJson(MESSAGES_FILE, messages);
}

async function updateMessageReply(id, reply, repliedAt, replyAudio = null) {
  let updatedMsg = null;
  if (usePostgres) {
    try {
      const res = await pool.query(
        `UPDATE app_messages SET reply = $1, reply_audio = $2, status = 'answered', replied_at = $3 WHERE id = $4 RETURNING *`,
        [reply, replyAudio, repliedAt, id]
      );
      if (res.rows.length > 0) {
        const r = res.rows[0];
        updatedMsg = {
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
          reply: r.reply,
          replyAudio: r.reply_audio || null,
          status: r.status,
          createdAt: r.created_at,
          repliedAt: r.replied_at
        };
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
    messages[index].status = 'answered';
    messages[index].repliedAt = repliedAt;
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
