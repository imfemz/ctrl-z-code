//#region e5:M-dangers-guide
// § E5.M (B11, ARCHITECTURE.md) — le HUD du haut ne cache plus le boss. Mesuré le 20/11 (2560 × 1440 comme 1280 × 720,
// le HUD suit la hauteur) : le bloc du boss (nom + barre) descend à 0,19 × la hauteur d'écran, et un boss qui se tient
// 9 à 17 m au-dessus du héros passe dessous (jusqu'à 40 % de sa boîte écran), changement de phase et annonces compris.
// La caméra cadre le héros et ne change pas : tant que la boîte écran du boss (corps + DANGERS_GUIDE.hud.marge) touche
// un bloc du HUD du haut (bloc du boss, bloc du chrono), ce bloc passe à l'opacité DANGERS_GUIDE.hud.opacite.
// Une écriture de style par CHANGEMENT d'état ; rectangles relus toutes les `relire` images (lecture de mise en page),
// jamais à chaque image ; boîte écran calculée en flottants purs (aucune allocation, § V).
import { BOSS, DANGERS_GUIDE } from './config.js';
//#region e5:N-combat-guide
import { COMBAT_GUIDE } from './config.js'; // § E5.N (point 9) : le chrono reste lisible
//#endregion
import { E } from './state.js';
import { view, ecranT } from './camera.js'; // § E5.AB.12 : ecranT, projection en perspective

const D = DANGERS_GUIDE.hud;
const N = D.blocs.length;
const els = new Array(N).fill(null);
const rect = new Float64Array(N * 4); // x0, y0, x1, y1 (px CSS) ; vide : x0 > x1
const voile = new Uint8Array(N); // 1 = bloc rendu transparent
let cherche = false;
let compte = 0;
let voiles = 0; // changements d'état (tests)
//#region e5:N-combat-guide
// § E5.N (point 9, Femz 21/11 : le chrono à 0,22 « à peine lisible », refusé) : chaque bloc a son opacité voilée — les
// blocs du chrono (COMBAT_GUIDE.hud.blocsChrono) gardent opaciteChrono, le bloc du boss reste à DANGERS_GUIDE.hud.opacite.
// Chaînes préparées une fois (aucune allocation au changement d'état).
const opaciteTexte = D.blocs.map((b) => String(COMBAT_GUIDE.hud.blocsChrono.includes(b) ? COMBAT_GUIDE.hud.opaciteChrono : D.opacite));
//#endregion

function chercher() {
  cherche = true;
  for (let k = 0; k < N; k++) {
    const el = document.querySelector('#ui-root ' + D.blocs[k]) || document.querySelector(D.blocs[k]);
    els[k] = el;
    if (el) el.style.transition = 'opacity ' + D.fondu + 's linear';
  }
}

function relire() {
  for (let k = 0; k < N; k++) {
    const el = els[k];
    const o = k * 4;
    rect[o] = 1;
    rect[o + 2] = 0;
    if (el === null || !el.isConnected) continue;
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) continue;
    rect[o] = b.left;
    rect[o + 1] = b.top;
    rect[o + 2] = b.right;
    rect[o + 3] = b.bottom;
  }
}

function poser(k, v) {
  if (voile[k] === v) return;
  voile[k] = v;
  voiles++;
  const el = els[k];
  if (el !== null) el.style.opacity = v === 1 ? opaciteTexte[k] : ''; // § E5.N : opacité du bloc (était String(D.opacite))
}

const PJ = new Float64Array(6); // § E5.AB.12
/** Une fois par image, après ui.update (main.js, F12). */
export function update() {
  const i = E.bossIndex;
  if (i < 0 || E.alive[i] === 0) {
    for (let k = 0; k < N; k++) poser(k, 0);
    compte = 0;
    return;
  }
  if (!cherche) chercher();
  if (compte === 0) relire();
  compte = compte + 1 >= D.relire ? 0 : compte + 1;
  // Boîte écran du boss (même projection que camera.worldToScreen, zoom de la molette compris, sans la secousse) :
  // a = m d'écran vers la droite ; b = vers le haut : sin(inclinaison) × (profondeur au sol + hauteur × gph).
  const R = BOSS.radius + D.marge;
  //#region e5:AB-camera-3p
  if (view.persp === 1) {
    // § E5.AB.12 : perspective — boîte des projections du cercle au sol (avant, côtés) et du sommet
    PJ[0] = E.x[i] + view.rightX * R;
    PJ[1] = 0;
    PJ[2] = E.z[i] + view.rightZ * R;
    ecranT(PJ);
    const px1 = PJ[3];
    PJ[0] = E.x[i] - view.rightX * R;
    PJ[2] = E.z[i] - view.rightZ * R;
    ecranT(PJ);
    const px0 = PJ[3];
    PJ[0] = E.x[i] - view.upX * R;
    PJ[2] = E.z[i] - view.upZ * R;
    ecranT(PJ);
    const py1 = PJ[4];
    PJ[0] = E.x[i];
    PJ[1] = BOSS.height + D.marge;
    PJ[2] = E.z[i];
    ecranT(PJ);
    const py0 = PJ[4];
    for (let k = 0; k < N; k++) {
      const o = k * 4;
      const touche = rect[o] <= rect[o + 2] && px0 < rect[o + 2] && px1 > rect[o] && py0 < rect[o + 3] && py1 > rect[o + 1];
      poser(k, touche ? 1 : 0);
    }
    return;
  }
  //#endregion e5:AB-camera-3p
  const vx = E.x[i] - view.targetX;
  const vz = E.z[i] - view.targetZ;
  const a = vx * view.rightX + vz * view.rightZ;
  const g = vx * view.upX + vz * view.upZ;
  const s = view.halfH / view.halfD;
  const kx = (0.5 * view.widthPx * view.zoom) / view.halfW;
  const ky = (0.5 * view.heightPx * view.zoom) / view.halfH;
  const x0 = 0.5 * view.widthPx + (a - R) * kx;
  const x1 = 0.5 * view.widthPx + (a + R) * kx;
  const y0 = 0.5 * view.heightPx - s * (g + (BOSS.height + D.marge) * view.groundPerHeight) * ky; // haut : sommet du boss
  const y1 = 0.5 * view.heightPx - s * (g - R) * ky; // bas : bord avant de son cercle au sol
  for (let k = 0; k < N; k++) {
    const o = k * 4;
    const touche = rect[o] <= rect[o + 2] && x0 < rect[o + 2] && x1 > rect[o] && y0 < rect[o + 3] && y1 > rect[o + 1];
    poser(k, touche ? 1 : 0);
  }
}

/** Tests : état des blocs. */
export function inspect(out) {
  out.voile = Array.from(voile);
  out.voiles = voiles;
  out.blocs = D.blocs.slice();
  out.opacites = opaciteTexte.slice(); // § E5.N
  return out;
}
//#endregion
