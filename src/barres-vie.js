// Plan addictif, étape 4, chantier H — petite barre de vie au-dessus des gros robots (ARCHITECTURE.md § E4.H, demande
// de Femz du 16/11, 12h25 : « une petite barre de vie au dessus des gros mob, style elite etc », « fade out au bout d'un
// certain rayon pour moins de clutter visuel »).
//
// Qui : un type de BARRE.types (le blindé), une élite (EFLAG.ELITE) ou un fusionné (E.merged > 0) ; jamais le boss.
// Quoi : un quad face caméra au-dessus de la tête — fond sombre FUI, plein (rareté de l'élite, ou repère neutre), traîne
// de dégâts qui rejoint le plein sur un ressort critique ; bords anticrénelés au sous-pixel dans le shader.
// Opacité : visibilité (fondu d'entrée / de sortie : repli, veille) × distance au HÉROS (pleine jusqu'à rayon / zoom,
// puis 1 − smoothstep sur bande / zoom).
//
// Dessin : UN InstancedMesh `barres-vie` (+ 1 appel de dessin quand une barre est visible, 0 sinon), passé hors de l'effet
// CRT / pixel par render.garderNet (comme les chiffres de dégâts) : la traîne glisse au sous-pixel.
// Allocation (§ V) : sync n'alloue rien — locales numériques, tableaux typés ; dt lu dans DT (écrit par main.js) ; état
// par robot dans les colonnes E.barT / barV / barH / barF / barA (déplacées par la compaction de S13).
import * as THREE from 'three';
import { BARRE, CARRY_SCALE, CHESTS, EFLAG, ENEMIES, ENEMY, ENEMY_COUNT, PAREFEU_RESERVE, RARITIES, RARITY_COUNT } from './config.js';
import { GEN_SCALE } from './enemies-e3.js';
import { E, P, PAREFEU_F } from './state.js';

let render = null;
let camera = null;
let mesh = null;
let matArr = null;
let colArr = null;
let barArr = null;
let on = true;

/** dt de l'image (s), écrit par main.js avant sync (aucun flottant passé en argument, § V). */
export const DT = new Float32Array(1);

const CAP = BARRE.cap;
const BOSS_T = ENEMY.BOSS;
const isType = new Uint8Array(ENEMY_COUNT);
const hover = new Float32Array(ENEMY_COUNT);
const height = new Float32Array(ENEMY_COUNT);
const RAR = new Float32Array(RARITY_COUNT * 3); // couleurs linéaires des raretés
const NEUTRE = new Float32Array(3);
const BACK = new Float32Array(3);
const instIdx = new Int32Array(CAP); // indice dans E de chaque instance écrite (inspect)
// paramètres en tableau typé (lus en tête de sync : pas de champ d'objet relu dans la boucle)
const K = new Float32Array(16);
const K_PX = 0, K_WPR = 1, K_MIN = 2, K_MAX = 3, K_LIFT = 4, K_RAYON = 5, K_BANDE = 6, K_IN = 7, K_OUT = 8;
const K_HOLD = 9, K_OMEGA = 10, K_EPS = 11, K_HPX = 12, K_SCALE = 13, K_KR = 14, K_HY = 15;
// § E5.X (Femz, 20/11 soir) : barre du Pare-feu au-dessus du héros — [0] opacité (fondus), [1] plein affiché, [2] largeur (m)
const HB = new Float32Array(3);
const HCOL = new Float32Array(3);

// compteurs (inspect, tests)
let shown = 0;
let overflow = 0;
let eligible = 0;

const VERT = /* glsl */ `
attribute vec4 aBar;
varying vec2 vUv;
varying vec4 vBar;
varying vec3 vCol;
void main() {
  vUv = uv;
  vBar = aBar;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
// vBar : x = part de PV, y = traîne, z = opacité, w = largeur en pixels d'art. Coordonnées en pixels d'art ; chaque bord
// est une couverture (distance / fwidth) : le plein et la traîne avancent au sous-pixel, sans palier.
const FRAG = /* glsl */ `
uniform vec3 uBack;
uniform float uBackA;
uniform float uH;
uniform float uB;
uniform float uTrailMul;
varying vec2 vUv;
varying vec4 vBar;
varying vec3 vCol;
float cov(float d, float w) { return clamp(d / max(w, 1e-4) + 0.5, 0.0, 1.0); }
void main() {
  float W = vBar.w;
  vec2 p = vec2(vUv.x * W, vUv.y * uH);
  vec2 fw = fwidth(p);
  float inner = cov(p.y - uB, fw.y) * cov(uH - uB - p.y, fw.y) * cov(p.x - uB, fw.x);
  float iw = W - 2.0 * uB;
  float fillC = inner * cov(uB + iw * vBar.x - p.x, fw.x);
  float trailC = max(inner * cov(uB + iw * vBar.y - p.x, fw.x) - fillC, 0.0);
  float backC = 1.0 - fillC - trailC;
  float outer = cov(p.x, fw.x) * cov(W - p.x, fw.x) * cov(p.y, fw.y) * cov(uH - p.y, fw.y);
  vec3 col = uBack * backC + vCol * fillC + vCol * uTrailMul * trailC;
  float a = (uBackA * backC + fillC + trailC) * outer * vBar.z;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export function init(ctx) {
  render = ctx.render;
  camera = ctx.camera;
  for (let t = 0; t < ENEMY_COUNT; t++) {
    const T = ENEMIES.types[t];
    isType[t] = BARRE.types.indexOf(t) >= 0 ? 1 : 0;
    hover[t] = T.hover || 0;
    height[t] = T.height || 1;
  }
  for (let r = 0; r < RARITY_COUNT; r++) render.writeColor(RAR, r * 3, RARITIES[r].color);
  render.writeColor(NEUTRE, 0, BARRE.neutralColor);
  render.writeColor(BACK, 0, BARRE.backColor);
  K[K_PX] = BARRE.px;
  K[K_WPR] = BARRE.widthPerRadius;
  K[K_MIN] = BARRE.minM;
  K[K_MAX] = BARRE.maxM;
  K[K_LIFT] = BARRE.lift;
  K[K_RAYON] = BARRE.rayon;
  K[K_BANDE] = BARRE.bande;
  K[K_IN] = 1 / BARRE.fadeIn;
  K[K_OUT] = 1 / BARRE.fadeOut;
  K[K_HOLD] = BARRE.trail.hold;
  K[K_OMEGA] = BARRE.trail.omega;
  K[K_EPS] = BARRE.trail.eps;
  K[K_HPX] = BARRE.hPx;
  K[K_SCALE] = CHESTS.carrier.scale;
  K[K_KR] = BARRE.liftPerRadius;
  K[K_HY] = PAREFEU_RESERVE.barre.hauteur;
  HB[2] = PAREFEU_RESERVE.barre.largeurM;
  render.writeColor(HCOL, 0, PAREFEU_RESERVE.barre.couleur);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uBack: { value: new THREE.Vector3(BACK[0], BACK[1], BACK[2]) },
      uBackA: { value: BARRE.backAlpha },
      uH: { value: BARRE.hPx },
      uB: { value: BARRE.border },
      uTrailMul: { value: BARRE.trail.mul },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  const quad = new THREE.PlaneGeometry(1, 1);
  mesh = render.createInstanced(quad, mat, CAP, { instanceColor: true, name: 'barres-vie' });
  const aBar = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  aBar.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('aBar', aBar);
  mesh.renderOrder = BARRE.order;
  render.garderNet(mesh); // hors de l'effet CRT / pixel : la traîne glisse au sous-pixel (§ E4.H.2)
  matArr = mesh.instanceMatrix.array;
  colArr = mesh.instanceColor.array;
  barArr = aBar.array;
}

export function reset() {
  shown = 0;
  overflow = 0;
  eligible = 0;
  HB[0] = 0; // § E5.X : la barre du Pare-feu repart effacée
  HB[1] = 0;
  if (mesh !== null) render.commit(mesh, 0);
}

/** Coupe ou rallume le module (mesure des appels de dessin, tests). */
export function setOn(v) {
  on = !!v;
  if (!on && mesh !== null) {
    shown = 0;
    render.commit(mesh, 0);
  }
  return on;
}

/** F11 : barres des robots imposants, après elites.sync. */
export function sync() {
  if (mesh === null || !on) return;
  let dt = DT[0];
  dt = Math.min(Math.max(dt, 0), 0.05);
  const cam = camera.threeCamera;
  const w = cam.matrixWorld.elements;
  const rx = w[0], ry = w[1], rz = w[2];
  const ux = w[4], uy = w[5], uz = w[6];
  const fx = w[8], fy = w[9], fz = w[10];
  const zoom = camera.view.zoom > 0 ? camera.view.zoom : 1;
  const r0 = K[K_RAYON] / zoom;
  const band = K[K_BANDE] / zoom;
  const r1 = r0 + band;
  const pxM = K[K_PX];
  const hM = K[K_HPX] * pxM;
  const wpr = K[K_WPR];
  const minM = K[K_MIN];
  const maxM = K[K_MAX];
  const lift = K[K_LIFT];
  const kR = K[K_KR];
  const kIn = K[K_IN] * dt;
  const kOut = K[K_OUT] * dt;
  const hold = K[K_HOLD];
  const om = K[K_OMEGA];
  const om2 = om * om;
  const eps = K[K_EPS];
  const sc = K[K_SCALE];
  const hx = P.x;
  const hz = P.z;
  const ALIVE = E.alive, TYPE = E.type, FLAGS = E.flags, MERGED = E.merged, SUS = E.sus, GEN = E.gen, RARE = E.rarity;
  const X = E.x, Z = E.z, HP = E.hp, MAXHP = E.maxHp, RAD = E.radius;
  const BT = E.barT, BV = E.barV, BH = E.barH, BF = E.barF, BA = E.barA;
  const n = E.count;
  let k = 0;
  let el = 0;
  let over = 0;
  for (let i = 0; i < n; i++) {
    if (ALIVE[i] === 0) continue;
    const t = TYPE[i];
    if (t === BOSS_T) continue;
    const elite = (FLAGS[i] & EFLAG.ELITE) !== 0;
    const mg = MERGED[i];
    const veut = isType[t] !== 0 || elite || mg !== 0;
    if (!veut && BA[i] === 0) continue; // (un robot qui PERD sa barre — porteuse en retard, § E3.K — la voit s'effacer)
    if (veut) el++;
    const sus = SUS[i];
    if (sus === 2) {
      BA[i] = 0; // garé : ni dessiné ni mis à jour
      continue;
    }
    // part de PV et traîne (ressort critique vers le plein, après un maintien si elle était au repos)
    const mh = MAXHP[i];
    const f = mh > 0 ? Math.min(Math.max(HP[i] / mh, 0), 1) : 0;
    let tr = BT[i];
    let v = BV[i];
    let h = BH[i];
    if (tr <= f) {
      tr = f;
      v = 0;
      h = 0;
    } else {
      if (f < BF[i] && tr - BF[i] <= eps && v > -eps) h = hold; // coup sur une traîne au repos : elle reste un instant
      if (h > 0) {
        h -= dt;
        v = 0;
      } else {
        v += (-2 * om * v - om2 * (tr - f)) * dt;
        tr += v * dt;
        if (tr <= f + eps * 0.25) {
          tr = f;
          v = 0;
        }
      }
    }
    BT[i] = tr;
    BV[i] = v;
    BH[i] = h;
    BF[i] = f;
    // visibilité : fondu d'entrée en jeu, de sortie en repli / veille (jamais une disparition en une image)
    let a = BA[i];
    a = sus === 0 && veut ? Math.min(a + kIn, 1) : Math.max(a - kOut, 0);
    BA[i] = a;
    // distance au héros : pleine jusqu'à r0, 1 − smoothstep sur la bande, 0 au-delà
    const dx = X[i] - hx;
    const dz = Z[i] - hz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= r1) continue;
    let s = (d - r0) / band;
    s = Math.min(Math.max(s, 0), 1);
    const alpha = a * (1 - s * s * (3 - 2 * s));
    if (alpha <= 0.002) continue;
    if (k >= CAP) {
      over++;
      continue;
    }
    // taille dessinée (même calcul que anim/allure.js) et largeur au pixel d'art
    let u = elite ? sc : 1;
    if (mg !== 0) u *= CARRY_SCALE[mg];
    if (GEN[i] !== 0) u *= GEN_SCALE[GEN[i]];
    // haut de la tête, puis vers le HAUT DE L'ÉCRAN : au-dessus du bord arrière du robot (rayon × sin de l'inclinaison)
    const up = RAD[i] * fy * kR + lift;
    const y = hover[t] + height[t] * u + uy * up;
    const wm0 = Math.min(Math.max(RAD[i] * wpr, minM), maxM);
    const wpx = Math.round(wm0 / pxM);
    const wm = wpx * pxM;
    const o = k * 16;
    matArr[o] = rx * wm;
    matArr[o + 1] = ry * wm;
    matArr[o + 2] = rz * wm;
    matArr[o + 3] = 0;
    matArr[o + 4] = ux * hM;
    matArr[o + 5] = uy * hM;
    matArr[o + 6] = uz * hM;
    matArr[o + 7] = 0;
    matArr[o + 8] = fx;
    matArr[o + 9] = fy;
    matArr[o + 10] = fz;
    matArr[o + 11] = 0;
    matArr[o + 12] = X[i] + ux * up;
    matArr[o + 13] = y;
    matArr[o + 14] = Z[i] + uz * up;
    matArr[o + 15] = 1;
    const q = k * 3;
    if (elite) {
      const c = RARE[i] * 3;
      colArr[q] = RAR[c];
      colArr[q + 1] = RAR[c + 1];
      colArr[q + 2] = RAR[c + 2];
    } else {
      colArr[q] = NEUTRE[0];
      colArr[q + 1] = NEUTRE[1];
      colArr[q + 2] = NEUTRE[2];
    }
    const b = k * 4;
    barArr[b] = f;
    barArr[b + 1] = tr;
    barArr[b + 2] = alpha;
    barArr[b + 3] = wpx;
    instIdx[k] = i;
    k++;
  }
  // § E5.X (Femz, 20/11 soir) : barre bleue du Pare-feu au-dessus du héros tant qu'il est chargé (PAREFEU_F[0] ≥ 0, écrit
  // par items.js) ; plein = réserve restante ; fondus d'entrée / de sortie des barres ; pas de fondu de distance
  const res = PAREFEU_F[0];
  const vise = res >= 0 && P.alive;
  let ha = HB[0];
  ha = vise ? Math.min(ha + kIn, 1) : Math.max(ha - kOut, 0);
  HB[0] = ha;
  if (vise) HB[1] = res; // pendant le fondu de sortie : le dernier plein reste affiché
  if (ha > 0.002 && k < CAP) {
    const wpx = Math.round(HB[2] / pxM);
    const wm = wpx * pxM;
    const o = k * 16;
    matArr[o] = rx * wm;
    matArr[o + 1] = ry * wm;
    matArr[o + 2] = rz * wm;
    matArr[o + 3] = 0;
    matArr[o + 4] = ux * hM;
    matArr[o + 5] = uy * hM;
    matArr[o + 6] = uz * hM;
    matArr[o + 7] = 0;
    matArr[o + 8] = fx;
    matArr[o + 9] = fy;
    matArr[o + 10] = fz;
    matArr[o + 11] = 0;
    matArr[o + 12] = hx + ux * lift;
    matArr[o + 13] = K[K_HY] + uy * lift;
    matArr[o + 14] = hz + uz * lift;
    matArr[o + 15] = 1;
    const q = k * 3;
    colArr[q] = HCOL[0];
    colArr[q + 1] = HCOL[1];
    colArr[q + 2] = HCOL[2];
    const b = k * 4;
    barArr[b] = HB[1];
    barArr[b + 1] = HB[1];
    barArr[b + 2] = ha;
    barArr[b + 3] = wpx;
    instIdx[k] = -1;
    k++;
  }
  if (k > 0) mesh.geometry.attributes.aBar.needsUpdate = true;
  shown = k;
  eligible = el;
  overflow += over;
  render.commit(mesh, k);
}

const _v = new THREE.Vector3();
/** Relevé (debug, hors combat : allocation tolérée) ; liste = barres écrites à la dernière image, rectangle à l'écran en px CSS. */
export function inspect(out, withList = false) {
  out.on = on;
  out.shown = shown;
  out.eligible = eligible;
  out.overflow = overflow;
  out.cap = CAP;
  out.visible = mesh !== null && mesh.visible;
  if (!withList || mesh === null) return out;
  const cam = camera.threeCamera;
  const view = camera.view;
  const list = [];
  for (let k = 0; k < shown; k++) {
    const i = instIdx[k];
    const m = matArr.subarray(k * 16, k * 16 + 16);
    const b = barArr.subarray(k * 4, k * 4 + 4);
    // coins du quad (plan -0,5..0,5) projetés en px CSS
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [sx, sy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      _v.set(m[12] + m[0] * sx + m[4] * sy, m[13] + m[1] * sx + m[5] * sy, m[14] + m[2] * sx + m[6] * sy).project(cam);
      const px = ((_v.x + 1) / 2) * view.widthPx;
      const py = ((1 - _v.y) / 2) * view.heightPx;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    list.push({
      i,
      heros: i < 0, // § E5.X : barre du Pare-feu au-dessus du héros
      uid: E.uid[i],
      type: E.type[i],
      elite: (E.flags[i] & EFLAG.ELITE) !== 0,
      merged: E.merged[i],
      rarity: E.rarity[i],
      hp: E.hp[i],
      maxHp: E.maxHp[i],
      frac: b[0],
      trail: b[1],
      alpha: b[2],
      vis: E.barA[i],
      widthPx: b[3],
      widthM: Math.hypot(m[0], m[1], m[2]),
      heightM: Math.hypot(m[4], m[5], m[6]),
      x: m[12],
      y: m[13],
      z: m[14],
      dist: Math.hypot(E.x[i] - P.x, E.z[i] - P.z),
      color: [colArr[k * 3], colArr[k * 3 + 1], colArr[k * 3 + 2]],
      rect: { x0, x1, y0, y1 },
    });
  }
  out.list = list;
  return out;
}
