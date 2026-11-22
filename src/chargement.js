// ÉCRAN DE CHARGEMENT (ARCHITECTURE.md § E5.J, 18/11/2026). Le fond, le logo, la barre vide et le texte « Chargement… »
// sont dans index.html : ils s'affichent avant tout script. Ce module (exécuté AVANT src/main.js : scripts de module
// exécutés dans l'ordre du document) fait vivre l'écran :
// - octets : entrées de performance « resource » (taille décodée de chaque fichier fini : modèles, sons, JSON, scripts,
//   feuilles de style, polices, images) ; fetch() est observé (jamais recopié) pour savoir ce qui est en cours ;
// - étapes du jeu : main.js publie l'événement « sr-chargement » (modèles posés, scène du titre, capsule préchauffée) ;
// - fin : jeu prêt ET plus aucune requête en cours → 100 %, « Prêt », deux images rendues dessous, fondu, retrait.
// Avec ?debug, l'écran est retiré d'un coup dès que window.__game est publié (les tests visent l'écran titre nu).
// Erreurs : script introuvable, exception au démarrage, modèles illisibles, ou aucun progrès pendant CHARGEMENT.blocageMs
// → message clair, bouton « Recharger » (et « Continuer quand même »). Aucun faux délai : seul le fondu dure.
import { CHARGEMENT as C } from './config.js';

const racine = document.getElementById('chargement');
const pre = window.__srCh || { erreurs: [], t0: 0 }; // posé par le script en ligne d'index.html
const MO = 1e6;

// ----- État publié (lu par tests/e5-J-chargement.mjs) ------------------------------------------------------------------
const etat = {
  phase: 'chargement', // 'chargement' | 'erreur' | 'fondu' | 'fini'
  octets: 0, // octets décodés reçus (finis + en cours)
  attendus: C.octetsAttendus,
  progression: 0, // 0..1, affichée
  requetes: 0, // requêtes comptées (finies)
  enCours: 0,
  echecs: [], // URL des requêtes en échec (HTTP ≥ 400 ou réseau)
  etapes: { modeles: 'chargement', menu: 'chargement', capsule: false },
  t: { module: performance.now(), pret: 0, fondu: 0, fini: 0 }, // ms depuis le début de la navigation
  erreur: '',
};
window.__chargement = etat;

if (racine === null) {
  etat.phase = 'fini'; // page sans écran (prototypes de tests/menu) : rien à faire
} else {
  demarrer();
}

function demarrer() {
  const el = {
    barre: racine.querySelector('.sr-ch-barre'),
    cache: racine.querySelector('.sr-ch-cache'),
    pct: racine.querySelector('.sr-ch-pct'),
    etat: racine.querySelector('.sr-ch-etat-texte'),
    detail: racine.querySelector('.sr-ch-detail'),
    astuce: racine.querySelector('.sr-ch-astuce'),
    astuceTexte: racine.querySelector('.sr-ch-astuce-texte'),
    erreur: racine.querySelector('.sr-ch-erreur'),
    erreurTitre: racine.querySelector('.sr-ch-erreur-titre'),
    erreurTexte: racine.querySelector('.sr-ch-erreur-texte'),
    recharger: racine.querySelector('.sr-ch-recharger'),
    continuer: racine.querySelector('.sr-ch-continuer'),
  };
  const reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const memeOrigine = location.origin;

  // ----- Octets : entrées de performance + fetch suivi (sans toucher aux réponses) ---------------------------------------
  // Le corps des réponses n'est JAMAIS recopié (essayé : un flux recopié par pipeThrough finissait parfois en
  // « net::ERR_ABORTED » dans Chromium, 18/11) : fetch est seulement observé pour savoir ce qui est EN COURS (texte
  // d'état, fin du chargement) ; les octets viennent tous des entrées « resource » (taille décodée), à la fin de chaque
  // fichier — 418 fichiers au démarrage, la barre avance par petits pas.
  let octetsFinis = 0;
  const enCours = new Map(); // id → { url }
  let prochainId = 0;
  let dernierProgres = performance.now();
  const fetchOrigine = window.fetch;

  function finRequete(id, ok, url) {
    if (!enCours.delete(id)) return;
    if (!ok) etat.echecs.push(url);
    dernierProgres = performance.now();
  }

  function envelopper(input, init) {
    const p = fetchOrigine(input, init);
    let url = '';
    try {
      url = new URL(typeof input === 'string' ? input : input.url, location.href).href;
    } catch (e) {
      return p;
    }
    const methode = ((init && init.method) || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    if (methode !== 'GET' || !url.startsWith(memeOrigine)) return p;
    const id = prochainId++;
    enCours.set(id, { url });
    // fin : l'entrée « resource » de cette adresse (corps entièrement reçu) ; échec : tout de suite
    p.then(
      (rep) => {
        if (!rep.ok || rep.body === null) finRequete(id, rep.ok, url);
      },
      () => finRequete(id, false, url),
    );
    return p;
  }
  window.fetch = envelopper;

  let observateur = null;
  if (typeof PerformanceObserver === 'function') {
    observateur = new PerformanceObserver((liste) => {
      for (const e of liste.getEntries()) {
        const n = e.decodedBodySize || e.encodedBodySize || 0;
        octetsFinis += n;
        etat.requetes++;
        dernierProgres = performance.now();
        if (e.responseStatus >= 400) etat.echecs.push(e.name);
        if (e.initiatorType === 'fetch')
          for (const [id, r] of enCours)
            if (r.url === e.name) {
              enCours.delete(id);
              break;
            }
      }
    });
    try {
      observateur.observe({ type: 'resource', buffered: true });
    } catch (e) {
      observateur = null;
    }
  }

  // ----- Étapes du jeu (main.js) et erreurs ------------------------------------------------------------------------------
  let pretJeu = false;
  let pretDepuis = 0;
  window.addEventListener('sr-chargement', (ev) => {
    const d = ev.detail || {};
    const e = etat.etapes;
    const avant = e.modeles + e.menu + e.capsule;
    if (typeof d.modeles === 'string') e.modeles = d.modeles;
    if (typeof d.menu === 'string') e.menu = d.menu;
    e.capsule = !!d.capsule;
    if (e.modeles + e.menu + e.capsule !== avant) dernierProgres = performance.now();
    if (e.modeles !== 'chargement' && e.menu !== 'chargement' && e.capsule && !pretJeu) {
      pretJeu = true;
      pretDepuis = performance.now();
      etat.t.pret = pretDepuis;
      if (e.modeles === 'erreur') montrerErreur(C.erreurs.modeles + (d.erreur ? ' (' + d.erreur + ')' : ''));
    }
  });
  // ?debug : les tests attendent window.__game ; l'écran disparaît au moment même où il est publié
  let jeuDebug;
  Object.defineProperty(window, '__game', {
    configurable: true,
    enumerable: true,
    get: () => jeuDebug,
    set: (v) => {
      jeuDebug = v;
      if (v && etat.phase !== 'fini') finir(true);
    },
  });
  pre.signaler = () => montrerErreur(C.erreurs.script + ' (' + nomCourt(pre.erreurs[pre.erreurs.length - 1]) + ')');
  if (pre.erreurs.length > 0) pre.signaler();
  const surErreur = (msg) => {
    if (etat.phase === 'chargement' && !pretJeu) montrerErreur(String(msg || 'erreur inconnue'));
  };
  window.addEventListener('error', (e) => {
    if (e.target === window || e.target === undefined) surErreur(e.message);
  });
  window.addEventListener('unhandledrejection', (e) => surErreur(e.reason && e.reason.message ? e.reason.message : e.reason));

  function nomCourt(url) {
    return String(url || '?').replace(/^.*\//, '');
  }

  function montrerErreur(texte) {
    if (etat.phase === 'fondu' || etat.phase === 'fini') return;
    etat.phase = 'erreur';
    etat.erreur = texte;
    // 19/11 : une erreur de contexte WebGL vient de la carte graphique, pas de la connexion
    const gpu = /WebGL/i.test(String(texte));
    el.erreurTitre.textContent = C.erreurs.titre;
    el.erreurTexte.textContent = gpu ? C.erreurs.gpu + ' ' + C.erreurs.conseilGpu : texte + ' ' + C.erreurs.conseil;
    el.recharger.textContent = C.erreurs.recharger;
    el.continuer.textContent = C.erreurs.continuer;
    el.erreur.hidden = false;
    racine.classList.add('sr-ch-en-erreur');
    racine.setAttribute('aria-busy', 'false');
  }
  el.recharger.addEventListener('click', () => location.reload());
  el.continuer.addEventListener('click', () => {
    el.erreur.hidden = true;
    racine.classList.remove('sr-ch-en-erreur');
    finir(false, true);
  });

  // ----- Affichage ---------------------------------------------------------------------------------------------------
  let texteCourant = '';
  let texteDepuis = 0;
  let astuceIndex = Math.floor(Math.random() * C.astuces.length);
  let astuceDepuis = performance.now();
  el.astuceTexte.textContent = C.astuces[astuceIndex];
  el.astuce.hidden = false;
  // 20/11 : phrase de patience écrite MAINTENANT (la page n'est pas encore figée) ; le CSS la montre seul après 5 s
  const patience = racine.querySelector('.sr-ch-patience');
  if (patience) {
    let m = null;
    try {
      m = window.ctrlzApp && typeof window.ctrlzApp.moteur === 'function' ? window.ctrlzApp.moteur() : null;
    } catch (e) {
      m = null;
    }
    patience.textContent = m && !m.regle ? C.patienceMoteur.replace('{n}', m.essai).replace('{t}', m.total) : C.patience;
  }

  function texteEtat() {
    if (enCours.size === 0) return pretJeu || etat.octets >= etat.attendus * 0.98 ? C.textePreparation : C.texteDefaut;
    // catégorie la plus représentée parmi les requêtes en cours
    const compte = new Array(C.etats.length).fill(0);
    for (const r of enCours.values()) {
      for (let k = 0; k < C.etats.length; k++) {
        if (C.etats[k].motif.test(r.url)) {
          compte[k]++;
          break;
        }
      }
    }
    let best = -1;
    for (let k = 0; k < compte.length; k++) if (compte[k] > 0 && (best < 0 || compte[k] > compte[best])) best = k;
    return best < 0 ? C.texteDefaut : C.etats[best].texte;
  }

  const fmtMo = (n) => (n / MO).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // App de bureau (bureau/preload.js) : les fichiers servis par ctrlz:// n'ont pas d'entrée de performance « resource »
  // (la barre restait à 0 %) ; la coquille compte les octets qu'elle sert — lus toutes les 250 ms (appel synchrone)
  let octetsApp = 0;
  let lectureApp = -1e9;
  function lireOctetsApp(now) {
    const A = window.ctrlzApp;
    if (!A || typeof A.octets !== 'function' || now - lectureApp < 250) return;
    lectureApp = now;
    const n = Number(A.octets()) || 0;
    if (n > octetsApp) dernierProgres = now;
    octetsApp = n;
  }

  function peindre(now) {
    if (etat.phase === 'fini') return;
    lireOctetsApp(now);
    const recu = Math.max(octetsFinis, octetsApp);
    etat.octets = recu;
    etat.enCours = enCours.size;
    etat.attendus = Math.max(C.octetsAttendus, recu);
    const e = etat.etapes;
    const etapes = (e.modeles !== 'chargement') + (e.menu !== 'chargement') + (e.capsule ? 1 : 0);
    let p = C.partOctets * Math.min(1, recu / etat.attendus) + ((1 - C.partOctets) * etapes) / 3;
    if (etat.phase !== 'fondu') p = Math.min(p, 0.99);
    else p = 1;
    if (p > etat.progression) etat.progression = p; // jamais de recul
    const pc = etat.progression;
    el.cache.style.transform = 'translateX(' + (pc * 100).toFixed(2) + '%)';
    const pcTexte = Math.floor(pc * 100) + ' %';
    if (el.pct.textContent !== pcTexte) {
      el.pct.textContent = pcTexte;
      el.barre.setAttribute('aria-valuenow', String(Math.floor(pc * 100)));
    }
    const det = fmtMo(recu) + ' / ' + fmtMo(etat.attendus) + ' Mo';
    if (el.detail.textContent !== det) el.detail.textContent = det;
    if (etat.phase === 'fondu') {
      if (texteCourant !== C.textePret) el.etat.textContent = texteCourant = C.textePret;
    } else if (now - texteDepuis >= C.rafraichissementTexteMs) {
      const t = texteEtat();
      if (t !== texteCourant) {
        el.etat.textContent = texteCourant = t;
        texteDepuis = now;
      }
    }
    if (now - astuceDepuis >= C.astuceMs && C.astuces.length > 1) {
      astuceIndex = (astuceIndex + 1) % C.astuces.length;
      astuceDepuis = now;
      if (reduit) el.astuceTexte.textContent = C.astuces[astuceIndex];
      else {
        el.astuce.classList.remove('sr-ch-astuce-entre');
        void el.astuce.offsetWidth; // relance l'animation d'entrée
        el.astuceTexte.textContent = C.astuces[astuceIndex];
        el.astuce.classList.add('sr-ch-astuce-entre');
      }
    }
  }

  let imagePrecedente = performance.now();
  function boucle(now) {
    if (etat.phase === 'fini' || etat.phase === 'fondu') return;
    // page figée (la carte graphique compilait) : ce n'est pas un chargement arrêté — le délai « bloqué » repart
    if (now - imagePrecedente > C.figeeMs) dernierProgres = now;
    imagePrecedente = now;
    peindre(now);
    if (etat.phase === 'chargement') {
      if (pretJeu && (enCours.size === 0 || now - dernierProgres > C.attenteFinMs)) {
        finir(false);
        return;
      }
      if (!pretJeu && now - dernierProgres > C.blocageMs) montrerErreur(C.erreurs.bloque);
    } else if (etat.phase === 'erreur' && etat.erreur === C.erreurs.bloque && now - dernierProgres < 1000) {
      // le chargement a repris : le message s'efface
      el.erreur.hidden = true;
      racine.classList.remove('sr-ch-en-erreur');
      etat.phase = 'chargement';
      etat.erreur = '';
    }
    requestAnimationFrame(boucle);
  }
  requestAnimationFrame(boucle);

  // ----- Fin -----------------------------------------------------------------------------------------------------------
  function liberer() {
    if (window.fetch === envelopper) window.fetch = fetchOrigine; // les requêtes en cours finissent normalement
    if (observateur !== null) observateur.disconnect();
  }

  function retirer() {
    if (etat.phase === 'fini') return;
    etat.phase = 'fini';
    etat.t.fini = performance.now();
    liberer();
    racine.remove();
  }

  function finir(immediat, force = false) {
    if (etat.phase === 'fini' || etat.phase === 'fondu') return;
    if (etat.phase === 'erreur' && !force && !immediat) return;
    if (immediat) {
      peindre(performance.now());
      retirer();
      return;
    }
    etat.phase = 'fondu';
    etat.t.fondu = performance.now();
    racine.setAttribute('aria-busy', 'false');
    peindre(etat.t.fondu); // 100 %, « Prêt »
    let n = C.imagesAvantFondu;
    const attendre = () => {
      if (--n > 0) {
        requestAnimationFrame(attendre);
        return;
      }
      const s = reduit ? C.fonduReduitS : C.fonduS;
      racine.style.transitionDuration = s + 's';
      racine.classList.add('sr-ch-sortie');
      racine.addEventListener('transitionend', retirer, { once: true });
      setTimeout(retirer, s * 1000 + 250); // filet : pas de transitionend (onglet masqué…)
    };
    requestAnimationFrame(attendre);
  }
}
