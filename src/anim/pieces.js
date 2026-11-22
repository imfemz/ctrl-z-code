// ANIMATIONS v2 — chargement d'un modèle Blender (.glb) AVEC ses pièces, pour l'animation procédurale.
//
// Même lecture que tests/blender/charger-glb.js (fusionner) et que src/rendu/glb.js (contrat § G.2) :
//   UNE géométrie indexée, attributs position, normal, color (linéaire), aEmissive (0/1 : groupe « _emissif »),
//   aFx (vec2 nul, pour les maillages non instanciés), piece (float : index dans pieces).
//   pieces[i] = { nom, parent (index ou -1), pivot [x, y, z] repère du modèle, genre, cote }.
//   vides = { nom: { position [x, y, z], userData } } : nœuds sans maillage (cape_epaule_g, cape_epaule_d, cape_dos).
// Option `textures` (héros, 16/11/2026 : armes bakées, outils/blender/bake_arme.py) : attributs en plus uv (vec2) et
// aTex (1 sur les faces d'un matériau texturé, 0 ailleurs) sur TOUTES les pièces, et `textures` { map, normalMap,
// normalScale } dans le résultat (null si le fichier n'en a pas). La couleur de sommet reste celle du fichier (repli :
// un matériau SANS l'image dessine le modèle comme avant) ; materiaux.appliquerTexturesArmes remplace couleur et
// relief par l'image là où aTex = 1.
// Échelle (uniforme ; pivots et vides suivent), au choix : `echelle` (facteur donné), `cible` (hauteur voulue rapportée
// à la hauteur DÉCLARÉE du modèle, racine.userData.hauteur : celle que visait le script Blender), `hauteur` (hauteur
// voulue rapportée à la boîte englobante). Sans aucune des trois : taille du fichier.
// À l'init seulement (asynchrone).
//
// INTÉGRÉ (étape « modèles », ARCHITECTURE.md § Z quinquies) : src/rendu/modeles.js charge par ici les modèles des
// unités du jeu (héros, robots, marchand, boss) ; l'attribut `piece` sera lu par le shader des membres (allure.js) et
// par le squelette du héros (heros-anim.js). Lecture par src/rendu/glb.js lireGltf (fetch + parseAsync, cache par
// adresse) : le loadAsync de three finissait en « net::ERR_ABORTED » dans Chromium sous le serveur de test (§ Z quater).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lireGltf } from '../rendu/glb.js';

function noeudDe(obj, parser, racine) {
  for (let o = obj; o && o !== racine; o = o.parent) {
    const a = parser.associations.get(o);
    if (a && a.nodes !== undefined) return o;
  }
  return null;
}

export async function chargerPieces(url, { hauteur = 0, cible = 0, echelle = 0, phase = 'toutes', emissifMateriau = false, textures = false } = {}) {
  const gltf = await lireGltf(url);
  const parser = gltf.parser;
  const racine = gltf.scene.children.find((o) => o.userData && o.userData.type) || gltf.scene.children[0];
  gltf.scene.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(racine.matrixWorld).invert();
  const m4 = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const pieces = [];
  const indexDe = new Map();
  const vides = {};
  const phaseDe = (o) => {
    for (let x = o; x && x !== racine; x = x.parent) if (x.userData && x.userData.phase === 2) return 2;
    return 1;
  };
  racine.traverse((o) => {
    if (o === racine) return;
    const a = parser.associations.get(o);
    if (!a || a.nodes === undefined) return;
    let aMaillage = false;
    o.traverse((m) => {
      if (m.isMesh && noeudDe(m, parser, racine) === o) aMaillage = true;
    });
    v.setFromMatrixPosition(m4.multiplyMatrices(inv, o.matrixWorld));
    if (!aMaillage) {
      vides[o.name] = { position: [v.x, v.y, v.z], userData: { ...o.userData } };
      return;
    }
    if (phase !== 'toutes' && phaseDe(o) !== phase) return;
    indexDe.set(o, pieces.length);
    pieces.push({ nom: o.name, objet: o, pivot: [v.x, v.y, v.z], genre: o.userData.genre || 'corps', cote: o.userData.cote || 0 });
  });
  for (const p of pieces) {
    const parent = indexDe.get(p.objet.parent);
    p.parent = parent === undefined ? -1 : parent;
    delete p.objet;
  }
  const lots = [];
  let tex = null;
  racine.traverse((m) => {
    if (!m.isMesh) return;
    const i = indexDe.get(noeudDe(m, parser, racine));
    if (i === undefined) return;
    let g = m.geometry.clone();
    g.applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld));
    if (!g.index) g = g.toNonIndexed(); // garde un index pour tous (mergeGeometries exige le même état)
    const n = g.attributes.position.count;
    if (!g.index) {
      const idx = new Uint32Array(n);
      for (let k = 0; k < n; k++) idx[k] = k;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const emissif = /_emissif/.test(mat.name || '') ? 1 : 0;
    const col = new Float32Array(n * 3);
    // emissifMateriau (jeu, § Z quinquies) : une pièce émissive prend la couleur émissive de son matériau, comme
    // src/rendu/glb.js et le rendu validé (planche passe 5) ; sinon COLOR_0 (≈ 0,4 × la lueur, ombrée), comme le
    // prototype des animations.
    const em = emissif && emissifMateriau && mat.emissive && mat.emissive.r + mat.emissive.g + mat.emissive.b > 0 ? mat.emissive : null;
    const c = em ? null : g.attributes.color;
    for (let k = 0; k < n; k++) {
      if (em) {
        col[k * 3] = em.r;
        col[k * 3 + 1] = em.g;
        col[k * 3 + 2] = em.b;
      } else if (c) {
        col[k * 3] = c.getX(k);
        col[k * 3 + 1] = c.getY(k);
        col[k * 3 + 2] = c.getZ(k);
      } else {
        col[k * 3] = mat.color.r;
        col[k * 3 + 1] = mat.color.g;
        col[k * 3 + 2] = mat.color.b;
      }
    }
    const out = new THREE.BufferGeometry();
    out.setIndex(g.index);
    out.setAttribute('position', g.attributes.position);
    out.setAttribute('normal', g.attributes.normal);
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(n).fill(emissif), 1));
    out.setAttribute('piece', new THREE.BufferAttribute(new Float32Array(n).fill(i), 1));
    if (textures) {
      // image des armes PARTAGÉE (héros et agents, 17/11 au soir) : le matériau « …armes_atlas » n'a pas d'image dans
      // le .glb, ses faces lisent atlas-armes-*.webp (atlasArmes, chargé une fois pour tous les modèles)
      const partage = !mat.map && ATLAS_ARMES.test(mat.name || '') && !!g.attributes.uv;
      if (partage && !tex) tex = 'partage';
      const avecImage = (!!mat.map || partage) && !!g.attributes.uv;
      if (avecImage && !tex) tex = { map: mat.map, normalMap: mat.normalMap || null, normalScale: mat.normalMap ? mat.normalScale.clone() : null };
      out.setAttribute('uv', avecImage ? g.attributes.uv : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      out.setAttribute('aTex', new THREE.BufferAttribute(new Float32Array(n).fill(avecImage ? 1 : 0), 1));
    }
    lots.push(out);
  });
  const geometry = mergeGeometries(lots, false);
  let k = 1;
  if (echelle > 0) k = echelle;
  else if (cible > 0 && racine.userData.hauteur > 0) k = cible / racine.userData.hauteur;
  else if (hauteur > 0) {
    geometry.computeBoundingBox();
    const b = geometry.boundingBox;
    k = hauteur / Math.max(1e-6, b.max.y - Math.min(0, b.min.y));
  }
  if (k !== 1) {
    geometry.scale(k, k, k);
    for (const p of pieces) p.pivot = p.pivot.map((x) => x * k);
    for (const n of Object.keys(vides)) vides[n].position = vides[n].position.map((x) => x * k);
  }
  const n = geometry.attributes.position.count;
  geometry.setAttribute('aFx', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (tex === 'partage') tex = await atlasArmes(url);
  return { geometry, pieces, vides, echelle: k, triangles: geometry.index.count / 3, userData: racine.userData, textures: tex };
}

// Image des armes PARTAGÉE (17/11 au soir, Femz : « une seule texture, chargée une fois ») : outils/blender/armes_pieces.py
// (materiau_atlas) l'écrit dans outils/blender/sources/pieces/atlas-armes-*.png, outils/atlas_webp.py en fait
// assets/modeles/atlas-armes-{couleur,normales}.webp (21/11 : 2 × 10,6 Mo → 4 Mo), et exporte heros.glb et agent-*.glb
// SANS image (commun.exporter, atlas_partage) — 2 × 6 Mo au lieu de 2 × 6 Mo PAR modèle. Lue une fois (promesse par
// dossier), mêmes objets texture pour tous les modèles (un seul envoi au GPU). Réglages = ceux que GLTFLoader donnait à
// l'image embarquée : flipY false, filtres linéaires + mipmaps, répétition, ImageBitmap (premultiplyAlpha 'none'),
// normalScale (1, −1) (tangentes dérivées : le .glb n'en porte pas, comme avant).
const ATLAS_ARMES = /armes_atlas$/;
const atlasCache = new Map();
async function imageAtlas(url, couleur) {
  const rep = await fetch(url);
  if (!rep.ok) throw new Error(`HTTP ${rep.status} pour ${url}`);
  const blob = await rep.blob();
  const t = new THREE.Texture(typeof createImageBitmap === 'function' ? await createImageBitmap(blob, { premultiplyAlpha: 'none' }) : await new Promise((ok, ko) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = ko;
    im.src = URL.createObjectURL(blob);
  }));
  t.flipY = false;
  t.colorSpace = couleur ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.name = url.slice(url.lastIndexOf('/') + 1);
  t.needsUpdate = true;
  return t;
}
function atlasArmes(urlModele) {
  const dossier = urlModele.slice(0, urlModele.lastIndexOf('/') + 1);
  if (!atlasCache.has(dossier))
    atlasCache.set(dossier, Promise.all([imageAtlas(dossier + 'atlas-armes-couleur.webp', true), imageAtlas(dossier + 'atlas-armes-normales.webp', false)]).then(
      ([map, normalMap]) => ({ map, normalMap, normalScale: new THREE.Vector2(1, -1) }),
    ));
  return atlasCache.get(dossier);
}
