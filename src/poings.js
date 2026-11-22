// ÉTAPE 5, CHANTIER F (ARCHITECTURE.md § E5.F) — coups de poing du Bastion. Demande de Femz du 17/11, mot pour mot :
// « Bastion sans arme, il doit pouvoir mettre des coups de poing qui font autant de dégâts que le blaster de
// l'Éclaireur, avec un camera shake, et qui repoussent les ennemis ».
//
// Attaque de BASE du Bastion (supposé : toujours active, en plus de ses armes — la Sentinelle est posée au sol, il a les
// mains libres). Sur le robot le plus proche à portée de mêlée, à la cadence du blaster ; le combo COMBO_POING (config.js,
// région e5:F-anim-agents) enchaîne gauche, droite, gauche, uppercut. Le geste est joué par combos.js (poses clés,
// heros-anim) ; les dégâts tombent à l'image de l'impact (impactF), × mul du geste (moyenne 1 : DPS = blaster).
// Retour : arrêt sur image et secousse (combos.juiceF : nuls si le réglage de secousse est à 0), son de la banque
// (SFX.COUP_PIED, joué en avance par combos), recul du robot divisé par sa masse (élites × eliteMul, boss jamais).
// Zéro allocation : tableaux typés, aucun flottant passé en argument ni rendu (recherche du robot : parcours direct).
import { AGENT, COMBO, COMBO_POING, DMG, ENEMY, EFLAG, POINGS, STAT, STAT_COUNT, WEAPON, WEAPONS } from './config.js';
import { ARGF, E, F_DX, F_DZ, F_SX, F_SZ, F_V, P, mods, run } from './state.js';
import { DMG_SRC } from './config.js';
import * as CB from './anim/combos.js';
import { armesCoupees } from './anim/coup-pied.js';
import { levels } from './weapons.js';

let grid = null;
let damage = null;
let enemies = null;
const B = WEAPONS[WEAPON.BLASTER].stats;
const ON = POINGS.actif ? 1 : 0;
const S = new Float64Array(8); // [0] cadence accumulée, [3] portée de la recherche (bord), [5] cadence, [6] dégâts, [7] meilleure distance
const UN = new Float64Array([1, 1.25, 0.8]); // [2] : reprise de la recherche (0,2 coup ≈ 0,1 s au niveau 1)
const CIBLE = new Int32Array(2);
const L_MUL = Float64Array.from(POINGS.mul); // multiplicateur de chaque geste du combo // [0] robot visé, [1] son uid
// relevés (tests) : coups, touchés, dégâts, reculs
const N = new Float64Array(6);

export function init(ctx) {
  grid = ctx.grid;
  damage = ctx.damage;
  enemies = ctx.enemies;
  reset();
}

export function reset() {
  S.fill(0);
  calculer();
  CIBLE.fill(-1);
  N.fill(0);
}

/** Niveau (1 à 5) d'une statistique de la Sentinelle (arme de départ du Bastion) ; 1 si elle n'est pas possédée. */
function niveau(s) {
  const lv = levels[WEAPON.TURRET * STAT_COUNT + s];
  return lv > 0 ? lv : 1;
}

/** S[6] = dégâts d'un coup avant le multiplicateur du geste (ceux d'un tir de blaster au même niveau) ; S[5] = coups par
 *  seconde (la cadence du blaster au même niveau). */
function calculer() {
  S[6] = B[STAT.DAMAGE][niveau(STAT.DAMAGE) - 1] * mods.damageMul;
  S[5] = B[STAT.RATE][niveau(STAT.RATE) - 1] * mods.fireRateMul;
}

/** Une fois par image, après combos.update (weapons.update). */
export function update(dt) {
  if (ON === 0 || run.agent !== AGENT.BASTION || !P.alive || grid === null) return;
  // § E5.F.13 (demande de Femz du 17/11) : dès qu'il a le marteau, il ne frappe plus qu'au marteau — poings effacés
  if (POINGS.sansMarteau !== false && levels[WEAPON.HAMMER * STAT_COUNT] > 0) {
    if (CB.busy(COMBO_POING) === 0) S[0] = 0;
    return;
  }
  // impact du geste en cours : le robot visé, s'il est encore à portée (+ rattrape), sinon le plus proche
  if (CB.impactF(COMBO_POING) === 1) frapper();
  // § V : cadence et dégâts écrits dans S (une fonction qui rend un flottant l'emballe), recalculés à chaque coup demandé
  // ou à chaque recherche vaine (un niveau gagné compte dès le coup suivant), pas à chaque image
  S[0] += dt * S[5];
  if (S[0] > UN[1]) S[0] = UN[1]; // au repos : prêt, sans réserve de coups
  if (S[0] < 1 || armesCoupees()) return;
  // le corps est déjà pris par un geste de pose de tourelle ou de marteau : le coup attend
  if (CB.busy(COMBO_POING) === 1 || CB.busy(COMBO.POSE) === 1 || CB.busy(COMBO.HAMMER) === 1) return;
  calculer();
  S[3] = POINGS.portee; // portée au bord du robot
  const i = plusProche();
  // personne à portée : nouvelle recherche dans ≈ 0,1 s (une recherche par image passerait 3 flottants par appel)
  if (i < 0 || E.alive[i] === 0) {
    S[0] = UN[2];
    return;
  }
  const dx = E.x[i] - P.x;
  const dz = E.z[i] - P.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d - E.radius[i] > POINGS.portee) {
    S[0] = UN[2];
    return;
  }
  CIBLE[0] = i;
  CIBLE[1] = E.uid[i];
  CB.D[0] = d > 1e-6 ? dx / d : Math.sin(P.rot);
  CB.D[1] = d > 1e-6 ? dz / d : Math.cos(P.rot);
  if (CB.requestF(COMBO_POING) === 1) {
    S[0] -= 1; // le reste est gardé : cadence exacte
    N[0]++;
  }
}

/**
 * Robot vivant le plus proche dont le BORD est à moins de S[3] m du héros ; −1 sinon. Parcours direct des robots (une
 * recherche par coup demandé, ou toutes les 0,1 s sans cible) : grid.queryNearest recevait trois flottants en
 * arguments, emballés par V8 à chaque appel (≈ 90 o/image mesurés, § E5.F).
 */
function plusProche() {
  const X = E.x;
  const Z = E.z;
  const R = E.radius;
  const n = E.count;
  let best = -1;
  S[7] = S[3];
  for (let i = 0; i < n; i++) {
    if (E.alive[i] === 0 || E.sus[i] !== 0) continue;
    const dx = X[i] - P.x;
    const dz = Z[i] - P.z;
    const d = Math.sqrt(dx * dx + dz * dz) - R[i];
    if (d < S[7]) {
      S[7] = d;
      best = i;
    }
  }
  return best;
}

function frapper() {
  let i = CIBLE[0];
  if (i >= 0 && (E.alive[i] === 0 || E.uid[i] !== CIBLE[1])) i = -1;
  if (i >= 0) {
    const dx = E.x[i] - P.x;
    const dz = E.z[i] - P.z;
    if (Math.sqrt(dx * dx + dz * dz) - E.radius[i] > POINGS.portee + POINGS.rattrape) i = -1;
  }
  if (i < 0) {
    S[3] = POINGS.portee + POINGS.rattrape;
    const j = plusProche();
    if (j >= 0 && E.alive[j] === 1) {
      const dx = E.x[j] - P.x;
      const dz = E.z[j] - P.z;
      if (Math.sqrt(dx * dx + dz * dz) - E.radius[j] <= POINGS.portee + POINGS.rattrape) i = j;
    }
  }
  let touches = 0;
  if (i >= 0) {
    const s = CB.stepOf(COMBO_POING);
    ARGF[F_V] = S[6] * L_MUL[CB.stepOf(COMBO_POING)];
    ARGF[F_SX] = P.x;
    ARGF[F_SZ] = P.z;
    const r = damage.hitEnemyF(i, DMG_SRC.ITEM, DMG.NONE);
    if (r > 0) {
      touches = 1;
      N[1]++;
      N[2] += damage.LAST ? damage.LAST[0] : 0;
    }
    // recul : poussé dans l'axe héros → robot, divisé par sa masse (applyKnockbackF) ; élites moins, boss jamais
    if (r !== 0 && E.alive[i] === 1 && E.type[i] !== ENEMY.BOSS) {
      const dx = E.x[i] - P.x;
      const dz = E.z[i] - P.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      ARGF[F_DX] = d > 1e-6 ? dx / d : CB.dir(COMBO_POING, 0);
      ARGF[F_DZ] = d > 1e-6 ? dz / d : CB.dir(COMBO_POING, 1);
      ARGF[F_V] = POINGS.recul[s] * ((E.flags[i] & EFLAG.ELITE) !== 0 ? POINGS.eliteMul : 1);
      enemies.applyKnockbackF(i);
      N[3]++;
    }
  }
  CB.juiceF(COMBO_POING, touches); // arrêt sur image et secousse au contact (réglage de secousse respecté)
}

/** Tests et ?debug : relevés. */
export function inspect(out = {}) {
  out.actif = ON === 1 && run.agent === AGENT.BASTION;
  out.coups = N[0];
  out.touches = N[1];
  out.degatsTotal = N[2];
  out.reculs = N[3];
  calculer();
  out.degats = S[6];
  out.cadence = S[5];
  out.dps = S[6] * S[5];
  out.blasterDps = B[STAT.DAMAGE][0] * B[STAT.RATE][0];
  return out;
}
