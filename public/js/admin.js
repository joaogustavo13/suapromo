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

  document.getElementById('no-message-selected').style.display = 'none';
  document.getElementById('active-message-container').style.display = 'flex';

  document.getElementById('active-user-name').textContent = msg.username;
  document.getElementById('active-user-initial').textContent = (msg.username || 'U').charAt(0).toUpperCase();

  const isPending = msg.status === 'pending' || !msg.reply;
  document.getElementById('active-msg-status').textContent = isPending ? '🟡 Aguardando sua resposta' : '🟢 Respondido';
  document.getElementById('active-msg-status').style.color = isPending ? '#d97706' : '#15803d';

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

function renderActiveThread(msg) {
  const container = document.getElementById('active-thread-scroll');
  container.innerHTML = '';

  const qTime = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const rTime = msg.repliedAt ? new Date(msg.repliedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  const qDiv = document.createElement('div');
  qDiv.className = 'desk-bubble desk-bubble-visitor';
  qDiv.innerHTML = `
    <div class="desk-bubble-sender">Cliente (${escapeHtml(msg.username)})</div>
    <div>${escapeHtml(msg.question)}</div>
    <span class="desk-bubble-time">${qTime}</span>
  `;
  container.appendChild(qDiv);

  if (msg.reply) {
    const rDiv = document.createElement('div');
    rDiv.className = 'desk-bubble desk-bubble-admin';
    rDiv.innerHTML = `
      <div class="desk-bubble-sender">Você (Atendimento)</div>
      <div>${escapeHtml(msg.reply)}</div>
      <span class="desk-bubble-time">${rTime}</span>
    `;
    container.appendChild(rDiv);
  }

  container.scrollTop = container.scrollHeight;
}

// Envia resposta
async function sendReplyToUser(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('admin-reply-input');
  const text = input.value.trim();

  if (!text || !currentMsgId || !adminToken) return;

  try {
    const res = await fetch(`/api/admin/reply/${currentMsgId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ reply: text })
    });

    if (res.ok) {
      input.value = '';
      showToast('Resposta enviada! O cliente foi notificado.');
      loadAdminMessages();
      const data = await res.json();
      renderActiveThread(data.message);
    } else {
      showToast('Erro ao enviar resposta.');
    }
  } catch (err) {
    showToast('Erro de conexão ao enviar resposta.');
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
      currentMsgId = null;
      document.getElementById('active-message-container').style.display = 'none';
      document.getElementById('no-message-selected').style.display = 'flex';
      loadAdminMessages();
    }
  } catch (err) {
    showToast('Erro ao excluir.');
  }
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

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 4000);
}

function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}
