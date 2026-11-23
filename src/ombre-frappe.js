// Étape 5, chantier AM : ombre-frappe.js — l'OMBRE de l'agent qui frappe la Frappe éclair (ARCHITECTURE.md § E5.AM ;
// Femz, 22/11 : « le héros ne bouge pas : c'est une ombre, un clone sombre de l'agent, qui fonce le long de la ligne et
// tranche »).
//
// Faite de quoi : des THREE.SkinnedMesh qui PARTAGENT la géométrie et le squelette du héros posé (comme la silhouette de
// foule, silhouette-heros.js) — aucune géométrie, texture ni squelette de plus ; les matrices des os sont celles que le
// héros calcule déjà. Liaison DetachedBindMode : le shader rend bindMatrixInverse × Σ(os) × bindMatrix, soit
// inverse(bindMatrix du héros) × X, X = la position monde du sommet du héros ; la matrice de l'ombre vaut
// M × bindMatrix du héros, donc l'ombre dessine M × X : la POSE VIVANTE de l'agent, déplacée et tournée par
// M = translation au point de l'ombre × lacet de la ligne × penché × lacet inverse du héros × translation depuis le héros.
// Une tête et FRAPPE_OMBRE.trainee images rémanentes (une copie du corps chacune), la cape (Éclaireur) ou les tissus
// (Shinobi) sur la tête (maillages en coordonnées du monde : même M).
//
// Look (un ShaderMaterial, morceaux de skinning de three) : corps presque noir teinté de l'accent, liseré de Fresnel à
// l'accent (halo du bloom), opacité en tramage de Bayer 4 × 4 par gros pixels (passe opaque, aucun tri).
//
// Allocation (§ V ; piège du § E5.AE.9) : tout en tableaux typés ; sync() calcule ENTIÈRES les matrices et opacités
// à chaque image dès le premier héros posé, sans branche selon l'état (une branche jamais parcourue désoptimiserait la
// fonction à la 1re frappe, et le code de base emballerait chaque flottant pendant la frappe).
//
// Intégration : player.init → init(ctx) ; player.poserAgent → lier() (avant le préchauffage : programmes compilés
// d'avance) ; weapons-agents : OMBRE + lancer() au départ de la frappe, avancer(dt) au pas de simulation, sync() en F11
// (après player.sync : héros posé de l'image), reset().
//#region e5:AM-frappe-ombre
import * as THREE from 'three';
import { AGENTS, FRAPPE_OMBRE as FO } from './config.js';
import { P, run } from './state.js';
import { getMesh, getTissusMesh } from './anim/heros-anim.js';
import * as cape from './anim/cape.js';

const NC = 1 + FO.trainee; // copies du corps : la tête (0), puis les images rémanentes
// tissus du JEU porté par le héros (skin ombre : tissus.js?ombre ; sinon tissus.js) — heros-anim.getTissusMesh
const TISSUS = [cape.getMesh, getTissusMesh];
/** Entrée de lancer(), écrite par weapons-agents : [0] x0, [1] z0 (départ = le héros), [2] x1, [3] z1 (bout). */
export const OMBRE = new Float64Array(4);
// [0] âge (s), [1] départ x, [2] z, [3] bout x, [4] z, [5] cos du lacet de la ligne, [6] sin
const S = new Float64Array(8);
const LANCEES = new Int32Array(1); // frappes lancées (compteur des tests)
const FIN = FO.course + FO.tenue + FO.fondu + FO.trainee * FO.ecart + 1; // âge au-delà duquel tout est éteint
S[0] = FIN;
// réglages en tableau typé (lus dans sync : aucun accès d'objet de config dans la boucle)
const K = new Float64Array(8);
K[0] = FO.course;
K[1] = FO.tenue;
K[2] = FO.fondu;
K[3] = FO.ecart;
K[4] = FO.penche;
K[5] = FIN;
const OPA = new Float64Array(NC); // opacité de base de chaque copie
OPA[0] = 1;
for (let k = 1; k < NC; k++) OPA[k] = FO.opaciteTrainee[k - 1] !== undefined ? FO.opaciteTrainee[k - 1] : 0.3;
// relevés (tests) : par copie [x, z, opacité] ; puis [3 NC] visible (1/0)
const MES = new Float64Array(NC * 3 + 1);

let scene = null;
let lie = null; // maillage du héros auquel l'ombre est liée
let agentLie = -1;
const corps = []; // SkinnedMesh par copie
const mats = []; // ShaderMaterial par copie (opacité propre, même programme)
const tissuLie = [null, null];
const tissuOmbre = [null, null];
let matTissu = null; // partage les uniformes de la tête
const TMP = new THREE.Matrix4();
const uCorps = { value: new THREE.Color(0, 0, 0) };
const uLis = { value: new THREE.Color(0, 0, 0) };

const VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vN;
varying float vY;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vN = normalize( normalMatrix * objectNormal );
  vec4 wp = modelMatrix * vec4( transformed, 1.0 );
  vY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG = /* glsl */ `
uniform vec3 uCorps;
uniform vec3 uLis;
uniform float uAlpha[ 1 ]; // tableau : sa valeur est un Float32Array, écrit sans rien allouer
uniform float uPx;
uniform float uHaut;
uniform float uExp;
varying vec3 vN;
varying float vY;
const float BAYER[16] = float[16]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
void main() {
  vec2 c = mod( floor( gl_FragCoord.xy / uPx ), 4.0 );
  float seuil = ( BAYER[ int( c.x ) + int( c.y ) * 4 ] + 0.5 ) / 16.0;
  if ( uAlpha[ 0 ] < seuil ) discard; // dissolution en gros pixels : 1 = plein, 0 = rien
  float f = clamp( 1.0 - abs( normalize( vN ).z ), 0.0, 1.0 );
  vec3 col = uCorps * ( 1.0 + uHaut * clamp( vY / 1.8, 0.0, 1.0 ) ) + uLis * pow( f, uExp );
  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}`;

function materiau(uAlpha) {
  return new THREE.ShaderMaterial({
    uniforms: { uCorps, uLis, uAlpha, uPx: { value: FO.pixel }, uHaut: { value: FO.haut }, uExp: { value: FO.liseré } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    toneMapped: false,
  });
}

/** Une fois (player.init) : matériaux (un par copie, même programme). Les maillages naissent au premier héros posé. */
export function init(ctx) {
  scene = ctx.scene;
  for (let k = 0; k < NC; k++) mats.push(materiau({ value: new Float32Array(1) }));
  matTissu = materiau(mats[0].uniforms.uAlpha); // la cape ou les tissus suivent l'opacité de la tête
}

function nouveau(m, mat, nom) {
  m.name = nom;
  m.frustumCulled = false;
  m.matrixAutoUpdate = false; // sync() écrit la matrice
  m.visible = false;
  m.castShadow = false;
  m.receiveShadow = false;
  m.renderOrder = FO.ordre;
  scene.add(m);
  return m;
}

/**
 * Lie l'ombre au héros posé (player.poserAgent, hors combat : changement d'agent compris) ; rappelée par sync() si le
 * maillage du héros a changé sans elle. Couleur : l'accent de l'agent posé (uniformes : rien n'est recompilé).
 */
export function lier(a = run.agent) {
  const m = getMesh();
  if (scene === null || m === null) return;
  for (let k = 0; k < NC; k++) {
    if (corps[k] === undefined) {
      const sm = new THREE.SkinnedMesh(m.geometry, mats[k]);
      sm.bindMode = THREE.DetachedBindMode;
      corps.push(nouveau(sm, mats[k], k === 0 ? 'ombre-frappe' : 'ombre-frappe-trainee-' + k));
    } else corps[k].geometry = m.geometry;
    corps[k].bind(m.skeleton, m.bindMatrix);
  }
  for (let k = 0; k < 2; k++) {
    const t = TISSUS[k]();
    if (t === null) continue;
    tissuLie[k] = t;
    if (tissuOmbre[k] === null) tissuOmbre[k] = nouveau(new THREE.Mesh(t.geometry, matTissu), matTissu, k === 0 ? 'ombre-frappe-cape' : 'ombre-frappe-tissus');
    else tissuOmbre[k].geometry = t.geometry;
  }
  const ag = AGENTS[a] || AGENTS[0];
  uCorps.value.setHex(ag.accent).multiplyScalar(FO.sombre);
  uCorps.value.r += FO.noir;
  uCorps.value.g += FO.noir;
  uCorps.value.b += FO.noir;
  uLis.value.setHex(ag.accent).multiplyScalar(FO.gain);
  lie = m;
  agentLie = a;
}

/** Départ d'une frappe (weapons-agents.fireFlash, OMBRE écrit) : l'ombre part du départ vers le bout. */
export function lancer() {
  // appelée une fois par frappe : jamais « chaude », donc aucun calcul flottant ici (le code de base emballerait chaque
  // résultat) — copie par TypedArray.set, la direction est calculée par sync(), à chaque image
  S.set(OMBRE, 1);
  S[0] = 0;
  LANCEES[0]++;
}

/** Pas de simulation (temps simulé : figée par la pause et l'arrêt sur image). */
export function avancer(dt) {
  S[0] = Math.min(S[0] + dt, K[5]);
}

export function reset() {
  S[0] = K[5];
  for (let k = 0; k < NC; k++) if (corps[k] !== undefined) corps[k].visible = false;
  for (let k = 0; k < 2; k++) if (tissuOmbre[k] !== null) tissuOmbre[k].visible = false;
  MES.fill(0);
}

const MA = new Float64Array(3); // entrée de matriceM : point x, z de la copie, penché (rad) — aucun flottant en argument
/**
 * M (dans TMP) pour la copie au point (MA[0], MA[1]) penchée de MA[2] rad : lacet de la ligne (S[5] cos, S[6] sin) × penché ×
 * lacet inverse du héros × translation depuis le héros (m). Écrit les éléments (colonnes) ; aucun objet alloué.
 */
function matriceM(m) {
  const ct = S[5];
  const st = S[6];
  const px = MA[0];
  const pz = MA[1];
  const cl = Math.cos(MA[2]);
  const sl = Math.sin(MA[2]);
  const psi = m.rotation.y;
  const cp = Math.cos(psi);
  const sp = Math.sin(psi);
  // A = Ry(θ) · Rx(pen)
  const a00 = ct;
  const a01 = st * sl;
  const a02 = st * cl;
  const a11 = cl;
  const a12 = -sl;
  const a20 = -st;
  const a21 = ct * sl;
  const a22 = ct * cl;
  // R = A · Ry(−ψ)
  const r00 = a00 * cp + a02 * sp;
  const r02 = -a00 * sp + a02 * cp;
  const r10 = a12 * sp;
  const r12 = a12 * cp;
  const r20 = a20 * cp + a22 * sp;
  const r22 = -a20 * sp + a22 * cp;
  const hx = m.position.x;
  const hz = m.position.z;
  const e = TMP.elements;
  e[0] = r00;
  e[1] = r10;
  e[2] = r20;
  e[3] = 0;
  e[4] = a01;
  e[5] = a11;
  e[6] = a21;
  e[7] = 0;
  e[8] = r02;
  e[9] = r12;
  e[10] = r22;
  e[11] = 0;
  e[12] = px - (r00 * hx + r02 * hz);
  e[13] = -(r10 * hx + r12 * hz);
  e[14] = pz - (r20 * hx + r22 * hz);
  e[15] = 1;
}

/** F11, après player.sync : position, penché et opacité de chaque copie ; matrices toujours calculées (voir en-tête). */
export function sync() {
  const m = getMesh();
  if (m === null || scene === null) return;
  // héros changé sans passer par player.poserAgent (garde) : relié, à la couleur de l'agent déjà connu
  if (m !== lie || corps.length === 0) lier(agentLie >= 0 ? agentLie : run.agent);
  if (corps.length === 0) return;
  const montre = P.alive && m.visible;
  const age = S[0];
  const course = K[0];
  const tenue = K[1];
  const fondu = K[2];
  const dx = S[3] - S[1];
  const dz = S[4] - S[2];
  // lacet au sens du héros (P.rot = atan2(x, z)) : l'avant local +Z du modèle va vers (dx, dz) ; sans longueur : +Z
  const l = Math.sqrt(dx * dx + dz * dz);
  const lv = l > 1e-6 ? 1 : 0;
  const il = 1 / Math.max(l, 1e-6);
  S[5] = lv * dz * il + (1 - lv);
  S[6] = lv * dx * il;
  for (let k = 0; k < NC; k++) {
    const t = age - k * K[3];
    // bornes par Math.min / Math.max (sans branche : voir l'en-tête)
    const u = Math.min(1, Math.max(0, t / course));
    const v = 1 - u;
    const p = 1 - v * v * v; // sortie de courbe cubique : part vite, freine au bout
    const r = Math.min(1, Math.max(0, (t - course) / tenue)); // redressement pendant la tenue
    const f = Math.min(1, Math.max(0, (t - course - tenue) / fondu)); // dissolution de la tête
    // une image rémanente s'efface en arrivant (dernier tiers de son trajet)
    const g = Math.min(1, Math.max(0, (u - 0.66) / 0.34));
    // apparition sur le premier 1/8 du trajet : 0 avant son départ (u = 0), et aucune copie pleine posée SUR le héros
    // (même géométrie au même endroit : elle scintillerait contre lui)
    const ne = Math.min(1, u * 8);
    const tete = k === 0 ? 1 : 0;
    const fin = tete * (1 - f) + (1 - tete) * (1 - g * g * (3 - 2 * g));
    const alpha = OPA[k] * fin * ne;
    MA[0] = S[1] + dx * p;
    MA[1] = S[2] + dz * p;
    MA[2] = K[4] * (1 - r);
    matriceM(m);
    const c = corps[k];
    c.matrix.multiplyMatrices(TMP, m.bindMatrix);
    mats[k].uniforms.uAlpha.value[0] = alpha; // Float32Array : une propriété flottante d'objet emballerait à chaque écriture
    const vu = alpha > 0.001 && montre;
    c.visible = vu;
    MES[k * 3] = MA[0];
    MES[k * 3 + 1] = MA[1];
    MES[k * 3 + 2] = alpha;
    if (k === 0) {
      // cape ou tissus : même transformation que la tête (maillages en coordonnées du monde)
      MES[NC * 3] = vu ? 1 : 0;
      for (let q = 0; q < 2; q++) {
        const tq = TISSUS[q]();
        const o = tissuOmbre[q];
        if (o === null || tq === null || tq !== tissuLie[q]) {
          if (o !== null) o.visible = false;
          continue;
        }
        o.matrix.multiplyMatrices(TMP, tq.matrixWorld);
        o.visible = vu && tq.visible;
      }
    }
  }
}

/** Tests (hors chemin chaud) : état de l'ombre. */
export function inspect(out = {}) {
  out.age = S[0];
  out.lancees = LANCEES[0];
  out.visible = MES[NC * 3] === 1;
  out.copies = [];
  for (let k = 0; k < NC; k++) {
    const vu = corps[k] !== undefined && corps[k].visible;
    out.copies.push({ x: MES[k * 3], z: MES[k * 3 + 1], alpha: vu ? MES[k * 3 + 2] : 0, visible: vu });
  }
  out.depart = { x: S[1], z: S[2] };
  out.bout = { x: S[3], z: S[4] };
  out.couleur = [uLis.value.r, uLis.value.g, uLis.value.b];
  out.maillages = corps.length + (tissuOmbre[0] !== null ? 1 : 0) + (tissuOmbre[1] !== null ? 1 : 0);
  out.dessines = corps.filter((c) => c.visible).length + tissuOmbre.filter((o) => o !== null && o.visible).length;
  return out;
}
/** Tests : maillages de l'ombre (rendu, captures). */
export function maillages() {
  const o = corps.slice();
  for (let k = 0; k < 2; k++) if (tissuOmbre[k] !== null) o.push(tissuOmbre[k]);
  return o;
}
//#endregion e5:AM-frappe-ombre
