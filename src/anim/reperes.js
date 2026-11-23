// ANIMATIONS v2 — repères au sol du héros : R1 (recharge du dash, anneau à crans + ping) et R2 (santé basse,
// battement « lub-dub »), selon le RETOUR DE FEMZ du 13/11/2026 (docs/animations-plan.md, bloc qui prime sur R1/R2/P1) :
//   1. POSÉS AU SOL : y = 3 cm, test de profondeur, sans écriture de profondeur, polygonOffset ; matériaux transparents,
//      donc dessinés après tous les opaques : le corps du héros (opaque, déjà dans la profondeur) cache l'arc du HAUT de
//      l'écran, l'arc du bas passe devant ses pieds ; les robots debout sur l'anneau le cachent aussi (accepté).
//      Plus de technique « contours du boss » (depthTest false) pour les repères du joueur.
//   2. FONDU DE SORTIE quand l'état ne change plus : R1 visible pendant la recharge et le ping, puis fondu (0,5 s,
//      ease-out) ; R2 apparaît au franchissement du seuil et à chaque changement de PV, puis fondu après 1,5 s sans
//      changement. Le battement du corps (+4 %) continue sous le seuil même anneau éteint (validé par Femz).
// Deux InstancedMesh, deux appels de dessin au plus (0 quand rien n'est visible : count = 0) :
//   - crans (R1) : 10 instances d'un arc ; attribut d'instance aTeinte (rgb linéaire × gain, alpha) écrit en ligne
//     chaque image, comme aFx (pas de setColorAt : aucune conversion, aucune allocation) ;
//   - anneaux : onde du ping (R1), anneau de R2 et ses deux ondes ; rayon et largeur par instance (aForme) : une onde
//     garde sa finesse en s'éloignant ; cœur et liseré de couleurs distinctes (aCoeur, aBord).
// Temps simulé seulement (figé par le hitstop et les menus) ; même cran allumé au même temps à 60 et 240 Hz.
//
// INTÉGRATION (src/player.js) :
//   - init : reperes.init(scene) ; retirer l'anneau P1 (PLAYER.marker, « joueur-anneau », depthTest false).
//   - update(dt) : reperes.update(dt) à la FIN de player.update (après l'étape 1 qui joue SFX.DASH_READY : le ping part
//     du même pas que le son ; après les dégâts de l'image précédente). Aucun appel depuis damage.js : la baisse de
//     P.hp est lue d'un pas à l'autre.
//   - sync : reperes.sync() AVANT heros.sync() (il écrit heros.extra : gonflement du corps et lueur du ping).
//   - reset : reperes.reset().
//   - clés : ANIM.reperes → PLAYER.cues (dash, lowHp, intensity, y).
//   INTÉGRÉ (étape « animations », ARCHITECTURE.md § Z sexies) : player.js appelle init / update / sync / reset ; la
//   recharge complète du dash arrive par `entree[0]` (player.getDashCooldown(), écrit avant update : plus d'import
//   circulaire de player.js, aucun flottant passé en argument).
import * as THREE from 'three';
import { P } from '../state.js';
import { view } from '../camera.js';
import { ANIM } from './reglages.js';
import { extra } from './heros-anim.js';
import { ACTIONS_IMPOSSIBLES, RENDER } from '../config.js'; // § E5.X6 (D2, D14)

const R = ANIM.reperes;
const D = R.dash;
const L = R.lowHp;
const NC = D.segments;
const TWO_PI = Math.PI * 2;
const CYAN = new THREE.Color(0x3fe0d0); // PALETTE.playerAccent (linéaire)
const ROUGE = new THREE.Color(0xff3b3b); // PALETTE.robotEye
const PING = new THREE.Color(0xc8fff8); // blanc-cyan du ping

// état (tableaux typés : § V)
const R1_CD = 0; // dashCd au pas précédent
const R1_LIT = 1; // crans allumés
const R1_PING = 2; // s depuis le ping
const R1_VIS = 3; // visibilité 0..1
const R2_ON = 4;
const R2_PHASE = 5;
const R2_VIS = 6;
const R2_CHANGE = 7; // s depuis le dernier changement de PV
const R2_REF = 8; // PV de référence
const R2_ENV = 9; // enveloppe du battement du corps (0..1, suit R2_ON en fadeIn)
const R2_HP = 10; // PV au pas précédent
const R1_REFUS = 11; // § E5.X6 (D2) : s depuis le dernier dash refusé (ping rouge)
const S = new Float64Array(12);
const X6_PING = ACTIONS_IMPOSSIBLES.dash.pingS;
const X6_GONFLE = ACTIONS_IMPOSSIBLES.dash.pingGonfle;
const popT = new Float64Array(NC);
const waveAge = new Float64Array(2);
let waveNext = 0;
const reduit = { mouvement: false };
/**
 * Entrée de update() : [0] = recharge complète du dash (s), écrite par player.js avant l'appel ; § E5.X6 : [1] = 1 si un
 * dash vient d'être refusé (player.js ; remis à 0 ici) ; [2] = 1 si la silhouette du héros dans la foule est allumée
 * (silhouette-heros.sync, image précédente) : R1 passe alors par-dessus les robots.
 */
export const entree = new Float64Array(3);
entree[0] = 1;

let crans = null;
let cransFoule = null; // § E5.X6 (D14) : mêmes crans, sans test de profondeur, dessinés quand le héros est dans la foule
let anneaux = null;
let aTeinte = null;
let aCoeur = null;
let aBord = null;
let aForme = null;

// § E5.X6 (D14) : foule = la copie dessinée par-dessus les robots. Elle est rendue hors de l'effet CRT (garderNet),
// directement à l'écran : ni bloom ni passe finale pour éclaircir la teinte linéaire (mesuré : crans éteints invisibles,
// 0/31 points de l'arc bas). Sa teinte est donc passée en sRGB, × FOULE_GAIN, et son alpha × FOULE_GAIN (plafonné à 1).
function materiauCrans(foule = false) {
  return new THREE.ShaderMaterial({
    vertexShader: `attribute vec4 aTeinte; varying vec4 vT;
      void main() { vT = aTeinte; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: foule
      ? `varying vec4 vT; void main() { gl_FragColor = vec4( pow( clamp( vT.rgb * 1.6, 0.0, 1.0 ), vec3( 0.4545 ) ), min( 1.0, vT.a * 1.6 ) ); }`
      : `varying vec4 vT; void main() { gl_FragColor = vec4( vT.rgb, vT.a ); }`,
    transparent: true,
    depthTest: !foule,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function materiauAnneaux() {
  return new THREE.ShaderMaterial({
    vertexShader: `attribute vec2 aRad; attribute vec4 aCoeur; attribute vec4 aBord; attribute vec3 aForme;
      varying vec4 vC;
      void main() {
        // aRad.x : position dans la largeur (0 = bord intérieur, 1 = extérieur) ; aRad.y : 1 = liseré, 0 = cœur
        float r = aForme.x + ( aRad.x - 0.5 ) * aForme.y;
        vec3 p = vec3( position.x * r, 0.0, position.z * r );
        vC = mix( aCoeur, aBord, aRad.y );
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( p, 1.0 );
      }`,
    fragmentShader: `varying vec4 vC; void main() { gl_FragColor = vC; }`,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** Géométrie d'anneau à bande : 6 stations radiales (liseré, cœur, liseré), arêtes franches entre bandes. */
function geometrieAnneau(n = 64, rim = 0.28) {
  const st = [
    [0, 1],
    [rim, 1],
    [rim, 0],
    [1 - rim, 0],
    [1 - rim, 1],
    [1, 1],
  ];
  const pos = [];
  const rad = [];
  const idx = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TWO_PI;
    for (const [s, b] of st) {
      pos.push(Math.cos(a), 0, Math.sin(a));
      rad.push(s, b);
    }
  }
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 5; k++) {
      if (k === 1 || k === 3) continue; // stations dédoublées : pas de triangle entre elles
      const a = i * 6 + k;
      const b = a + 6;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRad', new THREE.Float32BufferAttribute(rad, 2));
  g.setIndex(idx);
  return g;
}

function instAttr(g, n, k) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n * k), k);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
}

export function init(scene, render = null) {
  // R1 : un cran = un arc couché, centré sur +X local
  const len = TWO_PI / NC - (D.gapDeg * Math.PI) / 180;
  const cg = new THREE.RingGeometry(D.radius - D.width / 2, D.radius + D.width / 2, 4, 1, -len / 2, len);
  cg.rotateX(-Math.PI / 2);
  aTeinte = instAttr(cg, NC, 4);
  cg.setAttribute('aTeinte', aTeinte);
  crans = new THREE.InstancedMesh(cg, materiauCrans(), NC);
  crans.name = 'reperes-crans';
  crans.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  crans.frustumCulled = false;
  crans.count = 0;
  scene.add(crans);
  // § E5.X6 (D14) : la même géométrie (aTeinte compris) et la même matrice d'instances, matériau sans test de profondeur ;
  // rangé comme la silhouette du héros (garderNet), juste sous elle : le corps en aplat passe devant l'arc du haut
  const mf = materiauCrans(true);
  cransFoule = new THREE.InstancedMesh(cg, mf, NC);
  cransFoule.name = 'reperes-crans-foule';
  cransFoule.instanceMatrix = crans.instanceMatrix;
  cransFoule.frustumCulled = false;
  cransFoule.count = 0;
  cransFoule.renderOrder = RENDER.decals.numbersOrder + 0.5;
  scene.add(cransFoule);
  if (render && render.garderNet) render.garderNet(cransFoule);
  // anneaux : 0 = onde du ping, 1 = anneau R2, 2-3 = ondes R2
  const ag = geometrieAnneau();
  aCoeur = instAttr(ag, 4, 4);
  aBord = instAttr(ag, 4, 4);
  aForme = instAttr(ag, 4, 3);
  ag.setAttribute('aCoeur', aCoeur);
  ag.setAttribute('aBord', aBord);
  ag.setAttribute('aForme', aForme);
  anneaux = new THREE.InstancedMesh(ag, materiauAnneaux(), 4);
  anneaux.name = 'reperes-anneaux';
  anneaux.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  anneaux.frustumCulled = false;
  anneaux.count = 0;
  scene.add(anneaux);
  try {
    reduit.mouvement = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) {
    reduit.mouvement = false;
  }
  reset();
}

export function reset() {
  S.fill(0);
  S[R1_LIT] = NC;
  S[R1_PING] = 1e3;
  S[R1_REFUS] = 1e3; // § E5.X6
  entree[1] = 0;
  S[R2_CHANGE] = 1e3;
  S[R2_REF] = P.hp;
  S[R2_HP] = P.hp;
  popT.fill(1e3);
  waveAge.fill(1e3);
  extra[0] = 0;
  extra[1] = 0;
}

// arguments flottants des fonctions d'écriture : passés par ce tableau (§ V : un flottant passé en argument est
// emballé — mesuré : 389 o/image avant ce changement)
const ARG = new Float64Array(12);

export function update(dt) {
  if (!crans || !(dt > 0)) return;
  // ----- R1
  const cd = P.dashCd;
  const prevCd = S[R1_CD];
  if (cd > 0 && (prevCd <= 0 || cd > prevCd + 1e-6)) S[R1_LIT] = 0; // dash lancé : l'anneau se vide d'un coup
  if (prevCd > 0 && cd <= 0) S[R1_PING] = 0; // même pas que audio.play(SFX.DASH_READY)
  else S[R1_PING] += dt;
  // § E5.X6 (D2) : dash refusé — ping rouge (relancé à chaque refus)
  if (entree[1] === 1) {
    entree[1] = 0;
    S[R1_REFUS] = 0;
  } else S[R1_REFUS] += dt;
  const total = entree[0] > 0 ? entree[0] : 1;
  const frac = cd > 0 ? 1 - cd / total : 1;
  let lit = cd > 0 ? Math.floor(frac * NC + 1e-9) : NC;
  if (lit > NC) lit = NC;
  for (let k = S[R1_LIT]; k < lit; k++) popT[k] = 0;
  if (lit > S[R1_LIT]) S[R1_LIT] = lit;
  for (let k = 0; k < NC; k++) popT[k] += dt;
  S[R1_CD] = cd;
  const vis1 = S[R1_VIS];
  const tFin = S[R1_PING] - D.pingSeconds - D.fadeOutDelay;
  if (cd > 0 || tFin < 0 || S[R1_REFUS] < X6_PING) S[R1_VIS] = vis1 + dt / D.fadeInSeconds > 1 ? 1 : vis1 + dt / D.fadeInSeconds;
  else S[R1_VIS] = vis1 - dt / D.fadeOutSeconds < 0 ? 0 : vis1 - dt / D.fadeOutSeconds;
  // ----- R2
  const f = P.maxHp > 0 ? P.hp / P.maxHp : 1;
  if (S[R2_ON] === 0 && f < L.threshold && P.alive) {
    S[R2_ON] = 1;
    S[R2_CHANGE] = 0;
    S[R2_REF] = P.hp;
    S[R2_PHASE] = 0;
  } else if (S[R2_ON] === 1 && (f > L.exitThreshold || !P.alive)) S[R2_ON] = 0;
  S[R2_CHANGE] += dt;
  if (P.hp < S[R2_HP] - 1e-6) {
    // coup reçu : changement, et le battement repart du début (coup et cœur tombent ensemble)
    S[R2_CHANGE] = 0;
    S[R2_REF] = P.hp;
    if (S[R2_ON] === 1) S[R2_PHASE] = 0;
  } else if (P.hp - S[R2_REF] >= L.changeMin * P.maxHp) {
    S[R2_CHANGE] = 0; // soin (ou régénération cumulée)
    S[R2_REF] = P.hp;
  }
  S[R2_HP] = P.hp;
  let s = (L.threshold - f) / (L.threshold - L.critical);
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  const T = L.periodHigh + (L.periodLow - L.periodHigh) * s;
  const ph = S[R2_PHASE] + dt / T;
  const visible2 = S[R2_ON] === 1 && S[R2_CHANGE] < L.fadeOutDelay;
  if (ph >= 1 || (S[R2_PHASE] === 0 && S[R2_ON] === 1 && S[R2_CHANGE] === 0)) {
    // premier battement de chaque période : une onde part (seulement si l'anneau se voit)
    if (visible2 || S[R2_VIS] > 0.05) {
      waveAge[waveNext] = ph >= 1 ? (ph - 1) * T : 0;
      waveNext = (waveNext + 1) & 1;
    }
  }
  S[R2_PHASE] = ph >= 1 ? ph - 1 : ph;
  waveAge[0] += dt;
  waveAge[1] += dt;
  const v2 = S[R2_VIS];
  if (visible2) S[R2_VIS] = v2 + dt / L.fadeInSeconds > 1 ? 1 : v2 + dt / L.fadeInSeconds;
  else S[R2_VIS] = v2 - dt / L.fadeOutSeconds < 0 ? 0 : v2 - dt / L.fadeOutSeconds;
  const env = S[R2_ENV];
  const envT = S[R2_ON] === 1 ? 1 : 0;
  S[R2_ENV] = env + (envT - env) * (1 - Math.exp(-dt / 0.12));
}

function cranMatrice(arr, o) {
  const x = ARG[0];
  const z = ARG[1];
  const ang = ARG[2];
  const sc = ARG[3];
  // direction du cran : depuis le haut de l'écran, sens horaire (vers la droite de l'écran)
  const dx = view.upX * Math.cos(ang) + view.rightX * Math.sin(ang);
  const dz = view.upZ * Math.cos(ang) + view.rightZ * Math.sin(ang);
  const phi = Math.atan2(-dz, dx);
  const c = Math.cos(phi) * sc;
  const s = Math.sin(phi) * sc;
  arr[o] = c;
  arr[o + 1] = 0;
  arr[o + 2] = -s;
  arr[o + 3] = 0;
  arr[o + 4] = 0;
  arr[o + 5] = sc;
  arr[o + 6] = 0;
  arr[o + 7] = 0;
  arr[o + 8] = s;
  arr[o + 9] = 0;
  arr[o + 10] = c;
  arr[o + 11] = 0;
  arr[o + 12] = x;
  arr[o + 13] = R.y;
  arr[o + 14] = z;
  arr[o + 15] = 1;
}

/** Instance k du maillage d'anneaux ; ARG = x, z, rayon, largeur, cœur rgba, liseré rgba. */
function anneau(k) {
  const x = ARG[0];
  const z = ARG[1];
  const m = anneaux.instanceMatrix.array;
  const o = k * 16;
  m[o] = 1;
  m[o + 1] = 0;
  m[o + 2] = 0;
  m[o + 3] = 0;
  m[o + 4] = 0;
  m[o + 5] = 1;
  m[o + 6] = 0;
  m[o + 7] = 0;
  m[o + 8] = 0;
  m[o + 9] = 0;
  m[o + 10] = 1;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = R.y + 0.002 * k;
  m[o + 14] = z;
  m[o + 15] = 1;
  const c = aCoeur.array;
  const b = aBord.array;
  const f = aForme.array;
  c[k * 4] = ARG[4];
  c[k * 4 + 1] = ARG[5];
  c[k * 4 + 2] = ARG[6];
  c[k * 4 + 3] = ARG[7];
  b[k * 4] = ARG[8];
  b[k * 4 + 1] = ARG[9];
  b[k * 4 + 2] = ARG[10];
  b[k * 4 + 3] = ARG[11];
  f[k * 3] = ARG[2];
  f[k * 3 + 1] = ARG[3];
  f[k * 3 + 2] = 0;
}

/** Avant heros.sync : écrit les instances et heros.extra (gonflement du corps, lueur du ping). */
export function sync() {
  if (!crans) return;
  const I = R.intensity;
  const x = P.x;
  const z = P.z;
  extra[0] = 0;
  extra[1] = 0;
  if (!P.alive || I <= 0) {
    crans.count = 0;
    cransFoule.count = 0; // § E5.X6
    anneaux.count = 0;
    return;
  }
  // ----- R1
  const v1 = S[R1_VIS];
  const u = S[R1_PING] / D.pingSeconds;
  const ping = u < 1 ? 1 - u : 0; // enveloppe du ping (1 → 0)
  let swell = u < 1 ? 1 + D.pingSwell * Math.sin(Math.PI * Math.sqrt(u)) : 1;
  // § E5.X6 (D2) : ping rouge du refus (enveloppe 1 → 0 en X6_PING s), l'anneau gonfle un instant
  const ur = S[R1_REFUS] / X6_PING;
  const refus = ur < 1 ? 1 - ur : 0;
  if (refus > 0) swell += X6_GONFLE * Math.sin(Math.PI * ur);
  if (v1 > 0) {
    const a1 = (1 - (1 - v1) * (1 - v1)) * I; // fondu : ease-out (la fin s'étire)
    const arr = crans.instanceMatrix.array;
    const t = aTeinte.array;
    const lit = S[R1_LIT];
    for (let k = 0; k < NC; k++) {
      const on = k < lit;
      const p = popT[k] < D.segPopSeconds ? 1 + (D.segPop - 1) * (1 - popT[k] / D.segPopSeconds) : 1;
      ARG[0] = x;
      ARG[1] = z;
      ARG[2] = (k + 0.5) * (TWO_PI / NC);
      ARG[3] = (on ? p : 1) * swell;
      cranMatrice(arr, k * 16);
      let g = on ? D.fillGain : D.trackGain;
      let r = CYAN.r;
      let gg = CYAN.g;
      let b = CYAN.b;
      if (ping > 0) {
        const w = ping;
        g = g + (D.pingGain - g) * w;
        r += (PING.r - r) * w;
        gg += (PING.g - gg) * w;
        b += (PING.b - b) * w;
      }
      if (refus > 0) {
        // § E5.X6 (D2) : crans (allumés et éteints) au rouge des yeux des robots, au gain du ping
        g = g + (D.pingGain - g) * refus;
        r += (ROUGE.r - r) * refus;
        gg += (ROUGE.g - gg) * refus;
        b += (ROUGE.b - b) * refus;
      }
      t[k * 4] = r * g;
      t[k * 4 + 1] = gg * g;
      t[k * 4 + 2] = b * g;
      t[k * 4 + 3] = (on || refus > 0 ? 0.95 : 0.4) * a1;
    }
    // § E5.X6 (D14) : dans la foule, les crans passent par-dessus les robots (un seul des deux maillages est dessiné)
    const foule = entree[2] === 1;
    crans.count = foule ? 0 : NC;
    cransFoule.count = foule ? NC : 0;
    crans.instanceMatrix.needsUpdate = true;
    aTeinte.needsUpdate = true;
  } else {
    crans.count = 0;
    cransFoule.count = 0; // § E5.X6
  }
  extra[1] = ping * D.pingAccentGlow * I;
  // ----- anneaux : 0 = onde du ping, 1 = R2, 2-3 = ondes de R2
  let n = 0;
  if (u < 1 && !reduit.mouvement) {
    const e = 1 - (1 - u) * (1 - u);
    const a = (1 - u) * 0.9 * I;
    ARG[0] = x;
    ARG[1] = z;
    ARG[2] = D.radius * (1 + (D.pingWave - 1) * e);
    ARG[3] = 0.07;
    ARG[4] = PING.r * 1.6;
    ARG[5] = PING.g * 1.6;
    ARG[6] = PING.b * 1.6;
    ARG[7] = a;
    ARG[8] = CYAN.r * 1.3;
    ARG[9] = CYAN.g * 1.3;
    ARG[10] = CYAN.b * 1.3;
    ARG[11] = a;
    anneau(0);
    n = 1;
  } else {
    ARG.fill(0);
    anneau(0);
  }
  const ph = S[R2_PHASE];
  const BW = L.beatWidth;
  const ph2 = ph - L.secondBeatAt;
  const b1 = ph > 0 && ph < BW ? Math.sin((Math.PI * ph) / BW) : 0;
  const b2 = ph2 > 0 && ph2 < BW ? L.secondBeat * Math.sin((Math.PI * ph2) / BW) : 0;
  const beat = b1 > b2 ? b1 : b2;
  extra[0] = L.bodySwell * beat * S[R2_ENV] * I;
  const v2 = S[R2_VIS];
  if (v2 > 0 || waveAge[0] < L.waveSeconds || waveAge[1] < L.waveSeconds) {
    const a2 = (1 - (1 - v2) * (1 - v2)) * I;
    const gc = L.gain * (0.75 + 0.6 * beat);
    const gb = 0.85 + 0.6 * beat;
    ARG[0] = x;
    ARG[1] = z;
    ARG[2] = L.radius * (1 + L.swell * beat);
    ARG[3] = L.width;
    ARG[4] = ROUGE.r * gc;
    ARG[5] = ROUGE.g * gc;
    ARG[6] = ROUGE.b * gc;
    ARG[7] = a2;
    ARG[8] = gb;
    ARG[9] = gb;
    ARG[10] = gb;
    ARG[11] = a2;
    anneau(1);
    for (let w = 0; w < 2; w++) {
      const age = waveAge[w];
      if (age < L.waveSeconds && !reduit.mouvement) {
        const k = age / L.waveSeconds;
        const e = 1 - (1 - k) * (1 - k);
        const a = Math.pow(1 - k, 1.5) * 0.85 * I * (v2 > 0.3 ? 1 : v2 / 0.3);
        ARG[0] = x;
        ARG[1] = z;
        ARG[2] = L.radius + (L.waveTo - L.radius) * e;
        ARG[3] = 0.075;
        ARG[4] = ROUGE.r * L.gain;
        ARG[5] = ROUGE.g * L.gain;
        ARG[6] = ROUGE.b * L.gain;
        ARG[7] = a * 0.8;
        ARG[8] = 1;
        ARG[9] = 1;
        ARG[10] = 1;
        ARG[11] = a;
        anneau(2 + w);
      } else {
        ARG.fill(0);
        anneau(2 + w);
      }
    }
    n = 4;
  }
  anneaux.count = n;
  if (n) {
    anneaux.instanceMatrix.needsUpdate = true;
    aCoeur.needsUpdate = true;
    aBord.needsUpdate = true;
    aForme.needsUpdate = true;
  }
}

export function setVisible(on) {
  if (crans) crans.visible = anneaux.visible = cransFoule.visible = !!on; // § E5.X6 : la copie de la foule suit
}

export function inspect(out) {
  out.r1 = { visibilite: S[R1_VIS], crans: S[R1_LIT], pingT: S[R1_PING], dessines: crans ? crans.count : 0, refusT: S[R1_REFUS], foule: cransFoule ? cransFoule.count : 0 }; // § E5.X6 : refusT, foule
  out.r2 = { actif: S[R2_ON], visibilite: S[R2_VIS], phase: S[R2_PHASE], depuisChangement: S[R2_CHANGE], gonflement: extra[0], ondes: [waveAge[0], waveAge[1]] };
}

// ----- prototype (tests/anim/proto.js) : branchement à l'exécution -----------------------------------------------
const proto = { actif: false };
export function brancher({ scene }) {
  init(scene);
  setVisible(false);
}
export function protoSetApres(on) {
  proto.actif = !!on;
  setVisible(proto.actif);
  if (!proto.actif) {
    extra[0] = 0;
    extra[1] = 0;
  }
}
export function protoUpdate(dt) {
  update(dt);
}
export function protoAvantHeros() {
  if (proto.actif) sync();
}
export const protoInspect = inspect;
/** § E5.X6 : tests (hors chemin chaud) — les deux maillages des crans de R1. */
export function maillagesX6() {
  return { crans, cransFoule };
}
