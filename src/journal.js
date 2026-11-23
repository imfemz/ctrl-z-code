// § E5.X10 (audit I5, lot 17) — journal des parties pour le playtest. Deux moitiés :
//   1. la partie EN COURS : cartes prises, relances, passes — notées au moment du choix (écran de niveau ou de coffre,
//      jamais en combat), dans des tableaux préparés à l'import : rien n'est alloué au choix ;
//   2. les parties FINIES : une entrée par partie (entree), relue et nettoyée au chargement (lisible : une sauvegarde
//      abîmée donne un journal vide, jamais une erreur), mise en texte pour « Copier mes stats » (texte).
// La méta (meta.js) garde le tableau des entrées dans sa sauvegarde et l'écrit avec elle, une fois par partie.
// Ce module n'importe que config.js et patchnotes.js : il se teste sans navigateur (tests/e5-X10-journal.mjs, partie 0).
//#region e5:X10-journal
import { AGENTS, AGENT_COUNT, CAUSE_COUNT, CAUSE_TEXTE, JOURNAL } from './config.js';
import { PATCHNOTES } from './patchnotes.js';

/** Origine d'une carte (JOURNAL.sortes : ce qu'on écrit après son nom). */
export const SORTE = Object.freeze({ NIVEAU: 0, ARME_NEUVE: 1, AMELIORATION: 2, OBJET_COFFRE: 3, SURVOLTAGE: 4, FRAGMENTS: 5, EVOLUTION: 6 });

// ----- 1. la partie en cours (aucune allocation au choix : nom = référence d'une chaîne existante) ------------------------
const NOMS = new Array(JOURNAL.cartesMax).fill('');
const SORTES = new Uint8Array(JOURNAL.cartesMax);
const N = new Int32Array(4); // [cartes notées, cartes prises (toutes), relances, passes]
const DEBUT = new Float64Array(1); // Date.now() au début de la partie

/** Nouvelle partie (meta.beginRun, depuis defis.reset). */
export function debut() {
  N.fill(0);
  DEBUT[0] = Date.now();
}

/** Une carte prise : nom (chaîne déjà faite : nom du bonus, de l'objet, de l'arme), sorte (SORTE.*). */
export function carte(nom, sorte) {
  if (N[0] < NOMS.length) {
    NOMS[N[0]] = nom;
    SORTES[N[0]] = sorte;
    N[0]++;
  }
  N[1]++;
}

/** Une relance de cartes utilisée (choix de niveau ou coffre) : c'est ce que compte stats.relances. */
export function relance() {
  N[2]++;
}

/** Un choix passé (niveau ou coffre). */
export function passe() {
  N[3]++;
}

export function relancesPartie() {
  return N[2];
}

/** Lecture pour les tests : la partie en cours. */
export function enCours() {
  return { cartes: libellesCartes(), prises: N[1], relances: N[2], passes: N[3], debut: DEBUT[0] };
}

function libellesCartes() {
  const out = [];
  for (let k = 0; k < N[0]; k++) out.push(SORTES[k] === SORTE.FRAGMENTS ? JOURNAL.fragmentsCoffre : NOMS[k] + (JOURNAL.sortes[SORTES[k]] || ''));
  return out;
}

// ----- 2. les parties finies ---------------------------------------------------------------------------------------------
function nat(x) {
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

/**
 * Entrée d'une partie finie (meta.finishRun, hors combat). run : état de la partie (wave, level, time, agent, fragments) ;
 * summary : compteurs de defis (boss, fragments gagnés, mortCause, mort) ; fin = Date.now().
 */
export function entree(run, summary, fin) {
  const mort = summary.mort === true;
  const c = nat(summary.mortCause);
  return {
    fin,
    debut: DEBUT[0] > 0 && DEBUT[0] <= fin ? DEBUT[0] : fin,
    version: PATCHNOTES.version,
    agent: run.agent >= 0 && run.agent < AGENT_COUNT ? run.agent : 0,
    duree: Number.isFinite(run.time) && run.time > 0 ? Math.round(run.time) : 0,
    vague: nat(run.wave),
    niveau: nat(run.level),
    boss: nat(summary.boss),
    issue: mort ? 'mort' : 'abandon',
    cause: mort && c < CAUSE_COUNT ? c : 0,
    cartes: libellesCartes(),
    prises: N[1],
    relances: N[2],
    passes: N[3],
    fragGagnes: nat(summary.fragments),
    fragPerdus: nat(run.fragments),
  };
}

function objet(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/** Une entrée relue dans la sauvegarde, nettoyée ; null si elle n'est pas lisible. */
function entreeLisible(e) {
  if (!objet(e) || !(Number.isFinite(e.fin) && e.fin > 0)) return null;
  const cartes = Array.isArray(e.cartes) ? e.cartes.filter((s) => typeof s === 'string').slice(0, JOURNAL.cartesMax).map((s) => s.slice(0, JOURNAL.texteMax)) : [];
  const c = nat(e.cause);
  return {
    fin: e.fin,
    debut: Number.isFinite(e.debut) && e.debut > 0 && e.debut <= e.fin ? e.debut : e.fin,
    version: typeof e.version === 'string' ? e.version.slice(0, 16) : '',
    agent: nat(e.agent) < AGENT_COUNT ? nat(e.agent) : 0,
    duree: nat(e.duree),
    vague: nat(e.vague),
    niveau: nat(e.niveau),
    boss: nat(e.boss),
    issue: e.issue === 'mort' ? 'mort' : 'abandon',
    cause: e.issue === 'mort' && c < CAUSE_COUNT ? c : 0,
    cartes,
    prises: Math.max(nat(e.prises), cartes.length),
    relances: nat(e.relances),
    passes: nat(e.passes),
    fragGagnes: nat(e.fragGagnes),
    fragPerdus: nat(e.fragPerdus),
  };
}

/** Journal relu dans la sauvegarde : un tableau d'entrées propres (les illisibles sont écartées), [] s'il est illisible. */
export function lisible(x) {
  try {
    if (!Array.isArray(x)) return [];
    const out = [];
    for (const e of x) {
      const p = entreeLisible(e);
      if (p !== null) out.push(p);
    }
    return out.slice(-JOURNAL.max);
  } catch (e) {
    return [];
  }
}

// ----- texte de « Copier mes stats » -----------------------------------------------------------------------------------
const deux = (n) => (n < 10 ? '0' : '') + n;
const virgule = (x) => (Math.round(x * 10) / 10).toString().replace('.', ',');
const remplir = (t, o) => t.replace(/\{(\w)\}/g, (m, k) => (k in o ? String(o[k]) : m));

/** « 4 min 12 s », « 42 s ». */
export function dureeTexte(s) {
  const t = Math.max(0, Math.round(s));
  const m = Math.floor(t / 60);
  return m > 0 ? m + ' min ' + deux(t % 60) + ' s' : t + ' s';
}

function dateCourte(ms) {
  const d = new Date(ms);
  return deux(d.getDate()) + '/' + deux(d.getMonth() + 1) + ' ' + deux(d.getHours()) + ':' + deux(d.getMinutes());
}

function dateLongue(ms) {
  const d = new Date(ms);
  return deux(d.getDate()) + '/' + deux(d.getMonth() + 1) + '/' + d.getFullYear() + ' à ' + deux(d.getHours()) + ':' + deux(d.getMinutes());
}

/** Une ligne par partie. */
export function lignePartie(e, k) {
  const T = JOURNAL.textes;
  const morceaux = [
    dateCourte(e.fin),
    AGENTS[e.agent] ? AGENTS[e.agent].name : '?',
    remplir(T.vague, { n: e.vague }),
    dureeTexte(e.duree),
    remplir(T.niveau, { n: e.niveau }),
    remplir(T.boss, { n: e.boss }),
    e.issue === 'mort' ? (e.cause > 0 ? remplir(T.mort, { c: CAUSE_TEXTE[e.cause] }) : T.mortInconnue) : T.abandon,
    remplir(T.relancesP, { n: e.relances }),
    remplir(T.fragments, { g: e.fragGagnes, p: e.fragPerdus }),
    e.prises > 0 ? remplir(T.cartesP, { n: e.prises, c: e.cartes.join(', ') + (e.prises > e.cartes.length ? ', …' : '') }) : T.cartesPVide,
  ];
  if (e.version && e.version !== PATCHNOTES.version) morceaux.push('version ' + e.version);
  return k + 1 + '. ' + morceaux.join(' · ');
}

/**
 * Le texte copié : en-tête, une ligne par partie (la plus récente en premier), puis le résumé. entrees : du plus ancien
 * au plus récent (ordre de la sauvegarde) ; maintenant : Date.now() (paramètre pour les tests).
 */
export function texte(entrees, maintenant = Date.now()) {
  const T = JOURNAL.textes;
  const L = [remplir(T.titre, { v: PATCHNOTES.version }), remplir(T.date, { d: dateLongue(maintenant) }), ''];
  const n = entrees.length;
  if (n === 0) {
    L.push(T.vide);
    return L.join('\n');
  }
  L.push(n === 1 ? T.partiesUne : remplir(T.parties, { n }));
  for (let k = 0; k < n; k++) L.push(lignePartie(entrees[n - 1 - k], k));
  L.push('', T.resume);
  let vagues = 0;
  let vMax = 0;
  let duree = 0;
  let relances = 0;
  let abandons = 0;
  const causes = new Map();
  const cartes = new Map();
  for (const e of entrees) {
    vagues += e.vague;
    vMax = Math.max(vMax, e.vague);
    duree += e.duree;
    relances += e.relances;
    if (e.issue !== 'mort') abandons++;
    else if (e.cause > 0) causes.set(e.cause, (causes.get(e.cause) || 0) + 1);
    for (const c of e.cartes) cartes.set(c, (cartes.get(c) || 0) + 1);
  }
  L.push(remplir(T.nParties, { n }));
  L.push(remplir(T.vagueMoyenne, { n: virgule(vagues / n) }));
  L.push(remplir(T.vagueMax, { n: vMax }));
  L.push(remplir(T.dureeMoyenne, { n: dureeTexte(duree / n) }));
  let cN = 0;
  for (const k of causes.values()) if (k > cN) cN = k;
  const premieres = [...causes].filter(([, k]) => k === cN).map(([c]) => c).sort((x, y) => x - y).map((c) => CAUSE_TEXTE[c]);
  L.push(cN === 0 ? T.causeAucune : remplir(premieres.length > 1 ? T.causes : T.cause, { c: premieres.join(', '), n: cN }));
  L.push(remplir(T.abandons, { n: abandons }));
  const top = [...cartes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).slice(0, JOURNAL.topCartes);
  L.push(top.length ? remplir(T.cartes, { c: top.map(([c, k]) => c + ' ×' + k).join(', ') }) : T.cartesAucune);
  L.push(remplir(T.relances, { n: virgule(relances / n) }));
  // rejoue dans la minute : une mort suivie d'une partie commencée moins de JOURNAL.rejoueSecondes après ; la mort la plus
  // récente ne compte que si la minute est passée (sinon on ne sait pas encore)
  let a = 0;
  let b = 0;
  const lim = JOURNAL.rejoueSecondes * 1000;
  for (let k = 0; k < n; k++) {
    const e = entrees[k];
    if (e.issue !== 'mort') continue;
    if (k + 1 < n) {
      b++;
      if (entrees[k + 1].debut - e.fin <= lim) a++;
    } else if (maintenant - e.fin > lim) b++;
  }
  L.push(b > 0 ? remplir(T.rejoue, { a, b }) : T.rejoueAucune);
  return L.join('\n');
}
//#endregion e5:X10-journal
