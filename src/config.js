// =====================================================================================================
// config.js — TOUS les chiffres d'équilibrage et TOUTES les énumérations du jeu (cahier : SPEC.md).
//
// Règles (contrat : ARCHITECTURE.md, sections U et V) :
//   • Lecture seule à l'exécution : aucun module n'écrit dans un objet de ce fichier.
//   • Un « export const » par domaine. Chaque section appartient à UN lot et tient entre deux lignes
//     repères : « //#region lot:<nom> » et « //#endregion lot:<nom> ». Un lot peut changer les valeurs et
//     AJOUTER des clés dans sa région ; il ne renomme ni ne supprime jamais une clé existante, ne touche
//     ni aux lignes repères ni à ce qui est hors de sa région.
//   • Pour modifier : relire le fichier juste avant, puis remplacer seulement à l'intérieur de sa région
//     (jamais de réécriture complète du fichier : huit lots l'éditent en parallèle). Pendant la phase
//     parallèle, le serveur de test d'un lot sert ce fichier dans son état « fondation » avec la seule
//     région du lot à jour (tests/outils.mjs, ARCHITECTURE.md § U) : les retouches des voisins ne
//     cassent pas ses tests.
//   • Unités : mètres, secondes, radians (les angles en degrés portent le suffixe « Deg »), PV, fragments.
//   • Aucune dépendance, aucun effet de bord : ce module peut être importé par Node (tests, simulations).
//
// Les valeurs sont un premier équilibrage CALCULÉ (node tests/equilibrage.mjs : composition, PV, XP,
// fragments, achats et DPS estimés vague par vague), pas encore joué. L'étape d'intégration (ARCHITECTURE.md
// § U) les ajuste en jouant ; elle seule a le droit de retoucher toutes les régions.
// =====================================================================================================

//#region fondation:enumerations

// -----------------------------------------------------------------------------------------------------
// 0. ÉNUMÉRATIONS — CONTRAT GELÉ (fondation). On peut ajouter une entrée, jamais en renommer ni en retirer.
// -----------------------------------------------------------------------------------------------------

/** États de la machine de main.js. */
export const STATE = Object.freeze({
  TITLE: 'TITLE',
  PLAYING: 'PLAYING',
  LEVELUP: 'LEVELUP',
  WAVE_CLEAR: 'WAVE_CLEAR',
  SHOP: 'SHOP',
  COUNTDOWN: 'COUNTDOWN',
  PAUSED: 'PAUSED',
  GAMEOVER: 'GAMEOVER',
  CHEST: 'CHEST',
  AGENT: 'AGENT',
  FUSION: 'FUSION', // § E3.F : moment de fusion de deux objets (en pause, comme un coffre)
  HUB: 'HUB', // § E4.B : le hub « Noyau » à onglets, ouvert depuis l'écran titre (scène du titre derrière)
});

/** Sous-phases de WAVE_CLEAR. */
export const CLEAR_PHASE = Object.freeze({ VACUUM: 'VACUUM', MERCHANT_IN: 'MERCHANT_IN' });

/** Types de robots : index dans ENEMIES.types et valeur de E.type[i]. */
export const ENEMY = Object.freeze({
  RODEUR: 0,
  DRONE: 1,
  TIREUR: 2,
  KAMIKAZE: 3,
  BLINDE: 4,
  REPARATEUR: 5,
  BOSS: 6,
  FOREUSE: 7, // étape 3, chantier D (§ E3.D) : s'enfouit, resurgit sous le joueur
  POSEUR: 8, // sème des mines qui blessent joueur ET robots
  SCANNER: 9, // tombe du ciel, laser tournant télégraphié
  DIVISEUR: 10, // à sa mort : 3 mini-rôdeurs, qui se scindent une fois encore
});
export const ENEMY_COUNT = 11;
export const ENEMY_KEYS = Object.freeze(['rodeur', 'drone', 'tireur', 'kamikaze', 'blinde', 'reparateur', 'boss', 'foreuse', 'poseur', 'scanner', 'diviseur']);

/** Armes : index dans WEAPONS et dans weapons.owned / weapons.levels. */
export const WEAPON = Object.freeze({
  BLASTER: 0,
  ORBITALS: 1,
  SHOTGUN: 2,
  EMP: 3,
  RAIL: 4,
  ROCKETS: 5,
  // étape 2 du plan addictif, chantier A (§ E2.A) : armes de coffre
  RICOCHET: 6,
  BLADE: 7,
  TURRET: 8,
  // étape 2 du plan addictif, chantier B (§ E2.B) : armes de coffre
  POOL: 9,
  BOOMERANG: 10,
  MINES: 11,
  // étape 3 du plan addictif, chantier N (§ E3.N) : armes des arsenaux du Shinobi et du Bastion
  KATANA: 12,
  GRENADE: 13,
  SMOKE: 14,
  FLASH: 15, // frappe éclair
  CANNON: 16, // grosse tourelle
  HAMMER: 17,
});
export const WEAPON_COUNT = 18;
export const WEAPON_KEYS = Object.freeze(['blaster', 'orbitals', 'shotgun', 'emp', 'rail', 'rockets', 'ricochet', 'blade', 'turret', 'pool', 'boomerang', 'mines', 'katana', 'grenade', 'smoke', 'flash', 'cannon', 'hammer']);

/** Les 5 stats de chaque arme (index dans WEAPONS[w].stats). */
export const STAT = Object.freeze({
  DAMAGE: 0, // dégâts par coup
  RATE: 1, // cadence
  COUNT: 2, // nombre de projectiles
  AREA: 3, // zone ou portée
  SPECIAL: 4, // stat spéciale (perforation, recul, rayon d'explosion…)
});
export const STAT_COUNT = 5;
export const STAT_KEYS = Object.freeze(['damage', 'rate', 'count', 'area', 'special']);
export const STAT_MAX_LEVEL = 5; // niveaux 1 à 5 ; une arme achetée est au niveau 1 partout

/**
 * Source d'un coup porté à un robot : identifiant d'arme (0–5) ou l'une de ces valeurs. Les valeurs se
 * suivent : `source` sert d'index dans damage.dealtBySource / hitsBySource (DMG_SOURCE_COUNT cases).
 * Une source est une arme du joueur si source < WEAPON_COUNT.
 */
// EVENT (étape 1 du plan addictif, § E1.C) : événement de vague (frappe orbitale) — ajouté en fin de liste.
// Étape 2 (§ E2.0.2, chantier A) : renuméroté UNE fois pour laisser 12 cases aux armes (0 à 11 ; 9 à 11 = chantier B).
// ITEM : coup d'un objet passif (chantier F). Une source est du côté du joueur si isPlayerSource(source).
// Étape 3 (§ E3.0.2, chantier N) : renuméroté UNE fois pour 18 armes (0 à 17) ; UTIL : utilitaires du chantier C.
export const DMG_SRC = Object.freeze({ KAMIKAZE: 18, BOSS: 19, DEBUG: 20, EVENT: 21, ITEM: 22, UTIL: 23 });
export const DMG_SOURCE_COUNT = 24;
export const DMG_SOURCE_KEYS = Object.freeze(['blaster', 'orbitals', 'shotgun', 'emp', 'rail', 'rockets', 'ricochet', 'blade', 'turret', 'pool', 'boomerang', 'mines', 'katana', 'grenade', 'smoke', 'flash', 'cannon', 'hammer', 'kamikaze', 'boss', 'debug', 'event', 'item', 'util']);

/** Drapeaux de damage.hitEnemy / damage.explode / damage.killEnemy (masque de bits). */
export const DMG = Object.freeze({
  NONE: 0,
  BYPASS_SHIELD: 1, // contourne le bouclier frontal du blindé (orbitaux, EMP, roquettes)
  NO_CRIT: 2, // pas de jet de critique
  NO_NUMBER: 4, // pas de chiffre de dégâts
  HEAVY: 8, // gros coup : hitstop si ce coup TUE (passé seulement par une arme dont hitstopOnKill est vrai)
  SILENT: 16, // ni son, ni secousse, ni éclats, ni explosion (coup ET mort qui en découle)
  NO_LOOT: 32, // pas de butin à la mort
  NO_IMPACT: 64, // ni son d'impact ni étincelle pour ce coup (dégâts continus : EMP) ; la mort reste normale
  // étape 1 du plan addictif (§ E1.A) : purge de fin de vague — le robot se désintègre sans compter dans run.kills,
  // sans butin, sans secousse, sans son par robot, sans hitstop ; ses éclats sont les voxels cyan de fx.spawnPurgeF
  PURGE: 128,
  // étape 2, chantier F (§ E2.F) : coup né d'un objet passif — ne déclenche aucun objet (ni au coup ni à la mort), pas de critique
  PROC: 256,
});

/** Mode de world.resolveMany pour chaque robot (tableau Uint8Array tenu par enemies). */
export const RESOLVE = Object.freeze({ SKIP: 0, GROUND: 1, FLY: 2, OBST: 3 }); // ignoré / obstacles + bords / bords seulement / obstacles seulement (repli, § E4.F.2)

/** Nature d'un coup porté au joueur (damage.hitPlayer). */
export const HURT = Object.freeze({ CONTACT: 0, PROJECTILE: 1, EXPLOSION: 2, BOSS: 3 });

/** Sources de secousse (camera.addTrauma). Le groupe de plafond de chaque source est dans SHAKE.groupOf. */
export const TRAUMA = Object.freeze({
  FIRE: 0, // tir d'une arme du joueur
  KILL: 1, // mort d'un robot
  PLAYER_EXPLOSION: 2, // explosion causée par une arme du joueur (roquettes)
  ENEMY_EXPLOSION: 3, // kamikaze, attaques de zone du boss
  PLAYER_HIT: 4, // dégâts reçus
  BOSS: 5, // arrivée du boss, changement de phase, mort du boss
});
export const TRAUMA_COUNT = 6;

/** Genres d'explosion pour fx.spawnExplosion. */
// ROCKET_TOON (étape « vfx », § Z septies) : explosion de roquette du jeu — l'éclat et l'onde au sol sont dessinés par
// src/vfx ; fx garde l'éclair, les blocs, la fumée et les étincelles, sans anneau (FX.explosion.kinds[5].rings = 0).
export const FXK = Object.freeze({ ROCKET: 0, KAMIKAZE: 1, BOSS_SLAM: 2, BOSS_DEATH: 3, PLAYER_DEATH: 4, ROCKET_TOON: 5 });

/** Les 10 bonus passifs (index dans PROGRESSION.bonuses). */
export const BONUS = Object.freeze({
  MAX_HP: 0,
  MOVE_SPEED: 1,
  XP_GAIN: 2, // § E5.Z : gain d'XP (Apprentissage) ; PICKUP_RADIUS avant (Aimant, puis Collecteur)
  CRIT: 3,
  REGEN: 4,
  DASH_CD: 5,
  AREA: 6,
  DAMAGE: 7,
  FIRE_RATE: 8,
  ARMOR: 9,
});
export const BONUS_COUNT = 10;

/** Actions clavier lues par input.pressed(action) / input.down(action). */
export const ACTION = Object.freeze({
  DASH: 0,
  PAUSE: 1,
  CONFIRM: 2,
  CHOICE_1: 3,
  CHOICE_2: 4,
  CHOICE_3: 5,
  DEBUG_1: 6,
  DEBUG_2: 7,
  DEBUG_3: 8,
  DEBUG_4: 9,
  DEBUG_5: 10,
  DEBUG_6: 11,
  REROLL: 12,
  SKIP: 13,
  BANISH: 14,
  CAMERA: 15, // § E3.L : KeyC, réglage de caméra suivant (touche dans INPUT.actions, région e3:L-camera)
  STRIKE: 16, // correctif de l'étape 3 (§ E3.Z, R3) : frappe éclair à la touche (touches dans la région e3:Z-retours-1611)
  HUB: 17, // § E4.B : KeyH, ouvre le hub depuis l'écran titre (touches dans la région e4:B-hub)
  CHOICE_4: 18, // § E4.B : Digit4, quatrième onglet du hub (touches dans la région e4:B-hub)
});
export const ACTION_COUNT = 19;

/** Écrans exclusifs de ui.setScreen. */
export const SCREEN = Object.freeze({
  NONE: 'none',
  TITLE: 'title',
  PAUSE: 'pause',
  LEVELUP: 'levelup',
  SHOP: 'shop',
  GAMEOVER: 'gameover',
  CHEST: 'chest',
  AGENT: 'agent',
  FUSION: 'fusion', // § E3.F
  HUB: 'hub', // § E4.B
});

/** Résultat de shop.buy(offerId). */
export const BUY = Object.freeze({ OK: 0, TOO_EXPENSIVE: 1, LOCKED: 2, MAXED: 3, NOT_OWNED: 4, CLOSED: 5, INVALID: 6 });

/** Identifiants de sons pour audio.play(id, x, z). Réglages par son : AUDIO.sounds[id]. */
export const SFX = Object.freeze({
  // armes (un son par arme)
  BLASTER: 0,
  ORBITAL: 1, // coup d'un disque orbital
  SHOTGUN: 2,
  EMP: 3, // impulsion de l'aura
  RAIL: 4,
  ROCKET: 5, // départ d'une roquette
  // combat
  HIT: 6, // impact sur un robot
  SHIELD_BLOCK: 7, // coup arrêté par le bouclier du blindé
  ROBOT_DEATH: 8,
  EXPLOSION: 9,
  EXPLOSION_BIG: 10,
  ENEMY_SHOT: 11, // tir d'un tireur
  KAMIKAZE_BEEP: 12,
  HEAL: 13, // impulsion du réparateur
  PLAYER_HURT: 14,
  PLAYER_DASH: 15,
  DASH_READY: 16,
  // butin et progression
  GEM: 17, // hauteur qui monte en série
  FRAGMENT: 18,
  LEVEL_UP: 19,
  BONUS_PICK: 20,
  // boutique
  BUY: 21,
  BUY_DENIED: 22,
  MERCHANT_LAND: 23,
  MERCHANT_LEAVE: 24,
  // vagues
  WAVE_START: 25,
  WAVE_CLEAR: 26,
  COUNTDOWN_TICK: 27,
  COUNTDOWN_GO: 28,
  // boss
  BOSS_ALARM: 29,
  BOSS_TELEGRAPH: 30,
  BOSS_SLAM: 31,
  BOSS_PHASE: 32,
  BOSS_DEATH: 33,
  // interface
  UI_CLICK: 34,
  GAME_OVER: 35,
  NEW_BEST: 36,
  // ajouté à l'intégration des sons (13/11) : pas lourd du boss, un fichier différent à chaque pas
  BOSS_STEP: 37,
  // étape 1 du plan addictif (§ E1.A) : purge de fin de vague (les robots restants se désintègrent)
  PURGE: 38,
  // étape 1, chantier B (§ E1.B) : alerte courte d'une bannière « MISE À JOUR DÉTECTÉE » (révision d'un robot)
  ALERT: 39,
  // étape 1, chantier D (§ E1.D) : rayon du balayage laser du boss (rang 2 et suivants)
  BOSS_LASER: 40,
  RICOCHET: 41,
  BLADE: 42,
  TURRET_DEPLOY: 43,
  TURRET_SHOT: 44,
  CHEST_DROP: 45,
  CHEST_OPEN: 46,
  ROULETTE_TICK: 47,
  RARITY_0: 48,
  RARITY_1: 49,
  RARITY_2: 50,
  RARITY_3: 51,
  RARITY_4: 52,
  RARITY_5: 53,
  CHEST_PICK: 54,
  AGENT_SELECT: 55,
  REROLL: 56,
  BANISH: 57,
  POOL_THROW: 58,
  BOOMERANG: 59,
  MINE_DROP: 60,
  ITEM_TESLA: 61,
  ITEM_BOOM: 62,
  ITEM_PROC: 63,
  ITEM_SHIELD: 64,
  ITEM_GET: 65,
  ELITE_MOD: 66,
  JACKPOT: 67,
  FRAG_RAIN: 68,
  PROP_BREAK: 69,
  UTIL_PICK: 70,
  UTIL_IEM: 71,
  UTIL_STUN: 72,
  UTIL_TURBO: 73,
  DRILL: 74,
  MINE_ENEMY: 75,
  SCAN_LASER: 76,
  SPLIT: 77,
  CARRYOVER: 78,
  KATANA: 79,
  GRENADE: 80,
  SMOKE: 81,
  FLASH: 82,
  CANNON: 83,
  HAMMER: 84,
  EVOLVE: 85,
  FUSION: 86,
  CD_READY: 87,
  CD_FIRE: 88,
  UI_OPEN: 89,
  SLASH_LIGHT: 90,
  SLASH_HEAVY: 91,
  IAIDO: 92,
  TURRET_PLANT: 93,
  FIELD: 94, // correctif de l'étape 3 (§ E3.Z.12) : champ de force de la sentinelle (ouverture, poussée)
  SUCCES: 95, // étape 4, chantier A (§ E4.0.2) : succès réussi en partie (notification)
  UNLOCK: 96, // étape 4, chantier B (§ E4.0.2) : déblocage acheté dans le hub (et gagné, au bilan)
  REVEIL: 97, // étape 4, chantier F (§ E4.F.5) : un robot reporté rentre dans le champ, ses yeux se rallument
  COUP_PIED: 98, // étape 4, chantier J (§ E4.J.4) : impact sourd du coup de pied sur une borne
  GROS_BUTIN: 99, // étape 4, chantier K (§ E4.K.3) : ramassage d'une grosse gemme ou d'un gros fragment
  SAUVE_CHUTE: 100, // étape 4, chantier Q (§ E4.Q.3) : le boss lâche une Sauvegarde (disquette au sol)
  SAUVE_PRISE: 101, // étape 4, chantier Q (§ E4.Q.3) : disquette ramassée
  // étape 5, chantier G (§ E5.G) : pas des agents (au contact du pied, très bas), coups au contact, coups de poing
  PAS_ECLAIREUR: 102,
  PAS_BASTION: 103,
  PAS_SHINOBI: 104,
  COUP_LAME: 105, // double lame (lame de phase) au contact
  COUP_SABRE: 106, // katana au contact
  COUP_MARTEAU: 107, // frappe du marteau à ondes
  PUNCH: 108, // coups de poing du Bastion (joué en avance : lead du manifeste = POINGS.sonAvance)
  INVITE: 109, // apparition de l'invite « E » au-dessus d'une borne (§ E5.C, son : § E5.G)
  COMPTE_CLIC: 110, // carte-blender (17/11) : clic sur CHAQUE chiffre du compte à rebours (le Ray Trace part au « 3 »)
  // étape 5, suite du guide UX (§ E5.Q, B13) : un son d'annonce par attaque du boss (la frappe garde BOSS_TELEGRAPH) et
  // la visée du tireur
  BOSS_ANNONCE_RUEE: 111,
  BOSS_ANNONCE_OBUS: 112,
  BOSS_ANNONCE_INVOCATION: 113,
  BOSS_ANNONCE_BALAYAGE: 114,
  TIREUR_VISEE: 115,
  // § E5.Q, décisions de Femz du 21/11 : annonce des obus des robots (tireur v3, élite Instable) et de la frappe
  // orbitale ; soin du héros
  ANNONCE_OBUS_ROBOT: 116,
  SOIN_HEROS: 117,
  // § E5.Q ter (sons choisis par Femz, 21/11) : moments encore muets
  ANNONCE_SOL: 118, // traits au sol (piqué du drone v2, charge du blindé v2), bond du rôdeur v2, flaque du drone v3
  TERMINAL: 119, // le terminal se pose et se met à disposition
  RAVITAILLEMENT: 120, // la capsule de ravitaillement tombe
  PANNE: 121, // panne de courant : la lumière tombe
  ANNEAU: 122, // anneau d'acier : le cercle se forme et se resserre
  CLIC_DEPLACEMENT: 123, // clic droit de déplacement au sol (branché avec le déplacement à la souris, branche parametres)
  ESSAIM: 124, // armée de drones : passage des drones
  // objet Éclats (Femz, 21/11) — branchés à la fusion de la branche eclats (src/items.js, shrapnel)
  ECLAT_PROJECTION: 125, // départ des éclats
  ECLAT_IMPACT: 126, // chaque impact (4 variantes de hauteur au hasard, toutes dans la gamme de la musique)
});
export const SFX_COUNT = 127;

/** Drapeaux par robot (E.flags, masque de bits ; remis à 0 par enemies.spawn) — étape 1 du plan addictif (§ E1.0). */
export const EFLAG = Object.freeze({
  TRANSIT: 1, // robot d'événement qui traverse l'arène : ni replacé, ni compté comme traînard
  WALL: 2, // robot d'un anneau d'acier : jamais replacé
  NO_LOOT: 4, // ne lâche rien à sa mort (complément d'une prolongation de vague de boss)
  PRIORITY: 8, // cible prioritaire (chantiers suivants)
  SHIELD_DRONE: 16, // drone-bouclier du boss : jamais replacé
  GUARD: 32, // garde d'une capsule de ravitaillement (§ E1.C) : sur place tant que le héros est loin, jamais replacé
  ELITE: 64,
});

/** Genres de zone de danger au sol (src/hazards.js, addF) — étape 1 du plan addictif (§ E1.B). */
export const HAZ = Object.freeze({
  STRIKE: 0, // cercle annoncé qui se remplit, puis explosion (obus du tireur v3)
  LINE: 1, // trait annoncé (piqué du drone v2, charge du blindé v2) : annonce seule
  PUDDLE: 2, // flaque : dégâts au joueur par tics tant qu'elle dure (drone v3)
  MARK: 3, // repère seul : point de chute de la capsule de ravitaillement (§ E1.C)
  ORBITAL: 4, // frappe orbitale (§ E1.C) : comme STRIKE, mais l'explosion blesse AUSSI les robots (source DMG_SRC.EVENT)
  SPARK: 5,
  MINE: 6,
  DRILL: 7,
});
export const HAZ_COUNT = 8;

/** Cases du tableau écrit par bossMutations(rang, out) — étape 1 du plan addictif (§ E1.D). */
export const BMUT = Object.freeze({
  BEAMS: 0, // rayons du balayage laser (0 = pas de balayage)
  SUMMON_TYPE: 1, // ENEMY.* invoqué
  SUMMON_COUNT: 2, // robots par invocation
  DRONES: 3, // drones-boucliers (0 = aucun)
  MORTAR_P1: 4, // 1 = obus dès la phase 1
  ENRAGE_AT: 5, // part des PV sous laquelle il s'enrage (0 = jamais)
  CD_MUL: 6, // multiplicateur des recharges et de la pause entre attaques
});
export const BMUT_COUNT = 7;
//#endregion fondation:enumerations

//#region fondation:sections
// =====================================================================================================
// 1. FONDATION — sections possédées par la fondation (gelées pendant la phase parallèle).
// =====================================================================================================

// ----- LOOP : boucle et pas de temps ------------------------------------------------------------------
export const LOOP = {
  maxDt: 1 / 30, // s — borne du pas de temps réel d'une image (décision 4)
  autoPauseOnHide: true, // onglet masqué pendant PLAYING / WAVE_CLEAR / COUNTDOWN → PAUSED
  maxShotsPerFrame: 2, // un tir automatique rattrape au plus ce nombre de salves par image (§ C.2)
};

// ----- CAPS : capacités fixes des tableaux (aucune allocation après init) ----------------------------
export const CAPS = {
  enemies: 512, // emplacements de E : 400 de vague + boss + invocations + marge pour F6
  enemyProjectiles: 256, // tirs des tireurs
  playerProjectiles: 384, // tirs du blaster, plombs, roquettes, ricochets, tirs des sentinelles (= VFX.capacite.tirs ; 256 avant l'étape 2, § E2.A)
  orbitals: 8, // disques orbitaux (6 au niveau 5)
  beams: 32, // rayons du rail (5 au plus) et arcs de l'EMP (8 au plus par impulsion) affichés en même temps
  pickups: 1024, // gemmes + fragments ; au-delà, la valeur est fusionnée dans un ramassable existant
  debris: 768, // éclats low-poly
  damageNumbers: 64, // nombres affichés en même temps
  numberGlyphs: 5, // chiffres max par nombre (99999)
  numberSegments: 7, // un chiffre = 7 segments en géométrie (pas de texture) : 64 × 5 × 7 = 2 240 instances
  sparks: 256, // étincelles d'impact
  rings: 48, // anneaux au sol (explosions, EMP, soin, dash)
  telegraphs: 16, // zones télégraphiées du boss
  queryScratch: 512, // taille des tableaux de résultat des requêtes de grille
  hitMemory: 8, // robots déjà touchés dont un projectile perforant se souvient : ≥ perforation maximale des armes (8 depuis l'étape 2 : un ricochet se souvient de 7 robots, § E2.A)
  waveQueue: 4096, // robots d'une vague en attente d'apparition (vague 30 : 380)
  // Étape 1 du plan addictif (§ E1.0, chantier B)
  hazards: 192, // zones de danger au sol de src/hazards.js (traits de piqué et de charge, obus, flaques)
  bubbles: 400, // bulles-boucliers affichées en même temps (réparateur v2) : WAVES.maxAlive, une par robot au pire (§ E1.S ; à 128 un robot protégé pouvait ne pas avoir sa bulle)
  bannerQueue: 4, // bannières en attente (ui.queueBanner) : affichées l'une après l'autre
};

// ----- PALETTE : couleurs du cahier (hex sRGB) -------------------------------------------------------
export const PALETTE = {
  sand: 0xd9a066, // sol sable chaud (le sol peint lit PEINT.sol)
  rock: 0x8f5e3b, // roches et falaises
  rockDark: 0x6f4729,
  player: 0xede6d6, // blanc cassé
  playerAccent: 0x3fe0d0, // cyan
  robot: 0x4a4e57, // gris métal : couleur de CORPS de tous les robots (cahier)
  robotLight: 0x6a6f7a, // pièces secondaires seulement (rotors, antennes, canons) : jamais la couleur dominante
  robotDark: 0x34373e, // pièces secondaires seulement (plaques, chenilles, charge du kamikaze)
  robotEye: 0xff3b3b, // rouge émissif
  eyeTireur: 0xffb03b, // variantes d'yeux pour distinguer les silhouettes
  eyeReparateur: 0x5cff8a,
  eyeKamikaze: 0xff6a1f,
  fragment: 0x3fe0d0, // cyan émissif
  gemGreen: 0x4be36a,
  gemBlue: 0x3f8cff,
  gemViolet: 0xa45cff,
  enemyShot: 0xff3b3b,
  telegraph: 0xff3b3b,
  merchant: 0xf2c14e,
  // Une couleur distincte par arme (tirs lisibles dans une horde). Jamais de rouge (le rouge = danger) ni le
  // cyan des fragments (0x3fe0d0) : le blaster est blanc glacé, pour ne pas se confondre avec le butin.
  weapon: [0xe8fbff, 0xffd23f, 0xff9a3d, 0x6fa8ff, 0xff5a1f, 0xc8ff4a], // rail : orange du modèle (16/11, était violet 0xd46bff)
  damageNumber: 0xffffff,
  damageNumberCrit: 0xffd23f,
  edgeFlash: 0xff2a2a,
};

// ===== début de la section « rendu:peint » (dans fondation:sections) =====
// -----------------------------------------------------------------------------------------------------
// THÈME DU DÉCOR — DA « carte mère » (14/11/2026, docs/da-carte-mere.md) par défaut ; « ?theme=desert » dans l'adresse
// rend l'ancien désert (sol de sable, rochers, falaises, végétation) pour comparer. Lu une fois, au chargement.
const THEME = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('theme') === 'desert') ? 'desert' : 'carte-mere';
const CM = THEME === 'carte-mere';

// RENDU « PEINT » — DA « Clash » (docs/da-clash.md), intégré le 13/11/2026 (ARCHITECTURE.md § Z quater).
// Ex-src/rendu/reglages.js du prototype (même structure, mêmes noms ; src/rendu/reglages.js le réexporte).
// Couleurs en hex sRGB (converties en linéaire par les modules). Aucune valeur n'est lue dans un chemin chaud
// sans avoir été copiée à l'init dans un uniforme ou un tableau typé.
// -----------------------------------------------------------------------------------------------------
export const PEINT = {
  // DA « carte mère » (14/11/2026, docs/da-carte-mere.md) : l'arène est la surface d'une carte mère. 'desert' rend
  // l'ancien sol de sable (shader et teintes du désert) ; le décor suit WORLD.decor.manifest.
  theme: THEME,
  // ----- Lumière (§ 1 du brief : soleil chaud haut à gauche de l'écran, ciel froid qui remplit) --------------------
  soleil: {
    couleur: 0xffe2b0,
    intensite: 1.1, // passe 2 : soleil plus franc, ciel plus faible → contraste lumière / ombre plus fort
    // Direction VERS le soleil, donnée par rapport à l'écran (calculée depuis CAMERA.yawDeg) : composante
    // horizontale = gauche de l'écran × depuisGauche + vers la caméra × versCamera, puis élévation. Vu par la caméra
    // inclinée à 55°, la hauteur du soleil se projette vers le HAUT de l'écran : la lumière vient bien d'en haut à
    // gauche, et les faces tournées vers la caméra restent éclairées (un soleil derrière la scène les éteindrait).
    depuisGauche: 0.92,
    versCamera: 0.38,
    elevationDeg: 52,
  },
  ciel: { couleur: 0x9db8ff, sol: CM ? 0x5f9a72 : 0xc48d58, intensite: 0.3 }, // hémisphère : ciel bleu, rebond du sol (vert du vernis, chaud du sable)
  // ----- Matière -------------------------------------------------------------------------------------------------
  wrap: 0.28, // diffus enveloppé : (N·L + wrap) / (1 + wrap) — terminateur doux, faces de côté encore éclairées
  speculaire: { force: 0.42, puissance: 12 }, // × métal du profil : les biseaux des robots attrapent le soleil
  // ----- Profils de matériau (constantes de compilation, materiaux.js) ------------------------------------------------
  // base = multiplicateur de l'albédo (linéaire), saturation = autour de la luminance, soleil = part du soleil direct,
  // emissif = gain des émissifs, ombre = voile AJOUTÉ là où le soleil manque (couleur, force) — passe 3 : par profil,
  // ciel = multiplicateur RVB de l'hémisphère,
  // liseré = contour Fresnel (couleur, force, puissance), ombreStatique = lit l'ombre figée du décor.
  profils: {
    // horde : acier bleu-gris PROFOND et saturé, creux bleutés ; les arêtes claires du modèle (usure cuite) et le
    // spéculaire font le reste. Mesuré sur les captures : voir tests/rendu/mesures-captures.json (contraste horde/sable).
    robot: { base: [0.15, 0.185, 0.32], saturation: 1.6, soleil: 0.75, metal: 0.9, ombre: { couleur: 0x5b4fc4, force: 0.07 }, liseré: { couleur: 0x6f8cff, force: 0.035, puissance: 3 } },
    // boss : déjà rouge et gros ; même acier, moins bleui (sa lueur de phase 2 reste rouge)
    boss: { base: [0.62, 0.62, 0.78], saturation: 1.3, metal: 1, ombre: { couleur: 0x5b4fc4, force: 0.082 }, liseré: { couleur: 0x6f8cff, force: 0.035, puissance: 3 } },
    // héros : plaques plus claires et plus chaudes que tout le reste (gain > 1 sur des couleurs de sommet que l'AO
    // cuite assombrit), accents émissifs × 1,35, liseré cyan discret
    heros: { base: [1.42, 1.36, 1.24], saturation: 1.0, emissif: 2.4, metal: 0.35, ombre: { couleur: 0x5b4fc4, force: 0.045 }, liseré: { couleur: 0x3fe0d0, force: 1.05, puissance: 1.3 } },
    objet: { base: [1, 1, 1], saturation: 1.12, metal: 0.5, ombre: { couleur: 0x5b4fc4, force: 0.15 }, liseré: { couleur: 0xa8c4ff, force: 0.06, puissance: 3 } },
    // décor : ombre BRUN CHAUD (brief § 5), un soupçon de bleu pour la profondeur ; ciel réchauffé sur la roche
    // carte mère : composants manufacturés, ombre froide ; désert : ombre brun chaud, ciel réchauffé sur la roche
    decor: CM
      ? { base: [1, 1, 1], saturation: 1.05, metal: 0.35, ombre: { couleur: 0x3f5590, force: 0.26 }, ciel: [0.9, 1.0, 1.05], liseré: { couleur: 0xa8c4ff, force: 0.05, puissance: 3 } }
      : { base: [1, 1, 1], saturation: 1.0, metal: 0, ombre: { couleur: 0x7a5028, force: 0.34 }, ciel: [1.0, 0.8, 0.5], liseré: { couleur: 0xa8c4ff, force: 0.05, puissance: 3 } },
    // passe 5 : herbes, arbustes, fleurs — translucides au soleil, ombre chaude
    herbe: { base: [1, 1, 1], saturation: 1.15, metal: 0, translucide: 0.45, ombre: { couleur: 0x7a5028, force: 0.2 }, ciel: [1.0, 0.9, 0.75], liseré: { couleur: 0xffe0a0, force: 0.05, puissance: 3 } },
    sol: { base: [1, 1, 1], saturation: 1, metal: 0, ombre: { couleur: 0x5b4fc4, force: 0.18 }, liseré: { couleur: 0x000000, force: 0, puissance: 1 } },
  },
  // ----- Ombres projetées (héros, gros robots, boss, marchand, décor) -----------------------------------------------
  ombre: {
    marge: 2.5, // m autour de l'emprise visible, dans le repère de la lumière
    hauteurMax: 9, // m : hauteur des falaises — ce qui dépasse en haut de l'écran reçoit encore l'ombre
    bias: -0.0006,
    normalBias: 0.035,
    intensite: 1.0,
    far: 170,
    distance: 85,
  },
  // ----- Ombre FIGÉE du décor (ombre-statique.js) : rochers, falaises, carcasses rendus une fois dans leur propre carte,
  // lue par tous les matériaux peints ; le décor ne repasse plus dans la carte du soleil à chaque image.
  ombreStatique: { carte: 2048, demiCote: 74, hauteur: 12, bias: 0.0015 },
  // ----- Sol ------------------------------------------------------------------------------------------------------
  sol: {
    sable: 0xd9a066,
    sableClair: 0xf0c48a,
    sableOmbre: 0xa8703f,
    roche: 0x8f5e3b,
    rochePied: 0x5e3a22,
    echelles: [1 / 18, 1 / 6, 1 / 1.6], // fréquences des trois octaves (1/m) : plaques, taches, grain
    cailloux: 520,
    touffes: 420,
    caillou: 0x8c735c,
    touffe: 0x7f9a46, // sauge, pointes plus claires
    touffePointe: 0xc9cf7c,
    // passe 5 : sable très peint
    sableRouge: 0xc9733c,
    sablePale: 0xf2d29a,
    chemin: 0xf0d6a4,
  },
  // ----- Carte mère : sol de circuit imprimé calculé dans le shader (materiaux.js, SR_CARTE), en mètres ------------------
  // vernis = solder mask (vert jouet, assez clair pour que la horde marine s'y lise) ; pistes = cuivre SOUS le vernis
  // (vert plus clair) ; vias et pastilles = or nu ; sérigraphie blanche. blocs : côté des zones de routage (une
  // orientation par zone : horizontale, verticale, diagonale, plan de masse) ; voie = pas entre deux pistes ; bus =
  // faisceaux continus qui traversent l'arène (période, nombre de pistes, pas).
  carte: {
    vernis: 0x338a57,
    vernisClair: 0x47a56c,
    vernisSombre: 0x246541,
    piste: 0x64ba82,
    or: 0xe6bf55,
    trou: 0x1d2a24,
    serigraphie: 0xeef2ea,
    dehors: 0x24563a, // sous et derrière la bordure
    bloc: 9,
    voie: 0.45,
    largeurPiste: 0.12,
    via: 0.11,
    bus: { periode: 23, pistes: 7, pas: 0.3 },
    // ombre d'un ventilateur géant (remplaçait les nuages) — RETIRÉE (Femz 14/11 : « j'aime pas la texture de ventilo sur
    // la map ») : force 0 = aucune ombre (le shader rend 0) ; vitesse en rad par m de PEINT.nuages.vitesse[0]
    ventilo: { centre: [14, -20], rayon: 28, pales: 5, vitesse: 0.022, force: 0 },
    // au-delà des murs : faisceaux de pistes d'ALIMENTATION qui arrivent de l'extérieur, perpendiculaires au bord, et
    // impulsions d'énergie qui courent vers la carte (Femz 14/11 : « comme s'ils alimentaient la carte mère »).
    // faisceau = largeur d'un groupe (m), pas = écart des pistes (m), longueurs (m), vitesse des impulsions (m/s),
    // periode = écart entre deux impulsions d'une piste (m), gain = éclat émissif (bloom au-dessus de 1,7)
    alimentation: { faisceau: 6, pas: 0.42, longueurMin: 12, longueurMax: 55, vitesse: 7, periode: 9, gain: 2.4, couleur: 0xffd27a, impulsion: 0xfff0c8 },
    cms: { resistances: 1500, condensateurs: 900 }, // petits composants posés (remplacent cailloux et touffes)
    // pales des ventirads des 4 coins : tournent en continu, SEULEMENT celles que la caméra voit (Femz 14/11 : « jamais
    // ceux hors champ ») — rad/s, déphasage d'un coin à l'autre (rad)
    helices: { vitesse: 1.8, dephasage: 0.9 },
  },
  // ----- Passe 5 : traitement stylisé « painterly » (désert) -------------------------------------------------------
  vegetation: {
    herbes: CM ? 0 : 34000, // carte mère : pas de végétation — touffes d'herbe sèche (8 brins × 2 segments, deux faces : 48 triangles) ; carreaux de 30 m hors champ non dessinés
    arbustes: CM ? 0 : 260,
    fleurs: CM ? 0 : 320,
    hauteurEcrasee: 0.25, // part de la hauteur gardée sous un pousseur
    vent: { direction: [0.8, 0.6], force: 0.13, longueur: 16, vitesse: 0.3, rafales: 0.9, rythme: 0.45 }, // longueur d'onde (m), vagues/s ; rythme : ralentit tout le vent (vagues, rafales, frémissement) — Femz 13/11 : « bouge trop vite »
    pousse: { heros: 1.7, portee: 14 }, // rayon d'écart du héros (m), portée de recherche des robots pousseurs
    // Intégration : UN maillage instancié par espèce (herbes, arbustes, fleurs : 3 appels de dessin), instances rangées
    // par carreau de `carreau` m ; seuls les carreaux vus (emprise de la caméra + `marge` m) sont recopiés en tête du
    // tampon, et seulement quand cet ensemble change (le prototype faisait un maillage et un matériau par carreau :
    // 17 à 21 appels de dessin).
    carreau: 12,
    marge: 2.5,
    couleurs: {
      herbeSeche: 0xd9a845,
      herbePale: 0xecd28a,
      touffeOlive: 0x8c9c46,
      arbuste: 0x8a8a52,
      arbusteSec: 0xa07c48,
      fleurs: [0xf08aa0, 0xf5d24a, 0xb48ae8, 0x9ad87a],
    },
  },
  nuages: { force: 0.5, echelle: 1 / 34, vitesse: [1.6, 0.9] }, // part du soleil retirée, 1/m, m/s
  atmosphere: {
    voile: { seuil: 0.62, force: 0.05 }, // « bloom haze » : les zones claires débordent un peu (dans la chaîne du bloom)
    chaud: [0.035, 0.016, -0.012], // hautes lumières réchauffées (ajouté × luminance)
    froid: [-0.01, 0.0, 0.028], // ombres refroidies (ajouté × (1 − luminance))
    saturation: 1.1,
  },
  diorama: { force: 0.3, bande: 0.3 }, // flou de profondeur en bande (haut et bas) : force (0,3 retenue à l'intégration ; 0,55 au prototype), hauteur de bande (part de l'écran)
  roche: { base: 0x7e5a44, dessus: 0xb98457, pied: 0x4e3224 },
  // ----- Ombres de contact (une sous CHAQUE unité, un seul appel de dessin) -------------------------------------------
  contact: {
    teinte: 0x4b3f6e, // centre de la tache (multiplié au sol) : brun-violet, pas noir
    force: 0.62,
    echelle: 1.8, // rayon de la tache = rayon de collision × échelle
    volant: 0.55, // force pour une unité qui vole (drone)
    marchand: 1.9, // m — rayon de la tache sous le drone-marchand posé (elle pâlit et s'élargit avec l'altitude)
    y: 0.012, // sous les zones du boss (0,03) et tous les décalques de RENDER.decals
    order: 0,
  },
  // ----- Couleur finale -------------------------------------------------------------------------------------------
  post: {
    exposition: 0.95, // gain avant la courbe ; la scène éclairée est réglée pour rester sous seuilBloom (calculé pour
    //                le sable et les plaques crème du héros, pas mesuré pixel par pixel) : seuls les émissifs bloom
    courbe: 'aces-teinte', // 'aces-teinte' (ACES sur le canal fort, teinte gardée), 'aces' (par canal) ou 'agx'
    saturation: 1.0, // passe 2 : la saturation est portée par les profils (robots, objets) ; le sable garde la palette
    contraste: 0.25, // part d'une courbe en S (smoothstep) mêlée après la courbe de tons : couleurs plus franches
    releveOmbres: [0.008, 0.008, 0.012], // passe 3 : presque neutre ; le bleuté des ombres vient des profils (sable, unités) // ajouté aux tons sombres après la courbe : ombres bleuies, jamais noir pur
    seuilOmbres: 0.32,
    vignette: 0.22, // RENDER.vignette reprend ces deux valeurs (une seule source)
    vignetteDebut: 0.6,
    seuilBloom: 1.1, // seuil de l'ancienne passe de bloom (passe 3 du prototype) ; le bloom du jeu est celui de `bloom` ci-dessous
  },
  // ----- Branche shader-crt : léger CRT / pixel sur la scène (le HUD HTML n'est pas touché) ------------------------
  // actif = numéro de la variante (0 = aucune) ; ?crt=N dans l'URL l'emporte. Tailles en pixels CSS.
  //   pixel : côté d'un gros pixel · pixelTampon : idem en pixels du tampon (= pixels d'écran à pleine définition) · scan : lignes de balayage · scanPx : période des lignes sans pixellisation
  //   scanGrille : une ligne par rangée de gros pixels · mask : grille RVB · chroma : aberration au bord · courbure : bombé du tube · niveaux : postérisation tramée
  crt: {
    actif: 7,
    variantes: [
      null,
      { nom: 'Lignes douces', scan: 0.18, scanPx: 3, chroma: 0.8 },
      { nom: 'Pixel net', pixel: 3 },
      { nom: 'Trinitron', scan: 0.22, scanPx: 3, mask: 0.35, chroma: 1.2 },
      { nom: 'Pixel + lignes', pixel: 3, scan: 0.3, scanGrille: true, chroma: 0.6 },
      { nom: 'Pixel tramé', pixel: 2, niveaux: 24, scan: 0.12, scanGrille: true },
      { nom: 'Tube bombé', scan: 0.25, scanPx: 3, mask: 0.2, chroma: 1.6, courbure: 0.06 },
      // 15/11 : retenue par Femz — gros pixels de 2 px d'écran (validés) + lignes calées sur la grille, SANS tramage,
      // chiffres de dégâts nets (hors effet)
      { nom: 'Lignes + pixel fin', scan: 0.3, scanPxTampon: 4, chroma: 0.8, pixelTampon: 2 },
    ],
  },
  // ----- Branche look-cel (15/11) : rendu « cel » de la réf de Femz — aplats durs, liseré clair, contour des
  // silhouettes, étalonnage rose / rouge. Le HUD HTML n'est pas touché. actif = numéro de la variante (0 = rendu
  // d'origine) ; ?cel=N dans l'URL l'emporte. Tout passe par des uniformes : changer de variante ne recompile rien.
  //   paliers : paliers du soleil (0 = éclairage d'origine, 2 = trois tons) · douceur : demi-largeur de la transition
  //             (part d'un palier) · aplat : 0..1, le ciel ne dégrade plus selon la normale (une teinte par matière)
  //   bord : force du liseré dur (Fresnel en marche) · bordSeuil : 1 − N·V où il commence · bordCouleur
  //   contour : force du contour clair des silhouettes (profondeur) · contourPx : épaisseur (pixels du tampon)
  //             contourM : saut de profondeur (m) qui fait un bord · contourCouleur
  //   etalonnage : force de la rampe de palette (0..1) · rampe : 4 teintes, du plus sombre au plus clair
  //             garde : canal fort au-dessus duquel un pixel (émissif) garde sa couleur
  cel: {
    actif: 1, // 15/11 : « aplat seul » retenu par Femz (aplats durs + liseré clair, couleurs de la carte retouchée gardées)
    variantes: [
      null,
      // 15/11 : retenue par Femz
      { nom: 'Aplats seuls', paliers: 2, douceur: 0.04, aplat: 0.8, bord: 0.35, bordSeuil: 0.62, bordCouleur: 0xffe6e0 },
      { nom: 'Aplats + contour', paliers: 2, douceur: 0.04, aplat: 0.8, bord: 0.35, bordSeuil: 0.62, bordCouleur: 0xffe6e0, contour: 0.85, contourPx: 1.5, contourM: 0.35, contourCouleur: 0xffd2cc },
      { nom: 'Réf rose rouge', paliers: 2, douceur: 0.04, aplat: 0.8, bord: 0.35, bordSeuil: 0.62, bordCouleur: 0xffe6e0, contour: 0.85, contourPx: 1.5, contourM: 0.35, contourCouleur: 0xffd2cc, etalonnage: 0.85, rampe: [0x14050a, 0x4c1622, 0xb0606a, 0xf6c4bc], garde: 0.92, sol: 0.4 },
      { nom: 'Réf lavande', paliers: 2, douceur: 0.03, aplat: 0.9, bord: 0.45, bordSeuil: 0.6, bordCouleur: 0xffe6e0, contour: 0.9, contourPx: 1.5, contourM: 0.35, contourCouleur: 0xffd2cc, etalonnage: 0.85, rampe: [0x16050a, 0x5a1a28, 0x9a86ad, 0xf2b8b4], garde: 0.92, sol: 0.3 },
      { nom: 'Réf très sombre', paliers: 2, douceur: 0.03, aplat: 1, bord: 0.55, bordSeuil: 0.58, bordCouleur: 0xffe6e0, contour: 1, contourPx: 2, contourM: 0.3, contourCouleur: 0xffd8d0, etalonnage: 0.9, rampe: [0x12040a, 0x4a1420, 0xc06a72, 0xf8cdc4], garde: 0.92, sol: 0.18 },
    ],
  },
  // ----- Passe 4 : glow (bloom multi-niveaux, lumière émise au sol, vraies lumières des grands moments) --------------
  // seuil / genou / plafond : sur le canal le plus fort de la scène HDR avant exposition (émissifs ≥ 1,5) ; plafond =
  // intensité extraite maximale par pixel (garde-fou de la horde) ; poids = un par niveau, du plus fin au plus large ;
  // force = gain du bloom dans la passe finale.
  bloom: { seuil: 1.7, genou: 0.4, plafond: 2.2, poids: [1.0, 0.9, 0.8, 0.7, 0.6], force: 0.32 },
  // émissifs « lumineux » : cœur plus clair là où la face regarde la caméra (part du blanc, gain)
  emissifCoeur: { blanc: 0.12, gain: 0.35 },
  // taches de lumière au sol (un InstancedMesh additif × couleur du sol, lumieres.js) : rayon (m), intensité
  taches: {
    capacite: 1600,
    y: 0.016,
    yeux: { rayon: 1.0, intensite: 0.32 }, // petites et faibles : 400 yeux ne doivent pas rougir le sable
    heros: { rayon: 2.2, intensite: 0.9 },
    projectiles: { rayon: 1.3, intensite: 0.3 }, // nombreux et serrés près du héros : faibles chacun
    roquettes: { rayon: 2.0, intensite: 0.8 },
    disques: { rayon: 1.6, intensite: 0.55 },
    rayons: { rayon: 1.5, intensite: 0.35 },
    tirsEnnemis: { rayon: 1.1, intensite: 0.5 },
    butin: { rayon: 0.9, intensite: 0.6 },
    etincelles: { rayon: 0.8, intensite: 0.15 },
    explosions: { rayon: 1.3, intensite: 1.2, autourDuHeros: 0.12 }, // les auras centrées sur le héros (EMP, soin, dash) : faibles, sans vraie lumière // × rayon de l'anneau ; l'intensité suit sa couleur (qui s'éteint)
    zones: { rayon: 1.15, intensite: 0.45 }, // × rayon de la zone télégraphiée
    flammes: { rayon: 4.2, intensite: 1.1, couleur: 0xff7a2a }, // flammes des cheminées du boss (phase 2)
  },
  // vraies lumières ponctuelles (éclairent les côtés des unités et du décor) : les N sources les plus fortes
  lumieres: { nombre: 6, portee: 9, hauteur: 1.6, gain: 2.2, decroissance: 1.4 }, // portée (m) et décroissance : atténuation de three r170 (texture uSrPtTex, materiaux.js)
  // option « crépuscule » (non imposée) : ambiant plus sombre et violet, soleil bas et orangé, lumières plus fortes
  crepuscule: {
    soleil: { couleur: 0xffb48a, intensite: 0.22 },
    ciel: { couleur: 0x5f5ad8, sol: 0x2c2448, intensite: 0.5 },
    exposition: 1.0,
    taches: 2.4,
    lumieres: 2.0,
    bloom: 1.35,
  },
  // ----- Qualité adaptative : une ligne par niveau de RENDER.quality --------------------------------------------------
  // carte = côté de la carte d'ombre ; filtrage = 1 (4 prises bilinéaires, 16 lectures) ou 0 (1 prise, 4 lectures) ;
  // douceur = écart des prises en texels ; detail = 3e octave du sol ; decor = cailloux, touffes ET végétation visibles
  // (intégration : la végétation suit ce drapeau, dernier levier avec la coupure du bloom).
  qualite: [
    { carte: 2048, filtrage: 1, douceur: 2.2, detail: 1, decor: true },
    { carte: 2048, filtrage: 1, douceur: 2.0, detail: 1, decor: true },
    { carte: 1024, filtrage: 0, douceur: 1.0, detail: 0, decor: true },
    { carte: 1024, filtrage: 0, douceur: 1.0, detail: 0, decor: false },
  ],
};

// ----- Branche carte-retouche (15/11/2026) : retouches de la carte mère « sans la dénaturer », réf de Femz (arène
// grise minimaliste, persos saturés bien détachés, lignes lumineuses rares). Variantes à comparer : ?retouche=N dans
// l'adresse (ou window.__SR_RETOUCHE posé avant les scripts) ; 0 = carte d'avant les retouches, défaut = RETOUCHE_VALIDEE. Chaque variante remplace des clés
// de PEINT (fusion profonde), lue une fois au chargement, avant toute construction du décor et des matériaux.
const RETOUCHES = [
  null,
  // 1 · vernis éteint : même carte, vert grisé de valeur moyenne, or et sérigraphie ternis, dehors presque noir
  { nom: 'Vernis éteint', carte: { vernis: 0x5b7867, vernisClair: 0x67836f, vernisSombre: 0x4b6556, piste: 0x6d8d79, or: 0xa89156, serigraphie: 0xc4cdc6, dehors: 0x161d1a } },
  // 2 · éteint + épuré : moitié moins de pistes et de vias visibles, sérigraphie discrète, 4 × moins de CMS
  { nom: 'Épuré', carte: { vernis: 0x5b7867, vernisClair: 0x67836f, vernisSombre: 0x4b6556, piste: 0x6d8d79, or: 0xa89156, serigraphie: 0xc4cdc6, dehors: 0x161d1a, detail: { pistes: 0.45, vias: 0.45, seri: 0.35, plan: 0.5 }, cms: { resistances: 380, condensateurs: 220 } } },
  // 3 · épuré + lignes lumineuses : les bus deviennent de fines lignes qui brillent (seul accent du sol, comme la réf)
  { nom: 'Lignes lumineuses', carte: { vernis: 0x5b7867, vernisClair: 0x67836f, vernisSombre: 0x4b6556, piste: 0x6d8d79, or: 0xa89156, serigraphie: 0xc4cdc6, dehors: 0x161d1a, detail: { pistes: 0.45, vias: 0.45, seri: 0.35, plan: 0.5 }, cms: { resistances: 380, condensateurs: 220 }, lueur: { couleur: 0x8affd2, gain: 1.4 } } },
  // 4 · gris technique (le plus proche de la réf) : vernis gris à peine vert, grille fine, lignes lumineuses
  { nom: 'Gris technique', carte: { vernis: 0x6b716d, vernisClair: 0x767c78, vernisSombre: 0x5d6360, piste: 0x7a827d, or: 0x9a8a62, serigraphie: 0xb9bfbb, dehors: 0x141716, detail: { pistes: 0.35, vias: 0.35, seri: 0.3, plan: 0.4 }, cms: { resistances: 260, condensateurs: 150 }, lueur: { couleur: 0x8affd2, gain: 1.4 }, grille: { pas: 1.5, largeur: 0.025, force: 0.1 } } },
  // 5 · carte sombre : vernis vert très foncé mat, lignes lumineuses, les yeux rouges et le cyan ressortent
  { nom: 'Carte sombre', carte: { vernis: 0x2e4237, vernisClair: 0x36493e, vernisSombre: 0x26372e, piste: 0x3c5547, or: 0x7d6c44, serigraphie: 0x8c978f, dehors: 0x0e1210, detail: { pistes: 0.5, vias: 0.45, seri: 0.35, plan: 0.5 }, cms: { resistances: 380, condensateurs: 220 }, lueur: { couleur: 0x8affd2, gain: 1.4 } } },
  // 6 · épuré + persos détachés : variante 2, liseré des robots et du boss bien plus fort (silhouette claire)
  { nom: 'Persos détachés', carte: { vernis: 0x5b7867, vernisClair: 0x67836f, vernisSombre: 0x4b6556, piste: 0x6d8d79, or: 0xa89156, serigraphie: 0xc4cdc6, dehors: 0x161d1a, detail: { pistes: 0.45, vias: 0.45, seri: 0.35, plan: 0.5 }, cms: { resistances: 380, condensateurs: 220 } }, profils: { robot: { liseré: { couleur: 0xc8d4ff, force: 0.28, puissance: 3.2 } }, boss: { liseré: { couleur: 0xc8d4ff, force: 0.22, puissance: 3.2 } } } },
  // 7 · carte sombre SANS lignes lumineuses, halo doux autour du héros (réf de Femz : lumière autour du perso, le reste
  // s'enfonce) — 8 · même chose, halo plus large et fond plus noir
  { nom: 'Sombre + halo', carte: { vernis: 0x2e4237, vernisClair: 0x36493e, vernisSombre: 0x26372e, piste: 0x3c5547, or: 0x7d6c44, serigraphie: 0x8c978f, dehors: 0x0e1210, detail: { pistes: 0.5, vias: 0.45, seri: 0.35, plan: 0.5 }, cms: { resistances: 380, condensateurs: 220 }, halo: { rayon: 9, force: 0.9, loin: 0.8 } } },
  { nom: 'Sombre + grand halo', carte: { vernis: 0x2e4237, vernisClair: 0x36493e, vernisSombre: 0x26372e, piste: 0x3c5547, or: 0x7d6c44, serigraphie: 0x8c978f, dehors: 0x0e1210, detail: { pistes: 0.5, vias: 0.45, seri: 0.35, plan: 0.5 }, cms: { resistances: 380, condensateurs: 220 }, halo: { rayon: 14, force: 1.2, loin: 0.6 } } },
];
// 9 → 11 (16/11, branche look-unites, essai) : la carte validée (8) + des unités qui se détachent du sol sombre.
// 9 · liseré clair froid tout autour des robots et du boss · 10 · dessus éclairci (part du soleil, qui vient d'en haut)
// · 11 · les deux. Le héros et les agents ne changent pas (profil herosAnime).
{
  const L = { liseré: { couleur: 0xd2dcff, force: 0.7, puissance: 2.4, cel: 1 } };
  const D = { soleil: 2.6, base: [0.24, 0.28, 0.44] };
  RETOUCHES.push(
    { ...RETOUCHES[8], nom: 'Unités : liseré', profils: { robot: L, boss: L } },
    { ...RETOUCHES[8], nom: 'Unités : dessus éclairci', profils: { robot: D, boss: { soleil: 1.5 } } },
    { ...RETOUCHES[8], nom: 'Unités : liseré + dessus', profils: { robot: { ...L, ...D }, boss: { ...L, soleil: 1.5 } } },
  );
}
PEINT.carte.detail = { pistes: 1, vias: 1, seri: 1, plan: 1 }; // part gardée de chaque détail du sol (1 = actuel)
PEINT.carte.lueur = { couleur: 0x6dffc0, gain: 0 }; // émissif des pistes de bus (0 = aucun)
PEINT.carte.grille = { pas: 1.5, largeur: 0.025, force: 0 }; // grille fine éclaircie sur le vernis (0 = aucune)
PEINT.carte.halo = { rayon: 10, force: 0, teinte: 0xdcefff, loin: 1 }; // halo du sol autour du héros (m, gain au centre, teinte, lumière gardée au loin)
// Plan de routage CUIT sous Blender + processeur central (branche carte-blender, 17/11/2026 ; Femz : « un gros
// processeur central sur lequel le perso se matérialise au début, qui relie les composants principaux, et qui pulse de
// l'énergie au début d'une vague »). Fichiers : assets/carte/ (outils/blender/decor/plan_carte.py). Sol du jeu seulement.
//   force : part du plan cuit ; proceduralGarde : part GARDÉE du routage procédural (pistes, vias, sérigraphie) ;
//   ao : occlusion du décor cuite au sol ; energie : couleur de l'impulsion (défaut = impulsions d'alimentation) ;
//   impulsion : front parti du processeur au début de chaque vague (m/s, largeur m, gain du front, gain de la traîne,
//   durée s) ; cpu : gain de la couleur cuite, émissif au repos, éclat au début de vague, décroissance (1/s).
// ?plan=0 : carte d'avant ; ?plan=N : variante N (PLAN_VARIANTES).
export const PLAN_VARIANTES = [
  null,
  { nom: 'Plan cuit' },
  { nom: 'Plan cuit, sol épuré', proceduralGarde: 0 },
  { nom: 'Plan cuit, énergie cyan', energie: 0x7feeff },
  { nom: 'Plan cuit, énergie or', energie: 0xfff0c8 },
];
{
  const brut = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('plan');
  const n = Number(brut !== null ? brut : globalThis.__SR_PLAN ?? 1) | 0;
  const v = PLAN_VARIANTES[n] || null;
  PEINT.carte.plan = {
    actif: !!v && PEINT.theme === 'carte-mere',
    variante: n,
    nom: v ? v.nom : 'Sans plan',
    dossier: 'assets/carte/',
    emprise: 64,
    force: 1,
    proceduralGarde: 0.35,
    ao: 0.75,
    energie: 0x19c37d, // Femz 17/11 : vert émeraude (n° 1 de la planche des verts ; le vert néon 0x1aff5c refusé)
    // bruit fractal sur l'énergie (Femz : « texture fractal noise pour casser un peu ») : échelle (cycles par m), part
    // gardée au plus sombre (0 = trous noirs, 1 = sans bruit), dérive avec le front (m de bruit par m de front)
    bruit: { echelle: 0.32, plancher: 0.3, derive: 0.06 },
    piste: 0.65, // opacité des pistes cuites sur le vernis
    // secousse : trauma sec (Femz 17/11 « petit shake ») — remplacé par la houle douce (« camera shake smooth ») : 0
    // houle : balancement doux de la caméra (m d'écran, s, Hz, degrés de roulis), camera.addHoule
    impulsion: { vitesse: 46, largeur: 2.0, gain: 1.7, traine: 0.45, duree: 2.6, secousse: 0, houle: { amplitude: 0.32, duree: 1.8, frequence: 2.2, roulis: 0.45 } },
    cpu: { couleur: 0.66, repos: 0.0, eclat: 1.8, decroissance: 1.6 },
    // matérialisation du héros au lancement de la partie (pendant le « 3 ») : durée (s), hauteur balayée (m, le héros
    // + la cape), demi-épaisseur de la ligne et traîne (m), lueur du processeur pendant la compilation (gain)
    materialisation: { duree: 1.1, hauteur: 2.5, ligne: 0.05, traine: 0.55, lueurCpu: 1.2 }, // Femz 17/11 : capot « baisse un peu » (0,8 → 0,66)
    ...(v || {}),
  };
  if (globalThis.__SR_ENERGIE !== undefined) PEINT.carte.plan.energie = globalThis.__SR_ENERGIE; // planches de couleurs
}
const RETOUCHE_VALIDEE = 10; // 16/11/2026 : « Unités : dessus éclairci » choisie par Femz (= 8 « Sombre + grand halo », validée le 15/11, + robots et boss éclaircis par le dessus) ; défaut sans ?retouche=N
const RETOUCHE = (() => {
  if (typeof location === 'undefined') return RETOUCHE_VALIDEE;
  const n = new URLSearchParams(location.search).get('retouche');
  return Number(n !== null ? n : globalThis.__SR_RETOUCHE ?? RETOUCHE_VALIDEE) | 0;
})();
function fusion(cible, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cible[k] && typeof cible[k] === 'object') fusion(cible[k], v);
    else cible[k] = v;
  }
}
const SOLEIL_BOSS_AVANT_RETOUCHE = PEINT.profils.boss.soleil; // l'écran titre (bossMenu) garde le boss validé le 15/11
if (CM && RETOUCHES[RETOUCHE]) {
  const { nom, ...r } = RETOUCHES[RETOUCHE];
  fusion(PEINT, r);
}
export const RETOUCHE_CARTE = { indice: RETOUCHE, noms: RETOUCHES.map((r) => (r ? r.nom : 'Actuelle')) };
// ===== fin de la section « rendu:peint » =====

// ===== début de la section « modeles » (dans fondation:sections) =====
// Modèles Blender des unités (DA « Clash », docs/da-clash.md ; étape « modèles », ARCHITECTURE.md § Z quinquies).
// Fichiers relatifs à la racine du jeu (résolus depuis src/rendu/modeles.js : la page peut être servie d'un
// sous-dossier). Chargés en arrière-plan dès le démarrage, pendant l'écran titre ; la partie ne démarre qu'une fois
// tous chargés (une demande faite avant est gardée et servie à l'arrivée). Taille : chaque modèle est mis à la hauteur
// du jeu (PLAYER.height × PLAYER.visualScale, ENEMIES.types[t].height, BOSS.height, marchand ci-dessous × SHOP.merchant.scale)
// rapportée à sa hauteur DÉCLARÉE (racine.userData.hauteur, celle du script Blender) : à 1 près partout aujourd'hui.
export const MODELES = {
  dir: 'assets/modeles/',
  heros: 'heros.glb',
  // un modèle par agent (clé de AGENTS[].key) : mêmes nœuds que heros.glb (os, armes, bouches, tourelles, accroches de
  // cape), faits par outils/blender/agent_tripo.py ; le menu (menu/heros-menu.js) garde heros.glb
  agents: { eclaireur: 'heros.glb', bastion: 'agent-bastion.glb', shinobi: 'agent-shinobi.glb' },
  marchand: 'marchand.glb',
  boss: 'boss.glb', // un fichier : corps (phase 1) et surcouche incandescente (nœuds extras.phase = 2), même échelle
  // par clé de ENEMY_KEYS (le boss a son propre fichier ci-dessus)
  robots: {
    rodeur: 'rodeur.glb',
    drone: 'drone.glb',
    tireur: 'tireur.glb',
    kamikaze: 'kamikaze.glb',
    blinde: 'blinde.glb',
    reparateur: 'reparateur.glb',
  },
  marchandHauteur: 2.4, // m à SHOP.merchant.scale = 1 (hauteur déclarée de marchand.glb)
};
// ===== fin de la section « modeles » =====

// ----- WORLD : arène, obstacles, lumières -------------------------------------------------------------
export const WORLD = {
  arenaSize: 120, // m — carré jouable, centré sur l'origine
  half: 60, // m — |x|, |z| ≤ half − rayon
  groundSize: 280, // m — sol étendu sous et derrière les falaises : aucun bord visible jusqu'au 32:9
  // Falaises procédurales : repli seulement (décor .glb absent ou illisible, voir decor ci-dessous)
  cliffs: { heightMin: 5, heightMax: 9, depth: 10, segment: 6 },
  rocks: { count: 26, radiusMin: 0.9, radiusMax: 2.4 },
  carcasses: { count: 14, radiusMin: 1.1, radiusMax: 1.8 },
  clearRadius: 9, // m — aucun obstacle autour du point de départ (origine)
  minGap: 3.5, // m — passage minimal entre deux obstacles
  edgeMargin: 4, // m — aucun obstacle à moins de cette distance des falaises
  seed: 20261112, // l'arène est la même à chaque partie (rien à régénérer à « Rejouer »)
  obstacleCell: 8, // m — maille de la grille statique des obstacles
  obstacleMargin: 3, // m — rayon jusqu'auquel une requête d'obstacle ne lit que la cellule de son centre
  blockEnemyShots: true, // les rochers arrêtent les tirs des tireurs (abri pour le joueur)
  blockPlayerShots: false, // les tirs du joueur traversent (lisibilité)
  // Rendu peint (§ Z quater) : soleil, ciel et ombres sont réglés dans PEINT (soleil donné par rapport à l'écran).
  // sunDir = direction VERS ce soleil dans le monde, calculée depuis PEINT.soleil et CAMERA.yawDeg (même calcul que
  // src/rendu/lumiere.js) : fx.js (facettes des étincelles) et shop.js l'utilisent. Lue à l'init seulement.
  light: {
    get sunDir() {
      return sunDirFromScreen();
    },
  },
  // Décor modélisé sous Blender (rochers, falaises, carcasses) : manifeste et fichiers, relatifs à la racine du jeu
  // (world.js les résout depuis son propre emplacement : la page peut être servie d'un sous-dossier). Chargé avant
  // le démarrage ; absent ou illisible, le décor procédural de src/rendu/sol.js le remplace.
  decor: { dir: 'assets/modeles/decor/', manifest: CM ? 'manifeste-carte-mere.json' : 'manifeste.json' },
};

/** Direction (normalisée) VERS le soleil peint, dans le monde. */
function sunDirFromScreen() {
  const yaw = (CAMERA.yawDeg * Math.PI) / 180;
  const rX = Math.cos(yaw);
  const rZ = -Math.sin(yaw);
  const uX = -Math.sin(yaw);
  const uZ = -Math.cos(yaw);
  const S = PEINT.soleil;
  let hx = -rX * S.depuisGauche - uX * S.versCamera;
  let hz = -rZ * S.depuisGauche - uZ * S.versCamera;
  const hl = Math.hypot(hx, hz);
  hx /= hl;
  hz /= hl;
  const el = (S.elevationDeg * Math.PI) / 180;
  return [hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)];
}

// ----- CAMERA : orthographique 3/4 --------------------------------------------------------------------
export const CAMERA = {
  viewHeight: 32, // m visibles en hauteur (plan de l'écran) ; largeur = viewHeight × ratio
  pitchDeg: 55, // inclinaison sous l'horizontale (90 = à la verticale)
  yawDeg: 20, // léger 3/4 : rotation autour de Y (0 = « haut » de l'écran = −Z du monde)
  distance: 80, // m entre la caméra et sa cible (sans effet sur la taille : projection ortho)
  near: 1,
  far: 220,
  followRate: 10, // 1/s — lissage exponentiel du suivi : a = 1 − exp(−followRate × dt)
  punch: { max: 0.03, returnSeconds: 0.15 }, // punch de zoom ±3 %, retour en 150 ms
  // Avance (plan des animations § P5, prototype src/anim/camera-anim.js intégré le 13/11) : la caméra vise P + lead ;
  // lead rejoint la vitesse RÉELLE du joueur (déplacement de l'image) × seconds, bornée à max, lissée à rate (temps
  // réel) : 1,6 m d'avance à la course au lieu de 0,55 m de retard ; le dash (24 m/s) est borné et lissé. Repli : seconds = 0.
  lead: { seconds: 0.25, max: 2.0, rate: 4 },
};

// ----- SHAKE : secousses à « trauma » (intensités et plafonds du cahier) ------------------------------
export const SHAKE = {
  decayPerSec: 1.5, // le trauma décroît de 1,5 par seconde (temps réel)
  maxOffset: 0.8, // m dans le plan de l'écran pour trauma = 1 et intensité = 100 %
  maxRollDeg: 1.2, // roulis pour trauma = 1
  frequency: 12, // Hz du bruit lissé — animations (13/11) : 24 → 12, le saut d'une image reste ≤ ~0,3 m à trauma 1 (plan : 14)
  // Animations (13/11, décisions de Femz après l'étude de Vampire Survivors) :
  attaque: 0.03, // s — l'amplitude appliquée MONTE vers le trauma avec cette constante (une explosion ne saute plus de 0,66 m en une image)
  relance: 0.5, // limite d'accumulation : une demande est ignorée tant que le trauma vivant de son groupe dépasse relance × groupCap
  // Coup directionnel (addTraumaAt) : ressort critique qui pousse la caméra de la source vers la cible, amplitude
  // perTrauma × trauma accordé × intensité, borné à max (m). Plan : 0,6 / 30 — mesuré : 0,9 m de saut, trop sec.
  kick: { perTrauma: 0.3, omega: 18, max: 0.4 },
  noiseTableSize: 256,
  defaultIntensity: 1, // réglage « Intensité des secousses » (0 à 1)
  // Plafond par groupe et par seconde GLISSANTE (fenêtre de capWindow s découpée en capSlots tranches).
  capWindow: 1.0,
  capSlots: 10,
  groupOf: [0, 0, 1, 2, 3, 4], // index = TRAUMA.* → groupe
  groupNames: ['auto', 'playerExplosion', 'enemyExplosion', 'playerHit', 'boss'],
  groupCap: [
    0.25, // auto : tirs automatiques + kills, cumulés (cahier)
    0.45, // explosions des roquettes du joueur (une vraie secousse par seconde au plus) — choix, § Y
    1.0, // explosions ennemies — choix, § Y
    0.7, // dégâts reçus (2 coups par seconde au plus à cause de l'invulnérabilité) — choix, § Y
    1.0, // événements de boss — choix, § Y
  ],
  amounts: {
    fireLight: 0, // blaster, orbitaux, aura (cahier)
    fireShotgun: 0.04, // la pompe n'est ni dans les tirs légers ni dans les tirs lourds du cahier — choix, § Y
    fireRail: 0.14, // tir lourd : 0,1 à 0,2 (cahier)
    fireRocket: 0.1, // tir lourd : 0,1 à 0,2 (cahier)
    kill: 0.02, // cahier
    killBig: 0.02, // blindé : même valeur que kill (cahier) ; le poids du coup vient du hitstop. Levier d'intégration.
    playerHit: 0.35, // cahier
    explosionRocket: 0.4, // explosions : 0,4 à 0,6, atténuées avec la distance (cahier)
    explosionKamikaze: 0.5,
    explosionMortar: 0.4, // obus du boss (phase 2)
    explosionBoss: 0.6, // frappe au sol du boss
    bossArrival: 0.7, // cahier
    bossPhase: 0.5, // événement absent du cahier — choix, § Y
    bossDeath: 0.7, // événement absent du cahier : aligné sur l'arrivée — choix, § Y
  },
  // Atténuation avec la distance d (m) entre l'explosion et la cible de la caméra :
  // facteur = clamp(1 − (d − fullWithin) / (zeroAt − fullWithin), floor, 1)
  falloff: { fullWithin: 4, zeroAt: 40, floor: 0.15 },
  // Punch de zoom (cahier : ±3 %, retour en 150 ms, sur les explosions et les coups de boss). Fraction de zoom,
  // positif = zoom avant. Le punch d'une explosion est réduit comme sa secousse (distance et plafond, § H.3).
  punch: { explosion: 0.03, bossHit: 0.03 },
  punchMinInterval: 0.25, // s — un punch demandé plus tôt n'est accepté que s'il est plus fort que le précédent
};

// ----- RENDER : rendu, post-traitement, qualité -------------------------------------------------------
export const RENDER = {
  // Échelle de qualité : on part du niveau 0. On ne descend que si la cadence reste basse, et on retente le niveau
  // du dessus quand elle est redevenue bonne (adaptive, ci-dessous).
  // Rapport de pixels effectif = min(devicePixelRatio, pixelRatio, √(maxPixels / (largeur CSS × hauteur CSS))) :
  // le coût suit le NOMBRE de pixels (mesuré), donc on le borne aussi ; le rapport peut passer sous 1.
  // MSAA effectif = msaa, divisé par deux tant que pixels × échantillons > maxSamples : à la densité d'un écran
  // Retina le niveau 0 rend à la définition de l'écran avec 2 échantillons, pour le coût d'un rendu ×1,5 à 4.
  quality: [
    { pixelRatio: 2.0, maxPixels: 8.0e6, msaa: 4, maxSamples: 18e6, bloom: true }, // MacBook Pro 16" plein écran : 3456 × 2234, MSAA 2
    { pixelRatio: 1.25, maxPixels: 3.0e6, msaa: 2, bloom: true },
    { pixelRatio: 1.0, maxPixels: 2.0e6, msaa: 0, bloom: true },
    { pixelRatio: 1.0, maxPixels: 1.3e6, msaa: 0, bloom: false }, // dernier levier : plus de bloom
  ],
  adaptive: {
    enabled: true,
    windowSeconds: 1, // fenêtre d'observation
    dropBelowFps: 48, // image « lente » = intervalle > 1000 / 48 ms (un écran à 50 Hz ne déclenche rien)
    slowShare: 0.5, // une fenêtre est lente si plus de la moitié de ses images le sont
    minFrames: 10, // la fenêtre dure au moins windowSeconds ET ce nombre d'images (elle s'allonge sous 10 i/s)
    settleSeconds: 0.5, // images ignorées après un changement de niveau ou un redimensionnement
    dropAfterWindows: 3, // on descend après ce nombre de fenêtres lentes DE SUITE (un ralentissement passager ne coûte rien)
    minGain: 0.1, // une descente « sert » si l'intervalle moyen de la fenêtre suivante baisse d'au moins 10 %
    noGainDrops: 2, // après ce nombre de descentes de suite sans effet, on les annule et on n'adapte plus
    //                 (cadence bridée par autre chose que le rendu : économie d'énergie, écran à 30 Hz…)
    raiseAfterSeconds: 20, // fenêtres propres de suite avant de retenter le niveau du dessus
    probeSeconds: 5, // période d'essai d'une remontée : une seule fenêtre lente la fait échouer (retour, et ce
    //                  niveau n'est plus retenté)
  },
  dprPollSeconds: 0.5, // relecture de window.devicePixelRatio (changement d'écran sans « resize »)
  // Rendu peint (§ Z quater) : le bloom (multi-niveaux, garde-fou de la horde), les ombres (carte qui suit la vue,
  // ombre figée du décor) et la passe finale sont réglés dans PEINT (bloom, ombre, ombreStatique, post). L'ancien
  // bloom resserré à un niveau (RENDER.bloom) et l'ombre carrée de world.js (RENDER.shadow) sont retirés.
  vignette: { strength: PEINT.post.vignette, start: PEINT.post.vignetteDebut }, // valeurs de PEINT.post
  emissiveBoost: 1.5, // les sommets émissifs sortent à couleur × 1,5, sans éclairage (canal le plus fort > seuil du bloom)
  flashEmissive: 0.9, // émissif blanc ajouté pendant le flash
  clearColor: 0x6f4729,
  drawCallBudget: 80, // appels de dessin par image, post-traitement compris (contrôlé par les tests)
  // Décalques au sol (matériau transparent, depthWrite: false) : hauteur (m) et renderOrder de chacun,
  // pour qu'ils ne scintillent ni contre le sol ni entre eux.
  decals: {
    telegraph: { y: 0.03, order: 1 }, // zones télégraphiées du boss
    ring: { y: 0.07, order: 3 }, // anneaux de fx (explosions, dash, soin, pose du marchand)
    numbersOrder: 10, // chiffres de dégâts : rendus après tout le reste
  },
  // Intégration : renderOrder des effets OPAQUES (éclats, étincelles, tirs du joueur et des robots, disques, butin).
  // (Historique : l'anneau du joueur PLAYER.marker, retiré à l'étape « animations », passait par-dessus les robots ; les
  // effets, dessinés après lui, gardaient leur test de profondeur. Les repères R1 / R2 sont posés au sol, § Z sexies.)
  effectsOrder: 2.5,
};

// ----- GRID : grille spatiale des robots --------------------------------------------------------------
export const GRID = {
  cellSize: 2, // m
  min: -64, // m — bord de la grille (couvre l'arène ±60 avec marge)
  dim: 64, // cellules par côté (puissance de 2) → 4096 cellules
  densestBlock: 3, // les roquettes cherchent le bloc de 3×3 cellules le plus peuplé
};

// ----- INPUT : touches (KeyboardEvent.code = position physique, donc ZQSD et WASD sans réglage) -------
export const INPUT = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  // index = ACTION.*
  actions: [
    ['Space'], // DASH
    ['Escape'], // PAUSE
    ['Enter', 'NumpadEnter'], // CONFIRM
    ['Digit1', 'Numpad1'], // CHOICE_1
    ['Digit2', 'Numpad2'], // CHOICE_2
    ['Digit3', 'Numpad3'], // CHOICE_3
    ['F1'],
    ['F2'],
    ['F3'],
    ['F4'],
    ['F5'],
    ['F6'],
    ['KeyR'],
    ['KeyX'],
    ['KeyB'],
  ],
  // Espace et flèches : pas de défilement de page. Entrée : sans cela le navigateur « re-clique » le bouton
  // resté focalisé après un clic (vérifié dans Chromium et Firefox : 2 clics comptés) — un second achat
  // involontaire dans la boutique.
  preventDefault: ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'NumpadEnter'],
  preventDefaultDebug: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'],
};

// ----- PLAYER -----------------------------------------------------------------------------------------
export const PLAYER = {
  maxHp: 100,
  speed: 6.5, // m/s
  accel: 70, // m/s² — montée en vitesse (réactif, sans glisse)
  radius: 0.5,
  height: 1.8,
  turnRate: 18, // 1/s — lissage de l'orientation du modèle
  dash: {
    speed: 24, // m/s → ≈ 4,3 m parcourus
    duration: 0.18, // s — invulnérable pendant toute la durée
    cooldown: 3.0, // s (× mods.dashCdMul)
    invulnExtra: 0.1, // s d'invulnérabilité après la fin du dash
    ringRadius: 1.4, // m — anneau au sol au départ du dash
  },
  hitInvuln: 0.5, // s d'invulnérabilité après un coup reçu
  critChance: 0.05, // de base (+ mods.critChanceAdd)
  critMul: 2.0,
  enemyPushOut: true, // les robots sont repoussés hors du cercle du joueur (ils l'encerclent)
  // Repère du joueur dans une horde : modèle agrandi (visualScale ; le rayon de collision ne change pas). L'anneau
  // « marker » et la silhouette de l'intégration sont remplacés par les repères au sol R1 / R2 (ANIM.reperes) et la
  // silhouette du héros animé (ANIM.heros.xrayShade) — étape « animations », § Z sexies.
  visualScale: 1.15,
};

// ----- DAMAGE : constantes du pipeline de dégâts ------------------------------------------------------
export const DAMAGE = {
  explosionEdgeFactor: 0.5, // dégâts au bord d'une explosion = 50 % (linéaire du centre au bord)
  knockbackDamp: 9, // 1/s — amortissement du recul des robots
  bigTypes: [ENEMY.BLINDE, ENEMY.BOSS], // « gros » robots : ombre, hitstop à la mort, secousse killBig
  minNumber: 1, // pas de chiffre affiché sous 1 point de dégâts
  // Intégration : un coup des sources listées (aura et arcs de l'EMP, dégâts continus) ne blanchit le robot qu'à ce
  // niveau au lieu de 1. Sans cela, chaque impulsion de l'EMP rendait toute la horde de l'aura blanche en même temps
  // (lot weapons). Le sens de DMG.NO_IMPACT (ni son ni étincelle) ne change pas. Les roquettes aussi (seconde passe de
  // l'intégration) : une explosion de 5 m blanchissait d'un coup ~80 robots en une tache blanche sans détail (mesuré :
  // 78 robots à E.flash > 0,5 dans une horde de 400) ; l'éclair central et l'anneau de l'explosion disent déjà le coup.
  softFlash: 0.3,
  softFlashSources: [WEAPON.EMP, WEAPON.ROCKETS],
};

// ----- STORAGE : localStorage (toujours sous try/catch) -----------------------------------------------
export const STORAGE = {
  bestKey: 'survivor-robots:best:v1', // JSON { wave, kills, level, time }
  settingsKey: 'survivor-robots:settings:v1', // JSON { shake: 0..1, volume: 0..1 }
  infosKey: 'survivor-robots:infos:v1', // '1' = panneau d'infos de l'écran titre déplié, sinon replié
  metaKey: 'survivor-robots:meta:v1', // JSON de src/meta.js (évolutions et fusions découvertes ; étape 4 : déblocages)
  metaPrecedenteKey: 'survivor-robots:meta:v1:precedente', // § E5.X2 : la méta lue au lancement (relue si la courante est abîmée)
  metaAbimeeKey: 'survivor-robots:meta:v1:abimee', // § E5.X2 : 1re méta illisible, gardée telle quelle (jamais écrasée)
};

// ----- DEBUG : actif seulement si l'URL contient ?debug -----------------------------------------------
export const DEBUG = {
  urlFlag: 'debug',
  seedParam: 'seed', // ?debug&seed=123 : graine des générateurs (suite des vagues identique à graine égale)
  defaultSeed: 1,
  fragmentsBonus: 500, // F2
  levelBonus: 1, // F3
  hordeCount: 400, // F6
  hordeType: ENEMY.RODEUR,
  hordeMinDist: 6, // m — pas de rôdeur à moins de 6 m du joueur
  hordeViewFraction: 0.92, // la horde est répartie dans 92 % du rectangle visible (elle est À L'ÉCRAN)
  overlayRefresh: 0.25, // s entre deux mises à jour de l'affichage F5
  fpsWindow: 1.0, // s — fenêtre de la moyenne de cadence
};
//#endregion fondation:sections

//#region lot:weapons
// =====================================================================================================
// 2. LOT « weapons » — les 6 armes : 5 stats × 5 niveaux, coûts, constantes de comportement.
// =====================================================================================================
// stats[STAT.x][niveau − 1]. Les 5 valeurs d'une stat sont STRICTEMENT CROISSANTES (critère 5 du cahier ;
// contrôlé par node tests/equilibrage.mjs).
// Stat effective : voir ARCHITECTURE.md § I (dégâts × mods.damageMul, cadence × mods.fireRateMul,
// zone × mods.areaMul, et spéciale × mods.areaMul si specialScalesWithArea).
// Prix d'une amélioration du niveau L au niveau L+1 : round(upgradeBase × statCostMul[stat] × 1,5^L).
// knockback (m/s) : recul appliqué par l'arme à chaque robot touché (§ I.2) ; absent = pas de recul.
// hitstopOnKill : l'arme passe DMG.HEAVY à hitEnemy (hitstop de 40 ms si le coup tue).
export const WEAPONS = [
  {
    id: WEAPON.BLASTER,
    key: 'blaster',
    name: 'Blaster',
    desc: "Tire tout seul sur le robot le plus proche.",
    unlockWave: 1, // possédé au départ
    unlockCost: 0,
    upgradeBase: 14,
    bypassShield: false,
    hitstopOnKill: false,
    fireTrauma: SHAKE.amounts.fireLight,
    sfx: SFX.BLASTER,
    statLabels: ['Dégâts', 'Cadence', 'Projectiles', 'Portée', 'Perforation'],
    statUnits: ['', '/s', '', 'm', ''],
    specialScalesWithArea: false,
    stats: [
      [10, 12, 15, 18, 22], // dégâts par tir
      [2.0, 2.3, 2.7, 3.1, 3.6], // tirs par seconde
      [1, 2, 3, 4, 5], // un projectile par cible : les N ennemis les plus proches
      [14, 16, 18, 20, 22], // portée (m)
      [0, 1, 2, 3, 4], // ennemis traversés en plus du premier
    ],
    projectileSpeed: 36, // m/s
    projectileRadius: 0.2,
    knockback: 0.6, // m/s
    fanDeg: 7, // écart entre projectiles quand il y a moins de cibles que de projectiles
    muzzle: 0.45, // m — le tir part du canon, à cette distance du centre du joueur ; la portée reste comptée du centre
    shotHeight: 1.0, // m au-dessus du sol
    impactLinger: 0.06, // s — un tir arrêté par un impact reste affiché, figé et aminci (lisible même au contact)
  },
  {
    id: WEAPON.ORBITALS,
    key: 'orbitals',
    name: 'Disques orbitaux',
    desc: "Des disques tournent autour de vous et coupent les robots qui s'approchent.",
    unlockWave: 2,
    unlockCost: 50,
    upgradeBase: 16,
    bypassShield: true,
    hitstopOnKill: false,
    fireTrauma: SHAKE.amounts.fireLight,
    sfx: SFX.ORBITAL,
    statLabels: ['Dégâts', 'Vitesse', 'Disques', 'Orbite', 'Taille'],
    statUnits: ['', 'tr/s', '', 'm', 'm'],
    specialScalesWithArea: true,
    stats: [
      [12, 15, 18, 22, 26], // dégâts par contact
      [0.45, 0.55, 0.66, 0.78, 0.9], // tours par seconde
      [2, 3, 4, 5, 6], // nombre de disques
      [2.6, 3.0, 3.4, 3.8, 4.2], // rayon de l'orbite (m)
      [0.45, 0.55, 0.65, 0.75, 0.85], // rayon d'un disque (m)
    ],
    // Délai avant qu'un même robot puisse être retouché (E.orbitCd) = hitFactor / (disques × tours par seconde),
    // soit un coup par PASSAGE de disque : acheter « Vitesse » ou « Disques » ajoute toujours des coups
    // (0,90 passage/s au niveau 1, 5,4 au niveau 5). Formule : orbitalHitDelay() en fin de fichier.
    // Le délai est tenu à toute cadence : weapons.updateOrbitals calcule l'instant exact du contact dans l'image
    // (arc de contact de chaque robot) et fait partir le délai suivant de cet instant-là, pas de la fin de l'image.
    hitFactor: 0.9,
    height: 1.0, // m au-dessus du sol
    knockback: 1.5,
    maxHitsPerFrame: 4, // coups de disque au plus sur un même robot pendant une image (plusieurs seulement si le délai est plus court qu'une image)
    spinHz: 1.4, // tours par seconde du disque sur lui-même (visuel seulement)
  },
  {
    id: WEAPON.SHOTGUN,
    key: 'shotgun',
    name: 'Fusil à pompe',
    desc: "Tire une gerbe de plombs vers le groupe de robots le plus proche : très fort de près.",
    unlockWave: 3,
    unlockCost: 90,
    upgradeBase: 18,
    bypassShield: false,
    hitstopOnKill: false,
    fireTrauma: SHAKE.amounts.fireShotgun,
    sfx: SFX.SHOTGUN,
    statLabels: ['Dégâts', 'Cadence', 'Plombs', 'Portée', 'Recul'],
    statUnits: ['', '/s', '', 'm', 'm/s'],
    specialScalesWithArea: false,
    stats: [
      [7, 9, 11, 14, 17], // dégâts par plomb
      [0.8, 0.95, 1.1, 1.3, 1.5], // tirs par seconde
      [5, 6, 8, 10, 12], // plombs par tir
      [9, 10, 11, 12, 13], // portée (m)
      [3, 4.5, 6, 7.5, 9], // recul infligé (m/s)
    ],
    coneDeg: 38, // ouverture totale du cône
    projectileSpeed: 30,
    projectileRadius: 0.14,
    groupCandidates: 8, // directions testées (les 8 ennemis les plus proches) pour trouver le cône le plus rempli
    muzzle: 0.45, // m — les plombs partent du canon ; la portée reste comptée du centre du joueur
    shotHeight: 1.0, // m au-dessus du sol
    impactLinger: 0.06, // s — un plomb arrêté par un impact reste affiché, figé et aminci
    spreadJitter: 0.3, // écart aléatoire d'un plomb, en fraction de l'angle entre deux plombs voisins (le plomb central reste dans l'axe)
    speedJitter: 0.1, // ± variation de vitesse d'un plomb à l'autre (la portée de chacun reste exacte)
  },
  {
    id: WEAPON.EMP,
    key: 'emp',
    name: 'Champ EMP',
    desc: "Une aura autour de vous blesse et ralentit les robots ; des arcs électriques touchent ceux qui sont plus loin.",
    unlockWave: 4,
    unlockCost: 130,
    upgradeBase: 20,
    bypassShield: true,
    hitstopOnKill: false,
    fireTrauma: SHAKE.amounts.fireLight,
    sfx: SFX.EMP,
    statLabels: ['Dégâts', 'Impulsions', 'Arcs', 'Rayon', 'Ralentissement'],
    statUnits: ['', '/s', '', 'm', '%'],
    specialScalesWithArea: false,
    stats: [
      [3, 4, 5, 6.5, 8], // dégâts par impulsion et par robot
      [1.5, 1.8, 2.2, 2.6, 3.0], // impulsions par seconde
      [2, 3, 4, 6, 8], // arcs par impulsion : les N robots les plus proches HORS de l'aura, jusqu'à arcRangeMul × rayon
      [4.0, 4.6, 5.2, 5.8, 6.5], // rayon de l'aura (m) : TOUS les robots dedans sont touchés et ralentis
      [25, 32, 39, 46, 53], // ralentissement (%) ; vitesse × (1 − valeur / 100)
    ],
    slowSeconds: 1.2, // durée du ralentissement, rafraîchie à chaque impulsion
    arcRangeMul: 1.8, // portée des arcs = rayon de l'aura × 1,8
    arcSeconds: 0.15, // durée d'affichage d'un arc (0,1 s : à peine vu dans une vague réelle)
    noCrit: true, // dégâts continus : pas de critique, chiffres regroupés, ni son ni étincelle par robot (DMG.NO_IMPACT)
    pulseSeconds: 0.28, // durée de l'éclat de l'anneau à chaque impulsion
    arcSegments: 3, // segments d'un arc (éclair brisé). CAPS.beams compte les arcs et les rayons affichés, pas leurs segments : le maillage a CAPS.beams × arcSegments emplacements
    arcJitter: 0.16, // écart latéral des brisures, en fraction de la longueur de l'arc
    arcHeight: 1.45, // m au-dessus du sol : au-dessus des rôdeurs (1,3 m), l'arc se lit par-dessus la horde au lieu de passer dans les robots
  },
  {
    id: WEAPON.RAIL,
    key: 'rail',
    name: 'Fusil à rail',
    desc: "Un rayon traverse toute une ligne de robots, en visant le plus résistant.",
    unlockWave: 5,
    unlockCost: 170,
    upgradeBase: 26,
    bypassShield: false,
    hitstopOnKill: true, // hitstop de 40 ms quand un tir tue (gros coup) : l'arme passe DMG.HEAVY
    fireTrauma: SHAKE.amounts.fireRail,
    sfx: SFX.RAIL,
    statLabels: ['Dégâts', 'Cadence', 'Rayons', 'Portée', 'Largeur'],
    statUnits: ['', '/s', '', 'm', 'm'],
    specialScalesWithArea: true,
    stats: [
      [55, 70, 88, 108, 130], // dégâts par robot traversé
      [0.3, 0.36, 0.43, 0.51, 0.6], // tirs par seconde
      [1, 2, 3, 4, 5], // rayons : le k-ième vise le k-ième robot qui a le plus de PV
      [22, 25, 28, 31, 34], // portée (m)
      [0.5, 0.7, 0.9, 1.1, 1.3], // largeur du rayon (m)
    ],
    beamSeconds: 0.14, // durée d'affichage du rayon
    spreadDeg: 14, // écart minimal entre deux rayons d'une salve qui visent des robots aux MÊMES PV : les rayons se répartissent au lieu de repasser dans le même couloir (les PV passent toujours avant)
    knockback: 2.5,
    muzzle: 0.45, // m — le rayon AFFICHÉ part du canon ; le rayon de collision part du centre du joueur
    beamHeight: 1.1, // m au-dessus du sol
    beamWidthScale: 1.0, // largeur affichée = largeur de collision × ce facteur (bords fondus : le cœur lumineux en fait la moitié)
  },
  {
    id: WEAPON.ROCKETS,
    key: 'rockets',
    name: 'Roquettes',
    desc: "Des roquettes visent le plus gros groupe de robots et explosent sur une zone.",
    unlockWave: 7,
    unlockCost: 240,
    upgradeBase: 32,
    bypassShield: true,
    hitstopOnKill: false, // trop fréquent en horde : la secousse d'explosion suffit
    fireTrauma: SHAKE.amounts.fireRocket,
    sfx: SFX.ROCKET,
    statLabels: ['Dégâts', 'Cadence', 'Roquettes', 'Portée', 'Explosion'],
    statUnits: ['', '/s', '', 'm', 'm'],
    specialScalesWithArea: true,
    stats: [
      [40, 50, 62, 76, 92], // dégâts au centre de l'explosion
      [0.4, 0.46, 0.53, 0.61, 0.7], // salves par seconde
      [1, 2, 3, 4, 5], // roquettes par salve : une par paquet, du plus gros au moins gros
      [16, 18, 20, 22, 24], // portée (m)
      [2.5, 2.9, 3.3, 3.7, 4.2], // rayon de l'explosion (m)
    ],
    projectileSpeed: 17, // m/s
    projectileRadius: 0.3,
    leadRadius: 3, // m — la roquette vise le point où le paquet SERA à son arrivée : vitesse moyenne des robots à moins de cette distance du barycentre (la moitié d'un bloc de GRID.densestBlock cellules)
    leadMaxSpeed: 8, // m/s — vitesse de paquet prise en compte au plus (au-dessus du robot le plus rapide : un recul reçu à l'instant ne compte pas)
    arcHeight: 2.2, // m — cloche purement visuelle
    explosionTrauma: SHAKE.amounts.explosionRocket,
    explosionPunch: SHAKE.punch.explosion,
    knockback: 4, // recul radial, appliqué par damage.explode à chaque robot touché
    muzzle: 0.5, // m — la roquette part du canon
    shotHeight: 1.1, // m au-dessus du sol au départ et à l'arrivée
    arcFullDistance: 10, // m — en dessous de cette distance de vol la cloche est proportionnellement plus basse
  },
];

/**
 * Prix. Cahier : « coût = base × 1,5^niveau ». Lecture retenue (ARCHITECTURE.md § I.1 et § Y) :
 * base = WEAPONS[w].upgradeBase × statCostMul[stat] (une base par stat : le nombre de projectiles coûte
 * plus cher), niveau = niveau ACTUEL de la stat (1 à 4). L'achat de l'arme a son prix à part (unlockCost).
 */
export const WEAPON_COSTS = {
  growth: 1.5, // coût = base × 1,5^niveau (cahier)
  statCostMul: [1.0, 1.0, 2.0, 0.8, 1.0], // index = STAT.*
  startWeapon: WEAPON.BLASTER,
};
//#endregion lot:weapons

//#region lot:enemies
// =====================================================================================================
// 3. LOT « enemies » — les 7 robots (le boss a sa section BOSS, lot « boss »).
// =====================================================================================================
// hp et contactDmg sont multipliés à l'apparition par le multiplicateur de vague (WAVES.hpGrowth…).
// bodyColor = PALETTE.robot pour TOUS (cahier : gris métal #4A4E57) ; accentColor ne sert qu'aux pièces
// secondaires ; la silhouette se distingue par la forme, la taille et la couleur des yeux.
// weight : poids dans la composition d'une vague = base + perWave × (vague − unlockWave), plafonné à
// maxShare du total (voir ARCHITECTURE.md § K).
// GELÉ pendant la phase parallèle : unlockWave, weight et specialWaveEligible (la composition des vagues
// appartient au lot waves-shop, qui ne peut pas écrire ici) ; un besoin se signale dans le rapport.
export const ENEMIES = {
  common: {
    separationStrength: 14, // m/s de poussée pour un chevauchement complet
    crowdBrake: 4, // frein de foule : vitesse voulue × (1 − crowdBrake × chevauchement avec les voisins de devant)
    crowdMinSpeed: 0.1, // …sans descendre sous cette fraction (la meute se resserre quand même)
    maxNeighbors: 12, // voisins pris en compte pour la séparation
    contactInterval: 0.8, // s entre deux coups de contact d'un même robot
    slowFloor: 0.3, // un robot ne descend jamais sous 30 % de sa vitesse
    spawnFadeSeconds: 0.25, // montée d'échelle à l'apparition
    bobHz: 2.2, // rebond procédural — valeurs par défaut : le bloc « anim » d'un type les remplace
    bobAmp: 0.08, // m
    swayAmp: 0.1, // rad — balancement
    leanFwd: 0.07, // rad — penché vers l'avant : le robot fonce
    arrowHeight: 1.0, // m — hauteur du point visé par les flèches de bord d'écran
    glowFade: 2.5, // 1/s — extinction de la lueur (E.glow) dès que plus rien ne l'entretient (visée, mèche, impulsion du réparateur) : 0,4 s depuis 1 ; la teinte d'un soin reçu suit healTintSeconds
    // Lueur d'un robot qui vient d'être soigné (types dont glowColor = PALETTE.eyeReparateur) : une teinte verte, le gris
    // et l'œil restent lisibles. Elle s'AJOUTE en émissif (en linéaire, presque 1 pour 1) au vert d'un corps gris très
    // sombre (≈ 0,07) : mesuré sur la capture de l'image du soin (blindé), 0,06 donne déjà un corps rgb(77, 102, 88) ;
    // 0,14 et au-delà, vert uni (0,45 : rgb(102, 158, 103), et un nuage vert autour du joueur). Le réparateur, lui,
    // s'allume en plein (1) à chaque impulsion.
    healGlow: 0.03,
    healTintSeconds: 0.4, // s — durée de cette teinte (elle s'éteint à healGlow / healTintSeconds par seconde, pas à glowFade)
    keepRamp: 1.2, // m — un robot « à distance » (tireur, réparateur) passe de l'arrêt à sa pleine vitesse sur cette marge, hors de sa zone (pas d'à-coup)
  },
  // Bloc « anim » de chaque type (animation procédurale, calculée dans enemies.sync, sans effet sur la simulation) :
  // bobHz / bobAmp = rebond (Hz, m) ; swayAmp = balancement latéral (rad) ; lean = penché vers l'avant (rad) ;
  // glide = rebond lissé (vol) au lieu d'un pas marqué. Les angles restent petits (gabarit du § G.3).
  types: [
    {
      id: ENEMY.RODEUR,
      key: 'rodeur',
      name: 'Rôdeur',
      unlockWave: 1,
      hp: 20,
      speed: 3.4,
      radius: 0.5,
      height: 1.3,
      hover: 0,
      contactDmg: 8,
      mass: 1,
      gemXp: 10,
      fragChance: 0.3,
      fragValue: 6,
      castShadow: false,
      bodyColor: PALETTE.robot,
      accentColor: PALETTE.robotDark, // pièces secondaires
      eyeColor: PALETTE.robotEye,
      glowColor: PALETTE.eyeReparateur, // seule lueur d'un rôdeur : le vert d'un soin reçu
      weight: { base: 10, perWave: 0, maxShare: 1 },
      specialWaveEligible: true,
      anim: { bobHz: 2.2, bobAmp: 0.08, swayAmp: 0.1, lean: 0.07, glide: false }, // pas lourd, il fonce
    },
    {
      id: ENEMY.DRONE,
      key: 'drone',
      name: 'Drone',
      unlockWave: 2,
      hp: 10,
      speed: 6.0,
      radius: 0.38,
      height: 0.5,
      hover: 1.3, // vole : ignore les obstacles
      contactDmg: 5,
      mass: 0.5,
      gemXp: 6,
      fragChance: 0.2,
      fragValue: 4,
      castShadow: false,
      bodyColor: PALETTE.robot,
      accentColor: PALETTE.robotLight, // pièces secondaires
      eyeColor: PALETTE.robotEye,
      glowColor: PALETTE.eyeReparateur, // seule lueur d'un drone : le vert d'un soin reçu
      weight: { base: 3, perWave: 0.5, maxShare: 0.35 },
      specialWaveEligible: true,
      // Zigzag : vitesse latérale = vitesse × amp × clamp(sharp × sin(2π × hz × t), −1, 1), en plus de l'avance
      // vers le joueur. sharp > 1 donne des bords francs (un vrai zigzag, pas une sinusoïde) : à 6 m/s, amp 0,7 et
      // 1 Hz, il balaie environ 2 m de large (mesuré : 2,06 m). Les drones nés ensemble zigzaguent presque en phase (essaim).
      weave: {
        amp: 0.7, // fraction de la vitesse
        hz: 1.0, // allers-retours par seconde
        sharp: 3, // raideur des changements de côté
        fadeDist: 3, // m — le zigzag s'éteint à l'approche du joueur (le drone finit par toucher)
        yaw: 0.5, // rad de lacet par unité de vitesse latérale : le nez suit le virage
        swarmPhase: 0.15, // rad de déphasage entre deux drones d'une même grappe (8 identifiants qui se suivent)
        groupPhase: 2.4, // rad de déphasage d'une grappe à la suivante : deux essaims ne virent pas ensemble
      },
      anim: { bobHz: 1.4, bobAmp: 0.1, swayAmp: 0.04, lean: 0.12, glide: true, bank: 0.25 }, // bank : roulis dans le virage (rad par unité de vitesse latérale)
      // Ombre factice sous le drone : un disque sombre posé au sol, de la teinte des ombres factices des rochers
      // (world.js), sans carte d'ombre. Elle montre où il se trouve AU SOL, donc où le viser, et qu'il vole.
      // C'est un second maillage instancié (un appel de dessin de plus, seulement s'il y a des drones) : fusionnée
      // dans celui du drone, elle blanchirait avec lui à chaque coup reçu. radius: 0 la retire.
      // Rendu peint (§ Z quater) : retirée (radius 0) — l'ombre de contact de src/rendu/ombres-contact.js, plus
      // douce sous une unité qui vole (PEINT.contact.volant), la remplace sans appel de dessin de plus.
      groundShadow: { radius: 0, y: 0.02, mix: 0.45, lum: 0.8 }, // m, m, part de PALETTE.rockDark dans le sable, luminosité
    },
    {
      id: ENEMY.TIREUR,
      key: 'tireur',
      name: 'Tireur',
      unlockWave: 4,
      hp: 36,
      speed: 2.8,
      radius: 0.55,
      height: 1.5,
      hover: 0,
      contactDmg: 6,
      mass: 1.2,
      gemXp: 30,
      fragChance: 0.5,
      fragValue: 8,
      castShadow: false,
      bodyColor: PALETTE.robot,
      accentColor: PALETTE.robotDark, // pièces secondaires : chenilles
      accent2Color: PALETTE.robotLight, // pièces secondaires : canon, mât
      eyeColor: PALETTE.eyeTireur,
      // Lueur de la visée : le rouge du tir qui va partir. Pas l'orange de l'œil : ajouté au gris du corps il donne
      // la teinte du sable, et un tireur qui vise se fondait dans le sol (constaté sur capture).
      glowColor: PALETTE.enemyShot,
      weight: { base: 1.5, perWave: 0.5, maxShare: 0.18 },
      specialWaveEligible: false,
      ranged: {
        keepMin: 8, // m — recule en dessous
        keepMax: 12, // m — avance au-dessus
        fireInterval: 2.6, // s entre deux tirs, visée comprise
        windup: 0.5, // s de lueur avant le tir (télégraphe) : il s'arrête, s'allume, puis tire
        shotSpeed: 7, // m/s — lent et esquivable
        shotRadius: 0.32,
        shotDmg: 10, // × multiplicateur de dégâts de la vague
        shotLife: 4.5, // s
        maxRange: 18, // m — ne tire pas au-delà
        retreatMul: 0.9, // fraction de sa vitesse quand il recule
        strafeMul: 0.3, // fraction de sa vitesse en pas de côté, tant qu'il ne vise pas (0 = immobile entre keepMin et keepMax)
        // s — délai entre l'instant où il arrive à portée et sa PREMIÈRE visée, tiré entre ces deux bornes : une
        // grappe de tireurs arrivée ensemble ne tire pas d'une seule voix
        firstDelayMin: 0.3,
        firstDelayMax: 1.8,
        muzzle: 1.15, // m — le tir part de la bouche du canon, devant son centre
        afterGlow: 0.35, // lueur qui reste au départ du tir, puis s'éteint (la lueur pleine = le tir arrive)
        retryDelay: 0.25, // s — pool des tirs ennemis plein au moment de tirer : rien ne part (ni son, ni recul, ni tir compté) et il vise de nouveau après ce délai
        recoilSeconds: 0.3, // s — recul visible après le tir (animation)
        recoilLean: 0.14, // rad — bascule vers l'arrière au moment du tir
      },
      anim: { bobHz: 1.6, bobAmp: 0.04, swayAmp: 0.04, lean: 0, glide: false }, // roule posément
    },
    {
      id: ENEMY.KAMIKAZE,
      key: 'kamikaze',
      name: 'Kamikaze',
      unlockWave: 5,
      hp: 18,
      speed: 5.2,
      radius: 0.45,
      height: 1.0,
      hover: 0,
      contactDmg: 0, // ne frappe pas : il explose
      mass: 0.8,
      gemXp: 10,
      fragChance: 0.4,
      fragValue: 6,
      castShadow: false,
      bodyColor: PALETTE.robot,
      accentColor: PALETTE.robotDark, // pièces secondaires
      eyeColor: PALETTE.eyeKamikaze,
      glowColor: PALETTE.eyeKamikaze,
      weight: { base: 1.5, perWave: 0.5, maxShare: 0.18 },
      specialWaveEligible: true,
      explode: {
        triggerDist: 2.2, // m — distance au joueur qui arme la mèche
        // Bloqué à portée de souffle (derrière une meute déjà au contact, il n'atteint jamais triggerDist) : la mèche
        // s'allume quand même, là où il est, après stuckSeconds passées presque à l'arrêt.
        stuckSeconds: 0.5, // s
        stuckSpeedMul: 0.4, // « presque à l'arrêt » = vitesse effective sous cette fraction de sa vitesse voulue
        stuckMargin: 0.2, // m — il ne s'arme ainsi que si le joueur est à moins de radius + rayon du joueur − stuckMargin (de centre à centre) : l'explosion le touche encore si la meute repousse un peu le kamikaze pendant la mèche
        // s de clignotement avant l'explosion. Esquive à pied mesurée à pas fixe (joueur immobile qui fuit tout droit
        // après l'allumage) : à 0,7 il fallait réagir en moins de 0,25 s, le clignotement ne servait qu'au dash ; à 0,9
        // une réaction de 0,4 s suffit encore. À rejouer à l'intégration avec une vague de kamikazes.
        fuse: 0.9,
        fuseSpeedMul: 0.35, // il ralentit pendant la mèche (esquivable au dash)
        blinkHzStart: 6,
        blinkHzEnd: 18,
        radius: 3.2, // m
        playerDmg: 22, // × multiplicateur de dégâts de la vague
        // Dégâts aux autres robots (tir ami), sans multiplicateur ; moitié au bord du souffle. Un kamikaze tué par une
        // explosion n'explose pas (contrat), et dans un groupe qui arrive sur le joueur, les mèches s'allument presque
        // ensemble : chacun encaisse les souffles de tous ceux qui partent avant lui. Mesuré à pas fixe (20 kamikazes aux
        // PV de la vague 5, arrivée étalée de 8 à 16 m / couronne serrée de 8 à 10 m), détonations sur 20 : 30 → 3 / 3 ;
        // 12 → 8 / 4 ; 6 → 12 / 7 ; 4 → 16 / 11 ; 3 → 19 / 14 ; 2 → 20 / 20. À 3 le kamikaze reste une menace au lieu
        // de nettoyer la horde pour le joueur ; le tir ami ne fait plus qu'entamer les robots voisins.
        // Intégration : damage.explode reçoit maintenant le type à épargner (spareType) : un kamikaze n'est jamais touché
        // par le souffle d'un autre kamikaze, donc un groupe ne s'autodétruit plus, quel que soit robotDmg. Le tir ami sur
        // les AUTRES robots revient à 10 (rôdeur de 20 PV : 2 à 4 souffles), ce que le lot enemies voulait sans pouvoir
        // l'obtenir dans son fichier.
        robotDmg: 10,
        trauma: SHAKE.amounts.explosionKamikaze,
        punch: SHAKE.punch.explosion,
        // Cahier : « à la mort, le robot lâche une gemme d'XP ». Un kamikaze qui explose de lui-même lâche
        // donc son butin (sinon une vague spéciale de kamikazes ne rapporte presque rien). false = sans butin.
        lootOnSelfDestruct: true,
        glowMin: 0.15, // lueur entre deux éclats de la mèche (il reste « armé » à l'œil)
        blinkDuty: 0.5, // part de chaque clignotement où il est allumé
        swell: 0.28, // il enfle de 28 % jusqu'à l'explosion (animation)
        shake: 0.1, // rad — tremblement en fin de mèche (animation)
        shakeHz: 9,
      },
      anim: { bobHz: 3.4, bobAmp: 0.1, swayAmp: 0.12, lean: 0.09, glide: false }, // il roule vite et tangue
    },
    {
      id: ENEMY.BLINDE,
      key: 'blinde',
      name: 'Blindé',
      unlockWave: 7,
      hp: 220,
      speed: 1.7,
      radius: 0.95,
      height: 2.2,
      hover: 0,
      contactDmg: 18,
      mass: 6,
      gemXp: 100,
      fragChance: 1,
      fragValue: 18,
      castShadow: true, // gros ennemi
      bodyColor: PALETTE.robot,
      accentColor: PALETTE.robotDark, // pièces secondaires : plaque frontale, chenilles
      accent2Color: PALETTE.robotLight, // pièces secondaires : échappements (repère de l'ARRIÈRE, le côté vulnérable)
      eyeColor: PALETTE.robotEye,
      glowColor: PALETTE.eyeReparateur, // seule lueur d'un blindé : le vert d'un soin reçu
      weight: { base: 0.8, perWave: 0.4, maxShare: 0.12 },
      specialWaveEligible: false,
      turnRate: 1.4, // rad/s — tourne lentement : on peut le prendre à revers
      // Il avance dans l'axe de son cap, comme un char : à pleine vitesse quand il fait face au joueur, à l'arrêt
      // quand le joueur sort de ce cône (cosinus de l'angle entre son cap et le joueur ≤ advanceAlign) — il pivote alors sur place.
      advanceAlign: 0.3,
      shield: {
        arcDeg: 150, // arc frontal protégé, centré sur son cap (E.rot)
        damageMul: 0, // dégâts restants de face (0 = annulé) — § E4.P : 0,2, seuil et damageMulFissure dans la région e4:P-bouclier-blinde
      },
      anim: { bobHz: 1.0, bobAmp: 0.04, swayAmp: 0.03, lean: 0, glide: false }, // lourd : il tangue à peine
    },
    {
      id: ENEMY.REPARATEUR,
      key: 'reparateur',
      name: 'Réparateur',
      unlockWave: 9,
      hp: 60,
      speed: 3.0,
      radius: 0.55,
      height: 1.4,
      hover: 0,
      contactDmg: 6,
      mass: 1,
      gemXp: 30,
      fragChance: 1,
      fragValue: 12,
      castShadow: false,
      bodyColor: PALETTE.robot,
      accentColor: PALETTE.robotLight, // pièces secondaires
      eyeColor: PALETTE.eyeReparateur,
      glowColor: PALETTE.eyeReparateur,
      weight: { base: 0.4, perWave: 0.2, maxShare: 0.06 },
      specialWaveEligible: false,
      heal: {
        radius: 7, // m
        interval: 1.0, // s
        amount: 14, // PV par impulsion et par robot, × waveHpMul(run.wave)
        maxTargets: 6, // les plus abîmés d'abord
        // m — reste derrière la meute. 7 et non 9 : à 9 m du joueur, avec 7 m de portée, il ne pouvait soigner aucun
        // des robots au contact du joueur (ceux que les armes abîment) ; à 7 m il couvre le front de son côté.
        keepDist: 7,
        healsBoss: false,
        keepBand: 0.6, // m — il tient sa place entre keepDist − keepBand et keepDist + keepBand
        retreatMul: 1.0, // fraction de sa vitesse quand il recule
        strafeMul: 0.25, // fraction de sa vitesse en pas de côté
        idleRetry: 0.25, // s — personne à soigner : il regarde de nouveau après ce délai (ni impulsion, ni son)
        pulseScale: 0.14, // il gonfle de 14 % à chaque impulsion (animation)
      },
      anim: { bobHz: 1.8, bobAmp: 0.06, swayAmp: 0.06, lean: 0.03, glide: false },
    },
    {
      id: ENEMY.BOSS,
      key: 'boss',
      name: 'Overclock', // BOSS_IDENTITE (20/11) : « Boss » est la catégorie
      // SOURCE UNIQUE = section BOSS (lot boss). Les cinq champs ci-dessous sont des accesseurs qui renvoient
      // les valeurs de BOSS : enemies.spawn lit ENEMIES.types[type] comme pour les autres robots et obtient
      // donc toujours les chiffres du lot boss. Ne pas les remplacer par des nombres.
      get unlockWave() {
        return BOSS.every; // première vague de boss ; le boss n'est jamais tiré dans la composition
      },
      get hp() {
        return BOSS.hp;
      },
      get speed() {
        return BOSS.speed;
      },
      get radius() {
        return BOSS.radius;
      },
      get height() {
        return BOSS.height;
      },
      get contactDmg() {
        return BOSS.contactDmg;
      },
      hover: 0,
      mass: 1e9, // insensible au recul
      gemXp: 0, // butin géré par BOSS.loot (pickups.dropLoot ne fait rien pour le boss)
      fragChance: 0,
      fragValue: 0,
      castShadow: true,
      bodyColor: PALETTE.robot,
      accentColor: PALETTE.robotDark, // pièces secondaires
      eyeColor: PALETTE.robotEye,
      glowColor: PALETTE.robotEye,
      weight: { base: 0, perWave: 0, maxShare: 0 }, // jamais tiré dans la composition
      specialWaveEligible: false,
    },
  ],
  // ----- Étape 1 du plan addictif, chantier B (14/11/2026, ARCHITECTURE.md § E1.B) : révisions v2 / v3 des robots -----
  // Lore : les robots sont les programmes d'attaque d'une AGI, qui les met à jour. À la vague `wave` le type passe à
  // la `version` annoncée (bannière « MISE À JOUR DÉTECTÉE : <label> »), pour le reste de la partie. Triées par vague.
  // Les dégâts des révisions sont multipliés par le multiplicateur de vague (E.mul), comme le reste.
  revisions: [
    // Tireurs v2 : salve de `shots` tirs en éventail, `spreadDeg` degrés entre deux tirs voisins ; un son, un recul.
    { wave: 11, type: ENEMY.TIREUR, version: 2, key: 'salve', label: 'TIREURS v2.0', shots: 3, spreadDeg: 15 },
    // Drones v2 : ils arrivent en escadrilles de `squad` (formation en V, pas `squadSpacing` m) ; toutes les `every` s,
    // à moins de `range` m, le drone s'arrête, un trait au sol l'annonce `telegraph` s, puis il pique en ligne droite
    // sur `length` m à vitesse × speedMul ; son contact pendant le piqué vaut contactDmg × dmgMul.
    {
      wave: 12, type: ENEMY.DRONE, version: 2, key: 'pique', label: 'DRONES v2.0',
      squad: 6, squadSpacing: 1.1, every: 4, range: 9, telegraph: 0.5, length: 7, speedMul: 2.6, dmgMul: 1.5,
      rearLean: 0.35, diveLean: 0.5, // rad — il se cabre pendant l'annonce, plonge du nez pendant le piqué (animation)
    },
    // Rôdeurs v2 : à moins de `triggerDist` m il s'accroupit `crouch` s, puis saute de `leap` m en `leapSeconds` s vers
    // la position du joueur à l'instant du saut ; recharge `cooldown` s.
    {
      wave: 13, type: ENEMY.RODEUR, version: 2, key: 'bond', label: 'RÔDEURS v2.0',
      triggerDist: 6, minDist: 2, crouch: 0.3, leap: 4, leapSeconds: 0.35, cooldown: 3.5, // minDist : au contact il ne saute pas
      crouchSquash: 0.38, leapHeight: 1.1, leapLean: 0.3, // écrasement de l'accroupi, hauteur et penché du saut (animation)
    },
    // Kamikazes v2 : l'explosion d'un kamikaze arme ses voisins kamikazes dans explode.radius (mèche `chainFuse` s) ;
    // elle blesse toujours les autres robots (explode.robotDmg).
    { wave: 14, type: ENEMY.KAMIKAZE, version: 2, key: 'chaine', label: 'KAMIKAZES v2.0', chainFuse: 0.25 },
    // Blindés v2 : le bouclier tourne turnMul fois plus vite ; toutes les `every` s, à moins de `range` m et face au
    // joueur, trait annoncé `telegraph` s puis charge de `length` m à vitesse × speedMul (contact × dmgMul).
    {
      wave: 16, type: ENEMY.BLINDE, version: 2, key: 'charge', label: 'BLINDÉS v2.0',
      turnMul: 2, every: 6, range: 8, telegraph: 0.6, length: 6, speedMul: 3, dmgMul: 1.5,
      aimCos: 0.94, // il ne charge que si le joueur est dans ce cône devant lui (cosinus : ≈ 20°) ; la charge part dans l'axe de son cap
      rearLean: 0.1, chargeLean: 0.16, // rad — recul pendant l'annonce, penché pendant la charge (animation)
    },
    // Réparateurs v2 : l'impulsion ne soigne plus ; elle pose sur heal.maxTargets voisins une bulle qui absorbe
    // shieldFraction × PV max pendant shieldSeconds s.
    {
      wave: 17, type: ENEMY.REPARATEUR, version: 2, key: 'bulle', label: 'RÉPARATEURS v2.0',
      shieldFraction: 0.3, shieldSeconds: 4, interval: 2, // interval : s entre deux poses (au lieu de heal.interval)
      bubbleScale: 1.55, bubbleColor: PALETTE.eyeReparateur, bubbleGain: 1.5, bubbleWire: 0.035, bubbleSpin: 0.9, // bulle filaire : rayon = rayon du robot × bubbleScale, épaisseur d'arête (m pour un rayon de 1), rad/s
    },
    // Tireurs v3 : un tir sur `everyShots` est un obus lobé — cercle annoncé `flight` s à la position du joueur, puis
    // explosion de rayon `radius` qui ne blesse que le joueur (`dmg` × multiplicateur de vague). Garde la salve.
    {
      wave: 18, type: ENEMY.TIREUR, version: 3, key: 'obus', label: 'TIREURS v3.0',
      everyShots: 3, flight: 1.1, radius: 2.2, dmg: 14, apex: 5, shellRadius: 0.42, // apex : hauteur de la cloche (m) ; shellRadius : tête de l'obus dessiné
      trauma: SHAKE.amounts.explosionKamikaze * 0.6, punch: 0,
    },
    // Drones v3 : un drone tué laisse une flaque électrique de rayon `radius` pendant `seconds` s ; le joueur dedans
    // prend `dps` par seconde (par tics de common.contactInterval). Au plus `max` flaques : la plus ancienne est recyclée.
    { wave: 19, type: ENEMY.DRONE, version: 3, key: 'flaque', label: 'DRONES v3.0', radius: 1.3, seconds: 2, dps: 6, max: 48 },
  ],
  revisionBannerPrefix: 'MISE À JOUR DÉTECTÉE', // bannière : « <préfixe> : <label> » (ui.showBanner met le préfixe en surtitre)
  revisionAnnounceDelay: 1.7, // s après le début de la vague : la bannière suit « Vague n » (WAVES.banner.seconds)
  revisionBannerSeconds: 2.4, // s d'affichage de cette bannière
  // Silhouette d'une révision : les yeux (sommets émissifs) brillent plus fort dans le shader instancié du type, sans
  // maillage de plus. Indice = révision (0 = v1 : yeux du modèle). gain = multiplicateur de l'émissif des yeux.
  // § E1.S : la COULEUR du type est gardée (docs/da-clash.md § 2 et 3 : tireur jaune, kamikaze orange, réparateur
  // vert… — les types se distinguent d'un coup d'œil) ; avant, la révision la remplaçait (v2 magenta, v3 blanc).
  revisionEyes: [
    null,
    { gain: 1.8 }, // v2 : la couleur du type, plus vive
    { gain: 3 }, // v3 : encore plus vive (le bloom la fait déborder)
  ],
  // Tir ennemi : une tête ronde au rayon de collision exact (ce qu'on voit est ce qui touche), prolongée d'une
  // traînée courte qui s'assombrit. Rouge du cahier (PALETTE.enemyShot) : le rouge = le danger.
  // dessin : lot ENNEMIS de src/vfx (VFX.ennemi : échelle de la tête, traînée ; étape « vfx », § Z septies)
  projectile: {
    height: 1.0, // m
    pulseHz: 4, // la tête palpite (lisible à l'arrêt comme en vol)
    pulseAmp: 0.1, // fraction du rayon
  },
};

// ----- HAZARDS : zones de danger au sol des robots (src/hazards.js, § E1.B) -----
// Décalques dans le style des zones du boss (rouge du télégraphe, fond + remplissage qui grandit jusqu'à l'impact,
// contour plus vif), sur leurs propres maillages instanciés : un de disques, un de traits.
export const HAZARDS = {
  color: PALETTE.telegraph,
  opacity: 0.58, // comme BOSS.telegraphOpacity
  y: 0.032, // m — juste au-dessus des zones du boss (RENDER.decals.telegraph.y = 0,03)
  segments: 40, // facettes d'un disque
  edge: 0.07, // largeur du contour, en fraction du rayon
  edgeBoost: 2.2, // le contour est plus vif que le fond (au-dessus du seuil du bloom)
  baseGain: 0.5, // fond d'une zone annoncée
  fillGain: 0.95, // disque (ou trait) qui grandit jusqu'à l'impact
  fillStart: 0.12, // part du rayon (ou de la longueur) au départ du remplissage
  blinks: 3, // clignotements du fond pendant l'annonce (ils accélèrent)
  blinkDepth: 0.6,
  lineEdge: 0.09, // bordures d'un trait, en fraction de sa largeur
  lineHold: 0.12, // s — par défaut, un trait se rétracte sur cette durée après la fin de l'annonce (piqué, charge : le temps de la manœuvre)
  // Flaque électrique : un fond qui scintille et un cœur plus vif qui bat, à contretemps. Le gain ne descend jamais
  // sous ≈ 0,7 : plus bas, le rouge du décalque vire au brun (vu sur la planche).
  puddleGain: 1.0, // fond : gain moyen…
  puddleFlicker: 0.28, // …± ce scintillement…
  puddleHz: 11, // …à cette fréquence
  puddleCore: 0.42, // cœur : rayon moyen, en fraction du rayon de la flaque…
  puddleCoreBeat: 0.2, // …± ce battement (même fréquence, à contretemps)
  puddleCoreGain: 1.9, // gain du cœur (au-dessus du seuil du bloom)
  puddleFade: 0.4, // s — elle se rétracte sur cette durée en fin de vie
  puddleGrow: 0.18, // s — elle s'étale sur cette durée à sa naissance
  // Genres dont l'annonce sonne (le son par genre : hazards.js SON_ANNONCE). § E5.Q ter (Femz, 21/11) : les traits et la
  // flaque y sont ajoutés dans hazards.js (ANNONCE_SOL, une voix : les drones piquent par dizaines) ; la charge d'un
  // blindé ne joue plus BOSS_TELEGRAPH elle-même.
  telegraphSoundKinds: [HAZ.STRIKE, HAZ.ORBITAL],
};
//#endregion lot:enemies

//#region lot:boss
// =====================================================================================================
// 4. LOT « boss » — boss à 2 phases, attaques télégraphiées au sol.
// =====================================================================================================
// hp, contactDmg, speed, radius et height sont LA source des valeurs du boss : ENEMIES.types[ENEMY.BOSS]
// y renvoie par des accesseurs. Toute attaque qui passe par damage.explode a ses clés trauma et punch
// (nombres finis ; contrôlé par node tests/equilibrage.mjs).
export const BOSS = {
  every: 5, // vagues 5, 10, 15…
  hp: 2200, // × bossHpMul(vague) = multiplicateur de PV de la vague × (1 + tierHpMul × (rang − 1))
  tierHpMul: 0.6, // ajout d'équilibrage absent du cahier (§ Y) ; 0 = formule du cahier seule
  contactDmg: 25, // × multiplicateur de dégâts de la vague
  speed: 2.2,
  phase2Speed: 2.9,
  radius: 2.2,
  height: 5,
  slowResist: 0.5, // le ralentissement de l'EMP est divisé par 2
  phase2At: 0.5, // phase 2 sous 50 % des PV
  // Les tableaux par phase de cette section se lisent [phase 1, phase 2, phase 3 (enragé, § E1.D : rang 4 et suivants)].
  turnRate: [2.4, 3.4, 4.2], // rad/s — il se tourne vers le joueur ; plus vif en phase 2
  stopDist: 3.0, // m — il cesse d'avancer à cette distance du joueur : radius + rayon du joueur (2,7 m, portée du contact) + 0,3.
  //                En marchant il ne vient donc jamais toucher un joueur immobile : de près, sa menace est la frappe
  //                ANNONCÉE (slam.triggerDist), pas un coup de contact sans télégraphe. Le contact reste dû pendant la
  //                ruée et quand c'est le joueur qui vient au corps.
  firstAttackDelay: 1.2, // s entre l'impact de l'atterrissage (ou la prise en charge d'un boss posé dans E) et la première attaque
  attackGap: [1.3, 0.55, 0.35], // s de pause entre la fin d'une attaque et le choix de la suivante : le rythme de chaque phase
  arrival: {
    alarmSeconds: 2.0, // alarme + marque au sol avant l'atterrissage
    dropSeconds: 0.9, // chute
    spawnDist: 11, // m du joueur, DANS l'écran (arrivée télégraphiée et visible : écart assumé, § Y). Réduite quand le
    //                point tomberait hors de l'écran ou sous le HUD (screenMargin, hudTopPx), jamais sous minDist.
    hudTopPx: 120, // px CSS — bande du haut de l'écran laissée au HUD : le sommet du boss atterrit dessous. La barre de
    //                vie du boss descend jusqu'à y = 84 px (HUD de la fondation) ; le reste couvre la secousse et le
    //                punch de l'impact (17 px au plus en 720p). En 1280 × 720 la chute vers le haut de l'écran se fait
    //                donc à 9,5 m et non 11. À accorder avec le lot ui à l'intégration si la barre change de place.
    dropTurnDeg: 20, // ° — point de chute sur un obstacle : la direction tourne par pas de ±dropTurnDeg…
    dropTries: 8, // …8 essais au plus (±20°, ±40°, ±60°, ±80°), à distance égale ; sinon le point d'origine est gardé
    dropClearance: 0.4, // m libres autour du corps (radius + dropClearance) pour qu'un point de chute soit accepté
    trauma: SHAKE.amounts.bossArrival,
    punch: SHAKE.punch.bossHit,
    dropHeight: 56, // m — altitude de départ de la chute : 56 × cos 55° = 32 m d'écran, donc hors champ où que soit la marque
    markRadius: 3.6, // m — cercle marqué au sol pendant l'alarme et la chute
    screenMargin: 3, // m — le point de chute reste à cette distance des bords de l'écran (fenêtre étroite : spawnDist est réduit)
    minDist: 7, // m — …sans jamais tomber plus près du joueur
    recoverSeconds: 0.9, // s accroupi après l'impact, avant de marcher
    blastRadius: 6, // m — rayon de l'onde de poussière à l'impact (effet seul : l'impact ne blesse pas)
    graceSeconds: 0.6, // s — joueur SOUS le boss à l'impact : le boss n'entre dans E (donc ne frappe au contact)
    //                    qu'après ce délai, ou dès que le joueur est sorti de son cercle
  },
  // cooldown : [phase 1, phase 2] en secondes, compté depuis le début de l'attaque ; dmg × multiplicateur de dégâts de la vague
  // Ordre de choix quand la pause commune est finie : invocation (s'il reste de la place sous WAVES.maxAlive),
  // frappe (joueur proche), obus, ruée (joueur loin). charge.minDist ≤ slam.triggerDist : à toute distance, une
  // attaque au moins peut partir en phase 1 (contrôlé par tests/boss.test.mjs — aucune zone morte).
  attacks: {
    slam: {
      phases: [1, 2, 3],
      telegraph: 1.1, // s d'avertissement au sol (cercle)
      radius: 6,
      dmg: 30,
      cooldown: [4.5, 3.2, 2.6],
      trauma: SHAKE.amounts.explosionBoss,
      punch: SHAKE.punch.bossHit,
      triggerDist: 5.0, // m — il frappe quand le joueur est à moins de cette distance de son centre (donc dans le cercle)
      recover: 0.7, // s immobile après la frappe : la fenêtre pour le punir
    },
    charge: {
      phases: [1, 2, 3],
      telegraph: 1.0, // rectangle au sol dans la direction du joueur
      width: 4.6, // m — au moins le diamètre du corps (2 × radius) : le couloir annoncé couvre tout ce qui blesse pendant la ruée
      length: 20,
      speed: 26, // m/s pendant la charge
      dmg: 28,
      cooldown: [7.5, 5.5, 4.2],
      minDist: 5.0, // ne charge pas si le joueur est plus près. = slam.triggerDist : entre 5 et 7 m ni la frappe ni la
      //               ruée ne pouvait partir (un joueur qui s'y tenait ne subissait aucune attaque en phase 1). À 5 m,
      //               il reste lockSeconds + 5 / speed = 0,79 s après le verrou pour les 0,43 s de sortie du couloir.
      lockSeconds: 0.6, // s — la direction est figée ce temps-là avant le départ (il vise pendant telegraph − lockSeconds) :
      //                   0,6 s × 6,5 m/s = 3,9 m de marche, plus que la demi-largeur du couloir + le rayon du joueur (2,8 m)
      aimTurnRate: 6, // rad/s — vitesse à laquelle il suit le joueur pendant qu'il vise
      recover: 0.8, // s immobile après la ruée
    },
    mortar: {
      phases: [2, 3], // + la phase 1 à partir du rang 3 (BOSS.ranks[…].mortarPhase1, § E1.D)
      telegraph: 1.0, // cercles autour du joueur
      count: 5,
      radius: 2.8,
      spread: 7, // m autour du joueur
      stagger: 0.15, // s entre deux impacts
      dmg: 20,
      cooldown: [8, 6, 4.5], // la valeur de phase 1 ne sert qu'à partir du rang 3
      trauma: SHAKE.amounts.explosionMortar, // par impact ; le plafond « enemyExplosion » borne la somme
      punch: SHAKE.punch.explosion,
      castSeconds: 0.5, // s immobile au moment du tir ; il reprend sa marche pendant que les obus tombent
      minDist: 4.2, // m — distance minimale au joueur des obus autres que le premier (qui tombe sur lui)
      safeArcDeg: 120, // arc libre de tout obus autour de la direction de sortie.
      //                  minDist × sin(safeArcDeg / 2) = 3,64 m > radius + rayon du joueur (3,3 m) : le couloir de sortie est vraiment libre
      // La sortie est un POINT : à radius + rayon du joueur + exitMargin du joueur, dans une direction tirée au
      // hasard parmi celles où ce point (et le milieu du trajet) est dans l'arène et hors de tout obstacle — jamais
      // vers un mur ni dans un rocher. Aucun autre obus ne tombe à moins de radius + rayon du joueur + exitClear
      // de ce point, bornage à l'arène compris (un obus ramené sur un mur pouvait fermer la sortie dans un coin).
      exitMargin: 0.5, // m au-delà du premier cercle
      exitClear: 0.2, // m de marge entre le point de sortie et le bord des autres cercles
      exitTries: 12, // directions essayées ; ensuite : vers le centre de l'arène
      shellTries: 8, // tirages par obus ; ensuite l'obus est abandonné (volée plus courte contre un mur)
    },
    summon: {
      phases: [2, 3],
      type: ENEMY.DRONE, // rang 1 ; à partir du rang 2 : BOSS.ranks[…].summonType
      count: 6,
      telegraph: 0.8, // s — petits cercles au sol là où les robots vont apparaître
      spawnRadius: 4.5, // m — points d'apparition répartis sur un cercle autour du boss
      cooldown: [0, 9, 7],
      maxAlive: 18, // pas d'invocation si E.aliveByType[type] atteint déjà ce nombre
      markRadius: 1.0, // m — rayon de chaque cercle d'apparition
      ringScale: 1.6, // l'anneau de fx à l'apparition fait markRadius × ringScale
      recover: 0.4, // s immobile après l'invocation
    },
    // Balayage laser (§ E1.D, rang 2 et suivants). Pendant `telegraph`, l'arc que le rayon va parcourir est tracé au
    // sol (rectangle de départ + rayons fins) ; puis le rayon, parti de la visière, tourne de arcDeg en `seconds`,
    // centré sur la position du joueur au début de l'annonce. Le joueur dans le rayon (rectangle length × width
    // depuis le centre du boss) prend dmg × multiplicateur de vague, une fois par rayon ; le dash le traverse.
    // À 200° en 2,4 s le bout du rayon file à 23 m/s : on ne le distance pas, on le traverse en dash, on reste
    // derrière le boss (160° libres) ou hors de portée (length).
    sweep: {
      phases: [1, 2, 3],
      cooldown: [9, 6, 4.5],
      telegraph: 1.0, // s d'annonce au sol
      arcDeg: 200,
      seconds: 2.4, // durée du balayage
      length: 16, // m depuis le centre du boss
      width: 1.0, // m
      dmg: 20,
      maxDist: 14, // m — il ne balaie que si le joueur est à portée du rayon
      aimTurnRate: 7, // rad/s — il se tourne vers le départ de l'arc pendant l'annonce
      recover: 0.6, // s immobile après le balayage
      spokes: 20, // rayons fins tracés sur l'arc pendant l'annonce (répartis entre les rayons du balayage)
      spokeWidth: 0.14, // m
      spokeGain: 1.6, // gain des rayons fins (ils s'allument l'un après l'autre dans le sens du balayage)
      startGain: 2.4, // gain du rectangle de départ
      beamHeight: 1.0, // m — hauteur du rayon affiché (torse du héros)
      beamThickness: 0.34, // m — épaisseur du rayon affiché
      beamGain: 3.2, // gain de sa couleur (additif : il passe le seuil du bloom)
      coreWidth: 0.35, // cœur du rayon : part de sa largeur…
      coreGain: 5, // …et gain (additif par-dessus le rayon : centre presque blanc)
      color: PALETTE.telegraph,
    },
  },
  // ----- Mutations par rang (§ E1.D) : le boss de la vague 5 × rang. Elles se CUMULENT ; au-delà de la dernière ligne,
  // bossMutations(rang) prolonge sans plafond de difficulté (PV, dégâts, invocations) et borne ce qui doit rester
  // esquivable (mutation.*).
  ranks: [
    {}, // rang 1 (vague 5) : le boss du cahier
    { sweep: true, summonType: ENEMY.TIREUR }, // rang 2 (vague 10) : balayage laser, il invoque des tireurs
    { sweep: true, summonType: ENEMY.TIREUR, shieldDrones: 2, mortarPhase1: true }, // rang 3 (vague 15) : drones-boucliers, obus dès la phase 1
    { sweep: true, summonType: ENEMY.TIREUR, shieldDrones: 2, mortarPhase1: true, enrage: true }, // rang 4 (vague 20) : enragement
  ],
  // Drones-boucliers (rang 3 et suivants) : robots de type drone en orbite autour du boss, invulnérable tant qu'il en
  // reste un ; ils reviennent à chaque changement de phase. PV = hp × bossHpMul(vague).
  shieldDrones: {
    hp: 180,
    orbitRadius: 4.2, // m autour du centre du boss
    orbitSpeed: 1.4, // rad/s
    follow: 9, // 1/s — rappel du drone vers sa place sur l'orbite…
    maxSpeed: 30, // …à cette vitesse au plus (m/s : le boss charge à 26)
    glow: 0.55, // lueur rouge des drones-boucliers (0..1) : on les distingue des drones de la vague
    linkWidth: 0.2, // m — lien affiché entre chaque drone et le torse du boss
    linkGain: 3.0,
    linkHeight: 3.0, // m — hauteur du torse où arrivent les liens
  },
  // Enragement (rang 4 et suivants) : troisième phase sous `at` des PV. Même séquence que le passage en phase 2
  // (arrêt, flash, anneau, son, secousse). SANS scission : un seul boss.
  enrage: {
    at: 0.25,
    speed: 3.5, // m/s (2,9 en phase 2)
    emissiveBoost: 3.4, // gain des émissifs (2,6 en phase 2)
    glow: 0.3, // lueur rouge permanente du corps (0,13 en phase 2)
    slamRepeat: 2, // la frappe retombe ce nombre de fois de suite, chacune annoncée
    mortarDelay: 0.6, // s avant les premiers obus de la phase 3
    summonDelay: 2.5,
    sweepDelay: 1.2,
  },
  // Au-delà du rang 4, avec s = rang − 4 : ce qui est borné pour rester esquivable.
  mutation: {
    shieldDronesMax: 6, // drones-boucliers : 2 + s, au plus 6
    sweepBeamsMax: 3, // rayons du balayage : 1 + floor(s / 2), au plus 3, à angles égaux
    enrageAtStep: 0.05, // seuil d'enragement : +5 % des PV par rang…
    enrageAtMax: 0.45, // …au plus 45 % : toujours SOUS phase2At (0,5), le boss passe par la phase 2 avant de s'enrager (§ E1.S ; 0,6 la sautait dès le rang 9)
    cooldownMul: 0.94, // recharges et pause entre attaques × 0,94 par rang…
    cooldownFloor: 0.5, // …jamais sous × 0,5
    summonPerRank: 1, // robots invoqués en plus par rang (sans plafond : summon.maxAlive et E.cap jouent seuls)
  },
  phaseChange: {
    stunSeconds: 1.0,
    trauma: SHAKE.amounts.bossPhase,
    igniteAt: 0.45, // part de l'arrêt après laquelle la phase 2 s'allume (flash blanc, pièces incandescentes)
    resumeDelay: 0.25, // s entre la fin de l'arrêt et la première attaque de la phase 2
    mortarDelay: 0, // s avant que les obus soient disponibles (première attaque de la phase 2)
    summonDelay: 3.5, // s avant la première invocation
    ringRadius: 7, // m — anneau de fx au moment du changement de phase
  },
  // Phase 2 : ce qui se VOIT. Corps chauffé au rouge (lueur), émissifs poussés, pièces incandescentes orange.
  phase2: {
    glow: 0.13, // lueur rouge permanente du corps (0..1)
    glowPulse: 0.05, // ± battement de cette lueur
    pulseHz: 1.6,
    emissiveBoost: 2.6, // gain des émissifs (1,5 en phase 1 : RENDER.emissiveBoost)
    flicker: 0.22, // ± vacillement des pièces incandescentes
    flickerHz: 9, // paliers de vacillement par seconde (une valeur écrite par palier, pas par image)
    heatColor: PALETTE.eyeKamikaze, // orange chaud des pièces incandescentes (variante d'œil de la palette)
    flashSeconds: 0.3, // flash blanc à l'allumage
  },
  death: {
    trauma: SHAKE.amounts.bossDeath,
    punch: SHAKE.punch.bossHit,
    explosionRadius: 8,
    killMinions: true, // § J.4 : sa mort tue tous les robots vivants (drapeaux SILENT et NO_LOOT du coup fatal transmis)
    minionLoot: true, // § J.4 : …AVEC leur butin. false = ils meurent sans butin (NO_LOOT ajouté) : tuer le boss en
    //                   premier ne donne plus le butin de toute la horde. Décision d'intégration (mesuré : vague 5,
    //                   81 vivants, +232 fragments dont 120 du boss ; vague 10, 130 vivants, +404 dont 160).
  },
  loot: { gems: 10, gemXp: 100, fragments: 120, fragmentsPerTier: 40, fragmentPickups: 10, gemRing: 1.5, fragmentRing: 2.4 }, // …Ring : rayon (m) du cercle où tombe le butin
  telegraphColor: PALETTE.telegraph,
  telegraphOpacity: 0.58,
  // Dessin des zones au sol. Chaque cercle = un fond + un disque qui grandit jusqu'à l'impact, chacun bordé d'un
  // trait vif ; le couloir de la ruée = un fond, un remplissage, des bordures et des barres qui défilent vers l'avant.
  // Fonds et remplissages sont des décalques au sol (RENDER.decals.telegraph) : la horde les cache. Les CONTOURS
  // (traits des cercles, bordures et barres du couloir) sont dessinés par-dessus les robots : posés à contourHeight
  // et décalés le long de l'axe de visée, ils se projettent exactement sur leur tracé au sol, et seul ce qui
  // dépasse cette hauteur (le haut du boss, une falaise) les cache encore.
  zone: {
    contourHeight: 3.0, // m — hauteur des contours ; relevée à l'init au-dessus du plus haut robot (hors boss) et du joueur…
    contourMargin: 0.5, // …de cette marge (hauteur + vol du type + contourMargin)
    segments: 48, // côtés d'un cercle
    edge: 0.07, // épaisseur de la bordure, en part du rayon
    edgeBoost: 3.2, // gain de la bordure (× opacité, elle passe le seuil du bloom)
    baseGain: 1.0, // gain du fond
    fillGain: 1.0, // gain du disque (ou du remplissage) qui grandit
    fillStart: 0.12, // taille du disque au début du télégraphe, en part du rayon
    blinks: 5, // clignotements du fond pendant le télégraphe, de plus en plus rapprochés
    blinkDepth: 0.35, // amplitude du clignotement
    laneEdge: 0.22, // m — bordure du couloir
    laneAimGain: 0.55, // gain du couloir tant que la direction n'est pas figée (il s'éclaircit au verrouillage)
    laneBars: 5, // barres transversales qui défilent vers l'avant pendant le télégraphe
    laneBarSpeed: 14, // m/s
    laneBarLength: 0.5, // m
    laneBarWidth: 0.62, // part de la largeur du couloir
    laneBarGain: 2.2,
  },
  // Joueur caché par le boss (corps de 5 m, caméra à 55° : à moins de 4 m derrière lui, le joueur disparaissait).
  // Le corps du boss s'ouvre autour du joueur : tout ce qui, du boss, se trouve DEVANT le joueur à moins de radius
  // de son centre à l'écran n'est pas dessiné, et le bord de la fenêtre est cerclé de la couleur du joueur.
  // L'ombre du boss ne change pas. radius = 0 : aucune fenêtre.
  reveal: {
    radius: 1.3, // m à l'écran autour du centre du joueur (il mesure 1,0 × 1,9 m à l'écran)
    edge: 0.1, // m — largeur du liseré
    color: PALETTE.playerAccent,
    boost: 1.5, // gain du liseré (émissif)
  },
  // Animation procédurale du corps (pose calculée dans update, écrite dans sync).
  anim: {
    bobAmp: 0.2, // m — rebond du pas
    sway: 0.055, // rad — balancement latéral
    stride: 1.5, // rad de phase du pas par mètre parcouru
    walkLean: [0.04, 0.11, 0.16], // rad — penché vers l'avant en marchant
    rearLean: 0.2, // rad — il se cabre pendant le télégraphe de la frappe…
    rearLift: 0.7, // m — …et se soulève
    aimLean: 0.14, // rad — il se ramasse en arrière pendant la visée
    aimShake: 0.07, // m — tremblement pendant la visée
    rushLean: 0.34, // rad — penché dans la ruée
    castLean: 0.16, // rad — recul au tir des obus
    summonLift: 0.35, // m
    stunLean: 0.2, // rad — affaissé pendant le changement de phase
    stunShake: 0.13, // m
    stunGlow: 0.75, // lueur atteinte à la fin de l'arrêt
    recoverLean: 0.16, // rad — accroupi pendant la récupération
    telegraphGlow: 0.42, // lueur du corps à la fin d'un télégraphe : il rougit avant de frapper
    poseRate: 11, // 1/s — lissage de la pose
    squashRate: 7, // 1/s — détente de l'écrasement
    glowRate: 9, // 1/s — lissage de la lueur
    dropStretch: 0.14, // étirement vertical pendant la chute
    landSquash: 0.3, // écrasement à l'atterrissage
    slamSquash: 0.2, // écrasement à la frappe
    // Son d'un pas (SFX.BOSS_STEP) : joué au contact du pied du modèle Blender (src/anim/boss-corps.js, surPas), réglé
    // dans ANIM.boss (étape « animations », § Z sexies). L'ancienne clé stepSoundGait (branchement provisoire) est retirée.
  },
};
//#endregion lot:boss

//#region lot:waves-shop
// =====================================================================================================
// 5. LOT « waves-shop » — vagues, apparitions, marchand, boutique, compte à rebours.
// =====================================================================================================
export const WAVES = {
  baseCount: 20, // robots de la vague n = baseCount + perWave × n
  perWave: 12,
  maxAlive: 400, // vivants en même temps ; le surplus attend dans la file
  hpGrowth: 0.12, // PV × (1 + 0,12 × (n − 1))
  dmgGrowth: 0.12, // dégâts × (1 + 0,12 × (n − 1))
  minAtUnlock: 4, // un type qui vient d'être débloqué a au moins 4 représentants (critère 4)
  spawn: {
    margin: 3, // m hors du rectangle visible (+ rayon du robot)
    depth: 6, // m — profondeur de la bande d'apparition au-delà de la marge
    tries: 12, // essais avant le repli
    burstFraction: 0.35, // part de la vague émise dès le début (plus lu depuis l'étape 1 : voir WAVES.clock)
    durationBase: 6, // s — le reste arrive en durationBase + durationPerWave × n secondes…
    durationPerWave: 1.6,
    durationMax: 28, // …plafonnées
    maxPerFrame: 16, // apparitions par image (hors debug)
    clusterMin: 3, // les robots arrivent par grappes
    clusterMax: 6,
    clusterJitter: 1.6, // m
    clusterFallbackRadius: 0.3, // m — membre d'une grappe dont le point tiré tombe dans un obstacle : posé sur ce cercle…
    clusterFallbackTries: 8, // …au premier de ces angles (espacés de l'angle d'or) qui est libre ; sinon au centre de la grappe
    refillBelow: 5, // moins de 5 vivants et file non vide → une grappe tout de suite (plus lu depuis l'étape 1 : waveMinAlive)
  },
  special: {
    firstWave: 3, // pas de vague spéciale avant
    chance: 0.3, // par vague éligible (ni vague de boss, ni vague de déblocage, ni deux d'affilée)
    forceAfter: 3, // 3 vagues éligibles sans vague spéciale → la suivante l'est
    // une seule famille ; les types non éligibles sont exclus (ENEMIES.types[t].specialWaveEligible)
    skipBaseType: true, // le rôdeur n'est pas tiré tant qu'un autre type éligible est débloqué : une « horde de rôdeurs » n'est qu'une vague ordinaire privée de ses autres robots (cahier : « que des drones, que des kamikazes… ») ; false = tirage parmi tous les types éligibles
    announceDelay: 1.7, // s après le début de la vague : seconde bannière, une fois « Vague n » effacée (banner.seconds)
    labels: { rodeur: 'Horde de rôdeurs', drone: 'Essaim de drones', kamikaze: 'Alerte kamikazes' }, // clé = ENEMY_KEYS
    labelDefault: 'Vague spéciale',
  },
  boss: {
    arrivalDelay: 2.5, // s après le début de la vague
    escortFraction: 1.0, // part de la formule gardée en escorte sur une vague de boss (1 = formule du cahier ; voir waveRobotCount)
  },
  // « 3, 2, 1 » puis départ ; sonGo : son « GO » au départ — RETIRÉ (Femz 17/11 : il couvrait le nouveau son de début de
  // vague, outils/preparer_debut_vague.py, qui part à la même image)
  countdown: { from: 3, stepSeconds: 0.8, sonGo: false },
  arrows: { threshold: 10 }, // flèches de bord d'écran quand il reste moins de 10 robots
  banner: { seconds: 1.6 },
  // ----- Étape 1 du plan addictif (14/11/2026, ARCHITECTURE.md § E1.A) : vagues au chrono façon Vampire Survivors -----
  // Une vague = un chrono. L'effectif du cahier (20 + 12 × n) devient l'effectif NOMINAL : ouverture au minimum en
  // vie, le reste à intervalle régulier sur le chrono ; sous le minimum, on complète aussitôt.
  // spawn.burstFraction, durationBase, durationPerWave, durationMax et refillBelow ne sont plus lus depuis l'étape 1.
  clock: {
    base: 30, // s — durée de la vague 1…
    perWave: 5, // …+ 5 s par vague…
    max: 60, // …plafonnée à la minute de Vampire Survivors (atteinte à la vague 7)
    minAliveFraction: 0.35, // minimum de robots en vie = round(effectif nominal × 0,35), borné à maxAlive
    intervalMin: 0.35, // s — bornes de l'intervalle entre deux grappes
    intervalMax: 8,
    warnSeconds: 5, // le chrono du HUD clignote sous 5 s
    overtimeLoot: false, // prolongation d'une vague de boss (chrono à 0, boss vivant) : les robots de complément n'ont pas de butin
    // § E1.S (règle 4 bis) : le minimum en vie est complété sans limite, mais le BUTIN du complément est plafonné par
    // vague à effectif nominal × complementLootMul robots (au-delà : EFLAG.NO_LOOT, ni gemme ni fragment). Un build qui
    // nettoie l'écran ne reçoit donc pas des dizaines de fois le butin de la vague. Infinity = pas de plafond.
    complementLootMul: 1,
  },
  // Traînards replacés devant le héros (comme Vampire Survivors) : un robot resté `seconds` hors du rectangle visible
  // élargi de `margin` m est replacé sur un point d'apparition, du côté de la marche du héros s'il marche.
  relocate: {
    margin: 14, // m au-delà du rectangle visible (la bande d'apparition s'arrête à margin 3 + depth 6 + jitter 1,6)
    seconds: 1.5, // s passées hors champ avant d'être replacé
    perFrame: 32, // emplacements de E examinés par image, à tour de rôle
    aheadCos: 0, // le point est du côté de la marche : cosinus(marche, héros → point) ≥ aheadCos
    minSpeed: 1, // m/s — au-delà le héros « marche »
  },
  // Purge de fin de vague : les robots restants se désintègrent en voxels filaires cyan (la couleur de l'agent : le
  // système est restauré ; le rouge reste celui de l'AGI), pris dans le pool d'éclats.
  purge: {
    voxelsPerRobot: 10, // voxels par robot purgé…
    voxelsPerBig: 20, // …par gros robot (DAMAGE.bigTypes)…
    maxVoxels: 600, // …au plus ce total par purge : au-delà, moins de voxels par robot (1 au minimum)
    rings: 2, // anneaux fins en écho qui partent du héros…
    ringDelay: 0.14, // s entre deux anneaux
    ringRadius: 30, // m — …et balaient l'écran
    ringSeconds: 0.7,
    ringWidth: 0.4, // m — épaisseur du trait au départ (fin : DA FUI), au lieu de FX.ring.width + widthPerRadius × rayon
    color: PALETTE.playerAccent,
    gain: 5, // × la couleur d'instance des voxels (éclairée, sans lueur : il faut passer le seuil du bloom)
    sizeMul: 1.25, // × la taille d'un éclat ordinaire
    shrink: 0.5, // dernière fraction de la vie pendant laquelle le voxel rétrécit (FX.debris.shrink pour les autres)
    lifeMin: 0.55, // s — ils montent en flottant puis se dissolvent
    lifeMax: 1.1,
    upMin: 2.2, // m/s vers le haut
    upMax: 5.5,
    drift: 0.9, // m/s — dérive horizontale au plus
  },
};

// ----- EVENTS : événements de vague (étape 1 du plan addictif, 14/11/2026, ARCHITECTURE.md § E1.C ; src/events.js) -----
// Calendrier façon Vampire Survivors : à partir de `firstWave`, un tirage par vague (`chance`), GARANTI si la vague
// précédente n'en avait pas, jamais deux fois le même d'affilée, jamais sur une vague de boss. L'événement tombe quand
// le chrono a consommé `at` de sa durée, avec sa bannière (« <surtitre> : <label> », DA FUI) et SFX.ALERT.
// Tous les chiffres sont un premier équilibrage SUPPOSÉ (calculé, pas joué par un humain).
export const EVENTS = {
  firstWave: 6,
  chance: 0.5,
  at: 0.35, // part du chrono consommée quand l'événement tombe (vague 6 : 19 s sur 55 ; dès la 7 : 21 s sur 60)
  bannerSeconds: 2.4, // s d'affichage de la bannière
  kicker: 'ANOMALIE DÉTECTÉE', // surtitre des événements hostiles (l'AGI : rouge)
  kickerAlly: 'SIGNAL ALLIÉ', // surtitre du ravitaillement (l'agent : cyan — ui.showBanner reconnaît ce surtitre)
  types: [
    // Essaim en transit : des drones sortent d'un bord hors écran et traversent en ligne droite, par le point où
    // était le héros, sur une bande de `width` m. Ils ne poursuivent pas, blessent au contact, lâchent leur butin
    // s'ils sont tués, et sont retirés sans bruit une fois ressortis de l'écran.
    {
      key: 'essaim', label: 'ARMÉE DE DRONES', minWave: 6, // Femz, 21/11 : « Armée de drones » (était « ESSAIM EN TRANSIT » ; clé gardée)
      countMin: 40, countPerWave: 2, countMax: 60, // drones : 40 à la vague 6, + 2 par vague, 60 au plus
      emitSeconds: 3, // s — ils sortent à débit constant sur cette durée
      width: 10, // m — largeur de la bande
      speedMul: 1.6, // × la vitesse du drone (6 → 9,6 m/s)
      startMargin: 4, // m au-delà de la demi-diagonale de l'écran : départ hors champ
      exitMargin: 3, // m hors du rectangle visible, côté sortie : le drone est retiré
      maxSeconds: 14, // s — au-delà, un drone encore là (bloqué contre un mur) est retiré aussi
      tries: 12, // tirages du cap avant le repli (départ vers le centre de l'arène)
    },
    // Frappe orbitale : `strikes` cercles annoncés `telegraph` s, répartis sur `seconds`, autour du héros (`spread`).
    // Ils blessent le joueur (dmgPlayer × multiplicateur de dégâts de la vague) ET les robots (dmgRobots × multiplicateur
    // de PV de la vague). `lead` : part de la vitesse du héros ajoutée à la visée (0 = là où il est).
    {
      key: 'frappe', label: 'FRAPPE ORBITALE', minWave: 6,
      strikes: 12, seconds: 20, spread: 10, radius: 3, telegraph: 1.2, dmgPlayer: 22, dmgRobots: 60,
      lead: 0.6, firstOnHero: true, // la première vise le héros lui-même : il comprend tout de suite
      trauma: 0.45, punch: 0, knockback: 6,
    },
    // Panne de courant : la lumière du rendu peint descend à `light` en `fade` s, tient `seconds`, puis remonte en
    // `fade` s. Yeux, tirs, gemmes, héros (accents) et zones annoncées gardent leur éclat. La nappe d'ambiance baisse.
    { key: 'panne', label: 'PANNE DE COURANT', minWave: 6, seconds: 15, light: 0.25, fade: 0.6, ambianceMul: 0.35 },
    // Anneau d'acier : `count` blindés sur un cercle centré sur la position du héros, bouclier vers le centre, qui se
    // resserre de radiusStart à radiusEnd en `seconds`. Les points hors de l'arène ou dans un obstacle ne sont pas
    // créés. Après `hold` s au rayon final, les survivants sont purgés.
    {
      key: 'anneau', label: "ANNEAU D'ACIER", minWave: 8,
      count: 30, radiusStart: 18, radiusEnd: 6, seconds: 20, hold: 6,
      follow: 6, // 1/s — rappel d'un blindé vers sa place sur l'anneau (un recul l'en écarte un instant)
      maxSpeed: 5, // m/s — vitesse maximale de ce rappel
    },
    // Ravitaillement : une capsule tombe à `distance` m du héros (marque au sol `telegraph` s, puis impact), gardée par
    // `guards` robots tirés du sac de la vague. Le héros qui la touche (`openRadius`) reçoit
    // fragments + fragmentsPerWave × (vague − firstWave) fragments, en `pickups` ramassables. Non prise à la fin de la
    // vague : purgée. Modèle : assets/modeles/capsule.glb (outils/blender/capsule.py, DA Clash).
    {
      key: 'ravitaillement', label: 'RAVITAILLEMENT', minWave: 6, ally: true,
      distance: 25, telegraph: 1.5, guards: 20, openRadius: 2.2, fragments: 60, fragmentsPerWave: 10, pickups: 10,
      tries: 16, // tirages du point de chute (dans l'arène, hors obstacle)
      radius: 1.3, // m — emprise au sol de la capsule (point de chute libre sur ce rayon ; rayon de la marque)
      fallHeight: 34, // m — altitude de départ de la chute (au-dessus du bord haut de l'écran, comme le marchand)
      fallEase: 2.2, // altitude = fallHeight × (1 − t / telegraph)^fallEase
      impactRadius: 3.2, // m — anneau de poussière et souffle de l'impact
      impactDmg: 18, // dégâts au joueur resté sous la capsule (× multiplicateur de dégâts de la vague) ; 0 aux robots
      impactTrauma: 0.5,
      guardRing: 4.5, // m — les gardes apparaissent sur un cercle de ce rayon autour de la capsule
      guardAggro: 9, // m — un garde quitte son poste quand le héros est à moins de cette distance de lui
      scatter: 1.6, // m — rayon du cercle où tombent les fragments à l'ouverture
      model: 'capsule.glb', height: 2.3, // fichier (MODELES.dir) et hauteur déclarée du modèle (m)
      spin: 0.8, // rad/s — la capsule tourne lentement sur elle-même, posée
      bob: 0.06, bobHz: 0.9, // m, Hz — elle respire un peu (lisible à l'arrêt)
      contactRadius: 1.5, // m — tache de l'ombre de contact
      glow: 0x3fe0d0, // couleur de lueur du matériau (cyan de l'agent)
      arrowMargin: 0.5, // m — la flèche de bord d'écran s'efface quand la capsule est à l'écran, à cette marge près
    },
  ],
};

export const SHOP = {
  // Séquence du marchand (ARCHITECTURE.md § L)
  vacuumMinSeconds: 0.5, // l'aspiration dure au moins…
  vacuumMaxSeconds: 1.5, // …et au plus ; le reste est crédité d'office
  arrivalSeconds: 1.2, // descente du drone-marchand
  arrivalHeight: 30, // m — altitude de départ de la descente : au-dessus du bord haut de l'écran (30 × cos 55° = 17,2 m d'écran pour 16 visibles), le drone entre dans l'image au lieu d'y surgir
  settleSeconds: 0.3, // pause posé avant l'ouverture
  landOffset: { right: 2.6, up: 0.6 }, // m à droite et vers le haut de l'écran par rapport au joueur : point de pose quand il est à l'arrêt (en marche : du côté opposé, à la même distance — merchant.heading…)
  landRingRadius: 2.2, // m — anneau de poussière au contact du sol
  departureSeconds: 0.9, // redécollage (pendant le compte à rebours)
  minOpenSeconds: 0.4, // Entrée / « J'ai fini » ignorés pendant ce délai (anti-validation involontaire)
  repairOnArrival: 0.25, // le marchand répare 25 % des PV max à son arrivée (levier d'équilibrage ; 0 = désactivé)
  startFragments: 0,
  // Étape 1 du plan addictif (§ E1.D, étude § 4.4) — SURCHARGE infinie : quand une arme est au niveau 21 (tout au
  // maximum), sa carte propose l'offre k = 7. Chaque cran : dégâts × (1 + damagePerLevel × cran), sans limite ;
  // prix overchargeCost(arme, cran) = round(upgradeBase × costMul × growth^cran). costMul 5 ≈ 1,5^4, le prix de la
  // dernière amélioration d'une stat. Le bonus de niveau BONUS.DAMAGE s'appelle déjà « Surcharge » : nom à trancher.
  overcharge: { damagePerLevel: 0.08, costMul: 5, growth: 1.35, label: 'Surcharge' },
  // Soldes (§ E1.D, étude § 4.8) : à chaque ouverture, UNE offre achetable (assez de fragments ou non) tirée au sort
  // est à −30 % jusqu'à la fermeture. Un tirage de randEvent() par boutique, toujours.
  sale: { discount: 0.3, label: '−30 %' },
  // Drone-marchand : vol et rendu (le maillage est le modèle Blender assets/modeles/marchand.glb, § Z quinquies)
  merchant: {
    scale: 1.0, // échelle du maillage (envergure ≈ 3,6 m à 1)
    radius: 1.8, // m — emprise au sol : le point de pose est libre d'obstacle et dans l'arène sur ce rayon
    followRate: 14, // 1/s — le drone rejoint le point de pose (qui suit le joueur) : a = 1 − exp(−followRate × dt)
    clearance: 0.9, // le drone ne touche pas le sol tant que radius × clearance mord sur un obstacle ou sort de l'arène…
    landTolerance: 0.75, // m — …ni tant qu'il est à plus de cette distance de son point de pose (à la course le retard du suivi est de 0,46 m)…
    hoverHeight: 0.6, // m — …il attend à cette hauteur que la place soit libre…
    landGraceSeconds: 0.8, // …au plus ce délai après arrivalSeconds (joueur coincé : il se pose quand même)
    hoverClimb: 3, // m/s — remontée vers hoverHeight quand la place se ferme tard : l'altitude ne saute jamais…
    landSpeed: 3, // m/s — …ni à la descente finale depuis l'attente : le contact est déclaré à 0 m
    headingMinSpeed: 1, // m/s — au-delà le joueur « marche » : le drone se pose du côté opposé à sa marche, pas sur sa route
    headingAvoidCos: 0.3, // en descente il change de côté si le joueur marche vers lui (cosinus de l'angle marche / drone au-dessus de ce seuil)…
    commitHeight: 2.2, // m — …sauf en fin de descente : sous cette altitude du profil il ne change plus de côté pour suivre la marche
    overflyHeight: 5, // m — au-dessus il peut survoler le joueur ; en dessous il s'en écarte, jusqu'à radius + rayon du joueur à hauteur d'homme (PLAYER.height)
    arrivalEase: 2.6, // altitude = arrivalHeight × (1 − t / arrivalSeconds)^arrivalEase : il arrive vite puis freine
    departureEase: 2.4, // altitude = arrivalHeight × (t / departureSeconds)^departureEase : il décolle doucement puis file
    spinTurns: 0.6, // tours sur lui-même pendant la descente ; il finit face au joueur
    leaveSpinTurns: 1.2, // tours par seconde atteints en fin de décollage
    descentTilt: 0.16, // rad — piqué du nez en vol, nul au contact
    swayRad: 0.07, // rad — roulis de balancement en vol
    swayHz: 2.2,
    squash: 0.16, // écrasement vertical à la pose (fraction de la hauteur)…
    squashBulge: 0.5, // …et élargissement correspondant (fraction de l'écrasement)
    squashDamp: 11, // 1/s — amortissement du rebond de la suspension
    squashHz: 4.5,
    leaveRingScale: 0.7, // anneau de poussière du décollage, en fraction de landRingRadius
    // Ombre factice : disque translucide au sol (aucune carte d'ombre : § G.4). Elle est décalée à l'opposé du
    // soleil en proportion de l'altitude, donc elle glisse vers le point de pose pendant la descente.
    // Hauteur et renderOrder : entre les zones du boss (0,03) et l'anneau de l'EMP (0,05) de RENDER.decals,
    // dessinée avant eux.
    // Rendu peint (§ Z quater) : enabled false — le drone projette une vraie ombre (carte du soleil) et reçoit une
    // ombre de contact qui pâlit avec l'altitude ; le disque factice n'est plus dessiné.
    shadow: { enabled: false, y: 0.04, order: 0, color: 0x1a120a, opacity: 0.34, radius: 1.55, minScale: 0.55, bodyHeight: 0.8 },
  },
};
//#endregion lot:waves-shop

//#region lot:progression
// =====================================================================================================
// 6. LOT « progression » — butin (gemmes, fragments), XP, niveaux, 10 bonus passifs.
// =====================================================================================================
export const PICKUPS = {
  // paliers de gemme par valeur d'XP : vert, puis bleu, puis violet. scale = demi-largeur de la gemme (m).
  gemTiers: [
    { minXp: 1, color: PALETTE.gemGreen, scale: 0.32 },
    { minXp: 25, color: PALETTE.gemBlue, scale: 0.39 },
    { minXp: 100, color: PALETTE.gemViolet, scale: 0.47 },
  ],
  fragment: { color: PALETTE.fragment, scale: 0.27 }, // scale = rayon de la plaquette (m)
  collectRadius: 7, // m — rayon de collecte de base (× mods.pickupRadiusMul) ; 3.2 avant le § E5.Z (Femz, 21/11)
  pickupDist: 0.7, // m — ramassé à cette distance du joueur
  magnetSpeed: 12, // m/s au départ de l'attraction
  magnetAccel: 45, // m/s²
  vacuumSpeed: 45, // m/s — aspiration de fin de vague : vitesse du butin proche (et vitesse minimale de tout le butin)
  // Fraction de SHOP.vacuumMaxSeconds à laquelle TOUT le butin est arrivé au joueur : au-delà de
  // vacuumSpeed × vacuumArrive × vacuumMaxSeconds (60,75 m) un ramassable accélère pour arriver à cette échéance.
  // La marge (10 %, soit 0,15 s) couvre le hitstop de la dernière mort, que main compte dans la durée de
  // l'aspiration alors que la simulation est figée : le crédit d'office n'a plus rien de visible à faire disparaître.
  vacuumArrive: 0.9,
  scatter: 0.9, // m — dispersion à la chute : le ramassable retombe à cette distance au plus de son point de départ
  scatterMin: 0.3, // fraction de scatter : distance minimale (une gemme et son fragment ne retombent pas l'un sur l'autre)
  landRadius: 0.3, // m — cercle que world.resolveMany sort des obstacles et borne à l'arène (rien ne retombe DANS un rocher)
  popSeconds: 0.3, // petit saut à l'apparition : durée de la chute
  popHeight: 0.8, // m — sommet du saut, au-dessus de hoverHeight
  popScale: 0.55, // échelle au départ du saut (grandit jusqu'à 1 à l'atterrissage)
  spawnFlash: 0.85, // éclair blanc à l'apparition (aFx.x), éteint à la fin du saut
  hoverHeight: 0.14, // m — hauteur de la pointe basse au repos
  bobAmp: 0.05, // m — flottement vertical
  bobHz: 0.7,
  spinHz: 0.3, // tours par seconde au repos (lent : 300 gemmes ne doivent pas faire papilloter l'écran)
  fragmentSpinHz: 0.45,
  attractSpinMul: 4, // un ramassable attiré tourne plus vite…
  attractGlow: 0.3, // …et s'éclaire (aFx.y : lueur de sa couleur)
  flyHeight: 0.75, // m — hauteur visée en fin de course (le buste du joueur)
  absorbDist: 1.6, // m — à moins de cette distance du joueur le ramassable rétrécit…
  absorbScale: 0.45, // …jusqu'à cette fraction de sa taille
  // Rendu : toutes les facettes sont émissives (couleur lisible quel que soit l'éclairage). emissiveBoost est le gain
  // des facettes de REFLET (au-dessus de 1 : elles passent le seuil du bloom) ; les autres sortent à la couleur de
  // la palette × le gain ci-dessous, sous le seuil : la teinte du cahier domine et le halo reste discret.
  emissiveBoost: 1.7,
  facets: { base: 1.0, shade: 0.74, dark: 0.5, fragmentTop: 1.4 }, // fragmentTop : dessus du fragment (cyan émissif, juste au-dessus du seuil)
  debugSample: 32, // ramassables détaillés dans snapshot().pickups.sample (tests)
};

export const PROGRESSION = {
  xpBase: 100, // XP pour passer du niveau n au niveau n+1 = round(xpBase × n^xpExponent)
  xpExponent: 1.5,
  startLevel: 1,
  choicesPerLevel: 3,
  choiceGuardSeconds: 0.35, // clics et touches ignorés à l'ouverture de l'écran de choix
  fallbackHealFraction: 0.25, // si tous les bonus sont au maximum : soin de 25 % des PV max
  // mod : clé de l'objet « mods » (state.js) ; op 'add' → mods[mod] += value ; op 'mul' → mods[mod] *= value
  bonuses: [
    // heal (facultatif) : PV rendus au moment du choix, après le recalcul des PV max
    { id: BONUS.MAX_HP, key: 'maxHp', name: 'Blindage renforcé', desc: '+20 PV max (et soigne 20 PV)', effet: "Vous encaissez plus de coups avant de tomber.", mod: 'maxHpAdd', op: 'add', value: 20, heal: 20, maxStacks: 5 },
    { id: BONUS.MOVE_SPEED, key: 'moveSpeed', name: 'Servomoteurs', desc: '+8 % de vitesse', effet: "Vous vous déplacez plus vite.", mod: 'moveSpeedMul', op: 'add', value: 0.08, maxStacks: 5 },
    // § E5.Z (Femz, 21/11) : remplace Aimant / Collecteur ({ key: 'pickupRadius', desc: '+30 % de rayon de collecte',
    // mod: 'pickupRadiusMul', value: 0.3 }) — le rayon de base passe à 7 m ; appliqué par progression.addGemXpF
    { id: BONUS.XP_GAIN, key: 'xpGain', name: 'Apprentissage', desc: "+15 % d'XP", effet: "Chaque gemme ramassée vous rapporte plus d'XP.", mod: 'xpGainMul', op: 'add', value: 0.15, maxStacks: 5 },
    { id: BONUS.CRIT, key: 'crit', name: 'Viseur', desc: '+6 % de chance de critique', effet: "Vos coups font plus souvent un critique (dégâts doublés).", mod: 'critChanceAdd', op: 'add', value: 0.06, maxStacks: 5 },
    { id: BONUS.REGEN, key: 'regen', name: 'Nanoréparation', desc: '+0,6 PV par seconde', effet: "Vous regagnez des PV tout seul, petit à petit.", mod: 'regenPerSec', op: 'add', value: 0.6, maxStacks: 5 },
    { id: BONUS.DASH_CD, key: 'dashCd', name: 'Propulseurs', desc: '−12 % de recharge du dash', effet: "Votre dash revient plus vite.", mod: 'dashCdMul', op: 'mul', value: 0.88, maxStacks: 5 },
    { id: BONUS.AREA, key: 'area', name: 'Amplificateur', desc: '+10 % de zone et de portée des armes', effet: "Vos armes touchent plus large et plus loin.", mod: 'areaMul', op: 'add', value: 0.1, maxStacks: 5 },
    { id: BONUS.DAMAGE, key: 'damage', name: 'Surcharge', desc: '+10 % de dégâts', effet: "Toutes vos armes font plus de dégâts.", mod: 'damageMul', op: 'add', value: 0.1, maxStacks: 5 },
    { id: BONUS.FIRE_RATE, key: 'fireRate', name: 'Cadenceur', desc: '+8 % de cadence', effet: "Toutes vos armes tirent plus vite.", mod: 'fireRateMul', op: 'add', value: 0.08, maxStacks: 5 },
    { id: BONUS.ARMOR, key: 'armor', name: 'Plaques ablatives', desc: '−8 % de dégâts reçus', effet: "Vous perdez moins de PV à chaque coup reçu.", mod: 'damageTakenMul', op: 'mul', value: 0.92, maxStacks: 5 },
  ],
};
//#endregion lot:progression

//#region lot:juice
// =====================================================================================================
// 7. LOT « juice » — flash, hitstop, éclats, chiffres de dégâts, bords rouges, explosions, traînées.
// =====================================================================================================
// Toutes les durées sont en secondes de SIMULATION (les effets se figent pendant un hitstop et derrière un
// menu), sauf hitstop et edgeFlash, comptés en temps réel. Les couleurs viennent de PALETTE : aucune teinte
// hors du cahier. « gain » = multiplicateur de couleur ; au-dessus de 1 le canal le plus fort passe le seuil du
// bloom, mais il est écrêté à l'affichage alors que les deux autres montent : la teinte glisse (calculé : à 1,5 le
// vert des roquettes sort à 65° au lieu de 78° et l'orange de la pompe à 37° au lieu de 29°, à mi-chemin du jaune
// des orbitaux, 46°). Tout ce qui porte la couleur d'une arme reste donc à 1,1 au plus, variation comprise ;
// seuls les éclairs blancs montent plus haut.
export const FX = {
  // 0,07 s = 4 images à 60 Hz : net sur un robot seul, et en mêlée (25 robots touchés par salve) la horde ne
  // reste pas blanche.
  // Intégration : `rest` = pause après un flash, pendant laquelle un nouveau coup ne rallume pas le robot (E.flashRest,
  // décompté par enemies ; E.flash garde son sens du § H.1). Constaté sur le jeu complet : six armes au niveau 5 touchent un robot de la horde 20 à 30 fois
  // par seconde ; sans pause, le flash se rallumait avant de s'éteindre et toute la horde restait blanche. Avec 0,12 s,
  // un robot sous un feu continu clignote (au plus 1 image sur 3 en blanc) et un tir isolé (≤ 5 par seconde) le
  // fait toujours flasher.
  flash: { seconds: 0.07, rest: 0.12 }, // durée du flash blanc d'un robot touché (E.flash : 1 → 0)
  hitstop: { seconds: 0.04, minInterval: 0.25 }, // 40 ms, réservé aux gros coups, 4 par seconde au plus
  debris: {
    perKill: 5,
    perBigKill: 14,
    perBossKill: 40, // émis par spawnExplosion(FXK.BOSS_DEATH), à la couleur du boss
    perPlayerDeath: 22, // émis par spawnExplosion(FXK.PLAYER_DEATH), à la couleur du joueur
    perPlayerHit: 3, // émis par playerHit, à la couleur du joueur
    lifeMin: 0.5,
    lifeMax: 0.9,
    speedMin: 3,
    speedMax: 9,
    upMin: 3,
    upMax: 8,
    gravity: 24,
    spinMax: 14, // rad/s
    sizeMin: 0.16,
    sizeMax: 0.36,
    bounce: 0.35,
    coneDeg: 120, // ouverture du cône autour de la direction du coup ; direction nulle = tout le tour
    friction: 0.6, // part de la vitesse horizontale gardée à chaque rebond
    restSpeed: 1.2, // m/s — sous cette vitesse de chute l'éclat ne rebondit plus : il glisse
    groundDrag: 6, // 1/s — frein d'un éclat posé
    flashSeconds: 0.06, // l'éclat part blanc (le flash du robot continue sur ses morceaux) puis prend sa couleur
    shrink: 0.35, // dernière fraction de la vie pendant laquelle l'éclat rétrécit jusqu'à disparaître
    shade: 0.2, // ± variation de luminosité d'un éclat à l'autre
    scatter: 0.3, // m — dispersion du point de départ autour du centre du robot
    refRadius: 0.5, // m — rayon d'un robot dont les éclats ont la taille de base ; les autres sont à l'échelle
    sizeMulMin: 0.8,
    sizeMulMax: 2.4,
  },
  numbers: {
    life: 0.7, // s
    rise: 1.7, // m/s vers le haut de l'écran
    mergeRadius: 1.2, // m — un coup à moins de 1,2 m d'un nombre récent s'y ajoute
    mergeWindow: 0.35, // s — délai max depuis le dernier coup du nombre pour le rejoindre par le rayon
    // Cahier : « regroupés quand ils se chevauchent ». Un coup rejoint aussi tout nombre AFFICHÉ que son chiffre
    // recouvrirait à l'écran, et deux nombres dont les boîtes se recouvrent sont fondus en un seul.
    overlap: 1.15, // boîtes comparées × ce facteur : au-dessus de 1, deux nombres voisins gardent un écart (liserés compris)
    absorbSeconds: 1.2, // s — un nombre n'absorbe plus de coups au-delà de cet âge : il finit sa course (life) et le
    //                     coup suivant en ouvre un autre. Borne la durée d'un nombre (absorbSeconds + life) et sa valeur.
    critShare: 0.5, // couleur critique tant que les coups critiques pèsent au moins cette part du total du nombre
    //                (un critique vaut 2 coups : il reste acquis jusqu'à 3 coups regroupés, pas dans un cumul de horde)
    clearSide: 0.6, // m d'écran — couloir du joueur : demi-largeur gardée libre de part et d'autre de son axe…
    clearBelow: 0.3, // …depuis cette marge sous ses pieds…
    clearAbove: 0.5, // …jusqu'à cette marge au-dessus de sa tête : un nombre qui y monterait est décalé de côté
    size: 0.7, // m de haut
    critScale: 1.4,
    popSeconds: 0.12,
    height: 1.6, // m au-dessus du sol
    popAmp: 0.5, // le nombre apparaît 50 % plus gros, puis se pose en popSeconds
    mergePopAmp: 0.2, // sursaut à chaque regroupement (plus discret : un nombre nourri en continu ne tremble pas)
    fadeSeconds: 0.16, // en fin de vie le nombre rétrécit jusqu'à disparaître (matériau opaque : pas de fondu)
    crowdCount: 12, // à partir de ce nombre de nombres affichés, le rayon de regroupement s'élargit…
    crowdRadiusMul: 2, // …d'autant : une horde arrosée donne moins de nombres, plus gros en valeur
    stroke: 0.17, // épaisseur d'un segment, en fraction de la hauteur du chiffre
    outline: 0.07, // liseré sombre autour du chiffre (lisibilité sur le sable), même unité
    outlineShade: 0.05, // luminosité du liseré (× la couleur du nombre)
    spacing: 0.2, // espace entre deux chiffres, même unité
    depthBias: 45, // m vers la caméra : même place à l'écran, mais devant toute la scène (borné par CAMERA.distance)
    gain: 1.15, // gain de la couleur (léger halo)
    maxValue: 99999, // CAPS.numberGlyphs chiffres au plus
  },
  // Bords rouges. Le joueur ne peut être touché que toutes les PLAYER.hitInvuln (0,5) s : avec 0,24 s l'écran est
  // net plus de la moitié du temps même sous les coups continus — une pulsation, pas un voile. curve : exposant de
  // l'extinction (1 = linéaire, 2 = chute rapide puis traîne).
  edgeFlash: { seconds: 0.24, strength: 0.6, curve: 2 },
  explosion: {
    seconds: 0.35, // durée des blocs de feu
    ringSeconds: 0.3, // l'anneau au sol atteint le rayon de l'explosion
    sparks: 10,
    chunks: 6, // blocs de feu low-poly
    chunkSize: 0.2, // × rayon
    chunkSpeed: 2.2, // × rayon par seconde, au départ
    chunkRise: 1.2, // m/s
    coreSize: 0.42, // × rayon — éclair central
    coreSeconds: 0.14,
    coreGain: 2.4,
    gain: 1.0,
    sparkSpeedMin: 2.5, // × rayon par seconde
    sparkSpeedMax: 5,
    sparkSeconds: 0.32,
    sparkWidth: 0.07, // m, × √rayon
    sparkLength: 0.42, // m, × √rayon
    sparkUpMin: 1, // m/s
    sparkUpMax: 5,
    sparkShade: 0.1,
    sparkOffset: 0.2, // × rayon — départ des étincelles, depuis le centre
    smoke: 2, // bouffées sombres qui montent après le feu
    smokeSeconds: 0.55,
    smokeSize: 0.12, // × rayon
    smokeColor: PALETTE.robotDark,
    height: 0.9, // m — hauteur du centre
    minRadius: 0.5, // m — rayon pris quand celui reçu n'est pas un nombre positif
    // index = FXK.* — color : anneau, blocs et étincelles ; hot : éclair central ; mul : multiplicateur des
    // quantités ; rings : anneaux concentriques
    kinds: [
      { color: PALETTE.weapon[WEAPON.ROCKETS], hot: PALETTE.damageNumber, mul: 1, rings: 1 }, // ROCKET
      { color: PALETTE.eyeKamikaze, hot: PALETTE.damageNumberCrit, mul: 1, rings: 1 }, // KAMIKAZE
      { color: PALETTE.telegraph, hot: PALETTE.damageNumber, mul: 1.4, rings: 2 }, // BOSS_SLAM
      { color: PALETTE.robotEye, hot: PALETTE.damageNumber, mul: 2.5, rings: 3 }, // BOSS_DEATH (+ perBossKill éclats)
      { color: PALETTE.playerAccent, hot: PALETTE.player, mul: 1.6, rings: 2 }, // PLAYER_DEATH (+ perPlayerDeath éclats)
      { color: PALETTE.weapon[WEAPON.ROCKETS], hot: PALETTE.damageNumber, mul: 1, rings: 0 }, // ROCKET_TOON : roquette du jeu (onde de src/vfx à la place de l'anneau)
    ],
  },
  // Étincelle d'impact : un éclair bref SUR le robot + des traits projetés. C'est elle qui rend un tir lisible
  // au contact, où le projectile lui-même ne vit que quelques images.
  impact: {
    sparks: 5,
    seconds: 0.22,
    speedMin: 6, // m/s
    speedMax: 12,
    width: 0.09, // m (demi-épaisseur)
    length: 0.5, // m (demi-longueur)
    upMin: 0.5, // m/s
    upMax: 3,
    gain: 1.0,
    shade: 0.1,
    coneDeg: 150, // armes à tir direct : gerbe dans le prolongement du tir (du joueur vers le robot)
    coreSize: 0.36, // m — éclair central
    coreSeconds: 0.09,
    coreGain: 1.1,
    height: 1.0, // m — hauteur de l'impact (celle des tirs)
    offset: 0.25, // m — départ des traits, depuis le centre
    // index = WEAPON.* — true : arme de zone (EMP, roquettes). Chaque robot touché ne reçoit que l'éclair : l'effet
    // de l'arme est son explosion ou son impulsion, et une roquette touche 30 à 60 robots (une gerbe de 5 traits par
    // robot remplissait le pool avant que l'explosion soit créée). Même règle pour une source qui n'est pas une arme.
    radial: [false, false, false, true, false, true],
    crowd: 0.7, // mêlée : dès que moins de cette part du pool est libre, la gerbe s'allège, en proportion…
    // …jusqu'à ce nombre de places libres, que les impacts ne prennent JAMAIS (ni gerbe ni éclair) : elles restent
    // aux explosions. 96 = une salve de 5 roquettes (19 étincelles par explosion : éclair, 6 blocs, 2 fumées, 10 traits).
    reserve: 96,
  },
  ring: {
    seconds: 0.3,
    segments: 32,
    width: 0.14, // m — épaisseur du trait au départ…
    widthPerRadius: 0.07, // …+ cette fraction du rayon final ; le trait s'amincit jusqu'à disparaître
    thinning: 0.7, // exposant de l'amincissement (1 = linéaire ; plus petit = le trait reste épais plus longtemps)
    startRadius: 0.2, // fraction du rayon final au départ
    gain: 1.1,
  },
  puff: { seconds: 0.35, size: 0.35, rise: 0.8, gain: 1 },
  spark: {
    drag: 5, // 1/s — frein des traits
    puffDrag: 3, // 1/s — frein des blocs et des bouffées
    gravity: 12, // m/s² — les traits retombent
    depthBias: 1.6, // m vers la caméra : même place à l'écran, mais devant le robot touché
    facetShade: 0.58, // teinte de la facette la moins exposée (1 = aplat) : volume low-poly sans éclairage
  },
  // Coup arrêté par un bouclier : ricochet vers la source, blanc glacé.
  shieldSpark: {
    sparks: 6,
    color: PALETTE.weapon[WEAPON.BLASTER],
    seconds: 0.22,
    speedMin: 6,
    speedMax: 13,
    width: 0.06,
    length: 0.5,
    upMin: 1,
    upMax: 4,
    gain: 1.6,
    shade: 0.2,
    coneDeg: 110,
    edge: 0.75, // m — le ricochet part du bord du bouclier, côté source
    offset: 0.1, // m — départ des traits autour de ce point
    coreSize: 0.4,
    coreSeconds: 0.1,
    coreGain: 2.4,
    height: 1.1,
  },
  heal: {
    color: PALETTE.eyeReparateur,
    ringRadius: 1.0, // m
    ringSeconds: 0.35,
    sparks: 4, // losanges qui montent
    size: 0.13,
    seconds: 0.5,
    rise: 2.6, // m/s
    scatter: 0.45, // m
    gain: 1.15,
    height: 0.6,
  },
  playerHit: {
    color: PALETTE.edgeFlash,
    sparks: 7,
    seconds: 0.22,
    speedMin: 5,
    speedMax: 10,
    width: 0.07,
    length: 0.4,
    upMin: 1,
    upMax: 3.5,
    gain: 1.2,
    shade: 0.2,
    offset: 0.4,
    ringRadius: 1.25, // m — anneau rouge aux pieds du joueur
    ringSeconds: 0.22,
    height: 1.0,
  },
};

// ----- DA « carte mère » : les robots sont des PROGRAMMES de l'AGI (docs/da-carte-mere.md § 10, pilote du 14/11/2026) -----
// Apparition : le robot se compile — une ligne de scan rouge le révèle du bas vers le haut (shader des membres,
// src/anim/allure.js ; remplace la montée d'échelle de COMMON.spawnFadeSeconds). Mort : il se désagrège en voxels
// alignés qui flottent vers le haut en rougeoyant, avec un anneau bref au sol (fx.js : FX.debris est remplacé par
// mort.voxels, perBossKill / perPlayerDeath gardés : le boss et le héros se désagrègent aussi). Sans effet au désert.
export const PROGRAMME = {
  actif: CM,
  couleur: 0xff3b5c, // rouge de l'AGI, un peu rosé : ne se confond ni avec les yeux (#FF3B3B) ni avec le feu
  // durée de la révélation (s) ; ligne de scan = filet net (ligne, part de la hauteur du robot) + traîne qui s'éteint
  // dessous (traine, part de la hauteur) ; éclats (bloom au-dessus de 1,7). 1re passe : bande de 0,2 m à 4,5 → tout le
  // haut révélé restait rouge.
  apparition: { secondes: 0.5, ligne: 0.035, traine: 0.16, gainLigne: 3.2, gainTraine: 0.9 },
  mort: {
    anneau: { rayon: 1.0, secondes: 0.3 }, // × taille du robot
    voxels: {
      voxel: true,
      perKill: 14,
      perBigKill: 28,
      lifeMin: 0.45,
      lifeMax: 0.85,
      speedMin: 0.5,
      speedMax: 2.2,
      upMin: 1.4,
      upMax: 3.6,
      gravity: 1.2, // m/s² : ils flottent
      spinMax: 0, // cubes alignés sur la grille, pas de culbute
      sizeMin: 0.2,
      sizeMax: 0.4,
      arete: 0.12, // épaisseur d'une arête du voxel filaire (part du côté)
      bounce: 0,
      shrink: 0.7,
      scatter: 0.45,
      coneDeg: 360,
      flashSeconds: 0.08,
      glow: 2.4, // lueur rouge (× PROGRAMME.couleur) : 70 % dès le départ, pleine en fin de vie
    },
  },
};
if (PROGRAMME.actif) Object.assign(FX.debris, PROGRAMME.mort.voxels);
//#endregion lot:juice

//#region lot:audio
// =====================================================================================================
// 8. LOT « audio » — sons synthétisés (Web Audio), limitation, volume général.
// =====================================================================================================
// sounds[SFX.x] : dur (s, durée du tampon synthétisé), gain (0..1, niveau de la voix : tous les tampons ont la
// même crête, AUDIO.peak), minInterval (s entre deux départs du même son), maxVoices (voix simultanées),
// pitchVar (± demi-tons tirés par le générateur PRIVÉ d'audio.js, jamais par rand()), priority (0 : bruit de
// combat ; 1 : arme ou explosion ; 2 : son rare et important — voir voiceBudget). Les recettes de synthèse
// (fréquences, enveloppes) vivent dans audio.js, comme les cotes d'un maillage. maxVoices (24) = nombre de
// GainNode créés une seule fois, au premier unlock(), un par voix.
export const AUDIO = {
  masterVolume: 0.6, // volume général par défaut (réglable de 0 à 1)
  maxVoices: 24, // voix simultanées, tous sons confondus
  // Budget de voix : les sons de priorité 0 ne prennent jamais plus de voiceBudget[0] voix ; ceux de priorité 0 et 1
  // réunis, jamais plus de voiceBudget[1] ; la priorité 2 a droit aux 24. Une horde ne fait donc taire ni une arme,
  // ni une alarme.
  voiceBudget: [12, 18],
  voiceRelease: 0.08, // s ajoutées à la fin calculée d'une voix (l'horloge du jeu retarde sur celle du son)
  startGrace: 0.25, // s après le geste qui CRÉE le contexte : il démarre encore (Firefox), les départs sont déjà acceptés
  distance: { ref: 10, max: 45, exponent: 1.5 }, // atténuation avec la distance au joueur (m) : 1 jusqu'à ref, 0 à max
  busGain: 0.45, // gain fixe avant le compresseur : gain général = volume × busGain
  // Compresseur de sortie réglé en limiteur (mesuré dans Chromium et Firefox, tests/audio.test.mjs) : sous le seuil
  // le son passe tel quel, avec le gain d'appoint du nœud (×2,03, que busGain compense : un son seul sort à
  // 0,91 × crête × gain × volume) ; au-dessus la somme plafonne (−3 à −5 dBFS pour 10 s de combat dense, moins de
  // 0 dBFS même 24 voix en phase à plein gain). Le seuil laisse chaque son SEUL sous la compression au volume par
  // défaut : Firefox filtre l'entrée de son compresseur (aigus renforcés), et un son clair qui dépasse le seuil y
  // sort jusqu'à 3,5 dB plus bas que dans Chromium (volume à 100 %).
  compressor: { threshold: -12, knee: 4, ratio: 20, attack: 0.001, release: 0.15 },
  // Un compresseur neuf plonge puis remonte : ce qu'il reçoit pendant un dixième de seconde sort étouffé (−15 dB
  // mesurés sur le premier tic, −18 dB sur un tir de blaster). Avec une attaque longue il ne plonge pas (écart
  // mesuré : 0,06 dB au plus, Chromium et Firefox) : il naît avec l'attaque « settleAttack », une amorce inaudible le
  // traverse, et audio.update lui rend l'attaque de « compressor » après « settle » secondes d'horloge audio. Le
  // premier son d'une séance part donc tout de suite, à son niveau. Pendant ces instants le limiteur est lent :
  // le contexte naît du geste qui lance la partie (ou avant), seuls un clic d'interface et un tic de compte à
  // rebours peuvent sonner à ce moment, et leur somme reste sous le seuil.
  settle: 0.12, // s d'horloge audio avant de rendre son attaque au compresseur (son détecteur se pose en 0,06 s)
  settleAttack: 1, // s — attaque du compresseur pendant ces premiers instants (le maximum de l'API)
  primerLevel: 1e-6, // amplitude de l'amorce (−120 dBFS)
  // Hauteur qui monte en série : un demi-ton par collecte, jusqu'à maxSteps marches ; au sommet la série redescend
  // de loopSteps marches et continue de monter (12 : une octave plus bas, la suite des notes ne s'interrompt pas ;
  // 0 : elle reste au sommet — une collecte continue répète alors la même note aiguë, 84 % des tintements mesurés).
  // Elle retombe à la première marche après resetAfter secondes sans collecte.
  gem: { stepSemitones: 1, maxSteps: 14, loopSteps: 12, resetAfter: 0.6 },
  maxBufferRate: 48000, // Hz — les tampons sont synthétisés à la fréquence du contexte, bornée à cette valeur
  peak: 0.9, // crête de chaque tampon après synthèse (0 dBFS = 1)
  fadeIn: 0.0015, // s — fondu d'entrée de tout tampon (aucun clic à l'attaque)
  fadeOut: 0.006, // s — fondu de sortie de tout tampon (aucun clic à la fin)
  // s de silence à la fin de chaque tampon, comptées à sa vitesse de lecture la plus haute : Firefox coupe net les
  // 6 ms que le compresseur garde en avance dès que son entrée se tait (clic mesuré) ; ce silence les laisse sortir.
  tailSilence: 0.008,
  seed: 0x5eed, // graine du générateur privé des hauteurs
  sounds: [
    // Gains réglés sur une mesure : niveau efficace sur 50 ms × gain. Bruits continus (impact, orbitaux, gemme,
    // blaster) entre −36 et −29 dB ; armes lourdes −24 à −20 ; explosion −16,5 ; grands moments −15 à −10.
    { dur: 0.1, gain: 0.16, minInterval: 0.05, maxVoices: 2, pitchVar: 2, priority: 1 }, // BLASTER
    { dur: 0.09, gain: 0.15, minInterval: 0.1, maxVoices: 2, pitchVar: 3, priority: 1 }, // ORBITAL
    { dur: 0.22, gain: 0.35, minInterval: 0.12, maxVoices: 2, pitchVar: 1.5, priority: 1 }, // SHOTGUN
    // maxVoices 2 : une voix d'EMP reste prise 0,40 s (durée / vitesse + voiceRelease) et l'arme pulse jusqu'à
    // 4,2 fois par seconde (niveau 5 × Cadenceur) : avec une seule voix, une impulsion sur deux était muette
    { dur: 0.3, gain: 0.11, minInterval: 0.2, maxVoices: 2, pitchVar: 1, priority: 1 }, // EMP
    { dur: 0.4, gain: 0.31, minInterval: 0.15, maxVoices: 2, pitchVar: 1, priority: 1 }, // RAIL
    { dur: 0.35, gain: 0.18, minInterval: 0.1, maxVoices: 2, pitchVar: 2, priority: 1 }, // ROCKET
    { dur: 0.055, gain: 0.14, minInterval: 0.06, maxVoices: 2, pitchVar: 4, priority: 0 }, // HIT
    { dur: 0.2, gain: 0.18, minInterval: 0.1, maxVoices: 2, pitchVar: 2, priority: 0 }, // SHIELD_BLOCK
    { dur: 0.24, gain: 0.105, minInterval: 0.07, maxVoices: 2, pitchVar: 4, priority: 0 }, // ROBOT_DEATH
    { dur: 0.55, gain: 0.37, minInterval: 0.08, maxVoices: 3, pitchVar: 2, priority: 1 }, // EXPLOSION
    { dur: 1.0, gain: 0.63, minInterval: 0.2, maxVoices: 2, pitchVar: 1, priority: 2 }, // EXPLOSION_BIG
    { dur: 0.14, gain: 0.12, minInterval: 0.1, maxVoices: 2, pitchVar: 2, priority: 0 }, // ENEMY_SHOT
    { dur: 0.08, gain: 0.07, minInterval: 0.1, maxVoices: 2, pitchVar: 0, priority: 0 }, // KAMIKAZE_BEEP
    { dur: 0.32, gain: 0.105, minInterval: 0.3, maxVoices: 2, pitchVar: 1, priority: 0 }, // HEAL
    { dur: 0.28, gain: 0.55, minInterval: 0.2, maxVoices: 1, pitchVar: 1, priority: 2 }, // PLAYER_HURT
    { dur: 0.24, gain: 0.27, minInterval: 0.1, maxVoices: 1, pitchVar: 1, priority: 2 }, // PLAYER_DASH
    { dur: 0.14, gain: 0.15, minInterval: 0.5, maxVoices: 1, pitchVar: 0, priority: 2 }, // DASH_READY
    { dur: 0.12, gain: 0.125, minInterval: 0.04, maxVoices: 3, pitchVar: 0, priority: 0 }, // GEM
    { dur: 0.14, gain: 0.16, minInterval: 0.06, maxVoices: 2, pitchVar: 1, priority: 0 }, // FRAGMENT
    // maxVoices 2 : deux niveaux pris coup sur coup (les choix s'enchaînent) font entendre deux fanfares
    { dur: 0.75, gain: 0.5, minInterval: 0.3, maxVoices: 2, pitchVar: 0, priority: 2 }, // LEVEL_UP
    { dur: 0.28, gain: 0.31, minInterval: 0.1, maxVoices: 2, pitchVar: 0, priority: 2 }, // BONUS_PICK
    { dur: 0.3, gain: 0.37, minInterval: 0.05, maxVoices: 3, pitchVar: 1, priority: 2 }, // BUY
    { dur: 0.22, gain: 0.13, minInterval: 0.1, maxVoices: 2, pitchVar: 0, priority: 2 }, // BUY_DENIED
    { dur: 0.7, gain: 0.27, minInterval: 0.5, maxVoices: 1, pitchVar: 0, priority: 2 }, // MERCHANT_LAND
    { dur: 0.7, gain: 0.26, minInterval: 0.5, maxVoices: 1, pitchVar: 0, priority: 2 }, // MERCHANT_LEAVE
    { dur: 0.7, gain: 0.45, minInterval: 0.5, maxVoices: 1, pitchVar: 0, priority: 2 }, // WAVE_START
    { dur: 0.9, gain: 0.52, minInterval: 0.5, maxVoices: 1, pitchVar: 0, priority: 2 }, // WAVE_CLEAR
    { dur: 0.12, gain: 0.3, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 }, // COUNTDOWN_TICK
    { dur: 0.35, gain: 0.41, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 }, // COUNTDOWN_GO
    { dur: 1.8, gain: 0.47, minInterval: 1.0, maxVoices: 1, pitchVar: 0, priority: 2 }, // BOSS_ALARM
    { dur: 0.45, gain: 0.24, minInterval: 0.2, maxVoices: 2, pitchVar: 0, priority: 2 }, // BOSS_TELEGRAPH
    { dur: 0.7, gain: 0.73, minInterval: 0.2, maxVoices: 2, pitchVar: 1, priority: 2 }, // BOSS_SLAM
    { dur: 1.1, gain: 0.53, minInterval: 1.0, maxVoices: 1, pitchVar: 0, priority: 2 }, // BOSS_PHASE
    { dur: 2.0, gain: 0.8, minInterval: 1.0, maxVoices: 1, pitchVar: 0, priority: 2 }, // BOSS_DEATH
    { dur: 0.06, gain: 0.22, minInterval: 0.03, maxVoices: 2, pitchVar: 0, priority: 2 }, // UI_CLICK
    { dur: 1.3, gain: 0.56, minInterval: 1.0, maxVoices: 1, pitchVar: 0, priority: 2 }, // GAME_OVER
    { dur: 1.3, gain: 0.59, minInterval: 1.0, maxVoices: 1, pitchVar: 0, priority: 2 }, // NEW_BEST
    // Réglages de l'aperçu validé (tests/jouable/audio.js) : 0,2 s entre deux pas, 2 voix.
    { dur: 0.4, gain: 0.5, minInterval: 0.2, maxVoices: 4, pitchVar: 1, priority: 2 }, // BOSS_STEP (4 voix depuis le 14/11 : les fichiers durent 0,9 s ; avec 2, la charge ne faisait entendre que 2 pas sur ≈ 10, § Z nonies)
    // Étape 1 du plan addictif (§ E1.A) : purge de fin de vague — fichier « Champ EMP.wav » de Femz, découpe longue
    { dur: 1.2, gain: 0.4, minInterval: 1.0, maxVoices: 1, pitchVar: 0, priority: 2 }, // PURGE
    // Chantier B (§ E1.B) : alerte d'une mise à jour — fichier « Alarme d'arrivée.wav » de Femz, découpe courte (0,9 s)
    { dur: 0.9, gain: 0.35, minInterval: 1.0, maxVoices: 1, pitchVar: 0, priority: 2 }, // ALERT
    // Chantier D (§ E1.D) : rayon du balayage laser du boss — fichier « Fusil à rail.wav » de Femz (inutilisé depuis
    // que le rail joue un son OCULAR), découpe de 2,4 s = la durée du balayage
    { dur: 2.4, gain: 0.35, minInterval: 1.0, maxVoices: 1, pitchVar: 0, priority: 2 }, // BOSS_LASER
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // RICOCHET (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // BLADE (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // TURRET_DEPLOY (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // TURRET_SHOT (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // CHEST_DROP (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // CHEST_OPEN (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // ROULETTE_TICK (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // RARITY_0 (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // RARITY_1 (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // RARITY_2 (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // RARITY_3 (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // RARITY_4 (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // RARITY_5 (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // CHEST_PICK (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // AGENT_SELECT (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // REROLL (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // BANISH (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // POOL_THROW (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // BOOMERANG (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // MINE_DROP (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // ITEM_TESLA (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // ITEM_BOOM (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // ITEM_PROC (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // ITEM_SHIELD (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // ITEM_GET (socle E2 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // ELITE_MOD (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // JACKPOT (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // FRAG_RAIN (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // PROP_BREAK (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // UTIL_PICK (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // UTIL_IEM (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // UTIL_STUN (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // UTIL_TURBO (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // DRILL (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // MINE_ENEMY (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // SCAN_LASER (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // SPLIT (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // CARRYOVER (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // KATANA (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // GRENADE (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // SMOKE (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // FLASH (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // CANNON (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // HAMMER (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // EVOLVE (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // FUSION (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // CD_READY (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // CD_FIRE (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // UI_OPEN (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // SLASH_LIGHT (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // SLASH_HEAVY (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // IAIDO (socle E3 : réglé par son chantier)
    { dur: 0.1, gain: 0.01, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 0 }, // TURRET_PLANT (socle E3 : réglé par son chantier)
  ],
  // ----- Fichiers de Femz (intégration des sons, 13/11/2026) -----------------------------------------------------
  // Les sons du jeu sont ses fichiers (« sfx game », OCULAR), préparés par outils/preparer_*.py : découpés pour que
  // l'impact tombe en tête de fichier, et leur gain calé sur le mixage ci-dessus (même niveau perçu que le son
  // synthétisé qu'ils remplacent, corrections de Femz comprises : morts −4 dB, rail +2 dB, début de vague −6 dB).
  // Ces gains, les fichiers et le « lead » du marchand vivent dans le manifeste écrit par ces outils (une seule
  // source) ; ici, ce qui règle la lecture. Les règles du moteur restent celles de sounds[] (écart, voix, priorité,
  // distance, limiteur, série des gemmes). Un son dont le fichier manque, ne se télécharge pas ou ne se décode pas
  // retombe sur son tampon synthétisé.
  files: {
    manifest: 'assets/sfx/manifeste.json', // relatif à la page
    sfxDir: 'assets/sfx/',
    ambianceDir: 'assets/ambiance/',
    decodeRate: 48000, // Hz — fréquence du contexte hors ligne qui décode les fichiers avant le premier geste
    // Variation de hauteur des fichiers = pitchVar × ce facteur. 0 : joués à leur hauteur, comme dans l'aperçu
    // validé par Femz (la variété vient des variantes tirées à tour de rôle) ; la série des gemmes monte toujours.
    pitchScale: 0,
    // Sons dont le fichier contient TOUTE la séquence : le jeu le lance à son début (play) et ses rappels
    // (playStep : « 2 », « 1 » du compte à rebours, éclats de la mèche du kamikaze) ne rejouent rien.
    sequences: [SFX.COUNTDOWN_TICK, SFX.KAMIKAZE_BEEP],
  },
  // Niveau de la MUSIQUE (21/11/2026 : la nappe OCULAR est remplacée par la bande-son ci-dessous ; le nom « ambiance »
  // reste pour audio.setAmbiance, la panne et l'écran titre). Pistes à −14 LUFS (outils/preparer_musique.py) :
  // 0,25 = −12 dB → ≈ −26 LUFS avant le volume général, sous les bruitages. Écran titre : MENU.son.ambiance.
  ambiance: {
    gain: 0.25, // niveau de la musique en partie, avant le volume général
    fadeIn: 1.5, // s — montée à l'entrée (constante de temps = fadeIn / 3)
  },
  // Bande-son (pistes Suno choisies par Femz le 21/11, docs/soundtrack-suno.md ; MAQUETTES du plan gratuit, non
  // commerciales : à regénérer sous abonnement avant Steam). Lue en flux, une piste par moment du jeu (main.js,
  // pisteVoulue) ; jamais de coupure nette : fondu enchaîné entre deux pistes, fin d'une piste fondue dans son début.
  musique: {
    dir: 'assets/musique/',
    pistes: {
      restauration: 'restauration.mp3', // écran titre, choix de l'agent, Noyau
      vague: 'vague.mp3', // combat
      boss: 'boss.mp3', // vague de boss (dès son compte à rebours)
      decryptage: 'decryptage.mp3', // marchand du décryptage, terminal
      segfault: 'segfault.mp3', // écran de fin
    },
    fondu: 2.5, // s — fondu enchaîné entre deux pistes
    fonduBoucle: 6, // s — la fin d'une piste se fond dans son propre début
    fonduFocus: 0.6, // s — extinction / retour quand la fenêtre quitte / retrouve le premier plan
  },
};
// § E5.AD (ARCHITECTURE.md) : sons EXISTANTS branchés sur des moments muets — aucun fichier, aucun réglage de son touché
// (gains, maxVoices, minInterval de AUDIO.sounds inchangés). Seul réglage neuf : le refus de la Frappe éclair (touche
// pressée pendant une recharge que la mémoire de l'appui ne couvre pas) joue BUY_DENIED adouci (gain × gain) et au plus
// une fois toutes les `ecart` s, même si la touche est martelée.
export const SONS_EXISTANTS = { refusFrappe: { gain: 0.6, ecart: 0.5 } };
//#endregion lot:audio

//#region lot:ui
// =====================================================================================================
// 9. LOT « ui » — interface DOM (HUD, écrans, flèches).
// =====================================================================================================
export const UI = {
  // Flèches de bord d'écran (seuil : WAVES.arrows.threshold). insetPx et sizePx : pixels CSS dans la fenêtre de
  // référence (UI.scale), mis à l'échelle de l'interface comme tout le reste (retrait de 51 px en 1920 × 1080).
  // pxCacheSize : chaînes « N px » créées à l'init pour N de 0 à pxCacheSize − 1 (une flèche qui bouge n'alloue rien
  // tant que la fenêtre tient dans 4 096 px).
  arrows: { max: 9, insetPx: 34, sizePx: 28, pxCacheSize: 4096 },
  xpBarStep: 0.0025, // la barre d'XP n'est réécrite que si elle change d'au moins 0,25 % (4,8 px sur 1 920 de large)
  hpLowFraction: 0.3, // PV en alerte sous 30 %
  countdownPopSeconds: 0.25, // durée du « pop » de chaque chiffre du compte à rebours
  gameOverGuardSeconds: 0.6, // Entrée ET bouton « Rejouer » ignorés juste après la mort (actions.restart renvoie false)
  title: 'CTRL+Z',
  logoSrc: 'assets/logo/ctrlz-logo.png', // logo pixel de l'écran titre (ChatGPT, 13/11/2026 ; fond transparent net)
  // Glyphes de repli (index = WEAPON.*). Les icônes affichées sont des SVG en ligne dessinés dans ui.js ; le glyphe
  // sert de texte de remplacement (info-bulle) de chaque emplacement d'arme.
  weaponIcons: ['◉', '◎', '⫸', '⌁', '━', '✹'],
  intCacheSize: 1000, // chaînes des entiers 0 à 999 créées à l'init : aucune chaîne construite quand un compteur change
  // ----- Ajouts du lot ui -----
  hpBarStep: 0.005, // la barre de PV est réécrite quand elle varie de 0,5 %
  dashBarStep: 0.05, // la recharge du dash est réécrite quand elle varie de 5 % (§ Q)
  bossBarStep: 0.01, // la barre de vie du boss est réécrite quand elle varie de 1 % (§ Q)
  // Échelle de l'interface : 1 rem = remPx dans une fenêtre designWidthPx × designHeightPx, puis proportionnel au
  // côté le plus contraint (24 px en 1920 × 1080), borné à [minRemPx, maxRemPx]. Toute la feuille ui.css est en rem.
  scale: { designWidthPx: 1280, designHeightPx: 720, remPx: 16, minRemPx: 11, maxRemPx: 32 },
  screenInSeconds: 0.14, // apparition d'un écran (opacité et léger glissement)
  bumpSeconds: 0.22, // rebond du solde et du cran qui s'allume après un achat
  bannerInFraction: 0.12, // part de la durée d'une bannière passée à apparaître…
  bannerOutFraction: 0.2, // …et à s'effacer
  // Étape 1 du plan addictif (§ E1.A) : pastille du chrono de vague (« m:ss », clignote sous WAVES.clock.warnSeconds)
  clock: { blinkHz: 2 },
  // § E1.D : pastille « Record » du HUD (« — » sans record) et bannière au dépassement du record pendant la partie
  record: { label: 'Record vague ', none: '—', kicker: 'NOUVEAU RECORD', title: 'VAGUE ', bannerSeconds: 2.6 }, // bannière « kicker : title N », cyan (c'est l'agent qui gagne)
};
//#endregion lot:ui

//#region anim:reglages
// ----- ANIM : animations des unités (étape « animations » du grand branchement, 13/11/2026 ; ARCHITECTURE.md § Z sexies).
// Mêmes noms, même structure qu'au prototype (src/anim/reglages.js ne fait plus que les réexporter). Lus par src/anim/ :
// heros (héros animé), corps (buste et jambes séparés, cône du buste), armes (visée, bouches, tourelles), flammes (boss),
// boss (marche à genoux, obus, invocations), cape (tissu), reperes (R1 / R2 au sol), robots (allure, membres).
// Aucune valeur n'est lue dans un chemin chaud sans avoir été copiée dans une constante de module à l'init.
export const ANIM = {
  // ----- Héros (P4) : marche, dash, roulis, tassement. Angles en radians, temps en secondes.
  heros: {
    stride: 2.4, // rad de phase par mètre parcouru (2,6 m par cycle de deux pas)
    gaitRate: 10, // 1/s — lissage de l'allure (0 = arrêt, 1 = vitesse de marche)
    bobAmp: 0.07, // m — rebond du corps (le plus haut quand la jambe d'appui passe sous le bassin)
    legSwing: 0.5, // amplitude des cuisses à pleine allure
    knee: 0.8, // flexion du genou pendant le retour de la jambe
    armSwing: 0.55, // balancier des bras (opposé aux jambes)
    forearmRun: 0.85, // avant-bras plié en course
    forearmIdle: 0.18,
    armOut: 0.1, // bras légèrement écartés du corps
    leanSpeed: 0.12, // penché avant à pleine allure
    leanAccel: 0.1, // penché supplémentaire par accélération (fraction de PLAYER.accel) : se penche au départ, se redresse au freinage
    leanRate: 12,
    bank: 0.045, // roulis par rad/s de virage × allure
    bankMax: 0.22,
    bankRate: 10,
    stopSquash: 0.085, // tassement à l'arrêt net (fraction de hauteur)
    stopHz: 5.5,
    stopDamp: 11,
    breatheHz: 0.45, // respiration au repos
    breathe: 0.012,
    // dash : anticipation (ramassé), étirement le long de la course, réception (ressort)
    dashAnticipation: 0.035, // s — ramassé au tout début du dash (le déplacement, lui, part tout de suite)
    dashGather: [1.1, 0.86, 0.9], // échelle locale (x, y, z) pendant l'anticipation
    dashStretch: [0.86, 0.94, 1.32],
    dashLean: 0.38,
    dashArms: 1.05, // bras rejetés en arrière
    landSquash: [1.1, 0.88, 0.92], // à la réception, revient en ressort amorti
    landHz: 6,
    landDamp: 14,
    ghostEvery: 0.045, // s de dash entre deux images rémanentes (émission au temps simulé : même nombre à 60 et 240 Hz)
    ghostLife: 0.18,
    ghostCount: 8, // capacité
    ghostColor: [0.05, 0.75, 0.66], // cyan de l'accent (linéaire approx.) × ghostGain
    ghostGain: 0.7,
    invulnGlow: 0.6, // P1 : invulnérabilité en lueur cyan au lieu du blanc
    dashGlow: 0.35,
    xrayShade: 0.8,
    brasRayon: 0.1, // m — capsule de chaque bras pour la cape (épaule → main)
    jambeRayon: 0.11, // m — capsule de chaque jambe (hanche → pied)
    lisere: 0.22, // force du liseré cyan du profil peint du héros animé (rendu : 0,8) — voir heros-anim.profilHeros
    // ----- Pieds (os de cheville et d'orteils de heros.glb, 14/11) : pied d'appui posé À PLAT par la cheville, déroulé du
    // pas. Angles du pied en monde (+ = pointe vers le bas), rad ; phases en fraction de l'appui ou du retour, pour la
    // marche AVANT (la marche arrière joue le même déroulé à l'envers : pointe d'abord, départ par le talon). Amplitudes
    // × |cos α| (part avant / arrière du pas) × allure × amplitude du pas : nulles au repos et de côté.
    pied: {
      attaque: 0.12, // part de l'appui sur le talon (attaque talon, pointe relevée), puis à plat
      decollement: 0.62, // le talon se lève à partir de cette part de l'appui (poussée), pivot à la base des orteils
      talon: 0.2, // pointe relevée à l'attaque du talon
      poussee: 0.55, // talon levé à la fin de l'appui (les orteils restent à plat au sol : fléchis d'autant)
      degagement: 0.2, // pointe relevée au milieu du retour (le pied passe au-dessus du sol)
      relache: 0.3, // part du retour où les orteils reviennent dans l'axe du pied
      fondu: 0.025, // s — la jambe quitte la solution d'appui en fondu (court : un fondu long rabotait la levée du pied)
      marge: 0.004, // m — aucun sommet d'un pied en l'air sous cette hauteur (sinon la jambe le relève)
      // fin du retour (cinématique inverse de la cheville) : à partir de `approche` (part du retour), le pied garde au
      // moins `hauteur` de garde au sol (× allure) ; à partir de `pose`, il descend en courbe douce vers son point de
      // pose, où le talon (la pointe en marche arrière) touche le sol — ni avant, ni d'un coup (contrôle du 14/11 : il
      // touchait 2 images avant l'ancrage et filait au ras du sol à 17–19 m/s)
      approche: 0.5,
      pose: 0.7,
      hauteur: 0.06, // m
      // pied posé : son lacet est FIGÉ (il ne tourne pas sur lui-même quand le bassin tourne : la hanche absorbe) ; au-delà
      // de lacetMax d'écart avec le bassin, il pivote sur la plante (base des orteils) ; rendu à la jambe en lacetFondu
      // une fois levé
      lacetMax: 0.5, // rad
      lacetFondu: 0.08, // s
      capeLocal: [0.0, -0.12, 0.06], // m — bout de la capsule de jambe de la cape, dans le repère de l'os du pied
      // pied d'appui qui s'éloigne (virage, demi-tour) : le bassin descend pour le garder à portée (au plus descenteMax, m) ;
      // dès que cette descente dépasse `seuil` (m), la cadence accélère (× 1 + gain à `plein`) : le pas se termine plus tôt
      // et l'autre pied se pose — comme on raccourcit ses pas pour tourner
      portee: { descenteMax: 0.1, seuil: 0.05, plein: 0.12, gain: 1.5 },
      dash: [0.5, -0.15], // angle local du pied g, d pendant le dash (pointe tendue derrière, relevée devant)
      // à l'arrêt (et après un pivot) les deux pieds restent posés ; le plus éloigné de sous sa hanche revient d'un petit pas
      recentrage: { seuil: 0.07, duree: 0.24, levee: 0.05 }, // m, s, m
    },
  },
  // ----- Buste et jambes séparés (demande de Femz du 13/11 : « il avance face avant mais ses bras tirent vers l'arrière »)
  corps: {
    torsionMax: 1.22, // rad (70°) — buste / bassin ; au-delà, le bassin tourne
    cone: 0.785, // rad (45°) — les bras ne visent que dans ce cône autour de la visée du buste
    // décision de Femz (13/11) : les armes de BRAS choisissent leurs cibles DANS le cône (plus de tir ramené au bord) ;
    // aucune cible dans le cône → la salve attend que le buste ait tourné. false = ancien comportement (bornage)
    ciblesDansCone: true,
    viseeLissage: 0.1, // s — le buste rejoint sa visée (pas de saut d'une cible à l'autre en moins de ~150 ms)
    viseeVitesseMax: 11, // rad/s
    retourMarche: 0.25, // s — sans tir depuis « tenue », le buste revient à la direction de marche
    bassinFondu: 0.14, // s — fondu de l'orientation du bassin entre états (120 à 200 ms)
    seuils: [1.047, 2.094], // rad — 60° et 120° entre déplacement et visée : avant / chassés / arrière
    hysteresis: 0.175, // rad (10°)
    // héros v10 (15/11, pièces générées) : hanche 1,107, genou 0,69 (pivots de jambe_g / tibia_g du .glb) ; v6–v8 :
    // 0,917 / 0,567 — mêmes écarts gardés (levier = hanche − 0,04 ; abdomen = hanche − 0,037 … + 0,203)
    hanche: 1.107, // m — hauteur de hanche du modèle
    genouY: 0.69, // m — hauteur du genou (pivot du tibia)
    levier: 1.067, // m — hanche → semelle : longueur de jambe pour la cadence de la foulée (les longueurs de la cinématique
    // inverse — cuisse, tibia, cheville — sont lues sur les pivots du modèle)
    amplitude: [0.58, 0.42, 0.44], // rad — angle de cuisse en avant, en chassés, en arrière ; la cadence en découle
    genou: 1.0, // flexion du genou de la jambe libre
    descente: 0.7, // part de L (1 − cos α) appliquée au bassin (le genou d'appui absorbe le reste)
    ecartChasses: 0.09, // rad — jambes écartées en pas chassés (elles ne se croisent pas)
    pivotVitesse: 7, // rad/s — le bas tourne sur place quand la visée dépasse la torsion à l'arrêt
    pivotPas: 0.16, // rad — petits pas du pivot
    penchArriere: 0.12, // rad — buste penché en avant en marche arrière
    abdomen: [1.07, 1.31], // m — bande du corps où la torsion se répartit (poids de peau mêlés)
    // 16/11 : jambes, pieds et bassin pilotés par les courbes de Running.fbx (src/anim/ref-marche.js, COURSE) — le héros
    // court (6,5 m/s pour 1,07 m de jambe) ; false = ancienne foulée procédurale
    courseRef: true,
    calagePhase: 0.15, // s — le cycle se recale sur le pied d'appui réel (« stride warping »)
  },
  // ----- Armes portées (retour de Femz du 13/11) : visée des bras, bouches, recul, éclairs. Index = WEAPON.*
  // (0 blaster, 1 orbitaux, 2 pompe, 3 EMP, 4 rail, 5 roquettes)
  armes: {
    tenue: 0.55, // s — le bras reste levé après le dernier tir
    preViseeBuste: 0.45, // s — le buste se tourne vers la cible d'un tir imminent (son demi-tour prend ~0,3 s)
    preVisee: 0.2, // s — le bras se lève vers le robot le plus proche quand la recharge sera pleine dans moins de 0,2 s (0 = coupé)
    lissage: 0.08, // s — constante de montée du bras vers sa cible
    retour: 0.18, // s — redescente vers la marche
    hauteurCible: 0.85, // m — hauteur visée sur un robot (tangage du bras)
    lacetExterieur: 1.75, // rad — un bras tourne vers son côté jusqu'à 100°
    lacetInterieur: 0.5, // rad — et en travers du corps jusqu'à 29° ; au-delà, le buste tourne
    busteMax: 0.7, // rad
    recul: [0.14, 0, 0.42, 0, 0.36, 0.22], // impulsion de recul du bras par tir
    reculRetour: 0.09, // s
    eclair: 0.07, // s — éclair de bouche
    eclairEmp: 0.16,
    taille: [0.13, 0, 0.2, 0, 0.17, 0.15], // m — rayon de l'éclair
    tailleEmp: 0.32,
    gainEclair: 3.0,
    sortieOrbitaux: 0.6, // s — les disques sortent du dos jusqu'à leur orbite
    // tourelles d'épaule (le 2e au 5e projectile du blaster, le 2e au 5e rayon du rail)
    tourelleVitesse: 6.28, // rad/s — suivi borné (≈ 360°/s)
    tourelleLissage: 0.05, // s
    tourelleTenue: 0.6, // s — la tourelle garde sa cible puis revient vers l'avant
    tourelleDeploiement: 0.45, // s — montée + rotation à l'achat
    tourelleRecul: 0.035, // m — le canon recule à chaque tir
    tourelleEclair: 0.1, // m — rayon de l'éclair
  },
  // ----- Flammes simulées (cheminées, fissures et réacteur du boss)
  flammes: {
    cap: 600,
    hz: 120,
    heritage: 0.25, // part de la vitesse du porteur donnée aux particules : il avance, elles restent derrière
    flottaison: 7.5, // m/s² × chaleur
    ralentiFumee: 1.2, // m/s² — la fumée froide perd sa montée
    turbulence: 5.0, // m/s² — intensité du champ de rotationnel
    echelle: 1.4, // 1/m — taille des volutes
    trainee: 2.2, // 1/s — vers l'air immobile
    vieFeu: 0.75,
    vieFumee: 1.6,
    tailleFeu: 0.75,
    tailleFumee: 0.9,
    grossitFumee: 1.4,
    opaciteFumee: 0.55,
  },
  // ----- Boss (proposition v3) : obus du mortier depuis les cheminées, invocations depuis le ventre
  boss: {
    ecart: 0.05, // s entre deux obus (cheminée gauche, droite, gauche…) : 5 obus partent en 0,36 s, dans le lancer de 0,5 s
    cloche: 4.0, // m de flèche de la cloche (+ 15 % de la distance)
    rayon: 0.5, // m
    fumee: 0.05, // s entre deux bouffées de la traînée
    fumeeDepart: 4, // bouffées au départ
    eclair: 0.12, // s
    tailleEclair: 0.55, // m
    ecartInvocation: 0.07,
    clocheInvocation: 1.6,
    // corps en pièces (boss-corps.js)
    foulee: 2.7, // rad de phase par mètre (16/11 : 2,0 → 2,7 — pas trop long pour la jambe : cuisse à 59° au contact, pied lâché à 0,9 m derrière la hanche) : un pas = π / 2,7 m ≈ 1,16 m ; amplitude des jambes = π / (2 × hanche × foulée)
    piston: 0.1, // repli sans tibia (boss-v1.glb) : la jambe libre se raccourcit de 10 % au milieu de son retour
    genou: 0.7, // rad — flexion maximale du genou de la jambe libre (16/11 : 0,9 → 0,7, tibia à l'horizontale derrière)
    genouAppui: 0.04, // rad — jambe d'appui presque tendue
    // 16/11 : jambes pilotées par les courbes de référence (src/anim/ref-marche.js, Walking.fbx de Femz) ; false = ancienne
    // marche procédurale (déroulé ci-dessous)
    marcheRef: true,
    piedEchelle: 0.55, // pied du boss 4,6 × plus long que la réf (par rapport à la jambe) : sinus des angles de pied × 0,55
    calagePhase: 0.2, // s — le cycle se recale sur le pied d'appui réel (« stride warping ») en ~0,2 s
    piedVitesse: 4, // rad/s — vitesse max à laquelle la pointe du pied libre remonte après le décollage (à-coup de 15° sinon)
    leveeBassin: 0.15, // m — levée max du bassin pour que le talon avant (pointe relevée) passe avant l'attaque
    pousseeMax: 1.0, // rad — talon levé max de la jambe d'appui en poussée
    bassinDescente: 1.2, // m/s — descente max du bassin à la mise en charge (le talon démesuré le faisait tomber à 2,7 m/s)
    ruee: { cadence: 2.4, fondu: 0.12 }, // ruée : courbes de Running, cadence plafonnée (cycles/s), fondu marche ↔ course (s)
    // DÉROULÉ DU PIED (réf de Femz du 16/11, « delay the foot ») : attaque du TALON (pointe relevée), pied à plat, le
    // talon décolle et le pied pivote sur la POINTE, qui part en dernier ; au passage, le pied levé pointe vers le bas
    // (il traîne) puis se relève avant le contact. Position basse juste après le contact. actif: false = pied à plat.
    // Angles (rad) : talonAttaque = pointe relevée au contact, pointeDecolle = talon levé au départ ; uTalon / uPointe =
    // fin du déroulé talon / début du déroulé pointe (fraction de l'appui) ; pointeTraine = pied pointé au passage ;
    // descente = m de bassin en plus à la position basse.
    deroule: { actif: true, talonAttaque: 0.22, pointeDecolle: 0.5, uTalon: 0.14, uPointe: 0.58, pointeTraine: 0.05, descente: 0.04, levee: 0.18, decolle: 0.15, pointeMax: 0.6, genouMax: 0.8 }, // decolle : part du retour où la pointe reste plantée (double appui), pointeMax : talon levé au lâcher, genouMax : flexion maximale de la jambe d'appui (rad) — au-delà, le pied lâche le sol // levee : m d'arc du pied libre au milieu du pas
    rebond: 0.18, // m — le bassin descend à chaque appui
    roulis: 0.05, // rad — vers la jambe d'appui
    bras: 0.5, // × angle de la jambe du même côté, en opposition
    teteRetard: 4, // 1/s
    frappeLeve: 2.6, // rad — poings au-dessus de la tête à la fin du télégraphe
    frappeImpact: 0.75, // rad — poings abattus devant lui
    rueeBras: 0.7,
    rueePenche: 0.12, // rad en plus du penché de la ruée
    reculMortier: 0.1, // rad par obus
    bouffeeMortier: 22,
    poussierePas: 3,
    secoussePas: 0.025, // trauma par pas (plafond demandé : 0,03 ; groupe boss)
    debitCheminee: 75, // particules / s, phase 2
    debitFumee: 9, // phase 1 : fumée seule
    debitFumeeFeu: 14,
    debitReacteur: 26,
    debitFissures: 18,
  },
  // ----- Cape (R3) : Verlet maison, pas fixe
  cape: {
    hz: 120, // pas fixe de la simulation (sous-pas accumulés)
    maxSubsteps: 8, // au plus par image (une image de 1/30 s = 4 sous-pas)
    cols: 6,
    rows: 9, // dont la dernière = pointes
    longueur: 0.95, // m, des épaules au bas du tissu (sans les pointes)
    largeurHaut: 0.38, // m, entre les deux points d'accroche
    largeurBas: 0.62,
    pointes: [0.16, 0.27, 0.12, 0.3, 0.2, 0.25], // m, longueur de chaque pointe (une par colonne), irrégulières
    decalagePointes: [0.03, -0.02, 0.025, -0.03, 0.02, -0.015], // m, décalage latéral du bout de chaque pointe
    iterations: 8,
    raideur: 1.0, // structure
    raideurCisaillement: 0.6,
    raideurFlexion: 0.12, // flexion légère : le tissu plie
    raideurPointe: 0.9,
    gravite: 9.8,
    amortissement: 0.012, // fraction de vitesse perdue par sous-pas
    traineeNormale: 2.4, // 1/s — traînée de l'air le long de la normale (ce qui fait flotter et gonfler)
    traineeTangente: 0.25, // 1/s
    souffle: 0.5, // m/s — souffle de repos (ondulation légère), bruit déterministe du temps
    souffleHz: 0.7,
    // Identité des agents (Femz, 22/11) : cape BLANCHE (avant : dehors noir bleuté 0x2a2633, dedans noir bordeaux 0x3a2231)
    couleur: 0xece7dc, // dehors : blanc cassé (jamais blanc pur)
    couleurDedans: 0xc9c2b4, // dedans : blanc cassé ombré
    degrade: 0.3, // bas plus clair (usure) : × (1 + degrade × rangée / rangées)
    // collisions (repère du modèle .glb ; le dos vient de cape_dos s'il existe)
    jambes: { a: [0, 0.3, -0.02], b: [0, 0.98, -0.02], rayon: 0.2 },
    marge: 0.025, // m — le tissu reste à cette distance des capsules
    // plan du dos (correction du 14/11/2026, ARCHITECTURE.md § Z nonies) : aucune particule libre ne passe devant ce
    // plan du repère du BUSTE (z ≤ dos.a.z − dos.rayon − marge + planDos). En partie, un buste qui se retourne vite (cible
    // derrière, demi-tour) ramenait le tissu lancé DEVANT le torse (relevé jusqu'à 1 m devant, contrôle « partie »).
    // 0 = le plan passe juste derrière le dos ; null = plan coupé.
    planDos: 0,
    // Profil du dos (src/anim/profil-corps.js, retour de Femz du 22/11 : « y'a toujours de l'écart entre les capes et
    // les modèles 3D ») : quand le .glb a sa pièce « corps », le contour relevé du torse REMPLACE le cylindre du dos et
    // le plan ci-dessus (ils tenaient la cape à 10 cm de la taille, 5 cm des épaules) ; repos et accroches posés à
    // ecartDos derrière le dos, tissu jamais plus près que margeDos ; adhérence : poussée vers l'avant du buste (m/s²),
    // la cape se pose sur le dos à l'arrêt ; en course la traînée de l'air l'emporte et elle flotte
    ecartDos: 0.012,
    accrocheDy: -0.035, // m — accroches abaissées sur le haut du dos (avec le profil)
    margeDos: 0.01,
    adherence: 3,
    adherenceVmax: 1.5, // m/s — l'adhérence s'efface avec la vitesse du buste : nulle au-delà (en course la cape flotte)
    teleport: 3, // m — au-delà d'un saut d'accroche en une image (téléportation, Rejouer), la cape est replacée
  },
  // ----- Repères au sol R1 (recharge du dash) et R2 (santé basse), retour de Femz du 13/11
  reperes: {
    y: 0.03, // m au-dessus du sol, profondeur testée (cachés par le corps du héros et par les robots debout dessus)
    intensity: 1,
    dash: {
      radius: 0.78,
      width: 0.13,
      segments: 10,
      gapDeg: 7,
      trackGain: 0.5, // crans éteints pendant la recharge
      fillGain: 1.15,
      pingGain: 2.2,
      segPop: 1.3,
      segPopSeconds: 0.09,
      pingSeconds: 0.28,
      pingSwell: 0.22,
      pingWave: 1.8, // × rayon
      pingAccentGlow: 0.9,
      fadeOutDelay: 0.15, // s après le ping
      fadeOutSeconds: 0.5,
      fadeInSeconds: 0.08,
    },
    lowHp: {
      threshold: 0.3,
      exitThreshold: 0.35,
      critical: 0.12,
      periodHigh: 1.0,
      periodLow: 0.45,
      secondBeat: 0.7,
      secondBeatAt: 0.18,
      beatWidth: 0.14,
      radius: 1.0,
      width: 0.11,
      rimWidth: 0.035,
      swell: 0.18,
      waveTo: 2.6,
      waveSeconds: 0.6,
      bodySwell: 0.04,
      fadeInSeconds: 0.2,
      fadeOutDelay: 1.5, // s sans changement de PV
      fadeOutSeconds: 0.6,
      changeMin: 0.04, // fraction des PV max : une hausse lente (régénération) ne compte qu'à partir de cet écart
      gain: 1.3,
    },
  },
  // ----- Robots (P2, P3, P6)
  robots: {
    gaitRate: 8,
    idleAmp: 0.25,
    freqJitter: 0.12,
    stepWindow: 0.35,
    hit: { squash: 0.2, tilt: 0.06, tiltMax: 0.22 },
    // par type : bobAmp (m), swayAmp (rad), stepSquash, leanFwd (rad), membres (shader)
    types: {
      rodeur: { bobAmp: 0.16, swayAmp: 0.14, stepSquash: 0.1, leanFwd: 0.12, legSwing: 0.75, armSwing: 0.45 },
      drone: { bobAmp: 0.12, swayAmp: 0.04, stepSquash: 0, leanFwd: 0.18, rotor: 55 }, // rad/s des rotors
      tireur: { bobAmp: 0.05, swayAmp: 0.05, stepSquash: 0.05, leanFwd: 0.05, crampon: 0.149, trackSpeed: 1.0 },
      kamikaze: { bobAmp: 0.12, swayAmp: 0.16, stepSquash: 0.12, leanFwd: 0.14, legSwing: 0.8, rollRatio: 1.0 },
      blinde: { bobAmp: 0.08, swayAmp: 0.06, stepSquash: 0.05, leanFwd: 0.06, legSwing: 0.45, hz: 1.0 },
      reparateur: { bobAmp: 0.1, swayAmp: 0.09, stepSquash: 0.06, leanFwd: 0.1, legSwing: 0.7, armSwing: 0.4 },
    },
  },
  // ----- Caméra (P5) et secousse : intégrées à camera.js (fondation) — les valeurs vivent dans CAMERA.lead et SHAKE
  // (frequency, kick, attaque, relance) ; ce bloc les désigne pour les modules qui lisent ANIM.camera.
  camera: { lead: CAMERA.lead, shakeFrequency: SHAKE.frequency, kick: SHAKE.kick, attaque: SHAKE.attaque, relance: SHAKE.relance },
};

// Profils peints propres aux animations (avant : ajoutés à l'exécution par heros-anim.profilHeros et cape.creerMateriau ;
// config.js est en lecture seule pour les modules) :
// - herosAnime : celui du héros, liseré cyan ramené à ANIM.heros.lisere (sur les membres qui se balancent, le liseré à
//   pleine force rendait le héros cyan de la tête aux pieds — mesuré le 13/11, page tests/jouable validée par Femz) ;
// - cape : tissu (pas de métal, liseré violet très discret), copie du profil « objet ».
PEINT.profils.herosAnime = { ...PEINT.profils.heros, liseré: { ...PEINT.profils.heros.liseré, force: ANIM.heros.lisere } };
PEINT.profils.cape = { ...PEINT.profils.objet, saturation: 1.0, soleil: 1.0, metal: 0.04, liseré: { couleur: 0x7c6cff, force: 0.05, puissance: 2.5 } };
// § E5.T (Femz, 21/11 : « plus lisible ») — tourelles POSÉES (Sentinelle, canon lourd), pas les armes portées : acier
// plus clair et plus froid que le sol (texProfil : l'image des armes suit ce gain et cette saturation au lieu du gain
// moyen sans dominante), liseré à la couleur de l'œil (0x5ac8ff) en bord dur du look cel (liseré.cel : sans lui le
// liseré du profil est éteint sous le cel), sous le seuil du bloom ; variante A = acier seul. Le canon a une texture plus
// sombre que la Sentinelle : son gain est plus fort (mesuré : tests/tourelle-T-captures.mjs, tourelle-T-contraste.json).
PEINT.profils.tourelleA = { ...PEINT.profils.heros, base: [3.0, 3.2, 3.6], saturation: 0.3, metal: 0.5, texProfil: true, liseré: { ...PEINT.profils.herosAnime.liseré } };
PEINT.profils.tourelle = { ...PEINT.profils.tourelleA, liseré: { couleur: 0x5ac8ff, force: 0.85, puissance: 1.5, cel: 1 } };
PEINT.profils.tourelleCanonA = { ...PEINT.profils.tourelleA, base: [4.0, 4.25, 4.8] };
PEINT.profils.tourelleCanon = { ...PEINT.profils.tourelleCanonA, liseré: PEINT.profils.tourelle.liseré };
//#endregion anim:reglages

//#region vfx:reglages
// ----- VFX des projectiles « toon » (prototype validé par Femz le 13/11/2026, référence « Toon Projectiles 2 », style
// seul ; intégration du 14/11/2026, ARCHITECTURE.md § Z septies). Mêmes noms, même structure qu'au prototype :
// src/vfx/reglages.js ne fait que les réexporter (VFX_STYLE → STYLE, VFX_VIE → VIE, VFX_COULEURS → COULEURS, VFX).
// Toutes les formes sont dessinées par le shader (aucune texture) ; ici, que des nombres. Couleurs en LINÉAIRE (déjà
// converties), gains > 1 : au-dessus du seuil du bloom (PEINT.bloom.seuil 1,7, plafond 2,2 par pixel : un cœur à 5 ne
// fait pas un halo plus large qu'un cœur à 2,2, il reste blanc chauffé). Les rayons de COLLISION du jeu ne changent pas
// (WEAPONS, ENEMIES) : seul le dessin est plus généreux.

/** Styles d'instance (iC.x). < 20 : ruban face à la caméra ; ≥ 20 : couché au sol. 10-19 et ≥ 30 : événements datés. */
export const VFX_STYLE = Object.freeze({
  COMETE: 0, // blaster : orbe + longue traînée effilée + étincelles semées
  PLOMB: 1, // pompe : boule de feu + courte traînée de braises
  ROQUETTE: 2, // roquette : tête lumineuse + flamme courte (la traînée longue est TRAINE)
  ENNEMI: 3, // tir ennemi : orbe rouge cerné de sombre + traînée
  TRAINE: 4, // segment de traînée de roquette : flamme → fumée + étincelles
  ORBE_EMP: 5, // orbe électrique autour du plastron du héros
  RICOCHET: 6, // étape 2 (§ E2.A) : trait en losange à la couleur de l'arme (partie entière de la graine) — ricochet, tirs des sentinelles
  BOOMERANG: 7, // étape 2 (§ E2.B) : boomerang — croix à deux pales qui tourne (couleur = partie entière de la graine)
  FLACON: 8, // étape 2 (§ E2.B) : flacon lobé de la nappe corrosive
  ECLAT: 9, // § E5.Y : fragment métallique des Éclats en vol (ruban continu, couleurs dans ECLATS)
  RAIL: 10, // rayon du fusil à rail : cœur, ruban en spirale, étincelles qui s'en détachent, rétraction
  ARC: 11, // arc de l'EMP : lignes brisées qui scintillent
  ETOILE: 12, // impact en éclat d'étoile (couleur de l'arme = partie entière de la graine)
  EXPLOSION: 13, // explosion de roquette en éclat d'étoile
  FLASH: 14, // éclair de bouche (rail)
  DISQUE: 20, // disque orbital lumineux à dents de scie
  TRAINE_DISQUES: 21, // traînées circulaires de tous les disques (une instance)
  AURA_EMP: 22, // bord électrique de l'aura + onde de chaque impulsion
  NAPPE: 23, // étape 2 (§ E2.B) : nappe corrosive au sol (continu, couché)
  MINE: 24, // étape 2 (§ E2.B) : mine logique posée au sol (continu, couché)
  CHAMP: 25, // correctif de l'étape 3 (§ E3.Z.12) : champ de force d'une tourelle (continu, couché)
  ONDE: 30, // onde de choc au sol (explosion)
  CROISSANT: 31, // étape 2 (§ E2.A) : balayage de la lame de phase — croissant couché, daté
  TRAINEE_LAME: 33, // étape 3 (§ E3.M) : traînée orange d'un coup de lame (arc ou trait du dégainé), couchée, datée
  VRILLE: 34, // étape 3 (§ E3.M) : traînée circulaire de la vrille, couchée, datée
});

/** Durée de vie (s, temps simulé) des styles datés. */
export const VFX_VIE = { 10: 0.42, 11: 0.26, 12: 0.24, 13: 0.5, 14: 0.12, 30: 0.45, 31: 0.22 };

// Couleurs linéaires par indice d'arme (WEAPON.*, 12 lignes) + VFX_ROBOTS (12, § E2.A) = robots. « bord » : la teinte saturée ; « chaud » : le cœur.
// La teinte saturée doit l'être APRÈS la courbe de tons de la passe finale — un orange linéaire (1, 0,36, 0,04) sort
// crème sur le sable ; (1, 0,2, 0,01) sort orange feu (sRGB ≈ 255, 124, 26). Les taches de lumière au sol prennent la
// couleur « bord » de la source (src/rendu/lumieres.js).
export const VFX_COULEURS = {
  bord: [
    [0.04, 0.55, 1.0], // blaster : cyan franc (le cœur est blanc)
    [1.0, 0.62, 0.02], // disques : jaune d'or
    [1.0, 0.2, 0.01], // pompe : orange feu
    [0.06, 0.28, 1.0], // EMP : bleu électrique
    [0.42, 0.06, 1.0], // rail : violet
    [0.45, 1.0, 0.04], // roquettes : vert-jaune
    [1.0, 0.05, 0.3], // ricochet : rose vif (étape 2, § E2.A)
    [1.0, 0.8, 0.42], // lame de phase : or pâle
    [0.07, 0.6, 1.0], // sentinelle : bleu ciel
    [0.28, 0.2, 1.0], // nappe corrosive : indigo (chantier B)
    [0.9, 0.1, 1.0], // boomerang : magenta (chantier B)
    [0.1, 1.0, 0.42], // mines logiques : vert menthe (chantier B)
    [1.0, 0.03, 0.02], // robots : rouge
  ],
  chaud: [
    [0.85, 0.97, 1.0],
    [1.0, 0.92, 0.55],
    [1.0, 0.6, 0.18],
    [0.7, 0.85, 1.0],
    [0.95, 0.75, 1.0],
    [0.9, 1.0, 0.6],
    [1.0, 0.78, 0.9],
    [1.0, 0.98, 0.9],
    [0.8, 0.95, 1.0],
    [0.8, 0.78, 1.0],
    [1.0, 0.75, 1.0],
    [0.75, 1.0, 0.88],
    [1.0, 0.62, 0.55],
  ],
  fin: [
    [0.03, 0.18, 1.0], // bout de la comète : bleu
    [1.0, 0.25, 0.01], // bout des traînées de disque : orange
    [0.6, 0.03, 0.01], // braises : rouge
    [0.04, 0.12, 0.9],
    [0.22, 0.02, 0.85],
    [0.25, 0.55, 0.02],
    [0.5, 0.02, 0.45],
    [1.0, 0.4, 0.08],
    [0.02, 0.2, 0.9],
    [0.1, 0.05, 0.7],
    [0.45, 0.02, 0.8],
    [0.02, 0.5, 0.3],
    [0.45, 0.0, 0.01],
  ],
};

// Dimensions affichées (m).
export const VFX = {
  capacite: { tirs: 384, ennemis: 256, segments: 1536, continus: 16, evenements: 512 },
  ordre: { traines: 2.55, continus: 2.6, tirs: 2.7, evenements: 2.8, ennemis: 2.95 }, // renderOrder (ennemis au-dessus de tout)
  comete: { tete: 0.26, traine: 2.8, quad: 1.35, marge: 0.75 }, // tête (m), traînée max (m), quad = traînée × 1,35 (les étincelles dépassent), demi-largeur du quad (m)
  plomb: { tete: 0.3, traine: 1.2, marge: 0.5 },
  roquette: { tete: 0.34, flamme: 1.1, marge: 0.85 },
  ennemi: { echelle: 1.2, traine: 1.25, marge: 2.3 }, // tête = rayon de collision × échelle (palpitation du jeu comprise) ; marge en têtes
  traine: { points: 48, pas: 1 / 60, fumee: 0.75, largeur: 1.6 }, // points d'historique par roquette, s entre deux, vie de la fumée, demi-largeur du quad
  disque: { quad: 1.5, traine: 1.8 }, // demi-côté du quad d'un disque, en rayons de disque ; débord de la traînée circulaire, en rayons
  orbe: { rayon: 0.72, hauteur: 1.05, avance: 1.6 }, // orbe EMP : rayon, hauteur du plastron, décalage vers la caméra (dessiné devant le héros)
  aura: { hauteur: 0.07, marge: 0.8 }, // bord de l'aura EMP : hauteur au sol (m), débord du quad au-delà du rayon (m)
  etoile: { blaster: 0.42, pompe: 0.34, arc: 0.36, flash: 0.32 },
  explosion: { etoile: 0.55, hauteur: 1.0, onde: 0.08, quadEtoile: 2.4, quadOnde: 1.35 }, // éclat = souffle × 0,55 à 1 m du sol ; onde au rayon du souffle
  rail: { vitesseEtincelles: 3.0 },
};

// Champ EMP : variantes visuelles (Femz, 22/11 : « revoir visu du champ emp j'aime pas trop et la boule au centre
// obstrue le perso » ; ARCHITECTURE.md § E5.EMP). Planche : tests/emp-variantes-anim.mjs ; Femz choisit, la valeur
// retenue remplace 'actuel'. Le numéro du style passe dans la graine de l'instance d'aura (aucun uniforme de plus).
//   'actuel' : aura (bord tremblé, halo, lobes, onde partie du centre) + orbe sur le plastron + éclair 3D au plastron ;
//   'a'      : clôture — tirets nets au rayon, liseré sombre, étincelles dans les trous à l'impulsion ;
//   'b'      : sol électrisé — bord fin, éclairs brisés qui rampent dans la couronne extérieure ;
//   'c'      : bobines — nœuds en losange sur le cercle, reliés par un arc qui court le long du bord ;
//   'd'      : pointillé + onde — cercle en pointillés sourds, onde fine partie de `vide` m à chaque impulsion.
// Les variantes : ni orbe, ni éclair au plastron, rien à moins de `vide` m du centre du héros.
export const EMP_VISU = {
  style: 'b', // choix de Femz (22/11, planche tests/emp-variantes-anim.mjs) : « B » — sol électrisé
  styles: ['actuel', 'a', 'b', 'c', 'd'],
  vide: 1.8, // m — rayon autour du héros où les variantes ne dessinent rien (au-delà du disque d'atténuation 1,4 → 2,2)
};
//#endregion vfx:reglages

//#region menu:reglages
// ----- Écran titre 3D (« hero shot », prototype validé par Femz le 13/11/2026 ; intégration du 14/11/2026,
// ARCHITECTURE.md § Z octies). Mêmes noms, même structure qu'au prototype : src/menu/reglages-menu.js ne fait que les
// réexporter (avec ORIENTATION et versMonde, calculés). Unités : mètres, secondes, radians sauf mention « Deg ». Repère
// du monde du MENU (scène à part, sans lien avec l'arène) : le héros est debout sur le promontoire à l'origine (x, z),
// les boss sont derrière lui vers −Z, la caméra est du côté +Z et regarde vers −Z, le soleil couchant est derrière les
// boss (contre-jour). Le vent souffle vers −X (vers le panneau de gauche à l'écran).
// Son (intégration) : les gains « son » sont relatifs au gain du fichier dans le manifeste, joués par audio.js
// (audio.playGain) sous le volume général ; volumeDefaut, bus et appoint ne servent qu'à la page de prototype
// (tests/menu/, son-menu.js) : dans le jeu, la chaîne est celle d'audio.js (AUDIO.busGain, compresseur).
export const MENU = {
  // Orientation du plan dans le monde : tout le « repère du plan » (caméra, boss, soleil, cap du héros) est tourné de cet
  // angle autour de Y. Le vent de la cape (src/anim/cape.js) souffle le long de −X du MONDE : tourné de 35°, il pousse
  // la cape vers la gauche de l'écran ET vers l'arrière du héros (vue de dos, elle couvre son dos).
  orientationDeg: 35,
  // ----- Boucle de poses : transition (anticipation + ease) puis maintien. Durée d'un tour = Σ (transition + maintien).
  transition: 1.05,
  maintien: 2.65,
  // part de la transition passée à « charger » le mouvement (le bassin descend, les bras reculent un peu)
  anticipation: 0.22,
  // ----- Rendu
  fpsMax: 60, // plafond : un écran à 120 Hz ne fait pas tourner le menu deux fois plus (chaleur)
  pixelRatioMax: 2,
  exposition: 1.0,
  bloomForce: 0.42,
  vignette: 0.34,
  vignetteDebut: 0.42,
  dof: { mise: 7.5, debutLoin: 16, finLoin: 75, debutPres: 3.2, finPres: 1.6, maxLoin: 0.6 },
  // Branche look-cel (15/11) : brume de profondeur (« z depth ») qui détache le héros des boss. Lue dans la profondeur
  // de la scène, composée après le flou de profondeur, avant l'exposition. actif = numéro de variante ; ?brume=N l'emporte.
  //   debut / fin : distance à la caméra (m) où la brume commence / atteint sa force · force : 0..1 · couleur (sRGB)
  //   gain : multiplie la couleur (HDR : la brume s'éclaire dans le contre-jour) · ciel : au-delà (m), rien (le ciel garde sa couleur)
  brume: {
    actif: 3, // 15/11 : « brume forte » retenue par Femz
    //   horizon : bande du ciel brumée au-dessus de l'horizon (sinus de l'angle) : raccord sans ligne avec le sol lointain
    variantes: [
      null,
      { nom: 'Brume légère', debut: 12, fin: 90, force: 0.35, couleur: 0x2f8a5a, gain: 1, ciel: 400 },
      { nom: 'Brume moyenne', debut: 12, fin: 80, force: 0.55, couleur: 0x2f8a5a, gain: 1, ciel: 400 },
      { nom: 'Brume forte', debut: 10, fin: 70, force: 0.72, couleur: 0x2f8a5a, gain: 1.1, ciel: 400, horizon: 0.2 },
      { nom: 'Brume violette', debut: 12, fin: 80, force: 0.55, couleur: 0x6a3a9a, gain: 1, ciel: 400 },
    ],
  },
  // ----- Caméra : focale « courte-moyenne » (≈ 30 mm), héros au centre (logo en haut, « Jouer » en bas, 14/11)
  camera: {
    near: 0.15,
    far: 2400,
    // décalage horizontal du film (mm, gabarit 35 mm) : 0 = axe de visée au centre ; −8,75 le mettait à 75 % de la
    // largeur, quand le panneau du titre occupait la gauche
    // menus « Pile » (19/11, Femz) : −8,75 → l'agent à ~69 % de la largeur, place libre à gauche pour la liste et sur
    // la plateforme pour les 2 autres joueurs du multi (sans zoom : c'est le film qui se décale)
    decalage: -8.75,
    derive: { orbiteDeg: 2.4, orbiteHz: 0.045, dolly: 0.035, dollyHz: 0.07, hauteur: 0.06, hauteurHz: 0.09 },
    secousse: { decroissance: 1.6, amplitude: 0.05, roulis: 0.006, frequence: 9 },
  },
  // ----- Héros
  heros: {
    position: [0, 0, 0], // x, z du centre des pieds (y = dessus du promontoire)
    // m — demi-côté du carré autour du héros où la hauteur de la roche est celle de ses vrais triangles (ailleurs : grille
    // de 22 cm interpolée, qui lisse les bosses de près d'1 cm)
    solExact: 1.6,
    genouPose: 0.002, // m — atterrissage : rotule à 2 mm de la roche (posée, pas enfoncée), étalonnée à l'init
    orteilsPose: 0.001, // m — atterrissage : sommet le plus bas des orteils du pied arrière dressé
    liseré: 0.42, // force du liseré cyan (profil herosMenu)
    emissif: 2.6,
    respiration: { hz: 0.32, buste: 0.035, epaules: 0.02 },
    tourelles: { vitesse: 1.6, lissage: 0.35, tirMin: 1.1, tirMax: 2.6, eclair: 0.09, recul: 0.04, trace: 0.16 },
    eclairBras: 0.08,
  },
  // ----- Capture de mouvement (15/11, Femz : « branche le héros de base à l'accueil ») : ses gestes filmés
  // (outils/mocap/ → assets/anims/), joués en boucle à la place des POSES ; « ?clip=0 » rend la boucle de poses.
  // cap : orientation du héros (rad, comme POSES[].cap) quand Femz faisait face à la caméra. plan : cadrage fixe du clip
  // (mêmes champs que POSES[].plan ; la dérive MENU.camera.derive s'y ajoute). torsion : avant-bras [droit, gauche]
  // (rad ; la capture ne la mesure pas de façon fiable).
  clip: {
    actif: false, // 15/11 : Femz trouve la capture MediaPipe « rien à voir avec ma perf » → poses ; GVHMR en essai (?clip=1)
    fichier: 'assets/anims/menu-heros.json',
    cap: 0.12,
    plan: { azimutDeg: 12, elevationDeg: -12, distance: 6.2, fov: 40, visee: 1.3, roulisDeg: -1.5 },
    torsion: [0.1, -0.1],
  },
  // ----- Attente de l'écran titre (15/11, Femz : « garde que le idle avec les bras reposés ») : « Unarmed Idle »
  // (Mixamo) transférée sur le robot et CUITE (src/menu/cuit-menu.js ; le fichier Mixamo n'est pas embarqué), jouée en
  // boucle à la place des POSES ; cap et cadrage : ceux de MENU.clip. « ?clip=0 » : la boucle de poses.
  attente: {
    actif: true,
    fichier: 'assets/anims/menu-attente.json',
  },
  // ----- Vent de la cape : vent constant + rafales (m/s, signe = sens sur X : négatif = vers −X)
  vent: { base: -5.2, rafale: -4.2, rafaleHz: 0.17, rafaleHz2: 0.41 },
  // ----- Boss (géants derrière le héros)
  boss: [
    // x, z, échelle, cap (rad, 0 = face à +Z), comportement
    // 15/11 (Femz : « un robot plus à gauche et l'autre plus à droite pour laisser respirer derrière le perso ») : le
    // premier part à gauche (avant : x −16), le marcheur fait sa ronde à DROITE du héros (avant : piste [−15, 3])
    { x: -24, z: -32, echelle: 3.2, cap: 0.35, mode: 'debout', phase: 0.0, piétinement: 6.4 },
    { x: 16, z: -54, echelle: 3.8, cap: -0.35, mode: 'marche', phase: 0.4, piste: [12, 24], vitesse: 1.1 },
    { x: -40, z: -84, echelle: 4.6, cap: 0.1, mode: 'debout', phase: 2.1, piétinement: 9.1 }, // avant : x −7 (derrière le héros)
  ],
  // 15/11 (Femz, variante V1 choisie sur planche) : accueil VERT comme la carte mère — ciel, grille, brume, brouillard et
  // remplissage verts ; le rouge reste au cœur de l'AGI (soleil, halo), au logo et aux braises. Puis (même soir, Femz :
  // « met le rouge en vert, la grille verte en rouge ») : cœur de l'AGI VERT, grille du ciel ROUGE.
  // ----- Lumière de « key art ». Carte mère (docs/da-carte-mere.md § 7) : le contre-jour vient du NOYAU de l'AGI (rouge),
  // plus du soleil couchant ; remplissage lavande, brume violette ; désert (« ?theme=desert ») : crépuscule chaud.
  lumiere: CM
    ? {
        soleil: { couleur: 0x5aff8a, intensite: 2.4, azimutDeg: 186, elevationDeg: 10 }, // noyau de l'AGI (vert depuis le 15/11), derrière les boss
        ciel: { couleur: 0x4ab88a, sol: 0x1c3a2a, intensite: 0.42 },
        rimCyan: { couleur: 0x3fe0d0, intensite: 9, distance: 7, position: [-1.6, 2.6, -1.3] },
        remplissage: { couleur: 0xd0ffe4, intensite: 2.4, distance: 14, position: [3.5, 3.4, 5.5] }, // face, lavande et bas
        brouillard: { couleur: 0x173a2a, densite: 0.0078 },
        // projecteur sur le héros (15/11, Femz : « un vrai spotlight » ; angle « 6 · dos-haut » choisi sur planche de 6) :
        // VRAI SpotLight (position au-dessus et DERRIÈRE le
        // héros, repère du héros, m ; visée à viseeY du sol ; intensité physique, décroissance 2), cône de lumière léger
        // (rayon, hauteur m, force) ; flaque dessinée 0 = aucune (la lumière fait la flaque) ; heros : gain du héros
        projecteur: { couleur: 0xf0fff4, intensite: 170, distance: 18, angle: 0.32, penombre: 0.5, position: [0, 8, -4], viseeY: 1.2, rayon: 2.6, hauteur: 9, flaque: 0, cone: 0.08, heros: 1 },
      }
    : {
        soleil: { couleur: 0xffa060, intensite: 2.4, azimutDeg: 186, elevationDeg: 10 }, // azimut : 180 = droit derrière les boss
        ciel: { couleur: 0x7068c8, sol: 0x5a3020, intensite: 0.38 },
        rimCyan: { couleur: 0x3fe0d0, intensite: 9, distance: 7, position: [-1.6, 2.6, -1.3] }, // derrière le héros, à gauche
        remplissage: { couleur: 0xffb48a, intensite: 2.4, distance: 14, position: [3.5, 3.4, 5.5] }, // face, chaud et bas
        brouillard: { couleur: 0xb2603f, densite: 0.0078 },
      },
  // ----- Ciel (couleurs linéaires calculées depuis ces hex sRGB). Carte mère : ciel NUMÉRIQUE — fond indigo, lueur
  // magenta à l'horizon, noyau de l'AGI (soleil = cœur, halo = rouge), nuages = grille et pluie de données ; désert :
  // crépuscule.
  ciel: CM
    ? { horizon: 0x1f6a4a, bas: 0x12402e, milieu: 0x0a2219, zenith: 0x030a07, soleil: 0xf0fff0, halo: 0x3aff7a, nuages: 0xff3a58 }
    : { horizon: 0xffb066, bas: 0xf07a58, milieu: 0x9a4f86, zenith: 0x2a2858, soleil: 0xfff0c8, halo: 0xffa050, nuages: 0xd8728a },
  // Branche look-cel (15/11) : ciel carte mère pixelisé, « grille cybernétique » (decor-menu.js, CIEL_FRAG_PIXEL).
  // actif = variante (0 = ciel d'origine) ; ?cielpix=N l'emporte. taille : côté d'une cellule (rad ; ≈ 0,0005 rad par
  // pixel à 2560 × 1440) · joint : part de la cellule en joint sombre · jointNoir : luminosité du joint · grille : une
  // ligne toutes les N cellules · grilleForce, pluie, clignote : forces
  cielPixel: {
    actif: 2, // 15/11 : « cellules moyennes » validées par Femz
    variantes: [
      null,
      { nom: 'Cellules fines', taille: 0.005, joint: 0.12, jointNoir: 0.55, grille: 10, grilleForce: 0.3, pluie: 0.9, clignote: 0.5 },
      { nom: 'Cellules moyennes', taille: 0.008, joint: 0.1, jointNoir: 0.5, grille: 8, grilleForce: 0.32, pluie: 0.9, clignote: 0.5 },
      { nom: 'Gros pixels', taille: 0.013, joint: 0.08, jointNoir: 0.45, grille: 6, grilleForce: 0.34, pluie: 0.9, clignote: 0.5 },
    ],
  },
  // ----- Particules
  poussiere: { nombre: 1400, boite: [46, 16, 44], taille: 0.06, couleur: CM ? 0xa8ffcc : 0xffc89a, gain: 0.55 }, // carte mère : grains de données
  braises: { nombre: 220, taille: 0.05, couleur: 0xff7a2a, gain: 4.0, vie: [2.2, 4.5] },
  // ----- Sons (identifiants du manifeste assets/sfx/manifeste.json) : gains relatifs (× gain du son du manifeste)
  son: {
    volumeDefaut: 0.6,
    bus: 0.45,
    appoint: 2.03,
    ambiance: 0.45, // la musique porte le menu : ≈ +5 dB au-dessus du niveau en partie (AUDIO.ambiance.gain 0,25)
    fonduAmbiance: 1.6, // s — montée de la nappe au niveau du titre (enterTitle)
    fonduLancement: 1.2, // s — retour de la nappe au niveau du jeu (AUDIO.ambiance.gain) au lancement de la partie
    pasProche: 0.75,
    pasLoin: 0.35,
    tourelle: 0.45,
    rail: 0.6,
    impact: 0.55,
    alarme: 0.32,
    alarmePeriode: 18.5,
  },
};

// ----- Les poses. Repères :
//   cap : lacet du bassin (0 = face à la caméra, +Z) ; buste : [lacet, tangage (+ = penché en avant), roulis] ;
//   tete : [lacet, tangage (+ = baisse la tête), roulis] ; bassin : descente (m) sous la hauteur de hanche ;
//   pieds : [x, z] dans le repère du héros (+X = sa gauche, +Z = devant lui), sur le promontoire ; genou : dir. du genou ;
//   bras (d = droit, g = gauche) : main visée dans le repère du BUSTE ([x, y, z] depuis l'épaule, m), coude : direction
//   vers laquelle le coude ressort, torsion de l'avant-bras ; « sol » = main posée au sol (repère du héros) ;
//   « camera » = le bras pointe vers l'objectif ;
//   tourelles : 'suivre' (cibles imaginaires) ou 'camera' (pivotent vers l'objectif) ;
//   plan : caméra autour du héros (azimut, élévation du regard, distance, fov, hauteur de visée, roulis).
export const POSES = [
  {
    nom: 'croix',
    titre: 'Bras armés en croix',
    cap: 0.12,
    bassin: 0.05,
    buste: [0.0, -0.06, 0],
    tete: [0.05, -0.12, 0],
    pieds: { g: [0.28, 0.06], d: [-0.3, -0.04] },
    genou: [0, 0.2, 1],
    bras: {
      d: { main: [-0.74, 0.26, 0.16], coude: [0, -0.4, -1], torsion: 0.2 },
      g: { main: [0.72, 0.3, 0.2], coude: [0, -0.4, -1], torsion: -0.2 },
    },
    tourelles: 'suivre',
    tirs: [0.9, 1.6],
    plan: { azimutDeg: 12, elevationDeg: -12, distance: 6.2, fov: 40, visee: 1.3, roulisDeg: -1.5 },
  },
  {
    nom: 'rail',
    titre: 'Rail pointé vers la caméra',
    cap: 0.55,
    bassin: 0.1,
    buste: [-0.35, 0.02, 0.04],
    tete: [-0.15, 0.0, 0.05],
    pieds: { g: [0.34, 0.24], d: [-0.24, -0.26] },
    genou: [0, 0.1, 1],
    bras: {
      d: { camera: true, coude: [0, -0.3, -1], torsion: 0.0 },
      g: { main: [0.2, -0.32, -0.32], coude: [1, -0.2, -0.6], torsion: 0.3 },
    },
    tourelles: 'suivre',
    tirs: [1.4],
    rail: 1.95,
    plan: { azimutDeg: 7, elevationDeg: -11, distance: 4.6, fov: 46, visee: 1.45, roulisDeg: 2.5 },
  },
  {
    nom: 'atterrissage',
    titre: 'Atterrissage, genou et poing au sol',
    cap: -0.15,
    // pas de « bassin » : sa descente découle du genou posé (la cuisse garde sa longueur)
    buste: [0.08, 0.64, 0.06],
    tete: [0.0, -0.68, 0],
    pieds: { g: [0.3, 0.38] }, // pied avant, à plat ; le droit est derrière le genou, dressé sur ses orteils (genouSol)
    // UN genou au sol (14/11, os de pied) : côté, point de contact de la rotule [x, z] (repère du héros) ; pied arrière
    // dressé (rad, + = pointe vers le bas) sur ses orteils fléchis à plat au sol ; ouverture du pied vers l'extérieur (rad).
    // La hauteur du genou est étalonnée à l'init sur la géométrie (heros-menu.js : rotule à 2 mm de la roche).
    genouSol: { cote: 'd', genou: [-0.3, -0.16], pied: 1.25, lacet: 0.25 },
    genou: [0, -0.4, 1],
    bras: {
      d: { sol: [-0.28, 0.46], coude: [-1, 0, 0.2], torsion: 0.0 },
      g: { main: [0.46, 0.18, -0.36], coude: [0.3, -0.6, -0.6], torsion: -0.4 },
    },
    tourelles: 'suivre',
    tirs: [1.2, 2.0],
    impact: 0.5,
    plan: { azimutDeg: 4, elevationDeg: -5, distance: 5.4, fov: 42, visee: 0.85, roulisDeg: 0 },
  },
  {
    nom: 'epaule',
    titre: 'Regard par-dessus l’épaule',
    cap: Math.PI - 0.35,
    bassin: 0.04,
    buste: [0.55, -0.02, 0],
    tete: [0.95, -0.05, -0.08],
    pieds: { g: [0.24, 0.02], d: [-0.24, 0.04] },
    genou: [0, 0.1, 1],
    bras: {
      d: { main: [-0.2, -0.62, 0.14], coude: [-1, 0, -0.3], torsion: 0.1 },
      g: { main: [0.24, -0.6, 0.12], coude: [1, 0, -0.3], torsion: -0.1 },
    },
    tourelles: 'camera',
    tirs: [],
    plan: { azimutDeg: 16, elevationDeg: -10, distance: 6.0, fov: 40, visee: 1.45, roulisDeg: 0 },
  },
  {
    nom: 'garde',
    titre: 'Posture de garde',
    cap: 0.62,
    bassin: 0.22,
    buste: [-0.12, 0.12, 0],
    tete: [-0.3, -0.06, 0],
    pieds: { g: [0.48, 0.22], d: [-0.4, -0.12] }, // d rentré de 6 et 10 cm (14/11) : le pied passait au bord de la roche
    genou: [0.3, 0, 1],
    bras: {
      d: { main: [-0.12, 0.08, 0.6], coude: [-1, -0.6, 0], torsion: 0.4 },
      g: { main: [0.16, 0.16, 0.5], coude: [1, -0.6, 0], torsion: -0.4 },
    },
    tourelles: 'suivre',
    tirs: [0.7, 1.5, 2.2],
    plan: { azimutDeg: 10, elevationDeg: -11, distance: 5.6, fov: 40, visee: 1.2, roulisDeg: -3 },
  },
];

// Profils peints du menu (avant : ajoutés à l'exécution par heros-menu.js et boss-menu.js ; config.js est en lecture
// seule pour les modules) :
// - herosMenu : celui du héros, liseré cyan plus franc (contre-jour), émissifs plus forts ;
// - bossMenu : celui du boss, liseré orangé du soleil couchant.
PEINT.profils.herosMenu = { ...PEINT.profils.heros, base: PEINT.profils.heros.base.map((v) => v * ((MENU.lumiere.projecteur && MENU.lumiere.projecteur.heros) || 1)), emissif: MENU.heros.emissif, liseré: { ...PEINT.profils.heros.liseré, force: MENU.heros.liseré, puissance: 2.2 } };
PEINT.profils.bossMenu = { ...PEINT.profils.boss, soleil: SOLEIL_BOSS_AVANT_RETOUCHE, liseré: { couleur: 0xff8a48, force: 0.55, puissance: 3.2 } };
//#endregion menu:reglages

// =====================================================================================================
// PLAN ADDICTIF, ÉTAPE 2 (« un build différent à chaque partie ») — une région par chantier, créées VIDES le
// 15/11/2026 par le contrat (ARCHITECTURE.md, section « Plan addictif, étape 2 », § E2.0). Chaque chantier n'écrit
// que dans SA région : ses tables neuves (export const …) et les lignes qu'il AJOUTE aux tables communes, à
// l'évaluation du module seulement (WEAPONS.push(…), PALETTE.weapon.push(…), AUDIO.sounds[SFX.X] = …). Les
// identifiants (armes, sons, états, écrans, objets, agents, raretés) sont attribués au § E2.0 : aucun ne se répète.
// Les énumérations gelées (fondation:enumerations) ne reçoivent que les lignes du « socle » du § E2.0.
// =====================================================================================================
//#region e2:A-armes-1
// =====================================================================================================
// ÉTAPE 2, CHANTIER A — Ricochet, Lame de phase, Sentinelle (ARCHITECTURE.md § E2.A ; docs/contenu-objets-fusions.md).
// =====================================================================================================
// Trois armes de coffre (lootable). Même forme que les six premières : 5 stats × 5 niveaux strictement croissants
// (node tests/equilibrage.mjs), soit les niveaux d'arme 1 à 21. unlockWave / unlockCost ne sont plus lus (§ E2.C).
// Chiffres : premier équilibrage du contrat, SUPPOSÉ (calculé, pas joué) — à régler par le chantier G.

/** Indice de couleur des tirs des robots dans VFX_COULEURS (12 lignes d'armes avant lui). */
export const VFX_ROBOTS = 12;

/** Une source de dégâts est du côté du joueur : une arme (0 à 11) ou un objet passif. */
export function isPlayerSource(s) {
  return s < DMG_SRC.KAMIKAZE || s === DMG_SRC.ITEM || s === DMG_SRC.UTIL; // UTIL : § E3.0.2 (chantier N)
}

// Monture de chaque arme sur le héros : node = suffixe des nœuds arme_<node> / bouche_<node> de heros.glb ;
// arm = bras porteur (0 droit, 1 gauche, −1 corps). Lue par src/anim/armes-heros.js.
WEAPONS[WEAPON.BLASTER].mount = { node: 'blaster', arm: 0 };
WEAPONS[WEAPON.ORBITALS].mount = { node: 'orbitaux', arm: -1 };
WEAPONS[WEAPON.SHOTGUN].mount = { node: 'pompe', arm: 1 };
WEAPONS[WEAPON.EMP].mount = { node: 'emp', arm: -1 };
WEAPONS[WEAPON.RAIL].mount = { node: 'rail', arm: 0 };
WEAPONS[WEAPON.ROCKETS].mount = { node: 'roquettes', arm: 1 };

WEAPONS.push(
  {
    id: WEAPON.RICOCHET,
    key: 'ricochet',
    name: 'Ricochet',
    desc: "Un tir qui rebondit d'un robot à l'autre.",
    unlockWave: 1,
    unlockCost: 0,
    lootable: true,
    mount: { node: 'ricochet', arm: 0 }, // dessous de l'avant-bras droit
    upgradeBase: 18,
    bypassShield: false,
    hitstopOnKill: false,
    fireTrauma: SHAKE.amounts.fireLight,
    sfx: SFX.RICOCHET,
    statLabels: ['Dégâts', 'Cadence', 'Projectiles', 'Saut', 'Rebonds'],
    statUnits: ['', '/s', '', 'm', ''],
    specialScalesWithArea: false,
    stats: [
      [9, 11, 14, 17, 21], // dégâts par robot touché
      [0.9, 1.05, 1.2, 1.4, 1.6], // tirs par seconde
      [1, 2, 3, 4, 5], // projectiles par salve : un par cible, les plus proches d'abord
      [5, 5.6, 6.2, 6.8, 7.5], // saut (m) : distance au plus entre le robot touché et le suivant
      [2, 3, 4, 5, 6], // rebonds après le premier robot
    ],
    range: 14, // m — portée du premier tir (constante : la stat « zone » est le saut)
    projectileSpeed: 30, // m/s
    projectileRadius: 0.2,
    knockback: 0.8, // m/s
    fanDeg: 9, // écart entre projectiles quand il y a moins de cibles que de projectiles
    muzzle: 0.45, // m — départ de repli (sans le héros animé)
    shotHeight: 1.0, // m au-dessus du sol
    impactLinger: 0.06, // s — le dernier impact reste affiché
    bounceSlack: 1.25, // le vol d'un rebond dure (distance à la cible ÷ vitesse) × ce facteur : la cible peut reculer un peu
  },
  {
    id: WEAPON.BLADE,
    key: 'blade',
    name: 'Lame de phase',
    desc: "Balaie un arc devant vous et touche tous les robots proches.",
    unlockWave: 1,
    unlockCost: 0,
    lootable: true,
    mount: { node: 'lame', arm: 1 }, // tranche de l'avant-bras gauche
    upgradeBase: 20,
    bypassShield: false, // le bouclier d'un blindé de face l'arrête
    hitstopOnKill: false,
    fireTrauma: SHAKE.amounts.fireLight,
    sfx: SFX.BLADE,
    statLabels: ['Dégâts', 'Cadence', 'Tranchants', 'Portée', 'Arc'],
    statUnits: ['', '/s', '', 'm', '°'],
    specialScalesWithArea: false,
    stats: [
      [18, 22, 27, 33, 40], // dégâts par robot et par balayage
      [1.0, 1.1, 1.25, 1.4, 1.6], // salves par seconde
      [1, 2, 3, 4, 5], // balayages par salve, sens alterné
      [2.6, 2.9, 3.2, 3.6, 4.0], // portée (m), du centre du héros au bord du robot
      [110, 130, 150, 175, 200], // arc (°), centré sur la direction de visée
    ],
    sweepGap: 0.12, // s entre deux balayages d'une salve
    sweepSeconds: 0.18, // s — durée du geste (le croissant dessiné vit VFX_VIE[31])
    maxHits: 24, // robots touchés au plus par balayage (les plus proches d'abord)
    knockback: 2, // m/s
    arcHeight: 0.95, // m — hauteur du croissant dessiné, sans le héros animé
  },
  {
    id: WEAPON.TURRET,
    key: 'turret',
    name: 'Sentinelle',
    desc: "Pose derrière vous des tourelles qui tirent seules et repoussent les robots autour d'elles.",
    unlockWave: 1,
    unlockCost: 0,
    lootable: true,
    mount: { node: 'sentinelle', arm: -1 }, // ceinture arrière
    upgradeBase: 22,
    bypassShield: false,
    hitstopOnKill: false,
    fireTrauma: 0, // la tourelle tire loin du héros : pas de secousse
    sfx: SFX.TURRET_SHOT,
    statLabels: ['Dégâts', 'Cadence', 'Tourelles', 'Portée', 'Durée'],
    statUnits: ['', '/s', '', 'm', 's'],
    specialScalesWithArea: false,
    stats: [
      [8, 10, 12, 15, 18], // dégâts par tir
      [2.0, 2.3, 2.7, 3.1, 3.6], // tirs par seconde et par tourelle
      [1, 2, 3, 4, 5], // tourelles en même temps (un emplacement chacune)
      [9, 10, 11, 12, 13], // portée d'une tourelle (m)
      [8, 9.5, 11, 12.5, 14], // durée d'une tourelle (s)
    ],
    // Un EMPLACEMENT par tourelle (précision du chantier A, § E2.A « Réalisé ») : sa tourelle dure SPECIAL s, puis il se
    // recharge deployEvery s et en pose une autre. Avec une seule file de pose (une tourelle toutes les 6 s), le nombre
    // en vie plafonnait à durée ÷ 6 = 2,3 : les niveaux 4 et 5 de « Tourelles » n'auraient rien changé.
    deployEvery: 2, // s — recharge d'un emplacement après la fin de sa tourelle
    deployStagger: 0.35, // s entre les poses de deux emplacements prêts en même temps
    deployDist: 1.2, // m — posée derrière le héros
    deployFanDeg: 38, // écart d'un emplacement à l'autre, en éventail derrière le héros
    deploySeconds: 0.28, // s — la tourelle sort de la ceinture (nœud bouche_sentinelle) et se déplie
    foldSeconds: 0.22, // s — elle se replie à la fin
    projectileSpeed: 32, // m/s
    projectileRadius: 0.18,
    knockback: 0.5,
    shotHeight: 0.47, // m — hauteur de la bouche (nœud bouche_tourelle de tourelle.glb, § E5.T)
    muzzle: 0.45, // m — bouche, devant l'axe de lacet (idem)
    impactLinger: 0.05,
    turnRate: 14, // rad/s — la tête suit sa cible
    model: 'tourelle.glb', // § E5.T : la Sentinelle du modèle de l'agent (outils/tourelles_agent.mjs)
    profil: 'tourelle', // § E5.T : profil peint des tourelles posées (acier clair + liseré cyan ; 'tourelleA' : acier seul)
    contact: { rayon: 0.45, force: 0.85 }, // § E5.T : ombre de contact (m, force), plus nette que celle des robots
    height: 0.66, // m — hauteur en jeu (= hauteur déclarée du modèle) : 0,62 m de large, comme l'ancienne
    glow: 0x5ac8ff,
  },
);
PALETTE.weapon.push(0xff5fa8, 0xfff1c9, 0x5ac8ff); // ricochet, lame de phase, sentinelle
UI.weaponIcons.push('⟡', '◗', '⛭');
CAPS.turrets = 5; // tourelles posées (niveau 5 de « Tourelles »)
// Gerbe d'impact (FX.impact.radial, index = WEAPON.*) — ligne posée à la fusion de la phase 1 (§ E2.I) : la table du lot
// juice s'arrêtait à 6 armes et fx.js lisait `undefined` pour les trois nouvelles. Même comportement qu'avant, dit en
// clair : trois armes à tir direct (gerbe dans le prolongement du coup), pas des armes de zone.
FX.impact.radial.push(false, false, false); // ricochet, lame de phase, sentinelle
// Héros : recul du bras et taille de l'éclair de bouche (ANIM.armes, index = WEAPON.*)
ANIM.armes.recul.push(0.16, 0.5, 0);
ANIM.armes.taille.push(0.13, 0.16, 0.12);
// Dessin (src/vfx) : trait du ricochet et des sentinelles (style RICOCHET), croissant de la lame (style CROISSANT)
VFX.ricochet = { tete: 0.24, traine: 1.5, marge: 0.6 }; // tête (m), traînée max (m), demi-largeur du quad (m)
VFX.sentinelle = { tete: 0.17, traine: 1.1, marge: 0.45 };
VFX.croissant = { marge: 1.22, interieur: 0.42 }; // demi-côté du quad en portées ; bord intérieur du croissant, en portées
// Sons — CANDIDATS à faire valider par Femz : découpes transposées de SA banque (outils/preparer_sons.py, § E2.0.7)
AUDIO.sounds[SFX.RICOCHET] = { dur: 0.3, gain: 0.15, minInterval: 0.05, maxVoices: 3, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.BLADE] = { dur: 0.35, gain: 0.24, minInterval: 0.06, maxVoices: 3, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.TURRET_DEPLOY] = { dur: 0.45, gain: 0.26, minInterval: 0.1, maxVoices: 2, pitchVar: 0, priority: 1 };
AUDIO.sounds[SFX.TURRET_SHOT] = { dur: 0.2, gain: 0.1, minInterval: 0.07, maxVoices: 3, pitchVar: 1, priority: 0 };
//#endregion e2:A-armes-1

//#region e2:B-armes-2
// =====================================================================================================
// ÉTAPE 2, CHANTIER B — Nappe corrosive, Boomerang, Mines logiques (ARCHITECTURE.md § E2.B et § E2.B bis).
// =====================================================================================================
// Trois armes de coffre (lootable), même forme que les neuf premières : 5 stats × 5 niveaux strictement croissants
// (node tests/equilibrage.mjs). Chiffres : premier équilibrage du contrat, SUPPOSÉ (calculé, pas joué) — chantier G.
WEAPONS.push(
  {
    id: WEAPON.POOL,
    key: 'pool',
    name: 'Nappe corrosive',
    desc: "Lance des flacons : la flaque au sol ronge les robots qui la traversent.",
    unlockWave: 1,
    unlockCost: 0,
    lootable: true,
    mount: { node: 'nappe', arm: -1 }, // hanche gauche
    upgradeBase: 22,
    bypassShield: true, // la nappe ronge par le sol : le bouclier d'un blindé ne l'arrête pas
    noCrit: true, // dégâts continus : ni critique, ni son, ni étincelle par morsure (comme l'EMP)
    hitstopOnKill: false,
    fireTrauma: 0,
    sfx: SFX.POOL_THROW,
    statLabels: ['Dégâts', 'Morsures', 'Nappes', 'Rayon', 'Durée'],
    statUnits: ['', '/s', '', 'm', 's'],
    specialScalesWithArea: false,
    stats: [
      [5, 6.5, 8, 10, 12], // dégâts par morsure et par robot
      [2.0, 2.3, 2.6, 3.0, 3.4], // morsures par seconde et par nappe
      [1, 2, 3, 4, 5], // flacons par lancer (une nappe chacun)
      [2.4, 2.7, 3.0, 3.3, 3.7], // rayon d'une nappe (m), du centre au bord du robot
      [3, 3.6, 4.2, 4.8, 5.5], // durée d'une nappe (s)
    ],
    throwEvery: 4.5, // s entre deux lancers (la stat « cadence » est celle des morsures)
    range: 11, // m — portée des lancers (grid.findDensest)
    flightSeconds: 0.5, // s de vol d'un flacon, quelle que soit la distance
    arcHeight: 2.2, // m — sommet de la cloche du flacon
    ringMul: 0.9, // surplus de flacons : en couronne à rayon × ringMul du paquet visé
    maxBites: 64, // robots mordus au plus par morsure d'une nappe
    fadeIn: 0.18, // s — la nappe s'étale
    fadeOut: 0.45, // s — elle s'évapore
    biteFlash: 0.22, // s — éclair du bord à chaque morsure
    height: 0.06, // m au-dessus du sol (quad couché)
    shotHeight: 0.9, // m — départ de repli (sans le héros animé)
    muzzle: 0.3,
  },
  {
    id: WEAPON.BOOMERANG,
    key: 'boomerang',
    name: 'Boomerang',
    desc: "Traverse les robots à l'aller, puis revient vers vous en les touchant encore.",
    unlockWave: 1,
    unlockCost: 0,
    lootable: true,
    mount: { node: 'boomerang', arm: -1 }, // hanche droite
    upgradeBase: 20,
    bypassShield: false, // le bouclier d'un blindé de face le renvoie ; il le touche dans le dos au retour
    hitstopOnKill: false,
    fireTrauma: SHAKE.amounts.fireLight,
    sfx: SFX.BOOMERANG,
    statLabels: ['Dégâts', 'Cadence', 'Boomerangs', 'Portée', 'Taille'],
    statUnits: ['', '/s', '', 'm', 'm'],
    specialScalesWithArea: false,
    stats: [
      [16, 20, 25, 31, 38], // dégâts par robot et par passage (aller, puis retour)
      [0.6, 0.7, 0.8, 0.92, 1.05], // lancers par seconde
      [1, 2, 3, 4, 5], // boomerangs par lancer
      [9, 10, 11, 12, 13], // portée de l'aller (m)
      [0.5, 0.6, 0.7, 0.8, 0.9], // taille (m) : rayon de collision et rayon dessiné
    ],
    projectileSpeed: 20, // m/s à l'aller
    returnSpeed: 24, // m/s au retour (il rattrape un héros qui court)
    catchDist: 0.8, // m — rattrapé à cette distance du héros
    aimFromMuzzle: 1, // m — au-delà, la visée part de la hanche (bouche_boomerang) et non du centre du héros
    maxSeconds: 4, // s — durée de vie au plus
    fanDeg: 24, // écart entre boomerangs quand il y a moins de cibles que de boomerangs
    knockback: 0.6, // m/s, dans le sens du vol
    shotHeight: 0.95, // m au-dessus du sol
    muzzle: 0.4, // m — départ de repli (sans le héros animé)
  },
  {
    id: WEAPON.MINES,
    key: 'mines',
    name: 'Mines logiques',
    desc: "Pose des mines qui explosent quand un robot s'approche.",
    unlockWave: 1,
    unlockCost: 0,
    lootable: true,
    mount: { node: 'mines', arm: -1 }, // mollet droit
    upgradeBase: 24,
    bypassShield: true, // explosion : contourne le bouclier (comme les roquettes)
    hitstopOnKill: false,
    fireTrauma: 0,
    sfx: SFX.MINE_DROP,
    statLabels: ['Dégâts', 'Cadence', 'Mines', 'Explosion', 'Détection'],
    statUnits: ['', '/s', '', 'm', 'm'],
    specialScalesWithArea: true, // un bonus de zone agrandit aussi la détection
    stats: [
      [45, 56, 70, 86, 105], // dégâts de l'explosion
      [0.5, 0.58, 0.67, 0.77, 0.9], // poses par seconde
      [1, 2, 3, 4, 5], // mines par pose
      [2.2, 2.5, 2.8, 3.1, 3.5], // rayon de l'explosion (m)
      [1.2, 1.4, 1.6, 1.8, 2.0], // détection (m), du centre de la mine au bord du robot
    ],
    spread: 1.2, // m — couronne de pose autour du talon
    soloSpread: 0.45, // une seule mine par pose : couronne de spread × soloSpread (l'angle tourne à chaque pose)
    heelDist: 0.7, // m — derrière le héros (sens inverse de sa marche)
    armSeconds: 0.4, // s avant d'être armée
    dropSeconds: 0.22, // s — la mine tombe du mollet au sol
    lifeSeconds: 12, // s — puis elle s'éteint
    fadeOut: 0.3, // s — extinction dessinée
    scanDivisor: 6, // un sixième des emplacements interrogé par image
    size: 0.42, // m — rayon dessiné de la pastille
    height: 0.05, // m au-dessus du sol (quad couché)
    knockback: 3, // m/s — souffle
    explosionTrauma: SHAKE.amounts.explosionRocket * 0.5, // la moitié d'une roquette : jusqu'à 4 mines par seconde
    explosionPunch: 0,
  },
);
PALETTE.weapon.push(0x8f7bff, 0xf45bff, 0x5dffb0); // nappe corrosive, boomerang, mines logiques
UI.weaponIcons.push('◍', '⟲', '✺');
CAPS.pools = 12; // nappes au sol (5 flacons par lancer, 5,5 s de vie, un lancer toutes les 4,5 s : 10 au plus)
CAPS.mines = 24; // mines posées ; au-delà, la plus ancienne s'éteint
CAPS.boomerangs = 32; // boomerangs en vol (5 par lancer, ~1,3 s de vol : 7 au niveau max, marge pour les bonus de cadence)
VFX.capacite.continus = 64; // 16 avant : 7 disques + 2 EMP + 12 nappes + 24 mines = 45 au pire
DAMAGE.softFlashSources.push(WEAPON.POOL); // dégâts continus : flash adouci, comme l'EMP
FX.impact.radial.push(true, false, true); // nappe et mines : armes de zone (gerbe radiale) ; boomerang : tir direct
// Héros : recul du bras et taille de l'éclair de bouche (ANIM.armes, index = WEAPON.*) — armes de corps : pas de recul
ANIM.armes.recul.push(0, 0, 0);
ANIM.armes.taille.push(0.12, 0.14, 0.1);
// Dessin (src/vfx) : demi-côtés des quads, en mètres ou en rayons
VFX.boomerang = { marge: 1.5, spin: 16 }; // demi-côté du quad, en tailles de boomerang (halo de rotation compris) ; rotation dessinée (rad/s)
VFX.flacon = { tete: 0.2, traine: 0.9, marge: 0.5 }; // corps de la fiole (m), traînée de gouttes (m), demi-largeur du quad (m)
VFX.nappe = { marge: 0.4 }; // débord du quad au-delà du rayon de la nappe (m)
VFX.mine = { marge: 0.4 }; // débord du quad au-delà du rayon de détection (m)
// Sons — CANDIDATS à faire valider par Femz : découpes transposées de SA banque (outils/preparer_sons.py, § E2.0.7)
AUDIO.sounds[SFX.POOL_THROW] = { dur: 0.5, gain: 0.2, minInterval: 0.08, maxVoices: 2, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.BOOMERANG] = { dur: 0.35, gain: 0.16, minInterval: 0.06, maxVoices: 3, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.MINE_DROP] = { dur: 0.25, gain: 0.12, minInterval: 0.08, maxVoices: 2, pitchVar: 1, priority: 0 };
//#endregion e2:B-armes-2

//#region e2:C-coffres-marchand
// =====================================================================================================
// Plan addictif, étape 2, chantier C (ARCHITECTURE.md § E2.C) — coffres (seule source d'armes), élites porteuses,
// roulette à paliers de rareté, marchand qui n'améliore que les armes possédées. Premier équilibrage SUPPOSÉ.
// =====================================================================================================
export const RARITY = Object.freeze({ BRUT: 0, COMPILE: 1, OPTIMISE: 2, CHIFFRE: 3, NOYAU: 4, ROOT: 5 });
export const RARITY_COUNT = 6;
/** index = RARITY.* ; levels = niveaux d'arme apportés (docs/contenu-objets-fusions.md § 2.1). */
export const RARITIES = [
  { key: 'brut', name: 'Brut', color: 0xaeb7c2, levels: 0 },
  { key: 'compile', name: 'Compilé', color: 0x7cff6b, levels: 1 },
  { key: 'optimise', name: 'Optimisé', color: 0x4da3ff, levels: 2 },
  { key: 'chiffre', name: 'Chiffré', color: 0xb06cff, levels: 3 },
  { key: 'noyau', name: 'Noyau', color: 0xffc83d, levels: 0 },
  { key: 'root', name: 'Root', color: 0xff4b5c, levels: 0 },
];
/** Genre d'un lot de coffre. */
export const LOT = Object.freeze({ WEAPON_NEW: 0, WEAPON_UP: 1, ITEM: 2, OVERCHARGE: 3, FRAGMENTS: 4 });
export const LOT_KEYS = Object.freeze(['weaponNew', 'weaponUp', 'item', 'overcharge', 'fragments']);
/** Résultat de chests.take / reroll / skip / banish. */
export const PICK = Object.freeze({ OK: 0, CLOSED: 1, INVALID: 2, NO_CHARGE: 3 });
export const CHESTS = {
  weaponSlots: 6, // emplacements d'armes (12 armes possibles à la fin de l'étape)
  lots: 3, // lots proposés par coffre ; le joueur en garde un
  cap: 8, // coffres au sol au plus (le 9e est crédité d'office : run.chests++)
  weaponCalendar: [[2, 2], [4, 3], [6, 4], [8, 5], [10, 6]], // [vague, armes possédées attendues à la FIN de cette vague]
  // Poids de rareté d'un lot (Brut, Compilé, Optimisé, Chiffré) selon la vague ; Noyau et Root : étape 3.
  rarityWeights: [
    { to: 4, w: [55, 30, 13, 2] },
    { to: 9, w: [40, 33, 20, 7] },
    { to: 14, w: [28, 34, 26, 12] },
    { to: Infinity, w: [18, 32, 32, 18] },
  ],
  bossMinRarity: RARITY.OPTIMISE, // coffre du boss : aucun lot sous « Optimisé »
  kindWeights: { weaponNew: 10, weaponUp: 45, item: 45 }, // hors retard de calendrier ; weaponNew seulement s'il reste un emplacement
  carriers: [
    { from: 2, to: 9, count: 1 },
    { from: 11, to: Infinity, count: 2 },
  ], // élites porteuses par vague ; jamais sur une vague de boss (le boss lâche son coffre)
  carrier: {
    // fraction ÉCOULÉE du chrono à laquelle sort le porteur k. Fusion de la phase 1 (§ E2.I) : la première était 0,35 —
    // l'instant exact où tombe l'événement de vague (EVENTS.at, § E1.C) : deux bannières et deux alertes à la même image
    // à partir de la vague 6 (tests/e1-evenements.test.mjs). 0,2 : la porteuse sort AVANT l'événement, jamais avec lui,
    // et le joueur a plus de temps pour la tuer (PV × 10). À régler avec le reste par le chantier G.
    at: [0.2, 0.65],
    scale: 1.7, // taille et rayon de collision
    hpMul: 10,
    xpMul: 10, // gemmes lâchées (pickups.dropLoot répété)
    types: [ENEMY.RODEUR, ENEMY.TIREUR, ENEMY.BLINDE, ENEMY.REPARATEUR],
    kicker: 'ÉLITE DÉTECTÉE', // bannière : « ÉLITE DÉTECTÉE : PORTEUR DE CACHE » (demande de Femz : « ÉLITE DÉTECTÉE »)
    label: 'PORTEUR DE CACHE',
    bannerSeconds: 2.4,
    // bodyMul (§ E2.S S3) : rayon de l'anneau = max(radius, rayon du robot porteur × bodyMul) — le blindé cachait l'anneau
    aura: { radius: 1.6, bodyMul: 1.9, color: 0xffc83d, pulseHz: 1.2, pulseAmp: 0.12, y: 0.05, gain: 1.6 },
    arrowMargin: 1.0, // m — la flèche de bord d'écran s'efface quand le porteur est à plus de cette marge dans l'écran
    lateDrop: true, // purgé au chrono en retard sur le calendrier d'armes : son coffre tombe quand même
  },
  // 22/11 (coffres v2, outils/blender/coffres_v2.py) : un modèle par TAILLE de coffre (1, 3, 5 lots), à sa hauteur
  // déclarée ; leurs lueurs (blanches) prennent la couleur de la rareté (RARITIES[].color × teinteGain).
  chest: { models: ['coffre-1.glb', 'coffre-3.glb', 'coffre-5.glb'], heights: [0.74, 0.95, 1.45], teinteGain: 1.15, pickupRadius: 1.4, bob: 0.06, bobHz: 0.9, spin: 0.6, glow: 0x3fe0d0, vacuumSpeed: 26, dropScatter: 1.2 },
  roulette: {
    spinSeconds: 1.2, // les trois bandes défilent
    stepSeconds: 0.45, // puis un palier de rareté toutes les stepSeconds
    holdSeconds: 0.5, // garde après la révélation avant qu'un lot puisse être pris
    tickSeconds: 0.09, // un tic par symbole qui défile
    bigFrom: RARITY.CHIFFRE, // à partir de cette rareté : arrêt sur image, secousse, pluie de voxels
    bigHitstop: 0.12,
    bigTrauma: 0.35,
    voxels: 40,
    unskippable: 3, // les trois premiers coffres de la partie se regardent en entier
    guardSeconds: 0.5,
    semitonesPerStep: 2,
  },
  fragments: { base: 40, perWave: 10 }, // lot de dernier recours
  skipFragmentsPerWave: 15, // compensation d'un coffre passé (CHOICES.skipFragmentsPerWave du chantier D la remplace s'il existe)
  supplyChest: true, // la capsule de ravitaillement lâche aussi un coffre
  bossChest: true,
  // Textes de l'écran (DA FUI)
  text: {
    path: 'AGENT / CACHE DÉCHIFFRÉE', title: 'CACHE DÉCHIFFRÉE', lead: 'Gardez un lot.', decoding: 'DÉCHIFFREMENT…',
    pending: 'caches en attente', newWeapon: 'NOUVELLE ARME', upWeapon: 'AMÉLIORATION', item: 'MODULE', overcharge: 'SURCHARGE', fragments: 'FRAGMENTS',
    reroll: 'Relancer', skip: 'Passer', banish: 'Bannir', banishing: 'Bannir : choisissez un lot (1, 2, 3)', skipAnim: 'Entrée : passer l’animation',
  },
};
SHOP.upgradePriceMul = 2.5; // prix d'une amélioration = round(upgradeCost × 2,5) (étude § 2.4 : le marchand n'est plus la seule source de niveaux)

/** Armes possédées attendues à la FIN de la vague n (1 avant la vague 2), d'après CHESTS.weaponCalendar. */
export function chestWeaponTarget(wave) {
  let t = 1;
  const C = CHESTS.weaponCalendar;
  for (let k = 0; k < C.length; k++) if (wave >= C[k][0]) t = C[k][1];
  return t;
}

/** Rareté d'un lot : r ∈ [0, 1) → RARITY.BRUT … CHIFFRE selon les poids de la vague, jamais sous minRarity. */
export function chestRarity(wave, r, minRarity = 0) {
  const T = CHESTS.rarityWeights;
  let row = T[T.length - 1];
  for (let k = 0; k < T.length; k++) {
    if (wave <= T[k].to) {
      row = T[k];
      break;
    }
  }
  let sum = 0;
  for (let k = 0; k < row.w.length; k++) sum += row.w[k];
  let x = r * sum;
  let q = row.w.length - 1;
  for (let k = 0; k < row.w.length; k++) {
    if (x < row.w[k]) {
      q = k;
      break;
    }
    x -= row.w[k];
  }
  return q < minRarity ? minRarity : q;
}

/** Élites porteuses de la vague n (0 sur une vague de boss). */
export function carriersForWave(n) {
  if (isBossWave(n)) return 0;
  const T = CHESTS.carriers;
  for (let k = 0; k < T.length; k++) if (n >= T[k].from && n <= T[k].to) return T[k].count;
  return 0;
}

/** Prix chez le marchand du niveau suivant d'une stat : round(upgradeCost × SHOP.upgradePriceMul) ; −1 si max. */
export function upgradePrice(weapon, stat, level) {
  const c = upgradeCost(weapon, stat, level);
  return c < 0 ? -1 : Math.round(c * SHOP.upgradePriceMul);
}

/** Fragments du lot de dernier recours d'un coffre ouvert à la vague n. */
export function chestFragments(wave) {
  return CHESTS.fragments.base + CHESTS.fragments.perWave * wave;
}

// Sons du chantier (lignes muettes du socle remplacées ici ; fichiers : découpes de la banque « sfx game » de Femz,
// CANDIDATS à faire valider — outils/preparer_sons.py). RARITY_k : un palier = +2 demi-tons, de plus en plus riche.
AUDIO.sounds[SFX.CHEST_DROP] = { dur: 0.6, gain: 0.3, minInterval: 0.2, maxVoices: 2, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.CHEST_OPEN] = { dur: 0.8, gain: 0.3, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.ROULETTE_TICK] = { dur: 0.12, gain: 0.16, minInterval: 0.04, maxVoices: 3, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.RARITY_0] = { dur: 0.3, gain: 0.22, minInterval: 0.05, maxVoices: 3, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.RARITY_1] = { dur: 0.5, gain: 0.24, minInterval: 0.05, maxVoices: 3, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.RARITY_2] = { dur: 0.75, gain: 0.27, minInterval: 0.05, maxVoices: 3, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.RARITY_3] = { dur: 1.1, gain: 0.32, minInterval: 0.05, maxVoices: 3, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.RARITY_4] = { dur: 1.4, gain: 0.36, minInterval: 0.05, maxVoices: 2, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.RARITY_5] = { dur: 1.6, gain: 0.4, minInterval: 0.05, maxVoices: 2, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.CHEST_PICK] = { dur: 0.9, gain: 0.32, minInterval: 0.1, maxVoices: 1, pitchVar: 0, priority: 2 };
//#endregion e2:C-coffres-marchand

//#region e2:D-choix-agents
// Chantier D (§ E2.D) : trois agents (un modèle chacun depuis la fusion agents-modeles : MODELES.agents), écran de choix à parallaxe, Relance / Passer /
// Bannir au choix de niveau (compteurs communs au choix du lot d'un coffre, § E2.C). Premier équilibrage SUPPOSÉ
// (calculé, pas joué) : réglé par le chantier G.
export const AGENT = Object.freeze({ ECLAIREUR: 0, BASTION: 1, SHINOBI: 2 });
export const AGENT_COUNT = 3;
export const AGENTS = [
  // signatureKey : clé de WEAPON_KEYS (l'arme de départ, jamais donnée aux autres agents par les coffres) ;
  // signatureName : nom affiché tant que l'arme n'est pas dans le jeu. stats : profil posé dans mods au début de la partie.
  { id: 0, key: 'eclaireur', name: 'Éclaireur', accent: 0x3fe0d0, signatureKey: 'blaster', signatureName: 'Blaster',
    stats: { maxHp: 100, speedMul: 1, damageTakenMul: 1, dashCdMul: 1 },
    // critDashCut : s retirées à la recharge du dash par coup critique ; critDashCutPerSecond : au plus, par seconde
    passive: { key: 'reflexe', name: 'Réflexe', critDashCut: 0.15, critDashCutPerSecond: 1.0, desc: "Vos coups critiques font revenir votre dash plus vite (−0,15 s chacun)." },
    role: 'Polyvalent', lines: ['Dernier programme de défense encore actif.'] },
  // cape: false : pas de cape (heros-anim ne la crée pas, cape.couper() si elle existe)
  { id: 1, key: 'bastion', name: 'Bastion', accent: 0xffb347, cape: false, signatureKey: 'turret', signatureName: 'Sentinelle',
    stats: { maxHp: 140, speedMul: 0.88, damageTakenMul: 0.85, dashCdMul: 1 },
    // resistToDamage : part des dégâts NON reçus (1 − mods.damageTakenMul) ajoutée à mods.damageMul
    passive: { key: 'conversion', name: 'Conversion', resistToDamage: 1.0, desc: "Vos protections deviennent de la puissance : +1 % de dégâts pour chaque 1 % de dégâts reçus en moins." },
    role: 'Tank', lines: ['Pare-feu lourd. Il encaisse, puis il rend.'] },
  // accent orange choisi par Femz le 15/11 (celui des lumières de agent-shinobi.glb ; HUD, anneau du dash, écran de choix)
  { id: 2, key: 'shinobi', name: 'Shinobi', accent: 0xef9628, signatureKey: 'blade', signatureName: 'Lame de phase',
    stats: { maxHp: 80, speedMul: 1.12, damageTakenMul: 1, dashCdMul: 0.8 },
    // critNear : chance de critique ajoutée quand le robot touché est à moins de critNearDist (m) du héros
    passive: { key: 'ombre', name: "Frappe de l'ombre", critNear: 0.25, critNearDist: 3, desc: "De près (moins de 3 m), vos coups font plus souvent un critique (+25 % de chance)." },
    role: 'Assassin', lines: ['Processus furtif. Fragile, rapide, précis de près.'] },
];
export const CHOICES = {
  rerolls: 2, // relances par partie
  skips: 1, // passes par partie
  banishes: 1, // bannissements par partie
  rerollPerBoss: 1, // relance gagnée à chaque boss tué
  skipFragmentsPerWave: 15, // fragments rendus par une passe = 15 × numéro de la vague
  itemShare: 0.4, // part des cartes d'objet au choix de niveau (chantier F ; sans objets : bonus seulement)
  labels: { reroll: 'Relancer', skip: 'Passer', banish: 'Bannir', banishArmed: 'Bannir : choisir une carte' },
};
export const AGENT_SCREEN = {
  guardSeconds: 0.35, // clics et touches ignorés à l'ouverture de l'écran
  // Parallaxe : décalage maximal de chaque couche (fond de grille, cartes, portraits), en px CSS dans la fenêtre de
  // référence (UI.scale) ; rate : lissage (1/s) ; deadPx : une couche n'est réécrite que si sa cible bouge d'autant.
  parallax: { layersPx: [6, 12, 20], rate: 8, deadPx: 0.5 },
  // Barres de la fiche : crans = 3 + (valeur − base) / perPip, bornés à [1, pips]
  pips: 5,
  bars: [
    { stat: 'maxHp', label: 'PV', base: 100, perPip: 20 },
    { stat: 'speedMul', label: 'Vitesse', base: 1, perPip: 0.06 },
    { stat: 'damageTakenMul', label: 'Blindage', base: 1, perPip: -0.075 },
    { stat: 'dashCdMul', label: 'Dash', base: 1, perPip: -0.1 },
  ],
  title: "Choix de l'agent",
  lead: 'Chaque agent part avec son arme et change une règle.',
  rootTag: 'ROOT', // étiquette de l'arme signature (rareté rouge, § 2.1 de l'étude)
  // vignettes 48 × 68 (Noyau, fiche, silhouettes du Noyau) et planches animées des cartes (PORTRAIT), même rendu :
  // outils/portraits_agents.mjs
  portraits: ['assets/ui/agents/agent-0.png', 'assets/ui/agents/agent-1.png', 'assets/ui/agents/agent-2.png'],
  planches: ['assets/ui/agents/agent-0-planche.png', 'assets/ui/agents/agent-1-planche.png', 'assets/ui/agents/agent-2-planche.png'],
  urlParam: 'agent', // ?debug&agent=1 : agent imposé ; ?debug&agent=choix : l'écran s'affiche aussi en debug
  urlChoice: 'choix',
};
STORAGE.agentKey = 'survivor-robots:agent:v1'; // '0' | '1' | '2' : dernier agent choisi
// Sons (§ E2.0.7) : découpes de la banque « sfx game » de Femz, CANDIDATS à faire valider.
AUDIO.sounds[SFX.AGENT_SELECT] = { dur: 0.9, gain: 0.3, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 }; // « Choix d'un bonus.wav », −3 demi-tons
AUDIO.sounds[SFX.REROLL] = { dur: 0.4, gain: 0.25, minInterval: 0.05, maxVoices: 2, pitchVar: 0, priority: 2 }; // « Dash rechargé.wav », 0,4 s
AUDIO.sounds[SFX.BANISH] = { dur: 0.3, gain: 0.25, minInterval: 0.05, maxVoices: 2, pitchVar: 0, priority: 2 }; // « Achat refusé.wav », +3 demi-tons

/** Arme de départ d'un agent : indice de WEAPON_KEYS de sa clé ; clé inconnue (arme pas encore dans le jeu) → blaster. */
export function agentSignature(agent) {
  const A = AGENTS[agent];
  const w = A ? WEAPON_KEYS.indexOf(A.signatureKey) : -1;
  return w >= 0 ? w : WEAPON.BLASTER;
}

/** Crans (1 à AGENT_SCREEN.pips) de la barre n° bar de la fiche d'un agent. */
export function agentBarPips(agent, bar) {
  const B = AGENT_SCREEN.bars[bar];
  const p = 3 + Math.round((AGENTS[agent].stats[B.stat] - B.base) / B.perPip);
  return p < 1 ? 1 : p > AGENT_SCREEN.pips ? AGENT_SCREEN.pips : p;
}
//#endregion e2:D-choix-agents

//#region e2:E-zoom-molette
// ----- ZOOM : se rapprocher à la molette, jamais reculer (§ E2.E ; demande de Femz du 14/11/2026 : « la vue actuelle
// est le recul max, à ne pas dézoomer plus ») --------------------------------------------------------------------
// Le zoom se multiplie à cam.zoom (caméra orthographique) ; le champ de JEU (apparitions, ombres, culling) reste celui
// du recul maximum : rien de la simulation ne lit le zoom.
// Le zoom demandé est gardé d'une partie et d'une visite à l'autre : JSON de STORAGE.settingsKey ({ shake, volume, zoom }).
export const ZOOM = {
  min: 1, // 1 = la vue du cahier (32 m de haut) = le RECUL MAXIMUM : butée dure, on ne descend jamais sous 1
  max: 1.8, // zoom le plus proche : 17,8 m visibles en hauteur — proposition, à valider par Femz sur la planche
  step: 0.1, // par cran de molette : 8 crans du recul maximum au zoom le plus proche
  omega: 16, // 1/s — ressort critique vers le zoom demandé (temps réel) : 95 % du trajet en 0,30 s, au plus 9,8 % par image à 60 i/s
  epsilon: 1e-4, // sous cet écart et cette vitesse, le zoom vaut EXACTEMENT le zoom demandé (1 au recul maximum)
  // Pas réguliers quelle que soit la souris (input.js) :
  wheelPerStep: 100, // deltaY (px) d'un cran : souris à 100 px le cran ; pavé tactile et molettes fines = fractions cumulées
  pinchPerStep: 8, // deltaY d'un cran pendant un pincement (wheel + ctrlKey) — de mémoire, à régler sur son pavé
  // molette crantée = un événement, un cran : deltaMode « lignes » ou « pages » (Firefox à la souris), ou deltaY multiple de :
  macNotchPx: 4.000244140625, // signature d'une molette crantée sous macOS (Chrome : 0,1 ligne × 40 px) — de mémoire
  gestureGapMs: 400, // ms sans événement = geste fini (la fraction en attente est jetée, le caractère « cranté » oublié)
};
//#endregion e2:E-zoom-molette

//#region e2:F-objets-passifs
// =====================================================================================================
// Plan addictif, étape 2, chantier F (ARCHITECTURE.md § E2.F et E2.F bis) — les 18 objets passifs (« modules »),
// empilables SANS LIMITE, 6 emplacements. Étude et tableaux : docs/contenu-objets-fusions.md § 2.5 et 2.6.
// Premier équilibrage SUPPOSÉ (calculé, pas joué) : réglé par le chantier G.
// =====================================================================================================
export const ITEM = Object.freeze({
  TESLA: 0, CRYO: 1, VIRUS: 2, BURN: 3, DETONATOR: 4, SCOPE: 5, BERSERK: 6, LEECH: 7, SHIELD: 8,
  REACTIVE: 9, DASHCORE: 10, OVERCLOCK: 11, DRONE: 12, CAPACITOR: 13, SHRAPNEL: 14, MAGNET: 15, LUCK: 16, SAVE: 17,
});
export const ITEM_COUNT = 18;
/**
 * index = ITEM.* ; tier = RARITY minimale (un lot de rang r donne 1 + (r − tier) piles).
 * law : 'hyp' p(n) = 1 − 1/(1 + a × n) (une CHANCE : jamais 100 %) ; 'lin' v(n) = base + a × (n − 1) (une grandeur) ;
 * 'inv' v(n) = base / (1 + a × (n − 1)) (une recharge, un seuil). min / max : bornes de la valeur.
 * unit : écriture de la valeur sur les cartes ('pct' → « 20,8 % », 'plus' → « +30 % », 'mul' → « × 2,5 », 'm', 's', 'n').
 * what : ce que la valeur mesure ; desc : la règle, en une phrase. perFrame : plafond de déclenchements par image.
 * Les autres champs sont les réglages propres à l'objet, lus par src/items.js.
 */
export const ITEMS = [
  { id: 0, key: 'tesla', name: 'Bobine Tesla', tier: 2, law: 'hyp', a: 0.0526, unit: 'pct', what: 'chance par coup', desc: "Vos coups lancent parfois un éclair qui saute de robot en robot.", pile: "éclair sur 5 robots, 50 % des dégâts du coup",
    jumps: 5, jumpRange: 6, dmgShare: 0.5, perFrame: 2, color: 0x8fd0ff },
  { id: 1, key: 'cryo', name: 'Cryogel', tier: 1, law: 'hyp', a: 0.1765, unit: 'pct', what: 'chance par coup', desc: "Vos coups gèlent parfois un robot : il n'avance presque plus.", pile: "gel de 1,2 s, vitesse × 0,3",
    seconds: 1.2, factor: 0.3, perFrame: 16, color: 0xbfe8ff },
  { id: 2, key: 'virus', name: 'Virus', tier: 1, law: 'lin', base: 2, a: 2, unit: 'n', what: 'PV par seconde', desc: "Chaque coup infecte le robot : il perd des PV pendant 4 s.",
    seconds: 4, color: 0x9dff5a },
  { id: 3, key: 'burn', name: 'Surchauffe', tier: 1, law: 'hyp', a: 0.1111, unit: 'pct', what: 'chance par coup', desc: "Vos coups mettent parfois le feu ; un robot qui meurt en brûlant enflamme ses voisins.", pile: "feu de 3 s à 15 PV/s, voisins à 2 m",
    seconds: 3, dps: 15, spread: 2, perFrame: 4, color: 0xff7a1f },
  { id: 4, key: 'detonator', name: 'Charge critique', tier: 3, law: 'lin', base: 2, a: 0.15, max: 5, unit: 'm', what: "rayon de l'explosion", desc: "Vos coups critiques font exploser la cible et blessent les robots autour.", pile: "explosion à 60 % du coup",
    dmgShare: 0.6, perFrame: 3, knockback: 2, trauma: 0.12, color: 0xff9a2e },
  { id: 5, key: 'scope', name: 'Viseur thermique', tier: 0, law: 'lin', base: 0.1, a: 0.1, max: 2.5, unit: 'crit', what: 'dégâts des critiques', desc: "Vos coups critiques font encore plus de dégâts.",
    color: 0xffd23f },
  { id: 6, key: 'berserk', name: 'Berserk', tier: 2, law: 'lin', base: 0.2, a: 0.2, max: 2, unit: 'plus', what: 'cadence à 0 PV', desc: "Moins il vous reste de PV, plus vos armes tirent vite.", pile: "jusqu'à × 3 au plus",
    color: 0xff4b5c },
  { id: 7, key: 'leech', name: 'Siphon', tier: 2, law: 'hyp', a: 0.0526, unit: 'pct', what: 'chance par robot tué', desc: "Les robots que vous tuez vous rendent parfois des PV.", pile: "2 PV par robot, 10 PV par seconde au plus",
    heal: 2, color: 0x5cff8a },
  { id: 8, key: 'shield', name: 'Pare-feu', tier: 2, law: 'inv', base: 12, a: 0.15, min: 2, unit: 's', what: 'recharge', desc: "Un bouclier encaisse 40 PV de dégâts, puis se recharge.",
    radius: 1.5, color: 0x4da3ff },
  { id: 9, key: 'reactive', name: 'Coque réactive', tier: 0, law: 'lin', base: 15, a: 15, unit: 'n', what: "dégâts de l'onde", desc: "Quand vous êtes touché, une onde blesse et repousse les robots autour de vous.", pile: "onde de 4 m, une fois toutes les 2 s au plus",
    radius: 4, cooldown: 2, knockback: 9, color: 0xfff1c9 },
  { id: 10, key: 'dashcore', name: 'Moteur cinétique', tier: 1, law: 'lin', base: 30, a: 30, unit: 'n', what: 'dégâts du dash', desc: "Votre dash blesse tous les robots qu'il traverse.",
    halfWidth: 1.1, color: 0x3fe0d0 },
  { id: 11, key: 'overclock', name: 'Overclock', tier: 0, law: 'lin', base: 0.06, a: 0.06, max: 1.5, unit: 'plus', what: 'cadence', desc: "Vos armes tirent plus vite, mais vous avez moins de PV max.", pile: "−3 PV max par pile (jamais sous 40 PV max)",
    hpPerStack: 3, minMaxHp: 40, color: 0xffc83d },
  { id: 12, key: 'drone', name: 'Drone compagnon', tier: 3, law: 'lin', base: 1, a: 0.25, unit: 'mul', what: 'dégâts du drone', desc: "Un drone allié vous suit et tire comme un blaster.", pile: "2e drone à 5 piles, 3e à 10",
    counts: [1, 5, 10], range: 11, orbit: 2.1, height: 1.6, spin: 1.4, bob: 0.12, scale: 1.1, model: 'drone-allie.glb', color: 0x3fe0d0 }, // scale 1,1 : 0,55 m de haut (à 0,55 il ne se lisait pas à l'échelle du jeu, planche du 15/11)
  { id: 13, key: 'capacitor', name: 'Condensateur', tier: 2, law: 'inv', base: 150, a: 0.2, min: 25, unit: 'kills', what: 'robots tués par impulsion', desc: "Après un certain nombre de robots tués, une impulsion frappe tous les robots à l'écran.", pile: "impulsion de 40 dégâts + 10 par pile",
    dmgBase: 40, dmgPerStack: 10, radius: 24, trauma: 0.18, color: 0x4da3ff },
  { id: 14, key: 'shrapnel', name: 'Éclats', tier: 0, law: 'hyp', a: 0.25, unit: 'pct', what: 'chance par robot tué', desc: "Les robots que vous tuez projettent parfois des éclats sur leurs voisins.", pile: "4 éclats de 8 dégâts + 2 par pile",
    shards: 4, dmgBase: 8, dmgPerStack: 2, range: 5, perFrame: 6, color: 0xaeb7c2 },
  { id: 15, key: 'magnet', name: 'Aimant à fragments', tier: 0, law: 'lin', base: 0.08, a: 0.08, max: 2, unit: 'plus', what: 'fragments ramassés', desc: "Chaque fragment ramassé vaut plus : plus d'achats chez le marchand.",
    color: 0x3fe0d0 },
  { id: 16, key: 'luck', name: 'Puce de chance', tier: 1, law: 'hyp', a: 0.1, unit: 'pct', what: 'chance par lot', desc: "Les lots des coffres sortent parfois une rareté au-dessus.",
    color: 0x7cff6b },
  { id: 17, key: 'save', name: 'Sauvegarde', tier: 3, law: 'lin', base: 0.3, a: 0.05, max: 0.8, unit: 'pv', what: 'PV rendus', desc: "Une fois par vague, un coup qui devait vous tuer est annulé et vous rend des PV (CTRL+Z).",
    purgeRadius: 9, color: 0xb06cff },
];
// § E2.S (mineur) : Overclock, Aimant à fragments et Viseur thermique plafonnés (max) — atteints à 25 piles ; avant,
// à 50 piles : cadence × 4, fragments × 5, critiques + 5.
export const ITEM_KEYS = Object.freeze(ITEMS.map((I) => I.key));
export const ITEM_RULES = {
  slots: 6, // objets DIFFÉRENTS portés (rangée du HUD) ; chacun s'empile sans limite
  fusionAt: 5, // piles de CHAQUE ingrédient pour qu'une fusion soit possible (étape 3)
  queue: 64, // déclenchements en attente par image (file fixe ; au-delà : perdus, comptés)
  dotTick: 0.5, // s entre deux tics des statuts (virus, feu)
  dotNumbers: 16, // chiffres de dégâts affichés par tic, au plus (les autres robots sont blessés sans chiffre)
  dotPuffs: 24, // bouffées de couleur par tic, au plus (le statut se lit sur la horde)
  leechPerSecond: 10, // PV rendus par le Siphon, au plus, par seconde
};
/**
 * Les 9 fusions (étude § 2.6) : a et b = ITEM.* des deux ingrédients (paires 0-1, 2-3, … 16-17). CODÉES À L'ÉTAPE 3 :
 * enabled reste false, rien ne fusionne ; items.js sait déjà remplacer deux objets par l'objet né (items.fuse).
 */
export const FUSIONS = [
  { id: 0, key: 'orage', name: 'Orage glacé', a: 0, b: 1, enabled: false, rule: "L'éclair gèle chaque robot qu'il touche, et saute 2 fois plus loin vers un robot gelé." },
  { id: 1, key: 'malware', name: 'Malware', a: 2, b: 3, enabled: false, rule: "Un robot qui meurt infecté ET en feu laisse un nuage toxique pendant 3 s." },
  { id: 2, key: 'reaction', name: 'Réaction en chaîne', a: 4, b: 5, enabled: false, rule: "L'explosion d'un critique peut elle-même être critique (une seule fois)." },
  { id: 3, key: 'retroaction', name: 'Boucle de rétroaction', a: 6, b: 7, enabled: false, rule: "Sous 30 % de PV, le Berserk tire comme à 0 PV et le Siphon rend 2 fois plus de PV." },
  { id: 4, key: 'parefeu-actif', name: 'Pare-feu actif', a: 8, b: 9, enabled: false, rule: "Quand le bouclier tombe, il déclenche l'onde de la coque, avec 3 fois ses dégâts." },
  { id: 5, key: 'surregime', name: 'Surrégime', a: 10, b: 11, enabled: false, rule: "Après un dash, vos armes tirent 2 fois plus vite pendant 2 s." },
  { id: 6, key: 'essaim', name: 'Essaim de garde', a: 12, b: 13, enabled: false, rule: "À chaque impulsion du Condensateur, chaque drone tire une salve tout autour de lui." },
  { id: 7, key: 'recyclage', name: 'Recyclage', a: 14, b: 15, enabled: false, rule: "Un robot tué par un éclat lâche 2 fois plus de fragments." },
  { id: 8, key: 'restauration', name: 'Point de restauration', a: 16, b: 17, enabled: false, rule: "Quand la Sauvegarde vous sauve, un coffre gratuit s'ouvre à la fin de la vague." },
];
export const FUSION_COUNT = 9;

/** La loi de l'objet à `stacks` piles, bornée (0 sans pile). Pure : lue par items.js, l'interface et les tests. */
export function itemValue(id, stacks) {
  const I = ITEMS[id];
  const n = stacks > 0 ? stacks : 0;
  if (n === 0) return 0;
  let v;
  if (I.law === 'hyp') v = 1 - 1 / (1 + I.a * n);
  else if (I.law === 'inv') v = I.base / (1 + I.a * (n - 1));
  else v = I.base + I.a * (n - 1);
  if (I.min !== undefined && v < I.min) v = I.min;
  if (I.max !== undefined && v > I.max) v = I.max;
  return v;
}

/** Piles données par un lot de rareté `rarity` pour un objet de rang minimal `tier` : 1 + (rarity − tier), 1 au moins. */
export function lotItemStacks(rarity, tier) {
  const n = 1 + (rarity - tier);
  return n > 1 ? n : 1;
}

/** Drones du Drone compagnon à `stacks` piles (1, puis 2 à 5 piles, 3 à 10). */
export function droneCount(stacks) {
  const T = ITEMS[ITEM.DRONE].counts;
  let n = 0;
  for (let k = 0; k < T.length; k++) if (stacks >= T[k]) n = k + 1;
  return n;
}

/** Valeur d'un objet telle qu'elle s'écrit sur une carte (hors combat : construit une chaîne). */
export function itemText(id, stacks) {
  const I = ITEMS[id];
  const v = itemValue(id, stacks);
  const fr = (x, d) => x.toFixed(d).replace('.', ',');
  if (stacks <= 0) return '—';
  if (I.unit === 'pct') return fr(v * 100, 1) + ' %';
  if (I.unit === 'plus') return '+' + Math.round(v * 100) + ' %';
  if (I.unit === 'pv') return Math.round(v * 100) + ' % des PV';
  if (I.unit === 'crit') return '× ' + fr(PLAYER.critMul + v, 1);
  if (I.unit === 'mul') return '× ' + fr(v, 2);
  if (I.unit === 'm') return fr(v, 2) + ' m';
  if (I.unit === 's') return fr(v, 1) + ' s';
  if (I.unit === 'kills') return String(Math.round(v)) + ' robots';
  // § E5.X7 (H11) : 'tir' = PV d'un tir du drone (blaster de niveau 1 × v, items.js DRONE_DMG) ; 'pvs' = PV perdus par seconde
  if (I.unit === 'tir') return fr(Math.round(v * WEAPONS[WEAPON.BLASTER].stats[STAT.DAMAGE][0] * 10) / 10, 1).replace(/,0$/, '');
  if (I.unit === 'pvs') return '−' + Math.round(v) + ' PV/s';
  return String(Math.round(v));
}

/**
 * Icônes des 18 objets (§ E2.F règle 8) : pixel 1-bit, grilles de 12 × 12 comme les bonus (GRILLES de src/ui.js) — « # » =
 * pixel allumé, de la couleur courante. Clé = identifiant du symbole SVG : sr-m-<clé de l'objet>. Données seules, ici
 * parce que ui.js n'importe que config.js et state.js (contrat du lot ui) ; ui.js les convertit en symboles à l'init.
 */
export const ITEM_ICONS = {
  // Bobine Tesla : un éclair
  'sr-m-tesla': ['.......###..', '......###...', '.....###....', '....###.....', '...#######..', '..#######...', '.....###....', '....###.....', '...###......', '..###.......', '.###........', '............'],
  // Cryogel : un flocon
  'sr-m-cryo': ['.....##.....', '...#.##.#...', '....####....', '.#...##...#.', '..#..##..#..', '############', '..#..##..#..', '.#...##...#.', '....####....', '...#.##.#...', '.....##.....', '............'],
  // Virus : une cellule à pointes
  'sr-m-virus': ['..#..##..#..', '...#.##.#...', '....####....', '#..######..#', '.##########.', '..###..###..', '..###..###..', '.##########.', '#..######..#', '....####....', '...#.##.#...', '..#..##..#..'],
  // Surchauffe : une flamme
  'sr-m-burn': ['.....#......', '....##......', '....###.....', '...####..#..', '..#####.##..', '..########..', '.##########.', '.###.######.', '.###..#####.', '.####..####.', '..########..', '...######...'],
  // Charge critique : une bombe et sa mèche
  'sr-m-detonator': ['........##..', '.......#..#.', '......#.....', '....####....', '...######...', '..########..', '.##########.', '.###.######.', '.##########.', '..########..', '...######...', '....####....'],
  // Viseur thermique : un cadre de visée
  'sr-m-scope': ['###......###', '#..........#', '#....##....#', '....#..#....', '...#....#...', '..#..##..#..', '..#..##..#..', '...#....#...', '....#..#....', '#....##....#', '#..........#', '###......###'],
  // Berserk : un crâne
  'sr-m-berserk': ['...######...', '..########..', '.##########.', '.##..##..##.', '.##..##..##.', '.##########.', '..####.###..', '...######...', '...#.##.#...', '...#.##.#...', '............', '............'],
  // Siphon : un cœur plein
  'sr-m-leech': ['..###..###..', '.##########.', '############', '############', '############', '.##########.', '..########..', '...######...', '....####....', '.....##.....', '............', '............'],
  // Pare-feu : un mur de briques
  'sr-m-shield': ['############', '#....#.....#', '#....#.....#', '############', '#..#.....#.#', '#..#.....#.#', '############', '#....#.....#', '#....#.....#', '############', '............', '............'],
  // Coque réactive : un noyau et quatre poussées vers l'extérieur
  'sr-m-reactive': ['.....##.....', '.....##.....', '..#......#..', '...#.##.#...', '....####....', '##.######.##', '##.######.##', '....####....', '...#.##.#...', '..#......#..', '.....##.....', '.....##.....'],
  // Moteur cinétique : une flèche et ses traits de vitesse
  'sr-m-dashcore': ['............', '.......##...', '###.....##..', '.........##.', '######....##', '###########.', '######....##', '.........##.', '###.....##..', '.......##...', '............', '............'],
  // Overclock : un cadran
  'sr-m-overclock': ['...######...', '..#......#..', '.#...##...#.', '#....##....#', '#....##....#', '#....###...#', '#......##..#', '#.......#..#', '.#........#.', '..#......#..', '...######...', '............'],
  // Drone compagnon
  'sr-m-drone': ['............', '###......###', '.#........#.', '.#........#.', '.####..####.', '...######...', '..########..', '..##.##.##..', '..########..', '...######...', '....#..#....', '............'],
  // Condensateur : deux armatures
  'sr-m-capacitor': ['.....##.....', '.....##.....', '.....##.....', '.##########.', '.##########.', '............', '............', '.##########.', '.##########.', '.....##.....', '.....##.....', '.....##.....'],
  // Éclats
  'sr-m-shrapnel': ['#...........', '##.......#..', '###.....##..', '.###...###..', '..##..####..', '...#...###..', '........##..', '..#......#..', '.###........', '#####.......', '.###...##...', '..#...####..'],
  // Aimant à fragments : un fragment, et un de plus
  'sr-m-magnet': ['....##......', '...####.....', '..##..##....', '.##....##...', '##......##..', '.##....##...', '..##..##.#..', '...####..#..', '....##.#####', '.........#..', '.........#..', '............'],
  // Puce de chance : un dé
  'sr-m-luck': ['############', '#..........#', '#.##....##.#', '#.##....##.#', '#..........#', '#....##....#', '#....##....#', '#..........#', '#.##....##.#', '#.##....##.#', '#..........#', '############'],
  // Sauvegarde : une disquette
  'sr-m-save': ['##########..', '#.######.##.', '#.######.#.#', '#.######...#', '#..........#', '#..........#', '#.########.#', '#.#......#.#', '#.#.####.#.#', '#.#......#.#', '############', '............'],
};

CAPS.allyDrones = 3; // InstancedMesh « drones-allies »
CHOICES.itemText = { tag: 'MODULE', gain: 'pile', gains: 'piles', lead: 'Choisissez un bonus ou un module.' };
// Sons du chantier (lignes muettes du socle remplacées ici ; fichiers : découpes de la banque « sfx game » de Femz,
// CANDIDATS à faire valider — outils/preparer_sons.py, § E2.0.7).
AUDIO.sounds[SFX.ITEM_TESLA] = { dur: 0.35, gain: 0.2, minInterval: 0.07, maxVoices: 2, pitchVar: 1, priority: 1 }; // « Champ EMP.wav », +7 demi-tons
AUDIO.sounds[SFX.ITEM_BOOM] = { dur: 0.6, gain: 0.28, minInterval: 0.09, maxVoices: 2, pitchVar: 1, priority: 1 }; // « Explosion.wav », +5 demi-tons
AUDIO.sounds[SFX.ITEM_PROC] = { dur: 0.25, gain: 0.14, minInterval: 0.08, maxVoices: 2, pitchVar: 1, priority: 0 }; // « Impact sur un robot.wav », +7 demi-tons
AUDIO.sounds[SFX.ITEM_SHIELD] = { dur: 0.45, gain: 0.3, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 }; // « Coup arrêté par le bouclier du blindé.wav », −5 demi-tons
AUDIO.sounds[SFX.ITEM_GET] = { dur: 0.7, gain: 0.3, minInterval: 0.1, maxVoices: 1, pitchVar: 0, priority: 2 }; // « Choix d'un bonus.wav », +9 demi-tons (§ E2.J)
//#endregion e2:F-objets-passifs

//#region e2:G-difficulte
// Chantier G, partie 1 (§ E2.G bis) — retours de Femz du 15/11/2026.
// G1. Fin de vague : le butin resté au sol n'est plus aspiré d'office. Exceptions toujours gardées (aspirées) : butin et
// coffre du boss, coffre de rattrapage (lateDrop), tout coffre au sol si le joueur est en retard sur le calendrier
// d'armes, butin déjà attiré par le héros. mode : 'aucune' (validé par Femz : « perdu en entier ») | 'rayon' | 'tout'.
export const END_LOOT = {
  mode: 'aucune',
  radius: 8, // m — mode 'rayon' : seul le butin à moins de radius du héros est aspiré
  blinkSeconds: 5, // le butin qui sera perdu clignote sous ce chrono (et pendant la prolongation d'une vague de boss)
  blinkHz: 3,
  fastHz: 6, // plus vite…
  fastSeconds: 2, // …sous ce chrono
  blinkScale: 0.6, // phase « éteinte » : taille × blinkScale…
  blinkFlash: 0.9, // …et éclair blanc (jamais invisible)
  voxelsPerLoot: 2, // voxels de purge par gemme ou fragment perdu…
  maxLootVoxels: 240, // …au plus ce total pour tout le butin d'une fin de vague
  voxelsPerChest: 14,
  lootVoxelScale: 0.45, // × la taille des voxels d'un rôdeur
  chestVoxelScale: 1.3,
};
/** Drapeaux d'un coffre (chests.dropAt) : EXACT = lots tous de sa rareté ; KEEP = toujours aspiré en fin de vague. */
export const CHEST_FLAG = Object.freeze({ EXACT: 1, KEEP: 2 });
// G2. Rareté par élite porteuse : tirée à sa sortie, annoncée par la couleur de son anneau et par la bannière ; les lots
// de son coffre sont tous de cette rareté (la Puce de chance peut en monter un d'un rang). Brut, Compilé, Optimisé, Chiffré.
export const CARRIER_RARITY = {
  weights: [
    { to: 4, w: [62, 30, 7, 1] },
    { to: 9, w: [48, 32, 15, 5] },
    { to: 14, w: [38, 33, 20, 9] },
    { to: Infinity, w: [30, 32, 24, 14] },
  ],
  labels: ['CACHE BRUTE', 'CACHE COMPILÉE', 'CACHE OPTIMISÉE', 'CACHE CHIFFRÉE'],
  ringGain: [1.6, 1.6, 1.8, 2.0], // × RARITIES[r].color (anneau additif sur le sol vert : réglé sur la planche)
};
/** Rareté d'une porteuse à la vague n : r ∈ [0, 1) → RARITY.BRUT … CHIFFRE. */
export function carrierRarity(wave, r) {
  const T = CARRIER_RARITY.weights;
  let row = T[T.length - 1];
  for (let k = 0; k < T.length; k++) {
    if (wave <= T[k].to) {
      row = T[k];
      break;
    }
  }
  let sum = 0;
  for (let k = 0; k < row.w.length; k++) sum += row.w[k];
  let x = r * sum;
  for (let k = 0; k < row.w.length; k++) {
    if (x < row.w[k]) return k;
    x -= row.w[k];
  }
  return row.w.length - 1;
}
// § E2.S S5 — difficulté, première passe (le jeu mesuré était trop dur TÔT : débutant mort à la vague 1). Facteurs
// appliqués par waves.startWave aux robots de la vague (PV, dégâts, minimum en vie), PAR-DESSUS les formules du cahier
// (waveHpMul, waveDmgMul, waveMinAlive : inchangées). Boss et invocations du boss : non touchés. Réglé par les
// joueurs-robots du vrai jeu (tests/e2-difficulte-jeu.mjs).
export const DIFFICULTY = {
  targets: { beginnerBossWave: 5, beginnerRate: 0.8, fleeMinWave: 3, fleeMaxWave: 8, goodMedian: [18, 25] }, // § E2.G
  // prise en main : vagues 1 à `waves`, un facteur par vague et par levier.
  // hp : un rôdeur (20 PV × waveHpMul) reste à ≤ 10 PV jusqu'à la vague 4, tué d'un tir du blaster de départ ; puis
  // retour progressif à la formule du cahier (facteur 1 dès la vague ease.waves + 1)
  ease: {
    waves: 8,
    hp: [0.5, 0.44, 0.4, 0.36, 0.45, 0.6, 0.75, 0.9],
    dmg: [0.4, 0.4, 0.45, 0.45, 0.55, 0.7, 0.8, 0.9],
    alive: [0.55, 0.55, 0.6, 0.6, 0.7, 0.8, 0.9, 0.95],
  },
  // croissance PAR VAGUE à partir de `from` (facteur ^ (n − from + 1)) ; 1 = neutre
  growth: { from: 6, hp: 1, dmg: 1, alive: 1 },
};
/** Facteur de difficulté de la vague n pour le levier 'hp' | 'dmg' | 'alive' (§ E2.S S5). Pure. */
export function threatMul(n, lever) {
  const D = DIFFICULTY;
  if (n >= 1 && n <= D.ease.waves) {
    const t = D.ease[lever];
    return t !== undefined && t[n - 1] !== undefined ? t[n - 1] : 1;
  }
  const g = D.growth[lever];
  if (g === undefined || g === 1) return 1;
  const k = n - D.growth.from + 1;
  return k > 0 ? Math.pow(g, k) : 1;
}
//#endregion e2:G-difficulte

// Plan addictif, étape 3 (ARCHITECTURE.md § E3.0.1) : une région par chantier, créées vides le 15/11/2026. Un chantier
// n'écrit que dans SA région. Ordre = ordre d'évaluation : le 2e groupe (B, F, H, I, M) lit les tables du 1er.
//#region e3:A-elites-coffres
// =====================================================================================================
// Plan addictif, étape 3, chantier A (ARCHITECTURE.md § E3.A) — élites porteuses à modificateurs, raretés Noyau et
// Root, coffres de 1, 3 ou 5 lots (3 et 5 : le gros lot, tous gagnés). Premier réglage SUPPOSÉ (calculé, pas joué).
// =====================================================================================================
/** Modificateur d'une élite porteuse (E.mod, u8 ; 0 = aucun). docs/contenu-vampire-survivors.md § 4.6. */
export const ELITE_MOD = Object.freeze({ NONE: 0, SURCHARGE: 1, REGEN: 2, BOUCLIER: 3, COUVEUSE: 4, INSTABLE: 5, PHASE: 6 });
export const ELITE_MOD_COUNT = 7;
export const ELITES = {
  // chance qu'une porteuse ait un modificateur : 0 avant la vague `from`, puis linéaire jusqu'à 1 à la vague `to`
  modChance: { from: 6, to: 14 },
  // index = ELITE_MOD.* ; from = première vague où il peut sortir. name : bannière « ÉLITE DÉTECTÉE : <name> »
  mods: [
    { key: 'none', name: '', from: Infinity },
    // vitesse × speedMul ; une traînée HAZ.SPARK toutes les trailEvery s, qui blesse (dmgMul × dégâts de contact) au
    // plus une fois par tic de flaque, pendant trailLife s
    { key: 'surcharge', name: 'SURCHARGÉ', from: 6, speedMul: 1.5, trailEvery: 0.18, trailRadius: 0.75, trailLife: 1, dmgMul: 0.35 },
    { key: 'regen', name: 'RÉGÉNÉRANT', from: 6, hpPerSecond: 0.03 }, // + 3 % des PV max par seconde
    { key: 'bouclier', name: 'GÉNÉRATEUR DE BOUCLIER', from: 7, radius: 5, damageMul: 0.5 }, // robots à ≤ 5 m (lui compris)
    { key: 'couveuse', name: 'COUVEUSE', from: 8, every: 6, drones: 4 }, // 4 drones toutes les 6 s (plafond de E respecté)
    // 6 obus HAZ.STRIKE en couronne à la mort, annoncés telegraph s ; dégâts = dmgMul × dégâts de contact de l'élite
    { key: 'instable', name: 'INSTABLE', from: 9, shells: 6, ring: 3.2, radius: 2.0, telegraph: 1.2, dmgMul: 1.2 },
    { key: 'phase', name: 'PHASÉ', from: 10, period: 4, phaseSeconds: 1 }, // intangible 1 s toutes les 4 s
  ],
  // Raretés hautes des porteuses (règle 3) : dès la vague `from`, Noyau puis Root avec ces chances (en %) ; au plus
  // une Root par vague. Le tirage se fait AVANT celui des raretés de l'étape 2 (carrierRarity), qui reste le repli.
  rarityHigh: { from: 11, w: [6, 2] },
  // Taille du coffre (règle 4) : Brut à Optimisé → 1 ; Chiffré → 3 avec chiffreBig, sinon 1 ; Noyau → 3 ; Root → 5 ;
  // boss de rang 1 → 3, de rang ≥ 2 → 5. floor[k] : rareté minimale des lots d'un coffre de k lots.
  chestSize: { chiffreBig: 0.5, noyau: 3, root: 5, boss1: 3, boss2: 5, floor3: RARITY.OPTIMISE, floor5: RARITY.CHIFFRE },
  maxLots: 5,
  // Icône au-dessus de l'élite (règle 2) : quad toujours tourné vers la caméra, à `lift` m au-dessus du sommet du
  // robot (hauteur du type × taille de porteuse) ; px : taille du pixel de la grille (12 × 12) dans la texture.
  icon: { size: 0.95, lift: 0.55, px: 8, edge: 0xff3b4e, phaseBlinkHz: 14, bubbleY: 0.06, bubbleGain: 0.85, bubbleColor: 0x9fe8ff },
  bannerSeconds: 2.6,
  // Gros lot (règle 5) : les bandes s'arrêtent une à une ; arpège d'un demi-ton par bande, puis le son du gros lot ;
  // pluie de fragments en DOM (frags éléments, FRAG_RAIN rejoué fragSounds fois, hauteur qui monte de fragStep).
  jackpot: { stagger: 0.42, firstStop: 1.0, holdSeconds: 0.7, semitone: 1, frags: 36, fragSounds: 8, fragEvery: 0.07, fragStep: 1, lead: 'Tout est à vous.', title: 'GROS LOT', take: 'Entrée : tout prendre' },
};
// Pas de drapeau gelé touché : constante à côté de CHEST_FLAG (comme LOT_EVOLUTION, § E3.0.2). Coffre du boss.
export const CHEST_FLAG_BOSS = 4;
// Noyau et Root ont leur anneau, leur bannière (tables de l'étape 2 allongées, à l'évaluation du module).
CARRIER_RARITY.labels.push('CACHE NOYAU', 'CACHE ROOT');
CARRIER_RARITY.ringGain.push(1.7, 1.9);
/**
 * Icônes des 6 modificateurs (12 × 12, « # » = pixel allumé, liseré rouge ajouté au rendu) et cercle de la bulle du
 * Générateur de bouclier (case 7 de l'atlas). Index = ELITE_MOD.* (case 0 inutilisée).
 */
export const ELITE_MOD_ICONS = [
  null,
  // Surchargé : un éclair
  ['......####..', '.....####...', '....####....', '...####.....', '..########..', '...#######..', '......###...', '.....###....', '....###.....', '...##.......', '..#.........', '............'],
  // Régénérant : une croix
  ['....####....', '....####....', '....####....', '....####....', '############', '############', '############', '############', '....####....', '....####....', '....####....', '....####....'],
  // Générateur de bouclier : un écu
  ['.##########.', '############', '############', '############', '############', '.##########.', '.##########.', '..########..', '..########..', '...######...', '....####....', '.....##.....'],
  // Couveuse : trois petits drones
  ['....####....', '...######...', '....####....', '............', '.####..####.', '######.#####', '.####..####.', '............', '....####....', '...######...', '....####....', '............'],
  // Instable : une bombe
  ['........#.#.', '.......#.#..', '......##....', '....####....', '..########..', '.##########.', '.###..#####.', '.###.######.', '.##########.', '.##########.', '..########..', '....####....'],
  // Phasé : deux silhouettes décalées
  ['...###......', '..#####.....', '..#####.###.', '...###.#####', '.......#####', '.#####..###.', '#######.....', '#######.###.', '#######.###.', '......#####.', '.....#######', '.....#######'],
];
// Sons (§ E3.0.7) : candidats découpés dans « sfx game » (outils/preparer_sons.py), à faire valider par Femz.
AUDIO.sounds[SFX.ELITE_MOD] = { dur: 0.5, gain: 0.3, minInterval: 0.5, maxVoices: 1, pitchVar: 0, priority: 2 }; // « Alarme d'arrivée.wav », +5
AUDIO.sounds[SFX.JACKPOT] = { dur: 1.4, gain: 0.35, minInterval: 0.3, maxVoices: 1, pitchVar: 0, priority: 2 }; /* fusion du groupe 1 : priorité 2 (« rare et important ») — 3 et 4 n'existent pas, audio.js les rangeait en 0 (bruit de combat) */ // « Nouveau record.wav », +2
AUDIO.sounds[SFX.FRAG_RAIN] = { dur: 0.25, gain: 0.2, minInterval: 0.04, maxVoices: 3, pitchVar: 0, priority: 1 }; // « Fragment.wav », +7
/** Chance (0…1) qu'une porteuse de la vague n ait un modificateur. */
export function eliteModChance(n) {
  const C = ELITES.modChance;
  if (n < C.from) return 0;
  return Math.min(1, (n - C.from + 1) / (C.to - C.from + 1));
}
/** Taille du coffre (1, 3 ou 5) : rareté de la porteuse (ou du boss), r ∈ [0, 1) pour la part « Chiffré → 3 ». */
export function eliteChestSize(rarity, isBoss, rank, r) {
  const S = ELITES.chestSize;
  if (isBoss) return rank >= 2 ? S.boss2 : S.boss1;
  if (rarity >= RARITY.ROOT) return S.root;
  if (rarity === RARITY.NOYAU) return S.noyau;
  if (rarity === RARITY.CHIFFRE) return r < S.chiffreBig ? 3 : 1;
  return 1;
}
//#endregion e3:A-elites-coffres

//#region e3:C-decors-utilitaires
// Plan addictif, étape 3, chantier C (ARCHITECTURE.md § E3.C) : décors cassables (src/props.js) et six utilitaires
// à effet immédiat au ramassage (src/utilities.js). Premier réglage SUPPOSÉ (calculé, pas joué) ; mesures au § E3.C.
/** Utilitaires : bonus uniques ramassés au sol, effet immédiat (§ E3.C). */
export const UTIL = Object.freeze({ BATTERY: 0, MAGNET: 1, IEM: 2, STUN: 3, TURBO: 4, COMPUTE: 5 });
export const UTIL_COUNT = 6;
/** Source d'un utilitaire lâché (utilities.dropAt) : taux et compteurs séparés. */
export const UTIL_SOURCE = Object.freeze({ PROP: 0, KILL: 1, DEBUG: 2 });
CAPS.props = 24; // décors cassables posés en même temps (DECORS.count au plus)
CAPS.utilities = 16; // utilitaires au sol en même temps (au-delà : le plus ancien laisse sa place)
export const DECORS = {
  count: 14, // bornes posées au début de chaque vague (repousse jusqu'à ce nombre)
  hp: 3, // coups pour casser une borne (un coup = un impact, quel que soit son montant)
  hitCooldown: 0.15, // s — une borne touchée ignore les coups suivants pendant ce temps (un tir qui la traverse = 1 coup)
  radius: 0.75, // m — rayon de collision des tirs, explosions et du héros
  height: 1.1, // m — hauteur posée du modèle (borne-pv.glb déclare 1,25 m : posée à 0,88 ×, comme l'ancienne borne)
  clearStart: 9, // m — aucune borne à moins de ce rayon du centre (départ du héros)
  clearHero: 7, // m — ni à moins de ce rayon du héros quand elles repoussent
  gap: 1.6, // m — écart minimal avec un obstacle et entre deux bornes
  edge: 4, // m — marge au bord de l'arène
  respawnPerWave: 14, // bornes rajoutées au plus à chaque nouvelle vague (jusqu'à count)
  contactBreaks: true, // le héros qui fonce dedans (marche ou dash) la casse d'un coup
  // Femz, 20/11 soir (docs/conception-caisses-parefeu.md § 2) : une borne cassée lâche TOUJOURS une Batterie de 25, 50
  // ou 75 PV (poids 60 / 30 / 10 %), teinte de sa rareté et taille × taille[palier] ; plus de fragments ni d'autre
  // utilitaire (les robots tués lâchent toujours tous les utilitaires, Batterie à UTILITIES.battery.heal compris)
  drop: {
    batteries: [
      { pv: 25, poids: 0.6, rarete: RARITY.BRUT },
      { pv: 50, poids: 0.3, rarete: RARITY.COMPILE },
      { pv: 75, poids: 0.1, rarete: RARITY.OPTIMISE },
    ],
    taille: [1, 1.2, 1.4],
  },
  model: 'borne-pv.glb', // outils/blender/borne_pv.py → assets/modeles/ (22/11 : cellule d'énergie, croix verte)
  glow: 0x5cff8a, // couleur des émissifs du modèle (croix et jauges vertes = Batterie)
  hitFlash: 0.6, // flash blanc au coup (aFx.x), éteint en flashSeconds
  flashSeconds: 0.12,
  voxels: 14, // voxels « programmes » du pool d'éclats à la casse (fx.spawnPurgeLootF)
  shake: 0.12, // secousse à la casse
};
export const UTILITIES = {
  // ordre = UTIL.* ; name = texte à l'écran (« Overclock » et « Aimant à fragments » sont des objets : noms distincts)
  list: [
    { key: 'battery', name: 'BATTERIE', color: 0x5cff8a },
    { key: 'magnet', name: 'AIMANT', color: 0xff5f6d },
    { key: 'iem', name: 'I.E.M', color: 0x7fe8ff },
    { key: 'stun', name: 'DÉCHARGE', color: 0xffe14a },
    { key: 'turbo', name: 'OVERCLOCKING', color: 0xff9a3d },
    { key: 'compute', name: 'PUISSANCE DE CALCUL', color: 0xc08cff },
  ],
  // chance PAR SOURCE et par id (une seule tirée par événement : la somme est la chance d'en lâcher un)
  dropFrom: {
    prop: [0.34, 0.12, 0.08, 0.14, 0.18, 0.14], // tirage SI la borne lâche un utilitaire (DECORS.drop.utilChance), normalisé
    kill: [0.0012, 0.0004, 0.00025, 0.0005, 0.0008, 0.0007], // par robot tué (hors purge, hors mort sans butin) : ≈ 1 / 260
  },
  capPerWave: 6, // utilitaires lâchés au plus par vague, toutes sources confondues
  capPerId: [3, 1, 1, 2, 2, 2], // et par id (I.E.M et Aimant plus rares)
  groundSeconds: 30, // s au sol avant de disparaître ; il clignote ses blinkSeconds dernières secondes
  blinkSeconds: 3,
  blinkHz: 5,
  pickupRadius: 1.3, // m — ramassé au contact du héros (pas aspiré par le rayon de collecte : il faut aller le chercher)
  size: 1.05, // m — côté de la pastille au sol (icône dans un cadre FUI)
  y: 0.75, // m — hauteur de la pastille (flotte, rebondit à la chute)
  bob: 0.08,
  bobHz: 1.1,
  scatter: 1.0, // m — écart du point de chute autour du robot ou de la borne
  battery: { heal: 35 }, // PV rendus (PV max de départ : 100 ou 140)
  magnet: { speed: 30, chests: true }, // m/s : butin de TOUTE l'arène aspiré (gemmes, fragments, coffres)
  iem: { lootMax: 40, shake: 0.55, punch: 0.06, hitstop: 0.08, rings: 3, ringRadius: 26, ringSeconds: 0.7, ringDelay: 0.08, onScreenMargin: 0 },
  stun: { seconds: 3, arcs: 32, onScreenMargin: 0, boss: false }, // vitesse 0, aucun tir ni contact ; le boss n'est pas étourdi
  turbo: { seconds: 10, speedMul: 1.3, dmgMul: 1.5 },
  compute: { seconds: 10, perHit: 1, maxPerSecond: 12 }, // fragments crédités par coup porté, plafonnés par seconde
  hud: { lowSeconds: 3 }, // effet affiché en alerte sous ce temps
};
// Icônes 12 × 12, pixel 1-bit (HUD et pastille au sol), comme ITEM_ICONS
export const UTILITY_ICONS = {
  'sr-u-battery': ['....####....', '...######...', '..#......#..', '..#......#..', '..#.####.#..', '..#.####.#..', '..#......#..', '..#.####.#..', '..#.####.#..', '..#......#..', '..########..', '............'],
  'sr-u-magnet': ['............', '.####..####.', '.####..####.', '.##......##.', '.##......##.', '.##......##.', '.##......##.', '.###....###.', '..###..###..', '...######...', '....####....', '............'],
  'sr-u-iem': ['....####....', '..##....##..', '.#..####..#.', '.#.#....#.#.', '#.#..##..#.#', '#.#.####.#.#', '#.#.####.#.#', '#.#..##..#.#', '.#.#....#.#.', '.#..####..#.', '..##....##..', '....####....'],
  'sr-u-stun': ['......##....', '.....##.....', '....##......', '...##.......', '..########..', '......##....', '.....##.....', '....##......', '...##.......', '..##........', '.##.........', '............'],
  'sr-u-turbo': ['............', '.##....##...', '..##....##..', '...##....##.', '....##....##', '.....##....#', '....##....##', '...##....##.', '..##....##..', '.##....##...', '............', '............'],
  'sr-u-compute': ['..#..#..#...', '..#..#..#...', '.#########..', '.#.......#..', '##.#####.###', '.#.#...#.#..', '##.#.#.#.###', '.#.#...#.#..', '##.#####.###', '.#.......#..', '.#########..', '..#..#..#...'],
};
// Sons (§ E3.0.7) : découpes de SA banque, candidats à faire valider par Femz
AUDIO.sounds[SFX.PROP_BREAK] = { dur: 0.4, gain: 0.3, minInterval: 0.06, maxVoices: 3, pitchVar: 2, priority: 2 }; // « Mort.wav », 0,4 s, −3 demi-tons
AUDIO.sounds[SFX.UTIL_PICK] = { dur: 0.4, gain: 0.35, minInterval: 0.1, maxVoices: 2, pitchVar: 0, priority: 2 }; /* fusion du groupe 1 : priorité 2 (« rare et important ») — 3 et 4 n'existent pas, audio.js les rangeait en 0 (bruit de combat) */ // « Gemme.wav », 0,4 s, −2
AUDIO.sounds[SFX.UTIL_IEM] = { dur: 0.9, gain: 0.55, minInterval: 0.3, maxVoices: 1, pitchVar: 0, priority: 2 }; /* fusion du groupe 1 : priorité 2 (« rare et important ») — 3 et 4 n'existent pas, audio.js les rangeait en 0 (bruit de combat) */ // « Champ EMP.wav », 0,9 s, −5
AUDIO.sounds[SFX.UTIL_STUN] = { dur: 0.5, gain: 0.45, minInterval: 0.3, maxVoices: 1, pitchVar: 0, priority: 2 }; /* fusion du groupe 1 : priorité 2 (« rare et important ») — 3 et 4 n'existent pas, audio.js les rangeait en 0 (bruit de combat) */ // « Coup arrêté par le bouclier du blindé.wav », 0,5 s, +2
AUDIO.sounds[SFX.UTIL_TURBO] = { dur: 0.6, gain: 0.45, minInterval: 0.3, maxVoices: 1, pitchVar: 0, priority: 2 }; /* fusion du groupe 1 : priorité 2 (« rare et important ») — 3 et 4 n'existent pas, audio.js les rangeait en 0 (bruit de combat) */ // « Dash rechargé.wav », 0,6 s, −4
//#endregion e3:C-decors-utilitaires

//#region e3:D-nouveaux-robots
// =====================================================================================================
// Étape 3, chantier D (15/11/2026, ARCHITECTURE.md § E3.D) — quatre robots nouveaux : Foreuse, Poseur, Scanner,
// Diviseur. Comportements : src/enemies-e3.js ; modèles : outils/blender/robots_e3.py → assets/modeles/robot-<clé>.glb.
// Chiffres SUPPOSÉS (calculés, pas joués). Calendrier : les vagues 12, 14, 17 et 19 de l'étude (§ 4.9) portent déjà
// une révision (drones v2, kamikazes v2, réparateurs v2, drones v3) : « une nouveauté par vague », donc décalés aux
// premières vagues libres après le boss de la vague 20 : 21, 22, 23, 24.
// Champs libres de E pour ces types (src/enemies-e3.js) : state = phase, timer = minuterie de la phase, cd = recharge,
// ai0 = cible z (foreuse) ou sens du pas de côté (poseur), rev0 = cible x (foreuse) ou angle du laser (scanner),
// ai1 = décalage vertical dessiné (m ; < 0 enfoui, > 0 en chute), gen = génération d'un mini-rôdeur du diviseur.
// =====================================================================================================
const E3_TYPE = (o) => ({
  hover: 0,
  fragChance: 0.35,
  fragValue: 8,
  castShadow: false, // ombre de contact (§ E3.0.6 : l'ombre portée ne s'allume qu'après mesure, à la fusion du groupe 1)
  bodyColor: PALETTE.robot,
  accentColor: PALETTE.robotDark,
  specialWaveEligible: false, // une vague « que des scanners » ou « que des diviseurs » n'est pas jouable : jamais spéciaux
  ...o,
});
ENEMIES.types.push(
  E3_TYPE({
    id: ENEMY.FOREUSE, key: 'foreuse', name: 'Foreuse', unlockWave: 21,
    hp: 34, speed: 3.1, radius: 0.5, height: 0.85, contactDmg: 9, mass: 1.2, gemXp: 16,
    eyeColor: PALETTE.eyeTireur, glowColor: PALETTE.eyeTireur, // yeux jaunes (étude § 4.9), cône foreur : la forme la distingue du tireur
    weight: { base: 2, perWave: 0.3, maxShare: 0.08 },
    anim: { bobHz: 2.6, bobAmp: 0.05, swayAmp: 0.06, lean: 0.12, glide: false },
  }),
  E3_TYPE({
    id: ENEMY.POSEUR, key: 'poseur', name: 'Poseur', unlockWave: 22,
    hp: 40, speed: 2.9, radius: 0.62, height: 0.95, contactDmg: 6, mass: 1.4, gemXp: 18,
    eyeColor: PALETTE.eyeKamikaze, glowColor: PALETTE.eyeKamikaze, // orange des explosifs (kamikaze), plat et large, antenne
    // il garde ses distances comme un tireur (même tronc commun : enemies.js lit ranged.keepMin… à l'init)
    ranged: { keepMin: 7, keepMax: 11, strafeMul: 0.55, retreatMul: 1.15 },
    weight: { base: 2, perWave: 0.25, maxShare: 0.06 },
    anim: { bobHz: 3.2, bobAmp: 0.03, swayAmp: 0.05, lean: 0.03, glide: false },
  }),
  E3_TYPE({
    id: ENEMY.SCANNER, key: 'scanner', name: 'Scanner', unlockWave: 23,
    hp: 70, speed: 0, radius: 0.7, height: 1.6, contactDmg: 6, mass: 50, gemXp: 26,
    eyeColor: PALETTE.robotEye, glowColor: PALETTE.robotEye, // rouge du laser : le danger ; tourelle à trois pieds
    weight: { base: 1, perWave: 0.15, maxShare: 0.04 },
    anim: { bobHz: 1.2, bobAmp: 0.0, swayAmp: 0.0, lean: 0.0, glide: false }, // immobile : il ne marche pas
  }),
  E3_TYPE({
    id: ENEMY.DIVISEUR, key: 'diviseur', name: 'Diviseur', unlockWave: 24,
    hp: 60, speed: 2.6, radius: 0.66, height: 1.25, contactDmg: 10, mass: 1.3, gemXp: 8, // ses 12 descendants donnent le reste (butin de rôdeur)
    eyeColor: PALETTE.robotEye, glowColor: PALETTE.eyeReparateur, // sphère segmentée, yeux rouges ; lueur = soin reçu
    weight: { base: 2, perWave: 0.3, maxShare: 0.08 },
    anim: { bobHz: 2.0, bobAmp: 0.06, swayAmp: 0.08, lean: 0.05, glide: false },
  }),
);
Object.assign(MODELES.robots, {
  foreuse: 'robot-foreuse.glb',
  poseur: 'robot-poseur.glb',
  scanner: 'robot-scanner.glb',
  diviseur: 'robot-diviseur.glb',
});
CAPS.robotMines = 24; // mines de poseurs au sol en même temps (dans le pool CAPS.hazards de src/hazards.js)
HAZARDS.telegraphSoundKinds.push(HAZ.DRILL); // le cercle de la foreuse s'annonce comme un obus (bip du télégraphe)

/** Réglages des comportements (src/enemies-e3.js). Dégâts × multiplicateur de vague (E.mul), comme le reste. */
export const E3_ROBOTS = {
  foreuse: {
    burrowDist: 11, // m : à moins de cette distance du joueur (et recharge prête), elle s'enfouit
    minDist: 2.5, // m : au contact, elle ne s'enfouit pas
    digSeconds: 0.35, // s pour disparaître dans le sol
    depth: 1.5, // m sous le sol une fois enfouie (dessin)
    tunnelSpeed: 9, // m/s sous terre, vers le joueur (traînée de poussière)
    tunnelMax: 2.0, // s au plus sous terre avant de viser
    aimDist: 1.2, // m : assez près, elle vise tout de suite
    warn: 0.8, // s : cercle HAZ.DRILL télégraphié sous le joueur, puis elle resurgit au centre
    drillRadius: 1.4, // m : rayon du cercle et de la zone blessée à la sortie
    emergeSeconds: 0.3, // s de sortie (dessin)
    emergeDmg: 16, // dégâts au joueur dans le cercle à la sortie
    every: 5.5, // s de recharge après une sortie
    firstDelay: 1.2, // s avant la première plongée
    buriedRadius: 0.05, // m : rayon de collision enfouie (ni poussée par la meute, ni au contact du joueur)
    dustEvery: 0.09, // s entre deux bouffées de poussière sous terre
    dustColor: 0xc9b48a, // poussière de sol (teinte du sable de la DA)
    trauma: 0.22,
  },
  poseur: {
    every: 2.6, // s entre deux mines
    firstDelay: 1.6,
    arm: 0.7, // s avant qu'une mine ne soit armée (le poseur s'éloigne)
    life: 14, // s de vie d'une mine non déclenchée (elle s'éteint)
    radius: 0.55, // m : disque dessiné
    trigger: 0.9, // m : un joueur ou un robot (hors poseurs) à cette distance la déclenche
    blast: 2.0, // m : rayon de l'explosion
    playerDmg: 14,
    robotDmg: 45, // les robots aussi : on peut les y attirer (source DMG_SRC.EVENT : comptés pour le joueur)
    knockback: 5,
    blinkHz: 1.6, // clignotement une fois armée (Hz)
    trauma: 0.18,
  },
  scanner: {
    landMin: 6, // m : point de chute tiré autour du joueur, dans l'écran
    landMax: 9,
    fallHeight: 9, // m
    fallSeconds: 0.8, // s de chute (repère HAZ.MARK au sol pendant ce temps)
    landRadius: 1.3, // m : écrasé sous la capsule
    landDmg: 10,
    firstPause: 0.9, // s entre l'atterrissage et la première annonce
    warn: 0.9, // s : trait télégraphié dans l'axe où le laser va partir
    sweepSeconds: 2.6, // s de balayage
    omega: 1.6, // rad/s : vitesse de rotation du laser (≈ 240° par balayage) ; sens alterné d'un balayage à l'autre
    pause: 2.2, // s entre deux balayages
    length: 9, // m : portée du laser
    beamR: 0.34, // m : rayon de la tête du rayon (lot ENNEMIS, style ENNEMI) ; demi-largeur touchée = 0,7 × beamR × (1 − d / length) + rayon du joueur
    beamY: 1.25, // m : hauteur du rayon
    dmg: 12, // par tic
    tick: 0.5, // s entre deux tics sur le joueur
    trauma: 0.25,
  },
  diviseur: {
    children: 3, // mini-rôdeurs à chaque scission
    ring: 0.7, // m : cercle où ils naissent
    // génération 1 (enfants du diviseur) et 2 (petits-enfants, qui ne se scindent plus) : PV × hpMul (de ceux du
    // parent rapportés au rôdeur), taille × scale, vitesse × speedMul
    gens: [
      { hpMul: 0.4, scale: 0.72, speedMul: 1.15 },
      { hpMul: 0.22, scale: 0.52, speedMul: 1.3 },
    ],
  },
};

// Sons (socle E3, § E3.0.7) : découpes de la banque « sfx game » de Femz (outils/preparer_sons.py), CANDIDATS à valider.
AUDIO.sounds[SFX.DRILL] = { dur: 0.8, gain: 0.3, minInterval: 0.15, maxVoices: 3, pitchVar: 1, priority: 2 };
AUDIO.sounds[SFX.MINE_ENEMY] = { dur: 0.2, gain: 0.22, minInterval: 0.12, maxVoices: 3, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.SCAN_LASER] = { dur: 0.9, gain: 0.26, minInterval: 0.3, maxVoices: 2, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.SPLIT] = { dur: 0.3, gain: 0.24, minInterval: 0.06, maxVoices: 4, pitchVar: 1, priority: 1 };
//#endregion e3:D-nouveaux-robots

//#region e3:J-refonte-ui
// Interface carte mère (ARCHITECTURE.md § E3.J, référence de Femz tests/.cache/retours-femz/1511-ref-hud-carte-mere.png).
// Les mesures de mise en page vivent dans ui.css (en rem, relevées sur la référence) ; ici, ce qui se règle en jouant.
// puce : la puce CPU du HUD bat plus fort et plus vite à mesure qu'on porte des objets. t = min(1, perItem × objets +
//   perStack × min(piles, stackCap)) ; intensité (opacité crête de la lueur) = kMin → kMax, fréquence hzMin → hzMax ;
//   t est arrondi à 1/steps : le DOM n'est réécrit que quand ce cran change (§ E3.0.5 règle 2). Supposé (réglé sur
//   planches, pas joué) : douce à 0 objet (0,18 à 0,45 Hz), bien visible à 6 objets chargés (≈ 0,8 à 1,4 Hz).
export const UI_CARTE = {
  puce: { kMin: 0.18, kMax: 0.95, hzMin: 0.45, hzMax: 1.6, perItem: 0.12, perStack: 0.28 / 30, stackCap: 30, steps: 32, creux: 0.25 },
};
//#endregion e3:J-refonte-ui

//#region e3:K-survivants-reportes
// Étape 3, chantier K (ARCHITECTURE.md § E3.K) — SURVIVANTS REPORTÉS, décision de Femz du 15/11 (FEMZ_1511E). À zéro,
// plus de purge : les robots en vie passent dans la vague suivante. Figés (« en veille ») pendant la fin de vague, les
// choix, le coffre, la boutique et le compte à rebours ; repoussés hors de safeRadius au départ ; au-delà de `cap`, les
// excédents sont fusionnés deux à deux par type (PV additionnés : la menace ne disparaît jamais). Premier réglage
// SUPPOSÉ, mesuré par tests/e2-difficulte-jeu.mjs (profil « fuite », « bon joueur »).
export const CARRY = {
  // m — au départ de la vague suivante, aucun reporté plus près du héros (au-delà, déplacé hors écran comme un
  // traînard : enemies.relocateF, nombre gardé). 16 m ≈ le bord haut de l'écran en 16:9 (viewHeight 32).
  safeRadius: 16,
  // s — après « GO », les reportés restent en veille encore un instant (le compte à rebours de 3 s est le répit
  // visible ; ceci laisse au héros le temps de lire la scène). Les robots NEUFS de la vague ne sont pas concernés.
  graceSeconds: 0.5,
  // Plafond des reportés : au-delà, fusion. WAVES.maxAlive (400, perf de l'étape 1) − cap = la place laissée à la
  // vague suivante pour ses grappes à intervalle et son minimum en vie.
  cap: 260,
  mergeDmgMul: 1, // dégâts du fusionné = (dégâts A + dégâts B) × mergeDmgMul — « PV et dégâts cumulés » (mots de Femz)
  mergeScale: 1.2, // × la taille du corps chaque fois que le nombre de corps fondus double…
  mergeScaleMax: 1.9, // …au plus × ceci (un fusionné reste lisible et passe entre les rochers)
  sleepEyeGain: 0.25, // × l'émissif des yeux d'un robot en veille (uniforme du type : tous les vivants sont en veille)
  // § E5.X4 (audit F5, Femz 22/11 « go pour l'étape ») : « PURGE INCOMPLÈTE / N PROGRAMMES PERSISTENT » était du jargon,
  // en rouge danger ; « FUSION » reprenait le mot des objets. Dit en mots de joueur, couleur neutre (ui.js : sr-reste).
  kicker: 'VAGUE SUIVANTE : ', // petite ligne au-dessus (ui.showBanner coupe à « : »)
  banner: ' ROBOTS RESTENT', // « 37 ROBOTS RESTENT » (rien si 0)
  bannerOne: ' ROBOT RESTE',
  mergeBanner: ' ROBOTS REGROUPÉS', // seconde bannière quand des robots ont été fondus : « TROP DE ROBOTS / 12 ROBOTS REGROUPÉS »
  mergeKicker: 'TROP DE ROBOTS : ',
  bannerSeconds: 2.2,
};
// Échelle du corps d'un fusionné selon E.merged (corps absorbés, 0 à 255) : × mergeScale à chaque doublement du nombre
// de corps, bornée à mergeScaleMax. Table écrite ici une fois (lue par enemies.mergeExcessF et anim/allure.js).
export const CARRY_SCALE = new Float32Array(256);
for (let m = 0; m < 256; m++) {
  const s = Math.pow(CARRY.mergeScale, Math.log2(m + 1));
  CARRY_SCALE[m] = s < CARRY.mergeScaleMax ? s : CARRY.mergeScaleMax;
}
// Plus de sbires tués à la mort du boss (§ J.4 remplacé) : ils sont reportés comme les autres (§ E3.K règle 4).
BOSS.death.killMinions = false;
// « N PROGRAMMES PERSISTENT » : « Changement de phase.wav », 0,8 s (candidat, § E3.0.7), 3 dB sous « Vague terminée ».
AUDIO.sounds[SFX.CARRYOVER] = { dur: 0.8, gain: 0.3, minInterval: 0.5, maxVoices: 1, pitchVar: 0, priority: 2 };
//#endregion e3:K-survivants-reportes

//#region e3:L-camera
// § E3.L — caméra plus basse, trois réglages (FEMZ_1511F, 15/11 : « abaisser la camera comme ca, on ma dit qu'elle etait
// trop haute », « 3 reglages de camera possible »). Mesure de ses deux références (Diablo IV, Death Must Die) dans
// ARCHITECTURE.md § E3.L « Réalisé ». Projection ORTHOGRAPHIQUE gardée (justification au même endroit) : un réglage
// ne change que l'inclinaison ; la largeur vue (viewHeight × ratio) reste la même, la profondeur au sol
// (viewHeight / 2 / sin φ) grandit quand la caméra descend.
CAMERA.hauteDeg = CAMERA.pitchDeg; // 55° : la caméra d'avant le 15/11 (= réglage « Haute »)
CAMERA.reglages = [
  { key: 'haute', label: 'Haute', pitchDeg: 55 }, // l'actuelle, au degré près
  { key: 'moyenne', label: 'Moyenne', pitchDeg: 45 }, // cercle au sol de Death Must Die : rapport 0,70 → 44°
  { key: 'basse', label: 'Basse', pitchDeg: 38 }, // plus rasante que les références : profondeur au sol 26 m
];
CAMERA.reglageDefaut = 1; // « Moyenne » : la plus proche des références (Femz : « trop haute » aujourd'hui)
// pitchDeg = inclinaison au CHARGEMENT (réglage par défaut) : les modules et les tests qui lisent CAMERA.pitchDeg
// suivent ; l'inclinaison VIVANTE (changement de réglage en cours de partie) est camera.view.pitchDeg.
CAMERA.pitchDeg = CAMERA.reglages[CAMERA.reglageDefaut].pitchDeg;
// Changement de réglage : ressort critique sur l'inclinaison (solution exacte, aucun dépassement) ; l'essentiel du
// trajet en 0,4 s, posé à la valeur exacte du réglage sous 0,01° et 0,01 °/s (≈ 1 s pour 17°, mesuré par le test).
CAMERA.transition = { omega: 10, epsilon: 0.01 };
INPUT.actions.push(['KeyC']); // ACTION.CAMERA (15)
//#endregion e3:L-camera

//#region e3:N-arsenaux-agents
// =====================================================================================================
// ÉTAPE 3, CHANTIER N — un arsenal de 6 armes par agent, 6 armes nouvelles (ARCHITECTURE.md § E3.N ; FEMZ_1511G).
// =====================================================================================================
// Mêmes formes que les douze premières : 5 stats × 5 niveaux strictement croissants (node tests/equilibrage.mjs).
// Mécaniques (src/weapons-agents.js) : katana = grand arc lent à critique propre ; grenades = lancées en cloche sur les
// paquets, explosion ; fumigènes = nuage qui ralentit (aveugle) et rend critiques les coups du Shinobi ; frappe éclair =
// le héros file de « distance » m dans sa direction de marche en tranchant la ligne ; grosse tourelle = un canon posé
// qui tire des obus explosifs ; marteau = frappe au sol, ondes qui s'élargissent et repoussent.
// Chiffres : premier réglage SUPPOSÉ (calculé sur les dégâts par seconde des armes de l'étape 2, pas joué).
WEAPONS.push(
  {
    id: WEAPON.KATANA,
    key: 'katana',
    name: 'Katana',
    desc: "Grand coup de sabre lent devant vous ; ses coups critiques font d'énormes dégâts.",
    unlockWave: 1,
    unlockCost: 0,
    lootable: true,
    mount: { node: 'katana', arm: -1 }, // dans le dos (fourreau) : le geste de taille est à M
    upgradeBase: 22,
    bypassShield: false,
    hitstopOnKill: true, // gros coup : arrêt sur image s'il tue
    fireTrauma: SHAKE.amounts.fireLight,
    sfx: SFX.KATANA,
    statLabels: ['Dégâts', 'Cadence', 'Coupes', 'Portée', 'Critique'],
    statUnits: ['', '/s', '', 'm', '×'],
    specialScalesWithArea: false,
    stats: [
      [34, 42, 52, 64, 78], // dégâts par robot et par coupe
      [0.55, 0.6, 0.66, 0.73, 0.8], // salves par seconde
      [1, 2, 3, 4, 5], // coupes par salve, sens alterné
      [3.2, 3.6, 4.0, 4.5, 5.0], // portée (m), du centre du héros au bord du robot
      [2.2, 2.5, 2.8, 3.2, 3.6], // multiplicateur d'un coup critique du katana (au lieu de PLAYER.critMul)
    ],
    arcDeg: 170, // arc de chaque coupe, centré sur la visée
    contact: 1.2, // m — bord d'un robot à moins de 1,2 m du héros : touché quel que soit l'angle
    critAdd: 0.12, // chance de critique ajoutée (le katana « cherche » le critique)
    cutGap: 0.22, // s entre deux coupes d'une salve
    maxHits: 32,
    knockback: 3.5, // m/s
    arcHeight: 1.0, // m — hauteur du croissant dessiné
  },
  {
    id: WEAPON.GRENADE,
    key: 'grenade',
    name: 'Grenades',
    desc: "Lance des grenades sur les groupes de robots.",
    unlockWave: 1,
    unlockCost: 0,
    lootable: true,
    mount: { node: 'grenades', arm: -1 }, // ceinture
    upgradeBase: 22,
    bypassShield: true, // explosion
    hitstopOnKill: false,
    fireTrauma: 0,
    sfx: SFX.GRENADE,
    statLabels: ['Dégâts', 'Cadence', 'Grenades', 'Explosion', 'Souffle'],
    statUnits: ['', '/s', '', 'm', 'm/s'],
    specialScalesWithArea: false,
    stats: [
      [30, 37, 46, 56, 68], // dégâts de l'explosion (au centre)
      [0.45, 0.52, 0.6, 0.68, 0.78], // lancers par seconde
      [1, 2, 3, 4, 5], // grenades par lancer (une par paquet, le surplus en couronne)
      [2.2, 2.5, 2.8, 3.1, 3.5], // rayon de l'explosion (m)
      [2, 2.6, 3.2, 3.9, 4.6], // recul du souffle (m/s)
    ],
    range: 12, // m — portée des lancers
    flightSeconds: 0.6, // s de vol, quelle que soit la distance
    arcHeight: 2.6, // m — sommet de la cloche
    ringMul: 0.8,
    explosionTrauma: SHAKE.amounts.explosionRocket * 0.5,
    explosionPunch: 0,
    shotHeight: 0.95,
  },
  {
    id: WEAPON.SMOKE,
    key: 'smoke',
    name: 'Fumigènes',
    desc: "Un nuage de fumée aveugle et ralentit les robots ; vos coups y sont toujours critiques.",
    unlockWave: 1,
    unlockCost: 0,
    lootable: true,
    mount: { node: 'fumigenes', arm: -1 }, // ceinture, côté gauche
    upgradeBase: 20,
    bypassShield: true,
    noCrit: true, // les tics du nuage ne sont pas des coups francs
    hitstopOnKill: false,
    fireTrauma: 0,
    sfx: SFX.SMOKE,
    statLabels: ['Dégâts', 'Tics', 'Nuages', 'Rayon', 'Durée'],
    statUnits: ['', '/s', '', 'm', 's'],
    specialScalesWithArea: false,
    stats: [
      [3, 4, 5, 6.5, 8], // dégâts par tic et par robot
      [2, 2.2, 2.4, 2.7, 3], // tics par seconde
      [1, 2, 3, 4, 5], // nuages par lancer
      [2.6, 2.9, 3.2, 3.6, 4.0], // rayon (m)
      [3.5, 4, 4.6, 5.2, 6], // durée (s)
    ],
    throwEvery: 5, // s entre deux lancers (la cadence est celle des tics)
    range: 10, // m
    flightSeconds: 0.45,
    arcHeight: 2.0,
    ringMul: 1.1,
    slow: 0.4, // facteur de vitesse d'un robot aveuglé
    slowSeconds: 0.5, // s — tenu tant qu'il reste dans le nuage (réécrit à chaque tic)
    markSeconds: 0.6, // s — un robot sorti du nuage reste « aveuglé » (critiques du Shinobi) ce temps
    maxTicks: 64, // robots touchés au plus par tic et par nuage
    fadeIn: 0.25,
    fadeOut: 0.6,
    height: 0.07,
  },
  {
    id: WEAPON.FLASH,
    key: 'flash',
    name: 'Frappe éclair',
    desc: "Sur la touche de frappe (A ou E) : vous filez droit devant vous et tranchez tout sur la ligne.",
    unlockWave: 1,
    unlockCost: 0,
    lootable: true,
    mount: { node: 'eclair', arm: 0 }, // lame courte du bras droit
    upgradeBase: 22,
    bypassShield: true, // il traverse : le bouclier frontal ne l'arrête pas
    hitstopOnKill: true,
    fireTrauma: SHAKE.amounts.explosionRocket * 0.3,
    sfx: SFX.FLASH,
    statLabels: ['Dégâts', 'Recharge', 'Échos', 'Distance', 'Largeur'],
    statUnits: ['', '/s', '', 'm', 'm'],
    specialScalesWithArea: false,
    stats: [
      [40, 50, 62, 76, 92], // dégâts par robot sur la ligne
      [0.22, 0.25, 0.28, 0.32, 0.36], // frappes par seconde (recharge de 4,5 s à 2,8 s)
      [1, 2, 3, 4, 5], // tranchants sur la ligne : la frappe, puis des échos espacés de echoGap
      [5, 5.8, 6.6, 7.4, 8.2], // distance parcourue (m)
      [0.8, 0.95, 1.1, 1.25, 1.4], // demi-largeur de la ligne (m), jusqu'au bord du robot
    ],
    minTargets: 1, // part seulement si au moins un robot est sur la ligne
    echoGap: 0.12, // s entre deux tranchants
    invuln: 0.25, // s d'invulnérabilité pendant la frappe
    radius: 0.45, // m — rayon du héros pour world.resolve
    knockback: 2.5,
    beamWidth: 0.5, // m — largeur du trait dessiné
    shotHeight: 0.9,
  },
  {
    id: WEAPON.CANNON,
    key: 'cannon',
    name: 'Grosse tourelle',
    desc: "Pose un canon lourd : il tire lentement mais fait de gros dégâts.",
    unlockWave: 1,
    unlockCost: 0,
    lootable: true,
    mount: { node: 'canon', arm: -1 }, // dans le dos
    upgradeBase: 24,
    bypassShield: true, // obus explosifs
    hitstopOnKill: false,
    fireTrauma: 0,
    sfx: SFX.CANNON,
    statLabels: ['Dégâts', 'Cadence', 'Obus', 'Explosion', 'Durée'],
    statUnits: ['', '/s', '', 'm', 's'],
    specialScalesWithArea: false,
    stats: [
      [50, 62, 76, 92, 110], // dégâts d'un obus (au centre)
      [0.35, 0.4, 0.46, 0.53, 0.6], // salves par seconde
      [1, 2, 3, 4, 5], // obus par salve (paquets les plus denses)
      [2.6, 2.9, 3.2, 3.6, 4.0], // rayon de l'explosion (m)
      [10, 12, 14, 16, 18], // durée du canon posé (s)
    ],
    range: 16, // m — portée du canon
    deployEvery: 3, // s — un nouveau canon après la fin du précédent
    deployDist: 1.4, // m — posé derrière le héros
    deploySeconds: 0.45, // s — le canon se déplie avant son premier tir
    foldSeconds: 0.3,
    shellSeconds: 0.7, // s de vol d'un obus
    shellArc: 3.2, // m — sommet de la cloche
    // § E5.T : bouche mesurée sur canon-lourd.glb (y 0,65, z 0,913 à 0,9 m de haut) × l'échelle totale scale² (la
    // géométrie est chargée à 0,9 × scale, puis l'instance est mise à l'échelle scale)
    shotHeight: 0.65, // m — bouche du canon
    muzzle: 0.91, // m — bouche, devant l'axe de lacet
    turnRate: 5, // rad/s — le canon lourd tourne lentement
    knockback: 4,
    explosionTrauma: SHAKE.amounts.explosionRocket * 0.7,
    explosionPunch: 0,
    model: 'canon-lourd.glb', // § E5.T : la Grosse tourelle du dos de l'agent Bastion (outils/tourelles_agent.mjs)
    profil: 'tourelleCanon', // § E5.T : comme la Sentinelle posée, gain plus fort (texture plus sombre) ; 'tourelleCanonA' : acier seul
    contact: { rayon: 0.62, force: 0.85 }, // § E5.T : ombre de contact (m, à l'échelle 1), centrée sur le socle
    // échelle totale scale² : 0,9 m de haut, 1,45 m de long ; posé à deployDist (1,4 m) derrière le héros, le bout du
    // canon reste à 0,5 m de lui (à 1,2, capture du 21/11, il passait dans ses jambes). Avant : 0,9 × 1,6² ≈ 2,3 m
    scale: 1,
    glow: 0x4f7cff,
  },
  {
    id: WEAPON.HAMMER,
    key: 'hammer',
    name: 'Marteau à ondes',
    desc: "Frappe le sol : des ondes de choc blessent et repoussent tout autour de vous.",
    unlockWave: 1,
    unlockCost: 0,
    lootable: true,
    mount: { node: 'marteau', arm: 0 }, // bras droit
    upgradeBase: 22,
    bypassShield: true, // onde au sol
    hitstopOnKill: false,
    fireTrauma: SHAKE.amounts.explosionRocket * 0.45,
    sfx: SFX.HAMMER,
    statLabels: ['Dégâts', 'Cadence', 'Ondes', 'Rayon', 'Recul'],
    statUnits: ['', '/s', '', 'm', 'm/s'],
    specialScalesWithArea: false,
    stats: [
      [28, 35, 43, 53, 65], // dégâts par onde et par robot
      [0.5, 0.56, 0.63, 0.7, 0.8], // frappes par seconde
      [1, 2, 3, 4, 5], // ondes par frappe : la première couvre le disque, les suivantes l'anneau suivant
      [3, 3.4, 3.8, 4.3, 4.8], // rayon de la première onde (m)
      [6, 7, 8, 9.5, 11], // recul (m/s)
    ],
    waveGap: 0.15, // s entre deux ondes
    waveGrow: 0.35, // chaque onde suivante va rayon × (1 + 0,35 k)
    stunSlow: 0.25, // facteur de vitesse d'un robot sonné
    stunSeconds: 0.6,
    maxHits: 64,
  },
);
// Lame de phase (double lame du Shinobi) — retour de Femz du 15/11, 20h53 : « la détection d'attaque des lames de shinobi
// est trop courte ». Mesuré avant (§ E3.N « Réalisé ») : portée 2,6 m au niveau 1 (bord du robot), arc 110°, AUCUN coup
// hors de l'arc même au contact, et la traînée dessinée dépassait la zone de touche sur les côtés. Après : zone plus
// longue et plus large, anneau de contact, traînée dessinée DANS la zone (rayon − écart bouche / héros − drawPad, arc −
// drawArcPadDeg). Les tables restent la zone de TOUCHE annoncée (tests : touché à la portée, pas au-delà).
WEAPONS[WEAPON.BLADE].stats[STAT.AREA] = [3.2, 3.5, 3.9, 4.3, 4.8]; // avant [2.6, 2.9, 3.2, 3.6, 4.0]
WEAPONS[WEAPON.BLADE].stats[STAT.SPECIAL] = [150, 165, 180, 200, 225]; // avant [110, 130, 150, 175, 200]
WEAPONS[WEAPON.BLADE].contact = 1.2; // m — bord d'un robot à moins de 1,2 m du centre du héros : touché quel que soit l'angle
WEAPONS[WEAPON.BLADE].drawPad = 0.25; // m — la traînée s'arrête 0,25 m avant le bord de la zone de touche
WEAPONS[WEAPON.BLADE].drawArcPadDeg = 16; // ° — arc dessiné = arc de touche − 16°
// Arsenaux (FEMZ_1511G) : clés de WEAPON_KEYS, signature en premier. Choix du contrat (§ E3.N) : 6 armes, toutes
// exclusives. Règle de l'arsenal épuisé : 6 armes possédées, absorbées ou bannies ET un emplacement libre → les coffres
// peuvent proposer une arme d'un autre arsenal.
export const ARSENALS = {
  eclaireur: ['blaster', 'orbitals', 'shotgun', 'rail', 'rockets', 'ricochet'],
  bastion: ['turret', 'cannon', 'hammer', 'mines', 'emp', 'pool'],
  shinobi: ['blade', 'katana', 'grenade', 'smoke', 'flash', 'boomerang'],
};
export const ARSENAL_RULES = {
  exhaustedOpensAll: true,
  // Femz, 17/11 : « ne propose jamais d'arme signature d'un autre agent pour un autre héros (blaster, marteau et lame
  // restent à leur héros) » — même arsenal épuisé, ces armes ne sortent que pour leur agent.
  reservees: { eclaireur: ['blaster'], bastion: ['hammer'], shinobi: ['blade'] },
};
PALETTE.weapon.push(0xff7a3d, 0xe0c44a, 0xb8c4d6, 0x7df9ff, 0x4f7cff, 0xffa84a); // katana … marteau
UI.weaponIcons.push('⚔', '●', '☁', '⚡', '▣', '⚒');
CAPS.grenades = 24; // grenades en vol (5 par lancer, 0,6 s de vol)
CAPS.smokes = 8; // nuages au sol (5 par lancer, 6 s de vie, un lancer toutes les 5 s)
CAPS.cannons = 1; // un canon lourd à la fois (son InstancedMesh « canons » : +1 appel de dessin)
CAPS.shells = 24; // obus en vol
FX.impact.radial.push(false, true, true, false, true, true); // katana, frappe : tir direct ; les autres : zone
ANIM.armes.recul.push(0, 0, 0, 0, 0, 0.3);
ANIM.armes.taille.push(0.14, 0.1, 0.1, 0.12, 0.16, 0.14);
DAMAGE.softFlashSources.push(WEAPON.SMOKE); // dégâts continus : flash adouci
// Couleurs des effets (VFX_COULEURS) : 6 lignes ajoutées à la suite (indice 13 + … ; la ligne 12 est celle des robots).
// L'indice de base est lu à l'évaluation : il reste juste si un autre chantier ajoute ses lignes avant celles-ci.
export const ARSENAL_VFX = { couleur0: VFX_COULEURS.bord.length };
VFX_COULEURS.bord.push([1.0, 0.32, 0.05], [1.0, 0.75, 0.05], [0.55, 0.62, 0.75], [0.15, 0.95, 1.0], [0.1, 0.25, 1.0], [1.0, 0.5, 0.08]);
VFX_COULEURS.chaud.push([1.0, 0.85, 0.6], [1.0, 0.95, 0.6], [0.92, 0.95, 1.0], [0.85, 1.0, 1.0], [0.7, 0.8, 1.0], [1.0, 0.85, 0.55]);
VFX_COULEURS.fin.push([0.6, 0.1, 0.02], [0.8, 0.35, 0.02], [0.25, 0.3, 0.4], [0.02, 0.4, 0.9], [0.02, 0.08, 0.6], [0.7, 0.25, 0.02]);
// Sons — CANDIDATS à faire valider par Femz : découpes transposées de SA banque (§ E3.0.7, outils/preparer_sons.py)
AUDIO.sounds[SFX.KATANA] = { dur: 0.45, gain: 0.26, minInterval: 0.08, maxVoices: 3, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.GRENADE] = { dur: 0.5, gain: 0.24, minInterval: 0.08, maxVoices: 3, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.SMOKE] = { dur: 0.7, gain: 0.18, minInterval: 0.2, maxVoices: 2, pitchVar: 0, priority: 0 };
AUDIO.sounds[SFX.FLASH] = { dur: 0.3, gain: 0.3, minInterval: 0.1, maxVoices: 2, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.CANNON] = { dur: 0.6, gain: 0.3, minInterval: 0.12, maxVoices: 2, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.HAMMER] = { dur: 0.8, gain: 0.32, minInterval: 0.15, maxVoices: 2, pitchVar: 0, priority: 2 };
//#endregion e3:N-arsenaux-agents

//#region e3:B-evolutions
// Évolutions (ARCHITECTURE.md § E3.B) : arme au maximum (5 lignes au niveau 5 = niveau 21, surcharge non comptée) +
// catalyseur → le coffre suivant donne l'évolution (lot LOT_EVOLUTION, rareté Noyau, toujours gagné). « item » :
// objet catalyseur, JAMAIS consommé ; « partner » : arme absorbée (son emplacement se libère, elle ne ressort plus).
// Armes et objets par CLÉ (résolues par src/evolutions.js à init). Dégâts des effets = part (share) des DÉGÂTS
// effectifs de l'arme au moment du coup. Chiffres SUPPOSÉS (calculés, pas joués) : premier réglage.
export const LOT_EVOLUTION = 5; // à côté de LOT (gelé par l'étape 2) : lot « évolution » des coffres
export const EVOLUTION_RULES = {
  maxLevel: 21, // = 1 + STAT_COUNT × (STAT_MAX_LEVEL − 1) (contrôlé par tests/e3-B-evolutions.test.mjs)
  rarity: RARITY.NOYAU, // rareté (jaune) du lot d'évolution
  tag: 'ÉVOLUTION', // étiquette du lot dans le coffre
  hidden: '?', // recette pas encore découverte (méta, src/meta.js)
  shotCap: 160, // projectiles évolués en vol au plus (pool de src/evolutions.js)
  queueCap: 192, // effets différés en attente au plus (échos, ondes, éclairs)
  hitMemory: 6, // robots déjà touchés retenus par projectile évolué (perforation)
  burst: { radius: 4.5, trauma: 0.35 }, // éclat au pied du héros à la reprise du combat après une évolution
  shotHeight: 1.0, // m — hauteur de vol des projectiles évolués (dessin)
};
export const EVOLUTIONS = [
  { id: 0, key: 'canon-chiffre', name: 'Canon chiffré', weapon: 'blaster', item: 'scope', partner: null, rule: "Chaque coup critique tire une 2e balle qui traverse 8 robots.",
    share: 1.0, pierce: 8, speed: 34, range: 24, radius: 0.35, perFrame: 6 },
  { id: 1, key: 'couronne-scies', name: 'Couronne de scies', weapon: 'orbitals', item: 'overclock', partner: null, rule: "L'orbite des disques grandit et rétrécit (× 0,6 à × 1,8) ; un disque qui tue lance une mini-scie.",
    breatheMin: 0.6, breatheMax: 1.8, breathePeriod: 2.4, share: 0.8, pierce: 2, speed: 18, range: 9, radius: 0.4, perFrame: 3 },
  { id: 2, key: 'brise-ligne', name: 'Brise-ligne', weapon: 'shotgun', item: 'dashcore', partner: null, rule: "Chaque dash tire autour de vous un anneau de 24 plombs.",
    pellets: 24, share: 0.6, pierce: 1, speed: 26, range: 10, radius: 0.35 },
  { id: 3, key: 'essaim', name: 'Essaim à fragmentation', weapon: 'rockets', item: 'detonator', partner: null, rule: "Chaque roquette éclate en 6 petites roquettes.",
    sub: 6, share: 0.35, blast: 1.8, speed: 15, range: 5, radius: 0.3 },
  { id: 4, key: 'lame-fantome', name: 'Lame fantôme', weapon: 'blade', item: 'berserk', partner: null, rule: "Chaque coup laisse une image de la lame qui refrappe 0,3 s après.",
    delay: 0.3, share: 0.6 },
  { id: 5, key: 'coupe-circuit', name: 'Coupe-circuit', weapon: 'katana', item: 'leech', partner: null, rule: "Le dernier coup du combo vous rend 4 PV et recharge aussitôt votre dash.",
    heal: 4 },
  { id: 6, key: 'foudre-ombre', name: "Foudre de l'ombre", weapon: 'flash', item: 'tesla', partner: null, rule: "La frappe lance un éclair sur chaque robot qu'elle tranche.",
    delay: 0.08, share: 0.7, height: 7 },
  { id: 7, key: 'shuriken-givre', name: 'Shuriken givré', weapon: 'boomerang', item: 'cryo', partner: null, rule: "Il gèle les robots qu'il traverse et éclate en 4 morceaux à son retour.",
    slow: 0.2, seconds: 1.5, shards: 4, share: 0.5, pierce: 2, speed: 20, range: 8, radius: 0.35 },
  { id: 8, key: 'seisme', name: 'Séisme', weapon: 'hammer', item: 'reactive', partner: null, rule: "Une 2e onde, plus large (× 1,6), part 0,4 s après la première.",
    delay: 0.4, radiusMul: 1.6, share: 0.8, knockback: 7 },
  { id: 9, key: 'champ-mines', name: 'Champ de mines', weapon: 'mines', item: 'capacitor', partner: null, rule: "Quand le Condensateur envoie son impulsion, toutes vos mines explosent." },
  { id: 10, key: 'dome-ionique', name: 'Dôme ionique', weapon: 'emp', item: 'shield', partner: null, rule: "Votre bouclier se recharge 2 fois plus vite tant qu'un robot est dans l'aura.",
    rechargeMul: 2 },
  { id: 11, key: 'nappe-virale', name: 'Nappe virale', weapon: 'pool', item: 'virus', partner: null, rule: "Les robots qui marchent dans la flaque sont infectés par le Virus (dégâts × 2).",
    virusMul: 2, seconds: 6 },
  { id: 12, key: 'lance-prisme', name: 'Lance-prisme', weapon: 'rail', item: null, partner: 'ricochet', rule: "Le rayon se divise en 3 rayons qui rebondissent de robot en robot ; le Ricochet disparaît dans cette arme.",
    rays: 3, spreadDeg: 22, bounces: 3, bounceRange: 9, share: 0.6, pierce: 1, speed: 40, range: 20, radius: 0.35 },
  { id: 13, key: 'nuage-frag', name: 'Nuage à fragmentation', weapon: 'grenade', item: null, partner: 'smoke', rule: "Chaque grenade laisse une fumée qui explose en 8 éclats ; les Fumigènes disparaissent dans cette arme.",
    smokeSeconds: 2.5, smokeRadiusMul: 0.9, shards: 8, share: 0.5, blast: 2.6, blastShare: 0.8, pierce: 2, speed: 16, range: 6, radius: 0.35 },
  { id: 14, key: 'forteresse', name: 'Forteresse', weapon: 'cannon', item: null, partner: 'turret', rule: "Une tourelle lourde à double canon, qui tire aussi des petites salves ; la Sentinelle disparaît dans cette arme.",
    gap: 0.55, salvo: 3, salvoShare: 0.3, salvoSpreadDeg: 10, pierce: 1, speed: 30, range: 16, radius: 0.32 },
];
export const EVOLUTION_COUNT = EVOLUTIONS.length; // 15
// 21/11 (retour d'un testeur : « j'ai évolué mon arme mais elle est toujours affichée comme Blaster ») — une arme évoluée
// prend le nom et l'icône de l'évolution, et une case PLEINE dorée (inventaire, HUD) ; la fenêtre d'infos dit « évoluée ».
export const EVOLUTION_UI = {
  genre: 'ARME ÉVOLUÉE',
  genreSig: 'ARME ÉVOLUÉE · SIGNATURE',
  rarete: 'Évoluée', // pastille de rareté de la fenêtre d'infos
  couleur: '#ffc83d', // = RARITIES[NOYAU] (le lot d'évolution du coffre)
  faite: 'Évoluée', // ligne de la recette, une fois l'évolution faite
  nivMax: 'niv. max', // § E5.W : condition de l'arme d'une évolution à objet, en petit, tant que la recette n'est pas faite
};
AUDIO.sounds[SFX.EVOLVE] = { dur: 1.4, gain: 0.32, minInterval: 0.5, maxVoices: 1, pitchVar: 0, priority: 2 }; // « Passage de niveau.wav », + 4 : CANDIDAT
//#endregion e3:B-evolutions

//#region e3:F-fusions
// =====================================================================================================
// Plan addictif, étape 3, chantier F (ARCHITECTURE.md § E3.F et E3.F bis) — deux objets passifs à ITEM_RULES.fusionAt
// piles chacun FUSIONNENT : l'objet né (rareté Noyau, jaune) prend un seul emplacement, garde les effets et les piles
// des deux ingrédients et ajoute SA règle (FUSIONS[k].rule, codée dans src/items.js). Réglages SUPPOSÉS (pas joués).
// =====================================================================================================
for (let k = 0; k < FUSIONS.length; k++) FUSIONS[k].enabled = true; // les 9 recettes de l'étape 2, ouvertes (§ E3.F règle 1)
/** Réglages de la règle nouvelle de chaque objet né (index = FUSION k). perFrame : plafond de déclenchements par image. */
export const FUSION_RULES = [
  { key: 'orage', frozenRangeMul: 2, perFrame: 2 }, // gel du Cryogel (factor, seconds) sur chaque robot touché par l'éclair ; saut × 2 vers un robot gelé
  { key: 'malware', seconds: 3, radius: 2.5, cap: 8, perFrame: 2 }, // nuage : infecte et enflamme (statuts du Virus et de la Surchauffe) à chaque tic
  { key: 'reaction', perFrame: 3 }, // l'explosion tire sa chance de critique (celle du héros) : × critMul, puis une 2e explosion, une seule fois
  { key: 'retroaction', hpBelow: 0.3, leechMul: 2 }, // sous 30 % de PV : Berserk au cran 16 (0 PV), Siphon × 2
  { key: 'parefeu-actif', dmgMul: 3 }, // bouclier qui tombe (réserve vidée) → onde de la coque × 3, sans attendre sa recharge
  { key: 'surregime', rateMul: 2, seconds: 2 }, // après un dash (à sa fin) : cadence × 2 pendant 2 s
  { key: 'essaim', shots: 8, perFrame: 1 }, // à chaque impulsion : chaque drone tire 8 coups en étoile (8 robots différents)
  { key: 'recyclage', fragDraws: 1 }, // un robot tué par un éclat refait son tirage de fragment : le double en moyenne
  { key: 'restauration', chestRarity: RARITY.OPTIMISE }, // Sauvegarde déclenchée → un coffre posé au pied du héros à la fin de la vague
];
/** Icônes des 9 objets nés (pixel 1-bit 12 × 12, comme ITEM_ICONS) : ajoutées à ITEM_ICONS, donc au sprite de ui.js. */
export const FUSION_ICONS = {
  'sr-m-orage': ['#.#....###..', '.#....###...', '#.#..###....', '....###.....', '...#######..', '..#######...', '.....###....', '....###..#.#', '...###....#.', '..###....#.#', '.###........', '............'],
  'sr-m-malware': ['...######...', '..########..', '.###.##.###.', '.##..##..##.', '.##########.', '..###..###..', '...######...', '#..#.##.#..#', '.#........#.', '..#.#..#.#..', '.#..#..#..#.', '#...#..#...#'],
  'sr-m-reaction': ['.#........#.', '..#..##..#..', '...######...', '.##########.', '..###..###..', '.###....###.', '.###....###.', '..###..###..', '.##########.', '...######...', '..#..##..#..', '.#........#.'],
  'sr-m-retroaction': ['...######...', '..#......#..', '.#........##', '#..##.##..#.', '#.#######.#.', '#.#######...', '#..#####....', '#...###.....', '.#...#....#.', '..#......#..', '...######...', '............'],
  'sr-m-parefeu-actif': ['#....##....#', '.#...##...#.', '............', '############', '#....#.....#', '############', '#..#.....#.#', '############', '............', '.#...##...#.', '#....##....#', '............'],
  'sr-m-surregime': ['............', '#.....#.....', '##....##....', '.##....##...', '..##....##..', '...##....##.', '...##....##.', '..##....##..', '.##....##...', '##....##....', '#.....#.....', '............'],
  'sr-m-essaim': ['............', '.#.#....#.#.', '.###....###.', '..#......#..', '............', '....#..#....', '....####....', '.....##.....', '............', '..#.#..#.#..', '..###..###..', '...#....#...'],
  'sr-m-recyclage': ['.....##.....', '....####....', '...##..##...', '..##....#...', '.##......#..', '##.......##.', '.#.......###', '..........#.', '..#.........', '.###......#.', '..##########', '...#........'],
  'sr-m-restauration': ['....###.....', '...##.......', '..##........', '.#######....', '..##....##..', '...##....#..', '##########..', '#........#..', '#...##...#..', '##########..', '#........#..', '##########..'],
};
Object.assign(ITEM_ICONS, FUSION_ICONS);
/** Écran du moment de fusion (ui.buildFusion, DA FUI et composants de ui-carte.js). Durées en s, temps réel. */
export const FUSION_SCREEN = {
  slideSeconds: 0.9, // les deux icônes glissent l'une vers l'autre
  mergeSeconds: 0.45, // elles se rejoignent dans la puce CPU, qui pulse fort (arrêt sur image)
  cardSeconds: 0.35, // la carte de l'objet né apparaît
  guardSeconds: 0.4, // après la carte : garde avant qu'Entrée / clic ferme l'écran
  skippableAfter: 1, // Entrée passe l'animation à partir de la 2e fusion de la partie (la 1re se joue en entier)
  path: 'AGENT / FUSION DE MODULES',
  kicker: 'FUSION : ',
  lead: 'Deux modules au maximum fusionnent : un emplacement se libère, rien n’est perdu.',
  keeps: 'Garde les effets et les piles de',
  slotFreed: 'Emplacement libéré',
  discovered: 'NOUVELLE RECETTE',
  close: 'Continuer',
  hint: 'fusionne avec un module possédé', // pastille « ? » des cartes d'objet du choix de niveau
  unknown: '?', // recette pas encore découverte (sr.meta)
};
// Son (§ E3.0.7) : « Nouveau record.wav », 1,4 s, − 2 demi-tons (à 4 demi-tons de JACKPOT) — CANDIDAT à faire valider.
AUDIO.sounds[SFX.FUSION] = { dur: 1.4, gain: 0.3, minInterval: 0.5, maxVoices: 1, pitchVar: 0, priority: 2 };
//#endregion e3:F-fusions

//#region e3:H-recharges-portraits
// Plan addictif, étape 3, chantier H (ARCHITECTURE.md § E3.H) — demandes de Femz du 15/11 (17h).
// 1. Sources à recharge (src/cooldowns.js) : une arme ou un objet « cheaté » (mesure : tests/e3-H-mesure.mjs, liste et
//    chiffres dans le « Réalisé » du § E3.H) n'agit plus en permanence. Prêt → un gros coup : fenêtre d'activité de
//    `active` s (dégâts × burst, cadence × rateMul, `salvo` tirs de départ), puis recharge de
//    seconds − perLevel × (niveau − 1) s, jamais sous min (niveau d'arme 1 à 21 ; objet : piles). reach (m) : un robot
//    doit être à cette distance du héros pour que le coup parte (jamais gâché dans le vide).
export const RECHARGE = {
  share: 0.25, // § E3.H : part des morts au-delà de laquelle une source permanente est « cheatée » (supposé, contrat)
  burstMul: 2, // dégâts × 2 par défaut pendant la fenêtre
  flashSeconds: 0.25, // éclat de la case quand elle redevient prête (.sr-case-pret)
  trauma: 0.22, // secousse du départ (groupe PLAYER_EXPLOSION : plafonnée et réglée par le joueur, comme les roquettes)
  hitstop: 0.05, // arrêt sur image du départ (s ; fx.hitstop ignore un 2e départ à moins de FX.hitstop.minInterval)
  eclatRayon: 3.2, // m : éclat d'étoile + onde au sol à la couleur de la source, autour du héros
  steps: 64, // la jauge n'est réécrite que si elle a bougé d'au moins 1/64 (§ E3.0.5, règle 2)
};
export const RECHARGES = {
  // MESURE (16/11, tests/e3-H-mesure.mjs, avant = HEAD) : arme seule au niveau 21, héros IMMOBILE, 120 rôdeurs de la
  // vague 10 entretenus autour : morts par minute. Référence mono-cible : blaster 2 315. Règle retenue (SUPPOSÉE) : une
  // arme de ZONE au-dessus de 2 700 morts/min sans rien faire (≥ 1,15 × le blaster) passe en recharge — marteau 5 125,
  // canon lourd 2 915 (pas branché : tir autonome dans weapons-agents.js, voir le § E3.H bis), boomerang 2 900, nappe
  // 2 790, disques orbitaux 2 735. Restent continues : grenades 2 595, lame 2 535, mines 2 340, roquettes 2 210, rail
  // 2 025, katana 1 990, fumée 1 925, EMP 1 755, ricochet 1 620, frappe éclair 810, pompe 335, sentinelle 330.
  // Réglage (SUPPOSÉ, calculé, pas joué) : dégâts × burst pendant la fenêtre (le coup se sent plus fort qu'avant) ; sur
  // un cycle fenêtre + recharge, la moyenne tombe sous le continu (≈ 0,35 au niveau 1, ≈ 0,65 au niveau 21).
  // flight : s pendant lesquelles les coups partis dans la fenêtre frappent encore (tests : 0 dégât au-delà).
  weapons: {
    orbitals: { seconds: 7, perLevel: 0.2, min: 3, active: 2, burst: 1.6, reach: 5, flight: 0.1 },
    boomerang: { seconds: 6, perLevel: 0.15, min: 3, active: 1.2, burst: 1.8, salvo: 1, reach: 12, flight: 4.2 },
    // nappe : elle lançait déjà toutes les 4,5 s ; recharge plus longue que ce rythme (1re mesure à 7 / 3,2 s : 2 790 → 3 200)
    pool: { seconds: 10, perLevel: 0.2, min: 6.5, active: 1.2, burst: 1.6, reach: 11, flight: 6.5 },
    hammer: { seconds: 5, perLevel: 0.12, min: 2.4, active: 1, burst: 2, reach: 7, flight: 2.5 },
  },
  // Objets (même mesure, blaster niveau 11 + l'objet à 5 piles, part des morts de la source ITEM) : Coque réactive
  // 78 % et Condensateur 56 % ont DÉJÀ une recharge (2 s ; K robots tués) — jauge horloge sur leur case. Au-dessus de
  // RECHARGE.share sans recharge : Éclats 40 %, Surchauffe 39 %, Virus 35 %, Charge critique 29 % — à trancher par
  // Femz (déclenchés par les coups : ils suivent déjà le rythme des armes). Aucun objet n'est passé en recharge.
  items: {},
};
// Sons (socle E3, § E3.0.7) : découpes de la banque « sfx game » de Femz (outils/preparer_sons.py), CANDIDATS à valider.
AUDIO.sounds[SFX.CD_READY] = { dur: 0.4, gain: 0.22, minInterval: 0.15, maxVoices: 2, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.CD_FIRE] = { dur: 0.5, gain: 0.33, minInterval: 0.12, maxVoices: 2, pitchVar: 0, priority: 2 };
// 4. Portraits des agents (outils/portraits_agents.mjs, hors jeu). 18/11/2026, choix de Femz (« A en animé ») : portraits
//    pixel GRANDS ET ANIMÉS des cartes de l'écran « Choix de l'agent » — une boucle de l'idle de chaque agent rendue
//    UNE FOIS par le portrait 3D de la pause (src/pause-agent.js, même matériau, cape tissu, idle cuit), en planche
//    d'images pixel jouée en CSS steps() (aucun rendu 3D en direct : une image par agent, zéro appel de dessin).
//    Même cadrage pour les trois (hRef m de haut depuis le sol : les tailles relatives se lisent) ; arme signature seule
//    (Bastion : la Sentinelle DÉPLOYÉE au sol à côté de lui, sa tourelle du dos ne se voyant pas de face) ; silhouettes
//    verrouillées et vignettes du Noyau (48 × 68, AGENT_SCREEN.portraits) tirées du même rendu (image 0).
//    boucles[a] : debutS / dureeS dans le clip de l'idle, images, allerRetour (true : CSS alternate, sans saut sur un
//    extrait qui ne boucle pas ; false : le clip entier, qui boucle de lui-même).
export const PORTRAIT = {
  art: [80, 120], // px d'art d'une image de la planche
  vignette: [48, 68], // px d'art de la vignette du Noyau (recadrée sur l'agent, même rendu)
  hRef: 2.12, // m cadrés depuis le sol, communs aux trois agents (cadre serré : armes plus grandes)
  alphaSeuil: 110, // alpha (0-255) au-dessus duquel un pixel d'art est plein
  // Éclaireur : Warrior Idle (11,7 s, aucun extrait court ne boucle) ; Bastion : Unarmed Idle (1,9 s, boucle) ;
  // Shinobi : Idle (3,6 s)
  boucles: [
    { debutS: 0.4, dureeS: 1.8, images: 12, allerRetour: true },
    { debutS: 0, dureeS: 1.9, images: 16, allerRetour: false },
    { debutS: 0, dureeS: 1.8, images: 12, allerRetour: true },
  ],
  // en plus de la vue 3/4 du portrait (PAUSE.camera.vueDeg) ; Shinobi tourné de 45° vers la caméra : sa cape, vue de
  // chant à 0°, se lisait comme un sabre (Femz, 18/11) ; de face elle se lit comme une cape et ses deux lames se voient
  rotationDeg: [0, 0, 45],
  armes: [['arme_blaster'], [], ['arme_lame', 'arme_lame_d']],
  // tourelle déployée au sol à côté du Bastion (m, repère du portrait) ; § E5.T : la Sentinelle de l'agent, plus large et
  // plus basse que l'ancienne, reculée (z 0,35 → 0) pour que son socle reste dans le cadre
  sentinelle: { x: 0.55, z: 0, lacetDeg: -35 },
  xCentre: [0, 0.12, 0], // m : centre visé du cadre (le Bastion décalé pour garder sa Sentinelle dans le cadre)
};
//#endregion e3:H-recharges-portraits

//#region e3:I-pause
/**
 * § E3.I — écran de pause : fiche d'un élément, panneaux repliés, agent en 3D (src/pause-agent.js).
 * pixel : px CSS par pixel d'art du portrait 3D (rendu en basse définition puis agrandi au plus proche voisin, comme
 * l'ancien portrait pixel). camera : cadrage du portrait (fov vertical en degrés ; le modèle est cadré entier sur sa boîte englobante,
 * marge = hauteur cadrée / hauteur du modèle ; plongée et vue 3/4 en degrés). idle : respiration (période s, amplitude rad du buste, m de la
 * racine), balancier des bras (rad), tête (rad, période s), pivot lent du corps autour de la vue 3/4 (rad, période s).
 * lumiere : soleil et ciel = ceux du jeu (PEINT), multipliés ici (le portrait n'a pas la courbe de la passe finale).
 * bonusFormat : mise en forme du TOTAL d'un bonus de la fiche (clé du bonus → 'pv' | 'pvs' | 'pct' | 'pctNeg').
 */
export const PAUSE = {
  pixel: 3,
  ombre: 512,
  camera: { fov: 24, marge: 1.1, plongeeDeg: 8, vueDeg: 28 },
  idle: { souffleS: 3.2, buste: 0.035, racine: 0.012, bras: 0.05, tete: 0.16, teteS: 6.5, pivot: 0.32, pivotS: 11 },
  lumiere: { soleil: 1.3, ciel: 1.8, rim: 1.6, rimDistance: 6 },
  bonusFormat: { maxHp: 'pv', moveSpeed: 'pct', xpGain: 'pct', crit: 'pct', regen: 'pvs', dashCd: 'pctNeg', area: 'pct', damage: 'pct', fireRate: 'pct', armor: 'pctNeg' },
};
// Fusion du groupe 2 (16/11/2026) : UI_OPEN (socle 2, attribué à I par le contrat § E3.0.7 : « Clic.wav », 0,15 s,
// − 3 demi-tons) n'avait pas été branché — joué à l'ouverture de la fenêtre d'un élément de la fiche. CANDIDAT.
AUDIO.sounds[SFX.UI_OPEN] = { dur: 0.15, gain: 0.22, minInterval: 0.03, maxVoices: 2, pitchVar: 0, priority: 2 };
//#endregion e3:I-pause

//#region e3:M-anim-shinobi-bastion
// Chantier M (ARCHITECTURE.md § E3.M, retour de Femz du 15/11 FEMZ_1511F et combos validés à 20h40) : les coups de lame
// du Shinobi sont de vrais gestes, les tourelles du Bastion sont posées. Un « combo » = une suite de gestes ; chaque
// geste a sa durée (dur), l'instant où la lame PASSE (impactAt, s depuis le début du geste : les dégâts tombent là),
// son multiplicateur de dégâts (mul), son arrêt sur image (hitstop, s ; 0 = aucun) et sa secousse (trauma) au contact.
// Gestes (geste[]) : 0 taille du bras gauche, 1 taille du bras droit, 2 vrille, 3 taille lourde, 4 revers lourd,
// 5 dégainé éclair, 6 frappe au sol, 7 pose (lancer de tourelle), 8 frappe éclair.
// fx.hitstop refuse un arrêt à moins de FX.hitstop.minInterval (0,25 s) du précédent : sur la double lame (un coup toutes
// les 0,16 s), seuls les coups 1 et 3 en portent un, pour que celui de la vrille passe toujours (vérifié par le test).
// Tous les chiffres sont des réglages SUPPOSÉS (calculés, pas joués) : à valider par Femz en partie.
export const COMBO = Object.freeze({ BLADE: 0, KATANA: 1, HAMMER: 2, POSE: 3, FLASH: 4 });
export const COMBO_COUNT = 5;
export const GESTE = Object.freeze({ TAILLE_G: 0, TAILLE_D: 1, VRILLE: 2, LOURD: 3, REVERS: 4, IAIDO: 5, SOL: 6, POSE: 7, ECLAIR: 8 });
export const COMBOS = {
  pauseReset: 1.5, // s sans coup : le combo reprend au 1er geste (une salve par seconde au niveau 1 ne le casse pas)
  traumaSource: [TRAUMA.FIRE, TRAUMA.PLAYER_EXPLOSION], // [coups légers, coups forts] : plafonds par groupe de camera.js
  traumaFort: 0.12, // trauma à partir duquel un coup passe dans le groupe des explosions du joueur (plafond 0,45/s)
  list: [
    {
      key: 'blade', // double lame : 4 tailles alternées gauche / droite, puis la vrille qui frappe tout autour
      geste: [0, 1, 0, 1, 2],
      dur: [0.16, 0.16, 0.16, 0.16, 0.34],
      impactAt: [0.075, 0.075, 0.075, 0.075, 0.2],
      mul: [1, 1, 1, 1, 2.2],
      hitstop: [0.025, 0, 0.025, 0, 0.07],
      trauma: [0.05, 0.05, 0.05, 0.05, 0.16],
      sfx: [SFX.SLASH_LIGHT, SFX.SLASH_LIGHT, SFX.SLASH_LIGHT, SFX.SLASH_LIGHT, SFX.SLASH_HEAVY],
      arcDeg: [0, 0, 0, 0, 360], // 0 = arc de l'arme (stat « Arc ») ; la vrille frappe tout autour
      avance: [0.18, 0.18, 0.18, 0.18, 0], // m — petit pas glissé vers la cible (dessin seulement)
    },
    {
      key: 'katana', // une lame : taille horizontale ample, revers, puis dégainé éclair (iaido) qui traverse la cible
      geste: [3, 4, 5],
      dur: [0.3, 0.3, 0.5],
      impactAt: [0.13, 0.13, 0.3],
      mul: [1, 1.2, 3],
      hitstop: [0.04, 0.04, 0.12],
      trauma: [0.1, 0.12, 0.34],
      sfx: [SFX.SLASH_HEAVY, SFX.SLASH_HEAVY, SFX.IAIDO],
      arcDeg: [0, 0, 0],
      avance: [0.3, 0.3, 0],
    },
    { key: 'hammer', geste: [6], dur: [0.46], impactAt: [0.26], mul: [1], hitstop: [0.05], trauma: [0.22], sfx: [-1], arcDeg: [0], avance: [0.15] },
    { key: 'pose', geste: [7], dur: [0.42], impactAt: [0.16], mul: [1], hitstop: [0], trauma: [0], sfx: [-1], arcDeg: [0], avance: [0] },
    { key: 'flash', geste: [8], dur: [0.26], impactAt: [0], mul: [1], hitstop: [0.04], trauma: [0.12], sfx: [-1], arcDeg: [0], avance: [0] },
  ],
  iaido: { dist: 2.6, half: 0.9, invuln: 0.3, length: 1.7 }, // dégainé : le héros file dist m à travers la cible ; trait de demi-largeur half, long de length × portée
  // Dessin des gestes (repère du buste ; rad). « bras » : amplitude de la taille, de part et d'autre de l'axe de visée.
  pose: { bras: 1.25, brasLourd: 1.6, torsion: 0.55, torsionLourd: 0.8, accroupi: 0.1, lissage: 0.035 },
  trainee: { vie: 0.2, vieVrille: 0.32, vieIaido: 0.24, hauteur: 0.95, bord: [1.0, 0.3, 0.02], chaud: [1.0, 0.78, 0.45] }, // accent 0xEF9628 en linéaire
  lames: { court: [0.035, 0.62, 0.012], katana: [0.032, 1.05, 0.012], couleur: 0xef9628 }, // lame droite du Shinobi et katana (une boîte mise à l'échelle)
  // Pose des tourelles (sentinelle et grosse tourelle) : atterrissage (secousse au sol, poussière), puis déploiement
  // (montée courte + écrasement / rebond) AVANT le premier tir.
  deploy: { unfold: 0.28, trauma: 0.08, puffs: 6, puffColor: 0xb9a27a, ring: 1.1 },
};
VFX_VIE[VFX_STYLE.TRAINEE_LAME] = COMBOS.trainee.vie;
VFX_VIE[VFX_STYLE.VRILLE] = COMBOS.trainee.vieVrille;
// Sons (socle E3, § E3.0.7) : découpes de la banque « sfx game » de Femz, CANDIDATS à valider.
AUDIO.sounds[SFX.SLASH_LIGHT] = { dur: 0.18, gain: 0.2, minInterval: 0.05, maxVoices: 3, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.SLASH_HEAVY] = { dur: 0.4, gain: 0.26, minInterval: 0.08, maxVoices: 2, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.IAIDO] = { dur: 0.5, gain: 0.3, minInterval: 0.15, maxVoices: 2, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.TURRET_PLANT] = { dur: 0.4, gain: 0.26, minInterval: 0.1, maxVoices: 2, pitchVar: 0, priority: 1 };
//#endregion e3:M-anim-shinobi-bastion


//#region e3:Z-retours-1611
// =====================================================================================================
// CORRECTIF DE L'ÉTAPE 3 — retours de Femz du 16/11/2026 (ARCHITECTURE.md § E3.Z). Chiffres de ses 13 retours.
// =====================================================================================================
// R12, levier choisi par Femz (« la sentinelle du robot doit emmetre un petit champ de force qui repousse les ennemis,
// ca permet au bastion de temporiser malgres sa lenteur ») : bulle autour de chaque tourelle DÉPLIÉE. Impulsion de recul
// par seconde (masse 1) à la distance d du centre : force × (plancher + (1 − plancher) × (1 − d / R)), divisée par la
// masse, amortie par DAMAGE.knockbackDamp (9 /s) : un robot de vitesse v et de masse m s'arrête là où
// force × profil / (m × 9) = v. La bulle n'est pas centrée sur le héros (tourelle posée 1,2 m dans son dos) : pour
// qu'elle le protège, un robot AU CONTACT du héros côté opposé (≈ 2,15 m du centre) doit encore être tenu. Au niveau 1
// (force 110, rayon 3, plancher 0,4) : profil 0,57 → rôdeur tenu (7 m/s de poussée contre 3,4), drone (m 0,5) tenu
// (13,9 contre 6), kamikaze (m 0,8) tenu ; blindé (m 6 : 1,2 contre 1,7) et Scanner (m 50) passent ; drone élite tenu de
// justesse (× 0,45) ; drone en piqué (15,6 m/s) freiné mais pas arrêté ; tirs à distance jamais arrêtés. 1re mesure
// (force 60, rayon 2,6, plancher 0,25 : coups reçus inchangés, 9 → 9, tests/.cache/z1611/sonde-contacts.mjs) : trop faible.
WEAPONS[WEAPON.TURRET].champ = {
  r0: 3.0, // m — rayon au niveau 1 de l'arme
  rNiv: 0.05, // m de plus par niveau de l'arme
  rMax: 3.8, // m — plafond du rayon
  force0: 110, // impulsion /s au centre (masse 1) au niveau 1
  forceNiv: 3, // de plus par niveau
  forceMax: 160, // plafond (« pas intouchable »)
  plancher: 0.4, // part de la force au bord de la bulle (0 : nulle au bord, 1 : constante)
  eliteMul: 0.45, // élites porteuses (EFLAG.ELITE) : moins repoussées
  maxPousses: 24, // robots poussés au plus par tourelle et par pas (les premiers rendus par la grille)
  degats: 0, // PV retirés par le champ : aucun (contrôle seulement, règle de Femz)
  ouverture: 0.25, // s — la bulle s'ouvre après le dépliage (et se referme au repli)
  ondeVie: 0.45, // s — onde dessinée après une poussée
  ondeEvery: 0.9, // s au plus souvent entre deux ondes d'une même tourelle
  sonEvery: 1.4, // s au plus souvent entre deux sons de poussée (toutes tourelles)
  hauteur: 0.04, // m — anneau couché au sol
  marge: 0.5, // m — marge du quad autour du rayon
};
// R12, leviers suivants (la bulle seule ne tient pas la cible, mesure du 16/11 : PV perdus aux vagues 1–3, joueur-robot
// « bon », 3 graines — Éclaireur 6, Bastion 43,7 avant, 32,3 avec la bulle) : la tourelle vise d'abord le robot le plus
// proche du héros (garde : rayon minimal de ce cercle, m), et le Bastion marche un peu plus vite (0,88 → speedMul ci-dessous,
// toujours le plus lent des trois).
WEAPONS[WEAPON.TURRET].garde = 2;
WEAPONS[WEAPON.TURRET].deployEvery = 1; // s — un emplacement repose sa tourelle plus vite (2 avant : 2 s sans bulle ni tir sur 10)
AGENTS[AGENT.BASTION].stats.speedMul = 0.94;
// R11 : un dash propre à chaque agent (src/dash-agents.js). Même touche, même recharge (PLAYER.dash.cooldown × agent),
// même invulnérabilité ; « chaque passif ne doivent faire que tres peu de degats » : contrôle d'abord, dégâts symboliques.
// Dégâts comparés à l'arme de départ sur UNE recharge du dash (3 s) : blaster 10 × 2 /s = 60 sur une cible ; sentinelle
// 8 × 2 /s = 48 ; lame de phase (Shinobi) — voir ARCHITECTURE.md § E3.Z.11 pour la mesure.
export const DASH_AGENTS = {
  // Éclaireur — glissade propulsée : même trajet que le dash ; la traînée (début → fin) vit `vie` s ; tous les `tic` s,
  // chaque robot dessus est ralenti (× ralenti pendant ralentiS s) et piqué de `degats` PV (au plus vie / tic piqûres).
  glissade: { vie: 1.6, tic: 0.4, demiLargeur: 0.9, ralenti: 0.45, ralentiS: 0.7, degats: 1, arcEvery: 0.07 },
  // Bastion — bond sismique : vitesse × vitesseMul, durée × dureeMul (≈ 4,5 m en 0,34 s au lieu de 4,3 m en 0,18 s),
  // bond de `hauteur` m (dessin), onde de choc de `rayon` m à l'atterrissage : recul (impulsion / masse, moitié au bord),
  // ralenti, `degats` PV une fois par robot ; secousse `trauma`.
  bond: { vitesseMul: 0.55, dureeMul: 1.9, hauteur: 0.75, rayon: 3.2, recul: 10, degats: 2, ralenti: 0.6, ralentiS: 0.5, trauma: 0.2,
    couleur: ARSENAL_VFX.couleur0 + (WEAPON.HAMMER - WEAPON.KATANA), poussiere: 8, poussiereCouleur: 0xb9a27a },
  // Shinobi — pas de l'ombre : téléportation de `distance` m dans la direction de marche (le dash de base fait 4,3 m),
  // bouffées de fumée aux deux bouts ; leurre `leurreS` s qui tire vers lui les robots à moins de `leurreRayon` m
  // (impulsion `attraction` /s, divisée par la masse) ; aucun dégât.
  ombre: { distance: 4.3, invuln: 0.3, image: 0.045, // § E5.X3 : > LOOP.maxDt (1/30 s) — à 1/60 s, le « dash » d'une image était
    // consommé dans le même player.update : Moteur cinétique, Brise-ligne et Surrégime ne le voyaient jamais (mesuré : 0 PV)
    leurreS: 1.0, leurreRayon: 7, attraction: 45, bouffees: 8, bouffeeEvery: 0.12,
    fumee: 0x2a2238, anneau: 0x7a5cff },
};
// R10 : « ameliore les coup du shinobi, ca fait pas asser ninja, il fait juste un coup de lame sans bouger et ca fait
// statique » — fente RÉELLE vers la cible entre les coups (src/anim/combos.js : le héros avance, la zone de touche suit ;
// petits pas, jamais une charge dans la horde : au plus 0,5 m par coup), appuis plus bas, buste qui tourne plus, vrille
// EN L'AIR pour finir la double lame, dégainé avec un temps d'arrêt plus long et un rengainé lent ; arrêts sur image et
// secousses un peu plus marqués sur les finitions.
{
  const B = COMBOS.list[0];
  B.fente = [0.35, 0.35, 0.35, 0.35, 0.5]; // m — fente réelle de chaque coup (la vrille bondit vers la cible)
  B.avance = [0.25, 0.25, 0.25, 0.25, 0.1]; // m — pas glissé dessiné en plus (corps en avant du point de jeu)
  B.dur = [0.17, 0.17, 0.17, 0.17, 0.42];
  B.impactAt = [0.08, 0.08, 0.08, 0.08, 0.24];
  B.hitstop = [0.03, 0.015, 0.03, 0.015, 0.09];
  B.trauma = [0.05, 0.05, 0.06, 0.06, 0.2];
  const K = COMBOS.list[1];
  K.fente = [0.5, 0.5, 0]; // le dégainé traverse déjà (COMBOS.iaido.dist)
  K.avance = [0.35, 0.35, 0];
  K.dur = [0.32, 0.32, 0.78]; // dégainé : arrêt (anticipation 0,42 s), traversée, rengainé LENT
  K.impactAt = [0.14, 0.14, 0.42];
  K.hitstop = [0.045, 0.05, 0.14];
  K.trauma = [0.1, 0.13, 0.36];
  for (const C of COMBOS.list) if (!C.fente) C.fente = C.geste.map(() => 0);
  COMBOS.pose.accroupi = 0.19; // m — appuis bas (0,1 avant)
  COMBOS.pose.torsion = 0.8; // rad — le buste accompagne la taille (0,55 avant)
  COMBOS.pose.torsionLourd = 1.05; // (0,8 avant)
  COMBOS.pose.saut = 0.55; // m — hauteur de la vrille aérienne
}
// R3 : « frappe eclair … ca devrais etre activable par une touche reglable (de base touche A ou E) ». Codes PHYSIQUES
// (KeyboardEvent.code) : KeyQ = la touche A en AZERTY (Q en QWERTY), KeyE = E partout. Réglable dans « Touches »
// (localStorage, clé STRIKE_KEYS.cle). Une pression pendant la recharge reste valable bufferSeconds.
INPUT.actions[ACTION.STRIKE] = ['KeyQ']; // § E5.C (17/11) : E passe à « Interagir » (région e5:C-interagir)
export const STRIKE_KEYS = { cle: 'sr-touches-frappe', defaut: ['KeyQ'], bufferSeconds: 0.25 };
// R7 : pseudo du joueur (menu principal), 15 caractères au plus, gardé dans le navigateur
export const PSEUDO = { max: 15, defaut: 'AGENT', cle: 'sr-pseudo' };
// R9 : portrait 3D de la pause moins pixelisé (« perso moin pixelisé ») — 1 px CSS par pixel d'art au lieu de 3
// (résolution × 3, toujours sans flou : agrandissement au plus proche voisin), et rotation au glisser.
PAUSE.pixel = 1;
PAUSE.rotation = { radParPx: 0.012, retourS: 0.6 }; // rad par px glissé ; constante de temps du retour à la vue 3/4 (s)
// R13b : ligne de chiffres d'une arme sous sa phrase d'effet (cartes de lot) — ses deux premières stats au niveau 1.
/** « Niveau 1 : 12 dégâts, 2 /s » (hors combat : construit une chaîne). */
export function weaponLine(w) {
  const W = WEAPONS[w];
  const fr = (x) => String(Math.round(x * 100) / 100).replace('.', ',');
  const part = (k) => W.statLabels[k] + ' ' + fr(W.stats[k][0]) + (W.statUnits[k] ? ' ' + W.statUnits[k].trim() : '');
  return 'Niveau 1 : ' + part(0) + ', ' + part(1);
}
// Son du champ : découpe de « Champ EMP.wav » (banque de Femz), aiguë et courte, 8 dB sous la pose de tourelle. CANDIDAT.
AUDIO.sounds[SFX.FIELD] = { dur: 0.35, gain: 0.12, minInterval: 0.3, maxVoices: 2, pitchVar: 1, priority: 0 };
//#endregion e3:Z-retours-1611

//#region e4:A-meta-defis
// =====================================================================================================
// ÉTAPE 4 DU PLAN ADDICTIF, CHANTIER A (ARCHITECTURE.md § E4.A) : méta-progression par DÉBLOCAGES seulement (aucune
// stat permanente), 20 succès, monnaie méta (« Cycles », nom proposé), verrous du tirage. Lu par src/meta.js et
// src/defis.js. Clés en chaînes : 'arme:<WEAPON_KEYS>', 'objet:<ITEM_KEYS>', 'util:<clé UTILITIES>', 'agent:<clé>',
// recettes 'evo:<clé EVOLUTIONS>' et 'fusion:<clé FUSIONS>'.
// =====================================================================================================
/** Résultat de meta.buy(key). */
export const META_BUY = Object.freeze({ OK: 0, TOO_POOR: 1, NOT_FOR_SALE: 2, ALREADY: 3 });
export const META = {
  // Les 16 éléments verrouillés au départ (§ E4.A.2) ; tout le reste est jouable dès la première partie.
  verrous: {
    agent: ['bastion', 'shinobi'],
    arme: ['rail', 'ricochet', 'cannon', 'pool', 'katana', 'smoke'],
    objet: ['detonator', 'berserk', 'drone', 'capacitor', 'luck', 'save'],
    util: ['turbo', 'compute'],
  },
  // Prix en Cycles (onglet Déblocages) ; enVenteDepart : achetables sans succès. Total : 1 000.
  prix: {
    'arme:rail': 60, 'arme:ricochet': 60, 'objet:detonator': 80, 'util:turbo': 80, 'arme:pool': 100, 'arme:smoke': 100,
    'objet:berserk': 120, 'objet:capacitor': 120, 'objet:luck': 140, 'util:compute': 140,
  },
  enVenteDepart: ['arme:rail', 'arme:ricochet', 'objet:detonator', 'util:turbo'],
  // Barème (§ E4.A.3) : Cycles = vague atteinte × vague + boss détruits × boss + élites × elite + succès de la partie × succes
  bareme: { vague: 8, boss: 30, elite: 2, succes: 25 },
  // Paramètre d'URL de ?debug (§ E4.0.2) : 'tout' (défaut), 'vierge', 'depart' (en mémoire, rien d'écrit), 'stockage'
  // (le stockage réel, comme sans ?debug : tests de persistance)
  urlParam: 'meta',
  debugDefaut: 'tout',
};
/** Condition d'un succès : un code entier (defis.js teste sans fermeture ni objet lu par image). */
export const DEFI_COND = Object.freeze({
  VAGUE: 0, KILLS_CUMUL: 1, KILLS_TYPE: 2, KILLS_SOURCE: 3, BOSS: 4, BOSS_RANG: 5, COFFRES: 6, ARMES_EN_MAIN: 7,
  OBJETS_EN_MAIN: 8, PV_BAS: 9, JACKPOT: 10, FRAGMENTS: 11, FUSION: 12, ELITES: 13, EVOLUTIONS: 14, ARME_SEULE: 15,
});
/** Sorte de récompense : débloque (dans le tirage), met en vente (onglet Déblocages), révèle (recette au carnet). */
export const DEFI_RECOMP = Object.freeze({ DEBLOQUE: 0, VENTE: 1, REVELE: 2 });
/**
 * Les 20 succès (§ E4.A.2). cond : DEFI_COND ; n : seuil ; arg : type de robot (ENEMY.*), source (WEAPON.*) ou -1 ;
 * agent : agent imposé (-1 : tous) ; cumul : toutes parties confondues (sinon dans une seule partie) ; finVague : testé
 * seulement au début de WAVE_CLEAR ; reward : clé débloquée, mise en vente ou révélée ; texte : la condition en clair.
 * Seuils SUPPOSÉS, pas joués (§ E4.Y).
 */
export const DEFIS = {
  periode: 0.5, // s entre deux tests des conditions (defis.tick, en PLAYING)
  pvBas: 0.25, // part des PV max sous laquelle le temps « Sur le fil » est compté
  cyclesParSucces: 25, // = META.bareme.succes
  toastSeconds: 3, // notification en partie (§ E4.A.6)
  toastInSeconds: 0.2,
  toastKicker: 'SUCCÈS',
  rewardPrefix: ['Débloqué : ', 'En vente : ', 'Recette révélée : '],
  list: [
    { key: 'vague3', name: 'Secteur sécurisé', cond: DEFI_COND.VAGUE, n: 3, arg: -1, agent: -1, cumul: false, reward: 'evo:canon-chiffre', sorte: DEFI_RECOMP.REVELE, texte: 'Atteindre la vague 3' },
    { key: 'vague5', name: 'Pare-feu levé', cond: DEFI_COND.VAGUE, n: 5, arg: -1, agent: -1, cumul: false, reward: 'agent:bastion', sorte: DEFI_RECOMP.DEBLOQUE, texte: 'Atteindre la vague 5' },
    { key: 'kills2000', name: 'Purge de masse', cond: DEFI_COND.KILLS_CUMUL, n: 2000, arg: -1, agent: -1, cumul: true, reward: 'agent:shinobi', sorte: DEFI_RECOMP.DEBLOQUE, texte: 'Détruire 2 000 robots (toutes parties)' },
    { key: 'boss1', name: 'Redémarrage forcé', cond: DEFI_COND.BOSS, n: 1, arg: -1, agent: -1, cumul: false, reward: 'objet:save', sorte: DEFI_RECOMP.DEBLOQUE, texte: 'Détruire un boss' },
    { key: 'coffres10', name: 'Pilleur de caches', cond: DEFI_COND.COFFRES, n: 10, arg: -1, agent: -1, cumul: true, reward: 'objet:drone', sorte: DEFI_RECOMP.DEBLOQUE, texte: 'Ouvrir 10 coffres (toutes parties)' },
    { key: 'lame250', name: 'Lame longue', cond: DEFI_COND.KILLS_SOURCE, n: 250, arg: WEAPON.BLADE, agent: AGENT.SHINOBI, cumul: false, reward: 'arme:katana', sorte: DEFI_RECOMP.DEBLOQUE, texte: 'Détruire 250 robots avec la Lame de phase dans une partie (Shinobi)' },
    { key: 'sentinelle200', name: 'Ligne de défense', cond: DEFI_COND.KILLS_SOURCE, n: 200, arg: WEAPON.TURRET, agent: AGENT.BASTION, cumul: false, reward: 'arme:cannon', sorte: DEFI_RECOMP.DEBLOQUE, texte: 'Détruire 200 robots avec la Sentinelle dans une partie (Bastion)' },
    { key: 'blindes100', name: 'Ouvre-boîte', cond: DEFI_COND.KILLS_TYPE, n: 100, arg: ENEMY.BLINDE, agent: -1, cumul: true, reward: 'arme:pool', sorte: DEFI_RECOMP.VENTE, texte: 'Détruire 100 blindés (toutes parties)' },
    { key: 'armes4', name: 'Arsenal', cond: DEFI_COND.ARMES_EN_MAIN, n: 4, arg: -1, agent: -1, cumul: false, reward: 'arme:smoke', sorte: DEFI_RECOMP.VENTE, texte: 'Posséder 4 armes en même temps' },
    { key: 'pvbas30', name: 'Sur le fil', cond: DEFI_COND.PV_BAS, n: 30, arg: -1, agent: -1, cumul: false, finVague: true, reward: 'objet:berserk', sorte: DEFI_RECOMP.VENTE, texte: 'Passer 30 s sous 25 % de vos PV, puis survivre à la vague' },
    { key: 'objets6', name: 'Greffes multiples', cond: DEFI_COND.OBJETS_EN_MAIN, n: 6, arg: -1, agent: -1, cumul: false, reward: 'objet:capacitor', sorte: DEFI_RECOMP.VENTE, texte: 'Avoir 6 objets passifs différents en même temps' },
    { key: 'jackpot', name: 'Jackpot', cond: DEFI_COND.JACKPOT, n: 1, arg: -1, agent: -1, cumul: false, reward: 'objet:luck', sorte: DEFI_RECOMP.VENTE, texte: 'Ouvrir un coffre à 5 lots' },
    { key: 'fragments1500', name: 'Moissonneur', cond: DEFI_COND.FRAGMENTS, n: 1500, arg: -1, agent: -1, cumul: false, reward: 'util:compute', sorte: DEFI_RECOMP.VENTE, texte: 'Gagner 1 500 fragments dans une partie' },
    { key: 'fusion1', name: 'Compilation', cond: DEFI_COND.FUSION, n: 1, arg: -1, agent: -1, cumul: false, reward: 'fusion:malware', sorte: DEFI_RECOMP.REVELE, texte: "Faire une fusion d'objets" },
    { key: 'elites50', name: 'Chasseur de porteurs', cond: DEFI_COND.ELITES, n: 50, arg: -1, agent: -1, cumul: true, reward: 'evo:lance-prisme', sorte: DEFI_RECOMP.REVELE, texte: 'Détruire 50 élites (toutes parties)' },
    { key: 'vague10', name: 'Dix secteurs', cond: DEFI_COND.VAGUE, n: 10, arg: -1, agent: -1, cumul: false, reward: 'evo:forteresse', sorte: DEFI_RECOMP.REVELE, texte: 'Atteindre la vague 10' },
    { key: 'kamikazes200', name: 'Démineur', cond: DEFI_COND.KILLS_TYPE, n: 200, arg: ENEMY.KAMIKAZE, agent: -1, cumul: true, reward: 'fusion:reaction', sorte: DEFI_RECOMP.REVELE, texte: 'Détruire 200 kamikazes (toutes parties)' },
    { key: 'evolutions3', name: 'Bibliothécaire', cond: DEFI_COND.EVOLUTIONS, n: 3, arg: -1, agent: -1, cumul: true, reward: 'evo:nuage-frag', sorte: DEFI_RECOMP.REVELE, texte: 'Découvrir 3 évolutions différentes' },
    { key: 'blasterSeul8', name: 'Puriste', cond: DEFI_COND.ARME_SEULE, n: 8, arg: WEAPON.BLASTER, agent: AGENT.ECLAIREUR, cumul: false, reward: 'fusion:restauration', sorte: DEFI_RECOMP.REVELE, texte: 'Atteindre la vague 8 avec le Blaster pour seule arme (Éclaireur)' },
    { key: 'boss2', name: 'Mise à jour refusée', cond: DEFI_COND.BOSS_RANG, n: 2, arg: -1, agent: -1, cumul: false, reward: 'fusion:essaim', sorte: DEFI_RECOMP.REVELE, texte: 'Détruire le boss de rang 2 (vague 10)' },
  ],
};
export const DEFI_COUNT = 20;
// Son du succès (§ E4.0.3) : découpe de « Nouveau record.wav » (banque de Femz), + 5 demi-tons, 0,9 s. CANDIDAT.
AUDIO.sounds[SFX.SUCCES] = { dur: 0.9, gain: 0.4, minInterval: 0.5, maxVoices: 1, pitchVar: 0, priority: 2 };
//#endregion e4:A-meta-defis

//#region e4:B-hub
// =====================================================================================================
// ÉTAPE 4 DU PLAN ADDICTIF, CHANTIER B (ARCHITECTURE.md § E4.B) : le hub « Noyau » (nom proposé) ouvert depuis l'écran
// titre, quatre onglets (Agents, Collection, Succès, Déblocages), DA FUI, parallaxe légère au pointeur. Tout est du DOM
// (0 appel de dessin) et hors combat. Construit par src/ui-hub.js ; touches lues par main.js (STATE.HUB).
// =====================================================================================================
export const HUB = {
  bouton: 'Noyau', // bouton de l'écran titre (à côté de « Jouer »)
  touche: 'H', // affichée sur le bouton (ACTION.HUB = KeyH)
  chemin: 'SYSTÈME / NOYAU',
  lead: 'Ce que le noyau a récupéré sur l’AGI : agents, modules, succès.',
  onglets: [
    { key: 'agents', label: 'Agents' },
    { key: 'collection', label: 'Collection' },
    { key: 'succes', label: 'Succès' },
    { key: 'deblocages', label: 'Déblocages' },
  ],
  // Parallaxe (§ E4.B.2) : même réglage que l'écran des agents, plus léger — fond de grille, panneau, contenu de l'onglet
  parallax: { layersPx: [4, 8, 14], rate: 8, deadPx: 0.5 },
  guardSeconds: 0.25, // clics et touches ignorés à l'ouverture
  colonnes: { collection: 9, deblocages: 3 }, // cases par rangée (navigation au clavier : rangées calculées à la construction)
  familles: [
    { key: 'arme', label: 'Armes' },
    { key: 'evo', label: 'Évolutions' },
    { key: 'objet', label: 'Objets passifs' },
    { key: 'fusion', label: 'Fusions' },
    { key: 'agent', label: 'Agents' },
    { key: 'robot', label: 'Robots' },
  ],
  robotPortraits: 'assets/ui/robots/robot-', // + <type>.png (outils/blender/portraits_robots.py, § E4.B.4)
  monnaie: 'CYCLES',
  monnaieGlyphe: '◈', // ◈
  resetConfirms: 2, // « Réinitialiser la progression » : deux confirmations avant meta.reset()
  textes: {
    inconnu: '?',
    jamaisVu: 'Pas encore rencontré.',
    verrou: 'Verrouillé',
    pourDebloquer: 'Pour le débloquer : ',
    viaSucces: 'Succès : ',
    enVente: 'En vente : ',
    puisVente: ', puis en vente : ',
    choisi: 'Agent de départ',
    choisir: 'Choisir',
    jouer: 'Jouer',
    debloquer: 'Débloquer',
    debloque: 'Débloqué',
    attente: 'À gagner : ',
    tropPauvre: 'Pas assez de Cycles',
    reussi: 'Réussi',
    enCours: 'En cours',
    dansPartie: 'dans une seule partie',
    recette: 'Recette', // § E5.W : étiquette au-dessus de la formule à icônes (plus de phrase « Recette : A + B »)
    evolutionLab: 'Évolution', // § E5.W : fiche d'une arme, la recette de son évolution
    revele: 'Recette révélée',
    detruits: ' détruits',
    reset: 'Réinitialiser la progression',
    resetConfirm: ['Confirmer : tout effacer ?', 'Vraiment ? Succès, Cycles et déblocages perdus'],
    solde: 'Solde',
    gagnes: 'gagnés depuis le début',
    aideAgents: 'Clic : agent de départ \u00b7 Entrée sur l\u2019agent de départ : la partie démarre',
    chargementAgent: 'Chargement', // § E5.W : portrait de la fiche pendant la lecture du modèle de l'agent choisi
  },
};
// Son du déblocage (§ E4.0.3) : découpe de « Achat.wav » (banque de Femz), − 4 demi-tons, 0,6 s. CANDIDAT.
AUDIO.sounds[SFX.UNLOCK] = { dur: 0.6, gain: 0.35, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 };
INPUT.actions.push(['KeyH'], ['Digit4', 'Numpad4']); // ACTION.HUB (17), ACTION.CHOICE_4 (18)
//#endregion e4:B-hub

//#region e4:C-bilan
// =====================================================================================================
// ÉTAPE 4 DU PLAN ADDICTIF, CHANTIER C (ARCHITECTURE.md § E4.C) : bilan par arme et Cycles gagnés à l'écran de fin.
// Lignes composées par src/bilan.js (compteurs de damage.js, sans allocation en combat), affichées par src/ui-bilan.js.
// =====================================================================================================
export const BILAN = {
  lignesMax: 8, // lignes visibles du tableau des armes (défilement au-delà)
  delai: 0.35, // s — la montée des Cycles part après le son de fin de partie
  montee: 1.0, // s — le total des Cycles monte de 0 à sa valeur
  sonEvery: 0.06, // s — son FRAGMENT au plus toutes les 0,06 s pendant la montée (= son minInterval)
  rootColor: RARITIES[5].color, // lueur de la meilleure arme (rareté Root, comme un succès réussi du hub)
  iconeObjets: 'sr-m-tesla', // icône de la ligne « Modules et dash »
  iconeUtil: 'sr-u-iem', // icône de la ligne « Utilitaires »
  succesMax: 2, // succès de la partie listés sous les Cycles (au-delà : « +N » sur le titre) ; 3 débordent en 1280 × 720 (mesuré)
  textes: {
    chemin: 'SYSTÈME / BILAN',
    armes: 'Bilan des armes',
    cols: ['Arme', 'Dégâts', 'Kills', 'Part'],
    objets: 'Modules et dash',
    util: 'Utilitaires',
    evoluee: 'évoluée',
    absorbee: 'absorbée',
    vide: 'Aucun dégât infligé.',
    cycles: 'Cycles',
    vague: 'Vague',
    boss: 'Boss',
    elites: 'Élites',
    succes: 'Succès',
    gain: 'Gagnés',
    solde: 'Solde',
    record: 'Record de vague',
    nouveau: 'nouveau',
    nonCompte: 'Partie non comptée',
    succesTitre: 'Succès de la partie',
    noyau: 'À voir dans le Noyau',
  },
};
//#endregion e4:C-bilan

//#region e4:D-touches
// Étape 4, chantier D (§ E4.D) — demande de Femz du 16/11 (10h30) : « amerliore la lisibilité, l'estetique et rend les
// touches modifiable ». Toutes les actions du tableau « Touches » de la pause ont une touche principale et une
// secondaire (codes PHYSIQUES KeyboardEvent.code). Les défauts sont ceux d'INPUT (une seule source) : ZQSD (AZERTY) et
// WASD (QWERTY) sont les mêmes codes, A / E et Q / E aussi (KeyQ KeyE) ; seul le libellé suit la disposition.
// Stockage : UNE clé, celle de la frappe éclair de l'étape 3 (STRIKE_KEYS.cle), reprise au format v2 ; un tableau (v1)
// y est lu comme la frappe éclair seule.
export const TOUCHES = {
  cle: STRIKE_KEYS.cle,
  version: 2,
  // id, libellé, dir (0 haut, 1 bas, 2 gauche, 3 droite) OU action (ACTION.*), colonne du tableau, groupe ouvert par la ligne
  lignes: [
    { id: 'haut', label: 'Haut', dir: 0, col: 0, groupe: 'Déplacement' },
    { id: 'bas', label: 'Bas', dir: 1, col: 0 },
    { id: 'gauche', label: 'Gauche', dir: 2, col: 0 },
    { id: 'droite', label: 'Droite', dir: 3, col: 0 },
    { id: 'dash', label: 'Dash', action: ACTION.DASH, col: 0, groupe: 'Combat' },
    { id: 'frappe', label: 'Frappe éclair', action: ACTION.STRIKE, col: 0 },
    { id: 'pause', label: 'Pause', action: ACTION.PAUSE, col: 0, groupe: 'Menus' },
    { id: 'valider', label: 'Valider', action: ACTION.CONFIRM, col: 0 },
    { id: 'noyau', label: 'Noyau', action: ACTION.HUB, col: 0 },
    { id: 'choix1', label: 'Choix 1', action: ACTION.CHOICE_1, col: 1, groupe: 'Écrans de choix' },
    { id: 'choix2', label: 'Choix 2', action: ACTION.CHOICE_2, col: 1 },
    { id: 'choix3', label: 'Choix 3', action: ACTION.CHOICE_3, col: 1 },
    { id: 'choix4', label: 'Onglet 4 (Noyau)', action: ACTION.CHOICE_4, col: 1 },
    { id: 'relancer', label: 'Relancer', action: ACTION.REROLL, col: 1 },
    { id: 'passer', label: 'Passer', action: ACTION.SKIP, col: 1 },
    { id: 'bannir', label: 'Bannir', action: ACTION.BANISH, col: 1 },
    { id: 'camera', label: 'Caméra', action: ACTION.CAMERA, col: 1, groupe: 'Vue' },
  ],
  garde: 'Escape', // ouvre TOUJOURS la pause, en plus de la touche choisie (on ne peut pas se bloquer)
  effacer: 'Backspace', // pendant l'attente : vide la case (refusé si l'action n'aurait plus aucune touche)
  // refusées au réglage : Échap (garde, et annule l'attente), Retour arrière (efface), Tab, F1 à F12 (debug, navigateur)…
  reservees: ['Escape', 'Backspace', 'Tab', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock'],
  codeMax: 24, // caractères d'un code accepté (lettres et chiffres seulement)
  textes: {
    principale: 'Principale',
    secondaire: 'Secondaire',
    repos: 'Cliquez sur une touche pour la changer.',
    attente: 'Appuyez sur une touche pour « {a} » · Échap annule · Retour arrière efface',
    pris: '« {a} » : {t}.',
    echange: '{t} était sur « {b} » : échangée, « {b} » prend {u}.',
    echangeVide: '{t} était sur « {b} » : « {b} » n\'a plus de touche.',
    reservee: '{t} est réservée : choisissez une autre touche.',
    efface: 'Touche de « {a} » effacée.',
    seule: '« {a} » garde au moins une touche.',
    annule: 'Réglage annulé.',
    defaut: 'Touches par défaut rétablies ({d}).',
    boutonDefaut: 'Touches par défaut',
    garde: 'Échap ouvre toujours la pause.',
    vide: '—',
    attenteCase: '· · ·',
  },
};
//#endregion e4:D-touches

//#region e4:E-hud-fiche
// ----- Étape 4, chantier E (ARCHITECTURE.md § E4.E) : demandes de Femz du 16/11 (10h45 à 12h00) — HUD, fiche, idle ----
// Bloc du bas du HUD (armes, PV, XP, NIV.) qui sort du cadre vers le bas quand la fiche (pause) ou l'écran de fin est
// ouvert ; la colonne d'objets sort vers la gauche. Glissement par la propriété CSS `translate` (sous-pixel).
export const HUD_RETIRE = {
  duree: 0.3, // s — « environ 0,3 s » (demande de Femz)
  basRem: 10, // rem vers le bas : le haut de la barre de PV (7,6 rem du bas en 720 p) passe sous le bord
  gaucheRem: 8, // rem vers la gauche : la colonne d'objets (3,875 rem + 2,8 rem de large) passe hors du bord
};
// Section CARACTÉRISTIQUES de la fiche (src/fiche-stats.js) : ordre des lignes, nom affiché, unité. Les valeurs sont
// LUES dans l'état du jeu (aucun chiffre ici) ; « fmt » choisit l'écriture : pv, pvs (PV/s), ms (m/s), m, s, pct
// (écart à 1 en %), pctMoins (part en moins), chance (part de 0 à 1 en %), mul (× 1,50).
export const FICHE_STATS = {
  titre: 'Caractéristiques',
  base: 'base',
  lignes: [
    // 20/11 (Femz : « sépare par une ligne horizontale les catégories ») : quatre groupes — survie, attaque,
    // mouvement, butin ; « groupe: true » = première ligne d'un groupe (un filet au-dessus, ui-pile.css)
    { id: 'pvMax', nom: 'PV max', fmt: 'pv' },
    { id: 'regen', nom: 'Régénération', fmt: 'pvs' },
    { id: 'blindage', nom: 'Dégâts reçus', fmt: 'pctMoins' },
    { id: 'degats', nom: 'Dégâts', fmt: 'pct', groupe: true },
    { id: 'cadence', nom: 'Cadence', fmt: 'pct' },
    { id: 'zone', nom: 'Zone', fmt: 'pct' },
    { id: 'critChance', nom: 'Critique', fmt: 'chance' },
    { id: 'critMul', nom: 'Dégâts critiques', fmt: 'mul' },
    { id: 'berserk', nom: 'Berserk (0 PV)', fmt: 'chance' },
    { id: 'vitesse', nom: 'Vitesse', fmt: 'ms', groupe: true },
    { id: 'dash', nom: 'Recharge du dash', fmt: 's' },
    { id: 'aimant', nom: 'Aimant', fmt: 'm' },
    { id: 'chance', nom: 'Chance (coffres)', fmt: 'chance', groupe: true },
    { id: 'fragments', nom: 'Fragments', fmt: 'pct' },
    { id: 'xp', nom: "Gain d'XP", fmt: 'pct' }, // § E5.Z : mods.xpGainMul (carte Apprentissage)
  ],
};
// Warrior Idle (Mixamo, cuit sur le robot par tests/cuire-anim.mjs) : idle du portrait de la fiche ET du héros
// immobile en partie. fonduS : constante de temps du fondu idle ↔ course (s) ; vitesseArret : m/s sous laquelle le
// héros est « à l'arrêt » ; hautSansVisee : le haut du corps ne prend la pose que si aucune arme ne vise.
export const HEROS_IDLE = {
  fichier: 'assets/anims/warrior-idle.json',
  fonduS: 0.12,
  vitesseArret: 0.35,
  actif: true,
};
// Écran titre (demande de Femz du 16/11, 11h40 : « enleve les tir dans l'acceuil, c'est chaint finalement ») : aucun
// tir (tourelles d'épaule, bras, rail), aucun son de tir. Le code reste : MENU.tirs = true le remet.
MENU.tirs = false;
// Portrait de la fiche : le retour doux à la vue 3/4 est supprimé (demande de Femz du 16/11, 10h55) — relâché, il
// garde son angle ; il revient de face à la réouverture de la fiche.
PAUSE.rotation.retourS = 0;
//#endregion e4:E-hud-fiche

//#region e4:F-repli
// Étape 4, chantier F (ARCHITECTURE.md § E4.F) — fin de chrono « repli puis retour », demande de Femz du 16/11 (11h30).
// À zéro (ou à la mort du boss), chaque survivant COURT vers le bord de l'écran le plus proche en s'éloignant du héros,
// yeux éteints, intouchable ; hors champ, il est « garé » (gardé, plus dessiné) ; au départ de la vague suivante, les garés
// rentrent par les bords, étalés dans le temps. Premier réglage SUPPOSÉ, mesuré par tests/e4-repli.test.mjs.
export const REPLI = {
  seconds: 2, // s — budget dur : tous hors champ en 2 s au plus (au-delà, garde-fou : garé quand même, compté)
  aimSeconds: 1.5, // s — la vitesse est réglée pour atteindre le bord en 1,5 s (marge si le héros court dans le même sens)
  speedMul: 2.2, // × vitesse du type : il court, plus vite qu'il ne marche (plancher de la vitesse)
  maxSpeed: 30, // m/s — plafond de la course (0,5 m par image à 60 i/s : jamais de saut)
  turnRate: 14, // rad/s — demi-tour vers sa direction de fuite (≈ 0,22 s pour 180°)
  edgeBias: 1, // poids de la normale du bord le plus proche dans la direction (0 = droit à l'opposé du héros)
  margin: 0.5, // m au-delà du champ de jeu (en plus du rayon, et de la hauteur vers le bas) pour être « hors champ »
  eyeGain: 0, // × émissif des yeux pendant le repli (éteints)
  fadeSeconds: 0.35, // s — tirs en vol et zones au sol rétrécissent jusqu'à 0, sans effet, puis disparaissent
  retour: {
    step: 0.08, // s entre deux entrées (ordre de E)…
    jitter: 0.05, // …plus un petit hasard…
    spread: 1.6, // …le tout ramené dans cette fenêtre s'ils sont nombreux (pas de paquet d'un coup)
    // (pas de lueur E.glow à l'entrée : essayée, elle teint TOUT le corps en vert vif — vu sur la planche, retirée ; les
    // yeux reprennent leur teinte par l'uniforme du type au départ de la vague)
  },
};
// « Yeux qui se rallument » : « Changement de phase.wav » − 3 demi-tons, 0,3 s, 9 dB sous CARRYOVER (candidat, § E4.F.5)
AUDIO.sounds[SFX.REVEIL] = { dur: 0.3, gain: 0.3, minInterval: 0.12, maxVoices: 2, pitchVar: 0.5, priority: 1 };
//#endregion e4:F-repli

//#region e4:G-recharges-niveaux
// Plan addictif, étape 4, chantier G (ARCHITECTURE.md § E4.G) — demande de Femz du 16/11 (11h55) : « quand on
// l'améliore, son cooldown diminue et son temps d'action augmente ». Prolonge RECHARGES (région e3:H) :
//   recharge(n) = max(min, seconds − perLevel × (n − 1))            (inchangée)
//   action(n)   = min(activeMax, active + activePerLevel × (n − 1))  (neuve)
// n = niveau d'arme (1 à 21) ou piles de l'objet. Plafonds atteints au niveau 21 (armes) et à 10 piles (objets).
// Garde-fou : activeMax / (activeMax + min) ≤ RECHARGE.maxShare (contrôle dur de tests/equilibrage.mjs) : la part du
// temps où la source agit ne dépasse jamais 0,7, à aucun niveau ; elle ne redevient jamais permanente.
// Liste (mesure du 16/11, tests/e3-H-mesure.mjs, § E4.G.1) : 4 armes du § E3.H + canon lourd + grenades ; 6 objets.
// Réglages SUPPOSÉS (calculés, pas joués) : niveau 1 = le réglage du § E3.H (action = active) ; part ≈ 0,2-0,4 au
// niveau 1, 0,45-0,67 au plafond.
RECHARGE.maxShare = 0.7;
RECHARGE.texteEffet = 'Chaque amélioration : recharge plus courte, action plus longue.'; // fiche (la description dit déjà « par salves »)
// armes déjà en recharge (§ E3.H) : on ajoute la croissance de l'action
Object.assign(RECHARGES.weapons.orbitals, { activePerLevel: 0.15, activeMax: 5 }); // 2 → 5 s ; part 0,22 → 0,63
Object.assign(RECHARGES.weapons.boomerang, { activePerLevel: 0.06, activeMax: 2.4 }); // 1,2 → 2,4 s ; 0,17 → 0,44
Object.assign(RECHARGES.weapons.pool, { activePerLevel: 0.1, activeMax: 3.2 }); // 1,2 → 3,2 s ; 0,11 → 0,33
Object.assign(RECHARGES.weapons.hammer, { activePerLevel: 0.05, activeMax: 2 }); // 1 → 2 s ; 0,17 → 0,45
// canon lourd (tir autonome, branché ici : posé au départ de la fenêtre, il vit action(n) s) : 0,38 → 0,67
// (avant : 10 à 18 s posé toutes les 3 s, soit 0,77 à 0,86 du temps)
RECHARGES.weapons.cannon = { seconds: 8, perLevel: 0.2, min: 4.5, active: 5, activePerLevel: 0.2, activeMax: 9, burst: 1.5, reach: 14, flight: 1.2, hideStat: 4 };
// grenades (moyenne 2 920 morts/min au niveau 21 sur deux passages, seuil 2 700) : 0,2 → 0,54
RECHARGES.weapons.grenade = { seconds: 6, perLevel: 0.15, min: 3, active: 1.5, activePerLevel: 0.1, activeMax: 3.5, burst: 1.5, salvo: 1, reach: 12, flight: 1.2 };
// objets au-dessus de RECHARGE.share à 5 piles (part des morts : Coque 79 %, Condensateur 53 %, Charge critique 54 %,
// Éclats 38 %, Surchauffe 37 %, Virus 29 %). reach : un robot à cette distance ouvre la fenêtre. flight : durée des
// effets déjà posés (feu 3 s, virus 4 s, onde, éclats) au-delà de laquelle la source ne frappe plus.
// color : indice VFX_COULEURS de l'éclat de départ (SUPPOSÉ : couleur d'arme la plus proche de celle de l'objet).
// every (Coque réactive) : s entre deux ondes dans la fenêtre (2 s hors mode recharge).
RECHARGES.items.reactive = { seconds: 4.5, perLevel: 0.25, min: 2.25, active: 0.6, activePerLevel: 0.15, activeMax: 1.95, burst: 1, reach: 4, flight: 0.6, every: 1, color: 3 }; // 0,12 → 0,46
RECHARGES.items.capacitor = { seconds: 6, perLevel: 0.3, min: 3.3, active: 1.5, activePerLevel: 0.2, activeMax: 3.3, burst: 1, reach: 12, flight: 0.6, color: 3 }; // 0,2 → 0,5
RECHARGES.items.detonator = { seconds: 5, perLevel: 0.25, min: 2.75, active: 1.5, activePerLevel: 0.15, activeMax: 2.85, burst: 1, reach: 10, flight: 0.6, color: 5 }; // 0,23 → 0,51
RECHARGES.items.shrapnel = { seconds: 5, perLevel: 0.25, min: 2.75, active: 1.5, activePerLevel: 0.15, activeMax: 2.85, burst: 1, reach: 10, flight: 0.6, color: 2 }; // 0,23 → 0,51
RECHARGES.items.burn = { seconds: 6, perLevel: 0.3, min: 3.3, active: 2, activePerLevel: 0.2, activeMax: 3.8, burst: 1, reach: 10, flight: 3.6, color: 5 }; // 0,25 → 0,54
RECHARGES.items.virus = { seconds: 6, perLevel: 0.3, min: 3.3, active: 2, activePerLevel: 0.2, activeMax: 3.8, burst: 1, reach: 10, flight: 4.6, color: 9 }; // 0,25 → 0,54
// Descriptions des sources (§ E4.G.4) : la phrase dit « par salves » (effet concret d'abord ; les chiffres viennent
// de cooldowns.salvesTexte, sur la fiche et les cartes).
WEAPONS[WEAPON.ORBITALS].desc = "Par salves, des disques tournent autour de vous et coupent les robots qui s'approchent.";
WEAPONS[WEAPON.BOOMERANG].desc = "Par salves : traverse les robots à l'aller, puis revient vers vous en les touchant encore.";
WEAPONS[WEAPON.POOL].desc = "Par salves, lance des flacons : la flaque au sol ronge les robots qui la traversent.";
WEAPONS[WEAPON.HAMMER].desc = "Par salves, frappe le sol : des ondes de choc blessent et repoussent tout autour de vous.";
WEAPONS[WEAPON.CANNON].desc = "Par salves, pose un canon lourd : il tire lentement mais fait de gros dégâts.";
WEAPONS[WEAPON.GRENADE].desc = "Par salves, lance des grenades sur les groupes de robots.";
ITEMS[ITEM.REACTIVE].desc = "Par salves : quand vous êtes touché, une onde blesse et repousse les robots autour de vous.";
ITEMS[ITEM.REACTIVE].pile = "onde de 4 m, une par seconde au plus pendant la salve";
ITEMS[ITEM.CAPACITOR].desc = "Après un certain nombre de robots tués, une impulsion frappe tous les robots à l'écran, pendant ses salves.";
ITEMS[ITEM.DETONATOR].desc = "Par salves, vos coups critiques font exploser la cible et blessent les robots autour.";
ITEMS[ITEM.SHRAPNEL].desc = "Par salves, les robots que vous tuez projettent parfois des éclats sur leurs voisins.";
ITEMS[ITEM.BURN].desc = "Par salves, vos coups mettent parfois le feu ; un robot qui meurt en brûlant enflamme ses voisins.";
ITEMS[ITEM.VIRUS].desc = "Par salves, chaque coup infecte le robot : il perd des PV pendant 4 s.";
//#endregion e4:G-recharges-niveaux

//#region e4:H-barres-vie
// Étape 4, chantier H (ARCHITECTURE.md § E4.H) — petite barre de vie au-dessus des gros robots, demande de Femz du 16/11
// (12h25) : « pas besoin sur les mob moins imposants », « fade out au bout d'un certain rayon ». A une barre : un type de
// `types`, une élite (EFLAG.ELITE) ou un fusionné (E.merged > 0) ; jamais le boss (barre du HUD). DA FUI carte mère :
// fond --cy-solid, plein à la couleur de la rareté (élite) ou --cy-text (repère neutre), traîne assombrie, sans texte.
// Premier réglage PROPOSÉ, à valider par Femz sur la planche tests/captures/e4-H-barres-vie-*.png.
export const BARRE = {
  types: [ENEMY.BLINDE], // le seul « gros » hors boss (DAMAGE.bigTypes) : 220 PV = 11 rôdeurs ; liste justifiée au § E4.H.1
  cap: 192, // barres écrites au plus par image (au-delà : non dessinées, comptées dans `overflow`)
  px: 0.045, // m — un pixel d'art (≈ 1 px d'écran en 720p au zoom 1, 2 px en 1440p)
  hPx: 5, // pixels d'art de haut : 1 de fond, 3 de plein, 1 de fond
  border: 1, // pixels d'art de fond autour du plein
  widthPerRadius: 2, // largeur = rayon dessiné (E.radius) × ceci…
  minM: 0.9, // …bornée à [minM, maxM] m, arrondie au pixel d'art (0,9 : le fusionné de deux rôdeurs, 1,2 m, est déjà plus large)
  maxM: 3,
  // Pose : depuis le haut de la tête (hover + hauteur dessinée), vers le HAUT DE L'ÉCRAN de rayon dessiné × sin(inclinaison)
  // × liftPerRadius (le bord arrière du robot, vu de la caméra) + lift. L'icône de modificateur (élites) passe au-dessus
  // de la barre, à iconGap (src/elites.js).
  liftPerRadius: 0.5,
  lift: 0.12, // m d'écran
  iconGap: 0.12, // m d'écran entre le haut de la barre et le bas de l'icône de modificateur
  rayon: 14, // m — pleine opacité jusqu'ici autour du HÉROS (≈ moitié de la demi-largeur 28,4 m au zoom 1 en 16:9) ; ÷ zoom
  bande: 7, // m — puis fondu doux (1 − smoothstep) jusqu'à 0 sur cette bande ; ÷ zoom
  fadeIn: 0.25, // s — la barre apparaît (apparition, retour d'un reporté)
  fadeOut: 0.15, // s — la barre s'efface (repli de fin de vague, veille) : jamais en une image
  backColor: 0x070b10, // --cy-solid
  backAlpha: 0.78,
  neutralColor: 0xe4ebf1, // --cy-text : repère neutre (blindé, fusionné)
  trail: {
    hold: 0.28, // s — la part perdue reste, puis…
    omega: 9, // 1/s — …rejoint le plein sur un ressort critique (lent → rapide → lent ; 95 % en ≈ 0,53 s)
    mul: 0.42, // × la couleur du plein (traîne assombrie)
    eps: 0.002, // part sous laquelle la traîne est « au repos » (un coup la fige alors hold s)
  },
  order: 9, // renderOrder (sous les chiffres de dégâts : RENDER.decals.numbersOrder 10)
};
//#endregion e4:H-barres-vie

//#region e4:I-cycles-patchnotes-succes
// =====================================================================================================
// ÉTAPE 4 DU PLAN ADDICTIF, CHANTIER I (ARCHITECTURE.md § E4.I) : barème de la monnaie méta décidé par Femz (16/11,
// 12h50), nom de la monnaie (lu ICI seulement), prix par palier de puissance, catégories de l'onglet Déblocages,
// phrases des robots de la Collection, onglet Succès refait (référence de Femz), notes de version de l'écran titre.
// =====================================================================================================
/**
 * La monnaie méta : son nom n'est écrit qu'ici. « Pixels » (décision de Femz, 16/11 21h, § E4.N.1 ; « Hex » avant).
 * glyphe : repli texte (attributs title, tests) ; à l'écran, le glyphe est le pixel FUI dessiné en CSS (.sr-px).
 */
export const MONNAIE = { nom: 'Pixels', un: 'Pixel', glyphe: '▣' };
/** « 1 Pixel », « 2 Pixels », « 1 240 Pixels » (singulier pour 0 et 1) ; n déjà formaté ou nombre. */
export function montant(n, txt = null) {
  const v = typeof n === 'number' ? n : Number(String(n).replace(/[^0-9-]/g, ''));
  return (txt === null ? String(n) : txt) + ' ' + (Math.abs(v) <= 1 ? MONNAIE.un : MONNAIE.nom);
}
// Barème (§ E4.I.2, lecture SUPPOSÉE de la consigne de Femz) : vague TERMINÉE w → min(vagueMax, vagueBase +
// vagueParTranche × floor((w − 1) / tranche)) ; k-ième boss → min(bossMax, bossBase + bossPas × (k − 1)) ; k-ième élite →
// min(eliteMax, eliteBase + elitePas × (k − 1)) ; succès → succes (une fois).
META.bareme = { vagueBase: 8, vagueParTranche: 2, tranche: 5, vagueMax: 30, bossBase: 20, bossPas: 2, bossMax: 40, eliteBase: 2, elitePas: 1, eliteMax: 5, succes: 20 };
DEFIS.cyclesParSucces = META.bareme.succes;
/** Monnaie rapportée par la vague TERMINÉE w (1, 2…). */
export function cyclesVague(w) {
  const B = META.bareme;
  return w >= 1 ? Math.min(B.vagueMax, B.vagueBase + B.vagueParTranche * Math.floor((w - 1) / B.tranche)) : 0;
}
/** Monnaie rapportée par le k-ième boss tué dans la partie. */
export function cyclesBoss(k) {
  const B = META.bareme;
  return k >= 1 ? Math.min(B.bossMax, B.bossBase + B.bossPas * (k - 1)) : 0;
}
/** Monnaie rapportée par la k-ième élite tuée dans la partie. */
export function cyclesElite(k) {
  const B = META.bareme;
  return k >= 1 ? Math.min(B.eliteMax, B.eliteBase + B.elitePas * (k - 1)) : 0;
}
/** Détail d'une partie : vagues terminées, boss et élites tués, succès réussis → { vague, boss, elites, succes, total }. */
export function cyclesDetail(vagues, boss, elites, succes, out = {}) {
  let v = 0;
  for (let w = 1; w <= vagues; w++) v += cyclesVague(w);
  let b = 0;
  for (let k = 1; k <= boss; k++) b += cyclesBoss(k);
  let e = 0;
  for (let k = 1; k <= elites; k++) e += cyclesElite(k);
  out.vague = v;
  out.boss = b;
  out.elites = e;
  out.succes = Math.max(0, succes | 0) * META.bareme.succes;
  out.total = v + b + e + out.succes;
  return out;
}
// Paliers de puissance → prix (§ E4.I.4 b : mesure e3-H-mesure, ou SUPPOSÉ pour les objets sans dégâts)
export const PALIERS = [
  { key: 'petit', label: 'Petit', prix: 120 },
  { key: 'moyen', label: 'Moyen', prix: 600 },
  { key: 'gros', label: 'Gros', prix: 1500 },
  { key: 'tresGros', label: 'Très gros', prix: 3500 },
];
META.palier = {
  'arme:ricochet': 'petit', 'arme:pool': 'petit', 'objet:detonator': 'petit',
  'objet:luck': 'moyen', 'objet:berserk': 'moyen', 'util:turbo': 'moyen', 'util:compute': 'moyen',
  'arme:rail': 'gros', 'arme:smoke': 'gros',
  'objet:capacitor': 'tresGros', 'objet:save': 'tresGros',
};
META.prix = {};
for (const k in META.palier) META.prix[k] = PALIERS.find((p) => p.key === META.palier[k]).prix;
META.prixTotal = Object.values(META.prix).reduce((a, b) => a + b, 0); // 12 760
// La Sauvegarde (très gros) n'est plus donnée par « Redémarrage forcé » : ce succès la met en vente (§ E4.I.4 b)
DEFIS.list.find((d) => d.key === 'boss1').sorte = DEFI_RECOMP.VENTE;
// Catégories de l'onglet Déblocages (§ E4.I.4 d) : par les données ; une catégorie vide est cachée. Pas d'agents.
export const DEBLOCAGES = {
  categories: [
    { key: 'arme', label: 'Armes', prefixes: ['arme:'] },
    { key: 'objet', label: 'Objets passifs', prefixes: ['objet:'] },
    { key: 'util', label: 'Utilitaires', prefixes: ['util:'] },
    { key: 'cosmetique', label: 'Cosmétiques', prefixes: ['cosm:'] }, // prévue, vide : cachée tant qu'elle est vide
  ],
  cleOuverture: 'sr-deblocages-ouverts', // localStorage (try/catch) : catégories repliées
  compte: ' débloqués', // « 2 / 5 débloqués »
  arsenal: 'Arsenal : ',
  tous: 'Tous les agents',
};
// Collection : la section « Agents » est retirée (Femz : « il a déjà son onglet »)
HUB.familles = HUB.familles.filter((f) => f.key !== 'agent');
// Textes du hub et du bilan qui nomment la monnaie (une seule source : MONNAIE)
HUB.monnaie = MONNAIE.nom.toUpperCase();
HUB.monnaieGlyphe = MONNAIE.glyphe;
HUB.textes.tropPauvre = 'Pas assez de ' + MONNAIE.nom;
HUB.textes.resetConfirm = ['Confirmer : tout effacer ?', 'Vraiment ? Succès, ' + MONNAIE.nom + ' et déblocages perdus'];
HUB.textes.detruit = ['détruit', 'détruits']; // accord : « 1 détruit », « 2 détruits »
BILAN.textes.cycles = MONNAIE.nom;
BILAN.textes.vague = 'Vagues terminées';
// Robots de la Collection (§ E4.I.5) : une phrase vraie (tirée du code) et légère, par type (ENEMY.*)
const PHRASES_ROBOTS = [
  'Marche droit sur vous, en meute. Aucune stratégie, beaucoup de collègues.',
  'Le plus rapide de la bande, mais il casse comme du verre. En v2, il pique sur vous.',
  'Garde ses distances et vous arrose. Foncez-lui dessus : il recule.',
  'Court vers vous et explose. Son plan de carrière tient en une ligne.',
  'Lent, énorme, 220 PV. Il tourne mal : passez par le côté.',
  'Reste derrière la meute et répare ses collègues. Le support technique de l’AGI.',
  'Arrive toutes les 5 vagues. Le chrono l’attend : la vague ne finit qu’à sa mort.',
  'Passe sous le sol et ressort là où vous étiez. Le cercle au sol vous prévient.',
  'Garde ses distances et sème des mines. Il appelle ça de la décoration.',
  'Ne bouge jamais. Son laser balaie la zone : sortez de l’axe.',
  'Détruit, il se coupe en mini-rôdeurs. Le copier-coller, version AGI.',
];
for (let t = 0; t < ENEMIES.types.length; t++) if (PHRASES_ROBOTS[t]) ENEMIES.types[t].desc = PHRASES_ROBOTS[t];
// Onglet Succès (§ E4.I.7) : vignette de la condition par succès ('robot:<type>' ou id d'icône), filtres, textes
export const SUCCES_UI = {
  vignettes: {
    vague3: 'robot:0', vague5: 'robot:6', kills2000: 'robot:0', boss1: 'robot:6', coffres10: 'sr-m-luck', lame250: 'sr-w7',
    sentinelle200: 'sr-w8', blindes100: 'robot:4', armes4: 'sr-w0', pvbas30: 'sr-b-armor', objets6: 'sr-m-tesla',
    jackpot: 'sr-m-luck', fragments1500: 'sr-i-frag', fusion1: 'sr-m-malware', elites50: 'sr-b-crit', vague10: 'robot:6',
    kamikazes200: 'robot:3', evolutions3: 'sr-b-damage', blasterSeul8: 'sr-w0', boss2: 'robot:6',
  },
  filtres: [
    { key: 'tous', label: 'Tous' },
    { key: 'verrouilles', label: 'Verrouillés' },
    { key: 'reussis', label: 'Réussis' },
  ],
  sections: { reussis: 'Réussis', enCours: 'En cours', verrouilles: 'Verrouillés' },
  textes: {
    sur: ' sur ', // « 6 sur 20 réussis »
    reussis: ' réussis',
    enCours: 'En cours',
    recompenses: 'Récompenses',
    gagnes: 'gagnés par les succès',
    temps: 'Temps de jeu',
    vide: 'Aucun succès ici pour le moment.',
  },
};
// Notes de version (§ E4.I.6) : panneau de l'écran titre ; données dans src/patchnotes.js
export const PATCHNOTES_UI = {
  titre: 'Patchnote', // 19/11, Femz : « renomme nouveauté en patchnote »
  chemin: 'SYSTÈME / JOURNAL',
  nouveau: 'NOUVEAU',
  version: 'Version ',
  cleVue: 'sr-notes-vue', // localStorage (try/catch) : dernière version ouverte
  cleOuvert: 'sr-notes-ouvert', // localStorage (try/catch) : panneau déplié ou replié
  parallaxPx: 6, // px au bord de l'écran (couche du panneau)
};
//#endregion e4:I-cycles-patchnotes-succes

//#region e4:J-coup-de-pied-tirs
// Étape 4, chantier J (ARCHITECTURE.md § E4.J) — demandes de Femz du 16/11 (14h25) : l'agent casse les décors d'un coup de
// pied (mini secousse), et les balles des robots à canon reprennent leur ancien visuel.
// Coup de pied (src/props.js déclenche et casse, src/anim/heros-anim.js pose la jambe). Temps en s SIMULÉES ; réglages
// SUPPOSÉS, à valider en jouant.
export const COUP_DE_PIED = {
  portee: 0.95, // m au-delà du rayon de la borne : le héros « arrive au contact » (le corps fait ≈ 0,5 m de rayon)
  duree: { arme: 0.09, frappe: 0.07, tenue: 0.05, retour: 0.14 }, // armé, frappe (impact à sa fin), tenue, retour
  leveeArme: 1.05, // rad — cuisse levée devant à l'armé…
  genouArme: 1.75, // rad — …genou plié
  leveeFrappe: 1.6, // rad — cuisse à la frappe… (17/11 : 1,3 → 1,6, la course de référence Running lève la cuisse à 1,17)
  genouFrappe: 0.1, // rad — …jambe presque tendue
  pointe: 0.35, // rad — pointe du pied tendue vers la borne à la frappe (THETA, + = pointe vers le bas)
  lateral: 0.8, // part latérale de la levée quand la borne est sur le côté (une jambe ne s'écarte pas autant qu'elle monte)
  coteSeuil: 0.2, // sin β au-delà duquel la jambe gauche frappe (borne à gauche du bassin), sinon la droite
  recul: -0.12, // rad — buste penché en arrière à la frappe (dessin seulement, la visée ne change pas)
  secousse: 0.07, // trauma à l'impact (groupe « auto » de camera.js : plafonné, × réglage « secousses » du joueur)
  arret: 0.03, // s d'arrêt sur image à l'impact (fx.hitstop : ignoré à moins de 0,25 s du précédent)
  vitesse: 1, // vitesse minimale du héros pendant le coup, en part de sa vitesse : il n'est pas ralenti
  // Bastion (AGENT.BASTION) : un coup plus lourd — plus lent à armer, plus de secousse, arrêt plus long
  lourd: { agent: AGENT.BASTION, temps: 1.3, levee: 0.92, secousse: 0.11, arret: 0.05 },
};
// « Impact sur un robot.wav » − 7 demi-tons, 0,3 s, 2 dB sous PROP_BREAK (candidat, § E4.J.4)
AUDIO.sounds[SFX.COUP_PIED] = { dur: 0.3, gain: 0.3, minInterval: 0.08, maxVoices: 2, pitchVar: 1, priority: 1 };
// Ancien visuel des balles des robots à canon (tireur, obus lobé), à l'identique de tests/.cache/avant-vfx (14/11 03h46,
// ENEMIES.projectile d'avant l'étape « vfx », § Z septies) : tête icosaèdre au rayon de collision, cœur chauffé à blanc,
// traînée courte qui s'assombrit, rouge PALETTE.enemyShot. Dessin : src/tirs-canon.js (maillage « tirs-ennemis »).
export const TIR_CANON = {
  trailLength: 0.5, // m derrière la tête
  glow: 2.2, // gain de la couleur de la tête (au-dessus du seuil du bloom)
  coreGlow: 8, // gain du cœur clair posé sur la tête (rouge chauffé à blanc : même teinte, plus de lumière)
  coreSize: 0.56, // rayon du cœur, en rayons du tir
  tailGlow: 0.45, // gain de la pointe de la traînée
  tailWidth: 0.8, // largeur de la traînée à sa base, en rayons du tir
  refRadius: 0.32, // m — rayon pour lequel la traînée mesure trailLength (celui des tireurs) ; elle suit l'échelle du tir
};
//#endregion e4:J-coup-de-pied-tirs

//#region e4:K-grosses-gemmes
// Étape 4, chantier K (ARCHITECTURE.md § E4.K) — demande de Femz du 16/11 (14h35) : trop de gemmes ou de fragments au sol
// → les plus éloignés et les plus anciens glissent vers le centre de leur groupe et forment une grosse gemme / un gros
// fragment qui pulse (src/pickups.js). Mêmes maillages que le butin : + 0 appel de dessin. Réglages PROPOSÉS, à valider
// sur les planches.
export const REGROUPEMENT = {
  actif: true,
  seuil: { gemmes: 150, fragments: 80 }, // ramassables AU SOL (posés ou en glissement) au-delà desquels on regroupe…
  cible: { gemmes: 110, fragments: 60 }, // …jusqu'à redescendre ici (hystérésis : pas de va-et-vient au seuil)
  intervalle: 0.05, // s entre deux groupes lancés, par nature (le travail est étalé : jamais de pic)
  groupesMax: 16, // groupes en cours en même temps, toutes natures
  rayon: 4.5, // m — zone d'un groupe autour de sa graine
  rayonVoisin: 9, // m — graine seule dans son rayon : son plus proche voisin jusqu'ici, sinon elle est « isolée »
  maxParGroupe: 24, // ramassables par groupe au plus
  glisse: 0.5, // s — glissement vers le point d'arrivée (smoothstep : vitesse nulle au départ et à l'arrivée)
  poidsAge: 0.25, // m de « distance » par s d'âge : la graine est le plus éloigné ET le plus ancien
};
export const GROS_BUTIN = {
  gemme: { echelle: 0.95, echelleMax: 1.35, parDoublement: 0.07 }, // m (demi-largeur ; palier violet 0,47)
  fragment: { echelle: 0.62, echelleMax: 0.9, parDoublement: 0.05 }, // m (rayon de la plaquette ; fragment 0,27)
  croissance: 0.22, // s — constante de temps de l'échelle vers sa cible (naissance, butin reçu) : jamais de saut
  // pouls : échelle × (1 + ampleur × sin(2π t / periode)), lueur aFx.y entre lueurMin et lueurMax, en phase ;
  // l'ampleur monte en `rampe` s à la naissance du gros
  pouls: { periode: 1.6, ampleur: 0.09, lueurMin: 0.12, lueurMax: 0.55, rampe: 0.5 },
  tacheMax: 2.6, // tache de lumière au sol : rayon × échelle dessinée / échelle du palier, au plus × tacheMax
  // éclat au ramassage (fx.spawnGrosButinF) : anneau au sol de la couleur du palier + losanges qui montent
  eclat: { anneau: 1.6, secondes: 0.4, losanges: 8, taille: 0.15, vie: 0.55, montee: 3, dispersion: 0.6, hauteur: 0.6, gain: 1.15 },
};
// « Gemme.wav » − 5 demi-tons, 0,7 s, 2 dB au-dessus de GEM : joué AVEC le son normal (GEM ou FRAGMENT) — candidat (§ E4.K.3)
AUDIO.sounds[SFX.GROS_BUTIN] = { dur: 0.7, gain: 0.3, minInterval: 0.12, maxVoices: 2, pitchVar: 0.5, priority: 2 };
//#endregion e4:K-grosses-gemmes

//#region e4:L-fiche-noyau-cape
// ----- Étape 4, chantier L (ARCHITECTURE.md § E4.L) : fiche au Noyau, silhouettes, cape du portrait, définition ------
// 4 bis (Femz, 16/11 15h30 : « pixelise un tout petit peu le perso sur la fiche ») : 1,2 px CSS par pixel d'art au lieu
// de 1 — 120 × 160 pixels d'art en 1280 × 720 (9 × 12 rem) au lieu de 144 × 192, soit 20 % de définition en moins à
// toute taille d'écran. Même valeur pour la fiche de la pause et pour le Noyau (un seul portrait). Planche : 1 / 1,2 / 1,333.
PAUSE.pixel = 1.2;
// Silhouette pleine d'un agent verrouillé (Femz, 11h50 : « juste une silhouette pleine ») : UNE couleur unie, sans
// lumière ni détail — portrait 3D (corps et cape) et vignettes 2D (sélecteur du Noyau, écran des agents, récompenses).
// Vert éteint de la DA carte mère : lisible sur le fond du Noyau (#04180b) sans rien dire de l'agent.
export const SILHOUETTE = { couleur: 0x2c4a37 };
// Portrait (pause et Noyau) : cape tissu (instance cape.js?portrait), replacée puis simulée capePreSim s à pas fixe
// (capePasS) avant la première image : elle tombe au repos sans fouet.
export const PORTRAIT_CAPE = { capePreSim: 1.2, capePasS: 1 / 60 };
//#endregion e4:L-fiche-noyau-cape

//#region e4:M-bug-explosions
// Étape 4, chantier M (ARCHITECTURE.md § E4.M) — bug signalé par Femz le 16/11 (21h) : « mon perso fait une animation
// d'explosion aleatoirement autour de lui avec le passif fragment ». Cause mesurée : le départ de salve d'un OBJET
// (Éclats et les 5 autres objets à salves du § E4.G) jouait le « coup ressenti » des ARMES (§ E3.H) : explosion centrée
// sur le héros, secousse, arrêt sur image, CD_FIRE — sans aucune cause visible (un robot entré à `reach` m). Un objet
// n'a donc plus de moment de départ : sa salve se lit sur sa case (anneau « action ») et par ses effets, qui partent de
// leur cause. 1 rétablirait l'élément (les armes ne sont pas concernées et gardent le leur).
// Chantier R (§ E4.M bis), décision de Femz du 16/11 (22h30) « Garde le son » : CD_FIRE rejoue au départ d'un objet.
RECHARGE.departObjet = { eclat: 0, secousse: 0, arret: 0, son: 1 };
// Chantier R, « Oui » : les GRENADES n'ont plus d'explosion centrée sur le héros au début de leur salve (avant d'être
// lancées) ; elles gardent le son de départ, comme les objets (secousse et arrêt sur image aussi à 0 : lecture de
// « comme les objets », à valider). Leur explosion reste à l'IMPACT de chaque grenade. `depart` d'une source remplace
// le défaut (arme : tout à 1 ; objet : RECHARGE.departObjet), lu par cooldowns.load.
RECHARGES.weapons.grenade.depart = { eclat: 0, secousse: 0, arret: 0, son: 1 };
//#endregion e4:M-bug-explosions

//#region e4:N-textes-clairs-pixels
// =====================================================================================================
// ÉTAPE 4, CHANTIER N (ARCHITECTURE.md § E4.N) — retours de Femz du 16/11 (21h-21h50) : des mots CLAIRS mais MOINS
// de texte. Règle : visible par défaut = le nom + UNE ligne de 12 mots au plus (`desc`) ; l'explication longue
// (`detail`, 2 à 3 phrases) seulement dans la fenêtre de détail (fiche de la pause, fiche de la Collection).
// Vocabulaire : « pile » → niveau, « salve » → « agit quelques secondes, puis se recharge », « Action » → Actif,
// « utilitaire » → bonus au sol, « v2 / v3 » → « à partir de la vague N ». Tout est affecté ICI, après les régions
// d'origine (comme le chantier I) ; le tableau avant / après est généré (tests/e4-N-textes-tableau.mjs).
// =====================================================================================================
/** Textes que le code écrivait en dur (ui-hub.js, ui.js, items.js, chests.js, progression.js) et que ce chantier change. */
export const TEXTES_N = {
  pasObtenue: 'Pas encore obtenue.',
  pasObtenu: 'Pas encore obtenu.',
  parNiveau: 'Par niveau : ',
  rang: 'Rareté : ',
  recetteRevelee: 'Recette connue grâce à un succès, pas encore réussie.',
  evoInconnue: 'Évolution pas encore découverte.',
  fusionInconnue: 'Fusion pas encore découverte.',
  parNiveauBonus: ' par niveau', // carte de niveau d'un bonus : « +10 % de dégâts par niveau » (« par pile » avant)
  fusionPlus: ' +1 niveau pour ', // carte de fusion : « … +1 niveau pour Virus et Surchauffe. »
  actif: 'Actif', // fiche : ligne « Action » avant (durée pendant laquelle l'arme ou l'objet agit)
  marchandPied: '', // pied du marchand (aide permanente retirée)
  bilanChemin2: '', // second « SYSTÈME / BILAN » du bilan (doublon retiré)
};
// Fenêtre de détail : ce qui est dit sous l'effet d'une arme ou d'un objet qui agit par moments (§ E4.G)
RECHARGE.texteEffet = 'Agit quelques secondes, puis se recharge. Chaque niveau : recharge plus courte, effet plus long.';

// ----- Armes : desc = une ligne (≤ 12 mots) ; detail = la fenêtre de détail -----
const ARMES_N = {
  blaster: ['Tire tout seul sur le robot le plus proche.', 'Tire tout seul, sans viser, sur le robot le plus proche. Le marchand augmente ses dégâts, sa cadence et son nombre de balles.'],
  orbitals: ['Des disques tournent autour de vous et coupent les robots proches.', 'Des disques tournent autour de vous quelques secondes et coupent les robots qui s’approchent, puis disparaissent le temps de se recharger.'],
  shotgun: ['Tire une gerbe de plombs vers le groupe le plus proche.', 'Tire une gerbe de plombs vers le groupe de robots le plus proche. Très fort de près, faible de loin.'],
  emp: ['Une aura blesse et ralentit les robots autour de vous.', 'Une aura électrique autour de vous blesse et ralentit les robots qui y entrent. Des arcs touchent aussi les robots un peu plus loin.'],
  rail: ['Un rayon traverse toute une ligne de robots.', 'Un rayon traverse toute une ligne de robots, en visant le plus résistant. Rien ne l’arrête.'],
  rockets: ['Des roquettes explosent sur le plus gros groupe de robots.', 'Des roquettes partent vers le plus gros groupe de robots et explosent sur une zone. Idéal contre les foules.'],
  ricochet: ['Un tir qui rebondit d’un robot à l’autre.', 'Un tir qui rebondit d’un robot à l’autre : il touche plusieurs robots d’affilée, même dispersés.'],
  blade: ['Balaie un arc devant vous et touche tous les robots proches.', 'Un coup de lame balaie un arc devant vous. Tous les robots proches dans cet arc sont touchés.'],
  turret: ['Pose des tourelles qui tirent seules et repoussent les robots.', 'Pose derrière vous des tourelles qui tirent toutes seules. Un petit champ de force autour d’elles repousse les robots, sans les blesser.'],
  pool: ['Lance des flacons : la flaque ronge les robots qui passent.', 'Lance des flacons quelques secondes, puis se recharge. La flaque laissée au sol ronge les robots qui marchent dedans.'],
  boomerang: ['Traverse les robots à l’aller, puis revient en les retouchant.', 'Lancé quelques secondes, puis se recharge. Il traverse les robots à l’aller, puis revient vers vous en les touchant une seconde fois.'],
  mines: ['Pose des mines qui explosent quand un robot s’approche.', 'Pose des mines derrière vous. Elles explosent dès qu’un robot s’approche et blessent tout autour.'],
  katana: ['Grand coup de sabre lent ; ses critiques font d’énormes dégâts.', 'Un grand coup de sabre, lent, devant vous. Ses coups critiques font d’énormes dégâts.'],
  grenade: ['Lance des grenades sur les groupes de robots.', 'Lance des grenades sur les groupes de robots quelques secondes, puis se recharge. Chaque grenade explose sur une zone.'],
  smoke: ['Un nuage aveugle et ralentit les robots ; vos coups y sont critiques.', 'Un nuage de fumée aveugle et ralentit les robots qui y entrent. Tous vos coups dans le nuage sont des coups critiques.'],
  flash: ['Sur la touche de frappe : foncez droit devant vous et tranchez tout.', 'Appuyez sur la touche de frappe (réglable dans la pause) : vous filez droit devant vous et tranchez tous les robots sur la ligne.'], // § E5.X4 (audit J3) ; § E5.AB (0.5.13) : la frappe part devant la caméra (Caméra libre) ou dans la direction de marche (Vue fixe)
  cannon: ['Pose un canon lourd : tirs lents mais très puissants.', 'Pose un canon lourd quelques secondes, puis il se replie le temps de se recharger. Il tire lentement, mais chaque tir fait de gros dégâts.'],
  hammer: ['Frappe le sol : des ondes blessent et repoussent les robots autour.', 'Frappe le sol quelques secondes, puis se recharge. Chaque coup envoie des ondes de choc qui blessent et repoussent tout autour de vous.'],
};
for (const W of WEAPONS) if (ARMES_N[W.key]) [W.desc, W.detail] = ARMES_N[W.key];

// ----- Objets passifs : desc (≤ 12 mots), detail, what (le chiffre), pile (le chiffre par niveau, en court) -----
const OBJETS_N = {
  tesla: ['Vos coups lancent parfois un éclair qui saute de robot en robot.', 'Chacun de vos coups a une chance de lancer un éclair. Il saute de robot en robot et blesse chacun.', 'éclair sur 5 robots, 50 % des dégâts du coup'],
  cryo: ['Vos coups gèlent parfois un robot : il n’avance presque plus.', 'Chacun de vos coups a une chance de geler le robot touché. Gelé, il n’avance presque plus pendant un court moment.', 'gel de 1,2 s, vitesse × 0,3'],
  virus: ['Vos coups infectent les robots : ils perdent des PV pendant 4 s.', 'Quand un robot est proche, le virus agit quelques secondes : chacun de vos coups infecte le robot touché, qui perd des PV pendant 4 s. Puis il se recharge.', null],
  burn: ['Vos coups mettent parfois le feu, qui se propage aux voisins.', 'Quand un robot est proche, l’effet agit quelques secondes : vos coups mettent parfois le feu. Un robot qui meurt en brûlant enflamme ses voisins. Puis il se recharge.', 'feu de 3 s à 15 PV/s, voisins à 2 m'],
  detonator: ['Vos coups critiques font exploser la cible sur ses voisins.', 'Quand un robot est proche, l’effet agit quelques secondes : chaque coup critique fait exploser la cible et blesse les robots autour. Puis il se recharge.', 'explosion à 60 % du coup'],
  scope: ['Vos coups critiques font encore plus de dégâts.', 'Vos coups critiques, ces coups plus forts qui tombent au hasard, font encore plus de dégâts.', null],
  berserk: ['Moins il vous reste de PV, plus vos armes tirent vite.', 'Plus vos PV baissent, plus toutes vos armes tirent vite, jusqu’à trois fois plus vite près de 0 PV.', 'max × 3'],
  leech: ['Les robots que vous tuez vous rendent parfois des PV.', 'Chaque robot que vous tuez a une chance de vous rendre des PV.', '2 PV par robot, max 10 PV par seconde'],
  shield: ['Un bouclier encaisse 40 PV de dégâts, puis se recharge.', 'Un bouclier encaisse jusqu’à 40 PV de dégâts à votre place ; le coup qui le vide est arrêté en entier. Il se recharge ensuite tout seul.', null],
  reactive: ['Touché, vous lâchez une onde qui blesse et repousse les robots.', 'Quand un robot est proche, l’effet agit quelques secondes : chaque coup reçu lâche une onde qui blesse et repousse les robots autour de vous. Puis il se recharge.', 'onde de 4 m, max 1 par seconde'],
  dashcore: ['Votre dash blesse tous les robots qu’il traverse.', 'Votre dash blesse tous les robots qu’il traverse. Foncez dans la foule.', null],
  overclock: ['Vos armes tirent plus vite, mais vous avez moins de PV max.', 'Toutes vos armes tirent plus vite. En échange, vos PV max baissent un peu à chaque niveau.', '−3 PV max par niveau (min 40 PV max)'],
  drone: ['Un drone allié vous suit et tire comme un blaster.', 'Un drone allié vous suit et tire tout seul sur les robots, comme un blaster. D’autres drones vous rejoignent aux niveaux 5 et 10.', '2e drone au niveau 5, 3e au niveau 10'],
  capacitor: ['Tuez des robots : une impulsion frappe tous ceux à l’écran.', 'Chaque robot tué charge le condensateur. Une fois chargé, quand un robot est proche, il lâche une impulsion qui frappe tous les robots à l’écran. Puis il se recharge.', '40 dégâts + 10 par niveau'],
  shrapnel: ['Les robots tués projettent parfois des éclats sur leurs voisins.', 'Quand un robot est proche, l’effet agit quelques secondes : les robots que vous tuez projettent parfois des éclats sur leurs voisins. Puis il se recharge.', '4 éclats de 8 dégâts + 2 par niveau'],
  magnet: ['Chaque fragment ramassé vaut plus : plus d’achats chez le marchand.', 'Chaque fragment ramassé vaut plus. Les fragments servent à acheter des améliorations chez le marchand.', null],
  luck: ['Les lots des coffres sortent parfois une rareté au-dessus.', 'Quand vous ouvrez un coffre, chaque lot a une chance de monter d’une rareté.', null],
  save: ['Une fois par vague, annule un coup qui devait vous tuer.', 'Une fois par vague, un coup qui devait vous tuer est annulé et vous rend des PV. C’est le CTRL+Z de l’agent.', null],
};
for (const I of ITEMS) if (OBJETS_N[I.key]) [I.desc, I.detail, I.pile] = OBJETS_N[I.key];

// § E5.X3 (Femz, 22/11 : « Moteur cinétique ça sert à rien pour Bastion » ; « Propulseurs… à adapter pour Bastion car
// c'est pas un dash exactement ») : textes propres à un agent, posés au début de chaque partie par agents.reset()
// (appliquerTextesAgent) ; les textes de base sont rendus pour les autres agents. Le Bastion n'a pas de dash mais un BOND :
// son Moteur cinétique blesse les robots pris dans l'onde d'atterrissage (src/dash-agents.js onde → items.frapperBond).
export const TEXTES_AGENT = {
  [AGENT.BASTION]: {
    bonus: { dashCd: { desc: '−12 % de recharge du bond', effet: 'Votre bond revient plus vite.' } },
    objets: {
      dashcore: {
        what: 'dégâts du bond',
        desc: 'Votre bond blesse les robots là où vous atterrissez.',
        detail: 'À chaque atterrissage de votre bond, l’onde de choc blesse tous les robots qu’elle touche.',
      },
    },
    // Femz, 22/11 : « fais aussi les lignes de fusion Brise-ligne et Surrégime »
    evolutions: { 'brise-ligne': { rule: 'Chaque bond tire autour de vous un anneau de 24 plombs.' } },
    fusions: { surregime: { rule: 'Après un bond, vos armes tirent 2 fois plus vite pendant 2 s.' } },
  },
  // Femz, 22/11 : « fais pareil pour le Shinobi ». Son pas de l'ombre est une téléportation : le Moteur cinétique blesse
  // déjà les robots entre le départ et l'arrivée (balayage d'une image, items.js dashSweep) — seuls les textes changent.
  [AGENT.SHINOBI]: {
    bonus: { dashCd: { desc: '−12 % de recharge du pas de l’ombre', effet: 'Votre pas de l’ombre revient plus vite.' } },
    objets: {
      dashcore: {
        what: 'dégâts du pas de l’ombre',
        desc: 'Votre pas de l’ombre tranche les robots que vous traversez.',
        detail: 'Quand vous disparaissez puis réapparaissez, les robots entre votre départ et votre arrivée sont blessés.',
      },
    },
    evolutions: { 'brise-ligne': { rule: 'Chaque pas de l’ombre tire autour de vous un anneau de 24 plombs.' } },
    fusions: { surregime: { rule: 'Après un pas de l’ombre, vos armes tirent 2 fois plus vite pendant 2 s.' } },
  },
};
const TEXTES_BASE = new Map(); // objet de config → copie de ses textes d'origine (prise au premier remplacement)
function poserTextes(O, t) {
  if (!TEXTES_BASE.has(O)) TEXTES_BASE.set(O, { desc: O.desc, effet: O.effet, what: O.what, detail: O.detail, rule: O.rule });
  for (const k in t) O[k] = t[k];
}
/** § E5.X3 : textes de l'agent `agent` sur les bonus et objets concernés (hors combat : début de partie). */
export function appliquerTextesAgent(agent) {
  for (const [O, base] of TEXTES_BASE) Object.assign(O, base);
  const T = TEXTES_AGENT[agent];
  if (!T) return;
  for (const key in T.bonus || {}) {
    const B = PROGRESSION.bonuses.find((b) => b.key === key);
    if (B) poserTextes(B, T.bonus[key]);
  }
  for (const key in T.objets || {}) {
    const I = ITEMS.find((i) => i.key === key);
    if (I) poserTextes(I, T.objets[key]);
  }
  for (const key in T.evolutions || {}) {
    const V = EVOLUTIONS.find((e) => e.key === key);
    if (V) poserTextes(V, T.evolutions[key]);
  }
  for (const key in T.fusions || {}) {
    const F = FUSIONS.find((f) => f.key === key);
    if (F) poserTextes(F, T.fusions[key]);
  }
}
ITEMS.find((i) => i.key === 'virus').pile = null;

// ----- Bonus au sol (« utilitaires ») : chacun SA ligne (ui-hub.js n'a plus de texte générique) -----
UTILITIES.categorie = 'Bonus au sol';
const BONUS_SOL_N = {
  battery: ['Rend de 25 à 75 PV d’un coup.'], // Femz 20/11 soir : bornes 25 / 50 / 75 PV, robots 35 PV
  magnet: ['Attire vers vous tout le butin de l’arène, coffres compris.'],
  iem: ['Détruit d’un coup les robots à l’écran, sauf boss et élites.'],
  stun: ['Les robots à l’écran ne bougent plus pendant 3 s.'],
  turbo: ['Pendant 10 s : +30 % de vitesse et +50 % de dégâts.'],
  compute: ['Pendant 10 s, chaque coup porté vous rapporte un fragment.'],
};
// Femz 20/11 soir : les bornes ne lâchent plus que des Batteries (toujours une) — les autres bonus tombent des robots
const BONUS_SOL_DETAIL = 'Bonus à ramasser au sol : il tombe parfois d’un robot détruit. Il disparaît au bout de 30 s.';
const BONUS_SOL_DETAIL_BATTERIE = 'Bonus à ramasser au sol : chaque borne du décor que vous cassez en lâche une, et il en tombe parfois d’un robot détruit. Elle disparaît au bout de 30 s.';
for (const u of UTILITIES.list) if (BONUS_SOL_N[u.key]) {
  u.desc = BONUS_SOL_N[u.key][0];
  u.detail = u.desc + ' ' + (u.key === 'battery' ? BONUS_SOL_DETAIL_BATTERIE : BONUS_SOL_DETAIL);
}
DEBLOCAGES.categories.find((c) => c.key === 'util').label = UTILITIES.categorie;
BILAN.textes.util = UTILITIES.categorie;

// ----- Bonus des cartes de niveau : « par niveau » (TEXTES_N.parNiveauBonus) ; le reste était déjà clair -----
CHOICES.itemText.tag = 'OBJET'; // « MODULE » avant : la Collection et le Noyau disent « objet »
CHESTS.text.item = 'OBJET';
CHOICES.itemText.gain = 'niveau';
CHOICES.itemText.gains = 'niveaux';
CHOICES.itemText.lead = 'Choisissez une carte.';
FUSION_SCREEN.path = 'AGENT / FUSION D’OBJETS';
FUSION_SCREEN.lead = 'Deux objets au niveau max fusionnent : une place se libère.';
FUSION_SCREEN.keeps = 'Garde les effets et les niveaux de';
FUSION_SCREEN.hint = 'fusionne avec un objet que vous avez';
BILAN.textes.objets = 'Objets et dash';
BILAN.textes.cols = ['Arme', 'Dégâts', 'Tués', 'Part']; // « Kills » avant (anglais)

// ----- Recettes : « salve » retiré (mot vu comme jargon par Femz) -----
EVOLUTIONS.find((e) => e.key === 'forteresse').rule = 'Une tourelle lourde à double canon, qui tire aussi des rafales de petits obus ; la Sentinelle disparaît dans cette arme.';
FUSIONS.find((f) => f.key === 'essaim').rule = 'À chaque impulsion du Condensateur, chaque drone tire une rafale tout autour de lui.';

// ----- Robots de la Collection (fenêtre de détail) : ce qu'ils font, et leur évolution en clair -----
const ROBOTS_N = [
  'Marche droit sur vous, en meute. À partir de la vague 13, il bondit sur vous quand vous êtes proche.',
  'Le plus rapide de la bande, mais il casse vite. À partir de la vague 12, ils arrivent en groupe et foncent sur vous en piqué. À partir de la vague 19, ils laissent en mourant une flaque électrique.',
  'Garde ses distances et vous tire dessus ; foncez-lui dessus, il recule. À partir de la vague 11, il tire 3 balles en éventail. À partir de la vague 18, il lance aussi des obus : un cercle au sol montre où ils tombent.',
  'Court vers vous et explose. À partir de la vague 14, son explosion fait aussi exploser les kamikazes voisins.',
  'Lent, très résistant, et il tourne lentement : passez par le côté. À partir de la vague 16, il fonce droit devant après un trait d’avertissement au sol.',
  'Reste derrière la meute et soigne les robots autour de lui. À partir de la vague 17, il les protège plutôt d’une bulle qui absorbe les dégâts.',
  'Arrive toutes les 5 vagues. Le chrono s’arrête à zéro tant qu’il est en vie : la vague ne finit qu’à sa mort.',
  'Passe sous le sol et ressort là où vous étiez. Un cercle au sol annonce sa sortie. Apparaît à partir de la vague 21.',
  'Garde ses distances et sème des mines sur son passage. Apparaît à partir de la vague 22.',
  'Ne bouge jamais, mais son laser balaie la zone : sortez de sa ligne. Apparaît à partir de la vague 23.',
  'Détruit, il se coupe en petits rôdeurs. Apparaît à partir de la vague 24.',
];
for (let t = 0; t < ENEMIES.types.length; t++) if (ROBOTS_N[t]) ENEMIES.types[t].desc = ROBOTS_N[t];

// ----- Bannière de révision : le ton du lore garde « TIREURS v2.0 », une ligne dit ce qui change (§ E4.N.3) -----
const REVISIONS_N = {
  salve: 'Les tireurs envoient maintenant 3 balles en éventail.',
  pique: 'Les drones arrivent en groupe et foncent sur vous en piqué.',
  bond: 'Les rôdeurs bondissent sur vous quand vous êtes proche.',
  chaine: 'Un kamikaze qui explose fait exploser ses voisins kamikazes.',
  charge: 'Les blindés foncent droit devant après un trait au sol.',
  bulle: 'Les réparateurs protègent les robots d’une bulle qui absorbe les dégâts.',
  obus: 'Les tireurs lancent aussi des obus : sortez du cercle au sol.',
  flaque: 'Un drone détruit laisse une flaque électrique : n’y restez pas.',
};
for (const r of ENEMIES.revisions) if (REVISIONS_N[r.key]) r.effet = REVISIONS_N[r.key];
ENEMIES.revisionBannerSeconds = 3.6; // 2,4 s avant : le temps de lire la ligne de plus

// ----- Succès : conditions en clair -----
const SUCCES_N = {
  kills2000: 'Détruire 2 000 robots au total, toutes parties confondues',
  coffres10: 'Ouvrir 10 coffres au total, toutes parties confondues',
  lame250: 'Détruire 250 robots avec la Lame de phase en une partie (Shinobi)',
  sentinelle200: 'Détruire 200 robots avec la Sentinelle en une partie (Bastion)',
  blindes100: 'Détruire 100 blindés au total, toutes parties confondues',
  pvbas30: 'Tenir 30 s avec moins d’un quart de vos PV, puis finir la vague',
  objets6: 'Avoir 6 objets passifs différents en même temps',
  jackpot: 'Ouvrir un coffre qui contient 5 lots',
  fragments1500: 'Gagner 1 500 fragments en une partie',
  fusion1: 'Fusionner deux objets passifs',
  elites50: 'Détruire 50 élites au total, toutes parties confondues',
  kamikazes200: 'Détruire 200 kamikazes au total, toutes parties confondues',
  boss2: 'Détruire le boss de la vague 10',
};
for (const d of DEFIS.list) if (SUCCES_N[d.key]) d.texte = SUCCES_N[d.key];

// ----- Moins de texte : sous-titres redondants et aides permanentes retirés (§ E4.N.2) -----
HUB.lead = '';
HUB.textes.aideAgents = '';
HUB.textes.tropPauvre = 'Pas assez de ' + MONNAIE.nom;
HUB.textes.resetConfirm = ['Confirmer : tout effacer ?', 'Vraiment ? Succès, ' + MONNAIE.nom + ' et déblocages perdus'];
//#endregion e4:N-textes-clairs-pixels


//#region e4:O-coup-de-pied-v2
// Étape 4, chantier O (ARCHITECTURE.md § E4.O) — retour de Femz du 16/11 (21h) : « un vrai coup de pied de combattant
// militaire puissant », tout le corps, armes coupées, tremblement nettement plus fort. Animation Mixamo « Standing Melee
// Kick » (choisie par Femz), cuite sur le robot de chaque agent (assets/anims/coup-pied-<agent>.json). Réglages
// PROPOSÉS, à valider en jouant (planches e4-O-coup-de-pied-v2-*.png, vidéo e4-coup-de-pied-v2-son-mp3.mp4).
COUP_DE_PIED.v2 = {
  actif: true,
  // index = AGENT.* (Éclaireur, Bastion, Shinobi) ; sans fichier chargé, le geste calculé du § E4.J reste (repli)
  fichiers: ['assets/anims/coup-pied-eclaireur.json', 'assets/anims/coup-pied-bastion.json', 'assets/anims/coup-pied-shinobi.json'],
  clip: { debut: 0.1, fin: 0.98 }, // s de l'animation jouées : garde déjà prise → pied reposé (la remise en garde finale est coupée)
  // par agent : vitesse de lecture (Shinobi vif, Bastion lourd), arrêt sur image (s) et secousse (trauma) à l'impact
  agents: [
    { vitesse: 1.0, arret: 0.07, secousse: 0.42 }, // Éclaireur
    { vitesse: 0.78, arret: 0.09, secousse: 0.5 }, // Bastion : plus lent, plus lourd
    { vitesse: 1.3, arret: 0.06, secousse: 0.36 }, // Shinobi : plus vif
  ],
  fonduEntree: 0.1, // s — fondu de la pose du jeu vers la garde ; c'est aussi le temps où le héros freine et se plante
  fonduSortie: 0.14, // s — fondu de la fin de l'animation vers la pose du jeu
  liberation: 0.14, // s avant la fin : la touche de déplacement reprend la main (pendant le fondu de sortie)
  hauteurImpact: 0.95, // m — hauteur du bout du pied à l'impact : le haut de la borne (1,1 m) ; Mixamo frappe à ≈ 1,35 m
  passesImpact: 1, // recherche de l'image d'impact : 1 = jambe tendue la plus loin devant SANS correction (voir coup-pied.js)
  correctionMax: 1.2, // rad — inclinaison maximale de la cuisse vers le bas pour atteindre hauteurImpact
  // fenêtre de la correction de hauteur, en s de l'animation : montée [a0, a1], tenue, descente [b0, b1]
  correctionFenetre: [0.25, 0.47, 0.7, 0.92],
  penetration: 0.35, // m — le pied pousse « à travers » la borne : bout du pied à (rayon − penetration) de son centre
  recalageMax: 0.45, // m — recul au plus quand le héros est déjà trop près (jamais de pas en arrière plus grand)
  ancrage: true, // pied d'appui ancré au sol pendant le coup (position dessinée corrigée)
  dashAnnule: true, // un dash annule le coup à tout moment (porte de sortie face à la horde)
  trauma: TRAUMA.PLAYER_EXPLOSION, // groupe plafonné des explosions du joueur (0,45/s) : plus noyé par les morts de robots
  punch: 0.03, // zoom avant à l'impact (camera.punchZoom)
  avanceSon: 0.132, // s — SFX.COUP_PIED démarre ce temps avant l'impact : « lead » du manifeste (souffle de la jambe, puis le choc sur l'image de l'impact)
  fonduAnnule: 0.06, // s — fondu de sortie quand un dash annule le coup (pas de saut de pose)
};
// « Frappe au sol » − 3 (choc) + tôle « Coup arrêté par le bouclier du blindé » − 4 + souffle « Dash » − 5 avant le choc
// (outils/preparer_sons.py, option « couches ») ; 0,6 s, 1 dB au-dessus de PROP_BREAK (candidat, § E4.O.4)
AUDIO.sounds[SFX.COUP_PIED] = { dur: 0.6, gain: 0.3, minInterval: 0.08, maxVoices: 2, pitchVar: 0.5, priority: 1 };
//#endregion e4:O-coup-de-pied-v2

//#region e4:P-bouclier-blinde
// Étape 4, chantier P (ARCHITECTURE.md § E4.P) — Femz, 16/11 (21h15) : « il doit prendre 80% de degat en moin, a la
// moitié de sa vie son bouclier crack, et il prend 40% moin de degat en face ». Vaut pour tout robot BLINDE (v1, v2,
// élites, fusionnés, anneau d'acier) ; les armes bypassShield le contournent toujours ; de dos et de côté : plein.
Object.assign(ENEMIES.types[ENEMY.BLINDE].shield, {
  damageMul: 0.2, // de face, bouclier intact : 80 % de dégâts en moins (était 0 : coup annulé)
  seuil: 0.5, // part des PV max sous laquelle (≤) le bouclier se fissure, une fois
  damageMulFissure: 0.6, // de face, bouclier fissuré : 40 % de dégâts en moins
});
export const BOUCLIER = {
  // coup de face atténué : remplace le ricochet blanc et SHIELD_BLOCK (petite gerbe à la couleur d'acier du blindé,
  // partie du bord du bouclier vers la source ; son HIT plus bas et plus grave)
  impact: {
    sparks: 3,
    seconds: 0.16,
    speedMin: 3,
    speedMax: 7,
    width: 0.05,
    length: 0.3,
    upMin: 0.5,
    upMax: 2.5,
    gain: 1.15,
    shade: 0.25,
    coneDeg: 90,
    edge: 0.75, // m — départ au bord du bouclier, côté source (comme FX.shieldSpark.edge)
    offset: 0.08,
    height: 1.0, // m — hauteur du départ (milieu de la plaque)
    son: 0.55, // × gain de SFX.HIT (« Impact sur un robot.wav ») — candidat
    demiTons: -4, // plus grave qu'un coup plein — candidat
  },
  // fissure à mi-vie : état « fissuré » du modèle (pièce `fissures` du .glb), éclats, son de casse, arrêt sur image
  fissure: {
    eclats: 10, // éclats d'acier (low-poly, couleur du blindé) projetés du bouclier, côté du coup (fx.emitDebris)
    avant: 0.7, // m — les éclats partent du bouclier (devant le robot, côté source), pas de son centre
    arret: 0.05, // s d'arrêt sur image (fx.hitstop)
    secousse: 0.12, // trauma (groupe des morts, plafonné) — petite
    toleDemiTons: -5, // SHIELD_BLOCK (« Coup arrêté par le bouclier du blindé ») transposé, joué avec PROP_BREAK — candidat
    toleGain: 1.2, // × gain de SHIELD_BLOCK
  },
};
//#endregion e4:P-bouclier-blinde
//#region e4:Q-sauvegarde-boss
// Étape 4, chantier Q (ARCHITECTURE.md § E4.Q) — Femz, 16/11 (21h, 21h15) : « une chance sur 70 d'avoir un totem de
// ressurection sur le 1er boss, 1 chance sur 50 au 5eme boss etc, cap a 1 chance sur 30 » ; « totem de res = sauvegarde ».
// Chance au k-ième boss tué de la partie : 1 / max(plancher, base − parRang × k). Lâchée en disquette au sol (src/disquette.js).
export const SAUVEGARDE_BOSS = {
  base: 75, // 1 / (75 − 5k) : 1/70 au boss 1, 1/65 au 2, 1/50 au 5…
  parRang: 5,
  plancher: 30, // … plafond de chance 1/30, atteint au boss 9
  forcer: -1, // debug : chance forcée dans [0, 1] (−1 = la loi)
  // conditions SUPPOSÉES (Femz peut les changer) : débloquée au Noyau (meta.ITEM_OK, filtre des cartes et des coffres),
  // et pas bannie par le joueur dans la partie (BANS.items)
  siVerrouillee: false,
  siBannie: false,
  cap: 4, // disquettes au sol au plus (pool) ; au-delà : ramassée d'office
  ecart: 3.6, // m — posée à cette distance du centre du boss, côté héros : HORS des cercles de gemmes (1,5 m) et de
  // fragments (2,4 m) du boss (planche du 17/11 : à 1,8 m, elle se perdait parmi les gemmes violettes)
  modele: 'disquette.glb', // outils/blender/disquette.py
  hauteur: 1.5, // m — hauteur du modèle dans le jeu (× 1,8 du modèle : se lit de loin, au-dessus des gemmes ; planches du 17/11)
  couleur: 0xb06cff, // violet de l'objet (ITEMS[SAVE].color)
  survol: 0.8, // m — hauteur du bas de la disquette au-dessus du sol (elle flotte)
  flotte: 0.08, // m — amplitude du flottement
  flotteHz: 0.8,
  inclinaison: 0.79, // rad — penchée en arrière de 45° (caméra « Moyenne » à 45°) : face vers la caméra
  balance: 0.38, // rad — elle se balance de ± balance autour de la verticale (jamais un tour complet : la face reste lisible)
  balanceHz: 0.35,
  pouls: { periode: 1.2, ampleur: 0.06, lueurMin: 0.2, lueurMax: 0.75 }, // échelle × (1 + ampleur sin), lueur aFx.y
  chute: { hauteur: 2.2, secondes: 0.45, flash: 0.9 }, // tombe en rebondissant ; flash blanc qui s'éteint
  ramassage: 1.4, // m — rayon de contact
  aspiration: 26, // m/s — vitesse d'aspiration de fin de vague (celle du coffre)
  tache: { rayon: 2.2, intensite: 0.55 }, // flaque de lumière violette au sol (rendu/lumieres.js), × échelle dessinée
  // éclats (fx.spawnSauvegardeF) : [0] chute, [1] ramassage — anneau au sol + losanges qui montent
  eclat: [
    { anneau: 3.0, secondes: 0.55, losanges: 14, taille: 0.17, vie: 0.8, montee: 4.5, dispersion: 0.8, hauteur: 0.8, gain: 1.25 },
    { anneau: 1.8, secondes: 0.35, losanges: 10, taille: 0.14, vie: 0.55, montee: 3.2, dispersion: 0.5, hauteur: 0.6, gain: 1.2 },
  ],
  plafond: { soin: 0.5 }, // rangée d'objets pleine sans la Sauvegarde : soin de 50 % des PV max à la place (supposé)
};
// Notification (cadre FUI des succès, ui.toastSucces) : deux identifiants réservés hors des 20 succès ; textes fixes.
export const TOAST_SAUVE = Object.freeze({
  SAUVE: 100,
  SAUVE_PLEIN: 101,
  kicker: 'OBJET RÉCUPÉRÉ',
  nom: 'Sauvegarde · +1 niveau',
  effet: 'Une fois par vague, annule un coup qui devait vous tuer.',
  kickerPlein: 'SAUVEGARDE',
  nomPlein: "Rangée d'objets pleine",
  effetPlein: 'Soin de ' + Math.round(SAUVEGARDE_BOSS.plafond.soin * 100) + ' % des PV à la place.',
});
// « Soin du réparateur.wav » + 3, 0,8 s, + 2 dB sur CHEST_DROP ; « Passage de niveau.wav » + 3, 1,0 s, niveau d'ITEM_GET —
// candidats (§ E4.Q.3)
AUDIO.sounds[SFX.SAUVE_CHUTE] = { dur: 0.8, gain: 0.3, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.SAUVE_PRISE] = { dur: 1.0, gain: 0.3, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.COMPTE_CLIC] = { dur: 0.12, gain: 0.12, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 }; // repli synthétisé : clic d'interface
//#endregion e4:Q-sauvegarde-boss

//#region e4:S-icones-cel
// § E4.S — icônes cel « comme le jeu » (décision de Femz du 16/11, 22h-23h40). Images préparées par
// outils/preparer_icones.py depuis assets/ui/icones/sources/ : assets/ui/icones/<fichier>.png (88 px, affichées à 44 px
// en DPR 2) et <fichier>-44.png. UNE seule table pour tout le jeu : l'id du symbole SVG (sr-m-<objet>, sr-u-<bonus au
// sol>, sr-b-<bonus de niveau>, sr-w<arme>, sr-i-pixel) → le fichier. ui.js remplace le symbole de chaque id listé par
// l'image : HUD, fiche, Noyau, coffres, marchand, cartes de niveau, bilan et notifications passent tous par ce symbole.
// Les 15 évolutions (sr-e<id>) ont leur icône depuis le 21/11. Les 9 objets nés des fusions y sont depuis le 20/11 (icônes v2). Les 15 autres armes ont leur icône
// cel depuis le 17/11 (modèles Tripo de chaque arme).
export const ICONES_CEL = {
  dossier: 'assets/ui/icones/',
  table: {
    'sr-w0': 'arme-blaster',
    'sr-w2': 'arme-shotgun',
    'sr-w4': 'arme-rail',
    // 17/11 (Femz : « attaque les autres armes ») : icônes cel tirées des modèles Tripo de chaque arme
    'sr-w1': 'arme-orbitals',
    'sr-w3': 'arme-emp',
    'sr-w5': 'arme-rockets',
    'sr-w6': 'arme-ricochet',
    'sr-w7': 'arme-blade',
    'sr-w8': 'arme-turret',
    'sr-w9': 'arme-pool',
    'sr-w10': 'arme-boomerang',
    'sr-w11': 'arme-mines',
    'sr-w12': 'arme-katana',
    'sr-w13': 'arme-grenade',
    'sr-w14': 'arme-smoke',
    'sr-w15': 'arme-flash',
    'sr-w16': 'arme-cannon',
    'sr-w17': 'arme-hammer',
    'sr-m-tesla': 'objet-tesla',
    'sr-m-cryo': 'objet-cryo',
    'sr-m-virus': 'objet-virus',
    'sr-m-burn': 'objet-burn',
    'sr-m-detonator': 'objet-detonator',
    'sr-m-scope': 'objet-scope',
    'sr-m-berserk': 'objet-berserk',
    'sr-m-leech': 'objet-leech',
    'sr-m-shield': 'objet-shield',
    'sr-m-reactive': 'objet-reactive',
    'sr-m-dashcore': 'objet-dashcore',
    'sr-m-overclock': 'objet-overclock',
    'sr-m-drone': 'objet-drone',
    'sr-m-capacitor': 'objet-capacitor',
    'sr-m-shrapnel': 'objet-shrapnel',
    'sr-m-magnet': 'objet-magnet',
    'sr-m-luck': 'objet-luck',
    'sr-m-save': 'objet-save',
    'sr-u-battery': 'util-battery',
    'sr-u-magnet': 'util-magnet',
    'sr-u-iem': 'util-iem',
    'sr-u-stun': 'util-stun',
    'sr-u-turbo': 'util-turbo',
    'sr-u-compute': 'util-compute',
    'sr-b-maxHp': 'bonus-maxHp',
    'sr-b-moveSpeed': 'bonus-moveSpeed',
    'sr-b-xpGain': 'bonus-xpGain', // § E5.Z : gemme dessinée en pixels (outils/icones_v2/icone_xpgain.py), provisoire ; 'sr-b-pickupRadius' avant
    'sr-b-crit': 'bonus-crit',
    'sr-b-regen': 'bonus-regen',
    'sr-b-dashCd': 'bonus-dashCd',
    'sr-b-area': 'bonus-area',
    'sr-b-damage': 'bonus-damage',
    'sr-b-fireRate': 'bonus-fireRate',
    'sr-b-armor': 'bonus-armor',
    'sr-i-pixel': 'monnaie-pixel', // § E4.S.9 : la monnaie méta (Pixels)
    // 20/11 (Femz, via la session CTRL+Z) : les 9 objets nés des fusions ont leur icône, même style
    'sr-m-orage': 'fusion-orage',
    'sr-m-malware': 'fusion-malware',
    'sr-m-reaction': 'fusion-reaction',
    'sr-m-retroaction': 'fusion-retroaction',
    'sr-m-parefeu-actif': 'fusion-parefeu-actif',
    'sr-m-surregime': 'fusion-surregime',
    'sr-m-essaim': 'fusion-essaim',
    'sr-m-recyclage': 'fusion-recyclage',
    'sr-m-restauration': 'fusion-restauration',
    // 21/11 (Femz : « génère des nouvelles icônes pour les armes évoluées ») : les 15 évolutions ont leur icône, même
    // style (planches E1/E2, outils/icones_v2/decouper_evo.py) — avant, elles prenaient celle de leur arme de base
    'sr-e0': 'evo-canon-chiffre',
    'sr-e1': 'evo-couronne-scies',
    'sr-e2': 'evo-brise-ligne',
    'sr-e3': 'evo-essaim',
    'sr-e4': 'evo-lame-fantome',
    'sr-e5': 'evo-coupe-circuit',
    'sr-e6': 'evo-foudre-ombre',
    'sr-e7': 'evo-shuriken-givre',
    'sr-e8': 'evo-seisme',
    'sr-e9': 'evo-champ-mines',
    'sr-e10': 'evo-dome-ionique',
    'sr-e11': 'evo-nappe-virale',
    'sr-e12': 'evo-lance-prisme',
    'sr-e13': 'evo-nuage-frag',
    'sr-e14': 'evo-forteresse',
  },
  // couleur dominante de chaque icône (assets/ui/icones/couleurs.json, mesurée par le script) ; § E4.S.4
  // § E5.T (Femz, 22/11) : Sentinelle et grosse tourelle en CYAN 0x5ae0ff — l'œil de la Sentinelle (0x5ac8ff) est à
  // ΔE 17 du blaster (0x4fb0ff) ; 0x5ae0ff reste à ΔE ≥ 30 de toutes les autres armes (EMP 31, blaster 35, flash 48)
  couleur: { // 20/11 : ton vif de la gamme de chaque icône v2 (outils/icones_v2/recolorer_vif.py)
    'arme-blaster': 0x4fb0ff, 'arme-orbitals': 0xffb81f, 'arme-shotgun': 0xff8a1f, 'arme-emp': 0x18d6c3, 'arme-rail': 0xa35cff, 'arme-rockets': 0x7ee020, 'arme-ricochet': 0xff4fae, 'arme-blade': 0xecec2a, 'arme-turret': 0x5ae0ff, 'arme-pool': 0x1fd67a, 'arme-boomerang': 0xf02ef0, 'arme-mines': 0xffa070, 'arme-katana': 0xff3050, 'arme-grenade': 0xffb81f, 'arme-smoke': 0xb896ff, 'arme-flash': 0x5ce8b0, 'arme-cannon': 0x5ae0ff, 'arme-hammer': 0xff8a1f,
  },
  hudCase: 2.75, // rem : cases d'arme, d'objet et d'utilitaire du HUD (44 px à 1280 × 720)
};
// § E4.S.4 — la couleur de l'icône devient la couleur d'IDENTITÉ de la chose (liseré du bas de la case d'arme, cartes
// du marchand, barre du bilan, puce d'un bonus au sol et sa pastille au sol). La rareté (liseré des objets) ne change
// pas, ni les couleurs des VFX des armes (PALETTE.weapon reste celle des projectiles).
/** Couleur d'identité d'une arme dans l'interface (PALETTE.weapon, sauf les armes à icône cel). */
export const ARME_COULEUR_UI = PALETTE.weapon.map((c, w) => {
  const f = ICONES_CEL.table['sr-w' + w];
  return f && ICONES_CEL.couleur[f] !== undefined ? ICONES_CEL.couleur[f] : c;
});
{
  const OBJ = { tesla: 0x18d6c3, cryo: 0x4fb0ff, virus: 0x7ee020, burn: 0xff8a1f, detonator: 0xecec2a, scope: 0xffa070, berserk: 0xff3050, leech: 0xf02ef0, shield: 0x6f6aff, reactive: 0xffb81f, dashcore: 0x5ce8b0, overclock: 0xa35cff, drone: 0x1fd67a, capacitor: 0xb896ff, shrapnel: 0xff7a5c, magnet: 0xff4fae, luck: 0x7ee020, save: 0xa35cff };
  const UT = { battery: 0x1fd67a, magnet: 0xff7a5c, iem: 0x4fb0ff, stun: 0xecec2a, turbo: 0xff8a1f, compute: 0xb896ff };
  for (const I of ITEMS) if (OBJ[I.key] !== undefined) I.color = OBJ[I.key];
  for (const U of UTILITIES.list) if (UT[U.key] !== undefined) U.color = UT[U.key];
}
//#endregion e4:S-icones-cel

//#region e4:T-controle
// Étape 4, chantier T (ARCHITECTURE.md § E4.T.3) — contrôle indépendant du 17/11 : le premier boss n'était jamais tué
// avec le contenu de départ. La « prise en main » (DIFFICULTY.ease, région e2:G-difficulte) réduit PV et dégâts des
// robots des vagues 1 à 8, mais le boss en était exclu : il arrivait à la vague 5 avec PV et dégâts PLEINS du cahier.
// Le boss d'une vague de boss (et ses invocations, ses drones-boucliers) suit maintenant la même table que les robots
// de sa vague. Les boss des vagues 10 et suivantes ne changent pas (la table vaut 1 au-delà de ease.waves). Un boss
// appelé hors vague de boss (debug, tests : spawnBoss à la vague 1) n'est pas touché.
export const BOSS_PRISE_EN_MAIN = {
  actif: true, // false = boss du cahier (comportement d'avant le 17/11)
  leviers: { hp: 'hp', dmg: 'dmg' }, // levier de threatMul lu pour les PV et pour les dégâts du boss
  // PV du boss de RANG 1 seulement (vague 5), en plus de la table : la table seule (× 0,45 → 1 465 PV) laissait encore le
  // boss à 21-64 % de ses PV quand le bon joueur-robot mourait (27 à 56 s de combat, 21 à 32 dégâts par seconde, mesuré
  // le 17/11, tests/.cache/controle-e4-T/sonde-boss.mjs). × 0,6 → 879 PV : boss tué 2 fois sur 6 ; × 0,5 → 733 PV : 3 fois
  // sur 6 (les 3 autres meurent en phase 2, boss à 9, 65 et 359 PV). Réglage à trancher par Femz en jouant (§ E4.T.3).
  pvRang1: 0.5,
};
/** Facteur de prise en main du boss arrivé à la vague n, pour 'hp' | 'dmg' (§ E4.T.3). Pure. */
export function bossPriseEnMain(n, lever) {
  const B = BOSS_PRISE_EN_MAIN;
  if (!B.actif || !isBossWave(n)) return 1;
  const f = threatMul(n, B.leviers[lever]);
  return lever === 'hp' && bossRank(n) === 1 ? f * B.pvRang1 : f;
}
//#endregion e4:T-controle
//#region e5:menu-sons
// Étape 5, menu-sons — écran titre (demande de Femz du 17/11 : « retirer les sfx des pas des robots, juste l'ambiance
// musique de fond »). false : la scène du titre (src/menu/menu.js) ne joue plus AUCUN son — pas des boss (BOSS_STEP),
// alarme lointaine (BOSS_ALARM), atterrissage du héros (BOSS_SLAM), tirs (BLASTER, RAIL, SHOTGUN, ROCKET, déjà coupés
// par MENU.tirs). Seule la nappe d'ambiance reste (MENU.son.ambiance). La poussière et la secousse des pas restent
// (image seule). Les sons d'interface (UI_CLICK des boutons) ne passent pas par la scène : inchangés. true les remet.
MENU.sonsUnites = false;
//#endregion e5:menu-sons
//#region e5:A-decisions-1711
// Étape 5 (ARCHITECTURE.md § E5.A) — décisions de Femz du 17/11 au matin, sur l'étape 4 jouée. Chaque réglage change ou
// AJOUTE des clés aux tables des régions d'avant (rien n'est renommé ni retiré) ; lu par boss.js, cooldowns.js,
// disquette.js et pickups.js.
//
// A.2 Premier boss (vague 5) : « garde les PV à 3 000 ». Le correctif du 17/11 (§ E4.T.3 : prise en main × 0,45, puis
// pvRang1 × 0,5) l'avait mis à 733 PV. Le boss de RANG 1 lui-même a maintenant pvBossRang1 PV ; ses dégâts gardent la
// prise en main (× 0,55 à la vague 5) ; ses invocations et ses drones-boucliers gardent la table d'avant (bossPriseEnMain,
// inchangée). 0 = la formule (bossHpMul × bossPriseEnMain).
BOSS_PRISE_EN_MAIN.pvBossRang1 = 3000;
//
// A.3 Boss de rang 2 et plus (vagues 10, 15, 20…) : « il ne faudrait pas qu'il soit simple ». Mesuré (§ E5.A.3,
// tests/e5-A-boss-duree.mjs, 8 graines) : PAS les recharges par niveau (région e4:G coupée : même durée) ; c'est le
// bouclier du blindé réduit au lieu d'annuler (région e4:P, § E4.P) : les blindés n'arrêtent plus les tirs devant le
// boss — coupée seule, la durée de l'étape 3 revient presque. PV du boss lui-même × pvRang2Plus à partir du rang 2 (le
// boss de la vague 5, ses invocations et ses drones-boucliers : inchangés). Réglé sur les moyennes de 8 graines : × 1,5
// laissait la vague 20 sous l'étape 3 (52,7 s contre 55,8) ; × 1,6 retenu.
export const BOSS_DUREE = {
  pvRang2Plus: 1.6,
};
/** Multiplicateur de PV du BOSS LUI-MÊME arrivé à la vague n (enemies.spawn : PV = BOSS.hp × ceci). Pure (§ E5.A.2, A.3). */
export function bossPvMul(n) {
  const B = BOSS_PRISE_EN_MAIN;
  if (B.actif && isBossWave(n) && bossRank(n) === 1 && B.pvBossRang1 > 0) return B.pvBossRang1 / BOSS.hp;
  const f = isBossWave(n) && bossRank(n) >= 2 ? BOSS_DUREE.pvRang2Plus : 1;
  return bossHpMul(n) * bossPriseEnMain(n, 'hp') * f;
}
//
// A.4 Départs de salve : le marteau, la nappe corrosive et le canon lourd n'ont plus d'explosion centrée sur le héros au
// départ de leur salve (le marteau la montrait 0,32 s avant sa frappe) ; leur effet à l'impact ne change pas. « Garde les
// secousses » : la secousse du départ reste pour ces trois armes ET revient aux grenades (retirée le 17/11, § E4.M bis).
// Le son reste. L'arrêt sur image du départ est retiré pour les quatre (déjà retiré aux grenades ; lecture proposée pour
// les trois autres, à valider : un arrêt sans rien de visible se lisait comme un accroc). Disques orbitaux et boomerang :
// inchangés (éclat gardé). Femz, 17/11 (11h) : « oui remet » → l'arrêt sur image REVIENT au départ du marteau, de la
// nappe et du canon ; les grenades restent sans arrêt.
for (const k of ['hammer', 'pool', 'cannon']) RECHARGES.weapons[k].depart = { eclat: 0, secousse: 1, arret: 1, son: 1 };
RECHARGES.weapons.grenade.depart = { eclat: 0, secousse: 1, arret: 0, son: 1 };
//
// A.5 Sauvegarde (disquette violette lâchée par un boss) : même couleur, un « deep glow ». Zéro appel de dessin en plus :
// la lueur de la disquette passe au-dessus du seuil du bloom (PEINT.bloom.seuil 1,7 sur le canal le plus fort) — le bloom
// à 5 niveaux l'étale en couches douces autour d'elle — et sa flaque de lumière au sol (rendu/lumieres.js, maillage
// des taches, déjà dessiné) grandit et s'intensifie. disquette.js multiplie la couleur de lueur de SON matériau par
// halo.gain et l'émissif de sa bande par halo.bande ; le pouls (lueurMin → lueurMax) fait respirer le halo.
// Réglage choisi sur planche (tests/e5-A-planches.mjs, essais du 17/11) : halo.gain 2,6 et lueur 0,55 → 0,95 aplatissaient
// la disquette en un pavé lavande (volet et étiquette illisibles) ; × 4 avec une lueur 0,3 → 0,65 garde son dessin et
// fait déborder le bloom au sommet du pouls.
SAUVEGARDE_BOSS.halo = { gain: 4, bande: 9 };
SAUVEGARDE_BOSS.pouls = { periode: 2.4, ampleur: 0.035, lueurMin: 0.3, lueurMax: 0.65 }; // plus lent (était 1,2 s, 6 %, 0,2 → 0,75)
SAUVEGARDE_BOSS.tache = { rayon: 4.2, intensite: 1.4 }; // reflet au sol (était 2,2 m, 0,55)
//
// A.6 Butin qui va disparaître (gemmes et fragments au sol, § E2.G bis G1) : « retire le truc qui fait glitcher, grossir
// et rapetisser vite les gemmes et fragments avec le clignotement ». Signal 'doux' : la LUEUR du butin perdu monte et
// redescend lentement (cosinus, jamais de saut), taille inchangée ; 'aucun' le coupe entièrement ; 'clignote' rend
// l'ancien (taille × blinkScale et éclair blanc à blinkHz / fastHz). Le butin gardé ne change jamais.
END_LOOT.signal = 'doux';
END_LOOT.doux = { hz: 0.7, hzFin: 1.1, lueur: 0.55 }; // pouls de lueur (Hz) sous blinkSeconds, puis sous fastSeconds ; lueur au sommet (aFx.y)
//#endregion e5:A-decisions-1711

//#region e5:B-parefeu
// Étape 5, chantier B (ARCHITECTURE.md § E5.B) — Femz, 17/11 : « le shield pare-feu qui bloque les dégâts devrait plus
// avoir ce look in game dans son animation » (réfs : dôme d'énergie en alvéoles hexagonales, Fresnel sur le contour,
// anneau et disque au sol ; variante cyan → violet). Dôme autour du héros (src/vfx/dome-parefeu.js) : UN maillage
// (alvéoles + anneau + disque), 1 appel de dessin quand le héros a le Pare-feu, 0 sinon ; mélange additif ; animé
// par uniformes (aucune allocation par image). AUCUNE règle de jeu ne change (items.js : un coup arrêté, puis la
// recharge) ; quand le dôme est actif, il remplace les deux ondes VISUELLES d'origine du Pare-feu (au coup arrêté, à
// la fin de la recharge). L'onde de la Coque réactive et celle du Pare-feu actif (fusion, dégâts) ne changent pas.
// Durées en s (temps simulé : l'arrêt sur image fige aussi le dôme), tailles en m, intensités en couleur linéaire
// additive (le bloom part de 1,7 sur le canal le plus fort : PEINT.bloom.seuil).
// Demande de Femz du 20/11 soir (docs/conception-caisses-parefeu.md § 1) : le Pare-feu chargé encaisse `pv` PV de dégâts
// (au lieu d'un coup entier) ; le coup qui vide la réserve est arrêté EN ENTIER, puis il tombe et se recharge (recharge
// de l'objet inchangée). Fixe : les piles ne la montent pas. (BOUCLIER est pris : bouclier du blindé, § E4.P.)
export const PAREFEU_RESERVE = {
  pv: 40,
  // barre bleue au-dessus du héros tant qu'il est chargé (src/barres-vie.js, même mesh que les barres des robots) :
  // couleur = haut du dôme du Pare-feu (PAREFEU_DOME.a.haut) ; hauteur au-dessus du sol, au-dessus de la tête du héros
  // (PLAYER.height 1,8 × visualScale 1,15 ≈ 2,07 m) ; largeur arrondie au pixel d'art de BARRE.px
  barre: { couleur: 0x46d2ff, hauteur: 2.45, largeurM: 1.2 },
};
export const PAREFEU_DOME = {
  actif: true, // false : rendu d'avant (aucun dôme, ondes d'origine)
  variante: 'b', // choix de Femz le 17/11 : 'b' cyan → violet (réf. 14) ; 'a' : cyan (réf. 13). ?dome=a ou ?dome=b dans l'URL l'emporte
  variantes: {
    // bas : alvéoles du bas et du bord ; haut : sommet (dégradé si melange > 0) ; bord : arêtes ; flash : coup, onde
    a: { bas: 0x2fc6ff, haut: 0x46d2ff, bord: 0xc2f4ff, flash: 0xe8fbff, melange: 0.35 },
    b: { bas: 0x2fd2ff, haut: 0x9b4dff, bord: 0xe2c8ff, flash: 0xf4eaff, melange: 1 },
  },
  // ellipsoïde : rayon au sol, hauteur (le héros fait 2,07 m) ; frequence : alvéoles du polyèdre (10 f² + 2 sur la
  // sphère, la moitié au-dessus du sol : 3 → ≈ 50 alvéoles de ≈ 0,6 m, lisibles une fois pixelisées au recul maximum ; 5 : trop fines) ; ecart : vide entre deux alvéoles (part du rayon)
  forme: { rayon: 1.7, hauteur: 2.3, frequence: 3, ecart: 0.14 },
  // prêt : le dôme respire (intensité ± ampleur, taille ± echelle, période en s) ; une bande de lumière monte toutes
  // les bandePeriode s
  respiration: { periode: 2.6, ampleur: 0.2, echelle: 0.012, bandePeriode: 3.2 },
  // intensite : alvéoles de face (le centre reste presque transparent) ; fresnel : puissance du bord ; aretes :
  // arêtes lumineuses ; basDuDome : le bord au sol s'allume ; anneau / disque : au sol
  look: { intensite: 0.26, fresnel: 1.6, aretes: 0.55, basDuDome: 0.14, anneau: 1.1, disque: 0.08 },
  // coup arrêté : hauteurImpact (élévation du point d'impact, sphère unité) ; onde (rad/s, largeur en rad) ; part des
  // alvéoles proches de l'impact qui se détachent et s'envolent (m/s) ; lueur de l'onde, flash des alvéoles, du dôme
  // et de l'anneau (× l'intensité de base, décroît en flashDuree s)
  coup: { hauteurImpact: 0.35, vitesseOnde: 11, largeurOnde: 0.4, partDetachee: 0.45, vitesseDetache: 3.2, lueurOnde: 1.6, flashAlveoles: 0.9, flashDuree: 0.08, flashDome: 2.0, flashAnneau: 2.5 },
  // recharge : le dôme se reconstruit pendant les `duree` dernières s (au plus partMax × la recharge) ; solVersHaut :
  // part de l'ordre qui va du sol au sommet (le reste : hasard) ; pouls « prêt » (s) du dôme et de l'anneau
  reconstruction: { duree: 0.8, partMax: 0.45, solVersHaut: 0.7, pouls: 0.18, poulsDome: 0.8, poulsAnneau: 1.5 },
  // anneau au sol : segments, bande de de × rayon à a × rayon (détaché du bord du dôme, comme la réf. 13) ; le disque
  // au sol va du centre au bord du dôme
  anneau: { segments: 96, de: 1.08, a: 1.2 },
};
//#endregion e5:B-parefeu

//#region e5:C-interagir
// Étape 5, chantier C (ARCHITECTURE.md § E5.C) — demande de Femz du 17/11 : « au lieu de mettre un coup de pied auto sur
// un objet destructible, on doit appuyer sur E pour interagir et le kick, avec un petit icône E qui pop au-dessus quand
// on est prêt, pour qu'on comprenne ».
// Action « Interagir » : ACTION est figé (région fondation) ; l'indice est le premier libre après ACTION_COUNT, et
// input.js dimensionne ses tables sur ACTION_TOTAL. E quitte la frappe éclair (région e3:Z, qui garde A = KeyQ) pour
// Interagir ; la migration des touches enregistrées est faite par input.js (§ E5.C.2).
export const ACTION_INTERACT = ACTION_COUNT; // 19
// Menus « Pile » (choix de Femz du 19/11) : Tab ouvre et ferme la FICHE de l'agent en partie, Échap reste le menu.
// Action fixe (pas de ligne au tableau « Touches » : Tab est dans TOUCHES.reservees, aucune autre action ne peut la prendre).
export const ACTION_FICHE = ACTION_COUNT + 1; // 20
export const ACTION_TOTAL = ACTION_COUNT + 2;
INPUT.actions[ACTION_INTERACT] = ['KeyE'];
INPUT.actions[ACTION_FICHE] = ['Tab'];
INPUT.preventDefault.push('Tab'); // sinon le navigateur promène le focus entre les boutons
// ligne du tableau « Touches » de la pause : 2e colonne, groupe « Monde », en dernier. Mesuré : sous la frappe éclair
// (1re colonne, 10 lignes), la fenêtre de la pause débordait de 720 px (y 24 → 723) ; la 2e colonne avait une ligne et un
// groupe de moins, les deux colonnes ont maintenant la même hauteur (ui.css non touché).
TOUCHES.lignes.push({ id: 'interagir', label: 'Interagir', action: ACTION_INTERACT, col: 1, groupe: 'Monde' });
// la fiche de l'arme disait « (A ou E) ». 19/11 (choix de Femz : ≤ 12 mots, la VRAIE touche) : modèle à {touche},
// remplacé par input.js par le libellé de la touche de frappe réglée (AZERTY / QWERTY, touche changée dans la pause)
WEAPONS.find((W) => W.id === WEAPON.FLASH).descModele = 'Touche {touche} : foncez droit devant vous et tranchez tout.'; // § E5.X4 (J3)
WEAPONS.find((W) => W.id === WEAPON.FLASH).desc = 'Touche A : foncez droit devant vous et tranchez tout.';
export const INTERAGIR = {
  // Portée : celle du coup automatique d'avant (§ E4.O.2 : D* + chemin de freinage ; repli § E4.J : rayon + portee).
  // « Et la regarde à peu près » : il n'y avait PAS de cône dans le coup automatique ; cône ajouté ici, large : cos de
  // l'écart maximal entre le cap du héros (P.rot) et la borne. −0,17 ≈ 100° de chaque côté (seule une borne DANS LE DOS
  // n'est pas prête) ; −1 = sans cône.
  cone: -0.17,
  tampon: 0.2, // s — un appui juste avant d'être à portée reste valable (comme STRIKE_KEYS.bufferSeconds)
  // Le héros ne traverse plus les bornes (avant, le coup automatique partait à ≈ 2 m : il ne les touchait jamais) ; un
  // dash les traverse toujours et les casse (§ E4.J). false : il les traverse.
  bloque: true,
  // Migration : touches libres essayées dans l'ordre quand E est déjà pris par une autre ligne (§ E5.C.2)
  repli: ['KeyF', 'KeyG', 'KeyT', 'KeyV', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
  // Invite « touche » au-dessus de la borne prête (src/invite-interagir.js) : pixel-art dessiné une fois dans un canvas
  // (police Determination échantillonnée sur sa grille), UN sprite face caméra hors de l'effet CRT (render.garderNet)
  invite: {
    pxArt720: 2, // px d'écran par pixel d'art à 720 p de haut (4 à 1440 p) : même part de l'écran à toute taille
    leve: 0.32, // m au-dessus du haut de la borne (DECORS.height) : la pointe de l'invite
    pop: 0.26, // s — apparition : échelle en « retour » (easeOutBack)…
    rebond: 2.2, // …surcharge de la courbe (≈ 12 % au-dessus de la taille finale)
    entree: 0.1, // s — fondu d'entrée
    sortie: 0.16, // s — fondu de sortie (on s'éloigne, ou la borne n'est plus prête)
    appui: 0.1, // s — touche enfoncée affichée après l'appui…
    sortieAppui: 0.18, // …puis fondu de sortie (le coup part, l'invite ne cache pas le geste)
    flottement: { amplitude: 0.5, periode: 1.7 }, // pixels d'art, s — respiration verticale à l'arrêt
    // couleurs du HUD « carte mère » (ui.css : --cy-line, --cy-text, --cy-solid, --sr-cyan)
    couleurs: {
      trait: '#96cde6',
      face: 'rgba(14, 22, 30, 0.94)',
      reflet: 'rgba(150, 205, 230, 0.32)',
      levre: '#070b10',
      levreTrait: '#5d8396',
      texte: '#e4ebf1',
      texteAppui: '#3fe0d0',
      equerre: '#3fe0d0',
    },
  },
};
//#endregion e5:C-interagir

//#region e5:D-reparateurs
// Étape 5, chantier D (ARCHITECTURE.md § E5.D) — Femz, 17/11 : « les robots qui redonnent de la vie volent au-dessus
// des mobs pour les régénérer, et le joueur les focus d'abord eux, sinon c'est impossible quand ils sont derrière des
// vagues de mobs bouclier ».
//   1. Le réparateur VOLE : survol `hauteur` (pieds au-dessus d'un blindé, 2,2 m), léger flottement, ombre de contact
//      d'unité volante (src/rendu/ombres-contact.js, aucun appel de dessin de plus). Déplacement RESOLVE.FLY (bords de
//      l'arène seulement, comme le drone) ; il ne se sépare que des autres volants hauts : la horde au sol ne le bloque
//      plus et il ne la pousse plus. Ses soins ne changent pas (portée mesurée à plat, x / z).
//   2. Un tir droit tiré VERS un volant haut (blaster, plomb dans l'axe de la pompe, ricochet, sentinelle, boomerang à
//      l'aller) vole à l'altitude de sa cible : il passe au-dessus de tout robot moins haut que lui (le bouclier d'un
//      blindé ne le couvre plus) ; seuls l'arrêtent ce qui monte plus haut (le boss) et les autres volants.
//   3. Visée : les armes qui choisissent une cible visent d'abord le réparateur le plus proche à leur portée.
//   4. Repère : un réticule couché autour du réparateur visé, dans le lot TIRS de src/vfx (aucun maillage de plus).
export const REPARATEUR_VOL = {
  actif: true, // false : réparateur au sol et règles d'avant (aucune priorité, aucun tir aérien, aucun réticule)
  hauteur: 2.4, // m — survol du réparateur (pieds) : 0,2 m au-dessus d'un blindé
  volHaut: 2, // m — un type dont le survol atteint ce seuil est un « volant haut » (le drone, 1,3 m, n'en est pas un)
  // flottement (allure.js) : montée et descente (m, Hz), roulis lent (rad, Hz), membres presque immobiles (part du
  // balancement de marche gardée : il ne « marche » plus en l'air)
  flottement: { amp: 0.12, hz: 0.55, roulis: 0.06, roulisHz: 0.37, membres: 0.2 },
  montee: 2.2, // m — un tir aérien monte de la bouche à l'altitude de sa cible sur ses `montee` premiers mètres (dessin)
  dronesBossDAbord: false, // false : réparateur, puis drone-bouclier du boss (§ E1.D), puis la règle de l'arme
  // réticule autour du réparateur visé : rayon (m), à la hauteur de son centre ; tenu `tenue` s après le dernier tir
  // prioritaire ; couleur linéaire additive (blanc chaud cerné d'orange, lisible sur le sable et sur un robot gris)
  // style 26 : numéro libre des styles couchés continus de src/vfx/shader.js (VFX_STYLE, figé, s'arrête à 25)
  reticule: { actif: true, style: 26, rayon: 0.95, tenue: 0.6, tour: 1.4, bord: [1.0, 0.32, 0.06], coeur: [1.0, 0.86, 0.62] },
};
if (REPARATEUR_VOL.actif) {
  ENEMIES.types[ENEMY.REPARATEUR].hover = REPARATEUR_VOL.hauteur;
  Object.assign(ENEMIES.types[ENEMY.REPARATEUR].anim, { glide: true }); // flotte : pas d'écrasement au pas
  const A = ANIM.robots.types.reparateur;
  Object.assign(A, { legSwing: A.legSwing * REPARATEUR_VOL.flottement.membres, armSwing: A.armSwing * REPARATEUR_VOL.flottement.membres, stepSquash: 0 });
}
//#endregion e5:D-reparateurs

//#region e5:E-ui-1711
// Étape 5, chantier E (ARCHITECTURE.md § E5.E) — maquettes validées par Femz le 17/11 au matin, intégrées pour de vrai :
// HUD « V5 », récap des ramassages « R1 », marchand « M3 », pièce animée « CTRL+Z » et monnaie renommée « Pixelz ».
// Lu par ui.js (HUD, récap, marchand, cartes de niveau et de coffre), ui-hub.js et ui-bilan.js (monnaie). Les styles
// sont dans ui.css (bloc « Étape 5, chantier E ») ; ici, seulement les données.
//
// E.1 HUD V5 — paliers de couleur du NIVEAU d'une arme (1 à 21), 3 niveaux par couleur (proposition de Femz) : le
// contour carré de la case ET le gros chiffre prennent la couleur du palier. ui.js change une CLASSE (sr-pal-<k>) quand
// le palier change, jamais à chaque image ; la couleur de chaque classe est écrite une fois à l'init depuis cette table.
export const HUD_PALIERS = [
  { de: 1, a: 3, nom: 'gris', couleur: '#c3cbd6' },
  { de: 4, a: 6, nom: 'vert', couleur: '#5cf07a' },
  { de: 7, a: 9, nom: 'bleu', couleur: '#4da3ff' },
  { de: 10, a: 12, nom: 'violet', couleur: '#b06cff' },
  { de: 13, a: 15, nom: 'jaune', couleur: '#ffe14a' },
  { de: 16, a: 18, nom: 'orange', couleur: '#ff8a2a' },
  { de: 19, a: 21, nom: 'rouge', couleur: '#ff4b5c' },
];
/** Palier (indice dans HUD_PALIERS) du niveau n d'une arme ; au-delà du dernier palier : le dernier. Pure. */
export function palierNiveau(n) {
  for (let k = 0; k < HUD_PALIERS.length; k++) if (n <= HUD_PALIERS[k].a) return k;
  return HUD_PALIERS.length - 1;
}
//
// E.2 Récap des ramassages « R1 flux de lignes » (en haut à droite, sous le compteur de fragments) : une ligne par
// type ramassé (icône, nom en clair, effet cumulé, « ×N »), la plus récente en haut, `lignes` au plus ; une ligne
// s'efface `vie` s après son dernier ramassage (transition CSS de `sortie` s). Les compteurs sont réécrits au plus `hz`
// fois par seconde. Types = ce que le jeu ramasse vraiment (pickups.js, utilities.js, chests.js écrivent dans
// src/ramassage.js) ; la Sauvegarde garde sa propre notification (§ E4.Q.3). effet : 'xp' « +N XP » (valeur cumulée),
// 'frag' « +N » (fragments cumulés), 'pv' « +N PV » (PV réels cumulés dans RAM_I : Batteries de 25 à 75 PV, Femz 20/11 soir), 'texte' (phrase fixe).
const hexUi = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
const UTIL_UI = (k) => UTILITIES.list.find((u) => u.key === k);
export const RECAP = {
  actif: true,
  lignes: 6,
  vie: 3, // s après le DERNIER ramassage de la ligne
  sortie: 0.45, // s — fondu de sortie (transition CSS)
  hz: 10, // écritures des compteurs par seconde, au plus
  max: 9999, // au-delà : « +12 k XP » (chaînes précalculées, par milliers jusqu'à maxK)
  maxK: 999,
  maxN: 999, // « ×N » au-delà : « ×999+ »
  types: [
    { cle: 'gemmeVerte', nom: 'Gemme verte', icone: 'sr-i-gemme', couleur: hexUi(PALETTE.gemGreen), effet: 'xp' },
    { cle: 'gemmeBleue', nom: 'Gemme bleue', icone: 'sr-i-gemme', couleur: hexUi(PALETTE.gemBlue), effet: 'xp' },
    { cle: 'gemmeViolette', nom: 'Gemme violette', icone: 'sr-i-gemme', couleur: hexUi(PALETTE.gemViolet), effet: 'xp' },
    { cle: 'grosseGemme', nom: 'Grosse gemme', icone: 'sr-i-grosse-gemme', couleur: '#c9a4ff', effet: 'xp' },
    { cle: 'fragments', nom: 'Fragments', icone: 'sr-i-frag', couleur: hexUi(PALETTE.fragment), effet: 'frag' },
    { cle: 'grosFragment', nom: 'Gros fragment', icone: 'sr-i-frag', couleur: '#8ff6ec', effet: 'frag' },
    { cle: 'battery', nom: 'Batterie', icone: 'sr-u-battery', couleur: hexUi(UTIL_UI('battery').color), effet: 'pv' },
    { cle: 'magnet', nom: 'Aimant', icone: 'sr-u-magnet', couleur: hexUi(UTIL_UI('magnet').color), effet: 'texte', texte: 'attire tout le butin' },
    { cle: 'iem', nom: 'I.E.M', icone: 'sr-u-iem', couleur: hexUi(UTIL_UI('iem').color), effet: 'texte', texte: 'robots à l’écran détruits' },
    { cle: 'stun', nom: 'Décharge', icone: 'sr-u-stun', couleur: hexUi(UTIL_UI('stun').color), effet: 'texte', texte: 'robots figés ' + UTILITIES.stun.seconds + ' s' },
    { cle: 'turbo', nom: 'Overclocking', icone: 'sr-u-turbo', couleur: hexUi(UTIL_UI('turbo').color), effet: 'texte', texte: 'vitesse et dégâts · ' + UTILITIES.turbo.seconds + ' s' },
    { cle: 'compute', nom: 'Puissance de calcul', icone: 'sr-u-compute', couleur: hexUi(UTIL_UI('compute').color), effet: 'texte', texte: 'un fragment par coup · ' + UTILITIES.compute.seconds + ' s' },
    { cle: 'cache', nom: 'Cache de données', icone: 'sr-i-cache', couleur: '#ffc83d', effet: 'texte', texte: 'un lot à choisir' },
  ],
};
/** Indices des types du récap (RECAP.types) : gemme de palier p = p ; bonus au sol id = UTIL0 + id (UTILITIES.list). */
export const RECAP_T = { GEMME: 0, GROSSE_GEMME: 3, FRAGMENTS: 4, GROS_FRAGMENT: 5, UTIL0: 6, CACHE: 12, COUNT: 13 };
for (let id = 0; id < UTILITIES.list.length; id++) {
  if (RECAP.types[RECAP_T.UTIL0 + id].cle !== UTILITIES.list[id].key) throw new Error('RECAP : bonus au sol hors d’ordre (' + UTILITIES.list[id].key + ')');
}
//
// E.3 Marchand « M3 carte-mère pixel » et cartes de niveau / lots de coffre dans le même style : ui.js écrit lui-même
// les balises colorées — chiffres (sr-n) et mots clés (sr-k, liste ci-dessous, sans tenir compte de la casse ni des
// accents en bord de mot). Sur une ligne d'achat du marchand : le gain (« +2 », « +0,3 /s ») puis le nom de la stat.
// Marchand « A3 » (Femz, 20/11 : « sous l'arme, une description de l'amélioration visée : Dégâts → augmente les
// dégâts, Cadence → augmente la cadence, etc., adaptée ») : une phrase par NOM de stat (WEAPONS[w].statLabels), « {a} »
// = le nom de l'arme. Le chiffre (« +3 dégâts ») est écrit à part par ui.js depuis le gain réel de la boutique.
export const MARCHAND_PHRASES = {
  'Dégâts': 'Chaque coup du {a} fait plus mal.',
  'Cadence': 'Le {a} tire plus souvent.',
  'Projectiles': 'Une balle de plus à chaque tir, sur des robots différents.',
  'Portée': 'Le {a} repère et touche les robots de plus loin.',
  'Perforation': "Chaque balle traverse un robot de plus avant de s'arrêter.",
  'Vitesse': 'Les disques tournent plus vite autour de vous.',
  'Disques': 'Un disque de plus en orbite.',
  'Orbite': "Les disques tournent plus loin de vous.",
  'Taille': 'Le {a} est plus gros : il touche plus de robots.',
  'Plombs': 'Plus de plombs à chaque tir.',
  'Recul': 'Les robots touchés sont repoussés plus loin.',
  'Impulsions': 'Le {a} frappe plus souvent.',
  'Arcs': "Un arc électrique de plus à chaque impulsion.",
  'Rayon': "La zone du {a} s'élargit.",
  'Ralentissement': 'Les robots touchés sont plus ralentis.',
  'Rayons': 'Un rayon de plus à chaque tir.',
  'Largeur': 'Le rayon est plus large : il touche plus de robots.',
  'Roquettes': 'Une roquette de plus à chaque salve.',
  'Explosion': "L'explosion couvre une zone plus grande.",
  'Saut': 'La balle saute plus loin entre deux robots.',
  'Rebonds': "La balle rebondit sur un robot de plus.",
  'Tranchants': 'Une lame de plus à chaque coup.',
  'Arc': 'La lame balaie un arc plus large.',
  'Tourelles': 'Une tourelle de plus posée sur le terrain.',
  'Durée': 'Le {a} reste actif plus longtemps.',
  'Morsures': 'La nappe ronge les robots plus souvent.',
  'Nappes': 'Une nappe de plus à chaque lancer.',
  'Boomerangs': 'Un boomerang de plus à chaque lancer.',
  'Mines': 'Une mine de plus posée à chaque fois.',
  'Détection': 'Les mines repèrent les robots de plus loin.',
  'Coupes': 'Une coupe de plus à chaque enchaînement.',
  'Critique': 'Les coups critiques du {a} font plus mal.',
  'Grenades': 'Une grenade de plus à chaque lancer.',
  'Souffle': 'Le souffle repousse les robots plus fort.',
  'Tics': 'Le nuage blesse les robots plus souvent.',
  'Nuages': 'Un nuage de plus à chaque lancer.',
  'Recharge': 'La frappe revient plus vite.',
  'Échos': "Un écho de plus après chaque frappe.",
  'Distance': "La frappe tombe plus loin de vous.",
  'Obus': 'Un obus de plus à chaque tir.',
  'Ondes': 'Une onde de plus à chaque coup de marteau.',
  surcharge: 'Tous les dégâts du {a} augmentent encore.',
  max: 'Amélioration au maximum.',
};

export const MARCHAND_M3 = {
  motsCles: ['PV', 'dégâts', 'critiques', 'critique', 'cadence', 'recharge', 'plombs', 'recul', 'portée', 'projectiles', 'perforation', 'vitesse', 'disques', 'rayons', 'roquettes', 'bouclier', 'orbite', 'saut', 'zone', 'durée', 'rayon', 'drones', 'éclairs', 'éclair', 'tourelles', 'mines', 'grenades', 'fragments', 'fragment', 'XP'],
};
//
// E.4 Monnaie : la pièce 5 « CTRL+Z » (maquettes du 17/11, scripts/pieces.py) remplace l'icône cel partout (Noyau,
// prix, bilan, Succès). Rangée de `images` images de `cadre` px (pièce de `art` px + marge) : les `rotation` premières
// font un tour, les suivantes la pause avec reflet (13 à 16) et étincelle (18 à 22). Retouche de Femz (17/11) : « tourne
// en continu lentement et s'arrête brièvement de face avec le reflet ». Les `rotation` images de rotation en `tour` s
// (régulier : `tour` / `rotation` par image) ; à chaque passage DE FACE (images `face`), un court arrêt où le reflet
// passe (images `reflet`, `refletImage` s chacune), puis elle repart. L'étincelle (5 images de plus) ne tient pas
// dans un arrêt court : pas jouée. Cycle d'un tour = tour + face × reflet × refletImage. ui.js écrit les @keyframes
// (une image par clé, maintenue jusqu'à la suivante : step-end) depuis pieceSequence() ; pixelated, taille multiple
// ENTIER de `art` px (CSS round(), ui.css).
export const PIECE = {
  fichier: 'assets/ui/icones/monnaie-piece.png', images: 24, art: 24, cadre: 32,
  rotation: 12, tour: 2.2, // s pour les 12 images de rotation (0,183 s par image)
  face: [0, 6], // images où la pièce est de face (deux fois par tour : les deux côtés sont frappés pareil)
  reflet: [13, 14, 15, 16], refletImage: 0.1, // arrêt de 0,4 s à chaque passage de face
};
/** Suite [image, durée en s] d'un tour de la pièce (rotation régulière, arrêt avec reflet à chaque face). Pure. */
export function pieceSequence() {
  const out = [];
  const d = PIECE.tour / PIECE.rotation;
  for (let f = 0; f < PIECE.rotation; f++) {
    out.push([f, d]);
    if (PIECE.face.includes(f)) for (const r of PIECE.reflet) out.push([r, PIECE.refletImage]);
  }
  return out;
}
/** Durée d'un tour complet, arrêts compris (s). */
export const PIECE_CYCLE = pieceSequence().reduce((a, x) => a + x[1], 0);
// La monnaie s'appelle « Pixelz » (décision de Femz, 17/11) : nom affiché seulement. Les identifiants internes (cycles,
// sr-i-pixel, .sr-px…) et les clés de sauvegarde (sr.meta) ne changent pas. Accords par montant() (« 1 Pixel » au
// singulier, lecture SUPPOSÉE : le z marque le pluriel comme le s qu'il remplace). Les textes dérivés du nom, calculés
// dans les régions d'avant, sont recalculés ici.
MONNAIE.nom = 'Pixelz';
MONNAIE.un = 'Pixel';
HUB.monnaie = MONNAIE.nom.toUpperCase();
HUB.textes.tropPauvre = 'Pas assez de ' + MONNAIE.nom;
HUB.textes.resetConfirm = ['Confirmer : tout effacer ?', 'Vraiment ? Succès, ' + MONNAIE.nom + ' et déblocages perdus'];
BILAN.textes.cycles = MONNAIE.nom;
//
// E.6 Bloc VAGUE / CHRONO « C3 · capsule sans fond » (choix de Femz du 17/11, maquettes jeu2/mq/chrono) : centré en haut,
// « VAGUE 3 » en petit, le chrono en gros dessous (sans le mot « CHRONO »), pas de fond, quatre crochets d'angle, texte
// cerné de noir ; crochets rouges en alerte (WAVES.clock.warnSeconds, 5 s, inchangé) et quand le boss tient le chrono
// à 0:00, avec `bossEnVie` dessous. La puce reste en haut à gauche ; les bonus à durée remontent à sa droite ; la barre
// du boss passe sous le bloc ; la bannière de début de vague descend d'1 rem. Mise en page : ui.css (bloc E.6).
export const HUD_BLOC = { actif: true, bossEnVie: 'BOSS EN VIE' };
//
// Nom du boss (Femz, 20/11 : « boss doit être une catégorie, mais pas le nom du boss 1 ») : « BOSS » reste la catégorie
// (petite étiquette de la barre, surtitre de la bannière, bilan, succès) ; le boss 1 s'appelle OVERCLOCK, versionné par
// rang (« OVERCLOCK v2.0 » à la vague 10…). Les boss à venir auront chacun leur nom.
export const BOSS_IDENTITE = { categorie: 'BOSS', nom: 'OVERCLOCK' };
/** Nom affiché du boss de rang r (« OVERCLOCK », puis « OVERCLOCK v2.0 »…). */
export function bossNomRang(r) {
  return r <= 1 ? BOSS_IDENTITE.nom : BOSS_IDENTITE.nom + ' v' + r + '.0';
}
//
// E.7 Repère du combo du Shinobi sur la case de son arme (demande de Femz du 17/11 : « savoir quand on peut
// ré-attaquer ») — lame de phase et katana : un cran par geste pendant le combo, la jauge horloge du § E3.H pendant la
// pause avant le combo suivant (COMBO_ATTAQUE.respiration), son éclat « prêt » à la fin. `hz` : écritures de la jauge
// par seconde, au plus (la respiration est découpée en round(respiration × hz) crans).
export const COMBO_HUD = { hz: 10 };
//
// E.5 Onglet Succès du Noyau (ajout de Femz du 17/11 : « remplace la box avec le nombre de pixels par une box qui donne
// une description de l'objet ; quand on clique dessus, ça amène à sa box dans Collection ») : à droite d'un succès, une
// petite boîte dit ce qu'il débloque (nom + une ligne courte) ; le montant en Pixelz y reste, en petit
// (`montantVisible` : false le retire). Clic sur la boîte ou sur la case de la récompense (ou Entrée sur la ligne) : le
// Noyau ouvre l'onglet où vit la chose et y fixe sa case — objet, arme, évolution, fusion → Collection ; agent →
// Agents ; ce qui se met EN VENTE (et les bonus au sol) → Déblocages. Ligne courte : la desc ≤ 12 mots du chantier N
// (armes, objets, bonus au sol), la phrase de l'agent, et pour les recettes la règle — raccourcie ici quand elle dépasse
// 12 mots (les autres règles sont gardées telles quelles).
export const SUCCES_RECOMPENSE = {
  montantVisible: true,
  courtes: {
    'evo:lance-prisme': 'Le rayon se divise en 3 rayons qui rebondissent entre robots.',
    'evo:forteresse': 'Tourelle lourde à double canon, qui tire aussi des rafales d’obus.',
    'evo:nuage-frag': 'Chaque grenade laisse une fumée qui explose en 8 éclats.',
    'fusion:malware': 'Un robot infecté et en feu laisse un nuage toxique 3 s.',
    'fusion:restauration': 'Quand la Sauvegarde vous sauve, un coffre gratuit en fin de vague.',
    'fusion:essaim': 'À chaque impulsion du Condensateur, chaque drone tire une rafale.',
  },
};
//#endregion e5:E-ui-1711

//#region e5:F-anim-agents
// =====================================================================================================
// ÉTAPE 5, CHANTIER F (ARCHITECTURE.md § E5.F, 17/11/2026) — animations des agents, retours de Femz après avoir joué :
//  1. « tu as modifié les animations d'attaque du Shinobi comme on avait dit ? Ça manque d'énergie » : chaque coup est
//     reposé en POSES CLÉS (armé → impact → fin de geste → garde) avec des courbes franches (anticipation courte qui
//     arrive vite, frappe accélérée, dépassement puis retour), le corps entier (bras en vrai arc, buste, bassin, appuis,
//     pas de fente du pied avant, vrille en l'air jambes repliées, dégainé : arrêt, traversée, rengainé lent).
//     Cause racine trouvée : le « lacet du bras » du § E3.M tournait l'os SUR SON AXE (ordre d'Euler XZY des bras) — la
//     lame ne balayait pas, seul le buste tournait. Ici la direction du bras est convertie en angles X / Z (vrai arc).
//  2. « la course du Bastion manque de personnalité … dos trop droit, manque de côté imposant » : course « bulldozer »
//     (buste penché, épaules qui roulent, bras larges et lourds, tête basse, appui qui tasse le corps, poussière).
//  3. (ajout du 17/11) « Bastion sans arme, il doit pouvoir mettre des coups de poing qui font autant de dégâts que le
//     blaster de l'Éclaireur, avec un camera shake, et qui repoussent les ennemis » : POINGS (src/poings.js).
// actif: false rend les gestes et la course d'avant (comparaisons) ; POINGS.actif: false retire les coups de poing.
// Vecteur d'une pose (13 valeurs, rad sauf mention) : [0 bras droit levée φ (0 = pendant, π/2 = horizontal devant,
// > π/2 au-dessus), 1 bras droit lacet λ (0 = devant, + = vers la GAUCHE du buste), 2 coude droit (plié > 0),
// 3 bras gauche φ, 4 bras gauche λ, 5 coude gauche, 6 torsion du buste (+ = épaule gauche en arrière), 7 buste penché
// (+ = en avant), 8 roulis du buste (+ = vers la droite), 9 accroupi (m), 10 bassin tourné (+ = vers la gauche),
// 11 tête (+ = baissée), 12 avance dessinée (m)].
// Chiffres : réglés à la planche et à la vidéo du chantier (supposés, à valider par Femz en jouant).
const GARDE_S = [1.05, 0.4, 1.55, 1.05, -0.4, 1.55, 0, 0.18, 0, 0.2, 0, 0, 0];
const TG_A = [0.85, 0.25, 1.6, 1.5, -1.45, 0.85, -0.85, 0.02, 0.12, 0.26, -0.4, 0, 0];
const TG_I = [0.9, 0.35, 1.6, 1.5, 0.05, 0.1, 0.15, 0.38, -0.06, 0.32, 0.12, 0.05, 0.16];
const TG_F = [0.8, 0.5, 1.7, 1.35, 1.6, 0.2, 0.9, 0.32, -0.16, 0.3, 0.45, 0.05, 0.22];
/** Pose miroir (gauche ↔ droite) : bras échangés, lacets, torsion, roulis et bassin opposés. */
const miroirF = (p) => [p[3], -p[4], p[5], p[0], -p[1], p[2], -p[6], p[7], -p[8], p[9], -p[10], p[11], p[12]];
const LOURD_A = [2.35, -0.95, 1.3, 2.2, -1.25, 1.5, -1.05, -0.12, 0.16, 0.26, -0.5, -0.05, 0];
const LOURD_I = [1.5, 0.1, 0.2, 1.5, 0.28, 0.45, 0.2, 0.42, -0.08, 0.36, 0.16, 0.05, 0.28];
const LOURD_F = [1.3, 1.55, 0.3, 1.2, 1.75, 0.6, 1.15, 0.32, -0.22, 0.32, 0.55, 0.05, 0.32];
export const ANIM_AGENTS = {
  actif: true,
  shinobi: {
    // part de l'anticipation dans le temps avant l'impact (le reste = la frappe, ≈ 2 images) : planches et test e3-M
    armeFrac: 0.62,
    depasse: 1.9, // dépassement de la fin de geste (courbe « back », 0 = aucun)
    garde: GARDE_S,
    gardeTenue: 0.16, // s — la garde tenue après le dernier coup, puis fondu vers la marche
    gardeFondu: 0.2, // s
    saut: 0.6, // m — hauteur de la vrille en l'air
    replie: [1.15, 1.9], // rad — cuisses levées, genoux pliés pendant la vrille (jambes repliées, sans appui)
    // m — le pied du côté du coup avance (fente) et se pose à l'impact ; le pied d'appui pivote sur sa plante quand le
    // bassin tourne de plus de ANIM.heros.pied.lacetMax (le bassin tourne dans chaque coup : pose, valeur 10)
    pas: { longueur: 0.42 },
    // gestes (GESTE.*) : A armé, I impact (la lame passe), F fin de geste ; aFrac / sFrac : fin de l'armé / début de la
    // frappe (× impactAt) ; fFrac : fin de geste (part de dur − impactAt) ; hFrac : fin de la tenue ; R : pose du retour
    gestes: {
      0: { A: TG_A, I: TG_I, F: TG_F, pas: 1 },
      1: { A: miroirF(TG_A), I: miroirF(TG_I), F: miroirF(TG_F), pas: 2 },
      2: {
        // vrille : bras croisés, très bas, puis le corps décolle et fait un tour, bras grands ouverts, réception accroupie
        A: [1.2, 1.05, 1.5, 1.2, -1.05, 1.5, -0.95, 0.3, 0, 0.4, -0.55, 0, 0],
        I: [1.6, -1.5, 0.1, 1.6, 1.5, 0.1, 0, 0.05, 0, 0, 0, 0, 0.1],
        F: [1.35, -1.35, 0.25, 1.35, 1.35, 0.25, 0, 0.3, 0, 0.36, 0, 0.05, 0.1],
        vrille: 1, fFrac: 0.7,
      },
      3: { A: LOURD_A, I: LOURD_I, F: LOURD_F, pas: 2 },
      4: { A: miroirF(LOURD_A), I: miroirF(LOURD_I), F: miroirF(LOURD_F), pas: 1 },
      5: {
        // dégainé (iaido) : main à la poignée sur la hanche gauche, très bas, de profil — TEMPS D'ARRÊT — trait (le héros
        // traverse à l'impact) — fin de geste lame tendue derrière lui, tenue (zanshin) — rengainé LENT
        A: [0.55, 0.95, 1.65, 0.4, 0.65, 1.25, -0.65, 0.45, 0.1, 0.44, -0.65, -0.1, 0],
        I: [1.55, -0.45, 0.05, 0.5, 0.5, 1.2, 0.5, 0.5, -0.06, 0.46, 0.2, 0, 0.35],
        F: [1.35, -1.75, 0.0, 0.6, 0.35, 1.0, 0.75, 0.42, -0.16, 0.5, 0.38, 0, 0],
        R: [0.6, 0.85, 1.6, 0.45, 0.6, 1.2, -0.2, 0.25, 0, 0.3, -0.2, 0, 0],
        aFrac: 0.3, sFrac: 0.9, fFrac: 0.12, hFrac: 0.45,
      },
    },
  },
  // Course du Bastion (le tank : 140 PV, 94 % de la vitesse) : réglages lus par heros-anim quand l'agent posé est le
  // Bastion ; jambes et pieds restent ceux de la course de référence (pieds cloués, vitesse et cadence inchangées).
  bastion: {
    course: {
      penche: 0.34, // rad — buste penché en avant à pleine allure (au-dessus de l'abdomen : les jambes ne changent pas)
      lean: 0.06, // rad — penché en plus du corps entier (compensé aux hanches comme celui de la marche)
      tete: 0.14, // rad — tête basse (le reste du penché est compensé : il regarde devant lui, front baissé)
      epaules: 0.22, // rad — épaules qui roulent (torsion du buste en opposition avec les jambes)
      roulis: 0.1, // rad — le buste bascule sur la jambe d'appui
      bras: 1.45, // × amplitude du balancier des bras
      brasEcart: 0.2, // rad — bras écartés du corps (carrure)
      avantBras: 1.15, // rad — avant-bras plié en course (Éclaireur : ANIM.heros.forearmRun 0,85)
      bassin: 0.05, // m — à chaque appui le bassin s'enfonce (le genou d'appui plie) : le corps se tasse
      tasseDuree: 0.16, // s
      poussiere: 2, // bouffées par appui (pool des étincelles de fx ; 0 = aucune)
      poussiereCouleur: 0x8f8a7a,
      secousse: 0, // trauma par appui (0 : aucune — une secousse tous les 0,35 s fatiguerait la vue)
    },
    garde: [1.15, 0.4, 2.0, 1.15, -0.4, 2.0, 0, 0.22, 0, 0.14, 0, 0.08, 0],
  },
};
// Coups de poing du Bastion (src/poings.js) : son attaque de base, toujours active (mains libres : la Sentinelle est
// posée au sol), sur le robot le plus proche à portée de mêlée, gauche / droite / gauche, puis un UPPERCUT de finition.
// DPS = celui du blaster de l'Éclaireur AU MÊME NIVEAU : dégâts = WEAPONS[BLASTER].stats[DÉGÂTS][niveau] × mods.damageMul,
// cadence = WEAPONS[BLASTER].stats[CADENCE][niveau] × mods.fireRateMul ; moyenne des multiplicateurs du combo = 1
// (0,9 × 3 + 1,3) / 4 = 1. Niveau supposé = celui de la Sentinelle (arme de départ du Bastion), 1 si absente.
// Niveau 1 : 10 × 2 /s = 20 dégâts/s sur une cible (blaster : 10 × 2 /s, 1 projectile).
export const POINGS = {
  actif: true,
  portee: 2.2, // m — du centre du héros au bord du robot
  rattrape: 0.6, // m — à l'impact, la cible peut s'être éloignée d'autant
  mul: [0.9, 0.9, 0.9, 1.3],
  recul: [13, 13, 13, 24], // impulsion (m/s, divisée par la masse du robot ; blindé : masse 6), amortie à 9 /s (rôdeur : ≈ 1,4 m)
  eliteMul: 0.45, // élites porteuses : moins repoussées ; boss : jamais
  sonAvance: 0.11, // s — le son (souffle puis choc) part ce temps avant l'impact
};
COMBOS.list.push({
  key: 'poing', // gauche, droite, gauche, uppercut (droit)
  geste: [9, 10, 9, 11],
  dur: [0.26, 0.26, 0.26, 0.34],
  impactAt: [0.11, 0.11, 0.11, 0.16],
  mul: POINGS.mul,
  hitstop: [0.035, 0.035, 0.035, 0.07],
  trauma: [0.08, 0.08, 0.08, 0.17],
  sfx: [SFX.PUNCH, SFX.PUNCH, SFX.PUNCH, SFX.PUNCH], // § E5.G : les coups de poing de Femz (avant : SFX.COUP_PIED, provisoire)
  sfxAvance: POINGS.sonAvance,
  arcDeg: [0, 0, 0, 0],
  avance: [0, 0, 0, 0],
  // m — aucun déplacement réel (le Bastion reste dans la bulle de sa Sentinelle, § E3.Z.12) : l'appui avant est le pas
  // du pied (ANIM_AGENTS.shinobi.pas) et le corps penché dans le coup (avance dessinée des poses)
  fente: [0, 0, 0, 0],
});
export const COMBO_POING = COMBOS.list.length - 1;
export const GESTE_POING = Object.freeze({ G: 9, D: 10, UPPERCUT: 11 });
{
  const PA = [1.0, 0.15, 2.25, 1.0, -0.12, 2.0, 0.6, 0.06, 0.12, 0.2, 0.3, 0.06, 0]; // poing gauche armé (épaule G en arrière)
  const PI = [1.15, 0.38, 2.05, 1.57, -0.12, 0.04, -0.65, 0.38, -0.08, 0.22, -0.3, 0.1, 0.26]; // bras tendu, épaule qui pousse
  const PF = [1.15, 0.4, 2.05, 1.5, -0.2, 0.15, -0.75, 0.4, -0.1, 0.22, -0.34, 0.1, 0.3];
  const UA = [1.0, -0.3, 2.0, 0.35, 0.2, 1.9, -0.55, 0.38, 0.18, 0.36, -0.35, 0.12, 0]; // uppercut (droit) : épaule basse
  const UI = [1.0, -0.3, 2.0, 2.55, 0.12, 1.05, 0.6, -0.12, -0.1, 0.06, 0.38, -0.05, 0.28];
  const UF = [1.0, -0.3, 2.0, 2.8, 0.1, 0.85, 0.7, -0.18, -0.12, 0.08, 0.42, -0.05, 0.3];
  const mir = (p) => [p[3], -p[4], p[5], p[0], -p[1], p[2], -p[6], p[7], -p[8], p[9], -p[10], p[11], p[12]];
  const G = ANIM_AGENTS.shinobi.gestes;
  G[9] = { A: PA, I: PI, F: PF, pas: 1, garde: ANIM_AGENTS.bastion.garde };
  G[10] = { A: mir(PA), I: mir(PI), F: mir(PF), pas: 2, garde: ANIM_AGENTS.bastion.garde };
  // uppercut du bras DROIT : la pose « gauche » écrite ci-dessus est miroitée (le bras levé passe à droite)
  G[11] = { A: mir(UA), I: mir(UI), F: mir(UF), pas: 2, garde: ANIM_AGENTS.bastion.garde, fFrac: 0.6 };
}
// Combos du Shinobi : impacts plus marqués sur les finitions (vrille, dégainé), toujours les plus forts du combo
COMBOS.list[0].hitstop = [0.03, 0.015, 0.03, 0.015, 0.1];
COMBOS.list[0].trauma = [0.06, 0.06, 0.07, 0.07, 0.22];
COMBOS.list[1].hitstop = [0.05, 0.06, 0.16];
// Traînée NETTE, calée sur la frappe rapide : elle naît déjà avancée de `avance` s (projectiles.AGE0) — à l'image de
// l'impact et pendant l'arrêt sur image, l'arc est déjà tracé aux deux tiers (le dégainé : son trait entier), comme si la
// lame l'avait dessiné pendant les 2 images de la frappe. Avant (§ E3.M) : âge 0 à l'impact, l'arc ne partait qu'après
// l'arrêt sur image (l'horloge des effets est figée pendant l'arrêt) — invisible sur l'image de l'impact.
COMBOS.trainee.avance = 0.045;
// Sens de la traînée : celui du NOUVEAU geste (mesuré image par image le 17/11 : avec le sens du § E3.M, l'arc courait
// de gauche à droite à l'écran pendant que la lame allait de droite à gauche, pour les tailles comme pour le katana).
COMBOS.trainee.sensInverse = ANIM_AGENTS.actif;
COMBOS.list[1].trauma = [0.12, 0.15, 0.4];
// Bond sismique du Bastion (son dash, 16/11 point 11) : « Jump Attack » (Mixamo, déposé par Femz le 17/11), cuit sur son
// robot (tests/cuire-anim.mjs, 60 i/s → assets/anims/bond-bastion.json ; le .fbx reste dans outils/anims/sources/,
// ignoré). clip : secondes de l'animation — debut = l'impulsion (les jambes poussent), impact = l'image où les poings
// touchent le sol, sortie = fin de la reprise jouée pendant le fondu. La fenêtre debut → impact est ÉTIRÉE sur la durée
// du dash (vitesse = (impact − debut) / durée du dash) : décollage au début, frappe au sol à la dernière image du dash
// (l'onde de dash-agents part là). Trajet, vitesse, distance et durée du dash : inchangés.
export const BOND_CUIT = {
  actif: true,
  fichier: 'assets/anims/bond-bastion.json',
  // clip de 3,8 s (228 images à 60 i/s) ; hanche cuite : debout 0,98 m, accroupi 0,64 m à 0,45 s (élan), sommet 2,78 m
  // à 1,0 s, frappe au sol 0,51 m à 1,70 s, accroupi jusqu'à 2,5 s, debout à 3,8 s (relevé du 17/11)
  // impact 1,68 → 1,78 (17/11 au soir, profil image par image : à 1,68 s les pieds touchent, les poings frappent le sol
  // vers 1,75–1,80 s) : l'onde part à l'image où les POINGS touchent le sol
  clip: { debut: 0.48, impact: 1.78, sortie: 2.4 },
  reprise: 0.5, // × vitesse de lecture de la reprise après la frappe (réception lourde, tenue accroupie)
  fonduEntree: 0.03, // s — entrée (le dash part tout de suite)
  fonduSortie: 0.15, // s — retour fondu vers la course (fini quand les pieds reprennent leurs appuis : 0,15 s après le dash)
  // × écart de hauteur de hanche du clip à sa pose debout (sommet du clip 1,8 m → ≈ 1,26 m). Retour de Femz du 17/11 au
  // soir : « le saut est trop rapide et ne part pas assez haut » — 0,45 → 0,7, bond de 0,342 → 0,65 s (ci-dessous)
  hauteur: 0.7,
};
// Bond plus LENT, même distance (retour de Femz du 17/11 au soir) : durée du dash du Bastion 0,342 → 0,65 s, vitesse
// divisée d'autant (distance = vitesse × durée = 24 × 0,55 × 0,18 × 1,9 = 4,51 m, inchangée). Le clip est donc joué
// × 1,85 au lieu de × 3,51. Effets : invulnérabilité du dash = sa durée + 0,1 s → 0,75 s au lieu de 0,44 s (Bastion
// seulement) ; recharge inchangée (3 s, comptée depuis le départ). Éclaireur et Shinobi : inchangés.
{
  const B = DASH_AGENTS.bond;
  const dist = B.vitesseMul * B.dureeMul; // en parts de PLAYER.dash.speed × duration
  B.dureeMul = 0.65 / PLAYER.dash.duration;
  B.vitesseMul = dist / B.dureeMul;
}
// Onde du bond (retour de Femz : « sa shockwave doit être bleue, pas jaune » ; AMBRE depuis le 22/11 : « oui ambre »,
// l'accent du Bastion est passé à l'ambre 0xffb347 avec son identité visuelle) ; référence : sa vidéo du 17/11 18h19 —
// anneau « splash » qui s'ouvre d'un coup, disque rempli en dégradé vers le bord, puis seul un liseré fin reste et
// s'efface en s'émiettant, ≈ 1 s, sans débris). Style daté propre (36) : l'onde des explosions et du marteau (30) ne
// change pas. Couleurs : l'accent du Bastion (0xffb347, ambre) en linéaire, cœur presque blanc (avant le 22/11 : bleu
// 0x6fb6ff, bord [0.16, 0.45, 1.0], cœur [0.72, 0.88, 1.0]).
export const ONDE_BOND = {
  actif: true,
  style: 36,
  vie: 1.0, // s
  ouverture: 0.16, // part de la vie : l'anneau passe de `depart` à 100 % de son rayon (courbe qui freine)
  depart: 0.55,
  remplissage: 0.4, // part de la vie où le disque rempli s'efface (le liseré reste)
  emiette: 0.55, // à partir de cette part, le liseré s'émiette (bruit angulaire)
  bord: [1.0, 0.45, 0.063],
  coeur: [1.0, 0.86, 0.66],
};
VFX_VIE[ONDE_BOND.style] = ONDE_BOND.vie;
// Soin du bond (demande de Femz du 17/11) : chaque robot TUÉ par l'onde du bond sismique rend parRobot PV au Bastion, au
// plus max par bond (et jamais au-delà des PV max). Bastion seulement (l'onde n'existe que pour lui).
// fenetre : un robot TOUCHÉ par l'onde qui meurt dans les fenetre s (par n'importe quelle arme) compte comme tué par le
// bond — mesuré : l'onde seule (2 PV, dégâts du dash symboliques, règle de Femz) ne tue aucun robot aux vagues 5, 10, 20.
// § E5.F.14 (Femz, 18/11 : « oui vas-y ») : la mesure donnait 0,7 à 2,5 PV par bond (l'onde tue rarement) — chaque robot
// TOUCHÉ par l'onde rend aussi parTouche PV ; plafond max par bond (25 : sensible sans rendre le Bastion immortel).
export const SOIN_BOND = { actif: true, parTouche: 1, parRobot: 3, max: 25, fenetre: 1.5 };
// Tourelles du Bastion (Sentinelle et grosse tourelle) : le BOSS d'abord s'il est vivant et à portée (demande de Femz du
// 17/11), puis le réparateur (§ E5.D), puis la règle d'avant. Tant que le boss a des drones-boucliers, il est intouchable
// (§ E1.D) : la tourelle vise alors d'abord le drone-bouclier le plus proche à sa portée (réponse de Femz : « oui, les
// drones d'abord »), pour faire tomber le bouclier. Les autres armes ne changent pas.
export const TOURELLES_BOSS = { actif: true };
// Anneau bleu des tourelles (demande de Femz du 17/11 : « l'anneau bleu des tourelles du Bastion le fait récupérer
// progressivement jusqu'à 30 % de ses PV s'il est en dessous de 20 % de ses PV ») : le Bastion DANS la bulle ouverte
// d'une Sentinelle, sous `seuil` × PV max, regagne `parSeconde` × PV max par seconde jusqu'à `cible` × PV max, puis
// s'arrête ; il ne repart que s'il repasse sous le seuil (verrou : sorti de l'anneau en cours de soin, il reprend en y
// revenant). Retour : l'anneau vire au vert-bleu et pulse, onde verte + nombre « +PV » vert + anneau de soin toutes les
// `pulsation` s, son de soin grave (SFX.SMOKE = « Soin du réparateur » − 8 demi-tons) au déclenchement. Bastion seul.
export const ANNEAU_SOIN = { actif: true, seuil: 0.2, cible: 0.3, parSeconde: 0.05, pulsation: 0.6, lueur: 0.5 };
// Une attaque de la lame de phase ou du katana = le COMBO ENTIER (retour de Femz du 17/11 au soir : « mon Shinobi ne fait
// pas les mêmes combos de lame que tes prévis … Il fait coup par coup ») : au niveau 1, une salve ne valait qu'UN geste.
// Désormais chaque attaque joue tous les gestes du combo ; la pause entre deux combos vaut gestes / (cadence × tranchants
// ou coupes) : autant de gestes par seconde qu'avant, chaque geste garde ses dégâts → même DPS. Les tranchants (COUNT)
// raccourcissent la pause entre deux combos (au niveau élevé, les combos s'enchaînent sans pause). false = avant.
// Retour de Femz (17/11 au soir : « le Shinobi fait un combo puis il ne fait plus rien pendant quelques secondes alors
// qu'il y a des robots devant ») : PLUS DE LONGUE PAUSE. Le combo suivant part après `respiration` s, tant qu'un robot
// est à portée ; le DPS d'avant est gardé par un facteur de dégâts PAR GESTE = gestes/s d'avant (cadence × tranchants,
// au plus ce que l'animation permettait) ÷ gestes/s de l'enchaînement (gestes / (durée du combo + respiration)) —
// < 1 aux bas niveaux (gestes plus légers, plus nombreux), > 1 aux niveaux élevés (la respiration est rendue en dégâts).
// katana1 : à une seule coupe (niveau 1), l'ancienne salve unique faisait souvent repartir le combo au 1er coup : son DPS
// mesuré (28,5) est sous celui que donne la formule pour le combo complet — correction mesurée par e5-F § 6 (enchaînement
// avec respiration : 25,2 avec 1 / 1,26, soit × 1 / 1,115 pour retrouver 28,5).
export const COMBO_ATTAQUE = { actif: true, respiration: 0.3, katana1: 1 / 1.067 }; // § E5.F.13 : dégainé à 0,8 s, recalé (27,2 → 28,5)
// Idle propre à chaque agent (demande de Femz du 17/11 au soir) : au repos en partie (haut du corps, pieds cloués par la
// cinématique inverse, fondu HEROS_IDLE.fonduS avec la course), dans la fiche de pause et au Noyau. Mixamo, cuits sur le
// robot de l'agent (tests/cuire-anim.mjs ; .fbx dans outils/anims/sources/, jamais commités). null = Warrior Idle.
// marteau : Bastion qui tient le marteau en main droite (« Great Sword Idle ») — branché le 17/11 au soir (§ E5.F.13) :
// armes-heros.sync écrit heros-anim.IDLE_MARTEAU[0] = 1 quand il possède le marteau (modèle 6567c9b, poing droit) ; la
// fiche de pause le montre aussi (pause-agent.poserCuit).
export const IDLES_AGENTS = {
  fichiers: [null, 'assets/anims/idle-bastion.json', 'assets/anims/idle-shinobi.json'],
  marteau: { fichier: 'assets/anims/idle-bastion-marteau.json', actif: true },
  // jambes et pieds DU CLIP au repos (Femz, 17/11 : « laisse les pieds de l'idle Mixamo pour le Shinobi, sinon sa pose fait
  // chelou ») : racine, buste et jambes du clip, sans cinématique inverse ; le corps est recalé en hauteur (pied le plus
  // bas au sol). [Éclaireur, Bastion, Shinobi]
  jambesClip: [false, false, true],
  jambesExp: 3, // § E5.F.14 : bassin et jambes du clip mêlés par poids^jambesExp (1 = comme le haut du corps)
};
// Contraintes articulaires (retour de Femz du 17/11 au soir : « rajoute des contraintes au corps, là il se plie
// inhumainement le dos ») : bornes des angles d'Euler de chaque os, DANS SON ORDRE (racine = bassin XYZ, buste YXZ :
// x = penché, + en avant ; y = torsion ; z = roulis ; pièces XZY : x = levée / flexion, z = écart), appliquées à la fin de
// la pose (heros-anim.contraindre). b = [x min, x max, y min, y max, z min, z max] en radians. Torsion du buste : ±75°
// (le jeu tourne le buste de ±70° pour viser, ANIM.corps.torsionMax) — pas les 40° d'une colonne humaine.
const DEG_F = Math.PI / 180;
const BF = (a) => a.map((v) => v * DEG_F);
export const CONTRAINTES = {
  actif: true,
  corriger: true,
  os: [
    // bassin (racine des clips cuits) : bascule avant 70°, arrière 55° (le coup de pied validé par Femz penche le corps
    // entier de 50° en arrière, dos droit), roulis 30°
    { nom: 'racine', b: BF([-55, 70, -180, 180, -30, 30]) },
    // DOS (buste par rapport au bassin) : flexion avant 50°, extension arrière 15°, latéral 25° ; torsion 75° (le jeu
    // tourne déjà le buste de ±70° pour viser : les tailles du Shinobi n'en ajoutent que 5° au plus)
    { nom: 'buste', b: BF([-15, 50, -75, 75, -25, 25]) },
    { nom: 'tete', b: BF([-35, 45, -70, 70, -30, 30]) }, // cou
    // épaules : non bornées en Euler (un bras levé fait basculer la décomposition XZY de ±180° : relevé du 17/11) — les
    // directions viennent de la visée et des poses clés, mesurées
    { nom: 'bras_g', b: BF([-180, 180, -180, 180, -180, 180]) },
    { nom: 'bras_d', b: BF([-180, 180, -180, 180, -180, 180]) },
    { nom: 'avant_bras_g', b: BF([-150, 5, -180, 180, -30, 30]) }, // coudes : x < 0 = plié ; ni hyperextension ni pli de côté
    { nom: 'avant_bras_d', b: BF([-150, 5, -180, 180, -30, 30]) },
    // hanches, genoux, chevilles : posés par la cinématique inverse des pieds cloués — bornes larges (seules les poses
    // impossibles sont touchées) pour ne pas décoller un pied d'appui
    { nom: 'jambe_g', b: BF([-125, 85, -100, 100, -75, 75]) },
    { nom: 'jambe_d', b: BF([-125, 85, -100, 100, -75, 75]) },
    { nom: 'tibia_g', b: BF([-3, 155, -40, 40, -20, 20]) }, // genoux : x > 0 = plié ; pas d'hyperextension
    { nom: 'tibia_d', b: BF([-3, 155, -40, 40, -20, 20]) },
    { nom: 'pied_g', b: BF([-95, 95, -95, 95, -85, 85]) },
    { nom: 'pied_d', b: BF([-95, 95, -95, 95, -85, 85]) },
  ],
};
// ----- § E5.F.13 (17/11 au soir) : armes montées sur les modèles — marteau du Bastion, katana en main, seconde lame -----
// Marteau du Bastion (demande de Femz : « dès qu'il a le marteau, il ne frappe plus qu'au marteau » ; combo lourd et
// lisible : 2 grands coups en DIAGONALE, puis un coup VERTICAL au sol qui fait l'onde). Une frappe de l'arme (même
// cadence, même recharge, mêmes ondes) = le combo entier. Dégâts répartis pour garder ceux d'une frappe d'avant sur une
// cible devant lui : diagonales `mulDiag` × dégâts (robots dans l'arc devant, à moins de `portee` m de leur bord),
// frappe au sol `mulSol` × dégâts par onde : 0,3 + 0,3 + 0,4 = 1. Dégâts figés au départ du combo (dégâts × burst de la
// fenêtre de recharge, § E3.H : le coup au sol tombe après la fin de la fenêtre). Poings effacés tant qu'il a le marteau
// (POINGS.sansMarteau). actif: false = la frappe au sol seule d'avant.
export const MARTEAU_COMBO = { actif: true, mulDiag: 0.3, mulSol: 0.4, portee: 2.8, arcDeg: 160, recul: 9 };
// § E5.F.14 (Femz, 18/11 : « Marteau : OUI, enchaîner ») : plus de recharge — tant qu'un robot est à portée (rayon de la
// 1re onde), le combo suivant part `respiration` s après la fin du précédent, comme le Shinobi (§ E5.F.12). Même DPS
// MOYEN qu'avant à chaque niveau n (1 à 21) : sur un cycle de recharge, l'arme d'avant frappait N = 1 + ⌊cadence ×
// action(n)⌋ fois pendant la fenêtre action(n), à dégâts × burst, puis rechargeait recharge(n) s (§ E3.H, § E4.G) ; les
// dégâts du combo enchaîné sont multipliés par F(n) = burst × N × (durée du combo + respiration) / (recharge(n) +
// action(n)). Réglages de la recharge d'avant gardés dans `ref` (retirée de RECHARGES : plus de jauge horloge).
MARTEAU_COMBO.enchaine = true;
MARTEAU_COMBO.poignet = 1.05; // § E5.F.14 : rad — pendant le combo, manche dans le prolongement du bras (30° au lieu de 75°)
MARTEAU_COMBO.respiration = COMBO_ATTAQUE.respiration;
MARTEAU_COMBO.ref = { ...RECHARGES.weapons.hammer };
if (MARTEAU_COMBO.actif && MARTEAU_COMBO.enchaine) delete RECHARGES.weapons.hammer;
POINGS.sansMarteau = true;
export const GESTE_MARTEAU = Object.freeze({ DIAG_D: 12, DIAG_G: 13, SOL: 14 });
if (MARTEAU_COMBO.actif) {
  COMBOS.list[COMBO.HAMMER] = {
    key: 'hammer', // diagonale (haut droite → bas gauche), diagonale retour (haut gauche → bas droite), frappe au sol
    geste: [12, 13, 14],
    dur: [0.44, 0.44, 0.66],
    impactAt: [0.21, 0.21, 0.36],
    mul: [MARTEAU_COMBO.mulDiag, MARTEAU_COMBO.mulDiag, MARTEAU_COMBO.mulSol],
    hitstop: [0.05, 0.05, 0.09],
    trauma: [0.12, 0.12, 0.24],
    sfx: [SFX.SLASH_HEAVY, SFX.SLASH_HEAVY, -1], // souffle des diagonales ; la frappe au sol : COUP_MARTEAU (countShot)
    sfxAvance: 0.12,
    arcDeg: [MARTEAU_COMBO.arcDeg, MARTEAU_COMBO.arcDeg, 0],
    avance: [0.15, 0.15, 0.1],
    fente: [0, 0, 0],
  };
  // poses clés (vecteur de 13 valeurs, voir plus haut) : le marteau est dans le poing DROIT, la main gauche aide
  const DA = [2.6, -0.9, 0.9, 2.4, -0.6, 1.2, -0.9, -0.1, 0.15, 0.16, -0.4, -0.05, 0]; // levé haut à droite, dos tourné
  const DI = [1.2, 0.6, 0.2, 1.1, 0.75, 0.4, 0.5, 0.45, -0.12, 0.3, 0.25, 0.08, 0.25]; // abattu en travers, bas gauche
  const DF = [0.75, 1.2, 0.3, 0.65, 1.35, 0.5, 0.85, 0.45, -0.18, 0.3, 0.45, 0.08, 0.3];
  const mirM = (p) => [p[3], -p[4], p[5], p[0], -p[1], p[2], -p[6], p[7], -p[8], p[9], -p[10], p[11], p[12]];
  const G = ANIM_AGENTS.shinobi.gestes;
  const garde = ANIM_AGENTS.bastion.garde;
  G[12] = { A: DA, I: DI, F: DF, pas: 1, garde, aFrac: 0.7 };
  G[13] = { A: mirM(DA), I: mirM(DI), F: mirM(DF), pas: 2, garde, aFrac: 0.7 };
  // frappe au sol : les deux bras tendus au-dessus de la tête, penché en arrière ; abattu jusqu'au sol, accroupi, tenu
  G[14] = {
    A: [3.0, 0.05, 0.6, 3.0, -0.05, 0.7, 0, -0.25, 0, 0.05, 0, -0.12, 0],
    I: [0.65, 0.1, 0.1, 0.7, -0.05, 0.2, 0.05, 0.8, 0, 0.45, 0, 0.1, 0.3],
    F: [0.6, 0.1, 0.1, 0.65, -0.05, 0.25, 0.05, 0.75, 0, 0.48, 0, 0.1, 0.32],
    garde, aFrac: 0.78, fFrac: 0.35, hFrac: 0.7,
  };
}
// Katana EN MAIN (demande de Femz : saisie de la poignée, traversée lame en main, rengainé lent dans le dos). CHOIX : les
// 2 coups lourds se font aussi katana en main — une lame portée dans le dos ne peut pas trancher ; avec elle au dos, la
// traînée sortait d'un bras vide. Le combo s'ouvre donc par la saisie (fin de l'armé du 1er coup lourd, main au-dessus
// de l'épaule droite), et le dégainé (traversée) se finit par le rengainé, plus long (0,5 → 0,8 s), main qui remonte
// au-dessus de l'épaule ; la lame rentre dans le dos à `rengaine` du retour. saisie : × fin de l'armé ; repos : s sans
// geste (combo interrompu) avant de rengainer.
ANIM_AGENTS.katanaMain = { saisie: 1, rengaine: 0.85, repos: 0.6 };
COMBOS.list[COMBO.KATANA].dur = [0.3, 0.3, 0.8];
ANIM_AGENTS.shinobi.gestes[5].R = [2.7, -0.35, 2.1, 0.45, 0.6, 1.2, -0.2, 0.15, 0, 0.22, -0.2, 0, 0]; // main au fourreau du dos
//#endregion e5:F-anim-agents

//#region e5:G-sons
// =====================================================================================================
// ÉTAPE 5, CHANTIER G (ARCHITECTURE.md § E5.G, 17/11/2026) — sons demandés par Femz :
//  1. « SFX très bas pour les footsteps » : un pas par contact du pied d'appui (src/anim/heros-anim.js, piedPose : l'ancre
//     posée au sol au bout d'un retour de jambe), joué par src/anim/pas-agents.js. Rien pendant le dash, la vrille en
//     l'air ni la réception (pas d'ancre : mode 0). Fichiers : banque OCULAR « Footsteps of Robots », un fichier par pas,
//     tirés AU HASARD sans répéter deux fois de suite (AUDIO.files.hasard). Niveaux (sonie effective, mesurée) : Bastion
//     −18 LU sous le BLASTER, Éclaireur −20, Shinobi −22 (outils/preparer_pas_coups.py).
//  2. Coups au contact : la double lame et le katana jouent les coups de Femz (COUP_LAME, COUP_SABRE) à l'image de
//     l'impact quand le geste TOUCHE au moins un robot, après le souffle du geste (joué à son début, voir plus bas) ;
//     finitions (vrille, dégainé) : leur souffle propre puis le coup. Le marteau à ondes joue COUP_MARTEAU à la frappe (la frappe
//     au sol du bond du Bastion garde SFX.HAMMER). Les coups de poing du Bastion jouent PUNCH (§ E5.F, appelé en avance).
// Deux variantes par coup, à tour de rôle. CANDIDATS à faire valider par Femz ; licence des coups À VÉRIFIER (§ E5.G).
AUDIO.sounds[SFX.PAS_ECLAIREUR] = { dur: 0.28, gain: 0.03, minInterval: 0.12, maxVoices: 2, pitchVar: 0, priority: 0 };
AUDIO.sounds[SFX.PAS_BASTION] = { dur: 0.32, gain: 0.035, minInterval: 0.12, maxVoices: 2, pitchVar: 0, priority: 0 };
AUDIO.sounds[SFX.PAS_SHINOBI] = { dur: 0.2, gain: 0.025, minInterval: 0.1, maxVoices: 2, pitchVar: 0, priority: 0 };
AUDIO.sounds[SFX.COUP_LAME] = { dur: 0.75, gain: 0.22, minInterval: 0.05, maxVoices: 3, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.COUP_SABRE] = { dur: 0.94, gain: 0.26, minInterval: 0.08, maxVoices: 2, pitchVar: 1, priority: 1 };
AUDIO.sounds[SFX.COUP_MARTEAU] = { dur: 0.95, gain: 0.32, minInterval: 0.15, maxVoices: 2, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.PUNCH] = { dur: 0.6, gain: 0.22, minInterval: 0.08, maxVoices: 3, pitchVar: 0.5, priority: 1 };
// Invite « E » (ajout de Femz du 17/11) : un clic doux, UNE fois à chaque apparition (src/invite-interagir.js), 13 dB sous
// UI_CLICK ; minInterval 0,4 s : une borne qui entre et sort de portée en boucle ne fait pas cliqueter.
AUDIO.sounds[SFX.INVITE] = { dur: 0.12, gain: 0.05, minInterval: 0.4, maxVoices: 1, pitchVar: 0, priority: 2 };
// Sons dont les variantes sont tirées au hasard, jamais deux fois la même de suite (les autres : à tour de rôle).
AUDIO.files.hasard = [SFX.PAS_ECLAIREUR, SFX.PAS_BASTION, SFX.PAS_SHINOBI];
export const PAS_AGENTS = {
  actif: true, // false : aucun pas (comparaisons)
  sfx: [SFX.PAS_ECLAIREUR, SFX.PAS_BASTION, SFX.PAS_SHINOBI], // par AGENT.*
  allureMin: 0.3, // allure (0..1, S[GAIT] de heros-anim) sous laquelle un contact ne sonne pas (petits pas du pivot sur place)
};
// Gestes du Shinobi (ajout de Femz du 17/11 : « souffle de la lame dans le vide », joué au DÉBUT du geste, avant le
// coup) : chaque geste joue son souffle (sfx[s]) à son premier pas (sfxAvance ≥ tout impactAt : combos.update), puis,
// s'il touche, son coup (sfxTouche[s], combos.juiceF, à l'image de l'impact) ; à vide, le souffle seul. Double lame :
// SLASH_LIGHT (tailles), SLASH_HEAVY (vrille) ; katana : KATANA (tailles, plus grave), IAIDO (« Dégainé éclair », dont
// le choc tombe sur l'impact du dégainé). Le son de l'ARME (countShot à chaque balayage : BLADE, KATANA) est coupé
// (sonAuGeste) : sinon le souffle jouerait deux fois.
COMBOS.list[COMBO.BLADE].sfxAvance = 1;
COMBOS.list[COMBO.BLADE].sfxTouche = [SFX.COUP_LAME, SFX.COUP_LAME, SFX.COUP_LAME, SFX.COUP_LAME, SFX.COUP_LAME];
COMBOS.list[COMBO.KATANA].sfx = [SFX.KATANA, SFX.KATANA, SFX.IAIDO];
COMBOS.list[COMBO.KATANA].sfxAvance = 1;
COMBOS.list[COMBO.KATANA].sfxTouche = [SFX.COUP_SABRE, SFX.COUP_SABRE, SFX.COUP_SABRE];
WEAPONS[WEAPON.BLADE].sonAuGeste = true; // weapons.js countShot : pas de son d'arme, le geste le joue
WEAPONS[WEAPON.KATANA].sonAuGeste = true;
WEAPONS[WEAPON.HAMMER].sfx = SFX.COUP_MARTEAU; // joué par countShot à l'image de la frappe (weapons-agents.js)
// Autres sons d'armes (ajout de Femz du 17/11) : fichiers neufs, MÊMES identifiants (RICOCHET, TURRET_SHOT, TURRET_PLANT,
// BOOMERANG, POOL_THROW, GRENADE, CANNON, DRILL, FIELD) — manifeste seulement (outils/preparer_pas_coups.py).
//#endregion e5:G-sons

//#region e5:H-coque
// Étape 5, chantier H (ARCHITECTURE.md § E5.H) — Femz, 17/11 : « Coque réactive : aucun visuel in game quand c'est
// actif, juste un SFX, on ne comprend pas. » Coque autour du héros (src/vfx/coque-reactive.js) : UN maillage (plaques
// de coque + quad au sol), 1 appel de dessin quand le héros a la Coque, 0 sinon ; mélange additif ; animé par
// uniformes (aucune allocation par image). AUCUNE règle de jeu ne change (items.js, cooldowns.js : fenêtre ouverte par
// un robot à 4 m, onde au coup reçu, recharge). L'ancienne onde visuelle (blast or pâle, lot EVENEMENTS) est GARDÉE :
// elle porte la lumière au sol et sur les robots (src/rendu/lumieres.js) ; l'anneau de choc de la coque suit exactement
// sa courbe (même rayon à chaque image) et y ajoute cœur blanc, disque, éclats et flash. `actif: false` : ancien rendu.
// États : prêt (plaques au liseré discret) · ACTIF (fenêtre : les plaques se déploient et s'allument, l'anneau de la
// vraie portée de l'onde s'ouvre au sol et se vide avec la fenêtre) · onde (flash, plaques projetées, anneau de choc
// jusqu'à la vraie portée, éclats) · recharge (plaques éteintes, puis elles reviennent une à une ; pouls à « prêt »).
// Couleurs : celles de l'icône cel (assets/ui/icones/objet-reactive.png) : ambre 0xf4bf70 (ITEMS[].color) et crème.
// Durées en s (temps simulé), tailles en m, intensités en couleur linéaire additive (bloom au-dessus de 1,7).
export const COQUE_REACTIVE = {
  actif: true,
  couleurs: { ambre: 0xf4bf70, creme: 0xfff1c9, flash: 0xfff8ea },
  // plaques : nombre, rayon autour du héros (2,07 m de haut ; dôme du Pare-feu : 1,7 m), bas / haut, part de l'angle
  // couverte, rentrée du haut (coque), déploiement à l'ouverture de la fenêtre (part du rayon), rotation (rad/s)
  plaques: { nombre: 6, rayon: 0.62, bas: 0.5, haut: 1.4, couverture: 0.72, rentree: 0.14, deploiement: 0.22, rotation: 0.6, arete: 0.075 },
  // intensités : prêt (liseré seul), actif (liseré + plaque pleine), anneau au pied du héros (prêt / actif)
  look: { aretePret: 0.42, remplPret: 0.04, areteActif: 1.9, remplActif: 0.2, anneauPied: 0.45, halo: 0.35, scintille: 0.25 },
  // actif : l'anneau de portée (rayon = celui de l'onde, ITEMS.reactive.radius) s'ouvre en `ouverture` s depuis le pied,
  // en `arcs` arcs qui raccourcissent avec la fenêtre restante (la jauge) ; intensité, épaisseur (m), voile intérieur
  portee: { ouverture: 0.16, arcs: 6, intensite: 1.5, epaisseur: 0.07, voile: 0.16, voileLargeur: 0.9 },
  // onde : vie (s) ; le front suit l'ancienne onde (course = sa vie VFX_VIE[30], même courbe : un seul anneau) ;
  // flash du héros (s) ; plaques projetées de `projection` m ; éclats : nombre, temps pour aller au bout (s), portée
  // max (× rayon), longueur (m), épaisseur (m)
  onde: { vie: 0.5, course: VFX_VIE[30], eclatsCourse: 0.3, intensite: 1.3, remplissage: 0.9, flash: 0.08, flashIntensite: 2.4, projection: 0.75, eclats: 18, eclatsPortee: 1.22, eclatLongueur: 0.55, eclatEpaisseur: 0.06 },
  // recharge : les plaques reviennent une à une pendant les `retour` dernières s (au plus partMax de la recharge) ;
  // pouls au retour à « prêt » (s) ; fondu d'extinction (s)
  recharge: { retour: 0.6, partMax: 0.45, pouls: 0.2, extinction: 0.12 },
};
//#endregion e5:H-coque

//#region e5:I-tissus
// Étape 5, chantier I (ARCHITECTURE.md § E5.I) — Femz, 15/11 (choix du modèle S12) puis 18/11 : « il a juste la même
// cape que l'Éclaireur ». Le Shinobi porte TROIS tissus simulés (src/anim/tissus.js, même Verlet que la cape) à la
// place de la cape : pan ENTRE LES JAMBES (bassin devant), pan du DOS (bas du dos), QUEUE DE L'ÉCHARPE (cou, buste).
// Coordonnées : repère du MODÈLE agent-shinobi.glb (m ; +Z = l'avant, +X = la gauche du personnage ; hanches à
// y 1,115, x ±0,137 ; dos du bassin z −0,09 ; nuque z −0,13 à y 1,63 ; katana du dos de (0,25 ; 1,11 ; −0,23) à
// (−0,21 ; 1,92 ; −0,23)). Un tissu : haut (milieu de la rangée accrochée), cote (sens de la largeur ; la face avant
// du tissu regarde (bas × −cote)), bas (sens de la longueur), largeurs haut / bas, longueur (sans les pointes), cols ×
// rows (dernière rangée = pointes), longueur et décalage de chaque pointe, raideurs, traînées (1/s), gravité, souffle
// (m/s), poids des pointes (> 1 : plus légères), couloir (demi-largeur en x : le pan reste entre les cuisses), devantJambes (sort des cuisses et tibias vers l'avant du
// bassin), derriereKatana (sort du katana du dos vers l'arrière du buste), flottement (1/s : ondes ∝ vitesse de l'air), plan (signe +1 : z ≤ z du plan, −1 : z ≥, repère de l'os du tissu).
AGENTS[AGENT.SHINOBI].cape = false; // plus la cape de l'Éclaireur…
AGENTS[AGENT.SHINOBI].tissus = true; // … mais ses trois tissus
export const TISSUS = {
  actif: true,
  hz: 120,
  maxSubsteps: 8,
  iterations: 8,
  amortissement: 0.012,
  souffleHz: 0.7,
  flottementHz: 3.2, // ondes du flottement (Hz)
  marge: 0.02, // m — le tissu reste à cette distance des capsules
  // profils du torse (src/anim/profil-corps.js, Femz 22/11 : écart entre les tissus et le corps) : ils remplacent les
  // capsules du bassin et du dos ; le tissu reste à margeCorps du contour relevé. Par pièce : plaquer ('dos' | 'devant'),
  // ecart (m, accroches et repos), adherence ([x, y, z] m/s², repère de l'os : poussée vers le corps à l'arrêt)
  margeCorps: 0.008,
  adherenceVmax: 1.5, // m/s — l'adhérence s'efface avec la vitesse du bassin : nulle au-delà
  tente: { jambes: 0.05, katana: 0.08 }, // m — autour des jambes et du katana, les voisines restent aussi du bon côté
  teleport: 0.8, // m — saut d’accroche en une image au-delà duquel les tissus sont replacés (le dash fait 0,3 m par image)
  rayonBras: 0.065, // m — capsules des bras (épaule → main) : bras fins du Shinobi
  rayonCuisse: 0.08, // m — capsules des cuisses (hanche → genou) : 0,06 de demi-largeur mesurée sur le modèle, + 2 cm de garde
  rayonTibia: 0.09, // m — capsules des tibias (genou → pied) : 0,07 mesuré, + 2 cm de garde
  couleur: 0x2e2638, // tissu sombre violacé du concept S12 (jamais noir pur)
  degrade: 0.25, // bas plus clair (usure)
  lisere: { couleur: 0xef9628, largeur: 0.028, gain: 1.0 }, // accent du Shinobi, sur les deux bords de chaque tissu
  bassin: { a: [0, 0.97, -0.005], b: [0, 1.17, -0.005], rayon: 0.1 }, // volume du bassin (os du bassin)
  dos: { a: [0, 1.215, 0], b: [0, 1.531, 0], rayon: 0.129 }, // repli si le .glb n'a pas cape_dos
  katana: { a: [0.225, 1.125, -0.23], b: [-0.19, 1.9, -0.23], rayon: 0.035 }, // katana porté dans le dos (axe mesuré), suit l'os arme_katana
  pieces: [
    {
      nom: 'pan', os: 'bassin', haut: [0, 1.125, 0.135], cote: [-1, 0, 0], bas: [0, -1, 0.05], couloir: 0.05, devantJambes: true,
      largeurHaut: 0.1, largeurBas: 0.085, longueur: 0.46, cols: 4, rows: 8,
      pointes: [0.08, 0.12, 0.06, 0.1], decalagePointes: [0.01, -0.008, 0.008, -0.01],
      raideur: 1, raideurCisaillement: 0.6, raideurFlexion: 0.1, raideurPointe: 0.9,
      traineeNormale: 2.6, traineeTangente: 0.25, gravite: 9.8, souffle: 0.4, poidsPointes: 1.6, flottement: 3,
      plan: { signe: -1, z: 0.03 },
      plaquer: 'devant', ecart: 0.01, adherence: [0, 0, -2.5],
    },
    {
      nom: 'dos', os: 'bassin', haut: [0, 1.09, -0.105], cote: [1, 0, 0], bas: [0, -1, -0.07], derriereKatana: true,
      largeurHaut: 0.22, largeurBas: 0.28, longueur: 0.6, cols: 5, rows: 8,
      pointes: [0.16, 0.25, 0.12, 0.27, 0.18], decalagePointes: [0.025, -0.02, 0.02, -0.025, 0.015],
      raideur: 1, raideurCisaillement: 0.6, raideurFlexion: 0.12, raideurPointe: 0.9,
      traineeNormale: 1.7, traineeTangente: 0.25, gravite: 9.8, souffle: 0.5, poidsPointes: 1.6, flottement: 4,
      plan: { signe: 1, z: -0.07 },
      plaquer: 'dos', ecart: 0.01, adherence: [0, 0, 3],
    },
    {
      nom: 'echarpe', os: 'buste', haut: [0.05, 1.635, -0.145], cote: [1, 0, 0.15], bas: [0.18, -0.55, -1], derriereKatana: true,
      largeurHaut: 0.1, largeurBas: 0.075, longueur: 0.72, cols: 3, rows: 10,
      pointes: [0.12, 0.2, 0.09], decalagePointes: [0.012, -0.01, 0.01],
      raideur: 1, raideurCisaillement: 0.6, raideurFlexion: 0.08, raideurPointe: 0.9,
      traineeNormale: 3.2, traineeTangente: 0.3, gravite: 9.8, souffle: 0.7, poidsPointes: 1.8, flottement: 4,
      plan: { signe: 1, z: -0.06 },
      plaquer: 'dos', ecart: 0.01, // sans adhérence : poussée vers le dos, elle frôlait le katana porté en travers
    },
  ],
};
//#endregion e5:I-tissus

//#region e5:J-chargement
// Étape 5, chantier J (ARCHITECTURE.md § E5.J) — Femz, 18/11 : un ÉCRAN DE CHARGEMENT au lancement (environ 70 Mo
// demandés au démarrage ; sur la version web l'écran restait vide avant l'écran titre). Fond, logo et barre
// vide sont dans index.html (affichés avant tout script) ; src/chargement.js mesure les VRAIS octets reçus (entrées de
// performance de chaque fichier fini ; fetch observé pour ce qui est en cours) et suit les trois étapes du jeu publiées par
// main.js (modèles posés, scène du titre, préchauffage de la capsule), puis efface l'écran en fondu.
export const CHARGEMENT = {
  // Octets attendus au premier lancement (décodés, tels que les compte src/chargement.js), mesurés par
  // tests/e5-J-chargement.mjs le 18/11/2026. Seulement le dénominateur de la barre : s'il est trop bas, la barre
  // reste à 99 % jusqu'à la fin ; le test échoue si la mesure s'en écarte de plus de `ecartMax`.
  octetsAttendus: 60400000, // 19/11 (§ E5.K) : 60,4 Mo — un seul agent détaillé lu au démarrage (71,6 Mo avant)
  ecartMax: 0.2,
  // Part de la barre donnée aux octets ; le reste se gagne par les étapes du jeu (modèles posés, titre construit,
  // préchauffage), chacune une part égale. La barre ne recule jamais et reste sous 100 % tant que le jeu n'est pas prêt.
  partOctets: 0.85,
  fonduS: 0.35, // s — fondu de sortie (prefers-reduced-motion : 0,15 s)
  fonduReduitS: 0.15,
  imagesAvantFondu: 2, // images (requestAnimationFrame) rendues sous l'écran avant le fondu : le titre est déjà peint
  rafraichissementTexteMs: 400, // le texte d'état change au plus toutes les 0,4 s (pas de clignotement)
  astuceMs: 4500, // une astuce reste 4,5 s
  blocageMs: 25000, // aucun octet ni aucune étape pendant 25 s, jeu pas prêt : message « bloqué » + Recharger
  attenteFinMs: 5000, // jeu prêt mais des requêtes encore annoncées en cours, aucun fichier fini depuis 5 s : on n'attend plus
  // Texte d'état selon ce qui se télécharge (dossier ou extension de la requête la plus représentée en cours).
  etats: [
    { motif: /assets\/modeles\/(heros|agent-)/, texte: 'Assemblage des agents…' },
    { motif: /assets\/modeles\/boss/, texte: 'Réveil du boss…' },
    { motif: /assets\/modeles\//, texte: 'Chargement des robots…' },
    { motif: /assets\/(sfx|ambiance)\//, texte: 'Chargement des sons…' },
    { motif: /assets\/(carte|decor)\//, texte: 'Gravure de la carte mère…' },
    { motif: /assets\/anims\//, texte: 'Chargement des animations…' },
    { motif: /assets\/polices\//, texte: 'Chargement des polices…' },
    { motif: /\.(png|webp|jpe?g)(\?|$)/, texte: 'Chargement des textures…' },
    { motif: /\.m?js(\?|$)/, texte: 'Chargement du programme…' },
  ],
  texteDefaut: 'Chargement…',
  // 20/11 (testeur Windows, 2 min à « 0 % ») : phrase posée sous la barre dès le départ, visible seule après 5 s (CSS) —
  // la carte graphique peut figer la page pendant qu'elle prépare les effets ; le joueur doit savoir que ça avance.
  patience: 'Première ouverture : la carte graphique prépare les effets du jeu. Ça peut prendre une à deux minutes, le jeu n’est pas bloqué.',
  // app de bureau, moteur 3D encore à l'essai (bureau/main.js) : {n} = essai, {t} = nombre de moteurs
  patienceMoteur: 'Premier lancement : réglage de la carte graphique (essai {n} sur {t}). Le jeu peut redémarrer tout seul, c’est normal.',
  // une image qui a duré plus que ça = page figée (compilation), pas chargement arrêté : le délai « bloqué » repart
  figeeMs: 2000,
  textePreparation: 'Préparation de l’affichage…', // octets reçus, le jeu compile ses programmes de rendu
  textePret: 'Prêt',
  // Astuces : comprises par un joueur qui découvre (touches par défaut ; « Échap » ouvre toujours la pause).
  astuces: [
    'Flèches ou ZQSD : se déplacer. Vos armes tirent seules.',
    'Espace : dash, pour sortir d’un encerclement.',
    'E : frapper les bornes lumineuses du décor.',
    'Ramassez les gemmes : chaque niveau vous propose un bonus.',
    `Un boss arrive toutes les ${BOSS.every} vagues.`,
    'Les Pixelz gagnés se dépensent au Noyau (touche H, à l’écran titre).',
    'Échap : pause, réglages et touches.',
    'Ouvrez les coffres : ils donnent des armes et des objets.',
  ],
  erreurs: {
    titre: 'Le chargement a échoué',
    modeles: 'Les modèles des robots n’ont pas pu être chargés.',
    script: 'Une partie du programme du jeu n’a pas pu être téléchargée.',
    bloque: 'Le chargement semble bloqué.',
    conseil: 'Vérifiez votre connexion, puis rechargez la page.',
    // 19/11 : la 3D n'a pas pu démarrer (contexte WebGL refusé : carte graphique absente, bloquée ou pilote trop ancien)
    gpu: 'La carte graphique n’a pas pu afficher le jeu.',
    conseilGpu: 'Mettez à jour le pilote de votre carte graphique, puis relancez le jeu.',
    recharger: 'Recharger',
    continuer: 'Continuer quand même',
  },
};
//#endregion e5:J-chargement

//#region e5:K-memoire
// Étape 5, chantier K (ARCHITECTURE.md § E5.K) — Femz, 18/11 : « le Chrome de mes amis plante à 50 % du chargement ».
// Un seul agent DÉTAILLÉ en mémoire (≈ 100 000 sommets chacun) : celui qui est choisi, lu au démarrage ; un autre est lu
// au moment où il est choisi et l'ancien libéré (src/rendu/modeles.js chargerAgent, player.poserAgentCourant). Les autres
// agents sont montrés en image fixe (portraits AGENT_SCREEN.portraits). src/memoire.js : attente et contexte WebGL perdu.
export const MEMOIRE = {
  textes: {
    attente: 'Assemblage de l’agent…',
    echecAgent: 'Cet agent n’a pas pu être chargé. Choisissez-en un autre ou rechargez la page.',
    perteTitre: 'L’affichage s’est arrêté',
    perteTexte: 'Le navigateur a manqué de mémoire graphique. Fermez quelques onglets, puis rechargez la page.',
    recharger: 'Recharger',
    // § E5.X2 (audit I1, I2) : erreur pendant une image, sauvegarde abîmée
    incidentTitre: 'Un problème est survenu',
    incidentTexte: 'Le jeu s’est mis en pause pour ne rien vous faire perdre. Continuez ; si le problème revient, rechargez.',
    incidentDetail: 'Détail : ',
    incidentErreurs: ' erreurs',
    continuer: 'Continuer',
    sauvegardeReprise: 'Votre sauvegarde était abîmée : celle du lancement précédent a été reprise. Une copie de l’ancienne est gardée.',
    sauvegardePerdue: 'Votre sauvegarde était illisible : la progression repart de zéro. Une copie de l’ancienne est gardée.',
  },
  // § E5.X2 : console bornée (les journalMax premières erreurs, puis une sur journalPas) ; durée de l'avis au titre
  incident: { journalMax: 5, journalPas: 600, detailMax: 140, avisSecondes: 10 },
};
//#endregion e5:K-memoire

//#region e5:V-vagues-paliers
// Étape 5, chantier V (ARCHITECTURE.md § E5.V ; conception validée par Femz le 17/11 : docs/conception-vagues-paliers.md).
// Femz, 17/11 : « l'arret constant du gameplay » entre les vagues casse l'accumulation. Un palier = 5 vagues : la fin
// d'une vague BASCULE à la volée sur la suivante (rien n'est figé ni retiré), sauf la veille d'un boss (vagues 4, 9,
// 14…) : arrêt complet, le DÉCRYPTAGE (le marchand). Au milieu du palier (vagues 2, 7, 12…), un TERMINAL se pose dans
// l'arène : on y va si on veut, il ouvre le décryptage en pause. Distances et durée : premiers réglages SUPPOSÉS, à mesurer.
export const PALIERS_VAGUES = { // (PALIERS : paliers de prix du Noyau, § E4)
  taille: 5,
  // Fraction des PV max rendue à chaque BASCULE (fin de vague sans arrêt). Choix de Femz du 20/11 après la mesure de la
  // tâche 8 : sans soin entre les vagues, le joueur-robot débutant n'arrivait plus au boss de la vague 5 que dans 1 partie
  // sur 5 (4 sur 5 avant les paliers, cible § E2.G) ; le décryptage et le terminal gardent leur soin (SHOP.repairOnArrival)
  soinBascule: 0.25,
  terminalDecalage: 2, // vague n % taille === 2 : le terminal se pose (vagues 2, 7, 12, 17…)
  terminal: {
    distMin: 10, // m — point de pose tiré entre distMin et distMax du héros, dans l'arène et dans le champ
    distMax: 14,
    presence: 30, // s — puis il repart
    soin: 0.25, // part des PV max rendue à l'ouverture (validé le 17/11, comme le décryptage)
    rayonInteraction: 2.2, // m — invite « Interagir » à portée
    // 22/11 : modèle à lui (outils/blender/terminal.py), il ne réquisitionne plus le drone du marchand. Il tombe du ciel
    // (chute s, depuis hauteurChute m, accélération constante), reste posé, puis remonte (depart s). Le héros bute dessus.
    modele: 'terminal.glb',
    hauteur: 2.6, // m — hauteur posée (le modèle en déclare 2,1 : agrandi de 24 %, au gabarit de l'ancien drone)
    lacet: -0.35, // rad — écran tourné vers la caméra, de trois quarts (lisible quelle que soit la place du héros)
    chute: 0.55,
    hauteurChute: 11,
    depart: 0.6,
    rayonCorps: 0.85, // m — emprise solide (le héros glisse autour)
    secousse: 0.25, // trauma à l'impact
  },
  nomDecryptage: 'Décryptage',
  hud: { decryptage: 'Décryptage', terminal: 'Terminal posé' }, // § E5.V tâche 7 : piste du palier (variante B, Femz 20/11)
};
/** § E5.V : la fin de la vague n est un arrêt complet (décryptage) — la veille d'une vague de boss. */
export function isPauseWave(n) {
  return isBossWave(n + 1);
}
/** § E5.V : un terminal se pose au début de la vague n (vagues 2, 7, 12…). */
export function isTerminalWave(n) {
  return n % PALIERS_VAGUES.taille === PALIERS_VAGUES.terminalDecalage;
}
// Femz, 17/11 : « garde les xp et gemme au sol entre les vagues » — au décryptage, le butin au sol reste AU SOL (ni perdu,
// ni aspiré) et se ramasse à la vague suivante ; fragments compris (choix de conception) ; butin du boss et disquette
// aspirés comme avant (src/pickups.js : mode 'sol').
END_LOOT.mode = 'sol';
//#endregion e5:V-vagues-paliers

//#region e5:M-dangers-guide
// Étape 5, lot 2 du guide UX (ARCHITECTURE.md § E5.M ; audit docs/audit-guide/B-rapport.md, B3 à B12 sauf B5 ;
// Femz, 20/11 : « oui go »). Les dangers se lisent : le rouge pur 0xff3b3b est réservé aux tirs et aux zones, chaque
// explosion et chaque manœuvre a sa zone au sol, l'annonce passe avant le flash d'impact, rien ne tire hors de l'écran,
// le HUD du boss ne le cache plus. Les durées d'origine modifiées le sont ici, en fin de fichier (ancienne valeur en
// commentaire) : une seule source, lue par les modules à l'exécution.
export const DANGERS_GUIDE = {
  // B3 — yeux des robots « rouge danger » (couleur cuite dans l'atlas : multiplicateur uSrEye du shader des robots,
  // § E1.S). gain[révision] remplace ENEMIES.revisionEyes pour ces types : l'échelle v1 < v2 < v3 est gardée, sous
  // l'éclat d'un tir. teinte : part gardée de chaque canal (le vert et le bleu baissent plus : rouge plus profond).
  yeux: {
    types: [ENEMY.RODEUR, ENEMY.DRONE, ENEMY.BLINDE, ENEMY.SCANNER, ENEMY.DIVISEUR],
    gain: [0.18, 0.22, 0.27], // balayé le 20/11 (horde 2560 × 1440, part des pixels « rouge de tir » restants) : 0,42 → 34 %, 0,31 → 20 %, 0,27 → 0,1 %, 0,18 → 0 % ; rouge moyen des yeux v1/v2/v3 ≈ 180/192/202 (tir : 240)
    teinte: [1, 0.55, 0.6],
    couleur: 0x8e1e24, // taches de lumière au sol (rendu/lumieres.js) et modèles de secours : le rouge sombre des yeux
  },
  // B4 — un robot qui annonce (tireur qui vise, kamikaze dont la mèche brûle) : flash d'impact × (1 − lueur × part)
  annonce: { part: 1 },
  // B7 — kamikaze : disque de son vrai rayon (ENEMIES.types[KAMIKAZE].explode.radius) pendant la mèche
  kamikaze: { chainFuse: 0.5 }, // s — mèche de la chaîne v2 (était 0,25)
  // B6 — mine du poseur : rayon d'explosion dessiné une fois armée, annonce entre déclenchement et explosion
  mine: { annonce: 0.35, gainArmee: 0.32 }, // s ; gain du fond du disque de 2 m (terne : elle attend)
  // B8 — rôdeur v2 : accroupi plus long, trait au sol dans l'axe du bond
  rodeur: { crouch: 0.45 }, // s (était 0,3)
  // B9 — flaque du drone v3 : aucun dégât avant la fin de l'étalement + delai
  flaque: { delai: 0.3 }, // s
  // B10 — scanner : arc entier dans le langage du balayage du boss (BOSS.attacks.sweep : départ, rayons fins, gains)
  scanner: { spokes: 16, spokeWidth: 0.14, startGain: 2.4, spokeGain: 1.6, eteint: 0.3 },
  // B11 — HUD du boss : bloc du boss et bloc du chrono transparents quand la boîte écran du boss les touche
  hud: {
    opacite: 0.22, // opacité du bloc tant que le boss est dessous
    fondu: 0.12, // s — transition
    marge: 0.6, // m autour du corps du boss (rayon, hauteur) dans la boîte écran
    relire: 30, // images entre deux relectures des rectangles du HUD (layout : jamais à chaque image)
    blocs: ['.sr-boss', '.sr-bloc-vague', '.sr-hud-top > .sr-clock', '.sr-hud-top > .sr-chip-vague', '.sr-bloc-etat', '.sr-palier'],
  },
  // B12 — un tireur ne vise et ne tire que si son pied est dans le champ VISIBLE (zoom compris), à marge m du bord
  tireur: { marge: 0.4 },
};
{
  const rev = (key) => ENEMIES.revisions.find((r) => r.key === key);
  rev('chaine').chainFuse = DANGERS_GUIDE.kamikaze.chainFuse; // B7 (était 0,25)
  rev('bond').crouch = DANGERS_GUIDE.rodeur.crouch; // B8 (était 0,3)
  for (const t of DANGERS_GUIDE.yeux.types) ENEMIES.types[t].eyeColor = DANGERS_GUIDE.yeux.couleur; // B3
  // B11 — bande du HUD en fraction de la hauteur d'écran (mesuré le 20/11 : bas du bloc du boss à 0,1917 × hauteur en
  // 720p comme en 1440p, le HUD suit la hauteur) + la secousse et le punch de l'impact (≈ 0,024) ; remplace hudTopPx
  BOSS.arrival.hudTopFrac = 0.22;
}
//#endregion e5:M-dangers-guide

//#region e5:L-textes-guide
// Étape 5, lot 1 du guide UX (ARCHITECTURE.md § E5.L ; audit du 20/11, docs/audit-guide/SYNTHESE.md) : textes compris
// au 1er lancement, consignes au bon moment. Les mots de la DA restent ; ils sont expliqués là où ils s'affichent.

// ----- C3 : « niveau » = agent et arme ; un objet s'empile en EXEMPLAIRES (« ×N »), un bonus de carte se prend PAR CARTE -----
TEXTES_N.parNiveauBonus = ' par carte'; // « +10 % de dégâts par carte » (0 / 5 cartes prises : la barre de crans)
TEXTES_N.parNiveau = 'Par exemplaire : '; // fiche d'un objet au Noyau
TEXTES_N.fusionPlus = ' +1 exemplaire à '; // carte d'un objet fusionné : « … +1 exemplaire à Virus et Surchauffe. »
CHOICES.itemText.nouveau = 'Nouveau : '; // carte ou lot d'un objet pas encore possédé : « Nouveau : ×2 »
CHOICES.itemText.possede = 'Possédé '; // objet possédé : « Possédé ×3 → ×4 »
const PILES_L = {
  overclock: '−3 PV max par exemplaire (jamais sous 40 PV max)',
  drone: '2e drone à ×5, 3e à ×10',
  capacitor: 'impulsion de 40 dégâts, +10 par exemplaire',
  shrapnel: '4 éclats de 8 dégâts, +2 par exemplaire',
};
const DETAILS_L = {
  overclock: 'Toutes vos armes tirent plus vite. En échange, vos PV max baissent un peu à chaque exemplaire.',
  drone: 'Un drone allié vous suit et tire tout seul sur les robots, comme un blaster. D’autres drones vous rejoignent à ×5 et à ×10 exemplaires.',
};
for (const I of ITEMS) {
  if (PILES_L[I.key]) I.pile = PILES_L[I.key];
  if (DETAILS_L[I.key]) I.detail = DETAILS_L[I.key];
}
// § E4.G (fiche) : « Chaque niveau » valait aussi pour les objets
RECHARGE.texteEffet = 'Agit quelques secondes dès qu’un robot est proche, puis se recharge. Chaque niveau d’arme ou exemplaire d’objet : recharge plus courte, effet plus long.';

// ----- C7, C8 : ce que rend « Passer », portée de « Bannir », durée d'un choix -----
CHOICES.labels.skipGain = 'Passer : +{n} fragments'; // {n} = CHOICES.skipFragmentsPerWave × vague (le vrai versement)
CHOICES.labels.banish = 'Bannir (pour cette partie)';
CHOICES.itemText.lead = 'Choisissez une carte. Elle compte pour cette partie.';
CHESTS.text.lead = 'Coffre ouvert : gardez un lot pour cette partie.'; // le mot « coffre » explique « Cache déchiffrée »
CHESTS.text.banish = CHOICES.labels.banish;
ELITES.jackpot.lead = 'Gros coffre : tous les lots sont à vous, pour cette partie.';
/** Fragments rendus par une passe à la vague `wave` (progression.skipChoice et chests.skip versent ce montant). */
export function fragmentsPasse(wave) {
  return CHOICES.skipFragmentsPerWave * (wave > 1 ? wave : 1);
}

// ----- C9 : recharge en phrase, avec sa condition (cooldowns.js : un robot à `reach` m ouvre la fenêtre) -----
TEXTES_N.actif = 'Agit pendant'; // fiche : « Agit pendant 1,5 s » (« Actif » avant)
RECHARGE.phrase = {
  une: 'Agit {a} s dès qu’un robot est à moins de {r} m, puis se recharge {c} s.',
  deux: 'Agit {a} s dès qu’un robot est à moins de {r} m, puis se recharge {c} s.', // {a}, {c} : « 1,5 → 1,7 »
};

// ----- C15 : écran de fusion (à ITEM_RULES.fusionAt exemplaires de CHAQUE objet, aucun maximum) -----
FUSION_SCREEN.lead = 'Deux objets à ×' + ITEM_RULES.fusionAt + ' chacun fusionnent : une place se libère.';
FUSION_SCREEN.keeps = 'Garde les effets et les exemplaires de';

// ----- C16 : Frappe éclair — la touche RÉELLE partout (input.majTexteFrappe), la caractéristique en frappes par seconde -----
{
  const F = WEAPONS.find((W) => W.id === WEAPON.FLASH);
  F.detailModele = 'Appuyez sur {touche} : vous filez droit devant vous et tranchez tous les robots sur la ligne. La touche se change dans la pause.'; // § E5.X4 (J3)
  F.statLabels = F.statLabels.slice();
  F.statLabels[1] = 'Fréquence'; // « Recharge » montait de 0,22 à 0,36 /s : c'est un nombre de frappes par seconde
  F.statUnits = F.statUnits.slice();
  F.statUnits[1] = 'frappes/s';
}

// ----- C17 : lot de surcharge du coffre, chiffré, sans le mot « cran » -----
CHESTS.text.surchargeDesc = '+{p} % de dégâts de plus pour cette arme, déjà au niveau max.';
CHESTS.text.surchargeTotal = 'Total : +{t} % de dégâts';

// ----- C23 : « 1 Pixelz » -----
MONNAIE.un = 'Pixelz';

// ----- A10, C18 : rang des raretés, « ROOT » expliqué -----
/** « Optimisé · rareté 3/6 » : le nom de la DA et son rang (hors combat : construit une chaîne). */
export function rareteTexte(r) {
  const R = RARITIES[r];
  return R ? R.name + ' · rareté ' + (r + 1) + '/' + RARITIES.length : '';
}
AGENT_SCREEN.rootSous = 'arme de départ'; // sous l'arme signature de la carte d'agent, après l'étiquette « ROOT »
AGENT_SCREEN.rootBulle = 'Root : la rareté la plus haute (6/6). L’arme de départ de cet agent.';

// ----- A9 : piste sous le chrono, en mots de joueur (variante B gardée) -----
PALIERS_VAGUES.explication = 'Le marchand : vos fragments contre des améliorations d’arme.'; // sous le titre « Décryptage »
PALIERS_VAGUES.hud.marchandApres = 'Marchand après la vague {v}';
PALIERS_VAGUES.hud.marchandFin = 'Marchand à la fin de cette vague';
PALIERS_VAGUES.hud.terminal = 'Terminal posé';
PALIERS_VAGUES.hud.terminalEffet = ' : marchand et +' + Math.round(SHOP.repairOnArrival * 100) + ' % PV'; // shop.open soigne SHOP.repairOnArrival

// ----- A1, A2, A3 : consignes montrées UNE fois par profil (src/consignes.js) -----
// {haut} {gauche} {bas} {droite} {dash} {interagir} : libellés des touches RÉELLEMENT réglées (input.libelle).
export const CONSIGNES = {
  deplacer: {
    lignes: ['Déplacez-vous avec {haut} {gauche} {bas} {droite} : vos armes tirent toutes seules.', 'Objectif : tenez jusqu’à 0:00.'],
    jeuMax: 7, // s de jeu au plus après le 3-2-1
    bougeS: 1.5, // ou dès que le héros a bougé ce temps-là (s)
  },
  dash: { lignes: ['{dash} : dash. Un bond rapide : rien ne vous touche pendant le bond.'], secondes: 5 },
  terminal: { lignes: ['{interagir} : ouvrir le terminal. Marchand et +' + Math.round(SHOP.repairOnArrival * 100) + ' % de PV.'], secondes: 6 },
  fonduS: 0.3,
};
//#endregion e5:L-textes-guide

//#region e5:O-noms-guide
// Étape 5, suite du guide UX (ARCHITECTURE.md § E5.O ; Femz, 21/11) : noms en double (C4), bonus de dégâts (C6), un
// effet chiffré par ligne. Clés internes INCHANGÉES (sauvegardes, méta, offres) : seuls les textes changent.

// ----- C4 : noms vus par le joueur (Overclock / OVERCLOCKING / OVERCLOCK, SURCHARGÉ, Aimant à fragments, Champ EMP et
// le menu Noyau ne changent pas) -----
const BONUS_O = (k) => PROGRESSION.bonuses.find((b) => b.key === k);
BONUS_O('damage').name = 'Puissance'; // 'Surcharge'
// (Collecteur, ex-Aimant : la carte est remplacée par Apprentissage, gain d'XP — § E5.Z)
SHOP.overcharge.label = 'Survoltage'; // 'Surcharge' (ligne du marchand, arme au niveau max)
SHOP.overcharge.effet = 'de dégâts'; // marchand A3, sous l'arme : « +8 % de dégâts » (« +8 % surcharge » avant)
CHESTS.text.overcharge = 'SURVOLTAGE'; // 'SURCHARGE' (étiquette du lot du coffre)
CHESTS.text.surchargeTotal = 'Survoltage total : +{t} % de dégâts'; // 'Total : +{t} % de dégâts'
FICHE_STATS.lignes.find((l) => l.id === 'aimant').nom = 'Rayon de collecte'; // 'Aimant' (fiche : pause et Noyau)
UTILITIES.list[UTIL.MAGNET].name = 'ASPIRATEUR'; // 'AIMANT' (bonus au sol)
UTILITIES.list[UTIL.IEM].name = 'ONDE DE CHOC'; // 'I.E.M'
RECAP.types[RECAP_T.UTIL0 + UTIL.MAGNET].nom = 'Aspirateur'; // 'Aimant' (récap des ramassages du HUD)
RECAP.types[RECAP_T.UTIL0 + UTIL.IEM].nom = 'Onde de choc'; // 'I.E.M'
RARITIES[RARITY.NOYAU].name = 'Doré'; // 'Noyau' (rareté 5/6, la dorée) — « Doré · rareté 5/6 »
CARRIER_RARITY.labels[RARITY.NOYAU] = 'CACHE DORÉE'; // 'CACHE NOYAU' (bannière de l'élite porteuse)

// ----- C6 : Cadenceur au niveau de Puissance -----
BONUS_O('fireRate').value = 0.1; // 0.08 : Puissance (+10 % de dégâts) l'emportait toujours (rapport C, C6)
BONUS_O('fireRate').desc = '+10 % de cadence'; // '+8 % de cadence'

// ----- Un effet chiffré par ligne (règle de Femz, 21/11) : « \n » = un bloc .sr-card-stat (ui.js colorer) -----
BONUS_O('maxHp').desc = '+20 PV max'; // '+20 PV max (et soigne 20 PV)' : le soin passe sur sa ligne (SYNERGIES.soin)
const PILES_O = {
  tesla: 'Éclair sur 5 robots\n50 % des dégâts du coup', // 'éclair sur 5 robots, 50 % des dégâts du coup'
  cryo: 'Gel de 1,2 s\nLe robot avance à 30 %', // 'gel de 1,2 s, vitesse × 0,3'
  burn: 'Feu de 3 s à 15 PV/s\nSe propage aux robots à 2 m', // 'feu de 3 s à 15 PV/s, voisins à 2 m'
  detonator: 'Explosion à 60 % du coup', // 'explosion à 60 % du coup'
  berserk: 'Plafond : × 3', // 'max × 3'
  leech: '2 PV par robot\nAu plus 10 PV par seconde', // '2 PV par robot, max 10 PV par seconde'
  reactive: 'Onde de 4 m\nAu plus 1 par seconde', // 'onde de 4 m, max 1 par seconde'
  overclock: '−3 PV max par exemplaire (jamais sous 40 PV max)', // (même texte, désormais sur sa ligne)
  drone: '2e drone à ×5\n3e drone à ×10', // '2e drone à ×5, 3e à ×10'
  capacitor: 'Impulsion de 40 dégâts\n+10 dégâts par exemplaire', // 'impulsion de 40 dégâts, +10 par exemplaire'
  shrapnel: '4 éclats de 8 dégâts\n+2 dégâts par exemplaire', // '4 éclats de 8 dégâts, +2 par exemplaire'
};
for (const I of ITEMS) if (PILES_O[I.key]) I.pile = PILES_O[I.key];
UTILITIES.list[UTIL.TURBO].desc = 'Pendant 10 s :\n+30 % de vitesse\n+50 % de dégâts'; // 'Pendant 10 s : +30 % de vitesse et +50 % de dégâts.'
UTILITIES.list[UTIL.TURBO].detail = UTILITIES.list[UTIL.TURBO].desc + '\n' + UTILITIES.list[UTIL.TURBO].detail.slice(UTILITIES.list[UTIL.TURBO].detail.indexOf('Bonus à ramasser'));
/** Carte « NOUVELLE ARME » du coffre : les chiffres du niveau 1, un par ligne (weaponLine les joignait par « , »). */
export function weaponLignes(w) {
  return weaponLine(w).replace(', ', '\n');
}

// ----- C6 : lignes de synergie des cartes de niveau (noms lus dans ITEMS / AGENTS : un renommage suit) -----
export const SYNERGIES = {
  prefixe: 'Utile avec : ',
  cartes: {
    crit: { passifs: ['reflexe', 'ombre'], objets: ['detonator', 'scope'] }, // Réflexe, Frappe de l'ombre : critiques
    fireRate: { objets: ['tesla', 'cryo', 'burn'], fin: ' (chances par coup)' }, // plus de coups, plus de chances
    dashCd: { objets: ['dashcore'] }, // Moteur cinétique : chaque dash blesse
  },
  soin: 'Soigne aussi {n} PV', // Blindage renforcé (B.heal), sur sa ligne
  conversion: 'Conversion : +{p} % de dégâts', // Plaques ablatives, agent au passif resistToDamage (Bastion)
};
/** SYNERGIE_O[agent][b] : la ligne « Utile avec : … » de la carte b pour cet agent ('' sinon). Construite au chargement. */
export const SYNERGIE_O = AGENTS.map((A) =>
  PROGRESSION.bonuses.map((B) => {
    const S = SYNERGIES.cartes[B.key];
    if (!S) return '';
    const noms = [];
    if (S.passifs && S.passifs.includes(A.passive.key)) noms.push(A.passive.name);
    for (const k of S.objets || []) noms.push(ITEMS.find((I) => I.key === k).name);
    return SYNERGIES.prefixe + noms.join(', ') + (S.fin || '');
  }),
);
/**
 * Lignes ajoutées sous les chiffres d'une carte de niveau (progression.drawCard, à l'ouverture du choix : hors image) :
 * le soin du Blindage, la synergie, et pour un passif Conversion le gain RÉEL de Plaques ablatives (résistance ×
 * dégâts reçus actuels × 8 %, arrondi). Chaîne vide ou « \nligne\nligne ».
 */
export function lignesCarteO(b, agent, damageTakenMul) {
  const B = PROGRESSION.bonuses[b];
  let t = B.heal > 0 ? '\n' + SYNERGIES.soin.replace('{n}', String(B.heal)) : '';
  const A = AGENTS[agent];
  if (B.key === 'armor' && A && A.passive.resistToDamage > 0) {
    const p = Math.round(100 * A.passive.resistToDamage * damageTakenMul * (1 - B.value));
    if (p > 0) t += '\n' + SYNERGIES.conversion.replace('{p}', String(p));
  }
  const s = SYNERGIE_O[agent] ? SYNERGIE_O[agent][b] : '';
  return s ? t + '\n' + s : t;
}

// ===== § E5.X7 — lot 11 de l'audit : récompenses et HUD qui disent tout (H2-H16, A13, F6 ; Femz 22/11) =================
// Bloc groupé (le lot 7 touche aussi ce fichier). Tous ces textes sont construits au chargement ou hors combat.

// ----- H10 : la recharge, un chiffre par ligne (cooldowns.salvesTexte ; {a}, {c} : « 1,5 » ou « 1,5 → 1,7 ») -----
RECHARGE.phrase.une = 'Démarre à {r} m d’un robot\nAgit {a} s\nPuis se recharge {c} s'; // 'Agit {a} s dès qu’un robot est à moins de {r} m, puis se recharge {c} s.'
RECHARGE.phrase.deux = RECHARGE.phrase.une;

// ----- H11 : valeurs avec leur repère -----
{
  const I_ = (k) => ITEMS.find((I) => I.key === k);
  // Drone : « × 1,00 » (fois quoi ?) → les dégâts d'un tir, en PV (dégâts du blaster de niveau 1 × multiplicateur : items.js DRONE_DMG)
  I_('drone').unit = 'tir'; // 'mul'
  I_('drone').what = 'dégâts par tir'; // 'dégâts du drone'
  // Berserk : « Plafond : × 3 » → le gain maximal, dans l'unité de sa ligne (« Cadence à 0 PV : +20 % ») ; max = I.max (items.js I_BERSERK_MAX)
  I_('berserk').pile = 'Au plus +' + Math.round(100 * I_('berserk').max) + ' %, tous exemplaires compris'; // 'Plafond : × 3'
  I_('berserk').what = 'cadence, PV presque vides'; // 'cadence à 0 PV' : deux chiffres sur la ligne (« Cadence à 0 PV : +20 % »)
  // Virus : « PV par seconde : 2 » sans dire qui les perd → « Robot infecté : −2 PV/s »
  I_('virus').unit = 'pvs'; // 'n'
  I_('virus').what = 'robot infecté'; // 'PV par seconde'
}

// ----- H12 : synergies de critique oubliées, et la synergie inverse sur les cartes d'objet -----
SYNERGIES.cartes.crit.armes = ['katana', 'smoke']; // « Utile avec » de la carte Viseur, quand l'arme est possédée
/** Ligne « Utile avec : Viseur » d'une carte d'objet : les bonus de carte dont SYNERGIES.cartes cite l'objet (au chargement). */
export const SYNERGIE_OBJET = ITEMS.map((I) => {
  const noms = [];
  for (const B of PROGRESSION.bonuses) {
    const S = SYNERGIES.cartes[B.key];
    if (S && S.objets && S.objets.includes(I.key)) noms.push(B.name);
  }
  return noms.length ? SYNERGIES.prefixe + noms.join(', ') : '';
});
/** Noms des armes de la synergie de la carte b possédées (owned : Uint8Array de weapons) : « , Katana, Fumigènes » ou ''. */
export function synergieArmesX7(b, owned) {
  const S = SYNERGIES.cartes[PROGRESSION.bonuses[b].key];
  if (!S || !S.armes || !owned) return '';
  let t = '';
  for (const k of S.armes) {
    const w = WEAPON_KEYS.indexOf(k);
    if (w >= 0 && owned[w] === 1) t += ', ' + WEAPONS[w].name;
  }
  return t;
}

// ----- H2 / C20 : l'évolution sur la carte (connue : découverte ou révélée par un succès — règle de la Collection) -----
export const EVO_CARTE = {
  arme: 'Évolue avec : {p} (au niveau max, puis un coffre)', // arme principale, recette connue
  inconnue: 'Évolution : ? (au niveau max, puis un coffre)', // arme principale, recette pas encore connue
  objet: 'Fait évoluer : {a} (arme au niveau max, puis un coffre)', // objet catalyseur ou arme absorbée, recette connue
};
/** Évolution dont l'arme w est l'arme principale (−1 sinon), dont elle est l'arme absorbée, dont l'objet i est le catalyseur. */
export const EVO_DE_ARME = WEAPON_KEYS.map((k) => EVOLUTIONS.findIndex((E) => E.weapon === k));
export const EVO_PARTENAIRE = WEAPON_KEYS.map((k) => EVOLUTIONS.findIndex((E) => E.partner === k));
export const EVO_DE_OBJET = ITEMS.map((I) => EVOLUTIONS.findIndex((E) => E.item === I.key));
const nomArmeX7 = (k) => (WEAPON_KEYS.indexOf(k) >= 0 ? WEAPONS[WEAPON_KEYS.indexOf(k)].name : '?');
const nomCatalyseurX7 = (E) => (E.item ? ITEMS.find((I) => I.key === E.item).name : nomArmeX7(E.partner));
/** Ligne d'évolution d'une carte d'arme (connue(e) : la recette e est connue). Chaîne vide si l'arme n'évolue pas. */
export function ligneEvoArme(w, connue) {
  const e = EVO_DE_ARME[w];
  if (e >= 0) return connue(e) ? EVO_CARTE.arme.replace('{p}', nomCatalyseurX7(EVOLUTIONS[e])) : EVO_CARTE.inconnue;
  const p = EVO_PARTENAIRE[w];
  return p >= 0 && connue(p) ? EVO_CARTE.objet.replace('{a}', nomArmeX7(EVOLUTIONS[p].weapon)) : '';
}
/** Ligne d'évolution d'une carte d'objet : seulement si la recette est connue (la découverte reste voulue, C20). */
export function ligneEvoObjet(i, connue) {
  const e = i >= 0 && i < EVO_DE_OBJET.length ? EVO_DE_OBJET[i] : -1;
  return e >= 0 && connue(e) ? EVO_CARTE.objet.replace('{a}', nomArmeX7(EVOLUTIONS[e].weapon)) : '';
}

// ----- H3 / C5 : lots d'arme du coffre en VALEURS (« Perforation : 0 → 1 robot traversé ») -----
export const LOT_STAT_X7 = {
  ligne: '{l} : {a} → {b}', // {l} : nom de la stat ; {a}, {b} : valeur effective avant → après (unité comprise)
  mots: { Perforation: ['robot traversé', 'robots traversés'] }, // stat sans unité ni repère : l'unité en mots
};
/** Valeur d'une stat pour une carte : deux décimales au plus, virgule ; unité « /s » collée, les autres après une espace. */
export function valeurStatX7(v, unite) {
  const r = Math.round(v * 100) / 100;
  let s = Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, '').replace('.', ',');
  if (unite) s += (unite.charCodeAt(0) === 47 ? '' : ' ') + unite;
  return s;
}
/** « Dégâts : 10 → 12 » (unité de la stat, mots de LOT_STAT_X7.mots si elle n'en a pas) ; avant < 0 : « Dégâts : 12 ». */
export function ligneStatX7(w, s, avant, apres) {
  const W = WEAPONS[w];
  const m = LOT_STAT_X7.mots[W.statLabels[s]];
  const u = m ? (Math.round(apres) >= 2 ? m[1] : m[0]) : W.statUnits[s];
  if (u === '×') return W.statLabels[s] + ' : ' + (avant < 0 ? '' : '× ' + valeurStatX7(avant, '') + ' → ') + '× ' + valeurStatX7(apres, ''); // « × 2,2 → × 2,8 », comme le Viseur thermique
  if (avant < 0) return W.statLabels[s] + ' : ' + valeurStatX7(apres, u); // nouvelle arme : la valeur à son arrivée
  return LOT_STAT_X7.ligne.replace('{l}', W.statLabels[s]).replace('{a}', valeurStatX7(avant, '')).replace('{b}', valeurStatX7(apres, u));
}

// ----- H6 : récompenses dites (récap des ramassages, § E5.E.2 ; marchand) -----
RECAP.types.push(
  { cle: 'soinVague', nom: 'Nouvelle vague', icone: 'sr-b-regen', couleur: hexUi(UTIL_UI('battery').color), effet: 'pv' }, // PV réellement rendus (main.basculer)
  { cle: 'relanceBoss', nom: 'Boss détruit', icone: 'sr-i-trophee', couleur: '#ffc83d', effet: 'texte', texte: '+' + CHOICES.rerollPerBoss + ' relance' }, // main.js : CHOICES.rerollPerBoss
);
RECAP_T.SOIN_VAGUE = 13;
RECAP_T.RELANCE_BOSS = 14;
RECAP_T.COUNT = RECAP.types.length; // 15
if (RECAP.types[RECAP_T.SOIN_VAGUE].cle !== 'soinVague' || RECAP.types[RECAP_T.RELANCE_BOSS].cle !== 'relanceBoss') throw new Error('RECAP : types du § E5.X7 hors d’ordre');
export const DECRYPTAGE_X7 = {
  soin: 'Soin du marchand : +{n} PV', // shop.open (SHOP.repairOnArrival), PV réellement rendus
  soinPlein: 'PV déjà au maximum',
  fragments: 'Les fragments non dépensés sont perdus à la fin de la partie.', // H16
};

// ----- H9 : nombre de lots d'une élite porteuse sur sa bannière (ELITES.chestSize ; un seul chiffre par ligne) -----
CARRIER_RARITY.lots = RARITIES.map((R, r) =>
  r >= RARITY.ROOT ? ' · ' + ELITES.chestSize.root + ' LOTS' : r === RARITY.NOYAU ? ' · ' + ELITES.chestSize.noyau + ' LOTS' : r === RARITY.CHIFFRE ? ' · JUSQU’À 3 LOTS' : ' · 1 LOT',
);

// ----- H15, H16 : bonus au sol (30 s) et fragments (perdus en fin de partie), consignes montrées une fois par profil -----
CONSIGNES.bonusSol = { lignes: ['Bonus au sol : ramassez-le vite, il disparaît après ' + UTILITIES.groundSeconds + ' s.'], secondes: 6 };
CONSIGNES.fragments = { lignes: ['Fragments : à dépenser chez le marchand.', 'Ceux qui restent sont perdus à la fin de la partie.'], secondes: 6 };

// ----- A13 / F6 : HUD — bulles au survol, libellés courts, légende de la fiche (Tab) -----
export const HUD_X7 = {
  armes: 'ARMES', // libellé court au-dessus de la rangée des armes
  objets: 'OBJETS', // au-dessus de la colonne des objets
  arme: '{n} · niveau {v}', // bulle d'une case d'arme (« Blaster · niveau 7 »), puis sa phrase
  objet: '{n} ×{v}', // bulle d'une case d'objet (« Bobine Tesla ×3 »), puis « Chance par coup : 14,2 % »
  fragments: ['Fragments : à dépenser chez le marchand.', 'Perdus à la fin de la partie.'],
  puce: ['Puce de l’agent :', 'elle brille plus fort avec vos objets.'],
  legendeTitre: 'Repères du HUD',
  legende: [
    'En bas : vos armes. Le chiffre est leur niveau.',
    'À gauche : vos objets. Le chiffre compte les exemplaires.',
    '◇ en haut à droite : vos fragments, pour le marchand.',
    'Survolez une case pour la lire.',
  ],
};
//#endregion e5:O-noms-guide

//#region e5:N-combat-guide
// Étape 5, suite du guide UX : réglages du combat (ARCHITECTURE.md § E5.N ; Femz, 21/11). Disque du kamikaze plus léger et
// qui ne s'additionne plus, flash d'impact visible sur un robot qui annonce, trait du rôdeur v2 figé dès l'accroupi,
// chrono lisible quand le boss passe dessous, zone de DÉGÂTS du héros réduite (B5), petit répit à la bascule (C10). Les
// valeurs d'origine modifiées le sont ici (ancienne valeur en commentaire) : une seule source, lue par les modules.
export const COMBAT_GUIDE = {
  // Point 6 — disque du kamikaze en mèche : un maillage à lui (hazards.js, disquesKamikaze), dont le shader peint
  // chaque pixel UNE fois (état le plus avancé des disques qui le couvrent) : jamais plus opaque quand ils se
  // superposent. gain : × la couleur des zones (PALETTE.telegraph) ; alpha : opacité de la couche. Avant (§ E5.M) :
  // fond 0,5 × couleur et remplissage 0,95 × couleur, chacun à 0,58 d'opacité, empilés (≈ 0,82 au centre, 1 − 0,42^(2N)
  // pour N kamikazes superposés).
  kamikaze: {
    cap: 32, // disques au plus dans une image (au-delà : omis)
    fond: { gain: 0.75, alpha: 0.24 },
    remplissage: { gain: 1.0, alpha: 0.42 },
    contour: { gain: 2.0, alpha: 0.85, largeur: 0.07 }, // largeur en fraction du rayon (HAZARDS.edge)
  },
  // Point 7 — flash d'impact d'un robot qui annonce (tireur qui vise, kamikaze en mèche) : à lueur g, flash × (1 − g ×
  // part), et seule la tête de sa courbe (E.flash ∈ [1 − court ; 1], ramenée sur [0 ; 1]) : un flash plus court.
  annonce: { part: 0.5, court: 0.5 },
  // Point 8 — rôdeur v2 : le trait (et le bond) gardent le cap pris au début de l'accroupi (§ E5.M : il suivait le joueur)
  rodeur: { figer: true },
  // Point 9 — boss sous le HUD : les blocs du chrono gardent cette opacité (le bloc du boss reste à DANGERS_GUIDE.hud.opacite)
  hud: { opaciteChrono: 0.8, blocsChrono: ['.sr-bloc-vague', '.sr-hud-top > .sr-clock', '.sr-hud-top > .sr-chip-vague', '.sr-bloc-etat', '.sr-palier'] },
  // B5 — rayon de DÉGÂTS du héros (P.rayonDegats) : tirs, explosions, zones, attaques du boss, foreuse, scanner. Le
  // dessin mesuré le 21/11 (silhouette noire, 45 px/m) : Éclaireur 0,55 m de corps de face (0,93 m bras compris),
  // Bastion 0,44 m et Shinobi 0,58 m de profil. PLAYER.radius (0,5) garde décors, déplacement, poussée et coup au contact.
  heros: { rayonDegats: 0.3 },
  // C10 — à chaque bascule à la volée (§ E5.V), s sans nouvelle apparition par la vague ; rien ne s'arrête
  repit: { secondes: 2.5 },
  // Corps du boss (Femz, 21/11) : « juste toucher le corps du boss doit plus mettre de dégât » — il ne blesse que par ses
  // attaques annoncées (frappe, ruée, obus). true : contact rallumé, au rayon de dégâts du héros (enemies.js, BOSS_T).
  boss: { degatsContact: false },
};
DANGERS_GUIDE.annonce.part = COMBAT_GUIDE.annonce.part; // point 7 (était 1, § E5.M)
// Blindés (Femz, 21/11) : « blindé ingame, passé leur shield à −20 % de dégâts » ; de face, bouclier intact × 0,8 (était
// 0,2, § E4.P) ; fissuré × 0,9 (était 0,6 : la fissure garde son effet, dans la même proportion). Anneau d'acier : « faut
// qu'il prenne plein dégâts sinon c'est trop dur » — les blindés de l'anneau (EFLAG.WALL) n'ont pas de bouclier.
Object.assign(ENEMIES.types[ENEMY.BLINDE].shield, { damageMul: 0.8, damageMulFissure: 0.9 });
COMBAT_GUIDE.blinde = { anneauSansBouclier: true };
// Tireurs (Femz, 21/11) : « les canons qui tirent des boules rouges, y'en a trop, et ils s'accumulent » — moitié moins :
// part maximale dans une vague 0,18 → 0,09, croissance par vague 0,5 → 0,25 (base 1,5 inchangée)
Object.assign(ENEMIES.types[ENEMY.TIREUR].weight, { perWave: 0.25, maxShare: 0.09 });
// ----- § E5.X6 (lot 7 de l'audit UX : le jeu dit quand une action est impossible ; Femz 22/11) ---------------------------
// Aucun son neuf : BUY_DENIED adouci (gain < 1 : sonie effective sous −18,6 LU, donc ≤ −19). Un effet chiffré par ligne.
export const ACTIONS_IMPOSSIBLES = {
  // D1 : la case de la Frappe éclair tremble à chaque appui refusé (durée de l'animation CSS sr-x6-tremble-a/b)
  frappe: { trembleS: 0.15 },
  // D2 / D3 / D14 : dash
  dash: {
    tampon: 0.15, // s — un appui fait jusqu'à 0,15 s avant la fin de la recharge part dès qu'elle finit (D3)
    refusGain: 0.5, // × le gain de BUY_DENIED (−6 dB : −24,6 LU)
    refusEcart: 0.4, // s — au plus un clic de refus par 0,4 s (temps simulé)
    pingS: 0.15, // s — l'anneau R1 vire au rouge
    pingGonfle: 0.12, // l'anneau grossit de 12 % au plus pendant le ping
  },
  // D5 / H7 : bandeau du terminal posé
  terminal: {
    approchez: 'approchez-vous', // à la place de la touche, hors de portée
    appelS: 1.5, // s — « approchez-vous » mis en avant après un appui hors de portée
    separateur: ' · ', // « Terminal posé · 24 s »
    unite: ' s',
  },
  // F11 : marchand
  marchand: { manque: 'il manque ' }, // suivi du nombre de fragments manquants
};
// D6 : touche de frappe sans la Frappe éclair — une fois par partie (consignes.js), pas par profil
// (lignes lues à l'apparition de la bulle : le nom de l'arme suit un renommage écrit plus loin dans le fichier)
CONSIGNES.frappe = {
  get lignes() {
    return ['{frappe} : ' + WEAPONS.find((W) => W.id === WEAPON.FLASH).name + ' pas encore obtenue. Elle peut sortir à un niveau ou dans un coffre.'];
  },
  secondes: 3.5,
};
//#endregion e5:N-combat-guide
//#region e5:P-lisibilite-guide
// Étape 5, lot 3 du guide UX : lisibilité en fin de partie chargée (ARCHITECTURE.md § E5.P ; audit
// docs/audit-guide/B-rapport.md B1, B2, B15, B16, B18). Repère du héros dans la foule, rien d'allié sur lui, chiffres
// hiérarchisés, gemmes moins voyantes, débris plafonnés, ricochet magenta. Les valeurs d'origine modifiées le sont ici
// (ancienne valeur en commentaire) : une seule source, lue par les modules.
export const LISIBILITE_GUIDE = {
  // B1 — silhouette du héros dans la foule (src/silhouette-heros.js ; Femz, 21/11 : « retire le repère », « 1 silhouette »).
  // Le corps du héros (même géométrie et même squelette que lui) redessiné en aplat de l'accent de l'agent PAR-DESSUS
  // tout — robots, effets, chiffres —, sans test de profondeur, seulement dans la foule. La silhouette « là où il est
  // masqué par un robot » (ANIM.heros.xrayShade, heros-anim.js) reste hors de la foule.
  silhouette: {
    actif: true,
    gain: 1.1, // × l'accent de l'agent (AGENTS[].accent) : plat, à peine lumineux (sous le seuil du bloom)
    opacite: 1, // aplat opaque (le fondu d'entrée et de sortie passe par l'alpha)
    foule: { rayon: 3, entre: 12, sort: 8, tenue: 1 }, // m ; robots pour l'allumer ; sous ce nombre pendant tenue s : éteinte
    fonduEntree: 0.15, // s
    fonduSortie: 0.5, // s
  },
  // B1 — atténuation des effets alliés autour du héros : distance À L'ÉCRAN au centre du héros (hauteur `centre`).
  // part gardée sous r0, rampe linéaire jusqu'à 1 à r1. vfx : intensité des 5 lots (sauf tirs ennemis et réticule) ;
  // fx : taille des étincelles alliées et des éclats des robots ; lumiere (Femz, 21/11 : « oui ») : taches de lumière au
  // sol des effets alliés et des explosions (rendu/lumieres.js, vraies lumières comprises) et halo du bloom (passe
  // finale) — jamais les tirs ennemis, les zones annoncées ni leurs lumières.
  autour: { actif: true, centre: 0.9, r0: 1.4, r1: 2.2, partVfx: 0.3, partFx: 0.4, partLumiere: 0.4 }, // lus au chargement, sauf actif
  // B2 — chiffres de dégâts (pas de réglage pour les couper : Femz, 21/11, « non »)
  chiffres: {
    max: 10, // chiffres de dégâts affichés en même temps au plus (les soins ne comptent pas)
    ageMinRemplace: 0.25, // s — un chiffre plus jeune n'est jamais remplacé par un plus gros coup
    ecart: 0.6, // écart horizontal minimal entre deux chiffres d'une même ligne, en hauteurs de chiffre
    zone: 2, // m d'écran — demi-côté du carré interdit aux chiffres autour du centre du héros (couloir du joueur)
  },
  // B16 — éclats des robots (fx.spawnDebris) : au-delà de `seuil` morts/s (moyenne glissante de `fenetre` s), éclats
  // par mort × seuil / taux et vie × vie ; jamais plus de `plafond` éclats vivants (la purge garde son budget).
  eclats: { seuil: 25, fenetre: 0.5, vie: 0.6, plafond: 240 },
};
// B2 — couloir du joueur élargi en carré de LISIBILITE_GUIDE.chiffres.zone m autour de son centre (fx.settle) :
// clearSide 0,6 → 2 ; clearBelow 0,3 et clearAbove 0,5 → 2 − la demi-hauteur du héros à l'écran (1,8 × cos de
// l'inclinaison par défaut, 45° « Moyenne » : 0,64 m) ; aux autres inclinaisons, le carré bouge de ± 0,1 m.
{
  const demi = (PLAYER.height * Math.cos((CAMERA.pitchDeg * Math.PI) / 180)) / 2;
  FX.numbers.clearSide = LISIBILITE_GUIDE.chiffres.zone; // était 0,6
  FX.numbers.clearBelow = LISIBILITE_GUIDE.chiffres.zone - demi; // était 0,3
  FX.numbers.clearAbove = LISIBILITE_GUIDE.chiffres.zone - demi; // était 0,5
  // regroupement élargi dès 8 nombres affichés (était 12) : sous le plafond de 10, une horde arrosée se regroupe avant
  // que les plus petits coups ne soient masqués
  FX.numbers.crowdCount = 8;
}
// B15 — gemmes : reflets sous le genou du bloom (seuil 1,7 − genou 0,4), facettes plus sombres, tache au sol ÷ 3
PICKUPS.emissiveBoost = 1.2; // était 1,7
PICKUPS.facets.base = 0.75; // était 1,0
PEINT.taches.butin.intensite = 0.2; // était 0,6
// B18 — ricochet magenta franc (loin du rouge des tirs ennemis), braises de la pompe finissant orange
VFX_COULEURS.bord[WEAPON.RICOCHET] = [1.0, 0.03, 0.85]; // était [1,0, 0,05, 0,3] (rose vif)
VFX_COULEURS.chaud[WEAPON.RICOCHET] = [1.0, 0.8, 0.98]; // était [1,0, 0,78, 0,9]
PALETTE.weapon[WEAPON.RICOCHET] = 0xff3de6; // était 0xff5fa8
VFX_COULEURS.fin[WEAPON.SHOTGUN] = [0.75, 0.16, 0.01]; // était [0,6, 0,03, 0,01] (rouge)
//#endregion e5:P-lisibilite-guide

//#region e5:Q-retours-guide
// Étape 5, suite du guide UX : retours et fin de partie (ARCHITECTURE.md § E5.Q ; audit du guide, lot 5 : C2, B13, B14).
// Cause de chaque coup reçu (écran « Hors service »), retour propre au soin du héros, un son d'annonce par attaque.

// ----- C2 : causes des coups reçus (damage.hitPlayer, 5e argument ; damage.explode, dernier argument) -----
// CONTACT + type de robot (1 à 11) : coup au corps à corps ; les autres : une attaque nommée.
export const CAUSE = Object.freeze({
  AUCUNE: 0,
  CONTACT: 1, // + ENEMY.* (1 à 11)
  BOND: 12, // rôdeur v2
  PIQUE: 13, // drone v2
  CHARGE: 14, // blindé v2
  TIR: 15, // tireur
  OBUS_TIREUR: 16, // tireur v3 (HAZ.STRIKE)
  EXPLOSION: 17, // kamikaze
  FLAQUE: 18, // drone v3 (HAZ.PUDDLE)
  MINE: 19, // poseur (HAZ.MINE)
  FOREUSE: 20, // la foreuse resurgit sous le joueur
  SCANNER_CHUTE: 21,
  SCANNER_LASER: 22,
  BOSS_FRAPPE: 23,
  BOSS_RUEE: 24,
  BOSS_OBUS: 25,
  BOSS_BALAYAGE: 26,
  TRAINEE_ELITE: 27, // élite Surchargé (HAZ.SPARK)
  OBUS_ELITE: 28, // élite Instable, à sa mort (HAZ.STRIKE)
  FRAPPE_ORBITALE: 29, // événement (HAZ.ORBITAL)
  CAPSULE: 30, // événement ravitaillement : la capsule tombe
});
export const CAUSE_COUNT = 31;
// Groupes du « le plus de dégâts » : les types de robot (ENEMY.*, 0 à 10), puis élites, événements, autres
export const CAUSE_GROUPE_ELITES = ENEMY_COUNT;
export const CAUSE_GROUPE_EVENEMENTS = ENEMY_COUNT + 1;
export const CAUSE_GROUPE_AUTRES = ENEMY_COUNT + 2;
export const CAUSE_GROUPE_COUNT = ENEMY_COUNT + 3;
const nomRobotQ = (t) => (t === ENEMY.BOSS ? 'Boss ' + ENEMIES.types[t].name : ENEMIES.types[t].name); // « Boss Overclock »
const nomEliteQ = (k) => {
  const n = ELITES.mods.find((m) => m.key === k).name; // 'SURCHARGÉ' → 'Surchargé'
  return 'Élite ' + n.charAt(0) + n.slice(1).toLowerCase();
};
const nomEvenementQ = (k) => {
  const n = EVENTS.types.find((e) => e.key === k).label;
  return n.charAt(0) + n.slice(1).toLowerCase();
};
export const RETOURS_GUIDE = {
  // Écran de fin : deux lignes, un effet par ligne (« Détruit par : Kamikaze (explosion) », « Le plus de dégâts : Tireurs 42 % »)
  textes: { detruit: 'Détruit par : ', plus: 'Le plus de dégâts : ' },
  // Noyau, onglet Collection, fiche d'un robot rencontré (Femz, 21/11 : morts par cause gardées d'une partie à l'autre) :
  // une ligne sous « N détruits » — les parties perdues sur un coup de ce robot, toutes attaques confondues
  noyau: { avant: 'Vous a mis hors service : ', apres: ' fois' },
  // [groupe, robot ou source, attaque] par cause ; le texte affiché = « source (attaque) »
  causes: [],
  groupes: [], // nom pluriel de chaque groupe
  // B14 — soin du héros (src/soin-heros.js) : au plus une fois par `fenetre` s (0,35 : ≤ 3 Hz, rien ne clignote), si le
  // cumul atteint `seuil` PV, lueur verte du corps (`lueur`, éteinte en `duree` s ; l'invulnérabilité et le dash, cyan,
  // passent devant), « +N » vert, éclat de la barre de PV (`barre.secondes`). La régénération continue ne passe pas par là.
  soin: { fenetre: 0.35, seuil: 1, lueur: 0.85, duree: 0.45, couleur: PALETTE.eyeReparateur, barre: { secondes: 0.5 } },
};
{
  const C = RETOURS_GUIDE.causes;
  C[CAUSE.AUCUNE] = [CAUSE_GROUPE_AUTRES, '', ''];
  for (let t = 0; t < ENEMY_COUNT; t++) C[CAUSE.CONTACT + t] = [t, nomRobotQ(t), 'contact'];
  C[CAUSE.BOND] = [ENEMY.RODEUR, nomRobotQ(ENEMY.RODEUR), 'bond'];
  C[CAUSE.PIQUE] = [ENEMY.DRONE, nomRobotQ(ENEMY.DRONE), 'piqué'];
  C[CAUSE.CHARGE] = [ENEMY.BLINDE, nomRobotQ(ENEMY.BLINDE), 'charge'];
  C[CAUSE.TIR] = [ENEMY.TIREUR, nomRobotQ(ENEMY.TIREUR), 'tir'];
  C[CAUSE.OBUS_TIREUR] = [ENEMY.TIREUR, nomRobotQ(ENEMY.TIREUR), 'obus'];
  C[CAUSE.EXPLOSION] = [ENEMY.KAMIKAZE, nomRobotQ(ENEMY.KAMIKAZE), 'explosion'];
  C[CAUSE.FLAQUE] = [ENEMY.DRONE, nomRobotQ(ENEMY.DRONE), 'flaque électrique'];
  C[CAUSE.MINE] = [ENEMY.POSEUR, nomRobotQ(ENEMY.POSEUR), 'mine'];
  C[CAUSE.FOREUSE] = [ENEMY.FOREUSE, nomRobotQ(ENEMY.FOREUSE), 'sortie du sol'];
  C[CAUSE.SCANNER_CHUTE] = [ENEMY.SCANNER, nomRobotQ(ENEMY.SCANNER), 'chute'];
  C[CAUSE.SCANNER_LASER] = [ENEMY.SCANNER, nomRobotQ(ENEMY.SCANNER), 'laser'];
  C[CAUSE.BOSS_FRAPPE] = [ENEMY.BOSS, nomRobotQ(ENEMY.BOSS), 'frappe au sol'];
  C[CAUSE.BOSS_RUEE] = [ENEMY.BOSS, nomRobotQ(ENEMY.BOSS), 'ruée'];
  C[CAUSE.BOSS_OBUS] = [ENEMY.BOSS, nomRobotQ(ENEMY.BOSS), 'obus'];
  C[CAUSE.BOSS_BALAYAGE] = [ENEMY.BOSS, nomRobotQ(ENEMY.BOSS), 'balayage laser'];
  C[CAUSE.TRAINEE_ELITE] = [CAUSE_GROUPE_ELITES, nomEliteQ('surcharge'), 'traînée électrique'];
  C[CAUSE.OBUS_ELITE] = [CAUSE_GROUPE_ELITES, nomEliteQ('instable'), 'obus'];
  C[CAUSE.FRAPPE_ORBITALE] = [CAUSE_GROUPE_EVENEMENTS, nomEvenementQ('frappe'), ''];
  C[CAUSE.CAPSULE] = [CAUSE_GROUPE_EVENEMENTS, 'Capsule de ravitaillement', 'chute'];
  const G = RETOURS_GUIDE.groupes;
  for (let t = 0; t < ENEMY_COUNT; t++) G[t] = t === ENEMY.BOSS ? nomRobotQ(t) : nomRobotQ(t) + 's'; // « Tireurs »
  G[CAUSE_GROUPE_ELITES] = 'Élites';
  G[CAUSE_GROUPE_EVENEMENTS] = 'Événements';
  G[CAUSE_GROUPE_AUTRES] = 'Autres';
}
/** Groupe (Uint8) et texte (« Kamikaze (explosion) ») de chaque cause, construits au chargement. */
export const CAUSE_GROUPE = Uint8Array.from(RETOURS_GUIDE.causes, (c) => c[0]);
export const CAUSE_TEXTE = RETOURS_GUIDE.causes.map((c) => (c[2] ? c[1] + ' (' + c[2] + ')' : c[1]));

// ----- B13 : un son d'annonce par attaque (fichiers : découpes TRANSPOSÉES de la banque « sfx game » de Femz,
// outils/preparer_sons.py — CANDIDATS à faire valider). La frappe du boss garde BOSS_TELEGRAPH (« Attaque au sol
// annoncée »). Niveaux : sonie effective = celle de BOSS_TELEGRAPH pour le boss, ≈ 2 dB sous le tir pour la visée. -----
AUDIO.sounds[SFX.BOSS_ANNONCE_RUEE] = { dur: 0.7, gain: 0.24, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.BOSS_ANNONCE_OBUS] = { dur: 0.6, gain: 0.24, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.BOSS_ANNONCE_INVOCATION] = { dur: 0.8, gain: 0.24, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.BOSS_ANNONCE_BALAYAGE] = { dur: 0.8, gain: 0.24, minInterval: 0.2, maxVoices: 1, pitchVar: 0, priority: 2 };
// visée du tireur : une voix, 0,35 s au moins entre deux (une meute de tireurs ne fait pas un bourdon), priorité 0 (bruit
// de combat : jamais au détriment d'une arme ou d'une alarme), atténuée avec la distance comme ENEMY_SHOT
AUDIO.sounds[SFX.TIREUR_VISEE] = { dur: 0.25, gain: 0.08, minInterval: 0.35, maxVoices: 1, pitchVar: 1, priority: 0 };
// Décisions de Femz (21/11), fichiers de SA banque (outils/preparer_sons.py) : les obus des robots et la frappe orbitale
// annoncent avec « Sound Response - Cyber Weapons - Sci Fi Assault Rifle One Shot » (au niveau de BOSS_TELEGRAPH, qu'ils
// jouaient) ; le soin du héros sonne « Airborne Sound - Video game modern game-play accent bonus », discret (≈ −27 LU,
// entre la gemme et le soin du réparateur), au plus une fois par signal de src/soin-heros.js (≤ 3 par seconde)
AUDIO.sounds[SFX.ANNONCE_OBUS_ROBOT] = { dur: 0.8, gain: 0.24, minInterval: 0.2, maxVoices: 2, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.SOIN_HEROS] = { dur: 0.7, gain: 0.1, minInterval: 0.3, maxVoices: 1, pitchVar: 0, priority: 1 };
// § E5.Q ter (Femz, 21/11) : les moments encore muets, fichiers choisis par Femz (outils/preparer_sons.py, niveaux
// relatifs dans NIVEAU_REL). Annonce au sol : une voix, 0,25 s au moins entre deux (les drones piquent par dizaines).
AUDIO.sounds[SFX.ANNONCE_SOL] = { dur: 0.5, gain: 0.08, minInterval: 0.25, maxVoices: 1, pitchVar: 0, priority: 0 };
AUDIO.sounds[SFX.TERMINAL] = { dur: 1.2, gain: 0.24, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.RAVITAILLEMENT] = { dur: 2.0, gain: 0.24, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.PANNE] = { dur: 2.5, gain: 0.3, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.ANNEAU] = { dur: 3.7, gain: 0.2, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.CLIC_DEPLACEMENT] = { dur: 0.08, gain: 0.04, minInterval: 0.08, maxVoices: 1, pitchVar: 0, priority: 2 };
AUDIO.sounds[SFX.ESSAIM] = { dur: 2.0, gain: 0.2, minInterval: 1, maxVoices: 1, pitchVar: 0, priority: 2 };
// Objet Éclats (Femz, 21/11 ; pas encore branchés : branche eclats) : jusqu'à 4 impacts presque ensemble — 2 voix au plus,
// 0,06 s entre deux départs (net et discret : ≤ −26 LU ensemble) ; variantes de hauteur au hasard (AUDIO.files.hasard)
AUDIO.sounds[SFX.ECLAT_PROJECTION] = { dur: 0.6, gain: 0.08, minInterval: 0.15, maxVoices: 1, pitchVar: 0, priority: 1 };
AUDIO.sounds[SFX.ECLAT_IMPACT] = { dur: 0.7, gain: 0.06, minInterval: 0.06, maxVoices: 2, pitchVar: 0, priority: 1 };
AUDIO.files.hasard = (AUDIO.files.hasard || []).concat([SFX.ECLAT_IMPACT]);
// § E5.Q ter (Femz, 21/11 : « la tonalité des sfx ne doit pas clasher avec la musique ») — série des gemmes : la gemme
// (accordée sur sol, notes sol et do) monte par les seules transpositions qui gardent ses deux notes dans la gamme commune
// aux pistes (do, mi♭, fa, sol, la♭, si♭ : outils/accorder_sons.py) — sol, si♭, do, mi♭, fa, sol, si♭ (+15 demi-tons au
// sommet ; avant : 14 marches d'un demi-ton, chromatiques) ; au sommet elle redescend de 5 marches (do, la note qui suit
// si♭, une octave plus bas) et continue de monter. Avant : { stepSemitones: 1, maxSteps: 14, loopSteps: 12 }.
Object.assign(AUDIO.gem, { degres: [0, 3, 5, 8, 10, 12, 15], maxSteps: 6, loopSteps: 5 });
//#endregion e5:Q-retours-guide

//#region e5:Y-eclats
// Étape 5 — Éclats visibles (ARCHITECTURE.md § E5.Y ; Femz, 21/11 : « on voit pas d'animation de projection d'éclats entre
// les robots, et j'aime pas son sfx »). Chaque éclat VOLE du robot mort vers sa cible (style VFX_STYLE.ECLAT à la suite du
// lot TIRS, aucun appel de dessin de plus) ; le coup tombe à l'arrivée. Couleurs LINÉAIRES, toutes sous le seuil du bloom
// (1,35) : pas de halo, le métal se lit par sa facette claire et son liseré sombre.
export const ECLATS = {
  cap: 64, // fragments en vol au plus (pool préalloué) ; pool plein : le coup tombe tout de suite, sans vol (jamais perdu)
  vitesse: 24, // m/s — durée du vol = volBase + d / vitesse, bornée à [volMin ; volMax]
  volBase: 0.05, // s
  volMin: 0.12, // s
  volMax: 0.25, // s (5 m de portée → 0,25 s)
  hauteur: 1.0, // m — départ et arrivée (celle des tirs et des étoiles des objets)
  bosse: 0.45, // m — hauteur de la cloche au milieu du vol, + bosseParM × distance (passe au-dessus de l'explosion de la mort)
  bosseParM: 0.1,
  courbe: 0.25, // m — écart latéral au milieu du vol, alterné d'un éclat à l'autre
  taille: 0.28, // m — rayon du fragment (pointe avant à 1 × taille ; planche du 21/11 : à 0,2 il se perdait sur le sol clair)
  marge: 0.46, // m — demi-largeur du quad (le fragment tourne : ≥ 1,2 × taille)
  traine: 0.8, // m — longueur max de la traînée
  tour: 24, // rad/s — le fragment tournoie
  metal: [0.93, 1.04, 1.19], // facette claire : 0xaeb7c2 en linéaire (0,423 ; 0,474 ; 0,540) × 2,2 (I = 1,19 < 1,35)
  ombre: [0.14, 0.2, 0.42], // facette d'ombre : acier bleuté sombre (ton sombre saturé du look pixel)
  // Liseré : acier bleu SATURÉ (ton « couleur » du look pixel, sous le seuil) — mesuré le 21/11 : un liseré sombre ne
  // se lit pas sur le sol clair (le mélange du look garde 65 % du fond : rien ne peut y être vraiment sombre)
  liser: [0.32, 0.55, 1.0],
  // Reflet : petit point chaud vers la pointe, SEUL au-dessus du seuil du bloom (intensité 2,6 : ton « cœur ») — sans
  // lui le fragment disparaît sur le sol clair (planche du 21/11). 0 = aucun halo (à trancher par Femz).
  reflet: 2.6,
  traineCouleur: [0.32, 0.55, 1.0], // traînée : acier bleu saturé, clair près du fragment, sombre au bout
  etoile: 0.8, // rayon de l'éclat d'étoile à l'impact, en VFX.etoile.arc (l'ancienne étoile, STAR_SMALL)
  // Sons (Femz, 21/11 : deux sons, fabriqués sur une autre branche — SFX.ECLAT_PROJECTION et SFX.ECLAT_IMPACT — et reliés
  // ici à la fusion ; −1 = aucun). projection : une fois par robot qui projette ; impact : à chaque fragment qui TOUCHE,
  // au plus un toutes les `impactEcart` s (temps simulé : 4 impacts groupés ne font pas 4 sons empilés).
  son: { projection: SFX.ECLAT_PROJECTION, impact: SFX.ECLAT_IMPACT, impactEcart: 0.05 }, // reliés à la fusion (Femz, 22/11)
};
// Couleur de l'étoile d'impact : une ligne de VFX_COULEURS à la couleur de l'objet (après les 6 armes de N, § E3.N)
ECLATS.couleur = VFX_COULEURS.bord.length;
VFX_COULEURS.bord.push([0.423, 0.474, 0.54]);
VFX_COULEURS.chaud.push([0.9, 0.94, 1.0]);
VFX_COULEURS.fin.push([0.2, 0.26, 0.4]);
//#endregion e5:Y-eclats
//#region e5:AC-contact
// Étape 5 — contact logique (ARCHITECTURE.md § E5.AC ; Femz, 22/11 : « mêlée = vrai coup, distance = rien », « pas de
// compensation »). Les robots à distance ou de soutien ne blessent plus au contact (ils restent solides) ; les robots de
// mêlée arment un coup VISIBLE : fente vers le joueur, dégâts au sommet, éclair d'impact et son. Manœuvres v2 inchangées.
COMBAT_GUIDE.contact = {
  // Types sans dégâts au contact (leurs attaques annoncées restent : tirs, laser, mines, sortie de la foreuse, explosion)
  sansContact: [ENEMY.TIREUR, ENEMY.SCANNER, ENEMY.POSEUR, ENEMY.REPARATEUR, ENEMY.FOREUSE, ENEMY.KAMIKAZE],
  preparation: 0.12, // s — du début de la fente à son sommet, où tombent les dégâts (0 : ancien chemin, coup immédiat)
  retour: 0.12, // s — retour de la fente après le sommet (coup porté ou raté)
  avance: 0.25, // m — déplacement dessiné du robot vers le joueur au sommet (rendu seul : la simulation ne bouge pas)
  inclinaison: 0.24, // rad — penché vers l'avant au sommet (marche du rôdeur : 0,12)
  portee: 0.3, // m — au sommet, le coup porte si la distance des centres < rayons + portee
  maintien: 0.04, // s — héros invulnérable pour moins que ça au sommet : la fente est tenue, le coup part à la fin
  // Son du coup PORTÉ — provisoire, Femz choisira : coup sourd métallique des Éclats (un poing de robot sur une coque),
  // × gain (sonie effective ≈ −23 LU, sous PLAYER_HURT), au plus un toutes les `ecart` s (temps simulé). −1 = aucun.
  son: { id: SFX.ECLAT_IMPACT, gain: 2, ecart: 0.25 },
};
//#endregion e5:AC-contact

//#region fondation:formules
// =====================================================================================================
// FORMULES DU CAHIER — fonctions pures, source unique pour les modules et les tests.
// =====================================================================================================

/** Nombre de robots de la vague n (hors boss) selon le cahier : 20 + 12 × n. */
export function waveEnemyCount(n) {
  return WAVES.baseCount + WAVES.perWave * n;
}

/** Robots réellement émis par la vague n, hors boss : la formule, × escortFraction sur une vague de boss. */
export function waveRobotCount(n) {
  return Math.round(waveEnemyCount(n) * (isBossWave(n) ? WAVES.boss.escortFraction : 1));
}

/** Multiplicateur de PV de la vague n : 1 + 0,12 × (n − 1). */
export function waveHpMul(n) {
  return 1 + WAVES.hpGrowth * (n - 1);
}

/** Multiplicateur de dégâts de la vague n : 1 + 0,12 × (n − 1). */
export function waveDmgMul(n) {
  return 1 + WAVES.dmgGrowth * (n - 1);
}

/** La vague n a-t-elle un boss ? (5, 10, 15…) */
export function isBossWave(n) {
  return n > 0 && n % BOSS.every === 0;
}

/** Rang du boss de la vague n : 1 à la vague 5, 2 à la vague 10… (au moins 1, même hors vague de boss : debug). */
export function bossRank(n) {
  return Math.max(1, Math.floor(n / BOSS.every));
}

/** Multiplicateur de PV du boss de la vague n : celui de la vague × (1 + tierHpMul × (rang − 1)). */
export function bossHpMul(n) {
  return waveHpMul(Math.max(1, n)) * (1 + BOSS.tierHpMul * (bossRank(n) - 1));
}

/**
 * Mutations du boss de rang donné (§ E1.D), pure : écrit les BMUT_COUNT cases de `out` (index BMUT.*) et le renvoie.
 * Rangs 1 à BOSS.ranks.length : la ligne de BOSS.ranks. Au-delà (s = rang − BOSS.ranks.length) : même ligne que le
 * dernier rang, invocations + summonPerRank × s (sans plafond), drones-boucliers, rayons, seuil d'enragement et
 * recharges bornés par BOSS.mutation. PV et dégâts montent par bossHpMul et waveDmgMul, sans plafond.
 */
export function bossMutations(rank, out) {
  const R = BOSS.ranks;
  const M = BOSS.mutation;
  const r = rank < 1 ? 1 : Math.floor(rank);
  const base = R[(r < R.length ? r : R.length) - 1];
  const s = r > R.length ? r - R.length : 0;
  out[BMUT.BEAMS] = base.sweep ? Math.min(M.sweepBeamsMax, 1 + Math.floor(s / 2)) : 0;
  out[BMUT.SUMMON_TYPE] = base.summonType !== undefined ? base.summonType : BOSS.attacks.summon.type;
  out[BMUT.SUMMON_COUNT] = BOSS.attacks.summon.count + M.summonPerRank * s;
  out[BMUT.DRONES] = base.shieldDrones ? Math.min(M.shieldDronesMax, base.shieldDrones + s) : 0;
  out[BMUT.MORTAR_P1] = base.mortarPhase1 ? 1 : 0;
  out[BMUT.ENRAGE_AT] = base.enrage ? Math.min(M.enrageAtMax, BOSS.enrage.at + M.enrageAtStep * s) : 0;
  out[BMUT.CD_MUL] = Math.max(M.cooldownFloor, Math.pow(M.cooldownMul, s));
  return out;
}

/** Prix du cran suivant de la surcharge de l'arme (§ E1.D) : `level` = crans déjà achetés (0, 1, 2…). */
export function overchargeCost(weapon, level) {
  const O = SHOP.overcharge;
  return Math.round(WEAPONS[weapon].upgradeBase * O.costMul * Math.pow(O.growth, level));
}

/** Prix soldé d'une offre de boutique (§ E1.D). */
export function salePrice(cost) {
  return Math.round(cost * (1 - SHOP.sale.discount));
}

/** Fragments lâchés par le boss de la vague n. */
export function bossFragments(n) {
  return BOSS.loot.fragments + BOSS.loot.fragmentsPerTier * (bossRank(n) - 1);
}

/** XP requise pour passer du niveau `level` au suivant : round(100 × level^1,5). */
export function xpForLevel(level) {
  return Math.round(PROGRESSION.xpBase * Math.pow(level, PROGRESSION.xpExponent));
}

/** Prix de l'amélioration de la stat `stat` de l'arme `weapon`, du niveau `level` (1 à 4) au suivant. −1 si max. */
export function upgradeCost(weapon, stat, level) {
  if (level < 1 || level >= STAT_MAX_LEVEL) return -1;
  return Math.round(WEAPONS[weapon].upgradeBase * WEAPON_COSTS.statCostMul[stat] * Math.pow(WEAPON_COSTS.growth, level));
}

/**
 * Délai (s) avant qu'un même robot puisse être retouché par les disques orbitaux : un coup par passage de
 * disque. `count` et `rate` sont les stats EFFECTIVES (disques, tours par seconde).
 */
export function orbitalHitDelay(count, rate) {
  return WEAPONS[WEAPON.ORBITALS].hitFactor / (count * rate);
}

/** Durée (s) sur laquelle la vague n émet ses robots après la salve initiale. (Plus lue par waves.js depuis l'étape 1.) */
export function waveSpawnDuration(n) {
  return Math.min(WAVES.spawn.durationMax, WAVES.spawn.durationBase + WAVES.spawn.durationPerWave * n);
}

// ----- Étape 1 du plan addictif (§ E1.A) : vagues au chrono -----

/** Durée (s) du chrono de la vague n : 30, 35, … 60 dès la vague 7. */
export function waveClockSeconds(n) {
  return Math.min(WAVES.clock.max, WAVES.clock.base + WAVES.clock.perWave * (n - 1));
}

/** Minimum de robots en vie pendant la vague n : sous ce nombre, la vague complète aussitôt. */
export function waveMinAlive(n) {
  return Math.min(WAVES.maxAlive, Math.round(waveRobotCount(n) * WAVES.clock.minAliveFraction));
}

/** Robots de complément AVEC butin pendant la vague n (§ E1.S, règle 4 bis) ; au-delà ils portent EFLAG.NO_LOOT. */
export function waveComplementLoot(n) {
  return Math.round(waveRobotCount(n) * WAVES.clock.complementLootMul);
}

/** Intervalle (s) entre deux grappes de la vague n : l'effectif nominal, moins l'ouverture, réparti sur le chrono. */
export function waveSpawnInterval(n) {
  const rest = waveRobotCount(n) - waveMinAlive(n);
  const cluster = (WAVES.spawn.clusterMin + WAVES.spawn.clusterMax) / 2;
  const t = rest > 0 ? (cluster * waveClockSeconds(n)) / rest : WAVES.clock.intervalMax;
  return Math.min(WAVES.clock.intervalMax, Math.max(WAVES.clock.intervalMin, t));
}

// ----- Étape 1 du plan addictif (§ E1.B) : révisions des robots -----

/** Révision du type à la vague n : nombre d'entrées de ENEMIES.revisions de ce type dont wave ≤ n (0 = v1, 1 = v2, 2 = v3). */
export function enemyRevision(type, wave) {
  const R = ENEMIES.revisions;
  let r = 0;
  for (let k = 0; k < R.length; k++) if (R[k].type === type && R[k].wave <= wave) r++;
  return r;
}

/** Entrée de ENEMIES.revisions annoncée à la vague n (la vague où elle arrive), ou null. */
export function revisionAtWave(wave) {
  const R = ENEMIES.revisions;
  for (let k = 0; k < R.length; k++) if (R[k].wave === wave) return R[k];
  return null;
}
/**
 * Événement de vague (§ E1.C), pure. r1, r2 : les deux tirages de randEvent() de la vague ; prevHad : la vague
 * précédente avait un événement ; lastType : indice (EVENTS.types) du dernier événement, −1 si aucun. Renvoie l'indice
 * de l'événement de la vague n, ou −1. Jamais avant EVENTS.firstWave ni sur une vague de boss ; garanti si la vague
 * précédente n'en avait pas, sinon tiré à EVENTS.chance ; jamais le même que le dernier.
 */
export function eventForWave(n, r1, r2, prevHad, lastType) {
  if (n < EVENTS.firstWave || isBossWave(n)) return -1;
  if (prevHad && !(r1 < EVENTS.chance)) return -1;
  const types = EVENTS.types;
  let candidates = 0;
  for (let k = 0; k < types.length; k++) if (n >= types[k].minWave && k !== lastType) candidates++;
  if (candidates === 0) return -1;
  let pick = Math.floor(r2 * candidates);
  if (pick >= candidates) pick = candidates - 1;
  for (let k = 0; k < types.length; k++) {
    if (n < types[k].minWave || k === lastType) continue;
    if (pick === 0) return k;
    pick--;
  }
  return -1;
}

/** Entrée de EVENTS.types de clé donnée (erreur si elle n'existe pas). */
export function eventType(key) {
  const types = EVENTS.types;
  for (let k = 0; k < types.length; k++) if (types[k].key === key) return types[k];
  throw new Error('événement inconnu : ' + key);
}

/** Drones de l'essaim en transit à la vague n : countMin + countPerWave par vague après EVENTS.firstWave, plafonné. */
export function eventSwarmCount(n) {
  const T = eventType('essaim');
  const c = T.countMin + T.countPerWave * Math.max(0, n - EVENTS.firstWave);
  return c > T.countMax ? T.countMax : c;
}

/** Fragments d'une capsule de ravitaillement ouverte à la vague n. */
export function eventSupplyFragments(n) {
  const T = eventType('ravitaillement');
  return T.fragments + T.fragmentsPerWave * Math.max(0, n - EVENTS.firstWave);
}
//#endregion fondation:formules

//#region reglages-femz
// Paramètres (Femz, 21/11) : « graphisme, sfx, musique », secousses « on / off plus simple ». Graphismes : Auto =
// qualité adaptative (render.js, § G.6) ; les autres imposent un niveau de RENDER.quality (0 le meilleur, 3 sans bloom).
export const REGLAGES = {
  graphismes: [
    { key: 'auto', label: 'Auto', niveau: -1 },
    { key: 'elevee', label: 'Élevée', niveau: 0 },
    { key: 'moyenne', label: 'Moyenne', niveau: 2 },
    { key: 'basse', label: 'Basse', niveau: 3 },
  ],
  graphismesDefaut: 'auto',
  pauseSurFocus: true, // § E5.S (A18) : fenêtre qui perd le focus en partie → pause (solo)
  confirmerSecondes: 3, // § E5.S (A6) : délai du 2e clic de « Recommencer » / « Quitter la partie »
  secousses: [
    { key: 'avec', label: 'Avec', on: true },
    { key: 'sans', label: 'Sans', on: false },
  ],
  // Déplacement : Souris = caméra derrière l'agent (§ E5.AB, Femz 22/11 : la souris tourne la caméra, ZQSD en axes de la
  // caméra) ; avant (20/11 et 21/11 : « souris LoL oui ») : clic droit au sol → le héros y va
  // § E5.AB.14 (Femz, 22/11) : libellés qui se comprennent seuls — « Caméra libre » (la souris tourne la caméra, mode de
  // base) et « Vue fixe » (ZQSD + clic droit façon LoL, caméra ortho fixe) ; clés gardées (réglages enregistrés)
  deplacement: [
    { key: 'souris', label: 'Caméra libre' },
    { key: 'clavier', label: 'Vue fixe' },
  ],
  deplacementDefaut: 'souris', // § E5.AB.13 (Femz, 22/11 : « Souris par défaut ») — avant : 'clavier' ; un réglage enregistré l'emporte
  deplacementDefautDebug: 'clavier', // § E5.AB.13 : ?debug (tests) — les tests écrits pour l'ortho et le clavier restent valables
  // § E5.X5 (audit C12 / E11, Femz 22/11 « go pour les flashs ») : photosensibilité — Réduits = rien ne clignote plus vite
  // que CONFORT_FLASHS.hzMax, flash blanc des coups atténué, arrêts sur image raccourcis
  flashs: [
    { key: 'normaux', label: 'Normaux' },
    { key: 'reduits', label: 'Réduits' },
  ],
  flashsDefaut: 'normaux',
  // § E5.R : une ligne d'aide sous chaque réglage de la fenêtre Paramètres (comprise au 1er lancement)
  aides: {
    flashs: 'Réduits : rien ne clignote vite, flashs des coups adoucis (sensibilité à la lumière).',
    graphismes: 'Auto règle la qualité selon votre machine.',
    deplacement: 'La souris tourne la caméra, ZQSD pour avancer.', // § E5.AB.13 : remplacée au choix par deplacementSouris / deplacementClavier (avant : « Souris : clic droit pour avancer, maintenu pour suivre. Le dash part vers le curseur. »)
    deplacementSouris: 'La souris tourne la caméra, ZQSD pour avancer.', // § E5.AB.13 (Femz, 22/11) : l'aide décrit SEULEMENT l'option choisie
    deplacementClavier: 'ZQSD ou clic droit pour avancer, la caméra reste fixe.', // § E5.AB.14 (avant : « ZQSD pour avancer, votre agent regarde où il va. »)
    secousses: 'Tremblements de l\u2019écran aux explosions et aux coups.',
    camera: 'Inclinaison de la vue.',
    volume: 'Tout le son du jeu.',
    sfx: 'Tirs, impacts, interface.',
    musique: 'La bande-son.',
  },
  libelles: { graphismes: 'Graphismes', secousses: 'Secousses', flashs: 'Flashs', deplacement: 'Déplacement', volume: 'Volume général', sfx: 'Effets sonores', musique: 'Musique' },
  // § E5.AB.14 : le clic pour avancer façon LoL du mode « Vue fixe » (rétabli, Femz 22/11)
  souris: {
    arrivee: 0.35, // m — le héros s'arrête à cette distance du point visé (au pas d'une image, il ne tremble pas autour)
    dashMin: 0.6, // m — curseur plus près du héros que ça : le dash garde la direction de la marche
    // repère du clic au sol (DA FUI) : quatre coins qui se referment sur le point, puis s'effacent
    marqueur: { secondes: 0.45, taillePx: 34, maintenuSecondes: 0.12 }, // maintenu : un repère toutes les 0,12 s au plus
  },
};
// § E5.X5 : état vivant du réglage « Flashs » (main.setFlashs l'écrit ; lu à chaque image par les clignotements : un
// booléen et des nombres, aucune allocation). Seuil des recommandations photosensibles : 3 éclats par seconde au plus.
export const CONFORT_FLASHS = {
  reduits: false,
  hzMax: 2, // clignotements plafonnés (Hz) : mèche du kamikaze, flaque, utilitaires au sol
  flashBlanc: 0.4, // × l'intensité du flash blanc d'un robot touché
  reposFlash: 0.5, // s de pause après un flash (0,12 en normal) : un robot sous le feu ne flashe plus que 1,6 fois par seconde au plus
  hitstopMul: 0.5, // × la durée des arrêts sur image
};
//#endregion reglages-femz

//#region e5:U-visee-souris
// Visée à la souris (ARCHITECTURE.md § E5.U, Femz 21/11 : « contrôler la direction de la vue du perso avec la souris, et
// garder les déplacements sur clavier ») : direction héros → curseur, Frappe éclair vers le curseur, trait d'annonce au
// sol de la frappe prête. Toujours active, sans réglage (Femz, 21/11 : « garde seulement souris si ça tire auto pour les
// autres sur les robots les plus proches ») ; seul repli : curseur jamais bougé → direction de marche.
export const VISEE_SOURIS = {
  mort: 0.6, // m — curseur plus près du héros : la dernière visée est gardée (pas de demi-tour au moindre tremblement)
  // Trait d'annonce de la Frappe éclair prête (§ E5.U.5) : plaque couchée au sol, couleur de l'agent, gros pixels
  trait: {
    y: 0.035, // m — au-dessus des zones annoncées des robots (0,03), sous les anneaux (0,07)
    ordre: 1.4, // renderOrder : après les zones des robots (1,25 / 1,3)
    pixel: 4, // côté du gros pixel (px du tampon), celui du look des VFX (src/vfx/look.js, variante active : 4)
    apparition: 0.12, // s — fondu d'entrée quand la frappe redevient prête
    coin: { bras: 0.42, epaisseur: 0.07, gain: 1.15, alpha: 0.55 }, // quatre coins (m), comme le repère du clic
    tiret: { long: 0.32, pas: 0.56, epaisseur: 0.045, gain: 0.9, alpha: 0.3 }, // bords en tirets
    chevron: { pas: 1.1, epaisseur: 0.06, ouverture: 0.55, vitesse: 1.6, gain: 0.85, alpha: 0.22 }, // chevrons qui avancent (m/s)
    voile: { gain: 0.6, alpha: 0.07 },
    // Variantes à comparer (Femz, 21/11, sur la 1re : « propose plusieurs variantes, j'aime pas trop ») — planche
    // tests/captures/visee-U-variantes.png ; Femz choisit, la valeur retenue remplace 'actuel' :
    //   'actuel' : bande à la vraie largeur — quatre coins, bords en tirets, chevrons qui avancent, voile ;
    //   'a'      : le minimum — un fil d'un gros pixel du héros au point d'arrivée, un petit réticule au bout ;
    //   'b'      : la bande qui SE CHARGE — contour sourd toujours là (frappe possédée), remplie du héros vers le bout
    //              au rythme de la recharge ; prête : remplie, bords et bout allumés (on sait QUAND et OÙ) ;
    //   'c'      : flux — gros pixels lumineux qui s'écoulent vers le bout, bande très sourde à la vraie largeur ;
    //   'd'      : contour seul — les deux longs bords en tirets et un chevron au bout, sans remplissage ni coins.
    style: 'a', // choix de Femz du 22/11 : fil d'un pixel + réticule au point d'arrivée
    styles: ['actuel', 'a', 'b', 'c', 'd'],
    fil: { epaisseur: 0.05, gain: 1.0, alpha: 0.5, reticule: 0.34, reticuleBras: 0.14, reticuleAlpha: 0.65 }, // 'a'
    charge: { bord: 0.05, bordAlpha: 0.16, bordPret: 0.42, remplissage: 0.1, bout: 0.09, boutAlpha: 0.6 }, // 'b'
    flux: { pas: 0.42, taille: 0.11, vitesse: 3.2, alpha: 0.6, bande: 0.035 }, // 'c' (m, m, m/s)
  },
};
//#endregion e5:U-visee-souris

//#region identite-agents-previs
// Identité des agents (22/11/2026, docs/superpowers/specs/2026-11-22-identite-agents-design.md) — PRÉVIS seulement, avec
// « ?debug » dans l'adresse (sans effet sinon) :
//   ?modeles=bastion:previs/bastion-a.glb,eclaireur:previs/heros-col.glb  remplace le fichier d'un agent (MODELES.dir +
//                                                                         chemin, lettres / chiffres / - / _ / . / /)
//   ?cape=ece7dc,c9c2b4                                                   couleur de la cape dehors, dedans (hex)
if (typeof location !== 'undefined') {
  const q = new URLSearchParams(location.search);
  if (q.has('debug')) {
    for (const paire of (q.get('modeles') || '').split(',')) {
      const [cle, fichier] = paire.split(':');
      if (cle in MODELES.agents && /^[a-z0-9_./-]+\.glb$/i.test(fichier || '') && !fichier.includes('..')) MODELES.agents[cle] = fichier;
    }
    const cape = (q.get('cape') || '').split(',');
    if (/^[0-9a-f]{6}$/i.test(cape[0] || '')) ANIM.cape.couleur = parseInt(cape[0], 16);
    if (/^[0-9a-f]{6}$/i.test(cape[1] || '')) ANIM.cape.couleurDedans = parseInt(cape[1], 16);
  }
}
//#endregion identite-agents-previs

//#region e5:AB-camera-3p
// § E5.AB (Femz, 22/11 : « faudrait que la caméra tourne en 3D quand on tourne la souris » ; « Caméra derrière
// l'agent », « Z = devant à l'écran » ; puis : « le Dock macOS s'affiche quand je mets le curseur tout en bas ») —
// mode Souris : la souris tourne la caméra autour de l'agent (lacet seul), ZQSD en axes de la caméra ; les deux modes :
// verrou du pointeur en partie, et en mode Clavier un curseur dessiné par le jeu (src/verrou.js, camera.tourner).
export const CAMERA_3P = {
  sensibilite: 0.15, // ° de lacet par px de movementX (≈ 1 200 px pour un tour complet) — à régler au ressenti par Femz
  lissage: { omega: 40, epsilon: 1e-3 }, // ressort critique du lacet (1/s ; 0 = sans lissage) ; arrivé sous epsilon (° et °/s)
  ecartMaxPx: 400, // px — écart d'un seul événement au-delà duquel il est ignoré (saut connu du verrou à sa prise)
  // § E5.AB.14 : curseur du jeu du mode « Vue fixe » sous verrou (clic pour avancer, dash)
  curseur: {
    sensibilite: 1, // px CSS du curseur du jeu par px de movementX/Y (sous verrou, écarts du système accéléré)
    taillePx: 22, // côté du réticule (px CSS)
  },
  verrou: {
    echapGardeMs: 400, // ms — une touche Échap arrivée juste après la perte du verrou n'ouvre/ferme pas la pause une 2e fois
  },
  textes: { reprendre: 'Cliquez pour reprendre la souris' },
  // § E5.AB.12 (Femz, 22/11 : « enlever le système ortho de la caméra, ça fait mal à la tête quand elle tourne, il faudrait
  // une caméra normale » — perspective SEULEMENT en mode Souris ; le mode Clavier garde l'ortho de main). Ouverture
  // verticale modérée : à la distance où la cible voit 32 m de haut (comme l'ortho, 16 / tan(17,5°) = 50,7 m), le bas de
  // l'écran perd 24 % de profondeur au sol et le haut en gagne 46 % (inclinaison Moyenne 45°, calcul) — les hordes restent
  // lisibles, la rotation a du relief sans fish-eye ; 45° : bas −29 %, haut +71 % ; 25° : bas −18 %, haut +28 %, presque plat.
  perspective: { fovDeg: 35 },
  // § E5.AB.10 (Femz, 22/11 : « quand je fais un dash ou une téléportation, la caméra ne doit pas buter d'un coup vers la
  // prochaine position du perso […] rapide mais smooth ») : un déplacement du héros plus rapide que `vitesse` dans une
  // image (dash, téléportation du Shinobi, Frappe éclair, Iaido) n'est pas suivi d'un coup : la caméra le rattrape par un
  // ressort critique (aucun dépassement, vitesse continue). Le suivi en marche ne change pas.
  rattrapage: {
    vitesse: 18, // m/s — au-delà dans une image : saut (marche ≤ 6,5 × bonus de vitesse ≈ 13 m/s ; glissade du dash 24)
    vitesseTele: 40, // m/s — au-delà dans une image : téléportation, d'un coup (glissade 24, bond du Bastion 13 : étalés sur l'image)
    sautMax: 30, // m — au-delà (Rejouer, retour au centre) : pas de rattrapage, le suivi d'avant
    // quatre pôles confondus en −ω (départ et arrivée en douceur) : reste (1 + x + x²/2 + x³/6) e^(−x) du saut, x = ωt
    omega: 35, // 1/s — dash et petites téléportations (4,3 m : sous 3 cm en 0,30 s)
    grand: 6, // m — décalage au-delà duquel le rattrapage est un peu plus long…
    omegaGrand: 28, // 1/s — … (8 m : sous 3 cm en 0,40 s)
    decalageMax: 10, // m — le héros reste à l'écran (demi-profondeur vue au sol ≥ 12,6 m au zoom le plus proche, réglage Moyenne)
    epsilon: 1e-4, // m et m/s — arrivé : décalage remis à 0 exactement
  },
};
//#endregion e5:AB-camera-3p

//#region e5:AE-tuto-bornes
// Tuto des bornes de PV à la première partie (ARCHITECTURE.md § E5.AE ; Femz, 22/11 : « sur la première game lancée, un
// tuto pour les bornes HP ») : 4e bulle du système de consignes (§ E5.L) et flèche pixel au-dessus de la borne.
CONSIGNES.bornes = {
  lignes: ['Borne à croix verte : approchez-vous, puis {interagir} pour la casser.', 'Ramassez la batterie qui tombe : elle rend des PV.'],
  secondes: 8, // s affichée (deux lignes)
  apresCoupS: 3, // borne frappée pendant la bulle : elle s'en va ce temps après le coup (voir la Batterie, la ramasser)
  secoursS: 45, // s de jeu de la 1re partie sans dégât : une borne à l'écran suffit
};
export const TUTO_BORNES = {
  // « à l'écran » : centre de la borne projeté, coordonnées normalisées (−1 … 1, y vers le haut)
  ecran: { x: 0.85, haut: 0.7, bas: -0.7 },
  fleche: {
    pxArt720: 2, // px d'écran par pixel d'art à 720 p (4 à 1440 p), comme l'invite de la touche
    leve: 0.42, // m — pointe de la flèche au-dessus du haut de la borne (DECORS.height)
    entree: 0.15, // s — fondu d'entrée
    pop: 0.26, // s — échelle en « retour » (easeOutBack)…
    rebond: 2.2, // …surcharge de la courbe
    sortie: 0.25, // s — fondu de sortie
    glisse: 0.06, // s — constante du glissé vers une nouvelle borne (exponentiel)
    flottement: { amplitude: 2.5, periode: 0.9 }, // pixels d'art (vers le haut), s
  },
  couleurs: { trait: '#04160b', corps: '#5cff8a', ombre: '#2fb35c', clair: '#e6fff0', halo: '92, 255, 138' },
  halo: [0.34, 0.16, 0.07], // opacité des paliers du halo (1, 2, 3 pixels d'art autour du triangle)
};
//#endregion e5:AE-tuto-bornes
