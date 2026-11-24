// Gerenciamento da Central de Mensagens e Dúvidas do Cliente
let socket = null;
let clientId = localStorage.getItem('ml_lead_client_id');
let clientName = localStorage.getItem('ml_lead_client_name') || '';
let clientPhone = localStorage.getItem('ml_lead_client_phone') || '';
let myTickets = [];

// Gera identificador único para o cliente
if (!clientId) {
  clientId = 'cli-' + Math.random().toString(36).substring(2, 9);
  localStorage.setItem('ml_lead_client_id', clientId);
}

document.addEventListener('DOMContentLoaded', () => {
  initClientSocket();
  loadClientTickets();
  prefillClientForm();
});

// Inicialização do Socket para receber respostas em tempo real
function initClientSocket() {
  if (typeof io === 'undefined') return;

  socket = io();

  socket.on('connect', () => {
    socket.emit('client:join', { clientId });
  });

  // O vendedor respondeu!
  socket.on('client:ticket_updated', ({ ticket, reply }) => {
    playNotificationSound();
    loadClientTickets();
    showToast(`🔔 Nova resposta do vendedor para: "${ticket.productTitle || 'Sua Dúvida'}"!`);
  });
}

// Pré-preenche formulário com dados salvos
function prefillClientForm() {
  if (clientName) {
    const nameInput = document.getElementById('client-name');
    if (nameInput) nameInput.value = clientName;
  }
  if (clientPhone) {
    const phoneInput = document.getElementById('client-phone');
    if (phoneInput) phoneInput.value = clientPhone;
  }
  const userSub = document.getElementById('drawer-user-info');
  if (userSub && clientName) {
    userSub.textContent = `Olá, ${clientName} (${clientPhone})`;
  }
}

// Abre o modal de envio de dúvida para um produto específico
function openAskModal(prodId, prodTitle, prodPrice, prodImg, prodLink) {
  document.getElementById('ask-prod-id').value = prodId;
  document.getElementById('ask-prod-title').value = decodeURIComponent(prodTitle);
  document.getElementById('ask-prod-image').value = prodImg;
  document.getElementById('ask-prod-link').value = prodLink;

  document.getElementById('modal-prod-title').textContent = decodeURIComponent(prodTitle);
  document.getElementById('modal-prod-price').textContent = decodeURIComponent(prodPrice);
  document.getElementById('modal-prod-img').src = prodImg;

  prefillClientForm();

  document.getElementById('ask-modal-overlay').style.display = 'flex';
  setTimeout(() => {
    document.getElementById('client-question').focus();
  }, 100);
}

function closeAskModal() {
  document.getElementById('ask-modal-overlay').style.display = 'none';
  document.getElementById('client-question').value = '';
}

// Envia a pergunta do cliente
async function submitProductQuestion(e) {
  e.preventDefault();

  const nameVal = document.getElementById('client-name').value.trim();
  const phoneVal = document.getElementById('client-phone').value.trim();
  const questionVal = document.getElementById('client-question').value.trim();

  const prodId = document.getElementById('ask-prod-id').value;
  const prodTitle = document.getElementById('ask-prod-title').value;
  const prodImg = document.getElementById('ask-prod-image').value;
  const prodLink = document.getElementById('ask-prod-link').value;

  // Salva dados de identificação para as próximas vezes
  clientName = nameVal;
  clientPhone = phoneVal;
  localStorage.setItem('ml_lead_client_name', clientName);
  localStorage.setItem('ml_lead_client_phone', clientPhone);

  const submitBtn = document.getElementById('btn-submit-question');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Enviando...';

  try {
    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        clientName,
        clientPhone,
        message: questionVal,
        productId: prodId,
        productTitle: prodTitle,
        productImage: prodImg,
        productLink: prodLink
      })
    });

    const data = await res.json();
    if (res.ok) {
      closeAskModal();
      openMessagesCenter();
      loadClientTickets();
      showToast('✅ Dúvida enviada! O vendedor foi notificado no celular.');
    } else {
      alert('Erro ao enviar: ' + (data.error || 'Tente novamente.'));
    }
  } catch (err) {
    alert('Erro de conexão. Verifique se o servidor está ativo.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Enviar Mensagem & Notificar Vendedor 🚀';
  }
}

// Carrega as mensagens e dúvidas enviadas pelo cliente
async function loadClientTickets() {
  if (!clientId) return;

  try {
    const res = await fetch(`/api/tickets/client/${clientId}`);
    myTickets = await res.json();

    renderTicketsList();
    updateUnreadCount();
  } catch (err) {
    console.error('Erro ao carregar tickets:', err);
  }
}

// Renderiza os tickets na gaveta de mensagens
function renderTicketsList() {
  const container = document.getElementById('drawer-tickets-list');
  if (!container) return;

  if (!myTickets || myTickets.length === 0) {
    container.innerHTML = `
      <div class="empty-drawer">
        <p>Você ainda não enviou nenhuma dúvida.</p>
        <small>Clique em "Tirar Dúvida no Chat" em qualquer produto da vitrine para perguntar ao vendedor!</small>
      </div>
    `;
    return;
  }

  container.innerHTML = myTickets.map(t => {
    const isPending = t.status === 'pending';
    const statusBadge = isPending 
      ? '<span class="ticket-status-pending">🟡 Aguardando vendedor</span>'
      : '<span class="ticket-status-replied">🟢 Respondido pelo vendedor</span>';

    const messagesHtml = t.messages.map(m => {
      const isClient = m.sender === 'client';
      const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return `
        <div class="ticket-bubble ${isClient ? 'bubble-client' : 'bubble-admin'}">
          <div class="bubble-sender">${isClient ? 'Você' : (m.senderName || 'João Gustavo')}</div>
          <div class="bubble-text">${escapeHtml(m.text)}</div>
          <span class="bubble-time">${timeStr}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="client-ticket-card" id="ticket-${t.id}">
        <div class="ticket-card-header">
          <div class="ticket-prod-info">
            ${t.productImage ? `<img src="${t.productImage}" class="ticket-prod-thumb" alt="Produto">` : ''}
            <div>
              <h5 class="ticket-prod-title">${escapeHtml(t.productTitle || 'Dúvida Geral')}</h5>
              ${statusBadge}
            </div>
          </div>
          ${t.productLink ? `<a href="${t.productLink}" target="_blank" class="ticket-view-link">Ver Produto ↗</a>` : ''}
        </div>

        <div class="ticket-messages-thread">
          ${messagesHtml}
        </div>
      </div>
    `;
  }).join('');
}

// Atualiza contadores de mensagens
function updateUnreadCount() {
  const answeredCount = myTickets.filter(t => t.status === 'replied').length;

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

// Gaveta de Mensagens (Abrir/Fechar)
function openMessagesCenter() {
  document.getElementById('messages-drawer').classList.add('open');
  loadClientTickets();
}

function closeMessagesCenter() {
  document.getElementById('messages-drawer').classList.remove('open');
}

// Toast
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

// Som suave de notificação (Web Audio)
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
    osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {}
}

function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}
