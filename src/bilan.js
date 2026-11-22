// PLAN ADDICTIF, ÉTAPE 4, CHANTIER C (ARCHITECTURE.md § E4.C, précisions § E4.C.4) : le bilan par arme de l'écran de fin.
//
// Les compteurs vivent dans damage.js (dealtBySource, killsBySource : tableaux typés écrits à chaque coup, aucune
// allocation en combat). Ici, UNE lecture à l'entrée de l'écran de fin (hors combat) : une ligne par arme possédée,
// évoluée, absorbée ou ayant fait des dégâts, plus « Modules et dash » (DMG_SRC.ITEM) et « Utilitaires »
// (DMG_SRC.UTIL + les tués en lot de l'I.E.M). Tri par dégâts décroissants ; part du total au dixième, somme exacte de
// 100,0 % par la méthode du plus fort reste. Les sources hors joueur (kamikaze, boss, événement, debug) ne sont pas listées.
import { ARME_COULEUR_UI, BILAN, DMG_SOURCE_COUNT, DMG_SRC, EVOLUTIONS, PALETTE, WEAPONS, WEAPON_COUNT } from './config.js';
import * as damage from './damage.js';
import * as weapons from './weapons.js';

const DEALT = new Float64Array(DMG_SOURCE_COUNT);
const KILLS = new Int32Array(DMG_SOURCE_COUNT);
const T = BILAN.textes;

function ligne(source, nom, icone, couleur, etiquette, degats, kills) {
  return { source, nom, icone, couleur, etiquette, degats, kills, dixiemes: 0, best: false };
}

/** Plus fort reste : parts en dixièmes de pour cent, somme exacte de 1 000 quand total > 0. */
function parts(lignes, total) {
  if (!(total > 0)) return;
  const restes = [];
  let somme = 0;
  for (let k = 0; k < lignes.length; k++) {
    const brut = (lignes[k].degats / total) * 1000;
    const d = Math.floor(brut);
    lignes[k].dixiemes = d;
    somme += d;
    restes.push({ k, r: brut - d });
  }
  restes.sort((a, b) => b.r - a.r || a.k - b.k); // à égalité : la ligne la plus haute
  let manque = Math.min(1000 - somme, lignes.length);
  for (let j = 0; j < restes.length && manque > 0; j++, manque--) lignes[restes[j].k].dixiemes++;
}

/**
 * Lignes du bilan de la partie en cours (hors combat : alloue). Rend { lignes, total, kills } ; total = dégâts du
 * joueur (somme des sources du joueur), kills = somme des kills des lignes.
 */
export function compose() {
  const total = damage.bilan(DEALT, KILLS);
  const lignes = [];
  for (let w = 0; w < WEAPON_COUNT; w++) {
    const evo = weapons.evolved[w];
    const absorbee = weapons.absorbed[w] === 1;
    if (!(DEALT[w] > 0) && weapons.owned[w] !== 1 && evo === 0 && !absorbee) continue;
    const nom = evo > 0 && EVOLUTIONS[evo - 1] ? EVOLUTIONS[evo - 1].name : WEAPONS[w].name;
    const etiquette = absorbee ? T.absorbee : evo > 0 ? T.evoluee : '';
    lignes.push(ligne(w, nom, evo > 0 && EVOLUTIONS[evo - 1] ? 'sr-e' + (evo - 1) : 'sr-w' + w, ARME_COULEUR_UI[w], etiquette, DEALT[w], KILLS[w])); // 21/11 : icône de l'évolution
  }
  const I = DMG_SRC.ITEM;
  if (DEALT[I] > 0 || KILLS[I] > 0) lignes.push(ligne(I, T.objets, BILAN.iconeObjets, 0xa9dcb6, '', DEALT[I], KILLS[I]));
  const U = DMG_SRC.UTIL;
  const ku = KILLS[U] + damage.batchKillCount(); // § E4.C.4 point 3 : l'I.E.M tue en lot sans passer par hitEnemyF
  if (DEALT[U] > 0 || ku > 0) lignes.push(ligne(U, T.util, BILAN.iconeUtil, 0xf4f050, '', DEALT[U], ku));
  lignes.sort((a, b) => b.degats - a.degats || b.kills - a.kills || a.source - b.source);
  parts(lignes, total);
  if (lignes.length > 0 && lignes[0].degats > 0) lignes[0].best = true;
  let kills = 0;
  for (const l of lignes) kills += l.kills;
  return { lignes, total, kills };
}
