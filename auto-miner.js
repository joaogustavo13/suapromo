const https = require('https');
const fs = require('fs');
const path = require('path');

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');

// Canais e fluxos públicos de ofertas ativas no Mercado Livre
const DEAL_SOURCES = [
  'https://www.mercadolivre.com.br/social/ofertas',
  'https://www.mercadolivre.com.br/social/achadinhos',
  'https://www.mercadolivre.com.br/social/descontos',
  'https://www.mercadolivre.com.br/social/achados',
  'https://www.mercadolivre.com.br/social/joaogustavo_13'
];

function fetchHtml(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        return fetchHtml(nextUrl).then(resolve);
      }
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => resolve(html));
    }).on('error', (err) => {
      console.warn(`[AutoMiner] Falha ao acessar ${url}:`, err.message);
      resolve('');
    });
  });
}

function parseProductsFromHtml(html, affiliateTag) {
  const marker = '_n.ctx.r=';
  const idx = html.indexOf(marker);
  if (idx === -1) return [];

  try {
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

    const products = [];

    for (const listData of lists) {
      const polycards = listData.item?.polycards || [];

      for (let i = 0; i < polycards.length; i++) {
        const p = polycards[i];
        const meta = p.metadata || {};
        const components = p.components || [];

        let title = '';
        let price = 0;
        let originalPrice = null;
        let discount = null;
        let freeShipping = false;

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

        if (!title || price <= 0) continue;

        // Imagem em alta resolução
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
          : 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500';

        // Categorização automática
        const tLower = title.toLowerCase();
        let category = 'Eletrônicos & Outros';
        if (tLower.includes('notebook') || tLower.includes('cpu') || tLower.includes('gabinete') || tLower.includes('mouse') || tLower.includes('teclado') || tLower.includes('gamer') || tLower.includes('cooler') || tLower.includes('impressora')) {
          category = 'Informática & Gamer';
        } else if (tLower.includes('tv') || tLower.includes('projetor') || tLower.includes('smart') || tLower.includes('fone') || tLower.includes('caixa de som') || tLower.includes('bluetooth') || tLower.includes('som')) {
          category = 'Áudio & Vídeo';
        } else if (tLower.includes('panela') || tLower.includes('pote') || tLower.includes('air fryer') || tLower.includes('grill') || tLower.includes('cozinha') || tLower.includes('casa') || tLower.includes('vaso')) {
          category = 'Casa & Cozinha';
        } else if (tLower.includes('camera') || tLower.includes('fechadura') || tLower.includes('segurança') || tLower.includes('alarme')) {
          category = 'Segurança & Casa';
        } else if (tLower.includes('controle') || tLower.includes('ps4') || tLower.includes('ps5') || tLower.includes('xbox') || tLower.includes('jogo') || tLower.includes('videogame')) {
          category = 'Games';
        }

        // Gera o link oficial com o ID de afiliado do usuário
        let affiliateLink = `https://${meta.url || 'www.mercadolivre.com.br'}`;
        if (affiliateLink.includes('?')) {
          affiliateLink += `&matt_tool=${affiliateTag}&forceInApp=true`;
        } else {
          affiliateLink += `?matt_tool=${affiliateTag}&forceInApp=true`;
        }

        let badge = 'Oferta';
        if (discount && discount >= 30) {
          badge = `${discount}% OFF 🔥`;
        } else if (discount) {
          badge = `${discount}% OFF`;
        } else if (freeShipping) {
          badge = 'Frete Grátis';
        }

        products.push({
          id: meta.id || `auto-${Math.random().toString(36).substring(2, 9)}`,
          title: title.trim(),
          category,
          price,
          originalPrice,
          discount,
          image,
          affiliateLink,
          badge,
          freeShipping,
          featured: (discount && discount >= 35) || false,
          createdAt: new Date().toISOString()
        });
      }
    }

    return products;
  } catch (err) {
    console.warn('[AutoMiner] Erro ao fazer parse do HTML:', err.message);
    return [];
  }
}

// Execução autônoma de mineração de ofertas
async function runAutonomousMining() {
  console.log('[AutoMiner] 🤖 Iniciando varredura 100% autônoma de ofertas do Mercado Livre...');

  let affiliateTag = 'joaogustavo_13';
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (settings.affiliateTag) affiliateTag = settings.affiliateTag;
    } catch (e) {}
  }

  const allFound = [];
  const seenTitles = new Set();

  for (const sourceUrl of DEAL_SOURCES) {
    const html = await fetchHtml(sourceUrl);
    if (!html) continue;

    const items = parseProductsFromHtml(html, affiliateTag);
    for (const item of items) {
      const cleanKey = item.title.toLowerCase().slice(0, 30);
      if (!seenTitles.has(cleanKey)) {
        seenTitles.add(cleanKey);
        allFound.push(item);
      }
    }
  }

  if (allFound.length > 0) {
    // Ordena: produtos com maiores descontos no topo
    allFound.sort((a, b) => (b.discount || 0) - (a.discount || 0));

    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(allFound, null, 2), 'utf8');
    console.log(`[AutoMiner] 🚀 Sucesso! ${allFound.length} ofertas mineradas e cadastradas no piloto automático com seu link de afiliado!`);
    return { success: true, count: allFound.length, products: allFound };
  } else {
    console.log('[AutoMiner] Nenhuma nova oferta encontrada nesta rodada.');
    return { success: false, count: 0 };
  }
}

// Inicializador de loop autônomo (roda a cada 30 minutos em background)
function startAutoMiningCron(intervalMinutes = 30) {
  // Executa uma vez de imediato
  runAutonomousMining().catch(console.error);

  const ms = intervalMinutes * 60 * 1000;
  setInterval(() => {
    console.log('[AutoMiner Cron] Atualizando ofertas automaticamente...');
    runAutonomousMining().catch(console.error);
  }, ms);
}

if (require.main === module) {
  runAutonomousMining().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { runAutonomousMining, startAutoMiningCron };
