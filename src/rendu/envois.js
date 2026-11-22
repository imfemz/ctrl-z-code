// RENDU — envois au GPU sans allocation (correction du 14/11/2026, ARCHITECTURE.md § Z nonies).
//
// 1. Textures de données réécrites à chaque image (os du héros et du boss, texture des vraies lumières) : `needsUpdate`
//    fait repasser three par `uploadTexture → initTexture → getTextureCacheKey`, qui construit à CHAQUE envoi un
//    tableau et une chaîne (mesuré : ≈ 230 octets par envoi, 3 envois par image en combat, ≈ 690 o/image). `envoyer(t)`
//    réécrit la texture déjà créée par three avec un seul `texSubImage2D`, en liant la texture par `renderer.state` (le
//    cache de liaisons de three reste juste). Tant que three n'a pas fait le premier envoi (ou qu'un envoi de three est
//    en attente), on retombe sur `needsUpdate`.
// 2. Tri des listes de rendu : les comparateurs de three (painterSortStable, reversePainterSortStable) renvoient des
//    différences de flottants (`a.z - b.z`) au tri natif, qui les emballe (mesuré : ≈ 610 o/image). `trierOpaques` et
//    `trierTransparents` rendent le MÊME ordre (mêmes clés, même signe) avec des entiers −1 / 1 ; posés par
//    `renderer.setOpaqueSort` / `setTransparentSort` (API publique de three).
//
// Le point 1 touche à l'intérieur de three r170 (épinglé dans index.html) : `renderer.properties` (`__webglTexture`,
// `__version`) et `Skeleton.prototype.update`. Une texture d'une autre forme (autre format que RGBA flottant) passe
// par `needsUpdate` comme avant.
import * as THREE from 'three';

let R = null;
let gl = null;
let image = 0; // compteur d'images (render.beginFrame) : un squelette n'est envoyé qu'une fois par image

/** render.init : le renderer du jeu (et de la scène du menu, qui le partage). */
export function init(renderer) {
  R = renderer;
  gl = renderer.getContext();
  renderer.setOpaqueSort(trierOpaques);
  renderer.setTransparentSort(trierTransparents);
}

/** render.beginFrame (F1). */
export function debutImage() {
  image = (image + 1) & 0x3fffffff;
}

/** Texture de données (DataTexture RGBA flottante) dont `image.data` vient d'être réécrit. */
export function envoyer(t) {
  if (R !== null && t.format === THREE.RGBAFormat && t.type === THREE.FloatType) {
    const p = R.properties.get(t);
    if (p.__webglTexture !== undefined && p.__version === t.version) {
      R.state.bindTexture(gl.TEXTURE_2D, p.__webglTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, t.flipY);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, t.premultiplyAlpha);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, t.unpackAlignment);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, t.image.width, t.image.height, gl.RGBA, gl.FLOAT, t.image.data);
      return;
    }
  }
  t.needsUpdate = true;
}

// Squelettes : même calcul des matrices que three, puis `envoyer` au lieu de `boneTexture.needsUpdate = true`.
const majSquelette = THREE.Skeleton.prototype.update;
THREE.Skeleton.prototype.update = function update() {
  const t = this.boneTexture;
  if (t === null || R === null) {
    majSquelette.call(this);
    return;
  }
  this.boneTexture = null; // three ne marque rien : les matrices seules
  majSquelette.call(this);
  this.boneTexture = t;
  // three met le squelette à jour une fois par appel de rendu qui le dessine (passe principale, puis carte d'ombre) ;
  // les os ne bougent pas entre deux rendus de la même image : un seul envoi par image.
  if (t.srImage === image) return;
  t.srImage = image;
  envoyer(t);
};

// Mêmes clés et même ordre que painterSortStable / reversePainterSortStable de three r170 ; résultats entiers.
function trierOpaques(a, b) {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder < b.groupOrder ? -1 : 1;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder < b.renderOrder ? -1 : 1;
  if (a.material.id !== b.material.id) return a.material.id < b.material.id ? -1 : 1;
  if (a.z !== b.z) return a.z < b.z ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function trierTransparents(a, b) {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder < b.groupOrder ? -1 : 1;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder < b.renderOrder ? -1 : 1;
  if (a.z !== b.z) return b.z < a.z ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
