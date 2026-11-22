// Sources à recharge (plan addictif, étape 3, chantier H — ARCHITECTURE.md § E3.H). Demande de Femz du 15/11 (17h) :
// « c'est jouissif quand on utilise tous ces trucs, mais si on les a en permanence ça rend les kills trop simples ».
//
// Une source « cheatée » (arme ou objet, liste mesurée : RECHARGES dans la région e3:H-recharges-portraits de config.js)
// ne tourne plus en permanence : quand elle est PRÊTE, elle part en un gros coup (fenêtre d'activité de
// RECHARGES[clé].active s, dégâts × burst, salve de départ), puis se RECHARGE (seconds − perLevel × (niveau − 1),
// jamais sous min). Chaque départ est un moment : son CD_FIRE + le son de l'arme, secousse et arrêt sur image dosés
// (réglage de secousse du joueur respecté par camera), éclat à la couleur de la source. SFX.CD_READY quand c'est prêt.
//
// État en tableaux typés, rien n'est alloué en combat (§ V). kind : 0 = arme (WEAPON.*), 1 = objet (ITEM.*).
//
// § E4.G (demande de Femz du 16/11, 11h55) : à chaque amélioration (niveau d'arme, pile d'objet), la recharge BAISSE
// et la fenêtre d'action MONTE : action(n) = min(activeMax, active + activePerLevel × (n − 1)) (région
// e4:G-recharges-niveaux). Les objets en mode recharge n'agissent que pendant leur fenêtre (ITEM_OPEN, lu par items.js),
// ouverte ici quand un robot est à `reach` m du héros.
import { ITEM_COUNT, ITEM_KEYS, RECHARGE, RECHARGES, SFX, TRAUMA, WEAPON_COUNT, WEAPON_KEYS } from './config.js';
import { P } from './state.js';
import * as V from './vfx/projectiles.js';

export const KIND_WEAPON = 0;
export const KIND_ITEM = 1;
const STRIDE = 32; // case = kind × STRIDE + id
const NB = 2 * STRIDE;

const ON = new Uint8Array(NB); // 1 : source en mode recharge
const BASE = new Float64Array(NB); // recharge au niveau 1 (s)
const PER = new Float64Array(NB); // s retirées par niveau
const MIN = new Float64Array(NB); // plancher (s)
const ACTIVE = new Float64Array(NB); // fenêtre d'activité (s)
const BURST = new Float64Array(NB); // multiplicateur de dégâts pendant la fenêtre
const RATE = new Float64Array(NB); // multiplicateur de cadence pendant la fenêtre
const SALVO = new Uint8Array(NB); // tirs de départ (armes à salve)
const LEFT = new Float64Array(NB); // s de recharge restantes (0 : prête)
const DUR = new Float64Array(NB); // durée de la recharge en cours
const WIN = new Float64Array(NB); // s de fenêtre restantes (> 0 : active)
const LAST = new Float64Array(NB).fill(-1e9); // horloge du dernier départ
const GAP = new Float64Array(NB).fill(1e9); // plus petit écart mesuré entre deux départs (tests)
const FIRES = new Int32Array(NB); // départs
const READIES = new Int32Array(NB); // retours à « prête »
const COLOR = new Uint8Array(NB); // indice de couleur de l'éclat (arme : son indice ; objet : arme de la palette la plus proche)
const CLOCK = new Float64Array(1);
// § E4.G
const APL = new Float64Array(NB); // s d'action gagnées par niveau
const AMAX = new Float64Array(NB); // plafond de l'action (s)
const REACH = new Float64Array(NB); // objets : un robot à cette distance ouvre la fenêtre (m)
const WDUR = new Float64Array(NB); // longueur de la fenêtre en cours (s), pour la jauge « action »
const WCLOSE = new Float64Array(NB).fill(-1); // horloge de la dernière fermeture de fenêtre (−1 : aucune)
const WINM = new Float64Array(NB).fill(-1); // dernière fenêtre MESURÉE (s, temps simulé ; tests)
const RECM = new Float64Array(NB).fill(-1); // dernière recharge MESURÉE (s, temps simulé ; tests)
const PROBE = new Uint16Array(1);
// § E4.M : départ de salve d'un OBJET — [éclat, secousse, arrêt sur image, son], 1 = joué (RECHARGE.departObjet)
const DO = RECHARGE.departObjet || {};
const DEPART_OBJET = Uint8Array.of(DO.eclat === 1 ? 1 : 0, DO.secousse === 1 ? 1 : 0, DO.arret === 1 ? 1 : 0, DO.son === 1 ? 1 : 0);
// § E4.M bis (chantier R) : éléments du départ PAR SOURCE (1 = joué), remplis par load : arme 1 / 1 / 1 / 1, objet
// DEPART_OBJET, et RECHARGES[clé].depart les remplace (grenades : sans éclat au héros, son gardé).
const DEP_ECLAT = new Uint8Array(NB);
const DEP_SECOUSSE = new Uint8Array(NB);
const DEP_ARRET = new Uint8Array(NB);
const DEP_SON = new Uint8Array(NB);
/** § E4.G : 1 si l'objet id peut agir cette image (hors mode recharge, ou fenêtre ouverte). Lu par items.js. */
export const ITEM_OPEN = new Uint8Array(STRIDE).fill(1);

let ctx = null;
let audio = null;
let camera = null;
let fx = null;
let weapons = null;
let items = null;
let anyOn = 0;
let grid = null;

function idx(kind, id) {
  return kind * STRIDE + id;
}

/** Lit RECHARGES (clés d'arme et d'objet) : les clés inconnues se taisent (arme d'un autre chantier absente). */
function load() {
  ON.fill(0);
  ITEM_OPEN.fill(1);
  anyOn = 0;
  const tables = [RECHARGES.weapons || {}, RECHARGES.items || {}];
  const keys = [WEAPON_KEYS, ITEM_KEYS];
  const counts = [WEAPON_COUNT, ITEM_COUNT];
  for (let kind = 0; kind < 2; kind++) {
    for (const k in tables[kind]) {
      const id = keys[kind].indexOf(k);
      if (id < 0 || id >= counts[kind] || id >= STRIDE) continue;
      const R = tables[kind][k];
      const i = idx(kind, id);
      ON[i] = 1;
      BASE[i] = R.seconds;
      PER[i] = R.perLevel || 0;
      MIN[i] = R.min;
      ACTIVE[i] = R.active || 0;
      BURST[i] = R.burst || RECHARGE.burstMul;
      RATE[i] = R.rateMul || 1;
      SALVO[i] = R.salvo || 0;
      APL[i] = R.activePerLevel || 0; // § E4.G
      AMAX[i] = R.activeMax > 0 ? R.activeMax : ACTIVE[i];
      REACH[i] = R.reach > 0 ? R.reach : 8;
      if (kind === KIND_ITEM) ITEM_OPEN[id] = 0; // fermé jusqu'à la première fenêtre
      // § E4.M bis : éléments du départ (défaut de la sorte de source, puis `depart` de la source)
      const objet = kind === KIND_ITEM;
      const D = R.depart || null;
      DEP_ECLAT[i] = D !== null && D.eclat !== undefined ? (D.eclat === 1 ? 1 : 0) : objet ? DEPART_OBJET[0] : 1;
      DEP_SECOUSSE[i] = D !== null && D.secousse !== undefined ? (D.secousse === 1 ? 1 : 0) : objet ? DEPART_OBJET[1] : 1;
      DEP_ARRET[i] = D !== null && D.arret !== undefined ? (D.arret === 1 ? 1 : 0) : objet ? DEPART_OBJET[2] : 1;
      DEP_SON[i] = D !== null && D.son !== undefined ? (D.son === 1 ? 1 : 0) : objet ? DEPART_OBJET[3] : 1;
      // VFX_COULEURS : 12 armes de l'étape 2, la ligne des robots (12), puis les 6 armes de N (§ E3.N)
      COLOR[i] = kind === KIND_WEAPON ? (id < 12 ? id : id + 1) : R.color || 0;
      anyOn = 1;
    }
  }
}

export function init(context) {
  ctx = context;
  audio = ctx.audio;
  camera = ctx.camera;
  fx = ctx.fx;
  weapons = ctx.weapons || null;
  items = ctx.items || null;
  grid = ctx.grid || null;
  load();
  reset();
}

/**
 * Tests (?debug) : coupe (false) ou rend (true) le mode recharge de toutes les sources. Coupé, chaque arme redevient
 * continue (weapons.GATE reste à 1) : les tests de la MÉCANIQUE d'une arme (weapons.test : orbite, cadence, taille
 * des disques) la mesurent comme avant le chantier H ; les recharges elles-mêmes sont mesurées par e3-H-recharges.
 * Ajouté à la fusion du groupe 2 (16/11/2026).
 */
export function debugEnable(on) {
  if (on) load();
  else {
    ON.fill(0);
    ITEM_OPEN.fill(1);
    anyOn = 0;
  }
  reset();
}

/** Début de partie : tout est prêt, rien n'est actif. */
export function reset() {
  LEFT.fill(0);
  DUR.fill(0);
  WIN.fill(0);
  LAST.fill(-1e9);
  GAP.fill(1e9);
  FIRES.fill(0);
  READIES.fill(0);
  CLOCK[0] = 0;
  WDUR.fill(0);
  WCLOSE.fill(-1);
  WINM.fill(-1);
  RECM.fill(-1);
  for (let id = 0; id < STRIDE; id++) ITEM_OPEN[id] = ON[KIND_ITEM * STRIDE + id] === 1 ? 0 : 1;
}

export function isCooldown(kind, id) {
  return ON[idx(kind, id)] === 1;
}

export function ready(kind, id) {
  const i = idx(kind, id);
  return ON[i] === 1 && LEFT[i] <= 0 && WIN[i] <= 0;
}

/** Fenêtre d'activité en cours (le gros coup). */
export function active(kind, id) {
  return WIN[idx(kind, id)] > 0;
}

/** Le départ a eu lieu dans cette image (cooldowns.update tourne avant les armes). */
export function justFired(kind, id) {
  return LAST[idx(kind, id)] === CLOCK[0];
}

export function burstOf(kind, id) {
  return BURST[idx(kind, id)];
}

export function rateOf(kind, id) {
  return RATE[idx(kind, id)];
}

export function salvoOf(kind, id) {
  return SALVO[idx(kind, id)];
}

function levelOf(kind, id) {
  if (kind === KIND_WEAPON) return weapons !== null ? weapons.getWeaponLevel(id) : 1;
  return items !== null ? items.getStacks(id) : 1;
}

/** Recharge au niveau courant : seconds − perLevel × (niveau − 1), jamais sous min (jamais 0). */
export function durationOf(kind, id) {
  const i = idx(kind, id);
  const lv = levelOf(kind, id);
  const d = BASE[i] - PER[i] * (lv > 1 ? lv - 1 : 0);
  return d > MIN[i] ? d : MIN[i];
}

/** § E4.G : recharge au niveau n (formule pure, hors combat : cartes et fiche). */
export function rechargeAt(kind, id, n) {
  const i = idx(kind, id);
  const d = BASE[i] - PER[i] * (n > 1 ? n - 1 : 0);
  return d > MIN[i] ? d : MIN[i];
}

/** § E4.G : fenêtre d'action au niveau n : active + activePerLevel × (n − 1), jamais au-dessus de activeMax. */
export function actionAt(kind, id, n) {
  const i = idx(kind, id);
  const a = ACTIVE[i] + APL[i] * (n > 1 ? n - 1 : 0);
  return a < AMAX[i] ? a : AMAX[i];
}

/** § E4.G : fenêtre d'action au niveau courant. */
export function actionOf(kind, id) {
  return actionAt(kind, id, levelOf(kind, id));
}

/**
 * § E5.H : état d'une source pour un visuel, écrit dans o (tableau typé : aucun flottant rendu, § V) : o[0] fenêtre
 * restante (s), o[1] longueur de la fenêtre en cours (s), o[2] recharge restante (s), o[3] recharge en cours (s),
 * o[4] 1 si la source est en mode recharge. Lecture seule.
 */
export function lireSource(kind, id, o) {
  const i = idx(kind, id);
  o[0] = WIN[i];
  o[1] = WDUR[i];
  o[2] = LEFT[i];
  o[3] = DUR[i];
  o[4] = ON[i];
}

/** § E4.G : s de fenêtre restantes (0 hors fenêtre). Lu par le canon lourd (weapons-agents.js). */
export function windowLeft(kind, id) {
  return WIN[idx(kind, id)];
}

const NUM = (v) => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');

/**
 * § E4.G : « Recharge 7,0 s → 6,8 s · Action 2,0 s → 2,2 s » entre les niveaux n0 et n1 (n0 = n1 ou n0 ≤ 0 : une seule
 * valeur, au niveau n1). Construit une chaîne : hors combat seulement (fiche, cartes).
 */
export function salvesTexte(kind, id, n0, n1) {
  const r1 = rechargeAt(kind, id, n1);
  const a1 = actionAt(kind, id, n1);
  //#region e5:L-textes-guide
  // § E5.L (C9) : une phrase avec la condition de départ (un robot à REACH m ouvre la fenêtre : update ici pour les
  // objets, weapons.js pour les armes, même portée lue dans RECHARGES) — « Actif » était du jargon
  const P_ = RECHARGE.phrase;
  const rch = NUM(REACH[idx(kind, id)]).replace(/,0$/, '');
  let a = NUM(a1);
  let c = NUM(r1);
  if (n0 > 0 && n0 !== n1) {
    const r0 = NUM(rechargeAt(kind, id, n0));
    const a0 = NUM(actionAt(kind, id, n0));
    if (a0 !== a) a = a0 + ' → ' + a;
    if (r0 !== c) c = r0 + ' → ' + c;
  }
  return (P_ ? P_.une : 'Agit {a} s dès qu’un robot est à moins de {r} m, puis se recharge {c} s.').replace('{a}', a).replace('{r}', rch).replace('{c}', c);
  //#endregion e5:L-textes-guide
}

/** § E5.L : portée (m) à laquelle un robot ouvre la fenêtre de la source (tests, textes). */
export function porteeDepart(kind, id) {
  return REACH[idx(kind, id)];
}

/**
 * Départ : la fenêtre s'ouvre (dégâts × burst), la recharge partira à sa fin. Rend true si le départ a eu lieu.
 * L'éclat part de la position du héros (P.x, P.z) : aucun flottant en argument.
 */
export function consume(kind, id) {
  const i = idx(kind, id);
  if (ON[i] === 0 || LEFT[i] > 0 || WIN[i] > 0) return false;
  const gap = CLOCK[0] - LAST[i];
  if (gap < GAP[i]) GAP[i] = gap;
  LAST[i] = CLOCK[0];
  FIRES[i]++;
  const a = actionOf(kind, id); // § E4.G : la fenêtre grandit avec le niveau
  WIN[i] = a > 0 ? a : 1e-6;
  WDUR[i] = WIN[i];
  if (kind === KIND_ITEM) ITEM_OPEN[id] = 1;
  DUR[i] = durationOf(kind, id);
  LEFT[i] = DUR[i];
  // le moment : son, secousse, arrêt sur image, éclat. § E4.M : pour un objet, l'ouverture de la fenêtre n'a aucune
  // cause visible (un robot à `reach` m) ; l'éclat centré sur le héros se lisait comme « une explosion au hasard autour
  // de lui » : l'objet ne garde que le son (§ E4.M bis). Les grenades non plus n'ont pas d'éclat au héros (§ E4.M bis) :
  // leur explosion est à l'impact. Réglages : RECHARGE.departObjet et RECHARGES[clé].depart (région e4:M).
  if (audio !== null && DEP_SON[i] === 1) audio.play(SFX.CD_FIRE);
  if (camera !== null && DEP_SECOUSSE[i] === 1) camera.addTrauma(RECHARGE.trauma, TRAUMA.PLAYER_EXPLOSION);
  if (fx !== null && DEP_ARRET[i] === 1) fx.hitstop(RECHARGE.hitstop);
  if (DEP_ECLAT[i] !== 1) return true;
  V.Q[0] = P.x;
  V.Q[1] = 0;
  V.Q[2] = P.z;
  V.Q[3] = RECHARGE.eclatRayon;
  V.explosion(COLOR[i]);
  return true;
}

/** 0 → 1 dans le sens de la recharge (1 : prête) ; pendant la fenêtre : 0 (la jauge repart du vide). */
export function fraction(kind, id) {
  const i = idx(kind, id);
  if (ON[i] === 0) return 1;
  if (WIN[i] > 0) return 0;
  if (LEFT[i] <= 0) return 1;
  const f = 1 - LEFT[i] / (DUR[i] > 0 ? DUR[i] : 1);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * Cran de la jauge, ENTIER (fusion du groupe 2, § V) : floor(fraction × steps) borné à steps. ui.js le lit à chaque
 * image pour chaque case : un flottant rendu par case et par image était un nombre alloué (mesuré au pire cas,
 * tests/e3-g2-cadence.mjs) ; un petit entier ne l'est pas.
 */
export function stepOf(kind, id, steps) {
  const i = idx(kind, id);
  if (ON[i] === 0 || (WIN[i] <= 0 && LEFT[i] <= 0)) return steps;
  if (WIN[i] > 0) {
    // § E4.G : pendant la fenêtre, steps + 1 + cran de ce qui RESTE (la jauge « action » se vide)
    const r = Math.floor((WIN[i] / (WDUR[i] > 0 ? WDUR[i] : 1)) * steps + 1e-6);
    return steps + 1 + (r > steps ? steps : r < 0 ? 0 : r);
  }
  const f = 1 - LEFT[i] / (DUR[i] > 0 ? DUR[i] : 1);
  const q = Math.floor((f < 0 ? 0 : f) * steps + 1e-6);
  return q > steps ? steps : q;
}

/** Recharges à jour (simulation, PLAYING). La recharge ne court qu'une fois la fenêtre refermée. */
export function update(dt) {
  CLOCK[0] += dt;
  if (anyOn === 0) return;
  for (let i = 0; i < NB; i++) {
    if (ON[i] === 0) continue;
    if (WIN[i] > 0) {
      WIN[i] -= dt;
      if (WIN[i] <= 0) {
        WIN[i] = 0;
        WINM[i] = CLOCK[0] - LAST[i]; // § E4.G : fenêtre mesurée (départ → fermeture)
        WCLOSE[i] = CLOCK[0];
        if (i >= STRIDE) ITEM_OPEN[i - STRIDE] = 0;
      }
      continue;
    }
    if (LEFT[i] > 0) {
      LEFT[i] -= dt;
      if (LEFT[i] <= 0) {
        LEFT[i] = 0;
        READIES[i]++;
        if (WCLOSE[i] >= 0) RECM[i] = CLOCK[0] - WCLOSE[i]; // § E4.G : recharge mesurée (fermeture → prête)
        const kind = i < STRIDE ? KIND_WEAPON : KIND_ITEM;
        const id = i - kind * STRIDE;
        if (audio !== null && levelOf(kind, id) > 0 && owns(kind, id)) audio.play(SFX.CD_READY);
      }
    }
    // § E4.G : un objet prêt ouvre sa fenêtre dès qu'un robot est à sa portée (les armes l'ouvrent dans weapons.js)
    if (i >= STRIDE && LEFT[i] <= 0 && WIN[i] <= 0 && P.alive && grid !== null) {
      const id = i - STRIDE;
      if (owns(KIND_ITEM, id) && grid.queryCircle(P.x, P.z, REACH[i], PROBE, 1) > 0) consume(KIND_ITEM, id);
    }
  }
}

function owns(kind, id) {
  if (kind === KIND_WEAPON) return weapons !== null && weapons.owned[id] === 1;
  return items !== null && items.getStacks(id) > 0;
}

/** Tests : départs, plus petit écart entre deux départs, recharge courante, par source en mode recharge. */
export function inspect(out) {
  out.clock = CLOCK[0];
  out.sources = [];
  for (let i = 0; i < NB; i++) {
    if (ON[i] === 0) continue;
    const kind = i < STRIDE ? KIND_WEAPON : KIND_ITEM;
    const id = i - kind * STRIDE;
    out.sources.push({
      kind,
      id,
      key: kind === KIND_WEAPON ? WEAPON_KEYS[id] : ITEM_KEYS[id],
      fires: FIRES[i],
      readies: READIES[i],
      minGap: GAP[i] >= 1e8 ? null : GAP[i],
      left: LEFT[i],
      win: WIN[i],
      duration: owns(kind, id) ? durationOf(kind, id) : null,
      action: owns(kind, id) ? actionOf(kind, id) : null, // § E4.G
      level: levelOf(kind, id),
      winMeasured: WINM[i] >= 0 ? WINM[i] : null,
      rechargeMeasured: RECM[i] >= 0 ? RECM[i] : null,
      fraction: fraction(kind, id),
    });
  }
  return out;
}
