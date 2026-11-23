// ANIMATIONS v3 — flammes SIMULÉES (demande de Femz du 13/11 : « une vraie simulation de flammes » à la place des
// cônes figés des cheminées du boss). Système de particules générique, prototype.
//
// SIMULATION (pas fixe ANIM.flammes.hz, sous-pas accumulés : même rendu à 60 et 240 Hz ; hasard = hachage du numéro de
// la particule, jamais Math.random) :
//   émission aux émetteurs (position, vitesse héritée, débit, genre feu / fumée), au plus CAP particules (anneau) ;
//   flottaison (le chaud monte, la fumée ralentit), turbulence en champ de rotationnel (« curl » de deux potentiels
//   sinusoïdaux décalés : sans divergence, les volutes tournent sans s'écraser), traînée vers l'air immobile : quand le
//   boss avance ou charge, les flammes émises avec une partie de sa vitesse restent derrière lui et se couchent ;
//   refroidissement le long de la vie : blanc-jaune → orange → rouge → fumée sombre ; taille qui grandit puis s'efface.
// RENDU : deux InstancedMesh de quads tournés vers la caméra (formes douces calculées dans le shader, aucune texture) :
//   le FEU en mélange additif (cœur × 3 à 4 : au-dessus du seuil du bloom), la FUMÉE en mélange normal. Une particule
//   passe de l'un à l'autre en refroidissant (bande de recouvrement : pas de saut).
// Zéro allocation par image ; ≤ CAP particules ; deux appels de dessin.
//
// INTÉGRATION : flammes.init(scene) ; à chaque pas de simulation flammes.update(dt) après avoir écrit les émetteurs
// (setEmetteur, tableaux typés) ; flammes.sync() avant le rendu. Clés : ANIM.flammes → RENDER.flames / BOSS.phase2.flames.
import * as THREE from 'three';
import { ANIM } from './reglages.js';
import { SKIN_FX } from '../config.js';

// 2e instance (`flammes.js?ombre`, skin « Agent de l'ombre ») : module distinct (autres tableaux, autre maillage), réglages
// de SKIN_FX.ombre.fumee.flammes, fumée noire fine sans feu. Le singleton du boss (`flammes.js`) ne change pas.
const OMBRE = import.meta.url.includes('?ombre');
const F = OMBRE ? SKIN_FX.ombre.fumee.flammes : ANIM.flammes;
const CAP = F.cap;
const H = 1 / F.hz;
const px = new Float32Array(CAP);
const py = new Float32Array(CAP);
const pz = new Float32Array(CAP);
const vx = new Float32Array(CAP);
const vy = new Float32Array(CAP);
const vz = new Float32Array(CAP);
const age = new Float32Array(CAP);
const vie = new Float32Array(CAP).fill(-1); // < 0 : libre
const taille = new Float32Array(CAP);
const graine = new Float32Array(CAP);
const fumee = new Uint8Array(CAP); // 1 = née fumée (pas de feu)
// émetteurs : x, y, z, vx, vy, vz (vitesse du porteur), débit (particules/s), genre (0 feu, 1 fumée), rayon, poussée
export const NE = OMBRE ? F.ne : 8;
export const EM = new Float32Array(NE * 10);
const accum = new Float64Array(NE);
const S = new Float64Array(4); // [temps accumulé, temps simulé, numéro de particule, prochain emplacement]
let feu = null;
let fum = null;
let aFeu = null;
let aFum = null;

/** Hasard déterministe 0..1 (hachage entier). */
function hash(n) {
  let x = (n * 0x27d4eb2d) | 0;
  x = (x ^ (x >>> 15)) | 0;
  x = Math.imul(x, 0x85ebca6b);
  x = (x ^ (x >>> 13)) | 0;
  x = Math.imul(x, 0xc2b2ae35);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

const VERT = `attribute vec4 aP; varying vec4 vP; varying vec2 vUv;
  void main() {
    vP = aP; vUv = position.xy + 0.5;
    vec4 mv = modelViewMatrix * vec4( instanceMatrix[3].xyz, 1.0 );
    mv.xy += position.xy * aP.x;
    gl_Position = projectionMatrix * mv;
  }`;
// aP : x = taille (m), y = chaleur 0..1, z = opacité, w = graine
const FRAG_FEU = `varying vec4 vP; varying vec2 vUv;
  void main() {
    vec2 q = vUv - 0.5;
    float a = atan( q.y, q.x ); float r = length( q ) * 2.0;
    // contour vivant : rayon modulé par des lobes qui tournent avec la graine
    float lobe = 0.82 + 0.12 * sin( a * 3.0 + vP.w * 6.28 ) + 0.06 * sin( a * 5.0 - vP.w * 11.0 );
    float m = smoothstep( lobe, lobe * 0.25, r );
    float h = vP.y;
    vec3 c = mix( vec3( 0.75, 0.09, 0.02 ), vec3( 1.0, 0.42, 0.08 ), smoothstep( 0.25, 0.55, h ) );
    c = mix( c, vec3( 1.0, 0.86, 0.55 ), smoothstep( 0.62, 0.92, h ) );
    c *= 1.2 + 3.0 * h * h * ( 1.0 - r ); // cœur au-dessus du seuil du bloom
    gl_FragColor = vec4( c * m * vP.z, 1.0 );
  }`;
const FRAG_FUM = `varying vec4 vP; varying vec2 vUv;
  void main() {
    vec2 q = vUv - 0.5;
    float a = atan( q.y, q.x ); float r = length( q ) * 2.0;
    float lobe = 0.9 + 0.04 * sin( a * 3.0 + vP.w * 9.0 ) + 0.03 * sin( a * 5.0 - vP.w * 4.0 );
    float m = smoothstep( lobe, 0.0, r );
    m *= m;
    vec3 c = mix( vec3( 0.07, 0.065, 0.07 ), vec3( 0.32, 0.12, 0.06 ), smoothstep( 0.2, 0.45, vP.y ) );
    gl_FragColor = vec4( c, m * vP.z );
  }`;
// fumée du skin ombre : teinte unie (SKIN_FX.ombre.fumee.couleur, linéarisée par le seuil du shader : couleur écran)
const FRAG_FUM_OMBRE = `varying vec4 vP; varying vec2 vUv; uniform vec3 uCouleur;
  void main() {
    vec2 q = vUv - 0.5;
    float a = atan( q.y, q.x ); float r = length( q ) * 2.0;
    float lobe = 0.9 + 0.04 * sin( a * 3.0 + vP.w * 9.0 ) + 0.03 * sin( a * 5.0 - vP.w * 4.0 );
    float m = smoothstep( lobe, 0.0, r );
    m = pow( m, 0.6 );
    gl_FragColor = vec4( uCouleur, m * vP.z );
  }`;

function maillage(frag, additif, nom) {
  const g = new THREE.PlaneGeometry(1, 1);
  const a = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aP', a);
  const m = new THREE.InstancedMesh(
    g,
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: frag,
      uniforms: OMBRE ? { uCouleur: { value: new THREE.Color(SKIN_FX.ombre.fumee.couleur) } } : {},
      transparent: true,
      depthWrite: false,
      blending: additif ? THREE.AdditiveBlending : THREE.NormalBlending,
    }),
    CAP,
  );
  m.name = nom;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  return [m, a];
}

export function init(scene) {
  [fum, aFum] = maillage(OMBRE ? FRAG_FUM_OMBRE : FRAG_FUM, false, OMBRE ? 'fumee-ombre' : 'flammes-fumee');
  [feu, aFeu] = maillage(FRAG_FEU, true, OMBRE ? 'fumee-ombre-feu' : 'flammes-feu');
  fum.renderOrder = OMBRE ? SKIN_FX.ombre.fumee.ordre : 4;
  feu.renderOrder = 5;
  if (OMBRE) feu.visible = false; // jamais de feu (count reste 0) : aucun appel de dessin
  scene.add(fum);
  scene.add(feu);
  reset();
}

export function reset() {
  vie.fill(-1);
  accum.fill(0);
  EM.fill(0);
  S[0] = 0;
}

/**
 * Émetteur k : position, vitesse du porteur, débit (/s), genre (0 feu, 1 fumée), rayon, poussée (m/s vers le haut).
 * Init et outils seulement : par image, écrire directement dans EM (des flottants passés en argument seraient emballés).
 */
export function setEmetteur(k, x, y, z, ux, uy, uz, debit, genre, rayon, poussee) {
  const o = k * 10;
  EM[o] = x;
  EM[o + 1] = y;
  EM[o + 2] = z;
  EM[o + 3] = ux;
  EM[o + 4] = uy;
  EM[o + 5] = uz;
  EM[o + 6] = debit;
  EM[o + 7] = genre;
  EM[o + 8] = rayon;
  EM[o + 9] = poussee;
}

/** Bouffée immédiate de n particules à l'émetteur k (tir de mortier). */
export function bouffee(k, n) {
  accum[k] += n;
}

function emettre(k) {
  const o = k * 10;
  const id = S[2]++;
  const i = S[3];
  S[3] = (i + 1) % CAP;
  const r1 = hash(id * 7 + 1);
  const r2 = hash(id * 7 + 2);
  const r3 = hash(id * 7 + 3);
  const r4 = hash(id * 7 + 4);
  const a = r1 * 6.2831853;
  const rr = EM[o + 8] * Math.sqrt(r2);
  px[i] = EM[o] + Math.cos(a) * rr;
  py[i] = EM[o + 1];
  pz[i] = EM[o + 2] + Math.sin(a) * rr;
  const up = EM[o + 9] * (0.75 + 0.5 * r3);
  vx[i] = EM[o + 3] * F.heritage + Math.cos(a) * 0.4 * r4;
  vy[i] = EM[o + 4] * F.heritage + up;
  vz[i] = EM[o + 5] * F.heritage + Math.sin(a) * 0.4 * r4;
  age[i] = 0;
  const f = EM[o + 7] > 0.5;
  fumee[i] = f ? 1 : 0;
  vie[i] = (f ? F.vieFumee : F.vieFeu) * (0.75 + 0.5 * r3);
  taille[i] = (f ? F.tailleFumee : F.tailleFeu) * (0.75 + 0.5 * r4);
  graine[i] = r2;
}

function pas() {
  const t = S[1];
  for (let k = 0; k < NE; k++) {
    const d = EM[k * 10 + 6];
    accum[k] += d * H;
    while (accum[k] >= 1) {
      accum[k] -= 1;
      emettre(k);
    }
  }
  const T = F.turbulence;
  const kd = 1 - Math.exp(-F.trainee * H);
  for (let i = 0; i < CAP; i++) {
    if (vie[i] < 0) continue;
    const a = age[i] + H;
    if (a >= vie[i]) {
      vie[i] = -1;
      continue;
    }
    age[i] = a;
    const h = fumee[i] === 1 ? 0.3 * (1 - a / vie[i]) : 1 - a / vie[i]; // chaleur
    // rotationnel de ψ = (sin(1,3y + t + s), sin(0,9z + 0,7t + 2s), sin(1,1x − 0,9t + 3s)) : chaque composante ne
    // dépend pas de sa propre coordonnée → champ sans divergence (volutes qui tournent sans s'écraser)
    const x = px[i] * F.echelle;
    const y = py[i] * F.echelle;
    const z = pz[i] * F.echelle;
    const s = graine[i] * 6.2831853;
    const cx = -0.9 * Math.cos(0.9 * z + t * 0.7 + 2 * s);
    const cy = -1.1 * Math.cos(1.1 * x - t * 0.9 + 3 * s);
    const cz = -1.3 * Math.cos(1.3 * y + t + s);
    vx[i] += cx * T * H;
    vy[i] += (F.flottaison * h + cy * T * 0.5 - (fumee[i] === 1 || h < 0.35 ? F.ralentiFumee : 0)) * H;
    vz[i] += cz * T * H;
    // traînée vers l'air immobile (le porteur avance : la flamme reste derrière lui)
    vx[i] -= vx[i] * kd;
    vz[i] -= vz[i] * kd;
    vy[i] -= vy[i] * kd * 0.35;
    px[i] += vx[i] * H;
    py[i] += vy[i] * H;
    pz[i] += vz[i] * H;
  }
  S[1] = t + H;
}

/** Entrée de update : [0] = dt simulé (passé par tableau : un flottant en argument serait emballé, § V). */
export const entree = new Float64Array(1);
/** Avance de entree[0] secondes simulées (sous-pas fixes). */
export function update() {
  const dt = entree[0];
  if (!feu || !(dt > 0)) return;
  let acc = S[0] + dt;
  let n = 0;
  while (acc >= H && n < 8) {
    pas();
    acc -= H;
    n++;
  }
  S[0] = acc >= H ? 0 : acc;
}

export function sync() {
  if (!feu) return;
  const mf = feu.instanceMatrix.array;
  const ms = fum.instanceMatrix.array;
  const af = aFeu.array;
  const as = aFum.array;
  let nf = 0;
  let ns = 0;
  for (let i = 0; i < CAP; i++) {
    if (vie[i] < 0) continue;
    const u = age[i] / vie[i];
    const h = fumee[i] === 1 ? 0.3 * (1 - u) : 1 - u;
    const sz = taille[i];
    // feu : chaud (h > 0,3), grandit puis rétrécit en refroidissant
    if (h > 0.3) {
      const o = nf * 16;
      mf[o + 12] = px[i];
      mf[o + 13] = py[i];
      mf[o + 14] = pz[i];
      mf[o + 15] = 1;
      af[nf * 4] = sz * (0.55 + 0.9 * Math.sin(Math.PI * (u < 0.8 ? u / 0.8 : 1) * 0.6 + 0.2));
      af[nf * 4 + 1] = h;
      af[nf * 4 + 2] = h > 0.42 ? 1 : (h - 0.3) / 0.12;
      af[nf * 4 + 3] = graine[i];
      nf++;
    }
    // fumée : froide (h < 0,45), grossit et s'efface
    if (h < 0.45) {
      const o = ns * 16;
      ms[o + 12] = px[i];
      ms[o + 13] = py[i];
      ms[o + 14] = pz[i];
      ms[o + 15] = 1;
      as[ns * 4] = sz * (1.0 + 1.6 * u) * F.grossitFumee;
      as[ns * 4 + 1] = h;
      const entree = h > 0.33 ? (0.45 - h) / 0.12 : 1;
      as[ns * 4 + 2] = F.opaciteFumee * entree * (1 - u) * (1 - u) * 1.6;
      as[ns * 4 + 3] = graine[i];
      ns++;
    }
  }
  feu.count = nf;
  fum.count = ns;
  if (nf) {
    feu.instanceMatrix.needsUpdate = true;
    aFeu.needsUpdate = true;
  }
  if (ns) {
    fum.instanceMatrix.needsUpdate = true;
    aFum.needsUpdate = true;
  }
}

export function setVisible(v) {
  if (!feu) return;
  fum.visible = !!v;
  feu.visible = OMBRE ? false : !!v;
}

export function inspect(out) {
  let n = 0;
  for (let i = 0; i < CAP; i++) if (vie[i] >= 0) n++;
  out.particules = n;
  out.feu = feu ? feu.count : 0;
  out.fumee = fum ? fum.count : 0;
  out.emises = S[2]; // particules nées depuis le début (tests)
  let om = 0; // opacité maximale écrite à la dernière sync (tests)
  if (aFum) for (let i = 0; i < fum.count; i++) if (aFum.array[i * 4 + 2] > om) om = aFum.array[i * 4 + 2];
  out.opaciteMax = om;
}
