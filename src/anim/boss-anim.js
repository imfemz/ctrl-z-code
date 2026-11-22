// ANIMATIONS v3 — boss : obus du mortier qui PARTENT DES CHEMINÉES et invocations qui SORTENT DE SON CORPS
// (proposition demandée par Femz le 13/11/2026 : « un retour vaut partout » — rien ne doit partir du centre d'un corps ou
// apparaître de nulle part). Prototype : rendu seulement, aucune règle du boss ne change.
//
// MORTIER (phase 2) : pendant les castSeconds (0,5 s) du lancer, chaque obus quitte une des deux cheminées dorsales à
// tour de rôle (décalage OBUS.ecart), avec un éclair et une bouffée de fumée, vole en cloche (traînée de fumée) et
// retombe PILE sur sa zone télégraphiée à l'instant où le télégraphe actuel la fait exploser (même zD, même zT) :
// la cloche est calculée sur le temps restant de la zone, pas sur une vitesse. Il projette son ombre (elle converge
// vers la zone : un repère de plus).
// INVOCATION : chaque drone sort d'une trappe du ventre du boss et vole jusqu'à son point d'invocation pendant le
// télégraphe (0,8 s) ; il se pose à l'instant où le vrai drone apparaît (même point, hauteur de vol du drone).
// Cheminées et trappe : repère du maillage du boss (boss.js construit ses cheminées à (±0,8 ; 5,05 ; −1,45) avant
// l'échelle (radius / 2,2, height / 5, radius / 2,2)) ; positions monde par la matrice du maillage « boss ».
//
// INTÉGRATION (src/boss.js) — l'API remplace la lecture des zones que fait le prototype (copie patchée
// tests/anim/gen-boss.mjs) :
//   - startMortar(i) : après chaque addZone(Z_MORTAR, x, z, r, telegraph + k × stagger, dmg) réussi :
//       bossAnim.lancerObus(zoneIndex, k) — l'obus k part de la cheminée k % 2 après k × ecart s ;
//   - startSummon(i) : après chaque addZone(Z_SUMMON, …) réussi : bossAnim.lancerInvocation(zoneIndex, k) ;
//   - removeZone / swap des zones (updateZones) : bossAnim.zoneDeplacee(de, vers) (les obus suivent leur zone) ;
//   - sync() : bossAnim.sync(meshBoss, zX, zZ, zT, zD) après le placement du maillage du boss ;
//   - clearHazards / reset / mort : bossAnim.reset().
//   - clés : ANIM.boss → BOSS.attacks.mortar.shell { ecart, cloche, rayon, fumee } et BOSS.attacks.summon.hatch.
// Coût : ≤ 5 obus + ≤ 6 drones instanciés (2 appels de dessin, plus l'éclair) et quelques fx.spawnPuff par obus
// (événements). Zéro allocation par image.
// INTÉGRÉ (étape « animations », ARCHITECTURE.md § Z sexies) : boss.setModele → init(scene, zones) (zones = tableaux
//   des zones de boss.js : kind, x, z, t, d, et count() ; après la pose du modèle du drone, dont il reprend géométrie et
//   matériau) ; fin de boss.update → update(dt) ; boss.sync, après bossCorps.sync → sync() ; reset du boss → reset().
//   Le suivi des zones par leur position (prototype) est gardé tel quel : plus d'import de boss.js (cycle).
import * as THREE from 'three';
import { E } from '../state.js';
import { BOSS, ENEMIES } from '../config.js';
import * as fx from '../fx.js';
import { ANIM } from './reglages.js';
import { createPaintedMaterial } from '../rendu/materiaux.js';
import * as bossCorps from './boss-corps.js';

const O = ANIM.boss;
const Z_MORTAR = 4;
const Z_SUMMON = 5;
const CAP = 16;
// enregistrements par zone suivie : clé (x, z) de la zone, genre, ordre, départ (monde), fumée émise
const rX = new Float32Array(CAP);
const rZ = new Float32Array(CAP);
const rKind = new Uint8Array(CAP);
const rOrd = new Uint8Array(CAP);
const rLance = new Uint8Array(CAP); // 1 = parti (départ figé)
const rSX = new Float32Array(CAP);
const rSY = new Float32Array(CAP);
const rSZ = new Float32Array(CAP);
const rFumee = new Int32Array(CAP);
const rVu = new Uint8Array(CAP);
const rUsed = new Uint8Array(CAP);
const ordre = new Int32Array(2); // prochain numéro d'ordre : [obus, drones]
const flashT = new Float32Array(2).fill(1e3); // s depuis l'éclair de chaque cheminée
const SC = new Float64Array(2); // dernier temps vu
const st = { actif: false, pret: false };
let obus = null;
let drones = null;
let eclairs = null;
let eclairAttr = null;
let meshBoss = null;
// zones télégraphiées de boss.js (tableaux partagés, donnés à init) ; prototype : copie patchée de boss.js
const Z = { kind: null, x: null, z: null, t: null, d: null, count: () => 0 };
const INVOC_CAP = 16; // robots invoqués affichés en même temps (CAPS.telegraphs zones au plus)
const MODELES_INVOC = {}; // clé du type → son maillage instancié
const INVOC = new Float64Array(1); // hauteur où se pose le robot invoqué (vol du drone ; 0 pour un robot au sol)

/**
 * Type du robot invoqué par le boss en cours (§ E1.D) : le modèle qui sort de la trappe est celui de ce type. Appelé
 * par boss.js à la prise en charge du boss (une fois par boss, hors du chemin chaud).
 */
export function setTypeInvocation(type) {
  const T = ENEMIES.types[type];
  INVOC[0] = T.hover || 0;
  const m = MODELES_INVOC[T.key] || MODELES_INVOC.drone;
  if (!drones || !m || drones === m) return;
  drones.count = 0; // l'ancien maillage se vide ; le nouveau prend la suite dès le prochain sync
  drones = m;
}
const LOC = new Float64Array([0.8, 5.05, -1.45, -0.8, 5.05, -1.45, 0, 2.0, 1.15]); // cheminée g, d, trappe (avant échelle)

function geometrieObus() {
  const g = new THREE.IcosahedronGeometry(O.rayon, 1);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const em = new Float32Array(n);
  const p = g.attributes.position.array;
  const fer = new THREE.Color(0x3a3d45);
  const feu = new THREE.Color(0xff6a1f);
  for (let i = 0; i < n; i++) {
    const haut = p[i * 3 + 1] > O.rayon * 0.55; // calotte incandescente
    const c = haut ? feu : fer;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    em[i] = haut ? 1 : 0;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(em, 1));
  g.setAttribute('aFx', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.deleteAttribute('uv');
  return g;
}

export function init(scene, zones) {
  if (zones) Object.assign(Z, zones);
  meshBoss = scene.getObjectByName('boss');
  obus = new THREE.InstancedMesh(geometrieObus(), createPaintedMaterial({ profil: 'objet', glowColor: 0xff6a1f }), 8);
  obus.name = 'boss-obus';
  obus.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  obus.frustumCulled = false;
  obus.castShadow = true;
  obus.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  obus.count = 0;
  scene.add(obus);
  // robots invoqués : la géométrie et le matériau des robots du jeu (attributs de sommet), aFx propre. Un maillage par
  // type invoqué (§ E1.D : drones au rang 1, tireurs ensuite), tous dans la scène dès l'init (géométries connues du
  // renderer au préchauffage : rien n'est créé en partie) ; un seul a des instances à la fois (setTypeInvocation), un
  // maillage sans instance ne coûte aucun appel de dessin.
  for (const key of ['drone', 'tireur']) {
    const src = scene.getObjectByName('robots-' + key);
    if (!src) continue;
    const g = new THREE.BufferGeometry();
    for (const k of Object.keys(src.geometry.attributes)) {
      const a = src.geometry.attributes[k];
      if (!a.isInstancedBufferAttribute) g.setAttribute(k, a);
    }
    if (src.geometry.index) g.setIndex(src.geometry.index);
    g.setAttribute('aFx', new THREE.InstancedBufferAttribute(new Float32Array(INVOC_CAP * 2), 2));
    if (src.geometry.attributes.aGait) g.setAttribute('aGait', new THREE.InstancedBufferAttribute(new Float32Array(INVOC_CAP * 4), 4));
    const m = new THREE.InstancedMesh(g, src.material, INVOC_CAP);
    m.name = key === 'drone' ? 'boss-invocations' : 'boss-invocations-' + key;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
    MODELES_INVOC[key] = m;
  }
  drones = MODELES_INVOC.drone || null;
  const eg = new THREE.IcosahedronGeometry(1, 1);
  eclairAttr = new THREE.InstancedBufferAttribute(new Float32Array(2), 1);
  eclairAttr.setUsage(THREE.DynamicDrawUsage);
  eg.setAttribute('aA', eclairAttr);
  eclairs = new THREE.InstancedMesh(
    eg,
    new THREE.ShaderMaterial({
      vertexShader: `attribute float aA; varying float vA; varying vec3 vN;
        void main() { vA = aA; vN = normalize( normalMatrix * mat3( instanceMatrix ) * normal );
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: `varying float vA; varying vec3 vN;
        void main() { float c = pow( abs( vN.z ), 1.5 ); gl_FragColor = vec4( vec3( 1.0, 0.55, 0.18 ) * 3.0 * vA * ( 0.3 + c ), 1.0 ); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    2,
  );
  eclairs.name = 'boss-eclairs-cheminees';
  eclairs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  eclairs.frustumCulled = false;
  eclairs.count = 0;
  scene.add(eclairs);
  INVOC[0] = ENEMIES.types[1].hover;
  st.pret = true;
}

export function reset() {
  rUsed.fill(0);
  ordre.fill(0);
  flashT.fill(1e3);
}

// point k (0 = cheminée g, 1 = cheminée d, 2 = trappe) en monde, écrit dans OUT
const OUT = new Float64Array(3);
function point(k) {
  if (k < 2 && bossCorps.pret()) {
    OUT[0] = bossCorps.cheminees[k * 3];
    OUT[1] = bossCorps.cheminees[k * 3 + 1];
    OUT[2] = bossCorps.cheminees[k * 3 + 2];
    return;
  }
  const sx = BOSS.radius / 2.2;
  const sy = BOSS.height / 5;
  const x = LOC[k * 3] * sx;
  const y = LOC[k * 3 + 1] * sy;
  const z = LOC[k * 3 + 2] * sx;
  const e = meshBoss.matrixWorld.elements;
  OUT[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
  OUT[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
  OUT[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
}

function ecrireMatrice(arr, o, x, y, z, s) {
  arr[o] = s;
  arr[o + 1] = 0;
  arr[o + 2] = 0;
  arr[o + 3] = 0;
  arr[o + 4] = 0;
  arr[o + 5] = s;
  arr[o + 6] = 0;
  arr[o + 7] = 0;
  arr[o + 8] = 0;
  arr[o + 9] = 0;
  arr[o + 10] = s;
  arr[o + 11] = 0;
  arr[o + 12] = x;
  arr[o + 13] = y;
  arr[o + 14] = z;
  arr[o + 15] = 1;
}

/** Pas de simulation (fin de boss.update) : temps simulé cumulé jusqu'au prochain sync (0 dans le hitstop et les menus). */
const DTS = new Float64Array(1);
export function update(dt) {
  if (dt > 0) DTS[0] += dt;
}

/** Une image : suit les zones du boss, dessine obus et drones (temps simulé écoulé depuis la dernière image : DTS). */
export function sync() {
  const dt = DTS[0];
  DTS[0] = 0;
  if (!st.pret || !st.actif || meshBoss === null) {
    if (obus) obus.count = 0;
    if (drones) drones.count = 0;
    if (eclairs) eclairs.count = 0;
    return;
  }
  const n = Z.count();
  const KIND = Z.kind;
  const ZX = Z.x;
  const ZZ = Z.z;
  const ZT = Z.t;
  const ZD = Z.d;
  rVu.fill(0);
  let no = 0;
  let nd = 0;
  const ao = obus.instanceMatrix.array;
  const ad = drones ? drones.instanceMatrix.array : null;
  const visible = E.bossIndex >= 0 && meshBoss.visible;
  for (let z = 0; z < n; z++) {
    const kind = KIND[z];
    if (kind !== Z_MORTAR && kind !== Z_SUMMON) continue;
    // enregistrement de cette zone (clé : sa position, fixe pendant tout le télégraphe)
    let r = -1;
    for (let k = 0; k < CAP; k++) if (rUsed[k] === 1 && rX[k] === ZX[z] && rZ[k] === ZZ[z] && rKind[k] === kind) r = k;
    if (r < 0) {
      for (let k = 0; k < CAP && r < 0; k++) if (rUsed[k] === 0) r = k;
      if (r < 0) continue;
      rUsed[r] = 1;
      rX[r] = ZX[z];
      rZ[r] = ZZ[z];
      rKind[r] = kind;
      const q = kind === Z_MORTAR ? 0 : 1;
      rOrd[r] = ordre[q]++;
      rLance[r] = 0;
      rFumee[r] = -1;
    }
    rVu[r] = 1;
    if (!visible) continue;
    const e = ZD[z] - ZT[z]; // s écoulées depuis la création de la zone
    const mortier = kind === Z_MORTAR;
    const delai = rOrd[r] * (mortier ? O.ecart : O.ecartInvocation);
    if (e < delai) continue;
    if (rLance[r] === 0) {
      // départ : position figée (cheminée à tour de rôle, ou trappe), éclair et fumée
      const c = mortier ? rOrd[r] & 1 : 2;
      point(c);
      rSX[r] = OUT[0];
      rSY[r] = OUT[1];
      rSZ[r] = OUT[2];
      rLance[r] = 1;
      if (mortier) {
        flashT[c] = 0;
        bossCorps.tirMortier(c);
        for (let k = 0; k < O.fumeeDepart; k++) fx.spawnPuff(OUT[0], OUT[1] + 0.2, OUT[2], 0x5a5d66);
      }
    }
    const T = ZD[z] - delai;
    let u = T > 1e-3 ? (e - delai) / T : 1;
    if (u > 1) u = 1;
    const yFin = mortier ? 0.15 : INVOC[0];
    const dx = rX[r] - rSX[r];
    const dz = rZ[r] - rSZ[r];
    const dist = Math.sqrt(dx * dx + dz * dz);
    const h = (mortier ? O.cloche : O.clocheInvocation) + dist * 0.15;
    const x = rSX[r] + dx * u;
    const y = rSY[r] + (yFin - rSY[r]) * u + h * 4 * u * (1 - u);
    const zz = rSZ[r] + dz * u;
    if (mortier) {
      if (no < 8) ecrireMatrice(ao, no++ * 16, x, y, zz, 1);
      const f = Math.floor(e / O.fumee);
      if (f !== rFumee[r]) {
        rFumee[r] = f;
        fx.spawnPuff(x, y, zz, 0x6a6f7a);
      }
    } else if (ad !== null && nd < INVOC_CAP) {
      // drone : tourné vers sa trajectoire, grossit en sortant de la trappe
      const s = u < 0.25 ? 0.4 + 0.6 * (u / 0.25) : 1;
      const a = Math.atan2(dx, dz);
      const c = Math.cos(a) * s;
      const sn = Math.sin(a) * s;
      const o = nd++ * 16;
      ad[o] = c;
      ad[o + 1] = 0;
      ad[o + 2] = -sn;
      ad[o + 3] = 0;
      ad[o + 4] = 0;
      ad[o + 5] = s;
      ad[o + 6] = 0;
      ad[o + 7] = 0;
      ad[o + 8] = sn;
      ad[o + 9] = 0;
      ad[o + 10] = c;
      ad[o + 11] = 0;
      ad[o + 12] = x;
      ad[o + 13] = y; // maillage du drone : pieds à y = 0, posé à sa hauteur de vol en fin de course
      ad[o + 14] = zz;
      ad[o + 15] = 1;
    }
  }
  for (let k = 0; k < CAP; k++) if (rUsed[k] === 1 && rVu[k] === 0) rUsed[k] = 0; // zone finie : l'obus a frappé
  // plus aucune zone d'un genre : son compteur d'ordre repart à 0 (prochaine salve : cheminée gauche d'abord)
  let restO = 0;
  let restD = 0;
  for (let k = 0; k < CAP; k++) if (rUsed[k] === 1) rKind[k] === Z_MORTAR ? restO++ : restD++;
  if (restO === 0) ordre[0] = 0;
  if (restD === 0) ordre[1] = 0;
  obus.count = no;
  if (no) obus.instanceMatrix.needsUpdate = true;
  if (drones) {
    drones.count = nd;
    if (nd) drones.instanceMatrix.needsUpdate = true;
  }
  // éclairs des cheminées
  let ne = 0;
  const ae = eclairs.instanceMatrix.array;
  for (let c = 0; c < 2; c++) {
    flashT[c] += dt;
    if (flashT[c] >= O.eclair) continue;
    const u = flashT[c] / O.eclair;
    point(c);
    ecrireMatrice(ae, ne * 16, OUT[0], OUT[1] + 0.25, OUT[2], O.tailleEclair * (0.6 + 0.8 * u));
    eclairAttr.array[ne] = (1 - u) * (1 - u);
    ne++;
  }
  eclairs.count = ne;
  if (ne) {
    eclairs.instanceMatrix.needsUpdate = true;
    eclairAttr.needsUpdate = true;
  }
}

// ----- prototype ----------------------------------------------------------------------------------------------------
export async function brancher({ scene }) {
  const boss = await import('../boss.js'); // copie patchée (tests/anim/gen-boss.mjs)
  init(scene, { kind: boss.__zKind, x: boss.__zX, z: boss.__zZ, t: boss.__zT, d: boss.__zD, count: () => boss.__zCount });
}
export function protoSetApres(on) {
  st.actif = !!on;
  if (!on) reset();
}
export function protoUpdate(dt) {
  update(dt);
}
export function protoSync() {
  sync();
}
export function protoInspect(out) {
  out.obus = obus ? obus.count : 0;
  out.drones = drones ? drones.count : 0;
  out.eclairs = eclairs ? eclairs.count : 0;
}
/** Jeu intégré : actif dès l'init (boss.js). */
export function setActif(on) {
  st.actif = !!on;
  if (!on) reset();
}
