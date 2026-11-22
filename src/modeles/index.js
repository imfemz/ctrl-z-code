// OBSOLÈTE (étape « modèles », 13/11/2026, ARCHITECTURE.md § Z quinquies) : le jeu dessine les modèles Blender
// (assets/modeles/*.glb, src/rendu/modeles.js). Ce dossier n'est plus importé par aucun module du jeu ; il ne sert qu'à
// la page de comparaison tests/modeles/comparaison.js. Gardé, pas supprimé (le projet n'est pas suivi par git).
// MODÈLES — point d'entrée unique des constructeurs refaits d'après docs/references-modeles/ (refonte du 13/11/2026).
// Chaque fichier documente en tête la ligne à changer dans son module (phase B). Constructeurs appelés à l'init
// seulement ; aucun ne crée de matériau, de maillage ni de scène : ils rendent des géométries.
export { construireHeros, capeHeros, echelleHeros, HEROS_MEMBRES, HEROS_JOINTS } from './heros.js';
export {
  construireRobot,
  construireRodeur,
  construireDrone,
  construireTireur,
  construireKamikaze,
  construireBlinde,
  construireReparateur,
} from './robots.js';
export { construireBossCorps, construireBossPhase2 } from './boss.js';
export { construireMarchand } from './marchand.js';
export { triangles } from './atelier.js';
