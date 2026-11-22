// MODÈLES (refonte d'après docs/references-modeles/) — atelier commun : pièces à facettes, fusion, repérage des
// pièces animables. Ne tourne qu'à l'init (aucun de ces appels n'est dans un chemin chaud, § V).
//
// Toutes les pièces passent par render.makePart (couleur de sommet linéaire + aEmissive 0/1) puis render.mergeParts :
// la sortie est EXACTEMENT celle des anciens constructeurs (géométrie non indexée, attributs position, normal, color,
// aEmissive), donc compatible avec createLitMaterial, createInstanced, makeShadowCaster et la silhouette du joueur.
//
// Formes : en plus des boîtes et cylindres de three, « bloc » = prisme convexe entre deux polygones horizontaux
// (rectangle, ou octogone si un chanfrein est donné). Il donne les arêtes biseautées des références (les reflets
// clairs des chanfreins se lisent à l'échelle du jeu) sans texture ; un bloc rectangulaire coûte autant qu'une boîte
// (12 triangles), un bloc chanfreiné 28.
import * as THREE from 'three';

/** Polygone horizontal (x, z), centré : rectangle w × d, ou octogone si c > 0 (chanfrein c sur les 4 arêtes). */
function polygone(w, d, c) {
  const x = w / 2;
  const z = d / 2;
  if (!(c > 0)) return [[x, z], [x, -z], [-x, -z], [-x, z]];
  const k = Math.min(c, x * 0.95, z * 0.95);
  return [[x, z - k], [x, -z + k], [x - k, -z], [-x + k, -z], [-x, -z + k], [-x, z - k], [-x + k, z], [x - k, z]];
}

/**
 * Prisme convexe : polygone du bas (w0 × d0, chanfrein c0) à y = 0, polygone du haut (w1 × d1, chanfrein c1) à y = h,
 * le haut décalé de (sx, sz). Les deux polygones doivent avoir le même nombre de côtés (chanfreins tous deux nuls
 * ou tous deux positifs). Faces orientées vers l'extérieur (vérifié face par face : le solide est convexe).
 */
export function blocGeometry(w0, d0, c0, w1, d1, c1, h, sx = 0, sz = 0) {
  const b = polygone(w0, d0, c0);
  const t = polygone(w1, d1, c1);
  if (b.length !== t.length) throw new Error('bloc : chanfreins incompatibles (bas et haut doivent être tous deux nuls ou positifs)');
  const n = b.length;
  const P = [];
  for (const [x, z] of b) P.push([x, 0, z]);
  for (const [x, z] of t) P.push([x + sx, h, z + sz]);
  const tris = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push([i, j, n + j], [i, n + j, n + i]); // flanc
  }
  for (let i = 1; i < n - 1; i++) {
    tris.push([0, i, i + 1]); // dessous
    tris.push([n, n + i, n + i + 1]); // dessus
  }
  // centre du solide, puis orientation : la normale de chaque face s'éloigne du centre
  const C = [0, 0, 0];
  for (const p of P) for (let k = 0; k < 3; k++) C[k] += p[k] / P.length;
  const pos = new Float32Array(tris.length * 9);
  let o = 0;
  for (const tri of tris) {
    let [a, bb, c] = tri.map((i) => P[i]);
    const u = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = u[1] * v[2] - u[2] * v[1];
    const ny = u[2] * v[0] - u[0] * v[2];
    const nz = u[0] * v[1] - u[1] * v[0];
    const g = [(a[0] + bb[0] + c[0]) / 3 - C[0], (a[1] + bb[1] + c[1]) / 3 - C[1], (a[2] + bb[2] + c[2]) / 3 - C[2]];
    if (nx * g[0] + ny * g[1] + nz * g[2] < 0) [bb, c] = [c, bb];
    for (const p of [a, bb, c]) {
      pos[o++] = p[0];
      pos[o++] = p[1];
      pos[o++] = p[2];
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Atelier : accumule les pièces d'un modèle. Chaque méthode prend la couleur (hex sRGB), la position du CENTRE de la
 * pièce et des options { em: 1 = émissif, rx, ry, rz : rotations (rad, appliquées dans l'ordre X, Y, Z avant la
 * translation), piece: { nom, genre, pivot: [x, y, z] } }. Les pièces nommées sont repérées (premier sommet, nombre
 * de sommets) dans geometry.userData.pieces : de quoi animer plus tard un membre ou un rotor par le shader
 * (docs/animations-plan.md § P6) sans rien reconstruire.
 */
export function atelier(render) {
  const parts = [];
  const pieces = [];
  let verts = 0;

  function poser(g, hex, x, y, z, opts) {
    const o = opts || {};
    if (o.rx) g.rotateX(o.rx);
    if (o.ry) g.rotateY(o.ry);
    if (o.rz) g.rotateZ(o.rz);
    g.translate(x, y, z);
    const p = render.makePart(g, hex, o.em ? 1 : 0);
    const count = p.attributes.position.count;
    if (o.piece) pieces.push({ ...o.piece, start: verts, count });
    verts += count;
    parts.push(p);
    return p;
  }

  return {
    /** Boîte w × h × d centrée en (x, y, z). */
    box(w, h, d, hex, x, y, z, opts) {
      return poser(new THREE.BoxGeometry(w, h, d), hex, x, y, z, opts);
    },
    /**
     * Bloc posé : base à y0 (et non centré), dimensions du bas (w, d) et du haut (wt, dt), chanfreins c (bas) et
     * ct (haut), décalage du haut (sx, sz). Les rotations s'appliquent autour de la base.
     */
    bloc(w, d, h, hex, x, y0, z, { wt = w, dt = d, c = 0, ct = c, sx = 0, sz = 0, ...opts } = {}) {
      return poser(blocGeometry(w, d, c, wt, dt, ct, h, sx, sz), hex, x, y0, z, opts);
    },
    /**
     * Barre w × h × d centrée en (x, y, z), chanfreinée de c sur ses 4 arêtes parallèles à X : vue de profil, un
     * octogone (chenilles, patins arrondis aux deux bouts).
     */
    barre(w, h, d, c, hex, x, y, z, opts) {
      const g = blocGeometry(h, d, c, h, d, c, w);
      g.translate(0, -w / 2, 0);
      g.rotateZ(-Math.PI / 2);
      return poser(g, hex, x, y, z, opts);
    },
    /** Cylindre (prisme à `sides` côtés) centré en (x, y, z), une face plate vers l'avant si flat. */
    cyl(rTop, rBottom, h, sides, hex, x, y, z, { open = false, flat = true, ...opts } = {}) {
      const g = new THREE.CylinderGeometry(rTop, rBottom, h, sides, 1, open);
      if (flat) g.rotateY(Math.PI / sides);
      return poser(g, hex, x, y, z, opts);
    },
    /** Disque horizontal (face vers +Y) de rayon r à `sides` côtés. */
    disc(r, sides, hex, x, y, z, opts) {
      const g = new THREE.CircleGeometry(r, sides);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.PI / sides);
      return poser(g, hex, x, y, z, opts);
    },
    /** Anneau plat horizontal (face vers +Y), rayons r0 < r1. */
    ring(r0, r1, sides, hex, x, y, z, opts) {
      const g = new THREE.RingGeometry(r0, r1, sides, 1);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.PI / sides);
      return poser(g, hex, x, y, z, opts);
    },
    /** Icosaèdre (boule à facettes) de rayon r, détail d, étiré par (ex, ey, ez). */
    ico(r, d, hex, x, y, z, { ex = 1, ey = 1, ez = 1, ...opts } = {}) {
      const g = new THREE.IcosahedronGeometry(r, d);
      g.scale(ex, ey, ez);
      return poser(g, hex, x, y, z, opts);
    },
    /** Octaèdre (losange) de rayon r, étiré par (ex, ey, ez). */
    octa(r, hex, x, y, z, { ex = 1, ey = 1, ez = 1, ...opts } = {}) {
      const g = new THREE.OctahedronGeometry(r, 0);
      g.scale(ex, ey, ez);
      return poser(g, hex, x, y, z, opts);
    },
    /** Cône à `sides` côtés, pointe en haut, centré en (x, y, z). */
    cone(r, h, sides, hex, x, y, z, opts) {
      const g = new THREE.ConeGeometry(r, h, sides, 1, true);
      return poser(g, hex, x, y, z, opts);
    },
    /** Fusionne ; les pièces repérées vont dans geometry.userData.pieces. */
    fin() {
      const g = render.mergeParts(parts);
      g.userData.pieces = pieces;
      return g;
    },
  };
}

/** Met la géométrie à l'échelle (sx, sy, sz) et recale les pivots repérés. */
export function echelle(geometry, sx, sy, sz) {
  geometry.scale(sx, sy, sz);
  for (const p of geometry.userData.pieces || []) {
    if (p.pivot) p.pivot = [p.pivot[0] * sx, p.pivot[1] * sy, p.pivot[2] * sz];
  }
  return geometry;
}

/** Hauteur du sommet le plus haut (y max) d'une géométrie. */
export function hauteur(geometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox.max.y;
}

/** Triangles d'une géométrie non indexée. */
export function triangles(geometry) {
  return geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
}

/** Assombrit une couleur hex (facteur 0..1). */
export function sombre(hex, k) {
  return new THREE.Color(hex).multiplyScalar(k).getHex();
}
