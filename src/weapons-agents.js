// PLAN ADDICTIF, ÉTAPE 3, CHANTIER N : weapons-agents.js — les six armes nouvelles des arsenaux (ARCHITECTURE.md § E3.N).
// Shinobi : katana, grenades, fumigènes, frappe éclair. Bastion : grosse tourelle (canon lourd), marteau à ondes.
// Le modèle des stats, des niveaux et de la possession reste celui de weapons.js (mêmes tables, mêmes prix) : ce
// module reçoit de weapons.init les vues dont il a besoin (owned, effective, flagsOf, countShot) et ne tient que ses
// pools. weapons.update l'appelle pour les armes à cadence (fireF) et une fois par image (update) ; weapons.sync une
// fois par image (sync). Rien n'est alloué en combat : pools en tableaux typés créés au chargement, flottants des
// appels par ARGF / ARG (§ V), entrées des effets par V.Q.
//   • katana       : COUNT coupes en arc (arcDeg) de AREA m, sens alterné ; critique propre (+critAdd, × SPECIAL) ;
//   • grenades     : COUNT grenades en cloche sur les paquets (grid.findDensest), explosion damage.explode ;
//   • fumigènes    : nuages au sol (un lancer toutes les throwEvery s) ; chaque tic blesse, ralentit et AVEUGLE : un
//                    robot aveuglé subit des coups critiques assurés de toutes les armes du Shinobi (katana, grenades,
//                    frappe éclair et lame de phase de weapons.js via isBlind) ;
//   • frappe éclair: le héros file AREA m dans sa direction de marche, tranche la ligne (demi-largeur SPECIAL), puis
//                    COUNT − 1 échos sur la même ligne ; part seulement s'il y a un robot sur la ligne ;
//   • grosse tourelle : un canon posé derrière le héros, SPECIAL s ; il tire COUNT obus en cloche sur les paquets ;
//   • marteau      : frappe au sol ; COUNT ondes, la première sur le disque AREA, les suivantes sur l'anneau suivant ;
//                    recul SPECIAL et robots sonnés.
import {
  ARSENAL_VFX,
  CAPS,
  DMG,
  FXK,
  MODELES,
  PLAYER,
  STAT,
  STAT_COUNT,
  TRAUMA,
  VFX,
  VFX_STYLE,
  WEAPON,
  WEAPONS,
} from './config.js';
import { ENEMY } from './config.js'; // § E5.D : réparateur prioritaire
import { ARGF, E, F_DX, F_DZ, F_SX, F_SZ, F_T, F_V, P, mods, rand } from './state.js';
import * as V from './vfx/projectiles.js';
import { chargerPieces } from './anim/pieces.js';
import { appliquerTexturesArmes } from './rendu/materiaux.js'; // § E5.T : canon lourd = Grosse tourelle de l'agent, atlas partagé
import { TACHES as TACHES_CONTACT } from './rendu/ombres-contact.js'; // § E5.T : ombre de contact du canon posé
import { api as __A } from './anim/armes-heros.js'; // correctif de l'étape 3 : lancers depuis la main, pas le buste
import * as CB from './anim/combos.js'; // § E3.M : gestes (katana, frappe éclair, marteau, pose du canon)
import { armesCoupees } from './anim/coup-pied.js'; // § E4.O.3 : armes coupées pendant le coup de pied
import { COMBO, COMBOS as CB_CFG, GESTE as CB_GESTE } from './config.js';
import { COMBO_ATTAQUE } from './config.js'; // § E5.F : une attaque = le combo entier
import { TOURELLES_BOSS } from './config.js'; // § E5.F : grosse tourelle, le boss d'abord
import { MARTEAU_COMBO } from './config.js'; // § E5.F.13 : combo du marteau (2 diagonales + frappe au sol)
//#region e5:U-visee-souris
import { TRAIT as TRAIT_FRAPPE, VISEE } from './visee.js'; // § E5.U : frappe vers le curseur, trait d'annonce
import * as visee from './visee.js';
let fireAccW = null; // weapons.fireAcc (cadence : 1 = prête)
let usableW = null; // weapons : stats saines (1)
//#endregion e5:U-visee-souris

let ctx = null;
let grid = null;
let damage = null;
let enemies = null;
let audio = null;
let camera = null;
let world = null;
let render = null;
let owned = null; // weapons.owned
let effective = null; // weapons : stats effectives (w × STAT_COUNT + s)
let flagsOf = null; // weapons : drapeaux DMG.* par arme
let countShot = null; // weapons : son, secousse, geste du héros, compteur de tirs
// § E5.D : réparateur prioritaire, fourni par weapons.js (null : règle d'avant)
let REP_S = null; // x, z du point de recherche, portée (m)
let repTarget = null; // () → indice du réparateur le plus proche du point à portée, −1 sinon
let marquer = null; // (i, w) : réticule et compteur
let W_DRONE = (x, z, r) => -1; // § E5.F : drone-bouclier du boss le plus proche à portée (weapons.droneBouclier)
let W_NIV = (w) => 1; // § E5.F.14 : niveau de l'arme (weapons.getWeaponLevel)

/** § E5.D : réparateur le plus proche de (x, z) à `r` m (−1 sinon). Appelée une fois par salve (code froid). */
function repPres(x, z, r) {
  if (repTarget === null) return -1;
  REP_S[0] = x;
  REP_S[1] = z;
  REP_S[2] = r;
  return repTarget();
}

/** § E5.D : la position du réparateur t devient le premier paquet de `dens` (found paquets, au plus cap). Rend le compte. */
function repEnTete(t, found, cap) {
  if (found < cap) found++;
  for (let q = found - 1; q > 0; q--) {
    dens[q * 2] = dens[q * 2 - 2];
    dens[q * 2 + 1] = dens[q * 2 - 1];
  }
  dens[0] = E.x[t];
  dens[1] = E.z[t];
  return found;
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const Q = V.Q;
const STRIDE = V.STRIDE;
const KATANA = WEAPON.KATANA;
const GRENADE = WEAPON.GRENADE;
const SMOKE = WEAPON.SMOKE;
const FLASH = WEAPON.FLASH;
const CANNON = WEAPON.CANNON;
const HAMMER = WEAPON.HAMMER;
const C0 = ARSENAL_VFX.couleur0 - KATANA; // couleur des effets de l'arme w : C0 + w (lignes ajoutées dans VFX_COULEURS)

// ----- registre des flottants passés en argument (§ V) : réécrits seulement quand ils changent -----------------------
const A_PX = 0;
const A_PZ = 1;
const A_R = 2; // rayon d'une requête
const A_X = 3; // point d'une requête / d'une explosion
const A_Z = 4;
const A_X1 = 5; // bout d'un segment
const A_Z1 = 6;
const A_DMG = 7;
const A_KB = 8;
const A_TRAUMA = 9;
const A_ZERO = 10;
const ARG = [null];
for (let k = 0; k < 12; k++) ARG[k] = 0;
function setArg(k, v) {
  if (ARG[k] !== v) ARG[k] = v;
}

const out = new Uint16Array(CAPS.queryScratch);
const dens = new Float32Array(16);
const resolved = new Float64Array(2);
const SAV = new Float64Array(3); // mods.critChanceAdd, mods.critMulAdd sauvés pendant un coup à critique forcé
const S = new Float64Array(8);
const S_CLOCK = 0; // secondes simulées depuis le reset
const S_KAT_SIDE = 1; // sens de la prochaine coupe du katana (±1)
const S_KAT_GAP = 7; // § E5.F : s avant le prochain combo du katana
export const KAT_GAP = S.subarray(S_KAT_GAP, S_KAT_GAP + 1); // § E5.E.7 : vue sur S[S_KAT_GAP], lue par le HUD (ctx)
const KAT_F = new Float64Array([1]); // § E5.F : facteur de dégâts par geste du katana (DPS d'avant gardé)
const S_KAT_T = 2; // s avant la coupe suivante d'une salve
const S_SMOKE_T = 3; // s avant le prochain lancer de fumigènes
const S_FL_T = 4; // s avant l'écho suivant de la frappe éclair
const S_HAM_T = 5; // s avant l'onde suivante du marteau
const S_CAN_CD = 6; // s avant la pose du prochain canon
let katPending = 0;
const KAT = new Float64Array(2); // direction de la salve (unitaire)
let flPending = 0;
const FL = new Float64Array(5); // ligne de la frappe : x0, z0, x1, z1, demi-largeur
let hamPending = 0;
let hamWave = 0;
const HAM = new Float64Array(2); // centre de la frappe

// Compteurs lus par les tests (inspect)
const N_SHOTS = new Int32Array(6); // déclenchements par arme (indice w − KATANA)
const N_HITS = new Int32Array(6); // robots touchés par arme
const N_CRIT_FORCED = new Int32Array(1); // coups à critique forcé (aveuglés)
const LASTV = new Float64Array(12); // relevés : 0 dernière portée katana, 1 dernier rayon d'explosion de grenade, 2 dernière distance de frappe éclair, 3 dernier rayon d'onde, 4 dernier rayon d'obus, 5 nuages en vie, 6 canon en vie, 7 robots du dernier coup

// ----- critique forcé (fumée) et critique propre du katana -------------------------------------------------------------
// Les deux passent par damage.hitEnemyF sans le changer : on monte mods.critChanceAdd (et critMulAdd pour le katana)
// le temps du coup, puis on remet les valeurs sauvées à l'identique.
const MARK_UID = new Uint32Array(CAPS.enemies);
const MARK_T = new Float32Array(CAPS.enemies); // horloge jusqu'à laquelle le robot est aveuglé

/** Le robot i est aveuglé par un fumigène (critiques assurés des armes du Shinobi). */
export function isBlind(i) {
  return MARK_UID[i] === E.uid[i] && MARK_T[i] > S[S_CLOCK] ? 1 : 0;
}

/**
 * Coup de l'arme w sur le robot i : dégâts ARGF[F_V], source ARGF[F_SX], ARGF[F_SZ] (écrits par l'appelant).
 * critAdd : chance de critique en plus ; critMul > 0 : multiplicateur du critique (katana). Rend le résultat de hitEnemyF.
 */
function strikeF(i, w, critAdd, critMul) {
  const blind = isBlind(i) === 1;
  if (!blind && critAdd === 0 && critMul === 0) return damage.hitEnemyF(i, w, flagsOf[w]);
  SAV[0] = mods.critChanceAdd;
  SAV[1] = mods.critMulAdd;
  mods.critChanceAdd = blind ? SAV[0] + 1 : SAV[0] + critAdd;
  if (critMul > 0) mods.critMulAdd = SAV[1] + (critMul - PLAYER.critMul);
  if (blind) N_CRIT_FORCED[0]++;
  const r = damage.hitEnemyF(i, w, flagsOf[w]);
  mods.critChanceAdd = SAV[0];
  mods.critMulAdd = SAV[1];
  return r;
}

/** Coup de la lame de phase (weapons.js) : critique assuré sur un robot aveuglé, sinon hitEnemyF tel quel. */
export function strikeBladeF(i, w) {
  return strikeF(i, w, 0, 0);
}

function knockOut(i, cx, cz, kb) {
  if (kb <= 0 || E.alive[i] === 0) return;
  const dx = E.x[i] - cx;
  const dz = E.z[i] - cz;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) return;
  ARGF[F_DX] = dx / d;
  ARGF[F_DZ] = dz / d;
  ARGF[F_V] = kb;
  enemies.applyKnockbackF(i);
}

// ----- grenades et obus : pool commun d'objets en cloche ------------------------------------------------------------
const LCAP = CAPS.grenades + CAPS.shells;
const lX0 = new Float32Array(LCAP);
const lZ0 = new Float32Array(LCAP);
const lY0 = new Float32Array(LCAP);
const lX1 = new Float32Array(LCAP);
const lZ1 = new Float32Array(LCAP);
const lT = new Float32Array(LCAP); // s de vol écoulées
const lDur = new Float32Array(LCAP); // s de vol en tout
const lArc = new Float32Array(LCAP);
const lW = new Uint8Array(LCAP); // arme (GRENADE ou CANNON) ; 0 = libre
let lobCount = 0;

function takeLob() {
  for (let k = 0; k < LCAP; k++) if (lW[k] === 0) return k;
  return -1;
}

function launch(w, x0, y0, z0, x1, z1, dur, arc) {
  const k = takeLob();
  if (k < 0) return;
  lW[k] = w;
  lX0[k] = x0;
  lY0[k] = y0;
  lZ0[k] = z0;
  lX1[k] = x1;
  lZ1[k] = z1;
  lT[k] = 0;
  lDur[k] = dur;
  lArc[k] = arc;
  lobCount++;
}

function landLob(k) {
  const w = lW[k];
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  lW[k] = 0;
  lobCount--;
  setArg(A_X, lX1[k]);
  setArg(A_Z, lZ1[k]);
  setArg(A_R, effective[o + STAT.AREA]);
  setArg(A_DMG, effective[o + STAT.DAMAGE]);
  setArg(A_TRAUMA, W.explosionTrauma);
  setArg(A_KB, w === GRENADE ? effective[o + STAT.SPECIAL] : W.knockback);
  Q[0] = lX1[k];
  Q[2] = lZ1[k];
  Q[3] = ARG[A_R];
  V.explosion(C0 + w);
  if (w === GRENADE) LASTV[1] = ARG[A_R];
  else LASTV[4] = ARG[A_R];
  // Robots aveuglés dans le souffle d'une grenade : critique assuré (le souffle passe par damage.explode, qui ne lit
  // pas isBlind) — on monte la chance de critique le temps de l'explosion si au moins un robot du rayon est aveuglé.
  let forced = 0;
  if (w === GRENADE) {
    const n = grid.queryCircle(ARG[A_X], ARG[A_Z], ARG[A_R], out, out.length);
    for (let q = 0; q < n; q++) if (isBlind(out[q]) === 1) forced++;
  }
  if (forced > 0) {
    SAV[0] = mods.critChanceAdd;
    mods.critChanceAdd = SAV[0] + 1;
    N_CRIT_FORCED[0] += forced;
  }
  const hit = damage.explode(ARG[A_X], ARG[A_Z], ARG[A_R], ARG[A_DMG], 0, w, flagsOf[w], FXK.ROCKET_TOON, ARG[A_TRAUMA], ARG[A_ZERO], ARG[A_KB]);
  if (forced > 0) mods.critChanceAdd = SAV[0];
  N_HITS[w - KATANA] += hit;
  LASTV[7] = hit;
  if (w === GRENADE && evo !== null && evo.ON[GRENADE] !== 0) evoSmoke(k); // § E3.B : Nuage à fragmentation
}

function updateLobs(dt) {
  for (let k = 0; k < LCAP; k++) {
    if (lW[k] === 0) continue;
    lT[k] += dt;
    if (lT[k] >= lDur[k]) landLob(k);
  }
}

/** Cibles d'un lancer : COUNT paquets (findDensest), le surplus en couronne autour du premier. Rend le nombre écrit. */
function lobTargets(w, count, range, ringMul) {
  setArg(A_PX, P.x);
  setArg(A_PZ, P.z);
  setArg(A_R, range);
  let found = grid.findDensest(ARG[A_PX], ARG[A_PZ], ARG[A_R], dens, count < 8 ? count : 8);
  if (w === GRENADE && repTarget !== null && E.aliveByType[ENEMY.REPARATEUR] > 0) {
    // § E5.D : la première grenade tombe sur le réparateur à portée (pas les fumigènes : zone, règle d'avant)
    const t = repPres(P.x, P.z, range);
    if (t >= 0) {
      found = repEnTete(t, found, count < 8 ? count : 8);
      marquer(t, w);
    }
  }
  if (found === 0) return 0;
  for (let k = found; k < count && k < 8; k++) {
    const a = (k * TAU) / count + S[S_CLOCK];
    dens[k * 2] = dens[0] + Math.cos(a) * ringMul * 2;
    dens[k * 2 + 1] = dens[1] + Math.sin(a) * ringMul * 2;
  }
  return count < 8 ? count : 8;
}

// Point de départ d'un lancer (grenade, fumigène) : la bouche d'une arme de bras portée (main), sinon le buste.
const MAIN = new Float64Array(4); // x, y, z, 1 = depuis une main
const MAIN_W = [WEAPON.BLADE, WEAPON.FLASH, WEAPON.RICOCHET];
function main() {
  for (let k = 0; k < MAIN_W.length; k++) {
    if (__A.bouche(MAIN_W[k]) === 1) {
      MAIN[0] = __A.B[0];
      MAIN[1] = __A.B[1];
      MAIN[2] = __A.B[2];
      MAIN[3] = 1;
      return;
    }
  }
  MAIN[0] = P.x;
  MAIN[1] = WEAPONS[GRENADE].shotHeight;
  MAIN[2] = P.z;
  MAIN[3] = 0;
}

/** Tests : origine du dernier lancer (grenade, fumigène). */
export function lastThrow(out = {}) {
  out.x = MAIN[0];
  out.y = MAIN[1];
  out.z = MAIN[2];
  out.main = MAIN[3] === 1;
  return out;
}

function fireGrenade() {
  const w = GRENADE;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const count = Math.round(effective[o + STAT.COUNT]);
  const n = lobTargets(w, count, W.range, W.ringMul);
  if (n === 0) return false;
  // Correctif de l'étape 3 (contrôle indépendant ; règle de Femz « on tire depuis les armes portées, jamais depuis le
  // centre du corps ») : le .glb n'a pas de bouche_grenades — la grenade part de la MAIN, à la bouche de l'arme de bras
  // portée (lame de l'avant-bras gauche, sinon la lame courte du bras droit) ; le buste seulement si aucune n'est posée.
  main();
  for (let k = 0; k < n; k++) launch(w, MAIN[0], MAIN[1], MAIN[2], dens[k * 2], dens[k * 2 + 1], W.flightSeconds, W.arcHeight);
  N_SHOTS[w - KATANA]++;
  countShot(w);
  return true;
}

// ----- katana ------------------------------------------------------------------------------------------------------
function cutKatana() {
  const w = KATANA;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const range = effective[o + STAT.AREA];
  const dmg = effective[o + STAT.DAMAGE] * CB.mul(COMBO.KATANA) * (COMBO_ATTAQUE.actif ? KAT_F[0] : 1); // § E3.M : revers × 1,2, dégainé × 3 ; § E5.F : facteur par geste
  const critMul = effective[o + STAT.SPECIAL];
  if (CB.gesteOf(COMBO.KATANA) === CB_GESTE.IAIDO) {
    iaidoKatana(dmg, critMul);
    return;
  }
  const cosHalf = Math.cos((W.arcDeg * DEG) / 2);
  setArg(A_PX, P.x);
  setArg(A_PZ, P.z);
  setArg(A_R, range + 1.5); // + rayon du plus gros robot : le test exact suit
  const n = grid.queryCircle(ARG[A_PX], ARG[A_PZ], ARG[A_R], out, out.length);
  let hits = 0;
  for (let q = 0; q < n && hits < W.maxHits; q++) {
    const i = out[q];
    if (E.alive[i] === 0) continue;
    const dx = E.x[i] - P.x;
    const dz = E.z[i] - P.z;
    const d2 = dx * dx + dz * dz;
    const reach = range + E.radius[i];
    if (d2 > reach * reach) continue;
    const contact = W.contact + E.radius[i]; // au contact : touché quel que soit l'angle (retour de Femz, 15/11 20h53)
    if (d2 > contact * contact && d2 > 1e-8 && (dx * KAT[0] + dz * KAT[1]) / Math.sqrt(d2) < cosHalf) continue;
    ARGF[F_V] = dmg;
    ARGF[F_SX] = P.x;
    ARGF[F_SZ] = P.z;
    if (strikeF(i, w, W.critAdd, critMul) <= 0) continue;
    hits++;
    knockOut(i, P.x, P.z, W.knockback);
  }
  N_HITS[w - KATANA] += hits;
  LASTV[0] = range;
  LASTV[7] = hits;
  // croissant daté (même dessin que la lame de phase), plus grand et plus haut
  Q[0] = P.x;
  Q[1] = W.arcHeight;
  Q[2] = P.z;
  Q[3] = range;
  // § E5.F.13 (Femz : « traînée depuis bouche_katana_main ») : centrée sur la bouche du katana dessiné (en main pendant
  // le combo), rayon réduit de l'écart bouche / héros pour rester dans la zone de touche
  if (__A.bouche(KATANA) === 1) {
    const ex = __A.B[0] - P.x;
    const ez = __A.B[2] - P.z;
    const off = Math.sqrt(ex * ex + ez * ez);
    if (off < range - 0.5) {
      Q[0] = __A.B[0];
      Q[2] = __A.B[2];
      Q[3] = range - off;
    }
  }
  Q[4] = KAT[0];
  Q[5] = 0;
  Q[6] = KAT[1];
  Q[7] = W.arcDeg * DEG;
  // § E3.M : traînée orange, sens du geste (taille lourde, puis revers)
  S[S_KAT_SIDE] = CB.gesteOf(COMBO.KATANA) === CB_GESTE.REVERS ? -1 : 1;
  // § E5.F : sens réglé sur le geste en poses clés (taille lourde : de droite à gauche) — CB_CFG.trainee.sensInverse
  Q[8] = ((S[S_KAT_SIDE] > 0) !== (CB_CFG.trainee.sensInverse === true) ? 0 : 1) + rand() * 0.999;
  Q[9] = range * VFX.croissant.marge;
  V.AGE0[0] = CB_CFG.trainee.avance > 0 ? CB_CFG.trainee.avance : 0; // § E5.F : traînée déjà tracée à l'image de l'impact
  V.evenement(VFX_STYLE.TRAINEE_LAME);
  countShot(w);
  CB.juiceF(COMBO.KATANA, hits);
}

/** § E3.M : dégainé éclair — le héros traverse la cible d'un trait (iaido.dist m), tout ce qui est sur la ligne est tranché. */
function iaidoKatana(dmg, critMul) {
  const w = KATANA;
  const W = WEAPONS[w];
  const I = CB_CFG.iaido;
  const range = effective[w * STAT_COUNT + STAT.AREA];
  const dx = KAT[0];
  const dz = KAT[1];
  const x0 = P.x;
  const z0 = P.z;
  const len = range * I.length > I.dist ? range * I.length : I.dist;
  setArg(A_X, x0);
  setArg(A_Z, z0);
  setArg(A_X1, x0 + dx * len);
  setArg(A_Z1, z0 + dz * len);
  setArg(A_R, I.half);
  const n = grid.querySegment(ARG[A_X], ARG[A_Z], ARG[A_X1], ARG[A_Z1], ARG[A_R], out, out.length);
  let hits = 0;
  for (let q = 0; q < n && hits < W.maxHits; q++) {
    const i = out[q];
    if (E.alive[i] === 0) continue;
    ARGF[F_V] = dmg;
    ARGF[F_SX] = x0;
    ARGF[F_SZ] = z0;
    if (strikeF(i, w, W.critAdd, critMul) <= 0) continue;
    hits++;
    knockOut(i, x0, z0, W.knockback);
  }
  // le héros file à travers (jamais dans un obstacle ni hors de l'arène), bref invulnérable
  world.resolve(x0 + dx * I.dist, z0 + dz * I.dist, PLAYER.radius, resolved);
  P.x = resolved[0];
  P.z = resolved[1];
  if (P.invulnT < I.invuln) P.invulnT = I.invuln;
  N_HITS[w - KATANA] += hits;
  LASTV[0] = range;
  LASTV[7] = hits;
  // trait long et fin (traînée orange en mode « ligne » : partie entière de la graine 2)
  Q[0] = x0;
  Q[1] = W.arcHeight;
  Q[2] = z0;
  // § E5.F.13 : le trait part de la main qui tient le katana (bouche_katana_main), décalée comme au départ de la traversée
  if (__A.bouche(KATANA) === 1) {
    Q[0] = __A.B[0] - (P.x - x0);
    Q[2] = __A.B[2] - (P.z - z0);
  }
  Q[3] = len;
  Q[4] = dx;
  Q[5] = 0;
  Q[6] = dz;
  Q[7] = 0;
  Q[8] = 2 + rand() * 0.999;
  Q[9] = len * 1.05;
  V.AGE0[0] = CB_CFG.trainee.avance > 0 ? CB_CFG.trainee.avance : 0; // § E5.F : traînée déjà tracée à l'image de l'impact
  V.evenement(VFX_STYLE.TRAINEE_LAME);
  countShot(w);
  CB.juiceF(COMBO.KATANA, hits);
  // § E3.B (rebranché à la fusion du groupe 2) : la finition du Coupe-circuit = le dégainé éclair du combo de M, s'il touche
  if (hits > 0 && evo !== null && evo.ON[w] !== 0) evo.eventF(w);
}

/** § E3.M : visée du coup suivant d'une salve de katana — le robot le plus proche à portée (sinon la précédente). */
function reaimKatana() {
  const range = effective[KATANA * STAT_COUNT + STAT.AREA];
  setArg(A_PX, P.x);
  setArg(A_PZ, P.z);
  setArg(A_R, range * 1.6);
  let t = grid.queryNearest(ARG[A_PX], ARG[A_PZ], ARG[A_R]);
  if (repTarget !== null && E.aliveByType[ENEMY.REPARATEUR] > 0) {
    const r = repPres(P.x, P.z, range); // § E5.D : le réparateur à portée du katana d'abord
    if (r >= 0) t = r;
  }
  if (t < 0) return;
  const dx = E.x[t] - P.x;
  const dz = E.z[t] - P.z;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (!(l > 1e-6)) return;
  KAT[0] = dx / l;
  KAT[1] = dz / l;
}

function fireKatana() {
  if (katPending > 0 || CB.busy(COMBO.KATANA) === 1) return false; // § E3.M : le geste en cours finit d'abord
  if (COMBO_ATTAQUE.actif && S[S_KAT_GAP] > 0) return false; // § E5.F : pause entre deux combos entiers
  const w = KATANA;
  const o = w * STAT_COUNT;
  const range = effective[o + STAT.AREA];
  setArg(A_PX, P.x);
  setArg(A_PZ, P.z);
  setArg(A_R, range);
  let t = grid.queryNearest(ARG[A_PX], ARG[A_PZ], ARG[A_R]);
  if (repTarget !== null && E.aliveByType[ENEMY.REPARATEUR] > 0) {
    const r = repPres(P.x, P.z, range); // § E5.D : le réparateur à portée du katana d'abord
    if (r >= 0) {
      t = r;
      marquer(r, w);
    }
  }
  if (t < 0) return false;
  let dx = E.x[t] - P.x;
  let dz = E.z[t] - P.z;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l > 1e-6) {
    dx /= l;
    dz /= l;
  } else {
    dx = P.moveX;
    dz = P.moveZ;
  }
  KAT[0] = dx;
  KAT[1] = dz;
  // § E3.M : une salve = COUNT gestes du combo (taille, revers, dégainé) ; la coupe tombe à l'image d'impact
  katPending = Math.round(effective[o + STAT.COUNT]) - 1;
  if (COMBO_ATTAQUE.actif) {
    // § E5.F : une attaque = le COMBO ENTIER (taille lourde, revers, dégainé) ; pause entre deux combos réglée pour garder
    // le nombre de coupes par seconde d'avant (cadence × coupes) : même DPS
    const n = CB_CFG.list[COMBO.KATANA].geste.length;
    katPending = n - 1;
    // § E5.F : courte respiration entre deux combos ; DPS d'avant gardé par un facteur de dégâts PAR GESTE (KAT_F)
    const C = CB_CFG.list[COMBO.KATANA];
    let duree = 0;
    for (let k = 0; k < n; k++) duree += Math.ceil(C.dur[k] * 60 - 1e-6) / 60;
    const avant = effective[o + STAT.RATE] * effective[o + STAT.COUNT];
    const anim = n / duree;
    KAT_F[0] = ((avant < anim ? avant : anim) / (n / (duree + COMBO_ATTAQUE.respiration))) * (effective[o + STAT.COUNT] < 1.5 ? COMBO_ATTAQUE.katana1 : 1);
    S[S_KAT_GAP] = duree + COMBO_ATTAQUE.respiration;
    if (CB.stepOf(COMBO.KATANA) !== 0) CB.resetCombo(COMBO.KATANA);
  }
  N_SHOTS[w - KATANA]++;
  CB.D[0] = dx;
  CB.D[1] = dz;
  CB.requestF(COMBO.KATANA);
  return true;
}

// ----- frappe éclair -------------------------------------------------------------------------------------------------
function slashLine() {
  const w = FLASH;
  const W = WEAPONS[w];
  const dmg = effective[w * STAT_COUNT + STAT.DAMAGE];
  setArg(A_X, FL[0]);
  setArg(A_Z, FL[1]);
  setArg(A_X1, FL[2]);
  setArg(A_Z1, FL[3]);
  setArg(A_R, FL[4]);
  const n = grid.querySegment(ARG[A_X], ARG[A_Z], ARG[A_X1], ARG[A_Z1], ARG[A_R], out, out.length);
  let hits = 0;
  for (let q = 0; q < n; q++) {
    const i = out[q];
    if (E.alive[i] === 0) continue;
    ARGF[F_V] = dmg;
    ARGF[F_SX] = FL[0];
    ARGF[F_SZ] = FL[1];
    if (strikeF(i, w, 0, 0) <= 0) continue;
    hits++;
    knockOut(i, FL[0], FL[1], W.knockback);
  }
  N_HITS[w - KATANA] += hits;
  LASTV[7] = hits;
  // trait daté : le rayon du rail, couché sur la ligne
  const dx = FL[2] - FL[0];
  const dz = FL[3] - FL[1];
  const len = Math.sqrt(dx * dx + dz * dz);
  Q[0] = FL[0];
  Q[1] = W.shotHeight;
  Q[2] = FL[1];
  Q[3] = W.beamWidth;
  Q[4] = len > 1e-6 ? dx / len : 1;
  Q[5] = 0;
  Q[6] = len > 1e-6 ? dz / len : 0;
  Q[7] = len;
  V.rail();
  flPending--;
  S[S_FL_T] = W.echoGap;
}

function fireFlash() {
  if (flPending > 0) return false;
  const w = FLASH;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const dist = effective[o + STAT.AREA];
  const half = effective[o + STAT.SPECIAL];
  // Retour de Femz du 16/11/2026 (point 3) : « frappe eclair … ca devrais etre activable par une touche reglable (de
  // base touche A ou E), psk j'ai pris bcq trop de degats qui me faisait foncé auto dans des gros tat d'ennemis » — elle
  // ne part PLUS toute seule : seulement sur la touche (P.strikeReq, player.js), dans la direction de marche, même sans
  // robot sur la ligne (le joueur décide). La recharge (cadence de l'arme, fireAcc) reste prête tant qu'il n'appuie pas.
  if (!(P.strikeReq > 0)) return false;
  let dx = P.moveX;
  let dz = P.moveZ;
  //#region e5:U-visee-souris
  // § E5.U.3 : la frappe part vers le curseur (VISEE = direction de marche tant qu'il n'a jamais bougé)
  // § E5.AB.13 : VISEE n'est tenue qu'en Caméra libre (VISEE[2] = 1) ; en Vue fixe, la direction de marche (ci-dessus)
  if (VISEE[2] === 1) {
    dx = VISEE[0];
    dz = VISEE[1];
  }
  //#endregion e5:U-visee-souris
  const l = Math.sqrt(dx * dx + dz * dz);
  if (!(l > 1e-6)) return false;
  dx /= l;
  dz /= l;
  P.strikeReq = 0;
  // le héros file au bout de la ligne (jamais dans un obstacle ni hors de l'arène)
  FL[0] = P.x;
  FL[1] = P.z;
  world.resolve(P.x + dx * dist, P.z + dz * dist, W.radius, resolved);
  FL[2] = resolved[0];
  FL[3] = resolved[1];
  FL[4] = half;
  P.x = resolved[0];
  P.z = resolved[1];
  if (P.invulnT < W.invuln) P.invulnT = W.invuln;
  LASTV[2] = Math.sqrt((FL[2] - FL[0]) * (FL[2] - FL[0]) + (FL[3] - FL[1]) * (FL[3] - FL[1]));
  flPending = Math.round(effective[o + STAT.COUNT]);
  N_SHOTS[w - KATANA]++;
  countShot(w);
  slashLine();
  // § E3.M : arrivée de la frappe — geste (lame tendue derrière lui), arrêt sur image et secousse au contact
  CB.D[0] = dx;
  CB.D[1] = dz;
  if (CB.requestF(COMBO.FLASH) === 1) CB.juiceF(COMBO.FLASH, LASTV[7]);
  return true;
}

// ----- marteau -------------------------------------------------------------------------------------------------------
function waveHammer() {
  const w = HAMMER;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const R = effective[o + STAT.AREA];
  const inner = hamWave === 0 ? 0 : R * (1 + W.waveGrow * (hamWave - 1));
  const outer = R * (1 + W.waveGrow * hamWave);
  const dmg = MARTEAU_COMBO.actif ? HG[1] * MARTEAU_COMBO.mulSol : effective[o + STAT.DAMAGE]; // § E5.F.13
  const kb = effective[o + STAT.SPECIAL];
  setArg(A_X, HAM[0]);
  setArg(A_Z, HAM[1]);
  setArg(A_R, outer + 1.5);
  const n = grid.queryCircle(ARG[A_X], ARG[A_Z], ARG[A_R], out, out.length);
  let hits = 0;
  for (let q = 0; q < n && hits < W.maxHits; q++) {
    const i = out[q];
    if (E.alive[i] === 0) continue;
    const dx = E.x[i] - HAM[0];
    const dz = E.z[i] - HAM[1];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d - E.radius[i] > outer || d + E.radius[i] < inner) continue;
    ARGF[F_V] = dmg;
    ARGF[F_SX] = HAM[0];
    ARGF[F_SZ] = HAM[1];
    if (strikeF(i, w, 0, 0) <= 0) continue;
    hits++;
    knockOut(i, HAM[0], HAM[1], kb);
    if (E.alive[i] === 1) {
      ARGF[F_V] = W.stunSlow;
      ARGF[F_T] = W.stunSeconds;
      enemies.applySlowF(i);
    }
  }
  N_HITS[w - KATANA] += hits;
  LASTV[3] = outer;
  LASTV[7] = hits;
  Q[0] = HAM[0];
  Q[2] = HAM[1];
  Q[3] = outer;
  V.explosion(C0 + w);
  hamWave++;
  hamPending--;
  S[S_HAM_T] = W.waveGap;
}

// § E5.F.13 : [0] gestes du combo encore à demander, [1] dégâts figés au départ du combo (× burst de la fenêtre)
// § E5.F.14 : [2] s avant le combo suivant (fin du combo + respiration) — marteau enchaîné, sans recharge
const HG = new Float64Array(3);
const MH_ON = MARTEAU_COMBO.actif && MARTEAU_COMBO.enchaine ? 1 : 0;
export const HAM_GAP = HG.subarray(2, 3); // § E5.F.14 : respiration en cours (repère du combo du HUD, s'il est branché)
const MH = new Float64Array(8); // réglages de la recharge d'avant : seconds, perLevel, min, active, activePerLevel, activeMax, burst, durée du combo
{
  const R = MARTEAU_COMBO.ref || {};
  MH[0] = R.seconds || 5;
  MH[1] = R.perLevel || 0;
  MH[2] = R.min || 0;
  MH[3] = R.active || 1;
  MH[4] = R.activePerLevel || 0;
  MH[5] = R.activeMax > 0 ? R.activeMax : MH[3];
  MH[6] = R.burst || 1;
  let d = 0;
  for (const x of CB_CFG.list[COMBO.HAMMER].dur) d += Math.ceil(x * 60 - 1e-6) / 60; // durées réelles (images entières)
  MH[7] = d;
}
/** § E5.F.14 : F(n) — facteur des dégâts du combo enchaîné qui garde le DPS moyen de l'arme à recharge (écrit dans HG[1]). */
function facteurEnchaine() {
  const n = W_NIV(HAMMER);
  const k = n > 1 ? n - 1 : 0;
  let rech = MH[0] - MH[1] * k;
  if (rech < MH[2]) rech = MH[2];
  let act = MH[3] + MH[4] * k;
  if (act > MH[5]) act = MH[5];
  const N = 1 + Math.floor(effective[HAMMER * STAT_COUNT + STAT.RATE] * act + 1e-9);
  HG[1] *= (MH[6] * N * (MH[7] + MARTEAU_COMBO.respiration)) / (rech + act);
}
const MC_ARC = new Float64Array([Math.cos((MARTEAU_COMBO.arcDeg * Math.PI) / 360)]);

/** Direction du geste suivant : vers le robot le plus proche (à `r` m), sinon la marche. */
function viserMarteau(r) {
  setArg(A_PX, P.x);
  setArg(A_PZ, P.z);
  setArg(A_R, r);
  const t = grid.queryNearest(ARG[A_PX], ARG[A_PZ], ARG[A_R]);
  let dx = P.moveX;
  let dz = P.moveZ;
  if (t >= 0) {
    const ex = E.x[t] - P.x;
    const ez = E.z[t] - P.z;
    const l = Math.sqrt(ex * ex + ez * ez);
    if (l > 1e-6) {
      dx = ex / l;
      dz = ez / l;
    }
  }
  CB.D[0] = dx;
  CB.D[1] = dz;
}

/**
 * § E5.F.13 : diagonale du marteau — robots devant (arc MARTEAU_COMBO.arcDeg autour du geste, bord à moins de `portee` m)
 * : dégâts figés × mulDiag, recul, sonnés comme par l'onde ; traînée orange large ; secousse au contact.
 */
function swingHammer() {
  const w = HAMMER;
  const W = WEAPONS[w];
  const M = MARTEAU_COMBO;
  const dx = CB.dir(COMBO.HAMMER, 0);
  const dz = CB.dir(COMBO.HAMMER, 1);
  setArg(A_X, P.x);
  setArg(A_Z, P.z);
  setArg(A_R, M.portee + 1.5);
  const n = grid.queryCircle(ARG[A_X], ARG[A_Z], ARG[A_R], out, out.length);
  let hits = 0;
  for (let q = 0; q < n && hits < W.maxHits; q++) {
    const i = out[q];
    if (E.alive[i] === 0) continue;
    const ex = E.x[i] - P.x;
    const ez = E.z[i] - P.z;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d - E.radius[i] > M.portee) continue;
    if (d > E.radius[i] + 0.3 && (ex * dx + ez * dz) / d < MC_ARC[0]) continue;
    ARGF[F_V] = HG[1] * M.mulDiag;
    ARGF[F_SX] = P.x;
    ARGF[F_SZ] = P.z;
    if (strikeF(i, w, 0, 0) <= 0) continue;
    hits++;
    knockOut(i, P.x, P.z, M.recul);
  }
  N_HITS[w - KATANA] += hits;
  LASTV[7] = hits;
  Q[0] = P.x;
  Q[1] = 1.1;
  Q[2] = P.z;
  Q[3] = M.portee;
  Q[4] = dx;
  Q[5] = 0;
  Q[6] = dz;
  Q[7] = (M.arcDeg * Math.PI) / 180;
  const droite = CB.gesteOf(COMBO.HAMMER) === 12 ? 1 : 0; // diagonale de droite à gauche, puis retour
  Q[8] = ((droite === 1) !== (CB_CFG.trainee.sensInverse === true) ? 0 : 1) + rand() * 0.999;
  Q[9] = M.portee * VFX.croissant.marge;
  V.AGE0[0] = CB_CFG.trainee.avance > 0 ? CB_CFG.trainee.avance : 0;
  V.evenement(VFX_STYLE.TRAINEE_LAME);
  CB.juiceF(COMBO.HAMMER, hits);
}

function fireHammer() {
  if (hamPending > 0 || HG[0] > 0) return false;
  const w = HAMMER;
  const R = effective[w * STAT_COUNT + STAT.AREA];
  setArg(A_PX, P.x);
  setArg(A_PZ, P.z);
  setArg(A_R, R);
  if (grid.queryNearest(ARG[A_PX], ARG[A_PZ], ARG[A_R]) < 0) return false;
  if (CB.busy(COMBO.HAMMER) === 1) return false;
  HAM[0] = P.x;
  HAM[1] = P.z;
  hamWave = 0;
  hamPending = Math.round(effective[w * STAT_COUNT + STAT.COUNT]);
  N_SHOTS[w - KATANA]++;
  // § E3.M : le marteau se lève puis s'abat ; la première onde part à l'image de la frappe (update)
  S[S_HAM_T] = 1e9;
  CB.D[0] = P.moveX;
  CB.D[1] = P.moveZ;
  if (MARTEAU_COMBO.actif) {
    // § E5.F.13 : le combo entier (2 diagonales vers le robot le plus proche, puis la frappe au sol)
    HG[0] = CB_CFG.list[COMBO.HAMMER].geste.length - 1;
    HG[1] = effective[w * STAT_COUNT + STAT.DAMAGE];
    if (MH_ON === 1) {
      facteurEnchaine(); // § E5.F.14 : même DPS moyen qu'avec la recharge
      HG[2] = MH[7] + MARTEAU_COMBO.respiration;
    }
    if (CB.stepOf(COMBO.HAMMER) !== 0) CB.resetCombo(COMBO.HAMMER);
    viserMarteau(R);
  }
  CB.requestF(COMBO.HAMMER);
  return true;
}

// ----- fumigènes ------------------------------------------------------------------------------------------------------
const SCAP = CAPS.smokes;
const smX = new Float32Array(SCAP);
const smZ = new Float32Array(SCAP);
const smR = new Float32Array(SCAP);
const smLife = new Float32Array(SCAP); // s restantes ; ≤ 0 : libre
const smAge = new Float32Array(SCAP);
const smFade = new Float32Array(SCAP);
const smAcc = new Float32Array(SCAP); // accumulateur des tics
const smFlyX = new Float32Array(SCAP); // départ du lancer (le nuage éclot à l'arrivée)
const smFlyZ = new Float32Array(SCAP);
let smokeCount = 0;

function takeSmoke() {
  let old = 0;
  for (let s = 0; s < SCAP; s++) {
    if (!(smLife[s] > 0)) return s;
    if (smAge[s] > smAge[old]) old = s;
  }
  smokeCount--;
  return old;
}

function throwSmoke() {
  const w = SMOKE;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const count = Math.round(effective[o + STAT.COUNT]);
  const n = lobTargets(w, count, W.range, W.ringMul);
  if (n === 0) return false;
  main();
  for (let k = 0; k < n; k++) {
    const s = takeSmoke();
    smX[s] = dens[k * 2];
    smZ[s] = dens[k * 2 + 1];
    smFlyX[s] = MAIN[0]; // correctif de l'étape 3 : le fumigène part de la main (main(), plus haut)
    smFlyZ[s] = MAIN[2];
    smR[s] = effective[o + STAT.AREA];
    smLife[s] = effective[o + STAT.SPECIAL] + W.flightSeconds;
    smAge[s] = 0;
    smFade[s] = 0;
    smAcc[s] = 0;
    smokeCount++;
  }
  N_SHOTS[w - KATANA]++;
  countShot(w);
  return true;
}

function tickSmoke(s) {
  const w = SMOKE;
  const W = WEAPONS[w];
  const dmg = effective[w * STAT_COUNT + STAT.DAMAGE];
  setArg(A_X, smX[s]);
  setArg(A_Z, smZ[s]);
  setArg(A_R, smR[s] + 1.5);
  const n = grid.queryCircle(ARG[A_X], ARG[A_Z], ARG[A_R], out, out.length);
  let hits = 0;
  const until = S[S_CLOCK] + W.markSeconds;
  for (let q = 0; q < n && hits < W.maxTicks; q++) {
    const i = out[q];
    if (E.alive[i] === 0) continue;
    const dx = E.x[i] - smX[s];
    const dz = E.z[i] - smZ[s];
    const reach = smR[s] + E.radius[i];
    if (dx * dx + dz * dz > reach * reach) continue;
    MARK_UID[i] = E.uid[i];
    MARK_T[i] = until;
    ARGF[F_V] = dmg;
    ARGF[F_SX] = smX[s];
    ARGF[F_SZ] = smZ[s];
    if (damage.hitEnemyF(i, w, flagsOf[w]) > 0) hits++;
    if (E.alive[i] === 1) {
      ARGF[F_V] = W.slow;
      ARGF[F_T] = W.slowSeconds;
      enemies.applySlowF(i);
    }
  }
  N_HITS[w - KATANA] += hits;
}

function updateSmokes(dt) {
  const w = SMOKE;
  const W = WEAPONS[w];
  if (owned[w] === 1) {
    S[S_SMOKE_T] -= dt;
    if (S[S_SMOKE_T] <= 0 && !armesCoupees()) {
      if (throwSmoke()) S[S_SMOKE_T] = W.throwEvery;
      else S[S_SMOKE_T] = 0.25; // aucune cible : on réessaie bientôt
    }
  }
  const rate = effective[w * STAT_COUNT + STAT.RATE];
  let alive = 0;
  for (let s = 0; s < SCAP; s++) {
    if (smFade[s] > 0) smFade[s] -= dt;
    if (!(smLife[s] > 0)) continue;
    smAge[s] += dt;
    smLife[s] -= dt;
    if (smLife[s] <= 0) {
      smLife[s] = 0;
      smFade[s] = W.fadeOut;
      smokeCount--;
      if (evo !== null && evo.ON[GRENADE] !== 0) {
        // § E3.B : Nuage à fragmentation — la fumée explose en éclats à sa disparition
        ARGF[F_X_E3B] = smX[s];
        ARGF[F_Z_E3B] = smZ[s];
        evo.eventF(SMOKE);
      }
      continue;
    }
    alive++;
    if (smAge[s] < W.flightSeconds) continue; // encore en vol
    smAcc[s] += dt * rate;
    let k = 0;
    while (smAcc[s] >= 1 && k < 4) {
      tickSmoke(s);
      smAcc[s] -= 1;
      k++;
    }
  }
  LASTV[5] = alive;
}

// ----- grosse tourelle (canon lourd) -----------------------------------------------------------------------------------
let cannonMesh = null;
let cannonMat = null;
let cannonSettled = null;
const CN = new Float64Array(10); // 0 x, 1 z, 2 vie, 3 âge, 4 repli, 5 cap, 6 accumulateur de tir, 7 départ x, 8 départ z, 9 cap voulu

function initCannon() {
  const W = WEAPONS[CANNON];
  cannonMesh = render.createInstanced(render.emptyModelGeometry(), render.createLitMaterial({ glowColor: W.glow, profil: W.profil }), CAPS.cannons, { name: 'canons' });
  cannonMesh.receiveShadow = true;
  cannonMat = cannonMesh.instanceMatrix.array;
  cannonSettled = chargerPieces(new URL('../' + MODELES.dir + W.model, import.meta.url).href, { cible: 0.9 * W.scale, emissifMateriau: true, textures: true }).then(
    (d) => {
      render.setModelGeometry(cannonMesh, d);
      appliquerTexturesArmes(cannonMesh.material, d.textures);
      return true;
    },
    (e) => {
      console.warn('Canon lourd illisible (jouable sans modèle) :', e);
      return false;
    },
  );
}

export function whenCannonModelSettled() {
  return cannonSettled;
}

function deployCannon() {
  const W = WEAPONS[CANNON];
  const o = CANNON * STAT_COUNT;
  world.resolve(P.x - P.moveX * W.deployDist, P.z - P.moveZ * W.deployDist, 0.6, resolved);
  CN[0] = resolved[0];
  CN[1] = resolved[1];
  // § E4.G : en mode recharge, le canon vit la fenêtre d'action (elle grandit avec le niveau), pas la stat « Durée »
  CN[2] = cdCannon() ? ctx.cooldowns.windowLeft(0, CANNON) : effective[o + STAT.SPECIAL];
  CN[3] = 0;
  CN[4] = 0;
  CN[5] = Math.atan2(P.moveX, P.moveZ);
  CN[9] = CN[5];
  CN[6] = 1;
  CN[7] = P.x;
  CN[8] = P.z;
  N_SHOTS[CANNON - KATANA]++;
  countShot(CANNON); // son de pose
  // § E3.M : il lance le canon (geste de pose vers le point de chute)
  const gx = CN[0] - P.x;
  const gz = CN[1] - P.z;
  const gl = Math.sqrt(gx * gx + gz * gz);
  CB.D[0] = gl > 1e-6 ? gx / gl : -P.moveX;
  CB.D[1] = gl > 1e-6 ? gz / gl : -P.moveZ;
  CB.requestF(COMBO.POSE);
}

function fireCannon() {
  const w = CANNON;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const count = Math.round(effective[o + STAT.COUNT]);
  setArg(A_X, CN[0]);
  setArg(A_Z, CN[1]);
  setArg(A_R, W.range);
  let found = grid.findDensest(ARG[A_X], ARG[A_Z], ARG[A_R], dens, count < 8 ? count : 8);
  if (repTarget !== null && E.aliveByType[ENEMY.REPARATEUR] > 0) {
    // § E5.D : le premier obus tombe sur le réparateur à portée du canon
    const t = repPres(CN[0], CN[1], W.range);
    if (t >= 0) {
      found = repEnTete(t, found, count < 8 ? count : 8);
      marquer(t, w);
    }
  }
  // § E5.F (demande de Femz du 17/11) : le boss d'abord (puis le réparateur, puis les paquets) — vivant, à portée du canon ;
  // protégé par ses drones-boucliers : le drone-bouclier le plus proche à portée d'abord (« oui, les drones d'abord »)
  if (TOURELLES_BOSS.actif) {
    const b = E.bossIndex;
    if (b >= 0 && E.alive[b] === 1 && E.sus[b] === 0) {
      if (E.bossShield > 0) {
        const d = W_DRONE(CN[0], CN[1], W.range);
        if (d >= 0) found = repEnTete(d, found, count < 8 ? count : 8);
      } else {
        const bx = E.x[b] - CN[0];
        const bz = E.z[b] - CN[1];
        const rb = W.range + E.radius[b];
        if (bx * bx + bz * bz <= rb * rb) found = repEnTete(b, found, count < 8 ? count : 8);
      }
    }
  }
  if (found === 0) return false;
  CN[9] = Math.atan2(dens[0] - CN[0], dens[1] - CN[1]);
  const mx = CN[0] + Math.sin(CN[5]) * W.muzzle; // § E5.T : bout du canon mesuré sur canon-lourd.glb
  const mz = CN[1] + Math.cos(CN[5]) * W.muzzle;
  for (let k = 0; k < count && k < 8; k++) {
    const j = k < found ? k : k % found;
    let tx = dens[j * 2];
    let tz = dens[j * 2 + 1];
    if (k >= found) {
      const a = (k * TAU) / count;
      tx += Math.cos(a) * 1.6;
      tz += Math.sin(a) * 1.6;
    }
    launch(w, mx, W.shotHeight, mz, tx, tz, W.shellSeconds, W.shellArc);
    if (evo !== null && evo.ON[w] !== 0) evoBarrel(mx, mz, tx, tz); // § E3.B : Forteresse — 2e canon
  }
  if (evo !== null && evo.ON[w] !== 0) {
    // § E3.B : Forteresse — la petite salve de l'ancienne Sentinelle, vers le premier paquet
    const dx = dens[0] - mx;
    const dz = dens[1] - mz;
    const l = Math.sqrt(dx * dx + dz * dz);
    ARGF[F_X_E3B] = mx;
    ARGF[F_Z_E3B] = mz;
    ARGF[F_DX] = l > 1e-6 ? dx / l : 1;
    ARGF[F_DZ] = l > 1e-6 ? dz / l : 0;
    evo.eventF(w);
  }
  audio.play(W.sfx, ARG[A_X], ARG[A_Z]);
  return true;
}

/** § E4.G : le canon lourd est une source à recharge (RECHARGES.weapons.cannon) : posé au départ de la fenêtre. */
function cdCannon() {
  return ctx.cooldowns !== undefined && ctx.cooldowns !== null && ctx.cooldowns.isCooldown(0, CANNON);
}

function updateCannon(dt) {
  const w = CANNON;
  const W = WEAPONS[w];
  const cd = cdCannon();
  if (CN[4] > 0) CN[4] -= dt;
  if (CN[2] > 0) {
    CN[3] += dt;
    CN[2] -= dt;
    if (cd && ctx.cooldowns.windowLeft(0, w) <= 0) CN[2] = 0; // § E4.G : fenêtre refermée, il se replie
    if (CN[2] <= 0) {
      CN[2] = 0;
      CN[4] = W.foldSeconds;
      S[S_CAN_CD] = W.deployEvery;
      LASTV[6] = 0;
      return;
    }
    LASTV[6] = 1;
    // le canon lourd tourne lentement vers sa cible
    let d = CN[9] - CN[5];
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    const step = W.turnRate * dt;
    CN[5] += d > step ? step : d < -step ? -step : d;
    // § E3.M : atterrissage (secousse au sol, poussière, son), puis déploiement AVANT le premier tir
    if (CN[3] >= W.deploySeconds && CN[3] - dt < W.deploySeconds) {
      CB.PL[0] = CN[0];
      CB.PL[1] = CN[1];
      CB.landF();
    }
    if (CN[3] < W.deploySeconds + CB_CFG.deploy.unfold) return; // il se déplie avant son premier tir
    let t = CN[6] + dt * effective[w * STAT_COUNT + STAT.RATE];
    if (t >= 1) {
      if (fireCannon()) t -= 1;
      else t = 1;
    }
    CN[6] = t > 1 ? 1 : t;
    return;
  }
  if (owned[w] === 0) return;
  if (cd) {
    if (ctx.cooldowns.justFired(0, w) && !armesCoupees()) deployCannon(); // § E4.G : départ de la fenêtre (weapons.cdBegin) ; § E4.O.3
    return;
  }
  S[S_CAN_CD] -= dt;
  if (S[S_CAN_CD] <= 0 && !armesCoupees()) deployCannon();
}

function syncCannon() {
  if (cannonMesh === null) return;
  let n = 0;
  const W = WEAPONS[CANNON];
  const alive = CN[2] > 0;
  if (owned[CANNON] === 1 && (alive || CN[4] > 0)) {
    let x = CN[0];
    let y = 0;
    let z = CN[1];
    let sc = W.scale;
    if (alive && CN[3] < W.deploySeconds) {
      const u = CN[3] / W.deploySeconds;
      const e = u * u * (3 - 2 * u);
      x = CN[7] + (x - CN[7]) * e;
      z = CN[8] + (z - CN[8]) * e;
      y = 0.6 * 4 * u * (1 - u);
      sc = W.scale * (0.25 + 0.75 * e);
    } else if (!alive) {
      const u = CN[4] / W.foldSeconds;
      sc = W.scale * (u > 0 ? u : 0);
    }
    // § E3.M : déploiement après l'atterrissage (écrasé, dressé, posé)
    let sh = 1;
    let sv = 1;
    if (alive && CN[3] >= W.deploySeconds && CN[3] < W.deploySeconds + CB_CFG.deploy.unfold) {
      CB.DEPLOI[2] = CN[3] - W.deploySeconds;
      CB.unfoldF();
      sv = CB.DEPLOI[0];
      sh = CB.DEPLOI[1];
    }
    const c = Math.cos(CN[5]) * sc * sh;
    const sn = Math.sin(CN[5]) * sc * sh;
    cannonMat[0] = c;
    cannonMat[1] = 0;
    cannonMat[2] = -sn;
    cannonMat[3] = 0;
    cannonMat[4] = 0;
    cannonMat[5] = sc * sv;
    cannonMat[6] = 0;
    cannonMat[7] = 0;
    cannonMat[8] = sn;
    cannonMat[9] = 0;
    cannonMat[10] = c;
    cannonMat[11] = 0;
    cannonMat[12] = x;
    cannonMat[13] = y;
    cannonMat[14] = z;
    cannonMat[15] = 1;
    n = 1;
    const q = CAPS.turrets * 4; // § E5.T : ombre de contact (place après celles des sentinelles)
    TACHES_CONTACT[q] = x;
    TACHES_CONTACT[q + 1] = z;
    TACHES_CONTACT[q + 2] = W.contact.rayon * sc * sh;
    TACHES_CONTACT[q + 3] = y > 0.5 ? 0 : W.contact.force * (1 - y * 2);
  } else TACHES_CONTACT[CAPS.turrets * 4 + 3] = 0;
  render.commit(cannonMesh, n);
}

// ----- interface avec weapons.js -----------------------------------------------------------------------------------------

/** api : { owned, effective, flagsOf, countShot } (vues de weapons.js). */
export function init(context, api) {
  ctx = context;
  grid = ctx.grid;
  damage = ctx.damage;
  enemies = ctx.enemies;
  audio = ctx.audio;
  camera = ctx.camera;
  world = ctx.world;
  render = ctx.render;
  owned = api.owned;
  effective = api.effective;
  flagsOf = api.flagsOf;
  countShot = api.countShot;
  if (api.repTarget) {
    // § E5.D : réparateur prioritaire (weapons.js) — REP_S = x, z du point de recherche, portée
    REP_S = api.REP_S;
    repTarget = api.repTarget;
    marquer = api.marquer;
  }
  if (api.droneBouclier) W_DRONE = api.droneBouclier; // § E5.F
  if (api.niveau) W_NIV = api.niveau; // § E5.F.14
  if (api.fireAcc) fireAccW = api.fireAcc; // § E5.U.5
  if (api.usable) usableW = api.usable;
  initCannon();
  evo = ctx.evolutions || null; // § E3.B
}

export function reset() {
  S.fill(0);
  S[S_KAT_SIDE] = 1;
  katPending = 0;
  flPending = 0;
  hamPending = 0;
  hamWave = 0;
  HG.fill(0); // § E5.F.13
  lW.fill(0);
  lobCount = 0;
  smLife.fill(0);
  smFade.fill(0);
  smokeCount = 0;
  CN.fill(0);
  MARK_T.fill(0);
  N_SHOTS.fill(0);
  N_HITS.fill(0);
  N_CRIT_FORCED[0] = 0;
  LASTV.fill(0);
  sonsFrappeReset(); // § E5.AD
}

/** L'arme w est retirée (debug) : ses objets quittent le jeu. */
export function onRemoved(w) {
  if (w === KATANA) {
    katPending = 0;
    S[S_KAT_GAP] = 0; // § E5.F : l'arme retirée, son combo repart du 1er geste, sans attendre la respiration
  }
  else if (w === FLASH) flPending = 0;
  else if (w === HAMMER) {
    hamPending = 0;
    HG[0] = 0; // § E5.F.13
  }
  else if (w === SMOKE) {
    smLife.fill(0);
    smFade.fill(0);
    smokeCount = 0;
  } else if (w === CANNON) CN.fill(0);
  if (w === GRENADE || w === CANNON) {
    for (let k = 0; k < LCAP; k++) {
      if (lW[k] === w) {
        lW[k] = 0;
        lobCount--;
      }
    }
  }
}

/** Armes que weapons.update ne fait PAS tirer à la cadence (elles tirent ici, dans update) : fumigènes, canon. */
export function selfTimed(w) {
  return w === SMOKE || w === CANNON || (w === HAMMER && MH_ON === 1); // § E5.F.14 : marteau enchaîné (update)
}

/** Une salve de l'arme w (katana, grenades, frappe éclair, marteau). false = aucune cible : la recharge reste prête. */
export function fireF(w) {
  switch (w) {
    case KATANA:
      return fireKatana();
    case GRENADE:
      return fireGrenade();
    case FLASH:
      return fireFlash();
    case HAMMER:
      return fireHammer();
    default:
      return false;
  }
}

/** Une fois par image, après les armes de weapons.js (joueur vivant). */
export function update(dt) {
  S[S_CLOCK] += dt;
  if (S[S_KAT_GAP] > 0) S[S_KAT_GAP] -= dt; // § E5.F : pause entre deux combos du katana
  if (lobCount > 0) updateLobs(dt);
  if (katPending > 0 || CB.busy(COMBO.KATANA) === 1) {
    if (owned[KATANA] === 0) katPending = 0;
    else {
      // § E3.M : coupe à l'image d'impact du geste ; le geste suivant de la salve part quand celui-ci finit
      if (CB.impactF(COMBO.KATANA) === 1) cutKatana();
      if (katPending > 0 && CB.busy(COMBO.KATANA) === 0 && !armesCoupees()) {
        reaimKatana();
        CB.D[0] = KAT[0];
        CB.D[1] = KAT[1];
        CB.requestF(COMBO.KATANA);
        katPending--;
      }
    }
  }
  if (flPending > 0) {
    if (owned[FLASH] === 0) flPending = 0;
    else {
      S[S_FL_T] -= dt;
      if (S[S_FL_T] <= 0) slashLine();
    }
  }
  // § E5.F.14 : marteau enchaîné — le combo suivant part après la respiration, tant qu'un robot est à portée
  if (MH_ON === 1) {
    if (HG[2] > 0) HG[2] -= dt;
    else if (owned[HAMMER] === 1 && hamPending === 0 && HG[0] === 0 && CB.busy(COMBO.HAMMER) === 0 && !armesCoupees()) fireHammer();
  }
  if (hamPending > 0) {
    if (owned[HAMMER] === 0) {
      hamPending = 0;
      HG[0] = 0; // § E5.F.13
    }
    else {
      const imp = CB.impactF(COMBO.HAMMER);
      if (imp === 1 && MARTEAU_COMBO.actif && CB.stepOf(COMBO.HAMMER) < CB_CFG.list[COMBO.HAMMER].geste.length - 1) swingHammer(); // § E5.F.13
      else if (imp === 1) {
        // § E3.M : le marteau touche le sol — première onde là où il est, son, arrêt sur image, secousse
        HAM[0] = P.x;
        HAM[1] = P.z;
        countShot(HAMMER);
        waveHammer();
        if (evo !== null && evo.ON[HAMMER] !== 0) {
          // § E3.B : Séisme — une 2e onde, plus large, après la première (rebranché sur l'image de la frappe de M)
          ARGF[F_X_E3B] = HAM[0];
          ARGF[F_Z_E3B] = HAM[1];
          evo.eventF(HAMMER);
        }
        CB.juiceF(COMBO.HAMMER, LASTV[7] > 0 ? LASTV[7] : 1); // la frappe au sol secoue même à vide
      }
      // § E5.F.13 : geste suivant du combo dès que le précédent est fini
      if (HG[0] > 0 && CB.busy(COMBO.HAMMER) === 0) {
        viserMarteau(effective[HAMMER * STAT_COUNT + STAT.AREA] + 2);
        if (CB.requestF(COMBO.HAMMER) === 1) HG[0]--;
      }
      S[S_HAM_T] -= dt;
      if (S[S_HAM_T] <= 0) waveHammer();
    }
  }
  if (smokeCount > 0 || owned[SMOKE] === 1) updateSmokes(dt);
  if (CN[2] > 0 || CN[4] > 0 || owned[CANNON] === 1) updateCannon(dt);
  sonsFrappe(); // § E5.AD : Frappe éclair prête, touche pressée pendant la recharge
}

/** Dessin : grenades et obus dans le lot TIRS, nuages dans CONTINUS (à la suite de weapons.js), canon instancié. */
export function sync() {
  //#region e5:U-visee-souris
  // § E5.U.5 : trait d'annonce de la Frappe éclair PRÊTE (cadence pleine, aucun écho en cours, pas de coup de pied)
  // variante 'b' (la bande se charge) : visible aussi pendant la recharge, remplie au rythme de fireAcc
  if (owned[FLASH] === 1 && P.alive && flPending === 0 && fireAccW !== null && (fireAccW[FLASH] >= 1 || visee.traitEnRecharge() === 1) && (usableW === null || usableW[FLASH] === 1) && !armesCoupees()) {
    TRAIT_FRAPPE[0] = 1;
    TRAIT_FRAPPE[4] = fireAccW[FLASH];
    TRAIT_FRAPPE[1] = effective[FLASH * STAT_COUNT + STAT.AREA];
    TRAIT_FRAPPE[2] = effective[FLASH * STAT_COUNT + STAT.SPECIAL];
    TRAIT_FRAPPE[3] = WEAPONS[FLASH].radius;
  }
  visee.sync();
  //#endregion e5:U-visee-souris
  const a = V.tampon(V.LOT.TIRS);
  const cap = V.capacite(V.LOT.TIRS);
  let n = V.compte[V.LOT.TIRS];
  if (lobCount > 0) {
    for (let k = 0; k < LCAP && n < cap; k++) {
      const w = lW[k];
      if (w === 0) continue;
      let u = lT[k] / lDur[k];
      if (u > 1) u = 1;
      const dx = lX1[k] - lX0[k];
      const dz = lZ1[k] - lZ0[k];
      const d = Math.sqrt(dx * dx + dz * dz);
      const y = lY0[k] * (1 - u) + 0.3 * u + lArc[k] * 4 * u * (1 - u);
      const vy = (0.3 - lY0[k] + lArc[k] * 4 * (1 - 2 * u)) / lDur[k];
      const vh = d / lDur[k];
      const inv = 1 / Math.sqrt(vh * vh + vy * vy + 1e-9);
      const p = n * STRIDE;
      n++;
      a[p] = lX0[k] + dx * u;
      a[p + 1] = y;
      a[p + 2] = lZ0[k] + dz * u;
      a[p + 3] = w === CANNON ? 0.32 : 0.22;
      a[p + 4] = d > 1e-6 ? (dx / d) * vh * inv : 0;
      a[p + 5] = vy * inv;
      a[p + 6] = d > 1e-6 ? (dz / d) * vh * inv : 0;
      a[p + 7] = w === CANNON ? 1.2 : 0.7;
      a[p + 8] = VFX_STYLE.RICOCHET; // trait en losange à la couleur de l'arme (partie entière de la graine)
      a[p + 9] = C0 + w + ((k * 0.37) % 1) * 0.999;
      a[p + 10] = 1;
      a[p + 11] = w === CANNON ? 0.7 : 0.5;
    }
    V.compte[V.LOT.TIRS] = n;
  }
  // nuages de fumée : la nappe au sol (même dessin), pâle et large
  const ac = V.tampon(V.LOT.CONTINUS);
  const ccap = V.capacite(V.LOT.CONTINUS);
  let nc = V.compte[V.LOT.CONTINUS];
  const W = WEAPONS[SMOKE];
  for (let s = 0; s < SCAP && nc < ccap; s++) {
    const alive = smLife[s] > 0;
    if (!alive && !(smFade[s] > 0)) continue;
    if (alive && smAge[s] < W.flightSeconds) continue;
    let f = alive ? (smAge[s] - W.flightSeconds) / W.fadeIn : smFade[s] / W.fadeOut;
    if (f > 1) f = 1;
    const p = nc * STRIDE;
    nc++;
    ac[p] = smX[s];
    ac[p + 1] = W.height;
    ac[p + 2] = smZ[s];
    ac[p + 3] = smR[s];
    ac[p + 4] = 1;
    ac[p + 5] = 0;
    ac[p + 6] = 0;
    ac[p + 7] = 0;
    ac[p + 8] = VFX_STYLE.NAPPE;
    ac[p + 9] = s * 0.618 + 0.31;
    ac[p + 10] = f;
    ac[p + 11] = smR[s] + VFX.nappe.marge;
  }
  V.compte[V.LOT.CONTINUS] = nc;
  syncCannon();
}

/** Tests et ?debug : compteurs et relevés. */
export function inspect(o) {
  o.shots = Array.from(N_SHOTS);
  o.hits = Array.from(N_HITS);
  o.critForced = N_CRIT_FORCED[0];
  o.katanaRange = LASTV[0];
  o.grenadeBlast = LASTV[1];
  o.flashDist = LASTV[2];
  o.flashLine = { x0: FL[0], z0: FL[1], x1: FL[2], z1: FL[3], demiLargeur: FL[4] }; // § E5.U : dernière frappe (départ, arrivée)
  o.hammerRadius = LASTV[3];
  o.shellBlast = LASTV[4];
  o.smokes = LASTV[5];
  o.cannonAlive = LASTV[6];
  o.lastHits = LASTV[7];
  o.lobs = lobCount;
  o.cannon = { x: CN[0], z: CN[1], life: CN[2], age: CN[3] };
  return o;
}

// =====================================================================================================================
// ÉTAPE 3, CHANTIER B (ARCHITECTURE.md § E3.B) — évolutions des armes des arsenaux
// =====================================================================================================================
// Les effets sont dans src/evolutions.js (eventF, onHitF) ; ici, ce qui touche aux pools de ce module : la fumée laissée
// par une grenade évoluée (pool des fumigènes : elle aveugle et ralentit comme eux, puis explose en éclats à sa fin) et
// le 2e canon de la Forteresse (un obus de plus par cible, décalé).
import { EVOLUTIONS } from './config.js';
import { F_X as F_X_E3B, F_Z as F_Z_E3B } from './state.js';
let evo = null;
const EVO_NUAGE = EVOLUTIONS.find((D) => D.weapon === 'grenade');
const EVO_FORT = EVOLUTIONS.find((D) => D.weapon === 'cannon');

/** Grenade évoluée k qui vient d'exploser : une fumée éclot à son point d'impact (déjà au sol, sans vol). */
function evoSmoke(k) {
  const s = takeSmoke();
  smX[s] = lX1[k];
  smZ[s] = lZ1[k];
  smFlyX[s] = lX1[k];
  smFlyZ[s] = lZ1[k];
  smR[s] = effective[GRENADE * STAT_COUNT + STAT.AREA] * EVO_NUAGE.smokeRadiusMul;
  smLife[s] = EVO_NUAGE.smokeSeconds;
  smAge[s] = WEAPONS[SMOKE].flightSeconds; // déjà posée : elle mord dès l'image suivante
  smFade[s] = 0;
  smAcc[s] = 0;
  smokeCount++;
}

/** Forteresse : 2e obus vers (tx, tz), parti du 2e canon (décalé de gap m sur le côté du canon lourd). */
function evoBarrel(mx, mz, tx, tz) {
  const g = EVO_FORT.gap;
  const ox = Math.cos(CN[5]) * g;
  const oz = -Math.sin(CN[5]) * g;
  launch(CANNON, mx + ox, WEAPONS[CANNON].shotHeight, mz + oz, tx + ox * 0.5, tz + oz * 0.5, WEAPONS[CANNON].shellSeconds, WEAPONS[CANNON].shellArc);
}

//#region e5:AD-sons-existants
// § E5.AD (ARCHITECTURE.md) : sons EXISTANTS branchés sur deux moments muets de la Frappe éclair.
//   • prête : CD_READY quand la recharge se termine (cadence pleine, aucun écho en cours) — une fois par recharge ; rien
//     à l'acquisition ni au départ de la partie (FS[FS_PRET] = 1 tant que l'arme n'est pas possédée) ;
//   • touche pressée pendant la recharge (front montant de P.strikeReq) que la mémoire de l'appui
//     (STRIKE_KEYS.bufferSeconds) ne couvrira pas : BUY_DENIED au gain × SONS_EXISTANTS.refusFrappe.gain, au plus un
//     toutes les SONS_EXISTANTS.refusFrappe.ecart s (en plus du minInterval du son).
// Tableaux typés, aucun flottant en argument hors constantes de module, rien d'alloué (§ V).
import { SFX as SFX_AD, SONS_EXISTANTS, STRIKE_KEYS } from './config.js';
const FS = new Float64Array(3);
const FS_PRET = 0; // 1 : prête à l'image précédente (ou arme non possédée)
const FS_REQ = 1; // P.strikeReq à l'image précédente
const FS_REFUS = 2; // horloge du dernier refus joué (S[S_CLOCK])
const REFUS_GAIN = SONS_EXISTANTS.refusFrappe.gain;
const REFUS_ECART = SONS_EXISTANTS.refusFrappe.ecart;
const MEMOIRE_APPUI = STRIKE_KEYS.bufferSeconds;
/** Compteurs (tests) : [annonces « prête », refus joués]. */
export const SONS_FRAPPE = new Int32Array(2);

function sonsFrappeReset() {
  FS[FS_PRET] = 1;
  FS[FS_REQ] = 0;
  FS[FS_REFUS] = -1e9;
  SONS_FRAPPE.fill(0);
}

function sonsFrappe() {
  const req = P.strikeReq;
  if (owned[FLASH] === 1 && fireAccW !== null) {
    const acc = fireAccW[FLASH];
    const pret = flPending === 0 && acc >= 1 ? 1 : 0;
    if (pret === 1 && FS[FS_PRET] === 0) {
      audio.play(SFX_AD.CD_READY);
      SONS_FRAPPE[0]++;
    } else if (pret === 0 && req > FS[FS_REQ] && acc + effective[FLASH * STAT_COUNT + STAT.RATE] * MEMOIRE_APPUI < 1 && S[S_CLOCK] - FS[FS_REFUS] >= REFUS_ECART) {
      FS[FS_REFUS] = S[S_CLOCK];
      audio.playGain(SFX_AD.BUY_DENIED, REFUS_GAIN);
      SONS_FRAPPE[1]++;
    }
    FS[FS_PRET] = pret;
  } else FS[FS_PRET] = 1;
  FS[FS_REQ] = req;
}
//#endregion e5:AD-sons-existants
