// PROFIL DU CORPS pour les tissus (cape de l'Éclaireur, tissus du Shinobi) — retour de Femz du 22/11 : « y'a toujours de
// l'écart entre les capes et les modèles 3D ». Les volumes de collision du torse (cylindre du dos, capsule du bassin,
// plan plat derrière le dos) gardaient le tissu à 10 cm de la taille et à 4–5 cm des hanches : un cylindre ne suit pas
// un dos qui se creuse. Ici, le VRAI contour du torse, relevé une fois sur la pièce « corps » du .glb (repère du modèle) :
// une grille x × y (pas de 2 cm) donne, pour chaque case, le z du sommet le plus en arrière (profil du DOS) ou le plus en
// avant (profil du DEVANT). Rangée par rangée : trous comblés par interpolation, bords prolongés sur les côtés (au-delà
// de la silhouette, le profil se comporte comme le plan d'avant : un tissu qui passe sur le côté ne revient pas devant
// le corps), puis lissage léger (bruit d'échantillonnage des sommets). Rangées sans sommet : NaN (pas de contrainte),
// sauf si la lecture demande de prolonger vers le haut et le bas (tissus portés derrière le corps).
// Lecture : zProfil(pf, x, y, prolonger) → z (m, repère du modèle) ou NaN. Aucune allocation à la lecture.

const PAS = 0.02;
const X0 = -0.4;
const X1 = 0.4;
const Y0 = 0.5;
const Y1 = 1.95;
const cache = new WeakMap(); // géométrie → { 'pièces' : { dos, devant } }

function construire(pos, piece, garder, cote) {
  const nx = Math.round((X1 - X0) / PAS) + 1;
  const ny = Math.round((Y1 - Y0) / PAS) + 1;
  const z = new Float32Array(nx * ny).fill(NaN);
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    if (garder[piece[i]] !== 1) continue;
    const ix = Math.round((pos[i * 3] - X0) / PAS);
    const iy = Math.round((pos[i * 3 + 1] - Y0) / PAS);
    if (ix < 0 || ix >= nx || iy < 0 || iy >= ny) continue;
    const k = iy * nx + ix;
    const v = pos[i * 3 + 2];
    if (Number.isNaN(z[k]) || (cote < 0 ? v < z[k] : v > z[k])) z[k] = v;
  }
  let yMin = -1;
  let yMax = -1;
  for (let iy = 0; iy < ny; iy++) {
    const o = iy * nx;
    let premier = -1;
    let dernier = -1;
    for (let ix = 0; ix < nx; ix++)
      if (!Number.isNaN(z[o + ix])) {
        if (premier < 0) premier = ix;
        dernier = ix;
      }
    if (premier < 0) continue;
    if (yMin < 0) yMin = iy;
    yMax = iy;
    // trous : interpolation linéaire entre deux cases connues
    let a = premier;
    for (let ix = premier + 1; ix <= dernier; ix++) {
      if (Number.isNaN(z[o + ix])) continue;
      for (let j = a + 1; j < ix; j++) z[o + j] = z[o + a] + ((z[o + ix] - z[o + a]) * (j - a)) / (ix - a);
      a = ix;
    }
    // côtés : bords prolongés
    for (let ix = 0; ix < premier; ix++) z[o + ix] = z[o + premier];
    for (let ix = dernier + 1; ix < nx; ix++) z[o + ix] = z[o + dernier];
  }
  // rangées vides ENTRE deux rangées connues : interpolées (la grille reste continue de yMin à yMax)
  for (let iy = yMin + 1; iy < yMax; iy++) {
    if (!Number.isNaN(z[iy * nx])) continue;
    let b = iy + 1;
    while (Number.isNaN(z[b * nx])) b++;
    const a = iy - 1;
    for (let ix = 0; ix < nx; ix++) z[iy * nx + ix] = z[a * nx + ix] + ((z[b * nx + ix] - z[a * nx + ix]) * (iy - a)) / (b - a);
  }
  // lissage 3 × 3 (bruit des sommets), du côté du corps : on garde le plus extérieur de la case et de la moyenne
  if (yMin >= 0) {
    const l = new Float32Array(z);
    for (let iy = yMin; iy <= yMax; iy++)
      for (let ix = 0; ix < nx; ix++) {
        let s = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const y = iy + dy;
            const x = ix + dx;
            if (y < yMin || y > yMax || x < 0 || x >= nx) continue;
            s += l[y * nx + x];
            c++;
          }
        const m = s / c;
        const k = iy * nx + ix;
        z[k] = cote < 0 ? Math.min(l[k], m) : Math.max(l[k], m);
      }
  }
  return { nx, ny, z, yMin, yMax };
}

/**
 * Profils du dos et du devant des pièces `noms` (par défaut le torse seul, « corps » ; géométrie fusionnée de pieces.js,
 * attribut `piece`, repère du modèle). null si la géométrie n'a pas de pièce « corps ». Calculé une fois par géométrie.
 */
export function profilsCorps(donnees, noms = ['corps']) {
  if (!donnees || !donnees.geometry || !donnees.pieces) return null;
  const g = donnees.geometry;
  let parG = cache.get(g);
  if (parG === undefined) cache.set(g, (parG = {}));
  const cle = noms.join(',');
  if (parG[cle] !== undefined) return parG[cle];
  const garder = new Uint8Array(donnees.pieces.length);
  donnees.pieces.forEach((p, i) => (garder[i] = noms.includes(p.nom) ? 1 : 0));
  const pa = g.attributes.piece;
  let r = null;
  if (donnees.pieces.some((p) => p.nom === 'corps') && pa) {
    const pos = g.attributes.position.array;
    const piece = pa.array;
    const dos = construire(pos, piece, garder, -1);
    const devant = construire(pos, piece, garder, 1);
    r = dos.yMin >= 0 ? { dos, devant } : null;
  }
  parG[cle] = r;
  return r;
}

/**
 * ENVELOPPE du profil à la maille d'un tissu : chaque case prend le z le plus extérieur des cases à moins de rx (côtés)
 * et ry (hauteur). Le tissu n'est retenu qu'en ses particules ; entre deux, ses triangles sont plats : sur une bosse plus
 * étroite que la maille (omoplates), un profil exact laisse les triangles couper le corps. Mêmes champs que le profil.
 */
export function envelopper(pf, rx, ry, cote) {
  const cle = rx + ':' + ry;
  pf.env = pf.env || {};
  if (pf.env[cle]) return pf.env[cle];
  const nx = pf.nx;
  const kx = Math.round(rx / PAS);
  const ky = Math.round(ry / PAS);
  const z = new Float32Array(pf.z);
  for (let iy = pf.yMin; iy <= pf.yMax; iy++)
    for (let ix = 0; ix < nx; ix++) {
      let m = pf.z[iy * nx + ix];
      for (let dy = -ky; dy <= ky; dy++) {
        const y = iy + dy;
        if (y < pf.yMin || y > pf.yMax) continue;
        for (let dx = -kx; dx <= kx; dx++) {
          const x = ix + dx;
          if (x < 0 || x >= nx) continue;
          const v = pf.z[y * nx + x];
          if (cote < 0 ? v < m : v > m) m = v;
        }
      }
      z[iy * nx + ix] = m;
    }
  const r = { nx, ny: pf.ny, z, yMin: pf.yMin, yMax: pf.yMax };
  pf.env[cle] = r;
  return r;
}

/**
 * z du profil en (x, y) (m, repère du modèle), interpolé ; NaN hors des rangées connues, sauf si `prolonger` (alors la
 * rangée du haut ou du bas la plus proche). Côtés : toujours prolongés.
 */
export function zProfil(pf, x, y, prolonger) {
  let fy = (y - Y0) / PAS;
  if (fy < pf.yMin) {
    if (!prolonger) return NaN;
    fy = pf.yMin;
  } else if (fy > pf.yMax) {
    if (!prolonger) return NaN;
    fy = pf.yMax;
  }
  let fx = (x - X0) / PAS;
  fx = fx < 0 ? 0 : fx > pf.nx - 1 ? pf.nx - 1 : fx;
  const ix = Math.min(pf.nx - 2, Math.floor(fx));
  const iy = Math.min(pf.yMax - 1 < pf.yMin ? pf.yMin : pf.yMax - 1, Math.floor(fy));
  const tx = fx - ix;
  const ty = pf.yMax > pf.yMin ? fy - iy : 0;
  const z = pf.z;
  const nx = pf.nx;
  const a = z[iy * nx + ix] + (z[iy * nx + ix + 1] - z[iy * nx + ix]) * tx;
  if (ty === 0) return a;
  const b = z[(iy + 1) * nx + ix] + (z[(iy + 1) * nx + ix + 1] - z[(iy + 1) * nx + ix]) * tx;
  return a + (b - a) * ty;
}
