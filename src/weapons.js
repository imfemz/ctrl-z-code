// LOT : weapons — 6 armes automatiques, modèle des stats et des niveaux, projectiles du joueur
// (contrat : ARCHITECTURE.md § I).
// Modèle [F] de la fondation, inchangé : possession, niveaux, stats effectives, prix (la boutique et l'interface en
// dépendent). Ce lot ajoute les cinq autres armes et leurs projectiles :
//   • disques orbitaux : un coup par passage de disque (E.orbitCd = orbitalHitDelay), contournent le bouclier ;
//   • fusil à pompe    : cône de plombs vers le groupe le plus fourni, recul = stat spéciale ;
//   • champ EMP        : aura qui touche et ralentit TOUS les robots du rayon, plus des arcs au-delà ;
//   • fusil à rail     : rayons perforants vers les robots qui ont le plus de PV (gros coup : DMG.HEAVY) ;
//   • roquettes        : une par paquet de robots (grid.findDensest), explosion par damage.explode.
// Rien n'est alloué après init : pools en tableaux typés, instances écrites en ligne (§ V).
// Dessin (étape « vfx », ARCHITECTURE.md § Z septies) : plus aucun maillage ici. Les projectiles sont dessinés par les
// lots de src/vfx/projectiles.js (style « Toon », prototype validé par Femz) : sync écrit les tirs droits et les têtes de
// roquette dans le lot TIRS, les disques, l'aura et l'orbe de l'EMP dans CONTINUS ; les naissances (impact figé,
// salve du rail, segment d'arc, arrivée d'une roquette) deviennent des événements datés au moment même où le jeu les
// crée ; chaque roquette tient un emplacement de traînée (pSlot). Plus de bouffées de traînée (fx.spawnPuff) ni
// d'anneau de fx à l'impulsion de l'EMP : les traînées du lot TRAINES et l'onde de l'aura les remplacent.
import {
  CAPS,
  DMG,
  EFLAG,
  ENEMIES,
  ENEMY,
  FXK,
  GRID,
  LOOP,
  MODELES,
  SFX,
  SHOP,
  STAT,
  STAT_COUNT,
  STAT_KEYS,
  STAT_MAX_LEVEL,
  TRAUMA,
  WEAPON,
  WEAPON_COSTS,
  WEAPON_COUNT,
  WEAPON_KEYS,
  RECHARGES, // § E3.H
  WEAPONS,
  VFX,
  VFX_STYLE,
  EMP_VISU, // § E5.EMP : variantes visuelles du champ
  orbitalHitDelay,
  upgradeCost,
  upgradePrice,
} from './config.js';
import { ARGF, E, F_DX, F_DZ, F_SX, F_SZ, F_T, F_V, P, PRIO, mods, rand } from './state.js';
import { SOIN_HEROS, SOIN_SIGNAUX } from './state.js'; // § E5.Q (B14) : la bulle du Bastion soigne le héros (retour propre, src/soin-heros.js)
import * as V from './vfx/projectiles.js';
import { chargerPieces } from './anim/pieces.js';
import { appliquerTexturesArmes } from './rendu/materiaux.js'; // § E5.T : tourelle posée = Sentinelle de l'agent, atlas partagé des armes
import { TACHES as TACHES_CONTACT } from './rendu/ombres-contact.js'; // § E5.T : ombre de contact des tourelles posées
import { agentSignature } from './config.js'; // § E2.D : l'arme de départ est la signature de l'agent
import { run as __run } from './state.js';
import { F_X as F_X_E3C, F_Z as F_Z_E3C } from './state.js'; // § E3.C : tirs contre les décors cassables
// Armes portées par le héros (étape « animations », § Z sexies) : visée des bras, départ des tirs depuis les bouches,
// cibles des armes de bras DANS le cône du buste, tourelles d'épaule. `__A` = l'interface de src/anim/armes-heros.js,
// appelée exactement comme les patches de tests/anim/gen-weapons.mjs (prototype validé par Femz le 13/11).
import { api as __A } from './anim/armes-heros.js';
// Étape 3, chantier N (§ E3.N) : les six armes des arsenaux du Shinobi et du Bastion (katana … marteau)
import * as WA from './weapons-agents.js';
import { armesCoupees } from './anim/coup-pied.js'; // § E4.O.3 : armes coupées pendant le coup de pied
import { vuArme } from './defis.js'; // § E4.A : Collection (armes obtenues)
import * as CB from './anim/combos.js'; // § E3.M : gestes des coups de lame et des poses de tourelle
import * as PG from './poings.js'; // § E5.F : coups de poing du Bastion (attaque de base)
import { COMBO_ATTAQUE } from './config.js'; // § E5.F : une attaque = le combo entier
import { TOURELLES_BOSS } from './config.js'; // § E5.F : tourelles du Bastion, le boss d'abord
import { AGENT, ANNEAU_SOIN } from './config.js'; // § E5.F : anneau des tourelles, soin du Bastion sous 20 % de ses PV
export const ATT_GAP = new Float64Array(1); // § E5.F : s avant le prochain combo de la lame (§ E5.E.7 : lu par le HUD, ctx)
const ATT_F = new Float64Array([1]); // § E5.F : facteur de dégâts par geste de la lame (DPS d'avant gardé)
import { COMBO, COMBOS as CB_CFG, GESTE as CB_GESTE } from './config.js';
import { ENEMY_COUNT, REPARATEUR_VOL } from './config.js'; // § E5.D : réparateurs volants (cible prioritaire, tirs aériens)

let ctx = null;
let grid = null;
let damage = null;
let props = null; // § E3.C : décors cassables (un tir qui passe sur une borne lui porte un coup), null sans le chantier C
let enemies = null;
let audio = null;
let camera = null;
let world = null;
let render = null;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
// Grille spatiale : les tirs droits lisent les tableaux bruts de grid.js (§ F) pour balayer leur segment sans appel.
const GRID_MIN = GRID.min;
const GRID_INV = 1 / GRID.cellSize;
const GRID_DIM = GRID.dim;
const GRID_LAST = GRID.dim - 1;
// Plus grand rayon de TYPE d'un robot rangé dans la grille (le boss n'y est pas) : plancher de la marge des cellules à
// lire autour d'un tir. updateProjectiles prend le plus grand des deux entre ce plancher et grid.getMaxRadius(), le
// plus grand rayon VIVANT : si un lot agrandit un robot au-delà de son type, le balayage en ligne le trouve comme le
// trouverait grid.querySegment.
let sweepMargin = 0;
for (let t = 0; t < ENEMIES.types.length; t++) if (t !== ENEMY.BOSS && ENEMIES.types[t].radius > sweepMargin) sweepMargin = ENEMIES.types[t].radius;

// ----- Modèle (lecture seule hors de ce module) --------------------------------------------------------------------
export const owned = new Uint8Array(WEAPON_COUNT);
export const levels = new Uint8Array(WEAPON_COUNT * STAT_COUNT); // indice w × 5 + s ; 0 si non possédée
// Surcharge (§ E1.D) : crans achetés par arme une fois au niveau 21 ; dégâts × (1 + SHOP.overcharge.damagePerLevel × cran), sans limite.
export const overcharge = new Uint16Array(WEAPON_COUNT);
// Emplacements d'armes (§ E2.C) : identifiants des armes possédées dans l'ORDRE D'OBTENTION, −1 = vide. Une arme donnée
// par le debug au-delà des emplacements (charge maximale des tests) est possédée sans emplacement.
export const SLOT_CAP = 6; // = CHESTS.weaponSlots (config.js, région e2:C ; contrôlé par tests/e2-coffres.test.mjs)
export const slots = new Int8Array(SLOT_CAP).fill(-1);
export let slotCount = 0;
const OVERCHARGE_STEP = SHOP.overcharge.damagePerLevel;
const F_PRIORITY = EFLAG.PRIORITY;
const PRIO_S = new Float64Array(1); // portée de l'arme qui cherche une cible prioritaire (aucun flottant en argument, § V)

const effective = new Float32Array(WEAPON_COUNT * STAT_COUNT);
let dirty = true;
const shots = new Int32Array(WEAPON_COUNT); // déclenchements depuis le reset
// t += dt × cadence ; tire tant que t ≥ 1 (LOOP.maxShotsPerFrame par image au plus). Exporté (lecture seule) : pré-visée
// des bras du héros (src/anim/armes-heros.js).
export const fireAcc = new Float32Array(WEAPON_COUNT);
const flagsOf = new Uint8Array(WEAPON_COUNT); // drapeaux DMG.* que chaque arme passe à hitEnemy (§ I.2), préparés à l'init
// 1 si les cinq stats effectives de l'arme sont des nombres finis ≥ 0 (relevé à chaque update et à chaque sync). Un
// bonus passif non fini — une erreur dans un autre module — rendrait NaN la cadence, la portée ou les dégâts : l'arme
// se tait tant que la valeur n'est pas redevenue saine, au lieu d'écrire NaN dans son accumulateur de tir, dans
// l'angle des disques, dans E.orbitCd ou, par damage.hitEnemy, dans les PV d'un robot (qui ne mourrait plus jamais).
const usable = new Uint8Array(WEAPON_COUNT);

// ----- Projectiles du joueur (pool privé, suppression immédiate par échange) ------------------------------------------
// Tirs du blaster, plombs de la pompe (tirs droits : balayage du segment) et roquettes (vol vers un point, sans
// collision). pKind = WEAPON.* : debugSetOwned retire les projectiles d'une arme par ce champ.
const PCAP = CAPS.playerProjectiles;
const HIT_MEM = CAPS.hitMemory; // uid des derniers robots touchés par un projectile (≥ perforation maximale)
const pX = new Float32Array(PCAP);
const pZ = new Float32Array(PCAP);
// Départ du balayage de l'image suivante : la position du tir, sauf à sa première image où c'est le CENTRE du joueur au
// moment du tir (étape « animations », § Z sexies). Les tirs partent des bouches des armes (bras, tourelles d'épaule),
// jusqu'à ~1 m du centre : un robot collé au héros, entre lui et la bouche, est quand même touché (test de segment).
const pSX = new Float32Array(PCAP);
const pSZ = new Float32Array(PCAP);
const pVX = new Float32Array(PCAP);
const pVZ = new Float32Array(PCAP);
const pDX = new Float32Array(PCAP); // direction unitaire
const pDZ = new Float32Array(PCAP);
const pLife = new Float32Array(PCAP); // s de vol restantes
const pTravel = new Float32Array(PCAP); // m parcourus depuis le canon (la traînée ne remonte jamais derrière lui)
const pLinger = new Float32Array(PCAP); // > 0 : projectile arrêté sur un impact, qui s'éteint (s restantes)
const pDmg = new Float32Array(PCAP);
const pR = new Float32Array(PCAP);
const pKb = new Float32Array(PCAP); // recul infligé à chaque robot touché (m/s) : constante du blaster, stat spéciale de la pompe
const pTX = new Float32Array(PCAP); // roquettes : point visé
const pTZ = new Float32Array(PCAP);
const pBlast = new Float32Array(PCAP); // roquettes : rayon de l'explosion (stat au moment du tir)
// Ricochet et sentinelle (étape 2, § E2.A) : départ du trajet EN COURS = source des coups (le dernier robot touché pour
// un ricochet, la tourelle pour un tir de sentinelle). Tableaux typés : lus et écrits en ligne, sans nombre alloué.
const pOX = new Float64Array(PCAP);
const pOZ = new Float64Array(PCAP);
const pSlot = new Int16Array(PCAP); // roquettes : emplacement de traînée dans src/vfx (−1 : aucun ; tirs droits : −1)
const pKind = new Uint8Array(PCAP); // WEAPON.*
const pPierce = new Uint8Array(PCAP); // robots encore traversables
const pHitN = new Uint8Array(PCAP);
const pHit = new Uint32Array(PCAP * HIT_MEM);
// Source des coups d'un tir droit : le point d'où il est parti (la position du joueur à la salve), sur la droite
// même du tir — c'est « d'où vient le coup » pour le bouclier, les éclats et le recul, et cela ne dépend pas du pas de
// temps. Tableau ordinaire à tête nulle : chaque case garde le nombre DÉJÀ alloué de ARG (voir plus bas), passé tel
// quel à damage.hitEnemy — aucun flottant emballé par coup. Cases 1 + 2k (x) et 2 + 2k (z) du projectile k.
const pSrc = [null];
for (let k = 0; k < PCAP * 2; k++) pSrc.push(null);
let pCount = 0;
const activeByKind = new Int32Array(WEAPON_COUNT);

// ----- Rayons du rail et arcs de l'EMP (pool privé, un seul maillage) ----------------------------------------------------
// La capacité CAPS.beams se compte en rayons et en arcs AFFICHÉS — l'unité de `active` et de snapshot().pools.beams :
// l'occupation qu'on y lit est la vraie. Un arc brisé occupe jusqu'à arcSegments emplacements du maillage (un par
// segment), un rayon un seul : le maillage a donc CAPS.beams × arcSegments emplacements, jamais à court.
// Les arcs de l'EMP n'occupent jamais plus de BCAP − BEAM_RESERVE têtes : le rail garde toujours de quoi afficher une
// salve entière (TOP rayons au plus), même quand un bonus de cadence fait se chevaucher les impulsions.
const BCAP = CAPS.beams;
const BSEG = BCAP * Math.max(1, WEAPONS[WEAPON.EMP].arcSegments);
const bX = new Float32Array(BSEG); // départ
const bZ = new Float32Array(BSEG);
const bDX = new Float32Array(BSEG); // direction unitaire
const bDZ = new Float32Array(BSEG);
const bLen = new Float32Array(BSEG); // m
const bW = new Float32Array(BSEG); // largeur affichée au départ (m)
const bLife = new Float32Array(BSEG); // s d'affichage restantes
const bMax = new Float32Array(BSEG); // s d'affichage au départ
const bKind = new Uint8Array(BSEG); // WEAPON.RAIL ou WEAPON.EMP
const bHead = new Uint8Array(BSEG); // 1 = premier segment d'un rayon ou d'un arc (un arc brisé occupe plusieurs segments)
let bCount = 0; // segments dans le pool
const beamHeads = new Int32Array(WEAPON_COUNT); // rayons (rail) et arcs (EMP) affichés : ce que compte `active`

// ----- Scalaires réécrits à chaque image : dans un tableau typé (§ V) ---------------------------------------------------
const S_ORBIT = 0; // angle de l'orbite des disques (rad, 0..2π)
const S_SPIN = 1; // angle des disques sur eux-mêmes (visuel)
const S_PULSE = 2; // éclat de l'aura de l'EMP : 1 à l'impulsion, puis 0 (lu par le dessin de l'aura et de l'orbe)
const S_ORB_COUNT = 5; // disques et tours par seconde pour lesquels S_ORB_DELAY a été calculé
const S_ORB_RATE = 6;
const S_ORB_DELAY = 7; // orbitalHitDelay(disques, tours/s) : recalculé seulement quand l'une des deux stats change
const S_CLOCK = 8; // horloge des orbitaux : secondes simulées depuis le reset (instants exacts des coups de disque)
const S = new Float64Array(9);

// § E5.EMP : variante visuelle du champ EMP (0 'actuel', 1 'a', 2 'b', 3 'c', 4 'd' : EMP_VISU.styles), passée dans la
// graine de l'instance d'aura ; lue par src/anim/armes-heros.js (pas d'éclair au plastron hors 'actuel').
export const EMP_STYLE = new Int8Array([Math.max(0, EMP_VISU.styles.indexOf(EMP_VISU.style))]);
/** Variante du champ EMP ('actuel' | 'a' | 'b' | 'c' | 'd') ; rend la variante posée. Hors chemin chaud (planche, debug). */
export function setEmpStyle(k) {
  const i = EMP_VISU.styles.indexOf(k);
  if (i >= 0) EMP_STYLE[0] = i;
  return EMP_VISU.styles[EMP_STYLE[0]];
}

// ----- Arguments flottants des appels « par coup » ----------------------------------------------------------------------
// V8 alloue un nombre (12 octets) pour chaque flottant passé à une fonction qu'il n'a pas mise en ligne (§ V). Les
// appels par coup (damage.hitEnemy, enemies.applySlow, audio.play, requêtes de grille) reçoivent presque toujours
// les mêmes valeurs : position du joueur, dégâts de l'arme, ralentissement. Elles sont rangées ici, dans un tableau
// ordinaire qui contient autre chose que des nombres (le null de tête) : ses cases gardent des nombres DÉJÀ alloués,
// qu'on passe tels quels. Une case n'est réécrite que quand sa valeur change : une allocation à ce moment-là, au lieu
// d'une par coup. Mesuré dans Chromium (profileur de tas, 400 robots qui ne meurent pas, six armes au niveau 5,
// environ 30 coups par image) : avec ces cases, une seule requête de grille par image pour les orbitaux et le
// balayage en ligne des tirs, weapons.js passe de 1 614 à 225 octets alloués par image.
const A_PX = 1; // position du joueur
const A_PZ = 2;
const A_SLOW = 3; // EMP : facteur de ralentissement
const A_SLOW_T = 4; // EMP : durée du ralentissement
const A_ORB_REACH = 5; // orbitaux : rayon de la requête qui couvre toute l'orbite
const A_RANGE = 6; // + w : portée de la dernière requête de ciblage de l'arme w
const A_DMG = A_RANGE + WEAPON_COUNT; // + w : dégâts par coup de l'arme w (registre rangé par WEAPON_COUNT : étape 2, § E2.A)
const A_KB = A_DMG + WEAPON_COUNT; // + w : recul de l'arme w
const A_HALF = A_KB + WEAPON_COUNT; // rail : demi-largeur du rayon
const A_BLAST = A_HALF + 1; // roquettes : rayon de l'explosion
// § E3.Z.12 : champ de force des tourelles — centre de la bulle de chaque emplacement (posé à la pose) et rayon
// (réécrit quand le niveau de l'arme change) : requête de grille par tourelle et par pas sans nombre alloué
const A_FX = A_BLAST + 4; // + s : x de la tourelle s
const A_FZ = A_FX + CAPS.turrets; // + s : z de la tourelle s
const A_FR = A_FZ + CAPS.turrets; // rayon courant de la bulle
const ARG = [null];
for (let k = 1; k < A_FR + 2; k++) ARG.push(null);

// ----- Directions de recul ---------------------------------------------------------------------------------------------------
// enemies.applyKnockback reçoit une direction unitaire : deux flottants calculés par coup, donc deux nombres alloués
// (§ V). Les DIR_N directions du cercle sont préparées ici une fois pour toutes, dans un tableau ordinaire à tête
// nulle (cases = nombres déjà alloués) : le coup passe celle qui est la plus proche de la sienne (écart ≤ 0,18°,
// invisible sur un recul). Cases 1 + 2q (cos) et 2 + 2q (sin) de la direction q.
const DIR_N = 1024;
const DIR_MASK = DIR_N - 1;
const DIR_SCALE = DIR_N / TAU;
const DIR = [null];
for (let q = 0; q < DIR_N; q++) DIR.push(Math.cos((q * TAU) / DIR_N), Math.sin((q * TAU) / DIR_N));

// ----- Tableaux de travail (créés une fois) ------------------------------------------------------------------------------
const targets = new Uint16Array(32);
const segOut = new Uint16Array(CAPS.queryScratch);
const segT = new Float32Array(CAPS.queryScratch); // position le long du segment de chaque robot de segOut (tri du balayage en ligne)
const circOut = new Uint16Array(CAPS.queryScratch);
// Secteurs d'angle autour du joueur (0,25° chacun) : la pompe y compte les robots à portée (une passe, des entiers),
// le rail y mesure l'écart entre deux rayons.
const SECTORS = 1440;
const SECTOR_SCALE = SECTORS / TAU;
const sectorCount = new Int16Array(SECTORS); // pompe : robots à portée dans chaque secteur
const densOut = new Float32Array(16); // roquettes : barycentres des paquets (x0, z0, x1, z1…), 8 au plus
const LEAD = new Float64Array(3); // roquettes : somme des vitesses du paquet visé (vx, vz) et nombre de robots
const TOP = 8; // cibles d'une salve : rayons du rail (5 au plus) ou arcs de l'EMP (8 au plus)
const BEAM_RESERVE = TOP; // têtes du pool des rayons que les arcs de l'EMP laissent toujours au rail
const topIdx = new Uint16Array(TOP);
const topVal = new Float32Array(TOP); // EMP : distance au bord du robot
const RAIL_POOL = 32; // rail : candidats classés d'une salve (les plus solides, puis les plus proches)
const railIdx = new Uint16Array(RAIL_POOL);
const railHp = new Float32Array(RAIL_POOL);
const railD2 = new Float32Array(RAIL_POOL); // distance² au joueur (départage à PV égaux)
const railSector = new Int16Array(RAIL_POOL); // secteur d'angle du candidat
const railTaken = new Uint8Array(RAIL_POOL);
const pickSector = new Int16Array(TOP); // secteurs des rayons déjà retenus dans la salve
const OCAP = CAPS.orbitals;
const ORB_MAX_HITS = WEAPONS[WEAPON.ORBITALS].maxHitsPerFrame; // coups de disque au plus par robot et par image
// Orbitaux : instant (horloge S_CLOCK) où chaque robot redevient frappable, et l'uid du robot pour lequel il a été
// posé (un emplacement de E réutilisé par un nouveau robot repart prêt). Indice = emplacement de E.
const orbDue = new Float64Array(CAPS.enemies);
const orbUid = new Uint32Array(CAPS.enemies);

// ----- Constantes d'affichage par arme, préparées à l'init ---------------------------------------------------------------
const kHeight = new Float32Array(WEAPON_COUNT);
const kLingerInv = new Float32Array(WEAPON_COUNT);
let shotgunHalfSectors = 0; // demi-ouverture du cône de la pompe, en secteurs
let railGapSectors = 0; // écart minimal entre deux rayons du rail visant des robots aux mêmes PV, en secteurs

// ----- Dessin : lots de src/vfx/projectiles.js (§ Z septies) ---------------------------------------------------------------
const Q = V.Q; // entrées des événements (impact, rail, arc, explosion, traînées) : jamais de flottant en argument (§ V)
const STRIDE = V.STRIDE;
const LOT_TIRS = V.LOT.TIRS;
const LOT_CONTINUS = V.LOT.CONTINUS;

export function init(context) {
  ctx = context;
  grid = ctx.grid;
  damage = ctx.damage;
  props = ctx.props || null; // § E3.C
  enemies = ctx.enemies;
  audio = ctx.audio;
  camera = ctx.camera;
  world = ctx.world;
  render = ctx.render;
  initTurrets();

  for (let w = 0; w < WEAPON_COUNT; w++) {
    const W = WEAPONS[w];
    // Drapeaux du § I.2 : BYPASS_SHIELD (orbitaux, EMP, roquettes), HEAVY (rail), NO_CRIT | NO_IMPACT (EMP).
    flagsOf[w] = (W.bypassShield ? DMG.BYPASS_SHIELD : 0) | (W.hitstopOnKill ? DMG.HEAVY : 0) | (W.noCrit ? DMG.NO_CRIT | DMG.NO_IMPACT : 0);
    kHeight[w] = W.shotHeight || 0;
    kLingerInv[w] = W.impactLinger > 0 ? 1 / W.impactLinger : 0;
  }
  shotgunHalfSectors = Math.round((WEAPONS[WEAPON.SHOTGUN].coneDeg / 2) * DEG * SECTOR_SCALE);
  railGapSectors = Math.round(WEAPONS[WEAPON.RAIL].spreadDeg * DEG * SECTOR_SCALE);
  WA.init(ctx, { owned, effective, flagsOf, countShot, REP_S, repTarget, marquer, droneBouclier, niveau: getWeaponLevel, fireAcc, usable }); // § E5.U : fireAcc, usable (trait de la Frappe éclair prête) // § E5.F.14 // § E3.N ; § E5.D : réparateur prioritaire
  evo = ctx.evolutions || null; // § E3.B
  if (evo !== null) EVO_ORBIT = evo.ORBIT_MUL;
  CD = ctx.cooldowns || null; // § E3.H
  CB.init(ctx); // § E3.M
  PG.init(ctx); // § E5.F
}

export function reset() {
  owned.fill(0);
  levels.fill(0);
  overcharge.fill(0);
  slots.fill(-1); // § E2.C : emplacements vides
  slotCount = 0;
  shots.fill(0);
  fireAcc.fill(1); // prêtes : le premier tir part dès qu'une cible est à portée
  pCount = 0;
  E5D.fill(0); // § E5.D : compteurs et réticule
  MARK[0] = -1;
  MARK[1] = -1;
  MARK_T[0] = 0;
  activeByKind.fill(0);
  bCount = 0;
  beamHeads.fill(0);
  S[S_ORBIT] = 0;
  S[S_SPIN] = 0;
  S[S_PULSE] = 0;
  S[S_CLOCK] = 0;
  orbDue.fill(0); // horloge remise à 0 : aucun délai ancien ne reste dans le futur
  resetE2A();
  resetE2B();
  WA.reset(); // § E3.N
  evolved.fill(0); // § E3.B
  absorbed.fill(0);
  CB.reset(); // § E3.M
  ATT_GAP[0] = 0; // § E5.F
  AS.fill(0); // § E5.F : anneau de soin
  AS_I[0] = -1;
  ATT_F[0] = 1;
  PG.reset(); // § E5.F
  dirty = true;
  unlock(agentSignature(__run.agent)); // § E2.D : arme signature de l'agent (WEAPON_COSTS.startWeapon pour l'Éclaireur)
}

// ----- Modèle --------------------------------------------------------------------------------------------------------

function recompute() {
  dirty = false;
  for (let w = 0; w < WEAPON_COUNT; w++) {
    const W = WEAPONS[w];
    for (let s = 0; s < STAT_COUNT; s++) {
      const lv = levels[w * STAT_COUNT + s];
      let v = W.stats[s][(lv > 0 ? lv : 1) - 1]; // non possédée : valeurs du niveau 1 (aperçu de la boutique)
      if (s === STAT.DAMAGE) v *= mods.damageMul * (1 + OVERCHARGE_STEP * overcharge[w]); // surcharge : § E1.D
      else if (s === STAT.RATE) v *= mods.fireRateMul;
      else if (s === STAT.AREA) v *= mods.areaMul;
      else if (s === STAT.SPECIAL && W.specialScalesWithArea) v *= mods.areaMul;
      effective[w * STAT_COUNT + s] = v;
    }
  }
}

/** § E2.C : les armes ne se débloquent plus par vague (elles sortent des coffres). Signature gardée ; toujours vrai. */
export function isUnlocked(w, nextWave) {
  return true;
}

/**
 * Donne l'arme au niveau 1 partout ; false si déjà possédée, ou si les emplacements sont pleins (§ E2.C règle 1).
 * Ne touche pas au porte-monnaie.
 */
export function unlock(w) {
  if (!(w >= 0 && w < WEAPON_COUNT) || owned[w] === 1 || slotCount >= SLOT_CAP) return false;
  return give(w);
}

/** Possession de l'arme w (niveau 1 partout) ; elle prend le premier emplacement libre s'il en reste un. */
function give(w) {
  if (slotCount < SLOT_CAP) slots[slotCount++] = w;
  owned[w] = 1;
  vuArme[w] = 1; // § E4.A
  for (let s = 0; s < STAT_COUNT; s++) levels[w * STAT_COUNT + s] = 1;
  fireAcc[w] = 1;
  dirty = true;
  return true;
}

/** +1 niveau ; false si non possédée ou déjà au niveau 5. Ne touche pas au porte-monnaie. */
export function upgradeStat(w, s) {
  if (!(w >= 0 && w < WEAPON_COUNT) || !(s >= 0 && s < STAT_COUNT) || owned[w] === 0) return false;
  const k = w * STAT_COUNT + s;
  if (levels[k] >= STAT_MAX_LEVEL) return false;
  levels[k]++;
  dirty = true;
  return true;
}

export function getLevel(w, s) {
  return levels[w * STAT_COUNT + s];
}

/** Debug (§ E2.C) : copie des niveaux de toutes les stats (indice w × 5 + s). */
export function inspectLevels() {
  return Array.from(levels);
}

/** Emplacements d'armes occupés (§ E2.C). */
export function getSlotCount() {
  return slotCount;
}

/**
 * Tire n niveaux pour l'arme w SANS les poser (§ E2.C règle 1) : n fois, une stat non maximale tirée par rnd() reçoit
 * +1 dans out (Uint8Array(5), remis à zéro ici). Arme non possédée : tirage comme si elle était au niveau 1 partout
 * (lot « arme nouvelle »). Rend le nombre de niveaux tirés (moins que n si tout est au maximum).
 */
export function rollLevels(w, n, out, rnd = rand) {
  out.fill(0);
  let made = 0;
  for (let j = 0; j < n; j++) {
    let open = 0;
    for (let s = 0; s < STAT_COUNT; s++) {
      const lv = owned[w] === 1 ? levels[w * STAT_COUNT + s] : 1;
      if (lv + out[s] < STAT_MAX_LEVEL) open++;
    }
    if (open === 0) break;
    let pick = Math.floor(rnd() * open);
    if (pick >= open) pick = open - 1;
    for (let s = 0; s < STAT_COUNT; s++) {
      const lv = owned[w] === 1 ? levels[w * STAT_COUNT + s] : 1;
      if (lv + out[s] >= STAT_MAX_LEVEL) continue;
      if (pick === 0) {
        out[s]++;
        made++;
        break;
      }
      pick--;
    }
  }
  return made;
}

/** Pose les niveaux comptés par stat dans counts (Uint8Array(5)) sur l'arme possédée w ; rend le nombre réellement posé. */
export function applyLevels(w, counts) {
  if (!(w >= 0 && w < WEAPON_COUNT) || owned[w] === 0) return 0;
  let made = 0;
  for (let s = 0; s < STAT_COUNT; s++) {
    for (let j = 0; j < counts[s]; j++) {
      if (levels[w * STAT_COUNT + s] >= STAT_MAX_LEVEL) break;
      levels[w * STAT_COUNT + s]++;
      made++;
    }
  }
  if (made > 0) dirty = true;
  return made;
}

/** n niveaux tirés par rand() et posés sur l'arme possédée w ; out compte les niveaux par stat. Rend le nombre posé. */
export function addRandomLevels(w, n, out) {
  if (!(w >= 0 && w < WEAPON_COUNT) || owned[w] === 0) return 0;
  rollLevels(w, n, out);
  return applyLevels(w, out);
}

/** Arme sortie d'un coffre : unlock, puis bonusLevels niveaux au hasard (comptés dans out). False si unlock refuse. */
export function grant(w, bonusLevels, out) {
  if (!unlock(w)) return false;
  if (bonusLevels > 0) addRandomLevels(w, bonusLevels, out);
  else out.fill(0);
  return true;
}

/** Crans de surcharge de l'arme (§ E1.D). */
export function getOvercharge(w) {
  return overcharge[w];
}

/** +1 cran de surcharge ; false si l'arme n'est pas au niveau 21 (tout au maximum). Ne touche pas au porte-monnaie. */
export function addOvercharge(w) {
  if (!(w >= 0 && w < WEAPON_COUNT) || getWeaponLevel(w) < 1 + STAT_COUNT * (STAT_MAX_LEVEL - 1) || overcharge[w] >= 65535) return false;
  overcharge[w]++;
  dirty = true;
  return true;
}

/** Debug seulement : crans de surcharge d'une arme possédée (sans condition de niveau). */
export function debugSetOvercharge(w, n) {
  if (!(w >= 0 && w < WEAPON_COUNT) || owned[w] === 0) return;
  const v = Math.round(n);
  overcharge[w] = v < 0 ? 0 : v > 65535 ? 65535 : v;
  dirty = true;
}

// ----- § E5.D : réparateurs volants — cible prioritaire, tirs aériens, réticule ------------------------------------------
// Les armes qui choisissent une cible visent d'abord le réparateur vivant le plus proche à leur portée (repTarget). Un
// tir droit lancé vers un volant haut vole à son altitude (pAirY) : il ignore tout robot dont le haut (survol + hauteur
// de son type) est plus bas que lui — le bouclier d'un blindé ne couvre plus le réparateur qui vole derrière lui.
const REP_T = ENEMY.REPARATEUR;
const VOL_ON = REPARATEUR_VOL.actif ? 1 : 0;
const DRONES_DABORD = REPARATEUR_VOL.dronesBossDAbord ? 1 : 0;
const RET = REPARATEUR_VOL.reticule;
const RET_ON = VOL_ON === 1 && RET.actif ? 1 : 0;
const REP_S = new Float64Array(4); // recherche d'un réparateur : x, z du point, portée (m), meilleure distance² (aucun flottant en argument, § V)
let repBest = -1;
let repDuPrio = 0; // 1 : la portée de la recherche est PRIO_S[0] (repDuHeros), sinon REP_S[2]
const airTop = new Float32Array(ENEMY_COUNT); // haut de chaque type (survol + hauteur, m)
const airMid = new Float32Array(ENEMY_COUNT); // altitude d'un tir vers ce type : le centre d'un volant haut ; 0 = au sol
const pAirY = new Float32Array(CAPS.playerProjectiles); // projectile : altitude de vol (> 0 : tir aérien), 0 au sol
const pFromY = new Float32Array(CAPS.playerProjectiles); // dessin : altitude du départ du trajet (> 0 : rebond / retour depuis un volant)
// compteurs (debugE5D) : 0 tirs aériens partis, 1 survols (un robot plus bas sur le segment d'un tir aérien, par image),
// 2 coups aériens portés, 3 images avec réticule, 4 réticule écrit dans un lot TIRS sans autre instance (appel en plus) ;
// 8 + w : tirs ou salves de l'arme w pris par un réparateur prioritaire
const E5D = new Int32Array(8 + WEAPON_COUNT); // entiers : « ++ » n’emballe aucun nombre, même dans une fonction froide (§ V)
const MARK = new Int32Array([-1, -1]); // réparateur visé : indice dans E, uid
const MARK_T = new Float64Array(1); // s de réticule restantes
const RETK = new Float64Array([RET.tenue, 1 / (RET.tenue * 0.5), RET.rayon, RET.rayon * 1.35, RET.style]); // réglages du réticule en flottants (§ V)
const airOk = new Uint8Array(ENEMY_COUNT); // 1 : volant haut (un tir vers lui est aérien)
const AIRN = [null]; // airMid en nombres déjà alloués (tableau ordinaire à tête nulle, comme ARG) : visee n'en crée aucun
const RETN = [null, RET.tenue];
for (let t = 0; t < ENEMY_COUNT; t++) {
  const T = ENEMIES.types[t];
  airTop[t] = (T.height || 0) + (T.hover || 0);
  airMid[t] = VOL_ON === 1 && t !== ENEMY.BOSS && (T.hover || 0) >= REPARATEUR_VOL.volHaut ? (T.hover || 0) + (T.height || 0) * 0.5 : 0;
  airOk[t] = airMid[t] > 0 ? 1 : 0;
  AIRN.push(airMid[t]);
}

/** Un réparateur vu par repTarget : gardé s'il est à portée et plus proche du point que le meilleur trouvé. */
function repCandidat(i) {
  const dx = E.x[i] - REP_S[0];
  const dz = E.z[i] - REP_S[1];
  const d2 = dx * dx + dz * dz;
  const reach = (repDuPrio === 1 ? PRIO_S[0] : REP_S[2]) + E.radius[i];
  if (d2 <= reach * reach && d2 < REP_S[3]) {
    REP_S[3] = d2;
    repBest = i;
  }
}

/**
 * § E5.D — réparateur vivant (ni en veille ni garé) le plus proche du point (REP_S[0], REP_S[1]), à moins de REP_S[2] m
 * de lui (bord du robot compris) ; −1 s'il n'y en a pas. La boucle ne compare que des entiers ; les flottants ne sont
 * calculés que pour les réparateurs (repCandidat, appelée par réparateur).
 */
function repTarget() {
  repBest = -1;
  if (VOL_ON === 0 || E.aliveByType[REP_T] === 0) return -1;
  REP_S[3] = Infinity;
  const n = E.count;
  const TYPE = E.type;
  const ALIVE = E.alive;
  const SUS = E.sus;
  for (let i = 0; i < n; i++) if (TYPE[i] === REP_T && ALIVE[i] === 1 && SUS[i] === 0) repCandidat(i);
  return repBest;
}

/** Réparateur prioritaire à PRIO_S[0] m du héros (−1 sinon). */
function repDuHeros() {
  // cases de ARG = nombres déjà alloués ; la portée est lue dans PRIO_S par repCandidat (aucune copie de flottant dans
  // cette fonction froide, appelée par salve : § V)
  REP_S[0] = ARG[A_PX];
  REP_S[1] = ARG[A_PZ];
  repDuPrio = 1;
  const r = repTarget();
  repDuPrio = 0;
  return r;
}

/** Le réparateur i est visé par l'arme w : réticule tenu RET.tenue s, salve comptée. */
function marquer(i, w) {
  if (i < 0 || E.type[i] !== REP_T) return;
  MARK[0] = i;
  MARK[1] = E.uid[i];
  MARK_T[0] = RETN[1]; // nombre déjà alloué (fonction froide)
  E5D[8 + w]++;
}

/** Ricochet, boomerang : le réparateur prioritaire à portée passe en tête de `targets` (PRIO_S[0] = portée). Rend le compte. */
function repFirst(found, cap) {
  const t = repDuHeros();
  if (t < 0) return found;
  let at = -1;
  for (let q = 0; q < found; q++) if (targets[q] === t) at = q;
  if (at < 0) {
    if (found < cap) found++;
    at = found - 1;
  }
  for (let q = at; q > 0; q--) targets[q] = targets[q - 1];
  targets[0] = t;
  return found;
}

/** Il y a peut-être une cible prioritaire (drone-bouclier du boss, réparateur) : sinon les armes sautent la recherche. */
function prioPossible() {
  return PRIO[0] > 0 || (VOL_ON === 1 && E.aliveByType[REP_T] > 0);
}

/** Tests (§ E5.D) : compteurs, réparateur marqué, altitude des tirs en vol. */
export function debugE5D(out = {}) {
  out.airShots = E5D[0];
  out.overflown = E5D[1];
  out.airHits = E5D[2];
  out.reticleFrames = E5D[3];
  out.reticleAlone = E5D[4];
  out.prioByWeapon = Array.from(E5D.subarray(8));
  out.markIndex = MARK[0];
  out.markUid = MARK[1];
  out.markLeft = MARK_T[0];
  const air = [];
  for (let k = 0; k < pCount; k++) if (pAirY[k] > 0) air.push({ kind: pKind[k], x: pX[k], z: pZ[k], y: pAirY[k] });
  out.airProjectiles = air;
  return out;
}

/**
 * Cible prioritaire (§ E1.D) : indice dans E du robot EFLAG.PRIORITY en vie le plus proche du joueur, à moins de
 * PRIO_S[0] m de lui (bord du robot compris) ; −1 s'il n'y en a pas. La liste PRIO est écrite par boss.update (S6).
 * § E5.D : le réparateur le plus proche à cette portée passe avant (après, si REPARATEUR_VOL.dronesBossDAbord).
 */
function priorityTarget() {
  if (DRONES_DABORD === 0) {
    const r = repDuHeros();
    if (r >= 0) return r;
  }
  const best = prioDrone();
  if (best < 0 && DRONES_DABORD === 1) return repDuHeros();
  return best;
}

/** Drone-bouclier du boss le plus proche à PRIO_S[0] m du héros (§ E1.D, la règle d'avant) ; −1 sinon. */
function prioDrone() {
  const n = PRIO[0];
  let best = -1;
  let bestD2 = Infinity;
  for (let q = 1; q <= n; q++) {
    const i = PRIO[q];
    if (i >= E.count || E.alive[i] === 0 || (E.flags[i] & F_PRIORITY) === 0) continue;
    const dx = E.x[i] - P.x;
    const dz = E.z[i] - P.z;
    const d2 = dx * dx + dz * dz;
    const reach = PRIO_S[0] + E.radius[i];
    if (d2 <= reach * reach && d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/** Blaster : la cible prioritaire à portée passe en tête de `targets` (ajoutée si elle n'y était pas). Rend le nouveau compte. */
function priorityFirst(found, cap) {
  const t = priorityTarget();
  if (t < 0) return found;
  let at = -1;
  for (let q = 0; q < found; q++) if (targets[q] === t) at = q;
  if (at < 0) {
    if (found < cap) found++;
    at = found - 1;
  }
  for (let q = at; q > 0; q--) targets[q] = targets[q - 1];
  targets[0] = t;
  return found;
}

/** Rail : la cible prioritaire à portée devient le premier candidat (devant le plus solide). */
function railPriority() {
  const t = priorityTarget();
  if (t < 0) return;
  let at = -1;
  for (let c = 0; c < railFound; c++) if (railIdx[c] === t) at = c;
  if (at < 0) {
    if (railFound < RAIL_POOL) railFound++;
    at = railFound - 1;
  }
  for (let c = at; c > 0; c--) {
    railHp[c] = railHp[c - 1];
    railD2[c] = railD2[c - 1];
    railIdx[c] = railIdx[c - 1];
  }
  railHp[0] = Infinity; // jamais à égalité de PV avec un autre : il est pris en premier
  railD2[0] = 0;
  railIdx[0] = t;
}

/** Roquettes : la position de la cible prioritaire à portée devient le premier paquet visé. Rend le nouveau compte. */
function rocketPriority(found, cap) {
  const t = priorityTarget();
  if (t < 0) return found;
  if (found < cap) found++;
  for (let q = found - 1; q > 0; q--) {
    densOut[q * 2] = densOut[q * 2 - 2];
    densOut[q * 2 + 1] = densOut[q * 2 - 1];
  }
  densOut[0] = E.x[t];
  densOut[1] = E.z[t];
  marquer(t, WEAPON.ROCKETS); // § E5.D (sans effet si c'est un drone-bouclier)
  return found;
}

/** 0 si non possédée, sinon 1 + nombre d'améliorations achetées (1 à 21). */
export function getWeaponLevel(w) {
  if (owned[w] === 0) return 0;
  let n = 1;
  for (let s = 0; s < STAT_COUNT; s++) n += levels[w * STAT_COUNT + s] - 1;
  return n;
}

/** Stat effective (bonus passifs compris). */
export function getStat(w, s) {
  if (dirty) recompute();
  return effective[w * STAT_COUNT + s];
}

/** Valeur de table, sans bonus. */
export function getStatAt(w, s, level) {
  return WEAPONS[w].stats[s][level - 1];
}

export function getUnlockCost(w) {
  return WEAPONS[w].unlockCost;
}

/** Prix du prochain niveau ; −1 si max ou non possédée. */
export function getUpgradeCost(w, s) {
  if (owned[w] === 0) return -1;
  return upgradePrice(w, s, levels[w * STAT_COUNT + s]); // § E2.C : prix du marchand = upgradeCost × SHOP.upgradePriceMul
}

/** À appeler quand mods change (progression) ; unlock et upgradeStat le font. */
export function markDirty() {
  dirty = true;
}

/** Projectiles du joueur dans le pool : en vol, ou arrêtés sur un impact et en train de s'éteindre. */
export function getProjectileCount() {
  return pCount;
}

/**
 * Debug seulement : donne l'arme (niveau 1) ou la retire, blaster compris. Retirer une arme supprime ses
 * projectiles ici même ; ses disques, son anneau, ses rayons et ses arcs ne sont affichés et comptés que pour une
 * arme possédée (sync les retire du pool à l'image suivante, inspect ne les compte déjà plus).
 */
export function debugSetOwned(w, on) {
  if (!(w >= 0 && w < WEAPON_COUNT)) return;
  // fusion du groupe 2 : la console déclare l'état de l'arme, « absorbée » (§ E3.B) comprise — sans quoi une arme
  // absorbée pendant un tirage de coffres de test le restait au lot suivant et l'arsenal comptait épuisé (§ E3.N)
  // (absorb() appelle cette fonction puis repose absorbed[w] = 1)
  absorbed[w] = 0;
  if (on) {
    if (owned[w] === 0) give(w); // debug : possédée même sans emplacement libre (§ E2.C)
  } else {
    // § E2.C : l'emplacement est rendu, les suivants remontent (ordre d'obtention gardé)
    for (let k = 0; k < slotCount; k++) {
      if (slots[k] !== w) continue;
      for (let j = k; j < slotCount - 1; j++) slots[j] = slots[j + 1];
      slots[--slotCount] = -1;
      break;
    }
    owned[w] = 0;
    overcharge[w] = 0;
    for (let s = 0; s < STAT_COUNT; s++) levels[w * STAT_COUNT + s] = 0;
    for (let k = pCount - 1; k >= 0; k--) if (pKind[k] === w) removeProjectile(k);
    if (w === WEAPON.TURRET) clearTurrets();
    if (w === WEAPON.BLADE) bladePending = 0;
    if (w === WEAPON.BLADE) ATT_GAP[0] = 0; // § E5.F : sans attendre la respiration du combo d'avant (sinon le buste
    // a le temps de se tourner vers le robot le plus proche — mesuré par e3-N « contact » : 38 images au lieu de 5)
    if (w === WEAPON.BLADE) CB.resetCombo(COMBO.BLADE); // § E3.M : l'arme retirée, son combo repart du 1er geste
    if (w === WEAPON.KATANA) CB.resetCombo(COMBO.KATANA);
    if (w === WEAPON.HAMMER) CB.resetCombo(COMBO.HAMMER);
    if (w === WEAPON.POOL) clearPools(); // § E2.B : nappes, boomerangs (emplacements) et mines quittent le jeu avec l'arme
    if (w === WEAPON.BOOMERANG) clearBoomerangs();
    if (w === WEAPON.MINES) clearMines();
    WA.onRemoved(w); // § E3.N
    evolved[w] = 0; // § E3.B
    if (evo !== null) evo.ON[w] = 0;
    dirty = true;
  }
}

/** Debug seulement : niveau 1 à 5 d'une stat d'une arme possédée. */
export function debugSetLevel(w, s, level) {
  if (!(w >= 0 && w < WEAPON_COUNT) || !(s >= 0 && s < STAT_COUNT) || owned[w] === 0) return;
  const lv = Math.round(level);
  levels[w * STAT_COUNT + s] = lv < 1 ? 1 : lv > STAT_MAX_LEVEL ? STAT_MAX_LEVEL : lv;
  dirty = true;
}

// ----- Projectiles ---------------------------------------------------------------------------------------------------

/**
 * Prend un emplacement du pool pour un projectile de l'arme `kind` (−1 si le pool est plein) et le remet à neuf.
 * L'appelant écrit lui-même position, direction, vitesse, durée, dégâts, rayon, recul et perforation : aucun
 * flottant ne passe par un appel (§ V).
 */
function takeProjectile(kind) {
  if (pCount >= PCAP) return -1;
  const k = pCount++;
  pTravel[k] = 0;
  pLinger[k] = 0;
  pKb[k] = 0;
  pTX[k] = 0;
  pTZ[k] = 0;
  pBlast[k] = 0;
  pSlot[k] = -1;
  pKind[k] = kind;
  pPierce[k] = 0;
  pHitN[k] = 0;
  pAirY[k] = 0; // § E5.D : tir au sol (visee() le fait voler vers un volant haut)
  pFromY[k] = 0;
  pSX[k] = ARG[A_PX]; // première image : balayage depuis le centre du joueur (voir pSX)
  pSZ[k] = ARG[A_PZ];
  pOX[k] = P.x;
  pOZ[k] = P.z;
  activeByKind[kind]++;
  return k;
}

function removeProjectile(k) {
  activeByKind[pKind[k]]--;
  if (pSlot[k] >= 0) V.traineFermer(pSlot[k]); // roquette partie : sa fumée se dissipe, l'emplacement se libère ensuite
  const last = --pCount;
  if (k !== last) {
    pX[k] = pX[last];
    pZ[k] = pZ[last];
    pSX[k] = pSX[last];
    pSZ[k] = pSZ[last];
    pDX[k] = pDX[last];
    pDZ[k] = pDZ[last];
    pVX[k] = pVX[last];
    pVZ[k] = pVZ[last];
    pLife[k] = pLife[last];
    pTravel[k] = pTravel[last];
    pLinger[k] = pLinger[last];
    pDmg[k] = pDmg[last];
    pR[k] = pR[last];
    pKb[k] = pKb[last];
    pTX[k] = pTX[last];
    pTZ[k] = pTZ[last];
    pBlast[k] = pBlast[last];
    pOX[k] = pOX[last];
    pOZ[k] = pOZ[last];
    pSlot[k] = pSlot[last];
    pKind[k] = pKind[last];
    pPierce[k] = pPierce[last];
    pHitN[k] = pHitN[last];
    pAirY[k] = pAirY[last]; // § E5.D
    pFromY[k] = pFromY[last];
    pSrc[1 + 2 * k] = pSrc[1 + 2 * last];
    pSrc[2 + 2 * k] = pSrc[2 + 2 * last];
    const a = k * HIT_MEM;
    const b = last * HIT_MEM;
    for (let h = 0; h < HIT_MEM; h++) pHit[a + h] = pHit[b + h];
  }
}

/**
 * Projectiles en vol.
 * Tirs droits (blaster, plombs) : balayage du SEGMENT parcouru pendant l'image, premier robot non encore touché,
 * perforation. La dernière image d'un tir n'avance que du temps de vol qui lui reste : la portée est exacte à toute
 * cadence. Un tir arrêté par un impact reste affiché WEAPONS[kind].impactLinger secondes, figé sur le point
 * d'impact : sans cela un tir sur une cible au contact naîtrait et mourrait entre deux images, sans jamais être
 * dessiné.
 * Roquettes : vol droit vers le point visé, sans collision ; à l'arrivée, damage.explode.
 * Aucun flottant calculé n'est passé par coup : source du coup et recul viennent de cases déjà allouées (pSrc, DIR).
 */
function updateProjectiles(dt) {
  // marge des cellules à lire : le plus grand rayon vivant de la grille, jamais moins que le plus grand rayon de type
  let margin = grid.getMaxRadius();
  if (!(margin > sweepMargin)) margin = sweepMargin;
  const UID = E.uid;
  const ALIVE = E.alive;
  const EX = E.x;
  const EZ = E.z;
  const ER = E.radius;
  const TYPE = E.type; // § E5.D
  const cellStart = grid.cellStart;
  const cellCount = grid.cellCount;
  const items = grid.items;
  const ROCKETS = WEAPON.ROCKETS;
  const RICO = WEAPON.RICOCHET;
  const POOLW = WEAPON.POOL;
  BM_S[0] = dt; // flacons et boomerangs (§ E2.B) : le pas de temps ne passe pas en argument (§ V)
  for (let k = pCount - 1; k >= 0; k--) {
    const kind = pKind[k];
    const W = WEAPONS[kind];
    if (kind >= POOLW) {
      // étape 2, chantier B : flacon de la nappe (vol sans collision) ou boomerang (aller, retour, un coup par trajet)
      if (kind === POOLW) updateFlask(k);
      else updateBoomerang(k);
      continue;
    }
    if (kind === ROCKETS) {
      const step = pLife[k] < dt ? pLife[k] : dt;
      pX[k] += pVX[k] * step;
      pZ[k] += pVZ[k] * step;
      pTravel[k] += W.projectileSpeed * step;
      pLife[k] -= dt;
      if (pLife[k] <= 0) {
        // arrivée : le point visé exactement ; la roquette quitte le pool (sa traînée se ferme) avant l'explosion
        const tx = pTX[k];
        const tz = pTZ[k];
        if (ARG[A_BLAST] !== pBlast[k]) ARG[A_BLAST] = pBlast[k];
        if (ARG[A_DMG + ROCKETS] !== pDmg[k]) ARG[A_DMG + ROCKETS] = pDmg[k];
        removeProjectile(k);
        // dessin : éclat d'étoile + onde de choc au rayon du souffle (src/vfx) ; fx garde l'éclair, les blocs de feu,
        // la fumée et les étincelles, sans son anneau au sol (genre FXK.ROCKET_TOON : l'onde le remplace)
        Q[0] = tx;
        Q[2] = tz;
        Q[3] = ARG[A_BLAST];
        V.explosion();
        damage.explode(tx, tz, ARG[A_BLAST], ARG[A_DMG + ROCKETS], 0, ROCKETS, flagsOf[ROCKETS], FXK.ROCKET_TOON, W.explosionTrauma, W.explosionPunch, W.knockback);
        if (evolved[ROCKETS] !== 0 && evo !== null) {
          // § E3.B : Essaim à fragmentation — sous-munitions au point d'impact
          ARGF[F_X_E3C] = tx;
          ARGF[F_Z_E3C] = tz;
          evo.eventF(ROCKETS);
        }
      }
      continue;
    }
    if (pLinger[k] > 0) {
      // tir arrêté : il ne touche plus rien, il s'éteint
      pLinger[k] -= dt;
      if (pLinger[k] <= 0) removeProjectile(k);
      continue;
    }
    const step = pLife[k] < dt ? pLife[k] : dt;
    const fx0 = pX[k]; // position du tir
    const fz0 = pZ[k];
    const fsx = pVX[k] * step; // vol de l'image
    const fsz = pVZ[k] * step;
    const x1 = fx0 + fsx;
    const z1 = fz0 + fsz;
    if (props !== null && props.getCount() > 0) {
      // § E3.C : le tir passe sur une borne de données → un coup (elle ne l'arrête pas)
      ARGF[F_X_E3C] = x1;
      ARGF[F_Z_E3C] = z1;
      props.hitPointF();
    }
    // segment balayé : de pSX (= la position du tir, ou le centre du joueur à la première image) à l'arrivée
    const x0 = pSX[k];
    const z0 = pSZ[k];
    const sx = x1 - x0;
    const sz = z1 - z0;
    pLife[k] -= dt;
    const dead = pLife[k] <= 0; // fin de portée : retiré tout de suite (il a été vu pendant tout son vol)
    let stop = -1; // robot sur lequel le tir s'arrête
    let bounced = -1; // ricochet : robot touché d'où le tir repart…
    let bounceTo = -1; // … vers celui-ci
    const own = kind >= RICO; // ricochet, sentinelle : la source du coup est le départ du trajet en cours (pOX, pOZ)
    // Balayage du segment, EN LIGNE sur les tableaux bruts de la grille (§ F) : même test, même ordre et même
    // résultat que grid.querySegment(x0, z0, x1, z1, rayon), sans l'appel — donc sans les flottants qu'il fait
    // allouer à chaque projectile et à chaque image (§ V). Robots dont le cercle touche le segment épaissi, triés
    // du départ vers l'arrivée dans segOut ; le boss, absent des cellules, est testé à part.
    const pr = pR[k];
    const reach = pr + margin;
    const airY = pAirY[k]; // § E5.D : > 0 = tir aérien (il passe au-dessus des robots moins hauts que lui)
    let cx0 = Math.floor(((x0 < x1 ? x0 : x1) - reach - GRID_MIN) * GRID_INV);
    let cx1 = Math.floor(((x0 > x1 ? x0 : x1) + reach - GRID_MIN) * GRID_INV);
    let cz0 = Math.floor(((z0 < z1 ? z0 : z1) - reach - GRID_MIN) * GRID_INV);
    let cz1 = Math.floor(((z0 > z1 ? z0 : z1) + reach - GRID_MIN) * GRID_INV);
    if (cx0 < 0) cx0 = 0;
    else if (cx0 > GRID_LAST) cx0 = GRID_LAST;
    if (cz0 < 0) cz0 = 0;
    else if (cz0 > GRID_LAST) cz0 = GRID_LAST;
    if (cx1 < 0) cx1 = 0;
    else if (cx1 > GRID_LAST) cx1 = GRID_LAST;
    if (cz1 < 0) cz1 = 0;
    else if (cz1 > GRID_LAST) cz1 = GRID_LAST;
    const len2 = sx * sx + sz * sz;
    const inv = len2 > 1e-12 ? 1 / len2 : 0;
    let n = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      const row = cz * GRID_DIM;
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = row + cx;
        const cnt = cellCount[c];
        if (cnt === 0) continue;
        const first = cellStart[c];
        for (let q = first; q < first + cnt; q++) {
          const i = items[q];
          if (ALIVE[i] === 0) continue;
          const ax = EX[i] - x0;
          const az = EZ[i] - z0;
          let t = (ax * sx + az * sz) * inv;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const dx = ax - sx * t;
          const dz = az - sz * t;
          const rr = pr + ER[i];
          if (dx * dx + dz * dz > rr * rr) continue;
          if (airY > 0 && airTop[TYPE[i]] < airY) {
            E5D[1]++; // § E5.D : survolé (ni touché, ni bouclier qui arrête)
            continue;
          }
          let at = n;
          while (at > 0 && segT[at - 1] > t) {
            segT[at] = segT[at - 1];
            segOut[at] = segOut[at - 1];
            at--;
          }
          segT[at] = t;
          segOut[at] = i;
          n++;
        }
      }
    }
    const boss = E.bossIndex;
    if (boss >= 0 && ALIVE[boss] === 1 && !(airY > 0 && airTop[ENEMY.BOSS] < airY)) {
      const ax = EX[boss] - x0;
      const az = EZ[boss] - z0;
      let t = (ax * sx + az * sz) * inv;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const dx = ax - sx * t;
      const dz = az - sz * t;
      const rr = pr + ER[boss];
      if (dx * dx + dz * dz <= rr * rr) {
        let at = n;
        while (at > 0 && segT[at - 1] > t) {
          segT[at] = segT[at - 1];
          segOut[at] = segOut[at - 1];
          at--;
        }
        segT[at] = t;
        segOut[at] = boss;
        n++;
      }
    }
    const base = k * HIT_MEM;
    for (let q = 0; q < n; q++) {
      const i = segOut[q];
      if (ALIVE[i] === 0) continue;
      const uid = UID[i];
      // déjà touché par ce projectile ?
      let seen = false;
      const mem = pHitN[k] < HIT_MEM ? pHitN[k] : HIT_MEM;
      for (let h = 0; h < mem; h++) {
        if (pHit[base + h] === uid) {
          seen = true;
          break;
        }
      }
      if (seen) continue;
      if (ARG[A_DMG + kind] !== pDmg[k]) ARG[A_DMG + kind] = pDmg[k];
      // source du coup : le point de départ du tir (cases de pSrc, passées telles quelles)
      const so = 1 + 2 * k;
      ARGF[F_V] = ARG[A_DMG + kind];
      ARGF[F_SX] = own ? pOX[k] : pSrc[so];
      ARGF[F_SZ] = own ? pOZ[k] : pSrc[so + 1];
      const r = damage.hitEnemyF(i, kind, flagsOf[kind]);
      if (r < 0 || r === 2) {
        // arrêté par un bouclier (−1) ou atténué par celui d'un blindé de face (2, § E4.P : dégâts réduits portés) :
        // le projectile est détruit sur le bouclier, perforant ou non
        stop = i;
        break;
      }
      if (r === 0) continue;
      if (airY > 0) E5D[2]++; // § E5.D : coup aérien porté
      if (pKb[k] > 0) {
        // recul : de la source du coup vers le robot (dans le sens du tir si le robot est sur la source)
        let kx = EX[i] - (own ? pOX[k] : pSrc[so]);
        let kz = EZ[i] - (own ? pOZ[k] : pSrc[so + 1]);
        if (!(kx * kx + kz * kz > 1e-12)) {
          kx = pDX[k];
          kz = pDZ[k];
        }
        const q = (Math.round(Math.atan2(kz, kx) * DIR_SCALE) & DIR_MASK) * 2;
        if (ARG[A_KB + kind] !== pKb[k]) ARG[A_KB + kind] = pKb[k];
        ARGF[F_DX] = DIR[1 + q];
        ARGF[F_DZ] = DIR[2 + q];
        ARGF[F_V] = ARG[A_KB + kind];
        enemies.applyKnockbackF(i);
      }
      pHit[base + (pHitN[k] % HIT_MEM)] = uid;
      pHitN[k]++; // perforation ≤ CAPS.hitMemory : au plus hitMemory + 1 coups par projectile, pas de débordement
      if (kind === RICO) {
        // ricochet (§ E2.A) : pPierce = rebonds restants ; nouvelle cible = le robot le plus proche du robot touché, à
        // moins de « Saut » m, que ce projectile n'a pas encore touché. Sans cible ou sans rebond : il s'éteint.
        if (pPierce[k] > 0) {
          bounceTo = ricochetNext(k, i);
          if (bounceTo >= 0) {
            bounced = i;
            pPierce[k]--;
            break;
          }
        }
        stop = i;
        break;
      }
      if (pPierce[k] === 0) {
        stop = i;
        break;
      }
      pPierce[k]--;
    }
    if (bounced >= 0) {
      // rebond : le tir repart du robot touché, droit vers le suivant (éclat d'étoile au point de rebond)
      const bx = EX[bounced];
      const bz = EZ[bounced];
      let dx = EX[bounceTo] - bx;
      let dz = EZ[bounceTo] - bz;
      const l = Math.sqrt(dx * dx + dz * dz);
      if (l > 1e-6) {
        dx /= l;
        dz /= l;
      } else {
        dx = pDX[k];
        dz = pDZ[k];
      }
      // § E5.D : rebond sur un volant haut → l'éclat est à son altitude, le trajet suivant en part ; vers un volant
      // haut → tir aérien
      const yb = airMid[TYPE[bounced]];
      Q[0] = bx;
      Q[1] = yb > 0 ? yb : kHeight[kind];
      Q[2] = bz;
      V.impact(kind);
      pFromY[k] = yb;
      pAirY[k] = airMid[TYPE[bounceTo]];
      if (pAirY[k] > 0) E5D[0]++;
      pX[k] = bx;
      pZ[k] = bz;
      pSX[k] = bx;
      pSZ[k] = bz;
      pOX[k] = bx;
      pOZ[k] = bz;
      pDX[k] = dx;
      pDZ[k] = dz;
      pVX[k] = dx * W.projectileSpeed;
      pVZ[k] = dz * W.projectileSpeed;
      pLife[k] = (l * W.bounceSlack + ER[bounceTo]) / W.projectileSpeed;
      pTravel[k] = 0; // la traînée repart du point de rebond
      E2A[C_BOUNCES]++;
      continue;
    }
    if (stop >= 0) {
      // Point d'impact : le point du segment le plus proche du centre du robot touché.
      let t = ((EX[stop] - x0) * sx + (EZ[stop] - z0) * sz) * inv;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      pX[k] = x0 + sx * t;
      pZ[k] = z0 + sz * t;
      // distance parcourue depuis la position du tir (un impact entre le joueur et la bouche n'en ajoute pas)
      const tr = (pX[k] - fx0) * pDX[k] + (pZ[k] - fz0) * pDZ[k];
      if (tr > 0) pTravel[k] += tr;
      pSX[k] = pX[k];
      pSZ[k] = pZ[k];
      // dessin : éclat d'étoile sur le point d'impact, à la hauteur affichée du tir (src/vfx)
      Q[0] = pX[k];
      Q[1] = kHeight[kind] + (kind < RICO && __A.ACTIF[0] === 1 && pTravel[k] < 1 ? (__A.BY[kind] - kHeight[kind]) * (1 - pTravel[k]) : 0);
      if (airY > 0) Q[1] = airY; // § E5.D : impact d'un tir aérien, à l'altitude de vol
      Q[2] = pZ[k];
      V.impact(kind);
      if (W.impactLinger > 0) pLinger[k] = W.impactLinger;
      else removeProjectile(k);
    } else if (dead) {
      removeProjectile(k);
    } else {
      pX[k] = x1;
      pZ[k] = z1;
      pSX[k] = x1;
      pSZ[k] = z1;
      pTravel[k] += Math.sqrt(fsx * fsx + fsz * fsz);
    }
  }
}

// ----- Rayons et arcs ----------------------------------------------------------------------------------------------------

/**
 * Prend un emplacement du pool pour un segment (rayon du rail, ou morceau d'un arc de l'EMP) ; −1 si le pool est
 * plein. head = 1 pour le premier segment d'un rayon ou d'un arc : c'est lui que compte `active`, et c'est en têtes
 * que se compte la capacité (CAPS.beams rayons et arcs affichés, dont BEAM_RESERVE que les arcs laissent au rail).
 * Un arc dont la tête est refusée n'ajoute aucun segment (l'appelant s'arrête). L'appelant écrit lui-même le départ,
 * la direction, la longueur, la largeur et la durée du segment.
 */
function takeBeam(kind, head) {
  if (head === 1) {
    const heads = beamHeads[WEAPON.RAIL] + beamHeads[WEAPON.EMP];
    if (heads >= BCAP || (kind === WEAPON.EMP && beamHeads[kind] >= BCAP - BEAM_RESERVE)) return -1;
  }
  if (bCount >= BSEG) return -1; // garde : arcSegments segments au plus par tête, le maillage n'est jamais à court
  const k = bCount++;
  bKind[k] = kind;
  bHead[k] = head;
  if (head === 1) beamHeads[kind]++;
  return k;
}

function removeBeam(k) {
  if (bHead[k] === 1) beamHeads[bKind[k]]--;
  const last = --bCount;
  if (k !== last) {
    bX[k] = bX[last];
    bZ[k] = bZ[last];
    bDX[k] = bDX[last];
    bDZ[k] = bDZ[last];
    bLen[k] = bLen[last];
    bW[k] = bW[last];
    bLife[k] = bLife[last];
    bMax[k] = bMax[last];
    bKind[k] = bKind[last];
    bHead[k] = bHead[last];
  }
}

function updateBeams(dt) {
  for (let k = bCount - 1; k >= 0; k--) {
    bLife[k] -= dt;
    if (bLife[k] <= 0) removeBeam(k);
  }
}

// ----- Tirs ----------------------------------------------------------------------------------------------------------------
// Toutes les fonctions de tir sont appelées par update, après « if (dirty) recompute() » et la mise à jour des
// cases A_PX / A_PZ : elles lisent les stats effectives dans `effective` et la position du joueur dans ARG.

/** Son et secousse d'un déclenchement compté dans `shots` (règle commune du § I.2). */
function countShot(w) {
  const W = WEAPONS[w];
  __A.tir(w);
  shots[w]++;
  if (W.sonAuGeste !== true) audio.play(W.sfx, ARG[A_PX], ARG[A_PZ]); // § E5.G : lame, katana — le geste joue le souffle
  if (W.fireTrauma > 0) camera.addTrauma(W.fireTrauma, TRAUMA.FIRE);
}

/** Une salve : un projectile par cible, les plus proches d'abord ; le surplus part en éventail. false = aucune cible. */
function fireBlaster() {
  const w = WEAPON.BLASTER;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const count = Math.round(effective[o + STAT.COUNT]);
  const range = effective[o + STAT.AREA];
  if (ARG[A_RANGE + w] !== range) ARG[A_RANGE + w] = range;
  let found = grid.queryNearestN(ARG[A_PX], ARG[A_PZ], ARG[A_RANGE + w], targets, __A.FILTRE[0] === 1 ? 32 : count < 32 ? count : 32);
  if (prioPossible()) {
    // cible prioritaire à portée (§ E5.D : réparateur ; § E1.D : drone-bouclier du boss) : elle passe devant la plus proche
    PRIO_S[0] = range;
    found = priorityFirst(found, __A.FILTRE[0] === 1 ? 32 : count < 32 ? count : 32);
  }
  if (found === 0) return false;
  if (__A.FILTRE[0] === 1) {
    __A.viserBuste(w, targets[0]);
    let __c = 0;
    while (__c < found && __A.dansCone(targets[__c]) === 0) __c++;
    if (__c === found) {
      __A.attente(w);
      return false;
    }
    const __t = targets[__c]; // la plus proche DANS le cône passe en tête ; les tourelles gardent l'ordre des autres
    for (let __q = __c; __q > 0; __q--) targets[__q] = targets[__q - 1];
    targets[0] = __t;
  }
  __A.viserRobot(w, targets[0]);
  const px = P.x;
  const pz = P.z;
  const dmg = effective[o + STAT.DAMAGE];
  const pierce = Math.round(effective[o + STAT.SPECIAL]);
  const speed = W.projectileSpeed;
  const muzzle = W.muzzle; // le tir part du canon, pas du centre du joueur ; il atteint quand même `range`
  let firstX = P.moveX;
  let firstZ = P.moveZ;
  for (let k = 0; k < count; k++) {
    let dx;
    let dz;
    if (k < found) {
      const i = targets[k];
      dx = E.x[i] - px;
      dz = E.z[i] - pz;
      const l = Math.sqrt(dx * dx + dz * dz);
      if (l > 1e-6) {
        dx /= l;
        dz /= l;
      } else {
        dx = P.moveX;
        dz = P.moveZ;
      }
      if (k === 0) {
        firstX = dx;
        firstZ = dz;
      }
    } else {
      // moins de cibles que de projectiles : éventail autour de la première
      const j = k - found + 1;
      const a = ((Math.ceil(j / 2) * W.fanDeg * Math.PI) / 180) * ((j & 1) === 1 ? 1 : -1);
      const c = Math.cos(a);
      const s = Math.sin(a);
      dx = firstX * c + firstZ * s;
      dz = -firstX * s + firstZ * c;
    }
    if (k >= 1) {
      if (k < found) __A.viserTourelle(k, targets[k]);
      else {
        __A.V[0] = px + dx * 8;
        __A.V[1] = pz + dz * 8;
        __A.viserTourellePoint(k);
      }
    } else {
      __A.D[0] = dx;
      __A.D[1] = dz;
      if (__A.borner(w) === 1) {
        dx = __A.D[0];
        dz = __A.D[1];
      }
    }
    const j = takeProjectile(w);
    if (j < 0) break;
    const __tour = w === WEAPON.BLASTER && k >= 1;
    if ((__tour ? __A.boucheTourelle(k) : __A.bouche(w)) === 1) {
      pX[j] = __A.B[0];
      pZ[j] = __A.B[2];
      if (__tour) __A.tirTourelle(k, w);
    } else {
      pX[j] = px + dx * muzzle;
      pZ[j] = pz + dz * muzzle;
    }
    pDX[j] = dx;
    pDZ[j] = dz;
    pVX[j] = dx * speed;
    pVZ[j] = dz * speed;
    // la portée reste comptée du CENTRE du joueur : le vol s'arrête à `range` le long du tir, quel que soit le départ
    // (bouche du bras ou d'une tourelle, § Z sexies ; « centre + direction × muzzle » sinon : (range − muzzle) / speed, comme avant)
    pLife[j] = (range - ((pX[j] - px) * dx + (pZ[j] - pz) * dz)) / speed;
    pDmg[j] = dmg;
    pR[j] = W.projectileRadius;
    pKb[j] = W.knockback;
    pPierce[j] = pierce;
    pSrc[1 + 2 * j] = ARG[A_PX]; // source des coups : le point de départ de la salve (nombres déjà alloués)
    pSrc[2 + 2 * j] = ARG[A_PZ];
    if (k < found) visee(j, targets[k], w); // § E5.D : vers un volant haut, le tir vole à son altitude
  }
  countShot(w);
  return true;
}

/** § E5.D — le projectile j part vers le robot i (arme w) : vers un volant haut, il vole à son altitude (tir aérien). */
function visee(j, i, w) {
  // (aucun flottant en local : appelée par tir depuis du code froid, elle ne serait pas optimisée — § V)
  const t = E.type[i];
  if (airOk[t] === 0) return;
  pAirY[j] = AIRN[1 + t]; // nombre déjà alloué
  E5D[0]++;
  marquer(i, w);
}

/**
 * Secteur d'angle (0..SECTORS − 1, pas de 0,25°) du robot i vu depuis (px, pz) ; −1 s'il est sur ce point. Entier
 * toujours (jamais −0) : appelée par robot, elle est optimisée en quelques salves et n'alloue rien, là où la même
 * arithmétique écrite dans une fonction de tir peu appelée emballerait chaque flottant.
 */
function sectorAt(i, px, pz) {
  const dx = E.x[i] - px;
  const dz = E.z[i] - pz;
  if (!(dx * dx + dz * dz > 1e-12)) return -1;
  return (Math.round(Math.atan2(dz, dx) * SECTOR_SCALE) + SECTORS) % SECTORS;
}

/**
 * Fusil à pompe. Direction : parmi les W.groupCandidates robots les plus proches à portée, celle dont le cône
 * contient le plus de robots à portée ; à égalité, le plus proche. COUNT plombs dans le cône (le premier dans
 * l'axe, donc sur le robot visé), portée AREA, sans perforation, recul = SPECIAL. false = aucune cible.
 * Le décompte se fait en UNE passe sur les robots à portée : chacun est rangé dans son secteur d'angle (0,25°),
 * puis chaque candidat additionne les secteurs de son cône — des entiers, donc presque rien d'alloué même quand V8
 * n'a pas encore optimisé cette fonction, appelée une fois par salve seulement.
 */
function fireShotgun() {
  const w = WEAPON.SHOTGUN;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const range = effective[o + STAT.AREA];
  if (ARG[A_RANGE + w] !== range) ARG[A_RANGE + w] = range;
  const cand = grid.queryNearestN(ARG[A_PX], ARG[A_PZ], ARG[A_RANGE + w], targets, W.groupCandidates < 32 ? W.groupCandidates : 32);
  if (cand === 0) return false;
  const px = P.x;
  const pz = P.z;
  const EX = E.x;
  const EZ = E.z;
  let best = 0;
  let __bestCone = -1;
  let __bestConeN = -1;
  if (cand > 1) {
    // robots à portée, par secteur d'angle autour du joueur (sectorAt : petite fonction appelée par robot, vite
    // optimisée — la salve, elle, ne part qu'une à trois fois par seconde et reste du code froid qui emballerait
    // chaque flottant calculé dans la boucle : 20 à 30 Ko par salve mesurés dans une horde de 400)
    const n = grid.queryCircle(ARG[A_PX], ARG[A_PZ], ARG[A_RANGE + w], circOut, circOut.length);
    sectorCount.fill(0);
    for (let q = 0; q < n; q++) {
      const sec = sectorAt(circOut[q], ARG[A_PX], ARG[A_PZ]);
      if (sec >= 0) sectorCount[sec]++;
    }
    // le cône le plus rempli parmi les candidats
    const half = shotgunHalfSectors;
    let bestCount = -1;
    for (let c = 0; c < cand; c++) {
      let sec = sectorAt(targets[c], ARG[A_PX], ARG[A_PZ]);
      if (sec < 0) continue; // robot sur le joueur : pas de direction
      sec -= half;
      if (sec < 0) sec += SECTORS;
      let inside = 0;
      for (let d = half * 2; d >= 0; d--) {
        inside += sectorCount[sec];
        if (++sec === SECTORS) sec = 0;
      }
      if (__A.FILTRE[0] === 1 && inside > __bestConeN && __A.dansCone(targets[c]) === 1) {
        __bestConeN = inside;
        __bestCone = c;
      }
      if (inside > bestCount) {
        bestCount = inside; // strictement plus : à égalité le plus proche (les candidats sont triés) garde la main
        best = c;
      }
    }
  }
  // § E5.D : un réparateur à portée prend l'axe du cône (le plomb de l'axe vole à son altitude), devant le groupe
  PRIO_S[0] = range;
  const rep = repDuHeros();
  let tgt = targets[best];
  if (__A.FILTRE[0] === 1) {
    if (cand === 1 && __A.dansCone(targets[0]) === 1) __bestCone = 0;
    __A.viserBuste(w, rep >= 0 ? rep : targets[best]);
    if (rep >= 0 && __A.dansCone(rep) === 1) tgt = rep;
    else {
      if (__bestCone < 0) {
        __A.attente(w);
        return false;
      }
      best = __bestCone;
      tgt = targets[best];
    }
  } else if (rep >= 0) tgt = rep;
  let ax = EX[tgt] - px;
  let az = EZ[tgt] - pz;
  const al = Math.sqrt(ax * ax + az * az);
  if (al > 1e-6) {
    ax /= al;
    az /= al;
  } else {
    ax = P.moveX;
    az = P.moveZ;
  }
  __A.D[0] = ax;
  __A.D[1] = az;
  if (__A.borner(w) === 1) {
    ax = __A.D[0];
    az = __A.D[1];
  }
  __A.viserRobot(w, tgt);
  const count = Math.round(effective[o + STAT.COUNT]);
  const dmg = effective[o + STAT.DAMAGE];
  const recoil = effective[o + STAT.SPECIAL];
  const muzzle = W.muzzle;
  const cone = W.coneDeg * DEG;
  const gap = count > 1 ? cone / (count - 1) : 0; // angle entre deux plombs voisins
  // départ le long de l'axe : muzzle, ou la bouche du bras gauche (§ Z sexies) projetée sur l'axe, lue au premier plomb
  // (une fois par salve : un flottant de plus par plomb dans cette fonction peu appelée serait emballé, § V)
  let along = muzzle;
  for (let k = 0; k < count; k++) {
    let dx = ax;
    let dz = az;
    let speed = W.projectileSpeed;
    if (k > 0) {
      // plombs 1 à COUNT − 1 : répartis sur toute l'ouverture, avec un écart et une vitesse un peu irréguliers
      const a = (-0.5 + (k - 0.5) / (count - 1)) * cone + (rand() * 2 - 1) * W.spreadJitter * gap;
      const c = Math.cos(a);
      const s = Math.sin(a);
      dx = ax * c + az * s;
      dz = -ax * s + az * c;
      speed *= 1 + (rand() * 2 - 1) * W.speedJitter;
    }
    const j = takeProjectile(w);
    if (j < 0) break;
    const __tour = w === WEAPON.BLASTER && k >= 1;
    if ((__tour ? __A.boucheTourelle(k) : __A.bouche(w)) === 1) {
      pX[j] = __A.B[0];
      pZ[j] = __A.B[2];
      if (__tour) __A.tirTourelle(k, w);
      if (k === 0) along = (pX[j] - px) * ax + (pZ[j] - pz) * az;
    } else {
      pX[j] = px + dx * muzzle;
      pZ[j] = pz + dz * muzzle;
    }
    pDX[j] = dx;
    pDZ[j] = dz;
    pVX[j] = dx * speed;
    pVZ[j] = dz * speed;
    // chaque plomb atteint exactement la portée (comptée du centre), quelle que soit sa vitesse ; départ à la bouche du
    // bras (§ Z sexies) : `along` le long de l'axe (écart pour un plomb du bord du cône : ≈ 0,05 m)
    pLife[j] = (range - along) / speed;
    pDmg[j] = dmg;
    pR[j] = W.projectileRadius;
    pKb[j] = recoil;
    pSrc[1 + 2 * j] = ARG[A_PX]; // source des coups : le point de départ de la salve (nombres déjà alloués)
    pSrc[2 + 2 * j] = ARG[A_PZ];
    if (k === 0) visee(j, tgt, w); // § E5.D : le plomb de l'axe, vers un volant haut, vole à son altitude
  }
  countShot(w);
  return true;
}

/**
 * Impulsion du champ EMP. Aura : TOUS les robots dont le cercle touche le disque de rayon AREA sont touchés et
 * ralentis. Arcs : parmi les autres robots à moins de AREA × arcRangeMul, les COUNT plus proches reçoivent le même
 * coup et le même ralentissement, avec un arc affiché du bord de l'aura jusqu'à eux. false = aucun robot à portée.
 */
// fireEmp → empCandidat : rayon de l'aura et position du joueur (aucun flottant passé en argument)
const EMP_S = new Float64Array(3);
let empFound = 0;

/** Un robot de la requête de l'impulsion : dans l'aura, il est frappé et ralenti ; sinon candidat à un arc. */
function empCandidat(i, flags, arcs) {
  const w = WEAPON.EMP;
  const radius = EMP_S[0];
  const dx = E.x[i] - EMP_S[1];
  const dz = E.z[i] - EMP_S[2];
  const d2 = dx * dx + dz * dz;
  const touch = radius + E.radius[i];
  if (d2 <= touch * touch) {
    // dans l'aura
    ARGF[F_V] = ARG[A_DMG + w];
    ARGF[F_SX] = ARG[A_PX];
    ARGF[F_SZ] = ARG[A_PZ];
    damage.hitEnemyF(i, w, flags);
    ARGF[F_V] = ARG[A_SLOW];
    ARGF[F_T] = ARG[A_SLOW_T];
    enemies.applySlowF(i);
    return;
  }
  if (arcs === 0) return;
  // hors de l'aura : candidat à un arc, classé par distance au bord du robot (les `arcs` plus proches)
  const d = Math.sqrt(d2) - E.radius[i];
  const found = empFound;
  if (found >= arcs && d >= topVal[found - 1]) return;
  let p = found < arcs ? found : arcs - 1;
  while (p > 0 && topVal[p - 1] > d) {
    topVal[p] = topVal[p - 1];
    topIdx[p] = topIdx[p - 1];
    p--;
  }
  topVal[p] = d;
  topIdx[p] = i;
  if (found < arcs) empFound = found + 1;
}

function fireEmp() {
  const w = WEAPON.EMP;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const radius = effective[o + STAT.AREA];
  const reach = radius * W.arcRangeMul;
  if (ARG[A_RANGE + w] !== reach) ARG[A_RANGE + w] = reach;
  const n = grid.queryCircle(ARG[A_PX], ARG[A_PZ], ARG[A_RANGE + w], circOut, circOut.length);
  if (n === 0) return false;
  const px = P.x;
  const pz = P.z;
  // dégâts, ralentissement et durée : les mêmes pour tous les robots de l'impulsion (cases de ARG)
  const dmg = effective[o + STAT.DAMAGE];
  const factor = 1 - effective[o + STAT.SPECIAL] / 100;
  if (ARG[A_DMG + w] !== dmg) ARG[A_DMG + w] = dmg;
  if (ARG[A_SLOW] !== factor) ARG[A_SLOW] = factor;
  if (ARG[A_SLOW_T] !== W.slowSeconds) ARG[A_SLOW_T] = W.slowSeconds;
  const flags = flagsOf[w];
  let arcs = Math.round(effective[o + STAT.COUNT]);
  if (arcs > TOP) arcs = TOP;
  const EX = E.x;
  const EZ = E.z;
  const ALIVE = E.alive;
  // un appel PAR ROBOT (empCandidat) : fireEmp ne part que 1,5 à 3 fois par seconde et reste longtemps en code de base,
  // où chaque flottant de cette boucle était emballé (641 o/image relevés en charge maximale après 60 s, § Z nonies) ;
  // empCandidat, appelée des centaines de fois par seconde, est optimisée tout de suite
  EMP_S[0] = radius;
  EMP_S[1] = px;
  EMP_S[2] = pz;
  empFound = 0;
  for (let q = 0; q < n; q++) {
    const i = circOut[q];
    if (ALIVE[i] === 1) empCandidat(i, flags, arcs);
  }
  const found = empFound;
  const segs = W.arcSegments;
  for (let k = 0; k < found; k++) {
    const i = topIdx[k];
    if (ALIVE[i] === 0) continue;
    // arc : éclair brisé, du bord de l'aura jusqu'au robot (les brisures sont tirées par rand())
    const ex = EX[i];
    const ez = EZ[i];
    const dx = ex - px;
    const dz = ez - pz;
    const d = Math.sqrt(dx * dx + dz * dz); // > radius : le robot est hors de l'aura
    const x0 = px + (dx / d) * radius;
    const z0 = pz + (dz / d) * radius;
    const lx = ex - x0;
    const lz = ez - z0;
    const len = Math.sqrt(lx * lx + lz * lz);
    if (len > 1e-4) {
      const nx = -lz / len; // normale unitaire
      const nz = lx / len;
      let ax = x0;
      let az = z0;
      let head = 1;
      for (let s = 1; s <= segs; s++) {
        let bx = ex;
        let bz = ez;
        if (s < segs) {
          const off = (rand() * 2 - 1) * W.arcJitter * len;
          bx = x0 + (lx * s) / segs + nx * off;
          bz = z0 + (lz * s) / segs + nz * off;
        }
        const sx = bx - ax;
        const sz = bz - az;
        const sl = Math.sqrt(sx * sx + sz * sz);
        if (sl > 1e-4) {
          const b = takeBeam(w, head);
          if (b < 0) break; // pool plein : l'arc n'est pas affiché, le coup porte quand même
          head = 0;
          bX[b] = ax;
          bZ[b] = az;
          bDX[b] = sx / sl;
          bDZ[b] = sz / sl;
          bLen[b] = sl;
          bW[b] = 0;
          bLife[b] = W.arcSeconds;
          bMax[b] = W.arcSeconds;
          // dessin : segment d'arc daté (src/vfx) ; le dernier finit sur le robot frappé (éclat bleu)
          Q[0] = ax;
          Q[1] = W.arcHeight;
          Q[2] = az;
          Q[4] = bDX[b];
          Q[5] = 0;
          Q[6] = bDZ[b];
          Q[7] = sl;
          V.arc(s === segs ? 1 : 0);
        }
        ax = bx;
        az = bz;
      }
    }
    ARGF[F_V] = ARG[A_DMG + w];
    ARGF[F_SX] = ARG[A_PX];
    ARGF[F_SZ] = ARG[A_PZ];
    damage.hitEnemyF(i, w, flags);
    ARGF[F_V] = ARG[A_SLOW];
    ARGF[F_T] = ARG[A_SLOW_T];
    enemies.applySlowF(i);
  }
  // impulsion visible : éclat de l'aura et de l'orbe, onde au sol (dessinés par le lot CONTINUS, src/vfx)
  S[S_PULSE] = 1;
  countShot(w);
  return true;
}

/**
 * Salve du fusil à rail. Cibles : les COUNT robots vivants qui ont le plus de PV à moins de AREA m — parcours
 * linéaire de E, à chaque salve seulement. À PV ÉGAUX (le cas courant : tous les robots intacts d'un même type), le
 * plus proche d'abord, mais un robot à moins de W.spreadDeg d'un rayon déjà retenu passe son tour tant qu'un autre,
 * aux mêmes PV, est ailleurs : un rayon traverse déjà tout ce qui est sur son axe, les suivants couvrent d'autres
 * directions au lieu de repasser dans le même couloir. Les PV passent toujours avant l'écart.
 * Un rayon par cible, du joueur vers elle, long de AREA, large de SPECIAL : perforation totale, et il continue
 * derrière un bouclier qui l'arrête. false = aucune cible.
 */
// fireRail → railCandidat : portée et position du joueur (aucun flottant passé en argument)
const RAIL_S = new Float64Array(3);
let railFound = 0;

/** Un robot candidat au rail : gardé parmi les RAIL_POOL plus solides à portée (puis les plus proches). */
function railCandidat(i) {
  const dx = E.x[i] - RAIL_S[1];
  const dz = E.z[i] - RAIL_S[2];
  const d2 = dx * dx + dz * dz;
  const reach = RAIL_S[0] + E.radius[i];
  if (d2 > reach * reach) return;
  const hp = E.hp[i];
  const found = railFound;
  if (found >= RAIL_POOL && (hp < railHp[found - 1] || (hp === railHp[found - 1] && d2 >= railD2[found - 1]))) return;
  let p = found < RAIL_POOL ? found : RAIL_POOL - 1;
  while (p > 0 && (railHp[p - 1] < hp || (railHp[p - 1] === hp && railD2[p - 1] > d2))) {
    railHp[p] = railHp[p - 1];
    railD2[p] = railD2[p - 1];
    railIdx[p] = railIdx[p - 1];
    p--;
  }
  railHp[p] = hp;
  railD2[p] = d2;
  railIdx[p] = i;
  if (found < RAIL_POOL) railFound = found + 1;
}

function fireRail() {
  const w = WEAPON.RAIL;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  let count = Math.round(effective[o + STAT.COUNT]);
  if (count > TOP) count = TOP;
  const range = effective[o + STAT.AREA];
  const px = P.x;
  const pz = P.z;
  const EX = E.x;
  const EZ = E.z;
  const ALIVE = E.alive;
  const total = E.count;
  // 1. candidats : les RAIL_POOL robots à portée les plus solides, puis les plus proches. Un appel PAR ROBOT
  //    (railCandidat) : fireRail ne part qu'environ une fois par seconde, V8 la laisse en code de base où chaque
  //    flottant de la boucle sur 400 robots était emballé (99 à 96 230 o/s selon le passage, § Y ; § Z nonies)
  RAIL_S[0] = range;
  RAIL_S[1] = px;
  RAIL_S[2] = pz;
  railFound = 0;
  for (let i = 0; i < total; i++) if (ALIVE[i] === 1) railCandidat(i);
  if (prioPossible()) {
    // cible prioritaire à portée (§ E5.D : réparateur ; § E1.D : drone-bouclier du boss) : premier rayon pour elle, devant le plus solide
    PRIO_S[0] = range;
    railPriority();
  }
  const found = railFound;
  if (found === 0) return false;
  for (let c = 0; c < found; c++) {
    const i = railIdx[c];
    let sec = Math.round(Math.atan2(EZ[i] - pz, EX[i] - px) * SECTOR_SCALE);
    if (sec < 0) sec += SECTORS;
    railSector[c] = sec;
    railTaken[c] = 0;
  }
  const dmg = effective[o + STAT.DAMAGE];
  const width = effective[o + STAT.SPECIAL];
  const half = width * 0.5;
  if (ARG[A_DMG + w] !== dmg) ARG[A_DMG + w] = dmg;
  if (ARG[A_HALF] !== half) ARG[A_HALF] = half;
  if (ARG[A_KB + w] !== W.knockback) ARG[A_KB + w] = W.knockback;
  const flags = flagsOf[w];
  const kb = W.knockback;
  const gap = railGapSectors;
  let __railCone = -1;
  if (__A.FILTRE[0] === 1) {
    __A.viserBuste(w, railIdx[0]);
    for (let c = 0; c < found; c++)
      if (__A.dansCone(railIdx[c]) === 1) {
        __railCone = c; // 1er rayon (bras) : le plus solide DANS le cône
        break;
      }
    if (__railCone < 0) {
      __A.attente(w);
      return false;
    }
  }
  const beams = count < found ? count : found;
  for (let k = 0; k < beams; k++) {
    // 2. la cible du k-ième rayon : le premier candidat libre (le plus solide) ; parmi ceux qui ont LES MÊMES PV,
    //    le premier qui est à l'écart des rayons déjà retenus — à défaut, le premier libre.
    let first = 0;
    while (railTaken[first] === 1) first++;
    let pick = first;
    for (let c = first; c < found && railHp[c] === railHp[first]; c++) {
      if (railTaken[c] === 1) continue;
      let apart = true;
      for (let q = 0; q < k; q++) {
        let d = railSector[c] - pickSector[q];
        if (d < 0) d = -d;
        if (d > SECTORS / 2) d = SECTORS - d;
        if (d < gap) {
          apart = false;
          break;
        }
      }
      if (apart) {
        pick = c;
        break;
      }
    }
    if (k === 0 && __railCone >= 0) pick = __railCone;
    railTaken[pick] = 1;
    pickSector[k] = railSector[pick];
    const t = railIdx[pick];
    if (k === 0) __A.viserRobot(w, t);
    else __A.viserTourelle(k, t); // rayons 2 à 5 : tourelles d'épaule
    if (k === 0) marquer(t, w); // § E5.D : premier rayon sur le réparateur prioritaire (le rayon perfore tout : rien d'autre à faire)
    let dx = EX[t] - px;
    let dz = EZ[t] - pz;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l > 1e-6) {
      dx /= l;
      dz /= l;
    } else {
      dx = P.moveX;
      dz = P.moveZ;
    }
    __A.D[0] = dx;
    __A.D[1] = dz;
    if (k === 0 && __A.borner(w) === 1) {
      dx = __A.D[0];
      dz = __A.D[1];
    }
    const n = grid.querySegment(ARG[A_PX], ARG[A_PZ], px + dx * range, pz + dz * range, ARG[A_HALF], segOut, segOut.length);
    for (let q = 0; q < n; q++) {
      const i = segOut[q];
      if (ALIVE[i] === 0) continue;
      // source du coup = position du joueur ; un coup arrêté par un bouclier (−1) n'arrête pas le rayon
      ARGF[F_V] = ARG[A_DMG + w];
      ARGF[F_SX] = ARG[A_PX];
      ARGF[F_SZ] = ARG[A_PZ];
      if (damage.hitEnemyF(i, w, flags) > 0 && kb > 0 && ALIVE[i] === 1) {
        // recul : du joueur vers le robot (dans le sens du rayon si le robot est sur le joueur)
        let kx = EX[i] - px;
        let kz = EZ[i] - pz;
        if (!(kx * kx + kz * kz > 1e-12)) {
          kx = dx;
          kz = dz;
        }
        const d = (Math.round(Math.atan2(kz, kx) * DIR_SCALE) & DIR_MASK) * 2;
        ARGF[F_DX] = DIR[1 + d];
        ARGF[F_DZ] = DIR[2 + d];
        ARGF[F_V] = ARG[A_KB + w];
        enemies.applyKnockbackF(i);
      }
    }
    const b = takeBeam(w, 1);
    if (b >= 0) {
      let by = W.beamHeight;
      if ((k >= 1 ? __A.boucheTourelle(k) : __A.bouche(w)) === 1) {
        bX[b] = __A.B[0];
        bZ[b] = __A.B[2];
        by = __A.B[1];
        if (k >= 1) __A.tirTourelle(k, w);
      } else {
        bX[b] = px + dx * W.muzzle; // le rayon AFFICHÉ part du canon
        bZ[b] = pz + dz * W.muzzle;
      }
      bDX[b] = dx;
      bDZ[b] = dz;
      bLen[b] = range - W.muzzle;
      bW[b] = width * W.beamWidthScale;
      bLife[b] = W.beamSeconds;
      bMax[b] = W.beamSeconds;
      // dessin : rayon daté + éclair de bouche (src/vfx), de la bouche (bras ou tourelle) jusqu'au bout de la portée
      Q[0] = bX[b];
      Q[1] = by;
      Q[2] = bZ[b];
      Q[3] = bW[b];
      Q[4] = dx;
      Q[5] = 0;
      Q[6] = dz;
      Q[7] = bLen[b];
      V.rail();
      if (evolved[w] !== 0 && evo !== null) {
        // § E3.B : Lance-prisme — le rayon se diffracte en rayons qui ricochent
        ARGF[F_X_E3C] = bX[b];
        ARGF[F_Z_E3C] = bZ[b];
        ARGF[F_DX] = dx;
        ARGF[F_DZ] = dz;
        evo.eventF(w);
      }
    }
  }
  countShot(w);
  return true;
}

/**
 * Salve de roquettes : une par paquet de robots à portée (grid.findDensest), du plus gros au moins gros. false =
 * aucun paquet. La roquette vole droit, sans guidage : elle vise donc le point où le paquet SERA à son arrivée —
 * le barycentre du paquet, avancé de la vitesse moyenne de ses robots pendant la durée du vol (résolue par
 * itérations, la durée dépendant elle-même du point visé). Sans cela un paquet qui marche a quitté le point visé
 * avant l'explosion, d'autant plus que le tir part de loin. Le point visé ne sort jamais de la portée.
 */
function fireRockets() {
  const w = WEAPON.ROCKETS;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  let count = Math.round(effective[o + STAT.COUNT]);
  if (count > 8) count = 8;
  const range = effective[o + STAT.AREA];
  if (ARG[A_RANGE + w] !== range) ARG[A_RANGE + w] = range;
  let found = grid.findDensest(ARG[A_PX], ARG[A_PZ], ARG[A_RANGE + w], densOut, __A.FILTRE[0] === 1 ? 8 : count);
  if (prioPossible()) {
    // cible prioritaire à portée (§ E5.D : réparateur ; § E1.D : drone-bouclier du boss) : la première roquette est pour elle
    PRIO_S[0] = range;
    found = rocketPriority(found, __A.FILTRE[0] === 1 ? 8 : count);
  }
  if (found === 0) return false;
  let __n = found;
  if (__A.FILTRE[0] === 1) {
    __A.V[0] = densOut[0];
    __A.V[1] = densOut[1];
    __A.viserBustePoint(w);
    let __m = 0;
    for (let q = 0; q < found; q++) {
      __A.V[0] = densOut[q * 2];
      __A.V[1] = densOut[q * 2 + 1];
      if (__A.dansConeV() === 1) {
        densOut[__m * 2] = densOut[q * 2];
        densOut[__m * 2 + 1] = densOut[q * 2 + 1];
        __m++;
      }
    }
    if (__m === 0) {
      __A.attente(w);
      return false;
    }
    __n = count < found ? count : found;
    for (let q = __m; q < __n; q++) {
      densOut[q * 2] = densOut[(q % __m) * 2];
      densOut[q * 2 + 1] = densOut[(q % __m) * 2 + 1];
    }
  }
  const px = P.x;
  const pz = P.z;
  const dmg = effective[o + STAT.DAMAGE];
  const blast = effective[o + STAT.SPECIAL];
  const speed = W.projectileSpeed;
  const muzzle = W.muzzle;
  for (let k = 0; k < __n; k++) {
    let tx = densOut[k * 2];
    let tz = densOut[k * 2 + 1];
    // vitesse moyenne des robots du paquet (ceux qui entourent son barycentre), bornée : un recul reçu à l'instant
    // ne doit pas envoyer la roquette au loin. La somme passe par addVelocity (appelée par robot, vite optimisée) :
    // écrite ici, dans une fonction qui ne part qu'une fois par seconde, chaque flottant serait emballé.
    const near = grid.queryCircle(tx, tz, W.leadRadius, circOut, circOut.length);
    LEAD[0] = 0;
    LEAD[1] = 0;
    LEAD[2] = 0;
    for (let q = 0; q < near; q++) addVelocity(circOut[q]);
    const m = LEAD[2];
    if (m > 0) {
      let vx = LEAD[0] / m;
      let vz = LEAD[1] / m;
      const v2 = vx * vx + vz * vz;
      if (v2 > W.leadMaxSpeed * W.leadMaxSpeed) {
        const f = W.leadMaxSpeed / Math.sqrt(v2);
        vx *= f;
        vz *= f;
      }
      if (v2 > 1e-6) {
        // durée du vol jusqu'au point visé = (distance − canon) / vitesse de la roquette ; deux itérations
        // suffisent (le paquet marche 5 à 10 fois moins vite que la roquette)
        let t = 0;
        for (let it = 0; it < 2; it++) {
          const ax = tx + vx * t - px;
          const az = tz + vz * t - pz;
          const d = Math.sqrt(ax * ax + az * az);
          t = d > muzzle ? (d - muzzle) / speed : 0;
        }
        // point anticipé hors du cône du buste : la roquette vise le paquet là où il est (il était dans le cône,
        // filtré plus haut) au lieu d'être ramenée au bord du cône par borner (correction du 14/11/2026, § Z nonies :
        // 2 salves bornées relevées sur une partie de 10 vagues, contrôle « partie »)
        const tx0 = tx;
        const tz0 = tz;
        tx += vx * t;
        tz += vz * t;
        if (__A.FILTRE[0] === 1) {
          __A.V[0] = tx;
          __A.V[1] = tz;
          if (__A.dansConeV() === 0) {
            tx = tx0;
            tz = tz0;
          }
        }
      }
    }
    let dx = tx - px;
    let dz = tz - pz;
    let l = Math.sqrt(dx * dx + dz * dz);
    if (l > 1e-6) {
      dx /= l;
      dz /= l;
    } else {
      dx = P.moveX;
      dz = P.moveZ;
    }
    __A.D[0] = dx;
    __A.D[1] = dz;
    if (__A.borner(w) === 1) {
      dx = __A.D[0];
      dz = __A.D[1];
      tx = px + dx * l;
      tz = pz + dz * l;
    }
    if (l > range) {
      // un paquet qui s'éloigne : le point visé reste à portée
      l = range;
      tx = px + dx * l;
      tz = pz + dz * l;
    }
    __A.V[0] = tx;
    __A.V[1] = tz;
    __A.viserPoint(w);
    const lead = l > muzzle ? muzzle : l; // départ du canon, sans dépasser le point visé
    const j = takeProjectile(w);
    if (j < 0) break;
    if (__A.bouche(w) === 1) {
      pX[j] = __A.B[0];
      pZ[j] = __A.B[2];
    } else {
      pX[j] = px + dx * lead;
      pZ[j] = pz + dz * lead;
    }
    pDX[j] = dx;
    pDZ[j] = dz;
    pVX[j] = dx * speed;
    pVZ[j] = dz * speed;
    pLife[j] = (l - lead) / speed;
    pDmg[j] = dmg;
    pR[j] = W.projectileRadius;
    pTX[j] = tx;
    pTZ[j] = tz;
    pBlast[j] = blast;
    // traînée : un emplacement de src/vfx tenu par la roquette jusqu'à son arrivée (graine stable : Q[0])
    Q[0] = rand();
    pSlot[j] = V.traineOuvrir();
  }
  countShot(w);
  return true;
}

/** Roquettes : ajoute la vitesse du robot i à la somme du paquet (LEAD : vx, vz, nombre). */
function addVelocity(i) {
  if (E.alive[i] === 0) return;
  LEAD[0] += E.vx[i];
  LEAD[1] += E.vz[i];
  LEAD[2] += 1;
}

/** Une salve de l'arme w (hors orbitaux). false = aucune cible : pas de tir, la recharge reste prête. */
function fire(w) {
  switch (w) {
    case WEAPON.BLASTER:
      return fireBlaster();
    case WEAPON.SHOTGUN:
      return fireShotgun();
    case WEAPON.EMP:
      return fireEmp();
    case WEAPON.RAIL:
      return fireRail();
    case WEAPON.ROCKETS:
      return fireRockets();
    case WEAPON.RICOCHET:
      return fireRicochet();
    case WEAPON.BLADE:
      return fireBlade();
    case WEAPON.BOOMERANG:
      return fireBoomerang();
    case WEAPON.MINES:
      return fireMines();
    default:
      return w >= WEAPON.KATANA ? WA.fireF(w) : false; // § E3.N

  }
}

/** Disques affichés : stat COUNT, bornée à la capacité du maillage. */
function discCount() {
  const n = Math.round(getStat(WEAPON.ORBITALS, STAT.COUNT));
  return n > OCAP ? OCAP : n;
}

/**
 * Disques orbitaux : COUNT disques répartis à AREA m du joueur, à RATE tours par seconde. Chaque disque frappe tout
 * robot qu'il touche (centres à moins de SPECIAL + rayon du robot) dont le délai est écoulé, puis lui redonne
 * orbitalHitDelay (E.orbitCd) : un coup par passage de disque.
 *
 * Instant EXACT du contact, pas l'image. Le délai vaut 0,9 passage : la marge avant le disque suivant (0,0185 s avec
 * 6 disques à 0,9 tour/s, 0,009 s avec un bonus de cadence × 2) est plus courte qu'une image à 30 images par
 * seconde. Tout calcul arrondi à l'image (délai testé en fin d'image, contact échantillonné par sous-pas) perdait ou
 * doublait des coups selon la cadence (mesuré à 30 images par seconde : 4,6 coups par seconde pour 5,4 passages,
 * moins qu'au niveau précédent ; 9,6 pour 10,8 avec le bonus). Ici, pour chaque robot rendu par la requête :
 *   - l'arc de contact est calculé : un disque à l'angle a touche le robot (distance ρ, angle φ) quand
 *     cos(a − φ) ≥ (AREA² + ρ² − touche²) / (2 · AREA · ρ), soit a ∈ [φ − h, φ + h] ;
 *   - l'instant où il redevient frappable est connu à la fraction d'image près (orbDue, horloge du module, rangé
 *     avec l'uid du robot : E.orbitCd, borné à 0 par enemies.update, ne dit plus QUAND le délai a expiré) ;
 *   - le coup part au premier instant de l'image où les deux sont vrais (un disque dans l'arc ET délai écoulé), et
 *     le délai suivant part de cet instant-là.
 * Le résultat ne dépend plus de la cadence : un robot immobile reçoit exactement un coup par passage de disque, à
 * 30 comme à 240 images par seconde, et rien n'est sauté quelle que soit la vitesse des disques (pas d'échantillon :
 * l'arc parcouru pendant l'image est traité en entier). E.orbitCd reste écrit (délai restant en fin d'image) pour
 * enemies.update et le contrat.
 *
 * UNE requête de grille par image (le cercle qui contient toute l'orbite) ; position du robot en fin de pas (après
 * enemies.update), comme pour les autres armes.
 */
function updateOrbitals(dt) {
  const w = WEAPON.ORBITALS;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  let count = Math.round(effective[o + STAT.COUNT]);
  if (count > OCAP) count = OCAP;
  const rate = effective[o + STAT.RATE];
  const omega = TAU * rate; // rad/s
  const dAngle = omega * dt; // rotation des disques pendant l'image
  const a0 = S[S_ORBIT];
  const clock0 = S[S_CLOCK]; // horloge du module au début de l'image
  if (count > 0 && rate > 0) {
    const orbit = effective[o + STAT.AREA] * EVO_ORBIT[0]; // § E3.B : Couronne de scies (1 sans l'évolution)
    const size = effective[o + STAT.SPECIAL];
    const reach = orbit + size;
    if (ARG[A_ORB_REACH] !== reach) ARG[A_ORB_REACH] = reach;
    const n = grid.queryCircle(ARG[A_PX], ARG[A_PZ], ARG[A_ORB_REACH], circOut, circOut.length);
    if (n > 0) {
      // délai avant un nouveau coup sur le même robot : recalculé seulement quand « Disques » ou « Vitesse » change
      if (S[S_ORB_COUNT] !== count || S[S_ORB_RATE] !== rate) {
        S[S_ORB_COUNT] = count;
        S[S_ORB_RATE] = rate;
        S[S_ORB_DELAY] = orbitalHitDelay(count, rate);
      }
      const delay = S[S_ORB_DELAY];
      const uDelay = delay * omega; // le délai, en rotation des disques
      const slice = TAU / count; // angle entre deux disques voisins
      const dmg = effective[o + STAT.DAMAGE];
      if (ARG[A_DMG + w] !== dmg) ARG[A_DMG + w] = dmg;
      if (ARG[A_KB + w] !== W.knockback) ARG[A_KB + w] = W.knockback;
      const flags = flagsOf[w];
      const kb = W.knockback;
      const ALIVE = E.alive;
      const UID = E.uid;
      const ORB = E.orbitCd;
      const EX = E.x;
      const EZ = E.z;
      const ER = E.radius;
      const px = P.x;
      const pz = P.z;
      const orbit2 = orbit * orbit;
      const clock1 = clock0 + dt;
      for (let q = 0; q < n; q++) {
        const i = circOut[q];
        if (ALIVE[i] === 0) continue;
        // instant (en rotation des disques depuis le début de l'image) où le robot redevient frappable
        let uReady = 0;
        if (orbUid[i] === UID[i]) {
          const t = orbDue[i] - clock0;
          if (t > 0) uReady = t * omega;
        } else if (ORB[i] > 0) {
          uReady = (dt + ORB[i]) * omega; // délai posé avant que ce module ne connaisse le robot : fin d'image + reste
        }
        if (uReady > dAngle) continue; // pas encore frappable pendant cette image
        // arc de contact : demi-angle h autour de l'angle φ du robot
        const ex = EX[i] - px;
        const ez = EZ[i] - pz;
        const rho2 = ex * ex + ez * ez;
        const touch = size + ER[i];
        const touch2 = touch * touch;
        let half;
        if (rho2 < 1e-8) {
          if (orbit2 > touch2) continue; // robot au centre, hors de portée de l'orbite
          half = Math.PI;
        } else {
          const kappa = (orbit2 + rho2 - touch2) / (2 * orbit * Math.sqrt(rho2));
          if (kappa > 1) continue; // l'orbite passe trop loin de ce robot
          half = kappa <= -1 ? Math.PI : Math.acos(kappa);
        }
        const phi = rho2 < 1e-8 ? 0 : Math.atan2(ez, ex);
        let u = uReady;
        let hits = 0;
        while (u <= dAngle && hits < ORB_MAX_HITS) {
          if (half * 2 < slice) {
            // position du disque le plus proche derrière le bord d'entrée de l'arc, dans [0, slice)
            let g = (a0 + u - phi + half) % slice;
            if (g < 0) g += slice;
            if (g > half * 2) u += slice - g; // aucun disque dans l'arc : attendre le prochain qui y entre
            if (u > dAngle) break;
          }
          ARGF[F_V] = ARG[A_DMG + w];
          ARGF[F_SX] = ARG[A_PX]; // source du coup = position du joueur
          ARGF[F_SZ] = ARG[A_PZ];
          if (damage.hitEnemyF(i, w, flags) <= 0) break;
          hits++;
          const due = clock0 + u / omega + delay;
          orbDue[i] = due;
          orbUid[i] = UID[i];
          ORB[i] = due > clock1 ? due - clock1 : 0; // délai restant à la fin de l'image (décompté par enemies.update)
          countShot(w); // `shots` des orbitaux = coups portés par les disques
          if (kb > 0 && ALIVE[i] === 1) {
            // recul : du joueur vers le robot (dans le sens du disque si le robot est sur le joueur)
            const d = rho2 > 1e-12
              ? (Math.round(phi * DIR_SCALE) & DIR_MASK) * 2
              : (Math.round((a0 + u) * DIR_SCALE) & DIR_MASK) * 2;
            ARGF[F_DX] = DIR[1 + d];
            ARGF[F_DZ] = DIR[2 + d];
            ARGF[F_V] = ARG[A_KB + w];
            enemies.applyKnockbackF(i);
          }
          if (ALIVE[i] === 0) break;
          u += uDelay;
        }
      }
    }
  }
  // angles et horloge toujours finis : une cadence ou un pas de temps non fini d'une seule image ne fige pas les
  // disques en NaN
  const a1 = a0 + dAngle;
  S[S_ORBIT] = a1 >= 0 ? (a1 >= TAU ? a1 % TAU : a1) : 0;
  const spin = S[S_SPIN] + TAU * W.spinHz * dt;
  S[S_SPIN] = spin >= 0 ? (spin >= TAU ? spin % TAU : spin) : 0;
  if (dt > 0) S[S_CLOCK] = clock0 + dt;
}

// ----- Boucle (S8) ---------------------------------------------------------------------------------------------------

/**
 * Relève quelles armes ont des stats utilisables (30 comparaisons). Les valeurs de `effective` ne sont pas touchées :
 * getStat et la boutique continuent d'afficher ce que le modèle calcule.
 */
function checkStats() {
  for (let w = 0; w < WEAPON_COUNT; w++) {
    let ok = 1;
    const o = w * STAT_COUNT;
    for (let s = 0; s < STAT_COUNT; s++) {
      const v = effective[o + s];
      if (!(v >= 0 && v < Infinity)) ok = 0;
    }
    usable[w] = ok;
  }
}

// ----- § E3.H : sources à recharge (src/cooldowns.js) --------------------------------------------------------------
// Une arme en mode recharge n'agit que pendant sa FENÊTRE (le gros coup) : GATE[w] = 0 sinon. Pendant la fenêtre, ses
// dégâts sont × burst (effective est relevé au début de update et rendu à la fin : sync, la boutique et les fiches lisent
// toujours la vraie valeur), sa cadence × rateMul, et une salve de départ part à l'ouverture. Départ seulement si un
// robot est à portée (RECHARGES[clé].reach) : la recharge n'est jamais gâchée dans le vide.
let CD = null;
const GATE = new Uint8Array(WEAPON_COUNT).fill(1);
const CD_SAVE = new Float64Array(WEAPON_COUNT);
const CD_BOOST = new Uint8Array(WEAPON_COUNT);
const CD_REACH = new Float64Array(WEAPON_COUNT);
const CD_PROBE = new Uint16Array(1);
for (let w = 0; w < WEAPON_COUNT; w++) {
  const R = RECHARGES.weapons ? RECHARGES.weapons[WEAPON_KEYS[w]] : null;
  CD_REACH[w] = R && R.reach > 0 ? R.reach : 8;
}

function cdBegin() {
  for (let w = 0; w < WEAPON_COUNT; w++) {
    GATE[w] = 1;
    CD_BOOST[w] = 0;
    if (!CD.isCooldown(0, w) || owned[w] === 0 || usable[w] === 0) continue;
    if (CD.ready(0, w) && P.alive && grid.queryCircle(P.x, P.z, CD_REACH[w], CD_PROBE, 1) > 0) {
      CD.consume(0, w);
      fireAcc[w] = 1; // la salve normale de la fenêtre part dès cette image
      if (w === WEAPON.POOL) PO_S[0] = 0; // la nappe lance dès l'ouverture (son minuteur ne court que dans la fenêtre)
    }
    if (!CD.active(0, w)) {
      GATE[w] = 0;
      continue;
    }
    const o = w * STAT_COUNT + STAT.DAMAGE;
    CD_SAVE[w] = effective[o];
    effective[o] = CD_SAVE[w] * CD.burstOf(0, w);
    CD_BOOST[w] = 1;
  }
}

function cdSalvos() {
  for (let w = 0; w < WEAPON_COUNT; w++) {
    if (CD_BOOST[w] === 0 || CD.salvoOf(0, w) === 0 || !CD.justFired(0, w)) continue;
    if (w === WEAPON.ORBITALS || w === WEAPON.TURRET || w === WEAPON.POOL || WA.selfTimed(w)) continue;
    const n = CD.salvoOf(0, w);
    for (let k = 0; k < n; k++) if (!fire(w)) break;
  }
}

function cdEnd() {
  for (let w = 0; w < WEAPON_COUNT; w++) {
    if (CD_BOOST[w] === 0) continue;
    effective[w * STAT_COUNT + STAT.DAMAGE] = CD_SAVE[w];
    CD_BOOST[w] = 0;
  }
}

/** § E3.H : l'arme w agit cette image (pas en recharge). Lu par weapons-agents.js. */
export function gate(w) {
  return GATE[w] === 1;
}

export function update(dt) {
  if (dirty) recompute();
  checkStats();
  if (MARK_T[0] > 0) MARK_T[0] -= dt; // § E5.D : le réticule s'éteint s'il n'est plus visé
  if (CD !== null) {
    cdBegin();
    updateE3H(dt);
    cdEnd();
    return;
  }
  updateE3H(dt);
}

function updateE3H(dt) {
  if (CD !== null) cdSalvos();
  // Position du joueur pour les appels par coup : les cases ne sont réécrites que s'il a bougé.
  if (ARG[A_PX] !== P.x) ARG[A_PX] = P.x;
  if (ARG[A_PZ] !== P.z) ARG[A_PZ] = P.z;
  // Les tirs en vol d'abord, les nouveaux tirs ensuite : un tir créé pendant cette image est dessiné une fois à
  // la sortie du canon avant d'être balayé (à l'image suivante). Dans l'autre ordre, un tir sur une cible au
  // contact était créé, avancé et détruit dans la même image : jamais affiché.
  if (pCount > 0) updateProjectiles(dt);
  if (bCount > 0) updateBeams(dt);
  if (evo !== null) evo.update(dt); // § E3.B : effets des armes évoluées (projectiles évolués, échos, ondes)
  if (S[S_PULSE] > 0) {
    const p = S[S_PULSE] - dt / WEAPONS[WEAPON.EMP].pulseSeconds;
    S[S_PULSE] = p > 0 ? p : 0;
  }
  if (!P.alive) return;
  CB.update(dt); // § E3.M : les gestes avancent avant que les armes lisent leur image d'impact
  if (ATT_GAP[0] > 0) ATT_GAP[0] -= dt; // § E5.F : pause entre deux combos de la lame
  PG.update(dt); // § E5.F : coups de poing du Bastion (impact lu ici, après les gestes)
  if (bladePending > 0 || CB.busy(COMBO.BLADE) === 1) updateBlade(dt); // balayages restants d'une salve de la lame de phase (§ E2.A)
  if (owned[WEAPON.TURRET] === 1 && usable[WEAPON.TURRET] === 1) updateTurrets(dt); // sentinelles : pose, tirs, durée
  if (owned[WEAPON.ORBITALS] === 1 && usable[WEAPON.ORBITALS] === 1 && GATE[WEAPON.ORBITALS] === 1) updateOrbitals(dt);
  // § E2.B : nappes (lancers, morsures) et mines (armement, détection) — hors de la boucle des cadences
  if (poolCount > 0 || owned[WEAPON.POOL] === 1) updatePools(dt);
  if (mineCount > 0) updateMines(dt);
  // Toutes les armes possédées tirent en même temps : t += dt × cadence, une salve tant que t ≥ 1.
  // § E4.O.3 : pendant le coup de pied, aucune salve (la cadence s'accumule et attend, bornée à une salve)
  const coupe = armesCoupees();
  for (let w = 0; w < WEAPON_COUNT; w++) {
    if (owned[w] === 0 || usable[w] === 0 || w === WEAPON.ORBITALS || w === WEAPON.TURRET || w === WEAPON.POOL || WA.selfTimed(w)) continue;
    if (GATE[w] === 0) continue; // § E3.H : en recharge
    if (coupe) {
      const t = fireAcc[w] + dt * effective[w * STAT_COUNT + STAT.RATE];
      fireAcc[w] = t >= 0 ? (t > 1 ? 1 : t) : 1;
      continue;
    }
    let t = fireAcc[w] + dt * effective[w * STAT_COUNT + STAT.RATE] * (CD_BOOST[w] === 1 ? CD.rateOf(0, w) : 1);
    let fired = 0;
    while (t >= 1 && fired < LOOP.maxShotsPerFrame) {
      if (!fire(w)) break; // aucune cible : pas de tir, la recharge reste prête
      t -= 1;
      fired++;
    }
    // recharge toujours finie : un NaN gardé ici désarmerait l'arme jusqu'au prochain reset()
    fireAcc[w] = t >= 0 ? (t > 1 ? 1 : t) : 1;
  }
  WA.update(dt); // § E3.N : coupes, échos, ondes, objets en vol, nuages, canon
}

// ----- Écriture des instances (F11) ----------------------------------------------------------------------------------

export function sync() {
  if (dirty) recompute(); // sync tourne aussi hors simulation (boutique, pause) : les stats lues ici sont à jour
  checkStats();
  if (!P.alive) {
    // Joueur mort : update ne tourne plus (GAMEOVER), rien ne ferait s'éteindre les rayons et les arcs en cours —
    // ils resteraient en travers de l'écran pendant tout le game over. Ils quittent le pool, comme les disques et
    // l'anneau quittent l'écran.
    bCount = 0;
    beamHeads.fill(0);
  }
  // Rayons et arcs d'une arme retirée (debugSetOwned) : ils quittent le pool ici, avant d'être dessinés.
  for (let k = bCount - 1; k >= 0; k--) if (owned[bKind[k]] === 0) removeBeam(k);

  // --- tirs du blaster, plombs, têtes de roquette : lot TIRS de src/vfx, une passe sur le pool ; traînées des roquettes
  const a = V.tampon(LOT_TIRS);
  const cap = V.capacite(LOT_TIRS);
  let n = 0;
  if (pCount > 0) {
    const BLASTER = WEAPON.BLASTER;
    const ROCKETS = WEAPON.ROCKETS;
    const WR = WEAPONS[ROCKETS];
    const rocketSpeed = WR.projectileSpeed;
    const rocketBase = WR.shotHeight;
    const rocketArc = WR.arcHeight;
    const rocketFull = WR.arcFullDistance;
    for (let k = 0; k < pCount; k++) {
      const kind = pKind[k];
      const c = pDZ[k]; // direction (s, c) = (x, z)
      const s = pDX[k];
      if (kind === ROCKETS) {
        // roquette : le long de sa cloche (lacet + tangage) ; la tête mène sa traînée
        const left = pLife[k] > 0 ? pLife[k] * rocketSpeed : 0;
        const total = pTravel[k] + left;
        let y = rocketBase + (__A.ACTIF[0] === 1 && pTravel[k] < 1 ? (__A.BY[ROCKETS] - rocketBase) * (1 - pTravel[k]) : 0);
        let slope = 0;
        if (total > 1e-6) {
          const u = pTravel[k] / total;
          const h = rocketArc * (total < rocketFull ? total / rocketFull : 1);
          y += h * 4 * u * (1 - u);
          slope = (h * 4 * (1 - 2 * u)) / total;
        }
        const cp = 1 / Math.sqrt(1 + slope * slope);
        const slot = pSlot[k];
        if (slot >= 0) {
          Q[0] = pX[k];
          Q[1] = y;
          Q[2] = pZ[k];
          V.traineAvancer(slot);
        }
        if (n >= cap) continue;
        const p = n * STRIDE;
        n++;
        a[p] = pX[k];
        a[p + 1] = y;
        a[p + 2] = pZ[k];
        a[p + 3] = VFX.roquette.tete;
        a[p + 4] = cp * s;
        a[p + 5] = slope * cp;
        a[p + 6] = cp * c;
        a[p + 7] = VFX.roquette.flamme;
        a[p + 8] = VFX_STYLE.ROQUETTE;
        a[p + 9] = slot >= 0 ? slot * 0.37 : 0;
        a[p + 10] = 1;
        a[p + 11] = VFX.roquette.marge;
        continue;
      }
      if (n >= cap) continue;
      if (kind >= WEAPON.POOL) {
        // flacon de la nappe, boomerang (§ E2.B)
        if (kind === WEAPON.POOL) syncFlask(k, a, n * STRIDE);
        else syncBoomerang(k, a, n * STRIDE);
        n++;
        continue;
      }
      if (kind >= WEAPON.RICOCHET) {
        // ricochet, tir de sentinelle (§ E2.A) : trait en losange à la couleur de l'arme (partie entière de la graine)
        const D = kind === WEAPON.TURRET ? VFX.sentinelle : VFX.ricochet;
        let f = pLinger[k] > 0 ? pLinger[k] * kLingerInv[kind] : 1;
        if (f > 1) f = 1;
        const L = pTravel[k] < D.traine ? pTravel[k] : D.traine;
        const h = Math.sin((Math.atan2(s, c) * 7.31 + kind) * 12.9898) * 43758.5453;
        const p = n * STRIDE;
        n++;
        a[p] = pX[k];
        // le premier trajet d'un ricochet descend de la bouche du bras à sa hauteur de vol (comme le blaster)
        a[p + 1] = kHeight[kind] + (kind === WEAPON.RICOCHET && pHitN[k] === 0 && __A.ACTIF[0] === 1 && pTravel[k] < 1 ? (__A.BY[kind] - kHeight[kind]) * (1 - pTravel[k]) : 0);
        a[p + 2] = pZ[k];
        a[p + 3] = D.tete;
        a[p + 4] = s;
        a[p + 5] = 0;
        a[p + 6] = c;
        if (pAirY[k] > 0 || pFromY[k] > 0) volAir(k, a, p); // § E5.D : tir aérien (monte, puis vole à l'altitude de sa cible)
        a[p + 7] = L;
        a[p + 8] = VFX_STYLE.RICOCHET;
        a[p + 9] = kind + (h - Math.floor(h)) * 0.999;
        a[p + 10] = f;
        a[p + 11] = D.marge;
        continue;
      }
      const blaster = kind === BLASTER;
      // un tir arrêté sur un impact s'éteint (f : 1 → 0 pendant impactLinger)
      let f = pLinger[k] > 0 ? pLinger[k] * kLingerInv[kind] : 1;
      if (f > 1) f = 1;
      // traînée : jamais plus loin que la bouche (pTravel), au plus la traînée du style
      const traine = blaster ? VFX.comete.traine : VFX.plomb.traine;
      const L = pTravel[k] < traine ? pTravel[k] : traine;
      // graine stable d'un tir : son cap (il ne tourne jamais)
      const h = Math.sin((Math.atan2(s, c) * 7.31 + kind) * 12.9898) * 43758.5453;
      const p = n * STRIDE;
      n++;
      a[p] = pX[k];
      a[p + 1] = kHeight[kind] + (__A.ACTIF[0] === 1 && pTravel[k] < 1 ? (__A.BY[kind] - kHeight[kind]) * (1 - pTravel[k]) : 0);
      a[p + 2] = pZ[k];
      a[p + 3] = blaster ? VFX.comete.tete : VFX.plomb.tete;
      a[p + 4] = s;
      a[p + 5] = 0;
      a[p + 6] = c;
      a[p + 7] = blaster ? L * VFX.comete.quad : L;
      a[p + 8] = blaster ? VFX_STYLE.COMETE : VFX_STYLE.PLOMB;
      a[p + 9] = h - Math.floor(h);
      a[p + 10] = f;
      a[p + 11] = blaster ? VFX.comete.marge : VFX.plomb.marge;
      if (pAirY[k] > 0) volAir(k, a, p); // § E5.D
    }
  }
  // § E5.D : réticule autour du réparateur visé (même lot : aucun maillage de plus)
  // En ligne ici (sync est optimisée ; une fonction appelée une fois par image ne l'est jamais et emballait ~9 nombres,
  // 107 o/image mesurés) : seule la recherche rare après une compaction de E est à part (entiers seulement).
  if (RET_ON === 1 && MARK_T[0] > 0 && n < cap) {
    const ri = marqueVivante();
    if (ri >= 0 && E.sus[ri] === 0) {
      let fo = MARK_T[0] * RETK[1];
      if (fo > 1) fo = 1;
      if (n === 0) E5D[4]++;
      E5D[3]++;
      const p = n * STRIDE;
      n++;
      a[p] = E.x[ri];
      a[p + 1] = airMid[E.type[ri]];
      a[p + 2] = E.z[ri];
      a[p + 3] = RETK[2];
      a[p + 4] = 1;
      a[p + 5] = 0;
      a[p + 6] = 0;
      a[p + 7] = 0;
      a[p + 8] = RETK[4];
      a[p + 9] = fo; // fondu dans la graine : iC.z (lu par src/rendu/lumieres.js comme intensité de tache) reste 0
      a[p + 10] = 0;
      a[p + 11] = RETK[3];
    }
  }
  V.compte[LOT_TIRS] = n;

  // --- disques orbitaux, traînée circulaire, aura et orbe de l'EMP : lot CONTINUS
  const ac = V.tampon(LOT_CONTINUS);
  let nc = 0;
  if (owned[WEAPON.ORBITALS] === 1 && usable[WEAPON.ORBITALS] === 1 && P.alive && GATE[WEAPON.ORBITALS] === 1) {
    const w = WEAPON.ORBITALS;
    let nd = Math.round(effective[w * STAT_COUNT + STAT.COUNT]);
    if (nd > OCAP) nd = OCAP;
    const orbit = effective[w * STAT_COUNT + STAT.AREA] * EVO_ORBIT[0]; // § E3.B
    const size = effective[w * STAT_COUNT + STAT.SPECIAL];
    const y = WEAPONS[w].height;
    const cs = Math.cos(S[S_SPIN]); // rotation des disques sur eux-mêmes (axe local x du quad couché)
    const sn = Math.sin(S[S_SPIN]);
    const a0 = S[S_ORBIT];
    const slice = TAU / nd;
    const e = __A.DOS[3]; // < 1 : les disques sortent encore du cœur dorsal du héros
    for (let k = 0; k < nd; k++) {
      const ang = a0 + k * slice;
      const p = nc * STRIDE;
      nc++;
      ac[p] = e >= 1 ? P.x + Math.cos(ang) * orbit : __A.DOS[0] + (P.x + Math.cos(ang) * orbit - __A.DOS[0]) * e;
      ac[p + 1] = e >= 1 ? y : __A.DOS[1] + (y - __A.DOS[1]) * e;
      ac[p + 2] = e >= 1 ? P.z + Math.sin(ang) * orbit : __A.DOS[2] + (P.z + Math.sin(ang) * orbit - __A.DOS[2]) * e;
      ac[p + 3] = size;
      ac[p + 4] = cs;
      ac[p + 5] = 0;
      ac[p + 6] = sn;
      ac[p + 7] = 0;
      ac[p + 8] = VFX_STYLE.DISQUE;
      ac[p + 9] = k;
      ac[p + 10] = 1;
      ac[p + 11] = size * VFX.disque.quad;
    }
    if (nd > 0) {
      // traînée circulaire de tous les disques : une instance centrée sur le héros, rayon = orbite DESSINÉE du premier
      // disque (plus courte pendant la sortie du dos), sens de rotation × nombre de disques dans la graine (+ : l'angle
      // de l'orbite croît toujours)
      const ox = ac[0] - P.x;
      const oz = ac[2] - P.z;
      const r = Math.sqrt(ox * ox + oz * oz);
      if (r > 1e-3) {
        const p = nc * STRIDE;
        nc++;
        ac[p] = P.x;
        ac[p + 1] = ac[1];
        ac[p + 2] = P.z;
        ac[p + 3] = r;
        ac[p + 4] = ox / r;
        ac[p + 5] = 0;
        ac[p + 6] = oz / r;
        ac[p + 7] = size;
        ac[p + 8] = VFX_STYLE.TRAINE_DISQUES;
        ac[p + 9] = nd;
        ac[p + 10] = 1;
        ac[p + 11] = r + size * VFX.disque.traine;
      }
    }
  }
  if (owned[WEAPON.EMP] === 1 && usable[WEAPON.EMP] === 1 && P.alive) {
    // aura : bord électrique au rayon AREA + onde de chaque impulsion ; orbe au plastron (pulse : S_PULSE, 1 → 0)
    const radius = effective[WEAPON.EMP * STAT_COUNT + STAT.AREA];
    const pulse = S[S_PULSE];
    let p = nc * STRIDE;
    nc++;
    ac[p] = P.x;
    ac[p + 1] = VFX.aura.hauteur;
    ac[p + 2] = P.z;
    ac[p + 3] = radius;
    ac[p + 4] = 1;
    ac[p + 5] = 0;
    ac[p + 6] = 0;
    ac[p + 7] = 0;
    ac[p + 8] = VFX_STYLE.AURA_EMP;
    ac[p + 9] = EMP_STYLE[0]; // § E5.EMP : variante dans la graine
    ac[p + 10] = pulse;
    ac[p + 11] = radius + VFX.aura.marge;
  }
  if (owned[WEAPON.EMP] === 1 && usable[WEAPON.EMP] === 1 && P.alive && EMP_STYLE[0] === 0) {
    // orbe au plastron : seulement en 'actuel' (§ E5.EMP : les variantes ne dessinent rien sur le héros)
    const pulse = S[S_PULSE];
    const p = nc * STRIDE;
    nc++;
    ac[p] = P.x;
    ac[p + 1] = VFX.orbe.hauteur;
    ac[p + 2] = P.z;
    ac[p + 3] = VFX.orbe.rayon;
    ac[p + 4] = 0;
    ac[p + 5] = 0;
    ac[p + 6] = 1;
    ac[p + 7] = 0;
    ac[p + 8] = VFX_STYLE.ORBE_EMP;
    ac[p + 9] = 0;
    ac[p + 10] = pulse;
    ac[p + 11] = VFX.orbe.rayon * 1.35;
  }
  if (owned[WEAPON.TURRET] === 1) nc = syncChamps(ac, nc, V.capacite(LOT_CONTINUS)); // § E3.Z.12 : bulles des tourelles
  nc = syncPoolsMines(ac, nc, V.capacite(LOT_CONTINUS)); // § E2.B : nappes et mines au sol
  V.compte[LOT_CONTINUS] = nc;
  syncTurrets();
  WA.sync(); // § E3.N : grenades, obus, nuages, canon lourd
  if (evo !== null) evo.sync(); // § E3.B : projectiles évolués, à la suite du lot TIRS
  // Rayons du rail et arcs de l'EMP : dessinés par leurs événements datés, émis à leur naissance (fireRail, fireEmp) ;
  // le pool ne sert plus qu'au jeu (capacité, `active`, extinction à la mort du joueur ou au retrait de l'arme).
}

/** Ce que l'arme a en jeu : projectiles, disques, rayons ou arcs affichés (rien pour une arme non possédée). */
function activeOf(w) {
  if (w === WEAPON.ORBITALS) return owned[w] === 1 && usable[w] === 1 && P.alive && GATE[w] === 1 ? discCount() : 0;
  if (w === WEAPON.EMP || w === WEAPON.RAIL) return owned[w] === 1 ? beamHeads[w] : 0;
  if (w === WEAPON.POOL) return activeByKind[w] + poolCount; // flacons en vol + nappes au sol (§ E2.B)
  if (w === WEAPON.MINES) return mineCount;
  return activeByKind[w];
}

/** arr : tableau de WEAPON_COUNT objets neufs fourni par debug.js. La sentinelle porte en plus `turrets` (tourelles en vie). */
export function inspect(arr) {
  if (dirty) recompute();
  checkStats();
  for (let w = 0; w < WEAPON_COUNT; w++) {
    const o = arr[w];
    o.id = w;
    o.key = WEAPON_KEYS[w];
    o.owned = owned[w] === 1;
    o.level = getWeaponLevel(w);
    o.overcharge = overcharge[w]; // crans de surcharge (§ E1.D)
    o.slot = slots.indexOf(w); // emplacement (§ E2.C) : rang d'obtention, −1 = aucun
    const lv = {};
    const st = {};
    for (let s = 0; s < STAT_COUNT; s++) {
      lv[STAT_KEYS[s]] = levels[w * STAT_COUNT + s];
      st[STAT_KEYS[s]] = getStat(w, s);
    }
    o.levels = lv;
    o.stats = st;
    o.shots = shots[w];
    o.active = activeOf(w);
    o.evolved = evolved[w]; // § E3.B : 0 ou id d'évolution + 1
    o.absorbed = absorbed[w] === 1;
  }
  arr[WEAPON.TURRET].turrets = turretCount;
  arr[WEAPON.POOL].pools = poolCount; // § E2.B
  arr[WEAPON.MINES].mines = mineCount;
  WA.inspect((arr[WEAPON.KATANA].agents = {})); // § E3.N : compteurs des six armes des arsenaux
}

// =====================================================================================================================
// ÉTAPE 2, CHANTIER A (ARCHITECTURE.md § E2.A) — Ricochet, Lame de phase, Sentinelle
// =====================================================================================================================
// Ricochet   : tir droit du pool commun (pKind = WEAPON.RICOCHET) ; ses rebonds sont traités dans updateProjectiles.
// Lame       : pas de projectile ; un balayage = les robots de l'arc, frappés tout de suite ; dessin = un croissant daté.
// Sentinelle : pool de CAPS.turrets tourelles (tableaux typés), un InstancedMesh « tourelles » (+1 appel de dessin) ;
//              leurs tirs sont des projectiles du pool commun (pKind = WEAPON.TURRET), dessinés dans le lot TIRS.
// Rien n'est alloué en combat : les recherches de cible lisent la grille en ligne, par des fonctions qui ne reçoivent
// que des entiers (§ V) ; les sources des coups sont dans des tableaux typés (pOX, pOZ).

// Compteurs et relevés lus par les tests (debugE2A)
const C_BOUNCES = 0; // rebonds de ricochet depuis le reset
const C_SWEEPS = 1; // balayages de la lame
const C_SWEEP_HITS = 2; // robots touchés par le dernier balayage
const C_SWEEP_BLOCKED = 3; // coups du dernier balayage arrêtés par un bouclier
const C_POSED = 4; // tourelles posées depuis le reset
const C_LAST = 5; // + 3 × (w − WEAPON.RICOCHET) : départ (x, y, z) du dernier tir de l'arme w
const E2A = new Float64Array(C_LAST + 9);

// ----- Recherche du robot le plus proche d'un point (ricochet : hors des robots déjà touchés ; tourelle : tous) -------
const NEAR_S = new Float64Array(3); // x, z, rayon de recherche (m, du point au BORD du robot)

/**
 * Robot vivant le plus proche du point NEAR_S (distance des centres − rayon ≤ NEAR_S[2]), hors du robot `skip` et, si
 * k ≥ 0, hors de ceux que le projectile k a déjà touchés ; −1 sinon. Lecture en ligne de la grille (§ F), boss à part.
 */
function nearestFrom(skip, k) {
  const x = NEAR_S[0];
  const z = NEAR_S[1];
  const r = NEAR_S[2];
  const EX = E.x;
  const EZ = E.z;
  const ER = E.radius;
  const ALIVE = E.alive;
  const UID = E.uid;
  const cellStart = grid.cellStart;
  const cellCount = grid.cellCount;
  const items = grid.items;
  let margin = grid.getMaxRadius();
  if (!(margin > sweepMargin)) margin = sweepMargin;
  const reach = r + margin;
  let cx0 = Math.floor((x - reach - GRID_MIN) * GRID_INV);
  let cx1 = Math.floor((x + reach - GRID_MIN) * GRID_INV);
  let cz0 = Math.floor((z - reach - GRID_MIN) * GRID_INV);
  let cz1 = Math.floor((z + reach - GRID_MIN) * GRID_INV);
  if (cx0 < 0) cx0 = 0;
  if (cz0 < 0) cz0 = 0;
  if (cx1 > GRID_LAST) cx1 = GRID_LAST;
  if (cz1 > GRID_LAST) cz1 = GRID_LAST;
  const base = k * HIT_MEM;
  const mem = k >= 0 ? (pHitN[k] < HIT_MEM ? pHitN[k] : HIT_MEM) : 0;
  let best = -1;
  let bestD = r;
  for (let cz = cz0; cz <= cz1; cz++) {
    const row = cz * GRID_DIM;
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = row + cx;
      const cnt = cellCount[c];
      if (cnt === 0) continue;
      const first = cellStart[c];
      for (let q = first; q < first + cnt; q++) {
        const i = items[q];
        if (ALIVE[i] === 0 || i === skip) continue;
        const dx = EX[i] - x;
        const dz = EZ[i] - z;
        const d = Math.sqrt(dx * dx + dz * dz) - ER[i];
        if (d > bestD) continue;
        let seen = false;
        const uid = UID[i];
        for (let h = 0; h < mem; h++) {
          if (pHit[base + h] === uid) {
            seen = true;
            break;
          }
        }
        if (seen) continue;
        if (d < bestD || best < 0) {
          bestD = d;
          best = i;
        }
      }
    }
  }
  const b = E.bossIndex;
  if (b >= 0 && ALIVE[b] === 1 && b !== skip) {
    const dx = EX[b] - x;
    const dz = EZ[b] - z;
    const d = Math.sqrt(dx * dx + dz * dz) - ER[b];
    if (d <= bestD) {
      let seen = false;
      const uid = UID[b];
      for (let h = 0; h < mem; h++) if (pHit[base + h] === uid) seen = true;
      if (!seen && (d < bestD || best < 0)) best = b;
    }
  }
  return best;
}

/** Ricochet : prochaine cible du projectile k qui vient de toucher le robot i (« Saut » m autour de lui) ; −1 sinon. */
function ricochetNext(k, i) {
  NEAR_S[0] = E.x[i];
  NEAR_S[1] = E.z[i];
  NEAR_S[2] = effective[WEAPON.RICOCHET * STAT_COUNT + STAT.AREA];
  return nearestFrom(i, k);
}

/**
 * Salve du ricochet : COUNT projectiles, un par cible (les plus proches à `range` m, la première DANS le cône du
 * buste), le surplus en éventail. Chaque projectile part de la bouche du bras droit (bouche_ricochet) et porte
 * SPECIAL rebonds. false = aucune cible.
 */
function fireRicochet() {
  const w = WEAPON.RICOCHET;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const count = Math.round(effective[o + STAT.COUNT]);
  if (ARG[A_RANGE + w] !== W.range) ARG[A_RANGE + w] = W.range;
  const want = __A.FILTRE[0] === 1 ? 32 : count < 32 ? count : 32;
  let found = grid.queryNearestN(ARG[A_PX], ARG[A_PZ], ARG[A_RANGE + w], targets, want);
  if (VOL_ON === 1 && E.aliveByType[REP_T] > 0) {
    PRIO_S[0] = W.range; // § E5.D : le réparateur à portée passe en tête
    found = repFirst(found, want);
  }
  if (found === 0) return false;
  if (__A.FILTRE[0] === 1) {
    __A.viserBuste(w, targets[0]);
    let c = 0;
    while (c < found && __A.dansCone(targets[c]) === 0) c++;
    if (c === found) {
      __A.attente(w);
      return false;
    }
    // seules les cibles DANS le cône sont visées (tout part du même bras) : elles sont tassées en tête, dans l'ordre
    let m = 0;
    for (let q = c; q < found; q++) if (__A.dansCone(targets[q]) === 1) targets[m++] = targets[q];
    found = m;
  }
  __A.viserRobot(w, targets[0]);
  const px = P.x;
  const pz = P.z;
  const dmg = effective[o + STAT.DAMAGE];
  const bounces = Math.round(effective[o + STAT.SPECIAL]);
  const speed = W.projectileSpeed;
  let firstX = P.moveX;
  let firstZ = P.moveZ;
  for (let k = 0; k < count; k++) {
    let dx;
    let dz;
    if (k < found) {
      const i = targets[k];
      dx = E.x[i] - px;
      dz = E.z[i] - pz;
      const l = Math.sqrt(dx * dx + dz * dz);
      if (l > 1e-6) {
        dx /= l;
        dz /= l;
      } else {
        dx = P.moveX;
        dz = P.moveZ;
      }
      if (k === 0) {
        __A.D[0] = dx;
        __A.D[1] = dz;
        if (__A.borner(w) === 1) {
          dx = __A.D[0];
          dz = __A.D[1];
        }
        firstX = dx;
        firstZ = dz;
      }
    } else {
      const j = k - found + 1;
      const a = Math.ceil(j / 2) * W.fanDeg * DEG * ((j & 1) === 1 ? 1 : -1);
      const c = Math.cos(a);
      const s = Math.sin(a);
      dx = firstX * c + firstZ * s;
      dz = -firstX * s + firstZ * c;
    }
    const j = takeProjectile(w);
    if (j < 0) break;
    if (__A.bouche(w) === 1) {
      pX[j] = __A.B[0];
      pZ[j] = __A.B[2];
      E2A[C_LAST + 1] = __A.B[1];
    } else {
      pX[j] = px + dx * W.muzzle;
      pZ[j] = pz + dz * W.muzzle;
      E2A[C_LAST + 1] = W.shotHeight;
    }
    E2A[C_LAST] = pX[j];
    E2A[C_LAST + 2] = pZ[j];
    pDX[j] = dx;
    pDZ[j] = dz;
    pVX[j] = dx * speed;
    pVZ[j] = dz * speed;
    pLife[j] = (W.range - ((pX[j] - px) * dx + (pZ[j] - pz) * dz)) / speed;
    pDmg[j] = dmg;
    pR[j] = W.projectileRadius;
    pKb[j] = W.knockback;
    pPierce[j] = bounces < 255 ? bounces : 255; // rebonds restants
    if (k < found) visee(j, targets[k], w); // § E5.D
  }
  countShot(w);
  return true;
}

// ----- Lame de phase ------------------------------------------------------------------------------------------------------
const BL_DX = 0; // direction de visée de la salve
const BL_DZ = 1;
const BL_T = 2; // s avant le prochain balayage
const BL_COS = 3; // cosinus du demi-arc
const BL_R = 4; // portée
const BL_PX = 5; // position du héros au balayage
const BL_PZ = 6;
const BL_CONTACT = 7; // § E3.N : bord du robot à moins de « contact » m du héros → touché quel que soit l'angle
const BLADE_S = new Float64Array(8);
let bladePending = 0; // balayages restants de la salve
let bladeSide = 1; // sens du prochain balayage (alterné)
let bladeFound = 0;
const BLADE_MAX = 32;
const bladeIdx = new Uint16Array(BLADE_MAX);
const bladeD2 = new Float32Array(BLADE_MAX);

/** Un robot de la requête du balayage : gardé s'il est à portée et dans l'arc, classé du plus proche au plus loin. */
function bladeCandidat(i, cap) {
  const dx = E.x[i] - BLADE_S[BL_PX];
  const dz = E.z[i] - BLADE_S[BL_PZ];
  const d2 = dx * dx + dz * dz;
  const reach = BLADE_S[BL_R] + E.radius[i];
  if (d2 > reach * reach) return;
  // dans l'arc : angle entre la visée et le robot ≤ demi-arc (un robot sur le héros est toujours dans l'arc) ;
  // § E3.N (retour de Femz du 15/11, 20h53) : un robot au contact est touché quel que soit l'angle
  const contact = BLADE_S[BL_CONTACT] + E.radius[i];
  if (d2 > contact * contact && d2 > 1e-8 && (dx * BLADE_S[BL_DX] + dz * BLADE_S[BL_DZ]) / Math.sqrt(d2) < BLADE_S[BL_COS]) return;
  const found = bladeFound;
  if (found >= cap && d2 >= bladeD2[found - 1]) return;
  let p = found < cap ? found : cap - 1;
  while (p > 0 && bladeD2[p - 1] > d2) {
    bladeD2[p] = bladeD2[p - 1];
    bladeIdx[p] = bladeIdx[p - 1];
    p--;
  }
  bladeD2[p] = d2;
  bladeIdx[p] = i;
  if (found < cap) bladeFound = found + 1;
}

/** Un balayage : tous les robots de l'arc (maxHits au plus, les plus proches), recul, croissant dessiné depuis la bouche. */
function sweepBlade() {
  const w = WEAPON.BLADE;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const range = effective[o + STAT.AREA];
  // § E3.M : le geste du combo donne le multiplicateur (vrille × 2,2) et l'arc (la vrille frappe tout autour)
  const arcM = CB.arcDeg(COMBO.BLADE);
  const arc = (arcM > 0 ? arcM : effective[o + STAT.SPECIAL]) * DEG;
  const dmg = effective[o + STAT.DAMAGE] * CB.mul(COMBO.BLADE) * (COMBO_ATTAQUE.actif ? ATT_F[0] : 1); // § E5.F : facteur par geste
  if (ARG[A_RANGE + w] !== range) ARG[A_RANGE + w] = range;
  if (ARG[A_DMG + w] !== dmg) ARG[A_DMG + w] = dmg;
  if (ARG[A_KB + w] !== W.knockback) ARG[A_KB + w] = W.knockback;
  BLADE_S[BL_COS] = arc * 0.5 < Math.PI ? Math.cos(arc * 0.5) : -2; // −2 : tout autour (vrille), sans arrondi
  BLADE_S[BL_R] = range;
  BLADE_S[BL_PX] = P.x;
  BLADE_S[BL_PZ] = P.z;
  BLADE_S[BL_CONTACT] = W.contact > 0 ? W.contact : 0;
  const n = grid.queryCircle(ARG[A_PX], ARG[A_PZ], ARG[A_RANGE + w], circOut, circOut.length);
  const cap = W.maxHits < BLADE_MAX ? W.maxHits : BLADE_MAX;
  bladeFound = 0;
  const ALIVE = E.alive;
  for (let q = 0; q < n; q++) if (ALIVE[circOut[q]] === 1) bladeCandidat(circOut[q], cap);
  const flags = flagsOf[w];
  const kb = W.knockback;
  let hits = 0;
  let blocked = 0;
  for (let q = 0; q < bladeFound; q++) {
    const i = bladeIdx[q];
    if (ALIVE[i] === 0) continue;
    ARGF[F_V] = ARG[A_DMG + w];
    ARGF[F_SX] = ARG[A_PX]; // source du coup = le héros : le bouclier d'un blindé de face l'arrête
    ARGF[F_SZ] = ARG[A_PZ];
    const r = WA.strikeBladeF(i, w); // § E3.N : critique assuré sur un robot aveuglé par un fumigène
    if (r < 0 || r === 2) blocked++; // § E4.P : 2 = atténué par le bouclier d'un blindé de face (le coup porte)
    if (r <= 0) continue;
    hits++;
    if (kb > 0 && ALIVE[i] === 1) {
      const kx = E.x[i] - P.x;
      const kz = E.z[i] - P.z;
      const d = kx * kx + kz * kz > 1e-12 ? (Math.round(Math.atan2(kz, kx) * DIR_SCALE) & DIR_MASK) * 2 : (Math.round(Math.atan2(BLADE_S[BL_DZ], BLADE_S[BL_DX]) * DIR_SCALE) & DIR_MASK) * 2;
      ARGF[F_DX] = DIR[1 + d];
      ARGF[F_DZ] = DIR[2 + d];
      ARGF[F_V] = ARG[A_KB + w];
      enemies.applyKnockbackF(i);
    }
  }
  E2A[C_SWEEPS]++;
  E2A[C_SWEEP_HITS] = hits;
  E2A[C_SWEEP_BLOCKED] = blocked;
  // dessin : croissant daté (src/vfx), centré sur la bouche de la lame (bras gauche) ; son bord extérieur est à la
  // portée du coup dans l'axe de visée. Le test de coup, lui, part du centre du héros (comme le rail).
  let ox = P.x;
  let oy = W.arcHeight;
  let oz = P.z;
  // § E5.F.13 (demande de Femz du 17/11 : « les coups de droite partent de bouche_lame_d ») : taille DROITE = seconde
  // lame, sur l'avant-bras droit (pose dessinée) ; tailles gauches et vrille : la lame gauche, comme avant
  if ((CB.gesteOf(COMBO.BLADE) === CB_GESTE.TAILLE_D && __A.boucheLameD() === 1) || __A.bouche(w) === 1) {
    ox = __A.B[0];
    oy = __A.B[1];
    oz = __A.B[2];
  }
  let along = (ox - P.x) * BLADE_S[BL_DX] + (oz - P.z) * BLADE_S[BL_DZ];
  if (along > range * 0.5) along = range * 0.5;
  // § E3.N : la traînée reste DANS la zone de touche — rayon dessiné = portée − écart bouche / héros − drawPad,
  // arc dessiné = arc − drawArcPadDeg (la zone de touche couvre ce que montre la traînée, et un peu plus)
  const off = Math.sqrt((ox - P.x) * (ox - P.x) + (oz - P.z) * (oz - P.z));
  let drawR = W.drawPad >= 0 ? range - off - W.drawPad : range - along;
  if (drawR < 0.5) drawR = 0.5;
  const drawArc = W.drawArcPadDeg > 0 ? arc - W.drawArcPadDeg * DEG : arc;
  E3N_BLADE[0] = ox;
  E3N_BLADE[1] = oz;
  E3N_BLADE[2] = drawR;
  E3N_BLADE[3] = drawArc;
  E3N_BLADE[4] = BLADE_S[BL_DX];
  E3N_BLADE[5] = BLADE_S[BL_DZ];
  E3N_BLADE[6] = P.x;
  E3N_BLADE[7] = P.z;
  E3N_BLADE[8] = range;
  E3N_BLADE[9] = arc;
  E2A[C_LAST + 3] = ox;
  E2A[C_LAST + 4] = oy;
  E2A[C_LAST + 5] = oz;
  Q[0] = ox;
  Q[1] = oy;
  Q[2] = oz;
  Q[3] = drawR;
  Q[4] = BLADE_S[BL_DX];
  Q[5] = 0;
  Q[6] = BLADE_S[BL_DZ];
  Q[7] = drawArc;
  // § E3.M : traînée orange du geste — sens donné par la main (gauche → droite, droite → gauche), vrille = cercle
  const geste = CB.gesteOf(COMBO.BLADE);
  const vrille = geste === CB_GESTE.VRILLE;
  bladeSide = geste === CB_GESTE.TAILLE_D ? -1 : 1;
  Q[1] = CB_CFG.trainee.hauteur;
  if (vrille) {
    Q[0] = P.x; // la vrille tourne autour du héros
    Q[2] = P.z;
    Q[3] = range - W.drawPad > 0.5 ? range - W.drawPad : range;
    Q[7] = Math.PI * 2;
  }
  // § E5.F : sens réglé sur le geste en poses clés (bras gauche : de droite à gauche) — CB_CFG.trainee.sensInverse
  Q[8] = ((bladeSide > 0) !== (CB_CFG.trainee.sensInverse === true) ? 0 : 1) + rand() * 0.999; // partie entière : sens du balayage
  Q[9] = Q[3] * VFX.croissant.marge;
  V.AGE0[0] = CB_CFG.trainee.avance > 0 ? CB_CFG.trainee.avance : 0; // § E5.F : traînée déjà tracée à l'image de l'impact
  V.evenement(vrille ? VFX_STYLE.VRILLE : VFX_STYLE.TRAINEE_LAME);
  countShot(w); // `shots` de la lame = balayages
  CB.juiceF(COMBO.BLADE, hits); // arrêt sur image, secousse et son au contact (§ E3.M)
}

/**
 * Salve de la lame : COUNT balayages espacés de sweepGap, sens alterné, dans l'axe du robot le plus proche à portée
 * (dans le cône du buste : la lame est au bras gauche). false = aucune cible, ou salve précédente pas finie.
 */
function fireBlade() {
  if (bladePending > 0 || CB.busy(COMBO.BLADE) === 1) return false; // § E3.M : un geste en cours finit d'abord
  if (COMBO_ATTAQUE.actif && ATT_GAP[0] > 0) return false; // § E5.F : pause entre deux combos entiers
  const w = WEAPON.BLADE;
  const o = w * STAT_COUNT;
  const range = effective[o + STAT.AREA];
  if (ARG[A_RANGE + w] !== range) ARG[A_RANGE + w] = range;
  let found = grid.queryNearestN(ARG[A_PX], ARG[A_PZ], ARG[A_RANGE + w], targets, __A.FILTRE[0] === 1 ? 32 : 1);
  if (VOL_ON === 1 && E.aliveByType[REP_T] > 0) {
    PRIO_S[0] = range; // § E5.D : le réparateur à portée de la lame passe en tête
    found = repFirst(found, __A.FILTRE[0] === 1 ? 32 : 1);
  }
  if (found === 0) return false;
  let t = targets[0];
  if (__A.FILTRE[0] === 1) {
    __A.viserBuste(w, t);
    let c = 0;
    while (c < found && __A.dansCone(targets[c]) === 0) c++;
    if (c === found) {
      // § E3.N : un robot AU CONTACT déclenche la lame même hors du cône du buste (il est frappé par l'anneau de
      // contact du balayage) ; sinon la salve attend que le buste ait tourné, comme avant
      const dx0 = E.x[t] - P.x;
      const dz0 = E.z[t] - P.z;
      const cr = WEAPONS[w].contact + E.radius[t];
      if (!(WEAPONS[w].contact > 0) || dx0 * dx0 + dz0 * dz0 > cr * cr) {
        __A.attente(w);
        return false;
      }
    } else t = targets[c];
  }
  __A.viserRobot(w, t);
  marquer(t, w); // § E5.D
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
  __A.D[0] = dx;
  __A.D[1] = dz;
  if (__A.borner(w) === 1) {
    dx = __A.D[0];
    dz = __A.D[1];
  }
  BLADE_S[BL_DX] = dx;
  BLADE_S[BL_DZ] = dz;
  // § E3.M : une salve = COUNT gestes du combo ; chaque geste frappe à l'image où la lame passe (updateBlade)
  bladePending = Math.round(effective[o + STAT.COUNT]);
  if (COMBO_ATTAQUE.actif) {
    // § E5.F (retour de Femz du 17/11 : « il fait coup par coup ») : une attaque = le COMBO ENTIER (4 tailles + vrille),
    // dès son 1er geste ; la cadence et les tranchants règlent la pause entre deux combos, pour garder le même nombre de
    // gestes par seconde qu'avant (rythme × tranchants) : même DPS, chaque geste garde ses dégâts
    const n = CB_CFG.list[COMBO.BLADE].geste.length;
    bladePending = n;
    // § E5.F (Femz, 17/11 : « il ne fait plus rien pendant quelques secondes alors qu'il y a des robots devant ») : plus
    // de longue pause — le combo suivant part après une courte respiration ; le DPS d'avant est gardé par le facteur de
    // dégâts PAR GESTE (ATT_F) : gestes/s d'avant ÷ gestes/s de l'enchaînement
    const C = CB_CFG.list[COMBO.BLADE];
    let duree = 0;
    for (let k = 0; k < n; k++) duree += Math.ceil(C.dur[k] * 60 - 1e-6) / 60; // durées réelles (images entières)
    const avant = effective[o + STAT.RATE] * effective[o + STAT.COUNT];
    const anim = n / duree;
    ATT_F[0] = (avant < anim ? avant : anim) / (n / (duree + COMBO_ATTAQUE.respiration));
    ATT_GAP[0] = duree + COMBO_ATTAQUE.respiration;
    if (CB.stepOf(COMBO.BLADE) !== 0) CB.resetCombo(COMBO.BLADE);
  }
  CB.D[0] = dx;
  CB.D[1] = dz;
  CB.requestF(COMBO.BLADE);
  bladePending--;
  return true;
}

/** § E3.M : visée du geste suivant d'une salve — le robot le plus proche à portée (sinon la visée précédente). */
function reaimBlade() {
  const w = WEAPON.BLADE;
  const range = effective[w * STAT_COUNT + STAT.AREA];
  if (ARG[A_RANGE + w] !== range) ARG[A_RANGE + w] = range;
  let found = grid.queryNearestN(ARG[A_PX], ARG[A_PZ], ARG[A_RANGE + w], targets, 1);
  if (VOL_ON === 1 && E.aliveByType[REP_T] > 0) {
    PRIO_S[0] = range; // § E5.D
    found = repFirst(found, 1);
  }
  if (found === 0) return;
  const t = targets[0];
  const dx = E.x[t] - P.x;
  const dz = E.z[t] - P.z;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (!(l > 1e-6)) return;
  __A.viserRobot(w, t);
  BLADE_S[BL_DX] = dx / l;
  BLADE_S[BL_DZ] = dz / l;
}

function updateBlade(dt) {
  if (owned[WEAPON.BLADE] === 0 || usable[WEAPON.BLADE] === 0) {
    bladePending = 0;
    return;
  }
  // § E3.M : le balayage tombe à l'image d'impact du geste ; le geste suivant de la salve part quand celui-ci finit
  if (CB.impactF(COMBO.BLADE) === 1) sweepBlade();
  if (bladePending > 0 && CB.busy(COMBO.BLADE) === 0) {
    reaimBlade();
    CB.D[0] = BLADE_S[BL_DX];
    CB.D[1] = BLADE_S[BL_DZ];
    CB.requestF(COMBO.BLADE);
    bladePending--;
  }
}

// ----- Sentinelle : tourelles posées ------------------------------------------------------------------------------------
// Un EMPLACEMENT par tourelle (COUNT emplacements actifs) : sa tourelle dure SPECIAL s, puis l'emplacement se recharge
// deployEvery s et en pose une autre, derrière le héros. Jamais plus de COUNT tourelles en vie.
const TCAP = CAPS.turrets;
const tuX = new Float32Array(TCAP);
const tuZ = new Float32Array(TCAP);
const tuLife = new Float32Array(TCAP); // s restantes ; ≤ 0 : pas de tourelle
const tuCd = new Float32Array(TCAP); // recharge de l'emplacement (s)
const tuAcc = new Float32Array(TCAP); // accumulateur de tir (comme fireAcc)
const tuAge = new Float32Array(TCAP); // s depuis la pose
const tuFold = new Float32Array(TCAP); // s restantes du repli (tourelle finie, encore dessinée)
const tuYaw = new Float32Array(TCAP); // cap de la tête (rad)
const tuAim = new Float32Array(TCAP); // cap voulu
const tuFromX = new Float32Array(TCAP); // point de sortie : la bouche de la ceinture (bouche_sentinelle)
const tuFromY = new Float32Array(TCAP);
const tuFromZ = new Float32Array(TCAP);
const TU_S = new Float64Array(2); // délai avant la prochaine pose (échelonnement), sortie de world.resolve
const tuOut = new Float64Array(2);
const TU_FAN = new Int8Array([0, 1, -1, 2, -2, 3, -3, 4]); // rang d'éventail de chaque emplacement
let turretCount = 0; // tourelles en vie
let turretMesh = null;
let turretMat = null; // instanceMatrix.array
let turretSettled = null;

function initTurrets() {
  const W = WEAPONS[WEAPON.TURRET];
  turretMesh = render.createInstanced(render.emptyModelGeometry(), render.createLitMaterial({ glowColor: W.glow, profil: W.profil }), TCAP, { name: 'tourelles' });
  turretMesh.receiveShadow = true;
  turretMat = turretMesh.instanceMatrix.array;
  // § E5.T : assets/modeles/tourelle.glb = la Sentinelle du modèle de l'agent Bastion (outils/tourelles_agent.mjs, copie
  // d'agent-bastion.glb), image = l'atlas PARTAGÉ des armes (déjà lu pour l'agent : 0 octet en plus) ; chargé en
  // arrière-plan, d'ici là une géométrie vide : l'arme marche quand même
  turretSettled = chargerPieces(new URL('../' + MODELES.dir + W.model, import.meta.url).href, { cible: W.height, emissifMateriau: true, textures: true }).then(
    (d) => {
      render.setModelGeometry(turretMesh, d);
      appliquerTexturesArmes(turretMesh.material, d.textures);
      return true;
    },
    (e) => {
      console.warn('Tourelle illisible (la sentinelle reste jouable, sans modèle) :', e);
      return false;
    },
  );
}

/** Promesse tenue (jamais rejetée) quand le modèle des tourelles est posé, ou illisible. */
export function whenTurretModelSettled() {
  return turretSettled;
}

/** Tourelles en vie (sentinelle). */
export function getTurretCount() {
  return turretCount;
}

function clearTurrets() {
  tuLife.fill(0);
  tuCd.fill(0);
  tuAcc.fill(0);
  tuFold.fill(0);
  TU_S[0] = 0;
  turretCount = 0;
  chOpen.fill(0);
  chOnde.fill(0);
  chOndeCd.fill(0);
  CH_S[2] = 0;
  CH_S[3] = -1;
}

// ----- Champ de force de la sentinelle (correctif de l'étape 3, ARCHITECTURE.md § E3.Z.12) ----------------------------
// Demande de Femz (16/11/2026) : « la sentinelle du robot doit emmetre un petit champ de force qui repousse les ennemis,
// ca permet au bastion de temporiser malgres sa lenteur ». Chaque tourelle DÉPLIÉE repousse les robots de sa bulle
// (impulsion de recul / masse, amortie comme tout recul) ; aucun dégât. Rayon et force montent avec le niveau de l'arme,
// plafonnés ; élites moins repoussées, boss jamais (absent de la grille). Chiffres : WEAPONS[TURRET].champ.
const CH = WEAPONS[WEAPON.TURRET].champ;
const chOpen = new Float32Array(TCAP); // ouverture de la bulle (0 → 1)
const chOnde = new Float32Array(TCAP); // onde dessinée après une poussée (1 → 0)
const chOndeCd = new Float32Array(TCAP); // s avant la prochaine onde de cette tourelle
// 0 : rayon courant ; 1 : force courante ; 2 : recharge du son de poussée ; 3 : niveau de l'arme pour 0-1 (−1 : à refaire)
const CH_S = new Float64Array(4);
CH_S[3] = -1;
// relevés (tests) : 0 robots poussés (somme des pas), 1 somme des impulsions (masse 1), 2 pas où au moins un robot a été
// poussé, 3 dégâts du champ (toujours 0), 4 sons joués, 5 ouvertures
const CH_N = new Float64Array(6);

/** Rayon et force de la bulle pour le niveau courant de l'arme (hors chemin chaud : seulement quand il change). */
function champNiveau() {
  const lv = getWeaponLevel(WEAPON.TURRET);
  if (lv === CH_S[3]) return;
  CH_S[3] = lv;
  const k = lv > 1 ? lv - 1 : 0;
  const r = CH.r0 + CH.rNiv * k;
  const f = CH.force0 + CH.forceNiv * k;
  CH_S[0] = r < CH.rMax ? r : CH.rMax;
  CH_S[1] = f < CH.forceMax ? f : CH.forceMax;
  ARG[A_FR] = CH_S[0];
}

/** La bulle de la tourelle s (dépliée) repousse les robots qui y sont ; rend le nombre de robots poussés. */
function champTurret(s, dt) {
  const R = CH_S[0];
  const x = tuX[s];
  const z = tuZ[s];
  const base = CH_S[1] * chOpen[s] * dt;
  const pl = CH.plancher;
  const n = grid.queryCircle(ARG[A_FX + s], ARG[A_FZ + s], ARG[A_FR], circOut, circOut.length);
  let pushed = 0;
  for (let q = 0; q < n && pushed < CH.maxPousses; q++) {
    const i = circOut[q];
    if (E.alive[i] === 0 || E.sus[i] !== 0 || E.type[i] === ENEMY.BOSS) continue; // § E4.F : repli (1) ou garé (2)
    const dx = E.x[i] - x;
    const dz = E.z[i] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) continue;
    const d = Math.sqrt(d2);
    let f = base * (pl + (1 - pl) * (1 - d / R));
    if ((E.flags[i] & EFLAG.ELITE) !== 0) f *= CH.eliteMul;
    let ux = 1;
    let uz = 0;
    if (d > 1e-4) {
      ux = dx / d;
      uz = dz / d;
    }
    // Jamais poussé SUR le héros : la tourelle est posée dans son dos, un robot passé entre elle et lui serait sinon
    // projeté vers lui (mesuré : séries de 30 contacts de drones). Si la poussée radiale va vers le héros, le robot est
    // poussé à l'opposé du héros.
    const hx = E.x[i] - P.x;
    const hz = E.z[i] - P.z;
    const hd = Math.sqrt(hx * hx + hz * hz);
    if (hd > 1e-4 && ux * hx + uz * hz < 0) {
      ux = hx / hd;
      uz = hz / hd;
    }
    ARGF[F_DX] = ux;
    ARGF[F_DZ] = uz;
    ARGF[F_V] = f;
    enemies.applyKnockbackF(i);
    CH_N[1] += f;
    pushed++;
  }
  if (pushed > 0) {
    CH_N[0] += pushed;
    CH_N[2]++;
    if (chOndeCd[s] <= 0) {
      chOnde[s] = 1;
      chOndeCd[s] = CH.ondeEvery;
      if (CH_S[2] <= 0) {
        CH_S[2] = CH.sonEvery;
        CH_N[4]++;
        audio.play(SFX.FIELD, ARG[A_FX + s], ARG[A_FZ + s]);
      }
    }
  }
  return pushed;
}

// § E5.F (demande de Femz du 17/11) : l'anneau bleu des tourelles soigne le Bastion sous 20 % de ses PV, jusqu'à 30 %.
// 0 verrou (1 : soin en cours), 1 PV gagnés depuis le dernier nombre affiché, 2 s avant la prochaine pulsation, 3 PV
// rendus (total, tests), 4 lueur de la pulsation (1 → 0), 5 déclenchements (tests), 6 secondes passées à soigner (tests)
const AS = new Float64Array(7);
const AS_I = new Int32Array(1); // bulle où se tient le héros (−1 : aucune)
AS_I[0] = -1;

/** Chaque pas des tourelles : le Bastion dans une bulle ouverte, sous le seuil, regagne des PV jusqu'à la cible. */
function anneauSoin(dt) {
  const A = ANNEAU_SOIN;
  if (AS[4] > 0) AS[4] = AS[4] > dt / A.lueur ? AS[4] - dt / A.lueur : 0;
  AS_I[0] = -1;
  if (!A.actif || __run.agent !== AGENT.BASTION || !P.alive) {
    AS[0] = 0;
    return;
  }
  const R = CH_S[0];
  for (let s = 0; s < TCAP; s++) {
    if (!(chOpen[s] >= 1) || !(tuLife[s] > 0)) continue;
    const dx = P.x - tuX[s];
    const dz = P.z - tuZ[s];
    if (dx * dx + dz * dz < R * R) {
      AS_I[0] = s;
      break;
    }
  }
  if (AS_I[0] < 0) return; // hors de l'anneau : le soin attend (le verrou reste)
  const mx = P.maxHp;
  const cible = A.cible * mx;
  if (AS[0] === 0) {
    if (!(P.hp < A.seuil * mx)) return;
    AS[0] = 1;
    AS[2] = 0;
    AS[5]++;
    audio.play(SFX.SMOKE, P.x, P.z); // « Soin du réparateur » − 8 demi-tons : grave, discret
  }
  let pv = A.parSeconde * mx * dt;
  if (P.hp + pv > cible) pv = cible - P.hp;
  if (pv > 0) {
    P.hp += pv; // (même borne que player.heal : la cible est sous les PV max)
    SOIN_HEROS[0] += pv; // § E5.Q (B14) : « +N », lueur verte et éclat de la barre par src/soin-heros.js
    SOIN_SIGNAUX[2] = 1;
    AS[1] += pv;
    AS[3] += pv;
    AS[6] += dt;
  }
  const fini = P.hp >= cible - 1e-6;
  AS[2] -= dt;
  if (AS[2] <= 0 || fini) {
    AS[2] = A.pulsation;
    AS[4] = 1;
    chOnde[AS_I[0]] = 1; // onde (verte) qui part du centre de la bulle
    // § E5.Q (B14) : le « +N » vert part de src/soin-heros.js (SOIN, plus haut) ; l'anneau + losanges du réparateur
    // (spawnHealPulse) n'est plus joué sur le héros : il signale le soin d'un ROBOT
    AS[1] = 0;
  }
  if (fini) AS[0] = 0;
}

/** Tests seulement : relevés de l'anneau de soin (§ E5.F). */
export function debugAnneauSoin(out = {}) {
  out.verrou = AS[0];
  out.rendus = AS[3];
  out.declenchements = AS[5];
  out.secondes = AS[6];
  out.bulle = AS_I[0];
  out.lueur = AS[4];
  return out;
}

/** Tests seulement : relevés du champ de force (§ E3.Z.12). */
export function debugChamp(out = {}) {
  out.rayon = CH_S[0];
  out.force = CH_S[1];
  out.niveau = CH_S[3];
  out.pousses = CH_N[0];
  out.impulsion = CH_N[1];
  out.pasActifs = CH_N[2];
  out.degats = CH_N[3];
  out.sons = CH_N[4];
  out.ouvertures = CH_N[5];
  out.bulles = [];
  for (let s = 0; s < TCAP; s++) if (chOpen[s] > 0) out.bulles.push({ x: tuX[s], z: tuZ[s], ouvert: chOpen[s], onde: chOnde[s] });
  return out;
}

function resetE2A() {
  E2A.fill(0);
  bladePending = 0;
  bladeSide = 1;
  clearTurrets();
}

/** Pose la tourelle de l'emplacement s, derrière le héros (en éventail : chaque emplacement a sa place). */
function deployTurret(s) {
  const w = WEAPON.TURRET;
  const W = WEAPONS[w];
  const a = TU_FAN[s] * W.deployFanDeg * DEG;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const bx = -P.moveX;
  const bz = -P.moveZ;
  const x = P.x + (bx * c + bz * sn) * W.deployDist;
  const z = P.z + (-bx * sn + bz * c) * W.deployDist;
  world.resolve(x, z, 0.35, tuOut); // jamais dans un obstacle ni hors de l'arène
  tuX[s] = tuOut[0];
  tuZ[s] = tuOut[1];
  ARG[A_FX + s] = tuX[s]; // § E3.Z.12 : centre de la bulle (une écriture par pose)
  ARG[A_FZ + s] = tuZ[s];
  chOpen[s] = 0;
  chOnde[s] = 0;
  tuLife[s] = effective[w * STAT_COUNT + STAT.SPECIAL];
  tuAge[s] = 0;
  tuAcc[s] = 1; // prête à tirer dès qu'elle est dépliée
  tuFold[s] = 0;
  tuYaw[s] = Math.atan2(bx, bz);
  tuAim[s] = tuYaw[s];
  if (__A.bouche(w) === 1) {
    tuFromX[s] = __A.B[0];
    tuFromY[s] = __A.B[1];
    tuFromZ[s] = __A.B[2];
  } else {
    tuFromX[s] = P.x;
    tuFromY[s] = 1;
    tuFromZ[s] = P.z;
  }
  E2A[C_LAST + 6] = tuFromX[s];
  E2A[C_LAST + 7] = tuFromY[s];
  E2A[C_LAST + 8] = tuFromZ[s];
  E2A[C_POSED]++;
  turretCount++;
  __A.tir(w); // éclair à la ceinture
  audio.play(SFX.TURRET_DEPLOY, ARG[A_PX], ARG[A_PZ]);
  // § E3.M : il lance la tourelle (geste de pose vers son point de chute)
  const gx = tuX[s] - P.x;
  const gz = tuZ[s] - P.z;
  const gl = Math.sqrt(gx * gx + gz * gz);
  CB.D[0] = gl > 1e-6 ? gx / gl : bx;
  CB.D[1] = gl > 1e-6 ? gz / gl : bz;
  CB.requestF(COMBO.POSE);
}

/** § E5.F : le drone-bouclier du boss (liste PRIO ; aussi pour la grosse tourelle, passé à WA.init) le plus proche de (x, z) à moins de r (bord compris) ; −1 sinon. */
function droneBouclier(x, z, r) {
  let best = -1;
  let bd = 1e18;
  for (let k = 1; k <= PRIO[0]; k++) {
    const j = PRIO[k];
    if (E.alive[j] !== 1 || E.sus[j] !== 0 || (E.flags[j] & EFLAG.SHIELD_DRONE) === 0) continue;
    const dx = E.x[j] - x;
    const dz = E.z[j] - z;
    const d = dx * dx + dz * dz;
    const rr = r + E.radius[j];
    if (d <= rr * rr && d < bd) {
      bd = d;
      best = j;
    }
  }
  return best;
}

/** Un tir de la tourelle s sur le robot le plus proche d'elle à portée ; false s'il n'y en a pas. */
function fireTurret(s) {
  const w = WEAPON.TURRET;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const range = effective[o + STAT.AREA];
  // § E3.Z.12 (levier 2 de l'équilibrage du Bastion, la bulle seule ne tenant pas la cible) : la tourelle protège
  // d'abord le héros — elle vise le robot le plus proche DU HÉROS parmi ceux qu'elle peut atteindre (cercle centré sur
  // le héros, de rayon portée − distance tourelle-héros : tout robot dedans est à portée de la tourelle), au moins
  // W.garde m ; sinon, comme avant, le plus proche d'elle.
  const gx = P.x - tuX[s];
  const gz = P.z - tuZ[s];
  const rg = range - Math.sqrt(gx * gx + gz * gz);
  let t = -1;
  // § E5.F (demande de Femz du 17/11 : « ses tourelles doivent viser le boss en priorité ») : boss vivant, à portée de la
  // tourelle. Protégé par ses drones-boucliers (aucun coup ne le touche) : d'abord le drone-bouclier le plus proche à
  // portée, pour faire tomber le bouclier (réponse de Femz : « oui, les drones d'abord »), puis le boss
  if (TOURELLES_BOSS.actif) {
    const b = E.bossIndex;
    if (b >= 0 && E.alive[b] === 1 && E.sus[b] === 0) {
      if (E.bossShield > 0) t = droneBouclier(tuX[s], tuZ[s], range);
      else {
        const bx = E.x[b] - tuX[s];
        const bz = E.z[b] - tuZ[s];
        const rb = range + E.radius[b];
        if (bx * bx + bz * bz <= rb * rb) t = b;
      }
    }
  }
  if (t < 0 && VOL_ON === 1 && E.aliveByType[REP_T] > 0) {
    // § E5.D : d'abord le réparateur le plus proche de la tourelle, à sa portée
    REP_S[0] = tuX[s];
    REP_S[1] = tuZ[s];
    REP_S[2] = range;
    t = repTarget();
  }
  if (t < 0 && rg >= W.garde) {
    NEAR_S[0] = P.x;
    NEAR_S[1] = P.z;
    NEAR_S[2] = rg;
    t = nearestFrom(-1, -1);
  }
  if (t < 0) {
    NEAR_S[0] = tuX[s];
    NEAR_S[1] = tuZ[s];
    NEAR_S[2] = range;
    t = nearestFrom(-1, -1);
  }
  if (t < 0) return false;
  let dx = E.x[t] - tuX[s];
  let dz = E.z[t] - tuZ[s];
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l > 1e-6) {
    dx /= l;
    dz /= l;
  } else {
    dx = Math.sin(tuYaw[s]);
    dz = Math.cos(tuYaw[s]);
  }
  tuAim[s] = Math.atan2(dx, dz);
  tuYaw[s] = tuAim[s]; // la tête est sur sa cible à l'instant du tir : le trait part dans l'axe du canon
  const j = takeProjectile(w);
  if (j < 0) return true; // pool plein : le tir est perdu, la cadence continue
  pX[j] = tuX[s] + dx * W.muzzle;
  pZ[j] = tuZ[s] + dz * W.muzzle;
  pSX[j] = tuX[s]; // premier balayage depuis l'axe de la tourelle (un robot collé à elle est touché)
  pSZ[j] = tuZ[s];
  pOX[j] = tuX[s]; // source des coups : la tourelle
  pOZ[j] = tuZ[s];
  pDX[j] = dx;
  pDZ[j] = dz;
  pVX[j] = dx * W.projectileSpeed;
  pVZ[j] = dz * W.projectileSpeed;
  pLife[j] = (range - W.muzzle) / W.projectileSpeed;
  pDmg[j] = effective[o + STAT.DAMAGE];
  pR[j] = W.projectileRadius;
  pKb[j] = W.knockback;
  visee(j, t, w); // § E5.D
  shots[w]++;
  audio.play(W.sfx, ARG[A_PX], ARG[A_PZ]);
  return true;
}

function updateTurrets(dt) {
  const w = WEAPON.TURRET;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  let slots = Math.round(effective[o + STAT.COUNT]);
  if (slots > TCAP) slots = TCAP;
  const rate = effective[o + STAT.RATE];
  if (TU_S[0] > 0) TU_S[0] -= dt;
  const turn = W.turnRate * dt;
  champNiveau(); // § E3.Z.12
  if (CH_S[2] > 0) CH_S[2] -= dt;
  const chStep = dt / CH.ouverture;
  const ondeStep = dt / CH.ondeVie;
  for (let s = 0; s < TCAP; s++) {
    if (tuFold[s] > 0) tuFold[s] -= dt;
    if (chOnde[s] > 0) chOnde[s] = chOnde[s] > ondeStep ? chOnde[s] - ondeStep : 0;
    if (chOndeCd[s] > 0) chOndeCd[s] -= dt;
    // la bulle se referme dès que la tourelle n'est plus dépliée et vivante (repli, emplacement retiré)
    if (chOpen[s] > 0 && !(tuLife[s] > 0)) chOpen[s] = chOpen[s] > chStep ? chOpen[s] - chStep : 0;
    if (tuLife[s] > 0) {
      tuAge[s] += dt;
      tuLife[s] -= dt;
      if (tuLife[s] <= 0 || s >= slots) {
        // fin de la tourelle (ou emplacement retiré) : elle se replie, l'emplacement se recharge
        tuLife[s] = 0;
        tuFold[s] = W.foldSeconds;
        tuCd[s] = W.deployEvery;
        turretCount--;
        continue;
      }
      // la tête tourne vers son cap voulu
      let d = tuAim[s] - tuYaw[s];
      d -= Math.round(d / TAU) * TAU;
      tuYaw[s] += d > turn ? turn : d < -turn ? -turn : d;
      // § E3.M : atterrissage (secousse au sol, poussière, son), puis déploiement AVANT le premier tir
      if (tuAge[s] >= W.deploySeconds && tuAge[s] - dt < W.deploySeconds) {
        CB.PL[0] = tuX[s];
        CB.PL[1] = tuZ[s];
        CB.landF();
      }
      if (tuAge[s] < W.deploySeconds + CB_CFG.deploy.unfold) continue; // pas encore dépliée
      // § E3.Z.12 : la bulle s'ouvre (son à l'ouverture), puis repousse les robots
      if (chOpen[s] < 1) {
        if (chOpen[s] === 0) {
          CH_N[5]++;
          audio.play(SFX.FIELD, ARG[A_FX + s], ARG[A_FZ + s]);
        }
        chOpen[s] = chOpen[s] + chStep < 1 ? chOpen[s] + chStep : 1;
      }
      champTurret(s, dt);
      let t = tuAcc[s] + dt * rate;
      let fired = 0;
      while (t >= 1 && fired < LOOP.maxShotsPerFrame) {
        if (!fireTurret(s)) break; // aucune cible : la recharge reste prête
        t -= 1;
        fired++;
      }
      tuAcc[s] = t >= 0 ? (t > 1 ? 1 : t) : 1;
    } else if (s < slots) {
      if (tuCd[s] > 0) tuCd[s] -= dt;
      if (tuCd[s] <= 0 && TU_S[0] <= 0 && !armesCoupees()) {
        deployTurret(s); // (§ E4.O.3 : aucune pose pendant le coup de pied ; les sentinelles posées continuent)
        TU_S[0] = W.deployStagger;
      }
    }
  }
  anneauSoin(dt); // § E5.F
}

/** Instances des tourelles : sortie de la ceinture (arc + dépliage), cap de la tête, repli. */
function syncTurrets() {
  if (turretMesh === null) return;
  let n = 0;
  for (let s = 0; s < TCAP; s++) TACHES_CONTACT[s * 4 + 3] = 0; // § E5.T : pas de tache sans tourelle dessinée
  if (owned[WEAPON.TURRET] === 1) {
    const W = WEAPONS[WEAPON.TURRET];
    for (let s = 0; s < TCAP; s++) {
      const alive = tuLife[s] > 0;
      if (!alive && !(tuFold[s] > 0)) continue;
      let x = tuX[s];
      let y = 0;
      let z = tuZ[s];
      let sc = 1;
      if (alive && tuAge[s] < W.deploySeconds) {
        let u = tuAge[s] / W.deploySeconds;
        const e = u * u * (3 - 2 * u);
        x = tuFromX[s] + (x - tuFromX[s]) * e;
        z = tuFromZ[s] + (z - tuFromZ[s]) * e;
        y = tuFromY[s] * (1 - e) + 0.5 * 4 * u * (1 - u); // petite cloche
        sc = 0.25 + 0.75 * e;
      } else if (!alive) {
        const u = tuFold[s] / W.foldSeconds;
        sc = u > 0 ? u : 0;
      }
      // § E3.M : déploiement après l'atterrissage (écrasée, dressée, posée)
      let sh = 1;
      let sv = 1;
      if (alive && tuAge[s] >= W.deploySeconds && tuAge[s] < W.deploySeconds + CB_CFG.deploy.unfold) {
        CB.DEPLOI[2] = tuAge[s] - W.deploySeconds;
        CB.unfoldF();
        sv = CB.DEPLOI[0];
        sh = CB.DEPLOI[1];
      }
      const c = Math.cos(tuYaw[s]) * sc * sh;
      const sn = Math.sin(tuYaw[s]) * sc * sh;
      const o = n * 16;
      turretMat[o] = c;
      turretMat[o + 1] = 0;
      turretMat[o + 2] = -sn;
      turretMat[o + 3] = 0;
      turretMat[o + 4] = 0;
      turretMat[o + 5] = sc * sv;
      turretMat[o + 6] = 0;
      turretMat[o + 7] = 0;
      turretMat[o + 8] = sn;
      turretMat[o + 9] = 0;
      turretMat[o + 10] = c;
      turretMat[o + 11] = 0;
      turretMat[o + 12] = x;
      turretMat[o + 13] = y;
      turretMat[o + 14] = z;
      turretMat[o + 15] = 1;
      const q = s * 4; // § E5.T : ombre de contact, qui pâlit pendant la cloche de sortie
      TACHES_CONTACT[q] = x;
      TACHES_CONTACT[q + 1] = z;
      TACHES_CONTACT[q + 2] = W.contact.rayon * sc * sh;
      TACHES_CONTACT[q + 3] = y > 0.5 ? 0 : W.contact.force * (1 - y * 2);
      n++;
    }
  }
  render.commit(turretMesh, n);
}

/** § E3.N : dernier balayage de la lame — bouche (x, z), rayon et arc DESSINÉS, visée, héros, portée et arc de TOUCHE. */
const E3N_BLADE = new Float64Array(10);

/** Tests seulement : relevés du chantier M (combos, gestes, atterrissages des tourelles). */
export function debugE3M(out) {
  return CB.inspect(out);
}

/** Tests seulement : relevés du chantier N (armes nouvelles, zone de la lame). */
export function debugE3N(out) {
  WA.inspect(out);
  out.blade = { ox: E3N_BLADE[0], oz: E3N_BLADE[1], drawR: E3N_BLADE[2], drawArc: E3N_BLADE[3], dx: E3N_BLADE[4], dz: E3N_BLADE[5], px: E3N_BLADE[6], pz: E3N_BLADE[7], range: E3N_BLADE[8], arc: E3N_BLADE[9] };
  return out;
}

/** Tests seulement : compteurs et relevés du chantier A (rebonds, balayages, tourelles, départ du dernier tir). */
export function debugE2A(out) {
  out.bounces = E2A[C_BOUNCES];
  out.sweeps = E2A[C_SWEEPS];
  out.sweepHits = E2A[C_SWEEP_HITS];
  out.sweepBlocked = E2A[C_SWEEP_BLOCKED];
  out.posed = E2A[C_POSED];
  out.bladePending = bladePending;
  out.lastShot = {
    ricochet: [E2A[C_LAST], E2A[C_LAST + 1], E2A[C_LAST + 2]],
    blade: [E2A[C_LAST + 3], E2A[C_LAST + 4], E2A[C_LAST + 5]],
    turret: [E2A[C_LAST + 6], E2A[C_LAST + 7], E2A[C_LAST + 8]],
  };
  out.turrets = [];
  for (let s = 0; s < TCAP; s++) if (tuLife[s] > 0) out.turrets.push({ slot: s, x: tuX[s], z: tuZ[s], life: tuLife[s], age: tuAge[s], yaw: tuYaw[s] });
  out.projectiles = [];
  for (let k = 0; k < pCount; k++) if (pKind[k] >= WEAPON.RICOCHET) out.projectiles.push({ kind: pKind[k], x: pX[k], z: pZ[k], dx: pDX[k], dz: pDZ[k], hits: pHitN[k], bounces: pPierce[k] });
  return out;
}

// =====================================================================================================================
// ÉTAPE 2, CHANTIER B (ARCHITECTURE.md § E2.B et § E2.B bis) — Nappe corrosive, Boomerang, Mines logiques
// =====================================================================================================================
// Nappe     : flacons lobés du pool commun (pKind = WEAPON.POOL, sans collision) ; à l'arrivée, une nappe du pool
//             CAPS.pools qui mord RATE fois par seconde tous les robots dedans. Lancers toutes les throwEvery s.
// Boomerang : projectile du pool commun (pKind = WEAPON.BOOMERANG), aller droit puis retour vers le héros ; un robot
//             est touché une fois par trajet — mémoire par (robot, emplacement de boomerang), exacte dans une horde.
// Mines     : pool CAPS.mines ; une mine armée explose (damage.explode) quand un robot entre dans sa détection.
// Dessin : flacons et boomerangs dans le lot TIRS, nappes et mines dans le lot CONTINUS — aucun appel de dessin en
// plus. Rien n'est alloué en combat : tableaux typés créés ici, grille lue en ligne, fonctions à arguments entiers.

// Compteurs et relevés lus par les tests (debugE2B)
const CB_THROWS = 0; // lancers de flacons depuis le reset
const CB_LANDED = 1; // nappes posées
const CB_BITES = 2; // morsures (toutes nappes)
const CB_BITE_HITS = 3; // robots mordus par la dernière morsure
const CB_TURNS = 4; // demi-tours de boomerang
const CB_CAUGHT = 5; // boomerangs revenus au héros
const CB_BM_HITS = 6; // coups de boomerang qui ont blessé
const CB_BM_BLOCKED = 7; // coups de boomerang arrêtés par un bouclier
const CB_DROPPED = 8; // mines posées
const CB_BOOMS = 9; // mines qui ont explosé
const CB_EXPIRED = 10; // mines et boomerangs éteints sans effet (fin de vie)
const CB_CATCH = 11; // + 0, 1 : position (x, z) du dernier boomerang rattrapé
const CB_LAST = 13; // + 3 × (w − WEAPON.POOL) : départ (x, y, z) du dernier tir de l'arme w
const CB_BOOM_AGE = 22; // âge (s) de la dernière mine qui a explosé
const E2B = new Float64Array(24);
// Scalaires de travail : 0 = dt de l'image (jamais passé en argument, § V) ; 1-3 = arrivée d'un flacon (x, z, rayon) ;
// 4-8 = segment balayé par un boomerang (x0, z0, x1, z1, rayon)
const BM_S = new Float64Array(9);

// ----- Nappe corrosive ----------------------------------------------------------------------------------------------------
const POCAP = CAPS.pools;
const poX = new Float32Array(POCAP);
const poZ = new Float32Array(POCAP);
const poR = new Float32Array(POCAP); // rayon (stat au moment du lancer)
const poLife = new Float32Array(POCAP); // s restantes ; ≤ 0 : pas de nappe
const poAge = new Float32Array(POCAP); // s depuis l'arrivée
const poAcc = new Float32Array(POCAP); // accumulateur de morsure (comme fireAcc)
const poBite = new Float32Array(POCAP); // s restantes de l'éclair de la dernière morsure
const poFade = new Float32Array(POCAP); // s restantes de l'évaporation (nappe finie, encore dessinée)
const poBites = new Uint16Array(POCAP); // morsures de la nappe de l'emplacement (mesures)
const PO_S = new Float64Array(1); // délai avant le prochain lancer (s)
let poolCount = 0; // nappes en vie

/** Emplacement pour une nappe : un libre, sinon celui de la plus ancienne (remplacée). */
function takePool() {
  let old = 0;
  for (let s = 0; s < POCAP; s++) {
    if (!(poLife[s] > 0)) return s;
    if (poAge[s] > poAge[old]) old = s;
  }
  poolCount--;
  return old;
}

/** Un flacon arrive (BM_S[1..3] : x, z, rayon) : sa nappe s'étale et mord tout de suite. */
function landPool() {
  const w = WEAPON.POOL;
  const s = takePool();
  poX[s] = BM_S[1];
  poZ[s] = BM_S[2];
  poR[s] = BM_S[3];
  poLife[s] = effective[w * STAT_COUNT + STAT.SPECIAL];
  poAge[s] = 0;
  poAcc[s] = 1;
  poBite[s] = 0;
  poFade[s] = 0;
  poBites[s] = 0;
  poolCount++;
  E2B[CB_LANDED]++;
  Q[0] = BM_S[1];
  Q[1] = 0.25;
  Q[2] = BM_S[2];
  V.impact(w); // éclat à l'arrivée du flacon
}

/** Vol d'un flacon (projectile k du pool commun) : droit vers son point, sans collision ; à l'arrivée, la nappe. */
function updateFlask(k) {
  const dt = BM_S[0];
  const step = pLife[k] < dt ? pLife[k] : dt;
  pX[k] += pVX[k] * step;
  pZ[k] += pVZ[k] * step;
  pTravel[k] += step; // s de vol écoulées (lu par le dessin de la cloche)
  pLife[k] -= dt;
  if (pLife[k] <= 0) {
    BM_S[1] = pTX[k];
    BM_S[2] = pTZ[k];
    BM_S[3] = pBlast[k];
    removeProjectile(k);
    landPool();
  }
}

/**
 * Lancer : COUNT flacons, un par paquet de robots à `range` m (grid.findDensest, du plus gros au moins gros) ; le
 * surplus tombe en couronne autour des paquets trouvés. Ils partent de la hanche gauche (bouche_nappe). false = aucun
 * paquet à portée.
 */
function firePool() {
  const w = WEAPON.POOL;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  let count = Math.round(effective[o + STAT.COUNT]);
  if (count > 8) count = 8;
  if (ARG[A_RANGE + w] !== W.range) ARG[A_RANGE + w] = W.range;
  const found = grid.findDensest(ARG[A_PX], ARG[A_PZ], ARG[A_RANGE + w], densOut, count);
  if (found === 0) return false;
  const radius = effective[o + STAT.AREA];
  let mx = P.x;
  let my = W.shotHeight;
  let mz = P.z;
  if (__A.bouche(w) === 1) {
    mx = __A.B[0];
    my = __A.B[1];
    mz = __A.B[2];
  }
  E2B[CB_LAST] = mx;
  E2B[CB_LAST + 1] = my;
  E2B[CB_LAST + 2] = mz;
  const T = W.flightSeconds;
  for (let k = 0; k < count; k++) {
    let tx;
    let tz;
    if (k < found) {
      tx = densOut[k * 2];
      tz = densOut[k * 2 + 1];
    } else {
      // surplus : en couronne autour d'un paquet trouvé (angle d'or : deux nappes ne se recouvrent jamais exactement)
      const j = k - found;
      const b = (j % found) * 2;
      const a = 0.7 + j * 2.399963;
      const d = radius * W.ringMul * (1 + 0.5 * Math.floor(j / found));
      tx = densOut[b] + Math.cos(a) * d;
      tz = densOut[b + 1] + Math.sin(a) * d;
    }
    world.resolve(tx, tz, 0.3, tuOut); // jamais dans un obstacle ni hors de l'arène
    tx = tuOut[0];
    tz = tuOut[1];
    const j = takeProjectile(w);
    if (j < 0) break;
    let dx = tx - mx;
    let dz = tz - mz;
    const l = Math.sqrt(dx * dx + dz * dz);
    pX[j] = mx;
    pZ[j] = mz;
    pVX[j] = dx / T;
    pVZ[j] = dz / T;
    if (l > 1e-6) {
      dx /= l;
      dz /= l;
    } else {
      dx = P.moveX;
      dz = P.moveZ;
    }
    pDX[j] = dx;
    pDZ[j] = dz;
    pLife[j] = T;
    pKb[j] = my; // flacon : hauteur de départ (le champ « recul » ne sert pas à un projectile sans collision)
    pTX[j] = tx;
    pTZ[j] = tz;
    pBlast[j] = radius;
    pR[j] = 0;
    pDmg[j] = 0;
  }
  E2B[CB_THROWS]++;
  countShot(w);
  return true;
}

/** Une morsure de la nappe s : tous les robots dedans (maxBites au plus), boss compris ; source = son centre. */
function bitePool(s) {
  const w = WEAPON.POOL;
  const x = poX[s];
  const z = poZ[s];
  const r = poR[s];
  const max = WEAPONS[w].maxBites < circOut.length ? WEAPONS[w].maxBites : circOut.length;
  const EX = E.x;
  const EZ = E.z;
  const ER = E.radius;
  const ALIVE = E.alive;
  const cellStart = grid.cellStart;
  const cellCount = grid.cellCount;
  const items = grid.items;
  let margin = grid.getMaxRadius();
  if (!(margin > sweepMargin)) margin = sweepMargin;
  const reach = r + margin;
  let cx0 = Math.floor((x - reach - GRID_MIN) * GRID_INV);
  let cx1 = Math.floor((x + reach - GRID_MIN) * GRID_INV);
  let cz0 = Math.floor((z - reach - GRID_MIN) * GRID_INV);
  let cz1 = Math.floor((z + reach - GRID_MIN) * GRID_INV);
  if (cx0 < 0) cx0 = 0;
  if (cz0 < 0) cz0 = 0;
  if (cx1 > GRID_LAST) cx1 = GRID_LAST;
  if (cz1 > GRID_LAST) cz1 = GRID_LAST;
  let n = 0;
  for (let cz = cz0; cz <= cz1 && n < max; cz++) {
    const row = cz * GRID_DIM;
    for (let cx = cx0; cx <= cx1 && n < max; cx++) {
      const c = row + cx;
      const cnt = cellCount[c];
      if (cnt === 0) continue;
      const first = cellStart[c];
      for (let q = first; q < first + cnt && n < max; q++) {
        const i = items[q];
        if (ALIVE[i] === 0) continue;
        const dx = EX[i] - x;
        const dz = EZ[i] - z;
        const rr = r + ER[i];
        if (dx * dx + dz * dz > rr * rr) continue;
        circOut[n++] = i;
      }
    }
  }
  const b = E.bossIndex;
  if (b >= 0 && ALIVE[b] === 1 && n < max) {
    const dx = EX[b] - x;
    const dz = EZ[b] - z;
    const rr = r + ER[b];
    if (dx * dx + dz * dz <= rr * rr) circOut[n++] = b;
  }
  // les coups après la lecture : un robot tué ne change pas la liste en cours de route
  const dmg = effective[w * STAT_COUNT + STAT.DAMAGE];
  const fl = flagsOf[w];
  let hits = 0;
  for (let q = 0; q < n; q++) {
    const i = circOut[q];
    if (ALIVE[i] === 0) continue;
    ARGF[F_V] = dmg;
    ARGF[F_SX] = x;
    ARGF[F_SZ] = z;
    if (damage.hitEnemyF(i, w, fl) > 0) hits++;
  }
  poBite[s] = WEAPONS[w].biteFlash;
  if (poBites[s] < 65535) poBites[s]++;
  E2B[CB_BITES]++;
  E2B[CB_BITE_HITS] = hits;
}

/** Nappes : délai de lancer (arme possédée), durée, morsures. */
function updatePools(dt) {
  const w = WEAPON.POOL;
  const W = WEAPONS[w];
  if (owned[w] === 1 && usable[w] === 1 && GATE[w] === 1) {
    if (PO_S[0] > 0) PO_S[0] -= dt;
    if (PO_S[0] <= 0 && !armesCoupees()) {
      // le reste négatif de l'image est gardé : la période des lancers est exacte à toute cadence
      if (firePool()) PO_S[0] = W.throwEvery + (PO_S[0] > -dt ? PO_S[0] : 0);
      else PO_S[0] = 0; // aucun paquet à portée : le lancer reste prêt
    }
  }
  if (poolCount === 0) {
    // rien au sol : seules les évaporations en cours avancent
    for (let s = 0; s < POCAP; s++) if (poFade[s] > 0) poFade[s] -= dt;
    return;
  }
  const rate = effective[w * STAT_COUNT + STAT.RATE];
  for (let s = 0; s < POCAP; s++) {
    if (poFade[s] > 0) poFade[s] -= dt;
    if (!(poLife[s] > 0)) continue;
    poAge[s] += dt;
    poLife[s] -= dt;
    if (poBite[s] > 0) poBite[s] -= dt;
    if (poLife[s] <= 0) {
      poLife[s] = 0;
      poFade[s] = W.fadeOut;
      poolCount--;
      continue;
    }
    let t = poAcc[s] + dt * rate;
    if (t >= 1) {
      t -= 1;
      if (t > 1) t = 1; // une morsure par image au plus
      bitePool(s);
    }
    poAcc[s] = t >= 0 ? t : 1;
  }
}

function clearPools() {
  poLife.fill(0);
  poFade.fill(0);
  poBite.fill(0);
  poAge.fill(0);
  poolCount = 0;
  PO_S[0] = 0;
}

// ----- Boomerang ----------------------------------------------------------------------------------------------------------
// Champs du pool commun relus pour lui : pPierce = emplacement stable (0 à BMCAP − 1), pHitN = trajet (0 aller, 1
// retour), pLife = s d'aller restantes, pBlast = s de vie restantes, pOX / pOZ = source des coups (point de lancer,
// puis point de demi-tour), pR = taille (rayon de collision).
const BMCAP = CAPS.boomerangs;
const bmBusy = new Uint8Array(BMCAP);
const bmLeg = new Uint32Array(BMCAP); // numéro du trajet en cours de l'emplacement (jamais réutilisé)
// dernier trajet qui a touché le robot i depuis l'emplacement s (case i × BMCAP + s), et l'uid de ce robot
const bmStamp = new Uint32Array(CAPS.enemies * BMCAP);
const bmUid = new Uint32Array(CAPS.enemies * BMCAP);
let bmLegs = 0; // compteur de trajets (entier)

function takeBoomSlot() {
  for (let s = 0; s < BMCAP; s++) {
    if (bmBusy[s] === 0) {
      bmBusy[s] = 1;
      bmLeg[s] = ++bmLegs;
      return s;
    }
  }
  return -1;
}

function clearBoomerangs() {
  bmBusy.fill(0);
}

/**
 * Lancer : COUNT boomerangs vers les robots les plus proches à AREA m, tout autour du héros (arme de hanche : pas de
 * cône du buste) ; le surplus en éventail autour du premier. Ils partent de la hanche droite (bouche_boomerang).
 * false = aucune cible.
 */
function fireBoomerang() {
  const w = WEAPON.BOOMERANG;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const count = Math.round(effective[o + STAT.COUNT]);
  const range = effective[o + STAT.AREA];
  if (ARG[A_RANGE + w] !== range) ARG[A_RANGE + w] = range;
  let found = grid.queryNearestN(ARG[A_PX], ARG[A_PZ], ARG[A_RANGE + w], targets, count < 32 ? count : 32);
  if (VOL_ON === 1 && E.aliveByType[REP_T] > 0) {
    PRIO_S[0] = range; // § E5.D : le premier boomerang part vers le réparateur à portée
    found = repFirst(found, count < 32 ? count : 32);
  }
  if (found === 0) return false;
  const px = P.x;
  const pz = P.z;
  let mx = px;
  let my = W.shotHeight;
  let mz = pz;
  const viaBouche = __A.bouche(w) === 1;
  if (viaBouche) {
    mx = __A.B[0];
    my = __A.B[1];
    mz = __A.B[2];
  }
  const dmg = effective[o + STAT.DAMAGE];
  const size = effective[o + STAT.SPECIAL];
  const speed = W.projectileSpeed;
  let firstX = P.moveX;
  let firstZ = P.moveZ;
  let made = 0;
  for (let k = 0; k < count; k++) {
    let dx;
    let dz;
    if (k < found) {
      const i = targets[k];
      dx = E.x[i] - px;
      dz = E.z[i] - pz;
      let l = Math.sqrt(dx * dx + dz * dz);
      if (viaBouche && l > W.aimFromMuzzle) {
        // visée depuis la hanche : le boomerang passe par le centre de sa cible (un robot collé au héros, entre lui et
        // la hanche, garde la visée depuis le centre)
        dx = E.x[i] - mx;
        dz = E.z[i] - mz;
        l = Math.sqrt(dx * dx + dz * dz);
      }
      if (l > 1e-6) {
        dx /= l;
        dz /= l;
      } else {
        dx = P.moveX;
        dz = P.moveZ;
      }
      if (k === 0) {
        firstX = dx;
        firstZ = dz;
      }
    } else {
      const j = k - found + 1;
      const a = Math.ceil(j / 2) * W.fanDeg * DEG * ((j & 1) === 1 ? 1 : -1);
      const c = Math.cos(a);
      const s = Math.sin(a);
      dx = firstX * c + firstZ * s;
      dz = -firstX * s + firstZ * c;
    }
    const slot = takeBoomSlot();
    if (slot < 0) break; // 32 boomerangs en vol : celui-ci ne part pas
    const j = takeProjectile(w);
    if (j < 0) {
      bmBusy[slot] = 0;
      break;
    }
    if (viaBouche) {
      pX[j] = mx;
      pZ[j] = mz;
    } else {
      pX[j] = px + dx * W.muzzle;
      pZ[j] = pz + dz * W.muzzle;
    }
    E2B[CB_LAST + 3] = pX[j];
    E2B[CB_LAST + 4] = my;
    E2B[CB_LAST + 5] = pZ[j];
    pDX[j] = dx;
    pDZ[j] = dz;
    pVX[j] = dx * speed;
    pVZ[j] = dz * speed;
    pLife[j] = (range - ((pX[j] - px) * dx + (pZ[j] - pz) * dz)) / speed; // l'aller finit à AREA m du point de lancer
    pBlast[j] = W.maxSeconds;
    pDmg[j] = dmg;
    pR[j] = size;
    pKb[j] = W.knockback;
    pPierce[j] = slot;
    pHitN[j] = 0;
    if (k < found) visee(j, targets[k], w); // § E5.D : vers un volant haut, l'aller passe au-dessus de la horde
    made++;
  }
  if (made === 0) return false;
  countShot(w);
  return true;
}

/**
 * Robots dont le cercle touche le segment BM_S[4..7] épaissi de BM_S[8], triés du départ vers l'arrivée dans segOut /
 * segT ; boss compris. Lecture en ligne de la grille (§ F) : le même balayage que les tirs droits. Renvoie leur nombre.
 */
function gatherSegment() {
  const x0 = BM_S[4];
  const z0 = BM_S[5];
  const x1 = BM_S[6];
  const z1 = BM_S[7];
  const pr = BM_S[8];
  const sx = x1 - x0;
  const sz = z1 - z0;
  const EX = E.x;
  const EZ = E.z;
  const ER = E.radius;
  const ALIVE = E.alive;
  const cellStart = grid.cellStart;
  const cellCount = grid.cellCount;
  const items = grid.items;
  let margin = grid.getMaxRadius();
  if (!(margin > sweepMargin)) margin = sweepMargin;
  const reach = pr + margin;
  let cx0 = Math.floor(((x0 < x1 ? x0 : x1) - reach - GRID_MIN) * GRID_INV);
  let cx1 = Math.floor(((x0 > x1 ? x0 : x1) + reach - GRID_MIN) * GRID_INV);
  let cz0 = Math.floor(((z0 < z1 ? z0 : z1) - reach - GRID_MIN) * GRID_INV);
  let cz1 = Math.floor(((z0 > z1 ? z0 : z1) + reach - GRID_MIN) * GRID_INV);
  if (cx0 < 0) cx0 = 0;
  else if (cx0 > GRID_LAST) cx0 = GRID_LAST;
  if (cz0 < 0) cz0 = 0;
  else if (cz0 > GRID_LAST) cz0 = GRID_LAST;
  if (cx1 < 0) cx1 = 0;
  else if (cx1 > GRID_LAST) cx1 = GRID_LAST;
  if (cz1 < 0) cz1 = 0;
  else if (cz1 > GRID_LAST) cz1 = GRID_LAST;
  const len2 = sx * sx + sz * sz;
  const inv = len2 > 1e-12 ? 1 / len2 : 0;
  const cap = segOut.length;
  let n = 0;
  for (let cz = cz0; cz <= cz1; cz++) {
    const row = cz * GRID_DIM;
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = row + cx;
      const cnt = cellCount[c];
      if (cnt === 0) continue;
      const first = cellStart[c];
      for (let q = first; q < first + cnt; q++) {
        const i = items[q];
        if (ALIVE[i] === 0 || n >= cap) continue;
        const ax = EX[i] - x0;
        const az = EZ[i] - z0;
        let t = (ax * sx + az * sz) * inv;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const dx = ax - sx * t;
        const dz = az - sz * t;
        const rr = pr + ER[i];
        if (dx * dx + dz * dz > rr * rr) continue;
        let at = n;
        while (at > 0 && segT[at - 1] > t) {
          segT[at] = segT[at - 1];
          segOut[at] = segOut[at - 1];
          at--;
        }
        segT[at] = t;
        segOut[at] = i;
        n++;
      }
    }
  }
  const boss = E.bossIndex;
  if (boss >= 0 && ALIVE[boss] === 1 && n < cap) {
    const ax = EX[boss] - x0;
    const az = EZ[boss] - z0;
    let t = (ax * sx + az * sz) * inv;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = ax - sx * t;
    const dz = az - sz * t;
    const rr = pr + ER[boss];
    if (dx * dx + dz * dz <= rr * rr) {
      let at = n;
      while (at > 0 && segT[at - 1] > t) {
        segT[at] = segT[at - 1];
        segOut[at] = segOut[at - 1];
        at--;
      }
      segT[at] = t;
      segOut[at] = boss;
      n++;
    }
  }
  return n;
}

/** Demi-tour du boomerang k : nouveau trajet (les robots de l'aller redeviennent frappables), source = ce point. */
function turnBoomerang(k) {
  pFromY[k] = pAirY[k]; // § E5.D : le retour redescend de l'altitude de l'aller et frappe de nouveau au sol
  pAirY[k] = 0;
  pHitN[k] = 1;
  bmLeg[pPierce[k]] = ++bmLegs;
  pOX[k] = pX[k];
  pOZ[k] = pZ[k];
  pTravel[k] = 0;
  E2B[CB_TURNS]++;
  if (evolved[WEAPON.BOOMERANG] !== 0 && evo !== null) {
    // § E3.B : Shuriken givré — il éclate au demi-tour
    ARGF[F_X_E3C] = pX[k];
    ARGF[F_Z_E3C] = pZ[k];
    evo.eventF(WEAPON.BOOMERANG);
  }
}

/** Vol du boomerang k (dt dans BM_S[0]) : aller droit, retour vers le héros, un coup par robot et par trajet. */
function updateBoomerang(k) {
  const dt = BM_S[0];
  const w = WEAPON.BOOMERANG;
  const W = WEAPONS[w];
  const slot = pPierce[k];
  const back = pHitN[k] === 1;
  pBlast[k] -= dt;
  if (back) {
    // retour : vers la position COURANTE du héros
    let dx = P.x - pX[k];
    let dz = P.z - pZ[k];
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l <= W.catchDist || pBlast[k] <= 0) {
      if (l <= W.catchDist) {
        E2B[CB_CAUGHT]++;
        E2B[CB_CATCH] = pX[k];
        E2B[CB_CATCH + 1] = pZ[k];
      } else E2B[CB_EXPIRED]++;
      bmBusy[slot] = 0;
      removeProjectile(k);
      return;
    }
    dx /= l;
    dz /= l;
    pDX[k] = dx;
    pDZ[k] = dz;
    pVX[k] = dx * W.returnSpeed;
    pVZ[k] = dz * W.returnSpeed;
  }
  let step = dt;
  if (!back && pLife[k] < dt) step = pLife[k] > 0 ? pLife[k] : 0;
  const fx0 = pX[k];
  const fz0 = pZ[k];
  const x0 = pSX[k];
  const z0 = pSZ[k];
  const x1 = fx0 + pVX[k] * step;
  const z1 = fz0 + pVZ[k] * step;
  BM_S[4] = x0;
  BM_S[5] = z0;
  BM_S[6] = x1;
  BM_S[7] = z1;
  BM_S[8] = pR[k];
  const n = gatherSegment();
  const UID = E.uid;
  const ALIVE = E.alive;
  const leg = bmLeg[slot];
  const fl = flagsOf[w];
  let bounce = -1; // aller : arrêté par un bouclier → demi-tour au point de contact
  const air = pAirY[k]; // § E5.D : aller aérien (vers un volant haut) — remis à 0 au demi-tour
  const TYPE = E.type;
  for (let q = 0; q < n; q++) {
    const i = segOut[q];
    if (ALIVE[i] === 0) continue;
    if (air > 0 && airTop[TYPE[i]] < air) {
      E5D[1]++; // survolé à l'aller : il reste frappable au retour
      continue;
    }
    const c = i * BMCAP + slot;
    const uid = UID[i];
    if (bmStamp[c] === leg && bmUid[c] === uid) continue; // déjà touché pendant ce trajet
    bmStamp[c] = leg;
    bmUid[c] = uid;
    ARGF[F_V] = pDmg[k];
    ARGF[F_SX] = pOX[k];
    ARGF[F_SZ] = pOZ[k];
    const r = damage.hitEnemyF(i, w, fl);
    // § E4.P : de face, le bouclier d'un blindé atténue (r = 2, dégâts réduits portés) : rebond à l'aller comme avant
    if (r < 0 || (r === 2 && !back)) {
      E2B[CB_BM_BLOCKED]++;
      if (!back) {
        bounce = q;
        break;
      }
      continue; // retour : il traverse le bouclier sans dégât
    }
    if (r === 0) continue;
    if (air > 0) E5D[2]++; // § E5.D : coup aérien porté
    E2B[CB_BM_HITS]++;
    if (pKb[k] > 0) {
      ARGF[F_DX] = pDX[k];
      ARGF[F_DZ] = pDZ[k];
      ARGF[F_V] = pKb[k];
      enemies.applyKnockbackF(i);
    }
  }
  if (bounce >= 0) {
    const t = segT[bounce];
    pX[k] = x0 + (x1 - x0) * t;
    pZ[k] = z0 + (z1 - z0) * t;
    pSX[k] = pX[k];
    pSZ[k] = pZ[k];
    Q[0] = pX[k];
    Q[1] = kHeight[w];
    Q[2] = pZ[k];
    V.impact(w);
    turnBoomerang(k);
    return;
  }
  pX[k] = x1;
  pZ[k] = z1;
  pSX[k] = x1;
  pSZ[k] = z1;
  pTravel[k] += Math.sqrt((x1 - fx0) * (x1 - fx0) + (z1 - fz0) * (z1 - fz0));
  if (!back) {
    pLife[k] -= dt;
    if (pLife[k] <= 0) turnBoomerang(k);
    else if (pBlast[k] <= 0) {
      E2B[CB_EXPIRED]++;
      bmBusy[slot] = 0;
      removeProjectile(k);
    }
  }
}

// ----- Mines logiques -------------------------------------------------------------------------------------------------------
const MCAP = CAPS.mines;
const miX = new Float32Array(MCAP);
const miZ = new Float32Array(MCAP);
const miLife = new Float32Array(MCAP); // s restantes ; ≤ 0 : pas de mine
const miAge = new Float32Array(MCAP); // s depuis la pose
const miFade = new Float32Array(MCAP); // s restantes de l'extinction (mine finie, encore dessinée)
const miFromX = new Float32Array(MCAP); // point de sortie : la bouche du mollet (bouche_mines)
const miFromY = new Float32Array(MCAP);
const miFromZ = new Float32Array(MCAP);
const miSeed = new Float32Array(MCAP);
const MI_S = new Float64Array(2); // 0 : rang du sixième interrogé à cette image ; 1 : angle de la couronne de pose
let mineCount = 0; // mines en vie

/** Emplacement pour une mine : un libre, sinon celui de la plus ancienne (elle s'éteint). */
function takeMine() {
  let old = 0;
  for (let s = 0; s < MCAP; s++) {
    if (!(miLife[s] > 0)) return s;
    if (miAge[s] > miAge[old]) old = s;
  }
  mineCount--;
  E2B[CB_EXPIRED]++;
  return old;
}

/** Pose : COUNT mines en couronne autour du talon (derrière le héros), sorties du mollet droit. Toujours vrai. */
function fireMines() {
  const w = WEAPON.MINES;
  const W = WEAPONS[w];
  const count = Math.round(effective[w * STAT_COUNT + STAT.COUNT]);
  const cx = P.x - P.moveX * W.heelDist;
  const cz = P.z - P.moveZ * W.heelDist;
  let mx = P.x;
  let my = 0.4;
  let mz = P.z;
  if (__A.bouche(w) === 1) {
    mx = __A.B[0];
    my = __A.B[1];
    mz = __A.B[2];
  }
  E2B[CB_LAST + 6] = mx;
  E2B[CB_LAST + 7] = my;
  E2B[CB_LAST + 8] = mz;
  for (let k = 0; k < count && k < MCAP; k++) {
    let x = cx;
    let z = cz;
    // couronne autour du talon ; une seule mine par pose : couronne plus serrée, dont l'angle tourne d'une pose à
    // l'autre — les mines d'un héros immobile ne s'empilent pas au même point
    const a = MI_S[1] + (k * TAU) / count;
    const rad = count > 1 ? W.spread : W.spread * W.soloSpread;
    x += Math.cos(a) * rad;
    z += Math.sin(a) * rad;
    world.resolve(x, z, 0.3, tuOut); // jamais dans un obstacle ni hors de l'arène
    const s = takeMine();
    miX[s] = tuOut[0];
    miZ[s] = tuOut[1];
    miLife[s] = W.lifeSeconds;
    miAge[s] = 0;
    miFade[s] = 0;
    miFromX[s] = mx;
    miFromY[s] = my;
    miFromZ[s] = mz;
    miSeed[s] = rand();
    mineCount++;
    E2B[CB_DROPPED]++;
  }
  // la couronne tourne d'une pose à l'autre : d'un demi-pas (les mines de deux poses s'intercalent) plus une dérive
  MI_S[1] += Math.PI / count + 0.35;
  if (MI_S[1] > TAU) MI_S[1] -= TAU;
  countShot(w);
  return true;
}

/** La mine s explose : elle quitte le pool AVANT damage.explode (non réentrant), éclat et onde à sa couleur. */
function explodeMine(s) {
  const w = WEAPON.MINES;
  const W = WEAPONS[w];
  const o = w * STAT_COUNT;
  const x = miX[s];
  const z = miZ[s];
  E2B[CB_BOOM_AGE] = miAge[s];
  miLife[s] = 0;
  miFade[s] = 0;
  mineCount--;
  if (ARG[A_BLAST] !== effective[o + STAT.AREA]) ARG[A_BLAST] = effective[o + STAT.AREA];
  if (ARG[A_DMG + w] !== effective[o + STAT.DAMAGE]) ARG[A_DMG + w] = effective[o + STAT.DAMAGE];
  Q[0] = x;
  Q[2] = z;
  Q[3] = ARG[A_BLAST];
  V.explosion(w);
  E2B[CB_BOOMS]++;
  damage.explode(x, z, ARG[A_BLAST], ARG[A_DMG + w], 0, w, flagsOf[w], FXK.ROCKET_TOON, W.explosionTrauma, W.explosionPunch, W.knockback);
}

/** Mines : durée, armement, détection (un sixième des emplacements par image, à tour de rôle). */
function updateMines(dt) {
  const w = WEAPON.MINES;
  const W = WEAPONS[w];
  const div = W.scanDivisor;
  const phase = MI_S[0];
  MI_S[0] = phase + 1 >= div ? 0 : phase + 1;
  const detect = effective[w * STAT_COUNT + STAT.SPECIAL];
  for (let s = 0; s < MCAP; s++) {
    if (miFade[s] > 0) miFade[s] -= dt;
    if (!(miLife[s] > 0)) continue;
    miAge[s] += dt;
    miLife[s] -= dt;
    if (miLife[s] <= 0) {
      miLife[s] = 0;
      miFade[s] = W.fadeOut;
      mineCount--;
      E2B[CB_EXPIRED]++;
      continue;
    }
    if (miAge[s] < W.armSeconds || s % div !== phase) continue;
    NEAR_S[0] = miX[s];
    NEAR_S[1] = miZ[s];
    NEAR_S[2] = detect;
    if (nearestFrom(-1, -1) >= 0) explodeMine(s);
  }
}

function clearMines() {
  miLife.fill(0);
  miFade.fill(0);
  miAge.fill(0);
  mineCount = 0;
}

function resetE2B() {
  E2B.fill(0);
  clearPools();
  clearBoomerangs();
  clearMines();
  bmStamp.fill(0);
  bmLegs = 0;
  MI_S[0] = 0;
  MI_S[1] = 0;
}

/** Instances du lot TIRS : flacon (k = projectile du pool commun) ; p = décalage dans le tampon a. */
function syncFlask(k, a, p) {
  const W = WEAPONS[WEAPON.POOL];
  const T = W.flightSeconds;
  let u = pTravel[k] / T;
  if (u > 1) u = 1;
  const y0 = pKb[k];
  const y = y0 + (W.height - y0) * u + W.arcHeight * 4 * u * (1 - u);
  const v = Math.sqrt(pVX[k] * pVX[k] + pVZ[k] * pVZ[k]);
  const vy = (W.height - y0 + W.arcHeight * 4 * (1 - 2 * u)) / T;
  const inv = 1 / Math.sqrt(v * v + vy * vy + 1e-9);
  a[p] = pX[k];
  a[p + 1] = y;
  a[p + 2] = pZ[k];
  a[p + 3] = VFX.flacon.tete;
  a[p + 4] = pDX[k] * v * inv;
  a[p + 5] = vy * inv;
  a[p + 6] = pDZ[k] * v * inv;
  a[p + 7] = pTravel[k] * Math.sqrt(v * v + vy * vy) < VFX.flacon.traine ? pTravel[k] * Math.sqrt(v * v + vy * vy) : VFX.flacon.traine;
  a[p + 8] = VFX_STYLE.FLACON;
  a[p + 9] = (k * 0.37) % 1;
  a[p + 10] = 1;
  a[p + 11] = VFX.flacon.marge;
}

/** Instances du lot TIRS : boomerang (k = projectile du pool commun). */
function syncBoomerang(k, a, p) {
  const w = WEAPON.BOOMERANG;
  const size = pR[k];
  a[p] = pX[k];
  // l'aller descend de la hanche à sa hauteur de vol sur son premier mètre (comme les tirs de bras)
  a[p + 1] = kHeight[w] + (pHitN[k] === 0 && __A.ACTIF[0] === 1 && pTravel[k] < 1 ? (__A.BY[w] - kHeight[w]) * (1 - pTravel[k]) : 0);
  a[p + 2] = pZ[k];
  a[p + 3] = size;
  a[p + 4] = pDX[k];
  a[p + 5] = 0;
  a[p + 6] = pDZ[k];
  a[p + 7] = 0;
  a[p + 8] = VFX_STYLE.BOOMERANG;
  a[p + 9] = pPierce[k] * 0.137; // phase de rotation stable : son emplacement
  a[p + 10] = 1;
  a[p + 11] = size * VFX.boomerang.marge;
  if (pAirY[k] > 0 || pFromY[k] > 0) volAir(k, a, p); // § E5.D : aller aérien, retour qui redescend
}

// ----- § E5.D : dessin des tirs aériens et du réticule -----------------------------------------------------------------
const MONTEE_INV = 1 / REPARATEUR_VOL.montee;

/**
 * Tir aérien k, instance p du lot (hauteur déjà écrite = celle d'un tir au sol) : il monte (ou redescend, au retour
 * d'un boomerang ou après un rebond sur un volant) de son altitude de départ à celle de sa cible sur REPARATEUR_VOL.montee
 * m de vol, le ruban penché dans la pente. Entiers en argument (§ V).
 */
function volAir(k, a, p) {
  let u = pTravel[k] * MONTEE_INV;
  if (u > 1) u = 1;
  const from = pFromY[k] > 0 ? pFromY[k] : a[p + 1];
  const to = pAirY[k] > 0 ? pAirY[k] : kHeight[pKind[k]];
  const dy = (to - from) * 6 * u * (1 - u) * MONTEE_INV;
  const cp = 1 / Math.sqrt(1 + dy * dy);
  a[p + 1] = from + (to - from) * u * u * (3 - 2 * u);
  a[p + 4] *= cp;
  a[p + 5] = dy * cp;
  a[p + 6] *= cp;
}

/** § E5.D — indice dans E du réparateur marqué (il change à la compaction de E : retrouvé par uid), −1 s'il est mort. */
function marqueVivante() {
  let i = MARK[0];
  if (i >= 0 && i < E.count && E.uid[i] === MARK[1] && E.alive[i] === 1) return i;
  const uid = MARK[1];
  i = -1;
  for (let q = 0; q < E.count; q++) {
    if (E.uid[q] === uid && E.alive[q] === 1) {
      i = q;
      break;
    }
  }
  MARK[0] = i;
  if (i < 0) MARK_T[0] = 0;
  return i;
}

/** Instances du lot CONTINUS : nappes puis mines, à la suite de nc ; renvoie le nouveau compte. */
/** § E3.Z.12 : une instance CHAMP (couchée, continue) par bulle ouverte. f = ouverture, L = onde (1 → 0), g = graine. */
function syncChamps(ac, nc, cap) {
  const R = CH_S[0];
  for (let s = 0; s < TCAP && nc < cap; s++) {
    if (!(chOpen[s] > 0)) continue;
    const p = nc * STRIDE;
    nc++;
    ac[p] = tuX[s];
    ac[p + 1] = CH.hauteur;
    ac[p + 2] = tuZ[s];
    ac[p + 3] = R;
    ac[p + 4] = 1;
    ac[p + 5] = s === AS_I[0] ? AS[0] * 0.55 + AS[4] * 0.45 : 0; // § E5.F : teinte de soin (iB.y, inutilisé ≥ 20)
    ac[p + 6] = 0;
    ac[p + 7] = chOnde[s];
    ac[p + 8] = VFX_STYLE.CHAMP;
    ac[p + 9] = s * 0.618 + 0.17;
    ac[p + 10] = chOpen[s];
    ac[p + 11] = R + CH.marge;
  }
  return nc;
}

function syncPoolsMines(ac, nc, cap) {
  const WP = WEAPONS[WEAPON.POOL];
  for (let s = 0; s < POCAP && nc < cap; s++) {
    const alive = poLife[s] > 0;
    if (!alive && !(poFade[s] > 0)) continue;
    let f = alive ? poAge[s] / WP.fadeIn : poFade[s] / WP.fadeOut;
    if (f > 1) f = 1;
    // les dernières fadeOut secondes de vie annoncent la fin (la nappe pâlit avant de s'évaporer)
    if (alive && poLife[s] < WP.fadeOut) f *= 0.6 + 0.4 * (poLife[s] / WP.fadeOut);
    else if (!alive) f *= 0.6;
    const p = nc * STRIDE;
    nc++;
    ac[p] = poX[s];
    ac[p + 1] = WP.height;
    ac[p + 2] = poZ[s];
    ac[p + 3] = poR[s];
    ac[p + 4] = 1;
    ac[p + 5] = 0;
    ac[p + 6] = 0;
    ac[p + 7] = poBite[s] > 0 ? poBite[s] / WP.biteFlash : 0;
    ac[p + 8] = VFX_STYLE.NAPPE;
    ac[p + 9] = s * 0.618 + 0.11;
    ac[p + 10] = f;
    ac[p + 11] = poR[s] + VFX.nappe.marge;
  }
  const WM = WEAPONS[WEAPON.MINES];
  const detect = effective[WEAPON.MINES * STAT_COUNT + STAT.SPECIAL];
  for (let s = 0; s < MCAP && nc < cap; s++) {
    const alive = miLife[s] > 0;
    if (!alive && !(miFade[s] > 0)) continue;
    let x = miX[s];
    let y = WM.height;
    let z = miZ[s];
    let k = alive ? 1 : miFade[s] / WM.fadeOut;
    if (alive && miAge[s] < WM.dropSeconds) {
      // la mine tombe du mollet au sol, en petite cloche
      const u = miAge[s] / WM.dropSeconds;
      const e = u * u * (3 - 2 * u);
      x = miFromX[s] + (x - miFromX[s]) * e;
      z = miFromZ[s] + (z - miFromZ[s]) * e;
      y = miFromY[s] * (1 - e) + WM.height * e + 0.25 * 4 * u * (1 - u);
      k = 0.4 + 0.6 * e;
    }
    let f = miAge[s] / WM.armSeconds;
    if (f > 1) f = 1;
    const p = nc * STRIDE;
    nc++;
    ac[p] = x;
    ac[p + 1] = y;
    ac[p + 2] = z;
    ac[p + 3] = detect;
    ac[p + 4] = 1;
    ac[p + 5] = 0;
    ac[p + 6] = 0;
    ac[p + 7] = WM.size * k;
    ac[p + 8] = VFX_STYLE.MINE;
    ac[p + 9] = miSeed[s];
    ac[p + 10] = alive ? f : 0;
    ac[p + 11] = detect + VFX.mine.marge;
  }
  return nc;
}

/** Tests seulement : compteurs et relevés du chantier B (nappes, boomerangs, mines, départ du dernier tir). */
export function debugE2B(out) {
  out.throws = E2B[CB_THROWS];
  out.landed = E2B[CB_LANDED];
  out.bites = E2B[CB_BITES];
  out.biteHits = E2B[CB_BITE_HITS];
  out.turns = E2B[CB_TURNS];
  out.caught = E2B[CB_CAUGHT];
  out.boomHits = E2B[CB_BM_HITS];
  out.boomBlocked = E2B[CB_BM_BLOCKED];
  out.dropped = E2B[CB_DROPPED];
  out.booms = E2B[CB_BOOMS];
  out.expired = E2B[CB_EXPIRED];
  out.lastCatch = [E2B[CB_CATCH], E2B[CB_CATCH + 1]];
  out.lastBoomAge = E2B[CB_BOOM_AGE];
  out.throwIn = PO_S[0];
  out.lastShot = {
    pool: [E2B[CB_LAST], E2B[CB_LAST + 1], E2B[CB_LAST + 2]],
    boomerang: [E2B[CB_LAST + 3], E2B[CB_LAST + 4], E2B[CB_LAST + 5]],
    mines: [E2B[CB_LAST + 6], E2B[CB_LAST + 7], E2B[CB_LAST + 8]],
  };
  out.pools = [];
  for (let s = 0; s < POCAP; s++) if (poLife[s] > 0) out.pools.push({ slot: s, x: poX[s], z: poZ[s], r: poR[s], life: poLife[s], age: poAge[s], bites: poBites[s] });
  out.mines = [];
  for (let s = 0; s < MCAP; s++) if (miLife[s] > 0) out.mines.push({ slot: s, x: miX[s], z: miZ[s], life: miLife[s], age: miAge[s], armed: miAge[s] >= WEAPONS[WEAPON.MINES].armSeconds });
  out.boomerangs = [];
  out.flasks = [];
  for (let k = 0; k < pCount; k++) {
    if (pKind[k] === WEAPON.BOOMERANG) out.boomerangs.push({ x: pX[k], z: pZ[k], dx: pDX[k], dz: pDZ[k], back: pHitN[k] === 1, slot: pPierce[k], size: pR[k] });
    else if (pKind[k] === WEAPON.POOL) out.flasks.push({ x: pX[k], z: pZ[k], tx: pTX[k], tz: pTZ[k], left: pLife[k] });
  }
  out.slotsBusy = 0;
  for (let s = 0; s < BMCAP; s++) out.slotsBusy += bmBusy[s];
  return out;
}

// =====================================================================================================================
// ÉTAPE 3, CHANTIER B (ARCHITECTURE.md § E3.B) — évolutions
// =====================================================================================================================
// evolved[w] : 0, ou id d'évolution + 1 (l'arme w a évolué) ; absorbed[w] = 1 : l'arme a été absorbée par une évolution
// « arme + arme » (elle ne ressort jamais d'un tirage : chests.isWeaponDrawable, agents.arsenalExhausted). Les effets
// évolués sont dans src/evolutions.js ; ici, seulement l'état et quatre crochets (roquette, rail, boomerang, orbite).
export const evolved = new Uint8Array(WEAPON_COUNT);
export const absorbed = new Uint8Array(WEAPON_COUNT);
let evo = null; // src/evolutions.js (ctx.evolutions), null sans le chantier B
let EVO_ORBIT = new Float64Array([1]); // rayon de l'orbite × EVO_ORBIT[0] : evolutions.ORBIT_MUL à init (Couronne de scies)

/** L'arme w peut évoluer : possédée, niveau 21 (ses 5 lignes au niveau 5), pas encore évoluée. */
export function canEvolve(w) {
  return w >= 0 && w < WEAPON_COUNT && owned[w] === 1 && evolved[w] === 0 && getWeaponLevel(w) >= 1 + STAT_COUNT * (STAT_MAX_LEVEL - 1);
}

/** Hors combat (evolutions.apply) : l'arme w devient l'évolution id. Garde niveaux et surcharge. false si refusé. */
export function evolve(w, id) {
  if (!canEvolve(w) || !(id >= 0 && id < 255)) return false;
  evolved[w] = id + 1;
  dirty = true;
  return true;
}

/** Hors combat : l'arme w est absorbée par une évolution « arme + arme » — elle quitte le jeu, son emplacement se libère. */
export function absorb(w) {
  if (!(w >= 0 && w < WEAPON_COUNT)) return false;
  if (owned[w] === 1) debugSetOwned(w, false); // même retrait que le debug : projectiles, tourelles, emplacement rendu
  absorbed[w] = 1;
  return true;
}

/** Champ de mines : toutes les mines posées sautent (impulsion du condensateur). Rend le nombre de mines sautées. */
export function detonateMines() {
  let n = 0;
  for (let s = 0; s < MCAP; s++) {
    if (!(miLife[s] > 0)) continue;
    explodeMine(s);
    n++;
  }
  return n;
}
