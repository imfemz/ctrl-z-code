// ANIMATIONS v2 — allure des robots (plan § P2, P3, P6), sur les pièces des modèles Blender (assets/modeles/*.glb).
// Prototype du 13/11/2026.
//
// P2 — pas couplé à la vitesse RÉELLE : allure g = |v| / vitesse du type, lissée (E.ai2) ; phase du pas INTÉGRÉE
//   (E.ai3 += dt × ω × (1 ± 12 % par robot) × min(|v| / vitesse, 1,3)) : un robot bloqué ne court plus sur place, un
//   robot lent pédale lentement, deux robots du même type n'ont pas la même cadence (le motif ne défile plus en bloc).
//   Rebond et balancement × (0,25 + 0,75 g) ; respiration au repos ; écrasement au contact du pas ; penché d'élan
//   lean × (0,3 + 0,7 g). E.ai2 / E.ai3 suivent le robot à la compaction (flushDead copie tout E.f32) et ne sont lus
//   par enemies.js pour aucun robot hors boss (boss.js ne s'en sert que pour le boss).
// P3 — coup reçu avec poids : écrasement × E.flash ; bascule dans le sens du recul (E.kx, E.kz, déjà divisés par la
//   masse) : un drone bascule franchement, un blindé à peine.
// P6 — pièces animées DANS LE SHADER des InstancedMesh, sans objet par robot : attribut de sommet `piece` (pieces.js),
//   attribut d'instance aGait (phase, allure, âge, distance) écrit en ligne comme aFx ; le programme de chaque type est
//   généré à l'init à partir de ses pièces (constantes de compilation) :
//     jambes / pieds / épaules / bras : rotation autour de X au pivot, pas alternés ;
//     rotors du drone : rotation autour de Y (sens alternés) ; boule du kamikaze : roule (distance / rayon) ;
//     crampons du tireur : défilent le long de la chenille (pas 0,149 m, repliés au bout) ; antenne : ressort.
//   Aucune uniforme écrite par image ; zéro allocation (boucles en variables locales, tableaux typés).
//
// INTÉGRATION :
//   - src/enemies.js init : géométries de chargerPieces('assets/modeles/<type>.glb') (pieces.js, mises à la hauteur
//     de T.height), matériau = materiauMembres(materiauPeint, type, donnees) ; aGait = attribut d'instance de plus
//     (createInstanced : comme aFx).
//   - enemies.update, étape 1 (minuteries) : le corps de allureUpdate (une boucle sur les robots vivants hors boss).
//   - enemies.sync : remplacer le calcul de la matrice par celui de allureSync (même gabarit § G.3, version à échelle
//     non uniforme du plan) et écrire aGait à côté de aFx.
//   - clés : ANIM.robots → ENEMIES.common.gait (gaitRate, idleAmp, freqJitter, stepWindow), ENEMIES.common.hit,
//     ENEMIES.types[*].anim (bobAmp, swayAmp, stepSquash, lean, membres).
// INTÉGRÉ (étape « animations », ARCHITECTURE.md § Z sexies) : enemies.init → allure.init(meshes) ; enemies.setModeles
//   → allure.brancherModele(t, mesh, donnees) (attribut aGait + matériau des membres) ; fin de enemies.update →
//   allure.update(dt) ; enemies.sync écrit aFx puis appelle allure.sync() (matrices et aGait) avant les commit.
//   Réglages : ANIM.robots (config.js, région anim:reglages).
import * as THREE from 'three';
import { E } from '../state.js';
import { ENEMIES, ENEMY, ENEMY_COUNT, PROGRAMME } from '../config.js';
import { CHESTS, EFLAG } from '../config.js'; // § E2.C : taille de l'élite porteuse
import { COMBAT_GUIDE } from '../config.js'; // § E5.N : blindés de l'anneau d'acier sans bouclier (Femz, 21/11)
const WALL_SANS = COMBAT_GUIDE.blinde && COMBAT_GUIDE.blinde.anneauSansBouclier ? EFLAG.WALL : 0;
import { CARRY_SCALE } from '../config.js'; // § E3.K : taille d'un robot fusionné
import { ANIM } from './reglages.js';
import { GEN_SCALE } from '../enemies-e3.js'; // § E3.D : taille des mini-rôdeurs du diviseur
import { REPARATEUR_VOL } from '../config.js'; // § E5.D : flottement du réparateur volant
import { chargerPieces } from './pieces.js';

const R = ANIM.robots;
const TWO_PI = Math.PI * 2;
const BOSS_T = ENEMY.BOSS;
const BLINDE_T = ENEMY.BLINDE; // § E4.P : aGait.w porte l'état du bouclier
const KEYS = ['rodeur', 'drone', 'tireur', 'kamikaze', 'blinde', 'reparateur'];
const WRAP = TWO_PI * 64; // la phase est repliée (précision des flottants)

// constantes par type (copiées à l'init)
const bobW = new Float32Array(ENEMY_COUNT);
const bobAmp = new Float32Array(ENEMY_COUNT);
const swayAmp = new Float32Array(ENEMY_COUNT);
const lean = new Float32Array(ENEMY_COUNT);
const squash = new Float32Array(ENEMY_COUNT);
const hover = new Float32Array(ENEMY_COUNT);
const glide = new Uint8Array(ENEMY_COUNT);
const mPerRad = new Float32Array(ENEMY_COUNT); // distance (m) par radian de phase à l'allure nominale
// § E5.D : réparateur volant — flottement continu (même à l'arrêt), roulis lent, penché dans son pas de côté
const VOL_ON = REPARATEUR_VOL.actif ? 1 : 0;
const FLOT = new Float32Array([
  REPARATEUR_VOL.flottement.amp,
  REPARATEUR_VOL.flottement.hz * TWO_PI,
  REPARATEUR_VOL.flottement.roulis,
  REPARATEUR_VOL.flottement.roulisHz * TWO_PI,
]);
// Emplacements de maillage : 0 … ENEMY_COUNT − 1 = le modèle de chaque type ; ENEMY_COUNT + t = le modèle ÉLITE du
// type t (17/11, Femz : une élite — robot à EFLAG.ELITE, porteuse de coffre et son éventuel modificateur — affiche le
// modèle <type>-elite.glb, allégé à texture cuite, à la place du modèle normal ; enemies.init crée ces maillages).
const NS = ENEMY_COUNT * 2;
/** ELITE_MODELE[t] = 1 : le type t a un modèle élite posé (ses élites vont dans l'emplacement ENEMY_COUNT + t). */
export const ELITE_MODELE = new Uint8Array(ENEMY_COUNT);
/** Élites dessinées au plus par type (capacité du maillage élite ; au-delà : modèle normal). Porteuses : 1 ou 2 à la fois. */
export const ELITE_CAP = 4;
const cursor = new Int32Array(NS);
const actifType = new Uint8Array(NS);
const C = ENEMIES.common;
const DRONE = ENEMIES.types[ENEMY.DRONE];
const TIREUR = ENEMIES.types[ENEMY.TIREUR];
const KAMI = ENEMIES.types[ENEMY.KAMIKAZE];
const REP = ENEMIES.types[ENEMY.REPARATEUR];
const RECOIL_K = TIREUR.ranged.recoilLean / TIREUR.ranged.recoilSeconds;
const FUSE_INV = 1 / KAMI.explode.fuse;
const SHAKE_W = KAMI.explode.shakeHz * TWO_PI;
const K_FUSE = 1;
// Révisions v2 (étape 1 du plan addictif, ARCHITECTURE.md § E1.B) : manœuvres lues dans E.state (mêmes valeurs que
// M_WARN / M_GO de enemies.js) — rôdeur : accroupi puis bond ; drone : cabré puis piqué ; blindé : recul puis charge.
const M_WARN = 1;
const M_GO = 2;
const revOf = (key) => ENEMIES.revisions.find((r) => r.key === key);
const BOND = revOf('bond');
const PIQUE = revOf('pique');
const CHARGE = revOf('charge');
const CROUCH_INV = 1 / BOND.crouch;
const LEAP_INV = 1 / BOND.leapSeconds;
const PIQUE_WARN_INV = 1 / PIQUE.telegraph;
const CHARGE_WARN_INV = 1 / CHARGE.telegraph;
//#region e5:AC-contact
// § E5.AC : fente du coup de mêlée (E.fente, s depuis le début du geste ; écrit par enemies.update) — rendu seul. Élan en u²
// sur la préparation (part de l'arrêt, accélère jusqu'à l'impact), retour en (1 − r)². FT : [0] préparation (Float32),
// [1] 1 / préparation, [2] 1 / retour, [3] avance (m), [4] inclinaison (rad).
const FT = new Float64Array(5);
/** § E5.AC : relit COMBAT_GUIDE.contact (appelé par enemies.reglerContact). */
export function reglerFente() {
  const K = COMBAT_GUIDE.contact;
  FT[0] = Math.fround(K.preparation > 0 ? K.preparation : 0);
  FT[1] = FT[0] > 0 ? 1 / FT[0] : 0;
  FT[2] = K.retour > 0 ? 1 / K.retour : 1e6;
  FT[3] = K.avance;
  FT[4] = K.inclinaison;
}
reglerFente();
//#endregion e5:AC-contact
const eyes = new Array(NS).fill(null); // uSrEye.value de chaque emplacement (teinte des yeux d'une révision)

const meshes = new Array(NS).fill(null);
const matArr = new Array(NS).fill(null);
const gaitArr = new Array(NS).fill(null);
const gaitAttr = new Array(NS).fill(null);
const st = { pret: false };

for (let t = 0; t < ENEMY_COUNT; t++) {
  if (t === BOSS_T) continue;
  const T = ENEMIES.types[t];
  const A = T.anim || {};
  const V = R.types[KEYS[t]] || {};
  const hz = V.hz || A.bobHz || C.bobHz;
  bobW[t] = hz * TWO_PI;
  bobAmp[t] = V.bobAmp ?? A.bobAmp ?? C.bobAmp;
  swayAmp[t] = V.swayAmp ?? A.swayAmp ?? C.swayAmp;
  lean[t] = V.leanFwd ?? A.lean ?? C.leanFwd;
  squash[t] = V.stepSquash || 0;
  hover[t] = T.hover || 0;
  glide[t] = A.glide ? 1 : 0;
  mPerRad[t] = T.speed / bobW[t];
}

// ----- shader des membres ---------------------------------------------------------------------------------------------
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(5)));
const v3 = (p) => `vec3( ${f(p[0])}, ${f(p[1])}, ${f(p[2])} )`;

/** Code GLSL d'une pièce (genre déduit du nom) ; null = pièce rigide. */
function codePiece(type, p, i, info) {
  const V = R.types[type] || {};
  const n = p.nom;
  const side = p.cote || (/_g$|_avg$|_arg$/.test(n) ? 1 : /_d$|_avd$|_ard$/.test(n) ? -1 : 0);
  const cond = `abs( piece - ${f(i)} ) < 0.5`;
  if (/^(jambe|pied|hanche)/.test(n)) return `if ( ${cond} ) { srK = 1.0; srPiv = ${v3(p.pivot)}; srA = ${f(V.legSwing || 0.4)} * srG * cos( srW ) * ${f(side || 1)}; }`;
  if (/^(epaule|bras)/.test(n)) return `if ( ${cond} ) { srK = 1.0; srPiv = ${v3(p.pivot)}; srA = ${f(-(V.armSwing || 0.25))} * srG * cos( srW ) * ${f(side || 1)}; }`;
  if (/^antenne/.test(n)) return `if ( ${cond} ) { srK = 1.0; srPiv = ${v3(p.pivot)}; srA = 0.18 * sin( 2.0 * srW ) * ( 0.3 + srG ) + 0.06 * sin( aGait.z * 7.0 ); }`;
  if (/^rotor/.test(n)) {
    const sens = /avg|ard/.test(n) ? 1 : -1;
    return `if ( ${cond} ) { srK = 2.0; srPiv = ${v3(p.pivot)}; srA = ${f(sens * (V.rotor || 55))} * aGait.z; }`;
  }
  // § E4.P : état « fissuré » du bouclier du blindé — la pièce `fissures` est repliée sur son pivot (rien n'est dessiné)
  // tant que l'instance n'est pas fissurée ; l'état passe par aGait.w (0 intact, 1 fissuré), écrit par sync().
  // § E5.N (Femz, 21/11) : aGait.w = 2 → blindé de l'anneau d'acier, SANS bouclier : bouclier et fissures repliés
  if (/^fissure/.test(n)) return `if ( ${cond} ) { srK = ( aGait.w < 0.5 || aGait.w > 1.5 ) ? 4.0 : 0.0; srPiv = ${v3(p.pivot)}; }`;
  if (type === 'blinde' && /^bouclier/.test(n)) return `if ( ${cond} ) { srK = aGait.w > 1.5 ? 4.0 : 0.0; srPiv = ${v3(p.pivot)}; }`;
  if (/^boule/.test(n)) return `if ( ${cond} ) { srK = 1.0; srPiv = ${v3(p.pivot)}; srA = aGait.w / ${f(info.rayonBoule || 0.4)} * ${f(V.rollRatio || 1)}; }`;
  if (/^crampons/.test(n) && info.crampons) {
    const c = info.crampons;
    return `if ( ${cond} ) { srK = 3.0; float srC = ${f(c.zmin)} + ( floor( ( transformed.z - ${f(c.zmin)} ) / ${f(c.pas)} ) + 0.5 ) * ${f(c.pas)};
      srShift = ${f(c.zmin)} + mod( srC - ${f(c.zmin)} + aGait.w * ${f(V.trackSpeed || 1)}, ${f(c.longueur)} ) - srC; }`;
  }
  return null;
}

/** Matériau animé d'un type : le matériau peint du rendu, plus la déformation des pièces (même uniformes). */
export function materiauMembres(base, type, donnees, geometrieRendue = null, cle = type) {
  const info = { rayonBoule: 0, crampons: null };
  const pos = donnees.geometry.attributes.position.array;
  const pc = donnees.geometry.attributes.piece.array;
  donnees.pieces.forEach((p, i) => {
    let zmin = 1e9;
    let zmax = -1e9;
    let ymax = -1e9;
    for (let v = 0; v < pc.length; v++)
      if (pc[v] === i) {
        zmin = Math.min(zmin, pos[v * 3 + 2]);
        zmax = Math.max(zmax, pos[v * 3 + 2]);
        ymax = Math.max(ymax, pos[v * 3 + 1]);
      }
    if (/^boule/.test(p.nom)) info.rayonBoule = ymax - p.pivot[1];
    if (/^crampons/.test(p.nom) && !info.crampons) {
      const pas = (R.types[type].crampon || 0.149) * donnees.echelle;
      const n = Math.max(1, Math.round((zmax - zmin) / pas));
      info.crampons = { zmin: zmin, pas, longueur: n * pas };
    }
  });
  const lignes = donnees.pieces.map((p, i) => codePiece(type, p, i, info)).filter(Boolean);
  // carte mère (PROGRAMME.apparition) : le robot se compile — révélé du bas (y = 0) vers le haut du modèle (hMax) par une
  // ligne de scan émissive ; aGait.z = âge du robot (s). Au-delà de la durée, rien n'est jeté ni ajouté.
  // hauteur lue sur la géométrie RENDUE (mise à la hauteur du jeu) : celle des données peut être à une autre échelle
  // (1re passe : la traîne du scan couvrait tout le robot)
  const posH = (geometrieRendue || donnees.geometry).attributes.position.array;
  let hMax = 0;
  for (let v = 1; v < posH.length; v += 3) if (posH[v] > hMax) hMax = posH[v];
  const PA = PROGRAMME.apparition;
  const scan = new THREE.Color(PROGRAMME.couleur); // linéaire (Color convertit le sRGB)
  const ligne = PA.ligne * hMax;
  const traine = PA.traine * hMax;
  const revVert = PROGRAMME.actif ? '\n  vSrRev = vec2( transformed.y, aGait.z );' : '';
  const revFragPars = PROGRAMME.actif ? '\nvarying vec2 vSrRev;' : '';
  const revDiscard = PROGRAMME.actif
    ? `
  float srRu = clamp( vSrRev.y / ${f(PA.secondes)}, 0.0, 1.0 );
  srRu = 1.0 - ( 1.0 - srRu ) * ( 1.0 - srRu );
  float srFront = mix( -${f(ligne)}, ${f(hMax + ligne)}, srRu );
  if ( srRu < 1.0 && vSrRev.x > srFront ) discard;
  float srD = srFront - vSrRev.x;
  float srScan = srRu < 1.0 ? ( 1.0 - smoothstep( 0.0, ${f(ligne)}, srD ) ) * ${f(PA.gainLigne)} + ( 1.0 - smoothstep( 0.0, ${f(traine)}, srD ) ) * ${f(PA.gainTraine)} * ( 1.0 - srRu ) : 0.0;`
    : '';
  const revEmis = PROGRAMME.actif ? `\n  outgoingLight += ${v3([scan.r, scan.g, scan.b])} * srScan;` : '';
  // Yeux d'une révision (§ E1.B, § E1.S) : uSrEye = (gain rvb, part) MULTIPLIE la couleur cuite des sommets émissifs
  // (les yeux) — la couleur du type est gardée, elle brille plus fort. Une uniforme par type, écrite une fois par vague
  // par enemies.setRevisions. part 0 = modèle.
  if (!base.userData.uniforms.uSrEye) base.userData.uniforms.uSrEye = { value: new THREE.Vector4(1, 1, 1, 0) };
  const uSrEye = base.userData.uniforms.uSrEye;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: base.side });
  m.userData = base.userData;
  m.defines = base.defines; // three passe CET objet au programme ; l'onBeforeCompile du rendu le remplit
  const baseCompile = base.onBeforeCompile;
  const baseKey = base.customProgramCacheKey;
  const corps = `
  float srK = 0.0; vec3 srPiv = vec3( 0.0 ); float srA = 0.0; float srShift = 0.0;
  float srW = aGait.x; float srG = aGait.y;
  { vec3 transformed = position; ${lignes.join('\n  else ')} }
  if ( srK == 1.0 ) { float c = cos( srA ); float s = sin( srA ); objectNormal = vec3( objectNormal.x, c * objectNormal.y - s * objectNormal.z, s * objectNormal.y + c * objectNormal.z ); }
  else if ( srK == 2.0 ) { float c = cos( srA ); float s = sin( srA ); objectNormal = vec3( c * objectNormal.x + s * objectNormal.z, objectNormal.y, -s * objectNormal.x + c * objectNormal.z ); }`;
  const position = `
  if ( srK == 1.0 ) { vec3 q = transformed - srPiv; float c = cos( srA ); float s = sin( srA ); transformed = srPiv + vec3( q.x, c * q.y - s * q.z, s * q.y + c * q.z ); }
  else if ( srK == 2.0 ) { vec3 q = transformed - srPiv; float c = cos( srA ); float s = sin( srA ); transformed = srPiv + vec3( c * q.x + s * q.z, q.y, -s * q.x + c * q.z ); }
  else if ( srK == 3.0 ) { transformed.z += srShift; }
  else if ( srK == 4.0 ) { transformed = srPiv; }${revVert}`;
  m.onBeforeCompile = (shader, renderer) => {
    baseCompile.call(base, shader, renderer);
    shader.uniforms.uSrEye = uSrEye;
    const BASE = 'vec3 srBase = diffuseColor.rgb;';
    if (shader.fragmentShader.includes(BASE)) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uSrEye;')
        .replace(BASE, 'vec3 srBase = diffuseColor.rgb * mix( vec3( 1.0 ), uSrEye.rgb, uSrEye.a * step( 0.5, vEmissive ) );');
    } else console.warn('allure : insertion de la teinte des yeux introuvable (' + type + ')');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float piece; attribute vec4 aGait;' + revFragPars)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>' + corps)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + position);
    if (PROGRAMME.actif) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>' + revFragPars)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + revDiscard)
        .replace('#include <opaque_fragment>', revEmis + '\n#include <opaque_fragment>');
    }
  };
  m.customProgramCacheKey = () => (typeof baseKey === 'function' ? baseKey.call(base) : '') + '|sr-membres-v2-' + cle + (PROGRAMME.actif ? '-programme' : '');
  return m;
}

// ----- jeu intégré -------------------------------------------------------------------------------------------------
/** enemies.init : les six maillages instanciés (null pour le boss) — leurs matrices sont écrites par sync(). */
export function init(liste) {
  for (let s = 0; s < liste.length && s < NS; s++) {
    if (s % ENEMY_COUNT === BOSS_T || !liste[s]) continue;
    meshes[s] = liste[s];
    matArr[s] = liste[s].instanceMatrix.array;
    actifType[s] = 1;
  }
  st.pret = true;
}

/** enemies.setModeles, après la pose du modèle du type t : attribut d'instance aGait et matériau des membres. */
export function brancherModele(s, mesh, donnees) {
  const t = s % ENEMY_COUNT; // s ≥ ENEMY_COUNT : modèle élite du type t
  if (t === BOSS_T || !mesh || !donnees.geometry.attributes.piece) return;
  const ga = new THREE.InstancedBufferAttribute(new Float32Array((s < ENEMY_COUNT ? E.cap : mesh.instanceMatrix.count) * 4), 4);
  ga.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('aGait', ga);
  // élite : pièces et pivots de SON modèle — clé de programme distincte (même type, autre code GLSL)
  mesh.material = materiauMembres(mesh.material, KEYS[t], donnees, mesh.geometry, s < ENEMY_COUNT ? KEYS[t] : KEYS[t] + '-elite');
  eyes[s] = mesh.material.userData.uniforms.uSrEye.value;
  gaitArr[s] = ga.array;
  gaitAttr[s] = ga;
  if (s >= ENEMY_COUNT) ELITE_MODELE[t] = 1;
}

/** Yeux du type t (Vector4 : gain rvb, part ; § E1.S) — null tant que son modèle n'est pas posé (§ E1.B). */
export function teinteYeux(t) {
  return eyes[t];
}

// ----- simulation : allure et phase (étape 1 de enemies.update) ------------------------------------------------------
export function update(dt) {
  if (!st.pret || !(dt > 0)) return;
  const k = 1 - Math.exp(-R.gaitRate * dt);
  const n = E.count;
  const VX = E.vx;
  const VZ = E.vz;
  const SP = E.speed;
  const G = E.ai2;
  const PH = E.ai3;
  const UID = E.uid;
  const TYPE = E.type;
  const ALIVE = E.alive;
  const SUS = E.sus;
  const J = R.freqJitter;
  for (let i = 0; i < n; i++) {
    if (ALIVE[i] === 0 || SUS[i] === 2) continue; // § E4.F : garé, ni mis à jour ni dessiné
    const t = TYPE[i];
    if (t === BOSS_T) continue;
    // Aucune variable locale ne reçoit tantôt un flottant, tantôt un entier littéral (0, 1) : V8 l'emballerait à chaque
    // robot (§ V ; mesuré à l'intégration : 25,7 Ko par image dans enemies.update, scène D). Les remises à zéro passent
    // par les tableaux typés.
    const v = Math.sqrt(VX[i] * VX[i] + VZ[i] * VZ[i]);
    const sp = SP[i];
    let g = sp > 0.01 ? v / sp : v;
    if (g > 1.3) g = 1.3;
    if (!(G[i] >= 0 && G[i] <= 1.3)) G[i] = 0; // emplacement neuf (valeur d'un ancien occupant) ou NaN
    const gi = G[i];
    G[i] = gi + (Math.min(g, 1) - gi) * k;
    const jit = 1 + J * (((UID[i] * 37) & 63) / 31.5 - 1);
    // Phase repliée par un modulo, exécuté à CHAQUE image (14/11/2026, § E1.B). Avant : « else if (PH > WRAP) PH -= WRAP »,
    // une branche prise pour la première fois ≈ 20 à 26 s après l'apparition des premiers robots — V8 désoptimisait alors
    // cette boucle un instant, en plein dans la fenêtre de mesure des allocations de fondation.test (462 à 603 o/image
    // relevés dans cette seule fonction ; 0 une fois la branche connue). Même phase, à l'arrondi flottant près.
    PH[i] = (PH[i] + dt * bobW[t] * jit * g) % WRAP;
    if (!(PH[i] >= 0)) PH[i] = 0;
  }
}

// ----- rendu : matrices (gabarit non uniforme du plan) et aGait, APRÈS enemies.sync ---------------------------------
export function sync() {
  if (!st.pret) return;
  cursor.fill(0);
  const n = E.count;
  const X = E.x, Z = E.z, ROT = E.rot, ANIM_ = E.anim, FLASH = E.flash, GLOW = E.glow;
  const TIMER = E.timer, AI0 = E.ai0, AI1 = E.ai1, G = E.ai2, PH = E.ai3, KX = E.kx, KZ = E.kz;
  const TYPE = E.type, ALIVE = E.alive, STATE = E.state, UID = E.uid, SUS = E.sus, FIS = E.fis;
  const FENTE = E.fente; // § E5.AC
  const fadeInv = 1 / C.spawnFadeSeconds;
  const idle = R.idleAmp;
  const win = R.stepWindow;
  const HS = R.hit.squash;
  const HT = R.hit.tilt;
  const HM = R.hit.tiltMax;
  for (let i = 0; i < n; i++) {
    if (ALIVE[i] === 0 || SUS[i] === 2) continue; // § E4.F : garé (même règle que enemies.sync : même curseur)
    const t = TYPE[i];
    if (t === BOSS_T) continue;
    // élite à modèle élite (place libre) : emplacement ENEMY_COUNT + t (même règle que enemies.sync)
    const sl = ELITE_MODELE[t] === 1 && (E.flags[i] & EFLAG.ELITE) !== 0 && cursor[t + ENEMY_COUNT] < ELITE_CAP ? t + ENEMY_COUNT : t;
    const kk = cursor[sl]++;
    if (actifType[sl] === 0) continue;
    const m = matArr[sl];
    const o = kk * 16;
    const age = ANIM_[i];
    const uidPh = ((UID[i] * 21) & 63) * 0.0981748;
    const w = PH[i] + uidPh;
    const g = Math.min(Math.max(G[i], 0), 1); // (G n'est jamais NaN : remis à 0 à l'apparition et dans update)
    const amp = idle + (1 - idle) * g;
    const sb = Math.sin(w);
    const asb = sb > 0 ? sb : -sb;
    // respiration au repos (déphasée par robot) : un robot arrêté n'est pas une statue
    const br = Math.sin(age * 2.1 + uidPh * 3);
    let y = hover[t] + (glide[t] === 1 ? 0.5 + 0.5 * sb : asb) * bobAmp[t] * amp + (1 - g) * 0.012 * br;
    let a = lean[t] * (0.3 + 0.7 * g);
    let b = Math.sin(w * 0.5) * swayAmp[t] * amp;
    let q = squash[t] * (1 - glide[t]) * g * Math.max(1 - asb / win, 0);
    q += HS * FLASH[i];
    const uf = PROGRAMME.actif ? 1 : Math.min(age * fadeInv, 1); // carte mère : révélé par le shader, pas grandi
    let u = uf * (2 - uf);
    if ((E.flags[i] & EFLAG.ELITE) !== 0) u *= CHESTS.carrier.scale; // § E2.C : élite porteuse d'un coffre
    if (E.merged[i] !== 0) u *= CARRY_SCALE[E.merged[i]]; // § E3.K : reportés fusionnés au plafond
    if (t === ENEMY.DRONE) {
      b += AI0[i] * DRONE.anim.bank;
      // v2 (§ E1.B) : il se cabre pendant l'annonce, plonge du nez et descend pendant le piqué
      if (STATE[i] === M_WARN) a -= PIQUE.rearLean * (1 - TIMER[i] * PIQUE_WARN_INV);
      else if (STATE[i] === M_GO) {
        a += PIQUE.diveLean;
        y -= hover[t] * 0.45;
      }
    } else if (t === ENEMY.RODEUR) {
      // v2 (§ E1.B) : il s'accroupit (écrasement qui monte), puis saute en cloche
      if (STATE[i] === M_WARN) q += BOND.crouchSquash * (1 - TIMER[i] * CROUCH_INV);
      else if (STATE[i] === M_GO) {
        const p = 1 - TIMER[i] * LEAP_INV;
        y += 4 * BOND.leapHeight * p * (1 - p);
        a += BOND.leapLean;
      }
    } else if (t === ENEMY.BLINDE) {
      // v2 (§ E1.B) : il recule sur ses appuis pendant l'annonce, se penche pendant la charge
      if (STATE[i] === M_WARN) a -= CHARGE.rearLean * (1 - TIMER[i] * CHARGE_WARN_INV);
      else if (STATE[i] === M_GO) a += CHARGE.chargeLean;
    } else if (t === ENEMY.TIREUR) a -= AI1[i] * RECOIL_K;
    else if (t === ENEMY.KAMIKAZE) {
      if (STATE[i] === K_FUSE) {
        const p = 1 - TIMER[i] * FUSE_INV;
        u *= 1 + KAMI.explode.swell * p;
        b += Math.sin(age * SHAKE_W) * KAMI.explode.shake * p;
      }
    } else if (t === ENEMY.REPARATEUR) {
      u *= 1 + REP.heal.pulseScale * GLOW[i];
      if (VOL_ON === 1) {
        // § E5.D : il flotte (montée et descente lentes, déphasées par robot) et roule doucement, même à l'arrêt
        y += Math.sin(age * FLOT[1] + uidPh * 2) * FLOT[0];
        b += Math.sin(age * FLOT[3] + uidPh) * FLOT[2];
      }
    }
    else if (t >= ENEMY.FOREUSE) y += AI1[i]; // § E3.D : foreuse enfouie (< 0), scanner en chute (> 0)
    //#region e5:AC-contact
    // § E5.AC : fente du coup de mêlée — avance dans le sens du cap (il fait face au joueur) et penché vers l'avant
    const fe = FENTE[i];
    const up = Math.min(fe * FT[1], 1);
    const dn = 1 - Math.min(Math.max(fe - FT[0], 0) * FT[2], 1);
    const fa = fe > FT[0] ? dn * dn : up * up;
    a += FT[4] * fa;
    const av = FT[3] * fa;
    //#endregion e5:AC-contact
    if (E.gen[i] !== 0) u *= GEN_SCALE[E.gen[i]]; // § E3.D : mini-rôdeur du diviseur
    const rot = ROT[i];
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    // P3 : bascule dans le sens du recul (repère du robot)
    const kf = KX[i] * s + KZ[i] * c;
    const ks = KX[i] * c - KZ[i] * s;
    let ta = kf * HT;
    let tb = ks * HT;
    ta = ta > HM ? HM : ta < -HM ? -HM : ta;
    tb = tb > HM ? HM : tb < -HM ? -HM : tb;
    a -= ta;
    b += tb;
    if (q > 0.45) q = 0.45;
    const sy = u * (1 - q);
    const sxz = u / Math.sqrt(1 - q);
    m[o] = c * sxz;
    m[o + 1] = b * sxz;
    m[o + 2] = -s * sxz;
    m[o + 3] = 0;
    m[o + 4] = (s * a - c * b) * sy;
    m[o + 5] = sy;
    m[o + 6] = (c * a + s * b) * sy;
    m[o + 7] = 0;
    m[o + 8] = s * sxz;
    m[o + 9] = -a * sxz;
    m[o + 10] = c * sxz;
    m[o + 11] = 0;
    m[o + 12] = X[i] + s * av; // § E5.AC : + la fente
    m[o + 13] = y;
    m[o + 14] = Z[i] + c * av;
    m[o + 15] = 1;
    const gg = gaitArr[sl];
    if (gg === null) continue; // modèle pas encore posé
    gg[kk * 4] = w;
    gg[kk * 4 + 1] = g;
    gg[kk * 4 + 2] = age;
    // w : distance parcourue (boule du kamikaze, crampons du tireur) ; blindé (ni l'une ni les autres) : état de son
    // bouclier, 0 intact / 1 fissuré (§ E4.P, pièce `fissures`) / 2 sans bouclier (anneau d'acier, § E5.N)
    gg[kk * 4 + 3] = t === BLINDE_T ? ((E.flags[i] & WALL_SANS) !== 0 ? 2 : FIS[i]) : PH[i] * mPerRad[t]; // 2 : anneau d'acier, sans bouclier
  }
  for (let s = 0; s < NS; s++) {
    if (s % ENEMY_COUNT === BOSS_T || actifType[s] === 0 || cursor[s] === 0 || gaitAttr[s] === null) continue;
    // tampon entier, comme render.commit pour instanceMatrix et aFx (addUpdateRange crée un objet par appel)
    gaitAttr[s].needsUpdate = true;
  }
}

// ----- prototype (tests/anim/proto.js) : géométries .glb à pièces, matériaux animés, interrupteur -------------------
const proto = { actif: false, types: [] };

/** Charge les six modèles, les met à la hauteur des maillages actuels et prépare les deux matériaux de chaque type. */
export async function brancher({ scene, crochets }) {
  // aux mêmes étapes que l'intégration : après enemies.update (S5) et après enemies.sync (qui écrit les matrices)
  crochets.enemiesUpdate = (dt) => update(dt);
  crochets.enemiesSync = () => {
    if (proto.actif) sync();
  };
  for (let t = 0; t < ENEMY_COUNT; t++) {
    if (t === BOSS_T) continue;
    const key = KEYS[t];
    const mesh = scene.getObjectByName('robots-' + key);
    if (!mesh) continue;
    mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox;
    let d;
    try {
      d = await chargerPieces(`/assets/modeles/${key}.glb`, { hauteur: b.max.y - Math.max(0, b.min.y) });
    } catch (e) {
      continue;
    }
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'color', 'aEmissive', 'piece']) g.setAttribute(k, d.geometry.attributes[k]);
    g.setIndex(d.geometry.index);
    g.setAttribute('aFx', mesh.geometry.attributes.aFx); // le tampon que enemies.sync écrit
    const ga = new THREE.InstancedBufferAttribute(new Float32Array(E.cap * 4), 4);
    ga.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aGait', ga);
    const base = mesh.material; // matériau peint (le rendu est déjà en « après »)
    meshes[t] = mesh;
    matArr[t] = mesh.instanceMatrix.array;
    gaitArr[t] = ga.array;
    gaitAttr[t] = ga;
    proto.types.push({ t, key, mesh, geometrie: g, avantGeo: mesh.geometry, materiauAvant: base, materiauApres: materiauMembres(base, key, d), triangles: d.triangles, pieces: d.pieces.map((p) => p.nom) });
    mesh.geometry = g; // les modèles .glb dans les deux modes : seule l'animation change
  }
  st.pret = true;
}
export function protoSetApres(on) {
  proto.actif = !!on;
  for (const p of proto.types) {
    p.mesh.material = on ? p.materiauApres : p.materiauAvant;
    actifType[p.t] = on ? 1 : 0;
  }
}
export function protoInspect(out) {
  out.types = proto.types.map((p) => ({ type: p.key, triangles: p.triangles, pieces: p.pieces }));
}

/** § E4.P (tests) : tableau aGait du type t (4 flottants par instance dessinée, dans l'ordre de sync) — null sans modèle. */
export function gaitDe(t) {
  return gaitArr[t];
}
