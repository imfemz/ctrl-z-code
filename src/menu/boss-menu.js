// MENU PRINCIPAL — les BOSS géants derrière le héros (phase 2 : pièces incandescentes, fissures et yeux rouges, flammes
// simulées aux cheminées).
//
// Modèle : assets/modeles/boss.glb lu par src/anim/pieces.js (toutes les pièces, phase 2 comprise), une géométrie
// partagée par les trois boss, un squelette par boss (un os par pièce, même méthode que src/anim/boss-corps.js).
// p2_flammes (cônes figés) est masqué : remplacé par les particules de src/anim/flammes.js — une INSTANCE À PART
// (import « flammes.js?menu ») pour ne jamais toucher aux flammes du boss du jeu. Les boss sont agrandis (×2,7 à ×3,6) :
// les flammes vivent dans un groupe à la même échelle (positions et vitesses suivent), et leur taille d'émission est
// mise à l'échelle le temps de l'appel (ANIM.flammes.tailleFeu / tailleFumee posés puis rendus).
// Deux comportements : « debout » (respiration, tête qui suit le héros, piétinement lourd périodique) et « marche »
// (ronde lente d'un bout à l'autre d'une piste, demi-tour sur place) ; la marche reprend la foulée de compas de
// boss-corps.js (jambe d'appui tendue qui recule linéairement : pied immobile au sol ; jambe libre genou plié).
// Chaque appui (marche ou piétinement) appelle evenement('PAS', x, y, z, échelle) : son, poussière, secousse.
// Aucune allocation par image.
import * as THREE from 'three';
import { chargerPieces } from '../anim/pieces.js';
import { ANIM } from '../anim/reglages.js';
import { createPaintedMaterial } from '../rendu/materiaux.js';
import { PEINT } from '../rendu/reglages.js';
import { MENU, ORIENTATION, versMonde } from './reglages-menu.js';
import { MARCHE } from '../anim/ref-marche.js';

const B = ANIM.boss;
const TAU = Math.PI * 2;
const ECHELLE_FLAMMES = 3.1;

function squelette(d, os) {
  const root = new THREE.Bone();
  const list = [root];
  const objs = d.pieces.map((p) => {
    const b = new THREE.Bone();
    b.name = p.nom;
    os[p.nom] = b;
    list.push(b);
    return b;
  });
  d.pieces.forEach((p, i) => {
    const parent = p.parent >= 0 ? objs[p.parent] : root;
    const pp = p.parent >= 0 ? d.pieces[p.parent].pivot : [0, 0, 0];
    objs[i].position.set(p.pivot[0] - pp[0], p.pivot[1] - pp[1], p.pivot[2] - pp[2]);
    parent.add(objs[i]);
  });
  return { root, list };
}

/** scene ; base ; solY(x, z) ; heros : [x, y, z] (la tête des boss le suit) ; evenement(type, x, y, z, k). */
export async function creerBoss({ scene, base, solY, heros, evenement }) {
  const d = await chargerPieces(base + 'assets/modeles/boss.glb');
  const flammes = await import('../anim/flammes.js?menu');
  const g = d.geometry;
  const n = g.attributes.position.count;
  const pc = g.attributes.piece.array;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    si[i * 4] = pc[i] + 1;
    sw[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  // cheminées : base des cônes de p2_flammes (comme boss-corps.js), fissures, cotes des jambes
  const pos = g.attributes.position.array;
  const ip = d.pieces.findIndex((p) => p.nom === 'p2_flammes');
  const LOC = new Float64Array(6);
  for (let c = 0; c < 2; c++) {
    let ymin = 1e9;
    for (let v = 0; v < pc.length; v++) if (pc[v] === ip && pos[v * 3] > 0 === (c === 0)) ymin = Math.min(ymin, pos[v * 3 + 1]);
    let sx = 0;
    let sz = 0;
    let k = 0;
    for (let v = 0; v < pc.length; v++)
      if (pc[v] === ip && pos[v * 3] > 0 === (c === 0) && pos[v * 3 + 1] < ymin + 0.08) {
        sx += pos[v * 3];
        sz += pos[v * 3 + 2];
        k++;
      }
    LOC[c * 3] = k ? sx / k : c === 0 ? 0.8 : -0.8;
    LOC[c * 3 + 1] = ymin < 1e8 ? ymin : 5.0;
    LOC[c * 3 + 2] = k ? sz / k : -1.45;
  }
  const piv = (nom, def) => {
    const p = d.pieces.find((x) => x.nom === nom);
    return p ? p.pivot : def;
  };
  const FIS = piv('p2_fissures', [0, 3, 0.8]);
  const hanche = piv('jambe_g', [0, 1.8, 0])[1];
  const cheville = piv('pied_g', [0, 0.55, 0])[1];

  // profil du boss du menu (déclaré dans config.js, région menu:reglages) : celui du jeu, avec un liseré CHAUD
  // (contre-jour du soleil couchant sur la silhouette)
  if (!PEINT.profils.bossMenu) throw new Error('profil peint « bossMenu » absent de config.js');
  const materiau = createPaintedMaterial({ profil: 'bossMenu', glowColor: 0xff3b3b, emissiveBoost: 2.6 });
  const groupeFlammes = new THREE.Group();
  groupeFlammes.name = 'menu-flammes';
  groupeFlammes.scale.setScalar(ECHELLE_FLAMMES);
  scene.add(groupeFlammes);
  flammes.init(groupeFlammes);

  const liste = [];
  MENU.boss.forEach((cfg, b) => {
    const os = {};
    const { root, list } = squelette(d, os);
    const mesh = new THREE.SkinnedMesh(g, materiau);
    mesh.name = 'menu-boss-' + b;
    mesh.add(root);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(list));
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    if (os.p2_flammes) os.p2_flammes.scale.setScalar(1e-4);
    mesh.scale.setScalar(cfg.echelle);
    mesh.rotation.order = 'YXZ';
    scene.add(mesh);
    for (const k of ['jambe_g', 'jambe_d', 'tibia_g', 'tibia_d', 'pied_g', 'pied_d', 'bras_g', 'bras_d', 'tete']) if (os[k]) os[k].rotation.order = 'YXZ';
    liste.push({
      cfg,
      os,
      mesh,
      // 0 phase de pas, 1 x, 2 sens (±1), 3 cap, 4 dernier appui, 5 temps, 6 demi-tour (s), 7 piétinement (s), 8 tête,
      // 9 jambe suivante (piétinement), 10 lacet des hanches, 11 position u ∈ [0, 1) dans le cycle de Walking,
      // 12 jambe d'ancrage (−1 = aucune), 13 point d'ancrage (0 talon, 1 plante), 14-16 ancrage en monde,
      // 17 cap au début du demi-tour, 18 lacet de la tête (lissé)
      S: new Float64Array(19),
    });
  });
  const v = new THREE.Vector3();
  const XZ0 = [0, 0];

  // ===== MARCHE DE RÉFÉRENCE (16/11, Femz : le boss de l'accueil marche comme celui du jeu) — cuisse, genou, pied et
  // orteils suivent les courbes de Walking (src/anim/ref-marche.js, comme src/anim/boss-corps.js), jambe droite décalée
  // d'un demi-cycle. Pas de cinématique inverse : c'est le CORPS qui avance d'autant que le pied d'appui recule (talon
  // au contact, plante quand le talon se lève), et le bassin se cale pour que ce pied touche le sol — le pied d'appui
  // ne glisse pas par construction. Les hanches pivotent (lacet) pour que les jambes marchent le long de la piste
  // pendant que le buste reste tourné vers la caméra (cfg.cap).
  const DEG = Math.PI / 180;
  const RC = { n: MARCHE.n, cuisse: Float64Array.from(MARCHE.cuisse, (a) => a * DEG), genou: Float64Array.from(MARCHE.genou, (a) => a * DEG), pied: Float64Array.from(MARCHE.pied, (a) => a * DEG), orteils: Float64Array.from(MARCHE.orteils, (a) => a * DEG) };
  // semelle, dans le repère de l'os du pied (cheville) : talon derrière, plante = pli des orteils (mesurés sur le modèle)
  const SEM = new Float64Array([0.4, 0.5, 0.55]); // talon, plante, hauteur de cheville
  {
    const ipg = d.pieces.findIndex((p) => p.nom === 'pied_g');
    const io = d.pieces.findIndex((p) => p.nom === 'orteils_g');
    if (ipg >= 0) {
      let zmin = 1e9;
      for (let k = 0; k < pc.length; k++) if (pc[k] === ipg && pos[k * 3 + 2] < zmin) zmin = pos[k * 3 + 2];
      const pv = d.pieces[ipg].pivot;
      SEM[0] = Math.max(0.05, pv[2] - zmin);
      SEM[1] = io >= 0 ? d.pieces[io].pivot[2] - pv[2] : SEM[1];
      SEM[2] = pv[1];
    }
  }
  const POSE = new Float64Array(4);
  const PHI = new Float64Array(2);
  const UK = new Float64Array(2);
  const pw = new THREE.Vector3();
  const DIR = new Float64Array(2); // sens de la piste en monde (menu +X)
  {
    versMonde(1, 0, XZ0);
    const ax = XZ0[0];
    const az = XZ0[1];
    versMonde(0, 0, XZ0);
    const n = Math.hypot(ax - XZ0[0], az - XZ0[1]) || 1;
    DIR[0] = (ax - XZ0[0]) / n;
    DIR[1] = (az - XZ0[1]) / n;
  }

  function lireRef(u) {
    const x = (u - Math.floor(u)) * RC.n;
    const i = Math.floor(x) % RC.n;
    const j = (i + 1) % RC.n;
    const f = x - Math.floor(x);
    POSE[0] = RC.cuisse[i] + (RC.cuisse[j] - RC.cuisse[i]) * f;
    POSE[1] = RC.genou[i] + (RC.genou[j] - RC.genou[i]) * f;
    POSE[2] = RC.pied[i] + (RC.pied[j] - RC.pied[i]) * f;
    POSE[3] = RC.orteils[i] + (RC.orteils[j] - RC.orteils[i]) * f;
  }

  /** Pose des deux jambes à la position u du cycle ; lacet des hanches ; renvoie le balancier (cuisse g − milieu). */
  function poserJambes(os, u, lacet) {
    const ech = B.piedEchelle || 1;
    for (let k = 0; k < 2; k++) {
      const uk = (u + 0.5 * k) % 1;
      UK[k] = uk;
      lireRef(uk);
      const th = POSE[0];
      const kap = POSE[1];
      const sp = Math.sin(POSE[2]) * ech; // pied démesuré : hauteur gagnée par la pointe, pas l'angle (comme le jeu)
      const phi = Math.asin(sp > 1 ? 1 : sp < -1 ? -1 : sp);
      PHI[k] = phi;
      const j = k === 0 ? os.jambe_g : os.jambe_d;
      j.rotation.x = -th;
      j.rotation.y = lacet;
      (k === 0 ? os.tibia_g : os.tibia_d).rotation.x = kap;
      (k === 0 ? os.pied_g : os.pied_d).rotation.x = phi + th - kap;
      const o = k === 0 ? os.orteils_g : os.orteils_d;
      // appui talon levé : orteils à plat au sol ; sinon pli de la réf, jamais plus bas que l'horizontale
      if (o) o.rotation.x = uk < MARCHE.appui && phi > 0 ? -phi : -Math.max(POSE[3], phi);
    }
    return 0;
  }

  /** Point de semelle (0 talon, 1 plante) du pied k, en monde. */
  function semelle(os, k, pt, out) {
    const pied = k === 0 ? os.pied_g : os.pied_d;
    out.set(0, -SEM[2], pt === 0 ? -SEM[0] : SEM[1]).applyMatrix4(pied.matrixWorld);
    return out;
  }

  const inv = new THREE.Matrix4();
  const pa = new THREE.Vector3();
  const ph = new THREE.Vector3();
  const genouY = piv('tibia_g', [0, 1.12, 0])[1];
  const LA = hanche - genouY; // cuisse
  const LB = genouY - cheville; // tibia
  const TOE = new Float64Array([0.06, 0.66]); // bout des orteils dans le repère de leur os (hauteur, longueur), mesuré
  {
    const io = d.pieces.findIndex((p) => p.nom === 'orteils_g');
    if (io >= 0) {
      let zo = -1e9;
      for (let k = 0; k < pc.length; k++) if (pc[k] === io && pos[k * 3 + 2] > zo) zo = pos[k * 3 + 2];
      TOE[0] = d.pieces[io].pivot[1];
      TOE[1] = zo - d.pieces[io].pivot[2];
    }
  }

  /** Hauteur au-dessus du sol (monde) du point le plus bas de la semelle du pied k : talon, plante, bout des orteils. */
  function garde(os, k) {
    let m = 1e9;
    for (let pt = 0; pt < 2; pt++) {
      semelle(os, k, pt, pa);
      const h = pa.y - solY(pa.x, pa.z);
      if (h < m) m = h;
    }
    const o = k === 0 ? os.orteils_g : os.orteils_d;
    if (o) {
      pa.set(0, -TOE[0], TOE[1]).applyMatrix4(o.matrixWorld);
      const h = pa.y - solY(pa.x, pa.z);
      if (h < m) m = h;
    }
    return m;
  }

  /** Pied k qui passerait sous le sol (talon qui arrive, pointe qui part : jambes du boss ≠ proportions de la réf) :
   *  la jambe se plie juste assez pour remonter la cheville de dy (monde), inclinaison du pied gardée. */
  function releverPied(os, mesh, k, dy, sc) {
    const j = k === 0 ? os.jambe_g : os.jambe_d;
    const t = k === 0 ? os.tibia_g : os.tibia_d;
    const pied = k === 0 ? os.pied_g : os.pied_d;
    const phi = pied.rotation.x + j.rotation.x + t.rotation.x; // tangage du pied dans le repère du corps
    inv.copy(mesh.matrixWorld).invert();
    pa.setFromMatrixPosition(pied.matrixWorld);
    pa.y += dy;
    pa.applyMatrix4(inv); // cheville visée, repère du modèle
    ph.setFromMatrixPosition(j.matrixWorld).applyMatrix4(inv); // hanche
    let dx = pa.x - ph.x;
    let dyl = pa.y - ph.y;
    let dz = pa.z - ph.z;
    // repère des hanches (sans le lacet)
    const c = Math.cos(-j.rotation.y);
    const si = Math.sin(-j.rotation.y);
    const zx = dz * si + dx * c;
    dz = dz * c - dx * si;
    dx = zx;
    let D = Math.hypot(dyl, dz);
    if (D > LA + LB - 1e-4) D = LA + LB - 1e-4;
    const th = Math.atan2(-dz, -dyl);
    let cg = (LA * LA + LB * LB - D * D) / (2 * LA * LB);
    cg = cg > 1 ? 1 : cg < -1 ? -1 : cg;
    const kap = Math.PI - Math.acos(cg);
    let cb = (LA * LA + D * D - LB * LB) / (2 * LA * D);
    cb = cb > 1 ? 1 : cb < -1 ? -1 : cb;
    j.rotation.x = th - Math.acos(cb);
    t.rotation.x = kap;
    pied.rotation.x = phi - j.rotation.x - kap;
    void dx;
    void sc;
    j.updateMatrixWorld(true);
  }

  /** Jambe d'appui la plus récemment posée (u le plus petit parmi les pieds en appui). */
  function jambeAppui() {
    const a0 = UK[0] < MARCHE.appui;
    const a1 = UK[1] < MARCHE.appui;
    if (a0 && a1) return UK[0] < UK[1] ? 0 : 1;
    return a0 ? 0 : a1 ? 1 : UK[0] > UK[1] ? 0 : 1;
  }

  // avance du corps par cycle (modèle, m), mesurée une fois à vide sur le premier boss : règle la cadence nominale
  let CYCLE = 2 * (hanche - cheville);
  {
    const b0 = liste[0];
    if (b0) {
      const m = b0.mesh;
      m.position.set(0, 0, 0);
      m.rotation.set(0, 0, 0);
      m.scale.setScalar(1);
      let tot = 0;
      let k0 = -1;
      let p0 = 0;
      let z0 = 0;
      for (let s = 0; s <= 400; s++) {
        poserJambes(b0.os, s / 400, 0);
        m.updateMatrixWorld(true);
        const k = jambeAppui();
        const p = PHI[k] > 0 ? 1 : 0;
        semelle(b0.os, k, p, pw);
        if (k === k0 && p === p0) tot += z0 - pw.z;
        k0 = k;
        p0 = p;
        z0 = pw.z;
      }
      if (tot > 0.2) CYCLE = tot;
      m.scale.setScalar(b0.cfg.echelle);
    }
  }
  const XZ = [0, 0];

  function reset() {
    for (const b of liste) {
      const S = b.S;
      S.fill(0);
      S[1] = b.cfg.mode === 'marche' ? b.cfg.piste[0] + (b.cfg.piste[1] - b.cfg.piste[0]) * 0.55 : b.cfg.x;
      S[2] = -1;
      S[3] = b.cfg.cap;
      S[4] = -1;
      S[7] = b.cfg.phase;
      S[10] = b.cfg.cap; // lacet des hanches (sens −1 : jambes dans l'axe de la piste)
      S[11] = b.cfg.phase % 1;
      S[12] = -1;
      S[18] = 0.35;
    }
    flammes.reset();
  }

  function appui(b, cote) {
    const pied = cote === 0 ? b.os.pied_g || b.os.tibia_g : b.os.pied_d || b.os.tibia_d;
    pied.getWorldPosition(v);
    evenement('PAS', v.x, solY(v.x, v.z), v.z, b.cfg.echelle);
  }

  function update(dt, t) {
    for (const b of liste) {
      const { os, mesh, S, cfg } = b;
      S[5] += dt;
      const sc = cfg.echelle;
      let descente = 0;
      let x = cfg.x;
      const z = cfg.z;
      // respiration : épaules et tête
      const resp = Math.sin(S[5] * 0.9 + cfg.phase);
      if (cfg.mode === 'marche') {
        // ronde le long de X, demi-tour aux bouts (sur place) ; jambes sur les courbes de Walking (voir plus haut)
        const vit = cfg.vitesse / sc; // m/s du modèle
        const tourne = S[6] > 0;
        if (tourne) {
          S[6] -= dt;
          const u = 1 - Math.max(0, S[6]) / 2.4;
          // du cap réel au début du demi-tour (biais vers la caméra compris) au cap de la nouvelle ronde : avant, le
          // biais changeait de signe d'une image à l'autre (corps 40°, tête 80° d'un coup)
          const cible = (S[2] > 0 ? Math.PI / 2 : -Math.PI / 2) + S[2] * cfg.cap;
          S[3] = S[17] + (cible - S[17]) * (u * u * (3 - 2 * u));
          S[11] += ((0.6 * vit) / CYCLE) * dt; // petits pas sur place
        } else {
          S[11] += (vit / CYCLE) * dt;
          // un peu tourné vers la caméra (menace) : le cap de marche est biaisé de cfg.cap
          S[3] = (S[2] > 0 ? Math.PI / 2 : -Math.PI / 2) + S[2] * cfg.cap;
          if ((S[2] > 0 && S[1] >= cfg.piste[1]) || (S[2] < 0 && S[1] <= cfg.piste[0])) {
            S[17] = S[3];
            S[2] = -S[2];
            S[6] = 2.4;
            S[12] = -1;
          }
        }
        S[11] -= Math.floor(S[11]);
        // les hanches compensent le biais du buste pour que les pieds suivent la piste
        S[10] += (-S[2] * cfg.cap - S[10]) * (1 - Math.exp(-1.5 * dt));
        const u0 = UK[0];
        const u1 = UK[1];
        poserJambes(os, S[11], S[10]);
        if (S[12] >= 0 && UK[0] < u0 - 0.5) appui(b, 0);
        if (S[12] >= 0 && UK[1] < u1 - 0.5) appui(b, 1);
        // bras : balancier opposé aux cuisses (amplitude de la réf)
        lireRef(UK[0]);
        os.bras_g.rotation.x = 0.5 * (POSE[0] - 0.29);
        lireRef(UK[1]);
        os.bras_d.rotation.x = 0.5 * (POSE[0] - 0.29);
        os.bras_g.rotation.z = 0;
        os.bras_d.rotation.z = 0;
        // pied d'appui cloué : le corps avance (le long de la piste) d'autant que le point d'appui a reculé
        versMonde(S[1], z, XZ);
        mesh.position.set(XZ[0], mesh.position.y, XZ[1]);
        mesh.rotation.set(cfg.mode === 'marche' ? 0 : 0.02 * resp, S[3] + ORIENTATION, 0); // marcheur : pas de bascule (elle enfonçait la pointe du pied d'appui)
        mesh.updateMatrixWorld(true);
        const k = jambeAppui();
        const pt = PHI[k] > 0 ? 1 : 0;
        semelle(os, k, pt, pw);
        if (!tourne && S[12] === k && S[13] === pt) {
          const av = (S[14] - pw.x) * DIR[0] + (S[16] - pw.z) * DIR[1];
          S[1] += av;
          pw.x += av * DIR[0];
          pw.z += av * DIR[1];
        }
        S[12] = k;
        S[13] = pt;
        S[14] = pw.x;
        S[15] = pw.y;
        S[16] = pw.z;
        x = S[1];
        // pied libre sous le sol : relevé (deux passes, la seconde rattrape les orteils), bassin compris
        {
          const dyB = solY(pw.x, pw.z) - pw.y; // le bassin va bouger de dyB : le pied libre aussi
          const kl = 1 - k;
          for (let it = 0; it < 2; it++) {
            const h = garde(os, kl) + dyB;
            if (h >= 0.01 * sc) break;
            releverPied(os, mesh, kl, 0.01 * sc - h, sc);
          }
        }
        // bassin : le point d'appui touche le sol (descente = ce qu'il faut retirer à la position au sol, en modèle)
        versMonde(x, z, XZ);
        descente = (pw.y - mesh.position.y + solY(XZ[0], XZ[1]) - solY(pw.x, pw.z)) / sc; // terrain en pente : sol SOUS le pied
        S[18] += (-S[2] * 0.35 - S[18]) * (1 - Math.exp(-2 * dt)); // la tête tourne avec le demi-tour, sans à-coup
        os.tete.rotation.y = S[18] + 0.08 * Math.sin(S[5] * 0.4);
        os.tete.rotation.x = 0.05 * Math.sin(4 * Math.PI * S[11]) + 0.06;
      } else {
        // debout : piétinement lourd périodique (une jambe se lève, retombe d'un coup)
        S[7] -= dt;
        const per = cfg.piétinement;
        if (S[7] < -per + 1.6) {
          S[7] += per;
          S[9] += 1; // jambe suivante
        }
        // fenêtre de 1,6 s : levée (1,1 s) puis frappe (0,12 s) puis tassement
        const w = -S[7];
        const cote = S[9] & 1;
        let leve = 0;
        let frappe = 0;
        if (w > 0 && w < 1.6) {
          if (w < 1.1) leve = Math.sin((Math.PI / 2) * (w / 1.1));
          else if (w < 1.22) leve = 1 - (w - 1.1) / 0.12;
          else frappe = Math.exp(-(w - 1.22) * 8);
          if (w >= 1.22 && w - dt < 1.22) appui(b, cote);
        }
        const jl = cote === 0 ? os.jambe_g : os.jambe_d;
        const tl = cote === 0 ? os.tibia_g : os.tibia_d;
        const pl = cote === 0 ? os.pied_g : os.pied_d;
        const ja = cote === 0 ? os.jambe_d : os.jambe_g;
        const ta = cote === 0 ? os.tibia_d : os.tibia_g;
        const pa = cote === 0 ? os.pied_d : os.pied_g;
        jl.rotation.x = -0.5 * leve;
        tl.rotation.x = 0.85 * leve;
        if (pl) pl.rotation.x = 0.5 * leve - 0.85 * leve;
        ja.rotation.x = 0;
        ta.rotation.x = 0.06 * frappe;
        if (pa) pa.rotation.x = -0.06 * frappe;
        jl.rotation.z = 0;
        ja.rotation.z = 0;
        descente = 0.12 * frappe + 0.02 * resp;
        // bras : écartés, poings prêts ; levés pendant la levée de la jambe (élan)
        os.bras_g.rotation.x = -0.12 - 0.35 * leve + 0.04 * resp;
        os.bras_d.rotation.x = -0.12 - 0.35 * leve + 0.04 * resp;
        os.bras_g.rotation.z = 0.12 + 0.08 * leve;
        os.bras_d.rotation.z = -0.12 - 0.08 * leve;
        // tête : suit le héros, baissée (regard menaçant), recule à la frappe
        versMonde(x, z, XZ);
        v.set(heros[0] - XZ[0], 0, heros[2] - XZ[1]);
        const visee = Math.atan2(v.x, v.z) - S[3] - ORIENTATION;
        S[8] += (visee - S[8]) * (1 - Math.exp(-dt * 0.8));
        os.tete.rotation.y = Math.max(-0.5, Math.min(0.5, S[8]));
        os.tete.rotation.x = 0.16 + 0.03 * resp - 0.1 * frappe;
        S[3] = cfg.cap + 0.04 * Math.sin(S[5] * 0.23 + cfg.phase);
      }
      // réacteur et poings : pulsation
      if (os.p2_reacteur) os.p2_reacteur.scale.setScalar(1 + 0.08 * Math.sin(S[5] * 13));
      versMonde(x, z, XZ);
      mesh.position.set(XZ[0], solY(XZ[0], XZ[1]) - descente * sc, XZ[1]);
      mesh.rotation.set(cfg.mode === 'marche' ? 0 : 0.02 * resp, S[3] + ORIENTATION, 0); // marcheur : pas de bascule (elle enfonçait la pointe du pied d'appui)
      mesh.updateMatrixWorld(true);
    }
    // ----- flammes : deux cheminées par boss (émetteurs 0 à 5), fissures du plus proche (6) et du marcheur (7)
    const EM = flammes.EM;
    const k = 1 / ECHELLE_FLAMMES;
    for (let b = 0; b < liste.length && b < 3; b++) {
      const M = liste[b].mesh.matrixWorld.elements;
      for (let c = 0; c < 2; c++) {
        const lx = LOC[c * 3];
        const ly = LOC[c * 3 + 1];
        const lz = LOC[c * 3 + 2];
        const o = (b * 2 + c) * 10;
        EM[o] = (M[0] * lx + M[4] * ly + M[8] * lz + M[12]) * k;
        EM[o + 1] = (M[1] * lx + M[5] * ly + M[9] * lz + M[13]) * k;
        EM[o + 2] = (M[2] * lx + M[6] * ly + M[10] * lz + M[14]) * k;
        EM[o + 3] = 0;
        EM[o + 4] = 0;
        EM[o + 5] = 0;
        EM[o + 6] = B.debitCheminee * (b === 0 ? 0.85 : 0.6);
        EM[o + 7] = 0;
        EM[o + 8] = 0.2 * liste[b].cfg.echelle * k;
        EM[o + 9] = 2.6 * liste[b].cfg.echelle * k;
      }
    }
    for (let e = 0; e < 2; e++) {
      const b = e === 0 ? 0 : 1;
      if (!liste[b]) continue;
      const M = liste[b].mesh.matrixWorld.elements;
      const o = (6 + e) * 10;
      EM[o] = (M[0] * FIS[0] + M[4] * FIS[1] + M[8] * FIS[2] + M[12]) * k;
      EM[o + 1] = (M[1] * FIS[0] + M[5] * FIS[1] + M[9] * FIS[2] + M[13]) * k;
      EM[o + 2] = (M[2] * FIS[0] + M[6] * FIS[1] + M[10] * FIS[2] + M[14]) * k;
      EM[o + 6] = B.debitFissures;
      EM[o + 7] = 0;
      EM[o + 8] = 0.5 * liste[b].cfg.echelle * k;
      EM[o + 9] = 0.9 * liste[b].cfg.echelle * k;
    }
    const F = ANIM.flammes;
    const tf = F.tailleFeu;
    const tu = F.tailleFumee;
    F.tailleFeu = tf * ECHELLE_FLAMMES * 0.5;
    F.tailleFumee = tu * ECHELLE_FLAMMES * 0.55;
    flammes.entree[0] = dt;
    flammes.update();
    F.tailleFeu = tf;
    F.tailleFumee = tu;
    // fumée plus légère que dans le jeu : de loin, floue (profondeur de champ), elle faisait des taches orange
    const of = F.opaciteFumee;
    F.opaciteFumee = of * 0.4;
    flammes.sync();
    F.opaciteFumee = of;
    void t;
  }

  function liberer() {
    for (const b of liste) {
      scene.remove(b.mesh);
      b.mesh.skeleton.dispose();
    }
    g.dispose();
    materiau.dispose();
    for (const c of groupeFlammes.children) {
      c.geometry.dispose();
      c.material.dispose();
    }
    scene.remove(groupeFlammes);
  }

  reset();
  return { liste, update, reset, liberer, flammes, triangles: d.triangles * liste.length };
}
