// Sistema de Autenticação Simples (Nome + Senha) e Mensagens com Notificação Web
let socket = null;
let currentUser = null;
let pendingProductToAsk = null;
let userMessages = [];

// Carrega usuário salvo do localStorage
try {
  const saved = localStorage.getItem('ml_simple_user');
  if (saved) currentUser = JSON.parse(saved);
} catch (e) {}

document.addEventListener('DOMContentLoaded', () => {
  renderHeaderUserArea();
  initUserSocket();
  if (currentUser) {
    loadUserMessages();
  }
});

// Inicialização do Socket para Notificação Web em tempo real
function initUserSocket() {
  if (typeof io === 'undefined') return;
  socket = io();

  socket.on('connect', () => {
    if (currentUser) {
      socket.emit('user:join', { userId: currentUser.id });
    }
  });

  // Recebe notificação quando o vendedor responde
  socket.on('user:message_answered', (msg) => {
    playNotificationSound();
    loadUserMessages();

    // 1. Notificação Web Nativa do Navegador
    triggerBrowserWebNotification(msg);

    // 2. Notificação visual Toast no site
    showToast(`🔔 O vendedor respondeu sua dúvida sobre "${msg.productTitle || 'Produto'}"!`);
  });
}

// Renderiza área do usuário no topo da página
function renderHeaderUserArea() {
  const area = document.getElementById('header-user-area');
  if (!area) return;

  if (currentUser) {
    area.innerHTML = `
      <div class="user-logged-box">
        <span class="user-greeting">👤 Olá, <strong>${escapeHtml(currentUser.username)}</strong></span>
        <button class="header-chat-btn" onclick="openMessagesCenter()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
            <polyline points="22,6 12,13 2,6"></polyline>
          </svg>
          <span>Minhas Mensagens</span>
          <span class="header-badge" id="header-unread-badge" style="display: none;">0</span>
        </button>
        <button class="btn-logout" onclick="logoutUser()" title="Sair da conta">Sair</button>
      </div>
    `;
  } else {
    area.innerHTML = `
      <button class="btn-auth-trigger" onclick="openAuthModal()">
        🔐 Entrar / Cadastrar
      </button>
    `;
  }
}

// Modal de Login / Cadastro Simples (Nome + Senha)
function openAuthModal() {
  document.getElementById('auth-modal').style.display = 'flex';
  document.getElementById('auth-error-msg').style.display = 'none';
  setTimeout(() => document.getElementById('auth-username').focus(), 100);
}

function closeAuthModal() {
  document.getElementById('auth-modal').style.display = 'none';
  document.getElementById('auth-form').reset();
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value.trim();
  const errorEl = document.getElementById('auth-error-msg');
  const submitBtn = document.getElementById('auth-submit-btn');

  if (!username || !password) return;

  errorEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Verificando...';

  try {
    const res = await fetch('/api/auth/login-or-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      currentUser = data.user;
      localStorage.setItem('ml_simple_user', JSON.stringify(currentUser));
      closeAuthModal();
      renderHeaderUserArea();

      // Solicita permissão para Notificação Web do navegador
      requestWebNotificationPermission();

      if (socket) {
        socket.emit('user:join', { userId: currentUser.id });
      }

      loadUserMessages();
      showToast(data.action === 'registered' ? `Conta criada! Bem-vindo, ${currentUser.username}!` : `Bem-vindo de volta, ${currentUser.username}!`);

      // Se havia um produto pendente para perguntar, abre a pergunta agora
      if (pendingProductToAsk) {
        const p = pendingProductToAsk;
        pendingProductToAsk = null;
        openAskModal(p.id, p.title, p.price, p.img, p.link);
      }
    } else {
      errorEl.textContent = data.error || 'Erro ao entrar. Tente novamente.';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = 'Erro de conexão com o servidor.';
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Entrar / Criar Conta ➜';
  }
}

function logoutUser() {
  currentUser = null;
  localStorage.removeItem('ml_simple_user');
  renderHeaderUserArea();
  userMessages = [];
  closeMessagesCenter();
  showToast('Você saiu da sua conta.');
}

// Modal de Envio de Dúvida
function openAskModal(prodId, prodTitle, prodPrice, prodImg, prodLink) {
  // Se não estiver logado, pede nome e senha primeiro
  if (!currentUser) {
    pendingProductToAsk = { id: prodId, title: prodTitle, price: prodPrice, img: prodImg, link: prodLink };
    openAuthModal();
    return;
  }

  document.getElementById('ask-prod-id').value = prodId;
  document.getElementById('ask-prod-title').value = decodeURIComponent(prodTitle);
  document.getElementById('ask-prod-image').value = prodImg;
  document.getElementById('ask-prod-link').value = prodLink;

  document.getElementById('modal-prod-title').textContent = decodeURIComponent(prodTitle);
  document.getElementById('modal-prod-price').textContent = decodeURIComponent(prodPrice);
  document.getElementById('modal-prod-img').src = prodImg;
  document.getElementById('logged-user-display').textContent = currentUser.username;

  document.getElementById('ask-modal-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('client-question').focus(), 100);
}

function closeAskModal() {
  document.getElementById('ask-modal-overlay').style.display = 'none';
  document.getElementById('client-question').value = '';
}

async function submitProductQuestion(e) {
  e.preventDefault();
  if (!currentUser) {
    openAuthModal();
    return;
  }

  const question = document.getElementById('client-question').value.trim();
  const prodId = document.getElementById('ask-prod-id').value;
  const prodTitle = document.getElementById('ask-prod-title').value;
  const prodImg = document.getElementById('ask-prod-image').value;
  const prodLink = document.getElementById('ask-prod-link').value;

  if (!question) return;

  const btn = document.getElementById('btn-submit-question');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const res = await fetch('/api/user/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        username: currentUser.username,
        productId: prodId,
        productTitle: prodTitle,
        productImage: prodImg,
        productLink: prodLink,
        question
      })
    });

    if (res.ok) {
      closeAskModal();
      showToast('✅ Pergunta enviada ao vendedor! Acompanhe em "Minhas Mensagens".');
      openMessagesCenter();
      loadUserMessages();
    } else {
      showToast('Erro ao enviar pergunta.');
    }
  } catch (err) {
    showToast('Erro de conexão ao enviar.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar Pergunta ao Vendedor 🚀';
  }
}

// Carrega as mensagens do usuário logado
async function loadUserMessages() {
  if (!currentUser) return;

  try {
    const res = await fetch(`/api/user/messages?userId=${currentUser.id}`);
    userMessages = await res.json();
    renderUserMessagesList();
    updateUnreadBadge();
  } catch (err) {
    console.error('Erro ao carregar mensagens:', err);
  }
}

// Renderiza a lista de mensagens na gaveta
function renderUserMessagesList() {
  const container = document.getElementById('drawer-tickets-list');
  const userInfo = document.getElementById('drawer-user-info');

  if (userInfo && currentUser) {
    userInfo.textContent = `Conta: ${currentUser.username}`;
  }

  if (!userMessages || userMessages.length === 0) {
    container.innerHTML = `
      <div class="empty-drawer">
        <p>Você ainda não enviou nenhuma dúvida.</p>
        <small>Clique em "Tirar Dúvida" em qualquer oferta para perguntar ao vendedor!</small>
      </div>
    `;
    return;
  }

  container.innerHTML = userMessages.map(m => {
    const isAnswered = m.status === 'answered' && m.reply;
    const statusBadge = isAnswered
      ? `<span class="ticket-status-replied">🟢 Respondido pelo vendedor</span>`
      : `<span class="ticket-status-pending">🟡 Aguardando resposta</span>`;

    const qTime = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const rTime = m.repliedAt ? new Date(m.repliedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    return `
      <div class="client-ticket-card">
        <div class="ticket-card-header">
          <div class="ticket-prod-info">
            ${m.productImage ? `<img src="${m.productImage}" class="ticket-prod-thumb" alt="Produto">` : ''}
            <div>
              <h5 class="ticket-prod-title">${escapeHtml(m.productTitle || 'Oferta Mercado Livre')}</h5>
              ${statusBadge}
            </div>
          </div>
          ${m.productLink ? `<a href="${m.productLink}" target="_blank" class="ticket-view-link">Ver Oferta ↗</a>` : ''}
        </div>

        <div class="ticket-messages-thread">
          <div class="ticket-bubble bubble-client">
            <div class="bubble-sender">Você (${escapeHtml(currentUser.username)})</div>
            <div class="bubble-text">${escapeHtml(m.question)}</div>
            <span class="bubble-time">${qTime}</span>
          </div>

          ${isAnswered ? `
            <div class="ticket-bubble bubble-admin">
              <div class="bubble-sender">Vendedor (Atendimento)</div>
              <div class="bubble-text">${escapeHtml(m.reply)}</div>
              <span class="bubble-time">${rTime}</span>
            </div>
          ` : `
            <div class="pending-notice">
              O vendedor responderá em breve. Você pode fechar o site e ver a resposta quando logar novamente!
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function updateUnreadBadge() {
  const answeredCount = userMessages.filter(m => m.status === 'answered').length;
  const headerBadge = document.getElementById('header-unread-badge');
  const floatingBadge = document.getElementById('floating-unread-badge');

  if (answeredCount > 0) {
    if (headerBadge) {
      headerBadge.textContent = answeredCount;
      headerBadge.style.display = 'inline-block';
    }
    if (floatingBadge) {
      floatingBadge.textContent = answeredCount;
      floatingBadge.style.display = 'inline-block';
    }
  } else {
    if (headerBadge) headerBadge.style.display = 'none';
    if (floatingBadge) floatingBadge.style.display = 'none';
  }
}

// Abrir / Fechar Gaveta de Mensagens
function openMessagesCenter() {
  if (!currentUser) {
    openAuthModal();
    return;
  }
  document.getElementById('messages-drawer').classList.add('open');
  loadUserMessages();
}

function closeMessagesCenter() {
  document.getElementById('messages-drawer').classList.remove('open');
}

// --- NOTIFICAÇÃO WEB DO NAVEGADOR ---

function requestWebNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function triggerBrowserWebNotification(msg) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('💬 Resposta do Vendedor - Mercado Livre', {
        body: `${msg.productTitle ? msg.productTitle + ': ' : ''}${msg.reply}`,
        icon: msg.productImage || '/favicon.ico'
      });
    } catch (e) {}
  }
}

// Som suave
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {}
}

function showToast(text) {
  let toast = document.getElementById('client-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'client-toast';
    toast.className = 'client-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 4000);
}

function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}
