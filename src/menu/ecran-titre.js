// MENU PRINCIPAL — branchement de la scène de menu sur l'écran titre SANS toucher au jeu (prototype).
// OBSOLÈTE DANS LE JEU depuis l'intégration du 14/11/2026 (ARCHITECTURE.md § Z octies) : main.js crée et rend la scène
// lui-même. Aucun module du jeu n'importe ce fichier ; tests/menu/page.js ne s'en sert plus que si le jeu n'exporte pas
// menuIntegre (ancien src/). Gardé pour l'historique du prototype.
//
// Le jeu (src/main.js) affiche son écran titre dans #ui-root (élément .sr-title, display flex / none : src/ui.js).
// Ce module observe cet élément : titre affiché → menu.afficher() (boucle, son, cibles de rendu) ; titre masqué (Jouer,
// Entrée) → menu.cacher() (boucle arrêtée, son coupé, cibles plein écran libérées) ; retour au titre (« Menu » de la
// pause ou du game over) → menu.afficher() : la MÊME scène est réutilisée (rien n'est rechargé).
// Le son du menu est débloqué au premier geste (clic, touche) ; son volume suit le réglage « Volume général » du jeu
// (localStorage, clé STORAGE.settingsKey de config.js).
// À l'intégration (voir src/menu/INTEGRATION dans l'en-tête de menu.js et le rapport) ce module disparaît : main.js
// appelle menu.afficher() dans enterTitle() et menu.cacher() dans start(), et rend la scène de menu à la place du monde
// à l'état TITLE.
import { STORAGE } from '../config.js';
import { creerMenu } from './menu.js';

function volumeEnregistre(def) {
  try {
    const o = JSON.parse(localStorage.getItem(STORAGE.settingsKey) || 'null');
    if (o && Number.isFinite(o.volume) && o.volume >= 0 && o.volume <= 1) return o.volume;
  } catch (e) {
    /* stockage indisponible */
  }
  return def;
}

export async function brancherEcranTitre({ uiRoot, canvas, base = '/', manuel = false }) {
  const menu = await creerMenu({ canvas, base, manuel, volume: volumeEnregistre(0.6) });
  // l'écran titre du jeu (créé par ui.init dans le boot de main.js)
  let titre = uiRoot.querySelector('.sr-title');
  for (let k = 0; !titre && k < 200; k++) {
    await new Promise((ok) => setTimeout(ok, 25));
    titre = uiRoot.querySelector('.sr-title');
  }
  if (!titre) throw new Error('écran titre introuvable (.sr-title)');
  const suivre = () => {
    const affiche = titre.style.display !== 'none' && titre.isConnected;
    if (affiche) menu.afficher();
    else menu.cacher();
  };
  const obs = new MutationObserver(suivre);
  obs.observe(titre, { attributes: true, attributeFilter: ['style'] });
  suivre();
  // son : premier geste, puis volume suivi
  const geste = () => menu.son.debloquer();
  window.addEventListener('pointerdown', geste, true);
  window.addEventListener('keydown', geste, true);
  const majVolume = () => setTimeout(() => menu.son.setVolume(volumeEnregistre(menu.son.etat.volume)), 0);
  uiRoot.addEventListener('input', majVolume, true);
  uiRoot.addEventListener('change', majVolume, true);
  return {
    menu,
    debrancher() {
      obs.disconnect();
      window.removeEventListener('pointerdown', geste, true);
      window.removeEventListener('keydown', geste, true);
      uiRoot.removeEventListener('input', majVolume, true);
      uiRoot.removeEventListener('change', majVolume, true);
      menu.liberer();
    },
  };
}
