// ÉTAPE 5, CHANTIER B — dôme hexagonal du Pare-feu (objet passif 'shield'). Demande de Femz du 17/11 : « le shield
// pare-feu qui bloque les dégâts devrait plus avoir ce look in game dans son animation » (réfs : dôme d'énergie en
// alvéoles hexagonales, Fresnel sur le contour, anneau et disque lumineux au sol ; variante cyan → violet).
// Réglages : config.js, région e5:B-parefeu (PAREFEU_DOME). Contrat : ARCHITECTURE.md § E5.B.
//
// RENDU : UN maillage (« dome-parefeu »), UNE géométrie indexée construite une fois à l'init :
//   • les alvéoles = le dual d'un icosaèdre subdivisé (polyèdre de Goldberg : hexagones + quelques pentagones), coupé à
//     l'équateur ; chaque alvéole est un éventail plat (centre e = 0, bord e = 1 : e interpolé = distance hexagonale,
//     d'où l'arête lumineuse sans texture) ; elle porte son centre, un hasard et son rang de reconstruction ;
//   • l'anneau au sol (arcs) et le disque au sol, dans la même géométrie (attribut « genre »).
// Matériau : ShaderMaterial additif, sans écriture de profondeur, deux faces (le fond du dôme se voit à travers),
// Fresnel PAR ALVÉOLE (normale de l'ellipsoïde au centre de l'alvéole : chaque alvéole a un ton uni, lisible une fois
// pixelisée). Tout est animé par 7 uniformes vec4 / vec3 : aucune allocation par image (champs « double » dès la
// création, envois par rendu/uniformes.js), aucun flottant passé en argument (§ V).
// Coût : 1 appel de dessin quand le héros a le Pare-feu, 0 sinon (maillage caché) ; aucune ombre portée.
//
// ÉTATS (lus chaque image dans items.lireParefeu : recharge restante, durée, coups arrêtés, piles) :
//   prêt       : dôme discret qui respire, bande de lumière qui monte, Fresnel sur le bord, anneau au sol ;
//   coup arrêté: flash, onde d'alvéoles depuis le point d'impact (source du coup : damage.SOURCE_JOUEUR), une part des
//                alvéoles se détache et s'envole, les autres s'éteignent derrière l'onde ;
//   recharge   : dôme absent (arc faible au sol = jauge de la recharge), puis il se reconstruit alvéole par alvéole
//                pendant la fin de la recharge (du sol vers le haut, avec du hasard) ; pouls de l'anneau quand il est prêt.
// Aucune règle de jeu ici : le Pare-feu est entièrement dans items.js (inchangé, sauf ses ondes VISUELLES d'origine,
// remplacées par le dôme quand PAREFEU_DOME.actif).
import * as THREE from 'three';
import { PAREFEU_DOME } from '../config.js';
import { P } from '../state.js';
import { H } from './projectiles.js';

const D = PAREFEU_DOME;

// ----- État (tableaux typés : aucun flottant dans un « let » de module, § V) ------------------------------------------
const PF = new Float64Array(4); // items.lireParefeu : [0] recharge restante (s), [1] recharge complète (s), [2] coups arrêtés, [3] piles
const T = new Float64Array(8);
const T_COUP = 0; // horloge du dernier coup arrêté
const T_PRET = 1; // horloge du dernier retour à « prêt »
const T_BLOCS = 2; // coups arrêtés déjà vus
const T_RESTE = 3; // recharge restante à l'image précédente
const T_IX = 4; // direction de l'impact candidate (sphère unité), recalculée à chaque image
const T_IY = 5;
const T_IZ = 6;
let mesh = null;
let mat = null;
let items = null;
let damage = null;
let camera = null;
let variante = 'a';
let vues = 0; // images où le dôme a été dessiné (mesure)
let coups = 0; // coups arrêtés vus par le dôme (mesure)

// uniformes (champs « double » dès la création : les écrire chaque image n'alloue pas)
const U = {
  uForme: { value: new THREE.Vector4(1.5, 2.5, 0.5, 1.5) }, // x rayon (m), y hauteur (m), z écart entre alvéoles, w échelle (respiration)
  uEtat: { value: new THREE.Vector4(0.5, 9.5, 2.5, 0.5) }, // x horloge (s), y âge du coup (s), z progression de reconstruction (≥ 1 : complet), w jauge 0..1
  uImpact: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) }, // xyz direction du coup (sphère unité), w durée de reconstruction (s)
  uCoup: { value: new THREE.Vector4(9.5, 0.5, 0.5, 2.5) }, // x vitesse de l'onde (rad/s), y largeur (rad), z part détachée, w vitesse de détachement (m/s)
  uLook: { value: new THREE.Vector4(0.5, 2.5, 0.5, 0.5) }, // x intensité, y puissance du Fresnel, z arêtes, w dégradé bas → haut
  uLook2: { value: new THREE.Vector4(1.5, 0.5, 0.5, 0.5) }, // x respiration × flash, y bande (élévation), z anneau, w disque
  uLook3: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) }, // x lueur de l'onde, y flash des alvéoles, z flash de l'anneau, w bas du dôme
  uBas: { value: new THREE.Color(0x2fc4ff) },
  uHaut: { value: new THREE.Color(0x2fc4ff) },
  uBord: { value: new THREE.Color(0xbaf3ff) },
  uFlash: { value: new THREE.Color(0xe6fbff) },
};

const VERT = /* glsl */ `
attribute vec4 aC; // xyz centre de l'alvéole (sphère unité) ; w : e (0 centre → 1 bord) — anneau / disque : coordonnée radiale
attribute vec4 aD; // x hasard, y rang de reconstruction, z genre (0 alvéole, 1 anneau, 2 disque), w angle 0..1 (anneau)
uniform vec4 uForme; uniform vec4 uEtat; uniform vec4 uImpact; uniform vec4 uCoup; uniform vec4 uLook3;
varying vec4 vA; // x e, y Fresnel, z visibilité, w lueur (onde, pop)
varying vec4 vB; // x élévation 0..1, y hasard, z genre, w angle (anneau)
void main() {
  float genre = aD.z;
  vec3 p;
  vA = vec4( aC.w, 0.0, 1.0, 0.0 );
  vB = vec4( 0.0, aD.x, genre, aD.w );
  if ( genre < 0.5 ) {
    vec3 c = aC.xyz;
    float rnd = aD.x;
    float rang = aD.y;
    float age = uEtat.y;
    // --- coup arrêté : onde depuis l'impact, alvéoles qui s'éteignent ou se détachent derrière elle
    float visCoup = 0.0;
    float lueur = 0.0;
    float sortie = 0.0;
    if ( age < 1.2 ) {
      float ang = acos( clamp( dot( normalize( c ), uImpact.xyz ), -1.0, 1.0 ) );
      float depuis = age - ang / uCoup.x; // s depuis le passage de l'onde sur cette alvéole
      float d = ( ang - age * uCoup.x ) / uCoup.y;
      lueur = uLook3.x * exp( -d * d ) + uLook3.y * exp( -age / 0.07 );
      float detache = step( rnd, uCoup.z * ( 1.0 - smoothstep( 1.0, 1.8, ang ) ) );
      float tenue = 0.05 + 0.1 * rnd;
      visCoup = depuis < 0.0 ? 1.0 : ( detache > 0.5 ? 1.0 - smoothstep( 0.0, 0.4, depuis ) : 1.0 - smoothstep( tenue, tenue + 0.16, depuis ) );
      sortie = detache * max( depuis, 0.0 ) * uCoup.w * ( 0.6 + 0.8 * rnd );
    }
    // --- reconstruction : l'alvéole apparaît quand la progression passe son rang, avec un éclat bref
    float popAge = ( uEtat.z - rang ) * uImpact.w;
    float visRec = step( 0.0, popAge );
    // max( popAge, 0 ) : sans lui, exp( 125 ) déborde en infini, et infini × 0 = NaN — le bloom en fait une tache blanche
    float pop = visRec * exp( -max( popAge, 0.0 ) / 0.09 ) * step( uEtat.z, 1.5 );
    float entree = visRec > 0.5 && uEtat.z < 1.5 ? 0.55 + 0.45 * smoothstep( 0.0, 0.12, popAge ) : 1.0;
    vA.z = max( visRec, visCoup );
    vA.w = max( lueur * step( 0.001, visCoup ), 0.0 ) + pop;
    // alvéole plate, rétrécie vers son centre (écart), qui s'envole le long de sa normale si elle se détache
    float s = ( 1.0 - uForme.z ) * ( visRec > 0.5 ? entree : 1.0 ) * ( 1.0 - 0.35 * min( sortie, 1.0 ) );
    vec3 q = c + ( position - c ) * s;
    vec3 n = normalize( vec3( c.x / uForme.x, c.y / uForme.y, c.z / uForme.x ) );
    p = q * vec3( uForme.x, uForme.y, uForme.x ) * uForme.w + n * sortie;
    vec3 nv = normalize( normalMatrix * n );
    vA.y = 1.0 - abs( nv.z );
    vB.x = asin( clamp( c.y, 0.0, 1.0 ) ) * 0.63662;
  } else {
    p = vec3( position.x * uForme.x, 0.03 + 0.01 * genre, position.z * uForme.x );
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}`;

const FRAG = /* glsl */ `
uniform vec4 uEtat; uniform vec4 uLook; uniform vec4 uLook2; uniform vec4 uLook3;
uniform vec3 uBas; uniform vec3 uHaut; uniform vec3 uBord; uniform vec3 uFlash;
varying vec4 vA; varying vec4 vB;
void main() {
  float genre = vB.z;
  vec3 c;
  if ( genre < 0.5 ) {
    if ( vA.z < 0.004 ) discard;
    float elev = vB.x;
    float rnd = vB.y;
    float f = pow( vA.y, uLook.y );
    // dégradé : le bas et le contour (Fresnel) gardent la teinte du bas, le sommet et la face prennent celle du haut
    float g = clamp( elev * 1.25 + ( 1.0 - f ) * 0.45 + ( rnd - 0.5 ) * 0.6 - 0.2, 0.0, 1.0 ) * uLook.w;
    vec3 col = mix( uBas, uHaut, g );
    float base = uLook.x * ( 0.07 + 0.93 * f ) * ( 0.45 + 1.1 * rnd ); // ton propre à chaque alvéole : la mosaïque se lit pixelisée
    base += uLook3.w * ( 1.0 - smoothstep( 0.0, 0.2, elev ) ); // bas du dôme : le bord du sol s'allume
    float bd = ( elev - uLook2.y ) / 0.09;
    base += 0.55 * uLook.x * exp( -bd * bd ); // bande de lumière qui monte (prêt)
    float arete = smoothstep( 0.66, 0.96, vA.x );
    c = col * base * uLook2.x;
    c += mix( col, uBord, 0.55 ) * arete * uLook.z * ( 0.3 + 0.7 * f ) * uLook2.x;
    c += mix( col, uFlash, 0.6 ) * vA.w * ( 0.35 + 0.65 * arete );
    c *= vA.z;
  } else if ( genre < 1.5 ) {
    // anneau au sol : trois longs arcs qui tournent lentement ; pendant la recharge, un arc faible = la jauge
    float r = vA.x;
    float bande = 1.0 - abs( r * 2.0 - 1.0 );
    bande = bande * bande;
    float a = vB.w;
    float arcs = smoothstep( 0.0, 0.03, fract( a * 3.0 + uEtat.x * 0.04 ) ) * ( 1.0 - smoothstep( 0.8, 0.86, fract( a * 3.0 + uEtat.x * 0.04 ) ) );
    float jauge = step( fract( a + 0.25 ), uEtat.w );
    float pret = step( 1.5, uEtat.z );
    float k = mix( 0.35 * jauge, arcs, pret ) * uLook2.z + uLook3.z * ( 0.4 + 0.6 * arcs );
    c = mix( uBas, uBord, 0.35 ) * bande * k;
  } else {
    // disque au sol (réf. 14) : faible au centre, plus clair vers le bord ; seulement quand le dôme est prêt
    float r = vA.x;
    c = mix( uBas, uHaut, 0.5 * uLook.w ) * ( 0.25 + 0.75 * r * r ) * uLook2.w * step( 1.5, uEtat.z );
  }
  gl_FragColor = vec4( c, 1.0 );
}`;

// ----- Géométrie (init : allocations permises) --------------------------------------------------------------------
function hachage(n) {
  let x = (n * 0x27d4eb2d) | 0;
  x = (x ^ (x >>> 15)) | 0;
  x = Math.imul(x, 0x85ebca6b);
  x = (x ^ (x >>> 13)) | 0;
  x = Math.imul(x, 0xc2b2ae35);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

/**
 * Alvéoles : dual de l'icosaèdre subdivisé à la fréquence f (10 f² + 2 alvéoles sur la sphère, dont 12 pentagones),
 * un sommet de l'icosaèdre au pôle ; on garde celles dont le centre est au-dessus de yMin, et leurs coins sous le sol
 * sont ramenés à l'équateur. Rend { cells: [{ c: [x,y,z], coins: [[x,y,z]…] }] }.
 */
export function alveoles(f, yMin = -0.06) {
  const t = (1 + Math.sqrt(5)) / 2;
  const V0 = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const F0 = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // rotation autour de X : le sommet 5 (0, 1, t) au pôle
  const L = Math.sqrt(1 + t * t);
  const ca = 1 / L;
  const sa = -t / L;
  const rot = (v) => [v[0], v[1] * ca - v[2] * sa, v[1] * sa + v[2] * ca];
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const base = V0.map((v) => norm(rot(v)));
  const pts = [];
  const cle = new Map();
  const id = (v) => {
    const k = `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)},${Math.round(v[2] * 1e5)}`;
    let i = cle.get(k);
    if (i === undefined) {
      i = pts.length;
      pts.push(v);
      cle.set(k, i);
    }
    return i;
  };
  const tris = [];
  for (const [a, b, c] of F0) {
    const A = base[a];
    const B = base[b];
    const C = base[c];
    const P = (i, j) => id(norm([A[0] + ((B[0] - A[0]) * i + (C[0] - A[0]) * j) / f, A[1] + ((B[1] - A[1]) * i + (C[1] - A[1]) * j) / f, A[2] + ((B[2] - A[2]) * i + (C[2] - A[2]) * j) / f]));
    for (let i = 0; i < f; i++) {
      for (let j = 0; j < f - i; j++) {
        tris.push([P(i, j), P(i + 1, j), P(i, j + 1)]);
        if (i + j < f - 1) tris.push([P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]);
      }
    }
  }
  const autour = pts.map(() => []);
  const centres = tris.map(([a, b, c]) => norm([pts[a][0] + pts[b][0] + pts[c][0], pts[a][1] + pts[b][1] + pts[c][1], pts[a][2] + pts[b][2] + pts[c][2]]));
  tris.forEach((tr, k) => tr.forEach((i) => autour[i].push(k)));
  const sol = (v) => {
    if (v[1] >= 0) return v;
    const l = Math.hypot(v[0], v[2]) || 1;
    return [v[0] / l, 0, v[2] / l];
  };
  const cells = [];
  for (let i = 0; i < pts.length; i++) {
    const c = pts[i];
    if (c[1] < yMin) continue;
    // base tangente autour de c, coins triés par angle
    const up = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm([up[1] * c[2] - up[2] * c[1], up[2] * c[0] - up[0] * c[2], up[0] * c[1] - up[1] * c[0]]);
    const w = [c[1] * u[2] - c[2] * u[1], c[2] * u[0] - c[0] * u[2], c[0] * u[1] - c[1] * u[0]];
    const coins = autour[i].map((k) => centres[k]).sort((p, q) => Math.atan2(p[0] * w[0] + p[1] * w[1] + p[2] * w[2], p[0] * u[0] + p[1] * u[1] + p[2] * u[2]) - Math.atan2(q[0] * w[0] + q[1] * w[1] + q[2] * w[2], q[0] * u[0] + q[1] * u[1] + q[2] * u[2]));
    cells.push({ c: sol(c), coins: coins.map(sol) });
  }
  return { cells, total: pts.length };
}

function construire() {
  const { cells } = alveoles(D.forme.frequence);
  const NA = D.anneau.segments;
  const nV = cells.reduce((s, k) => s + 1 + k.coins.length, 0) + NA * 2 + 1 + NA;
  const pos = new Float32Array(nV * 3);
  const aC = new Float32Array(nV * 4);
  const aD = new Float32Array(nV * 4);
  const idx = [];
  let v = 0;
  const ecrire = (x, y, z, cx, cy, cz, e, rnd, rang, genre, ang) => {
    pos.set([x, y, z], v * 3);
    aC.set([cx, cy, cz, e], v * 4);
    aD.set([rnd, rang, genre, ang], v * 4);
    return v++;
  };
  cells.forEach((k, n) => {
    const rnd = hachage(n + 17);
    const elev = Math.asin(Math.max(0, Math.min(1, k.c[1]))) / (Math.PI / 2);
    // rang de reconstruction : du sol vers le haut, mélangé de hasard (« alvéole par alvéole »)
    const rang = Math.max(0, Math.min(0.999, D.reconstruction.solVersHaut * elev + (1 - D.reconstruction.solVersHaut) * hachage(n + 101)));
    const c0 = ecrire(k.c[0], k.c[1], k.c[2], k.c[0], k.c[1], k.c[2], 0, rnd, rang, 0, 0);
    const m = k.coins.length;
    for (let j = 0; j < m; j++) ecrire(k.coins[j][0], k.coins[j][1], k.coins[j][2], k.c[0], k.c[1], k.c[2], 1, rnd, rang, 0, 0);
    for (let j = 0; j < m; j++) idx.push(c0, c0 + 1 + j, c0 + 1 + ((j + 1) % m));
  });
  // anneau au sol : bande de D.anneau.de à D.anneau.a × rayon
  const r0 = D.anneau.de;
  const r1 = D.anneau.a;
  const a0 = v;
  for (let j = 0; j < NA; j++) {
    const a = (j / NA) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ecrire(c * r0, 0, s * r0, 0, 0, 0, 0, 0, 0, 1, j / NA);
    ecrire(c * r1, 0, s * r1, 0, 0, 0, 1, 0, 0, 1, j / NA);
  }
  for (let j = 0; j < NA; j++) {
    const i0 = a0 + j * 2;
    const i1 = a0 + ((j + 1) % NA) * 2;
    idx.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1);
  }
  // disque au sol
  const d0 = ecrire(0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0);
  for (let j = 0; j < NA; j++) {
    const a = (j / NA) * Math.PI * 2;
    ecrire(Math.cos(a), 0, Math.sin(a), 0, 0, 0, 1, 0, 0, 2, j / NA);
  }
  for (let j = 0; j < NA; j++) idx.push(d0, d0 + 1 + j, d0 + 1 + ((j + 1) % NA));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aC', new THREE.BufferAttribute(aC, 4));
  g.setAttribute('aD', new THREE.BufferAttribute(aD, 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  return { g, alveoles: cells.length, sommets: v, triangles: idx.length / 3 };
}

let infoGeo = null;

/** Variante de couleur : 'a' (cyan, réf. 13) ou 'b' (cyan → violet, réf. 14). Hors combat (réglage, debug). */
export function setVariante(k) {
  const c = D.variantes[k] ? k : 'a';
  variante = c;
  const V = D.variantes[c];
  U.uBas.value.setHex(V.bas);
  U.uHaut.value.setHex(V.haut);
  U.uBord.value.setHex(V.bord);
  U.uFlash.value.setHex(V.flash);
  U.uLook.value.w = V.melange + 0.0001; // jamais un entier : champ « double »
  return c;
}

export function init(context) {
  items = context.items;
  damage = context.damage;
  camera = context.camera;
  const geo = construire();
  infoGeo = geo;
  mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: U,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  mesh = new THREE.Mesh(geo.g, mat);
  mesh.name = 'dome-parefeu';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 3; // après les effets opaques ; additif : l'ordre ne change pas la couleur
  mesh.visible = false;
  context.scene.add(mesh);
  const q = new URLSearchParams(window.location.search).get('dome');
  setVariante(q === 'a' || q === 'b' ? q : D.variante);
  reset();
}

export function reset() {
  T[T_COUP] = -1e9;
  T[T_PRET] = -1e9;
  T[T_BLOCS] = 0;
  T[T_RESTE] = 0;
}

/**
 * F11 (après items.sync) : lit l'état du Pare-feu, pose le dôme sur le héros et écrit les uniformes. Aucun flottant
 * passé ni rendu ; aucune allocation.
 */
export function sync() {
  if (mesh === null) return;
  items.lireParefeu(PF);
  const clock = H[0];
  directionImpact();
  if (PF[2] !== T[T_BLOCS]) {
    if (PF[2] > T[T_BLOCS]) {
      // coup arrêté : l'onde part de la source de ce coup
      coups++;
      T[T_COUP] = clock;
      const u = U.uImpact.value;
      u.x = T[T_IX];
      u.y = T[T_IY];
      u.z = T[T_IZ];
    }
    T[T_BLOCS] = PF[2];
  }
  const reste = PF[0];
  if (T[T_RESTE] > 0 && reste <= 0) T[T_PRET] = clock;
  T[T_RESTE] = reste;
  if (!D.actif || PF[3] <= 0 || !P.alive) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  vues++;
  mesh.position.x = P.x;
  mesh.position.y = 0;
  mesh.position.z = P.z;
  const F = D.forme;
  const R = D.respiration;
  const C = D.coup;
  const K = D.look;
  let age = clock - T[T_COUP];
  if (age < 0) age = 9.5;
  let agePret = clock - T[T_PRET];
  if (agePret < 0) agePret = 9.5;
  const duree = PF[1] > 0 ? PF[1] : 1;
  let rec = D.reconstruction.duree;
  if (rec > duree * D.reconstruction.partMax) rec = duree * D.reconstruction.partMax;
  const souffle = Math.sin((clock * Math.PI * 2) / R.periode);
  const pouls = Math.exp(-agePret / D.reconstruction.pouls);
  const u0 = U.uForme.value;
  u0.x = F.rayon;
  u0.y = F.hauteur;
  u0.z = F.ecart;
  u0.w = 1 + R.echelle * souffle;
  const u1 = U.uEtat.value;
  u1.x = clock;
  u1.y = age;
  u1.z = reste > 0 ? 1 - reste / rec : 2;
  u1.w = reste > 0 ? 1 - reste / duree : 1;
  U.uImpact.value.w = rec;
  const u3 = U.uCoup.value;
  u3.x = C.vitesseOnde;
  u3.y = C.largeurOnde;
  u3.z = C.partDetachee;
  u3.w = C.vitesseDetache;
  const u4 = U.uLook.value;
  u4.x = K.intensite;
  u4.y = K.fresnel;
  u4.z = K.aretes;
  const flash = Math.exp(-age / C.flashDuree);
  const u5 = U.uLook2.value;
  u5.x = (1 + R.ampleur * souffle) * (1 + C.flashDome * flash) * (1 + D.reconstruction.poulsDome * pouls);
  u5.y = ((clock / R.bandePeriode) % 1) * 1.5 - 0.25;
  u5.z = K.anneau * (1 + D.reconstruction.poulsAnneau * pouls);
  u5.w = K.disque * (1 + D.reconstruction.poulsAnneau * pouls);
  const u6 = U.uLook3.value;
  u6.x = C.lueurOnde;
  u6.y = C.flashAlveoles;
  u6.z = K.anneau * C.flashAnneau * flash; // l'anneau s'allume au coup arrêté (le dôme vient de tomber)
  u6.w = K.basDuDome;
}

/**
 * Direction de l'impact sur la sphère unité, depuis la source du DERNIER coup reçu (damage.SOURCE_JOUEUR), écrite dans
 * T[T_IX..T_IZ]. Appelée à CHAQUE image par sync (fonction chaude, optimisée : aucun nombre emballé) ; au coup arrêté,
 * sync ne fait que recopier ces trois valeurs. Mesuré : la même chose faite seulement au coup arrêté, dans une fonction
 * appelée trois fois en 10 s (jamais optimisée), allouait ≈ 320 octets par coup.
 */
function directionImpact() {
  const S = damage.SOURCE_JOUEUR;
  let dx = S[0] - P.x;
  let dz = S[1] - P.z;
  let l = Math.sqrt(dx * dx + dz * dz);
  if (!(l > 1e-3)) {
    // source inconnue ou sur le héros (debug) : le côté tourné vers la caméra, pour que l'onde se voie
    const m = camera.threeCamera.matrixWorld.elements;
    dx = m[8];
    dz = m[10];
    l = Math.sqrt(dx * dx + dz * dz);
    if (!(l > 1e-6)) {
      dx = 0;
      dz = 1;
      l = 1;
    }
  }
  const h = D.coup.hauteurImpact;
  const n = l * Math.sqrt(1 + h * h);
  T[T_IX] = dx / n;
  T[T_IY] = (h * l) / n;
  T[T_IZ] = dz / n;
}

/** Mesures et tests (hors combat). */
export function inspect(out) {
  out.actif = D.actif;
  out.variante = variante;
  out.visible = mesh !== null && mesh.visible;
  out.vues = vues;
  out.coups = coups;
  out.alveoles = infoGeo ? infoGeo.alveoles : 0;
  out.sommets = infoGeo ? infoGeo.sommets : 0;
  out.triangles = infoGeo ? infoGeo.triangles : 0;
  out.etat = [U.uEtat.value.x, U.uEtat.value.y, U.uEtat.value.z, U.uEtat.value.w];
  out.impact = [U.uImpact.value.x, U.uImpact.value.y, U.uImpact.value.z];
  return out;
}
