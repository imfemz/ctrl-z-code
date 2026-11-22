// CLIP DE CAPTURE DE MOUVEMENT du héros de l'écran titre (15/11/2026, demande de Femz : « branche le héros de base à
// l'accueil » — ses gestes filmés, outils/mocap/). Fichier assets/anims/<nom>.json (format « ctrlz-clip-menu/1 »)
// écrit par outils/mocap/exporter.py : pistes normalisées par les longueurs de la personne, repère du héros (+X = sa
// gauche, +Y = haut, +Z = devant) ; la boucle est déjà fondue (la dernière image enchaîne sur la première).
// echantillonner(t, out) : interpolation linéaire entre deux images (quaternions : nlerp, signe aligné), boucle sur la
// durée, aucune allocation.

/** Pistes et nombre de composantes (doit suivre PISTES d'outils/mocap/exporter.py). */
export const PISTES = {
  racine: 3, lacet: 1, buste: 4, tete: 4,
  main_g: 3, coude_g: 3, main_d: 3, coude_d: 3,
  cheville_g: 3, genou_g: 3, pied_g: 1, appui_g: 1,
  cheville_d: 3, genou_d: 3, pied_d: 1, appui_d: 1,
};
const QUATS = { buste: true, tete: true };

/** Sortie d'échantillonnage préallouée (un Float64Array par piste). */
export function sortieClip() {
  const o = {};
  for (const k in PISTES) o[k] = new Float64Array(PISTES[k]);
  return o;
}

/** Vérifie et prépare un clip déjà lu (objet JSON). */
export function preparerClip(doc) {
  if (!doc || doc.format !== 'ctrlz-clip-menu/1') throw new Error('clip du menu : format inconnu');
  const n = doc.n;
  const P = {};
  for (const k in PISTES) {
    const a = doc.pistes[k];
    if (!a || a.length !== n * PISTES[k]) throw new Error(`clip du menu : piste « ${k} » absente ou de mauvaise taille`);
    P[k] = Float32Array.from(a);
  }
  const fps = doc.fps;
  const duree = n / fps;

  function echantillonner(t, out) {
    let u = (t % duree) * fps;
    if (u < 0) u += n;
    const i0 = Math.floor(u) % n;
    const i1 = (i0 + 1) % n;
    const f = u - Math.floor(u);
    for (const k in PISTES) {
      const c = PISTES[k];
      const a = P[k];
      const o = out[k];
      const b0 = i0 * c;
      const b1 = i1 * c;
      if (QUATS[k]) {
        const s = a[b0] * a[b1] + a[b0 + 1] * a[b1 + 1] + a[b0 + 2] * a[b1 + 2] + a[b0 + 3] * a[b1 + 3] < 0 ? -1 : 1;
        let l = 0;
        for (let j = 0; j < 4; j++) {
          o[j] = a[b0 + j] * (1 - f) + s * a[b1 + j] * f;
          l += o[j] * o[j];
        }
        l = 1 / Math.sqrt(l);
        for (let j = 0; j < 4; j++) o[j] *= l;
      } else {
        for (let j = 0; j < c; j++) o[j] = a[b0 + j] + (a[b1 + j] - a[b0 + j]) * f;
      }
    }
    return out;
  }
  return { n, fps, duree, longueurs: doc.longueurs, source: doc.source, echantillonner };
}

/** Lit un clip (adresse) et le prépare. */
export async function chargerClip(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`clip du menu introuvable : ${url} (${r.status})`);
  return preparerClip(await r.json());
}
