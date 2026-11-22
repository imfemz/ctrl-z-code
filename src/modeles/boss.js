// MODÈLES — boss, d'après docs/references-modeles/survivor-boss-phase1-3vues.png et -phase2-3vues.png.
//
// Référence : colosse trapu ; épaulières très larges coiffées d'un cube ; torse à plaque de poitrine et cœur rouge ;
// tête-bloc à l'avant à visière rouge et fente rouge sur le dessus ; deux cheminées octogonales derrière la tête
// (évents rouges) ; bras courts terminés par des poings-blocs cerclés d'une bande rouge ; jambes courtes, gros pieds.
// Phase 2 : flammes orange sur les cheminées, bandes de danger orange sur les épaulières, fissures incandescentes du
// torse, plaques orange sur les poings.
//
// Sortie : deux BufferGeometry, EXACTEMENT ce que boss.buildBody(type) et boss.buildOverlay(type) rendaient (cotes
// de référence 5 m de haut puis échelle BOSS.radius / 2,2 en X et Z, BOSS.height / 5 en Y ; pieds à y = 0 ; avant =
// +Z). Les pièces de phase 2 sont dans le MÊME repère que le corps (overlay enfant du corps, matrice identité) ; elles
// débordent de 1 à 3 cm des faces qu'elles recouvrent (pas de scintillement).
//
// PHASE B — dans src/boss.js :
//   import { construireBossCorps, construireBossPhase2 } from './modeles/boss.js';
//   new THREE.Mesh(construireBossCorps(type, render), bodyMaterial)      (au lieu de buildBody(type))
//   new THREE.Mesh(construireBossPhase2(type, render), hotMaterial)      (au lieu de buildOverlay(type))
//   puis supprimer buildBody et buildOverlay. La pose (sync), la fenêtre sur le joueur (addReveal), l'ombre ne
//   changent pas.
import { BOSS, PALETTE } from '../config.js';
import { atelier, echelle } from './atelier.js';

const STACK_X = 0.8;
const STACK_Z = -0.78;
const STACK_TOP = 4.86;

function aEchelle(g) {
  return echelle(g, BOSS.radius / 2.2, BOSS.height / 5, BOSS.radius / 2.2);
}

export function construireBossCorps(type, render) {
  const G = type.bodyColor;
  const D = type.accentColor;
  const L = PALETTE.robotLight;
  const R = type.eyeColor;
  const A = atelier(render);
  for (let s = -1; s <= 1; s += 2) {
    // jambes
    A.bloc(1.25, 1.7, 0.45, D, s * 0.95, 0, 0.12, { wt: 1.15, dt: 1.58, piece: { nom: 'pied', genre: 'jambe', cote: s, pivot: [s * 0.95, 1.5, 0] } });
    A.bloc(0.85, 0.95, 0.75, G, s * 0.95, 0.45, 0.0, { c: 0.08, piece: { nom: 'tibia', genre: 'jambe', cote: s, pivot: [s * 0.95, 1.5, 0] } });
    A.box(0.92, 0.3, 0.14, L, s * 0.95, 1.02, 0.5, { piece: { nom: 'genouillere', genre: 'jambe', cote: s, pivot: [s * 0.95, 1.5, 0] } });
    A.box(0.8, 0.6, 0.9, D, s * 0.95, 1.48, 0.0); // cuisse
    // épaulière, cube du dessus
    A.bloc(1.15, 1.75, 1.0, G, s * 2.0, 2.85, 0.0, { c: 0.12, ct: 0.15, wt: 1.07, dt: 1.65 });
    A.box(0.45, 0.42, 0.45, D, s * 2.12, 4.06, 0.12);
    // bras, poing, bande rouge du poing (elle ceinture le poing : visible de partout)
    A.box(0.68, 1.1, 0.78, D, s * 2.05, 2.3, 0.0);
    A.bloc(1.0, 1.15, 1.0, G, s * 2.05, 0.25, 0.08, { c: 0.1 });
    A.box(1.04, 0.24, 1.19, R, s * 2.05, 0.46, 0.08, { em: 1, piece: { nom: 'bande-poing', genre: 'feu', cote: s } });
    // cheminée octogonale, bouche sombre, évents rouges sur le flanc extérieur
    A.cyl(0.42, 0.55, 1.26, 8, G, s * STACK_X, STACK_TOP - 0.63, STACK_Z);
    A.disc(0.31, 8, 0x1c1d21, s * STACK_X, STACK_TOP + 0.005, STACK_Z);
    A.box(0.05, 0.32, 0.3, R, s * (STACK_X + 0.5), 4.2, STACK_Z, { em: 1, rz: s * 0.1 });
  }
  A.box(2.4, 0.5, 1.4, D, 0, 1.85, 0.0); // bassin
  A.bloc(3.1, 2.0, 1.6, G, 0, 2.0, 0.0, { c: 0.25, ct: 0.3, wt: 3.0, dt: 1.9 }); // torse
  A.box(1.7, 1.0, 0.2, D, 0, 2.85, 1.04); // plaque de poitrine
  A.box(0.74, 0.4, 0.08, R, 0, 2.85, 1.16, { em: 1 }); // cœur
  A.box(2.2, 1.2, 0.6, D, 0, 2.9, -1.2); // réacteur dorsal
  A.bloc(1.1, 1.0, 0.75, G, 0, 3.6, 0.35, { c: 0.1, ct: 0.12, wt: 1.04, dt: 0.94 }); // tête
  A.box(0.92, 0.24, 0.08, R, 0, 3.86, 0.87, { em: 1 }); // visière
  A.box(0.2, 0.06, 0.6, R, 0, 4.375, 0.33, { em: 1 }); // fente rouge du dessus (vue de la caméra)
  return aEchelle(A.fin());
}

export function construireBossPhase2(type, render) {
  const H = BOSS.phase2.heatColor; // orange chaud
  const R = type.eyeColor;
  const A = atelier(render);
  for (let s = -1; s <= 1; s += 2) {
    A.disc(0.31, 8, H, s * STACK_X, STACK_TOP + 0.015, STACK_Z, { em: 1 }); // bouche en feu
    A.cone(0.3, 0.95, 6, H, s * STACK_X, STACK_TOP + 0.49, STACK_Z, { em: 1 }); // flamme
    for (const z of [0.42, 0.68]) A.box(0.86, 0.04, 0.15, H, s * 1.95, 3.86, z, { em: 1 }); // bandes de danger des épaulières
    // fissures incandescentes du torse, en zigzag de part et d'autre de la plaque de poitrine
    A.box(0.5, 0.07, 0.06, R, s * 1.18, 3.2, 0.99, { em: 1, rz: s * 0.9 });
    A.box(0.42, 0.07, 0.06, H, s * 1.32, 2.86, 1.0, { em: 1, rz: -s * 0.6 });
    A.box(0.38, 0.07, 0.06, H, s * 1.2, 2.5, 1.0, { em: 1, rz: s * 1.1 });
    // plaques orange des poings (au-dessus de la bande rouge), face avant et face extérieure
    A.box(0.72, 0.36, 0.05, H, s * 2.05, 0.95, 0.605, { em: 1 });
    A.box(0.05, 0.36, 0.72, H, s * 2.575, 0.95, 0.08, { em: 1 });
  }
  A.box(1.3, 0.07, 0.34, H, 0, 3.51, -1.2); // évent du réacteur
  return aEchelle(A.fin());
}
