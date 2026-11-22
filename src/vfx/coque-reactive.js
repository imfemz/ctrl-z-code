// ÉTAPE 5, CHANTIER H — visuel de la Coque réactive (objet passif 'reactive'). Retour de Femz du 17/11 : « Coque
// réactive : aucun visuel in game quand c'est actif, juste un SFX, on ne comprend pas. »
// Réglages : config.js, région e5:H-coque (COQUE_REACTIVE). Contrat : ARCHITECTURE.md § E5.H.
//
// L'ancienne onde visuelle (blast or pâle, items.reactive) est gardée : elle porte la lumière au sol et sur les robots
// (src/rendu/lumieres.js) ; l'anneau de choc d'ici suit exactement son rayon et y ajoute le reste.
// L'OBJET (inchangé, items.js + cooldowns.js) : en mode recharge, la Coque est PRÊTE tant qu'aucun robot n'est à 4 m ;
// un robot à 4 m ouvre sa FENÊTRE (0,6 s + 0,15 s par pile, 1,95 s au plus ; son CD_FIRE) ; pendant la fenêtre, chaque
// coup reçu lâche une ONDE de 4 m (dégâts + recul ; une par seconde au plus) ; à la fermeture, la RECHARGE (4,5 s −
// 0,25 s par pile, 2,25 s au moins ; son CD_READY à la fin). Le Pare-feu actif (fusion) lâche la même onde × 3.
//
// RENDU : UN maillage (« coque-reactive »), UNE géométrie construite à l'init :
//   • 6 plaques de coque autour du héros (bandes de cylindre, le haut rentré), chacune avec son rang de retour ;
//   • un quad au sol, mis à l'échelle à chaque image par un uniforme (petit quand rien ne se passe) : anneau au pied,
//     halo, anneau de PORTÉE (le vrai rayon de l'onde), anneau de choc et éclats de l'onde, flash au sol.
// Matériau : ShaderMaterial additif, sans écriture de profondeur, deux faces ; réglages cuits dans le programme à
// l'init ; 5 uniformes vec4 écrits à chaque image (champs « double » dès la création : aucune allocation, § V), aucun
// flottant passé en argument. Coût : 1 appel de dessin quand le héros a la Coque, 0 sinon (maillage caché).
//
// ÉTATS (lus chaque image : items.lireCoque, cooldowns.lireSource) :
//   prêt     : liseré ambre discret sur les plaques, anneau fin au pied ; pouls au retour à « prêt » ;
//   ACTIF    : les plaques se déploient (petit rebond) et s'allument (crème + liseré vif, scintillement), halo au sol,
//              l'anneau de portée s'ouvre depuis le pied jusqu'à 4 m en arcs qui raccourcissent avec la fenêtre (jauge) ;
//   onde     : flash des plaques et du sol, plaques projetées vers l'extérieur, anneau de choc du héros jusqu'à la vraie
//              portée (centré là où l'onde est partie, calé sur l'ancienne onde), disque qui se vide, éclats au-delà ;
//   recharge : les plaques s'éteignent (fondu court), puis reviennent une à une pendant la fin de la recharge.
// Aucune règle de jeu ici.
import * as THREE from 'three';
import { COQUE_REACTIVE, ITEM } from '../config.js';
import { P } from '../state.js';
import { H } from './projectiles.js';

const D = COQUE_REACTIVE;
const TAU = Math.PI * 2;

// ----- État (tableaux typés : aucun flottant dans un « let » de module, § V) ------------------------------------------
const C = new Float64Array(8); // items.lireCoque
const W = new Float64Array(5); // cooldowns.lireSource
const T = new Float64Array(14);
const T_ONDE = 0; // horloge de la dernière onde
const T_ONDES = 1; // ondes déjà vues
const T_OX = 2; // centre de la dernière onde
const T_OZ = 3;
const T_ARME = 4; // horloge du dernier passage à « actif »
const T_ARMEP = 5; // 1 : actif à l'image précédente
const T_PRET = 6; // horloge du dernier retour à « prêt »
const T_REST = 7; // recharge restante à l'image précédente
const T_HORL = 8; // horloge de l'image précédente
const T_NIV = 9; // niveau « actif » lissé (0..1)
const T_PRES = 10; // présence des plaques (fondu d'extinction)
const T_ROT = 11; // rotation des plaques (rad)
const T_ETAT = 12; // état de l'image (mesure) : 0 absent, 1 prêt, 2 actif, 3 onde déjà partie (fenêtre ouverte), 4 recharge
let mesh = null;
let items = null;
let cooldowns = null;
let vues = 0; // images où la coque a été dessinée (mesure)
let ondes = 0; // ondes vues (mesure)
let ouvertures = 0; // passages à « actif » vus (mesure)
let prets = 0; // retours à « prêt » vus (mesure)

const U = {
  uA: { value: new THREE.Vector4(0.5, 9.5, 0.5, 0.5) }, // x horloge, y âge de l'onde, z niveau actif, w jauge (fenêtre restante)
  uB: { value: new THREE.Vector4(0.5, 2.5, 9.5, 0.5) }, // x présence, y progression du retour (≥ 1 : toutes), z âge de l'ouverture, w pouls
  uC: { value: new THREE.Vector4(0.5, 0.5, 4.5, 1.5) }, // xy centre de l'onde (repère du héros), z rayon de l'onde, w demi-côté du quad
  uD: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) }, // x rotation, y projection (m), z flash, w opacité des plaques (onde)
  uE: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) }, // x déploiement (part du rayon), yzw libres
};

const f = (v) => (Math.round(v * 1e5) / 1e5).toFixed(5);
const lin = (hex) => {
  const c = new THREE.Color().setHex(hex);
  return `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;
};

function sources() {
  const PL = D.plaques;
  const L = D.look;
  const R = D.portee;
  const O = D.onde;
  const K = D.couleurs;
  const seg = TAU / PL.nombre;
  const VERT = /* glsl */ `
attribute vec4 aG; // sol : x, z (−1..1), genre 0 ; plaque : u, v (0..1), genre 1, numéro
attribute vec4 aH; // plaque : hasard, rang de retour
uniform vec4 uA; uniform vec4 uB; uniform vec4 uC; uniform vec4 uD; uniform vec4 uE;
varying vec4 vG;
varying float vGenre;
void main() {
  vec3 p;
  vGenre = aG.z;
  if (aG.z < 0.5) {
    p = vec3(aG.x * uC.w, 0.035, aG.y * uC.w);
    vG = vec4(p.x, p.z, 0.0, 0.0);
  } else {
    float u = aG.x;
    float v = aG.y;
    float ang = uD.x + (aG.w + 0.5) * ${f(seg)} + (u - 0.5) * ${f(seg * PL.couverture)};
    float r = ${f(PL.rayon)} * (1.0 + uE.x) * (1.0 - ${f(PL.rentree)} * v) + uD.y;
    p = vec3(cos(ang) * r, ${f(PL.bas)} + ${f(PL.haut - PL.bas)} * v + 0.25 * uD.y * v, sin(ang) * r);
    float vis = uB.x * step(aH.y, uB.y);
    vG = vec4(u, v, vis, aH.x);
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
  const FRAG = /* glsl */ `
uniform vec4 uA; uniform vec4 uB; uniform vec4 uC; uniform vec4 uD; uniform vec4 uE;
varying vec4 vG;
varying float vGenre;
const vec3 AMBRE = ${lin(K.ambre)};
const vec3 CREME = ${lin(K.creme)};
const vec3 BLANC = ${lin(K.flash)};
float gauss(float x, float w) { return exp(-(x * x) / (w * w)); }
float hachage(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
void main() {
  vec3 c = vec3(0.0);
  float niv = uA.z;
  if (vGenre > 0.5) {
    // ---- plaque : liseré (distance au bord en m), remplissage, flash de l'onde
    float vis = vG.z * uD.w;
    if (vis < 0.004) discard;
    float u = vG.x;
    float v = vG.y;
    float d = min(min(u, 1.0 - u) * ${f(PL.rayon * seg * PL.couverture)}, min(v, 1.0 - v) * ${f(PL.haut - PL.bas)});
    float arete = 1.0 - smoothstep(${f(PL.arete * 0.45)}, ${f(PL.arete)}, d);
    float scint = 1.0 + ${f(L.scintille)} * niv * sin(uA.x * 17.0 + vG.w * 40.0);
    float aI = mix(${f(L.aretePret)}, ${f(L.areteActif)}, niv) * (1.0 + 1.5 * uB.w) * scint;
    float fI = mix(${f(L.remplPret)}, ${f(L.remplActif)}, niv) * (0.55 + 0.45 * v);
    c = AMBRE * arete * aI + CREME * fI;
    c += BLANC * uD.z * ${f(O.flashIntensite)} * (0.45 + 0.55 * arete);
    c *= vis;
  } else {
    vec2 p = vG.xy;
    float r = length(p);
    float pres = uB.x * step(1.0, uB.y);
    // ---- au pied : anneau fin (prêt, plus vif actif) et halo (actif)
    c += AMBRE * gauss(r - ${f(PL.rayon * 1.3)}, 0.045) * ${f(L.anneauPied)} * pres * (0.6 + 1.6 * niv + 1.5 * uB.w);
    float h = 1.0 - smoothstep(0.0, ${f(PL.rayon * 1.9)}, r);
    c += AMBRE * h * h * ${f(L.halo)} * niv;
    // ---- actif : anneau de PORTÉE (rayon de l'onde), ouvert depuis le pied, en arcs qui raccourcissent (jauge)
    if (niv > 0.002) {
      float o = clamp(uB.z / ${f(R.ouverture)}, 0.0, 1.0);
      float Rr = mix(${f(PL.rayon * 1.3)}, uC.z, 1.0 - pow(1.0 - o, 3.0));
      float a = atan(p.y, p.x) - uD.x;
      float fr = fract(a / ${f(TAU)} * ${f(R.arcs)});
      float part = 0.86 * clamp(uA.w, 0.0, 1.0) + 0.06;
      float arc = 1.0 - smoothstep(part - 0.02, part + 0.02, abs(fr - 0.5) * 2.0);
      c += mix(AMBRE, CREME, 0.35) * gauss(r - Rr, ${f(R.epaisseur)}) * arc * ${f(R.intensite)} * niv * (1.0 + 1.5 * (1.0 - o));
      c += AMBRE * smoothstep(Rr - ${f(R.voileLargeur)}, Rr, r) * step(r, Rr) * ${f(R.voile)} * niv * (0.4 + 0.6 * uA.w);
    }
    // ---- onde : anneau de choc jusqu'à la vraie portée, disque qui se vide, éclats, flash au sol
    float age = uA.y;
    if (age < ${f(O.vie)}) {
      vec2 q = p - uC.xy;
      float rr = length(q);
      float x = age / ${f(O.vie)};
      float o = clamp(age / ${f(O.course)}, 0.0, 1.0);
      float rad = uC.z * (1.0 - pow(1.0 - o, 3.0)); // même rayon que l'ancienne onde (shader.js, onde())
      float fade = pow(1.0 - x, 1.3);
      float w = mix(0.16, 0.06, o);
      float front = gauss(rr - rad, w) * fade;
      float coeur = gauss(rr - rad, w * 0.35) * fade;
      float rempli = step(rr, rad) * pow(clamp(rr / max(rad, 0.001), 0.0, 1.0), 3.0) * (1.0 - smoothstep(0.0, 0.55, x));
      c += AMBRE * (front * ${f(O.intensite)} + rempli * ${f(O.remplissage)}) + BLANC * coeur * 1.6;
      // éclats : un trait radial par secteur, qui file avec le front puis un peu au-delà
      float ang = atan(q.y, q.x);
      float sec = floor((ang + 3.14159265) / ${f(TAU)} * ${f(O.eclats)});
      float h1 = hachage(sec + 3.0);
      float h2 = hachage(sec + 41.0);
      float ac = (sec + 0.5 + (h1 - 0.5) * 0.6) / ${f(O.eclats)} * ${f(TAU)} - 3.14159265;
      float lat = abs(ang - ac) * rr;
      float o2 = 1.0 - pow(1.0 - clamp(age / ${f(O.eclatsCourse)}, 0.0, 1.0), 2.0);
      float tete = uC.z * (0.2 + (${f(O.eclatsPortee)} * (0.82 + 0.3 * h2) - 0.2) * o2);
      float s = (tete - rr) / ${f(O.eclatLongueur)};
      float trait = step(0.0, s) * (1.0 - smoothstep(0.0, 1.0, s)) * gauss(lat, ${f(O.eclatEpaisseur)} * (1.0 - 0.6 * s));
      c += mix(CREME, BLANC, 0.5) * trait * (1.0 - smoothstep(0.55, 1.0, x)) * 2.6;
      c += BLANC * exp(-age / ${f(O.flash)}) * ${f(O.flashIntensite * 0.45)} * (1.0 - smoothstep(0.0, 1.4, rr));
    }
  }
  if (max(c.r, max(c.g, c.b)) < 0.003) discard;
  gl_FragColor = vec4(c, 1.0);
}`;
  return { VERT, FRAG };
}

// ----- Géométrie (init : allocations permises) --------------------------------------------------------------------
function hachage(n) {
  let x = (n * 0x27d4eb2d) | 0;
  x = (x ^ (x >>> 15)) | 0;
  x = Math.imul(x, 0x85ebca6b);
  x = (x ^ (x >>> 13)) | 0;
  return (x >>> 0) / 4294967296;
}

function construire() {
  const NP = D.plaques.nombre;
  const NS = 6; // subdivisions de chaque plaque (la courbure se lit)
  const nV = 4 + NP * (NS + 1) * 2;
  const aG = new Float32Array(nV * 4);
  const aH = new Float32Array(nV * 4);
  const pos = new Float32Array(nV * 3);
  const idx = [];
  let v = 0;
  const ecrire = (a, b, g, k, rnd, rang) => {
    aG.set([a, b, g, k], v * 4);
    aH.set([rnd, rang, 0, 0], v * 4);
    pos.set([a, 0, b], v * 3);
    return v++;
  };
  // quad au sol
  ecrire(-1, -1, 0, 0, 0, 0);
  ecrire(1, -1, 0, 0, 0, 0);
  ecrire(1, 1, 0, 0, 0, 0);
  ecrire(-1, 1, 0, 0, 0, 0);
  idx.push(0, 1, 2, 0, 2, 3);
  // plaques : rang de retour dans un ordre mélangé (une à une, jamais deux voisines de suite)
  const ordre = [0, 3, 1, 4, 2, 5];
  for (let k = 0; k < NP; k++) {
    const rnd = hachage(k + 7);
    const rang = Math.min(0.95, ((ordre[k % ordre.length] + 0.5) / NP) * 0.9);
    const b = v;
    for (let j = 0; j <= NS; j++) {
      ecrire(j / NS, 0, 1, k, rnd, rang);
      ecrire(j / NS, 1, 1, k, rnd, rang);
    }
    for (let j = 0; j < NS; j++) {
      const i0 = b + j * 2;
      idx.push(i0, i0 + 2, i0 + 1, i0 + 2, i0 + 3, i0 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aG', new THREE.BufferAttribute(aG, 4));
  g.setAttribute('aH', new THREE.BufferAttribute(aH, 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
  return g;
}

export function init(context) {
  items = context.items;
  cooldowns = context.cooldowns || null;
  const { VERT, FRAG } = sources();
  const mat = new THREE.ShaderMaterial({
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
  mesh = new THREE.Mesh(construire(), mat);
  mesh.name = 'coque-reactive';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 3; // comme le dôme du Pare-feu ; additif : l'ordre ne change pas la couleur
  mesh.visible = false;
  context.scene.add(mesh);
  reset();
}

export function reset() {
  T.fill(0);
  T[T_ONDE] = -1e9;
  T[T_ARME] = -1e9;
  T[T_PRET] = -1e9;
  T[T_PRES] = 1;
}

/**
 * F11 (après items.sync) : lit l'état de la Coque, pose le maillage sur le héros et écrit les uniformes. Aucun
 * flottant passé ni rendu ; aucune allocation.
 */
export function sync() {
  if (mesh === null) return;
  items.lireCoque(C);
  const clock = H[0];
  let dt = clock - T[T_HORL];
  if (!(dt >= 0) || dt > 0.25) dt = 0;
  T[T_HORL] = clock;
  // onde (comptée par items.reactive : coup reçu pendant la fenêtre, ou Pare-feu actif)
  if (C[1] < T[T_ONDES]) T[T_ONDES] = C[1];
  if (C[1] > T[T_ONDES]) {
    T[T_ONDES] = C[1];
    T[T_ONDE] = clock;
    T[T_OX] = C[2];
    T[T_OZ] = C[3];
    ondes++;
  }
  // fenêtre et recharge (mode recharge : cooldowns ; sinon le délai de la coque)
  let mode = 0;
  if (cooldowns !== null) {
    cooldowns.lireSource(1, ITEM.REACTIVE, W);
    mode = W[4];
  }
  let arme = 0;
  let recharge = 0;
  let reste = 0;
  let total = 1;
  let jauge = 1;
  if (mode === 1) {
    const fen = W[0];
    arme = fen > 0 && C[5] <= 0 ? 1 : 0;
    recharge = fen <= 0 && W[2] > 0 ? 1 : 0;
    reste = recharge === 1 ? W[2] : 0;
    total = W[3] > 0 ? W[3] : 1;
    jauge = W[1] > 0 ? fen / W[1] : 0;
    T[T_ETAT] = arme === 1 ? 2 : fen > 0 ? 3 : recharge === 1 ? 4 : 1;
  } else {
    arme = C[5] <= 0 ? 1 : 0;
    recharge = 1 - arme;
    reste = C[5] > 0 ? C[5] : 0;
    total = C[6] > 0 ? C[6] : 1;
    T[T_ETAT] = arme === 1 ? 2 : 4;
  }
  if (arme === 1 && T[T_ARMEP] === 0) {
    T[T_ARME] = clock;
    ouvertures++;
  }
  T[T_ARMEP] = arme;
  if (T[T_REST] > 0 && reste <= 0) {
    T[T_PRET] = clock;
    prets++;
  }
  T[T_REST] = reste;
  const piles = C[0];
  let ageOnde = clock - T[T_ONDE];
  if (ageOnde < 0) ageOnde = 9.5;
  if (!D.actif || !P.alive || (piles <= 0 && ageOnde >= D.onde.vie)) {
    mesh.visible = false;
    T[T_ETAT] = 0;
    return;
  }
  mesh.visible = true;
  vues++;
  mesh.position.x = P.x;
  mesh.position.y = 0;
  mesh.position.z = P.z;
  // niveau « actif » lissé : monte vite, descend un peu moins vite
  let niv = T[T_NIV];
  if (arme === 1) niv += dt / 0.05;
  else niv -= dt / 0.14;
  T[T_NIV] = niv < 0 ? 0 : niv > 1 ? 1 : niv;
  // présence des plaques et retour une à une pendant la fin de la recharge
  const RC = D.recharge;
  let prog = 2;
  if (recharge === 1) {
    let retour = RC.retour;
    if (retour > total * RC.partMax) retour = total * RC.partMax;
    const p = reste > retour ? 0 : 1 - reste / retour;
    if (p > 0) {
      T[T_PRES] = 1;
      prog = p;
    } else {
      let pr = T[T_PRES] - dt / RC.extinction;
      if (pr < 0) pr = 0;
      T[T_PRES] = pr;
      prog = pr > 0 ? 2 : 0;
    }
  } else T[T_PRES] = 1;
  let rot = T[T_ROT] + dt * D.plaques.rotation * (0.25 + 0.75 * T[T_NIV]);
  if (rot > TAU) rot -= TAU;
  T[T_ROT] = rot;
  let ageArme = clock - T[T_ARME];
  if (ageArme < 0) ageArme = 9.5;
  let agePret = clock - T[T_PRET];
  if (agePret < 0) agePret = 9.5;
  const O = D.onde;
  const u0 = U.uA.value;
  u0.x = clock;
  u0.y = ageOnde;
  u0.z = T[T_NIV];
  u0.w = jauge;
  const u1 = U.uB.value;
  u1.x = T[T_PRES];
  u1.y = prog;
  u1.z = ageArme;
  u1.w = Math.exp(-agePret / RC.pouls);
  const u2 = U.uC.value;
  const ox = T[T_OX] - P.x;
  const oz = T[T_OZ] - P.z;
  u2.x = ox;
  u2.y = oz;
  u2.z = C[4];
  let cote = D.plaques.rayon * 2.2;
  if (T[T_NIV] > 0.002 && cote < C[4] + 0.4) cote = C[4] + 0.4;
  if (ageOnde < O.vie) {
    const d = Math.sqrt(ox * ox + oz * oz) + C[4] * O.eclatsPortee * 1.15 + O.eclatLongueur;
    if (cote < d) cote = d;
  }
  u2.w = cote;
  // onde : flash, plaques projetées puis revenues
  const sortie = ageOnde < 0.3 ? 1 : ageOnde > 0.45 ? 0 : 1 - (ageOnde - 0.3) / 0.15;
  const u3 = U.uD.value;
  u3.x = rot;
  u3.y = O.projection * (1 - Math.exp(-ageOnde / 0.06)) * sortie;
  u3.z = Math.exp(-ageOnde / O.flash);
  u3.w = 1 - 0.8 * sortie * (ageOnde < 0.04 ? ageOnde / 0.04 : 1);
  // déploiement à l'ouverture : petit rebond (≈ 0,2 s)
  const b = ageArme < 0.2 ? Math.sin((ageArme / 0.2) * Math.PI) : 0;
  U.uE.value.x = D.plaques.deploiement * T[T_NIV] + 0.12 * b * T[T_NIV];
}

/** Mesures et tests (hors combat). */
export function inspect(out) {
  out.actif = D.actif;
  out.visible = mesh !== null && mesh.visible;
  out.etat = T[T_ETAT]; // 0 absent, 1 prêt, 2 actif, 3 onde partie (fenêtre ouverte), 4 recharge
  out.vues = vues;
  out.ondes = ondes;
  out.ouvertures = ouvertures;
  out.prets = prets;
  out.niveau = T[T_NIV];
  out.presence = T[T_PRES];
  out.uniformes = [U.uA.value.toArray(), U.uB.value.toArray(), U.uC.value.toArray(), U.uD.value.toArray(), U.uE.value.toArray()];
  return out;
}
