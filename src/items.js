// LOT e2:F — items.js : les 18 objets passifs (« modules »), empilables sans limite, 6 emplacements
// (contrat : ARCHITECTURE.md § E2.F et E2.F bis ; données : config.js, région e2:F-objets-passifs).
//
// Règle d'or (§ E2.0.5) : UN OBJET NE FRAPPE JAMAIS PENDANT UN COUP. Les crochets appelés par damage.js (onHitF,
// onKillF, onPlayerHitF) ne font qu'écrire dans une file fixe ; update() (S8 bis, juste après les armes, grille
// exacte de S7) la vide une fois par image. Tout coup porté ici passe par damage.hitEnemyF avec DMG.PROC | NO_CRIT
// et la source DMG_SRC.ITEM : damage.js n'appelle alors aucun crochet (ni au coup, ni à la mort) — aucune réaction en
// chaîne n'est possible, quel que soit le nombre de piles. Chaque objet a en plus un plafond par image.
// § V : aucune allocation en combat. Aucun flottant n'est passé en argument : les montants passent par ARGF, les
// entrées des recherches de voisins par IN, celles des effets par V.Q ; file, compteurs et minuteries sont des
// tableaux typés. Les effets visuels sont des événements datés du lot EVENEMENTS de src/vfx (aucun appel de dessin
// de plus) ; seul le drone compagnon a son InstancedMesh (« drones-allies », 3 instances : + 1 appel).
import {
  CAPS, CHESTS, CHOICES, DAMAGE, DMG, DMG_SRC, ENEMIES, ENEMY, FUSIONS, FUSION_COUNT, GRID, ITEM, ITEMS, ITEM_COUNT, ITEM_RULES, MODELES, PLAYER,
  RARITIES, SFX, STAT, TRAUMA, VFX, VFX_STYLE, WEAPON, WEAPONS, droneCount, itemText, itemValue, lotItemStacks,
} from './config.js';
import { AGENT } from './config.js'; // § E5.X3 : le Bastion n'a pas de trajet de dash (Moteur cinétique à l'atterrissage)
import { ARGF, BANS, E, F_DX, F_DZ, F_SX, F_SZ, F_T, F_V, F_X, F_Z, P, PAREFEU_F, mods, rand, run } from './state.js';
import * as V from './vfx/projectiles.js';
import { chargerPieces } from './anim/pieces.js';
import { EFLAG, FUSION_RULES, STATE, RECHARGES, TEXTES_N } from './config.js'; // § E3.F : règles des objets nés d'une fusion
// § E4.G : un objet en mode recharge n'agit que pendant sa fenêtre (ouverte par cooldowns.update)
import { ITEM_OPEN as IO } from './cooldowns.js';
import * as meta from './meta.js'; // § E3.F : recettes découvertes (indice du choix de niveau) ; § E4.A : verrous (ITEM_OK)
import { vuObjet } from './defis.js'; // § E4.A : Collection (objets obtenus)
import { PAREFEU_DOME, PAREFEU_RESERVE } from './config.js'; // § E5.B : dôme du Pare-feu (src/vfx/dome-parefeu.js) — remplace les ondes visuelles
import { ECLATS } from './config.js'; // § E5.Y : fragments des Éclats en vol
import { SYNERGIE_OBJET, ligneEvoObjet } from './config.js'; // § E5.X7 (H2, H12) : synergie et évolution sur la carte
//#region e5:X9-katana-puissance
import { BONUS, PROGRESSION } from './config.js'; // § E5.X9 (H1) : Puissance s'applique aussi aux objets
//#endregion e5:X9-katana-puissance

//#region e5:AH-virus-gaz
import { CONFORT_FLASHS, VIRUS_GAZ } from './config.js'; // § E5.AH : gaz des robots infectés, son d'infection
//#endregion e5:AH-virus-gaz

let ctx = null;
let damage = null;
let enemies = null;
let grid = null;
let audio = null;
let camera = null;
let fx = null;
let player = null;
let weapons = null;
let render = null;
let debug = null;
let dmgLast = null; // damage.LAST : montant du coup en cours (posé par hitEnemyF avant onHitF)
let pickups = null; // § E3.F : Recyclage (tirage de fragment refait)
let chests = null; // § E3.F : Point de restauration (coffre gratuit)

const N = ITEM_COUNT;
const SLOTS = ITEM_RULES.slots;
const QCAP = ITEM_RULES.queue;
const TAU = Math.PI * 2;
const Q = V.Q;

// Drapeaux des coups nés d'un objet : jamais de critique, jamais de crochet (PROC), ni son ni étincelle d'impact par coup
const F_PROC = DMG.PROC | DMG.NO_CRIT | DMG.NO_IMPACT; // respecte le bouclier du blindé (drone, éclats)
const F_AREA = F_PROC | DMG.BYPASS_SHIELD; // éclair, explosion, ondes, dash, statuts
const F_QUIET = F_AREA | DMG.NO_NUMBER; // tic d'un statut au-delà du plafond de chiffres
//#region e5:AJ-equilibrage-aoe
// § E5.AJ : coups de ZONE des objets (explosion critique, onde de la coque, impulsion du condensateur, onde du bond) —
// boss, blindés et élites n'en prennent que 20 % (damage.hitEnemyF). Éclair, éclats, drones, dash, statuts : pas de zone.
// Overclock : exemplaires plafonnés (itemMaxStacks), sa part de cadence publiée pour weapons (armes de zone sans elle).
import { DMG_ZONE, itemMaxStacks } from './config.js';
const F_ZONE = F_AREA | DMG_ZONE;
const MAXS = new Uint16Array(ITEM_COUNT); // exemplaires au plus de chaque objet
for (let k = 0; k < ITEM_COUNT; k++) MAXS[k] = Math.min(65535, itemMaxStacks(k));
/** § E5.AJ : [0] = 1 + valeur de l'Overclock (sa part de mods.fireRateMul), lu par weapons.recompute. */
export const OC_RATE = new Float64Array([1]);
//#endregion e5:AJ-equilibrage-aoe

// ----- Possession ----------------------------------------------------------------------------------------------------
/** Piles de chaque objet (index = ITEM.*). Lecture seule pour les autres modules. */
export const stacks = new Uint16Array(N);
/** Rangée du HUD, dans l'ordre d'obtention : ITEM.* d'un objet, ou ITEM_COUNT + k pour l'objet né de la fusion k ; −1 = libre. */
export const slots = new Int8Array(SLOTS).fill(-1);
let slotCount = 0;
const value = new Float64Array(N); // itemValue(id, stacks[id]), recalculé à chaque changement
const fused = new Uint8Array(FUSION_COUNT); // 1 : la fusion k est faite (ses deux ingrédients partagent un emplacement)

// masques des objets « au coup » et « à la mort » possédés : onHitF et onKillF tiennent en une comparaison sans eux
const H_TESLA = 1;
const H_CRYO = 2;
const H_VIRUS = 4;
const H_BURN = 8;
const H_DET = 16;
const K_LEECH = 1;
const K_CAP = 2;
const K_SHRAP = 4;
const K_BURN = 8;
const K_MAL = 16; // § E3.F : Malware (mort infectée ET en feu)
let hitMask = 0;
let killMask = 0;

// ----- Réglages lus une fois (config.js) -------------------------------------------------------------------------------
const I_TESLA = ITEMS[ITEM.TESLA];
const I_VIRUS = ITEMS[ITEM.VIRUS];
const I_BURN = ITEMS[ITEM.BURN];
const I_DET = ITEMS[ITEM.DETONATOR];
const I_LEECH = ITEMS[ITEM.LEECH];
const I_SHIELD = ITEMS[ITEM.SHIELD];
const I_REACT = ITEMS[ITEM.REACTIVE];
const I_DASH = ITEMS[ITEM.DASHCORE];
const I_OC = ITEMS[ITEM.OVERCLOCK];
const I_DRONE = ITEMS[ITEM.DRONE];
const I_CAP = ITEMS[ITEM.CAPACITOR];
const I_SHRAP = ITEMS[ITEM.SHRAPNEL];
const I_SAVE = ITEMS[ITEM.SAVE];
// Flottants de réglage : constantes de module (jamais relues d'un objet en combat)
const TESLA_SHARE = I_TESLA.dmgShare;
const TESLA_RANGE = I_TESLA.jumpRange;
//#region e5:AL-retrait-cryogel
const CRYO_F = FUSION_RULES[0].factor; // gel de l'Orage glacé, dans SA règle (Cryogel retiré)
const CRYO_S = FUSION_RULES[0].seconds;
//#endregion e5:AL-retrait-cryogel
const VIRUS_S = I_VIRUS.seconds;
const BURN_S = I_BURN.seconds;
const BURN_DPS = I_BURN.dps;
const BURN_SPREAD = I_BURN.spread;
const DET_SHARE = I_DET.dmgShare;
const DET_KB = I_DET.knockback;
const DET_TRAUMA = I_DET.trauma;
const EDGE = 1 - DAMAGE.explosionEdgeFactor;
const REACT_R = I_REACT.radius;
const REACT_CD = I_REACT.cooldown;
// § E4.G : en mode recharge, deux ondes de la Coque réactive sont espacées de `every` s dans la fenêtre
const REACT_EVERY = RECHARGES.items && RECHARGES.items.reactive && RECHARGES.items.reactive.every > 0 ? RECHARGES.items.reactive.every : REACT_CD;
const REACT_KB = I_REACT.knockback;
const DASH_W = I_DASH.halfWidth;
const DRONE_RANGE = I_DRONE.range;
const DRONE_DMG = WEAPONS[WEAPON.BLASTER].stats[STAT.DAMAGE][0]; // « comme un blaster de niveau 1 »
const DRONE_RATE = WEAPONS[WEAPON.BLASTER].stats[STAT.RATE][0];
const DRONE_ORBIT = I_DRONE.orbit;
const DRONE_H = I_DRONE.height;
const DRONE_SPIN = I_DRONE.spin;
const DRONE_BOB = I_DRONE.bob;
const CAP_R2 = I_CAP.radius * I_CAP.radius;
const CAP_R = I_CAP.radius;
const CAP_TRAUMA = I_CAP.trauma;
const SHRAP_RANGE = I_SHRAP.range;
const TICK = ITEM_RULES.dotTick;
const LEECH_MAX = ITEM_RULES.leechPerSecond;
const HIT_INVULN = PLAYER.hitInvuln;
const STAR_SMALL = VFX.etoile.arc * 0.8;
const STAR_FLASH = VFX.etoile.flash;
const HEIGHT = 1.0; // m — hauteur des éclats et des arcs (celle des tirs)
// Indice de couleur des événements (VFX_COULEURS : les lignes des armes — aucune ligne ajoutée)
const C_CYAN = WEAPON.BLASTER; // drone, dash
const C_ORANGE = WEAPON.SHOTGUN; // explosion critique, feu
const C_BLUE = WEAPON.EMP; // condensateur
const C_VIOLET = WEAPON.RAIL; // sauvegarde
const C_GREEN = WEAPON.ROCKETS; // virus
const C_GOLD = 7; // onde de la coque, éclats (or pâle de la lame de phase)
const C_SKY = 8; // gel, pare-feu (bleu ciel de la sentinelle)

// ----- File des déclenchements (écrite par les crochets, vidée par update) -----------------------------------------------
const Q_TESLA = 0;
const Q_BOOM = 1;
const Q_REACTIVE = 2;
const Q_SHRAPNEL = 3;
const Q_SPREAD = 4;
const Q_FREEZE = 5; // éclat de gel (le ralentissement est déjà appliqué)
const Q_SHIELD = 6; // onde du pare-feu qui arrête un coup
const Q_SAVE = 7; // onde de la sauvegarde
const qKind = new Uint8Array(QCAP);
const qUid = new Uint32Array(QCAP);
const qX = new Float64Array(QCAP);
const qZ = new Float64Array(QCAP);
const qV = new Float64Array(QCAP);
let qN = 0;
const REG = new Float64Array(1); // montant du déclenchement à mettre en file
let busy = false; // update() est en train de frapper : aucun crochet ne doit arriver (compté s'il arrive)

// ----- Compteurs (entiers) et minuteries (flottants : tableau typé, § V) ---------------------------------------------------
const fired = new Uint16Array(N); // déclenchements de l'image en cours, par objet (plafond perFrame)
const peak = new Uint16Array(N); // plus grand nombre de déclenchements en une image depuis le reset
const count = new Uint32Array(N); // déclenchements depuis le reset
const rolls = new Uint32Array(N); // tirages réussis depuis le reset, AVANT le plafond par image (mesure de la chance réelle)
const CAPF = new Uint16Array(N); // plafond par image de chaque objet (0 = sans plafond)
for (let k = 0; k < N; k++) CAPF[k] = ITEMS[k].perFrame > 0 ? ITEMS[k].perFrame : 0;
let procHits = 0; // coups portés par les objets
let dropped = 0; // déclenchements perdus : file pleine
let queuePeak = 0;
let reentries = 0; // crochets reçus pendant update() : doit rester 0
let stars = 0; // éclats d'étoile de l'image en cours (plafond de lisibilité)
const STARS_MAX = 10;
const S_SHIELD = 0; // s avant que le pare-feu soit rechargé (0 : prêt)
const S_REACT = 1; // s avant que la coque puisse refaire une onde
const S_LEECH = 2; // PV que le siphon peut encore rendre (seau : + leechPerSecond par seconde)
const S_DOT = 3; // s depuis le dernier tic des statuts
const S_ANGLE = 4; // rad — orbite des drones
const S_CLOCK = 5; // s simulées depuis le reset
const S_RATE = 6; // part de mods.fireRateMul écrite par les objets (Overclock × Berserk)
const S_HP = 7; // part de mods.maxHpAdd écrite par l'Overclock (≤ 0)
const S_PX = 8; // position du héros à la fin de la dernière image (trajet du dash)
const S_PZ = 9;
const S_HEALED = 10; // PV rendus par le siphon depuis le reset (flottant : jamais dans un « let » de module, § V)
const S_BOOM_R = 11; // rayon de la dernière explosion critique (tests)
const S_SURGE = 12; // § E3.F Surrégime : s de cadence × 2 restantes
const S_CLOUD = 13; // § E3.F Malware : s depuis le dernier tic des nuages
const S_REACT_DMG = 14; // § E3.F : dégâts de la dernière onde de coque (tests)
const S_REACT_X = 15; // § E5.H : centre de la dernière onde de coque (visuel)
const S_REACT_Z = 16;
const S_ABS = 17; // PV absorbés par le Pare-feu dans sa charge en cours (réserve PAREFEU_RESERVE.pv, Femz 20/11)
const ST = new Float64Array(18);
let saveReady = 1; // la Sauvegarde est armée (une fois par vague)
let saves = 0;
let shieldBlocks = 0;
let lastWave = -1;
let capKills = 0; // robots tués par les armes depuis la dernière impulsion du condensateur
let capNeed = 0; // seuil entier de l'impulsion (0 : pas de condensateur)
let pulses = 0;
let leechPending = 0; // soins du siphon à rendre à la prochaine update
let dotActive = 0; // un statut a été posé depuis le dernier tic vide
let berserkStep = 0; // cran de PV manquants (0 à 16) pris en compte dans la cadence
let clearShots = 0; // la sauvegarde vient de se déclencher : les tirs ennemis sont purgés à la prochaine update
let dashing = 0;
let dashHits = 0;
let dashSeenN = 0;
const dashSeen = new Uint32Array(96); // robots déjà blessés par le dash en cours (uid)

// ----- Recherches de voisins, écrites sur les tableaux bruts de la grille (aucun flottant passé) ---------------------------
const GMIN = GRID.min;
const GINV = 1 / GRID.cellSize;
const GDIM = GRID.dim;
const GLAST = GRID.dim - 1;
let margin = 0;
const IN = new Float64Array(6); // 0 x, 1 z, 2 rayon ou portée ; segment : 0-1 départ, 3-4 arrivée, 2 demi-largeur
const OUT = new Uint16Array(CAPS.queryScratch);
const seen = new Uint32Array(16); // uid des robots écartés d'une recherche (cibles déjà prises par l'éclair, les éclats)
let seenN = 0;
let frozenOnly = 0; // § E3.F Orage glacé : nearest() ne garde que les robots ralentis (E.slowT > 0)

function isSeen(uid) {
  for (let k = 0; k < seenN; k++) if (seen[k] === uid) return true;
  return false;
}

/** Robot vivant le plus proche de (IN[0], IN[1]) à IN[2] m au plus (centre à centre), hors `seen` ; −1 si aucun. */
function nearest() {
  const x = IN[0];
  const z = IN[1];
  const r = IN[2];
  const X = E.x;
  const Z = E.z;
  const ALIVE = E.alive;
  const UID = E.uid;
  const cellStart = grid.cellStart;
  const cellCount = grid.cellCount;
  const cells = grid.items;
  let cx0 = Math.floor((x - r - GMIN) * GINV);
  let cx1 = Math.floor((x + r - GMIN) * GINV);
  let cz0 = Math.floor((z - r - GMIN) * GINV);
  let cz1 = Math.floor((z + r - GMIN) * GINV);
  if (cx0 < 0) cx0 = 0;
  if (cz0 < 0) cz0 = 0;
  if (cx1 > GLAST) cx1 = GLAST;
  if (cz1 > GLAST) cz1 = GLAST;
  let best = -1;
  let bd = r * r;
  for (let cz = cz0; cz <= cz1; cz++) {
    const row = cz * GDIM;
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = row + cx;
      const n = cellCount[c];
      if (n === 0) continue;
      const s = cellStart[c];
      for (let q = s; q < s + n; q++) {
        const i = cells[q];
        if (ALIVE[i] === 0) continue;
        const dx = X[i] - x;
        const dz = Z[i] - z;
        const d = dx * dx + dz * dz;
        if (d > bd || (seenN > 0 && isSeen(UID[i])) || (frozenOnly === 1 && E.slowT[i] <= 0)) continue;
        bd = d;
        best = i;
      }
    }
  }
  const b = E.bossIndex; // le boss n'est dans aucune cellule
  if (b >= 0 && ALIVE[b] === 1 && !(seenN > 0 && isSeen(UID[b])) && !(frozenOnly === 1 && E.slowT[b] <= 0)) {
    const dx = X[b] - x;
    const dz = Z[b] - z;
    const rr = r + E.radius[b];
    if (dx * dx + dz * dz <= rr * rr && (best < 0 || dx * dx + dz * dz < bd)) best = b;
  }
  return best;
}

/** Robots vivants dont le cercle touche le disque (IN[0], IN[1], IN[2]) → OUT ; rend leur nombre. */
function circle() {
  const x = IN[0];
  const z = IN[1];
  const r = IN[2];
  const X = E.x;
  const Z = E.z;
  const R = E.radius;
  const ALIVE = E.alive;
  const cellStart = grid.cellStart;
  const cellCount = grid.cellCount;
  const cells = grid.items;
  const reach = r + margin;
  let cx0 = Math.floor((x - reach - GMIN) * GINV);
  let cx1 = Math.floor((x + reach - GMIN) * GINV);
  let cz0 = Math.floor((z - reach - GMIN) * GINV);
  let cz1 = Math.floor((z + reach - GMIN) * GINV);
  if (cx0 < 0) cx0 = 0;
  if (cz0 < 0) cz0 = 0;
  if (cx1 > GLAST) cx1 = GLAST;
  if (cz1 > GLAST) cz1 = GLAST;
  let n = 0;
  const max = OUT.length;
  for (let cz = cz0; cz <= cz1; cz++) {
    const row = cz * GDIM;
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = row + cx;
      const k = cellCount[c];
      if (k === 0) continue;
      const s = cellStart[c];
      for (let q = s; q < s + k; q++) {
        const i = cells[q];
        if (ALIVE[i] === 0) continue;
        const dx = X[i] - x;
        const dz = Z[i] - z;
        const rr = r + R[i];
        if (dx * dx + dz * dz <= rr * rr && n < max) OUT[n++] = i;
      }
    }
  }
  const b = E.bossIndex;
  if (b >= 0 && ALIVE[b] === 1 && n < max) {
    const dx = X[b] - x;
    const dz = Z[b] - z;
    const rr = r + R[b];
    if (dx * dx + dz * dz <= rr * rr) OUT[n++] = b;
  }
  return n;
}

/** Robots vivants dont le cercle touche le segment (IN[0], IN[1]) → (IN[3], IN[4]) épaissi de IN[2] → OUT. */
function segment() {
  const x0 = IN[0];
  const z0 = IN[1];
  const w = IN[2];
  const x1 = IN[3];
  const z1 = IN[4];
  const X = E.x;
  const Z = E.z;
  const R = E.radius;
  const ALIVE = E.alive;
  const cellStart = grid.cellStart;
  const cellCount = grid.cellCount;
  const cells = grid.items;
  const reach = w + margin;
  let cx0 = Math.floor(((x0 < x1 ? x0 : x1) - reach - GMIN) * GINV);
  let cx1 = Math.floor(((x0 > x1 ? x0 : x1) + reach - GMIN) * GINV);
  let cz0 = Math.floor(((z0 < z1 ? z0 : z1) - reach - GMIN) * GINV);
  let cz1 = Math.floor(((z0 > z1 ? z0 : z1) + reach - GMIN) * GINV);
  if (cx0 < 0) cx0 = 0;
  if (cz0 < 0) cz0 = 0;
  if (cx1 > GLAST) cx1 = GLAST;
  if (cz1 > GLAST) cz1 = GLAST;
  const sx = x1 - x0;
  const sz = z1 - z0;
  const len2 = sx * sx + sz * sz;
  const inv = len2 > 1e-12 ? 1 / len2 : 0;
  let n = 0;
  const max = OUT.length;
  for (let cz = cz0; cz <= cz1; cz++) {
    const row = cz * GDIM;
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = row + cx;
      const k = cellCount[c];
      if (k === 0) continue;
      const s = cellStart[c];
      for (let q = s; q < s + k; q++) {
        const i = cells[q];
        if (ALIVE[i] === 0) continue;
        const ax = X[i] - x0;
        const az = Z[i] - z0;
        let t = (ax * sx + az * sz) * inv;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const dx = ax - sx * t;
        const dz = az - sz * t;
        const rr = w + R[i];
        if (dx * dx + dz * dz <= rr * rr && n < max) OUT[n++] = i;
      }
    }
  }
  const b = E.bossIndex;
  if (b >= 0 && ALIVE[b] === 1 && n < max) {
    const ax = X[b] - x0;
    const az = Z[b] - z0;
    let t = (ax * sx + az * sz) * inv;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = ax - sx * t;
    const dz = az - sz * t;
    const rr = w + R[b];
    if (dx * dx + dz * dz <= rr * rr) OUT[n++] = b;
  }
  return n;
}

// ----- Effets visuels : événements datés du lot EVENEMENTS (entrées dans V.Q, jamais en arguments) -------------------------
/** Éclat d'étoile en (Q[0], Q[2]), rayon Q[3], couleur c (indice de VFX_COULEURS). */
function star(c) {
  if (stars >= STARS_MAX) return;
  stars++;
  Q[1] = HEIGHT;
  Q[4] = 0;
  Q[5] = 0;
  Q[6] = 1;
  Q[7] = 0;
  Q[8] = c + 0.37;
  Q[9] = Q[3] * 2.6;
  V.evenement(VFX_STYLE.ETOILE);
}

/** Explosion (éclat en l'air + onde au sol) en (Q[0], Q[2]), rayon du souffle Q[3], couleur c. etoile = 0 : l'onde seule. */
function blast(c, etoile) {
  const x = Q[0];
  const z = Q[2];
  const r = Q[3];
  const X = VFX.explosion;
  Q[4] = 0;
  Q[5] = 0;
  Q[6] = 1;
  Q[7] = 0;
  Q[8] = c + 0.61;
  if (etoile === 1) {
    Q[1] = X.hauteur;
    Q[3] = r * X.etoile;
    Q[9] = Q[3] * X.quadEtoile;
    V.evenement(VFX_STYLE.EXPLOSION);
  }
  Q[0] = x;
  Q[1] = X.onde;
  Q[2] = z;
  Q[3] = r;
  Q[9] = r * X.quadOnde;
  V.evenement(VFX_STYLE.ONDE);
}

// ----- Cycle de vie ------------------------------------------------------------------------------------------------------
let droneMesh = null;
let droneMat = null;
let droneSettled = Promise.resolve();
let droneReady = false;
let drones = 0; // drones en vol (droneCount(stacks))
const drX = new Float64Array(CAPS.allyDrones);
const drZ = new Float64Array(CAPS.allyDrones);
const drYaw = new Float64Array(CAPS.allyDrones);
const drAcc = new Float64Array(CAPS.allyDrones);
let droneShots = 0;

let cdMod = null; // § E3.H

export function init(context) {
  cdMod = context.cooldowns || null; // § E3.H
  ctx = context;
  damage = ctx.damage;
  enemies = ctx.enemies;
  grid = ctx.grid;
  audio = ctx.audio;
  camera = ctx.camera;
  fx = ctx.fx;
  player = ctx.player;
  weapons = ctx.weapons;
  render = ctx.render;
  debug = ctx.debug;
  dmgLast = damage.LAST;
  pickups = ctx.pickups || null; // § E3.F
  chests = ctx.chests || null; // § E3.F
  // marge des cellules à lire : le plus grand rayon d'un robot hors boss (une élite porteuse est plus grosse)
  for (let t = 0; t < ENEMIES.types.length; t++) if (t !== ENEMY.BOSS && ENEMIES.types[t].radius > margin) margin = ENEMIES.types[t].radius;
  if (CHESTS.carrier.scale > 1) margin *= CHESTS.carrier.scale;
  // Drone compagnon : modèle Blender (outils/blender/drone_allie.py) chargé en arrière-plan, comme le coffre
  droneMesh = render.createInstanced(render.emptyModelGeometry(), render.createLitMaterial({ glowColor: I_DRONE.color }), CAPS.allyDrones, { castShadow: false, name: 'drones-allies' }); // sans ombre portée : + 1 appel de dessin, pas 2
  droneMat = droneMesh.instanceMatrix.array;
  droneSettled = chargerPieces(new URL('../' + MODELES.dir + I_DRONE.model, import.meta.url).href, { cible: 0.5 * I_DRONE.scale, emissifMateriau: true }).then(
    (d) => {
      render.setModelGeometry(droneMesh, d);
      droneReady = true;
    },
    (e) => console.warn('Drone compagnon illisible (il tire quand même, sans modèle) :', e),
  );
  refresh();
}

/** Promesse tenue (jamais rejetée) quand le modèle du drone est posé ou illisible : main refait alors un préchauffage. */
export function whenModelSettled() {
  return droneSettled;
}

/** Nouvelle partie : plus aucun objet. Après progression.reset (mods à zéro) et agents.reset. */
export function reset() {
  stacks.fill(0);
  slots.fill(-1);
  slotCount = 0;
  fused.fill(0);
  qN = 0;
  busy = false;
  fired.fill(0);
  peak.fill(0);
  count.fill(0);
  rolls.fill(0);
  procHits = 0;
  dropped = 0;
  queuePeak = 0;
  reentries = 0;
  stars = 0;
  ST.fill(0);
  ST[S_RATE] = 1;
  ST[S_LEECH] = LEECH_MAX;
  ST[S_PX] = P.x;
  ST[S_PZ] = P.z;
  saveReady = 1;
  saves = 0;
  shieldBlocks = 0;
  lastWave = -1;
  capKills = 0;
  pulses = 0;
  leechPending = 0;
  dotActive = 0;
  resetGaz(); // § E5.AH
  berserkStep = 0;
  clearShots = 0;
  dashing = 0;
  dashHits = 0;
  dashSeenN = 0;
  drAcc.fill(0);
  droneShots = 0;
  resetFusions(); // § E3.F
  resetEclats(); // § E5.Y
  refresh();
  //#region e5:X9-katana-puissance
  PUI[1] = 0;
  majPuissance(); // § E5.X9 : après progression.reset (piles à zéro)
  //#endregion e5:X9-katana-puissance
}

/**
 * Recalcule les valeurs, les masques et la part des objets dans mods (hors combat : à l'obtention d'un objet, ou
 * quand le cran du Berserk change). Écrit dans mods par DIFFÉRENCE : les bonus et l'agent gardent leur part.
 */
function refresh() {
  for (let k = 0; k < N; k++) value[k] = itemValue(k, stacks[k] < MAXS[k] ? stacks[k] : MAXS[k]); // § E5.AJ : effet borné au plafond
  hitMask = (stacks[ITEM.TESLA] > 0 ? H_TESLA : 0) | (stacks[ITEM.CRYO] > 0 ? H_CRYO : 0) | (stacks[ITEM.VIRUS] > 0 ? H_VIRUS : 0) | (stacks[ITEM.BURN] > 0 ? H_BURN : 0) | (stacks[ITEM.DETONATOR] > 0 ? H_DET : 0);
  killMask = (stacks[ITEM.LEECH] > 0 ? K_LEECH : 0) | (stacks[ITEM.CAPACITOR] > 0 ? K_CAP : 0) | (stacks[ITEM.SHRAPNEL] > 0 ? K_SHRAP : 0) | (stacks[ITEM.BURN] > 0 ? K_BURN : 0) | (fused[1] === 1 ? K_MAL : 0);
  capNeed = stacks[ITEM.CAPACITOR] > 0 ? Math.round(value[ITEM.CAPACITOR]) : 0;
  drones = droneCount(stacks[ITEM.DRONE]);
  mods.critMulAdd = value[ITEM.SCOPE];
  mods.berserk = value[ITEM.BERSERK];
  mods.fragmentMul = 1 + value[ITEM.MAGNET];
  mods.luck = value[ITEM.LUCK];
  // Overclock : PV max en moins, jamais sous minMaxHp (la part des bonus et de l'agent est lue par différence)
  const without = mods.maxHpAdd - ST[S_HP];
  let cut = I_OC.hpPerStack * (stacks[ITEM.OVERCLOCK] < MAXS[ITEM.OVERCLOCK] ? stacks[ITEM.OVERCLOCK] : MAXS[ITEM.OVERCLOCK]); // § E5.AJ
  const room = PLAYER.maxHp + without - I_OC.minMaxHp;
  if (cut > room) cut = room > 0 ? room : 0;
  if (-cut !== ST[S_HP]) {
    ST[S_HP] = -cut;
    mods.maxHpAdd = without - cut;
  }
  // cadence : Overclock × Berserk (cran de PV manquants, 0 à 16)
  let bz = mods.berserk * (berserkStep / 16);
  if (bz > I_BERSERK_MAX) bz = I_BERSERK_MAX;
  const rate = (1 + value[ITEM.OVERCLOCK]) * (1 + bz) * (ST[S_SURGE] > 0 ? SURGE_MUL : 1); // § E3.F : Surrégime
  OC_RATE[0] = 1 + value[ITEM.OVERCLOCK]; // § E5.AJ (avant markDirty : weapons.recompute la relit)
  if (rate !== ST[S_RATE]) {
    mods.fireRateMul = (mods.fireRateMul / ST[S_RATE]) * rate;
    ST[S_RATE] = rate;
  }
  if (weapons !== null) {
    weapons.markDirty();
    player.onModsChanged();
  }
}
const I_BERSERK_MAX = ITEMS[ITEM.BERSERK].max;

/** Un bonus vient d'être pris (progression.applyChoice) : la borne de PV max de l'Overclock suit. */
export function onModsChanged() {
  majPuissance(); // § E5.X9 : une carte Puissance a peut-être été prise
  if (stacks[ITEM.OVERCLOCK] > 0) refresh();
}

// ----- Possession : ajout, offre, fusion -----------------------------------------------------------------------------------

function pairOf(id) {
  return id >> 1; // les ingrédients 2k et 2k + 1 forment la fusion k (§ E2.0.2)
}

/**
 * Ajoute n piles de l'objet id (ou de l'objet né de la fusion k : id = ITEM_COUNT + k, une pile pour CHACUN de ses
 * deux ingrédients). false, sans rien changer : objet nouveau alors que la rangée est pleine, id ou n invalide.
 */
export function add(id, n) {
  if (!Number.isInteger(id) || !(n > 0)) return false;
  const k = Math.floor(n);
  if (id >= N) {
    const f = id - N;
    if (!(f < FUSION_COUNT) || fused[f] === 0) return false;
    stacks[FUSIONS[f].a] = Math.min(MAXS[FUSIONS[f].a], stacks[FUSIONS[f].a] + k); // § E5.AJ : plafond de chaque ingrédient
    stacks[FUSIONS[f].b] = Math.min(MAXS[FUSIONS[f].b], stacks[FUSIONS[f].b] + k);
  } else {
    if (id < 0) return false;
    if (stacks[id] === 0 && fused[pairOf(id)] === 0) {
      if (slotCount >= SLOTS) return false;
      slots[slotCount++] = id;
    }
    stacks[id] = Math.min(MAXS[id], stacks[id] + k); // § E5.AJ : plafond (au-dessus, venu de la console : ramené au plafond)
    vuObjet[id] = 1; // § E4.A
  }
  ST[S_PX] = P.x;
  ST[S_PZ] = P.z;
  refresh();
  audio.play(SFX.ITEM_GET);
  return true;
}

// § E5.X3 (Femz, 22/11) : Moteur cinétique du BASTION — son bond survole les robots ; les dégâts de l'objet partent
// avec l'onde d'atterrissage (src/dash-agents.js onde), une fois par robot touché, même effet et même compte que le dash.
let bondHits = 0;
/** Début d'une onde d'atterrissage (avant les frapperBond de ses robots). */
export function debutBond() {
  bondHits = 0;
}
/** Le robot i est pris dans l'onde d'atterrissage du Bastion : dégâts du Moteur cinétique (rien sans l'objet). */
export function frapperBond(i) {
  if (stacks[ITEM.DASHCORE] <= 0 || E.alive[i] === 0) return;
  Q[0] = E.x[i];
  Q[2] = E.z[i];
  Q[3] = STAR_SMALL * 1.3;
  star(C_CYAN);
  ARGF[F_V] = value[ITEM.DASHCORE];
  ARGF[F_SX] = P.x;
  ARGF[F_SZ] = P.z;
  strike(i, F_ZONE); // § E5.AJ : onde d'atterrissage
  if (bondHits++ === 0) {
    count[ITEM.DASHCORE]++;
    ARGF[F_X] = P.x;
    ARGF[F_Z] = P.z;
    audio.playF(SFX.ITEM_PROC);
  }
}

export function getStacks(id) {
  return id >= 0 && id < N ? stacks[id] : 0;
}

export function getValue(id) {
  return id >= 0 && id < N ? value[id] : 0;
}

export function getSlotCount() {
  return slotCount;
}

/** Piles affichées par l'emplacement k du HUD (objet né d'une fusion : celles de son premier ingrédient). */
export function slotStacks(k) {
  const id = slots[k];
  if (id < 0) return 0;
  return id >= N ? stacks[FUSIONS[id - N].a] : stacks[id];
}

/** L'emplacement k recharge (Pare-feu tombé, Sauvegarde déjà utilisée dans la vague) : sa case s'éteint au HUD. */
export function slotCharging(k) {
  const id = slots[k];
  if (id === ITEM.SHIELD) return ST[S_SHIELD] > 0;
  if (id === ITEM.SAVE) return saveReady === 0;
  if (id === N + pairOf(ITEM.SHIELD)) return ST[S_SHIELD] > 0;
  if (id === N + pairOf(ITEM.SAVE)) return saveReady === 0;
  return false;
}

/**
 * § E3.H : jauge horloge de l'emplacement k, de 0 (vient de partir) à 1 (prêt) ; −1 : pas de jauge. Pare-feu : sa
 * recharge ; Coque réactive : son délai ; Sauvegarde : 0 une fois utilisée dans la vague, 1 armée ; Condensateur :
 * robots tués / seuil ; objet en mode
 * recharge (RECHARGES.items) : cooldowns.fraction.
 */
export function slotCooldown(k) {
  return slotCdF(k) === 1 ? CDF[0] : -1;
}

/**
 * Même jauge en cran ENTIER (−1 : pas de jauge ; steps : prête), pour ui.js à chaque image (fusion du groupe 2, § V :
 * un flottant rendu par case et par image était un nombre alloué ; un petit entier ne l'est pas).
 */
export function slotCooldownStep(k, steps) {
  const id = slots[k];
  if (id >= 0 && id < N && cdMod !== null && cdMod.isCooldown(1, id)) return cdMod.stepOf(1, id, steps);
  if (slotCdF(k) === 0) return -1;
  const q = Math.floor(CDF[0] * steps + 1e-6);
  return q > steps ? steps : q;
}

const CDF = new Float64Array(1); // fraction de la jauge écrite par slotCdF (aucun flottant rendu)

/** Jauge de l'emplacement k dans CDF[0] ; rend 1 s'il y en a une, 0 sinon. */
function slotCdF(k) {
  const id = slots[k];
  if (id < 0) return 0;
  if (cdMod !== null && id < N && cdMod.isCooldown(1, id)) {
    // § E4.G : Coque réactive et Condensateur en mode recharge : la jauge suit la recharge (cooldowns), plus leur délai
    CDF[0] = cdMod.fraction(1, id);
    return 1;
  }
  if (id === ITEM.SHIELD || id === N + pairOf(ITEM.SHIELD)) {
    const d = value[ITEM.SHIELD];
    if (ST[S_SHIELD] <= 0 || !(d > 0)) CDF[0] = 1;
    else {
      const f = 1 - ST[S_SHIELD] / d;
      CDF[0] = f < 0 ? 0 : f;
    }
    return 1;
  }
  if (id === ITEM.REACTIVE || id === N + pairOf(ITEM.REACTIVE)) {
    if (ST[S_REACT] <= 0) CDF[0] = 1;
    else {
      const f = 1 - ST[S_REACT] / REACT_CD;
      CDF[0] = f < 0 ? 0 : f;
    }
    return 1;
  }
  if (id === ITEM.SAVE || id === N + pairOf(ITEM.SAVE)) {
    CDF[0] = saveReady === 1 ? 1 : 0;
    return 1;
  }
  if ((id === ITEM.CAPACITOR || id === N + pairOf(ITEM.CAPACITOR)) && capNeed > 0) {
    const f = capKills / capNeed; // l'impulsion se charge avec les robots tués
    CDF[0] = f > 1 ? 1 : f;
    return 1;
  }
  if (cdMod !== null && id < N && cdMod.isCooldown(1, id)) {
    CDF[0] = cdMod.fraction(1, id);
    return 1;
  }
  return 0;
}

const cand = new Int8Array(N + FUSION_COUNT);

/**
 * Offre d'un objet (coffres, choix de niveau) de rareté `rarity` : un objet NOUVEAU si la rangée a de la place, un
 * objet possédé sinon ; jamais banni ; jamais un objet de `taken` (déjà proposé par une autre carte du même tirage) ;
 * rang minimal ≤ rarity. rnd : flux de hasard de l'appelant. Écrit out = { id, stacks, name, desc, icon, key,
 * rarity, now, next, what } et rend true ; false si rien n'est proposable. Hors combat (construit des chaînes).
 */
export function rollOffer(rarity, out, rnd = rand, taken = null) {
  let n = 0;
  const free = slotCount < SLOTS;
  for (let id = 0; id < N; id++) {
    if (BANS.items[id] === 1 || ITEMS[id].tier > rarity) continue;
    if (meta.ITEM_OK[id] === 0) continue; // § E4.A.5 : objet verrouillé (méta), jamais proposé
    if (fused[pairOf(id)] === 1) continue; // un ingrédient fusionné n'est plus proposé seul
    if (stacks[id] === 0 && !free) continue;
    if (stacks[id] >= MAXS[id]) continue; // § E5.AJ : au plafond (Overclock × 5), plus proposé
    if (taken !== null && indexIn(taken, id)) continue;
    cand[n++] = id;
  }
  for (let f = 0; f < FUSION_COUNT; f++) {
    if (fused[f] === 0 || BANS.items[N + f] === 1) continue;
    if (taken !== null && indexIn(taken, N + f)) continue;
    cand[n++] = N + f;
  }
  if (n === 0) return false;
  const id = cand[Math.floor(rnd() * n) % n];
  describe(id, rarity, out);
  return true;
}

function indexIn(list, id) {
  for (let k = 0; k < list.length; k++) if (list[k] === id) return true;
  return false;
}

/** Remplit out pour l'objet id offert à la rareté rarity (hors combat). */
export function describe(id, rarity, out) {
  out.id = id;
  out.rarity = rarity;
  if (id >= N) {
    const F = FUSIONS[id - N];
    out.key = F.key;
    out.name = F.name;
    out.stacks = 1;
    out.icon = 'sr-m-' + F.key; // § E3.F : icône de l'objet né (FUSION_ICONS)
    out.what = '';
    out.now = '× ' + stacks[F.a];
    out.next = '× ' + (stacks[F.a] + 1);
    out.have = stacks[F.a]; // § E5.L (C3) : exemplaires possédés (« Possédé ×3 → ×4 »)
    out.desc = F.rule + TEXTES_N.fusionPlus + ITEMS[F.a].name + ' et ' + ITEMS[F.b].name + '.';
    return out;
  }
  const I = ITEMS[id];
  let gain = lotItemStacks(rarity, I.tier);
  if (stacks[id] + gain > MAXS[id]) gain = MAXS[id] > stacks[id] ? MAXS[id] - stacks[id] : 1; // § E5.AJ : « ×4 → ×5 »
  out.key = I.key;
  out.name = I.name;
  out.stacks = gain;
  out.icon = 'sr-m-' + I.key;
  out.what = I.what;
  out.have = stacks[id]; // § E5.L (C3)
  out.now = itemText(id, stacks[id]);
  out.next = itemText(id, stacks[id] + gain);
  // 16/11 (point 13b) : la phrase d'effet, puis les chiffres sur une ligne à part (ui.css : white-space: pre-line)
  // § E4.N.2 : la ligne d'effet (≤ 12 mots), puis les chiffres en court ; l'explication longue reste dans la fiche
  //#region e5:O-noms-guide
  // § E5.O (Femz, 21/11) : un effet chiffré par ligne — la pile passe sous la valeur (« · » avant)
  out.desc = I.desc + '\n' + cap(I.what) + ' : ' + (stacks[id] > 0 ? out.now + ' → ' : '') + out.next + (I.pile ? '\n' + I.pile : '');
  //#endregion e5:O-noms-guide
  // § E4.G : objet en mode recharge — l'effet, puis « Recharge 6,0 s → 5,7 s · Action 2,0 s → 2,2 s » (piles actuelles → après le lot)
  if (cdMod !== null && cdMod.isCooldown(1, id)) out.desc += '\n' + cdMod.salvesTexte(1, id, stacks[id], stacks[id] + gain); // § E4.N.2 : sans la phrase RECHARGE_TXT
  // § E5.X7 (H12) : la synergie inverse (« Utile avec : Viseur ») ; (H2) l'arme qu'il fait évoluer, si la recette est connue
  if (SYNERGIE_OBJET[id]) out.desc += '\n' + SYNERGIE_OBJET[id];
  const evo = ligneEvoObjet(id, meta.evoConnue);
  if (evo) out.desc += '\n' + evo;
  return out;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fusion k possible : ses deux ingrédients ont ITEM_RULES.fusionAt piles. Étape 2 : toujours false (FUSIONS[k].enabled). */
export function canFuse(k) {
  return k >= 0 && k < FUSION_COUNT && FUSIONS[k].enabled === true && isFusable(k);
}

function isFusable(k) {
  const F = FUSIONS[k];
  return fused[k] === 0 && stacks[F.a] >= ITEM_RULES.fusionAt && stacks[F.b] >= ITEM_RULES.fusionAt;
}

/**
 * Remplace les deux ingrédients de la fusion k par l'objet né : il prend l'emplacement du premier, le second est
 * libéré (les suivants remontent) ; les piles de chaque ingrédient restent comptées, leurs effets continuent. La
 * règle ajoutée par la fusion est codée à l'étape 3 ; rien n'appelle fuse() à l'étape 2 (hors debugFuse).
 */
export function fuse(k) {
  if (!(k >= 0 && k < FUSION_COUNT) || !isFusable(k)) return false;
  const F = FUSIONS[k];
  let ia = -1;
  let ib = -1;
  for (let s = 0; s < slotCount; s++) {
    if (slots[s] === F.a) ia = s;
    else if (slots[s] === F.b) ib = s;
  }
  if (ia < 0 || ib < 0) return false;
  const keep = ia < ib ? ia : ib;
  const drop = ia < ib ? ib : ia;
  slots[keep] = N + k;
  for (let s = drop; s < slotCount - 1; s++) slots[s] = slots[s + 1];
  slots[--slotCount] = -1;
  fused[k] = 1;
  run.fusions++; // § E3.F
  fusionWave[k] = run.wave;
  refresh();
  return true;
}

// ----- Crochets (appelés par damage.js : ils n'écrivent que la file, jamais de coup) ---------------------------------------

function push(kind, i) {
  if (qN >= QCAP) {
    dropped++;
    return;
  }
  qKind[qN] = kind;
  if (i >= 0) {
    qUid[qN] = E.uid[i];
    qX[qN] = E.x[i];
    qZ[qN] = E.z[i];
  } else {
    qUid[qN] = 0;
    qX[qN] = P.x;
    qZ[qN] = P.z;
  }
  qV[qN] = REG[0];
  qN++;
  if (qN > queuePeak) queuePeak = qN;
}

/**
 * Un coup d'arme vient de retirer des PV au robot i (damage.hitEnemyF, après l'étape 4 ; montant dans damage.LAST).
 * crit : 1 si le coup est critique. Jamais appelé pour un coup DMG.PROC. Sources : les armes, et le debug (tests).
 */
export function onHitF(i, source, crit) {
  if (hitMask === 0) return;
  if (busy) {
    reentries++;
    return;
  }
  if (source >= DMG_SRC.KAMIKAZE && source !== DMG_SRC.DEBUG) return;
  const m = hitMask;
  if ((m & H_VIRUS) !== 0 && IO[ITEM.VIRUS] === 1) {
    if (E.dotT0[i] <= 0) signalerInfection(i); // § E5.AH : sain → infecté (un coup qui prolonge l'infection ne compte pas)
    E.dot0[i] = value[ITEM.VIRUS];
    E.dotT0[i] = VIRUS_S;
    dotActive = 1;
    count[ITEM.VIRUS]++;
  }
  if ((m & H_BURN) !== 0 && IO[ITEM.BURN] === 1 && rand() < value[ITEM.BURN]) {
    rolls[ITEM.BURN]++;
    E.dot1[i] = BURN_DPS;
    E.dotT1[i] = BURN_S;
    dotActive = 1;
    count[ITEM.BURN]++;
  }
  if ((m & H_CRYO) !== 0 && rand() < value[ITEM.CRYO] && rolls[ITEM.CRYO]++ >= 0 && fired[ITEM.CRYO] < CAPF[ITEM.CRYO]) {
    // le gel n'est pas un coup : appliqué tout de suite ; les cases du registre sont rendues à l'appelant
    const v = ARGF[F_V];
    const t = ARGF[F_T];
    ARGF[F_V] = CRYO_F;
    ARGF[F_T] = CRYO_S;
    enemies.applySlowF(i);
    ARGF[F_V] = v;
    ARGF[F_T] = t;
    count[ITEM.CRYO]++;
    if (fired[ITEM.CRYO]++ < 3) push(Q_FREEZE, i);
  }
  if ((m & H_TESLA) !== 0 && rand() < value[ITEM.TESLA] && rolls[ITEM.TESLA]++ >= 0 && fired[ITEM.TESLA] < CAPF[ITEM.TESLA]) {
    fired[ITEM.TESLA]++;
    REG[0] = dmgLast[0] * TESLA_SHARE;
    push(Q_TESLA, i);
  }
  if (crit === 1 && (m & H_DET) !== 0 && IO[ITEM.DETONATOR] === 1 && rolls[ITEM.DETONATOR]++ >= 0 && fired[ITEM.DETONATOR] < CAPF[ITEM.DETONATOR]) {
    fired[ITEM.DETONATOR]++;
    REG[0] = dmgLast[0] * DET_SHARE;
    push(Q_BOOM, i);
  }
}

/** Un coup d'arme vient de tuer le robot i (damage.killEnemyF, après le butin). Jamais appelé pour un coup DMG.PROC. */
export function onKillF(i) {
  if (killMask === 0) return;
  if (busy) {
    reentries++;
    return;
  }
  const m = killMask;
  if ((m & K_LEECH) !== 0 && rand() < value[ITEM.LEECH] && rolls[ITEM.LEECH]++ >= 0 && ST[S_LEECH] >= I_LEECH.heal) {
    ST[S_LEECH] -= I_LEECH.heal;
    leechPending++;
  }
  if ((m & K_CAP) !== 0 && (capKills < capNeed || IO[ITEM.CAPACITOR] === 1)) capKills++; // § E4.G : fenêtre fermée → la charge s'arrête au plein
  if ((m & K_SHRAP) !== 0 && IO[ITEM.SHRAPNEL] === 1 && rand() < value[ITEM.SHRAPNEL] && rolls[ITEM.SHRAPNEL]++ >= 0 && fired[ITEM.SHRAPNEL] < CAPF[ITEM.SHRAPNEL]) {
    fired[ITEM.SHRAPNEL]++;
    push(Q_SHRAPNEL, i);
  }
  if ((m & K_BURN) !== 0 && IO[ITEM.BURN] === 1 && E.dotT1[i] > 0 && fired[ITEM.BURN] < CAPF[ITEM.BURN]) {
    fired[ITEM.BURN]++;
    push(Q_SPREAD, i);
  }
  // § E3.F Malware : un robot tué par une arme, infecté ET en feu, laisse un nuage toxique
  if ((m & K_MAL) !== 0 && E.dotT0[i] > 0 && E.dotT1[i] > 0 && ffired[1] < FCAP[1]) {
    ffired[1]++;
    push(Q_CLOUD, i);
  }
}

/** PAREFEU_F[0] (barre bleue, barres-vie.js) : réserve restante / PAREFEU_RESERVE.pv si le Pare-feu est chargé, −1 sinon. */
function majBouclier() {
  PAREFEU_F[0] = stacks[ITEM.SHIELD] > 0 && ST[S_SHIELD] <= 0 && P.alive ? 1 - ST[S_ABS] / PAREFEU_RESERVE.pv : -1;
}

/**
 * Le joueur va recevoir `amount` dégâts (damage.hitPlayer, après l'armure, avant les PV). Rend 2 si le Pare-feu chargé
 * l'ENCAISSE (aucun PV perdu, mais le coup « porte » pour l'attaquant : sa recharge part, un tir est consommé — § E5.X,
 * relecture du 20/11), 1 si le coup est ANNULÉ (coup mortel et Sauvegarde armée), 0 sinon. Le seul crochet qui agit
 * tout de suite — sans frapper.
 */
export function onPlayerHitF(amount) {
  if (stacks[ITEM.SHIELD] > 0 && ST[S_SHIELD] <= 0) {
    // Femz, 20/11 soir : le bouclier chargé ENCAISSE le coup (réserve PAREFEU_RESERVE.pv) ; il ne tombe que quand la
    // réserve est vide — et le coup qui la vide est arrêté en entier (rien ne déborde sur les PV)
    if (P.invulnT < HIT_INVULN) P.invulnT = HIT_INVULN;
    ST[S_ABS] += amount;
    if (ST[S_ABS] < PAREFEU_RESERVE.pv) {
      majBouclier();
      return 2;
    }
    ST[S_ABS] = 0;
    ST[S_SHIELD] = value[ITEM.SHIELD];
    majBouclier();
    shieldBlocks++;
    count[ITEM.SHIELD]++;
    audio.play(SFX.ITEM_SHIELD);
    push(Q_SHIELD, -1);
    if (fused[4] === 1) {
      // § E3.F Pare-feu actif : l'onde de la coque part avec le bouclier, à dégâts × dmgMul, sans attendre sa recharge
      REG[0] = value[ITEM.REACTIVE] * PFA_MUL;
      push(Q_REACTIVE, -1);
      ftrig[4]++;
    }
    return 2;
  }
  if (stacks[ITEM.SAVE] > 0 && saveReady === 1 && P.hp - amount <= 0 && !debug.isInvincible()) {
    saveReady = 0;
    saves++;
    count[ITEM.SAVE]++;
    const hp = P.hp + value[ITEM.SAVE] * P.maxHp;
    P.hp = hp > P.maxHp ? P.maxHp : hp;
    if (P.invulnT < HIT_INVULN * 2) P.invulnT = HIT_INVULN * 2;
    clearShots = 1;
    audio.play(SFX.ITEM_SHIELD);
    fx.hitstop();
    ctx.ui.queueBanner(SAVE_BANNER, 1.4);
    push(Q_SAVE, -1);
    if (fused[8] === 1) {
      restorePending = 1; // § E3.F Point de restauration : un coffre gratuit à la fin de la vague
      ftrig[8]++;
    }
    return 1;
  }
  if (stacks[ITEM.REACTIVE] > 0 && ST[S_REACT] <= 0 && IO[ITEM.REACTIVE] === 1) {
    ST[S_REACT] = cdMod !== null && cdMod.isCooldown(1, ITEM.REACTIVE) ? REACT_EVERY : REACT_CD; // § E4.G
    REG[0] = value[ITEM.REACTIVE];
    push(Q_REACTIVE, -1);
  }
  return 0;
}
const SAVE_BANNER = 'CTRL+Z : SAUVEGARDE RESTAURÉE';

//#region e5:X9-katana-puissance
// § E5.X9 (H1 ; Femz 21/11 : « Puissance = +10 % armes ET objets ») — PUI[0] : multiplicateur des dégâts de tout coup
// d'objet (strike), 1 + piles de Puissance × valeur de la carte : empilement ADDITIF, comme mods.damageMul pour les armes
// (5 cartes : × 1,5). PUI[1] = 1 pendant les déclenchements qui portent une PART d'un coup d'arme (Bobine Tesla, Charge
// critique et sa seconde explosion) : ce coup porte déjà Puissance, elle n'est pas comptée deux fois. Recalculé hors
// image (bonus pris, nouvelle partie) : strike ne lit que deux flottants.
const PUI = new Float64Array(2);
PUI[0] = 1;
const B_PUI = PROGRESSION.bonuses[BONUS.DAMAGE];
function majPuissance() {
  const pr = ctx !== null && ctx.progression ? ctx.progression : null;
  PUI[0] = 1 + (pr !== null ? pr.getStacks(BONUS.DAMAGE) : 0) * B_PUI.value;
}
//#endregion e5:X9-katana-puissance

// ----- Résolution des déclenchements (update seulement) ----------------------------------------------------------------------

/** Porte ARGF[F_V] dégâts au robot i depuis (ARGF[F_SX], ARGF[F_SZ]) ; rend le résultat de hitEnemyF. */
function strike(i, flags) {
  //#region e5:X9-katana-puissance
  if (PUI[1] === 0) ARGF[F_V] *= PUI[0]; // § E5.X9 (H1) : Puissance, sauf sur une part de coup d'arme (déjà dedans)
  //#endregion e5:X9-katana-puissance
  const r = damage.hitEnemyF(i, DMG_SRC.ITEM, flags);
  if (r > 0) procHits++;
  return r;
}

/** Éclair en chaîne : part du robot frappé (qX, qZ), saute au plus `jumps` fois vers le robot le plus proche non encore touché. */
function tesla(q) {
  let x = qX[q];
  let z = qZ[q];
  const dmg = qV[q];
  seenN = 0;
  seen[seenN++] = qUid[q];
  const jumps = I_TESLA.jumps;
  let done = 0;
  for (let j = 0; j < jumps; j++) {
    IN[0] = x;
    IN[1] = z;
    IN[2] = TESLA_RANGE;
    let t = nearest();
    if (t < 0 && fused[0] === 1) {
      // § E3.F Orage glacé : rien à portée → l'éclair saute deux fois plus loin, vers un robot gelé seulement
      IN[2] = TESLA_RANGE * ORAGE_MUL;
      frozenOnly = 1;
      t = nearest();
      frozenOnly = 0;
      if (t >= 0) orageLong++;
    }
    if (t < 0) break;
    seen[seenN++] = E.uid[t];
    if (fused[0] === 1) {
      // § E3.F Orage glacé : chaque robot touché par l'éclair est gelé (réglages du Cryogel)
      ARGF[F_V] = CRYO_F;
      ARGF[F_T] = CRYO_S;
      enemies.applySlowF(t);
      ftrig[0]++;
    }
    const tx = E.x[t];
    const tz = E.z[t];
    let dx = tx - x;
    let dz = tz - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 1e-6) {
      dx /= d;
      dz /= d;
    } else {
      dx = 0;
      dz = 1;
    }
    Q[0] = x;
    Q[1] = HEIGHT;
    Q[2] = z;
    Q[4] = dx;
    Q[5] = 0;
    Q[6] = dz;
    Q[7] = d;
    V.arc(j === jumps - 1 || j === 0 ? 1 : 0);
    ARGF[F_V] = dmg;
    ARGF[F_SX] = x;
    ARGF[F_SZ] = z;
    strike(t, F_AREA);
    x = tx;
    z = tz;
    done++;
  }
  if (done > 0) {
    count[ITEM.TESLA]++;
    jumpsDone += done;
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    audio.playF(SFX.ITEM_TESLA);
  }
}
let jumpsDone = 0;

/** Explosion d'un coup critique : tout ce qui touche le disque (qX, qZ, rayon de l'objet), atténué au bord, repoussé. */
function boom(q) {
  const x = qX[q];
  const z = qZ[q];
  let dmg = qV[q];
  const r = value[ITEM.DETONATOR];
  // § E3.F Réaction en chaîne : l'explosion d'un critique tire sa propre chance de critique ; critique → × critMul et
  // une seconde explosion au même point, qui ne tire plus rien (une seule fois)
  if (fused[2] === 1 && qKind[q] === Q_BOOM && ffired[2] < FCAP[2] && rand() < PLAYER.critChance + mods.critChanceAdd) {
    ffired[2]++;
    ftrig[2]++;
    dmg *= PLAYER.critMul + mods.critMulAdd;
    REG[0] = dmg * DET_SHARE;
    pushAt(Q_BOOM2, x, z);
  }
  IN[0] = x;
  IN[1] = z;
  IN[2] = r;
  const n = circle();
  for (let k = 0; k < n; k++) {
    const i = OUT[k];
    if (E.alive[i] === 0) continue;
    const dx = E.x[i] - x;
    const dz = E.z[i] - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    let f = d / r;
    if (f > 1) f = 1;
    ARGF[F_V] = dmg * (1 - EDGE * f);
    ARGF[F_SX] = x;
    ARGF[F_SZ] = z;
    if (strike(i, F_ZONE) > 0 && d > 1e-6 && E.alive[i] === 1) {
      ARGF[F_DX] = dx / d;
      ARGF[F_DZ] = dz / d;
      ARGF[F_V] = DET_KB;
      enemies.applyKnockbackF(i);
    }
  }
  count[ITEM.DETONATOR]++;
  ST[S_BOOM_R] = r;
  lastBoomHits = n;
  Q[0] = x;
  Q[2] = z;
  Q[3] = r;
  blast(C_ORANGE, 1);
  camera.addTrauma(DET_TRAUMA, TRAUMA.PLAYER_EXPLOSION);
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  audio.playF(SFX.ITEM_BOOM);
}
let lastBoomHits = 0;

/** Onde de la coque réactive, autour du héros au moment du coup reçu : dégâts et recul. */
function reactive(q) {
  const x = qX[q];
  const z = qZ[q];
  const dmg = qV[q];
  ST[S_REACT_DMG] = dmg; // § E3.F : mesure du Pare-feu actif
  ST[S_REACT_X] = x; // § E5.H : l'anneau de choc de la coque part d'ici
  ST[S_REACT_Z] = z;
  IN[0] = x;
  IN[1] = z;
  IN[2] = REACT_R;
  const n = circle();
  for (let k = 0; k < n; k++) {
    const i = OUT[k];
    if (E.alive[i] === 0) continue;
    const dx = E.x[i] - x;
    const dz = E.z[i] - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    ARGF[F_V] = dmg;
    ARGF[F_SX] = x;
    ARGF[F_SZ] = z;
    strike(i, F_ZONE); // § E5.AJ
    if (d > 1e-6 && E.alive[i] === 1) {
      ARGF[F_DX] = dx / d;
      ARGF[F_DZ] = dz / d;
      ARGF[F_V] = REACT_KB;
      enemies.applyKnockbackF(i);
    }
  }
  count[ITEM.REACTIVE]++;
  Q[0] = x;
  Q[2] = z;
  Q[3] = REACT_R;
  blast(C_GOLD, 0); // § E5.H : gardée (son anneau et sa lumière au sol) ; src/vfx/coque-reactive.js s'y cale et y ajoute éclats et flash
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  audio.playF(SFX.ITEM_BOOM);
}

/**
 * Éclats d'un robot tué : les `shards` robots les plus proches de sa mort, à `range` m au plus. § E5.Y : chaque éclat
 * part en VOL vers sa cible (pool des fragments) ; le coup tombe à l'arrivée (avancerEclats). Pool plein : coup immédiat.
 */
function shrapnel(q) {
  const x = qX[q];
  const z = qZ[q];
  const dmg = I_SHRAP.dmgBase + I_SHRAP.dmgPerStack * stacks[ITEM.SHRAPNEL];
  seenN = 0;
  seen[seenN++] = qUid[q];
  let done = 0;
  for (let s = 0; s < I_SHRAP.shards; s++) {
    IN[0] = x;
    IN[1] = z;
    IN[2] = SHRAP_RANGE;
    const t = nearest();
    if (t < 0) break;
    seen[seenN++] = E.uid[t];
    if (frN < EC_CAP) {
      // § E5.Y : le fragment s'envole (cible, montant et départ fixés maintenant ; la cible est suivie pendant le vol)
      const k = frN++;
      const dx = E.x[t] - x;
      const dz = E.z[t] - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      let vol = EC_BASE + d / EC_V;
      if (vol < EC_VMIN) vol = EC_VMIN;
      else if (vol > EC_VMAX) vol = EC_VMAX;
      frT[k] = t;
      frUid[k] = E.uid[t];
      frX0[k] = x;
      frZ0[k] = z;
      frTX[k] = E.x[t];
      frTZ[k] = E.z[t];
      frAge[k] = 0;
      frDur[k] = vol;
      frDmg[k] = dmg;
      frBosse[k] = EC_BOSSE + EC_BOSSE_M * d;
      frCote[k] = (s & 1) === 0 ? EC_COURBE : -EC_COURBE;
      frG[k] = (ecLances * 0.618034) % 1;
      ecLances++;
      if (frN > ecPic) ecPic = frN;
    } else {
      // pool plein : l'ancien chemin (coup immédiat, étoile sur la cible) — les dégâts ne sont jamais perdus
      ecDirects++;
      Q[0] = E.x[t];
      Q[2] = E.z[t];
      Q[3] = EC_ETOILE;
      star(EC_COUL);
      ARGF[F_V] = dmg;
      ARGF[F_SX] = x;
      ARGF[F_SZ] = z;
      frapperEclat(t);
    }
    done++;
  }
  if (done > 0) {
    count[ITEM.SHRAPNEL]++;
    shardsDone += done;
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    if (EC_SONS.projection >= 0) audio.playF(EC_SONS.projection); // § E5.Y : son de la PROJECTION (ECLATS.son.projection), une fois par robot qui projette
  }
}

//#region e5:Y-eclats
// § E5.Y : fragments des Éclats en vol. Pool préalloué (tableaux typés, retrait par échange), aucun flottant passé en
// argument (dt par EC_DT, montants par ARGF, positions par V.Q). update : avancerEclats (avant la file : un fragment né
// dans l'image est dessiné à son départ) ; sync : syncEclats (à la suite du lot TIRS, style VFX_STYLE.ECLAT).
const EC_CAP = ECLATS.cap;
const EC_V = ECLATS.vitesse;
const EC_BASE = ECLATS.volBase;
const EC_VMIN = ECLATS.volMin;
const EC_VMAX = ECLATS.volMax;
const EC_H = ECLATS.hauteur;
const EC_BOSSE = ECLATS.bosse;
const EC_BOSSE_M = ECLATS.bosseParM;
const EC_COURBE = ECLATS.courbe;
const EC_TAILLE = ECLATS.taille;
const EC_MARGE = ECLATS.marge;
const EC_TRAINE = ECLATS.traine;
const EC_ETOILE = VFX.etoile.arc * ECLATS.etoile;
const EC_COUL = ECLATS.couleur;
const EC_SONS = ECLATS.son; // lus à chaque son (entiers ; l'écart est un nombre déjà rangé) : la fusion les relie, les tests les changent à chaud
const EC_STYLE = VFX_STYLE.ECLAT;
const frT = new Int32Array(EC_CAP); // robot visé ; −1 : mort ou remplacé pendant le vol (le fragment finit sa course, sans coup)
const frUid = new Uint32Array(EC_CAP);
const frX0 = new Float64Array(EC_CAP); // départ (mort du robot)
const frZ0 = new Float64Array(EC_CAP);
const frTX = new Float64Array(EC_CAP); // arrivée : position courante de la cible (dernière connue si elle est perdue)
const frTZ = new Float64Array(EC_CAP);
const frAge = new Float64Array(EC_CAP);
const frDur = new Float64Array(EC_CAP);
const frDmg = new Float64Array(EC_CAP);
const frBosse = new Float64Array(EC_CAP);
const frCote = new Float64Array(EC_CAP);
const frG = new Float64Array(EC_CAP);
let frN = 0;
let ecLances = 0; // fragments partis depuis le reset
let ecImpacts = 0; // coups portés à l'arrivée
let ecPerdus = 0; // arrivés sans coup (cible morte ou remplacée pendant le vol)
let ecDirects = 0; // pool plein : coups immédiats sans vol
let ecPic = 0; // plus grand nombre de fragments en vol
let ecSonsImpact = 0; // sons d'impact joués depuis le reset (mesure du budget)
const EC_DT = new Float64Array(1);
const EC_SON_T = new Float64Array(1); // s depuis le dernier son d'impact (budget ECLATS.son.impactEcart)
EC_SON_T[0] = 1e9;
const ECM = new Float64Array(4); // 0 dégâts portés à l'arrivée, 1 vol le plus court, 2 vol le plus long (s, mesurés), 3 dernier vol
ECM[1] = 1e9;

/** Porte le coup d'un éclat (ARGF déjà posé) au robot t ; Recyclage (fusion 7) : son tirage de fragment est refait s'il meurt. */
function frapperEclat(t) {
  if (fused[7] === 1 && pickups !== null) {
    // § E3.F Recyclage : un robot tué par cet éclat refait son tirage de fragment (le double en moyenne)
    const ty = E.type[t];
    const lootOk = (E.flags[t] & EFLAG.NO_LOOT) === 0;
    strike(t, F_PROC);
    if (lootOk && E.alive[t] === 0) recycle(t, ty);
  } else strike(t, F_PROC);
}

/** Avance les fragments de EC_DT[0] s ; à l'arrivée : étoile, coup (si la cible est toujours là), retrait. */
function avancerEclats() {
  const dt = EC_DT[0];
  EC_SON_T[0] += dt;
  for (let k = frN - 1; k >= 0; k--) {
    const t = frT[k];
    if (t >= 0) {
      if (E.alive[t] === 0 || E.uid[t] !== frUid[k]) frT[k] = -1;
      else {
        frTX[k] = E.x[t];
        frTZ[k] = E.z[t];
      }
    }
    frAge[k] += dt;
    if (frAge[k] < frDur[k]) continue;
    // arrivée
    Q[0] = frTX[k];
    Q[2] = frTZ[k];
    Q[3] = EC_ETOILE;
    star(EC_COUL);
    if (frT[k] >= 0) {
      ARGF[F_V] = frDmg[k];
      ARGF[F_SX] = frX0[k];
      ARGF[F_SZ] = frZ0[k];
      frapperEclat(frT[k]);
      ecImpacts++;
      ECM[0] += frDmg[k];
      // son d'impact : à chaque fragment qui touche, au plus un toutes les impactEcart s
      if (EC_SONS.impact >= 0 && EC_SON_T[0] >= EC_SONS.impactEcart) {
        EC_SON_T[0] = 0;
        ecSonsImpact++;
        ARGF[F_X] = frTX[k];
        ARGF[F_Z] = frTZ[k];
        audio.playF(EC_SONS.impact);
      }
    } else ecPerdus++;
    if (frAge[k] < ECM[1]) ECM[1] = frAge[k];
    if (frAge[k] > ECM[2]) ECM[2] = frAge[k];
    ECM[3] = frAge[k];
    // retrait par échange avec le dernier (déjà avancé : la boucle descend)
    const j = --frN;
    if (k !== j) {
      frT[k] = frT[j];
      frUid[k] = frUid[j];
      frX0[k] = frX0[j];
      frZ0[k] = frZ0[j];
      frTX[k] = frTX[j];
      frTZ[k] = frTZ[j];
      frAge[k] = frAge[j];
      frDur[k] = frDur[j];
      frDmg[k] = frDmg[j];
      frBosse[k] = frBosse[j];
      frCote[k] = frCote[j];
      frG[k] = frG[j];
    }
  }
}

/** Dessin des fragments : à la suite du lot TIRS (après weapons.sync, evo.sync), style VFX_STYLE.ECLAT. */
function syncEclats() {
  if (!P.alive) {
    frN = 0; // game over : la simulation est arrêtée, les fragments ne resteraient pas figés en l'air
    return;
  }
  const a = V.tampon(V.LOT.TIRS);
  const cap = V.capacite(V.LOT.TIRS);
  let n = V.compte[V.LOT.TIRS];
  for (let k = 0; k < frN && n < cap; k++) {
    let u = frAge[k] / frDur[k];
    if (u > 1) u = 1;
    const ex = frTX[k] - frX0[k];
    const ez = frTZ[k] - frZ0[k];
    const d = Math.sqrt(ex * ex + ez * ez);
    const px = d > 1e-6 ? -ez / d : 0; // perpendiculaire au sol (écart latéral)
    const pz = d > 1e-6 ? ex / d : 0;
    const b = 4 * u * (1 - u); // cloche : 0 au départ et à l'arrivée, 1 au milieu
    const db = 4 - 8 * u;
    const c = frCote[k];
    let vx = ex + px * c * db;
    const vy = frBosse[k] * db;
    let vz = ez + pz * c * db;
    let vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (vl < 1e-6) {
      vx = 1;
      vz = 0;
      vl = 1;
    }
    let L = u * d;
    if (L > EC_TRAINE) L = EC_TRAINE;
    const p = n * V.STRIDE;
    n++;
    a[p] = frX0[k] + ex * u + px * c * b;
    a[p + 1] = EC_H + frBosse[k] * b;
    a[p + 2] = frZ0[k] + ez * u + pz * c * b;
    a[p + 3] = EC_TAILLE;
    a[p + 4] = vx / vl;
    a[p + 5] = vy / vl;
    a[p + 6] = vz / vl;
    a[p + 7] = L;
    a[p + 8] = EC_STYLE;
    a[p + 9] = frG[k];
    a[p + 10] = 1;
    a[p + 11] = EC_MARGE;
  }
  V.compte[V.LOT.TIRS] = n;
}

/** Tests : état des fragments (hors combat). */
function inspectEclats(out) {
  out.eclats = {
    vol: frN,
    lances: ecLances,
    impacts: ecImpacts,
    perdus: ecPerdus,
    directs: ecDirects,
    pic: ecPic,
    degats: ECM[0],
    volMin: ECM[1] < 1e8 ? ECM[1] : 0,
    volMax: ECM[2],
    dernierVol: ECM[3],
    sonsImpact: ecSonsImpact,
    enVol: [],
  };
  for (let k = 0; k < frN; k++) out.eclats.enVol.push({ cible: frT[k], age: frAge[k], duree: frDur[k], degats: frDmg[k], x0: frX0[k], z0: frZ0[k], tx: frTX[k], tz: frTZ[k] });
}

function resetEclats() {
  frN = 0;
  ecLances = 0;
  ecImpacts = 0;
  ecPerdus = 0;
  ecDirects = 0;
  ecPic = 0;
  ecSonsImpact = 0;
  EC_SON_T[0] = 1e9;
  ECM.fill(0);
  ECM[1] = 1e9;
}
//#endregion e5:Y-eclats

//#region e5:AH-virus-gaz
// § E5.AH : gaz vert des robots infectés (E.dotT0 > 0) et son de l'infection. Pool fixe de bouffées (tableaux typés,
// retrait par échange) : naissance dans le corps du robot, montée amortie, balancement au sous-pixel, ancre qui suit le
// robot tant que son emplacement garde le même uid. Dessin : style VIRUS_GAZ.style à la suite du lot TIRS (aucun appel
// de dessin de plus). Aucun flottant passé en argument, rien d'alloué par image.
const VG_ON = VIRUS_GAZ.actif ? 1 : 0;
const VG_CAP = VIRUS_GAZ.cap;
const VG_STYLE = VIRUS_GAZ.style;
const VG_TAUX = VIRUS_GAZ.taux;
const VG_NAISS = VIRUS_GAZ.naissance;
const VG_VIE = VIRUS_GAZ.vie;
const VG_VIEVAR = VIRUS_GAZ.vieVar;
const VG_ECART = VIRUS_GAZ.ecart;
const VG_MONTEE = VIRUS_GAZ.montee;
const VG_BAL = VIRUS_GAZ.balance;
const VG_BALW = VIRUS_GAZ.balanceHz * TAU;
const VG_SUIVI = VIRUS_GAZ.suivi;
const VG_TAILLE = VIRUS_GAZ.taille;
const VG_MARGE = VIRUS_GAZ.marge;
const VG_SON = VIRUS_GAZ.son && VIRUS_GAZ.son.id >= 0 ? VIRUS_GAZ.son.id : -1;
// hauteur de naissance par type de robot : vol (hover) + hauteur du corps × depart
const VG_Y0 = new Float64Array(ENEMIES.types.length);
for (let t = 0; t < ENEMIES.types.length; t++) VG_Y0[t] = (ENEMIES.types[t].hover || 0) + (ENEMIES.types[t].height || 1) * VIRUS_GAZ.depart;
const vgAX = new Float64Array(VG_CAP); // ancre (suit le robot)
const vgAZ = new Float64Array(VG_CAP);
const vgOX = new Float64Array(VG_CAP); // écart à l'ancre (naissance dans le corps)
const vgOZ = new Float64Array(VG_CAP);
const vgY0 = new Float64Array(VG_CAP);
const vgAge = new Float64Array(VG_CAP);
const vgVie = new Float64Array(VG_CAP);
const vgSeed = new Float64Array(VG_CAP); // [0, 1) : contour, balancement
const vgUid = new Uint32Array(VG_CAP);
const vgSlot = new Int32Array(VG_CAP); // emplacement du robot dans E ; −1 : ancre arrêtée (mort, emplacement réutilisé)
let vgN = 0;
let vgPic = 0;
let vgNees = 0; // bouffées nées depuis le reset (sert aussi de graine)
let vgRefus = 0; // naissances refusées : pool plein
let vgInfections = 0; // robots passés de sain à infecté
let vgDemandes = 0; // demandes du son d'infection
let vgDebut = 0; // premier robot examiné à l'émission (tourne : pool plein, personne n'est privé de gaz en permanence)
const VG_T = new Float64Array(1); // horloge simulée de l'émission (s)
const VG_R = new Float64Array(4); // tirages de la bouffée en cours
const VG_ARG = new Float64Array(2); // cases ARGF[F_X], ARGF[F_Z] du coup en cours, gardées puis rendues

function aleaGaz(n) {
  for (let q = 0; q < 4; q++) {
    const h = Math.sin((n * 4 + q) * 12.9898 + 78.233) * 43758.5453;
    VG_R[q] = h - Math.floor(h);
  }
}

/** Une bouffée naît dans le corps du robot i (pool plein : refusée, aucune bouffée volée). */
function naitreGaz(i) {
  if (vgN >= VG_CAP) {
    vgRefus++;
    return;
  }
  const k = vgN++;
  vgNees++;
  aleaGaz(vgNees);
  const a = VG_R[0] * TAU;
  const r = Math.sqrt(VG_R[1]) * E.radius[i] * VG_ECART;
  vgOX[k] = Math.cos(a) * r;
  vgOZ[k] = Math.sin(a) * r;
  vgAX[k] = E.x[i];
  vgAZ[k] = E.z[i];
  vgY0[k] = VG_Y0[E.type[i]] + (VG_R[2] - 0.5) * 0.2;
  vgAge[k] = 0;
  vgVie[k] = VG_VIE * (1 + VG_VIEVAR * (2 * VG_R[3] - 1));
  vgSeed[k] = VG_R[2];
  vgUid[k] = E.uid[i];
  vgSlot[k] = i;
  if (vgN > vgPic) vgPic = vgN;
}

/**
 * Le robot i passe de sain à infecté (appelé AVANT que E.dotT0[i] soit posé) : bouffées tout de suite, une demande du
 * son à sa position (cases ARGF du coup en cours gardées et rendues, comme pour le gel). Coup d'arme (onHitF), nuage du
 * Malware, Nappe virale (evolutions.js).
 */
export function signalerInfection(i) {
  vgInfections++;
  if (VG_ON === 1) for (let q = 0; q < VG_NAISS; q++) naitreGaz(i);
  if (VG_SON >= 0 && audio !== null) {
    VG_ARG[0] = ARGF[F_X];
    VG_ARG[1] = ARGF[F_Z];
    ARGF[F_X] = E.x[i];
    ARGF[F_Z] = E.z[i];
    audio.playF(VG_SON);
    vgDemandes++;
    ARGF[F_X] = VG_ARG[0];
    ARGF[F_Z] = VG_ARG[1];
  }
}

// Table uid → emplacement des robots vivants, refaite à chaque image (adressage ouvert, tampons de génération : rien à
// vider). La compaction de fin d'image (enemies.flushDead) déplace des robots d'un emplacement à l'autre : la bouffée
// retrouve SON robot par l'uid, l'ancre ne décroche qu'à sa mort.
const VG_TAB = 2048; // > 4 × CAPS.enemies (512)
const VG_MASK = VG_TAB - 1;
const vgCle = new Uint32Array(VG_TAB);
const vgVal = new Int32Array(VG_TAB);
const vgGen = new Uint32Array(VG_TAB);
let vgG = 0;
function slotDeUid(uid) {
  let h = Math.imul(uid, 0x9e3779b1) >>> 21;
  for (let q = 0; q < VG_TAB; q++) {
    if (vgGen[h] !== vgG) return -1;
    if (vgCle[h] === uid) return vgVal[h];
    h = (h + 1) & VG_MASK;
  }
  return -1;
}

/** update : émission des robots infectés (taux par robot, phase tirée de son uid), puis âge, ancres, retraits. */
function avancerGaz(dt) {
  const ALIVE = E.alive;
  const UID = E.uid;
  const X = E.x;
  const Z = E.z;
  const T0 = E.dotT0;
  const SUS = E.sus;
  const n = E.count;
  const t0 = VG_T[0];
  const t1 = t0 + dt;
  VG_T[0] = t1;
  vgG = (vgG + 1) >>> 0;
  if (vgG === 0) {
    vgGen.fill(0);
    vgG = 1;
  }
  if (vgDebut >= n) vgDebut = 0;
  for (let q = 0; q < n; q++) {
    let i = q + vgDebut;
    if (i >= n) i -= n;
    if (ALIVE[i] === 0) continue;
    const uid = UID[i];
    let h = Math.imul(uid, 0x9e3779b1) >>> 21;
    while (vgGen[h] === vgG) h = (h + 1) & VG_MASK;
    vgGen[h] = vgG;
    vgCle[h] = uid;
    vgVal[h] = i;
    if (T0[i] <= 0 || SUS[i] === 2) continue;
    const hp = uid * 0.6180339887;
    const ph = hp - Math.floor(hp);
    const c1 = Math.floor(t1 * VG_TAUX + ph);
    for (let c = Math.floor(t0 * VG_TAUX + ph); c < c1; c++) naitreGaz(i);
  }
  vgDebut++;
  const s = 1 - Math.exp(-VG_SUIVI * dt);
  for (let k = 0; k < vgN; k++) {
    const age = vgAge[k] + dt;
    if (age >= vgVie[k]) {
      const j = --vgN;
      if (k !== j) {
        vgAX[k] = vgAX[j];
        vgAZ[k] = vgAZ[j];
        vgOX[k] = vgOX[j];
        vgOZ[k] = vgOZ[j];
        vgY0[k] = vgY0[j];
        vgAge[k] = vgAge[j];
        vgVie[k] = vgVie[j];
        vgSeed[k] = vgSeed[j];
        vgUid[k] = vgUid[j];
        vgSlot[k] = vgSlot[j];
      }
      k--;
      continue;
    }
    vgAge[k] = age;
    if (vgSlot[k] < 0) continue;
    const i = slotDeUid(vgUid[k]);
    if (i < 0) {
      vgSlot[k] = -1; // le robot est mort : la bouffée finit sur place
      continue;
    }
    vgSlot[k] = i;
    vgAX[k] += (X[i] - vgAX[k]) * s;
    vgAZ[k] += (Z[i] - vgAZ[k]) * s;
  }
}

/** sync : bouffées à la suite du lot TIRS (après les éclats). f = âge relatif (style non daté) ; graine + 1 = sans cœur. */
function syncGaz() {
  if (!P.alive) {
    vgN = 0; // game over : la simulation est arrêtée, le gaz ne resterait pas figé
    return;
  }
  const a = V.tampon(V.LOT.TIRS);
  const cap = V.capacite(V.LOT.TIRS);
  let n = V.compte[V.LOT.TIRS];
  const sansCoeur = CONFORT_FLASHS.reduits ? 1 : 0;
  for (let k = 0; k < vgN && n < cap; k++) {
    let u = vgAge[k] / vgVie[k];
    if (u > 1) u = 1;
    const m = 1 - u;
    const ph = vgSeed[k] * TAU + vgAge[k] * VG_BALW;
    const bal = VG_BAL * (0.3 + 0.7 * u);
    const p = n * V.STRIDE;
    n++;
    a[p] = vgAX[k] + vgOX[k] + bal * Math.sin(ph);
    a[p + 1] = vgY0[k] + VG_MONTEE * (1 - m * m);
    a[p + 2] = vgAZ[k] + vgOZ[k] + bal * 0.5 * Math.cos(ph * 0.7);
    a[p + 3] = VG_TAILLE * (0.6 + 0.6 * u);
    a[p + 4] = 0;
    a[p + 5] = 1;
    a[p + 6] = 0;
    a[p + 7] = 0;
    a[p + 8] = VG_STYLE;
    a[p + 9] = vgSeed[k] + sansCoeur;
    a[p + 10] = u;
    a[p + 11] = VG_MARGE;
  }
  V.compte[V.LOT.TIRS] = n;
}

function resetGaz() {
  vgN = 0;
  vgPic = 0;
  vgNees = 0;
  vgRefus = 0;
  vgInfections = 0;
  vgDemandes = 0;
  vgDebut = 0;
  VG_T[0] = 0;
}

/** Tests : état du gaz (hors combat). */
function inspectGaz(out) {
  const bouffees = [];
  for (let k = 0; k < vgN; k++) bouffees.push({ uid: vgUid[k], suit: vgSlot[k] >= 0, age: vgAge[k], vie: vgVie[k], x: vgAX[k] + vgOX[k], z: vgAZ[k] + vgOZ[k] });
  out.virusGaz = { enVol: vgN, pic: vgPic, nees: vgNees, refus: vgRefus, infections: vgInfections, demandes: vgDemandes, cap: VG_CAP, bouffees };
}
//#endregion e5:AH-virus-gaz
let shardsDone = 0;

/** Un robot en feu tué par une arme enflamme ses voisins (aucun coup : le statut seul). */
function spread(q) {
  IN[0] = qX[q];
  IN[1] = qZ[q];
  IN[2] = BURN_SPREAD;
  const n = circle();
  for (let k = 0; k < n; k++) {
    const i = OUT[k];
    if (E.alive[i] === 0) continue;
    E.dot1[i] = BURN_DPS;
    E.dotT1[i] = BURN_S;
    spreadDone++;
  }
  if (n > 0) dotActive = 1;
  Q[0] = qX[q];
  Q[2] = qZ[q];
  Q[3] = STAR_SMALL * 1.6;
  star(C_ORANGE);
}
let spreadDone = 0;

/** Tic des statuts : un parcours de E toutes les ITEM_RULES.dotTick s. */
function dotTick() {
  const T0 = E.dotT0;
  const D0 = E.dot0;
  const T1 = E.dotT1;
  const D1 = E.dot1;
  const ALIVE = E.alive;
  const n = E.count;
  let numbers = 0;
  let puffs = 0;
  let any = 0;
  for (let i = 0; i < n; i++) {
    if (ALIVE[i] === 0) continue;
    let d = 0;
    let c = -1;
    if (T0[i] > 0) {
      d += D0[i] * (T0[i] < TICK ? T0[i] : TICK);
      T0[i] -= TICK;
      if (T0[i] <= 0) {
        T0[i] = 0;
        D0[i] = 0;
      }
      c = C_GREEN;
    }
    if (T1[i] > 0) {
      d += D1[i] * (T1[i] < TICK ? T1[i] : TICK);
      T1[i] -= TICK;
      if (T1[i] <= 0) {
        T1[i] = 0;
        D1[i] = 0;
      }
      c = C_ORANGE;
    }
    if (c < 0) continue;
    any = 1;
    dotTicks++;
    if (puffs < ITEM_RULES.dotPuffs) {
      puffs++;
      Q[0] = E.x[i];
      Q[2] = E.z[i];
      Q[3] = STAR_SMALL * 0.8;
      Q[1] = HEIGHT;
      Q[4] = 0;
      Q[5] = 0;
      Q[6] = 1;
      Q[7] = 0;
      Q[8] = c + 0.37;
      Q[9] = Q[3] * 2.6;
      V.evenement(VFX_STYLE.ETOILE);
    }
    ARGF[F_V] = d;
    ARGF[F_SX] = E.x[i];
    ARGF[F_SZ] = E.z[i];
    strike(i, numbers < ITEM_RULES.dotNumbers ? F_AREA : F_QUIET);
    numbers++;
  }
  dotActive = any;
}
let dotTicks = 0;

/** Impulsion du condensateur : tous les robots à moins de `radius` du héros. */
function pulse() {
  const dmg = I_CAP.dmgBase + I_CAP.dmgPerStack * stacks[ITEM.CAPACITOR];
  const px = P.x;
  const pz = P.z;
  const n = E.count;
  for (let i = 0; i < n; i++) {
    if (E.alive[i] === 0) continue;
    const dx = E.x[i] - px;
    const dz = E.z[i] - pz;
    if (dx * dx + dz * dz > CAP_R2) continue;
    ARGF[F_V] = dmg;
    ARGF[F_SX] = px;
    ARGF[F_SZ] = pz;
    strike(i, F_ZONE); // § E5.AJ
  }
  pulses++;
  count[ITEM.CAPACITOR]++;
  Q[0] = px;
  Q[2] = pz;
  Q[3] = CAP_R;
  blast(C_BLUE, 0);
  Q[0] = px;
  Q[2] = pz;
  Q[3] = 5;
  blast(C_BLUE, 1);
  camera.addTrauma(CAP_TRAUMA, TRAUMA.PLAYER_EXPLOSION);
  audio.play(SFX.ITEM_BOOM);
  if (fused[6] === 1 && drones > 0) salvo(); // § E3.F Essaim de garde
}

/** Moteur cinétique : les robots touchés par le trajet du héros pendant cette image de dash, une fois chacun par dash. */
function dashSweep() {
  IN[0] = ST[S_PX];
  IN[1] = ST[S_PZ];
  IN[2] = DASH_W;
  IN[3] = P.x;
  IN[4] = P.z;
  const n = segment();
  const dmg = value[ITEM.DASHCORE];
  for (let k = 0; k < n; k++) {
    const i = OUT[k];
    if (E.alive[i] === 0) continue;
    const uid = E.uid[i];
    let known = false;
    for (let s = 0; s < dashSeenN; s++) if (dashSeen[s] === uid) known = true;
    if (known || dashSeenN >= dashSeen.length) continue;
    dashSeen[dashSeenN++] = uid;
    Q[0] = E.x[i];
    Q[2] = E.z[i];
    Q[3] = STAR_SMALL * 1.3;
    star(C_CYAN);
    ARGF[F_V] = dmg;
    ARGF[F_SX] = ST[S_PX];
    ARGF[F_SZ] = ST[S_PZ];
    strike(i, F_AREA);
    if (dashHits++ === 0) {
      count[ITEM.DASHCORE]++;
      ARGF[F_X] = P.x;
      ARGF[F_Z] = P.z;
      audio.playF(SFX.ITEM_PROC);
    }
  }
}

/** Drones compagnons : orbite autour du héros, un tir de blaster de niveau 1 sur le robot le plus proche de chacun. */
function updateDrones(dt) {
  ST[S_ANGLE] += DRONE_SPIN * dt;
  const a0 = ST[S_ANGLE];
  for (let k = 0; k < drones; k++) {
    const a = a0 + (k * TAU) / drones;
    const x = P.x + Math.sin(a) * DRONE_ORBIT;
    const z = P.z + Math.cos(a) * DRONE_ORBIT;
    drX[k] = x;
    drZ[k] = z;
    let t = drAcc[k] + dt * DRONE_RATE;
    if (t >= 1) {
      IN[0] = x;
      IN[1] = z;
      IN[2] = DRONE_RANGE;
      seenN = 0;
      const i = nearest();
      if (i >= 0) {
        t -= 1;
        const dx = E.x[i] - x;
        const dz = E.z[i] - z;
        drYaw[k] = Math.atan2(dx, dz);
        // éclair de bouche au drone, éclat sur le robot (cyan : la couleur du héros)
        Q[0] = x;
        Q[1] = DRONE_H;
        Q[2] = z;
        Q[3] = STAR_FLASH;
        Q[4] = 0;
        Q[5] = 0;
        Q[6] = 1;
        Q[7] = 0;
        Q[8] = C_CYAN + 0.5;
        Q[9] = STAR_FLASH * 2.6;
        V.evenement(VFX_STYLE.FLASH);
        Q[0] = E.x[i];
        Q[1] = HEIGHT;
        Q[2] = E.z[i];
        V.impact(WEAPON.BLASTER);
        ARGF[F_V] = DRONE_DMG * value[ITEM.DRONE];
        ARGF[F_SX] = x;
        ARGF[F_SZ] = z;
        strike(i, F_PROC);
        droneShots++;
        count[ITEM.DRONE]++;
        ARGF[F_X] = x;
        ARGF[F_Z] = z;
        audio.playF(SFX.ITEM_PROC);
      } else {
        t = 1; // aucune cible : le tir reste prêt
        drYaw[k] = a + Math.PI / 2;
      }
    }
    drAcc[k] = t;
  }
}

/** S8 bis : vide la file, fait les tics, les drones et le dash ; remet les compteurs « par image » à zéro. */
export function update(dt) {
  ST[S_CLOCK] += dt;
  if (run.wave !== lastWave) {
    lastWave = run.wave;
    saveReady = 1; // la Sauvegarde se réarme à chaque vague
  }
  if (slotCount === 0 && qN === 0 && dotActive === 0 && hitMask === 0 && killMask === 0 && drones === 0 && stacks[ITEM.DASHCORE] === 0 && clN === 0 && restorePending === 0 && frN === 0 && vgN === 0) {
    ST[S_PX] = P.x;
    ST[S_PZ] = P.z;
    ST[S_SHIELD] = 0; // plus aucun objet : rien ne recharge
    ST[S_REACT] = 0;
    ST[S_ABS] = 0;
    majBouclier();
    return;
  }
  busy = true;
  stars = 0;
  PUI[1] = 0; // § E5.X9 : jamais laissé à 1 par une image interrompue
  // minuteries
  if (ST[S_SHIELD] > 0) {
    ST[S_SHIELD] -= dt;
    if (ST[S_SHIELD] <= 0) {
      ST[S_SHIELD] = 0;
      if (stacks[ITEM.SHIELD] > 0 && P.alive) {
        Q[0] = P.x;
        Q[2] = P.z;
        Q[3] = I_SHIELD.radius;
        if (!PAREFEU_DOME.actif) blast(C_SKY, 0); // pare-feu rechargé : une onde courte au pied du héros (§ E5.B : le dôme se reconstruit à la place)
      }
    }
  }
  if (stacks[ITEM.SHIELD] === 0) ST[S_ABS] = 0; // objet perdu : la prochaine prise repart d'une réserve pleine
  majBouclier();
  if (ST[S_REACT] > 0) ST[S_REACT] -= dt;
  if (ST[S_LEECH] < LEECH_MAX) {
    ST[S_LEECH] += LEECH_MAX * dt;
    if (ST[S_LEECH] > LEECH_MAX) ST[S_LEECH] = LEECH_MAX;
  }
  if (clearShots === 1) {
    clearShots = 0;
    enemies.clearProjectiles();
  }
  // Berserk : la cadence suit les PV manquants, par crans de 1/16 (les stats ne sont recalculées que si le cran change)
  if (stacks[ITEM.BERSERK] > 0) {
    let s = P.maxHp > 0 ? Math.floor((1 - P.hp / P.maxHp) * 16 + 0.5) : 0;
    if (s < 0) s = 0;
    else if (s > 16) s = 16;
    if (fused[3] === 1 && P.hp < RETRO_HP * P.maxHp) s = 16; // § E3.F Boucle de rétroaction : compte comme à 0 PV
    if (s !== berserkStep) {
      berserkStep = s;
      refresh();
    }
  } else if (berserkStep !== 0) {
    berserkStep = 0;
    refresh();
  }
  if (P.alive) {
    // siphon
    if (leechPending > 0) {
      // § E3.F Boucle de rétroaction : sous le seuil, le Siphon rend le double
      const lm = fused[3] === 1 && P.hp < RETRO_HP * P.maxHp ? RETRO_LEECH : 1;
      if (lm > 1) ftrig[3]++;
      ST[S_HEALED] += player.heal(I_LEECH.heal * leechPending * lm);
      count[ITEM.LEECH] += leechPending;
      leechPending = 0; // § E5.Q (B14) : retour propre au héros (src/soin-heros.js), plus l'anneau du réparateur
    }
    // dash cinétique : le trajet de cette image
    const now = P.dashT > 0 ? 1 : 0;
    if (stacks[ITEM.DASHCORE] > 0 && run.agent !== AGENT.BASTION && (now === 1 || dashing === 1)) { // § E5.X3 : Bastion → frapperBond
      if (dashing === 0) {
        dashSeenN = 0;
        dashHits = 0;
      }
      dashSweep();
    }
    if (fused[5] === 1 && dashing === 1 && now === 0) {
      // § E3.F Surrégime : fin d'un dash → cadence × rateMul pendant seconds s
      const was = ST[S_SURGE] > 0;
      ST[S_SURGE] = SURGE_S;
      ftrig[5]++;
      audio.play(SFX.CD_FIRE); // § E5.AD : le Surrégime part (fin du dash)
      if (!was) refresh();
    }
    dashing = now;
  } else {
    leechPending = 0;
    dashing = 0;
  }
  // § E5.Y : fragments des Éclats en vol (avant la file : un fragment né dans cette image part de la mort du robot)
  if (frN > 0) {
    EC_DT[0] = dt;
    avancerEclats();
  }
  // file des déclenchements, dans l'ordre d'arrivée
  for (let q = 0; q < qN; q++) {
    const kind = qKind[q];
    //#region e5:X9-katana-puissance
    PUI[1] = kind === Q_TESLA || kind === Q_BOOM || kind === Q_BOOM2 ? 1 : 0; // § E5.X9 : part d'un coup d'arme
    //#endregion e5:X9-katana-puissance
    if (kind === Q_TESLA) tesla(q);
    else if (kind === Q_BOOM) boom(q);
    else if (kind === Q_REACTIVE) reactive(q);
    else if (kind === Q_SHRAPNEL) shrapnel(q);
    else if (kind === Q_SPREAD) spread(q);
    else if (kind === Q_FREEZE) {
      Q[0] = qX[q];
      Q[2] = qZ[q];
      Q[3] = STAR_SMALL;
      star(C_SKY);
    } else if (kind === Q_SHIELD) {
      Q[0] = qX[q];
      Q[2] = qZ[q];
      Q[3] = I_SHIELD.radius * 1.6;
      if (!PAREFEU_DOME.actif) blast(C_SKY, 1); // § E5.B : le dôme du Pare-feu montre le coup arrêté à la place
    } else if (kind === Q_SAVE) {
      Q[0] = qX[q];
      Q[2] = qZ[q];
      Q[3] = I_SAVE.purgeRadius;
      blast(C_VIOLET, 1);
    } else if (kind === Q_BOOM2) boom(q); // § E3.F : seconde explosion de la Réaction en chaîne
    else if (kind === Q_CLOUD) cloudAdd(q); // § E3.F : nuage du Malware
  }
  PUI[1] = 0; // § E5.X9
  qN = 0;
  updateFusions(dt); // § E3.F : nuages, Surrégime, coffre du Point de restauration
  // statuts
  if (dotActive === 1) {
    ST[S_DOT] += dt;
    if (ST[S_DOT] >= TICK) {
      ST[S_DOT] -= TICK;
      if (ST[S_DOT] > TICK) ST[S_DOT] = 0;
      dotTick();
    }
  }
  if (VG_ON === 1 && (dotActive === 1 || vgN > 0)) avancerGaz(dt); // § E5.AH : après le tic (dotT0 de l'image)
  // condensateur : une impulsion par image au plus ; le surplus de morts ne met JAMAIS une seconde impulsion en réserve
  // (400 robots tués d'un coup = une impulsion, pas seize à la suite)
  if (capNeed > 0 && capKills >= capNeed && P.alive && IO[ITEM.CAPACITOR] === 1) { // § E4.G : dans la fenêtre
    capKills -= capNeed;
    if (capKills >= capNeed) capKills = capNeed - 1;
    pulse();
  }
  if (drones > 0 && P.alive) updateDrones(dt);
  // fin d'image : compteurs « par image »
  for (let k = 0; k < N; k++) {
    if (fired[k] > peak[k]) peak[k] = fired[k];
    fired[k] = 0;
  }
  for (let k = 0; k < FUSION_COUNT; k++) {
    if (ffired[k] > fpeak[k]) fpeak[k] = ffired[k];
    ffired[k] = 0;
  }
  ST[S_PX] = P.x;
  ST[S_PZ] = P.z;
  busy = false;
}

/** F11 : instances des drones compagnons (rien d'autre n'a de maillage). */
export function sync() {
  if (frN > 0) syncEclats(); // § E5.Y : fragments des Éclats, à la suite du lot TIRS
  if (vgN > 0) syncGaz(); // § E5.AH : bouffées de gaz du Virus, à la suite (après les éclats)
  if (droneMesh === null) return;
  let n = 0;
  if (P.alive && droneReady) {
    const t = ST[S_CLOCK];
    for (let k = 0; k < drones; k++) {
      const c = Math.cos(drYaw[k]);
      const s = Math.sin(drYaw[k]);
      const o = n * 16;
      droneMat[o] = c;
      droneMat[o + 1] = 0;
      droneMat[o + 2] = -s;
      droneMat[o + 3] = 0;
      droneMat[o + 4] = 0;
      droneMat[o + 5] = 1;
      droneMat[o + 6] = 0;
      droneMat[o + 7] = 0;
      droneMat[o + 8] = s;
      droneMat[o + 9] = 0;
      droneMat[o + 10] = c;
      droneMat[o + 11] = 0;
      droneMat[o + 12] = drX[k];
      droneMat[o + 13] = DRONE_H + DRONE_BOB * Math.sin(t * 3.1 + k * 2.1);
      droneMat[o + 14] = drZ[k];
      droneMat[o + 15] = 1;
      n++;
    }
  }
  render.commit(droneMesh, n);
  if (clN > 0) syncClouds(); // § E3.F : nuages du Malware, lot CONTINUS (style NAPPE)
}

// ----- Debug et snapshot (hors combat) -----------------------------------------------------------------------------------

/** Tests : fixe les piles d'un objet (clé ou indice), SANS limite d'emplacements (les 6 premiers ont une case au HUD). */
export function debugSet(key, n) {
  const id = typeof key === 'string' ? ITEMS.findIndex((I) => I.key === key) : key;
  if (!(id >= 0 && id < N)) return false;
  const k = Math.max(0, Math.min(MAXS[id], Math.floor(n))); // § E5.AJ : la console respecte le plafond
  if (k > 0 && stacks[id] === 0 && fused[pairOf(id)] === 0 && slotCount < SLOTS) slots[slotCount++] = id;
  if (k === 0 && stacks[id] > 0) {
    for (let s = 0; s < slotCount; s++) {
      if (slots[s] !== id) continue;
      for (let j = s; j < slotCount - 1; j++) slots[j] = slots[j + 1];
      slots[--slotCount] = -1;
      break;
    }
  }
  stacks[id] = k;
  ST[S_PX] = P.x;
  ST[S_PZ] = P.z;
  autoFuse = 0; // § E3.F : des piles posées par la console ne déclenchent pas de fusion d'office (setAutoFusion)
  refresh();
  return true;
}

/** Tests : fait la fusion k comme le fera l'étape 3 (sans regarder FUSIONS[k].enabled). */
export function debugFuse(k) {
  return fuse(k);
}

export function inspect(out) {
  const st = {};
  const val = {};
  const cnt = {};
  const pk = {};
  const rl = {};
  for (let k = 0; k < N; k++) {
    rl[ITEMS[k].key] = rolls[k];
    st[ITEMS[k].key] = stacks[k];
    val[ITEMS[k].key] = value[k];
    cnt[ITEMS[k].key] = count[k];
    pk[ITEMS[k].key] = peak[k];
  }
  out.stacks = st;
  out.values = val;
  out.triggers = cnt; // déclenchements depuis le reset
  out.peakPerFrame = pk; // plus grand nombre de déclenchements d'un objet en une image
  out.rolls = rl; // tirages réussis, avant le plafond par image
  out.slots = [];
  for (let k = 0; k < slotCount; k++) out.slots.push(slots[k] >= N ? FUSIONS[slots[k] - N].key : ITEMS[slots[k]].key);
  out.slotCount = slotCount;
  out.procHits = procHits;
  out.dropped = dropped;
  out.queuePeak = queuePeak;
  out.queue = qN;
  out.reentries = reentries;
  out.jumps = jumpsDone;
  out.shards = shardsDone;
  inspectEclats(out); // § E5.Y
  inspectGaz(out); // § E5.AH
  out.spreads = spreadDone;
  out.dotTicks = dotTicks;
  out.pulses = pulses;
  out.capKills = capKills;
  out.capNeed = capNeed;
  out.healed = ST[S_HEALED];
  out.leechBucket = ST[S_LEECH];
  out.shieldCd = ST[S_SHIELD];
  out.shieldBlocks = shieldBlocks;
  out.shieldAbs = ST[S_ABS];
  out.reactiveCd = ST[S_REACT];
  out.saveReady = saveReady === 1;
  out.saves = saves;
  out.drones = drones;
  out.droneShots = droneShots;
  out.droneModel = droneReady;
  out.dronePos = [];
  for (let k = 0; k < drones; k++) out.dronePos.push([drX[k], drZ[k]]);
  out.berserkStep = berserkStep;
  out.rateShare = ST[S_RATE];
  out.hpShare = ST[S_HP];
  out.lastBoom = { radius: ST[S_BOOM_R], hits: lastBoomHits };
  out.fused = [];
  out.fusable = []; // paires dont les deux ingrédients ont ITEM_RULES.fusionAt piles (l'étape 3 n'a qu'à brancher l'offre)
  for (let k = 0; k < FUSION_COUNT; k++) {
    if (fused[k] === 1) out.fused.push(FUSIONS[k].key);
    else if (isFusable(k)) out.fusable.push(FUSIONS[k].key);
  }
  out.canFuse = [];
  for (let k = 0; k < FUSION_COUNT; k++) if (canFuse(k)) out.canFuse.push(FUSIONS[k].key);
  inspectFusions(out); // § E3.F
  return out;
}


// ===== § E3.F — fusions : l'objet né garde les deux ingrédients et ajoute SA règle (FUSIONS[k].rule) ====================
// Règles codées dans les crochets et résolutions ci-dessus (Orage glacé : tesla ; Malware : onKillF → cloudAdd ;
// Réaction en chaîne : boom ; Boucle de rétroaction : update ; Pare-feu actif : onPlayerHitF ; Surrégime : update ;
// Essaim de garde : pulse → salvo ; Recyclage : shrapnel → recycle ; Point de restauration : onPlayerHitF → update).
// § V : pools fixes, compteurs entiers, minuteries dans ST ; plafonds par image FCAP (FUSION_RULES[k].perFrame).
const FR = FUSION_RULES;
const ORAGE_MUL = FR[0].frozenRangeMul;
const MAL_S = FR[1].seconds;
const MAL_R = FR[1].radius;
const MAL_CAP = FR[1].cap;
const RETRO_HP = FR[3].hpBelow;
const RETRO_LEECH = FR[3].leechMul;
const PFA_MUL = FR[4].dmgMul;
const SURGE_MUL = FR[5].rateMul;
const SURGE_S = FR[5].seconds;
const SALVO = FR[6].shots;
const RESTO_RARITY = FR[8].chestRarity;
const Q_BOOM2 = 8; // seconde explosion (Réaction en chaîne) : ne tire plus de critique
const Q_CLOUD = 9; // naissance d'un nuage (Malware)
const FCAP = new Uint16Array(FUSION_COUNT);
for (let k = 0; k < FUSION_COUNT; k++) FCAP[k] = FR[k].perFrame > 0 ? FR[k].perFrame : 65535;
const ffired = new Uint16Array(FUSION_COUNT); // déclenchements de l'image, par règle
const fpeak = new Uint16Array(FUSION_COUNT);
const ftrig = new Uint32Array(FUSION_COUNT); // déclenchements de chaque règle depuis le reset (mesures)
const fusionWave = new Int16Array(FUSION_COUNT).fill(-1); // vague où la fusion k a eu lieu
let autoFuse = 1; // 0 : piles posées par debugSet — pendingFusion se tait jusqu'à setAutoFusion(true) ou reset
let orageLong = 0; // sauts « deux fois plus loin » vers un robot gelé
let restorePending = 0;
let restoreDrops = 0;
let salvoShots = 0;
let recycleDraws = 0;
let recycled = 0;
let cloudsBorn = 0;
let cloudInfect = 0;
// nuages du Malware
const clX = new Float64Array(MAL_CAP);
const clZ = new Float64Array(MAL_CAP);
const clLife = new Float64Array(MAL_CAP);
const clAge = new Float64Array(MAL_CAP);
let clN = 0;

function resetFusions() {
  ffired.fill(0);
  fpeak.fill(0);
  ftrig.fill(0);
  fusionWave.fill(-1);
  autoFuse = 1;
  orageLong = 0;
  restorePending = 0;
  restoreDrops = 0;
  salvoShots = 0;
  recycleDraws = 0;
  recycled = 0;
  cloudsBorn = 0;
  cloudInfect = 0;
  clN = 0;
  run.fusions = 0;
}

/** Met en file un déclenchement au point (x, z) (seconde explosion) ; montant dans REG[0]. */
function pushAt(kind, x, z) {
  if (qN >= QCAP) {
    dropped++;
    return;
  }
  qKind[qN] = kind;
  qUid[qN] = 0;
  qX[qN] = x;
  qZ[qN] = z;
  qV[qN] = REG[0];
  qN++;
  if (qN > queuePeak) queuePeak = qN;
}

/** Malware : un nuage naît sur le robot mort (pool plein : le plus ancien laisse sa place). */
function cloudAdd(q) {
  let s = clN;
  if (clN < MAL_CAP) clN++;
  else {
    s = 0;
    for (let k = 1; k < MAL_CAP; k++) if (clLife[k] < clLife[s]) s = k;
  }
  clX[s] = qX[q];
  clZ[s] = qZ[q];
  clLife[s] = MAL_S;
  clAge[s] = 0;
  cloudsBorn++;
  ftrig[1]++;
  ARGF[F_X] = qX[q];
  ARGF[F_Z] = qZ[q];
  audio.playF(SFX.ITEM_PROC);
}

/** Recyclage : le robot t (type ty) vient d'être tué par un éclat — son tirage de fragment est refait. */
function recycle(t, ty) {
  const T = ENEMIES.types[ty];
  if (!T || ty === ENEMY.BOSS || !(T.fragChance > 0)) return;
  recycleDraws++;
  ftrig[7]++;
  if (rand() < T.fragChance) {
    recycled++;
    pickups.spawnFragment(E.x[t], E.z[t], T.fragValue);
  }
}

/** Essaim de garde : chaque drone tire SALVO coups en étoile, sur SALVO robots différents à sa portée. */
function salvo() {
  if (ffired[6] >= FCAP[6]) return;
  ffired[6]++;
  ftrig[6]++;
  const dmg = DRONE_DMG * value[ITEM.DRONE];
  for (let k = 0; k < drones; k++) {
    const x = drX[k];
    const z = drZ[k];
    seenN = 0;
    for (let s = 0; s < SALVO && seenN < seen.length; s++) {
      IN[0] = x;
      IN[1] = z;
      IN[2] = DRONE_RANGE;
      const i = nearest();
      if (i < 0) break;
      seen[seenN++] = E.uid[i];
      const dx = E.x[i] - x;
      const dz = E.z[i] - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      Q[0] = x;
      Q[1] = DRONE_H;
      Q[2] = z;
      Q[4] = d > 1e-6 ? dx / d : 0;
      Q[5] = 0;
      Q[6] = d > 1e-6 ? dz / d : 1;
      Q[7] = d;
      V.arc(s === 0 ? 1 : 0);
      ARGF[F_V] = dmg;
      ARGF[F_SX] = x;
      ARGF[F_SZ] = z;
      strike(i, F_PROC);
      salvoShots++;
    }
  }
  ARGF[F_X] = P.x;
  ARGF[F_Z] = P.z;
  audio.playF(SFX.ITEM_PROC);
}

/** Minuteries des règles nouvelles (update, après la file). */
function updateFusions(dt) {
  // Surrégime : la cadence × 2 retombe à la fin du délai
  if (ST[S_SURGE] > 0) {
    ST[S_SURGE] -= dt;
    if (ST[S_SURGE] <= 0) {
      ST[S_SURGE] = 0;
      refresh();
    }
  }
  // Malware : chaque nuage infecte et enflamme ce qui le touche, un tic toutes les ITEM_RULES.dotTick s
  if (clN > 0) {
    ST[S_CLOUD] += dt;
    const tick = ST[S_CLOUD] >= TICK;
    if (tick) ST[S_CLOUD] -= TICK;
    if (ST[S_CLOUD] > TICK) ST[S_CLOUD] = 0;
    for (let s = clN - 1; s >= 0; s--) {
      clLife[s] -= dt;
      clAge[s] += dt;
      if (clLife[s] <= 0) {
        clN--;
        clX[s] = clX[clN];
        clZ[s] = clZ[clN];
        clLife[s] = clLife[clN];
        clAge[s] = clAge[clN];
        continue;
      }
      if (!tick) continue;
      IN[0] = clX[s];
      IN[1] = clZ[s];
      IN[2] = MAL_R;
      const n = circle();
      for (let k = 0; k < n; k++) {
        const i = OUT[k];
        if (E.alive[i] === 0) continue;
        if (E.dotT0[i] <= 0) signalerInfection(i); // § E5.AH
        E.dot0[i] = value[ITEM.VIRUS] > 0 ? value[ITEM.VIRUS] : ITEMS[ITEM.VIRUS].base;
        E.dotT0[i] = VIRUS_S;
        E.dot1[i] = BURN_DPS;
        E.dotT1[i] = BURN_S;
        cloudInfect++;
      }
      if (n > 0) dotActive = 1;
    }
  }
  // Point de restauration : le coffre gratuit tombe au pied du héros dès que la vague est finie
  if (restorePending === 1 && chests !== null && P.alive && ctx.game && ctx.game.state === STATE.WAVE_CLEAR) {
    restorePending = 0;
    restoreDrops++;
    chests.dropAt(P.x, P.z, RESTO_RARITY, 0);
  }
}

/** Nuages du Malware : la nappe au sol (même dessin que la nappe corrosive), à la suite du lot CONTINUS. */
function syncClouds() {
  const ac = V.tampon(V.LOT.CONTINUS);
  const cap = V.capacite(V.LOT.CONTINUS);
  let nc = V.compte[V.LOT.CONTINUS];
  for (let s = 0; s < clN && nc < cap; s++) {
    let f = clAge[s] / 0.25;
    if (f > 1) f = 1;
    const out = clLife[s] / 0.6;
    if (out < f) f = out;
    const p = nc * V.STRIDE;
    nc++;
    ac[p] = clX[s];
    ac[p + 1] = 0.05;
    ac[p + 2] = clZ[s];
    ac[p + 3] = MAL_R;
    ac[p + 4] = 1;
    ac[p + 5] = 0;
    ac[p + 6] = 0;
    ac[p + 7] = 0;
    ac[p + 8] = VFX_STYLE.NAPPE;
    ac[p + 9] = s * 0.618 + 0.47;
    ac[p + 10] = f;
    ac[p + 11] = MAL_R + VFX.nappe.marge;
  }
  V.compte[V.LOT.CONTINUS] = nc;
}

function bothInSlots(k) {
  let a = 0;
  let b = 0;
  for (let s = 0; s < slotCount; s++) {
    if (slots[s] === FUSIONS[k].a) a = 1;
    else if (slots[s] === FUSIONS[k].b) b = 1;
  }
  return a === 1 && b === 1;
}

/** Fusion à faire maintenant (−1 : aucune) : la première recette ouverte dont les deux ingrédients ont fusionAt piles. */
export function pendingFusion() {
  if (autoFuse === 0) return -1;
  for (let k = 0; k < FUSION_COUNT; k++) if (canFuse(k) && bothInSlots(k)) return k;
  return -1;
}

/**
 * Indice du choix de niveau (hors combat) : '' si l'objet id ne fusionne avec aucun objet possédé ; sinon le texte de
 * la pastille — le nom de l'objet né si la recette est découverte (meta), « ? » + l'indice sinon.
 */
export function fusionHint(id) {
  if (!(id >= 0 && id < N)) return '';
  const k = pairOf(id);
  const F = FUSIONS[k];
  if (!F.enabled || fused[k] === 1) return '';
  const other = F.a === id ? F.b : F.a;
  if (stacks[other] === 0) return '';
  return meta.isDiscovered('fusions', k) ? '→ ' + F.name : '';
}

/** L'objet proposé fusionnerait avec un objet possédé (indice « ? », recette découverte ou non). */
export function fusionMate(id) {
  if (!(id >= 0 && id < N)) return false;
  const k = pairOf(id);
  const F = FUSIONS[k];
  if (!F.enabled || fused[k] === 1) return false;
  return stacks[F.a === id ? F.b : F.a] > 0;
}

/** Vue de l'écran de fusion k (hors combat : objet neuf). */
export function fusionView(k) {
  const F = FUSIONS[k];
  return {
    k,
    key: F.key,
    name: F.name,
    rule: F.rule,
    icon: 'sr-m-' + F.key,
    a: { key: ITEMS[F.a].key, name: ITEMS[F.a].name, icon: 'sr-m-' + ITEMS[F.a].key, stacks: stacks[F.a] },
    b: { key: ITEMS[F.b].key, name: ITEMS[F.b].name, icon: 'sr-m-' + ITEMS[F.b].key, stacks: stacks[F.b] },
    slots: slotCount,
    count: run.fusions,
  };
}

/** Tests : rend (ou coupe) les fusions d'office après des piles posées par debugSet. */
export function setAutoFusion(on) {
  autoFuse = on ? 1 : 0;
  return autoFuse === 1;
}

function inspectFusions(out) {
  const tr = {};
  const pk = {};
  for (let k = 0; k < FUSION_COUNT; k++) {
    tr[FUSIONS[k].key] = ftrig[k];
    pk[FUSIONS[k].key] = fpeak[k];
  }
  out.fusion = {
    pending: pendingFusion(),
    auto: autoFuse === 1,
    done: run.fusions,
    waves: Array.from(fusionWave),
    triggers: tr,
    peakPerFrame: pk,
    orageLong,
    surge: ST[S_SURGE],
    clouds: clN,
    cloudsBorn,
    cloudInfect,
    salvoShots,
    recycleDraws,
    recycled,
    restorePending,
    restoreDrops,
    lastReactiveDmg: ST[S_REACT_DMG],
  };
}

// Couleur (chaîne CSS) du rang de chaque objet, pour l'interface
export const TIER_COLOR = ITEMS.map((I) => '#' + RARITIES[I.tier].color.toString(16).padStart(6, '0'));
export const TEXT = CHOICES.itemText;

// § E3.B (chantier B, évolutions) : deux accès minimes, sans toucher au reste du module.
/**
 * § E5.B : état du Pare-feu pour son dôme (src/vfx/dome-parefeu.js), écrit dans o (tableau typé : aucun flottant
 * rendu ni passé, § V) : o[0] recharge restante (s, 0 = prêt), o[1] recharge complète (s), o[2] coups arrêtés depuis
 * le reset, o[3] piles. Lecture seule.
 */
export function lireParefeu(o) {
  o[0] = ST[S_SHIELD];
  o[1] = value[ITEM.SHIELD];
  o[2] = shieldBlocks;
  o[3] = stacks[ITEM.SHIELD];
}

/**
 * § E5.H : état de la Coque réactive pour son visuel (src/vfx/coque-reactive.js), écrit dans o (tableau typé : aucun
 * flottant rendu ni passé, § V) : o[0] piles, o[1] ondes depuis le reset, o[2-3] centre de la dernière onde, o[4]
 * rayon de l'onde (m), o[5] délai avant la prochaine onde possible (s), o[6] ce délai complet (s). Lecture seule.
 */
export function lireCoque(o) {
  o[0] = stacks[ITEM.REACTIVE];
  o[1] = count[ITEM.REACTIVE];
  o[2] = ST[S_REACT_X];
  o[3] = ST[S_REACT_Z];
  o[4] = REACT_R;
  o[5] = ST[S_REACT];
  o[6] = cdMod !== null && cdMod.isCooldown(1, ITEM.REACTIVE) ? REACT_EVERY : REACT_CD;
}

/**
 * Dôme ionique : la recharge du Pare-feu avance de ARGF[F_T] s de plus (sans la finir : c'est update qui la termine,
 * avec son onde). Rend 1 si elle avançait, 0 si le bouclier était prêt ou presque.
 */
export function evoShieldTickF() {
  const dt = ARGF[F_T];
  if (!(ST[S_SHIELD] > dt)) return 0;
  ST[S_SHIELD] -= dt;
  return 1;
}

/** Champ de mines : impulsions du condensateur depuis le reset. */
export function evoPulses() {
  return pulses;
}
