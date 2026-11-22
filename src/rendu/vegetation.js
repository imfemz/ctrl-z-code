// RENDU « PEINT » — végétation du désert, vivante (passe 5 : traitement stylisé « painterly », références de Femz).
//
// Herbes sèches dorées et touffes vert-olive en brins épais (géométrie : 9 brins de 3 segments par touffe), arbustes
// du désert près des bords et des rochers, petites fleurs et succulentes discrètes près des bords.
// Instanciées par espèce (UN InstancedMesh chacune : instances rangées par carreau, seuls les carreaux vus sont recopiés
// en tête du tampon quand leur ensemble change — intégration du 13/11), densité modulée
// par un bruit à grande échelle (prairies sèches, clairières, chemins vides), jamais sur les obstacles.
// Animation 100 % shader (aucun coût CPU par brin) :
//   vent   : vagues qui traversent l'arène (direction et vitesse globales) + rafales (bruit), plus fortes au bout du brin ;
//   écart  : les brins se couchent loin des « pousseurs » (héros, boss, et les 6 robots les plus proches du héros :
//            8 vec4 d'uniforme, écrits en place à chaque image) et s'aplatissent sous eux (rien ne cache une unité).
// Couleur : dégradé base sombre → bout clair et saturé (couleur de sommet × couleur d'instance), translucidité au
// soleil (profil 'herbe' : le bout s'éclaire quand on regarde vers le soleil), ombres reçues et ombres de nuages.
// Contrat : init(scene, overlaps, obstacles, rockCount) à l'init ; update(view, dt) une fois par image (world.update) ;
// setQualite(q) au changement de niveau.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { E, P } from '../state.js';
import { PEINT } from './reglages.js';
import { createPaintedMaterial } from './materiaux.js';

const V = PEINT.vegetation;
// uniformes partagés par tous les maillages de végétation (un seul objet chacun)
export const uniformsVent = {
  uSrVent: { value: new THREE.Vector4(0, V.vent.direction[0], V.vent.direction[1], V.vent.force) }, // x : temps (s)
  uSrVentOnde: { value: new THREE.Vector4(V.vent.longueur, V.vent.vitesse, V.vent.rafales, V.hauteurEcrasee) },
  uSrPousse: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)) }, // x, z, rayon, force
};
const TV = new Float64Array(3); // 0 : temps du vent, 1 : actif, 2 : dernier instant réel (ms)
TV[1] = 1;

const seedBox = new Int32Array(1);
function rnd() {
  const seed = (seedBox[0] + 0x6d2b79f5) | 0;
  seedBox[0] = seed;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a, b) => a + (b - a) * rnd();
function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function bruit(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash2(xi, yi) * (1 - u) + hash2(xi + 1, yi) * u) * (1 - v) + (hash2(xi, yi + 1) * (1 - u) + hash2(xi + 1, yi + 1) * u) * v;
}
/** Densité de végétation en (x, z) : prairies sèches à grande échelle, chemins vides (mêmes chemins que le sol). */
export function densite(x, z) {
  const n = bruit(x / 22 + 3.1, z / 22 - 7.7) * 0.7 + bruit(x / 7, z / 7) * 0.3;
  const chemin = Math.abs(bruit(x / 26 + 11, z / 26 + 5) - 0.5); // < 0,04 : chemin piétiné
  const bord = Math.max(Math.abs(x), Math.abs(z)) / WORLD.half; // plus dense près des bords
  return Math.max(0, (n - 0.38) * 1.9 + bord * 0.35) * (chemin < 0.045 ? 0 : chemin < 0.07 ? 0.4 : 1);
}

const SEG = 2; // segments par brin (le dernier est une pointe) : 6 triangles par brin, deux faces
/** Touffe : `brins` brins effilés de 2 segments, couleur de sommet = dégradé (0,32 à la base → 1 au bout). */
function touffeGeometry(brins, hMin, hMax, ecart) {
  const pos = [];
  const col = [];
  const nor = [];
  for (let b = 0; b < brins; b++) {
    const a = (b / brins) * Math.PI * 2 + rr(-0.4, 0.4);
    const h = rr(hMin, hMax);
    const lean = rr(0.15, 0.45) * h;
    const w = rr(0.035, 0.055);
    const cx = Math.cos(a), cz = Math.sin(a);
    const px = -cz, pz = cx;
    const bx = cx * rr(0, ecart), bz = cz * rr(0, ecart);
    const pts = [];
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const ww = w * (1 - t * 0.85);
      const off = lean * t * t;
      pts.push([bx + cx * off - px * ww, h * t, bz + cz * off - pz * ww, bx + cx * off + px * ww, h * t, bz + cz * off + pz * ww, t]);
    }
    const tri = (A, B, Cc, ta, tb, tc) => {
      pos.push(...A, ...B, ...Cc);
      for (const t of [ta, tb, tc]) {
        const g = 0.32 + 0.68 * t;
        col.push(g, g, g);
        nor.push(cx * 0.35, 0.94, cz * 0.35); // normales tirées vers le haut : la touffe s'éclaire comme un volume
      }
    };
    for (let s = 0; s < SEG; s++) {
      const p0 = pts[s], p1 = pts[s + 1];
      const L0 = [p0[0], p0[1], p0[2]], R0 = [p0[3], p0[4], p0[5]], L1 = [p1[0], p1[1], p1[2]], R1 = [p1[3], p1[4], p1[5]];
      if (s === SEG - 1) {
        tri(L0, R0, [(p1[0] + p1[3]) / 2, p1[1], (p1[2] + p1[5]) / 2], p0[6], p0[6], 1); // pointe
        tri(R0, L0, [(p1[0] + p1[3]) / 2, p1[1], (p1[2] + p1[5]) / 2], p0[6], p0[6], 1);
      } else {
        tri(L0, R0, R1, p0[6], p0[6], p1[6]);
        tri(L0, R1, L1, p0[6], p1[6], p1[6]);
        tri(R0, L0, R1, p0[6], p0[6], p1[6]); // envers (matériau à une face : un programme de moins)
        tri(R1, L0, L1, p1[6], p0[6], p1[6]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1));
  return g;
}

/** Arbuste du désert : boule bosselée aplatie (icosaèdre), dessous sombre, dessus clair. */
function arbusteGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1); // déjà non indexée
  g.deleteAttribute('uv');
  const p = g.attributes.position.array;
  seedBox[0] = 0xa4b;
  const col = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const k = 0.85 + 0.3 * hash2(Math.round(p[i] * 9), Math.round(p[i + 2] * 9 + p[i + 1] * 31));
    p[i] *= k;
    p[i + 1] = Math.max(-0.2, p[i + 1]) * k * 0.7 + 0.45;
    p[i + 2] *= k;
    const t = Math.min(1, Math.max(0, p[i + 1] / 1.0));
    const v = 0.4 + 0.6 * t;
    col[i] = col[i + 1] = col[i + 2] = v;
  }
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(p.length / 3), 1));
  return g;
}

/** Fleur / succulente : rosette de 6 feuilles (cônes plats) + cœur coloré (couleur d'instance sur le cœur). */
function rosetteGeometry() {
  const t = touffeGeometry(6, 0.12, 0.2, 0.03);
  return t;
}

const meshes = [];
// Intégration : une espèce = UN InstancedMesh (un appel de dessin), instances rangées par carreau. Les carreaux vus
// sont recopiés en tête des tampons d'instance quand leur ensemble change (rare : la caméra traverse un carreau de
// PEINT.vegetation.carreau m), jamais à chaque image. Le prototype faisait un maillage et un matériau par carreau.
const groupes = []; // { mesh, mats, cols, debut (Int32Array : 1re instance de chaque carreau, + fin), cx, cz, vus, n }
const VU = new Float64Array(6); // emprise de la vue : cible x, z, demi-largeur, demi-profondeur, marges (droite, haut)

function regrouper(liste, geometry, profil, nom) {
  const taille = V.carreau;
  const nc = Math.ceil((2 * WORLD.half) / taille);
  const carreau = (x, z) => {
    const ix = Math.min(nc - 1, Math.max(0, Math.floor((x + WORLD.half) / taille)));
    const iz = Math.min(nc - 1, Math.max(0, Math.floor((z + WORLD.half) / taille)));
    return iz * nc + ix;
  };
  const tri = liste.map((it) => [carreau(it[0], it[1]), it]).sort((p, q) => p[0] - q[0]);
  const n = tri.length;
  const material = createPaintedMaterial({ profil });
  const base = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    base(shader, r);
    for (const u in uniformsVent) shader.uniforms[u] = uniformsVent[u];
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', VENT_PARS + '\nvoid main() {')
      .replace('#include <project_vertex>', VENT_MAIN);
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => key() + '|vent';
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, n));
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  const mats = new Float32Array(n * 16);
  const cols = new Float32Array(n * 3);
  const debut = new Int32Array(nc * nc + 1);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let c = 0;
  for (let i = 0; i < n; i++) {
    const [k, it] = tri[i];
    while (c <= k) debut[c++] = i;
    e.set(0, it[3], 0);
    q.setFromEuler(e);
    v.set(it[0], 0, it[1]);
    sc.set(it[2], it[2] * rr(0.85, 1.15), it[2]);
    m4.compose(v, q, sc);
    m4.toArray(mats, i * 16);
    cols[i * 3] = it[4];
    cols[i * 3 + 1] = it[5];
    cols[i * 3 + 2] = it[6];
  }
  while (c <= nc * nc) debut[c++] = n;
  const cx = new Float32Array(nc * nc);
  const cz = new Float32Array(nc * nc);
  for (let iz = 0; iz < nc; iz++)
    for (let ix = 0; ix < nc; ix++) {
      cx[iz * nc + ix] = -WORLD.half + (ix + 0.5) * taille;
      cz[iz * nc + ix] = -WORLD.half + (iz + 0.5) * taille;
    }
  mesh.frustumCulled = false; // l'élimination est faite par carreau, ci-dessus (la sphère d'un InstancedMesh ne suit pas)
  mesh.receiveShadow = true;
  mesh.name = nom;
  mesh.matrixAutoUpdate = false;
  mesh.count = 0;
  meshes.push(mesh);
  groupes.push({ mesh, mats, cols, debut, cx, cz, vus: new Uint8Array(nc * nc), n, demi: taille / 2, sale: true });
}

/** Recopie les carreaux vus en tête des tampons d'instance, si leur ensemble a changé. Aucune allocation sauf alors. */
function recopier(g) {
  const tx = VU[0], tz = VU[1], hw = VU[2], hd = VU[3], mr = VU[4], mu = VU[5];
  const rX = VU_AXES[0], rZ = VU_AXES[1], uX = VU_AXES[2], uZ = VU_AXES[3];
  const vus = g.vus;
  let change = g.sale;
  for (let k = 0; k < vus.length; k++) {
    if (g.debut[k + 1] === g.debut[k]) continue; // carreau vide
    const dx = g.cx[k] - tx, dz = g.cz[k] - tz;
    const a = dx * rX + dz * rZ;
    const b = dx * uX + dz * uZ;
    const vu = (a < 0 ? -a : a) <= hw + mr && (b < 0 ? -b : b) <= hd + mu ? 1 : 0;
    if (vu !== vus[k]) {
      vus[k] = vu;
      change = true;
    }
  }
  if (!change) return;
  g.sale = false;
  const im = g.mesh.instanceMatrix.array;
  const ic = g.mesh.instanceColor.array;
  const M = g.mats, C = g.cols;
  let o = 0;
  for (let k = 0; k < vus.length; k++) {
    if (vus[k] === 0) continue;
    for (let i = g.debut[k], fin = g.debut[k + 1]; i < fin; i++) {
      const s = i * 16, d = o * 16;
      for (let j = 0; j < 16; j++) im[d + j] = M[s + j];
      ic[o * 3] = C[i * 3];
      ic[o * 3 + 1] = C[i * 3 + 1];
      ic[o * 3 + 2] = C[i * 3 + 2];
      o++;
    }
  }
  g.mesh.count = o;
  g.mesh.instanceMatrix.needsUpdate = true;
  g.mesh.instanceColor.needsUpdate = true;
}
const VU_AXES = new Float64Array(4); // droite (x, z) et haut (x, z) de l'écran au sol

// Vent et écart, appliqués APRÈS l'instanciation, en monde (modelMatrix = identité pour ces maillages)
const VENT_PARS = /* glsl */ `
uniform vec4 uSrVent; uniform vec4 uSrVentOnde; uniform vec4 uSrPousse[ 8 ];
float srVh( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float srVn( vec2 p ) { vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( srVh( i ), srVh( i + vec2( 1, 0 ) ), u.x ), mix( srVh( i + vec2( 0, 1 ) ), srVh( i + vec2( 1, 1 ) ), u.x ), u.y ); }`;
const VENT_MAIN = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  vec3 srRacine = ( instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
#else
  vec3 srRacine = vec3( 0.0 );
#endif
{
  float srH = max( 0.0, mvPosition.y - srRacine.y );
  float srT = clamp( srH / 0.5, 0.0, 1.0 ); srT *= srT; // le bout bouge, la base reste plantée
  vec2 dir = uSrVent.yz;
  float phase = dot( srRacine.xz, dir ) / uSrVentOnde.x - uSrVent.x * uSrVentOnde.y;
  float onde = 0.5 + 0.5 * sin( phase * 6.2831853 );
  float rafale = srVn( srRacine.xz * 0.05 + dir * uSrVent.x * 0.35 );
  float b = uSrVent.w * ( 0.25 + 0.75 * onde ) * ( 1.0 + uSrVentOnde.z * ( rafale - 0.5 ) );
  b += 0.06 * sin( uSrVent.x * 7.0 + srRacine.x * 3.1 + srRacine.z * 2.3 ); // frémissement
  mvPosition.xz += dir * b * srT;
  // écart : couché loin du pousseur, aplati sous lui
  for ( int i = 0; i < 8; i ++ ) {
    vec4 pu = uSrPousse[ i ];
    if ( pu.w <= 0.0 ) continue;
    vec2 d = srRacine.xz - pu.xy;
    float l = length( d );
    float f = ( 1.0 - smoothstep( pu.z * 0.4, pu.z, l ) ) * pu.w;
    mvPosition.xz += ( d / max( l, 1e-3 ) ) * f * srT * 0.55;
    mvPosition.y = mix( mvPosition.y, srRacine.y + srH * uSrVentOnde.w, f );
  }
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`;

export function init(scene, overlaps, obstacles, rockCount) {
  seedBox[0] = 0x9e55;
  const lim = WORLD.half - 1.0;
  const herbes = [];
  const C = V.couleurs;
  const or = new THREE.Color(C.herbeSeche), olive = new THREE.Color(C.touffeOlive), pale = new THREE.Color(C.herbePale);
  // prairies sèches : chaque tirage accepté pose un petit massif (3 à 6 touffes serrées), couleur du massif proche
  for (let i = 0; i < V.herbes * 6 && herbes.length < V.herbes; i++) {
    const x0 = rr(-lim, lim), z0 = rr(-lim, lim);
    const d = densite(x0, z0);
    if (rnd() > Math.min(1, d * 1.3)) continue;
    const t = rnd();
    const c = t < 0.6 ? or : t < 0.82 ? olive : pale;
    const nm = 3 + Math.floor(rnd() * 4);
    for (let m = 0; m < nm; m++) {
      const x = x0 + rr(-0.9, 0.9), z = z0 + rr(-0.9, 0.9);
      if (Math.abs(x) > lim || Math.abs(z) > lim || overlaps(x, z, 0.45) || densite(x, z) < 0.05) continue;
      const l = rr(0.82, 1.12);
      herbes.push([x, z, rr(0.85, 1.35) * (0.85 + 0.35 * Math.min(1, d)), rr(0, 6.283), c.r * l, c.g * l, c.b * l]);
    }
  }
  regrouper(herbes, touffeGeometry(8, 0.3, 0.58, 0.16), 'herbe', 'herbes');
  // arbustes : près des bords et autour des rochers
  const arb = [];
  const sauge = new THREE.Color(C.arbuste), brun = new THREE.Color(C.arbusteSec);
  for (let i = 0; i < V.arbustes * 30 && arb.length < V.arbustes; i++) {
    let x, z;
    if (rnd() < 0.5 && rockCount > 0) {
      const o = Math.floor(rnd() * rockCount) * 3;
      const a = rr(0, 6.283), r = obstacles[o + 2] + rr(0.6, 1.8);
      x = obstacles[o] + Math.cos(a) * r;
      z = obstacles[o + 1] + Math.sin(a) * r;
    } else {
      x = rr(-lim, lim);
      z = rr(-lim, lim);
      if (Math.max(Math.abs(x), Math.abs(z)) < WORLD.half - 14) continue;
    }
    if (Math.abs(x) > lim || Math.abs(z) > lim || overlaps(x, z, 0.8)) continue;
    const c = rnd() < 0.7 ? sauge : brun;
    arb.push([x, z, rr(0.45, 0.85), rr(0, 6.283), c.r, c.g, c.b]);
  }
  regrouper(arb, arbusteGeometry(), 'herbe', 'arbustes');
  // fleurs et succulentes : discrètes, près des bords
  const fl = [];
  const teintes = C.fleurs.map((h) => new THREE.Color(h));
  for (let i = 0; i < V.fleurs * 30 && fl.length < V.fleurs; i++) {
    const x = rr(-lim, lim), z = rr(-lim, lim);
    if (Math.max(Math.abs(x), Math.abs(z)) < WORLD.half - 12 || overlaps(x, z, 0.4)) continue;
    const c = teintes[Math.floor(rnd() * teintes.length)];
    fl.push([x, z, rr(0.8, 1.3), rr(0, 6.283), c.r, c.g, c.b]);
  }
  regrouper(fl, rosetteGeometry(), 'herbe', 'fleurs');
  for (const m of meshes) {
    m.updateMatrix();
    scene.add(m);
  }
  return meshes;
}

export function setActif(on) {
  TV[1] = on ? 1 : 0;
  for (let i = 0; i < meshes.length; i++) meshes[i].visible = on;
}

/** Qualité adaptative (intégration) : la végétation suit le drapeau `decor` du niveau (cailloux et touffes aussi). */
export function setQualite(q) {
  setActif(!!q.decor);
}

/**
 * Une fois par image : carreaux vus (view = camera.view), temps du vent, pousseurs (héros, boss, 6 robots les plus
 * proches du héros). dt : temps réel de l'image (s) ; sans dt (prototype), mesuré par performance.now().
 */
export function update(view = null, dtReel = -1) {
  if (TV[1] === 0) return;
  if (view !== null) {
    VU[0] = view.targetX;
    VU[1] = view.targetZ;
    VU[2] = view.halfW;
    VU[3] = view.halfD;
    VU_AXES[0] = view.rightX;
    VU_AXES[1] = view.rightZ;
    VU_AXES[2] = view.upX;
    VU_AXES[3] = view.upZ;
    for (let i = 0; i < groupes.length; i++) {
      const g = groupes[i];
      // demi-étendue d'un carreau projetée sur la droite et le haut de l'écran, plus la marge (vent, hauteur, secousse)
      VU[4] = g.demi * ((view.rightX < 0 ? -view.rightX : view.rightX) + (view.rightZ < 0 ? -view.rightZ : view.rightZ)) + V.marge;
      VU[5] = g.demi * ((view.upX < 0 ? -view.upX : view.upX) + (view.upZ < 0 ? -view.upZ : view.upZ)) + V.marge;
      recopier(g);
    }
  }
  // Temps RÉEL (pas « 1/60 par image » : sur un écran à 120 Hz le vent allait deux fois trop vite), ralenti par
  // vent.rythme (retour de Femz du 13/11 : « le vent des arbres et plantes bouge trop vite »).
  let dt = dtReel;
  if (dt < 0) {
    const maintenant = performance.now();
    dt = TV[2] > 0 ? Math.min((maintenant - TV[2]) / 1000, 0.1) : 1 / 60;
    TV[2] = maintenant;
  }
  TV[0] += dt * V.vent.rythme;
  uniformsVent.uSrVent.value.x = TV[0];
  const pu = uniformsVent.uSrPousse.value;
  const R = V.pousse;
  pu[0].set(P.x, P.z, R.heros, P.alive ? 1 : 0);
  // boss et robots proches : une passe sur E, 7 meilleurs (sélection par insertion, sans allocation)
  for (let k = 1; k < 8; k++) pu[k].w = 0;
  const X = E.x, Z = E.z, A = E.alive, T = E.type, Rr = E.radius, n = E.count;
  const bi = E.bossIndex;
  let slot = 1;
  if (bi >= 0 && A[bi] !== 0) {
    pu[1].set(X[bi], Z[bi], Rr[bi] * 1.6 + 0.5, 1);
    slot = 2;
  }
  const SU = E.sus;
  for (let i = 0; i < n; i++) {
    if (A[i] === 0 || i === bi || SU[i] === 2) continue; // § E4.F : garé
    const dx = X[i] - P.x, dz = Z[i] - P.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > R.portee * R.portee) continue;
    // remplace le plus loin des emplacements robots s'il est plus loin que celui-ci
    let pire = -1, pd = -1;
    for (let k = slot; k < 8; k++) {
      if (pu[k].w === 0) {
        pire = k;
        pd = 1e9;
        break;
      }
      const ex = pu[k].x - P.x, ez = pu[k].y - P.z;
      const e2 = ex * ex + ez * ez;
      if (e2 > pd) {
        pd = e2;
        pire = k;
      }
    }
    if (pire >= 0 && pd > d2) pu[pire].set(X[i], Z[i], Rr[i] * 1.5 + 0.35, 0.85);
  }
  void T;
}

export function inspect(out) {
  let n = 0, tri = 0, total = 0;
  for (const g of groupes) {
    const m = g.mesh;
    n += m.count;
    total += g.n;
    tri += (m.geometry.attributes.position.count / 3) * m.count;
  }
  out.vegetation = { instances: n, total, triangles: tri, maillages: meshes.length };
}
