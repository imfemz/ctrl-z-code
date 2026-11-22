// RENDU « PEINT » — ombre de contact sous CHAQUE unité (prototype du 13/11/2026, brief § 1 et § 3).
//
// Un seul InstancedMesh : un carré posé au sol, dont le fragment dessine une tache ronde et douce (aucune texture),
// MULTIPLIÉE au sol (mélange dst × src) : la tache assombrit et bleuit ce qui est dessous sans jamais le noircir.
// Les robots (tous types, boss compris), le héros, les obstacles (statiques, écrits une fois) et quelques objets suivis
// (le marchand) ont chacun la leur. Un appel de dessin pour tout, aucune carte d'ombre.
//
// Contrat d'intégration : init(scene, { statiques, suivis }) à l'init ; sync() une fois par image (dans les sync,
// après enemies.sync et boss.sync) : lit E et P directement (pas d'appel par entité, § V). Écriture des matrices en
// ligne (gabarit du § G.3), zéro allocation par image.
import * as THREE from 'three';
import { CAPS, ENEMIES, PLAYER } from '../config.js';
import { E, P } from '../state.js';
import { PEINT } from './reglages.js';

const C = PEINT.contact;
let mesh = null;
let mat = null; // instanceMatrix.array
let force = null; // aSrForce.array
let nStatic = 0;
let cap = 0;
const suivis = []; // Object3D dont on suit la position (marchand…) ; rempli à l'init
const suivisRayon = [];
// Par type de robot : échelle de la tache et force (calculées à l'init)
const typeForce = new Float32Array(ENEMIES.types.length);
// § E5.T : taches des tourelles POSÉES (Sentinelle, canon lourd), écrites par weapons.js / weapons-agents.js dans leur
// sync (avant world.sync) : (x, z, rayon, force) par place, force 0 = pas de tache. Aucun appel par entité.
export const TACHES_MAX = CAPS.turrets + CAPS.cannons;
export const TACHES = new Float32Array(TACHES_MAX * 4);

const VERT = /* glsl */ `
attribute float aSrForce;
varying vec2 vUv; varying float vForce;
void main() {
  vUv = uv; vForce = aSrForce;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
}`;
const FRAG = /* glsl */ `
uniform vec3 uTeinte; varying vec2 vUv; varying float vForce;
void main() {
  float d = length( vUv * 2.0 - 1.0 );
  float a = clamp( 1.0 - d * d, 0.0, 1.0 );
  a *= a; // cloche : cœur plein sous l'unité, pied qui s'éteint en douceur au bord du carré
  gl_FragColor = vec4( mix( vec3( 1.0 ), uTeinte, a * vForce ), 1.0 );
}`;

/**
 * statiques : Float32Array (x, z, rayon) × n — obstacles ; suivis : [{ objet, rayon }].
 * Le maillage est ajouté à la scène, visible.
 */
export function init(scene, { statiques = null, nStatiques = 0, suivre = [] } = {}) {
  nStatic = nStatiques;
  cap = nStatic + CAPS.enemies + 1 + suivre.length + TACHES_MAX;
  const g = new THREE.PlaneGeometry(2, 2);
  g.rotateX(-Math.PI / 2);
  const aForce = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
  aForce.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aSrForce', aForce);
  const material = new THREE.ShaderMaterial({
    uniforms: { uTeinte: { value: new THREE.Color(C.teinte) } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
  });
  mesh = new THREE.InstancedMesh(g, material, cap);
  mesh.name = 'ombres-contact';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = C.order;
  mesh.count = 0;
  mat = mesh.instanceMatrix.array;
  force = aForce.array;
  for (let t = 0; t < ENEMIES.types.length; t++) typeForce[t] = ENEMIES.types[t].hover > 0 ? C.force * C.volant : C.force;
  // Obstacles : écrits une fois (plus larges et plus doux : le pied du rocher est déjà sombre)
  for (let k = 0; k < nStatic; k++) {
    const r = statiques[k * 3 + 2] * 1.25;
    ecrire(k, statiques[k * 3], statiques[k * 3 + 1], r, C.force * 0.7);
  }
  for (const s of suivre) {
    suivis.push(s.objet);
    suivisRayon.push(s.rayon);
  }
  scene.add(mesh);
  return mesh;
}

/** Init seulement (arguments flottants : jamais dans la boucle d'image). */
function ecrire(k, x, z, r, f) {
  const o = k * 16;
  mat[o] = r; mat[o + 1] = 0; mat[o + 2] = 0; mat[o + 3] = 0;
  mat[o + 4] = 0; mat[o + 5] = 1; mat[o + 6] = 0; mat[o + 7] = 0;
  mat[o + 8] = 0; mat[o + 9] = 0; mat[o + 10] = r; mat[o + 11] = 0;
  mat[o + 12] = x; mat[o + 13] = C.y; mat[o + 14] = z; mat[o + 15] = 1;
  force[k] = f;
}

/** Une fois par image : robots vivants, héros, objets suivis. */
export function sync() {
  const X = E.x;
  const Z = E.z;
  const R = E.radius;
  const T = E.type;
  const A = E.alive;
  const n = E.count;
  const ech = C.echelle;
  const y = C.y;
  let k = nStatic;
  const SU = E.sus;
  for (let i = 0; i < n; i++) {
    if (A[i] === 0 || SU[i] === 2) continue; // § E4.F : garé
    const r = R[i] * ech;
    const o = k * 16;
    mat[o] = r;
    mat[o + 10] = r;
    mat[o + 12] = X[i];
    mat[o + 13] = y;
    mat[o + 14] = Z[i];
    mat[o + 1] = 0; mat[o + 2] = 0; mat[o + 3] = 0; mat[o + 4] = 0; mat[o + 5] = 1; mat[o + 6] = 0; mat[o + 7] = 0;
    mat[o + 8] = 0; mat[o + 9] = 0; mat[o + 11] = 0; mat[o + 15] = 1;
    force[k] = typeForce[T[i]];
    k++;
  }
  if (P.alive) {
    const r = PLAYER.radius * ech * 1.1;
    const o = k * 16;
    mat[o] = r; mat[o + 1] = 0; mat[o + 2] = 0; mat[o + 3] = 0; mat[o + 4] = 0; mat[o + 5] = 1; mat[o + 6] = 0; mat[o + 7] = 0;
    mat[o + 8] = 0; mat[o + 9] = 0; mat[o + 10] = r; mat[o + 11] = 0; mat[o + 12] = P.x; mat[o + 13] = y; mat[o + 14] = P.z; mat[o + 15] = 1;
    force[k] = C.force;
    k++;
  }
  for (let s = 0; s < suivis.length; s++) {
    const obj = suivis[s];
    if (!obj.visible) continue;
    // position (enfant direct de la scène) plutôt que matrixWorld : celle-ci n'est recalculée qu'au rendu, la tache
    // aurait une image de retard (intégration : sync est appelé avant le rendu, plus dans scene.onBeforeRender)
    const e = obj.position;
    const h = e.y; // altitude : la tache pâlit et s'élargit quand l'objet monte (marchand en approche)
    const r = suivisRayon[s] * (1 + h * 0.06);
    const f = h > 12 ? 0 : C.force * (1 - h / 12);
    const o = k * 16;
    mat[o] = r; mat[o + 1] = 0; mat[o + 2] = 0; mat[o + 3] = 0; mat[o + 4] = 0; mat[o + 5] = 1; mat[o + 6] = 0; mat[o + 7] = 0;
    mat[o + 8] = 0; mat[o + 9] = 0; mat[o + 10] = r; mat[o + 11] = 0; mat[o + 12] = e.x; mat[o + 13] = y; mat[o + 14] = e.z; mat[o + 15] = 1;
    force[k] = f;
    k++;
  }
  for (let s = 0; s < TACHES_MAX; s++) {
    const q = s * 4;
    const f = TACHES[q + 3];
    if (!(f > 0)) continue;
    const r = TACHES[q + 2];
    const o = k * 16;
    mat[o] = r; mat[o + 1] = 0; mat[o + 2] = 0; mat[o + 3] = 0; mat[o + 4] = 0; mat[o + 5] = 1; mat[o + 6] = 0; mat[o + 7] = 0;
    mat[o + 8] = 0; mat[o + 9] = 0; mat[o + 10] = r; mat[o + 11] = 0; mat[o + 12] = TACHES[q]; mat[o + 13] = y; mat[o + 14] = TACHES[q + 1]; mat[o + 15] = 1;
    force[k] = f;
    k++;
  }
  mesh.count = k;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.geometry.attributes.aSrForce.needsUpdate = true;
}

export function inspect(out) {
  out.ombresContact = mesh ? mesh.count : 0;
}
