// LOOK DES VFX « pixel minimal + deep glow » (17/11/2026, demande de Femz : « un glow plus travaillé et joli, comme
// Deep Glow, et un look plus pixel art minimaliste » pour les tirs et les passifs).
//
// Deux leviers, tous deux en uniformes (changer de variante ne recompile rien) :
//   1. PIXEL (src/vfx/shader.js) — chaque effet est évalué au CENTRE de sa cellule de gros pixel (pixel = côté en
//      pixels du TAMPON, multiple de la grille du CRT : 2) puis réduit à trois tons durs : sombre saturé, couleur,
//      cœur blanc chaud. Plus de dégradé doux DANS l'effet : la douceur vient du glow. pas = animation des effets
//      datés (explosions, étoiles, arcs, scintillement) par paliers de `pas` secondes (0 = continue).
//      tons.seuils = intensités (canal le plus fort) où l'on passe d'un ton au suivant ; tons.gains = intensité de
//      chaque ton (le cœur passe le seuil du bloom : c'est lui qui « brûle ») ; tons.blanc = part de blanc du cœur.
//   2. GLOW (src/rendu/bloom.js) — 7 niveaux au lieu de 5 (jusqu'au 1/128 de l'écran) : la traîne longue du Deep
//      Glow. poids à peu près égaux d'un niveau au suivant = décroissance en 1/r² (gaussiennes normalisées dont le
//      rayon double). plafond relevé : seuls les cœurs des effets (≥ 4) le dépassent, pas les yeux de la horde (~2).
//      saturation = gain de chroma du halo dans la passe finale (1 = inchangé) : halo coloré, cœur blanc.
// actif = numéro de la variante au chargement (0 = rendu d'avant) ; ?vfxlook=N dans l'adresse l'emporte ;
// debug : __game.call('vfxLook', N | {…}) applique et redessine l'image courante.
export const LOOK = {
  actif: 5, // 17/11 : Femz choisit A, puis « tout en 0,5 » (tirs × 0,5)
  variantes: [
    null,
    // 17/11, retour de Femz sur la 1re série : « trop blanc, il faut du glow sur la couleur et plus diffus » — cœurs en
    // couleur saturée (blanc 0), extraction du glow saturée, poids reportés sur les niveaux larges.
    {
      nom: 'A · Pixel fin + glow couleur diffus',
      pixel: 4,
      pas: 1 / 20,
      tons: { seuils: [0.2, 0.8, 2.0], gains: [0.5, 1.2, 2.6], blanc: 0, alpha: [0.35, 0.35] },
      glow: { seuil: 1.35, genou: 0.6, plafond: 2.6, poids: [0.25, 0.4, 0.6, 0.75, 0.85, 0.85, 0.8], force: 0.42, saturation: 1.8, saturationExtraction: 1.6 },
    },
    {
      nom: 'B · Pixel fin + glow couleur très large',
      pixel: 4,
      pas: 1 / 20,
      tons: { seuils: [0.2, 0.8, 2.0], gains: [0.5, 1.2, 2.6], blanc: 0, alpha: [0.35, 0.35] },
      glow: { seuil: 1.3, genou: 0.6, plafond: 2.6, poids: [0.12, 0.25, 0.45, 0.7, 0.95, 1.1, 1.15], force: 0.45, saturation: 2.0, saturationExtraction: 1.8 },
    },
    {
      nom: 'C · Pixel gros + glow couleur diffus',
      pixel: 6,
      pas: 1 / 15,
      tons: { seuils: [0.2, 0.8, 2.0], gains: [0.5, 1.2, 2.6], blanc: 0, alpha: [0.35, 0.35] },
      glow: { seuil: 1.35, genou: 0.6, plafond: 2.6, poids: [0.25, 0.4, 0.6, 0.75, 0.85, 0.85, 0.8], force: 0.42, saturation: 1.8, saturationExtraction: 1.6 },
    },
    // 17/11, Femz choisit A ; « les tirs doivent être plus petits » : deux tailles à comparer (tirs × 0,7 et × 0,5)
    {
      nom: 'A · tirs × 0,7',
      pixel: 4,
      pas: 1 / 20,
      taille: 0.7,
      tons: { seuils: [0.2, 0.8, 2.0], gains: [0.5, 1.2, 2.6], blanc: 0, alpha: [0.35, 0.35] },
      glow: { seuil: 1.35, genou: 0.6, plafond: 2.6, poids: [0.25, 0.4, 0.6, 0.75, 0.85, 0.85, 0.8], force: 0.42, saturation: 1.8, saturationExtraction: 1.6 },
    },
    {
      nom: 'A · tirs × 0,5',
      pixel: 4,
      pas: 1 / 20,
      taille: 0.5,
      tons: { seuils: [0.2, 0.8, 2.0], gains: [0.5, 1.2, 2.6], blanc: 0, alpha: [0.35, 0.35] },
      glow: { seuil: 1.35, genou: 0.6, plafond: 2.6, poids: [0.25, 0.4, 0.6, 0.75, 0.85, 0.85, 0.8], force: 0.42, saturation: 1.8, saturationExtraction: 1.6 },
    },
  ],
};

/** Variante lue au chargement : ?vfxlook=N l'emporte sur LOOK.actif ; null = rendu d'avant. */
export function lookDuChargement() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('vfxlook') : null;
  const n = q === null ? LOOK.actif : Number(q) | 0;
  return LOOK.variantes[n] || null;
}
