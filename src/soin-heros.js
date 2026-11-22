// ÉTAPE 5, SUITE DU GUIDE UX (ARCHITECTURE.md § E5.Q, B14) : le retour propre au soin du HÉROS.
//
// Avant : player.heal ne jouait rien, la barre de PV ne s'animait qu'à la baisse, et les rares effets (batterie, vol de
// vie, Bastion) étaient l'anneau + losanges du réparateur qui soigne les ROBOTS — un même signal pour deux effets opposés.
// Ici : tout soin du héros s'ajoute au cumul SOIN[S_CUMUL] (player.heal, et la bulle du Bastion qui écrit P.hp) ; dès que
// le cumul atteint RETOURS_GUIDE.soin.seuil, et au plus une fois par `fenetre` s (0,35 : ≤ 3 Hz, pas de clignotement), trois
// signaux partent ensemble :
//   (a) le corps du héros s'éclaire en vert (heros-anim lit SOIN[S_LUEUR] : lueur et couleur de son matériau) ;
//   (b) un nombre vert « +N » monte du héros (fx.spawnHealNumberF : chiffre de soin, glyphe « + ») ;
//   (c) la barre de PV du HUD s'éclaire (ui.js relance son éclat quand SIGNAUX[0] change).
// La régénération continue (Nanoréparation, player.update) ne passe pas par ici. Aucune allocation : tableaux typés,
// aucun flottant en argument (le montant part par ARGF, § V).
import { RETOURS_GUIDE, SFX } from './config.js';
import { ARGF, F_V, F_X, F_Z, P, SOIN_HEROS, SOIN_SIGNAUX } from './state.js';

const R = RETOURS_GUIDE.soin;
// constantes de module (lues une fois) : aucune propriété flottante relue à chaque image
const FENETRE = R.fenetre;
const SEUIL = R.seuil;
const DUREE = R.duree;

export const S_CUMUL = 0; // PV rendus pas encore signalés
export const S_ATTENTE = 1; // s avant le prochain signal possible (0 : libre ; reste à 0 au repos, entier exact)
export const S_LUEUR = 2; // s de lueur verte restantes (0 : éteinte)
export const S_TOTAL = 3; // PV rendus et signalés depuis le début de la partie
/** Cumul du soin du héros (indices S_* ; tableau de state.js). Écrit par player.heal et la bulle du Bastion. */
export const SOIN = SOIN_HEROS;
/** [0] soins signalés depuis le chargement (jamais remis à 0 : ui.js compare), [1] de la partie (state.js). */
export const SIGNAUX = SOIN_SIGNAUX;

let fx = null;
let audio = null;

export function init(ctx) {
  fx = ctx.fx;
  audio = ctx.audio || null;
}

/** Début de partie (main.resetAll). */
export function reset() {
  SOIN[S_CUMUL] = 0;
  SOIN[S_ATTENTE] = 0;
  SOIN[S_LUEUR] = 0;
  SOIN[S_TOTAL] = 0;
  SIGNAUX[1] = 0;
  SIGNAUX[2] = 0;
}

/**
 * Une image de simulation (dt mis à l'échelle : rien ne bouge pendant une pause ou un écran de choix). Au repos
 * (SIGNAUX[2] = 0) un seul entier est lu : aucun flottant manipulé, même avant que V8 n'optimise la fonction.
 */
export function update(dt) {
  if (SIGNAUX[2] === 0) return; // repos : rien à signaler, rien qui s'éteint (un entier lu, aucun flottant)
  if (SOIN[S_LUEUR] > 0) {
    const l = SOIN[S_LUEUR] - dt;
    SOIN[S_LUEUR] = l > 0 ? l : 0;
  }
  if (SOIN[S_ATTENTE] > 0) {
    const a = SOIN[S_ATTENTE] - dt;
    SOIN[S_ATTENTE] = a > 0 ? a : 0;
    return;
  }
  if (SOIN[S_CUMUL] < SEUIL || !P.alive) {
    if (!(SOIN[S_LUEUR] > 0)) SIGNAUX[2] = 0; // plus de lueur, plus d'attente, rien à signaler : repos
    return;
  }
  // signal : « +N » (montant arrondi par le dessin des nombres), lueur, éclat de la barre
  SOIN[S_ATTENTE] = FENETRE;
  SOIN[S_LUEUR] = DUREE;
  SOIN[S_TOTAL] += SOIN[S_CUMUL];
  ARGF[F_X] = P.x;
  ARGF[F_Z] = P.z;
  ARGF[F_V] = SOIN[S_CUMUL];
  SOIN[S_CUMUL] = 0;
  SIGNAUX[0]++;
  SIGNAUX[1]++;
  if (fx !== null && fx.spawnHealNumberF) fx.spawnHealNumberF(); // (réécrit ARGF : le son, sans position, d'abord ou après)
  if (audio !== null) audio.play(SFX.SOIN_HEROS); // § E5.Q (Femz, 21/11) : son du soin du héros, discret
}

export function inspect(out) {
  out.cumul = SOIN[S_CUMUL];
  out.lueur = SOIN[S_LUEUR];
  out.total = SOIN[S_TOTAL];
  out.signaux = SIGNAUX[1];
  out.signauxTotal = SIGNAUX[0];
  return out;
}
