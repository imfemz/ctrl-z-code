// Plan addictif, étape 3, chantier C — utilitaires (ARCHITECTURE.md § E3.C).
//
// Six bonus uniques, lâchés par les décors cassables (props.js) et, rarement, par les robots tués (damage.killEnemyF →
// rollOnKillF). Au sol : une pastille FUI (icône pixel dans un cadre, à la couleur de l'utilitaire) tournée vers la
// caméra, qui flotte et clignote ses dernières secondes. UN InstancedMesh pour toutes (un appel de dessin, zéro sans
// utilitaire au sol). Ramassée au contact du héros (pas par le rayon de collecte : il faut aller la chercher) : effet
// immédiat.
//   Batterie : PV rendus. Aimant : tout le butin de l'arène (gemmes, fragments, coffres) vole vers le héros.
//   I.E.M : exécute les robots À L'ÉCRAN hors boss et élites (mort en lot : damage.killBatchF).
//   Décharge : étourdit les robots à l'écran (E.slow = 0 : enemies.update les traite comme figés, ni marche ni tir ni
//   contact) ; arcs sur les plus proches. Overclocking : vitesse et dégâts × pendant 10 s (MUL, lu par player et damage).
//   Puissance de calcul : chaque coup porté crédite des fragments pendant N s (moneyOnHitF, plafond par seconde).
//
// Taux par source (UTILITIES.dropFrom), plafond par vague (capPerWave) et par id (capPerId). Hasard : flux PRIVÉ.
// Allocation (§ V) : dropAt, rollOnKillF, moneyOnHitF, update et sync n'allouent rien. activate tourne au ramassage
// (rare) : il n'alloue rien non plus (listes de travail créées à l'init).
import * as THREE from 'three';
import { CAPS, DECORS, DMG, EFLAG, ENEMY, RARITIES, SFX, TRAUMA, UTIL, UTIL_COUNT, UTIL_SOURCE, UTILITIES, UTILITY_ICONS } from './config.js';
import { ARGF, E, F_X, F_Z, P, run } from './state.js';
import * as V from './vfx/projectiles.js';
import { UTIL_OK } from './meta.js'; // § E4.A.5 : utilitaires verrouillés (poids nuls)
import { RECAP_T } from './config.js'; // § E5.E.2 : récap des ramassages
import { CONFORT_FLASHS as CF } from './config.js'; // § E5.X5 (audit C12) : réglage « Flashs »
import { RAM_I, RAM_N } from './ramassage.js';

let ctx = null;
let render = null;
let audio = null;
let fx = null;
let camera = null;
let player = null;
let pickups = null;
let chests = null;
let damage = null;
let progression = null;

const U = UTILITIES;
const CAP = CAPS.utilities;
const uX = new Float32Array(CAP);
const uZ = new Float32Array(CAP);
const uAge = new Float32Array(CAP);
const uId = new Uint8Array(CAP);
// Femz, 20/11 soir : Batterie de borne — PV rendus par instance et palier (0, 1, 2 : DECORS.drop.batteries ; −1 : pas
// une Batterie de borne, PV = UTILITIES.battery.heal)
// ENTIERS (Int16Array) : un flottant passé à player.heal ferait de P.hp un champ « double » — V8 change alors la
// représentation du champ de P (lu partout) et désoptimise tout le code qui lit P (allocations mesurées par e4-O)
const uHeal = new Int16Array(CAP);
const uPal = new Int8Array(CAP);
const LAST = new Int32Array(1); // indice de la dernière pose (place)
const batteriesParPalier = new Int32Array(3);
let tintArr = null; // aTint (vec4 par instance) : teinte de rareté (rgb linéaire) ; w = 1 si teintée
const TINT = new Float32Array(9); // teintes linéaires des 3 paliers
let count = 0;
let mesh = null;
let matArr = null;
const PICK_R2 = U.pickupRadius * U.pickupRadius;

/** Multiplicateurs lus en ligne par player (MUL[0] : vitesse) et damage (MUL[1] : dégâts) — 1 hors Overclocking. */
export const MUL = new Float64Array(2).fill(1);
/** Secondes restantes par utilitaire à durée (STUN, TURBO, COMPUTE ; 0 sinon). Lu par l'interface. */
export const LEFT = new Float64Array(UTIL_COUNT);
const DUR = new Float64Array(UTIL_COUNT); // durée totale de l'effet en cours (barre du HUD)
// Fusion du groupe 1 : le HUD lit des ENTIERS (dixièmes restants, part de barre en %), tenus ici à chaque pas de
// simulation — lire LEFT (flottants) dans ui.update l'emballait à chaque image (≈ 100 o/image mesurés par ui.test).
export const TENTHS = new Int32Array(UTIL_COUNT);
export const PCT = new Int32Array(UTIL_COUNT);
function hudInts(k) {
  const l = LEFT[k];
  TENTHS[k] = l > 0 ? Math.ceil(l * 10) : 0;
  PCT[k] = l > 0 && DUR[k] > 0 ? Math.round((l / DUR[k]) * 100) : 0;
}
const W = new Float64Array(4); // [dt, fenêtre d'une seconde de COMPUTE, -, -]
let computeThisSecond = 0;

// plafonds de la vague en cours
let waveSeen = -1;
let waveDrops = 0;
const waveDropsById = new Uint8Array(UTIL_COUNT);

// compteurs (inspect)
const dropsBySource = new Int32Array(3);
const dropsById = new Int32Array(UTIL_COUNT);
const pickedById = new Int32Array(UTIL_COUNT);
let capped = 0; // tirages gagnants refusés par un plafond
let expired = 0;
let iemKills = 0;
let stunned = 0;
let computeFrags = 0;
let healed = 0;
const killRolls = new Int32Array(1);

// listes de travail (I.E.M, Décharge) : remplies au ramassage, jamais réallouées
const work = new Uint16Array(CAPS.enemies);
const workD = new Float32Array(CAPS.enemies);

const SALT = 0x27d4eb2f;
const seed = new Int32Array(1);
/** [0, 1) — flux privé des utilitaires. */
export function utilRand() {
  const s = (seed[0] + 0x6d2b79f5) | 0;
  seed[0] = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Tirage d'une borne : poids normalisés (somme = 1)
const PROP_W = new Float64Array(UTIL_COUNT);
const KILL_W = new Float64Array(U.dropFrom.kill);
/**
 * § E4.A.5 : poids recalculés à chaque reset (hors combat) avec les verrous de la méta (UTIL_OK) — un utilitaire
 * verrouillé a un poids nul. Bornes : poids renormalisés (somme 1). Morts : la chance TOTALE par robot tué est gardée,
 * répartie sur les utilitaires jouables au prorata de leurs poids. dropAt et rollOnKillF ne changent pas.
 */
function poserPoids() {
  let s = 0;
  for (let k = 0; k < UTIL_COUNT; k++) s += UTIL_OK[k] === 1 ? U.dropFrom.prop[k] : 0;
  for (let k = 0; k < UTIL_COUNT; k++) PROP_W[k] = s > 0 && UTIL_OK[k] === 1 ? U.dropFrom.prop[k] / s : 0;
  let all = 0;
  let ok = 0;
  for (let k = 0; k < UTIL_COUNT; k++) {
    all += U.dropFrom.kill[k];
    if (UTIL_OK[k] === 1) ok += U.dropFrom.kill[k];
  }
  for (let k = 0; k < UTIL_COUNT; k++) KILL_W[k] = ok > 0 && UTIL_OK[k] === 1 ? (U.dropFrom.kill[k] * all) / ok : 0;
}
poserPoids();

// ----- Atlas des pastilles (init) -------------------------------------------------------------------------------------
const CELL = 32;
function hexCss(n) {
  return '#' + (n >>> 0).toString(16).padStart(6, '0');
}
function atlasTexture() {
  const c = document.createElement('canvas');
  c.width = CELL * UTIL_COUNT;
  c.height = CELL;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (let k = 0; k < UTIL_COUNT; k++) {
    const x0 = k * CELL;
    const col = hexCss(U.list[k].color);
    // fond sombre (vernis profond) et cadre FUI à coins coupés, à la couleur de l'utilitaire
    g.fillStyle = 'rgba(6, 18, 14, 0.92)';
    g.beginPath();
    g.moveTo(x0 + 6, 1);
    g.lineTo(x0 + CELL - 1, 1);
    g.lineTo(x0 + CELL - 1, CELL - 7);
    g.lineTo(x0 + CELL - 7, CELL - 1);
    g.lineTo(x0 + 1, CELL - 1);
    g.lineTo(x0 + 1, 6);
    g.closePath();
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.stroke();
    // repères d'angle blancs (coins FUI)
    g.fillStyle = '#ffffff';
    g.fillRect(x0 + CELL - 6, 3, 3, 1);
    g.fillRect(x0 + CELL - 4, 3, 1, 3);
    g.fillRect(x0 + 3, CELL - 4, 3, 1);
    g.fillRect(x0 + 3, CELL - 6, 1, 3);
    // icône 12 × 12 agrandie × 2
    const rows = UTILITY_ICONS['sr-u-' + U.list[k].key];
    g.fillStyle = col;
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) if (rows[y][x] === '#') g.fillRect(x0 + 4 + x * 2, 4 + y * 2, 2, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

const VERT = /* glsl */ `
attribute vec2 aFx;
attribute vec4 aTint;
varying vec2 vUv; varying float vA; varying vec4 vT;
void main() {
  vT = aTint;
  vec4 c = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  float s = length( instanceMatrix[0].xyz );
  c.xy += position.xy * s;
  gl_Position = projectionMatrix * c;
  vUv = vec2( ( uv.x + aFx.x ) / ${UTIL_COUNT}.0, uv.y );
  vA = aFx.y;
}`;
const FRAG = /* glsl */ `
uniform sampler2D uAtlas; uniform float uGain;
varying vec2 vUv; varying float vA; varying vec4 vT;
void main() {
  vec4 t = texture2D( uAtlas, vUv );
  if ( t.a < 0.05 ) discard;
  vec3 c = t.rgb * uGain;
  // Femz 20/11 soir : Batterie de borne teintée de sa rareté (la luminance de l'icône garde son dessin)
  if ( vT.w > 0.5 ) c = vec3( dot( t.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * vT.rgb * uGain * 1.4;
  gl_FragColor = vec4( c, t.a * vA );
}`;

export function init(context) {
  ctx = context;
  render = ctx.render;
  audio = ctx.audio;
  fx = ctx.fx;
  camera = ctx.camera;
  player = ctx.player;
  pickups = ctx.pickups;
  chests = ctx.chests || null;
  damage = ctx.damage;
  progression = ctx.progression;
  const geo = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: atlasTexture() }, uGain: { value: 1.6 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });
  material.userData.uniforms = material.uniforms; // render.commit envoie aFx (icône, opacité) quand ce champ existe
  mesh = render.createInstanced(geo, material, CAP, { name: 'utilitaires' });
  mesh.renderOrder = 2;
  matArr = mesh.instanceMatrix.array;
  const aTint = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  aTint.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('aTint', aTint);
  tintArr = aTint.array;
  const BAT = DECORS.drop.batteries;
  for (let k = 0; k < 3; k++) render.writeColor(TINT, k * 3, RARITIES[BAT[k].rarete].color);
}

export function reset() {
  poserPoids(); // § E4.A.5 (main.resetAll appelle meta.applyToRun avant)
  count = 0;
  MUL[0] = 1;
  MUL[1] = 1;
  LEFT.fill(0);
  TENTHS.fill(0);
  PCT.fill(0);
  DUR.fill(0);
  W.fill(0);
  computeThisSecond = 0;
  waveSeen = -1;
  waveDrops = 0;
  waveDropsById.fill(0);
  dropsBySource.fill(0);
  dropsById.fill(0);
  pickedById.fill(0);
  capped = 0;
  expired = 0;
  iemKills = 0;
  stunned = 0;
  computeFrags = 0;
  healed = 0;
  killRolls[0] = 0;
  batteriesParPalier.fill(0);
  seed[0] = (run.seed ^ SALT) | 0;
}

function syncWave() {
  if (run.wave !== waveSeen) {
    waveSeen = run.wave;
    waveDrops = 0;
    waveDropsById.fill(0);
  }
}

/** Pose l'utilitaire id en (x, z) (pool plein : le plus ancien laisse sa place). Rend id. */
function place(id, x, z) {
  let i = count;
  if (count >= CAP) {
    i = 0;
    for (let k = 1; k < count; k++) if (uAge[k] > uAge[i]) i = k;
  } else count++;
  const a = utilRand() * Math.PI * 2;
  const r = utilRand() * U.scatter;
  uX[i] = x + Math.cos(a) * r;
  uZ[i] = z + Math.sin(a) * r;
  uAge[i] = 0;
  uId[i] = id;
  uHeal[i] = U.battery.heal;
  uPal[i] = -1;
  LAST[0] = i;
  return id;
}

/**
 * Femz, 20/11 soir — borne cassée (props.js) : une Batterie de DECORS.drop.batteries[palier].pv PV en (x, z). Hors des
 * plafonds par vague (une borne lâche toujours sa Batterie) ; pool plein : la plus ancienne pastille cède. Rend l'indice.
 */
export function dropBatterie(x, z, palier) {
  if (!(palier >= 0 && palier <= 2)) return -1;
  dropsBySource[UTIL_SOURCE.PROP]++;
  dropsById[UTIL.BATTERY]++;
  batteriesParPalier[palier]++;
  place(UTIL.BATTERY, x, z);
  const i = LAST[0];
  uHeal[i] = DECORS.drop.batteries[palier].pv;
  uPal[i] = palier;
  return i;
}

/** Plafonds de la vague : rend 1 si l'utilitaire id peut encore tomber (et le compte). */
function allow(id) {
  syncWave();
  if (waveDrops >= U.capPerWave || waveDropsById[id] >= U.capPerId[id]) {
    capped++;
    return 0;
  }
  waveDrops++;
  waveDropsById[id]++;
  return 1;
}

/**
 * Un utilitaire tombe en (x, z) depuis la source donnée (UTIL_SOURCE.PROP : tirage par poids ; DEBUG : id imposé par
 * debugId). Rend l'id posé, −1 si un plafond l'a refusé.
 */
export function dropAt(x, z, source, debugId = -1) {
  let id = debugId;
  if (source === UTIL_SOURCE.PROP) {
    const r = utilRand();
    let acc = 0;
    id = UTIL_COUNT - 1;
    while (id > 0 && PROP_W[id] === 0) id--; // § E4.A.5 : repli d'arrondi sur le dernier utilitaire jouable
    for (let k = 0; k < UTIL_COUNT; k++) {
      acc += PROP_W[k];
      if (r < acc) {
        id = k;
        break;
      }
    }
  }
  if (id < 0 || id >= UTIL_COUNT) return -1;
  if (source !== UTIL_SOURCE.DEBUG && allow(id) === 0) return -1;
  dropsBySource[source]++;
  dropsById[id]++;
  return place(id, x, z);
}

/** damage.killEnemyF (mort avec butin, hors purge) : petite chance que le robot i lâche un utilitaire. */
export function rollOnKillF(i) {
  killRolls[0]++;
  const r = utilRand();
  let acc = 0;
  for (let k = 0; k < UTIL_COUNT; k++) {
    acc += KILL_W[k];
    if (r < acc) {
      if (allow(k) === 0) return -1;
      dropsBySource[UTIL_SOURCE.KILL]++;
      dropsById[k]++;
      return place(k, E.x[i], E.z[i]);
    }
  }
  return -1;
}

/** Durée totale de l'effet en cours (barre du HUD). */
export function durationOf(id) {
  return DUR[id];
}
export function isActive(id) {
  return LEFT[id] > 0;
}
export function remaining(id) {
  return LEFT[id];
}

/** damage.hitEnemyF, pendant la Puissance de calcul : un coup porté crédite des fragments (plafond par seconde). */
export function moneyOnHitF() {
  if (computeThisSecond >= U.compute.maxPerSecond) return;
  computeThisSecond += U.compute.perHit;
  computeFrags += U.compute.perHit;
  progression.addFragments(U.compute.perHit);
}

function startTimer(id, seconds) {
  LEFT[id] = seconds;
  DUR[id] = seconds;
  hudInts(id);
}

/** Robots vivants à l'écran (hors boss ; hors élites si noElite) rangés dans work ; rend leur nombre. */
function gatherOnScreen(margin, noElite, noBoss) {
  let n = 0;
  for (let i = 0; i < E.count; i++) {
    if (E.alive[i] === 0 || E.sus[i] !== 0) continue; // § E3.K (fusion du groupe 1) : ni I.E.M ni Décharge sur un reporté en veille
    if (noBoss && E.type[i] === ENEMY.BOSS) continue;
    if (noElite && (E.flags[i] & EFLAG.ELITE) !== 0) continue;
    if (!camera.isOnScreen(E.x[i], E.z[i], margin)) continue;
    work[n++] = i;
  }
  return n;
}

/** Effet immédiat de l'utilitaire id (au ramassage). */
export function activate(id, heal = U.battery.heal) {
  pickedById[id]++;
  const col = U.list[id].color;
  audio.play(SFX.UTIL_PICK);
  fx.spawnRing(P.x, P.z, 2.2, col, 0.4);
  if (id === UTIL.BATTERY) {
    healed += player.heal(heal); // § E5.Q (B14) : retour propre au héros (src/soin-heros.js), plus l'anneau du réparateur
  } else if (id === UTIL.MAGNET) {
    pickups.magnetAll(U.magnet.speed);
    if (chests !== null && U.magnet.chests) chests.attractAll();
  } else if (id === UTIL.IEM) {
    const I = U.iem;
    const n = gatherOnScreen(I.onScreenMargin, true, true);
    iemKills += damage.killBatchF(work, n, I.lootMax);
    for (let k = 0; k < I.rings; k++) fx.spawnRing(P.x, P.z, I.ringRadius * (1 - k * 0.18), col, I.ringSeconds + k * I.ringDelay);
    camera.addTrauma(I.shake, TRAUMA.PLAYER_EXPLOSION);
    camera.punchZoom(I.punch);
    fx.hitstop(I.hitstop);
    audio.play(SFX.UTIL_IEM);
  } else if (id === UTIL.STUN) {
    const S = U.stun;
    const n = gatherOnScreen(S.onScreenMargin, false, !S.boss);
    for (let k = 0; k < n; k++) {
      const i = work[k];
      E.slow[i] = 0; // 0 = étourdi (enemies.update : ni marche ni action ; applySlowF ne le relève pas)
      if (E.slowT[i] < S.seconds) E.slowT[i] = S.seconds;
      const dx = E.x[i] - P.x;
      const dz = E.z[i] - P.z;
      workD[k] = dx * dx + dz * dz;
    }
    stunned += n;
    // arcs sur les S.arcs plus proches (sélection partielle : n est petit au pire 400)
    const arcs = n < S.arcs ? n : S.arcs;
    for (let a = 0; a < arcs; a++) {
      let best = a;
      for (let k = a + 1; k < n; k++) if (workD[k] < workD[best]) best = k;
      const ti = work[best];
      work[best] = work[a];
      work[a] = ti;
      const td = workD[best];
      workD[best] = workD[a];
      workD[a] = td;
      const d = Math.sqrt(td);
      if (d < 1e-3) continue;
      V.Q[0] = P.x;
      V.Q[1] = 1.0;
      V.Q[2] = P.z;
      V.Q[4] = (E.x[ti] - P.x) / d;
      V.Q[5] = 0;
      V.Q[6] = (E.z[ti] - P.z) / d;
      V.Q[7] = d;
      V.arc(1);
    }
    startTimer(UTIL.STUN, S.seconds);
    camera.addTrauma(0.3, TRAUMA.PLAYER_EXPLOSION);
    audio.play(SFX.UTIL_STUN);
  } else if (id === UTIL.TURBO) {
    startTimer(UTIL.TURBO, U.turbo.seconds);
    MUL[0] = U.turbo.speedMul;
    MUL[1] = U.turbo.dmgMul;
    audio.play(SFX.UTIL_TURBO);
  } else if (id === UTIL.COMPUTE) {
    startTimer(UTIL.COMPUTE, U.compute.seconds);
    W[1] = 0;
    computeThisSecond = 0;
    audio.play(SFX.UTIL_TURBO);
  }
}

/** S8 ter : minuteries des effets, vie et ramassage des pastilles au sol. */
export function update(dt) {
  W[0] = dt;
  const d = W[0];
  syncWave();
  for (let k = 0; k < UTIL_COUNT; k++) {
    if (LEFT[k] <= 0) continue;
    const l = LEFT[k] - d;
    if (l > 0) LEFT[k] = l;
    else {
      LEFT[k] = 0;
      if (k === UTIL.TURBO) {
        MUL[0] = 1;
        MUL[1] = 1;
      }
    }
    hudInts(k);
  }
  if (LEFT[UTIL.COMPUTE] > 0) {
    W[1] += d;
    if (W[1] >= 1) {
      W[1] -= 1;
      computeThisSecond = 0;
    }
  }
  const life = U.groundSeconds;
  for (let i = count - 1; i >= 0; i--) {
    uAge[i] += d;
    if (uAge[i] >= life) {
      expired++;
      removeAt(i);
      continue;
    }
    if (!P.alive) continue;
    const dx = P.x - uX[i];
    const dz = P.z - uZ[i];
    if (dx * dx + dz * dz <= PICK_R2) {
      const id = uId[i];
      const pv = uHeal[i];
      removeAt(i);
      RAM_N[RECAP_T.UTIL0 + id]++; // § E5.E.2 : récap des ramassages du HUD
      if (id === UTIL.BATTERY) RAM_I[RECAP_T.UTIL0 + id] += pv; // Femz 20/11 soir : PV de CETTE Batterie
      activate(id, pv);
    }
  }
}

function removeAt(i) {
  const last = --count;
  uX[i] = uX[last];
  uZ[i] = uZ[last];
  uAge[i] = uAge[last];
  uId[i] = uId[last];
  uHeal[i] = uHeal[last];
  uPal[i] = uPal[last];
}

/** F11 : pastilles tournées vers la caméra (le shader les redresse), chute qui rebondit, flottement, clignotement. */
export function sync() {
  const fxArr = mesh.geometry.attributes.aFx.array;
  const blinkFrom = U.groundSeconds - U.blinkSeconds;
  for (let i = 0; i < count; i++) {
    const a = uAge[i];
    let pop = a * 3;
    if (pop > 1) pop = 1;
    const pal = uPal[i];
    const s = U.size * (0.5 + 0.5 * pop * (2 - pop)) * (pal >= 0 ? DECORS.drop.taille[pal] : 1);
    const ti = i * 4;
    if (pal >= 0) {
      tintArr[ti] = TINT[pal * 3];
      tintArr[ti + 1] = TINT[pal * 3 + 1];
      tintArr[ti + 2] = TINT[pal * 3 + 2];
      tintArr[ti + 3] = 1;
    } else tintArr[ti + 3] = 0;
    const y = U.y + U.bob * Math.sin(a * U.bobHz * 6.2832) + (1 - pop) * (1 - pop) * 1.4;
    const o = i * 16;
    matArr[o] = s;
    matArr[o + 1] = 0;
    matArr[o + 2] = 0;
    matArr[o + 3] = 0;
    matArr[o + 4] = 0;
    matArr[o + 5] = s;
    matArr[o + 6] = 0;
    matArr[o + 7] = 0;
    matArr[o + 8] = 0;
    matArr[o + 9] = 0;
    matArr[o + 10] = s;
    matArr[o + 11] = 0;
    matArr[o + 12] = uX[i];
    matArr[o + 13] = y;
    matArr[o + 14] = uZ[i];
    matArr[o + 15] = 1;
    fxArr[i * 2] = uId[i];
    let alpha = 1;
    if (a > blinkFrom) {
      const ph = (a - blinkFrom) * (CF.reduits && U.blinkHz > CF.hzMax ? CF.hzMax : U.blinkHz); // § E5.X5 : 5 Hz → hzMax
      if (ph - Math.floor(ph) >= 0.5) alpha = 0.25;
    }
    fxArr[i * 2 + 1] = alpha;
  }
  if (count > 0) mesh.geometry.attributes.aTint.needsUpdate = true;
  render.commit(mesh, count);
}

export function getGroundCount() {
  return count;
}

/** Tests et ?debug : utilitaire id posé en (x, z), sans plafond. */
export function debugDrop(id, x, z) {
  return dropAt(x, z, UTIL_SOURCE.DEBUG, id);
}

/** Tests : vide le sol et les effets. */
export function debugClear() {
  count = 0;
  LEFT.fill(0);
  TENTHS.fill(0);
  PCT.fill(0);
  MUL[0] = 1;
  MUL[1] = 1;
}

/** Tests : tirage de rollOnKillF sans robot (rend l'id tiré ou −1), plafonds compris si withCaps. */
export function debugRollKill(withCaps) {
  const r = utilRand();
  let acc = 0;
  for (let k = 0; k < UTIL_COUNT; k++) {
    acc += KILL_W[k];
    if (r < acc) return withCaps && allow(k) === 0 ? -1 : k;
  }
  return -1;
}

/** Tests : tirage d'une borne (id par poids). */
export function debugRollProp() {
  const r = utilRand();
  let acc = 0;
  for (let k = 0; k < UTIL_COUNT; k++) {
    acc += PROP_W[k];
    if (r < acc) return k;
  }
  let last = UTIL_COUNT - 1;
  while (last > 0 && PROP_W[last] === 0) last--; // § E4.A.5
  return last;
}

export function inspect(out) {
  out.ground = count;
  out.groundList = [];
  for (let i = 0; i < count; i++) {
    const t = tintArr !== null ? Array.from(tintArr.subarray(i * 4, i * 4 + 4)) : null;
    out.groundList.push({ id: uId[i], x: uX[i], z: uZ[i], age: uAge[i], pv: uHeal[i], palier: uPal[i], taille: matArr !== null ? matArr[i * 16] : 0, teinte: t });
  }
  out.batteriesParPalier = Array.from(batteriesParPalier);
  out.left = Array.from(LEFT);
  out.mul = Array.from(MUL);
  out.dropsBySource = Array.from(dropsBySource);
  out.dropsById = Array.from(dropsById);
  out.pickedById = Array.from(pickedById);
  out.waveDrops = waveDrops;
  out.capped = capped;
  out.expired = expired;
  out.iemKills = iemKills;
  out.stunned = stunned;
  out.computeFrags = computeFrags;
  out.healed = healed;
  out.killRolls = killRolls[0];
  return out;
}
