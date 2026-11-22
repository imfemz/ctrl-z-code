// RENDU « PEINT » — soleil, ciel et carte d'ombre qui suit la caméra (prototype du 13/11/2026, brief § 1 et § 3).
//
// Le soleil est donné par rapport à l'écran (PEINT.soleil) et converti en direction du monde depuis CAMERA.yawDeg et
// CAMERA.pitchDeg. La caméra d'ombre est un rectangle ajusté à l'emprise VISIBLE (le trapèze vu par la caméra
// orthographique, plus ce qui dépasse en hauteur en haut de l'écran), exprimé dans le repère de la lumière, recalé
// au texel près (aucun scintillement quand la caméra bouge). Mesuré à 1440 × 900 : rectangle de 66 × 61 m, texel de
// 3,2 cm à 2 048 — la même densité que le carré de 63 m de world.js (3,1 cm), mais qui couvre aussi ce qui dépasse en
// haut de l'écran (falaises de 9 m), et une ombre qui tombe vers la droite de l'écran.
//
// Contrat d'intégration (world.js) : init({ soleil, ciel }) à l'init — lumières fournies (réutilisées) ou créées ;
// update(view) une fois par image APRÈS camera.update (F10, à la place de world.update pour l'ombre) ;
// setQualite(niveau) quand render change de niveau (seul moment où la carte d'ombre est recréée).
// Zéro allocation par image : scalaires dans un Float64Array, objets de three réutilisés.
import * as THREE from 'three';
import { CAMERA } from '../config.js';
import { PEINT } from './reglages.js';

const DEG = Math.PI / 180;
// Index du tableau d'état
const DX = 0, DY = 1, DZ = 2; // direction VERS le soleil
const RX = 3, RY = 4, RZ = 5; // droite de la caméra d'ombre
const UX = 6, UY = 7, UZ = 8; // haut de la caméra d'ombre
const HA = 9, HB = 10; // demi-côtés courants du rectangle d'ombre
const OA = 11, OB = 12; // décalage du centre du rectangle (repère lumière) par rapport à la cible de la caméra
const ST = new Float64Array(13);

export let soleil = null;
export let ciel = null;
let carte = PEINT.qualite[0].carte;

/** Direction du soleil dans le monde, depuis les réglages relatifs à l'écran (écrit dans out[0..2]). */
export function directionSoleil(out) {
  const yaw = CAMERA.yawDeg * DEG;
  const rX = Math.cos(yaw), rZ = -Math.sin(yaw); // droite de l'écran au sol
  const uX = -Math.sin(yaw), uZ = -Math.cos(yaw); // haut de l'écran au sol
  const P = PEINT.soleil;
  let hx = -rX * P.depuisGauche - uX * P.versCamera; // vers la caméra = −haut
  let hz = -rZ * P.depuisGauche - uZ * P.versCamera;
  const hl = Math.hypot(hx, hz);
  hx /= hl;
  hz /= hl;
  const el = P.elevationDeg * DEG;
  out[0] = hx * Math.cos(el);
  out[1] = Math.sin(el);
  out[2] = hz * Math.cos(el);
  return out;
}

/**
 * Règle (ou crée) le soleil et le ciel. Rien n'est ajouté à la scène quand les lumières sont fournies ; sinon les
 * deux lumières et la cible du soleil sont ajoutées à scene.
 */
export function init({ scene = null, soleil: s = null, ciel: c = null } = {}) {
  soleil = s || new THREE.DirectionalLight();
  ciel = c || new THREE.HemisphereLight();
  if (!s && scene) {
    scene.add(soleil);
    scene.add(soleil.target);
  }
  if (!c && scene) scene.add(ciel);
  soleil.color.setHex(PEINT.soleil.couleur);
  soleil.intensity = PEINT.soleil.intensite;
  ciel.color.setHex(PEINT.ciel.couleur);
  ciel.groundColor.setHex(PEINT.ciel.sol);
  ciel.intensity = PEINT.ciel.intensite;
  const O = PEINT.ombre;
  soleil.castShadow = true;
  soleil.shadow.bias = O.bias;
  soleil.shadow.normalBias = O.normalBias;
  soleil.shadow.intensity = O.intensite;
  soleil.shadow.camera.near = 1;
  soleil.shadow.camera.far = O.far;
  setCarte(PEINT.qualite[0].carte);
  const d = directionSoleil(new Float64Array(3));
  ST[DX] = d[0];
  ST[DY] = d[1];
  ST[DZ] = d[2];
  // Base de la caméra d'ombre telle que three la déduit de lookAt (up = +Y) : droite = up × (−dir)… on garde la
  // convention de world.js : droite = (dz, 0, −dx) normalisé, haut = dir × droite.
  const rl = Math.hypot(ST[DZ], ST[DX]);
  ST[RX] = ST[DZ] / rl;
  ST[RY] = 0;
  ST[RZ] = -ST[DX] / rl;
  ST[UX] = ST[DY] * ST[RZ] - ST[DZ] * ST[RY];
  ST[UY] = ST[DZ] * ST[RX] - ST[DX] * ST[RZ];
  ST[UZ] = ST[DX] * ST[RY] - ST[DY] * ST[RX];
  ST[HA] = -1;
  ST[HB] = -1;
}

function setCarte(n) {
  carte = n;
  soleil.shadow.mapSize.set(n, n);
  if (soleil.shadow.map) {
    soleil.shadow.map.dispose(); // recréée par three au prochain rendu (changement de niveau seulement)
    soleil.shadow.map = null;
  }
}

/** Qualité adaptative : taille de la carte d'ombre (le filtrage est un uniforme de materiaux.js). */
export function setQualite(q) {
  if (q.carte !== carte) {
    setCarte(q.carte);
    ST[HA] = -1; // le pas du texel a changé : recalcul du rectangle
  }
}

/**
 * F10 : ajuste la caméra d'ombre à l'emprise visible et la recale au texel. view = camera.view (lecture seule).
 * À appeler avant le rendu ; met à jour les matrices du soleil et de sa cible.
 */
export function update(view) {
  const cam = soleil.shadow.camera;
  // Emprise visible au sol, relative à la cible : ±halfW le long de la droite de l'écran, ±halfD le long du haut ;
  // en haut de l'écran, ce qui monte jusqu'à hauteurMax et dont le pied est hors champ (h × groundPerHeight plus loin).
  // (six projections par image, sans allocation ; la projection n'est refaite que si le rectangle change)
  const hw = view.halfW;
  const hd = view.halfD;
  const H = PEINT.ombre.hauteurMax;
  const far = hd + H * view.groundPerHeight;
  // Les 6 points (4 coins au sol + 2 coins hauts en haut de l'écran), projetés sur la droite et le haut de la lumière.
  let aMin = 1e9, aMax = -1e9, bMin = 1e9, bMax = -1e9;
  for (let k = 0; k < 6; k++) {
    const sx = (k & 1) === 0 ? -hw : hw;
    const top = k >= 4;
    const sy = top ? far : (k & 2) === 0 ? -hd : hd;
    const y = top ? H : 0;
    const px = sx * view.rightX + sy * view.upX;
    const pz = sx * view.rightZ + sy * view.upZ;
    const a = px * ST[RX] + y * ST[RY] + pz * ST[RZ];
    const b = px * ST[UX] + y * ST[UY] + pz * ST[UZ];
    if (a < aMin) aMin = a;
    if (a > aMax) aMax = a;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  const m = PEINT.ombre.marge;
  const ha = (aMax - aMin) / 2 + m;
  const hb = (bMax - bMin) / 2 + m;
  ST[HA] = ha;
  ST[HB] = hb;
  ST[OA] = (aMax + aMin) / 2;
  ST[OB] = (bMax + bMin) / 2;
  // comparé à la caméra elle-même : si un autre module a réécrit ses bornes (world.update au redimensionnement,
  // tant que l'intégration n'est pas faite), elles sont reposées
  if (cam.right !== ha || cam.top !== hb) {
    cam.left = -ha;
    cam.right = ha;
    cam.top = hb;
    cam.bottom = -hb;
    cam.updateProjectionMatrix();
  }
  // Centre du rectangle dans le repère de la lumière, recalé au texel.
  const ta = (2 * ST[HA]) / carte;
  const tb = (2 * ST[HB]) / carte;
  const tx = view.targetX;
  const tz = view.targetZ;
  const a = Math.round((tx * ST[RX] + tz * ST[RZ] + ST[OA]) / ta) * ta;
  const b = Math.round((tx * ST[UX] + tz * ST[UZ] + ST[OB]) / tb) * tb;
  const c = tx * ST[DX] + tz * ST[DZ];
  const px = a * ST[RX] + b * ST[UX] + c * ST[DX];
  const py = a * ST[RY] + b * ST[UY] + c * ST[DY];
  const pz = a * ST[RZ] + b * ST[UZ] + c * ST[DZ];
  const D = PEINT.ombre.distance;
  soleil.target.position.set(px, py, pz);
  soleil.position.set(px + ST[DX] * D, py + ST[DY] * D, pz + ST[DZ] * D);
  soleil.updateMatrixWorld();
  soleil.target.updateMatrixWorld();
}

export function inspect(out) {
  out.carte = carte;
  out.ombreLargeur = 2 * ST[HA];
  out.ombreHauteur = 2 * ST[HB];
  out.texelCm = (200 * ST[HA]) / carte;
  out.soleil = [ST[DX], ST[DY], ST[DZ]];
}
