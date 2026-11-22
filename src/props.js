// Plan addictif, étape 3, chantier C — décors cassables (ARCHITECTURE.md § E3.C).
//
// « Bornes de PV » de la carte mère (modèle Blender assets/modeles/borne-pv.glb, outils/blender/borne_pv.py ;
// refonte du 22/11 : bloc carré clair à croix verte, l'ancien cylindre se confondait avec les condensateurs du décor) posées au début de chaque vague, hors des obstacles, loin du départ et du héros.
// Un seul InstancedMesh pour toutes (un appel de dessin, zéro quand il n'y en a aucune).
//
// Coups : une LISTE FIXE (≤ CAPS.props) testée par les explosions (damage.explode → hitAtF), par les tirs du joueur
// (weapons.updateProjectiles → hitPointF) et par le corps du héros (update, DECORS.contactBreaks). Un coup = 1 PV de
// borne, puis DECORS.hitCooldown d'insensibilité (un tir qui la traverse en plusieurs images ne compte qu'une fois).
// Cassée : son, voxels « programmes » du pool d'éclats, secousse, puis un utilitaire (utilities.dropAt) ou des fragments.
// § E4.J (demande de Femz du 16/11, 14h25) : le héros qui arrive au contact casse la borne d'un COUP DE PIED — départ
// au contact (COUP_DE_PIED.portee), casse à l'IMPACT (fin de la frappe), un seul coup par borne, son sourd COUP_PIED,
// mini secousse et arrêt sur image très court. État partagé avec la pose : src/anim/coup-pied.js. Pendant un dash,
// l'ancien contact (casse immédiate) reste.
// § E5.C (demande de Femz du 17/11) : plus de coup AUTOMATIQUE. La borne la plus proche à portée (même portée qu'avant)
// et devant le héros (INTERAGIR.cone) est « prête » : PRET, lu par src/invite-interagir.js (icône de la touche au-dessus
// d'elle) ; la touche « Interagir » (E par défaut, ACTION_INTERACT) donne le coup de pied, identique au coup d'avant.
// Le héros ne traverse plus les bornes (INTERAGIR.bloque) ; un dash les traverse et les casse toujours.
//
// Hasard : flux PRIVÉ (graine = run.seed ^ sel), ni rand() ni randWave() ne changent de nombre de tirages.
// Allocation (§ V) : hitAtF, hitPointF, update et sync n'allouent rien (tableaux typés, ARGF pour les flottants).
// spawnWave tourne au changement de vague (une fois par vague) et n'alloue rien non plus.
import { ACTION_INTERACT, CAPS, COUP_DE_PIED, DECORS, INTERAGIR, MODELES, SFX, TRAUMA, WORLD } from './config.js';
import { ARGF, F_X, F_Z, P, run } from './state.js';
import { TPRET } from './terminal.js'; // § E5.V : terminal à portée — l'invite le montre, pas de coup de pied
import { COUP, C_ACTIF, C_COTE, C_IMPACT, C_LACET, C_LOURD, C_T, C_TF, C_TR, reset as resetCoup, temps as tempsCoup } from './anim/coup-pied.js';
import * as CPV2 from './anim/coup-pied.js'; // § E4.O : coup de pied cuit (mesures, temps, annulation)
import { chargerPieces } from './anim/pieces.js';

let ctx = null;
let render = null;
let world = null;
let audio = null;
let fx = null;
let camera = null;
let utilities = null;

const CAP = CAPS.props;
const pX = new Float32Array(CAP);
const pZ = new Float32Array(CAP);
const pRot = new Float32Array(CAP);
const pHp = new Uint8Array(CAP);
const pCd = new Float32Array(CAP); // s d'insensibilité restante
const pFlash = new Float32Array(CAP);
const pAge = new Float32Array(CAP);
const pKick = new Uint8Array(CAP); // § E4.J : 1 = un coup de pied l'a déjà visée (un seul coup par borne)
const KT = new Int32Array(1); // § E4.J : indice de la borne visée par le coup en cours (−1 : aucune, ou cassée avant l'impact)
KT[0] = -1;
let count = 0;
let mesh = null;
let matArr = null;
let modelReady = false;
let modelSettled = null;
let lastWave = -1;
const R = DECORS.radius;
const S = new Float64Array(2); // [dt, distance de contact²]

// compteurs (inspect)
let spawned = 0;
let broken = 0;
let hits = 0;
let utilDrops = 0;
let fragDrops = 0;
let brokenByContact = 0;
let kicks = 0; // § E4.J : coups de pied partis
let kickBreaks = 0; // … qui ont cassé leur borne à l'impact
let kickWhiffs = 0; // … dont la borne avait été cassée avant l'impact (geste dans le vide)
let kickCancels = 0; // § E4.O : … annulés par un dash
const KI = new Float64Array(2); // § E4.O : [0] trauma accordé au dernier impact, [1] temps du coup au son
const KD = new Float64Array(1); // distance héros → borne au départ du dernier coup (m, mesure ; tableau typé, § V)
let input = null;
// § E5.C — borne prête et appuis, lus par src/invite-interagir.js (tableau typé : aucun objet, § V)
export const PRET_I = 0; // indice de la borne prête (−1 : aucune)
export const PRET_X = 1; // sa position
export const PRET_Z = 2;
export const PRET_COUPS = 3; // coups partis à la touche depuis le début (compteur : l'invite y lit l'appui)
export const PRET_KX = 4; // position de la borne du dernier coup parti à la touche
export const PRET_KZ = 5;
export const PRET_GEN = 6; // +1 à chaque reset (nouvelle partie) : l'invite disparaît sans fondu
export const PRET = new Float64Array(7);
export const TERMINAL_I = 1e6; // § E5.V : PRET[PRET_I] quand l'invite montre le terminal (aucune borne n'a cet indice)
PRET[PRET_I] = -1;
const REQ = new Float64Array(1); // s restantes de la demande d'interaction (INTERAGIR.tampon)
let appuis = 0; // appuis sur Interagir vus en simulation (tests)
let appuisSansBorne = 0; // … dont le tampon a expiré sans borne prête
let pousses = 0; // images où le héros a été repoussé hors d'une borne (INTERAGIR.bloque)

const SALT = 0x5bd1e995;
const seed = new Int32Array(1);
/** [0, 1) — flux privé des décors. */
export function propRand() {
  const s = (seed[0] + 0x6d2b79f5) | 0;
  seed[0] = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function init(context) {
  ctx = context;
  render = ctx.render;
  world = ctx.world;
  audio = ctx.audio;
  fx = ctx.fx;
  camera = ctx.camera;
  utilities = ctx.utilities || null;
  input = ctx.input || null; // § E5.C
  mesh =render.createInstanced(render.emptyModelGeometry(), render.createLitMaterial({ glowColor: DECORS.glow }), CAP, { castShadow: false, name: 'decors' });
  mesh.receiveShadow = true;
  matArr = mesh.instanceMatrix.array;
  modelSettled = chargerPieces(new URL('../' + MODELES.dir + DECORS.model, import.meta.url).href, { cible: DECORS.height, emissifMateriau: true }).then(
    (d) => {
      render.setModelGeometry(mesh, d);
      modelReady = true;
    },
    (e) => console.warn('Borne de données illisible (les décors restent cassables, sans modèle) :', e),
  );
}

/** Promesse tenue (jamais rejetée) quand le modèle est posé ou illisible : main refait alors un préchauffage. */
export function whenModelSettled() {
  return modelSettled;
}

export function reset() {
  count = 0;
  lastWave = -1;
  spawned = 0;
  broken = 0;
  hits = 0;
  utilDrops = 0;
  fragDrops = 0;
  brokenByContact = 0;
  kicks = 0;
  kickBreaks = 0;
  kickWhiffs = 0;
  KT[0] = -1;
  // § E5.C
  PRET[PRET_I] = -1;
  PRET[PRET_GEN]++;
  REQ[0] = 0;
  appuis = 0;
  appuisSansBorne = 0;
  pousses = 0;
  resetCoup();
  seed[0] = (run.seed ^ SALT) | 0;
}

/** Le point (x, z) est-il libre pour une borne ? (obstacles, bord, départ, héros, autres bornes) */
function free(x, z, first) {
  const lim = WORLD.half - DECORS.edge;
  if (x > lim || x < -lim || z > lim || z < -lim) return false;
  if (first && x * x + z * z < DECORS.clearStart * DECORS.clearStart) return false;
  const hx = x - P.x;
  const hz = z - P.z;
  if (hx * hx + hz * hz < DECORS.clearHero * DECORS.clearHero) return false;
  if (world.overlaps(x, z, R + DECORS.gap)) return false;
  const g = 2 * R + DECORS.gap;
  for (let j = 0; j < count; j++) {
    const dx = x - pX[j];
    const dz = z - pZ[j];
    if (dx * dx + dz * dz < g * g) return false;
  }
  return true;
}

/** Début de la vague n : les bornes repoussent jusqu'à DECORS.count (DECORS.respawnPerWave au plus). */
export function spawnWave(n) {
  lastWave = n;
  const target = DECORS.count < CAP ? DECORS.count : CAP;
  const first = n <= 1;
  let add = target - count;
  if (add > DECORS.respawnPerWave) add = DECORS.respawnPerWave;
  const lim = WORLD.half - DECORS.edge;
  for (let k = 0; k < add; k++) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = (propRand() * 2 - 1) * lim;
      const z = (propRand() * 2 - 1) * lim;
      if (!free(x, z, first)) continue;
      const i = count++;
      pX[i] = x;
      pZ[i] = z;
      pRot[i] = propRand() * Math.PI * 2;
      pHp[i] = DECORS.hp;
      pCd[i] = 0;
      pFlash[i] = 0;
      pAge[i] = 0;
      pKick[i] = 0;
      spawned++;
      break;
    }
  }
}

function removeAt(i) {
  const last = --count;
  pX[i] = pX[last];
  pZ[i] = pZ[last];
  pRot[i] = pRot[last];
  pHp[i] = pHp[last];
  pCd[i] = pCd[last];
  pFlash[i] = pFlash[last];
  pAge[i] = pAge[last];
  pKick[i] = pKick[last];
  // § E4.J : la borne visée suit son indice (retirée : le coup de pied finit dans le vide)
  if (KT[0] === i) KT[0] = -1;
  else if (KT[0] === last) KT[0] = i;
  // § E5.C : de même pour la borne prête (cassée par une arme : l'invite part en fondu)
  if (PRET[PRET_I] === i) PRET[PRET_I] = -1;
  else if (PRET[PRET_I] === last) PRET[PRET_I] = i;
}

/** La borne i est cassée : effets, butin, retrait. kick = 1 : par un coup de pied (§ E4.J : son sourd en plus, mini
 *  secousse du coup au lieu de DECORS.shake, arrêt sur image très court). */
function breakAt(i, kick) {
  const x = pX[i];
  const z = pZ[i];
  broken++;
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  audio.playF(SFX.PROP_BREAK);
  if (kick === 1 && COUP[CPV2.C_SON] === 0) {
    // (§ E4.O : le coup cuit l'a déjà joué, avanceSon s avant l'impact — souffle de la jambe puis le choc)
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    audio.playF(SFX.COUP_PIED);
  }
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  fx.spawnPurgeLootF(1, DECORS.voxels);
  if (kick === 1 && COUP[CPV2.C_V2] === 1) {
    // § E4.O.4 : secousse nettement plus forte, dans le groupe plafonné des impacts du joueur ; arrêt sur image et zoom
    const KA = COUP_DE_PIED.v2.agents[COUP[CPV2.C_AGENT]];
    KI[0] = camera.addTraumaAt(KA.secousse, COUP_DE_PIED.v2.trauma, x, z);
    fx.hitstop(KA.arret);
    camera.punchZoom(COUP_DE_PIED.v2.punch);
  } else if (kick === 1) {
    const L = COUP[C_LOURD] === 1;
    camera.addTraumaAt(L ? COUP_DE_PIED.lourd.secousse : COUP_DE_PIED.secousse, TRAUMA.KILL, x, z);
    fx.hitstop(L ? COUP_DE_PIED.lourd.arret : COUP_DE_PIED.arret);
  } else camera.addTraumaAt(DECORS.shake, TRAUMA.KILL, x, z);
  // Femz, 20/11 soir : toujours une Batterie de 25, 50 ou 75 PV (DECORS.drop.batteries), un tirage du flux des décors
  const BAT = DECORS.drop.batteries;
  const r = propRand();
  const palier = r < BAT[0].poids ? 0 : r < BAT[0].poids + BAT[1].poids ? 1 : 2;
  if (utilities !== null && utilities.dropBatterie(x, z, palier) >= 0) utilDrops++;
  removeAt(i);
}

/** Un coup sur la borne i ; rend 1 si elle a cassé. */
function hitOne(i) {
  if (pCd[i] > 0) return 0;
  hits++;
  pCd[i] = DECORS.hitCooldown;
  pFlash[i] = DECORS.hitFlash;
  if (pHp[i] <= 1) {
    breakAt(i, 0);
    return 1;
  }
  pHp[i]--;
  return 0;
}

/**
 * Explosion (ou zone) de rayon r centrée en (ARGF[F_X], ARGF[F_Z]) : un coup à chaque borne touchée. Rend le nombre de
 * bornes touchées. Appelée par damage.explode (aucun flottant en argument sauf r, entier ou lecture de tableau).
 */
export function hitAtF(r) {
  if (count === 0) return 0;
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  const rr = r + R;
  const rr2 = rr * rr;
  let n = 0;
  for (let i = count - 1; i >= 0; i--) {
    const dx = pX[i] - x;
    const dz = pZ[i] - z;
    if (dx * dx + dz * dz > rr2) continue;
    hitOne(i);
    n++;
  }
  return n;
}

/** Tir du joueur au point (ARGF[F_X], ARGF[F_Z]) : rend 1 s'il touche une borne (le tir continue sa course). */
export function hitPointF() {
  if (count === 0) return 0;
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  const r2 = R * R;
  for (let i = count - 1; i >= 0; i--) {
    const dx = pX[i] - x;
    const dz = pZ[i] - z;
    if (dx * dx + dz * dz > r2) continue;
    hitOne(i);
    return 1;
  }
  return 0;
}

/** S8 ter : repousse au changement de vague, minuteries, contact du héros. */
export function update(dt) {
  if (run.wave !== lastWave && run.wave > 0) spawnWave(run.wave);
  S[0] = dt;
  const d = S[0];
  const flashStep = d / DECORS.flashSeconds;
  const cr = R + 0.5;
  S[1] = cr * cr;
  // § E4.J : coup de pied en cours — temps simulé, casse à l'impact (fin de la frappe), fin du geste
  if (COUP[CPV2.C_ANNULE] === 1) {
    // § E4.O.2 : annulé par un dash — la borne redevient « à frapper » si l'impact n'a pas eu lieu
    COUP[CPV2.C_ANNULE] = 0;
    if (KT[0] >= 0 && KT[0] < count && COUP[C_IMPACT] === 0) pKick[KT[0]] = 0;
    KT[0] = -1;
    kickCancels++;
  }
  if (COUP[C_ACTIF] === 1) {
    COUP[C_T] += d;
    // § E4.O.4 : le son du coup cuit part avanceSon s avant l'impact (souffle, puis le choc sur l'image de l'impact)
    if (COUP[CPV2.C_V2] === 1 && COUP[CPV2.C_SON] === 0 && COUP[C_IMPACT] === 0 && KT[0] >= 0 && COUP[C_T] >= COUP[C_TF] - (audio.lead ? audio.lead(SFX.COUP_PIED) : COUP_DE_PIED.v2.avanceSon)) {
      COUP[CPV2.C_SON] = 1;
      KI[1] = COUP[C_T];
      ARGF[F_X] = pX[KT[0]];
      ARGF[F_Z] = pZ[KT[0]];
      audio.playF(SFX.COUP_PIED);
    }
    if (COUP[C_IMPACT] === 0 && COUP[C_T] >= COUP[C_TF]) {
      COUP[C_IMPACT] = 1;
      const j = KT[0];
      KT[0] = -1;
      if (j >= 0 && j < count) {
        hits++;
        brokenByContact++;
        kickBreaks++;
        breakAt(j, 1); // (retire la borne)
      } else kickWhiffs++;
    }
    if (COUP[C_T] >= COUP[C_TR]) COUP[C_ACTIF] = 0;
  }
  const dashing = P.dashT > 0;
  // § E4.O.2 : coup cuit — départ à D* + le chemin de freinage (v vers la borne × fonduEntree / 2) : le héros se plante à D*
  const V2 = COUP_DE_PIED.v2 && COUP_DE_PIED.v2.actif && CPV2.cuitCharge(run.agent) ? 1 : 0;
  const DS = V2 === 1 ? CPV2.MES[run.agent * 8 + 6] : 0;
  const kr = R + COUP_DE_PIED.portee;
  const kr2 = V2 === 1 ? Infinity : kr * kr; // (coup cuit : la portée est testée borne par borne, ci-dessous)
  let cible = -1;
  let dmin = kr2;
  // § E5.C : cap du héros (cône « la regarde à peu près ») et rayon de blocage
  const fx0 = Math.sin(P.rot);
  const fz0 = Math.cos(P.rot);
  const cone = INTERAGIR.cone;
  const rb = R + P.radius;
  const bloque = INTERAGIR.bloque && !dashing && P.alive && COUP[C_ACTIF] === 0;
  for (let i = count - 1; i >= 0; i--) {
    pAge[i] += d;
    if (pCd[i] > 0) pCd[i] = pCd[i] > d ? pCd[i] - d : 0;
    if (pFlash[i] > 0) pFlash[i] = pFlash[i] > flashStep ? pFlash[i] - flashStep : 0;
    if (DECORS.contactBreaks && P.alive) {
      let dx = pX[i] - P.x;
      let dz = pZ[i] - P.z;
      let d2 = dx * dx + dz * dz;
      if (bloque && d2 < rb * rb) {
        // § E5.C : le héros bute sur la borne (repoussé sur son bord, il glisse autour)
        const dd = Math.sqrt(d2);
        const ux = dd > 1e-6 ? dx / dd : 0;
        const uz = dd > 1e-6 ? dz / dd : 1;
        P.x = pX[i] - ux * rb;
        P.z = pZ[i] - uz * rb;
        dx = pX[i] - P.x;
        dz = pZ[i] - P.z;
        d2 = dx * dx + dz * dz;
        pousses++;
      }
      if (dashing) {
        // pendant un dash : l'ancien contact (casse immédiate)
        if (d2 < S[1]) {
          pCd[i] = 0;
          pHp[i] = 1;
          brokenByContact++;
          hitOne(i);
        }
      } else if (pKick[i] === 0 && d2 < dmin) {
        // § E5.C : devant le héros (cône large) ; tout près (dans le rayon de blocage + 5 cm), toujours
        if (cone > -1 && d2 > (rb + 0.05) * (rb + 0.05) && fx0 * dx + fz0 * dz < cone * Math.sqrt(d2)) continue;
        if (V2 === 1) {
          // portée propre à la borne : D* + freinage selon la vitesse du héros VERS elle
          const dd = Math.sqrt(d2);
          let vt = dd > 1e-6 ? (P.vx * dx + P.vz * dz) / dd : 0;
          if (vt < 0) vt = 0;
          const ki = DS + vt * COUP_DE_PIED.v2.fonduEntree * 0.5;
          if (dd > ki) continue;
        }
        dmin = d2;
        cible = i;
      }
    }
  }
  // § E5.C : borne prête (aucun coup en cours, hors dash) — l'invite la montre ; la touche Interagir la frappe. Un appui
  // reste valable INTERAGIR.tampon s (appui juste avant d'arriver à portée ; hitstop : main reporte le front)
  // § E5.V : terminal posé à portée — priorité sur les bornes : l'invite le montre (indice hors des bornes) et un appui
  // sur Interagir l'ouvre (main.js) au lieu de donner un coup de pied
  if (TPRET[0] === 1 && COUP[C_ACTIF] === 0) {
    PRET[PRET_I] = TERMINAL_I;
    PRET[PRET_X] = TPRET[1];
    PRET[PRET_Z] = TPRET[2];
    REQ[0] = 0;
    return;
  }
  const pret = COUP[C_ACTIF] === 0 && !dashing ? cible : -1;
  PRET[PRET_I] = pret;
  if (pret >= 0) {
    PRET[PRET_X] = pX[pret];
    PRET[PRET_Z] = pZ[pret];
  }
  if (input !== null && input.pressed(ACTION_INTERACT)) {
    REQ[0] = INTERAGIR.tampon;
    appuis++;
  }
  if (pret < 0 || REQ[0] <= 0) {
    if (REQ[0] > 0) {
      REQ[0] = REQ[0] > d ? REQ[0] - d : 0;
      if (REQ[0] === 0) appuisSansBorne++;
    }
    return;
  }
  REQ[0] = 0;
  PRET[PRET_I] = -1;
  PRET[PRET_COUPS]++;
  COUPS_TOUCHE[0]++; // § E5.AE
  PRET[PRET_KX] = pX[cible];
  PRET[PRET_KZ] = pZ[cible];
  // § E4.J : départ d'un coup de pied vers la borne prête (aucun coup en cours, héros au sol)
  {
    pKick[cible] = 1;
    KT[0] = cible;
    kicks++;
    KD[0] = Math.sqrt(dmin);
    COUP[C_ACTIF] = 1;
    COUP[C_T] = 0;
    COUP[C_IMPACT] = 0;
    COUP[C_COTE] = -1; // choisi par la pose (heros-anim) : côté de la borne par rapport au bassin
    COUP[C_LACET] = Math.atan2(pX[cible] - P.x, pZ[cible] - P.z);
    COUP[C_LOURD] = run.agent === COUP_DE_PIED.lourd.agent ? 1 : 0;
    tempsCoup(COUP[C_LOURD] === 1 ? 1 : 0);
    COUP[CPV2.C_V2] = V2;
    COUP[CPV2.C_SON] = 0;
    COUP[CPV2.C_ANNULE] = 0;
    COUP[CPV2.C_LIBRE] = 0;
    if (V2 === 1) {
      // § E4.O.1 : recalage — point de plantage à D* de la borne, sur la droite borne → héros ; trop près : recul borné
      const a = run.agent;
      const bx = pX[cible];
      const bz = pZ[cible];
      const dd = KD[0];
      const ux = dd > 1e-6 ? (P.x - bx) / dd : 0;
      const uz = dd > 1e-6 ? (P.z - bz) / dd : 1;
      let ds = DS;
      if (dd < DS - COUP_DE_PIED.v2.recalageMax) ds = dd + COUP_DE_PIED.v2.recalageMax;
      COUP[CPV2.C_AGENT] = a;
      COUP[CPV2.C_BX] = bx;
      COUP[CPV2.C_BZ] = bz;
      COUP[CPV2.C_X0] = P.x;
      COUP[CPV2.C_Z0] = P.z;
      COUP[CPV2.C_VX0] = P.vx;
      COUP[CPV2.C_VZ0] = P.vz;
      // § E5.C : le coup part à la touche, parfois plus près que le chemin de freinage prévu (le coup automatique partait
      // juste à D* + v × fonduEntree / 2). Le freinage d'Hermite déborderait au-delà du point de plantage puis
      // reviendrait (un pas en arrière) : la vitesse VERS la borne est bornée à 3 × (distance au plantage) / fonduEntree
      // (Hermite monotone), 0 si le héros est déjà plus près que le plantage (recalage du § E4.O.1).
      const marge = dd - ds;
      const vt = -(P.vx * ux + P.vz * uz); // vitesse vers la borne (u va de la borne vers le héros)
      const vmax = marge > 0 ? (3 * marge) / COUP_DE_PIED.v2.fonduEntree : 0;
      if (vt > vmax) {
        COUP[CPV2.C_VX0] = P.vx + (vt - vmax) * ux;
        COUP[CPV2.C_VZ0] = P.vz + (vt - vmax) * uz;
      }
      COUP[CPV2.C_PX] = bx + ux * ds;
      COUP[CPV2.C_PZ] = bz + uz * ds;
      COUP[C_LACET] = Math.atan2(-ux, -uz);
      COUP[CPV2.C_CAP] = COUP[C_LACET] - CPV2.MES[a * 8 + 2];
      COUP[C_COTE] = 1;
      CPV2.tempsV2(a);
    }
  }
}

/** F11 : une instance par borne (pop d'apparition, flash au coup). */
export function sync() {
  const fxArr = mesh.geometry.attributes.aFx.array;
  for (let i = 0; i < count; i++) {
    let pop = pAge[i] * 3;
    if (pop > 1) pop = 1;
    const s = 0.4 + 0.6 * pop * (2 - pop);
    const rot = pRot[i];
    const c = Math.cos(rot) * s;
    const sn = Math.sin(rot) * s;
    const o = i * 16;
    matArr[o] = c;
    matArr[o + 1] = 0;
    matArr[o + 2] = -sn;
    matArr[o + 3] = 0;
    matArr[o + 4] = 0;
    matArr[o + 5] = s;
    matArr[o + 6] = 0;
    matArr[o + 7] = 0;
    matArr[o + 8] = sn;
    matArr[o + 9] = 0;
    matArr[o + 10] = c;
    matArr[o + 11] = 0;
    matArr[o + 12] = pX[i];
    matArr[o + 13] = 0;
    matArr[o + 14] = pZ[i];
    matArr[o + 15] = 1;
    fxArr[i * 2] = pFlash[i];
    fxArr[i * 2 + 1] = 0;
  }
  render.commit(mesh, modelReady ? count : 0);
}

export function getCount() {
  return count;
}

/** Debug et tests : pose une borne en (x, z) (hors combat ou depuis la console). */
export function debugPlace(x, z) {
  if (count >= CAP) return -1;
  const i = count++;
  pX[i] = x;
  pZ[i] = z;
  pRot[i] = 0;
  pHp[i] = DECORS.hp;
  pCd[i] = 0;
  pFlash[i] = 0;
  pAge[i] = 1;
  pKick[i] = 0;
  return i;
}

/** Tests : pose une borne en (x, z) et la casse aussitôt (butin compris), comme un tir. Rend 1. */
export function debugCasser(x, z) {
  const i = debugPlace(x, z);
  if (i < 0) return 0;
  breakAt(i, 0);
  return 1;
}

export function debugClear() {
  count = 0;
  KT[0] = -1;
  PRET[PRET_I] = -1; // § E5.C
}

export function inspect(out) {
  out.count = count;
  out.spawned = spawned;
  out.broken = broken;
  out.hits = hits;
  out.utilDrops = utilDrops;
  out.fragDrops = fragDrops; // § E2 : lots de fragments des bornes — toujours 0 depuis le 20/11 (Batteries seulement)
  out.brokenByContact = brokenByContact;
  out.kicks = kicks; // § E4.J
  out.kickBreaks = kickBreaks;
  out.kickWhiffs = kickWhiffs;
  out.kickCancels = kickCancels; // § E4.O
  out.kickTrauma = KI[0];
  out.kickSonT = KI[1];
  out.kickDist = KD[0];
  out.kickTarget = KT[0];
  // § E5.C
  out.pret = PRET[PRET_I];
  out.pretX = PRET[PRET_X];
  out.pretZ = PRET[PRET_Z];
  out.coupsTouche = PRET[PRET_COUPS];
  out.appuis = appuis;
  out.appuisSansBorne = appuisSansBorne;
  out.demande = REQ[0];
  out.pousses = pousses;
  out.coup = Array.from(COUP);
  out.modelReady = modelReady;
  out.lastWave = lastWave;
  out.list = [];
  for (let i = 0; i < count; i++) out.list.push({ x: pX[i], z: pZ[i], hp: pHp[i], kick: pKick[i] });
  return out;
}

//#region e5:AE-tuto-bornes
// § E5.AE : positions des bornes, lues par src/tuto-bornes.js (borne à l'écran la plus proche ; indices 0 … getCount() − 1)
export { pX as BORNE_X, pZ as BORNE_Z };
// § E5.AE : coups de pied partis à la touche, en ENTIER (lu à chaque image par consignes.js : la lecture d'un Float64Array
// emballe un flottant dans le code non optimisé, pas celle d'un Int32Array)
export const COUPS_TOUCHE = new Int32Array(1);
//#endregion e5:AE-tuto-bornes
