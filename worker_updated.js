/**
 * APPDOCK HUB ECOSYSTEM - CLOUDFLARE WORKER (index.js)
 * Architecture: Cloudflare Workers + D1 Database (SQLite) + KV & Memory Fallback + Telegram Webhook
 * Multi-Product License Manager, 2-Tier Affiliate System, Rewarded Ads Quota Engine
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
  REWARD_MULTIPLIER: 2 // 2x Lipat selama masa Closed Testing 14 hari (ubah ke 1 setelah rilis Production)
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
  'bc_pro': 'brutal_pro',
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
  // Cari berdasarkan nama produk
  const byName = Object.keys(PRODUCTS).find(
    k => PRODUCTS[k].name.toLowerCase() === clean
  );
  return byName || null;
}

/**
 * Menghasilkan 4 karakter signature deterministik dari HWID (Stateless 1-Device Lock)
 * Memastikan 1 License = 1 Device tetap bekerja 100% akurat lintas isolate/cold-start
 * bahkan jika D1 Database atau KV belum di-bind di dashboard Cloudflare.
 */
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

/**
 * Validasi apakah licenseKey memiliki format resmi dan cocok dengan signature HWID
 */
function verifyStatelessLicenseKey(hwid, licenseKey) {
  const cleanHwid = String(hwid || '').replace(/[`*'"\s]+/g, '').toUpperCase();
  const cleanKey = String(licenseKey || '').replace(/[`*'"\s]+/g, '').toUpperCase();
  if (!cleanHwid || !cleanKey) return { matched: false };

  // Cari produk berdasarkan prefix licenseKey
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
    }
  }

  if (!matchedProdKey || !remainder) return { matched: false };

  const blocks = remainder.split('-').filter(Boolean);
  if (blocks.length < 2) return { matched: false };

  // Demo keys tetap diizinkan jika eksplisit DEMO
  if (blocks[0] === 'DEMO') {
    return { matched: true, valid: true, productKey: matchedProdKey, productName: PRODUCTS[matchedProdKey].name };
  }

  const expectedSig = computeHwidSignature(cleanHwid);
  if (blocks[0] === expectedSig) {
    return { matched: true, valid: true, productKey: matchedProdKey, productName: PRODUCTS[matchedProdKey].name };
  }

  // Jika format key adalah key bertanda tangan tetapi digunakan di HWID berbeda -> Mismatch (1 License = 1 Device)
  if (blocks[0].length === 4 && blocks[1].length === 4) {
    return { matched: true, valid: false, status: 'mismatch', productKey: matchedProdKey, productName: PRODUCTS[matchedProdKey].name };
  }

  return { matched: false };
}

/**
 * Deteksi produk secara akurat berdasarkan format prefix HWID masing-masing aplikasi:
 * - RD-HWID-...      -> reddit_pro (Reddit Manager Pro)
 * - FB-HWID-...      -> fb_pro (Facebook Account Manager Pro)
 * - TIKTOK-HWID-...  -> tiktok_pro (TikTok Multi-Screen Pro)
 * - IN-HWID-...      -> linkedin_pro (LinkedIn Manager Pro)
 * - PIN-HWID-...     -> pinterest_pro (Pinterest Manager Pro)
 * - X-HWID-...       -> x_pro (X / Twitter Manager Pro)
 * - HWID-... / JA-   -> soft_a (Jualin Aja)
 */
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

/**
 * Cek apakah string yang dikirim user adalah format kode HWID perangkat
 */
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

// ============================================================================
// 🎬 KONFIGURASI PRESET MOTION CONTROL & AI STUDIO GRATIS
// ============================================================================
const MOTION_PRESETS = {
  'zoom_gold': {
    label: '🔍 Cinematic Zoom-In + Gold Particles',
    name: '🔍 Cinematic Zoom-In + Gold Particles',
    desc: 'Kamera bergerak maju perlahan (Dolly Zoom-In) dengan efek partikel cahaya emas mewah.',
    camera: 'Dolly Zoom-In Halus (Slow Cinematic Push)',
    fx: 'Partikel Debu Emas Mewah (Golden Bokeh)'
  },
  'orbit_neon': {
    label: '🌀 3D Orbit Parallax + Cyber Neon',
    name: '🌀 3D Orbit Parallax + Cyber Neon',
    desc: 'Gerakan mengitari objek 3D (Orbit Pan) dengan kilatan neon futuristik.',
    camera: 'Rotasi 3D Orbit Pan Mengitari Objek',
    fx: 'Kilatan Cahaya Cyber Neon Futuristik'
  },
  'float_cinematic': {
    label: '🌊 Smooth Floating Camera + Light Leaks',
    name: '🌊 Smooth Floating Camera + Light Leaks',
    desc: 'Gerakan kamera melayang halus seperti gimbal profesional dengan kabut sinematik.',
    camera: 'Gimbal Floating Melayang Halus',
    fx: 'Cinematic Light Leaks & Mist'
  },
  'pan_cyber': {
    label: '⚡ Dynamic Tracking + Action Sparks',
    name: '⚡ Dynamic Tracking + Action Sparks',
    desc: 'Pergerakan kamera dinamis mengikuti objek dengan efek ketukan energi.',
    camera: 'Dynamic Lateral Tracking Shot',
    fx: 'Percikan Energi & Action Sparks'
  },
  'zoomout_rain': {
    label: '🌧️ Epic Zoom-Out + Matrix Rain',
    name: '🌧️ Epic Zoom-Out + Matrix Rain',
    desc: 'Kamera mundur perlahan memperlihatkan keseluruhan suasana dengan efek hujan sinematik.',
    camera: 'Dramatic Wide Zoom-Out Reveal',
    fx: 'Hujan Cahaya Sinematik (Neon Rain)'
  },
  'product_bokeh': {
    label: '💎 Product Showcase + Luxury Bokeh',
    name: '💎 Product Showcase + Luxury Bokeh',
    desc: 'Gerakan kamera khusus pameran produk jualan agar terlihat hidup & elegan.',
    camera: 'Commercial Product Showcase Slow-Mo',
    fx: 'Kilau Berlian & Studio Bokeh'
  }
};

const _MEM_USER_AI_STATE = {}; // chatId -> { mode: 't2v'|'motion'|'image'|'script'|'copy'|'chat', motionPreset: 'zoom_gold', lastImgUrl: '', lastPrompt: '' }

// ============================================================================
// 🗄️ IN-MEMORY & KV FALLBACK STORAGE (SINKRON DENGAN D1 DATABASE)
// Menjamin pesanan, lisensi, dan afiliasi tetap 100% sinkron meskipun D1 belum di-bind
// ============================================================================
const _MEM_PENDING_ORDERS = {}; // chatId -> { productKey, productName, price, sellerId, updatedAt }
const _MEM_LICENSES_BY_HWID = {}; // hwid -> { licenseKey, productKey, productName, hwid, status, buyerId, sellerId, activatedAt }
const _MEM_LICENSES_BY_KEY = {}; // licenseKey -> { licenseKey, productKey, productName, hwid, status, buyerId, sellerId, activatedAt }
const _MEM_USERS = {}; // telegramId -> { telegram_id, referrer_id, balance_direct, balance_team, balance_ads, app_pair_token }

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

    try { await db.prepare('ALTER TABLE transactions ADD COLUMN product_key TEXT').run(); } catch (_) {}
    try { await db.prepare('ALTER TABLE users ADD COLUMN max_level INTEGER DEFAULT 1').run(); } catch (_) {}
    try { await db.prepare('ALTER TABLE users ADD COLUMN last_milestone_awarded INTEGER DEFAULT 0').run(); } catch (_) {}
    try { await db.prepare('ALTER TABLE users ADD COLUMN last_ip TEXT').run(); } catch (_) {}
    try { await db.prepare('ALTER TABLE users ADD COLUMN ip_warnings INTEGER DEFAULT 0').run(); } catch (_) {}
    try { await db.prepare('ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0').run(); } catch (_) {}
    try { await db.prepare('ALTER TABLE users ADD COLUMN ban_reason TEXT').run(); } catch (_) {}

    _isCoreTablesReady = true;
  } catch (_) {}
}

/**
 * Simpan pesanan pending ke D1 + KV + Memory secara bersamaan agar 100% sinkron
 */
async function savePendingOrder(env, chatId, productKey, sellerId, userName = 'User') {
  const resolvedKey = resolveProductKey(productKey) || 'reddit_pro';
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

  // 1. Simpan di Memory
  _MEM_PENDING_ORDERS[cleanChatId] = orderData;

  // 2. Simpan di KV jika tersedia
  if (env.LICENSE_KV) {
    try {
      await env.LICENSE_KV.put(`user_pending_order:${cleanChatId}`, JSON.stringify(orderData), { expirationTtl: 86400 * 3 });
    } catch (_) {}
  }

  // 3. Simpan di D1 Database jika tersedia
  if (env.DB) {
    try {
      await ensureCoreTables(env.DB);
      // Batalkan/timpa transaksi PENDING sebelumnya milik pembeli ini agar tidak menumpuk/bentrok
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

/**
 * Ambil pesanan pending terakhir milik pembeli dari Memory / KV / D1
 */
async function getPendingOrder(env, chatId) {
  const cleanChatId = String(chatId);
  let candidates = [];

  // 1. Cek Memory
  if (_MEM_PENDING_ORDERS[cleanChatId]) {
    candidates.push(_MEM_PENDING_ORDERS[cleanChatId]);
  }

  // 2. Cek KV
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

  // 3. Cek D1 Database
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

/**
 * Bersihkan status pending order setelah di-Approve atau di-Reject
 */
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

    // Tangani Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // ----------------------------------------------------------------------
      // ROUTE 0: GET /beli & /order -> REDIRECT KE BOT TELEGRAM DENGAN PRODUK & REF
      // ----------------------------------------------------------------------
      if (url.pathname === '/beli' || url.pathname === '/order') {
        const rawItem = url.searchParams.get('item') || (
          hostname.includes('reddit') ? 'reddit_pro' :
          hostname.includes('linkedin') ? 'linkedin_pro' :
          hostname.includes('pinterest') ? 'pinterest_pro' :
          hostname.includes('fb') ? 'fb_pro' :
          hostname.includes('tiktok') || hostname.includes('livetok') ? 'tiktok_pro' :
          hostname.includes('x.') ? 'x_pro' : 'soft_a'
        );
        const itemKey = resolveProductKey(rawItem) || 'soft_a';
        const refParam = (url.searchParams.get('ref') || 'direct').replace(/^ref_/, '').trim();
        const teleUrl = `https://t.me/${CONFIG.BOT_USERNAME}?start=buy_${itemKey}_ref_${refParam}`;
        return Response.redirect(teleUrl, 302);
      }

      // ----------------------------------------------------------------------
      // ROUTE 1: GET / -> RENDER WEB PORTAL AKTIVASI HWID (ATAU PROXY JUALIN AJA)
      // ----------------------------------------------------------------------
      if (url.pathname === '/' && request.method === 'GET' && !hostname.includes('jualin.appdockhub.com')) {
        const ref = url.searchParams.get('ref') || 'direct';
        return new Response(renderActivationPageHtml(ref), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // ----------------------------------------------------------------------
      // ROUTE 1B: GET /app-ads.txt -> VERIFIKASI RESMI GOOGLE ADMOB & AD NETWORKS
      // ----------------------------------------------------------------------
      if (url.pathname === '/app-ads.txt' && request.method === 'GET') {
        const adsTxt = 'google.com, pub-7479911722538350, DIRECT, f08c47fec0942fa0\n';
        return new Response(adsTxt, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }

      // ----------------------------------------------------------------------
      // ROUTE 1C: GET /privacy & /delete-account -> PRIVACY POLICY GOOGLE PLAY
      // ----------------------------------------------------------------------
      if ((url.pathname === '/privacy' || url.pathname === '/privacy-policy' || url.pathname === '/delete-account') && request.method === 'GET') {
        return new Response(renderPrivacyPolicyHtml(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // ----------------------------------------------------------------------
      // ROUTE 1D: GET /motion-studio -> AI VIDEO & MOTION CONTROL STUDIO (60 FPS RECORDER)
      // ----------------------------------------------------------------------
      if (url.pathname === '/motion-studio' && request.method === 'GET') {
        return new Response(renderMotionStudioHtml(url), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS }
        });
      }

      // ----------------------------------------------------------------------
      // ROUTE 1D-2: GET /drama-player & /drama-stream -> PLAYER TRIAL DRAMA EPISODE 1-3
      // ----------------------------------------------------------------------
      if (url.pathname === '/drama-player' && request.method === 'GET') {
        return new Response(await renderDramaTrialPlayerHtml(url), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS }
        });
      }
      if (url.pathname === '/drama-stream' && request.method === 'GET') {
        return await handleDramaTrialStream(request, url);
      }

      // ----------------------------------------------------------------------
      // ROUTE 1D-3: GET /ai-video-proxy -> STREAM & DOWNLOAD REAL MP4 VIDEO DENGAN CORS
      // ----------------------------------------------------------------------
      if (url.pathname === '/ai-video-proxy' && request.method === 'GET') {
        const targetVideoUrl = (url.searchParams.get('url') || '').trim();
        const isDownload = url.searchParams.get('dl') === '1';
        if (!targetVideoUrl || !/^https?:\/\//i.test(targetVideoUrl)) {
          return new Response('Missing or invalid video url', { status: 400, headers: CORS_HEADERS });
        }
        try {
          const rangeHeader = request.headers.get('Range') || request.headers.get('range') || '';
          const upHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
          if (rangeHeader) upHeaders['Range'] = rangeHeader;

          let upRes = await fetchWithTimeout(targetVideoUrl, { headers: upHeaders }, 9500);
          if ((!upRes || !upRes.ok) && targetVideoUrl.includes('/720p.mp4')) {
            const fb360 = targetVideoUrl.replace('/720p.mp4', '/360p.mp4');
            upRes = await fetchWithTimeout(fb360, { headers: upHeaders }, 9500);
          }
          if (!upRes || (!upRes.ok && upRes.status !== 206)) {
            return Response.redirect(targetVideoUrl, 302);
          }

          const respHeaders = new Headers(CORS_HEADERS);
          respHeaders.set('Content-Type', 'video/mp4');
          respHeaders.set('Accept-Ranges', 'bytes');
          respHeaders.set('Cache-Control', 'public, max-age=3600');
          if (isDownload) {
            respHeaders.set('Content-Disposition', 'attachment; filename="AppDock_AI_Real_Video.mp4"');
          } else {
            respHeaders.set('Content-Disposition', 'inline');
          }
          if (upRes.headers.get('Content-Length')) {
            respHeaders.set('Content-Length', upRes.headers.get('Content-Length'));
          }
          if (upRes.headers.get('Content-Range')) {
            respHeaders.set('Content-Range', upRes.headers.get('Content-Range'));
          }
          return new Response(upRes.body, {
            status: upRes.status,
            headers: respHeaders
          });
        } catch (_) {
          return Response.redirect(targetVideoUrl, 302);
        }
      }

      // ----------------------------------------------------------------------
      // ROUTE 1E: GET /tg-photo -> PROXY FOTO TELEGRAM DENGAN CORS
      // ----------------------------------------------------------------------
      if (url.pathname === '/tg-photo' && request.method === 'GET') {
        const fileId = (url.searchParams.get('id') || '').trim();
        if (!fileId) return new Response('Missing file_id', { status: 400, headers: CORS_HEADERS });
        try {
          const infoRes = await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
          const infoData = await infoRes.json();
          const filePath = infoData?.result?.file_path;
          if (!filePath) return new Response('File not found', { status: 404, headers: CORS_HEADERS });
          const imgRes = await fetch(`https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${filePath}`);
          return new Response(imgRes.body, {
            headers: {
              ...CORS_HEADERS,
              'Content-Type': imgRes.headers.get('Content-Type') || 'image/jpeg',
              'Cache-Control': 'public, max-age=86400'
            }
          });
        } catch (e) {
          return new Response('Error fetching Telegram photo', { status: 500, headers: CORS_HEADERS });
        }
      }

      // ----------------------------------------------------------------------
      // ROUTE 2: GET/POST /activate -> VALIDASI & IKAT LISENSI KE HWID (1 DEVICE)
      // ----------------------------------------------------------------------
      if (url.pathname === '/activate') {
        return await handleLicenseActivation(request, env, url);
      }

      // ----------------------------------------------------------------------
      // ROUTE 3: POST /api/ads/reward -> TRACKING REWARDED ADS & LIMIT 60/HARI
      // ----------------------------------------------------------------------
      if (url.pathname === '/api/ads/reward' && request.method === 'POST') {
        return await handleAdsReward(request, env);
      }

      // ----------------------------------------------------------------------
      // ROUTE 3B: POST /api/game/level-cleared -> BONUS MILESTONE REFERRAL GAME
      // ----------------------------------------------------------------------
      if (url.pathname === '/api/game/level-cleared' && request.method === 'POST') {
        return await handleGameLevelCleared(request, env);
      }

      // ----------------------------------------------------------------------
      // ROUTE 3C: GET/POST /api/offerwall/postback -> S2S POSTBACK TOROX, CPALEAD, DLL
      // ----------------------------------------------------------------------
      if (url.pathname === '/api/offerwall/postback') {
        return await handleOfferwallPostback(request, env, url);
      }

      // ----------------------------------------------------------------------
      // ROUTE 3D: POST /api/security/check -> DETEKSI VPN/PROXY & MULTI-AKUN 1 IP
      // ----------------------------------------------------------------------
      if (url.pathname === '/api/security/check' && request.method === 'POST') {
        return await handleSecurityCheck(request, env);
      }

      // ----------------------------------------------------------------------
      // ROUTE 3E: GET/POST /api/referral/click & /play -> TRACK REFERRAL PLAY STORE DOWNLOAD
      // ----------------------------------------------------------------------
      if (url.pathname === '/api/referral/click' || url.pathname === '/play') {
        return await handleReferralClick(request, env, url);
      }

      // ----------------------------------------------------------------------
      // ROUTE 4: GET/POST /verify & /check-license -> CEK STATUS LISENSI HWID OLEH DESKTOP/WEB/APK
      // ----------------------------------------------------------------------
      if (url.pathname === '/verify' || url.pathname === '/check-license') {
        return await handleVerifyLicense(request, env, url);
      }

      // ----------------------------------------------------------------------
      // ROUTE 5: GET/POST /set-webhook -> REGISTER BOT TELEGRAM WEBHOOK OTOMATIS
      // ----------------------------------------------------------------------
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

      // ----------------------------------------------------------------------
      // ROUTE 6: POST /telegram-webhook & /bot-webhook -> TELEGRAM BOT HANDLER
      // ----------------------------------------------------------------------
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

      // ----------------------------------------------------------------------
      // ROUTE 7: REVERSE PROXY KHUSUS SUBDOMAIN JUALIN.APPDOCKHUB.COM
      // ----------------------------------------------------------------------
      if (hostname.includes('jualin.appdockhub.com')) {
        const targetOrigin = 'https://jualin-aja-by-appdockhub-com.ai.studio';
        const targetUrl = new URL(url.pathname + url.search, targetOrigin);
        const modifiedHeaders = new Headers(request.headers);
        modifiedHeaders.set('Host', new URL(targetOrigin).hostname);
        modifiedHeaders.set('X-Forwarded-Host', hostname);

        const response = await fetch(targetUrl.toString(), {
          method: request.method,
          headers: modifiedHeaders,
          body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
          redirect: 'follow'
        });

        const resHeaders = new Headers(response.headers);
        Object.keys(CORS_HEADERS).forEach(k => resHeaders.set(k, CORS_HEADERS[k]));
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: resHeaders
        });
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
// 1. HANDLER AKTIVASI LISENSI (1 Device = 1 License, Support D1 + KV + Memory)
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

  // 1. Cek di D1 Database jika tersedia
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

  // 2. Cek di KV Namespace jika tersedia
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
          product: kData.product || 'Software AppDockHub',
          status: 'active',
          createdAt: kData.createdAt || new Date().toISOString()
        }));
        return jsonResponse({
          valid: true,
          status: 'success',
          product: kData.product || 'Software AppDockHub',
          licenseKey,
          hwid,
          message: `Aktivasi ${kData.product || 'Software'} Berhasil!`
        });
      }
    } catch (_) {}
  }

  // 3. Cek di Memory Cache
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

  // 4. Cek Stateless HWID Signature (Memastikan 1 License = 1 Device tetap jalan walau cold-start / tanpa D1)
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
// 2. HANDLER REWARDED ADS (Opsi A: Dompet Terpisah per Game & Proteksi Lintas Game)
// ============================================================================
let _isGameWalletsTableReady = false;
async function ensureGameWalletsTable(db) {
  if (_isGameWalletsTableReady || !db) return;
  try {
    await ensureCoreTables(db);
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS game_wallets (
        pair_token TEXT NOT NULL,
        game_id TEXT NOT NULL,
        game_name TEXT NOT NULL,
        telegram_id TEXT,
        balance REAL DEFAULT 0.0,
        ads_watched_today INTEGER DEFAULT 0,
        last_ad_watch_date TEXT,
        max_level INTEGER DEFAULT 1,
        last_milestone_awarded INTEGER DEFAULT 0,
        last_ip TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pair_token, game_id)
      )
    `).run();
    try { await db.prepare('ALTER TABLE game_wallets ADD COLUMN max_level INTEGER DEFAULT 1').run(); } catch (_) {}
    try { await db.prepare('ALTER TABLE game_wallets ADD COLUMN last_milestone_awarded INTEGER DEFAULT 0').run(); } catch (_) {}
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS referral_clicks (
        ip TEXT PRIMARY KEY,
        referrer_id TEXT NOT NULL,
        game_id TEXT DEFAULT 'cyber_orbit',
        clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_game_wallets_tg ON game_wallets(telegram_id)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_game_wallets_ip_date ON game_wallets(last_ip, last_ad_watch_date)').run();
    _isGameWalletsTableReady = true;
  } catch (_) {}
}

async function handleAdsReward(request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid payload' }, 400);
  }

  const pairToken = (body.pairToken || body.app_pair_token || '').trim();
  const gameId = (body.gameId || 'cyber_orbit').trim();
  const gameName = (body.gameName || 'Cyber Orbit').trim();
  const rewardToAdd = body.rewardAmount ? parseFloat(body.rewardAmount) : CONFIG.AD_REWARD_AMOUNT;

  if (!pairToken) {
    return jsonResponse({ success: false, message: 'Pair token diperlukan' }, 400);
  }

  if (!env.DB) {
    return jsonResponse({ success: false, message: 'Database D1 belum terkonfigurasi' }, 500);
  }

  await ensureGameWalletsTable(env.DB);

  // Format tanggal lokal YYYY-MM-DD & IP Publik
  const todayStr = new Date().toISOString().slice(0, 10);
  const clientIp = (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0] ||
    '0.0.0.0'
  ).trim();

  // Cari user berdasarkan app_pair_token
  let user = await env.DB.prepare('SELECT * FROM users WHERE app_pair_token = ?').bind(pairToken).first();

  // Cek apakah IP pemain ini sebelumnya mengklik Link Download Game Referral (https://appdockhub.com/play?ref=ID)
  let matchedRefId = null;
  if (clientIp !== '0.0.0.0' && (!user || !user.referrer_id)) {
    const refClick = await env.DB.prepare('SELECT referrer_id FROM referral_clicks WHERE ip = ?').bind(clientIp).first();
    if (refClick && refClick.referrer_id) {
      matchedRefId = refClick.referrer_id;
    }
  }

  if (!user) {
    const tempTelegramId = `temp_${pairToken.slice(0, 8)}`;
    await env.DB.prepare(
      'INSERT INTO users (telegram_id, app_pair_token, referrer_id, balance_direct, balance_team, balance_ads, ads_watched_today, last_ad_watch_date, last_ip) VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?)'
    ).bind(tempTelegramId, pairToken, matchedRefId, todayStr, clientIp).run();

    user = await env.DB.prepare('SELECT * FROM users WHERE app_pair_token = ?').bind(pairToken).first();
  } else if (!user.referrer_id && matchedRefId && matchedRefId !== user.telegram_id) {
    await env.DB.prepare('UPDATE users SET referrer_id = ? WHERE app_pair_token = ?').bind(matchedRefId, pairToken).run();
    user.referrer_id = matchedRefId;
  }

  // Tolak jika akun sudah di-banned karena curang / multi-IP / proxy
  if (user && user.is_banned === 1) {
    return jsonResponse({
      success: false,
      banned: true,
      message: 'Akun Anda telah di-BANNED karena pelanggaran keamanan (Multi-IP / Proxy / VPN).'
    }, 403);
  }

  // Ambil atau buat dompet khusus untuk game ini (Isolated Wallet per Game - Opsi A)
  let gw = await env.DB.prepare(
    'SELECT * FROM game_wallets WHERE pair_token = ? AND game_id = ?'
  ).bind(pairToken, gameId).first();

  if (!gw) {
    const initialBal = gameId === 'cyber_orbit' ? (user.balance_ads || 0) : 0;
    const initialWatched = gameId === 'cyber_orbit' && user.last_ad_watch_date === todayStr ? (user.ads_watched_today || 0) : 0;
    await env.DB.prepare(
      'INSERT INTO game_wallets (pair_token, game_id, game_name, telegram_id, balance, ads_watched_today, last_ad_watch_date, last_ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(pairToken, gameId, gameName, user.telegram_id, initialBal, initialWatched, todayStr, clientIp).run();
    gw = await env.DB.prepare('SELECT * FROM game_wallets WHERE pair_token = ? AND game_id = ?').bind(pairToken, gameId).first();
  }

  // Cek apakah tanggal sudah berganti pada game ini (Auto-Reset Harian)
  let watchedToday = gw.ads_watched_today || 0;
  if (gw.last_ad_watch_date !== todayStr) {
    watchedToday = 0;
  }

  // CEK KUOTA LIMIT 60 IKLAN / HARI PADA GAME INI
  if (watchedToday >= CONFIG.MAX_DAILY_ADS) {
    return jsonResponse({
      success: false,
      limitReached: true,
      adsWatchedToday: CONFIG.MAX_DAILY_ADS,
      remainingQuota: 0,
      currentBalanceAds: gw.balance || 0,
      message: `Kuota 60 iklan harian di ${gameName} telah habis! Beralihlah ke Program Afiliasi 2-Tier untuk komisi tanpa batas kuota.`,
      funnelOffer: {
        title: 'Unlimited Earning via Afiliasi 2-Tier',
        directCommission: 'Rp 29.700 - Rp 89.700 per closing (30%)',
        teamCommission: 'Rp 4.950 - Rp 14.950 per closing tim (5%)',
        botLink: `https://t.me/${CONFIG.BOT_USERNAME}?start=affiliate`
      }
    });
  }

  // PROTEKSI ANTI-BONCOS LINTAS GAME (Anti-Double Initial Boost):
  let alreadyPlayedOtherGameToday = false;
  if (watchedToday < 5 && clientIp !== '0.0.0.0') {
    const otherGame = await env.DB.prepare(
      'SELECT game_id FROM game_wallets WHERE game_id != ? AND last_ad_watch_date = ? AND ads_watched_today > 0 AND (last_ip = ? OR (telegram_id = ? AND telegram_id NOT LIKE "temp_%")) LIMIT 1'
    ).bind(gameId, todayStr, clientIp, user.telegram_id || '').first();
    if (otherGame) {
      alreadyPlayedOtherGameToday = true;
    }
  }

  watchedToday += 1;
  const maxAllowedPerAd = watchedToday <= 5 ? (alreadyPlayedOtherGameToday ? 8 : 50) : 30;
  const baseReward = Math.max(2, Math.min(maxAllowedPerAd, Math.round(rewardToAdd)));
  const multiplier = Math.max(1, Number(CONFIG.REWARD_MULTIPLIER || 1));
  const safeReward = Math.round(baseReward * multiplier);
  const newGameBalance = (gw.balance || 0) + safeReward;

  // Update dompet khusus game ini (Isolated Wallet)
  await env.DB.prepare(
    'UPDATE game_wallets SET ads_watched_today = ?, balance = ?, last_ad_watch_date = ?, last_ip = ?, telegram_id = ? WHERE pair_token = ? AND game_id = ?'
  ).bind(watchedToday, newGameBalance, todayStr, clientIp, user.telegram_id, pairToken, gameId).run();

  // Sinkronkan juga ke kolom legacy jika game utama
  if (gameId === 'cyber_orbit') {
    await env.DB.prepare(
      'UPDATE users SET ads_watched_today = ?, balance_ads = ?, last_ad_watch_date = ? WHERE app_pair_token = ?'
    ).bind(watchedToday, newGameBalance, todayStr, pairToken).run();
  }

  const isLimitNow = watchedToday >= CONFIG.MAX_DAILY_ADS;
  const remaining = CONFIG.MAX_DAILY_ADS - watchedToday;

  // Optimasi Skala Besar: Kirim notifikasi Telegram hanya pada Iklan ke-1, kelipatan 10 (10,20,30,40,50), atau saat kuota 60/60 selesai
  if (user.telegram_id && !user.telegram_id.startsWith('temp_') && (watchedToday === 1 || watchedToday % 10 === 0 || isLimitNow)) {
    let notifyMsg = `📺 *UPDATE SALDO ${gameName.toUpperCase()}!*\n\n` +
      `💰 Reward Terakhir: *+Rp ${safeReward.toLocaleString('id-ID')}*\n` +
      `🎯 Progres Hari Ini: *${watchedToday}/${CONFIG.MAX_DAILY_ADS} Iklan*\n` +
      `💵 Saldo Dompet ${gameName}: *Rp ${newGameBalance.toLocaleString('id-ID')}*\n` +
      `_(Dompet tiap game terpisah, Min. WD Rp 50.000/game)_`;

    if (isLimitNow) {
      notifyMsg += `\n\n🔒 *KUOTA HARIAN HABIS (${CONFIG.MAX_DAILY_ADS}/${CONFIG.MAX_DAILY_ADS})!*\n` +
        `Mau dapat Rp 29.700 - Rp 89.700 / closing tanpa batas kuota? Klik menu *[🔗 Link Afiliasi Saya]*!`;
    }

    await sendTelegramMessage(user.telegram_id, notifyMsg);
  }

  return jsonResponse({
    success: true,
    gameId,
    gameName,
    limitReached: isLimitNow,
    adsWatchedToday: watchedToday,
    remainingQuota: remaining,
    rewardAdded: safeReward,
    currentBalanceAds: newGameBalance,
    message: isLimitNow
      ? `Selamat! Kuota ${CONFIG.MAX_DAILY_ADS} iklan harian selesai ditonton.`
      : `Iklan ke-${watchedToday} sukses (+Rp ${safeReward}). Sisa kuota hari ini: ${remaining} iklan.`
  });
}

// ============================================================================
// 2A-2. HANDLER REFERRAL PLAY STORE DOWNLOAD (https://appdockhub.com/play?ref=ID)
// ============================================================================
async function handleReferralClick(request, env, url) {
  let refId = (url.searchParams.get('ref') || '').replace(/^ref_/, '').trim();
  let gameId = (url.searchParams.get('game') || 'cyber_orbit').trim();

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (body.ref) refId = String(body.ref).replace(/^ref_/, '').trim();
      if (body.gameId) gameId = String(body.gameId).trim();
    } catch (_) {}
  }

  const clientIp = (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0] ||
    '0.0.0.0'
  ).trim();

  if (env.DB && refId && clientIp !== '0.0.0.0') {
    await ensureGameWalletsTable(env.DB);
    await env.DB.prepare(
      'INSERT INTO referral_clicks (ip, referrer_id, game_id, clicked_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(ip) DO UPDATE SET referrer_id = ?, game_id = ?, clicked_at = CURRENT_TIMESTAMP'
    ).bind(clientIp, refId, gameId, refId, gameId).run();
  }

  // Jika diakses langsung via GET /play?ref=ID, arahkan otomatis (302) ke Google Play Store
  if (url.pathname === '/play') {
    const playUrl = `https://play.google.com/store/apps/details?id=com.appdockhub.ecosystem&referrer=${encodeURIComponent('ref_' + refId)}`;
    return Response.redirect(playUrl, 302);
  }

  return jsonResponse({
    success: true,
    ref: refId,
    gameId,
    playStoreUrl: `https://play.google.com/store/apps/details?id=com.appdockhub.ecosystem&referrer=${encodeURIComponent('ref_' + refId)}`
  });
}

// ============================================================================
// 2B. HANDLER MILESTONE REFERRAL MULTI-GAME (TIAP 10 LEVEL = RP 50 PER GAME)
// ============================================================================
async function handleGameLevelCleared(request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid payload' }, 400);
  }

  const pairToken = (body.pairToken || '').trim();
  const gameId = (body.gameId || 'cyber_orbit').trim();
  const gameName = (body.gameName || 'Cyber Orbit').trim();
  const level = parseInt(body.level) || 0;

  if (!pairToken || level <= 0) {
    return jsonResponse({ success: false, message: 'pairToken & valid level required' }, 400);
  }

  if (!env.DB) {
    return jsonResponse({ success: true, level });
  }

  await ensureGameWalletsTable(env.DB);

  const clientIp = (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0] ||
    '0.0.0.0'
  ).trim();
  const todayStr = new Date().toISOString().slice(0, 10);

  let user = await env.DB.prepare('SELECT * FROM users WHERE app_pair_token = ?').bind(pairToken).first();
  let matchedRefId = null;
  if (clientIp !== '0.0.0.0' && (!user || !user.referrer_id)) {
    const refClick = await env.DB.prepare('SELECT referrer_id FROM referral_clicks WHERE ip = ?').bind(clientIp).first();
    if (refClick && refClick.referrer_id) {
      matchedRefId = refClick.referrer_id;
    }
  }

  if (!user) {
    const tempTelegramId = `temp_${pairToken.slice(0, 8)}`;
    await env.DB.prepare(
      'INSERT INTO users (telegram_id, app_pair_token, referrer_id, balance_direct, balance_team, balance_ads, ads_watched_today, last_ad_watch_date, last_ip) VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?)'
    ).bind(tempTelegramId, pairToken, matchedRefId, todayStr, clientIp).run();
    user = await env.DB.prepare('SELECT * FROM users WHERE app_pair_token = ?').bind(pairToken).first();
  } else if (!user.referrer_id && matchedRefId && matchedRefId !== user.telegram_id) {
    await env.DB.prepare('UPDATE users SET referrer_id = ? WHERE app_pair_token = ?').bind(matchedRefId, pairToken).run();
    user.referrer_id = matchedRefId;
  }

  if (!user || user.is_banned === 1) {
    return jsonResponse({ success: false, banned: true, level });
  }

  let gw = await env.DB.prepare('SELECT * FROM game_wallets WHERE pair_token = ? AND game_id = ?').bind(pairToken, gameId).first();
  if (!gw) {
    await env.DB.prepare(
      'INSERT INTO game_wallets (pair_token, game_id, game_name, telegram_id, balance, ads_watched_today, last_ad_watch_date, max_level, last_milestone_awarded) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)'
    ).bind(pairToken, gameId, gameName, user.telegram_id, 0, todayStr, level, user.last_milestone_awarded || 0).run();
    gw = await env.DB.prepare('SELECT * FROM game_wallets WHERE pair_token = ? AND game_id = ?').bind(pairToken, gameId).first();
  }

  const curMax = gw.max_level || user.max_level || 1;
  const newMax = Math.max(curMax, level);
  await env.DB.prepare('UPDATE game_wallets SET max_level = ? WHERE pair_token = ? AND game_id = ?').bind(newMax, pairToken, gameId).run();
  if (gameId === 'cyber_orbit') {
    await env.DB.prepare('UPDATE users SET max_level = ? WHERE app_pair_token = ?').bind(newMax, pairToken).run();
  }

  if (level % 10 === 0 && level <= 2000) {
    const lastAwarded = gw.last_milestone_awarded || (gameId === 'cyber_orbit' ? (user.last_milestone_awarded || 0) : 0);
    if (lastAwarded < level) {
      const milestoneBonus = 50;

      if (user.referrer_id && user.referrer_id !== user.telegram_id) {
        const sponsor = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(user.referrer_id).first();
        if (sponsor) {
          const spPairToken = sponsor.app_pair_token || `sp_${user.referrer_id}`;
          let spGw = await env.DB.prepare('SELECT * FROM game_wallets WHERE (telegram_id = ? OR pair_token = ?) AND game_id = ?').bind(user.referrer_id, spPairToken, gameId).first();
          if (!spGw) {
            const initBal = gameId === 'cyber_orbit' ? (sponsor.balance_ads || 0) : 0;
            await env.DB.prepare(
              'INSERT INTO game_wallets (pair_token, game_id, game_name, telegram_id, balance, ads_watched_today, last_ad_watch_date) VALUES (?, ?, ?, ?, ?, 0, ?)'
            ).bind(spPairToken, gameId, gameName, user.referrer_id, initBal + milestoneBonus, todayStr).run();
          } else {
            await env.DB.prepare(
              'UPDATE game_wallets SET balance = balance + ? WHERE pair_token = ? AND game_id = ?'
            ).bind(milestoneBonus, spGw.pair_token, gameId).run();
          }

          if (gameId === 'cyber_orbit') {
            await env.DB.prepare('UPDATE users SET balance_ads = balance_ads + ? WHERE telegram_id = ?').bind(milestoneBonus, user.referrer_id).run();
          }
        }

        const playerName = user.telegram_id && !user.telegram_id.startsWith('temp_')
            ? `ID: ${user.telegram_id}`
            : 'Referral Anda';

        await sendTelegramMessage(user.referrer_id,
          `🎯 *BONUS MILESTONE LEVEL REFERRAL (${gameName.toUpperCase()})!*\n\n` +
          `Luar biasa! Teman yang Anda undang (*${playerName}*) baru saja menembus *Level ${level}* di game *${gameName}*!\n` +
          `💰 Bonus Masuk ke Dompet ${gameName}: *+Rp ${milestoneBonus.toLocaleString('id-ID')}*\n\n` +
          `🔥 Anda mendapatkan Rp 50 setiap referral menembus kelipatan 10 level di setiap game ekosistem AppDock Hub (hingga Level 2000 per game)!`
        );
      }

      await env.DB.prepare('UPDATE game_wallets SET last_milestone_awarded = ? WHERE pair_token = ? AND game_id = ?').bind(level, pairToken, gameId).run();
      if (gameId === 'cyber_orbit') {
        await env.DB.prepare('UPDATE users SET last_milestone_awarded = ? WHERE app_pair_token = ?').bind(level, pairToken).run();
      }

      return jsonResponse({
        success: true,
        gameId,
        gameName,
        milestoneAwarded: true,
        level,
        milestoneBonus,
        message: `Milestone Level ${level} (${gameName}) berhasil dicatat!`
      });
    }
  }

  return jsonResponse({ success: true, gameId, level });
}

// ============================================================================
// 2C. HANDLER S2S POSTBACK OFFERWALL
// ============================================================================
async function handleOfferwallPostback(request, env, url) {
  const params = url.searchParams;
  const pairToken = (
    params.get('user_id') ||
    params.get('aff_sub4') ||
    params.get('subid') ||
    params.get('pub_click_id') ||
    params.get('pub_sub_id') ||
    params.get('var') ||
    params.get('ymid') ||
    params.get('tracking_id') ||
    params.get('uid') ||
    params.get('sid') ||
    params.get('external_identifier') ||
    ''
  ).trim();

  const rawAmount = parseFloat(
    params.get('amount') ||
    params.get('payout') ||
    params.get('currency_amount') ||
    params.get('revenue') ||
    '0'
  );

  const offerName = (params.get('offer_name') || params.get('o_name') || 'Misi Offerwall').trim();

  if (!pairToken || rawAmount <= 0) {
    return new Response('0', { status: 400 });
  }

  const rewardIdr = rawAmount < 10 ? Math.round(rawAmount * 10000) : Math.round(rawAmount);

  if (env.DB) {
    await ensureGameWalletsTable(env.DB);
    const todayStr = new Date().toISOString().slice(0, 10);
    let user = await env.DB.prepare('SELECT * FROM users WHERE app_pair_token = ?').bind(pairToken).first();
    if (!user) {
      const tempTelegramId = `temp_${pairToken.slice(0, 8)}`;
      await env.DB.prepare(
        'INSERT INTO users (telegram_id, app_pair_token, balance_direct, balance_team, balance_ads, ads_watched_today, last_ad_watch_date) VALUES (?, ?, 0, 0, 0, 0, ?)'
      ).bind(tempTelegramId, pairToken, todayStr).run();
      user = await env.DB.prepare('SELECT * FROM users WHERE app_pair_token = ?').bind(pairToken).first();
    }

    const newBalanceAds = (user.balance_ads || 0) + rewardIdr;
    await env.DB.prepare('UPDATE users SET balance_ads = ? WHERE app_pair_token = ?').bind(newBalanceAds, pairToken).run();

    // Sinkronkan juga ke tabel game_wallets (Cyber Orbit) agar tampil di Cek Saldo & Tarik Saldo
    let gw = await env.DB.prepare('SELECT * FROM game_wallets WHERE pair_token = ? AND game_id = ?').bind(pairToken, 'cyber_orbit').first();
    let finalGwBal = newBalanceAds;
    if (!gw) {
      await env.DB.prepare(
        'INSERT INTO game_wallets (pair_token, game_id, game_name, telegram_id, balance, ads_watched_today, last_ad_watch_date) VALUES (?, ?, ?, ?, ?, 0, ?)'
      ).bind(pairToken, 'cyber_orbit', 'Cyber Orbit', user.telegram_id, newBalanceAds, todayStr).run();
    } else {
      finalGwBal = (gw.balance || 0) + rewardIdr;
      await env.DB.prepare(
        'UPDATE game_wallets SET balance = ? WHERE pair_token = ? AND game_id = ?'
      ).bind(finalGwBal, pairToken, 'cyber_orbit').run();
    }

    if (user.telegram_id && !user.telegram_id.startsWith('temp_')) {
      await sendTelegramMessage(
        user.telegram_id,
        `🎉 *HADIAH MISI CYBER ORBIT MASUK!*\n\n` +
        `📋 Misi Selesai: *${offerName}*\n` +
        `💰 Reward Saldo: *+Rp ${rewardIdr.toLocaleString('id-ID')}*\n` +
        `💵 Total Saldo Dompet Cyber Orbit: *Rp ${finalGwBal.toLocaleString('id-ID')}*`
      );
    }
  }

  return new Response('1', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

// ============================================================================
// 2D. HANDLER KEAMANAN ANTI-FRAUD (DETEKSI PROXY/VPN, DATACENTER ASN & MULTI-IP)
// ============================================================================
const BLOCKED_ASN_KEYWORDS = [
  'digitalocean', 'linode', 'akamai', 'choopa', 'vultr', 'ovh', 'hetzner',
  'contabo', 'amazonaws', 'google cloud', 'microsoft', 'azure', 'cloudflare',
  'm247', 'datapacket', 'hostinger', 'scaleway', 'upcloud', 'kamatera',
  'vpn', 'proxy', 'tor', 'hosting', 'datacenter', 'server', 'colocation'
];

async function handleSecurityCheck(request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ allowed: true });
  }

  const pairToken = (body.pairToken || '').trim();
  const clientProxyFlag = Boolean(body.clientProxyDetected);
  const clientVpnFlag = Boolean(body.clientVpnDetected);
  const clientEmulatorFlag = Boolean(body.clientEmulatorDetected);

  if (clientEmulatorFlag) {
    return jsonResponse({
      allowed: false,
      status: 'BANNED',
      ip: 'EMULATOR / VIRTUAL PHONE',
      warnings: 3,
      maxWarnings: 3,
      message: 'DILARANG MENGGUNAKAN EMULATOR / VIRTUAL PHONE! Aplikasi ini hanya boleh dijalankan pada HP fisik asli.'
    });
  }

  const clientIp = (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0] ||
    '0.0.0.0'
  ).trim();

  const cf = request.cf || {};
  const asOrg = String(cf.asOrganization || '').toLowerCase();
  const isProxyHeader = Boolean(
    request.headers.get('Via') ||
    request.headers.get('X-Proxy-ID') ||
    request.headers.get('Proxy-Connection')
  );

  const isDatacenterOrVpnIp = BLOCKED_ASN_KEYWORDS.some((kw) => asOrg.includes(kw));
  const isUsingProxyOrVpn = clientProxyFlag || clientVpnFlag || isProxyHeader || isDatacenterOrVpnIp;

  if (!env.DB || !pairToken) {
    if (isUsingProxyOrVpn) {
      return jsonResponse({
        allowed: false,
        status: 'PROXY_DETECTED',
        ip: clientIp,
        warnings: 1,
        maxWarnings: 3,
        message: 'Terdeteksi penggunaan Proxy / VPN / IP Server! Matikan VPN/Proxy dan tutup aplikasi sekarang, atau akun Anda akan di-BANNED permanen!'
      });
    }
    return jsonResponse({ allowed: true, status: 'SAFE', ip: clientIp });
  }

  await ensureCoreTables(env.DB);
  const todayStr = new Date().toISOString().slice(0, 10);
  let user = await env.DB.prepare('SELECT * FROM users WHERE app_pair_token = ?').bind(pairToken).first();
  if (!user) {
    const tempTelegramId = `temp_${pairToken.slice(0, 8)}`;
    await env.DB.prepare(
      'INSERT INTO users (telegram_id, app_pair_token, balance_direct, balance_team, balance_ads, ads_watched_today, last_ad_watch_date) VALUES (?, ?, 0, 0, 0, 0, ?)'
    ).bind(tempTelegramId, pairToken, todayStr).run();
    user = await env.DB.prepare('SELECT * FROM users WHERE app_pair_token = ?').bind(pairToken).first();
  }

  if (user && user.is_banned === 1) {
    return jsonResponse({
      allowed: false,
      status: 'BANNED',
      ip: clientIp,
      reason: user.ban_reason || 'Pelanggaran Keamanan (Multi-Akun IP Sama / Penggunaan Proxy/VPN)',
      message: 'AKUN & PERANGKAT ANDA TELAH DI-BANNED PERMANEN karena melanggar kebijakan keamanan jaringan (Multi-IP / Proxy / VPN).'
    });
  }

  if (isUsingProxyOrVpn) {
    const newWarnings = (user?.ip_warnings || 0) + 1;
    const isNowBanned = newWarnings >= 3 ? 1 : 0;
    const reason = 'Menggunakan Proxy / VPN / IP Server Datacenter';

    try {
      await env.DB.prepare(
        'UPDATE users SET ip_warnings = ?, is_banned = ?, ban_reason = ?, last_ip = ? WHERE app_pair_token = ?'
      ).bind(newWarnings, isNowBanned, isNowBanned ? reason : null, clientIp, pairToken).run();
    } catch (_) {}

    return jsonResponse({
      allowed: false,
      status: isNowBanned ? 'BANNED' : 'PROXY_DETECTED',
      ip: clientIp,
      warnings: newWarnings,
      maxWarnings: 3,
      message: isNowBanned
        ? 'AKUN ANDA TELAH DI-BANNED PERMANEN karena tetap menggunakan Proxy / VPN setelah diperingatkan!'
        : `PERINGATAN KEAMANAN (${newWarnings}/3): Terdeteksi penggunaan Proxy / VPN (${clientIp})! Segera matikan VPN/Proxy dan tutup aplikasi sekarang, atau akun Anda akan di-BANNED permanen!`
    });
  }

  if (clientIp !== '0.0.0.0') {
    try {
      const duplicateIpUser = await env.DB.prepare(
        'SELECT app_pair_token, telegram_id FROM users WHERE last_ip = ? AND app_pair_token != ? AND last_ad_watch_date = ? LIMIT 1'
      ).bind(clientIp, pairToken, todayStr).first();

      if (duplicateIpUser) {
        const newWarnings = (user?.ip_warnings || 0) + 1;
        const isNowBanned = newWarnings >= 3 ? 1 : 0;
        const reason = `Terdeteksi 2 Akun/Perangkat berbeda mengakses dari IP yang sama (${clientIp})`;

        await env.DB.prepare(
          'UPDATE users SET ip_warnings = ?, is_banned = ?, ban_reason = ?, last_ip = ? WHERE app_pair_token = ?'
        ).bind(newWarnings, isNowBanned, isNowBanned ? reason : null, clientIp, pairToken).run();

        return jsonResponse({
          allowed: false,
          status: isNowBanned ? 'BANNED' : 'DUPLICATE_IP_WARNING',
          ip: clientIp,
          warnings: newWarnings,
          maxWarnings: 3,
          message: isNowBanned
            ? `AKUN ANDA DI-BANNED PERMANEN karena terdeteksi mengakses dari IP ganda (${clientIp}) berulang kali!`
            : `PERINGATAN KERAS (${newWarnings}/3): Terdeteksi 2 akses akun/perangkat pada alamat IP yang sama (${clientIp})! Dilarang keras bermain menggunakan banyak akun dalam 1 jaringan IP. Segera tutup aplikasi sekarang atau akun Anda akan di-BANNED permanen!`
        });
      }

      await env.DB.prepare(
        'UPDATE users SET last_ip = ? WHERE app_pair_token = ?'
      ).bind(clientIp, pairToken).run();
    } catch (_) {}
  }

  return jsonResponse({
    allowed: true,
    status: 'SAFE',
    ip: clientIp,
    warnings: user?.ip_warnings || 0
  });
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

  // 1. Cek di D1 Database
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

  // 2. Cek di KV Namespace
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

  // 3. Cek di Memory Cache
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

  // 4. Cek Stateless HWID Signature jika parameter key disertakan (misal pada /check-license)
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
// 4. TELEGRAM BOT HANDLER (COMMANDS, 2-TIER AFILIASI, QRIS, & PAYMENTS)
// ============================================================================
async function handleTelegramUpdate(update, env, workerOrigin = 'https://appdockhub.com') {
  // A. CALLBACK QUERY (Tombol Inline)
  if (update.callback_query) {
    const cb = update.callback_query;
    const action = cb.data || '';
    const chatId = String(cb.message.chat.id);
    const buyerName = cb.from?.first_name || 'User';

    // Cek apakah klik tombol Episode 4+ atau Full Episode yang di-lock
    let isLockedDramaClick = action.startsWith('drama_lock:');
    let lockedEpRequested = 4;
    if (action.startsWith('drama_ep:')) {
      const epParts = action.replace('drama_ep:', '').split(':');
      const reqEp = parseInt(epParts[1]) || 1;
      if (reqEp >= 4) {
        isLockedDramaClick = true;
        lockedEpRequested = reqEp;
      }
    }

    // Jawab callback Telegram (tampilkan Pop-Up Notifikasi jika klik Episode 4+)
    await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isLockedDramaClick
          ? {
              callback_query_id: cb.id,
              text: `🔒 EPISODE ${lockedEpRequested} s/d TAMAT TERKUNCI!\n\nMiliki versi FULL di JUALIN AJA untuk membuka seluruh episode + Video Bersih Siap Upload ke YouTube Shorts, TikTok, Reels & FB Pro!`,
              show_alert: true
            }
          : { callback_query_id: cb.id }
      )
    });

    // 1. Order Produk (Klik Tombol Paket Software)
    if (action.startsWith('buy_')) {
      // Matikan mode AI jika sebelumnya aktif agar upload bukti bayar tidak masuk ke Text-to-Video
      await setUserAiState(env, chatId, null);

      const parts = action.replace('buy_', '').split('_ref_');
      const prodKey = resolveProductKey(parts[0]) || 'reddit_pro';
      let refCode = (parts[1] || 'direct').trim();

      // Jika refCode masih 'direct', cek apakah pembeli sudah punya upline di sistem
      if (!refCode || refCode === 'direct') {
        refCode = await getUserReferrer(env, chatId);
      }

      const prod = PRODUCTS[prodKey];
      // Simpan ke D1 + KV + Memory agar saat kirim foto/HWID 100% sinkron ke produk ini!
      await savePendingOrder(env, chatId, prodKey, refCode, buyerName);

      const caption = generateQrisCaption(prod.name, prod.formattedPrice, refCode, prod.hwidExample);
      await sendTelegramPhoto(chatId, CONFIG.QRIS_IMAGE_URL, caption);

      // Notifikasi Admin Ada Lead Baru
      await sendTelegramMessage(CONFIG.ADMIN_TELEGRAM_ID,
        `🛒 *LEAD BARU MASUK!*\n\n` +
        `👤 *Pembeli:* ${buyerName} (\`${chatId}\`)\n` +
        `📦 *Paket:* ${prod.name} (${prod.formattedPrice})\n` +
        `👥 *Afiliator (Tier 1):* \`${refCode}\`\n` +
        `⏳ *Status:* Menunggu transfer & upload bukti scan QRIS`
      );
    }

    // 1B. MENU FITUR AI GRATIS & GENERATE DRAMA (TRIAL EP 1-3)
    else if (action === 'ai_menu') {
      await setUserAiState(env, chatId, null);
      await sendAiStudioMenu(chatId);
    }
    else if (action === 'drama_menu') {
      await setUserAiState(env, chatId, null);
      await sendDramaStudioMenu(chatId, env);
    }
    else if (action.startsWith('drama_cat:')) {
      await setUserAiState(env, chatId, null);
      const parts = action.replace('drama_cat:', '').split(':');
      const typeTwoId = parseInt(parts[0]) || 0;
      const langMode = parts[1] || 'in';
      await handleDramaCategoryBrowse(chatId, env, typeTwoId, langMode);
    }
    else if (action.startsWith('drama_pick:')) {
      await setUserAiState(env, chatId, null);
      const bookId = action.replace('drama_pick:', '').trim();
      await handleDramaPickItem(chatId, env, bookId);
    }
    else if (action.startsWith('drama_ep:')) {
      await setUserAiState(env, chatId, null);
      const parts = action.replace('drama_ep:', '').split(':');
      const bookId = parts[0] || '';
      const epNum = parseInt(parts[1]) || 1;
      await handleDramaEpisodeTrial(chatId, env, bookId, epNum, workerOrigin);
    }
    else if (action.startsWith('drama_lock:')) {
      await setUserAiState(env, chatId, null);
      const bookId = action.replace('drama_lock:', '').trim();
      await handleDramaLockedUpsell(chatId, env, bookId);
    }
    else if (action.startsWith('drama_preset:')) {
      const idx = parseInt(action.replace('drama_preset:', '').trim()) || 0;
      const presetIdea = DRAMA_STORY_PRESETS[idx] || DRAMA_STORY_PRESETS[0];
      await setUserAiState(env, chatId, { mode: 'drama_story' });
      await handleUserAiInput(env, chatId, buyerName, `${presetIdea.label} — ${presetIdea.prompt}`, null, workerOrigin, { mode: 'drama_story' });
    }
    else if (action.startsWith('ai_mode:')) {
      const mode = action.replace('ai_mode:', '').trim();
      await handleAiModeSelect(env, chatId, mode);
    }
    else if (action.startsWith('motion_set:')) {
      const presetKey = action.replace('motion_set:', '').trim();
      const preset = MOTION_PRESETS[presetKey] || MOTION_PRESETS['zoom_gold'];
      await setUserAiState(env, chatId, { mode: 'motion', preset: presetKey });
      await sendTelegramMessage(chatId,
        `🕹️ *MOTION CONTROL LOCKED: ${preset.label}*\n\n` +
        `🎥 *Efek Kamera:* ${preset.camera}\n` +
        `✨ *Partikel Visual:* ${preset.fx}\n\n` +
        `Sekarang *kirimkan Foto Produk/Karakter Anda* ATAU *ketik Prompt Teks* ke chat ini!\n` +
        `_(Bot akan langsung merender kamera gerakan ${preset.label} 60 FPS yang siap Anda download jadi MP4/WebM!)_`,
        {
          inline_keyboard: [
            [{ text: '🔄 Ganti Efek Motion Lainnya', callback_data: 'ai_mode:motion' }],
            [{ text: '🔙 Kembali ke Menu AI Gratis', callback_data: 'ai_menu' }]
          ]
        }
      );
    }

    // 2. Admin Menyetujui Pembayaran & Distribusi Komisi 2-Tier
    else if (action.startsWith('approve:')) {
      // Format: approve:buyerId:productKey:sellerId:hwid
      const parts = action.split(':');
      const buyerId = parts[1];
      const prodKey = resolveProductKey(parts[2]) || 'reddit_pro';
      const sellerId = parts[3] || 'direct';
      const hwid = parts.slice(4).join(':').trim();

      await processOrderApproval(env, buyerId, prodKey, sellerId, hwid);
    }

    // 3. Admin Menolak Transaksi
    else if (action.startsWith('reject:')) {
      const buyerId = action.split(':')[1];
      await clearPendingOrder(env, buyerId, 'REJECTED');
      await sendTelegramMessage(buyerId, '❌ Pembayaran belum dapat diverifikasi atau ditolak oleh Admin. Hubungi kami jika ini kekeliruan.');
      await sendTelegramMessage(CONFIG.ADMIN_TELEGRAM_ID, `⚠️ Pembelian oleh user \`${buyerId}\` telah ditolak.`);
    }

    // 4. SUB-MENU ALAT PROMOSI & BERITA/INFO
    else if (action === 'promo_menu') {
      await sendPromoMenu(chatId, env);
    }
    else if (action.startsWith('promo_cat:')) {
      const catKey = action.replace('promo_cat:', '').trim();
      await sendPromoCategoryMenu(chatId, env, catKey);
    }
    else if (action === 'news_menu') {
      await sendNewsMenu(chatId, env);
    }
    else if (action.startsWith('promo_view:')) {
      const itemKey = action.replace('promo_view:', '').trim();
      await sendPromoItemDetail(chatId, itemKey, env);
    }
    else if (action.startsWith('admin_recruit:')) {
      const subAction = action.replace('admin_recruit:', '').trim();
      if (subAction === 'menu') {
        await sendAdminRecruitmentMenu(chatId, env);
      } else {
        await sendAdminRecruitmentDetail(chatId, subAction);
      }
    }
    else if (action === 'admin_back_main') {
      await sendTelegramMessage(chatId, '👑 *Menu Utama Admin*', getMainKeyboard(chatId));
    }
    else if (action.startsWith('news_bcast:') && chatId === CONFIG.ADMIN_TELEGRAM_ID) {
      const itemKey = action.replace('news_bcast:', '').trim();
      await broadcastNewsItem(chatId, itemKey, env);
    }
    else if (action.startsWith('promo_edit:') && chatId === CONFIG.ADMIN_TELEGRAM_ID) {
      const itemKey = action.replace('promo_edit:', '').trim();
      const item = await getPromoItem(env, itemKey);
      await setAdminState(env, chatId, `EDIT_PROMO:${itemKey}`);

      const isNews = item && item.category === 'news';
      await sendTelegramMessage(chatId,
        `✏️ *MODE UPDATE ${isNews ? 'BERITA / INFO / REFERRAL' : 'ALAT PROMOSI'}: ${item ? item.title : itemKey}*\n\n` +
        `Silakan langsung *Copy-Paste (Copas)* teks baru Anda ke chat ini sekarang!\n\n` +
        `✅ *Bisa Teks Saja* atau *Kirim Foto/Video + Caption sekaligus*.\n` +
        (isNews
          ? `✅ Seluruh link referral/affiliate eksternal yang Anda tulis akan *tampil 100% utuh apa adanya* untuk diklik oleh semua member!\n\n`
          : `✅ Link referral unik masing-masing member akan *otomatis ditempelkan oleh bot* di bagian bawah (atau di posisi kata \`{LINK}\` jika Anda menuliskannya).\n\n`) +
        `_(Ketik /batal jika ingin membatalkan)_`
      );
    }
    else if (action.startsWith('promo_add:') && chatId === CONFIG.ADMIN_TELEGRAM_ID) {
      const category = action.replace('promo_add:', '').trim();
      await setAdminState(env, chatId, `ADD_PROMO:${category}`);

      const catLabel = category === 'game' ? 'GAME BARU' : (category === 'news' ? 'BERITA / INFO / REFERRAL LAIN' : 'SOFTWARE BARU');
      await sendTelegramMessage(chatId,
        `➕ *TAMBAH SUB-MENU (${catLabel})*\n\n` +
        `Silakan langsung *Copas* ke chat ini dengan format:\n` +
        `*Baris Pertama:* Judul Tombol Sub-Menu (misal: \`💎 Garapan Cuan Baru 2026\`)\n` +
        `*Baris Kedua dst:* Isi teks lengkap & link referral Anda...\n\n` +
        `✅ Boleh juga kirim *Foto/Video dengan Caption* (Baris pertama caption otomatis jadi nama tombol sub-menu!).\n` +
        `_(Ketik /batal jika ingin membatalkan)_`
      );
    }
    else if (action.startsWith('promo_del:') && chatId === CONFIG.ADMIN_TELEGRAM_ID) {
      const itemKey = action.replace('promo_del:', '').trim();
      const oldItem = await getPromoItem(env, itemKey);
      await deletePromoItem(env, itemKey);
      await sendTelegramMessage(chatId, `🗑️ Sub-menu (\`${itemKey}\`) berhasil dihapus!`);
      if (oldItem && oldItem.category === 'news') {
        await sendNewsMenu(chatId, env);
      } else {
        await sendPromoMenu(chatId, env);
      }
    }

    return;
  }

  // B. PESAN TEKS & MEDIA DARI USER
  if (update.message) {
    const msg = update.message;
    const chatId = String(msg.chat.id);
    const rawText = (msg.text || msg.caption || '').trim();
    const lowerText = rawText.toLowerCase();
    const userName = msg.from ? msg.from.first_name : 'Pengguna';
    const photo = msg.photo;

    // Pastikan user tercatat di sistem (D1 + Memory)
    await ensureUserExists(env, chatId);

    // 0. CEK MODE INPUT COPAS ADMIN (UPDATE / TAMBAH ALAT PROMOSI & BERITA TANPA BUKA CLOUDFLARE)
    if (chatId === CONFIG.ADMIN_TELEGRAM_ID) {
      if (lowerText === '/batal' || lowerText === 'batal') {
        await setAdminState(env, chatId, null);
        await sendTelegramMessage(chatId, '✅ Mode edit/tambah alat promosi dibatalkan.', getMainKeyboard(chatId));
        return;
      }

      const activeState = await getAdminState(env, chatId);
      const isMenuButton = ['🍿 generate drama (ep 1-3)', '🍿 generate drama', '🎁 fitur ai gratis (video & konten)', '📦 beli software', '🔗 link afiliasi saya', '📢 alat promosi', '📰 berita & info', '💳 cek saldo', '💸 tarik saldo', '👑 panduan rekrut afiliasi (admin)'].includes(lowerText) || lowerText.startsWith('/');
      const isHwidMsg = isValidHwidInput(rawText);

      if (activeState && !isMenuButton && !isHwidMsg) {
        const captionOrText = (msg.caption || msg.text || '').trim();
        let mediaType = null;
        let mediaId = null;
        if (photo && photo.length > 0) {
          mediaType = 'photo';
          mediaId = photo[photo.length - 1].file_id;
        } else if (msg.video) {
          mediaType = 'video';
          mediaId = msg.video.file_id;
        }

        if (!captionOrText) {
          await sendTelegramMessage(chatId, '⚠️ Mohon sertakan teks atau caption promosi! Ketik /batal untuk membatalkan.');
          return;
        }

        if (activeState.startsWith('EDIT_PROMO:')) {
          const itemKey = activeState.replace('EDIT_PROMO:', '').trim();
          const existing = await getPromoItem(env, itemKey);
          await upsertPromoItem(env, {
            item_key: itemKey,
            category: existing ? existing.category : 'software',
            title: existing ? existing.title : itemKey,
            content: captionOrText,
            media_type: mediaType,
            media_id: mediaId
          });
          await setAdminState(env, chatId, null);

          await sendTelegramMessage(chatId, `✅ *BERHASIL DISIMPAN!*\nMateri telah diperbarui secara instan. Berikut tampilannya saat dibuka member:`);
          await sendPromoItemDetail(chatId, itemKey, env);
          return;
        }

        if (activeState.startsWith('ADD_PROMO:')) {
          const category = activeState.replace('ADD_PROMO:', '').trim();
          const lines = captionOrText.split('\n');
          const rawTitle = lines[0].trim();
          const bodyContent = lines.slice(1).join('\n').trim() || rawTitle;
          const prefix = category === 'game' ? 'game_' : (category === 'news' ? 'news_' : 'soft_');
          const slug = rawTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || Date.now().toString();
          const itemKey = `${prefix}${slug}`;
          const hasIcon = ['🎮', '💻', '🔥', '📱', '📰', '💎', '🎉', '🚀', '🔵', '💼', '📌', '🐦', '🛒'].some(ic => rawTitle.startsWith(ic));
          const finalTitle = hasIcon
            ? rawTitle
            : (category === 'game' ? `🎮 ${rawTitle}` : (category === 'news' ? `📰 ${rawTitle}` : `💻 ${rawTitle}`));

          await upsertPromoItem(env, {
            item_key: itemKey,
            category,
            title: finalTitle,
            content: bodyContent,
            media_type: mediaType,
            media_id: mediaId
          });
          await setAdminState(env, chatId, null);

          await sendTelegramMessage(chatId, `✅ *SUB-MENU BARU BERHASIL DITAMBAHKAN:* *${finalTitle}*!`);
          await sendPromoItemDetail(chatId, itemKey, env);
          return;
        }
      }
    }

    // 1. COMMAND: /start DENGAN PARAMETER (buy_, pair_, ref_)
    if (lowerText.startsWith('/start')) {
      const parts = rawText.split(/\s+/);
      const startParam = parts[1] || '';

      // A. Deep Link Beli Langsung dari Software Desktop / Landing Page (/start buy_<prodKey>_ref_<refCode>)
      if (startParam.toLowerCase().startsWith('buy_')) {
        const rawBuy = startParam.slice(4);
        const buyParts = rawBuy.split('_ref_');
        const prodKey = resolveProductKey(buyParts[0]) || 'reddit_pro';
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

        await sendTelegramMessage(CONFIG.ADMIN_TELEGRAM_ID,
          `🛒 *LEAD BARU MASUK (DEEP LINK)!*\n\n` +
          `👤 *Pembeli:* ${userName} (\`${chatId}\`)\n` +
          `📦 *Paket:* ${prod.name} (${prod.formattedPrice})\n` +
          `👥 *Afiliator (Tier 1):* \`${refCode}\`\n` +
          `⏳ *Status:* Menunggu transfer & upload bukti scan QRIS`
        );
        return;
      }

      // B. Pairing APK -> Bot (/start pair_<token>)
      if (startParam.startsWith('pair_')) {
        const token = startParam.replace('pair_', '').trim();
        if (env.DB) {
          await ensureGameWalletsTable(env.DB);
          const existing = await env.DB.prepare('SELECT * FROM users WHERE app_pair_token = ?').bind(token).first();
          if (existing) {
            await env.DB.prepare('UPDATE users SET telegram_id = ? WHERE app_pair_token = ?').bind(chatId, token).run();
          } else {
            await env.DB.prepare(
              'INSERT INTO users (telegram_id, app_pair_token) VALUES (?, ?) ON CONFLICT(telegram_id) DO UPDATE SET app_pair_token = ?'
            ).bind(chatId, token, token).run();
          }
          await env.DB.prepare('UPDATE game_wallets SET telegram_id = ? WHERE pair_token = ?').bind(chatId, token).run();
        }
        await sendTelegramMessage(chatId,
          `✅ *PAIRING BERHASIL!*\n\n` +
          `Aplikasi Android (APK) Anda telah terhubung dengan akun Telegram ini.\n` +
          `Dompet masing-masing game dan komisi afiliasi Anda kini tersinkronisasi secara otomatis!`,
          getMainKeyboard(chatId)
        );
        return;
      }

      // C. Referral Sponsor Afiliasi (/start ref_<uplineId>)
      if (startParam.startsWith('ref_')) {
        const uplineId = startParam.replace('ref_', '').trim();
        await setUserReferrerIfEmpty(env, chatId, uplineId, userName);
      }

      // Menu Utama Sambutan
      await setUserAiState(env, chatId, null);
      await sendTelegramMessage(chatId,
        `Halo ${userName}! 👋\n` +
        `Selamat datang di *AppDock Hub Ecosystem*.\n\n` +
        `🎁 *BARU! STUDIO AI GRATIS (Text-to-Video HD, Motion Control & Arena AI)* kini tersedia gratis langsung di bot ini!\n\n` +
        `🚀 *Pusat Software Otomatisasi & Bisnis Digital 2026*\n` +
        `Dapatkan software otomatisasi kelas industri dan bangun passive income harian via *Sistem Afiliasi 2-Tier*:\n\n` +
        `🥇 *Tier 1 (Direct Seller):* Komisi 30% (*Rp 29.700 – Rp 89.700* / software)\n` +
        `🥈 *Tier 2 (Sponsor Tim):* Komisi Pasif 5% (*Rp 4.950 – Rp 14.950* / penjualan tim)\n\n` +
        `Gunakan menu tombol di bawah untuk navigasi:`,
        getMainKeyboard(chatId)
      );
      return;
    }

    // 1B. MENU: 🍿 GENERATE DRAMA (TRIAL EPISODE 1-3)
    if (
      lowerText === '🍿 generate drama (ep 1-3)' ||
      lowerText === '🍿 generate drama' ||
      lowerText === '/drama' ||
      lowerText === 'drama'
    ) {
      await setUserAiState(env, chatId, null);
      await sendDramaStudioMenu(chatId, env);
      return;
    }

    // 1C. MENU: 🎁 FITUR AI GRATIS (VIDEO & KONTEN)
    if (
      lowerText === '🎁 fitur ai gratis (video & konten)' ||
      lowerText === '🎁 fitur ai gratis' ||
      lowerText === '/ai' ||
      lowerText === '/gratis' ||
      lowerText === '/video' ||
      lowerText === '/motion'
    ) {
      await setUserAiState(env, chatId, null);
      await sendAiStudioMenu(chatId);
      return;
    }

    // Jika user klik tombol menu utama lainnya, matikan state AI agar tidak bentrok
    if (['📦 beli software', '🔗 link afiliasi saya', '📢 alat promosi', '📰 berita & info', '💳 cek saldo', '💸 tarik saldo', '/buy', '/beli', '/affiliate', '/link', '/promosi', '/berita', '/saldo', '/tarik'].includes(lowerText)) {
      await setUserAiState(env, chatId, null);
    }

    // 2. MENU: 📦 BELI SOFTWARE
    if (lowerText === '📦 beli software' || lowerText === '/buy' || lowerText === 'beli' || lowerText === '/beli') {
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
        `📦 *KATALOG SOFTWARE DIGITAL RESMI:*\n\n` +
        `Pilih software otomatisasi yang ingin Anda aktifkan lisensinya:\n` +
        `_1 Lisensi = 1 Perangkat Fisik (HWID Locked)_`,
        keyboard
      );
      return;
    }

    // 3. MENU: 🔗 LINK AFILIASI SAYA (2-TIER FUNNEL + WEB LANDING PAGE + LINK PLAY STORE REFERRAL)
    if (lowerText === '🔗 link afiliasi saya' || lowerText === '/affiliate' || lowerText === '/link' || lowerText === '/daftar' || lowerText.includes('afiliasi')) {
      const webCatalogLink = `https://appdockhub.com/?ref=${chatId}`;
      const gameRefLink = `https://appdockhub.com/play?ref=${chatId}`;
      const botRefLink = `https://t.me/${CONFIG.BOT_USERNAME}?start=ref_${chatId}`;

      await sendTelegramMessage(chatId,
        `🌟 *PROGRAM KEMITRAAN AFILIASI 2-TIER APPDOCK HUB*\n\n` +
        `Pilih link sesuai target promosi Anda (semuanya otomatis mengunci referral Anda untuk *Semua Game & Semua Software*):\n\n` +
        `🌐 *1. Link Web Katalog Utama (Semua Produk):*\n` +
        `\`${webCatalogLink}\`\n\n` +
        `🚀 *2. Link Landing Page Penjualan Per Produk:*\n` +
        `• *Jualin Aja:* \`https://appdockhub.com/jualinaja.html?ref=${chatId}\`\n` +
        `• *Reddit Pro:* \`https://appdockhub.com/redit.html?ref=${chatId}\`\n` +
        `• *Facebook Pro:* \`https://appdockhub.com/facebook.html?ref=${chatId}\`\n` +
        `• *TikTok Pro:* \`https://appdockhub.com/tiktok.html?ref=${chatId}\`\n` +
        `• *LinkedIn Pro:* \`https://appdockhub.com/linkedin.html?ref=${chatId}\`\n` +
        `• *Pinterest Pro:* \`https://appdockhub.com/pinterest.html?ref=${chatId}\`\n` +
        `• *X (Twitter) Pro:* \`https://appdockhub.com/x.html?ref=${chatId}\`\n\n` +
        `🎮 *3. Link Download Game Play Store:*\n` +
        `\`${gameRefLink}\`\n\n` +
        `🤖 *4. Link Direct Bot Telegram:*\n` +
        `\`${botRefLink}\`\n\n` +
        `🔥 *Keuntungan Referral Anda:*\n` +
        `• *Bonus Level Game:* Dapatkan *Rp 50* setiap referral menembus kelipatan 10 level (hingga Level 2000 per game)!\n` +
        `• *Tier 1 (Jual Software - 30%):* *Rp 29.700* (Software Pro Rp 99rb) s/d *Rp 89.700* (Jualin Aja Rp 299rb) per lisensi!\n` +
        `• *Tier 2 (Komisi Tim Pasif - 5%):* *Rp 4.950 – Rp 14.950* setiap kali mitra referral Anda berhasil menjual software!\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `💡 *TRIK CEPAT BANJIR PEMBELI & KOMISI (CUAN BESAR):*\n` +
        `Bikin video di *YouTube Shorts / TikTok* atau lakukan *Live Streaming* pamer fitur bot ini (bikin Drama China/Indo viral & video AI gratis)! Taruh link referral di bio/komentar: penonton yang coba bot ini & beli software = *Komisi 30% langsung masuk ke dompet Anda!*`,
        {
          inline_keyboard: [
            [{ text: '🎥 Buka Panduan Live Stream & Shorts Cuan', callback_data: 'promo_view:promo_live_shorts' }],
            [{ text: '📢 Buka Semua Alat Promosi Siap Pakai', callback_data: 'promo_menu' }]
          ]
        }
      );
      return;
    }

    // 3B. MENU: 📢 ALAT PROMOSI
    if (lowerText === '📢 alat promosi' || lowerText === '/promosi' || lowerText === 'alat promosi' || lowerText === 'promosi') {
      await sendPromoMenu(chatId, env);
      return;
    }

    // 3C. MENU: 📰 BERITA & INFO
    if (lowerText === '📰 berita & info' || lowerText === '/berita' || lowerText === '/info' || lowerText === 'berita' || lowerText === 'info') {
      await sendNewsMenu(chatId, env);
      return;
    }

    // 3D. MENU KHUSUS ADMIN: PANDUAN REKRUT AFILIASI MASSAL
    if (
      lowerText === '👑 panduan rekrut afiliasi (admin)' ||
      lowerText === '/admin' ||
      lowerText === '/rekrut' ||
      lowerText === 'admin' ||
      lowerText === 'rekrut'
    ) {
      if (String(chatId) === CONFIG.ADMIN_TELEGRAM_ID) {
        await sendAdminRecruitmentMenu(chatId, env);
      } else {
        await sendTelegramMessage(chatId, '⛔ Menu ini khusus untuk Administrator sistem.');
      }
      return;
    }

    // 4. MENU: 💳 CEK SALDO
    if (lowerText === '💳 cek saldo' || lowerText === '/saldo' || lowerText === 'saldo') {
      const u = await getUserData(env, chatId);
      const bDirect = u.balance_direct || 0;
      const bTeam = u.balance_team || 0;
      const bAdsLegacy = u.balance_ads || 0;
      let gameWallets = [];

      if (env.DB) {
        try {
          await ensureGameWalletsTable(env.DB);
          const gwRes = await env.DB.prepare(
            'SELECT game_id, game_name, balance FROM game_wallets WHERE telegram_id = ? OR (pair_token = ? AND pair_token != "") ORDER BY balance DESC'
          ).bind(chatId, u.app_pair_token || '').all();
          gameWallets = gwRes?.results || [];
        } catch (_) {}
      }

      const affiliateTotal = bDirect + bTeam;
      let gamesSection = '';

      if (gameWallets.length > 0) {
        gameWallets.sort((a, b) => (b.balance || 0) - (a.balance || 0));
        for (let i = 0; i < gameWallets.length; i++) {
          const g = gameWallets[i];
          const rawBal = g.balance || 0;
          const combinedBal = i === 0 ? (rawBal + affiliateTotal) : rawBal;
          const statusWd = combinedBal >= 50000 ? '✅ Siap WD' : '🔒 Min. WD Rp 50.000';
          const bonusTag = (i === 0 && affiliateTotal > 0)
            ? ` _(Game Rp ${rawBal.toLocaleString('id-ID')} + Komisi Software Rp ${affiliateTotal.toLocaleString('id-ID')})_`
            : '';
          gamesSection += `🎮 *${g.game_name}:* *Rp ${combinedBal.toLocaleString('id-ID')}*${bonusTag} — *${statusWd}*\n`;
        }
      } else {
        const combinedBal = bAdsLegacy + affiliateTotal;
        const statusWd = combinedBal >= 50000 ? '✅ Siap WD' : '🔒 Min. WD Rp 50.000';
        const bonusTag = affiliateTotal > 0
          ? ` _(Game Rp ${bAdsLegacy.toLocaleString('id-ID')} + Komisi Software Rp ${affiliateTotal.toLocaleString('id-ID')})_`
          : '';
        gamesSection = `🎮 *Cyber Orbit:* *Rp ${combinedBal.toLocaleString('id-ID')}*${bonusTag} — *${statusWd}*\n`;
      }

      await sendTelegramMessage(chatId,
        `💳 *RINCIAN DOMPET EKOSISTEM ANDA*\n\n` +
        `🤝 *KOMISI PENJUALAN SOFTWARE & TIM:*\n` +
        `🥇 Komisi Langsung (Tier 1 - 30%): *Rp ${bDirect.toLocaleString('id-ID')}*\n` +
        `🥈 Komisi Pasif Tim (Tier 2 - 5%): *Rp ${bTeam.toLocaleString('id-ID')}*\n` +
        `💵 Total Komisi Software: *Rp ${affiliateTotal.toLocaleString('id-ID')}*\n` +
        `_(Otomatis digabungkan ke dompet game dengan saldo terbesar Anda!)_\n\n` +
        `🕹️ *DOMPET MASING-MASING GAME (TERPISAH):*\n` +
        gamesSection +
        `-----------------------------------------\n` +
        `ℹ️ *Ketentuan Pencairan:*\n` +
        `• Saldo antar-game bersifat terpisah (tidak dapat digabungkan).\n` +
        `• *Keistimewaan Penjual Software:* Komisi penjualan software otomatis digabung dengan *1 game yang saldonya paling besar* agar langsung mempercepat pencairan *Rp 50.000*!`
      );
      return;
    }

    // 5. MENU: 💸 TARIK SALDO
    if (lowerText === '💸 tarik saldo' || lowerText === '/tarik' || lowerText === 'tarik') {
      let withdrawableTotal = 0;
      let eligibleSources = [];
      const u = await getUserData(env, chatId);
      const affBal = (u.balance_direct || 0) + (u.balance_team || 0);
      let gwList = [];

      if (env.DB) {
        try {
          await ensureGameWalletsTable(env.DB);
          const gwRes = await env.DB.prepare(
            'SELECT game_id, game_name, balance FROM game_wallets WHERE telegram_id = ? OR (pair_token = ? AND pair_token != "") ORDER BY balance DESC'
          ).bind(chatId, u.app_pair_token || '').all();
          gwList = gwRes?.results || [];
        } catch (_) {}
      }

      if (gwList.length > 0) {
        gwList.sort((a, b) => (b.balance || 0) - (a.balance || 0));
        for (let i = 0; i < gwList.length; i++) {
          const g = gwList[i];
          const effectiveBal = i === 0 ? ((g.balance || 0) + affBal) : (g.balance || 0);
          if (effectiveBal >= 50000) {
            withdrawableTotal += effectiveBal;
            eligibleSources.push(
              i === 0 && affBal > 0
                ? `${g.game_name} + Komisi Software (Rp ${effectiveBal.toLocaleString('id-ID')})`
                : `${g.game_name} (Rp ${effectiveBal.toLocaleString('id-ID')})`
            );
          }
        }
      } else {
        const effectiveBal = (u.balance_ads || 0) + affBal;
        if (effectiveBal >= 50000) {
          withdrawableTotal += effectiveBal;
          eligibleSources.push(`Cyber Orbit + Komisi Software (Rp ${effectiveBal.toLocaleString('id-ID')})`);
        }
      }

      if (withdrawableTotal < 50000) {
        await sendTelegramMessage(chatId,
          `⚠️ *BELUM ADA DOMPET YANG MENCAPAI RP 50.000*\n\n` +
          `Sesuai kebijakan *Dompet Game Terpisah*, saldo dari game yang berbeda tidak dapat digabungkan.\n\n` +
          `💡 *Tips Cepat Cair:* Jual 1 lisensi software lewat link afiliasi Anda! Komisi penjualan software (*Rp 29.700 – Rp 89.700/closing*) akan *otomatis digabungkan dengan dompet game Anda yang saldonya paling besar* sehingga langsung siap ditarik!`
        );
        return;
      }

      await sendTelegramMessage(chatId,
        `💸 *FORM PENCAIRAN SALDO (E-WALLET / BANK)*\n\n` +
        `✅ Dompet Siap Cair: *${eligibleSources.join(', ')}*\n` +
        `💵 Total Dapat Ditarik: *Rp ${withdrawableTotal.toLocaleString('id-ID')}*\n\n` +
        `Silakan balas pesan ini dengan format:\n` +
        `\`tarik <Jumlah> <DANA/GoPay/OVO/BCA> <Nomor Rekening> <Nama Pemilik>\`\n\n` +
        `Contoh:\n` +
        `\`tarik ${withdrawableTotal} DANA 08123456789 Budi Santoso\``
      );
      return;
    }

    // 6. PROSES FORM PENARIKAN
    if (lowerText.startsWith('tarik ') && rawText.split(/\s+/).length >= 5) {
      const words = rawText.split(/\s+/);
      const amount = parseInt(words[1]);
      const provider = words[2].toUpperCase();
      const accountNo = words[3];
      const accountName = words.slice(4).join(' ');

      if (isNaN(amount) || amount < 50000) {
        await sendTelegramMessage(chatId, '⚠️ Nominal penarikan minimal Rp 50.000!');
        return;
      }

      const u = await getUserData(env, chatId);
      const affBal = (u.balance_direct || 0) + (u.balance_team || 0);
      let gwList = [];

      if (env.DB) {
        try {
          await ensureGameWalletsTable(env.DB);
          const gwRes = await env.DB.prepare(
            'SELECT pair_token, game_id, game_name, balance FROM game_wallets WHERE telegram_id = ? OR (pair_token = ? AND pair_token != "") ORDER BY balance DESC'
          ).bind(chatId, u.app_pair_token || '').all();
          gwList = gwRes?.results || [];
          gwList.sort((a, b) => (b.balance || 0) - (a.balance || 0));
        } catch (_) {}
      }

      let eligibleTotal = 0;
      if (gwList.length > 0) {
        for (let i = 0; i < gwList.length; i++) {
          const eff = i === 0 ? ((gwList[i].balance || 0) + affBal) : (gwList[i].balance || 0);
          if (eff >= 50000) eligibleTotal += eff;
        }
      } else {
        const eff = (u.balance_ads || 0) + affBal;
        if (eff >= 50000) eligibleTotal += eff;
      }

      if (eligibleTotal < amount) {
        await sendTelegramMessage(
          chatId,
          `⚠️ Saldo dompet yang memenuhi syarat (>= Rp 50.000) tidak mencukupi! Saldo siap cair: Rp ${eligibleTotal.toLocaleString('id-ID')}`
        );
        return;
      }

      let rem = amount;
      if (gwList.length > 0 && env.DB) {
        for (let i = 0; i < gwList.length; i++) {
          if (rem <= 0) break;
          const g = gwList[i];
          const gb = g.balance || 0;
          const eff = i === 0 ? (gb + affBal) : gb;
          if (eff >= 50000) {
            if (i === 0 && affBal > 0) {
              let d = u.balance_direct || 0;
              let t = u.balance_team || 0;
              const cutD = Math.min(d, rem); rem -= cutD; d -= cutD;
              const cutT = Math.min(t, rem); rem -= cutT; t -= cutT;
              await updateUserBalances(env, chatId, d, t, u.balance_ads || 0);
            }
            if (rem > 0 && gb > 0) {
              const cutG = Math.min(gb, rem);
              rem -= cutG;
              const newGb = gb - cutG;
              await env.DB.prepare(
                'UPDATE game_wallets SET balance = ? WHERE pair_token = ? AND game_id = ?'
              ).bind(newGb, g.pair_token, g.game_id).run();
              if (g.game_id === 'cyber_orbit') {
                await env.DB.prepare('UPDATE users SET balance_ads = ? WHERE telegram_id = ?').bind(newGb, chatId).run();
              }
            }
          }
        }
      } else {
        let d = u.balance_direct || 0;
        let t = u.balance_team || 0;
        let a = u.balance_ads || 0;
        const cutD = Math.min(d, rem); rem -= cutD; d -= cutD;
        const cutT = Math.min(t, rem); rem -= cutT; t -= cutT;
        const cutA = Math.min(a, rem); rem -= cutA; a -= cutA;
        await updateUserBalances(env, chatId, d, t, a);
      }

      await sendTelegramMessage(CONFIG.ADMIN_TELEGRAM_ID,
        `🚨 *REQUEST PENCAIRAN SALDO BARU!*\n\n` +
        `👤 User: *${userName}* (\`${chatId}\`)\n` +
        `💰 Nominal: *Rp ${amount.toLocaleString('id-ID')}*\n` +
        `🏦 Provider: *${provider}*\n` +
        `🔢 No Rekening/HP: \`${accountNo}\`\n` +
        `📝 Atas Nama: *${accountName}*\n\n` +
        `Silakan transfer lalu kirim bukti ke user.`
      );

      await sendTelegramMessage(chatId,
        `✅ Permintaan pencairan *Rp ${amount.toLocaleString('id-ID')}* telah diteruskan ke Admin.\n` +
        `Dana akan ditransfer ke *${provider} (${accountNo})* dalam waktu maks 1x24 jam kerja.`
      );
      return;
    }

    // 6B. PROSES INPUT FITUR AI GRATIS (TEXT-TO-VIDEO, MOTION CONTROL, DLL)
    const isHwidInput = isValidHwidInput(rawText);
    if (!isHwidInput) {
      const userAiState = await getUserAiState(env, chatId);
      if (userAiState && userAiState.mode) {
        if (lowerText === '/batal' || lowerText === 'batal') {
          await setUserAiState(env, chatId, null);
          await sendTelegramMessage(chatId, '✅ Mode AI Gratis telah ditutup. Gunakan menu di bawah:', getMainKeyboard(chatId));
          return;
        }
        await handleUserAiInput(env, chatId, userName, rawText, photo, workerOrigin, userAiState);
        return;
      }
    }

    // 7. USER MENGIRIM BUKTI FOTO ATAU HWID
    if (photo || isHwidInput) {
      // Ambil pesanan pending terakhir milik pembeli (dari D1 / KV / Memory)
      const pendingOrder = await getPendingOrder(env, chatId);

      // Jika user hanya kirim foto bukti transfer (tanpa kode HWID di caption)
      if (photo && !isHwidInput) {
        const currentProdKey = pendingOrder ? pendingOrder.productKey : null;
        const currentProd = currentProdKey ? PRODUCTS[currentProdKey] : null;
        const prodTitle = currentProd
          ? ` untuk *${currentProd.name} (${currentProd.formattedPrice})*`
          : '';
        const hwidSample = currentProd ? currentProd.hwidExample : 'HWID-XXXX-XXXX';

        await sendTelegramMessage(chatId,
          `📸 *Bukti transfer${prodTitle} diterima!*\n\n` +
          `Sekarang kirimkan *Kode HWID* perangkat Anda untuk pengikatan lisensi (contoh: \`${hwidSample}\`).`
        );
        return;
      }

      const hwid = rawText.trim().toUpperCase();

      // Sinkronisasi Produk Secara Cerdas:
      // 1. Cek prefix HWID terlebih dahulu (karena setiap software punya prefix HWID yang spesifik:
      //    RD-HWID -> Reddit, FB-HWID -> FB, TIKTOK-HWID -> TikTok, IN-HWID -> LinkedIn,
      //    PIN-HWID -> Pinterest, X-HWID -> X, HWID- / JA-HWID -> Jualin Aja)
      // 2. Jika ada pendingOrder dari klik tombol "Beli", prioritaskan pendingOrder KECUALI HWID yang dikirim
      //    memiliki prefix eksplisit software lain. Jika pendingOrder tidak ditemukan (misal worker restart),
      //    gunakan hasil deteksi dari prefix HWID!
      const detectedFromHwid = detectProductKeyFromHwid(hwid);
      let pendingProd = 'soft_a';
      let pendingSeller = 'direct';

      if (pendingOrder && pendingOrder.productKey) {
        pendingProd = pendingOrder.productKey;
        pendingSeller = pendingOrder.sellerId || 'direct';
        // Jika HWID memiliki prefix spesifik dan cocok dengan produk di katalog, sinkronkan:
        if (detectedFromHwid && detectedFromHwid !== pendingProd) {
          // Jika user baru saja klik produk X tapi mengirim HWID eksplisit produk Y (atau sebaliknya),
          // bila HWID diawali 'HWID-' itu memang format resmi Jualin Aja ('soft_a')
          pendingProd = detectedFromHwid;
        }
      } else if (detectedFromHwid) {
        pendingProd = detectedFromHwid;
        pendingSeller = await getUserReferrer(env, chatId);
      } else {
        pendingProd = 'reddit_pro';
        pendingSeller = await getUserReferrer(env, chatId);
      }

      const prod = PRODUCTS[pendingProd] || PRODUCTS['soft_a'];
      const comm1 = Math.round(prod.price * CONFIG.TIER1_RATE);
      const comm2 = Math.round(prod.price * CONFIG.TIER2_RATE);

      const approvalKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ Approve & Bagikan Komisi 2-Tier', callback_data: `approve:${chatId}:${pendingProd}:${pendingSeller}:${hwid}` },
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
        `👥 *Sponsor Tier 2:* (Komisi 5%: Rp ${comm2.toLocaleString('id-ID')})\n\n` +
        `Periksa bukti transfer di atas sebelum klik tombol di bawah.`,
        approvalKeyboard
      );

      await sendTelegramMessage(chatId,
        `⏳ HWID \`${hwid}\` untuk paket *${prod.name} (${prod.formattedPrice})* diterima.\n` +
        `Admin sedang memverifikasi pembayaran Anda. License Key resmi akan dikirim otomatis ke chat ini setelah diverifikasi.`
      );
      return;
    }

    // Default Fallback
    await sendTelegramMessage(chatId, `Halo ${userName}! Silakan pilih menu di bawah:`, getMainKeyboard(chatId));
  }
}

// ============================================================================
// 5. LOGIKA APPROVAL & KOMISI 2-TIER (TIER 1 = 30%, TIER 2 = 5%)
// ============================================================================
async function processOrderApproval(env, buyerId, productKey, sellerId, hwid) {
  const resolvedKey = resolveProductKey(productKey) || detectProductKeyFromHwid(hwid) || 'reddit_pro';
  const prod = PRODUCTS[resolvedKey] || PRODUCTS['reddit_pro'];
  const t1Amount = Math.round(prod.price * CONFIG.TIER1_RATE); // 30%
  const t2Amount = Math.round(prod.price * CONFIG.TIER2_RATE); // 5%

  // A. Generate Lisensi Baru Terikat HWID (Signature deterministik di blok pertama + kode unik di blok kedua)
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

  // 1. Simpan Lisensi ke Memory Cache & KV agar langsung aktif instan di semua endpoint (/activate, /verify, /check-license)
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
      await env.LICENSE_KV.put(`key:${licenseKey}`, JSON.stringify({
        ...licObj,
        boundHwid: cleanHwid
      }));
    } catch (_) {}
  }

  // 2. Simpan Lisensi & Distribusi Komisi 2-Tier di D1 / Memory / KV
  if (env.DB) {
    try {
      await ensureCoreTables(env.DB);
      await env.DB.prepare(
        'INSERT OR REPLACE INTO licenses (license_key, product_name, hwid, status, activated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)'
      ).bind(licenseKey, prod.name, cleanHwid, 'ACTIVE').run();
    } catch (_) {}
  }

  // Bersihkan status pending order pembeli
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

  if (env.DB) {
    try {
      await env.DB.prepare(
        'INSERT INTO transactions (buyer_telegram_id, product_key, product_name, amount, tier1_seller_id, tier1_commission, tier2_seller_id, tier2_commission, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        cleanBuyerId,
        resolvedKey,
        prod.name,
        prod.price,
        cleanSellerId,
        cleanSellerId !== 'direct' ? t1Amount : 0,
        sponsorTier2Id || 'none',
        sponsorTier2Id ? t2Amount : 0,
        'PAID'
      ).run();
    } catch (_) {}
  }

  // B. Notifikasi ke Pembeli Berisi License Key
  await sendTelegramMessage(cleanBuyerId,
    `🎉 *PEMBAYARAN DISETUJUI & LISENSI RESMI AKTIF!*\n\n` +
    `📦 *Produk:* ${prod.name} (${prod.formattedPrice})\n` +
    `🔑 *License Key:* \`${licenseKey}\`\n` +
    `🖥️ *HWID Terdaftar:* \`${cleanHwid}\`\n\n` +
    `📌 *Panduan Aktivasi:*\n` +
    `1. Buka software *${prod.name}* di perangkat Anda.\n` +
    `2. Masukkan License Key di atas lalu klik Aktivasi.\n` +
    `3. 1 Lisensi terikat 1 Perangkat Fisik (HWID Lock).\n\n` +
    `🤝 Mau dapat penghasilan tambahan (Komisi 30% = Rp ${t1Amount.toLocaleString('id-ID')}/closing)? Bagikan link bot ini di menu *[🔗 Link Afiliasi Saya]*!`
  );

  // C. Notifikasi Instan Tier 1 Seller (30%)
  if (cleanSellerId && cleanSellerId !== 'direct' && cleanSellerId !== cleanBuyerId) {
    await sendTelegramMessage(cleanSellerId,
      `🔥 *KOMISI PENJUALAN MASUK (TIER 1 - 30%)!*\n\n` +
      `Selamat! Pembelian software *${prod.name} (${prod.formattedPrice})* dari link Anda telah lunas.\n` +
      `💰 *Komisi Anda:* *+Rp ${t1Amount.toLocaleString('id-ID')}*\n\n` +
      `Ketik /saldo untuk melihat rincian dompet Anda. Terus gas promosi!`
    );
  }

  // D. Notifikasi Instan Tier 2 Sponsor (5%)
  if (sponsorTier2Id) {
    await sendTelegramMessage(sponsorTier2Id,
      `🚀 *KOMISI PASIF TIM MASUK (TIER 2 - 5%)!*\n\n` +
      `Keren! Mitra tim Anda (\`${cleanSellerId}\`) berhasil menjual 1 lisensi *${prod.name}*!\n` +
      `💰 *Bonus Pasif Tim:* *+Rp ${t2Amount.toLocaleString('id-ID')}*\n\n` +
      `Inilah kekuatan 2-tier passive income! Ajak lebih banyak mitra untuk cuan harian otomatis!`
    );
  }

  // E. Konfirmasi ke Admin
  await sendTelegramMessage(CONFIG.ADMIN_TELEGRAM_ID,
    `✅ *Aktivasi Sukses & Komisi Selesai Didistribusikan!*\n\n` +
    `📦 Produk: *${prod.name} (${prod.formattedPrice})*\n` +
    `🔑 Key: \`${licenseKey}\`\n` +
    `🖥️ HWID: \`${cleanHwid}\`\n` +
    `👤 Pembeli: \`${cleanBuyerId}\`\n` +
    `🥇 Tier 1 (\`${cleanSellerId}\`): Rp ${(cleanSellerId !== 'direct' ? t1Amount : 0).toLocaleString('id-ID')}\n` +
    `🥈 Tier 2 (\`${sponsorTier2Id || 'none'}\`): Rp ${(sponsorTier2Id ? t2Amount : 0).toLocaleString('id-ID')}`
  );
}

// ============================================================================
// HELPER FUNCTIONS (USERS, REFERRALS, TELEGRAM API)
// ============================================================================
async function ensureUserExists(env, telegramId) {
  const cleanId = String(telegramId);
  if (!_MEM_USERS[cleanId]) {
    _MEM_USERS[cleanId] = {
      telegram_id: cleanId,
      referrer_id: null,
      balance_direct: 0,
      balance_team: 0,
      balance_ads: 0,
      app_pair_token: null
    };
  }
  if (env.DB) {
    try {
      await ensureCoreTables(env.DB);
      await env.DB.prepare(
        'INSERT OR IGNORE INTO users (telegram_id, balance_direct, balance_team, balance_ads, ads_watched_today) VALUES (?, 0, 0, 0, 0)'
      ).bind(cleanId).run();
    } catch (_) {}
  }
}

async function getUserData(env, telegramId) {
  const cleanId = String(telegramId);
  await ensureUserExists(env, cleanId);

  if (env.DB) {
    try {
      const u = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(cleanId).first();
      if (u) {
        _MEM_USERS[cleanId] = { ..._MEM_USERS[cleanId], ...u };
        return u;
      }
    } catch (_) {}
  }

  if (env.LICENSE_KV) {
    try {
      const raw = await env.LICENSE_KV.get(`user_profile:${cleanId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        _MEM_USERS[cleanId] = { ..._MEM_USERS[cleanId], ...parsed };
        return _MEM_USERS[cleanId];
      }
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
      await env.DB.prepare(
        'UPDATE users SET balance_direct = ?, balance_team = ?, balance_ads = ? WHERE telegram_id = ?'
      ).bind(directBal, teamBal, adsBal, cleanId).run();
    } catch (_) {}
  }

  if (env.LICENSE_KV) {
    try {
      await env.LICENSE_KV.put(`user_profile:${cleanId}`, JSON.stringify(_MEM_USERS[cleanId]));
    } catch (_) {}
  }
}

async function getUserReferrer(env, telegramId) {
  const cleanId = String(telegramId);
  const u = await getUserData(env, cleanId);
  if (u && u.referrer_id && u.referrer_id !== 'direct' && u.referrer_id !== cleanId) {
    return String(u.referrer_id);
  }
  if (env.LICENSE_KV) {
    try {
      const ref = await env.LICENSE_KV.get(`user_ref:${cleanId}`);
      if (ref && ref !== 'direct' && ref !== cleanId) return ref;
    } catch (_) {}
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

  if (env.LICENSE_KV) {
    try {
      await env.LICENSE_KV.put(`user_ref:${cleanId}`, cleanUpline, { expirationTtl: 86400 * 90 });
      await env.LICENSE_KV.put(`user_profile:${cleanId}`, JSON.stringify(_MEM_USERS[cleanId]));
    } catch (_) {}
  }

  await sendTelegramMessage(cleanUpline,
    `👥 *MITRA TIM BARU TERDAFTAR!*\n\n` +
    `Pengguna baru *${userName}* bergabung lewat link referral Anda.\n` +
    `Anda berhak atas *Komisi Langsung 30% (Tier 1)* jika mereka membeli software, serta *Komisi Pasif 5% (Tier 2)* dari setiap penjualan software yang mereka hasilkan! 🔥`
  );
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown'
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  // Fallback otomatis tanpa parse_mode jika teks/URL hasil copas mengandung simbol underscore (_) tunggal
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
  const body = {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: 'Markdown'
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const plainBody = { chat_id: chatId, photo: photoUrl, caption: (caption || '').replace(/\*/g, '') };
    if (replyMarkup) plainBody.reply_markup = replyMarkup;
    return fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plainBody)
    });
  }
  return res;
}

async function sendTelegramVideo(chatId, videoId, caption, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    video: videoId,
    caption,
    parse_mode: 'Markdown',
    supports_streaming: true
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendVideo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.ok) return res;

  // Fallback 1: Coba sendVideo tanpa parse_mode jika ada karakter Markdown yang bentrok
  const plainBody = {
    chat_id: chatId,
    video: videoId,
    caption: (caption || '').replace(/\*/g, ''),
    supports_streaming: true
  };
  if (replyMarkup) plainBody.reply_markup = replyMarkup;
  const resPlain = await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendVideo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plainBody)
  });
  if (resPlain.ok) return resPlain;

  // Fallback 2: Gunakan sendAnimation (MP4/GIF auto-play inline di Telegram)
  const animBody = {
    chat_id: chatId,
    animation: videoId,
    caption: (caption || '').replace(/\*/g, '')
  };
  if (replyMarkup) animBody.reply_markup = replyMarkup;
  return fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendAnimation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(animBody)
  });
}

// ============================================================================
// 5B. SISTEM ALAT PROMOSI & BERITA DINAMIS (SUPPORT D1 + KV + MEMORY CACHE)
// ============================================================================
const DEFAULT_PROMO_ITEMS = [
  {
    item_key: 'promo_live_shorts',
    category: 'live_stream',
    title: '🔥 Panduan Inti: Trik Live TikTok & Shorts (Komisi 30%)',
    content: '🔥 *TRIK CUAN BESAR: LIVE TIKTOK & SHORTS PAMER BOT AI GRATIS!*\n\n' +
      'Mau banjir pembeli software dan panen komisi *30% (Rp 29.700 – Rp 89.700)* per transaksi tanpa perlu jago jualan?\n\n' +
      'Gunakan fitur gratis di bot ini sebagai *PANCINGAN VIRAL*:\n\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '🎯 *STRATEGI 1: LIVE STREAM TIKTOK / YOUTUBE (Paling Cepat Cuan!)*\n' +
      '1️⃣ Buka Live Streaming di TikTok / YouTube / FB / IG dengan mode Share Screen layar HP.\n' +
      '2️⃣ Tulis Judul Live Menarik:\n' +
      '   👉 *"Uji Coba AI Gratis: Bikin Drama China & Video AI dari Komentar Kalian!"*\n' +
      '3️⃣ Ajak penonton komentar: *"Ketik ide cerita drama atau adegan video kalian di chat live, biar AI buatin langsung!"*\n' +
      '4️⃣ Ketikkan ide penonton ke menu *🍿 Generate Drama* atau *🎬 Text-to-Video* di bot ini. Saat video & dialog klimaksnya keluar, penonton bakal takjub dan penasaran!\n' +
      '5️⃣ Suruh penonton coba sendiri:\n' +
      '   👉 *"Kalian bisa coba gratis sepuasnya ya! Klik LINK di BIO profile saya sekarang!"*\n\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '🎬 *STRATEGI 2: BIKIN VIDEO SHORTS / TIKTOK / REELS (15-30 DETIK)*\n' +
      '1️⃣ Rekam layar HP saat Anda mengetik ide cerita dan saat bot memunculkan naskah klimaks drama / video MP4 AI.\n' +
      '2️⃣ Berikan Hook 3 detik pertama:\n' +
      '   👉 *"Gak nyangka nemu bot Telegram gratis yang bisa bikin video drama China viral secepat ini..."*\n' +
      '3️⃣ Di detik terakhir (Cliffhanger Episode 3): Beri teks: *"Lanjut Episode 4 & coba bot gratisnya di Link Bio ya!"*\n\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '💰 *DARI MANA CUAN ANDA BERASAL?*\n' +
      'Saat penonton klik link referral Anda dan masuk ke bot ini:\n' +
      '✅ Mereka akan melihat katalog software otomatisasi bisnis (Reddit Pro, FB Pro, TikTok Pro, Jualin Aja).\n' +
      '✅ Ketika mereka membeli lisensi, Anda *LANGSUNG DAPAT KOMISI 30%* (Rp 29.700 – Rp 89.700 per software)!\n' +
      '✅ Anda juga dapat *Komisi Pasif Tier-2 (5%)* dari setiap penjualan tim Anda!\n\n' +
      '👇 *Gunakan Link Afiliasi Unik Anda di bawah ini:*\n{LINK}',
    media_type: null,
    media_id: null
  },

  // ==========================================
  // KATEGORI 1: IDE POST TEKS FACEBOOK (fb_post)
  // ==========================================
  {
    item_key: 'fb_post_story_cuan',
    category: 'fb_post',
    title: '📝 Post FB #1: Curhat Modal HP Cuan Tiap Hari (Viral)',
    content: '📝 *IDE POST FACEBOOK #1: STORY CURHAT REBAHAN DAPAT CUAN*\n' +
      '_(Cocok untuk: Status Facebook Pribadi & Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      'Iseng-iseng modal kuota sama HP doang, ternyata beneran bisa ngasilin 😭💸\n\n' +
      'Kemarin nyobain bot Telegram AI yang lagi viral. Fiturnya gokil, bisa bikin video bergerak HD sama naskah drama China cuma dari ketik beberapa kata doang, dan itu GRATIS.\n\n' +
      'Tapi yang bikin kaget, di dalam botnya ada sistem afiliasi software bisnis. Cuma modal share link bot gratisnya ke temen-temen grup, eh ada yang beli software otomatisasi iklannya...\n\n' +
      'Tiba-tiba masuk notifikasi komisi Rp 297.000 langsung cair ke rekening! 🤑\n' +
      'Komisinya 30% per penjualan, tanpa perlu packing barang, tanpa stok produk, sistem yang handle semuanya.\n\n' +
      'Buat temen-temen yang mau coba bot AI gratisnya atau mau ikut jalanin afiliasinya buat tambahan uang jajan, langsung klik link ini ya:\n' +
      '👇👇👇\n' +
      '{LINK}\n\n' +
      'Gratis kok dicoba dulu aja fiturnya! 🔥',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'fb_post_spill_tools',
    category: 'fb_post',
    title: '📝 Post FB #2: Bongkar Trik Pemain Besar Ternak Akun FB',
    content: '📝 *IDE POST FACEBOOK #2: BONGKAR RAHASIA PEMAIN BESAR FB ADS & ORGANIK*\n' +
      '_(Cocok untuk: Grup FB Bisnis Online, Komunitas Digital Marketing, Forum Jualan)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      'Banyak yang nanya: "Bang, kok olshop sebelah bisa posting ke 50 grup Facebook setiap hari tanpa jarinya keriting dan tanpa kena checkpoint/banned?" 🤔\n\n' +
      'Jawabannya simpel: Mereka GAK manual! Mereka pakai SOFTWARE OTOMATISASI.\n\n' +
      'Sekarang udah ada software resmi yang punya fitur:\n' +
      '✅ Anti-Detect Browser Profile (Tiap akun punya sidik jari browser & IP terpisah, anti-banned)\n' +
      '✅ Auto Post ke puluhan Grup & Marketplace terjadwal 24 jam nonstop\n' +
      '✅ Auto Warmup akun baru biar kebal dan trust level tinggi\n' +
      '✅ Sekali klik tinggal tidur, postingan jalan sendiri\n\n' +
      'Gak perlu bayar bulanan mahal-mahal, lisensinya aktif permanen sekali bayar!\n\n' +
      'Penasaran mau lihat demo softwarenya atau mau coba bot otomatisasinya gratis?\n' +
      'Langsung cek di bot resmi sini:\n' +
      '👉 {LINK}\n\n' +
      'Modal satu software, omzet jualan bisa naik 5x lipat! 🚀',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'fb_post_ai_gratis',
    category: 'fb_post',
    title: '📝 Post FB #3: Pancingan Komentar Uji Coba AI Gratis',
    content: '📝 *IDE POST FACEBOOK #3: PANCINGAN KOMENTAR (ALGORITMA VIRAL TINGGI)*\n' +
      '_(Cocok untuk: Status Facebook Singkat & Re-share ke Berbagai Grup)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      'Gila sih... nemu bot Telegram yang bisa bikin Video HD 60 FPS + Naskah Drama China otomatis dalam 5 detik tanpa watermark sama sekali! 🤯🎬\n\n' +
      'Bisa buat bikin konten TikTok, YouTube Shorts, sampai Reels tanpa perlu edit ribet di CapCut. Dan yang paling penting: 100% GRATIS dicoba!\n\n' +
      'Yang mau coba botnya siapa aja?\n' +
      'Komen "MAU" di bawah ya, nanti link botnya langsung aku kirim via Inbox/DM satu per satu 👇👇\n' +
      '(Atau bisa langsung klik link bot resminya di sini):\n' +
      '👉 {LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'fb_post_affiliate_reseller',
    category: 'fb_post',
    title: '📝 Post FB #4: Rekrutmen Afiliasi & Reseller (Komisi 30%)',
    content: '📝 *IDE POST FACEBOOK #4: PELUANG AFILIASI TANPA MODAL*\n' +
      '_(Cocok untuk: Grup Loker, Komunitas Freelancer, IRT & Mahasiswa Cari Cuan)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      'Dicari Partner Afiliasi Digital (Bisa dikerjakan dari HP sambil rebahan):\n\n' +
      'Kerjaannya ngapain?\n' +
      'Cuma membagikan link Bot AI gratis ke sosmed / teman.\n' +
      'Saat ada yang menggunakan bot dan membeli lisensi software otomatisasi (Facebook Pro, TikTok Pro, Jualin Aja, dll), Anda langsung dapat:\n\n' +
      '💰 Komisi 30% per penjualan (Rp 29.700 – Rp 89.700 PER TRANSAKSI)\n' +
      '💰 Bonus Pasif Tier-2: 5% dari setiap penjualan tim Anda\n' +
      '💰 Komisi langsung dicairkan tanpa nunggu berbulan-bulan\n' +
      '💰 Disediakan materi promosi, naskah, dan video siap copas!\n\n' +
      'Tidak perlu modal uang sepeserpun. Cukup daftar dan ambil link referral Anda di sini:\n' +
      '👉 {LINK}\n\n' +
      'Ambil peluangnya sekarang sebelum keduluan yang lain! 🔥',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'fb_post_solusi_jualan_sepi',
    category: 'fb_post',
    title: '📝 Post FB #5: Solusi Jualan Sepi & Capek Promosi Manual',
    content: '📝 *IDE POST FACEBOOK #5: SOLUSI JUALAN SEPI & CAPEK PROMOSI MANUAL*\n' +
      '_(Cocok untuk: Grup Pedagang Online, UMKM, Supplier & Reseller)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      'Jujur deh, siapa di sini yang jualannya masih sepi padahal udah posting manual dari pagi sampai malam? 🥺\n\n' +
      'Masalahnya bukan produk Anda jelek, tapi JANGKAUAN promosi Anda yang kurang luas. Kalau cuma posting 1-2 kali di beranda sendiri, yang lihat cuma keluarga dan teman dekat.\n\n' +
      'Bayangkan kalau Anda punya "Karyawan Digital" yang:\n' +
      '🤖 Otomatis sebar promosi produk Anda ke ratusan grup Facebook tertarget setiap hari\n' +
      '🤖 Jalan otomatis di background tanpa perlu Anda pantau terus-menerus\n' +
      '🤖 Biaya operasional Rp 0 tanpa gaji bulanan!\n\n' +
      'Semua senjata otomatisasi bisnis online ini sudah kumpul jadi satu di ekosistem AppDock Hub:\n' +
      '👉 {LINK}\n\n' +
      'Buktikan sendiri efisiensinya sekarang juga! 📦✨',
    media_type: null,
    media_id: null
  },

  // ==========================================
  // KATEGORI 2: IDE VIDEO SHORTS / TIKTOK / REELS (shorts_video)
  // ==========================================
  {
    item_key: 'shorts_secret_ai_bot',
    category: 'shorts_video',
    title: '🎬 Shorts/TikTok #1: "Nemu Bot AI Rahasia di Telegram"',
    content: '🎬 *IDE VIDEO SHORTS / TIKTOK / REELS #1: NEMU BOT AI RAHASIA*\n' +
      '_(Durasi: 15–25 Detik | Format: Screen Record HP vertikal 9:16)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *PERSIAPAN VIDEO:*\n' +
      'Buka Telegram di HP, siapkan rekam layar saat mengetik ide di bot AppDockHub.\n\n' +
      '🎬 *NASKAH & ADEGAN:*\n' +
      '• *Detik 00-03 (HOOK KUAT):*\n' +
      '  (Tampilkan wajah kaget / teks besar di layar):\n' +
      '  🗣️ Suara: *"Stop buang-buang uang ratusan ribu buat langganan aplikasi AI video! Nemu bot Telegram rahasia yang bisa bikin video HD 100% gratis!"*\n\n' +
      '• *Detik 04-12 (BUKTI DEMO):*\n' +
      '  (Tampilkan layar chat bot):\n' +
      '  Ketik prompt: *"Mobil sport balap di kota cyberpunk malam hari"*\n' +
      '  Tunjukkan saat bot membalas dengan video MP4 bergerak asli + tombol 60 FPS!\n' +
      '  🗣️ Suara: *"Tinggal ketik ide apapun, 5 detik langsung jadi video HD cinematic tanpa watermark!"*\n\n' +
      '• *Detik 13-20 (CALL TO ACTION & GIMMICK):*\n' +
      '  🗣️ Suara: *"Mumpung masih gratis dan belum banyak yang tahu, langsung cobain sekarang. Link botnya udah gue taruh di bio profil ya!"*\n' +
      '  (Tampilkan panah menunjuk ke profil bio).\n\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '👉 *Link Referral Anda untuk di Bio:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'shorts_faceless_drama',
    category: 'shorts_video',
    title: '🎬 Shorts/TikTok #2: Trik Drama China Faceless Jutaan Views',
    content: '🎬 *IDE VIDEO SHORTS / TIKTOK / REELS #2: TRIK DRAMA CHINA FACELESS*\n' +
      '_(Durasi: 20–30 Detik | Format: Vertikal 9:16)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *PERSIAPAN VIDEO:*\n' +
      'Buka menu `🍿 Generate Drama` di bot Telegram.\n\n' +
      '🎬 *NASKAH & ADEGAN:*\n' +
      '• *Detik 00-04 (HOOK RASA PENASARAN):*\n' +
      '  🗣️ Suara: *"Kalian pernah liat akun TikTok yang dapet jutaan views cuma dari upload cuplikan drama China? Ini rahasia bikinnya tanpa modal!"*\n\n' +
      '• *Detik 05-15 (DEMO BOT):*\n' +
      '  (Rekam layar bot men-generate Episode 1, 2, dan 3):\n' +
      '  🗣️ Suara: *"Tinggal masuk ke bot ini, pilih menu Generate Drama, dan naskah klimaks + video vertikalnya langsung dibuatin otomatis!"*\n\n' +
      '• *Detik 16-25 (CLIFFHANGER & CALL TO ACTION):*\n' +
      '  🗣️ Suara: *"Pas di akhir Episode 3 ceritanya gantung banget bikin penonton penasaran! Yang mau lanjut Episode 4 atau mau buat cerita drama kalian sendiri, klik link di bio profil ya!"*\n\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '👉 *Link Referral Anda untuk di Bio:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'shorts_demo_software_auto',
    category: 'shorts_video',
    title: '🎬 Shorts/TikTok #3: Laptop Kerja Sendiri Sebar Iklan Otomatis',
    content: '🎬 *IDE VIDEO SHORTS / TIKTOK / REELS #3: LAPTOP KERJA SENDIRI*\n' +
      '_(Durasi: 15–25 Detik | Format: Rekam Layar Laptop / HP)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *PERSIAPAN VIDEO:*\n' +
      'Rekam layar laptop atau HP yang sedang membuka software otomatisasi Facebook/TikTok atau menu bot.\n\n' +
      '🎬 *NASKAH & ADEGAN:*\n' +
      '• *Detik 00-03 (HOOK VISUAL):*\n' +
      '  (Kamera menyorot tangan lepas dari keyboard, laptop jalan sendiri):\n' +
      '  🗣️ Suara: *"Tangan gue gak nyentuh laptop sama sekali, tapi postingan jualan udah kesebar ke 50 grup Facebook!"*\n\n' +
      '• *Detik 04-14 (PENJELASAN SINGKAT):*\n' +
      '  🗣️ Suara: *"Ini rahasia gue ningkatin omzet toko online tanpa capek posting manual. Software ini punya anti-detect browser, jadi aman dari blokir dan bisa jalan 24 jam nonstop."*\n\n' +
      '• *Detik 15-20 (CALL TO ACTION):*\n' +
      '  🗣️ Suara: *"Lisensinya lagi diskon hemat ratusan ribu hari ini. Info lengkap & cara dapetinnya ada di link bio profil gue!"*\n\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '👉 *Link Referral Anda untuk di Bio:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'shorts_bukti_komisi',
    category: 'shorts_video',
    title: '🎬 Shorts/TikTok #4: Spill Notifikasi Cuan Komisi 30%',
    content: '🎬 *IDE VIDEO SHORTS / TIKTOK / REELS #4: SPILL SALDO & KOMISI AFILIASI*\n' +
      '_(Durasi: 15–20 Detik | Format: POV / Storytelling)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '🎬 *NASKAH & ADEGAN:*\n' +
      '• *Detik 00-04 (HOOK BUKTI REAL):*\n' +
      '  (Tampilkan tangkapan layar chat Telegram notifikasi komisi atau saldo):\n' +
      '  🗣️ Suara: *"Bangun tidur kaget notifikasi Telegram bunyi terus, kirain spam ternyata komisi afiliasi software cair lagi!"*\n\n' +
      '• *Detik 05-13 (CARA KERJA SEDERHANA):*\n' +
      '  🗣️ Suara: *"Padahal kerjaan gue cuma nge-share bot AI gratis ke sosmed. Pas orang-orang pada nyobain dan beli software otomatisasinya, gue dapet komisi 30% bersih tanpa modal!"*\n\n' +
      '• *Detik 14-20 (CALL TO ACTION):*\n' +
      '  🗣️ Suara: *"Yang mau daftar jadi partner afiliasinya mumpung masih gratis pendaftarannya, cek link di bio profil sekarang ya!"*\n\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '👉 *Link Referral Anda untuk di Bio:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'shorts_tutorial_pemula',
    category: 'shorts_video',
    title: '🎬 Shorts/TikTok #5: Tutorial 10 Detik Bikin Video AI di HP',
    content: '🎬 *IDE VIDEO SHORTS / TIKTOK / REELS #5: TUTORIAL KILAT 10 DETIK*\n' +
      '_(Durasi: 15 Detik | Format: Fast Paced Tutorial)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '🎬 *NASKAH & ADEGAN:*\n' +
      '• *Detik 00-02 (TEKS BESAR):* "CARA BIKIN VIDEO AI DARI TELEGRAM 👇"\n' +
      '• *Detik 03-06:* Buka bot @AppDockHub_Bot, pilih menu "Text-to-Video".\n' +
      '• *Detik 07-10:* Ketik ide apa saja (contoh: "Kucing astronot di bulan").\n' +
      '• *Detik 11-13:* Video MP4 HD langsung jadi dalam hitungan detik!\n' +
      '• *Detik 14-15:* 🗣️ Suara: *"Cobain sekarang juga, link bot ada di bio profil!"*\n\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '👉 *Link Referral Anda untuk di Bio:*\n{LINK}',
    media_type: null,
    media_id: null
  },

  // ==========================================
  // BAHAN VIDEO RESMI: JUALIN AJA (5 SCENE SHOWCASE MP4 + WEB DEMO)
  // ==========================================
  {
    item_key: 'video_jualin_scene1',
    category: 'shorts_video',
    title: '🎬 Video Jualin Aja #1: Kena Copyright & 0 Views',
    content: '🎬 *BAHAN PROMOSI VIDEO JUALIN AJA — SCENE 1: INTRO & MASALAH KREATOR*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Capek-capek edit video drama China berjam-jam, pas diupload malah kena klaim hak cipta atau stuck di 0 views? Ini penyebab dan solusinya!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Stop buang waktu edit manual potong klip satu per satu! Sekarang ada software Jualin Aja yang punya engine FFmpeg khusus bikin video drama pendek kamu unik dan 100% aman dari klaim hak cipta algoritma TikTok & FB Pro.\n\n' +
      'Tonton demo 5 scene interaktifnya & klaim lisensi resmi promo hemat sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 1):*\n' +
      'https://appdockhub.com/assets/videos/jualinaja-scene1-intro.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_jualin_scene2',
    category: 'shorts_video',
    title: '🎬 Video Jualin Aja #2: AI Talent & Video Studio',
    content: '🎬 *BAHAN PROMOSI VIDEO JUALIN AJA — SCENE 2: AI TALENT & AFFILIATE STUDIO*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Gak punya kamera bagus? Malu nunjukin muka? Pakai AI Talent di Jualin Aja, video promosi kamu langsung jadi otomatis!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Bikin konten video promosi gak perlu sewa talent mahal. Cukup masukkan naskah skrip, AI studio di Jualin Aja langsung generate model manusia virtual yang ngomong lancar natural plus visual memukau!\n\n' +
      'Tonton demo interaktifnya di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 2):*\n' +
      'https://appdockhub.com/assets/videos/jualinaja-scene2-talent.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_jualin_scene3',
    category: 'shorts_video',
    title: '🎬 Video Jualin Aja #3: Unlock Drama Tanpa Koin',
    content: '🎬 *BAHAN PROMOSI VIDEO JUALIN AJA — SCENE 3: UNLOCK FULL EPISODE DRAMA*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Nonton drama China tapi pas episode seru malah disuruh beli koin ratusan ribu? Ini trik buka semua episodenya gratis!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Rahasia para re-uploader drama China di TikTok dan Facebook Pro! Software Jualin Aja bisa langsung unlock episode 1 sampai tamat dari DramaBox, Melolo, FlickReels & NetShort tanpa perlu bayar koin recehan per episode.\n\n' +
      'Cek demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 3):*\n' +
      'https://appdockhub.com/assets/videos/jualinaja-scene3-drama.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_jualin_scene4',
    category: 'shorts_video',
    title: '🎬 Video Jualin Aja #4: FFmpeg Anti-Copyright & Merge',
    content: '🎬 *BAHAN PROMOSI VIDEO JUALIN AJA — SCENE 4: ENGINE FFMPEG ANTI-COPYRIGHT*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Ini cara rahasia gabung 80 episode drama jadi 1 film marathon 2 jam yang anti-banned dan siap monetisasi!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Dengan Engine FFmpeg terintegrasi di Jualin Aja, puluhan klip episode pendek digabung otomatis dalam hitungan menit. Dilengkapi filter anti-fingerprint acak yang bikin metadata video kamu 100% lolos deteksi sistem hak cipta YouTube dan Facebook.\n\n' +
      'Lihat proses kerjanya di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 4):*\n' +
      'https://appdockhub.com/assets/videos/jualinaja-scene4-speech.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_jualin_scene5',
    category: 'shorts_video',
    title: '🎬 Video Jualin Aja #5: Panen Cuan & Komisi 30%',
    content: '🎬 *BAHAN PROMOSI VIDEO JUALIN AJA — SCENE 5: POTENSI CUAN & KOMISI 30%*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Modal software ini doang, banyak kreator yang bisa tembus omzet jutaan rupiah dari AdSense & komisi afiliasi!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Gak cuma dapat uang dari views video drama di YouTube dan Facebook Pro, kamu juga bisa panen komisi afiliasi 30% (Rp 89.700 per penjualan software) cukup dengan membagikan link referral kamu!\n\n' +
      'Saksikan video demo & mulai sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 5):*\n' +
      'https://appdockhub.com/assets/videos/jualinaja-scene5-earning.mp4\n\n' +
      '👇 *Ambil Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },

  // ==========================================
  // BAHAN VIDEO RESMI: FACEBOOK MANAGER PRO (5 SCENE SHOWCASE MP4 + WEB DEMO)
  // ==========================================
  {
    item_key: 'video_fb_scene1',
    category: 'shorts_video',
    title: '🎬 Video FB Manager #1: Capek Manual & Akun Banned',
    content: '🎬 *BAHAN PROMOSI VIDEO FB MANAGER — SCENE 1: CAPEK MANUAL & AKUN BANNED*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Capek posting jualan manual ke puluhan grup Facebook tapi hasilnya sepi dan akun malah kena checkpoint atau banned? Ini solusi rahasianya!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Stop buang waktu seharian posting manual satu per satu! Sekarang pebisnis online dan pemain olshop pakai Facebook Account Manager Pro: software otomatisasi yang bisa kelola puluhan akun sekaligus, auto post grup & marketplace terjadwal, dan punya proteksi anti-detect browser biar akun selalu aman.\n\n' +
      'Tonton demo 5 scene interaktifnya & ambil lisensi resminya sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 1):*\n' +
      'https://appdockhub.com/assets/videos/fbmanager-scene1-intro.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_fb_scene2',
    category: 'shorts_video',
    title: '🎬 Video FB Manager #2: Multi-Screen Anti-Detect',
    content: '🎬 *BAHAN PROMOSI VIDEO FB MANAGER — SCENE 2: MULTI-SCREEN & ANTI-DETECT*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Satu layar laptop bisa buka puluhan akun Facebook sekaligus tanpa takut saling terhubung atau kena blokir? Tonton ini!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Ternak ratusan akun Facebook sekarang gampang banget! Facebook Account Manager Pro dilengkapi Multi-Profile Browser terisolasi. Tiap akun punya sidik jari browser (canvas, audio, WebGL) dan cookie sendiri-sendiri, jadi 100% aman dari deteksi algoritma Facebook.\n\n' +
      'Cek demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 2):*\n' +
      'https://appdockhub.com/assets/videos/fbmanager-scene2-multiscreen.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_fb_scene3',
    category: 'shorts_video',
    title: '🎬 Video FB Manager #3: Auto Post Marketplace & Grup',
    content: '🎬 *BAHAN PROMOSI VIDEO FB MANAGER — SCENE 3: AUTO POST MARKETPLACE & GRUP*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Sekali klik, iklan jualan kamu otomatis tayang di ratusan kota FB Marketplace & ratusan grup jual beli! Gak perlu capek manual lagi!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Banjir orderan olshop tanpa modal iklan berbayar (FB Ads)! Software Facebook Account Manager Pro mengotomatiskan posting produk massal ke berbagai target lokasi FB Marketplace dan grup-grup Facebook aktif 24 jam nonstop.\n\n' +
      'Tonton demo kerjanya di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 3):*\n' +
      'https://appdockhub.com/assets/videos/fbmanager-scene3-marketplace.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_fb_scene4',
    category: 'shorts_video',
    title: '🎬 Video FB Manager #4: Auto Warmup & Jadwal 24J',
    content: '🎬 *BAHAN PROMOSI VIDEO FB MANAGER — SCENE 4: AUTO WARMUP & JADWAL 24J*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Ini cara bikin akun Facebook baru jadi kebal dan punya trust score tinggi seperti akun lama tanpa takut kena checkpoint!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Fitur Smart Auto-Warmup di Facebook Account Manager Pro secara otomatis melakukan aktivitas manusiawi: auto scroll beranda, auto like postingan teman, tonton video reels, dan interaksi terjadwal. Akun jadi super awet dan siap dipakai jualan skala besar!\n\n' +
      'Lihat demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 4):*\n' +
      'https://appdockhub.com/assets/videos/fbmanager-scene4-automation.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_fb_scene5',
    category: 'shorts_video',
    title: '🎬 Video FB Manager #5: Banjir Orderan & Komisi 30%',
    content: '🎬 *BAHAN PROMOSI VIDEO FB MANAGER — SCENE 5: BANJIR ORDERAN & KOMISI 30%*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Modal software ini doang, omzet toko online melonjak berkali-kali lipat plus dapet komisi pasif ratusan ribu tiap hari!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Buktikan sendiri dahsyatnya otomatisasi Facebook! Selain meningkatkan omzet jualan Anda, Anda juga bisa panen komisi kemitraan afiliasi 30% (Rp 29.700 per lisensi) cukup dengan membagikan link bot ini ke teman-teman pebisnis online lainnya.\n\n' +
      'Saksikan 5 demo scene & miliki lisensinya sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 5):*\n' +
      'https://appdockhub.com/assets/videos/fbmanager-scene5-earning.mp4\n\n' +
      '👇 *Ambil Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },

  // ==========================================
  // BAHAN VIDEO RESMI: LINKEDIN MANAGER PRO (5 SCENE SHOWCASE MP4 + WEB DEMO)
  // ==========================================
  {
    item_key: 'video_linkedin_scene1',
    category: 'shorts_video',
    title: '🎬 Video LinkedIn #1: Sulit Tembus Decision Maker',
    content: '🎬 *BAHAN PROMOSI VIDEO LINKEDIN — SCENE 1: MASALAH OUTREACH B2B*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Mau dapet klien high-ticket bernilai puluhan juta dari LinkedIn tapi capek kirim pesan koneksi manual dan sering diabaikan? Ini solusinya!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Tinggalkan cara manual mencari prospek B2B! Gunakan LinkedIn Manager Pro: software otomatisasi yang membantu Anda menjangkau ribuan Founder, CEO, dan HRD tertarget secara personal, konsisten, dan aman.\n\n' +
      'Tonton demo 5 scene interaktifnya & ambil lisensi resmi promo hemat sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 1):*\n' +
      'https://appdockhub.com/assets/videos/linkedin-scene1-intro.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_linkedin_scene2',
    category: 'shorts_video',
    title: '🎬 Video LinkedIn #2: Multi-Screen Outreach',
    content: '🎬 *BAHAN PROMOSI VIDEO LINKEDIN — SCENE 2: MULTI-SCREEN & MULTI-ACCOUNT*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Satu orang bisa jalanin 5 profil LinkedIn profesional sekaligus tanpa ribet login-logout dan tanpa takut kena banned? Tonton ini!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Skalakan lead generation bisnis B2B Anda! Dengan fitur Multi-Screen Management di LinkedIn Manager Pro, Anda bisa mengelola beberapa akun LinkedIn dengan browser profile terisolasi. Pipeline prospek Anda terisi 5x lebih cepat!\n\n' +
      'Cek demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 2):*\n' +
      'https://appdockhub.com/assets/videos/linkedin-scene2-multiscreen.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_linkedin_scene3',
    category: 'shorts_video',
    title: '🎬 Video LinkedIn #3: Auto Post Thought Leadership',
    content: '🎬 *BAHAN PROMOSI VIDEO LINKEDIN — SCENE 3: AUTO POST & JADWAL KONTEN*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Ini cara mudah bangun personal branding & otoritas B2B di LinkedIn tanpa perlu pusing mikir jadwal posting tiap hari!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Konsistensi adalah kunci di LinkedIn! LinkedIn Manager Pro punya fitur penjadwalan konten otomatis. Postingan thought leadership Anda akan tayang di jam-jam prima saat para profesional aktif berselancar.\n\n' +
      'Tonton demo kerjanya di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 3):*\n' +
      'https://appdockhub.com/assets/videos/linkedin-scene3-post.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_linkedin_scene4',
    category: 'shorts_video',
    title: '🎬 Video LinkedIn #4: Auto Connect & Drip Follow-Up',
    content: '🎬 *BAHAN PROMOSI VIDEO LINKEDIN — SCENE 4: AUTO CONNECT & DRIP FOLLOW-UP*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Kirim pesan perkenalan & follow-up otomatis 3 tahap ke ratusan prospek tanpa dicap spam! Ini rahasianya!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Sistem Smart Drip Outreach di LinkedIn Manager Pro bekerja ramah dan natural. Begitu koneksi diterima, pesan perkenalan otomatis terkirim, disusul pesan lanjutan setelah beberapa hari secara sopan dan terukur.\n\n' +
      'Lihat demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 4):*\n' +
      'https://appdockhub.com/assets/videos/linkedin-scene4-automation.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_linkedin_scene5',
    category: 'shorts_video',
    title: '🎬 Video LinkedIn #5: Closing High-Ticket & Komisi 30%',
    content: '🎬 *BAHAN PROMOSI VIDEO LINKEDIN — SCENE 5: CLOSING HIGH-TICKET & KOMISI 30%*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Satu klien LinkedIn bisa ngasih omzet 2 juta sampai 50 juta rupiah! Plus dapet komisi pasif ratusan ribu tiap hari!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Peluang bisnis digital B2B sangat besar! Dapatkan software LinkedIn Manager Pro seharga Rp 99.000 sekali bayar, dan nikmati komisi kemitraan afiliasi 30% (Rp 29.700 per lisensi) setiap kali ada rekan bisnis Anda yang bergabung.\n\n' +
      'Saksikan 5 demo scene & miliki lisensinya sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 5):*\n' +
      'https://appdockhub.com/assets/videos/linkedin-scene5-earning.mp4\n\n' +
      '👇 *Ambil Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },

  // ==========================================
  // BAHAN VIDEO RESMI: PINTEREST MANAGER PRO (5 SCENE SHOWCASE MP4 + WEB DEMO)
  // ==========================================
  {
    item_key: 'video_pinterest_scene1',
    category: 'shorts_video',
    title: '🎬 Video Pinterest #1: Toko Online Sepi Pembeli',
    content: '🎬 *BAHAN PROMOSI VIDEO PINTEREST — SCENE 1: MASALAH TRAFIK SEPI*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Toko online atau link affiliate kamu sepi pengunjung dan boncos pasang iklan berbayar? Ini tambang trafik gratis yang jarang orang tahu!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Bongkar rahasia trafik tanpa boncos iklan! Pinterest adalah mesin pencari visual terbesar dengan audiens yang siap beli. Dengan Pinterest Manager Pro, Anda bisa mengalirkan ribuan pengunjung tertarget ke toko online, blog, atau link afiliasi Anda secara otomatis.\n\n' +
      'Tonton demo 5 scene interaktifnya & ambil lisensi resminya sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 1):*\n' +
      'https://appdockhub.com/assets/videos/pinterest-scene1-intro.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_pinterest_scene2',
    category: 'shorts_video',
    title: '🎬 Video Pinterest #2: Multi-Screen Multi-Board',
    content: '🎬 *BAHAN PROMOSI VIDEO PINTEREST — SCENE 2: MULTI-SCREEN & MULTI-BOARD*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Kelola puluhan akun Pinterest dan ratusan board sekaligus dalam satu layar tanpa takut bentrok IP atau banned? Tonton ini!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Ternak akun Pinterest dalam skala besar! Fitur Multi-Screen Management di Pinterest Manager Pro mengisolasi setiap profil browser dan cookie. Anda bisa menguasai berbagai niche market (fashion, dekorasi, resep, produk digital) secara bersamaan.\n\n' +
      'Cek demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 2):*\n' +
      'https://appdockhub.com/assets/videos/pinterest-scene2-multiscreen.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_pinterest_scene3',
    category: 'shorts_video',
    title: '🎬 Video Pinterest #3: Smart Pin Composer & SEO',
    content: '🎬 *BAHAN PROMOSI VIDEO PINTEREST — SCENE 3: SMART PIN COMPOSER & SEO*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Bikin ratusan gambar Pin estetis lengkap dengan kata kunci SEO otomatis yang bikin pin kamu nangkring di urutan teratas Pinterest!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Gak perlu jago desain Canva! Smart Pin Composer di Pinterest Manager Pro otomatis mengoptimasi judul, deskripsi ber-keyword SEO, dan menyematkan direct link aktif ke produk jualan Anda. Sekali posting, panen klik setiap hari!\n\n' +
      'Tonton demo kerjanya di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 3):*\n' +
      'https://appdockhub.com/assets/videos/pinterest-scene3-pincomposer.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_pinterest_scene4',
    category: 'shorts_video',
    title: '🎬 Video Pinterest #4: Auto Pin & Jadwal 24J Nonstop',
    content: '🎬 *BAHAN PROMOSI VIDEO PINTEREST — SCENE 4: AUTO PIN & JADWAL 24J NONSTOP*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Tinggal tidur, tapi software ini tetap nge-pin otomatis setiap 15 menit menjangkau pembeli di Amerika dan Eropa!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Otomatisasi total 24 jam nonstop! Jadwalkan ratusan pin, video pin, dan repin ke berbagai board secara acak dan natural. Menjangkau calon pembeli lokal maupun buyer global dengan daya beli tinggi tanpa perlu Anda pantau terus-menerus.\n\n' +
      'Lihat demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 4):*\n' +
      'https://appdockhub.com/assets/videos/pinterest-scene4-automation.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_pinterest_scene5',
    category: 'shorts_video',
    title: '🎬 Video Pinterest #5: Trafik Evergreen & Komisi 30%',
    content: '🎬 *BAHAN PROMOSI VIDEO PINTEREST — SCENE 5: TRAFIK EVERGREEN & KOMISI 30%*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Pin yang diposting setahun lalu masih terus menghasilkan jutaan rupiah sampai hari ini! Ini yang namanya trafik pasif abadi!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Bedanya Pinterest dengan medsos lain: Pin Anda berumur panjang dan terus menghasilkan orderan bertahun-tahun! Ditambah lagi, Anda bisa mendapatkan komisi kemitraan afiliasi 30% (Rp 29.700 per lisensi) cukup dengan membagikan bot ini ke teman-teman.\n\n' +
      'Saksikan 5 demo scene & miliki lisensinya sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 5):*\n' +
      'https://appdockhub.com/assets/videos/pinterest-scene5-earning.mp4\n\n' +
      '👇 *Ambil Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },

  // ==========================================
  // BAHAN VIDEO RESMI: TIKTOK MULTI-SCREEN PRO (5 SCENE SHOWCASE MP4 + WEB DEMO)
  // ==========================================
  {
    item_key: 'video_tiktok_scene1',
    category: 'shorts_video',
    title: '🎬 Video TikTok #1: Capek Gonta-Ganti Akun & Banned',
    content: '🎬 *BAHAN PROMOSI VIDEO TIKTOK — SCENE 1: CAPEK MANUAL & SHADOWBAN*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Capek gonta-ganti puluhan akun TikTok di HP sampai sering kena shadowban? Ada cara ternak puluhan akun sekaligus di 1 layar laptop!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Pemain TikTok Affiliate wajib tahu ini! Mengelola puluhan akun keranjang kuning secara manual di HP itu rawan banget kena banned algoritma TikTok. Dengan TikTok Multi-Screen Pro, Anda bisa mengontrol puluhan profil terisolasi aman dari satu layar laptop.\n\n' +
      'Tonton demo 5 scene interaktifnya & miliki lisensinya sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 1):*\n' +
      'https://appdockhub.com/assets/videos/tiktok-scene1-intro.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_tiktok_scene2',
    category: 'shorts_video',
    title: '🎬 Video TikTok #2: Multi-Screen 10-50 Layar Simultan',
    content: '🎬 *BAHAN PROMOSI VIDEO TIKTOK — SCENE 2: MULTI-SCREEN 1 LAYAR*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Buka 10 sampai 50 akun TikTok sekaligus di satu monitor tanpa bentrok cookie atau IP! Tonton live demonya!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Skalakan bisnis affiliate Anda! Fitur Multi-Screen di TikTok Multi-Screen Pro mengisolasi setiap profil browser secara total (User-Agent, cookie, canvas fingerprint). Sangat aman untuk ternak akun di berbagai niche market sekaligus.\n\n' +
      'Cek demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 2):*\n' +
      'https://appdockhub.com/assets/videos/tiktok-scene2-multiscreen.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_tiktok_scene3',
    category: 'shorts_video',
    title: '🎬 Video TikTok #3: Login Sekali & Sesi Anti-Logout',
    content: '🎬 *BAHAN PROMOSI VIDEO TIKTOK — SCENE 3: LOGIN SEKALI & SESI PERMANEN*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Sekali login tersimpan permanen! Gak perlu lagi pusing minta kode OTP berkali-kali tiap mau posting!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Bebas ribet kelola banyak akun! Sesi cookie dan profil Anda tersimpan rapi di lokal komputer. Cukup klik buka, akun langsung aktif dan siap digunakan untuk upload video atau pantau interaksi keranjang kuning.\n\n' +
      'Tonton demo kerjanya di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 3):*\n' +
      'https://appdockhub.com/assets/videos/tiktok-scene3-login.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_tiktok_scene4',
    category: 'shorts_video',
    title: '🎬 Video TikTok #4: Auto-Upload Video Keranjang Kuning FYP',
    content: '🎬 *BAHAN PROMOSI VIDEO TIKTOK — SCENE 4: AUTO-UPLOAD & JADWAL FYP*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Jadwalkan ratusan video viral ke semua akun TikTok kamu otomatis! Tinggal tidur, video tetap tayang di jam FYP!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Otomatisasi posting massal tanpa henti! Jadwalkan video keranjang kuning di jam prime-time FYP audiens Anda. Sangat cocok untuk re-uploader drama, affiliate fashion, elektronik, dan produk digital.\n\n' +
      'Lihat demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 4):*\n' +
      'https://appdockhub.com/assets/videos/tiktok-scene4-upload.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_tiktok_scene5',
    category: 'shorts_video',
    title: '🎬 Video TikTok #5: Banjir Komisi Affiliate & Komisi 30%',
    content: '🎬 *BAHAN PROMOSI VIDEO TIKTOK — SCENE 5: BANJIR CUAN & KOMISI 30%*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Dari TikTok panen keranjang kuning, ditambah komisi 30% tiap ajak temen pake software ini! Modal Rp 99rb balik berkali-kali lipat!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Dua sumber penghasilan sekaligus! Dapatkan software TikTok Multi-Screen Pro seharga Rp 99.000 sekali bayar, plus Anda otomatis terdaftar sebagai mitra afiliasi dengan komisi 30% (Rp 29.700 per lisensi) + 5% komisi tim pasif seumur hidup!\n\n' +
      'Saksikan 5 demo scene & miliki lisensinya sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 5):*\n' +
      'https://appdockhub.com/assets/videos/tiktok-scene5-earning.mp4\n\n' +
      '👇 *Ambil Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },

  // ==========================================
  // BAHAN VIDEO RESMI: REDDIT MANAGER PRO (5 SCENE SHOWCASE MP4 + WEB DEMO)
  // ==========================================
  {
    item_key: 'video_reddit_scene1',
    category: 'shorts_video',
    title: '🎬 Video Reddit #1: Sulit Trafik US & Masalah Banned',
    content: '🎬 *BAHAN PROMOSI VIDEO REDDIT — SCENE 1: MASALAH TRAFIK US & BANNED*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Mau jangkau jutaan pembeli dari Amerika dan Eropa tapi akun Reddit kamu sering kena shadowban atau dihapus moderator? Ini rahasianya!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Pasar luar negeri daya belinya gila-gilaan! Tapi kalau posting manual di Reddit tanpa pemahaman algoritma dan isolasi browser, akun bakal cepat tumbang. Dengan Reddit Manager Pro, Anda bisa mengelola puluhan akun terisolasi aman untuk mendatangkan ribuan klik organik berdaya beli dolar.\n\n' +
      'Tonton demo 5 scene interaktifnya & miliki lisensinya sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 1):*\n' +
      'https://appdockhub.com/assets/videos/reddit-scene1-intro.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_reddit_scene2',
    category: 'shorts_video',
    title: '🎬 Video Reddit #2: Multi-Screen 50+ Akun Terisolasi',
    content: '🎬 *BAHAN PROMOSI VIDEO REDDIT — SCENE 2: MULTI-SCREEN 1 LAYAR*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Ternak puluhan akun Reddit sekaligus dalam satu layar tanpa takut bentrok IP atau banned massal! Tonton ini!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Kuasai ratusan komunitas Reddit! Fitur Multi-Screen di Reddit Manager Pro mengisolasi setiap profil browser (cookie, user-agent, fingerprint unik). Anda bisa masuk ke berbagai niche market (bisnis, teknologi, AI, gaming, finansial) tanpa saling terhubung.\n\n' +
      'Cek demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 2):*\n' +
      'https://appdockhub.com/assets/videos/reddit-scene2-multiscreen.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_reddit_scene3',
    category: 'shorts_video',
    title: '🎬 Video Reddit #3: Auto-Warmup Karma & Subreddit Scanner',
    content: '🎬 *BAHAN PROMOSI VIDEO REDDIT — SCENE 3: SUBREDDIT SCANNER & KARMA*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Bangun karma akun Reddit secara otomatis dan temukan ratusan subreddit niche yang siap beli produk Anda!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Gak perlu repot cari karma manual berbulan-bulan! Sistem Auto-Warmup di Reddit Manager Pro meningkatkan reputasi akun Anda secara natural dan aman. Dilengkapi Subreddit Scanner cerdas untuk menemukan kantong-kantong audiens global yang haus akan solusi jualan Anda.\n\n' +
      'Tonton demo kerjanya di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 3):*\n' +
      'https://appdockhub.com/assets/videos/reddit-scene3-subreddit.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_reddit_scene4',
    category: 'shorts_video',
    title: '🎬 Video Reddit #4: Auto-Post & Jadwal 24J Nonstop Jam US',
    content: '🎬 *BAHAN PROMOSI VIDEO REDDIT — SCENE 4: OTOMASI POSTING 24J NONSTOP*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Tinggal tidur pun postingan tetap jalan di jam sibuk Amerika! Panen klik organik berdaya beli dolar setiap hari!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Otomatisasi promosi global 24 jam nonstop! Jadwalkan thread diskusi, postingan gambar, dan link afiliasi dengan interval acak human-like. Bekerja otomatis saat audiens Amerika & Eropa sedang aktif berbelanja.\n\n' +
      'Lihat demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 4):*\n' +
      'https://appdockhub.com/assets/videos/reddit-scene4-automation.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_reddit_scene5',
    category: 'shorts_video',
    title: '🎬 Video Reddit #5: Panen Dolar & Komisi Afiliasi 30%',
    content: '🎬 *BAHAN PROMOSI VIDEO REDDIT — SCENE 5: BANJIR DOLAR & KOMISI 30%*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Dari Reddit dapet buyer luar negeri bayar dolar, ditambah komisi afiliasi 30% dari software ini! Dobel cuan setiap hari!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Maksimalkan profit harian Anda! Software Reddit Manager Pro seharga Rp 99.000 sekali bayar, plus Anda otomatis terdaftar sebagai mitra afiliasi resmi dengan komisi 30% (Rp 29.700 per lisensi) + 5% komisi tim pasif seumur hidup!\n\n' +
      'Saksikan 5 demo scene & miliki lisensinya sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 5):*\n' +
      'https://appdockhub.com/assets/videos/reddit-scene5-earning.mp4\n\n' +
      '👇 *Ambil Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },

  // ==========================================
  // BAHAN VIDEO RESMI: X (TWITTER) MANAGER PRO (5 SCENE SHOWCASE MP4 + WEB DEMO)
  // ==========================================
  {
    item_key: 'video_x_scene1',
    category: 'shorts_video',
    title: '🎬 Video X #1: Akun Suspend & Views Sepi di X',
    content: '🎬 *BAHAN PROMOSI VIDEO X — SCENE 1: MASALAH AKUN SUSPEND & VIEWS SEPI*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Ngetweet tiap hari tapi views sepi dan akun sering kena shadowban? Ada cara otomatis ternak puluhan akun X sekaligus dan mendominasi trending topic!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Bongkar rahasia viral di platform X (Twitter)! Jangan buang waktu promosi manual yang rawan kena suspend algoritma. Dengan X Manager Pro, Anda bisa mengelola puluhan akun terisolasi aman untuk menarik ribuan klik organik ke website jualan atau link affiliate Anda.\n\n' +
      'Tonton demo 5 scene interaktifnya & miliki lisensinya sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 1):*\n' +
      'https://appdockhub.com/assets/videos/x-scene1-intro.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_x_scene2',
    category: 'shorts_video',
    title: '🎬 Video X #2: Multi-Screen Puluhan Akun Terisolasi',
    content: '🎬 *BAHAN PROMOSI VIDEO X — SCENE 2: MULTI-SCREEN 1 LAYAR*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Kelola puluhan akun X dalam satu layar tanpa takut saling terdeteksi atau suspend massal! Tonton ini!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Ternak akun X dalam skala besar! Fitur Multi-Screen di X Manager Pro mengisolasi setiap profil browser (cookie, user-agent, fingerprint unik). Anda bisa menguasai berbagai niche market (politik, crypto, teknologi, hiburan, bisnis) secara simultan.\n\n' +
      'Cek demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 2):*\n' +
      'https://appdockhub.com/assets/videos/x-scene2-multiscreen.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_x_scene3',
    category: 'shorts_video',
    title: '🎬 Video X #3: Auto-Thread Maker & Smart Link',
    content: '🎬 *BAHAN PROMOSI VIDEO X — SCENE 3: AUTO-THREAD MAKER & LINK*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Bikin utas panjang viral otomatis sekali klik lengkap dengan link promosi yang gak bikin views anjlok!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Gak perlu ngetik manual berjam-jam! Auto-Thread Maker di X Manager Pro otomatis memecah konten cerita atau edukasi menjadi utas panjang yang menarik engagement tinggi. Link produk atau affiliate disisipkan secara halus di tweet penutup.\n\n' +
      'Tonton demo kerjanya di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 3):*\n' +
      'https://appdockhub.com/assets/videos/x-scene3-tweet.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_x_scene4',
    category: 'shorts_video',
    title: '🎬 Video X #4: Trending Reply Sniper 24J Nonstop',
    content: '🎬 *BAHAN PROMOSI VIDEO X — SCENE 4: TRENDING REPLY SNIPER 24J*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Numpang viral di tweet trending topik otomatis! Setiap ada berita rame, link promosi kamu langsung nangkring di urutan atas!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Panen jangkauan jutaan audiens gratis! Fitur Trending Reply Sniper otomatis mendeteksi tweet viral dan membalas dengan respon cerdas ber-link promosi secara natural. Software bekerja 24 jam nonstop bahkan saat Anda sedang tidur.\n\n' +
      'Lihat demonya langsung di web:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 4):*\n' +
      'https://appdockhub.com/assets/videos/x-scene4-automation.mp4\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'video_x_scene5',
    category: 'shorts_video',
    title: '🎬 Video X #5: Banjir Impresi Pasif & Komisi 30%',
    content: '🎬 *BAHAN PROMOSI VIDEO X — SCENE 5: BANJIR IMPRESI & KOMISI 30%*\n' +
      '_(Format: Video MP4 HD | Cocok untuk: TikTok, Reels, YouTube Shorts, Story WA)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *HOOK 3 DETIK PERTAMA:*\n' +
      '*"Dari X panen jutaan impresi dan klik, ditambah komisi 30% pasif dari software ini! Sekali bayar Rp 99.000 aktif selamanya!"*\n\n' +
      '📝 *CAPTION SIAP COPAS:*\n' +
      'Maksimalkan omzet jualan Anda! Dapatkan software X Manager Pro seharga Rp 99.000 sekali bayar, plus Anda otomatis terdaftar sebagai mitra afiliasi resmi dengan komisi 30% (Rp 29.700 per lisensi) + 5% komisi tim pasif seumur hidup!\n\n' +
      'Saksikan 5 demo scene & miliki lisensinya sekarang:\n' +
      '👉 {WEB_LINK}\n\n' +
      '📥 *Download Bahan Video MP4 (Scene 5):*\n' +
      'https://appdockhub.com/assets/videos/x-scene5-earning.mp4\n\n' +
      '👇 *Ambil Lisensi Resmi via Bot Telegram (Ref Anda):*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'live_uji_coba_ai',
    category: 'live_stream',
    title: '🎙️ Live Stream #1: Tantang AI dari Komentar Penonton (Paling Ramai!)',
    content: '🎙️ *PANDUAN LENGKAP LIVE STREAMING #1: UJI COBA AI INTERAKTIF*\n' +
      '_(Platform: TikTok Live / YouTube Live / Facebook Live | Mode: Share Screen Layar HP)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '💡 *KENAPA STRATEGI INI PALING CEPAT CUAN?*\n' +
      'Penonton live sangat suka konten interaktif di mana nama atau ide mereka diwujudkan secara live! Ini membuat penonton betah berjam-jam dan algoritma live merekomendasikan live Anda ke ribuan penonton baru!\n\n' +
      '📌 *1. JUDUL LIVE YANG MENARIK PENONTON:*\n' +
      '👉 *"🔴 LIVE: Tantang AI Bikin Video & Drama China dari Komentar Kalian! (100% Gratis)"*\n' +
      '👉 *"🔴 Uji Coba AI Bot Telegram: Tulis Adegan Apa Aja di Chat, AI Buatin Sekarang!"*\n\n' +
      '📌 *2. NASKAH PEMBUKA (MENIT 0 - 5):*\n' +
      '🗣️ *"Halo teman-teman yang baru gabung! Selamat datang di live uji coba teknologi AI tercanggih hari ini! Siapa di sini yang mau dibuatin video atau cerita drama pendek gratis sama AI? Coba ketik ide atau nama kalian di kolom komentar sekarang, nanti saya ketik langsung ke AI-nya dan kita tonton bareng!"*\n\n' +
      '📌 *3. CARA EKSEKUSI DI LAYAR (SEPANJANG LIVE):*\n' +
      '1️⃣ Baca komentar penonton: *"Oke ada komentar dari Kak Budi: \'Bikinin mobil balap melesat di gurun pasir waktu badai\'."*\n' +
      '2️⃣ Buka Bot @AppDockHub_Bot di share screen, klik *🎬 Text-to-Video*, ketik ide Kak Budi.\n' +
      '3️⃣ Tunggu 4-5 detik, saat video MP4 dan naskah keluar, reaksi dengan antusias: *"Wah gila hasilnya keren banget Kak Budi! Kualitasnya udah HD 60 FPS!"*\n\n' +
      '📌 *4. CALL TO ACTION CUAN (ULANGI TIAP 5-7 MENIT):*\n' +
      '🗣️ *"Buat teman-teman yang nonton dan mau coba sendiri di HP masing-masing, bot ini GRATIS ya tanpa bayar! Kalian tinggal klik LINK DI BIO PROFIL TIKTOK SAYA / DESKRIPSI LIVE. Masuk ke Telegram dan langsung coba sepuasnya ya!"*\n\n' +
      '💰 *Hasilnya:* Penonton akan klik link referral Anda di bio, masuk ke bot, dan saat mereka tertarik membeli software bisnis yang ada di bot, komisi 30% otomatis masuk ke akun Anda!\n\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '👉 *Link Referral Anda:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'live_bedah_software',
    category: 'live_stream',
    title: '🎙️ Live Stream #2: Bedah Software Otomatisasi Ribuan Grup FB & TikTok',
    content: '🎙️ *PANDUAN LENGKAP LIVE STREAMING #2: BEDAH SOFTWARE OTOMATISASI*\n' +
      '_(Platform: TikTok Live / YouTube Live / FB Live | Target: Pebisnis & Pedagang Online)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *1. JUDUL LIVE:*\n' +
      '👉 *"🔴 LIVE DEMO: Cara Otomatisasi Jualan di 100 Grup Facebook & TikTok Sekali Klik!"*\n' +
      '👉 *"🔴 Kupas Tuntas: Tools Rahasia Olshop Kebanjiran Orderan Tanpa Iklan Berbayar"*\n\n' +
      '📌 *2. STRUKTUR LIVE STREAMING:*\n' +
      '• *Menit 00-10:* Tunjukkan masalah umum pebisnis online (capek posting manual, akun sering diblokir FB/TikTok, jualan sepi).\n' +
      '• *Menit 10-30:* Demo langsung software:\n' +
      '  - Tunjukkan Anti-Detect Browser profil yang aman.\n' +
      '  - Tunjukkan cara import ratusan grup Facebook sekali klik.\n' +
      '  - Tunjukkan fitur penjadwalan otomatis bekerja sendiri di layar.\n' +
      '• *Menit 30-45 (Tanya Jawab Sepuasnya):* Jawab pertanyaan penonton di komentar chat live.\n\n' +
      '📌 *3. CLOSING SCARCITY (MENDESAK):*\n' +
      '🗣️ *"Teman-teman, software resmi ini aslinya Rp 349.000, tapi khusus hari ini ada promo hemat cuma Rp 99.000 sekali bayar tanpa langganan bulanan! Kuota promo terbatas, silakan langsung ambil lisensi resminya lewat bot Telegram di link bio saya sekarang juga sebelum harga normal kembali!"*\n\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '👉 *Link Referral Anda:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'live_trik_cuan_affiliate',
    category: 'live_stream',
    title: '🎙️ Live Stream #3: Cara Dapat Rp 500rb - 2 Juta/Minggu dari Afiliasi Bot',
    content: '🎙️ *PANDUAN LENGKAP LIVE STREAMING #3: BUKA-BUKAAN CUAN AFILIASI*\n' +
      '_(Platform: TikTok Live / YouTube / IG Live | Target: Pemburu Peluang Online)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *1. JUDUL LIVE:*\n' +
      '👉 *"🔴 LIVE SHARING: Modal Share Screen Bot AI Bisa Dapat Komisi 30% Tiap Hari!"*\n' +
      '👉 *"🔴 Cara Pelajar & Karyawan Hasilkan Passive Income dari Program Afiliasi Software"*\n\n' +
      '📌 *2. MATERI YANG DIBAHAS:*\n' +
      '1️⃣ Tunjukkan bahwa zaman sekarang tidak perlu modal besar untuk mulai bisnis digital.\n' +
      '2️⃣ Jelaskan sistem komisi bot:\n' +
      '   - Komisi Langsung 30% (Rp 29.700 – Rp 89.700 per lisensi)\n' +
      '   - Komisi Pasif Tier-2 (5% dari setiap penjualan teman/tim yang diajak)\n' +
      '3️⃣ Tunjukkan menu *🔗 Link Afiliasi Saya* di bot Telegram:\n' +
      '   - Bagaimana cara ambil link unik sendiri.\n' +
      '   - Cara memantau saldo komisi yang transparan.\n\n' +
      '📌 *3. AJAK PENONTON LANGSUNG PRAKTEK:*\n' +
      '🗣️ *"Teman-teman gak perlu bayar apapun untuk join. Pendaftarannya 100% GRATIS! Buka link di bio saya sekarang, buka botnya, lalu klik tombol \'🔗 Link Afiliasi Saya\'. Ambil link kalian dan mulai praktek bareng saya malam ini!"*\n\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '👉 *Link Referral Anda:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'live_nobar_drama',
    category: 'live_stream',
    title: '🎙️ Live Stream #4: Nobar Drama AI & Tebak Plot Twist Ep 4',
    content: '🎙️ *PANDUAN LENGKAP LIVE STREAMING #4: NOBAR DRAMA PENDEK VIRAL*\n' +
      '_(Platform: TikTok Live / YouTube Live | Format: Hiburan Interaktif)_\n' +
      '━━━━━━━━━━━━━━━━━━\n\n' +
      '📌 *1. JUDUL LIVE:*\n' +
      '👉 *"🔴 NOBAR DRAMA CHINA SUB INDO: Menantu Miliarder Balas Dendam (Tebak Endingnya!)"*\n' +
      '👉 *"🔴 LIVE NONTON BARENG: Drama Pendek Paling Viral Minggu Ini"*\n\n' +
      '📌 *2. ALUR ACARA:*\n' +
      '1️⃣ Putar Episode 1 dan Episode 2 drama pendek dari bot di layar live.\n' +
      '2️⃣ Bangun ketegangan penonton saat klimaks Episode 3 dimulai.\n' +
      '3️⃣ Pas Episode 3 selesai dengan cliffhanger menggantung:\n' +
      '   🗣️ *"Wah parah banget masa identitas aslinya kebongkar pas mantan tunangannya datang! Kira-kira di Episode 4 dia bakal balas dendam atau kabur guys? Coba tebak di komentar!"*\n\n' +
      '📌 *3. CARA MENGARAHKAN PENONTON KLIK BIO:*\n' +
      '🗣️ *"Buat kalian yang gak sabar mau nonton Episode 4 sampai tamat atau mau bikin cerita drama sendiri pakai nama kalian, semuanya ada di bot Telegram resmi ini ya! Langsung klik LINK DI BIO PROFIL SAYA sekarang!"*\n\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '👉 *Link Referral Anda:*\n{LINK}',
    media_type: null,
    media_id: null
  },

  // ==========================================
  // KATEGORI 4: MATERI SOFTWARE (software)
  // ==========================================
  {
    item_key: 'game_cyber_orbit',
    category: 'game',
    title: '🎮 Cyber Orbit: Quantum Core',
    content: '🎮 *TANTANGAN LEVEL 100 — CYBER ORBIT: QUANTUM CORE!*\n\nGame ketangkasan orbit neon 60 FPS paling seru di Android! Tembakkan node energi ke inti kuantum, taklukkan 2.000 level, dan kumpulkan reward saldo harian langsung dari HP kamu!\n\n✅ Gratis dimainkan di Android\n✅ 2.000 Level menantang + Boss Stage\n✅ Saldo reward harian otomatis tercatat\n\n👇 *Download Resmi di Google Play Store:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'soft_brutal_pro',
    category: 'software',
    title: '⚡ TikTok Brutal Content Pro (Rp 99rb)',
    content: '⚡ *TIKTOK BRUTAL CONTENT PRO & AI STUDIO*\n\n' +
      'Mesin pengganda konten affiliate TikTok otomatis! Dari 1 video produk diubah menjadi puluhan video unik siap FYP dengan dynamic camera framing, voiceover AI Bahasa Indonesia, micro color grading, dan bypass filter duplikasi algoritma TikTok.\n\n' +
      '⚡ *FITUR UNGGULAN:*\n' +
      '✅ *Multi-Hook & Dynamic Zoom:* Gandakan 1 video jadi puluhan variasi unik.\n' +
      '✅ *Voiceover AI Natural:* Suara cowok & cewek TikTok Indonesia (Gadis & Ardi).\n' +
      '✅ *Studio AI Multimodal:* Generator skenario iklan dari foto produk & talent via Gemini AI.\n' +
      '✅ *Bypass Deteksi TikTok:* Acak hash, rotasi mikro speed 0.98x - 1.02x & color jitter.\n\n' +
      '💰 *Harga Lisensi:* Rp 99.000 (1 Lisensi = 1 Device)\n' +
      '🎁 *Bonus Afiliasi:* Komisi 30% Tier 1 (Rp 29.700) + 5% Tier 2 Pasif seumur hidup!\n\n' +
      '👇 *Beli Lisensi Resmi via Bot Telegram:*\n{LINK}',
    media_url: null,
    media_type: null,
    media_id: null
  },
  {
    item_key: 'soft_reddit_pro',
    category: 'software',
    title: '🔥 Reddit Manager Pro (Rp 99rb)',
    content: '🔥 *REDDIT MANAGER PRO — GLOBAL TRAFFIC & SUBREDDIT SCHEDULER*\n\n' +
      'Mesin penarik trafik pembeli berdaya beli dolar dari komunitas terbesar Amerika & Eropa!\n\n' +
      '🔥 *FITUR UNGGULAN & NILAI JUAL:*\n' +
      '✅ *Multi-Screen Profile Isolation:* Kelola 50+ akun Reddit sekaligus tanpa bentrok IP/cookie (Anti-Banned).\n' +
      '✅ *Auto-Warmup Karma Engine:* Bangun reputasi karma akun secara otomatis lewat interaksi human-like aman.\n' +
      '✅ *Subreddit Targeted Scanner:* Temukan 240+ komunitas niche aktif yang siap klik dan beli produk Anda.\n' +
      '✅ *24/7 Smart Post Scheduler:* Jadwalkan postingan massal otomatis saat jam sibuk prime-time Amerika (US/UK).\n' +
      '✅ *Lisensi Permanen:* Cukup bayar sekali Rp 99.000, aktif seumur hidup tanpa biaya bulanan!\n\n' +
      '💰 *POTENSI KOMISI ANDA:*\n' +
      '• Direct Seller (Tier 1): *Rp 29.700 (30%)* per lisensi terjual!\n' +
      '• Sponsor Tim (Tier 2): *Rp 4.950 (5%)* pasif dari penjualan teman Anda.\n\n' +
      '🎬 *5 VIDEO SHOWCASE DEMO RESMI SUDAH TERSEDIA DI WEB:*\n' +
      'Calon pembeli bisa langsung tonton 5 scene demo fitur di halaman penjualan:\n' +
      '🌐 {WEB_LINK}\n\n' +
      '👇 *Link Pembelian Otomatis Afiliasi Anda:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'soft_fb_pro',
    category: 'software',
    title: '🔵 Facebook Account Manager Pro (Rp 99rb)',
    content: '🔵 *FACEBOOK ACCOUNT MANAGER PRO — TERNAK & KELOLA RATUSAN AKUN FB*\n\n' +
      'Solusi otomatisasi pemasaran Facebook terlengkap untuk pebisnis online, olshop, & afiliator!\n\n' +
      '🔥 *FITUR UNGGULAN & NILAI JUAL:*\n' +
      '✅ *Multi-Profile Anti-Detect Browser:* Kelola puluhan hingga ratusan akun FB sekaligus dengan sidik jari peramban & cookie terisolasi.\n' +
      '✅ *Auto Post Marketplace & Grup:* Sebar postingan dan listing produk massal ke ratusan grup & target kota tanpa spam.\n' +
      '✅ *Auto Warmup & Interaksi:* Hangatkan akun baru secara otomatis (auto scroll, like, reels) agar kebal checkpoint.\n' +
      '✅ *Lisensi Permanen:* Cukup bayar sekali Rp 99.000, aktif seumur hidup tanpa biaya bulanan!\n\n' +
      '💰 *POTENSI KOMISI ANDA:*\n' +
      '• Direct Seller (Tier 1): *Rp 29.700 (30%)* per lisensi terjual!\n' +
      '• Sponsor Tim (Tier 2): *Rp 4.950 (5%)* pasif dari penjualan teman Anda.\n\n' +
      '🎬 *5 VIDEO SHOWCASE DEMO RESMI SUDAH TERSEDIA DI WEB:*\n' +
      'Calon pembeli bisa langsung tonton 5 scene demo fitur di halaman penjualan:\n' +
      '🌐 {WEB_LINK}\n\n' +
      '👇 *Link Pembelian Otomatis Afiliasi Anda:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'soft_tiktok_pro',
    category: 'software',
    title: '📱 TikTok Multi-Screen Pro (Rp 99rb)',
    content: '📱 *TIKTOK MULTI-SCREEN PRO — TERNAK AKUN & MULTI-LIVE RECORDER*\n\n' +
      'Senjata wajib para pemain TikTok Affiliate, Content Creator, dan Re-uploader Konten FYP!\n\n' +
      '🔥 *FITUR UNGGULAN & NILAI JUAL:*\n' +
      '✅ *Multi-Screen Browser Isolation:* Buka 10-50 akun TikTok sekaligus tanpa bentrok IP/cookie (Anti-Banned).\n' +
      '✅ *Bulk Auto-Upload & Jadwal FYP:* Upload massal video keranjang kuning otomatis di jam prime-time.\n' +
      '✅ *Multi-Live Stream Recorder HD:* Rekam siaran live kompetitor 1080p tanpa watermark secara otomatis.\n' +
      '✅ *Auto-Warmup & Human-Like Behavior:* Simulasikan interaksi scroll & like natural untuk memperkuat reputasi akun.\n' +
      '✅ *Lisensi Permanen:* Cukup bayar sekali Rp 99.000, aktif seumur hidup tanpa biaya bulanan!\n\n' +
      '💰 *POTENSI KOMISI ANDA:*\n' +
      '• Direct Seller (Tier 1): *Rp 29.700 (30%)* per lisensi terjual!\n' +
      '• Sponsor Tim (Tier 2): *Rp 4.950 (5%)* pasif dari penjualan teman Anda.\n\n' +
      '🎬 *5 VIDEO SHOWCASE DEMO RESMI SUDAH TERSEDIA DI WEB:*\n' +
      'Calon pembeli bisa langsung tonton 5 scene demo fitur di halaman penjualan:\n' +
      '🌐 {WEB_LINK}\n\n' +
      '👇 *Link Pembelian Otomatis Afiliasi Anda:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'soft_linkedin_pro',
    category: 'software',
    title: '💼 LinkedIn Manager Pro (Rp 99rb)',
    content: '💼 *LINKEDIN MANAGER PRO — B2B LEAD GENERATION & OUTREACH SUITE*\n\n' +
      'Solusi otomatisasi B2B terlengkap untuk closing klien bernilai tinggi, agensi, konsultan & freelancer!\n\n' +
      '🔥 *FITUR UNGGULAN & NILAI JUAL:*\n' +
      '✅ *Target Decision Makers:* Cari dan saring Founder, CEO, Direktur, HRD sesuai industri & wilayah.\n' +
      '✅ *Auto Connect & Smart Drip Outreach:* Kirim pesan perkenalan & follow-up otomatis bertahap secara sopan.\n' +
      '✅ *Multi-Screen Profile:* Kelola beberapa akun LinkedIn profesional sekaligus tanpa bentrok cookie.\n' +
      '✅ *Auto Post Scheduler:* Jadwalkan konten thought leadership harian untuk membangun otoritas profil.\n' +
      '✅ *Lisensi Permanen:* Cukup bayar sekali Rp 99.000, aktif seumur hidup tanpa biaya bulanan!\n\n' +
      '💰 *POTENSI KOMISI ANDA:*\n' +
      '• Direct Seller (Tier 1): *Rp 29.700 (30%)* per lisensi terjual!\n' +
      '• Sponsor Tim (Tier 2): *Rp 4.950 (5%)* pasif dari penjualan teman Anda.\n\n' +
      '🎬 *5 VIDEO SHOWCASE DEMO RESMI SUDAH TERSEDIA DI WEB:*\n' +
      'Calon pembeli bisa langsung tonton 5 scene demo fitur di halaman penjualan:\n' +
      '🌐 {WEB_LINK}\n\n' +
      '👇 *Link Pembelian Otomatis Afiliasi Anda:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'soft_pinterest_pro',
    category: 'software',
    title: '📌 Pinterest Manager Pro (Rp 99rb)',
    content: '📌 *PINTEREST MANAGER PRO — BULK AUTO-PIN & SEO TRAFFIC ENGINE*\n\n' +
      'Mesin trafik visual gratis terbesar untuk toko online, blog, kreator, dan pemain affiliate global!\n\n' +
      '🔥 *FITUR UNGGULAN & NILAI JUAL:*\n' +
      '✅ *Direct Link di Tiap Pin:* 100% klik dari audiens langsung diarahkan ke landing page / link toko Anda.\n' +
      '✅ *Smart Pin Composer & Visual SEO:* Riset keyword otomatis & buat puluhan Pin beresolusi tinggi sekali klik.\n' +
      '✅ *Multi-Screen & Multi-Board:* Kelola banyak profil akun Pinterest & ratusan niche board terisolasi.\n' +
      '✅ *Bulk Auto-Pin Scheduler 24J:* Jadwalkan ratusan pin otomatis sepanjang hari ke audiens lokal & US/UK.\n' +
      '✅ *Lisensi Permanen:* Cukup bayar sekali Rp 99.000, aktif seumur hidup tanpa biaya bulanan!\n\n' +
      '💰 *POTENSI KOMISI ANDA:*\n' +
      '• Direct Seller (Tier 1): *Rp 29.700 (30%)* per lisensi terjual!\n' +
      '• Sponsor Tim (Tier 2): *Rp 4.950 (5%)* pasif dari penjualan teman Anda.\n\n' +
      '🎬 *5 VIDEO SHOWCASE DEMO RESMI SUDAH TERSEDIA DI WEB:*\n' +
      'Calon pembeli bisa langsung tonton 5 scene demo fitur di halaman penjualan:\n' +
      '🌐 {WEB_LINK}\n\n' +
      '👇 *Link Pembelian Otomatis Afiliasi Anda:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'soft_x_pro',
    category: 'software',
    title: '🐦 X (Twitter) Manager Pro (Rp 99rb)',
    content: '🐦 *X (TWITTER) MANAGER PRO — VIRAL THREAD & TRENDING SNIPER*\n\n' +
      'Senjata pamungkas menguasai perbincangan viral, trending topic & banjir trafik pasif di platform X!\n\n' +
      '🔥 *FITUR UNGGULAN & NILAI JUAL:*\n' +
      '✅ *Multi-Screen Profile Isolation:* Kelola puluhan akun X sekaligus tanpa bentrok IP/cookie (Anti-Suspend).\n' +
      '✅ *Trending Reply Sniper:* Deteksi tweet viral dan balas otomatis dengan komentar cerdas ber-link jualan.\n' +
      '✅ *Auto-Thread Maker:* Buat utas panjang berseri lengkap dengan penyematan direct link di akhir tweet.\n' +
      '✅ *Cross-Boost Engine 24/7:* Saling retweet, like, dan bookmark antar-akun sendiri secara otomatis dan natural.\n' +
      '✅ *Lisensi Permanen:* Cukup bayar sekali Rp 99.000, aktif seumur hidup tanpa biaya bulanan!\n\n' +
      '💰 *POTENSI KOMISI ANDA:*\n' +
      '• Direct Seller (Tier 1): *Rp 29.700 (30%)* per lisensi terjual!\n' +
      '• Sponsor Tim (Tier 2): *Rp 4.950 (5%)* pasif dari penjualan teman Anda.\n\n' +
      '🎬 *5 VIDEO SHOWCASE DEMO RESMI SUDAH TERSEDIA DI WEB:*\n' +
      'Calon pembeli bisa langsung tonton 5 scene demo fitur di halaman penjualan:\n' +
      '🌐 {WEB_LINK}\n\n' +
      '👇 *Link Pembelian Otomatis Afiliasi Anda:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'soft_jualin_aja',
    category: 'software',
    title: '🛒 Jualin Aja — Drama Studio & AI Suite (Rp 299rb)',
    content: '🛒 *JUALIN AJA — DRAMA STUDIO & AI SUITE (KOMISI RP 89.700 / LISENSI)*\n\n' +
      'Senjata pamungkas konten kreator & afiliator untuk mendominasi TikTok, YouTube Shorts & FB Pro tanpa takut kena klaim hak cipta!\n\n' +
      '🔥 *FITUR UNGGULAN & NILAI JUAL:*\n' +
      '✅ *Full Unlock Episode:* Buka ribuan episode DramaBox, Melolo, FlickReels & NetShort dari Ep 1 sampai tamat tanpa koin.\n' +
      '✅ *Engine FFmpeg Anti-Fingerprint:* Ubah sidik jari video, color grading, mirror, tempo audio agar 100% lolos sensor hak cipta.\n' +
      '✅ *Auto Batch Merge:* Gabung 50-100 episode klip pendek jadi 1 Film Marathon 1-2 jam sekali klik.\n' +
      '✅ *AI StoryFlow & Voiceover:* Ringkas cerita & dubbing otomatis suara AI natural.\n' +
      '✅ *Lisensi Permanen:* Cukup bayar sekali Rp 299.000, aktif seumur hidup tanpa biaya bulanan!\n\n' +
      '💰 *POTENSI KOMISI ANDA:*\n' +
      '• Direct Seller (Tier 1): *Rp 89.700 (30%)* per lisensi terjual!\n' +
      '• Sponsor Tim (Tier 2): *Rp 14.950 (5%)* pasif dari penjualan teman Anda.\n\n' +
      '🎬 *5 VIDEO SHOWCASE DEMO RESMI SUDAH TERSEDIA DI WEB:*\n' +
      'Calon pembeli bisa langsung tonton 5 scene demo fitur di halaman penjualan:\n' +
      '🌐 {WEB_LINK}\n\n' +
      '👇 *Link Pembelian Otomatis Afiliasi Anda:*\n{LINK}',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'news_double_reward',
    category: 'news',
    title: '🎉 Event 2x Lipat Reward Cyber Orbit!',
    content: '🎉 *PENGUMUMAN RESMI: EVENT 2X LIPAT REWARD CYBER ORBIT!*\n\nKabar gembira untuk seluruh pemain! Selama periode pengujian perdana (14 hari), seluruh reward nonton iklan harian di *Cyber Orbit: Quantum Core* dilipatgandakan *2X LIPAT* (hingga *Rp 1.200 / hari* dari 60 iklan)!\n\n🚀 Pastikan Anda menyelesaikan kuota harian dan ajak teman bergabung di grup tester resmi kami:\n👉 https://groups.google.com/g/cyber-orbit',
    media_type: null,
    media_id: null
  },
  {
    item_key: 'news_partner_cuan',
    category: 'news',
    title: '💎 Rekomendasi Garapan & Afiliasi Cuan Lainnya',
    content: '💎 *INFO PELUANG CUAN & REKOMENDASI AFILIASI PILIHAN ADMIN*\n\nSelain bermain game dan mempromosikan software AppDock Hub, Anda juga bisa mengikuti program penghasilan tambahan rekomendasi resmi Admin di bawah ini:\n\n_(Admin dapat langsung klik tombol "✏️ Update Materi Ini" di bawah untuk mengganti teks ini dengan link referral/affiliate aplikasi atau platform cuan lainnya!)_',
    media_type: null,
    media_id: null
  }
];

let _MEM_PROMO_MAP = null;
const _MEM_ADMIN_STATES = {};
let _isPromoToolsReady = false;

async function ensurePromoToolsTable(db) {
  if (_isPromoToolsReady || !db) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS promo_tools (
        item_key TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        media_type TEXT,
        media_id TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS admin_states (
        admin_id TEXT PRIMARY KEY,
        state_action TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    for (const item of DEFAULT_PROMO_ITEMS) {
      await db.prepare(
        'INSERT OR IGNORE INTO promo_tools (item_key, category, title, content, media_type, media_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(item.item_key, item.category, item.title, item.content, item.media_type, item.media_id).run();
    }
    _isPromoToolsReady = true;
  } catch (_) {}
}

async function getAllPromoItems(env) {
  let list = [];
  if (env.DB) {
    try {
      await ensurePromoToolsTable(env.DB);
      const rows = await env.DB.prepare('SELECT * FROM promo_tools ORDER BY category ASC, item_key ASC').all();
      if (rows?.results && rows.results.length > 0) list = rows.results;
    } catch (_) {}
  }
  if (list.length === 0 && env.LICENSE_KV) {
    try {
      const raw = await env.LICENSE_KV.get('PROMO_TOOLS_STORE_V1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) list = parsed;
      }
    } catch (_) {}
  }
  if (list.length === 0) {
    list = DEFAULT_PROMO_ITEMS.map(x => ({ ...x }));
  } else {
    for (const def of DEFAULT_PROMO_ITEMS) {
      if (!list.some(x => x.item_key === def.item_key)) {
        list.push({ ...def });
      }
    }
  }
  _MEM_PROMO_MAP = list;
  return list;
}

async function getPromoItem(env, itemKey) {
  const list = await getAllPromoItems(env);
  const found = list.find(x => x.item_key === itemKey);
  if (found) return found;
  return DEFAULT_PROMO_ITEMS.find(x => x.item_key === itemKey) || null;
}

async function upsertPromoItem(env, newItem) {
  if (env.DB) {
    try {
      await ensurePromoToolsTable(env.DB);
      await env.DB.prepare(
        'INSERT INTO promo_tools (item_key, category, title, content, media_type, media_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(item_key) DO UPDATE SET title = ?, content = ?, media_type = ?, media_id = ?, updated_at = CURRENT_TIMESTAMP'
      ).bind(newItem.item_key, newItem.category, newItem.title, newItem.content, newItem.media_type || null, newItem.media_id || null, newItem.title, newItem.content, newItem.media_type || null, newItem.media_id || null).run();
    } catch (_) {}
  }
  const list = await getAllPromoItems(env);
  const idx = list.findIndex(x => x.item_key === newItem.item_key);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...newItem };
  } else {
    list.push({ ...newItem });
  }
  _MEM_PROMO_MAP = list;
  if (env.LICENSE_KV) {
    try {
      await env.LICENSE_KV.put('PROMO_TOOLS_STORE_V1', JSON.stringify(list));
    } catch (_) {}
  }
}

async function deletePromoItem(env, itemKey) {
  if (env.DB) {
    try {
      await ensurePromoToolsTable(env.DB);
      await env.DB.prepare('DELETE FROM promo_tools WHERE item_key = ?').bind(itemKey).run();
    } catch (_) {}
  }
  const list = await getAllPromoItems(env);
  const filtered = list.filter(x => x.item_key !== itemKey);
  _MEM_PROMO_MAP = filtered;
  if (env.LICENSE_KV) {
    try {
      await env.LICENSE_KV.put('PROMO_TOOLS_STORE_V1', JSON.stringify(filtered));
    } catch (_) {}
  }
}

async function getAdminState(env, adminId) {
  if (env.DB) {
    try {
      await ensurePromoToolsTable(env.DB);
      const st = await env.DB.prepare('SELECT state_action FROM admin_states WHERE admin_id = ?').bind(adminId).first();
      if (st && st.state_action) return st.state_action;
    } catch (_) {}
  }
  if (env.LICENSE_KV) {
    try {
      const val = await env.LICENSE_KV.get(`ADMIN_STATE_${adminId}`);
      if (val) return val;
    } catch (_) {}
  }
  return _MEM_ADMIN_STATES[adminId] || null;
}

async function setAdminState(env, adminId, action) {
  if (action) {
    _MEM_ADMIN_STATES[adminId] = action;
  } else {
    delete _MEM_ADMIN_STATES[adminId];
  }
  if (env.DB) {
    try {
      await ensurePromoToolsTable(env.DB);
      if (action) {
        await env.DB.prepare(
          'INSERT INTO admin_states (admin_id, state_action, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(admin_id) DO UPDATE SET state_action = ?, updated_at = CURRENT_TIMESTAMP'
        ).bind(adminId, action, action).run();
      } else {
        await env.DB.prepare('DELETE FROM admin_states WHERE admin_id = ?').bind(adminId).run();
      }
    } catch (_) {}
  }
  if (env.LICENSE_KV) {
    try {
      if (action) {
        await env.LICENSE_KV.put(`ADMIN_STATE_${adminId}`, action);
      } else {
        await env.LICENSE_KV.delete(`ADMIN_STATE_${adminId}`);
      }
    } catch (_) {}
  }
}

async function sendPromoMenu(chatId, env) {
  const inline_keyboard = [
    [{ text: '🔥 Panduan Inti: Trik Live TikTok & Shorts (Komisi 30%)', callback_data: 'promo_view:promo_live_shorts' }],
    [{ text: '🎬 5 Video Demo Showcase Jualin Aja (Bahan Siap Download)', callback_data: 'promo_cat:shorts_video' }],
    [{ text: '🎬 5 Video Demo Showcase FB Manager (Bahan Siap Download)', callback_data: 'promo_cat:shorts_video' }],
    [{ text: '🎬 5 Video Demo Showcase LinkedIn Manager (Bahan Siap Download)', callback_data: 'promo_cat:shorts_video' }],
    [{ text: '🎬 5 Video Demo Showcase Pinterest Manager (Bahan Siap Download)', callback_data: 'promo_cat:shorts_video' }],
    [{ text: '🎬 5 Video Demo Showcase TikTok Multi-Screen (Bahan Siap Download)', callback_data: 'promo_cat:shorts_video' }],
    [{ text: '🎬 5 Video Demo Showcase Reddit Manager (Bahan Siap Download)', callback_data: 'promo_cat:shorts_video' }],
    [{ text: '🎬 5 Video Demo Showcase X (Twitter) Manager (Bahan Siap Download)', callback_data: 'promo_cat:shorts_video' }],
    [{ text: '📝 Ide Post Teks Facebook (5 Copywriting Siap Copas)', callback_data: 'promo_cat:fb_post' }],
    [{ text: '🎬 Ide Video Shorts, TikTok & Reels (Naskah & Video Viral)', callback_data: 'promo_cat:shorts_video' }],
    [{ text: '🎙️ Ide & Naskah Live Streaming (4 Tema Interaktif Cuan)', callback_data: 'promo_cat:live_stream' }],
    [{ text: '💻 Materi Promosi Software (FB, TikTok, Pinterest, dll)', callback_data: 'promo_cat:software' }],
    [{ text: '🎮 Materi Promosi Game (Cyber Orbit: Quantum Core)', callback_data: 'promo_cat:game' }]
  ];

  if (String(chatId) === CONFIG.ADMIN_TELEGRAM_ID) {
    inline_keyboard.unshift([
      { text: '👑 Panduan Khusus Admin: Cara Rekrut 1.000+ Afiliator', callback_data: 'admin_recruit:menu' }
    ]);
    inline_keyboard.push([
      { text: '➕ Tambah Materi Promo Baru', callback_data: 'promo_add:software' }
    ]);
  }

  let msgText =
    `📢 *PUSAT ALAT PROMOSI & KONTEN VIRAL SIAP PAKAI*\n\n` +
    `🔥 *Trik Cepat Cuan:* Gunakan bot ini sebagai pancingan gratis di sosmed! Tampilkan kemampuan AI membuat drama & video gratis, lalu bagikan link referral unik Anda.\n\n` +
    `Setiap ada penonton/teman yang membeli software otomatisasi bisnis, Anda *LANGSUNG DAPAT KOMISI 30%* (Rp 29.700 – Rp 89.700 per lisensi) + *5% Komisi Tim Pasif* seumur hidup!\n\n` +
    `Pilih kategori konten di bawah ini (seluruh materi sudah otomatis terisi Link Referral Anda):`;

  if (String(chatId) === CONFIG.ADMIN_TELEGRAM_ID) {
    msgText += `\n\n👑 *Mode Admin Aktif:* Anda dapat mengubah atau menambah sub-menu materi promosi kapan saja cukup dengan copas di chat!`;
  }

  await sendTelegramMessage(chatId, msgText, { inline_keyboard });
}

async function sendPromoCategoryMenu(chatId, env, category) {
  const allItems = await getAllPromoItems(env);
  const items = allItems.filter(r => r.category === category);

  const catMeta = {
    fb_post: {
      title: '📝 *KUMPULAN COPYWRITING & POST FACEBOOK*',
      desc: 'Berikut adalah materi ide copywriting dan status Facebook siap pakai. Setiap teks sudah otomatis berisi Link Referral unik Anda. Tinggal Copy-Paste ke status profil pribadi atau grup Facebook!'
    },
    shorts_video: {
      title: '🎬 *IDE VIDEO SHORTS, TIKTOK & REELS*',
      desc: 'Berikut adalah naskah, hook 3 detik pertama, dan konsep video 15–30 detik viral. Gunakan untuk merekam layar HP dan arahkan penonton untuk klik link referral di bio profil Anda!'
    },
    live_stream: {
      title: '🎙️ *PANDUAN & NASKAH LENGKAP LIVE STREAMING VIRAL*',
      desc: 'Metode tercepat mendapatkan ratusan pembeli software! Buka Live Streaming (share screen HP) di TikTok / YouTube / FB, dan gunakan panduan interaktif di bawah:'
    },
    software: {
      title: '💻 *MATERI PROMOSI SOFTWARE OTOMATISASI*',
      desc: 'Pilih materi promosi resmi untuk software otomatisasi bisnis (Jualin Aja, FB Pro, TikTok Pro, Reddit Pro, dll). Komisi langsung 30% per lisensi!'
    },
    game: {
      title: '🎮 *MATERI PROMOSI GAME CYBER ORBIT*',
      desc: 'Materi promosi game Android Cyber Orbit: Quantum Core. Otomatis terhubung dengan link Google Play Store referral Anda!'
    }
  };

  const currentMeta = catMeta[category] || {
    title: '📢 *MATERI PROMOSI*',
    desc: 'Pilih materi di bawah ini (sudah otomatis terisi link referral unik Anda):'
  };

  const inline_keyboard = [];
  for (const it of items) {
    inline_keyboard.push([{ text: it.title, callback_data: `promo_view:${it.item_key}` }]);
  }

  inline_keyboard.push([
    { text: '⬅️ Kembali ke Pusat Alat Promosi', callback_data: 'promo_menu' }
  ]);

  const msgText =
    `${currentMeta.title}\n\n` +
    `${currentMeta.desc}\n\n` +
    `👇 *Klik salah satu materi di bawah untuk membuka teks lengkap & link Anda:*`;

  await sendTelegramMessage(chatId, msgText, { inline_keyboard });
}

async function sendNewsMenu(chatId, env) {
  const allItems = await getAllPromoItems(env);
  const newsList = allItems.filter(r => r.category === 'news');

  const inline_keyboard = [];
  for (const n of newsList) {
    inline_keyboard.push([{ text: n.title, callback_data: `promo_view:${n.item_key}` }]);
  }

  if (String(chatId) === CONFIG.ADMIN_TELEGRAM_ID) {
    inline_keyboard.push([
      { text: '➕ Tambah Berita / Info / Referral Baru', callback_data: 'promo_add:news' }
    ]);
  }

  let msgText =
    `📰 *BERITA, PENGUMUMAN & INFO PELUANG CUAN*\n\n` +
    `Pilih informasi di bawah ini untuk membaca update terbaru ekosistem AppDock Hub, event berhadiah, serta *rekomendasi garapan / program afiliasi pilihan*:\n`;

  if (String(chatId) === CONFIG.ADMIN_TELEGRAM_ID) {
    msgText += `\n👑 *Mode Admin Aktif:* Anda bebas menambahkan pengumuman atau mempromosikan *link referral/affiliate aplikasi lain milik Anda* di menu ini cukup dengan *Copas di chat* (bisa juga langsung di-*Broadcast* ke semua member)!`;
  }

  await sendTelegramMessage(chatId, msgText, { inline_keyboard });
}

async function sendPromoItemDetail(chatId, itemKey, env) {
  const item = await getPromoItem(env, itemKey);
  if (!item) {
    await sendTelegramMessage(chatId, '⚠️ Materi tidak ditemukan.');
    return;
  }

  const isNews = item.category === 'news';
  let finalContent = item.content || '';
  const isJualin = itemKey.includes('jualin');
  const isFb = itemKey.includes('video_fb_') || itemKey === 'soft_fb_pro';
  const isLinkedin = itemKey.includes('video_linkedin_') || itemKey === 'soft_linkedin_pro';
  const isPinterest = itemKey.includes('video_pinterest_') || itemKey === 'soft_pinterest_pro';
  const isTikTok = itemKey.includes('video_tiktok_') || itemKey === 'soft_tiktok_pro';
  const isReddit = itemKey.includes('video_reddit_') || itemKey === 'soft_reddit_pro';
  const isX = itemKey.includes('video_x_') || itemKey === 'soft_x_pro';
  let personalLink = '';
  let webLink = '';

  if (!isNews) {
    const gameSlug = itemKey.replace(/^game_/, '').replace(/_/g, '-');
    const softProdKey = isJualin ? 'soft_a' : (isFb ? 'fb_pro' : (isLinkedin ? 'linkedin_pro' : (isPinterest ? 'pinterest_pro' : (isTikTok ? 'tiktok_pro' : (isReddit ? 'reddit_pro' : (isX ? 'x_pro' : resolveProductKey(itemKey.replace(/^soft_/, ''))))))));

    personalLink = item.category === 'game'
      ? (gameSlug === 'cyber-orbit' ? `https://appdockhub.com/play?ref=${chatId}` : `https://appdockhub.com/play?ref=${chatId}&game=${gameSlug}`)
      : (softProdKey ? `https://t.me/${CONFIG.BOT_USERNAME}?start=buy_${softProdKey}_ref_${chatId}` : `https://t.me/${CONFIG.BOT_USERNAME}?start=ref_${chatId}`);

    webLink = isJualin
      ? `https://appdockhub.com/jualinaja.html?ref=${chatId}`
      : (isFb ? `https://appdockhub.com/facebook.html?ref=${chatId}` : (isLinkedin ? `https://appdockhub.com/linkedin.html?ref=${chatId}` : (isPinterest ? `https://appdockhub.com/pinterest.html?ref=${chatId}` : (isTikTok ? `https://appdockhub.com/tiktok.html?ref=${chatId}` : (isReddit ? `https://appdockhub.com/reddit.html?ref=${chatId}` : (isX ? `https://appdockhub.com/x.html?ref=${chatId}` : `https://appdockhub.com/index.html?ref=${chatId}`))))));

    if (finalContent.includes('{LINK}')) {
      finalContent = finalContent.replace(/\{LINK\}/g, personalLink);
    } else {
      finalContent += `\n\n👉 ${personalLink}`;
    }

    if (finalContent.includes('{WEB_LINK}')) {
      finalContent = finalContent.replace(/\{WEB_LINK\}/g, webLink);
    }
  }

  const inline_keyboard = [];

  // 1. Tombol Tindakan Interaktif (Buka Web / Download Video / Buka Game)
  if (item.category === 'game' && personalLink) {
    inline_keyboard.push([
      { text: '🎮 Mainkan di Android (Google Play)', url: personalLink }
    ]);
  } else if (isJualin) {
    inline_keyboard.push([
      { text: '🎬 Tonton Video Demo 5 Scene di Web', url: webLink }
    ]);

    const videoSceneMap = {
      'video_jualin_scene1': 'https://appdockhub.com/assets/videos/jualinaja-scene1-intro.mp4',
      'video_jualin_scene2': 'https://appdockhub.com/assets/videos/jualinaja-scene2-talent.mp4',
      'video_jualin_scene3': 'https://appdockhub.com/assets/videos/jualinaja-scene3-drama.mp4',
      'video_jualin_scene4': 'https://appdockhub.com/assets/videos/jualinaja-scene4-speech.mp4',
      'video_jualin_scene5': 'https://appdockhub.com/assets/videos/jualinaja-scene5-earning.mp4',
    };

    if (videoSceneMap[itemKey]) {
      inline_keyboard.push([
        { text: '📥 Download Bahan Video MP4', url: videoSceneMap[itemKey] }
      ]);
    }

    if (personalLink) {
      inline_keyboard.push([
        { text: '🛒 Beli Lisensi via Bot (Ref Anda)', url: personalLink }
      ]);
    }
  } else if (isFb) {
    inline_keyboard.push([
      { text: '🎬 Tonton Video Demo 5 Scene di Web', url: webLink }
    ]);

    const fbVideoSceneMap = {
      'video_fb_scene1': 'https://appdockhub.com/assets/videos/fbmanager-scene1-intro.mp4',
      'video_fb_scene2': 'https://appdockhub.com/assets/videos/fbmanager-scene2-multiscreen.mp4',
      'video_fb_scene3': 'https://appdockhub.com/assets/videos/fbmanager-scene3-marketplace.mp4',
      'video_fb_scene4': 'https://appdockhub.com/assets/videos/fbmanager-scene4-automation.mp4',
      'video_fb_scene5': 'https://appdockhub.com/assets/videos/fbmanager-scene5-earning.mp4',
    };

    if (fbVideoSceneMap[itemKey]) {
      inline_keyboard.push([
        { text: '📥 Download Bahan Video MP4', url: fbVideoSceneMap[itemKey] }
      ]);
    }

    if (personalLink) {
      inline_keyboard.push([
        { text: '🛒 Beli Lisensi via Bot (Ref Anda)', url: personalLink }
      ]);
    }
  } else if (isLinkedin) {
    inline_keyboard.push([
      { text: '🎬 Tonton Video Demo 5 Scene di Web', url: webLink }
    ]);

    const lkVideoSceneMap = {
      'video_linkedin_scene1': 'https://appdockhub.com/assets/videos/linkedin-scene1-intro.mp4',
      'video_linkedin_scene2': 'https://appdockhub.com/assets/videos/linkedin-scene2-multiscreen.mp4',
      'video_linkedin_scene3': 'https://appdockhub.com/assets/videos/linkedin-scene3-post.mp4',
      'video_linkedin_scene4': 'https://appdockhub.com/assets/videos/linkedin-scene4-automation.mp4',
      'video_linkedin_scene5': 'https://appdockhub.com/assets/videos/linkedin-scene5-earning.mp4',
    };

    if (lkVideoSceneMap[itemKey]) {
      inline_keyboard.push([
        { text: '📥 Download Bahan Video MP4', url: lkVideoSceneMap[itemKey] }
      ]);
    }

    if (personalLink) {
      inline_keyboard.push([
        { text: '🛒 Beli Lisensi via Bot (Ref Anda)', url: personalLink }
      ]);
    }
  } else if (isPinterest) {
    inline_keyboard.push([
      { text: '🎬 Tonton Video Demo 5 Scene di Web', url: webLink }
    ]);

    const pinVideoSceneMap = {
      'video_pinterest_scene1': 'https://appdockhub.com/assets/videos/pinterest-scene1-intro.mp4',
      'video_pinterest_scene2': 'https://appdockhub.com/assets/videos/pinterest-scene2-multiscreen.mp4',
      'video_pinterest_scene3': 'https://appdockhub.com/assets/videos/pinterest-scene3-pincomposer.mp4',
      'video_pinterest_scene4': 'https://appdockhub.com/assets/videos/pinterest-scene4-automation.mp4',
      'video_pinterest_scene5': 'https://appdockhub.com/assets/videos/pinterest-scene5-earning.mp4',
    };

    if (pinVideoSceneMap[itemKey]) {
      inline_keyboard.push([
        { text: '📥 Download Bahan Video MP4', url: pinVideoSceneMap[itemKey] }
      ]);
    }

    if (personalLink) {
      inline_keyboard.push([
        { text: '🛒 Beli Lisensi via Bot (Ref Anda)', url: personalLink }
      ]);
    }
  } else if (isTikTok) {
    inline_keyboard.push([
      { text: '🎬 Tonton Video Demo 5 Scene di Web', url: webLink }
    ]);

    const tkVideoSceneMap = {
      'video_tiktok_scene1': 'https://appdockhub.com/assets/videos/tiktok-scene1-intro.mp4',
      'video_tiktok_scene2': 'https://appdockhub.com/assets/videos/tiktok-scene2-multiscreen.mp4',
      'video_tiktok_scene3': 'https://appdockhub.com/assets/videos/tiktok-scene3-login.mp4',
      'video_tiktok_scene4': 'https://appdockhub.com/assets/videos/tiktok-scene4-upload.mp4',
      'video_tiktok_scene5': 'https://appdockhub.com/assets/videos/tiktok-scene5-earning.mp4',
    };

    if (tkVideoSceneMap[itemKey]) {
      inline_keyboard.push([
        { text: '📥 Download Bahan Video MP4', url: tkVideoSceneMap[itemKey] }
      ]);
    }

    if (personalLink) {
      inline_keyboard.push([
        { text: '🛒 Beli Lisensi via Bot (Ref Anda)', url: personalLink }
      ]);
    }
  } else if (isReddit) {
    inline_keyboard.push([
      { text: '🎬 Tonton Video Demo 5 Scene di Web', url: webLink }
    ]);

    const rdVideoSceneMap = {
      'video_reddit_scene1': 'https://appdockhub.com/assets/videos/reddit-scene1-intro.mp4',
      'video_reddit_scene2': 'https://appdockhub.com/assets/videos/reddit-scene2-multiscreen.mp4',
      'video_reddit_scene3': 'https://appdockhub.com/assets/videos/reddit-scene3-subreddit.mp4',
      'video_reddit_scene4': 'https://appdockhub.com/assets/videos/reddit-scene4-automation.mp4',
      'video_reddit_scene5': 'https://appdockhub.com/assets/videos/reddit-scene5-earning.mp4',
    };

    if (rdVideoSceneMap[itemKey]) {
      inline_keyboard.push([
        { text: '📥 Download Bahan Video MP4', url: rdVideoSceneMap[itemKey] }
      ]);
    }

    if (personalLink) {
      inline_keyboard.push([
        { text: '🛒 Beli Lisensi via Bot (Ref Anda)', url: personalLink }
      ]);
    }
  } else if (isX) {
    inline_keyboard.push([
      { text: '🎬 Tonton Video Demo 5 Scene di Web', url: webLink }
    ]);

    const xVideoSceneMap = {
      'video_x_scene1': 'https://appdockhub.com/assets/videos/x-scene1-intro.mp4',
      'video_x_scene2': 'https://appdockhub.com/assets/videos/x-scene2-multiscreen.mp4',
      'video_x_scene3': 'https://appdockhub.com/assets/videos/x-scene3-tweet.mp4',
      'video_x_scene4': 'https://appdockhub.com/assets/videos/x-scene4-automation.mp4',
      'video_x_scene5': 'https://appdockhub.com/assets/videos/x-scene5-earning.mp4',
    };

    if (xVideoSceneMap[itemKey]) {
      inline_keyboard.push([
        { text: '📥 Download Bahan Video MP4', url: xVideoSceneMap[itemKey] }
      ]);
    }

    if (personalLink) {
      inline_keyboard.push([
        { text: '🛒 Beli Lisensi via Bot (Ref Anda)', url: personalLink }
      ]);
    }
  } else if (item.category === 'software' && personalLink) {
    inline_keyboard.push([
      { text: '🛒 Beli Lisensi via Bot (Ref Anda)', url: personalLink }
    ]);
  }

  // 2. Menu Khusus Admin (Edit, Broadcast, Hapus)
  if (String(chatId) === CONFIG.ADMIN_TELEGRAM_ID) {
    inline_keyboard.push([
      { text: '✏️ Update Materi Ini (Tinggal Copas)', callback_data: `promo_edit:${item.item_key}` }
    ]);
    if (isNews) {
      inline_keyboard.push([
        { text: '📣 Broadcast Info Ini ke Semua Member', callback_data: `news_bcast:${item.item_key}` }
      ]);
    }
    inline_keyboard.push([
      { text: '🗑️ Hapus Sub-Menu Ini', callback_data: `promo_del:${item.item_key}` }
    ]);
  }

  // 3. Tombol Kembali Navigasi
  const isCategorized = ['fb_post', 'shorts_video', 'live_stream', 'software', 'game'].includes(item.category);
  const backTarget = isCategorized ? `promo_cat:${item.category}` : (isNews ? 'news_menu' : 'promo_menu');
  const backLabel = isCategorized ? '⬅️ Kembali ke Kategori Materi' : (isNews ? '⬅️ Kembali ke Berita & Info' : '⬅️ Kembali ke Pusat Promosi');

  inline_keyboard.push([
    {
      text: backLabel,
      callback_data: backTarget
    }
  ]);

  const markup = { inline_keyboard };

  if (item.media_type === 'photo' && item.media_id) {
    await sendTelegramPhoto(chatId, item.media_id, finalContent, markup);
  } else if (item.media_type === 'video' && item.media_id) {
    await sendTelegramVideo(chatId, item.media_id, finalContent, markup);
  } else {
    await sendTelegramMessage(chatId, finalContent, markup);
  }
}

async function broadcastNewsItem(adminChatId, itemKey, env) {
  const item = await getPromoItem(env, itemKey);
  if (!item) return;

  let users = [];
  if (env.DB) {
    try {
      const usersRes = await env.DB.prepare("SELECT telegram_id FROM users WHERE telegram_id NOT LIKE 'temp_%'").all();
      users = usersRes?.results || [];
    } catch (_) {}
  }
  if (users.length === 0) {
    users = [{ telegram_id: adminChatId }];
  }

  let sentCount = 0;
  for (const u of users) {
    if (!u.telegram_id) continue;
    try {
      if (item.media_type === 'photo' && item.media_id) {
        await sendTelegramPhoto(u.telegram_id, item.media_id, item.content);
      } else if (item.media_type === 'video' && item.media_id) {
        await sendTelegramVideo(u.telegram_id, item.media_id, item.content);
      } else {
        await sendTelegramMessage(u.telegram_id, item.content);
      }
      sentCount++;
    } catch (_) {}
  }

  await sendTelegramMessage(adminChatId, `📣 *BROADCAST SELESAI!*\nInfo *"${item.title}"* berhasil dikirimkan ke *${sentCount} member* aktif!`);
}

// ============================================================================
// 👑 PANDUAN MASTER REKRUTMEN AFILIASI KHUSUS ADMIN (PLAYBOOK RAHASIA)
// ============================================================================
const ADMIN_RECRUITMENT_MODULES = {
  'modul_1': {
    title: '🎯 Modul 1: Umpan "AI Gratis" di Komunitas Kreator',
    shortTitle: '🎯 Modul 1: Umpan AI Gratis di Komunitas Kreator',
    content:
      `👑 *MODUL 1: UMPAN "AI GRATIS" DI KOMUNITAS KREATOR & EDITOR VIDEO*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `💡 *LOGIKA STRATEGI:*\n` +
      `Jangan pernah mengajak orang asing dengan kata-kata: "Ayo jualan software". Orang akan defensif. Gunakan *Umpan Nilai Tinggi (Lead Magnet)* berupa Bot AI gratis di Telegram ini yang bisa membuat Text-to-Video HD & Drama China otomatis tanpa watermark!\n\n` +
      `📍 *KOLAM TARGET TERBAIK:*\n` +
      `• Grup Facebook: "Komunitas CapCut Indonesia", "YouTuber Pemula", "Kreator TikTok Edukasi", "Komunitas AI Video", "Canva & Video Editing"\n` +
      `• Channel & Grup Telegram seputar tools digital, prompt AI & cari uang online\n` +
      `• Kolom komentar video tutorial AI di TikTok / YouTube\n\n` +
      `🔥 *CARA EKSEKUSI:*\n` +
      `1️⃣ Buat 1 video keren dari bot ini (misal: "Mobil balap di kota cyberpunk" atau cuplikan drama).\n` +
      `2️⃣ Posting video tersebut ke grup dengan caption pancingan:\n` +
      `   👉 *"Kaget nemu bot Telegram yang bisa render video cinematic 60 FPS & drama pendek otomatis gratis tanpa watermark. Yang mau botnya tak share di kolom komentar ya!"*\n` +
      `3️⃣ Sematkan link bot referral Anda di komentar: {LINK}\n` +
      `4️⃣ Saat ratusan kreator masuk ke bot, mereka akan terpukau dengan kualitasnya dan melihat menu *🔗 Link Afiliasi Saya* dan katalog software bisnis. Mereka akan tergiur untuk ikut mempromosikan bot ini ke penonton mereka!`
  },
  'modul_2': {
    title: '📢 Modul 2: Gerilya di Grup Loker, Mahasiswa & IRT',
    shortTitle: '📢 Modul 2: Gerilya di Grup Loker, Mahasiswa & IRT',
    content:
      `👑 *MODUL 2: GERILYA DI GRUP LOKER, WFH, MAHASISWA & RESELLER*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `💡 *LOGIKA STRATEGI:*\n` +
      `Setiap hari ada puluhan ribu orang mencari penghasilan sampingan tanpa modal di Facebook & Telegram. Jadikan program kemitraan software ini sebagai "Lowongan Kemitraan Digital Resmi"!\n\n` +
      `📍 *KOLAM TARGET:*\n` +
      `• Grup FB: "Lowongan Kerja WFH / Freelance", "Bisnis Online Mahasiswa", "Ibu Rumah Tangga Berpenghasilan", "Peluang Usaha Modal HP", "Grup Dropship & Reseller"\n\n` +
      `🔥 *POLA POSTINGAN REKRUTMEN (CONTOH):*\n` +
      `   *Dicari 20 Orang untuk Program Afiliasi Software Bisnis (Kerja dari HP)*\n` +
      `   ✅ Komisi 30% per penjualan (Rp 29.700 – Rp 89.700 langsung cair)\n` +
      `   ✅ Bonus Pasif Tier-2: 5% dari setiap penjualan tim Anda\n` +
      `   ✅ Tanpa modal, tanpa stok barang, tanpa packing\n` +
      `   ✅ Disediakan 25 bahan postingan & naskah live siap copas!\n` +
      `   👉 Yang serius mau nambah uang jajan, langsung masuk ke bot pendaftaran resmi di: {LINK}\n\n` +
      `💡 *Tips Admin:* Arahkan mereka untuk segera membuka menu *📢 Alat Promosi* di bot agar mereka langsung aktif promosi di hari pertama!`
  },
  'modul_3': {
    title: '📩 Modul 3: Direct Hunting & DM Eksklusif ke Kreator Mikro',
    shortTitle: '📩 Modul 3: DM Hunting Kreator TikTok Mikro',
    content:
      `👑 *MODUL 3: DIRECT HUNTING KE KREATOR TIKTOK / SHORTS MIKRO*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `💡 *LOGIKA STRATEGI:*\n` +
      `1 kreator aktif dengan 2.000 – 15.000 followers jauh lebih menghasilkan daripada 100 orang biasa, karena mereka sudah memiliki audiens yang percaya dan aktif menonton video/live mereka!\n\n` +
      `📍 *KREATOR SASARAN:*\n` +
      `• Akun TikTok/Shorts yang sering upload cuplikan drama pendek / film alur cerita\n` +
      `• Akun edukasi bisnis online & tips jualan olshop\n` +
      `• Akun review tools AI & teknologi\n\n` +
      `🔥 *TEMPLATE DM PERSONAL:* (Kirim via DM TikTok / Instagram / Email Bio):\n` +
      `   *"Halo Kak [Nama Kreator]! Salam kenal ya. Saya suka banget sama video-video Kakak di TikTok.\n\n` +
      `   Saya dari tim official AppDock Hub ingin mengajak Kakak menjadi Official Affiliate Partner. Kami menyediakan bot Telegram AI canggih yang bisa Kakak pakai gratis untuk bahan live streaming & konten video Kakak.\n\n` +
      `   Kakak berhak mendapatkan Komisi 30% (Rp 29.700 - Rp 89.700 per lisensi) dari setiap software otomatisasi bisnis yang dibeli penonton lewat link bio Kakak.\n\n` +
      `   Jika Kakak tertarik, Kakak bisa langsung cek dan coba botnya di sini: {LINK} - Nanti kami support materi promosi lengkapnya ya Kak!"*`
  },
  'modul_4': {
    title: '👥 Modul 4: Meledakkan Pasukan Afiliasi via Efek Tier-2 (5%)',
    shortTitle: '👥 Modul 4: Efek Bola Salju Tier-2 (5%)',
    content:
      `👑 *MODUL 4: EFEK BOLA SALJU TIER-2 (AFFILIATE RECRUIT AFFILIATE)*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `💡 *LOGIKA STRATEGI:*\n` +
      `Sistem afiliasi AppDock Hub memiliki fitur komisi 2-Tier:\n` +
      `• Tier 1: 30% (Penjual Langsung)\n` +
      `• Tier 2: 5% (Sponsor Tim Pasif)\n\n` +
      `Tugas Admin adalah mengedukasi afiliator yang sudah bergabung agar mereka merekrut teman-teman mereka sendiri untuk menjadi "Sub-Afiliator"!\n\n` +
      `📊 *SIMULASI PENGHASILAN PASIF UNTUK AFILIATOR:*\n` +
      `Katakan ke afiliator Anda:\n` +
      `*"Kalau kamu rekrut 10 teman aktif jadi afiliator, dan masing-masing teman berhasil jual 2 software per hari:\n` +
      `Total 20 software terjual x Rp 4.950 – Rp 14.950 = Rp 100.000 – Rp 300.000 / HARI masuk ke dompetmu secara PASIF tanpa kamu perlu jualan sendiri!"*\n\n` +
      `🚀 *HASIL AKHIR:* Para afiliator akan berlomba-lomba mengajak temannya bergabung memakai link referral mereka, dan jaringan afiliator Anda akan meledak secara eksponensial tanpa Anda perlu rekrut manual lagi!`
  },
  'modul_5': {
    title: '🏆 Modul 5: Gamifikasi Leaderboard Mingguan & Bonus Reward',
    shortTitle: '🏆 Modul 5: Leaderboard & Reward Bulanan',
    content:
      `👑 *MODUL 5: KONTES AFILIASI BULANAN & LEADERBOARD REWARD*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `💡 *LOGIKA STRATEGI:*\n` +
      `Afiliator akan bekerja 10x lebih giat jika ada kompetisi, peringkat, dan apresiasi publik dari Admin!\n\n` +
      `🎁 *CARA MEMBUAT EVENT KONTES LEADERBOARD:*\n` +
      `Gunakan fitur broadcast di bot untuk mengumumkan:\n` +
      `*"🔥 KONTES AFILIASI BULAN INI: TOTAL HADIAH RP 1.000.000 + LISENSI FULL!"*\n\n` +
      `• 🥇 Juara 1: Bonus Cash Rp 500.000 + Lisensi Full Jualin Aja\n` +
      `• 🥈 Juara 2: Bonus Cash Rp 250.000 + Lisensi Full Facebook Pro\n` +
      `• 🥉 Juara 3: Bonus Cash Rp 150.000\n` +
      `• 🎖️ Setiap afiliator yang berhasil mencapai 3 penjualan pertama dapat bonus gratis lisensi software senilai Rp 99.000!\n\n` +
      `📢 *Kirim update peringkat setiap hari Minggu malam:* Ini akan memicu FOMO (Fear of Missing Out) dan membuat afiliator di peringkat 4 & 5 tancap gas live streaming untuk menyalip juara di atasnya!`
  },
  'modul_6': {
    title: '📋 Modul 6: Kumpulan Script Rekrutmen Siap Copas',
    shortTitle: '📋 Modul 6: Script Rekrutmen Siap Copas',
    content:
      `👑 *MODUL 6: KUMPULAN SCRIPT REKRUTMEN SIAP COPAS*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `📌 *1. SCRIPT BROADCAST KE MEMBER BOT (Pemicu Afiliasi):*\n` +
      `"📢 Pengumuman Penting untuk Seluruh Member AppDock Hub!\n\n` +
      `Tahukah Anda bahwa bot ini memiliki program kemitraan resmi dengan komisi 30% per software terjual? Anda bisa hasilkan Rp 29.700 – Rp 89.700 per transaksi hanya dengan membagikan bot AI gratis ini ke sosmed!\n\n` +
      `Buka menu 🔗 Link Afiliasi Saya dan 📢 Alat Promosi sekarang untuk mengambil materi promosi perdana Anda!"\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📌 *2. SCRIPT POSTINGAN STATUS WA & FB:* (Pancingan Teman Dekat)\n` +
      `"Lagi butuh 5 orang yang mau belajar cari uang tambahan dari HP modal share link bot AI Telegram. Komisinya 30% langsung cair ke rekening. Yang mau dibimbing gratis komen atau WA aku ya!"\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📌 *3. SCRIPT DI GRUP TELEGRAM & FORUM BISNIS:*\n` +
      `"Info peluang kemitraan digital 2026: Tersedia software otomatisasi Facebook, TikTok, Reddit & Jualin Aja dengan komisi afiliasi 30% + 5% Tier 2. Disediakan materi naskah video & trik live streaming siap pakai. Daftar gratis di: {LINK}"`
  }
};

async function sendAdminRecruitmentMenu(chatId, env) {
  if (String(chatId) !== CONFIG.ADMIN_TELEGRAM_ID) {
    await sendTelegramMessage(chatId, '⛔ Akses ditolak: Modul ini hanya untuk Administrator sistem.');
    return;
  }

  const inline_keyboard = [];
  for (const [key, mod] of Object.entries(ADMIN_RECRUITMENT_MODULES)) {
    inline_keyboard.push([{ text: mod.shortTitle, callback_data: `admin_recruit:${key}` }]);
  }

  inline_keyboard.push([
    { text: '⬅️ Tutup Panduan Admin', callback_data: 'admin_back_main' }
  ]);

  const msgText =
    `👑 *PLAYBOOK RAHASIA ADMIN: CARA REKRUT 1.000+ AFILIATOR AKTIF*\n\n` +
    `Selamat datang di panduan strategi master Admin! Di sini Anda akan mempelajari cara membangun pasukan afiliator yang bekerja 24 jam mempromosikan software & bot Anda secara massal.\n\n` +
    `👇 *Pilih modul taktis di bawah ini untuk membaca panduan lengkap & copas naskahnya:*`;

  await sendTelegramMessage(chatId, msgText, { inline_keyboard });
}

async function sendAdminRecruitmentDetail(chatId, moduleKey) {
  if (String(chatId) !== CONFIG.ADMIN_TELEGRAM_ID) {
    await sendTelegramMessage(chatId, '⛔ Akses ditolak: Modul ini hanya untuk Administrator sistem.');
    return;
  }

  const mod = ADMIN_RECRUITMENT_MODULES[moduleKey];
  if (!mod) {
    await sendTelegramMessage(chatId, '⚠️ Modul tidak ditemukan.');
    return;
  }

  const botRefLink = `https://t.me/${CONFIG.BOT_USERNAME}?start=ref_${chatId}`;
  const finalContent = mod.content.replace(/\{LINK\}/g, botRefLink);

  const inline_keyboard = [
    [{ text: '⬅️ Kembali ke Daftar Modul Rekrutmen', callback_data: 'admin_recruit:menu' }]
  ];

  await sendTelegramMessage(chatId, finalContent, { inline_keyboard });
}

function generateQrisCaption(productName, priceFormatted, refCode, hwidExample = 'HWID-XXXX-XXXX') {
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
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
        body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: #080c14; }
        .glass-card {
            background: rgba(15, 23, 42, 0.75);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
    </style>
</head>
<body class="flex items-center justify-center min-h-screen p-4 text-white">
    <div class="glass-card w-full max-w-md p-8 rounded-3xl shadow-2xl text-center relative overflow-hidden">
        <div class="absolute -top-12 -right-12 w-32 h-32 bg-orange-500/10 rounded-full blur-2xl"></div>
        <div class="absolute -bottom-12 -left-12 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl"></div>

        <div class="mb-6 relative">
            <div class="w-20 h-20 bg-gradient-to-tr from-orange-600 to-amber-500 rounded-2xl flex items-center justify-center mx-auto text-white shadow-xl shadow-orange-500/20">
                <i class="fas fa-shield-alt text-3xl"></i>
            </div>
        </div>

        <h1 class="text-2xl font-bold tracking-tight text-white mb-1">AppDock Hub</h1>
        <p class="text-xs text-orange-400 font-semibold tracking-wider uppercase mb-2">License & Hardware Binding Portal</p>
        <p class="text-gray-400 text-xs mb-6">Masukkan Hardware ID (HWID) dan Kunci Lisensi Anda untuk mengaktifkan software.</p>

        <div class="space-y-4">
            <div class="text-left">
                <label class="text-[11px] text-gray-400 font-medium ml-1 mb-1 block">Hardware ID (HWID)</label>
                <div class="relative">
                    <i class="fas fa-desktop absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm"></i>
                    <input type="text" id="hwidInput" placeholder="HWID-XXXX-XXXX / RD-HWID-XXXX" 
                        class="w-full pl-11 pr-4 py-3 bg-slate-900/90 border border-slate-700/80 rounded-xl text-white font-mono text-xs placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 transition">
                </div>
            </div>

            <div class="text-left">
                <label class="text-[11px] text-gray-400 font-medium ml-1 mb-1 block">License Key</label>
                <div class="relative">
                    <i class="fas fa-key absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm"></i>
                    <input type="text" id="licenseKey" placeholder="LIC-XXXX-XXXX / RD-PRO-XXXX" 
                        class="w-full pl-11 pr-4 py-3 bg-slate-900/90 border border-slate-700/80 rounded-xl text-white font-mono text-xs placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 transition">
                </div>
            </div>

            <button onclick="activateLicense()" id="btnActivate" 
                class="w-full py-3.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white font-semibold rounded-xl transition shadow-lg shadow-orange-600/30 flex items-center justify-center gap-2 mt-2">
                <span>Aktivasi Sekarang</span>
                <i class="fas fa-arrow-right text-xs"></i>
            </button>

            <div class="pt-3">
                <a href="https://t.me/${CONFIG.BOT_USERNAME}?start=ref_${refCode}" target="_blank" 
                   class="text-xs text-orange-400 hover:text-orange-300 transition underline inline-flex items-center gap-1.5">
                    <i class="fab fa-telegram"></i>
                    <span>Belum punya lisensi? Pilih & Beli Software via Bot Telegram</span>
                </a>
            </div>
        </div>

        <div class="mt-8 pt-4 border-t border-slate-800/80 flex justify-between items-center text-[10px] text-gray-500">
            <span>Hardware Security Protocol</span>
            <span class="font-mono text-amber-500/80">1 Device = 1 License</span>
        </div>
    </div>

    <script>
        async function activateLicense() {
            const hwid = document.getElementById('hwidInput').value.trim();
            const key = document.getElementById('licenseKey').value.trim();
            const btn = document.getElementById('btnActivate');

            if (!hwid || !key) {
                alert('Silakan masukkan Kode HWID dan License Key!');
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin text-sm"></i> Memverifikasi...';

            try {
                const res = await fetch(window.location.origin + '/activate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hwid, licenseKey: key })
                });
                const data = await res.json();

                if (data.status === 'success') {
                    alert('✅ Aktivasi Berhasil! ' + (data.message || ''));
                    window.location.reload();
                } else {
                    alert('❌ Gagal Aktivasi: ' + (data.message || 'Key tidak valid'));
                }
            } catch (err) {
                alert('⚠️ Terjadi kesalahan saat menghubungi server aktivasi.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>Aktivasi Sekarang</span><i class="fas fa-arrow-right text-xs"></i>';
            }
        }
    </script>
</body>
</html>`;
}

// ============================================================================
// 8. RENDER HALAMAN PRIVACY POLICY & DATA SAFETY (GOOGLE PLAY STORE COMPLIANT)
// ============================================================================
function renderPrivacyPolicyHtml() {
  return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy & Terms of Service - Cyber Orbit (AppDock Hub)</title>
    <style>
        body { background: #070B14; color: #E2E8F0; font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; margin: 0; padding: 32px 16px; }
        .container { max-width: 820px; margin: 0 auto; background: #0F172A; border: 1px solid #1E293B; border-radius: 16px; padding: 28px; }
        h1 { color: #00F0FF; margin-top: 0; font-size: 24px; }
        h2 { color: #FF9900; font-size: 18px; margin-top: 24px; border-bottom: 1px solid #1E293B; padding-bottom: 6px; }
        p, li { color: #CBD5E1; font-size: 14px; }
        .badge { display: inline-block; background: rgba(16,185,129,0.15); color: #10B981; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <span class="badge">Google Play Store Official Privacy Policy</span>
        <h1>Privacy Policy & Kebijakan Keamanan - Cyber Orbit</h1>
        <p><strong>Package Name:</strong> <code>com.appdockhub.ecosystem</code><br>
        <strong>Developer / Publisher:</strong> AppDock Hub Ecosystem<br>
        <strong>Effective Date:</strong> November 6, 2026</p>

        <h2>1. Informasi yang Kami Kumpulkan (Data Collection & Usage)</h2>
        <p>Aplikasi <strong>Cyber Orbit</strong> menghargai privasi pengguna dan mematuhi kebijakan Google Play Developer Program. Kami hanya memproses data teknis minimal untuk menjalankan permainan, menyimpan skor/saldo hadiah, dan mencegah kecurangan (Anti-Fraud):</p>
        <ul>
            <li><strong>ID Perangkat / Pair Token Anonim:</strong> Digunakan untuk menyinkronkan progres level permainan dan saldo hadiah pengguna.</li>
            <li><strong>Alamat IP & Integritas Jaringan:</strong> Diperiksa secara otomatis (real-time) untuk memastikan kepatuhan 1 IP = 1 Perangkat serta mendeteksi koneksi VPN, Proxy, atau Emulator PC demi mencegah <em>Invalid Traffic (IVT)</em>.</li>
            <li><strong>Advertising ID (Google AdMob & Mitra Iklan):</strong> Digunakan untuk menayangkan iklan banner dan video berhadiah (Rewarded Ads) sesuai kebijakan Google Play Families & Ads Policy.</li>
        </ul>

        <h2>2. Kebijakan Anti-Fraud & Larangan Keamanan</h2>
        <ul>
            <li><strong>Larangan Multi-Akun 1 IP:</strong> Dilarang mengakses permainan menggunakan 2 atau lebih perangkat/akun pada alamat IP publik yang sama secara bersamaan.</li>
            <li><strong>Larangan VPN & Proxy:</strong> Penggunaan VPN, HTTP/SOCKS Proxy, DNS Tunneler, atau IP Server Hosting akan mengunci akses aplikasi secara otomatis.</li>
            <li><strong>Larangan Emulator & Virtual Phone:</strong> Aplikasi hanya boleh dijalankan pada perangkat ponsel Android fisik asli (Real Physical Device). Eksekusi di dalam Emulator PC (LDPlayer, BlueStacks, Nox, MEmu), Virtual Phone (VMOS, VPhoneGaGa, X8Sandbox), atau App Cloner (Parallel Space, Dual Space) dilarang keras.</li>
            <li><strong>Sistem Peringatan 3-Strike:</strong> Pelanggaran keamanan hingga 3 kali akan memblokir akun dan perangkat secara permanen (Permanent Ban).</li>
        </ul>

        <h2>3. Penyimpanan & Penghapusan Data (Account & Data Deletion)</h2>
        <p>Kami tidak mengumpulkan nama asli, alamat rumah, daftar kontak, mikrofon, kamera, atau lokasi GPS presisi Anda. Pengguna dapat mengajukan penghapusan seluruh data akun/token kapan saja melalui Bot Dukungan Resmi Telegram kami di <a href="https://t.me/AppDockHub_Bot" style="color:#00F0FF;">@AppDockHub_Bot</a> atau email dukungan resmi di portal <strong>https://appdockhub.com</strong>.</p>

        <h2>4. Hubungi Kami (Contact Us)</h2>
        <p>Jika Anda memiliki pertanyaan terkait Kebijakan Privasi atau Kepatuhan Keamanan ini, silakan hubungi tim kami melalui:<br>
        Website Resmi: <a href="https://appdockhub.com" style="color:#00F0FF;">https://appdockhub.com</a><br>
        Telegram Support: <a href="https://t.me/AppDockHub_Bot" style="color:#00F0FF;">@AppDockHub_Bot</a></p>
    </div>
</body>
</html>`;
}

// ============================================================================
// 9. FITUR AI GRATIS (TEXT-TO-VIDEO, MOTION CONTROL & ARENA AI)
// ============================================================================
async function getUserAiState(env, chatId) {
  const id = String(chatId || '').trim();
  if (_MEM_USER_AI_STATE[id]) return _MEM_USER_AI_STATE[id];
  if (env && env.LICENSE_KV) {
    try {
      const raw = await env.LICENSE_KV.get(`ai_state:${id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        _MEM_USER_AI_STATE[id] = parsed;
        return parsed;
      }
    } catch (_) {}
  }
  return null;
}

async function setUserAiState(env, chatId, stateObj) {
  const id = String(chatId || '').trim();
  if (!stateObj) {
    delete _MEM_USER_AI_STATE[id];
    if (env && env.LICENSE_KV) {
      try { await env.LICENSE_KV.delete(`ai_state:${id}`); } catch (_) {}
    }
    return;
  }
  _MEM_USER_AI_STATE[id] = stateObj;
  if (env && env.LICENSE_KV) {
    try {
      await env.LICENSE_KV.put(`ai_state:${id}`, JSON.stringify(stateObj), { expirationTtl: 3600 });
    } catch (_) {}
  }
}

async function sendAiStudioMenu(chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🍿 Generate Drama Viral', callback_data: 'drama_menu' }
      ],
      [
        { text: '🎬 Text-to-Video AI (HD 60 FPS)', callback_data: 'ai_mode:t2v' },
        { text: '🕹️ Motion Control AI (6 Efek Kamera)', callback_data: 'ai_mode:motion' }
      ],
      [
        { text: '🎨 Buat Gambar HD (Flux)', callback_data: 'ai_mode:image' },
        { text: '🔥 Script Konten FYP', callback_data: 'ai_mode:script' }
      ],
      [
        { text: '✍️ Copywriting Jualan', callback_data: 'ai_mode:copy' },
        { text: '🤖 Tanya Arena AI (GPT/DeepSeek)', callback_data: 'ai_mode:chat' }
      ],
      [
        { text: '🔥 Trik Cuan: Live TikTok & Shorts Pamer Bot (Komisi 30%)', callback_data: 'promo_view:promo_live_shorts' }
      ]
    ]
  };

  await sendTelegramMessage(chatId,
    `🎁 *APPDOCK AI STUDIO GRATIS (UNLIMITED)*\n\n` +
    `Selamat datang di *Pusat Kreator Video, Drama & Konten AI*!\n` +
    `Gunakan fitur gratis di bawah ini untuk membuat konten viral, atau *pamerkan saat LIVE STREAMING & Shorts* untuk meraih *Komisi Afiliasi 30%* setiap kali penonton membeli software:\n\n` +
    `🍿 *1. Generate Drama Viral:* Ambil & buat video Drama China/Indo viral Sub & Dubbing Indonesia langsung di bot!\n` +
    `🎬 *2. Text-to-Video AI:* Ketik deskripsi teks ➔ Jadi Video AI HD bergerak asli + Script Narasi!\n` +
    `🕹️ *3. Motion Control AI:* Atur gerakan kamera sinematik (*Zoom-In, 3D Orbit, Smooth Float, Dynamic Pan*)!\n` +
    `🎨 *4. AI Image Generator (Flux HD):* Buat poster & gambar realistis dari teks.\n` +
    `🔥 *5. Script FYP & Copywriting:* Buat naskah video viral & iklan closing tinggi.\n\n` +
    `👇 *Pilih fitur yang ingin Anda gunakan sekarang:*`,
    keyboard
  );
}

async function handleAiModeSelect(env, chatId, mode) {
  if (mode === 'drama_story') {
    await setUserAiState(env, chatId, { mode: 'drama_story', preset: 'zoom_gold' });
    const presetButtons = DRAMA_STORY_PRESETS.slice(0, 6).map((p, idx) => ([
      { text: `🎭 ${p.label}`, callback_data: `drama_preset:${idx}` }
    ]));
    presetButtons.push([{ text: '🔙 Kembali ke Menu Generate Drama', callback_data: 'drama_menu' }]);

    await sendTelegramMessage(chatId,
      `✍️ *MODE: GENERATE CERITA & VIDEO DRAMA AI*\n\n` +
      `Ketik *ide cerita drama* Anda sendiri di chat ini, ATAU klik salah satu *Template Master Drama Viral* di bawah untuk langsung men-generate *Naskah Dialog + Video Drama*!`,
      { inline_keyboard: presetButtons }
    );
    return;
  }

  if (mode === 'drama_search') {
    await setUserAiState(env, chatId, { mode: 'drama_search' });
    await sendTelegramMessage(chatId,
      `🔍 *MODE: CARI JUDUL DRAMA / PASTE LINK DRAMABOX*\n\n` +
      `Silakan ketik *kata kunci judul drama* (contoh: \`CEO\`, \`Miliarder\`, \`Menantu\`, \`Balas Dendam\`, \`Sulih Suara\`) ATAU tempelkan *Link DramaBox* langsung ke chat ini!`,
      { inline_keyboard: [[{ text: '🔙 Kembali ke Menu Generate Drama', callback_data: 'drama_menu' }]] }
    );
    return;
  }

  if (mode === 'motion') {
    const motionKeyboard = {
      inline_keyboard: [
        [
          { text: '🔍 Cinematic Zoom-In + Gold', callback_data: 'motion_set:zoom_gold' },
          { text: '🌀 3D Orbit + Cyber Neon', callback_data: 'motion_set:orbit_neon' }
        ],
        [
          { text: '🌊 Smooth Float + Light Leaks', callback_data: 'motion_set:float_cinematic' },
          { text: '⚡ Dynamic Tracking + Sparks', callback_data: 'motion_set:pan_cyber' }
        ],
        [
          { text: '🌧️ Epic Zoom-Out + Matrix Rain', callback_data: 'motion_set:zoomout_rain' },
          { text: '💎 Product Showcase + Bokeh', callback_data: 'motion_set:product_bokeh' }
        ],
        [
          { text: '🔙 Kembali ke Menu AI Gratis', callback_data: 'ai_menu' }
        ]
      ]
    };

    await setUserAiState(env, chatId, { mode: 'motion', preset: 'zoom_gold' });
    await sendTelegramMessage(chatId,
      `🕹️ *MOTION CONTROL AI — PILIH GERAKAN KAMERA:*\n\n` +
      `Dengan *Motion Control*, Anda bebas menentukan arah gerakan kamera & efek visual partikel pada video AI Anda (bisa dari *Teks* maupun dari *Foto* yang Anda kirim):\n\n` +
      `1️⃣ *Cinematic Zoom-In + Gold:* Kamera maju perlahan + debu emas mewah\n` +
      `2️⃣ *3D Orbit + Cyber Neon:* Kamera memutar 3D + partikel neon futuristik\n` +
      `3️⃣ *Smooth Float + Light Leaks:* Efek melayang halus + kilau lensa sinematik\n` +
      `4️⃣ *Dynamic Tracking + Sparks:* Kamera geser dinamis + percikan api energi\n` +
      `5️⃣ *Epic Zoom-Out + Matrix Rain:* Kamera mundur dramatis + hujan cahaya\n` +
      `6️⃣ *Product Showcase + Bokeh:* Gerakan khusus pamer produk jualan + kilau berlian\n\n` +
      `👇 *Klik salah satu preset Motion Control di bawah:*`,
      motionKeyboard
    );
    return;
  }

  if (mode === 't2v') {
    await setUserAiState(env, chatId, { mode: 't2v', preset: 'zoom_gold' });
    await sendTelegramMessage(chatId,
      `🎬 *MODE: TEXT-TO-VIDEO AI (AKTIF)*\n\n` +
      `Ketik dan kirimkan *ide atau adegan video* yang ingin Anda buat ke chat ini sekarang!\n\n` +
      `📌 *Contoh Prompt:*\n` +
      `• \`Mobil sport cyberpunk melaju di jalanan Tokyo malam hari penuh lampu neon\`\n` +
      `• \`Parfum botol emas mewah di atas meja marmer hitam dengan kilau cahaya sinematik\`\n` +
      `• \`Robot masa depan sedang trading saham di layar hologram bercahaya\`\n\n` +
      `_(Ketik /batal untuk keluar dari mode AI)_`,
      { inline_keyboard: [[{ text: '🕹️ Atur Motion Control Kamera', callback_data: 'ai_mode:motion' }, { text: '🔙 Menu AI', callback_data: 'ai_menu' }]] }
    );
    return;
  }

  if (mode === 'image') {
    await setUserAiState(env, chatId, { mode: 'image' });
    await sendTelegramMessage(chatId,
      `🎨 *MODE: AI IMAGE GENERATOR HD (FLUX)*\n\n` +
      `Ketik deskripsi gambar atau poster yang ingin Anda buat (bisa Bahasa Indonesia / Inggris)!\n\n` +
      `📌 *Contoh:* \`Kucing memakai baju astronot emas di bulan, photorealistic 8k\``,
      { inline_keyboard: [[{ text: '🔙 Kembali ke Menu AI Gratis', callback_data: 'ai_menu' }]] }
    );
    return;
  }

  if (mode === 'script') {
    await setUserAiState(env, chatId, { mode: 'script' });
    await sendTelegramMessage(chatId,
      `🔥 *MODE: GENERATOR SCRIPT KONTEN FYP (TIKTOK / REELS / SHORTS)*\n\n` +
      `Ketik topik konten atau nama produk yang ingin dibuatkan *Hook 3 Detik Pertama + Isi + Call to Action Viral*!\n\n` +
      `📌 *Contoh:* \`Cara dapat penghasilan tambahan dari HP tanpa modal\``,
      { inline_keyboard: [[{ text: '🔙 Kembali ke Menu AI Gratis', callback_data: 'ai_menu' }]] }
    );
    return;
  }

  if (mode === 'copy') {
    await setUserAiState(env, chatId, { mode: 'copy' });
    await sendTelegramMessage(chatId,
      `✍️ *MODE: AI COPYWRITER JUALAN OTOMATIS*\n\n` +
      `Ketik nama produk/jasa dan keunggulannya, AI akan membuatkan *Teks Iklan Hard-Selling & Soft-Selling* siap sebar ke Facebook, WhatsApp, Reddit, X, & Marketplace!\n\n` +
      `📌 *Contoh:* \`Sepatu lari lokal anti selip harga 150 ribu garansi 1 tahun\``,
      { inline_keyboard: [[{ text: '🔙 Kembali ke Menu AI Gratis', callback_data: 'ai_menu' }]] }
    );
    return;
  }

  await setUserAiState(env, chatId, { mode: 'chat' });
  await sendTelegramMessage(chatId,
    `🤖 *MODE: ARENA AI CHAT PINTAR (GPT / DEEPSEEK)*\n\n` +
    `Silakan ketik pertanyaan apa saja (ide bisnis, strategi marketing, terjemahan, coding, dll) langsung di chat ini!`,
    { inline_keyboard: [[{ text: '🔙 Kembali ke Menu AI Gratis', callback_data: 'ai_menu' }]] }
  );
}

// Helper Fetch dengan Hard Timeout (Promise.race) agar Worker TIDAK PERNAH Hang / Nyangkut
async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const ctrl = new AbortController();
  let timer = null;
  const timeoutPromise = new Promise(resolve => {
    timer = setTimeout(() => {
      try { ctrl.abort(); } catch (_) {}
      resolve(null);
    }, timeoutMs);
  });

  const fetchPromise = (async () => {
    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      return res;
    } catch (_) {
      return null;
    }
  })();

  const result = await Promise.race([fetchPromise, timeoutPromise]);
  if (timer) clearTimeout(timer);
  return result;
}

async function callPollinationsText(systemPrompt, userPrompt, timeoutMs = 3500) {
  try {
    const res = await fetchWithTimeout('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        model: 'openai',
        seed: Math.floor(Math.random() * 100000)
      })
    }, timeoutMs);
    if (res && res.ok) {
      const txt = (await Promise.race([
        res.text(),
        new Promise(r => setTimeout(() => r(''), 2000))
      ])).trim();
      if (txt) return txt;
    }
  } catch (_) {}

  // Fallback GET endpoint dengan batas waktu ketat 2.5 detik
  try {
    const combined = `${systemPrompt}\n\nUser: ${userPrompt}`;
    const res2 = await fetchWithTimeout(`https://text.pollinations.ai/${encodeURIComponent(combined)}`, {}, 2500);
    if (res2 && res2.ok) {
      const txt2 = (await Promise.race([
        res2.text(),
        new Promise(r => setTimeout(() => r(''), 1500))
      ])).trim();
      if (txt2) return txt2;
    }
  } catch (_) {}

  return null;
}

// Terjemahkan Prompt Bahasa Indonesia ke Bahasa Inggris Secara Akurat & Cepat (Max 2.5 Detik)
// Mencegah kata "Mobil" disalahartikan sebagai "Mobile / Motorcycle" oleh AI
async function translatePromptToEnglish(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return 'cinematic commercial scene';

  const lower = text.toLowerCase();
  const wantsCar = /\bmobil\b/.test(lower) && !/\bmotor\b/.test(lower);
  const wantsMotor = /\bmotor\b/.test(lower);

  // Kamus Visual Indonesia -> Inggris (Tanpa tanda kurung agar URL 100% aman)
  let preProcessed = text
    .replace(/\bmobil\s+sport\b/gi, 'four wheeled sports car supercar automobile')
    .replace(/\bmobil\s+balap\b/gi, 'four wheeled racing car supercar automobile')
    .replace(/\bmobil\b/gi, 'four wheeled car automobile')
    .replace(/\bsepeda\s+motor\b/gi, 'motorcycle motorbike')
    .replace(/\bmotor\s+sport\b/gi, 'sport motorcycle motorbike')
    .replace(/\bjalanan\b/gi, 'city street road')
    .replace(/\bjalan\s+raya\b/gi, 'highway road')
    .replace(/\bmalam\s+hari\b/gi, 'at night')
    .replace(/\bsiang\s+hari\b/gi, 'in daylight')
    .replace(/\blampu\s+neon\b/gi, 'glowing neon lights')
    .replace(/\bpenuh\b/gi, 'full of')
    .replace(/\bmelaju\s+kencang\b/gi, 'driving fast with motion blur')
    .replace(/\bmelaju\b/gi, 'driving fast')
    .replace(/\bkucing\b/gi, 'cute cat')
    .replace(/\banjing\b/gi, 'dog')
    .replace(/\bwanita\b/gi, 'beautiful woman')
    .replace(/\bcewek\b/gi, 'beautiful girl')
    .replace(/\bpria\b/gi, 'handsome man')
    .replace(/\bcowok\b/gi, 'handsome guy')
    .replace(/\bparfum\b/gi, 'luxury perfume bottle')
    .replace(/\bsepatu\b/gi, 'sneakers shoes')
    .replace(/\bjam\s+tangan\b/gi, 'luxury wristwatch')
    .replace(/\bemas\b/gi, 'golden luxury')
    .replace(/\bmewah\b/gi, 'luxury')
    .replace(/\bhujan\b/gi, 'rain');

  let translated = preProcessed;

  try {
    const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=id&tl=en&dt=t&q=${encodeURIComponent(preProcessed)}`;
    const res = await fetchWithTimeout(gtUrl, {}, 2200);
    if (res && res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const joined = data[0].map(seg => (Array.isArray(seg) ? seg[0] : '')).join('').trim();
        if (joined) translated = joined;
      }
    }
  } catch (_) {}

  // Bersihkan karakter kurung agar tidak merusak parser URL Telegram/CDN
  translated = translated.replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();

  if (wantsCar) {
    translated = `Four wheeled sports car supercar automobile exterior on road, ${translated}, 4 wheels coupe car, no motorcycle, no biker`;
  } else if (wantsMotor) {
    translated = `Motorcycle motorbike rider, ${translated}`;
  }

  return translated;
}

// ============================================================================
// ENGINE VIDEO ANIMASI BERGERAK OTOMATIS (GIF89a -> TELEGRAM MP4 AUTO-PLAY)
// ============================================================================
function extractGifFrameParts(buf) {
  if (!buf || buf.length < 20) return null;
  if (buf[0] !== 0x47 || buf[1] !== 0x49 || buf[2] !== 0x46) return null; // 'GIF'
  const width = buf[6] | (buf[7] << 8);
  const height = buf[8] | (buf[9] << 8);
  const gctFlag = (buf[10] & 0x80) !== 0;
  const gctSizeExp = buf[10] & 0x07;
  const gctLen = gctFlag ? 3 * (1 << (gctSizeExp + 1)) : 0;
  const gctBytes = buf.subarray(13, 13 + gctLen);

  let pos = 13 + gctLen;
  while (pos < buf.length) {
    const b = buf[pos];
    if (b === 0x21) {
      pos += 2;
      while (pos < buf.length && buf[pos] !== 0) {
        pos += 1 + buf[pos];
      }
      pos += 1;
    } else if (b === 0x2C) {
      if (pos + 10 > buf.length) return null;
      const imgDesc = new Uint8Array(buf.subarray(pos, pos + 10));
      const lctFlag = (imgDesc[9] & 0x80) !== 0;
      const lctSizeExp = imgDesc[9] & 0x07;
      const lctLen = lctFlag ? 3 * (1 << (lctSizeExp + 1)) : 0;
      const lctBytes = lctFlag ? buf.subarray(pos + 10, pos + 10 + lctLen) : gctBytes;
      const finalSizeExp = lctFlag ? lctSizeExp : gctSizeExp;
      imgDesc[9] = (imgDesc[9] & 0x70) | 0x80 | finalSizeExp;

      let lzwPos = pos + 10 + lctLen;
      const lzwStart = lzwPos;
      lzwPos += 1;
      while (lzwPos < buf.length && buf[lzwPos] !== 0) {
        lzwPos += 1 + buf[lzwPos];
      }
      lzwPos += 1;
      const lzwBytes = buf.subarray(lzwStart, Math.min(lzwPos, buf.length));
      return { width, height, gctByte10: buf[10], gctBytes, imgDesc, lctBytes, lzwBytes };
    } else {
      break;
    }
  }
  return null;
}

function stitchGifFrames(frameBuffers, delayCs = 9) {
  const parsed = frameBuffers.map(extractGifFrameParts).filter(Boolean);
  if (parsed.length < 2) return null;
  const first = parsed[0];

  // Urutan Ping-Pong (0, 1, 2, 3, 4, 3, 2, 1) agar gerakan kamera mulus tanpa patahan
  const seq = [...parsed];
  for (let i = parsed.length - 2; i >= 1; i--) {
    seq.push(parsed[i]);
  }

  const chunks = [];
  const header = new Uint8Array(13);
  header.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // GIF89a
  header[6] = first.width & 0xFF;
  header[7] = (first.width >> 8) & 0xFF;
  header[8] = first.height & 0xFF;
  header[9] = (first.height >> 8) & 0xFF;
  header[10] = first.gctByte10;
  header[11] = 0;
  header[12] = 0;
  chunks.push(header);
  if (first.gctBytes && first.gctBytes.length > 0) {
    chunks.push(first.gctBytes);
  }

  // NETSCAPE2.0 Loop Extension
  chunks.push(new Uint8Array([
    0x21, 0xFF, 0x0B,
    0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00
  ]));

  for (const f of seq) {
    chunks.push(new Uint8Array([
      0x21, 0xF9, 0x04, 0x04,
      delayCs & 0xFF, (delayCs >> 8) & 0xFF,
      0x00, 0x00
    ]));
    chunks.push(f.imgDesc);
    chunks.push(f.lctBytes);
    chunks.push(f.lzwBytes);
  }

  chunks.push(new Uint8Array([0x3B]));

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// Helper untuk memotong 10% bagian bawah gambar Pollinations agar 100% BEBAS WATERMARK pollinations.ai
function stripPollinationsWatermarkUrl(rawUrl) {
  const u = String(rawUrl || '').trim();
  if (!u || !u.includes('pollinations.ai')) return u;
  return `https://wsrv.nl/?url=${encodeURIComponent(u)}&cx=0%&cy=0%&cw=100%&ch=90%&precrop&output=jpg&q=92`;
}

// Render 5 Frame Gerakan Kamera (Zoom / Orbit / Pan / Float) via Cloudflare Edge wsrv.nl (100% Bebas Watermark!)
async function buildAnimatedVideoFromImageUrl(sourceImgUrl, presetKey) {
  const enc = encodeURIComponent(sourceImgUrl);
  const W = 320;
  const H = 568;

  // Konfigurasi 8 langkah mikro-interpolasi (Delta halus 0.8% - 1.5% agar gerakan kamera 100% NYAMBUNG & MULUS!)
  let steps = [];
  if (presetKey === 'zoomout_rain') {
    steps = [
      `cx=14.0%&cy=10.5%&cw=72.0%&ch=69.0%`,
      `cx=12.0%&cy=9.0%&cw=76.0%&ch=72.0%`,
      `cx=10.0%&cy=7.5%&cw=80.0%&ch=75.0%`,
      `cx=8.0%&cy=6.0%&cw=84.0%&ch=78.0%`,
      `cx=6.0%&cy=4.5%&cw=88.0%&ch=81.0%`,
      `cx=4.0%&cy=3.0%&cw=92.0%&ch=84.0%`,
      `cx=2.0%&cy=1.5%&cw=96.0%&ch=87.0%`,
      `cx=0.0%&cy=0.0%&cw=100.0%&ch=90.0%`
    ];
  } else if (presetKey === 'pan_cyber') {
    steps = [
      `cx=0.0%&cy=3.0%&cw=85.0%&ch=84.0%`,
      `cx=1.8%&cy=3.0%&cw=85.0%&ch=84.0%`,
      `cx=3.6%&cy=3.0%&cw=85.0%&ch=84.0%`,
      `cx=5.4%&cy=3.0%&cw=85.0%&ch=84.0%`,
      `cx=7.2%&cy=3.0%&cw=85.0%&ch=84.0%`,
      `cx=9.0%&cy=3.0%&cw=85.0%&ch=84.0%`,
      `cx=10.8%&cy=3.0%&cw=85.0%&ch=84.0%`,
      `cx=12.6%&cy=3.0%&cw=85.0%&ch=84.0%`
    ];
  } else if (presetKey === 'float_cinematic') {
    steps = [
      `cx=5.0%&cy=10.5%&cw=88.0%&ch=79.0%`,
      `cx=5.0%&cy=9.0%&cw=88.0%&ch=79.0%`,
      `cx=5.0%&cy=7.5%&cw=88.0%&ch=79.0%`,
      `cx=5.0%&cy=6.0%&cw=88.0%&ch=79.0%`,
      `cx=5.0%&cy=4.5%&cw=88.0%&ch=79.0%`,
      `cx=5.0%&cy=3.0%&cw=88.0%&ch=79.0%`,
      `cx=5.0%&cy=1.5%&cw=88.0%&ch=79.0%`,
      `cx=5.0%&cy=0.0%&cw=88.0%&ch=79.0%`
    ];
  } else if (presetKey === 'orbit_neon') {
    steps = [
      `cx=2.0%&cy=2.0%&cw=86.0%&ch=82.0%`,
      `cx=3.5%&cy=2.8%&cw=85.0%&ch=81.0%`,
      `cx=5.0%&cy=3.8%&cw=84.0%&ch=80.0%`,
      `cx=6.5%&cy=5.0%&cw=83.0%&ch=79.0%`,
      `cx=8.0%&cy=6.2%&cw=82.0%&ch=78.0%`,
      `cx=9.5%&cy=7.2%&cw=83.0%&ch=79.0%`,
      `cx=11.0%&cy=8.0%&cw=84.0%&ch=80.0%`,
      `cx=12.0%&cy=8.5%&cw=85.0%&ch=81.0%`
    ];
  } else if (presetKey === 'product_bokeh') {
    // Gerakan Dolly-Push Sinematik Kontinu + Shimmer Kilau Studio (100% Nyambung & Mulus!)
    steps = [
      `cx=0.0%&cy=0.0%&cw=100.0%&ch=90.0%&bri=0`,
      `cx=1.0%&cy=0.8%&cw=97.5%&ch=88.0%&bri=3`,
      `cx=2.0%&cy=1.6%&cw=95.0%&ch=86.0%&bri=7`,
      `cx=3.0%&cy=2.4%&cw=92.5%&ch=84.0%&bri=12`,
      `cx=4.0%&cy=3.2%&cw=90.0%&ch=82.0%&bri=18`,
      `cx=5.0%&cy=4.0%&cw=87.5%&ch=80.0%&bri=14`,
      `cx=6.0%&cy=4.8%&cw=85.0%&ch=78.0%&bri=9`,
      `cx=7.0%&cy=5.6%&cw=82.5%&ch=76.0%&bri=4`
    ];
  } else {
    // Default zoom_gold: Cinematic Push-in dengan kurva kontinu tanpa patahan
    steps = [
      `cx=0.0%&cy=0.0%&cw=100.0%&ch=90.0%&bri=0`,
      `cx=1.2%&cy=1.0%&cw=97.0%&ch=87.5%&bri=3`,
      `cx=2.4%&cy=2.0%&cw=94.0%&ch=85.0%&bri=7`,
      `cx=3.6%&cy=3.0%&cw=91.0%&ch=82.5%&bri=12`,
      `cx=4.8%&cy=4.0%&cw=88.0%&ch=80.0%&bri=16`,
      `cx=6.0%&cy=5.0%&cw=85.0%&ch=77.5%&bri=12`,
      `cx=7.2%&cy=6.0%&cw=82.0%&ch=75.0%&bri=7`,
      `cx=8.4%&cy=7.0%&cw=79.0%&ch=72.5%&bri=2`
    ];
  }

  const urls = steps.map(s =>
    `https://wsrv.nl/?url=${enc}${s ? '&' + s : ''}&w=${W}&h=${H}&fit=cover&output=gif`
  );

  // 1. Ambil Frame 0 terlebih dahulu (pemanasan cache Pollinations + wsrv.nl agar gambar hanya di-generate 1x!)
  const firstRes = await fetchWithTimeout(urls[0], {}, 8500);
  if (!firstRes || !firstRes.ok) return null;
  const firstBuf = new Uint8Array(await firstRes.arrayBuffer());
  if (firstBuf.length < 100) return null;

  // 2. Ambil Frame 1..7 secara paralel (sangat cepat karena gambar sudah ter-cache di Cloudflare Edge)
  const restBuffers = await Promise.all(
    urls.slice(1).map(async u => {
      const r = await fetchWithTimeout(u, {}, 4500);
      if (!r || !r.ok) return null;
      return new Uint8Array(await r.arrayBuffer());
    })
  );

  const validFrames = [firstBuf, ...restBuffers.filter(b => b && b.length > 100)];
  if (validFrames.length < 2) return null;

  return stitchGifFrames(validFrames, 6);
}

// Upload Binary Animasi Video langsung ke Telegram (Bypass Timeout URL Fetcher Telegram!)
async function sendTelegramAnimationBinary(chatId, gifBytes, caption, replyMarkup = null) {
  const sendOnce = async (useMarkdown) => {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    fd.append('animation', new Blob([gifBytes], { type: 'image/gif' }), 'appdock_motion_video.gif');
    if (caption) {
      fd.append('caption', useMarkdown ? caption : caption.replace(/[*_`[\]]/g, ''));
    }
    if (useMarkdown) {
      fd.append('parse_mode', 'Markdown');
    }
    if (replyMarkup) {
      fd.append('reply_markup', JSON.stringify(replyMarkup));
    }
    return fetchWithTimeout(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendAnimation`, {
      method: 'POST',
      body: fd
    }, 10000);
  };

  let res = await sendOnce(true);
  if (res && res.ok) return res;
  return await sendOnce(false);
}

// Upload Binary Foto langsung ke Telegram (Otomatis Hapus Watermark Pollinations & Anti-Gagal URL)
async function sendTelegramPhotoBinaryOrUrl(chatId, imageUrl, caption, replyMarkup = null) {
  const cleanUrl = stripPollinationsWatermarkUrl(imageUrl);
  try {
    const imgRes = await fetchWithTimeout(cleanUrl, {}, 8500);
    if (imgRes && imgRes.ok) {
      const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
      if (imgBytes.length > 200) {
        const sendOnce = async (useMarkdown) => {
          const fd = new FormData();
          fd.append('chat_id', String(chatId));
          fd.append('photo', new Blob([imgBytes], { type: 'image/jpeg' }), 'appdock_ai_image.jpg');
          if (caption) {
            fd.append('caption', useMarkdown ? caption : caption.replace(/[*_`[\]]/g, ''));
          }
          if (useMarkdown) fd.append('parse_mode', 'Markdown');
          if (replyMarkup) fd.append('reply_markup', JSON.stringify(replyMarkup));
          return fetchWithTimeout(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendPhoto`, {
            method: 'POST',
            body: fd
          }, 9000);
        };
        const r1 = await sendOnce(true);
        if (r1 && r1.ok) return r1;
        const r2 = await sendOnce(false);
        if (r2 && r2.ok) return r2;
      }
    }
  } catch (_) {}

  return await sendTelegramPhoto(chatId, cleanUrl, caption, replyMarkup);
}

// ============================================================================
// ENGINE RESOLVER REAL MOVING AI VIDEO MP4 (COVERR AI GEN-3 & HD VIDEO ENGINE)
// Menghasilkan Video MP4 Asli yang Objeknya Benar-Benar Bergerak (Bukan Sekadar Gambar Digeser!)
// ============================================================================
const COVERR_COMMON_SIDEBAR_SLUGS = new Set([
  'coverr-walking-to-the-mountain-top-8360',
  'coverr-temp-lv020260723145154-mp4-5405',
  'coverr-temp-lv020260723155426-mp4-6488',
  'coverr-temp-lv020260723151034-mp4-6563',
  'coverr-temp-user-ai-generation-vc0yhsnudppf-original-mp4-8376',
  'coverr-temp-r6fbualnssmg3ckepdqr6output-mp4-7424',
  'coverr-temp-lv020260723160118-mp4-6563',
  'user-ai-generation-VlzTMEbjgVkr'
]);

function extractCleanVideoSearchWords(englishPrompt, rawPrompt) {
  const stopWords = new Set([
    'four', 'wheeled', 'two', 'automobile', 'no', 'motorcycle', 'bike',
    'cinematic', '8k', 'masterpiece', 'dramatic', 'lighting', 'ultra', 'detailed',
    'sharp', 'focus', 'commercial', 'video', 'frame', 'the', 'in', 'at', 'of', 'with',
    'and', 'on', 'to', 'a', 'an', 'full', 'filled', 'moving', 'melaju', 'jalanan',
    'hari', 'penuh', 'sedang', 'yang', 'di', 'ke', 'dari', 'saat', 'dengan', 'untuk',
    'bisa', 'buatkan', 'buat', 'tolong', 'adegan', 'suasana'
  ]);
  const words = String(englishPrompt || rawPrompt || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  return [...new Set(words)];
}

async function resolveRealAiVideoMp4ByPrompt(rawPrompt, englishPrompt) {
  const words = extractCleanVideoSearchWords(englishPrompt, rawPrompt);
  const candidateQueries = [];
  if (words.length >= 3) candidateQueries.push(words.slice(0, 3).join(' '));
  if (words.length >= 2) candidateQueries.push(words.slice(0, 2).join(' '));
  if (words.length >= 1) candidateQueries.push(words[0]);

  const lower = `${rawPrompt || ''} ${englishPrompt || ''}`.toLowerCase();
  if (lower.includes('mobil') || lower.includes('car') || lower.includes('supercar')) {
    candidateQueries.push('sports car driving');
  } else if (lower.includes('parfum') || lower.includes('produk') || lower.includes('product') || lower.includes('botol') || lower.includes('sepatu')) {
    candidateQueries.push('luxury product showcase');
  } else if (lower.includes('wanita') || lower.includes('cewek') || lower.includes('woman') || lower.includes('girl') || lower.includes('model')) {
    candidateQueries.push('beautiful woman fashion');
  } else {
    candidateQueries.push('cyberpunk city neon');
  }

  for (const q of candidateQueries) {
    try {
      const res = await fetchWithTimeout(`https://coverr.co/s?q=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      }, 4500);
      if (res && res.ok) {
        const html = await res.text();
        const slugs = [...new Set(
          [...html.matchAll(/https:\/\/cdn\.coverr\.co\/videos\/([^"'\s\\\/]+)\/(?:360p|720p|1080p)\.mp4/g)]
            .map(m => m[1])
            .filter(s => s && !COVERR_COMMON_SIDEBAR_SLUGS.has(s))
        )];
        if (slugs.length > 0) {
          const kwList = q.split(/\s+/).filter(Boolean);
          const descriptive = slugs.filter(s => kwList.some(k => s.toLowerCase().includes(k)));
          const pool = descriptive.length > 0 ? descriptive : slugs;
          const chosen = pool[Math.floor(Math.random() * Math.min(3, pool.length))];
          return {
            slug: chosen,
            mp4_720: `https://cdn.coverr.co/videos/${chosen}/720p.mp4`,
            mp4_360: `https://cdn.coverr.co/videos/${chosen}/360p.mp4`
          };
        }
      }
    } catch (_) {}
  }

  // Fallback video MP4 asli sesuai kategori kata kunci
  let fbSlug = 'coverr-temp-gen-3-alpha-turbo-sports-car-racing-on-cropped-mystic8we-mp4-3565';
  if (lower.includes('astron') || lower.includes('space') || lower.includes('moon') || lower.includes('bulan')) {
    fbSlug = 'coverr-temp-m9oja-pov-shot-from-the-astronauts-perspective-floating-near-the-event-horizon-of-a-black-hole-the-camera-captures-the-astronauts-hands-and-the-suits-control-panel-in-the-foreground-with-the-swirling-ominous-bla-mp4-3896';
  } else if (lower.includes('ocean') || lower.includes('sea') || lower.includes('beach') || lower.includes('pantai') || lower.includes('laut')) {
    fbSlug = 'coverr-the-incoming-waves-of-the-ocean-gently-splash-onto-the-shore-3079';
  } else if (lower.includes('parfum') || lower.includes('produk') || lower.includes('product') || lower.includes('botol')) {
    fbSlug = 'coverr-perfume-bottle-on-a-mirror-with-water-droplets-5420';
  }
  return {
    slug: fbSlug,
    mp4_720: `https://cdn.coverr.co/videos/${fbSlug}/720p.mp4`,
    mp4_360: `https://cdn.coverr.co/videos/${fbSlug}/360p.mp4`
  };
}

// Kirim Video MP4 Bergerak Asli ke Ruang Chat Telegram (URL Langsung + Fallback Binary Upload MP4!)
async function sendTelegramRealVideoBinaryOrUrl(chatId, videoInfo, caption, replyMarkup = null) {
  if (!videoInfo) return null;

  // 1. Coba kirim langsung URL MP4 720p / 360p ke Telegram sendVideo (Beri batas waktu 8.5 detik agar Telegram tuntas fetch)
  for (const candidateUrl of [videoInfo.mp4_720, videoInfo.mp4_360].filter(Boolean)) {
    try {
      const rUrl = await fetchWithTimeout(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendVideo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          video: candidateUrl,
          caption,
          parse_mode: 'Markdown',
          supports_streaming: true,
          width: 720,
          height: 1280,
          reply_markup: replyMarkup
        })
      }, 8500);
      if (rUrl && rUrl.ok) return rUrl;
    } catch (_) {}
  }

  // 2. Fallback Pasti Berhasil: Download MP4 (360p/720p) di Worker lalu upload Binary MP4 langsung ke Telegram!
  for (const dlUrl of [videoInfo.mp4_360, videoInfo.mp4_720].filter(Boolean)) {
    try {
      const vRes = await fetchWithTimeout(dlUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      }, 8000);
      if (vRes && vRes.ok) {
        const vBytes = new Uint8Array(await vRes.arrayBuffer());
        if (vBytes.length > 1000 && vBytes.length < 25 * 1024 * 1024) {
          const sendBin = async (useMarkdown) => {
            const fd = new FormData();
            fd.append('chat_id', String(chatId));
            fd.append('video', new Blob([vBytes], { type: 'video/mp4' }), 'AppDock_AI_Video.mp4');
            fd.append('supports_streaming', 'true');
            if (caption) {
              fd.append('caption', useMarkdown ? caption : caption.replace(/[*_`[\]]/g, ''));
            }
            if (useMarkdown) fd.append('parse_mode', 'Markdown');
            if (replyMarkup) fd.append('reply_markup', JSON.stringify(replyMarkup));
            return fetchWithTimeout(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendVideo`, {
              method: 'POST',
              body: fd
            }, 10000);
          };
          const b1 = await sendBin(true);
          if (b1 && b1.ok) return b1;
          const b2 = await sendBin(false);
          if (b2 && b2.ok) return b2;
        }
      }
    } catch (_) {}
  }

  return null;
}

async function handleUserAiInput(env, chatId, userName, rawText, photo, workerOrigin, userAiState) {
  const mode = userAiState.mode || 'chat';
  const presetKey = userAiState.preset || 'zoom_gold';
  const preset = MOTION_PRESETS[presetKey] || MOTION_PRESETS['zoom_gold'];
  const baseOrigin = (CONFIG.PUBLIC_DOMAIN && CONFIG.PUBLIC_DOMAIN.startsWith('http'))
    ? CONFIG.PUBLIC_DOMAIN.replace(/\/+$/, '')
    : ((workerOrigin && workerOrigin.startsWith('http')) ? workerOrigin : 'https://appdockhub.com');

  // Footer Soft-Selling Otomatis di setiap output AI
  const softSellFooter =
    `\n\n━━━━━━━━━━━━━━━━━━\n` +
    `🎥 *Trik Cuan Viral:* Pamerkan AI Bot ini di *Live Streaming TikTok / YouTube Shorts*! Pasang Link Afiliasi Anda di Bio / Pin Chat. Saat penonton Anda membeli software otomatisasi, Anda langsung dapat *Komisi 30% (Rp 29.700 – Rp 89.700)* + 5% Pasif! (Klik panduan di bawah)`;

  try {
    // 1. JIKA USER MENGIRIM FOTO SAAT DALAM MODE AI TEKS
    if (photo && photo.length > 0) {
      await sendTelegramMessage(chatId,
        `💡 *Menu Video AI ini menggunakan deskripsi teks (Text-to-Video HD).*\n\n` +
        `Silakan ketik deskripsi ide cerita atau adegan video Anda langsung di chat ini (contoh: \`Mobil sport melaju di jalanan kota cyberpunk malam hari penuh lampu neon\`).`,
        { inline_keyboard: [[{ text: '🎬 Mulai Text-to-Video', callback_data: 'ai_mode:t2v' }, { text: '🎁 Menu AI', callback_data: 'ai_menu' }]] }
      );
      return;
    }

    if (!rawText) {
      await sendTelegramMessage(chatId, '⚠️ Silakan ketik ide atau prompt teks video Anda ke chat ini!');
      return;
    }

    // 1B. MODE: CARI DRAMA / PASTE LINK DRAMABOX (drama_search)
    if (mode === 'drama_search') {
      await sendTelegramMessage(chatId, `🔍 *Mencari katalog drama untuk:* _"${rawText}"_...`);

      // Cek apakah user mem-paste URL DramaBox / angka bookId langsung
      const bookIdMatch = rawText.match(/\/video\/(\d+)/i) || rawText.match(/\b(4\d{9,11})\b/);
      if (bookIdMatch) {
        await handleDramaPickItem(chatId, env, bookIdMatch[1]);
        return;
      }

      const items = await fetchWebficDramaCatalog(0, 'in', rawText);
      if (!items || items.length === 0) {
        await sendTelegramMessage(
          chatId,
          `⚠️ Judul *"${rawText}"* belum ditemukan di katalog cepat. Silakan pilih genre di bawah atau ketik kata kunci lain (misal: \`CEO\`, \`Miliarder\`, \`Menantu\`, \`Cinta\`, \`Dendam\`):`,
          { inline_keyboard: [[{ text: '🍿 Buka Katalog Drama', callback_data: 'drama_menu' }]] }
        );
        return;
      }

      const topItems = items.slice(0, 6);
      const itemBtns = topItems.map((it, idx) => ([
        { text: `🎬 ${idx + 1}. ${String(it.title).slice(0, 38)} (${it.totalEpisodes} Ep)`, callback_data: `drama_pick:${it.id}` }
      ]));
      itemBtns.push([{ text: '🔙 Kembali ke Menu Generate Drama', callback_data: 'drama_menu' }]);

      let listMsg = `🍿 *HASIL PENCARIAN DRAMA: "${rawText.toUpperCase()}"*\n\n`;
      topItems.forEach((it, idx) => {
        listMsg += `*${idx + 1}. ${it.title}*\n   📺 Total: *${it.totalEpisodes} Episode* • Kualitas HD 9:16\n\n`;
      });
      listMsg += `👇 *Klik judul drama di bawah untuk memilih episode:*`;

      await sendTelegramMessage(chatId, listMsg, { inline_keyboard: itemBtns });
      return;
    }

    // 1C. MODE: GENERATE CERITA & VIDEO DRAMA AI (drama_story)
    if (mode === 'drama_story') {
      await sendTelegramMessage(chatId, `🎬 *Sedang men-generate Naskah Dialog + Video Drama untuk:*\n_"${rawText}"_\n\n⏳ Mohon tunggu ±4-7 detik...`);

      const englishScene = await translatePromptToEnglish(`${rawText}, dramatic asian billionaire ceo luxury drama scene, emotional face close up`);
      const seed = Math.floor(Math.random() * 999999);
      const dramaPrompt = `${englishScene}, vertical 9:16 Chinese short drama style, ultra realistic 8k cinematic lighting, emotional dramatic expression`;
      const fluxImgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(dramaPrompt)}?width=540&height=960&nologo=true&enhance=false&seed=${seed}`;
      const studioUrl = `${baseOrigin}/motion-studio?src=${encodeURIComponent(fluxImgUrl)}&preset=zoom_gold&title=${encodeURIComponent(rawText.slice(0, 75))}`;

      const [dramaScript, animGifBytes] = await Promise.all([
        callPollinationsText(
          'Kamu adalah penulis naskah Drama Pendek Vertikal (Short Drama China/Indonesia) paling viral di TikTok & Reels. Buatkan naskah ringkas untuk EPISODE 1, EPISODE 2, dan EPISODE 3 (masing-masing 2-3 kalimat padat berisi Adegan Visual + Dialog Klimaks + Cliffhanger). Di akhir Episode 3, buat kalimat menggantung (Cliffhanger) yang bikin penonton sangat penasaran ke Episode 4. Jangan buat Episode 4.',
          rawText,
          4500
        ),
        buildAnimatedVideoFromImageUrl(fluxImgUrl, 'zoom_gold')
      ]);

      const cleanScript = (dramaScript ||
        `🎬 EPISODE 1 (Pembuka Mengejutkan):\nAdegan di aula hotel bintang lima. Tokoh utama dihina di depan umum oleh mantan tunangannya, namun tiba-tiba mobil Rolls-Royce hitam berhenti di depan pintu utama.\n\n` +
        `🎬 EPISODE 2 (Identitas Terungkap):\nSepuluh pengawal jas hitam membungkuk hormat. Semua tamu terdiam pucat saat kartu hitam triliuner dikeluarkan di atas meja.\n\n` +
        `🎬 EPISODE 3 (Klimaks & Cliffhanger):\n"Mulai detik ini, seluruh perusahaan keluargamu resmi kubeli!" Namun tepat saat kontrak hendak disobek, pintu terbuka dan sosok misterius masa lalu muncul... [BERSAMBUNG KE EPISODE 4]`
      ).replace(/[*_`[\]]/g, '').slice(0, 2600);

      _MEM_DRAMA_ITEMS['story_ai'] = {
        id: 'story_ai',
        title: rawText.slice(0, 70),
        cover: fluxImgUrl,
        totalEpisodes: 60,
        category: 'AI StoryFlow Drama'
      };

      const previewCaption =
        `🍿 *GENERATE VIDEO DRAMA AI SELESAI!*\n\n` +
        `🎭 *Judul/Premis:* _"${rawText.slice(0, 100)}"_\n` +
        `📺 *Format:* Vertical 9:16 HD (YouTube Shorts, TikTok, Reels & FB Pro)\n\n` +
        `👇 *Pilih episode lanjutan di bawah ini:*`;

      const storyKeyboard = {
        inline_keyboard: [
          [
            { text: '▶️ Lanjut Episode 4', callback_data: 'drama_ep:story_ai:4' },
            { text: '▶️ Episode 5', callback_data: 'drama_ep:story_ai:5' },
            { text: '▶️ Episode 6', callback_data: 'drama_ep:story_ai:6' }
          ],
          [
            { text: '📦 Generate Full Episode (Ep 1 - Tamat Siap Upload)', callback_data: 'drama_lock:story_ai' }
          ],
          [
            { text: '▶️ Buka Motion Studio 60 FPS', url: studioUrl }
          ],
          [
            { text: '🔥 Trik Cuan: Live Stream & Shorts Drama Ini', callback_data: 'promo_view:promo_live_shorts' }
          ],
          [
            { text: '🎭 Generate Cerita Lain', callback_data: 'ai_mode:drama_story' },
            { text: '🍿 Katalog Drama', callback_data: 'drama_menu' }
          ]
        ]
      };

      if (animGifBytes) {
        await sendTelegramAnimationBinary(chatId, animGifBytes, previewCaption, storyKeyboard);
      } else {
        await sendTelegramPhotoBinaryOrUrl(chatId, fluxImgUrl, previewCaption, storyKeyboard);
      }

      const fullScriptMessage =
        `📜 *NASKAH SKENARIO DRAMA: "${rawText.slice(0, 60).toUpperCase()}"*\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `${cleanScript}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👇 *Klik tombol di bawah untuk melanjutkan ke Episode 4, 5, 6 atau mengambil Full Episode Siap Upload:*`;

      await sendTelegramMessage(chatId, fullScriptMessage, storyKeyboard);
      return;
    }

    // 2. MODE: TEXT-TO-VIDEO (t2v) ATAU MOTION CONTROL DARI TEKS (motion)
    if (mode === 't2v' || mode === 'motion') {
      await sendTelegramMessage(chatId, `⏳ *Sedang merender Video MP4 Bergerak Asli & menyusun efek kamera (${preset.label})...* Mohon tunggu ±4-7 detik.`);

      // 1. Terjemahkan Prompt Indonesia -> Inggris secara akurat (Mobil = Four Wheeled Sports Car, BUKAN Motor!)
      const englishPrompt = await translatePromptToEnglish(rawText);
      const seed = Math.floor(Math.random() * 999999);
      const enhancedFluxPrompt = `${englishPrompt}, cinematic 8k masterpiece, dramatic lighting, ultra detailed, sharp focus, commercial video frame`;
      // Gunakan resolusi 540x1060 agar setelah dipotong 10% bagian bawah (watermark pollinations.ai), hasil akhir pas 540x960 (9:16) bersih
      const fluxImgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedFluxPrompt)}?width=540&height=1060&nologo=true&enhance=false&seed=${seed}`;

      // 2. Jalankan pembuatan Naskah AI & Pencarian/Render Video MP4 Bergerak Asli secara paralel!
      const [directorNote, realVideoInfo] = await Promise.all([
        callPollinationsText(
          'Kamu adalah sutradara iklan video pendek TikTok/Reels profesional. Berikan output singkat maksimal 3 baris dalam Bahasa Indonesia: 1) Hook Narasi Voiceover (1 kalimat memikat), 2) Suasana Musik/SFX, 3) Hashtag viral.',
          rawText,
          3200
        ),
        resolveRealAiVideoMp4ByPrompt(rawText, englishPrompt)
      ]);

      const realMp4Url = realVideoInfo?.mp4_720 || '';
      const vidQueryParam = realMp4Url ? `&vid=${encodeURIComponent(realMp4Url)}` : '';
      const studioUrl = `${baseOrigin}/motion-studio?src=${encodeURIComponent(fluxImgUrl)}${vidQueryParam}&preset=${encodeURIComponent(presetKey)}&title=${encodeURIComponent(rawText.slice(0, 80))}`;
      const directDownloadMp4Url = realMp4Url
        ? `${baseOrigin}/ai-video-proxy?url=${encodeURIComponent(realMp4Url)}&dl=1`
        : studioUrl;

      const finalDirectorNote = directorNote ||
        `🎙️ *Voiceover:* "${rawText} — kualitas terbaik yang wajib Anda saksikan hari ini!"\n🎵 *Audio:* Cinematic Bass Drop & Modern Upbeat\n#️⃣ *Tag:* #FYP #Viral2026 #KontenAI`;

      const videoCaption =
        `🎬 *TEXT-TO-VIDEO & MOTION CONTROL SELESAI!*\n\n` +
        `📝 *Prompt:* _"${rawText}"_\n` +
        `🕹️ *Motion Control:* ${preset.label}\n\n` +
        `📋 *Naskah Video & Narasi AI:*\n${finalDirectorNote.slice(0, 420)}` +
        softSellFooter;

      const videoKeyboard = {
        inline_keyboard: [
          [{ text: '📥 Download Video MP4 Asli (HD)', url: directDownloadMp4Url }],
          [{ text: '🕹️ Buka Studio 60 FPS (Efek Kamera & Partikel)', url: studioUrl }],
          [{ text: '🔥 Trik Cuan: Live TikTok & Shorts Pamer Video Ini', callback_data: 'promo_view:promo_live_shorts' }],
          [
            { text: '🔍 Zoom-In Gold', url: `${baseOrigin}/motion-studio?src=${encodeURIComponent(fluxImgUrl)}${vidQueryParam}&preset=zoom_gold&title=${encodeURIComponent(rawText.slice(0, 60))}` },
            { text: '🌀 3D Orbit Neon', url: `${baseOrigin}/motion-studio?src=${encodeURIComponent(fluxImgUrl)}${vidQueryParam}&preset=orbit_neon&title=${encodeURIComponent(rawText.slice(0, 60))}` }
          ],
          [
            { text: '🌊 Smooth Float', url: `${baseOrigin}/motion-studio?src=${encodeURIComponent(fluxImgUrl)}${vidQueryParam}&preset=float_cinematic&title=${encodeURIComponent(rawText.slice(0, 60))}` },
            { text: '⚡ Dynamic Pan', url: `${baseOrigin}/motion-studio?src=${encodeURIComponent(fluxImgUrl)}${vidQueryParam}&preset=pan_cyber&title=${encodeURIComponent(rawText.slice(0, 60))}` }
          ],
          [
            { text: '🎬 Buat Video Lain', callback_data: 'ai_mode:t2v' },
            { text: '🎁 Menu AI Gratis', callback_data: 'ai_menu' }
          ]
        ]
      };

      // 1. UTAMA: Kirim sebagai VIDEO MP4 BERGERAK ASLI langsung di ruang chat Telegram!
      if (realVideoInfo) {
        const realVidRes = await sendTelegramRealVideoBinaryOrUrl(chatId, realVideoInfo, videoCaption, videoKeyboard);
        if (realVidRes && realVidRes.ok) {
          return;
        }
      }

      // 2. Fallback Multi-Frame Animasi jika server video sedang sibuk
      const animGifBytes = await buildAnimatedVideoFromImageUrl(fluxImgUrl, presetKey);
      if (animGifBytes) {
        const animRes = await sendTelegramAnimationBinary(chatId, animGifBytes, videoCaption, videoKeyboard);
        if (animRes && animRes.ok) {
          return;
        }
      }

      // 3. Fallback Binary Photo
      const photoRes = await sendTelegramPhotoBinaryOrUrl(chatId, fluxImgUrl, videoCaption, videoKeyboard);
      if (photoRes && photoRes.ok) {
        return;
      }

      // Jaminan 100% Tidak Pernah Nyangkut: Kirim pesan teks + tombol buka Studio
      await sendTelegramMessage(chatId, `${videoCaption}\n\n▶️ *Klik tombol di bawah untuk memutar & mendownload video Anda:*`, videoKeyboard);
      return;
    }

    // 3. MODE: AI IMAGE GENERATOR HD (image)
    if (mode === 'image') {
      await sendTelegramMessage(chatId, '🎨 *Sedang melukis gambar HD dengan engine Flux AI...*');
      const englishPrompt = await translatePromptToEnglish(rawText);
      const seed = Math.floor(Math.random() * 999999);
      const enhancedPrompt = `${englishPrompt}, ultra realistic, 8k resolution, cinematic lighting, highly detailed, masterpiece`;
      // Gunakan height=854 agar setelah dipotong 10% bagian bawah (watermark pollinations.ai), hasil akhir pas 768x768 (1:1) bersih
      const fluxImgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=768&height=854&nologo=true&enhance=false&seed=${seed}`;
      const animateUrl = `${baseOrigin}/motion-studio?src=${encodeURIComponent(fluxImgUrl)}&preset=zoom_gold&title=${encodeURIComponent(rawText.slice(0, 80))}`;

      const imgCaption =
        `🎨 *HASIL GAMBAR AI HD (FLUX ENGINE)*\n\n` +
        `📝 *Prompt:* _"${rawText}"_\n` +
        `💡 *Ingin gambar ini bergerak jadi video?* Klik tombol *Hidupkan Jadi Video Motion 60 FPS* di bawah!` +
        softSellFooter;

      const imgKeyboard = {
        inline_keyboard: [
          [{ text: '🎬 Hidupkan Gambar Ini Jadi Video 60 FPS!', url: animateUrl }],
          [{ text: '🎨 Buat Gambar Lain', callback_data: 'ai_mode:image' }, { text: '🎁 Menu AI Gratis', callback_data: 'ai_menu' }]
        ]
      };

      const pRes = await sendTelegramPhotoBinaryOrUrl(chatId, fluxImgUrl, imgCaption, imgKeyboard);
      if (!pRes || !pRes.ok) {
        await sendTelegramMessage(chatId, imgCaption, imgKeyboard);
      }
      return;
    }

    // 4. MODE: SCRIPT KONTEN FYP / COPYWRITING / ARENA CHAT
    await sendTelegramMessage(chatId, '🤖 *Arena AI sedang menyusun jawaban terbaik untuk Anda...*');

    let sysPrompt = 'Kamu adalah asisten AI pintar berbahasa Indonesia yang ramah, jelas, dan solutif.';
    let headerTitle = '🤖 *JAWABAN ARENA AI PINTAR*';

    if (mode === 'script') {
      sysPrompt = 'Kamu adalah pakar konten viral TikTok, Reels, dan YouTube Shorts Indonesia. Buat naskah video pendek berdurasi 30-45 detik yang terdiri dari: 1) HOOK 3 DETIK PERTAMA yang bikin orang berhenti scroll, 2) ISI KONTEN padat & menarik, 3) ARAHAN VISUAL KAMERA, 4) CALL TO ACTION (CTA) yang memicu komentar & pembelian, serta Hashtag FYP.';
      headerTitle = '🔥 *SCRIPT KONTEN FYP SIAP REKAM*';
    } else if (mode === 'copy') {
      sysPrompt = 'Kamu adalah Master Copywriter Indonesia kelas dunia. Buatkan 2 versi teks promosi jualan yang siap copy-paste ke Facebook, WhatsApp, Reddit, X, dan Marketplace: Versi 1 (Hard-Selling penuh urgensi & diskon) dan Versi 2 (Soft-Selling cerita/edukasi yang menyentuh emosi pembeli). Gunakan emoji yang menarik.';
      headerTitle = '✍️ *COPYWRITING JUALAN SIAP PAKAI*';
    }

    const aiReply = await callPollinationsText(sysPrompt, rawText, 6000) ||
      `Berikut ide terbaik untuk *"${rawText}"*:\n\n1. Gunakan kalimat pembuka (Hook) yang langsung menyentuh masalah utama audiens dalam 3 detik pertama.\n2. Tunjukkan bukti nyata / visual produk dengan gerakan kamera Zoom-In.\n3. Akhiri dengan ajakan bertindak (Call to Action) yang jelas.`;

    const safeReply = aiReply.replace(/[*_`[\]]/g, '').slice(0, 3100);
    await sendTelegramMessage(
      chatId,
      `${headerTitle}\n\n${safeReply}${softSellFooter}`,
      {
        inline_keyboard: [
          [
            { text: '🎬 Buat Video AI', callback_data: 'ai_mode:t2v' },
            { text: '🕹️ Motion Control', callback_data: 'ai_mode:motion' }
          ],
          [{ text: '🎁 Kembali ke Menu AI Gratis', callback_data: 'ai_menu' }]
        ]
      }
    );
  } catch (err) {
    await sendTelegramMessage(
      chatId,
      `⚠️ Server AI sedang sibuk, namun Anda tetap bisa membuka Studio Video 60 FPS secara langsung melalui menu di bawah:`,
      { inline_keyboard: [[{ text: '🎁 Buka Menu AI Gratis', callback_data: 'ai_menu' }]] }
    );
  }
}

// ============================================================================
// 10. RENDER AI MOTION VIDEO STUDIO 60 FPS + MP4/WEBM RECORDER (/motion-studio)
// ============================================================================
function renderMotionStudioHtml(url) {
  const src = url.searchParams.get('src') || 'https://image.pollinations.ai/prompt/Cyberpunk%20sports%20car%20in%20neon%20city%208k?width=720&height=1280&nologo=true';
  const rawVid = (url.searchParams.get('vid') || '').trim();
  const preset = url.searchParams.get('preset') || 'zoom_gold';
  const title = url.searchParams.get('title') || 'AppDock AI Motion Video';

  const safeSrc = src.replace(/"/g, '&quot;');
  const safeVid = rawVid ? `/ai-video-proxy?url=${encodeURIComponent(rawVid)}` : '';
  const directDownloadUrl = rawVid ? `/ai-video-proxy?url=${encodeURIComponent(rawVid)}&dl=1` : '';
  const safePreset = preset.replace(/[^a-z0-9_]/gi, '');
  const safeTitle = title.replace(/[<>"']/g, '');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AppDock AI Motion Studio 60 FPS — ${safeTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at top, #0f172a 0%, #050811 100%);
      color: #f8fafc;
      font-family: system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px;
    }
    .studio-card {
      width: 100%;
      max-width: 480px;
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 20px;
      padding: 16px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
    }
    .badge-top {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    h1 { font-size: 17px; color: #38bdf8; margin-bottom: 4px; }
    .sub { font-size: 12px; color: #94a3b8; margin-bottom: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .canvas-wrap {
      position: relative;
      width: 100%;
      aspect-ratio: 9 / 16;
      background: #020617;
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      margin-bottom: 14px;
    }
    canvas {
      width: 100%;
      height: 100%;
      display: block;
    }
    .status-pill {
      position: absolute;
      top: 12px;
      left: 12px;
      background: rgba(2, 6, 23, 0.78);
      backdrop-filter: blur(8px);
      color: #f8fafc;
      padding: 5px 10px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }
    .section-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #94a3b8;
      margin-bottom: 8px;
    }
    .preset-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    .preset-btn {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      transition: all 0.18s;
    }
    .preset-btn.active, .preset-btn:hover {
      background: rgba(56, 189, 248, 0.18);
      border-color: #38bdf8;
      color: #fff;
    }
    .btn-download {
      width: 100%;
      background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%);
      color: #fff;
      border: none;
      border-radius: 12px;
      padding: 13px;
      font-size: 14px;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 8px 25px rgba(234, 88, 12, 0.4);
      margin-bottom: 10px;
    }
    .btn-download:disabled {
      opacity: 0.65;
      cursor: wait;
    }
    .cta-box {
      margin-top: 8px;
      padding: 12px;
      border-radius: 12px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.25);
      font-size: 12px;
      color: #cbd5e1;
      text-align: center;
      line-height: 1.45;
    }
    .cta-box a {
      display: inline-block;
      margin-top: 6px;
      color: #34d399;
      font-weight: 700;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="studio-card">
    <div class="badge-top">⚡ LIVE 60 FPS MOTION ENGINE</div>
    <h1>AppDock AI Video & Motion Control</h1>
    <div class="sub">${safeTitle}</div>

    <div class="canvas-wrap">
      <canvas id="motionCanvas" width="720" height="1280"></canvas>
      <div class="status-pill" id="statusBadge">⏳ Memuat Keyframe HD...</div>
    </div>

    <div class="section-label">🕹️ Motion Control (Klik Untuk Ganti Gerakan Kamera):</div>
    <div class="preset-grid">
      <button class="preset-btn" data-preset="zoom_gold" onclick="setPreset('zoom_gold')">🔍 Zoom-In + Gold</button>
      <button class="preset-btn" data-preset="orbit_neon" onclick="setPreset('orbit_neon')">🌀 3D Orbit + Neon</button>
      <button class="preset-btn" data-preset="float_cinematic" onclick="setPreset('float_cinematic')">🌊 Smooth Float</button>
      <button class="preset-btn" data-preset="pan_cyber" onclick="setPreset('pan_cyber')">⚡ Dynamic Pan</button>
      <button class="preset-btn" data-preset="zoomout_rain" onclick="setPreset('zoomout_rain')">🌧️ Zoom-Out Rain</button>
      <button class="preset-btn" data-preset="product_bokeh" onclick="setPreset('product_bokeh')">💎 Product Bokeh</button>
    </div>

    ${directDownloadUrl ? `<a href="${directDownloadUrl}" class="btn-download" style="display:block;text-align:center;text-decoration:none;background:linear-gradient(135deg,#10b981 0%,#059669 100%);box-shadow:0 8px 25px rgba(16,185,129,0.35);margin-bottom:8px;">📥 Download Video MP4 Bergerak Asli (Instan 1 Detik)</a>` : ''}
    <button class="btn-download" id="recordBtn" onclick="recordAndDownload()">⬇️ Rekam Video + Efek Motion & Partikel (5 Detik HD)</button>

    <div class="cta-box">
      🚀 Ingin posting video ini ke ratusan akun TikTok, FB, Reddit, X & Marketplace secara otomatis?<br>
      <a href="https://t.me/${CONFIG.BOT_USERNAME}">👉 Buka @${CONFIG.BOT_USERNAME} & Ambil Software / Komisi 30%</a>
    </div>
  </div>

  <video id="bgVideo" muted loop playsinline autoplay crossOrigin="anonymous" style="display:none;"></video>

  <script>
    const canvas = document.getElementById('motionCanvas');
    const ctx = canvas.getContext('2d');
    const statusBadge = document.getElementById('statusBadge');
    const recordBtn = document.getElementById('recordBtn');
    const bgVideo = document.getElementById('bgVideo');

    let currentPreset = '${safePreset}' || 'zoom_gold';
    const imgUrl = "${safeSrc}";
    const vidUrl = "${safeVid}";
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let imgLoaded = false;
    let videoReady = false;

    if (vidUrl) {
      bgVideo.src = vidUrl;
      bgVideo.addEventListener('loadeddata', () => {
        videoReady = true;
        bgVideo.play().catch(() => {});
        statusBadge.textContent = '🟢 Video MP4 Asli + Motion 60 FPS • ' + currentPreset.toUpperCase();
      });
      bgVideo.addEventListener('canplay', () => {
        videoReady = true;
        bgVideo.play().catch(() => {});
      });
    }

    const particles = Array.from({ length: 55 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 3.5 + 1,
      vx: (Math.random() - 0.5) * 1.6,
      vy: (Math.random() - 0.5) * 2.2 - 0.8,
      alpha: Math.random() * 0.75 + 0.25
    }));

    function highlightActiveButton() {
      document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === currentPreset);
      });
    }
    highlightActiveButton();

    function setPreset(p) {
      currentPreset = p;
      highlightActiveButton();
      statusBadge.textContent = '🎥 Motion: ' + p.toUpperCase();
    }

    img.onload = () => {
      imgLoaded = true;
      statusBadge.textContent = '🟢 60 FPS Live • ' + currentPreset.toUpperCase();
    };
    img.onerror = () => {
      statusBadge.textContent = '⚠️ Memuat ulang gambar...';
    };
    img.src = imgUrl;

    let startTime = performance.now();

    function renderFrame(now) {
      const t = (now - startTime) / 1000;
      const W = canvas.width;
      const H = canvas.height;

      ctx.fillStyle = '#050814';
      ctx.fillRect(0, 0, W, H);

      if (videoReady || imgLoaded) {
        ctx.save();
        ctx.translate(W / 2, H / 2);

        let scale = 1.10;
        let tx = 0;
        let ty = 0;
        let rot = 0;

        if (currentPreset === 'zoom_gold') {
          scale = 1.04 + 0.14 * (0.5 - 0.5 * Math.cos(t * 0.85));
          ty = Math.sin(t * 0.7) * 14;
        } else if (currentPreset === 'orbit_neon') {
          scale = 1.12 + 0.04 * Math.sin(t * 1.2);
          tx = Math.cos(t * 1.1) * 24;
          ty = Math.sin(t * 1.1) * 16;
          rot = Math.sin(t * 0.9) * 0.025;
        } else if (currentPreset === 'float_cinematic') {
          scale = 1.08 + 0.04 * Math.sin(t * 0.9);
          ty = Math.sin(t * 1.5) * 22;
        } else if (currentPreset === 'pan_cyber') {
          scale = 1.12;
          tx = Math.sin(t * 1.1) * 28;
        } else if (currentPreset === 'zoomout_rain') {
          scale = 1.20 - 0.14 * (0.5 - 0.5 * Math.cos(t * 0.85));
        } else if (currentPreset === 'product_bokeh') {
          // Gerakan Kamera Pedestal Sinematik Menyusuri Produk dari Bawah ke Atas + Goyangan 3D Halus
          scale = 1.06 + 0.04 * Math.sin(t * 0.9);
          tx = Math.sin(t * 0.8) * 24;
          ty = Math.cos(t * 0.6) * 32;
          rot = Math.sin(t * 0.7) * 0.025;
        }

        ctx.rotate(rot);
        ctx.scale(scale, scale);
        ctx.translate(tx, ty);

        if (videoReady && bgVideo.videoWidth > 0) {
          const vW = bgVideo.videoWidth;
          const vH = bgVideo.videoHeight;
          const vidRatio = vW / vH;
          const canvasRatio = W / H;
          let drawW = W;
          let drawH = H;
          if (vidRatio > canvasRatio) {
            drawH = H;
            drawW = H * vidRatio;
          } else {
            drawW = W;
            drawH = W / vidRatio;
          }
          ctx.drawImage(bgVideo, -drawW / 2, -drawH / 2, drawW, drawH);
        } else {
          // Potong 10% bagian bawah jika sumber dari Pollinations agar bebas watermark pollinations.ai
          const srcH = imgUrl.includes('pollinations.ai') ? Math.floor(img.height * 0.90) : img.height;
          const imgRatio = img.width / srcH;
          const canvasRatio = W / H;
          let drawW = W;
          let drawH = H;
          if (imgRatio > canvasRatio) {
            drawH = H;
            drawW = H * imgRatio;
          } else {
            drawW = W;
            drawH = W / imgRatio;
          }
          ctx.drawImage(img, 0, 0, img.width, srcH, -drawW / 2, -drawH / 2, drawW, drawH);

          // Efek Shimmer / Metallic Gleam Light Sweep pada produk asli
          const sweep = ((t * 0.4) % 1.5) - 0.25;
          if (sweep >= 0 && sweep <= 1) {
            ctx.save();
            const sweepX = -drawW / 2 + drawW * sweep;
            const sGrad = ctx.createLinearGradient(sweepX - 80, -drawH / 2, sweepX + 80, drawH / 2);
            sGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
            sGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.25)');
            sGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = sGrad;
            ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
          }
        }
        ctx.restore();
      }

      // Efek Light Leak Sinematik
      const grad = ctx.createRadialGradient(
        W * (0.5 + 0.35 * Math.sin(t * 0.7)),
        H * (0.3 + 0.2 * Math.cos(t * 0.5)),
        10,
        W * 0.5,
        H * 0.5,
        W * 0.95
      );
      if (currentPreset === 'orbit_neon' || currentPreset === 'pan_cyber') {
        grad.addColorStop(0, 'rgba(0, 240, 255, 0.16)');
        grad.addColorStop(0.5, 'rgba(168, 85, 247, 0.08)');
      } else {
        grad.addColorStop(0, 'rgba(251, 191, 36, 0.16)');
        grad.addColorStop(0.5, 'rgba(245, 158, 11, 0.05)');
      }
      grad.addColorStop(1, 'rgba(2, 6, 23, 0.45)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Partikel Dinamis sesuai Preset
      for (const p of particles) {
        if (currentPreset === 'zoomout_rain') {
          p.y += 9;
          if (p.y > H) { p.y = -10; p.x = Math.random() * W; }
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x, p.y + 18);
          ctx.stroke();
        } else {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0) p.x = W;
          if (p.x > W) p.x = 0;
          if (p.y < 0) p.y = H;
          if (p.y > H) p.y = 0;

          ctx.beginPath();
          const radius = currentPreset === 'product_bokeh' ? p.r * 3.2 : p.r;
          ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
          if (currentPreset === 'orbit_neon' || currentPreset === 'pan_cyber') {
            ctx.fillStyle = \`rgba(56, 189, 248, \${p.alpha})\`;
          } else {
            ctx.fillStyle = \`rgba(251, 191, 36, \${p.alpha})\`;
          }
          ctx.fill();
        }
      }

      requestAnimationFrame(renderFrame);
    }
    requestAnimationFrame(renderFrame);

    function recordAndDownload() {
      if (!videoReady && !imgLoaded) {
        alert('Mohon tunggu video/gambar selesai dimuat terlebih dahulu.');
        return;
      }
      recordBtn.disabled = true;
      recordBtn.textContent = '🔴 Sedang Merekam Video 60 FPS (5 dtk)...';

      const stream = canvas.captureStream(60);
      let mimeType = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
      if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4';
      }

      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'AppDock_AI_Video_' + currentPreset + '.' + ext;
        document.body.appendChild(a);
        a.click();
        a.remove();
        recordBtn.disabled = false;
        recordBtn.textContent = '✅ Berhasil Didownload! Klik Untuk Rekam Lagi';
      };

      recorder.start();
      setTimeout(() => recorder.stop(), 5000);
    }
  </script>
</body>
</html>`;
}

// ============================================================================
// 11. GENERATE DRAMA STUDIO TRIAL (EPISODE 1–3 GRATIS + UPSELL JUALIN AJA PRO)
// Ported dari Jualin Aja Drama Studio (webfic.com + dldrama.com + StoryFlow AI)
// ============================================================================
const DRAMA_STORY_PRESETS = [
  {
    label: 'CEO Menyamar Jadi Satpam Dilabrak Mantan',
    prompt: 'CEO triliuner dingin yang menyamar jadi satpam biasa selama 3 tahun demi menguji ketulusan tunangannya, namun justru dihina di pesta pertunangan mewah sebelum pengawal pribadinya datang berlutut'
  },
  {
    label: 'Menantu Terbuang Ternyata Raja Bisnis 500T',
    prompt: 'Menantu pria yang selalu dihina miskin oleh ibu mertuanya di meja makan, ternyata adalah pemilik tunggal konglomerat global senilai 500 Triliun yang baru saja membeli seluruh perusahaan keluarga istrinya'
  },
  {
    label: 'Putri Asli Konglomerat Kembali Balas Dendam',
    prompt: 'Wanita muda pewaris sah keluarga miliarder yang ditukar saat bayi dan diusir oleh saudara angkatnya, kini kembali dengan identitas investor misterius untuk merebut kembali seluruh warisan dan menghancurkan musuhnya'
  },
  {
    label: 'Kawin Kontrak 100 Hari Dengan Pewaris Kejam',
    prompt: 'Gadis sederhana yang terpaksa menandatangani surat kawin kontrak 100 hari dengan CEO dingin paling ditakuti di Asia demi biaya operasi ibunya, tanpa tahu sang CEO telah lama mencintainya secara rahasia'
  },
  {
    label: 'Dokter Jenius Dihina Mertua Penyelamat Presiden',
    prompt: 'Dokter ahli bedah legendaris dunia yang menyembunyikan identitasnya dan bekerja sebagai petugas kebersihan rumah sakit, diremehkan oleh direktur rumah sakit tepat saat tamu VVIP negara membutuhkan operasi darurat'
  },
  {
    label: 'Reinkarnasi Istri Teraniaya Kembali ke Hari Pernikahan',
    prompt: 'Seorang istri yang dikhianati suami dan sahabatnya hingga kehilangan segalanya, tiba-tiba terbangun kembali di masa lalu tepat 1 jam sebelum akad pernikahan dimulai dan langsung membalikkan keadaan'
  }
];

const FALLBACK_DRAMA_CATALOG = [
  {
    id: '42000006265',
    title: 'Pewaris Triliuner yang Menyamar (Sub Indo)',
    cover: 'https://image.pollinations.ai/prompt/Handsome%20Asian%20billionaire%20CEO%20in%20luxury%20black%20suit%20dramatic%20poster%208k?width=540&height=760&nologo=true&seed=101',
    totalEpisodes: 85,
    synopsis: 'Tiga tahun dihina sebagai menantu tak berguna, hari ini segel rekening 500 Triliun miliknya resmi dibuka kembali.',
    category: 'CEO & Miliarder'
  },
  {
    id: '42000005964',
    title: 'Balas Dendam Sang Nyonya Muda (Sulih Suara)',
    cover: 'https://image.pollinations.ai/prompt/Elegant%20Asian%20heiress%20woman%20in%20red%20evening%20gown%20luxury%20mansion%20drama%20poster%208k?width=540&height=760&nologo=true&seed=202',
    totalEpisodes: 72,
    synopsis: 'Diusir di tengah hujan deras oleh keluarganya sendiri, ia kembali 5 tahun kemudian sebagai pemilik baru grup korporasi kota.',
    category: 'Balas Dendam'
  },
  {
    id: '41000121996',
    title: 'Kawin Kontrak Sang CEO Dingin (Sub Indo)',
    cover: 'https://image.pollinations.ai/prompt/Romantic%20Asian%20CEO%20and%20beautiful%20bride%20contract%20marriage%20drama%20poster%208k?width=540&height=760&nologo=true&seed=303',
    totalEpisodes: 90,
    synopsis: 'Pernikahan kilat di catatan sipil dengan pria asing yang ternyata adalah presdir paling berkuasa di seluruh negeri.',
    category: 'Kawin Kontrak'
  }
];

const _MEM_DRAMA_ITEMS = {};
const _MEM_PREPARED_DRAMA_MP4 = {};
for (const fb of FALLBACK_DRAMA_CATALOG) {
  _MEM_DRAMA_ITEMS[fb.id] = fb;
}

async function getUserSponsor(env, chatId) {
  try {
    const u = await getUserData(env, chatId);
    if (u && u.sponsor_id && String(u.sponsor_id) !== String(chatId)) {
      return String(u.sponsor_id);
    }
  } catch (_) {}
  return 'direct';
}

async function sendDramaStudioMenu(chatId, env) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔥 Drama Trending', callback_data: 'drama_cat:0:in' },
        { text: '🎙️ Dubbing Indonesia', callback_data: 'drama_cat:0:in-dub' }
      ],
      [
        { text: '👔 CEO & Miliarder', callback_data: 'drama_cat:440:in' },
        { text: '⚡ Balas Dendam', callback_data: 'drama_cat:458:in' }
      ],
      [
        { text: '💍 Kawin Kontrak', callback_data: 'drama_cat:454:in' },
        { text: '🏠 Menantu & Mertua', callback_data: 'drama_cat:444:in' }
      ],
      [
        { text: '👑 CEO Wanita Tangguh', callback_data: 'drama_cat:464:in' },
        { text: '⏳ Reinkarnasi / Bangkit', callback_data: 'drama_cat:450:in' }
      ],
      [
        { text: '🔍 Cari Judul / Paste Link DramaBox', callback_data: 'ai_mode:drama_search' }
      ],
      [
        { text: '🔥 Trik Cuan: Live Stream & Shorts Drama Ini (Komisi 30%)', callback_data: 'promo_view:promo_live_shorts' }
      ]
    ]
  };

  await sendTelegramMessage(
    chatId,
    `🍿 *JUALIN AJA DRAMA STUDIO*\n\n` +
    `Selamat datang di pusat *Download & Generate Video Drama Pendek Viral (Sub Indo & Dubbing Indonesia)* untuk konten **YouTube Shorts, TikTok, Instagram Reels & Facebook Pro**!\n\n` +
    `💡 *Peluang Cuan:* Jadikan video drama ini bahan *Live Streaming TikTok* atau *Shorts*! Pasang Link Afiliasi Anda di bio profile: saat penonton tertarik & membeli software otomatisasi, Anda langsung dapat *Komisi 30% (Rp 29.700 – Rp 89.700)* per transaksi!\n\n` +
    `✨ *PILIH KATEGORI DRAMA:*\n` +
    `• 🔥 *Katalog Drama Viral:* Ribuan koleksi drama pendek vertikal kualitas HD 9:16 dari berbagai genre populer.\n` +
    `• 🎙️ *Dubbing Indonesia:* Koleksi drama sulih suara Bahasa Indonesia yang paling banyak ditonton.\n` +
    `• 🔍 *Cari Judul / Paste Link:* Cari drama berdasarkan kata kunci atau tempelkan link DramaBox.\n\n` +
    `👇 *Pilih kategori genre drama di bawah ini:*`,
    keyboard
  );
}

async function fetchWebficDramaCatalog(typeTwoId = 0, langMode = 'in', searchKeyword = '') {
  const isIndoDub = langMode === 'in-dub';
  const apiLang = isIndoDub ? 'in' : (langMode || 'in');
  const results = [];

  try {
    const pagesToFetch = (isIndoDub || searchKeyword) ? [1, 2, 3] : [1, 2];
    for (const pNo of pagesToFetch) {
      const res = await fetchWithTimeout('https://www.webfic.com/webfic/home/browse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'pline': 'DRAMABOX',
          'language': apiLang,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({
          typeTwoId: Number(typeTwoId) || 0,
          pageNo: pNo,
          pageSize: 20
        })
      }, 4500);

      if (res && res.ok) {
        const json = await res.json();
        // Di webfic.com array buku berada di data.data.bookList (sesuai server.ts Jualin Aja)
        const rawList =
          (Array.isArray(json?.data?.bookList) ? json.data.bookList : null) ||
          json?.data?.recommendList?.records ||
          json?.data?.records ||
          [];
        for (const b of rawList) {
          if (!b || !b.bookId) continue;
          const bookId = String(b.bookId);
          const title = String(b.bookName || b.name || 'Drama Tanpa Judul').trim();
          if (isIndoDub && !/sulih\s*suara|\bdub\b/i.test(title)) continue;
          if (searchKeyword) {
            const kw = searchKeyword.toLowerCase();
            const matchTitle = title.toLowerCase().includes(kw);
            const matchDesc = String(b.introduction || '').toLowerCase().includes(kw);
            if (!matchTitle && !matchDesc) continue;
          }
          const slug = String(b.replacedBookName || b.bookNameEn || title)
            .trim()
            .replace(/[^a-zA-Z0-9-_]+/g, '-')
            .replace(/^-+|-+$/g, '') || bookId;
          const pageUrl = `https://www.dramabox.com/in/video/${bookId}_${slug}`;
          const coverUrl = String(
            b.cover ||
            b.coverWap ||
            `https://thwztchapter.dramaboxdb.com/data/cppartner/4x2/42x0/420x0/${bookId}/${bookId}.jpg@w=240&h=400`
          );
          const item = {
            id: bookId,
            bookId,
            slug,
            pageUrl,
            title,
            cover: coverUrl,
            totalEpisodes: Number(b.chapterCount || b.totalEpisodes || 60),
            synopsis: String(b.introduction || 'Drama pendek vertikal penuh intrik dan plot twist mengejutkan.').trim(),
            category: b.typeTwoName || (isIndoDub ? 'Dubbing Indonesia' : 'Drama Populer')
          };
          _MEM_DRAMA_ITEMS[item.id] = item;
          if (!results.some(r => r.id === item.id)) {
            results.push(item);
          }
        }
      }
      if (results.length >= 8) break;
    }
  } catch (_) {}

  if (results.length === 0) {
    return FALLBACK_DRAMA_CATALOG;
  }
  return results;
}

async function handleDramaCategoryBrowse(chatId, env, typeTwoId = 0, langMode = 'in') {
  const genreNames = {
    0: langMode === 'in-dub' ? '🎙️ Drama Dubbing Indonesia' : '🔥 Drama Trending Populer',
    440: '👔 CEO & Miliarder',
    458: '⚡ Balas Dendam',
    454: '💍 Kawin Kontrak',
    444: '🏠 Menantu & Mertua',
    464: '👑 CEO Wanita Tangguh',
    450: '⏳ Reinkarnasi & Kesempatan Kedua'
  };
  const label = genreNames[typeTwoId] || '🍿 Katalog Drama Populer';

  await sendTelegramMessage(chatId, `⏳ *Memuat katalog ${label}...*`);

  const items = await fetchWebficDramaCatalog(typeTwoId, langMode, '');
  const topItems = items.slice(0, 6);

  const buttons = topItems.map((it, i) => ([
    { text: `🎬 ${i + 1}. ${String(it.title).slice(0, 36)} (${it.totalEpisodes} Ep)`, callback_data: `drama_pick:${it.id}` }
  ]));
  buttons.push([
    { text: '🔍 Cari Judul Drama Lain', callback_data: 'ai_mode:drama_search' },
    { text: '🔙 Kembali ke Menu Drama', callback_data: 'drama_menu' }
  ]);

  let text = `${label.toUpperCase()}\n\n`;

  topItems.forEach((it, idx) => {
    text += `*${idx + 1}. ${it.title}*\n   📺 Total: *${it.totalEpisodes} Episode* • Format Vertical HD 9:16\n\n`;
  });

  text += `👇 *Klik salah satu judul drama di bawah untuk memilih episode:*`;

  await sendTelegramMessage(chatId, text, { inline_keyboard: buttons });
}

async function handleDramaPickItem(chatId, env, bookId) {
  let cleanId = String(bookId || '').trim();
  if (!/^\d+$/.test(cleanId)) {
    const liveList = await fetchWebficDramaCatalog(0, 'in', '');
    cleanId = liveList[0]?.id || '42000006265';
  }
  let item = _MEM_DRAMA_ITEMS[cleanId];

  if (!item) {
    // Cari di katalog live webfic terlebih dahulu agar dapat slug & pageUrl asli
    await fetchWebficDramaCatalog(0, 'in', '');
    item = _MEM_DRAMA_ITEMS[cleanId];
  }

  if (!item) {
    // Coba ambil metadata cepat dari dldrama.com jika user mem-paste ID baru
    try {
      const targetUrl = `https://www.dramabox.com/in/video/${cleanId}_drama`;
      const r = await fetchWithTimeout('https://dldrama.com/api/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://dldrama.com',
          'Referer': 'https://dldrama.com/dramabox'
        },
        body: JSON.stringify({ url: targetUrl })
      }, 4500);
      if (r && r.ok) {
        const d = await r.json();
        item = {
          id: cleanId,
          bookId: cleanId,
          pageUrl: targetUrl,
          title: d.title || `Drama Pilihan #${cleanId}`,
          cover: d.cover || `https://thwztchapter.dramaboxdb.com/data/cppartner/4x2/42x0/420x0/${cleanId}/${cleanId}.jpg@w=240&h=400`,
          totalEpisodes: Array.isArray(d.episodes) && d.episodes.length > 0 ? d.episodes.length : 65,
          synopsis: d.description || 'Drama pendek populer dengan alur cerita penuh kejutan.',
          category: 'DramaBox Indonesia'
        };
        _MEM_DRAMA_ITEMS[cleanId] = item;
      }
    } catch (_) {}
  }

  if (!item) {
    item = {
      id: cleanId,
      bookId: cleanId,
      pageUrl: `https://www.dramabox.com/in/video/${cleanId}_drama`,
      title: `Drama Short Viral #${cleanId}`,
      cover: `https://thwztchapter.dramaboxdb.com/data/cppartner/4x2/42x0/420x0/${cleanId}/${cleanId}.jpg@w=240&h=400`,
      totalEpisodes: 60,
      synopsis: 'Drama pendek vertikal populer dengan konflik menegangkan di setiap episode.',
      category: 'Drama Populer'
    };
    _MEM_DRAMA_ITEMS[cleanId] = item;
  }

  const caption =
    `🎬 *${item.title}*\n` +
    `🏷️ *Kategori:* ${item.category}\n` +
    `📺 *Total Episode:* ${item.totalEpisodes} Episode (Vertical HD 9:16)\n\n` +
    `📖 *Sinopsis:*\n_${String(item.synopsis).replace(/[*_`[\]]/g, '').slice(0, 360)}_\n\n` +
    `👇 *Pilih episode yang ingin Anda tonton atau download di bawah ini:*`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '▶️ Episode 1', callback_data: `drama_ep:${cleanId}:1` },
        { text: '▶️ Episode 2', callback_data: `drama_ep:${cleanId}:2` },
        { text: '▶️ Episode 3', callback_data: `drama_ep:${cleanId}:3` }
      ],
      [
        { text: '▶️ Episode 4', callback_data: `drama_ep:${cleanId}:4` },
        { text: '▶️ Episode 5', callback_data: `drama_ep:${cleanId}:5` },
        { text: '▶️ Episode 6', callback_data: `drama_ep:${cleanId}:6` }
      ],
      [
        { text: `📦 Download Full Episode (Ep 1 - ${item.totalEpisodes} Tamat)`, callback_data: `drama_lock:${cleanId}` }
      ],
      [
        { text: '🔥 Trik Cuan: Live Stream & Shorts Drama Ini', callback_data: 'promo_view:promo_live_shorts' }
      ],
      [
        { text: '🔙 Kembali ke Katalog Drama', callback_data: 'drama_menu' }
      ]
    ]
  };

  if (item.cover && item.cover.startsWith('http')) {
    const pRes = await sendTelegramPhotoBinaryOrUrl(chatId, item.cover, caption, keyboard);
    if (pRes && pRes.ok) return;
  }

  await sendTelegramMessage(chatId, caption, keyboard);
}

// Helper internal untuk resolve 1 bookId ke MP4 URL via dldrama.com & sansekai
async function tryResolveSingleBookMp4(cleanId, safeEp) {
  const cacheKey = `${cleanId}_ep_${safeEp}`;
  if (_MEM_PREPARED_DRAMA_MP4[cacheKey]) {
    return _MEM_PREPARED_DRAMA_MP4[cacheKey];
  }

  const knownItem = _MEM_DRAMA_ITEMS[cleanId];
  const candidateUrls = Array.from(new Set([
    knownItem?.pageUrl || '',
    `https://www.dramabox.com/in/video/${cleanId}_drama`,
    `https://www.dramabox.com/video/${cleanId}_drama`
  ].filter(Boolean)));

  // 1. Primary Resolver: dldrama.com (/api/resolve -> /api/prepare) persis seperti server.ts Jualin Aja
  for (const targetUrl of candidateUrls) {
    try {
      const resResolve = await fetchWithTimeout('https://dldrama.com/api/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://dldrama.com',
          'Referer': 'https://dldrama.com/dramabox',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({ url: targetUrl })
      }, 6000);

      if (resResolve && resResolve.ok) {
        const resolveData = await resResolve.json();
        const rawEps = Array.isArray(resolveData?.episodes) ? resolveData.episodes : [];
        if (rawEps.length > 0) {
          if (!_MEM_DRAMA_ITEMS[cleanId] && resolveData.title) {
            _MEM_DRAMA_ITEMS[cleanId] = {
              id: cleanId,
              bookId: cleanId,
              pageUrl: targetUrl,
              title: resolveData.title,
              cover: resolveData.cover || `https://thwztchapter.dramaboxdb.com/data/cppartner/4x2/42x0/420x0/${cleanId}/${cleanId}.jpg@w=240&h=400`,
              totalEpisodes: rawEps.length,
              synopsis: resolveData.description || '',
              category: 'DramaBox'
            };
          }

          const unlockedPool = rawEps.filter(e => e && e.available && e.id && e.pageUrl);
          const exactEp = rawEps.find(e => Number(e.number) === safeEp);
          const chosenEp = (exactEp && exactEp.available && exactEp.id)
            ? exactEp
            : (unlockedPool.length > 0 ? unlockedPool[(safeEp - 1) % unlockedPool.length] : null);

          if (chosenEp) {
            const resPrep = await fetchWithTimeout('https://dldrama.com/api/prepare', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Origin': 'https://dldrama.com',
                'Referer': 'https://dldrama.com/dramabox',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              },
              body: JSON.stringify({ url: chosenEp.pageUrl || targetUrl, episodeId: String(chosenEp.id) })
            }, 6000);

            if (resPrep && resPrep.ok) {
              const prepData = await resPrep.json();
              if (prepData && prepData.url && /^https?:\/\//i.test(prepData.url)) {
                const out = {
                  mp4Url: prepData.url,
                  title: resolveData.title || _MEM_DRAMA_ITEMS[cleanId]?.title || `Drama #${cleanId}`,
                  totalEpisodes: rawEps.length || _MEM_DRAMA_ITEMS[cleanId]?.totalEpisodes || 60
                };
                _MEM_PREPARED_DRAMA_MP4[cacheKey] = out;
                return out;
              }
            }
          }
        }
      }
    } catch (_) {}
  }

  // 2. Secondary Resolver Fallback: api.sansekai.my.id (sama seperti fallback di server.ts Jualin Aja)
  try {
    const sanRes = await fetchWithTimeout(`https://api.sansekai.my.id/api/dramabox/get-allepisodes?bookId=${encodeURIComponent(cleanId)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    }, 5500);

    if (sanRes && sanRes.ok) {
      const chapters = await sanRes.json();
      if (Array.isArray(chapters) && chapters.length > 0) {
        const ch = chapters[Math.min(safeEp - 1, chapters.length - 1)];
        const cdn = ch?.cdnList?.find(c => c.isDefault === 1) || ch?.cdnList?.[0];
        const vList = cdn?.videoPathList || [];
        const best = vList.find(v => v.quality === 720) || vList.find(v => v.isDefault === 1) || vList[0];
        if (best && best.videoPath) {
          const out = {
            mp4Url: best.videoPath,
            title: _MEM_DRAMA_ITEMS[cleanId]?.title || `Drama #${cleanId}`,
            totalEpisodes: chapters.length || 60
          };
          _MEM_PREPARED_DRAMA_MP4[cacheKey] = out;
          return out;
        }
      }
    }
  } catch (_) {}

  return null;
}

// Resolver MP4 Asli untuk Episode 1, 2, dan 3 (Dibatasi Ketat Maksimal Episode 3!)
async function resolveRealDramaEpisodeMp4(bookId, epNum) {
  const safeEp = Math.max(1, Math.min(3, Number(epNum) || 1));
  let cleanId = String(bookId || '').trim();

  // Jika bookId bukan angka (misal dari tombol lama 'story_ai'), ambil dari katalog live webfic
  if (!/^\d+$/.test(cleanId)) {
    const liveCatalog = await fetchWebficDramaCatalog(0, 'in', '');
    if (liveCatalog && liveCatalog.length > 0) {
      cleanId = liveCatalog[0].id;
    } else {
      cleanId = '42000006265';
    }
  }

  const directResult = await tryResolveSingleBookMp4(cleanId, safeEp);
  if (directResult && directResult.mp4Url) {
    return directResult;
  }

  // Jika judul tersebut belum ada di cache isolate ini, muat katalog live webfic lalu coba lagi dengan pageUrl lengkap
  const liveItems = await fetchWebficDramaCatalog(0, 'in', '');
  if (_MEM_DRAMA_ITEMS[cleanId]?.pageUrl) {
    const retryWithSlug = await tryResolveSingleBookMp4(cleanId, safeEp);
    if (retryWithSlug && retryWithSlug.mp4Url) return retryWithSlug;
  }

  // Fallback ke judul aktif pertama di katalog live webfic agar video player TIDAK PERNAH blank
  for (const cand of liveItems.slice(0, 3)) {
    if (cand.id && cand.id !== cleanId) {
      const fbRes = await tryResolveSingleBookMp4(cand.id, safeEp);
      if (fbRes && fbRes.mp4Url) return fbRes;
    }
  }

  return null;
}

async function handleDramaEpisodeTrial(chatId, env, bookId, epNum, workerOrigin) {
  let cleanId = String(bookId || '').trim();
  const requestedEp = Number(epNum) || 1;

  // PROTEKSI KETAT: Begitu user klik Episode 4 atau seterusnya, langsung LOCK & tampilkan Copywriting Jualin Aja!
  if (requestedEp > 3 || requestedEp < 1) {
    await handleDramaLockedUpsell(chatId, env, cleanId, requestedEp);
    return;
  }

  if (!/^\d+$/.test(cleanId)) {
    const liveList = await fetchWebficDramaCatalog(0, 'in', '');
    cleanId = liveList[0]?.id || '42000006265';
  }

  const item = _MEM_DRAMA_ITEMS[cleanId] || {
    id: cleanId,
    title: `Drama Viral #${cleanId}`,
    cover: `https://thwztchapter.dramaboxdb.com/data/cppartner/4x2/42x0/420x0/${cleanId}/${cleanId}.jpg@w=240&h=400`,
    totalEpisodes: 65
  };

  const baseOrigin = (CONFIG.PUBLIC_DOMAIN && CONFIG.PUBLIC_DOMAIN.startsWith('http'))
    ? CONFIG.PUBLIC_DOMAIN.replace(/\/+$/, '')
    : ((workerOrigin && workerOrigin.startsWith('http')) ? workerOrigin : 'https://studio.appdockhub.com');

  await sendTelegramMessage(
    chatId,
    `⏳ *Sedang menyiapkan Video MP4 "${item.title}" — EPISODE ${requestedEp}...*\nMohon tunggu ±3-6 detik.`
  );

  const resolved = await resolveRealDramaEpisodeMp4(cleanId, requestedEp);
  const finalTitle = resolved?.title || item.title;
  const totalEps = resolved?.totalEpisodes || item.totalEpisodes || 65;
  const mp4Param = resolved?.mp4Url ? `&mp4=${encodeURIComponent(resolved.mp4Url)}` : '';
  const playerUrl = `${baseOrigin}/drama-player?bookId=${encodeURIComponent(cleanId)}&ep=${requestedEp}&title=${encodeURIComponent(finalTitle.slice(0, 70))}&total=${totalEps}${mp4Param}`;

  const epKeyboard = {
    inline_keyboard: [
      [{ text: `▶️ Putar & Download HD Episode ${requestedEp}`, url: playerUrl }],
      [
        { text: `⏭️ Lanjut Episode ${requestedEp + 1}`, callback_data: `drama_ep:${cleanId}:${requestedEp + 1}` },
        { text: `▶️ Episode ${requestedEp + 2}`, callback_data: `drama_ep:${cleanId}:${requestedEp + 2}` }
      ],
      [
        { text: `📦 Download Semua Episode (Ep 1 - ${totalEps} Tamat)`, callback_data: `drama_lock:${cleanId}` }
      ],
      [{ text: '🔥 Trik Cuan: Live Stream & Shorts Drama Ini', callback_data: 'promo_view:promo_live_shorts' }],
      [{ text: '🍿 Pilih Judul Drama Lain', callback_data: 'drama_menu' }]
    ]
  };

  const epCaption =
    `🎬 *${finalTitle} — EPISODE ${requestedEp}*\n\n` +
    `📺 *Format:* Vertical HD 9:16 (${totalEps} Episode)\n` +
    `👇 *Klik tombol di bawah untuk lanjut ke Episode ${requestedEp + 1} atau download Full Episode (1–${totalEps} Tamat):*`;

  if (resolved && resolved.mp4Url) {
    // Coba kirim langsung file MP4 ke ruang chat Telegram
    const vidRes = await fetchWithTimeout(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendVideo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        video: resolved.mp4Url,
        caption: epCaption,
        parse_mode: 'Markdown',
        supports_streaming: true,
        reply_markup: epKeyboard
      })
    }, 8500);

    if (vidRes && vidRes.ok) {
      return;
    }
  }

  // Jika ukuran MP4 > 20MB (batas URL fetch Telegram), berikan Web Player Streaming + Preview Animasi Bergerak
  const animBytes = await buildAnimatedVideoFromImageUrl(item.cover || FALLBACK_DRAMA_CATALOG[0].cover, 'zoom_gold');
  if (animBytes) {
    const animRes = await sendTelegramAnimationBinary(chatId, animBytes, epCaption, epKeyboard);
    if (animRes && animRes.ok) return;
  }

  await sendTelegramMessage(chatId, epCaption, epKeyboard);
}

// ============================================================================
// NOTIFIKASI LOCK EPISODE 4+ & COPYWRITING HIGH-CONVERSION "JUALIN AJA"
// ============================================================================
async function handleDramaLockedUpsell(chatId, env, bookId, requestedEp = 4) {
  const cleanId = String(bookId || '').trim();
  const refId = await getUserSponsor(env, chatId);
  const item = _MEM_DRAMA_ITEMS[cleanId] || {
    title: 'Drama Pendek Viral',
    totalEpisodes: 80
  };
  const epLabel = requestedEp >= 4 ? `EPISODE ${requestedEp} s/d ${item.totalEpisodes} (TAMAT)` : `FULL EPISODE 1 s/d ${item.totalEpisodes} (TAMAT)`;

  const upsellText =
    `🔒 *NOTIFIKASI SISTEM: ${epLabel} TERKUNCI!*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🎬 *Judul Drama:* *${item.title}*\n` +
    `📌 *Status Akses:* Episode 4 s/d ${item.totalEpisodes} (Tamat) & fitur *Auto-Edit Siap Upload* hanya terbuka di **JUALIN AJA (Versi Full)**.\n\n` +
    `💰 *INTIP BUKTI NYATA POTENSI CUAN CHANNEL UPLOAD DRAMA PENDEK:*\n` +
    `Saat ini ribuan kreator tanpa tampil wajah (*faceless channel*) panen puluhan juta rupiah tiap bulan hanya dari re-upload drama pendek seperti ini:\n\n` +
    `📺 *1. Channel YouTube: "Bioskop Drama Pendek" / "Alur Cerita Drama CEO" / "DramaBox Indo"*\n` +
    `   • 👀 *Rata-rata Penonton:* **8 Juta – 45 Juta+ Views / bulan** _(kombinasi YouTube Shorts + Video Marathon Full Episode 1–2 Jam)_\n` +
    `   • 💵 *Potensi Pendapatan AdSense:* **Rp 18.500.000 – Rp 85.000.000+ / bulan!**\n\n` +
    `📱 *2. Akun TikTok & Reels: "Cuplikan Drama Miliarder" / "Part Drama Sub Indo"*\n` +
    `   • 👀 *Rata-rata Penonton:* **500 Ribu – 12 Juta Views per video** _(karena penonton penasaran lanjut cari Part 4, 5, 6 s/d Tamat!)_\n` +
    `   • 💵 *Potensi Cuan Keranjang Kuning / Affiliate & Creator Rewards:* **Rp 12.000.000 – Rp 45.000.000+ / bulan!**\n\n` +
    `📘 *3. Halaman Facebook Pro (FB Pro): "Nonton Drama Sub Indo Full"*\n` +
    `   • 👀 *Rata-rata Penonton:* **3 Juta – 20 Juta tayangan / bulan**\n` +
    `   • 💵 *Potensi Monetisasi Iklan In-Stream & Bintang:* **Rp 15.000.000 – Rp 60.000.000+ / bulan!**\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ *TAPI HATI-HATI! JANGAN ASAL UPLOAD VIDEO MENTAH!*\n` +
    `Jika Anda mengupload video mentah biasa, algoritma YouTube/TikTok/FB akan langsung mendeteksinya sebagai **Konten Berulang / Hak Cipta (0 Views & Gagal Monetisasi)**.\n\n` +
    `🚀 *SOLUSINYA: PAKAI SOFTWARE "JUALIN AJA" (VERSI FULL)!*\n` +
    `Itulah rahasia para pemain besar! Di **Jualin Aja**, semuanya sudah serba otomatis:\n` +
    `✅ *Unlock Full Episode (Ep 1 s/d Tamat)* + **Auto Batch Merge** (gabung Episode 1–Tamat jadi 1 video marathon siap upload ke YouTube & FB Pro!).\n` +
    `✅ *Engine FFmpeg Anti-Fingerprint Otomatis:* Merombak metadata, MD5/SHA256, & struktur piksel video agar **100% Lolos Deteksi Hak Cipta & Aman Monetisasi AdSense/TikTok/Reels/FB**!\n` +
    `✅ *Auto-Editing Sekali Klik (Tanpa CapCut):* Otomatis pasang **Bingkai Cinema HD**, **Mirror Flip**, **Watermark/Logo Channel Anda**, **Intro 2 Detik**, & **Teks Berjalan**.\n` +
    `✅ *Bonus AI StoryFlow & Affiliate Video Studio Unlimited!*\n\n` +
    `💡 *Cukup 1 video Anda tembus FYP/Rekomendasi, modal software ini langsung balik modal berkali-kali lipat!*\n` +
    `💎 *Harga Lisensi Resmi Versi Full:* Hanya **Rp 299.000** _(Sekali Bayar untuk Selamanya — Tanpa Biaya Bulanan!)_\n\n` +
    `👇 *Ambil peluang emas ini sekarang sebelum keduluan kreator lain! Klik tombol di bawah untuk mengaktifkan Jualin Aja Versi Full:*`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🔥 Ambil Versi Full di Jualin Aja Sekarang (Rp 299.000)', callback_data: `buy_soft_a_ref_${refId}` }],
      [{ text: '🔥 Trik Cuan: Live Stream & Shorts Drama Ini (Komisi 30%)', callback_data: 'promo_view:promo_live_shorts' }],
      [
        { text: '▶️ Putar Ulang Ep 1', callback_data: `drama_ep:${cleanId}:1` },
        { text: '▶️ Putar Ulang Ep 2', callback_data: `drama_ep:${cleanId}:2` },
        { text: '▶️ Putar Ulang Ep 3', callback_data: `drama_ep:${cleanId}:3` }
      ],
      [{ text: '🔙 Kembali ke Katalog Drama', callback_data: 'drama_menu' }]
    ]
  };

  await sendTelegramMessage(chatId, upsellText, keyboard);
}

async function renderDramaTrialPlayerHtml(url) {
  let bookId = (url.searchParams.get('bookId') || '42000006265').replace(/[^0-9a-zA-Z_-]/g, '');
  const rawEp = Number(url.searchParams.get('ep')) || 1;
  const safeEp = Math.max(1, Math.min(3, rawEp));
  let rawTitle = (url.searchParams.get('title') || 'Drama Pendek Viral').replace(/[<>"']/g, '');
  let total = Number(url.searchParams.get('total')) || 65;
  let preResolvedMp4 = (url.searchParams.get('mp4') || '').trim();

  // Jika bookId bukan angka (misal dari tombol lama #story_ai) atau mp4 belum ada, resolve otomatis di sisi server
  if (!/^\d+$/.test(bookId) || !preResolvedMp4 || rawTitle.includes('story_ai')) {
    const resolved = await resolveRealDramaEpisodeMp4(bookId, safeEp);
    if (resolved) {
      if (resolved.mp4Url) preResolvedMp4 = resolved.mp4Url;
      if (resolved.title && (rawTitle.includes('story_ai') || rawTitle.startsWith('Drama Viral'))) {
        rawTitle = String(resolved.title).replace(/[<>"']/g, '');
      }
      if (resolved.totalEpisodes) total = resolved.totalEpisodes;
    }
    if (!/^\d+$/.test(bookId)) {
      const firstKnown = Object.keys(_MEM_DRAMA_ITEMS).find(k => /^\d+$/.test(k));
      bookId = firstKnown || '42000006265';
    }
  }

  const title = rawTitle.replace(/#story_ai/gi, '').trim() || 'Drama Pendek Viral Sub Indo';
  const posterUrl = _MEM_DRAMA_ITEMS[bookId]?.cover || `https://thwztchapter.dramaboxdb.com/data/cppartner/4x2/42x0/420x0/${bookId}/${bookId}.jpg@w=240&h=400`;
  const mp4Query = preResolvedMp4 ? `&mp4=${encodeURIComponent(preResolvedMp4)}` : '';
  const streamUrl = `/drama-stream?bookId=${encodeURIComponent(bookId)}&ep=${safeEp}${mp4Query}`;
  const showLockModalOnLoad = rawEp >= 4 ? 'true' : 'false';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Episode ${safeEp} — ${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at top, #0f172a 0%, #050811 100%);
      color: #f8fafc;
      font-family: system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px;
    }
    .card {
      width: 100%;
      max-width: 460px;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 20px;
      padding: 16px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.75);
    }
    .badge {
      display: inline-block;
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.4);
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    h1 { font-size: 16px; color: #f8fafc; margin-bottom: 4px; }
    .sub { font-size: 12px; color: #94a3b8; margin-bottom: 12px; }
    .video-wrap {
      width: 100%;
      aspect-ratio: 9 / 16;
      background: #000;
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.12);
      margin-bottom: 12px;
      position: relative;
    }
    video { width: 100%; height: 100%; object-fit: contain; background: #000; }
    .ep-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 10px;
    }
    .ep-btn {
      display: block;
      text-align: center;
      padding: 10px 6px;
      border-radius: 10px;
      font-size: 12.5px;
      font-weight: 700;
      text-decoration: none;
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
      cursor: pointer;
    }
    .ep-btn.active {
      background: #f59e0b;
      color: #050811;
      border-color: #fbbf24;
    }
    .full-btn {
      display: block;
      width: 100%;
      text-align: center;
      padding: 11px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 800;
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.4);
      cursor: pointer;
      margin-bottom: 12px;
    }
    /* Modal Lock Notification */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.88);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 9999;
      overflow-y: auto;
    }
    .modal-backdrop.show { display: flex; }
    .modal-box {
      width: 100%;
      max-width: 440px;
      background: linear-gradient(180deg, #0f172a 0%, #090d16 100%);
      border: 1.5px solid #f59e0b;
      border-radius: 20px;
      padding: 18px;
      box-shadow: 0 25px 60px rgba(0,0,0,0.9);
      color: #f8fafc;
    }
    .modal-tag {
      display: inline-block;
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.45);
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .modal-title { font-size: 16.5px; font-weight: 800; color: #fbbf24; margin-bottom: 8px; line-height: 1.35; }
    .income-box {
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.35);
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 12px;
      color: #d1fae5;
      margin-bottom: 10px;
      line-height: 1.45;
    }
    .modal-list { font-size: 12px; color: #cbd5e1; line-height: 1.5; margin-bottom: 12px; }
    .modal-list li { margin-bottom: 5px; list-style: none; }
    .cta-buy {
      display: block;
      width: 100%;
      text-align: center;
      background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%);
      color: #fff;
      font-weight: 800;
      font-size: 14px;
      padding: 13px;
      border-radius: 12px;
      text-decoration: none;
      box-shadow: 0 8px 25px rgba(234, 88, 12, 0.45);
      margin-bottom: 8px;
    }
    .close-btn {
      display: block;
      width: 100%;
      text-align: center;
      background: transparent;
      color: #94a3b8;
      border: 1px solid #334155;
      padding: 9px;
      border-radius: 10px;
      font-size: 12px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">🍿 JUALIN AJA DRAMA STUDIO • HD 9:16</div>
    <h1>${title}</h1>
    <div class="sub">Sedang Memutar: Episode ${safeEp} • Total ${total} Episode</div>

    <div class="video-wrap">
      <video id="dramaVideo" controls autoplay playsinline preload="auto" poster="${posterUrl}" src="${streamUrl}"></video>
    </div>

    <div class="ep-grid">
      <a class="ep-btn ${safeEp === 1 ? 'active' : ''}" href="/drama-player?bookId=${bookId}&ep=1&title=${encodeURIComponent(title)}&total=${total}">▶️ Episode 1</a>
      <a class="ep-btn ${safeEp === 2 ? 'active' : ''}" href="/drama-player?bookId=${bookId}&ep=2&title=${encodeURIComponent(title)}&total=${total}">▶️ Episode 2</a>
      <a class="ep-btn ${safeEp === 3 ? 'active' : ''}" href="/drama-player?bookId=${bookId}&ep=3&title=${encodeURIComponent(title)}&total=${total}">▶️ Episode 3</a>
      <button class="ep-btn" onclick="openLockModal(4)">▶️ Episode 4</button>
      <button class="ep-btn" onclick="openLockModal(5)">▶️ Episode 5</button>
      <button class="ep-btn" onclick="openLockModal(6)">▶️ Episode 6</button>
    </div>
    <button class="full-btn" onclick="openLockModal('Full 1-${total}')">📦 Download Semua Episode (Ep 1 - ${total} Tamat Siap Upload)</button>
  </div>

  <div class="modal-backdrop" id="lockModal">
    <div class="modal-box">
      <div class="modal-tag" id="modalTag">🔒 EPISODE 4 s/d ${total} TERKUNCI</div>
      <div class="modal-title">Panen Jutaan Views & Cuan AdSense/Affiliate dengan Versi Full di JUALIN AJA!</div>
      <div class="income-box">
        💰 <strong>Bukti Potensi Cuan Channel Drama Pendek:</strong><br>
        • 📺 <strong>YouTube ("Bioskop Drama Pendek / Alur Drama CEO"):</strong> 8–45 Juta Views/bln ➔ <strong>Rp 18 Juta – Rp 85 Juta/bln</strong> (AdSense Shorts & Marathon Full Ep)<br>
        • 📱 <strong>TikTok, Reels & FB Pro:</strong> 1–20 Juta Views/bln ➔ <strong>Rp 12 Juta – Rp 60 Juta/bln</strong> (Affiliate & Iklan In-Stream)
      </div>
      <ul class="modal-list">
        <li>✅ <strong>Unlock Full Episode (Ep 1 s/d ${total} Tamat)</strong> + Auto Batch Merge (gabung jadi 1 film utuh 1-2 jam untuk YouTube/FB)!</li>
        <li>✅ <strong>100% Bersih Siap Upload (Anti-Fingerprint FFmpeg):</strong> Otomatis hapus metadata asli, pasang Bingkai Cinema HD, Mirror Flip, Watermark Logo & Teks Berjalan agar <strong>Lolos Hak Cipta & Aman Monetisasi</strong>!</li>
        <li>💎 <strong>Modal Sekali Bayar Rp 299.000:</strong> Cukup 1 video viral langsung balik modal berkali-kali lipat!</li>
      </ul>
      <a class="cta-buy" href="https://t.me/${CONFIG.BOT_USERNAME}?start=buy_soft_a_ref_direct">🔥 Ambil Versi Full di Jualin Aja Sekarang (Rp 299.000)</a>
      <button class="close-btn" onclick="closeLockModal()">Tutup Notifikasi</button>
    </div>
  </div>

  <script>
    function openLockModal(epNum) {
      document.getElementById('modalTag').textContent = '🔒 EPISODE ' + epNum + ' TERKUNCI (KHUSUS VERSI FULL)';
      document.getElementById('lockModal').classList.add('show');
    }
    function closeLockModal() {
      document.getElementById('lockModal').classList.remove('show');
    }
    if (${showLockModalOnLoad}) {
      openLockModal(4);
    }
  </script>
</body>
</html>`;
}

async function handleDramaTrialStream(request, url) {
  const bookId = (url.searchParams.get('bookId') || '').trim();
  const ep = Number(url.searchParams.get('ep')) || 1;
  const directMp4Param = (url.searchParams.get('mp4') || '').trim();

  // Kunci keras di sisi server: Hanya izinkan streaming Episode 1, 2, atau 3!
  if (!bookId || ep < 1 || ep > 3) {
    return new Response('Episode 4 s/d Tamat & Fitur Bersih Siap Upload hanya tersedia di Software Jualin Aja Pro (Rp 299.000).', {
      status: 403,
      headers: CORS_HEADERS
    });
  }

  let targetMp4Url = /^https?:\/\//i.test(directMp4Param) ? directMp4Param : '';
  if (!targetMp4Url) {
    const resolved = await resolveRealDramaEpisodeMp4(bookId, ep);
    if (resolved && resolved.mp4Url) {
      targetMp4Url = resolved.mp4Url;
    }
  }

  if (!targetMp4Url) {
    return new Response('Stream episode sedang tidak tersedia, silakan pilih judul lain di Bot Telegram.', {
      status: 404,
      headers: CORS_HEADERS
    });
  }

  // Sama seperti server.ts Jualin Aja: Gunakan HTTP 206 Partial Content Range (maks 16 MiB per chunk)
  const MAX_STREAM_CHUNK_BYTES = 16 * 1024 * 1024;
  const rawRange = request.headers.get('Range') || request.headers.get('range') || '';
  let startByte = 0;
  let endByte = MAX_STREAM_CHUNK_BYTES - 1;
  if (rawRange.startsWith('bytes=')) {
    const parts = rawRange.replace(/^bytes=/, '').split('-');
    const parsedStart = parseInt(parts[0], 10);
    const parsedEnd = parts[1] ? parseInt(parts[1], 10) : NaN;
    if (!Number.isNaN(parsedStart) && parsedStart >= 0) {
      startByte = parsedStart;
    }
    if (!Number.isNaN(parsedEnd) && parsedEnd >= startByte) {
      endByte = Math.min(parsedEnd, startByte + MAX_STREAM_CHUNK_BYTES - 1);
    } else {
      endByte = startByte + MAX_STREAM_CHUNK_BYTES - 1;
    }
  }

  const reqHeaders = {
    'User-Agent': 'Mozilla/5.0',
    'Range': `bytes=${startByte}-${endByte}`
  };

  let upstream = await fetchWithTimeout(targetMp4Url, { headers: reqHeaders }, 9500);
  if (upstream && (upstream.status === 403 || upstream.status === 404) && directMp4Param) {
    // Jika signed URL lama kadaluarsa, resolve ulang secara fresh
    const fresh = await resolveRealDramaEpisodeMp4(bookId, ep);
    if (fresh && fresh.mp4Url) {
      targetMp4Url = fresh.mp4Url;
      upstream = await fetchWithTimeout(targetMp4Url, { headers: reqHeaders }, 9500);
    }
  }

  if (!upstream || (!upstream.ok && upstream.status !== 206)) {
    return Response.redirect(targetMp4Url, 302);
  }

  const respHeaders = new Headers(CORS_HEADERS);
  respHeaders.set('Content-Type', 'video/mp4');
  respHeaders.set('Accept-Ranges', 'bytes');
  respHeaders.set('Content-Disposition', 'inline');
  respHeaders.set('Cache-Control', 'private, max-age=600');
  if (upstream.headers.get('Content-Length')) {
    respHeaders.set('Content-Length', upstream.headers.get('Content-Length'));
  }
  if (upstream.headers.get('Content-Range')) {
    respHeaders.set('Content-Range', upstream.headers.get('Content-Range'));
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders
  });
}
