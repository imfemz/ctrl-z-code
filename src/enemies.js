// LOT : enemies — robots : apparition, IA (tronc commun + un comportement par type), séparation par la grille,
// contacts, projectiles ennemis, six maillages instanciés, animation procédurale (contrat : ARCHITECTURE.md § J).
//
// Tronc commun [F] (§ J.2), inchangé : boucle A (minuteries, vitesse voulue, séparation, déplacement), un appel à
// world.resolveMany, boucle B (contacts avec le joueur et le boss, cap), puis une seconde résolution pour les seuls
// robots repoussés. Le boss n'y reçoit que ses minuteries et sa frappe ; boss.js seul le déplace.
//
// Comportements [L] réalisés ici (étape 2 de la boucle A) et champs libres de E dont chacun se sert :
//   Rôdeur      fonce sur le joueur.
//   Drone       fonce en zigzag, en vol (RESOLVE.FLY : bords de l'arène seulement).        ai0 = vitesse latérale
//   Tireur      garde ses distances, s'arrête, s'allume (windup), tire.                    state, cd = recharge,
//                                                                                          timer = visée, ai0 = sens
//                                                                                          du pas de côté, ai1 = recul
//   Kamikaze    fonce ; près du joueur (ou bloqué à portée de souffle) : mèche, clignote   state, timer = mèche,
//               de plus en plus vite, explose.                                             ai0 = phase du clignotement,
//                                                                                          ai1 = temps passé bloqué
//   Blindé      avance dans l'axe de son cap, tourne à turnRate ; bouclier frontal (damage.isShieldedFrom lit E.rot).
//   Réparateur  tient sa distance, soigne les plus abîmés autour de lui.                   state, cd = prochain soin,
//                                                                                          ai0 = sens du pas de côté
//
// Révisions v2 / v3 (étape 1 du plan addictif, § E1.B) : rev[type] = révision du type pour la vague en cours (posée par
// setRevisions, appelée par waves.startWave). Une branche de update ne lit que ce tableau, jamais la table par robot.
//   Tireur v2     salve de 3 tirs en éventail ; v3 : un tir sur trois est un obus lobé (zone HAZ.STRIKE).  rev0 = tirs comptés
//   Drone v2      piqué annoncé par un trait au sol ; v3 : laisse une flaque à sa mort.        state = manœuvre (M_*),
//   Rôdeur v2     s'accroupit puis bondit.                                                       timer, cd = recharge,
//   Blindé v2     tourne deux fois plus vite, charge annoncée par un trait.                      rev0 = cap de la manœuvre
//   Kamikaze v2   son explosion arme les kamikazes voisins.
//   Réparateur v2 pose une bulle-bouclier (E.shield, durée E.rev1 — pour TOUS les types) au lieu de soigner.
// E.glow : visée du tireur, mèche du kamikaze, impulsion du réparateur, soin reçu (rôdeur, drone, blindé).
import * as THREE from 'three';
import {
  BOSS,
  CAPS,
  DAMAGE,
  DMG,
  DMG_SRC,
  EFLAG,
  ENEMIES,
  ENEMY,
  ENEMY_COUNT,
  ENEMY_KEYS,
  EVENTS,
  FX,
  FXK,
  GRID,
  HAZ,
  HURT,
  PALETTE,
  PLAYER,
  RENDER,
  RESOLVE,
  SFX,
  WORLD,
  enemyRevision,
  waveHpMul,
} from './config.js';
import { CHESTS } from './config.js'; // § E2.C : élite porteuse
import { CARRY, CARRY_SCALE } from './config.js'; // § E3.K : survivants reportés (veille, fusion des excédents)
import { REPLI } from './config.js'; // § E4.F : repli puis retour des survivants
import { CONFORT_FLASHS as CF } from './config.js'; // § E5.X5 (audit C12) : réglage « Flashs »
import { LISIBILITE_GUIDE } from './config.js'; // § E5.P (B1) : foule autour du héros, lue par src/silhouette-heros.js
import { REPARATEUR_VOL } from './config.js'; // § E5.D : réparateurs volants (volants hauts : séparation entre eux seuls)
import { ARGF, E, F_DX, F_DZ, F_SX, F_SZ, F_T, F_V, F_X, F_Z, P, rand, run } from './state.js';
import * as allure from './anim/allure.js';
import { appliquerTexturesModele } from './rendu/materiaux.js'; // modèles allégés à texture cuite (17/11)
import * as VFXP from './vfx/projectiles.js';
import * as TC from './tirs-canon.js'; // § E4.J : ancien visuel des balles (maillage « tirs-ennemis »)
import * as e3 from './enemies-e3.js'; // § E3.D : Foreuse, Poseur, Scanner, Diviseur
import { vuRobot } from './defis.js'; // § E4.A : Collection (robots rencontrés)
//#region e5:M-dangers-guide
import { DANGERS_GUIDE } from './config.js'; // § E5.M : yeux sombres, annonce avant le flash, décalques des manœuvres
//#endregion
//#region e5:N-combat-guide
import { COMBAT_GUIDE } from './config.js'; // § E5.N : flash court d'un robot qui annonce, trait du rôdeur figé
import { CAUSE } from './config.js'; // § E5.Q (C2) : cause des coups reçus ; (B13) son de la visée du tireur
// AN[0] : E.flash au-dessus duquel la tête de la courbe reste (flash court) ; AN[1] : 1 / court ; AN[2] : part
const AN = new Float64Array(3);
/** § E5.N : réglage du flash d'un robot qui annonce (init ; planches et tests : variantes comparées en jeu). */
export function reglerAnnonce(part = COMBAT_GUIDE.annonce.part, court = COMBAT_GUIDE.annonce.court) {
  AN[0] = 1 - court;
  AN[1] = 1 / court;
  AN[2] = part;
}
reglerAnnonce();
const RODEUR_FIGE = COMBAT_GUIDE.rodeur.figer; // § E5.N (point 8) : cap pris au début de l'accroupi
//#endregion
//#region e5:X8-lot8
import { ELITE_MOD, LOT8 } from './config.js'; // § E5.X8 : récupération (E8), Phasé sans contact (E11), visée (G5), souffles (E10)
// X8 : [0] s de récupération, [1] demi-largeur du trait du tireur, [2] sa longueur, [3] son gain ; sons en entiers / flottants
const X8 = new Float64Array([LOT8.recup.secondes, LOT8.tireur.largeur * 0.5, LOT8.tireur.longueur, LOT8.tireur.gain]);
const X8_SON = new Float64Array([LOT8.sons.bond.gain, LOT8.sons.bond.vitesse, LOT8.sons.pique.gain, LOT8.sons.pique.vitesse]);
const X8_SON_BOND = LOT8.sons.bond.id | 0;
const X8_SON_PIQUE = LOT8.sons.pique.id | 0;
const PHASE_MOD = ELITE_MOD.PHASE;
let elites = null; // ctx.elites (élite Phasé : plus de frappe au contact pendant sa phase)
/** § E5.X8 (tests) : [0] récupérations commencées, [1] contacts refusés pendant une récupération, [2] contacts refusés
 *  pendant la phase d'un Phasé, [3] traits de visée du tireur posés, [4] souffles de bond, [5] souffles de piqué */
export const X8_COMPTES = new Uint32Array(6);
/** § E5.X8 (E10) : souffle d'une manœuvre (son existant, gain et vitesse propres), au point (ARGF F_X, F_Z déjà posés). */
function souffleF(id, k) {
  ARGF[F_V] = X8_SON[k];
  ARGF[F_T] = X8_SON[k + 1];
  audio.playGainRateF(id);
}
/** § E5.X8 : le robot i peut-il frapper au contact ? 0 = non (récupération, ou Phasé en phase). Compte le refus. */
function contactPermisF(i) {
  if (E.recup[i] > 0) {
    X8_COMPTES[1]++;
    return 0;
  }
  if (E.mod[i] === PHASE_MOD && elites !== null && elites.phaseF(i) === 1) {
    X8_COMPTES[2]++;
    return 0;
  }
  return 1;
}
//#endregion e5:X8-lot8

const LOT_ENNEMIS = VFXP.LOT.ENNEMIS;
const VFX_STRIDE = VFXP.STRIDE;

let ctx = null;
let grid = null;
let world = null;
let damage = null;
let debug = null;
let render = null;
let audio = null;
let fx = null;
let hazards = null;
let view = null; // § E4.F : champ de jeu (camera.view), lu par le repli et l'entrée des reportés

const CAP = CAPS.enemies;
const BOSS_T = ENEMY.BOSS;
const RODEUR_T = ENEMY.RODEUR;
const DRONE_T = ENEMY.DRONE;
const TIREUR_T = ENEMY.TIREUR;
const KAMIKAZE_T = ENEMY.KAMIKAZE;
const BLINDE_T = ENEMY.BLINDE;
const REPARATEUR_T = ENEMY.REPARATEUR;
const FOREUSE_T = ENEMY.FOREUSE; // § E3.D : premier des quatre types de l'étape 3
const GRID_DIM = GRID.dim;
const GRID_MIN = GRID.min;
const GRID_INV = 1 / GRID.cellSize; // la grille est lue en tableaux bruts (§ F)
const TWO_PI = Math.PI * 2;

// États d'IA (E.state) : le sens dépend du type.
const S_NEW = 0; // tireur : pas encore arrivé à portée ; réparateur : pas encore réglé (première image)
const S_MOVE = 1; // tireur, réparateur : se place
const S_AIM = 2; // tireur : vise, immobile, la lueur monte
const K_CHASE = 0; // kamikaze : fonce
const K_FUSE = 1; // kamikaze : mèche allumée
// Manœuvre d'une révision (drone : piqué ; rôdeur : bond ; blindé : charge) — E.state de ces trois types, lu aussi par
// src/anim/allure.js (mêmes valeurs).
const M_NONE = 0;
const M_WARN = 1; // annonce : immobile (trait au sol, ou accroupi)
const M_GO = 2; // il fonce en ligne droite, cap figé (E.rev0)

// Tables par type (remplies à l'init)
const massInv = new Float32Array(ENEMY_COUNT);
const hover = new Float32Array(ENEMY_COUNT);
const turnRate = new Float32Array(ENEMY_COUNT); // 0 = cap immédiat
const keepMin = new Float32Array(ENEMY_COUNT); // robots « à distance » : recule en deçà…
const keepMax = new Float32Array(ENEMY_COUNT); // …avance au-delà (0 = le type poursuit le joueur)
const strafeMul = new Float32Array(ENEMY_COUNT);
const retreatMul = new Float32Array(ENEMY_COUNT);
const healGlowOk = new Uint8Array(ENEMY_COUNT); // 1 = la lueur du type est celle du soin : un soin reçu se voit
// Extinction de la lueur, par seconde. Un robot dont la seule lueur est la teinte d'un soin reçu (rôdeur, drone, blindé)
// la perd en healTintSeconds : faible pour rester gris, elle doit durer pour se voir. Les autres : glowFade.
const glowFadeOf = new Float32Array(ENEMY_COUNT);
// § E5.D : 1 = « volant haut » (survol ≥ REPARATEUR_VOL.volHaut : le réparateur). Séparation (étape 3) entre robots de
// même classe seulement : la horde au sol ne bloque pas un volant haut, qui ne la pousse pas non plus.
const volHaut = new Uint8Array(ENEMY_COUNT);
// Animation procédurale : src/anim/allure.js (§ Z sexies)

const modes = new Uint8Array(CAP); // RESOLVE.* de chaque robot pour world.resolveMany
const pushedModes = new Uint8Array(CAP); // même chose, pour les seuls robots repoussés par le joueur ou le boss

// ----- Réglages des comportements (config.js, région lot:enemies) ----------------------------------------------------
const COMMON = ENEMIES.common;
const KEEP_RAMP_INV = 1 / COMMON.keepRamp;

const WEAVE = ENEMIES.types[DRONE_T].weave;
const WEAVE_W = WEAVE.hz * TWO_PI;
const WEAVE_FADE_INV = 1 / WEAVE.fadeDist;

const RANGED = ENEMIES.types[TIREUR_T].ranged;
const WINDUP_INV = 1 / RANGED.windup;
const FIRST_DELAY_SPAN = RANGED.firstDelayMax - RANGED.firstDelayMin;
const RELOAD = Math.max(0, RANGED.fireInterval - RANGED.windup); // la visée fait partie de l'intervalle entre deux tirs

const BOOM = ENEMIES.types[KAMIKAZE_T].explode;
const FUSE_INV = 1 / BOOM.fuse;
const BLINK_SPAN = BOOM.blinkHzEnd - BOOM.blinkHzStart;
const SELF_DESTRUCT_FLAGS = BOOM.lootOnSelfDestruct ? DMG.NONE : DMG.NO_LOOT;
// Distance au joueur (de centre à centre) sous laquelle un kamikaze bloqué s'arme : son souffle, moins une marge.
const STUCK_RANGE = BOOM.radius + PLAYER.radius - BOOM.stuckMargin;

const ALIGN_MIN = ENEMIES.types[BLINDE_T].advanceAlign;
const ALIGN_INV = 1 / (1 - ALIGN_MIN);

const HEAL = ENEMIES.types[REPARATEUR_T].heal;
const HEAL_R2 = HEAL.radius * HEAL.radius;
const healScratch = new Uint16Array(CAPS.queryScratch); // résultat de la requête de grille d'une impulsion
const healPick = new Uint16Array(HEAL.maxTargets); // les plus abîmés, du plus au moins
const healMissing = new Float32Array(HEAL.maxTargets);

// ----- Révisions v2 / v3 (§ E1.B, ENEMIES.revisions) ----------------------------------------------------------------
function revision(key) {
  const R = ENEMIES.revisions;
  for (let k = 0; k < R.length; k++) if (R[k].key === key) return R[k];
  throw new Error('révision inconnue : ' + key);
}
const SALVE = revision('salve');
const PIQUE = revision('pique');
const BOND = revision('bond');
const CHAINE = revision('chaine');
const CHARGE = revision('charge');
const BULLE = revision('bulle');
const OBUS = revision('obus');
const FLAQUE = revision('flaque');
const rev = new Uint8Array(ENEMY_COUNT); // révision de chaque type pour la vague en cours (0 = v1)
const turnNow = new Float32Array(ENEMY_COUNT); // vitesse de rotation effective (blindé v2 : × turnMul)
const maneuver = new Uint8Array(ENEMY_COUNT); // 1 = type dont E.state est une manœuvre M_* (cap figé pendant qu'elle dure)
maneuver[RODEUR_T] = 1;
maneuver[DRONE_T] = 1;
maneuver[BLINDE_T] = 1;
maneuver[ENEMY.SCANNER] = 1; // § E3.D : cap = angle du laser (E.rev0) dès qu'il est posé
const goDmgMul = new Float32Array(ENEMY_COUNT).fill(1); // dégâts de contact pendant M_GO
goDmgMul[DRONE_T] = PIQUE.dmgMul;
goDmgMul[BLINDE_T] = CHARGE.dmgMul;
//#region e5:Q-retours-guide
// § E5.Q (C2) : cause d'un coup au contact par type (corps à corps), et pendant sa manœuvre M_GO (bond, piqué, charge)
const causeContact = new Uint8Array(ENEMY_COUNT);
const causeManoeuvre = new Uint8Array(ENEMY_COUNT);
for (let t = 0; t < ENEMY_COUNT; t++) causeContact[t] = causeManoeuvre[t] = CAUSE.CONTACT + t;
causeManoeuvre[RODEUR_T] = CAUSE.BOND;
causeManoeuvre[DRONE_T] = CAUSE.PIQUE;
causeManoeuvre[BLINDE_T] = CAUSE.CHARGE;
//#endregion e5:Q-retours-guide
//#region e5:AC-contact
// § E5.AC (Femz, 22/11 : « mêlée = vrai coup, distance = rien ») : contactOn[t] = 1 pour un robot de mêlée (rôdeur, drone,
// blindé, diviseur) ; les autres ne blessent plus au contact. Un coup de mêlée s'arme : E.fente compte le geste (s), les
// dégâts tombent au sommet (CT[0]). Réglages en flottants dans un tableau typé (aucun champ d'objet lu dans la boucle).
const contactOn = new Uint8Array(ENEMY_COUNT);
// CT : [0] préparation (arrondie en Float32 : E.fente la garde exactement au sommet), [1] préparation + retour, [2] portée,
// [3] maintien, [4] gain du son, [5] écart entre deux sons, [6] horloge simulée, [7] dernier son
const CT = new Float64Array(10); // + [8] dt de l'image, [9] rayon du héros (P.radius)
const CS = new Float64Array(4); // robot en cours : distance² au héros, rayons sommés, écart x, z (robot − héros)
let sonCoup = -1;
/** § E5.AC (tests) : [0] gestes partis, [1] coups portés, [2] coups ratés, [3] images tenues au sommet, [4] sons, [5] éclairs, [6] coups de manœuvre */
export const COUPS_MELEE = new Uint32Array(7);
/** § E5.AC : relit COMBAT_GUIDE.contact (init ; tests : variantes comparées en jeu, preparation 0 = ancien chemin). */
export function reglerContact() {
  const C = COMBAT_GUIDE.contact;
  contactOn.fill(1);
  for (const t of C.sansContact) contactOn[t] = 0;
  contactOn[BOSS_T] = 0; // le boss a sa branche (COMBAT_GUIDE.boss.degatsContact)
  CT[0] = Math.fround(C.preparation > 0 ? C.preparation : 0);
  CT[1] = CT[0] + C.retour;
  CT[2] = C.portee;
  CT[3] = C.maintien;
  CT[4] = C.son.gain;
  CT[5] = C.son.ecart;
  CT[7] = -1e9;
  sonCoup = C.son.id | 0;
  allure.reglerFente();
}
/**
 * § E5.AC : un pas du coup armé du robot i (type t) — la fente avance ; au sommet le coup porte (dégâts, éclair, son dans
 * la même image), est tenu (héros invulnérable un instant encore) ou est raté (dash, hors de portée, étourdi) ; puis la
 * fente revient. Entiers en argument, flottants lus dans CT / CS / PF. Rend 1 si le coup a porté.
 */
function coupArmeF(i, t, peutToucher) {
  const FENTE = E.fente;
  const prep = CT[0];
  const dt = CT[8];
  const fe = FENTE[i];
  if (fe < prep) {
    const nf = fe + dt;
    FENTE[i] = nf < prep ? nf : prep;
  } else if (fe > prep) {
    const nf = fe + dt;
    // (deux écritures plutôt qu'un « ? : » qui mêle un flottant et l'entier 0 : V8 emballait le flottant, § V)
    if (nf < CT[1]) FENTE[i] = nf;
    else FENTE[i] = 0;
  }
  if (FENTE[i] !== prep) return 0;
  const d2 = CS[0];
  const rp = CS[1] + CT[2];
  const ok = contactOn[t] === 1 && d2 < rp * rp && E.slow[i] !== 0 && E.sus[i] === 0 && E.dmg[i] > 0 && E.recup[i] === 0 && (E.mod[i] !== PHASE_MOD || elites === null || elites.phaseF(i) === 0); // § E5.X8
  if (ok && peutToucher === 1) {
    FENTE[i] = prep + 1e-4; // juste après le sommet : l'image du coup montre la fente au sommet, le retour part ensuite
    if (damage.hitPlayer(E.dmg[i], HURT.CONTACT, E.x[i], E.z[i], causeContact[t]) <= 0) {
      COUPS_MELEE[2]++;
      return 0;
    }
    E.atkCd[i] = COMMON.contactInterval;
    COUPS_MELEE[1]++;
    // éclair d'impact au point de contact : bord du héros, côté robot (éclair neutre du flash d'impact, sans gerbe)
    const k = CT[9] / Math.max(Math.sqrt(d2), 1e-4);
    ARGF[F_X] = PF[0] + CS[2] * k;
    ARGF[F_Z] = PF[1] + CS[3] * k;
    fx.spawnImpactF(-1);
    COUPS_MELEE[5]++;
    if (sonCoup >= 0 && CT[6] - CT[7] >= CT[5]) {
      CT[7] = CT[6];
      ARGF[F_X] = E.x[i];
      ARGF[F_Z] = E.z[i];
      ARGF[F_V] = CT[4];
      ARGF[F_T] = 1;
      audio.playGainRateF(sonCoup);
      COUPS_MELEE[4]++;
    }
    return 1;
  }
  if (ok && P.invulnT > 0 && P.invulnT <= CT[3]) {
    COUPS_MELEE[3]++; // sommet tenu (invulnérable un instant encore) : le coup part à la fin de l'invulnérabilité
    return 0;
  }
  COUPS_MELEE[2]++;
  FENTE[i] = prep + 1e-4;
  return 0;
}
//#endregion e5:AC-contact
// éventail de la salve : cosinus et sinus de l'écart de chaque tir à la direction du joueur
const salveCos = new Float32Array(SALVE.shots);
const salveSin = new Float32Array(SALVE.shots);
for (let q = 0; q < SALVE.shots; q++) {
  const a = ((q - (SALVE.shots - 1) / 2) * SALVE.spreadDeg * Math.PI) / 180;
  salveCos[q] = Math.cos(a);
  salveSin[q] = Math.sin(a);
}
const PIQUE_V = ENEMIES.types[DRONE_T].speed * PIQUE.speedMul;
const PIQUE_GO = PIQUE.length / PIQUE_V; // s de piqué
const BOND_V = BOND.leap / BOND.leapSeconds;
const CROUCH_INV_M = 1 / BOND.crouch; // § E5.M (B8) : remplissage du trait sur l accroupi
const CHARGE_V = ENEMIES.types[BLINDE_T].speed * CHARGE.speedMul;
const CHARGE_GO = CHARGE.length / CHARGE_V;
const eyeUniform = new Array(ENEMY_COUNT * 2).fill(null); // uSrEye.value (Vector4) du matériau de chaque type
//#region e5:M-dangers-guide
const yeuxSombres = new Uint8Array(ENEMY_COUNT); // § E5.M (B3) : 1 = yeux « rouge danger » assombris (DANGERS_GUIDE.yeux.types)
for (const t of DANGERS_GUIDE.yeux.types) yeuxSombres[t] = 1;
const annonceType = new Uint8Array(ENEMY_COUNT); // § E5.M (B4) : types dont la lueur est une annonce d'attaque
annonceType[ENEMY.TIREUR] = 1;
annonceType[ENEMY.KAMIKAZE] = 1;
const TIREUR_MARGE = DANGERS_GUIDE.tireur.marge; // § E5.M (B12) : m — le pied du tireur reste à cette distance des bords visibles
let horsEcran = 0; // § E5.M (B12) : visées abandonnées parce que le tireur est sorti du champ visible
const TIREUR_H = ENEMIES.types[ENEMY.TIREUR].height; // § E5.M (B12) : sa tête doit passer sous le bord haut
//#endregion
// § E3.K : survivants reportés. suspended = 1 de setSuspended(true) à setSuspended(false) ; E.sus[i] = 1 pour chaque
// robot mis en veille (ni marche, ni action, ni contact, intouchable, hors de la grille). Fusion des excédents :
// pend[t] = robot du type t en attente d'un partenaire dans la passe en cours (−1 = aucun).
let suspended = 0;
let mergedTotal = 0; // corps absorbés par mergeExcessF depuis le reset
let suspendedTotal = 0; // robots mis en veille au dernier setSuspended(true)
const pend = new Int32Array(ENEMY_COUNT);
const F_CARRY_STRIP = EFLAG.TRANSIT | EFLAG.WALL | EFLAG.SHIELD_DRONE | EFLAG.GUARD | EFLAG.PRIORITY;
// § E4.F : repli puis retour. eyeMode : 0 yeux normaux, 1 veille (CARRY.sleepEyeGain), 2 repli (REPLI.eyeGain). Les
// compteurs sont des entiers (inspect) ; les flottants du repli vivent dans E.retT et dans RF (§ V : aucun flottant
// emballé par image).
let eyeMode = 0;
let retreatTotal = 0; // robots partis en repli au dernier beginRetreat
let retreatLate = 0; // garés par le garde-fou (encore visibles après REPLI.seconds) — attendu 0
let parkedOff = 0; // garés d'office à beginRetreat (déjà hors champ)
let returned = 0; // reportés rentrés (reenterF)
let entered = 0; // reportés entrés dans le champ (son et lueur)
const tallOf = new Float64Array(ENEMY_COUNT); // hauteur + survol du type (bord bas du champ, comme pickSpawnPoint)
const RF = new Float64Array(3); // [0] extinction des tirs en vol restante (s), [1] sa durée totale, [2] dt de l'image (repliF)
const VB = new Float64Array(14); // [12], [13] § E5.AB.12 : demi-profondeur vers le BAS (champ de jeu ; visible, marge du tireur déduite) — perspective : plus courte que vers le haut ; // champ de jeu de l'image : cible x, z, droite x, z, haut x, z, demi-largeur, demi-profondeur, sol par m de hauteur ; § E5.M : demi-largeur, demi-profondeur basse et haute VISIBLES (zoom), marge du tireur déduite (et sa hauteur, en haut)
const PF = new Float64Array(2); // héros x, z de l'image (lu par repliF)
const RP = new Float64Array(7); // REPLI en flottants : marge, budget, visée, × vitesse, plafond, poids du bord, demi-tour (rad/s)

// Compteurs de la partie (lus par inspect ; écrits une fois par événement)
let salvos = 0; // salves de tireurs v2
let shells = 0; // obus de tireurs v3
let dives = 0; // piqués de drones v2 partis
let leaps = 0; // bonds de rôdeurs v2 partis
let chains = 0; // explosions de kamikazes v2 qui ont armé au moins un voisin
let chained = 0; // kamikazes armés par une chaîne
let charges = 0; // charges de blindés v2 parties
let bubblePulses = 0; // impulsions de réparateurs v2 qui ont posé au moins une bulle
let bubbled = 0; // bulles posées
let puddles = 0; // flaques laissées par des drones v3
let shotsFired = 0;
let detonations = 0;
// Robots d'événement (étape 1 du plan addictif, § E1.C) : drapeaux E.flags lus par update.
//   TRANSIT  drone d'un essaim : il traverse en ligne droite (cap dans E.rev0), ne poursuit pas, ne s'écarte de personne
//   WALL     blindé d'un anneau d'acier : il tient sa place (angle dans E.rev0) sur le cercle WALLRING, bouclier vers le centre
//   GUARD    garde d'une capsule de ravitaillement : sur place tant que le héros est à plus de guardAggro m de lui
const F_TRANSIT = EFLAG.TRANSIT;
const F_WALL = EFLAG.WALL;
const F_GUARD = EFLAG.GUARD;
const F_SHIELD = EFLAG.SHIELD_DRONE; // drone-bouclier du boss (§ E1.D) : il tient sa place sur l'orbite SHIELDRING (angle dans E.rev0)
const F_EVENT = F_TRANSIT | F_WALL | F_GUARD | F_SHIELD;
const F_HEADING = F_TRANSIT | F_WALL; // cap imposé
const EV_ESSAIM = EVENTS.types.find((e) => e.key === 'essaim');
const EV_ANNEAU = EVENTS.types.find((e) => e.key === 'anneau');
const EV_RAVI = EVENTS.types.find((e) => e.key === 'ravitaillement');
/** Anneau d'acier en cours : centre x, centre z, rayon courant, actif (1 / 0). Écrit par events.js à chaque image (S3 bis). */
export const WALLRING = new Float64Array(4);
/** Orbite des drones-boucliers du boss (§ E1.D) : centre x, centre z, rayon, phase (rad), active (1 / 0). Écrit par boss.update (S6). */
export const SHIELDRING = new Float64Array(5);
const SD = BOSS.shieldDrones;
const BLINDE_SEUIL = ENEMIES.types[ENEMY.BLINDE].shield.seuil; // § E4.P : fissure du bouclier à la fusion

let healPulses = 0;
const healedHp = new Float64Array(1); // PV rendus : flottant réécrit à chaque soin, donc dans un tableau typé (§ V)

// Maillages : un InstancedMesh par type (le boss a son maillage dans boss.js)
const meshes = [];
const matArr = []; // instanceMatrix.array par type
const fxArr = []; // aFx.array par type
const cursor = new Int32Array(ENEMY_COUNT * 2); // + emplacements des modèles élites (allure.ELITE_MODELE, 17/11)
let droneShadowMesh = null; // ombres factices des drones (null si groundShadow.radius = 0)
let droneShadowArr = null;
let bubbleMesh = null; // bulles-boucliers (réparateur v2) : une instance par robot protégé
let bubbleMat = null;
let bubbleCol = null;
let bubblesShown = 0;
const BUBBLE_CAP = CAPS.bubbles;
const centerY = new Float32Array(ENEMY_COUNT); // hauteur du centre de la bulle, par type
const DRONE_SHADOW_Y = ENEMIES.types[DRONE_T].groundShadow.y;

// Projectiles ennemis (pool privé, suppression immédiate par échange)
const PCAP = CAPS.enemyProjectiles;
const pX = new Float32Array(PCAP);
const pZ = new Float32Array(PCAP);
const pPX = new Float32Array(PCAP);
const pPZ = new Float32Array(PCAP);
const pVX = new Float32Array(PCAP);
const pVZ = new Float32Array(PCAP);
const pR = new Float32Array(PCAP);
const pDmg = new Float32Array(PCAP);
const pLife = new Float32Array(PCAP);
let pCount = 0;
let peakProjectiles = 0; // occupation maximale du pool des tirs ennemis (mesure : § E1.B)
let modeles = 0; // types de robots dont le modèle Blender est posé (setModeles)

export function init(context) {
  ctx = context;
  grid = ctx.grid;
  world = ctx.world;
  damage = ctx.damage;
  debug = ctx.debug;
  render = ctx.render;
  audio = ctx.audio;
  fx = ctx.fx;
  hazards = ctx.hazards;
  view = ctx.camera.view;
  elites = ctx.elites || null; // § E5.X8
  reglerContact(); // § E5.AC
  RP[0] = REPLI.margin;
  RP[1] = REPLI.seconds;
  RP[2] = REPLI.aimSeconds;
  RP[3] = REPLI.speedMul;
  RP[4] = REPLI.maxSpeed;
  RP[5] = REPLI.edgeBias;
  RP[6] = REPLI.turnRate;
  for (let t = 0; t < ENEMY_COUNT; t++) tallOf[t] = ENEMIES.types[t].height + (ENEMIES.types[t].hover || 0);

  for (let t = 0; t < ENEMY_COUNT; t++) {
    const T = ENEMIES.types[t];
    centerY[t] = (T.hover || 0) + T.height * 0.5;
    massInv[t] = 1 / T.mass;
    hover[t] = T.hover || 0;
    turnRate[t] = T.turnRate || 0;
    volHaut[t] = REPARATEUR_VOL.actif && t !== BOSS_T && hover[t] >= REPARATEUR_VOL.volHaut ? 1 : 0; // § E5.D
    healGlowOk[t] = t !== BOSS_T && T.glowColor === PALETTE.eyeReparateur ? 1 : 0;
    glowFadeOf[t] = healGlowOk[t] === 1 && !T.heal ? COMMON.healGlow / COMMON.healTintSeconds : COMMON.glowFade;
    if (T.ranged) {
      keepMin[t] = T.ranged.keepMin;
      keepMax[t] = T.ranged.keepMax;
      strafeMul[t] = T.ranged.strafeMul;
      retreatMul[t] = T.ranged.retreatMul;
    } else if (T.heal) {
      keepMin[t] = T.heal.keepDist - T.heal.keepBand;
      keepMax[t] = T.heal.keepDist + T.heal.keepBand;
      strafeMul[t] = T.heal.strafeMul;
      retreatMul[t] = T.heal.retreatMul;
    }
    if (t === BOSS_T) {
      meshes.push(null);
      matArr.push(null);
      fxArr.push(null);
      continue;
    }
    const material = render.createLitMaterial({ glowColor: T.glowColor, profil: 'robot' }); // profil peint (§ Z quater)
    const mesh = render.createInstanced(render.emptyModelGeometry(), material, CAP, { castShadow: T.castShadow, name: 'robots-' + T.key });
    meshes.push(mesh);
    matArr.push(mesh.instanceMatrix.array);
    fxArr.push(mesh.geometry.attributes.aFx.array);
  }
  // Modèles ÉLITES (17/11, Femz : « branche-les en jeu ») : pour chaque type porteur (CHESTS.carrier.types), un maillage
  // instancié « elites-<type> » de allure.ELITE_CAP emplacements, son propre matériau (même profil peint) ; posé par
  // setModeles si <type>-elite.glb est arrivé. Invisible (0 appel de dessin) quand aucune élite du type n'est dessinée.
  for (let t = 0; t < ENEMY_COUNT; t++) {
    meshes.push(null);
    matArr.push(null);
    fxArr.push(null);
  }
  for (const t of CHESTS.carrier.types) {
    const T = ENEMIES.types[t];
    const material = render.createLitMaterial({ glowColor: T.glowColor, profil: 'robot' });
    const mesh = render.createInstanced(render.emptyModelGeometry(), material, allure.ELITE_CAP, { castShadow: T.castShadow, name: 'elites-' + T.key });
    meshes[ENEMY_COUNT + t] = mesh;
    matArr[ENEMY_COUNT + t] = mesh.instanceMatrix.array;
    fxArr[ENEMY_COUNT + t] = mesh.geometry.attributes.aFx.array;
  }
  allure.init(meshes); // animation des robots (§ Z sexies) : matrices écrites par allure.sync

  // Ombres factices des drones : leur propre matériau éclairé (jamais de flash : son aFx reste à zéro).
  if (ENEMIES.types[DRONE_T].groundShadow.radius > 0) {
    droneShadowMesh = render.createInstanced(buildDroneShadow(), render.createLitMaterial(), CAP, { name: 'ombres-drones' });
    droneShadowArr = droneShadowMesh.instanceMatrix.array;
  }

  // Bulles-boucliers (§ E1.B) : icosaèdre FILAIRE (DA « programmes »), additif, un seul maillage instancié.
  bubbleMesh = render.createInstanced(buildBubble(), render.createUnlitMaterial({ additive: true }), BUBBLE_CAP, { instanceColor: true, name: 'bulles' });
  bubbleMesh.renderOrder = RENDER.effectsOrder;
  bubbleMat = bubbleMesh.instanceMatrix.array;
  bubbleCol = bubbleMesh.instanceColor.array;
  setRevisions(0);
  e3.init(ctx); // § E3.D

  // Tirs ennemis : dessinés par le lot ENNEMIS de src/vfx/projectiles.js (étape « vfx », § Z septies), plus de maillage ici.
}

/** Bulle : les 30 arêtes d'un icosaèdre de rayon 1, chacune une barre fine (à l'init seulement). */
function buildBubble() {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const pos = ico.attributes.position.array; // non indexée : 20 triangles
  const seen = new Set();
  const parts = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const w = BULLE.bubbleWire;
  const key = (v) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
  for (let tri = 0; tri < pos.length; tri += 9) {
    for (let e = 0; e < 3; e++) {
      const i0 = tri + e * 3;
      const i1 = tri + ((e + 1) % 3) * 3;
      a.set(pos[i0], pos[i0 + 1], pos[i0 + 2]);
      b.set(pos[i1], pos[i1 + 1], pos[i1 + 2]);
      const ka = key(a);
      const kb = key(b);
      const id = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      if (seen.has(id)) continue;
      seen.add(id);
      const bar = new THREE.BoxGeometry(w, w, a.distanceTo(b) + w);
      mid.addVectors(a, b).multiplyScalar(0.5);
      quat.setFromUnitVectors(zAxis, b.clone().sub(a).normalize());
      bar.applyQuaternion(quat);
      bar.translate(mid.x, mid.y, mid.z);
      parts.push(render.makePart(bar, BULLE.bubbleColor, 0));
    }
  }
  return render.mergeParts(parts);
}

// ----- Maillages -------------------------------------------------------------------------------------------------------
// Les six robots sont les modèles Blender de assets/modeles/<type>.glb (§ Z quinquies, DA « Clash ») : chaque maillage
// instancié est créé à l'init avec une géométrie vide (render.emptyModelGeometry), puis setModeles() pose les modèles à
// leur arrivée (main.js, avant la première partie). Repère d'un modèle : avant = +Z, haut = +Y, pieds à y = 0, hauteur
// ENEMIES.types[t].height. Vu de dessus, chaque type se reconnaît à sa silhouette et à la couleur de ses yeux
// (rouge ; tireur jaune-orangé, kamikaze orange, réparateur vert), cuites dans le modèle.

/**
 * Modèles des robots arrivés (main.js, une fois) : robots[t] = données de src/rendu/modeles.js (null pour le boss).
 * Chaque maillage prend la géométrie de son type ; son attribut d'instance aFx (écrit par sync) est gardé tel quel.
 */
export function setModeles(robots) {
  for (let t = 0; t < ENEMY_COUNT; t++) {
    if (t === BOSS_T || !robots[t] || meshes[t] === null) continue;
    render.setModelGeometry(meshes[t], robots[t]);
    allure.brancherModele(t, meshes[t], robots[t]); // pièces animées dans le shader (aGait, matériau des membres)
    // atlas du modèle allégé (couleur + lueurs en alpha, relief) sur le matériau du type : aucun appel de dessin en plus
    appliquerTexturesModele(meshes[t].material, robots[t].textures);
    eyeUniform[t] = allure.teinteYeux(t); // teinte des yeux par révision (§ E1.B) : uniforme du matériau du type
    modeles++;
  }
  // modèles élites (src/rendu/modeles.js : robots.elites[t], null si absent) : même pose, leur emplacement allure
  const el = robots.elites || [];
  for (let t = 0; t < ENEMY_COUNT; t++) {
    const s = ENEMY_COUNT + t;
    if (!el[t] || !meshes[s]) continue;
    render.setModelGeometry(meshes[s], el[t]);
    fxArr[s] = meshes[s].geometry.attributes.aFx.array;
    allure.brancherModele(s, meshes[s], el[t]);
    appliquerTexturesModele(meshes[s].material, el[t].textures);
    eyeUniform[s] = allure.teinteYeux(s);
  }
  applyEyes();
}

/**
 * Révisions de la vague n (§ E1.B) : appelée par waves.startWave, et à chaque remise à zéro (n = 0 : tout en v1).
 * Pose rev[type], la vitesse de rotation effective et la teinte des yeux de chaque type. Une fois par vague.
 */
export function setRevisions(n) {
  for (let t = 0; t < ENEMY_COUNT; t++) {
    rev[t] = t === BOSS_T ? 0 : enemyRevision(t, n);
    turnNow[t] = turnRate[t];
  }
  if (rev[BLINDE_T] >= 1) turnNow[BLINDE_T] = turnRate[BLINDE_T] * CHARGE.turnMul;
  applyEyes();
}

/** Révision en cours du type (0 = v1, 1 = v2, 2 = v3). */
export function getRevision(type) {
  return rev[type];
}

function applyEyes() {
  const eyes = ENEMIES.revisionEyes;
  for (let s = 0; s < ENEMY_COUNT * 2; s++) {
    const t = s % ENEMY_COUNT; // s ≥ ENEMY_COUNT : modèle élite du type t (mêmes yeux)
    const u = eyeUniform[s];
    if (u === null) continue;
    const e = eyes[rev[t] < eyes.length ? rev[t] : eyes.length - 1];
    // § E1.S : (gain, gain, gain, 1) — l'émissif des yeux est multiplié, la couleur cuite du type est gardée
    let g = e ? e.gain : 1;
    let part = e ? 1 : 0;
    let tr = 1;
    let tg = 1;
    let tb = 1;
    //#region e5:M-dangers-guide
    // § E5.M (B3) : yeux rouges plus sombres que le rouge des tirs, échelle des révisions gardée (une fois par vague)
    if (yeuxSombres[t] === 1) {
      const YG = DANGERS_GUIDE.yeux.gain;
      g = YG[rev[t] < YG.length ? rev[t] : YG.length - 1];
      part = 1;
      tr = DANGERS_GUIDE.yeux.teinte[0];
      tg = DANGERS_GUIDE.yeux.teinte[1];
      tb = DANGERS_GUIDE.yeux.teinte[2];
    }
    //#endregion
    // § E3.K : en veille, l'émissif des yeux baisse (tous les vivants du type sont en veille entre deux vagues)
    // § E4.F.2 : en repli, les yeux s'éteignent (REPLI.eyeGain) — tous les vivants hors boss sont en repli
    if (eyeMode !== 0) {
      g *= eyeMode === 1 ? CARRY.sleepEyeGain : REPLI.eyeGain;
      part = 1;
    }
    u.set(g * tr, g * tg, g * tb, part);
  }
}

/** Ombre factice d'un drone : disque sombre posé au sol, de la teinte des ombres factices des rochers (world.js). */
function buildDroneShadow() {
  const S = ENEMIES.types[DRONE_T].groundShadow;
  const disc = new THREE.CircleGeometry(S.radius, 8);
  disc.rotateX(-Math.PI / 2);
  const c = new THREE.Color(PALETTE.sand).lerp(new THREE.Color(PALETTE.rockDark), S.mix).multiplyScalar(S.lum);
  return render.makePart(disc, c.getHex(), 0);
}

// ----- Cycle de vie ------------------------------------------------------------------------------------------------

export function reset() {
  E.count = 0;
  E.aliveCount = 0;
  eyeMode = 0; // § E4.F
  retreatTotal = 0;
  retreatLate = 0;
  parkedOff = 0;
  returned = 0;
  entered = 0;
  RF[0] = 0;
  E.aliveByType.fill(0);
  E.bossIndex = -1;
  pCount = 0;
  shotsFired = 0;
  horsEcran = 0; // § E5.M (B12)
  detonations = 0;
  healPulses = 0;
  healedHp[0] = 0;
  salvos = 0;
  shells = 0;
  dives = 0;
  leaps = 0;
  chains = 0;
  chained = 0;
  charges = 0;
  bubblePulses = 0;
  bubbled = 0;
  puddles = 0;
  peakProjectiles = 0;
  COUPS_MELEE.fill(0); // § E5.AC
  CT[7] = -1e9;
  WALLRING.fill(0);
  SHIELDRING.fill(0);
  E.bossShield = 0;
  suspended = 0; // § E3.K (avant setRevisions : les yeux reprennent leur teinte de révision)
  mergedTotal = 0;
  suspendedTotal = 0;
  setRevisions(0);
  e3.reset(); // § E3.D
}

/**
 * Préchauffage des branches d'événement de update (§ E1.C), appelé par main.resetAll à chaque nouvelle partie, hors
 * combat. Un robot d'événement n'existe pas avant la vague 6 : sans cela, update est optimisée par V8 sans ces
 * branches, puis désoptimisée d'un coup à la première image d'un essaim ou d'un anneau — et tourne plusieurs secondes
 * en code de base, où chaque flottant est emballé (mesuré : 8 à 9 Ko alloués par image au lieu de 1,5). Ici cinq robots
 * factices (essaim, anneau actif puis dissous, garde loin, garde près) font deux pas de simulation loin du héros, puis
 * tout est remis à zéro : ni tirage de rand(), ni son, ni effet, et la suite des identifiants (E.nextUid) est rendue.
 */
export function warmEventBranches() {
  if (E.count !== 0) return;
  const uid = E.nextUid;
  const far = 40;
  E.flags[spawn(DRONE_T, P.x + far, P.z, 1, 1)] = F_TRANSIT;
  E.flags[spawn(BLINDE_T, P.x - far, P.z, 1, 1)] = F_WALL;
  E.flags[spawn(RODEUR_T, P.x, P.z - far, 1, 1)] = F_GUARD; // loin : il reste à son poste
  E.flags[spawn(RODEUR_T, P.x + 5, P.z + 5, 1, 1)] = F_GUARD; // près : il quitte son poste
  E.flags[spawn(DRONE_T, P.x, P.z + far, 1, 1)] = F_SHIELD; // drone-bouclier du boss (§ E1.D) : orbite active, puis dissoute
  SHIELDRING[0] = P.x;
  SHIELDRING[1] = P.z + far;
  SHIELDRING[2] = SD.orbitRadius;
  SHIELDRING[4] = 1;
  WALLRING[0] = P.x;
  WALLRING[1] = P.z;
  WALLRING[2] = far;
  WALLRING[3] = 1;
  grid.rebuild();
  update(1 / 60);
  WALLRING[3] = 0; // anneau dissous : le blindé redevient ordinaire
  SHIELDRING[4] = 0; // orbite dissoute : le drone redevient ordinaire
  // boss protégé par ses drones-boucliers (§ E1.D) : un coup silencieux arrêté exerce la branche de damage.hitEnemyF
  // (sans cela elle n'est prise pour la première fois qu'à la vague 15, et hitEnemyF est désoptimisée en plein combat)
  const b = spawn(BOSS_T, P.x - far, P.z - far, 1, 1);
  if (b >= 0) {
    E.bossShield = 1;
    ARGF[F_V] = 1;
    ARGF[F_SX] = P.x;
    ARGF[F_SZ] = P.z;
    damage.hitEnemyF(b, DMG_SRC.DEBUG, DMG.SILENT | DMG.NO_IMPACT);
    E.bossShield = 0;
  }
  // § E4.P : bouclier du blindé — un coup de face atténué, puis le coup qui le fissure (silencieux, sans chiffre) :
  // les deux branches de hitEnemyF sont exercées hors combat (pas de désoptimisation à la première fissure)
  const bl = spawn(BLINDE_T, P.x + far, P.z - far, 1, 1);
  if (bl >= 0) {
    const fl = DMG.SILENT | DMG.NO_IMPACT | DMG.NO_NUMBER | DMG.NO_CRIT;
    E.rot[bl] = 0;
    ARGF[F_V] = 1;
    ARGF[F_SX] = E.x[bl];
    ARGF[F_SZ] = E.z[bl] + 5;
    damage.hitEnemyF(bl, DMG_SRC.DEBUG, fl);
    E.hp[bl] = BLINDE_SEUIL * E.maxHp[bl] + 0.1;
    ARGF[F_V] = 1;
    ARGF[F_SX] = E.x[bl];
    ARGF[F_SZ] = E.z[bl] + 5;
    damage.hitEnemyF(bl, DMG_SRC.DEBUG, fl);
  }
  grid.rebuild();
  update(1 / 60);
  reset();
  E.nextUid = uid;
}

/**
 * Crée un robot. PV = table × hpMul ; dégâts de contact = table × dmgMul ; E.mul = dmgMul. Renvoie l'indice, ou
 * −1 si E est plein (ou si un second boss est demandé).
 */
export function spawn(type, x, z, hpMul, dmgMul) {
  if (E.count >= CAP) return -1;
  if (type === BOSS_T && E.bossIndex >= 0) return -1;
  const T = ENEMIES.types[type];
  const i = E.count++;
  vuRobot[type] = 1; // § E4.A
  const f = E.f32;
  for (let k = 0; k < f.length; k++) f[k][i] = 0;
  E.x[i] = x;
  E.z[i] = z;
  E.radius[i] = T.radius;
  E.hp[i] = T.hp * hpMul;
  E.maxHp[i] = E.hp[i];
  E.dmg[i] = T.contactDmg * dmgMul;
  E.mul[i] = dmgMul;
  E.speed[i] = T.speed;
  E.slow[i] = 1;
  E.rot[i] = Math.atan2(P.x - x, P.z - z);
  E.type[i] = type;
  E.alive[i] = 1;
  E.state[i] = 0;
  E.flags[i] = 0;
  E.mod[i] = 0; // § E3.A : modificateur d'élite (posé par elites.assignF)
  E.gen[i] = 0; // § E3.D : génération d'un mini-rôdeur du diviseur (posée par enemies-e3.onDeathF après le spawn)
  E.mod[i] = 0;
  E.gen[i] = 0;
  E.merged[i] = 0;
  E.sus[i] = 0;
  E.ent[i] = 0; // § E4.F.4
  E.uid[i] = E.nextUid++;
  E.aliveCount++;
  E.aliveByType[type]++;
  if (type === BOSS_T) E.bossIndex = i;
  return i;
}

/**
 * § E4.F.2 — un pas de REPLI du robot i (type t) : il court vers le bord du champ le plus proche en s'éloignant du héros
 * (jamais à travers lui), plus vite qu'il ne marche, sans contact ni séparation ; hors champ (ou au bout de REPLI.seconds,
 * garde-fou compté), il est garé. Renvoie le mode de world.resolveMany. Entiers en argument, dt lu dans RF[2] (§ V).
 */
function repliF(i, t) {
  const dt = RF[2];
  const X = E.x, Z = E.z;
  E.retT[i] += dt;
  const xr = X[i];
  const zr = Z[i];
  const ox = xr - VB[0];
  const oz = zr - VB[1];
  const rX = VB[2], rZ = VB[3], uX = VB[4], uZ = VB[5];
  const a = ox * rX + oz * rZ; // m vers la droite de l'écran
  const b = ox * uX + oz * uZ; // m vers le haut
  const mr = E.radius[i] + RP[0];
  const A1 = VB[6] + mr;
  const BT = VB[7] + mr;
  const BB = VB[12] + mr + tallOf[t] * VB[8]; // § E5.AB.12 : vers le bas (= VB[7] en ortho)
  const dehors = a < -A1 || a > A1 || b > BT || b < -BB;
  if (dehors || E.retT[i] >= RP[1]) {
    if (!dehors) retreatLate++; // garde-fou : encore visible au bout du budget
    E.sus[i] = 2;
    E.vx[i] = 0;
    E.vz[i] = 0;
    return RESOLVE.SKIP;
  }
  let ux = xr - PF[0]; // û : héros → robot
  let uz = zr - PF[1];
  const ud = Math.sqrt(ux * ux + uz * uz);
  if (ud > 1e-4) {
    ux /= ud;
    uz /= ud;
  } else {
    ux = uX;
    uz = uZ;
  }
  // normale sortante du bord le plus proche
  const dRt = A1 - a;
  const dLt = a + A1;
  const dTp = BT - b;
  const dBm = b + BB;
  let nx = -uX;
  let nz = -uZ;
  if (dRt <= dLt && dRt <= dTp && dRt <= dBm) {
    nx = rX;
    nz = rZ;
  } else if (dLt <= dTp && dLt <= dBm) {
    nx = -rX;
    nz = -rZ;
  } else if (dTp <= dBm) {
    nx = uX;
    nz = uZ;
  }
  let dx = ux;
  let dz = uz;
  if (nx * ux + nz * uz > 0) {
    dx = ux + RP[5] * nx;
    dz = uz + RP[5] * nz;
    const l = Math.sqrt(dx * dx + dz * dz);
    dx /= l;
    dz /= l;
  }
  // distance jusqu'à la sortie le long de la direction (repère de l'écran)
  const da = dx * rX + dz * rZ;
  const db = dx * uX + dz * uZ;
  let tx = 1e12;
  if (da > 1e-6) tx = (A1 - a) / da;
  else if (da < -1e-6) tx = (-A1 - a) / da;
  if (db > 1e-6) tx = Math.min(tx, (BT - b) / db);
  else if (db < -1e-6) tx = Math.min(tx, (-BB - b) / db);
  const left = Math.max(RP[2] - E.retT[i], 0.1);
  const v = Math.min(Math.max(E.speed[i] * RP[3], tx / left), RP[4]);
  const wvx = dx * v;
  const wvz = dz * v;
  X[i] = xr + wvx * dt;
  Z[i] = zr + wvz * dt;
  E.vx[i] = wvx;
  E.vz[i] = wvz;
  // cap : il se retourne vers sa course
  const step = RP[6] * dt;
  let dr = Math.atan2(dx, dz) - E.rot[i];
  dr -= Math.round(dr / TWO_PI) * TWO_PI;
  E.rot[i] += dr > step ? step : dr < -step ? -step : dr;
  return hover[t] > 0 ? RESOLVE.SKIP : RESOLVE.OBST; // rochers seulement (un drone survole), jamais le bord de l'arène
}

/** § E4.F.4 — reporté rentré (E.ent = 1) : à son entrée dans le champ (yeux déjà rallumés par l'uniforme), un son léger part. */
function entreeF(i, t) {
  const ox = E.x[i] - VB[0];
  const oz = E.z[i] - VB[1];
  const a = ox * VB[2] + oz * VB[3];
  const b = ox * VB[4] + oz * VB[5];
  const mr = E.radius[i];
  const hw = VB[6] + mr;
  const hd = VB[7] + mr;
  if (a > -hw && a < hw && b < hd && b > -(VB[12] + mr + tallOf[t] * VB[8])) { // § E5.AB.12 : vers le bas, VB[12]
    E.ent[i] = 0;
    audio.play(SFX.REVEIL);
    entered++;
  }
}

// ----- Simulation (S5) -----------------------------------------------------------------------------------------------

//#region e5:P-lisibilite-guide
// § E5.P (B1) : robots vivants à moins de LISIBILITE_GUIDE.silhouette.foule.rayon m du héros, comptés dans la boucle A (déjà
// optimisée : une fonction à part qui parcourait les robots emballait ses flottants en jeu, 64 à 947 o/image mesurés).
// FOULE[0] : le compte du dernier pas simulé ; FOULE_R2[0] : rayon², relu par silhouette-heros.regler().
export const FOULE = new Int32Array(1);
export const FOULE_R2 = new Float64Array([LISIBILITE_GUIDE.silhouette.foule.rayon * LISIBILITE_GUIDE.silhouette.foule.rayon]);
//#endregion e5:P-lisibilite-guide

export function update(dt) {
  const n = E.count;
  FOULE[0] = 0; // § E5.P (B1)
  if (n === 0) return;
  const X = E.x, Z = E.z, VX = E.vx, VZ = E.vz, KX = E.kx, KZ = E.kz;
  const R = E.radius, ROT = E.rot, SPEED = E.speed, SLOW = E.slow, SLOWT = E.slowT;
  const FLASH = E.flash, GLOW = E.glow, ANIM = E.anim, TIMER = E.timer, CD = E.cd, ATK = E.atkCd, ORB = E.orbitCd;
  const AI0 = E.ai0, AI1 = E.ai1, MUL = E.mul, REV0 = E.rev0, REV1 = E.rev1, SHIELD = E.shield;
  const TYPE = E.type, ALIVE = E.alive, STATE = E.state, UID = E.uid, DMGV = E.dmg, FLAGS = E.flags;
  const SUS = E.sus; // § E3.K : robot en veille entre deux vagues (comme figé, robot par robot)
  const RECUP = E.recup; // § E5.X8 (E8)
  const cellStart = grid.cellStart, cellCount = grid.cellCount, items = grid.items;
  const px = P.x, pz = P.z;
  const fouleR2 = FOULE_R2[0]; // § E5.P (B1)
  const frozen = debug.areEnemiesFrozen();
  const flashStep = dt / FX.flash.seconds;
  const REST = E.flashRest; // intégration : pause après un flash (aucun rallumage, § H.1)
  const damp = Math.exp(-DAMAGE.knockbackDamp * dt);
  // Recul moyen sur le pas, rapporté au recul de début de pas : l'intégrale exacte de l'amortissement. Avec le recul
  // de fin de pas, un même coup poussait un robot de 1,64 m à 60 Hz et de 1,74 m à 240 Hz (mesuré) ; ainsi : 1,78 partout.
  const kMean = (1 - damp) / (DAMAGE.knockbackDamp * dt);
  const sepStrength = COMMON.separationStrength;
  const maxNeighbors = COMMON.maxNeighbors;
  const crowdBrake = COMMON.crowdBrake;
  const crowdMinSpeed = COMMON.crowdMinSpeed;
  const SKIP = RESOLVE.SKIP, GROUND = RESOLVE.GROUND, FLY = RESOLVE.FLY, OBST = RESOLVE.OBST;
  // § E4.F : repère du champ de jeu (relu à chaque image : la caméra suit le héros pendant la fin de vague)
  const ENT = E.ent;
  RF[2] = dt; // § E4.F : pas de l'image, lu par repliF (aucun flottant passé en argument)
  // § E4.F : repère du champ recopié dans un tableau typé — lu en flottants purs par repliF / entreeF (un champ d'objet
  // peut être « étiqueté » : mêlé à un flottant calculé, V8 emballait ce dernier, un nombre par robot et par image)
  VB[0] = view.targetX;
  VB[1] = view.targetZ;
  VB[2] = view.rightX;
  VB[3] = view.rightZ;
  VB[4] = view.upX;
  VB[5] = view.upZ;
  VB[6] = view.halfW;
  VB[7] = view.halfD;
  VB[8] = view.groundPerHeight;
  VB[9] = view.visHalfW - TIREUR_MARGE; // § E5.M (B12) : champ VISIBLE (molette comprise), marge déduite
  VB[10] = view.visHalfD - TIREUR_MARGE;
  VB[11] = view.visHalfD - TIREUR_MARGE - TIREUR_H * view.groundPerHeight; // bord haut : la tête dépasse vers le haut
  VB[12] = view.prochD; // § E5.AB.12 (ortho : = halfD)
  VB[13] = view.visProchD - TIREUR_MARGE;
  PF[0] = P.x;
  PF[1] = P.z;
  e3.tick(dt); // § E3.D

  // ---- Boucle A : minuteries, vitesse voulue, séparation, déplacement
  for (let i = 0; i < n; i++) {
    if (ALIVE[i] === 0 || SUS[i] === 2) {
      modes[i] = SKIP; // mort, ou garé (§ E4.F : gardé dans le pool, ni mis à jour ni déplacé)
      continue;
    }
    // 1. minuteries (boss compris)
    ANIM[i] += dt;
    if (FLASH[i] > 0) {
      const f = FLASH[i] - flashStep;
      if (f > 0) FLASH[i] = f;
      else {
        FLASH[i] = 0;
        REST[i] = CF.reduits ? CF.reposFlash : FX.flash.rest; // flash fini : pause (aucun nouveau flash) ; § E5.X5 : plus longue en Réduits
      }
    } else if (REST[i] > 0) {
      const r = REST[i] - dt;
      REST[i] = r > 0 ? r : 0;
    }
    if (SLOWT[i] > 0) {
      const s = SLOWT[i] - dt;
      if (s > 0) SLOWT[i] = s;
      else {
        SLOWT[i] = 0;
        SLOW[i] = 1;
      }
    }
    if (ATK[i] > 0) {
      const a = ATK[i] - dt;
      ATK[i] = a > 0 ? a : 0;
    }
    if (ORB[i] > 0) {
      const a = ORB[i] - dt;
      ORB[i] = a > 0 ? a : 0;
    }
    if (CD[i] > 0) {
      const a = CD[i] - dt;
      CD[i] = a > 0 ? a : 0;
    }
    if (TIMER[i] > 0) {
      const a = TIMER[i] - dt;
      TIMER[i] = a > 0 ? a : 0;
    }
    if (RECUP[i] > 0) {
      // § E5.X8 (E8) : récupération après une manœuvre
      const a = RECUP[i] - dt;
      RECUP[i] = a > 0 ? a : 0;
    }
    if (REV1[i] > 0) {
      // bulle-bouclier (réparateur v2) : elle s'éteint au bout de sa durée, ce qu'il en reste est perdu
      const a = REV1[i] - dt;
      if (a > 0) REV1[i] = a;
      else {
        REV1[i] = 0;
        SHIELD[i] = 0;
      }
    }
    const kx = KX[i] * kMean; // recul moyen du pas (étape 4)
    const kz = KZ[i] * kMean;
    KX[i] *= damp;
    KZ[i] *= damp;

    const t = TYPE[i];
    if (t === BOSS_T) {
      modes[i] = SKIP; // boss.update est le seul à déplacer le boss (et à tenir sa lueur)
      continue;
    }
    if (SUS[i] === 1 && eyeMode === 2) {
      // § E4.F.2 — REPLI : corps dans une fonction appelée PAR ROBOT (entiers seulement : § V, comme procheTourelle) —
      // la branche n'est prise qu'à la fin d'une vague ; écrite en ligne, V8 emballait ses flottants (27 Ko par image
      // mesurés avec 395 robots en repli, tests/e4-repli.test.mjs)
      modes[i] = repliF(i, t);
      continue;
    }
    if (ENT[i] === 1) entreeF(i, t); // § E4.F.4 — reporté rentré : son et lueur à l'entrée dans le champ
    // La lueur s'éteint dès que plus rien ne l'entretient ; la visée et la mèche la réécrivent ci-dessous.
    if (GLOW[i] > 0) {
      const g = GLOW[i] - glowFadeOf[t] * dt;
      GLOW[i] = g > 0 ? g : 0;
    }
    const xi = X[i];
    const zi = Z[i];
    const ri = R[i];
    if ((px - xi) * (px - xi) + (pz - zi) * (pz - zi) < fouleR2) FOULE[0]++; // § E5.P (B1) : foule autour du héros

    // 2. vitesse voulue (wx, wz) et actions propres au type ; (ux, uz) = direction de marche, pour le frein de foule
    let wx = 0;
    let wz = 0;
    let ux = 0;
    let uz = 0;
    let rush = false; // manœuvre en cours (piqué, bond, charge) : ni frein de foule ni séparation, il passe
    if (frozen || SLOW[i] === 0 || SUS[i] !== 0) {
      // Robots figés (debug), étourdis par la Décharge (§ E3.C : E.slow = 0 tant que E.slowT court) ou en veille
      // (§ E3.K) : ni marche ni action. Une visée, une mèche ou une manœuvre en cours est abandonnée.
      if (t === TIREUR_T) {
        if (STATE[i] === S_AIM) STATE[i] = S_MOVE;
      } else if (t === KAMIKAZE_T) {
        STATE[i] = K_CHASE;
        AI1[i] = 0;
      } else if (maneuver[t] === 1) STATE[i] = M_NONE;
    } else {
      const dx = px - xi;
      const dz = pz - zi;
      const d2 = dx * dx + dz * dz;
      let d = 0;
      let tx = 0; // direction unitaire vers le joueur
      let tz = 0;
      if (d2 > 1e-6) {
        d = Math.sqrt(d2);
        tx = dx / d;
        tz = dz / d;
      }
      const k = SPEED[i] * SLOW[i];
      ux = tx;
      uz = tz;
      let chase = true;
      // Robot d'événement (§ E1.C) : son drapeau décide à la place de son type (special = le type ne joue pas).
      let special = false;
      const ev = FLAGS[i] & F_EVENT;
      if (ev !== 0) {
        if ((ev & F_TRANSIT) !== 0) {
          // essaim en transit : droit devant, à vitesse × speedMul ; il passe à travers la meute
          const a = REV0[i];
          ux = Math.sin(a);
          uz = Math.cos(a);
          const v = k * EV_ESSAIM.speedMul;
          wx = ux * v;
          wz = uz * v;
          AI0[i] = 0;
          rush = true;
          chase = false;
          special = true;
        } else if ((ev & F_WALL) !== 0) {
          if (WALLRING[3] === 0) FLAGS[i] &= ~F_WALL; // plus d'anneau : il redevient un blindé ordinaire
          else {
            // anneau d'acier : rappelé vers sa place sur le cercle qui se resserre (un recul l'en écarte un instant)
            const a = REV0[i];
            const ox = Math.sin(a);
            const oz = Math.cos(a);
            let mx = (WALLRING[0] + ox * WALLRING[2] - xi) * EV_ANNEAU.follow;
            let mz = (WALLRING[1] + oz * WALLRING[2] - zi) * EV_ANNEAU.follow;
            const m2 = mx * mx + mz * mz;
            if (m2 > EV_ANNEAU.maxSpeed * EV_ANNEAU.maxSpeed) {
              const f = EV_ANNEAU.maxSpeed / Math.sqrt(m2);
              mx *= f;
              mz *= f;
            }
            wx = mx;
            wz = mz;
            ux = -ox;
            uz = -oz;
            rush = true;
            chase = false;
            special = true;
          }
        } else if ((ev & F_SHIELD) !== 0) {
          if (SHIELDRING[4] === 0) FLAGS[i] &= ~F_SHIELD; // plus de boss : il redevient un drone ordinaire
          else {
            // drone-bouclier (§ E1.D) : rappelé vers sa place sur l'orbite qui tourne autour du boss
            const a = REV0[i] + SHIELDRING[3];
            let mx = (SHIELDRING[0] + Math.sin(a) * SHIELDRING[2] - xi) * SD.follow;
            let mz = (SHIELDRING[1] + Math.cos(a) * SHIELDRING[2] - zi) * SD.follow;
            const m2 = mx * mx + mz * mz;
            if (m2 > SD.maxSpeed * SD.maxSpeed) {
              const f = SD.maxSpeed / Math.sqrt(m2);
              mx *= f;
              mz *= f;
            }
            wx = mx;
            wz = mz;
            GLOW[i] = SD.glow;
            AI0[i] = 0;
            rush = true;
            chase = false;
            special = true;
          }
        } else if (d <= EV_RAVI.guardAggro) {
          FLAGS[i] &= ~F_GUARD; // le héros approche : le garde quitte son poste, robot ordinaire dès cette image
        } else {
          chase = false; // garde : sur place, face au héros
          special = true;
        }
      }
      switch (special ? 255 : t) {
        case RODEUR_T: {
          // Rôdeur v2 (§ E1.B) : à portée, il s'accroupit puis bondit vers la position du joueur à l'instant du saut.
          if (rev[RODEUR_T] === 0) break; // v1 : il fonce
          const st = STATE[i];
          if (st === M_WARN) {
            // § E5.N (point 8, Femz 21/11) : RODEUR_FIGE → le cap pris au début de l'accroupi ne bouge plus (trait figé, bond
            // dans son axe) ; sinon (§ E5.M, B8) le trait suit le joueur jusqu'au saut
            if (TIMER[i] <= 0) {
              STATE[i] = M_GO;
              TIMER[i] = BOND.leapSeconds;
              if (!RODEUR_FIGE && d2 > 1e-6) REV0[i] = Math.atan2(tx, tz);
              leaps++;
              ARGF[F_X] = xi; // § E5.X8 (E10) : souffle du bond
              ARGF[F_Z] = zi;
              souffleF(X8_SON_BOND, 0);
              X8_COMPTES[4]++;
            } else if (!RODEUR_FIGE && d2 > 1e-6) REV0[i] = Math.atan2(tx, tz);
            chase = false;
          } else if (st === M_GO) {
            if (TIMER[i] <= 0) {
              STATE[i] = M_NONE;
              CD[i] = BOND.cooldown;
              RECUP[i] = X8[0]; // § E5.X8 (E8) : récupération après le bond
              X8_COMPTES[0]++;
            } else {
              const a = REV0[i];
              ux = Math.sin(a);
              uz = Math.cos(a);
              const v = BOND_V * SLOW[i];
              wx = ux * v;
              wz = uz * v;
              rush = true;
              chase = false;
            }
          } else if (CD[i] <= 0 && d <= BOND.triggerDist && d >= BOND.minDist && P.alive) {
            STATE[i] = M_WARN;
            TIMER[i] = BOND.crouch;
            REV0[i] = Math.atan2(tx, tz);
            chase = false;
            ARGF[F_X] = xi; // § E5.Q ter (Femz, 21/11) : l'accroupi du rôdeur v2 s'annonce comme les traits au sol
            ARGF[F_Z] = zi;
            audio.playF(SFX.ANNONCE_SOL);
          }
          break;
        }
        case DRONE_T: {
          if (rev[DRONE_T] >= 1) {
            // Drone v2 (§ E1.B) : piqué. Il s'arrête, un trait au sol l'annonce, puis il fonce en ligne droite.
            const st = STATE[i];
            if (st === M_WARN) {
              if (TIMER[i] <= 0) {
                STATE[i] = M_GO;
                TIMER[i] = PIQUE_GO;
                dives++;
                ARGF[F_X] = xi; // § E5.X8 (E10) : souffle du piqué
                ARGF[F_Z] = zi;
                souffleF(X8_SON_PIQUE, 2);
                X8_COMPTES[5]++;
              }
              AI0[i] = 0;
              chase = false;
              break;
            }
            if (st === M_GO) {
              if (TIMER[i] <= 0) {
                STATE[i] = M_NONE;
                CD[i] = PIQUE.every;
                RECUP[i] = X8[0]; // § E5.X8 (E8) : récupération après le piqué
                X8_COMPTES[0]++;
              } else {
                const a = REV0[i];
                ux = Math.sin(a);
                uz = Math.cos(a);
                const v = PIQUE_V * SLOW[i];
                wx = ux * v;
                wz = uz * v;
                rush = true;
              }
              AI0[i] = 0;
              chase = false;
              break;
            }
            if (CD[i] <= 0 && d <= PIQUE.range && d2 > 1e-6 && P.alive) {
              const a = Math.atan2(tx, tz);
              ARGF[F_X] = xi;
              ARGF[F_Z] = zi;
              ARGF[F_DX] = ri;
              ARGF[F_DZ] = PIQUE.length;
              ARGF[F_SX] = a;
              ARGF[F_SZ] = PIQUE_GO; // le trait reste le temps du piqué : il raccourcit devant le drone
              ARGF[F_T] = PIQUE.telegraph;
              ARGF[F_V] = 0;
              hazards.addF(HAZ.LINE); // pool plein : il pique quand même (le drone cabré reste l'annonce)
              STATE[i] = M_WARN;
              TIMER[i] = PIQUE.telegraph;
              REV0[i] = a;
              AI0[i] = 0;
              chase = false;
              break;
            }
          }
          // Zigzag : une vitesse latérale à bords francs s'ajoute à l'avance. Les drones d'une même grappe
          // (identifiants voisins) zigzaguent presque en phase : ils arrivent en essaim.
          let s = Math.sin(ANIM[i] * WEAVE_W + (UID[i] >> 3) * WEAVE.groupPhase + (UID[i] & 7) * WEAVE.swarmPhase) * WEAVE.sharp;
          if (s > 1) s = 1;
          else if (s < -1) s = -1;
          let lat = s * WEAVE.amp;
          if (d < WEAVE.fadeDist) lat *= d * WEAVE_FADE_INV;
          AI0[i] = lat; // relu pour le cap (étape 6) et le roulis (sync)
          wx = (tx - tz * lat) * k;
          wz = (tz + tx * lat) * k;
          chase = false;
          break;
        }
        case TIREUR_T: {
          // § E5.M (B12) : son corps est-il entier dans le champ VISIBLE (zoom compris) ? Écrit en ligne : appelé comme
          // fonction, ses flottants étaient emballés (52 o/image mesurés)
          const vox = xi - VB[0];
          const voz = zi - VB[1];
          const vua = vox * VB[2] + voz * VB[3];
          const vub = vox * VB[4] + voz * VB[5];
          const visible = vua > -VB[9] && vua < VB[9] && vub > -VB[13] && vub < VB[11]; // § E5.AB.12 : bas = VB[13] (= VB[10] en ortho)
          if (AI0[i] === 0) AI0[i] = (UID[i] & 1) === 0 ? 1 : -1; // sens de son pas de côté, une fois pour toutes
          if (AI1[i] > 0) {
            const a = AI1[i] - dt;
            AI1[i] = a > 0 ? a : 0;
          }
          if (STATE[i] === S_NEW) {
            // Première arrivée à portée : sa première visée attend un délai tiré au hasard. Des tireurs arrivés
            // ensemble ne tirent pas d'une seule voix.
            if (d <= RANGED.maxRange) {
              STATE[i] = S_MOVE;
              CD[i] = RANGED.firstDelayMin + rand() * FIRST_DELAY_SPAN;
            }
          } else if (STATE[i] === S_AIM) {
            // Télégraphe : immobile, la lueur monte pendant windup ; puis le tir part vers le joueur de cet instant.
            const left = TIMER[i];
            if (left > 0) GLOW[i] = 1 - left * WINDUP_INV;
            else if (!visible) {
              // § E5.M (B12) : sorti du champ visible pendant sa visée (le héros ou la caméra a bougé) : il ne tire pas,
              // il se replace et revise après un délai court (comme un pool de tirs plein)
              STATE[i] = S_MOVE;
              CD[i] = RANGED.retryDelay;
              horsEcran++;
            } else if (d2 > 1e-6) {
              const mz = d > RANGED.muzzle * 2 ? RANGED.muzzle : d * 0.5;
              STATE[i] = S_MOVE;
              // Révisions (§ E1.B) : v2 = salve en éventail ; v3 = un tir sur OBUS.everyShots est un obus lobé.
              const rv = rev[TIREUR_T];
              let fired = 0;
              if (rv >= 2 && REV0[i] + 1 >= OBUS.everyShots) {
                ARGF[F_X] = px; // le cercle est posé où se tient le joueur à cet instant
                ARGF[F_Z] = pz;
                ARGF[F_DX] = OBUS.radius;
                ARGF[F_DZ] = 1; // obus dessiné en vol
                ARGF[F_SX] = xi + tx * mz; // il part de la bouche du canon
                ARGF[F_SZ] = zi + tz * mz;
                ARGF[F_T] = OBUS.flight;
                ARGF[F_V] = OBUS.dmg * MUL[i];
                if (hazards.addF(HAZ.STRIKE) >= 0) {
                  fired = 1;
                  shells++;
                  REV0[i] = 0;
                }
              } else if (rv >= 1) {
                for (let q = 0; q < SALVE.shots; q++) {
                  const c = salveCos[q];
                  const s = salveSin[q];
                  const qx = tx * c + tz * s;
                  const qz = tz * c - tx * s;
                  if (spawnProjectile(xi + qx * mz, zi + qz * mz, qx * RANGED.shotSpeed, qz * RANGED.shotSpeed, RANGED.shotRadius, RANGED.shotDmg * MUL[i], RANGED.shotLife) >= 0) fired++;
                }
                if (fired > 0) {
                  salvos++;
                  if (rv >= 2) REV0[i] += 1;
                }
              } else if (spawnProjectile(xi + tx * mz, zi + tz * mz, tx * RANGED.shotSpeed, tz * RANGED.shotSpeed, RANGED.shotRadius, RANGED.shotDmg * MUL[i], RANGED.shotLife) >= 0) fired = 1;
              if (fired > 0) {
                audio.play(SFX.ENEMY_SHOT, xi, zi); // un seul son, un seul recul par salve
                shotsFired += fired;
                CD[i] = RELOAD;
                AI1[i] = RANGED.recoilSeconds;
                GLOW[i] = RANGED.afterGlow;
              } else {
                // Pool des tirs plein : rien n'est parti. Ni son, ni recul, ni tir compté (on n'entend pas un tir
                // qui n'existe pas) ; il vise de nouveau après un délai court, sans attendre une recharge entière.
                CD[i] = RANGED.retryDelay;
              }
            }
            chase = false;
          } else if (CD[i] <= 0 && d <= RANGED.maxRange && d2 > 1e-6 && P.alive && visible) {
            // § E5.M (B12) : il ne commence sa visée que s'il est dans le champ visible (hors écran : il approche)
            STATE[i] = S_AIM;
            TIMER[i] = RANGED.windup;
            chase = false;
            ARGF[F_X] = xi; // § E5.Q (B13) : la visée s'entend (une voix, minInterval : config.js) ; position par ARGF (§ V)
            ARGF[F_Z] = zi;
            audio.playF(SFX.TIREUR_VISEE);
          }
          break;
        }
        case KAMIKAZE_T: {
          if (STATE[i] === K_CHASE) {
            // Bloqué à portée de souffle : derrière une meute déjà au contact il n'atteint jamais triggerDist et
            // restait passif. Il compte donc le temps passé presque à l'arrêt (sa vitesse effective de l'image
            // précédente, sous stuckSpeedMul de sa vitesse voulue) alors que son explosion toucherait le joueur ;
            // au bout de stuckSeconds la mèche s'allume là où il est. Un kamikaze qui court n'est jamais « bloqué ».
            let stuck = 0;
            if (d <= STUCK_RANGE) {
              const lim = k * BOOM.stuckSpeedMul;
              if (VX[i] * VX[i] + VZ[i] * VZ[i] < lim * lim) stuck = AI1[i] + dt;
            }
            AI1[i] = stuck;
            if ((d <= BOOM.triggerDist || stuck >= BOOM.stuckSeconds) && P.alive) {
              STATE[i] = K_FUSE;
              TIMER[i] = BOOM.fuse;
              AI1[i] = BOOM.fuse; // § E5.M (B7) : durée de CETTE mèche (le disque au sol se remplit sur elle)
              AI0[i] = 0;
              GLOW[i] = CF.reduits ? BOOM.glowMin : 1; // § E5.X5 : en Réduits, pas d'éclat à l'allumage (la lueur monte ensuite)
              audio.play(SFX.KAMIKAZE_BEEP, xi, zi);
            }
            break; // il fonce
          }
          const left = TIMER[i];
          if (left <= 0) {
            // Fin de la mèche. Dans cet ordre : il meurt D'ABORD (sinon sa propre explosion le toucherait), puis explose.
            detonations++;
            damage.killEnemy(i, SELF_DESTRUCT_FLAGS);
            // Intégration : spareType = kamikaze (un groupe ne s'autodétruit plus ; robotDmg remonté à 10 dans config).
            damage.explode(xi, zi, BOOM.radius, BOOM.robotDmg, BOOM.playerDmg * MUL[i], DMG_SRC.KAMIKAZE, DMG.NO_CRIT, FXK.KAMIKAZE, BOOM.trauma, BOOM.punch, 0, ENEMY.KAMIKAZE, CAUSE.EXPLOSION);
            if (rev[KAMIKAZE_T] >= 1) {
              // Kamikaze v2 (§ E1.B) : son explosion arme les kamikazes voisins (réaction en chaîne)
              ARGF[F_X] = xi;
              ARGF[F_Z] = zi;
              chainF(i);
            }
            modes[i] = SKIP;
            continue;
          }
          // Il clignote de plus en plus vite (un bip à chaque éclat) et ralentit : on peut encore s'écarter.
          const before = AI0[i];
          const phase = before + (BOOM.blinkHzStart + BLINK_SPAN * (1 - left * FUSE_INV)) * dt;
          AI0[i] = phase;
          const whole = Math.floor(phase);
          // rappel de la séquence : le fichier de la mèche (lancé à l'allumage) contient déjà tous les bips
          if (whole > Math.floor(before)) audio.playStep(SFX.KAMIKAZE_BEEP, xi, zi);
          // § E5.X5 (Réduits) : plus de clignotement 6 → 18 Hz ; la lueur MONTE en continu jusqu'à l'explosion (les bips gardent le rythme)
          GLOW[i] = CF.reduits ? BOOM.glowMin + (1 - BOOM.glowMin) * (1 - left * FUSE_INV) : phase - whole < BOOM.blinkDuty ? 1 : BOOM.glowMin;
          wx = tx * k * BOOM.fuseSpeedMul;
          wz = tz * k * BOOM.fuseSpeedMul;
          chase = false;
          break;
        }
        case BLINDE_T: {
          // Il avance dans l'axe de son cap (qui tourne à turnRate, étape 6) et pivote sur place quand le joueur
          // n'est plus devant lui : on peut le prendre à revers.
          const rot = ROT[i];
          const hx = Math.sin(rot);
          const hz = Math.cos(rot);
          if (rev[BLINDE_T] >= 1) {
            // Blindé v2 (§ E1.B) : charge annoncée par un trait, dans l'axe de son cap (figé pendant la manœuvre).
            const st = STATE[i];
            if (st === M_WARN) {
              if (TIMER[i] <= 0) {
                STATE[i] = M_GO;
                TIMER[i] = CHARGE_GO;
                charges++;
              }
              ux = hx;
              uz = hz;
              chase = false;
              break;
            }
            if (st === M_GO) {
              if (TIMER[i] <= 0) {
                STATE[i] = M_NONE;
                CD[i] = CHARGE.every;
                RECUP[i] = X8[0]; // § E5.X8 (E8) : récupération après la charge
                X8_COMPTES[0]++;
              } else {
                const v = CHARGE_V * SLOW[i];
                wx = hx * v;
                wz = hz * v;
                rush = true;
              }
              ux = hx;
              uz = hz;
              chase = false;
              break;
            }
            if (CD[i] <= 0 && d <= CHARGE.range && hx * tx + hz * tz >= CHARGE.aimCos && P.alive) {
              ARGF[F_X] = xi;
              ARGF[F_Z] = zi;
              ARGF[F_DX] = ri;
              ARGF[F_DZ] = CHARGE.length + ri; // le trait couvre le chemin de son avant
              ARGF[F_SX] = rot;
              ARGF[F_SZ] = CHARGE_GO; // le trait reste le temps de la charge : il raccourcit devant le blindé
              ARGF[F_T] = CHARGE.telegraph;
              ARGF[F_V] = 0;
              hazards.addF(HAZ.LINE); // § E5.Q ter : le trait s'annonce (ANNONCE_SOL, hazards.js) ; BOSS_TELEGRAPH retiré
              STATE[i] = M_WARN;
              TIMER[i] = CHARGE.telegraph;
              REV0[i] = rot;
              ux = hx;
              uz = hz;
              chase = false;
              break;
            }
          }
          let f = (hx * tx + hz * tz - ALIGN_MIN) * ALIGN_INV;
          if (f < 0) f = 0;
          ux = hx;
          uz = hz;
          wx = hx * k * f;
          wz = hz * k * f;
          chase = false;
          break;
        }
        case REPARATEUR_T: {
          if (STATE[i] === S_NEW) {
            STATE[i] = S_MOVE;
            CD[i] = HEAL.interval * rand();
            AI0[i] = (UID[i] & 1) === 0 ? 1 : -1;
          }
          if (CD[i] <= 0) {
            // v2 (§ E1.B) : il pose des bulles-boucliers au lieu de soigner
            if (rev[REPARATEUR_T] >= 1) CD[i] = bubblePulse(i) > 0 ? BULLE.interval : HEAL.idleRetry;
            else CD[i] = healPulse(i) > 0 ? HEAL.interval : HEAL.idleRetry;
          }
          break;
        }
        default:
          if (!special && t >= FOREUSE_T) {
            // § E3.D : les quatre robots de l'étape 3 (src/enemies-e3.js) ; entrées et sorties dans ARGF
            ARGF[F_X] = tx;
            ARGF[F_Z] = tz;
            ARGF[F_V] = k;
            ARGF[F_T] = dt;
            ARGF[F_SX] = d;
            const m = e3.updateF(i);
            if (m !== 0) {
              wx = ARGF[F_DX];
              wz = ARGF[F_DZ];
              ux = ARGF[F_SX];
              uz = ARGF[F_SZ];
              chase = false;
              rush = m === 2;
            }
          }
          break;
      }
      if (chase) {
        const far = keepMax[t];
        if (far > 0) {
          // Robot « à distance » (tireur, réparateur) : avance au-delà de keepMax, recule en deçà de keepMin, pas de
          // côté entre les deux. Sa direction de marche, pas celle du joueur, sert au frein de foule.
          let f = 0;
          if (d > far) {
            f = (d - far) * KEEP_RAMP_INV;
            if (f > 1) f = 1;
          } else if (d < keepMin[t]) {
            f = (keepMin[t] - d) * KEEP_RAMP_INV;
            if (f > 1) f = 1;
            f *= -retreatMul[t];
          }
          const s = strafeMul[t] * AI0[i];
          const mx = tx * f - tz * s;
          const mz = tz * f + tx * s;
          const m2 = mx * mx + mz * mz;
          if (m2 > 1e-8) {
            const inv = 1 / Math.sqrt(m2);
            ux = mx * inv;
            uz = mz * inv;
          }
          wx = mx * k;
          wz = mz * k;
        } else {
          wx = tx * k;
          wz = tz * k;
        }
      }
      //#region e5:X8-lot8
      // § E5.X8 (E8) : récupération — aucune vitesse voulue (le comportement du type a tourné : la foreuse remonte)
      if (RECUP[i] > 0) {
        wx = 0;
        wz = 0;
        rush = false;
      }
      //#endregion e5:X8-lot8
    }

    // 3. séparation : voisins lus dans les tableaux bruts de la grille (3 × 3 cellules)
    let sx = 0;
    let sz = 0;
    let cx = Math.floor((xi - GRID_MIN) * GRID_INV);
    let cz = Math.floor((zi - GRID_MIN) * GRID_INV);
    if (cx < 0) cx = 0;
    else if (cx > GRID_DIM - 1) cx = GRID_DIM - 1;
    if (cz < 0) cz = 0;
    else if (cz > GRID_DIM - 1) cz = GRID_DIM - 1;
    const z0 = cz > 0 ? cz - 1 : 0;
    const z1 = cz < GRID_DIM - 1 ? cz + 1 : GRID_DIM - 1;
    const x0 = cx > 0 ? cx - 1 : 0;
    const x1 = cx < GRID_DIM - 1 ? cx + 1 : GRID_DIM - 1;
    let neighbors = 0;
    let front = 0; // chevauchement cumulé avec les voisins qui sont DEVANT (dans la direction de marche)
    const vh = volHaut[t]; // § E5.D : un volant haut et un robot au sol s'ignorent
    scan: for (let gz = z0; gz <= z1; gz++) {
      const row = gz * GRID_DIM;
      for (let gx = x0; gx <= x1; gx++) {
        const c = row + gx;
        const cnt = cellCount[c];
        if (cnt === 0) continue;
        const s = cellStart[c];
        for (let q = s; q < s + cnt; q++) {
          const j = items[q];
          if (j === i || ALIVE[j] === 0 || volHaut[TYPE[j]] !== vh) continue;
          const dx = xi - X[j];
          const dz = zi - Z[j];
          const rr = ri + R[j];
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) continue;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            const overlap = (rr - d) / rr;
            const push = (sepStrength * overlap) / d;
            sx += dx * push;
            sz += dz * push;
            const ahead = -(dx * ux + dz * uz) / d; // cosinus : 1 = le voisin est pile devant
            if (ahead > 0) front += overlap * ahead;
          } else {
            // deux robots exactement au même point : poussée opposée selon l'indice
            sx += i < j ? sepStrength : -sepStrength;
          }
          if (++neighbors >= maxNeighbors) break scan;
        }
      }
    }
    const mi = massInv[t];
    sx *= mi;
    sz *= mi;
    // Frein de foule : un robot bloqué par ceux de devant cesse de pousser. Sans cela la pression des rangs
    // arrière s'additionne jusqu'au centre et la meute s'écrase en un seul tas autour du joueur.
    if (rush) {
      // manœuvre (§ E1.B) : il passe à travers la meute, en ligne droite
      sx = 0;
      sz = 0;
    } else if (front > 0) {
      let brake = 1 - crowdBrake * front;
      if (brake < crowdMinSpeed) brake = crowdMinSpeed;
      wx *= brake;
      wz *= brake;
    }

    // 4. déplacement
    const vx = wx + sx + kx;
    const vz = wz + sz + kz;
    X[i] = xi + vx * dt;
    Z[i] = zi + vz * dt;
    VX[i] = vx;
    VZ[i] = vz;
    modes[i] = hover[t] > 0 ? FLY : GROUND;
  }

  // ---- Obstacles et bords de l'arène : un seul appel, sur les tableaux
  world.resolveMany(X, Z, R, modes, n);

  // ---- Boucle B : contacts (joueur, boss), cap
  const pr = P.radius;
  const pushOut = PLAYER.enemyPushOut;
  const interval = COMMON.contactInterval;
  const b = E.bossIndex;
  let canHit = !frozen && P.alive && P.dashT <= 0 && P.invulnT <= 0;
  //#region e5:AC-contact
  // § E5.AC : un geste peut partir pendant les CT[0] dernières secondes de l'invulnérabilité du héros (et de la recharge
  // du robot) : le sommet tombe quand elles finissent — la cadence des coups reste celle d'avant
  const FENTE = E.fente;
  const prep = CT[0];
  let canStart = !frozen && P.alive && P.dashT <= 0 && P.invulnT <= prep && prep > 0;
  CT[6] += dt;
  CT[8] = dt;
  CT[9] = pr;
  //#endregion e5:AC-contact
  let pushed = 0; // robots déplacés par le cercle du joueur ou du boss : à ressortir des obstacles ensuite
  for (let i = 0; i < n; i++) {
    pushedModes[i] = SKIP;
    if (ALIVE[i] === 0 || SUS[i] === 2 || (SUS[i] === 1 && eyeMode === 2)) {
      FENTE[i] = 0; // § E5.AC : un geste ne survit pas au repli ni au garage
      continue; // § E4.F : garé, ou en repli : ni contact, ni poussée, cap tenu par le repli
    }
    const t = TYPE[i];
    let dx = X[i] - px;
    let dz = Z[i] - pz;
    const rr = R[i] + pr;
    const d2 = dx * dx + dz * dz;
    if (t === BOSS_T) {
      // le boss ne repousse pas et n'est pas repoussé ; § E5.N (Femz, 21/11) : son corps ne blesse plus au contact
      // (COMBAT_GUIDE.boss.degatsContact) ; rallumé, il toucherait au rayon de DÉGÂTS du héros (2,2 + 0,3 = 2,5 m)
      const rb = R[i] + P.rayonDegats;
      if (COMBAT_GUIDE.boss.degatsContact && canHit && d2 < rb * rb && ATK[i] <= 0 && DMGV[i] > 0) {
        if (damage.hitPlayer(DMGV[i], HURT.BOSS, X[i], Z[i], CAUSE.CONTACT + BOSS_T) > 0) {
          ATK[i] = interval;
          canHit = false;
        }
      }
      continue;
    }
    //#region e5:AC-contact
    // § E5.AC : coup armé en cours (fonction à part : la boucle reste assez courte pour être optimisée)
    if (FENTE[i] > 0 && !frozen) {
      CS[0] = d2;
      CS[1] = rr;
      CS[2] = dx;
      CS[3] = dz;
      if (coupArmeF(i, t, canHit ? 1 : 0) === 1) {
        canHit = false;
        canStart = false;
      }
    }
    //#endregion e5:AC-contact
    // 5. contact avec le joueur : repoussé hors de son cercle, puis coup
    if (d2 < rr * rr) {
      if (pushOut) {
        if (d2 > 1e-8) {
          const k = rr / Math.sqrt(d2);
          X[i] = px + dx * k;
          Z[i] = pz + dz * k;
        } else {
          X[i] = px + rr;
        }
        pushedModes[i] = modes[i];
        pushed++;
      }
      //#region e5:AC-contact
      // § E5.AC : seuls les robots de mêlée blessent au contact. Pendant une manœuvre (piqué, charge, bond : annoncés par
      // leur trait) le coup part tout de suite, comme avant ; sinon (préparation > 0) le contact ARME un coup (plus bas).
      const go = STATE[i] === M_GO && maneuver[t] === 1;
      const permis = contactOn[t] === 1 ? contactPermisF(i) : 0; // § E5.X8 : récupération, Phasé en phase
      if (permis === 1 && (go || prep <= 0) && canHit && ATK[i] <= 0 && DMGV[i] > 0 && SLOW[i] !== 0 && SUS[i] === 0) {
        // (§ E3.C : un robot étourdi ne frappe pas au contact ; § E3.K : un robot en veille non plus) piqué du drone v2,
        // charge du blindé v2 : le contact pendant la manœuvre frappe plus fort (§ E1.B)
        const hit = go ? DMGV[i] * goDmgMul[t] : DMGV[i];
        if (damage.hitPlayer(hit, HURT.CONTACT, X[i], Z[i], go ? causeManoeuvre[t] : causeContact[t]) > 0) { // § E5.Q : cause
          ATK[i] = interval;
          canHit = false;
          canStart = false;
          if (go) COUPS_MELEE[6]++;
        }
      } else if (permis === 1 && !go && canStart && FENTE[i] === 0 && ATK[i] <= prep && DMGV[i] > 0 && SLOW[i] !== 0 && SUS[i] === 0) {
        FENTE[i] = dt < prep ? dt : prep; // le geste part : cette image est sa première (sommet 0,12 s plus loin)
        COUPS_MELEE[0]++;
      }
      //#endregion e5:AC-contact
    }
    // 5 bis. contact avec le boss (absent de la grille) : repoussé entièrement, le boss ne bouge pas
    if (b >= 0) {
      const bx = X[i] - X[b];
      const bz = Z[i] - Z[b];
      const br = R[i] + R[b];
      const bd2 = bx * bx + bz * bz;
      if (bd2 < br * br) {
        if (bd2 > 1e-8) {
          const k = br / Math.sqrt(bd2);
          X[i] = X[b] + bx * k;
          Z[i] = Z[b] + bz * k;
        } else {
          X[i] = X[b] + br;
        }
        pushedModes[i] = modes[i];
        pushed++;
      }
    }
    // 6. cap : fait face au joueur (le tireur vise, le blindé présente son bouclier) ; tourne à turnRate si le
    // type en a un, sinon tout de suite. Le nez du drone suit en plus son virage.
    if (!frozen && SUS[i] === 0) {
      dx = px - X[i];
      dz = pz - Z[i];
      const heading = FLAGS[i] & F_HEADING;
      if (heading !== 0) {
        // robot d'événement (§ E1.C) : l'essaim regarde où il va, le blindé d'un anneau présente son bouclier au centre
        ROT[i] = heading === F_TRANSIT ? REV0[i] : REV0[i] + Math.PI;
      } else if (STATE[i] !== M_NONE && maneuver[t] === 1) {
        ROT[i] = REV0[i]; // manœuvre d'une révision : cap figé (là où il va piquer, bondir, charger)
      } else if (E.recup[i] > 0) {
        // § E5.X8 (E8) : récupération — cap figé
      } else if (dx * dx + dz * dz > 1e-6) {
        let want = Math.atan2(dx, dz);
        if (t === DRONE_T) want -= AI0[i] * WEAVE.yaw;
        const tr = turnNow[t];
        if (tr > 0) {
          let d = want - ROT[i];
          d -= Math.round(d / TWO_PI) * TWO_PI;
          const step = tr * dt;
          ROT[i] += d > step ? step : d < -step ? -step : d;
        } else {
          ROT[i] = want;
        }
      }
    }
  }
  // Un robot repoussé hors du cercle du joueur (ou du boss) peut avoir été renvoyé dans un rocher : l'obstacle
  // est solide, il a le dernier mot. Seuls les robots déplacés sont résolus de nouveau.
  if (pushed > 0) world.resolveMany(X, Z, R, pushedModes, n);
  // Allure (§ Z sexies) : allure lissée (E.ai2) et phase du pas (E.ai3) sur la vitesse RÉELLE de l'image, hors boss
  allure.update(dt);
}

/**
 * Impulsion du réparateur i : soigne jusqu'à HEAL.maxTargets robots vivants et abîmés, les plus abîmés d'abord, à
 * moins de HEAL.radius m (de centre à centre), hors lui-même et hors boss. Renvoie le nombre de robots soignés
 * (0 : ni effet ni son, il regardera de nouveau après HEAL.idleRetry). Appelée une fois par impulsion, pas par image.
 */
function healPulse(i) {
  const x = E.x[i];
  const z = E.z[i];
  const HP = E.hp, MAXHP = E.maxHp, TYPE = E.type, ALIVE = E.alive;
  const found = grid.queryCircle(x, z, HEAL.radius, healScratch, healScratch.length);
  const max = healPick.length;
  let n = 0;
  for (let q = 0; q < found; q++) {
    const j = healScratch[q];
    if (j === i || ALIVE[j] === 0) continue;
    if (TYPE[j] === BOSS_T && !HEAL.healsBoss) continue;
    const missing = MAXHP[j] - HP[j];
    if (!(missing > 0)) continue;
    const dx = E.x[j] - x;
    const dz = E.z[j] - z;
    if (dx * dx + dz * dz > HEAL_R2) continue;
    // insertion dans la courte liste triée des plus abîmés
    let p = n;
    if (n < max) n++;
    else if (missing > healMissing[max - 1]) p = max - 1;
    else continue;
    while (p > 0 && healMissing[p - 1] < missing) {
      healMissing[p] = healMissing[p - 1];
      healPick[p] = healPick[p - 1];
      p--;
    }
    healMissing[p] = missing;
    healPick[p] = j;
  }
  if (n === 0) return 0;
  const amount = HEAL.amount * waveHpMul(run.wave > 1 ? run.wave : 1);
  for (let q = 0; q < n; q++) {
    const j = healPick[q];
    healedHp[0] += heal(j, amount);
    // le robot soigné prend une teinte verte (sans éteindre une lueur plus forte : un réparateur soigné en pleine impulsion)
    if (healGlowOk[TYPE[j]] === 1 && E.glow[j] < COMMON.healGlow) E.glow[j] = COMMON.healGlow;
  }
  E.glow[i] = 1;
  healPulses++;
  fx.spawnHealPulse(x, z);
  audio.play(SFX.HEAL, x, z);
  return n;
}

/**
 * Réparateur v2 (§ E1.B) : au lieu de soigner, il pose une bulle-bouclier sur HEAL.maxTargets robots sans bulle à
 * moins de HEAL.radius m (les plus abîmés d'abord, hors lui-même et hors boss). La bulle absorbe
 * BULLE.shieldFraction × PV max pendant BULLE.shieldSeconds s (E.shield, durée E.rev1 ; damage.hitEnemyF la vide
 * d'abord). Renvoie le nombre de bulles posées.
 */
function bubblePulse(i) {
  const x = E.x[i];
  const z = E.z[i];
  const HP = E.hp, MAXHP = E.maxHp, TYPE = E.type, ALIVE = E.alive, SHIELD = E.shield;
  const found = grid.queryCircle(x, z, HEAL.radius, healScratch, healScratch.length);
  const max = healPick.length;
  let n = 0;
  for (let q = 0; q < found; q++) {
    const j = healScratch[q];
    if (j === i || ALIVE[j] === 0 || TYPE[j] === BOSS_T || SHIELD[j] > 0) continue;
    const dx = E.x[j] - x;
    const dz = E.z[j] - z;
    if (dx * dx + dz * dz > HEAL_R2) continue;
    const missing = MAXHP[j] - HP[j];
    let p = n;
    if (n < max) n++;
    else if (missing > healMissing[max - 1]) p = max - 1;
    else continue;
    while (p > 0 && healMissing[p - 1] < missing) {
      healMissing[p] = healMissing[p - 1];
      healPick[p] = healPick[p - 1];
      p--;
    }
    healMissing[p] = missing;
    healPick[p] = j;
  }
  if (n === 0) return 0;
  for (let q = 0; q < n; q++) {
    const j = healPick[q];
    SHIELD[j] = BULLE.shieldFraction * MAXHP[j];
    E.rev1[j] = BULLE.shieldSeconds;
  }
  bubbled += n;
  bubblePulses++;
  E.glow[i] = 1;
  fx.spawnHealPulse(x, z);
  audio.play(SFX.HEAL, x, z);
  return n;
}

/**
 * Kamikaze v2 (§ E1.B) : l'explosion du kamikaze `self`, en (ARGF[F_X], ARGF[F_Z]), arme les kamikazes vivants dans
 * BOOM.radius — mèche CHAINE.chainFuse (une mèche déjà plus courte n'est pas rallongée).
 */
function chainF(self) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  const found = grid.queryCircle(x, z, BOOM.radius, healScratch, healScratch.length);
  const r2 = BOOM.radius * BOOM.radius;
  let armed = 0;
  for (let q = 0; q < found; q++) {
    const j = healScratch[q];
    if (j === self || E.alive[j] === 0 || E.type[j] !== KAMIKAZE_T) continue;
    const dx = E.x[j] - x;
    const dz = E.z[j] - z;
    if (dx * dx + dz * dz > r2) continue;
    if (E.state[j] === K_FUSE && E.timer[j] <= CHAINE.chainFuse) continue;
    E.state[j] = K_FUSE;
    E.timer[j] = CHAINE.chainFuse;
    E.ai1[j] = CHAINE.chainFuse; // § E5.M (B7) : durée de la mèche (disque au sol)
    E.ai0[j] = 0;
    E.glow[j] = 1;
    armed++;
  }
  if (armed > 0) {
    chains++;
    chained += armed;
  }
}

/**
 * Drone v3 (§ E1.B) : appelé par damage.killEnemyF à la mort d'un drone (hors purge, hors mort silencieuse). Il laisse
 * une flaque électrique là où il tombe. Écrit ARGF : à appeler en dernier.
 */
export function dronePuddleF(i) {
  if (rev[DRONE_T] < 2) return;
  ARGF[F_X] = E.x[i];
  ARGF[F_Z] = E.z[i];
  ARGF[F_DX] = FLAQUE.radius;
  ARGF[F_DZ] = 0;
  ARGF[F_SX] = 0;
  ARGF[F_SZ] = 0;
  ARGF[F_T] = FLAQUE.seconds;
  ARGF[F_V] = FLAQUE.dps * E.mul[i] * COMMON.contactInterval; // dégâts d'un tic
  if (hazards.addF(HAZ.PUDDLE) >= 0) puddles++;
}

// ----- Projectiles ennemis (S9) ------------------------------------------------------------------------------------

/** Tir ennemi droit. dmg est final (multiplicateur de vague compris). Renvoie l'indice, ou −1 si le pool est plein. */
export function spawnProjectile(x, z, vx, vz, radius, dmg, life) {
  if (pCount >= PCAP) return -1;
  const k = pCount++;
  pX[k] = x;
  pZ[k] = z;
  pPX[k] = x;
  pPZ[k] = z;
  pVX[k] = vx;
  pVZ[k] = vz;
  pR[k] = radius;
  pDmg[k] = dmg;
  pLife[k] = life;
  if (pCount > peakProjectiles) peakProjectiles = pCount;
  return k;
}

function removeProjectile(k) {
  const last = --pCount;
  if (k !== last) {
    pX[k] = pX[last];
    pZ[k] = pZ[last];
    pPX[k] = pPX[last];
    pPZ[k] = pPZ[last];
    pVX[k] = pVX[last];
    pVZ[k] = pVZ[last];
    pR[k] = pR[last];
    pDmg[k] = pDmg[last];
    pLife[k] = pLife[last];
  }
}

export function updateProjectiles(dt) {
  if (pCount === 0) return;
  // § E4.F.2 : extinction de fin de vague — ils volent encore, rétrécissent (sync), ne touchent plus personne, puis le pool
  // est vidé
  let harmless = false;
  if (RF[0] > 0) {
    RF[0] -= dt;
    if (RF[0] <= 0) {
      RF[0] = 0;
      pCount = 0;
      return;
    }
    harmless = true;
  }
  const block = WORLD.blockEnemyShots;
  for (let k = pCount - 1; k >= 0; k--) {
    const x0 = pX[k];
    const z0 = pZ[k];
    const x1 = x0 + pVX[k] * dt;
    const z1 = z0 + pVZ[k] * dt;
    pPX[k] = x0;
    pPZ[k] = z0;
    pX[k] = x1;
    pZ[k] = z1;
    pLife[k] -= dt;
    // détruit en fin de vie, ou sur un obstacle
    if (pLife[k] <= 0 || (block && world.overlaps(x1, z1, pR[k]))) {
      removeProjectile(k);
      continue;
    }
    // segment parcouru contre le cercle du joueur ; un tir qui traverse un joueur en dash continue sa route
    if (!harmless && P.alive && P.dashT <= 0 && P.invulnT <= 0) {
      const sx = x1 - x0;
      const sz = z1 - z0;
      const len2 = sx * sx + sz * sz;
      let t = len2 > 1e-12 ? ((P.x - x0) * sx + (P.z - z0) * sz) / len2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const dx = P.x - (x0 + sx * t);
      const dz = P.z - (z0 + sz * t);
      const rr = pR[k] + P.rayonDegats; // § E5.N (B5) : rayon de dégâts du héros (était P.radius)
      if (dx * dx + dz * dz < rr * rr) {
        if (damage.hitPlayer(pDmg[k], HURT.PROJECTILE, x1, z1, CAUSE.TIR) > 0) removeProjectile(k); // § E5.Q : seuls les tireurs tirent
      }
    }
  }
}

export function clearProjectiles() {
  pCount = 0;
  RF[0] = 0;
}

/** Tests : les max premiers tirs ennemis en vol. */
export function listProjectiles(max = 64) {
  const out = [];
  for (let k = 0; k < pCount && out.length < max; k++) out.push({ x: pX[k], z: pZ[k], vx: pVX[k], vz: pVZ[k], dmg: pDmg[k], life: pLife[k] });
  return out;
}

export function getProjectileCount() {
  return pCount;
}

// ----- Effets sur un robot -------------------------------------------------------------------------------------------

/**
 * Ralentit : E.slow = max(plancher, min(E.slow, factor)) ; durée = max(durée, seconds). Réduit pour le boss.
 * Sans effet si factor ou seconds n'est pas un nombre fini : un NaN reçu d'un appelant passerait dans la vitesse
 * du robot, puis dans sa position, pour toujours (robot invisible, intouchable : la vague ne finirait plus).
 */
export function applySlow(i, factor, seconds) {
  ARGF[F_V] = factor;
  ARGF[F_T] = seconds;
  applySlowF(i);
}

/** applySlow sans flottant en argument : facteur ARGF[F_V], durée ARGF[F_T] (§ Z nonies). */
export function applySlowF(i) {
  const factor = ARGF[F_V];
  const seconds = ARGF[F_T];
  if (E.alive[i] === 0) return;
  if (!Number.isFinite(factor) || !Number.isFinite(seconds)) return;
  if (E.slow[i] === 0) return; // § E3.C : étourdi par la Décharge — un ralentissement ne le relève pas
  let f = factor;
  if (E.type[i] === BOSS_T) f = 1 - (1 - f) * BOSS.slowResist;
  const floor = COMMON.slowFloor;
  let s = E.slow[i] < f ? E.slow[i] : f;
  if (s < floor) s = floor;
  E.slow[i] = s;
  if (seconds > E.slowT[i]) E.slowT[i] = seconds;
}

/**
 * Recul : (dirX, dirZ) unitaire ; ajoute impulse / masse à (kx, kz). Sans effet si le debug l'a coupé, ni si le
 * recul demandé n'est pas fini (direction 0 / 0 d'un appelant : le robot partirait en NaN pour toujours).
 */
export function applyKnockback(i, dirX, dirZ, impulse) {
  ARGF[F_DX] = dirX;
  ARGF[F_DZ] = dirZ;
  ARGF[F_V] = impulse;
  applyKnockbackF(i);
}

/** applyKnockback sans flottant en argument : direction ARGF[F_DX], ARGF[F_DZ], impulsion ARGF[F_V] (§ Z nonies). */
export function applyKnockbackF(i) {
  const dirX = ARGF[F_DX];
  const dirZ = ARGF[F_DZ];
  const impulse = ARGF[F_V];
  if (!debug.isKnockbackEnabled()) return;
  const k = impulse * massInv[E.type[i]];
  const kx = dirX * k;
  const kz = dirZ * k;
  if (!Number.isFinite(kx) || !Number.isFinite(kz)) return;
  E.kx[i] += kx;
  E.kz[i] += kz;
}

/** Soigne un robot vivant ; renvoie les PV rendus. */
export function heal(i, amount) {
  if (E.alive[i] === 0 || !(amount > 0)) return 0;
  const before = E.hp[i];
  const hp = before + amount;
  E.hp[i] = hp > E.maxHp[i] ? E.maxHp[i] : hp;
  return E.hp[i] - before;
}

/**
 * Élite porteuse d'un coffre (§ E2.C règle 3) : le robot i (créé par spawn) reçoit EFLAG.ELITE, un rayon × scale, des
 * PV et PV max × hpMul. Sa taille à l'écran (× scale) est posée par src/anim/allure.js, son aura par chests.sync, son
 * butin (gemmes × xpMul, coffre) par damage.killEnemyF. Aucun flottant en argument.
 */
export function makeCarrierF(i, rarity = 0) {
  const K = CHESTS.carrier;
  E.flags[i] |= EFLAG.ELITE;
  E.rarity[i] = rarity >= 0 && rarity <= 5 ? rarity : 0; // § E2.G bis : Brut … Chiffré ; § E3.A : Noyau, Root
  E.radius[i] *= K.scale;
  E.hp[i] *= K.hpMul;
  E.maxHp[i] = E.hp[i];
}

/** damage.killEnemy(i, flags) sur chaque vivant (F1, mort du boss). */
export function killAll(flags) {
  for (let i = 0; i < E.count; i++) {
    if (E.alive[i] === 1) damage.killEnemy(i, flags);
  }
}

/**
 * Purge de fin de vague (§ E1.A règle 9) : chaque robot vivant se désintègre dans l'image, par
 * damage.killEnemyF(i, DMG.PURGE | DMG.NO_LOOT) — sans kill compté, sans butin, sans son ni secousse par robot. Les
 * voxels (fx.beginPurge règle leur nombre par robot d'après l'effectif) sortent du pool d'éclats. Renvoie le nombre
 * de robots purgés.
 */
export function purgeAll() {
  const alive = E.aliveCount;
  if (alive === 0) return 0;
  fx.beginPurge(alive);
  const flags = DMG.PURGE | DMG.NO_LOOT;
  ARGF[F_DX] = 0;
  ARGF[F_DZ] = 0;
  for (let i = 0; i < E.count; i++) {
    if (E.alive[i] === 1) damage.killEnemyF(i, flags);
  }
  return alive;
}

/**
 * § E3.K — survivants reportés. on = true (T5, fin de vague) : chaque robot vivant passe en veille (E.sus = 1) — ni
 * marche, ni action, ni contact (update), intouchable (damage.hitEnemyF), hors de la grille (grid.rebuild) ; ses
 * drapeaux d'événement sont retirés (l'événement est fini : un drone d'essaim, un blindé d'anneau, une garde, un
 * drone-bouclier redeviennent des robots ordinaires de leur type) ; manœuvre abandonnée ; yeux en veille. on = false
 * (après « GO » + CARRY.graceSeconds) : tous se réveillent, les yeux reprennent la teinte de leur révision. Renvoie
 * le nombre de robots touchés. Hors combat (une fois par vague) : un parcours de E, aucune allocation.
 */
export function setSuspended(on) {
  const n = E.count;
  let k = 0;
  if (on) {
    suspended = 1;
    eyeMode = 1;
    for (let i = 0; i < n; i++) {
      if (E.alive[i] === 0 || E.type[i] === BOSS_T) continue;
      E.sus[i] = 1;
      E.flags[i] &= ~F_CARRY_STRIP;
      E.state[i] = 0;
      E.vx[i] = 0;
      E.vz[i] = 0;
      E.kx[i] = 0;
      E.kz[i] = 0;
      E.glow[i] = 0;
      E.far[i] = 0;
      k++;
    }
    suspendedTotal = k;
  } else {
    suspended = 0;
    eyeMode = 0;
    for (let i = 0; i < n; i++) {
      if (E.sus[i] === 0) continue;
      E.sus[i] = 0;
      k++;
    }
  }
  applyEyes();
  return k;
}

/**
 * § E4.F.2 — fin de vague (T5) : chaque vivant hors boss part en REPLI (E.sus = 1) — intouchable, sans contact ni tir,
 * pas une cible, yeux éteints ; enemies.update le fait courir vers le bord du champ le plus proche en s'éloignant du héros,
 * puis le GARE (E.sus = 2) une fois hors champ. Un robot déjà hors champ est garé tout de suite. Drapeaux d'événement
 * retirés, ELITE et NO_LOOT gardés (§ E3.K bis). Renvoie le nombre de robots partis. Hors combat (une fois par vague).
 */
export function beginRetreat() {
  const n = E.count;
  let k = 0;
  parkedOff = 0;
  retreatLate = 0;
  for (let i = 0; i < n; i++) {
    if (E.alive[i] === 0 || E.type[i] === BOSS_T) continue;
    E.sus[i] = 1;
    E.ent[i] = 0;
    E.flags[i] &= ~F_CARRY_STRIP;
    E.state[i] = 0;
    E.vx[i] = 0;
    E.vz[i] = 0;
    E.kx[i] = 0;
    E.kz[i] = 0;
    E.glow[i] = 0;
    E.far[i] = 0;
    E.retT[i] = 0;
    if (horsChamp(i)) {
      E.sus[i] = 2;
      parkedOff++;
    }
    k++;
  }
  retreatTotal = k;
  suspendedTotal = k;
  eyeMode = 2;
  applyEyes();
  return k;
}

/** § E4.F.3 : vrai quand plus aucun robot n'est en repli (tous garés, ou aucun). Parcours de E, sans allocation. */
export function retreatDone() {
  const S = E.sus;
  const A = E.alive;
  for (let i = 0; i < E.count; i++) if (S[i] === 1 && A[i] === 1) return false;
  return true;
}

/**
 * § E4.F.4 — départ de la vague suivante : les yeux reprennent la teinte de leur révision (les garés ne sont pas dessinés ;
 * un revenant entre dans le champ yeux allumés). Appelé par waves.startWave.
 */
export function endRetreat() {
  eyeMode = 0;
  suspended = 0;
  applyEyes();
}

/**
 * Le robot i est-il hors du champ de jeu (camera.view, recul maximum) ? Rectangle élargi de son rayon + REPLI.margin, et
 * vers le bas de sa hauteur (un robot haut dépasse dans l'écran depuis le bas), comme waves.pickSpawnPoint. Lit les
 * tableaux : aucun flottant passé en argument (§ V).
 */
function horsChamp(i) {
  const vx = E.x[i] - view.targetX;
  const vz = E.z[i] - view.targetZ;
  const a = vx * view.rightX + vz * view.rightZ;
  const b = vx * view.upX + vz * view.upZ;
  const m = E.radius[i] + REPLI.margin;
  const A1 = view.halfW + m;
  return a < -A1 || a > A1 || b > view.halfD + m || b < -(view.prochD + m + tallOf[E.type[i]] * view.groundPerHeight); // § E5.AB.12 : bas = prochD
}

/**
 * § E4.F.4 — un reporté garé rentre : posé au point (ARGF[F_X], ARGF[F_Z]) tiré hors écran par waves, E.sus = 0. Il
 * garde PV, drapeaux (ELITE, NO_LOOT), fusion et rareté ; état et minuteries à 0 ; pas de « recompilation » d'apparition
 * (E.anim = fin du fondu d'apparition) : il ARRIVE en marchant. E.ent = 1 : son et lueur à son entrée dans le champ.
 */
export function reenterF(i) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  E.x[i] = x;
  E.z[i] = z;
  E.vx[i] = 0;
  E.vz[i] = 0;
  E.kx[i] = 0;
  E.kz[i] = 0;
  E.flash[i] = 0;
  E.flashRest[i] = 0;
  E.glow[i] = 0;
  E.anim[i] = COMMON.spawnFadeSeconds;
  E.timer[i] = 0;
  E.cd[i] = 0;
  E.atkCd[i] = 0;
  E.ai0[i] = 0;
  E.ai1[i] = 0;
  E.far[i] = 0;
  E.retT[i] = 0;
  E.state[i] = 0;
  E.rev0[i] = 0;
  E.rot[i] = Math.atan2(P.x - x, P.z - z);
  E.sus[i] = 0;
  E.ent[i] = 1;
  returned++;
}

/**
 * § E4.F.2 — tirs en vol à la fin de vague : sans effet pendant s secondes, ils rétrécissent jusqu'à 0, puis le pool est
 * vidé (au lieu de clearProjectiles : plus de disparition d'un coup).
 */
export function fadeProjectiles(s) {
  if (pCount === 0) return;
  RF[0] = s;
  RF[1] = s;
}

/** § E3.K : 1 entre setSuspended(true) et setSuspended(false). */
export function isSuspended() {
  return suspended === 1;
}

/**
 * § E3.K règle 3 — plafond des reportés. Si plus de `cap` robots sont en vie, les excédents sont FUSIONNÉS deux à deux
 * par type (jamais supprimés) : le survivant prend les PV, les PV max et le bouclier de l'autre, ses dégâts deviennent
 * (A + B) × CARRY.mergeDmgMul, son corps grandit (CARRY_SCALE[E.merged]) ; l'absorbé meurt en lot (mort de la purge :
 * voxels, ni kill, ni butin — § E3.0.5 règle 1). Passes successives (un fusionné peut l'être de nouveau) jusqu'à
 * tenir le plafond. Élites porteuses et boss exclus. Renvoie le nombre de corps absorbés.
 */
export function mergeExcessF(cap, silent = false) {
  const excess = E.aliveCount - cap;
  if (excess <= 0) return 0;
  // § E4.F.3 : silent = fusion des robots GARÉS (hors champ) — ni voxels ni anneaux de purge, l'absorbé est retiré sans bruit
  if (!silent) fx.beginPurge(excess);
  const flags = silent ? DMG.PURGE | DMG.NO_LOOT | DMG.SILENT : DMG.PURGE | DMG.NO_LOOT;
  const types = ENEMIES.types;
  let done = 0;
  for (let pass = 0; pass < 16 && done < excess; pass++) {
    pend.fill(-1);
    let made = 0;
    for (let i = 0; i < E.count && done < excess; i++) {
      if (E.alive[i] === 0) continue;
      const t = E.type[i];
      if (t === BOSS_T || (E.flags[i] & EFLAG.ELITE) !== 0) continue;
      const j = pend[t];
      if (j < 0) {
        pend[t] = i;
        continue;
      }
      E.hp[j] += E.hp[i];
      E.maxHp[j] += E.maxHp[i];
      E.shield[j] += E.shield[i];
      // § E4.P : bouclier du blindé fissuré si l'un des deux l'était, ou si les PV sommés sont sous le seuil (collant)
      if (t === ENEMY.BLINDE && (E.fis[i] !== 0 || E.hp[j] <= BLINDE_SEUIL * E.maxHp[j])) E.fis[j] = 1;
      E.dmg[j] = (E.dmg[j] + E.dmg[i]) * CARRY.mergeDmgMul;
      E.mul[j] = (E.mul[j] + E.mul[i]) * CARRY.mergeDmgMul;
      let m = E.merged[j] + E.merged[i] + 1;
      if (m > 255) m = 255;
      E.merged[j] = m;
      E.radius[j] = types[t].radius * CARRY_SCALE[m];
      ARGF[F_DX] = 0;
      ARGF[F_DZ] = 0;
      damage.killEnemyF(i, flags);
      pend[t] = -1;
      done++;
      made++;
    }
    if (made === 0) break;
  }
  mergedTotal += done;
  return done;
}

/**
 * Traînard replacé (§ E1.A règle 5) : le robot i est posé au point (ARGF[F_X], ARGF[F_Z]). Il garde ses PV, son
 * ralentissement et ses drapeaux ; son état, ses minuteries et E.anim repartent de 0 (il se « recompile » : ligne de
 * scan de PROGRAMME.apparition), comme à sa création.
 */
export function relocateF(i) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  E.x[i] = x;
  E.z[i] = z;
  E.vx[i] = 0;
  E.vz[i] = 0;
  E.kx[i] = 0;
  E.kz[i] = 0;
  E.flash[i] = 0;
  E.flashRest[i] = 0;
  E.glow[i] = 0;
  E.anim[i] = 0;
  E.timer[i] = 0;
  E.cd[i] = 0;
  E.atkCd[i] = 0;
  E.ai0[i] = 0;
  E.ai1[i] = 0;
  E.ai2[i] = 0;
  E.ai3[i] = 0;
  E.far[i] = 0;
  E.state[i] = 0;
  E.rev0[i] = 0; // manœuvre et compte de tirs d'une révision (§ E1.B) ; E.shield et E.rev1 (bulle) sont gardés
  E.rot[i] = Math.atan2(P.x - x, P.z - z);
}

/** Retrouve un robot vivant par son identité stable (parcours linéaire : cas rares seulement). */
export function findByUid(uid) {
  const U = E.uid;
  for (let i = 0; i < E.count; i++) {
    if (U[i] === uid && E.alive[i] === 1) return i;
  }
  return -1;
}

/** S13 : compaction des morts, par échange avec le dernier emplacement, parcours descendant. */
export function flushDead() {
  if (E.aliveCount === E.count) return;
  const ALIVE = E.alive;
  const f = E.f32;
  const u8 = E.u8;
  const u32 = E.u32;
  for (let i = E.count - 1; i >= 0; i--) {
    if (ALIVE[i] === 1) continue;
    const last = E.count - 1;
    if (i !== last) {
      for (let k = 0; k < f.length; k++) f[k][i] = f[k][last];
      for (let k = 0; k < u8.length; k++) u8[k][i] = u8[k][last];
      for (let k = 0; k < u32.length; k++) u32[k][i] = u32[k][last];
      if (E.bossIndex === last) E.bossIndex = i;
    }
    E.count = last;
  }
}

// ----- Écriture des instances (F11) --------------------------------------------------------------------------------

export function sync() {
  cursor.fill(0);
  const n = E.count;
  let nb = 0; // bulles-boucliers écrites
  if (n > 0) {
    const X = E.x, Z = E.z, ANIM = E.anim, FLASH = E.flash, GLOW = E.glow;
    const TYPE = E.type, ALIVE = E.alive, SHIELD = E.shield, SUS = E.sus;
    const fadeInv = 1 / COMMON.spawnFadeSeconds;
    for (let i = 0; i < n; i++) {
      if (ALIVE[i] === 0 || SUS[i] === 2) continue; // § E4.F : un robot garé n'est pas dessiné (même règle dans allure.sync)
      const t = TYPE[i];
      if (t === BOSS_T) continue; // boss.sync place son maillage dédié
      if (SHIELD[i] > 0 && nb < BUBBLE_CAP) {
        // Bulle-bouclier (§ E1.B) : icosaèdre filaire autour du robot, qui tourne ; elle naît en grandissant et pâlit
        // dans sa dernière demi-seconde. Matrice écrite en ligne (rotation autour de Y, échelle uniforme).
        const left = E.rev1[i];
        const age = BULLE.shieldSeconds - left;
        let s = E.radius[i] * BULLE.bubbleScale;
        if (age < 0.15) s *= 0.4 + 4 * age;
        const a = ANIM[i] * BULLE.bubbleSpin;
        const c = Math.cos(a) * s;
        const sn = Math.sin(a) * s;
        const o = nb * 16;
        bubbleMat[o] = c;
        bubbleMat[o + 1] = 0;
        bubbleMat[o + 2] = -sn;
        bubbleMat[o + 3] = 0;
        bubbleMat[o + 4] = 0;
        bubbleMat[o + 5] = s;
        bubbleMat[o + 6] = 0;
        bubbleMat[o + 7] = 0;
        bubbleMat[o + 8] = sn;
        bubbleMat[o + 9] = 0;
        bubbleMat[o + 10] = c;
        bubbleMat[o + 11] = 0;
        bubbleMat[o + 12] = X[i];
        bubbleMat[o + 13] = centerY[t];
        bubbleMat[o + 14] = Z[i];
        bubbleMat[o + 15] = 1;
        const g = BULLE.bubbleGain * Math.min(left * 2, 1); // (pas de « ? : » qui mêle un flottant et l'entier 1 : § V)
        const q = nb * 3;
        bubbleCol[q] = g;
        bubbleCol[q + 1] = g;
        bubbleCol[q + 2] = g;
        nb++;
      }
      // élite à modèle élite (place libre) : emplacement ENEMY_COUNT + t — même règle, même ordre que allure.sync
      const s = allure.ELITE_MODELE[t] === 1 && (E.flags[i] & EFLAG.ELITE) !== 0 && cursor[t + ENEMY_COUNT] < allure.ELITE_CAP ? t + ENEMY_COUNT : t;
      const k = cursor[s]++;
      if (t === DRONE_T && droneShadowArr !== null) {
        // ombre factice du drone : à plat sur le sol, sous lui (même rang d'instance que le drone)
        let u = ANIM[i] * fadeInv;
        u = u >= 1 ? 1 : u * (2 - u);
        const d = droneShadowArr;
        const o = k * 16;
        d[o] = u;
        d[o + 1] = 0;
        d[o + 2] = 0;
        d[o + 3] = 0;
        d[o + 4] = 0;
        d[o + 5] = 1;
        d[o + 6] = 0;
        d[o + 7] = 0;
        d[o + 8] = 0;
        d[o + 9] = 0;
        d[o + 10] = u;
        d[o + 11] = 0;
        d[o + 12] = X[i];
        d[o + 13] = DRONE_SHADOW_Y;
        d[o + 14] = Z[i];
        d[o + 15] = 1;
      }
      const f = fxArr[s];
      //#region e5:M-dangers-guide
      // § E5.M (B4) : un tireur qui vise et un kamikaze dont la mèche brûle annoncent par leur lueur ; le flash blanc
      // d'impact (diffus → blanc + émissif blanc dans le shader peint) la recouvrait. Ici la lueur passe devant.
      //#endregion
      //#region e5:N-combat-guide
      // § E5.N (point 7, Femz 21/11 : voir le coup porter) : à lueur g, le flash garde (1 − g × part) de son intensité et
      // seulement la tête de sa courbe (plus court) ; sans lueur, le flash d'origine. Flottants seuls (§ V).
      if (annonceType[t] === 1) {
        const fl = FLASH[i];
        const g = GLOW[i];
        const tete = Math.max(fl - AN[0], 0) * AN[1];
        f[k * 2] = fl + (tete * (1 - g * AN[2]) - fl) * g;
      } else f[k * 2] = FLASH[i];
      if (CF.reduits) f[k * 2] *= CF.flashBlanc; // § E5.X5 : flash blanc atténué
      //#endregion
      f[k * 2 + 1] = GLOW[i];
      //#region e5:M-dangers-guide
      // § E5.M (B7) : mèche allumée → zone de son souffle au sol (vrai rayon), centrée sur lui, qui se remplit jusqu'à
      // l'explosion (même dessin que les zones des robots, hazards.annonceDisqueF)
      // § E5.M (B8) : rôdeur v2 accroupi → trait au sol dans l'axe du bond (largeur du corps, longueur du bond), qui se
      // remplit sur l'accroupi ; pendant le bond, il ne reste que le chemin encore à parcourir (comme le piqué du drone)
      if (t === RODEUR_T && rev[RODEUR_T] >= 1 && (E.state[i] === M_WARN || E.state[i] === M_GO)) {
        const warn = E.state[i] === M_WARN;
        ARGF[F_X] = X[i];
        ARGF[F_Z] = Z[i];
        ARGF[F_DX] = E.radius[i];
        // (Math.max plutôt qu'un « ? : » qui mêle un flottant et un entier littéral : § V)
        ARGF[F_DZ] = warn ? BOND.leap : BOND_V * Math.max(E.timer[i], 0);
        ARGF[F_SX] = E.rev0[i];
        ARGF[F_T] = Math.min(Math.max(1 - E.timer[i] * CROUCH_INV_M, 0), 1);
        if (!warn) ARGF[F_T] = 1;
        hazards.traitF();
      }
      //#region e5:X8-lot8
      // § E5.X8 (G5) : tireur qui vise → trait fin dans l'axe de son canon, depuis la bouche, pendant la visée (un trait
      // des décalques « traits-robots » : aucun appel de dessin de plus)
      if (t === TIREUR_T && E.state[i] === S_AIM && E.timer[i] > 0) {
        const a = E.rot[i];
        ARGF[F_X] = X[i] + Math.sin(a) * RANGED.muzzle;
        ARGF[F_Z] = Z[i] + Math.cos(a) * RANGED.muzzle;
        ARGF[F_DX] = X8[1];
        ARGF[F_DZ] = X8[2];
        ARGF[F_SX] = a;
        ARGF[F_T] = -1;
        ARGF[F_V] = X8[3];
        hazards.traitF();
        X8_COMPTES[3]++;
      }
      //#endregion e5:X8-lot8
      if (t === KAMIKAZE_T && E.state[i] === K_FUSE) {
        ARGF[F_X] = X[i];
        ARGF[F_Z] = Z[i];
        ARGF[F_DX] = BOOM.radius;
        ARGF[F_T] = 1 - E.timer[i] / Math.max(E.ai1[i], 1e-3);
        hazards.disqueKamikazeF(); // § E5.N (point 6) : maillage à lui, jamais deux couches (était annonceDisqueF, § E5.M)
      }
      //#endregion
    }
  }
  // Matrices et attribut aGait : src/anim/allure.js (étape « animations », § Z sexies) — pas couplé à la vitesse réelle,
  // rebond, balancement, écrasement au pas, coup reçu avec poids, apparition, gestes du drone, du tireur, du kamikaze et
  // du réparateur ; mêmes robots dans le même ordre que la boucle ci-dessus (même curseur par type).
  allure.sync();
  for (let t = 0; t < ENEMY_COUNT; t++) {
    if (t !== BOSS_T) render.commit(meshes[t], cursor[t]);
    if (meshes[ENEMY_COUNT + t] !== null) render.commit(meshes[ENEMY_COUNT + t], cursor[ENEMY_COUNT + t]); // élites
  }
  if (droneShadowMesh !== null) render.commit(droneShadowMesh, cursor[DRONE_T]);
  bubblesShown = nb;
  render.commit(bubbleMesh, nb);

  // Tirs ennemis : § E4.J, ancien visuel (avant l'étape « vfx » du 14/11) — maillage « tirs-ennemis » de src/tirs-canon.js,
  // échelle uniforme = rayon de collision (la tête palpite), le nez dans le sens de la vitesse (matrice d'avant-vfx).
  // § E4.F.2 : extinction de fin de vague (rétrécissement) gardée. Le lot ENNEMIS ne garde que les rayons des scanners.
  const va = VFXP.tampon(LOT_ENNEMIS);
  const vcap = VFXP.capacite(LOT_ENNEMIS);
  let vn = 0;
  TC.N[0] = 0;
  if (pCount > 0) {
    const m = TC.tampon();
    const mcap = TC.capacite();
    const Pj = ENEMIES.projectile;
    const y = Pj.height;
    const pulseW = Pj.pulseHz * TWO_PI;
    const pulseAmp = Pj.pulseAmp;
    const shrink = RF[0] > 0 ? RF[0] / RF[1] : 1; // § E4.F.2 : extinction de fin de vague (rétrécissement)
    let n = 0;
    for (let k = 0; k < pCount && n < mcap; k++) {
      const o = n * 16;
      n++;
      const vx = pVX[k];
      const vz = pVZ[k];
      const l = Math.sqrt(vx * vx + vz * vz);
      const r = pR[k] * (1 + pulseAmp * Math.sin(pLife[k] * pulseW)) * shrink;
      const c = l > 1e-6 ? (vz / l) * r : r; // cos(rot) × r, rot = atan2(vx, vz)
      const sn = l > 1e-6 ? (vx / l) * r : 0;
      m[o] = c;
      m[o + 1] = 0;
      m[o + 2] = -sn;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = r;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = sn;
      m[o + 9] = 0;
      m[o + 10] = c;
      m[o + 11] = 0;
      m[o + 12] = pX[k];
      m[o + 13] = y;
      m[o + 14] = pZ[k];
      m[o + 15] = 1;
    }
    TC.N[0] = n;
  }
  vn = e3.syncBeamsF(va, vn, vcap, VFX_STRIDE); // § E3.D : rayons des scanners en balayage
  e3.syncArcsF(); // § E5.M (B10) : arc annoncé des scanners (décalques de hazards.js)
  VFXP.compte[LOT_ENNEMIS] = vn;
}

export function inspect(out) {
  out.alive = E.aliveCount;
  out.slots = E.count;
  const byType = {};
  for (let t = 0; t < ENEMY_COUNT; t++) byType[ENEMY_KEYS[t]] = E.aliveByType[t];
  out.byType = byType;
  out.bossIndex = E.bossIndex;
  out.projectiles = pCount;
  // Ajouts du lot enemies (les champs ci-dessus sont ceux du contrat, § J.3)
  let aiming = 0;
  let fusing = 0;
  for (let i = 0; i < E.count; i++) {
    if (E.alive[i] === 0) continue;
    if (E.type[i] === TIREUR_T && E.state[i] === S_AIM) aiming++;
    else if (E.type[i] === KAMIKAZE_T && E.state[i] === K_FUSE) fusing++;
  }
  out.aiming = aiming; // tireurs en train de viser (lueur du télégraphe)
  out.fusing = fusing; // kamikazes à la mèche allumée
  out.shots = shotsFired; // tirs des tireurs depuis le reset
  out.visesHorsEcran = horsEcran; // § E5.M (B12) : visées abandonnées hors du champ visible
  out.detonations = detonations; // kamikazes arrivés au bout de leur mèche
  out.healPulses = healPulses; // impulsions de soin qui ont soigné quelqu'un
  out.healed = healedHp[0]; // PV rendus par les réparateurs
  // Révisions v2 / v3 (§ E1.B)
  const r = {};
  for (let t = 0; t < ENEMY_COUNT; t++) if (t !== BOSS_T) r[ENEMY_KEYS[t]] = rev[t];
  out.revisions = r; // révision de chaque type pour la vague en cours (0 = v1)
  out.salvos = salvos;
  out.shells = shells;
  out.dives = dives;
  out.leaps = leaps;
  out.chains = chains;
  out.chained = chained;
  out.charges = charges;
  out.bubblePulses = bubblePulses;
  out.bubbled = bubbled;
  out.puddles = puddles;
  //#region e5:AC-contact
  const cm = COUPS_MELEE;
  out.coupsMelee = { gestes: cm[0], portes: cm[1], rates: cm[2], tenus: cm[3], sons: cm[4], eclairs: cm[5], manoeuvres: cm[6] }; // § E5.AC
  //#endregion e5:AC-contact
  let maneuvering = 0;
  let shielded = 0;
  for (let i = 0; i < E.count; i++) {
    if (E.alive[i] === 0) continue;
    if (maneuver[E.type[i]] === 1 && E.state[i] !== M_NONE) maneuvering++;
    if (E.shield[i] > 0) shielded++;
  }
  out.maneuvering = maneuvering; // drones, rôdeurs, blindés en annonce ou en manœuvre
  out.shielded = shielded; // robots sous bulle
  out.bubblesShown = bubblesShown;
  out.peakProjectiles = peakProjectiles;
  out.modeles = modeles; // types dont le modèle Blender est posé (6 attendus, § Z quinquies)
  out.e3 = e3.inspect({}); // § E3.D : foreuses, poseurs, scanners, diviseurs (hors combat : debug et tests)
  // § E3.K : veille et fusion des reportés
  let asleep = 0;
  let fused = 0;
  let maxMerged = 0;
  let retreating = 0; // § E4.F
  let parked = 0;
  let entering = 0;
  for (let i = 0; i < E.count; i++) {
    if (E.alive[i] === 0) continue;
    if (E.sus[i] !== 0) asleep++;
    if (E.sus[i] === 1) retreating++;
    else if (E.sus[i] === 2) parked++;
    if (E.ent[i] === 1) entering++;
    if (E.merged[i] !== 0) fused++;
    if (E.merged[i] > maxMerged) maxMerged = E.merged[i];
  }
  out.suspended = suspended === 1;
  out.asleep = asleep; // robots en veille
  out.lastSuspended = suspendedTotal; // robots mis en veille au dernier setSuspended(true)
  // § E4.F : repli puis retour
  out.retreating = retreating; // en repli (E.sus = 1)
  out.parked = parked; // garés (E.sus = 2)
  out.entering = entering; // rentrés, pas encore entrés dans le champ
  out.retreatTotal = retreatTotal; // partis en repli au dernier beginRetreat
  out.parkedOff = parkedOff; // garés d'office (déjà hors champ à T5)
  out.retreatLate = retreatLate; // garés par le garde-fou (encore visibles au bout de REPLI.seconds) — attendu 0
  out.returned = returned; // rentrés depuis le reset
  out.entered = entered; // entrés dans le champ depuis le reset
  out.eyeMode = eyeMode; // 0 normal, 1 veille (debug), 2 repli
  out.projFade = RF[0]; // s d'extinction des tirs en vol restantes
  let drawn = 0;
  for (let t = 0; t < ENEMY_COUNT; t++) if (t !== BOSS_T) drawn += cursor[t] + cursor[ENEMY_COUNT + t]; // + élites
  out.drawn = drawn; // instances de robots écrites au dernier sync (un garé n'en a pas)
  out.mergedBodies = mergedTotal; // corps absorbés par mergeExcessF depuis le reset
  out.fused = fused; // robots vivants issus d'une fusion
  out.maxMerged = maxMerged; // plus grand E.merged en vie
}
