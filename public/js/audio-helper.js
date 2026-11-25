// ============================================================
// AUDIO-HELPER.JS - PLAYER & GRAVADOR DE ÁUDIO UNIVERSAL (WHATSAPP-STYLE)
// Compatível com iPhone Safari, Mac, Android e Windows PC
// ============================================================

let activeAudioElement = null;
let activePlayerId = null;

function formatAudioSeconds(sec) {
  if (isNaN(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function escapeAudioHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- PLAYER WHATSAPP-STYLE ---
function renderAudioPlayer(audioDataUrl, playerId, label = 'Mensagem de voz') {
  if (!audioDataUrl) return '';
  return `
    <div class="voice-player-bubble" id="${playerId}" data-src="${audioDataUrl}">
      <audio preload="metadata" src="${audioDataUrl}" ontimeupdate="onVoiceTimeUpdate('${playerId}')" onended="onVoiceEnded('${playerId}')" onloadedmetadata="onVoiceMetadata('${playerId}')"></audio>
      <button type="button" class="btn-voice-play" onclick="togglePlayVoice('${playerId}')" title="Ouvir áudio">
        <svg class="icon-play" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        <svg class="icon-pause" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
      </button>

      <div class="voice-player-track" onclick="onVoiceTrackClick(event, '${playerId}')">
        <div class="voice-player-progress-bar">
          <div class="voice-player-fill" style="width: 0%;"></div>
        </div>
        <div class="voice-player-meta">
          <span class="voice-player-time">0:00</span>
          <span class="voice-player-label">🎤 Áudio</span>
        </div>
      </div>

      <button type="button" class="btn-voice-speed" onclick="toggleVoiceSpeed('${playerId}')" title="Velocidade">1x</button>
    </div>
  `;
}

function togglePlayVoice(playerId) {
  const container = document.getElementById(playerId);
  if (!container) return;
  const audio = container.querySelector('audio');
  if (!audio) return;

  const playIcon = container.querySelector('.icon-play');
  const pauseIcon = container.querySelector('.icon-pause');

  if (activeAudioElement && activeAudioElement !== audio) {
    activeAudioElement.pause();
    if (activePlayerId) {
      const prevContainer = document.getElementById(activePlayerId);
      if (prevContainer) {
        prevContainer.querySelector('.icon-play').style.display = 'inline-block';
        prevContainer.querySelector('.icon-pause').style.display = 'none';
      }
    }
  }

  if (audio.paused) {
    audio.play().then(() => {
      activeAudioElement = audio;
      activePlayerId = playerId;
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'inline-block';
    }).catch(err => {
      console.warn('Erro ao reproduzir áudio:', err);
    });
  } else {
    audio.pause();
    playIcon.style.display = 'inline-block';
    pauseIcon.style.display = 'none';
  }
}

function onVoiceTimeUpdate(playerId) {
  const container = document.getElementById(playerId);
  if (!container) return;
  const audio = container.querySelector('audio');
  const fill = container.querySelector('.voice-player-fill');
  const timeSpan = container.querySelector('.voice-player-time');

  if (audio && audio.duration) {
    const pct = (audio.currentTime / audio.duration) * 100;
    if (fill) fill.style.width = `${pct}%`;
    if (timeSpan) timeSpan.textContent = `${formatAudioSeconds(audio.currentTime)} / ${formatAudioSeconds(audio.duration)}`;
  } else if (audio && timeSpan) {
    timeSpan.textContent = formatAudioSeconds(audio.currentTime);
  }
}

function onVoiceMetadata(playerId) {
  const container = document.getElementById(playerId);
  if (!container) return;
  const audio = container.querySelector('audio');
  const timeSpan = container.querySelector('.voice-player-time');
  if (audio && audio.duration && !isNaN(audio.duration) && timeSpan) {
    timeSpan.textContent = `0:00 / ${formatAudioSeconds(audio.duration)}`;
  }
}

function onVoiceEnded(playerId) {
  const container = document.getElementById(playerId);
  if (!container) return;
  const playIcon = container.querySelector('.icon-play');
  const pauseIcon = container.querySelector('.icon-pause');
  const fill = container.querySelector('.voice-player-fill');
  const audio = container.querySelector('audio');
  const timeSpan = container.querySelector('.voice-player-time');

  if (playIcon) playIcon.style.display = 'inline-block';
  if (pauseIcon) pauseIcon.style.display = 'none';
  if (fill) fill.style.width = '0%';
  if (audio && timeSpan && audio.duration) {
    timeSpan.textContent = `0:00 / ${formatAudioSeconds(audio.duration)}`;
  }
}

function onVoiceTrackClick(e, playerId) {
  const container = document.getElementById(playerId);
  if (!container) return;
  const track = container.querySelector('.voice-player-progress-bar');
  const audio = container.querySelector('audio');
  if (!track || !audio || !audio.duration) return;

  const rect = track.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  audio.currentTime = pct * audio.duration;
  onVoiceTimeUpdate(playerId);
}

function toggleVoiceSpeed(playerId) {
  const container = document.getElementById(playerId);
  if (!container) return;
  const audio = container.querySelector('audio');
  const btn = container.querySelector('.btn-voice-speed');
  if (!audio || !btn) return;

  let speed = 1.0;
  if (audio.playbackRate === 1.0) speed = 1.5;
  else if (audio.playbackRate === 1.5) speed = 2.0;
  else speed = 1.0;

  audio.playbackRate = speed;
  btn.textContent = `${speed}x`;
}

// --- GRAVADOR UNIVERSAL DE MICROFONE ---
class AudioVoiceRecorder {
  constructor(options = {}) {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;
    this.timerInterval = null;
    this.seconds = 0;
    this.base64Audio = null;

    // Callbacks
    this.onStateChange = options.onStateChange || (() => {});
    this.onReady = options.onReady || (() => {});
    this.onCancel = options.onCancel || (() => {});
  }

  static getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/ogg'
    ];
    for (const t of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return '';
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Seu navegador não tem suporte à gravação de microfone.');
      return false;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = AudioVoiceRecorder.getSupportedMimeType();
      const options = mimeType ? { mimeType } : {};

      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.audioChunks = [];
      this.base64Audio = null;
      this.seconds = 0;

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const mime = this.mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.audioChunks, { type: mime });

        // Converte para Base64 Data URL
        const reader = new FileReader();
        reader.onloadend = () => {
          this.base64Audio = reader.result;
          this.onReady(this.base64Audio, this.seconds);
        };
        reader.readAsDataURL(audioBlob);

        // Para as faixas do microfone
        if (this.stream) {
          this.stream.getTracks().forEach(t => t.stop());
        }
      };

      this.mediaRecorder.start(250); // Coleta a cada 250ms
      this.onStateChange('recording', 0);

      this.timerInterval = setInterval(() => {
        this.seconds++;
        this.onStateChange('recording', this.seconds);
        if (this.seconds >= 120) { // Limite máximo de 2 minutos
          this.stop();
        }
      }, 1000);

      return true;
    } catch (err) {
      console.error('Erro ao acessar microfone:', err);
      alert('Permissão de microfone negada ou indisponível.');
      return false;
    }
  }

  stop() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.onStateChange('stopped', this.seconds);
    }
  }

  cancel() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }
    this.audioChunks = [];
    this.base64Audio = null;
    this.seconds = 0;
    this.onStateChange('idle', 0);
    this.onCancel();
  }
}

// --- UTILITÁRIOS DE ENVIO E VISUALIZAÇÃO DE FOTOS ---
function compressImageFileToBase64(file, maxDim = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      return reject(new Error('Selecione um arquivo de imagem válido.'));
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Erro ao carregar imagem.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

function renderChatImage(imageSrc) {
  if (!imageSrc) return '';
  return `
    <div class="chat-photo-wrap" onclick="openImageLightbox(this.querySelector('img').src)">
      <img src="${imageSrc}" class="chat-photo-thumb" alt="Foto enviada" loading="lazy">
    </div>
  `;
}

function openImageLightbox(src) {
  if (!src) return;
  let overlay = document.getElementById('chat-photo-lightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'chat-photo-lightbox';
    overlay.className = 'chat-photo-lightbox';
    overlay.onclick = closeImageLightbox;
    overlay.innerHTML = `
      <button type="button" class="lightbox-close-btn" onclick="closeImageLightbox()">&times;</button>
      <img id="chat-lightbox-img" src="" alt="Visualizar foto">
    `;
    document.body.appendChild(overlay);
  }
  document.getElementById('chat-lightbox-img').src = src;
  overlay.style.display = 'flex';
}

function closeImageLightbox() {
  const overlay = document.getElementById('chat-photo-lightbox');
  if (overlay) overlay.style.display = 'none';
}
