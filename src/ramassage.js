// Étape 5, chantier E (ARCHITECTURE.md § E5.E.2) — compteurs de ramassage lus par le récap du HUD (ui.js).
//
// Les modules qui ramassent (pickups.js : gemmes et fragments ; utilities.js : bonus au sol ; chests.js : caches de
// données) écrivent ICI, au moment où le héros ramasse : RAM_N[t]++, RAM_V[t] += valeur et RAM_I[t] = RAM_V[t] | 0 (t = RECAP_T.* de config.js).
// Les compteurs ne font que croître (jamais remis à zéro) : ui.js garde les valeurs déjà vues et compare. Aucun appel de
// fonction, aucun objet : deux tableaux typés, zéro allocation par image (§ V).
import { RECAP_T } from './config.js';

/** Nombre de ramassages par type, depuis le chargement. */
export const RAM_N = new Int32Array(RECAP_T.COUNT);
/** Valeur cumulée par type (XP d'une gemme, fragments crédités), depuis le chargement. */
export const RAM_V = new Float64Array(RECAP_T.COUNT);
/** RAM_V arrondi à l'entier inférieur, tenu par l'écrivain : le récap ne lit que des entiers (aucun nombre alloué). */
export const RAM_I = new Int32Array(RECAP_T.COUNT);
