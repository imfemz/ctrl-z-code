// FONDATION : damage.js — pipeline de dégâts dans les deux sens, mises à mort, explosions
// (contrat : ARCHITECTURE.md § H). Tout dégât passe ici : personne d'autre n'écrit E.hp ni P.hp (hors soins).
import {
  CAPS,
  DAMAGE,
  DMG,
  DMG_SOURCE_COUNT,
  DMG_SRC,
  EFLAG,
  ENEMIES,
  ENEMY,
  ENEMY_COUNT,
  FX,
  FXK,
  HURT,
  PLAYER,
  SFX,
  SHAKE,
  STATE,
  TRAUMA,
  WEAPON_COUNT,
  isPlayerSource,
} from './config.js';
import { ARGF, E, F_DX, F_DZ, F_SX, F_SZ, F_T, F_V, F_X, F_Z, P, mods, rand, run } from './state.js';
import { ORIGINE_COUP } from './state.js'; // § E5.AK : origine d'un obus (coup mortel)
import { CHESTS, CHEST_FLAG, RARITY } from './config.js'; // § E2.C : coffre de l'élite porteuse ; § E2.G bis : drapeaux
import { AGENT, AGENTS } from './config.js'; // § E2.D : passifs des agents (critique de près, recharge du dash)
import { UTIL } from './config.js'; // § E3.C
const UTIL_COMPUTE = UTIL.COMPUTE;
import * as e3 from './enemies-e3.js'; // § E3.D : scission du diviseur
import * as defis from './defis.js'; // § E4.A : compteurs des succès (robots détruits par type, élites, boss)
import { BOUCLIER } from './config.js'; // § E4.P : bouclier du blindé (impact atténué, fissure à mi-vie)
import { COMBAT_GUIDE } from './config.js'; // § E5.N : anneau d'acier sans bouclier (Femz, 21/11)
import { CAUSE_COUNT } from './config.js'; // § E5.Q (C2) : cause de chaque coup reçu
//#region e5:AJ-equilibrage-aoe
// § E5.AJ : résistance aux dégâts de zone (DMG_ZONE) — boss, blindés, élites ; pas les blindés de l'anneau d'acier.
// Tables lues une fois ; dans hitEnemyF : deux lectures de drapeaux et un multiplicateur constant (aucune allocation).
import { AOE, DMG_ZONE, ENEMY_KEYS } from './config.js';
const ZONE_RES = new Uint8Array(ENEMY_COUNT); // 1 : le type résiste aux coups de zone
for (const k of AOE.types) if (ENEMY_KEYS.indexOf(k) >= 0) ZONE_RES[ENEMY_KEYS.indexOf(k)] = 1;
const ZONE_ELITE = AOE.elites ? EFLAG.ELITE : 0; // drapeau qui rend résistant, quel que soit le type
const ZONE_EXEMPT = AOE.anneauExempte ? EFLAG.WALL : 0; // drapeau qui retire la résistance (anneau d'acier)
const ZONE_MUL = 1 - AOE.resistance; // part des dégâts de zone qui passe (0,2)
/** § E5.AJ : [0] coups de zone portés, [1] coups de zone réduits par la résistance (entiers, tests). */
export const ZONE_N = new Uint32Array(2);
/** § E5.AJ : coup de zone sur le robot i de type t — 1 s'il résiste (compté), 0 sinon. Entiers seulement. */
function zoneF(i, t) {
  ZONE_N[0]++;
  const f = E.flags[i];
  if ((ZONE_RES[t] === 0 && (f & ZONE_ELITE) === 0) || (f & ZONE_EXEMPT) !== 0) return 0;
  ZONE_N[1]++;
  return 1;
}
//#endregion e5:AJ-equilibrage-aoe
const ANNEAU_SANS_BOUCLIER = COMBAT_GUIDE.blinde && COMBAT_GUIDE.blinde.anneauSansBouclier ? EFLAG.WALL : 0;
const BI = BOUCLIER.impact;
const BF = BOUCLIER.fissure;
// gains et vitesses de lecture des sons du bouclier, calculés à l'import (aucun flottant passé en argument, § V) :
// [0] HIT atténué (gain), [1] sa vitesse ; [2] tôle de la fissure (gain), [3] sa vitesse
const FSRC = new Float64Array(2); // § E4.P : source du dernier coup de face (x, z)
const SND = new Float64Array([BI.son, Math.pow(2, BI.demiTons / 12), BF.toleGain, Math.pow(2, BF.toleDemiTons / 12)]);

let ctx = null;
let game = null;
let fx = null;
let audio = null;
let camera = null;
let debug = null;
let enemies = null;
let grid = null;
let pickups = null;
let chests = null; // § E2.C
let boss = null;
let player = null; // § E2.D : « Réflexe » (un critique raccourcit la recharge du dash)
let elites = null; // § E3.A : Phasé, Générateur de bouclier, Instable
let items = null; // § E2.F : objets passifs (crochets au coup, à la mort, au coup reçu)
// § E3.C : utilitaires (Overclocking : dégâts × ; Puissance de calcul : fragments au coup ; chance à la mort) et décors
let utilities = null;
let UMUL = null; // utilities.MUL (lu en ligne : [1] = multiplicateur de dégâts de l'Overclocking)
let ULEFT = null; // utilities.LEFT (secondes restantes par utilitaire à durée)
let props = null;
// § E2.D, « Frappe de l'ombre » : distance (au carré) sous laquelle un robot est « proche » du héros
const CRIT_NEAR_D2 = AGENTS[AGENT.SHINOBI].passive.critNearDist * AGENTS[AGENT.SHINOBI].passive.critNearDist;

// Tables par type, préparées à l'init.
const hasShield = new Uint8Array(ENEMY_COUNT);
const shieldCos = new Float32Array(ENEMY_COUNT); // cos(arcDeg / 2)
const shieldMul = new Float32Array(ENEMY_COUNT);
const shieldMulF = new Float32Array(ENEMY_COUNT); // § E4.P : de face, bouclier fissuré
const shieldSeuil = new Float32Array(ENEMY_COUNT); // § E4.P : part des PV max qui fissure le bouclier
const isBig = new Uint8Array(ENEMY_COUNT);

// Tableau de travail des explosions (explode n'est pas réentrant).
const scratch = new Uint16Array(CAPS.queryScratch);

// Cumuls de la partie. dealt et taken reçoivent des flottants à chaque coup : dans un tableau typé (une variable de
// module qui reçoit un flottant coûte un nombre alloué à chaque écriture, § V ; mesuré à l'intégration).
const SUM = new Float64Array(2);
// Sources dont le coup n'allume qu'un flash adouci (intégration, DAMAGE.softFlashSources).
const SOFT = new Uint8Array(DMG_SOURCE_COUNT);
for (const s of DAMAGE.softFlashSources) SOFT[s] = 1;
const DEALT = 0;
const TAKEN = 1;
let kills = 0;
// Bulles-boucliers (réparateur v2, § E1.B) : dégâts absorbés (flottant : tableau typé), coups entièrement arrêtés, bulles crevées
const ABSORBED = new Float64Array(1);
let bubbleBlocks = 0;
let bubblesBroken = 0;
let batchKills = 0; // § E3.C : robots tués en lot (I.E.M), comptés aussi dans kills
let purged = 0; // robots désintégrés par une purge de fin de vague (jamais comptés dans kills)
let removed = 0; // robots retirés sans bruit (DMG.PURGE | DMG.SILENT : essaim en transit ressorti de l'écran, § E1.C)
let blocked = 0;
let bossBlocks = 0; // coups arrêtés par les drones-boucliers du boss (§ E1.D)
let fissures = 0; // § E4.P : boucliers de blindé fissurés à mi-vie
let crits = 0;
const dealtBySource = new Float64Array(DMG_SOURCE_COUNT);
const hitsBySource = new Int32Array(DMG_SOURCE_COUNT);
export const killsBySource = new Int32Array(DMG_SOURCE_COUNT); // § E3.H : morts par source (coup qui tue dans hitEnemyF) ; § E4.A : exporté, lu par defis

// § E2.C : XP de la gemme de plus d'une élite porteuse, par type (entiers calculés à l'import)
const eliteGemXp = ENEMIES.types.map((T) => Math.round((T.gemXp || 0) * (CHESTS.carrier.xpMul - 1)));

export function init(context) {
  ctx = context;
  game = ctx.game;
  fx = ctx.fx;
  audio = ctx.audio;
  camera = ctx.camera;
  debug = ctx.debug;
  enemies = ctx.enemies;
  grid = ctx.grid;
  pickups = ctx.pickups;
  chests = ctx.chests || null;
  boss = ctx.boss;
  player = ctx.player;
  items = ctx.items || null; // § E2.F
  elites = ctx.elites || null; // § E3.A
  utilities = ctx.utilities || null; // § E3.C
  UMUL = utilities !== null ? utilities.MUL : null;
  ULEFT = utilities !== null ? utilities.LEFT : null;
  props = ctx.props || null;
  evo = ctx.evolutions || null; // § E3.B : évolutions (effets des armes évoluées)
  EVO_ON = evo !== null ? evo.ON : null;
  for (let t = 0; t < ENEMY_COUNT; t++) {
    const T = ENEMIES.types[t];
    if (T.shield) {
      hasShield[t] = 1;
      shieldCos[t] = Math.cos(((T.shield.arcDeg / 2) * Math.PI) / 180);
      shieldMul[t] = T.shield.damageMul;
      shieldMulF[t] = T.shield.damageMulFissure === undefined ? T.shield.damageMul : T.shield.damageMulFissure;
      shieldSeuil[t] = T.shield.seuil === undefined ? 0 : T.shield.seuil;
    }
    isBig[t] = DAMAGE.bigTypes.indexOf(t) >= 0 ? 1 : 0;
  }
}

/** Compteurs de la partie à zéro (appelé par main.resetAll). */
export function reset() {
  SUM[DEALT] = 0;
  SUM[TAKEN] = 0;
  kills = 0;
  purged = 0;
  batchKills = 0;
  removed = 0;
  ABSORBED[0] = 0;
  bubbleBlocks = 0;
  bubblesBroken = 0;
  blocked = 0;
  bossBlocks = 0;
  fissures = 0;
  crits = 0;
  ZONE_N.fill(0); // § E5.AJ
  dealtBySource.fill(0);
  hitsBySource.fill(0);
  killsBySource.fill(0);
  DEGATS_CAUSE.fill(0); // § E5.Q (C2)
  MORT_CAUSE[0] = 0;
  MORT_POS.fill(0); // § E5.AK
  ORIGINE_COUP.fill(0);
}

/** Le type a un bouclier et la source est dans son arc frontal. Source sur le robot : pas d'arrêt. */
export function isShieldedFrom(i, srcX, srcZ) {
  const t = E.type[i];
  if (hasShield[t] === 0) return false;
  const dx = srcX - E.x[i];
  const dz = srcZ - E.z[i];
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) return false;
  const rot = E.rot[i];
  return (dx * Math.sin(rot) + dz * Math.cos(rot)) / d >= shieldCos[t];
}

/**
 * Joueur → robot. Renvoie les dégâts infligés (> 0), 0 si la cible était déjà morte, −1 si le coup a été arrêté
 * par un bouclier. Le recul n'est PAS appliqué ici (§ I.2). Forme d'origine (debug, appels rares) : les appels par
 * coup passent par hitEnemyF (registre ARGF, § Z nonies).
 */
export function hitEnemy(i, amount, source, flags, srcX, srcZ) {
  ARGF[F_V] = amount;
  ARGF[F_SX] = srcX;
  ARGF[F_SZ] = srcZ;
  const r = hitEnemyF(i, source, flags);
  return r > 0 ? LAST[0] : r;
}

/** Montant du dernier coup porté par hitEnemyF (> 0 quand elle a rendu 1). */
export const LAST = new Float64Array(1);

/**
 * hitEnemy sans flottant en argument : dégâts dans ARGF[F_V], source du coup dans ARGF[F_SX], ARGF[F_SZ]. Rend un
 * entier (jamais emballé) : 1 si des dégâts ont été infligés (montant dans LAST[0]), 0 si la cible était déjà morte
 * (ou dégâts nuls), −1 si un bouclier a arrêté le coup.
 */
export function hitEnemyF(i, source, flags) {
  let amount = ARGF[F_V];
  const srcX = ARGF[F_SX];
  const srcZ = ARGF[F_SZ];
  // 1. garde
  if (E.alive[i] === 0) return 0;
  if (E.sus[i] !== 0) return 0; // § E3.K : robot reporté en veille entre deux vagues — intouchable
  const x = E.x[i];
  const z = E.z[i];
  const t = E.type[i];
  // 1 bis. boss protégé par ses drones-boucliers (§ E1.D) : rien ne passe tant qu'il en reste un (fonction à part :
  // le corps de hitEnemyF, appelé à chaque coup, garde sa taille)
  if (t === ENEMY.BOSS && E.bossShield > 0) return blockBossF(i, flags);
  // 1 ter. élites à modificateurs (§ E3.A) : Phasé en phase → coup ignoré, sans chiffre ni son ; robot dans la bulle
  // d'un Générateur de bouclier → dégâts × ELITES.mods[BOUCLIER].damageMul
  if (elites !== null && elites.ACTIVE[0] > 0) {
    const em = elites.damageMulF(i);
    if (em === 0) return 0;
    if (em === 2) amount *= elites.SHIELD_MUL;
  }
  // 2. bouclier (isShieldedFrom écrit en ligne : aucun flottant passé). § E4.P : de face, le coup est RÉDUIT
  // (× shieldMul, × shieldMulF une fois le bouclier fissuré) ; son retour (impact atténué) remplace celui de l'étape 7.
  let front = 0;
  if (hasShield[t] === 1 && (flags & DMG.BYPASS_SHIELD) === 0 && (E.flags[i] & ANNEAU_SANS_BOUCLIER) === 0) { // § E5.N : anneau d'acier sans bouclier
    const dx = srcX - x;
    const dz = srcZ - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const rot = E.rot[i];
    if (d >= 1e-6 && (dx * Math.sin(rot) + dz * Math.cos(rot)) / d >= shieldCos[t]) {
      blocked++;
      front = 1;
      FSRC[0] = srcX; // source du coup, relue par frontImpactF (aucun flottant passé en argument, § V)
      FSRC[1] = srcZ;
      const m = E.fis[i] === 0 ? shieldMul[t] : shieldMulF[t];
      if (m === 0) return frontBlockF(i, flags);
      amount *= m;
    }
  }
  // 2 bis. § E3.C : Overclocking (dégâts × UMUL[1] pendant sa durée ; 1 sinon) — coups du joueur seulement
  if (UMUL !== null && isPlayerSource(source)) amount *= UMUL[1];
  // 2 ter. § E5.AJ : coup de zone sur un boss, un blindé ou une élite (hors anneau d'acier) → × ZONE_MUL (test à part,
  // zoneF, qui rend un entier : le corps de hitEnemyF garde sa taille — grossi, V8 ne l'optimisait plus, § E2 bulle)
  if ((flags & DMG_ZONE) !== 0 && zoneF(i, t) === 1) amount *= ZONE_MUL;
  // 3. critique
  let crit = false;
  if ((flags & DMG.NO_CRIT) === 0 && debug.isCritEnabled()) {
    // § E2.D : « Frappe de l'ombre » (+ mods.critNear sur un robot proche du héros), « Réflexe » (dash rechargé plus vite)
    const near = mods.critNear > 0 && (x - P.x) * (x - P.x) + (z - P.z) * (z - P.z) < CRIT_NEAR_D2;
    if (rand() < PLAYER.critChance + mods.critChanceAdd + (near ? mods.critNear : 0)) {
      amount *= PLAYER.critMul + mods.critMulAdd; // § E2.F : Viseur thermique
      crit = true;
      crits++;
      if (mods.critDashCut > 0) player.critDashCutF();
    }
  }
  // 3 bis. bulle-bouclier (réparateur v2, § E1.B) : elle absorbe d'abord ; tant qu'elle tient, les PV ne bougent pas.
  // Dans une fonction à part (absorbF) : le corps de hitEnemyF, appelé à chaque coup, garde sa taille d'avant.
  if (E.shield[i] > 0) {
    ARGF[F_V] = amount;
    ARGF[F_SX] = srcX;
    ARGF[F_SZ] = srcZ;
    if (absorbF(i, flags) === 1) return -1;
    amount = ARGF[F_V];
  }
  // 4. PV
  E.hp[i] -= amount;
  SUM[DEALT] += amount;
  dealtBySource[source] += amount;
  hitsBySource[source]++;
  // § E3.C : Puissance de calcul — un coup porté crédite des fragments (plafond par seconde dans utilities)
  if (ULEFT !== null && ULEFT[UTIL_COMPUTE] > 0 && isPlayerSource(source)) utilities.moneyOnHitF();
  // 4 bis. objets passifs « au coup » (§ E2.F) : ils n'écrivent que leur file — un coup né d'un objet (DMG.PROC) n'en
  // déclenche aucun. Le montant du coup est lu dans LAST[0] (aucun flottant passé).
  if (items !== null && (flags & DMG.PROC) === 0) {
    LAST[0] = amount;
    items.onHitF(i, source, crit ? 1 : 0);
  }
  // 5. flash (E.flash : 1 → 0 en FX.flash.seconds, § H.1). Intégration : un robot qui flashe déjà, ou qui sort d'un
  // flash (E.flashRest > 0 : pause FX.flash.rest), n'est pas rallumé — sinon une horde sous six armes restait blanche ;
  // une source de DAMAGE.softFlashSources (EMP) n'allume qu'un flash adouci (DAMAGE.softFlash) ; § E4.P : un coup de face
  // atténué par le bouclier d'un blindé aussi.
  if (E.flashRest[i] === 0) {
    const fl = E.flash[i];
    if (SOFT[source] === 0 && front === 0) {
      if (fl === 0) E.flash[i] = 1;
    } else if (fl < DAMAGE.softFlash) E.flash[i] = DAMAGE.softFlash;
  }
  // 5 bis. § E4.P : le bouclier se fissure UNE fois, au coup qui fait passer les PV sous seuil × PV max (robot en vie)
  if (hasShield[t] === 1 && E.fis[i] === 0 && E.hp[i] > 0 && E.hp[i] <= shieldSeuil[t] * E.maxHp[i]) fissureF(i, flags);
  // 6. chiffre
  if ((flags & DMG.NO_NUMBER) === 0 && amount >= DAMAGE.minNumber) {
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    ARGF[F_V] = amount;
    fx.spawnDamageNumberF(crit);
  }
  // 7. son et étincelle (§ E4.P : coup de face sur un bouclier → impact atténué, écrit à part)
  if ((flags & (DMG.SILENT | DMG.NO_IMPACT)) === 0) {
    if (front === 0) {
      ARGF[F_X] = x;
      ARGF[F_Z] = z;
      audio.playF(SFX.HIT);
      ARGF[F_X] = x;
      ARGF[F_Z] = z;
      fx.spawnImpactF(source);
    } else frontImpactF(i);
  }
  // 8. mort
  if (E.hp[i] <= 0) {
    ARGF[F_DX] = x - srcX;
    ARGF[F_DZ] = z - srcZ;
    if (E.alive[i] !== 0 && (flags & DMG.PURGE) === 0) killsBySource[source]++; // § E3.H
    killEnemyF(i, flags);
  }
  // 9. § E3.B : arme évoluée — son effet (file et pool d'evolutions ; jamais pour un coup né d'un effet : DMG.PROC)
  if (EVO_ON !== null && EVO_ON[source] !== 0 && (flags & DMG.PROC) === 0) {
    LAST[0] = amount;
    evo.onHitF(i, source, crit ? 1 : 0);
  }
  LAST[0] = amount;
  return amount > 0 ? 1 + front : 0; // § E4.P : 2 = coup de face atténué par un bouclier (le projectile s'y arrête)
}

/**
 * § E4.P : coup de face sur le bouclier d'un blindé, multiplicateur nul (réglage damageMul = 0, l'ancienne règle) :
 * arrêté, ricochet et SHIELD_BLOCK comme avant. Rend −1.
 */
function frontBlockF(i, flags) {
  if ((flags & (DMG.SILENT | DMG.NO_IMPACT)) === 0) {
    const x = E.x[i];
    const z = E.z[i];
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    ARGF[F_DX] = ARGF[F_SX] - x;
    ARGF[F_DZ] = ARGF[F_SZ] - z;
    fx.spawnShieldSparkF();
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    audio.playF(SFX.SHIELD_BLOCK);
  }
  return -1;
}

/**
 * § E4.P : impact atténué d'un coup de face sur un bouclier (remplace l'étape 7) : petite gerbe d'acier au bord du
 * bouclier côté source, son HIT plus bas et plus grave. Source du coup : FSRC (écrite à l'étape 2 de hitEnemyF).
 */
function frontImpactF(i) {
  const x = E.x[i];
  const z = E.z[i];
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  ARGF[F_DX] = FSRC[0] - x;
  ARGF[F_DZ] = FSRC[1] - z;
  fx.spawnShieldDampF();
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  ARGF[F_V] = SND[0];
  ARGF[F_T] = SND[1];
  audio.playGainRateF(SFX.HIT);
}

/**
 * § E4.P : le bouclier du robot i se fissure (une fois) — état « fissuré » du modèle (E.fis → aGait.w, pièce
 * `fissures`), éclats d'acier projetés du bouclier vers la source, son de casse, arrêt sur image, petite secousse.
 */
function fissureF(i, flags) {
  E.fis[i] = 1;
  fissures++;
  if ((flags & DMG.SILENT) !== 0) return;
  const x = E.x[i];
  const z = E.z[i];
  const rot = E.rot[i];
  // éclats : depuis le bouclier (devant le robot), projetés vers l'avant
  ARGF[F_X] = x + Math.sin(rot) * BF.avant;
  ARGF[F_Z] = z + Math.cos(rot) * BF.avant;
  ARGF[F_DX] = Math.sin(rot);
  ARGF[F_DZ] = Math.cos(rot);
  fx.spawnShieldShardsF(E.type[i]);
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  audio.playF(SFX.PROP_BREAK);
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  ARGF[F_V] = SND[2];
  ARGF[F_T] = SND[3];
  audio.playGainRateF(SFX.SHIELD_BLOCK);
  fx.hitstop(BF.arret);
  camera.addTraumaAt(BF.secousse, TRAUMA.KILL, x, z);
}

/**
 * Coup porté au boss i pendant que ses drones-boucliers vivent (§ E1.D) : arrêté. Étincelle de bouclier au bord de
 * son corps, du côté de la source (ARGF[F_SX], ARGF[F_SZ]), et son du bouclier — sauf coup silencieux ou continu.
 * Rend −1, comme un coup arrêté par le bouclier d'un blindé.
 */
function blockBossF(i, flags) {
  if ((flags & (DMG.SILENT | DMG.NO_IMPACT)) !== 0) return -1; // (non compté : coups continus, préchauffage de enemies.warmEventBranches)
  bossBlocks++;
  const x = E.x[i];
  const z = E.z[i];
  const dx = ARGF[F_SX] - x;
  const dz = ARGF[F_SZ] - z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const r = d > 1e-6 ? E.radius[i] / d : 0;
  ARGF[F_X] = x + dx * r;
  ARGF[F_Z] = z + dz * r;
  ARGF[F_DX] = dx;
  ARGF[F_DZ] = dz;
  fx.spawnShieldSparkF();
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  audio.playF(SFX.SHIELD_BLOCK);
  return -1;
}

/**
 * Bulle-bouclier du robot i (E.shield > 0) face à un coup de ARGF[F_V] dégâts venu de (ARGF[F_SX], ARGF[F_SZ]).
 * Rend 1 si la bulle a tout absorbé (étincelle et son du bouclier, sauf coup silencieux ou continu), 0 si elle crève :
 * le reste du coup est alors dans ARGF[F_V].
 */
function absorbF(i, flags) {
  const amount = ARGF[F_V];
  const srcX = ARGF[F_SX];
  const srcZ = ARGF[F_SZ];
  const bubble = E.shield[i];
  if (amount < bubble) {
    E.shield[i] = bubble - amount;
    ABSORBED[0] += amount;
    bubbleBlocks++;
    if ((flags & (DMG.SILENT | DMG.NO_IMPACT)) === 0) {
      const x = E.x[i];
      const z = E.z[i];
      ARGF[F_X] = x;
      ARGF[F_Z] = z;
      ARGF[F_DX] = srcX - x;
      ARGF[F_DZ] = srcZ - z;
      fx.spawnShieldSparkF();
      ARGF[F_X] = x;
      ARGF[F_Z] = z;
      audio.playF(SFX.SHIELD_BLOCK);
    }
    return 1;
  }
  // la bulle crève : le reste du coup passe
  E.shield[i] = 0;
  E.rev1[i] = 0;
  ABSORBED[0] += bubble;
  bubblesBroken++;
  ARGF[F_V] = amount - bubble;
  return 0;
}

/** Mise à mort (étape 8 de hitEnemy, F1, kamikaze, sbires). (dirX, dirZ) : direction du coup, non normalisée. */
export function killEnemy(i, flags, dirX = 0, dirZ = 0) {
  ARGF[F_DX] = dirX;
  ARGF[F_DZ] = dirZ;
  killEnemyF(i, flags);
}

/** killEnemy sans flottant en argument : direction du coup dans ARGF[F_DX], ARGF[F_DZ] (§ Z nonies). */
export function killEnemyF(i, flags) {
  const dirX = ARGF[F_DX];
  const dirZ = ARGF[F_DZ];
  // 0. garde : un robot ne meurt qu'une fois
  if (E.alive[i] === 0) return;
  const t = E.type[i];
  const x = E.x[i];
  const z = E.z[i];
  // 1.
  E.alive[i] = 0;
  E.hp[i] = 0;
  E.aliveCount--;
  E.aliveByType[t]--;
  // 1 bis. drone-bouclier du boss (§ E1.D) : le bouclier tombe dans l'image où meurt le dernier (boss.update recompte ensuite)
  if ((E.flags[i] & EFLAG.SHIELD_DRONE) !== 0 && E.bossShield > 0) E.bossShield--;
  // 2. (purge de fin de vague, § E1.A : le robot n'est pas un kill du joueur)
  const purge = (flags & DMG.PURGE) !== 0;
  if (!purge) {
    run.kills++;
    kills++;
    defis.onKillF(t, E.flags[i]); // § E4.A : par type, élite, boss (entiers)
  }
  // 3. boss
  if (t === ENEMY.BOSS) {
    E.bossIndex = -1;
    boss.onDeath(i, purge ? flags | DMG.SILENT | DMG.NO_LOOT : flags);
    return;
  }
  if (purge) {
    // retrait sans bruit (§ E1.C : drone d'un essaim ressorti de l'écran) : aucun effet, compté à part
    if ((flags & DMG.SILENT) !== 0) {
      removed++;
      return;
    }
    // désintégration : voxels de purge seulement — ni butin, ni secousse, ni son par robot, ni hitstop
    purged++;
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    fx.spawnPurgeF(t);
    // § E2.C règle 4 : une porteuse purgée au chrono lâche quand même son coffre si le joueur est en retard sur le
    // calendrier d'armes (sinon le coffre est perdu)
    if ((E.flags[i] & EFLAG.ELITE) !== 0 && chests !== null && CHESTS.carrier.lateDrop && chests.isLate()) chests.dropAt(x, z, E.rarity[i], CHEST_FLAG.EXACT | CHEST_FLAG.KEEP); // § E2.G bis : rareté de la porteuse, gardé en fin de vague ; § E2.S S1 : retard = chests.isLate()
    return;
  }
  const silent = (flags & DMG.SILENT) !== 0;
  // 4. éclats
  if (!silent) fx.spawnDebris(x, z, t, dirX, dirZ);
  // 5. butin (EFLAG.NO_LOOT : robot de complément d'une prolongation, § E1.A règle 8)
  if ((flags & DMG.NO_LOOT) === 0 && (E.flags[i] & EFLAG.NO_LOOT) === 0) pickups.dropLoot(x, z, t);
  // 5 bis. élite porteuse (§ E2.C règle 4) : son coffre, et ses gemmes × xpMul (une grosse gemme de plus). Pas de
  // coffre pour une mort sans butin (DMG.NO_LOOT : nettoyage du debug, F1, sbires à la mort du boss).
  if ((E.flags[i] & EFLAG.ELITE) !== 0 && chests !== null && (flags & DMG.NO_LOOT) === 0) {
    pickups.spawnGem(x, z, eliteGemXp[t]);
    chests.dropAt(x, z, E.rarity[i], CHEST_FLAG.EXACT); // § E2.G bis G2 : lots tous de la rareté de la porteuse
  }
  // 5 ter. objets passifs « à la mort » (§ E2.F) : jamais pour une mort causée par un objet (DMG.PROC) ni silencieuse
  if (items !== null && !silent && (flags & DMG.PROC) === 0) items.onKillF(i);
  // 5 quater. § E3.C : petite chance d'utilitaire (mort avec butin seulement : ni purge, ni NO_LOOT, ni complément)
  if (utilities !== null && (flags & DMG.NO_LOOT) === 0 && (E.flags[i] & EFLAG.NO_LOOT) === 0) utilities.rollOnKillF(i);
  if (!silent) {
    // 6. secousse et son
    camera.addTrauma(isBig[t] === 1 ? SHAKE.amounts.killBig : SHAKE.amounts.kill, TRAUMA.KILL);
    audio.play(SFX.ROBOT_DEATH, x, z);
    // 7. hitstop
    if (isBig[t] === 1 || (flags & DMG.HEAVY) !== 0) fx.hitstop();
    // 8. drone v3 (§ E1.B) : il laisse une flaque électrique (en dernier : l'appel réécrit ARGF)
    if (t === ENEMY.DRONE) enemies.dronePuddleF(i);
    // 9. élite Instable (§ E3.A) : obus en couronne (l'appel réécrit ARGF)
    if (elites !== null && E.mod[i] !== 0) elites.onKillF(i);
    // 9. § E3.D : le diviseur (et ses mini-rôdeurs de génération 1) se scinde — jamais pour une mort sans butin
    // (nettoyage, sbires à la mort du boss) ; en dernier : l'appel réécrit ARGF
    if ((flags & DMG.NO_LOOT) === 0 && (t === ENEMY.DIVISEUR || E.gen[i] === 1)) e3.onDeathF(i);
  }
}

/** § E5.L : coups reçus depuis le chargement de la page (entier, jamais remis à 0 ; lu par src/consignes.js). */
export const COUPS_RECUS = new Uint32Array(1);

/** § E5.B : source (x, z) du dernier coup reçu par le joueur après les gardes (tableau typé, lu par src/vfx/dome-parefeu.js). */
export const SOURCE_JOUEUR = new Float64Array(2);

//#region e5:Q-retours-guide
/** § E5.Q (C2) : PV RÉELLEMENT perdus par cause de la partie (CAUSE.*), et cause du coup mortel (0 = aucune). */
export const DEGATS_CAUSE = new Float64Array(CAUSE_COUNT);
export const MORT_CAUSE = new Uint8Array(1);
//#endregion e5:Q-retours-guide
//#region e5:AK-mort-claire
/** § E5.AK : d'où est venu le coup mortel (x, z) — origine écrite par l'auteur (state.ORIGINE_COUP), sinon le point du coup. */
export const MORT_POS = new Float64Array(2);
//#endregion e5:AK-mort-claire

/**
 * Robot → joueur. amount contient déjà le multiplicateur de vague. Renvoie les dégâts du coup s'il a porté, 0 sinon.
 * § E5.Q (C2) : cause = CAUSE.* (entier : robot + attaque), comptée dans DEGATS_CAUSE et retenue si le coup tue.
 */
export function hitPlayer(amount, kind, srcX, srcZ, cause = 0) {
  // 1. gardes
  const s = game.state;
  if (s !== STATE.PLAYING && s !== STATE.WAVE_CLEAR && s !== STATE.COUNTDOWN) return 0;
  if (!P.alive || P.dashT > 0 || P.invulnT > 0) return 0;
  // 2. armure
  amount *= mods.damageTakenMul;
  // § E5.B : source du coup, lue par le dôme du Pare-feu (point d'impact de son onde) ; aucune règle n'en dépend
  SOURCE_JOUEUR[0] = srcX;
  SOURCE_JOUEUR[1] = srcZ;
  // 2 bis. objets passifs (§ E2.F) : coup mortel et Sauvegarde armée — le coup est annulé (0) ; § E5.X : Pare-feu
  // chargé — le coup est encaissé par le bouclier, aucun PV perdu, mais il « porte » pour l'attaquant (rend amount > 0 :
  // recharge du contact, tir consommé, une charge de boss ne frappe qu'une fois)
  if (items !== null) {
    const r = items.onPlayerHitF(amount);
    if (r === 2) return amount;
    if (r === 1) return 0;
  }
  // 3. PV ; § E5.Q (C2) : PV réellement perdus (bornés aux PV restants) comptés pour la cause
  const c = cause > 0 && cause < CAUSE_COUNT ? cause : 0;
  DEGATS_CAUSE[c] += amount < P.hp ? amount : P.hp > 0 ? P.hp : 0;
  if (!debug.isInvincible()) P.hp -= amount;
  SUM[TAKEN] += amount;
  COUPS_RECUS[0]++; // § E5.L : 1er coup reçu → consigne du dash (src/consignes.js)
  // 4. invulnérabilité
  P.invulnT = PLAYER.hitInvuln;
  // 5. secousse
  camera.addTrauma(SHAKE.amounts.playerHit, TRAUMA.PLAYER_HIT);
  if (kind === HURT.BOSS) camera.punchZoom(SHAKE.punch.bossHit);
  // 6. écran
  fx.flashDamageEdges(FX.edgeFlash.strength);
  fx.playerHit(P.x, P.z, srcX, srcZ); // intégration : la source du coup oriente la gerbe
  // 7. son
  audio.play(SFX.PLAYER_HURT);
  // 8. hitstop
  if (kind === HURT.EXPLOSION || kind === HURT.BOSS) fx.hitstop();
  // 9. mort
  if (P.hp <= 0) {
    P.hp = 0;
    P.alive = false;
    MORT_CAUSE[0] = c; // § E5.Q (C2)
    //#region e5:AK-mort-claire
    MORT_POS[0] = ORIGINE_COUP[2] === 1 ? ORIGINE_COUP[0] : srcX; // § E5.AK : d'où il est venu (obus : là d'où il est parti)
    MORT_POS[1] = ORIGINE_COUP[2] === 1 ? ORIGINE_COUP[1] : srcZ;
    //#endregion e5:AK-mort-claire
    fx.spawnExplosion(P.x, P.z, 3, FXK.PLAYER_DEATH);
  }
  return amount;
}

/** Debug seulement : mort immédiate, sans passer par les gardes. */
export function killPlayer() {
  if (!P.alive) return;
  P.hp = 0;
  P.alive = false;
  fx.spawnExplosion(P.x, P.z, 3, FXK.PLAYER_DEATH);
}

// explode → souffle : centre, rayon, dégâts, recul de l'explosion en cours (aucun flottant passé en argument)
const EXP = new Float64Array(5);

/** Un robot dans le rayon d'une explosion : dégâts atténués au bord, recul. Rend 1 s'il a été touché. */
function souffle(i, source, flags) {
  const x = EXP[0];
  const z = EXP[1];
  const radius = EXP[2];
  const knockback = EXP[4];
  const dx = E.x[i] - x;
  const dz = E.z[i] - z;
  const d = Math.sqrt(dx * dx + dz * dz);
  let f = radius > 0 ? d / radius : 1;
  if (f > 1) f = 1;
  ARGF[F_V] = EXP[3] * (1 - (1 - DAMAGE.explosionEdgeFactor) * f);
  ARGF[F_SX] = x;
  ARGF[F_SZ] = z;
  if (hitEnemyF(i, source, flags) <= 0) return 0;
  if (knockback > 0 && d > 1e-6) {
    ARGF[F_DX] = dx / d;
    ARGF[F_DZ] = dz / d;
    ARGF[F_V] = knockback;
    enemies.applyKnockbackF(i);
  }
  return 1;
}

/**
 * Point d'entrée unique de toute explosion. Renvoie le nombre de robots touchés. Non réentrant.
 */
export function explode(x, z, radius, enemyDamage, playerDamage, source, flags, fxKind, trauma, punch, knockback = 0, spareType = -1, cause = 0) {
  let touched = 0;
  // 1. robots
  if (enemyDamage > 0) {
    const zf = flags | DMG_ZONE; // § E5.AJ : toute explosion est de zone
    const n = grid.queryCircle(x, z, radius, scratch, scratch.length);
    // un appel PAR ROBOT (souffle) : explode ne part que quelques fois par seconde et reste longtemps en code de base,
    // où chaque flottant de la boucle était emballé (≈ 600 o/image relevés en charge maximale, § Z nonies)
    EXP[0] = x;
    EXP[1] = z;
    EXP[2] = radius;
    EXP[3] = enemyDamage;
    EXP[4] = knockback;
    for (let k = 0; k < n; k++) {
      const i = scratch[k];
      if (E.alive[i] === 0 || E.type[i] === spareType) continue; // spareType : type épargné (kamikazes entre eux)
      touched += souffle(i, source, zf);
    }
  }
  // 2. joueur : dans la zone, il prend tout
  if (playerDamage > 0) {
    const dx = P.x - x;
    const dz = P.z - z;
    const rr = radius + P.rayonDegats; // § E5.N (B5) : rayon de dégâts du héros (était P.radius)
    if (dx * dx + dz * dz < rr * rr) hitPlayer(playerDamage, source === DMG_SRC.BOSS ? HURT.BOSS : HURT.EXPLOSION, x, z, cause); // § E5.Q : cause du souffle
  }
  // 3. secousse et punch : le punch suit exactement la secousse accordée
  if (trauma > 0) {
    const granted = camera.addTraumaAt(trauma, isPlayerSource(source) ? TRAUMA.PLAYER_EXPLOSION : TRAUMA.ENEMY_EXPLOSION, x, z);
    if (punch !== 0 && granted > 0) camera.punchZoom((punch * granted) / trauma);
  }
  // 3 bis. § E3.C : les décors cassables dans le souffle d'une explosion du joueur prennent un coup
  if (props !== null && isPlayerSource(source)) {
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    props.hitAtF(radius);
  }
  // 4. effets
  if ((flags & DMG.SILENT) === 0) {
    fx.spawnExplosion(x, z, radius, fxKind);
    audio.play(source === DMG_SRC.BOSS ? SFX.EXPLOSION_BIG : SFX.EXPLOSION, x, z);
  }
  return touched;
}

/**
 * § E3.C — mort en lot (I.E.M) : les n robots de list meurent dans l'image comme dans la purge (§ E3.0.5 règle 1) —
 * voxels « programmes » réglés une fois par fx.beginPurge(n), ni son ni secousse ni hitstop par robot — mais ce sont
 * des kills du joueur ; seuls les lootMax premiers lâchent leur butin. Jamais le boss ni une élite (l'appelant les
 * écarte ; gardés ici aussi). Aucun objet « à la mort », aucun utilitaire. Rend le nombre de robots tués.
 */
export function killBatchF(list, n, lootMax) {
  if (n <= 0) return 0;
  fx.beginPurge(n);
  let dead = 0;
  for (let k = 0; k < n; k++) {
    const i = list[k];
    if (E.alive[i] === 0) continue;
    if (E.sus[i] !== 0) continue; // § E3.K × E3.C (fusion du groupe 1) : un reporté en veille est intouchable, I.E.M comprise
    const t = E.type[i];
    if (t === ENEMY.BOSS || (E.flags[i] & EFLAG.ELITE) !== 0) continue;
    const x = E.x[i];
    const z = E.z[i];
    E.alive[i] = 0;
    E.hp[i] = 0;
    E.aliveCount--;
    E.aliveByType[t]--;
    if ((E.flags[i] & EFLAG.SHIELD_DRONE) !== 0 && E.bossShield > 0) E.bossShield--;
    run.kills++;
    kills++;
    batchKills++;
    defis.onKillF(t, 0); // § E4.A (jamais une élite ni le boss ici)
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    fx.spawnPurgeF(t);
    if (dead < lootMax && (E.flags[i] & EFLAG.NO_LOOT) === 0) pickups.dropLoot(x, z, t);
    dead++;
  }
  return dead;
}

/**
 * § E4.C : bilan de la partie, sans allocation. outDealt (Float64Array) et outKills (Int32Array) de DMG_SOURCE_COUNT
 * cases, fournis par l'appelant, reçoivent dealtBySource et killsBySource. Rend la somme des dégâts des sources du joueur.
 */
export function bilan(outDealt, outKills) {
  let total = 0;
  for (let s = 0; s < DMG_SOURCE_COUNT; s++) {
    outDealt[s] = dealtBySource[s];
    outKills[s] = killsBySource[s];
    if (isPlayerSource(s)) total += dealtBySource[s];
  }
  return total;
}

/** § E4.C : robots tués en lot par l'I.E.M (comptés dans la ligne « Utilitaires » du bilan). */
export function batchKillCount() {
  return batchKills;
}

export function inspect(out) {
  out.batchKills = batchKills; // § E3.C : tués par l'I.E.M (mort en lot)
  out.dealt = SUM[DEALT];
  out.taken = SUM[TAKEN];
  out.kills = kills;
  out.purged = purged;
  out.removed = removed; // retirés sans bruit (§ E1.C), ni kills ni purge
  out.absorbed = ABSORBED[0]; // dégâts absorbés par les bulles-boucliers (§ E1.B)
  out.bubbleBlocks = bubbleBlocks; // coups entièrement arrêtés par une bulle
  out.bubblesBroken = bubblesBroken; // bulles crevées par un coup
  out.blocked = blocked; // § E4.P : coups de face sur un bouclier de blindé (atténués ; arrêtés si damageMul = 0)
  out.fissures = fissures; // § E4.P : boucliers fissurés à mi-vie
  out.bossBlocks = bossBlocks; // coups arrêtés par les drones-boucliers du boss (§ E1.D)
  out.crits = crits;
  out.zoneHits = ZONE_N[0]; // § E5.AJ : coups de zone portés
  out.zoneResisted = ZONE_N[1]; // § E5.AJ : coups de zone réduits par la résistance
  out.dealtBySource = Array.from(dealtBySource);
  out.hitsBySource = Array.from(hitsBySource);
  out.killsBySource = Array.from(killsBySource); // § E3.H
}

// § E3.B : évolutions (lues à init ; null sans le chantier B)
let evo = null;
let EVO_ON = null;
