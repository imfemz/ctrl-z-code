// ŒIL EN V DU CASQUE (pièce « oeil » du heros.glb v11, enfant de la tête, 15/11/2026) : lueur fixe, et par moments
// une rafale de glitch (Femz : « le V doit être émissif et glitché en animation ») — décalage latéral, écrasement,
// extinctions d'une image, par pas de 1/30 s. Déterministe (temps donné) : rejouable par les tests.
// Partagé par le jeu (heros-anim.js) et l'écran titre (menu/heros-menu.js).

// une rafale par créneau de `creneau` s, à un instant tiré au hasard dans le créneau, de durée tirée dans `duree`
export const GLITCH = { creneau: 2.3, duree: [0.12, 0.3], pas: 1 / 30, decalage: 0.014, eteint: 0.28 };

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Pose l'os de l'œil au temps t (s). base : position de repos de l'os (Vector3, relue à la création). */
export function glitchOeil(b, base, t) {
  const k = Math.floor(t / GLITCH.creneau);
  const duree = GLITCH.duree[0] + hash(k + 0.5) * (GLITCH.duree[1] - GLITCH.duree[0]);
  const dans = t - (k * GLITCH.creneau + hash(k) * (GLITCH.creneau - duree));
  b.position.copy(base);
  if (dans < 0 || dans > duree) {
    b.scale.set(1, 1, 1);
    return;
  }
  const p = Math.floor(t / GLITCH.pas);
  const r1 = hash(p * 1.37);
  const r2 = hash(p * 2.11 + 5);
  if (r1 < GLITCH.eteint) {
    b.scale.set(0, 0, 0); // une image éteinte
    return;
  }
  b.position.x += (r2 * 2 - 1) * GLITCH.decalage;
  b.scale.set(1 + (r1 - 0.5) * 0.35, 0.55 + r2 * 0.55, 1);
}
