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

let clientSelectedImage = null;

function initClientPhotoPicker() {
  clientSelectedImage = null;
  renderAskPhotoUI();
}

function renderAskPhotoUI() {
  const container = document.getElementById('client-photo-record-zone');
  if (!container) return;

  if (!clientSelectedImage) {
    container.innerHTML = `
      <div class="audio-record-btn-row">
        <button type="button" class="btn-record-mic" style="color: #3b82f6; border-color: #3b82f6; background: rgba(59, 130, 246, 0.08);" onclick="triggerAskPhoto()">
          📷 Anexar Foto
        </button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="photo-preview-box">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          <img src="${clientSelectedImage}" class="photo-preview-thumb" alt="Foto">
          <span style="font-size: 0.82rem; font-weight: 700; color: #2563eb;">✅ Foto anexada!</span>
        </div>
        <button type="button" class="btn-discard-audio" onclick="discardAskPhoto()" title="Remover foto">🗑️ Remover</button>
      </div>
    `;
  }
}

function triggerAskPhoto() {
  const input = document.getElementById('ask-photo-input');
  if (input) input.click();
}

async function handleAskPhotoSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    clientSelectedImage = await compressImageFileToBase64(file);
    renderAskPhotoUI();
  } catch (err) {
    showToast('Não foi possível carregar a foto.');
  } finally {
    e.target.value = '';
  }
}

function discardAskPhoto() {
  clientSelectedImage = null;
  renderAskPhotoUI();
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
  initClientPhotoPicker();
  setTimeout(() => document.getElementById('client-question').focus(), 100);
}

function closeAskModal() {
  document.getElementById('ask-modal-overlay').style.display = 'none';
  document.getElementById('client-question').value = '';
  discardClientAudioRecording();
  discardAskPhoto();
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

  if (!question && !clientRecordedAudio && !clientSelectedImage) {
    showToast('Digite sua dúvida, grave um áudio ou anexe uma foto.');
    return;
  }

  const btn = document.getElementById('btn-submit-question');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const fallbackLabel = clientSelectedImage && !clientRecordedAudio ? '📷 [Foto Enviada]' : '🎤 [Dúvida em Áudio]';
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
        question: question || fallbackLabel,
        questionAudio: clientRecordedAudio || null,
        questionImage: clientSelectedImage || null
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

// --- GRAVADOR E CHAT UNIFICADO DO CLIENTE (ESTILO WHATSAPP MOBILE) ---
let drawerVoiceRecorder = null;
let drawerRecordedAudio = null;

function scrollDrawerToBottom() {
  const container = document.getElementById('drawer-tickets-list');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

function toggleDrawerMic() {
  if (drawerVoiceRecorder && drawerVoiceRecorder.mediaRecorder && drawerVoiceRecorder.mediaRecorder.state === 'recording') {
    drawerVoiceRecorder.stop();
    return;
  }

  if (drawerVoiceRecorder) {
    drawerVoiceRecorder.cancel();
  }

  drawerVoiceRecorder = new AudioVoiceRecorder({
    onStateChange: (state, seconds) => {
      renderDrawerRecorderUI(state, seconds);
    },
    onReady: (base64Audio, seconds) => {
      drawerRecordedAudio = base64Audio;
      renderDrawerRecorderUI('ready', seconds);
    },
    onCancel: () => {
      drawerRecordedAudio = null;
      renderDrawerRecorderUI('idle', 0);
    }
  });

  drawerVoiceRecorder.start();
}

function renderDrawerRecorderUI(state, seconds = 0) {
  const container = document.getElementById('drawer-audio-zone');
  const micBtn = document.getElementById('btn-drawer-mic');
  if (!container) return;

  if (state === 'idle') {
    container.innerHTML = '';
    if (micBtn) {
      micBtn.textContent = '🎙️';
      micBtn.style.background = 'rgba(255, 71, 87, 0.12)';
      micBtn.style.color = '#ff4757';
    }
  } else if (state === 'recording') {
    if (micBtn) {
      micBtn.textContent = '⏹️';
      micBtn.style.background = '#ef4444';
      micBtn.style.color = '#fff';
    }
    container.innerHTML = `
      <div class="recording-active-bar" style="width: 100%; justify-content: space-between; box-sizing: border-box;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="recording-indicator"></div>
          <span class="recording-timer">${formatAudioSeconds(seconds)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button type="button" class="btn-record-stop" onclick="stopDrawerAudioRecording()">⏹️ Parar</button>
          <button type="button" class="btn-record-cancel" onclick="cancelDrawerAudioRecording()">✕</button>
        </div>
      </div>
    `;
    scrollDrawerToBottom();
  } else if (state === 'ready' && drawerRecordedAudio) {
    if (micBtn) {
      micBtn.textContent = '🎙️';
      micBtn.style.background = 'rgba(255, 71, 87, 0.12)';
      micBtn.style.color = '#ff4757';
    }
    container.innerHTML = `
      <div class="audio-preview-box" style="width: 100%; box-sizing: border-box;">
        <div style="flex: 1; min-width: 0;">
          ${renderAudioPlayer(drawerRecordedAudio, 'drawer_preview_player', 'Áudio')}
        </div>
        <button type="button" class="btn-discard-audio" onclick="discardDrawerAudioRecording()" title="Descartar áudio" style="flex-shrink: 0; font-size: 1.05rem;">
          🗑️
        </button>
      </div>
    `;
    scrollDrawerToBottom();
  }
}

function stopDrawerAudioRecording() {
  if (drawerVoiceRecorder) drawerVoiceRecorder.stop();
}

function cancelDrawerAudioRecording() {
  if (drawerVoiceRecorder) drawerVoiceRecorder.cancel();
}

function discardDrawerAudioRecording() {
  drawerRecordedAudio = null;
  if (drawerVoiceRecorder) drawerVoiceRecorder.cancel();
  renderDrawerRecorderUI('idle', 0);
}

let drawerSelectedImage = null;

function triggerDrawerPhoto() {
  const input = document.getElementById('drawer-photo-input');
  if (input) input.click();
}

async function handleDrawerPhotoSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    drawerSelectedImage = await compressImageFileToBase64(file);
    renderDrawerPhotoUI();
    scrollDrawerToBottom();
  } catch (err) {
    showToast('Não foi possível carregar a foto.');
  } finally {
    e.target.value = '';
  }
}

function discardDrawerPhoto() {
  drawerSelectedImage = null;
  renderDrawerPhotoUI();
}

function renderDrawerPhotoUI() {
  const container = document.getElementById('drawer-photo-zone');
  if (!container) return;
  if (!drawerSelectedImage) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="photo-preview-box">
      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
        <img src="${drawerSelectedImage}" class="photo-preview-thumb" alt="Foto">
        <span style="font-size: 0.8rem; font-weight: 700; color: #2563eb;">📷 Foto pronta para envio</span>
      </div>
      <button type="button" class="btn-discard-audio" onclick="discardDrawerPhoto()" title="Descartar foto">🗑️</button>
    </div>
  `;
}

async function submitUnifiedCustomerReply(e) {
  if (e) e.preventDefault();
  if (!currentUser) {
    openAuthModal();
    return;
  }

  const input = document.getElementById('drawer-reply-input');
  const text = input ? input.value.trim() : '';
  const audio = drawerRecordedAudio || null;
  const image = drawerSelectedImage || null;

  if (!text && !audio && !image) {
    showToast('Digite uma mensagem, grave um áudio ou envie uma foto.');
    return;
  }

  const btn = document.getElementById('btn-drawer-send');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '...';
  }

  try {
    const primaryChat = (userMessages && userMessages.length > 0) ? userMessages[0] : null;
    const fallbackLabel = image && !audio ? '📷 [Foto Enviada]' : '🎤 [Dúvida em Áudio]';
    let res;

    if (primaryChat) {
      res = await fetch(`/api/user/reply/${primaryChat.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          reply: text,
          replyAudio: audio,
          replyImage: image
        })
      });
    } else {
      // Caso nunca tenha enviado dúvida antes, cria o chat unificado direto!
      res = await fetch('/api/user/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          username: currentUser.username,
          question: text || fallbackLabel,
          questionAudio: audio,
          questionImage: image
        })
      });
    }

    if (res.ok) {
      if (input) input.value = '';
      discardDrawerAudioRecording();
      discardDrawerPhoto();
      showToast('✅ Mensagem enviada!');
      await loadUserMessages();
      scrollDrawerToBottom();
    } else {
      showToast('Erro ao enviar mensagem.');
    }
  } catch (err) {
    showToast('Erro de conexão ao enviar.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Enviar';
    }
  }
}

// Renderiza TODAS as mensagens do cliente em 1 único chat contínuo estilo WhatsApp
function renderUserMessagesList() {
  const container = document.getElementById('drawer-tickets-list');
  const userInfo = document.getElementById('drawer-user-info');
  const composer = document.getElementById('drawer-composer');

  if (userInfo && currentUser) {
    userInfo.textContent = `Conta: ${currentUser.username}`;
  }

  if (composer) {
    composer.style.display = currentUser ? 'flex' : 'none';
  }

  const pushBanner = getPushStatusBanner();

  if (!userMessages || userMessages.length === 0) {
    container.innerHTML = `
      ${pushBanner}
      <div class="empty-drawer">
        <p>Sua conversa com a equipe <strong>Sua Promo</strong> está aberta!</p>
        <small>Escreva, grave um áudio ou envie uma foto abaixo, ou clique em "Tirar Dúvida" em qualquer oferta.</small>
      </div>
    `;
    return;
  }

  // Agrupa todo o histórico de todos os itens (retrocompatibilidade total) em uma única timeline
  let unifiedHistory = [];
  userMessages.forEach(m => {
    const hist = Array.isArray(m.history) && m.history.length > 0 ? m.history : [
      {
        id: 'msg_q_' + m.id,
        sender: 'client',
        text: m.question,
        audio: m.questionAudio,
        image: m.questionImage,
        productId: m.productId,
        productTitle: m.productTitle,
        productImage: m.productImage,
        productLink: m.productLink,
        createdAt: m.createdAt
      },
      ...(m.reply || m.replyAudio || m.replyImage ? [{
        id: 'msg_r_' + m.id,
        sender: 'admin',
        text: m.reply,
        audio: m.replyAudio,
        image: m.replyImage,
        createdAt: m.repliedAt
      }] : [])
    ];
    unifiedHistory.push(...hist);
  });

  unifiedHistory.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

  const threadHtml = unifiedHistory.map(entry => {
    const time = entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    const productTagHtml = entry.productTitle ? `
      <a href="${entry.productLink || '#'}" target="_blank" class="bubble-prod-ref">
        ${entry.productImage ? `<img src="${entry.productImage}" alt="">` : ''}
        <div class="bubble-prod-ref-info">
          <span class="bubble-prod-ref-title">${escapeHtml(entry.productTitle)}</span>
          <span class="bubble-prod-ref-link">Ver oferta ↗</span>
        </div>
      </a>
    ` : '';

    if (entry.sender === 'client') {
      const hasText = entry.text && entry.text !== '🎤 [Dúvida em Áudio]' && entry.text !== '🎤 [Áudio do Cliente]' && entry.text !== '🎤 [Dúvida/Áudio do Cliente]' && entry.text !== '📷 [Foto Enviada]';
      return `
        <div class="ticket-bubble bubble-client">
          ${productTagHtml}
          <div class="bubble-sender">Você</div>
          ${entry.image ? renderChatImage(entry.image) : ''}
          ${hasText ? `<div class="bubble-text">${escapeHtml(entry.text)}</div>` : ''}
          ${entry.audio ? renderAudioPlayer(entry.audio, 'c_voice_' + (entry.id || Math.random().toString(36).substring(2)), 'Áudio') : ''}
          <span class="bubble-time">${time}</span>
        </div>
      `;
    } else {
      const hasText = entry.text && entry.text !== '🎤 [Resposta em Áudio]' && entry.text !== '📷 [Foto Enviada]';
      return `
        <div class="ticket-bubble bubble-admin">
          <div class="bubble-sender">Equipe Sua Promo</div>
          ${entry.image ? renderChatImage(entry.image) : ''}
          ${hasText ? `<div class="bubble-text">${escapeHtml(entry.text)}</div>` : ''}
          ${entry.audio ? renderAudioPlayer(entry.audio, 'a_voice_' + (entry.id || Math.random().toString(36).substring(2)), 'Áudio') : ''}
          <span class="bubble-time">${time}</span>
        </div>
      `;
    }
  }).join('');

  container.innerHTML = `
    ${pushBanner}
    <div class="unified-chat-thread">
      ${threadHtml}
    </div>
  `;

  scrollDrawerToBottom();
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
      <div class="push-permission-card active" style="padding: 6px 10px; font-size: 0.75rem; margin-bottom: 4px;">
        <span>🔔 Notificações ativas no celular</span>
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
