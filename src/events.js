// LOT : waves-shop — ÉVÉNEMENTS DE VAGUE (étape 1 du plan addictif, contrat : ARCHITECTURE.md § E1.C).
//
// Calendrier façon Vampire Survivors : à partir de la vague EVENTS.firstWave, un tirage par vague (EVENTS.chance),
// garanti si la vague précédente n'en avait pas, jamais deux fois le même d'affilée, jamais sur une vague de boss
// (config.eventForWave, pure ; deux tirages de randEvent() par vague, toujours faits). L'événement tombe quand le chrono
// a consommé EVENTS.at de sa durée, avec sa bannière (DA FUI : surtitre + titre) et SFX.ALERT.
//
// Cinq événements :
//   essaim          des drones EFLAG.TRANSIT traversent l'écran en ligne droite, par le point où était le héros
//   frappe          cercles HAZ.ORBITAL annoncés autour du héros : ils blessent le joueur ET les robots
//   panne           la lumière d'ambiance du rendu peint descend à 25 % (world.setBlackoutPct) ; émissifs intacts
//   anneau          des blindés EFLAG.WALL sur un cercle qui se resserre, bouclier vers le centre
//   ravitaillement  une capsule tombe du ciel, gardée par des robots EFLAG.GUARD ; le héros qui la touche est payé
//
// Aucune allocation en combat (§ V) : flottants réécrits dans le tableau typé S, appels par frappe par le registre
// ARGF, bannières = chaînes construites à l'import. Un seul maillage : la capsule (1 appel de dessin quand elle est là).
import * as THREE from 'three';
import {
  AUDIO, DMG, DMG_SRC, EFLAG, ENEMIES, ENEMY, EVENTS, FXK, HAZ, MODELES, SFX, WAVES,
  eventForWave, eventSupplyFragments, eventSwarmCount, eventType,
} from './config.js';
import { ARGF, E, F_DX, F_DZ, F_SX, F_SZ, F_T, F_V, F_X, F_Z, P, rand, randEvent, run } from './state.js';
import { chargerPieces } from './anim/pieces.js';
import { CHESTS, RARITY } from './config.js'; // § E2.C : la capsule lâche aussi un coffre
import { CAUSE } from './config.js'; // § E5.Q (C2) : cause du coup de la capsule

let render = null;
let enemies = null;
let waves = null;
let hazards = null;
let damage = null;
let pickups = null;
let chests = null; // § E2.C
let world = null;
let audio = null;
let ui = null;
let fx = null;
let view = null;

const TYPES = EVENTS.types;
const N = TYPES.length;
const ESSAIM = eventType('essaim');
const FRAPPE = eventType('frappe');
const PANNE = eventType('panne');
const ANNEAU = eventType('anneau');
const RAVI = eventType('ravitaillement');
const K_ESSAIM = TYPES.indexOf(ESSAIM);
const K_FRAPPE = TYPES.indexOf(FRAPPE);
const K_PANNE = TYPES.indexOf(PANNE);
const K_ANNEAU = TYPES.indexOf(ANNEAU);
const K_RAVI = TYPES.indexOf(RAVI);
// Bannières : « <surtitre> : <label> » (ui.showBanner met le surtitre au-dessus). Chaînes construites à l'import.
const BANNER = TYPES.map((t) => (t.ally ? EVENTS.kickerAlly : EVENTS.kicker) + ' : ' + t.label);
const TAU = Math.PI * 2;
const DRONE = ENEMIES.types[ENEMY.DRONE];
const BLINDE = ENEMIES.types[ENEMY.BLINDE];

// Calendrier
let planned = -1; // événement prévu pour la vague en cours (indice dans EVENTS.types), −1 = aucun
let fired = false; // l'événement prévu est tombé
let prevHad = false; // la vague précédente avait un événement
let lastType = -1; // dernier événement tombé ou prévu (jamais deux fois le même d'affilée)
// Événement en cours
let current = -1;
let stage = 0; // étape propre à l'événement (capsule : 1 = chute, 2 = posée)
let total = 0; // essaim : drones à émettre ; anneau : blindés créés
let emitted = 0; // essaim : drones émis ; frappe : frappes lancées
let alive = 0; // essaim, anneau : robots de l'événement encore en vie (compté à chaque image)
let guards = 0; // ravitaillement : gardes créés
let lightPct = 100; // panne : niveau de lumière posé (entier, %)
let dimmed = false; // panne : la nappe d'ambiance est baissée
// Flottants réécrits en combat : tableau typé (§ V)
const TIME = 0; // s depuis le début de l'événement
const CX = 1; // centre : position du héros au déclenchement (essaim, anneau) ou point de chute (capsule)
const CZ = 2;
const HX = 3; // essaim : cap unitaire
const HZ = 4;
const ANG = 5; // essaim : cap (rad, 0 = +Z)
const SX = 6; // essaim : centre de la ligne de départ
const SZ = 7;
const ACC = 8; // essaim : drones dus (débit × temps)
const RAD = 9; // anneau : rayon courant
const ALT = 10; // capsule : altitude
const SPIN = 11; // capsule : angle
const S = new Float64Array(12);
const pt = new Float32Array(2);
// Compteurs de la partie (lus par inspect)
const started = new Int32Array(N);
let removed = 0; // drones d'essaim retirés hors écran
let stuck = 0; // drones d'essaim retirés à l'échéance (bloqués)
let wallMade = 0;
let wallSkipped = 0; // points de l'anneau non créés (hors arène ou dans un obstacle)
let wallPurged = 0;
let opened = 0; // capsules ouvertes
let credited = 0; // fragments posés par les capsules ouvertes
let landed = 0; // capsules arrivées au sol

let capsule = null; // maillage de la capsule (modèle Blender posé à son arrivée)
let capsuleShown = false;
let capsuleReady = false;
let capsuleSettled = null; // promesse tenue quand le modèle de la capsule est posé (ou illisible) : voir whenModelSettled

export function init(ctx) {
  render = ctx.render;
  enemies = ctx.enemies;
  waves = ctx.waves;
  hazards = ctx.hazards;
  damage = ctx.damage;
  pickups = ctx.pickups;
  chests = ctx.chests || null; // § E2.C
  world = ctx.world;
  audio = ctx.audio;
  ui = ctx.ui;
  fx = ctx.fx;
  view = ctx.camera.view;

  // Capsule de ravitaillement : modèle Blender assets/modeles/capsule.glb (outils/blender/capsule.py, DA Clash), chargé
  // en arrière-plan ; d'ici là une géométrie vide (l'événement marche quand même). Avant world.initLate : l'ombre de
  // contact la retrouve par son nom.
  capsule = new THREE.Mesh(render.emptyModelGeometry(), render.createLitMaterial({ glowColor: RAVI.glow }));
  capsule.name = 'capsule';
  render.makeShadowCaster(capsule);
  capsule.receiveShadow = true;
  capsule.frustumCulled = false;
  capsule.visible = false;
  ctx.scene.add(capsule);
  capsuleSettled = chargerPieces(new URL('../' + MODELES.dir + RAVI.model, import.meta.url).href, { cible: RAVI.height, emissifMateriau: true }).then(
    (d) => {
      render.setModelGeometry(capsule, d);
      capsuleReady = true;
    },
    (e) => console.warn('Capsule de ravitaillement illisible (l’événement reste jouable, sans modèle) :', e),
  );
}

/**
 * Promesse tenue (jamais rejetée) quand le modèle de la capsule est posé, ou illisible. La géométrie arrive APRÈS le
 * préchauffage de l'init : main en refait un à son arrivée (render.prewarm), pour qu'elle soit envoyée à la carte
 * graphique hors combat, comme tout le reste (§ T) — et non à la première capsule, en pleine vague (recette de
 * l'étape 1 : une géométrie de plus après le premier ravitaillement, mesurée par tests/waves-shop.test.mjs).
 */
export function whenModelSettled() {
  return capsuleSettled;
}

/** Nouvelle partie : plus d'événement, calendrier et compteurs à zéro. */
export function reset() {
  clear();
  planned = -1;
  fired = false;
  prevHad = false;
  lastType = -1;
  started.fill(0);
  removed = 0;
  stuck = 0;
  wallMade = 0;
  wallSkipped = 0;
  wallPurged = 0;
  opened = 0;
  credited = 0;
  landed = 0;
}

/**
 * Fin de vague (T5), « Rejouer », debug : l'événement en cours s'arrête — lumière rendue, nappe d'ambiance rendue,
 * anneau dissous, capsule retirée. Les robots de l'événement ne sont PAS tués ici (T5 : enemies.purgeAll s'en charge ;
 * un blindé d'anneau sans anneau redevient un blindé ordinaire).
 */
export function clear() {
  current = -1;
  stage = 0;
  total = 0;
  emitted = 0;
  alive = 0;
  guards = 0;
  S.fill(0);
  if (lightPct !== 100) {
    lightPct = 100;
    world.setBlackoutPct(100);
  }
  if (dimmed) {
    dimmed = false;
    audio.setAmbiance(AUDIO.ambiance.gain, PANNE.fade);
  }
  enemies.WALLRING[3] = 0;
  if (capsuleShown) {
    capsuleShown = false;
    capsule.visible = false;
  }
}

/**
 * Début de la vague n (waves.startWave) : tirage du calendrier. Deux tirages de randEvent(), toujours faits. § E5.V :
 * garder (bascule à la volée) — un événement en cours n'est pas arrêté ; celui prévu attend qu'il soit fini (update).
 */
export function startWave(n, garder = false) {
  const r1 = randEvent();
  const r2 = randEvent();
  if (!(garder && current >= 0)) clear();
  planned = eventForWave(n, r1, r2, prevHad, lastType);
  fired = false;
  prevHad = planned >= 0;
  if (planned >= 0) lastType = planned;
}

/** L'événement k commence : bannière, alerte, mise en place. */
function begin(k) {
  clear();
  current = k;
  started[k]++;
  S[TIME] = 0;
  S[CX] = P.x;
  S[CZ] = P.z;
  ui.queueBanner(BANNER[k], EVENTS.bannerSeconds, SFX.ALERT); // l'alerte part avec la bannière (§ E1.S)
  if (k === K_ESSAIM) beginSwarm();
  else if (k === K_PANNE) {
    audio.play(SFX.PANNE); // § E5.Q ter (Femz, 21/11) : la lumière tombe
    dimmed = true;
    audio.setAmbiance(AUDIO.ambiance.gain * PANNE.ambianceMul, PANNE.fade);
  } else if (k === K_ANNEAU) beginRing();
  else if (k === K_RAVI) beginSupply();
}

// ----- Essaim en transit ---------------------------------------------------------------------------------------------

function beginSwarm() {
  audio.play(SFX.ESSAIM); // § E5.Q ter (Femz, 21/11) : l'armée de drones passe (une fois, au départ de la traversée)
  total = eventSwarmCount(run.wave);
  emitted = 0;
  S[ACC] = 0;
  // Départ hors champ : à une demi-diagonale d'écran du héros (plus ce qui dépasse en hauteur), dans l'arène.
  const top = (DRONE.height + DRONE.hover) * view.groundPerHeight;
  const dist = Math.sqrt(view.halfW * view.halfW + (view.halfD + top) * (view.halfD + top)) + ESSAIM.startMargin;
  let a = 0;
  let found = false;
  for (let k = 0; k < ESSAIM.tries && !found; k++) {
    a = rand() * TAU - Math.PI;
    found = world.isInsideArena(P.x - Math.sin(a) * dist, P.z - Math.cos(a) * dist, DRONE.radius);
  }
  if (!found) {
    // repli (héros dans un coin) : l'essaim part du côté du centre de l'arène
    const d = Math.sqrt(P.x * P.x + P.z * P.z);
    a = d > 1e-3 ? Math.atan2(P.x, P.z) : 0;
  }
  S[ANG] = a;
  S[HX] = Math.sin(a);
  S[HZ] = Math.cos(a);
  S[SX] = P.x - S[HX] * dist;
  S[SZ] = P.z - S[HZ] * dist;
}

function updateSwarm(dt) {
  // Émission à débit constant sur emitSeconds, sur la largeur de la bande.
  if (emitted < total) {
    S[ACC] += (dt * total) / ESSAIM.emitSeconds;
    const hpMul = waves.getHpMul();
    const dmgMul = waves.getDmgMul();
    while (emitted < total && emitted < S[ACC]) {
      if (E.aliveCount >= WAVES.maxAlive || E.count >= E.cap) {
        total = emitted; // plafond de vivants : l'essaim s'arrête là
        break;
      }
      const lat = (rand() - 0.5) * ESSAIM.width;
      let x = S[SX] + S[HZ] * lat;
      let z = S[SZ] - S[HX] * lat;
      if (!world.isInsideArena(x, z, DRONE.radius)) {
        world.resolve(x, z, DRONE.radius, pt);
        x = pt[0];
        z = pt[1];
      }
      const i = enemies.spawn(ENEMY.DRONE, x, z, hpMul, dmgMul);
      if (i < 0) {
        total = emitted;
        break;
      }
      E.flags[i] = EFLAG.TRANSIT;
      E.rev0[i] = S[ANG];
      E.rot[i] = S[ANG];
      E.timer[i] = ESSAIM.maxSeconds;
      emitted++;
    }
  }
  // Retrait : un drone ressorti de l'écran (au-delà du point où était le héros) disparaît sans bruit ; un drone encore
  // là à l'échéance (bloqué contre un mur) est retiré aussi — désintégré s'il est à l'écran.
  const a1 = view.halfW + ESSAIM.exitMargin;
  const bTop = view.halfD + ESSAIM.exitMargin;
  const bBot = view.halfD + ESSAIM.exitMargin + (DRONE.height + DRONE.hover) * view.groundPerHeight;
  const n = E.count;
  const FL = E.flags;
  let left = 0;
  for (let i = 0; i < n; i++) {
    if (E.alive[i] === 0 || (FL[i] & EFLAG.TRANSIT) === 0) continue;
    const dx = E.x[i] - view.targetX;
    const dz = E.z[i] - view.targetZ;
    const a = dx * view.rightX + dz * view.rightZ;
    const b = dx * view.upX + dz * view.upZ;
    const outside = a < -a1 || a > a1 || b > bTop || b < -bBot;
    const past = (E.x[i] - S[CX]) * S[HX] + (E.z[i] - S[CZ]) * S[HZ] > 0;
    if (outside && (past || E.timer[i] <= 0)) {
      ARGF[F_DX] = 0;
      ARGF[F_DZ] = 0;
      damage.killEnemyF(i, DMG.PURGE | DMG.SILENT | DMG.NO_LOOT);
      removed++;
    } else if (E.timer[i] <= 0) {
      ARGF[F_DX] = 0;
      ARGF[F_DZ] = 0;
      damage.killEnemyF(i, DMG.PURGE | DMG.NO_LOOT);
      stuck++;
    } else left++;
  }
  alive = left;
  if (emitted >= total && left === 0) current = -1;
}

// ----- Frappe orbitale -----------------------------------------------------------------------------------------------

function updateStrikes() {
  const every = FRAPPE.seconds / FRAPPE.strikes;
  while (emitted < FRAPPE.strikes && S[TIME] >= emitted * every) {
    let x = P.x;
    let z = P.z;
    if (emitted > 0 || !FRAPPE.firstOnHero) {
      // autour du point où le héros sera à l'impact s'il garde son cap (lead), dans un disque de rayon spread
      const a = rand() * TAU;
      const r = FRAPPE.spread * Math.sqrt(rand());
      const lead = FRAPPE.lead * FRAPPE.telegraph;
      x += P.vx * lead + Math.sin(a) * r;
      z += P.vz * lead + Math.cos(a) * r;
    }
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    ARGF[F_DX] = FRAPPE.radius;
    ARGF[F_DZ] = FRAPPE.dmgRobots * waves.getHpMul();
    ARGF[F_SX] = 0;
    ARGF[F_SZ] = 0;
    ARGF[F_T] = FRAPPE.telegraph;
    ARGF[F_V] = FRAPPE.dmgPlayer * waves.getDmgMul();
    hazards.addF(HAZ.ORBITAL); // pool plein : la frappe est perdue (192 zones : jamais atteint)
    emitted++;
  }
  if (emitted >= FRAPPE.strikes && S[TIME] >= (FRAPPE.strikes - 1) * every + FRAPPE.telegraph) current = -1;
}

// ----- Panne de courant ----------------------------------------------------------------------------------------------

function updateBlackout() {
  const t = S[TIME];
  const f = PANNE.fade;
  let k = 1; // 0 = lumière normale, 1 = panne
  if (t < f) k = t / f;
  else if (t > f + PANNE.seconds) k = 1 - (t - f - PANNE.seconds) / f;
  if (k < 0) k = 0;
  k = k * k * (3 - 2 * k); // fondu doux
  // en entier (%) : la valeur ne change que 75 fois par fondu, et aucun flottant n'est passé à world (§ V)
  const pct = Math.round(100 - (100 - PANNE.light * 100) * k);
  if (pct !== lightPct) {
    lightPct = pct;
    world.setBlackoutPct(pct);
  }
  if (t >= f + PANNE.seconds && dimmed) {
    dimmed = false;
    audio.setAmbiance(AUDIO.ambiance.gain, f);
  }
  if (t >= 2 * f + PANNE.seconds) current = -1;
}

// ----- Anneau d'acier ------------------------------------------------------------------------------------------------

function beginRing() {
  audio.play(SFX.ANNEAU); // § E5.Q ter (Femz, 21/11) : le cercle se forme et se resserre (une fois)
  const hpMul = waves.getHpMul();
  const dmgMul = waves.getDmgMul();
  const r = BLINDE.radius;
  total = 0;
  for (let k = 0; k < ANNEAU.count; k++) {
    if (E.aliveCount >= WAVES.maxAlive || E.count >= E.cap) break;
    const a = (k / ANNEAU.count) * TAU - Math.PI;
    const x = S[CX] + Math.sin(a) * ANNEAU.radiusStart;
    const z = S[CZ] + Math.cos(a) * ANNEAU.radiusStart;
    if (!world.isInsideArena(x, z, r) || world.overlaps(x, z, r)) {
      wallSkipped++; // hors de l'arène ou dans un obstacle : pas créé (l'anneau a une brèche)
      continue;
    }
    const i = enemies.spawn(ENEMY.BLINDE, x, z, hpMul, dmgMul);
    if (i < 0) break;
    E.flags[i] = EFLAG.WALL;
    E.rev0[i] = a;
    E.rot[i] = a + Math.PI; // bouclier vers le centre
    total++;
  }
  wallMade += total;
  alive = total;
  S[RAD] = ANNEAU.radiusStart;
  const W = enemies.WALLRING;
  W[0] = S[CX];
  W[1] = S[CZ];
  W[2] = ANNEAU.radiusStart;
  W[3] = 1;
}

function updateRing() {
  const t = S[TIME];
  let u = t / ANNEAU.seconds;
  if (u > 1) u = 1;
  S[RAD] = ANNEAU.radiusStart + (ANNEAU.radiusEnd - ANNEAU.radiusStart) * u;
  enemies.WALLRING[2] = S[RAD];
  const n = E.count;
  const FL = E.flags;
  let left = 0;
  for (let i = 0; i < n; i++) if (E.alive[i] === 1 && (FL[i] & EFLAG.WALL) !== 0) left++;
  alive = left;
  if (left === 0) {
    enemies.WALLRING[3] = 0;
    current = -1;
    return;
  }
  if (t < ANNEAU.seconds + ANNEAU.hold) return;
  // L'anneau a tenu son siège : les survivants se désintègrent (purge, comme en fin de vague : ni kill, ni butin).
  fx.beginPurge(left);
  for (let i = 0; i < n; i++) {
    if (E.alive[i] === 0 || (FL[i] & EFLAG.WALL) === 0) continue;
    ARGF[F_DX] = 0;
    ARGF[F_DZ] = 0;
    damage.killEnemyF(i, DMG.PURGE | DMG.NO_LOOT);
    wallPurged++;
  }
  audio.play(SFX.PURGE);
  alive = 0;
  enemies.WALLRING[3] = 0;
  current = -1;
}

// ----- Ravitaillement ------------------------------------------------------------------------------------------------

function beginSupply() {
  // Point de chute : à `distance` m du héros, dans l'arène, hors obstacle.
  let found = false;
  for (let k = 0; k < RAVI.tries && !found; k++) {
    const a = rand() * TAU;
    pt[0] = P.x + Math.sin(a) * RAVI.distance;
    pt[1] = P.z + Math.cos(a) * RAVI.distance;
    found = world.isInsideArena(pt[0], pt[1], RAVI.radius) && !world.overlaps(pt[0], pt[1], RAVI.radius);
  }
  if (!found) {
    // repli : vers le centre de l'arène, ramené dans l'arène et hors des obstacles
    const d = Math.sqrt(P.x * P.x + P.z * P.z);
    const ux = d > 1e-3 ? -P.x / d : 0;
    const uz = d > 1e-3 ? -P.z / d : 1;
    world.resolve(P.x + ux * RAVI.distance, P.z + uz * RAVI.distance, RAVI.radius, pt);
  }
  S[CX] = pt[0];
  S[CZ] = pt[1];
  S[ALT] = RAVI.fallHeight;
  S[SPIN] = 0;
  stage = 1;
  guards = 0;
  // marque au sol pendant la chute (comme l'arrivée du boss), puis la capsule tombe
  ARGF[F_X] = S[CX];
  ARGF[F_Z] = S[CZ];
  ARGF[F_DX] = RAVI.impactRadius;
  ARGF[F_DZ] = 0;
  ARGF[F_SX] = 0;
  ARGF[F_SZ] = 0;
  ARGF[F_T] = RAVI.telegraph;
  ARGF[F_V] = 0;
  hazards.addF(HAZ.MARK);
  ARGF[F_X] = S[CX];
  ARGF[F_Z] = S[CZ];
  audio.playF(SFX.RAVITAILLEMENT); // § E5.Q ter (Femz, 21/11) : la capsule tombe (était BOSS_TELEGRAPH)
  capsuleShown = true;
  capsule.visible = true;
}

function updateSupply(dt) {
  const t = S[TIME];
  if (stage === 1) {
    let u = 1 - t / RAVI.telegraph;
    if (u < 0) u = 0;
    S[ALT] = RAVI.fallHeight * Math.pow(u, RAVI.fallEase);
    if (t < RAVI.telegraph) return;
    // Impact : souffle (le joueur resté dessous est blessé, pas les robots), anneau de poussière, gardes.
    S[ALT] = 0;
    stage = 2;
    landed++;
    damage.explode(S[CX], S[CZ], RAVI.impactRadius, 0, RAVI.impactDmg * waves.getDmgMul(), DMG_SRC.EVENT, DMG.NO_CRIT, FXK.KAMIKAZE, RAVI.impactTrauma, 0, 0, -1, CAUSE.CAPSULE); // § E5.Q
    fx.spawnRing(S[CX], S[CZ], RAVI.impactRadius, RAVI.glow);
    ARGF[F_X] = S[CX];
    ARGF[F_Z] = S[CZ];
    ARGF[F_DX] = RAVI.guardRing;
    guards = waves.emitGuardsF(RAVI.guards);
    return;
  }
  S[SPIN] += RAVI.spin * dt;
  // Ouverture : le héros la touche.
  const dx = P.x - S[CX];
  const dz = P.z - S[CZ];
  if (!P.alive || dx * dx + dz * dz > RAVI.openRadius * RAVI.openRadius) return;
  const value = eventSupplyFragments(run.wave);
  const each = Math.floor(value / RAVI.pickups);
  const extra = value - each * RAVI.pickups;
  for (let k = 0; k < RAVI.pickups; k++) {
    const a = (k / RAVI.pickups) * TAU;
    pickups.spawnFragment(S[CX] + Math.sin(a) * RAVI.scatter, S[CZ] + Math.cos(a) * RAVI.scatter, each + (k === 0 ? extra : 0));
  }
  if (chests !== null && CHESTS.supplyChest) chests.dropAt(S[CX], S[CZ], RARITY.BRUT); // § E2.C : coffre de la capsule
  opened++;
  credited += value;
  fx.spawnRing(S[CX], S[CZ], RAVI.impactRadius, RAVI.glow);
  audio.play(SFX.BONUS_PICK, S[CX], S[CZ]);
  capsuleShown = false;
  capsule.visible = false;
  stage = 0;
  current = -1;
}

// ----- Boucle --------------------------------------------------------------------------------------------------------

/** S3 bis (après waves.update) : déclenche l'événement prévu à son instant du chrono, fait vivre l'événement en cours. */
export function update(dt) {
  // § E5.V : jamais deux événements à la fois (un événement gardé à la bascule finit d'abord)
  if (planned >= 0 && !fired && current < 0 && waves.isActive()) {
    const clockTotal = waves.getClockTotal();
    // Jamais à l'image où la vague finit (chrono à zéro) : F1 met le chrono à 0 d'un coup — l'événement prévu
    // commençait alors pour une seule image (bannière, alerte, un drone d'essaim aussitôt purgé ; recette de l'étape 1).
    if (clockTotal > 0 && waves.getClock() > 0 && clockTotal - waves.getClock() >= EVENTS.at * clockTotal) {
      fired = true;
      begin(planned);
    }
  }
  if (current < 0) return;
  S[TIME] += dt;
  if (current === K_ESSAIM) updateSwarm(dt);
  else if (current === K_FRAPPE) updateStrikes();
  else if (current === K_PANNE) updateBlackout();
  else if (current === K_ANNEAU) updateRing();
  else updateSupply(dt);
}

/** F11 : la capsule (position, chute, lente rotation). */
export function sync() {
  if (!capsuleShown) return;
  const bob = stage === 2 ? RAVI.bob * (0.5 + 0.5 * Math.sin(S[SPIN] * (RAVI.bobHz * TAU) / RAVI.spin)) : 0;
  capsule.position.set(S[CX], S[ALT] + bob, S[CZ]);
  capsule.rotation.y = S[SPIN];
}

/** Position de la capsule (out[0] = x, out[1] = z) pour la flèche de bord d'écran ; false s'il n'y en a pas. */
export function getBeacon(out) {
  if (current !== K_RAVI || stage === 0) return false;
  out[0] = S[CX];
  out[1] = S[CZ];
  return true;
}

/** Un événement est en cours. */
export function isActive() {
  return current >= 0;
}

/** Hook de test (__game.startEvent) : lance l'événement de clé donnée tout de suite (l'événement en cours s'arrête). */
export function debugStart(key) {
  for (let k = 0; k < N; k++) {
    if (TYPES[k].key === key) {
      begin(k);
      return true;
    }
  }
  return false;
}

export function inspect(out) {
  out.key = current >= 0 ? TYPES[current].key : null;
  out.active = current >= 0;
  out.time = S[TIME];
  out.planned = planned >= 0 ? TYPES[planned].key : null;
  out.fired = fired;
  out.last = lastType >= 0 ? TYPES[lastType].key : null;
  const st = {};
  for (let k = 0; k < N; k++) st[TYPES[k].key] = started[k];
  out.started = st;
  out.stage = stage;
  out.center = [S[CX], S[CZ]];
  out.swarm = { total, emitted, alive, removed, stuck, heading: S[ANG], start: [S[SX], S[SZ]] };
  out.strikes = current === K_FRAPPE ? emitted : 0;
  out.light = lightPct / 100;
  out.dimmed = dimmed;
  out.ring = { made: wallMade, skipped: wallSkipped, purged: wallPurged, alive: current === K_ANNEAU ? alive : 0, radius: S[RAD], active: enemies.WALLRING[3] === 1 };
  out.supply = { shown: capsuleShown, ready: capsuleReady, altitude: S[ALT], guards, landed, opened, credited };
}
