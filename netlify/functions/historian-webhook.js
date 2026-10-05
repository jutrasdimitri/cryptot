/* ==========================================================================
   The Crypto Historian — Webhook Stripe (Netlify Function)
   --------------------------------------------------------------------------
   Rôle : recevoir les événements Stripe signés et créditer les packs de
   questions CÔTÉ SERVEUR, même si le navigateur de l'acheteur ne revient
   jamais de la page de paiement hébergée (panne de redirection vécue le
   5 oct. 2026 : paiement réussi, crédits jamais livrés jusqu'à la
   réclamation manuelle).

   Événement traité : checkout.session.completed seulement.
   Chaîne de confiance, dans l'ordre :
     1. Signature Stripe vérifiée à la main (HMAC-SHA256 sur
        « <timestamp>.<corps brut> », tolérance 5 minutes, comparaison
        à temps constant) avec HISTORIAN_STRIPE_WEBHOOK_SECRET.
        Sans cette variable, le point d'entrée est INERTE : tout est
        rejeté en 400 (historian_webhook_rejected).
     2. La session est RE-VÉRIFIÉE auprès de Stripe avec la clé
        secrète serveur (payée, 300 ¢ USD, bon visiteur) — mêmes
        règles que le « claim » de historian.js.
     3. Crédit idempotent via le registre Blobs « session/<id> » —
        le même verrou que le parcours claim : webhook + claim
        peuvent se croiser sans jamais créditer deux fois.

   Cette fonction ne répond JAMAIS à des questions : aucun appel au
   modèle. Note cohérence Blobs : les lectures « strong » (au niveau
   magasin OU par opération) ont été testées le 5 oct. 2026 dans ce
   runtime Lambda et renvoient vide (solde lu 0) — le magasin est donc
   utilisé en cohérence éventuelle, EXACTEMENT comme le parcours
   claim de historian.js, dont l'idempotence a été prouvée en réel.

   Variables d'environnement :
     HISTORIAN_STRIPE_SECRET_KEY     (déjà en place — re-vérification)
     HISTORIAN_STRIPE_WEBHOOK_SECRET (secret de signature de CE point
                                      d'entrée webhook, créé dans le
                                      tableau de bord Stripe)
   ========================================================================== */

'use strict';

const crypto = require('crypto');

const STRIPE_SECRET_KEY = process.env.HISTORIAN_STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.HISTORIAN_STRIPE_WEBHOOK_SECRET || '';
const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const PACK_QUESTIONS = 20;
const PACK_AMOUNT_CENTS = 300; // même garde-fou que historian.js
const SIGNATURE_TOLERANCE_SEC = 300; // 5 minutes, comme Stripe

/* ------------------------------------------------------------------ *
 * Crédits payés — Netlify Blobs (magasin « historian-credits »).      *
 *                                                                     *
 * DUPLIQUÉ de historian.js À DESSEIN : aucun import partagé entre     *
 * fonctions Netlify (bundling indépendant, zéro risque de casser la   *
 * fonction qui répond aux questions). Toute correction du format des  *
 * clés ou du verrou d'idempotence doit être appliquée AUX DEUX        *
 * fichiers.                                                           *
 *                                                                     *
 * Clés : « visitor/<id> » → {credits, updatedAt}                      *
 *        « session/<id> » → {visitorId, questions, creditedAt}       *
 * Cohérence éventuelle (défaut Blobs), comme historian.js : les       *
 * lectures « strong » renvoient vide dans ce runtime (testé 5 oct.).  *
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

async function getCredits(visitorId) {
  const store = getCreditStore();
  if (!store) return 0;
  try {
    const rec = await store.get(visitorKey(visitorId), { type: 'json' });
    return rec && typeof rec.credits === 'number' && rec.credits > 0 ? Math.floor(rec.credits) : 0;
  } catch (err) {
    console.log(JSON.stringify({ type: 'historian_blobs_error', op: 'webhookGetCredits', error: String(err && err.message || err) }));
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
    console.log(JSON.stringify({ type: 'historian_blobs_error', op: 'webhookSetCredits', error: String(err && err.message || err) }));
    return false;
  }
}

// Crédite un pack pour une session Stripe vérifiée — idempotent.
// Même contrat que historian.js : {credited, already, credits}.
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
      visitorId: visitorId, questions: PACK_QUESTIONS, creditedAt: new Date().toISOString(),
      source: 'webhook'
    });
    const balance = (await getCredits(visitorId)) + PACK_QUESTIONS;
    await setCredits(visitorId, balance);
    return { credited: true, already: false, credits: balance };
  } catch (err) {
    console.log(JSON.stringify({ type: 'historian_blobs_error', op: 'webhookCreditPack', error: String(err && err.message || err) }));
    return { credited: false, already: false, credits: await getCredits(visitorId) };
  }
}

/* ------------------------------------------------------------------ *
 * Stripe — lecture REST directe (clé secrète côté serveur seulement) *
 * et vérification des sessions. Dupliqué de historian.js, à dessein. *
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

// Mêmes règles que historian.js : payée, bon montant, bon visiteur.
// Ne fait JAMAIS confiance au seul contenu de l'événement reçu.
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
 * Signature Stripe — vérification manuelle (aucun SDK).              *
 * Schéma : Stripe-Signature: t=<ts>,v1=<hex>[,v1=<hex>...]           *
 * Attendu : v1 = HMAC-SHA256(secret, "<ts>.<corps brut>") en hex.    *
 * Le corps doit être les octets EXACTS reçus — jamais de JSON         *
 * re-sérialisé.                                                       *
 * ------------------------------------------------------------------ */
function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!rawBody || !signatureHeader || typeof signatureHeader !== 'string' || !secret) return false;
  let timestamp = null;
  const signatures = [];
  for (const part of signatureHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > SIGNATURE_TOLERANCE_SEC) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(timestamp + '.' + rawBody, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

function jsonResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}

/* ------------------------------------------------------------------ *
 * Handler Netlify                                                     *
 * ------------------------------------------------------------------ */
exports.handler = async function (event) {
  /* Netlify Blobs en mode Lambda (v1) : brancher le contexte de
   * l'événement AVANT tout usage du magasin de crédits (même
   * correctif que historian.js, vécu le 5 oct. 2026). Échec toléré :
   * on journalise et on continue — la vérification de signature,
   * elle, ne dépend pas de Blobs. */
  try {
    const netlifyBlobs = require('@netlify/blobs');
    if (typeof netlifyBlobs.connectLambda === 'function') {
      netlifyBlobs.connectLambda(event);
    }
  } catch (err) {
    console.log(JSON.stringify({ type: 'historian_blobs_connect_failed', error: String(err && err.message || err) }));
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // Corps BRUT : la signature porte sur les octets exacts reçus.
  let rawBody = typeof event.body === 'string' ? event.body : '';
  if (event.isBase64Encoded && rawBody) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  }

  const headers = event.headers || {};
  const signature = headers['stripe-signature'] || headers['Stripe-Signature'] || '';

  // Point d'entrée inerte tant que le secret de signature n'est pas
  // installé : rejet propre en 400, jamais de traitement.
  if (!WEBHOOK_SECRET || !verifyStripeSignature(rawBody, signature, WEBHOOK_SECRET)) {
    console.log(JSON.stringify({
      type: 'historian_webhook_rejected', ts: new Date().toISOString(),
      reason: WEBHOOK_SECRET ? 'invalid_signature' : 'webhook_secret_not_configured'
    }));
    return jsonResponse(400, { error: 'invalid_signature' });
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch (err) {
    console.log(JSON.stringify({ type: 'historian_webhook_rejected', ts: new Date().toISOString(), reason: 'invalid_json' }));
    return jsonResponse(400, { error: 'invalid_payload' });
  }

  console.log(JSON.stringify({
    type: 'historian_webhook_received', ts: new Date().toISOString(),
    eventId: stripeEvent.id || null, eventType: stripeEvent.type || null
  }));

  // Seul cet événement nous concerne ; tout le reste est accusé
  // réception en 200 pour que Stripe n'essaie pas de le relivrer.
  if (stripeEvent.type !== 'checkout.session.completed') {
    return jsonResponse(200, { received: true, handled: false });
  }

  try {
    const sessionObj = (stripeEvent.data && stripeEvent.data.object) || {};
    const sessionId = typeof sessionObj.id === 'string' ? sessionObj.id : '';
    const visitorId =
      (typeof sessionObj.client_reference_id === 'string' && sessionObj.client_reference_id) ||
      (sessionObj.metadata && typeof sessionObj.metadata.visitorId === 'string' && sessionObj.metadata.visitorId) ||
      '';

    // Rien à créditer (session ou visiteur absent) : 200, jamais de
    // boucle d'erreur — on journalise et on passe.
    if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId) || !visitorId || visitorId.length > 64) {
      console.log(JSON.stringify({
        type: 'historian_webhook_noop', ts: new Date().toISOString(),
        eventId: stripeEvent.id || null, reason: 'missing_session_or_visitor'
      }));
      return jsonResponse(200, { received: true, handled: false });
    }

    // Défense en profondeur : re-vérification de la session auprès de
    // Stripe avec la clé serveur, PAR-DESSUS la signature.
    let session;
    try {
      session = await stripeRequest('GET', '/checkout/sessions/' + encodeURIComponent(sessionId), null);
    } catch (err) {
      // Échec réel (Stripe injoignable) : 500 → Stripe réessaiera.
      console.log(JSON.stringify({
        type: 'historian_webhook_verify_failed', ts: new Date().toISOString(),
        session: sessionId, error: String(err && err.message || err)
      }));
      return jsonResponse(500, { error: 'verification_unavailable' });
    }
    if (!sessionMatchesPack(session, visitorId)) {
      // Session signée mais non conforme (non payée, autre montant,
      // autre visiteur) : on n'accuse pas d'échec à Stripe — 200,
      // journalisé, rien à créditer.
      console.log(JSON.stringify({
        type: 'historian_webhook_verify_failed', ts: new Date().toISOString(),
        session: sessionId, reason: 'session_mismatch'
      }));
      return jsonResponse(200, { received: true, handled: false });
    }

    // Crédit idempotent : le même verrou « session/<id> » que le claim.
    const result = await creditPackForSession(visitorId, sessionId);
    if (result.already) {
      console.log(JSON.stringify({
        type: 'historian_webhook_already_credited', ts: new Date().toISOString(),
        session: sessionId, credits: result.credits
      }));
      return jsonResponse(200, { received: true, handled: true, alreadyCredited: true });
    }
    if (!result.credited) {
      // Le magasin de crédits n'a pas répondu : échec réel → 500,
      // Stripe réessaiera et le verrou rendra la reprise sûre.
      console.log(JSON.stringify({
        type: 'historian_webhook_verify_failed', ts: new Date().toISOString(),
        session: sessionId, reason: 'credit_store_unavailable'
      }));
      return jsonResponse(500, { error: 'credit_failed' });
    }
    console.log(JSON.stringify({
      type: 'historian_webhook_credited', ts: new Date().toISOString(),
      session: sessionId, questions: PACK_QUESTIONS, credits: result.credits
    }));
    return jsonResponse(200, { received: true, handled: true, credited: true });
  } catch (err) {
    console.log(JSON.stringify({
      type: 'historian_webhook_error', ts: new Date().toISOString(),
      error: String(err && err.message || err)
    }));
    return jsonResponse(500, { error: 'internal_error' });
  }
};
