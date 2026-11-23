// Plan addictif, étape 2, chantier C — coffres (ARCHITECTURE.md § E2.C).
//
// Un coffre est une « cache de données » lâchée par une élite porteuse, le boss ou la capsule de ravitaillement. Au
// sol : un InstancedMesh PAR TAILLE (22/11 : coffre-1/3/5.glb, outils/blender/coffres_v2.py ; lueurs teintées par la
// rareté, attribut d'instance aTeinte), ramassé au contact du
// héros ou aspiré en fin de vague. Ramassé, il attend dans run.chests ; main ouvre alors l'état CHEST (jeu figé) et
// l'interface joue la roulette sur les 3 lots tirés ici (roll). Le joueur en garde un (take), relance, passe ou bannit.
// L'aura au sol des porteuses est le dernier InstancedMesh du module. Un appel de dessin par taille de coffre présente
// au sol, plus l'aura ; zéro quand il n'y a ni coffre ni porteuse.
//
// Hasard : flux PRIVÉ (mulberry32, graine = run.seed ^ sel), pour que ni randWave() ni randEvent() ne changent de
// nombre de tirages : la suite des vagues et le calendrier des événements restent ceux de la graine (§ E1.0, § E1.C).
//
// Allocation (§ V) : dropAt, update et sync n'allouent rien (tableaux typés, boucles en variables locales). roll, take
// et la vue construisent des chaînes : ils ne tournent que dans l'état CHEST, hors combat (§ E2.0.5).
import * as THREE from 'three';
import { STAT, ligneEvoArme, ligneStatX7 } from './config.js'; // § E5.X7 (H2, H3, H10) : évolution, stats en valeurs (weaponLignes n'est plus lu ici)
import {
  CHESTS,
  EFLAG,
  LOT,
  MODELES,
  PICK,
  RARITIES,
  RARITY,
  SFX,
  STAT_COUNT,
  STAT_MAX_LEVEL,
  WEAPON_COUNT,
  WEAPON_KEYS,
  WEAPONS,
  SHOP,
  chestFragments,
  chestRarity,
  chestWeaponTarget,
} from './config.js';
import * as CFG from './config.js'; // CHOICES (chantier D) lu par nom s'il existe
import { CARRIER_RARITY, CHEST_FLAG, END_LOOT } from './config.js'; // § E2.G bis : coffres exacts / gardés, anneau par rareté
import { ELITES, CHEST_FLAG_BOSS, RARITY_COUNT, bossRank, eliteChestSize } from './config.js'; // § E3.A : coffres de 1, 3 ou 5 lots
import { ARSENAL_RULES } from './config.js'; // § E3.N : bannissement d'une arme quand l'arsenal épuisé ouvre les autres
import { EVOLUTIONS, EVOLUTION_RULES, LOT_EVOLUTION } from './config.js'; // § E3.B : lot d'évolution
import * as journal from './journal.js'; // § E5.X10 (audit I5) : lots pris, relances, passes (journal des parties)
import { ARGF, BANS, E, F_X, F_Z, P, mods, run } from './state.js';
import { RECAP_T } from './config.js'; // § E5.E.2 : récap des ramassages
import { RAM_N } from './ramassage.js';
import { chargerPieces } from './anim/pieces.js';

let ctx = null;
let render = null;
let weapons = null;
let progression = null;
let audio = null;
let fx = null;
let agents = null; // chantier D (couture : repli = aucune arme exclue)
let items = null; // chantier F (couture : repli = pas de lot d'objet)
let evolutions = null; // § E3.B (repli : aucune évolution)
const EVO_IDS = new Int8Array(8); // évolutions prêtes au tirage (evolutions.ready)

const CAP = CHESTS.cap;
const LOTS = CHESTS.lots;
const MAXLOTS = ELITES.maxLots; // § E3.A : lots d'un gros lot au plus (5)
const JP = ELITES.jackpot;
const CS = ELITES.chestSize;
const SLOTS = CHESTS.weaponSlots;
const FULL_LEVEL = 1 + STAT_COUNT * (STAT_MAX_LEVEL - 1);
const TAU = Math.PI * 2;
const G = CHESTS.chest;
const AURA = CHESTS.carrier.aura;
const PICK_R2 = G.pickupRadius * G.pickupRadius;

// ----- Coffres au sol (pool fixe) ------------------------------------------------------------------------------------
const cX = new Float32Array(CAP);
const cZ = new Float32Array(CAP);
const cAge = new Float32Array(CAP);
const cMin = new Uint8Array(CAP); // rareté minimale des lots (boss : CHESTS.bossMinRarity)
const cPull = new Uint8Array(CAP); // 1 = aspiré vers le héros (fin de vague)
const cSize = new Uint8Array(CAP); // § E3.A : lots du coffre (1, 3 ou 5)
const cFlags = new Uint8Array(CAP); // § E2.G bis : CHEST_FLAG.EXACT (lots tous de la rareté cMin), CHEST_FLAG.KEEP (gardé en fin de vague)
const cTeinte = new Uint8Array(CAP); // 22/11 : rareté AFFICHÉE (couleur des lueurs), avant le plancher Noyau/Root de dropAt
const cFlash = new Float32Array(CAP); // lueur de fin de vague du coffre i (lue par les tests : debug)
let count = 0;
// 22/11 (coffres v2) : un maillage par taille — 0 : 1 lot, 1 : 3 lots, 2 : 5 lots (G.models, G.heights)
const TAILLES = G.models.length;
const meshes = [];
const matArrs = [];
const fxArrs = [];
const teinteArrs = [];
const nTaille = new Int32Array(TAILLES);
const prets = new Uint8Array(TAILLES);
const teinteRGB = new Float32Array(3 * RARITY_COUNT);
/** Indice du maillage d'un coffre de `size` lots. */
function tailleDe(size) {
  return size >= 5 ? 2 : size >= 3 ? 1 : 0;
}
let auraMesh = null;
let auraMat = null;
let auraCol = null;
let aurasShown = 0;
const auraRGB = new Float32Array(3 * RARITY_COUNT); // § E2.G bis G2 : une couleur d'anneau par rareté (Brut … Chiffré)
const BLINK = new Float64Array(2); // § E2.G bis G1 : [niveau 0 / 1 / 2, phase en tours]
let modelReady = false;
let modelSettled = null;
const CLOCK = new Float64Array(1); // s — horloge de l'aura et du flottement (temps simulé)

// ----- Coffres ramassés, en attente d'ouverture ----------------------------------------------------------------------
const PENDING_CAP = 64;
const pendingMin = new Uint8Array(PENDING_CAP);
const pendingSize = new Uint8Array(PENDING_CAP); // § E3.A : 1, 3 ou 5 lots
const pendingExact = new Uint8Array(PENDING_CAP); // § E2.G bis G2 : coffre de porteuse — lots tous de la rareté pendingMin
let pending = 0; // = run.chests (tenu ici et recopié : run.chests est la valeur lue par main)

// ----- Compteurs (inspect) -------------------------------------------------------------------------------------------
let dropped = 0;
let pickedUp = 0;
let autoOpened = 0; // coffres crédités d'office (pool plein)
let lost = 0; // § E2.G bis : coffres perdus en fin de vague
let kept = 0; // § E2.G bis : coffres gardés (aspirés) en fin de vague
const droppedByRarity = new Int32Array(RARITY_COUNT);
export const openedBySize = new Int32Array(MAXLOTS + 1); // § E3.A : coffres ouverts, par nombre de lots
const droppedBySize = new Int32Array(MAXLOTS + 1); // coffres de porteuses lâchés, par rareté
let opened = 0; // coffres dont un lot a été pris
let skipped = 0;
let rerolled = 0;
let banished = 0;
let rolls = 0;
const takenByKind = new Int32Array(LOT_EVOLUTION + 1); // § E3.B : + le lot d'évolution
const takenByRarity = new Int32Array(RARITIES.length);
let levelsFromChests = 0; // niveaux d'arme posés par les coffres (hors niveau 1 d'une arme nouvelle)
let weaponsFromChests = 0;
let declined = 0; // § E2.S S1 : offres d'arme garantie déclinées (lot pris ailleurs, ou coffre passé)
let forcedNext = null; // debug : raretés imposées au prochain tirage

// ----- Hasard privé --------------------------------------------------------------------------------------------------
const LOOT_SALT = 0xc2b2ae35;
const seed = new Int32Array(1);
/** [0, 1) — flux du butin des coffres (tirage des lots, type des porteuses). */
export function lootRand() {
  const s = (seed[0] + 0x6d2b79f5) | 0;
  seed[0] = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ----- Vue persistante de l'écran CHEST ------------------------------------------------------------------------------
function hexString(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}
const view = {
  open: false,
  serial: 0, // +1 à chaque tirage : l'interface rejoue la roulette quand il change
  count: 0, // lots proposés (3, moins si le tirage est épuisé)
  lots: [],
  rerolls: 0,
  skips: 0,
  banishes: 0,
  pending: 0, // coffres encore en attente APRÈS celui-ci
  wave: 0,
  minRarity: 0,
  exact: false, // § E2.G bis G2 : coffre de porteuse, lots tous de la rareté minRarity
  size: 1, // § E3.A : lots du coffre (1 : on en garde un ; 3 ou 5 : le gros lot, tous gagnés)
  big: false,
  stagger: JP.stagger, // gros lot : écart entre l'arrêt de deux bandes (s)
  firstStop: JP.firstStop, // gros lot : arrêt de la première bande (s)
  maxRarity: 0, // plus haute rareté des lots (durée de la révélation)
  revealSeconds: 0, // durée de la roulette avant qu'un lot puisse être pris
  skippable: false, // Entrée peut passer l'animation (faux pendant les CHESTS.roulette.unskippable premiers coffres)
  guarantee: -1, // § E2.S S1 : indice du lot d'arme garantie (joueur en retard sur le calendrier), −1 sinon
  evo: -1, // § E3.B : indice du lot d'évolution (toujours gagné : ni relance, ni passe, ni bannissement), −1 sinon
  rarities: RARITIES.map((r) => ({ key: r.key, name: r.name, color: hexString(r.color) })),
};
for (let k = 0; k < MAXLOTS; k++) {
  view.lots.push({ kind: LOT.FRAGMENTS, kindKey: 'fragments', id: -1, rarity: 0, rarityName: '', color: '#ffffff', levels: new Uint8Array(STAT_COUNT), made: 0, stacks: 0, value: 0, name: '', desc: '', tag: '', icon: '', statLabels: [], lines: [] });
}
const usedWeapons = new Uint8Array(32);
const usedItems = new Int16Array(MAXLOTS).fill(-1);
let newDrawn = 0; // § E3.A : armes nouvelles déjà tirées dans ce coffre (un gros lot ne dépasse pas les emplacements)
let usedFragments = false;
const itemOut = { id: -1, stacks: 1, name: '', desc: '', icon: '', have: 0 }; // have : § E5.L

export function init(context) {
  ctx = context;
  render = ctx.render;
  weapons = ctx.weapons;
  progression = ctx.progression;
  audio = ctx.audio;
  fx = ctx.fx || null;
  agents = ctx.agents || null;
  items = ctx.items || null;
  evolutions = ctx.evolutions || null; // § E3.B

  // Coffres : modèle Blender chargé en arrière-plan (géométrie vide d'ici là), comme la capsule de ravitaillement.
  // Coffres : un modèle Blender par taille, chargé en arrière-plan (géométrie vide d'ici là). Un seul matériau.
  const mat = render.createLitMaterial({ glowColor: G.glow, teinteLueurs: true });
  for (let r = 0; r < RARITY_COUNT; r++) render.writeColor(teinteRGB, r * 3, RARITIES[r].color, G.teinteGain);
  const charges = [];
  for (let k = 0; k < TAILLES; k++) {
    const m = render.createInstanced(render.emptyModelGeometry(), mat, CAP, { castShadow: true, name: 'coffres-' + k });
    m.receiveShadow = true;
    const at = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
    at.setUsage(THREE.DynamicDrawUsage);
    m.geometry.setAttribute('aTeinte', at); // gardé par render.setModelGeometry (attribut d'instance)
    meshes.push(m);
    matArrs.push(m.instanceMatrix.array);
    fxArrs.push(m.geometry.attributes.aFx.array);
    charges.push(
      chargerPieces(new URL('../' + MODELES.dir + G.models[k], import.meta.url).href, { cible: G.heights[k], emissifMateriau: true }).then(
        (d) => {
          render.setModelGeometry(m, d);
          teinteArrs[k] = m.geometry.attributes.aTeinte.array;
          fxArrs[k] = m.geometry.attributes.aFx.array;
          prets[k] = 1;
        },
        (e) => console.warn('Coffre illisible (les coffres restent ramassables, sans modèle) :', G.models[k], e),
      ),
    );
    teinteArrs.push(at.array);
  }
  modelSettled = Promise.all(charges).then(() => {
    modelReady = prets.every((v) => v === 1);
  });

  // Aura des porteuses : anneau plat posé au sol, additif, teinté par instance (il pulse).
  const ring = new THREE.RingGeometry(0.8, 1, 40, 1);
  ring.rotateX(-Math.PI / 2);
  const inner = new THREE.RingGeometry(0.55, 0.6, 40, 1);
  inner.rotateX(-Math.PI / 2);
  auraMesh = render.createInstanced(render.mergeParts([render.makePart(ring, 0xffffff, 0), render.makePart(inner, 0xffffff, 0)]), render.createUnlitMaterial({ additive: true }), CAP, { instanceColor: true, name: 'aura-elite' });
  auraMesh.renderOrder = -1; // sous les robots
  auraMat = auraMesh.instanceMatrix.array;
  auraCol = auraMesh.instanceColor.array;
  for (let r = 0; r < RARITY_COUNT; r++) render.writeColor(auraRGB, r * 3, RARITIES[r].color, CARRIER_RARITY.ringGain[r]); // § E3.A : Noyau, Root
}

/** Promesse tenue (jamais rejetée) quand le modèle du coffre est posé ou illisible : main refait alors un préchauffage. */
export function whenModelSettled() {
  return modelSettled;
}

// Retour de Femz du 16/11/2026 (point 4) : « rareté: arme (a revoir, arme n'est pas un niveau de rareté) » — la fenêtre
// d'une arme montre la rareté du LOT qui l'a donnée (Brut → Root) ; −1 = arme sans lot (signature, debug) : pas de pastille.
const WEAPON_RARITY = new Int8Array(WEAPON_COUNT).fill(-1);
/** Rareté (indice de RARITIES) du lot de coffre qui a donné l'arme w, −1 si aucun. Hors chemin chaud (pause). */
export function weaponRarity(w) {
  return w >= 0 && w < WEAPON_COUNT ? WEAPON_RARITY[w] : -1;
}

export function reset() {
  WEAPON_RARITY.fill(-1);
  count = 0;
  pending = 0;
  run.chests = 0;
  CLOCK[0] = 0;
  dropped = 0;
  pickedUp = 0;
  autoOpened = 0;
  lost = 0;
  kept = 0;
  droppedByRarity.fill(0);
  openedBySize.fill(0);
  droppedBySize.fill(0);
  BLINK.fill(0);
  opened = 0;
  skipped = 0;
  rerolled = 0;
  banished = 0;
  rolls = 0;
  takenByKind.fill(0);
  takenByRarity.fill(0);
  levelsFromChests = 0;
  weaponsFromChests = 0;
  declined = 0;
  view.open = false;
  view.guarantee = -1;
  seed[0] = (run.seed ^ LOOT_SALT) | 0;
  if (!ctx.agents) {
    // Couture avec le chantier D (relance, passe, bannissement) : tant qu'il n'est pas fusionné, les compteurs et les
    // bannissements de la partie sont remis ici à leur valeur du socle.
    run.rerolls = 2;
    run.skips = 1;
    run.banishes = 1;
    BANS.weapons.fill(0);
    BANS.items.fill(0);
  }
}

// ----- Au sol ----------------------------------------------------------------------------------------------------------

function enqueue(minRarity, exact, size) {
  if (pending < PENDING_CAP) {
    pendingMin[pending] = minRarity;
    pendingExact[pending] = exact;
    pendingSize[pending] = size;
    pending++;
  }
  run.chests = pending;
}

/**
 * Un coffre tombe en (x, z). minRarity : rareté minimale de ses lots. Pool plein (CHESTS.cap) : le coffre est crédité
 * d'office (il s'ouvrira comme les autres). Aucun flottant créé ; (x, z) sont des entiers ou des lectures de tableaux
 * typés chez tous les appelants (damage, boss, events).
 */
export function dropAt(x, z, minRarity, flags = 0) {
  dropped++;
  let exact = (flags & CHEST_FLAG.EXACT) !== 0 ? 1 : 0;
  if (exact === 1 && minRarity >= 0 && minRarity < RARITY_COUNT) droppedByRarity[minRarity]++;
  // § E3.A règle 4 : taille du coffre — boss selon son rang, porteuse selon sa rareté (Chiffré : un tirage de plus)
  const size = (flags & CHEST_FLAG_BOSS) !== 0 ? eliteChestSize(minRarity, true, bossRank(run.wave), 0) : exact === 1 ? eliteChestSize(minRarity, false, 0, minRarity === RARITY.CHIFFRE ? lootRand() : 1) : 1;
  // 22/11 : la couleur des lueurs garde la rareté de la porteuse (Noyau, Root), même ramenée au plancher ci-dessous
  const teinte = minRarity < 0 ? 0 : minRarity >= RARITY_COUNT ? RARITY_COUNT - 1 : minRarity;
  // Noyau et Root n'ont pas de niveaux d'arme à eux : leurs lots sont tirés au-dessus du plancher du gros lot
  if (minRarity > RARITY.CHIFFRE) {
    minRarity = size >= 5 ? CS.floor5 : CS.floor3;
    exact = 0;
    flags &= ~CHEST_FLAG.EXACT;
  }
  droppedBySize[size]++;
  if (count >= CAP) {
    autoOpened++;
    enqueue(minRarity, exact, size);
    return;
  }
  const i = count++;
  cX[i] = x;
  cZ[i] = z;
  cAge[i] = 0;
  cMin[i] = minRarity;
  cPull[i] = 0;
  cFlags[i] = flags;
  cSize[i] = size;
  cTeinte[i] = teinte;
  audio.play(SFX.CHEST_DROP, x, z);
}

/** Fin de vague (T5) : les coffres au sol sont aspirés vers le héros, avec le butin. */
export function attractAll() {
  for (let i = 0; i < count; i++) cPull[i] = 1;
}

/** § E5.V (Femz, 20/11 : « aspire ») — bascule après un boss : les coffres gardés (KEEP : boss, rattrapage) sont aspirés. */
export function attirerGardes() {
  let n = 0;
  for (let i = 0; i < count; i++) {
    if ((cFlags[i] & CHEST_FLAG.KEEP) === 0 || cPull[i] === 1) continue;
    cPull[i] = 1;
    n++;
  }
  return n;
}

/** Retire le coffre i du sol : le dernier prend sa place. */
function removeAt(i) {
  const last = --count;
  cX[i] = cX[last];
  cZ[i] = cZ[last];
  cAge[i] = cAge[last];
  cMin[i] = cMin[last];
  cSize[i] = cSize[last];
  cTeinte[i] = cTeinte[last];
  cPull[i] = cPull[last];
  cFlags[i] = cFlags[last];
}

/** § E2.G bis G1 règle 2 : le coffre i est-il gardé en fin de vague ? `late` : joueur en retard sur le calendrier d'armes. */
function keptAtEnd(i, late, radius2) {
  if ((cFlags[i] & CHEST_FLAG.KEEP) !== 0 || late) return true;
  const mode = END_LOOT.mode;
  if (mode === 'tout') return true;
  if (mode === 'rayon') {
    const dx = P.x - cX[i];
    const dz = P.z - cZ[i];
    return dx * dx + dz * dz <= radius2;
  }
  return false;
}

/**
 * § E2.S S1 : joueur en retard sur le calendrier d'armes — garantie d'arme nouvelle au tirage, règle 2c (tout coffre au
 * sol gardé) et règle 2b (coffre de rattrapage, damage.js). Une offre garantie déclinée compte comme un cran tenu.
 */
export function isLate() {
  const target = chestWeaponTarget(run.wave);
  return (target < SLOTS ? target : SLOTS) > weapons.slotCount + declined;
}
function lateOnCalendar() {
  return isLate();
}

/**
 * § E2.G bis G1 (T5, après pickups.endWave) : remplace attractAll. Coffre gardé → aspiré ; sinon il se désintègre
 * (END_LOOT.voxelsPerChest voxels de purge) et il est perdu.
 */
export function endWave() {
  const late = lateOnCalendar();
  const r = END_LOOT.radius;
  const radius2 = r * r;
  for (let i = count - 1; i >= 0; i--) {
    if (keptAtEnd(i, late, radius2)) {
      cPull[i] = 1;
      kept++;
      continue;
    }
    lost++;
    if (fx !== null) {
      ARGF[F_X] = cX[i];
      ARGF[F_Z] = cZ[i];
      fx.spawnPurgeLootF(1, END_LOOT.voxelsPerChest);
    }
    removeAt(i);
  }
}

/** § E2.G bis G1 règle 3 : niveau de clignotement de l'image (waves.lootBlink), posé par main avant update. */
export function setBlink(level) {
  BLINK[0] = level;
}

/** T5, après l'aspiration : ce qui reste au sol est crédité d'office (comme pickups.collectAll). */
export function collectAll() {
  for (let i = 0; i < count; i++) {
    pickedUp++;
    enqueue(cMin[i], (cFlags[i] & CHEST_FLAG.EXACT) !== 0 ? 1 : 0, cSize[i]);
  }
  count = 0;
}

export function getGroundCount() {
  return count;
}

/** S10 bis (après pickups.update) : flottement, aspiration, ramassage au contact du héros. */
export function update(dt) {
  CLOCK[0] += dt;
  if (BLINK[0] > 0) {
    // § E5.A.6 bis (Femz, 17/11 11h : « oui » pour les coffres aussi) : signal 'doux' = pouls lent, comme les gemmes
    const sig = END_LOOT.signal;
    const doux = sig !== 'clignote' && sig !== undefined;
    BLINK[1] += dt * (sig === 'aucun' ? 0 : doux ? (BLINK[0] >= 2 ? END_LOOT.doux.hzFin : END_LOOT.doux.hz) : BLINK[0] >= 2 ? END_LOOT.fastHz : END_LOOT.blinkHz);
    if (BLINK[1] >= 1) BLINK[1] -= Math.floor(BLINK[1]);
  } else BLINK[1] = 0;
  for (let i = count - 1; i >= 0; i--) {
    cAge[i] += dt;
    const dx = P.x - cX[i];
    const dz = P.z - cZ[i];
    const d2 = dx * dx + dz * dz;
    if (P.alive && d2 <= PICK_R2) {
      pickedUp++;
      RAM_N[RECAP_T.CACHE]++; // § E5.E.2 : récap des ramassages du HUD
      enqueue(cMin[i], (cFlags[i] & CHEST_FLAG.EXACT) !== 0 ? 1 : 0, cSize[i]);
      removeAt(i);
      continue;
    }
    if (cPull[i] === 1 && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      let step = G.vacuumSpeed * dt;
      if (step > d) step = d;
      cX[i] += (dx / d) * step;
      cZ[i] += (dz / d) * step;
    }
  }
}

/** F11 : coffres au sol (flottement, rotation lente) et aura des porteuses en vie. */
export function sync() {
  const t = CLOCK[0];
  nTaille.fill(0);
  // § E2.G bis G1 règle 3 : phase « éteinte » du clignotement, pour les coffres qui seront perdus.
  // § E5.A.6 bis : en signal 'doux' (défaut), ni changement de taille ni éclair — une lueur qui monte et descend
  // lentement (0 → END_LOOT.doux.lueur) ; en 'aucun', rien ; 'clignote' = l'ancien effet.
  const sig = END_LOOT.signal;
  const doux = sig !== 'clignote' && sig !== undefined;
  const sigOn = BLINK[0] > 0 && sig !== 'aucun';
  const off = sigOn && (doux || BLINK[1] >= 0.5);
  const lueurDouce = doux ? END_LOOT.doux.lueur * (0.5 - 0.5 * Math.cos(BLINK[1] * TAU)) : 0;
  const late = off && lateOnCalendar();
  const rB = END_LOOT.radius;
  const blinkR2 = rB * rB;
  for (let i = 0; i < count; i++) {
    const a = cAge[i];
    // il tombe en rebondissant (0,35 s), puis flotte
    let pop = a * 2.857;
    if (pop > 1) pop = 1;
    let s = 0.6 + 0.4 * pop * (2 - pop);
    let flash = 0;
    if (off && cPull[i] === 0 && !keptAtEnd(i, late, blinkR2)) {
      if (doux) flash = lueurDouce;
      else {
        s *= END_LOOT.blinkScale;
        flash = END_LOOT.blinkFlash;
      }
    }
    cFlash[i] = flash;
    const k = tailleDe(cSize[i]);
    const j = nTaille[k]++;
    const fxArr = fxArrs[k];
    fxArr[j * 2] = flash;
    fxArr[j * 2 + 1] = 0;
    const ta = teinteArrs[k];
    const tr = cTeinte[i] * 3;
    ta[j * 3] = teinteRGB[tr];
    ta[j * 3 + 1] = teinteRGB[tr + 1];
    ta[j * 3 + 2] = teinteRGB[tr + 2];
    const y = G.bob * (1 + Math.sin(a * G.bobHz * TAU)) + (1 - pop) * (1 - pop) * 1.2;
    const rot = a * G.spin;
    const c = Math.cos(rot) * s;
    const sn = Math.sin(rot) * s;
    const o = j * 16;
    const matArr = matArrs[k];
    matArr[o] = c;
    matArr[o + 1] = 0;
    matArr[o + 2] = -sn;
    matArr[o + 3] = 0;
    matArr[o + 4] = 0;
    matArr[o + 5] = s;
    matArr[o + 6] = 0;
    matArr[o + 7] = 0;
    matArr[o + 8] = sn;
    matArr[o + 9] = 0;
    matArr[o + 10] = c;
    matArr[o + 11] = 0;
    matArr[o + 12] = cX[i];
    matArr[o + 13] = y;
    matArr[o + 14] = cZ[i];
    matArr[o + 15] = 1;
  }
  for (let k = 0; k < TAILLES; k++) {
    const m = meshes[k];
    const n = prets[k] === 1 ? nTaille[k] : 0;
    render.commit(m, n);
    if (n > 0) m.geometry.attributes.aTeinte.needsUpdate = true;
  }

  let n = 0;
  const FL = E.flags;
  const AL = E.alive;
  const pulse = 1 + AURA.pulseAmp * Math.sin(t * AURA.pulseHz * TAU);
  for (let i = 0; i < E.count && n < CAP; i++) {
    if (AL[i] === 0 || (FL[i] & EFLAG.ELITE) === 0 || E.sus[i] === 2) continue; // § E4.F : porteuse garée, anneau non dessiné
    // § E2.S S3 : l'anneau dépasse la carrosserie des gros robots (blindé porteur : ≈ 3,1 m au lieu de 1,6 m)
    const body = E.radius[i] * AURA.bodyMul;
    const r = (body > AURA.radius ? body : AURA.radius) * pulse;
    const rot = t * 0.8;
    const c = Math.cos(rot) * r;
    const sn = Math.sin(rot) * r;
    const o = n * 16;
    auraMat[o] = c;
    auraMat[o + 1] = 0;
    auraMat[o + 2] = -sn;
    auraMat[o + 3] = 0;
    auraMat[o + 4] = 0;
    auraMat[o + 5] = 1;
    auraMat[o + 6] = 0;
    auraMat[o + 7] = 0;
    auraMat[o + 8] = sn;
    auraMat[o + 9] = 0;
    auraMat[o + 10] = c;
    auraMat[o + 11] = 0;
    auraMat[o + 12] = E.x[i];
    auraMat[o + 13] = AURA.y;
    auraMat[o + 14] = E.z[i];
    auraMat[o + 15] = 1;
    const q = n * 3;
    const rr = E.rarity[i] * 3; // § E2.G bis G2 : couleur de la rareté de la porteuse
    auraCol[q] = auraRGB[rr];
    auraCol[q + 1] = auraRGB[rr + 1];
    auraCol[q + 2] = auraRGB[rr + 2];
    n++;
  }
  aurasShown = n;
  render.commit(auraMesh, n);
}

// ----- Tirage des lots (état CHEST, hors combat) ------------------------------------------------------------------------

function isWeaponDrawable(w) {
  if (weapons.owned[w] === 1 || usedWeapons[w] === 1) return false;
  if (WEAPONS[w].lootable === false || BANS.weapons[w] === 1) return false;
  if (agents !== null && agents.excludes(w)) return false;
  if (weapons.absorbed && weapons.absorbed[w] === 1) return false; // § E3.B : arme absorbée par une évolution
  if (meta.WEAPON_OK[w] === 0) return false; // § E4.A.5 : arme verrouillée (méta)
  return true;
}

function countDrawableWeapons() {
  let n = 0;
  for (let w = 0; w < WEAPON_COUNT; w++) if (isWeaponDrawable(w)) n++;
  return n;
}

function isWeaponUpgradable(w) {
  return weapons.owned[w] === 1 && usedWeapons[w] === 0 && weapons.getWeaponLevel(w) < FULL_LEVEL;
}

function pickAmong(test) {
  let n = 0;
  for (let w = 0; w < WEAPON_COUNT; w++) if (test(w)) n++;
  if (n === 0) return -1;
  let pick = Math.floor(lootRand() * n);
  if (pick >= n) pick = n - 1;
  for (let w = 0; w < WEAPON_COUNT; w++) {
    if (!test(w)) continue;
    if (pick === 0) return w;
    pick--;
  }
  return -1;
}

function isOverchargeable(w) {
  return weapons.owned[w] === 1 && usedWeapons[w] === 0 && weapons.getWeaponLevel(w) >= FULL_LEVEL;
}

// § E5.X7 (H3 / C5) : la VALEUR avant → après (« Perforation : 0 → 1 robot traversé ») au lieu du rang (« +1 Perforation »).
// Même calcul que le marchand (shop.getView) : la stat effective (bonus compris) × le rapport des valeurs de table.
// La stat cachée d'une arme à recharge (canon lourd : « Durée » = la ligne Agit) n'a pas de ligne. Hors combat.
function statLines(w, lot) {
  lot.lines.length = 0;
  const own = weapons.owned[w] === 1;
  const neuve = lot.kind === LOT.WEAPON_NEW; // arme nouvelle : la valeur à son arrivée (« Dégâts : 14 »), jamais « avant »
  const R = CFG.RECHARGES && CFG.RECHARGES.weapons ? CFG.RECHARGES.weapons[CFG.WEAPON_KEYS[w]] : null;
  const cache = R && R.hideStat >= 0 && ctx.cooldowns && ctx.cooldowns.isCooldown(0, w) ? R.hideStat : -1;
  for (let s = 0; s < STAT_COUNT; s++) {
    const k = lot.levels[s];
    if ((k <= 0 && !(neuve && s <= STAT.RATE)) || s === cache) continue; // nouvelle arme : Dégâts et Cadence toujours
    const lv = own ? weapons.getLevel(w, s) : 1;
    const base = weapons.getStatAt(w, s, lv);
    const cur = weapons.getStat(w, s);
    const next = base !== 0 ? (cur / base) * weapons.getStatAt(w, s, lv + k) : weapons.getStatAt(w, s, lv + k);
    lot.lines.push(ligneStatX7(w, s, neuve ? -1 : cur, next));
  }
}

function setRarity(lot, r) {
  lot.rarity = r;
  lot.rarityName = RARITIES[r].name;
  lot.color = view.rarities[r].color;
}

function fillWeaponNew(lot, w, r) {
  lot.kind = LOT.WEAPON_NEW;
  lot.kindKey = 'weaponNew';
  lot.id = w;
  setRarity(lot, r);
  lot.made = weapons.rollLevels(w, RARITIES[r].levels, lot.levels, lootRand);
  lot.stacks = 0;
  lot.value = 0;
  lot.name = WEAPONS[w].name;
  // § E5.X7 (H10) : « Niveau 1 : Dégâts 12 » portait deux chiffres ; le niveau sur sa ligne, les valeurs à l'arrivée dans
  // les lignes du lot (statLines : Dégâts et Cadence, plus les stats montées par le lot)
  lot.desc = WEAPONS[w].desc + '\nNiveau ' + (1 + lot.made); // était : desc + '\n' + weaponLignes(w)
  const CD = ctx.cooldowns; // § E4.G : source à recharge — les chiffres de sa salve au niveau que l'arme aura
  if (CD && CD.isCooldown(0, w)) lot.desc += '\n' + CD.salvesTexte(0, w, 0, 1 + lot.made);
  const evoN = ligneEvoArme(w, meta.evoConnue); // § E5.X7 (H2) : avec quoi l'arme évolue
  if (evoN) lot.desc += '\n' + evoN;
  lot.tag = CHESTS.text.newWeapon;
  lot.icon = 'sr-w' + w;
  lot.statLabels = WEAPONS[w].statLabels;
  statLines(w, lot);
  usedWeapons[w] = 1;
  newDrawn++;
}

function fillWeaponUp(lot, w, r) {
  if (r < RARITY.COMPILE) r = RARITY.COMPILE; // arme déjà possédée : le gris n'existe pas (0 niveau = rien)
  lot.kind = LOT.WEAPON_UP;
  lot.kindKey = 'weaponUp';
  lot.id = w;
  setRarity(lot, r);
  lot.made = weapons.rollLevels(w, RARITIES[r].levels, lot.levels, lootRand);
  lot.stacks = 0;
  lot.value = 0;
  lot.name = WEAPONS[w].name;
  // § E5.X7 (H3) : la phrase de l'arme d'abord (le lot n'en avait pas), puis le niveau
  lot.desc = WEAPONS[w].desc + '\nNiveau ' + weapons.getWeaponLevel(w) + ' → ' + (weapons.getWeaponLevel(w) + lot.made);
  const CD = ctx.cooldowns; // § E4.G : l'effet, puis « Recharge 7,0 s → 6,8 s · Action 2,0 s → 2,2 s »
  if (CD && CD.isCooldown(0, w)) lot.desc += '\n' + CD.salvesTexte(0, w, weapons.getWeaponLevel(w), weapons.getWeaponLevel(w) + lot.made);
  const evoU = ligneEvoArme(w, meta.evoConnue); // § E5.X7 (H2)
  if (evoU) lot.desc += '\n' + evoU;
  lot.tag = CHESTS.text.upWeapon;
  lot.icon = 'sr-w' + w;
  lot.statLabels = WEAPONS[w].statLabels;
  statLines(w, lot);
  usedWeapons[w] = 1;
}

function fillItem(lot, r, slot) {
  if (items === null) return false;
  itemOut.id = -1;
  if (!items.rollOffer(r, itemOut, lootRand, usedItems) || itemOut.id < 0) return false;
  lot.kind = LOT.ITEM;
  lot.kindKey = 'item';
  lot.id = itemOut.id;
  setRarity(lot, r);
  lot.levels.fill(0);
  lot.made = 0;
  lot.stacks = itemOut.stacks > 0 ? itemOut.stacks : 1;
  lot.value = 0;
  lot.name = itemOut.name;
  lot.desc = itemOut.desc;
  lot.tag = CHESTS.text.item;
  lot.icon = itemOut.icon || 'sr-b-default';
  lot.lines.length = 0;
  //#region e5:L-textes-guide
  // § E5.L (C3) : exemplaires écrits comme au choix de niveau — « Nouveau : ×2 », « Possédé ×3 → ×5 »
  const have = itemOut.have > 0 ? itemOut.have : 0;
  const IT = CFG.CHOICES.itemText;
  lot.lines.push(have > 0 ? IT.possede + '\u00d7' + have + ' \u2192 \u00d7' + (have + lot.stacks) : IT.nouveau + '\u00d7' + lot.stacks);
  //#endregion e5:L-textes-guide
  usedItems[slot] = itemOut.id;
  return true;
}

function fillOvercharge(lot, w, r) {
  lot.kind = LOT.OVERCHARGE;
  lot.kindKey = 'overcharge';
  lot.id = w;
  setRarity(lot, r);
  lot.levels.fill(0);
  lot.made = 0;
  lot.stacks = 1;
  lot.value = 0;
  lot.name = WEAPONS[w].name;
  //#region e5:L-textes-guide
  // § E5.L (C17) : le gain réel (+8 % par lot, SHOP.overcharge.damagePerLevel) et le total après le lot, sans « cran »
  const pas = Math.round(100 * SHOP.overcharge.damagePerLevel);
  lot.desc = CHESTS.text.surchargeDesc.replace('{p}', String(pas));
  lot.tag = CHESTS.text.overcharge;
  lot.icon = 'sr-w' + w;
  lot.lines.length = 0;
  lot.lines.push(CHESTS.text.surchargeTotal.replace('{t}', String(Math.round(100 * (weapons.getOvercharge(w) + 1) * SHOP.overcharge.damagePerLevel))));
  //#endregion e5:L-textes-guide
  usedWeapons[w] = 1;
}

function fillFragments(lot, r) {
  lot.kind = LOT.FRAGMENTS;
  lot.kindKey = 'fragments';
  lot.id = -1;
  setRarity(lot, r);
  lot.levels.fill(0);
  lot.made = 0;
  lot.stacks = 0;
  lot.value = Math.round(chestFragments(run.wave) * (1 + 0.5 * r));
  lot.name = lot.value + ' fragments';
  lot.desc = 'Mémoire brute, à dépenser chez le marchand.';
  lot.tag = CHESTS.text.fragments;
  lot.icon = 'sr-i-frag';
  lot.lines.length = 0;
  usedFragments = true;
}

/** Tire le lot `slot`. forceNew : garantie d'arme nouvelle (retard sur le calendrier). Rend false si plus rien à tirer. */
function drawLot(slot, forceNew, forcedRarity) {
  const lot = view.lots[slot];
  // § E2.G bis G2 : coffre de porteuse — tous ses lots sont de sa rareté (la Puce de chance peut encore en monter un)
  let r = forcedRarity >= 0 ? forcedRarity : view.exact ? view.minRarity : chestRarity(run.wave > 0 ? run.wave : 1, lootRand(), view.minRarity);
  // Puce de chance (objet du chantier F) : une chance de monter d'un rang
  const luck = mods.luck > 0 ? mods.luck : 0;
  if (forcedRarity < 0 && luck > 0 && lootRand() < luck && r < RARITY.CHIFFRE) r++;
  const free = weapons.slotCount + (view.big ? newDrawn : 0) < SLOTS; // § E3.A : un gros lot gagne TOUS ses lots
  const canNew = free && countDrawableWeapons() > 0;
  let canUp = false;
  for (let w = 0; w < WEAPON_COUNT && !canUp; w++) canUp = isWeaponUpgradable(w);
  const canItem = items !== null;
  if (forceNew && canNew) {
    fillWeaponNew(lot, pickAmong(isWeaponDrawable), r);
    return true;
  }
  if (forceNew) view.guarantee = -1; // plus aucune arme à tirer : pas de garantie affichée
  const K = CHESTS.kindWeights;
  const wNew = canNew ? K.weaponNew : 0;
  const wUp = canUp ? K.weaponUp : 0;
  const wItem = canItem ? K.item : 0;
  const sum = wNew + wUp + wItem;
  let x = lootRand() * (sum > 0 ? sum : 1);
  if (sum > 0) {
    if (x < wNew) {
      fillWeaponNew(lot, pickAmong(isWeaponDrawable), r);
      return true;
    }
    x -= wNew;
    if (x >= wUp && wItem > 0 && fillItem(lot, r, slot)) return true;
  }
  // Ordre de priorité quand le genre tiré n'est pas possible (règle 7) : niveaux d'une arme possédée, objet,
  // surcharge d'une arme au niveau 21, fragments.
  if (canUp) {
    fillWeaponUp(lot, pickAmong(isWeaponUpgradable), r);
    return true;
  }
  if (canItem && fillItem(lot, r, slot)) return true;
  const oc = pickAmong(isOverchargeable);
  if (oc >= 0) {
    fillOvercharge(lot, oc, r);
    return true;
  }
  if (canNew) {
    fillWeaponNew(lot, pickAmong(isWeaponDrawable), r);
    return true;
  }
  if (!usedFragments) {
    fillFragments(lot, r);
    return true;
  }
  return false;
}

function finishView() {
  let top = 0;
  for (let k = 0; k < view.count; k++) if (view.lots[k].rarity > top) top = view.lots[k].rarity;
  const R = CHESTS.roulette;
  view.maxRarity = top;
  view.revealSeconds = R.spinSeconds + top * R.stepSeconds + R.holdSeconds;
  // § E3.A règle 5 : gros lot — les bandes s'arrêtent une à une, puis la garde
  if (view.big) view.revealSeconds = JP.firstStop + (view.count > 0 ? view.count - 1 : 0) * JP.stagger + JP.holdSeconds;
  view.skippable = opened + skipped >= R.unskippable;
  view.rerolls = run.rerolls;
  view.skips = run.skips;
  view.banishes = run.banishes;
  view.pending = pending > 0 ? pending - 1 : 0;
  view.wave = run.wave;
  view.serial++;
  view.open = true;
}

function rollLots(forced) {
  usedWeapons.fill(0);
  usedItems.fill(-1);
  usedFragments = false;
  newDrawn = 0;
  view.minRarity = pending > 0 ? pendingMin[0] : 0;
  view.exact = pending > 0 && pendingExact[0] === 1;
  // § E3.A règle 4 : k lots ; 3 ou 5 = le gros lot (tous gagnés), plancher de rareté Optimisé (3) ou Chiffré (5)
  const size = pending > 0 && pendingSize[0] > 1 ? pendingSize[0] : 1;
  view.size = size;
  view.big = size > 1;
  const nLots = view.big ? size : LOTS;
  if (view.big) {
    const floor = size >= 5 ? CS.floor5 : CS.floor3;
    if (view.minRarity < floor) {
      view.minRarity = floor;
      view.exact = false;
    }
  }
  // Garantie (règle 7, § E2.S S1) : en retard sur le calendrier d'armes, UN lot est une arme nouvelle ; sa place est
  // tirée sur le flux privé (un tirage de plus, seulement en retard). Il est tiré en premier (même tirage qu'avant).
  const late = isLate();
  view.guarantee = late ? Math.floor(lootRand() * nLots) : -1;
  if (view.guarantee >= nLots) view.guarantee = nLots - 1;
  let n = 0;
  if (late) {
    const g = view.guarantee;
    if (!drawLot(g, true, forced ? forced[g] : -1)) view.guarantee = -1;
  }
  for (let k = 0; k < nLots; k++) {
    if (k === view.guarantee) {
      n++;
      continue;
    }
    if (!drawLot(k, false, forced ? forced[k] : -1)) {
      // tirage épuisé avant la place garantie : l'arme garantie remonte à cette place (aucun lot vide avant elle)
      const g = view.guarantee;
      if (g > k) {
        const tmp = view.lots[k];
        view.lots[k] = view.lots[g];
        view.lots[g] = tmp;
        view.guarantee = k;
        n = k + 1;
      }
      break;
    }
    n++;
  }
  if (view.guarantee >= n) view.guarantee = -1;
  view.count = n;
  view.evo = -1;
  if (evolutions !== null && evolutions.ready(EVO_IDS) > 0) placeEvolution(EVO_IDS[0]); // § E3.B : priorité 1
  rolls++;
  finishView();
  return view;
}

/** T6b / T9b / T17 : tire les 3 lots du premier coffre en attente. Rend la vue persistante. */
export function roll() {
  if (forcedNext !== null) {
    const f = forcedNext;
    forcedNext = null;
    return rollLots(f);
  }
  return rollLots(null);
}

function consume() {
  for (let k = 1; k < pending; k++) {
    pendingMin[k - 1] = pendingMin[k];
    pendingExact[k - 1] = pendingExact[k];
    pendingSize[k - 1] = pendingSize[k];
  }
  if (pending > 0) pending--;
  run.chests = pending;
  view.open = false;
}

/** Prend le lot k du coffre ouvert : applique EXACTEMENT ce qui est affiché. */
export function take(k) {
  if (!view.open) return PICK.CLOSED;
  if (view.big) return takeAll(); // § E3.A : le gros lot ne se choisit pas, tout est gagné
  if (!Number.isInteger(k) || k < 0 || k >= view.count) return PICK.INVALID;
  const lot = view.lots[k];
  if (view.guarantee >= 0 && k !== view.guarantee && lot.kind !== LOT.WEAPON_NEW) declined++; // § E2.S S1
  if (applyLot(lot) !== PICK.OK) return PICK.INVALID;
  openedBySize[1]++;
  opened++;
  consume();
  return PICK.OK;
}

/** § E3.A règle 4 : gros lot — les k lots sont tous appliqués, dans l'ordre de leurs bandes, puis le coffre est consommé. */
export function takeAll() {
  if (!view.open) return PICK.CLOSED;
  if (!view.big) return PICK.INVALID;
  for (let k = 0; k < view.count; k++) applyLot(view.lots[k]);
  openedBySize[view.size <= MAXLOTS ? view.size : MAXLOTS]++;
  opened++;
  consume();
  return PICK.OK;
}

/** Applique EXACTEMENT ce que montre le lot (take et takeAll). */
function applyLot(lot) {
  if (lot.kind === LOT.WEAPON_NEW) {
    if (!weapons.unlock(lot.id)) return PICK.INVALID;
    WEAPON_RARITY[lot.id] = lot.rarity; // 16/11, point 4
    levelsFromChests += weapons.applyLevels(lot.id, lot.levels);
    weaponsFromChests++;
  } else if (lot.kind === LOT.WEAPON_UP) {
    levelsFromChests += weapons.applyLevels(lot.id, lot.levels);
  } else if (lot.kind === LOT.ITEM) {
    if (items !== null) items.add(lot.id, lot.stacks);
  } else if (lot.kind === LOT.OVERCHARGE) {
    weapons.addOvercharge(lot.id);
  } else if (lot.kind === LOT_EVOLUTION) {
    if (evolutions === null || !evolutions.apply(lot.id)) return PICK.INVALID; // § E3.B
  } else {
    progression.addFragments(lot.value);
  }
  takenByKind[lot.kind]++;
  takenByRarity[lot.rarity]++;
  //#region e5:X10-journal
  journal.carte(lot.name, lot.kind === LOT.WEAPON_NEW ? journal.SORTE.ARME_NEUVE : lot.kind === LOT.WEAPON_UP ? journal.SORTE.AMELIORATION : lot.kind === LOT.ITEM ? journal.SORTE.OBJET_COFFRE : lot.kind === LOT.OVERCHARGE ? journal.SORTE.SURVOLTAGE : lot.kind === LOT_EVOLUTION ? journal.SORTE.EVOLUTION : journal.SORTE.FRAGMENTS);
  //#endregion e5:X10-journal
  return PICK.OK;
}

/** Relance : nouveau tirage des 3 lots (la garantie d'arme nouvelle tient). */
export function reroll() {
  if (!view.open) return PICK.CLOSED;
  if (view.big) return PICK.INVALID; // § E3.A : ni relance, ni passe, ni bannissement au gros lot
  if (view.evo >= 0) return PICK.INVALID; // § E3.B : l'évolution est toujours gagnée
  if (!(run.rerolls > 0)) return PICK.NO_CHARGE;
  run.rerolls--;
  rerolled++;
  journal.relance(); // § E5.X10 : stats.relances
  rollLots(null);
  return PICK.OK;
}

/** Passer : le coffre est rendu contre des fragments. */
export function skip() {
  if (!view.open) return PICK.CLOSED;
  if (view.big) return PICK.INVALID;
  if (view.evo >= 0) return PICK.INVALID; // § E3.B
  if (!(run.skips > 0)) return PICK.NO_CHARGE;
  run.skips--;
  skipped++;
  journal.passe(); // § E5.X10
  if (view.guarantee >= 0) declined++; // § E2.S S1 : coffre passé avec une arme garantie
  const per = CFG.CHOICES && CFG.CHOICES.skipFragmentsPerWave > 0 ? CFG.CHOICES.skipFragmentsPerWave : CHESTS.skipFragmentsPerWave;
  progression.addFragments(per * (run.wave > 0 ? run.wave : 1));
  consume();
  return PICK.OK;
}

/**
 * Bannir le lot k : l'arme (jamais une arme possédée) ou l'objet ne sort plus de la partie, et le lot est tiré de
 * nouveau. Refusé si cela laisserait moins d'armes à tirer que d'emplacements libres.
 */
export function banish(k) {
  if (!view.open) return PICK.CLOSED;
  if (view.big) return PICK.INVALID;
  if (view.evo >= 0) return PICK.INVALID; // § E3.B
  if (!Number.isInteger(k) || k < 0 || k >= view.count) return PICK.INVALID;
  if (!(run.banishes > 0)) return PICK.NO_CHARGE;
  const lot = view.lots[k];
  if (lot.kind === LOT.WEAPON_NEW) {
    let pool = 0;
    for (let w = 0; w < WEAPON_COUNT; w++) {
      if (w === lot.id || weapons.owned[w] === 1 || WEAPONS[w].lootable === false || BANS.weapons[w] === 1) continue;
      // § E3.N (fusion du groupe 1) : avec ARSENAL_RULES.exhaustedOpensAll, l'arsenal épuisé ouvre toutes les autres
      // armes — un bannissement ne peut donc jamais priver le joueur d'armes à tirer ; le filtre de l'arsenal ne compte
      // ici que si cette règle est coupée (avant : refus dès qu'il restait moins d'armes D'ARSENAL que d'emplacements)
      if (agents !== null && !ARSENAL_RULES.exhaustedOpensAll && agents.excludes(w)) continue;
      pool++;
    }
    if (pool < SLOTS - weapons.slotCount) return PICK.INVALID;
    BANS.weapons[lot.id] = 1;
  } else if (lot.kind === LOT.ITEM) {
    BANS.items[lot.id] = 1;
    usedItems[k] = -1;
  } else return PICK.INVALID;
  run.banishes--;
  banished++;
  const late = k === view.guarantee;
  if (!drawLot(k, late, -1)) {
    if (late) view.guarantee = -1;
    // plus rien à tirer : le lot disparaît, les suivants remontent
    for (let j = k; j < view.count - 1; j++) {
      const a = view.lots[j];
      view.lots[j] = view.lots[j + 1];
      view.lots[j + 1] = a;
    }
    view.count--;
    if (view.guarantee > k) view.guarantee--;
  }
  finishView();
  return PICK.OK;
}

export function getView() {
  return view;
}

// ----- Debug -----------------------------------------------------------------------------------------------------------

/** Debug : un coffre de plus en attente, dont les lots auront les raretés données ([r0, r1, r2], −1 = tirée). */
export function debugOpen(rarities, size = 1) {
  forcedNext = Array.isArray(rarities) ? [0, 1, 2, 3, 4].map((k) => (Number.isInteger(rarities[k]) && rarities[k] >= 0 && rarities[k] < RARITIES.length ? rarities[k] : -1)) : null;
  enqueue(0, 0, size === 3 || size === 5 ? size : 1); // § E3.A : coffre de 1, 3 ou 5 lots
}

/** § E3.A, tests : le coffre ouvert est retiré sans rien appliquer (statistiques des tirages). */
export function debugDiscard() {
  consume();
}

/** § E3.A, tests : taille d'un coffre pour une rareté de porteuse (ou du boss de rang rank), tirée sur le flux privé. */
export function sizeFor(rarity, isBoss, rank) {
  return eliteChestSize(rarity, !!isBoss, rank | 0, rarity === RARITY.CHIFFRE && !isBoss ? lootRand() : 1);
}

/**
 * Debug : module d'objets factice (le chantier F n'est pas fusionné) — donne des lots de genre ITEM pour les tests.
 * Même interface que la couture du contrat : rollOffer(rarity, out, rnd, taken) et add(id, n).
 */
const stubCounts = new Int32Array(8);
const stub = {
  rollOffer(rarity, out, rnd, taken) {
    let free = 0;
    for (let id = 0; id < 8; id++) if (BANS.items[id] === 0 && taken.indexOf(id) < 0) free++;
    if (free === 0) return false;
    let pick = Math.floor(rnd() * free);
    for (let id = 0; id < 8; id++) {
      if (BANS.items[id] === 1 || taken.indexOf(id) >= 0) continue;
      if (pick-- === 0) {
        out.id = id;
        out.stacks = 1 + rarity;
        out.name = 'Module de test ' + id;
        out.desc = 'Objet factice du mode debug (les vrais objets arrivent avec le chantier F).';
        out.icon = 'sr-b-default';
        return true;
      }
    }
    return false;
  },
  add(id, n) {
    stubCounts[id] += n;
  },
};
export function debugItemStub(on) {
  items = on ? stub : ctx.items || null;
  stubCounts.fill(0);
}

export function inspect(out) {
  out.ground = count;
  out.pending = pending;
  out.dropped = dropped;
  out.pickedUp = pickedUp;
  out.autoOpened = autoOpened;
  out.lost = lost; // § E2.G bis
  out.kept = kept;
  out.droppedByRarity = Array.from(droppedByRarity);
  out.droppedBySize = Array.from(droppedBySize); // § E3.A
  out.openedBySize = Array.from(openedBySize);
  out.pendingSizes = Array.from(pendingSize.subarray(0, pending));
  out.size = view.open ? view.size : 0;
  out.big = view.open && view.big;
  out.blink = BLINK[0];
  out.opened = opened;
  out.skipped = skipped;
  out.rerolled = rerolled;
  out.banished = banished;
  out.rolls = rolls;
  out.auras = aurasShown;
  // § E2.G bis G2 : couleur d'instance de chaque anneau affiché (tampon GPU relu tel quel), et la rareté qu'elle code
  const ac = [];
  for (let k = 0; k < aurasShown; k++) ac.push([auraCol[k * 3], auraCol[k * 3 + 1], auraCol[k * 3 + 2]]);
  out.auraColors = ac;
  out.ringRGB = Array.from(auraRGB);
  out.modele = modelReady;
  out.levelsFromChests = levelsFromChests;
  out.weaponsFromChests = weaponsFromChests;
  out.takenByKind = Array.from(takenByKind);
  out.takenByRarity = Array.from(takenByRarity);
  out.rerolls = run.rerolls;
  out.skips = run.skips;
  out.banishes = run.banishes;
  out.open = view.open;
  out.stubItems = Array.from(stubCounts);
  const g = [];
  for (let i = 0; i < count; i++) g.push({ x: cX[i], z: cZ[i], minRarity: cMin[i], pulled: cPull[i] === 1, exact: (cFlags[i] & CHEST_FLAG.EXACT) !== 0, size: cSize[i], keep: (cFlags[i] & CHEST_FLAG.KEEP) !== 0, flash: cFlash[i], teinte: cTeinte[i] });
  out.chests = g;
  out.lots = [];
  if (view.open) {
    for (let k = 0; k < view.count; k++) {
      const l = view.lots[k];
      out.lots.push({ kind: l.kind, kindKey: l.kindKey, id: l.id, key: l.kind <= LOT.WEAPON_UP || l.kind === LOT.OVERCHARGE ? WEAPON_KEYS[l.id] : null, rarity: l.rarity, levels: Array.from(l.levels), made: l.made, stacks: l.stacks, value: l.value, name: l.name, lines: l.lines.slice() });
    }
    out.revealSeconds = view.revealSeconds;
    out.skippable = view.skippable;
    out.minRarity = view.minRarity;
    out.exact = view.exact;
  }
  out.guarantee = view.open ? view.guarantee : -1; // § E2.S S1
  out.evo = view.open ? view.evo : -1; // § E3.B
  out.declined = declined;
  out.late = weapons !== null && isLate();
}

// ----- § E3.B : lot d'évolution ----------------------------------------------------------------------------------------
/**
 * Le coffre ouvert donne l'évolution id (règle du GDD, § E3.B) : dans un coffre de 1, elle REMPLACE les propositions
 * (un seul lot, toujours gagné) ; dans un gros lot, elle prend la première bande (le dernier lot tiré sort, les autres
 * descendent d'une bande). La recette est découverte ici : c'est le coffre qui la révèle (hors combat).
 */
function placeEvolution(id) {
  if (view.big && view.count > 0) {
    const tmp = view.lots[view.count - 1];
    for (let k = view.count - 1; k > 0; k--) view.lots[k] = view.lots[k - 1];
    view.lots[0] = tmp;
    if (view.guarantee >= 0) view.guarantee = view.guarantee + 1 < view.count ? view.guarantee + 1 : -1;
  } else {
    view.count = 1;
    view.guarantee = -1;
  }
  if (view.count === 0) view.count = 1;
  const lot = view.lots[0];
  const D = EVOLUTIONS[id];
  const w = WEAPON_KEYS.indexOf(D.weapon);
  lot.kind = LOT_EVOLUTION;
  lot.kindKey = 'evolution';
  lot.id = id;
  setRarity(lot, EVOLUTION_RULES.rarity);
  lot.levels.fill(0);
  lot.made = 0;
  lot.stacks = 0;
  lot.value = 0;
  lot.name = D.name;
  lot.desc = D.rule;
  lot.tag = EVOLUTION_RULES.tag;
  lot.icon = 'sr-e' + id; // 21/11 : l'icône de l'évolution (ui.js symboleEvo)
  lot.statLabels = [];
  lot.lines.length = 0;
  lot.lines.push(evolutions.recipeText(id));
  view.evo = 0;
  meta.discover('evolutions', id);
}
import * as meta from './meta.js'; // § E3.B : découverte des recettes
