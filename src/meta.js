// Méta-progression (ARCHITECTURE.md § E3.0.3, étendue au § E4.A.1) : ce qui survit d'une partie à l'autre. Lue une fois
// à init, écrite seulement hors combat (écran de coffre ou de fusion, début de WAVE_CLEAR, fin de partie, hub,
// pagehide). localStorage en try/catch : stockage absent, illisible ou refusé → méta vierge, le jeu marche quand même.
// Étape 4 (§ E4.A) : format v2 dans la MÊME clé (STORAGE.metaKey) — déblocages, Cycles, succès, Collection, statistiques.
// Aucune stat permanente : un déblocage fait seulement entrer un élément dans le tirage.
import {
  AGENTS, AGENT_COUNT, DEFIS, DEFI_COND, DEFI_COUNT, DEFI_RECOMP, ENEMY_COUNT, ITEM_COUNT, ITEM_KEYS, META, META_BUY,
  SKIN_BASE, STORAGE, UTIL_COUNT, UTILITIES, WEAPON_COUNT, WEAPON_KEYS, cyclesDetail, skinsDe,
} from './config.js';
import { CAUSE_COUNT } from './config.js'; // § E5.Q (Femz, 21/11) : morts par cause, d'une partie à l'autre
import { EVOLUTIONS } from './config.js'; // § E5.X7 (H2) : recette connue
import { ITEMS } from './config.js'; // § E5.AL : objet retiré (ITEMS[id].retire) — jamais dans le tirage
//#region e5:X10-journal
import { JOURNAL } from './config.js';
import * as journal from './journal.js'; // § E5.X10 (audit I5) : journal des parties pour le playtest
//#endregion e5:X10-journal

function statsVierges() {
  return {
    parties: 0, kills: 0, killsByType: new Array(ENEMY_COUNT).fill(0), boss: 0, elites: 0, coffres: 0, relances: 0,
    meilleureVagueAgent: new Array(AGENT_COUNT).fill(0), evolutionsFaites: 0, fusionsFaites: 0, fragments: 0,
    tempsJeu: 0, // § E4.I.7 : secondes de jeu, toutes parties (comptées à la fin de chaque partie depuis le chantier I)
    cyclesSucces: 0, // § E4.I.7 : monnaie gagnée par les succès
    vagues: 0, // § E4.I.2 : vagues terminées, toutes parties
    mortsParCause: new Array(CAUSE_COUNT).fill(0), // § E5.Q : parties perdues, par cause du coup mortel (CAUSE.*)
  };
}

// Une seule structure, créée à l'import, jamais remplacée (les lecteurs gardent la référence).
const data = {
  v: 2,
  evolutions: [], // v1 : ids découverts (entiers)
  fusions: [], // v1 : ids découverts (entiers)
  cycles: 0, // solde de la monnaie méta (MONNAIE.nom ; clé gardée pour la compatibilité)
  cyclesTotal: 0, // monnaie gagnée en jouant depuis le début (meta.credit(n, 'jeu'))
  cyclesAchetes: 0, // § E4.I.3 : monnaie achetée (meta.credit(n, 'achat') ; aucun paiement dans ce code)
  unlocked: [], // clés débloquées ('arme:rail', 'agent:bastion'…)
  revealed: [], // recettes révélées par un succès ('evo:canon-chiffre', 'fusion:malware')
  succes: [], // clés des succès réussis
  succesDates: {}, // clé → date de réussite (ms), lue par le hub
  vu: [], // Collection : 'arme:<clé>', 'objet:<clé>', 'robot:<n>' déjà obtenus / rencontrés
  skins: {}, // skin choisi par agent : { [agentKey]: skinKey } (tâche skins)
  consignes: [], // § E5.L : consignes déjà montrées ('deplacer', 'dash', 'terminal') — une fois par profil
  stats: statsVierges(),
  lastRun: null, // résumé de la dernière partie (bilan), réécrit à chaque finishRun
  journal: [], // § E5.X10 : les JOURNAL.max dernières parties (journal.entree), de la plus ancienne à la plus récente
};

// Tableaux typés lus par les filtres du tirage (§ E4.A.5) sans appel de fonction ; figés au départ d'une partie
// (applyToRun) : un déblocage gagné en partie compte à la partie suivante.
export const WEAPON_OK = new Uint8Array(WEAPON_COUNT).fill(1);
export const ITEM_OK = new Uint8Array(ITEM_COUNT).fill(1);
export const UTIL_OK = new Uint8Array(UTIL_COUNT).fill(1);
export const AGENT_OK = new Uint8Array(AGENT_COUNT).fill(1);

const UTIL_KEYS = UTILITIES.list.map((u) => u.key);
const AGENT_KEYS = AGENTS.map((a) => a.key);
const KINDS = { arme: WEAPON_KEYS, objet: ITEM_KEYS, util: UTIL_KEYS, agent: AGENT_KEYS };
const LOCKED = new Set();
for (const kind in META.verrous) for (const k of META.verrous[kind]) LOCKED.add(kind + ':' + k);

let mode = 'stockage'; // 'stockage' | 'tout' | 'vierge' | 'depart' (?debug, en mémoire : rien n'est écrit)
let erreurs = 0; // lectures ou écritures refusées (inspect)
const runState = { counted: false, gained: 0, succesRun: [] }; // partie en cours (hors combat seulement)

function reinit() {
  data.v = 2;
  data.evolutions.length = 0;
  data.fusions.length = 0;
  data.cycles = 0;
  data.cyclesTotal = 0;
  data.cyclesAchetes = 0;
  data.unlocked.length = 0;
  data.revealed.length = 0;
  data.succes.length = 0;
  for (const k in data.succesDates) delete data.succesDates[k];
  data.vu.length = 0;
  data.consignes.length = 0; // § E5.L
  for (const k in data.skins) delete data.skins[k];
  data.stats = statsVierges();
  data.lastRun = null;
  data.journal.length = 0; // § E5.X10
}

function objetLisible(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/** § E5.X2 : état de la sauvegarde au dernier load() — abîmée, copie gardée, précédente reprise. */
const sauvegarde = { abimee: false, copie: false, reprise: false };
export function etatSauvegarde() {
  return sauvegarde;
}

function ints(a) {
  return Array.isArray(a) ? a.filter((n) => Number.isInteger(n)) : [];
}
function strs(a) {
  return Array.isArray(a) ? [...new Set(a.filter((s) => typeof s === 'string'))] : [];
}
function nat(x) {
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

/** Lit la méta (une fois, à init). preset : null sans ?debug ; sinon META.urlParam de l'URL (défaut 'tout'). */
export function load(preset = null) {
  reinit();
  mode = preset === null || preset === undefined ? 'stockage' : String(preset);
  if (mode !== 'stockage' && mode !== 'tout' && mode !== 'vierge' && mode !== 'depart') mode = META.debugDefaut;
  if (mode !== 'stockage') {
    // 'tout' : tout est débloqué ET tous les succès sont réussis — les tests des étapes 1 à 3 (?debug sans meta=)
    // ne voient ni verrou, ni notification, ni son de succès (§ E4.0.6). 'vierge' et 'depart' : méta vierge.
    if (mode === 'tout') for (const D of DEFIS.list) data.succes.push(D.key);
    applyToRun();
    return;
  }
  let o = null;
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE.metaKey);
    if (raw) o = JSON.parse(raw);
  } catch (e) {
    erreurs++; // stockage absent ou illisible : méta vierge
    o = null;
  }
  // § E5.X2 (audit I2) : une méta illisible n'est plus perdue. Lue → recopiée comme « précédente » (l'état au début de
  // cette session). Illisible → gardée telle quelle (1re copie abîmée jamais écrasée), puis la précédente est reprise.
  sauvegarde.abimee = false;
  sauvegarde.copie = false;
  sauvegarde.reprise = false;
  if (raw) {
    if (objetLisible(o)) {
      try {
        localStorage.setItem(STORAGE.metaPrecedenteKey, raw);
      } catch (e) {
        erreurs++;
      }
    } else {
      sauvegarde.abimee = true;
      try {
        if (localStorage.getItem(STORAGE.metaAbimeeKey) === null) localStorage.setItem(STORAGE.metaAbimeeKey, raw);
        sauvegarde.copie = localStorage.getItem(STORAGE.metaAbimeeKey) !== null;
      } catch (e) {
        erreurs++;
      }
      let p = null;
      try {
        const rp = localStorage.getItem(STORAGE.metaPrecedenteKey);
        if (rp) p = JSON.parse(rp);
      } catch (e) {
        erreurs++;
        p = null;
      }
      if (objetLisible(p)) {
        o = p;
        sauvegarde.reprise = true;
      } else o = null;
    }
  }
  if (!objetLisible(o)) o = {};
  const v1 = !(o.v >= 2);
  data.evolutions.push(...ints(o.evolutions));
  data.fusions.push(...ints(o.fusions));
  for (const k in o) if (!(k in data)) data[k] = o[k]; // champs d'une étape suivante : gardés tels quels
  if (!v1) {
    data.cycles = nat(o.cycles);
    data.cyclesAchetes = nat(o.cyclesAchetes);
    data.cyclesTotal = Math.max(nat(o.cyclesTotal), data.cycles - data.cyclesAchetes);
    data.unlocked.push(...strs(o.unlocked));
    data.revealed.push(...strs(o.revealed));
    data.succes.push(...strs(o.succes).filter((k) => DEFIS.list.some((d) => d.key === k)));
    if (o.succesDates && typeof o.succesDates === 'object') for (const k in o.succesDates) if (Number.isFinite(o.succesDates[k])) data.succesDates[k] = o.succesDates[k];
    data.vu.push(...strs(o.vu));
    data.consignes.push(...strs(o.consignes)); // § E5.L
    if (o.skins && typeof o.skins === 'object' && !Array.isArray(o.skins)) for (const k in o.skins) if (typeof o.skins[k] === 'string') data.skins[k] = o.skins[k];
    const s = o.stats && typeof o.stats === 'object' ? o.stats : {};
    const S = data.stats;
    for (const k of ['parties', 'kills', 'boss', 'elites', 'coffres', 'relances', 'evolutionsFaites', 'fusionsFaites', 'fragments', 'tempsJeu', 'cyclesSucces', 'vagues']) S[k] = nat(s[k]);
    if (Array.isArray(s.killsByType)) for (let t = 0; t < ENEMY_COUNT; t++) S.killsByType[t] = nat(s.killsByType[t]);
    if (Array.isArray(s.meilleureVagueAgent)) for (let a = 0; a < AGENT_COUNT; a++) S.meilleureVagueAgent[a] = nat(s.meilleureVagueAgent[a]);
    if (Array.isArray(s.mortsParCause)) for (let c = 0; c < CAUSE_COUNT; c++) S.mortsParCause[c] = nat(s.mortsParCause[c]); // § E5.Q
    data.lastRun = o.lastRun && typeof o.lastRun === 'object' ? o.lastRun : null;
    data.journal.push(...journal.lisible(o.journal)); // § E5.X10 : illisible = journal vide, jamais une erreur
  } else {
    // Migration v1 → v2 (§ E4.A.1) + rattrapage du record : les succès de vague que le record prouve sont accordés,
    // sans Cycles (Femz et ses testeurs ont déjà joué). Écrit tout de suite (hors combat : init).
    let best = 0;
    try {
      const b = JSON.parse(localStorage.getItem(STORAGE.bestKey) || 'null');
      if (b && Number.isFinite(b.wave)) best = Math.floor(b.wave);
    } catch (e) {
      erreurs++;
    }
    for (let s = 0; s < DEFI_COUNT; s++) {
      const D = DEFIS.list[s];
      if (D.cond === DEFI_COND.VAGUE && best >= D.n) grant(s, false);
    }
    data.v = 2;
    write();
  }
  if (sauvegarde.reprise) write(); // § E5.X2 : la sauvegarde reprise remplace tout de suite la chaîne abîmée
  applyToRun();
}

/** Mode de la méta : 'stockage' (normal) ou un préréglage de ?debug (en mémoire). */
export function getMode() {
  return mode;
}

/** kind : 'arme' | 'objet' | 'util' | 'agent'. Vrai si de départ (pas dans META.verrous) ou débloqué. */
export function isUnlocked(kind, key) {
  if (mode === 'tout') return true;
  const k = kind + ':' + key;
  return !LOCKED.has(k) || data.unlocked.indexOf(k) >= 0;
}

/** Agent d'indice a verrouillé ? Le premier (l'Éclaireur) ne l'est jamais ; les autres suivent META.verrous.agent. */
export function agentVerrouille(a) {
  return a !== 0 && !isUnlocked('agent', AGENT_KEYS[a]);
}

//#region skins
/** Skin `skinKey` de l'agent débloqué ? `base` toujours ; mode 'tout' : tout ; sinon `skin:<agent>:<skin>` dans unlocked. */
export function skinDebloque(agentKey, skinKey) {
  if (skinKey === SKIN_BASE || mode === 'tout') return true;
  return data.unlocked.indexOf('skin:' + agentKey + ':' + skinKey) >= 0;
}

/**
 * Skin EFFECTIF d'un agent : le choix gardé s'il est connu ET débloqué, sinon 'base' (sauvegarde trafiquée, ancienne
 * version, progression réinitialisée). SEUL endroit qui en décide : le modèle, le portrait et les effets passent par là.
 */
export function skinEffectif(agentKey) {
  const k = Object.prototype.hasOwnProperty.call(data.skins, agentKey) ? data.skins[agentKey] : SKIN_BASE;
  return skinsDe(agentKey).includes(k) && skinDebloque(agentKey, k) ? k : SKIN_BASE;
}

/** Skin à porter (nom historique de skinEffectif). */
export function skinChoisi(agentKey) {
  return skinEffectif(agentKey);
}

/** Choisit le skin d'un agent. Faux (rien ne change) si inconnu ou verrouillé ; vrai : gardé et écrit (hors combat). */
export function choisirSkin(agentKey, skinKey) {
  if (!skinsDe(agentKey).includes(skinKey) || !skinDebloque(agentKey, skinKey)) return false;
  data.skins[agentKey] = skinKey;
  write();
  return true;
}
//#endregion skins

/** Remplit WEAPON_OK, ITEM_OK, UTIL_OK, AGENT_OK (main.resetAll, hors combat). */
export function applyToRun() {
  for (let w = 0; w < WEAPON_COUNT; w++) WEAPON_OK[w] = isUnlocked('arme', WEAPON_KEYS[w]) ? 1 : 0;
  for (let i = 0; i < ITEM_COUNT; i++) ITEM_OK[i] = isUnlocked('objet', ITEM_KEYS[i]) ? 1 : 0;
  //#region e5:AL-retrait-cryogel
  for (let i = 0; i < ITEM_COUNT; i++) if (ITEMS[i].retire === true) ITEM_OK[i] = 0; // retiré (Cryogel) : jamais tiré, quel que soit le mode
  //#endregion e5:AL-retrait-cryogel
  for (let u = 0; u < UTIL_COUNT; u++) UTIL_OK[u] = isUnlocked('util', UTIL_KEYS[u]) ? 1 : 0;
  for (let a = 0; a < AGENT_COUNT; a++) AGENT_OK[a] = isUnlocked('agent', AGENT_KEYS[a]) ? 1 : 0;
  AGENT_OK[0] = 1; // l'Éclaireur est toujours jouable
}

export function isDiscovered(kind, id) {
  const list = data[kind];
  return Array.isArray(list) && list.indexOf(id) >= 0;
}

/** kind : 'evolutions' | 'fusions'. Renvoie true si c'est une première découverte. Hors combat seulement. */
export function discover(kind, id) {
  const list = data[kind];
  if (!Array.isArray(list) || list.indexOf(id) >= 0) return false;
  list.push(id);
  write();
  return true;
}

/** Nombre d'évolutions découvertes (succès « Bibliothécaire » ; lu en combat : un entier, aucune allocation). */
export function evolutionCount() {
  return data.evolutions.length;
}

/** Recette révélée par un succès ('evo:<clé>' ou 'fusion:<clé>'). */
export function isRevealed(key) {
  return data.revealed.indexOf(key) >= 0;
}

/**
 * § E5.X7 (H2) : recette d'évolution e CONNUE du joueur — découverte (le coffre l'a donnée) ou révélée par un succès ;
 * la règle de la Collection (ui-hub.js). Hors combat (cartes, fenêtre d'infos).
 */
export function evoConnue(e) {
  const E = EVOLUTIONS[e];
  return !!E && (isDiscovered('evolutions', E.id) || isRevealed('evo:' + E.key));
}

export function hasSucces(s) {
  return s >= 0 && s < DEFI_COUNT && data.succes.indexOf(DEFIS.list[s].key) >= 0;
}

/** Élément en vente (prix connu, pas encore débloqué, en vente dès le départ ou mis en vente par un succès réussi). */
export function isForSale(key) {
  if (!(key in META.prix) || data.unlocked.indexOf(key) >= 0) return false;
  if (META.enVenteDepart.indexOf(key) >= 0) return true;
  for (let s = 0; s < DEFI_COUNT; s++) {
    const D = DEFIS.list[s];
    if (D.reward === key && D.sorte === DEFI_RECOMP.VENTE && data.succes.indexOf(D.key) >= 0) return true;
  }
  return false;
}

function grant(s, countCycles) {
  const D = DEFIS.list[s];
  if (data.succes.indexOf(D.key) >= 0) return false;
  data.succes.push(D.key);
  data.succesDates[D.key] = Date.now();
  if (D.sorte === DEFI_RECOMP.DEBLOQUE) {
    if (data.unlocked.indexOf(D.reward) < 0) data.unlocked.push(D.reward);
  } else if (D.sorte === DEFI_RECOMP.REVELE) {
    if (data.revealed.indexOf(D.reward) < 0) data.revealed.push(D.reward);
  } // VENTE : isForSale le lit dans data.succes
  if (countCycles) runState.succesRun.push(s);
  return true;
}

/** Succès s réussi (defis.flush, hors combat) : récompense appliquée (effective à la partie suivante), Cycles à la partie. */
export function grantSucces(s) {
  if (!(s >= 0 && s < DEFI_COUNT)) return false;
  return grant(s, true);
}

/** Collection : un élément vu ('arme:blaster', 'objet:tesla', 'robot:3'). En mémoire ; écrit par flush(). */
export function see(key) {
  if (data.vu.indexOf(key) >= 0) return false;
  data.vu.push(key);
  return true;
}

export function isSeen(key) {
  return data.vu.indexOf(key) >= 0;
}

function write() {
  if (mode !== 'stockage') return false;
  try {
    localStorage.setItem(STORAGE.metaKey, JSON.stringify(data));
    return true;
  } catch (e) {
    erreurs++; // écriture refusée : la méta vaut pour cette session
    return false;
  }
}

//#region e5:L-textes-guide
/** § E5.L : la consigne `key` a-t-elle déjà été montrée à ce profil ? */
export function consigneVue(key) {
  return data.consignes.indexOf(key) >= 0;
}

/** § E5.L : consigne montrée (en mémoire ; écrite au prochain moment hors combat, comme les « vu »). Rend true la 1re fois. */
export function marquerConsigne(key) {
  if (data.consignes.indexOf(key) >= 0) return false;
  data.consignes.push(key);
  return true;
}

/** § E5.L (A4) : 1er lancement — méta du stockage, aucune partie jouée, aucune consigne vue. */
export function premierLancement() {
  return mode === 'stockage' && data.stats.parties === 0 && data.consignes.length === 0;
}
//#endregion e5:L-textes-guide

/** Écrit les succès et les « vu » de la vague (début de WAVE_CLEAR, pagehide). */
export function flush() {
  return write();
}

/** Nouvelle partie : rien n'est encore compté (defis.reset). */
export function beginRun() {
  runState.counted = false;
  runState.gained = 0;
  runState.succesRun.length = 0;
  journal.debut(); // § E5.X10
}

/**
 * Monnaie d'une partie (§ E4.I.2, remplace le § E4.A.3) : vagues TERMINÉES, k-ième boss, k-ième élite, succès de la
 * partie — chiffres dans META.bareme, calcul dans config.cyclesDetail. Rend le total.
 */
export function cyclesFor(vagues, boss, elites, succes) {
  return cyclesDetail(nat(vagues), nat(boss), nat(elites), nat(succes), {}).total;
}

/**
 * Crédite n unités de la monnaie méta (hors combat). source : 'jeu' (fin de partie) ou 'achat' (réservé à l'étape
 * Steam : AUCUN paiement n'est codé ici). Un solde unique ; deux totaux séparés. Rend le nouveau solde.
 */
export function credit(n, source) {
  const k = nat(n);
  data.cycles += k;
  if (source === 'achat') data.cyclesAchetes += k;
  else data.cyclesTotal += k;
  write();
  return data.cycles;
}

/**
 * Fin de partie (une fois : enterGameOver, ou quitToTitle / restart depuis la pause). summary : compteurs de defis
 * ({ killsByType, boss, elites, coffres, fragments, agent }). Calcule et crédite les Cycles, met à jour les
 * statistiques et lastRun, écrit. Rend lastRun (null si la partie est déjà comptée).
 */
export function finishRun(run, summary) {
  if (runState.counted) return null;
  runState.counted = true;
  const wave = nat(run.wave);
  const vagues = nat(summary.vagues); // § E4.I.2 : vagues TERMINÉES (la vague où l'on meurt ou que l'on quitte ne paie pas)
  if (wave === 0 && runState.succesRun.length === 0) return null; // quittée pendant le premier compte à rebours : pas une partie
  // § E4.I.1 : « Recommencer » pendant la vague 1 reste une partie (robots détruits comptés) mais ne rapporte rien
  const S = data.stats;
  const nSucces = runState.succesRun.length;
  const det = cyclesDetail(vagues, nat(summary.boss), nat(summary.elites), nSucces, {});
  const gain = det.total;
  data.cycles += gain;
  data.cyclesTotal += gain;
  runState.gained = gain;
  S.parties++;
  S.vagues += vagues;
  S.tempsJeu += Number.isFinite(run.time) && run.time > 0 ? Math.round(run.time) : 0;
  S.cyclesSucces += det.succes;
  S.kills += nat(run.kills);
  for (let t = 0; t < ENEMY_COUNT; t++) S.killsByType[t] += nat(summary.killsByType[t]);
  S.boss += nat(summary.boss);
  S.elites += nat(summary.elites);
  S.coffres += nat(summary.coffres);
  S.fragments += nat(summary.fragments);
  S.evolutionsFaites += nat(run.evolved);
  S.fusionsFaites += nat(run.fusions);
  // § E5.Q (Femz, 21/11) : la cause du coup mortel (0 : partie quittée, ou mort sans coup du debug — rien de compté)
  const mc = nat(summary.mortCause);
  if (mc > 0 && mc < CAUSE_COUNT) S.mortsParCause[mc]++;
  const a = run.agent >= 0 && run.agent < AGENT_COUNT ? run.agent : 0;
  if (wave > S.meilleureVagueAgent[a]) S.meilleureVagueAgent[a] = wave;
  //#region e5:X10-journal
  // § E5.X10 (audit I5) : relances de cartes de la partie (stats.relances, déclaré au § E4.A.1, jamais rempli avant), et
  // l'entrée du journal — écrite avec le reste, une fois par partie (garde runState.counted)
  S.relances += journal.relancesPartie();
  data.journal.push(journal.entree(run, summary, Date.now()));
  if (data.journal.length > JOURNAL.max) data.journal.splice(0, data.journal.length - JOURNAL.max);
  //#endregion e5:X10-journal
  data.lastRun = {
    date: Date.now(),
    agent: a,
    wave,
    kills: nat(run.kills),
    boss: nat(summary.boss),
    elites: nat(summary.elites),
    succes: runState.succesRun.map((s) => DEFIS.list[s].key),
    vagues,
    cycles: { vagues, vague: det.vague, boss: det.boss, elites: det.elites, succes: det.succes, total: gain },
    solde: data.cycles,
  };
  write();
  return data.lastRun;
}

export function isRunCounted() {
  return runState.counted;
}

/** Achat d'un élément en vente (onglet Déblocages, hors combat). */
export function buy(key) {
  if (data.unlocked.indexOf(key) >= 0 || (LOCKED.has(key) && mode === 'tout')) return META_BUY.ALREADY;
  if (!isForSale(key)) return META_BUY.NOT_FOR_SALE;
  const p = META.prix[key];
  if (data.cycles < p) return META_BUY.TOO_POOR;
  data.cycles -= p;
  data.unlocked.push(key);
  write();
  return META_BUY.OK;
}

/** Clés en vente pour l'onglet Déblocages : { key, prix, etat: 'vente' | 'debloque' | 'attente', succes } (hors combat). */
export function forSale(out) {
  out.length = 0;
  for (const key in META.prix) {
    let succes = -1;
    for (let s = 0; s < DEFI_COUNT; s++) if (DEFIS.list[s].reward === key && DEFIS.list[s].sorte === DEFI_RECOMP.VENTE) succes = s;
    const etat = data.unlocked.indexOf(key) >= 0 || mode === 'tout' ? 'debloque' : isForSale(key) ? 'vente' : 'attente';
    out.push({ key, prix: META.prix[key], etat, succes });
  }
  return out;
}

export function getCycles() {
  return data.cycles;
}

export function getStats() {
  return data.stats;
}

export function getLastRun() {
  return data.lastRun;
}

//#region e5:X10-journal
/** § E5.X10 : les parties du journal (de la plus ancienne à la plus récente ; lecture seule). */
export function getJournal() {
  return data.journal;
}

/** § E5.X10 : le texte de « Copier mes stats » (hors combat : pause, Noyau). */
export function journalTexte() {
  return journal.texte(data.journal);
}
//#endregion e5:X10-journal

/** Progression remise à zéro (bouton du hub, avec confirmation) : le record et les réglages ne sont pas touchés. */
export function reset() {
  reinit();
  write();
  applyToRun();
}

/** ?debug et tests : 'vierge' | 'depart' | 'tout' (en mémoire, jamais écrit) ou 'stockage' (relit le stockage). */
export function debugPreset(name) {
  if (name === 'stockage') {
    load(null);
    return mode;
  }
  load(name);
  return mode;
}

/** Tests et ?debug seulement (v1 : vide les découvertes). */
export function debugClear() {
  data.evolutions.length = 0;
  data.fusions.length = 0;
}

/** Tests : Cycles posés (en mémoire ; écrits au prochain moment hors combat). */
export function debugSetCycles(n) {
  data.cycles = nat(n);
  return data.cycles;
}

/** Copie de la méta (tests, hub) : hors combat. */
export function inspect(out = {}) {
  out.mode = mode;
  out.erreurs = erreurs;
  out.data = JSON.parse(JSON.stringify(data));
  out.WEAPON_OK = Array.from(WEAPON_OK);
  out.ITEM_OK = Array.from(ITEM_OK);
  out.UTIL_OK = Array.from(UTIL_OK);
  out.AGENT_OK = Array.from(AGENT_OK);
  out.run = { counted: runState.counted, gained: runState.gained, succes: runState.succesRun.slice() };
  return out;
}

export { KINDS };
