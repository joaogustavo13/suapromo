const https = require('https');
const fs = require('fs');
const path = require('path');

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');

// Canais e fluxos públicos de ofertas ativas no Mercado Livre com foco em Beleza, Saúde e Ofertas Quentes
const DEAL_SOURCES = [
  // Foco 1: Beleza & Cuidados
  { url: 'https://www.mercadolivre.com.br/social/beleza', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhosdebeleza', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadosdebeleza', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/cachos', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/autocuidado', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhosdatha', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhosdagi', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadosdagi', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhosle', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhosisa', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadosisa', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhosgabi', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhosmi', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhosana', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadosana', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhosdalu', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadosdalu', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhoscarol', cat: 'Beleza & Cuidados' },
  { url: 'https://www.mercadolivre.com.br/social/achadosdanath', cat: 'Beleza & Cuidados' },

  // Foco 2: Saúde & Bem-Estar
  { url: 'https://www.mercadolivre.com.br/social/saude', cat: 'Saúde & Bem-Estar' },
  { url: 'https://www.mercadolivre.com.br/social/suplementos', cat: 'Saúde & Bem-Estar' },
  { url: 'https://www.mercadolivre.com.br/social/bemestar', cat: 'Saúde & Bem-Estar' },

  // Ofertas Gerais & Maiores Descontos
  { url: 'https://www.mercadolivre.com.br/social/ofertas', cat: 'Ofertas Gerais' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhos', cat: 'Ofertas Gerais' },
  { url: 'https://www.mercadolivre.com.br/social/descontos', cat: 'Ofertas Gerais' },
  { url: 'https://www.mercadolivre.com.br/social/achados', cat: 'Ofertas Gerais' },
  { url: 'https://www.mercadolivre.com.br/social/joaogustavo_13', cat: 'Ofertas Gerais' },
  { url: 'https://www.mercadolivre.com.br/social/achadosbrasil', cat: 'Ofertas Gerais' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhosbrasil', cat: 'Ofertas Gerais' },
  { url: 'https://www.mercadolivre.com.br/social/achadinhosdodia', cat: 'Ofertas Gerais' },
  { url: 'https://www.mercadolivre.com.br/social/achadosdodia', cat: 'Ofertas Gerais' },
  { url: 'https://www.mercadolivre.com.br/social/achadosju', cat: 'Ofertas Gerais' },
  { url: 'https://www.mercadolivre.com.br/social/decoracao', cat: 'Casa & Cozinha' },
  { url: 'https://www.mercadolivre.com.br/social/gamer', cat: 'Informática & Gamer' },
  { url: 'https://www.mercadolivre.com.br/social/eletrodomesticos', cat: 'Casa & Cozinha' }
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

function parseProductsFromHtml(html, affiliateTag, defaultCat = null) {
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

        // Categorização refinada e inteligente com foco especial em Beleza & Cuidados e Saúde & Bem-Estar
        const tLower = title.toLowerCase();
        let category = 'Eletrônicos & Outros';

        // 1. Casa & Cozinha
        const isHome = tLower.includes('panela') || tLower.includes('air fryer') || tLower.includes('airfryer') ||
          tLower.includes('grill') || tLower.includes('cozinha') || tLower.includes('prato') || tLower.includes('copo') ||
          tLower.includes('garrafa') || tLower.includes('lençol') || tLower.includes('lencol') || tLower.includes('travesseiro') ||
          tLower.includes('tapete') || tLower.includes('vaso') || tLower.includes('liquidificador') || tLower.includes('batedeira') ||
          tLower.includes('cafeteira') || tLower.includes('aspirador') || tLower.includes('mesa') || tLower.includes('cadeira') ||
          tLower.includes('organizador') || tLower.includes('luminária') || tLower.includes('luminaria') || tLower.includes('toalha') ||
          tLower.includes('decoração') || tLower.includes('decoracao') || tLower.includes('piscina') || tLower.includes('panificadora') ||
          tLower.includes('ventilador') || tLower.includes('climatizador') || tLower.includes('geladeira') || tLower.includes('fogão') ||
          tLower.includes('micro-ondas') || tLower.includes('lavadora de roupas') || tLower.includes('cooktop') ||
          tLower.includes('balcão') || tLower.includes('balcao') || tLower.includes('armário') || tLower.includes('armario');

        // 2. Automotivo & Ferramentas
        const isAutoTool = tLower.includes('multimídia') || tLower.includes('multimidia') || tLower.includes('pneu') ||
          tLower.includes('automot') || tLower.includes('furadeira') || tLower.includes('parafusadeira') || tLower.includes('chave') ||
          tLower.includes('ferramenta') || tLower.includes('lava jato') || tLower.includes('lavadora portátil') ||
          tLower.includes('carro') || tLower.includes('veículo') || tLower.includes('veiculo') || tLower.includes('capacete') ||
          tLower.includes('serra') || tLower.includes('motosserra') || tLower.includes('martelete') || tLower.includes('trena');

        // 3. Moda & Calçados
        const isFashion = tLower.includes('tênis') || tLower.includes('tenis') || tLower.includes('sapato') ||
          tLower.includes('sandália') || tLower.includes('sandalia') || tLower.includes('camisa') || tLower.includes('camiseta') ||
          tLower.includes('calça') || tLower.includes('calca') || tLower.includes('vestido') || tLower.includes('bolsa') ||
          tLower.includes('mochila') || tLower.includes('cueca') || tLower.includes('meia');

        // 4. Livros & Brinquedos
        const isBooks = tLower.includes('livro') || tLower.includes('box com') || tLower.includes('coleção') ||
          tLower.includes('colecao') || tLower.includes('palavras') || tLower.includes('brinquedo') || tLower.includes('boneca') ||
          tLower.includes('lego') || tLower.includes('quebra-cabeça');

        // 5. Tech, Celulares & Gamer
        const isTech = tLower.includes('celular') || tLower.includes('smartphone') || tLower.includes('galaxy') ||
          tLower.includes('iphone') || tLower.includes('motorola') || tLower.includes('xiaomi') ||
          tLower.includes('notebook') || tLower.includes('pc ') || tLower.includes('computador') ||
          tLower.includes('cpu') || tLower.includes('mouse') || tLower.includes('teclado') || tLower.includes('gamer') ||
          tLower.includes('cooler') || tLower.includes('fone') || tLower.includes('headset') || tLower.includes('tv') ||
          tLower.includes('smart') || tLower.includes('projetor') || tLower.includes('bluetooth') || tLower.includes('caixa de som') ||
          tLower.includes('alexa') || tLower.includes('monitor') || tLower.includes('impressora');

        // 6. Pet Shop
        const isPet = tLower.includes('ração') || tLower.includes('racao') || tLower.includes('pet ') ||
          tLower.includes('cães') || tLower.includes('caes') || tLower.includes('gatos') || tLower.includes('cachorro') ||
          tLower.includes('antipulgas') || tLower.includes('simparic') || tLower.includes('bravecto') || tLower.includes('nexgard');

        // 7. Beleza & Cuidados (Prioridade Máxima)
        const isBeauty = tLower.includes('shampoo') || tLower.includes('condicionador') || tLower.includes('creme facial') ||
          tLower.includes('cabelo') || tLower.includes('perfum') || tLower.includes('batom') || tLower.includes('sabonete') ||
          tLower.includes('make') || tLower.includes('maquiagem') || tLower.includes('esmalte') || tLower.includes('unha') ||
          tLower.includes('cachos') || tLower.includes('sérum') || tLower.includes('serum') || tLower.includes('facial') ||
          tLower.includes('protetor solar') || tLower.includes('hidratante') || tLower.includes('óleo capilar') || tLower.includes('oleo capilar') ||
          tLower.includes('máscara capilar') || tLower.includes('mascara capilar') || tLower.includes('gloss') || tLower.includes('base facial') ||
          tLower.includes('corretivo') || tLower.includes('delineador') || tLower.includes('rímel') || tLower.includes('rimel') ||
          tLower.includes('tintura') || tLower.includes('secador') || tLower.includes('prancha') || tLower.includes('babyliss') ||
          tLower.includes('depilador') || tLower.includes('barbeador') || tLower.includes('escova secadora') ||
          tLower.includes('loreal') || tLower.includes('wella') || tLower.includes('brae') || tLower.includes('truss') ||
          tLower.includes('cerave') || tLower.includes('principia') || tLower.includes('boticário') || tLower.includes('boticario') ||
          tLower.includes('eudora') || tLower.includes('natura') || tLower.includes('skincare') || tLower.includes('cosmético') ||
          tLower.includes('cosmetico') || tLower.includes('alisamento') || tLower.includes('clareador');

        // 8. Saúde & Bem-Estar (Prioridade Máxima)
        const isHealth = tLower.includes('whey') || tLower.includes('creatina') || tLower.includes('vitamina') ||
          tLower.includes('multivitamínico') || tLower.includes('polivitamínico') || tLower.includes('suplemento') ||
          tLower.includes('cafeína') || tLower.includes('cafeina') || tLower.includes('colágeno') || tLower.includes('colageno') ||
          tLower.includes('omega') || tLower.includes('ômega') || tLower.includes('termogênico') || tLower.includes('termogenico') ||
          tLower.includes('glutamina') || tLower.includes('balança digital') || tLower.includes('pressão arterial') ||
          tLower.includes('medidor de pressão') || tLower.includes('termômetro') || tLower.includes('termometro') ||
          tLower.includes('massageador') || tLower.includes('massagem') || tLower.includes('joelheira') || tLower.includes('ortopéd') ||
          tLower.includes('ortoped') || tLower.includes('magnésio') || tLower.includes('magnesio') ||
          tLower.includes('zinco') || tLower.includes('melatonina') || tLower.includes('nutrição') ||
          tLower.includes('nutricao') || tLower.includes('postura') || tLower.includes('corretor postural');

        if (isPet) {
          category = 'Pet Shop';
        } else if (isBeauty) {
          category = 'Beleza & Cuidados';
        } else if (isHealth) {
          category = 'Saúde & Bem-Estar';
        } else if (isHome) {
          category = 'Casa & Cozinha';
        } else if (isAutoTool) {
          category = 'Ferramentas & Auto';
        } else if (isFashion) {
          category = 'Moda & Calçados';
        } else if (isBooks) {
          category = 'Livros & Brinquedos';
        } else if (isTech) {
          category = 'Informática & Gamer';
        } else if (defaultCat && defaultCat !== 'Ofertas Gerais') {
          category = defaultCat;
        } else {
          category = 'Eletrônicos & Outros';
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

        const isBeautyOrHealth = category === 'Beleza & Cuidados' || category === 'Saúde & Bem-Estar';

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
          featured: isBeautyOrHealth || (discount && discount >= 35) || false,
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
  console.log('[AutoMiner] 🤖 Iniciando varredura com foco em Beleza, Saúde e Grandes Descontos do Mercado Livre...');

  let affiliateTag = 'joaogustavo_13';
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (settings.affiliateTag) affiliateTag = settings.affiliateTag;
    } catch (e) {}
  }

  const allFound = [];
  const seenTitles = new Set();

  for (const src of DEAL_SOURCES) {
    const sourceUrl = typeof src === 'string' ? src : src.url;
    const defaultCat = typeof src === 'string' ? null : src.cat;
    const html = await fetchHtml(sourceUrl);
    if (!html) continue;

    const items = parseProductsFromHtml(html, affiliateTag, defaultCat);
    for (const item of items) {
      const cleanKey = item.title.toLowerCase().slice(0, 32);
      if (!seenTitles.has(cleanKey)) {
        seenTitles.add(cleanKey);
        allFound.push(item);
      }
    }
  }

  if (allFound.length > 0) {
    // Ordena: produtos de Beleza & Cuidados e Saúde & Bem-Estar no topo com grandes descontos
    allFound.sort((a, b) => {
      const aPrio = (a.category === 'Beleza & Cuidados' || a.category === 'Saúde & Bem-Estar') ? 1 : 0;
      const bPrio = (b.category === 'Beleza & Cuidados' || b.category === 'Saúde & Bem-Estar') ? 1 : 0;
      if (aPrio !== bPrio) return bPrio - aPrio;
      return (b.discount || 0) - (a.discount || 0);
    });

    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(allFound, null, 2), 'utf8');
    console.log(`[AutoMiner] 🚀 Sucesso! ${allFound.length} ofertas mineradas com foco em Beleza & Saúde registradas!`);
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
