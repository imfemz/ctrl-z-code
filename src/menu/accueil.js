// ÉCRAN TITRE « peint » (Écran Agents, tâche 7 ; spec docs/superpowers/specs/2026-11-22-ecran-agents-design.md § Écran
// titre, maquettes docs/maquettes-ecran-agents/titre-b5v3-*.png). Remplace la scène 3D de src/menu/menu.js (héros sur
// promontoire, boss, grille, braises, caméra en orbite), qui ne sert plus qu'à l'outil de cuisson des animations
// (?fbx= / ?modele= / ?anim=, tests/cuire-anim.mjs).
//
// Calque à part (sous #ui-root, au-dessus du canvas du jeu, sans clic) :
//   - fond peint VITRINE.fonds.titre (« cover », opaque : la scène du jeu derrière n'est pas vue) ;
//   - voile sombre à gauche sous le menu, cône de lumière du projecteur et halo au sol (VITRINE.titre, CSS : rien à
//     chaque image) ;
//   - l'agent CHOISI (agents.getAgent(), skin meta.skinChoisi) en vitrine 3D (src/pause-agent.js, cadre « titre » : même
//     angle que l'ancien écran titre, CAMÉRA FIXE, idle de vitrine, éclairage lum-b5), dans une toile plein écran — rendu
//     par main.js (pauseAgent.renderVitrine, F14) ;
//   - poussière (VITRINE.poussiere) : grains fins et lents dessinés dans un <canvas> 2D à droite du menu (jamais devant),
//     éclairés dans le faisceau, fondus à l'entrée et à la sortie. Aucune allocation par image (mesuré, tests/ecran-titre) :
//     état en tableaux typés ; AUCUN flottant passé en argument ni rendu par une fonction (V8 l'emballe en objet : § V) —
//     les échanges passent par le tableau X ; les appels au canvas ne reçoivent que des entiers (Smi) : positions en
//     huitièmes de pixel (transformation 1/8 posée au redimensionnement : mouvement au sous-pixel gardé), opacité choisie
//     dans un atlas de sprites précalculés (aucun globalAlpha flottant).
//
// API (même forme que menu.js pour main.js) : const a = await creerAccueil({ renderer, base, audio }) puis
//   a.afficher() — titre ou Noyau : calque montré, vitrine ouverte sur l'agent choisi (relu à chaque affichage) ;
//   a.cacher()   — écran Agents, partie : calque caché, vitrine fermée si c'est la sienne ;
//   a.image(dt)  — une image (poussière ; « Chargement » de la vitrine) ;
//   a.liberer()  — calque retiré ;
//   a.etat()     — { agent, skin, particules, visible } (tests, debug.snapshot().menu.scene).
// L'ambiance sonore reste la nappe d'audio.js (main.js, enterTitle) : le son des boss a disparu avec eux.
import { AGENTS, VITRINE } from '../config.js';
import * as pauseAgent from '../pause-agent.js';
import * as agents from '../agents.js';
import * as meta from '../meta.js';

// grains : [0] x, [1] y (part de la zone), [2] profondeur 0..1 (proche = plus gros, plus rapide), [3] âge (s),
// [4] durée de vie (s), [5] phase de l'errance, [6] vitesse x, [7] vitesse y (part de la hauteur par seconde)
const CH = 8;

export async function creerAccueil({ base = '/' } = {}) {
  const P = VITRINE.poussiere;
  const T = VITRINE.titre;
  const NB = Math.max(0, Math.min(200, P.nombre | 0));
  // G : NB grains vivants, puis VIES naissances précalculées par grain (une renaissance = une copie dans le tableau,
  // jamais de calcul hors du chemin optimisé : un grain renaît toutes les 6 à 13 s seulement)
  const VIES = 12;
  const G = new Float64Array(NB * CH * (1 + VIES));
  const VIE = new Int32Array(NB); // prochaine naissance précalculée de chaque grain
  const ALEA = new Uint32Array([0x9e3779b9]);
  // échanges sans argument flottant : [0] tirage 0..1 (alea), [1] y demandé (part de l'écran), [2] x du centre et
  // [3] demi-largeur du faisceau à ce y (faisceau)
  const X = new Float64Array(4);
  // [0] largeur, [1] hauteur de la toile de poussière (px du tampon), [2] taille à relire (0 / 1), [3] visible,
  // [4] attente de la vitrine affichée (0 / 1, −1 : à relire)
  const N = new Int32Array(5);
  const NIV = 48; // niveaux d'opacité de l'atlas (0 … P.opacite)
  const SP = 32; // côté d'un sprite (px)
  const E = { agent: -1, skin: 'base' };

  const el = (cls, tag = 'div') => {
    const n = document.createElement(tag);
    n.className = cls;
    return n;
  };
  const racine = el('sr-accueil');
  racine.setAttribute('aria-hidden', 'true');
  const fond = el('sr-accueil-fond');
  const url = base + VITRINE.fonds.titre;
  fond.style.backgroundImage = `url("${url}")`;
  const voile = el('sr-accueil-voile');
  voile.style.background = `linear-gradient(90deg, ${T.voile.map(([x, a]) => `rgba(3, 7, 6, ${a}) ${(x * 100).toFixed(2)}%`).join(', ')})`;
  const F = T.faisceau;
  const pc = (v) => (v * 100).toFixed(2) + '%';
  const cone = el('sr-accueil-cone');
  cone.style.clipPath = `polygon(${pc(F.haut[0])} 0, ${pc(F.haut[1])} 0, ${pc(F.bas[1])} ${pc(F.yBas)}, ${pc(F.bas[0])} ${pc(F.yBas)})`;
  cone.style.background = `linear-gradient(180deg, rgba(225, 255, 238, 0) 0, rgba(225, 255, 238, ${(F.force * 0.45).toFixed(3)}) ${pc(F.yBas * 0.45)}, rgba(225, 255, 238, ${F.force}) ${pc(F.yBas)})`;
  const L = T.flaque;
  const flaque = el('sr-accueil-flaque');
  flaque.style.left = pc(L.x - L.largeur / 2);
  flaque.style.top = pc(L.y - L.hauteur / 2);
  flaque.style.width = pc(L.largeur);
  flaque.style.height = pc(L.hauteur);
  flaque.style.background = `radial-gradient(closest-side, rgba(225, 255, 238, ${L.force}), rgba(225, 255, 238, ${(L.force * 0.29).toFixed(3)}) 60%, rgba(225, 255, 238, 0))`;
  const toile = el('sr-accueil-toile', 'canvas'); // vitrine (pause-agent.js y recopie l'agent)
  toile.width = 8;
  toile.height = 8;
  const Z = P.zone;
  const poussiere = el('sr-accueil-poussiere', 'canvas');
  poussiere.style.left = pc(Z[0]);
  poussiere.style.width = pc(Z[1] - Z[0]);
  poussiere.style.height = pc(Z[2]);
  poussiere.width = 8;
  poussiere.height = 8;
  const g = poussiere.getContext('2d', { alpha: true });
  racine.append(fond, voile, cone, flaque, toile, poussiere);
  racine.style.display = 'none';
  const uiRoot = document.getElementById('ui-root');
  if (uiRoot && uiRoot.parentNode) uiRoot.parentNode.insertBefore(racine, uiRoot);
  else document.body.appendChild(racine);

  // atlas : NIV sprites d'un grain (disque doux, couleur de la lumière du projecteur), opacité k / (NIV − 1) × P.opacite
  const atlas = document.createElement('canvas');
  atlas.width = SP * NIV;
  atlas.height = SP;
  {
    const s = atlas.getContext('2d');
    const r = s.createRadialGradient(SP / 2, SP / 2, 0, SP / 2, SP / 2, SP / 2);
    r.addColorStop(0, 'rgba(250, 255, 252, 1)');
    r.addColorStop(0.3, 'rgba(232, 255, 242, 0.6)');
    r.addColorStop(1, 'rgba(225, 255, 238, 0)');
    s.fillStyle = r;
    for (let k = 0; k < NIV; k++) {
      s.globalAlpha = (k / (NIV - 1)) * P.opacite;
      s.setTransform(1, 0, 0, 1, k * SP, 0);
      s.fillRect(0, 0, SP, SP);
    }
  }

  // fond décodé avant de dire « prêt » : l'écran titre n'apparaît jamais sans son décor
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
  } catch {
    // fond illisible : le calque garde sa couleur de repli (#060c09), le jeu reste jouable
  }

  // réglages relus une fois (§ V : rien n'est lu dans la config sur le chemin chaud)
  const R = new Float64Array([F.haut[0], F.haut[1], F.bas[0], F.bas[1], F.yBas, Z[0], Z[1], Z[2], P.vitesse, P.opacite, P.ambiante, P.taille, P.vie[0], P.vie[1]]);

  /** Tirage pseudo-aléatoire 0..1 (xorshift32) dans X[0], sans allocation. */
  function alea() {
    let x = ALEA[0];
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    ALEA[0] = x;
    X[0] = ALEA[0] / 4294967296;
  }

  /** Faisceau à la hauteur X[1] (part de l'écran) : x de son centre dans X[2], sa demi-largeur dans X[3]. */
  function faisceau() {
    const u = Math.min(1, Math.max(0, X[1] / R[4]));
    const g0 = R[0] + (R[2] - R[0]) * u;
    const g1 = R[1] + (R[3] - R[1]) * u;
    X[2] = (g0 + g1) * 0.5;
    X[3] = (g1 - g0) * 0.5;
  }

  /** Naissance tirée dans l'enregistrement o de G : 70 % dans le faisceau, le reste dans la zone ; âge tiré (1) ou nul (0). */
  function naitre(o, ageTire) {
    const zx = R[6] - R[5];
    alea();
    X[1] = X[0] * R[7];
    faisceau();
    alea();
    if (X[0] < 0.7) {
      alea();
      G[o] = (X[2] + (X[0] * 2 - 1) * X[3] * 1.1 - R[5]) / zx;
    } else {
      alea();
      G[o] = X[0];
    }
    G[o + 1] = X[1] / R[7];
    alea();
    G[o + 2] = X[0];
    alea();
    G[o + 4] = R[12] + X[0] * (R[13] - R[12]);
    alea();
    G[o + 3] = ageTire === 1 ? X[0] * G[o + 4] : 0;
    alea();
    G[o + 5] = X[0] * 6.2832;
    alea();
    G[o + 6] = (X[0] * 2 - 1) * R[8] * 0.6;
    alea();
    G[o + 7] = (X[0] * 2 - 1) * R[8] * 0.5 - R[8] * 0.25; // légère montée (air chaud du projecteur)
  }
  for (let i = 0; i < NB; i++) {
    naitre(i * CH, 1);
    for (let v = 0; v < VIES; v++) naitre((NB + i * VIES + v) * CH, 0);
  }

  /** Grain i renaît : copie de sa prochaine naissance précalculée (aucun calcul, aucune allocation). */
  function renaitre(i) {
    const src = (NB + i * VIES + VIE[i]) * CH;
    G.copyWithin(i * CH, src, src + CH);
    VIE[i] = VIE[i] + 1 === VIES ? 0 : VIE[i] + 1;
  }

  function surRedim() {
    N[2] = 1;
  }
  window.addEventListener('resize', surRedim);

  /**
   * Taille de la toile de poussière (px du tampon) relue : à l'affichage et après un redimensionnement. La toile est
   * dessinée en huitièmes de pixel (transformation 1/8, remise à chaque changement de taille : elle est alors effacée).
   */
  function mesurer() {
    N[2] = 0;
    const d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(8, Math.round(poussiere.clientWidth * d));
    const h = Math.max(8, Math.round(poussiere.clientHeight * d));
    if (poussiere.width !== w) poussiere.width = w;
    if (poussiere.height !== h) poussiere.height = h;
    N[0] = w;
    N[1] = h;
    g.setTransform(0.125, 0, 0, 0.125, 0, 0);
  }

  /** Une image de poussière : avance de X[0] s (posé par image()), dessin (opacité = faisceau × fondu de vie × profondeur). */
  function poussiereImage() {
    if (N[2] === 1) mesurer();
    const dt = X[0];
    const w8 = N[0] * 8;
    const h8 = N[1] * 8;
    const zx = R[6] - R[5];
    const k = N[1] / R[7] / 1440; // px du tampon par px d'une hauteur d'écran de 1440
    g.clearRect(0, 0, w8, h8);
    for (let i = 0; i < NB; i++) {
      const o = i * CH;
      G[o + 3] += dt;
      if (G[o + 3] >= G[o + 4]) renaitre(i);
      const z = G[o + 2];
      const vit = 0.55 + 0.9 * z; // parallaxe : les grains proches vont plus vite
      const t = G[o + 3];
      G[o] += ((G[o + 6] + Math.sin(t * 0.7 + G[o + 5]) * R[8] * 0.35) * vit * dt * R[7]) / zx;
      G[o + 1] += (G[o + 7] + Math.cos(t * 0.53 + G[o + 5]) * R[8] * 0.3) * vit * dt;
      if (G[o] < 0 || G[o] > 1 || G[o + 1] < 0 || G[o + 1] > 1) {
        renaitre(i);
        continue;
      }
      // lumière : dans le faisceau (centre → bord), sinon l'ambiante
      X[1] = G[o + 1] * R[7];
      faisceau();
      const e = Math.abs(R[5] + G[o] * zx - X[2]) / (X[3] + 1e-4);
      const lum = e < 1 ? 1 - e * e : 0;
      const vie = Math.sin((Math.PI * t) / G[o + 4]);
      const a = (R[10] + (1 - R[10]) * lum) * vie * (0.6 + 0.4 * z); // part de P.opacite
      const niv = (a * (NIV - 1) + 0.5) | 0;
      if (niv <= 0) continue;
      const s8 = (R[11] * (0.6 + 0.9 * z) * k * 24 + 0.5) | 0; // sprite (1/8 px) : le cœur fait ≈ 1/3 de sa largeur
      const x8 = (G[o] * w8 - s8 * 0.5) | 0;
      const y8 = (G[o + 1] * h8 - s8 * 0.5) | 0;
      g.drawImage(atlas, (niv < NIV ? niv : NIV - 1) * SP, 0, SP, SP, x8, y8, s8, s8);
    }
  }

  function afficher() {
    const a = agents.getAgent();
    const skin = meta.skinEffectif(AGENTS[a].key);
    // déjà montré en cadre titre sur le même agent et le même skin (enterHub / enterTitle rappellent afficher) : on ne
    // rouvre pas la vitrine, sa cape et son idle ne repartent pas de zéro
    const dejaMontre = N[3] === 1 && pauseAgent.vitrineTitre() && E.agent === a && E.skin === skin;
    E.agent = a;
    E.skin = skin;
    if (dejaMontre) return;
    if (N[3] !== 1) {
      N[3] = 1;
      racine.style.display = '';
      N[2] = 1;
    }
    pauseAgent.openVitrine(a, { cadre: 'titre', verrou: false, toile, skin });
    N[4] = -1; // classe d'attente relue à la prochaine image
  }

  function cacher() {
    if (pauseAgent.vitrineTitre()) pauseAgent.closeVitrine(); // referme aussi la toile à 8 × 8 (mémoire)
    if (N[3] === 0) return;
    N[3] = 0;
    racine.style.display = 'none';
  }

  function image(dt) {
    if (N[3] !== 1) return;
    const at = pauseAgent.vitrineAttente() ? 1 : 0; // modèle de l'agent pas encore là : la toile apparaîtra en fondu
    if (at !== N[4]) {
      N[4] = at;
      racine.classList.toggle('sr-attente', at === 1);
    }
    X[0] = Math.min(0.1, Math.max(0, dt));
    poussiereImage();
  }

  function liberer() {
    cacher();
    window.removeEventListener('resize', surRedim);
    racine.remove();
  }

  return {
    afficher,
    cacher,
    image,
    liberer,
    racine,
    etat: () => ({ agent: E.agent, skin: E.skin, particules: NB, visible: N[3] === 1 }),
  };
}
