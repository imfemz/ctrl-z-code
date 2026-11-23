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
import { BARRE, BARRE_VIE, CARRY_SCALE, CHESTS, CONFORT_FLASHS, EFLAG, ENEMIES, ENEMY, ENEMY_COUNT, PAREFEU_RESERVE, RARITIES, RARITY_COUNT, RETOURS_GUIDE } from './config.js';
import { COUPS_RECUS } from './damage.js';
import { GEN_SCALE } from './enemies-e3.js';
import { E, P, PAREFEU_F, SOIN_SIGNAUX } from './state.js';

let render = null;
let camera = null;
let mesh = null;
let matArr = null;
let colArr = null;
let barArr = null;
let on = true;

/** [0] dt réel de l'image (s), [1] dt de simulation (§ E5.AI : attente du fondu en temps de jeu) ; écrits par main.js
 * avant sync (aucun flottant passé en argument, § V). */
export const DT = new Float32Array(2);

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
const K_HOLD = 9, K_OMEGA = 10, K_EPS = 11, K_HPX = 12, K_SCALE = 13, K_KR = 14;
//#region e5:AI-barre-vie
// § E5.AI (Femz, 22/11) : barre du héros — bouclier du Pare-feu chargé (bleu) ou PV (vert), au même endroit que la barre
// bleue du § E5.X (qu'elle remplace), taille fixe à l'écran, icône cœur / bouclier à gauche (InstancedMesh), fondu après
// BARRE_VIE.fondu.delaiS s sans dégât. État en tableaux typés (aucun champ d'objet, aucune allocation par image).
const H = new Float64Array(32);
const H_A = 0; // visibilité linéaire 0..1 (fondus d'entrée / de sortie)
const H_T = 1; // s de JEU avant le fondu de sortie (attente)
const H_F = 2; // plein affiché
const H_V = 3; // vitesse du ressort de montée du plein
const H_TR = 4; // traîne
const H_TV = 5; // vitesse de la traîne
const H_TH = 6; // maintien de la traîne (s)
const H_TF = 7; // plein affiché à l'image d'avant (traîne au repos)
const H_M = 8; // passage PV (0) → bouclier (1), linéaire : couleur et fondu croisé des icônes
const H_RES = 9; // PAREFEU_F[0] à l'image d'avant (−1 : pas chargé)
const H_HP = 10; // P.hp à l'image d'avant (−1 : inconnu, début de partie)
const H_PH = 11; // phase du clignotement du cœur (tours, 0..1)
const H_ECL = 12; // s d'éclat de soin restantes
const H_MODE = 13; // 1 : bouclier affiché à l'image d'avant
const H_ALPHA = 14; // opacité appliquée (smoothstep de H_A) — inspect
const H_BLINK = 15; // luminosité du cœur — inspect
const H_UN = 16; // un pixel d'art, en m dans le plan de la caméra — inspect
const H_FC = 17; // plein visé (part de PV ou réserve) — inspect
const H_X = 18; // centre de la barre (18, 19, 20), de l'icône (21, 22, 23)
const H_IX = 21;
const H_LOW = 24; // 1 : PV sous basPV
const H_COUL = 25; // couleur appliquée (25, 26, 27, linéaire)
const H_COEUR = 28; // opacité du cœur, du bouclier (29)
const HI = new Uint32Array(2); // [0] COUPS_RECUS vus, [1] SOIN_SIGNAUX[0] vus
// Entrées de la barre du héros (fin de sync), copiées par sync (aucune opération : de simples copies) : la barre ne lit QUE des tableaux
// typés, amorcés à l'init avec des valeurs fractionnaires (voir amorcer). Piège mesuré le 22/11 (--trace-deopt) : à PV
// pleins, P.hp / P.maxHp vaut 1 pile, le retour de type de la division (et de ce qui suit) est « entier » ; à la 1re part
// fractionnaire, Maglev désoptimise (« not int32 ») et le code de base emballe chaque flottant (≈ 2 Ko par image).
const IN = new Float64Array(24);
const I_HP = 0, I_MAX = 1, I_VIE = 2, I_RES = 3, I_X = 4, I_Z = 5, I_RD = 6, I_SD = 7, I_RED = 8;
const I_W = 9; // matrice monde de la caméra : éléments 0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14 → I_W + 0 … 11
const PVC = new Float32Array(3); // vert des PV (linéaire)
const BLC = new Float32Array(3); // bleu du Pare-feu (linéaire)
// réglages lus une fois (constantes de module : aucune propriété relue à chaque image)
const BV = BARRE_VIE;
const BV_HY = PAREFEU_RESERVE.barre.hauteur;
// Femz, 22/11 (2e retour) : la barre est EXACTEMENT la barre bleue du Pare-feu de main — en mètres comme celles des robots
// (BARRE.px par pixel d'art, rapetisse au loin en perspective), PAREFEU_RESERVE.barre.largeurM arrondie au pixel d'art,
// BARRE.hPx de haut, centre à BARRE.lift au-dessus du point d'ancrage vers le haut de l'écran
const BV_W = Math.round(PAREFEU_RESERVE.barre.largeurM / BARRE.px); // 27 pixels d'art
const BV_GAP = BV.icone.ecartArt;
const BV_BAS = BV.basPV;
const BV_DELAI = BV.fondu.delaiS;
const BV_IN = 1 / BV.fondu.entreeS;
const BV_OUT = 1 / BV.fondu.sortieS;
const BV_RAPPEL = BV.rappelS;
const BV_OM = BV.passage.omega;
const BV_COUL = 1 / BV.passage.couleurS;
const BV_EPS = BV.passage.epsilon;
const BV_HZ = BV.clignote.hz;
const BV_HZR = BV.clignote.hzReduits;
const BV_CREUX = BV.clignote.creux;
const BV_CREUXR = BV.clignote.creuxReduits;
const BV_ECL = BV.soinEclat;
const BV_ECLS = RETOURS_GUIDE.soin.barre.secondes;
const ART = 4; // pixels du canvas par pixel d'art des icônes (mipmaps : net à ×2 — 720 p — et ×4 — 1440 p)
// Femz, 22/11 (retour sur la 1re planche) : icônes en aplat d'une seule couleur — ni contour, ni reflet, ni halo —, à
// GAUCHE de la barre, plus petites : 5 × 5 pixels d'art, la hauteur de la barre (BARRE.hPx), même grille
const IC_W = 5; // pixels d'art de large et de haut (cœur et bouclier)
const IC_H = 5;
const MARGE = 1; // pixel d'art transparent autour de chaque case de l'atlas (aucun débord d'une case sur l'autre au filtrage)
const CELL_W = IC_W + 2 * MARGE; // 7
const CELL_H = IC_H + 2 * MARGE; // 7
// Icônes : UN InstancedMesh de 2 instances (0 cœur, 1 bouclier), atlas de 2 cases ; écrit dans des tableaux typés (aucun
// champ d'objet touché à l'image : une désoptimisation venue d'ailleurs — carte de P, Vector3… — ne l'atteint pas)
let meshIc = null;
let icMat = null; // instanceMatrix.array
let icAttr = null; // aIc : (case, opacité) × 2
const ICN = new Int32Array(1); // instances d'icônes à dessiner (0 ou 2), écrit par syncHeros, appliqué par sync
//#endregion e5:AI-barre-vie

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
  render.writeColor(PVC, 0, BV.couleurPV); // § E5.AI
  render.writeColor(BLC, 0, PAREFEU_RESERVE.barre.couleur);
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
  //#region e5:AI-barre-vie
  creerIcones(ctx);
  amorcer();
  resetHeros();
  //#endregion e5:AI-barre-vie
}

//#region e5:AI-barre-vie
// Icônes en pixels d'art (X = corps), le cœur est celui du HUD carte mère (ui.css, .sr-barre-coeur)
const COEUR_LIGNES = ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'];
const BOUCLIER_LIGNES = ['XXXXX', 'XXXXX', 'XXXXX', '.XXX.', '..X..'];

const IC_VERT = /* glsl */ `
attribute vec2 aIc;
varying vec2 vUv;
varying vec2 vIc;
void main() {
  vUv = uv;
  vIc = aIc;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
// vIc.x : case de l'atlas (0 cœur, 1 bouclier) ; vIc.y : opacité (fondus × clignotement du cœur)
const IC_FRAG = /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv;
varying vec2 vIc;
void main() {
  vec4 t = texture2D(uTex, vec2((vIc.x + vUv.x) * 0.5, vUv.y));
  gl_FragColor = vec4(t.rgb, t.a * vIc.y);
  #include <colorspace_fragment>
}
`;

/**
 * Atlas des deux icônes (5 × 5 pixels d'art en aplat, couleur de la barre ; aucun filter) et leur InstancedMesh net
 * (render.garderNet, comme la barre) : + 1 appel de dessin quand une icône est visible.
 */
function creerIcones(ctx) {
  const canvas = document.createElement('canvas');
  canvas.width = 2 * CELL_W * ART;
  canvas.height = CELL_H * ART;
  const g = canvas.getContext('2d');
  const cases = [
    [BV.coeur, COEUR_LIGNES],
    [BV.bouclier, BOUCLIER_LIGNES],
  ];
  for (let ci = 0; ci < 2; ci++) {
    const pal = cases[ci][0];
    const lignes = cases[ci][1];
    const c0 = ci * CELL_W;
    // aplat : chaque pixel du corps à la couleur de l'icône (celle de la barre), rien autour
    g.fillStyle = pal.corps;
    for (let y = 0; y < IC_H; y++)
      for (let x = 0; x < IC_W; x++) if (lignes[y][x] === 'X') g.fillRect((c0 + MARGE + x) * ART, (MARGE + y) * ART, ART, ART);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.name = 'barre-vie-icones';
  const mat = new THREE.ShaderMaterial({
    vertexShader: IC_VERT,
    fragmentShader: IC_FRAG,
    uniforms: { uTex: { value: tex } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  meshIc = render.createInstanced(new THREE.PlaneGeometry(1, 1), mat, 2, { name: 'barre-vie-icones' });
  const aIc = new THREE.InstancedBufferAttribute(new Float32Array(4), 2);
  aIc.setUsage(THREE.DynamicDrawUsage);
  meshIc.geometry.setAttribute('aIc', aIc);
  meshIc.renderOrder = BARRE.order; // avec la barre, sous les chiffres de dégâts
  render.garderNet(meshIc); // hors de l'effet CRT / pixel : nette, devant la scène
  icMat = meshIc.instanceMatrix.array;
  icAttr = aIc.array;
  icAttr[0] = 0;
  icAttr[2] = 1;
}

/**
 * Amorce les retours de type de la barre du héros (fin de sync) (hors combat, une fois, à l'init) : 24 passages avec des entrées et un état
 * FRACTIONNAIRES tirés d'une suite fixe (bouclier chargé ou non, coup ou pas, PV bas, Flashs Réduits, ortho ou
 * perspective, phases du clignotement, fondus et ressorts en cours), pour que CHAQUE opération ait vu des flottants avant
 * la 1re image de jeu — y compris celles qui suivent un Math.min / Math.max (un bord atteint rend un entier : à PV
 * pleins, P.hp / P.maxHp vaut 1 pile). Mesuré le 22/11 (--trace-deopt) : sans amorçage, « not int32 » au 1er
 * clignotement du cœur, puis ≈ 2 Ko par image tant que V8 ne réoptimise pas (≈ 400 appels, 6 à 7 s en temps réel).
 * L'état est remis à zéro ensuite (resetHeros) ; rien n'est dessiné (aucun commit).
 */
function amorcer() {
  let g = 0.6180339887;
  const hasard = () => {
    g = (g * 9.73 + 0.3171) % 1;
    return 0.03 + 0.94 * g; // dans ]0 ; 1[, jamais un bord
  };
  // 24 états différents, repassés 30 fois : 720 appels à l'init (≈ 5 ms) — V8 compile syncHeros (≈ 400 appels) AVANT la
  // 1re image : sans cela, en temps réel, elle reste 6 à 7 s en code non optimisé (≈ 1,2 Ko par image mesurés dans
  // tests/e4-barres-vie, essaim de 400 robots, contre 0 pour sync que sa boucle des robots optimise tout de suite)
  for (let n = 0; n < 720; n++) {
    const p = n % 24;
    for (let i = 0; i < IN.length; i++) IN[i] = hasard() * 2 - 1;
    for (let i = 0; i < H.length; i++) H[i] = hasard();
    IN[I_HP] = 100 * hasard();
    IN[I_MAX] = 100.5;
    IN[I_VIE] = p % 7 === 6 ? 0 : 1;
    IN[I_RES] = p % 3 === 0 ? -1 : hasard();
    IN[I_RD] = 0.01 + 0.03 * hasard();
    IN[I_SD] = p % 5 === 4 ? 0.2 * hasard() : 0.01 + 0.03 * hasard();
    IN[I_RED] = p % 2;
    IN[I_X] = 40 * hasard() - 20;
    IN[I_Z] = 40 * hasard() - 20;
    H[H_T] = 40 * hasard();
    H[H_RES] = p % 3 === 1 ? -1 : hasard();
    H[H_HP] = 100 * hasard();
    H[H_MODE] = p % 2;
    H[H_TH] = p % 4 === 1 ? 0.3 * hasard() : -0.1 * hasard();
    if (p % 6 === 5) {
      // effacée, sans événement : le chemin court
      H[H_A] = 0;
      H[H_T] = 0;
      IN[I_HP] = 90.5;
      H[H_HP] = 90.5;
      H[H_RES] = IN[I_RES];
    }
    const calme = p % 6 === 5;
    HI[0] = calme || p % 4 === 2 ? COUPS_RECUS[0] : COUPS_RECUS[0] + 1;
    HI[1] = calme || p % 3 === 2 ? SOIN_SIGNAUX[0] : SOIN_SIGNAUX[0] + 1;
    syncHeros(p % 5);
  }
  render.commit(mesh, 0);
  render.commit(meshIc, 0);
}

function resetHeros() {
  H.fill(0);
  H[H_RES] = -1;
  H[H_HP] = -1;
  H[H_BLINK] = 1;
  HI[0] = COUPS_RECUS[0];
  HI[1] = SOIN_SIGNAUX[0];
  ICN[0] = 0;
  if (meshIc !== null) render.commit(meshIc, 0);
}
//#endregion e5:AI-barre-vie

export function reset() {
  shown = 0;
  overflow = 0;
  eligible = 0;
  resetHeros(); // § E5.AI : la barre du héros repart effacée, sans attente
  if (mesh !== null) render.commit(mesh, 0);
}

/** Coupe ou rallume le module (mesure des appels de dessin, tests). */
export function setOn(v) {
  on = !!v;
  if (!on && mesh !== null) {
    shown = 0;
    render.commit(mesh, 0);
    if (meshIc !== null) render.commit(meshIc, 0); // § E5.AI
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
    if (k >= CAP - 1) {
      // § E5.AI : la dernière place est gardée pour la barre du héros
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
  //#region e5:AI-barre-vie
  // § E5.AI : barre du héros (bouclier ou PV), à la place de la barre bleue du § E5.X, écrite à l'instance k (les robots
  // s'arrêtent à CAP − 1), et ses deux icônes (syncHeros). Entrées copiées telles quelles dans IN :
  // syncHeros ne lit et n'écrit QUE des tableaux typés — une désoptimisation venue d'ailleurs (carte de P changée par un
  // autre module, mesurée le 22/11 pendant des coups encaissés : « wrong map » sur P.x) ne l'atteint pas, et elle garde
  // son code optimisé ; sync, elle, se réoptimise vite (boucle des robots).
  {
    IN[I_HP] = P.hp;
    IN[I_MAX] = P.maxHp;
    IN[I_VIE] = P.alive ? 1 : 0;
    IN[I_RES] = PAREFEU_F[0];
    IN[I_X] = hx;
    IN[I_Z] = hz;
    IN[I_RD] = DT[0];
    IN[I_SD] = DT[1];
    IN[I_RED] = CONFORT_FLASHS.reduits ? 1 : 0;
    IN[I_W] = rx;
    IN[I_W + 1] = ry;
    IN[I_W + 2] = rz;
    IN[I_W + 3] = ux;
    IN[I_W + 4] = uy;
    IN[I_W + 5] = uz;
    IN[I_W + 6] = fx;
    IN[I_W + 7] = fy;
    IN[I_W + 8] = fz;
    IN[I_W + 9] = w[12];
    IN[I_W + 10] = w[13];
    IN[I_W + 11] = w[14];
  }
  k = syncHeros(k);
  if (ICN[0] > 0) meshIc.geometry.attributes.aIc.needsUpdate = true;
  render.commit(meshIc, ICN[0]);
  //#endregion e5:AI-barre-vie
  if (k > 0) mesh.geometry.attributes.aBar.needsUpdate = true;
  shown = k;
  eligible = el;
  overflow += over;
  render.commit(mesh, k);
}

//#region e5:AI-barre-vie

/**
 * § E5.AI : barre du héros à l'instance k (rend k + 1 si elle est dessinée) et ses icônes. Ne lit que IN, H, HI,
 * COUPS_RECUS, SOIN_SIGNAUX, K ; n'écrit que H, HI, ICN et les tableaux des instances. k entier (aucun flottant en argument).
 */
function syncHeros(k) {
  // Piège mesuré (§ E5.AE, revu ici le 22/11 : 600 à 1 450 o par image dans la barre du héros pendant des coups encaissés,
  // tests/e5-X-parefeu-reserve) : une comparaison ou une opération jamais exécutée avant le 1er coup (branche d'un if,
  // côté droit d'un && ou d'un ||) n'a aucun retour de type ; à sa 1re exécution, V8 désoptimise la fonction et le code
  // non optimisé emballe chaque flottant. D'où : TOUTES les comparaisons et opérations sont calculées à chaque image,
  // dans des constantes ; les états ne font que choisir entre des valeurs déjà calculées (?: et && sur des locales).
  const rd = Math.min(Math.max(IN[I_RD], 0), 0.05);
  const sd = Math.min(Math.max(IN[I_SD], 0), 0.05);
  const alive = IN[I_VIE] > 0.5;
  const res0 = IN[I_RES];
  const resPos = res0 >= 0;
  const bouclier = resPos && alive;
  const res = Math.min(Math.max(res0, 0), 1);
  const hp = IN[I_HP];
  const mh = IN[I_MAX];
  const mhPos = mh > 0;
  const pv0 = hp / (mhPos ? mh : 1);
  const pv = mhPos ? Math.min(Math.max(pv0, 0), 1) : 0;
  // --- dégât reçu, recharge finie, soin (événements de l'image) ---
  const coups = COUPS_RECUS[0];
  const soins = SOIN_SIGNAUX[0];
  const lastRes = H[H_RES];
  const nouveauCoup = coups !== HI[0];
  const baissePV = hp < H[H_HP] - 1e-6;
  const lastPos = lastRes >= 0;
  const baisseRes = res0 < lastRes - 1e-6;
  const coup = nouveauCoup || baissePV || (lastPos && alive && baisseRes);
  const recharge = !lastPos && resPos && alive;
  const soin = soins !== HI[1];
  HI[0] = coups;
  HI[1] = soins;
  H[H_RES] = res0;
  H[H_HP] = hp;
  // --- attente (temps de jeu) et visibilité (temps réel) ---
  const t0 = H[H_T] - sd;
  const t1 = t0 > 0 ? t0 : 0;
  const t2 = coup ? BV_DELAI : t1;
  const tCourt = t2 < BV_RAPPEL;
  const t3 = (recharge || soin) && tCourt ? BV_RAPPEL : t2;
  const t = alive ? t3 : 0;
  H[H_T] = t;
  const pvBas = pv < BV_BAS;
  const low = alive && pvBas;
  H[H_LOW] = low ? 1 : 0;
  const enAttente = t > 0;
  const veut = alive && (enAttente || low);
  const a0 = H[H_A];
  const fCache = bouclier ? res : pv;
  const cacheH = !veut && a0 <= 0;
  if (cacheH) {
    // effacée et rien ne la rappelle (le cas courant hors combat) : l'état suit sans animation, presque rien n'est
    // calculé (avant que V8 n'optimise la fonction, chaque opération sur des flottants alloue)
    H[H_FC] = fCache;
    H[H_F] = fCache;
    H[H_V] = 0;
    H[H_TR] = fCache;
    H[H_TV] = 0;
    H[H_TH] = 0;
    H[H_TF] = fCache;
    H[H_M] = bouclier ? 1 : 0;
    H[H_MODE] = bouclier ? 1 : 0;
    H[H_A] = 0;
    H[H_ALPHA] = 0;
    H[H_PH] = 0;
    H[H_BLINK] = 1;
    H[H_COEUR] = 0;
    H[H_COEUR + 1] = 0;
    ICN[0] = 0;
  } else {
    const aMonte = Math.min(a0 + rd * BV_IN, 1);
    const aDescend = Math.max(a0 - rd * BV_OUT, 0);
    const a = veut ? aMonte : aDescend;
    H[H_A] = a;
    const alpha = a * a * (3 - 2 * a);
    H[H_ALPHA] = alpha;
    const aPos = a > 0;
    // --- plein : descend d'un coup, monte par un ressort critique ; bouclier tombé → part de 0 ---
    const f = bouclier ? res : pv;
    H[H_FC] = f;
    const modeAvant = H[H_MODE] === 1;
    const bascule = bouclier !== modeAvant;
    H[H_MODE] = bouclier ? 1 : 0;
    const F0 = bascule && !bouclier ? 0 : H[H_F];
    const v0 = bascule ? 0 : H[H_V];
    const om = BV_OM;
    const v2 = v0 + (-2 * om * v0 - om * om * (F0 - f)) * rd;
    const F2 = F0 + v2 * rd;
    const desc = f <= F0;
    const arrive = F2 >= f - BV_EPS;
    const pose = desc || arrive;
    const F1 = pose ? f : F2;
    const F = aPos ? F1 : f; // effacée : le plein suit sans animation (au retour, il part de la valeur juste)
    H[H_F] = F;
    H[H_V] = pose ? 0 : v2;
    // --- traîne (mêmes réglages que les robots, BARRE.trail), sur le plein affiché ---
    const tr0 = H[H_TR];
    const tv0 = H[H_TV];
    const th0 = H[H_TH];
    const tf0 = H[H_TF];
    const eps = K[K_EPS];
    const tom = K[K_OMEGA];
    const colle = tr0 <= F;
    const c1 = F < tf0;
    const c2 = tr0 - tf0 <= eps;
    const c3 = tv0 > -eps;
    const hold = K[K_HOLD];
    const th1 = c1 && c2 && c3 ? hold : th0; // coup sur une traîne au repos : elle reste un instant
    const tient = th1 > 0;
    const th2 = th1 - rd;
    const tvS = tv0 + (-2 * tom * tv0 - tom * tom * (tr0 - F)) * rd;
    const trS = tr0 + tvS * rd;
    const rejoint = trS <= F + eps * 0.25;
    const raz = colle || !aPos;
    const tr = raz ? F : tient ? tr0 : rejoint ? F : trS;
    H[H_TR] = tr;
    H[H_TV] = raz || tient || rejoint ? 0 : tvS;
    H[H_TH] = raz ? 0 : tient ? th2 : th1;
    H[H_TF] = F;
    // --- couleur : vert ↔ bleu (smoothstep), éclat du soin vers le blanc ---
    const m0 = H[H_M];
    const mMonte = Math.min(m0 + rd * BV_COUL, 1);
    const mDescend = Math.max(m0 - rd * BV_COUL, 0);
    const m1 = bouclier ? mMonte : mDescend;
    const m = aPos ? m1 : bouclier ? 1 : 0; // effacée : déjà dans le bon état au retour
    H[H_M] = m;
    const ms = m * m * (3 - 2 * m);
    const e0 = H[H_ECL] - rd;
    const e1 = e0 > 0 ? e0 : 0;
    const e = soin ? BV_ECLS : e1;
    H[H_ECL] = e;
    const eu = e / BV_ECLS;
    const eg = BV_ECL * eu * eu; // retombe vite, puis doucement
    let cr = PVC[0] + (BLC[0] - PVC[0]) * ms;
    let cg = PVC[1] + (BLC[1] - PVC[1]) * ms;
    let cb = PVC[2] + (BLC[2] - PVC[2]) * ms;
    cr += (1 - cr) * eg;
    cg += (1 - cg) * eg;
    cb += (1 - cb) * eg;
    H[H_COUL] = cr;
    H[H_COUL + 1] = cg;
    H[H_COUL + 2] = cb;
    // --- clignotement du cœur sous basPV (Flashs Réduits : plus lent, sinus doux, creux moins profond) ---
    const red = IN[I_RED] > 0.5;
    const ph0 = H[H_PH] + rd * (red ? BV_HZR : BV_HZ);
    const ph1 = ph0 - Math.floor(ph0);
    const ph = low ? ph1 : 0;
    H[H_PH] = ph;
    const c = 0.5 + 0.5 * Math.cos(ph * 6.283185307179586); // 1 au départ : le cœur commence allumé
    let q = (c - 0.2) / 0.6;
    q = Math.min(Math.max(q, 0), 1);
    const carre = q * q * (3 - 2 * q);
    const creux = red ? BV_CREUXR : BV_CREUX;
    const blinkBas = creux + (1 - creux) * (red ? c : carre);
    const blink = low ? blinkBas : 1;
    H[H_BLINK] = blink;
    // --- taille en mètres (barre bleue de main) : un pixel d'art = BARRE.px m, dans le plan de la caméra ---
    const rx = IN[I_W], ry = IN[I_W + 1], rz = IN[I_W + 2];
    const ux = IN[I_W + 3], uy = IN[I_W + 4], uz = IN[I_W + 5];
    const fx = IN[I_W + 6], fy = IN[I_W + 7], fz = IN[I_W + 8];
    const hx = IN[I_X];
    const hz = IN[I_Z];
    const un = K[K_PX];
    H[H_UN] = un;
    const hPx = K[K_HPX];
    const hM = hPx * un;
    const wm = BV_W * un;
    const up = K[K_LIFT]; // centre de la barre à BARRE.lift (m d'écran) au-dessus de l'ancrage, comme dans main
    const side = (BV_GAP + IC_W) * 0.5 * un; // groupe icône + barre centré sur le héros (l'icône à gauche)
    const bx = hx + ux * up + rx * side;
    const by = BV_HY + uy * up + ry * side;
    const bz = hz + uz * up + rz * side;
    H[H_X] = bx;
    H[H_X + 1] = by;
    H[H_X + 2] = bz;
    const io = -(BV_W * 0.5 + BV_GAP + IC_W * 0.5) * un; // centre de l'icône, à gauche de la barre
    const ix = bx + rx * io;
    const iy = by + ry * io;
    const iz = bz + rz * io;
    H[H_IX] = ix;
    H[H_IX + 1] = iy;
    H[H_IX + 2] = iz;
    // --- icônes : cœur (× clignotement) et bouclier, fondu croisé avec la couleur ---
    const oc = alpha * (1 - ms) * blink;
    const ob = alpha * ms;
    H[H_COEUR] = oc;
    H[H_COEUR + 1] = ob;
    const sx = CELL_W * un;
    const sy = CELL_H * un;
    // deux instances (cœur, bouclier), même place, plan de la caméra ; opacité dans aIc
    for (let j = 0; j < 2; j++) {
      const oi = j * 16;
      icMat[oi] = rx * sx;
      icMat[oi + 1] = ry * sx;
      icMat[oi + 2] = rz * sx;
      icMat[oi + 3] = 0;
      icMat[oi + 4] = ux * sy;
      icMat[oi + 5] = uy * sy;
      icMat[oi + 6] = uz * sy;
      icMat[oi + 7] = 0;
      icMat[oi + 8] = fx;
      icMat[oi + 9] = fy;
      icMat[oi + 10] = fz;
      icMat[oi + 11] = 0;
      icMat[oi + 12] = ix;
      icMat[oi + 13] = iy;
      icMat[oi + 14] = iz;
      icMat[oi + 15] = 1;
    }
    icAttr[1] = oc;
    icAttr[3] = ob;
    ICN[0] = oc > 0.002 || ob > 0.002 ? 2 : 0;
    // instance toujours écrite (code chaud dès la 1re image, même effacée) ; comptée seulement si visible. Les robots
    // s'arrêtent à CAP − 1 : la dernière place est celle du héros.
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
    matArr[o + 12] = bx;
    matArr[o + 13] = by;
    matArr[o + 14] = bz;
    matArr[o + 15] = 1;
    const qc = k * 3;
    colArr[qc] = cr;
    colArr[qc + 1] = cg;
    colArr[qc + 2] = cb;
    const b = k * 4;
    barArr[b] = F;
    barArr[b + 1] = tr;
    barArr[b + 2] = alpha;
    barArr[b + 3] = BV_W;
    instIdx[k] = -1;
    const vis = alpha > 0.002;
    const k1 = k + 1;
    k = vis ? k1 : k;
  }
  return k;
}

/** § E5.AI — relevé de la barre du héros (debug : alloue). Rectangles à l'écran en px CSS. */
function inspectHeros() {
  const cam = camera.threeCamera;
  const view = camera.view;
  const ecran = (x, y, z) => {
    _v.set(x, y, z).project(cam);
    return { x: ((_v.x + 1) / 2) * view.widthPx, y: ((1 - _v.y) / 2) * view.heightPx };
  };
  const w = cam.matrixWorld.elements;
  const un = H[H_UN];
  const rect = (cx, cy, cz, wa, ha) => {
    const hx = wa * 0.5 * un;
    const hy = ha * 0.5 * un;
    const a = ecran(cx - w[0] * hx + w[4] * hy, cy - w[1] * hx + w[5] * hy, cz - w[2] * hx + w[6] * hy);
    const b = ecran(cx + w[0] * hx - w[4] * hy, cy + w[1] * hx - w[5] * hy, cz + w[2] * hx - w[6] * hy);
    return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
  };
  const tete = ecran(P.x, BV_HY, P.z);
  return {
    mode: H[H_MODE] === 1 ? 'parefeu' : 'pv',
    vise: H[H_FC],
    plein: H[H_F],
    traine: H[H_TR],
    visibilite: H[H_A],
    alpha: H[H_ALPHA],
    attente: H[H_T],
    bas: H[H_LOW] === 1,
    passage: H[H_M],
    clignote: H[H_BLINK],
    phase: H[H_PH],
    eclat: H[H_ECL],
    couleur: [H[H_COUL], H[H_COUL + 1], H[H_COUL + 2]],
    coeur: { opacite: H[H_COEUR], visible: ICN[0] > 0 && H[H_COEUR] > 0.002 },
    bouclier: { opacite: H[H_COEUR + 1], visible: ICN[0] > 0 && H[H_COEUR + 1] > 0.002 },
    icones: { instances: ICN[0], dessinees: meshIc !== null && meshIc.visible && meshIc.count > 0 },
    icone: H[H_COEUR + 1] > H[H_COEUR] ? 'bouclier' : 'coeur',
    unArtM: un,
    pxParArt: un > 0 ? (rect(H[H_X], H[H_X + 1], H[H_X + 2], 1, 1).y1 - rect(H[H_X], H[H_X + 1], H[H_X + 2], 1, 1).y0) : 0,
    barre: rect(H[H_X], H[H_X + 1], H[H_X + 2], BV_W, K[K_HPX]),
    iconeRect: rect(H[H_IX], H[H_IX + 1], H[H_IX + 2], IC_W, IC_H),
    ancrage: tete,
    largeurArt: BV_W,
    hauteurArt: K[K_HPX],
  };
}
//#endregion e5:AI-barre-vie

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
  out.heros = inspectHeros(); // § E5.AI
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
      heros: i < 0, // § E5.X, § E5.AI : barre du héros (bouclier ou PV)
      mode: i < 0 ? (H[H_MODE] === 1 ? 'parefeu' : 'pv') : null,
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
