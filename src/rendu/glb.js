// RENDU « PEINT » — chargement d'un modèle Blender (.glb) en géométrie du contrat § G.2 (prototype, passe 3).
//
// Sortie : géométries NON indexées, attributs position, normal, color (linéaire, 3 composantes), aEmissive (0/1), et,
// pour une pièce texturée, uv (UV0 glTF) et tangent (MikkTSpace : celles du fichier, sinon calculées ici comme le
// prévoit glTF), transformations des nœuds appliquées. Prêtes pour createPaintedMaterial / createInstanced /
// makeShadowCaster — comme les constructeurs de src/modeles/.
// Couleur : COLOR_0 (couleur × AO cuite × dégradé) ; sans COLOR_0, la couleur de base du matériau ; avec une texture
// de couleur (passe 3, convention « v3 » du manifeste) : blanc — COLOR_0 n'est alors qu'un repli, jamais multiplié par
// la texture.
// Fichiers « famille » (decor-<famille>.glb, un nœud par variante, un atlas par famille) : le fichier est chargé UNE
// fois (cache par adresse, mêmes objets texture pour toutes ses variantes) et `noeud` choisit la variante, posée dans
// le repère de son nœud.
// Pièces émissives (dans cet ordre) : attribut _EMISSIVE (lu « _emissive » par three), matériau au facteur émissif non
// nul, nom de maillage ou de matériau contenant emissi / oeil / œil / yeux / eye / feu / lumi ; une pièce émissive prend
// la couleur émissive de son matériau.
// Textures (passe 3) : baseColorTexture → map (sRGB), normalTexture → normalMap (+ normalScale), occlusionTexture →
// aoMap (canal R). Les pièces sont regroupées PAR JEU DE TEXTURES (un matériau peint par groupe) : un modèle doit donc
// porter un seul jeu de textures (atlas) pour rester en un appel de dessin. À l'init seulement (asynchrone).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeMikkTSpaceTangents, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const EMISSIF = /emissi|oeil|œil|yeux|eye|feu|lumi/i;
let mikk = null; // module MikkTSpace (wasm de three), chargé à la première normal map sans tangentes

async function mikkTSpace() {
  if (!mikk) {
    const m = await import('three/addons/libs/mikktspace.module.js');
    await m.ready;
    mikk = m;
  }
  return mikk;
}

function couleurs(attr, n) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = attr.getX(i);
    out[i * 3 + 1] = attr.getY(i);
    out[i * 3 + 2] = attr.getZ(i);
  }
  return out;
}

/** Textures d'un matériau glTF (ou null s'il n'en a aucune). */
function texturesDe(m) {
  if (!m || !(m.map || m.normalMap || m.aoMap)) return null;
  return { map: m.map || null, normalMap: m.normalMap || null, aoMap: m.aoMap || null, normalScale: m.normalMap ? m.normalScale.clone() : null };
}
const cleTextures = (t) => (t ? [t.map, t.normalMap, t.aoMap].map((x) => (x ? x.uuid : '-')).join('|') : 'sans');

/**
 * Charge url et renvoie { geometry, textures, groupes, triangles, emissifs, noms, octetsTextures } — ou null (404).
 * groupes = [{ geometry, textures }] (un par jeu de textures) ; geometry / textures = le premier groupe (le cas normal).
 * hauteur : si donnée, mise à cette hauteur (échelle uniforme, pieds à y = 0 conservés).
 */
const cache = new Map(); // adresse → promesse du glTF (null si absent)
function charger(url, sonder = true) {
  if (!cache.has(url))
    cache.set(
      url,
      (async () => {
        // sonde HEAD : un modèle facultatif absent rend null sans erreur de chargement. sonder = false (fichier listé
        // par un manifeste, intégration) : chargé directement — une absence lève alors une erreur.
        if (sonder) {
          const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
          if (!head || !head.ok) return null;
        }
        // octets lus par fetch puis analysés (parseAsync) : pas de flux de progression du FileLoader de three
        const rep = await fetch(url);
        if (!rep.ok) throw new Error(`HTTP ${rep.status} pour ${url}`);
        const octets = await rep.arrayBuffer();
        const gltf = await new GLTFLoader().parseAsync(octets, url.slice(0, url.lastIndexOf('/') + 1));
        gltf.scene.updateMatrixWorld(true);
        gltf.userData.octetsComptes = false;
        return gltf;
      })(),
    );
  return cache.get(url);
}

/**
 * Le glTF analysé de url (cache par adresse : un fichier lu deux fois — boss en deux phases, page de test — n'est
 * téléchargé qu'une fois). Lève si le fichier manque ou est illisible. Utilisé par src/anim/pieces.js (modèles des
 * unités, étape « modèles », ARCHITECTURE.md § Z quinquies) : même lecture par fetch + parseAsync que le décor.
 */
export function lireGltf(url) {
  return charger(url, false);
}

/**
 * § E5.K : oublie le glTF analysé de url (cache par adresse) — octets du fichier et objets de three rendus au ramasse-
 * miettes. Appelé quand le modèle d'un agent est libéré (changement d'agent) ; une relecture le retélécharge.
 */
export function oublierGltf(url) {
  cache.delete(url);
}

export async function chargerGeometrie(url, { hauteur = 0, noeud = null, sonder = true } = {}) {
  const gltf = await charger(url, sonder);
  if (!gltf) return null;
  const racine = noeud ? gltf.scene.getObjectByName(noeud) : gltf.scene;
  if (!racine) return null;
  const versLocal = new THREE.Matrix4().copy(racine.matrixWorld).invert(); // variante posée dans le repère de son nœud
  const groupes = new Map();
  const noms = [];
  let emissifs = 0;
  const pieces = [];
  racine.traverse((o) => {
    if (o.isMesh) pieces.push(o);
  });
  for (const o of pieces) {
    let g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(noeud ? versLocal : new THREE.Matrix4(), o.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const tex = texturesDe(m);
    let col;
    if (tex && tex.map && g.attributes.uv) col = new Float32Array(n * 3).fill(1); // la texture porte la couleur
    else if (g.attributes.color) col = couleurs(g.attributes.color, n);
    else {
      col = new Float32Array(n * 3);
      const c = tex && tex.map ? new THREE.Color(1, 1, 1) : m && m.color ? m.color : new THREE.Color(1, 1, 1);
      for (let i = 0; i < n; i++) {
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
    }
    const em = new Float32Array(n);
    const custom = g.attributes._emissive;
    const emColor = m && m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0 ? m.emissive : null;
    const parNom = EMISSIF.test(o.name) || (m && EMISSIF.test(m.name || ''));
    for (let i = 0; i < n; i++) {
      const e = custom ? (custom.getX(i) > 0.5 ? 1 : 0) : emColor || parNom ? 1 : 0;
      em[i] = e;
      if (e && emColor) {
        col[i * 3] = emColor.r;
        col[i * 3 + 1] = emColor.g;
        col[i * 3 + 2] = emColor.b;
      }
      emissifs += e;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.attributes.position);
    out.setAttribute('normal', g.attributes.normal);
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('aEmissive', new THREE.BufferAttribute(em, 1));
    if (tex && g.attributes.uv) {
      out.setAttribute('uv', g.attributes.uv);
      if (tex.normalMap) {
        if (g.attributes.tangent) out.setAttribute('tangent', g.attributes.tangent);
        else {
          try {
            computeMikkTSpaceTangents(out, await mikkTSpace()); // glTF : tangentes MikkTSpace quand le fichier n'en a pas
          } catch (e) {
            tex.normalScale.y *= -1; // repli : repère par dérivées de three, comme GLTFLoader sans tangentes
          }
        }
      }
    }
    const k = cleTextures(tex && g.attributes.uv ? tex : null);
    if (!groupes.has(k)) groupes.set(k, { parts: [], textures: tex && g.attributes.uv ? tex : null });
    groupes.get(k).parts.push(out);
    noms.push(o.name);
  }
  if (!groupes.size) return null;
  const liste = [];
  let octetsTextures = 0;
  const compter = !gltf.userData.octetsComptes; // un atlas partagé n'est compté qu'une fois
  gltf.userData.octetsComptes = true;
  for (const { parts, textures } of groupes.values()) {
    const geometry = parts.length > 1 ? mergeGeometries(parts, false) : parts[0];
    liste.push({ geometry, textures });
    if (textures && compter)
      for (const t of [textures.map, textures.normalMap, textures.aoMap])
        if (t && t.image) octetsTextures += Math.round(t.image.width * t.image.height * 4 * (4 / 3)); // RGBA8 + mipmaps
  }
  if (hauteur > 0) {
    const b = new THREE.Box3();
    for (const { geometry } of liste) {
      geometry.computeBoundingBox();
      b.union(geometry.boundingBox);
    }
    const k = hauteur / Math.max(1e-6, b.max.y - Math.min(0, b.min.y));
    for (const { geometry } of liste) geometry.scale(k, k, k);
  }
  let tri = 0;
  for (const { geometry } of liste) tri += geometry.attributes.position.count / 3;
  return { geometry: liste[0].geometry, textures: liste[0].textures, groupes: liste, triangles: tri, emissifs, noms, octetsTextures };
}
