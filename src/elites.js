// Plan addictif, étape 3, chantier A — élites porteuses à modificateurs (ARCHITECTURE.md § E3.A).
//
// Une porteuse (enemies.makeCarrierF, sortie par waves.spawnCarrier) tire ici un modificateur (E.mod) : Surchargé,
// Régénérant, Générateur de bouclier, Couveuse, Instable, Phasé (docs/contenu-vampire-survivors.md § 4.6). Son anneau
// reste à la couleur de sa RARETÉ (chests.sync) ; le modificateur se lit par une icône pixel au-dessus du robot (blanc,
// liseré rouge de l'AGI, toujours tournée vers la caméra) et par son effet propre (traînée, bulle au sol, clignement).
// Rareté haute (Noyau, Root) : tirée ici aussi (highRarity), avant le tirage de l'étape 2.
//
// Dessin : UN InstancedMesh `elite-mods` (atlas de 8 cases : 6 icônes + le cercle de la bulle) ; 0 appel de dessin
// quand aucune élite à modificateur ne vit.
//
// Allocation (§ V) : update, sync, damageMulF et onKillF n'allouent rien — tables typées de taille SLOTS par élite,
// repérées par E.uid (les indices de E bougent à la compaction de S13) ; flottants vers hazards par ARGF.
import * as THREE from 'three';
import { BARRE, CHESTS, ELITES, ELITE_MOD, ELITE_MOD_COUNT, ELITE_MOD_ICONS, ENEMIES, ENEMY, HAZ, RARITY, carrierRarity, eliteModChance } from './config.js';
import { ARGF, E, F_DX, F_DZ, F_SX, F_SZ, F_T, F_V, F_X, F_Z } from './state.js';
import { CAUSE } from './config.js'; // § E5.Q (C2) : les obus de l'Instable ne sont pas ceux du tireur v3
import { CONFORT_FLASHS as CF } from './config.js'; // § E5.X5 (audit C12) : réglage « Flashs »
//#region e5:X8-lot8
import { LOT8 } from './config.js'; // § E5.X8 (E11) : retour d'un coup ignoré pendant la phase
import { P } from './state.js';
let fx = null;
let audio = null;
// X8P : [0] écart minimal entre deux retours (s), [1] instant du dernier retour, [2] gain du son, [3] sa vitesse
const X8P = new Float64Array([LOT8.phase.ecart, -1e9, LOT8.phase.son.gain, LOT8.phase.son.vitesse]);
const X8P_SON = LOT8.phase.son.id | 0;
let ignoresVus = 0; // coups ignorés qui ont donné un retour (gerbe + son)
/** § E5.X8 (E11) : le robot i est-il un Phasé EN PHASE ? 1 / 0. Repéré par E.uid (les indices bougent à la compaction,
 *  et enemies.update passe avant update : sIdx peut dater de l'image d'avant). Entier rendu. */
export function phaseF(i) {
  if (E.mod[i] !== ELITE_MOD.PHASE) return 0;
  const u = E.uid[i];
  for (let s = 0; s < SLOTS; s++) if (sIdx[s] >= 0 && sUid[s] === u && sMod[s] === ELITE_MOD.PHASE) return isPhased(s) ? 1 : 0;
  return 0;
}
/** § E5.X8 (E11) : coup ignoré par le Phasé i — petite gerbe grise vers le héros et un son, au plus un par X8P[0] s. */
function ignoreF(i) {
  if (fx === null || CLOCK[0] - X8P[1] < X8P[0]) return;
  X8P[1] = CLOCK[0];
  ignoresVus++;
  ARGF[F_X] = E.x[i];
  ARGF[F_Z] = E.z[i];
  ARGF[F_DX] = P.x - E.x[i];
  ARGF[F_DZ] = P.z - E.z[i];
  fx.spawnShieldDampF();
  ARGF[F_X] = E.x[i];
  ARGF[F_Z] = E.z[i];
  ARGF[F_V] = X8P[2];
  ARGF[F_T] = X8P[3];
  audio.playGainRateF(X8P_SON);
}
//#endregion e5:X8-lot8

let render = null;
let enemies = null;
let hazards = null;
let camera = null;

const SLOTS = 16; // élites à modificateur en vie au plus (porteuses : 2 par vague ; marge pour le debug)
const CELLS = 8;
const TAU = Math.PI * 2;
const M = ELITES.mods;
const SUR = M[ELITE_MOD.SURCHARGE];
const REG = M[ELITE_MOD.REGEN];
const BOU = M[ELITE_MOD.BOUCLIER];
const COU = M[ELITE_MOD.COUVEUSE];
const INS = M[ELITE_MOD.INSTABLE];
const PHA = M[ELITE_MOD.PHASE];
const BOU_R2 = BOU.radius * BOU.radius;
const IC = ELITES.icon;
// § E4.H : pose de l'icône au-dessus de la petite barre de vie (même calcul que src/barres-vie.js)
const BAR_KR = BARRE.liftPerRadius;
const BAR_UP = BARRE.lift + (BARRE.hPx * BARRE.px) / 2 + BARRE.iconGap + IC.size / 2;

const sUid = new Uint32Array(SLOTS);
const sIdx = new Int32Array(SLOTS).fill(-1); // indice dans E pour l'image courante (−1 : emplacement libre)
const sMod = new Uint8Array(SLOTS);
const sSeen = new Uint8Array(SLOTS);
const sT0 = new Float32Array(SLOTS); // minuterie principale (traînée, couveuse, phase)
const sHpMul = new Float32Array(SLOTS); // multiplicateur de PV de la vague à la sortie (drones de la couveuse)
/** ACTIVE[0] = élites à modificateur suivies ; lu par damage avant d'appeler damageMulF. */
export const ACTIVE = new Int32Array(1);
const CLOCK = new Float64Array(1);
let rootWave = -1; // vague de la dernière Root (au plus une par vague)

// Compteurs (inspect, tests)
const assigned = new Int32Array(ELITE_MOD_COUNT);
let rolled = 0; // porteuses passées par assignF
let trails = 0;
const REGEN_HP = new Float64Array(1); // PV rendus (flottant : tableau typé, § V)
let shielded = 0; // coups réduits par une bulle
let phased = 0; // coups ignorés pendant une phase
let broods = 0; // drones sortis d'une couveuse
let broodRefused = 0; // drones abandonnés (E plein)
let shells = 0; // obus d'une Instable
const highRolled = new Int32Array(2);

let mesh = null;
let matArr = null;
let colArr = null;
let cellArr = null;
let shown = 0;
const EDGE_RGB = new Float32Array(3);

export function init(ctx) {
  render = ctx.render;
  enemies = ctx.enemies;
  hazards = ctx.hazards;
  camera = ctx.camera;
  fx = ctx.fx || null; // § E5.X8
  audio = ctx.audio || null;
  // Atlas : 8 cases de 14 × 14 pixels de grille (12 + le liseré) ; case 7 = cercle de la bulle.
  const px = IC.px;
  const cell = 14 * px;
  const cv = document.createElement('canvas');
  cv.width = cell * CELLS;
  cv.height = cell;
  const g = cv.getContext('2d');
  const edge = '#' + IC.edge.toString(16).padStart(6, '0');
  for (let m = 1; m < ELITE_MOD_COUNT; m++) {
    const grid = ELITE_MOD_ICONS[m];
    const ox = m * cell;
    g.fillStyle = edge; // liseré : chaque pixel allumé, dilaté d'un pixel, en rouge, sous le blanc
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (grid[y][x] === '#') g.fillRect(ox + x * px, y * px, 3 * px, 3 * px);
    g.fillStyle = '#ffffff';
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (grid[y][x] === '#') g.fillRect(ox + (x + 1) * px, (y + 1) * px, px, px);
  }
  g.strokeStyle = '#ffffff';
  g.lineWidth = px * 0.9;
  g.beginPath();
  g.arc(7 * cell + cell / 2, cell / 2, cell / 2 - px, 0, TAU);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.05, toneMapped: false });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCell;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x = (vMapUv.x + aCell) / ' + CELLS.toFixed(1) + ';\n#endif');
  };
  const quad = new THREE.PlaneGeometry(1, 1);
  mesh = render.createInstanced(quad, mat, SLOTS * 2, { instanceColor: true, name: 'elite-mods' });
  const aCell = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 2), 1);
  aCell.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('aCell', aCell);
  mesh.renderOrder = 3;
  matArr = mesh.instanceMatrix.array;
  colArr = mesh.instanceColor.array;
  cellArr = aCell.array;
  render.writeColor(EDGE_RGB, 0, IC.bubbleColor, IC.bubbleGain);
}

export function reset() {
  sIdx.fill(-1);
  sMod.fill(0);
  ACTIVE[0] = 0;
  CLOCK[0] = 0;
  rootWave = -1;
  assigned.fill(0);
  highRolled.fill(0);
  REGEN_HP[0] = 0;
  rolled = trails = shielded = phased = broods = broodRefused = shells = 0;
  ignoresVus = 0; // § E5.X8
  X8P[1] = -1e9;
  shown = 0;
}

/**
 * Règle 3 : rareté d'une porteuse de la vague n. Dès ELITES.rarityHigh.from, un tirage (rnd) donne Noyau ou Root ;
 * sinon (ou avant) la rareté de l'étape 2 (carrierRarity, tirage rnd suivant). Au plus une Root par vague.
 */
export function highRarity(wave, rnd) {
  const H = ELITES.rarityHigh;
  if (wave >= H.from) {
    const x = rnd() * 100;
    if (x < H.w[1] && rootWave !== wave) {
      rootWave = wave;
      highRolled[1]++;
      return RARITY.ROOT;
    }
    if (x < H.w[0] + H.w[1]) {
      highRolled[0]++;
      return RARITY.NOYAU;
    }
  }
  return carrierRarity(wave, rnd());
}

function freeSlot() {
  for (let s = 0; s < SLOTS; s++) if (sIdx[s] < 0) return s;
  // plein : un emplacement dont l'élite est morte depuis la dernière update (plusieurs porteuses dans une image) est repris
  for (let s = 0; s < SLOTS; s++) {
    const j = sIdx[s];
    if (j >= E.count || E.alive[j] === 0 || E.uid[j] !== sUid[s]) {
      sIdx[s] = -1;
      if (ACTIVE[0] > 0) ACTIVE[0]--;
      return s;
    }
  }
  return -1;
}

/** Applique le modificateur m au robot i (debug et assignF). Rend m, ou 0 si aucun emplacement libre. */
export function applyMod(i, m) {
  if (!(m > 0 && m < ELITE_MOD_COUNT) || E.alive[i] === 0) return 0;
  const s = freeSlot();
  if (s < 0) return 0;
  E.mod[i] = m;
  sUid[s] = E.uid[i];
  sIdx[s] = i;
  sMod[s] = m;
  sT0[s] = 0;
  const T = ENEMIES.types[E.type[i]];
  sHpMul[s] = E.maxHp[i] / (T.hp * CHESTS.carrier.hpMul);
  if (m === ELITE_MOD.SURCHARGE) E.speed[i] *= SUR.speedMul;
  if (m === ELITE_MOD.PHASE) sT0[s] = PHA.period * 0.5; // la première phase vient vite : le joueur la voit
  ACTIVE[0]++;
  assigned[m]++;
  return m;
}

/**
 * Règle 1 : appelé par waves.spawnCarrier après makeCarrierF. Tire (rnd, flux privé des coffres) la présence d'un
 * modificateur, puis lequel parmi ceux permis à la vague. Rend le modificateur posé (0 = aucun). Hors chemin chaud :
 * une porteuse par demi-vague.
 */
export function assignF(i, wave, rnd) {
  rolled++;
  const c = eliteModChance(wave);
  if (!(c > 0) || rnd() >= c) return 0;
  let n = 0;
  for (let m = 1; m < ELITE_MOD_COUNT; m++) if (wave >= M[m].from) n++;
  if (n === 0) return 0;
  let pick = Math.floor(rnd() * n);
  if (pick >= n) pick = n - 1;
  for (let m = 1; m < ELITE_MOD_COUNT; m++) {
    if (wave < M[m].from) continue;
    if (pick-- === 0) return applyMod(i, m);
  }
  return 0;
}

/** Texte de bannière d'une élite à modificateur (chaînes construites une fois). */
const BANNER = M.map((d) => (d.name ? CHESTS.carrier.kicker + ' : ' + d.name : ''));
export function bannerText(m) {
  return BANNER[m] || '';
}

function isPhased(s) {
  return sMod[s] === ELITE_MOD.PHASE && sT0[s] >= PHA.period - PHA.phaseSeconds;
}

/**
 * Lu par damage.hitEnemyF (étape 1 ter) : 0 = coup ignoré (Phasé en phase), 2 = coup réduit (dans la bulle d'un
 * Générateur de bouclier), 1 = normal. Entier rendu (jamais emballé). Indices de l'image courante (update en S5 bis).
 */
export function damageMulF(i) {
  const x = E.x[i];
  const z = E.z[i];
  let code = 1;
  for (let s = 0; s < SLOTS; s++) {
    const j = sIdx[s];
    if (j < 0) continue;
    const m = sMod[s];
    if (m === ELITE_MOD.PHASE) {
      if (j === i && isPhased(s)) {
        phased++;
        ignoreF(i); // § E5.X8 (E11)
        return 0;
      }
    } else if (m === ELITE_MOD.BOUCLIER && E.alive[j] === 1) {
      const dx = E.x[j] - x;
      const dz = E.z[j] - z;
      if (dx * dx + dz * dz <= BOU_R2) code = 2;
    }
  }
  if (code === 2) shielded++;
  return code;
}
/** Multiplicateur d'un coup réduit (code 2 de damageMulF). */
export const SHIELD_MUL = BOU.damageMul;

/** Le robot i est-il intangible en ce moment ? (Phasé : lu par les contrôles et le rendu.) */
export function isIntangible(i) {
  if (E.mod[i] !== ELITE_MOD.PHASE) return false;
  for (let s = 0; s < SLOTS; s++) if (sIdx[s] === i) return isPhased(s);
  return false;
}

/**
 * Mort d'une élite à modificateur (damage.killEnemyF, en dernier : l'appel réécrit ARGF). Instable : 6 obus
 * HAZ.STRIKE en couronne, annoncés. L'emplacement est libéré à l'update suivante (robot vu mort).
 */
export function onKillF(i) {
  if (E.mod[i] !== ELITE_MOD.INSTABLE) return;
  const x = E.x[i];
  const z = E.z[i];
  const dmg = E.dmg[i] * INS.dmgMul;
  for (let k = 0; k < INS.shells; k++) {
    const a = (k / INS.shells) * TAU;
    ARGF[F_X] = x + Math.cos(a) * INS.ring;
    ARGF[F_Z] = z + Math.sin(a) * INS.ring;
    ARGF[F_DX] = INS.radius;
    ARGF[F_DZ] = 1; // > 0 : un obus est dessiné en vol depuis (F_SX, F_SZ)
    ARGF[F_SX] = x;
    ARGF[F_SZ] = z;
    ARGF[F_T] = INS.telegraph;
    ARGF[F_V] = dmg;
    if (hazards.CAUSE_SUIVANTE) hazards.CAUSE_SUIVANTE[0] = CAUSE.OBUS_ELITE; // § E5.Q (C2)
    if (hazards.addF(HAZ.STRIKE) >= 0) shells++;
  }
}

/** S5 bis (après enemies.update) : indices de l'image, régénération, couveuse, traînée, cycle de phase. */
export function update(dt) {
  CLOCK[0] += dt;
  if (ACTIVE[0] === 0) return;
  sSeen.fill(0);
  const n = E.count;
  const MOD = E.mod;
  const AL = E.alive;
  const UID = E.uid;
  for (let i = 0; i < n; i++) {
    if (MOD[i] === 0 || AL[i] === 0) continue;
    const u = UID[i];
    for (let s = 0; s < SLOTS; s++) {
      if (sIdx[s] >= 0 && sUid[s] === u) {
        sIdx[s] = i;
        sSeen[s] = 1;
        break;
      }
    }
  }
  let active = 0;
  for (let s = 0; s < SLOTS; s++) {
    if (sIdx[s] < 0) continue;
    if (sSeen[s] === 0) {
      sIdx[s] = -1; // morte (ou retirée) : emplacement libre
      continue;
    }
    active++;
    const i = sIdx[s];
    const m = sMod[s];
    // § E3.K × E3.A (fusion du groupe 1) : une élite reportée en veille entre deux vagues est figée comme les autres
    // robots — ni régénération, ni drones de la Couveuse (ils naîtraient éveillés pendant la pause), ni traînée
    if (E.sus[i] !== 0) continue;
    sT0[s] += dt;
    if (m === ELITE_MOD.REGEN) {
      const max = E.maxHp[i];
      const add = max * REG.hpPerSecond * dt;
      const hp = E.hp[i] + add;
      E.hp[i] = Math.min(hp, max);
      REGEN_HP[0] += add;
    } else if (m === ELITE_MOD.SURCHARGE) {
      if (sT0[s] >= SUR.trailEvery) {
        sT0[s] -= SUR.trailEvery;
        ARGF[F_X] = E.x[i];
        ARGF[F_Z] = E.z[i];
        ARGF[F_DX] = SUR.trailRadius;
        ARGF[F_DZ] = 0;
        ARGF[F_SX] = 0;
        ARGF[F_SZ] = 0;
        ARGF[F_T] = SUR.trailLife;
        ARGF[F_V] = E.dmg[i] * SUR.dmgMul;
        if (hazards.addF(HAZ.SPARK) >= 0) trails++;
      }
    } else if (m === ELITE_MOD.COUVEUSE) {
      if (sT0[s] >= COU.every) {
        sT0[s] -= COU.every;
        for (let k = 0; k < COU.drones; k++) {
          // posés sur l'élite (lectures de tableaux typés : aucun flottant créé) ; la séparation les écarte
          const d = enemies.spawn(ENEMY.DRONE, E.x[i], E.z[i], sHpMul[s], E.mul[i]);
          if (d < 0) {
            broodRefused++;
            continue;
          }
          broods++;
        }
      }
    } else if (m === ELITE_MOD.PHASE) {
      if (sT0[s] >= PHA.period) sT0[s] -= PHA.period;
    }
  }
  ACTIVE[0] = active;
}

/** F11 : icônes au-dessus des élites (tournées vers la caméra) et bulles au sol des Générateurs de bouclier. */
export function sync() {
  if (ACTIVE[0] === 0 || mesh === null) {
    if (shown !== 0 && mesh !== null) render.commit(mesh, 0);
    shown = 0;
    return;
  }
  const cam = camera.threeCamera;
  const w = cam ? cam.matrixWorld.elements : null;
  // axes droite et haut de la caméra (colonnes 0 et 1 de sa matrice monde)
  const rx = w ? w[0] : 1, ry = w ? w[1] : 0, rz = w ? w[2] : 0;
  const ux = w ? w[4] : 0, uy = w ? w[5] : 1, uz = w ? w[6] : 0;
  const fx = w ? w[8] : 0, fy = w ? w[9] : 0, fz = w ? w[10] : 1;
  const t = CLOCK[0];
  let n = 0;
  for (let s = 0; s < SLOTS; s++) {
    const i = sIdx[s];
    if (i < 0 || E.alive[i] === 0 || E.sus[i] === 2) continue; // § E4.F : élite garée, ni icône ni bulle
    const m = sMod[s];
    const T = ENEMIES.types[E.type[i]];
    const sc = CHESTS.carrier.scale;
    const size = IC.size;
    const dim = isPhased(s) && (CF.reduits || Math.sin(t * IC.phaseBlinkHz * TAU) <= 0); // phase : l'icône clignote vite (§ E5.X5 Réduits : atténuée, fixe)
    // § E4.H : l'icône passe AU-DESSUS de la petite barre de vie (src/barres-vie.js), vers le haut de l'écran ; elle
    // remplace l'ancienne pose à IC.lift au-dessus de la tête (la barre y était désormais)
    const up = E.radius[i] * fy * BAR_KR + BAR_UP;
    const y = (T.height + T.hover) * sc + uy * up;
    let o = n * 16;
    matArr[o] = rx * size;
    matArr[o + 1] = ry * size;
    matArr[o + 2] = rz * size;
    matArr[o + 3] = 0;
    matArr[o + 4] = ux * size;
    matArr[o + 5] = uy * size;
    matArr[o + 6] = uz * size;
    matArr[o + 7] = 0;
    matArr[o + 8] = fx;
    matArr[o + 9] = fy;
    matArr[o + 10] = fz;
    matArr[o + 11] = 0;
    matArr[o + 12] = E.x[i] + ux * up;
    matArr[o + 13] = y;
    matArr[o + 14] = E.z[i] + uz * up;
    matArr[o + 15] = 1;
    let q = n * 3;
    colArr[q] = dim ? 0.25 : 1;
    colArr[q + 1] = dim ? 0.25 : 1;
    colArr[q + 2] = dim ? 0.25 : 1;
    cellArr[n] = m;
    n++;
    if (m === ELITE_MOD.BOUCLIER) {
      // bulle : cercle couché au sol, rayon BOU.radius (la zone exacte où les dégâts sont réduits)
      const d = BOU.radius * 2;
      o = n * 16;
      matArr[o] = d;
      matArr[o + 1] = 0;
      matArr[o + 2] = 0;
      matArr[o + 3] = 0;
      matArr[o + 4] = 0;
      matArr[o + 5] = 0;
      matArr[o + 6] = -d;
      matArr[o + 7] = 0;
      matArr[o + 8] = 0;
      matArr[o + 9] = 1;
      matArr[o + 10] = 0;
      matArr[o + 11] = 0;
      matArr[o + 12] = E.x[i];
      matArr[o + 13] = IC.bubbleY;
      matArr[o + 14] = E.z[i];
      matArr[o + 15] = 1;
      q = n * 3;
      const p = 0.85 + 0.15 * Math.sin(t * 3);
      colArr[q] = EDGE_RGB[0] * p;
      colArr[q + 1] = EDGE_RGB[1] * p;
      colArr[q + 2] = EDGE_RGB[2] * p;
      cellArr[n] = 7;
      n++;
    }
  }
  mesh.geometry.attributes.aCell.needsUpdate = true;
  shown = n;
  render.commit(mesh, n);
}

export function inspect(out) {
  out.active = ACTIVE[0];
  out.rolled = rolled;
  out.assigned = Array.from(assigned);
  out.highRolled = Array.from(highRolled);
  out.trails = trails;
  out.regenHp = REGEN_HP[0];
  out.shielded = shielded;
  out.phased = phased;
  out.ignoresVus = ignoresVus; // § E5.X8
  out.broods = broods;
  out.broodRefused = broodRefused;
  out.shells = shells;
  out.shown = shown;
  const list = [];
  for (let s = 0; s < SLOTS; s++) {
    const i = sIdx[s];
    if (i < 0) continue;
    list.push({ i, uid: sUid[s], mod: sMod[s], key: M[sMod[s]].key, t: sT0[s], phased: isPhased(s), x: E.x[i], z: E.z[i], hp: E.hp[i], maxHp: E.maxHp[i], speed: E.speed[i], rarity: E.rarity[i] });
  }
  out.list = list;
  return out;
}
