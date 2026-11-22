// ANIMATIONS v2 — R3 : cape du héros, tissu Verlet maison (plan docs/animations-plan.md § R3, choix de Femz : noire,
// effilochée en pointes). Prototype du 13/11/2026.
//
// SIMULATION
//   Grille de cols × rows particules (Float32Array) : rangées 0 … rows−2 = tissu, rangée rows−1 = POINTES (une par
//   colonne, longueurs irrégulières, aucune contrainte entre elles : elles fouettent indépendamment). Rangée 0
//   accrochée aux épaules (nœuds cape_epaule_g / cape_epaule_d du .glb), réécrite à chaque sous-pas depuis la matrice
//   du corps. Contraintes de distance : structure (raideur 1), cisaillement, flexion légère (une particule sur deux),
//   pointes. Forces : gravité, traînée de l'air le long de la normale locale du tissu (c'est elle qui fait flotter la
//   cape derrière le héros en course, la gonfle au dash, la fait balancer à l'arrêt), traînée tangentielle faible,
//   souffle de repos déterministe (fonction du temps simulé). Collisions : capsule du dos (cape_dos du .glb), bras (2
//   capsules épaule → main données en monde à chaque image par heros-anim, setCapsuleMonde), capsule des jambes, sol.
//   PAS FIXE : ANIM.cape.hz (120 Hz), sous-pas accumulés ; la pose du corps est INTERPOLÉE entre l'image précédente
//   et l'image courante à l'instant de chaque sous-pas (translation et échelle linéaires, rotation sphérique) : à 60 Hz (2 sous-pas par image) et à 240 Hz (un sous-pas une
//   image sur deux) les sous-pas tombent aux mêmes instants. Mesure (tests/anim-cape.mjs, 13/11) : écart moyen 60 / 240 Hz
//   0,4 à 2,3 cm en course, virage et arrêt, 1,3 cm au repos ; 4 à 11 cm en moyenne au plein du fouet d'un dash, jusqu'à
//   ~50 cm sur une POINTE (le tissu amplifie la différence d'échantillonnage du saut de pose du dash). Zéro allocation par image : tout l'état est dans des tableaux typés.
// RENDU
//   Un seul maillage (un seul héros), indexé, double face : positions et normales lissées réécrites à chaque image ;
//   matériau peint de src/rendu/ (profil « cape », ajouté à PEINT.profils s'il manque) ; dehors noir bleuté, dedans
//   noir bordeaux (gl_FrontFacing), bas un peu plus clair (usure) ; projette son ombre (matériau de profondeur double face).
//
// INTÉGRATION (src/player.js, quand le héros .glb est branché) :
//   - init : cape.init({ scene, ancrageG, ancrageD, dos, jambes }) après la création du maillage du héros
//     (points d'accroche et capsule du dos lus dans les vides du .glb : pieces.js → vides) ;
//   - reset() : cape.reset(matriceDuCorps) (Rejouer, téléportation debug) ;
//   - update(dt) étape 7 (après le cap) : RIEN — la cape dépend de la pose dessinée, pas de la simulation du joueur ;
//   - sync() : APRÈS le calcul de la pose du héros (heros-anim.sync) : cape.entree[0] = simDt ; cape.update(matriceDuCorps)
//     puis cape.sync(). simDt = le dt de simulation de l'image (0 pendant le hitstop et les menus : la cape se fige comme
//     le reste). Il faut donc que main.js transmette simDt à player.sync (ou que player.update l'accumule).
//   - mort : cape.setVisible(false).
//   - clés : ANIM.cape → PLAYER.cape (config.js, bloc PLAYER) ; profil PEINT.profils.cape → RENDER.peint.profils.cape.
//   - coût : tests/anim-perf.mjs (chrono des modules, allocations) ; 1 appel de dessin + 1 dans la carte d'ombre.
import * as THREE from 'three';
import { ANIM } from './reglages.js';
import { ajouterRevele, createPaintedMaterial } from '../rendu/materiaux.js';
import { PEINT } from '../rendu/reglages.js';
import { envelopper, profilsCorps, zProfil } from './profil-corps.js';

const C = ANIM.cape;
const NX = C.cols;
const NY = C.rows;
const N = NX * NY;
const H = 1 / C.hz;
const H2 = H * H;
const TIP = NY - 1; // rangée des pointes

const pos = new Float32Array(N * 3);
const prev = new Float32Array(N * 3);
const rest = new Float32Array(N * 3); // repère du corps
const nrm = new Float32Array(N * 3); // normales des particules (traînée)
const invM = new Float32Array(N);
const rowOf = new Uint8Array(N);

// contraintes
const MAXC = N * 8;
const cA = new Uint16Array(MAXC);
const cB = new Uint16Array(MAXC);
const cL = new Float32Array(MAXC);
const cK = new Float32Array(MAXC);
let nC = 0;

// profil du dos (src/anim/profil-corps.js, retour de Femz du 22/11) : quand le modèle le donne, il REMPLACE le cylindre
// du dos et le plan plat comme volume du torse (ils gardaient la cape à 10 cm de la taille)
let PROF = null;
const ADH = new Float64Array([1]); // [0] : part de l'adhérence : 1 à l'arrêt, 0 dès que le buste va plus vite que C.adherenceVmax (lissée)
// capsules (repère du corps) : 0 = dos, 1 = jambes ; a(3) b(3) rayon
const capLocal = new Float32Array(2 * 7);
// capsules données EN MONDE à chaque image (bras, qui bougent sur leurs os) : 2 et 3 ; image précédente / courante
const NDYN = 4; // bras g, bras d, jambe g, jambe d (en monde)
const NCAP = 2 + NDYN;
const capDyn0 = new Float32Array(NDYN * 7);
const capDyn1 = new Float32Array(NDYN * 7);
/** Capsules EN MONDE pour l'image courante (k × 7 : a, b, rayon ; rayon 0 = aucune ; 0-1 bras, 2-3 jambes), avant update(). */
export const capsulesMonde = capDyn1;
const capW = new Float32Array(NCAP * 7); // en monde, au sous-pas courant

// matrices du corps (colonne majeure, comme THREE.Matrix4.elements) : image précédente, courante, interpolée
const M0 = new Float32Array(16);
const M1 = new Float32Array(16);
const MI = new Float32Array(16);
// décomposition des deux poses (translation, échelle, quaternion) : tableaux typés, aucune allocation
// D0 / D1 = [tx, ty, tz, sx, sy, sz, qx, qy, qz, qw]
const D0 = new Float64Array(10);
const D1 = new Float64Array(10);

function decompose(M, D) {
  D[0] = M[12];
  D[1] = M[13];
  D[2] = M[14];
  const sx = Math.sqrt(M[0] * M[0] + M[1] * M[1] + M[2] * M[2]) || 1;
  const sy = Math.sqrt(M[4] * M[4] + M[5] * M[5] + M[6] * M[6]) || 1;
  const sz = Math.sqrt(M[8] * M[8] + M[9] * M[9] + M[10] * M[10]) || 1;
  D[3] = sx;
  D[4] = sy;
  D[5] = sz;
  // rotation pure (colonnes normalisées), puis quaternion (même méthode que three : setFromRotationMatrix)
  const m11 = M[0] / sx, m12 = M[4] / sy, m13 = M[8] / sz;
  const m21 = M[1] / sx, m22 = M[5] / sy, m23 = M[9] / sz;
  const m31 = M[2] / sx, m32 = M[6] / sy, m33 = M[10] / sz;
  const tr = m11 + m22 + m33;
  if (tr > 0) {
    const k = 0.5 / Math.sqrt(tr + 1.0);
    D[9] = 0.25 / k;
    D[6] = (m32 - m23) * k;
    D[7] = (m13 - m31) * k;
    D[8] = (m21 - m12) * k;
  } else if (m11 > m22 && m11 > m33) {
    const k = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    D[9] = (m32 - m23) / k;
    D[6] = 0.25 * k;
    D[7] = (m12 + m21) / k;
    D[8] = (m13 + m31) / k;
  } else if (m22 > m33) {
    const k = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    D[9] = (m13 - m31) / k;
    D[6] = (m12 + m21) / k;
    D[7] = 0.25 * k;
    D[8] = (m23 + m32) / k;
  } else {
    const k = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    D[9] = (m21 - m12) / k;
    D[6] = (m13 + m31) / k;
    D[7] = (m23 + m32) / k;
    D[8] = 0.25 * k;
  }
}

/** MI = pose interpolée à S[ALPHA] : translation et échelle linéaires, rotation sphérique (slerp). */
function interpoler() {
  const t = S[ALPHA];
  let bx = D1[6], by = D1[7], bz = D1[8], bw = D1[9];
  const ax = D0[6], ay = D0[7], az = D0[8], aw = D0[9];
  let c = ax * bx + ay * by + az * bz + aw * bw;
  if (c < 0) {
    c = -c;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0 = 1 - t;
  let k1 = t;
  if (c < 0.9995) {
    const o = Math.acos(c);
    const so = Math.sin(o);
    k0 = Math.sin((1 - t) * o) / so;
    k1 = Math.sin(t * o) / so;
  }
  let x = ax * k0 + bx * k1, y = ay * k0 + by * k1, z = az * k0 + bz * k1, w = aw * k0 + bw * k1;
  const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  x /= l;
  y /= l;
  z /= l;
  w /= l;
  const sx = D0[3] + (D1[3] - D0[3]) * t;
  const sy = D0[4] + (D1[4] - D0[4]) * t;
  const sz = D0[5] + (D1[5] - D0[5]) * t;
  // compose (même formule que THREE.Matrix4.compose)
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  MI[0] = (1 - (yy + zz)) * sx;
  MI[1] = (xy + wz) * sx;
  MI[2] = (xz - wy) * sx;
  MI[3] = 0;
  MI[4] = (xy - wz) * sy;
  MI[5] = (1 - (xx + zz)) * sy;
  MI[6] = (yz + wx) * sy;
  MI[7] = 0;
  MI[8] = (xz + wy) * sz;
  MI[9] = (yz - wx) * sz;
  MI[10] = (1 - (xx + yy)) * sz;
  MI[11] = 0;
  MI[12] = D0[0] + (D1[0] - D0[0]) * t;
  MI[13] = D0[1] + (D1[1] - D0[1]) * t;
  MI[14] = D0[2] + (D1[2] - D0[2]) * t;
  MI[15] = 1;
}

// scalaires réécrits à chaque image (§ V : jamais dans un let)
const ACC = 0; // temps accumulé non simulé
const TIME = 1; // temps simulé de la cape
const STEPS = 2; // sous-pas de la dernière image
const TOTAL = 3; // sous-pas depuis le reset
const ALPHA = 4; // instant du sous-pas dans l'image (0..1) : passé par S, jamais en argument (§ V)
const S = new Float64Array(5);
/** Entrée de update() : [0] = dt simulé de l'image (un flottant passé en argument serait emballé, § V). */
export const entree = new Float64Array(1);
const st = { pret: false, visible: true };

// maillage
const NV = NX * (NY - 1) + (NX - 1) + NX; // tissu + milieux du bas + pointes
const MID0 = NX * (NY - 1);
const TIP0 = MID0 + NX - 1;
let mesh = null;
let posAttr = null;
let nrmAttr = null;
let tris = null;
let nTris = 0;

export function getMesh() {
  return mesh;
}

function addC(a, b, k) {
  const dx = rest[b * 3] - rest[a * 3];
  const dy = rest[b * 3 + 1] - rest[a * 3 + 1];
  const dz = rest[b * 3 + 2] - rest[a * 3 + 2];
  cA[nC] = a;
  cB[nC] = b;
  cL[nC] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  cK[nC] = k;
  nC++;
}

/** Matériau peint de la cape (profil « cape » ajouté à PEINT.profils au premier appel). */
export function creerMateriau() {
  if (!PEINT.profils.cape) {
    // tissu : pas de métal, liseré violet très discret, ombres bleuies un peu moins que le décor
    // (copie du profil « objet », dont le format évolue avec src/rendu/, puis les seuls champs propres au tissu)
    PEINT.profils.cape = { ...PEINT.profils.objet, saturation: 1.0, soleil: 1.0, metal: 0.04, liseré: { couleur: 0x7c6cff, force: 0.05, puissance: 2.5 } };
  }
  const m = createPaintedMaterial({ profil: 'cape', side: THREE.DoubleSide, emissiveBoost: 0 });
  const dehors = new THREE.Color(C.couleur);
  const dedans = new THREE.Color(C.couleurDedans);
  const r = (k) => (dedans[k] / Math.max(1e-4, dehors[k])).toFixed(4);
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      if ( ! gl_FrontFacing ) diffuseColor.rgb *= vec3( ${r('r')}, ${r('g')}, ${r('b')} );`,
    );
  };
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = () => key() + '|sr-cape-v1';
  return ajouterRevele(m); // matérialisation du héros (carte-blender) : la cape suit le même front
}

/**
 * ancrageG / ancrageD : [x, y, z] repère du modèle ; dos : { a, b, rayon } ; material : facultatif (creerMateriau()) ;
 * corps : données du .glb (pieces.js : geometry + pieces) — profil du dos ; sans lui, cylindre du dos et plan plat.
 */
export function init({ scene, ancrageG, ancrageD, dos, jambes = C.jambes, material = null, corps = null }) {
  const pr = profilsCorps(corps, ['corps', 'tete']); // la tête aussi : le haut de la cape ne passe pas sous le casque
  // enveloppe à la demi-maille de la cape (écart entre colonnes, entre rangées) : ses triangles ne coupent pas les omoplates
  PROF = pr ? envelopper(pr.dos, C.largeurHaut / (NX - 1) / 2, C.longueur / (NY - 2) / 2, -1) : null;
  // ----- disposition de repos (repère du corps) : rangée 0 sur la ligne des épaules, bombée autour du cou ; avec le
  // profil, chaque particule est posée à C.ecartDos derrière le dos (rangée 0 comprise : les accroches touchent le dos)
  // avec le profil, les accroches descendent de C.accrocheDy (celles du .glb flottaient 4–5 cm au-dessus des épaules)
  const yTop = (ancrageG[1] + ancrageD[1]) / 2 + (PROF !== null ? C.accrocheDy : 0);
  const zTop = (ancrageG[2] + ancrageD[2]) / 2;
  const zDos = Math.min(zTop, dos.a[2] - dos.rayon - 0.05);
  for (let r = 0; r < NY - 1; r++) {
    const t = r / (NY - 2);
    const hw = C.largeurHaut / 2 + (C.largeurBas / 2 - C.largeurHaut / 2) * t;
    for (let c = 0; c < NX; c++) {
      const p = r * NX + c;
      const u = c / (NX - 1); // 0 = gauche du personnage (+X), 1 = droite
      let x, y, z;
      if (r === 0) {
        x = ancrageG[0] + (ancrageD[0] - ancrageG[0]) * u;
        y = yTop + 0.03 * Math.sin(Math.PI * u); // passe au-dessus de la nuque
        z = zTop - 0.05 * Math.sin(Math.PI * u);
      } else {
        x = hw * (1 - 2 * u);
        y = yTop - t * C.longueur;
        z = zDos - 0.07 * t;
      }
      // rangée 0 : jamais avancée (au milieu, elle passe derrière le bas du casque), seulement reculée hors du dos
      if (PROF !== null) z = r === 0 ? Math.min(z, zProfil(PROF, x, y, true) - C.ecartDos) : zProfil(PROF, x, y, true) - C.ecartDos;
      rest[p * 3] = x;
      rest[p * 3 + 1] = y;
      rest[p * 3 + 2] = z;
      invM[p] = r === 0 ? 0 : 1;
      rowOf[p] = r;
    }
  }
  for (let c = 0; c < NX; c++) {
    const a = (NY - 2) * NX + c;
    const p = TIP * NX + c;
    rest[p * 3] = rest[a * 3] + C.decalagePointes[c % C.decalagePointes.length];
    rest[p * 3 + 1] = rest[a * 3 + 1] - C.pointes[c % C.pointes.length];
    rest[p * 3 + 2] = rest[a * 3 + 2] - 0.02;
    invM[p] = 1.6; // les pointes sont plus légères : elles fouettent
    rowOf[p] = TIP;
  }
  // ----- contraintes
  nC = 0;
  const id = (r, c) => r * NX + c;
  for (let r = 0; r < NY - 1; r++)
    for (let c = 0; c < NX; c++) {
      if (c + 1 < NX) addC(id(r, c), id(r, c + 1), C.raideur);
      if (r + 1 < NY - 1) addC(id(r, c), id(r + 1, c), C.raideur);
      if (r + 1 < NY - 1 && c + 1 < NX) {
        addC(id(r, c), id(r + 1, c + 1), C.raideurCisaillement);
        addC(id(r, c + 1), id(r + 1, c), C.raideurCisaillement);
      }
      if (c + 2 < NX) addC(id(r, c), id(r, c + 2), C.raideurFlexion);
      if (r + 2 < NY - 1) addC(id(r, c), id(r + 2, c), C.raideurFlexion);
    }
  for (let c = 0; c < NX; c++) {
    addC(id(NY - 2, c), id(TIP, c), C.raideurPointe);
    addC(id(NY - 3, c), id(TIP, c), C.raideurFlexion * 1.5);
  }
  // ----- capsules
  const setCap = (k, a, b, rr) => {
    capLocal.set(a, k * 7);
    capLocal.set(b, k * 7 + 3);
    capLocal[k * 7 + 6] = rr;
  };
  setCap(0, dos.a, dos.b, dos.rayon);
  setCap(1, jambes.a, jambes.b, jambes.rayon);
  planActif = PROF === null && C.planDos !== null && C.planDos !== undefined;
  PLAN[0] = Math.min(dos.a[2], dos.b[2]) - dos.rayon - C.marge + (C.planDos !== null && C.planDos !== undefined ? C.planDos : 0);

  // ----- maillage : créé une fois, réutilisé si init est rappelé (changement de modèle de l'agent, hors combat)
  if (mesh !== null) {
    if (mesh.parent !== scene) scene.add(mesh);
    mesh.visible = false;
    st.pret = true;
    return;
  }
  const g = new THREE.BufferGeometry();
  posAttr = new THREE.BufferAttribute(new Float32Array(NV * 3), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  nrmAttr = new THREE.BufferAttribute(new Float32Array(NV * 3), 3);
  nrmAttr.setUsage(THREE.DynamicDrawUsage);
  const col = new Float32Array(NV * 3);
  const base = new THREE.Color(C.couleur);
  const rowV = (v) => (v < MID0 ? Math.floor(v / NX) : v < TIP0 ? NY - 2 : TIP);
  for (let v = 0; v < NV; v++) {
    const k = 1 + C.degrade * (rowV(v) / TIP);
    col[v * 3] = base.r * k;
    col[v * 3 + 1] = base.g * k;
    col[v * 3 + 2] = base.b * k;
  }
  const idx = [];
  for (let r = 0; r < NY - 2; r++)
    for (let c = 0; c < NX - 1; c++) {
      const a = r * NX + c;
      const b = a + 1;
      const d = a + NX;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  const R = (NY - 2) * NX; // dernière rangée de tissu
  for (let c = 0; c < NX; c++) {
    const A = R + c;
    const T = TIP0 + c;
    if (c > 0) idx.push(MID0 + c - 1, A, T);
    if (c < NX - 1) idx.push(A, MID0 + c, T);
  }
  tris = new Uint16Array(idx);
  nTris = tris.length / 3;
  g.setIndex(new THREE.BufferAttribute(tris, 1));
  g.setAttribute('position', posAttr);
  g.setAttribute('normal', nrmAttr);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(NV), 1));
  g.setAttribute('aFx', new THREE.BufferAttribute(new Float32Array(NV * 2), 2));
  mesh = new THREE.Mesh(g, material || creerMateriau());
  mesh.name = 'joueur-cape';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mesh.renderOrder = 2.5; // après la silhouette du héros (1,5) : une cape devant le corps cache la silhouette cyan
  mesh.visible = false;
  scene.add(mesh);
  st.pret = true;
}

// x' = M · x (point), M colonne majeure
function xf(M, src, si, dst, di) {
  const x = src[si];
  const y = src[si + 1];
  const z = src[si + 2];
  dst[di] = M[0] * x + M[4] * y + M[8] * z + M[12];
  dst[di + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
  dst[di + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
}

/**
 * Capsule dynamique k (0, 1 : bras g, d ; 2, 3 : jambes g, d) en MONDE pour l'image courante, à donner AVANT update().
 * rayon 0 = désactivée.
 */
export function setCapsuleMonde(k, ax, ay, az, bx, by, bz, rayon) {
  const o = k * 7;
  capDyn1[o] = ax;
  capDyn1[o + 1] = ay;
  capDyn1[o + 2] = az;
  capDyn1[o + 3] = bx;
  capDyn1[o + 4] = by;
  capDyn1[o + 5] = bz;
  capDyn1[o + 6] = rayon;
}

/** Replace la cape au repos dans la pose donnée (matrice monde du corps, 16 flottants colonne majeure). */
export function reset(M) {
  M0.set(M);
  M1.set(M);
  capDyn0.set(capDyn1);
  for (let p = 0; p < N; p++) {
    xf(M, rest, p * 3, pos, p * 3);
    prev[p * 3] = pos[p * 3];
    prev[p * 3 + 1] = pos[p * 3 + 1];
    prev[p * 3 + 2] = pos[p * 3 + 2];
  }
  S[ACC] = 0;
  S[TOTAL] = 0;
  S[TIME] = 0;
  normales();
}

function normales() {
  for (let r = 0; r < NY; r++)
    for (let c = 0; c < NX; c++) {
      const rr = r === TIP ? NY - 2 : r;
      const l = (rr * NX + (c > 0 ? c - 1 : c)) * 3;
      const rt = (rr * NX + (c < NX - 1 ? c + 1 : c)) * 3;
      const u = ((rr > 0 ? rr - 1 : rr) * NX + c) * 3;
      const d = ((rr < NY - 2 ? rr + 1 : rr) * NX + c) * 3;
      const ax = pos[rt] - pos[l];
      const ay = pos[rt + 1] - pos[l + 1];
      const az = pos[rt + 2] - pos[l + 2];
      const bx = pos[d] - pos[u];
      const by = pos[d + 1] - pos[u + 1];
      const bz = pos[d + 2] - pos[u + 2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const n = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const o = (r * NX + c) * 3;
      nrm[o] = nx / n;
      nrm[o + 1] = ny / n;
      nrm[o + 2] = nz / n;
    }
}

// Plan du dos (repère du buste) : z ≤ PLAN[0] (m, modèle). Calculé à l'init (null dans la config : plan coupé).
const PLAN = new Float64Array(1);
let planActif = false;

function collisions() {
  // plan du dos : la composante d'une particule le long de l'axe avant du buste (colonne z de MI, normalisée) est
  // bornée par PLAN × échelle ; au-delà, la particule est ramenée sur le plan (même règle que les capsules : position
  // seule, Verlet garde la vitesse corrigée)
  if (planActif) {
    const zx = MI[8];
    const zy = MI[9];
    const zz = MI[10];
    const sz = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
    const nx = zx / sz;
    const ny = zy / sz;
    const nz = zz / sz;
    const lim = PLAN[0] * sz;
    const ox = MI[12];
    const oy = MI[13];
    const oz = MI[14];
    for (let p = NX; p < N; p++) {
      const i = p * 3;
      const d = (pos[i] - ox) * nx + (pos[i + 1] - oy) * ny + (pos[i + 2] - oz) * nz - lim;
      if (d > 0) {
        pos[i] -= nx * d;
        pos[i + 1] -= ny * d;
        pos[i + 2] -= nz * d;
      }
    }
  }
  if (PROF !== null) {
    // profil du dos (repère du buste, MI = rotation × échelle) : coordonnées locales par les colonnes de MI, z limité
    // au profil − margeDos ; la particule est ramenée le long de l'axe avant du buste
    const c0 = MI[0] * MI[0] + MI[1] * MI[1] + MI[2] * MI[2];
    const c1 = MI[4] * MI[4] + MI[5] * MI[5] + MI[6] * MI[6];
    const c2 = MI[8] * MI[8] + MI[9] * MI[9] + MI[10] * MI[10];
    for (let p = NX; p < N; p++) {
      const i = p * 3;
      const px = pos[i] - MI[12];
      const py = pos[i + 1] - MI[13];
      const pz = pos[i + 2] - MI[14];
      const lx = (px * MI[0] + py * MI[1] + pz * MI[2]) / c0;
      const ly = (px * MI[4] + py * MI[5] + pz * MI[6]) / c1;
      const lz = (px * MI[8] + py * MI[9] + pz * MI[10]) / c2;
      // en course (ADH[0] → 0), la limite rejoint le plan d'avant derrière le dos : le bras qui part en arrière passe
      // entre le dos et la cape au lieu de la traverser ; à l'arrêt, le profil seul
      let lim = zProfil(PROF, lx, ly, true) - C.margeDos;
      if (ADH[0] < 1 && PLAN[0] < lim) lim += (PLAN[0] - lim) * (1 - ADH[0]);
      const d = lz - lim;
      if (d > 0) {
        pos[i] -= MI[8] * d;
        pos[i + 1] -= MI[9] * d;
        pos[i + 2] -= MI[10] * d;
      }
    }
  }
  for (let k = 0; k < NCAP; k++) {
    const o = k * 7;
    if (!(capW[o + 6] > 0) || (k === 0 && PROF !== null)) continue;
    const ax = capW[o];
    const ay = capW[o + 1];
    const az = capW[o + 2];
    const bx = capW[o + 3] - ax;
    const by = capW[o + 4] - ay;
    const bz = capW[o + 5] - az;
    const bb = bx * bx + by * by + bz * bz || 1;
    const rr = capW[o + 6] + C.marge;
    for (let p = NX; p < N; p++) {
      const i = p * 3;
      const px = pos[i] - ax;
      const py = pos[i + 1] - ay;
      const pz = pos[i + 2] - az;
      let t = (px * bx + py * by + pz * bz) / bb;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - bx * t;
      const dy = py - by * t;
      const dz = pz - bz * t;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-6;
        const f = (rr - d) / d;
        pos[i] += dx * f;
        pos[i + 1] += dy * f;
        pos[i + 2] += dz * f;
      }
    }
  }
  for (let p = NX; p < N; p++) {
    const i = p * 3 + 1;
    if (pos[i] < 0.02) {
      pos[i] = 0.02;
      // frottement au sol
      prev[i - 1] += (pos[i - 1] - prev[i - 1]) * 0.5;
      prev[i + 1] += (pos[i + 1] - prev[i + 1]) * 0.5;
    }
  }
}

function sousPas() {
  const alpha = S[ALPHA];
  // pose du corps interpolée : translation et échelle linéaires, rotation sphérique (une demi-volte en une image à
  // 60 Hz reste une rotation, pas une matrice écrasée)
  interpoler();
  for (let k = 0; k < 2; k++) {
    xf(MI, capLocal, k * 7, capW, k * 7);
    xf(MI, capLocal, k * 7 + 3, capW, k * 7 + 3);
    // rayon × échelle moyenne de la matrice (tassement, étirement)
    const sx = Math.sqrt(MI[0] * MI[0] + MI[1] * MI[1] + MI[2] * MI[2]);
    const sz = Math.sqrt(MI[8] * MI[8] + MI[9] * MI[9] + MI[10] * MI[10]);
    capW[k * 7 + 6] = capLocal[k * 7 + 6] * 0.5 * (sx + sz);
  }
  for (let k = 0; k < NDYN * 7; k++) capW[14 + k] = capDyn0[k] + (capDyn1[k] - capDyn0[k]) * alpha;
  const t = S[TIME];
  const w = C.souffleHz * 6.283185307;
  const keep = 1 - C.amortissement;
  const kN = C.traineeNormale;
  const kT = C.traineeTangente;
  // adhérence (avec le profil) : poussée douce vers l'avant du buste (colonne z de MI / échelle) : la cape se pose sur le
  // dos au lieu de pendre à la verticale de ses accroches ; la traînée de l'air l'emporte dès que l'agent court
  const adh = PROF !== null ? (C.adherence * ADH[0]) / (Math.sqrt(MI[8] * MI[8] + MI[9] * MI[9] + MI[10] * MI[10]) || 1) : 0;
  for (let p = 0; p < N; p++) {
    const i = p * 3;
    if (invM[p] === 0) {
      xf(MI, rest, i, pos, i);
      prev[i] = pos[i];
      prev[i + 1] = pos[i + 1];
      prev[i + 2] = pos[i + 2];
      continue;
    }
    const vx = (pos[i] - prev[i]) / H;
    const vy = (pos[i + 1] - prev[i + 1]) / H;
    const vz = (pos[i + 2] - prev[i + 2]) / H;
    // souffle de repos : lent, d'amplitude variable, déphasé le long de la cape
    const r = rowOf[p];
    const c = p - r * NX;
    const wx = C.souffle * (0.55 + 0.45 * Math.sin(w * t + 0.55 * r)) * 0.8;
    const wz = C.souffle * 0.6 * Math.sin(1.63 * w * t + 0.9 * c + 0.3 * r);
    const rx = vx - wx;
    const ry = vy;
    const rz = vz - wz;
    const nx = nrm[i];
    const ny = nrm[i + 1];
    const nz = nrm[i + 2];
    const vn = rx * nx + ry * ny + rz * nz;
    const tip = r === TIP ? 1.4 : 1;
    const ax = (-kN * vn * nx - kT * rx) * tip + adh * MI[8];
    const ay = (-kN * vn * ny - kT * ry) * tip - C.gravite + adh * MI[9];
    const az = (-kN * vn * nz - kT * rz) * tip + adh * MI[10];
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    pos[i] = x + (x - prev[i]) * keep + ax * H2;
    pos[i + 1] = y + (y - prev[i + 1]) * keep + ay * H2;
    pos[i + 2] = z + (z - prev[i + 2]) * keep + az * H2;
    prev[i] = x;
    prev[i + 1] = y;
    prev[i + 2] = z;
  }
  for (let it = 0; it < C.iterations; it++) {
    for (let k = 0; k < nC; k++) {
      const a = cA[k] * 3;
      const b = cB[k] * 3;
      const wa = invM[cA[k]];
      const wb = invM[cB[k]];
      const ws = wa + wb;
      if (ws === 0) continue;
      const dx = pos[b] - pos[a];
      const dy = pos[b + 1] - pos[a + 1];
      const dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const f = ((d - cL[k]) / (d * ws)) * cK[k];
      pos[a] += dx * f * wa;
      pos[a + 1] += dy * f * wa;
      pos[a + 2] += dz * f * wa;
      pos[b] -= dx * f * wb;
      pos[b + 1] -= dy * f * wb;
      pos[b + 2] -= dz * f * wb;
    }
    collisions();
  }
  normales();
  S[TIME] = t + H;
  S[TOTAL] += 1;
}

/**
 * Avance la cape de entree[0] secondes simulées. M = matrice monde du corps À LA FIN de ce dt (16 flottants).
 * Les sous-pas de 1/hz tombent à des instants absolus fixes ; la pose du corps est interpolée entre l'image
 * précédente et M.
 */
export function update(M) {
  if (!st.pret) return;
  const dt = entree[0];
  M0.set(M1);
  M1.set(M);
  capDyn0.set(capDyn1);
  // téléportation (Rejouer, debug) : la cape est replacée au lieu de traverser l'arène
  const jx = M1[12] - M0[12];
  const jz = M1[14] - M0[14];
  if (jx * jx + jz * jz > C.teleport * C.teleport) {
    reset(M);
    return;
  }
  S[STEPS] = 0;
  if (!(dt > 0)) return;
  {
    // adhérence : à l'arrêt et au pas seulement (en course, le bras qui part en arrière doit pouvoir écarter la cape)
    let f = 1 - Math.sqrt(jx * jx + jz * jz) / dt / C.adherenceVmax;
    f = f < 0 ? 0 : f;
    ADH[0] += (f - ADH[0]) * Math.min(1, dt * 8); // tableau typé : un `let` de module allouait un nombre à chaque écriture
  }
  decompose(M0, D0);
  decompose(M1, D1);
  let acc = S[ACC];
  let tk = H - acc; // instant (dans ce dt) du prochain sous-pas
  let n = 0;
  while (tk <= dt + 1e-9 && n < C.maxSubsteps) {
    S[ALPHA] = tk / dt;
    sousPas();
    tk += H;
    n++;
  }
  // reste : temps écoulé depuis le dernier sous-pas (borné si maxSubsteps a coupé)
  acc = dt - (tk - H);
  if (acc < 0) acc = 0;
  if (acc >= H) acc = H * 0.999;
  S[ACC] = acc;
  S[STEPS] = n;
}

/** Écrit positions et normales lissées dans le maillage. */
export function sync() {
  if (!st.pret) return;
  mesh.visible = st.visible;
  if (!st.visible) return;
  const P = posAttr.array;
  const Nn = nrmAttr.array;
  const R = (NY - 2) * NX;
  for (let p = 0; p < MID0; p++) {
    P[p * 3] = pos[p * 3];
    P[p * 3 + 1] = pos[p * 3 + 1];
    P[p * 3 + 2] = pos[p * 3 + 2];
  }
  for (let c = 0; c < NX - 1; c++) {
    const a = (R + c) * 3;
    const o = (MID0 + c) * 3;
    // le creux entre deux pointes remonte un peu au-dessus de la dernière rangée : la découpe se lit
    const ux = pos[a] + pos[a + 3] - pos[a - NX * 3] - pos[a - NX * 3 + 3];
    const uy = pos[a + 1] + pos[a + 4] - pos[a - NX * 3 + 1] - pos[a - NX * 3 + 4];
    const uz = pos[a + 2] + pos[a + 5] - pos[a - NX * 3 + 2] - pos[a - NX * 3 + 5];
    const k = 0.5 - 0.18 * (c & 1 ? 1.3 : 0.8);
    P[o] = (pos[a] + pos[a + 3]) * 0.5 - ux * (0.5 - k);
    P[o + 1] = (pos[a + 1] + pos[a + 4]) * 0.5 - uy * (0.5 - k);
    P[o + 2] = (pos[a + 2] + pos[a + 5]) * 0.5 - uz * (0.5 - k);
  }
  for (let c = 0; c < NX; c++) {
    const s = (TIP * NX + c) * 3;
    const o = (TIP0 + c) * 3;
    P[o] = pos[s];
    P[o + 1] = pos[s + 1];
    P[o + 2] = pos[s + 2];
  }
  // normales lissées des sommets (somme des normales de faces non normalisées)
  Nn.fill(0);
  for (let t = 0; t < nTris; t++) {
    const a = tris[t * 3] * 3;
    const b = tris[t * 3 + 1] * 3;
    const c = tris[t * 3 + 2] * 3;
    const ux = P[b] - P[a];
    const uy = P[b + 1] - P[a + 1];
    const uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a];
    const vy = P[c + 1] - P[a + 1];
    const vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    Nn[a] += nx;
    Nn[a + 1] += ny;
    Nn[a + 2] += nz;
    Nn[b] += nx;
    Nn[b + 1] += ny;
    Nn[b + 2] += nz;
    Nn[c] += nx;
    Nn[c + 1] += ny;
    Nn[c + 2] += nz;
  }
  for (let v = 0; v < NV; v++) {
    const o = v * 3;
    const l = Math.sqrt(Nn[o] * Nn[o] + Nn[o + 1] * Nn[o + 1] + Nn[o + 2] * Nn[o + 2]) || 1;
    Nn[o] /= l;
    Nn[o + 1] /= l;
    Nn[o + 2] /= l;
  }
  posAttr.needsUpdate = true;
  nrmAttr.needsUpdate = true;
}

export function setVisible(v) {
  st.visible = !!v;
  if (mesh) mesh.visible = st.visible && st.pret;
}

/**
 * Agent sans cape (AGENTS[].cape === false, le Bastion) : la cape n'est plus simulée ni dessinée. Rien n'est créé si
 * elle ne l'a jamais été ; sinon son maillage reste en mémoire, caché, pour un prochain init().
 */
export function couper() {
  st.pret = false;
  if (mesh) mesh.visible = false;
}

/** Positions des particules (copie) : contrôle 60 / 240 Hz. */
export function lirePositions(out) {
  out.set(pos);
  return out;
}

export function inspect(out) {
  out.active = st.pret; // false : agent sans cape (couper) ou cape jamais créée
  out.creee = mesh !== null;
  out.particules = N;
  out.contraintes = nC;
  out.triangles = nTris;
  out.sousPas = S[STEPS];
  out.sousPasTotal = S[TOTAL];
  out.temps = S[TIME];
  // bas de la cape : hauteur moyenne des pointes et distance moyenne derrière les épaules (repère monde)
  let y = 0;
  for (let c = 0; c < NX; c++) y += pos[(TIP * NX + c) * 3 + 1];
  out.yPointes = y / NX;
  // pénétration maximale d'une particule dans une capsule de bras (m, 0 = aucune), état courant (hors chemin chaud)
  let pen = 0;
  for (let k = 0; k < 2; k++) {
    const o = k * 7;
    const r = capDyn1[o + 6];
    if (!(r > 0)) continue;
    const bx = capDyn1[o + 3] - capDyn1[o];
    const by = capDyn1[o + 4] - capDyn1[o + 1];
    const bz = capDyn1[o + 5] - capDyn1[o + 2];
    const bb = bx * bx + by * by + bz * bz || 1;
    for (let p = NX; p < N; p++) {
      const px = pos[p * 3] - capDyn1[o];
      const py = pos[p * 3 + 1] - capDyn1[o + 1];
      const pz = pos[p * 3 + 2] - capDyn1[o + 2];
      let t = (px * bx + py * by + pz * bz) / bb;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(px - bx * t, py - by * t, pz - bz * t);
      if (r - d > pen) pen = r - d;
    }
  }
  out.penetrationBras = pen;
}
