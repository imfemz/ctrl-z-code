// MODÈLES — drone-marchand, d'après docs/references-modeles/survivor-marchand-3vues.png.
//
// Référence : coque octogonale dorée (ventre, ceinture large, pont), dôme blanc cassé à facettes, mât portant un
// fragment cyan géant, caisse blanc cassé à l'arrière (feu cyan), bandeau cyan à l'avant, quatre tuyères carénées
// en diagonale au cœur cyan, train à quatre jambes et deux patins dorés. L'ancien modèle en était déjà très proche :
// le dôme devient le volume dominant, la caisse passe sur le côté arrière, le train devient doré.
//
// Sortie : BufferGeometry fusionnée, EXACTEMENT celle que shop.buildMerchant construisait (makePart / mergeParts,
// patins à y = 0, avant = +Z, mise à l'échelle SHOP.merchant.scale). Aucune pièce animée séparément : le maillage
// entier est posé, tourné, penché et écrasé par shop.sync.
//
// PHASE B — dans src/shop.js, buildMerchant :
//   import { construireMarchand } from './modeles/marchand.js';
//   remplacer tout le bloc « const D = …; … geometry.scale(D.scale, D.scale, D.scale); » par
//   const geometry = construireMarchand(render);
//   (la création du Mesh, son nom, rotation.order et visible = false restent.)
import * as THREE from 'three';
import { PALETTE, SHOP } from '../config.js';
import { atelier, echelle } from './atelier.js';

export function construireMarchand(render) {
  const D = SHOP.merchant;
  const GOLD = PALETTE.merchant;
  const BRONZE = new THREE.Color(GOLD).multiplyScalar(D.darkShade).getHex(); // pièces mécaniques
  const WHITE = PALETTE.player; // dôme et caisse : le blanc cassé du joueur (c'est un allié)
  const CYAN = PALETTE.fragment;
  const A = atelier(render);
  // train : deux patins et quatre jambes dorés
  for (let sx = -1; sx <= 1; sx += 2) {
    A.box(0.13, 0.1, 1.7, GOLD, sx * 0.6, 0.05, 0);
    for (let sz = -1; sz <= 1; sz += 2) A.box(0.1, 0.38, 0.1, GOLD, sx * 0.6, 0.28, sz * 0.46);
  }
  // coque
  A.cyl(0.8, 0.5, 0.26, 8, BRONZE, 0, 0.5, 0);
  A.cyl(1.0, 0.8, 0.44, 8, GOLD, 0, 0.85, 0);
  A.cyl(0.74, 1.0, 0.18, 8, GOLD, 0, 1.16, 0);
  A.box(0.64, 0.16, 0.08, CYAN, 0, 0.86, 0.905, { em: 1 }); // bandeau avant
  // dôme à facettes, mât, fragment
  A.cyl(0.32, 0.64, 0.44, 8, WHITE, 0, 1.47, -0.02);
  A.box(0.07, 0.36, 0.07, BRONZE, 0, 1.86, -0.02);
  A.octa(0.24, CYAN, 0, 2.2, -0.02, { ex: 0.8, ey: 1.2, ez: 0.8, em: 1 });
  // caisse à l'arrière, côté gauche, feu cyan sur sa face extérieure
  A.box(0.46, 0.38, 0.44, WHITE, 0.42, 1.44, -0.5);
  A.box(0.03, 0.11, 0.24, CYAN, 0.66, 1.46, -0.5, { em: 1 });
  // quatre tuyères carénées en diagonale
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    A.box(0.16, 0.12, 0.6, BRONZE, dx * 1.05, 0.8, dz * 1.05, { ry: a });
    A.cyl(0.38, 0.38, 0.2, 8, GOLD, dx * 1.45, 0.88, dz * 1.45, { open: true });
    A.ring(0.25, 0.38, 8, GOLD, dx * 1.45, 0.98, dz * 1.45);
    A.disc(0.26, 8, CYAN, dx * 1.45, 0.93, dz * 1.45, { em: 1 });
    A.cyl(0.2, 0.1, 0.18, 6, BRONZE, dx * 1.45, 0.69, dz * 1.45);
  }
  const g = A.fin();
  return echelle(g, D.scale, D.scale, D.scale);
}
