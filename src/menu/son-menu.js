// MENU PRINCIPAL — son de l'écran titre : la nappe d'ambiance (assets/ambiance/deep-melody-drone.wav, en boucle avec
// fondu enchaîné) et des sons EXISTANTS du manifeste (assets/sfx/manifeste.json) aux moments forts : pas des boss
// (BOSS_STEP, un fichier différent à chaque pas), tir de tourelle (BLASTER), rail (RAIL), impact de l'atterrissage
// (BOSS_SLAM), alarme lointaine (BOSS_ALARM).
// Rien n'est créé avant un geste de l'utilisateur (clic, touche) : aucun AudioContext « non autorisé » dans la console.
// Les fichiers sont téléchargés tout de suite (ArrayBuffer) et décodés au premier geste. Son bloqué, fichier absent ou
// décodage refusé : le menu reste muet, sans erreur.
// Chaîne (celle du jeu et de outils/mixer_previs.py) : source → gain du son (manifeste) × gain du moment → gain
// général (volume × bus × appoint) → limiteur (−12 dBFS, ratio 20) → sortie. Chaque départ est aussi JOURNALISÉ
// (journal : { t, id, gain }) pour mixer la même bande son sur une vidéo de prévis.
import { MENU } from './reglages-menu.js';

const S = MENU.son;
const IDS = ['BOSS_STEP', 'BLASTER', 'RAIL', 'BOSS_SLAM', 'BOSS_ALARM', 'SHOTGUN', 'ROCKET'];

export function creerSon({ base, volume = S.volumeDefaut, contexte = null }) {
  const st = { ac: contexte, maitre: null, pret: false, actif: true, volume, ambiance: null, tAmb: 0, erreur: null, debloque: false };
  const bruts = new Map(); // fichier → ArrayBuffer
  const tampons = new Map(); // fichier → AudioBuffer
  const tours = new Map(); // id → rang du prochain fichier
  const dernier = new Map(); // id → temps du dernier départ
  let manifeste = null;
  const journal = [];
  let horloge = 0; // temps du menu (s), donné par update

  // téléchargement immédiat (pas de contexte audio)
  const charge = (async () => {
    try {
      const r = await fetch(base + 'assets/sfx/manifeste.json');
      if (!r.ok) throw new Error('manifeste ' + r.status);
      manifeste = await r.json();
      const fichiers = new Set();
      for (const id of IDS) {
        const s = manifeste.sons[id];
        if (s) for (const f of s.fichiers) fichiers.add('assets/sfx/' + f.fichier);
      }
      if (manifeste.ambiance) fichiers.add('assets/ambiance/' + manifeste.ambiance.fichier);
      await Promise.all(
        [...fichiers].map(async (f) => {
          try {
            const rr = await fetch(base + f);
            if (rr.ok) bruts.set(f, await rr.arrayBuffer());
          } catch (e) {
            /* fichier absent : ce son restera muet */
          }
        }),
      );
    } catch (e) {
      st.erreur = String(e.message || e);
    }
  })();

  async function decoder() {
    await charge;
    for (const [f, buf] of bruts) {
      if (tampons.has(f)) continue;
      try {
        tampons.set(f, await st.ac.decodeAudioData(buf.slice(0)));
      } catch (e) {
        /* décodage refusé : muet */
      }
    }
    st.pret = true;
    ambiance();
  }

  /** À appeler dans un gestionnaire de geste (clic, touche) : crée ou réveille le contexte. */
  function debloquer() {
    if (!st.actif) return;
    try {
      if (!st.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        st.ac = new AC();
      }
      if (!st.maitre) {
        const c = st.ac;
        const g = c.createGain();
        g.gain.value = st.volume * S.bus * S.appoint;
        const lim = c.createDynamicsCompressor();
        lim.threshold.value = -12;
        lim.ratio.value = 20;
        lim.knee.value = 0;
        lim.attack.value = 0.001;
        lim.release.value = 0.15;
        g.connect(lim);
        lim.connect(c.destination);
        st.maitre = g;
        decoder();
      }
      if (st.ac.state === 'suspended') st.ac.resume().catch(() => {});
      st.debloque = true;
    } catch (e) {
      st.erreur = String(e.message || e);
    }
  }

  function ambiance() {
    if (!st.pret || !st.actif || st.ambiance || !manifeste || !manifeste.ambiance) return;
    const buf = tampons.get('assets/ambiance/' + manifeste.ambiance.fichier);
    if (!buf) return;
    // deux lecteurs en alternance, fondu enchaîné de manifeste.ambiance.fonduEnchaine s
    const c = st.ac;
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(st.maitre);
    g.gain.setTargetAtTime(S.ambiance, c.currentTime, S.fonduAmbiance / 3);
    st.ambiance = { g, sources: [], prochain: c.currentTime, buf, fondu: manifeste.ambiance.fonduEnchaine || 2 };
    planifierAmbiance();
  }
  function planifierAmbiance() {
    const a = st.ambiance;
    if (!a) return;
    const c = st.ac;
    while (a.prochain < c.currentTime + 4) {
      const s = c.createBufferSource();
      s.buffer = a.buf;
      const e = c.createGain();
      const d = a.buf.duration;
      const t0 = a.prochain;
      e.gain.setValueAtTime(0, t0);
      e.gain.linearRampToValueAtTime(1, t0 + a.fondu);
      e.gain.setValueAtTime(1, t0 + d - a.fondu);
      e.gain.linearRampToValueAtTime(0, t0 + d);
      s.connect(e);
      e.connect(a.g);
      s.start(t0);
      s.onended = () => {
        s.disconnect();
        e.disconnect();
      };
      a.sources.push(s);
      if (a.sources.length > 4) a.sources.shift();
      a.prochain = t0 + d - a.fondu;
    }
  }

  /**
   * Joue le son `id` du manifeste, gain relatif k. Écart minimal par son (évite les doublons d'une même image).
   * Journalisé même muet (prévis).
   */
  function jouer(id, k = 1) {
    const ecart = id === 'BOSS_STEP' ? 0.18 : 0.06;
    const d = dernier.get(id);
    if (d !== undefined && horloge - d < ecart) return;
    dernier.set(id, horloge);
    journal.push({ t: horloge, id, gain: Math.round(k * 1e4) / 1e4 });
    if (journal.length > 4000) journal.shift();
    if (!st.pret || !st.actif || !manifeste) return;
    const s = manifeste.sons[id];
    if (!s) return;
    const r = tours.get(id) || 0;
    tours.set(id, r + 1);
    const f = 'assets/sfx/' + s.fichiers[r % s.fichiers.length].fichier;
    const buf = tampons.get(f);
    if (!buf) return;
    try {
      const c = st.ac;
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = (s.gain || 0.2) * k;
      src.connect(g);
      g.connect(st.maitre);
      src.onended = () => {
        src.disconnect();
        g.disconnect();
      };
      src.start();
    } catch (e) {
      /* contexte fermé : muet */
    }
  }

  function update(t) {
    horloge = t;
    if (st.ambiance && st.ac) planifierAmbiance();
  }

  function setVolume(v) {
    st.volume = v;
    if (st.maitre) st.maitre.gain.value = v * S.bus * S.appoint;
  }

  /** Coupe le son du menu (fondu court) : lancement de la partie. reprendre() le relance au retour au titre. */
  function couper() {
    st.actif = false;
    const a = st.ambiance;
    st.ambiance = null;
    if (a && st.ac) {
      try {
        a.g.gain.setTargetAtTime(0, st.ac.currentTime, 0.25);
        const fin = st.ac.currentTime + 1.5;
        for (const s of a.sources) s.stop(fin);
      } catch (e) {
        /* déjà arrêté */
      }
    }
  }
  function reprendre() {
    st.actif = true;
    if (st.pret) ambiance();
  }
  /** Ferme le contexte s'il appartient au menu (pas celui du jeu passé en `contexte`). */
  function liberer() {
    couper();
    if (st.ac && !contexte) st.ac.close().catch(() => {});
    st.ac = null;
    st.maitre = null;
    bruts.clear();
    tampons.clear();
  }

  return { debloquer, jouer, update, setVolume, couper, reprendre, liberer, journal, etat: st, charge };
}

/**
 * Son du menu DANS LE JEU (intégration du 14/11/2026, ARCHITECTURE.md § Z octies) : mêmes appels que creerSon, mais
 * chaque moment fort passe par audio.js (audio.playGain(SFX[id], k) : fichiers du manifeste, variantes à tour de rôle,
 * règles de voix du jeu, volume général du jeu). Pas de contexte à part : le déblocage est celui du jeu (premier geste,
 * input → audio.unlock) et la nappe d'ambiance est celle d'audio.js, montée au niveau du titre par main.js
 * (audio.setAmbiance). Le journal reste tenu (prévis), sans allocation au-delà de son plafond.
 */
export function sonDuJeu(audio, SFX) {
  const journal = [];
  let horloge = 0;
  const st = { ac: null, pret: true, actif: true, debloque: true, volume: 1, erreur: null };
  function jouer(id, k = 1) {
    const n = SFX[id];
    if (n === undefined) return;
    if (journal.length < 4000) journal.push({ t: horloge, id, gain: Math.round(k * 1e4) / 1e4 });
    audio.playGain(n, k);
  }
  return {
    debloquer() {},
    jouer,
    update(t) {
      horloge = t;
    },
    setVolume() {},
    couper() {
      st.actif = false;
    },
    reprendre() {
      st.actif = true;
    },
    liberer() {
      st.actif = false;
    },
    journal,
    etat: st,
    charge: Promise.resolve(),
  };
}
