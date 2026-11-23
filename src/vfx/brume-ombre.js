// SKIN « AGENT DE L'OMBRE » (tâche 4, 23/11/2026) — effets de la cape : (1) FUMÉE noire fine aux 9 pointes les plus
// basses de la cape (2e instance de flammes.js : `flammes.js?ombre`, émetteurs réécrits chaque pas depuis
// tissus.pointes) ; (2) SILLAGE DE BRUME au sol : pool fixe de disques doux sous le héros qui court.
// Réglages : config.js, SKIN_FX.ombre. Rien à l'arrêt (vitesse < vitesseMin) ; Graphismes « Basse » : brume coupée, fumée
// à moitié ; jamais quand le héros ne porte pas le skin (entrée « actif » = 0 : les disques déjà posés s'effacent).
// Lisibilité : opacités plafonnées (brume ≤ 0,24, fumée ≤ 0,22), brume dessinée AVANT les télégraphes du boss (ordre 0,9
// < RENDER.decals.telegraph.order = 1) ; ni l'une ni l'autre n'écrit la profondeur.
// Règle § V (src/fx.js) : zéro allocation par image, tableaux typés créés à l'init, aucun flottant en argument : main.js
// écrit ENTREE puis appelle update() / sync() ; rien n'est créé quand le pool est plein (le plus ancien disque est recyclé).
import * as THREE from 'three';
import { SKIN_FX } from '../config.js';
import { pointesCape } from '../anim/heros-anim.js';
import * as fumee from '../anim/flammes.js?ombre';

const FX = SKIN_FX.ombre;
const B = FX.brume;
const FU = FX.fumee;
const CAP = B.cap;

/** Entrée (écrite par main.js avant update) : [0] dt simulé (s), [1] skin porté (0/1), [2] x, [3] z du héros, [4] vitesse (m/s), [5] dash en cours (0/1), [6] Graphismes « Basse » (0/1), [7] vx, [8] vz (m/s). */
export const ENTREE = new Float64Array(9);
// état : [0] prochain emplacement du pool, [1] temps accumulé avant le prochain disque
const S = new Float64Array(2);
const dx = new Float32Array(CAP);
const dz = new Float32Array(CAP);
const age = new Float32Array(CAP);
const vie = new Float32Array(CAP).fill(-1); // < 0 : libre
// réglages lus une fois (nombres typés)
const R = new Float64Array([B.periode, B.vitesseMin, B.rayon0, B.rayon1, B.vie, B.opaciteMax, B.y, FU.debitCourse, FU.multDash, FU.vitesseMin, FU.basse, FU.rayonEmission, FU.poussee]);
const R_PER = 0;
const R_VMIN = 1;
const R_R0 = 2;
const R_R1 = 3;
const R_VIE = 4;
const R_OMAX = 5;
const R_Y = 6;
const R_DEB = 7;
const R_DASH = 8;
const R_FVMIN = 9;
const R_FBAS = 10;
const R_FRAY = 11;
const R_FPOU = 12;
const PTS = new Float32Array(9 * 3);
const NE = fumee.NE;
let mesh = null;
let attrO = null;

const VERT = `attribute float aO; varying float vO; varying vec2 vUv;
  void main() {
    vO = aO; vUv = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
  }`;
const FRAG = `uniform vec3 uCouleur; varying float vO; varying vec2 vUv;
  void main() {
    float r = length( vUv ) * 2.0;
    float m = smoothstep( 1.0, 0.3, r );
    gl_FragColor = vec4( uCouleur, m * vO );
  }`;

/** Crée le pool (un InstancedMesh, un appel de dessin) et la fumée ; init seulement. */
export function init(scene) {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2); // à plat sur le sol
  attrO = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
  attrO.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aO', attrO);
  mesh = new THREE.InstancedMesh(
    g,
    new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uCouleur: { value: new THREE.Color(B.couleur) } }, transparent: true, depthWrite: false }),
    CAP,
  );
  mesh.name = 'brume-ombre';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = B.ordre;
  mesh.count = 0;
  mesh.visible = false;
  scene.add(mesh);
  fumee.init(scene);
  reset();
}

/** Vide tout (nouvelle partie, retour au titre). */
export function reset() {
  vie.fill(-1);
  S[0] = 0;
  S[1] = 0;
  fumee.reset();
  if (mesh) {
    mesh.count = 0;
    mesh.visible = false;
  }
}

/** Opacité d'un disque d'âge a sur sa vie v : montée courte, puis fondu. */
function opacite(a, v) {
  const u = a / v;
  return R[R_OMAX] * (u < 0.15 ? u / 0.15 : 1) * (1 - u);
}

/** Un pas de simulation (après la simulation : la cape est posée). Lit ENTREE. */
export function update() {
  if (!mesh) return;
  const dt = ENTREE[0];
  if (!(dt > 0)) return;
  const actif = ENTREE[1] > 0.5;
  const v = ENTREE[4];
  const basse = ENTREE[6] > 0.5;
  // ----- brume : vieillissement, puis un disque toutes les `periode` s en course
  for (let i = 0; i < CAP; i++) {
    if (vie[i] < 0) continue;
    age[i] += dt;
    if (age[i] >= vie[i]) vie[i] = -1;
  }
  if (actif && !basse && v > R[R_VMIN]) {
    S[1] += dt;
    let n = 0;
    while (S[1] >= R[R_PER] && n < 4) {
      S[1] -= R[R_PER];
      const i = S[0];
      S[0] = (i + 1) % CAP; // pool plein : le plus ancien est recyclé, rien n'est créé
      dx[i] = ENTREE[2];
      dz[i] = ENTREE[3];
      age[i] = 0;
      vie[i] = R[R_VIE];
      n++;
    }
    if (S[1] >= R[R_PER]) S[1] = 0;
  } else S[1] = 0;
  // ----- fumée : émetteurs aux pointes de la cape (rien à l'arrêt ni sans le skin), débit × 2 au dash, ÷ 2 en Basse
  const np = actif ? pointesCape(PTS) : 0;
  const EM = fumee.EM;
  const debit = actif && v > R[R_FVMIN] ? R[R_DEB] * (ENTREE[5] > 0.5 ? R[R_DASH] : 1) * (basse ? R[R_FBAS] : 1) : 0;
  for (let k = 0; k < NE; k++) {
    const o = k * 10;
    if (k < np && debit > 0) {
      EM[o] = PTS[k * 3];
      EM[o + 1] = PTS[k * 3 + 1];
      EM[o + 2] = PTS[k * 3 + 2];
      EM[o + 3] = ENTREE[7];
      EM[o + 4] = 0;
      EM[o + 5] = ENTREE[8];
      EM[o + 6] = debit;
      EM[o + 7] = 1; // fumée
      EM[o + 8] = R[R_FRAY];
      EM[o + 9] = R[R_FPOU];
    } else EM[o + 6] = 0;
  }
  fumee.entree[0] = dt;
  fumee.update();
}

/** Avant le rendu : matrices et opacités des disques, fumée. */
export function sync() {
  if (!mesh) return;
  const m = mesh.instanceMatrix.array;
  const a = attrO.array;
  let n = 0;
  for (let i = 0; i < CAP; i++) {
    if (vie[i] < 0) continue;
    const u = age[i] / vie[i];
    const r = R[R_R0] + (R[R_R1] - R[R_R0]) * u;
    const d2 = 2 * r; // le quad est unitaire : diamètre = 2 × rayon
    const o = n * 16;
    m[o] = d2;
    m[o + 1] = 0;
    m[o + 2] = 0;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = 1;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = 0;
    m[o + 9] = 0;
    m[o + 10] = d2;
    m[o + 11] = 0;
    m[o + 12] = dx[i];
    m[o + 13] = R[R_Y];
    m[o + 14] = dz[i];
    m[o + 15] = 1;
    a[n] = opacite(age[i], vie[i]);
    n++;
  }
  mesh.count = n;
  mesh.visible = n > 0;
  if (n) {
    mesh.instanceMatrix.needsUpdate = true;
    attrO.needsUpdate = true;
  }
  fumee.sync();
}

/** Tests : { actives, opaciteMax, ordre } de la brume. */
export function inspect(out) {
  let n = 0;
  let om = 0;
  for (let i = 0; i < CAP; i++) {
    if (vie[i] < 0) continue;
    n++;
    const o = opacite(age[i], vie[i]);
    if (o > om) om = o;
  }
  out.actives = n;
  out.opaciteMax = om;
  out.ordre = mesh ? mesh.renderOrder : -1;
  return out;
}
