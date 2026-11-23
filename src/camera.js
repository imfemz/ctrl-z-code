// FONDATION : camera.js — caméra orthographique 3/4 à angle fixe, suivi lissé, secousses à « trauma » avec
// plafond par groupe et par seconde glissante, punch de zoom, réglage d'intensité (contrat : ARCHITECTURE.md § B, § N).
// Étape « animations » (§ Z sexies ; prototype src/anim/camera-anim.js, plan § P5 et décisions de Femz du 13/11) :
//   - AVANCE : la cible lissée vise P + lead, lead suit la vitesse RÉELLE du joueur × CAMERA.lead.seconds (bornée) ;
//   - SECOUSSE à SHAKE.frequency (12 Hz), amplitude appliquée qui MONTE vers le trauma (SHAKE.attaque) ;
//   - LIMITE D'ACCUMULATION : une demande est ignorée tant que le trauma vivant de son groupe dépasse
//     SHAKE.relance × son plafond (les plafonds par seconde glissante restent) ;
//   - COUP DIRECTIONNEL : addTraumaAt pousse la caméra de la source vers la cible (ressort critique, SHAKE.kick).
// § E3.L (chantier L-camera) : trois réglages d'inclinaison (CAMERA.reglages), changement doux (ressort critique),
//   view.pitchDeg / view.pitchGen, view.groundQuad (coins du sol du champ de jeu), screenToGround (rayon vers le sol),
//   onPitch (modules qui gardent une base calculée depuis l'inclinaison : fx, boss).
import * as THREE from 'three';
import { CAMERA, SHAKE, TRAUMA_COUNT, ZOOM } from './config.js';
import { CAMERA_3P } from './config.js'; // § E5.AB : lacet tourné à la souris (mode Souris)
import { SENSIBILITE_SOURIS } from './config.js'; // § E5.AG : réglage « Sensibilité de la souris » (multiplicateur)
import { P } from './state.js';

const DEG = Math.PI / 180;
const GROUPS = SHAKE.groupCap.length;
const SLOTS = SHAKE.capSlots + 1; // tranche courante + les capSlots précédentes
const SLOT_SECONDS = SHAKE.capWindow / SHAKE.capSlots;
const NOISE_N = SHAKE.noiseTableSize;

export let threeCamera = null;

/** Lecture seule pour les autres modules. Les tailles ne sont valides qu'après le premier render.resize(). */
export const view = {
  halfW: (CAMERA.viewHeight / 2) * (16 / 9),
  halfH: CAMERA.viewHeight / 2,
  halfD: CAMERA.viewHeight / 2 / Math.sin(CAMERA.pitchDeg * DEG),
  targetX: 0,
  targetZ: 0,
  rightX: 1,
  rightZ: 0,
  upX: 0,
  upZ: -1,
  groundPerHeight: 1 / Math.tan(CAMERA.pitchDeg * DEG),
  widthPx: 1280,
  heightPx: 720,
  pxPerMeter: 720 / CAMERA.viewHeight,
  // § E2.E — zoom à la molette. Tout ce qui précède décrit le CHAMP DE JEU (le recul maximum) et ne dépend pas du
  // zoom : apparitions, ombres, culling. Ce qui suit décrit ce que l'on VOIT, pour l'interface seulement.
  zoom: 1, // zoom courant (lissé), sans le punch
  visHalfW: (CAMERA.viewHeight / 2) * (16 / 9), // = half* / zoom
  visHalfH: CAMERA.viewHeight / 2,
  visHalfD: CAMERA.viewHeight / 2 / Math.sin(CAMERA.pitchDeg * DEG),
  visPxPerMeter: 720 / CAMERA.viewHeight,
  // § E3.L — inclinaison VIVANTE (suit le réglage en douceur), compteur de changements, réglage demandé, coins du sol
  // du champ de jeu (x0, z0, … x3, z3 : bas-gauche, bas-droite, haut-droite, haut-gauche), réécrits à chaque image.
  pitchDeg: CAMERA.pitchDeg,
  pitchGen: 0,
  reglage: CAMERA.reglageDefaut,
  groundQuad: new Float64Array(8),
  lacetDeg: CAMERA.yawDeg, // § E5.AB : lacet VIVANT (CAMERA.yawDeg hors mode Souris)
  // § E5.AB.12 : 1 = caméra en PERSPECTIVE (mode Souris). halfW / halfD (et vis*) décrivent alors le RECTANGLE qui
  // englobe l'empreinte au sol (un trapèze) : apparitions, culling et ombres restent sûrs (jamais un robot visible hors
  // du rectangle). Pour l'interface (pixels), ecranT() projette vraiment. ecranHalfW : demi-largeur du plan de l'écran
  // à la cible (= halfW en ortho) ; prochD / loinD : profondeur au sol vers le bas / le haut de l'écran (champ de jeu) ;
  // visProchD : vers le bas, champ visible (molette comprise).
  persp: 0,
  ecranHalfW: (CAMERA.viewHeight / 2) * (16 / 9),
  prochD: CAMERA.viewHeight / 2 / Math.sin(CAMERA.pitchDeg * DEG),
  loinD: CAMERA.viewHeight / 2 / Math.sin(CAMERA.pitchDeg * DEG),
  visProchD: CAMERA.viewHeight / 2 / Math.sin(CAMERA.pitchDeg * DEG),
};

// Base de la caméra dans le monde (fixe) : droite, haut et direction cible → caméra.
// § E5.AB : dans un tableau typé (base() tourne à chaque image quand la souris tourne la caméra : une variable de module
// qui reçoit un flottant coûterait un nombre alloué à chaque écriture, § V — mesuré : 142 o/image)
const BA = new Float64Array([1, 0, 0, 0, 1, 0, 0, 1, 0]); // rX rY rZ, uX uY uZ, dX dY dZ
const baseQuat = new THREE.Quaternion();
const rollQuat = new THREE.Quaternion();
// § E3.L : base recalculée quand l'inclinaison change (objets alloués une fois)
const baseMat = new THREE.Matrix4();
const vR = new THREE.Vector3();
const vU = new THREE.Vector3();
const vD = new THREE.Vector3();
const pitchListeners = []; // rempli à l'initialisation des modules (onPitch), jamais en combat

// État de la secousse et du punch. Ces scalaires sont réécrits à chaque image : ils vivent dans un tableau typé,
// car une variable de module qui reçoit un flottant coûte un nombre alloué (12 octets) à chaque écriture (§ V).
const TRAUMA_ = 0; // trauma 0..1
const NOISE_T = 1; // temps du bruit lissé
const OFFSET_X = 2; // décalage courant (m d'écran) — OFFSET_X, OFFSET_Y et ROLL_DEG se suivent : canaux 0, 1, 2 du bruit
const OFFSET_Y = 3;
const ROLL_DEG = 4; // roulis courant
const SLOT_CLOCK = 5; // s écoulées dans la tranche courante des plafonds
const PUNCH_AMP = 6; // dernier punch accepté (fraction signée)
const PUNCH_AGE = 7; // s depuis ce punch
const PUNCH_NOW = 8; // valeur courante (avant intensité)
const LAST_ZOOM = 9; // dernier zoom appliqué à la caméra
const LEAD_X = 10; // avance de la cible (m au sol), comprise dans view.targetX/Z
const LEAD_Z = 11;
const AMP = 12; // trauma appliqué : monte vers le trauma avec SHAKE.attaque, retombe avec lui
const KICK_X = 13; // coup directionnel : décalage (m d'écran) et vitesse du ressort
const KICK_Y = 14;
const KICK_VX = 15;
const KICK_VY = 16;
const LAST_PX = 17; // position du joueur à l'image précédente (vitesse RÉELLE : contre un rocher, P.vx reste à 6,5 m/s)
const LAST_PZ = 18;
const ZOOM_NOW = 19; // § E2.E : zoom courant de la molette (lissé), de ZOOM.min à ZOOM.max
const ZOOM_VEL = 20; // sa vitesse (1/s) : ressort critique
const ZOOM_STEPS = 21; // zoom DEMANDÉ, en crans entiers depuis le recul maximum (0 = ZOOM.min exactement)
const PITCH_NOW = 22; // § E3.L : inclinaison courante (degrés), lissée vers PITCH_GOAL
const PITCH_VEL = 23; // sa vitesse (°/s)
const PITCH_GOAL = 24; // inclinaison du réglage demandé
// Houle (branche carte-blender, 17/11 : « camera shake smooth » au départ de l'impulsion du processeur) : balancement
// lent et doux (sinus mêlés à basse fréquence), enveloppe à montée courte puis retombée en douceur — pas de bruit à 12 Hz
const HOULE_AGE = 25; // s depuis le départ
const HOULE_DUR = 26; // durée (s)
const HOULE_AMP = 27; // amplitude (m d'écran)
const HOULE_F = 28; // fréquence (Hz)
const HOULE_ROLL = 29; // roulis maximal (degrés)
//#region e5:AB-camera-3p
// § E5.AB : lacet de la caméra (degrés) — courant (lissé), demandé (souris), vitesse du ressort critique (°/s)
const YAW_NOW = 30;
const YAW_GOAL = 31;
const YAW_VEL = 32;
const ORBITE = new Uint8Array(1); // 1 : mode Souris (le lacet suit la souris) ; 0 : il revient à CAMERA.yawDeg
// § E5.AB.10 : rattrapage après un dash ou une téléportation. SUIVI_X/Z = cible du suivi exponentiel (l'ancienne
// view.targetX/Z, avance comprise) ; RAT_X/Z = décalage de rattrapage (m au sol), ressort critique vers 0, vitesse
// RAT_VX/VZ ; RAT_W = sa pulsation ; LEAD_TX/TZ = avance VISÉE (gelée pendant un saut). Cible vue = suivi + décalage.
const SUIVI_X = 33;
const SUIVI_Z = 34;
const RAT_X = 35;
const RAT_Z = 36;
const RAT_VX = 37;
const RAT_VZ = 38;
const RAT_W = 39;
const LEAD_TX = 40;
const LEAD_TZ = 41;
const RAT_CX = 42; // consigne du décalage, 1er étage (exponentielle) …
const RAT_CZ = 43;
const RAT_DX = 44; // … 2e étage (pôle double) : avec le ressort critique, quatre pôles confondus en −ω
const RAT_DZ = 45;
const RAT_EX = 46; // part du saut de l'image appliquée APRÈS le pas du rattrapage (glissade : la moitié)
const RAT_EZ = 47;

const RAT_N = new Int32Array(2); // [0] images absorbées depuis le chargement ; [1] 1 si le héros dashait à l'image d'avant
//#endregion e5:AB-camera-3p
const DT_ = 48; // § E5.AB : pas de l'image (s), lu par les petites fonctions du chantier (aucun flottant passé, § V)
const SAUT_ = 49; // § E5.AB.10 : 1 si l'image est un saut du héros (absorbé)
const S = new Float64Array(50);
//#region e5:AB-camera-3p
// § E5.AB.12 : caméra en perspective du mode Souris. Deux caméras créées une fois (init), une seule active (threeCamera) ;
// les modules qui gardent la caméra (render.js : passe de rendu, matrices du halo) sont prévenus par onCamera().
const PERSP = new Uint8Array(1);
const TAN_P = Math.tan((CAMERA_3P.perspective.fovDeg * DEG) / 2); // demi-ouverture verticale
const DIST_P = CAMERA.viewHeight / 2 / TAN_P; // m — à cette distance, 32 m de haut à la cible : le cadrage de l'ortho
const EMP = new Float64Array(8); // coins de l'empreinte au sol (champ de jeu), décalages depuis la cible : bg, bd, hd, hg
let camOrtho = null;
let camPersp = null;
const cameraListeners = [];
//#endregion e5:AB-camera-3p
S[YAW_NOW] = CAMERA.yawDeg;
S[YAW_GOAL] = CAMERA.yawDeg;
S[HOULE_AGE] = 1e9;
S[PITCH_NOW] = CAMERA.pitchDeg;
S[PITCH_GOAL] = CAMERA.pitchDeg;
S[PUNCH_AGE] = 1e9;
S[LAST_ZOOM] = 1;
S[ZOOM_NOW] = ZOOM.min;
const ZOOM_STEPS_MAX = Math.ceil((ZOOM.max - ZOOM.min) / ZOOM.step - 1e-9); // crans du recul maximum au zoom le plus proche
let intensity = SHAKE.defaultIntensity;
const noise = new Float32Array(NOISE_N * 3); // trois canaux : décalage x, décalage y, roulis
const CHANNEL_SCALE = new Float64Array([SHAKE.maxOffset, SHAKE.maxOffset, SHAKE.maxRollDeg]); // amplitude de chaque canal

// Plafonds : anneau de tranches par groupe.
const slots = new Float32Array(GROUPS * SLOTS);
let slotIndex = 0;
const grantedTotal = new Float64Array(TRAUMA_COUNT);
let punches = 0;
// Limite d'accumulation : trauma « vivant » de chaque groupe (décroît comme le trauma) ; demandes ignorées par groupe.
const vivant = new Float64Array(GROUPS);
const ignored = new Int32Array(GROUPS);
const KICK_W0 = SHAKE.kick.omega * Math.E; // impulsion de vitesse qui donne un pic ≈ 1 m sur le ressort critique

function groupSum(g) {
  let s = 0;
  const o = g * SLOTS;
  for (let k = 0; k < SLOTS; k++) s += slots[o + k];
  return s;
}

export function init() {
  camOrtho = new THREE.OrthographicCamera(-view.halfW, view.halfW, view.halfH, -view.halfH, CAMERA.near, CAMERA.far);
  camPersp = new THREE.PerspectiveCamera(CAMERA_3P.perspective.fovDeg, 16 / 9, CAMERA.near, CAMERA.far); // § E5.AB.12
  threeCamera = camOrtho;
  // Vecteurs du sol (§ B) : haut et droite de l'écran — § E5.AB : écrits par base(), avec le lacet vivant (fixe hors
  // mode Souris : CAMERA.yawDeg, mêmes calculs qu'avant au bit près).
  // § E3.L : tout ce qui dépend de l'inclinaison (d, u, halfD, groundPerHeight) est calculé par base(), refait à
  // chaque changement de réglage. Au chargement, l'orientation vient de lookAt (même résultat que la matrice (r, u, d)).
  base();
  // Orientation fixe : calculée une fois par lookAt, puis seulement composée avec le roulis.
  threeCamera.position.set(BA[6] * CAMERA.distance, BA[7] * CAMERA.distance, BA[8] * CAMERA.distance);
  threeCamera.up.set(0, 1, 0);
  threeCamera.lookAt(0, 0, 0);
  baseQuat.copy(threeCamera.quaternion);
  camPersp.quaternion.copy(baseQuat);
  // Table de bruit : générateur privé (mulberry32), jamais rand().
  let s = 0x5eed1234;
  for (let k = 0; k < noise.length; k++) {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    noise[k] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  place();
}

/**
 * § E3.L — base de la caméra pour l'inclinaison courante S[PITCH_NOW] : direction cible → caméra d, haut de l'écran u,
 * profondeur au sol du champ de jeu, quaternion de base. Sans argument et sans allocation (§ V). Prévient les modules
 * abonnés (onPitch) : leur base suit.
 */
function base() {
  const pitch = S[PITCH_NOW] * DEG;
  const yaw = S[YAW_NOW] * DEG; // § E5.AB : lacet vivant (= CAMERA.yawDeg hors mode Souris)
  view.upX = -Math.sin(yaw);
  view.upZ = -Math.cos(yaw);
  view.rightX = Math.cos(yaw);
  view.rightZ = -Math.sin(yaw);
  view.lacetDeg = S[YAW_NOW];
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  BA[6] = Math.sin(yaw) * cp;
  BA[7] = sp;
  BA[8] = Math.cos(yaw) * cp;
  BA[0] = Math.cos(yaw);
  BA[1] = 0;
  BA[2] = -Math.sin(yaw);
  BA[3] = BA[7] * BA[2] - BA[8] * BA[1];
  BA[4] = BA[8] * BA[0] - BA[6] * BA[2];
  BA[5] = BA[6] * BA[1] - BA[7] * BA[0];
  if (ORBITE[0] === 1) {
    // § E5.AB.2 : à chaque image où la souris tourne la caméra — quaternion écrit directement (lacet × inclinaison
    // négative), sans passer par une matrice ni des appels qui reçoivent des flottants (§ V)
    const cy = Math.cos(yaw * 0.5);
    const sy = Math.sin(yaw * 0.5);
    const cx = Math.cos(pitch * 0.5);
    const sx = -Math.sin(pitch * 0.5);
    baseQuat._x = cy * sx;
    baseQuat._y = sy * cx;
    baseQuat._z = -sy * sx;
    baseQuat._w = cy * cx;
  } else {
    vR.set(BA[0], BA[1], BA[2]);
    vU.set(BA[3], BA[4], BA[5]);
    vD.set(BA[6], BA[7], BA[8]);
    baseMat.makeBasis(vR, vU, vD);
    baseQuat.setFromRotationMatrix(baseMat);
  }
  view.groundPerHeight = cp / sp;
  view.halfD = view.halfH / sp;
  view.visHalfD = view.halfD / S[ZOOM_NOW];
  view.prochD = view.halfD; // § E5.AB.12 : ortho, symétrique (la perspective les réécrit ci-dessous)
  view.loinD = view.halfD;
  view.visProchD = view.visHalfD;
  if (PERSP[0] === 1) empreinte(); // § E5.AB.12
  view.pitchDeg = S[PITCH_NOW];
  view.pitchGen++;
  for (let i = 0; i < pitchListeners.length; i++) pitchListeners[i]();
}

/** § E3.L — fn() est appelée (sans argument) à chaque changement d'inclinaison. À appeler à l'initialisation seulement. */
export function onPitch(fn) {
  if (typeof fn === 'function' && pitchListeners.indexOf(fn) < 0) pitchListeners.push(fn);
}

/** § E3.L — coins du sol du champ de jeu (recul maximum, comme isOnScreen), autour de la cible. */
function quad() {
  const q = view.groundQuad;
  const tx = view.targetX;
  const tz = view.targetZ;
  if (PERSP[0] === 1) {
    // § E5.AB.12 : le vrai trapèze vu au sol
    for (let k = 0; k < 4; k++) {
      q[k * 2] = tx + EMP[k * 2];
      q[k * 2 + 1] = tz + EMP[k * 2 + 1];
    }
    return;
  }
  const w = view.halfW;
  const d = view.halfD;
  const ax = view.rightX * w;
  const az = view.rightZ * w;
  const bx = view.upX * d;
  const bz = view.upZ * d;
  q[0] = tx - ax - bx;
  q[1] = tz - az - bz;
  q[2] = tx + ax - bx;
  q[3] = tz + az - bz;
  q[4] = tx + ax + bx;
  q[5] = tz + az + bz;
  q[6] = tx - ax + bx;
  q[7] = tz - az + bz;
}

/** Trauma 0, punch 0, plafonds vidés, cible sur le joueur. Les cumuls « depuis le chargement » restent, le zoom de la molette aussi (§ E2.E). */
export function reset() {
  S[TRAUMA_] = 0;
  S[PUNCH_AMP] = 0;
  S[PUNCH_AGE] = 1e9;
  S[PUNCH_NOW] = 0;
  S[OFFSET_X] = 0;
  S[OFFSET_Y] = 0;
  S[ROLL_DEG] = 0;
  S[HOULE_AGE] = 1e9;
  S[LEAD_X] = 0;
  S[LEAD_Z] = 0;
  S[AMP] = 0;
  S[KICK_X] = 0;
  S[KICK_Y] = 0;
  S[KICK_VX] = 0;
  S[KICK_VY] = 0;
  S[LAST_PX] = P.x;
  S[LAST_PZ] = P.z;
  slots.fill(0);
  vivant.fill(0);
  remettreLacet(); // § E5.AB : lacet d'origine (déjà posé par main avant player.reset : sans effet alors)
  snapTo(P.x, P.z);
}

/** Place la cible sans lissage. */
export function snapTo(x, z) {
  view.targetX = x;
  view.targetZ = z;
  //#region e5:AB-camera-3p
  S[SUIVI_X] = x;
  S[SUIVI_Z] = z;
  S[RAT_X] = 0;
  S[RAT_Z] = 0;
  S[RAT_VX] = 0;
  S[RAT_VZ] = 0;
  S[RAT_CX] = 0;
  S[RAT_CZ] = 0;
  S[RAT_DX] = 0;
  S[RAT_DZ] = 0;
  S[LAST_PX] = P.x; // la téléportation du héros qui accompagne un snapTo n'est pas un saut à rattraper
  S[LAST_PZ] = P.z;
  //#endregion e5:AB-camera-3p
  place();
}

function place() {
  const cam = threeCamera;
  const tx = view.targetX;
  const tz = view.targetZ;
  const D = PERSP[0] === 1 ? DIST_P : CAMERA.distance; // § E5.AB.12
  // § E2.E : secousse et coup directionnel divisés par le zoom de la molette — même amplitude en PIXELS à tout zoom
  // (au recul maximum : division par 1, valeurs inchangées au bit près)
  const z = S[ZOOM_NOW];
  const ox = (S[OFFSET_X] + S[KICK_X]) / z;
  const oy = (S[OFFSET_Y] + S[KICK_Y]) / z;
  cam.position.set(tx + BA[6] * D + BA[0] * ox + BA[3] * oy, BA[7] * D + BA[1] * ox + BA[4] * oy, tz + BA[8] * D + BA[2] * ox + BA[5] * oy);
  if (S[ROLL_DEG] !== 0) {
    const h = S[ROLL_DEG] * DEG * 0.5;
    rollQuat.set(0, 0, Math.sin(h), Math.cos(h));
    cam.quaternion.multiplyQuaternions(baseQuat, rollQuat);
  } else {
    cam.quaternion.copy(baseQuat);
  }
  // § E2.E : le punch se MULTIPLIE au zoom de la molette (z = 1 : 1 + punch, comme avant) ; butée dure au recul maximum
  let zoom = z * (1 + S[PUNCH_NOW] * intensity);
  if (zoom < ZOOM.min) zoom = ZOOM.min;
  if (zoom !== S[LAST_ZOOM]) {
    S[LAST_ZOOM] = zoom;
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
  }
  if (z !== view.zoom) visible();
  quad(); // § E3.L
}

/**
 * § E2.E — champ VISIBLE (interface) : le champ de jeu divisé par le zoom courant. Écrit seulement quand il change.
 * Sans argument : un flottant passé à une fonction coûterait un nombre alloué par image pendant un zoom (§ V).
 */
function visible() {
  const z = S[ZOOM_NOW];
  view.zoom = z;
  view.visHalfW = view.halfW / z;
  view.visHalfH = view.halfH / z;
  view.visHalfD = view.halfD / z;
  view.visPxPerMeter = view.pxPerMeter * z;
  view.visProchD = view.visHalfD; // § E5.AB.12 : ortho (la perspective le réécrit)
  if (PERSP[0] === 1) empreinte(); // § E5.AB.12
}

//#region e5:AB-camera-3p
/**
 * § E5.AB.12 : empreinte au sol de la caméra en perspective — rayons des quatre coins de l'écran jusqu'au sol, depuis
 * l'œil sans secousse. Écrit EMP (coins du champ de jeu), view.halfW / halfD / prochD / loinD (rectangle englobant,
 * champ de jeu) et view.visHalfW / visHalfD / visProchD (champ visible, molette comprise). Sans argument, sans
 * allocation (tourne à chaque image tant que la souris tourne la caméra).
 */
function empreinte() {
  const asp = view.widthPx / view.heightPx;
  const ex = BA[6] * DIST_P; // œil relatif à la cible
  const ey = BA[7] * DIST_P;
  const ez = BA[8] * DIST_P;
  for (let pass = 0; pass < 2; pass++) {
    const tv = pass === 0 ? TAN_P : TAN_P / S[ZOOM_NOW];
    const th = tv * asp;
    let aMax = 0;
    let bMin = 1e9;
    let bMax = -1e9;
    for (let k = 0; k < 4; k++) {
      const sx = k === 1 || k === 2 ? th : -th;
      const sy = k >= 2 ? tv : -tv;
      const dx = -BA[6] + BA[0] * sx + BA[3] * sy;
      const dy = -BA[7] + BA[1] * sx + BA[4] * sy;
      const dz = -BA[8] + BA[2] * sx + BA[5] * sy;
      let t = dy < -1e-4 ? ey / -dy : 1e4;
      if (t > 400) t = 400; // rayon presque à l'horizontale (n'arrive pas aux inclinaisons du jeu)
      const gx = ex + dx * t;
      const gz = ez + dz * t;
      if (pass === 0) {
        EMP[k * 2] = gx;
        EMP[k * 2 + 1] = gz;
      }
      const a = gx * view.rightX + gz * view.rightZ;
      const b = gx * view.upX + gz * view.upZ;
      const aa = a < 0 ? -a : a;
      if (aa > aMax) aMax = aa;
      if (b < bMin) bMin = b;
      if (b > bMax) bMax = b;
    }
    const d = -bMin > bMax ? -bMin : bMax;
    if (pass === 0) {
      view.halfW = aMax;
      view.halfD = d;
      view.prochD = -bMin;
      view.loinD = bMax;
    } else {
      view.visHalfW = aMax;
      view.visHalfD = d;
      view.visProchD = -bMin;
    }
  }
}

/**
 * § E5.AB.12 : caméra en perspective (true, mode Souris) ou orthographique. Une seule caméra active ; l'autre garde
 * sa place mais n'est plus dessinée. Prévient les abonnés onCamera (render.js). Hors combat seulement (réglage, partie).
 */
export function setPerspective(on) {
  const v = on ? 1 : 0;
  if (PERSP[0] === v || camOrtho === null) return;
  PERSP[0] = v;
  view.persp = v;
  threeCamera = v === 1 ? camPersp : camOrtho;
  if (v === 0) {
    view.halfW = view.ecranHalfW;
    view.halfD = view.halfH / Math.sin(S[PITCH_NOW] * DEG);
    view.prochD = view.halfD;
    view.loinD = view.halfD;
  }
  S[LAST_ZOOM] = -1; // le zoom est reposé sur la caméra devenue active
  visible();
  if (v === 0) view.visProchD = view.visHalfD;
  place();
  threeCamera.updateMatrixWorld();
  for (let i = 0; i < cameraListeners.length; i++) cameraListeners[i](threeCamera);
}

export function getPerspective() {
  return PERSP[0] === 1;
}

/** § E5.AB.12 : fn(camera) appelée à chaque changement de caméra active. À l'initialisation seulement. */
export function onCamera(fn) {
  if (typeof fn === 'function' && cameraListeners.indexOf(fn) < 0) cameraListeners.push(fn);
}

/**
 * § E5.AB.12 : projection pour l'interface — point du monde T[0], T[1], T[2] → pixels CSS T[3], T[4] de ce que l'on
 * VOIT (zoom de la molette compris, sans la secousse), T[5] = 1 s'il est devant la caméra. Ortho ou perspective.
 * Tableau typé : aucun flottant passé ni rendu (§ V).
 */
export function ecranT(T) {
  const vx = T[0] - view.targetX;
  const vy = T[1];
  const vz = T[2] - view.targetZ;
  const z = S[ZOOM_NOW];
  const cx = view.widthPx * 0.5;
  const cy = view.heightPx * 0.5;
  if (PERSP[0] === 0) {
    const a = vx * BA[0] + vy * BA[1] + vz * BA[2];
    const b = vx * BA[3] + vy * BA[4] + vz * BA[5];
    T[3] = cx + (a * z * cx) / view.ecranHalfW;
    T[4] = cy - (b * z * cy) / view.halfH;
    T[5] = 1;
    return;
  }
  const wx = vx - BA[6] * DIST_P;
  const wy = vy - BA[7] * DIST_P;
  const wz = vz - BA[8] * DIST_P;
  let prof = -(wx * BA[6] + wy * BA[7] + wz * BA[8]);
  T[5] = prof > 1e-3 ? 1 : 0;
  if (prof < 1e-3) prof = 1e-3;
  const tv = TAN_P / z;
  const xn = (wx * BA[0] + wy * BA[1] + wz * BA[2]) / (prof * tv * (view.widthPx / view.heightPx));
  const yn = (wx * BA[3] + wy * BA[4] + wz * BA[5]) / (prof * tv);
  T[3] = cx + xn * cx;
  T[4] = cy - yn * cy;
}

/** § E5.AB.12 : profondeur (m, le long de l'axe de visée) du point T[0..2] depuis l'œil sans secousse ; 1 en ortho. */
export function profondeurT(T) {
  if (PERSP[0] === 0) return 1;
  const wx = T[0] - view.targetX - BA[6] * DIST_P;
  const wy = T[1] - BA[7] * DIST_P;
  const wz = T[2] - view.targetZ - BA[8] * DIST_P;
  return -(wx * BA[6] + wy * BA[7] + wz * BA[8]);
}

/** § E5.AB.12 : distance œil → cible en perspective (m). */
export function distancePerspective() {
  return DIST_P;
}
//#endregion e5:AB-camera-3p

//#region e5:AB-camera-3p
/** § E5.AB.10 : saut du héros de l'image → suivi décalé avec lui, décalage de rattrapage à l'opposé (S[SAUT_] = 1). */
function absorberSaut() {
  // § E5.AB.10 : saut du héros (dash, téléportation : déplacement de l'image au-delà de rattrapage.vitesse m/s, en deçà
  // de sautMax m) — le suivi est décalé avec lui (il ne voit pas le saut) et le décalage de rattrapage prend l'opposé : la
  // cible vue ne bouge pas à cet instant, puis le ressort critique la mène au héros (vitesse continue, aucun dépassement)
  const RT = CAMERA_3P.rattrapage;
  const realDt = S[DT_];
  S[SAUT_] = 0;
  if (RT.omega > 0 && realDt > 0) {
    let dpx = P.x - S[LAST_PX];
    let dpz = P.z - S[LAST_PZ];
    const d2 = dpx * dpx + dpz * dpz;
    const lim = RT.vitesse * realDt;
    // dash en cours (toute l'image est du dash), ou fini dans cette image : seule la part du dash est un saut — le reste
    // de l'image est de la marche à la vitesse de sortie du dash (P.vx, P.vz), suivie normalement (sans cela : +6 m/s
    // d'une image à l'autre à la fin de la glissade, mesuré ; et une courbe qui dépendait de la cadence)
    const fin = P.dashT <= 0 && RAT_N[1] === 1;
    RAT_N[1] = P.dashT > 0 ? 1 : 0;
    if (fin && !(d2 > lim * lim)) {
      dpx -= P.vx * realDt;
      dpz -= P.vz * realDt;
      if (dpx * (P.x - S[LAST_PX]) + dpz * (P.z - S[LAST_PZ]) < 0) {
        dpx = 0; // la marche couvre tout le déplacement : rien à rattraper
        dpz = 0;
      }
    }
    const a2 = dpx * dpx + dpz * dpz;
    if ((d2 > lim * lim || (P.dashT > 0 && d2 > 0) || (fin && a2 > 0)) && d2 < RT.sautMax * RT.sautMax) {
      S[SAUT_] = 1;
      RAT_N[0]++;
      S[SUIVI_X] += dpx;
      S[SUIVI_Z] += dpz;
      // glissade (dash qui dure) : le déplacement s'est fait PENDANT l'image — moitié avant le pas du rattrapage, moitié
      // après (sinon il compte une demi-image trop tôt : 10 cm d'écart entre 60 et 144 Hz, mesuré) ; téléportation : d'un coup
      const lt = RT.vitesseTele * realDt;
      const tp = !((P.dashT > 0 || fin) && d2 < lt * lt); // plus vite que vitesseTele, ou hors dash : téléportation
      const k = tp ? 1 : 0.5;
      S[RAT_EX] = dpx * (1 - k);
      S[RAT_EZ] = dpz * (1 - k);
      dpx *= k;
      dpz *= k;
      S[RAT_X] -= dpx;
      S[RAT_Z] -= dpz;
      S[RAT_CX] -= dpx;
      S[RAT_CZ] -= dpz;
      S[RAT_DX] -= dpx;
      S[RAT_DZ] -= dpz;
      // grand saut : rattrapage un peu plus long (la pulsation ne fait que baisser pendant un même rattrapage)
      const r2 = S[RAT_X] * S[RAT_X] + S[RAT_Z] * S[RAT_Z];
      const w = r2 > RT.grand * RT.grand ? RT.omegaGrand : RT.omega;
      if (S[RAT_VX] === 0 && S[RAT_VZ] === 0 && r2 === dpx * dpx + dpz * dpz) S[RAT_W] = w; // rattrapage qui commence (au repos)
      else if (w < S[RAT_W]) S[RAT_W] = w;
      // le héros reste à l'écran : décalage borné (au-delà, la caméra saute du reste — très grands sauts seulement)
      // borne : decalageMax, et les 3/4 du champ VISIBLE vers le bas de l'écran (le plus court en perspective) et en largeur
      let lim = RT.decalageMax;
      const lp = view.visProchD * 0.75;
      const lw = (view.ecranHalfW / view.zoom) * 0.75;
      if (lp < lim) lim = lp;
      if (lw < lim) lim = lw;
      if (r2 > lim * lim) {
        const k = lim / Math.sqrt(r2);
        S[RAT_X] *= k;
        S[RAT_Z] *= k;
        S[RAT_CX] *= k;
        S[RAT_CZ] *= k;
        S[RAT_DX] *= k;
        S[RAT_DZ] *= k;
      }
    }
  }
}
//#endregion e5:AB-camera-3p

//#region e5:AB-camera-3p
/** § E5.AB.10 : pas du décalage de rattrapage (quatre pôles), puis cible vue = suivi + décalage. */
function pasRattrapage() {
  // § E5.AB.10 : décalage de rattrapage — consigne à deux étages (pôle double, solution exacte) suivie par un ressort
  // critique : quatre pôles confondus en −ω, départ SANS à-coup (vitesse, accélération et à-coup nuls au saut), arrivée
  // sans dépassement. Sous-pas de 2 ms pour le ressort (même courbe à 60 et à 144 Hz, à moins de 1 mm).
  const realDt = S[DT_];
  const RT = CAMERA_3P.rattrapage;
  if (S[RAT_X] !== 0 || S[RAT_Z] !== 0 || S[RAT_VX] !== 0 || S[RAT_VZ] !== 0 || S[RAT_CX] !== 0 || S[RAT_CZ] !== 0 || S[RAT_DX] !== 0 || S[RAT_DZ] !== 0) {
    const w = S[RAT_W];
    const w2 = w * w;
    let reste = realDt;
    while (reste > 1e-7) {
      const h = reste > 0.002 ? 0.002 : reste;
      const e = Math.exp(-w * h);
      // c' = −ω c ; d' = ω (c − d) : d(t + h) = (d + ω h c) e^(−ωh), c(t + h) = c e^(−ωh)
      S[RAT_DX] = (S[RAT_DX] + w * h * S[RAT_CX]) * e;
      S[RAT_DZ] = (S[RAT_DZ] + w * h * S[RAT_CZ]) * e;
      S[RAT_CX] *= e;
      S[RAT_CZ] *= e;
      S[RAT_VX] += (w2 * (S[RAT_DX] - S[RAT_X]) - 2 * w * S[RAT_VX]) * h;
      S[RAT_VZ] += (w2 * (S[RAT_DZ] - S[RAT_Z]) - 2 * w * S[RAT_VZ]) * h;
      S[RAT_X] += S[RAT_VX] * h;
      S[RAT_Z] += S[RAT_VZ] * h;
      reste -= h;
    }
    if (S[RAT_EX] !== 0 || S[RAT_EZ] !== 0) {
      S[RAT_X] -= S[RAT_EX];
      S[RAT_Z] -= S[RAT_EZ];
      S[RAT_CX] -= S[RAT_EX];
      S[RAT_CZ] -= S[RAT_EZ];
      S[RAT_DX] -= S[RAT_EX];
      S[RAT_DZ] -= S[RAT_EZ];
      S[RAT_EX] = 0;
      S[RAT_EZ] = 0;
    }
    const eps = RT.epsilon;
    if (S[RAT_X] < eps && S[RAT_X] > -eps && S[RAT_Z] < eps && S[RAT_Z] > -eps && S[RAT_VX] < eps && S[RAT_VX] > -eps && S[RAT_VZ] < eps && S[RAT_VZ] > -eps && S[RAT_CX] < eps && S[RAT_CX] > -eps && S[RAT_CZ] < eps && S[RAT_CZ] > -eps && S[RAT_DX] < eps && S[RAT_DX] > -eps && S[RAT_DZ] < eps && S[RAT_DZ] > -eps) {
      S[RAT_X] = 0; // arrivé (sous le dixième de millimètre) : le suivi seul, exact
      S[RAT_Z] = 0;
      S[RAT_VX] = 0;
      S[RAT_VZ] = 0;
      S[RAT_CX] = 0;
      S[RAT_CZ] = 0;
      S[RAT_DX] = 0;
      S[RAT_DZ] = 0;
    }
    view.targetX = S[SUIVI_X] + S[RAT_X];
    view.targetZ = S[SUIVI_Z] + S[RAT_Z];
  } else {
    view.targetX = S[SUIVI_X];
    view.targetZ = S[SUIVI_Z];
  }
}
//#endregion e5:AB-camera-3p

//#region e5:AB-camera-3p
/** § E5.AB.2 : pas du ressort du lacet ; rend 1 s'il a bougé (base à refaire). */
function pasLacet() {
  // § E5.AB.2 : écarts de la souris (input.ROTATION, lié par lierRotation) → lacet demandé, ici plutôt que dans une
  // fonction appelée par main (mesuré : 11 o/image dans tourner, jamais optimisée)
  if (ROT !== null && ROT[0] !== 0) tourner(ROT);
  // § E5.AB : lacet — ressort critique vers le lacet demandé (solution exacte du pas, comme l'inclinaison) ; ω = 0 : posé
  const realDt = S[DT_];
  let yx = S[YAW_NOW] - S[YAW_GOAL];
  let yv = S[YAW_VEL];
  if (yx !== 0 || yv !== 0) {
    const L = CAMERA_3P.lissage;
    const yw = L.omega;
    if (yw > 0) {
      const ye = Math.exp(-yw * realDt);
      const yk = yv + yw * yx;
      yx = (yx + yk * realDt) * ye;
      yv = (yv - yk * yw * realDt) * ye;
    } else {
      yx = 0;
      yv = 0;
    }
    if (yx < L.epsilon && yx > -L.epsilon && yv < L.epsilon && yv > -L.epsilon) {
      yx = 0; // arrivé : valeur EXACTE du lacet demandé
      yv = 0;
    }
    S[YAW_NOW] = S[YAW_GOAL] + yx;
    S[YAW_VEL] = yv;
    // mode Clavier revenu : le lacet d'origine EXACT (pas 20 + 360 k : la vue de main au bit près)
    if (yx === 0 && ORBITE[0] === 0) {
      S[YAW_NOW] = CAMERA.yawDeg;
      S[YAW_GOAL] = CAMERA.yawDeg;
    }
    return 1;
  }
  return 0;
}
//#endregion e5:AB-camera-3p

//#region e5:AK-mort-claire
/**
 * § E5.AK : [poids 0..1, x, z] — la cible vue est tirée vers (x, z) de ce poids, après le suivi et le rattrapage. Écrit
 * à chaque image par src/mort-claire.js (0 hors de la mort). Poids 0 : x + (a − x) × 0 = x, la vue de main au bit près.
 */
export const REGARD = new Float64Array(3);
/** Sans argument, sans branche (§ V) : tourne à chaque image. */
function regarder() {
  const w = REGARD[0];
  view.targetX += (REGARD[1] - view.targetX) * w;
  view.targetZ += (REGARD[2] - view.targetZ) * w;
}
//#endregion e5:AK-mort-claire

export function update(realDt) {
  // Suivi : lissage exponentiel indépendant de la cadence, sur le joueur seul (l'avance est retirée, puis rajoutée).
  // § E5.AB.10 : l'état du suivi est S[SUIVI_X/Z] (l'ancienne view.targetX/Z, mêmes calculs) ; la cible vue y ajoute le
  // décalage de rattrapage (nul en marche : la cible vue est le suivi, au bit près).
  const a = 1 - Math.exp(-CAMERA.followRate * realDt);
  const L = CAMERA.lead;
  const vx = realDt > 0 ? (P.x - S[LAST_PX]) / realDt : 0;
  const vz = realDt > 0 ? (P.z - S[LAST_PZ]) / realDt : 0;
  const tele = vx * vx + vz * vz > 900; // téléportation (Rejouer, debug) : pas une vitesse
  //#region e5:AB-camera-3p
  S[DT_] = realDt;
  absorberSaut(); // § E5.AB.10 (fonction à part : petite, vite optimisée — § V)
  const saut = S[SAUT_];
  //#endregion e5:AB-camera-3p
  S[SUIVI_X] -= S[LEAD_X];
  S[SUIVI_Z] -= S[LEAD_Z];
  S[SUIVI_X] += (P.x - S[SUIVI_X]) * a;
  S[SUIVI_Z] += (P.z - S[SUIVI_Z]) * a;
  // Avance : vitesse RÉELLE de l'image (déplacement), × lead.seconds, bornée à lead.max, lissée à lead.rate.
  S[LAST_PX] = P.x;
  S[LAST_PZ] = P.z;
  let lx = tele ? 0 : vx * L.seconds;
  let lz = tele ? 0 : vz * L.seconds;
  const ll = Math.sqrt(lx * lx + lz * lz);
  if (ll > L.max) {
    lx *= L.max / ll;
    lz *= L.max / ll;
  }
  if (saut === 1) {
    lx = S[LEAD_TX]; // § E5.AB.10 : pendant un saut, l'avance visée reste celle d'avant (pas d'à-coup)
    lz = S[LEAD_TZ];
  }
  S[LEAD_TX] = lx;
  S[LEAD_TZ] = lz;
  const la = 1 - Math.exp(-L.rate * realDt);
  S[LEAD_X] += (lx - S[LEAD_X]) * la;
  S[LEAD_Z] += (lz - S[LEAD_Z]) * la;
  S[SUIVI_X] += S[LEAD_X];
  S[SUIVI_Z] += S[LEAD_Z];
  //#region e5:AB-camera-3p
  pasRattrapage(); // § E5.AB.10 (fonction à part, § V)
  //#endregion e5:AB-camera-3p
  //#region e5:AK-mort-claire
  regarder(); // § E5.AK : cible vue tirée vers la source du coup mortel (poids 0 : rien ne change)
  //#endregion e5:AK-mort-claire

  // Plafonds : avance des tranches.
  S[SLOT_CLOCK] += realDt;
  while (S[SLOT_CLOCK] >= SLOT_SECONDS) {
    S[SLOT_CLOCK] -= SLOT_SECONDS;
    slotIndex = (slotIndex + 1) % SLOTS;
    for (let g = 0; g < GROUPS; g++) slots[g * SLOTS + slotIndex] = 0;
  }

  // Trauma : décroissance en temps réel, dans tous les états.
  let trauma = S[TRAUMA_] - SHAKE.decayPerSec * realDt;
  if (trauma < 0) trauma = 0;
  S[TRAUMA_] = trauma;
  for (let g = 0; g < GROUPS; g++) {
    const x = vivant[g] - SHAKE.decayPerSec * realDt;
    vivant[g] = x < 0 ? 0 : x;
  }
  S[NOISE_T] += realDt * SHAKE.frequency;
  // attaque : une explosion ne fait plus sauter la caméra de toute son amplitude en une image (mesuré : 0,66 m)
  let ap = S[AMP];
  if (trauma > ap) ap += (trauma - ap) * (1 - Math.exp(-realDt / SHAKE.attaque));
  else ap = trauma;
  S[AMP] = ap;
  const amp = ap * ap * intensity;
  if (amp > 0) {
    // Bruit de valeur lissé (interpolation en smoothstep entre deux valeurs de la table), écrit en ligne : un
    // appel de fonction qui reçoit ou renvoie un flottant coûterait un nombre alloué par canal et par image (§ V).
    const t = S[NOISE_T];
    const i = Math.floor(t);
    let f = t - i;
    f = f * f * (3 - 2 * f);
    const i0 = i & (NOISE_N - 1);
    const i1 = (i + 1) & (NOISE_N - 1);
    for (let ch = 0; ch < 3; ch++) {
      const a0 = noise[ch * NOISE_N + i0];
      const a1 = noise[ch * NOISE_N + i1];
      S[OFFSET_X + ch] = CHANNEL_SCALE[ch] * amp * (a0 + (a1 - a0) * f);
    }
  } else {
    S[OFFSET_X] = 0;
    S[OFFSET_Y] = 0;
    S[ROLL_DEG] = 0;
  }

  // Houle : s'ajoute au décalage de la secousse (même canaux), réglée par l'intensité des secousses du joueur
  if (S[HOULE_AGE] < S[HOULE_DUR]) {
    S[HOULE_AGE] += realDt;
    const u = S[HOULE_AGE] / S[HOULE_DUR];
    if (u < 1) {
      const montee = u < 0.08 ? u / 0.08 : 1;
      const v = 1 - u;
      const env = montee * montee * (3 - 2 * montee) * v * v * intensity;
      const ph = 6.283185307179586 * S[HOULE_F] * S[HOULE_AGE];
      S[OFFSET_X] += S[HOULE_AMP] * env * (Math.sin(ph) * 0.75 + Math.sin(ph * 1.73 + 1.3) * 0.25);
      S[OFFSET_Y] += S[HOULE_AMP] * env * (Math.cos(ph * 0.87 + 0.4) * 0.75 + Math.sin(ph * 1.41 + 2.1) * 0.25);
      S[ROLL_DEG] += S[HOULE_ROLL] * env * Math.sin(ph * 0.61 + 0.9);
    }
  }

  // Coup directionnel : ressort critique, intégration semi-implicite en sous-pas de 4 ms (exact à toute cadence).
  const w = SHAKE.kick.omega;
  let rest = realDt;
  while (rest > 1e-6) {
    const h = rest > 0.004 ? 0.004 : rest;
    S[KICK_VX] += (-w * w * S[KICK_X] - 2 * w * S[KICK_VX]) * h;
    S[KICK_VY] += (-w * w * S[KICK_Y] - 2 * w * S[KICK_VY]) * h;
    S[KICK_X] += S[KICK_VX] * h;
    S[KICK_Y] += S[KICK_VY] * h;
    rest -= h;
  }
  const kl = Math.sqrt(S[KICK_X] * S[KICK_X] + S[KICK_Y] * S[KICK_Y]);
  // ressort revenu au repos (sous le micromètre, vitesse négligeable) : remis à zéro EXACT — sinon le reste décroît
  // sans fin (1e-20 m relevé à 0 % d'intensité) et offsetX / offsetY ne valent jamais 0 (§ W, critère 6 ; § Z nonies)
  if (kl < 1e-6 && Math.abs(S[KICK_VX]) + Math.abs(S[KICK_VY]) < 1e-5) {
    S[KICK_X] = 0;
    S[KICK_Y] = 0;
    S[KICK_VX] = 0;
    S[KICK_VY] = 0;
  } else if (kl > SHAKE.kick.max) {
    S[KICK_X] *= SHAKE.kick.max / kl;
    S[KICK_Y] *= SHAKE.kick.max / kl;
  }

  // Punch : retour à 0 en returnSeconds, courbe quadratique.
  S[PUNCH_AGE] += realDt;
  if (S[PUNCH_AGE] < CAMERA.punch.returnSeconds) {
    const k = 1 - S[PUNCH_AGE] / CAMERA.punch.returnSeconds;
    S[PUNCH_NOW] = S[PUNCH_AMP] * k * k;
  } else {
    S[PUNCH_NOW] = 0;
  }

  // § E2.E — zoom de la molette : ressort critique vers le zoom demandé, solution EXACTE du pas (indépendante de la
  // cadence, sans sous-pas) : départ et arrivée en douceur, aucun dépassement depuis le repos ; butées dures.
  let goal = ZOOM.min + S[ZOOM_STEPS] * ZOOM.step;
  if (goal > ZOOM.max) goal = ZOOM.max;
  let zx = S[ZOOM_NOW] - goal;
  let zv = S[ZOOM_VEL];
  if (zx !== 0 || zv !== 0) {
    const zw = ZOOM.omega;
    const ze = Math.exp(-zw * realDt);
    const zk = zv + zw * zx;
    zx = (zx + zk * realDt) * ze;
    zv = (zv - zk * zw * realDt) * ze;
    // arrivé : valeur EXACTE (au recul maximum le zoom vaut 1, la vue est celle du cahier au pixel près)
    if (zx < ZOOM.epsilon && zx > -ZOOM.epsilon && zv < ZOOM.epsilon && zv > -ZOOM.epsilon) {
      zx = 0;
      zv = 0;
    }
    let zn = goal + zx;
    if (zn <= ZOOM.min) {
      zn = ZOOM.min;
      if (zv < 0) zv = 0;
    } else if (zn >= ZOOM.max) {
      zn = ZOOM.max;
      if (zv > 0) zv = 0;
    }
    S[ZOOM_NOW] = zn;
    S[ZOOM_VEL] = zv;
  }

  // § E3.L — changement de réglage : ressort critique sur l'inclinaison, même solution exacte que le zoom.
  let refaire = 0; // § E5.AB : base() refaite une fois si l'inclinaison ou le lacet a bougé
  let px = S[PITCH_NOW] - S[PITCH_GOAL];
  let pv = S[PITCH_VEL];
  if (px !== 0 || pv !== 0) {
    const pw = CAMERA.transition.omega;
    const pe = Math.exp(-pw * realDt);
    const pk = pv + pw * px;
    px = (px + pk * realDt) * pe;
    pv = (pv - pk * pw * realDt) * pe;
    const eps = CAMERA.transition.epsilon;
    if (px < eps && px > -eps && pv < eps && pv > -eps) {
      px = 0; // arrivé : valeur EXACTE du réglage
      pv = 0;
    }
    S[PITCH_NOW] = S[PITCH_GOAL] + px;
    S[PITCH_VEL] = pv;
    refaire = 1;
  }
  //#region e5:AB-camera-3p
  if (pasLacet() === 1) refaire = 1; // § E5.AB.2 (fonction à part, § V)
  //#endregion e5:AB-camera-3p
  if (refaire === 1) base();
  place();
}

/** Recalcule le frustum : 32 m de haut quelle que soit la fenêtre, largeur = hauteur × ratio (critère 7). */
export function resize(widthCss, heightCss) {
  const w = widthCss > 1 ? widthCss : 1;
  const h = heightCss > 1 ? heightCss : 1;
  const top = CAMERA.viewHeight / 2;
  const right = (top * w) / h;
  const cam = camOrtho; // § E5.AB.12 : les deux caméras suivent la fenêtre, active ou non
  cam.left = -right;
  cam.right = right;
  cam.top = top;
  cam.bottom = -top;
  cam.updateProjectionMatrix();
  camPersp.aspect = w / h;
  camPersp.updateProjectionMatrix();
  view.ecranHalfW = right;
  view.halfW = right;
  view.halfH = top;
  view.halfD = top / Math.sin(S[PITCH_NOW] * DEG); // § E3.L : inclinaison vivante
  view.widthPx = w;
  view.heightPx = h;
  view.pxPerMeter = h / CAMERA.viewHeight;
  visible(); // § E2.E : le zoom de la molette est gardé, le champ visible suit la fenêtre
  if (PERSP[0] === 0) {
    view.prochD = view.halfD;
    view.loinD = view.halfD;
    view.visProchD = view.visHalfD;
  }
}

/** Ajoute du trauma, dans la limite du plafond du groupe sur la seconde glissante. Renvoie ce qui est accordé. */
export function addTrauma(amount, source) {
  if (!(amount > 0) || amount === Infinity) return 0;
  if (!(source >= 0 && source < TRAUMA_COUNT)) return 0;
  const g = SHAKE.groupOf[source];
  // limite d'accumulation : la secousse du groupe n'est pas encore retombée → la demande est ignorée
  if (vivant[g] > SHAKE.relance * SHAKE.groupCap[g]) {
    ignored[g]++;
    return 0;
  }
  const room = SHAKE.groupCap[g] - groupSum(g);
  let grant = amount < room ? amount : room;
  if (!(grant > 0)) return 0;
  vivant[g] += grant;
  slots[g * SLOTS + slotIndex] += grant;
  grantedTotal[source] += grant;
  const t = S[TRAUMA_] + grant;
  S[TRAUMA_] = t > 1 ? 1 : t;
  return grant;
}

/**
 * Houle : balancement doux de la caméra (amplitude m d'écran, durée s, fréquence Hz, roulis degrés). Une demande
 * remplace la houle en cours. Appelée une fois par début de vague (world.majImpulsion).
 */
export function addHoule(amplitude, duree, frequence, roulis) {
  if (!(amplitude > 0) || !(duree > 0)) return;
  S[HOULE_AGE] = 0;
  S[HOULE_DUR] = duree;
  S[HOULE_AMP] = amplitude;
  S[HOULE_F] = frequence;
  S[HOULE_ROLL] = roulis;
}

/** Comme addTrauma, atténué avec la distance entre (x, z) et la cible de la caméra. */
export function addTraumaAt(amount, source, x, z) {
  if (!(amount > 0) || amount === Infinity) return 0;
  const dx = x - view.targetX;
  const dz = z - view.targetZ;
  const d = Math.sqrt(dx * dx + dz * dz);
  const f = SHAKE.falloff;
  let k = 1 - (d - f.fullWithin) / (f.zeroAt - f.fullWithin);
  if (!(k >= f.floor)) k = f.floor; // couvre aussi NaN
  if (k > 1) k = 1;
  const grant = addTrauma(amount * k, source);
  if (grant > 0 && intensity > 0) {
    // coup directionnel : de la source vers la cible, dans le plan de l'écran (0 à 0 % d'intensité, critère 6)
    const sx = -(dx * BA[0] + dz * BA[2]);
    const sy = dx * BA[3] + dz * BA[5];
    const l = Math.sqrt(sx * sx + sy * sy);
    if (l > 1e-3) {
      const kick = SHAKE.kick.perTrauma * grant * intensity * KICK_W0;
      S[KICK_VX] += (sx / l) * kick;
      S[KICK_VY] += (sy / l) * kick;
    }
  }
  return grant;
}

/** +0,03 = zoom avant de 3 %. Refusé (false) s'il suit de trop près un punch au moins aussi fort. */
export function punchZoom(fraction) {
  if (!Number.isFinite(fraction) || fraction === 0) return false;
  const max = CAMERA.punch.max;
  let f = fraction;
  if (f > max) f = max;
  else if (f < -max) f = -max;
  if (S[PUNCH_AGE] < SHAKE.punchMinInterval && Math.abs(f) <= Math.abs(S[PUNCH_AMP])) return false;
  S[PUNCH_AMP] = f;
  S[PUNCH_AGE] = 0;
  S[PUNCH_NOW] = f;
  punches++;
  return true;
}

// ----- § E2.E : zoom à la molette ---------------------------------------------------------------------------------

/**
 * n crans de molette (entier ; positif = on se rapproche). Le zoom DEMANDÉ est borné à [ZOOM.min, ZOOM.max] : 1 000
 * crans arrière ou une molette à inertie s'arrêtent à la butée. Le zoom courant le rejoint en douceur (update).
 */
export function addZoomSteps(n) {
  if (n === 0 || n !== n) return;
  let k = S[ZOOM_STEPS] + n;
  if (!(k > 0)) k = 0; // couvre −Infinity
  else if (k > ZOOM_STEPS_MAX) k = ZOOM_STEPS_MAX;
  S[ZOOM_STEPS] = k;
}

/** Fixe le zoom demandé (borné, recalé sur le cran le plus proche). immediat : posé sans animation (chargement). */
export function setZoom(z, immediat = false) {
  if (!Number.isFinite(z)) return false;
  let k = Math.round((z - ZOOM.min) / ZOOM.step);
  if (k < 0) k = 0;
  else if (k > ZOOM_STEPS_MAX) k = ZOOM_STEPS_MAX;
  S[ZOOM_STEPS] = k;
  if (immediat) {
    S[ZOOM_NOW] = getZoom();
    S[ZOOM_VEL] = 0;
    place();
  }
  return true;
}

/** Zoom DEMANDÉ (celui que l'on sauve), de ZOOM.min à ZOOM.max. */
export function getZoom() {
  const z = ZOOM.min + S[ZOOM_STEPS] * ZOOM.step;
  return z > ZOOM.max ? ZOOM.max : z;
}

/** Zoom demandé en crans entiers depuis le recul maximum (lu à chaque image par main : un entier, sans allocation). */
export function getZoomSteps() {
  return S[ZOOM_STEPS] | 0;
}

export function setShakeIntensity(v) {
  if (!Number.isFinite(v)) return;
  intensity = v < 0 ? 0 : v > 1 ? 1 : v;
}

export function getShakeIntensity() {
  return intensity;
}

export function getTrauma() {
  return S[TRAUMA_];
}

/**
 * Projection d'un point du monde en pixels CSS (origine en haut à gauche), sans la secousse, dans le CHAMP DE JEU
 * (le recul maximum, § E2.E) : au zoom 1 ce sont les pixels de l'écran ; zoomé, `inside` reste « dans le champ de jeu »
 * (apparitions, pales « seulement à l'écran »). L'interface, elle, lit view.vis* (ui.updateArrows).
 */
export function worldToScreen(x, y, z, out) {
  const vx = x - view.targetX;
  const vz = z - view.targetZ;
  //#region e5:AB-camera-3p
  if (PERSP[0] === 1) {
    // § E5.AB.12 : perspective, champ de jeu (zoom 1), sans la secousse
    const wx = vx - BA[6] * DIST_P;
    const wy = y - BA[7] * DIST_P;
    const wz = vz - BA[8] * DIST_P;
    const prof = -(wx * BA[6] + wy * BA[7] + wz * BA[8]);
    const pr = prof > 1e-3 ? prof : 1e-3;
    const xn = (wx * BA[0] + wy * BA[1] + wz * BA[2]) / (pr * TAN_P * (view.widthPx / view.heightPx));
    const yn = (wx * BA[3] + wy * BA[4] + wz * BA[5]) / (pr * TAN_P);
    out.x = view.widthPx * 0.5 * (1 + xn);
    out.y = view.heightPx * 0.5 * (1 - yn);
    out.inside = prof > 1e-3 && xn >= -1 && xn <= 1 && yn >= -1 && yn <= 1;
    return out;
  }
  //#endregion e5:AB-camera-3p
  const a = vx * BA[0] + y * BA[1] + vz * BA[2]; // m d'écran vers la droite
  const b = vx * BA[3] + y * BA[4] + vz * BA[5]; // m d'écran vers le haut
  out.x = (a / view.halfW) * 0.5 * view.widthPx + view.widthPx * 0.5;
  out.y = view.heightPx * 0.5 - (b / view.halfH) * 0.5 * view.heightPx;
  out.inside = a >= -view.halfW && a <= view.halfW && b >= -view.halfH && b <= view.halfH;
  return out;
}

/** Le point du sol est-il dans le champ de jeu (l'empreinte visible au recul maximum, § E2.E) élargi de margin mètres ? */
export function isOnScreen(x, z, margin) {
  const vx = x - view.targetX;
  const vz = z - view.targetZ;
  const a = vx * view.rightX + vz * view.rightZ;
  const b = vx * view.upX + vz * view.upZ;
  return a >= -view.halfW - margin && a <= view.halfW + margin && b >= -view.halfD - margin && b <= view.halfD + margin;
}

// ----- § E3.L : réglages de caméra et rayon vers le sol ------------------------------------------------------------

/**
 * Réglage i de CAMERA.reglages (index, ou clé 'haute' | 'moyenne' | 'basse'). L'inclinaison le rejoint en douceur
 * (update) ; immediat : posé sans transition (chargement). Rend la clé retenue, ou null si refusé.
 */
export function setReglage(i, immediat = false) {
  const R = CAMERA.reglages;
  let k = -1;
  if (typeof i === 'string') {
    for (let j = 0; j < R.length; j++) if (R[j].key === i) k = j;
  } else if (Number.isInteger(i) && i >= 0 && i < R.length) k = i;
  if (k < 0) return null;
  view.reglage = k;
  S[PITCH_GOAL] = R[k].pitchDeg;
  if (immediat) {
    S[PITCH_NOW] = S[PITCH_GOAL];
    S[PITCH_VEL] = 0;
    base();
    place();
  }
  return R[k].key;
}

/** Réglage suivant (Haute → Moyenne → Basse → Haute) ; rend sa clé. */
export function nextReglage() {
  return setReglage((view.reglage + 1) % CAMERA.reglages.length);
}

/** Clé du réglage demandé. */
export function getReglage() {
  return CAMERA.reglages[view.reglage].key;
}

/**
 * Visée à la souris : le point du SOL (y = 0) sous le pixel CSS (sx, sy) de ce que l'on VOIT (zoom de la molette,
 * punch et secousse compris ; roulis ignoré, ≤ SHAKE.maxRollDeg). Écrit out.x, out.z ; rend out. Sans allocation.
 */
//#region e5:AB-camera-3p
const SG = new Float64Array(4); // pixel CSS (x, y) → point du sol (x, z)
/**
 * § E5.AB.12 : rayon de la caméra en perspective par le pixel SG[0], SG[1] (ce que l'on VOIT : zoom × punch, secousse
 * comprise, roulis ignoré) jusqu'au sol → SG[2], SG[3]. Sans argument ni allocation.
 */
function rayonSol() {
  const za = S[LAST_ZOOM] > 0 ? S[LAST_ZOOM] : S[ZOOM_NOW];
  const zm = S[ZOOM_NOW];
  const xn = (SG[0] - view.widthPx * 0.5) / (view.widthPx * 0.5);
  const yn = (view.heightPx * 0.5 - SG[1]) / (view.heightPx * 0.5);
  const tv = TAN_P / za;
  const th = tv * (view.widthPx / view.heightPx);
  const ox = (S[OFFSET_X] + S[KICK_X]) / zm;
  const oy = (S[OFFSET_Y] + S[KICK_Y]) / zm;
  const ex = view.targetX + BA[6] * DIST_P + BA[0] * ox + BA[3] * oy;
  const ey = BA[7] * DIST_P + BA[1] * ox + BA[4] * oy;
  const ez = view.targetZ + BA[8] * DIST_P + BA[2] * ox + BA[5] * oy;
  const dx = -BA[6] + BA[0] * xn * th + BA[3] * yn * tv;
  const dy = -BA[7] + BA[1] * xn * th + BA[4] * yn * tv;
  const dz = -BA[8] + BA[2] * xn * th + BA[5] * yn * tv;
  let t = dy < -1e-4 ? ey / -dy : 1e4;
  if (t > 400) t = 400;
  SG[2] = ex + dx * t;
  SG[3] = ez + dz * t;
}
//#endregion e5:AB-camera-3p

export function screenToGround(sx, sy, out) {
  const za = S[LAST_ZOOM]; // zoom appliqué à la caméra (molette × punch)
  const zm = S[ZOOM_NOW]; // la secousse est divisée par le zoom de la molette seul (place)
  if (PERSP[0] === 1) {
    // § E5.AB.12
    SG[0] = sx;
    SG[1] = sy;
    rayonSol();
    out.x = SG[2];
    out.z = SG[3];
    return out;
  }
  const a = ((sx - view.widthPx * 0.5) / (view.widthPx * 0.5)) * (view.halfW / za) + (S[OFFSET_X] + S[KICK_X]) / zm;
  const b = ((view.heightPx * 0.5 - sy) / (view.heightPx * 0.5)) * (view.halfH / za) + (S[OFFSET_Y] + S[KICK_Y]) / zm;
  // point du plan de l'écran passant par la cible, puis le long de l'axe de visée (−d) jusqu'au sol
  const qx = view.targetX + BA[0] * a + BA[3] * b;
  const qy = BA[1] * a + BA[4] * b;
  const qz = view.targetZ + BA[2] * a + BA[5] * b;
  const s = qy / BA[7];
  out.x = qx - BA[6] * s;
  out.z = qz - BA[8] * s;
  return out;
}

//#region e5:U-visee-souris
/** § E5.U.2 : screenToGround avec le point d'écran lu dans T[0], T[1] et le point du sol écrit dans out[0], out[1]
 * (tableaux typés : aucun flottant passé ni rangé dans un objet, § V — mesuré : un objet { x, z } allouait 7,7 o/image). */
export function screenToGroundT(T, out) {
  const za = S[LAST_ZOOM];
  const zm = S[ZOOM_NOW];
  if (PERSP[0] === 1) {
    // § E5.AB.12
    SG[0] = T[0];
    SG[1] = T[1];
    rayonSol();
    out[0] = SG[2];
    out[1] = SG[3];
    return out;
  }
  const a = ((T[0] - view.widthPx * 0.5) / (view.widthPx * 0.5)) * (view.halfW / za) + (S[OFFSET_X] + S[KICK_X]) / zm;
  const b = ((view.heightPx * 0.5 - T[1]) / (view.heightPx * 0.5)) * (view.halfH / za) + (S[OFFSET_Y] + S[KICK_Y]) / zm;
  const qx = view.targetX + BA[0] * a + BA[3] * b;
  const qy = BA[1] * a + BA[4] * b;
  const qz = view.targetZ + BA[2] * a + BA[5] * b;
  const s = qy / BA[7];
  out[0] = qx - BA[6] * s;
  out[1] = qz - BA[8] * s;
  return out;
}
//#endregion e5:U-visee-souris

//#region e5:AB-camera-3p
/**
 * § E5.AB.2 : écart horizontal de la souris (px, cumulé dans T[0] par input.js) → lacet demandé ; T[0] remis à 0.
 * Souris à droite → la vue tourne à droite (lacet qui diminue). Sans effet hors mode Souris. Tableau typé : aucun
 * flottant passé en argument (§ V).
 */
export function tourner(T) {
  if (ORBITE[0] === 0 || T[0] === 0) {
    T[0] = 0; // Vue fixe, ou souris immobile : rien à lire (aucun flottant manipulé, § V)
    return;
  }
  const px = T[0];
  T[0] = 0;
  if (px !== px) return;
  let g = S[YAW_GOAL] - px * CAMERA_3P.sensibilite * SENSIBILITE_SOURIS.mul; // § E5.AG : × le réglage (1 au milieu : exact)
  // lacets bornés : ramenés de 360° ENSEMBLE (même vue, sin et cos périodiques)
  while (g > 540) {
    g -= 360;
    S[YAW_NOW] -= 360;
  }
  while (g < -540) {
    g += 360;
    S[YAW_NOW] += 360;
  }
  S[YAW_GOAL] = g;
}

let ROT = null; // § E5.AB.2 : input.ROTATION (écart horizontal de la souris en attente, px)
/** § E5.AB.2 : lie le tableau des écarts de la souris (input.ROTATION) ; lu à chaque pas du lacet. */
export function lierRotation(T) {
  ROT = T;
}

/** § E5.AB.2 : mode Souris (true) — le lacet suit la souris ; false : il revient à CAMERA.yawDeg (ressort). */
export function setOrbite(on) {
  ORBITE[0] = on ? 1 : 0;
  setPerspective(ORBITE[0] === 1); // § E5.AB.12 : perspective SEULEMENT en mode Souris (Femz, 22/11)
  if (ORBITE[0] === 0) S[YAW_GOAL] = CAMERA.yawDeg + 360 * Math.round((S[YAW_NOW] - CAMERA.yawDeg) / 360);
}

export function getOrbite() {
  return ORBITE[0] === 1;
}

/** § E5.AB.2 : nouvelle partie — lacet posé à CAMERA.yawDeg sans transition (main.resetAll, AVANT player.reset). */
export function remettreLacet() {
  if (S[YAW_NOW] === CAMERA.yawDeg && S[YAW_GOAL] === CAMERA.yawDeg && S[YAW_VEL] === 0) return;
  S[YAW_NOW] = CAMERA.yawDeg;
  S[YAW_GOAL] = CAMERA.yawDeg;
  S[YAW_VEL] = 0;
  base();
  place();
}

/** Tests : lacet demandé posé (degrés) ; immediat : sans transition. */
export function setLacet(deg, immediat = false) {
  if (!Number.isFinite(deg)) return false;
  S[YAW_GOAL] = deg;
  if (immediat) {
    S[YAW_NOW] = deg;
    S[YAW_VEL] = 0;
    base();
    place();
  }
  return true;
}
//#endregion e5:AB-camera-3p

export function inspect(out) {
  out.pitchDeg = S[PITCH_NOW]; // § E3.L
  out.pitchGoalDeg = S[PITCH_GOAL];
  out.reglage = getReglage();
  out.pitchListeners = pitchListeners.length; // modules qui suivent l'inclinaison (fx, boss)
  out.lacetDeg = S[YAW_NOW]; // § E5.AB
  out.rattrapage = { x: S[RAT_X], z: S[RAT_Z], vx: S[RAT_VX], vz: S[RAT_VZ], omega: S[RAT_W], sauts: RAT_N[0], suiviX: S[SUIVI_X], suiviZ: S[SUIVI_Z] }; // § E5.AB.10
  out.lacetButDeg = S[YAW_GOAL];
  out.orbite = ORBITE[0] === 1;
  out.trauma = S[TRAUMA_];
  out.shakeIntensity = intensity;
  out.offsetX = S[OFFSET_X] + S[KICK_X];
  out.offsetY = S[OFFSET_Y] + S[KICK_Y];
  out.leadX = S[LEAD_X]; // avance de la cible (m au sol)
  out.leadZ = S[LEAD_Z];
  out.kickX = S[KICK_X]; // coup directionnel (m d'écran)
  out.kickY = S[KICK_Y];
  out.rollDeg = S[ROLL_DEG];
  out.zoomPunch = S[PUNCH_NOW] * intensity;
  out.punches = punches;
  out.zoom = S[ZOOM_NOW]; // § E2.E : zoom courant de la molette (lissé), sans le punch
  out.zoomTarget = getZoom(); // zoom demandé
  out.zoomSteps = S[ZOOM_STEPS]; // en crans depuis le recul maximum
  out.zoomApplied = threeCamera.zoom; // ce que la caméra reçoit : zoom × (1 + punch), jamais sous ZOOM.min
  const hautM = PERSP[0] === 1 ? 2 * DIST_P * TAN_P : threeCamera.top - threeCamera.bottom; // § E5.AB.12 : à la cible
  out.visibleHeightM = hautM / S[ZOOM_NOW]; // m visibles en hauteur, sans le punch
  out.viewHeightM = hautM;
  out.viewWidthM = PERSP[0] === 1 ? 2 * view.ecranHalfW : threeCamera.right - threeCamera.left;
  out.perspective = PERSP[0] === 1; // § E5.AB.12
  out.fovDeg = CAMERA_3P.perspective.fovDeg;
  out.distancePersp = DIST_P;
  out.empreinte = { halfW: view.halfW, halfD: view.halfD, prochD: view.prochD, loinD: view.loinD, visHalfW: view.visHalfW, visHalfD: view.visHalfD, visProchD: view.visProchD };
  out.targetX = view.targetX;
  out.targetZ = view.targetZ;
  // § E4.F (tests) : repère du champ de jeu — rectangle au sol où un robot est « dans le champ »
  out.field = { halfW: view.halfW, halfD: view.halfD, rightX: view.rightX, rightZ: view.rightZ, upX: view.upX, upZ: view.upZ, gph: view.groundPerHeight };
  const granted = {};
  const ign = {};
  for (let g = 0; g < GROUPS; g++) {
    granted[SHAKE.groupNames[g]] = groupSum(g);
    ign[SHAKE.groupNames[g]] = ignored[g];
  }
  out.granted = granted;
  out.ignored = ign; // demandes ignorées par la limite d'accumulation, depuis le chargement
  out.grantedTotal = {
    fire: grantedTotal[0],
    kill: grantedTotal[1],
    playerExplosion: grantedTotal[2],
    enemyExplosion: grantedTotal[3],
    playerHit: grantedTotal[4],
    boss: grantedTotal[5],
  };
}
