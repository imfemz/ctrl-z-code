// VFX DES PROJECTILES « toon » — réglages. Intégrés le 14/11/2026 (étape « vfx », ARCHITECTURE.md § Z septies) : les
// valeurs vivent dans src/config.js (région « vfx:reglages » : VFX_STYLE, VFX_VIE, VFX_COULEURS, VFX ; même structure,
// mêmes noms qu'au prototype). Ce fichier ne fait que les réexporter sous leurs noms de prototype, pour shader.js et
// projectiles.js.
export { VFX_STYLE as STYLE, VFX_VIE as VIE, VFX_COULEURS as COULEURS, VFX, VFX_ROBOTS as ROBOTS } from '../config.js';
