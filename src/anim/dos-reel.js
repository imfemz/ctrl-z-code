// SURFACE DU DOS RÉEL (plan « skins des agents », tâche 2, 22/11/2026) — Femz : « les capes flottent trop loin du corps ».
// Cause mesurée (tests/skins-cape-ecart.mjs, rapport de la tâche 2) : au repos, la cape de l'Éclaireur était plaquée sur
// un PLAN plat (z = arrière de la capsule cape_dos − marge, −0,166 m) alors que le vrai dos est creusé (−0,18 m aux
// omoplates, −0,06 m à la taille) ; les tissus du Shinobi reposaient sur des capsules (bassin, cape_dos) et des plans
// 2 à 6 cm derrière le vrai maillage. La cape et les tissus reposent désormais sur le DOS RÉEL du modèle posé :
//   - surfaceDos(geometry, pieces) : enveloppe arrière du corps (z le plus en arrière à chaque (x, y) du repère du
//     modèle, +Z = l'avant), tramée sur une grille fixe GRILLE depuis les triangles du torse (pièce `corps`) et des
//     jambes au repos (jambe_*, tibia_*) ; élargie d'une case (aucune bosse plus fine qu'une case ne passe entre deux
//     échantillons) ; trous bouchés en ligne, côtés prolongés (bord du corps), rangées vides recopiées. Calculée UNE fois
//     par géométrie (cache) : init des modules seulement, jamais par image.
//   - hauteurDos(S, Q) : z de la surface en (Q[0], Q[1]), le plus en arrière des trois points y − Q[3], y, y + Q[3]
//     (Q[3] = demi-écart entre deux rangées du tissu : le segment jusqu'à la rangée voisine ne coupe pas une bosse),
//     interpolation bilinéaire, résultat dans Q[2]. Aucun flottant passé en argument (§ V : tableaux typés).
//   - demiLargeurCorps(S, y) : demi-largeur du torse à la hauteur y (cape resserrée à la taille, retour de Femz, porte 1).
//   - profilBras(…) : rayon réel des bras le long de leur capsule (la cape ne s'arrête plus 6 cm avant le bras).
//   - TÊTE et DEVANT (fix de la fusion de 0.5.13, 22/11) : la surface de la cape compte aussi la tête (arrière du
//     casque) ; surfaceDos(…, 'libres', 'devant') = enveloppe AVANT du torse et de la tête pour le pan devant du
//     Shinobi, rangée en −z (même grille, même hauteurDos : le « plus en arrière » de −z est le plus en avant du corps).
//     Le pan devant y retrouve le plaquage que profil-corps (main b010a50) lui donnait : accroches posées sur le ventre,
//     jamais dans le torse.
// Les bras (qui bougent sur leurs os) restent des capsules en monde dans cape.js / tissus.js.

/** Grille : x de X0 à X0 + (NX − 1) × DX, y de Y0 à Y0 + (NY − 1) × DY (m, repère du modèle). */
export const GRILLE = { x0: -0.4, dx: 0.02, nx: 41, y0: 0.0, dy: 0.025, ny: 77 };
const X0 = GRILLE.x0;
const DX = GRILLE.dx;
const NXG = GRILLE.nx;
const Y0 = GRILLE.y0;
const DY = GRILLE.dy;
const NYG = GRILLE.ny;
const NSURF = NXG * NYG; // la surface ; suivie de NYG demi-largeurs du torse (demiLargeurCorps)
/** Valeur d'une case « libre » (jambes libres) : 1 m devant, aucune contrainte. */
export const LIBRE = 1;

const caches = { fixes: new WeakMap(), libres: new WeakMap(), 'fixes-devant': new WeakMap(), 'libres-devant': new WeakMap() };

/** Tramage de l'enveloppe arrière des triangles des pièces retenues (ok[piece]) dans S (NX × NY, z le plus en arrière). */
function tramer(S, pos, piece, idx, nT, ok) {
  for (let t = 0; t < nT; t++) {
    const a = idx ? idx[t * 3] : t * 3;
    const b = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    if (!ok[piece[a]] || piece[b] !== piece[a] || piece[c] !== piece[a]) continue;
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
      const ix = Math.round((x - X0) / DX);
      const iy = Math.round((y - Y0) / DY);
      if (ix >= 0 && ix < NXG && iy >= 0 && iy < NYG && z < S[iy * NXG + ix]) S[iy * NXG + ix] = z;
    }
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - X0) / DX));
    const i1 = Math.min(NXG - 1, Math.floor((Math.max(ax, bx, cx) - X0) / DX));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - Y0) / DY));
    const j1 = Math.min(NYG - 1, Math.floor((Math.max(ay, by, cy) - Y0) / DY));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = X0 + i * DX;
        const y = Y0 + j * DY;
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
        const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const z = l1 * az + l2 * bz + l3 * cz;
        if (z < S[j * NXG + i]) S[j * NXG + i] = z;
      }
  }
}

/** Le plus en arrière des 3 × 3 voisines (entre deux centres, la surface n'est jamais devant). */
function elargir(S) {
  const E = new Float32Array(NSURF);
  for (let j = 0; j < NYG; j++)
    for (let i = 0; i < NXG; i++) {
      let m = Infinity;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const jj = j + dj;
          const ii = i + di;
          if (jj >= 0 && jj < NYG && ii >= 0 && ii < NXG && S[jj * NXG + ii] < m) m = S[jj * NXG + ii];
        }
      E[j * NXG + i] = m;
    }
  return E;
}

/**
 * Enveloppe arrière du corps (Float32Array : NX × NY cases, indice iy × NX + ix, z en m, repère du modèle ; puis NY
 * demi-largeurs du torse, voir demiLargeurCorps) ou null si le modèle n'a pas de pièce `corps`. geometry : BufferGeometry
 * du héros (attributs position et piece, indexée ou non) ; pieces : [{ nom }] dans l'ordre des indices de l'attribut piece.
 * jambes :
 *   - 'fixes' (cape) : torse et jambes au repos du modèle, comme un seul corps ;
 *   - 'libres' (tissus du Shinobi, revue du 22/11) : les cases où il n'y a QUE des jambes sont LIBRES (aucune contrainte :
 *     les capsules des cuisses et des tibias, qui suivent la pose, les tiennent) — l'idle pose les cuisses plus en
 *     avant que le modèle au repos, des jambes figées retenaient le pan du dos derrière elles ; les rangées sans torse
 *     sont libres en entier (entre les jambes, tissus.js borne le tissu à l'arrière des jambes dans la pose courante).
 * cote :
 *   - 'dos' : enveloppe arrière (z le plus en arrière) ;
 *   - 'devant' (pan devant du Shinobi) : enveloppe AVANT rangée en −z (case = −z le plus en avant). hauteurDos la lit
 *     telle quelle et rend −z du devant du corps ; LIBRE (1) reste « aucune contrainte ».
 */
export function surfaceDos(geometry, pieces, jambes = 'fixes', cote = 'dos') {
  if (!geometry || !pieces) return null;
  const cache = caches[(jambes === 'libres' ? 'libres' : 'fixes') + (cote === 'devant' ? '-devant' : '')];
  const deja = cache.get(geometry);
  if (deja !== undefined) return deja;
  let pos = geometry.attributes.position.array;
  if (cote === 'devant') {
    pos = Float32Array.from(pos); // copie (init seulement) : z retourné, l'avant devient l'arrière
    for (let i = 2; i < pos.length; i += 3) pos[i] = -pos[i];
  }
  const piece = geometry.attributes.piece ? geometry.attributes.piece.array : null;
  if (!piece || !pieces.some((p) => p.nom === 'corps')) {
    cache.set(geometry, null);
    return null;
  }
  const idx = geometry.index ? geometry.index.array : null;
  const nT = idx ? idx.length / 3 : pos.length / 9;
  // 1. tramage : torse (corps) et jambes à part
  const SC = new Float32Array(NSURF).fill(Infinity);
  const SL = new Float32Array(NSURF).fill(Infinity);
  // la TÊTE aussi pour la cape (jambes fixes, dos) et le pan devant (devant) — fix de la fusion, 22/11 :
  //   - cape : au-dessus des épaules, la surface est l'arrière du casque, pas la dernière rangée du torse recopiée ; la
  //     cape qui remonte juste après un arrêt ne passe plus sous le casque (profil-corps de main relevait déjà « corps » +
  //     « tete » pour la cape) ;
  //   - pan devant : relevé en course jusqu'au visage, il passait dans la tête (7 à 17 points, 2,8 cm).
  // Pas pour le pan du dos et l'écharpe (jambes libres, dos) : l'écharpe passe sous la capuche, c'est voulu.
  const tete = cote === 'devant' || jambes !== 'libres';
  tramer(SC, pos, piece, idx, nT, pieces.map((p) => p.nom === 'corps' || (tete && p.nom === 'tete')));
  tramer(SL, pos, piece, idx, nT, pieces.map((p) => /^(jambe_[gd]|tibia_[gd])$/.test(p.nom)));
  // 2. élargies d'une case, puis réunies (le torse prime)
  const EC = elargir(SC);
  const EL = elargir(SL);
  const E = new Float32Array(NSURF + NYG);
  for (let i = 0; i < NSURF; i++) E[i] = EC[i] < Infinity ? EC[i] : EL[i] < EC[i] ? EL[i] : EC[i];
  // 3. trous d'une rangée bouchés (interpolation), côtés prolongés depuis le bord du corps ; rangées vides recopiées
  const pleine = new Uint8Array(NYG);
  for (let j = 0; j < NYG; j++) {
    const o = j * NXG;
    let premier = -1;
    let dernier = -1;
    for (let i = 0; i < NXG; i++)
      if (E[o + i] < Infinity) {
        if (premier < 0) premier = i;
        dernier = i;
      }
    if (premier < 0) continue;
    pleine[j] = 1;
    for (let i = 0; i < premier; i++) E[o + i] = E[o + premier];
    for (let i = dernier + 1; i < NXG; i++) E[o + i] = E[o + dernier];
    let g = premier;
    for (let i = premier + 1; i <= dernier; i++) {
      if (E[o + i] === Infinity) continue;
      for (let k = g + 1; k < i; k++) E[o + k] = E[o + g] + ((E[o + i] - E[o + g]) * (k - g)) / (i - g);
      g = i;
    }
  }
  if (!pleine.some((v) => v === 1)) {
    cache.set(geometry, null);
    return null;
  }
  for (let j = 0; j < NYG; j++) {
    if (pleine[j]) continue;
    let k = 1;
    while (true) {
      if (j - k >= 0 && pleine[j - k]) {
        E.copyWithin(j * NXG, (j - k) * NXG, (j - k + 1) * NXG);
        break;
      }
      if (j + k < NYG && pleine[j + k]) {
        E.copyWithin(j * NXG, (j + k) * NXG, (j + k + 1) * NXG);
        break;
      }
      k++;
    }
  }
  // 4. jambes libres : les cases couvertes par une jambe (tramage brut) et pas par le torse ne retiennent rien
  //    et les rangées sans torse (sous l'entrejambe) entières : là, le tissu de dos s'arrête sur les capsules des jambes et,
  //    entre elles, sur leur arrière dans la pose courante (tissus.entreJambes)
  if (jambes === 'libres')
    for (let j = 0; j < NYG; j++) {
      let torse = false;
      for (let i = 0; i < NXG; i++) if (EC[j * NXG + i] < Infinity) torse = true;
      for (let i = 0; i < NXG; i++) {
        const q = j * NXG + i;
        if (!torse || (SL[q] < Infinity && EC[q] === Infinity)) E[q] = LIBRE;
      }
    }
  // 5. demi-largeur du torse par rangée (sommets de `corps`, |x| le plus grand ; 0 sans torse à cette hauteur)
  const ic = pieces.findIndex((p) => p.nom === 'corps');
  for (let v = 0; v < piece.length; v++) {
    if (piece[v] !== ic) continue;
    const j = Math.round((pos[v * 3 + 1] - Y0) / DY);
    const ax = Math.abs(pos[v * 3]);
    if (j >= 0 && j < NYG && ax > E[NSURF + j]) E[NSURF + j] = ax;
  }
  // jamais moins que l'écart des hanches (pivot de la cuisse) : l'entrejambe du torse ne pince pas la cape
  const jg = pieces.find((p) => p.nom === 'jambe_g');
  const hanche = jg ? Math.abs(jg.pivot[0]) : 0;
  for (let j = 0; j < NYG; j++) if (E[NSURF + j] > 0 && E[NSURF + j] < hanche) E[NSURF + j] = hanche;
  cache.set(geometry, E);
  return E;
}

/** Demi-largeur du torse (m, au moins l'écart des hanches) à la hauteur y (rangée de grille la plus proche) ; 0 sans torse. Init seulement. */
export function demiLargeurCorps(S, y) {
  const j = Math.round((y - Y0) / DY);
  return j >= 0 && j < NYG ? S[NSURF + j] : 0;
}

/**
 * Rayon RÉEL des pièces `noms` autour de l'axe A → B (repère du modèle, au repos) : pour nb tranches régulières de
 * t ∈ [0, 1], le 90e centile de la distance à l'axe de leurs sommets (au-delà des bouts : tranche du bout, distance au
 * bout). arriere : seulement les sommets du côté ARRIÈRE de l'axe (rayon tourné vers −z à plus de 60°) — le rayon du dos de
 * la pièce, celui que rencontre un tissu porté derrière (une cuisse est plus large que profonde). Float32Array(nb). Init seulement.
 */
function rayonsAxe(geometry, ids, A, B, nb, arriere = false) {
  const bx = B[0] - A[0], by = B[1] - A[1], bz = B[2] - A[2];
  const bb = bx * bx + by * by + bz * bz || 1;
  const pos = geometry.attributes.position.array;
  const piece = geometry.attributes.piece.array;
  const tr = Array.from({ length: nb }, () => []);
  for (let v = 0; v < piece.length; v++) {
    if (!ids.includes(piece[v])) continue;
    const px = pos[v * 3] - A[0], py = pos[v * 3 + 1] - A[1], pz = pos[v * 3 + 2] - A[2];
    let t = (px * bx + py * by + pz * bz) / bb;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const rz = pz - bz * t;
    const rl = Math.hypot(px - bx * t, py - by * t, rz);
    if (arriere && !(rz < -0.5 * rl)) continue;
    tr[Math.min(nb - 1, Math.floor(t * nb))].push(rl);
  }
  const out = new Float32Array(nb);
  for (let k = 0; k < nb; k++) {
    const r = tr[k].sort((x, y) => x - y);
    out[k] = r.length ? r[Math.floor(0.9 * (r.length - 1))] : 0;
  }
  for (let k = 0; k < nb; k++) if (out[k] === 0) out[k] = out[k > 0 ? k - 1 : k + 1] || 0.05; // tranche vide : la voisine
  return out;
}

/**
 * Profil du rayon RÉEL d'un bras le long de sa capsule (revue du 22/11 : la capsule de 0,10 m + marge 0,025 faisait deux
 * fois le bras) : axe du repos = pivot de `nomBras` − 5 cm en y (comme heros-anim) → pivot de `nomAvantBras` + mainLocal,
 * pièces bras et avant-bras. Float32Array(NB_BRAS) ou null si les pièces manquent. Init seulement.
 */
export const NB_BRAS = 6;
export function profilBras(geometry, pieces, nomBras, nomAvantBras, mainLocal) {
  const ib = pieces.findIndex((p) => p.nom === nomBras);
  const ia = pieces.findIndex((p) => p.nom === nomAvantBras);
  if (!geometry || ib < 0 || ia < 0 || !geometry.attributes.piece) return null;
  const pb = pieces[ib].pivot;
  const pa = pieces[ia].pivot;
  return rayonsAxe(geometry, [ib, ia], [pb[0], pb[1] - 0.05, pb[2]], [pa[0] + mainLocal[0], pa[1] + mainLocal[1], pa[2] + mainLocal[2]], NB_BRAS);
}

/**
 * Profil du rayon RÉEL d'une jambe, côté ARRIÈRE (là où passe la cape), le long de la capsule de la cape (heros-anim :
 * pivot de jambe_<cote> → pivot de pied_<cote> + piedLocal ; pièces jambe et tibia) : la capsule de 0,11 m + marge
 * tenait le bas de la cape ~8 cm derrière les jambes. Float32Array(NB_BRAS) ou null. Init seulement.
 */
export function profilJambe(geometry, pieces, cote, piedLocal) {
  const ij = pieces.findIndex((p) => p.nom === 'jambe_' + cote);
  const it = pieces.findIndex((p) => p.nom === 'tibia_' + cote);
  const ip = pieces.findIndex((p) => p.nom === 'pied_' + cote);
  if (!geometry || ij < 0 || it < 0 || ip < 0 || !geometry.attributes.piece) return null;
  const f = pieces[ip].pivot;
  return rayonsAxe(geometry, [ij, it], pieces[ij].pivot, [f[0] + piedLocal[0], f[1] + piedLocal[1], f[2] + piedLocal[2]], NB_BRAS, true);
}

/**
 * Rayons RÉELS des jambes (revue du 22/11), côté arrière, pour les capsules des tissus de dos : [cuisse g, cuisse d,
 * tibia g, tibia d] (m) —
 * cuisse = pièce jambe_* autour de hanche → genou (pivots), tibia = pièce tibia_* autour de genou → pivot du pied +
 * piedLocal (le bout de la capsule de heros-anim). Float32Array(4) ou null si une pièce manque. Init seulement.
 */
export function rayonsJambes(geometry, pieces, piedLocal) {
  if (!geometry || !geometry.attributes.piece) return null;
  const out = new Float32Array(4);
  for (let s = 0; s < 2; s++) {
    const c = s === 0 ? 'g' : 'd';
    const ij = pieces.findIndex((p) => p.nom === 'jambe_' + c);
    const it = pieces.findIndex((p) => p.nom === 'tibia_' + c);
    const ip = pieces.findIndex((p) => p.nom === 'pied_' + c);
    if (ij < 0 || it < 0 || ip < 0) return null;
    const h = pieces[ij].pivot;
    const g = pieces[it].pivot;
    const f = pieces[ip].pivot;
    out[s] = rayonsAxe(geometry, [ij], h, g, 1, true)[0];
    out[2 + s] = rayonsAxe(geometry, [it], g, [f[0] + piedLocal[0], f[1] + piedLocal[1], f[2] + piedLocal[2]], 1, true)[0];
  }
  return out;
}

const LX = NXG - 1.000001;
const LY = NYG - 1.000001;
/**
 * Q[2] = z de la surface S en (Q[0], Q[1]) : le plus en arrière de y − Q[3], y, y + Q[3] ; bilinéaire, bornée à la
 * grille. Bornes sans branche ((|f| − |f − L| + L) / 2) et minimum écrit dans Q : aucune valeur à deux origines (§ V).
 */
export function hauteurDos(S, Q) {
  let fx = (Q[0] - X0) / DX;
  fx = (Math.abs(fx) - Math.abs(fx - LX) + LX) * 0.5;
  const i = Math.floor(fx);
  const u = fx - i;
  Q[2] = 1e9;
  for (let s = -1; s <= 1; s++) {
    let fy = (Q[1] + s * Q[3] - Y0) / DY;
    fy = (Math.abs(fy) - Math.abs(fy - LY) + LY) * 0.5;
    const j = Math.floor(fy);
    const v = fy - j;
    const o = j * NXG + i;
    const z = (S[o] * (1 - u) + S[o + 1] * u) * (1 - v) + (S[o + NXG] * (1 - u) + S[o + NXG + 1] * u) * v;
    if (z < Q[2]) Q[2] = z;
  }
}

const cachesKatana = new WeakMap();
/**
 * Capsule du katana porté dans le dos, relue sur le maillage (pièce `arme_katana`, repère du modèle) : axe principal des
 * sommets (puissance de la covariance), bouts = centres des 8 % de sommets les plus bas et les plus hauts le long de
 * l'axe, rayon = 90e centile de la distance des sommets à l'axe (fourreau + garde, sans la pointe des cas extrêmes ; la
 * marge des tissus s'y ajoute à la collision). Renvoie { a, b, rayon } ou null sans pièce (repli : TISSUS.katana).
 * Calculée UNE fois par géométrie (init seulement, jamais par image).
 */
export function axeKatana(geometry, pieces) {
  if (!geometry || !pieces) return null;
  if (cachesKatana.has(geometry)) return cachesKatana.get(geometry);
  let res = null;
  const ip = pieces.findIndex((p) => p.nom === 'arme_katana');
  const att = geometry.attributes;
  if (ip >= 0 && att.piece) {
    const pos = att.position.array;
    const pc = att.piece.array;
    const idx = [];
    for (let i = 0; i < pc.length; i++) if (pc[i] === ip) idx.push(i * 3);
    if (idx.length >= 12) {
      const n = idx.length;
      const m = [0, 0, 0];
      for (const o of idx) for (let k = 0; k < 3; k++) m[k] += pos[o + k] / n;
      const C = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz
      for (const o of idx) {
        const x = pos[o] - m[0], y = pos[o + 1] - m[1], z = pos[o + 2] - m[2];
        C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z;
      }
      let u = [0.4, 1, 0.1];
      for (let it = 0; it < 60; it++) {
        const v = [C[0] * u[0] + C[1] * u[1] + C[2] * u[2], C[1] * u[0] + C[3] * u[1] + C[4] * u[2], C[2] * u[0] + C[4] * u[1] + C[5] * u[2]];
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        u = [v[0] / l, v[1] / l, v[2] / l];
      }
      if (u[1] < 0) u = [-u[0], -u[1], -u[2]];
      const ts = idx.map((o) => (pos[o] - m[0]) * u[0] + (pos[o + 1] - m[1]) * u[1] + (pos[o + 2] - m[2]) * u[2]);
      const ordre = ts.map((t, i) => i).sort((p, q) => ts[p] - ts[q]);
      const nb = Math.max(1, Math.floor(n * 0.08));
      const centre = (liste) => {
        const c = [0, 0, 0];
        for (const i of liste) for (let k = 0; k < 3; k++) c[k] += pos[idx[i] + k] / liste.length;
        return c;
      };
      const a = centre(ordre.slice(0, nb));
      const b = centre(ordre.slice(n - nb));
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ll = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
      const ds = idx.map((o) => {
        const q = [pos[o] - a[0], pos[o + 1] - a[1], pos[o + 2] - a[2]];
        const t = Math.min(1, Math.max(0, (q[0] * ab[0] + q[1] * ab[1] + q[2] * ab[2]) / ll));
        return Math.hypot(q[0] - ab[0] * t, q[1] - ab[1] * t, q[2] - ab[2] * t);
      }).sort((p, q) => p - q);
      res = { a, b, rayon: ds[Math.floor(ds.length * 0.9)] };
    }
  }
  cachesKatana.set(geometry, res);
  return res;
}
