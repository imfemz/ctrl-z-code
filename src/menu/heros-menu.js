// MENU PRINCIPAL — le héros du « hero shot » : toutes ses armes (4 modules d'avant-bras, 4 tourelles d'épaule), sa
// cape au vent, une boucle de POSES D'ATTITUDE enchaînées en douceur.
//
// Modèle : assets/modeles/heros.glb lu par src/anim/pieces.js (une géométrie, attribut `piece`), skinné comme
// src/anim/heros-anim.js (un os par pièce, poids 1, torsion de l'abdomen mêlée entre bassin et buste) — mais le
// squelette est piloté ici par des CIBLES de pose (pieds, mains, directions) et deux os à 2 segments (bras, jambes)
// résolus par cinématique inverse : la pose du jeu (heros-anim) dépend de l'état du joueur (P), celle du menu non.
// Toutes les pièces d'armes restent visibles (échelle 1) : arme_blaster, arme_rail, arme_pompe, arme_roquettes,
// tourelle_<1..4>_socle/canon.
// Cape : une INSTANCE À PART de src/anim/cape.js (import « cape.js?menu » : un module ES par adresse), pour ne jamais
// toucher à la cape du joueur ; le vent du menu (constant + rafales) passe par ANIM.cape.souffle, posé le temps de
// l'appel puis rendu (le module le relit à chaque sous-pas).
// Enchaînement : transition = anticipation (le bassin se charge, les mains reculent un peu) puis ease in-out sur les
// cibles, bras et tête en léger retard (suivi), pas levés pour les pieds qui se déplacent ; maintien avec respiration,
// tourelles qui traquent lentement des cibles imaginaires, éclairs de bouche.
// Pieds (14/11, heros.glb à os de pied) : les jambes visent la CHEVILLE ; chaque pied est posé À PLAT sur le
// promontoire (aligné sur sa pente, la cheville compense le tibia), orteils dans l'axe. Pose « atterrissage » : UN genou
// au sol (POSES[].genouSol) — rotule posée sur la roche (hauteur étalonnée à l'init sur les sommets du tibia), tibia
// vers l'arrière, pied arrière dressé sur ses orteils fléchis à plat au sol, bassin bas (sa hauteur découle du genou) ;
// garde-fou à chaque image : aucun sommet d'un tibia sous la roche (le bassin remonte d'autant).
// Aucune allocation par image (vecteurs et matrices créés à l'init).
import * as THREE from 'three';
import { chargerPieces } from '../anim/pieces.js';
import { glitchOeil } from '../anim/oeil-glitch.js';
import { ANIM } from '../anim/reglages.js';
import { appliquerTexturesArmes, createPaintedMaterial } from '../rendu/materiaux.js';
import { PEINT } from '../rendu/reglages.js';
import { MENU, POSES, ORIENTATION, versMonde } from './reglages-menu.js';
import { chargerClip, sortieClip } from './clip-menu.js';
import { chargerBanque } from './banque-menu.js';
import { chargerCuit } from './cuit-menu.js';
import { creerRetarget } from '../anim/retarget.js';

const H = MENU.heros;
const TAU = Math.PI * 2;
const BAS = new THREE.Vector3(0, -1, 0);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lisse = (u) => u * u * (3 - 2 * u);
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
/** Hasard déterministe 0..1. */
export function hash(n) {
  let x = (n * 0x27d4eb2d) | 0;
  x = (x ^ (x >>> 15)) | 0;
  x = Math.imul(x, 0x85ebca6b);
  x = (x ^ (x >>> 13)) | 0;
  x = Math.imul(x, 0xc2b2ae35);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

/** Profil peint du héros du menu : celui du jeu, liseré cyan plus franc (contre-jour), émissifs plus forts. */
function profilMenu() {
  // déclaré dans config.js (région menu:reglages) : config.js est en lecture seule pour les modules
  if (!PEINT.profils.herosMenu) throw new Error('profil peint « herosMenu » absent de config.js');
  return 'herosMenu';
}

// ----- Texture ronde douce (éclairs) : générée en code ------------------------------------------------------------
let texRonde = null;
export function textureRonde() {
  if (texRonde) return texRonde;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  r.addColorStop(0.6, 'rgba(255,255,255,0.22)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  texRonde = new THREE.CanvasTexture(c);
  texRonde.colorSpace = THREE.NoColorSpace;
  return texRonde;
}

/**
 * Crée le héros. scene ; base : préfixe des adresses ('/') ; solY(x, z) : hauteur du promontoire sous (x, z) ;
 * camera : la caméra du menu (pose « rail vers la caméra ») ; evenement(type, x, y, z, gain) : sons et poussières.
 */
export async function creerHeros({ scene, base, solY, camera, evenement }) {
  // § E4.O : « ?modele=agent-bastion » — cuisson d'une animation sur le robot d'un autre agent (tests/cuire-anim.mjs)
  const qModele = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('modele') : null;
  const d = await chargerPieces(base + 'assets/modeles/' + (qModele && /^[a-z0-9-]+$/.test(qModele) ? qModele : 'heros') + '.glb', { textures: true }); // armes bakées (16/11)
  const capeMod = await import('../anim/cape.js?menu');
  const { geometry, pieces, vides } = d;
  const idx = {};
  pieces.forEach((p, i) => (idx[p.nom] = i));

  // ----- longueurs mesurées sur la géométrie (fin de l'avant-bras, hauteur de hanche…)
  const pos = geometry.attributes.position.array;
  const pc = geometry.attributes.piece.array;
  const piv = (n) => pieces[idx[n]].pivot;
  let finAvantBras = 0.38;
  {
    const i = idx.avant_bras_d;
    const p = piv('avant_bras_d');
    let m = 0;
    for (let v = 0; v < pc.length; v++) if (pc[v] === i) m = Math.max(m, p[1] - pos[v * 3 + 1]);
    finAvantBras = m * 0.92; // le poing, pas le bout de la bague
  }
  const HANCHE = piv('jambe_g')[1];
  // os de pied (heros.glb depuis le 14/11) : la jambe vise la cheville ; sans eux (heros-v6.glb), la semelle
  const PIEDS = idx.pied_g !== undefined && idx.orteils_g !== undefined;
  const PH = piv('jambe_g');
  const PG = piv('tibia_g');
  const PC = PIEDS ? piv('pied_g') : [PG[0], 0, PG[2]];
  const PO = PIEDS ? piv('orteils_g') : PC;
  const LJ1 = Math.hypot(PH[1] - PG[1], PH[2] - PG[2]); // hanche → genou
  const LJ2 = Math.hypot(PG[1] - PC[1], PG[2] - PC[2]); // genou → cheville
  const E1 = Math.atan2(PG[2] - PH[2], PH[1] - PG[1]); // genou en avant de la hanche (rad)
  const E2 = Math.atan2(PG[2] - PC[2], PG[1] - PC[1]); // cheville en arrière du genou (rad)
  const HC = PC[1]; // cheville au-dessus de la semelle
  const ZT = PO[2] - PC[2]; // base des orteils devant la cheville
  const YT = PO[1]; // base des orteils au-dessus de la semelle
  const PHG = piv('jambe_g');
  const PHD = piv('jambe_d');
  const LB1 = Math.hypot(piv('bras_g')[0] - piv('avant_bras_g')[0], piv('bras_g')[1] - piv('avant_bras_g')[1]);
  const LB2 = finAvantBras;
  const TAILLE = HANCHE + 0.083; // hauteur de l'os du buste (pivot de la torsion et du penché) : 8,3 cm au-dessus de la
  // hanche comme sur le héros v6–v8 (1,0 pour une hanche à 0,917 ; v10 : hanche 1,107)

  // ----- squelette (même méthode que heros-anim : skinIndex = pièce + 1)
  const n = geometry.attributes.position.count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    si[i * 4] = pc[i] + 1;
    sw[i * 4] = 1;
  }
  const racine = new THREE.Bone();
  racine.name = 'racine';
  racine.position.set(0, HANCHE, 0);
  racine.rotation.order = 'YXZ';
  const buste = new THREE.Bone();
  buste.name = 'buste';
  buste.rotation.order = 'YXZ';
  buste.position.set(0, TAILLE - HANCHE, 0);
  racine.add(buste);
  const os = { buste };
  const liste = [racine];
  const OEIL = new THREE.Vector3(); // repos de l'os de l'œil du casque (relu après la mise en place des os)
  const objs = pieces.map((p) => {
    const b = new THREE.Bone();
    b.name = p.nom;
    b.rotation.order = 'YXZ';
    os[p.nom] = b;
    liste.push(b);
    return b;
  });
  pieces.forEach((p, i) => {
    const haut = p.parent < 0 && /^(bras_|tete|tourelle_)/.test(p.nom);
    const parent = p.parent >= 0 ? objs[p.parent] : haut ? buste : racine;
    const pp = p.parent >= 0 ? pieces[p.parent].pivot : haut ? [0, TAILLE, 0] : [0, HANCHE, 0];
    objs[i].position.set(p.pivot[0] - pp[0], p.pivot[1] - pp[1], p.pivot[2] - pp[2]);
    parent.add(objs[i]);
  });
  // 21/11 : pièces des armes évoluées (arme_<arme>_evo) rangées — l'écran titre montre l'arsenal de base
  for (const nom in os) if (/_evo$/.test(nom)) os[nom].scale.setScalar(1e-4);
  if (os.oeil) OEIL.copy(os.oeil.position);
  liste.push(buste);
  const iCorps = idx.corps;
  const iBuste = liste.length - 1;
  const ab = ANIM.corps.abdomen;
  for (let v = 0; v < n; v++) {
    if (pc[v] !== iCorps) continue;
    let u = (pos[v * 3 + 1] - ab[0]) / (ab[1] - ab[0]);
    u = lisse(clamp01(u));
    si[v * 4] = iCorps + 1;
    si[v * 4 + 1] = iBuste;
    sw[v * 4] = 1 - u;
    sw[v * 4 + 1] = u;
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  const materiau = appliquerTexturesArmes(createPaintedMaterial({ profil: profilMenu(), glowColor: 0x3fe0d0 }), d.textures);
  const mesh = new THREE.SkinnedMesh(geometry, materiau);
  mesh.name = 'menu-heros';
  mesh.add(racine);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(liste));
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const BX = H.position[0];
  const BZ = H.position[1];
  const BY = solY(BX, BZ);
  mesh.position.set(BX, BY, BZ);
  scene.add(mesh);

  // ----- bouches (nœuds vides du .glb, accrochés à l'os de leur pièce)
  const bouche = {};
  const accroche = (nomVide, nomOs) => {
    const v = vides[nomVide];
    const b = os[nomOs];
    if (!v || !b) return null;
    const o = new THREE.Object3D();
    const p = piv(nomOs);
    o.position.set(v.position[0] - p[0], v.position[1] - p[1], v.position[2] - p[2]);
    b.add(o);
    bouche[nomVide] = o;
    return o;
  };
  for (const a of ['blaster', 'rail']) accroche('bouche_' + a, 'arme_' + a);
  for (const a of ['pompe', 'roquettes']) accroche('bouche_' + a, 'arme_' + a);
  for (let k = 1; k <= 4; k++) accroche('bouche_tourelle_' + k, 'tourelle_' + k + '_canon');

  // ----- cape (instance du menu)
  const vg = vides.cape_epaule_g ? vides.cape_epaule_g.position : [0.189, 1.513, -0.161];
  const vd = vides.cape_epaule_d ? vides.cape_epaule_d.position : [-0.189, 1.513, -0.161];
  const ud = vides.cape_dos ? vides.cape_dos.userData : {};
  const dos = ud.a && ud.b && ud.rayon ? { a: ud.a, b: ud.b, rayon: ud.rayon } : { a: [0, 1.054, -0.029], b: [0, 1.437, -0.029], rayon: 0.153 };
  capeMod.init({ scene, ancrageG: vg, ancrageD: vd, dos, jambes: { a: [0, 0.6, 0], b: [0, 0.61, 0], rayon: 0 }, corps: d });
  const capeMesh = capeMod.getMesh();
  capeMesh.name = 'menu-cape';

  // ----- éclairs de bouche (sprites additifs) et traçantes (rubans tournés vers la caméra)
  const NFLASH = 8;
  const flashs = [];
  for (let k = 0; k < NFLASH; k++) {
    const m = new THREE.SpriteMaterial({ map: textureRonde(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    const s = new THREE.Sprite(m);
    s.visible = false;
    s.renderOrder = 6;
    s.frustumCulled = false;
    scene.add(s);
    flashs.push({ s, age: 1e3, vie: 0.08, taille: 0.3, r: 1, g: 1, b: 1, os: null });
  }
  const NTRACE = 8;
  const traces = [];
  const geoTrace = new THREE.PlaneGeometry(1, 1);
  geoTrace.translate(0.5, 0, 0);
  const matTraceBase = new THREE.ShaderMaterial({
    uniforms: { uCouleur: { value: new THREE.Vector3(1, 1, 1) }, uA: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: `uniform vec3 uCouleur; uniform float uA; varying vec2 vUv;
      void main() { float w = 1.0 - abs( vUv.y - 0.5 ) * 2.0; w = w * w; float l = smoothstep( 0.0, 0.15, vUv.x ) * ( 1.0 - vUv.x * 0.7 );
        gl_FragColor = vec4( uCouleur * w * l * uA, 1.0 ); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  for (let k = 0; k < NTRACE; k++) {
    const m = new THREE.Mesh(geoTrace, matTraceBase.clone());
    m.visible = false;
    m.frustumCulled = false;
    m.renderOrder = 6;
    scene.add(m);
    traces.push({ m, age: 1e3, vie: 0.12, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, largeur: 0.05 });
  }

  // ----- état de la pose (scalaires dans un tableau typé ; vecteurs préalloués)
  const T = new Float64Array(8); // 0 temps, 1 temps de la boucle, 2 pose courante, 3 temps dans la pose
  const CYCLE = POSES.map((p) => (p.transition || MENU.transition) + (p.maintien || MENU.maintien));
  const DUREE = CYCLE.reduce((a, b) => a + b, 0);
  const tourT = new Float64Array(4 * 6); // par tourelle : lacet, tangage, prochain tir, recul, cible
  for (let k = 0; k < 4; k++) tourT[k * 6 + 2] = 0.6 + hash(k + 11) * 1.5;
  const brasRecul = new Float64Array(2);
  const railCharge = new Float64Array(2); // [charge 0..1, tiré]

  // vecteurs de travail
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vP = new THREE.Vector3();
  const vJ = new THREE.Vector3();
  const d1 = new THREE.Vector3();
  const d2 = new THREE.Vector3();
  const q1 = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const qT = new THREE.Quaternion();
  const m1 = new THREE.Matrix4();
  const m2 = new THREE.Matrix4();
  const mBas = new THREE.Matrix4();
  const capeM = new THREE.Matrix4();
  const decaleTaille = new THREE.Matrix4().makeTranslation(0, -TAILLE, 0);
  const AXE_Y = new THREE.Vector3(0, 1, 0);
  const e1 = new THREE.Euler(0, 0, 0, 'YXZ');

  // pose mélangée (sortie du mélange A → B)
  const M = {
    cap: 0,
    bassin: 0,
    buste: new THREE.Vector3(),
    tete: new THREE.Vector3(),
    piedG: new THREE.Vector3(),
    piedD: new THREE.Vector3(),
    genou: new THREE.Vector3(),
    mainG: new THREE.Vector3(),
    mainD: new THREE.Vector3(),
    coudeG: new THREE.Vector3(),
    coudeD: new THREE.Vector3(),
    torsionG: 0,
    torsionD: 0,
    tourCam: 0,
  };
  const tmpMain = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  /** Cible de la main d'une pose, dans le repère du BUSTE (le buste courant). */
  function cibleMain(spec, cote, out) {
    const nomBras = cote < 0 ? 'bras_d' : 'bras_g';
    const sh = os[nomBras].position; // épaule, repère du buste
    if (spec.camera) {
      // le bras pointe vers l'objectif : direction épaule → caméra, ramenée dans le repère du buste
      v1.copy(sh);
      buste.localToWorld(v1);
      v2.copy(camera.position).sub(v1).normalize();
      buste.getWorldQuaternion(q1).invert();
      v2.applyQuaternion(q1);
      return out.copy(sh).addScaledVector(v2, (LB1 + LB2) * 0.985);
    }
    if (spec.sol) {
      // main posée au sol : point du promontoire sous [x, z] (repère du héros, tourné du cap)
      const c = Math.cos(M.cap + ORIENTATION);
      const s = Math.sin(M.cap + ORIENTATION);
      const lx = spec.sol[0] * c + spec.sol[1] * s;
      const lz = -spec.sol[0] * s + spec.sol[1] * c;
      v1.set(BX + lx, 0, BZ + lz);
      v1.y = solY(v1.x, v1.z) + 0.07;
      buste.worldToLocal(v1);
      return out.copy(v1);
    }
    return out.set(sh.x + spec.main[0], sh.y + spec.main[1], sh.z + spec.main[2]);
  }

  /**
   * Os à deux segments : A (racine du membre), T (cible), longueurs a, b, pole (direction vers laquelle l'articulation
   * ressort), tout dans le repère PARENT de l'os haut. Écrit les quaternions locaux des deux os. signe : +1 genou
   * (devant), −1 coude (derrière) — orientation du plan de flexion. Jambes : qE1 et w0 rendent compte des pivots du
   * modèle (genou E1 devant la hanche, cheville E2 derrière le genou) : la cheville tombe EXACTEMENT sur la cible.
   */
  function deuxOs(osHaut, osBas, A, Tg, a, b, pole, signe, torsion, qE1 = null, w0 = BAS) {
    d1.copy(Tg).sub(A);
    let L = d1.length();
    const Lmin = Math.abs(a - b) + 0.01;
    const Lmax = a + b - 0.002;
    if (L < 1e-5) d1.set(0, -1, 0), (L = Lmin);
    d1.divideScalar(L);
    if (L < Lmin) L = Lmin;
    if (L > Lmax) L = Lmax;
    const ca = (a * a + L * L - b * b) / (2 * a * L);
    const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
    vP.copy(pole).addScaledVector(d1, -pole.dot(d1));
    if (vP.lengthSq() < 1e-8) vP.set(0, 0, signe).addScaledVector(d1, -d1.z * signe);
    vP.normalize();
    vJ.copy(A).addScaledVector(d1, a * ca).addScaledVector(vP, a * sa);
    // os haut : axe −Y vers l'articulation, axe Z = signe × direction de l'articulation (plan de flexion = YZ local)
    v1.copy(vJ).sub(A).normalize(); // direction du segment haut
    v2.copy(v1).negate(); // Y local
    v3.copy(vP).multiplyScalar(signe); // Z local (avant pour le genou, arrière pour le coude : coude derrière)
    v3.addScaledVector(v2, -v3.dot(v2)).normalize();
    vA.crossVectors(v2, v3); // X local
    m1.makeBasis(vA, v2, v3);
    osHaut.quaternion.setFromRotationMatrix(m1);
    if (qE1) osHaut.quaternion.multiply(qE1);
    // os bas : direction articulation → cible, dans le repère de l'os haut
    vB.copy(A).addScaledVector(d1, L).sub(vJ).normalize();
    q1.copy(osHaut.quaternion).invert();
    vB.applyQuaternion(q1);
    osBas.quaternion.setFromUnitVectors(w0, vB);
    if (torsion) {
      qT.setFromAxisAngle(AXE_Y, torsion);
      osBas.quaternion.multiply(qT);
    }
  }

  /** Mélange de deux poses (u : 0 → A, 1 → B, avec retards par partie). */
  function melanger(A, B, u, uRetard) {
    M.cap = A.cap + (B.cap - A.cap) * u;
    // bassin : posé par update (BASS : descente de chaque pose, déduite du genou pour un genou au sol)
    M.buste.set(A.buste[0] + (B.buste[0] - A.buste[0]) * u, A.buste[1] + (B.buste[1] - A.buste[1]) * u, A.buste[2] + (B.buste[2] - A.buste[2]) * u);
    M.tete.set(A.tete[0] + (B.tete[0] - A.tete[0]) * uRetard, A.tete[1] + (B.tete[1] - A.tete[1]) * uRetard, A.tete[2] + (B.tete[2] - A.tete[2]) * uRetard);
    M.genou.set(A.genou[0] + (B.genou[0] - A.genou[0]) * u, A.genou[1] + (B.genou[1] - A.genou[1]) * u, A.genou[2] + (B.genou[2] - A.genou[2]) * u).normalize();
    M.tourCam = (A.tourelles === 'camera' ? 1 : 0) + ((B.tourelles === 'camera' ? 1 : 0) - (A.tourelles === 'camera' ? 1 : 0)) * uRetard;
    const sp = (s, k) => s[k];
    for (let c = 0; c < 2; c++) {
      const k = c === 0 ? 'd' : 'g';
      const sa = sp(A.bras, k);
      const sb = sp(B.bras, k);
      const ta = tmpMain[c * 2];
      const tb = tmpMain[c * 2 + 1];
      cibleMain(sa, c === 0 ? -1 : 1, ta);
      cibleMain(sb, c === 0 ? -1 : 1, tb);
      const main = c === 0 ? M.mainD : M.mainG;
      main.copy(ta).lerp(tb, uRetard);
      const coude = c === 0 ? M.coudeD : M.coudeG;
      coude.set(sa.coude[0] + (sb.coude[0] - sa.coude[0]) * uRetard, sa.coude[1] + (sb.coude[1] - sa.coude[1]) * uRetard, sa.coude[2] + (sb.coude[2] - sa.coude[2]) * uRetard).normalize();
      if (c === 0) M.torsionD = sa.torsion + (sb.torsion - sa.torsion) * uRetard;
      else M.torsionG = sa.torsion + (sb.torsion - sa.torsion) * uRetard;
    }
  }

  // pieds : cheville visée de chaque jambe (monde), mélange des poses A → B
  const piedM = [new THREE.Vector3(), new THREE.Vector3()];
  // ----- jambes : cibles de chaque pose, calculées une fois (cap et promontoire fixes) -------------------------------
  // JP[(pose × 2 + côté) × 10] (côté 0 = gauche) : cheville (monde) x y z, angle du pied (monde, + = pointe vers le
  // bas), orteils (local), pôle du genou (monde) x y z, genou au sol (1 / 0). BASS[pose] : descente du bassin (genou
  // au sol : déduite du genou, la cuisse a sa longueur). ETAL : [hauteur du pivot du genou au-dessus de la roche,
  // correction de hauteur de la cheville du pied arrière] — étalonnés à l'init sur les sommets du tibia et des orteils.
  const NP = POSES.length;
  const JP = new Float64Array(NP * 2 * 10);
  const BASS = new Float64Array(NP);
  const ETAL = new Float64Array([0.09, 0]);
  const GENOU_POSE = H.genouPose; // m — rotule à 2 mm de la roche : posée, pas enfoncée (MENU.heros)
  const ORTEILS_POSE = H.orteilsPose; // m — orteils du pied arrière (MENU.heros)
  const ANG = new Float64Array(2);
  const ORT = new Float64Array(2);
  const POLE = [new THREE.Vector3(), new THREE.Vector3()];
  const qE1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), E1);
  const W0 = new THREE.Vector3(0, -Math.cos(E2), -Math.sin(E2));
  const vK = new THREE.Vector3();
  let garde = true;
  let muet = false;
  // § E4.E.6 : MENU.tirs = false (demande de Femz du 16/11, 11h40) — aucun tir à l'accueil ; etat.tirs compte les tirs
  // créés (test : 0 sur 20 s d'écran titre)
  const TIRS = MENU.tirs !== false;
  const evt = (type, x, y, z, k) => {
    if (type !== 'IMPACT') etat.tirs++;
    if (!muet) evenement(type, x, y, z, k);
  };
  function normaleSol(x, z, out) {
    const e = 0.05;
    return out.set(solY(x - e, z) - solY(x + e, z), 2 * e, solY(x, z - e) - solY(x, z + e)).normalize();
  }
  // EMPREINTE DU PIED (15/11) : le dessus du promontoire est fait de paliers de 24 mm (bandes en X) ; un pied à cheval
  // sur un bord ne peut pas être à plat (le bout flotte ou le talon s'enfonce). Points de l'empreinte autour de la
  // cheville, repère du pied [travers, avant] : talon → bout des orteils, trois de large.
  const EMPREINTE = [];
  // 5 de large × 12 de long (pas de 2,4 cm) : une rainure étroite du palier bas passait entre les points d'une grille 3 × 5
  for (const sx of [-0.06, -0.03, 0, 0.03, 0.06]) for (let k = 0; k < 12; k++) EMPREINTE.push(sx, -0.065 + ((ZT + 0.145) * k) / 11);
  /** [plus bas, plus haut] de la roche sous l'empreinte d'un pied dont la cheville est en (x, z), avant = (fx, fz). */
  function sousEmpreinte(x, z, fx, fz, out) {
    out[0] = 1e9;
    out[1] = -1e9;
    for (let k = 0; k < EMPREINTE.length; k += 2) {
      const sx = EMPREINTE[k];
      const sz = EMPREINTE[k + 1];
      const y = solY(x + sx * fz + sz * fx, z - sx * fx + sz * fz);
      if (y < out[0]) out[0] = y;
      if (y > out[1]) out[1] = y;
    }
    return out;
  }
  const HB = [0, 0];
  // lacet réel des pieds par pose (avant x, z ; NaN = pas encore mesuré : cap de la pose) — etalonner()
  const LACET = new Float64Array(POSES.length * 4).fill(NaN);
  const qLacet = new THREE.Quaternion();
  const vLacet = new THREE.Vector3();
  /**
   * Appui d'un pied : la position la plus proche (≤ 24 cm ; rail et épaule : pied droit déplacé de 18 et 22 cm) de (x, z) où toute l'empreinte est sur un même palier
   * (écart ≤ 4 mm), sinon la moins à cheval ; hauteur = le plus haut de l'empreinte (rien ne s'enfonce). → out (x, y, z).
   */
  function appuiPied(x, z, fx, fz, out) {
    let best = 1e9;
    for (let i = -12; i <= 12; i++) {
      for (let j = -12; j <= 12; j++) {
        const px = x + i * 0.02;
        const pz = z + j * 0.02;
        sousEmpreinte(px, pz, fx, fz, HB);
        const ecart = HB[1] - HB[0];
        const cout = (ecart > 0.004 ? 1 + ecart : 0) + Math.hypot(i, j) * 0.02;
        if (cout < best) {
          best = cout;
          out.set(px, HB[1], pz);
        }
      }
    }
    return out;
  }
  function ciblesPoses() {
    for (let i = 0; i < NP; i++) {
      const P = POSES[i];
      const ang = P.cap + ORIENTATION;
      const c0 = Math.cos(ang);
      const s0 = Math.sin(ang);
      BASS[i] = P.bassin || 0;
      for (let c = 0; c < 2; c++) {
        const cote = c === 0 ? 'g' : 'd';
        const o = (i * 2 + c) * 10;
        const g = P.genouSol && P.genouSol.cote === cote ? P.genouSol : null;
        const gn = P.genou; // pôle de la pose, repère du héros → monde
        v1.set(gn[0] * c0 + gn[2] * s0, gn[1], -gn[0] * s0 + gn[2] * c0);
        if (!g) {
          const p = P.pieds[cote];
          const lx = LACET[o / 5];
          appuiPied(BX + p[0] * c0 + p[1] * s0, BZ - p[0] * s0 + p[1] * c0, Number.isNaN(lx) ? s0 : lx, Number.isNaN(lx) ? c0 : LACET[o / 5 + 1], v2);
          normaleSol(v2.x, v2.z, v3);
          JP.set([v2.x + v3.x * HC, v2.y + v3.y * HC, v2.z + v3.z * HC, 0, 0, v1.x, v1.y, v1.z, 0], o);
          continue;
        }
        // GENOU AU SOL : pivot du genou au-dessus du point de contact, tibia vers l'arrière, pied dressé sur ses
        // orteils (à plat au sol), ouvert de g.lacet vers l'extérieur
        vK.set(BX + g.genou[0] * c0 + g.genou[1] * s0, 0, BZ - g.genou[0] * s0 + g.genou[1] * c0);
        vK.y = solY(vK.x, vK.z) + ETAL[0];
        const fy = ang + (c === 0 ? g.lacet : -g.lacet);
        const fx = Math.sin(fy);
        const fz = Math.cos(fy);
        const th = g.pied;
        const fwo = (HC - YT) * Math.sin(th) - ZT * Math.cos(th); // cheville devant la base des orteils, le long du pied
        const upo = (HC - YT) * Math.cos(th) + ZT * Math.sin(th); // cheville au-dessus de la base des orteils
        let sol = vK.y - ETAL[0];
        let ax = vK.x;
        let ay = vK.y;
        let az = vK.z;
        for (let it = 0; it < 3; it++) {
          ay = sol + YT + upo + ETAL[1];
          const dv = ay - vK.y;
          const dh = Math.sqrt(Math.max(0, LJ2 * LJ2 - dv * dv));
          ax = vK.x - fx * dh;
          az = vK.z - fz * dh;
          sol = solY(ax - fx * fwo, az - fz * fwo);
        }
        // la cuisse a sa longueur : hauteur de la hanche, donc descente du bassin
        const ph = piv('jambe_' + cote);
        const hx = BX + ph[0] * c0 + ph[2] * s0;
        const hz = BZ - ph[0] * s0 + ph[2] * c0;
        const d2 = (vK.x - hx) * (vK.x - hx) + (vK.z - hz) * (vK.z - hz);
        const hy = vK.y + Math.sqrt(Math.max(0, LJ1 * LJ1 * 0.9999 - d2));
        BASS[i] = BY + HANCHE - hy;
        JP.set([ax, ay, az, th, -th, vK.x - hx, vK.y - hy, vK.z - hz, 1], o);
      }
    }
  }

  // sommets de contrôle (repère de leur os) : tibias (garde-fou et étalonnage de la rotule), pied + orteils
  const sommets = (nom, filtre) => {
    const i = idx[nom];
    const p = pieces[i].pivot;
    const out = [];
    for (let v = 0; v < pc.length; v++) {
      if (pc[v] !== i) continue;
      const x = pos[v * 3] - p[0];
      const y = pos[v * 3 + 1] - p[1];
      const z = pos[v * 3 + 2] - p[2];
      if (!filtre || filtre(x, y, z)) out.push(x, y, z);
    }
    return new Float64Array(out);
  };
  const SOM_TIBIA = ['tibia_g', 'tibia_d'].map((n) => sommets(n, (x, y, z) => Math.hypot(y, z) < 0.2));
  const SOM_PIED = PIEDS ? ['g', 'd'].map((k) => [sommets('pied_' + k), sommets('orteils_' + k)]) : null;
  /** Hauteur au-dessus de la roche du sommet le plus bas d'une liste (repère de l'os b, matrices à jour). */
  function basSommets(b, L) {
    const e = b.matrixWorld.elements;
    let m = 1e9;
    for (let j = 0; j < L.length; j += 3) {
      const x = e[0] * L[j] + e[4] * L[j + 1] + e[8] * L[j + 2] + e[12];
      const y = e[1] * L[j] + e[5] * L[j + 1] + e[9] * L[j + 2] + e[13];
      const z = e[2] * L[j] + e[6] * L[j + 1] + e[10] * L[j + 2] + e[14];
      const h = y - solY(x, z);
      if (h < m) m = h;
    }
    return m;
  }
  const SOM_SEMELLE = PIEDS ? ['pied_g', 'pied_d'].map((n) => sommets(n, (x, y) => y + piv(n)[1] < 0.006)) : null;
  /** [plus bas, plus haut] des sommets d'une liste au-dessus de la roche → ECART. */
  const ECART = new Float64Array(2);
  function ecartSommets(b, L) {
    const e = b.matrixWorld.elements;
    ECART[0] = 1e9;
    ECART[1] = -1e9;
    for (let j = 0; j < L.length; j += 3) {
      const x = e[0] * L[j] + e[4] * L[j + 1] + e[8] * L[j + 2] + e[12];
      const y = e[1] * L[j] + e[5] * L[j + 1] + e[9] * L[j + 2] + e[13];
      const z = e[2] * L[j] + e[6] * L[j + 1] + e[10] * L[j + 2] + e[14];
      const h = y - solY(x, z);
      if (h < ECART[0]) ECART[0] = h;
      if (h > ECART[1]) ECART[1] = h;
    }
    return ECART;
  }
  const basTibia = (c) => basSommets(c === 0 ? os.tibia_g : os.tibia_d, SOM_TIBIA[c]);
  const basPied = (c) => (SOM_PIED ? Math.min(basSommets(os[c === 0 ? 'pied_g' : 'pied_d'], SOM_PIED[c][0]), basSommets(os[c === 0 ? 'orteils_g' : 'orteils_d'], SOM_PIED[c][1])) : 0);

  /** Jambes vers les chevilles de piedM (monde), pôles POLE (monde) ; matrices mises à jour. */
  function jambes() {
    racine.getWorldQuaternion(q2).invert();
    for (let c = 0; c < 2; c++) {
      v1.copy(piedM[c]);
      racine.worldToLocal(v1);
      v2.copy(POLE[c]).applyQuaternion(q2);
      const oj = c === 0 ? os.jambe_g : os.jambe_d;
      const ot = c === 0 ? os.tibia_g : os.tibia_d;
      deuxOs(oj, ot, oj.position, v1, LJ1, LJ2, v2, 1, 0, qE1, W0);
    }
    mesh.updateMatrixWorld(true);
  }
  /** Pieds : à plat sur la roche (alignés sur sa pente) dans le lacet de la jambe, angle ANG, orteils ORT. */
  function orienterPieds() {
    if (!PIEDS) return;
    for (let c = 0; c < 2; c++) {
      const k = c === 0 ? 'g' : 'd';
      const tib = os['tibia_' + k];
      const pied = os['pied_' + k];
      const e = tib.matrixWorld.elements;
      pied.getWorldPosition(v1);
      normaleSol(v1.x, v1.z, v2);
      qT.setFromUnitVectors(AXE_Y, v2);
      e1.set(ANG[c], Math.atan2(-e[2], e[0]), 0, 'YXZ');
      q1.setFromEuler(e1);
      qT.multiply(q1);
      tib.getWorldQuaternion(q1).invert();
      pied.quaternion.copy(q1).multiply(qT);
      os['orteils_' + k].rotation.set(ORT[c], 0, 0);
    }
    mesh.updateMatrixWorld(true);
  }


  // ----- cibles imaginaires des tourelles (dans le ciel, au-dessus des boss) et tirs
  const cible = new Float64Array(4 * 3);
  const XZ = [0, 0];
  function cibles(t) {
    for (let k = 0; k < 4; k++) {
      const ph = k * 1.7;
      const cote = k % 2 === 0 ? -1 : 1; // tourelles 1 et 3 : côté droit du héros (−X)
      versMonde(cote * (6 + 5 * Math.sin(t * 0.21 + ph)) + 3 * Math.sin(t * 0.13 + ph * 2), -18 - 6 * Math.cos(t * 0.11 + ph), XZ);
      cible[k * 3] = BX + XZ[0];
      cible[k * 3 + 1] = BY + 7 + 3.5 * Math.sin(t * 0.17 + ph);
      cible[k * 3 + 2] = BZ + XZ[1];
    }
  }

  function eclair(o, taille, r, g, b, vie) {
    for (const f of flashs) {
      if (f.age < f.vie) continue;
      f.age = 0;
      f.vie = vie;
      f.taille = taille;
      f.r = r;
      f.g = g;
      f.b = b;
      f.os = o;
      return;
    }
  }
  function trace(ax, ay, az, bx, by, bz, r, g, b, largeur) {
    for (const t of traces) {
      if (t.age < t.vie) continue;
      t.age = 0;
      t.ax = ax;
      t.ay = ay;
      t.az = az;
      t.bx = bx;
      t.by = by;
      t.bz = bz;
      t.largeur = largeur;
      t.m.material.uniforms.uCouleur.value.set(r, g, b);
      return;
    }
  }

  function tirBras(cote) {
    if (!TIRS) return; // § E4.E.6
    const nom = cote < 0 ? (hash(T[0] * 13) < 0.5 ? 'bouche_blaster' : 'bouche_rail') : hash(T[0] * 7) < 0.5 ? 'bouche_pompe' : 'bouche_roquettes';
    const o = bouche[nom];
    if (!o) return;
    o.getWorldPosition(v1);
    // direction : −Y de l'avant-bras
    o.parent.getWorldQuaternion(q1);
    v2.set(0, -1, 0).applyQuaternion(q1);
    const coul = nom === 'bouche_rail' ? [0.6, 2.4, 3.2] : nom === 'bouche_pompe' ? [3.2, 1.6, 0.5] : nom === 'bouche_roquettes' ? [3.2, 1.0, 0.4] : [0.8, 2.8, 2.6];
    eclair(o, 0.32, coul[0], coul[1], coul[2], H.eclairBras);
    trace(v1.x, v1.y, v1.z, v1.x + v2.x * 30, v1.y + v2.y * 30, v1.z + v2.z * 30, coul[0] * 0.8, coul[1] * 0.8, coul[2] * 0.8, 0.07);
    brasRecul[cote < 0 ? 0 : 1] = 1;
    evt(nom === 'bouche_rail' ? 'RAIL' : nom === 'bouche_pompe' ? 'SHOTGUN' : nom === 'bouche_roquettes' ? 'ROCKET' : 'BLASTER', v1.x, v1.y, v1.z, 0.5);
  }

  const tirsFaits = new Uint8Array(8);
  let poseAvant = -1;
  const etat = { pose: 0, nom: POSES[0].nom, u: 1, maintien: false, tirs: 0 };

  // ----- CAPTURE DE MOUVEMENT (MENU.clip, clip-menu.js) : les gestes filmés de Femz remplacent la boucle de poses.
  // Pistes normalisées par SES longueurs, remises à l'échelle du robot (jambe hanche → cheville, bras épaule → poing) ;
  // mêmes outils que les poses : chevilles posées sur la roche (sa pente), garde-fou des tibias, pieds à plat, bras et
  // jambes par deuxOs. « ?clip=0 » : boucle de poses.
  const qClip = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('clip') : null;
  const CL = MENU.clip;
  const clip = CL && (qClip !== null ? qClip !== '0' : CL.actif) ? await chargerClip(base + CL.fichier) : null;
  const S = clip ? sortieClip() : null;
  let horsClip = false; // étalonnage du genou au sol : la boucle de poses, même en mode clip
  // pieds posés CLOUÉS : à la pose, appuiPied cherche la place la plus proche où toute l'empreinte est sur un palier
  // (pas à cheval sur un bord), gardée tant que le pied filmé reste à moins de PAS_CLIP ; levé, le pied suit la
  // capture et l'écart à sa place est rattrapé en LEVE_CLIP s (pas d'à-coup)
  const PAS_CLIP = 0.1;
  const LEVE_CLIP = 0.12;
  const PAS_DUREE = 0.25; // s — pied qui change de place sans quitter l'appui : petit pas levé (comme les poses)
  const ANCRE = [new THREE.Vector3(), new THREE.Vector3()];
  const ANCRE_DEP = [new THREE.Vector3(), new THREE.Vector3()]; // place quittée pendant le petit pas
  const PAS_U = new Float64Array([1, 1]); // avancement du petit pas (1 = posé)
  const ANCRE_OK = new Uint8Array(2);
  const ANCRE_CIBLE = new Float64Array(4); // x, z visés quand la place a été choisie
  const DECALE = new Float64Array(4); // place − cible (x, z), rattrapé une fois le pied levé
  // PROPORTIONS (15/11, retour de Femz : « bras rien à voir, jambes collées ») : les épaules du robot (épaulières) sont
  // bien plus larges que celles de Femz ; ses angles de bras, partis des épaules du robot, mettaient un poing levé devant
  // le visage loin sur le côté. Sur l'axe X (travers), ce qui se passe ENTRE ses épaules (ses hanches pour les pieds) est
  // proportionné à la largeur du robot, ce qui dépasse garde la longueur des membres du robot.
  // Coude et genou : une préférence (coude en arrière et vers l'extérieur, genou devant) prend le relais quand le membre
  // filmé est tendu (pôle filmé presque nul) — plus de bascule d'un côté à l'autre.
  const LG = clip ? clip.longueurs : null;
  const DEMI_EP_H = LG ? LG.demi_epaules_m / LG.bras_m : 0; // ÷ bras filmé
  const DEMI_HA_H = LG ? LG.demi_hanches_m / LG.jambe_m : 0; // ÷ jambe filmée
  const DEMI_EP_R = (os.bras_g.position.x - os.bras_d.position.x) / 2;
  const MILIEU_EP_R = (os.bras_g.position.x + os.bras_d.position.x) / 2;
  const DEMI_HA_R = (PHG[0] - PHD[0]) / 2;
  const POLE_COUDE = 0.35; // poids de la préférence du coude (pôle filmé : vecteur unitaire)
  const POLE_GENOU = 0.06; // poids de la préférence du genou (pôle filmé ÷ jambe : ~0,1 genou plié)
  /** Coordonnée « vers l'extérieur » u (filmée, ÷ membre) → robot (m) : proportion de la demi-largeur, puis membre. */
  const travers = (u, demiH, demiR, L) => (u <= demiH ? (u * demiR) / demiH : demiR + (u - demiH) * L);
  // ----- BANQUE D'ANIMATIONS (banque-menu.js + anim/retarget.js) : « ?anim=Clip1,Clip2… » joue des animations faites par
  // un animateur (UAL1 + UAL2 de Quaternius, CC0), recopiées rotation par rotation ; « &mannequin=1 » montre le mannequin source à côté (même
  // taille, même cap) pour comparer. Pieds : posés sur la roche quand ceux du mannequin sont au sol (< 3 cm), sinon
  // seulement jamais dedans.
  const qp = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  // « ?fbx=Nom1,Nom2 » : des .fbx Mixamo LOCAUX enchaînés (« &fondu=0.8 » s de fondu, « &min=6 » s minimum par clip) (outils/anims/sources/, hors dépôt : Mixamo interdit de diffuser le fichier brut ;
  // le jeu n'embarquera que les pistes cuites pour le robot)
  const qAnim = qp ? qp.get('anim') : null;
  const qFbx = qp ? qp.get('fbx') : null;
  const banque = qFbx
    ? await chargerBanque(
        qFbx.split(',').map((n) => base + 'outils/anims/sources/' + encodeURIComponent(n.trim()) + '.fbx'),
        ['*'],
        { fondu: Number(qp.get('fondu')) || undefined, min: Number(qp.get('min')) || undefined },
      )
    : qAnim
      ? await chargerBanque([base + 'assets/anims/ual2/UAL2_Standard.glb', base + 'assets/anims/ual1/UAL1_Standard.glb'], qAnim.split(','), {
          fondu: Number(qp.get('fondu')) || undefined,
          min: Number(qp.get('min')) || undefined,
        })
      : null;
  const rt = banque ? creerRetarget({ source: banque.scene, os: { ...os, racine }, pivot: piv, hanche: HANCHE }) : null;
  if (rt && rt.manquants.length) console.warn('[banque] os absents :', rt.manquants.join(', '));
  if (banque && qp.get('mannequin') === '1') {
    banque.scene.scale.setScalar(rt.echelle);
    const XZm = versMonde(-1.45, 0.15, [0, 0]); // à côté du héros À L'ÉCRAN (repère du plan : x en travers)
    banque.scene.position.set(BX + XZm[0], BY, BZ + XZm[1]);
    banque.scene.rotation.y = MENU.clip.cap + ORIENTATION;
    banque.scene.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;
        o.castShadow = true;
      }
    });
    scene.add(banque.scene);
  }
  /** Pieds sur la roche : le plus bas des deux posé dessus (auSol) ou seulement ressorti s'il y entre. */
  function poserPieds(auSol) {
    buste.position.y = TAILLE - HANCHE;
    mesh.updateMatrixWorld(true);
    const bas = Math.min(basPied(0), basPied(1));
    if (auSol || bas < 0) {
      racine.position.y -= bas;
      mesh.updateMatrixWorld(true);
    }
  }
  function poseBanque(t) {
    const e = banque.echantillonner(t);
    if (banque.scene.parent) banque.scene.position.y = solY(banque.scene.position.x, banque.scene.position.z);
    rt.appliquer(MENU.clip.cap + ORIENTATION);
    poserPieds(rt.hauteurPieds() * rt.echelle < 0.03); // au sol si ceux du mannequin y sont
    etat.pose = -1;
    etat.nom = e.clip;
    etat.u = e.poids;
    etat.maintien = true;
  }
  /**
   * Cuisson (tests/cuire-anim.mjs) : la banque échantillonnée à fps sur toute sa durée, transférée SANS cap et sans
   * recalage des pieds (fait au jeu, sur la roche) → document « ctrlz-anim-robot/1 » pour cuit-menu.js.
   */
  function cuire(fps = 30, source = '', licence = '') {
    const noms = ['racine', 'buste', 'tete', 'bras_g', 'avant_bras_g', 'bras_d', 'avant_bras_d', 'jambe_g', 'tibia_g', 'pied_g', 'orteils_g', 'jambe_d', 'tibia_d', 'pied_d', 'orteils_d'];
    const n = Math.round(banque.total * fps);
    const q = [];
    const r = [];
    const arr = (x) => Math.round(x * 1e5) / 1e5;
    for (let k = 0; k < n; k++) {
      banque.echantillonner(k / fps);
      rt.appliquer(0);
      for (const nm of noms) {
        const o = nm === 'racine' ? racine : os[nm];
        q.push(arr(o.quaternion.x), arr(o.quaternion.y), arr(o.quaternion.z), arr(o.quaternion.w));
      }
      r.push(arr(racine.position.x), arr(racine.position.y), arr(racine.position.z));
    }
    return { format: 'ctrlz-anim-robot/1', source, licence, fps, n, os: noms, q, racine: r };
  }

  // ----- ATTENTE CUITE (MENU.attente, cuit-menu.js) : l'animation par défaut de l'accueil
  const A_ = MENU.attente;
  const qClipVal = qp ? qp.get('clip') : null;
  const cuit = !banque && A_ && A_.actif && qClipVal === null ? await chargerCuit(base + A_.fichier) : null;
  function poseCuit(t) {
    cuit.echantillonner(t, os, racine, MENU.clip.cap + ORIENTATION);
    poserPieds(true);
    etat.pose = -1;
    etat.nom = 'attente';
    etat.u = 1;
    etat.maintien = true;
  }

  function poseClip(t, dt) {
    clip.echantillonner(t, S);
    const LJ = LJ1 + LJ2;
    const LB = LB1 + LB2;
    const ang = CL.cap + ORIENTATION;
    const c0 = Math.cos(ang);
    const s0 = Math.sin(ang);
    // corps : bassin (repère du maillage, non tourné), lacet, buste, tête
    const r = S.racine;
    racine.position.set((r[0] * c0 + r[2] * s0) * LJ, HANCHE + r[1] * LJ, (-r[0] * s0 + r[2] * c0) * LJ);
    racine.rotation.set(0, ang + S.lacet[0], 0);
    buste.quaternion.set(S.buste[0], S.buste[1], S.buste[2], S.buste[3]);
    buste.position.y = TAILLE - HANCHE;
    os.tete.quaternion.set(S.tete[0], S.tete[1], S.tete[2], S.tete[3]);
    // pieds : posés = cloués sur leur place (palier entier), levés = la capture au-dessus du plus haut de la roche sous
    // l'empreinte ; cheville à HC le long de la normale ; genou vers son pôle
    const kLeve = Math.exp(-Math.max(0, dt) / LEVE_CLIP);
    for (let c = 0; c < 2; c++) {
      const ch = c === 0 ? S.cheville_g : S.cheville_d;
      const gn = c === 0 ? S.genou_g : S.genou_d;
      const appui = c === 0 ? S.appui_g[0] : S.appui_d[0];
      // travers : écart à SON bassin courant, proportionné à la largeur de hanches du robot
      const sg = c === 0 ? 1 : -1;
      const hx = r[0] * LJ + sg * travers(sg * (ch[0] - r[0]), DEMI_HA_H, DEMI_HA_R, LJ);
      const hz = ch[2] * LJ;
      const tx = BX + hx * c0 + hz * s0;
      const tz = BZ - hx * s0 + hz * c0;
      // avant réel du pied (image précédente : il suit le tibia), à plat
      os[c === 0 ? 'pied_g' : 'pied_d'].getWorldQuaternion(q1);
      v1.set(0, 0, 1).applyQuaternion(q1);
      const l = Math.hypot(v1.x, v1.z);
      const fx = l > 1e-4 ? v1.x / l : s0;
      const fz = l > 1e-4 ? v1.z / l : c0;
      const o = c * 2;
      let x, y, z;
      if (appui > 0.5) {
        if (!ANCRE_OK[c] || Math.hypot(tx - ANCRE_CIBLE[o], tz - ANCRE_CIBLE[o + 1]) > PAS_CLIP) {
          if (ANCRE_OK[c]) {
            ANCRE_DEP[c].copy(ANCRE[c]);
            PAS_U[c] = 0;
            appuiPied(tx, tz, fx, fz, ANCRE[c]);
          } else appuiPied(tx + DECALE[o], tz + DECALE[o + 1], fx, fz, ANCRE[c]);
          ANCRE_OK[c] = 1;
          ANCRE_CIBLE[o] = tx;
          ANCRE_CIBLE[o + 1] = tz;
        }
        if (PAS_U[c] < 1) {
          PAS_U[c] = Math.min(1, PAS_U[c] + Math.max(0, dt) / PAS_DUREE);
          const u = lisse(PAS_U[c]);
          const d = ANCRE_DEP[c].distanceTo(ANCRE[c]);
          v2.copy(ANCRE_DEP[c]).lerp(ANCRE[c], u);
          x = v2.x;
          y = v2.y + Math.min(0.08, d * 0.5) * Math.sin(Math.PI * PAS_U[c]);
          z = v2.z;
        } else {
          x = ANCRE[c].x;
          y = ANCRE[c].y;
          z = ANCRE[c].z;
        }
        DECALE[o] = ANCRE[c].x - tx;
        DECALE[o + 1] = ANCRE[c].z - tz;
      } else {
        ANCRE_OK[c] = 0;
        PAS_U[c] = 1;
        DECALE[o] *= kLeve;
        DECALE[o + 1] *= kLeve;
        x = tx + DECALE[o];
        z = tz + DECALE[o + 1];
        y = sousEmpreinte(x, z, fx, fz, HB)[1] + Math.max(0, ch[1]) * LJ;
      }
      normaleSol(x, z, v3);
      piedM[c].set(x + v3.x * HC, y + v3.y * HC, z + v3.z * HC);
      const gz = gn[2] + POLE_GENOU;
      POLE[c].set(gn[0] * c0 + gz * s0, gn[1], -gn[0] * s0 + gz * c0);
      ANG[c] = (c === 0 ? S.pied_g[0] : S.pied_d[0]) * (1 - appui);
      ORT[c] = 0;
    }
    mesh.updateMatrixWorld(true);
    // pieds hors d'atteinte : le bassin descend du strict nécessaire (marge 1,5 %)
    {
      const L = LJ * 0.985;
      let descente = 0;
      for (let c = 0; c < 2; c++) {
        (c === 0 ? os.jambe_g : os.jambe_d).getWorldPosition(v1);
        const dx = piedM[c].x - v1.x;
        const dz = piedM[c].z - v1.z;
        const h2 = dx * dx + dz * dz;
        if (h2 >= L * L) continue;
        const d = v1.y - (piedM[c].y + Math.sqrt(L * L - h2));
        if (d > descente) descente = d;
      }
      racine.position.y -= descente;
      mesh.updateMatrixWorld(true);
    }
    jambes();
    for (let k = 0; garde && k < 3; k++) {
      const enfonce = Math.min(basTibia(0), basTibia(1));
      if (enfonce >= -0.0005) break;
      racine.position.y -= enfonce;
      mesh.updateMatrixWorld(true);
      jambes();
    }
    orienterPieds();
    // bras : poing visé depuis l'épaule (repère du buste), coude vers son pôle
    for (let c = 0; c < 2; c++) {
      const g = c === 1;
      const ob = g ? os.bras_g : os.bras_d;
      const oa = g ? os.avant_bras_g : os.avant_bras_d;
      const m = g ? S.main_g : S.main_d;
      const cd = g ? S.coude_g : S.coude_d;
      brasRecul[c] = 0;
      const sg = g ? 1 : -1;
      v3.set(MILIEU_EP_R + sg * travers(DEMI_EP_H + sg * m[0], DEMI_EP_H, DEMI_EP_R, LB), ob.position.y + m[1] * LB, ob.position.z + m[2] * LB);
      v2.set(cd[0] + sg * 0.3 * POLE_COUDE, cd[1], cd[2] - POLE_COUDE);
      deuxOs(ob, oa, ob.position, v3, LB1, LB2, v2, -1, CL.torsion[c]);
    }
    mesh.updateMatrixWorld(true);
    etat.pose = -1;
    etat.nom = 'clip';
    etat.u = 1;
    etat.maintien = true; // les tourelles tirent
  }

  /** Tourelles d'épaule (poses et clip) : visée lente des cibles imaginaires ou de la caméra, tirs en maintien. */
  function tourelles(dt, t) {
    if (!TIRS) return; // § E4.E.6 : ni cibles imaginaires, ni tir, ni recul — tourelles au repos
    // traquent lentement leurs cibles ; « camera » : pivotent vers l'objectif
    cibles(t);
    mesh.updateMatrixWorld(true);
    const TO = H.tourelles;
    for (let k = 0; k < 4; k++) {
      const so = os['tourelle_' + (k + 1) + '_socle'];
      const ca = os['tourelle_' + (k + 1) + '_canon'];
      if (!so || !ca) continue;
      // point visé : cible imaginaire, ou la caméra (mêlé par M.tourCam)
      v1.set(cible[k * 3], cible[k * 3 + 1], cible[k * 3 + 2]);
      if (M.tourCam > 0) v1.lerp(camera.position, M.tourCam);
      so.parent.worldToLocal(v1);
      v1.sub(so.position);
      let lacet = Math.atan2(v1.x, v1.z);
      let tang = -Math.atan2(v1.y, Math.hypot(v1.x, v1.z));
      if (tang < -1.1) tang = -1.1;
      if (tang > 0.35) tang = 0.35;
      const o = k * 6;
      let dl = lacet - tourT[o];
      dl -= Math.round(dl / TAU) * TAU;
      const vmax = TO.vitesse * dt * (1 + 1.5 * M.tourCam);
      const kL = 1 - Math.exp(-dt / TO.lissage);
      let pas = dl * kL;
      if (pas > vmax) pas = vmax;
      if (pas < -vmax) pas = -vmax;
      tourT[o] += pas;
      tourT[o + 1] += (tang - tourT[o + 1]) * kL;
      tourT[o + 3] *= Math.exp(-dt * 12);
      so.rotation.set(0, tourT[o], 0);
      ca.rotation.set(tourT[o + 1], 0, 0);
      ca.position.z = -TO.recul * tourT[o + 3];
      // tirs : seulement en suivi, visée posée (écart < 0,15 rad)
      tourT[o + 2] -= dt;
      if (tourT[o + 2] <= 0) {
        tourT[o + 2] = TO.tirMin + hash(Math.floor(t * 10) + k * 31) * (TO.tirMax - TO.tirMin);
        if (M.tourCam < 0.05 && Math.abs(dl) < 0.15 && etat.maintien) {
          tourT[o + 3] = 1;
          const b = bouche['bouche_tourelle_' + (k + 1)];
          if (b) {
            b.getWorldPosition(v2);
            eclair(b, 0.2, 3.0, 2.2, 0.9, TO.eclair);
            trace(v2.x, v2.y, v2.z, cible[k * 3], cible[k * 3 + 1], cible[k * 3 + 2], 2.2, 1.6, 0.6, 0.035);
            evt('TOURELLE', v2.x, v2.y, v2.z, 1);
          }
        }
      }
  }
  }

  /** Avance le temps du menu (s) et pose le héros. */
  function update(dt) {
    T[0] += dt;
    const t = T[0];
    if (os.oeil) glitchOeil(os.oeil, OEIL, t); // V du casque (oeil-glitch.js)
    if (cuit && !horsClip) {
      poseCuit(t);
      tourelles(dt, t);
      mesh.updateMatrixWorld(true);
      return;
    }
    if (banque && !horsClip) {
      poseBanque(t);
      tourelles(dt, t);
      mesh.updateMatrixWorld(true);
      return;
    }
    if (clip && !horsClip) {
      poseClip(t, dt);
      tourelles(dt, t);
      mesh.updateMatrixWorld(true);
      return;
    }
    // position dans la boucle
    let tb = t % DUREE;
    let ip = 0;
    while (tb >= CYCLE[ip]) {
      tb -= CYCLE[ip];
      ip++;
    }
    const B = POSES[ip];
    const iA = (ip + POSES.length - 1) % POSES.length;
    const A = POSES[iA];
    const tr = B.transition || MENU.transition;
    const brut = clamp01(tb / tr);
    if (ip !== poseAvant) {
      poseAvant = ip;
      tirsFaits.fill(0);
      railCharge[1] = 0;
    }
    etat.pose = ip;
    etat.nom = B.nom;
    etat.u = brut;
    etat.maintien = brut >= 1;
    // anticipation : le mouvement démarre après une courte charge (ease in-out ensuite)
    const ant = MENU.anticipation;
    const uCorps = brut < ant ? -0.06 * Math.sin((Math.PI * brut) / ant) : easeInOut((brut - ant) / (1 - ant));
    const uRetard = brut < ant + 0.08 ? 0 : easeInOut(clamp01((brut - ant - 0.08) / (1 - ant - 0.08)));
    // l'atterrissage tombe vite à la fin (accélération), avec rebond du bassin à l'impact
    const chute = B.nom === 'atterrissage' ? brut * brut * brut : uCorps;
    // ----- mélange : la pose courante est calculée à partir du buste courant (bras visant la caméra, main au sol)
    melanger(A, B, uCorps < 0 ? 0 : uCorps, uRetard);
    const ut = clamp01(uCorps);
    M.bassin = BASS[iA] + (BASS[ip] - BASS[iA]) * (B.nom === 'atterrissage' ? chute : ut);
    // charge (anticipation) : le bassin se tasse avant de partir
    M.bassin += brut < ant + 0.15 ? 0.05 * Math.sin((Math.PI * clamp01(brut / (ant + 0.15)))) : 0;
    // impact de l'atterrissage : petit écrasement amorti
    const tImp = B.nom === 'atterrissage' ? tb - tr : -1;
    const choc = tImp >= 0 && tImp < 0.7 ? 0.06 * Math.exp(-tImp * 7) * Math.cos(tImp * 18) : 0;
    M.bassin += choc;
    // respiration (toujours)
    const R = H.respiration;
    const resp = Math.sin(t * TAU * R.hz);
    // ----- jambes, cibles : chevilles de la pose A → pose B (chaque pied à son tour, le gauche d'abord ; pas levé),
    // angle du pied et des orteils, pôle du genou ; poids du genou au sol
    let wGenou = 0;
    for (let c = 0; c < 2; c++) {
      const oa = (iA * 2 + c) * 10;
      const ob = (ip * 2 + c) * 10;
      const u0 = c === 0 ? 0.12 : 0.32;
      const up = lisse(clamp01((brut - u0) / 0.5));
      const pm = piedM[c].set(JP[oa] + (JP[ob] - JP[oa]) * up, JP[oa + 1] + (JP[ob + 1] - JP[oa + 1]) * up, JP[oa + 2] + (JP[ob + 2] - JP[oa + 2]) * up);
      const dist = Math.hypot(JP[ob] - JP[oa], JP[ob + 2] - JP[oa + 2]);
      const lev = dist > 0.04 ? Math.sin(Math.PI * up) : 0;
      if (lev > 0) pm.y += Math.min(0.16, dist * 0.5) * lev;
      pm.y = Math.max(pm.y, solY(pm.x, pm.z) + HC);
      ANG[c] = JP[oa + 3] + (JP[ob + 3] - JP[oa + 3]) * up - 0.2 * lev; // pied levé : pointe un peu relevée
      ORT[c] = JP[oa + 4] + (JP[ob + 4] - JP[oa + 4]) * up;
      const wg = JP[oa + 8] + (JP[ob + 8] - JP[oa + 8]) * up;
      if (wg > wGenou) wGenou = wg;
      POLE[c].set(JP[oa + 5] + (JP[ob + 5] - JP[oa + 5]) * up, JP[oa + 6] + (JP[ob + 6] - JP[oa + 6]) * up, JP[oa + 7] + (JP[ob + 7] - JP[oa + 7]) * up);
    }
    // pieds hors d'atteinte (roche plus basse sous un pied) : le bassin descend du strict nécessaire, le pied reste posé
    {
      const ang = M.cap + ORIENTATION;
      const c0 = Math.cos(ang);
      const s0 = Math.sin(ang);
      const hy = BY + HANCHE - M.bassin;
      const L = (LJ1 + LJ2) * 0.985; // marge : la respiration soulève le bassin de 6 mm
      let descente = 0;
      for (let c = 0; c < 2; c++) {
        const ph = c === 0 ? PHG : PHD;
        const dx = piedM[c].x - (BX + ph[0] * c0 + ph[2] * s0);
        const dz = piedM[c].z - (BZ - ph[0] * s0 + ph[2] * c0);
        const h2 = dx * dx + dz * dz;
        if (h2 >= L * L) continue;
        const d = hy - (piedM[c].y + Math.sqrt(L * L - h2));
        if (d > descente) descente = d;
      }
      M.bassin += descente;
    }
    // impact de l'atterrissage : genou au sol, le bassin ne descend plus — le choc passe dans le buste
    if (choc !== 0 && wGenou > 0) {
      M.bassin -= choc;
      M.buste.y += choc * 2.5;
    }
    // ----- corps (la respiration ne soulève plus le bassin quand un genou est au sol : la rotule reste posée)
    racine.position.set(0, HANCHE - M.bassin + resp * 0.006 * (1 - wGenou), 0);
    racine.rotation.set(0, M.cap + ORIENTATION, 0);
    buste.rotation.set(M.buste.y + resp * R.buste, M.buste.x + 0.015 * Math.sin(t * 0.37), M.buste.z, 'YXZ');
    buste.position.y = TAILLE - HANCHE + resp * 0.004;
    os.tete.rotation.set(M.tete.y - resp * R.buste * 0.6 + 0.03 * Math.sin(t * 0.53), M.tete.x + 0.05 * Math.sin(t * 0.29) * (etat.maintien ? 1 : 0.3), M.tete.z, 'YXZ');
    mesh.updateMatrixWorld(true);
    // ----- jambes : chevilles visées ; garde-fou : aucun sommet d'un tibia sous la roche (le bassin remonte d'autant)
    jambes();
    for (let n = 0; garde && n < 3; n++) {
      const enfonce = Math.min(basTibia(0), basTibia(1));
      if (enfonce >= -0.0005) break;
      racine.position.y -= enfonce;
      mesh.updateMatrixWorld(true);
      jambes();
    }
    orienterPieds();
    // ----- bras : cibles recalculées APRÈS la pose du buste (mélange fait avec le buste de l'image précédente : le
    // décalage d'une image est invisible) ; recul de tir
    for (let c = 0; c < 2; c++) {
      const g = c === 1;
      const ob = g ? os.bras_g : os.bras_d;
      const oa = g ? os.avant_bras_g : os.avant_bras_d;
      const main = g ? M.mainG : M.mainD;
      brasRecul[c] *= Math.exp(-dt * 9);
      v3.copy(main).sub(ob.position).multiplyScalar(1 - 0.12 * brasRecul[c]).add(ob.position);
      v3.y += resp * R.epaules;
      deuxOs(ob, oa, ob.position, v3, LB1, LB2, g ? M.coudeG : M.coudeD, -1, g ? M.torsionG : M.torsionD);
    }
    tourelles(dt, t);
    // ----- tirs des bras pendant le maintien, charge du rail, impact de l'atterrissage
    if (etat.maintien) {
      const th = tb - tr;
      const tirs = B.tirs || [];
      for (let i = 0; i < tirs.length && i < 8; i++)
        if (!tirsFaits[i] && th >= tirs[i]) {
          tirsFaits[i] = 1;
          tirBras(i % 2 === 0 ? -1 : 1);
        }
      if (B.rail && TIRS) {
        railCharge[0] = clamp01(th / B.rail);
        if (!railCharge[1] && th >= B.rail) {
          railCharge[1] = 1;
          const o = bouche.bouche_rail;
          if (o) {
            o.getWorldPosition(v1);
            eclair(o, 1.1, 1.4, 3.2, 3.6, 0.16);
            brasRecul[0] = 1.6;
            evt('RAIL', v1.x, v1.y, v1.z, 1);
          }
        }
      } else railCharge[0] = 0;
      if (B.nom === 'atterrissage' && !tirsFaits[7] && th >= 0) {
        tirsFaits[7] = 1;
        os.avant_bras_d.getWorldPosition(v1);
        evt('IMPACT', v1.x, solY(v1.x, v1.z), v1.z, 1);
      }
    } else railCharge[0] *= Math.exp(-dt * 8);
    mesh.updateMatrixWorld(true);
  }

  /** Cape, éclairs et traçantes : après update (la pose de l'image est faite). vent : m/s sur X. */
  function sync(dt, vent) {
    // capsules des bras et des jambes en monde (la cape ne les traverse pas)
    const capsule = (k, oa, ob, rayon) => {
      oa.getWorldPosition(v1);
      ob.getWorldPosition(v2);
      // prolonge jusqu'à la main / au pied
      v2.addScaledVector(v3.copy(v2).sub(v1), 1.1);
      capeMod.setCapsuleMonde(k, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, rayon);
    };
    capsule(0, os.bras_g, os.avant_bras_g, 0.1);
    capsule(1, os.bras_d, os.avant_bras_d, 0.1);
    capsule(2, os.jambe_g, os.tibia_g, 0.11);
    capsule(3, os.jambe_d, os.tibia_d, 0.11);
    capeM.multiplyMatrices(buste.matrixWorld, decaleTaille);
    const C = ANIM.cape;
    const s0 = C.souffle;
    C.souffle = vent;
    capeMod.entree[0] = dt;
    capeMod.update(capeM.elements);
    C.souffle = s0;
    capeMod.sync();
    // éclairs
    for (const f of flashs) {
      if (f.age >= f.vie) {
        f.s.visible = false;
        continue;
      }
      f.age += dt;
      const k = 1 - clamp01(f.age / f.vie);
      f.s.visible = k > 0;
      f.os.getWorldPosition(f.s.position);
      const sz = f.taille * (0.6 + 0.6 * k);
      f.s.scale.set(sz, sz, 1);
      f.s.material.color.setRGB(f.r * k, f.g * k, f.b * k);
      f.s.material.rotation = f.age * 30;
    }
    // charge du rail : lueur qui grossit à la bouche
    if (railCharge[0] > 0.02 && bouche.bouche_rail) {
      const f = flashs[NFLASH - 1];
      if (f.age >= f.vie) {
        f.s.visible = true;
        bouche.bouche_rail.getWorldPosition(f.s.position);
        const k = railCharge[0];
        const sz = 0.08 + 0.32 * k * k + 0.02 * Math.sin(T[0] * 40);
        f.s.scale.set(sz, sz, 1);
        f.s.material.color.setRGB(0.5 + 1.2 * k, 1.8 + 1.6 * k, 2.0 + 1.6 * k);
      }
    }
    // traçantes : rubans face caméra
    for (const t of traces) {
      if (t.age >= t.vie) {
        t.m.visible = false;
        continue;
      }
      t.age += dt;
      const k = 1 - clamp01(t.age / t.vie);
      t.m.visible = true;
      const u = clamp01(t.age / t.vie);
      // le ruban avance : de la bouche vers la cible
      vA.set(t.ax, t.ay, t.az);
      vB.set(t.bx, t.by, t.bz);
      v1.copy(vB).sub(vA);
      const L = v1.length();
      v1.divideScalar(L);
      const debut = L * Math.max(0, u * 1.4 - 0.4);
      const fin = Math.min(L, L * u * 1.4 + 2);
      vA.addScaledVector(v1, debut);
      v2.copy(camera.position).sub(vA).normalize();
      v3.crossVectors(v2, v1).normalize(); // base directe : X = la traçante, Y = largeur, Z = vers la caméra
      v2.crossVectors(v1, v3);
      m2.makeBasis(v1, v3, v2);
      t.m.position.copy(vA);
      t.m.quaternion.setFromRotationMatrix(m2);
      t.m.scale.set(Math.max(0.01, fin - debut), t.largeur, 1);
      t.m.material.uniforms.uA.value = k;
    }
  }

  /**
   * Étalonnage du genou au sol (init) : la pose tenue est calculée, puis la hauteur du pivot du genou et celle de la
   * cheville arrière sont corrigées jusqu'à ce que le sommet le plus bas du tibia soit à GENOU_POSE de la roche et celui
   * du pied arrière (orteils) à ORTEILS_POSE — sur la géométrie réelle (rotule, coque du tibia, orteils) et sur la vraie
   * surface du rocher (solY : ses triangles autour du héros, decor-menu.js), pas sur un rayon supposé.
   */
  const etalon = { pose: -1, iterations: 0, genou: NaN, pied: NaN };
  function etalonner() {
    ciblesPoses();
    // lacet RÉEL de chaque pied posé (orienterPieds : il suit le tibia, pas le cap de la pose) mesuré pose tenue, puis
    // empreintes recalculées avec ce lacet (2 passes : déplacer le pied change un peu le tibia)
    if (PIEDS) {
      muet = true;
      for (let passe = 0; passe < 2; passe++) {
        for (let i2 = 0; i2 < NP; i2++) {
          T[0] = CYCLE.slice(0, i2).reduce((x, y) => x + y, 0) + (POSES[i2].transition || MENU.transition) + 0.6;
          update(0);
          for (let c2 = 0; c2 < 2; c2++) {
            os[c2 === 0 ? 'pied_g' : 'pied_d'].getWorldQuaternion(qLacet);
            vLacet.set(0, 0, 1).applyQuaternion(qLacet);
            const l = Math.hypot(vLacet.x, vLacet.z) || 1;
            LACET[(i2 * 2 + c2) * 2] = vLacet.x / l;
            LACET[(i2 * 2 + c2) * 2 + 1] = vLacet.z / l;
          }
        }
        ciblesPoses();
      }
      T.fill(0);
      poseAvant = -1;
      tirsFaits.fill(0);
      muet = false;
    }
    const i = POSES.findIndex((p) => p.genouSol);
    if (i < 0 || !PIEDS) return;
    const c = POSES[i].genouSol.cote === 'g' ? 0 : 1;
    const debut = CYCLE.slice(0, i).reduce((x, y) => x + y, 0);
    const tm = debut + (POSES[i].transition || MENU.transition) + 0.6;
    muet = true;
    garde = false;
    horsClip = true;
    for (let it = 0; it < 8; it++) {
      T[0] = tm;
      update(0);
      const dk = basTibia(c) - GENOU_POSE;
      const dp = basPied(c) - ORTEILS_POSE;
      etalon.iterations = it + 1;
      if (Math.abs(dk) < 2e-4 && Math.abs(dp) < 2e-4) break;
      ETAL[0] -= dk;
      ETAL[1] -= dp;
      ciblesPoses();
    }
    T[0] = tm;
    update(0);
    etalon.pose = i;
    etalon.genou = basTibia(c);
    etalon.pied = basPied(c);
    muet = false;
    garde = true;
    horsClip = false;
    T.fill(0);
    poseAvant = -1;
    tirsFaits.fill(0);
    for (const f of flashs) f.age = 1e3;
    for (const tr of traces) tr.age = 1e3;
  }

  /**
   * Mesures (tests) sur la pose courante, en m au-dessus de la roche : sommet le plus bas de chaque tibia et de chaque
   * pied (orteils compris), [plus bas, plus haut] du dessous de chaque pied (à plat : écart nul), étalonnage.
   */
  function mesures() {
    const r = { tibia: [basTibia(0), basTibia(1)], pied: [basPied(0), basPied(1)], semelle: [], etalon: { ...etalon, hauteurGenou: ETAL[0], correctionCheville: ETAL[1] } };
    if (SOM_SEMELLE) for (let c = 0; c < 2; c++) r.semelle.push([...ecartSommets(os[c === 0 ? 'pied_g' : 'pied_d'], SOM_SEMELLE[c])]);
    return r;
  }

  function reset() {
    T.fill(0);
    poseAvant = -1;
    ANCRE_OK.fill(0);
    PAS_U.fill(1);
    DECALE.fill(0);
    for (let k = 0; k < 4; k++) tourT[k * 6 + 2] = 0.6 + hash(k + 11) * 1.5;
    update(1 / 60);
    capeM.multiplyMatrices(buste.matrixWorld, decaleTaille);
    capeMod.reset(capeM.elements);
  }

  /** Aller directement au temps t (captures) : la cape est replacée puis simulée 1,5 s avant. */
  function allerA(t) {
    T[0] = Math.max(0, t - 1.5);
    update(1 / 60);
    capeM.multiplyMatrices(buste.matrixWorld, decaleTaille);
    capeMod.reset(capeM.elements);
    return T[0];
  }

  /** Point de visée du plan (poitrine) et position des pieds, en monde. */
  function centre(out, hauteur) {
    out.set(BX, BY + hauteur, BZ);
    return out;
  }

  function liberer() {
    for (const f of flashs) {
      scene.remove(f.s);
      f.s.material.dispose();
    }
    for (const t of traces) {
      scene.remove(t.m);
      t.m.material.dispose();
    }
    geoTrace.dispose();
    matTraceBase.dispose();
    scene.remove(mesh);
    geometry.dispose();
    materiau.dispose();
    scene.remove(capeMesh);
    capeMesh.geometry.dispose();
    capeMesh.material.dispose();
    if (mesh.skeleton) mesh.skeleton.dispose();
  }

  void mBas;
  etalonner();
  return { mesh, os, update, sync, reset, allerA, centre, liberer, etat, DUREE, CYCLE, base: [BX, BY, BZ], railCharge, triangles: d.triangles, mesures, clip: clip ? { duree: clip.duree, source: clip.source } : null, cuit: cuit ? { duree: cuit.duree, source: cuit.source } : null, cuire: banque ? cuire : null, banque: banque ? { mannequin: !!banque.scene.parent, total: banque.total, segs: banque.segs, inconnus: banque.inconnus, noms: banque.noms, echelle: rt.echelle, manquants: rt.manquants } : null };
}
