// ÉTAPE 5, CHANTIER U : visee.js — visée à la souris (ARCHITECTURE.md § E5.U, Femz 21/11 : « contrôler la direction de la
// vue du perso avec la souris, et garder les déplacements sur clavier »).
//   • VISEE : direction unitaire monde héros → point du sol sous le curseur, recalculée à chaque pas de simulation
//     (player.update, après le déplacement). Curseur sur le héros (< VISEE_SOURIS.mort) : la dernière visée reste ;
//     curseur jamais bougé depuis le chargement : la visée suit la marche. Toujours active, sans réglage (Femz, 21/11 :
//     « garde seulement souris si ça tire auto pour les autres sur les robots les plus proches ») ; les autres armes
//     gardent leur visée automatique.
//   • regard du buste (heros-anim.regard) : le buste suit la visée quand ni dash, ni geste, ni arme ne l'imposent ;
//     le bassin et les jambes gardent leurs états (avant / pas chassés / marche arrière / pivot).
//   • trait d'annonce de la Frappe éclair prête : weapons-agents.sync écrit TRAIT (voulu, distance, demi-largeur,
//     rayon), sync() pose la plaque au sol — du héros au point d'arrivée que fireFlash calculerait (même résolution
//     contre les décors et le bord), largeur réelle, couleur de l'agent, gros pixels comme les VFX. Un appel de dessin,
//     seulement quand il est visible.
// Rien n'est alloué par image : tableaux typés, objets et uniformes créés à l'init ; le curseur est lu dans un tableau
// typé — aucun flottant passé en argument dans le chemin chaud (§ V).
// § E5.AB (22/11) : mode Souris = l'avant de la caméra ; mode Clavier = la direction de marche (plus de visée au curseur).
//#region e5:U-visee-souris
import * as THREE from 'three';
import { P, run } from './state.js';
import { AGENTS, RESOLVE, VISEE_SOURIS } from './config.js';
import { regard } from './anim/heros-anim.js';
import { H as VFX_H } from './vfx/projectiles.js';

const VS = VISEE_SOURIS;
const TR = VS.trait;

/** [0], [1] direction de visée (unitaire, monde) ; [2] 1 = le curseur est suivi (connu), 0 = direction de marche. */
export const VISEE = new Float64Array(3);
/** Entrée du trait, écrite par weapons-agents.sync à chaque image : [0] voulu (1 / 0), [1] distance (m), [2] demi-largeur
 * (m), [3] rayon du héros pour la résolution contre les décors (WEAPONS[FLASH].radius). Remis à 0 par sync(). */
export const TRAIT = new Float64Array(5); // [4] recharge 0..1 (variante 'b')

let input = null;
let camera = null;
let world = null;
let mesh = null;
// résolution du point d'arrivée (world.resolveMany : tableaux typés, aucun flottant passé)
const RX = new Float64Array(1);
const RZ = new Float64Array(1);
const RR = new Float64Array(1);
const RM = new Uint8Array([RESOLVE.GROUND]);
// [0] apparition 0..1, [1] horloge des VFX à la dernière sync, [2] agent dont la couleur est posée (−1 : aucun)
const ST = new Float64Array([0, 0, -1]);
// relevés (tests) : origine x, z, bout x, z, demi-largeur, visible
const MES = new Float64Array(6);

const uO = { value: new THREE.Vector4(0, 0, 0, 1) }; // origine x, z ; longueur ; demi-largeur
const uD = { value: new THREE.Vector4(0, 1, 0, 0) }; // direction x, z ; apparition ; temps
const uCol = { value: new THREE.Color(1, 1, 1) };
const STYLES = TR.styles;
const uStyle = { value: Math.max(0, STYLES.indexOf(TR.style)) }; // 0 actuel, 1 a, 2 b, 3 c, 4 d

/** Variante du trait ('actuel' | 'a' | 'b' | 'c' | 'd', VISEE_SOURIS.trait.styles) ; rend la variante posée. Hors chemin chaud. */
export function setStyle(k) {
  const i = STYLES.indexOf(k);
  if (i >= 0) uStyle.value = i;
  return STYLES[uStyle.value];
}
/** 1 si la variante montre le trait pendant la recharge ('b' : la bande se charge). */
export function traitEnRecharge() {
  return uStyle.value === 2 ? 1 : 0;
}

/** Une fois, au chargement (player.init) : la plaque est dans la scène dès le prewarm (programme compilé d'avance). */
export function init(ctx) {
  input = ctx.input;
  camera = ctx.camera;
  world = ctx.world;
  const g = new THREE.PlaneGeometry(2, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, 0.5); // x ∈ [−1 ; 1] en travers, z ∈ [0 ; 1] le long du trait
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uO,
      uD,
      uCol,
      uY: { value: TR.y },
      uPx: { value: TR.pixel },
      uCoin: { value: new THREE.Vector4(TR.coin.bras, TR.coin.epaisseur, TR.coin.gain, TR.coin.alpha) },
      uTiret: { value: new THREE.Vector4(TR.tiret.long, TR.tiret.pas, TR.tiret.epaisseur, TR.tiret.alpha) },
      uChev: { value: new THREE.Vector4(TR.chevron.pas, TR.chevron.epaisseur, TR.chevron.ouverture, TR.chevron.vitesse) },
      uGains: { value: new THREE.Vector4(TR.tiret.gain, TR.chevron.gain, TR.voile.gain, 0) },
      uAlphas: { value: new THREE.Vector4(TR.chevron.alpha, TR.voile.alpha, 0, 0) },
      uStyle,
      uFil: { value: new THREE.Vector4(TR.fil.epaisseur, TR.fil.alpha, TR.fil.reticule, TR.fil.reticuleBras) },
      uCharge: { value: new THREE.Vector4(TR.charge.bord, TR.charge.bordAlpha, TR.charge.bordPret, TR.charge.remplissage) },
      uFlux: { value: new THREE.Vector4(TR.flux.pas, TR.flux.taille, TR.flux.vitesse, TR.flux.alpha) },
      uDivers: { value: new THREE.Vector4(TR.fil.reticuleAlpha, TR.charge.bout, TR.charge.boutAlpha, TR.flux.bande) },
    },
    vertexShader: /* glsl */ `
uniform vec4 uO;
uniform vec4 uD;
uniform float uY;
varying vec2 vL;
void main() {
  float m = 0.45; // marge autour du trait : gros pixels du bord et réticule de la variante 'a' (0,34 m) compris
  float a = position.x * (uO.w + m);
  float l = -m + position.z * (uO.z + 2.0 * m);
  vL = vec2(a, l);
  vec2 n = vec2(uD.y, -uD.x);
  vec2 p = uO.xy + uD.xy * l + n * a;
  gl_Position = projectionMatrix * viewMatrix * vec4(p.x, uY, p.y, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform vec4 uO;
uniform vec4 uD;
uniform vec3 uCol;
uniform float uPx;
uniform vec4 uCoin;
uniform vec4 uTiret;
uniform vec4 uChev;
uniform vec4 uGains;
uniform vec4 uAlphas;
uniform float uStyle;
uniform vec4 uFil;
uniform vec4 uCharge;
uniform vec4 uFlux;
uniform vec4 uDivers;
varying vec2 vL;
// q = (travers, le long) en m ; rend (gain, alpha) de l'élément le plus fort au point
vec2 motif(vec2 q) {
  float L = uO.z;
  float h = uO.w;
  float ax = abs(q.x);
  float y = q.y;
  float st = uStyle;
  if (st > 0.5 && st < 1.5) {
    // 'a' : fil d'un gros pixel du héros au bout + réticule au point d'arrivée (quatre petits coins, un point)
    vec2 r = vec2(q.x, y - L);
    float R = uFil.z;
    float b = uFil.w;
    float e = uFil.x;
    vec2 ar = abs(r);
    bool coinX = ar.x > R - e && ar.x < R + e && ar.y > R - b && ar.y < R + e;
    bool coinY = ar.y > R - e && ar.y < R + e && ar.x > R - b && ar.x < R + e;
    if (coinX || coinY || (ar.x < e * 1.2 && ar.y < e * 1.2)) return vec2(1.15, uDivers.x);
    if (ax < e * 0.5 && y > 0.55 && y < L - R - 0.1) return vec2(1.0, uFil.y);
    return vec2(0.0);
  }
  if (y < 0.0 || y > L || ax > h) return vec2(0.0);
  if (st > 1.5 && st < 2.5) {
    // 'b' : bande qui se charge — uGains.w = recharge 0..1 (1 = prête)
    float c = clamp(uGains.w, 0.0, 1.0);
    bool pret = c >= 0.999;
    if (y > L - uDivers.y && pret) return vec2(1.15, uDivers.z);
    if (ax > h - uCharge.x) return vec2(pret ? 1.0 : 0.7, pret ? uCharge.z : uCharge.y);
    if (y < L * c) return vec2(0.8, pret ? uCharge.w * 1.4 : uCharge.w);
    return vec2(0.0);
  }
  if (st > 2.5 && st < 3.5) {
    // 'c' : flux — gros pixels qui avancent sur l'axe, plus vifs vers le bout ; bande très sourde
    float s = mod(y - uD.w * uFlux.z, uFlux.x);
    if (ax < uFlux.y && abs(s - uFlux.x * 0.5) < uFlux.y && y > 0.5) return vec2(1.1, uFlux.w * (0.35 + 0.65 * y / L));
    if (ax > h - 0.04) return vec2(0.7, uDivers.w * 3.0);
    return vec2(0.6, uDivers.w);
  }
  if (st > 3.5) {
    // 'd' : contour seul — deux longs bords en tirets, un chevron au bout ; ni remplissage ni coins
    if (ax > h - uTiret.z && fract(y / uTiret.y) < uTiret.x / uTiret.y && y < L - 0.3) return vec2(uGains.x, uTiret.w * 1.4);
    float pointe = L - 0.05;
    if (ax < h * 0.9 && abs(y - (pointe - ax * 0.55)) < uChev.y * 1.2) return vec2(1.15, uCoin.w);
    return vec2(0.0);
  }
  float bras = min(uCoin.x, min(L * 0.5, h));
  float ep = uCoin.y;
  bool bordX = ax > h - ep; // bande d'un bord long
  bool bordY = y < ep || y > L - ep; // bande d'un bout
  bool presY = y < bras || y > L - bras;
  bool presX = ax > h - bras;
  if ((bordX && presY) || (bordY && presX)) return vec2(uCoin.z, uCoin.w);
  if (ax > h - uTiret.z && fract((y - bras) / uTiret.y) < uTiret.x / uTiret.y) return vec2(uGains.x, uTiret.w);
  float s = mod(y - uD.w * uChev.w, uChev.x);
  float pointe = uChev.x * 0.5;
  if (ax < h * uChev.z && y > 0.6 && y < L - bras && abs(s - (pointe - ax * 0.8)) < uChev.y) return vec2(uGains.y, uAlphas.x);
  return vec2(uGains.z, uAlphas.y);
}
void main() {
  // look pixel des VFX : le motif est lu au centre de la cellule de gros pixel, sur-échantillonné 2 × 2 (un trait plus
  // fin qu'une cellule l'allume quand même) ; aucun dégradé dans le motif, des tons durs
  vec2 dx = dFdx(vL), dy = dFdy(vL);
  vec2 ctr = (floor(gl_FragCoord.xy / uPx) + 0.5) * uPx - gl_FragCoord.xy;
  vec2 p0 = vL + dx * ctr.x + dy * ctr.y;
  float o = uPx * 0.25;
  vec2 a = motif(p0 + dx * o + dy * o);
  vec2 b = motif(p0 - dx * o + dy * o);
  vec2 c = motif(p0 + dx * o - dy * o);
  vec2 d = motif(p0 - dx * o - dy * o);
  vec2 r = a;
  if (b.y > r.y) r = b;
  if (c.y > r.y) r = c;
  if (d.y > r.y) r = d;
  float al = r.y * uD.z;
  if (al <= 0.002) discard;
  gl_FragColor = vec4(uCol * r.x, al);
  #include <colorspace_fragment>
}`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  mesh = new THREE.Mesh(g, mat);
  mesh.name = 'trait-frappe';
  mesh.frustumCulled = false; // positions écrites par le shader
  mesh.renderOrder = TR.ordre;
  mesh.visible = false;
  ctx.scene.add(mesh);
}

/** Nouvelle partie (player.reset, après la direction de marche) : visée = marche, trait éteint. */
export function reset() {
  VISEE[0] = P.moveX;
  VISEE[1] = P.moveZ;
  VISEE[2] = 0;
  regard[0] = 0;
  regard[1] = P.moveX;
  regard[2] = P.moveZ;
  TRAIT.fill(0);
  ST[0] = 0;
  if (mesh !== null) mesh.visible = false;
}

/** § E5.AB : mode Souris → VISEE = l'avant de la caméra, rend 1 ; mode Clavier → rend 0 (la visée est la marche). */
function suivreCurseur() {
  //#region e5:AB-camera-3p
  // § E5.AB.4 : mode Souris (caméra derrière l'agent) — la visée est l'avant de la caméra, toujours suivie
  if (input.getModeSouris()) {
    VISEE[0] = camera.view.upX;
    VISEE[1] = camera.view.upZ;
    return 1;
  }
  // § E5.AB.13 (Femz, 22/11 : « tout clavier, sans viseur ») : mode Clavier — la souris est ignorée, la visée est la
  // direction de marche (le comportement d'avant 0.5.9, celui du curseur jamais bougé)
  return 0;
  //#endregion e5:AB-camera-3p
}

/** Pas de simulation (player.update, après le déplacement, avant l'animation du héros et les armes). */
export function update() {
  if (input.getModeSouris() && suivreCurseur() === 1) {
    VISEE[2] = 1;
    regard[0] = 1;
    regard[1] = VISEE[0];
    regard[2] = VISEE[1];
    return;
  }
  // Vue fixe (§ E5.AB.13) : la direction de marche, comme avant 0.5.9 — lue directement dans P par la frappe, le trait et
  // inspect (VISEE n'est pas recopiée à chaque image : 10 o/image mesurés, une lecture de P.moveX non optimisée)
  VISEE[2] = 0;
  regard[0] = 0;
}

/**
 * Image (weapons.sync → WA.sync, après camera.update) : pose le trait si TRAIT[0] = 1. La direction est relue au curseur
 * avec la caméra de CETTE image — celle que le prochain pas de simulation utilisera : le trait dit où partira la frappe.
 */
export function sync() {
  const voulu = TRAIT[0] === 1 && P.alive;
  TRAIT[0] = 0;
  const mat = mesh !== null ? mesh.material : null;
  if (!voulu || mesh === null) {
    if (mesh !== null && mesh.visible) mesh.visible = false;
    ST[0] = 0;
    MES[5] = 0;
    ST[1] = VFX_H[0];
    return;
  }
  if (suivreCurseur() === 0) {
    VISEE[0] = P.moveX; // mode Clavier : la direction de marche (§ E5.AB.13)
    VISEE[1] = P.moveZ;
  }
  const ux = VISEE[0];
  const uz = VISEE[1];
  // point d'arrivée : celui de fireFlash (P + u × distance, poussé hors des décors et borné à l'arène)
  RX[0] = P.x + ux * TRAIT[1];
  RZ[0] = P.z + uz * TRAIT[1];
  RR[0] = TRAIT[3];
  world.resolveMany(RX, RZ, RR, RM, 1);
  const ex = RX[0] - P.x;
  const ez = RZ[0] - P.z;
  const len = Math.sqrt(ex * ex + ez * ez);
  uO.value.x = P.x;
  uO.value.y = P.z;
  uO.value.z = len;
  uO.value.w = TRAIT[2];
  uD.value.x = len > 1e-4 ? ex / len : ux;
  uD.value.y = len > 1e-4 ? ez / len : uz;
  // apparition (horloge des VFX : temps simulé, figée en pause comme le reste du monde)
  let dt = VFX_H[0] - ST[1];
  if (!(dt >= 0) || dt > 0.25) dt = 0;
  ST[1] = VFX_H[0];
  ST[0] += dt / TR.apparition;
  if (ST[0] > 1) ST[0] = 1;
  if (!mesh.visible && ST[0] === 0) ST[0] = 1e-3; // première image : dessinée, à peine visible
  uD.value.z = ST[0] * ST[0] * (3 - 2 * ST[0]);
  uD.value.w = VFX_H[0];
  mat.uniforms.uGains.value.w = TRAIT[4]; // 'b' : recharge 0..1
  if (ST[2] !== run.agent) {
    ST[2] = run.agent;
    uCol.value.setHex(AGENTS[run.agent].accent);
  }
  mesh.visible = true;
  MES[0] = P.x;
  MES[1] = P.z;
  MES[2] = RX[0];
  MES[3] = RZ[0];
  MES[4] = TRAIT[2];
  MES[5] = 1;
}

/** Tests et ?debug : visée, curseur suivi, trait affiché (origine, bout, demi-largeur, apparition). */
export function inspect(out) {
  out.x = VISEE[2] === 1 ? VISEE[0] : P.moveX; // § E5.AB.13 : Vue fixe — la direction de marche
  out.z = VISEE[2] === 1 ? VISEE[1] : P.moveZ;
  out.suit = VISEE[2] === 1;
  out.regard = regard[0] > 0;
  out.regardLacet = Math.atan2(regard[1], regard[2]);
  out.trait = { style: STYLES[uStyle.value], visible: MES[5] === 1 && mesh !== null && mesh.visible, x0: MES[0], z0: MES[1], x1: MES[2], z1: MES[3], demiLargeur: MES[4], apparition: uD.value.z };
  return out;
}
//#endregion e5:U-visee-souris
