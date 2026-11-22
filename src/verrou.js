// ÉTAPE 5, CHANTIER AB : verrou.js — verrou du pointeur en partie (ARCHITECTURE.md § E5.AB.5 ; Femz, 22/11 : « Caméra
// derrière l'agent » en mode Souris ; « le Dock macOS s'affiche quand je mets le curseur tout en bas de l'écran »).
//   • Voulu en partie (PLAYING, WAVE_CLEAR, COUNTDOWN), dans les DEUX modes de déplacement ; rendu partout ailleurs
//     (pause, choix de niveau, coffre, fusion, marchand, fin de partie, titre, Noyau).
//   • Pris : une demande par image où il est voulu et absent (jamais deux en vol), et au clic dans la partie (hors
//     bouton). Refusé (geste exigé, Échap tout juste pressé, navigateur sans fenêtre) : plaque « Cliquez pour reprendre
//     la souris », plus de demande automatique jusqu'au prochain retour en partie ; la partie continue.
//   • Perdu sans que le jeu l'ait rendu (Échap, perte du focus) en partie : la pause s'ouvre, une seule fois (input.js
//     efface le front d'Échap déjà reçu et ignore celui qui arrive juste après).
//   • Mode « Caméra libre » (souris) : les écarts de la souris tournent la caméra (input.ROTATION → camera.tourner) ;
//     mode « Vue fixe » (clavier + clic droit, § E5.AB.14) : ils déplacent le curseur du jeu (input.js, dessiné par ui.js),
//     qui sert au clic pour avancer et à la direction du dash.
// Tests (navigateur sans fenêtre : le vrai verrou y est refusé) : simuler(true) remplace l'API du navigateur par un
// verrou simulé qui passe par les MÊMES chemins (prise, relâche voulue, perte involontaire).
// Rien n'est alloué par image : état en tableaux typés ; une promesse n'est créée qu'à une demande (une par entrée en
// partie au plus, hors refus).
//#region e5:AB-camera-3p
import { STATE } from './config.js';

const ACTIF = 0; // verrou pris
const EN_VOL = 1; // demande en cours
const REFUS = 2; // dernière demande refusée : plaque, plus de demande automatique
const SORTIE = 3; // relâche demandée par le jeu (la perte qui suit n'ouvre pas la pause)
const SIMULE = 4; // tests : verrou simulé
const SIM_REFUS = 5; // tests : le verrou simulé refuse les demandes
const ST = new Uint8Array(6);
// compteurs (tests) : demandes, refus, pertes involontaires, relâches voulues, prises ; images depuis la demande en vol
const N = new Int32Array(6);
const IMAGES_MAX_VOL = 90; // une demande sans réponse après 1,5 s (60 i/s) compte comme refusée

let ctx = null;
let input = null;
// § E5.AB.5 : en ?debug (tests qui pilotent plusieurs pages), pas de VRAI verrou sauf avec &verrou dans l'adresse (le
// verrou simulé reste disponible) — comme la pause à la perte du focus (§ E5.S, A18) ; Firefox sans fenêtre accorde le
// vrai verrou, et sa perte au changement de page ouvrait la pause au milieu d'un test (mesuré par fondation.test, 22/11)
let reel = 1;
let cible = null; // élément verrouillé (le canvas du jeu)

function enPartie() {
  const s = ctx.game.state;
  return s === STATE.PLAYING || s === STATE.WAVE_CLEAR || s === STATE.COUNTDOWN;
}

function refuse() {
  if (ST[EN_VOL] === 0 && ST[REFUS] === 1) return; // promesse rejetée ET pointerlockerror : un seul refus compté
  ST[EN_VOL] = 0;
  ST[REFUS] = 1;
  N[1]++;
}

function demander() {
  if (ST[EN_VOL] === 1 || ST[ACTIF] === 1) return;
  ST[EN_VOL] = 1;
  N[5] = 0;
  N[0]++;
  if (ST[SIMULE] === 1) {
    if (ST[SIM_REFUS] === 1) refuse();
    else change(true);
    return;
  }
  if (reel === 0) {
    ST[EN_VOL] = 0;
    N[0]--;
    return;
  }
  try {
    const r = cible.requestPointerLock();
    if (r && typeof r.catch === 'function') r.catch(refuse);
  } catch {
    refuse();
  }
}

function relacher() {
  if (ST[ACTIF] === 0) return;
  ST[SORTIE] = 1;
  N[3]++;
  if (ST[SIMULE] === 1) change(false);
  else if (document.exitPointerLock) document.exitPointerLock();
}

/** Verrou pris (on) ou rendu ; chemin commun du vrai verrou (pointerlockchange) et du verrou simulé. */
function change(on) {
  if (on) {
    ST[ACTIF] = 1;
    ST[EN_VOL] = 0;
    ST[REFUS] = 0;
    N[4]++;
    input.setVerrou(true);
    return;
  }
  const voulue = ST[SORTIE] === 1;
  const etait = ST[ACTIF] === 1;
  ST[ACTIF] = 0;
  ST[EN_VOL] = 0;
  ST[SORTIE] = 0;
  const perdu = etait && !voulue && enPartie();
  input.setVerrou(false, perdu);
  if (perdu) {
    N[2]++;
    // Échap (la fenêtre garde le focus) : pause sonore ; focus perdu : pause muette (§ E5.AD) — une seule fois (input.setVerrou)
    ctx.actions.pauseVerrou(ST[SIMULE] === 1 ? true : document.hasFocus());
  }
}

function onChange() {
  if (ST[SIMULE] === 1) return;
  change(document.pointerLockElement === cible);
}

function onErreur() {
  if (ST[SIMULE] === 1) return;
  refuse();
}

/** Clic dans la partie (hors bouton, hors champ) : geste du joueur — la demande part dans le gestionnaire même. */
function onPointerDown(e) {
  if (ctx === null || ST[ACTIF] === 1 || !enPartie()) return;
  const t = e.target;
  if (t && t.closest && t.closest('button, a, input, select, textarea, [role="button"]')) return;
  ST[REFUS] = 0;
  demander();
}

export function init(context) {
  ctx = context;
  input = ctx.input;
  cible = ctx.renderer.domElement;
  reel = ctx.game.debug && !new URLSearchParams(location.search).has('verrou') ? 0 : 1;
  document.addEventListener('pointerlockchange', onChange);
  document.addEventListener('pointerlockerror', onErreur);
  window.addEventListener('pointerdown', onPointerDown);
}

/** Une fois par image (main.runFrame, après les transitions d'état) : prend ou rend le verrou selon l'état du jeu. */
export function update() {
  if (ctx === null) return;
  if (!enPartie()) {
    ST[REFUS] = 0; // au prochain retour en partie, une demande automatique
    if (ST[ACTIF] === 1) relacher();
    return;
  }
  if (ST[EN_VOL] === 1 && ++N[5] > IMAGES_MAX_VOL) refuse();
  if (ST[ACTIF] === 0 && ST[EN_VOL] === 0 && ST[REFUS] === 0) demander();
}

/** Curseur du jeu dessiné (ui.js) : en partie, sous verrou, mode « Vue fixe » (clavier + clic droit, § E5.AB.14). */
export function curseurVisible() {
  return ctx !== null && ST[ACTIF] === 1 && enPartie() && !input.getModeSouris();
}

/** Plaque « Cliquez pour reprendre la souris » (ui.js) : en partie, sans verrou, après un refus. */
export function plaque() {
  return ctx !== null && ST[REFUS] === 1 && ST[ACTIF] === 0 && enPartie();
}


export function actif() {
  return ST[ACTIF] === 1;
}

/** Tests : verrou simulé (le navigateur sans fenêtre refuse le vrai). refus : les demandes simulées sont refusées. */
export function simuler(on, refus = false) {
  if (ST[ACTIF] === 1) {
    ST[SORTIE] = 1; // rendu par le jeu (pas une perte : aucune pause)
    change(false);
  }
  ST[SIMULE] = on ? 1 : 0;
  ST[SIM_REFUS] = refus ? 1 : 0;
  ST[EN_VOL] = 0;
  ST[REFUS] = 0;
}

/** Tests : perte involontaire du verrou simulé (Échap du navigateur, perte du focus). */
export function simulerPerte() {
  if (ST[SIMULE] === 1 && ST[ACTIF] === 1) change(false);
}

export function inspect(out = {}) {
  out.actif = ST[ACTIF] === 1;
  out.enVol = ST[EN_VOL] === 1;
  out.refus = ST[REFUS] === 1;
  out.simule = ST[SIMULE] === 1;
  out.demandes = N[0];
  out.refusCompte = N[1];
  out.pertes = N[2];
  out.relaches = N[3];
  out.prises = N[4];
  out.vrai = !!document.pointerLockElement;
  return out;
}
//#endregion e5:AB-camera-3p
