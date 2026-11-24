// Sistema de Autenticação Simples (Nome + Senha) e Mensagens com Notificação Web
let socket = null;
let currentUser = null;
let pendingProductToAsk = null;
let userMessages = [];
let clientVoiceRecorder = null;
let clientRecordedAudio = null;

// Inicialização do Gravador de Áudio do Cliente
function initClientAudioRecorder() {
  clientRecordedAudio = null;
  clientVoiceRecorder = new AudioVoiceRecorder({
    onStateChange: (state, seconds) => {
      renderClientRecorderUI(state, seconds);
    },
    onReady: (base64Audio, seconds) => {
      clientRecordedAudio = base64Audio;
      renderClientRecorderUI('ready', seconds);
    },
    onCancel: () => {
      clientRecordedAudio = null;
      renderClientRecorderUI('idle', 0);
    }
  });
  renderClientRecorderUI('idle', 0);
}

function renderClientRecorderUI(state, seconds = 0) {
  const container = document.getElementById('client-audio-record-zone');
  if (!container) return;

  if (state === 'idle') {
    container.innerHTML = `
      <div class="audio-record-btn-row">
        <button type="button" class="btn-record-mic" onclick="startClientAudioRecording()">
          🎙️ Gravar Dúvida em Áudio
        </button>
      </div>
    `;
  } else if (state === 'recording') {
    container.innerHTML = `
      <div class="recording-active-bar">
        <div class="recording-indicator"></div>
        <span class="recording-timer">${formatAudioSeconds(seconds)}</span>
        <button type="button" class="btn-record-stop" onclick="stopClientAudioRecording()">⏹️ Concluir</button>
        <button type="button" class="btn-record-cancel" onclick="cancelClientAudioRecording()">✕ Cancelar</button>
      </div>
    `;
  } else if (state === 'ready' && clientRecordedAudio) {
    container.innerHTML = `
      <div class="audio-preview-box">
        <span style="font-size: 0.82rem; font-weight: 700; color: #059669; white-space: nowrap;">✅ Áudio gravado!</span>
        <div style="flex: 1; min-width: 0;">
          ${renderAudioPlayer(clientRecordedAudio, 'client_preview_player', 'Prévia da sua dúvida')}
        </div>
        <button type="button" class="btn-discard-audio" onclick="discardClientAudioRecording()" title="Descartar áudio">
          🗑️ Descartar
        </button>
      </div>
    `;
  }
}

function startClientAudioRecording() {
  if (!clientVoiceRecorder) initClientAudioRecorder();
  clientVoiceRecorder.start();
}

function stopClientAudioRecording() {
  if (clientVoiceRecorder) clientVoiceRecorder.stop();
}

function cancelClientAudioRecording() {
  if (clientVoiceRecorder) clientVoiceRecorder.cancel();
}

function discardClientAudioRecording() {
  clientRecordedAudio = null;
  if (clientVoiceRecorder) clientVoiceRecorder.cancel();
}

// Carrega usuário salvo do localStorage
try {
  const saved = localStorage.getItem('ml_simple_user');
  if (saved) currentUser = JSON.parse(saved);
} catch (e) {}

document.addEventListener('DOMContentLoaded', () => {
  renderHeaderUserArea();
  initUserSocket();
  registerServiceWorker();

  // Se já tiver permissão concedida, sincroniza na hora (mesmo deslogado)
  if ('Notification' in window && Notification.permission === 'granted') {
    subscribeUserToPush();
  } else if ('Notification' in window && Notification.permission === 'default') {
    // Se ainda não escolheu, convida após 1.5s
    setTimeout(() => {
      openPushPromptModal();
    }, 1500);
  }

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

  // Recebe notificação quando há resposta
  socket.on('user:message_answered', (msg) => {
    playNotificationSound();
    loadUserMessages();

    // 1. Notificação Web Nativa do Navegador
    triggerBrowserWebNotification(msg);

    // 2. Notificação visual Toast no site
    showToast('🔥 Temos uma promoção para você! Veja em Minhas Mensagens.');
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
  initClientAudioRecorder();
  setTimeout(() => document.getElementById('client-question').focus(), 100);
}

function closeAskModal() {
  document.getElementById('ask-modal-overlay').style.display = 'none';
  document.getElementById('client-question').value = '';
  discardClientAudioRecording();
}

async function submitProductQuestion(e) {
  e.preventDefault();
  if (!currentUser) {
    openAuthModal();
    return;
  }

  const question = document.getElementById('client-question').value.trim();
  const phone = document.getElementById('client-phone') ? document.getElementById('client-phone').value.trim() : '';
  const prodId = document.getElementById('ask-prod-id').value;
  const prodTitle = document.getElementById('ask-prod-title').value;
  const prodImg = document.getElementById('ask-prod-image').value;
  const prodLink = document.getElementById('ask-prod-link').value;

  if (!question && !clientRecordedAudio) {
    showToast('Digite sua dúvida ou grave um áudio para enviar.');
    return;
  }

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
        phone,
        question: question || '🎤 [Dúvida em Áudio]',
        questionAudio: clientRecordedAudio || null
      })
    });

    if (res.ok) {
      closeAskModal();
      showToast('✅ Dúvida enviada com sucesso!');

      // Se ainda não ativou notificações e o navegador suporta, convida para ativar
      if (('Notification' in window && Notification.permission === 'default') || isIOSDevice()) {
        setTimeout(() => openPushPromptModal(), 350);
      } else {
        openMessagesCenter();
        loadUserMessages();
      }
    } else {
      showToast('Erro ao enviar pergunta.');
    }
  } catch (err) {
    showToast('Erro de conexão ao enviar.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar Dúvida sobre a Oferta 🚀';
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

  const pushBanner = getPushStatusBanner();

  if (!userMessages || userMessages.length === 0) {
    container.innerHTML = `
      ${pushBanner}
      <div class="empty-drawer">
        <p>Você ainda não enviou nenhuma dúvida.</p>
        <small>Clique em "Tirar Dúvida" em qualquer oferta para perguntar ao vendedor!</small>
      </div>
    `;
    return;
  }

  container.innerHTML = pushBanner + userMessages.map(m => {
    const isAnswered = m.status === 'answered' && m.reply;
    const statusBadge = isAnswered
      ? `<span class="ticket-status-replied">🟢 Respondido</span>`
      : `<span class="ticket-status-pending">🟡 Em análise</span>`;

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
            ${m.question && m.question !== '🎤 [Dúvida em Áudio]' ? `<div class="bubble-text">${escapeHtml(m.question)}</div>` : ''}
            ${m.questionAudio ? renderAudioPlayer(m.questionAudio, 'q_voice_' + m.id, 'Sua dúvida em áudio') : ''}
            <span class="bubble-time">${qTime}</span>
          </div>

          ${isAnswered ? `
            <div class="ticket-bubble bubble-admin">
              <div class="bubble-sender">Equipe Sua Promo</div>
              ${m.reply && m.reply !== '🎤 [Resposta em Áudio]' ? `<div class="bubble-text">${escapeHtml(m.reply)}</div>` : ''}
              ${m.replyAudio ? renderAudioPlayer(m.replyAudio, 'r_voice_' + m.id, 'Resposta em áudio do vendedor') : ''}
              <span class="bubble-time">${rTime}</span>
            </div>
          ` : `
            <div class="pending-notice">
              Nossa equipe responderá em breve. Você pode fechar o site e ver os detalhes quando logar novamente!
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

// --- WEB PUSH COM SERVICE WORKER (FUNCIONA MESMO COM PÁGINA/CELULAR FECHADOS) ---
let swRegistration = null;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js');
    swRegistration = reg;
    return reg;
  } catch (err) {
    console.warn('Falha ao registrar Service Worker:', err);
    return null;
  }
}

function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function openPushPromptModal() {
  const modal = document.getElementById('push-prompt-modal');
  if (!modal) return;
  const iosBox = document.getElementById('ios-instruction-box');
  const btn = document.getElementById('btn-activate-push');

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  if (isIOSDevice() && !isStandalone) {
    if (iosBox) iosBox.style.display = 'block';
    if (btn) btn.textContent = '📲 Entendi como adicionar ao iPhone';
  } else {
    if (iosBox) iosBox.style.display = 'none';
    if (btn) btn.textContent = '🔔 Sim, Ativar Notificações no Celular';
  }

  modal.style.display = 'flex';
}

function closePushPromptModal() {
  const modal = document.getElementById('push-prompt-modal');
  if (modal) modal.style.display = 'none';
  if (currentUser) {
    loadUserMessages();
  }
}

function triggerNotificationPrompt() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isIOSDevice() && !isStandalone) {
    closePushPromptModal();
    return;
  }
  closePushPromptModal();
  requestWebNotificationPermission();
}

async function subscribeUserToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg) return;

    const res = await fetch('/api/push-public-key');
    const { publicKey } = await res.json();
    if (!publicKey) return;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }

    const saveRes = await fetch('/api/user/push-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser ? currentUser.id : 'anonymous',
        subscription: sub
      })
    });
    if (saveRes.ok) {
      console.log('✅ Inscrição Web Push salva no servidor com sucesso para:', currentUser ? currentUser.username : 'visitante');
    }
  } catch (err) {
    console.warn('Erro ao registrar inscrição WebPush:', err);
  }
}

async function requestWebNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('Seu navegador não suporta notificações web.');
    return;
  }

  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      await subscribeUserToPush();
      showToast('🔔 Notificações ativadas! Você será avisado no celular/computador.');
      renderUserMessagesList();
    } else {
      showToast('Notificações não foram autorizadas.');
      renderUserMessagesList();
    }
  } catch (err) {
    console.warn('Erro ao solicitar permissão de notificação:', err);
  }
}

function getPushStatusBanner() {
  if (!('Notification' in window)) return '';

  if (Notification.permission === 'granted') {
    return `
      <div class="push-permission-card active">
        <span>🔔 <strong>Notificações no celular ativas:</strong> Você será notificado mesmo se fechar este site!</span>
      </div>
    `;
  } else if (Notification.permission === 'default') {
    return `
      <div class="push-permission-card prompt">
        <div>
          <strong>🔔 Receber resposta no celular?</strong>
          <div>Ative para ser avisado mesmo com o site fechado.</div>
        </div>
        <button class="btn-enable-push" onclick="requestWebNotificationPermission()">Ativar Notificações</button>
      </div>
    `;
  } else {
    return `
      <div class="push-permission-card denied">
        <span>⚠️ Notificações desativadas. Para receber avisos com o site fechado, ative nas configurações do navegador.</span>
      </div>
    `;
  }
}

function triggerBrowserWebNotification(msg) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      if (swRegistration && swRegistration.showNotification) {
        swRegistration.showNotification('Sua Promo 🔥', {
          body: 'Temos uma promoção para você! Toque para conferir.',
          icon: '/icons/icon-192.png',
          data: { url: '/' }
        });
      } else {
        new Notification('Sua Promo 🔥', {
          body: 'Temos uma promoção para você! Toque para conferir.',
          icon: '/icons/icon-192.png'
        });
      }
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
