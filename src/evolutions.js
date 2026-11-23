// PLAN ADDICTIF, ÉTAPE 3, CHANTIER B : evolutions.js — toutes les armes évoluent (ARCHITECTURE.md § E3.B).
// Règle : arme au maximum (niveau 21 : ses 5 lignes au niveau 5 ; la surcharge ne compte pas) + catalyseur possédé →
// le coffre suivant donne l'évolution (lot LOT_EVOLUTION, Noyau, toujours gagné ; chests.js). « Arme + objet » : l'objet
// n'est jamais consommé. « Arme + arme » : le partenaire est absorbé (weapons.absorb), son emplacement se libère.
// Recette cachée « ? » tant que non découverte (src/meta.js, découverte quand le coffre la révèle).
//
// Effets évolués : ce module tient un petit pool de projectiles évolués (dessinés dans le lot TIRS, losange à la
// couleur de l'arme) et une file d'effets différés (échos, ondes, éclairs, éclats). Il est appelé :
//   • par damage.hitEnemyF après un coup d'une arme évoluée (onHitF, jamais pour un coup DMG.PROC : les effets d'ici
//     frappent en DMG.PROC, ils ne se relancent donc jamais eux-mêmes) ;
//   • par weapons.js et weapons-agents.js à un instant précis d'une arme évoluée (eventF : arrivée d'une roquette,
//     salve du rail, demi-tour du boomerang, frappe du marteau, finition du katana, fin d'une fumée, tir du canon),
//     point et direction dans ARGF (F_X, F_Z, F_DX, F_DZ) ;
//   • par weapons.update (update) et weapons.sync (sync), une fois par image.
// Rien n'est alloué en combat (§ V) : pools en tableaux typés créés au chargement, flottants des appels par ARGF et par
// le registre ARG ci-dessous (cases réécrites seulement quand elles changent, comme weapons-agents.js).
import {
  ARSENAL_VFX,
  DMG,
  DMG_SOURCE_COUNT,
  EVOLUTION_COUNT,
  EVOLUTION_RULES,
  EVOLUTIONS,
  FXK,
  GRID,
  ITEM_KEYS,
  ITEMS,
  SFX,
  STAT,
  TRAUMA,
  VFX_STYLE,
  WEAPON,
  WEAPON_COUNT,
  WEAPON_KEYS,
  WEAPONS,
} from './config.js';
import { ARGF, E, F_DX, F_DZ, F_SX, F_SZ, F_T, F_V, F_X, F_Z, P, run } from './state.js';
import * as V from './vfx/projectiles.js';
import * as meta from './meta.js';

let ctx = null;
let weapons = null;
let items = null;
let damage = null;
let grid = null;
let enemies = null;
let audio = null;
let camera = null;
let player = null;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const R = EVOLUTION_RULES;
const Q = V.Q;
const STRIDE = V.STRIDE;

// ----- recettes résolues à init (clés → indices ; −1 = arme ou objet absent du jeu : l'évolution se tait) ------------
export const WEAPON_OF = new Int8Array(EVOLUTION_COUNT).fill(-1);
export const ITEM_OF = new Int8Array(EVOLUTION_COUNT).fill(-1);
export const PARTNER_OF = new Int8Array(EVOLUTION_COUNT).fill(-1);
const EVO_OF_WEAPON = new Int8Array(WEAPON_COUNT).fill(-1); // arme → évolution qui la prend comme arme principale
/** ON[source] = 1 : la source de dégâts (= l'arme) est évoluée. Lu par damage.hitEnemyF (une comparaison par coup). */
export const ON = new Uint8Array(DMG_SOURCE_COUNT);
/** Couronne de scies : multiplicateur du rayon de l'orbite (1 sans l'évolution). Lu par weapons.js. */
export const ORBIT_MUL = new Float64Array(1);
ORBIT_MUL[0] = 1;

const W_BLASTER = WEAPON.BLASTER;
const W_ORBITALS = WEAPON.ORBITALS;
const W_SHOTGUN = WEAPON.SHOTGUN;
const W_EMP = WEAPON.EMP;
const W_RAIL = WEAPON.RAIL;
const W_ROCKETS = WEAPON.ROCKETS;
const W_BLADE = WEAPON.BLADE;
const W_POOL = WEAPON.POOL;
const W_BOOMERANG = WEAPON.BOOMERANG;
const W_MINES = WEAPON.MINES;
const W_KATANA = WEAPON.KATANA;
const W_GRENADE = WEAPON.GRENADE;
const W_SMOKE = WEAPON.SMOKE;
const W_FLASH = WEAPON.FLASH;
const W_CANNON = WEAPON.CANNON;
const W_HAMMER = WEAPON.HAMMER;
const COLOR = new Float32Array(WEAPON_COUNT); // indice de couleur VFX de chaque arme (lignes de N après celles des robots)
for (let w = 0; w < WEAPON_COUNT; w++) COLOR[w] = w < WEAPON.KATANA ? w : ARSENAL_VFX.couleur0 - WEAPON.KATANA + w;
/** Réglages de l'évolution d'une arme (EVOLUTIONS[id]), par arme. */
const CFG = new Array(WEAPON_COUNT).fill(null);
const ITEM_VIRUS = ITEM_KEYS.indexOf('virus');
const ITEM_SHIELD = ITEM_KEYS.indexOf('shield');

// ----- registre des flottants passés en argument (§ V) --------------------------------------------------------------
const A_X = 0;
const A_Z = 1;
const A_R = 2;
const A_DMG = 3;
const A_TRAUMA = 4;
const A_ZERO = 5;
const A_KB = 6;
const ARG = [null];
for (let k = 0; k < 8; k++) ARG[k] = 0;
function setArg(k, v) {
  if (ARG[k] !== v) ARG[k] = v;
}
const out = new Uint16Array(256);
const SAV = new Float64Array(8);
const S = new Float64Array(8);
const S_CLOCK = 0;
const S_DASH = 1; // P.dashT à l'image précédente (front montant = un dash part)
const S_PULSES = 2; // impulsions du condensateur déjà vues
const S_BURST = 3; // arme + 1 dont l'évolution vient d'être obtenue (éclat à la reprise), 0 sinon
const S_MARGE = 4; // updateShots : plus grand rayon de robot de la grille (lu une fois par image)
const GRID_MIN = GRID.min;
const GRID_INV = 1 / GRID.cellSize;
const GRID_DIM = GRID.dim;
const GRID_LAST = GRID.dim - 1;

// ----- compteurs (tests) ---------------------------------------------------------------------------------------------
const N_PROCS = new Int32Array(EVOLUTION_COUNT); // déclenchements de l'effet de chaque évolution
const N_HITS = new Int32Array(EVOLUTION_COUNT); // robots touchés par les effets de chaque évolution
const N_SPAWNED = new Int32Array(EVOLUTION_COUNT); // projectiles évolués lancés
const N_FRAME = new Int32Array(WEAPON_COUNT); // déclenchements dans l'image (plafond perFrame)
const LASTV = new Float64Array(8); // 0 dernier rayon de l'onde du séisme, 1 PV rendus par la dernière finition, 2 robots dans l'aura (dôme), 3 mines sautées à la dernière impulsion
let applied = 0;
let refused = 0;

// ----- projectiles évolués --------------------------------------------------------------------------------------------
const SCAP = R.shotCap;
const MEM = R.hitMemory;
const sX = new Float32Array(SCAP);
const sZ = new Float32Array(SCAP);
const sDX = new Float32Array(SCAP);
const sDZ = new Float32Array(SCAP);
const sSpd = new Float32Array(SCAP);
const sLeft = new Float32Array(SCAP); // m restants
const sTravel = new Float32Array(SCAP);
const sDmg = new Float32Array(SCAP);
const sRad = new Float32Array(SCAP);
const sBlast = new Float32Array(SCAP); // > 0 : explose (rayon, m) au premier robot ou au bout de sa course
const sBRange = new Float32Array(SCAP); // portée de recherche d'un rebond
const sW = new Uint8Array(SCAP);
const sEvo = new Uint8Array(SCAP);
const sPierce = new Uint8Array(SCAP);
const sBounce = new Uint8Array(SCAP);
const sHitN = new Uint8Array(SCAP);
const sHit = new Uint32Array(SCAP * MEM);
let shotCount = 0;
// entrées de spawnShotF (§ V : aucun flottant en argument)
const SH = new Float64Array(10);
const SH_X = 0;
const SH_Z = 1;
const SH_DX = 2;
const SH_DZ = 3;
const SH_DMG = 4;
const SH_SPD = 5;
const SH_RANGE = 6;
const SH_RAD = 7;
const SH_BLAST = 8;
const SH_BRANGE = 9;

function spawnShotF(w, pierce, bounces) {
  if (shotCount >= SCAP) return -1;
  const k = shotCount++;
  sX[k] = SH[SH_X];
  sZ[k] = SH[SH_Z];
  sDX[k] = SH[SH_DX];
  sDZ[k] = SH[SH_DZ];
  sSpd[k] = SH[SH_SPD];
  sLeft[k] = SH[SH_RANGE];
  sTravel[k] = 0;
  sDmg[k] = SH[SH_DMG];
  sRad[k] = SH[SH_RAD];
  sBlast[k] = SH[SH_BLAST];
  sBRange[k] = SH[SH_BRANGE];
  sW[k] = w;
  sEvo[k] = EVO_OF_WEAPON[w];
  sPierce[k] = pierce > 0 ? pierce : 1;
  sBounce[k] = bounces;
  sHitN[k] = 0;
  N_SPAWNED[EVO_OF_WEAPON[w]]++;
  return k;
}

function removeShot(k) {
  const last = --shotCount;
  if (k === last) return;
  sX[k] = sX[last];
  sZ[k] = sZ[last];
  sDX[k] = sDX[last];
  sDZ[k] = sDZ[last];
  sSpd[k] = sSpd[last];
  sLeft[k] = sLeft[last];
  sTravel[k] = sTravel[last];
  sDmg[k] = sDmg[last];
  sRad[k] = sRad[last];
  sBlast[k] = sBlast[last];
  sBRange[k] = sBRange[last];
  sW[k] = sW[last];
  sEvo[k] = sEvo[last];
  sPierce[k] = sPierce[last];
  sBounce[k] = sBounce[last];
  sHitN[k] = sHitN[last];
  for (let m = 0; m < MEM; m++) sHit[k * MEM + m] = sHit[last * MEM + m];
}

function shotHas(k, uid) {
  const n = sHitN[k] < MEM ? sHitN[k] : MEM;
  for (let m = 0; m < n; m++) if (sHit[k * MEM + m] === uid) return true;
  return false;
}

function shotRemember(k, uid) {
  sHit[k * MEM + (sHitN[k] % MEM)] = uid;
  if (sHitN[k] < 255) sHitN[k]++;
}

/** Explosion d'un effet évolué en (ARG[A_X], ARG[A_Z]) de rayon ARG[A_R], dégâts ARG[A_DMG] (weapon w). */
function blast(w, id) {
  Q[0] = ARG[A_X];
  Q[2] = ARG[A_Z];
  Q[3] = ARG[A_R];
  V.explosion(COLOR[w]);
  N_HITS[id] += damage.explode(ARG[A_X], ARG[A_Z], ARG[A_R], ARG[A_DMG], 0, w, DMG.PROC | DMG.BYPASS_SHIELD, FXK.ROCKET_TOON, ARG[A_TRAUMA], ARG[A_ZERO], ARG[A_KB]);
}

function shotBlast(k) {
  setArg(A_X, sX[k]);
  setArg(A_Z, sZ[k]);
  setArg(A_R, sBlast[k]);
  setArg(A_DMG, sDmg[k]);
  setArg(A_TRAUMA, 0);
  setArg(A_KB, 0);
  blast(sW[k], sEvo[k]);
}

/** Robot vivant le plus proche de (sX, sZ) du tir k, pas encore touché par lui, à moins de sBRange m ; −1 sinon. */
function nextTarget(k) {
  setArg(A_X, sX[k]);
  setArg(A_Z, sZ[k]);
  setArg(A_R, sBRange[k]);
  const n = grid.queryCircle(ARG[A_X], ARG[A_Z], ARG[A_R], out, out.length);
  let best = -1;
  let bd = 1e18;
  for (let q = 0; q < n; q++) {
    const i = out[q];
    if (E.alive[i] === 0 || E.sus[i] !== 0 || shotHas(k, E.uid[i])) continue;
    const dx = E.x[i] - sX[k];
    const dz = E.z[i] - sZ[k];
    const d = dx * dx + dz * dz;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/**
 * Robots vivants dont le cercle touche le disque du tir k (sX, sZ, sRad), dans out : même test, même ordre et même
 * résultat que grid.queryCircle, EN LIGNE sur les tableaux bruts de la grille (comme weapons.updateProjectiles, § F) —
 * sans les flottants que l'appel faisait allouer à chaque tir et à chaque image (§ V ; mesuré à la fusion du groupe 2 :
 * 260 à 650 octets par image dans updateShots au pire cas, tests/e3-g2-cadence.mjs). Aucun flottant en argument.
 */
function circleShotF(k) {
  const X = E.x;
  const Z = E.z;
  const RR = E.radius;
  const alive = E.alive;
  const cellStart = grid.cellStart;
  const cellCount = grid.cellCount;
  const items = grid.items;
  const x = sX[k];
  const z = sZ[k];
  const r = sRad[k];
  const reach = r + S[S_MARGE];
  let cx0 = Math.floor((x - reach - GRID_MIN) * GRID_INV);
  let cx1 = Math.floor((x + reach - GRID_MIN) * GRID_INV);
  let cz0 = Math.floor((z - reach - GRID_MIN) * GRID_INV);
  let cz1 = Math.floor((z + reach - GRID_MIN) * GRID_INV);
  cx0 = cx0 < 0 ? 0 : cx0 > GRID_LAST ? GRID_LAST : cx0;
  cx1 = cx1 < 0 ? 0 : cx1 > GRID_LAST ? GRID_LAST : cx1;
  cz0 = cz0 < 0 ? 0 : cz0 > GRID_LAST ? GRID_LAST : cz0;
  cz1 = cz1 < 0 ? 0 : cz1 > GRID_LAST ? GRID_LAST : cz1;
  const max = out.length;
  let n = 0;
  for (let cz = cz0; cz <= cz1; cz++) {
    const row = cz * GRID_DIM;
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = row + cx;
      const cnt = cellCount[c];
      if (cnt === 0) continue;
      const st = cellStart[c];
      for (let q = st; q < st + cnt; q++) {
        const i = items[q];
        if (alive[i] === 0) continue;
        const dx = X[i] - x;
        const dz = Z[i] - z;
        const rr = r + RR[i];
        if (dx * dx + dz * dz <= rr * rr) {
          if (n >= max) return n;
          out[n++] = i;
        }
      }
    }
  }
  const b = E.bossIndex;
  if (b >= 0 && alive[b] === 1 && n < max) {
    const dx = X[b] - x;
    const dz = Z[b] - z;
    const rr = r + RR[b];
    if (dx * dx + dz * dz <= rr * rr) out[n++] = b;
  }
  return n;
}

function updateShots(dt) {
  if (shotCount > 0) S[S_MARGE] = grid.getMaxRadius();
  for (let k = shotCount - 1; k >= 0; k--) {
    const step = sSpd[k] * dt;
    sX[k] += sDX[k] * step;
    sZ[k] += sDZ[k] * step;
    sTravel[k] += step;
    sLeft[k] -= step;
    const n = circleShotF(k);
    let gone = false;
    for (let q = 0; q < n && !gone; q++) {
      const i = out[q];
      if (E.alive[i] === 0 || E.sus[i] !== 0) continue;
      const uid = E.uid[i];
      if (shotHas(k, uid)) continue;
      shotRemember(k, uid);
      if (sBlast[k] > 0) {
        shotBlast(k);
        removeShot(k);
        gone = true;
        break;
      }
      ARGF[F_V] = sDmg[k];
      ARGF[F_SX] = sX[k] - sDX[k];
      ARGF[F_SZ] = sZ[k] - sDZ[k];
      if (damage.hitEnemyF(i, sW[k], DMG.PROC) > 0) N_HITS[sEvo[k]]++;
      sPierce[k]--;
      if (sPierce[k] > 0) continue;
      if (sBounce[k] > 0) {
        const t = nextTarget(k);
        if (t >= 0) {
          let dx = E.x[t] - sX[k];
          let dz = E.z[t] - sZ[k];
          const l = Math.sqrt(dx * dx + dz * dz);
          if (l > 1e-6) {
            sDX[k] = dx / l;
            sDZ[k] = dz / l;
          }
          sBounce[k]--;
          sPierce[k] = 1;
          sLeft[k] = sBRange[k] + 1;
          continue;
        }
      }
      removeShot(k);
      gone = true;
    }
    if (gone) continue;
    if (sLeft[k] <= 0) {
      if (sBlast[k] > 0) shotBlast(k);
      removeShot(k);
    }
  }
}

// ----- file d'effets différés ------------------------------------------------------------------------------------------
const QCAP = R.queueCap;
const qKind = new Uint8Array(QCAP);
const qT = new Float32Array(QCAP);
const qX = new Float32Array(QCAP);
const qZ = new Float32Array(QCAP);
const qR = new Float32Array(QCAP);
const qDmg = new Float32Array(QCAP);
const qW = new Uint8Array(QCAP);
const qI = new Uint16Array(QCAP);
const qUid = new Uint32Array(QCAP);
let qN = 0;
const K_HIT = 1; // coup différé sur le robot qI (s'il est encore le même : qUid) — lame fantôme
const K_BOLT = 2; // éclair tombé du ciel sur le robot qI — foudre de l'ombre
const K_WAVE = 3; // onde au sol en (qX, qZ), rayon qR — séisme

function push(kind, w, delay) {
  if (qN >= QCAP) return -1;
  const k = qN++;
  qKind[k] = kind;
  qW[k] = w;
  qT[k] = delay;
  return k;
}

function runQueued(k) {
  const w = qW[k];
  const id = EVO_OF_WEAPON[w];
  const kind = qKind[k];
  if (kind === K_HIT || kind === K_BOLT) {
    const i = qI[k];
    if (E.alive[i] === 0 || E.uid[i] !== qUid[k]) return;
    const x = E.x[i];
    const z = E.z[i];
    if (kind === K_BOLT) {
      // éclair vertical : de height m au-dessus du robot jusqu'à lui (arc de l'EMP, éclat au bout)
      const h = CFG[w].height;
      Q[0] = x;
      Q[1] = h;
      Q[2] = z;
      Q[4] = 0;
      Q[5] = -1;
      Q[6] = 0;
      Q[7] = h;
      V.arc(1);
      ARGF[F_X] = x;
      ARGF[F_Z] = z;
      audio.playF(SFX.ITEM_TESLA); // § E5.AD : l'éclair tombe sur le robot
    } else {
      // image de la lame : un croissant pâle sur le robot
      Q[0] = x;
      Q[1] = 0.9;
      Q[2] = z;
      Q[3] = 1.4;
      Q[4] = P.x < x ? 1 : -1;
      Q[5] = 0;
      Q[6] = 0;
      Q[7] = 120 * DEG;
      Q[8] = 0.5;
      Q[9] = 1.4 * 1.3;
      V.evenement(VFX_STYLE.CROISSANT);
    }
    ARGF[F_V] = qDmg[k];
    ARGF[F_SX] = P.x;
    ARGF[F_SZ] = P.z;
    if (damage.hitEnemyF(i, w, DMG.PROC | DMG.BYPASS_SHIELD) > 0) N_HITS[id]++;
    return;
  }
  if (kind === K_WAVE) {
    setArg(A_X, qX[k]);
    setArg(A_Z, qZ[k]);
    setArg(A_R, qR[k]);
    setArg(A_DMG, qDmg[k]);
    setArg(A_TRAUMA, 0.25);
    setArg(A_KB, CFG[w].knockback);
    LASTV[0] = qR[k];
    blast(w, id);
  }
}

function updateQueue(dt) {
  for (let k = 0; k < qN; ) {
    qT[k] -= dt;
    if (qT[k] > 0) {
      k++;
      continue;
    }
    runQueued(k);
    // retrait par échange avec le dernier (l'ordre des effets restants n'a pas d'importance)
    const last = --qN;
    if (k !== last) {
      qKind[k] = qKind[last];
      qT[k] = qT[last];
      qX[k] = qX[last];
      qZ[k] = qZ[last];
      qR[k] = qR[last];
      qDmg[k] = qDmg[last];
      qW[k] = qW[last];
      qI[k] = qI[last];
      qUid[k] = qUid[last];
    }
  }
}

// ----- outils des effets ------------------------------------------------------------------------------------------------
function dmgOf(w) {
  return weapons.getStat(w, STAT.DAMAGE);
}

/** n tirs évolués de l'arme w en éventail régulier autour de (SH_X, SH_Z) à partir de l'angle a0 (rad). */
function ring(w, n, a0, pierce, bounces) {
  for (let j = 0; j < n; j++) {
    const a = a0 + (j * TAU) / n;
    SH[SH_DX] = Math.cos(a);
    SH[SH_DZ] = Math.sin(a);
    spawnShotF(w, pierce, bounces);
  }
}

function fillShot(w, C, share) {
  SH[SH_DMG] = dmgOf(w) * share;
  SH[SH_SPD] = C.speed;
  SH[SH_RANGE] = C.range;
  SH[SH_RAD] = C.radius;
  SH[SH_BLAST] = 0;
  SH[SH_BRANGE] = 0;
}

// =====================================================================================================================
// API
// =====================================================================================================================

export function init(context) {
  ctx = context;
  weapons = ctx.weapons;
  items = ctx.items || null;
  damage = ctx.damage;
  grid = ctx.grid;
  enemies = ctx.enemies;
  audio = ctx.audio;
  camera = ctx.camera;
  player = ctx.player;
  for (let id = 0; id < EVOLUTION_COUNT; id++) {
    const D = EVOLUTIONS[id];
    const w = WEAPON_KEYS.indexOf(D.weapon);
    WEAPON_OF[id] = w;
    ITEM_OF[id] = D.item ? ITEM_KEYS.indexOf(D.item) : -1;
    PARTNER_OF[id] = D.partner ? WEAPON_KEYS.indexOf(D.partner) : -1;
    if (w >= 0) {
      EVO_OF_WEAPON[w] = id;
      CFG[w] = D;
    }
  }
}

export function reset() {
  ON.fill(0);
  ORBIT_MUL[0] = 1;
  S.fill(0);
  shotCount = 0;
  qN = 0;
  N_PROCS.fill(0);
  N_HITS.fill(0);
  N_SPAWNED.fill(0);
  LASTV.fill(0);
  applied = 0;
  refused = 0;
  run.evolved = 0;
  S[S_PULSES] = items !== null && typeof items.evoPulses === 'function' ? items.evoPulses() : 0;
}

/** Catalyseur de l'évolution id possédé (objet : au moins une pile ; partenaire : arme possédée, à tout niveau). */
function hasCatalyst(id) {
  const it = ITEM_OF[id];
  if (it >= 0) return items !== null && items.getStacks(it) > 0;
  const p = PARTNER_OF[id];
  return p >= 0 && weapons.owned[p] === 1;
}

/** L'évolution id peut sortir du prochain coffre : arme possédée au niveau 21, pas encore évoluée, catalyseur possédé. */
export function isReady(id) {
  const w = WEAPON_OF[id];
  if (w < 0 || weapons.owned[w] !== 1 || weapons.evolved[w] !== 0) return false;
  if (weapons.getWeaponLevel(w) < R.maxLevel) return false;
  return hasCatalyst(id);
}

/** Écrit dans out (Int8Array) les évolutions prêtes, dans l'ordre des emplacements d'armes ; rend leur nombre. */
export function ready(outIds) {
  let n = 0;
  const slots = weapons.slots;
  for (let k = 0; k < slots.length && n < outIds.length; k++) {
    const w = slots[k];
    if (w < 0) continue;
    const id = EVO_OF_WEAPON[w];
    if (id >= 0 && isReady(id)) outIds[n++] = id;
  }
  return n;
}

/** Hors combat (prise du lot d'évolution) : l'arme évolue, le partenaire est absorbé, la recette est découverte. */
export function apply(id) {
  if (!(id >= 0 && id < EVOLUTION_COUNT) || !isReady(id)) {
    refused++;
    return false;
  }
  const w = WEAPON_OF[id];
  if (!weapons.evolve(w, id)) {
    refused++;
    return false;
  }
  const p = PARTNER_OF[id];
  if (p >= 0) weapons.absorb(p);
  ON[w] = 1;
  meta.discover('evolutions', id);
  run.evolved++;
  applied++;
  S[S_BURST] = w + 1;
  audio.play(SFX.EVOLVE);
  return true;
}

export function isEvolved(w) {
  return w >= 0 && w < WEAPON_COUNT && weapons.evolved[w] !== 0;
}

/** Pour l'écran de pause (I) et le coffre : « ? » tant que la recette n'est pas découverte, sinon « Arme + catalyseur → Évolution ». Hors combat. */
export function hintFor(w) {
  const id = w >= 0 && w < WEAPON_COUNT ? EVO_OF_WEAPON[w] : -1;
  if (id < 0) return '';
  return meta.evoConnue(id) ? recipeText(id) : R.hidden; // § E5.X7 (H2) : découverte OU révélée par un succès (règle de la Collection)
}

/** « Blaster + Viseur thermique → Canon chiffré » (hors combat). */
export function recipeText(id) {
  const w = WEAPON_OF[id];
  const it = ITEM_OF[id];
  const p = PARTNER_OF[id];
  const cat = it >= 0 ? ITEMS[it].name : p >= 0 ? WEAPONS[p].name : '?';
  return (w >= 0 ? WEAPONS[w].name : '?') + ' + ' + cat + ' → ' + EVOLUTIONS[id].name;
}

// ----- crochets ---------------------------------------------------------------------------------------------------------

/**
 * damage.hitEnemyF : l'arme évoluée `source` vient de porter un coup au robot i (montant dans damage.LAST[0] ; le robot
 * est peut-être mort). crit = 1 si le coup était critique. Jamais appelé pour un coup DMG.PROC.
 */
export function onHitF(i, source, crit) {
  const w = source;
  const C = CFG[w];
  if (C === null) return;
  const id = C.id;
  if (w === W_BLASTER) {
    if (crit !== 1 || N_FRAME[w] >= C.perFrame) return;
    N_FRAME[w]++;
    // 2e balle perforante, du héros à travers le robot
    let dx = E.x[i] - P.x;
    let dz = E.z[i] - P.z;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1e-6) return;
    fillShot(w, C, C.share);
    SH[SH_X] = P.x;
    SH[SH_Z] = P.z;
    SH[SH_DX] = dx / l;
    SH[SH_DZ] = dz / l;
    if (spawnShotF(w, C.pierce, 0) >= 0) {
      N_PROCS[id]++;
      audio.play(SFX.BLASTER); // § E5.AD : la 2e balle part du héros (sans position : ARGF appartient à hitEnemyF)
    }
    return;
  }
  if (w === W_ORBITALS) {
    if (E.alive[i] !== 0 || N_FRAME[w] >= C.perFrame) return;
    N_FRAME[w]++;
    // mini-scie lancée du robot détruit vers le robot vivant le plus proche
    const x = E.x[i];
    const z = E.z[i];
    setArg(A_X, x);
    setArg(A_Z, z);
    setArg(A_R, C.range);
    const n = grid.queryCircle(ARG[A_X], ARG[A_Z], ARG[A_R], out, out.length);
    let best = -1;
    let bd = 1e18;
    for (let q = 0; q < n; q++) {
      const j = out[q];
      if (j === i || E.alive[j] === 0) continue;
      const d = (E.x[j] - x) * (E.x[j] - x) + (E.z[j] - z) * (E.z[j] - z);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    fillShot(w, C, C.share);
    SH[SH_X] = x;
    SH[SH_Z] = z;
    if (best >= 0) {
      const l = Math.sqrt(bd);
      SH[SH_DX] = l > 1e-6 ? (E.x[best] - x) / l : 1;
      SH[SH_DZ] = l > 1e-6 ? (E.z[best] - z) / l : 0;
    } else {
      const a = S[S_CLOCK] * 3.7;
      SH[SH_DX] = Math.cos(a);
      SH[SH_DZ] = Math.sin(a);
    }
    if (spawnShotF(w, C.pierce, 0) >= 0) {
      N_PROCS[id]++;
      audio.play(SFX.ORBITAL); // § E5.AD : la mini-scie part (dans l'orbite, à portée pleine : sans position)
    }
    return;
  }
  if (w === W_BLADE || w === W_FLASH) {
    const amount = damage.LAST[0];
    if (!(amount > 0) || E.alive[i] === 0) return;
    const k = push(w === W_BLADE ? K_HIT : K_BOLT, w, C.delay);
    if (k < 0) return;
    qI[k] = i;
    qUid[k] = E.uid[i];
    qDmg[k] = w === W_BLADE ? amount * C.share : dmgOf(w) * C.share;
    N_PROCS[id]++;
    return;
  }
  if (w === W_BOOMERANG) {
    if (E.alive[i] === 0) return;
    SAV[0] = ARGF[F_V];
    SAV[1] = ARGF[F_T];
    ARGF[F_V] = C.slow;
    ARGF[F_T] = C.seconds;
    enemies.applySlowF(i);
    ARGF[F_V] = SAV[0];
    ARGF[F_T] = SAV[1];
    N_PROCS[id]++;
    return;
  }
  if (w === W_POOL) {
    if (E.alive[i] === 0 || items === null || ITEM_VIRUS < 0 || items.getStacks(ITEM_VIRUS) === 0) return;
    // virus de l'objet, renforcé : la morsure de la nappe infecte (dot0 = le statut du Virus, items.update le décompte)
    const v = items.getValue(ITEM_VIRUS) * C.virusMul;
    if (E.dot0[i] < v) E.dot0[i] = v;
    if (E.dotT0[i] < C.seconds) E.dotT0[i] = C.seconds;
    N_PROCS[id]++;
  }
}

/**
 * Instant précis d'une arme évoluée w (weapons.js, weapons-agents.js) : point (ARGF[F_X], ARGF[F_Z]) et direction
 * unitaire (ARGF[F_DX], ARGF[F_DZ]) quand elle compte. W_SMOKE : fin d'une fumée laissée par les grenades évoluées.
 */
export function eventF(w) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  if (w === W_SMOKE) {
    // Nuage à fragmentation : la fumée explose, puis ses éclats partent en couronne
    const C = CFG[W_GRENADE];
    const g = W_GRENADE;
    setArg(A_X, x);
    setArg(A_Z, z);
    setArg(A_R, C.blast);
    setArg(A_DMG, dmgOf(g) * C.blastShare);
    setArg(A_TRAUMA, 0.2);
    setArg(A_KB, 0);
    blast(g, C.id);
    fillShot(g, C, C.share);
    SH[SH_X] = x;
    SH[SH_Z] = z;
    ring(g, C.shards, S[S_CLOCK], C.pierce, 0);
    N_PROCS[C.id]++;
    return;
  }
  const C = CFG[w];
  if (C === null || ON[w] === 0) return;
  const id = C.id;
  if (w === W_ROCKETS) {
    fillShot(w, C, C.share);
    SH[SH_BLAST] = C.blast;
    SH[SH_X] = x;
    SH[SH_Z] = z;
    ring(w, C.sub, S[S_CLOCK] * 1.3, 1, 0);
    N_PROCS[id]++;
  } else if (w === W_RAIL) {
    fillShot(w, C, C.share);
    SH[SH_BRANGE] = C.bounceRange;
    const a0 = Math.atan2(ARGF[F_DZ], ARGF[F_DX]);
    for (let j = 0; j < C.rays; j++) {
      const a = a0 + (j - (C.rays - 1) / 2) * C.spreadDeg * DEG;
      SH[SH_X] = x;
      SH[SH_Z] = z;
      SH[SH_DX] = Math.cos(a);
      SH[SH_DZ] = Math.sin(a);
      spawnShotF(w, C.pierce, C.bounces);
    }
    N_PROCS[id]++;
  } else if (w === W_BOOMERANG) {
    audio.playF(SFX.BOOMERANG); // § E5.AD : les 4 éclats partent du demi-tour (ARGF[F_X], ARGF[F_Z] = x, z)
    fillShot(w, C, C.share);
    SH[SH_X] = x;
    SH[SH_Z] = z;
    ring(w, C.shards, Math.PI / 4 + S[S_CLOCK], C.pierce, 0);
    N_PROCS[id]++;
  } else if (w === W_HAMMER) {
    const k = push(K_WAVE, w, C.delay);
    if (k < 0) return;
    qX[k] = x;
    qZ[k] = z;
    qR[k] = weapons.getStat(w, STAT.AREA) * C.radiusMul;
    qDmg[k] = dmgOf(w) * C.share;
    N_PROCS[id]++;
  } else if (w === W_KATANA) {
    // finition : PV rendus, dash remis à zéro (il sonne prêt à l'image suivante, comme une recharge normale)
    LASTV[1] = player.heal(C.heal);
    if (P.dashCd > 1e-4) P.dashCd = 1e-4;
    N_PROCS[id]++;
  } else if (w === W_CANNON) {
    // Forteresse : petite salve (l'ancienne Sentinelle) en éventail vers la cible
    fillShot(w, C, C.salvoShare);
    const a0 = Math.atan2(ARGF[F_DZ], ARGF[F_DX]);
    for (let j = 0; j < C.salvo; j++) {
      const a = a0 + (j - (C.salvo - 1) / 2) * C.salvoSpreadDeg * DEG;
      SH[SH_X] = x;
      SH[SH_Z] = z;
      SH[SH_DX] = Math.cos(a);
      SH[SH_DZ] = Math.sin(a);
      spawnShotF(w, C.pierce, 0);
    }
    N_PROCS[id]++;
  }
}

/** Une fois par image, à la fin de weapons.update (joueur vivant ou non : les effets lancés vont au bout). */
export function update(dt) {
  S[S_CLOCK] += dt;
  N_FRAME.fill(0);
  if (S[S_BURST] > 0 && P.alive) {
    // l'évolution vient d'être obtenue (au coffre) : éclat au pied du héros à la reprise du combat
    const w = S[S_BURST] - 1;
    S[S_BURST] = 0;
    Q[0] = P.x;
    Q[2] = P.z;
    Q[3] = R.burst.radius;
    V.explosion(COLOR[w]);
    camera.addTrauma(R.burst.trauma, TRAUMA.PLAYER_EXPLOSION);
  }
  // Couronne de scies : l'orbite respire
  if (ON[W_ORBITALS] !== 0) {
    const C = CFG[W_ORBITALS];
    const u = 0.5 - 0.5 * Math.cos((TAU * S[S_CLOCK]) / C.breathePeriod);
    ORBIT_MUL[0] = C.breatheMin + (C.breatheMax - C.breatheMin) * u;
  } else if (ORBIT_MUL[0] !== 1) ORBIT_MUL[0] = 1;
  // Brise-ligne : un dash part (front montant de P.dashT)
  const dashT = P.dashT;
  if (ON[W_SHOTGUN] !== 0 && P.alive && dashT > 0 && !(S[S_DASH] > 0)) {
    const C = CFG[W_SHOTGUN];
    fillShot(W_SHOTGUN, C, C.share);
    SH[SH_X] = P.x;
    SH[SH_Z] = P.z;
    ring(W_SHOTGUN, C.pellets, S[S_CLOCK], C.pierce, 0);
    N_PROCS[C.id]++;
    audio.play(SFX.SHOTGUN); // § E5.AD : l'anneau de plombs part du héros
  }
  S[S_DASH] = dashT;
  // Dôme ionique : le Pare-feu se recharge rechargeMul fois plus vite tant qu'un robot est dans l'aura de l'EMP
  if (ON[W_EMP] !== 0 && P.alive && items !== null && ITEM_SHIELD >= 0 && typeof items.evoShieldTickF === 'function') {
    setArg(A_X, P.x);
    setArg(A_Z, P.z);
    setArg(A_R, weapons.getStat(W_EMP, STAT.AREA));
    const n = grid.countCircle(ARG[A_X], ARG[A_Z], ARG[A_R]);
    LASTV[2] = n;
    if (n > 0) {
      SAV[2] = ARGF[F_T];
      ARGF[F_T] = dt * (CFG[W_EMP].rechargeMul - 1);
      if (items.evoShieldTickF() === 1) N_PROCS[CFG[W_EMP].id]++;
      ARGF[F_T] = SAV[2];
    }
  }
  // Champ de mines : une impulsion du condensateur fait sauter toutes les mines
  if (items !== null && typeof items.evoPulses === 'function') {
    const p = items.evoPulses();
    if (p !== S[S_PULSES]) {
      S[S_PULSES] = p;
      if (ON[W_MINES] !== 0) {
        LASTV[3] = weapons.detonateMines();
        N_PROCS[CFG[W_MINES].id]++;
      }
    }
  }
  if (qN > 0) updateQueue(dt);
  if (shotCount > 0) updateShots(dt);
}

/** Dessin des projectiles évolués : à la suite du lot TIRS (après weapons.sync et weapons-agents.sync). */
export function sync() {
  if (shotCount === 0) return;
  const a = V.tampon(V.LOT.TIRS);
  const cap = V.capacite(V.LOT.TIRS);
  let n = V.compte[V.LOT.TIRS];
  for (let k = 0; k < shotCount && n < cap; k++) {
    const p = n * STRIDE;
    n++;
    a[p] = sX[k];
    a[p + 1] = R.shotHeight;
    a[p + 2] = sZ[k];
    a[p + 3] = 0.24 + sRad[k] * 0.3;
    a[p + 4] = sDX[k];
    a[p + 5] = 0;
    a[p + 6] = sDZ[k];
    a[p + 7] = sTravel[k] < 1.6 ? sTravel[k] : 1.6;
    a[p + 8] = VFX_STYLE.RICOCHET; // losange à la couleur de l'arme (partie entière de la graine) — styles EVO_A/B réservés
    a[p + 9] = COLOR[sW[k]] + ((k * 0.37) % 1) * 0.999;
    a[p + 10] = 1;
    a[p + 11] = 0.6;
  }
  V.compte[V.LOT.TIRS] = n;
}

/** Tests et ?debug : état et compteurs (hors combat). */
export function inspect(o = {}) {
  o.count = EVOLUTION_COUNT;
  o.applied = applied;
  o.refused = refused;
  o.shots = shotCount;
  o.queued = qN;
  o.orbitMul = ORBIT_MUL[0];
  o.lastWave = LASTV[0];
  o.lastHeal = LASTV[1];
  o.domeRobots = LASTV[2];
  o.minesBlown = LASTV[3];
  o.list = EVOLUTIONS.map((D, id) => ({
    id,
    key: D.key,
    name: D.name,
    weapon: WEAPON_OF[id],
    item: ITEM_OF[id],
    partner: PARTNER_OF[id],
    ready: weapons ? isReady(id) : false,
    evolved: WEAPON_OF[id] >= 0 && weapons ? weapons.evolved[WEAPON_OF[id]] === id + 1 : false,
    discovered: meta.isDiscovered('evolutions', id),
    hint: WEAPON_OF[id] >= 0 ? hintFor(WEAPON_OF[id]) : '',
    procs: N_PROCS[id],
    hits: N_HITS[id],
    spawned: N_SPAWNED[id],
  }));
  return o;
}
