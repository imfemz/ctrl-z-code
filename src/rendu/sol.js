// RENDU « PEINT » — sol, cailloux, touffes, rochers, falaises et carcasses (prototype du 13/11/2026, brief § 1).
//
// Sol : un seul carré de WORLD.groundSize, albédo peint calculé dans le shader (bruit en monde, materiaux.js variante
// 'sol') : plus de tuiles, des plaques claires et des taches d'ombre à grande échelle ; roche hors de l'arène.
// Cailloux et touffes : deux InstancedMesh statiques (deux appels de dessin), placés une fois avec un générateur privé,
// hors des obstacles. Rochers : refaits à partir des positions de world.obstacles, ronds (icosaèdre subdivisé, normales
// lisses), couleurs de sommet « cuites » comme sous Blender : dessus clair, pied sombre (AO), variation par rocher.
// Falaises et carcasses : géométries de world.js reprises, recolorées (dessus clair, pied sombre) ; les disques
// d'ombre factice des carcasses sont retirés (le décor projette une vraie ombre et reçoit une ombre de contact).
// Tout est construit à l'init. Aucune texture.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD } from '../config.js';
import { PEINT } from './reglages.js';
import { createPaintedMaterial } from './materiaux.js';

const S = PEINT.sol;

// Générateur privé (mulberry32), graine fixe : le décor est le même à chaque partie.
const seedBox = new Int32Array(1);
function rnd() {
  const seed = (seedBox[0] + 0x6d2b79f5) | 0;
  seedBox[0] = seed;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a, b) => a + (b - a) * rnd();

const cTmp = new THREE.Color();
const cA = new THREE.Color();
const cB = new THREE.Color();

/** Attributs du contrat (§ G.2) sur une géométrie : color (linéaire, 3 composantes) et aEmissive à 0. */
function finir(g, colors) {
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  return g;
}

/**
 * Ombre d'un maillage de décor : figée (passe 2, ombre-statique.js) — il ne projette rien en temps réel et sera cuit
 * dans la carte statique — ou, si ombreTempsReel, dans la carte du soleil comme en passe 1. Il reçoit toujours.
 */
export const optionsDecor = { ombreTempsReel: false };
function decorOmbre(mesh) {
  mesh.castShadow = optionsDecor.ombreTempsReel;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mesh.userData.srDecor = true; // à cuire dans l'ombre statique
}

// ----- Sol --------------------------------------------------------------------------------------------------------
export function creerSol({ plan = false } = {}) {
  const g = new THREE.PlaneGeometry(WORLD.groundSize, WORLD.groundSize, 1, 1);
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  finir(g, new Float32Array(g.attributes.position.count * 3).fill(1));
  const m = new THREE.Mesh(g, createPaintedMaterial({ profil: 'sol', plan }));
  m.name = 'sol-peint';
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

// ----- Cailloux et touffes ------------------------------------------------------------------------------------------
function caillouGeometry() {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 0).deleteAttribute('normal').deleteAttribute('uv'));
  g.scale(1, 0.6, 1);
  g.translate(0, 0.18, 0);
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const p = g.attributes.position.array;
  const nn = g.attributes.normal.array;
  cA.setHex(S.caillou);
  cB.setHex(PEINT.roche.dessus);
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, nn[i * 3 + 1]) * 0.8; // dessus clair
    const ao = 0.55 + 0.45 * Math.min(1, Math.max(0, (p[i * 3 + 1] + 0.1) / 0.6)); // pied sombre
    cTmp.copy(cA).lerp(cB, t).multiplyScalar(ao);
    col[i * 3] = cTmp.r;
    col[i * 3 + 1] = cTmp.g;
    col[i * 3 + 2] = cTmp.b;
  }
  return finir(g, col);
}

function touffeGeometry() {
  const pos = [];
  const col = [];
  cA.setHex(S.touffe).multiplyScalar(0.55);
  cB.setHex(S.touffePointe);
  const blades = 7;
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2 + rr(-0.3, 0.3);
    const lean = rr(0.18, 0.4);
    const h = rr(0.32, 0.55);
    const w = 0.06;
    const cx = Math.cos(a), cz = Math.sin(a);
    const px = -cz, pz = cx; // perpendiculaire
    const bx = cx * 0.05, bz = cz * 0.05;
    // brin = triangle (base large, pointe penchée vers l'extérieur)
    // deux faces (le triangle et son envers) : matériau FrontSide, même programme que les cailloux
    pos.push(bx - px * w, 0, bz - pz * w, bx + px * w, 0, bz + pz * w, bx + cx * lean, h, bz + cz * lean);
    pos.push(bx + px * w, 0, bz + pz * w, bx - px * w, 0, bz - pz * w, bx + cx * lean, h, bz + cz * lean);
    col.push(cA.r, cA.g, cA.b, cA.r, cA.g, cA.b, cB.r, cB.g, cB.b, cA.r, cA.g, cA.b, cA.r, cA.g, cA.b, cB.r, cB.g, cB.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  // normales tirées vers le haut : un brin s'éclaire comme une touffe, pas comme une lame
  const nn = g.attributes.normal.array;
  for (let i = 0; i < nn.length; i += 3) {
    nn[i] *= 0.4;
    nn[i + 1] = Math.abs(nn[i + 1]) + 0.9;
    nn[i + 2] *= 0.4;
    const l = Math.hypot(nn[i], nn[i + 1], nn[i + 2]);
    nn[i] /= l;
    nn[i + 1] /= l;
    nn[i + 2] /= l;
  }
  return finir(g, new Float32Array(col));
}

// ----- Carte mère : petits composants CMS (à la place des cailloux et des touffes) -----------------------------------
/** Composant CMS à deux bornes, long de x : corps de couleur `corps`, bornes étamées, pastilles dorées sur le vernis. */
function cmsGeometry(corps, l, h, p) {
  const K = PEINT.carte;
  const geos = [];
  const pave = (x0, x1, y0, y1, z0, z1, hex, k = 1) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).deleteAttribute('uv');
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const nn = g.attributes.normal.array;
    const pp = g.attributes.position.array;
    cA.setHex(hex);
    for (let i = 0; i < n; i++) {
      // dessus éclairci, pied assombri (AO cuite), comme les composants Blender
      const t = (0.86 + 0.14 * Math.max(0, nn[i * 3 + 1])) * (0.7 + 0.3 * Math.min(1, pp[i * 3 + 1] / Math.max(h, 0.01))) * k;
      cTmp.copy(cA).multiplyScalar(t);
      col[i * 3] = cTmp.r;
      col[i * 3 + 1] = cTmp.g;
      col[i * 3 + 2] = cTmp.b;
    }
    geos.push(finir(g, col));
  };
  const b = l * 0.2; // longueur d'une borne
  pave(-l / 2 - 0.05, -l / 2 + b + 0.02, 0.0, 0.008, -p / 2 - 0.04, p / 2 + 0.04, K.or, 1.1);
  pave(l / 2 - b - 0.02, l / 2 + 0.05, 0.0, 0.008, -p / 2 - 0.04, p / 2 + 0.04, K.or, 1.1);
  pave(-l / 2, -l / 2 + b, 0.0, h, -p / 2, p / 2, 0xc3cad3);
  pave(l / 2 - b, l / 2, 0.0, h, -p / 2, p / 2, 0xc3cad3);
  pave(-l / 2 + b, l / 2 - b, 0.0, h * 0.94, -p / 2 + 0.005, p / 2 - 0.005, corps);
  const g = mergeGeometries(geos, false);
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

/**
 * Cailloux et touffes dans l'arène, hors des obstacles (overlaps = world.overlaps). Deux InstancedMesh statiques,
 * couleur d'instance pour la variation. Renvoie [cailloux, touffes].
 */
export function creerParsemes(overlaps) {
  seedBox[0] = 0x51ab1e;
  const lim = WORLD.half - 1.5;
  const out = [];
  const carte = PEINT.theme === 'carte-mere';
  const familles = carte
    ? [
        // résistances (corps noir) et condensateurs céramique (corps beige), dans l'axe des pistes
        [cmsGeometry(0x23262c, 0.5, 0.16, 0.26), PEINT.carte.cms.resistances, 'cailloux', THREE.FrontSide, 0.8, 1.35, 0.9, 1.08],
        [cmsGeometry(0xb48a5c, 0.42, 0.2, 0.24), PEINT.carte.cms.condensateurs, 'touffes', THREE.FrontSide, 0.8, 1.3, 0.88, 1.1],
      ]
    : [
        [caillouGeometry(), S.cailloux, 'cailloux', THREE.FrontSide, 0.07, 0.2, 0.8, 1.1],
        [touffeGeometry(), S.touffes, 'touffes', THREE.FrontSide, 0.75, 1.35, 0.8, 1.15],
      ];
  for (const [geo, count, name, side, sMin, sMax, vMin, vMax] of familles) {
    const mesh = new THREE.InstancedMesh(geo, createPaintedMaterial({ profil: 'decor', side }), count);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    let n = 0;
    for (let tries = 0; n < count && tries < count * 20; tries++) {
      // amas : la moitié des éléments se groupe autour d'un précédent (lecture « peinte », pas un semis régulier)
      let x, z;
      if (n > 4 && rnd() < 0.55) {
        m.fromArray(mesh.instanceMatrix.array, Math.floor(rnd() * n) * 16);
        x = m.elements[12] + rr(-1.4, 1.4);
        z = m.elements[14] + rr(-1.4, 1.4);
      } else {
        x = rr(-lim, lim);
        z = rr(-lim, lim);
      }
      if (Math.abs(x) > lim || Math.abs(z) > lim || overlaps(x, z, 0.6)) continue;
      const k = rr(sMin, sMax);
      if (carte) {
        e.set(0, Math.floor(rr(0, 4)) * (Math.PI / 2), 0);
        s.set(k, k, k);
      } else {
        e.set(name === 'cailloux' ? rr(-0.3, 0.3) : 0, rr(0, Math.PI * 2), name === 'cailloux' ? rr(-0.3, 0.3) : 0);
        s.set(k * rr(0.8, 1.25), k, k * rr(0.8, 1.25));
      }
      q.setFromEuler(e);
      v.set(x, 0, z);
      m.compose(v, q, s);
      m.toArray(mesh.instanceMatrix.array, n * 16);
      const l = rr(vMin, vMax);
      mesh.instanceColor.array[n * 3] = l * rr(0.95, 1.05);
      mesh.instanceColor.array[n * 3 + 1] = l;
      mesh.instanceColor.array[n * 3 + 2] = l * rr(0.92, 1.04);
      n++;
    }
    mesh.count = n;
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    out.push(mesh);
  }
  return out;
}

// ----- Rochers ------------------------------------------------------------------------------------------------------
/** Rochers ronds aux positions des rockCount premiers obstacles (x, z, rayon). Un maillage fusionné. */
export function creerRochers(obstacles, rockCount) {
  seedBox[0] = 0x0c4e11;
  const R = PEINT.roche;
  const parts = [];
  const add = (x, z, r, hy, sink) => {
    let g = new THREE.IcosahedronGeometry(1, 1);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position.array;
    // bloc trapu : 3 « lobes » aléatoires, relief par sommet, dessus tassé (assise plate qui prend la lumière),
    // base aplatie et enterrée
    const lobes = [];
    for (let k = 0; k < 3; k++) lobes.push([rr(-1, 1), rr(-0.2, 1), rr(-1, 1), rr(0.1, 0.24)]);
    for (let i = 0; i < p.length; i += 3) {
      let x0 = p[i], y0 = p[i + 1], z0 = p[i + 2];
      let k = rr(0.88, 1.1);
      for (const [lx, ly, lz, a] of lobes) {
        const ll = Math.hypot(lx, ly, lz);
        k += a * Math.max(0, (x0 * lx + y0 * ly + z0 * lz) / ll);
      }
      if (y0 > 0.55) y0 = 0.55 + (y0 - 0.55) * 0.45;
      if (y0 < -0.25) y0 = -0.25 + (y0 + 0.25) * 0.3;
      p[i] = x0 * k;
      p[i + 1] = y0 * k;
      p[i + 2] = z0 * k;
    }
    g.rotateY(rr(0, Math.PI * 2));
    g.scale(r, hy, r);
    g.translate(x, hy * sink, z);
    g.computeVertexNormals();
    // normales « durcies » à moitié : facettes lisibles mais arêtes adoucies (taille de pierre peinte)
    g = g.toNonIndexed();
    {
      const pp = g.attributes.position.array;
      const nn = g.attributes.normal.array;
      for (let t = 0; t < pp.length; t += 9) {
        const ux = pp[t + 3] - pp[t], uy = pp[t + 4] - pp[t + 1], uz = pp[t + 5] - pp[t + 2];
        const vx = pp[t + 6] - pp[t], vy = pp[t + 7] - pp[t + 1], vz = pp[t + 8] - pp[t + 2];
        let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        const fl = Math.hypot(fx, fy, fz) || 1;
        fx /= fl; fy /= fl; fz /= fl;
        for (let v = 0; v < 3; v++) {
          const o = t + v * 3;
          let nx = nn[o] * 0.45 + fx * 0.55, ny = nn[o + 1] * 0.45 + fy * 0.55, nz = nn[o + 2] * 0.45 + fz * 0.55;
          const l = Math.hypot(nx, ny, nz) || 1;
          nn[o] = nx / l; nn[o + 1] = ny / l; nn[o + 2] = nz / l;
        }
      }
    }
    // couleurs cuites : base variée, dessus clair (normale vers le haut), pied sombre (hauteur), creux sombres
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const pos = g.attributes.position.array;
    const nn = g.attributes.normal.array;
    const base = new THREE.Color(R.base).multiplyScalar(rr(0.9, 1.08));
    const top = new THREE.Color(R.dessus);
    const foot = new THREE.Color(R.pied);
    const hTop = hy * (1 + sink);
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1];
      const ny = nn[i * 3 + 1];
      cTmp.copy(base).lerp(top, Math.min(1, Math.max(0, (ny - 0.45) / 0.4)) * 0.6);
      const h = Math.min(1, Math.max(0, y / (hTop * 0.55)));
      cTmp.lerp(foot, (1 - h) * (1 - h) * 0.8);
      col[i * 3] = cTmp.r;
      col[i * 3 + 1] = cTmp.g;
      col[i * 3 + 2] = cTmp.b;
    }
    parts.push(finir(g, col));
  };
  for (let i = 0; i < rockCount; i++) {
    const x = obstacles[i * 3];
    const z = obstacles[i * 3 + 1];
    const r = obstacles[i * 3 + 2];
    add(x, z, r * 0.98, r * rr(0.62, 0.85), 0.55);
    if (r > 1.4) {
      const a = rr(0, Math.PI * 2);
      const s = r * rr(0.3, 0.42);
      add(x + Math.cos(a) * r * 0.85, z + Math.sin(a) * r * 0.85, s, s * 0.75, 0.4);
    }
  }
  const g = mergeGeometries(parts, false);
  const mesh = new THREE.Mesh(g, createPaintedMaterial({ profil: 'decor' }));
  mesh.name = 'rochers-peints';
  decorOmbre(mesh);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ----- Falaises et carcasses (géométries de world.js reprises) ------------------------------------------------------
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Falaises recolorées : dessus clair, pied sombre, la variation de teinte de chaque bloc gardée en luminosité. */
export function recolorerFalaises(source) {
  const g = source.clone();
  const p = g.attributes.position.array;
  const nn = g.attributes.normal.array;
  const c = g.attributes.color.array;
  const R = PEINT.roche;
  const base = new THREE.Color(R.base);
  const top = new THREE.Color(R.dessus);
  const foot = new THREE.Color(R.pied);
  const l0 = lum(base.r, base.g, base.b);
  for (let i = 0; i < p.length / 3; i++) {
    const y = p[i * 3 + 1];
    const ny = nn[i * 3 + 1];
    const k = Math.min(1.25, Math.max(0.75, lum(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]) / l0));
    cTmp.copy(base).multiplyScalar(k);
    if (ny > 0.55) cTmp.lerp(top, 0.8); // dessus
    const h = Math.min(1, Math.max(0, y / 4));
    cTmp.lerp(foot, (1 - h) * 0.75);
    c[i * 3] = cTmp.r;
    c[i * 3 + 1] = cTmp.g;
    c[i * 3 + 2] = cTmp.b;
  }
  const mesh = new THREE.Mesh(g, createPaintedMaterial({ profil: 'decor' }));
  mesh.name = 'falaises-peintes';
  decorOmbre(mesh);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Carcasses sans leurs disques d'ombre factice (triangles plats à y = 0,02), pied assombri. */
export function nettoyerCarcasses(source) {
  const src = source.attributes;
  const keep = [];
  const p = src.position.array;
  for (let t = 0; t < p.length / 9; t++) {
    const o = t * 9;
    const flat = Math.abs(p[o + 1] - 0.02) < 1e-3 && Math.abs(p[o + 4] - 0.02) < 1e-3 && Math.abs(p[o + 7] - 0.02) < 1e-3;
    if (!flat) keep.push(t);
  }
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(src)) {
    const a = src[name];
    const k = a.itemSize;
    const arr = new Float32Array(keep.length * 3 * k);
    for (let j = 0; j < keep.length; j++) arr.set(a.array.subarray(keep[j] * 3 * k, keep[j] * 3 * k + 3 * k), j * 3 * k);
    g.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  const pp = g.attributes.position.array;
  const c = g.attributes.color.array;
  for (let i = 0; i < pp.length / 3; i++) {
    const ao = 0.62 + 0.38 * Math.min(1, Math.max(0, pp[i * 3 + 1] / 0.7));
    c[i * 3] *= ao;
    c[i * 3 + 1] *= ao;
    c[i * 3 + 2] *= ao;
  }
  const mesh = new THREE.Mesh(g, createPaintedMaterial({ profil: 'decor' }));
  mesh.name = 'carcasses-peintes';
  decorOmbre(mesh);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ----- Décor modélisé sous Blender (assets/modeles/decor/*.glb, manifeste.json) -------------------------------------
// Conventions du manifeste (agent du décor) : origine au sol, mètres, COLOR_0 avec AO cuite, _EMISSIVE à 0 ; passe 3 :
// textures cuites (map, normalMap, aoMap) éventuelles, chargées par glb.chargerGeometrie. Chaque fonction « parties… »
// rend des pièces { geometry, textures } posées dans le monde ; fusionnerParties les regroupe PAR JEU DE TEXTURES (un
// maillage, un matériau peint, un appel de dessin par jeu : un atlas par famille garde le décor en 1 à 3 appels).

const ORIENT = { nord: 0, sud: Math.PI, ouest: Math.PI / 2, est: -Math.PI / 2 }; // +Z local → intérieur de l'arène

function poser(src, x, z, rotY, k) {
  const g = src.clone();
  g.scale(k, k, k);
  g.rotateY(rotY);
  g.translate(x, 0, z);
  return g;
}
const tirer = (liste) => liste[Math.floor(rnd() * liste.length)];
// Poses du décor placé (variante, x, z, lacet, échelle) : lues par tests/exporter-plan-carte.mjs pour cuire le plan de
// routage sous Blender (outils/blender/decor/plan_carte.py). Rempli une fois, à l'init du monde.
export const posesDecor = { rochers: [], carcasses: [] };

/** Rochers : un par obstacle « rocher », variante selon le rayon (rayonsObstacle), échelle r / rayonCollision. */
export function partiesRochers(modeles, obstacles, rockCount) {
  seedBox[0] = 0x0dec0;
  const parts = [];
  for (let i = 0; i < rockCount; i++) {
    const r = obstacles[i * 3 + 2];
    let choix = modeles.filter((m) => m.rayonsObstacle && r >= m.rayonsObstacle[0] - 1e-6 && r <= m.rayonsObstacle[1] + 1e-6);
    if (!choix.length) choix = modeles;
    const m = tirer(choix);
    let r0 = m.rayonCollision;
    if (!(r0 > 0)) {
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      r0 = Math.max(1e-3, Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) / 2 / Math.SQRT2);
    }
    // carte mère : un composant est posé dans l'axe des pistes (lacet « quart » du manifeste : multiple de 90°)
    const lacet = m.lacet === 'quart' ? Math.floor(rr(0, 4)) * (Math.PI / 2) : rr(0, Math.PI * 2);
    posesDecor.rochers.push({ variante: m.variante || m.fichier, fichier: m.fichier, x: obstacles[i * 3], z: obstacles[i * 3 + 1], r, lacet, k: r / r0 });
    for (const gr of m.groupes) parts.push({ geometry: poser(gr.geometry, obstacles[i * 3], obstacles[i * 3 + 1], lacet, r / r0), textures: gr.textures });
  }
  return parts;
}

/** Carcasses : une par obstacle « carcasse » (après les rochers), échelle r / rayonCollision bornée à 0,9 – 1,15. */
export function partiesCarcasses(modeles, obstacles, debut, fin) {
  seedBox[0] = 0xca5c;
  const parts = [];
  for (let i = debut; i < fin; i++) {
    const m = tirer(modeles);
    const k = Math.min(1.15, Math.max(0.9, obstacles[i * 3 + 2] / (m.rayonCollision || 1.2)));
    for (const gr of m.groupes) parts.push({ geometry: poser(gr.geometry, obstacles[i * 3], obstacles[i * 3 + 1], rr(0, Math.PI * 2), k), textures: gr.textures });
  }
  return parts;
}

/**
 * Falaises : modules de 6 m le long des quatre côtés (murs au nord, à l'ouest et à l'est ; talus au sud, face à la
 * caméra), +Z local vers l'intérieur, pied intérieur sur le bord de l'arène ; coins (11 m) aux quatre angles, masse
 * dans le quart x < 0, z < 0 tournée vers chaque angle (coins « talus » au sud). half = demi-côté de l'arène.
 */
/** Centres monde des pales des coins (x, y, z), remplis par partiesFalaises (manifeste : coin.helice.centre). */
export const helices = [];

export function partiesFalaises(modeles, half) {
  seedBox[0] = 0xfa1a;
  const parts = [];
  helices.length = 0;
  const de = (type, profil) => modeles.filter((m) => m.type === type && (!profil || m.profil === profil));
  const coinM = de('coin', 'mur');
  const coinT = de('coin', 'talus');
  const mur = de('mur');
  const talus = de('talus');
  const coin = coinM.length ? coinM[0] : null;
  // « complet » (carte mère) : les murs couvrent tout le côté et le coin remplit le carré de l'angle, sans trou ; sinon
  // (désert) les murs s'arrêtent à la largeur du coin de chaque angle
  const complet = !!(coin && coin.complet);
  const coinL = complet ? 0 : (coinM[0] && coinM[0].largeur) || 11;
  const n = Math.max(1, Math.round((2 * (half - coinL)) / 6));
  const pas = (2 * (half - coinL)) / n;
  const ajouter = (m, x, z, rot) => {
    for (const gr of m.groupes) parts.push({ geometry: poser(gr.geometry, x, z, rot, 1), textures: gr.textures });
  };
  for (const [cote, liste] of [['nord', mur], ['ouest', mur], ['est', mur], ['sud', talus.length ? talus : mur]]) {
    if (!liste.length) continue;
    for (let k = 0; k < n; k++) {
      const a = -half + coinL + (k + 0.5) * pas; // le long du côté
      const x = cote === 'nord' || cote === 'sud' ? a : cote === 'ouest' ? -half : half;
      const z = cote === 'nord' ? -half : cote === 'sud' ? half : a;
      ajouter(tirer(liste), x, z, ORIENT[cote]);
    }
  }
  // coins : masse locale dans x < 0, z < 0 ; rotations vers NO, NE, SE, SO
  for (const [x, z, rot, sud] of [[-half, -half, 0, false], [half, -half, -Math.PI / 2, false], [half, half, Math.PI, true], [-half, half, Math.PI / 2, true]]) {
    const m = sud && coinT.length ? coinT[0] : coin || coinT[0];
    if (m) ajouter(m, x, z, rot);
    if (m && m.helice) {
      // même transformation que poser() : rotateY(rot) puis translation
      const [cx, cy, cz] = m.helice.centre;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      helices.push([x + cx * c + cz * s, cy, z - cx * s + cz * c]);
    }
  }
  return parts;
}

const cleT = (t) => (t ? [t.map, t.normalMap, t.aoMap].map((x) => (x ? x.uuid : '-')).join('|') : 'sans');

/**
 * Regroupe des pièces { geometry, textures } par jeu de textures : un maillage par groupe (profil 'decor', ombre
 * figée), attributs ramenés à ceux que toutes les pièces du groupe ont. Renvoie la liste des maillages.
 */
export function fusionnerParties(parts, nom = 'decor-peint') {
  const groupes = new Map();
  for (const p of parts) {
    const k = cleT(p.textures);
    if (!groupes.has(k)) groupes.set(k, { textures: p.textures, geos: [] });
    groupes.get(k).geos.push(p.geometry.index ? p.geometry.toNonIndexed() : p.geometry);
  }
  const out = [];
  let i = 0;
  for (const { textures, geos } of groupes.values()) {
    const communs = Object.keys(geos[0].attributes).filter((a) => geos.every((g) => g.attributes[a]));
    for (const g of geos) for (const a of Object.keys(g.attributes)) if (!communs.includes(a)) g.deleteAttribute(a);
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), createPaintedMaterial({ profil: 'decor', textures }));
    mesh.name = groupes.size > 1 ? `${nom}-${i++}` : nom;
    decorOmbre(mesh);
    mesh.matrixAutoUpdate = false;
    out.push(mesh);
  }
  return out;
}

/** Ancienne entrée (passe 2) : rochers .glb en un maillage. */
export function placerDecorGlb(modeles, obstacles, rockCount) {
  return fusionnerParties(partiesRochers(modeles, obstacles, rockCount), 'rochers-glb')[0];
}

/**
 * Charge le décor .glb : assets/modeles/decor/manifeste.json (sections rochers, falaises, carcasses ; champs fichier,
 * rayonCollision, rayonsObstacle, type, profil, largeur…). Sans manifeste : rocher-1.glb … rocher-12.glb. Renvoie
 * { rochers, falaises, carcasses } : listes de { geometry, textures, groupes, fichier, …champs du manifeste }.
 */
export async function chercherDecorGlb(charger, base = '/assets/modeles/decor/', manifeste = 'manifeste.json') {
  let man = null;
  try {
    const r = await fetch(base + manifeste);
    if (r.ok) man = await r.json();
  } catch (e) {
    man = null;
  }
  const out = { rochers: [], falaises: [], carcasses: [], helice: null };
  const familles = man ? ['rochers', 'falaises', 'carcasses'] : ['rochers'];
  for (const fam of familles) {
    let entrees = man ? man[fam] || [] : [];
    if (!man) for (let k = 1; k <= 12; k++) entrees.push({ fichier: `rocher-${k}.glb` });
    for (const e of entrees) {
      const fichier = e.fichier.split('/').pop();
      // decor-<famille>.glb : nœud de la variante ; listé par le manifeste, le fichier est chargé sans sonde HEAD
      const m = await charger(base + fichier, { noeud: e.noeud || null, sonder: !man });
      if (m) out[fam].push({ ...e, fichier, geometry: m.geometry, textures: m.textures, groupes: m.groupes, octetsTextures: m.octetsTextures });
    }
  }
  if (man && man.helice) {
    const m = await charger(base + man.helice.fichier.split('/').pop(), { noeud: null, sonder: false });
    if (m) out.helice = { ...man.helice, geometry: m.geometry, textures: m.textures };
  }
  return out;
}

// ----- Pales des ventirads des coins (carte mère) : un InstancedMesh, une instance par coin -------------------------
const mHel = new THREE.Matrix4();
const ecranHel = { x: 0, y: 0, inside: false };

/** Maillage instancié des pales aux centres `helices` (partiesFalaises). Renvoie { mesh, centres, angles, rayon }. */
export function creerHelices(modele, centres) {
  const n = centres.length;
  const mesh = new THREE.InstancedMesh(modele.geometry, createPaintedMaterial({ profil: 'decor', textures: modele.textures }), n);
  mesh.name = 'helices';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; // la visibilité est testée par hélice (tournerHelices)
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  const angles = new Float64Array(n);
  const D = PEINT.carte.helices.dephasage;
  for (let i = 0; i < n; i++) {
    angles[i] = i * D;
    mHel.makeRotationY(angles[i]).setPosition(centres[i][0], centres[i][1], centres[i][2]);
    mHel.toArray(mesh.instanceMatrix.array, i * 16);
  }
  return { mesh, centres, angles, rayon: modele.rayon || 5 };
}

/**
 * Une fois par image : seules les pales que la caméra voit (centre projeté dans l'écran élargi de leur rayon) tournent
 * et sont renvoyées à la carte graphique ; hors champ, rien n'est calculé ni envoyé. Sans allocation.
 */
export function tournerHelices(H, dt, camera) {
  if (!H || !(dt > 0)) return;
  const v = camera.view;
  const marge = H.rayon * v.pxPerMeter;
  const w = PEINT.carte.helices.vitesse;
  const arr = H.mesh.instanceMatrix.array;
  let vu = false;
  for (let i = 0; i < H.angles.length; i++) {
    const c = H.centres[i];
    camera.worldToScreen(c[0], c[1], c[2], ecranHel);
    if (ecranHel.x < -marge || ecranHel.x > v.widthPx + marge || ecranHel.y < -marge || ecranHel.y > v.heightPx + marge) continue;
    H.angles[i] += w * dt;
    mHel.makeRotationY(H.angles[i]).setPosition(c[0], c[1], c[2]);
    mHel.toArray(arr, i * 16);
    vu = true;
  }
  if (vu) H.mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Cailloux et touffes CUITS en un maillage simple (immobiles) : matrices et couleurs d'instance appliquées aux sommets.
 * Même programme que le décor non texturé (profil 'decor', non instancié) : aucun programme de plus à rendre à chaque
 * image (mesuré en passe 2 : les deux InstancedMesh coûtaient ~1 Ko alloué par image dans three, tests/rendu-alloc.mjs).
 * ~16 000 triangles, un appel de dessin. Masqué au dernier niveau de qualité.
 */
export function cuireParsemes(instanced) {
  const geos = [];
  const m = new THREE.Matrix4();
  for (const im of instanced) {
    const src = im.geometry;
    const ic = im.instanceColor.array;
    for (let k = 0; k < im.count; k++) {
      m.fromArray(im.instanceMatrix.array, k * 16);
      const g = src.index ? src.toNonIndexed() : src.clone();
      g.applyMatrix4(m);
      const c = g.attributes.color.array;
      for (let v = 0; v < c.length; v += 3) {
        c[v] *= ic[k * 3];
        c[v + 1] *= ic[k * 3 + 1];
        c[v + 2] *= ic[k * 3 + 2];
      }
      geos.push(g);
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), createPaintedMaterial({ profil: 'decor' }));
  mesh.name = 'parsemes';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Qualité : cailloux et touffes masqués au dernier niveau (deux appels de dessin et leurs sommets en moins). */
export function setQualite(q, parsemes) {
  for (let i = 0; i < parsemes.length; i++) parsemes[i].visible = q.decor;
}
