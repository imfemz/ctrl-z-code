// LOT : enemies — les quatre robots de l'étape 3 (chantier D, contrat : ARCHITECTURE.md § E3.D) : Foreuse, Poseur,
// Scanner, Diviseur. Réglages : E3_ROBOTS (config.js, région e3:D-nouveaux-robots).
//
// Branchement (aucun changement du tronc commun de enemies.update) : l'étape 2 de la boucle A appelle updateF(i) pour
// tout type ≥ ENEMY.FOREUSE, entrées dans ARGF (F_X, F_Z = direction unitaire vers le joueur, F_V = vitesse du robot,
// F_T = pas, F_SX = distance au joueur). Code rendu : 0 = le tronc commun décide (poursuite, ou distance gardée pour
// le poseur, qui a un bloc `ranged`) ; 1 = vitesse voulue imposée (ARGF F_DX, F_DZ ; direction de marche F_SX, F_SZ) ;
// 2 = idem, sans séparation ni frein de foule (manœuvre). damage.killEnemyF appelle onDeathF (scission du diviseur),
// enemies.sync appelle syncBeamsF (rayons des scanners, lot ENNEMIS de src/vfx), src/anim/allure.js lit E.ai1 (décalage
// vertical : enfoui, en chute) et E.gen (taille des mini-rôdeurs). Mines et cercles de la foreuse : src/hazards.js
// (HAZ.MINE, HAZ.DRILL).
//
// Champs de E utilisés (libres pour ces types) : state = phase, timer = minuterie de phase, cd = recharge (foreuse sous
// terre : minuterie de la poussière), ai0 = cible z (foreuse) / sens (poseur, scanner), rev0 = cible x (foreuse) / angle
// du laser (scanner : cap figé par maneuver[], ROT = REV0), ai1 = décalage vertical dessiné, atkCd = tics du laser.
// Aucune allocation en combat (§ V) : tout est en tableaux typés, flottants par ARGF.
import { CAPS, E3_ROBOTS, ENEMIES, ENEMY, HAZ, HURT, SFX, TRAUMA, VFX, VFX_STYLE, WAVES } from './config.js';
import { ARGF, E, F_DX, F_DZ, F_SX, F_SZ, F_T, F_V, F_X, F_Z, P, rand } from './state.js';
import { DANGERS_GUIDE, HAZARDS } from './config.js'; // § E5.M (B10) : arc du scanner dans le langage du balayage du boss
import { CAUSE } from './config.js'; // § E5.Q (C2) : cause des coups de la foreuse et du scanner
//#region e5:X8-lot8
import { LOT8 } from './config.js'; // § E5.X8 : récupération de la foreuse (E8), sons propres (E10)
// X8E : [0] s de récupération, gains et vitesses : [1], [2] cercle de la foreuse ; [3], [4] atterrissage du scanner
const X8E = new Float64Array([LOT8.recup.secondes, LOT8.sons.cercleForeuse.gain, LOT8.sons.cercleForeuse.vitesse, LOT8.sons.atterrissageScanner.gain, LOT8.sons.atterrissageScanner.vitesse]);
const X8E_CERCLE = LOT8.sons.cercleForeuse.id | 0;
const X8E_ATTERRIT = LOT8.sons.atterrissageScanner.id | 0;
let recupsForeuse = 0; // § E5.X8 : sorties suivies d'une récupération
/** § E5.X8 (E10) : son existant au point ARGF F_X, F_Z, gain X8E[k], vitesse X8E[k + 1]. */
function sonX8F(id, k) {
  ARGF[F_V] = X8E[k];
  ARGF[F_T] = X8E[k + 1];
  audio.playGainRateF(id);
}
//#endregion e5:X8-lot8

let enemies = null;
let damage = null;
let hazards = null;
let audio = null;
let camera = null;
let fx = null;
let world = null;

const FOREUSE_T = ENEMY.FOREUSE;
const POSEUR_T = ENEMY.POSEUR;
const SCANNER_T = ENEMY.SCANNER;
const DIVISEUR_T = ENEMY.DIVISEUR;
const RODEUR_T = ENEMY.RODEUR;
const TWO_PI = Math.PI * 2;
const CAPS_MINES = CAPS.robotMines; // mines de poseurs au sol en même temps (toutes)

const FO = E3_ROBOTS.foreuse;
const PO = E3_ROBOTS.poseur;
const SC = E3_ROBOTS.scanner;
const DI = E3_ROBOTS.diviseur;
const T_FO = ENEMIES.types[FOREUSE_T];
const T_PO = ENEMIES.types[POSEUR_T];
const T_SC = ENEMIES.types[SCANNER_T];
const T_DI = ENEMIES.types[DIVISEUR_T];
const T_RO = ENEMIES.types[RODEUR_T];

// Phases (E.state). 0 = neuf (première image, ou robot replacé par relocateF : il repart de zéro).
const NEW = 0;
const F_WALK = 1; // foreuse : marche en surface
const F_DIG = 2; // s'enfonce
const F_TUNNEL = 3; // file sous terre vers le joueur (poussière)
const F_WARN = 4; // cercle HAZ.DRILL sous le joueur : elle gagne le centre
const F_EMERGE = 5; // resurgit (coup dans le cercle)
const P_RUN = 1; // poseur : garde ses distances, sème
const S_FALL = 1; // scanner : chute
const S_IDLE = 2; // posé, entre deux balayages
const S_WARN = 3; // trait télégraphié dans l'axe de départ
const S_SWEEP = 4; // laser qui tourne

/** Taille dessinée d'un rôdeur selon sa génération (E.gen : 0 normal, 1 et 2 mini-rôdeurs du diviseur). */
export const GEN_SCALE = new Float32Array([1, DI.gens[0].scale, DI.gens[1].scale]);

// Compteurs (mesures, tests) : entiers, et les flottants dans des tableaux typés (§ V).
let dives = 0; // foreuses enfouies
let emerges = 0; // sorties
let emergeHits = 0; // sorties qui ont blessé le joueur
const LAST_EMERGE = new Float64Array(3); // écart (m) entre le centre du cercle et le point de sortie ; délai cercle → sortie (s) ; instant du cercle (s de jeu)
let minesLaid = 0;
let landings = 0;
let sweeps = 0;
let beamHits = 0;
const SWEEP_SPEED = new Float64Array(2); // vitesse angulaire mesurée sur le dernier balayage (rad/s) ; angle parcouru (rad)
let splits = 0; // scissions (diviseur et mini-rôdeurs de génération 1)
let children = 0; // mini-rôdeurs créés
let childrenRefused = 0; // naissances abandonnées (plafond de vivants ou de E)
const CLOCK = new Float64Array(1); // s de jeu cumulées par updateF (une fois par image : voir tick)
const pt = new Float64Array(2); // point résolu par world.resolve

export function init(ctx) {
  enemies = ctx.enemies;
  damage = ctx.damage;
  hazards = ctx.hazards;
  audio = ctx.audio;
  camera = ctx.camera;
  fx = ctx.fx;
  world = ctx.world;
}

export function reset() {
  dives = 0;
  emerges = 0;
  emergeHits = 0;
  LAST_EMERGE.fill(0);
  minesLaid = 0;
  landings = 0;
  sweeps = 0;
  beamHits = 0;
  SWEEP_SPEED.fill(0);
  splits = 0;
  children = 0;
  childrenRefused = 0;
  CLOCK[0] = 0;
  recupsForeuse = 0; // § E5.X8
}

/** Une fois par image, avant la boucle (enemies.update) : horloge des mesures. */
export function tick(dt) {
  CLOCK[0] += dt;
}

/** Vitesse voulue (ARGF F_DX, F_DZ) et direction de marche (F_SX, F_SZ) vers (gx, gz) — gx, gz lus dans ARGF F_X, F_Z. */
function steer(i, speed) {
  const dx = ARGF[F_X] - E.x[i];
  const dz = ARGF[F_Z] - E.z[i];
  const d2 = dx * dx + dz * dz;
  if (d2 < 1e-8) {
    ARGF[F_DX] = 0;
    ARGF[F_DZ] = 0;
    ARGF[F_SX] = 0;
    ARGF[F_SZ] = 0;
    return;
  }
  const d = Math.sqrt(d2);
  const ux = dx / d;
  const uz = dz / d;
  ARGF[F_DX] = ux * speed;
  ARGF[F_DZ] = uz * speed;
  ARGF[F_SX] = ux;
  ARGF[F_SZ] = uz;
}

function still() {
  ARGF[F_DX] = 0;
  ARGF[F_DZ] = 0;
  ARGF[F_SX] = 0;
  ARGF[F_SZ] = 0;
}

/** Étape 2 de la boucle A pour un type ≥ ENEMY.FOREUSE (voir l'en-tête). Rend 0, 1 ou 2. */
export function updateF(i) {
  const t = E.type[i];
  if (t === FOREUSE_T) return foreuseF(i);
  if (t === POSEUR_T) return poseurF(i);
  if (t === SCANNER_T) return scannerF(i);
  return 0; // diviseur : il poursuit (sa règle est à sa mort)
}

// ----- Foreuse ---------------------------------------------------------------------------------------------------------
function foreuseF(i) {
  const k = ARGF[F_V];
  const dt = ARGF[F_T];
  const d = ARGF[F_SX];
  const st = E.state[i];
  if (st === NEW || st > F_EMERGE) {
    E.state[i] = F_WALK;
    E.cd[i] = FO.firstDelay;
    E.ai1[i] = 0;
    E.radius[i] = T_FO.radius;
    E.dmg[i] = T_FO.contactDmg * E.mul[i];
    return 0;
  }
  if (st === F_WALK) {
    if (E.cd[i] <= 0 && d <= FO.burrowDist && d >= FO.minDist && P.alive) {
      E.state[i] = F_DIG;
      E.timer[i] = FO.digSeconds;
      E.radius[i] = FO.buriedRadius; // enfouie : ni poussée par la meute, ni au contact du joueur
      E.dmg[i] = 0;
      dives++;
      dust(i);
      ARGF[F_X] = E.x[i];
      ARGF[F_Z] = E.z[i];
      audio.playF(SFX.DRILL); // § E5.AD : elle s'enfouit
    }
    return 0;
  }
  if (st === F_DIG) {
    E.ai1[i] = -FO.depth * (1 - E.timer[i] / FO.digSeconds);
    if (E.timer[i] <= 0) {
      E.state[i] = F_TUNNEL;
      E.timer[i] = FO.tunnelMax;
      E.cd[i] = 0;
      E.ai1[i] = -FO.depth;
    }
    still();
    return 2;
  }
  if (st === F_TUNNEL) {
    E.ai1[i] = -FO.depth;
    if (E.cd[i] <= 0) {
      E.cd[i] = FO.dustEvery;
      dust(i);
    }
    if (d <= FO.aimDist || E.timer[i] <= 0 || !P.alive) {
      // vise : le cercle se pose sous le joueur, elle en gagne le centre et resurgit après FO.warn s
      const gx = P.x;
      const gz = P.z;
      E.rev0[i] = gx;
      E.ai0[i] = gz;
      E.state[i] = F_WARN;
      E.timer[i] = FO.warn;
      ARGF[F_X] = gx;
      ARGF[F_Z] = gz;
      ARGF[F_DX] = FO.drillRadius;
      ARGF[F_DZ] = 0;
      ARGF[F_SX] = 0;
      ARGF[F_SZ] = 0;
      ARGF[F_T] = FO.warn;
      ARGF[F_V] = 0; // la foreuse fait les dégâts à sa sortie, pas le cercle
      hazards.addF(HAZ.DRILL);
      ARGF[F_X] = gx; // § E5.X8 (E10) : bip propre au cercle (était BOSS_TELEGRAPH, le son de la frappe du boss)
      ARGF[F_Z] = gz;
      sonX8F(X8E_CERCLE, 1);
      LAST_EMERGE[2] = CLOCK[0];
      ARGF[F_X] = gx;
      ARGF[F_Z] = gz;
      steer(i, FO.tunnelSpeed);
      return 2;
    }
    ARGF[F_X] = P.x;
    ARGF[F_Z] = P.z;
    steer(i, FO.tunnelSpeed * (k > 0 ? k / T_FO.speed : 1)); // un ralentissement la ralentit aussi sous terre
    return 2;
  }
  if (st === F_WARN) {
    const gx = E.rev0[i];
    const gz = E.ai0[i];
    if (E.timer[i] <= 0) {
      // sortie au centre du cercle
      E.state[i] = F_EMERGE;
      E.timer[i] = FO.emergeSeconds;
      E.radius[i] = T_FO.radius;
      E.dmg[i] = T_FO.contactDmg * E.mul[i];
      emerges++;
      E.recup[i] = X8E[0]; // § E5.X8 (E8) : récupération dès la sortie (immobile, sans contact, yeux éteints)
      recupsForeuse++;
      const ex = E.x[i] - gx;
      const ez = E.z[i] - gz;
      LAST_EMERGE[0] = Math.sqrt(ex * ex + ez * ez);
      LAST_EMERGE[1] = CLOCK[0] - LAST_EMERGE[2];
      const px = P.x - gx;
      const pz = P.z - gz;
      const rr = FO.drillRadius + P.rayonDegats; // § E5.N (B5) : rayon de dégâts (était PLAYER.radius)
      if (P.alive && px * px + pz * pz < rr * rr) {
        if (damage.hitPlayer(FO.emergeDmg * E.mul[i], HURT.EXPLOSION, gx, gz, CAUSE.FOREUSE) > 0) emergeHits++;
      }
      ARGF[F_X] = gx;
      ARGF[F_Z] = gz;
      audio.playF(SFX.DRILL);
      camera.addTrauma(FO.trauma, TRAUMA.ENEMY_EXPLOSION);
      fx.spawnRing(gx, gz, FO.drillRadius, FO.dustColor);
      for (let q = 0; q < 4; q++) dust(i);
      still();
      return 2;
    }
    // elle gagne le centre du cercle (approche amortie, bornée)
    let vx = (gx - E.x[i]) * 10;
    let vz = (gz - E.z[i]) * 10;
    const v2 = vx * vx + vz * vz;
    const vmax = FO.tunnelSpeed * 1.5;
    if (v2 > vmax * vmax) {
      const f = vmax / Math.sqrt(v2);
      vx *= f;
      vz *= f;
    }
    ARGF[F_DX] = vx;
    ARGF[F_DZ] = vz;
    ARGF[F_SX] = 0;
    ARGF[F_SZ] = 0;
    if (dt > 0 && E.cd[i] <= 0) {
      E.cd[i] = FO.dustEvery * 2;
      dust(i);
    }
    return 2;
  }
  // F_EMERGE
  E.ai1[i] = -FO.depth * Math.max(E.timer[i] / FO.emergeSeconds, 0);
  if (E.timer[i] <= 0) {
    E.state[i] = F_WALK;
    E.cd[i] = FO.every;
    E.ai1[i] = 0;
  }
  still();
  return 2;
}

/** Bouffée de poussière au point de la foreuse (traînée sous terre). */
function dust(i) {
  const a = rand() * TWO_PI;
  const r = 0.25 + rand() * 0.35;
  ARGF[F_X] = E.x[i] + Math.sin(a) * r;
  ARGF[F_V] = 0.15;
  ARGF[F_Z] = E.z[i] + Math.cos(a) * r;
  fx.spawnPuffF(FO.dustColor);
}

// ----- Poseur ----------------------------------------------------------------------------------------------------------
function poseurF(i) {
  if (E.state[i] === NEW) {
    E.state[i] = P_RUN;
    E.cd[i] = PO.firstDelay + rand() * PO.every * 0.5;
    E.ai0[i] = (E.uid[i] & 1) === 0 ? 1 : -1; // sens du pas de côté (tronc commun des robots « à distance »)
    return 0;
  }
  if (E.cd[i] <= 0) {
    E.cd[i] = PO.every;
    if (hazards.countKind(HAZ.MINE) < CAPS_MINES) {
      ARGF[F_X] = E.x[i];
      ARGF[F_Z] = E.z[i];
      ARGF[F_DX] = PO.radius;
      ARGF[F_DZ] = 0;
      ARGF[F_SX] = 0;
      ARGF[F_SZ] = 0;
      ARGF[F_T] = PO.life;
      ARGF[F_V] = PO.playerDmg * E.mul[i];
      if (hazards.addF(HAZ.MINE) >= 0) {
        minesLaid++;
        ARGF[F_X] = E.x[i];
        ARGF[F_Z] = E.z[i];
        audio.playF(SFX.MINE_ENEMY);
      }
    }
  }
  return 0; // il garde ses distances (bloc ranged : tronc commun)
}

// ----- Scanner ---------------------------------------------------------------------------------------------------------
function scannerF(i) {
  const dt = ARGF[F_T];
  const st = E.state[i];
  if (st === NEW || st > S_SWEEP) {
    // point de chute : autour du joueur, dans l'écran ; ce pas l'y pose (vitesse = écart / pas), il tombe ensuite
    if (!(dt > 0)) {
      still();
      return 2;
    }
    const a = rand() * TWO_PI;
    const r = SC.landMin + rand() * (SC.landMax - SC.landMin);
    world.resolve(P.x + Math.sin(a) * r, P.z + Math.cos(a) * r, T_SC.radius, pt);
    const gx = pt[0];
    const gz = pt[1];
    E.state[i] = S_FALL;
    E.timer[i] = SC.fallSeconds;
    E.ai1[i] = SC.fallHeight;
    E.radius[i] = 0.05; // en l'air : rien ne le touche, il ne touche rien
    E.dmg[i] = 0;
    E.ai0[i] = (E.uid[i] & 1) === 0 ? 1 : -1;
    E.rev0[i] = Math.atan2(P.x - gx, P.z - gz);
    ARGF[F_X] = gx;
    ARGF[F_Z] = gz;
    ARGF[F_DX] = SC.landRadius;
    ARGF[F_DZ] = 0;
    ARGF[F_SX] = 0;
    ARGF[F_SZ] = 0;
    ARGF[F_T] = SC.fallSeconds;
    ARGF[F_V] = 0;
    hazards.addF(HAZ.MARK);
    ARGF[F_X] = gx;
    ARGF[F_Z] = gz;
    audio.playF(SFX.RAVITAILLEMENT); // § E5.AD : la chute commence (repère au sol)
    ARGF[F_DX] = (gx - E.x[i]) / dt;
    ARGF[F_DZ] = (gz - E.z[i]) / dt;
    ARGF[F_SX] = 0;
    ARGF[F_SZ] = 0;
    return 2;
  }
  if (st === S_FALL) {
    const u = Math.max(E.timer[i] / SC.fallSeconds, 0);
    E.ai1[i] = SC.fallHeight * u * u; // chute accélérée
    if (E.timer[i] <= 0) {
      E.ai1[i] = 0;
      E.radius[i] = T_SC.radius;
      E.dmg[i] = T_SC.contactDmg * E.mul[i];
      E.state[i] = S_IDLE;
      E.timer[i] = SC.firstPause;
      landings++;
      const x = E.x[i];
      const z = E.z[i];
      const px = P.x - x;
      const pz = P.z - z;
      const rr = SC.landRadius + P.rayonDegats; // § E5.N (B5)
      if (P.alive && px * px + pz * pz < rr * rr) damage.hitPlayer(SC.landDmg * E.mul[i], HURT.EXPLOSION, x, z, CAUSE.SCANNER_CHUTE);
      ARGF[F_X] = x;
      ARGF[F_Z] = z;
      sonX8F(X8E_ATTERRIT, 3); // § E5.X8 (E10) : atterrissage propre au scanner (était SFX.DRILL, le son de la foreuse)
      camera.addTrauma(SC.trauma, TRAUMA.ENEMY_EXPLOSION);
      fx.spawnRing(x, z, SC.landRadius, FO.dustColor);
    }
    still();
    return 2;
  }
  if (st === S_IDLE) {
    if (E.timer[i] <= 0 && P.alive) {
      // annonce : le balayage passera sur la position du joueur à mi-course
      const x = E.x[i];
      const z = E.z[i];
      const s = E.ai0[i];
      const start = Math.atan2(P.x - x, P.z - z) - s * SC.omega * SC.sweepSeconds * 0.5;
      E.rev0[i] = start;
      E.state[i] = S_WARN;
      E.timer[i] = SC.warn;
      ARGF[F_X] = x;
      ARGF[F_Z] = z;
      audio.playF(SFX.TIREUR_VISEE); // § E5.AD : annonce du laser (l'arc est dessiné) — la visée d'un tir de laser
      // § E5.M (B10) : plus de trait seul (direction de départ) — l'arc entier est dessiné à chaque image par syncArcsF
    }
    still();
    return 2;
  }
  if (st === S_WARN) {
    if (E.timer[i] <= 0) {
      E.state[i] = S_SWEEP;
      E.timer[i] = SC.sweepSeconds;
      E.atkCd[i] = 0;
      sweeps++;
      SWEEP_SPEED[1] = 0;
      ARGF[F_X] = E.x[i];
      ARGF[F_Z] = E.z[i];
      audio.playF(SFX.SCAN_LASER);
    }
    still();
    return 2;
  }
  // S_SWEEP : le laser tourne à SC.omega ; le joueur dans le rayon prend un tic toutes les SC.tick s
  const step = E.ai0[i] * SC.omega * dt;
  const a = E.rev0[i] + step;
  E.rev0[i] = a - Math.round(a / TWO_PI) * TWO_PI;
  SWEEP_SPEED[1] += step;
  if (P.alive && E.atkCd[i] <= 0) {
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    const dx = P.x - E.x[i];
    const dz = P.z - E.z[i];
    const along = dx * sx + dz * sz;
    if (along > 0 && along < SC.length) {
      const perp = Math.abs(dx * sz - dz * sx);
      // demi-largeur dessinée (traînée du style ENNEMI : 0,7 R à la tête, 0 au bout) + rayon du joueur
      if (perp < SC.beamR * 0.7 * (1 - along / SC.length) + 0.01 + P.rayonDegats) { // § E5.N (B5) (était PLAYER.radius)
        if (damage.hitPlayer(SC.dmg * E.mul[i], HURT.PROJECTILE, E.x[i], E.z[i], CAUSE.SCANNER_LASER) > 0) {
          E.atkCd[i] = SC.tick;
          beamHits++;
        }
      }
    }
  }
  if (E.timer[i] <= 0) {
    SWEEP_SPEED[0] = Math.abs(SWEEP_SPEED[1]) / SC.sweepSeconds;
    E.state[i] = S_IDLE;
    E.timer[i] = SC.pause;
    E.ai0[i] = -E.ai0[i]; // sens alterné
  }
  still();
  return 2;
}

//#region e5:M-dangers-guide
const ARC = DANGERS_GUIDE.scanner;
const ARC_RAD = SC.omega * SC.sweepSeconds; // rad balayés (≈ 240°)
const ARC_START_HALF = SC.beamR * 0.7 + 0.05; // demi-largeur du rectangle de départ (le trait d'avant)
const ARC_ON = ARC.spokeGain; // rayon fin allumé
const ARC_OFF = ARC.spokeGain * ARC.eteint; // rayon fin pas encore atteint par l'annonce
/**
 * § E5.M (B10) : annonce du scanner dans le langage du balayage du boss (boss.js, « Arc du balayage laser ») — rectangle
 * de départ qui pulse + ARC.spokes rayons fins répartis sur tout l'arc, qui s'allument l'un après l'autre DANS LE SENS
 * du balayage pendant l'annonce ; pendant le balayage, ceux déjà balayés s'éteignent. Décalques au sol de hazards.js.
 */
export function syncArcsF() {
  if (E.aliveByType[SCANNER_T] === 0) return;
  const n = E.count;
  const N = ARC.spokes;
  for (let i = 0; i < n; i++) {
    if (E.alive[i] === 0 || E.type[i] !== SCANNER_T) continue;
    const st = E.state[i];
    if (st !== S_WARN && st !== S_SWEEP) continue;
    const warn = st === S_WARN;
    const dir = E.ai0[i];
    // avancement : de l'annonce (0 → 1), puis du balayage (0 → 1) ; départ de l'arc retrouvé depuis l'angle courant
    const u = warn ? 1 - E.timer[i] / SC.warn : 1 - E.timer[i] / SC.sweepSeconds;
    const a0 = warn ? E.rev0[i] : E.rev0[i] - dir * ARC_RAD * u;
    const pulse = 0.5 - 0.5 * Math.cos(u * u * HAZARDS.blinks * TWO_PI);
    for (let j = warn ? 0 : 1; j <= N; j++) {
      const f = j / N;
      if (!warn && f <= u) continue; // déjà balayé
      ARGF[F_X] = E.x[i];
      ARGF[F_Z] = E.z[i];
      ARGF[F_DX] = j === 0 ? ARC_START_HALF : ARC.spokeWidth * 0.5;
      ARGF[F_DZ] = SC.length;
      ARGF[F_SX] = a0 + dir * ARC_RAD * f;
      ARGF[F_V] = j === 0 ? ARC.startGain * (0.65 + 0.35 * pulse) : !warn || f <= u ? ARC_ON : ARC_OFF;
      ARGF[F_T] = -1;
      hazards.traitF();
    }
  }
}
//#endregion

/**
 * Rayons des scanners en balayage, ajoutés au lot ENNEMIS (style ENNEMI : pastille à l'émetteur, traînée qui s'amincit
 * jusqu'au bout du rayon — ce qu'on voit est ce qui touche). Rend le nouveau nombre d'instances du lot.
 */
export function syncBeamsF(va, vn, vcap, stride) {
  if (E.aliveByType[SCANNER_T] === 0) return vn;
  const n = E.count;
  const R = SC.beamR * VFX.ennemi.echelle;
  for (let i = 0; i < n && vn < vcap; i++) {
    if (E.alive[i] === 0 || E.type[i] !== SCANNER_T || E.state[i] !== S_SWEEP) continue;
    const a = E.rev0[i];
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    const o = vn * stride;
    vn++;
    va[o] = E.x[i] + sx * 0.4;
    va[o + 1] = SC.beamY;
    va[o + 2] = E.z[i] + sz * 0.4;
    va[o + 3] = R;
    va[o + 4] = -sx; // la traînée part vers l'arrière de la « tête » : ici, le long du rayon
    va[o + 5] = 0;
    va[o + 6] = -sz;
    va[o + 7] = SC.length;
    va[o + 8] = VFX_STYLE.ENNEMI;
    va[o + 9] = (i * 0.37) % 1;
    va[o + 10] = 1;
    va[o + 11] = Math.max(R * VFX.ennemi.marge, R * 1.6);
  }
  return vn;
}

// ----- Diviseur --------------------------------------------------------------------------------------------------------
/**
 * Mort du robot i (damage.killEnemyF, après le butin ; jamais pour une purge, une mort silencieuse ou sans butin) :
 * le diviseur donne DI.children mini-rôdeurs de génération 1, un mini-rôdeur de génération 1 en donne autant de
 * génération 2, qui ne se scindent plus (1 → 3 → 9). Naissance abandonnée au plafond de vivants (WAVES.maxAlive) ou
 * de E (spawn rend −1).
 */
export function onDeathF(i) {
  const t = E.type[i];
  let gen = 0;
  let base = 0; // multiplicateur de PV du parent, rapporté aux PV de son type de référence
  if (t === DIVISEUR_T) {
    gen = 1;
    base = E.maxHp[i] / T_DI.hp;
  } else if (t === RODEUR_T && E.gen[i] === 1) {
    gen = 2;
    base = E.maxHp[i] / (T_RO.hp * DI.gens[0].hpMul);
  } else return;
  const G = DI.gens[gen - 1];
  const x = E.x[i];
  const z = E.z[i];
  const mul = E.mul[i];
  const hpMul = base * G.hpMul;
  const a0 = rand() * TWO_PI;
  splits++;
  for (let c = 0; c < DI.children; c++) {
    if (E.aliveCount >= WAVES.maxAlive) {
      childrenRefused += DI.children - c;
      break;
    }
    const a = a0 + (c / DI.children) * TWO_PI;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    world.resolve(x + sx * DI.ring, z + sz * DI.ring, T_RO.radius * G.scale, pt);
    const j = enemies.spawn(RODEUR_T, pt[0], pt[1], hpMul, mul);
    if (j < 0) {
      childrenRefused += DI.children - c;
      break;
    }
    E.gen[j] = gen;
    E.radius[j] = T_RO.radius * G.scale;
    E.speed[j] = T_RO.speed * G.speedMul;
    E.kx[j] = sx * 3;
    E.kz[j] = sz * 3;
    children++;
  }
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  audio.playF(SFX.SPLIT);
}

/** Mesures (tests, ?debug). */
export function inspect(out) {
  out.dives = dives;
  out.emerges = emerges;
  out.emergeHits = emergeHits;
  out.recupsForeuse = recupsForeuse; // § E5.X8
  out.lastEmergeErr = LAST_EMERGE[0];
  out.lastEmergeDelay = LAST_EMERGE[1];
  out.minesLaid = minesLaid;
  out.landings = landings;
  out.sweeps = sweeps;
  out.beamHits = beamHits;
  out.sweepSpeed = SWEEP_SPEED[0];
  out.splits = splits;
  out.children = children;
  out.childrenRefused = childrenRefused;
  let buried = 0;
  let gen1 = 0;
  let gen2 = 0;
  let sweeping = 0;
  for (let i = 0; i < E.count; i++) {
    if (E.alive[i] === 0) continue;
    const t = E.type[i];
    if (t === FOREUSE_T && E.state[i] >= F_DIG && E.state[i] <= F_WARN) buried++;
    else if (t === SCANNER_T && E.state[i] === S_SWEEP) sweeping++;
    else if (t === RODEUR_T && E.gen[i] === 1) gen1++;
    else if (t === RODEUR_T && E.gen[i] === 2) gen2++;
  }
  out.buried = buried;
  out.sweeping = sweeping;
  out.gen1 = gen1;
  out.gen2 = gen2;
  return out;
}
