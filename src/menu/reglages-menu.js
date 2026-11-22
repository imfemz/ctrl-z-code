// MENU PRINCIPAL — « hero shot » de l'écran titre (demande de Femz du 13/11/2026). Réglages intégrés le 14/11/2026
// (étape « menu », ARCHITECTURE.md § Z octies) : MENU et POSES vivent dans src/config.js (région « menu:reglages » :
// même structure, mêmes noms qu'au prototype, repères et unités décrits là-bas). Ce fichier les réexporte pour les
// modules de src/menu/ et calcule le repère du plan (ORIENTATION, versMonde).
import { MENU } from '../config.js';
export { MENU, POSES } from '../config.js';

const A0 = (MENU.orientationDeg * Math.PI) / 180;
const C0 = Math.cos(A0);
const S0 = Math.sin(A0);
/** Angle du repère du plan (rad). */
export const ORIENTATION = A0;
/** Point (x, z) du repère du plan → monde : écrit [x, z] dans out (tableau) et le renvoie. */
export function versMonde(x, z, out) {
  out[0] = x * C0 + z * S0;
  out[1] = -x * S0 + z * C0;
  return out;
}
