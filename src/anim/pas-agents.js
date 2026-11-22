// § E5.G (étape 5, chantier G, 17/11/2026) — son des pas des agents du joueur.
// heros-anim.js compte chaque contact du pied d'appui (export `pas` : l'ancre posée au sol au bout d'un retour de jambe,
// en marche ou en course ; jamais pendant le dash, la vrille en l'air ni la réception). Une fois par pas de simulation
// (player.update, après heros.update), un contact nouveau joue le son de pas de l'agent posé (PAS_AGENTS.sfx[run.agent]),
// à la position de l'ancre ; audio.js tire la variante au hasard, jamais deux fois la même de suite. Un seul son par
// appel même si plusieurs contacts sont arrivés depuis (la pose tourne dans sync). Aucune allocation : tableaux typés,
// position passée par ARGF (audio.playF).
import { PAS_AGENTS } from '../config.js';
import { ARGF, F_X, F_Z, P, run } from '../state.js';
import { pas } from './heros-anim.js';

let audio = null;
const VU = new Float64Array(1); // compteur de contacts déjà traité
const N = new Float64Array(3); // [0] pas joués, [1] contacts ignorés (allure, dash, mort), [2] dernier son demandé

export function init(a) {
  audio = a;
  VU[0] = pas[0];
}

export function reset() {
  VU[0] = pas[0];
}

/** Une fois par pas de simulation, après heros.update. */
export function update() {
  if (pas[0] === VU[0]) return;
  VU[0] = pas[0];
  if (audio === null || !PAS_AGENTS.actif || !P.alive || P.dashT > 0 || !(pas[3] >= PAS_AGENTS.allureMin)) {
    N[1]++;
    return;
  }
  const a = run.agent;
  const id = a >= 0 && a < PAS_AGENTS.sfx.length ? PAS_AGENTS.sfx[a] : PAS_AGENTS.sfx[0];
  ARGF[F_X] = pas[1];
  ARGF[F_Z] = pas[2];
  audio.playF(id);
  N[0]++;
  N[2] = id;
}

export function inspect(out = {}) {
  out.contacts = pas[0];
  out.joues = N[0];
  out.ignores = N[1];
  out.dernier = N[2];
  return out;
}
