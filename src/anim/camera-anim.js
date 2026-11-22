// ANIMATIONS v2 — caméra (plan § P5) et secousse (décisions de Femz du 13/11 après l'étude de Vampire Survivors).
// INTÉGRÉ DANS src/camera.js (étape « animations », ARCHITECTURE.md § Z sexies) : avance, secousse à SHAKE.frequency
// avec attaque, limite d'accumulation (vérifiée AVANT d'accorder, comme le prévoyait ce prototype) et coup directionnel
// vivent maintenant dans camera.js, réglés par CAMERA.lead et SHAKE. Ce fichier n'est plus importé par le jeu ; la page
// tests/anim le reconnaît (jeu intégré) et ne le branche plus. Gardé comme trace du prototype validé.
// PROTOTYPE SEULEMENT, avec son propre interrupteur : c'est un choix de pilotage que Femz doit valider en jouant.
//
// 1. AVANCE (look-ahead) : la caméra vise P + lead ; lead rejoint (P.vx, P.vz) × seconds, borné à max, lissé à
//    rate (temps réel) : 1,6 m d'avance à la course au lieu de 0,55 m de retard ; le dash (24 m/s) est borné et lissé.
// 2. SECOUSSE moins trépidante : bruit lissé à 14 Hz (4,3 échantillons par période à 60 Hz) au lieu de 24.
// 3. LIMITE D'ACCUMULATION (acceptée par Femz) : une demande est IGNORÉE tant que le trauma vivant de son groupe
//    dépasse `relance` × son plafond (SHAKE.groupCap) ; les plafonds par seconde glissante restent. Un événement isolé
//    (coup reçu, explosion, boss) garde son intensité ; la secousse des kills est gardée (refus de la couper).
// 4. COUP DIRECTIONNEL : addTraumaAt connaît la source ; un ressort critique (ω = 30 rad/s) pousse la caméra de la
//    source vers la cible, amplitude perTrauma × accordé × intensité, borné à max. À 0 % d'intensité : rien.
//
// INTÉGRATION (src/camera.js, quand Femz aura validé) :
//   - update(realDt) : remplacer la cible P par P + lead (indices LEAD_X, LEAD_Z dans S), view.targetX/Z = cible
//     lissée sans secousse (contrat inchangé) ; SHAKE.frequency = ANIM.camera.shakeFrequency ; ajouter le ressort du
//     coup dans place() (S[KICK_X..]).
//   - addTrauma(amount, source) : avant d'accorder, `if (vivant[g] > relance × groupCap[g]) return 0` ; vivant[g]
//     décroît comme le trauma (decayPerSec) — tableau Float64Array(GROUPS).
//   - addTraumaAt(amount, source, x, z) : en plus, kick += direction(source → cible) × perTrauma × accordé.
//   - clés : CAMERA.lead = { seconds, max, rate }, SHAKE.frequency, SHAKE.kick = { perTrauma, omega, max },
//     SHAKE.relance. Tests à relancer : fondation.test.mjs, juice.test.mjs (plafonds, intensité 0 %),
//     controle-4-resize.mjs, controle-4b-dpr.mjs, waves-shop.test.mjs (apparitions hors écran depuis camera.view).
// Le prototype remplace la position et le roulis calculés par camera.js (ses décalages sont ignorés), garde le punch.
import * as THREE from 'three';
import { CAMERA, SHAKE, TRAUMA_COUNT } from '../config.js';
import { P } from '../state.js';
import * as camera from '../camera.js';
import { ANIM } from './reglages.js';

const C = ANIM.camera;
const DEG = Math.PI / 180;
const GROUPS = SHAKE.groupCap.length;
const NOISE_N = 256;
const noise = new Float32Array(NOISE_N * 3);
const vivant = new Float64Array(GROUPS);
// état : avance, trauma, temps du bruit, décalages, ressort du coup ; statistiques
const LEAD_X = 0;
const LEAD_Z = 1;
const TRAUMA = 2;
const NOISE_T = 3;
const OX = 4;
const OY = 5;
const ROLL = 6;
const KX = 7;
const KY = 8;
const KVX = 9;
const KVY = 10;
const AMP = 11; // trauma appliqué : suit TRAUMA avec une attaque (ANIM.camera.attaque), retombe avec lui
const LPX = 12; // position du héros à l'image précédente (vitesse RÉELLE : contre un rocher, P.vx reste à 6,5 m/s)
const LPZ = 13;
const S = new Float64Array(14);
const stats = { demandes: 0, ignorees: 0, accorde: 0 };
const base = { q: new THREE.Quaternion(), roll: new THREE.Quaternion(), pret: false };
let rX = 1, rZ = 0, uX = 0, uY = 1, uZ = 0, dX = 0, dY = 1, dZ = 0;
const proto = { actif: false };

function initBase() {
  const pitch = CAMERA.pitchDeg * DEG;
  const yaw = CAMERA.yawDeg * DEG;
  dX = Math.sin(yaw) * Math.cos(pitch);
  dY = Math.sin(pitch);
  dZ = Math.cos(yaw) * Math.cos(pitch);
  rX = Math.cos(yaw);
  rZ = -Math.sin(yaw);
  uX = dY * rZ;
  uY = dZ * rX - dX * rZ;
  uZ = -dY * rX;
  const cam = new THREE.OrthographicCamera();
  cam.position.set(dX, dY, dZ);
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
  base.q.copy(cam.quaternion);
  let s = 0x7a11e5;
  for (let k = 0; k < noise.length; k++) {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    noise[k] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  base.pret = true;
}

export function reset() {
  S.fill(0);
  S[LPX] = P.x;
  S[LPZ] = P.z;
  vivant.fill(0);
}

/** Avant camera.update : retire l'avance de la cible (le suivi lissé de camera.js travaille sur P seul). */
export function avant() {
  const v = camera.view;
  v.targetX -= S[LEAD_X];
  v.targetZ -= S[LEAD_Z];
}

/** Après camera.update : nouvelle avance, secousse et coup, position de la caméra réécrite. */
export function apres(realDt) {
  if (!base.pret) initBase();
  const v = camera.view;
  // 1. avance, sur la vitesse réelle (déplacement de l'image) : bloqué contre un rocher, il n'y a plus d'avance
  const vx = realDt > 0 ? (P.x - S[LPX]) / realDt : 0;
  const vz = realDt > 0 ? (P.z - S[LPZ]) / realDt : 0;
  const tele = vx * vx + vz * vz > 900; // téléportation (Rejouer, debug) : pas une vitesse
  S[LPX] = P.x;
  S[LPZ] = P.z;
  let lx = tele ? 0 : vx * C.lead.seconds;
  let lz = tele ? 0 : vz * C.lead.seconds;
  const l = Math.sqrt(lx * lx + lz * lz);
  if (l > C.lead.max) {
    lx *= C.lead.max / l;
    lz *= C.lead.max / l;
  }
  const a = 1 - Math.exp(-C.lead.rate * realDt);
  S[LEAD_X] += (lx - S[LEAD_X]) * a;
  S[LEAD_Z] += (lz - S[LEAD_Z]) * a;
  v.targetX += S[LEAD_X];
  v.targetZ += S[LEAD_Z];
  // 2. secousse
  let tr = S[TRAUMA] - SHAKE.decayPerSec * realDt;
  S[TRAUMA] = tr < 0 ? 0 : tr;
  for (let g = 0; g < GROUPS; g++) {
    const x = vivant[g] - SHAKE.decayPerSec * realDt;
    vivant[g] = x < 0 ? 0 : x;
  }
  const inten = camera.getShakeIntensity();
  S[NOISE_T] += realDt * C.shakeFrequency;
  // attaque : une explosion ne fait plus sauter la caméra de toute son amplitude en une image (mesuré : 0,66 m)
  let ap = S[AMP];
  if (S[TRAUMA] > ap) ap += (S[TRAUMA] - ap) * (1 - Math.exp(-realDt / C.attaque));
  else ap = S[TRAUMA];
  S[AMP] = ap;
  const amp = ap * ap * inten;
  if (amp > 0) {
    const t = S[NOISE_T];
    const i = Math.floor(t);
    let f = t - i;
    f = f * f * (3 - 2 * f);
    const i0 = i & (NOISE_N - 1);
    const i1 = (i + 1) & (NOISE_N - 1);
    for (let ch = 0; ch < 3; ch++) {
      const a0 = noise[ch * NOISE_N + i0];
      const a1 = noise[ch * NOISE_N + i1];
      S[OX + ch] = (ch === 2 ? SHAKE.maxRollDeg : SHAKE.maxOffset) * amp * (a0 + (a1 - a0) * f);
    }
  } else S[OX] = S[OY] = S[ROLL] = 0;
  // 3. coup : ressort critique (exact pour un pas quelconque : intégration semi-implicite en sous-pas de 4 ms)
  const w = C.kick.omega;
  let rest = realDt;
  while (rest > 1e-6) {
    const h = rest > 0.004 ? 0.004 : rest;
    S[KVX] += (-w * w * S[KX] - 2 * w * S[KVX]) * h;
    S[KVY] += (-w * w * S[KY] - 2 * w * S[KVY]) * h;
    S[KX] += S[KVX] * h;
    S[KY] += S[KVY] * h;
    rest -= h;
  }
  const kl = Math.sqrt(S[KX] * S[KX] + S[KY] * S[KY]);
  if (kl > C.kick.max) {
    S[KX] *= C.kick.max / kl;
    S[KY] *= C.kick.max / kl;
  }
  place();
}

function place() {
  const cam = camera.threeCamera;
  const v = camera.view;
  const D = CAMERA.distance;
  const ox = S[OX] + S[KX];
  const oy = S[OY] + S[KY];
  cam.position.set(v.targetX + dX * D + rX * ox + uX * oy, dY * D + uY * oy, v.targetZ + dZ * D + rZ * ox + uZ * oy);
  if (S[ROLL] !== 0) {
    const h = S[ROLL] * DEG * 0.5;
    base.roll.set(0, 0, Math.sin(h), Math.cos(h));
    cam.quaternion.multiplyQuaternions(base.q, base.roll);
  } else cam.quaternion.copy(base.q);
}

/** Après chaque addTrauma / addTraumaAt de camera.js (accordé = ce que les plafonds de camera.js ont laissé passer). */
export function trauma(amount, source, x, z, accorde) {
  if (!(accorde > 0) || !(source >= 0 && source < TRAUMA_COUNT)) return;
  stats.demandes++;
  const g = SHAKE.groupOf[source];
  if (vivant[g] > C.relance * SHAKE.groupCap[g]) {
    stats.ignorees++;
    return;
  }
  vivant[g] += accorde;
  stats.accorde += accorde;
  const t = S[TRAUMA] + accorde;
  S[TRAUMA] = t > 1 ? 1 : t;
  if (x === x && z === z) {
    // de la source vers la cible, dans le plan de l'écran
    const v = camera.view;
    const dx = v.targetX - x;
    const dz = v.targetZ - z;
    const sx = dx * rX + dz * rZ;
    const sy = -(dx * uX + dz * uZ);
    const l = Math.sqrt(sx * sx + sy * sy);
    if (l > 1e-3) {
      const k = C.kick.perTrauma * accorde * camera.getShakeIntensity();
      S[KVX] += (sx / l) * k * w0();
      S[KVY] += (sy / l) * k * w0();
    }
  }
}
// impulsion de vitesse qui donne un pic ≈ k sur un ressort critique (pic = v0 / (ω e))
const w0 = () => C.kick.omega * Math.E;

export function inspect(out) {
  out.trauma = S[TRAUMA];
  out.avance = [S[LEAD_X], S[LEAD_Z]];
  out.decalage = [S[OX] + S[KX], S[OY] + S[KY]];
  out.coup = [S[KX], S[KY]];
  out.demandes = stats.demandes;
  out.ignorees = stats.ignorees;
  out.accorde = stats.accorde;
}

// ----- prototype ----------------------------------------------------------------------------------------------------
export function brancher({ crochets }) {
  crochets.cameraAvant = () => {
    if (proto.actif) avant();
  };
  crochets.cameraUpdate = (dt) => {
    if (proto.actif) apres(dt);
  };
  crochets.cameraTrauma = (amount, source, x, z, g) => {
    if (proto.actif) trauma(amount, source, x, z, g);
  };
}
/** Interrupteur SÉPARÉ des autres animations (window.__anim.setCamera). */
export function setActif(on) {
  if (proto.actif && !on) {
    camera.view.targetX -= S[LEAD_X];
    camera.view.targetZ -= S[LEAD_Z];
  }
  proto.actif = !!on;
  reset();
}
export const protoInspect = inspect;
