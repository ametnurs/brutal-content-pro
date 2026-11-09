/**
 * APPDOCK HUB ECOSYSTEM - CLOUDFLARE WORKER (index.js)
 * Architecture: Cloudflare Workers + D1 Database (SQLite) + KV & Memory Fallback + Telegram Webhook
 * Multi-Product License Manager, 2-Tier Affiliate System, Rewarded Ads Quota Engine
 * Updated: Ditambahkan Produk "TikTok Brutal Content Pro" (brutal_pro)
 */

// ============================================================================
// ⚙️ KONFIGURASI GLOBAL
// ============================================================================
const CONFIG = {
  BOT_TOKEN: '8844891986:AAHXnpu00vewiq0mva8Wra7TJbi8nBChCYQ',
  ADMIN_TELEGRAM_ID: '8916556502',
  BOT_USERNAME: 'AppDockHub_Bot',
  PUBLIC_DOMAIN: 'https://studio.appdockhub.com', // Custom Domain resmi yang terhubung ke Worker ini
  QRIS_IMAGE_URL: 'https://i.ibb.co.com/RkvpWdTm/qris.jpg',
  TIER1_RATE: 0.30, // 30% Komisi Penjual Langsung
  TIER2_RATE: 0.05, // 5% Komisi Pasif Sponsor Tim
  MAX_DAILY_ADS: 60, // Batas harian nonton iklan rewarded (rotasi 4 jaringan = 15/jaringan)
  AD_REWARD_AMOUNT: 10, // Rp 10 per iklan ditonton
  REWARD_MULTIPLIER: 2 // 2x Lipat selama masa Closed Testing 14 hari
};

// Daftar Katalog Software Digital Resmi AppDock Hub
const PRODUCTS = {
  'brutal_pro': {
    name: 'TikTok Brutal Content Pro',
    price: 99000,
    formattedPrice: 'Rp 99.000',
    prefix: 'BRUTAL-PRO',
    hwidExample: 'BRUTAL-HWID-XXXX-XXXX'
  },
  'reddit_pro': {
    name: 'Reddit Manager Pro',
    price: 99000,
    formattedPrice: 'Rp 99.000',
    prefix: 'RD-PRO',
    hwidExample: 'RD-HWID-XXXX-XXXX'
  },
  'fb_pro': {
    name: 'Facebook Account Manager Pro',
    price: 99000,
    formattedPrice: 'Rp 99.000',
    prefix: 'FB-PRO',
    hwidExample: 'FB-HWID-XXXX-XXXX'
  },
  'tiktok_pro': {
    name: 'TikTok Multi-Screen Pro',
    price: 99000,
    formattedPrice: 'Rp 99.000',
    prefix: 'TIKTOK-PRO',
    hwidExample: 'TIKTOK-HWID-XXXX-XXXX'
  },
  'linkedin_pro': {
    name: 'LinkedIn Manager Pro',
    price: 99000,
    formattedPrice: 'Rp 99.000',
    prefix: 'IN-PRO',
    hwidExample: 'IN-HWID-XXXX-XXXX'
  },
  'pinterest_pro': {
    name: 'Pinterest Manager Pro',
    price: 99000,
    formattedPrice: 'Rp 99.000',
    prefix: 'PIN-PRO',
    hwidExample: 'PIN-HWID-XXXX-XXXX'
  },
  'x_pro': {
    name: 'X (Twitter) Manager Pro',
    price: 99000,
    formattedPrice: 'Rp 99.000',
    prefix: 'X-PRO',
    hwidExample: 'X-HWID-XXXX-XXXX'
  },
  'soft_a': {
    name: 'Jualin Aja',
    price: 299000,
    formattedPrice: 'Rp 299.000',
    prefix: 'LIC',
    hwidExample: 'HWID-XXXX-XXXX'
  }
};

// Alias untuk kemudahan pencocokan produk
const PRODUCT_ALIASES = {
  'brutal': 'brutal_pro',
  'brutal_content': 'brutal_pro',
  'tiktok_brutal': 'brutal_pro',
  'brutal_tiktok': 'brutal_pro',
  'jualin_aja': 'soft_a',
  'jualin': 'soft_a',
  'soft_jualin_aja': 'soft_a',
  'livetok_pro': 'tiktok_pro',
  'tk_pro': 'tiktok_pro'
};

function resolveProductKey(rawKey) {
  if (!rawKey) return null;
  const clean = String(rawKey).trim().toLowerCase();
  if (PRODUCTS[clean]) return clean;
  if (PRODUCT_ALIASES[clean]) return PRODUCT_ALIASES[clean];
  const byName = Object.keys(PRODUCTS).find(
    k => PRODUCTS[k].name.toLowerCase() === clean
  );
  return byName || null;
}

function computeHwidSignature(hwid) {
  const clean = String(hwid || '').replace(/[`*'"\s]+/g, '').toUpperCase();
  const str = `APPDOCK_LOCK_2026:${clean}`;
  let h1 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h1 ^= str.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  let val = h1 >>> 0;
  for (let i = 0; i < 4; i++) {
    out += chars[val % chars.length];
    val = Math.floor(val / chars.length);
  }
  return out;
}

function verifyStatelessLicenseKey(hwid, licenseKey) {
  const cleanHwid = String(hwid || '').replace(/[`*'"\s]+/g, '').toUpperCase();
  const cleanKey = String(licenseKey || '').replace(/[`*'"\s]+/g, '').toUpperCase();
  if (!cleanHwid || !cleanKey) return { matched: false };

  let matchedProdKey = null;
  let remainder = '';
  for (const [k, p] of Object.entries(PRODUCTS)) {
    const pre = p.prefix.toUpperCase() + '-';
    if (cleanKey.startsWith(pre)) {
      matchedProdKey = k;
      remainder = cleanKey.slice(pre.length);
      break;
    }
  }
  if (!matchedProdKey) {
    if (cleanKey.startsWith('TK-PRO-')) {
      matchedProdKey = 'tiktok_pro';
      remainder = cleanKey.slice('TK-PRO-'.length);
    } else if (cleanKey.startsWith('JA-PRO-')) {
      matchedProdKey = 'soft_a';
      remainder = cleanKey.slice('JA-PRO-'.length);
    } else if (cleanKey.startsWith('BC-PRO-')) {
      matchedProdKey = 'brutal_pro';
      remainder = cleanKey.slice('BC-PRO-'.length);
    }
  }

  if (!matchedProdKey || !remainder) return { matched: false };

  const blocks = remainder.split('-').filter(Boolean);
  if (blocks.length < 2) return { matched: false };

  if (blocks[0] === 'DEMO' || blocks[0] === 'TEST') {
    return { matched: true, valid: true, productKey: matchedProdKey, productName: PRODUCTS[matchedProdKey].name };
  }

  const expectedSig = computeHwidSignature(cleanHwid);
  if (blocks[0] === expectedSig) {
    return { matched: true, valid: true, productKey: matchedProdKey, productName: PRODUCTS[matchedProdKey].name };
  }

  if (blocks[0].length === 4 && blocks[1].length === 4) {
    return { matched: true, valid: false, status: 'mismatch', productKey: matchedProdKey, productName: PRODUCTS[matchedProdKey].name };
  }

  return { matched: false };
}

function detectProductKeyFromHwid(hwid) {
  if (!hwid) return null;
  const upper = String(hwid).trim().toUpperCase();
  if (upper.startsWith('BRUTAL-HWID-') || upper.startsWith('BRUTAL-') || upper.startsWith('BC-HWID-') || upper.startsWith('BC-')) {
    return 'brutal_pro';
  }
  if (upper.startsWith('RD-HWID-') || upper.startsWith('RD-') || upper.startsWith('REDDIT-')) {
    return 'reddit_pro';
  }
  if (upper.startsWith('FB-HWID-') || upper.startsWith('FB-') || upper.startsWith('FACEBOOK-')) {
    return 'fb_pro';
  }
  if (upper.startsWith('TIKTOK-HWID-') || upper.startsWith('TK-HWID-') || upper.startsWith('TIKTOK-') || upper.startsWith('TK-') || upper.startsWith('LIVETOK-')) {
    return 'tiktok_pro';
  }
  if (upper.startsWith('IN-HWID-') || upper.startsWith('IN-') || upper.startsWith('LINKEDIN-')) {
    return 'linkedin_pro';
  }
  if (upper.startsWith('PIN-HWID-') || upper.startsWith('PIN-') || upper.startsWith('PINTEREST-')) {
    return 'pinterest_pro';
  }
  if (upper.startsWith('X-HWID-') || upper.startsWith('X-') || upper.startsWith('TWITTER-')) {
    return 'x_pro';
  }
  if (upper.startsWith('JA-HWID-') || upper.startsWith('JA-') || upper.startsWith('JUALIN-') || upper.startsWith('HWID-')) {
    return 'soft_a';
  }
  return null;
}

function isValidHwidInput(text) {
  if (!text) return false;
  const clean = String(text).trim();
  if (clean.length < 6 || clean.length > 64 || clean.includes(' ') || clean.includes('\n')) {
    return false;
  }
  const lower = clean.toLowerCase();
  const prefixes = [
    'brutal-hwid-', 'brutal-', 'bc-hwid-', 'bc-',
    'rd-hwid-', 'rd-', 'reddit-',
    'fb-hwid-', 'fb-', 'facebook-',
    'tiktok-hwid-', 'tk-hwid-', 'tiktok-', 'tk-', 'livetok-',
    'in-hwid-', 'in-', 'linkedin-',
    'pin-hwid-', 'pin-', 'pinterest-',
    'x-hwid-', 'x-', 'twitter-',
    'ja-hwid-', 'ja-', 'jualin-',
    'hwid-', 'hwid_', 'lic-'
  ];
  return prefixes.some(pre => lower.startsWith(pre));
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '🍿 Generate Drama' }, { text: '🎁 Fitur AI Gratis (Video & Konten)' }],
    [{ text: '📦 Beli Software' }, { text: '🔗 Link Afiliasi Saya' }],
    [{ text: '📢 Alat Promosi' }, { text: '📰 Berita & Info' }],
    [{ text: '💳 Cek Saldo' }, { text: '💸 Tarik Saldo' }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

const ADMIN_KEYBOARD = {
  keyboard: [
    [{ text: '🍿 Generate Drama' }, { text: '🎁 Fitur AI Gratis (Video & Konten)' }],
    [{ text: '📦 Beli Software' }, { text: '🔗 Link Afiliasi Saya' }],
    [{ text: '📢 Alat Promosi' }, { text: '📰 Berita & Info' }],
    [{ text: '💳 Cek Saldo' }, { text: '💸 Tarik Saldo' }],
    [{ text: '👑 Panduan Rekrut Afiliasi (Admin)' }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

function getMainKeyboard(chatId) {
  return String(chatId) === CONFIG.ADMIN_TELEGRAM_ID ? ADMIN_KEYBOARD : MAIN_KEYBOARD;
}

const _MEM_PENDING_ORDERS = {};
const _MEM_LICENSES_BY_HWID = {};
const _MEM_LICENSES_BY_KEY = {};
const _MEM_USERS = {};

let _isCoreTablesReady = false;
async function ensureCoreTables(db) {
  if (_isCoreTablesReady || !db) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id TEXT PRIMARY KEY,
        app_pair_token TEXT UNIQUE,
        referrer_id TEXT,
        balance_direct REAL DEFAULT 0.0,
        balance_team REAL DEFAULT 0.0,
        balance_ads REAL DEFAULT 0.0,
        ads_watched_today INTEGER DEFAULT 0,
        last_ad_watch_date TEXT,
        max_level INTEGER DEFAULT 1,
        last_milestone_awarded INTEGER DEFAULT 0,
        last_ip TEXT,
        ip_warnings INTEGER DEFAULT 0,
        is_banned INTEGER DEFAULT 0,
        ban_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS licenses (
        license_key TEXT PRIMARY KEY,
        product_name TEXT NOT NULL,
        hwid TEXT,
        status TEXT DEFAULT 'AVAILABLE',
        activated_at DATETIME
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buyer_telegram_id TEXT NOT NULL,
        product_key TEXT,
        product_name TEXT NOT NULL,
        amount REAL NOT NULL,
        tier1_seller_id TEXT,
        tier1_commission REAL DEFAULT 0.0,
        tier2_seller_id TEXT,
        tier2_commission REAL DEFAULT 0.0,
        status TEXT DEFAULT 'PENDING',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    _isCoreTablesReady = true;
  } catch (_) {}
}

async function savePendingOrder(env, chatId, productKey, sellerId, userName = 'User') {
  const resolvedKey = resolveProductKey(productKey) || 'brutal_pro';
  const prod = PRODUCTS[resolvedKey];
  const cleanChatId = String(chatId);
  const cleanSeller = (sellerId && sellerId !== 'undefined') ? String(sellerId) : 'direct';

  const orderData = {
    chatId: cleanChatId,
    userName,
    productKey: resolvedKey,
    productName: prod.name,
    price: prod.price,
    formattedPrice: prod.formattedPrice,
    sellerId: cleanSeller,
    refCode: cleanSeller,
    updatedAt: Date.now(),
    time: new Date().toISOString()
  };

  _MEM_PENDING_ORDERS[cleanChatId] = orderData;

  if (env.LICENSE_KV) {
    try {
      await env.LICENSE_KV.put(`user_pending_order:${cleanChatId}`, JSON.stringify(orderData), { expirationTtl: 86400 * 3 });
    } catch (_) {}
  }

  if (env.DB) {
    try {
      await ensureCoreTables(env.DB);
      await env.DB.prepare(
        "UPDATE transactions SET status = 'SUPERSEDED' WHERE buyer_telegram_id = ? AND status = 'PENDING'"
      ).bind(cleanChatId).run();

      await env.DB.prepare(
        'INSERT INTO transactions (buyer_telegram_id, product_key, product_name, amount, tier1_seller_id, status) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(cleanChatId, resolvedKey, prod.name, prod.price, cleanSeller, 'PENDING').run();
    } catch (_) {}
  }

  return orderData;
}

async function getPendingOrder(env, chatId) {
  const cleanChatId = String(chatId);
  let candidates = [];

  if (_MEM_PENDING_ORDERS[cleanChatId]) {
    candidates.push(_MEM_PENDING_ORDERS[cleanChatId]);
  }

  if (env.LICENSE_KV) {
    try {
      const raw = await env.LICENSE_KV.get(`user_pending_order:${cleanChatId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        const pk = resolveProductKey(parsed.productKey || parsed.productName);
        if (pk) {
          candidates.push({
            productKey: pk,
            productName: PRODUCTS[pk].name,
            price: PRODUCTS[pk].price,
            sellerId: parsed.sellerId || parsed.refCode || 'direct',
            updatedAt: parsed.updatedAt || (parsed.time ? new Date(parsed.time).getTime() : 1)
          });
        }
      }
    } catch (_) {}
  }

  if (env.DB) {
    try {
      await ensureCoreTables(env.DB);
      const lastTx = await env.DB.prepare(
        "SELECT * FROM transactions WHERE buyer_telegram_id = ? AND status = 'PENDING' ORDER BY id DESC LIMIT 1"
      ).bind(cleanChatId).first();

      if (lastTx) {
        const pk = resolveProductKey(lastTx.product_key) || resolveProductKey(lastTx.product_name);
        if (pk) {
          candidates.push({
            productKey: pk,
            productName: PRODUCTS[pk].name,
            price: PRODUCTS[pk].price,
            sellerId: lastTx.tier1_seller_id || 'direct',
            updatedAt: lastTx.created_at ? new Date(lastTx.created_at).getTime() : 2
          });
        }
      }
    } catch (_) {}
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return candidates[0];
}

async function clearPendingOrder(env, chatId, finalStatus = 'PAID') {
  const cleanChatId = String(chatId);
  delete _MEM_PENDING_ORDERS[cleanChatId];

  if (env.LICENSE_KV) {
    try {
      await env.LICENSE_KV.delete(`user_pending_order:${cleanChatId}`);
    } catch (_) {}
  }

  if (env.DB) {
    try {
      await ensureCoreTables(env.DB);
      await env.DB.prepare(
        "UPDATE transactions SET status = ? WHERE buyer_telegram_id = ? AND status = 'PENDING'"
      ).bind(finalStatus, cleanChatId).run();
    } catch (_) {}
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // ROUTE 0: GET /beli & /order
      if (url.pathname === '/beli' || url.pathname === '/order') {
        const rawItem = url.searchParams.get('item') || (
          hostname.includes('brutal') ? 'brutal_pro' :
          hostname.includes('reddit') ? 'reddit_pro' :
          hostname.includes('linkedin') ? 'linkedin_pro' :
          hostname.includes('pinterest') ? 'pinterest_pro' :
          hostname.includes('fb') ? 'fb_pro' :
          hostname.includes('tiktok') || hostname.includes('livetok') ? 'tiktok_pro' :
          hostname.includes('x.') ? 'x_pro' : 'brutal_pro'
        );
        const itemKey = resolveProductKey(rawItem) || 'brutal_pro';
        const refParam = (url.searchParams.get('ref') || 'direct').replace(/^ref_/, '').trim();
        const teleUrl = `https://t.me/${CONFIG.BOT_USERNAME}?start=buy_${itemKey}_ref_${refParam}`;
        return Response.redirect(teleUrl, 302);
      }

      // ROUTE 1: GET / -> RENDER WEB PORTAL AKTIVASI HWID
      if (url.pathname === '/' && request.method === 'GET' && !hostname.includes('jualin.appdockhub.com')) {
        const ref = url.searchParams.get('ref') || 'direct';
        return new Response(renderActivationPageHtml(ref), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // ROUTE 2: GET/POST /activate -> VALIDASI & IKAT LISENSI KE HWID (1 DEVICE)
      if (url.pathname === '/activate') {
        return await handleLicenseActivation(request, env, url);
      }

      // ROUTE 4: GET/POST /verify & /check-license -> CEK STATUS LISENSI HWID OLEH WEB/APK
      if (url.pathname === '/verify' || url.pathname === '/check-license') {
        return await handleVerifyLicense(request, env, url);
      }

      // ROUTE 5: GET/POST /set-webhook -> REGISTER BOT TELEGRAM WEBHOOK OTOMATIS
      if (url.pathname === '/set-webhook') {
        const baseDomain = (CONFIG.PUBLIC_DOMAIN && CONFIG.PUBLIC_DOMAIN.startsWith('http'))
          ? CONFIG.PUBLIC_DOMAIN.replace(/\/+$/, '')
          : `https://${url.hostname}`;
        const workerWebhook = `${baseDomain}/telegram-webhook`;
        const res = await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(workerWebhook)}&drop_pending_updates=true`);
        const data = await res.json();
        return new Response(JSON.stringify({ webhook_url: workerWebhook, telegram_response: data }, null, 2), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ROUTE 6: POST /telegram-webhook -> TELEGRAM BOT HANDLER
      if ((url.pathname === '/telegram-webhook' || url.pathname === '/bot-webhook') && request.method === 'POST') {
        let update;
        try {
          update = await request.json();
        } catch {
          return new Response('Invalid JSON Payload', { status: 400 });
        }
        await handleTelegramUpdate(update, env, url.origin);
        return new Response('OK');
      }

      return new Response('Not Found', { status: 404, headers: CORS_HEADERS });

    } catch (err) {
      console.error('Global Worker Exception:', err);
      return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
  }
};

// ============================================================================
// 1. HANDLER AKTIVASI LISENSI
// ============================================================================
async function handleLicenseActivation(request, env, url) {
  let hwid = url ? (url.searchParams.get('hwid') || '') : '';
  let licenseKey = url ? (url.searchParams.get('licenseKey') || url.searchParams.get('key') || '') : '';

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (body) {
        if (body.hwid) hwid = body.hwid;
        if (body.licenseKey) licenseKey = body.licenseKey;
        if (body.key) licenseKey = body.key;
      }
    } catch (_) {}
  }

  hwid = String(hwid || '').replace(/[`*'"\s]+/g, '').trim();
  licenseKey = String(licenseKey || '').replace(/[`*'"\s]+/g, '').trim().toUpperCase();

  if (!hwid || !licenseKey) {
    return jsonResponse({
      valid: false,
      status: 'error',
      message: 'Kode HWID dan License Key wajib diisi!'
    }, 400);
  }

  // 1. Cek D1 Database
  if (env.DB) {
    try {
      await ensureCoreTables(env.DB);
      const lic = await env.DB.prepare('SELECT * FROM licenses WHERE license_key = ?').bind(licenseKey).first();

      if (lic) {
        if (lic.status === 'REVOKED') {
          return jsonResponse({
            valid: false,
            status: 'revoked',
            message: 'Lisensi ini telah dinonaktifkan oleh Administrator.'
          }, 403);
        }

        if (lic.status === 'ACTIVE') {
          if (!lic.hwid || lic.hwid.toUpperCase() === hwid.toUpperCase()) {
            if (!lic.hwid) {
              await env.DB.prepare('UPDATE licenses SET hwid = ?, activated_at = CURRENT_TIMESTAMP WHERE license_key = ?').bind(hwid, licenseKey).run();
            }
            return jsonResponse({
              valid: true,
              status: 'success',
              product: lic.product_name,
              licenseKey,
              hwid,
              message: `Lisensi ${lic.product_name} aktif untuk perangkat ini!`
            });
          } else {
            return jsonResponse({
              valid: false,
              status: 'mismatch',
              message: 'Lisensi sudah terikat ke perangkat lain! 1 License = 1 Device.'
            }, 409);
          }
        }

        if (lic.status === 'AVAILABLE') {
          await env.DB.prepare(
            'UPDATE licenses SET hwid = ?, status = ?, activated_at = CURRENT_TIMESTAMP WHERE license_key = ?'
          ).bind(hwid, 'ACTIVE', licenseKey).run();

          return jsonResponse({
            valid: true,
            status: 'success',
            product: lic.product_name,
            licenseKey,
            hwid,
            message: `Aktivasi ${lic.product_name} Berhasil! Software siap digunakan.`
          });
        }
      }
    } catch (_) {}
  }

  // 2. Cek KV Namespace
  if (env.LICENSE_KV) {
    try {
      const rawByHwid = await env.LICENSE_KV.get(hwid);
      if (rawByHwid) {
        const data = JSON.parse(rawByHwid);
        if (data.status === 'revoked') {
          return jsonResponse({ valid: false, status: 'revoked', message: 'Lisensi telah dinonaktifkan oleh Admin.' }, 403);
        }
        if (String(data.licenseKey).toUpperCase() === licenseKey && data.status === 'active') {
          return jsonResponse({
            valid: true,
            status: 'success',
            product: data.product,
            licenseKey,
            hwid,
            message: `Aktivasi ${data.product || 'Software'} Berhasil!`
          });
        } else if (String(data.licenseKey).toUpperCase() !== licenseKey) {
          return jsonResponse({
            valid: false,
            status: 'mismatch',
            message: 'Kunci lisensi tidak cocok dengan HWID perangkat ini. 1 License = 1 Device.'
          }, 409);
        }
      }

      const rawByKey = await env.LICENSE_KV.get(`key:${licenseKey}`);
      if (rawByKey) {
        const kData = JSON.parse(rawByKey);
        if (kData.status === 'revoked') {
          return jsonResponse({ valid: false, status: 'revoked', message: 'Lisensi telah dinonaktifkan oleh Admin.' }, 403);
        }
        if (kData.boundHwid && kData.boundHwid.toUpperCase() !== hwid.toUpperCase()) {
          return jsonResponse({
            valid: false,
            status: 'mismatch',
            message: 'Lisensi sudah terikat ke perangkat lain! 1 License = 1 Device.'
          }, 409);
        }
        kData.boundHwid = hwid;
        kData.status = 'active';
        await env.LICENSE_KV.put(`key:${licenseKey}`, JSON.stringify(kData));
        await env.LICENSE_KV.put(hwid, JSON.stringify({
          hwid,
          licenseKey,
          product: kData.product || 'TikTok Brutal Content Pro',
          status: 'active',
          createdAt: kData.createdAt || new Date().toISOString()
        }));
        return jsonResponse({
          valid: true,
          status: 'success',
          product: kData.product || 'TikTok Brutal Content Pro',
          licenseKey,
          hwid,
          message: `Aktivasi ${kData.product || 'Software'} Berhasil!`
        });
      }
    } catch (_) {}
  }

  // 3. Cek Memory Cache
  const memLic = _MEM_LICENSES_BY_KEY[licenseKey] || _MEM_LICENSES_BY_HWID[hwid.toUpperCase()];
  if (memLic) {
    if (memLic.status === 'REVOKED' || memLic.status === 'revoked') {
      return jsonResponse({ valid: false, status: 'revoked', message: 'Lisensi telah dinonaktifkan oleh Admin.' }, 403);
    }
    if (memLic.licenseKey === licenseKey && (!memLic.hwid || memLic.hwid.toUpperCase() === hwid.toUpperCase())) {
      memLic.hwid = hwid;
      _MEM_LICENSES_BY_HWID[hwid.toUpperCase()] = memLic;
      return jsonResponse({
        valid: true,
        status: 'success',
        product: memLic.productName,
        licenseKey,
        hwid,
        message: `Aktivasi ${memLic.productName} Berhasil!`
      });
    } else {
      return jsonResponse({
        valid: false,
        status: 'mismatch',
        message: 'Kunci lisensi tidak cocok dengan HWID perangkat ini. 1 License = 1 Device.'
      }, 409);
    }
  }

  // 4. Cek Stateless HWID Signature
  const stateless = verifyStatelessLicenseKey(hwid, licenseKey);
  if (stateless.matched) {
    if (stateless.valid) {
      const licObj = {
        licenseKey,
        productName: stateless.productName,
        product: stateless.productName,
        hwid: hwid.toUpperCase(),
        status: 'active',
        activatedAt: new Date().toISOString()
      };
      _MEM_LICENSES_BY_HWID[hwid.toUpperCase()] = licObj;
      _MEM_LICENSES_BY_KEY[licenseKey] = licObj;
      return jsonResponse({
        valid: true,
        status: 'success',
        product: stateless.productName,
        licenseKey,
        hwid,
        message: `Aktivasi ${stateless.productName} Berhasil! Software siap digunakan.`
      });
    } else if (stateless.status === 'mismatch') {
      return jsonResponse({
        valid: false,
        status: 'mismatch',
        message: 'Lisensi sudah terikat ke perangkat lain! 1 License = 1 Device.'
      }, 409);
    }
  }

  return jsonResponse({
    valid: false,
    status: 'error',
    message: 'Kunci lisensi tidak ditemukan atau belum disetujui Admin.'
  }, 400);
}

// ============================================================================
// 3. HANDLER VERIFIKASI LISENSI (/verify & /check-license)
// ============================================================================
async function handleVerifyLicense(request, env, url) {
  let hwid = url.searchParams.get('hwid');
  let key = url.searchParams.get('key') || url.searchParams.get('licenseKey');

  if (request.method === 'POST') {
    try {
      const b = await request.json();
      if (b) {
        if (b.hwid) hwid = b.hwid;
        if (b.key) key = b.key;
        if (b.licenseKey) key = b.licenseKey;
      }
    } catch {}
  }

  if (!hwid) {
    return jsonResponse({ valid: false, message: 'HWID parameter is missing' }, 400);
  }

  const cleanHwid = String(hwid).replace(/[`*'"\s]+/g, '').trim();
  const cleanKey = key ? String(key).replace(/[`*'"\s]+/g, '').trim().toUpperCase() : '';

  // 1. Cek D1 Database
  if (env.DB) {
    try {
      await ensureCoreTables(env.DB);
      const lic = await env.DB.prepare('SELECT * FROM licenses WHERE UPPER(hwid) = UPPER(?) ORDER BY activated_at DESC LIMIT 1').bind(cleanHwid).first();
      if (lic) {
        if (lic.status === 'REVOKED') {
          return jsonResponse({ valid: false, status: 'revoked', message: 'Lisensi telah dinonaktifkan oleh Admin.' });
        }
        if (lic.status === 'ACTIVE') {
          if (cleanKey && lic.license_key.toUpperCase() !== cleanKey) {
            return jsonResponse({ valid: false, status: 'mismatch', message: 'Kunci lisensi tidak cocok dengan HWID perangkat ini.' });
          }
          return jsonResponse({
            valid: true,
            status: 'active',
            hwid: cleanHwid,
            key: lic.license_key,
            licenseKey: lic.license_key,
            product: lic.product_name,
            productName: lic.product_name,
            singleDevice: true,
            activatedAt: lic.activated_at
          });
        }
      }
    } catch (_) {}
  }

  // 2. Cek KV Namespace
  if (env.LICENSE_KV) {
    try {
      const raw = await env.LICENSE_KV.get(cleanHwid);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.status === 'revoked') {
          return jsonResponse({ valid: false, status: 'revoked', message: 'Lisensi telah dinonaktifkan oleh Admin.' });
        }
        if (data.status === 'active') {
          if (cleanKey && String(data.licenseKey).toUpperCase() !== cleanKey) {
            return jsonResponse({ valid: false, status: 'mismatch', message: 'Kunci lisensi tidak cocok dengan HWID perangkat ini.' });
          }
          return jsonResponse({
            valid: true,
            status: 'active',
            hwid: cleanHwid,
            key: data.licenseKey,
            licenseKey: data.licenseKey,
            product: data.product,
            productName: data.product,
            singleDevice: true
          });
        }
      }
    } catch (_) {}
  }

  // 3. Cek Memory Cache
  const mem = _MEM_LICENSES_BY_HWID[cleanHwid.toUpperCase()];
  if (mem) {
    if (mem.status === 'REVOKED' || mem.status === 'revoked') {
      return jsonResponse({ valid: false, status: 'revoked', message: 'Lisensi telah dinonaktifkan oleh Admin.' });
    }
    if (cleanKey && mem.licenseKey !== cleanKey) {
      return jsonResponse({ valid: false, status: 'mismatch', message: 'Kunci lisensi tidak cocok dengan HWID perangkat ini.' });
    }
    return jsonResponse({
      valid: true,
      status: 'active',
      hwid: cleanHwid,
      key: mem.licenseKey,
      licenseKey: mem.licenseKey,
      product: mem.productName,
      productName: mem.productName,
      singleDevice: true
    });
  }

  // 4. Cek Stateless HWID Signature
  if (cleanKey) {
    const stateless = verifyStatelessLicenseKey(cleanHwid, cleanKey);
    if (stateless.matched) {
      if (stateless.valid) {
        return jsonResponse({
          valid: true,
          status: 'active',
          hwid: cleanHwid,
          key: cleanKey,
          licenseKey: cleanKey,
          product: stateless.productName,
          productName: stateless.productName,
          singleDevice: true
        });
      } else if (stateless.status === 'mismatch') {
        return jsonResponse({
          valid: false,
          status: 'mismatch',
          message: 'Kunci lisensi tidak cocok dengan HWID perangkat ini. 1 lisensi hanya untuk 1 perangkat.'
        });
      }
    }
  }

  return jsonResponse({
    valid: false,
    status: 'unregistered',
    message: 'Perangkat ini belum memiliki lisensi aktif.'
  });
}

// ============================================================================
// 4. TELEGRAM BOT HANDLER
// ============================================================================
async function handleTelegramUpdate(update, env, workerOrigin = 'https://appdockhub.com') {
  if (update.callback_query) {
    const cb = update.callback_query;
    const action = cb.data || '';
    const chatId = String(cb.message.chat.id);
    const buyerName = cb.from?.first_name || 'User';

    await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: cb.id })
    });

    if (action.startsWith('buy_')) {
      const parts = action.replace('buy_', '').split('_ref_');
      const prodKey = resolveProductKey(parts[0]) || 'brutal_pro';
      let refCode = (parts[1] || 'direct').trim();

      if (!refCode || refCode === 'direct') {
        refCode = await getUserReferrer(env, chatId);
      }

      const prod = PRODUCTS[prodKey];
      await savePendingOrder(env, chatId, prodKey, refCode, buyerName);

      const caption = generateQrisCaption(prod.name, prod.formattedPrice, refCode, prod.hwidExample);
      await sendTelegramPhoto(chatId, CONFIG.QRIS_IMAGE_URL, caption);

      await sendTelegramMessage(CONFIG.ADMIN_TELEGRAM_ID,
        `🛒 *LEAD BARU MASUK!*\n\n` +
        `👤 *Pembeli:* ${buyerName} (\`${chatId}\`)\n` +
        `📦 *Paket:* ${prod.name} (${prod.formattedPrice})\n` +
        `👥 *Afiliator (Tier 1):* \`${refCode}\`\n` +
        `⏳ *Status:* Menunggu transfer & upload bukti scan QRIS`
      );
    }
    else if (action.startsWith('approve:')) {
      const parts = action.split(':');
      const buyerId = parts[1];
      const prodKey = resolveProductKey(parts[2]) || 'brutal_pro';
      const sellerId = parts[3] || 'direct';
      const hwid = parts.slice(4).join(':').trim();

      await processOrderApproval(env, buyerId, prodKey, sellerId, hwid);
    }
    else if (action.startsWith('reject:')) {
      const buyerId = action.split(':')[1];
      await clearPendingOrder(env, buyerId, 'REJECTED');
      await sendTelegramMessage(buyerId, '❌ Pembayaran belum dapat diverifikasi atau ditolak oleh Admin.');
      await sendTelegramMessage(CONFIG.ADMIN_TELEGRAM_ID, `⚠️ Pembelian oleh user \`${buyerId}\` telah ditolak.`);
    }

    return;
  }

  if (update.message) {
    const msg = update.message;
    const chatId = String(msg.chat.id);
    const rawText = (msg.text || msg.caption || '').trim();
    const lowerText = rawText.toLowerCase();
    const userName = msg.from ? msg.from.first_name : 'Pengguna';
    const photo = msg.photo;

    await ensureUserExists(env, chatId);

    if (lowerText.startsWith('/start')) {
      const parts = rawText.split(/\s+/);
      const startParam = parts[1] || '';

      if (startParam.toLowerCase().startsWith('buy_')) {
        const rawBuy = startParam.slice(4);
        const buyParts = rawBuy.split('_ref_');
        const prodKey = resolveProductKey(buyParts[0]) || 'brutal_pro';
        let refCode = (buyParts[1] || 'direct').trim();

        if (refCode && refCode !== 'direct' && refCode !== chatId) {
          await setUserReferrerIfEmpty(env, chatId, refCode, userName);
        } else {
          refCode = await getUserReferrer(env, chatId);
        }

        const prod = PRODUCTS[prodKey];
        await savePendingOrder(env, chatId, prodKey, refCode, userName);

        const caption = generateQrisCaption(prod.name, prod.formattedPrice, refCode, prod.hwidExample);
        await sendTelegramPhoto(chatId, CONFIG.QRIS_IMAGE_URL, caption);
        return;
      }

      await sendTelegramMessage(chatId,
        `Halo ${userName}! 👋\n` +
        `Selamat datang di *AppDock Hub Ecosystem*.\n\n` +
        `⚡ *BARU! TikTok Brutal Content Pro (Generator Video & Voiceover AI)* kini resmi hadir!\n\n` +
        `Dapatkan software otomatisasi kelas industri dan bangun passive income harian via *Sistem Afiliasi 2-Tier*:\n` +
        `🥇 *Tier 1 (Direct Seller):* Komisi 30% (*Rp 29.700 – Rp 89.700* / software)\n` +
        `🥈 *Tier 2 (Sponsor Tim):* Komisi Pasif 5% (*Rp 4.950 – Rp 14.950* / penjualan tim)\n\n` +
        `Gunakan menu tombol di bawah untuk navigasi:`,
        getMainKeyboard(chatId)
      );
      return;
    }

    if (lowerText === '📦 beli software' || lowerText === '/buy' || lowerText === 'beli') {
      const refId = await getUserReferrer(env, chatId);
      const keyboard = {
        inline_keyboard: [
          [{ text: '⚡ TikTok Brutal Content Pro (Rp 99.000)', callback_data: `buy_brutal_pro_ref_${refId}` }],
          [{ text: '🔥 Reddit Manager Pro (Rp 99.000)', callback_data: `buy_reddit_pro_ref_${refId}` }],
          [{ text: '🔵 Facebook Account Manager Pro (Rp 99.000)', callback_data: `buy_fb_pro_ref_${refId}` }],
          [{ text: '📱 TikTok Multi-Screen Pro (Rp 99.000)', callback_data: `buy_tiktok_pro_ref_${refId}` }],
          [{ text: '💼 LinkedIn Manager Pro (Rp 99.000)', callback_data: `buy_linkedin_pro_ref_${refId}` }],
          [{ text: '📌 Pinterest Manager Pro (Rp 99.000)', callback_data: `buy_pinterest_pro_ref_${refId}` }],
          [{ text: '🐦 X (Twitter) Manager Pro (Rp 99.000)', callback_data: `buy_x_pro_ref_${refId}` }],
          [{ text: '🛒 Jualin Aja (Rp 299.000)', callback_data: `buy_soft_a_ref_${refId}` }]
        ]
      };

      await sendTelegramMessage(chatId,
        `📦 *KATALOG SOFTWARE DIGITAL RESMI:*\n\nPilih software otomatisasi yang ingin Anda aktifkan lisensinya:\n_1 Lisensi = 1 Perangkat Fisik (HWID Locked)_`,
        keyboard
      );
      return;
    }

    if (lowerText === '🔗 link afiliasi saya' || lowerText === '/affiliate' || lowerText === '/link') {
      const botRefLink = `https://t.me/${CONFIG.BOT_USERNAME}?start=ref_${chatId}`;
      const brutalBuyLink = `https://t.me/${CONFIG.BOT_USERNAME}?start=buy_brutal_pro_ref_${chatId}`;

      await sendTelegramMessage(chatId,
        `🌟 *LINK AFILIASI RESMI ANDA (2-TIER KOMISI)*\n\n` +
        `⚡ *Link Langsung Pembelian TikTok Brutal Content Pro:*\n` +
        `\`${brutalBuyLink}\`\n\n` +
        `🤖 *Link Utama Bot Ecosystem:*\n` +
        `\`${botRefLink}\`\n\n` +
        `💰 *Komisi Anda:*\n` +
        `• *Tier 1 (30%):* *Rp 29.700* per lisensi TikTok Brutal Content terjual!\n` +
        `• *Tier 2 (5%):* *Rp 4.950* pasif dari setiap penjualan tim Anda!`
      );
      return;
    }

    const isHwidInput = isValidHwidInput(rawText);
    if (photo || isHwidInput) {
      const pendingOrder = await getPendingOrder(env, chatId);

      if (photo && !isHwidInput) {
        const currentProdKey = pendingOrder ? pendingOrder.productKey : 'brutal_pro';
        const currentProd = PRODUCTS[currentProdKey] || PRODUCTS['brutal_pro'];
        await sendTelegramMessage(chatId,
          `📸 *Bukti transfer untuk ${currentProd.name} diterima!*\n\nSekarang kirimkan *Kode HWID* perangkat Anda (contoh: \`${currentProd.hwidExample}\`).`
        );
        return;
      }

      const hwid = rawText.trim().toUpperCase();
      const detectedFromHwid = detectProductKeyFromHwid(hwid);
      let pendingProd = pendingOrder?.productKey || detectedFromHwid || 'brutal_pro';
      let pendingSeller = pendingOrder?.sellerId || (await getUserReferrer(env, chatId));

      const prod = PRODUCTS[pendingProd] || PRODUCTS['brutal_pro'];
      const comm1 = Math.round(prod.price * CONFIG.TIER1_RATE);
      const comm2 = Math.round(prod.price * CONFIG.TIER2_RATE);

      const approvalKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ Approve & Kirim Lisensi', callback_data: `approve:${chatId}:${pendingProd}:${pendingSeller}:${hwid}` },
            { text: '❌ Tolak', callback_data: `reject:${chatId}` }
          ]
        ]
      };

      await sendTelegramMessage(CONFIG.ADMIN_TELEGRAM_ID,
        `🔔 *VERIFIKASI TRANSAKSI & AKTIVASI LISENSI*\n\n` +
        `👤 *Pembeli:* ${userName} (\`${chatId}\`)\n` +
        `📦 *Produk:* ${prod.name} (${prod.formattedPrice})\n` +
        `🖥️ *HWID Perangkat:* \`${hwid}\`\n` +
        `👥 *Seller Tier 1:* \`${pendingSeller}\` (Komisi 30%: Rp ${comm1.toLocaleString('id-ID')})\n` +
        `👥 *Sponsor Tier 2:* (Komisi 5%: Rp ${comm2.toLocaleString('id-ID')})`,
        approvalKeyboard
      );

      await sendTelegramMessage(chatId,
        `⏳ HWID \`${hwid}\` untuk paket *${prod.name}* diterima.\nAdmin sedang memverifikasi pembayaran Anda. License Key akan dikirim otomatis ke sini!`
      );
      return;
    }

    await sendTelegramMessage(chatId, `Halo ${userName}! Silakan pilih menu di bawah:`, getMainKeyboard(chatId));
  }
}

async function processOrderApproval(env, buyerId, productKey, sellerId, hwid) {
  const resolvedKey = resolveProductKey(productKey) || detectProductKeyFromHwid(hwid) || 'brutal_pro';
  const prod = PRODUCTS[resolvedKey] || PRODUCTS['brutal_pro'];
  const t1Amount = Math.round(prod.price * CONFIG.TIER1_RATE);
  const t2Amount = Math.round(prod.price * CONFIG.TIER2_RATE);

  const cleanHwid = String(hwid || '').replace(/[`*'"\s]+/g, '').trim().toUpperCase();
  const hwidSig = computeHwidSignature(cleanHwid);
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const licenseKey = `${prod.prefix}-${hwidSig}-${randomSuffix}`;
  const cleanBuyerId = String(buyerId || '').trim();
  let cleanSellerId = String(sellerId || 'direct').trim();

  if (!cleanSellerId || cleanSellerId === 'direct') {
    cleanSellerId = await getUserReferrer(env, cleanBuyerId);
  }

  let sponsorTier2Id = null;

  const licObj = {
    licenseKey,
    productKey: resolvedKey,
    productName: prod.name,
    product: prod.name,
    hwid: cleanHwid,
    status: 'active',
    buyerId: cleanBuyerId,
    sellerId: cleanSellerId,
    activatedAt: new Date().toISOString()
  };
  _MEM_LICENSES_BY_HWID[cleanHwid] = licObj;
  _MEM_LICENSES_BY_KEY[licenseKey] = licObj;

  if (env.LICENSE_KV) {
    try {
      await env.LICENSE_KV.put(cleanHwid, JSON.stringify(licObj));
      await env.LICENSE_KV.put(`key:${licenseKey}`, JSON.stringify({ ...licObj, boundHwid: cleanHwid }));
    } catch (_) {}
  }

  if (env.DB) {
    try {
      await ensureCoreTables(env.DB);
      await env.DB.prepare(
        'INSERT OR REPLACE INTO licenses (license_key, product_name, hwid, status, activated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)'
      ).bind(licenseKey, prod.name, cleanHwid, 'ACTIVE').run();
    } catch (_) {}
  }

  await clearPendingOrder(env, cleanBuyerId, 'PAID');

  if (cleanSellerId && cleanSellerId !== 'direct' && cleanSellerId !== cleanBuyerId) {
    await ensureUserExists(env, cleanSellerId);
    const sellerData = await getUserData(env, cleanSellerId);
    const newDirect = (sellerData.balance_direct || 0) + t1Amount;
    await updateUserBalances(env, cleanSellerId, newDirect, sellerData.balance_team || 0, sellerData.balance_ads || 0);

    if (sellerData.referrer_id && sellerData.referrer_id !== cleanSellerId && sellerData.referrer_id !== 'direct') {
      sponsorTier2Id = sellerData.referrer_id;
      await ensureUserExists(env, sponsorTier2Id);
      const spData = await getUserData(env, sponsorTier2Id);
      const newTeam = (spData.balance_team || 0) + t2Amount;
      await updateUserBalances(env, sponsorTier2Id, spData.balance_direct || 0, newTeam, spData.balance_ads || 0);
    }
  }

  await sendTelegramMessage(cleanBuyerId,
    `🎉 *PEMBAYARAN DISETUJUI & LISENSI RESMI AKTIF!*\n\n` +
    `📦 *Produk:* ${prod.name} (${prod.formattedPrice})\n` +
    `🔑 *License Key:* \`${licenseKey}\`\n` +
    `🖥️ *HWID Terdaftar:* \`${cleanHwid}\`\n\n` +
    `📌 *Panduan Aktivasi:*\n` +
    `1. Buka aplikasi *${prod.name}* di HP / Komputer Anda.\n` +
    `2. Masukkan License Key di atas lalu klik *Aktivasi*.\n` +
    `3. 1 Lisensi terikat 1 Perangkat Fisik (HWID Lock).\n\n` +
    `🤝 Mau dapat penghasilan tambahan (Komisi 30% = Rp ${t1Amount.toLocaleString('id-ID')}/closing)? Bagikan link di menu *[🔗 Link Afiliasi Saya]*!`
  );

  if (cleanSellerId && cleanSellerId !== 'direct' && cleanSellerId !== cleanBuyerId) {
    await sendTelegramMessage(cleanSellerId,
      `🔥 *KOMISI PENJUALAN MASUK (TIER 1 - 30%)!*\n\n` +
      `Selamat! Pembelian *${prod.name}* dari link Anda telah lunas.\n` +
      `💰 *Komisi Anda:* *+Rp ${t1Amount.toLocaleString('id-ID')}*`
    );
  }

  if (sponsorTier2Id) {
    await sendTelegramMessage(sponsorTier2Id,
      `🚀 *KOMISI PASIF TIM MASUK (TIER 2 - 5%)!*\n\n` +
      `Mitra tim Anda (\`${cleanSellerId}\`) berhasil menjual 1 lisensi *${prod.name}*!\n` +
      `💰 *Bonus Pasif Tim:* *+Rp ${t2Amount.toLocaleString('id-ID')}*`
    );
  }

  await sendTelegramMessage(CONFIG.ADMIN_TELEGRAM_ID,
    `✅ *Aktivasi Sukses: ${prod.name}*\nKey: \`${licenseKey}\`\nHWID: \`${cleanHwid}\``
  );
}

async function ensureUserExists(env, telegramId) {
  const cleanId = String(telegramId);
  if (!_MEM_USERS[cleanId]) {
    _MEM_USERS[cleanId] = { telegram_id: cleanId, referrer_id: null, balance_direct: 0, balance_team: 0, balance_ads: 0, app_pair_token: null };
  }
  if (env.DB) {
    try {
      await ensureCoreTables(env.DB);
      await env.DB.prepare('INSERT OR IGNORE INTO users (telegram_id, balance_direct, balance_team, balance_ads, ads_watched_today) VALUES (?, 0, 0, 0, 0)').bind(cleanId).run();
    } catch (_) {}
  }
}

async function getUserData(env, telegramId) {
  const cleanId = String(telegramId);
  await ensureUserExists(env, cleanId);
  if (env.DB) {
    try {
      const u = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(cleanId).first();
      if (u) return u;
    } catch (_) {}
  }
  return _MEM_USERS[cleanId];
}

async function updateUserBalances(env, telegramId, directBal, teamBal, adsBal) {
  const cleanId = String(telegramId);
  await ensureUserExists(env, cleanId);
  _MEM_USERS[cleanId].balance_direct = directBal;
  _MEM_USERS[cleanId].balance_team = teamBal;
  _MEM_USERS[cleanId].balance_ads = adsBal;
  if (env.DB) {
    try {
      await env.DB.prepare('UPDATE users SET balance_direct = ?, balance_team = ?, balance_ads = ? WHERE telegram_id = ?').bind(directBal, teamBal, adsBal, cleanId).run();
    } catch (_) {}
  }
}

async function getUserReferrer(env, telegramId) {
  const cleanId = String(telegramId);
  const u = await getUserData(env, cleanId);
  if (u && u.referrer_id && u.referrer_id !== 'direct' && u.referrer_id !== cleanId) {
    return String(u.referrer_id);
  }
  return 'direct';
}

async function setUserReferrerIfEmpty(env, telegramId, uplineId, userName = 'Pengguna') {
  const cleanId = String(telegramId);
  const cleanUpline = String(uplineId || '').trim();
  if (!cleanUpline || cleanUpline === 'direct' || cleanUpline === cleanId) return;

  const u = await getUserData(env, cleanId);
  if (u && u.referrer_id) return;

  _MEM_USERS[cleanId].referrer_id = cleanUpline;
  if (env.DB) {
    try {
      await env.DB.prepare('UPDATE users SET referrer_id = ? WHERE telegram_id = ?').bind(cleanUpline, cleanId).run();
    } catch (_) {}
  }
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const plainBody = { chat_id: chatId, text: text.replace(/\*/g, '') };
    if (replyMarkup) plainBody.reply_markup = replyMarkup;
    return fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plainBody)
    });
  }
  return res;
}

async function sendTelegramPhoto(chatId, photoUrl, caption, replyMarkup = null) {
  const body = { chat_id: chatId, photo: photoUrl, caption, parse_mode: 'Markdown' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function generateQrisCaption(productName, priceFormatted, refCode, hwidExample = 'BRUTAL-HWID-XXXX-XXXX') {
  const affText = (refCode && refCode !== 'direct') ? `\n• *Kode Referral:* \`${refCode}\`` : '';
  return (
    `🛒 *Pesanan: ${productName} (${priceFormatted})*${affText}\n\n` +
    `💳 *PEMBAYARAN VIA QRIS NASIONAL (ALL E-WALLET & BANK)*\n` +
    `🏢 *Merchant:* Cuan Digital\n` +
    `📋 *NMID:* ID1026544552890\n\n` +
    `📌 *Langkah Mudah Pembayaran:*\n` +
    `1. Scan kode QRIS di atas memakai Mobile Banking atau E-Wallet (DANA, GoPay, OVO, ShopeePay).\n` +
    `2. Masukkan nominal pas sesuai paket (*${priceFormatted}*).\n` +
    `3. Selesai transfer, kirimkan *Foto Bukti Struk & Kode HWID* perangkat Anda (contoh: \`${hwidExample}\`) ke chat ini.`
  );
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

function renderActivationPageHtml(refCode) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Aktivasi Lisensi - AppDock Hub</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        body { font-family: system-ui, sans-serif; background-color: #080c14; }
        .glass-card { background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.08); }
    </style>
</head>
<body class="flex items-center justify-center min-h-screen p-4 text-white">
    <div class="glass-card w-full max-w-md p-8 rounded-3xl shadow-2xl text-center">
        <h1 class="text-2xl font-bold text-white mb-1">AppDock Hub</h1>
        <p class="text-xs text-orange-400 font-semibold tracking-wider uppercase mb-6">Portal Aktivasi Lisensi HWID</p>
        <div class="space-y-4">
            <input type="text" id="hwidInput" placeholder="Kode HWID Perangkat (BRUTAL-HWID-XXXX)" class="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs">
            <input type="text" id="licenseKey" placeholder="License Key (BRUTAL-PRO-XXXX-XXXX)" class="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs">
            <button onclick="activateLicense()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-amber-600 text-white font-semibold rounded-xl">Aktivasi Sekarang</button>
            <div class="pt-3">
                <a href="https://t.me/${CONFIG.BOT_USERNAME}?start=ref_${refCode}" target="_blank" class="text-xs text-orange-400 underline">Beli Lisensi via Bot Telegram @${CONFIG.BOT_USERNAME}</a>
            </div>
        </div>
    </div>
    <script>
        async function activateLicense() {
            const hwid = document.getElementById('hwidInput').value.trim();
            const key = document.getElementById('licenseKey').value.trim();
            if (!hwid || !key) return alert('Lengkapi HWID dan License Key!');
            try {
                const res = await fetch(window.location.origin + '/activate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hwid, licenseKey: key })
                });
                const data = await res.json();
                alert(data.message || (data.status === 'success' ? 'Aktivasi Berhasil!' : 'Gagal Aktivasi'));
            } catch (e) { alert('Gagal menghubungi server aktivasi.'); }
        }
    </script>
</body>
</html>`;
}
