// LOT : waves-shop — vagues : composition, vagues spéciales, apparition hors écran, grappes, plafond de vivants,
// boss de vague, fin de vague (contrat : ARCHITECTURE.md § K, et § E1.A qui prévaut depuis le 14/11/2026).
//
// Étape 1 du plan addictif (§ E1.A) : vagues AU CHRONO, apparitions façon Vampire Survivors. Une vague dure
// waveClockSeconds(n). Sa composition (inchangée) remplit un SAC lu en boucle : ouverture au minimum en vie
// (waveMinAlive), une grappe toutes les waveSpawnInterval(n) secondes, complément immédiat dès qu'il y a moins de
// vivants que le minimum, traînards replacés devant le héros. Chrono à zéro : la vague finit (main fait la purge) ;
// sur une vague de boss elle finit à la mort du boss, chrono figé à 0 en attendant (prolongation).
//
// Hasard : randWave() pour la composition, la vague spéciale et le mélange du sac, en nombre FIXE de tirages
// par vague (2 + total − 1) ; rand() pour les positions d'apparition et la taille des grappes.
import { CAPS, DMG, EFLAG, ENEMIES, ENEMY, ENEMY_COUNT, ENEMY_KEYS, SFX, WAVES,
  isBossWave, revisionAtWave, waveClockSeconds, waveComplementLoot, waveDmgMul, waveHpMul, waveMinAlive, waveRobotCount, waveSpawnInterval, threatMul } from './config.js';
import { ARGF, E, F_DX, F_X, F_Z, P, rand, randWave, run } from './state.js';
import { CHESTS, carriersForWave } from './config.js'; // § E2.C : élites porteuses
import { CARRIER_RARITY, END_LOOT, carrierRarity } from './config.js'; // § E2.G bis : rareté des porteuses, clignotement du butin
import { CARRY } from './config.js'; // § E3.K : survivants reportés
import { BOSS_IDENTITE, bossNomRang, bossRank } from './config.js'; // 20/11 : bannière « BOSS : OVERCLOCK »
import { REPLI } from './config.js'; // § E4.F : retour des garés
//#region e5:N-combat-guide
import { COMBAT_GUIDE } from './config.js'; // § E5.N (C10) : petit répit à la bascule
// REPIT[0] : s de répit restantes (aucune nouvelle apparition par la vague) ; REPIT[1] : répits posés depuis l'init (tests)
const REPIT = new Float64Array(2);
//#endregion

let ctx = null;
let enemies = null;
let boss = null;
let world = null;
let audio = null;
let ui = null;
let view = null;
let events = null; // événements de vague (§ E1.C)
// Élites porteuses d'un coffre (§ E2.C règle 3) : prévues par vague, sorties aux fractions CHESTS.carrier.at du chrono
let chests = null;
let elites = null; // § E3.A : modificateurs et raretés hautes des porteuses (repli : étape 2)
const CARRIER = CHESTS.carrier;
// § E2.G bis G2 : une bannière par rareté (« ÉLITE DÉTECTÉE : CACHE CHIFFRÉE »…), chaînes construites à l'import
const CARRIER_TEXT = CARRIER_RARITY.labels.map((l) => CARRIER.kicker + ' : ' + l);
let carriersPlanned = 0;
let carriersOut = 0;

const QUEUE_CAP = CAPS.waveQueue;
const queue = new Uint8Array(QUEUE_CAP); // le sac : types de la vague, mélangés ; lu en boucle (§ E1.A règle 1)
let queueLen = 0;
let queueHead = 0; // prochain type à sortir ; revient à 0 au bout du sac

// Révisions des robots (§ E1.B) : bannière « MISE À JOUR DÉTECTÉE : … » de la vague où une révision arrive, et
// escadrilles des drones v2 (le sac est regroupé par paquets de `squad` drones, sortis ensemble en formation).
const REVISIONS = ENEMIES.revisions;
// § E4.N.3 : « préfixe : libellé », puis à la ligne ce qui change pour le joueur (r.effet) ; chaînes construites à l'import
const REVISION_TEXT = REVISIONS.map((r) => ENEMIES.revisionBannerPrefix + ' : ' + r.label + (r.effet ? '\n' + r.effet : ''));
const SQUAD = REVISIONS.find((r) => r.key === 'pique');
const bagScratch = new Uint8Array(QUEUE_CAP);
const bagUsed = new Uint8Array(QUEUE_CAP);
let revisionIndex = -1; // indice dans ENEMIES.revisions de la révision annoncée à cette vague, −1 = aucune
let revisionAnnounced = false;
let squad = 0; // taille d'une escadrille de drones pour la vague (0 = pas d'escadrille)
let squads = 0; // escadrilles sorties (lu par inspect)

const planned = new Uint16Array(ENEMY_COUNT);
const spawnedByType = new Uint16Array(ENEMY_COUNT);

let index = 0; // numéro de la vague en cours (0 = aucune)
let active = false;
let cleared = false;
let hold = false; // bac à sable de test : rien ne sort, le chrono est figé et la vague ne se termine pas
let total = 0;
let spawned = 0;
// Réécrits à chaque image de combat : dans un tableau typé (une variable de module qui reçoit un flottant coûte un
// nombre alloué à chaque écriture, § V).
const CLOCK = 0; // s restantes au chrono de la vague
const WAVE_TIME = 1; // s depuis le début de la vague
const NEXT = 2; // s avant la prochaine grappe à intervalle
const CLOCK_TOTAL = 3; // durée du chrono de la vague (écrit une fois par vague)
const INTERVAL = 4; // intervalle entre deux grappes (écrit une fois par vague)
const acc = new Float64Array(5);
let minAlive = 0; // minimum de robots en vie de la vague
let opened = false; // l'ouverture (premier remplissage jusqu'au minimum) est faite
let nextCluster = 1; // taille de la prochaine grappe (entier, tiré à la sortie de la précédente)
let frameSpawns = 0; // apparitions de l'image en cours (plafond spawn.maxPerFrame)
// Compteurs de la vague (lus par inspect)
let intervalClusters = 0; // grappes sorties à intervalle (règle 3)
let complement = 0; // robots sortis pour tenir le minimum, après l'ouverture (règle 4)
let lootBudget = 0; // robots de complément avec butin permis pour la vague (§ E1.S, règle 4 bis : waveComplementLoot)
let lootless = 0; // robots de complément sortis sans butin (budget épuisé, ou prolongation)
let relocated = 0; // traînards replacés devant le héros (règle 5)
let relocCursor = 0; // prochain emplacement de E examiné (à tour de rôle)
let hasBoss = false;
let bossSpawned = false;
let bossCancelled = false;
let hpMul = 1;
let dmgMul = 1;
// § E3.K : robots reportés de la vague précédente au départ de celle-ci, et ceux repoussés hors de CARRY.safeRadius
let carried = 0;
let carryMoved = 0; // § E4.F.4 : reportés rentrés (par les bords, étalés) depuis le départ de la vague
let returning = 0; // § E4.F.4 : garés pas encore rentrés

// Vagues spéciales
let specialType = -1; // type unique de la vague en cours, −1 = vague normale
let specialAnnounced = false; // seconde bannière déjà affichée
let prevSpecial = false; // la vague précédente était spéciale (jamais deux d'affilée)
let eligibleStreak = 0; // vagues éligibles passées sans vague spéciale

const pt = new Float32Array(2); // point d'apparition courant
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // répartit les membres d'une grappe sur un cercle sans les superposer

// Tableaux de travail de compose() : un emplacement par type débloqué, dans l'ordre de la table.
const cId = new Uint8Array(ENEMY_COUNT);
const cShare = new Float64Array(ENEMY_COUNT);
const cFrac = new Float64Array(ENEMY_COUNT);
const cCount = new Int32Array(ENEMY_COUNT);

export function init(context) {
  ctx = context;
  enemies = ctx.enemies;
  boss = ctx.boss;
  world = ctx.world;
  audio = ctx.audio;
  ui = ctx.ui;
  view = ctx.camera.view;
  events = ctx.events;
  chests = ctx.chests || null;
  elites = ctx.elites || null; // § E3.A
}

export function reset() {
  run.wave = 0;
  run.carried = 0; // § E3.K
  carried = 0;
  carryMoved = 0;
  returning = 0;
  index = 0;
  active = false;
  cleared = false;
  queueLen = 0;
  queueHead = 0;
  total = 0;
  spawned = 0;
  acc.fill(0);
  minAlive = 0;
  opened = false;
  nextCluster = 1;
  frameSpawns = 0;
  intervalClusters = 0;
  complement = 0;
  lootBudget = 0;
  lootless = 0;
  relocated = 0;
  relocCursor = 0;
  hasBoss = false;
  bossSpawned = false;
  bossCancelled = false;
  hpMul = 1;
  dmgMul = 1;
  specialType = -1;
  specialAnnounced = false;
  prevSpecial = false;
  eligibleStreak = 0;
  revisionIndex = -1;
  revisionAnnounced = false;
  squad = 0;
  squads = 0;
  planned.fill(0);
  spawnedByType.fill(0);
  carriersPlanned = 0;
  carriersOut = 0;
}

/**
 * Pure : composition NORMALE de la vague n dans out (Uint16Array(7)), hors boss. Renvoie le total.
 * Même algorithme, mêmes opérations dans le même ordre que la référence (compose de tests/equilibrage.mjs) :
 * poids des types débloqués, parts plafonnées (l'excédent va au rôdeur), arrondi au plus grand reste, minimum
 * garanti à chaque type débloqué pris sur les rôdeurs.
 */
export function compose(n, out) {
  out.fill(0);
  const count = waveRobotCount(n); // 0. la formule du cahier (× escortFraction sur une vague de boss)
  const types = ENEMIES.types;
  // 1. types débloqués, boss exclu ; poids = base + perWave × (n − unlockWave)
  let m = 0;
  let sum = 0;
  for (let k = 0; k < types.length; k++) {
    const T = types[k];
    if (T.id === ENEMY.BOSS || n < T.unlockWave) continue;
    const w = T.weight.base + T.weight.perWave * (n - T.unlockWave);
    cId[m] = T.id;
    cShare[m] = w > 0 ? w : 0;
    sum += cShare[m];
    m++;
  }
  if (m === 0) return 0; // aucune vague avant la première
  // 2. parts, plafonnées à maxShare ; l'excédent revient au premier type (le rôdeur)
  let excess = 0;
  for (let i = 0; i < m; i++) {
    let s = sum > 0 ? cShare[i] / sum : i === 0 ? 1 : 0;
    const cap = types[cId[i]].weight.maxShare;
    if (s > cap) {
      excess += s - cap;
      s = cap;
    }
    cShare[i] = s;
  }
  cShare[0] += excess;
  // 3. arrondi au plus grand reste (à égalité : l'identifiant de type le plus petit d'abord)
  let given = 0;
  for (let i = 0; i < m; i++) {
    const exact = cShare[i] * count;
    const whole = Math.floor(exact);
    cCount[i] = whole;
    cFrac[i] = exact - whole;
    given += whole;
  }
  for (let rest = count - given; rest > 0; rest--) {
    let best = -1;
    let bestFrac = -1;
    for (let i = 0; i < m; i++) {
      if (cFrac[i] > bestFrac) {
        bestFrac = cFrac[i];
        best = i;
      }
    }
    if (best < 0) break;
    cCount[best]++;
    cFrac[best] = -1; // un seul robot de plus par type
  }
  // 4. minimum garanti pour tout type débloqué autre que le rôdeur, prélevé sur les rôdeurs
  const min = WAVES.minAtUnlock;
  for (let i = 1; i < m; i++) {
    if (cCount[i] < min) {
      cCount[0] -= min - cCount[i];
      cCount[i] = min;
    }
  }
  for (let i = 0; i < m; i++) out[cId[i]] = cCount[i] > 0 ? cCount[i] : 0;
  return count;
}

/** n est-elle la vague de déblocage d'un type de robot ? (ces vagues-là ne sont jamais spéciales) */
function isUnlockWave(n) {
  const types = ENEMIES.types;
  for (let k = 0; k < types.length; k++) {
    if (types[k].id !== ENEMY.BOSS && types[k].unlockWave === n) return true;
  }
  return false;
}

/** Le type T peut-il être le sujet d'une vague spéciale à la vague n ? (skipBase : le rôdeur est écarté) */
function isSpecialCandidate(T, n, skipBase) {
  return T.id !== ENEMY.BOSS && T.specialWaveEligible && n >= T.unlockWave && !(skipBase && T.id === ENEMY.RODEUR);
}

/**
 * Tirage de la vague spéciale (§ K). rSpecial et rType sont les deux tirages de randWave() faits à chaque vague,
 * éligible ou non. Renvoie le type unique de la vague, ou −1 pour une vague normale. Tient prevSpecial et
 * eligibleStreak.
 */
function drawSpecial(n, rSpecial, rType) {
  const S = WAVES.special;
  let type = -1;
  // Une vague de révision (§ E1.B) n'est jamais spéciale, comme une vague de déblocage : sa nouveauté, c'est la mise à jour.
  if (n >= S.firstWave && !isBossWave(n) && !isUnlockWave(n) && revisionAtWave(n) === null && !prevSpecial) {
    if (rSpecial < S.chance || eligibleStreak >= S.forceAfter) {
      // Un seul type, tiré parmi les types débloqués marqués specialWaveEligible. Le rôdeur est de toutes les
      // vagues : seul, il ne fait qu'une vague ordinaire privée de ses autres robots. Il n'est donc tiré que s'il
      // est le seul type éligible débloqué (WAVES.special.skipBaseType).
      const types = ENEMIES.types;
      let all = 0;
      let others = 0;
      for (let k = 0; k < types.length; k++) {
        if (!isSpecialCandidate(types[k], n, false)) continue;
        all++;
        if (types[k].id !== ENEMY.RODEUR) others++;
      }
      const skipBase = S.skipBaseType && others > 0;
      const candidates = skipBase ? others : all;
      if (candidates > 0) {
        let pick = Math.floor(rType * candidates);
        if (pick >= candidates) pick = candidates - 1;
        for (let k = 0; k < types.length; k++) {
          if (!isSpecialCandidate(types[k], n, skipBase)) continue;
          if (pick === 0) {
            type = types[k].id;
            break;
          }
          pick--;
        }
      }
    }
    if (type >= 0) eligibleStreak = 0;
    else eligibleStreak++;
  }
  prevSpecial = type >= 0;
  return type;
}

function drawClusterSize() {
  const S = WAVES.spawn;
  const size = S.clusterMin + Math.floor(rand() * (S.clusterMax - S.clusterMin + 1));
  return size > 1 ? size : 1;
}

/**
 * run.wave = n ; compose ; remplit le sac ; règle le chrono, le minimum en vie et l'intervalle ; bannière ; son.
 * record (§ E1.S) : la vague bat le record — main vient d'afficher « NOUVEAU RECORD : VAGUE N » et de jouer son son ;
 * ni bannière « Vague n » ni son de début de vague ici.
 */
export function startWave(n, record = false, volee = false) {
  // § E3.K : les robots encore en vie viennent de la vague précédente (reportés) ; ils s'ajoutent à l'effectif de
  // celle-ci et comptent dans son minimum en vie (E.aliveCount, lu par update). Aucun à moins de CARRY.safeRadius m.
  carried = E.aliveCount;
  run.carried = carried;
  carryMoved = 0;
  if (volee) {
    // § E5.V : bascule à la volée — les robots en vie restent où ils sont et continuent d'agir (ni repli ni retour)
    returning = 0;
    // § E5.N (C10, Femz 21/11 : « petit répit alors faut pas un stop trop grand ») : quelques secondes sans nouvelle
    // apparition ; rien ne s'arrête (chrono, robots, joueur). Lu à chaque bascule (réglable par les mesures).
    REPIT[0] = COMBAT_GUIDE.repit.secondes;
    if (REPIT[0] > 0) REPIT[1] += 1;
  } else {
    REPIT[0] = 0; // § E5.N : départ ou sortie du décryptage — déjà un arrêt, pas de répit
    // § E4.F.4 (remplace la règle 2 du § E3.K, relocateF) : les garés rentrent par les bords, étalés dans le temps
    enemies.endRetreat();
    returning = carried > 0 ? scheduleReturns() : 0;
  }
  run.wave = n;
  index = n;
  active = true;
  cleared = false;
  acc[WAVE_TIME] = 0;
  spawned = 0;
  spawnedByType.fill(0);
  hasBoss = isBossWave(n);
  bossSpawned = false;
  bossCancelled = false;
  // § E2.S S5 : facteurs de difficulté (prise en main des premières vagues, croissance) par-dessus la formule du cahier
  hpMul = waveHpMul(n) * threatMul(n, 'hp');
  dmgMul = waveDmgMul(n) * threatMul(n, 'dmg');

  // Tirages de randWave() en nombre fixe par vague (§ K) : « spéciale ou non », son type (tirés même si la vague
  // n'est pas éligible), puis total − 1 pour le mélange. À graine égale, la suite des vagues est donc la même.
  const rSpecial = randWave();
  const rType = randWave();
  total = compose(n, planned);
  if (total > QUEUE_CAP) total = QUEUE_CAP;
  specialType = drawSpecial(n, rSpecial, rType);
  specialAnnounced = false;
  if (specialType >= 0) {
    // vague spéciale : un seul type, l'effectif reste celui de la formule
    planned.fill(0);
    planned[specialType] = total;
  }
  queueLen = 0;
  queueHead = 0;
  for (let t = 0; t < ENEMY_COUNT; t++) {
    for (let k = 0; k < planned[t] && queueLen < QUEUE_CAP; k++) queue[queueLen++] = t;
  }
  for (let k = queueLen - 1; k > 0; k--) {
    const j = Math.floor(randWave() * (k + 1));
    const tmp = queue[k];
    queue[k] = queue[j];
    queue[j] = tmp;
  }

  // Révisions des robots (§ E1.B) : les types passent en v2 / v3 pour cette vague ; la vague où une révision arrive
  // l'annonce (update) ; drones v2 : le sac est regroupé en escadrilles (aucun tirage de plus).
  enemies.setRevisions(n);
  revisionIndex = -1;
  for (let k = 0; k < REVISIONS.length; k++) if (REVISIONS[k].wave === n) revisionIndex = k;
  revisionAnnounced = false;
  squad = enemies.getRevision(ENEMY.DRONE) >= 1 ? SQUAD.squad : 0;
  squads = 0;
  if (squad > 1) groupSquads(ENEMY.DRONE, squad);

  // Chrono, minimum en vie, intervalle (§ E1.A) : ouverture au minimum dès la première image, puis une grappe par
  // intervalle ; l'effectif du cahier (total) n'est plus qu'un effectif NOMINAL, le sac est relu tant que le chrono tourne.
  acc[CLOCK_TOTAL] = waveClockSeconds(n);
  acc[CLOCK] = acc[CLOCK_TOTAL];
  acc[INTERVAL] = waveSpawnInterval(n);
  acc[NEXT] = acc[INTERVAL];
  minAlive = Math.round(waveMinAlive(n) * threatMul(n, 'alive'));
  if (minAlive < 1) minAlive = 1;
  if (minAlive > WAVES.maxAlive) minAlive = WAVES.maxAlive;
  opened = false;
  intervalClusters = 0;
  complement = 0;
  lootBudget = waveComplementLoot(n);
  lootless = 0;
  relocated = 0;
  nextCluster = drawClusterSize();

  // Événement de vague (§ E1.C) : tirage du calendrier (flux randEvent : la suite des vagues ne change pas).
  // § E5.V : à la volée, un événement en cours va jusqu'au bout ; celui de cette vague attend qu'il soit fini.
  events.startWave(n, volee);

  // Élites porteuses (§ E2.C) : aucun tirage ici (le type est tiré à la sortie, sur le flux privé des coffres)
  carriersPlanned = chests !== null ? carriersForWave(n) : 0;
  carriersOut = 0;

  if (!record) {
    ui.showBanner('Vague ' + n);
    if (audio.lead(SFX.WAVE_START) === 0) audio.play(SFX.WAVE_START); // avec une avance, main.js l'a lancé pendant le compte à rebours
  }
}

/**
 * Gardes d'une capsule de ravitaillement (§ E1.C) : `count` robots tirés du sac de la vague, posés sur un cercle de
 * rayon ARGF[F_DX] autour de (ARGF[F_X], ARGF[F_Z]), drapeau EFLAG.GUARD. Plafonds habituels (vivants, E plein) ; pas de
 * plafond par image (une fois par événement). Un point hors de l'arène ou dans un obstacle est ramené par
 * world.resolve. Renvoie le nombre de gardes créés.
 */
export function emitGuardsF(count) {
  const cx = ARGF[F_X];
  const cz = ARGF[F_Z];
  const ring = ARGF[F_DX];
  if (!active || queueLen === 0) return 0;
  const types = ENEMIES.types;
  let made = 0;
  for (let k = 0; k < count; k++) {
    if (E.aliveCount >= WAVES.maxAlive || E.count >= E.cap) break;
    const t = queue[queueHead];
    const r = types[t].radius;
    const a = (k / count) * TAU;
    world.resolve(cx + Math.sin(a) * ring, cz + Math.cos(a) * ring, r, pt);
    const i = enemies.spawn(t, pt[0], pt[1], hpMul, dmgMul);
    if (i < 0) break;
    E.flags[i] = EFLAG.GUARD;
    if (++queueHead >= queueLen) queueHead = 0;
    spawned++;
    spawnedByType[t]++;
    made++;
  }
  return made;
}

/** Multiplicateurs de la vague en cours (PV, dégâts), pour les robots d'événement (§ E1.C). */
export function getHpMul() {
  return hpMul;
}
export function getDmgMul() {
  return dmgMul;
}

/**
 * Escadrilles (§ E1.B) : regroupe dans le sac les robots du type donné par paquets de `size` qui se suivent. Chaque
 * paquet commence là où se trouvait son premier membre ; les autres types gardent leur ordre. Aucun tirage : la suite
 * de randWave() ne change pas, les effectifs non plus.
 */
function groupSquads(type, size) {
  let out = 0;
  for (let k = 0; k < queueLen; k++) bagUsed[k] = 0;
  for (let k = 0; k < queueLen; k++) {
    if (bagUsed[k] === 1) continue;
    bagScratch[out++] = queue[k];
    if (queue[k] !== type) continue;
    let need = size - 1;
    for (let j = k + 1; j < queueLen && need > 0; j++) {
      if (bagUsed[j] === 0 && queue[j] === type) {
        bagUsed[j] = 1;
        bagScratch[out++] = type;
        need--;
      }
    }
  }
  for (let k = 0; k < queueLen; k++) queue[k] = bagScratch[k];
}

/**
 * Point d'apparition hors écran, autour du joueur, pour un robot de rayon r et de hauteur h (§ K). Résultat dans pt.
 */
function pickSpawnPoint(r, h) {
  const S = WAVES.spawn;
  const m = S.margin + r;
  const a1 = view.halfW + m; // demi-largeur du rectangle
  const bTop = view.halfD + m; // vers le haut de l'écran
  const bBot = view.prochD + m + h * view.groundPerHeight; // vers le bas : un robot haut dépasse dans l'écran (§ E5.AB.12 : prochD, = halfD en ortho)
  const width = a1 * 2;
  const height = bTop + bBot;
  const perimeter = 2 * (width + height);
  for (let attempt = 0; attempt < S.tries; attempt++) {
    let u = rand() * perimeter;
    const push = rand() * S.depth;
    let a;
    let b;
    if (u < width) {
      a = -a1 + u; // côté haut
      b = bTop + push;
    } else if ((u -= width) < height) {
      a = a1 + push; // côté droit
      b = bTop - u;
    } else if ((u -= height) < width) {
      a = a1 - u; // côté bas
      b = -bBot - push;
    } else {
      u -= width;
      a = -a1 - push; // côté gauche
      b = -bBot + u;
    }
    const x = view.targetX + a * view.rightX + b * view.upX;
    const z = view.targetZ + a * view.rightZ + b * view.upZ;
    if (world.isInsideArena(x, z, r) && !world.overlaps(x, z, r)) {
      pt[0] = x;
      pt[1] = z;
      return;
    }
  }
  // Repli (joueur dans un coin) : du joueur vers le centre de l'arène, juste hors de l'écran.
  let dx = -P.x;
  let dz = -P.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > 1e-3) {
    dx /= d;
    dz /= d;
  } else {
    dx = view.upX;
    dz = view.upZ;
  }
  const dist = Math.sqrt(a1 * a1 + bBot * bBot);
  // world.resolve borne le point à l'arène et le sort d'un obstacle s'il y est tombé : aucun robot n'apparaît dans
  // un rocher, même par le repli.
  world.resolve(P.x + dx * dist, P.z + dz * dist, r, pt);
}

/**
 * Sort UNE grappe du sac, à un point hors écran. flags : drapeaux E.flags donnés à ses robots (EFLAG.NO_LOOT en
 * prolongation). Renvoie le nombre de robots créés (0 : plafond de vivants, plafond par image ou E plein).
 * La grappe entière sort ou attend l'image suivante, sauf la première de l'image, tronquée au plafond par image.
 */
function emitCluster(flags) {
  const S = WAVES.spawn;
  const types = ENEMIES.types;
  let size = nextCluster;
  // Escadrille (§ E1.B) : des drones v2 en tête du sac sortent ensemble, en formation — la grappe est la suite de
  // drones qui se suivent (au plus `squad`).
  let formation = false;
  if (squad > 1 && queue[queueHead] === ENEMY.DRONE) {
    let run = 0;
    let q = queueHead;
    while (run < squad && queue[q] === ENEMY.DRONE) {
      run++;
      if (++q >= queueLen) q = 0;
      if (q === queueHead) break;
    }
    if (run >= 2) {
      size = run;
      formation = true;
    }
  }
  const room = WAVES.maxAlive - E.aliveCount; // plafond de vivants : la grappe attend qu'une place se libère
  if (size > room) size = room;
  const frameRoom = S.maxPerFrame - frameSpawns;
  if (size > frameRoom) {
    if (frameSpawns > 0) return 0; // la grappe entière sortira à l'image suivante
    size = frameRoom;
  }
  if (size <= 0 || E.count >= E.cap) return 0;

  // Gabarit de la grappe : le plus grand rayon et le plus haut sommet de ses membres, pour qu'aucun ne
  // dépasse dans l'écran.
  let rMax = 0;
  let topMax = 0;
  let q = queueHead;
  for (let k = 0; k < size; k++) {
    const T = types[queue[q]];
    if (T.radius > rMax) rMax = T.radius;
    const top = T.height + T.hover;
    if (top > topMax) topMax = top;
    if (++q >= queueLen) q = 0;
  }
  pickSpawnPoint(rMax, topMax);
  const cx = pt[0];
  const cz = pt[1];
  const jitter = S.clusterJitter;
  // formation en V, pointe vers le héros : (fx, fz) = du centre de la grappe vers le héros
  let fx = P.x - cx;
  let fz = P.z - cz;
  const fl = Math.sqrt(fx * fx + fz * fz);
  if (fl > 1e-6) {
    fx /= fl;
    fz /= fl;
  } else {
    fx = 0;
    fz = 1;
  }
  let made = 0;
  let fallbackStep = 0; // prochain angle du cercle de repli (un angle par membre : jamais deux robots au même point)
  while (made < size) {
    const t = queue[queueHead];
    const r = types[t].radius;
    let x;
    let z;
    if (formation) {
      // rang 0 : le chef de file ; puis un ailier de chaque côté, un rang plus loin du héros à chaque paire
      const rank = (made + 1) >> 1;
      const side = (made & 1) === 1 ? 1 : -1;
      const back = rank * SQUAD.squadSpacing;
      x = cx - fx * back + fz * side * back;
      z = cz - fz * back - fx * side * back;
    } else {
      // dans un disque de rayon clusterJitter autour du centre (jamais plus près de l'écran que margin − clusterJitter)
      const ang = rand() * TAU;
      const rad = jitter * Math.sqrt(rand());
      x = cx + Math.cos(ang) * rad;
      z = cz + Math.sin(ang) * rad;
    }
    if (!world.isInsideArena(x, z, r) || world.overlaps(x, z, r)) {
      // Repli : sur un petit cercle autour du centre de la grappe, au premier angle libre — le point tiré était
      // dans un obstacle ou hors de l'arène, celui-ci ne doit pas l'être non plus. À défaut, le centre lui-même :
      // il est libre pour le plus gros membre de la grappe.
      x = cx;
      z = cz;
      for (let k = 0; k < S.clusterFallbackTries; k++) {
        const a = fallbackStep++ * GOLDEN_ANGLE;
        const qx = cx + Math.cos(a) * S.clusterFallbackRadius;
        const qz = cz + Math.sin(a) * S.clusterFallbackRadius;
        if (world.isInsideArena(qx, qz, r) && !world.overlaps(qx, qz, r)) {
          x = qx;
          z = qz;
          break;
        }
      }
    }
    const i = enemies.spawn(t, x, z, hpMul, dmgMul);
    if (i < 0) break; // E plein : le robot reste dans le sac
    if (flags !== 0) E.flags[i] = flags;
    if (++queueHead >= queueLen) queueHead = 0; // le sac est relu en boucle : les proportions de la vague tiennent
    spawned++;
    spawnedByType[t]++;
    made++;
  }
  frameSpawns += made;
  if (formation && made > 0) squads++;
  if (made === size) nextCluster = drawClusterSize();
  return made;
}

/**
 * § E4.F.4 — départ de la vague : chaque reporté (garé, ou encore en repli : garé d'office) reçoit un décalage d'entrée
 * dans E.retT — k-ième dans l'ordre de E → step × k + rand() × jitter, step ramené à spread / N s'ils sont nombreux.
 * Renvoie le nombre de garés à faire rentrer. Une fois par vague, hors combat. Tirages par rand() (flux principal),
 * comme l'ancien clearCarried : la suite des vagues (randWave) reste la même à graine égale.
 */
function scheduleReturns() {
  const Rt = REPLI.retour;
  let n = 0;
  for (let i = 0; i < E.count; i++) if (E.alive[i] === 1 && E.sus[i] !== 0 && E.type[i] !== ENEMY.BOSS) n++;
  if (n === 0) return 0;
  const step = Math.min(Rt.step, Rt.spread / n);
  let k = 0;
  for (let i = 0; i < E.count; i++) {
    if (E.alive[i] === 0 || E.sus[i] === 0 || E.type[i] === ENEMY.BOSS) continue;
    E.sus[i] = 2;
    E.retT[i] = step * k + rand() * Rt.jitter;
    k++;
  }
  return n;
}

/**
 * § E4.F.4 — fait courir les décalages d'entrée ; à l'échéance, le garé est posé hors écran (pickSpawnPoint, comme une
 * apparition), à au moins CARRY.safeRadius + rayon du héros (repoussé sur ce cercle si le point tiré est trop près), puis
 * enemies.reenterF : il marche vers le héros. Aucune téléportation visible : il était garé, hors champ.
 */
function processReturns(dt) {
  const R = CARRY.safeRadius;
  const types = ENEMIES.types;
  let left = 0;
  for (let i = 0; i < E.count; i++) {
    if (E.alive[i] === 0 || E.sus[i] !== 2) continue;
    E.retT[i] -= dt;
    if (E.retT[i] > 0) {
      left++;
      continue;
    }
    const T = types[E.type[i]];
    const r = E.radius[i];
    pickSpawnPoint(r, T.height + T.hover);
    const R2 = (R + r) * (R + r);
    let qx = pt[0] - P.x;
    let qz = pt[1] - P.z;
    const q2 = qx * qx + qz * qz;
    if (q2 < R2) {
      const q = Math.sqrt(q2);
      if (q > 1e-3) {
        qx /= q;
        qz /= q;
      } else {
        qx = view.upX;
        qz = view.upZ;
      }
      world.resolve(P.x + qx * (R + r), P.z + qz * (R + r), r, pt);
    }
    ARGF[F_X] = pt[0];
    ARGF[F_Z] = pt[1];
    enemies.reenterF(i);
    carryMoved++;
  }
  returning = left;
}

/** § E4.F.4 : garés pas encore rentrés dans la vague en cours. */
export function returningCount() {
  return returning;
}

/** § E3.K : robots reportés de la vague précédente au départ de la vague en cours. */
export function carriedCount() {
  return carried;
}

/**
 * Traînards replacés devant le héros (§ E1.A règle 5). WAVES.relocate.perFrame emplacements de E examinés par image,
 * à tour de rôle ; E.far compte le temps passé hors du rectangle visible élargi (il suit le robot à la compaction).
 */
function relocateStragglers(dt) {
  const R = WAVES.relocate;
  const n = E.count;
  if (n === 0) return;
  const visits = R.perFrame < n ? R.perFrame : n;
  const elapsed = (dt * n) / visits; // temps écoulé depuis la visite précédente du même emplacement
  const types = ENEMIES.types;
  const a1 = view.halfW + R.margin;
  const b1 = view.halfD + R.margin;
  const tx = view.targetX;
  const tz = view.targetZ;
  const rX = view.rightX;
  const rZ = view.rightZ;
  const uX = view.upX;
  const uZ = view.upZ;
  const SKIP = EFLAG.TRANSIT | EFLAG.WALL | EFLAG.SHIELD_DRONE | EFLAG.GUARD; // robots d'événement : jamais replacés (§ E1.C)
  const walking = P.vx * P.vx + P.vz * P.vz >= R.minSpeed * R.minSpeed;
  const FAR = E.far;
  let i = relocCursor;
  for (let v = 0; v < visits; v++) {
    if (i >= n) i = 0;
    const slot = i++;
    if (E.alive[slot] === 0 || E.sus[slot] !== 0) continue; // § E4.F : un garé n'est pas un traînard
    const t = E.type[slot];
    if (t === ENEMY.BOSS || (E.flags[slot] & SKIP) !== 0) continue;
    const dx = E.x[slot] - tx;
    const dz = E.z[slot] - tz;
    const a = dx * rX + dz * rZ;
    const b = dx * uX + dz * uZ;
    if (a >= -a1 && a <= a1 && b >= -b1 && b <= b1) {
      FAR[slot] = 0; // revu dans le champ élargi
      continue;
    }
    FAR[slot] += elapsed;
    if (FAR[slot] < R.seconds) continue;
    // Point d'apparition hors écran ; si le héros marche, du côté de sa marche (au plus spawn.tries tirages).
    const T = types[t];
    const tries = walking ? WAVES.spawn.tries : 1;
    for (let k = 0; k < tries; k++) {
      pickSpawnPoint(T.radius, T.height + T.hover);
      if (!walking) break;
      const px = pt[0] - P.x;
      const pz = pt[1] - P.z;
      const d = Math.sqrt(px * px + pz * pz);
      if (d > 1e-6 && (px * P.moveX + pz * P.moveZ) / d >= R.aheadCos) break;
    }
    ARGF[F_X] = pt[0];
    ARGF[F_Z] = pt[1];
    enemies.relocateF(slot);
    relocated++;
  }
  relocCursor = i;
}

/**
 * Sort une élite porteuse (§ E2.C règle 3) : un robot d'un type de CHESTS.carrier.types débloqué à cette vague, tiré
 * sur le flux privé des coffres, posé hors écran (pickSpawnPoint), puis enemies.makeCarrierF. Bannière « ÉLITE
 * DÉTECTÉE » et alerte. Renvoie l'indice du robot, −1 si E est plein (nouvel essai à l'image suivante).
 */
function spawnCarrier() {
  const types = ENEMIES.types;
  let n = 0;
  for (let k = 0; k < CARRIER.types.length; k++) if (index >= types[CARRIER.types[k]].unlockWave) n++;
  if (n === 0) {
    carriersOut++;
    return -1;
  }
  let pick = Math.floor(chests.lootRand() * n);
  if (pick >= n) pick = n - 1;
  let type = CARRIER.types[0];
  for (let k = 0; k < CARRIER.types.length; k++) {
    if (index < types[CARRIER.types[k]].unlockWave) continue;
    if (pick === 0) {
      type = CARRIER.types[k];
      break;
    }
    pick--;
  }
  const T = types[type];
  pickSpawnPoint(T.radius * CARRIER.scale, T.height * CARRIER.scale);
  const i = enemies.spawn(type, pt[0], pt[1], hpMul, dmgMul);
  if (i < 0) return -1;
  // § E2.G bis G2 : rareté tirée sur le flux privé des coffres (un tirage de plus, après le type)
  // § E3.A règle 3 : Noyau et Root dès ELITES.rarityHigh.from (tirage de plus, avant celui de l'étape 2)
  const rarity = elites !== null ? elites.highRarity(index, chests.lootRand) : carrierRarity(index, chests.lootRand());
  enemies.makeCarrierF(i, rarity);
  const mod = elites !== null ? elites.assignF(i, index, chests.lootRand) : 0; // § E3.A règle 1
  // Fusion de la phase 1 (§ E2.I) : la porteuse ne sort PAS du sac de la vague — elle n'entre donc pas dans `spawned` ni
  // `spawnedByType` (« sortis du sac », lus par les contrôles du sac relu en boucle), seulement dans `carriersOut`. Elle
  // compte en revanche dans le plafond d'apparitions de l'image (WAVES.spawn.maxPerFrame).
  frameSpawns++;
  carriersOut++;
  if (mod > 0) ui.queueBanner(elites.bannerText(mod), CARRIER.bannerSeconds, SFX.ELITE_MOD); // § E3.A règle 2
  else ui.queueBanner(CARRIER_TEXT[rarity], CARRIER.bannerSeconds, SFX.ALERT);
  return i;
}

/** Debug (§ E2.C) : sort tout de suite une élite porteuse (vague active). Renvoie l'indice du robot, −1 sinon. */
export function debugSpawnCarrier() {
  if (!active || chests === null) return -1;
  const before = carriersOut;
  const i = spawnCarrier();
  carriersOut = before; // le calendrier de la vague n'est pas décalé
  return i;
}

/** S3 : chrono, apparitions, traînards (no-op si aucune vague active). */
export function update(dt) {
  if (active && returning > 0) processReturns(dt); // § E4.F.4 : retour des garés (même en bac à sable)
  if (!active || hold) return;
  acc[WAVE_TIME] += dt;

  // Boss de la vague : bannière puis arrivée
  if (hasBoss && !bossSpawned && !bossCancelled && acc[WAVE_TIME] >= WAVES.boss.arrivalDelay) {
    bossSpawned = true;
    ui.queueBanner(BOSS_IDENTITE.categorie + ' : ' + bossNomRang(bossRank(index))); // surtitre « BOSS », titre le nom (versionné) ; à la suite (§ E1.S) : n'écrase pas « NOUVEAU RECORD » ; sans record, « Vague n » est déjà effacée
    boss.spawn(index);
  }
  // Vague spéciale : annoncée par une seconde bannière, après « Vague n »
  if (specialType >= 0 && !specialAnnounced && acc[WAVE_TIME] >= WAVES.special.announceDelay) {
    specialAnnounced = true;
    ui.queueBanner(WAVES.special.labels[ENEMY_KEYS[specialType]] || WAVES.special.labelDefault, WAVES.banner.seconds, SFX.ALERT); // à la suite (§ E1.S) ; § E5.AD : l'alerte part avec la bannière
  }

  // Révision d'un robot (§ E1.B) : « MISE À JOUR DÉTECTÉE : TIREURS v2.0 », après « Vague n », avec l'alerte
  if (revisionIndex >= 0 && !revisionAnnounced && acc[WAVE_TIME] >= ENEMIES.revisionAnnounceDelay) {
    revisionAnnounced = true;
    ui.queueBanner(REVISION_TEXT[revisionIndex], ENEMIES.revisionBannerSeconds, SFX.ALERT); // l'alerte part avec la bannière (§ E1.S)
  }

  // Chrono (règle 6) : il descend jusqu'à 0 et y reste (prolongation d'une vague de boss, règle 8).
  if (acc[CLOCK] > 0) {
    acc[CLOCK] -= dt;
    if (acc[CLOCK] < 0) acc[CLOCK] = 0;
  }
  const overtime = acc[CLOCK] <= 0;
  // Chrono à zéro sans boss à attendre : la vague finit dans cette image (main, T5) — plus rien ne sort.
  if (overtime && !bossHolds()) return;
  frameSpawns = 0;
  // § E5.N (C10) : pendant le répit de la bascule, ni grappe, ni ouverture, ni complément, ni porteuse ; les traînards
  // déjà là sont replacés comme d'habitude (règle 5)
  if (REPIT[0] > 0) {
    REPIT[0] -= dt;
    if (REPIT[0] > 0) {
      relocateStragglers(dt);
      return;
    }
    REPIT[0] = 0;
  }
  // Élite porteuse (§ E2.C) : elle sort quand la fraction écoulée du chrono atteint CHESTS.carrier.at[k]. Après la remise
  // à zéro de frameSpawns (§ E2.I) : elle prend une des maxPerFrame apparitions de l'image, la grappe suit le plafond.
  if (carriersOut < carriersPlanned && !overtime && 1 - acc[CLOCK] / acc[CLOCK_TOTAL] >= CARRIER.at[carriersOut < CARRIER.at.length ? carriersOut : CARRIER.at.length - 1]) spawnCarrier();
  if (queueLen > 0) {
    // Règle 3 : une grappe par intervalle, tant que le chrono tourne.
    if (!overtime) {
      acc[NEXT] -= dt;
      if (acc[NEXT] <= 0) {
        if (emitCluster(0) > 0) intervalClusters++;
        acc[NEXT] += acc[INTERVAL];
        if (acc[NEXT] < 0) acc[NEXT] = 0; // pas de rattrapage en rafale après une image longue
      }
    }
    // Règles 2 et 4 : ouverture puis complément — jamais moins de minAlive vivants (tous comptent : boss, invocations).
    // Règle 4 bis (§ E1.S) : le complément n'a de butin que dans la limite de lootBudget robots par vague (à une grappe
    // près) ; au-delà, comme en prolongation (règle 8), ses robots portent EFLAG.NO_LOOT. L'ouverture n'est pas comptée.
    if (E.aliveCount < minAlive) {
      const noLoot = overtime && !WAVES.clock.overtimeLoot;
      while (E.aliveCount < minAlive) {
        const flags = noLoot || (opened && complement >= lootBudget) ? EFLAG.NO_LOOT : 0;
        const made = emitCluster(flags);
        if (made === 0) break;
        if (opened) {
          complement += made;
          if (flags !== 0) lootless += made;
        }
      }
    }
    if (!opened && E.aliveCount >= minAlive) opened = true;
  }
  relocateStragglers(dt);
}

/**
 * § E1.S : le chrono compte le temps RÉEL. main y verse, en PLAYING, ce que la simulation n'a pas reçu (realDt − simDt :
 * arrêt sur image, ralenti) — update(simDt) a déjà retiré simDt. Les apparitions restent en temps simulé.
 */
export function advanceClock(realDt, simDt) {
  if (!active || hold || !(acc[CLOCK] > 0)) return;
  acc[CLOCK] -= realDt - simDt;
  if (acc[CLOCK] < 0) acc[CLOCK] = 0;
}

export function isActive() {
  return active;
}

/** Vrai une fois la vague finie, jusqu'au startWave suivant. Évalué à l'appel (main le lit en F8). */
export function isCleared() {
  if (active && !hold && !boss.isActive()) {
    // § E1.A règles 7 et 8. Vague de boss : elle finit à la mort du boss, chrono à 0 ou non (boss lancé et plus
    // actif). Sinon — vague sans boss, ou boss annulé par F1 — : chrono à 0. Un boss de debug retient toujours la vague.
    // Elle ne dépend plus du nombre de vivants : les restants sont reportés à la vague suivante (§ E3.K, T5).
    if (hasBoss && !bossCancelled ? bossSpawned : acc[CLOCK] <= 0) {
      active = false;
      cleared = true;
    }
  }
  return cleared;
}

/** Le boss de la vague est attendu ou vivant : à 0 le chrono reste figé et la vague continue (prolongation). */
function bossHolds() {
  return boss.isActive() || (hasBoss && !bossCancelled && !bossSpawned);
}

/**
 * § E2.G bis G1 règle 3 : clignotement du butin qui sera perdu — 2 sous END_LOOT.fastSeconds, 1 sous blinkSeconds ou
 * en prolongation de boss, 0 sinon (hors vague, bac à sable, mode 'tout'). Entier : lu à chaque image sans allocation.
 */
export function lootBlink() {
  if (!active || hold || END_LOOT.mode === 'tout' || END_LOOT.mode === 'sol') return 0; // § E5.V : plus rien ne se perd
  const c = acc[CLOCK];
  if (c <= END_LOOT.fastSeconds && !(hasBoss && !bossCancelled && c <= 0)) return 2;
  if (c <= END_LOOT.blinkSeconds) return 1;
  return 0;
}

/** s restantes au chrono de la vague (0 hors vague). */
export function getClock() {
  return active ? acc[CLOCK] : 0;
}

/** Secondes restantes arrondies au-dessus, en entier (lu par le HUD à chaque image : jamais un flottant emballé, § V). */
export function getClockCeil() {
  return active ? Math.ceil(acc[CLOCK]) | 0 : 0;
}

/** Durée totale du chrono de la vague en cours (ou de la dernière). */
export function getClockTotal() {
  return acc[CLOCK_TOTAL];
}

/** Prolongation : vague active, chrono à 0, boss attendu ou vivant. */
export function isOvertime() {
  return active && acc[CLOCK] <= 0 && bossHolds();
}

/** Hook de test (__game.setWaveClock) : fixe le chrono restant de la vague en cours. */
export function debugSetClock(seconds) {
  if (!active || !(seconds >= 0)) return false;
  acc[CLOCK] = seconds;
  return true;
}

function bossPending() {
  return active && hasBoss && !bossCancelled && (!bossSpawned || (boss.isActive() && E.bossIndex < 0));
}

/** Robots en vie, + 1 si le boss de la vague n'est pas encore dans E (il n'y a plus de file : § E1.A). */
export function getRemaining() {
  return E.aliveCount + (bossPending() ? 1 : 0);
}

/** Effectif nominal : waveRobotCount(n), + 1 si la vague a un boss. */
export function getTotal() {
  return total + (hasBoss ? 1 : 0);
}

export function shouldShowArrows() {
  if (!active) return false;
  const r = getRemaining();
  return r > 0 && r < WAVES.arrows.threshold;
}

/** F1 : finit la vague, boss compris (§ K). */
export function debugFinish() {
  if (!active) return;
  acc[CLOCK] = 0; // 1. chrono à zéro
  if (hasBoss && !bossSpawned) bossCancelled = true; // 2. boss pas encore lancé : annulé
  if (boss.isActive() && E.bossIndex < 0) {
    // 3. arrivée en cours (alarme ou chute) : annulée
    boss.reset();
    if (hasBoss) bossCancelled = true;
  }
  enemies.killAll(DMG.NO_LOOT | DMG.SILENT); // 4. un boss vivant meurt par là, sans butin ni explosion
}

/** Bac à sable de test : tant que c'est vrai, rien ne sort, le chrono est figé et isCleared() reste faux. */
export function debugHold(on) {
  hold = !!on;
}

export function inspect(out) {
  out.index = index;
  out.active = active;
  out.cleared = cleared;
  out.total = getTotal();
  out.spawned = spawned;
  out.queued = 0; // plus de file depuis l'étape 1 (§ E1.A) : le sac est relu en boucle
  out.bag = queueLen;
  out.clock = active ? acc[CLOCK] : 0;
  out.clockTotal = acc[CLOCK_TOTAL];
  out.overtime = isOvertime();
  out.minAlive = minAlive;
  out.repit = REPIT[0]; // § E5.N (C10) : s de répit restantes
  out.repits = REPIT[1];
  out.interval = acc[INTERVAL];
  out.intervalClusters = intervalClusters;
  out.complement = complement;
  out.lootBudget = lootBudget; // § E1.S : robots de complément avec butin permis pour la vague
  out.lootless = lootless; // robots de complément sortis sans butin
  out.relocated = relocated;
  out.opened = opened;
  out.alive = E.aliveCount;
  out.remaining = getRemaining();
  out.isBoss = hasBoss;
  out.bossSpawned = bossSpawned;
  out.bossCancelled = bossCancelled;
  out.special = specialType >= 0 ? ENEMY_KEYS[specialType] : null;
  // révisions des robots (§ E1.B)
  out.revision = revisionIndex >= 0 ? REVISIONS[revisionIndex].key : null; // révision annoncée à cette vague
  out.revisionAnnounced = revisionAnnounced;
  out.squad = squad;
  out.squads = squads;
  const p = {};
  const s = {};
  for (let t = 0; t < ENEMY_COUNT; t++) {
    if (t === ENEMY.BOSS) continue;
    p[ENEMY_KEYS[t]] = planned[t];
    s[ENEMY_KEYS[t]] = spawnedByType[t];
  }
  out.planned = p;
  out.spawnedByType = s;
  // élites porteuses (§ E2.C) : prévues, sorties, en vie
  let carriersAlive = 0;
  for (let i = 0; i < E.count; i++) if (E.alive[i] === 1 && (E.flags[i] & EFLAG.ELITE) !== 0) carriersAlive++;
  out.carriers = { planned: carriersPlanned, spawned: carriersOut, alive: carriersAlive };
  // en plus du contrat (lecture seule, pour les tests et l'affichage de debug)
  out.time = acc[WAVE_TIME];
  out.hpMul = hpMul;
  out.dmgMul = dmgMul;
  out.showArrows = shouldShowArrows();
  out.carried = carried; // § E3.K : reportés au départ de la vague
  out.carryMoved = carryMoved; // § E4.F.4 : reportés rentrés par les bords depuis le départ (§ E3.K : repoussés)
  out.returning = returning; // § E4.F.4 : garés pas encore rentrés
}
