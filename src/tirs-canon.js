// Étape 4, chantier J (ARCHITECTURE.md § E4.J.2) — ancien visuel des balles des robots à canon, demande de Femz du 16/11.
//
// Le maillage « tirs-ennemis » d'avant l'étape « vfx » (§ Z septies), repris à l'identique de tests/.cache/avant-vfx
// (enemies.js buildShot, 14/11 03h46) : tête icosaèdre de rayon 1 (× rayon de collision : ce qu'on voit est ce qui
// touche), cœur clair posé dessus (côté caméra), traînée courte qui s'assombrit vers l'arrière. Non éclairé, au-dessus
// du seuil du bloom. Un appel de dessin pour toutes les balles ET les obus (zéro quand rien ne vole).
//
// Écriture (§ G.3, en ligne, sans allocation) : enemies.sync remet N[0] à 0 et écrit les balles ; hazards.sync ajoute
// les obus en vol ; main (F11, après hazards.sync) : commit(). rendu/lumieres.js lit les positions (maillage trouvé par
// son nom) pour les taches de lumière au sol.
import * as THREE from 'three';
import { CAPS, PALETTE, RENDER, TIR_CANON } from './config.js';

let render = null;
let mesh = null;
/** Nombre d'instances écrites à cette image (enemies.sync puis hazards.sync). */
export const N = new Int32Array(1);
let cap = 0;

/**
 * Tir ennemi : une tête ronde de rayon 1 (le rayon de collision, une fois mise à l'échelle : ce qu'on voit est ce qui
 * touche), un cœur clair posé dessus (côté caméra, quel que soit le cap), une traînée courte qui s'assombrit vers
 * l'arrière. La traînée EST le maillage : aucun appel de dessin de plus. Non éclairé, au-dessus du seuil du bloom.
 * (Copie à l'identique de buildShot, tests/.cache/avant-vfx/src/enemies.js ; réglages TIR_CANON.)
 */
export function buildShot() {
  const Pj = TIR_CANON;
  const tint = (g, gain) => {
    const col = g.attributes.color.array;
    for (let v = 0; v < col.length; v++) col[v] *= gain;
    return g;
  };
  const parts = [];
  parts.push(tint(render.makePart(new THREE.IcosahedronGeometry(1, 0), PALETTE.enemyShot, 0), Pj.glow)); // tête
  const core = new THREE.IcosahedronGeometry(Pj.coreSize, 0);
  core.translate(0, 1 - Pj.coreSize * 0.45, 0);
  parts.push(tint(render.makePart(core, PALETTE.enemyShot, 0), Pj.coreGlow)); // cœur
  // Traînée : pyramide couchée, base cachée dans la tête, pointe à trailLength derrière le bord de la tête.
  const tailLen = 1 + Pj.trailLength / Pj.refRadius;
  const tail = new THREE.ConeGeometry(Pj.tailWidth, tailLen, 4, 1, true);
  tail.rotateX(-Math.PI / 2); // la pointe vers l'arrière (−Z)
  tail.translate(0, 0, -tailLen / 2);
  const tailPart = render.makePart(tail, PALETTE.enemyShot, 0);
  const pos = tailPart.attributes.position.array;
  const col = tailPart.attributes.color.array;
  for (let v = 0; v < pos.length; v += 3) {
    const gain = pos[v + 2] < -tailLen * 0.5 ? Pj.tailGlow : Pj.glow; // la pointe s'assombrit
    col[v] *= gain;
    col[v + 1] *= gain;
    col[v + 2] *= gain;
  }
  parts.push(tailPart);
  return render.mergeParts(parts);
}

export function init(r) {
  render = r;
  cap = CAPS.enemyProjectiles + CAPS.hazards;
  mesh = render.createInstanced(buildShot(), render.createUnlitMaterial(), cap, { name: 'tirs-ennemis' });
  mesh.renderOrder = RENDER.effectsOrder; // comme avant le 14/11 : après les robots, avec test de profondeur
  N[0] = 0;
}

/** Matrices d'instance (16 flottants par tir), à écrire en ligne. */
export function tampon() {
  return mesh.instanceMatrix.array;
}

export function capacite() {
  return cap;
}

/** F11, après hazards.sync : nombre d'instances, visibilité, envoi. */
export function commit() {
  render.commit(mesh, N[0]);
}

export function reset() {
  N[0] = 0;
  if (mesh !== null) render.commit(mesh, 0);
}

export function inspect(out) {
  out.count = mesh ? mesh.count : 0;
  out.visible = mesh ? mesh.visible : false;
  out.cap = cap;
  return out;
}
