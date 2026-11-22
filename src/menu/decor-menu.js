// MENU PRINCIPAL — décor du « hero shot » : ciel de crépuscule désertique, dunes, promontoire rocheux (rocher du jeu,
// textures cuites), carcasses de robots au pied, mesas lointaines dans la brume, voiles de brume au pied des boss,
// lumières de « key art » (contre-jour chaud du soleil couchant, liseré cyan, remplissage chaud bas).
// Le ciel et l'horizon n'existent QUE dans le menu (la caméra du jeu n'en montre jamais : SPEC.md).
// Modèles réutilisés tels quels : assets/modeles/decor/decor-rochers.glb (nœud rocher-11), decor-carcasses.glb,
// falaise-8-v2.glb / falaise-9-v2.glb, lus par src/rendu/glb.js ; matériaux peints de src/rendu/materiaux.js.
// DA « carte mère » (14/11/2026, docs/da-carte-mere.md § 7) : même plan, même lumière de « key art » ; la carte, plate,
// remplace les dunes (shader de circuit du jeu, profil 'sol'), le héros se tient sur un condensateur géant, des
// composants remplacent les rochers d'appoint et une ligne d'horizon de composants géants remplace les mesas.
// « ?theme=desert » rend l'ancien décor.
import * as THREE from 'three';
import { chargerGeometrie } from '../rendu/glb.js';
import { createPaintedMaterial, uniformsPeints } from '../rendu/materiaux.js';
import { PEINT } from '../rendu/reglages.js';
import { MENU, ORIENTATION, versMonde } from './reglages-menu.js';

const DEG = Math.PI / 180;
const L = MENU.lumiere;
const CM = PEINT.theme === 'carte-mere';
const DECOR = 'assets/modeles/decor/';

// ----- Sol : dunes (bruit de valeur lissé), plat autour du promontoire, plus haut au loin --------------------------
function hashF(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function bruit(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hashF(ix, iz);
  const b = hashF(ix + 1, iz);
  const c = hashF(ix, iz + 1);
  const d = hashF(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
export function hauteurSol(x, z) {
  if (CM) return -0.6; // carte mère : plate jusqu'à l'horizon
  const r = Math.hypot(x, z);
  const loin = Math.min(1, Math.max(0, (r - 18) / 60));
  // dunes allongées (crêtes obliques), deux octaves
  const u = x * 0.8 + z * 0.6;
  const dunes = Math.sin(u * 0.045 + bruit(x * 0.01, z * 0.01) * 4) * 0.5 + 0.5;
  const h1 = Math.pow(dunes, 2.2) * (1.2 + 5.5 * loin);
  const h2 = (bruit(x * 0.06, z * 0.06) - 0.5) * (0.6 + 1.6 * loin);
  const h3 = (bruit(x * 0.25, z * 0.25) - 0.5) * 0.12;
  return h1 + h2 + h3 - 0.6;
}

function terrain() {
  // grille plus fine près du héros (répartition quadratique), 400 × 420 m
  const NX = 150;
  const NZ = 150;
  const xs = new Float32Array(NX + 1);
  const zs = new Float32Array(NZ + 1);
  for (let i = 0; i <= NX; i++) {
    const s = (i / NX) * 2 - 1;
    xs[i] = Math.sign(s) * s * s * 260 + s * 30;
  }
  for (let j = 0; j <= NZ; j++) {
    const s = j / NZ; // 0 = loin (−380), 1 = derrière la caméra (+40)
    const q = 1 - s;
    zs[j] = 40 - q * q * 380 - q * 40;
  }
  const n = (NX + 1) * (NZ + 1);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const sable = new THREE.Color(0xd9a066);
  const clair = new THREE.Color(0xf0c48a);
  const rouge = new THREE.Color(0xc9733c);
  const ombre = new THREE.Color(0xa8703f);
  const c = new THREE.Color();
  let k = 0;
  for (let j = 0; j <= NZ; j++)
    for (let i = 0; i <= NX; i++) {
      const x = xs[i];
      const z = zs[j];
      const y = hauteurSol(x, z);
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      const b1 = bruit(x * 0.03 + 7, z * 0.03);
      const b2 = bruit(x * 0.11, z * 0.11 + 3);
      c.copy(sable).lerp(rouge, Math.max(0, b1 - 0.45) * 1.1);
      c.lerp(clair, Math.max(0, b2 - 0.6) * 0.8);
      c.lerp(ombre, Math.max(0, 0.4 - b2) * 0.6);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
      k++;
    }
  const idx = [];
  for (let j = 0; j < NZ; j++)
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      const b = a + 1;
      const d = a + NX + 1;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aFx', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.computeVertexNormals();
  return g;
}

// ----- Ciel ---------------------------------------------------------------------------------------------------------
const CIEL_VERT = `varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); gl_Position = p.xyww; }`;
const CIEL_FRAG = `uniform vec3 uHorizon; uniform vec3 uBas; uniform vec3 uMilieu; uniform vec3 uZenith; uniform vec3 uSoleil;
uniform vec3 uHalo; uniform vec3 uNuages; uniform vec3 uSun; uniform vec3 uBrume; uniform float uTemps; varying vec3 vDir;
float h21( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
float vn( vec2 p ) { vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h21( i ), h21( i + vec2( 1, 0 ) ), u.x ), mix( h21( i + vec2( 0, 1 ) ), h21( i + vec2( 1, 1 ) ), u.x ), u.y ); }
float fbm( vec2 p ) { float s = 0.0; float a = 0.5; for ( int i = 0; i < 4; i ++ ) { s += vn( p ) * a; p *= 2.07; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize( vDir );
  float e = d.y;
  float h = max( e, 0.0 );
  vec3 c = mix( uHorizon, uBas, smoothstep( 0.0, 0.07, h ) );
  c = mix( c, uMilieu, smoothstep( 0.05, 0.3, h ) );
  c = mix( c, uZenith, smoothstep( 0.24, 0.85, h ) );
  // horizon : rejoint exactement la couleur de la brume (les dunes lointaines s'y fondent)
  c = mix( uBrume, c, smoothstep( -0.005, 0.045, e ) );
  float s = max( dot( d, uSun ), 0.0 );
  // halo du soleil couchant (large, puis serré), plus fort près de l'horizon
  float pres = 1.0 - smoothstep( 0.0, 0.35, h );
  c += uHalo * ( pow( s, 5.0 ) * ( 0.35 + 0.5 * pres ) + pow( s, 48.0 ) * 1.4 );
  // nuages peints : longues bandes basses (stratus), dessous éclairé en or vers le soleil, dessus plus sombre
  float az = atan( d.x, - d.z );
  vec2 p = vec2( az * 3.2 + uTemps * 0.004, h * 26.0 );
  float n = fbm( p * vec2( 1.0, 1.0 ) + vec2( 0.0, fbm( p * 0.5 ) * 1.5 ) );
  float bande = smoothstep( 0.04, 0.09, h ) * ( 1.0 - smoothstep( 0.17, 0.3, h ) );
  float m = smoothstep( 0.52, 0.7, n ) * bande;
  vec3 cn = mix( uNuages * 0.55, uHalo * 1.4 + uNuages * 0.3, pow( s, 3.0 ) );
  cn = mix( cn, uZenith * 1.2 + uNuages * 0.2, smoothstep( 0.6, 0.85, n ) * 0.5 );
  c = mix( c, cn, m * 0.8 );
  // disque du soleil (stylisé, ~1,4°), au-dessus du seuil du bloom
  float disque = smoothstep( 0.99962, 0.99972, s );
  c = mix( c, uSoleil * 14.0, disque * ( 1.0 - m * 0.7 ) );
  gl_FragColor = vec4( c, 1.0 );
}`;

// Carte mère : ciel NUMÉRIQUE (« on est dans un système informatique », Femz 14/11) — mêmes uniformes. Dégradé indigo,
// grille de sphère de données (méridiens, parallèles) qui s'efface vers l'horizon et le zénith, pluie de données
// (colonnes qui descendent), bandes de glitch basses qui clignotent (à la place des nuages), et à la place du soleil
// le noyau de l'AGI : halo rouge, anneaux qui pulsent, lentille rouge à cœur clair (au-dessus du seuil du bloom).
const CIEL_FRAG_CARTE = `uniform vec3 uHorizon; uniform vec3 uBas; uniform vec3 uMilieu; uniform vec3 uZenith; uniform vec3 uSoleil;
uniform vec3 uHalo; uniform vec3 uNuages; uniform vec3 uSun; uniform vec3 uBrume; uniform float uTemps; varying vec3 vDir;
float h21( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
void main() {
  vec3 d = normalize( vDir );
  float e = d.y;
  float h = max( e, 0.0 );
  vec3 c = mix( uHorizon, uBas, smoothstep( 0.0, 0.08, h ) );
  c = mix( c, uMilieu, smoothstep( 0.06, 0.35, h ) );
  c = mix( c, uZenith, smoothstep( 0.3, 0.9, h ) );
  c = mix( uBrume, c, smoothstep( -0.005, 0.045, e ) );
  float s = max( dot( d, uSun ), 0.0 );
  float pres = 1.0 - smoothstep( 0.0, 0.35, h );
  float az = atan( d.x, - d.z ) / 6.2831853;
  // grille de la sphère de données
  float u = az * 48.0;
  float v = h * 16.0;
  // distance à la ligne la plus proche, en pixels
  float gu = abs( fract( u + 0.5 ) - 0.5 ) / max( fwidth( u ), 1e-4 );
  float gv = abs( fract( v + 0.5 ) - 0.5 ) / max( fwidth( v ), 1e-4 );
  float ligne = 1.0 - smoothstep( 0.0, 1.2, min( gu, gv ) );
  c += uNuages * ligne * 0.32 * smoothstep( 0.03, 0.2, h ) * ( 1.0 - smoothstep( 0.55, 0.95, h ) );
  // pluie de données : colonnes fines, une goutte claire qui descend et sa traînée
  float col = floor( az * 160.0 );
  float r1 = h21( vec2( col, 3.7 ) );
  float x = fract( az * 160.0 );
  float fil = smoothstep( 0.3, 0.5, x ) * ( 1.0 - smoothstep( 0.5, 0.7, x ) );
  float t = fract( h * 2.2 + uTemps * ( 0.05 + 0.08 * r1 ) + r1 * 7.0 );
  float goutte = pow( t, 9.0 ) * step( 0.55, r1 );
  c += uNuages * 0.9 * goutte * fil * smoothstep( 0.06, 0.3, h ) * ( 1.0 - smoothstep( 0.7, 1.0, h ) );
  // bandes de glitch basses (à la place des nuages)
  float bande = floor( h * 70.0 );
  float hb = h21( vec2( bande, floor( uTemps * 1.5 ) ) );
  float seg = step( 0.72, h21( vec2( floor( az * 40.0 + hb * 13.0 ), bande ) ) );
  c += uHalo * 0.22 * step( 0.9, hb ) * seg * smoothstep( 0.02, 0.05, h ) * ( 1.0 - smoothstep( 0.14, 0.24, h ) );
  // noyau de l'AGI : halo, anneaux qui pulsent, lentille rouge, cœur clair
  c += uHalo * ( pow( s, 9.0 ) * ( 0.16 + 0.3 * pres ) + pow( s, 60.0 ) * 1.0 ); // halo serré : le logo rouge reste lisible
  float a = acos( clamp( dot( d, uSun ), -1.0, 1.0 ) ) / 0.03; // rayon de la lentille ≈ 1,7°
  float pulse = 0.75 + 0.25 * sin( uTemps * 1.7 );
  for ( int k = 0; k < 3; k ++ ) {
    float rr = 1.7 + float( k ) * 0.9 + fract( uTemps * 0.12 ) * 0.9;
    c += uHalo * ( 1.0 - smoothstep( 0.0, 0.07, abs( a - rr ) ) ) * 0.5 * pulse * ( 1.0 - float( k ) / 3.0 );
  }
  float lentille = 1.0 - smoothstep( 0.92, 1.0, a );
  c = mix( c, uHalo * 5.0 * pulse, lentille );
  c = mix( c, uSoleil * 14.0, 1.0 - smoothstep( 0.22, 0.38, a ) );
  gl_FragColor = vec4( c, 1.0 );
}`;

// Branche look-cel (15/11) : ciel carte mère PIXELISÉ — « grille cybernétique » demandée par Femz. Le dôme est découpé
// en cellules carrées (angle uPix.x en radians, en azimut comme en élévation : des carrés à l'écran) ; tout se calcule
// au CENTRE de la cellule (dégradé, noyau de l'AGI, halo) : des aplats nets, comme une matrice de LED. Joint sombre entre
// les cellules (uPix.y, part de la cellule), grille de données faite de cellules allumées toutes les uPix.z cellules,
// pluie de données qui descend cellule par cellule, cellules qui clignotent au hasard. Réglages : MENU.cielPixel.
const CIEL_FRAG_PIXEL = `uniform vec3 uHorizon; uniform vec3 uBas; uniform vec3 uMilieu; uniform vec3 uZenith; uniform vec3 uSoleil;
uniform vec3 uHalo; uniform vec3 uNuages; uniform vec3 uSun; uniform vec3 uBrume; uniform float uTemps; uniform vec4 uPix;
uniform vec4 uPix2; varying vec3 vDir;
float h21( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
void main() {
  vec3 d0 = normalize( vDir );
  vec2 q = vec2( atan( d0.x, - d0.z ), asin( clamp( d0.y, -1.0, 1.0 ) ) ) / uPix.x;
  vec2 cel = floor( q );
  vec2 fq = fract( q );
  vec2 qc = ( cel + 0.5 ) * uPix.x;
  vec3 d = vec3( sin( qc.x ) * cos( qc.y ), sin( qc.y ), - cos( qc.x ) * cos( qc.y ) ); // direction du centre de la cellule
  float e = d.y;
  float h = max( e, 0.0 );
  vec3 c = mix( uHorizon, uBas, smoothstep( 0.0, 0.08, h ) );
  c = mix( c, uMilieu, smoothstep( 0.06, 0.35, h ) );
  c = mix( c, uZenith, smoothstep( 0.3, 0.9, h ) );
  c = mix( uBrume, c, smoothstep( -0.005, 0.045, e ) );
  float s = max( dot( d, uSun ), 0.0 );
  float pres = 1.0 - smoothstep( 0.0, 0.35, h );
  float zone = smoothstep( 0.02, 0.12, h ) * ( 1.0 - smoothstep( 0.6, 0.95, h ) );
  // grille de données : une rangée / une colonne de cellules allumées toutes les uPix.z cellules
  float gx = step( mod( cel.x, uPix.z ), 0.5 );
  float gy = step( mod( cel.y, uPix.z ), 0.5 );
  c += uNuages * max( gx, gy ) * uPix2.x * zone;
  // pluie de données : par colonne, une tête claire qui descend d'une cellule à la fois, et sa traînée
  float r1 = h21( vec2( cel.x, 3.7 ) );
  float tete = floor( fract( uTemps * ( 0.04 + 0.06 * r1 ) + r1 * 7.0 ) * 140.0 );
  float dy = 140.0 - tete - mod( cel.y, 140.0 ); // cellules sous la tête (la pluie descend)
  float trainee = step( 0.0, - dy ) * ( 1.0 - smoothstep( 0.0, 9.0, - dy ) );
  float pluie = step( 0.62, r1 ) * ( step( abs( dy ), 0.5 ) * 1.6 + trainee * 0.6 );
  c += uNuages * uPix2.y * pluie * zone;
  // cellules qui clignotent au hasard (données qui passent)
  float clic = step( 0.992, h21( cel + floor( uTemps * 3.0 ) * 0.37 ) );
  c += uHalo * uPix2.z * clic * zone;
  // noyau de l'AGI : halo, anneaux qui pulsent, lentille rouge, cœur clair — en cellules
  c += uHalo * ( pow( s, 9.0 ) * ( 0.16 + 0.3 * pres ) + pow( s, 60.0 ) * 1.0 );
  float a = acos( clamp( dot( d, uSun ), -1.0, 1.0 ) ) / 0.03;
  float pulse = 0.75 + 0.25 * sin( uTemps * 1.7 );
  for ( int k = 0; k < 3; k ++ ) {
    float rr = 1.7 + float( k ) * 0.9 + fract( uTemps * 0.12 ) * 0.9;
    c += uHalo * step( abs( a - rr ), 0.2 ) * 0.5 * pulse * ( 1.0 - float( k ) / 3.0 );
  }
  c = mix( c, uHalo * 5.0 * pulse, step( a, 1.0 ) );
  c = mix( c, uSoleil * 14.0, step( a, 0.32 ) );
  // joint sombre entre les cellules : la matrice
  vec2 j = step( vec2( uPix.y ), fq ) * step( fq, vec2( 1.0 - uPix.y ) );
  c *= mix( uPix.w, 1.0, j.x * j.y );
  gl_FragColor = vec4( c, 1.0 );
}`;

/** Direction VERS le soleil (azimut 180° = droit derrière les boss, vers −Z). */
export function directionSoleil(out) {
  const az = L.soleil.azimutDeg * DEG + ORIENTATION;
  const el = L.soleil.elevationDeg * DEG;
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  return out;
}

/** Grille de hauteur du promontoire (lancer de rayons, une fois). */
function grilleHauteur(mesh, demi, N) {
  const ray = new THREE.Raycaster();
  const h = new Float32Array((N + 1) * (N + 1)).fill(-1e3);
  const o = new THREE.Vector3();
  const bas = new THREE.Vector3(0, -1, 0);
  mesh.updateMatrixWorld(true);
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      o.set(-demi + (2 * demi * i) / N + mesh.position.x, 50, -demi + (2 * demi * j) / N + mesh.position.z);
      ray.set(o, bas);
      const hit = ray.intersectObject(mesh, false);
      if (hit.length) h[j * (N + 1) + i] = hit[0].point.y;
    }
  return h;
}

/**
 * Surface EXACTE du dessus d'un maillage dans le carré [cx ± demi] × [cz ± demi] (monde) : ses triangles tournés vers le
 * haut sont rangés par cases de `cellule` m (init) ; la requête teste les triangles de la case (barycentres) et rend la
 * hauteur la plus haute, ou −1e9 hors du carré ou sans triangle. Aucune allocation par requête.
 */
function surfaceExacte(mesh, cx, cz, demi, cellule) {
  const N = Math.max(1, Math.ceil((2 * demi) / cellule));
  const g = mesh.geometry;
  const p = g.attributes.position;
  const idx = g.index;
  const nt = idx ? idx.count / 3 : p.count / 3;
  mesh.updateMatrixWorld(true);
  const m = mesh.matrixWorld;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const tris = [];
  const cases = Array.from({ length: N * N }, () => []);
  const x0 = cx - demi;
  const z0 = cz - demi;
  for (let t = 0; t < nt; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(p, i0).applyMatrix4(m);
    b.fromBufferAttribute(p, i1).applyMatrix4(m);
    c.fromBufferAttribute(p, i2).applyMatrix4(m);
    // normale (sens indifférent) : on garde les faces assez horizontales pour porter un pied
    const ux = b.x - a.x, uz = b.z - a.z, vx = c.x - a.x, vz = c.z - a.z;
    const ny = uz * vx - ux * vz;
    if (Math.abs(ny) < 1e-9) continue;
    const xmin = Math.min(a.x, b.x, c.x), xmax = Math.max(a.x, b.x, c.x);
    const zmin = Math.min(a.z, b.z, c.z), zmax = Math.max(a.z, b.z, c.z);
    if (xmax < x0 || zmax < z0 || xmin > cx + demi || zmin > cz + demi) continue;
    const k = tris.length / 9;
    tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const i1c = Math.max(0, Math.floor((xmin - x0) / cellule)), i2c = Math.min(N - 1, Math.floor((xmax - x0) / cellule));
    const j1c = Math.max(0, Math.floor((zmin - z0) / cellule)), j2c = Math.min(N - 1, Math.floor((zmax - z0) / cellule));
    for (let j = j1c; j <= j2c; j++) for (let i = i1c; i <= i2c; i++) cases[j * N + i].push(k);
  }
  const T = new Float64Array(tris);
  const debut = new Int32Array(N * N + 1);
  let n = 0;
  for (let q = 0; q < N * N; q++) {
    debut[q] = n;
    n += cases[q].length;
  }
  debut[N * N] = n;
  const liste = new Int32Array(n);
  for (let q = 0; q < N * N; q++) liste.set(cases[q], debut[q]);
  return function hauteur(x, z) {
    const i = Math.floor((x - x0) / cellule);
    const j = Math.floor((z - z0) / cellule);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1e9;
    let best = -1e9;
    const q = j * N + i;
    for (let r = debut[q]; r < debut[q + 1]; r++) {
      const o = liste[r] * 9;
      const ax = T[o], az = T[o + 2];
      const e1x = T[o + 3] - ax, e1z = T[o + 5] - az;
      const e2x = T[o + 6] - ax, e2z = T[o + 8] - az;
      const d = e1x * e2z - e2x * e1z;
      const px = x - ax, pz = z - az;
      const u = (px * e2z - e2x * pz) / d;
      const v = (e1x * pz - px * e1z) / d;
      if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
      const y = T[o + 1] + u * (T[o + 4] - T[o + 1]) + v * (T[o + 7] - T[o + 1]);
      if (y > best) best = y;
    }
    return best;
  };
}

export async function creerDecor({ scene, base }) {
  const tex = [];
  const geos = [];
  const mats = [];
  const garder = (m) => {
    geos.push(m.geometry);
    mats.push(m.material);
    return m;
  };
  // ----- brouillard, lumières
  // carte mère : brume plus légère (la carte et la ligne d'horizon de composants doivent se lire), rebond du sol vert
  scene.fog = new THREE.FogExp2(L.brouillard.couleur, L.brouillard.densite * (CM ? 0.55 : 1));
  const soleil = new THREE.DirectionalLight(L.soleil.couleur, L.soleil.intensite);
  const dir = directionSoleil(new THREE.Vector3());
  soleil.position.copy(dir).multiplyScalar(40);
  soleil.target.position.set(0, 0, 0);
  soleil.castShadow = true;
  soleil.shadow.mapSize.set(2048, 2048);
  const sc = soleil.shadow.camera;
  sc.left = -9;
  sc.right = 9;
  sc.top = 9;
  sc.bottom = -9;
  sc.near = 1;
  sc.far = 90;
  soleil.shadow.bias = -0.0004;
  soleil.shadow.normalBias = 0.03;
  scene.add(soleil, soleil.target);
  const ciel = new THREE.HemisphereLight(L.ciel.couleur, CM ? 0x2c4a36 : L.ciel.sol, L.ciel.intensite);
  scene.add(ciel);
  const rim = new THREE.PointLight(L.rimCyan.couleur, L.rimCyan.intensite, L.rimCyan.distance, 2);
  const fill = new THREE.PointLight(L.remplissage.couleur, L.remplissage.intensite, L.remplissage.distance, 2);
  scene.add(rim, fill);
  // 15/11 (Femz : « un vrai spotlight ») : un VRAI SpotLight au-dessus du héros, devant lui (le matériau peint le prend
  // en compte depuis le 15/11 : materiaux.js, FRAG_LIGHTS, NUM_SPOT_LIGHTS), sans ombre ; plus un cône de lumière très
  // léger qui descend sur lui (additif) et, si flaque > 0, une flaque dessinée. Réglages : MENU.lumiere.projecteur.
  const SP = L.projecteur || null;
  let flaque = null;
  let cone = null;
  const spot = SP ? new THREE.SpotLight(SP.couleur, SP.intensite, SP.distance, SP.angle, SP.penombre, 2) : null;
  if (spot) scene.add(spot, spot.target);
  if (SP) {
    const couleur = { value: new THREE.Color(SP.couleur) };
    const gFlaque = new THREE.PlaneGeometry(SP.rayon * 2, SP.rayon * 2);
    gFlaque.rotateX(-Math.PI / 2);
    const mFlaque = new THREE.ShaderMaterial({
      uniforms: { uCouleur: couleur, uForce: { value: SP.flaque } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 uCouleur; uniform float uForce; varying vec2 vUv;' +
        'void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(1.0 - smoothstep(0.0, 1.0, d), 2.0) * uForce;' +
        ' gl_FragColor = vec4(uCouleur * a, 1.0); }',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    flaque = SP.flaque > 0 ? new THREE.Mesh(gFlaque, mFlaque) : null;
    if (flaque) flaque.renderOrder = 2;
    const gCone = new THREE.ConeGeometry(SP.rayon * 0.95, SP.hauteur, 48, 1, true);
    const mCone = new THREE.ShaderMaterial({
      uniforms: { uCouleur: couleur, uForce: { value: SP.cone } },
      vertexShader:
        'varying float vH; varying vec3 vN; varying vec3 vV;' +
        'void main(){ vH = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0);' +
        ' vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader:
        'uniform vec3 uCouleur; uniform float uForce; varying float vH; varying vec3 vN; varying vec3 vV;' +
        'void main(){ float bord = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);' +
        ' float a = bord * (0.25 + 0.75 * vH) * smoothstep(0.0, 0.25, vH) * uForce; gl_FragColor = vec4(uCouleur * a, 1.0); }',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    cone = new THREE.Mesh(gCone, mCone);
    cone.renderOrder = 3;
    geos.push(gFlaque, gCone);
    mats.push(mFlaque, mCone);
    if (flaque) scene.add(flaque);
    scene.add(cone);
  }

  // ----- ciel (dôme centré sur la caméra, dessiné à l'infini)
  const C = MENU.ciel;
  const qp = new URLSearchParams(location.search).get('cielpix');
  const PIX = MENU.cielPixel.variantes[qp === null ? MENU.cielPixel.actif : Number(qp) | 0] || null;
  const lin = (hex) => new THREE.Color(hex);
  const cielMat = new THREE.ShaderMaterial({
    uniforms: {
      uHorizon: { value: lin(C.horizon) },
      uBas: { value: lin(C.bas) },
      uMilieu: { value: lin(C.milieu) },
      uZenith: { value: lin(C.zenith) },
      uSoleil: { value: lin(C.soleil) },
      uHalo: { value: lin(C.halo) },
      uNuages: { value: lin(C.nuages) },
      uSun: { value: dir.clone() },
      uBrume: { value: lin(L.brouillard.couleur) },
      uTemps: { value: 0 },
      // look-cel : ciel pixelisé (MENU.cielPixel ; ?cielpix=N l'emporte, 0 = ciel d'origine)
      uPix: { value: new THREE.Vector4(PIX ? PIX.taille : 0.01, PIX ? PIX.joint : 0, PIX ? PIX.grille : 8, PIX ? PIX.jointNoir : 1) },
      uPix2: { value: new THREE.Vector4(PIX ? PIX.grilleForce : 0, PIX ? PIX.pluie : 0, PIX ? PIX.clignote : 0, 0) },
    },
    vertexShader: CIEL_VERT,
    fragmentShader: CM ? (PIX ? CIEL_FRAG_PIXEL : CIEL_FRAG_CARTE) : CIEL_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const cielMesh = garder(new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), cielMat));
  cielMesh.name = 'menu-ciel';
  cielMesh.renderOrder = -10;
  cielMesh.frustumCulled = false;
  scene.add(cielMesh);

  // ----- dunes (désert) ou carte (shader de circuit du jeu, profil 'sol'). uSrQual.w = demi-côté de « l'arène » du
  // shader : au-delà, les faisceaux d'ALIMENTATION et leurs impulsions (comme derrière les murs du jeu). Ici 18 m : la
  // carte proche reste verte, et au loin — la bande de sol que voit la caméra basse — les pistes dorées convergent vers
  // le condensateur du héros. uSrNuage = horloge des impulsions, propre au menu (avancée par update).
  let matSol = createPaintedMaterial({ profil: 'decor' });
  const horlogeSol = new THREE.Vector2(0, 0);
  if (CM) {
    matSol = createPaintedMaterial({ profil: 'sol' });
    const qual = uniformsPeints.uSrQual.value.clone().setW(18);
    const avant = matSol.onBeforeCompile;
    matSol.onBeforeCompile = (shader, r) => {
      avant(shader, r);
      shader.uniforms.uSrQual = { value: qual };
      shader.uniforms.uSrNuage = { value: horlogeSol };
      shader.uniforms.uSrHalo = { value: new THREE.Vector4(0, 0, 1, 0) }; // pas de halo du jeu sur l'écran titre
      shader.uniforms.uSrHaloLoin = { value: 1 };
    };
  }
  const sol = garder(new THREE.Mesh(terrain(), matSol));
  sol.name = 'menu-sol';
  sol.receiveShadow = true;
  scene.add(sol);

  // ----- promontoire : le gros rocher du jeu (carte mère : le condensateur), agrandi ; son sommet est amené à l'origine
  const roc = CM
    ? await chargerGeometrie(base + DECOR + 'composant-condensateur.glb', { sonder: false })
    : await chargerGeometrie(base + DECOR + 'decor-rochers.glb', { noeud: 'rocher-11', sonder: false });
  if (!roc) throw new Error('promontoire introuvable');
  const matRoc = createPaintedMaterial({ profil: 'decor', textures: roc.textures });
  const rocher = new THREE.Mesh(roc.geometry, matRoc);
  geos.push(roc.geometry);
  mats.push(matRoc);
  if (roc.textures) for (const t of [roc.textures.map, roc.textures.normalMap, roc.textures.aoMap]) if (t) tex.push(t);
  rocher.name = 'menu-promontoire';
  // condensateur : 1,58 m × 3,4 = 5,4 m, la hauteur du rocher (2,45 m × 2,15 × 1,12) ; bande de polarité vers la caméra
  const ECH = CM ? 3.4 : 2.15;
  rocher.scale.set(ECH, CM ? ECH : ECH * 1.12, ECH);
  rocher.rotation.y = CM ? ORIENTATION + Math.PI / 2 : 0.6; // bande de polarité (−X local) tournée vers +Z du plan (caméra)
  rocher.castShadow = true;
  rocher.receiveShadow = true;
  scene.add(rocher);
  // sommet : point le plus haut près du centre → placé sous les pieds du héros (0, 0)
  rocher.position.set(0, hauteurSol(0, 0) - 0.15, 0);
  rocher.updateMatrixWorld(true);
  let g0 = grilleHauteur(rocher, 5, 40);
  // (la grille de recherche est centrée sur le rocher, en x et z du monde)
  let best = -1e3;
  let bx = 0;
  let bz = 0;
  for (let j = 0; j <= 40; j++)
    for (let i = 0; i <= 40; i++) {
      const x = -5 + (10 * i) / 40;
      const z = -5 + (10 * j) / 40;
      const hh = g0[j * 41 + i];
      // le plus haut, en préférant un endroit large (moyenne du voisinage) près du centre
      if (hh < -100) continue;
      let s = 0;
      let k = 0;
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii > 40 || jj > 40) continue;
          s += g0[jj * 41 + ii];
          k++;
        }
      const score = s / k - 0.04 * Math.hypot(x, z);
      if (score > best) {
        best = score;
        bx = x;
        bz = z;
      }
    }
  rocher.position.x -= bx;
  rocher.position.z -= bz;
  rocher.updateMatrixWorld(true);
  const DEMI = 8;
  const NG = 72;
  const grille = grilleHauteur(rocher, DEMI, NG);
  const rx = rocher.position.x;
  const rz = rocher.position.z;
  const exacte = surfaceExacte(rocher, MENU.heros.position[0], MENU.heros.position[1], MENU.heros.solExact, 0.05);
  /**
   * Hauteur du sol sous (x, z) : le promontoire s'il est là, sinon les dunes. Autour du héros (MENU.heros.solExact) : la
   * VRAIE surface du rocher (ses triangles) — la grille de 22 cm, interpolée, lisse les bosses de la roche de près d'un
   * centimètre (contrôle du 14/11 : orteils du genou au sol enfoncés de 8 à 12 mm alors que la grille les disait à 0,8).
   */
  function solY(x, z) {
    const he = exacte(x, z);
    if (he > -1e3) return Math.max(hauteurSol(x, z), he);
    const hs = hauteurSol(x, z);
    const fx = ((x - rx + DEMI) / (2 * DEMI)) * NG;
    const fz = ((z - rz + DEMI) / (2 * DEMI)) * NG;
    if (fx < 0 || fz < 0 || fx >= NG || fz >= NG) return hs;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const w = fz - j;
    const a = grille[j * (NG + 1) + i];
    const b = grille[j * (NG + 1) + i + 1];
    const c = grille[(j + 1) * (NG + 1) + i];
    const d = grille[(j + 1) * (NG + 1) + i + 1];
    if (a < -100 || b < -100 || c < -100 || d < -100) return Math.max(hs, a, b, c, d);
    return Math.max(hs, a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w);
  }
  g0 = null;

  // rochers d'appoint au pied du promontoire, carcasses de robots (le combat a déjà eu lieu)
  const XZ = [0, 0];
  const poser = async (url, noeud, x0, z0, ech, rot, profil = 'decor') => {
    versMonde(x0, z0, XZ);
    const x = XZ[0];
    const z = XZ[1];
    // sonder: false (intégration, § Z octies) : fichiers requis par le plan, lus directement — la sonde HEAD finissait en
    // « requestfailed ERR_ABORTED » dans Chromium (falaise-*-v2, lues par le menu seul) ; un fichier absent fait échouer
    // la scène du menu (fond uni, message), jamais le jeu.
    const r = await chargerGeometrie(base + url, { noeud, sonder: false });
    if (!r) return null;
    const m = new THREE.Mesh(r.geometry, createPaintedMaterial({ profil, textures: r.textures }));
    geos.push(r.geometry);
    mats.push(m.material);
    if (r.textures) for (const t of [r.textures.map, r.textures.normalMap, r.textures.aoMap]) if (t && !tex.includes(t)) tex.push(t);
    m.scale.setScalar(ech);
    m.rotation.y = rot;
    m.position.set(x, hauteurSol(x, z) - 0.08 * ech, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  // carte mère : composants dans l'axe des pistes (le circuit est tracé dans les axes du MONDE) ; lacet = quarts de tour
  const Q = Math.PI / 2;
  const decorAutour = CM
    ? await Promise.all([
        poser(DECOR + 'composant-puce.glb', null, -3.6, -2.8, 1.25, 0),
        poser(DECOR + 'composant-bobine.glb', null, 3.9, 1.6, 1.3, Q),
        poser(DECOR + 'composant-condensateur.glb', null, -5.8, 3.2, 1.2, 2 * Q),
        poser(DECOR + 'carcasse-cm-3.glb', null, 6.5, 5.5, 1.1, 0.9),
        poser(DECOR + 'carcasse-cm-1.glb', null, -8.5, -6, 1.05, 2.4),
        poser(DECOR + 'carcasse-cm-4.glb', null, 9.5, -9, 1.1, -0.6),
        poser(DECOR + 'carcasse-cm-2.glb', null, -2.5, 8.5, 1.0, 3.6),
        poser(DECOR + 'composant-puce.glb', null, 14, -20, 2.6, Q),
        poser(DECOR + 'composant-bobine.glb', null, -20, -16, 2.8, 0),
        poser(DECOR + 'composant-condensateur.glb', null, 22, -34, 3.0, 3 * Q),
        poser(DECOR + 'composant-condensateur.glb', null, -30, -38, 2.6, Q),
        // mi-distance, côté droit (ciel dégagé) : rangée de barrettes de RAM géantes face à la caméra, condensateur
        poser(DECOR + 'composant-ram.glb', null, 14, -22, 2.2, ORIENTATION),
        poser(DECOR + 'composant-ram.glb', null, 15.5, -27, 2.2, ORIENTATION),
        poser(DECOR + 'composant-ram.glb', null, 17, -32, 2.2, ORIENTATION),
        poser(DECOR + 'composant-condensateur.glb', null, 9, -13, 2.2, 0),
      ])
    : await Promise.all([
    poser('assets/modeles/decor/decor-rochers.glb', 'rocher-9', -3.6, -2.8, 1.25, 2.1),
    poser('assets/modeles/decor/decor-rochers.glb', 'rocher-6', 3.9, 1.6, 1.3, 0.7),
    poser('assets/modeles/decor/decor-rochers.glb', 'rocher-2', -5.8, 3.2, 1.2, 1.4),
    poser('assets/modeles/decor/decor-carcasses.glb', 'carcasse-3', 6.5, 5.5, 1.1, 0.9),
    poser('assets/modeles/decor/decor-carcasses.glb', 'carcasse-1', -8.5, -6, 1.05, 2.4),
    poser('assets/modeles/decor/decor-carcasses.glb', 'carcasse-4', 9.5, -9, 1.1, -0.6),
    poser('assets/modeles/decor/decor-carcasses.glb', 'carcasse-2', -2.5, 8.5, 1.0, 3.6),
    poser('assets/modeles/decor/decor-rochers.glb', 'rocher-10', 14, -20, 2.4, 0.4),
    poser('assets/modeles/decor/decor-rochers.glb', 'rocher-12', -20, -16, 2.8, 1.9),
  ]);

  // mesas lointaines (falaises du jeu très agrandies), silhouettes dans la brume ; carte mère : ligne d'horizon de
  // composants géants (ventirads, murs RAM + dissipateur, condensateurs), mêmes emplacements, lacets en quarts de tour
  const mesas = CM
    ? await Promise.all([
        poser(DECOR + 'bordure-coin-mur.glb', null, -95, -210, 5.2, 0),
        poser(DECOR + 'composant-ram.glb', null, 70, -150, 9, ORIENTATION),
        poser(DECOR + 'composant-ram.glb', null, 78, -170, 9, ORIENTATION),
        poser(DECOR + 'composant-condensateur.glb', null, 150, -185, 18, Q),
        poser(DECOR + 'composant-condensateur.glb', null, -20, -150, 14, 0),
        poser(DECOR + 'composant-condensateur.glb', null, 0, -175, 17, Q),
        poser(DECOR + 'composant-condensateur.glb', null, 120, -160, 12, 0),
        poser(DECOR + 'composant-puce.glb', null, -150, -110, 9, 0),
        poser(DECOR + 'composant-condensateur.glb', null, 40, -80, 8, 0),
        poser(DECOR + 'composant-condensateur.glb', null, 48, -95, 11, Q),
        poser(DECOR + 'composant-condensateur.glb', null, 32, -100, 6, 2 * Q),
      ])
    : await Promise.all([
    poser('assets/modeles/decor/falaise-8-v2.glb', null, -95, -210, 4.2, 0.3),
    poser('assets/modeles/decor/falaise-9-v2.glb', null, 70, -240, 5.0, -0.5),
    poser('assets/modeles/decor/falaise-8-v2.glb', null, 190, -190, 3.4, 2.4),
    poser('assets/modeles/decor/falaise-9-v2.glb', null, -230, -150, 3.8, 1.2),
  ]);
  for (const m of mesas) if (m) (m.castShadow = false), (m.receiveShadow = false);
  // carte mère : le ventirad de l'horizon (mesas[0]) reçoit ses pales, qui tournent (même modèle que les coins du jeu)
  let heliceMenu = null;
  if (CM && mesas[0]) {
    const man = await (await fetch(base + DECOR + 'manifeste-carte-mere.json')).json();
    const coin = man.falaises.find((e) => e.variante === 'bordure-coin-mur');
    const h = await chargerGeometrie(base + DECOR + 'bordure-helice.glb', { sonder: false });
    if (coin && coin.helice && h) {
      heliceMenu = new THREE.Mesh(h.geometry, createPaintedMaterial({ profil: 'decor', textures: h.textures }));
      geos.push(h.geometry);
      mats.push(heliceMenu.material);
      heliceMenu.position.set(...coin.helice.centre);
      mesas[0].add(heliceMenu);
    }
  }

  // ----- voiles de brume au pied des boss (quads verticaux, dégradés, qui dérivent)
  const brumeMat = new THREE.ShaderMaterial({
    uniforms: { uCouleur: { value: lin(L.brouillard.couleur).multiplyScalar(1.15) }, uTemps: { value: 0 }, uForce: { value: CM ? 0.24 : 0.42 } },
    vertexShader: `varying vec2 vUv; varying float vGraine; attribute float aGraine;
      void main() { vUv = uv; vGraine = aGraine; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: `uniform vec3 uCouleur; uniform float uTemps; uniform float uForce; varying vec2 vUv; varying float vGraine;
      float h21( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
      float vn( vec2 p ) { vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( h21( i ), h21( i + vec2( 1, 0 ) ), u.x ), mix( h21( i + vec2( 0, 1 ) ), h21( i + vec2( 1, 1 ) ), u.x ), u.y ); }
      void main() {
        float bas = smoothstep( 0.0, 0.3, vUv.y ) * ( 1.0 - smoothstep( 0.35, 1.0, vUv.y ) );
        float cotes = smoothstep( 0.0, 0.3, vUv.x ) * ( 1.0 - smoothstep( 0.7, 1.0, vUv.x ) );
        float n = vn( vec2( vUv.x * 5.0 + uTemps * 0.05 + vGraine * 9.0, vUv.y * 2.0 ) ) * 0.6 + vn( vec2( vUv.x * 11.0 - uTemps * 0.08, vUv.y * 4.0 + vGraine ) ) * 0.4;
        float a = bas * cotes * ( 0.45 + 0.75 * n ) * uForce;
        gl_FragColor = vec4( uCouleur, a );
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const brumeGeo = new THREE.PlaneGeometry(1, 1);
  brumeGeo.translate(0, 0.5, 0);
  const VOILES = [
    [-14, -24, 46, 7],
    [12, -36, 56, 9],
    [-30, -50, 70, 12],
    [20, -62, 80, 14],
    [-6, -80, 110, 18],
  ];
  const graines = new Float32Array(VOILES.length);
  VOILES.forEach((_, i) => (graines[i] = i * 0.37));
  brumeGeo.setAttribute('aGraine', new THREE.InstancedBufferAttribute(graines, 1));
  const brume = new THREE.InstancedMesh(brumeGeo, brumeMat, VOILES.length);
  brume.name = 'menu-brume';
  brume.frustumCulled = false;
  brume.renderOrder = 3;
  const mm = new THREE.Matrix4();
  VOILES.forEach(([x, z, w, h], i) => {
    versMonde(x, z, XZ);
    mm.compose(new THREE.Vector3(XZ[0], hauteurSol(XZ[0], XZ[1]) - 0.6, XZ[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ORIENTATION), new THREE.Vector3(w, h, 1));
    brume.setMatrixAt(i, mm);
  });
  geos.push(brumeGeo);
  mats.push(brumeMat);
  scene.add(brume);

  // ----- lueur du soleil devant tout (voile de contre-jour sur les silhouettes) : sprite additif sans profondeur
  const lueurMat = new THREE.ShaderMaterial({
    uniforms: { uCouleur: { value: lin(C.halo).multiplyScalar(CM ? 0.07 : 0.16) } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ); mv.xy += position.xy * 900.0; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uCouleur; varying vec2 vUv; void main() { float r = length( vUv - 0.5 ) * 2.0; float a = exp( - r * r * 22.0 ) + 0.18 * exp( - r * r * 5.0 ); gl_FragColor = vec4( uCouleur * a, 1.0 ); }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const lueur = garder(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), lueurMat));
  lueur.name = 'menu-lueur-soleil';
  lueur.renderOrder = 20;
  lueur.frustumCulled = false;
  scene.add(lueur);

  const v = new THREE.Vector3();
  function update(t, camera, heros) {
    cielMesh.position.copy(camera.position);
    cielMat.uniforms.uTemps.value = t;
    if (heliceMenu) heliceMenu.rotation.y = t * PEINT.carte.helices.vitesse;
    horlogeSol.x = t * PEINT.nuages.vitesse[0]; // même horloge que world.update : impulsions à la vitesse du jeu
    brumeMat.uniforms.uTemps.value = t;
    lueur.position.copy(camera.position).addScaledVector(dir, 1400);
    // lumières qui suivent le héros : liseré cyan derrière lui, remplissage côté caméra (bas, chaud)
    const p = L.rimCyan.position;
    rim.position.set(heros[0] + p[0], heros[1] + p[1], heros[2] + p[2]);
    v.copy(camera.position).sub(rim.position);
    const f = L.remplissage.position;
    fill.position.set(heros[0] + f[0], heros[1] + f[1], heros[2] + f[2]);
    if (spot) {
      const sp = SP.position;
      spot.position.set(heros[0] + sp[0], heros[1] + sp[1], heros[2] + sp[2]);
      spot.target.position.set(heros[0], heros[1] + SP.viseeY, heros[2]);
    }
    if (flaque) flaque.position.set(heros[0], heros[1] + 0.03, heros[2]);
    if (cone) cone.position.set(heros[0], heros[1] + SP.hauteur / 2, heros[2]);
    soleil.target.position.set(heros[0], heros[1], heros[2]);
    soleil.position.copy(dir).multiplyScalar(40).add(soleil.target.position);
  }

  function liberer() {
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    for (const t of tex) t.dispose();
    soleil.shadow.map?.dispose();
    scene.fog = null;
  }

  void decorAutour;
  return { solY, update, liberer, soleil, dirSoleil: dir, rocher };
}
