// MODÈLES — héros (joueur), d'après docs/references-modeles/survivor-heros-3vues.png (détails : -v1, -v2).
//
// Référence : humanoïde élancé ; plaques d'armure blanc cassé (casque à crête, épaulières larges, plastron, avant-bras,
// tibias, pieds) ; membres bleu nuit (bras, cuisses) ; articulations et colonne sombres ; accents cyan émissifs
// (deux yeux, bords du plastron, bandes des épaulières, des avant-bras et des tibias).
//
// Sortie : BufferGeometry fusionnée, EXACTEMENT ce que player.init construisait (makePart / mergeParts, pieds à
// y = 0, avant = +Z local), déjà mise à l'échelle (PLAYER.height × PLAYER.visualScale au sommet de la crête).
//
// PHASE B — dans src/player.js, init :
//   import { construireHeros } from './modeles/heros.js';
//   remplacer tout le bloc « const W = …; … geometry.scale(PLAYER.visualScale, …); » par
//   const geometry = construireHeros(render);
// Le reste (matériau, silhouette « rayons X » qui partage la géométrie, anneau, ombre, sync) ne change pas : le
// maillage reste un Mesh unique, origine aux pieds, pivoté par mesh.rotation (penché, cap) comme aujourd'hui.
//
// Cape (docs/animations-plan.md § R3) : CAPE_HEROS donne, dans le repère du maillage (après mise à l'échelle), les
// deux points d'accroche aux épaules et un volume simple du dos (capsule) pour la collision du tissu.
import { PALETTE, PLAYER } from '../config.js';
import { atelier, echelle, hauteur } from './atelier.js';

// Couleurs propres au héros (relevées sur la référence). PHASE B : à déplacer dans PALETTE (playerLimb, playerJoint).
export const HEROS_MEMBRES = 0x323858; // bleu nuit des bras et des cuisses
export const HEROS_JOINTS = 0x4d4450; // articulations, colonne, cou (gris violacé sombre)

const H_REF = 1.86; // hauteur de construction (sommet de la crête), en mètres « de référence »

/** Points d'accroche de la cape et volume du dos, repère de construction (mis à l'échelle à la sortie). */
const CAPE_REF = {
  epaules: [
    [0.2, 1.53, -0.1],
    [-0.2, 1.53, -0.1],
  ],
  dos: { a: [0, 1.0, -0.05], b: [0, 1.42, -0.07], rayon: 0.17 },
};

function construire(render) {
  const W = PALETTE.player; // plaques
  const N = HEROS_MEMBRES;
  const J = HEROS_JOINTS;
  const C = PALETTE.playerAccent; // émissif
  const A = atelier(render);

  for (let s = -1; s <= 1; s += 2) {
    const side = s < 0 ? 'gauche' : 'droite'; // s = +1 : côté +X = gauche du personnage (il regarde +Z)
    // --- jambe : pied, tibia blindé à bande cyan, genou, cuisse bleu nuit, hanche
    A.bloc(0.17, 0.3, 0.1, W, s * 0.12, 0, 0.04, { wt: 0.15, dt: 0.22, sz: -0.03, piece: { nom: 'pied-' + side, genre: 'jambe', cote: s, pivot: [s * 0.12, 1.0, 0] } });
    A.box(0.1, 0.06, 0.1, J, s * 0.12, 0.13, 0, { piece: { nom: 'cheville-' + side, genre: 'jambe', cote: s, pivot: [s * 0.12, 1.0, 0] } });
    A.bloc(0.17, 0.2, 0.48, W, s * 0.12, 0.15, 0.0, { wt: 0.19, dt: 0.22, c: 0.04, ct: 0.05, piece: { nom: 'tibia-' + side, genre: 'jambe', cote: s, pivot: [s * 0.12, 1.0, 0] } });
    A.box(0.07, 0.2, 0.03, C, s * 0.12, 0.36, 0.115, { em: 1, piece: { nom: 'tibia-cyan-' + side, genre: 'jambe', cote: s, pivot: [s * 0.12, 1.0, 0] } });
    A.box(0.12, 0.08, 0.12, J, s * 0.12, 0.66, 0.01, { piece: { nom: 'genou-' + side, genre: 'jambe', cote: s, pivot: [s * 0.12, 1.0, 0] } });
    A.bloc(0.14, 0.16, 0.34, N, s * 0.12, 0.68, 0.0, { wt: 0.17, dt: 0.18, piece: { nom: 'cuisse-' + side, genre: 'jambe', cote: s, pivot: [s * 0.12, 1.0, 0] } });
    A.box(0.08, 0.12, 0.12, J, s * 0.2, 0.99, 0.0); // rotule de hanche
    // --- bras : épaulière large (bande cyan sur la face extérieure), bras bleu nuit, coude, avant-bras blindé à
    // bande cyan, main. Bras le long du corps, légèrement écartés (pose de la vue de jeu).
    A.bloc(0.24, 0.3, 0.15, W, s * 0.3, 1.36, -0.01, { wt: 0.2, dt: 0.24, c: 0.05, ct: 0.05, sx: -s * 0.02 }); // épaulière
    A.box(0.03, 0.08, 0.16, C, s * 0.425, 1.43, -0.01, { em: 1 }); // bande cyan de l'épaulière
    // plaque cyan sur le dessus de l'épaulière (planche v1) : c'est elle que voit la caméra, de face comme de dos,
    // et la future cape ne la couvre pas
    A.box(0.17, 0.03, 0.23, C, s * 0.282, 1.515, -0.005, { em: 1 });
    A.box(0.1, 0.3, 0.11, N, s * 0.32, 1.2, -0.01, { piece: { nom: 'bras-' + side, genre: 'bras', cote: s, pivot: [s * 0.3, 1.42, 0] } });
    A.box(0.1, 0.07, 0.1, J, s * 0.325, 1.04, 0.0, { piece: { nom: 'coude-' + side, genre: 'bras', cote: s, pivot: [s * 0.3, 1.42, 0] } });
    A.bloc(0.12, 0.14, 0.28, W, s * 0.33, 0.75, 0.01, { wt: 0.14, dt: 0.15, c: 0.03, ct: 0.03, piece: { nom: 'avant-bras-' + side, genre: 'bras', cote: s, pivot: [s * 0.3, 1.42, 0] } });
    A.box(0.025, 0.17, 0.06, C, s * 0.405, 0.9, 0.01, { em: 1, piece: { nom: 'avant-bras-cyan-' + side, genre: 'bras', cote: s, pivot: [s * 0.3, 1.42, 0] } });
    A.box(0.08, 0.15, 0.1, W, s * 0.335, 0.66, 0.02, { piece: { nom: 'main-' + side, genre: 'bras', cote: s, pivot: [s * 0.3, 1.42, 0] } });
    // --- casque : écoutille latérale sombre
    A.cyl(0.055, 0.055, 0.05, 6, J, s * 0.125, 1.69, -0.01, { rz: Math.PI / 2 });
    // --- yeux cyan (ronds sur la référence : petits blocs saillants, lisibles de dessus)
    A.box(0.065, 0.055, 0.04, C, s * 0.05, 1.7, 0.115, { em: 1 });
    // --- bords cyan du plastron (lignes lumineuses entre les pectoraux et les flancs)
    A.box(0.1, 0.035, 0.03, C, s * 0.12, 1.3, 0.155, { em: 1, rz: -s * 0.35 });
  }
  // --- bassin : coque en V blanc cassé, taille sombre
  A.bloc(0.16, 0.16, 0.16, W, 0, 0.9, 0.0, { wt: 0.32, dt: 0.21, ct: 0, sz: 0.0 });
  A.box(0.18, 0.18, 0.13, J, 0, 1.13, -0.01); // colonne (anneaux sombres)
  A.box(0.08, 0.14, 0.03, C, 0, 1.13, 0.06, { em: 1 }); // cœur de la colonne, entre les anneaux (lueur cyan de la référence)
  // --- torse : plastron biseauté à deux pans, dos plat
  A.bloc(0.32, 0.22, 0.3, W, 0, 1.2, 0.01, { wt: 0.46, dt: 0.27, c: 0.06, ct: 0.08, sz: 0.0 });
  A.bloc(0.46, 0.27, 0.06, W, 0, 1.5, 0.01, { wt: 0.36, dt: 0.2, c: 0.08, ct: 0.06, sz: -0.01 }); // haut du plastron (biseau)
  // --- cou et casque
  A.box(0.08, 0.06, 0.08, J, 0, 1.58, -0.01);
  A.bloc(0.2, 0.22, 0.2, W, 0, 1.6, 0.0, { wt: 0.2, dt: 0.21, c: 0.06, ct: 0.07, sz: -0.01 }); // calotte
  A.bloc(0.2, 0.21, 0.04, W, 0, 1.8, -0.01, { wt: 0.13, dt: 0.14, c: 0.07, ct: 0.04 }); // sommet arrondi
  A.bloc(0.09, 0.05, 0.1, W, 0, 1.58, 0.105, { wt: 0.1, dt: 0.06 }); // masque (bouche)
  // --- crête (« mohawk ») : arc de l'avant vers l'arrière, en deux pièces. Cyan (écart assumé : blanc cassé sur la
  // planche 3 vues, mais la v1 porte une lumière cyan sur le dessus du casque) — le sommet du héros est ce qui reste
  // visible au milieu d'une horde. CRETE = W pour revenir à la référence.
  const CRETE = C;
  A.box(0.08, 0.07, 0.17, CRETE, 0, 1.85, 0.0, { rx: -0.25, em: CRETE === C ? 1 : 0 });
  A.box(0.08, 0.12, 0.07, CRETE, 0, 1.8, -0.1, { rx: 0.5, em: CRETE === C ? 1 : 0 });
  return A.fin();
}

/** Géométrie du héros, à l'échelle du jeu. */
export function construireHeros(render) {
  const g = construire(render);
  const k = (PLAYER.height * PLAYER.visualScale) / Math.max(hauteur(g), H_REF);
  return echelle(g, k, k, k);
}

/** Facteur d'échelle appliqué par construireHeros (repère de construction → repère du maillage). */
export function echelleHeros() {
  return (PLAYER.height * PLAYER.visualScale) / H_REF;
}

/** Cape : accroches aux épaules (gauche, droite) et capsule du dos, dans le repère du maillage du joueur. */
export function capeHeros() {
  const k = echelleHeros();
  const m = (p) => ({ x: p[0] * k, y: p[1] * k, z: p[2] * k });
  return {
    epaules: CAPE_REF.epaules.map(m),
    dos: { a: m(CAPE_REF.dos.a), b: m(CAPE_REF.dos.b), rayon: CAPE_REF.dos.rayon * k },
  };
}
