const https = require('https');
const fs = require('fs');
const path = require('path');

const PROFILE_URL = 'https://www.mercadolivre.com.br/social/joaogustavo_13';
const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');

function fetchProfileHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        return fetchProfileHtml(nextUrl).then(resolve).catch(reject);
      }
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => resolve(html));
    }).on('error', reject);
  });
}

function parseProfileProducts(html) {
  const marker = '_n.ctx.r=';
  const idx = html.indexOf(marker);
  if (idx === -1) {
    throw new Error('Estado da página do Mercado Livre não encontrado.');
  }

  const sub = html.slice(idx + marker.length);
  let depth = 0;
  let endIdx = 0;
  for (let i = 0; i < sub.length; i++) {
    if (sub[i] === '{') depth++;
    else if (sub[i] === '}') {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }

  const rawJson = sub.slice(0, endIdx);
  const data = JSON.parse(rawJson);
  const pageProps = data.appProps?.pageProps || {};
  const lists = pageProps.lists || [];

  if (lists.length === 0) {
    return { products: [], attributionListUrl: '' };
  }

  const listData = lists[0];
  const attributionListUrl = listData.url_attribution_lists || 'https://mercadolivre.com/sec/2SRJWRC';
  const polycards = listData.item?.polycards || [];

  const parsedProducts = polycards.map((p, index) => {
    const meta = p.metadata || {};
    const components = p.components || [];

    let title = '';
    let price = 0;
    let originalPrice = null;
    let discount = null;
    let freeShipping = false;
    let category = 'Geral';

    for (const comp of components) {
      if (comp.type === 'title') {
        title = comp.title?.text || '';
      } else if (comp.type === 'price') {
        const pInfo = comp.price || {};
        price = pInfo.current_price?.value || 0;
        originalPrice = pInfo.previous_price?.value || null;
        discount = pInfo.discount_pct || null;
      } else if (comp.type === 'shipping') {
        const shipText = comp.shipping?.text || '';
        freeShipping = shipText.toLowerCase().includes('frete');
      }
    }

    // Identificar imagem de alta qualidade
    let pictureId = p.pictures?.pictures?.[0]?.id || '';
    if (!pictureId) {
      for (const comp of components) {
        if (comp.type === 'variations') {
          const variations = comp.variations?.variations || [];
          if (variations[0]?.pictures?.[0]?.id) {
            pictureId = variations[0].pictures[0].id;
            break;
          }
        }
      }
    }

    const image = pictureId 
      ? `https://http2.mlstatic.com/D_NQ_NP_${pictureId}-O.webp`
      : 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=60';

    // Categorização inteligente por palavras-chave no título
    const titleLower = title.toLowerCase();
    if (titleLower.includes('notebook') || titleLower.includes('cpu') || titleLower.includes('gabinete') || titleLower.includes('pc') || titleLower.includes('cooler')) {
      category = 'Informática & Gamer';
    } else if (titleLower.includes('joystick') || titleLower.includes('controle') || titleLower.includes('ps4') || titleLower.includes('videogame')) {
      category = 'Games';
    } else if (titleLower.includes('projetor') || titleLower.includes('tv') || titleLower.includes('smart')) {
      category = 'Áudio & Vídeo';
    } else if (titleLower.includes('camera') || titleLower.includes('fechadura') || titleLower.includes('segurança')) {
      category = 'Segurança & Casa Inteligente';
    } else {
      category = 'Eletrônicos';
    }

    // Link com atribuição oficial
    let affiliateLink = attributionListUrl;
    if (meta.url) {
      affiliateLink = `https://${meta.url}`;
      // Injeta parâmetros de rastreamento do afiliado
      if (affiliateLink.includes('?')) {
        affiliateLink += '&matt_tool=joaogustavo_13&forceInApp=true';
      } else {
        affiliateLink += '?matt_tool=joaogustavo_13&forceInApp=true';
      }
    }

    let badge = 'Recomendado';
    if (discount && discount >= 30) {
      badge = `${discount}% OFF 🔥`;
    } else if (discount) {
      badge = `${discount}% OFF`;
    } else if (freeShipping) {
      badge = 'Frete Grátis';
    }

    return {
      id: meta.id || `prod-ml-${index + 1}`,
      title: title || 'Produto Mercado Livre',
      category,
      price,
      originalPrice,
      discount,
      image,
      affiliateLink,
      badge,
      freeShipping,
      featured: index < 4,
      createdAt: new Date().toISOString()
    };
  });

  return {
    products: parsedProducts,
    attributionListUrl,
    ownerId: listData.owner,
    affiliateName: pageProps.affiliateName || 'joaogustavo_13'
  };
}

async function syncProfile() {
  console.log(`[Sync ML] Buscando produtos reais de: ${PROFILE_URL}...`);
  try {
    const html = await fetchProfileHtml(PROFILE_URL);
    const { products, attributionListUrl, ownerId, affiliateName } = parseProfileProducts(html);

    if (products.length > 0) {
      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf8');
      console.log(`[Sync ML] ✅ ${products.length} produtos sincronizados com sucesso do perfil oficial!`);

      // Atualiza settings com o perfil e atribuição
      if (fs.existsSync(SETTINGS_FILE)) {
        try {
          const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
          settings.affiliateProfileUrl = PROFILE_URL;
          settings.affiliateTag = 'joaogustavo_13';
          settings.affiliateOwnerId = ownerId;
          settings.attributionListUrl = attributionListUrl;
          settings.siteName = 'Achadinhos do João Gustavo | Mercado Livre';
          settings.siteSubtitle = 'Recomendações e Achadinhos com Desconto Oficial';
          fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
        } catch (e) {
          console.error('[Sync ML] Erro ao atualizar settings:', e);
        }
      }

      return { success: true, count: products.length, products };
    } else {
      console.warn('[Sync ML] Nenhum produto retornado na raspagem.');
      return { success: false, error: 'Nenhum produto encontrado' };
    }
  } catch (err) {
    console.error('[Sync ML] Erro na sincronização:', err.message);
    return { success: false, error: err.message };
  }
}

if (require.main === module) {
  syncProfile().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { syncProfile };
