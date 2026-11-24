// Painel do Administrador - Segurança & Autenticação
let socket = null;
let currentMsgId = null;
let messagesList = [];
let soundEnabled = true;
let allDeals = [];
let adminToken = localStorage.getItem('suapromo_admin_token');

document.addEventListener('DOMContentLoaded', () => {
  verifyAdminAuth();
  setupFilterInput();
});

// Verifica se a sessão do administrador é válida
async function verifyAdminAuth() {
  if (!adminToken) {
    showLockScreen();
    return;
  }

  try {
    const res = await fetch('/api/admin/verify', {
      headers: { 'x-admin-token': adminToken }
    });

    if (res.ok) {
      unlockDashboard();
    } else {
      showLockScreen();
    }
  } catch (err) {
    showLockScreen();
  }
}

function showLockScreen() {
  document.getElementById('admin-lock-screen').style.display = 'flex';
  document.getElementById('admin-app').style.display = 'none';
  setTimeout(() => {
    const input = document.getElementById('admin-pass-input');
    if (input) input.focus();
  }, 100);
}

function unlockDashboard() {
  document.getElementById('admin-lock-screen').style.display = 'none';
  document.getElementById('admin-app').style.display = 'flex';
  initAdminSocket();
  loadAdminMessages();
  loadDealsList();
  loadTelegramSettings();
}

// Login do Administrador
async function handleAdminLogin(e) {
  e.preventDefault();
  const input = document.getElementById('admin-pass-input');
  const errorEl = document.getElementById('admin-login-error');
  const btn = document.getElementById('btn-admin-login');
  const password = input.value.trim();

  if (!password) return;

  errorEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Verificando senha...';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      adminToken = data.token;
      localStorage.setItem('suapromo_admin_token', adminToken);
      input.value = '';
      unlockDashboard();
      showToast('Acesso concedido! Bem-vindo ao painel.');
    } else {
      errorEl.textContent = data.error || 'Senha incorreta. Acesso negado.';
      errorEl.style.display = 'block';
      input.select();
    }
  } catch (err) {
    errorEl.textContent = 'Erro de conexão ao autenticar.';
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar no Painel ➜';
  }
}

// Logout do Administrador
async function logoutAdmin() {
  if (adminToken) {
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        headers: { 'x-admin-token': adminToken }
      });
    } catch (e) {}
  }
  adminToken = null;
  localStorage.removeItem('suapromo_admin_token');
  showLockScreen();
  showToast('Painel bloqueado com sucesso.');
}

// Alterar senha do admin
async function handleChangePassword(e) {
  e.preventDefault();
  const newPass = document.getElementById('new-admin-pass').value.trim();
  const confirmPass = document.getElementById('confirm-admin-pass').value.trim();
  const msgEl = document.getElementById('pass-change-msg');

  if (newPass.length < 4) {
    msgEl.textContent = 'A senha deve ter pelo menos 4 caracteres.';
    msgEl.style.background = '#fef2f2';
    msgEl.style.color = '#b91c1c';
    msgEl.style.display = 'block';
    return;
  }

  if (newPass !== confirmPass) {
    msgEl.textContent = 'As senhas digitadas não coincidem.';
    msgEl.style.background = '#fef2f2';
    msgEl.style.color = '#b91c1c';
    msgEl.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/admin/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ newPassword: newPass })
    });

    const data = await res.json();
    if (res.ok) {
      msgEl.textContent = '✅ Senha alterada com sucesso! Guarde sua nova senha.';
      msgEl.style.background = '#ecfdf5';
      msgEl.style.color = '#047857';
      msgEl.style.display = 'block';
      document.getElementById('change-pass-form').reset();
      showToast('Nova senha de administrador salva!');
    } else {
      msgEl.textContent = data.error || 'Erro ao alterar senha.';
      msgEl.style.background = '#fef2f2';
      msgEl.style.color = '#b91c1c';
      msgEl.style.display = 'block';
    }
  } catch (err) {
    msgEl.textContent = 'Erro de conexão ao salvar.';
    msgEl.style.display = 'block';
  }
}

// Controle de Tabs
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });

  if (tabId === 'tab-robot') {
    loadDealsList();
  } else if (tabId === 'tab-bot') {
    loadTelegramSettings();
  }
}

// Socket.io do Admin
function initAdminSocket() {
  if (typeof io === 'undefined' || !adminToken) return;
  socket = io();

  socket.on('connect', () => {
    socket.emit('admin:join', { token: adminToken });
  });

  // Nova pergunta enviada por um cliente logado!
  socket.on('admin:new_question', (msg) => {
    if (soundEnabled) {
      playAlertSound();
    }
    showToast(`🔔 Nova pergunta de ${msg.username} sobre "${msg.productTitle || 'Oferta'}"!`);
    loadAdminMessages();
  });

  socket.on('admin:message_updated', (updated) => {
    loadAdminMessages();
    if (currentMsgId === updated.id) {
      renderActiveThread(updated);
    }
  });
}

// Carrega as perguntas dos clientes (com token)
async function loadAdminMessages() {
  if (!adminToken) return;

  try {
    const res = await fetch('/api/admin/messages', {
      headers: { 'x-admin-token': adminToken }
    });

    if (res.status === 401) {
      logoutAdmin();
      return;
    }

    messagesList = await res.json();
    renderAdminMessagesSidebar();
    updatePendingBadge();
  } catch (err) {
    console.error('Erro ao carregar mensagens:', err);
  }
}

function renderAdminMessagesSidebar() {
  const container = document.getElementById('admin-messages-list');
  const filterVal = document.getElementById('filter-messages-input')?.value.toLowerCase() || '';

  let filtered = messagesList.filter(m => {
    if (!filterVal) return true;
    return (m.username && m.username.toLowerCase().includes(filterVal)) ||
           (m.productTitle && m.productTitle.toLowerCase().includes(filterVal)) ||
           (m.question && m.question.toLowerCase().includes(filterVal));
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-chats">
        <p>Nenhuma dúvida pendente.</p>
        <small>Quando um cliente entrar com nome/senha e perguntar, ele aparecerá aqui!</small>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(m => {
    const isSelected = m.id === currentMsgId;
    const isPending = m.status === 'pending' || !m.reply;
    const timeStr = m.createdAt 
      ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      : '';

    return `
      <div class="conv-item ${isSelected ? 'active' : ''}" onclick="selectAdminMessage('${m.id}')">
        <div class="conv-avatar-wrap">
          <div class="conv-avatar">${(m.username || 'U').charAt(0).toUpperCase()}</div>
          <span class="conv-online-badge ${isPending ? '' : 'offline'}"></span>
        </div>
        <div class="conv-info">
          <div class="conv-top-line">
            <span class="conv-name">${escapeHtml(m.username)}</span>
            <span class="conv-time">${timeStr}</span>
          </div>
          <div class="conv-bottom-line">
            <span class="conv-last-msg">${escapeHtml(m.question)}</span>
            ${isPending ? `<span class="conv-unread">Pendente</span>` : ''}
          </div>
          ${m.productTitle ? `<small style="font-size:0.7rem; color:#64748b; display:block; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">🛍️ ${escapeHtml(m.productTitle)}</small>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function updatePendingBadge() {
  const pendingCount = messagesList.filter(m => m.status === 'pending' || !m.reply).length;
  const countEl = document.getElementById('pending-count');
  const badgeEl = document.getElementById('admin-pending-badge');

  if (countEl) countEl.textContent = `${pendingCount} pendentes`;
  if (badgeEl) {
    if (pendingCount > 0) {
      badgeEl.textContent = pendingCount;
      badgeEl.style.display = 'inline-block';
    } else {
      badgeEl.style.display = 'none';
    }
  }
}

function selectAdminMessage(msgId) {
  currentMsgId = msgId;
  const msg = messagesList.find(m => m.id === msgId);
  if (!msg) return;

  discardAdminRecording();

  // Mobile: abre a visão da conversa ocupando 100% da tela
  const dashboard = document.querySelector('.chat-dashboard');
  if (dashboard) dashboard.classList.add('mobile-chat-open');

  document.getElementById('no-message-selected').style.display = 'none';
  document.getElementById('active-message-container').style.display = 'flex';

  document.getElementById('active-user-name').textContent = msg.username;
  document.getElementById('active-user-initial').textContent = (msg.username || 'U').charAt(0).toUpperCase();

  const isPending = msg.status === 'pending' || !msg.reply;
  document.getElementById('active-msg-status').textContent = isPending ? '🟡 Aguardando sua resposta' : '🟢 Respondido';
  document.getElementById('active-msg-status').style.color = isPending ? '#d97706' : '#15803d';

  // Exibe WhatsApp se informado pelo cliente
  const waContainer = document.getElementById('active-user-whatsapp');
  if (waContainer) {
    if (msg.phone) {
      const cleanPhone = msg.phone.replace(/\D/g, '');
      const replyMsg = encodeURIComponent(`Olá ${msg.username}! Sobre sua dúvida na oferta do Mercado Livre (${msg.productTitle || 'Promoção'}): `);
      waContainer.innerHTML = `
        <a href="https://wa.me/55${cleanPhone}?text=${replyMsg}" target="_blank" style="display: inline-flex; align-items: center; gap: 6px; background: #22c55e; color: #fff; text-decoration: none; padding: 4px 10px; border-radius: 14px; font-size: 0.75rem; font-weight: 700; transition: opacity 0.2s;">
          <span>💬 WhatsApp: ${escapeHtml(msg.phone)} (Responder no Zap ↗)</span>
        </a>
      `;
      waContainer.style.display = 'block';
    } else {
      waContainer.style.display = 'none';
    }
  }

  // Card do Produto
  const prodBanner = document.getElementById('active-prod-banner');
  if (msg.productTitle) {
    prodBanner.style.display = 'flex';
    document.getElementById('active-prod-title').textContent = msg.productTitle;
    document.getElementById('active-prod-img').src = msg.productImage || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500';
    document.getElementById('active-prod-link').href = msg.productLink || '#';
  } else {
    prodBanner.style.display = 'none';
  }

  renderActiveThread(msg);
  renderAdminMessagesSidebar();

  setTimeout(() => {
    const input = document.getElementById('admin-reply-input');
    if (input) input.focus();
  }, 100);
}

// --- GRAVADOR DE ÁUDIO DO ADMIN (RESPOSTA POR VOZ) ---
let adminVoiceRecorder = null;
let adminRecordedAudio = null;

function initAdminAudioRecorder() {
  adminRecordedAudio = null;
  adminVoiceRecorder = new AudioVoiceRecorder({
    onStateChange: (state, seconds) => {
      renderAdminRecorderUI(state, seconds);
    },
    onReady: (base64Audio, seconds) => {
      adminRecordedAudio = base64Audio;
      renderAdminRecorderUI('ready', seconds);
    },
    onCancel: () => {
      adminRecordedAudio = null;
      renderAdminRecorderUI('idle', 0);
    }
  });
  renderAdminRecorderUI('idle', 0);
}

function renderAdminRecorderUI(state, seconds = 0) {
  const container = document.getElementById('admin-audio-record-zone');
  const micBtn = document.getElementById('btn-admin-mic');
  if (!container) return;

  if (state === 'idle') {
    container.innerHTML = '';
    if (micBtn) {
      micBtn.textContent = '🎙️';
      micBtn.style.background = 'rgba(255, 71, 87, 0.15)';
      micBtn.style.color = '#ff4757';
    }
  } else if (state === 'recording') {
    if (micBtn) {
      micBtn.textContent = '⏹️';
      micBtn.style.background = '#ef4444';
      micBtn.style.color = '#fff';
    }
    container.innerHTML = `
      <div class="recording-active-bar" style="background: rgba(239, 68, 68, 0.2);">
        <div class="recording-indicator"></div>
        <span class="recording-timer">${formatAudioSeconds(seconds)}</span>
        <button type="button" class="btn-record-stop" onclick="stopAdminRecording()">⏹️ Concluir Gravação</button>
        <button type="button" class="btn-record-cancel" onclick="cancelAdminRecording()">✕ Cancelar</button>
      </div>
    `;
  } else if (state === 'ready' && adminRecordedAudio) {
    if (micBtn) {
      micBtn.textContent = '🎙️';
      micBtn.style.background = 'rgba(255, 71, 87, 0.15)';
      micBtn.style.color = '#ff4757';
    }
    container.innerHTML = `
      <div class="audio-preview-box" style="background: rgba(16, 185, 129, 0.15);">
        <span style="font-size: 0.82rem; font-weight: 700; color: #10b981; white-space: nowrap;">✅ Áudio pronto para envio!</span>
        <div style="flex: 1; min-width: 0;">
          ${renderAudioPlayer(adminRecordedAudio, 'admin_preview_player', 'Prévia da sua resposta')}
        </div>
        <button type="button" class="btn-discard-audio" onclick="discardAdminRecording()" title="Descartar áudio">
          🗑️ Descartar
        </button>
      </div>
    `;
  }
}

function toggleAdminRecording() {
  if (!adminVoiceRecorder) initAdminAudioRecorder();
  if (adminVoiceRecorder.mediaRecorder && adminVoiceRecorder.mediaRecorder.state === 'recording') {
    adminVoiceRecorder.stop();
  } else {
    adminVoiceRecorder.start();
  }
}

function stopAdminRecording() {
  if (adminVoiceRecorder) adminVoiceRecorder.stop();
}

function cancelAdminRecording() {
  if (adminVoiceRecorder) adminVoiceRecorder.cancel();
}

function discardAdminRecording() {
  adminRecordedAudio = null;
  if (adminVoiceRecorder) adminVoiceRecorder.cancel();
}

function renderActiveThread(msg) {
  const container = document.getElementById('active-thread-scroll');
  container.innerHTML = '';

  const qTime = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const rTime = msg.repliedAt ? new Date(msg.repliedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  const qDiv = document.createElement('div');
  qDiv.className = 'desk-bubble desk-bubble-visitor';
  qDiv.innerHTML = `
    <div class="desk-bubble-sender">Cliente (${escapeHtml(msg.username)})</div>
    ${msg.question && msg.question !== '🎤 [Dúvida em Áudio]' ? `<div>${escapeHtml(msg.question)}</div>` : ''}
    ${msg.questionAudio ? renderAudioPlayer(msg.questionAudio, 'admin_q_audio_' + msg.id, 'Áudio do cliente') : ''}
    <span class="desk-bubble-time">${qTime}</span>
  `;
  container.appendChild(qDiv);

  if (msg.reply || msg.replyAudio) {
    const rDiv = document.createElement('div');
    rDiv.className = 'desk-bubble desk-bubble-admin';
    rDiv.innerHTML = `
      <div class="desk-bubble-sender">Você (Atendimento)</div>
      ${msg.reply && msg.reply !== '🎤 [Resposta em Áudio]' ? `<div>${escapeHtml(msg.reply)}</div>` : ''}
      ${msg.replyAudio ? renderAudioPlayer(msg.replyAudio, 'admin_r_audio_' + msg.id, 'Seu áudio de resposta') : ''}
      <span class="desk-bubble-time">${rTime}</span>
    `;
    container.appendChild(rDiv);
  }

  container.scrollTop = container.scrollHeight;
}

// Envia resposta (texto ou áudio)
async function sendReplyToUser(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('admin-reply-input');
  const text = input ? input.value.trim() : '';

  if ((!text && !adminRecordedAudio) || !currentMsgId || !adminToken) {
    showToast('Digite uma mensagem ou grave um áudio para responder.');
    return;
  }

  const btn = document.getElementById('btn-admin-submit-reply');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/admin/reply/${currentMsgId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({
        reply: text,
        replyAudio: adminRecordedAudio || null
      })
    });

    if (res.ok) {
      if (input) input.value = '';
      discardAdminRecording();
      showToast('✅ Resposta enviada! O cliente foi notificado.');
      loadAdminMessages();
      const data = await res.json();
      renderActiveThread(data.message);
    } else {
      showToast('Erro ao enviar resposta.');
    }
  } catch (err) {
    showToast('Erro de conexão ao enviar resposta.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function insertReplyText(text) {
  const input = document.getElementById('admin-reply-input');
  if (input) {
    input.value = text;
    input.focus();
  }
}

async function deleteCurrentMessage() {
  if (!currentMsgId || !adminToken) return;
  if (!confirm('Deseja excluir esta dúvida?')) return;

  try {
    const res = await fetch(`/api/admin/message/${currentMsgId}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });

    if (res.ok) {
      showToast('Dúvida excluída com sucesso.');
      closeMobileChat();
      loadAdminMessages();
    }
  } catch (err) {
    showToast('Erro ao excluir.');
  }
}

function closeMobileChat() {
  currentMsgId = null;
  discardAdminRecording();
  const dashboard = document.querySelector('.chat-dashboard');
  if (dashboard) dashboard.classList.remove('mobile-chat-open');
  document.getElementById('active-message-container').style.display = 'none';
  document.getElementById('no-message-selected').style.display = 'flex';
  renderAdminMessagesSidebar();
}

function setupFilterInput() {
  const input = document.getElementById('filter-messages-input');
  if (input) {
    input.addEventListener('input', () => {
      renderAdminMessagesSidebar();
    });
  }
}

// Robô Autônomo (protegido)
async function triggerAutonomousMiner() {
  if (!adminToken) return;

  const btn = document.getElementById('btn-run-miner');
  const status = document.getElementById('miner-status-text');

  btn.disabled = true;
  btn.textContent = '⏳ Robô varrendo Mercado Livre...';
  status.textContent = '';

  try {
    const res = await fetch('/api/miner/run', {
      method: 'POST',
      headers: { 'x-admin-token': adminToken }
    });
    const data = await res.json();

    if (data.success) {
      status.textContent = `✅ ${data.count} ofertas mineradas e atualizadas no piloto automático!`;
      showToast(`Sucesso! ${data.count} ofertas mineradas!`);
      loadDealsList();
    } else {
      status.textContent = 'Nenhuma nova oferta no momento.';
    }
  } catch (err) {
    status.textContent = 'Erro de conexão ao rodar o robô.';
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Forçar Varredura do Robô Agora';
  }
}

async function loadDealsList() {
  try {
    const res = await fetch('/api/products');
    allDeals = await res.json();

    const badgeEl = document.getElementById('admin-products-badge');
    const totalEl = document.getElementById('admin-deals-total');
    if (badgeEl) badgeEl.textContent = allDeals.length;
    if (totalEl) totalEl.textContent = allDeals.length;

    const tbody = document.getElementById('admin-deals-tbody');
    if (!tbody) return;

    tbody.innerHTML = allDeals.map(d => {
      const priceFormatted = Number(d.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const discountTag = d.discount ? `<span style="color:#15803d; font-weight:800;">${d.discount}% OFF</span>` : '-';
      return `
        <tr>
          <td>
            <div class="table-prod-info">
              <img src="${d.image}" class="table-thumb" alt="${escapeHtml(d.title)}" onerror="this.src='https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500'">
              <span class="table-title" title="${escapeHtml(d.title)}">${escapeHtml(d.title)}</span>
            </div>
          </td>
          <td>${escapeHtml(d.category || '-')}</td>
          <td><strong>${priceFormatted}</strong></td>
          <td>${discountTag}</td>
          <td>
            <a href="${d.affiliateLink}" target="_blank" style="color:var(--admin-primary); font-size:0.8rem; font-weight:700; text-decoration:underline;">
              Link com sua Tag ML ↗
            </a>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao listar ofertas:', err);
  }
}

// Alerta Sonoro
function toggleSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('sound-btn');
  if (soundEnabled) {
    btn.innerHTML = '🔔 Som: <strong>Ligado</strong>';
    btn.style.opacity = '1';
    playAlertSound();
  } else {
    btn.innerHTML = '🔕 Som: <strong>Desligado</strong>';
    btn.style.opacity = '0.6';
  }
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.24);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch (e) {}
}

// Disparo de notificação Push para todos os celulares cadastrados
async function triggerAdminBroadcast() {
  if (!adminToken) {
    showToast('Acesso não autenticado.');
    return;
  }

  const confirmSend = confirm('Deseja disparar uma notificação Push agora para TODOS os celulares cadastrados no site?');
  if (!confirmSend) return;

  const btn = document.getElementById('btn-broadcast');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Enviando...';
  }

  try {
    const res = await fetch('/api/admin/broadcast-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({
        title: 'Sua Promo 🔥',
        body: 'Temos uma promoção para você! Toque para conferir.'
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`📢 Notificação disparada com sucesso para ${data.sent} celulares!`);
    } else {
      showToast(`Aviso: ${data.sent || 0} celulares receberam a notificação.`);
    }
  } catch (err) {
    showToast('Erro de conexão ao disparar notificação.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🚀 <span>Disparar Notificação Geral</span>';
    }
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 4000);
}

// --- ROBÔ DE ALERTAS DO TELEGRAM ---

async function loadTelegramSettings() {
  if (!adminToken) return;
  try {
    const res = await fetch('/api/admin/settings/telegram', {
      headers: { 'x-admin-token': adminToken }
    });
    if (res.ok) {
      const data = await res.json();
      const tokenInput = document.getElementById('telegram-bot-token');
      const chatInput = document.getElementById('telegram-chat-id');
      if (tokenInput && data.token) tokenInput.value = data.token;
      if (chatInput && data.chatId) chatInput.value = data.chatId;
    }
  } catch (err) {
    console.error('Erro ao carregar configurações do Telegram:', err);
  }
}

async function handleSaveTelegramSettings(e) {
  e.preventDefault();
  if (!adminToken) return;

  const token = document.getElementById('telegram-bot-token').value.trim();
  const chatId = document.getElementById('telegram-chat-id').value.trim();
  const msgEl = document.getElementById('telegram-save-msg');
  const btn = document.getElementById('btn-save-telegram');

  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const res = await fetch('/api/admin/settings/telegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ token, chatId })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      msgEl.textContent = '✅ Configurações do robô salvas com sucesso!';
      msgEl.style.background = '#dcfce7';
      msgEl.style.color = '#15803d';
      msgEl.style.display = 'block';
      showToast('Robô do Telegram salvo!');
    } else {
      msgEl.textContent = '❌ Erro ao salvar configurações.';
      msgEl.style.background = '#fee2e2';
      msgEl.style.color = '#b91c1c';
      msgEl.style.display = 'block';
    }
  } catch (err) {
    msgEl.textContent = '❌ Erro de conexão com o servidor.';
    msgEl.style.background = '#fee2e2';
    msgEl.style.color = '#b91c1c';
    msgEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Salvar Configurações';
  }
}

async function handleTestTelegram() {
  if (!adminToken) return;
  const btn = document.getElementById('btn-test-telegram');
  const msgEl = document.getElementById('telegram-save-msg');

  // Salva primeiro antes de testar
  const token = document.getElementById('telegram-bot-token').value.trim();
  const chatId = document.getElementById('telegram-chat-id').value.trim();
  if (!token || !chatId) {
    msgEl.textContent = '⚠️ Preencha o Token do Bot e o seu Chat ID antes de testar.';
    msgEl.style.background = '#fef3c7';
    msgEl.style.color = '#b45309';
    msgEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Enviando teste...';

  try {
    // Garante que os campos atuais foram salvos
    await fetch('/api/admin/settings/telegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ token, chatId })
    });

    const res = await fetch('/api/admin/test-telegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      }
    });

    const data = await res.json();
    if (res.ok && data.success) {
      msgEl.textContent = '🚀 Sucesso! Mensagem de teste enviada para o seu Telegram. Verifique seu app!';
      msgEl.style.background = '#dcfce7';
      msgEl.style.color = '#15803d';
      msgEl.style.display = 'block';
      showToast('Alerta de teste enviado no Telegram!');
    } else {
      msgEl.textContent = `❌ ${data.error || 'Falha ao enviar mensagem de teste.'}`;
      msgEl.style.background = '#fee2e2';
      msgEl.style.color = '#b91c1c';
      msgEl.style.display = 'block';
    }
  } catch (err) {
    msgEl.textContent = '❌ Erro de conexão ao testar Telegram.';
    msgEl.style.background = '#fee2e2';
    msgEl.style.color = '#b91c1c';
    msgEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Testar Alerta no Telegram';
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}
