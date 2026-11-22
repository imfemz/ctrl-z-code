// LOT : enemies — zones de danger au sol des ROBOTS (étape 1 du plan addictif, contrat : ARCHITECTURE.md § E1.B).
//
// Pool fixe de CAPS.hazards zones (tableaux typés, suppression par échange), sans rapport avec les zones du boss
// (boss.js garde les siennes). Quatre genres (HAZ.*) :
//   STRIKE  cercle annoncé qui se remplit, puis explosion qui ne blesse que le joueur (obus lobé du tireur v3) ;
//   LINE    trait annoncé (piqué du drone v2, charge du blindé v2) : annonce seule, le robot fait les dégâts ;
//   PUDDLE  flaque : le joueur dedans prend des dégâts par tics (drone v3) ;
//   MARK    repère seul (point de chute de la capsule de ravitaillement, § E1.C) ;
//   ORBITAL frappe orbitale (§ E1.C) : comme STRIKE, mais l'explosion blesse AUSSI les robots (source DMG_SRC.EVENT).
// Dessin : deux InstancedMesh de décalques dans le style des zones du boss (rouge du télégraphe, fond + remplissage
// qui grandit, contour plus vif) — un de disques, un de traits ; 0 appel de dessin quand le pool est vide. L'obus en
// vol est ajouté au lot ENNEMIS de src/vfx (le même orbe rouge que les tirs des robots), sans appel de plus.
// Aucune allocation en combat : addF lit ses flottants dans ARGF (§ V), tout le reste est en tableaux typés.
import * as THREE from 'three';
import { CAPS, DMG, DMG_SRC, ENEMIES, EVENTS, FXK, HAZ, HAZ_COUNT, HAZARDS, HURT, RENDER, SFX } from './config.js';
import { ARGF, F_DX, F_DZ, F_SX, F_SZ, F_T, F_V, F_X, F_Z, P } from './state.js';
import * as TC from './tirs-canon.js'; // § E4.J : obus en vol dans le maillage des balles (ancien visuel)
import { E3_ROBOTS, ENEMY } from './config.js'; // § E3.D : mines du poseur (HAZ.MINE), cercle de la foreuse (HAZ.DRILL)
import { E } from './state.js';
import { DANGERS_GUIDE } from './config.js'; // § E5.M : mine annoncée, flaque retardée, décalques des robots
import { CONFORT_FLASHS as CF } from './config.js'; // § E5.X5 (audit C12) : réglage « Flashs »
import { COMBAT_GUIDE, PALETTE } from './config.js'; // § E5.N : disques des kamikazes qui ne s'additionnent pas
import { CAUSE } from './config.js'; // § E5.Q (C2) : cause des coups reçus

let render = null;
let damage = null;
let audio = null;

const CAP = CAPS.hazards;
const TWO_PI = Math.PI * 2;
const hKind = new Uint8Array(CAP);
const hShell = new Uint8Array(CAP); // STRIKE : 1 = un obus est dessiné en vol
const hX = new Float32Array(CAP);
const hZ = new Float32Array(CAP);
const hR = new Float32Array(CAP); // rayon (cercle, flaque) ou demi-largeur (trait)
const hLen = new Float32Array(CAP); // longueur d'un trait
const hRot = new Float32Array(CAP); // cap d'un trait (rad, 0 = +Z)
const hT = new Float32Array(CAP); // s écoulées
const hDur = new Float32Array(CAP); // s d'annonce (STRIKE, LINE) ou de vie (PUDDLE, MARK)
const hDmg = new Float32Array(CAP); // dégâts au joueur (STRIKE : à l'impact ; PUDDLE : par tic)
const hHold = new Float32Array(CAP); // LINE : s pendant lesquelles le trait reste après l'annonce, en raccourcissant
const hDmgR = new Float32Array(CAP); // ORBITAL : dégâts aux robots
const hOX = new Float32Array(CAP); // départ de l'obus
const hOZ = new Float32Array(CAP);
let count = 0;

const OBUS = revision('obus');
const FLAQUE = revision('flaque');
const FRAPPE = EVENTS.types.find((e) => e.key === 'frappe');
const TICK = ENEMIES.common.contactInterval;
const SOUND = new Uint8Array(HAZ_COUNT);
for (const k of HAZARDS.telegraphSoundKinds) SOUND[k] = 1;
// § E5.Q (Femz, 21/11) : son d'annonce par genre — obus des robots et frappe orbitale : ANNONCE_OBUS_ROBOT ; les autres
// genres annoncés (cercle de la foreuse) gardent BOSS_TELEGRAPH
const SON_ANNONCE = new Int16Array(HAZ_COUNT).fill(SFX.BOSS_TELEGRAPH);
SON_ANNONCE[HAZ.STRIKE] = SFX.ANNONCE_OBUS_ROBOT;
SON_ANNONCE[HAZ.ORBITAL] = SFX.ANNONCE_OBUS_ROBOT;
// § E5.Q ter (Femz, 21/11) : traits au sol (piqué du drone v2, charge du blindé v2) et flaque du drone v3, muets
// jusque-là, annoncés par ANNONCE_SOL (une voix, 0,25 s au moins entre deux : config.js)
SOUND[HAZ.LINE] = 1;
SOUND[HAZ.PUDDLE] = 1;
SON_ANNONCE[HAZ.LINE] = SFX.ANNONCE_SOL;
SON_ANNONCE[HAZ.PUDDLE] = SFX.ANNONCE_SOL;

// Compteurs de la partie et minuterie des tics de flaque (flottant réécrit à chaque image : tableau typé, § V)
const TIMERS = new Float64Array(1);
const made = new Int32Array(HAZ_COUNT);
let strikes = 0; // obus arrivés au sol
let strikeHits = 0; // …qui ont blessé le joueur
let puddleHits = 0; // tics de flaque qui ont blessé le joueur
let recycled = 0; // flaques recyclées (plafond FLAQUE.max)
let orbitals = 0; // frappes orbitales arrivées au sol (§ E1.C)
let orbitalHits = 0; // …qui ont blessé le joueur
let orbitalRobots = 0; // robots touchés par les frappes orbitales
let peak = 0; // occupation maximale du pool
// § E3.D : mines du poseur
const MINE = E3_ROBOTS.poseur;
const MINE_T2 = MINE.trigger * MINE.trigger;
let minesBlown = 0; // mines déclenchées
let minesByRobot = 0; // …par un robot (pas le joueur)
let mineRobotHits = 0; // robots touchés par leurs explosions
let minePlayerHits = 0; // explosions qui ont blessé le joueur
let minesArmed = 0; // § E5.M : mines déclenchées entrées dans leur annonce

let discMesh = null;
let lineMesh = null;
//#region e5:M-dangers-guide
// § E5.M : place en plus pour les décalques posés par les robots (EXTRA par maillage) et le disque d'explosion des mines
// (2 instances par mine au plus, CAPS.robotMines)
const EXTRA = 256;
const DISC_CAP = CAP * 2 + CAPS.robotMines * 2 + EXTRA; // STRIKE : fond + remplissage
const LINE_CAP = CAP * 2 + EXTRA;
const MINE_ANNONCE = DANGERS_GUIDE.mine.annonce; // s entre le déclenchement et l'explosion (B6)
const hFuse = new Float32Array(CAP); // MINE : s d'annonce restantes après le déclenchement (0 = pas déclenchée)
const hBy = new Uint8Array(CAP); // MINE : qui l'a déclenchée (1 joueur, 2 robot)
//#region e5:Q-retours-guide
// § E5.Q (C2) : cause des dégâts de chaque zone (CAUSE.*). Par défaut selon le genre ; un auteur qui partage un genre
// (l'élite Instable pose des HAZ.STRIKE comme le tireur v3) l'écrit dans CAUSE_SUIVANTE[0] avant addF (lue puis remise à 0).
const hCause = new Uint8Array(CAP);
const CAUSE_GENRE = new Uint8Array(HAZ_COUNT);
CAUSE_GENRE[HAZ.STRIKE] = CAUSE.OBUS_TIREUR;
CAUSE_GENRE[HAZ.ORBITAL] = CAUSE.FRAPPE_ORBITALE;
CAUSE_GENRE[HAZ.PUDDLE] = CAUSE.FLAQUE;
CAUSE_GENRE[HAZ.SPARK] = CAUSE.TRAINEE_ELITE;
CAUSE_GENRE[HAZ.MINE] = CAUSE.MINE;
export const CAUSE_SUIVANTE = new Uint8Array(1);
//#endregion e5:Q-retours-guide
const FLAQUE_ARMEE = HAZARDS.puddleGrow + DANGERS_GUIDE.flaque.delai; // s — âge où la flaque du drone v3 blesse (B9)
//#endregion

function revision(key) {
  const R = ENEMIES.revisions;
  for (let k = 0; k < R.length; k++) if (R[k].key === key) return R[k];
  throw new Error('révision inconnue : ' + key);
}

export function init(ctx) {
  render = ctx.render;
  damage = ctx.damage;
  audio = ctx.audio;

  // Disque + contour dans UNE géométrie (un seul appel de dessin pour le fond et son trait).
  const H = HAZARDS;
  const disc = new THREE.CircleGeometry(1 - H.edge, H.segments);
  disc.rotateX(-Math.PI / 2);
  const rim = new THREE.RingGeometry(1 - H.edge, 1, H.segments);
  rim.rotateX(-Math.PI / 2);
  const rimPart = render.makePart(rim, H.color, 0);
  boost(rimPart, H.edgeBoost);
  discMesh = render.createInstanced(
    render.mergeParts([render.makePart(disc, H.color, 0), rimPart]),
    render.createUnlitMaterial({ transparent: true, opacity: H.opacity }),
    DISC_CAP,
    { instanceColor: true, name: 'zones-robots' },
  );
  discMesh.renderOrder = RENDER.decals.telegraph.order + 0.25;

  // Trait : x ∈ [−0,5 ; 0,5], z ∈ [0 ; 1] (il part de son origine), deux bordures plus vives.
  const quad = new THREE.PlaneGeometry(1 - 2 * H.lineEdge, 1);
  quad.rotateX(-Math.PI / 2);
  quad.translate(0, 0, 0.5);
  const parts = [render.makePart(quad, H.color, 0)];
  for (const side of [-1, 1]) {
    const b = new THREE.PlaneGeometry(H.lineEdge, 1);
    b.rotateX(-Math.PI / 2);
    b.translate(side * (0.5 - H.lineEdge / 2), 0, 0.5);
    const part = render.makePart(b, H.color, 0);
    boost(part, H.edgeBoost);
    parts.push(part);
  }
  lineMesh = render.createInstanced(render.mergeParts(parts), render.createUnlitMaterial({ transparent: true, opacity: H.opacity }), LINE_CAP, {
    instanceColor: true,
    name: 'traits-robots',
  });
  lineMesh.renderOrder = RENDER.decals.telegraph.order + 0.25;
  initKamikazes(); // § E5.N (point 6)
}

function boost(part, gain) {
  const c = part.attributes.color.array;
  for (let k = 0; k < c.length; k++) c[k] *= gain;
}

/** Nouvelle partie : pool vide, compteurs à zéro. */
export function reset() {
  count = 0;
  TIMERS[0] = 0;
  HF[0] = 0;
  made.fill(0);
  strikes = 0;
  strikeHits = 0;
  puddleHits = 0;
  recycled = 0;
  orbitals = 0;
  orbitalHits = 0;
  orbitalRobots = 0;
  peak = 0;
  minesBlown = 0; // § E3.D
  minesByRobot = 0;
  mineRobotHits = 0;
  minePlayerHits = 0;
  minesArmed = 0; // § E5.M
}

/** Fin de vague (T5) : toutes les zones disparaissent, sans effet (§ E1.A règle 9). */
export function clear() {
  count = 0;
  HF[0] = 0;
}

// § E4.F.2 : extinction de fin de vague — [0] s restantes, [1] durée totale (flottants dans un tableau typé, § V)
const HF = new Float64Array(2);

/**
 * § E4.F.2 — fin de vague (T5), à la place de clear() : pendant s secondes les zones restent dessinées en RÉTRÉCISSANT
 * (pas de fondu par le gain : un décalque noircirait), sans aucun effet (ni impact, ni flaque, ni mine), puis le pool
 * est vidé.
 */
export function fadeOut(s) {
  if (count === 0) return;
  HF[0] = s;
  HF[1] = s;
}

/**
 * Nouvelle zone. Flottants lus dans ARGF À L'ENTRÉE : F_X, F_Z (position ; origine d'un trait), F_DX (rayon, ou
 * demi-largeur d'un trait), F_DZ (longueur d'un trait ; STRIKE : 1 = obus dessiné en vol), F_SX (cap d'un trait, rad ;
 * STRIKE : x de départ de l'obus), F_SZ (STRIKE : z de départ de l'obus ; LINE : s pendant lesquelles le trait reste
 * après l'annonce, en raccourcissant depuis son origine — le temps de la manœuvre ; 0 = HAZARDS.lineHold), F_T (durée de l'annonce ou de la vie, s),
 * F_V (dégâts au joueur). HAZ.ORBITAL : F_DZ = dégâts aux robots. Renvoie l'indice, ou −1 si le pool est plein. Une flaque de trop recycle la plus ancienne.
 */
export function addF(kind) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  const r = ARGF[F_DX];
  const len = ARGF[F_DZ];
  const sx = ARGF[F_SX];
  const sz = ARGF[F_SZ];
  const dur = ARGF[F_T];
  const dmg = ARGF[F_V];
  if (!(dur > 0) || !Number.isFinite(x) || !Number.isFinite(z)) return -1;
  let k = -1;
  if (kind === HAZ.PUDDLE) {
    // plafond des flaques : la plus ancienne est recyclée
    let n = 0;
    let oldest = -1;
    for (let j = 0; j < count; j++) {
      if (hKind[j] !== HAZ.PUDDLE) continue;
      n++;
      if (oldest < 0 || hT[j] > hT[oldest]) oldest = j;
    }
    if (n >= FLAQUE.max || count >= CAP) {
      if (oldest < 0) return -1;
      k = oldest;
      recycled++;
    }
  }
  if (k < 0) {
    if (count >= CAP) return -1;
    k = count++;
    if (count > peak) peak = count;
  }
  hKind[k] = kind;
  hX[k] = x;
  hZ[k] = z;
  hR[k] = r;
  hLen[k] = kind === HAZ.LINE ? len : 0;
  hRot[k] = kind === HAZ.LINE ? sx : 0;
  hShell[k] = kind === HAZ.STRIKE && len > 0 ? 1 : 0;
  hHold[k] = kind === HAZ.LINE ? (sz > 0 ? sz : HAZARDS.lineHold) : 0;
  hOX[k] = sx;
  hOZ[k] = sz;
  hT[k] = 0;
  hDur[k] = dur;
  hDmg[k] = dmg;
  hDmgR[k] = kind === HAZ.ORBITAL ? len : 0;
  hFuse[k] = 0; // § E5.M
  hBy[k] = 0;
  hCause[k] = CAUSE_SUIVANTE[0] !== 0 ? CAUSE_SUIVANTE[0] : CAUSE_GENRE[kind]; // § E5.Q (C2)
  CAUSE_SUIVANTE[0] = 0;
  made[kind]++;
  if (SOUND[kind] === 1) {
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    audio.playF(SON_ANNONCE[kind]); // § E5.Q (Femz, 21/11) : obus des robots et frappe orbitale (était BOSS_TELEGRAPH)
  }
  return k;
}

function remove(k) {
  const last = --count;
  if (k === last) return;
  hKind[k] = hKind[last];
  hShell[k] = hShell[last];
  hX[k] = hX[last];
  hZ[k] = hZ[last];
  hR[k] = hR[last];
  hLen[k] = hLen[last];
  hRot[k] = hRot[last];
  hT[k] = hT[last];
  hDur[k] = hDur[last];
  hDmg[k] = hDmg[last];
  hHold[k] = hHold[last];
  hDmgR[k] = hDmgR[last];
  hOX[k] = hOX[last];
  hOZ[k] = hOZ[last];
  hFuse[k] = hFuse[last]; // § E5.M
  hBy[k] = hBy[last];
  hCause[k] = hCause[last]; // § E5.Q
}

/** S6 bis : minuteries, impacts des obus, tics des flaques. */
export function update(dt) {
  if (TIMERS[0] > 0) TIMERS[0] -= dt;
  if (count === 0) return;
  if (HF[0] > 0) {
    // § E4.F.2 : extinction — aucun effet, puis plus rien
    HF[0] -= dt;
    if (HF[0] <= 0) {
      HF[0] = 0;
      count = 0;
    }
    return;
  }
  for (let k = count - 1; k >= 0; k--) {
    hT[k] += dt;
    const kind = hKind[k];
    if (kind === HAZ.STRIKE) {
      if (hT[k] < hDur[k]) continue;
      // Impact : il ne blesse que le joueur (dégâts aux robots nuls). On retire la zone D'ABORD : explode peut tuer le
      // joueur, jamais rappeler ce module.
      const x = hX[k];
      const z = hZ[k];
      const r = hR[k];
      const dmg = hDmg[k];
      const cause = hCause[k]; // § E5.Q
      remove(k);
      strikes++;
      const hpBefore = P.hp;
      damage.explode(x, z, r, 0, dmg, DMG_SRC.KAMIKAZE, DMG.NO_CRIT, FXK.KAMIKAZE, OBUS.trauma, OBUS.punch, 0, -1, cause);
      if (P.hp < hpBefore) strikeHits++;
    } else if (kind === HAZ.ORBITAL) {
      if (hT[k] < hDur[k]) continue;
      // Frappe orbitale (§ E1.C) : elle blesse le joueur ET les robots (qui comptent pour le joueur : kills, butin).
      // Zone retirée d'abord, comme pour l'obus.
      const x = hX[k];
      const z = hZ[k];
      const r = hR[k];
      const dmg = hDmg[k];
      const dmgR = hDmgR[k];
      const cause = hCause[k]; // § E5.Q
      remove(k);
      orbitals++;
      const hpBefore = P.hp;
      orbitalRobots += damage.explode(x, z, r, dmgR, dmg, DMG_SRC.EVENT, DMG.NO_CRIT | DMG.BYPASS_SHIELD, FXK.KAMIKAZE, FRAPPE.trauma, FRAPPE.punch, FRAPPE.knockback, -1, cause);
      if (P.hp < hpBefore) orbitalHits++;
    } else if (kind === HAZ.MINE) {
      // § E3.D : mine du poseur — armée après MINE.arm s, déclenchée par le joueur OU un robot (hors poseurs) à moins
      // de MINE.trigger m ; l'explosion blesse les deux (source DMG_SRC.EVENT : les robots tués comptent pour le joueur)
      //#region e5:M-dangers-guide
      // § E5.M (B6) : déclenchée, elle n'explose plus dans l'instant — MINE_ANNONCE s pendant lesquelles son disque de
      // blast se remplit (comme un obus), puis l'explosion, quoi qu'il y ait dedans
      if (hFuse[k] > 0) {
        const f = hFuse[k] - dt;
        hFuse[k] = f > 0 ? f : 0;
        if (f > 0) continue;
      } else {
        if (hT[k] >= hDur[k]) {
          remove(k);
          continue;
        }
        if (hT[k] < MINE.arm) continue;
        const t = mineTriggerF(k);
        if (t === 0) continue;
        hBy[k] = t;
        if (MINE_ANNONCE > 0) {
          hFuse[k] = MINE_ANNONCE;
          minesArmed++;
          ARGF[F_X] = hX[k];
          ARGF[F_Z] = hZ[k];
          audio.playF(SFX.KAMIKAZE_BEEP); // § E5.AD : la mèche part (début de la séquence du bip ; playStep serait refusé)
          continue;
        }
      }
      const by = hBy[k];
      //#endregion
      const x = hX[k];
      const z = hZ[k];
      const dmg = hDmg[k];
      const cause = hCause[k]; // § E5.Q
      remove(k);
      minesBlown++;
      if (by === 2) minesByRobot++;
      const hpBefore = P.hp;
      mineRobotHits += damage.explode(x, z, MINE.blast, MINE.robotDmg, dmg, DMG_SRC.EVENT, DMG.NO_CRIT | DMG.BYPASS_SHIELD, FXK.KAMIKAZE, MINE.trauma, 0, MINE.knockback, ENEMY.POSEUR, cause);
      if (P.hp < hpBefore) minePlayerHits++;
    } else if (kind === HAZ.LINE) {
      if (hT[k] >= hDur[k] + hHold[k]) remove(k);
    } else if (kind === HAZ.PUDDLE || kind === HAZ.SPARK) { // § E3.A : traînée du Surchargé = flaque courte
      if (hT[k] >= hDur[k]) {
        remove(k);
        continue;
      }
      if (TIMERS[0] > 0 || !P.alive) continue;
      if (kind === HAZ.PUDDLE && hT[k] < FLAQUE_ARMEE) continue; // § E5.M (B9) : inoffensive pendant l'étalement + délai
      const dx = P.x - hX[k];
      const dz = P.z - hZ[k];
      if (dx * dx + dz * dz >= hR[k] * hR[k]) continue;
      if (damage.hitPlayer(hDmg[k], HURT.CONTACT, hX[k], hZ[k], hCause[k]) > 0) { // § E5.Q : flaque ou traînée
        TIMERS[0] = TICK;
        puddleHits++;
      }
    } else if (hT[k] >= hDur[k]) remove(k);
  }
}

/** § E3.D : la mine k est-elle déclenchée ? 0 = non, 1 = par le joueur, 2 = par un robot (hors poseurs et boss). */
function mineTriggerF(k) {
  const x = hX[k];
  const z = hZ[k];
  if (P.alive) {
    const dx = P.x - x;
    const dz = P.z - z;
    const r = MINE.trigger + P.radius;
    if (dx * dx + dz * dz < r * r) return 1;
  }
  const n = E.count;
  const X = E.x, Z = E.z, ALIVE = E.alive, TYPE = E.type;
  const SU = E.sus;
  for (let i = 0; i < n; i++) {
    if (ALIVE[i] === 0 || SU[i] !== 0) continue; // § E4.F : un robot en repli ou garé ne déclenche pas une mine
    const t = TYPE[i];
    if (t === ENEMY.POSEUR || t === ENEMY.BOSS) continue;
    const dx = X[i] - x;
    const dz = Z[i] - z;
    if (dx * dx + dz * dz < MINE_T2) return 2;
  }
  return 0;
}

/** § E3.D : zones vivantes d'un genre (plafond des mines du poseur). */
export function countKind(kind) {
  let n = 0;
  for (let k = 0; k < count; k++) if (hKind[k] === kind) n++;
  return n;
}

/** § E3.D : compteurs des mines du poseur (tests). */
export function inspectE3(out) {
  out.mines = countKind(HAZ.MINE);
  out.drills = countKind(HAZ.DRILL);
  out.minesMade = made[HAZ.MINE];
  out.drillsMade = made[HAZ.DRILL];
  out.minesBlown = minesBlown;
  out.minesByRobot = minesByRobot;
  out.mineRobotHits = mineRobotHits;
  out.minePlayerHits = minePlayerHits;
  out.minesAnnoncees = minesArmed; // § E5.M
  return out;
}

/** F11 : décalques (matrices et gains écrits en ligne, § G.3) ; obus en vol ajoutés au maillage de src/tirs-canon.js (§ E4.J). */
export function sync() {
  syncKamikazes(); // § E5.N (point 6) : disques des kamikazes en mèche posés par enemies.sync
  if (count === 0) {
    render.commit(discMesh, extraD); // § E5.M : décalques posés par les robots (enemies.sync)
    render.commit(lineMesh, extraL);
    extraD = 0;
    extraL = 0;
    return;
  }
  const H = HAZARDS;
  const y = H.y;
  const dm = discMesh.instanceMatrix.array;
  const dc = discMesh.instanceColor.array;
  const lm = lineMesh.instanceMatrix.array;
  const lc = lineMesh.instanceColor.array;
  // § E4.J : obus en vol dans le maillage « tirs-ennemis » (ancien visuel des balles), après les balles d'enemies.sync
  const va = TC.tampon();
  const vcap = TC.capacite();
  let vn = TC.N[0]; // après enemies.sync (main, F11)
  let nd = extraD; // § E5.M : après les décalques posés par les robots
  let nl = extraL;
  extraD = 0;
  extraL = 0;
  const shrink = HF[0] > 0 ? HF[0] / HF[1] : 1; // § E4.F.2 : extinction de fin de vague (rétrécissement)
  for (let k = 0; k < count; k++) {
    const kind = hKind[k];
    // (Math.min / Math.max, jamais « if (u > 1) u = 1 » : une variable qui reçoit tantôt un flottant, tantôt un entier
    // littéral est emballée par V8, § V)
    const u = Math.min(hT[k] / hDur[k], 1);
    if (kind === HAZ.LINE) {
      // Fond (clignote) et remplissage qui avance vers le bout du trait. Après l'annonce, pendant la manœuvre, le trait
      // RACCOURCIT depuis son origine : il ne reste que le chemin encore à parcourir. (Pas de fondu par le gain : un
      // décalque en fusion normale dont la couleur tombe à 0 devient noir, pas transparent — vu sur la planche.)
      const rot = hRot[k];
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const w = hR[k] * 2 * shrink;
      const over = hT[k] - hDur[k];
      const done = Math.min(Math.max(over / hHold[k], 0), 1); // part du chemin déjà parcourue
      const start = hLen[k] * done;
      const ox = hX[k] + s * start;
      const oz = hZ[k] + c * start;
      const pulse = CF.reduits ? u : 0.5 - 0.5 * Math.cos(u * u * H.blinks * TWO_PI); // § E5.X5
      for (let layer = 0; layer < 2; layer++) {
        const len = (layer === 0 ? hLen[k] : hLen[k] * (H.fillStart + (1 - H.fillStart) * u)) - start;
        const g = layer === 0 ? H.baseGain * (1 + H.blinkDepth * pulse) : H.fillGain;
        const o = nl * 16;
        lm[o] = c * w;
        lm[o + 1] = 0;
        lm[o + 2] = -s * w;
        lm[o + 3] = 0;
        lm[o + 4] = 0;
        lm[o + 5] = 1;
        lm[o + 6] = 0;
        lm[o + 7] = 0;
        lm[o + 8] = s * len;
        lm[o + 9] = 0;
        lm[o + 10] = c * len;
        lm[o + 11] = 0;
        lm[o + 12] = ox;
        lm[o + 13] = y;
        lm[o + 14] = oz;
        lm[o + 15] = 1;
        const q = nl * 3;
        lc[q] = g;
        lc[q + 1] = g;
        lc[q + 2] = g;
        nl++;
      }
      continue;
    }
    // disques : STRIKE = fond + remplissage ; PUDDLE = fond + cœur ; MARK = un disque
    const layers = kind === HAZ.MARK ? 1 : 2;
    for (let layer = 0; layer < layers; layer++) {
      let r = hR[k] * shrink;
      let g;
      if (kind === HAZ.STRIKE || kind === HAZ.ORBITAL || kind === HAZ.DRILL) {
        const pulse = CF.reduits ? u : 0.5 - 0.5 * Math.cos(u * u * H.blinks * TWO_PI); // § E5.X5
        if (layer === 1) r *= H.fillStart + (1 - H.fillStart) * u;
        g = layer === 0 ? H.baseGain * (1 + H.blinkDepth * pulse) : H.fillGain;
      } else if (kind === HAZ.MINE) {
        // § E3.D : mine — disque + cœur ; terne avant d'être armée, puis clignote (le cœur bat plus vite à la fin)
        const armed = hT[k] >= MINE.arm;
        const blink = armed ? 0.5 + 0.5 * Math.cos(hT[k] * MINE.blinkHz * TWO_PI) : 0;
        if (layer === 1) r *= 0.45;
        g = layer === 0 ? H.baseGain * (armed ? 1 + H.blinkDepth * blink : 0.55) : armed ? H.fillGain * (0.6 + 0.4 * blink) : H.baseGain * 0.6;
      } else if (kind === HAZ.PUDDLE || kind === HAZ.SPARK) { // § E3.A : traînée du Surchargé dessinée comme une flaque
        const grow = hT[k] / H.puddleGrow;
        if (grow < 1) r *= grow * (2 - grow);
        // en fin de vie elle se rétracte (pas de fondu par le gain : il la noircirait)
        const left = hDur[k] - hT[k];
        if (left < H.puddleFade) r *= left / H.puddleFade;
        const beat = Math.sin(hT[k] * (CF.reduits && H.puddleHz > CF.hzMax ? CF.hzMax : H.puddleHz) * TWO_PI + hX[k] * 1.7); // § E5.X5 : 11 Hz → hzMax
        if (layer === 0) g = H.puddleGain + H.puddleFlicker * beat;
        else {
          r *= H.puddleCore - H.puddleCoreBeat * beat;
          g = H.puddleCoreGain;
          if (kind === HAZ.PUDDLE && hT[k] < FLAQUE_ARMEE) r *= 0; // § E5.M (B9) : le cœur vif = elle blesse (r *= 0 : r reste un flottant, § V)
        }
      } else {
        g = H.baseGain;
      }
      const o = nd * 16;
      dm[o] = r;
      dm[o + 1] = 0;
      dm[o + 2] = 0;
      dm[o + 3] = 0;
      dm[o + 4] = 0;
      dm[o + 5] = 1;
      dm[o + 6] = 0;
      dm[o + 7] = 0;
      dm[o + 8] = 0;
      dm[o + 9] = 0;
      dm[o + 10] = r;
      dm[o + 11] = 0;
      dm[o + 12] = hX[k];
      dm[o + 13] = y;
      dm[o + 14] = hZ[k];
      dm[o + 15] = 1;
      const q = nd * 3;
      dc[q] = g;
      dc[q + 1] = g;
      dc[q + 2] = g;
      nd++;
    }
    //#region e5:M-dangers-guide
    // § E5.M (B6) : mine armée → son vrai rayon d'explosion (fond terne) ; déclenchée → fond qui clignote + remplissage
    // qui atteint le bord à l'explosion (même dessin qu'un obus)
    if (kind === HAZ.MINE && hT[k] >= MINE.arm) {
      const fuse = hFuse[k] > 0;
      const u = fuse ? 1 - hFuse[k] / MINE_ANNONCE : 0;
      const pulse = CF.reduits ? u : 0.5 - 0.5 * Math.cos(u * u * H.blinks * TWO_PI); // § E5.X5
      for (let layer = 0; layer < (fuse ? 2 : 1); layer++) {
        const r = layer === 0 ? MINE.blast * shrink : MINE.blast * shrink * (H.fillStart + (1 - H.fillStart) * u);
        const g = !fuse ? DANGERS_GUIDE.mine.gainArmee : layer === 0 ? H.baseGain * (1 + H.blinkDepth * pulse) : H.fillGain;
        const o = nd * 16;
        dm[o] = r;
        dm[o + 1] = 0;
        dm[o + 2] = 0;
        dm[o + 3] = 0;
        dm[o + 4] = 0;
        dm[o + 5] = 1;
        dm[o + 6] = 0;
        dm[o + 7] = 0;
        dm[o + 8] = 0;
        dm[o + 9] = 0;
        dm[o + 10] = r;
        dm[o + 11] = 0;
        dm[o + 12] = hX[k];
        dm[o + 13] = y;
        dm[o + 14] = hZ[k];
        dm[o + 15] = 1;
        const q = nd * 3;
        dc[q] = g;
        dc[q + 1] = g;
        dc[q + 2] = g;
        nd++;
      }
    }
    //#endregion
    // obus en vol : cloche du canon du tireur jusqu'au centre du cercle (§ E4.J : même ancien visuel que les balles,
    // échelle = rayon de l'obus, nez le long de la cloche — base avant / droite / haut complète)
    if (hShell[k] === 1 && vn < vcap) {
      const ox = hOX[k];
      const oz = hOZ[k];
      const tx = hX[k] - ox;
      const tz = hZ[k] - oz;
      const h0 = ENEMIES.projectile.height;
      const px = ox + tx * u;
      const pz = oz + tz * u;
      const py = h0 * (1 - u) + 4 * OBUS.apex * u * (1 - u);
      // vitesse (pour le cap de la traînée) : dérivée de la cloche
      const vy = -h0 + 4 * OBUS.apex * (1 - 2 * u);
      const l = Math.sqrt(tx * tx + vy * vy + tz * tz);
      const R = OBUS.shellRadius * shrink;
      const fx = l > 1e-6 ? tx / l : 0;
      const fy = l > 1e-6 ? vy / l : 0;
      const fz = l > 1e-6 ? tz / l : 1;
      const lh = Math.sqrt(fx * fx + fz * fz);
      const rx = lh > 1e-6 ? fz / lh : 1; // droite = haut × avant (horizontale)
      const rz = lh > 1e-6 ? -fx / lh : 0;
      const o = vn * 16;
      vn++;
      va[o] = rx * R;
      va[o + 1] = 0;
      va[o + 2] = rz * R;
      va[o + 3] = 0;
      va[o + 4] = fy * rz * R; // haut = avant × droite
      va[o + 5] = (fz * rx - fx * rz) * R;
      va[o + 6] = -fy * rx * R;
      va[o + 7] = 0;
      va[o + 8] = fx * R;
      va[o + 9] = fy * R;
      va[o + 10] = fz * R;
      va[o + 11] = 0;
      va[o + 12] = px;
      va[o + 13] = py;
      va[o + 14] = pz;
      va[o + 15] = 1;
    }
  }
  TC.N[0] = vn;
  render.commit(discMesh, nd);
  render.commit(lineMesh, nl);
}

//#region e5:M-dangers-guide
// § E5.M : décalques posés à chaque image PAR LES ROBOTS (enemies.sync, juste avant hazards.sync), dans les deux maillages
// des zones et avec leur dessin : disque de la mèche du kamikaze (B7), trait du bond du rôdeur v2 (B8), arc du scanner
// (B10). Aucun effet de jeu : le robot garde ses règles. Flottants lus dans ARGF (§ V) ; la place des zones du pool est
// réservée (EXTRA instances par maillage en plus des zones) : un décalque de trop est simplement omis.
let extraD = 0;
let extraL = 0;

/** Zone annoncée en disque : ARGF F_X, F_Z (centre), F_DX (rayon), F_T (avancement 0..1 de l'annonce). Fond + remplissage. */
export function annonceDisqueF() {
  if (discMesh === null || extraD + 2 > EXTRA) return;
  const H = HAZARDS;
  const u = Math.min(Math.max(ARGF[F_T], 0), 1);
  const pulse = 0.5 - 0.5 * Math.cos(u * u * H.blinks * TWO_PI);
  const dm = discMesh.instanceMatrix.array;
  const dc = discMesh.instanceColor.array;
  for (let layer = 0; layer < 2; layer++) {
    const r = layer === 0 ? ARGF[F_DX] : ARGF[F_DX] * (H.fillStart + (1 - H.fillStart) * u);
    const g = layer === 0 ? H.baseGain * (1 + H.blinkDepth * pulse) : H.fillGain;
    const o = extraD * 16;
    dm[o] = r;
    dm[o + 1] = 0;
    dm[o + 2] = 0;
    dm[o + 3] = 0;
    dm[o + 4] = 0;
    dm[o + 5] = 1;
    dm[o + 6] = 0;
    dm[o + 7] = 0;
    dm[o + 8] = 0;
    dm[o + 9] = 0;
    dm[o + 10] = r;
    dm[o + 11] = 0;
    dm[o + 12] = ARGF[F_X];
    dm[o + 13] = H.y;
    dm[o + 14] = ARGF[F_Z];
    dm[o + 15] = 1;
    const q = extraD * 3;
    dc[q] = g;
    dc[q + 1] = g;
    dc[q + 2] = g;
    extraD++;
  }
}

/**
 * Trait : ARGF F_X, F_Z (origine), F_DX (demi-largeur), F_DZ (longueur), F_SX (cap, rad, 0 = +Z), F_V (gain du trait) ;
 * F_T ≥ 0 : trait ANNONCÉ (fond qui clignote + remplissage à l'avancement F_T, gain F_V ignoré), F_T < 0 : un seul trait.
 */
export function traitF() {
  const annonce = ARGF[F_T] >= 0;
  if (lineMesh === null || extraL + (annonce ? 2 : 1) > EXTRA) return;
  const H = HAZARDS;
  const u = Math.min(Math.max(ARGF[F_T], 0), 1);
  const pulse = 0.5 - 0.5 * Math.cos(u * u * H.blinks * TWO_PI);
  const lm = lineMesh.instanceMatrix.array;
  const lc = lineMesh.instanceColor.array;
  const rot = ARGF[F_SX];
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  const w = ARGF[F_DX] * 2;
  for (let layer = 0; layer < (annonce ? 2 : 1); layer++) {
    const len = layer === 0 ? ARGF[F_DZ] : ARGF[F_DZ] * (H.fillStart + (1 - H.fillStart) * u);
    const g = !annonce ? ARGF[F_V] : layer === 0 ? H.baseGain * (1 + H.blinkDepth * pulse) : H.fillGain;
    const o = extraL * 16;
    lm[o] = c * w;
    lm[o + 1] = 0;
    lm[o + 2] = -sn * w;
    lm[o + 3] = 0;
    lm[o + 4] = 0;
    lm[o + 5] = 1;
    lm[o + 6] = 0;
    lm[o + 7] = 0;
    lm[o + 8] = sn * len;
    lm[o + 9] = 0;
    lm[o + 10] = c * len;
    lm[o + 11] = 0;
    lm[o + 12] = ARGF[F_X];
    lm[o + 13] = H.y;
    lm[o + 14] = ARGF[F_Z];
    lm[o + 15] = 1;
    const q = extraL * 3;
    lc[q] = g;
    lc[q + 1] = g;
    lc[q + 2] = g;
    extraL++;
  }
}
//#endregion

export function getCount() {
  return count;
}

export function inspect(out) {
  out.count = count;
  out.cap = CAP;
  out.peak = peak;
  let strike = 0;
  let line = 0;
  let puddle = 0;
  let orbital = 0;
  let mark = 0;
  for (let k = 0; k < count; k++) {
    if (hKind[k] === HAZ.ORBITAL) orbital++;
    else if (hKind[k] === HAZ.MARK) mark++;
    if (hKind[k] === HAZ.STRIKE) strike++;
    else if (hKind[k] === HAZ.LINE) line++;
    else if (hKind[k] === HAZ.PUDDLE) puddle++;
  }
  out.strike = strike; // cercles d'obus en cours d'annonce
  out.line = line; // traits de piqué ou de charge affichés
  out.puddle = puddle; // flaques au sol
  out.orbital = orbital; // frappes orbitales en cours d'annonce (§ E1.C)
  out.mark = mark; // repères (point de chute de la capsule)
  out.made = { strike: made[HAZ.STRIKE], line: made[HAZ.LINE], puddle: made[HAZ.PUDDLE], mark: made[HAZ.MARK], orbital: made[HAZ.ORBITAL] };
  out.orbitals = orbitals; // frappes orbitales arrivées au sol
  out.orbitalHits = orbitalHits; // …qui ont blessé le joueur
  out.orbitalRobots = orbitalRobots; // robots touchés par elles
  out.strikes = strikes;
  out.strikeHits = strikeHits;
  out.puddleHits = puddleHits;
  out.recycled = recycled;
  out.e3 = inspectE3({}); // § E3.D : mines du poseur, cercles de la foreuse
}

/** Tests : les max premières zones, en clair. */
export function list(max = 32) {
  const out = [];
  for (let k = 0; k < count && out.length < max; k++) {
    out.push({ kind: hKind[k], x: hX[k], z: hZ[k], r: hR[k], len: hLen[k], rot: hRot[k], t: hT[k], dur: hDur[k], dmg: hDmg[k], dmgR: hDmgR[k], shell: hShell[k] });
  }
  return out;
}

//#region e5:N-combat-guide
// § E5.N (point 6, Femz 21/11 : « allège-le ») — disques des kamikazes en mèche. Avant : deux couches (fond, remplissage)
// par kamikaze dans le maillage des zones, à 0,58 d'opacité chacune, et autant de couches que de kamikazes au même
// endroit (rouge de plus en plus opaque). Ici, UN maillage à eux (un appel de dessin, seulement quand un kamikaze est en
// mèche) : chaque disque est un carré au sol ; son pixel n'est peint que par le PREMIER disque qui le couvre (les autres
// le jettent), avec l'état le plus avancé de TOUS les disques qui le couvrent (contour du bord de l'union, remplissage,
// fond qui clignote). Une couche, une opacité, quel que soit le nombre de disques. Données : uniformes préparés à l'init
// (x, z, rayon, avancement de la mèche), écrits en place (aucune allocation, § V).
const KC = COMBAT_GUIDE.kamikaze;
const KCAP = KC.cap;
const uK = [];
for (let k = 0; k < KCAP; k++) uK.push(new THREE.Vector4());
const uKN = { value: 0 };
let kamiMesh = null;
let nk = 0;
let kamiPeak = 0; // disques au plus dans une image (tests)
let kamiOmis = 0; // disques omis faute de place (tests)

function initKamikazes() {
  const g = new THREE.PlaneGeometry(2, 2);
  g.rotateX(-Math.PI / 2); // x, z ∈ [−1 ; 1]
  const H = HAZARDS;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uK: { value: uK },
      uN: uKN,
      uY: { value: H.y + 0.001 }, // juste au-dessus des zones des robots
      uCol: { value: new THREE.Color(PALETTE.telegraph) },
      uFond: { value: new THREE.Vector4(KC.fond.gain, KC.fond.alpha, H.blinks * Math.PI * 2, H.blinkDepth) },
      uFill: { value: new THREE.Vector4(KC.remplissage.gain, KC.remplissage.alpha, H.fillStart, 0) },
      uRim: { value: new THREE.Vector4(KC.contour.gain, KC.contour.alpha, KC.contour.largeur, 0) },
    },
    vertexShader: `
uniform vec4 uK[${KCAP}];
uniform float uY;
varying vec2 vP;
varying float vI;
void main() {
  vec4 k = uK[gl_InstanceID];
  vec2 p = k.xy + position.xz * (k.z * 1.02);
  vP = p;
  vI = float(gl_InstanceID);
  gl_Position = projectionMatrix * viewMatrix * vec4(p.x, uY, p.y, 1.0);
}`,
    fragmentShader: `
uniform vec4 uK[${KCAP}];
uniform int uN;
uniform vec3 uCol;
uniform vec4 uFond;
uniform vec4 uFill;
uniform vec4 uRim;
varying vec2 vP;
varying float vI;
void main() {
  int me = int(vI + 0.5);
  float fw = max(fwidth(distance(vP, uK[me].xy)), 1e-4);
  float aa = 0.0;
  float pulse = 0.0;
  bool fill = false;
  bool inner = false;
  bool rim = false;
  for (int j = 0; j < ${KCAP}; j++) {
    if (j >= uN) break;
    vec4 k = uK[j];
    float d = distance(vP, k.xy);
    if (d >= k.z) continue;
    if (j < me) discard; // déjà peint par un disque d'avant : jamais deux couches
    aa = max(aa, clamp((k.z - d) / fw, 0.0, 1.0));
    float u = clamp(k.w, 0.0, 1.0);
    pulse = max(pulse, 0.5 - 0.5 * cos(u * u * uFond.z));
    if (d < k.z * (uFill.z + (1.0 - uFill.z) * u)) fill = true;
    if (d < k.z * (1.0 - uRim.z)) inner = true;
    else rim = true;
  }
  if (aa <= 0.0) discard;
  vec2 ga = rim && !inner ? uRim.xy : fill ? uFill.xy : vec2(uFond.x * (1.0 + uFond.w * pulse), uFond.y);
  gl_FragColor = vec4(uCol * ga.x, ga.y * aa);
  #include <colorspace_fragment>
}`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  kamiMesh = render.createInstanced(g, mat, KCAP, { name: 'zones-kamikazes' }); // matrices d'instance inutilisées : le carré vient de uK
  kamiMesh.renderOrder = RENDER.decals.telegraph.order + 0.3;
}

/** Disque d'un kamikaze en mèche (enemies.sync) : ARGF F_X, F_Z (centre), F_DX (rayon), F_T (avancement 0..1 de la mèche). */
export function disqueKamikazeF() {
  if (kamiMesh === null) return;
  if (nk >= KCAP) {
    kamiOmis++;
    return;
  }
  uK[nk].set(ARGF[F_X], ARGF[F_Z], ARGF[F_DX], ARGF[F_T]);
  nk++;
}

function syncKamikazes() {
  if (kamiMesh === null) return;
  uKN.value = nk;
  kamiMesh.count = nk;
  kamiMesh.visible = nk > 0;
  if (nk > kamiPeak) kamiPeak = nk;
  nk = 0;
}

/** Tests : disques de l'image (centres, rayons, avancement), pic et omis. */
export function inspectKamikazes(out) {
  out.n = uKN.value;
  out.disques = [];
  for (let k = 0; k < uKN.value; k++) out.disques.push(uK[k].toArray());
  out.pic = kamiPeak;
  out.omis = kamiOmis;
  return out;
}
//#endregion
