// RENDU « PEINT » — point d'entrée du pipeline (brief docs/da-clash.md ; intégré le 13/11/2026, ARCHITECTURE.md
// § Z quater). Modules : materiaux (matériau peint), lumiere (soleil, ciel, carte d'ombre qui suit la vue), sol (sol
// peint, cailloux, touffes, rochers, falaises, carcasses, décor .glb), ombre-statique (ombre figée du décor),
// ombres-contact (une tache sous chaque unité), lumieres (taches de lumière au sol, vraies lumières), vegetation,
// bloom (multi-niveaux), diorama (flou en bande), post (passe finale), glb (modèles Blender). Réglages : PEINT
// (src/config.js, section « rendu:peint »).
// render.js construit la chaîne (bloom, diorama, passe finale) et pilote la qualité ; world.js construit le monde
// peint et appelle les mises à jour par image.
import { PEINT } from './reglages.js';
import * as materiaux from './materiaux.js';
import * as lumiere from './lumiere.js';
import * as sol from './sol.js';
import * as vegetation from './vegetation.js';

export { PEINT } from './reglages.js';
export { createPaintedMaterial, peindre, uniformsPeints } from './materiaux.js';
export * as lumiere from './lumiere.js';
export * as sol from './sol.js';
export * as ombresContact from './ombres-contact.js';
export { creerPasseFinale, SEUIL_BLOOM } from './post.js';
export { chargerGeometrie } from './glb.js';
export { cuire as cuireOmbreStatique } from './ombre-statique.js';

let parsemesEnregistres = [];
let lumiereEnPlace = false;

/** world.js : cailloux et touffes (masqués au dernier niveau), et le soleil est créé (sa carte suit le niveau). */
export function enregistrer({ parsemes = [], soleil = false } = {}) {
  parsemesEnregistres = parsemes;
  lumiereEnPlace = soleil;
}

/**
 * Niveau de qualité de render.js (0 = meilleur) → coûts du pipeline peint : carte d'ombre, filtrage, grain du sol,
 * cailloux, touffes et végétation. Appelé quand render change de niveau (jamais à chaque image).
 */
export function setQualite(niveau, parsemes = parsemesEnregistres) {
  const q = PEINT.qualite[Math.min(PEINT.qualite.length - 1, Math.max(0, niveau | 0))];
  materiaux.setQualite(q);
  if (lumiereEnPlace || lumiere.soleil !== null) lumiere.setQualite(q);
  sol.setQualite(q, parsemes);
  vegetation.setQualite(q);
  return q;
}
