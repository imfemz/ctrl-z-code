// FONDATION : grid.js — grille spatiale des robots (tri par comptage), requêtes sans allocation
// (contrat : ARCHITECTURE.md § F). Le boss n'est dans aucune cellule : chaque requête le teste à part.
import { CAPS, ENEMY, GRID } from './config.js';
import { E } from './state.js';

const DIM = GRID.dim;
const CELLS = DIM * DIM;
const CELL = GRID.cellSize;
const INV_CELL = 1 / CELL;
const MIN = GRID.min;
const LAST = DIM - 1;
const BLOCK = GRID.densestBlock;
const BOSS = ENEMY.BOSS;

// Tableaux bruts, en lecture seule pour les autres modules (le boss n'y est jamais).
export const cellStart = new Uint16Array(CELLS);
export const cellCount = new Uint16Array(CELLS);
export const items = new Uint16Array(CAPS.enemies);

// Privé.
const cellFill = new Uint16Array(CELLS);
const itemCell = new Uint16Array(CAPS.enemies);
let itemTotal = 0;
let usedCells = 0;
// Plus grand rayon vivant (boss exclu). Dans un tableau typé : rebuild le réécrit deux fois par image, et une
// variable de module qui reçoit un flottant coûte un nombre alloué à chaque écriture (§ V).
const maxRadiusBox = new Float64Array(1);

// Tableaux de travail des requêtes (créés une fois).
const nearDist = new Float32Array(33);
const nearIdx = new Uint16Array(33);
const oneOut = new Uint16Array(1);
const segT = new Float32Array(CAPS.queryScratch);
const dCount = new Uint16Array(CELLS);
const dSumX = new Float32Array(CELLS);
const dSumZ = new Float32Array(CELLS);
const dWin = new Uint16Array(CELLS);
const dPickX = new Int16Array(8);
const dPickZ = new Int16Array(8);

export function init() {}

export function reset() {
  cellCount.fill(0);
  cellStart.fill(0);
  itemTotal = 0;
  usedCells = 0;
  maxRadiusBox[0] = 0;
}

/** (cz << 6) | cx, coordonnées bornées à la grille. */
export function cellOf(x, z) {
  let cx = Math.floor((x - MIN) * INV_CELL);
  let cz = Math.floor((z - MIN) * INV_CELL);
  if (cx < 0) cx = 0;
  else if (cx > LAST) cx = LAST;
  if (cz < 0) cz = 0;
  else if (cz > LAST) cz = LAST;
  return cz * DIM + cx;
}

/** Plus grand rayon vivant, boss exclu, à la dernière reconstruction. */
export function getMaxRadius() {
  return maxRadiusBox[0];
}

/** Tri par comptage depuis E : deux passes sur les robots, aucune allocation. Appelé par main en S4 et S7. */
export function rebuild() {
  const n = E.count;
  const X = E.x;
  const Z = E.z;
  const R = E.radius;
  const alive = E.alive;
  const type = E.type;
  cellCount.fill(0);
  let mr = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (alive[i] === 0 || type[i] === BOSS || E.sus[i] !== 0) { // § E3.K : un robot en veille n'est pas une cible
      itemCell[i] = 0xffff;
      continue;
    }
    let cx = Math.floor((X[i] - MIN) * INV_CELL);
    let cz = Math.floor((Z[i] - MIN) * INV_CELL);
    if (cx < 0) cx = 0;
    else if (cx > LAST) cx = LAST;
    if (cz < 0) cz = 0;
    else if (cz > LAST) cz = LAST;
    const c = cz * DIM + cx;
    itemCell[i] = c;
    cellCount[c]++;
    total++;
    if (R[i] > mr) mr = R[i];
  }
  let run = 0;
  let used = 0;
  for (let c = 0; c < CELLS; c++) {
    cellStart[c] = run;
    cellFill[c] = run;
    const k = cellCount[c];
    if (k !== 0) {
      run += k;
      used++;
    }
  }
  for (let i = 0; i < n; i++) {
    const c = itemCell[i];
    if (c !== 0xffff) items[cellFill[c]++] = i;
  }
  itemTotal = total;
  usedCells = used;
  maxRadiusBox[0] = mr;
}

function clampCell(v) {
  const c = Math.floor((v - MIN) * INV_CELL);
  return c < 0 ? 0 : c > LAST ? LAST : c;
}

/**
 * Indices des robots vivants dont le cercle touche le disque (x, z, r). Au plus max résultats.
 * Ordre déterministe : cellule par cellule (z puis x), puis ordre d'insertion ; le boss en dernier.
 */
export function queryCircle(x, z, r, out, max) {
  const X = E.x;
  const Z = E.z;
  const R = E.radius;
  const alive = E.alive;
  const reach = r + maxRadiusBox[0];
  const cx0 = clampCell(x - reach);
  const cx1 = clampCell(x + reach);
  const cz0 = clampCell(z - reach);
  const cz1 = clampCell(z + reach);
  let n = 0;
  for (let cz = cz0; cz <= cz1; cz++) {
    const row = cz * DIM;
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = row + cx;
      const k = cellCount[c];
      if (k === 0) continue;
      const s = cellStart[c];
      for (let q = s; q < s + k; q++) {
        const i = items[q];
        if (alive[i] === 0) continue;
        const dx = X[i] - x;
        const dz = Z[i] - z;
        const rr = r + R[i];
        if (dx * dx + dz * dz <= rr * rr) {
          if (n >= max) return n;
          out[n++] = i;
        }
      }
    }
  }
  const b = E.bossIndex;
  if (b >= 0 && alive[b] === 1 && n < max) {
    const dx = X[b] - x;
    const dz = Z[b] - z;
    const rr = r + R[b];
    if (dx * dx + dz * dz <= rr * rr) out[n++] = b;
  }
  return n;
}

/** Nombre de robots vivants dont le cercle touche le disque. */
export function countCircle(x, z, r) {
  const X = E.x;
  const Z = E.z;
  const R = E.radius;
  const alive = E.alive;
  const reach = r + maxRadiusBox[0];
  const cx0 = clampCell(x - reach);
  const cx1 = clampCell(x + reach);
  const cz0 = clampCell(z - reach);
  const cz1 = clampCell(z + reach);
  let n = 0;
  for (let cz = cz0; cz <= cz1; cz++) {
    const row = cz * DIM;
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = row + cx;
      const k = cellCount[c];
      if (k === 0) continue;
      const s = cellStart[c];
      for (let q = s; q < s + k; q++) {
        const i = items[q];
        if (alive[i] === 0) continue;
        const dx = X[i] - x;
        const dz = Z[i] - z;
        const rr = r + R[i];
        if (dx * dx + dz * dz <= rr * rr) n++;
      }
    }
  }
  const b = E.bossIndex;
  if (b >= 0 && alive[b] === 1) {
    const dx = X[b] - x;
    const dz = Z[b] - z;
    const rr = r + R[b];
    if (dx * dx + dz * dz <= rr * rr) n++;
  }
  return n;
}

/**
 * Cœur de queryNearest / queryNearestN : parcours par anneaux de cellules autour du point, arrêt dès que les
 * n meilleurs sont plus proches que tout ce que les anneaux suivants peuvent contenir. Résultat trié dans
 * nearIdx / nearDist (distance = distance des centres − rayon).
 */
function nearestInto(x, z, maxDist, n) {
  const X = E.x;
  const Z = E.z;
  const R = E.radius;
  const alive = E.alive;
  let found = 0;
  const maxRadius = maxRadiusBox[0];
  const pcx = clampCell(x);
  const pcz = clampCell(z);
  // Borné à la grille : au-delà de DIM anneaux il n'y a plus aucune cellule. Sans cette borne, une requête qui
  // trouve moins de n robots parcourait des anneaux vides jusqu'à maxDist (sans fin avec maxDist = Infinity).
  const wanted = Math.ceil((maxDist + maxRadius) * INV_CELL) + 1;
  const maxRing = wanted < DIM ? wanted : DIM;
  for (let ring = 0; ring <= maxRing; ring++) {
    // Tout robot d'un anneau ≥ ring est à au moins (ring − 1) cellules du point (le point peut être hors grille
    // ou au bord de sa cellule) : distance utile ≥ (ring − 1) × CELL − maxRadius.
    if (ring > 1) {
      const floorDist = (ring - 1) * CELL - maxRadius;
      if (floorDist > maxDist) break;
      if (found >= n && nearDist[found - 1] <= floorDist) break;
    }
    const z0 = pcz - ring;
    const z1 = pcz + ring;
    const x0 = pcx - ring;
    const x1 = pcx + ring;
    for (let cz = z0; cz <= z1; cz++) {
      if (cz < 0 || cz > LAST) continue;
      const edgeRow = cz === z0 || cz === z1;
      const row = cz * DIM;
      const step = edgeRow || ring === 0 ? 1 : x1 - x0; // lignes du milieu : seulement les deux bords
      for (let cx = x0; cx <= x1; cx += step) {
        if (cx < 0 || cx > LAST) continue;
        const c = row + cx;
        const k = cellCount[c];
        if (k === 0) continue;
        const s = cellStart[c];
        for (let q = s; q < s + k; q++) {
          const i = items[q];
          if (alive[i] === 0) continue;
          const dx = X[i] - x;
          const dz = Z[i] - z;
          const d = Math.sqrt(dx * dx + dz * dz) - R[i];
          if (d > maxDist) continue;
          if (found >= n && d >= nearDist[found - 1]) continue;
          // insertion triée
          let p = found < n ? found : n - 1;
          while (p > 0 && nearDist[p - 1] > d) {
            nearDist[p] = nearDist[p - 1];
            nearIdx[p] = nearIdx[p - 1];
            p--;
          }
          nearDist[p] = d;
          nearIdx[p] = i;
          if (found < n) found++;
        }
      }
    }
  }
  const b = E.bossIndex;
  if (b >= 0 && alive[b] === 1) {
    const dx = X[b] - x;
    const dz = Z[b] - z;
    const d = Math.sqrt(dx * dx + dz * dz) - R[b];
    if (d <= maxDist && (found < n || d < nearDist[found - 1])) {
      let p = found < n ? found : n - 1;
      while (p > 0 && nearDist[p - 1] > d) {
        nearDist[p] = nearDist[p - 1];
        nearIdx[p] = nearIdx[p - 1];
        p--;
      }
      nearDist[p] = d;
      nearIdx[p] = b;
      if (found < n) found++;
    }
  }
  return found;
}

/** Robot vivant le plus proche (distance des centres − rayon ≤ maxDist), ou −1. */
export function queryNearest(x, z, maxDist) {
  return nearestInto(x, z, maxDist, 1) === 1 ? nearIdx[0] : -1;
}

/** Les n plus proches (n ≤ 32), du plus proche au plus loin, dans out. Renvoie le nombre trouvé. */
export function queryNearestN(x, z, maxDist, out, n) {
  if (n > 32) n = 32;
  if (n > out.length) n = out.length;
  if (n <= 0) return 0;
  const found = nearestInto(x, z, maxDist, n);
  for (let k = 0; k < found; k++) out[k] = nearIdx[k];
  return found;
}

/**
 * Robots vivants dont le cercle touche le segment épaissi (halfWidth), triés du départ vers l'arrivée.
 * Au plus max résultats (les plus proches du départ sont gardés).
 */
export function querySegment(x0, z0, x1, z1, halfWidth, out, max) {
  const X = E.x;
  const Z = E.z;
  const R = E.radius;
  const alive = E.alive;
  if (max > segT.length) max = segT.length;
  const reach = halfWidth + maxRadiusBox[0];
  const cx0 = clampCell((x0 < x1 ? x0 : x1) - reach);
  const cx1 = clampCell((x0 > x1 ? x0 : x1) + reach);
  const cz0 = clampCell((z0 < z1 ? z0 : z1) - reach);
  const cz1 = clampCell((z0 > z1 ? z0 : z1) + reach);
  const sx = x1 - x0;
  const sz = z1 - z0;
  const len2 = sx * sx + sz * sz;
  const inv = len2 > 1e-12 ? 1 / len2 : 0;
  let n = 0;
  for (let cz = cz0; cz <= cz1; cz++) {
    const row = cz * DIM;
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = row + cx;
      const k = cellCount[c];
      if (k === 0) continue;
      const s = cellStart[c];
      for (let q = s; q < s + k; q++) {
        const i = items[q];
        if (alive[i] === 0) continue;
        const px = X[i] - x0;
        const pz = Z[i] - z0;
        let t = (px * sx + pz * sz) * inv;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const dx = px - sx * t;
        const dz = pz - sz * t;
        const rr = halfWidth + R[i];
        if (dx * dx + dz * dz > rr * rr) continue;
        if (n >= max && t >= segT[n - 1]) continue;
        let p = n < max ? n : max - 1;
        while (p > 0 && segT[p - 1] > t) {
          segT[p] = segT[p - 1];
          out[p] = out[p - 1];
          p--;
        }
        segT[p] = t;
        out[p] = i;
        if (n < max) n++;
      }
    }
  }
  const b = E.bossIndex;
  if (b >= 0 && alive[b] === 1) {
    const px = X[b] - x0;
    const pz = Z[b] - z0;
    let t = (px * sx + pz * sz) * inv;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = px - sx * t;
    const dz = pz - sz * t;
    const rr = halfWidth + R[b];
    if (dx * dx + dz * dz <= rr * rr && (n < max || t < segT[n - 1])) {
      let p = n < max ? n : max - 1;
      while (p > 0 && segT[p - 1] > t) {
        segT[p] = segT[p - 1];
        out[p] = out[p - 1];
        p--;
      }
      segT[p] = t;
      out[p] = b;
      if (n < max) n++;
    }
  }
  return n;
}

/**
 * Les k blocs de BLOCK × BLOCK cellules les plus peuplés dont le barycentre est à moins de range de (x, z),
 * du plus peuplé au moins peuplé, sans chevauchement. Barycentres écrits dans outXZ (x0, z0, x1, z1…). k ≤ 8.
 */
export function findDensest(x, z, range, outXZ, k) {
  const X = E.x;
  const Z = E.z;
  const alive = E.alive;
  if (k > 8) k = 8;
  if (k * 2 > outXZ.length) k = outXZ.length >> 1;
  if (k <= 0) return 0;
  const half = BLOCK >> 1; // fenêtre centrée : [c − half, c + half]
  const reach = range + CELL * BLOCK;
  const cx0 = clampCell(x - reach);
  const cx1 = clampCell(x + reach);
  const cz0 = clampCell(z - reach);
  const cz1 = clampCell(z + reach);
  // 1. vivants et sommes de positions par cellule, dans la région
  for (let cz = cz0; cz <= cz1; cz++) {
    const row = cz * DIM;
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = row + cx;
      let cnt = 0;
      let sxs = 0;
      let szs = 0;
      const kk = cellCount[c];
      const s = cellStart[c];
      for (let q = s; q < s + kk; q++) {
        const i = items[q];
        if (alive[i] === 0) continue;
        cnt++;
        sxs += X[i];
        szs += Z[i];
      }
      dCount[c] = cnt;
      dSumX[c] = sxs;
      dSumZ[c] = szs;
    }
  }
  const b = E.bossIndex;
  if (b >= 0 && alive[b] === 1) {
    const bcx = clampCell(X[b]);
    const bcz = clampCell(Z[b]);
    if (bcx >= cx0 && bcx <= cx1 && bcz >= cz0 && bcz <= cz1) {
      const c = bcz * DIM + bcx;
      dCount[c]++;
      dSumX[c] += X[b];
      dSumZ[c] += Z[b];
    }
  }
  // 2. effectif de chaque fenêtre dont le barycentre est à portée
  const range2 = range * range;
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      let cnt = 0;
      let sxs = 0;
      let szs = 0;
      for (let wz = cz - half; wz <= cz + half; wz++) {
        if (wz < cz0 || wz > cz1) continue;
        const row = wz * DIM;
        for (let wx = cx - half; wx <= cx + half; wx++) {
          if (wx < cx0 || wx > cx1) continue;
          const c = row + wx;
          cnt += dCount[c];
          sxs += dSumX[c];
          szs += dSumZ[c];
        }
      }
      let keep = 0;
      if (cnt > 0) {
        const bx = sxs / cnt - x;
        const bz = szs / cnt - z;
        if (bx * bx + bz * bz <= range2) keep = cnt;
      }
      dWin[cz * DIM + cx] = keep;
    }
  }
  // 3. les k meilleures fenêtres, sans chevauchement (gloutonne ; à égalité, la première en z puis x)
  let found = 0;
  while (found < k) {
    let best = 0;
    let bcx = -1;
    let bcz = -1;
    for (let cz = cz0; cz <= cz1; cz++) {
      const row = cz * DIM;
      for (let cx = cx0; cx <= cx1; cx++) {
        const w = dWin[row + cx];
        if (w <= best) continue;
        let free = true;
        for (let p = 0; p < found; p++) {
          const ddx = cx - dPickX[p];
          const ddz = cz - dPickZ[p];
          if (ddx < BLOCK && ddx > -BLOCK && ddz < BLOCK && ddz > -BLOCK) {
            free = false;
            break;
          }
        }
        if (free) {
          best = w;
          bcx = cx;
          bcz = cz;
        }
      }
    }
    if (best === 0) break;
    dPickX[found] = bcx;
    dPickZ[found] = bcz;
    let cnt = 0;
    let sxs = 0;
    let szs = 0;
    for (let wz = bcz - half; wz <= bcz + half; wz++) {
      if (wz < cz0 || wz > cz1) continue;
      const row = wz * DIM;
      for (let wx = bcx - half; wx <= bcx + half; wx++) {
        if (wx < cx0 || wx > cx1) continue;
        const c = row + wx;
        cnt += dCount[c];
        sxs += dSumX[c];
        szs += dSumZ[c];
      }
    }
    outXZ[found * 2] = sxs / cnt;
    outXZ[found * 2 + 1] = szs / cnt;
    found++;
  }
  return found;
}

export function inspect(out) {
  out.cells = usedCells;
  out.items = itemTotal;
  out.maxRadius = maxRadiusBox[0];
}
