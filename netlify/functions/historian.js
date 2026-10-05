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
     HISTORIAN_FREE_PER_DAY   (défaut : 3 — malgré son nom historique,
                               c'est le plafond de questions gratuites
                               À VIE par visiteur depuis le 5 oct. 2026)
     HISTORIAN_PRICE_API_BASE (optionnel — défaut : API publique CoinGecko,
                               sans clé ; sert à la couche temps réel)
     HISTORIAN_CONTENT_DIR    (optionnel — dossier contenant PERSONA.md et
                               briefs/ ; sinon résolution automatique)
     HISTORIAN_STRIPE_SECRET_KEY (phase 2 — clé restreinte Stripe du compte
                               CryptoT, permissions Checkout Sessions
                               lecture+écriture seulement ; absente → les
                               packs sont inertes, le reste fonctionne)
     HISTORIAN_STRIPE_PRICE_ID   (phase 2 — prix du pack 20 questions / 3 $)

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

   PHASE 2 (paiement) — FAIT le 4 oct. 2026 :
     - Crédits persistants dans Netlify Blobs (magasin « historian-credits ») :
       solde par visiteur + registre des sessions Stripe créditées
       (idempotence : un session_id ne crédite jamais deux fois).
     - Dépenses : quota gratuit (à vie) d'abord, crédits du pack ensuite.
       Ni l'un ni l'autre n'est débité quand l'appel au modèle échoue.
     - Actions POST supplémentaires sur le même point d'entrée :
         {action:'balance'}  → solde {remaining, credits, canBuy}
         {action:'checkout'} → crée une session Stripe Checkout hébergée
                               (visitorId en metadata + client_reference_id)
                               et renvoie {checkoutUrl}
         {action:'claim', sessionId} → vérifie la session côté serveur
                               auprès de Stripe (payée, montant, visiteur)
                               puis crédite 20 questions, une seule fois.
     - Le compteur des questions GRATUITES était une Map en mémoire
       (plafond quotidien, réinitialisé à chaque démarrage à froid)
       jusqu'au 5 oct. 2026. Depuis la décision de Dim du 5 oct. 2026,
       il vit dans Netlify Blobs comme les crédits, et le modèle est
       passé à 3 questions gratuites À VIE par visiteur (essai unique).
   TODO restant :
     1. Remplacer le visitorId localStorage par un jeton signé / compte,
        pour empêcher la réinitialisation triviale du compteur gratuit.
     2. Expédier le journal des échanges vers un stockage durable pour
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
// Plafond de questions gratuites À VIE par visiteur (essai unique) —
// décision de Dim le 5 oct. 2026. La variable d'environnement garde son
// nom historique (…_PER_DAY), mais elle plafonne le total à vie.
const FREE_LIMIT = parseInt(process.env.HISTORIAN_FREE_PER_DAY || '3', 10) || 3;
const API_TIMEOUT_MS = 25000;

/* Phase 2 — packs payés (Stripe Checkout hébergé + crédits Netlify Blobs).
 * Spec verrouillée par Dim le 4 oct. 2026 : 20 questions / 3,00 $ USD. */
const STRIPE_SECRET_KEY = process.env.HISTORIAN_STRIPE_SECRET_KEY || '';
// Le prix n'est pas un secret : valeur par défaut en dur (l'API Netlify a
// refusé la création de la variable — 404 — le 4 oct. 2026) ; la variable
// d'environnement, si elle est créée un jour, a préséance.
const STRIPE_PRICE_ID = process.env.HISTORIAN_STRIPE_PRICE_ID || 'price_1UN05PRsVpQoafikMPDoa4aq';
const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const PACK_QUESTIONS = 20;
const PACK_AMOUNT_CENTS = 300; // garde-fou à la vérification d'une session
const SITE_ORIGIN = 'https://cryptot.shop';

function packsConfigured() {
  return !!(STRIPE_SECRET_KEY && STRIPE_PRICE_ID);
}

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

// Statuts actuels documentés (sections « Current status » des briefs,
// datées du 4 oct. 2026) — injectés en dur comme les ATH : le modèle doit
// répondre les faits datés d'abord, et ne refuser que la prédiction.
const STATUS_FACTS = {
  btc: 'U.S. spot Bitcoin ETFs have been trading since January 2024 (approved January 10, 2024).',
  eth: 'U.S. spot ether ETFs have been trading since July 2024. As of October 4, 2026, staking inside the major spot ether ETFs is NOT yet approved — amendments proposing it (Fidelity FETH, August 12, 2026; Bitwise, September 2026) are filed and pending.',
  ada: 'As of October 4, 2026, there is NO U.S. spot Cardano ETF trading. Grayscale withdrew its Cardano Trust ETF filing (S-1) on August 7, 2026 — a sponsor withdrawal (Form RW), NOT an SEC rejection. Regulated ADA futures launched on the CME on February 9, 2026 and passed the six-month mark on August 9, 2026. ADA is a small slice (~0.8%) of Grayscale\'s GDLC index ETF.',
  sol: 'U.S. spot Solana ETFs ARE trading: first REX-Osprey SSK (July 2, 2025, with staking), then the big spot funds from October 2025 (Bitwise BSOL, Grayscale GSOL, Fidelity FSOL, Morgan Stanley MSOL) — seven U.S. funds.',
  xrp: 'U.S. spot XRP ETFs ARE trading since November 2025 (first: Canary XRPC, Nasdaq, November 13, 2025; seven funds, ~$1.79B cumulative inflows by late September 2026). On March 17, 2026, the SEC and CFTC classified XRP as a digital commodity.'
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
    limit: "And that closes the free reading — you have used your 3 free questions, and your pack is empty. Pick up a pack of 20 questions below and we keep going.",
    trouble: "Hmm — a page seems stuck in the archives. Give me a moment to sort my notes and ask me again."
  },
  fr: {
    demo: "Ah, un visiteur ! Pardonne la poussière — mes archives sont encore en préparation, volume par volume. Reviens très bientôt et je te raconterai toute l'histoire de ce coin, en langage clair, comme elle mérite d'être racontée.",
    limit: "Et voilà qui conclut la lecture gratuite — tu as utilisé tes 3 questions gratuites, et ton pack est vide. Prends un pack de 20 questions ci-dessous et on continue.",
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

  // Statut actuel documenté : même traitement que l'ATH — fait d'abord.
  if (STATUS_FACTS[coin]) {
    parts.push('\n---\nDOCUMENTED STATUS — ' + COIN_NAMES[coin] + ', as of October 4, 2026: ' + STATUS_FACTS[coin] +
      ' When a visitor asks about the current state of things (ETFs, approvals, listings), answer with these dated facts FIRST, opening with "As of October 2026…". Refuse ONLY the prediction part of a question (what WILL happen) — never the factual part.');
  } else if (coin === 'general') {
    parts.push('\n---\nDOCUMENTED STATUS — as of October 4, 2026: Bitcoin: ' + STATUS_FACTS.btc + ' Ethereum: ' +
      STATUS_FACTS.eth + ' Cardano: ' + STATUS_FACTS.ada + ' Solana: ' + STATUS_FACTS.sol + ' XRP: ' + STATUS_FACTS.xrp +
      ' When a visitor asks about the current state of things (ETFs, approvals, listings), answer with these dated facts FIRST, opening with "As of October 2026…". Refuse ONLY the prediction part of a question (what WILL happen) — never the factual part.');
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
 * Compteur de questions gratuites : voir la section Netlify Blobs    *
 * plus bas — compteur DURABLE (clé « free/<id> »), 3 questions À VIE  *
 * par visiteur depuis le 5 oct. 2026 (décision de Dim). L'ancienne    *
 * Map en mémoire (plafond quotidien) a été retirée : elle se          *
 * réinitialisait à chaque démarrage à froid, donc le « par jour »     *
 * fuyait — un visiteur patient récupérait 3 questions sans fin.       *
 * ------------------------------------------------------------------ */

// Petit hachage non crypto — juste pour ne pas journaliser l'identifiant brut.
function shortHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return 'v' + (h >>> 0).toString(36);
}

/* ------------------------------------------------------------------ *
 * Crédits payés + compteur gratuit — Netlify Blobs (magasin           *
 * « historian-credits »).                                             *
 *                                                                     *
 * Clés : « visitor/<id> » → {credits, updatedAt}                      *
 *        « session/<id> » → {visitorId, questions, creditedAt}        *
 *        « free/<id> »    → {used, updatedAt} — compteur des          *
 *        questions gratuites, DURABLE depuis le 5 oct. 2026 : modèle  *
 *        « 3 questions gratuites À VIE par visiteur » (essai unique,  *
 *        décision de Dim) ; avant, une Map en mémoire plafonnée par   *
 *        jour se réinitialisait à chaque démarrage à froid.           *
 * Le registre des sessions est le verrou d'idempotence : un paiement  *
 * ne crédite qu'une fois, même si le visiteur réclame deux fois.     *
 *                                                                     *
 * Chargement PARESSEUX et tolérant : si le SDK ou le magasin est      *
 * indisponible, les crédits tombent à 0 et TOUT le reste (questions   *
 * gratuites) continue de fonctionner — jamais de crash.               *
 * ------------------------------------------------------------------ */
let blobsStore = null;
let blobsTried = false;

function getCreditStore() {
  if (blobsTried) return blobsStore;
  blobsTried = true;
  try {
    const { getStore } = require('@netlify/blobs');
    blobsStore = getStore('historian-credits');
  } catch (err) {
    console.log(JSON.stringify({ type: 'historian_blobs_unavailable', error: String(err && err.message || err) }));
    blobsStore = null;
  }
  return blobsStore;
}

function visitorKey(visitorId) { return 'visitor/' + encodeURIComponent(visitorId); }
function sessionKey(sessionId) { return 'session/' + encodeURIComponent(sessionId); }
function freeKey(visitorId) { return 'free/' + encodeURIComponent(visitorId); }

async function getCredits(visitorId) {
  const store = getCreditStore();
  if (!store) return 0;
  try {
    const rec = await store.get(visitorKey(visitorId), { type: 'json' });
    return rec && typeof rec.credits === 'number' && rec.credits > 0 ? Math.floor(rec.credits) : 0;
  } catch (err) {
    console.log(JSON.stringify({ type: 'historian_blobs_error', op: 'getCredits', error: String(err && err.message || err) }));
    return 0;
  }
}

async function setCredits(visitorId, credits) {
  const store = getCreditStore();
  if (!store) return false;
  try {
    await store.setJSON(visitorKey(visitorId), { credits: credits, updatedAt: new Date().toISOString() });
    return true;
  } catch (err) {
    console.log(JSON.stringify({ type: 'historian_blobs_error', op: 'setCredits', error: String(err && err.message || err) }));
    return false;
  }
}

// Débite un crédit APRÈS une réponse réussie. Renvoie false si le solde
// était vide ou si le magasin est indisponible (journalisé, jamais fatal).
async function spendCredit(visitorId) {
  const current = await getCredits(visitorId);
  if (current <= 0) return false;
  return setCredits(visitorId, current - 1);
}

// Nombre de questions gratuites déjà utilisées par ce visiteur —
// compteur À VIE (pas de remise à zéro quotidienne ni au démarrage).
// Lecture = max(Blobs, cache mémoire de l'instance) : Blobs donne la
// durabilité (le compteur survit aux démarrages à froid), le cache
// donne l'exactitude immédiate sur une instance chaude — la lecture
// Blobs seule est à cohérence éventuelle (propagation jusqu'à ~60 s,
// constatée en tests live le 5 oct. 2026 : deux questions rapides
// d'affilée pouvaient lire un compteur périmé et fuir). Les lectures
// « strong » du SDK retournent vide dans ce runtime Lambda (testé le
// même jour), d'où cette superposition plutôt qu'un mode du magasin.
const freeMemCache = new Map(); // visitorId -> used (miroir chaud de Blobs)

async function getFreeUsed(visitorId) {
  const store = getCreditStore();
  let blobsUsed = 0;
  if (store) {
    try {
      const rec = await store.get(freeKey(visitorId), { type: 'json' });
      if (rec && typeof rec.used === 'number' && rec.used > 0) blobsUsed = Math.floor(rec.used);
    } catch (err) {
      console.log(JSON.stringify({ type: 'historian_blobs_error', op: 'getFreeUsed', error: String(err && err.message || err) }));
    }
  }
  const used = Math.max(blobsUsed, freeMemCache.get(visitorId) || 0);
  if (freeMemCache.size > 5000) freeMemCache.clear(); // borne simple
  freeMemCache.set(visitorId, used);
  return used;
}

// Incrémente le compteur gratuit APRÈS une réponse réussie (même règle
// que les crédits : un appel au modèle qui échoue ne coûte rien).
async function incrementFreeUsed(visitorId) {
  const used = (await getFreeUsed(visitorId)) + 1;
  freeMemCache.set(visitorId, used);
  const store = getCreditStore();
  if (!store) return false;
  try {
    await store.setJSON(freeKey(visitorId), { used: used, updatedAt: new Date().toISOString() });
    return true;
  } catch (err) {
    console.log(JSON.stringify({ type: 'historian_blobs_error', op: 'incrementFreeUsed', error: String(err && err.message || err) }));
    return false;
  }
}

// Crédite un pack pour une session Stripe vérifiée — idempotent.
// Renvoie {credited: bool, already: bool, credits: solde résultant}.
async function creditPackForSession(visitorId, sessionId) {
  const store = getCreditStore();
  if (!store) return { credited: false, already: false, credits: 0 };
  try {
    const existing = await store.get(sessionKey(sessionId), { type: 'json' });
    if (existing) {
      return { credited: false, already: true, credits: await getCredits(visitorId) };
    }
    // Le registre d'abord (le verrou), puis le solde.
    await store.setJSON(sessionKey(sessionId), {
      visitorId: visitorId, questions: PACK_QUESTIONS, creditedAt: new Date().toISOString()
    });
    const balance = (await getCredits(visitorId)) + PACK_QUESTIONS;
    await setCredits(visitorId, balance);
    return { credited: true, already: false, credits: balance };
  } catch (err) {
    console.log(JSON.stringify({ type: 'historian_blobs_error', op: 'creditPack', error: String(err && err.message || err) }));
    return { credited: false, already: false, credits: await getCredits(visitorId) };
  }
}

/* ------------------------------------------------------------------ *
 * Stripe — appels REST directs (form-encoded), clé secrète côté       *
 * serveur seulement. Création + lecture de sessions Checkout.         *
 * ------------------------------------------------------------------ */
async function stripeRequest(method, pathStripe, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const opts = {
      method: method,
      signal: controller.signal,
      headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY }
    };
    if (params) {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.body = params.toString();
    }
    const res = await fetch(STRIPE_API_BASE + pathStripe, opts);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : ('HTTP ' + res.status);
      throw new Error('Stripe: ' + msg);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Crée la session Checkout hébergée du pack pour ce visiteur.
// returnPath : chemin de la page de test (validé par l'appelant).
async function createPackCheckout(visitorId, lang, returnPath) {
  const sep = returnPath.indexOf('?') === -1 ? '?' : '&';
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('line_items[0][price]', STRIPE_PRICE_ID);
  params.set('line_items[0][quantity]', '1');
  params.set('client_reference_id', visitorId);
  params.set('metadata[visitorId]', visitorId);
  params.set('metadata[product]', 'historian_pack_20');
  params.set('metadata[questions]', String(PACK_QUESTIONS));
  params.set('payment_intent_data[metadata][visitorId]', visitorId);
  params.set('locale', lang === 'fr' ? 'fr' : 'en');
  params.set('success_url', SITE_ORIGIN + returnPath + sep + 'cth_checkout=success&session_id={CHECKOUT_SESSION_ID}');
  params.set('cancel_url', SITE_ORIGIN + returnPath + sep + 'cth_checkout=cancelled');
  const session = await stripeRequest('POST', '/checkout/sessions', params);
  return session;
}

// Vérifie une session auprès de Stripe : payée, bon montant, bon visiteur.
// Ne fait JAMAIS confiance au seul retour du navigateur.
function sessionMatchesPack(session, visitorId) {
  if (!session || typeof session !== 'object') return false;
  if (session.mode !== 'payment') return false;
  if (session.payment_status !== 'paid') return false;
  if (session.amount_total !== PACK_AMOUNT_CENTS) return false;
  if (session.currency !== 'usd') return false;
  const metaVisitor = session.metadata && session.metadata.visitorId;
  return session.client_reference_id === visitorId || metaVisitor === visitorId;
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
  /* Netlify Blobs en mode Lambda (v1) : brancher le contexte de
   * l'événement AVANT tout usage du magasin de crédits — sans cet
   * appel, getStore() échoue (erreur attrapée en silence) et les
   * crédits payés ne sont ni lus ni écrits. Bug vécu le 5 oct. 2026 :
   * achat réel de 3 $ vérifié chez Stripe, solde resté à 0.
   * Échec toléré : on journalise et on continue — les questions
   * gratuites ne dépendent pas de Blobs. */
  try {
    const netlifyBlobs = require('@netlify/blobs');
    if (typeof netlifyBlobs.connectLambda === 'function') {
      netlifyBlobs.connectLambda(event);
    }
  } catch (err) {
    console.log(JSON.stringify({ type: 'historian_blobs_connect_failed', error: String(err && err.message || err) }));
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed', remaining: FREE_LIMIT });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: 'invalid_json', remaining: FREE_LIMIT });
  }

  const coin = VALID_COINS.indexOf(String(body.coin || '').toLowerCase()) !== -1
    ? String(body.coin).toLowerCase() : 'general';
  const lang = body.lang === 'fr' ? 'fr' : 'en';
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1000) : '';
  const history = sanitizeHistory(body.history);
  const visitorId = (typeof body.visitorId === 'string' && body.visitorId.length <= 64)
    ? body.visitorId
    : 'anon-' + ((event.headers && (event.headers['x-forwarded-for'] || event.headers['client-ip'])) || 'unknown');

  /* --- Actions phase 2 (aucun message requis) -------------------------
   * balance  : solde du visiteur (quota gratuit restant + crédits).
   * checkout : crée la session Stripe Checkout du pack.
   * claim    : vérifie une session payée et crédite le pack (idempotent). */
  const action = typeof body.action === 'string' ? body.action : '';
  const freeLeftNow = Math.max(0, FREE_LIMIT - (await getFreeUsed(visitorId)));

  if (action === 'balance') {
    return jsonResponse(200, {
      remaining: freeLeftNow,
      credits: await getCredits(visitorId),
      canBuy: packsConfigured()
    });
  }

  if (action === 'checkout') {
    if (!packsConfigured()) {
      return jsonResponse(200, { error: 'packs_not_configured', canBuy: false });
    }
    let returnPath = typeof body.returnPath === 'string' ? body.returnPath : '';
    if (!/^\/(?!\/)[A-Za-z0-9\-._~/?&=%]*$/.test(returnPath)) returnPath = '/historian-test';
    try {
      const session = await createPackCheckout(visitorId, lang, returnPath);
      console.log(JSON.stringify({ type: 'historian_checkout_created', ts: new Date().toISOString(), visitor: shortHash(visitorId), session: session.id }));
      return jsonResponse(200, { checkoutUrl: session.url, sessionId: session.id, canBuy: true });
    } catch (err) {
      console.log(JSON.stringify({ type: 'historian_checkout_error', ts: new Date().toISOString(), error: String(err && err.message || err) }));
      return jsonResponse(200, { error: 'checkout_failed', canBuy: true });
    }
  }

  if (action === 'claim') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId)) {
      return jsonResponse(400, { error: 'invalid_session', credited: false });
    }
    if (!packsConfigured()) {
      return jsonResponse(200, { error: 'packs_not_configured', credited: false, canBuy: false });
    }
    try {
      const session = await stripeRequest('GET', '/checkout/sessions/' + encodeURIComponent(sessionId), null);
      if (!sessionMatchesPack(session, visitorId)) {
        console.log(JSON.stringify({ type: 'historian_claim_rejected', ts: new Date().toISOString(), visitor: shortHash(visitorId), session: sessionId }));
        return jsonResponse(200, { credited: false, error: 'payment_not_verified', credits: await getCredits(visitorId), canBuy: true });
      }
      const result = await creditPackForSession(visitorId, sessionId);
      if (result.credited) {
        console.log(JSON.stringify({ type: 'historian_credits_granted', ts: new Date().toISOString(), visitor: shortHash(visitorId), session: sessionId, questions: PACK_QUESTIONS, credits: result.credits }));
      }
      return jsonResponse(200, {
        credited: result.credited, alreadyCredited: result.already,
        credits: result.credits, remaining: freeLeftNow, canBuy: true
      });
    } catch (err) {
      console.log(JSON.stringify({ type: 'historian_claim_error', ts: new Date().toISOString(), error: String(err && err.message || err) }));
      return jsonResponse(200, { credited: false, error: 'claim_failed', credits: await getCredits(visitorId), canBuy: true });
    }
  }

  if (!message) {
    return jsonResponse(400, { error: 'empty_message', remaining: freeLeftNow });
  }

  const msgs = OFFLINE_MESSAGES[lang];
  const used = await getFreeUsed(visitorId);
  const remainingBefore = Math.max(0, FREE_LIMIT - used);

  /* --- Quota gratuit épuisé ET pack vide ------------------------------
   * La dépense se fait dans cet ordre : gratuit d'abord, crédits du
   * pack ensuite. Si les deux sont à zéro, on s'arrête ici — le widget
   * offre alors le pack (canBuy) sous ce message. */
  const creditsBefore = await getCredits(visitorId);
  if (remainingBefore <= 0 && creditsBefore <= 0) {
    logExchange({ visitor: shortHash(visitorId), coin: coin, lang: lang, limited: true, question: message.slice(0, 200) });
    return jsonResponse(200, { answer: msgs.limit, remaining: 0, credits: 0, limited: true, canBuy: packsConfigured() });
  }

  /* --- Mode démo hors-ligne (clé ou base API absente) ------------------
   * Le visiteur ne perd pas de question : rien n'est débité. */
  if (!API_KEY || !API_BASE) {
    logExchange({ visitor: shortHash(visitorId), coin: coin, lang: lang, demo: true, question: message.slice(0, 200) });
    return jsonResponse(200, { answer: msgs.demo, remaining: remainingBefore, credits: creditsBefore, demo: true, canBuy: packsConfigured() });
  }

  /* --- Appel réel au modèle ------------------------------------------ */
  try {
    // Couche temps réel : seulement rendue ici (le mode démo et le quota
    // épuisé n'appellent ni le modèle ni l'API de prix — zéro coût inutile).
    const liveBlock = await maybeFetchLiveData(coin, message);
    const systemPrompt = buildSystemPrompt(coin, lang, liveBlock);
    const result = await callModel(systemPrompt, history, message);
    // Réponse réussie seulement qu'on débite : gratuit d'abord, sinon
    // un crédit du pack (le quota gratuit était épuisé mais le pack
    // avait des crédits — vérifié plus haut).
    let paidWith = 'free';
    if (remainingBefore > 0) {
      await incrementFreeUsed(visitorId);
    } else {
      await spendCredit(visitorId);
      paidWith = 'credit';
    }
    const remaining = Math.max(0, FREE_LIMIT - (await getFreeUsed(visitorId)));
    const credits = await getCredits(visitorId);
    logExchange({
      visitor: shortHash(visitorId), coin: coin, lang: lang,
      question: message.slice(0, 200),
      paidWith: paidWith,
      liveData: !!liveBlock,
      promptTokens: result.usage ? result.usage.prompt_tokens : null,
      completionTokens: result.usage ? result.usage.completion_tokens : null,
      estCostUsd: estimateCostUsd(result.usage)
    });
    return jsonResponse(200, { answer: result.answer, remaining: remaining, credits: credits, canBuy: packsConfigured() });
  } catch (err) {
    // Échec de NOTRE côté : le visiteur ne perd pas sa question, et il
    // reçoit un mot du personnage plutôt qu'une erreur technique.
    console.log(JSON.stringify({ type: 'historian_api_error', ts: new Date().toISOString(), error: String(err && err.message || err) }));
    return jsonResponse(200, { answer: msgs.trouble, remaining: remainingBefore, credits: creditsBefore, error: true, canBuy: packsConfigured() });
  }
};
