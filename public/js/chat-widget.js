// Lógica do Widget de Chat Flutuante (Visitante)
let socket = null;
let sessionId = localStorage.getItem('ml_chat_session_id');
let visitorName = localStorage.getItem('ml_chat_visitor_name');
let isChatOpen = false;
let unreadCount = 0;
let typingTimeout = null;

// Inicializa o ID da sessão do visitante caso não exista
if (!sessionId) {
  sessionId = 'v-' + Math.random().toString(36).substring(2, 9);
  localStorage.setItem('ml_chat_session_id', sessionId);
}

// Inicializa o nome do visitante se não existir
if (!visitorName) {
  visitorName = 'Visitante #' + sessionId.slice(-4).toUpperCase();
  localStorage.setItem('ml_chat_visitor_name', visitorName);
}

// Inicialização do Socket.io
function initChatSocket() {
  if (typeof io === 'undefined') {
    console.warn('Socket.io não encontrado.');
    return;
  }

  socket = io();

  socket.on('connect', () => {
    console.log('[Chat] Conectado ao servidor');
    socket.emit('visitor:join', { sessionId, userName: visitorName });
  });

  // Recebe histórico de mensagens
  socket.on('chat:history', (messages) => {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    
    // Mensagem de boas vindas inicial
    addWelcomeMessage();

    if (messages && messages.length > 0) {
      messages.forEach(msg => appendMessage(msg));
    }
    scrollChatToBottom();
  });

  // Recebe nova mensagem em tempo real
  socket.on('chat:message', (msg) => {
    appendMessage(msg);
    scrollChatToBottom();

    // Se a mensagem veio do atendente (admin)
    if (msg.sender === 'admin') {
      playNotificationSound();

      if (!isChatOpen) {
        unreadCount++;
        updateBadge();
        showTeaserWithText(`💬 Atendente: ${msg.text}`);
      }
    }
  });

  // Indicador de atendente digitando
  socket.on('chat:admin_typing', ({ isTyping }) => {
    const typingEl = document.getElementById('chat-typing');
    if (typingEl) {
      typingEl.style.display = isTyping ? 'flex' : 'none';
      if (isTyping) scrollChatToBottom();
    }
  });
}

// Mensagem inicial de boas vindas do atendente
function addWelcomeMessage() {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'message-bubble msg-admin';
  div.innerHTML = `
    <div class="msg-sender">Atendimento Mercado Livre</div>
    <div>Olá! Seja bem-vindo(a). Estou à disposição para tirar dúvidas sobre os produtos, links ou cupons de desconto. Como posso te ajudar hoje?</div>
    <span class="msg-time">Agora</span>
  `;
  container.appendChild(div);
}

// Adiciona bolha de mensagem na tela
function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  const isMe = msg.sender === 'visitor';
  div.className = `message-bubble ${isMe ? 'msg-visitor' : 'msg-admin'}`;

  const timeStr = msg.timestamp 
    ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    : 'Agora';

  div.innerHTML = `
    <div class="msg-sender">${escapeHtml(msg.senderName || (isMe ? 'Você' : 'Atendente'))}</div>
    <div class="msg-body">${escapeHtml(msg.text)}</div>
    <span class="msg-time">${timeStr}</span>
  `;

  container.appendChild(div);
}

// Envio de mensagem pelo formulário
function sendChatMessage(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input.value.trim();

  if (!text || !socket) return;

  socket.emit('visitor:message', {
    sessionId,
    text,
    userName: visitorName
  });

  input.value = '';
  input.focus();

  // Para indicador de digitação
  socket.emit('visitor:typing', { sessionId, isTyping: false });
}

// Controle do indicador de digitação
document.addEventListener('DOMContentLoaded', () => {
  initChatSocket();
  updateVisitorDisplay();

  const input = document.getElementById('chat-input');
  if (input) {
    input.addEventListener('input', () => {
      if (!socket) return;
      socket.emit('visitor:typing', { sessionId, isTyping: true });

      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        socket.emit('visitor:typing', { sessionId, isTyping: false });
      }, 1500);
    });
  }

  // Esconder teaser após 12 segundos se não houver interação
  setTimeout(() => {
    const teaser = document.getElementById('chat-teaser');
    if (teaser && !isChatOpen && unreadCount === 0) {
      teaser.style.display = 'none';
    }
  }, 12000);
});

// Alterna abertura da janela de chat
function toggleChat(forceState) {
  const chatBox = document.getElementById('chat-box');
  const teaser = document.getElementById('chat-teaser');
  const iconOpen = document.querySelector('.chat-icon-open');
  const iconClose = document.querySelector('.chat-icon-close');

  if (typeof forceState === 'boolean') {
    isChatOpen = forceState;
  } else {
    isChatOpen = !isChatOpen;
  }

  if (isChatOpen) {
    chatBox.classList.add('open');
    if (teaser) teaser.style.display = 'none';
    iconOpen.style.display = 'none';
    iconClose.style.display = 'block';

    // Zera contagem de não lidas
    unreadCount = 0;
    updateBadge();
    scrollChatToBottom();

    setTimeout(() => {
      const input = document.getElementById('chat-input');
      if (input) input.focus();
    }, 150);
  } else {
    chatBox.classList.remove('open');
    iconOpen.style.display = 'block';
    iconClose.style.display = 'none';
  }
}

// Fecha apenas o teaser de boas-vindas
function closeTeaser(e) {
  if (e) e.stopPropagation();
  const teaser = document.getElementById('chat-teaser');
  if (teaser) teaser.style.display = 'none';
}

// Exibe teaser com mensagem específica
function showTeaserWithText(text) {
  const teaser = document.getElementById('chat-teaser');
  const msgEl = document.getElementById('teaser-message');
  if (teaser && msgEl) {
    msgEl.textContent = text;
    teaser.style.display = 'block';
  }
}

// Atualiza badge de mensagens não lidas
function updateBadge() {
  const badge = document.getElementById('chat-badge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// Troca o nome do visitante
function changeVisitorName() {
  const newName = prompt('Como você gostaria de ser chamado no atendimento?', visitorName);
  if (newName && newName.trim()) {
    visitorName = newName.trim();
    localStorage.setItem('ml_chat_visitor_name', visitorName);
    updateVisitorDisplay();
    if (socket) {
      socket.emit('visitor:join', { sessionId, userName: visitorName });
    }
  }
}

function updateVisitorDisplay() {
  const nameEl = document.getElementById('visitor-display-name');
  if (nameEl) nameEl.textContent = visitorName;
}

// Rola o chat para o fim
function scrollChatToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

// Som de notificação sintetizado via Web Audio API (100% nativo)
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.1); // A5

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // AudioContext pode ser bloqueado sem gesto do usuário antes de tocar
  }
}

// Sanitização de string para segurança
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}
