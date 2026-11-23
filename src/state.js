// FONDATION : state.js — DONNÉES partagées du jeu (contrat : ARCHITECTURE.md § E).
// Module de données pur : aucune logique de jeu, aucun DOM, aucun GPU. Seule exception documentée à la règle
// « aucun effet de bord à l'import » : les tableaux typés sont alloués ici, une fois pour toutes.
import { CAPS, ENEMY_COUNT, PLAYER, PROGRESSION, xpForLevel } from './config.js';
import { COMBAT_GUIDE } from './config.js'; // § E5.N (B5) : rayon de dégâts du héros

const CAP = CAPS.enemies;

// ----- E : les robots, en structure de tableaux (emplacements utilisés : [0, E.count), denses) ---------------
const f32 = [];
const u8 = [];
const u32 = [];
function F() {
  const a = new Float32Array(CAP);
  f32.push(a);
  return a;
}
function B() {
  const a = new Uint8Array(CAP);
  u8.push(a);
  return a;
}
function U() {
  const a = new Uint32Array(CAP);
  u32.push(a);
  return a;
}

export const E = {
  cap: CAP,
  count: 0, // emplacements utilisés (morts en attente de compaction compris)
  aliveCount: 0,
  aliveByType: new Uint16Array(ENEMY_COUNT),
  bossIndex: -1,
  // Drones-boucliers du boss en vie (§ E1.D) : tant qu'il en reste un, damage.hitEnemyF ne retire rien au boss.
  // Entier recompté par boss.update (S6) ; 0 sans boss.
  bossShield: 0,
  nextUid: 1,
  x: F(),
  z: F(),
  vx: F(),
  vz: F(),
  kx: F(), // recul (m/s), amorti
  kz: F(),
  rot: F(),
  radius: F(),
  hp: F(),
  maxHp: F(),
  dmg: F(),
  mul: F(),
  speed: F(),
  slow: F(),
  slowT: F(),
  flash: F(),
  flashRest: F(), // s — intégration : pause après un flash, pendant laquelle un coup ne rallume pas le robot
  glow: F(),
  anim: F(),
  timer: F(),
  cd: F(),
  atkCd: F(),
  orbitCd: F(),
  ai0: F(),
  ai1: F(),
  ai2: F(),
  ai3: F(),
  // Étape 1 du plan addictif (§ E1.0). Tous vidés par la boucle f32 de enemies.spawn.
  rev0: F(), // minuteries et valeurs des révisions v2 / v3 (chantier B ; ai0…ai3 sont pris)
  rev1: F(),
  shield: F(), // PV de bouclier temporaire, absorbés avant E.hp (chantier B)
  far: F(), // s passées hors du champ élargi (traînards replacés devant le héros, § E1.A règle 5)
  // Étape 2, chantier F (§ E2.F) : statuts posés par les objets passifs — dégâts par seconde et secondes restantes.
  dot0: F(), // virus : PV par seconde
  dotT0: F(), // virus : s restantes
  dot1: F(), // feu : PV par seconde
  dotT1: F(), // feu : s restantes
  retT: F(), // § E4.F : s de repli écoulées (E.sus = 1) ; garé (E.sus = 2) au départ de la vague : s avant son retour
  // § E4.H : petite barre de vie des gros robots (src/barres-vie.js) — traîne, sa vitesse, maintien, part d'avant, visibilité
  barT: F(),
  barV: F(),
  barH: F(),
  barF: F(),
  barA: F(),
  fente: F(), // § E5.AC : s écoulées depuis le début du coup de mêlée (0 = aucun) ; lu par allure (fente dessinée)
  fis: F(), // § E4.P : bouclier du blindé fissuré (1) ou intact (0) ; collant ; lu par damage et par allure (aGait.w)
  recup: F(), // § E5.X8 (E8) : s de récupération restantes après une manœuvre (immobile, sans contact, yeux éteints)
  type: B(),
  alive: B(),
  state: B(),
  flags: B(), // masque EFLAG.* ; remis à 0 par enemies.spawn (les tableaux u8 n'y sont pas vidés en boucle)
  rarity: B(), // § E2.G bis : rareté d'une élite porteuse (lue seulement avec EFLAG.ELITE ; écrite par makeCarrierF)
  mod: B(),
  gen: B(),
  merged: B(),
  sus: B(), // § E3.K / § E4.F : 0 en jeu, 1 repli (ou veille du debug), 2 garé (vivant, ni dessiné ni mis à jour)
  ent: B(), // § E4.F.4 : reporté rentré, pas encore entré dans le champ (son et lueur à l'entrée)
  uid: U(),
  // Listes de TOUS les tableaux par emplacement : flushDead copie un emplacement sans les nommer.
  f32,
  u8,
  u32,
};

/**
 * Cibles prioritaires (§ E1.D) : PRIO[0] = nombre, PRIO[1…] = indices dans E des robots EFLAG.PRIORITY en vie (les
 * drones-boucliers du boss). Écrit par boss.update (S6), lu par les armes (S8) : les indices valent jusqu'à la
 * compaction de fin d'image (S13).
 */
export const PRIO = new Int16Array(1 + 8);

// ----- P : le joueur -------------------------------------------------------------------------------------------
export const P = {
  x: 0,
  z: 0,
  vx: 0,
  vz: 0,
  rot: 0,
  moveX: 0, // dernière direction de déplacement non nulle, unitaire (player.reset : haut de l'écran)
  moveZ: -1,
  hp: PLAYER.maxHp,
  maxHp: PLAYER.maxHp,
  radius: PLAYER.radius,
  // § E5.N (B5, Femz 21/11) : rayon de DÉGÂTS (tirs, explosions, zones, boss, foreuse, scanner) ; radius garde décors,
  // déplacement, poussée, coup au contact. Né flottant (jamais un entier dans P, § E5.X).
  rayonDegats: COMBAT_GUIDE.heros.rayonDegats,
  alive: true,
  dashT: 0,
  dashCd: 0,
  dashDirX: 0,
  dashDirZ: -1,
  invulnT: 0,
  strikeReq: 0, // 16/11 (point 3) : s restantes de la demande de frappe éclair (touche A / E, gardée STRIKE_KEYS.bufferSeconds)
  dashReq: 0, // § E5.X6 (D3) : s restantes de la demande de dash (gardée ACTIONS_IMPOSSIBLES.dash.tampon)
};

// ----- run : la partie en cours --------------------------------------------------------------------------------
export const run = {
  wave: 0,
  time: 0,
  kills: 0,
  fragments: 0,
  level: PROGRESSION.startLevel,
  xp: 0,
  xpToNext: xpForLevel(PROGRESSION.startLevel),
  pendingChoices: 0,
  seed: 1,
  agent: 0, chests: 0, rerolls: 2, skips: 1, banishes: 1,
  carried: 0, // § E3.K : robots reportés de la vague précédente au départ de la vague en cours (écrit par waves.startWave)
  evolved: 0, // § E3.B : évolutions obtenues dans la partie (écrit par evolutions.apply, remis à 0 par evolutions.reset)
  fusions: 0, // § E3.F : fusions d'objets faites dans la partie (items.fuse ; remis à 0 par items.reset)
};

// ----- mods : modificateurs des bonus passifs (écrits par progression seulement) --------------------------------
export const mods = {
  maxHpAdd: 0,
  moveSpeedMul: 1,
  pickupRadiusMul: 1, // § E5.Z : plus aucune carte ne l'écrit (rayon de base 7 m) ; gardé pour la fiche et les talents
  xpGainMul: 1, // § E5.Z : XP de chaque gemme ramassée (carte Apprentissage) — lu par progression.addGemXpF
  critChanceAdd: 0,
  regenPerSec: 0,
  dashCdMul: 1,
  areaMul: 1,
  damageMul: 1,
  fireRateMul: 1,
  damageTakenMul: 1,
  // Passifs des agents (§ E2.D) : écrits par agents.js, lus par damage.hitEnemyF et agents.onModsChanged
  critDashCut: 0, // s retirées à la recharge du dash par coup critique (Réflexe)
  critNear: 0, // chance de critique ajoutée sur un robot proche du héros (Frappe de l'ombre)
  resistToDamage: 0, // part des dégâts non reçus convertie en dégâts (Conversion)
  // Objets passifs (§ E2.F) : écrits par items.js seulement
  critMulAdd: 0, // ajouté à PLAYER.critMul (Viseur thermique) — lu par damage.hitEnemyF
  berserk: 0, // cadence en plus à 0 PV (Berserk) — lu par weapons.update
  fragmentMul: 1, // valeur d'un fragment ramassé (Aimant à fragments) — lu par pickups
  luck: 0, // chance qu'un lot de coffre monte d'un rang (Puce de chance) — lu par chests
};
export const BANS = { weapons: new Uint8Array(24), items: new Uint8Array(32), bonuses: new Uint8Array(16) };

// ----- Registre des arguments flottants (correction du 14/11/2026, ARCHITECTURE.md § Z nonies) --------------------
// Les appels PAR COUP et PAR ÉVÉNEMENT (dégâts, recul, ralentissement, étincelle, chiffre, son) passaient leurs
// positions et leurs montants en arguments : V8 emballe chaque flottant passé à une fonction qu'il n'a pas mise en
// ligne (12 octets, § V), ≈ 1 Ko par image en charge maximale. Ces appels lisent maintenant leurs flottants ici :
// l'appelant écrit les cases, l'appelé les recopie dans ses variables locales À SON ENTRÉE, avant tout autre appel
// (qui peut réécrire le registre). Aucune valeur n'y survit d'un appel à l'autre.
export const F_X = 0; // position x (m)
export const F_Z = 1; // position z (m)
export const F_V = 2; // valeur : dégâts, impulsion, facteur de ralentissement
export const F_SX = 3; // source du coup x
export const F_SZ = 4; // source du coup z
export const F_DX = 5; // direction x
export const F_DZ = 6; // direction z
export const F_T = 7; // durée (s)
/**
 * § E5.X (Femz, 20/11 soir) : [0] = réserve du Pare-feu restante / PAREFEU_RESERVE.pv quand il est chargé, −1 sinon
 * (écrit par items.js, lu par barres-vie.js). Tableau typé et PAS un champ de P : une valeur fractionnaire dans un
 * champ de P né entier change la représentation du champ et désoptimise tout le code qui lit P (mesuré : 2,4 Ko par
 * image dans props.update et player.update pendant des coups absorbés, e5-X-parefeu-reserve partie 3).
 */
export const PAREFEU_F = new Float32Array([-1]);

//#region e5:Q-retours-guide
/**
 * § E5.Q (B14) : soin du héros (src/soin-heros.js). SOIN_HEROS : [0] PV rendus pas encore signalés (écrit par
 * player.heal et la bulle du Bastion), [1] s avant le prochain signal, [2] s de lueur verte restantes (heros-anim),
 * [3] PV signalés de la partie. SOIN_SIGNAUX : [0] signaux depuis le chargement (ui.js relance l'éclat de la barre quand
 * il change), [1] de la partie, [2] 1 = soin-heros a du travail (posé par qui soigne ; entier : le repos ne lit aucun
 * flottant). Ici (et non dans soin-heros.js) : ui.js n'importe que config.js et state.js.
 */
export const SOIN_HEROS = new Float64Array(4);
export const SOIN_SIGNAUX = new Uint32Array(3);
//#endregion e5:Q-retours-guide
export const ARGF = new Float64Array(8);
// § E5.X6 (lot 7 : le jeu dit quand une action est impossible) — compteurs d'appuis refusés, lus par le HUD (ui.js),
// la bulle (consignes.js) et les tests : [0] Frappe éclair en recharge (weapons-agents.js), [1] dash en recharge
// (player.js), [2] touche de frappe sans la Frappe éclair (weapons-agents.js). Entiers : rien d'alloué.
export const REFUS_X6 = new Int32Array(3);

export function resetMods() {
  mods.maxHpAdd = 0;
  mods.moveSpeedMul = 1;
  mods.pickupRadiusMul = 1;
  mods.xpGainMul = 1; // § E5.Z
  mods.critChanceAdd = 0;
  mods.regenPerSec = 0;
  mods.dashCdMul = 1;
  mods.areaMul = 1;
  mods.damageMul = 1;
  mods.fireRateMul = 1;
  mods.damageTakenMul = 1;
  mods.critDashCut = 0;
  mods.critNear = 0;
  mods.resistToDamage = 0;
  mods.critMulAdd = 0; // § E2.F
  mods.berserk = 0;
  mods.fragmentMul = 1;
  mods.luck = 0;
}

// ----- Hasard : trois flux mulberry32 (aucune fermeture, aucune allocation) ----------------------------------------
// États dans un tableau typé : un entier de 32 bits ne tient pas toujours dans un petit entier de V8, et une
// variable de module qui le reçoit coûterait alors un nombre alloué à chaque tirage (§ V).
const SIM = 0; // rand() : simulation (combat, butin, positions)
const WAVE = 1; // randWave() : réservé à waves (composition, vague spéciale, mélange)
const EVENT = 2; // randEvent() : événements de vague et soldes (étape 1 du plan addictif, § E1.0)
const EVENT_SALT = 0x85ebca6b;
const seeds = new Int32Array(3);
seeds[SIM] = 1;
seeds[WAVE] = 1 ^ 0x9e3779b9;
seeds[EVENT] = 1 ^ EVENT_SALT;

/**
 * Tirage brut du flux de la simulation : entier dans [0, 2^30), donc un petit entier de V8 (jamais emballé).
 * Correction du 14/11/2026 (§ Z nonies) : rand() rendait un flottant ; appelée par des fonctions trop grosses pour
 * la mettre en ligne (fx.burst, les essais d'impact…), chaque tirage allouait le nombre rendu (≈ 790 o/image mesurés
 * en charge maximale). rand() n'est plus qu'une multiplication autour de randU() : assez petite pour être TOUJOURS
 * mise en ligne par V8, le flottant naît dans la fonction appelante, sans boîte.
 */
export function randU() {
  const s = (seeds[SIM] + 0x6d2b79f5) | 0;
  seeds[SIM] = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 2;
}

/** [0, 1) — hasard de la SIMULATION (pas de 2^-30). */
export function rand() {
  return randU() * 9.313225746154785e-10;
}

/** [a, b) */
export function randRange(a, b) {
  return a + (b - a) * rand();
}

/** Entier dans [a, b], bornes comprises. */
export function randInt(a, b) {
  return a + Math.floor(rand() * (b - a + 1));
}

/** [0, 1) — second flux, réservé à waves. */
export function randWave() {
  const s = (seeds[WAVE] + 0x6d2b79f5) | 0;
  seeds[WAVE] = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * [0, 1) — troisième flux, réservé aux événements de vague et aux soldes (§ E1.0). Le flux randWave() garde ainsi
 * son nombre de tirages par vague : la suite des vagues à graine égale ne change pas.
 */
export function randEvent() {
  const s = (seeds[EVENT] + 0x6d2b79f5) | 0;
  seeds[EVENT] = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Remet les TROIS flux à leur départ. */
export function seedRandom(seed) {
  seeds[SIM] = seed | 0;
  seeds[WAVE] = (seed ^ 0x9e3779b9) | 0;
  seeds[EVENT] = (seed ^ EVENT_SALT) | 0;
}
