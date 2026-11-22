// MODÈLES — les six robots, d'après docs/references-modeles/survivor-<type>-3vues.png.
//
// Sortie : une BufferGeometry fusionnée par type, EXACTEMENT ce que enemies.buildMesh(t) rendait (makePart /
// mergeParts, pieds à y = 0 — le drone aussi : enemies.sync le pose à T.hover —, avant = +Z local, hauteur ramenée à
// T.height par une échelle en Y comme avant). Couleurs lues dans ENEMIES.types[t] (bodyColor, accentColor,
// accent2Color, eyeColor) : la palette validée ne change pas. Le rebond, le balancement, le penché, le recul du tireur,
// l'enflure du kamikaze et du réparateur passent par la matrice d'instance : rien à changer dans sync.
//
// PHASE B — dans src/enemies.js :
//   import { construireRobot } from './modeles/robots.js';
//   dans init : render.createInstanced(construireRobot(t, render), material, CAP, { … })   (au lieu de buildMesh(t))
//   puis supprimer buildMesh, buildRodeur, buildDrone, buildTireur, buildKamikaze, buildBlinde, buildReparateur,
//   addBox, addCylinder (buildDroneShadow et buildShot restent).
//
// Pièces repérées (geometry.userData.pieces : nom, genre, cote, pivot, premier sommet, nombre de sommets) pour la
// déformation par le shader prévue au § P6 du plan d'animation : patins / jambes (genre « jambe », cote ±1), rotors
// du drone (genre « rotor », pivot = centre du rotor), boule du kamikaze (genre « boule »). createInstanced recopie
// les attributs dans une géométrie neuve : lire userData.pieces sur la géométrie RENVOYÉE, avant.
import { ENEMIES, ENEMY } from '../config.js';
import { atelier, echelle, hauteur } from './atelier.js';

function aHauteur(g, h) {
  return echelle(g, 1, h / hauteur(g), 1);
}

/** Rôdeur : tête-bloc à visière rouge et plaque rouge sur le dessus, antenne ; corps large, épaulières, gros pieds. */
export function construireRodeur(render, T = ENEMIES.types[ENEMY.RODEUR]) {
  const G = T.bodyColor;
  const D = T.accentColor;
  const R = T.eyeColor;
  const A = atelier(render);
  for (let s = -1; s <= 1; s += 2) {
    const p = { genre: 'jambe', cote: s, pivot: [s * 0.24, 0.3, 0] };
    A.bloc(0.28, 0.6, 0.24, D, s * 0.24, 0, 0.05, { wt: 0.26, dt: 0.52, sz: -0.02, piece: { nom: 'pied', ...p } }); // pied
    A.box(0.1, 0.16, 0.16, D, s * 0.36, 0.3, -0.02, { piece: { nom: 'hanche', ...p } }); // rotule de hanche
    A.box(0.2, 0.3, 0.48, G, s * 0.45, 0.62, -0.02); // épaulière
    A.box(0.03, 0.1, 0.24, R, s * 0.565, 0.62, 0.0, { em: 1 }); // feu latéral de l'épaulière
  }
  A.bloc(0.72, 0.72, 0.48, G, 0, 0.22, 0, { wt: 0.68, dt: 0.68, c: 0.07, ct: 0.09 }); // corps
  A.bloc(0.56, 0.58, 0.42, G, 0, 0.72, -0.02, { c: 0.05, ct: 0.07, wt: 0.54, dt: 0.56 }); // tête
  A.box(0.5, 0.15, 0.05, R, 0, 0.92, 0.285, { em: 1 }); // visière frontale
  A.box(0.3, 0.06, 0.2, R, 0, 1.16, 0.1, { em: 1 }); // plaque rouge du dessus (ce que voit la caméra)
  A.box(0.07, 0.24, 0.07, D, -0.06, 1.26, -0.13); // antenne
  return aHauteur(A.fin(), T.height);
}

/** Drone : fuselage chanfreiné, plaque rouge dessus et bandeau rouge devant, dérive arrière, quatre rotors carénés à moyeu rouge. */
export function construireDrone(render, T = ENEMIES.types[ENEMY.DRONE]) {
  const G = T.bodyColor;
  const L = T.accentColor;
  const R = T.eyeColor;
  const DK = 0x2a2c31; // intérieur des carénages (plus sombre que robotDark : le trou se lit)
  const A = atelier(render);
  A.bloc(0.42, 0.62, 0.22, G, 0, 0.08, 0, { c: 0.05, wt: 0.4, dt: 0.58, ct: 0.06 }); // fuselage
  A.box(0.26, 0.1, 0.36, DK, 0, 0.05, -0.02); // ventre (ouïes)
  A.box(0.24, 0.04, 0.24, R, 0, 0.32, 0.03, { em: 1 }); // plaque rouge du dessus
  A.box(0.3, 0.12, 0.04, R, 0, 0.18, 0.31, { em: 1 }); // bandeau rouge avant
  A.bloc(0.07, 0.18, 0.22, G, 0, 0.3, -0.21, { dt: 0.12, sz: -0.02 }); // dérive
  for (const z of [-0.22, 0.2]) A.box(0.86, 0.06, 0.09, G, 0, 0.22, z); // bras porteurs
  for (let k = 0; k < 4; k++) {
    const sx = k & 1 ? 1 : -1;
    const sz = k & 2 ? 1 : -1;
    const x = sx * 0.43;
    const z = sz * 0.3;
    const piece = { nom: 'rotor', genre: 'rotor', cote: sx, pivot: [x, 0.24, z] };
    A.cyl(0.2, 0.2, 0.09, 8, L, x, 0.24, z, { open: true, piece }); // carénage
    A.ring(0.13, 0.2, 8, L, x, 0.285, z, { piece }); // bord du carénage
    A.disc(0.14, 8, DK, x, 0.215, z, { piece }); // fond
    A.disc(0.06, 6, R, x, 0.23, z, { em: 1, piece }); // moyeu rouge
  }
  return aHauteur(A.fin(), T.height);
}

/** Tireur : chenilles arrondies, châssis, tourelle à plaque jaune dessus et visière jaune, canon carré qui sort de la visière, antenne. */
export function construireTireur(render, T = ENEMIES.types[ENEMY.TIREUR]) {
  const G = T.bodyColor;
  const D = T.accentColor;
  const L = T.accent2Color;
  const Y = T.eyeColor;
  const A = atelier(render);
  for (let s = -1; s <= 1; s += 2) {
    A.barre(0.2, 0.3, 1.05, 0.1, D, s * 0.36, 0.15, -0.04, { piece: { nom: 'chenille', genre: 'chenille', cote: s, pivot: [s * 0.36, 0.15, -0.04] } });
    A.box(0.03, 0.08, 0.2, Y, s * 0.325, 0.44, 0.12, { em: 1 }); // feu latéral du châssis
  }
  A.bloc(0.62, 0.9, 0.42, G, 0, 0.22, -0.05, { c: 0.06, ct: 0.08, wt: 0.58, dt: 0.84 }); // châssis
  A.bloc(0.58, 0.56, 0.42, G, 0, 0.64, -0.12, { c: 0.06, ct: 0.08, wt: 0.54, dt: 0.5 }); // tourelle
  A.box(0.32, 0.07, 0.24, Y, 0, 1.095, -0.12, { em: 1 }); // plaque jaune du dessus
  A.box(0.48, 0.13, 0.04, Y, 0, 0.88, 0.17, { em: 1 }); // visière jaune
  A.box(0.15, 0.15, 0.8, L, 0, 0.84, 0.55); // canon
  A.box(0.22, 0.22, 0.14, D, 0, 0.84, 0.99); // frein de bouche
  A.box(0.06, 0.36, 0.06, D, 0.2, 1.24, -0.32); // antenne
  return aHauteur(A.fin(), T.height);
}

/** Kamikaze : boule à facettes ceinturée, quatre blocs de mine, collier sombre et gros feu orange au sommet, yeux en V orange. */
export function construireKamikaze(render, T = ENEMIES.types[ENEMY.KAMIKAZE]) {
  const G = T.bodyColor;
  const D = T.accentColor;
  const O = T.eyeColor;
  const A = atelier(render);
  for (let s = -1; s <= 1; s += 2) {
    A.box(0.14, 0.12, 0.34, D, s * 0.17, 0.06, 0, { piece: { nom: 'pied', genre: 'jambe', cote: s, pivot: [s * 0.17, 0.12, 0] } });
  }
  const boule = { nom: 'boule', genre: 'boule', pivot: [0, 0.5, 0] };
  A.ico(0.42, 1, G, 0, 0.5, 0, { ey: 1.06, piece: boule }); // boule
  // ceinture : prisme octogonal FERMÉ (un cylindre ouvert laissait voir des échardes sombres sur la silhouette)
  A.bloc(0.9, 0.9, 0.12, D, 0, 0.4, 0, { c: 0.26, piece: boule });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    A.box(0.13, 0.13, 0.16, D, Math.sin(a) * 0.47, 0.46, Math.cos(a) * 0.47, { ry: a, piece: boule }); // blocs de mine
  }
  A.cyl(0.2, 0.3, 0.14, 8, D, 0, 0.88, 0, { open: true }); // collier
  A.cyl(0.2, 0.2, 0.08, 8, O, 0, 0.98, 0, { em: 1 }); // feu du sommet (il clignote : lueur)
  for (let s = -1; s <= 1; s += 2) A.box(0.16, 0.08, 0.08, O, s * 0.085, 0.66, 0.355, { em: 1, rz: s * 0.32, ry: -s * 0.2 }); // yeux en V
  return aHauteur(A.fin(), T.height);
}

/** Blindé : bouclier frontal en trois pans (chevron vu de dessus) à feux rouges, tête à double visière, deux cheminées arrière, pieds-blocs. */
export function construireBlinde(render, T = ENEMIES.types[ENEMY.BLINDE]) {
  const G = T.bodyColor;
  const D = T.accentColor;
  const L = T.accent2Color;
  const R = T.eyeColor;
  const A = atelier(render);
  for (let s = -1; s <= 1; s += 2) {
    A.bloc(0.5, 0.95, 0.26, D, s * 0.42, 0, -0.08, { wt: 0.46, dt: 0.88, piece: { nom: 'pied', genre: 'jambe', cote: s, pivot: [s * 0.42, 0.3, -0.08] } });
    A.box(0.16, 0.5, 0.16, L, s * 0.48, 2.0, -0.55); // cheminées : repère de l'ARRIÈRE (le côté vulnérable)
    // ailes du bouclier, rabattues vers l'arrière ; feu rouge vertical sur chacune
    A.box(0.62, 1.42, 0.16, G, s * 0.84, 1.0, 0.43, { ry: s * 0.62 });
    A.box(0.09, 0.26, 0.04, R, s * 0.86, 0.85, 0.54, { em: 1, ry: s * 0.62 });
  }
  A.bloc(1.26, 1.28, 0.95, D, 0, 0.24, -0.1, { c: 0.08 }); // caisse (sombre : elle se lit entre les pans du bouclier)
  A.bloc(1.36, 1.16, 0.56, G, 0, 1.19, -0.12, { c: 0.08, wt: 1.28, dt: 1.08, ct: 0.1 }); // haut du corps
  A.box(1.0, 1.48, 0.17, G, 0, 1.0, 0.6); // plaque centrale du bouclier (même métal que le corps, comme la référence)
  A.bloc(0.56, 0.46, 0.42, G, 0, 1.75, 0.18, { c: 0.05, ct: 0.06, wt: 0.52, dt: 0.42 }); // tête
  A.box(0.44, 0.1, 0.04, R, 0, 2.06, 0.42, { em: 1 }); // visière haute
  A.box(0.44, 0.1, 0.04, R, 0, 1.9, 0.42, { em: 1 }); // visière basse
  A.box(0.4, 0.04, 0.12, R, 0, 2.18, 0.31, { em: 1 }); // débord rouge sur le dessus de la tête (vu de dessus : écart assumé)
  return aHauteur(A.fin(), T.height);
}

/** Réparateur : cube trapu, capot à croix verte, visière verte, bras courts, antenne à parabole hexagonale. */
export function construireReparateur(render, T = ENEMIES.types[ENEMY.REPARATEUR]) {
  const G = T.bodyColor;
  const L = T.accentColor;
  const V = T.eyeColor;
  const A = atelier(render);
  for (let s = -1; s <= 1; s += 2) {
    A.box(0.22, 0.2, 0.4, G, s * 0.2, 0.1, 0.0, { piece: { nom: 'pied', genre: 'jambe', cote: s, pivot: [s * 0.2, 0.2, 0] } });
    A.bloc(0.14, 0.32, 0.18, G, s * 0.43, 0.46, 0.07, { c: 0.03 }); // bras court
  }
  A.bloc(0.74, 0.68, 0.64, G, 0, 0.18, 0, { c: 0.06, ct: 0.08, wt: 0.7, dt: 0.64 }); // corps
  A.bloc(0.6, 0.56, 0.16, G, 0, 0.82, 0.0, { c: 0.05, wt: 0.56, dt: 0.52 }); // capot
  A.box(0.42, 0.05, 0.13, V, 0, 1.0, 0.0, { em: 1 }); // croix verte
  A.box(0.13, 0.05, 0.42, V, 0, 1.0, 0.0, { em: 1 });
  A.box(0.44, 0.12, 0.04, V, 0, 0.68, 0.33, { em: 1 }); // visière verte
  A.box(0.05, 0.42, 0.05, L, 0.24, 1.17, -0.24); // mât
  A.cyl(0.18, 0.08, 0.09, 6, L, 0.24, 1.42, -0.24); // parabole
  return aHauteur(A.fin(), T.height);
}

/** Aiguillage : remplace enemies.buildMesh(t). */
export function construireRobot(t, render) {
  switch (t) {
    case ENEMY.RODEUR:
      return construireRodeur(render);
    case ENEMY.DRONE:
      return construireDrone(render);
    case ENEMY.TIREUR:
      return construireTireur(render);
    case ENEMY.KAMIKAZE:
      return construireKamikaze(render);
    case ENEMY.BLINDE:
      return construireBlinde(render);
    default:
      return construireReparateur(render);
  }
}
