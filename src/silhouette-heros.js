//#region e5:P-lisibilite-guide
// § E5.P (B1, audit du guide UX ; Femz, 21/11 : « retire le repère », « 1 silhouette ») — SILHOUETTE DU HÉROS DANS LA
// FOULE : le corps du héros (sa géométrie et son squelette, comme la silhouette « là où il est masqué » de
// heros-anim.js) redessiné en aplat de l'accent de l'agent PAR-DESSUS TOUT — robots, effets, chiffres de dégâts —,
// seulement quand il est pris dans la foule : ≥ foule.entre robots à moins de foule.rayon m (comptés par la boucle des
// robots, enemies.FOULE) → fondu d'entrée ; moins de foule.sort pendant foule.tenue s → fondu de sortie.
// Pas d'anneau au sol (refusé par Femz le 13/11). Réglages : LISIBILITE_GUIDE.silhouette (config.js).
//
// Un maillage qui partage la géométrie et le squelette du héros, plus un par tissu (cape de l'Éclaireur, tissus du
// Shinobi : même géométrie qu'eux), en aplat opaque, SANS test de profondeur (par-dessus tout ; le corps se recouvre
// lui-même dans la même couleur : rien ne se voit). render.garderNet : avec l'effet CRT,
// dans la scène nette des chiffres, après eux ; sans, dans la scène du jeu (matériau transparent pour le fondu,
// renderOrder après tout). 1 appel de dessin quand elle est visible (2 avec la cape ou les tissus), 0 sinon. Maillage créé au premier héros posé,
// repris (géométrie et squelette) à chaque changement d'agent, hors combat. (Premier jet : le corps seul, en deux
// passes à 85 % : une tache sombre restait entre les jambes — la cape, maillage à part, vue à travers l'aplat.)
//
// Allocation (§ V) : état en ENTIERS (Int32Array, fondu en µs), opacité dans un Float32Array d'uniforme — une petite
// fonction appelée une fois par image reste longtemps hors du compilateur optimisant et y emballerait chaque flottant.
//
// Intégration (main.js) : init(ctx) après fx.init ; DTUS[0] = realDt × 1e6 puis sync() en F11, après player.sync et
// fx.sync ; reset() dans resetAll.
import * as THREE from 'three';
import { AGENTS, LISIBILITE_GUIDE, RENDER } from './config.js';
import { P, run } from './state.js';
import { FOULE, FOULE_R2 } from './enemies.js';
import { getMesh } from './anim/heros-anim.js';
import * as cape from './anim/cape.js'; // la cape (Éclaireur) et les tissus (Shinobi) font partie de la silhouette :
import * as tissus from './anim/tissus.js'; // sans eux, la cape vue entre les jambes restait sombre dans l'aplat
import { entree as ENTREE_REPERES } from './anim/reperes.js'; // § E5.X6 (D14) : R1 par-dessus la foule quand la silhouette est allumée

const R = LISIBILITE_GUIDE.silhouette;
/** Entrée de sync : [0] = pas de temps réel en MICROSECONDES (entier), écrit par main.js (§ V). */
export const DTUS = new Int32Array(1);
// 0 progression du fondu (0..PLEIN), 1 µs sous le seuil de sortie, 2 allumée (1/0), 3 robots comptés, 4 agent posé
const S = new Int32Array(5);
// uniforme : x progression, y PLEIN (le shader divise), z opacité au plus
const FONDU = new Float32Array(4);
let scene = null;
let render = null;
let lie = null; // maillage du héros auquel la silhouette est liée
let coul = null;
let matCoul = null;
// cape et tissus : maillages simples (géométrie dynamique, en coordonnées du monde), un aplat chacun
const TISSUS = [cape.getMesh, tissus.getMesh];
const tissuLie = [null, null];
const tissuSil = [null, null];
const matTissu = [null, null];

/** alpha = fondu lissé × opacité. */
function injecter(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSilFondu = { value: FONDU };
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform vec4 uSilFondu;\nvoid main() {').replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
  float silT = clamp( uSilFondu.x / max( uSilFondu.y, 1.0 ), 0.0, 1.0 );
  gl_FragColor.a *= silT * silT * ( 3.0 - 2.0 * silT ) * uSilFondu.z;`,
    );
  };
  mat.customProgramCacheKey = () => 'sr-silhouette-foule';
}

export function init(ctx) {
  scene = ctx.scene;
  render = ctx.render;
  matCoul = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, toneMapped: false, side: THREE.DoubleSide, forceSinglePass: true });
  injecter(matCoul);
  for (let k = 0; k < 2; k++) {
    matTissu[k] = matCoul.clone(); // une instance par maillage (§ G.2), même programme (non « skinné »)
    injecter(matTissu[k]);
  }
  FONDU[2] = R.opacite;
}

/** Lie la silhouette au maillage du héros m (premier héros posé, changement d'agent : jamais en combat). */
function lier(m) {
  lie = m;
  if (coul === null) {
    coul = new THREE.SkinnedMesh(m.geometry, matCoul);
    coul.name = 'joueur-silhouette-foule';
    coul.frustumCulled = false;
    coul.visible = false;
    coul.renderOrder = RENDER.decals.numbersOrder + 1; // après les chiffres de dégâts
    scene.add(coul);
    render.garderNet(coul); // effet CRT : scène nette, après les chiffres
  } else coul.geometry = m.geometry;
  coul.bind(m.skeleton, m.bindMatrix);
  const a = AGENTS[run.agent] || AGENTS[0];
  matCoul.color.setHex(a.accent).multiplyScalar(R.gain); // couleur : un uniforme (rien n'est recompilé)
  for (let k = 0; k < 2; k++) matTissu[k].color.copy(matCoul.color);
  S[4] = run.agent;
}

export function reset() {
  S[0] = 0;
  S[1] = 0;
  S[2] = 0;
  S[3] = 0;
  FONDU[0] = 0;
  ENTREE_REPERES[2] = 0; // § E5.X6 (D14)
  if (coul !== null) coul.visible = false;
  for (let k = 0; k < 2; k++) if (tissuSil[k] !== null) tissuSil[k].visible = false;
}

/** Cape ou tissus k : aplat lié à leur maillage (créé une fois, repris si le maillage change ; hors combat). */
function lierTissu(k, t) {
  tissuLie[k] = t;
  if (tissuSil[k] === null) {
    const m = new THREE.Mesh(t.geometry, matTissu[k]);
    m.name = k === 0 ? 'joueur-silhouette-foule-cape' : 'joueur-silhouette-foule-tissus';
    m.frustumCulled = false;
    m.visible = false;
    m.renderOrder = RENDER.decals.numbersOrder + 1;
    scene.add(m);
    render.garderNet(m);
    tissuSil[k] = m;
  } else tissuSil[k].geometry = t.geometry;
}

// Réglages copiés une fois, en entiers (relus par regler() : tests). Le fondu avance de dt × (durée de sortie en ms) par
// image allumée et recule de dt × (durée d'entrée en ms) éteinte, sur PLEIN = entrée × sortie × 1000 : entrée en
// fonduEntree s, sortie en fonduSortie s, sans division ni flottant à l'image.
// 0 entrée (robots), 1 sortie (robots), 2 tenue (µs), 3 pas d'entrée (ms de sortie), 4 pas de sortie (ms d'entrée), 5 PLEIN
const K = new Int32Array(6);
export function regler() {
  const F = R.foule;
  FOULE_R2[0] = F.rayon * F.rayon;
  K[0] = F.entre;
  K[1] = F.sort;
  K[2] = Math.round(F.tenue * 1e6);
  const fe = Math.max(1, Math.round(R.fonduEntree * 1000));
  const fs = Math.max(1, Math.round(R.fonduSortie * 1000));
  K[3] = fs;
  K[4] = fe;
  K[5] = fe * fs * 1000;
  FONDU[1] = K[5];
}
regler();

/** F11 : foule, fondu, visibilité. Entiers seulement : rien n'est alloué, optimisé ou non. */
export function sync() {
  if (matCoul === null) return;
  const m = getMesh();
  if (m === null) {
    if (coul !== null) coul.visible = false;
    ENTREE_REPERES[2] = 0; // § E5.X6 (D14)
    return;
  }
  if (m !== lie || S[4] !== run.agent) lier(m);
  const on = R.actif && P.alive && m.visible;
  const n = on ? FOULE[0] : 0;
  const dt = DTUS[0];
  S[3] = n;
  if (n >= K[0]) {
    S[2] = 1;
    S[1] = 0;
  } else if (S[2] === 1) {
    if (n < K[1]) S[1] += dt;
    else S[1] = 0;
    if (S[1] >= K[2] || !on) S[2] = 0;
  }
  // dt (µs) × pas (ms) ≤ 33 334 × 1 000 : dans les entiers 31 bits (LOOP.maxDt borne dt)
  if (S[2] === 1) {
    if (S[0] < K[5]) S[0] = Math.min(K[5], S[0] + ((dt * K[3]) | 0));
  } else if (S[0] > 0) S[0] = Math.max(0, S[0] - ((dt * K[4]) | 0));
  const vu = S[0] > 0 && m.visible;
  coul.visible = vu;
  ENTREE_REPERES[2] = vu ? 1 : 0; // § E5.X6 (D14)
  for (let k = 0; k < 2; k++) {
    const t = TISSUS[k]();
    if (t === null) continue;
    if (t !== tissuLie[k]) lierTissu(k, t);
    tissuSil[k].visible = vu && t.visible;
  }
  if (vu) FONDU[0] = S[0];
}

/** Tests (hors chemin chaud) : état et maillages de la silhouette. */
export function inspect() {
  return { visible: coul !== null && coul.visible, visibilite: S[0] / K[5], allumee: S[2] === 1, robots: S[3], sousSeuil: S[1] / 1e6 };
}
export function maillages() {
  const o = coul === null ? [] : [coul];
  for (let k = 0; k < 2; k++) if (tissuSil[k] !== null) o.push(tissuSil[k]);
  return o;
}
//#endregion e5:P-lisibilite-guide
