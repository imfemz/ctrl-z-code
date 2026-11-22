// Retours de Femz du 16/11/2026, point 7 (ARCHITECTURE.md § E3.Z) : le PSEUDO du joueur — « a la place de shinobi mettre
// notre pseudo qu'on choisit dans le menu (15 character max) ». Gardé dans le localStorage du navigateur, chaque accès
// dans un try/catch (stockage absent ou refusé : la valeur par défaut, le jeu marche pareil). ui.js n'accède jamais au
// stockage lui-même (règle de ui.test) : il passe par ce module.
import { PSEUDO } from './config.js';

let valeur = null;

/** Nettoie une saisie : ni caractère de contrôle ni chevron, espaces réduits, PSEUDO.max caractères au plus. */
export function nettoie(v) {
  return String(v)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PSEUDO.max);
}

/** Le pseudo affiché : celui saisi au menu, sinon PSEUDO.defaut. */
export function lire() {
  if (valeur === null) {
    let v = '';
    try {
      v = window.localStorage.getItem(PSEUDO.cle) || '';
    } catch {
      v = '';
    }
    valeur = nettoie(v);
  }
  return valeur || PSEUDO.defaut;
}

/** Change le pseudo (champ du menu, tests) ; rend la valeur affichée. */
export function ecrire(v) {
  valeur = nettoie(v);
  try {
    if (valeur) window.localStorage.setItem(PSEUDO.cle, valeur);
    else window.localStorage.removeItem(PSEUDO.cle);
  } catch {
    // stockage refusé : le pseudo vaut pour cette visite
  }
  return lire();
}
