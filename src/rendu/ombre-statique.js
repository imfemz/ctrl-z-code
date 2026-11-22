// RENDU « PEINT » — ombre FIGÉE du décor (prototype, passe 2 du 13/11/2026).
//
// Rochers, falaises et carcasses ne bougent jamais : leur ombre est rendue UNE fois, à l'init, dans une carte de
// profondeur propre (RGBA, même format que les cartes de three r170), vue du soleil et couvrant toute l'arène et ses
// falaises. Tous les matériaux peints la lisent (materiaux.js, srOmbreStatique : une prise bilinéaire, 4 lectures) et
// prennent le minimum avec la carte du soleil. Le décor ne projette donc plus d'ombre en temps réel : moins d'appels
// de dessin dans la passe d'ombre à chaque image (et moins d'uniformes envoyés), et la carte du soleil ne garde que
// les unités (héros, blindés, boss, marchand).
//
// Contrat : cuire(renderer, objets, directionSoleil) une fois, objets visibles, AVANT la première compilation des
// matériaux peints (sinon ils ont été compilés sans la carte : appeler alors material.needsUpdate). Une cible de rendu,
// créée une fois, jamais détruite (§ V : aucune texture hors des cibles de rendu).
import * as THREE from 'three';
import { PEINT } from './reglages.js';
import { setOmbreStatique } from './materiaux.js';

const O = PEINT.ombreStatique;
let cible = null;

/**
 * objets : maillages du décor (Mesh), visibles. dir : direction VERS le soleil (tableau de 3, normalisée).
 * Renvoie { texture, texelCm }.
 */
export function cuire(renderer, objets, dir) {
  const n = O.carte;
  if (!cible) {
    cible = new THREE.WebGLRenderTarget(n, n, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    cible.texture.name = 'SurvivorOmbreStatique';
  }
  // Caméra orthographique le long du soleil, ajustée à la boîte de l'arène (± demiCote, hauteur 0 → hauteur).
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  cam.position.copy(d).multiplyScalar(200);
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse;
  const p = new THREE.Vector3();
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let k = 0; k < 8; k++) {
    p.set(k & 1 ? O.demiCote : -O.demiCote, k & 2 ? O.hauteur : 0, k & 4 ? O.demiCote : -O.demiCote).applyMatrix4(inv);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  cam.left = x0;
  cam.right = x1;
  cam.bottom = y0;
  cam.top = y1;
  cam.near = Math.max(0.1, -z1 - 5);
  cam.far = -z0 + 5;
  cam.updateProjectionMatrix();

  // Rendu de la profondeur des seuls objets du décor (calque 7), matériau de profondeur imposé.
  const scene = new THREE.Scene();
  const parents = [];
  for (const o of objets) {
    parents.push([o, o.parent]);
    scene.add(o); // emprunté le temps du rendu (un objet n'a qu'un parent)
  }
  scene.overrideMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  scene.overrideMaterial.side = THREE.DoubleSide;
  const oldTarget = renderer.getRenderTarget();
  const oldColor = new THREE.Color();
  renderer.getClearColor(oldColor);
  const oldAlpha = renderer.getClearAlpha();
  const oldAuto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false; // pas de carte du soleil pour ce rendu
  renderer.setRenderTarget(cible);
  renderer.setClearColor(0xffffff, 1);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(oldTarget);
  renderer.setClearColor(oldColor, oldAlpha);
  renderer.shadowMap.autoUpdate = oldAuto;
  for (const [o, parent] of parents) parent.add(o);
  scene.overrideMaterial.dispose();

  // Matrice monde → carte (même construction que LightShadow.updateMatrices de three)
  const m = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  m.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  setOmbreStatique(cible.texture, m, n);
  return { texture: cible.texture, texelCm: (100 * Math.max(x1 - x0, y1 - y0)) / n };
}
