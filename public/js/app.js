// Gerenciamento da vitrine de produtos e filtros
let allProducts = [];
let currentCategory = 'Todos';
let searchQuery = '';
let currentSort = 'featured';

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadProducts();
  setupEventListeners();
});

// Carrega configurações da loja
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    const titleEl = document.getElementById('site-title');
    if (titleEl && settings.siteName) {
      titleEl.textContent = settings.siteName;
    }
    document.title = `${settings.siteName || 'Sua Promo'} - As Melhores Ofertas da Internet`;
    if (settings.siteSubtitle) {
      document.getElementById('site-subtitle').textContent = settings.siteSubtitle;
    }
    if (settings.welcomeMessage) {
      const teaserMsg = document.getElementById('teaser-message');
      if (teaserMsg) teaserMsg.textContent = settings.welcomeMessage;
    }
    if (settings.adminName) {
      const opName = document.getElementById('chat-operator-name');
      if (opName) opName.textContent = settings.adminName;
    }
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

// Carrega os produtos da API
async function loadProducts() {
  try {
    let url = '/api/products';
    const params = new URLSearchParams();
    if (currentCategory && currentCategory !== 'Todos') {
      params.append('category', currentCategory);
    }
    if (searchQuery) {
      params.append('search', searchQuery);
    }
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const res = await fetch(url);
    allProducts = await res.json();

    renderProducts();
  } catch (err) {
    console.error('Erro ao carregar produtos:', err);
    document.getElementById('products-grid').innerHTML = `
      <div class="empty-state">
        <h4>Ops! Não foi possível carregar os produtos.</h4>
        <p>Verifique se o servidor está rodando.</p>
      </div>
    `;
  }
}

// Configura ouvintes de eventos
function setupEventListeners() {
  // Categorias
  const catButtons = document.querySelectorAll('.cat-pill');
  catButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      catButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.getAttribute('data-category');
      loadProducts();
    });
  });

  // Busca
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  let searchTimer;

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const val = e.target.value.trim();
    searchClear.style.display = val ? 'block' : 'none';

    searchTimer = setTimeout(() => {
      searchQuery = val;
      loadProducts();
    }, 250);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    searchQuery = '';
    loadProducts();
  });

  // Ordenação
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value;
      renderProducts();
    });
  }
}

// Formata moeda Real (BRL)
function formatBRL(val) {
  if (!val && val !== 0) return 'R$ 0,00';
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Renderiza os produtos no Grid
function renderProducts() {
  const grid = document.getElementById('products-grid');
  const countEl = document.getElementById('products-count');

  if (!allProducts || allProducts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h4>Nenhum produto encontrado</h4>
        <p>Tente buscar por outro termo ou escolha outra categoria.</p>
        <button class="cat-pill active" onclick="resetFilters()">Limpar filtros</button>
      </div>
    `;
    countEl.textContent = '0 ofertas encontradas';
    return;
  }

  // Ordenação local
  let sorted = [...allProducts];
  if (currentSort === 'price-asc') {
    sorted.sort((a, b) => a.price - b.price);
  } else if (currentSort === 'price-desc') {
    sorted.sort((a, b) => b.price - a.price);
  } else if (currentSort === 'discount') {
    sorted.sort((a, b) => (b.discount || 0) - (a.discount || 0));
  } else {
    // featured: itens destacados primeiro
    sorted.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  }

  countEl.textContent = `${sorted.length} ${sorted.length === 1 ? 'oferta encontrada' : 'ofertas encontradas'}`;

  grid.innerHTML = sorted.map(prod => {
    const originalPriceHtml = prod.originalPrice 
      ? `<span class="original-price">${formatBRL(prod.originalPrice)}</span>` 
      : '';

    const discountPill = prod.discount 
      ? `<span class="discount-pill">-${prod.discount}%</span>` 
      : (prod.badge ? `<span class="discount-pill">${prod.badge}</span>` : '');

    const freeShippingHtml = prod.freeShipping 
      ? `<div class="free-shipping-tag">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="1" y="3" width="15" height="13"></rect>
            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
            <circle cx="5.5" cy="18.5" r="2.5"></circle>
            <circle cx="18.5" cy="18.5" r="2.5"></circle>
          </svg>
          Frete grátis Full
        </div>`
      : '';

    return `
      <div class="product-card" id="card-${prod.id}">
        <div class="card-top-tags">
          <span class="store-pill">🏷️ Mercado Livre</span>
          ${discountPill}
        </div>

        <div class="product-image-wrap">
          <img src="${prod.image}" alt="${prod.title}" class="product-image" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=60'">
        </div>

        <div class="product-info">
          <h4 class="product-title" title="${prod.title}">${prod.title}</h4>
          
          <div class="price-box">
            ${originalPriceHtml}
            <div class="price-row">
              <span class="current-price">${formatBRL(prod.price)}</span>
            </div>
            <div class="installment-text">em até 10x sem juros no cartão</div>
          </div>

          ${freeShippingHtml}

          <div class="product-card-actions">
            <a href="${prod.affiliateLink}" target="_blank" rel="noopener noreferrer" class="btn-get-deal" onclick="trackAffiliateClick('${prod.id}', '${encodeURIComponent(prod.title)}')">
              Pegar Promoção ➜
            </a>
            <button class="btn-ask-chat" onclick="openAskModal('${prod.id}', '${encodeURIComponent(prod.title)}', '${encodeURIComponent(formatBRL(prod.price))}', '${prod.image}', '${prod.affiliateLink}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              Tirar Dúvida
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Limpa filtros
function resetFilters() {
  currentCategory = 'Todos';
  searchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  const catButtons = document.querySelectorAll('.cat-pill');
  catButtons.forEach(b => b.classList.remove('active'));
  if (catButtons[0]) catButtons[0].classList.add('active');
  loadProducts();
}

// Abre o chat flutuante e pré-digita a dúvida sobre um produto
function askAboutProduct(encodedTitle, price) {
  const title = decodeURIComponent(encodedTitle);
  toggleChat(true);
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = `Olá! Gostaria de saber mais sobre o produto: "${title}" (${price}). Tem disponibilidade / cupom?`;
    input.focus();
  }
}

// Log / Rastreamento de clique no afiliado
function trackAffiliateClick(productId, encodedTitle) {
  const title = decodeURIComponent(encodedTitle);
  console.log(`[Afiliado ML] Usuário clicou no produto: ${title} (ID: ${productId})`);
}
