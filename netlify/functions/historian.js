/* ==========================================================================
   The Crypto Historian — Netlify Function (prototype, phase 1)
   --------------------------------------------------------------------------
   Rôle : recevoir la question du widget, assembler le system prompt depuis
   PERSONA.md + le brief du coin, appeler l'API Meta Model (Muse Spark,
   format compatible OpenAI), compter les questions gratuites du visiteur
   et renvoyer la réponse. AUCUNE clé en dur : tout passe par les variables
   d'environnement Netlify.

   Variables d'environnement :
     HISTORIAN_API_KEY        (requise pour le mode réel — sinon mode démo)
     HISTORIAN_API_BASE       (défaut : '' → mode démo tant qu'elle est vide)
     HISTORIAN_MODEL          (défaut : 'muse-spark-1.3' — À CONFIRMER dans
                               la doc Meta Model API au moment du branchement)
     HISTORIAN_FREE_PER_DAY   (défaut : 3)
     HISTORIAN_PRICE_API_BASE (optionnel — défaut : API publique CoinGecko,
                               sans clé ; sert à la couche temps réel)
     HISTORIAN_CONTENT_DIR    (optionnel — dossier contenant PERSONA.md et
                               briefs/ ; sinon résolution automatique)

   Couche temps réel (prix) : si le message du visiteur touche le présent
   (prix / « now » / « today » / « worth » et équivalents FR), la fonction
   récupère le prix courant du coin du contexte (+ BTC/ETH de référence et
   tout coin nommé dans la question) via l'API publique CoinGecko, sans
   clé, et l'injecte dans le contexte du modèle dans un bloc « LIVE DATA »
   horodaté — à présenter comme un fait actuel DATÉ, jamais comme une
   prédiction. Échec ou non-pertinence : réponse normale, sans bloc et
   sans erreur visible (repli silencieux, journalisé côté serveur).
   Le brief des origines (briefs/origins.md, racines pré-2009) est chargé
   EN PLUS du brief du coin quand coin = btc ou general.

   TODO phase 2 (paiement) — points d'ancrage marqués « TODO PHASE 2 » :
     1. Remplacer le compteur en mémoire par une persistance durable
        (Netlify Blobs ou base externe) — la Map ci-dessous se réinitialise
        à chaque démarrage à froid de la fonction.
     2. Brancher la vérification de crédits Stripe : un visiteur qui a
        acheté un pack de 10 questions puise dans ses crédits au lieu de
        (ou après) son quota gratuit quotidien.
     3. Remplacer le visitorId localStorage par un jeton signé / compte,
        pour empêcher la réinitialisation triviale du compteur.
     4. Expédier le journal des échanges vers un stockage durable pour
        l'audit hebdomadaire de Mimi (actuellement : console.log structuré,
        visible dans les logs Netlify).
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ *
 * Configuration                                                       *
 * ------------------------------------------------------------------ */
const API_BASE = (process.env.HISTORIAN_API_BASE || '').replace(/\/+$/, '');
const API_KEY = process.env.HISTORIAN_API_KEY || '';
const MODEL = process.env.HISTORIAN_MODEL || 'muse-spark-1.3';
const FREE_PER_DAY = parseInt(process.env.HISTORIAN_FREE_PER_DAY || '3', 10) || 3;
const API_TIMEOUT_MS = 25000;

// Tarifs Meta Model API (Muse Spark) relevés au PLAN.md le 4 oct. 2026 —
// servent uniquement à estimer le coût dans le journal d'audit.
const PRICE_IN_PER_M = 1.25;
const PRICE_OUT_PER_M = 4.25;

const VALID_COINS = ['btc', 'eth', 'ada', 'sol', 'xrp', 'general'];
const ATH_FACTS = {
  btc: '$126,080 USD on October 6, 2025', eth: '$4,946 USD on August 24, 2025',
  ada: '$3.09 USD on September 2, 2021', sol: '$293.31 USD on January 19, 2025',
  xrp: '$3.65 USD on July 17, 2025'
};

const COIN_NAMES = {
  btc: 'Bitcoin', eth: 'Ethereum', ada: 'Cardano',
  sol: 'Solana', xrp: 'XRP', general: 'Power 5'
};

// Liens publics CryptoT (les seuls que le modèle a le droit de citer).
const PUBLIC_LINKS = [
  'Video library: https://cryptot.shop/videos',
  'YouTube channel: https://www.youtube.com/@cryptoTshop',
  'Shop & coin info pages: https://cryptot.shop'
].join('\n');

/* ------------------------------------------------------------------ *
 * Couche temps réel — prix courants via une API publique sans clé     *
 * (CoinGecko par défaut). Voir maybeFetchLiveData() plus bas.         *
 * ------------------------------------------------------------------ */
const PRICE_API_BASE = (process.env.HISTORIAN_PRICE_API_BASE || 'https://api.coingecko.com/api/v3').replace(/\/+$/, '');
const PRICE_TIMEOUT_MS = 6000;

// Identifiants CoinGecko par coin du contexte.
const COINGECKO_IDS = { btc: 'bitcoin', eth: 'ethereum', ada: 'cardano', sol: 'solana', xrp: 'ripple' };

// Mots qui signalent une question sur le PRÉSENT → déclenchent la couche
// temps réel. EN + FR ; les deux formes d'apostrophe sont couvertes.
const PRESENT_KEYWORDS = [
  'price', 'prices', 'now', 'today', 'worth', 'current', 'currently', 'trading at', 'live',
  'prix', 'maintenant', "aujourd'hui", 'aujourd’hui', 'vaut', 'valeur',
  'combien', 'cours', 'actuel', 'actuelle', 'actuellement', 'en ce moment'
];

// Coins MENTIONNÉS dans le texte d'une question (en plus du coin de la page).
const COIN_MENTIONS = [
  { coin: 'btc', words: ['bitcoin', 'btc'] },
  { coin: 'eth', words: ['ethereum', 'ether', 'eth'] },
  { coin: 'ada', words: ['cardano', 'ada'] },
  { coin: 'sol', words: ['solana', 'sol'] },
  { coin: 'xrp', words: ['xrp', 'ripple'] }
];

/* ------------------------------------------------------------------ *
 * Messages du personnage quand le cerveau n'est pas branché ou tombe *
 * (jamais d'erreur technique montrée au visiteur).                    *
 * ------------------------------------------------------------------ */
const OFFLINE_MESSAGES = {
  en: {
    demo: "Ah, a visitor! Forgive the dust — my archives are still being prepared, volume by volume. Come back very soon and I will tell you the whole story of this coin, in plain language, the way it deserves to be told.",
    limit: "And that closes today's reading session — you have used your free questions for the day. The archives reopen tomorrow. (Paid question packs are coming soon.)",
    trouble: "Hmm — a page seems stuck in the archives. Give me a moment to sort my notes and ask me again."
  },
  fr: {
    demo: "Ah, un visiteur ! Pardonne la poussière — mes archives sont encore en préparation, volume par volume. Reviens très bientôt et je te raconterai toute l'histoire de ce coin, en langage clair, comme elle mérite d'être racontée.",
    limit: "Et voilà qui conclut la lecture d'aujourd'hui — tu as utilisé tes questions gratuites du jour. Les archives rouvrent demain. (Les packs de questions payants arrivent bientôt.)",
    trouble: "Hmm — une page semble coincée dans les archives. Laisse-moi un instant pour replacer mes notes et repose-moi ta question."
  }
};

/* ------------------------------------------------------------------ *
 * Chargement du contenu (PERSONA.md + briefs) — lu à l'exécution,     *
 * mis en cache entre les invocations chaudes, repli propre si absent.*
 * ------------------------------------------------------------------ */
let contentDirCache = null;

function resolveContentDir() {
  if (contentDirCache) return contentDirCache;
  const candidates = [];
  if (process.env.HISTORIAN_CONTENT_DIR) candidates.push(process.env.HISTORIAN_CONTENT_DIR);
  // Déploiement visé : fonction dans netlify/functions/, contenu à la racine.
  candidates.push(path.join(__dirname, '..', '..'));
  // Présent dépôt de travail : code/functions/ → ../../ = crypto-historian/.
  candidates.push(path.join(__dirname, '..'));
  candidates.push(process.cwd());
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'PERSONA.md'))) { contentDirCache = dir; return dir; }
  }
  // Aucun PERSONA.md trouvé : on garde le premier candidat, les lectures
  // individuelles retomberont sur les replis intégrés.
  contentDirCache = candidates[0];
  return contentDirCache;
}

const fileCache = new Map();
function readContentFile(relPath) {
  if (fileCache.has(relPath)) return fileCache.get(relPath);
  let content = null;
  try {
    const full = path.join(resolveContentDir(), relPath);
    if (fs.existsSync(full)) content = fs.readFileSync(full, 'utf8');
  } catch (err) {
    console.log(JSON.stringify({ type: 'historian_content_error', file: relPath, error: String(err) }));
  }
  fileCache.set(relPath, content);
  return content;
}

// Repli intégré si PERSONA.md n'est pas encore livré : version courte des
// règles d'ADN du PLAN.md, pour que le prototype reste en caractère.
const FALLBACK_PERSONA = [
  'You are The Crypto Historian, the teacher of cryptot.shop (CryptoT).',
  'Voice: a patient, warm teacher who explains through stories, in plain language.',
  'HARD RULES: education only; never predict prices; never give buy/sell advice;',
  'never promise returns; if you do not know, say so plainly; stay in character.'
].join(' ');

function buildSystemPrompt(coin, lang, liveBlock) {
  const persona = readContentFile('PERSONA.md') || FALLBACK_PERSONA;
  const brief = coin === 'general'
    ? readContentFile(path.join('briefs', 'general.md'))
    : readContentFile(path.join('briefs', coin + '.md'));

  const parts = [persona];
  if (brief) {
    parts.push('\n---\nCOIN BRIEF — ' + COIN_NAMES[coin] + ' (your source material for this page):\n' + brief);
  } else {
    parts.push('\n---\nCONTEXT: the visitor is on the ' + COIN_NAMES[coin] +
      ' page of cryptot.shop. Answer from your own knowledge of this coin\'s history, carefully and honestly.');
  }

  // Brief des origines (racines pré-2009) : chargé EN PLUS du brief du
  // coin pour BTC et le mode généraliste — même repli propre s'il est absent.
  if (coin === 'btc' || coin === 'general') {
    const origins = readContentFile(path.join('briefs', 'origins.md'));
    if (origins) {
      parts.push('\n---\nORIGINS BRIEF — the pre-2009 roots (background material for this page):\n' + origins);
    }
  }

  // Fait documenté ATH : injecté en dur pour que le modèle le donne toujours.
  if (ATH_FACTS[coin]) {
    parts.push('\n---\nDOCUMENTED FACT — ' + COIN_NAMES[coin] + ' all-time high (ATH): ' + ATH_FACTS[coin] +
      '. When a visitor asks for the all-time high, state this fact plainly — the price and the date. Never refuse it as price talk.');
  } else if (coin === 'general') {
    parts.push('\n---\nDOCUMENTED FACTS — all-time highs (ATH): Bitcoin ' + ATH_FACTS.btc + '; Ethereum ' +
      ATH_FACTS.eth + '; Cardano ' + ATH_FACTS.ada + '; Solana ' + ATH_FACTS.sol + '; XRP ' + ATH_FACTS.xrp +
      '. When a visitor asks for an all-time high, state the fact plainly — the price and the date. Never refuse it as price talk.');
  }

  // Bloc temps réel (prix du moment) : présent seulement si la question
  // touche le présent ET si la récupération a réussi (voir plus bas).
  if (liveBlock) {
    parts.push('\n---\n' + liveBlock);
  }

  parts.push(
    '\n---\nRUNTIME:\n' +
    '- Reply in ' + (lang === 'fr' ? 'French' : 'English') + '.\n' +
    '- Plain language, warm teacher tone. Aim for under ~250 words unless the visitor asks for a full story.\n' +
    '- When a CryptoT link genuinely helps, end with ONE of these (never invent other URLs):\n' + PUBLIC_LINKS + '\n' +
    '- Education only: no price predictions, no buy/sell advice, ever.'
  );
  return parts.join('\n');
}

/* ------------------------------------------------------------------ *
 * Compteur de questions — PROTOTYPE : simple Map en mémoire.         *
 * TODO PHASE 2 : persistance durable + crédits Stripe (voir en-tête).*
 * ------------------------------------------------------------------ */
const counters = new Map(); // visitorId -> { day: 'YYYY-MM-DD', count: n }

function todayKey() {
  return new Date().toISOString().slice(0, 10); // UTC — suffisant au prototype
}

function getCount(visitorId) {
  const rec = counters.get(visitorId);
  if (!rec || rec.day !== todayKey()) return 0;
  return rec.count;
}

function incrementCount(visitorId) {
  counters.set(visitorId, { day: todayKey(), count: getCount(visitorId) + 1 });
}

// Petit hachage non crypto — juste pour ne pas journaliser l'identifiant brut.
function shortHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return 'v' + (h >>> 0).toString(36);
}

/* ------------------------------------------------------------------ *
 * Journal d'audit structuré (console.log → logs Netlify).            *
 * TODO PHASE 2 : expédier vers un stockage durable pour l'audit hebdo.*
 * ------------------------------------------------------------------ */
function logExchange(entry) {
  console.log(JSON.stringify(Object.assign({ type: 'historian_exchange', ts: new Date().toISOString() }, entry)));
}

function estimateCostUsd(usage) {
  if (!usage) return null;
  const inTok = usage.prompt_tokens || 0;
  const outTok = usage.completion_tokens || 0;
  return Math.round(((inTok * PRICE_IN_PER_M + outTok * PRICE_OUT_PER_M) / 1e6) * 1e6) / 1e6;
}

/* ------------------------------------------------------------------ *
 * Couche temps réel — détection du « présent » et prix courants.      *
 *                                                                     *
 * Déclenchée seulement si le message du visiteur contient un mot du   *
 * présent (prix / now / today / worth / équivalents FR). Prix via     *
 * l'API publique CoinGecko (simple/price, sans clé). Tout échec est   *
 * un repli SILENCIEUX : on répond sans le bloc, sans erreur visible.  *
 * TODO PHASE 2 : ajouter les manchettes de nouvelles du jour au bloc  *
 * (le prix d'abord — les nouvelles viendront ensuite, toujours        *
 * présentées comme des faits datés, jamais des prédictions).          *
 * ------------------------------------------------------------------ */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function touchesPresent(message) {
  const re = new RegExp('\\b(' + PRESENT_KEYWORDS.map(escapeRegExp).join('|') + ')\\b', 'i');
  return re.test(message);
}

function mentionedCoins(message) {
  const found = [];
  for (const entry of COIN_MENTIONS) {
    const re = new RegExp('\\b(' + entry.words.map(escapeRegExp).join('|') + ')\\b', 'i');
    if (re.test(message)) found.push(entry.coin);
  }
  return found;
}

function formatUsd(n) {
  if (typeof n !== 'number' || !isFinite(n)) return null;
  const decimals = n >= 1 ? 2 : 4;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Renvoie le bloc « LIVE DATA » formaté, ou null (pas de bloc, pas d'erreur).
async function maybeFetchLiveData(coin, message) {
  if (!touchesPresent(message)) return null;

  // Coins à récupérer : celui de la page + ceux nommés dans la question +
  // BTC/ETH comme références. En mode généraliste sans mention précise,
  // on prend les cinq Power 5 d'un seul appel.
  const wanted = new Set();
  if (coin !== 'general') wanted.add(coin);
  for (const c of mentionedCoins(message)) wanted.add(c);
  wanted.add('btc');
  wanted.add('eth');
  if (coin === 'general' && wanted.size <= 2) { wanted.add('ada'); wanted.add('sol'); wanted.add('xrp'); }

  const ids = [];
  for (const c of wanted) if (COINGECKO_IDS[c]) ids.push(COINGECKO_IDS[c]);
  if (!ids.length) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRICE_TIMEOUT_MS);
  try {
    const url = PRICE_API_BASE + '/simple/price?ids=' + encodeURIComponent(ids.join(',')) +
      '&vs_currencies=usd&include_24hr_change=true';
    const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();

    const lines = [];
    for (const c of wanted) {
      const row = data ? data[COINGECKO_IDS[c]] : null;
      if (!row || typeof row.usd !== 'number') continue;
      let line = COIN_NAMES[c] + ' (' + c.toUpperCase() + '): ' + formatUsd(row.usd) + ' USD';
      if (typeof row.usd_24h_change === 'number') {
        const chg = row.usd_24h_change;
        line += ' (' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '% / 24h)';
      }
      lines.push(line);
    }
    if (!lines.length) return null;

    return 'LIVE DATA — fetched ' + new Date().toISOString() +
      ' — present as current fact WITH this time, never as a prediction:\n' + lines.join('\n');
  } catch (err) {
    // Repli silencieux côté visiteur ; tracé côté serveur pour l'audit.
    console.log(JSON.stringify({ type: 'historian_price_error', ts: new Date().toISOString(), error: String(err && err.message || err) }));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Appel à l'API Meta Model (format compatible OpenAI)                 *
 * ------------------------------------------------------------------ */
async function callModel(systemPrompt, history, message) {
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const h of history) messages.push({ role: h.role, content: h.content });
  messages.push({ role: 'user', content: message });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + '/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY
      },
      body: JSON.stringify({
        model: MODEL,
        messages: messages,
        temperature: 0.7,
        max_tokens: 2500,
        reasoning: { effort: 'low' }
      })
    });
    if (!res.ok) throw new Error('API HTTP ' + res.status);
    const data = await res.json();
    const answer = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : null;
    if (!answer) throw new Error('API response without content');
    return { answer: String(answer).trim(), usage: data.usage || null };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Nettoyage des entrées                                               *
 * ------------------------------------------------------------------ */
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    .slice(-10)
    .map((h) => ({ role: h.role, content: h.content.slice(0, 2000) }));
}

function jsonResponse(statusCode, body) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (typeof body.remaining === 'number') headers['x-historian-remaining'] = String(body.remaining);
  return { statusCode: statusCode, headers: headers, body: JSON.stringify(body) };
}

/* ------------------------------------------------------------------ *
 * Handler Netlify                                                     *
 * ------------------------------------------------------------------ */
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed', remaining: FREE_PER_DAY });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: 'invalid_json', remaining: FREE_PER_DAY });
  }

  const coin = VALID_COINS.indexOf(String(body.coin || '').toLowerCase()) !== -1
    ? String(body.coin).toLowerCase() : 'general';
  const lang = body.lang === 'fr' ? 'fr' : 'en';
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1000) : '';
  const history = sanitizeHistory(body.history);
  const visitorId = (typeof body.visitorId === 'string' && body.visitorId.length <= 64)
    ? body.visitorId
    : 'anon-' + ((event.headers && (event.headers['x-forwarded-for'] || event.headers['client-ip'])) || 'unknown');

  if (!message) {
    return jsonResponse(400, { error: 'empty_message', remaining: FREE_PER_DAY - getCount(visitorId) });
  }

  const msgs = OFFLINE_MESSAGES[lang];
  const used = getCount(visitorId);
  const remainingBefore = Math.max(0, FREE_PER_DAY - used);

  /* --- Quota gratuit épuisé -------------------------------------------
   * TODO PHASE 2 : avant de refuser, vérifier les crédits Stripe du
   * visiteur ; s'il lui en reste, servir la réponse en débitant un
   * crédit plutôt que le quota quotidien. */
  if (remainingBefore <= 0) {
    logExchange({ visitor: shortHash(visitorId), coin: coin, lang: lang, limited: true, question: message.slice(0, 200) });
    return jsonResponse(200, { answer: msgs.limit, remaining: 0, limited: true });
  }

  /* --- Mode démo hors-ligne (clé ou base API absente) ------------------
   * Le visiteur ne perd pas de question : rien n'est débité. */
  if (!API_KEY || !API_BASE) {
    logExchange({ visitor: shortHash(visitorId), coin: coin, lang: lang, demo: true, question: message.slice(0, 200) });
    return jsonResponse(200, { answer: msgs.demo, remaining: remainingBefore, demo: true });
  }

  /* --- Appel réel au modèle ------------------------------------------ */
  try {
    // Couche temps réel : seulement rendue ici (le mode démo et le quota
    // épuisé n'appellent ni le modèle ni l'API de prix — zéro coût inutile).
    const liveBlock = await maybeFetchLiveData(coin, message);
    const systemPrompt = buildSystemPrompt(coin, lang, liveBlock);
    const result = await callModel(systemPrompt, history, message);
    incrementCount(visitorId);
    const remaining = Math.max(0, FREE_PER_DAY - getCount(visitorId));
    logExchange({
      visitor: shortHash(visitorId), coin: coin, lang: lang,
      question: message.slice(0, 200),
      liveData: !!liveBlock,
      promptTokens: result.usage ? result.usage.prompt_tokens : null,
      completionTokens: result.usage ? result.usage.completion_tokens : null,
      estCostUsd: estimateCostUsd(result.usage)
    });
    return jsonResponse(200, { answer: result.answer, remaining: remaining });
  } catch (err) {
    // Échec de NOTRE côté : le visiteur ne perd pas sa question, et il
    // reçoit un mot du personnage plutôt qu'une erreur technique.
    console.log(JSON.stringify({ type: 'historian_api_error', ts: new Date().toISOString(), error: String(err && err.message || err) }));
    return jsonResponse(200, { answer: msgs.trouble, remaining: remainingBefore, error: true });
  }
};
