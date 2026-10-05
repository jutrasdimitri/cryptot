/* ==========================================================================
   The Crypto Historian — widget de chat (cryptot.shop)
   Vanilla JS, aucun framework, aucune dépendance.

   Inclusion sur une page (une seule ligne suffit) :
     <script src="/assets/historian/historian-widget.js"
             data-coin="ada" data-lang="fr" defer></script>

   - data-coin : btc | eth | ada | sol | xrp | general  (contexte de la page)
   - data-lang : en | fr                                (langue de l'interface)
   - data-api  : (optionnel) URL de la fonction — défaut « /api/historian »

   Le widget charge lui-même son CSS compagnon (historian-widget.css, même
   dossier que le script) si la page ne l'a pas déjà inclus.
   Tout le DOM et tous les styles sont scopés sous la classe racine .cth-root.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Configuration — lue sur le tag <script> qui inclut ce fichier.     *
   * ------------------------------------------------------------------ */
  function findOwnScript() {
    if (document.currentScript) return document.currentScript;
    // Repli : chercher un script dont le src contient notre nom de fichier.
    var scripts = document.querySelectorAll('script[src*="historian-widget"]');
    return scripts.length ? scripts[scripts.length - 1] : null;
  }

  var scriptEl = findOwnScript();
  var VALID_COINS = ['btc', 'eth', 'ada', 'sol', 'xrp', 'general'];

  var config = {
    coin: 'general',
    lang: 'en',
    api: '/api/historian',
    scriptSrc: scriptEl ? scriptEl.getAttribute('src') : ''
  };

  if (scriptEl) {
    var c = (scriptEl.getAttribute('data-coin') || '').toLowerCase();
    if (VALID_COINS.indexOf(c) !== -1) config.coin = c;
    var l = (scriptEl.getAttribute('data-lang') || '').toLowerCase();
    if (l === 'fr' || l === 'en') config.lang = l;
    var api = scriptEl.getAttribute('data-api');
    if (api) config.api = api;
  }

  /* ------------------------------------------------------------------ *
   * Textes d'interface (EN / FR) et contenu par coin.                   *
   * ------------------------------------------------------------------ */
  var COIN_NAMES = {
    btc: 'Bitcoin', eth: 'Ethereum', ada: 'Cardano',
    sol: 'Solana', xrp: 'XRP', general: 'Power 5'
  };

  var I18N = {
    en: {
      launcher: 'Ask the Historian',
      title: 'The Crypto Historian',
      subtitleCoin: function (name) { return 'Historian of ' + name; },
      subtitleGeneral: 'Historian of the Power 5',
      greetingCoin: function (name) {
        return 'Welcome to the ' + name + ' wing of the archives. I know its story by heart — the founders, the crashes, the legends. Ask me anything: I teach, I never predict.';
      },
      greetingGeneral: 'Welcome to the archives. Five coins, five wild stories — Bitcoin, Ethereum, Cardano, Solana and XRP. Ask me anything about their history: I teach, I never predict.',
      presetsLabel: 'Start with a classic:',
      placeholder: 'Ask a question…',
      send: 'Send',
      close: 'Close',
      counterFree: 'free trial questions',
      counterLeft: function (n) { return n + ' free question' + (n === 1 ? '' : 's') + ' left'; },
      counterDone: 'Your 3 free questions are used up',
      thinking: 'Digging through the archives…',
      errorNet: 'The archives are dusty right now — give me a moment and try again.',
      footer: 'Powered by Mimi · Education, not financial advice',
      creditsLeft: function (n) { return n + ' pack question' + (n === 1 ? '' : 's') + ' left'; },
      buyPack: 'Get 20 questions — $3',
      buyNote: 'One pack = 20 extra questions · Secure checkout by Stripe',
      packsSoon: 'Question packs are coming very soon.',
      verifying: 'Welcome back — let me check the register for your payment…',
      creditedMsg: function (n) { return 'Payment confirmed in the register: ' + n + ' questions are now in your pack. Ask away!'; },
      alreadyMsg: 'That payment was already added to your pack — your balance is up to date.',
      cancelledMsg: 'No harm done — the checkout was cancelled and nothing was charged.',
      checkoutError: 'The register jammed for a moment — the pack could not be opened. Nothing was charged; try again in a minute.',
      notVerified: 'I could not confirm that payment in the register yet. If you completed it, give it a moment and reopen this panel.'
    },
    fr: {
      launcher: "Demande à l'Historien",
      title: 'The Crypto Historian',
      subtitleCoin: function (name) { return 'Historien de ' + name; },
      subtitleGeneral: 'Historien des Power 5',
      greetingCoin: function (name) {
        return "Bienvenue dans l'aile " + name + ' des archives. Je connais son histoire par cœur — les fondateurs, les crashs, les légendes. Pose-moi n\'importe quelle question : j\'enseigne, je ne prédis jamais.';
      },
      greetingGeneral: "Bienvenue aux archives. Cinq coins, cinq histoires folles — Bitcoin, Ethereum, Cardano, Solana et XRP. Pose-moi n'importe quelle question sur leur histoire : j'enseigne, je ne prédis jamais.",
      presetsLabel: 'Commence par un classique :',
      placeholder: 'Pose ta question…',
      send: 'Envoyer',
      close: 'Fermer',
      counterFree: 'questions gratuites pour essayer',
      counterLeft: function (n) { return n + ' question' + (n === 1 ? '' : 's') + ' gratuite' + (n === 1 ? '' : 's') + " restante" + (n === 1 ? '' : 's'); },
      counterDone: 'Vos 3 questions gratuites sont écoulées',
      thinking: 'Je fouille les archives…',
      errorNet: 'Les archives sont poussiéreuses en ce moment — laisse-moi un instant et réessaie.',
      footer: 'Propulsé par Mimi · Éducation, pas des conseils financiers',
      creditsLeft: function (n) { return n + ' question' + (n === 1 ? '' : 's') + ' de pack restante' + (n === 1 ? '' : 's'); },
      buyPack: 'Obtenir 20 questions — 3 $',
      buyNote: 'Un pack = 20 questions de plus · Paiement sécurisé par Stripe',
      packsSoon: 'Les packs de questions arrivent très bientôt.',
      verifying: 'Bon retour — je vérifie ton paiement dans le registre…',
      creditedMsg: function (n) { return 'Paiement confirmé dans le registre : ' + n + ' questions sont maintenant dans ton pack. Vas-y, pose ta question !'; },
      alreadyMsg: 'Ce paiement a déjà été ajouté à ton pack — ton solde est à jour.',
      cancelledMsg: 'Aucun souci — le paiement a été annulé et rien n\'a été facturé.',
      checkoutError: 'Le registre a coincé un instant — le pack n\'a pas pu s\'ouvrir. Rien n\'a été facturé ; réessaie dans une minute.',
      notVerified: 'Je n\'ai pas encore pu confirmer ce paiement dans le registre. Si tu l\'as complété, laisse-lui un moment et rouvre ce panneau.'
    }
  };

  // Boutons « presets » par coin — les classiques de chaque histoire.
  var PRESETS = {
    btc: {
      en: ['Who is Satoshi?', 'What is the halving?', 'Tell me the pizza day story'],
      fr: ['Qui est Satoshi ?', "C'est quoi le halving ?", 'Raconte-moi le pizza day']
    },
    eth: {
      en: ['How was Ethereum born?', 'What was The DAO hack?', 'What did The Merge change?'],
      fr: ['Comment Ethereum est né ?', "C'est quoi le hack de The DAO ?", 'The Merge a changé quoi ?']
    },
    ada: {
      en: ['Tell me how Cardano was born', 'What is staking?', "Why do people say 'ghost chain'?"],
      fr: ['Raconte-moi la naissance de Cardano', "C'est quoi le staking ?", "Pourquoi on dit « ghost chain » ?"]
    },
    sol: {
      en: ['How did Solana start?', 'Tell me about the FTX crash days', 'Why is Solana known for speed?'],
      fr: ['Comment Solana a commencé ?', 'Raconte-moi les jours du crash FTX', 'Pourquoi Solana est réputée rapide ?']
    },
    xrp: {
      en: ['Ripple or XRP — what is the difference?', 'Tell me about the SEC lawsuit', 'How old is XRP, really?'],
      fr: ['Ripple ou XRP, quelle différence ?', 'Raconte-moi le procès de la SEC', 'XRP a quel âge, pour vrai ?']
    },
    general: {
      en: ['What is the Power 5?', 'Tell me the 2021 bull run story', 'What is a halving?'],
      fr: ["C'est quoi le Power 5 ?", 'Raconte-moi le bull run de 2021', "C'est quoi un halving ?"]
    }
  };

  var FREE_LIMIT = 3; // Miroir de l'UI seulement — la vérité vit côté serveur.

  /* ------------------------------------------------------------------ *
   * État interne                                                        *
   * ------------------------------------------------------------------ */
  var state = {
    opened: false,
    greeted: false,
    sending: false,
    remaining: null,     // null = pas encore confirmé par le serveur
    credits: null,       // questions du pack payé (null = inconnu)
    canBuy: false,       // les packs sont-ils achetables en ce moment ?
    balanceLoaded: false,
    history: []          // [{role: 'user'|'assistant', content: '...'}]
  };

  // Identifiant visiteur anonyme (sert au compteur côté serveur, prototype).
  function getVisitorId() {
    try {
      var key = 'cth_visitor_id';
      var id = window.localStorage.getItem(key);
      if (!id) {
        id = 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        window.localStorage.setItem(key, id);
      }
      return id;
    } catch (e) {
      return 'v-ephemeral';
    }
  }

  /* ------------------------------------------------------------------ *
   * Chargement du CSS compagnon (si la page ne l'a pas déjà fait).     *
   * ------------------------------------------------------------------ */
  function ensureCss() {
    if (document.querySelector('link[href*="historian-widget.css"]')) return;
    if (!config.scriptSrc) return;
    var cssHref = config.scriptSrc.replace(/historian-widget\.js(\?.*)?$/, 'historian-widget.css');
    if (cssHref === config.scriptSrc) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssHref;
    document.head.appendChild(link);
  }

  /* ------------------------------------------------------------------ *
   * Construction du DOM (tout est créé ici, scopé .cth-root).          *
   * ------------------------------------------------------------------ */
  var els = {};

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function build() {
    var t = I18N[config.lang];
    var coinName = COIN_NAMES[config.coin];

    var root = el('div', 'cth-root');
    root.setAttribute('data-cth-coin', config.coin);

    /* Panneau */
    var panel = el('div', 'cth-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t.title);

    var header = el('div', 'cth-header');
    var avatar = el('div', 'cth-avatar');
    var avatarImg = el('img', 'cth-avatar-img');
    avatarImg.src = '/assets/historian/historian-avatar.webp';
    avatarImg.alt = 'The Crypto Historian';
    avatar.appendChild(avatarImg);
    var headerText = el('div', 'cth-header-text');
    var title = el('div', 'cth-title', t.title);
    var subtitle = el('div', 'cth-subtitle',
      config.coin === 'general' ? t.subtitleGeneral : t.subtitleCoin(coinName));
    var closeBtn = el('button', 'cth-close', '✕');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', t.close);
    headerText.appendChild(title);
    headerText.appendChild(subtitle);
    header.appendChild(avatar);
    header.appendChild(headerText);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    var messages = el('div', 'cth-messages');
    panel.appendChild(messages);

    /* Presets */
    var presetsWrap = el('div', 'cth-presets');
    var presetsLabel = el('div', 'cth-presets-label', t.presetsLabel);
    var presetsRow = el('div', 'cth-presets-row');
    presetsWrap.appendChild(presetsLabel);
    presetsWrap.appendChild(presetsRow);
    (PRESETS[config.coin][config.lang] || []).forEach(function (q) {
      var b = el('button', 'cth-preset', q);
      b.type = 'button';
      b.addEventListener('click', function () { sendMessage(q); });
      presetsRow.appendChild(b);
    });
    panel.appendChild(presetsWrap);

    /* Compteur */
    var counter = el('div', 'cth-counter');
    var counterLeft = el('span', 'cth-counter-count', '');
    var counterNote = el('span', 'cth-counter-note', FREE_LIMIT + ' ' + t.counterFree);
    counter.appendChild(counterLeft);
    counter.appendChild(counterNote);
    panel.appendChild(counter);

    /* Achat du pack (phase 2) — visible quand les gratuites sont épuisées */
    var buyWrap = el('div', 'cth-buy');
    var buyBtn = el('button', 'cth-buy-btn', t.buyPack);
    buyBtn.type = 'button';
    var buyNote = el('div', 'cth-buy-note', t.buyNote);
    buyWrap.appendChild(buyBtn);
    buyWrap.appendChild(buyNote);
    panel.appendChild(buyWrap);

    /* Saisie */
    var inputRow = el('div', 'cth-inputrow');
    var input = el('input', 'cth-input');
    input.type = 'text';
    input.maxLength = 500;
    input.placeholder = t.placeholder;
    input.setAttribute('aria-label', t.placeholder);
    var sendBtn = el('button', 'cth-send', t.send);
    sendBtn.type = 'button';
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);
    panel.appendChild(inputRow);

    root.appendChild(panel);

    /* Bouton flottant */
    var launcher = el('button', 'cth-launcher');
    launcher.type = 'button';
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.innerHTML =
      '<img class="cth-launcher-avatar" src="/assets/historian/historian-avatar.webp" alt="" aria-hidden="true">' +
      '<span></span>';
    launcher.querySelector('span').textContent = t.launcher;
    root.appendChild(launcher);

    document.body.appendChild(root);

    els = { root: root, panel: panel, messages: messages, presets: presetsWrap,
            input: input, sendBtn: sendBtn, launcher: launcher,
            counterLeft: counterLeft, counterNote: counterNote,
            buyWrap: buyWrap, buyBtn: buyBtn, buyNote: buyNote };

    /* Événements */
    launcher.addEventListener('click', togglePanel);
    closeBtn.addEventListener('click', closePanel);
    buyBtn.addEventListener('click', startCheckout);
    sendBtn.addEventListener('click', function () { sendMessage(input.value); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); sendMessage(input.value); }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && state.opened) closePanel();
    });

    updateCounter();
  }

  /* ------------------------------------------------------------------ *
   * Ouverture / fermeture                                               *
   * ------------------------------------------------------------------ */
  function togglePanel() { state.opened ? closePanel() : openPanel(); }

  function openPanel() {
    state.opened = true;
    els.root.classList.add('cth-open');
    els.launcher.querySelector('span').textContent = I18N[config.lang].close;
    if (!state.greeted) {
      state.greeted = true;
      var t = I18N[config.lang];
      var greeting = config.coin === 'general'
        ? t.greetingGeneral
        : t.greetingCoin(COIN_NAMES[config.coin]);
      addMessage('assistant', greeting, true);
    }
    if (!state.balanceLoaded) refreshBalance();
    setTimeout(function () { els.input.focus(); }, 60);
  }

  function closePanel() {
    state.opened = false;
    els.root.classList.remove('cth-open');
    els.launcher.querySelector('span').textContent = I18N[config.lang].launcher;
    els.launcher.focus();
  }

  /* ------------------------------------------------------------------ *
   * Messages                                                            *
   * ------------------------------------------------------------------ */
  // Petit rendu sûr : texte brut + liens http(s) cliquables. Jamais de HTML
  // injecté tel quel (les réponses du modèle sont du texte non fiable).
  function renderText(container, text) {
    var urlRe = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g;
    var last = 0, m;
    while ((m = urlRe.exec(text)) !== null) {
      if (m.index > last) container.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement('a');
      a.href = m[1];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = m[1];
      container.appendChild(a);
      last = m.index + m[1].length;
    }
    if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
  }

  function addMessage(role, text, isGreeting) {
    var bubble = el('div', 'cth-msg ' + (role === 'user' ? 'cth-msg-user' : 'cth-msg-bot'));
    renderText(bubble, text);
    els.messages.appendChild(bubble);
    els.messages.scrollTop = els.messages.scrollHeight;
    if (!isGreeting) {
      state.history.push({ role: role === 'user' ? 'user' : 'assistant', content: text });
      // Historique borné : on ne garde que les 10 derniers échanges.
      if (state.history.length > 20) state.history = state.history.slice(-20);
    }
    return bubble;
  }

  function addTyping() {
    var bubble = el('div', 'cth-msg cth-msg-bot');
    var wrap = el('div', 'cth-typing');
    wrap.appendChild(el('span')); wrap.appendChild(el('span')); wrap.appendChild(el('span'));
    bubble.appendChild(wrap);
    bubble.setAttribute('aria-label', I18N[config.lang].thinking);
    els.messages.appendChild(bubble);
    els.messages.scrollTop = els.messages.scrollHeight;
    return bubble;
  }

  /* ------------------------------------------------------------------ *
   * Compteur + crédits du pack                                          *
   * ------------------------------------------------------------------ */
  // Le visiteur peut poser une question s'il lui reste des gratuites
  // OU des crédits de pack (le serveur dépense dans cet ordre).
  function hasQuota() {
    if (state.remaining === null) return true; // pas encore confirmé
    return state.remaining > 0 || (state.credits || 0) > 0;
  }

  function updateCounter() {
    var t = I18N[config.lang];
    if (state.remaining === null && state.credits === null) {
      els.counterLeft.textContent = '';
      els.counterNote.textContent = FREE_LIMIT + ' ' + t.counterFree;
      els.buyWrap.classList.remove('cth-visible');
      return;
    }
    var parts = [];
    if (state.remaining !== null && state.remaining > 0) parts.push(t.counterLeft(state.remaining));
    if ((state.credits || 0) > 0) parts.push(t.creditsLeft(state.credits));
    if (parts.length) {
      els.counterLeft.textContent = parts.join(' · ');
      els.counterNote.textContent = '';
    } else {
      els.counterLeft.textContent = '0';
      els.counterNote.textContent = t.counterDone;
    }
    var exhausted = !hasQuota();
    els.input.disabled = exhausted;
    els.sendBtn.disabled = exhausted;
    // Zone d'achat : visible dès que les gratuites sont épuisées.
    var showBuy = state.remaining !== null && state.remaining <= 0;
    els.buyWrap.classList.toggle('cth-visible', !!showBuy);
    if (showBuy) {
      els.buyBtn.style.display = state.canBuy ? '' : 'none';
      els.buyNote.textContent = state.canBuy ? t.buyNote : t.packsSoon;
    }
  }

  // Petit appel API partagé (même point d'entrée que les questions).
  function apiCall(payload) {
    return fetch(config.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function applyBalance(data) {
    if (!data) return;
    if (typeof data.remaining === 'number') state.remaining = data.remaining;
    if (typeof data.credits === 'number') state.credits = data.credits;
    if (typeof data.canBuy === 'boolean') state.canBuy = data.canBuy;
  }

  // Solde à jour sans poser de question (ouverture du panneau, retour
  // de paiement). Ne débite rien.
  function refreshBalance() {
    apiCall({ action: 'balance', coin: config.coin, lang: config.lang, visitorId: getVisitorId() })
      .then(function (data) {
        state.balanceLoaded = true;
        applyBalance(data);
        updateCounter();
      })
      .catch(function () { /* silencieux : le compteur par défaut reste */ });
  }

  /* ------------------------------------------------------------------ *
   * Achat du pack — Stripe Checkout hébergé (phase 2)                   *
   * ------------------------------------------------------------------ */
  function startCheckout() {
    if (!state.canBuy) return;
    var t = I18N[config.lang];
    els.buyBtn.disabled = true;
    apiCall({
      action: 'checkout', coin: config.coin, lang: config.lang,
      visitorId: getVisitorId(), returnPath: window.location.pathname
    })
      .then(function (data) {
        if (data && data.checkoutUrl) {
          window.location.href = data.checkoutUrl; // page hébergée Stripe
          return;
        }
        throw new Error('no checkout url');
      })
      .catch(function () {
        els.buyBtn.disabled = false;
        addMessage('assistant', t.checkoutError);
      });
  }

  // Retour de Stripe : ?cth_checkout=success&session_id=cs_… (ou cancelled).
  // On ouvre le panneau, on fait vérifier le paiement CÔTÉ SERVEUR,
  // et on nettoie l'URL.
  function handleCheckoutReturn() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    var flag = params.get('cth_checkout');
    if (!flag) return;
    var sessionId = params.get('session_id');
    try {
      var clean = window.location.pathname + window.location.hash;
      window.history.replaceState(null, '', clean);
    } catch (e) { /* l'URL reste, sans gravité */ }

    // Le message de retour remplace le mot d'accueil, et c'est la
    // réclamation (claim) qui rafraîchit le solde — pas le balance.
    state.greeted = true;
    state.balanceLoaded = true;
    openPanel();
    var t = I18N[config.lang];

    if (flag === 'cancelled') {
      addMessage('assistant', t.cancelledMsg, true);
      refreshBalance();
      return;
    }
    if (flag === 'success' && sessionId) {
      addMessage('assistant', t.verifying, true);
      apiCall({
        action: 'claim', coin: config.coin, lang: config.lang,
        visitorId: getVisitorId(), sessionId: sessionId
      })
        .then(function (data) {
          applyBalance(data);
          if (data && data.credited) {
            addMessage('assistant', t.creditedMsg(state.credits || 20), true);
          } else if (data && data.alreadyCredited) {
            addMessage('assistant', t.alreadyMsg, true);
          } else {
            addMessage('assistant', t.notVerified, true);
          }
          updateCounter();
        })
        .catch(function () {
          addMessage('assistant', t.notVerified, true);
        });
    }
  }

  /* ------------------------------------------------------------------ *
   * Envoi d'une question à la Netlify Function                          *
   * ------------------------------------------------------------------ */
  function sendMessage(rawText) {
    var text = (rawText || '').trim();
    if (!text || state.sending) return;
    if (!hasQuota()) return;

    state.sending = true;
    els.sendBtn.disabled = true;
    els.presets.classList.add('cth-collapsed');
    els.input.value = '';

    addMessage('user', text);
    var typing = addTyping();

    var payload = {
      coin: config.coin,
      lang: config.lang,
      message: text,
      history: state.history.slice(0, -1), // l'historique AVANT ce message
      visitorId: getVisitorId()
    };

    apiCall(payload)
      .then(function (data) {
        typing.remove();
        applyBalance(data);
        var answer = (data && data.answer) ? String(data.answer)
          : I18N[config.lang].errorNet;
        addMessage('assistant', answer);
        updateCounter();
      })
      .catch(function () {
        typing.remove();
        // Jamais d'erreur technique montrée au visiteur : un mot du personnage.
        addMessage('assistant', I18N[config.lang].errorNet);
      })
      .finally(function () {
        state.sending = false;
        updateCounter();
        if (hasQuota()) els.input.focus();
      });
  }

  /* ------------------------------------------------------------------ *
   * Démarrage                                                           *
   * ------------------------------------------------------------------ */
  function init() {
    ensureCss();
    build();
    handleCheckoutReturn();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
