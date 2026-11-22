// ÉTAPE 5, CHANTIER F (ARCHITECTURE.md § E5.F) — le bond sismique du Bastion (son dash) joue « Jump Attack » (Mixamo),
// demande de Femz du 17/11 : « le jump de Bastion doit plus ressembler à ça : son "dash", Jump Attack. Faut bien que tu
// gères l'anim pour qu'elle commence et s'arrête au bon moment, car l'anim est longue ».
//
// Pistes cuites sur le robot du Bastion (assets/anims/bond-bastion.json, format « ctrlz-anim-robot/1 », même cuisson que
// le coup de pied du § E4.O). Fenêtre jouée : de l'impulsion (BOND_CUIT.clip.debut) à l'image où les poings touchent le
// sol (clip.impact), ÉTIRÉE sur la durée exacte du dash (vitesse = (impact − debut) / durée) : le décollage tombe sur le
// début du dash, la frappe au sol sur sa fin — l'image où dash-agents lance l'onde. Après la fin du dash, la reprise
// (clip.impact → clip.sortie) est jouée à la même vitesse pendant le fondu vers la course.
// heros-anim lit l'échantillonneur (POSE, RS) et l'état (ETAT) : aucune allocation par image.
import { BOND_CUIT } from '../config.js';
import { NOMS, NB } from './coup-pied.js';

let cuit = null; // { n, fps, Q: Float32Array, R: Float32Array }
/** Pose échantillonnée : quaternion de chaque os (ordre NOMS), position de la racine (hanche cuite). */
export const POSE = new Float64Array(4 * NB);
export const RS = new Float64Array(3);
/** Mesures au chargement : [0] hauteur de hanche du clip debout (première image, m), [1] 1 = chargé. */
export const MES = new Float64Array(2);
const SG = new Float64Array([-1, 1]);

/** Document « ctrlz-anim-robot/1 » du Bastion (main.js, au démarrage). Hors combat. */
export function setCuit(doc) {
  if (!doc || doc.format !== 'ctrlz-anim-robot/1' || doc.os.join(',') !== NOMS.join(',')) throw new Error('bond : pistes inconnues');
  cuit = { n: doc.n, fps: doc.fps, Q: Float32Array.from(doc.q), R: Float32Array.from(doc.racine) };
  U[0] = 0;
  echantillonner(); // hanche du clip debout (première image) : référence de la hauteur
  MES[0] = RS[1];
  MES[1] = 1;
}
export function charge() {
  return cuit !== null && MES[1] === 1 ? 1 : 0;
}
export function duree() {
  return cuit === null ? 0 : (cuit.n - 1) / cuit.fps;
}

/** Temps à échantillonner (s de l'animation), écrit par l'appelant avant echantillonner() (§ V : aucun flottant en
 *  argument). */
export const U = new Float64Array(1);
/** Échantillonne au temps U[0] (borné, sans boucle) dans POSE / RS. Sans allocation. */
export function echantillonner() {
  const c = cuit;
  if (c === null) return;
  const u = U[0];
  const n = c.n;
  let f = u * c.fps;
  if (f < 0) f = 0;
  if (f > n - 1) f = n - 1;
  const i0 = Math.floor(f);
  const i1 = i0 + 1 < n ? i0 + 1 : i0;
  f -= i0;
  const Q = c.Q;
  for (let k = 0; k < NB; k++) {
    const p = (i0 * NB + k) * 4;
    const q = (i1 * NB + k) * 4;
    const sg = Q[p] * Q[q] + Q[p + 1] * Q[q + 1] + Q[p + 2] * Q[q + 2] + Q[p + 3] * Q[q + 3] < 0 ? SG[0] : SG[1];
    const x = Q[p] + (sg * Q[q] - Q[p]) * f;
    const y = Q[p + 1] + (sg * Q[q + 1] - Q[p + 1]) * f;
    const z = Q[p + 2] + (sg * Q[q + 2] - Q[p + 2]) * f;
    const w = Q[p + 3] + (sg * Q[q + 3] - Q[p + 3]) * f;
    const s = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
    const o = k * 4;
    POSE[o] = x * s;
    POSE[o + 1] = y * s;
    POSE[o + 2] = z * s;
    POSE[o + 3] = w * s;
  }
  const R = c.R;
  RS[0] = R[i0 * 3] + (R[i1 * 3] - R[i0 * 3]) * f;
  RS[1] = R[i0 * 3 + 1] + (R[i1 * 3 + 1] - R[i0 * 3 + 1]) * f;
  RS[2] = R[i0 * 3 + 2] + (R[i1 * 3 + 2] - R[i0 * 3 + 2]) * f;
}
