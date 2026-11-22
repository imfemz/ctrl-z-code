// LOT : audio — sons du jeu (Web Audio), limitation, volume général (contrat : ARCHITECTURE.md § P).
//
// Intégration des sons (13/11/2026) : le jeu joue les FICHIERS de Femz (assets/sfx/, gains, variantes et « lead » du
// manifeste écrit par outils/preparer_*.py) et la nappe d'ambiance en boucle (assets/ambiance/). Base : l'aperçu
// validé tests/jouable/audio.js, porté dans ce moteur (mêmes règles, mêmes voix, aucune allocation de plus par son).
//   • Les fichiers sont téléchargés et DÉCODÉS dès init(), dans un OfflineAudioContext (aucun AudioContext, aucun
//     avertissement avant le geste) : au premier geste ils sont en général déjà prêts.
//   • Un son dont un fichier manque (manifeste sans entrée, téléchargement ou décodage refusé, ou pas encore arrivé
//     au premier geste) joue son tampon SYNTHÉTISÉ (recettes ci-dessous) ; il passe à ses fichiers dès qu'ils sont prêts.
//   • Variantes (orbitaux, morts de robots, rail, pas du boss) : tirées à tour de rôle ; § E5.G : celles des sons de
//     AUDIO.files.hasard (pas des agents) au hasard, jamais deux fois la même de suite. Hauteur des fichiers : pitchVar
//     × AUDIO.files.pitchScale (0 = l'aperçu) ; la série des gemmes monte toujours.
//   • Séquences (AUDIO.files.sequences : compte à rebours, mèche du kamikaze) : le fichier contient tout ; play() le
//     lance au début, playStep() (« 2 », « 1 », éclats suivants) ne rejoue rien tant qu'il vient d'un fichier.
//   • lead(id) : avance du fichier (manifeste) — shop.js lance MERCHANT_LAND d'autant avant le contact.
//   • Ambiance : une source en boucle et son GainNode (AUDIO.ambiance.gain), branchés sous le gain général.
//
// Rien n'est créé avant le premier geste : le contexte, le gain général, le compresseur, les 24 GainNode de voix,
// les tampons synthétisés des sons sans fichier prêt et l'amorce naissent UNE fois, au premier unlock(), et ne sont
// jamais recréés (ni par reset(), ni ensuite).
// Chaîne : source (une par départ) → GainNode de la voix → gain général (volume × AUDIO.busGain) → compresseur
// → sortie. Un départ ne crée qu'un AudioBufferSourceNode ; la fin d'une voix se calcule (départ + durée /
// vitesse de lecture) dans un Float64Array et se compare à l'horloge du module dans update : pas d'onended.
// Les hauteurs sont tirées par un générateur privé : audio n'appelle jamais rand() ni randWave().
//
// Trois faits mesurés dans Chromium et Firefox, qui expliquent trois réglages (tests/audio.test.mjs les rejoue) :
//   • Firefox ne traite plus le compresseur dès que son entrée se tait : les 6 ms de son encore dans sa ligne à
//     retard sont coupées net (un clic) et ressortent avant le son suivant. Chaque tampon synthétisé finit donc par
//     un silence (AUDIO.tailSilence, à la vitesse de lecture la plus haute) qui laisse le temps de vider cette ligne.
//     (Avec les fichiers, la nappe d'ambiance garde l'entrée du compresseur occupée.)
//   • Firefox crée le contexte « suspended » et ne le passe à « running » qu'un instant plus tard : pendant
//     AUDIO.startGrace secondes après le geste qui CRÉE le contexte, les départs lui sont confiés quand même
//     (ils sonnent dès qu'il démarre), sinon le premier « 3 » d'une partie lancée au clavier serait perdu. Cette
//     fenêtre ne s'ouvre qu'une fois : un contexte qui se rendort plus tard reste muet jusqu'à ce qu'il tourne.
//   • Un compresseur neuf plonge puis remonte pendant un dixième de seconde : ce qu'il reçoit alors sort étouffé
//     (−15 dB sur un tic de compte à rebours, −18 dB sur un tir de blaster). Il ne plonge pas si son attaque est
//     longue : il naît donc avec l'attaque AUDIO.settleAttack, une amorce inaudible (AUDIO.primerLevel) le traverse
//     tout de suite pour que son détecteur se pose, et update lui rend l'attaque de config.js après AUDIO.settle
//     secondes d'horloge audio. Le premier son d'une séance part ainsi tout de suite, à son niveau (écart mesuré :
//     0,06 dB au plus), au lieu d'attendre que le compresseur se pose.
import { AUDIO, SFX, SFX_COUNT } from './config.js';
import { ARGF, F_T, F_V, F_X, F_Z, P } from './state.js';

const N = SFX_COUNT;
const V = AUDIO.maxVoices;
const NEVER = -1e9; // « jamais joué » : toute comparaison d'intervalle passe
const SEMITONE = Math.LN2 / 12; // exp(n × SEMITONE) = rapport de fréquence de n demi-tons

// ----- Réglages par son, mis à plat une fois (lecture seule) ------------------------------------------------------
const cfgGain = new Float64Array(N);
const cfgInterval = new Float64Array(N);
const cfgPitch = new Float64Array(N); // ± demi-tons
const cfgMaxVoices = new Uint8Array(N);
const cfgPriority = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const s = AUDIO.sounds[i];
  cfgGain[i] = s.gain;
  cfgInterval[i] = s.minInterval;
  cfgPitch[i] = s.pitchVar;
  cfgMaxVoices[i] = s.maxVoices;
  cfgPriority[i] = s.priority === 2 ? 2 : s.priority === 1 ? 1 : 0;
}
// Budget de voix par priorité : les bruits de combat (0) ne prennent jamais plus de CHATTER_VOICES voix ; avec les
// armes et les explosions (1), jamais plus de COMMON_VOICES ; les sons rares et importants (2) ont droit aux 24.
const CHATTER_VOICES = Math.max(1, Math.min(V, AUDIO.voiceBudget[0]));
const COMMON_VOICES = Math.max(CHATTER_VOICES, Math.min(V, AUDIO.voiceBudget[1]));

// Atténuation avec la distance au joueur : 1 jusqu'à ref, puis ((max − d) / (max − ref))^exponent, 0 à max.
const DIST_REF_SQ = AUDIO.distance.ref * AUDIO.distance.ref;
const DIST_MAX = AUDIO.distance.max;
const DIST_MAX_SQ = DIST_MAX * DIST_MAX;
const DIST_INV_SPAN = 1 / (AUDIO.distance.max - AUDIO.distance.ref);
const DIST_EXPONENT = AUDIO.distance.exponent;
const dist2 = new Float64Array(1); // distance² au joueur de la demande en cours (aucun flottant de module, § V)

// Série des gemmes : vitesse de lecture de chaque marche (un demi-ton par marche). Arrivée au sommet, la série
// redescend de AUDIO.gem.loopSteps marches et continue de monter (12 marches d'un demi-ton : une octave plus bas,
// la suite des notes ne s'interrompt pas) ; loopSteps = 0 : elle reste au sommet.
const GEM_MAX = AUDIO.gem.maxSteps;
const GEM_LOOP = AUDIO.gem.loopSteps > 0 ? Math.max(0, GEM_MAX + 1 - Math.round(AUDIO.gem.loopSteps)) : GEM_MAX;
const gemRate = new Float64Array(GEM_MAX + 1);
// § E5.Q ter (Femz, 21/11 : « la tonalité des sfx ne doit pas clasher avec la musique ») : AUDIO.gem.degres donne la
// marche en demi-tons (les notes de la gamme de la musique) ; sans lui, un demi-ton par marche comme avant
const GEM_DEG = AUDIO.gem.degres || null;
for (let i = 0; i <= GEM_MAX; i++) gemRate[i] = Math.exp((GEM_DEG ? GEM_DEG[i] : i * AUDIO.gem.stepSemitones) * SEMITONE);

// ----- État (tableaux typés : aucun flottant de module réécrit à chaque image, § V) --------------------------------
const CLOCK = 0; // horloge du module : somme des realDt reçus par update
const GEM_LAST = 1; // horloge de la dernière collecte de gemme demandée
const START_UNTIL = 2; // horloge jusqu'à laquelle un contexte en train de démarrer accepte déjà des départs
const clock = new Float64Array(3);
clock[GEM_LAST] = NEVER;
clock[START_UNTIL] = NEVER;
const PITCH = 0; // générateur privé des hauteurs (mulberry32, tiré dans play)
const NOISE = 1; // générateur du bruit blanc des tampons
const VARIANT = 2; // § E5.G : générateur des variantes tirées au hasard (AUDIO.files.hasard : pas des agents)
const rng = new Int32Array(3);
rng[PITCH] = AUDIO.seed | 0;
rng[VARIANT] = (AUDIO.seed | 0) ^ 0x5bd1e995;

const playedById = new Int32Array(N); // demandes, comptées même sans contexte (jamais remises à zéro)
const startedById = new Int32Array(N); // départs réels
const droppedById = new Int32Array(N); // refus de la limitation, par son (journal des départs de l'intégration)
const activeById = new Uint8Array(N); // voix en cours, par son
const activeByPriority = new Uint8Array(3); // voix en cours, par priorité
const lastStart = new Float64Array(N).fill(NEVER); // horloge du dernier départ, par son
const bufferSeconds = new Float64Array(N); // durée réelle de chaque tampon
const voiceEnd = new Float64Array(V); // fin calculée de chaque voix (horloge du module)
const voiceSound = new Int8Array(V).fill(-1); // son joué par chaque voix, −1 = libre

const voiceGains = new Array(V).fill(null); // GainNode permanents, un par voix
const buffers = new Array(N).fill(null); // AudioBuffer, un par son

let ac = null; // AudioContext
let master = null; // gain général
// Réglages de Femz (21/11) : deux volumes séparés sous le gain général — bruitages (toutes les voix) et musique
let sfxBus = null; // GainNode des voix → master (volume des effets sonores)
let musiqueBus = null; // GainNode de la musique (après son gain de premier plan) → master
let sfxVolume = 1;
let musiqueVolume = 1;
let compressor = null; // compresseur de sortie (réglé à la création ; update lui rend son attaque une fois posé)
let failed = false; // la création a échoué : on ne réessaie pas
let running = false; // ac.state === 'running', relu une fois par image et à chaque unlock
let settling = false; // le compresseur vient d'être créé : son attaque reste longue AUDIO.settle s (horloge audio)
let masterVolume = AUDIO.masterVolume;

let played = 0;
let started = 0;
let dropped = 0; // refus de la limitation (intervalle, distance, voix du son, voix au total)
let droppedInterval = 0;
let droppedDistance = 0;
let droppedVoices = 0;
let droppedPool = 0;
let muted = 0; // demandes reçues sans contexte débloqué
let startErrors = 0;
let activeVoices = 0;
let gemNext = 0; // marche que prendra la prochaine gemme jouée
let contexts = 0; // contextes créés depuis le chargement (0 ou 1)
let buildMs = 0; // durée de la création (contexte, nœuds et synthèse des 37 tampons), en ms
let synthMs = 0; // dont la synthèse des tampons
let SR = 48000; // fréquence d'échantillonnage des tampons, fixée à la création

// ----- Fichiers (manifeste) -----------------------------------------------------------------------------------------
const FILES = AUDIO.files;
const ID_BY_NAME = Object.create(null); // « BLASTER » → SFX.BLASTER
for (const key of Object.keys(SFX)) ID_BY_NAME[key] = SFX[key];
const FILE_NONE = 0; // le manifeste ne donne aucun fichier pour ce son
const FILE_LOADING = 1;
const FILE_READY = 2;
const FILE_FAILED = 3;
const fileState = new Uint8Array(N);
const useFile = new Uint8Array(N); // 1 : le son joue ses fichiers (sinon son tampon synthétisé)
const fileBuffers = new Array(N).fill(null); // AudioBuffer[] décodés, par son
const fileSeconds = new Array(N).fill(null); // Float64Array : durée de chaque variante
const fileGain = new Float64Array(N); // gain du manifeste
const fileLead = new Float64Array(N); // avance du manifeste (s)
const filePitch = new Float64Array(N); // ± demi-tons pour les fichiers : pitchVar × FILES.pitchScale
const fileNext = new Uint8Array(N); // variante du prochain départ (à tour de rôle)
// § E5.G : sons dont la variante est tirée au hasard, jamais deux fois la même de suite (AUDIO.files.hasard)
const isRandom = new Uint8Array(N);
const fileLast = new Int16Array(N).fill(-1); // dernière variante jouée (−1 : aucune)
if (Array.isArray(FILES.hasard)) for (let k = 0; k < FILES.hasard.length; k++) isRandom[FILES.hasard[k]] = 1;
const isSequence = new Uint8Array(N); // le fichier contient toute la séquence (FILES.sequences)
// Dernier départ de chaque son : SEQ_FILE (son fichier : les rappels d'une séquence y sont), SEQ_SYNTH (son tampon
// synthétisé : chaque rappel rejoue le TAMPON, même si les fichiers sont arrivés entre-temps — sinon un « 3 »
// synthétisé, fichiers décodés juste après, ferait partir tout le fichier « 3, 2, 1 » au « 2 »), 0 (aucun).
const SEQ_FILE = 1;
const SEQ_SYNTH = 2;
const seqFromFile = new Uint8Array(N);
for (let i = 0; i < N; i++) filePitch[i] = cfgPitch[i] * FILES.pitchScale;
for (let k = 0; k < FILES.sequences.length; k++) isSequence[FILES.sequences[k]] = 1;
const MAN_NONE = 0;
const MAN_LOADING = 1;
const MAN_OK = 2;
const MAN_FAILED = 3;
const MAN_NAMES = ['none', 'loading', 'ok', 'failed'];
let manifestState = MAN_NONE;
let decoder = null; // OfflineAudioContext qui décode les fichiers (aucun son, aucun geste requis)
let filesExpected = 0;
let filesDecoded = 0;
let filesFailed = 0;
let droppedSequence = 0;
let droppedLoading = 0; // son dont les fichiers (ou le manifeste) arrivent encore : silence plutôt que l'ancien son synthétisé
const loadMs = new Float64Array(2); // [début du chargement, fin : tous les fichiers des sons arrivés ou refusés] (performance.now)
const AMB_NONE = 0; // pas de nappe dans le manifeste
const AMB_LOADING = 1;
const AMB_READY = 2; // décodée, en attente du contexte
const AMB_PLAYING = 3;
const AMB_FAILED = 4;
const AMB_NAMES = ['none', 'loading', 'ready', 'playing', 'failed'];
// 21/11/2026 : la nappe OCULAR est remplacée par la BANDE-SON (AUDIO.musique, pistes Suno choisies par Femz). Les noms
// « ambiance » restent pour le niveau (setAmbiance, AUDIO.ambiance.gain, MENU.son.ambiance) : ambianceGain est le
// gain de niveau de la musique, sous lequel passent toutes les pistes.
let ambianceState = AUDIO.musique && AUDIO.musique.pistes ? AMB_READY : AMB_NONE; // rien à décoder : lue en flux
let ambianceGain = null; // GainNode du niveau de la musique, créé une fois
// ----- Musique (21/11/2026) -------------------------------------------------------------------------------------------
// Chaque piste est lue EN FLUX (HTMLAudioElement → MediaElementAudioSourceNode) : jamais décodée en entier (une piste
// de 4 min décodée = 94 Mo). Deux lecteurs par piste : la fin d'une piste se fond dans son propre début sur l'autre
// lecteur (AUDIO.musique.fonduBoucle). Changer de piste = fondu enchaîné (AUDIO.musique.fondu) : jamais de coupure
// nette (demande de Femz). Hors du premier plan (fenêtre réduite, cachée ou sans le focus), la musique s'éteint en
// fondu (focusGain) et revient au retour (demande de Femz). Chaîne : lecteur → gain du lecteur → ambianceGain (niveau)
// → focusGain → gain général.
const MUS = AUDIO.musique || { pistes: {}, fondu: 2.5, fonduBoucle: 6, fonduFocus: 0.6, dir: '' };
const MUS_NOMS = Object.keys(MUS.pistes);
const MUS_LECTEURS = MUS_NOMS.length * 2;
const musEl = new Array(MUS_LECTEURS).fill(null);
const musGain = new Array(MUS_LECTEURS).fill(null);
const musActif = new Uint8Array(MUS_LECTEURS); // 1 : le lecteur joue (ou s'éteint)
const musFin = new Float64Array(MUS_LECTEURS); // heure audio où l'extinction est finie (0 : aucune en cours)
let musPiste = -1; // piste voulue (index dans MUS_NOMS), −1 : aucune
let musLecteur = -1; // lecteur de la piste voulue
let musRelance = 0; // 1 : la boucle de la piste courante est déjà relancée sur l'autre lecteur
let focusGain = null;
let premierPlan = 1;
// Niveau visé par la nappe (écran titre, § Z octies : plus fort au titre, ramené à AUDIO.ambiance.gain au lancement) et
// constante de temps de la prochaine montée, posés par setAmbiance même avant le contexte. Gain du départ de
// playGain, remis à 1 après chaque départ. Tableaux typés : aucun nombre alloué par écriture (§ V).
const ambianceLevel = new Float64Array([AUDIO.ambiance.gain, AUDIO.ambiance.fadeIn / 3]);
const extraGain = new Float64Array([1]);
const extraRate = new Float64Array([1]); // § E3.A : transposition demandée par playPitch (1 = aucune)

function noop() {}

// =====================================================================================================================
// Synthèse — exécutée une seule fois, au premier unlock(). Chaque recette additionne des « tons » et des « bruits »
// dans le Float32Array du tampon ; finishBuffer retire le continu, pose les fondus et ramène la crête à AUDIO.peak.
// =====================================================================================================================
const TAU = Math.PI * 2;
const SINE = 0;
const TRI = 1;
const SQUARE = 2;
const SAW = 3;
const LOW = 0;
const BAND = 1;
const HIGH = 2;

/** Fréquence d'une note MIDI (69 = la 440 Hz). */
function note(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Bruit blanc dans [−1, 1) — congruentiel, graine remise avant chaque son : les tampons sont reproductibles. */
function white() {
  const s = (Math.imul(rng[NOISE], 1664525) + 1013904223) | 0;
  rng[NOISE] = s;
  return s / 2147483648;
}

/** Correction polyBLEP d'une discontinuité (carré, dent de scie sans repliement audible). */
function polyBlep(t, dt) {
  if (t < dt) {
    const u = t / dt;
    return u + u - u * u - 1;
  }
  if (t > 1 - dt) {
    const u = (t - 1) / dt;
    return u * u + u + u + 1;
  }
  return 0;
}

/**
 * Ajoute un ton : fréquence qui glisse de f0 à f1 (exponentiel) pendant dur secondes à partir de t0.
 * Enveloppe : attaque linéaire de atk s, puis k ≥ 0 : décroissance exp(−k·x) × (1 − x), nulle à la fin ;
 * k < 0 : palier, relâché en −k secondes. vib, vibHz : vibrato (profondeur relative, fréquence).
 */
function tone(d, t0, dur, f0, f1, amp, atk, k, wave, vib, vibHz) {
  const n = d.length;
  let i0 = Math.round(t0 * SR);
  if (i0 < 0) i0 = 0;
  if (i0 >= n) return;
  let len = Math.round(dur * SR);
  if (i0 + len > n) len = n - i0;
  if (len < 2) return;
  const na = Math.max(1, Math.round(atk * SR));
  const gate = k < 0;
  const nr = gate ? Math.max(1, Math.round(-k * SR)) : 0;
  const kd = gate ? 1 : Math.exp(-k / len);
  const kf = Math.pow(f1 / f0, 1 / len);
  const inv = 1 / len;
  const vibStep = vib ? (TAU * vibHz) / SR : 0;
  let f = f0 / SR; // incrément de phase, en cycles par échantillon
  let ph = 0;
  let e = amp;
  for (let i = 0; i < len; i++) {
    const dt = vib ? f * (1 + vib * Math.sin(vibStep * i)) : f;
    let s;
    if (wave === SINE) s = Math.sin(TAU * ph);
    else if (wave === TRI) s = ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
    else if (wave === SQUARE) s = (ph < 0.5 ? 1 : -1) + polyBlep(ph, dt) - polyBlep(ph < 0.5 ? ph + 0.5 : ph - 0.5, dt);
    else s = 2 * ph - 1 - polyBlep(ph, dt);
    let env = i < na ? i / na : 1;
    if (gate) {
      const rem = len - i;
      env *= rem < nr ? (amp * rem) / nr : amp;
    } else {
      env *= e * (1 - i * inv);
      e *= kd;
    }
    d[i0 + i] += s * env;
    ph += dt;
    if (ph >= 1) ph -= 1;
    f *= kf;
  }
}

/**
 * Ajoute un bruit filtré (filtre à variable d'état) : coupure qui glisse de fc0 à fc1, amortissement damp
 * (petit = résonant), mode LOW / BAND / HIGH. Même enveloppe que tone.
 */
function noise(d, t0, dur, amp, atk, k, fc0, fc1, damp, mode) {
  const n = d.length;
  let i0 = Math.round(t0 * SR);
  if (i0 < 0) i0 = 0;
  if (i0 >= n) return;
  let len = Math.round(dur * SR);
  if (i0 + len > n) len = n - i0;
  if (len < 2) return;
  const na = Math.max(1, Math.round(atk * SR));
  const gate = k < 0;
  const nr = gate ? Math.max(1, Math.round(-k * SR)) : 0;
  const kd = gate ? 1 : Math.exp(-k / len);
  const inv = 1 / len;
  const top = SR / 6.5; // au-delà, ce filtre devient instable
  let f = 2 * Math.sin((Math.PI * Math.min(fc0, top)) / SR);
  const kf = Math.pow((2 * Math.sin((Math.PI * Math.min(fc1, top)) / SR)) / f, 1 / len);
  let low = 0;
  let band = 0;
  let e = amp;
  for (let i = 0; i < len; i++) {
    low += f * band;
    const high = white() - low - damp * band;
    band += f * high;
    let env = i < na ? i / na : 1;
    if (gate) {
      const rem = len - i;
      env *= rem < nr ? (amp * rem) / nr : amp;
    } else {
      env *= e * (1 - i * inv);
      e *= kd;
    }
    d[i0 + i] += (mode === LOW ? low : mode === BAND ? band : high) * env;
    f *= kf;
  }
}

/** Passe-bas à un pôle sur tout le tampon : adoucit les dents de scie et les carrés. */
function smooth(d, fc) {
  const a = 1 - Math.exp((-TAU * fc) / SR);
  let y = 0;
  for (let i = 0; i < d.length; i++) {
    y += a * (d[i] - y);
    d[i] = y;
  }
}

/** Saturation douce : le tampon est ramené à une crête de 1, poussé de g, puis écrêté en tangente hyperbolique. */
function drive(d, g) {
  let peak = 0;
  for (let i = 0; i < d.length; i++) {
    const a = d[i] < 0 ? -d[i] : d[i];
    if (a > peak) peak = a;
  }
  if (!(peak > 0)) return;
  const s = g / peak;
  for (let i = 0; i < d.length; i++) {
    const x = d[i] * s;
    d[i] = x < -3 ? -1 : x > 3 ? 1 : (x * (27 + x * x)) / (27 + 9 * x * x);
  }
}

/** Échantillonneur-bloqueur à hz : grain numérique (mort d'un robot). */
function crush(d, hz) {
  const hold = Math.max(1, Math.round(SR / hz));
  let v = 0;
  for (let i = 0; i < d.length; i++) {
    if (i % hold === 0) v = d[i];
    d[i] = v;
  }
}

/** Coupe-bas (retire le continu), fondu d'entrée et de sortie en cosinus, crête ramenée à AUDIO.peak. */
function finishBuffer(d) {
  const n = d.length;
  const r = 1 - (TAU * 12) / SR;
  let px = 0;
  let py = 0;
  for (let i = 0; i < n; i++) {
    const x = d[i];
    py = x - px + r * py;
    px = x;
    d[i] = py;
  }
  const ni = Math.min(n >> 1, Math.max(2, Math.round(AUDIO.fadeIn * SR)));
  const no = Math.min(n >> 1, Math.max(2, Math.round(AUDIO.fadeOut * SR)));
  for (let i = 0; i < ni; i++) d[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / ni);
  for (let i = 0; i < no; i++) d[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / no);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = d[i] < 0 ? -d[i] : d[i];
    if (a > peak) peak = a;
  }
  if (!(peak > 0)) return;
  const s = AUDIO.peak / peak;
  for (let i = 0; i < n; i++) d[i] *= s;
}

/** Une explosion : souffle filtré qui s'assombrit, claquement, coup de grave. Sert aux explosions et au boss. */
function blast(d, t0, dur, amp, fcTop, fcEnd, boomHz, boomEnd) {
  noise(d, t0, dur, amp, 0.002, 4.5, fcTop, fcEnd, 0.9, LOW);
  noise(d, t0, Math.min(0.06, dur), amp * 0.5, 0.0005, 3, 2600, 1400, 0.7, BAND);
  tone(d, t0, dur * 0.7, boomHz, boomEnd, amp * 0.5, 0.003, 3.5, SINE, 0, 0);
}

// Recettes : (d, T) → remplit d ; T = durée du son en secondes (AUDIO.sounds[id].dur moins le silence de fin).
const RECIPES = new Array(N).fill(null);

// --- Armes : six timbres éloignés (grave bourdonnant → aigu métallique), courts et peu chargés ---
RECIPES[SFX.BLASTER] = (d, T) => {
  // « piou » : triangle qui tombe d'une octave et demie, liseré clair, petit clic
  tone(d, 0, T, 1500, 430, 1, 0.001, 3.5, TRI, 0, 0);
  tone(d, 0, T * 0.5, 2900, 1100, 0.2, 0.001, 5, SINE, 0, 0);
  noise(d, 0, 0.012, 0.3, 0.0004, 4, 4500, 3000, 0.8, BAND);
};
RECIPES[SFX.ORBITAL] = (d, T) => {
  // lame qui tinte : partiels inharmoniques aigus, frottement très court
  tone(d, 0, T, 2637, 2637, 0.5, 0.0008, 5, SINE, 0, 0);
  tone(d, 0, T, 3951, 3951, 0.5, 0.0008, 6, SINE, 0, 0);
  tone(d, 0, T * 0.7, 5920, 5920, 0.25, 0.0008, 8, SINE, 0, 0);
  noise(d, 0, 0.03, 0.2, 0.0008, 6, 6000, 7000, 0.6, HIGH);
};
RECIPES[SFX.SHOTGUN] = (d, T) => {
  // détonation : souffle large bande qui s'assombrit, claquement, coup de grave
  noise(d, 0, T, 1, 0.001, 5, 3000, 320, 0.9, LOW);
  noise(d, 0, 0.03, 0.35, 0.0005, 3, 1900, 1400, 0.6, BAND);
  tone(d, 0, 0.12, 170, 55, 0.6, 0.002, 4, SINE, 0, 0);
};
RECIPES[SFX.EMP] = (d, T) => {
  // impulsion électrique : bourdon qui monte (audible sur les haut-parleurs d'un portable), battement, grésillement
  tone(d, 0, T, 165, 247, 0.8, 0.015, 2, TRI, 0, 0);
  tone(d, 0, T, 82, 123, 0.25, 0.02, 2, SINE, 0, 0);
  tone(d, 0, T * 0.8, 495, 740, 0.5, 0.03, 3, SINE, 0.02, 38);
  noise(d, 0, T * 0.5, 0.3, 0.005, 3, 1800, 900, 0.35, BAND);
};
RECIPES[SFX.RAIL] = (d, T) => {
  // rayon : dent de scie qui s'effondre, grésillement, corps grave, résonance qui traîne
  tone(d, 0, T * 0.6, 3600, 300, 1, 0.002, 3, SAW, 0, 0);
  noise(d, 0, T * 0.5, 0.12, 0.002, 5, 5000, 1800, 0.6, BAND);
  tone(d, 0, T, 150, 70, 0.6, 0.004, 3, TRI, 0, 0);
  tone(d, 0.02, T - 0.02, 1976, 1960, 0.3, 0.01, 3, SINE, 0.004, 31);
};
RECIPES[SFX.ROCKET] = (d, T) => {
  // départ de roquette : souffle qui monte, attaque lente, moteur
  noise(d, 0, T, 1, 0.06, 2, 320, 1500, 0.35, BAND);
  tone(d, 0, T, 100, 180, 0.3, 0.05, 2, TRI, 0, 0);
};

// --- Combat ---
RECIPES[SFX.HIT] = (d, T) => {
  noise(d, 0, T, 0.8, 0.0005, 6, 2600, 1500, 0.5, BAND);
  tone(d, 0, T * 0.7, 720, 300, 0.6, 0.001, 5, SINE, 0, 0);
};
RECIPES[SFX.SHIELD_BLOCK] = (d, T) => {
  // tôle frappée : partiels inharmoniques
  tone(d, 0, T, 620, 620, 0.5, 0.001, 4, SINE, 0, 0);
  tone(d, 0, T, 987, 987, 0.5, 0.001, 5, SINE, 0, 0);
  tone(d, 0, T * 0.8, 1434, 1434, 0.4, 0.001, 6, SINE, 0, 0);
  tone(d, 0, T * 0.6, 2105, 2105, 0.3, 0.001, 7, SINE, 0, 0);
  noise(d, 0, 0.01, 0.5, 0.0003, 4, 6000, 6000, 0.8, HIGH);
};
RECIPES[SFX.ROBOT_DEATH] = (d, T) => {
  // court-circuit : carré qui s'effondre, bruit, grain numérique
  tone(d, 0, T, 520, 70, 0.8, 0.002, 2.5, SQUARE, 0, 0);
  tone(d, 0.05, 0.05, 1250, 800, 0.3, 0.002, 3, SQUARE, 0, 0);
  noise(d, 0, T * 0.7, 0.5, 0.002, 4, 3000, 400, 0.6, LOW);
  crush(d, 7000);
};
RECIPES[SFX.EXPLOSION] = (d, T) => {
  blast(d, 0, T, 1, 3000, 120, 110, 38);
  drive(d, 1.5);
};
RECIPES[SFX.EXPLOSION_BIG] = (d, T) => {
  blast(d, 0, T, 1, 2200, 110, 85, 28);
  noise(d, 0.12, T * 0.6, 0.5, 0.05, 3, 500, 90, 0.9, LOW);
  drive(d, 2);
};
RECIPES[SFX.ENEMY_SHOT] = (d, T) => {
  // tir ennemi : plus grave et plus creux que le blaster
  tone(d, 0, T, 620, 250, 0.6, 0.004, 3, SQUARE, 0, 0);
  tone(d, 0, T, 310, 125, 0.5, 0.004, 3, SINE, 0, 0);
  smooth(d, 2400);
};
RECIPES[SFX.KAMIKAZE_BEEP] = (d, T) => {
  tone(d, 0, T, 1760, 1760, 1, 0.002, -0.012, SQUARE, 0, 0);
  tone(d, 0, T, 2640, 2640, 0.3, 0.002, -0.012, SINE, 0, 0);
  smooth(d, 5000);
};
RECIPES[SFX.HEAL] = (d, T) => {
  // carillon doux qui monte : do, mi, sol
  tone(d, 0, T, note(72), note(72), 0.6, 0.01, 3, SINE, 0, 0);
  tone(d, 0.07, T - 0.07, note(76), note(76), 0.6, 0.01, 3, SINE, 0, 0);
  tone(d, 0.14, T - 0.14, note(79), note(79), 0.6, 0.01, 3, SINE, 0, 0);
  tone(d, 0.14, T - 0.14, note(91), note(91), 0.12, 0.01, 4, SINE, 0, 0);
};
RECIPES[SFX.PLAYER_HURT] = (d, T) => {
  // coup reçu : deux dents de scie désaccordées qui tombent, choc sourd
  tone(d, 0, T, 190, 65, 1, 0.002, 3, SAW, 0, 0);
  tone(d, 0, T, 202, 69, 0.6, 0.002, 3, SAW, 0, 0);
  noise(d, 0, 0.06, 0.7, 0.0005, 4, 1800, 600, 0.8, LOW);
  smooth(d, 2600);
};
RECIPES[SFX.PLAYER_DASH] = (d, T) => {
  // souffle qui file vers l'aigu
  noise(d, 0, T, 1, 0.03, 2.5, 600, 3000, 0.3, BAND);
  noise(d, 0, T, 0.3, 0.02, 3, 1500, 5000, 0.5, BAND);
};
RECIPES[SFX.DASH_READY] = (d, T) => {
  tone(d, 0, 0.06, note(81), note(81), 0.7, 0.003, 3, SINE, 0, 0);
  tone(d, 0.06, T - 0.06, note(88), note(88), 0.7, 0.003, 3, SINE, 0, 0);
};

// --- Butin et progression ---
RECIPES[SFX.GEM] = (d, T) => {
  // tintement : la série des gemmes le rejoue un demi-ton plus haut à chaque collecte
  tone(d, 0, T, 880, 880, 0.8, 0.001, 4, SINE, 0, 0);
  tone(d, 0, T, 1760, 1760, 0.35, 0.001, 6, SINE, 0, 0);
  tone(d, 0, T * 0.5, 2640, 2640, 0.15, 0.001, 8, SINE, 0, 0);
};
RECIPES[SFX.FRAGMENT] = (d, T) => {
  // « pièce » : deux notes qui montent d'une quarte
  tone(d, 0, 0.045, note(91), note(91), 0.7, 0.001, 2, TRI, 0, 0);
  tone(d, 0.04, T - 0.04, note(96), note(96), 0.7, 0.001, 4, TRI, 0, 0);
  tone(d, 0.04, T - 0.04, note(108), note(108), 0.12, 0.001, 6, SINE, 0, 0);
};
RECIPES[SFX.LEVEL_UP] = (d, T) => {
  // arpège majeur qui monte : do, mi, sol, do
  const notes = [72, 76, 79, 84];
  for (let i = 0; i < notes.length; i++) {
    const t = i * 0.09;
    const f = note(notes[i]);
    tone(d, t, T - t, f, f, 0.5, 0.004, 3, TRI, 0, 0);
    tone(d, t, 0.22, f * 2, f * 2, 0.15, 0.002, 5, SINE, 0, 0);
  }
};
RECIPES[SFX.BONUS_PICK] = (d, T) => {
  tone(d, 0, 0.11, note(79), note(79), 0.7, 0.003, 3, TRI, 0, 0);
  tone(d, 0.08, T - 0.08, note(86), note(86), 0.7, 0.003, 3, TRI, 0, 0);
  tone(d, 0.08, T - 0.08, note(98), note(98), 0.12, 0.003, 5, SINE, 0, 0);
};

// --- Boutique ---
RECIPES[SFX.BUY] = (d, T) => {
  // « ka-ching » : tiroir, puis deux notes claires
  noise(d, 0, 0.02, 0.4, 0.0005, 4, 6000, 5000, 0.8, HIGH);
  tone(d, 0.015, 0.1, note(88), note(88), 0.6, 0.001, 4, SINE, 0, 0);
  tone(d, 0.09, T - 0.09, note(95), note(95), 0.7, 0.001, 4, SINE, 0, 0);
  tone(d, 0.09, T - 0.09, note(95) * 2.76, note(95) * 2.76, 0.12, 0.001, 7, SINE, 0, 0);
};
RECIPES[SFX.BUY_DENIED] = (d, T) => {
  // refus : deux bourdonnements graves
  tone(d, 0, 0.085, 196, 185, 1, 0.003, -0.015, SQUARE, 0, 0);
  tone(d, 0.11, T - 0.11, 156, 147, 1, 0.003, -0.03, SQUARE, 0, 0);
  smooth(d, 2400);
};
RECIPES[SFX.MERCHANT_LAND] = (d, T) => {
  // le drone descend, puis se pose
  tone(d, 0, T * 0.72, 520, 130, 0.5, 0.05, 2, TRI, 0.03, 30);
  noise(d, 0, T * 0.78, 0.6, 0.08, 2, 2500, 400, 0.4, BAND);
  tone(d, T * 0.7, T * 0.3, 120, 50, 0.9, 0.003, 3, SINE, 0, 0);
  noise(d, T * 0.7, 0.1, 0.4, 0.001, 4, 1500, 500, 0.8, LOW);
};
RECIPES[SFX.MERCHANT_LEAVE] = (d, T) => {
  tone(d, 0, T, 130, 620, 0.5, 0.08, 1.5, TRI, 0.03, 30);
  noise(d, 0, T, 0.6, 0.1, 1.5, 400, 3000, 0.4, BAND);
};

// --- Vagues ---
RECIPES[SFX.WAVE_START] = (d, T) => {
  // cor : deux notes qui montent d'une quarte, chacune doublée à la quinte
  tone(d, 0, 0.3, note(57), note(57), 0.6, 0.02, 1.5, SAW, 0, 0);
  tone(d, 0, 0.3, note(64), note(64), 0.3, 0.02, 1.5, SAW, 0, 0);
  tone(d, 0.25, T - 0.25, note(62), note(62), 0.7, 0.02, 2, SAW, 0.004, 5.5);
  tone(d, 0.25, T - 0.25, note(69), note(69), 0.35, 0.02, 2, SAW, 0.004, 5.5);
  smooth(d, 1900);
};
RECIPES[SFX.WAVE_CLEAR] = (d, T) => {
  // fanfare : sol, do, mi, puis l'accord tenu
  const notes = [67, 72, 76];
  for (let i = 0; i < notes.length; i++) {
    const f = note(notes[i]);
    tone(d, i * 0.1, 0.16, f, f, 0.6, 0.004, 2.5, TRI, 0, 0);
  }
  tone(d, 0.3, T - 0.3, note(79), note(79), 0.6, 0.004, 2.5, TRI, 0, 0);
  tone(d, 0.3, T - 0.3, note(84), note(84), 0.5, 0.004, 2.5, TRI, 0, 0);
  tone(d, 0.3, T - 0.3, note(72), note(72), 0.4, 0.004, 2.5, SINE, 0, 0);
};
RECIPES[SFX.COUNTDOWN_TICK] = (d, T) => {
  tone(d, 0, T, 660, 660, 1, 0.003, 2, SINE, 0, 0);
  tone(d, 0, T, 1320, 1320, 0.2, 0.003, 3, SINE, 0, 0);
};
RECIPES[SFX.COUNTDOWN_GO] = (d, T) => {
  tone(d, 0, T, 1320, 1320, 1, 0.003, 2, SINE, 0, 0);
  tone(d, 0, T, 1980, 1980, 0.35, 0.003, 3, SINE, 0, 0);
  tone(d, 0, T, 660, 660, 0.4, 0.003, 2, TRI, 0, 0);
};

// --- Boss ---
RECIPES[SFX.BOSS_ALARM] = (d, T) => {
  // sirène à deux tons, sur un battement grave
  const cycle = 0.4;
  const cycles = Math.max(1, Math.floor(T / cycle));
  for (let c = 0; c < cycles; c++) {
    tone(d, c * cycle, 0.2, 622, 622, 0.8, 0.012, -0.02, SAW, 0.006, 7);
    tone(d, c * cycle + 0.2, 0.2, 466, 466, 0.8, 0.012, -0.02, SAW, 0.006, 7);
    tone(d, c * cycle, 0.36, 78, 70, 0.5, 0.01, 2, SINE, 0, 0);
  }
  smooth(d, 1700);
};
RECIPES[SFX.BOSS_TELEGRAPH] = (d, T) => {
  // avertissement : trois notes pressées qui montent
  const step = T / 3;
  for (let i = 0; i < 3; i++) {
    const f = 330 * (1 + i * 0.26);
    tone(d, i * step, step * 0.88, f, f * 1.18, 0.8, 0.005, 1.5, TRI, 0, 0);
  }
  tone(d, 0, T, 110, 124, 0.35, 0.01, 1, SINE, 0, 0);
};
RECIPES[SFX.BOSS_SLAM] = (d, T) => {
  blast(d, 0, T, 1, 2600, 60, 95, 26);
  noise(d, 0, T, 0.5, 0.005, 4, 900, 60, 0.9, LOW);
  drive(d, 2);
};
RECIPES[SFX.BOSS_PHASE] = (d, T) => {
  // grondement désaccordé qui tombe, souffle qui enfle
  tone(d, 0, T, 110, 52, 0.8, 0.08, 1.5, SAW, 0, 0);
  tone(d, 0, T, 116.5, 55, 0.6, 0.08, 1.5, SAW, 0, 0);
  noise(d, 0, T * 0.85, 0.45, 0.3, 1, 300, 2500, 0.4, BAND);
  noise(d, 0, 0.12, 0.6, 0.001, 4, 1200, 300, 0.9, LOW);
  smooth(d, 1500);
};
RECIPES[SFX.BOSS_DEATH] = (d, T) => {
  // plainte qui s'effondre, chapelet d'explosions, coup final
  tone(d, 0, T * 0.8, 300, 40, 0.45, 0.02, 1.5, SAW, 0.01, 9);
  smooth(d, 1400);
  blast(d, 0, 0.4, 0.7, 2800, 200, 120, 50);
  blast(d, T * 0.17, 0.4, 0.75, 2600, 180, 110, 45);
  blast(d, T * 0.32, 0.4, 0.8, 2400, 160, 100, 40);
  blast(d, T * 0.45, 0.35, 0.85, 2400, 150, 95, 38);
  blast(d, T * 0.56, T * 0.44, 1.2, 2200, 60, 80, 26);
  drive(d, 1.6);
};

// --- Interface ---
RECIPES[SFX.UI_CLICK] = (d, T) => {
  tone(d, 0, T, 1100, 900, 1, 0.001, 4, SINE, 0, 0);
  noise(d, 0, 0.006, 0.3, 0.0003, 3, 5000, 5000, 0.8, HIGH);
};
RECIPES[SFX.GAME_OVER] = (d, T) => {
  // phrase mineure qui descend : mi, do, la, mi grave tenu
  const notes = [76, 72, 69, 64];
  const step = T * 0.17;
  for (let i = 0; i < notes.length; i++) {
    const f = note(notes[i]);
    const last = i === notes.length - 1;
    const t = i * step;
    tone(d, t, last ? T - t : step * 1.6, f, f, 0.6, 0.006, last ? 2 : 2.5, TRI, last ? 0.006 : 0, 5);
    tone(d, t, last ? T - t : step * 1.6, f / 2, f / 2, 0.3, 0.006, 2, SINE, 0, 0);
  }
};
RECIPES[SFX.NEW_BEST] = (d, T) => {
  // arpège majeur rapide sur deux octaves, puis l'accord tenu
  const notes = [72, 76, 79, 84, 88, 91];
  for (let i = 0; i < notes.length; i++) {
    const f = note(notes[i]);
    tone(d, i * 0.07, 0.2, f, f, 0.55, 0.003, 3, TRI, 0, 0);
  }
  const t = notes.length * 0.07;
  tone(d, t, T - t, note(84), note(84), 0.5, 0.004, 2, TRI, 0.004, 6);
  tone(d, t, T - t, note(88), note(88), 0.4, 0.004, 2, TRI, 0.004, 6);
  tone(d, t, T - t, note(91), note(91), 0.4, 0.004, 2, TRI, 0.004, 6);
  tone(d, t, T - t, note(96), note(96), 0.15, 0.004, 3, SINE, 0, 0);
};

// --- Boss (ajout de l'intégration des sons) ---
RECIPES[SFX.BOSS_STEP] = (d, T) => {
  // pas lourd : choc grave étouffé, tôle qui grince un instant (repli du fichier « Rusty Robot Steps »)
  tone(d, 0, T, 72, 38, 1, 0.002, 4, SINE, 0, 0);
  noise(d, 0, T * 0.6, 0.8, 0.001, 5, 900, 120, 0.9, LOW);
  tone(d, 0.01, T * 0.45, 410, 360, 0.18, 0.01, 3, SAW, 0.01, 23);
  smooth(d, 1800);
};

// --- Vagues (étape 1 du plan addictif, § E1.A) ---
RECIPES[SFX.PURGE] = (d, T) => {
  // purge de fin de vague (repli du fichier « Champ EMP » en découpe longue) : bourdon électrique qui monte puis
  // s'éteint, balayage aigu, grésillement
  tone(d, 0, T, 110, 330, 0.8, 0.02, 1.6, TRI, 0, 0);
  tone(d, 0, T * 0.9, 440, 1320, 0.35, 0.04, 2.2, SINE, 0.02, 30);
  noise(d, 0, T * 0.7, 0.3, 0.01, 2.5, 2400, 700, 0.4, BAND);
};

// --- Révisions des robots (étape 1 du plan addictif, § E1.B) ---
RECIPES[SFX.ALERT] = (d, T) => {
  // alerte d'une mise à jour (repli du fichier « Alarme d'arrivée » en découpe courte) : deux bips descendants
  tone(d, 0, T * 0.42, 880, 660, 0.7, 0.01, 1.4, SQUARE, 0, 0);
  tone(d, T * 0.48, T * 0.42, 880, 660, 0.7, 0.01, 1.4, SQUARE, 0, 0);
  noise(d, 0, T * 0.9, 0.12, 0.01, 2.0, 3000, 1200, 0.3, BAND);
};

// --- Mutations du boss (étape 1 du plan addictif, § E1.D) ---
RECIPES[SFX.BOSS_LASER] = (d, T) => {
  // rayon du balayage laser (repli du fichier « Fusil à rail ») : décharge, puis faisceau tenu qui grésille et retombe
  noise(d, 0, 0.12, 0.7, 0.001, 4, 5200, 900, 0.5, BAND);
  tone(d, 0, T, 196, 147, 0.6, 0.03, 1.2, SAW, 0.02, 37);
  tone(d, 0, T, 588, 441, 0.3, 0.05, 1.4, SQUARE, 0.01, 53);
  noise(d, 0.05, T - 0.05, 0.22, 0.05, 1.3, 3800, 1600, 0.35, BAND);
  smooth(d, 5200);
};

// --- Étape 2 du plan addictif, chantier A (§ E2.A) : replis synthétisés des découpes de la banque de Femz ---
RECIPES[SFX.RICOCHET] = (d, T) => {
  // ricochet (repli de « blaster.wav » + 5 demi-tons) : coup bref et aigu, petite queue qui « ping »
  tone(d, 0, T * 0.5, 1480, 620, 0.8, 0.001, 3, SQUARE, 0, 0);
  tone(d, 0.02, T - 0.02, 2100, 1900, 0.3, 0.002, 4, SINE, 0, 0);
  noise(d, 0, 0.03, 0.4, 0.001, 5, 5200, 1500, 0.5, BAND);
};
RECIPES[SFX.BLADE] = (d, T) => {
  // lame de phase (repli du sifflement de « Dash.wav ») : souffle qui balaie de l'aigu au grave
  noise(d, 0, T, 0.8, 0.02, 2.2, 5200, 900, 0.45, BAND);
  tone(d, 0, T * 0.7, 900, 300, 0.25, 0.01, 2.5, SINE, 0, 0);
};
RECIPES[SFX.TURRET_DEPLOY] = (d, T) => {
  // pose d'une sentinelle (repli de « Marchand qui se pose.wav » + 7 demi-tons) : choc mat puis deux bips d'armement
  tone(d, 0, T * 0.4, 160, 70, 0.9, 0.002, 4, SINE, 0, 0);
  noise(d, 0, T * 0.3, 0.4, 0.001, 5, 1800, 300, 0.7, LOW);
  tone(d, T * 0.45, T * 0.2, note(88), note(88), 0.4, 0.004, 3, TRI, 0, 0);
  tone(d, T * 0.7, T * 0.25, note(93), note(93), 0.4, 0.004, 3, TRI, 0, 0);
};
RECIPES[SFX.TURRET_SHOT] = (d, T) => {
  // tir d'une sentinelle (repli de « blaster.wav » − 5 demi-tons) : coup court et plus grave que le blaster
  tone(d, 0, T, 620, 210, 0.8, 0.001, 3.5, SQUARE, 0, 0);
  noise(d, 0, 0.025, 0.35, 0.001, 5, 3200, 900, 0.5, BAND);
};

// Plan addictif, étape 2, chantier C (§ E2.C) — recettes de REPLI des sons des coffres (jouées seulement si le fichier
// de Femz manque) : la recette synthétisée du son de sa banque dont le fichier est une découpe (§ E2.0.7), TRANSPOSÉE
// comme le fichier (outils/preparer_sons.py, option demi_tons). Fusion de la phase 1 (§ E2.I) : le chantier C avait
// posé la recette d'origine telle quelle ; deux replis étaient alors le même son (CHEST_DROP et RARITY_2, ROULETTE_TICK
// et RARITY_0…) et le contrôle « les sons diffèrent deux à deux » du lot audio tombait. Les trois sons dont le fichier
// est une découpe NON transposée (CHEST_OPEN, ROULETTE_TICK, RARITY_0) ont un repli décalé de quelques demi-tons, pour
// rester distincts du son d'origine ; leurs FICHIERS ne changent pas.
/**
 * Repli d'une découpe transposée : la recette `base` jouée `demiTons` demi-tons plus haut (plus bas si négatif), par
 * rééchantillonnage linéaire — plus aigu ET plus court, comme une bande accélérée. Hors combat : un tampon temporaire
 * par son, à la création de l'audio (buildBuffer).
 */
function transposee(base, demiTons) {
  const k = Math.pow(2, demiTons / 12);
  return (d, T) => {
    const n = d.length;
    const src = new Float32Array(Math.max(2, Math.ceil(n * k) + 1));
    base(src, src.length / SR);
    const last = src.length - 1;
    for (let i = 0; i < n; i++) {
      const p = i * k;
      const j = Math.floor(p);
      d[i] = j < last ? src[j] + (src[j + 1] - src[j]) * (p - j) : 0;
    }
  };
}
RECIPES[SFX.CHEST_DROP] = transposee(RECIPES[SFX.FRAGMENT], -7); // « Fragment.wav », − 7 demi-tons
RECIPES[SFX.CHEST_OPEN] = transposee(RECIPES[SFX.MERCHANT_LEAVE], -3); // « Marchand qui repart.wav » (fichier non transposé)
RECIPES[SFX.ROULETTE_TICK] = transposee(RECIPES[SFX.UI_CLICK], 5); // « Clic.wav » (fichier non transposé) : un tic plus aigu que le clic
RECIPES[SFX.RARITY_0] = transposee(RECIPES[SFX.UI_CLICK], -4); // « Clic.wav » (fichier non transposé) : le bas de l'échelle des raretés
RECIPES[SFX.RARITY_1] = transposee(RECIPES[SFX.GEM], 2); // « Gemme.wav », + 2 demi-tons
RECIPES[SFX.RARITY_2] = transposee(RECIPES[SFX.FRAGMENT], 4); // « Fragment.wav », + 4
RECIPES[SFX.RARITY_3] = transposee(RECIPES[SFX.BONUS_PICK], 6); // « Choix d'un bonus.wav », + 6
RECIPES[SFX.RARITY_4] = transposee(RECIPES[SFX.LEVEL_UP], 8); // « Passage de niveau.wav », + 8
RECIPES[SFX.RARITY_5] = transposee(RECIPES[SFX.NEW_BEST], 10); // « Nouveau record.wav », + 10
RECIPES[SFX.CHEST_PICK] = transposee(RECIPES[SFX.BUY], 3); // « Achat.wav », + 3

// --- Agents, relance et bannissement (étape 2 du plan addictif, § E2.D) : replis des découpes de la banque de Femz ---
RECIPES[SFX.AGENT_SELECT] = (d, T) => {
  // agent choisi (repli de « Choix d'un bonus », 3 demi-tons plus bas) : deux notes claires qui montent, tenues
  tone(d, 0, 0.12, note(76), note(76), 0.7, 0.003, 3, TRI, 0, 0);
  tone(d, 0.09, T - 0.09, note(83), note(83), 0.7, 0.003, 2.5, TRI, 0, 0);
  tone(d, 0.09, T - 0.09, note(95), note(95), 0.12, 0.003, 4, SINE, 0, 0);
};
RECIPES[SFX.REROLL] = (d, T) => {
  // relance (repli de « Dash rechargé », découpe courte) : balayage montant bref, comme des cartes qu'on rebat
  tone(d, 0, T, 520, 1040, 0.6, 0.004, 3, TRI, 0, 0);
  noise(d, 0, T * 0.6, 0.25, 0.002, 4, 2600, 5200, 0.5, BAND);
};
RECIPES[SFX.BANISH] = (d, T) => {
  // bannissement (repli de « Achat refusé », 3 demi-tons plus haut) : deux bourdonnements secs
  tone(d, 0, 0.085, 233, 220, 1, 0.003, -0.015, SQUARE, 0, 0);
  tone(d, 0.11, T - 0.11, 185, 175, 1, 0.003, -0.03, SQUARE, 0, 0);
  smooth(d, 2400);
};

// --- Étape 2 du plan addictif, chantier B (§ E2.B) : replis synthétisés des découpes de la banque de Femz ---
RECIPES[SFX.POOL_THROW] = (d, T) => {
  // lancer de flacons (repli de « roquettes.wav » − 6 demi-tons) : souffle grave qui retombe, petit « gloup » à la fin
  noise(d, 0, T * 0.7, 0.7, 0.004, 3, 900, 220, 0.6, LOW);
  tone(d, 0, T * 0.5, 210, 90, 0.7, 0.003, 3, SINE, 0, 0);
  tone(d, T * 0.55, T * 0.3, 320, 520, 0.3, 0.004, 4, SINE, 0, 0);
};
RECIPES[SFX.BOOMERANG] = (d, T) => {
  // lancer d'un boomerang (repli d'un passage de « Disques orbitaux 1.wav » − 4 demi-tons) : sifflement qui tournoie
  noise(d, 0, T, 0.55, 0.01, 2.2, 1500, 3400, 0.4, BAND);
  tone(d, 0, T, 380, 560, 0.35, 0.008, 2.5, TRI, 0, 0);
  tone(d, 0, T * 0.6, 760, 1010, 0.15, 0.008, 3, SINE, 0, 0);
};
RECIPES[SFX.MINE_DROP] = (d, T) => {
  // pose d'une mine (repli du début de « Bip du kamikaze.wav ») : cliquetis mat puis un bip court
  noise(d, 0, 0.03, 0.5, 0.001, 5, 1400, 500, 0.6, LOW);
  tone(d, 0.05, T - 0.05, note(84), note(84), 0.55, 0.003, 3.5, SQUARE, 0, 0);
};

// --- Objets passifs (étape 2 du plan addictif, § E2.F) : replis des découpes TRANSPOSÉES de la banque de Femz (joués
// seulement si le fichier manque) — la recette du son d'origine, transposée comme le fichier (§ E2.0.7).
RECIPES[SFX.ITEM_TESLA] = transposee(RECIPES[SFX.EMP], 7); // « Champ EMP.wav », + 7 demi-tons : l'éclair en chaîne
RECIPES[SFX.ITEM_BOOM] = transposee(RECIPES[SFX.EXPLOSION], 5); // « Explosion.wav », + 5 : explosion d'un critique, ondes
RECIPES[SFX.ITEM_PROC] = transposee(RECIPES[SFX.HIT], 7); // « Impact sur un robot.wav », + 7 : éclats, drone, dash
RECIPES[SFX.ITEM_SHIELD] = transposee(RECIPES[SFX.SHIELD_BLOCK], -5); // « Coup arrêté par le bouclier du blindé.wav », − 5
RECIPES[SFX.ITEM_GET] = transposee(RECIPES[SFX.BONUS_PICK], 9); // « Choix d'un bonus.wav », + 9 (+ 5 se confondait avec RARITY_3, § E2.J) : objet obtenu
// § E3.D (repli synthétisé des sons des quatre robots : le jeu joue la découpe de sa banque quand elle est là)
RECIPES[SFX.DRILL] = transposee(RECIPES[SFX.EMP], -9); // correctif de l'étape 3 (§ E3.Z) : « Champ EMP.wav », − 9 — bourdonnement de foreuse (avant : l'annonce d'attaque au sol du boss)
RECIPES[SFX.MINE_ENEMY] = transposee(RECIPES[SFX.KAMIKAZE_BEEP], -4); // « Bip du kamikaze.wav », − 4 : mine posée
RECIPES[SFX.SCAN_LASER] = transposee(RECIPES[SFX.BOSS_LASER], -7); // « Fusil à rail.wav », − 7 : balayage du scanner
RECIPES[SFX.SPLIT] = transposee(RECIPES[SFX.ROBOT_DEATH], 6); // « Mort.wav », + 6 : scission du diviseur
// Étape 3, chantier K (§ E3.K) : « N PROGRAMMES PERSISTENT » — repli = la recette du changement de phase du boss, dont
// le fichier (« Changement de phase.wav ») est la découpe.
// correctif de l'étape 3 (§ E3.Z) : découpe + 6 demi-tons (elle était la copie exacte de l'alerte du boss)
RECIPES[SFX.CARRYOVER] = transposee(RECIPES[SFX.BOSS_PHASE], 6);
// Fusion du groupe 1 de l'étape 3 : replis des sons de A, C et N, qui n'en avaient pas (ils retombaient tous sur le
// clic d'interface : 14 sons identiques quand leur fichier manque). Même règle que plus haut : la recette du son dont le
// fichier est la source de la découpe (assets/sfx/manifeste.json), transposée comme la découpe.
RECIPES[SFX.ELITE_MOD] = transposee(RECIPES[SFX.ALERT], 5); // « Alarme d'arrivée.wav », + 5 (§ E3.A)
RECIPES[SFX.JACKPOT] = transposee(RECIPES[SFX.NEW_BEST], 2); // « Nouveau record.wav », + 2
RECIPES[SFX.FRAG_RAIN] = transposee(RECIPES[SFX.FRAGMENT], 7); // « Fragment.wav », + 7
RECIPES[SFX.PROP_BREAK] = transposee(RECIPES[SFX.BOSS_DEATH], -3); // « Mort.wav », − 3 (§ E3.C)
RECIPES[SFX.UTIL_PICK] = transposee(RECIPES[SFX.GEM], -2); // « Gemme.wav », − 2
RECIPES[SFX.UTIL_IEM] = transposee(RECIPES[SFX.EMP], -5); // « Champ EMP.wav », − 5
RECIPES[SFX.UTIL_STUN] = transposee(RECIPES[SFX.SHIELD_BLOCK], 2); // « Coup arrêté par le bouclier du blindé.wav », + 2
RECIPES[SFX.UTIL_TURBO] = transposee(RECIPES[SFX.DASH_READY], -4); // « Dash rechargé.wav », − 4
RECIPES[SFX.KATANA] = transposee(RECIPES[SFX.PLAYER_DASH], -5); // « Dash.wav », − 5 (§ E3.N)
RECIPES[SFX.GRENADE] = transposee(RECIPES[SFX.EXPLOSION], 2); // « Explosion.wav », + 2
RECIPES[SFX.SMOKE] = transposee(RECIPES[SFX.HEAL], -8); // « Soin du réparateur.wav », − 8
RECIPES[SFX.FLASH] = transposee(RECIPES[SFX.PLAYER_DASH], 5); // « Dash.wav », + 5
RECIPES[SFX.CANNON] = transposee(RECIPES[SFX.EXPLOSION_BIG], 3); // « Grosse explosion.wav », + 3
// « Frappe au sol.wav » sans transposition dans le manifeste : le repli serait BOSS_SLAM à l'identique ; − 3 demi-tons
// le rend distinct (seul écart à la règle, sur le repli seulement — le fichier joué reste la découpe de Femz)
RECIPES[SFX.HAMMER] = transposee(RECIPES[SFX.BOSS_SLAM], -5); // correctif de l'étape 3 (§ E3.Z) : fichier ET repli − 5
// Étape 3, chantier B (§ E3.B) : l'arme évolue — repli = le passage de niveau, + 4 (« Passage de niveau.wav », la découpe)
RECIPES[SFX.EVOLVE] = transposee(RECIPES[SFX.LEVEL_UP], 4);
// Étape 3, chantier F (§ E3.F) : moment de fusion — « Nouveau record.wav », − 2 (repli : sa recette transposée)
RECIPES[SFX.FUSION] = transposee(RECIPES[SFX.NEW_BEST], -2);
RECIPES[SFX.CD_READY] = transposee(RECIPES[SFX.DASH_READY], 5); // « Dash rechargé.wav », + 5 (§ E3.H)
RECIPES[SFX.CD_FIRE] = transposee(RECIPES[SFX.EXPLOSION_BIG], 5); // « Grosse explosion.wav », + 5 (§ E3.H)
// § E3.M (16/11) : replis des gestes du Shinobi et du Bastion (le fichier joué reste la découpe de la banque de Femz)
RECIPES[SFX.SLASH_LIGHT] = transposee(RECIPES[SFX.PLAYER_DASH], 7); // « Dash.wav », + 7
RECIPES[SFX.SLASH_HEAVY] = transposee(RECIPES[SFX.PLAYER_DASH], -3); // « Dash.wav », − 3
RECIPES[SFX.IAIDO] = transposee(RECIPES[SFX.RAIL], 4); // « Fusil à rail.wav », + 4
// TURRET_PLANT : la découpe est « Frappe au sol.wav » + 5, mais son repli à + 5 était le jumeau de celui de GRENADE
// (recouvrement 0,988, seuil 0,97 — audio.test, fusion du groupe 2) : + 10 sur le REPLI seulement (règle de HAMMER)
RECIPES[SFX.TURRET_PLANT] = transposee(RECIPES[SFX.BOSS_SLAM], 10); // « Frappe au sol.wav » (repli + 10, fichier + 5)
// fusion du groupe 2 : UI_OPEN (chantier I, contrat § E3.0.7) — « Clic.wav », − 3 (repli : la recette du clic transposée)
RECIPES[SFX.UI_OPEN] = transposee(RECIPES[SFX.UI_CLICK], -3);
// correctif de l'étape 3 (§ E3.Z.12) : champ de force de la sentinelle — « Champ EMP.wav », + 3
RECIPES[SFX.FIELD] = transposee(RECIPES[SFX.EMP], 3); // + 3 (+ 7 était le jumeau de ITEM_TESLA : 0,997)
// étape 4, chantier A (§ E4.0.3) : succès réussi — « Nouveau record.wav », + 5 (repli : sa recette transposée)
RECIPES[SFX.SUCCES] = transposee(RECIPES[SFX.NEW_BEST], 5);
// étape 4, chantier B (§ E4.0.3) : déblocage acheté dans le hub — « Achat.wav », − 4 (repli : la recette de l'achat transposée)
RECIPES[SFX.UNLOCK] = transposee(RECIPES[SFX.BUY], -4);
// étape 4, chantier F (§ E4.F.5) : un reporté rentre dans le champ — « Changement de phase.wav », − 3 (repli : la recette de
// CARRYOVER, qui est + 6, transposée de − 9)
RECIPES[SFX.REVEIL] = transposee(RECIPES[SFX.CARRYOVER], -9);
RECIPES[SFX.COUP_PIED] = transposee(RECIPES[SFX.HIT], -7); // § E4.J.4 : « Impact sur un robot.wav » − 7 (repli synthétisé)
RECIPES[SFX.GROS_BUTIN] = transposee(RECIPES[SFX.GEM], -5); // § E4.K.3 : « Gemme.wav » − 5 (repli synthétisé)
RECIPES[SFX.SAUVE_CHUTE] = transposee(RECIPES[SFX.HEAL], 3); // § E4.Q.3 : « Soin du réparateur.wav » + 3 (repli synthétisé)
RECIPES[SFX.SAUVE_PRISE] = transposee(RECIPES[SFX.LEVEL_UP], 3); // § E4.Q.3 : « Passage de niveau.wav » + 3 (repli synthétisé)
// § E5.G : replis des pas des agents et des coups (les fichiers joués sont les découpes OCULAR et les coups de Femz)
RECIPES[SFX.PAS_BASTION] = transposee(RECIPES[SFX.BOSS_STEP], 4); // pas lourd : celui du boss, plus haut
RECIPES[SFX.PAS_ECLAIREUR] = transposee(RECIPES[SFX.BOSS_STEP], 9);
RECIPES[SFX.PAS_SHINOBI] = transposee(RECIPES[SFX.BOSS_STEP], 15); // le plus léger
RECIPES[SFX.COUP_LAME] = transposee(RECIPES[SFX.SHIELD_BLOCK], 9); // lame qui entre : tôle aiguë
RECIPES[SFX.COUP_SABRE] = transposee(RECIPES[SFX.SHIELD_BLOCK], -2);
RECIPES[SFX.COUP_MARTEAU] = transposee(RECIPES[SFX.BOSS_STEP], -5); // (EXPLOSION_BIG − 4 était le jumeau du repli de HAMMER : 0,989)
RECIPES[SFX.PUNCH] = transposee(RECIPES[SFX.HIT], -12); // coup de poing : l'impact, une octave plus bas
RECIPES[SFX.INVITE] = transposee(RECIPES[SFX.UI_CLICK], -8); // invite « E » : le clic d'interface (repli − 8 : à + 4, comme le fichier, il serait le jumeau du repli de ROULETTE_TICK, + 5)
// § E5.Q (B13) : replis des sons d'annonce par attaque — la recette du son de la banque dont le fichier est la découpe,
// transposée comme lui (outils/preparer_sons.py)
RECIPES[SFX.BOSS_ANNONCE_RUEE] = transposee(RECIPES[SFX.PLAYER_DASH], -7); // « Dash.wav », − 7 : le souffle de la ruée
RECIPES[SFX.BOSS_ANNONCE_OBUS] = transposee(RECIPES[SFX.ENEMY_SHOT], -10); // « Tir d'un tireur.wav », − 10 : départ grave des obus
RECIPES[SFX.BOSS_ANNONCE_INVOCATION] = transposee(RECIPES[SFX.WAVE_START], -3); // « Début de vague.wav », − 3 : des robots arrivent
RECIPES[SFX.BOSS_ANNONCE_BALAYAGE] = transposee(RECIPES[SFX.BOSS_LASER], -3); // « Fusil à rail.wav », − 3 : le laser se charge
RECIPES[SFX.TIREUR_VISEE] = transposee(RECIPES[SFX.BOSS_LASER], 7); // « Fusil à rail.wav », + 7 : courte charge aiguë
// Décisions de Femz (21/11) : fichiers hors de la banque « sfx game » — replis = un son proche de la banque, décalé
RECIPES[SFX.ANNONCE_OBUS_ROBOT] = transposee(RECIPES[SFX.ENEMY_SHOT], -4); // un coup de fusil sci-fi : le tir du tireur, plus grave
RECIPES[SFX.ANNONCE_SOL] = transposee(RECIPES[SFX.KAMIKAZE_BEEP], 5); // § E5.Q ter : replis (fichiers choisis par Femz)
RECIPES[SFX.TERMINAL] = transposee(RECIPES[SFX.MERCHANT_LAND], 5);
RECIPES[SFX.RAVITAILLEMENT] = transposee(RECIPES[SFX.LEVEL_UP], -5);
RECIPES[SFX.PANNE] = transposee(RECIPES[SFX.BOSS_PHASE], -5);
RECIPES[SFX.ANNEAU] = transposee(RECIPES[SFX.PURGE], -7);
RECIPES[SFX.CLIC_DEPLACEMENT] = transposee(RECIPES[SFX.HIT], 9);
RECIPES[SFX.ESSAIM] = transposee(RECIPES[SFX.PLAYER_DASH], -10);
RECIPES[SFX.ECLAT_PROJECTION] = transposee(RECIPES[SFX.SHIELD_BLOCK], 5); // objet Éclats : verre touché par des balles
RECIPES[SFX.ECLAT_IMPACT] = transposee(RECIPES[SFX.HIT], -15); // objet Éclats : coup sourd métallique, grave
RECIPES[SFX.SOIN_HEROS] = transposee(RECIPES[SFX.FRAGMENT], 7); // accent « bonus » de jeu vidéo : le fragment, plus aigu (BONUS_PICK + 9 était le jumeau du repli d'ITEM_GET)

for (let i = 0; i < N; i++) if (RECIPES[i] === null) RECIPES[i] = RECIPES[SFX.UI_CLICK]; // socle E2 : repli d'un son dont la recette n'est pas encore écrite
/**
 * Synthétise le tampon du son id dans le contexte c. Le tampon dure AUDIO.sounds[id].dur ; sa fin est un silence
 * de AUDIO.tailSilence secondes à la vitesse de lecture la plus haute du son (voir l'en-tête : compresseur de Firefox).
 */
function buildBuffer(c, id) {
  const length = Math.max(64, Math.round(AUDIO.sounds[id].dur * SR));
  const topRate = id === SFX.GEM ? gemRate[GEM_MAX] : Math.exp(cfgPitch[id] * SEMITONE);
  const pad = Math.min(length >> 1, Math.ceil(AUDIO.tailSilence * topRate * SR));
  const buffer = c.createBuffer(1, length, SR);
  const body = buffer.getChannelData(0).subarray(0, length - pad); // la fin du tampon reste à zéro
  rng[NOISE] = (0x9e3779b9 + id * 7919) | 0;
  RECIPES[id](body, body.length / SR);
  finishBuffer(body);
  bufferSeconds[id] = length / SR;
  return buffer;
}

/**
 * Crée TOUT l'audio, une seule fois : contexte, gain général, compresseur, 24 voix, les tampons synthétisés des sons
 * qui n'ont pas (encore) leurs fichiers, l'amorce, et la nappe si elle est déjà décodée.
 */
function createAudio() {
  const Ctor = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : undefined;
  if (typeof Ctor !== 'function') {
    failed = true;
    return;
  }
  let c = null;
  try {
    const t0 = performance.now();
    c = new Ctor();
    contexts++;
    SR = Math.min(c.sampleRate, AUDIO.maxBufferRate);
    const m = c.createGain();
    m.gain.value = masterVolume * AUDIO.busGain;
    const k = c.createDynamicsCompressor();
    k.threshold.value = AUDIO.compressor.threshold;
    k.knee.value = AUDIO.compressor.knee;
    k.ratio.value = AUDIO.compressor.ratio;
    k.attack.value = AUDIO.settleAttack; // attaque longue tant qu'il se pose (voir l'en-tête) ; update la rétablit
    k.release.value = AUDIO.compressor.release;
    m.connect(k);
    k.connect(c.destination);
    const sb = c.createGain(); // volume des effets sonores (réglages), entre les voix et le gain général
    sb.gain.value = sfxVolume;
    sb.connect(m);
    sfxBus = sb;
    for (let i = 0; i < V; i++) {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(sb);
      voiceGains[i] = g;
    }
    const t1 = performance.now();
    for (let id = 0; id < N; id++) if (useFile[id] === 0) buffers[id] = buildBuffer(c, id);
    synthMs = performance.now() - t1;
    // Amorce : un signal inaudible traverse le compresseur dès la création, pour que son détecteur se pose pendant
    // que son attaque est longue (voir l'en-tête). Seul nœud source créé hors de play, une fois pour toutes ; il ne
    // passe par aucune voix.
    const primerBuffer = c.createBuffer(1, Math.max(256, Math.round(AUDIO.settle * 1.5 * SR)), SR);
    const pd = primerBuffer.getChannelData(0);
    for (let i = 0; i < pd.length; i++) pd[i] = i & 1 ? AUDIO.primerLevel : -AUDIO.primerLevel;
    const primer = c.createBufferSource();
    primer.buffer = primerBuffer;
    primer.connect(k);
    primer.start();
    settling = true;
    master = m;
    compressor = k;
    ac = c;
    buildMs = performance.now() - t0;
    startMusique();
  } catch (e) {
    // Navigateur sans Web Audio utilisable : le jeu continue sans son, sans jamais réessayer.
    failed = true;
    settling = false;
    ac = null;
    master = null;
    sfxBus = null;
    musiqueBus = null;
    compressor = null;
    if (c !== null && typeof c.close === 'function') {
      try {
        const p = c.close();
        if (p && typeof p.catch === 'function') p.catch(noop);
      } catch (e2) {
        /* rien */
      }
    }
  }
}

// =====================================================================================================================
// Fichiers : téléchargés et décodés dès init(), hors de tout AudioContext. Aucune promesse laissée sans rejet traité.
// =====================================================================================================================

/** Décode un fichier dans le contexte hors ligne (forme à rappels : le rejet de la promesse est toujours traité). */
function decodeFile(bytes) {
  return new Promise((resolve, reject) => {
    const p = decoder.decodeAudioData(bytes, resolve, reject);
    if (p && typeof p.catch === 'function') p.catch(noop);
  });
}

function loadFile(url) {
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(url + ' : ' + r.status);
      return r.arrayBuffer();
    })
    .then(decodeFile);
}

/** Toutes les variantes du son id sont arrivées (ou ont échoué) : il passe à ses fichiers s'il en a au moins un. */
function settleFiles(id, list) {
  let n = 0;
  for (let k = 0; k < list.length; k++) if (list[k] !== null) n++;
  if (n === 0) {
    fileState[id] = FILE_FAILED;
    // Le contexte existe déjà et ce son comptait sur ses fichiers : son tampon synthétisé est fait maintenant.
    if (ac !== null && buffers[id] === null) buffers[id] = buildBuffer(ac, id);
    return;
  }
  const bufs = new Array(n);
  const secs = new Float64Array(n);
  let j = 0;
  for (let k = 0; k < list.length; k++) {
    if (list[k] === null) continue;
    bufs[j] = list[k];
    secs[j] = list[k].duration;
    j++;
  }
  fileBuffers[id] = bufs;
  fileSeconds[id] = secs;
  fileState[id] = FILE_READY;
  useFile[id] = 1;
}

function loadSound(id, entry) {
  const names = entry.fichiers;
  const list = new Array(names.length).fill(null);
  let pending = names.length;
  fileGain[id] = entry.gain;
  fileLead[id] = entry.lead > 0 ? entry.lead : 0;
  fileState[id] = FILE_LOADING;
  filesExpected += names.length;
  for (let k = 0; k < names.length; k++) {
    loadFile(FILES.sfxDir + names[k].fichier)
      .then(
        (b) => {
          list[k] = b;
          filesDecoded++;
        },
        () => {
          filesFailed++;
        },
      )
      .then(() => {
        pending--;
        if (pending === 0) settleFiles(id, list);
        if (filesDecoded + filesFailed === filesExpected) loadMs[1] = performance.now();
      });
  }
}

function readManifest(man) {
  if (man === null || typeof man !== 'object' || man.sons === null || typeof man.sons !== 'object') {
    manifestState = MAN_FAILED;
    return;
  }
  manifestState = MAN_OK;
  for (const name of Object.keys(man.sons)) {
    const id = ID_BY_NAME[name];
    const entry = man.sons[name];
    if (id === undefined || entry === null || typeof entry !== 'object') continue;
    if (!Array.isArray(entry.fichiers) || entry.fichiers.length === 0 || !(entry.gain > 0) || entry.gain > 4) continue;
    loadSound(id, entry);
  }
}

/** Une fois, à init() : manifeste, puis chaque fichier, décodé dès qu'il arrive. */
function startLoading() {
  if (manifestState !== MAN_NONE) return;
  const Off = typeof window !== 'undefined' ? window.OfflineAudioContext || window.webkitOfflineAudioContext : undefined;
  if (typeof fetch !== 'function' || typeof Off !== 'function') {
    manifestState = MAN_FAILED;
    return;
  }
  try {
    decoder = new Off(2, 1, FILES.decodeRate);
  } catch (e) {
    manifestState = MAN_FAILED;
    return;
  }
  manifestState = MAN_LOADING;
  loadMs[0] = performance.now();
  fetch(FILES.manifest)
    .then((r) => (r.ok ? r.json() : null))
    .then(readManifest, () => {
      manifestState = MAN_FAILED;
    });
}

/**
 * Musique : gains de niveau et de premier plan, deux lecteurs par piste, créés UNE fois avec le contexte. Puis la piste
 * déjà demandée (setMusique avant le premier geste) démarre.
 */
function startMusique() {
  if (ac === null || ambianceGain !== null || MUS_LECTEURS === 0) return;
  try {
    const mb = ac.createGain(); // volume de la musique (réglages)
    mb.gain.value = musiqueVolume;
    mb.connect(master);
    musiqueBus = mb;
    const f = ac.createGain();
    f.gain.value = premierPlan;
    f.connect(mb);
    const g = ac.createGain();
    g.gain.value = 0;
    g.connect(f);
    for (let i = 0; i < MUS_LECTEURS; i++) {
      const el = new Audio();
      el.preload = 'metadata';
      el.src = MUS.dir + MUS.pistes[MUS_NOMS[i >> 1]];
      const gl = ac.createGain();
      gl.gain.value = 0;
      ac.createMediaElementSource(el).connect(gl);
      gl.connect(g);
      musEl[i] = el;
      musGain[i] = gl;
    }
    g.gain.setTargetAtTime(ambianceLevel[0], ac.currentTime, AUDIO.ambiance.fadeIn / 3);
    focusGain = f;
    ambianceGain = g;
    ambianceState = AMB_PLAYING;
    if (musPiste >= 0) lancerPiste(musPiste, MUS.fondu);
  } catch (e) {
    ambianceState = AMB_FAILED;
  }
}

/** Le gain g va vers v en d secondes, depuis sa valeur du moment (aucune marche). */
function rampe(g, v, d) {
  const t = ac.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(v, t + d);
}

/** Le lecteur i s'éteint en d secondes ; update le met en pause une fois éteint. */
function eteindre(i, d) {
  if (i < 0 || musActif[i] === 0) return;
  rampe(musGain[i].gain, 0, d);
  musFin[i] = ac.currentTime + d + 0.05;
}

/** La piste p démarre (au début) sur un de ses deux lecteurs, en montant en d secondes ; la piste d'avant s'éteint. */
function lancerPiste(p, d) {
  if (ac === null || ambianceGain === null) return;
  if (musLecteur >= 0) eteindre(musLecteur, d);
  let i = p * 2;
  if (musActif[i] === 1) i = musActif[i + 1] === 1 && musFin[i + 1] > musFin[i] ? i : i + 1;
  const el = musEl[i];
  try {
    if (musActif[i] === 1) el.pause();
    el.currentTime = 0;
    const pr = el.play();
    if (pr && typeof pr.catch === 'function') pr.catch(noop);
  } catch (e) {
    /* lecteur refusé : la piste reste muette */
  }
  musActif[i] = 1;
  musFin[i] = 0;
  rampe(musGain[i].gain, 1, d);
  musLecteur = i;
  musRelance = 0;
}

/** Image par image (update) : boucle fondue de la piste courante, lecteurs éteints mis en pause. Aucune allocation. */
function suivreMusique() {
  if (musLecteur >= 0) {
    const el = musEl[musLecteur];
    const du = el.duration;
    if (musRelance === 0 && ((du > MUS.fonduBoucle * 2 && Number.isFinite(du) && el.currentTime >= du - MUS.fonduBoucle) || el.ended)) {
      musRelance = 1;
      lancerPiste(musPiste, MUS.fonduBoucle);
    }
  }
  const t = ac.currentTime;
  for (let i = 0; i < MUS_LECTEURS; i++) {
    if (musActif[i] === 1 && musFin[i] > 0 && t >= musFin[i]) {
      musActif[i] = 0;
      musFin[i] = 0;
      try {
        musEl[i].pause();
      } catch (e) {
        /* rien */
      }
    }
  }
}

/**
 * Fenêtre au premier plan (visible ET avec le focus) : la musique joue ; sinon elle s'éteint en fondu. Appelé par main.js
 * (écouteurs blur, focus, visibilitychange : audio.js n'en pose aucun).
 */
export function setPremierPlan(oui) {
  const v = oui ? 1 : 0;
  if (v === premierPlan) return;
  premierPlan = v;
  if (focusGain !== null && ac !== null) rampe(focusGain.gain, v, MUS.fonduFocus);
}

/** La page a-t-elle déjà reçu un geste qui autorise le son ? (Sans cette API : on suppose que oui.) */
function gestureSeen() {
  // App de bureau (bureau/, Electron) : autoplayPolicy « no-user-gesture-required » — le son a le droit de démarrer
  // sans geste. Sans ce court-circuit, la musique du menu attendait le premier clic (20/11, testeur Windows).
  if (DANS_APP) return true;
  const ua = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;
  return ua === undefined || ua === null || ua.hasBeenActive !== false;
}

// =====================================================================================================================
// API du contrat (§ P)
// =====================================================================================================================

const DANS_APP = typeof window !== 'undefined' && !!window.ctrlzApp;

export function init() {
  // Aucun contexte audio avant le premier geste (un AudioContext créé sans geste fait écrire un avertissement dans
  // la console de Chrome) ; les fichiers, eux, se téléchargent et se décodent tout de suite (contexte hors ligne).
  startLoading();
  if (DANS_APP) unlock(); // app de bureau : contexte créé tout de suite, la musique du menu part sans clic

}

/** Remet la limitation et la série des gemmes à zéro. Ne crée rien, ne coupe aucune voix : les sons sont brefs. */
export function reset() {
  lastStart.fill(NEVER);
  clock[GEM_LAST] = NEVER;
  gemNext = 0;
  rng[PITCH] = AUDIO.seed | 0;
  fileNext.fill(0);
  fileLast.fill(-1);
  rng[VARIANT] = (AUDIO.seed | 0) ^ 0x5bd1e995;
  seqFromFile.fill(0);
}

/** F13 : avance l'horloge du module et libère les voix dont la fin calculée est passée. */
export function update(realDt) {
  // Un pas non fini (NaN, Infinity) rendrait l'horloge inutilisable : plus aucun intervalle ne serait respecté.
  if (realDt > 0 && Number.isFinite(realDt)) clock[CLOCK] += realDt;
  running = ac !== null && ac.state === 'running';
  // Horloge audio lue seulement pendant les premiers instants du contexte : une fois le compresseur posé, il
  // retrouve l'attaque de config.js (un réglage écrit une fois, aucun nœud créé).
  if (settling && ac.currentTime >= AUDIO.settle) {
    settling = false;
    compressor.attack.value = AUDIO.compressor.attack;
  }
  if (ambianceGain !== null) suivreMusique();
  if (activeVoices === 0) return;
  const now = clock[CLOCK];
  for (let i = 0; i < V; i++) {
    const id = voiceSound[i];
    if (id >= 0 && voiceEnd[i] <= now) {
      voiceSound[i] = -1;
      activeById[id]--;
      activeByPriority[cfgPriority[id]]--;
      activeVoices--;
    }
  }
}

/**
 * Crée le contexte audio ou le reprend ; idempotent. Appelé par input.js dans le gestionnaire de chaque touche et
 * de chaque clic : un geste qui ne débloque pas le son n'empêche pas le suivant de le faire.
 */
export function unlock() {
  if (ac !== null) {
    if (ac.state === 'running') {
      running = true;
      return;
    }
    if (!gestureSeen()) return;
    // Contexte qui s'est rendormi : on le reprend, et play reste muet jusqu'à ce qu'il tourne (§ P). La fenêtre de
    // démarrage ne se rouvre pas ici : si le contexte ne reprenait pas (sortie perdue), chaque touche y empilerait
    // des départs qui sonneraient tous ensemble à la reprise.
    try {
      const p = ac.resume();
      if (p && typeof p.catch === 'function') p.catch(noop);
    } catch (e) {
      /* contexte fermé : rien à reprendre */
    }
    running = ac.state === 'running';
    return;
  }
  if (failed || !gestureSeen()) return;
  createAudio();
  if (ac === null) return;
  if (ac.state !== 'running') {
    try {
      const p = ac.resume();
      if (p && typeof p.catch === 'function') p.catch(noop);
    } catch (e) {
      /* rien */
    }
  }
  // Fenêtre de démarrage, ouverte une seule fois, à la création (voir l'en-tête : Firefox).
  clock[START_UNTIL] = clock[CLOCK] + AUDIO.startGrace;
  running = ac.state === 'running';
}

/**
 * id = SFX.* ; x, z facultatifs : atténuation avec la distance au joueur. Ne lève jamais d'erreur. Compte chaque
 * demande dans playedById, même sans contexte ; ne joue rien tant qu'aucun geste n'a débloqué le contexte.
 */
export function play(id, x, z) {
  if (x != null && z != null) {
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    startSound(id, 1, 0);
  } else startSound(id, 0, 0);
}

/** play avec une position lue dans ARGF[F_X], ARGF[F_Z] : aucun flottant en argument (appels par coup, § Z nonies). */
export function playF(id) {
  startSound(id, 1, 0);
}

/**
 * play, ou (synthOnly = 1) le tampon synthétisé même si les fichiers sont prêts : rappel d'une séquence commencée sur
 * lui. pos = 1 : position dans ARGF[F_X], ARGF[F_Z] (lue tout de suite) ; pos = 0 : sans position.
 */
function startSound(id, pos, synthOnly) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  if (!(id >= 0 && id < N) || (id | 0) !== id) return;
  playedById[id]++;
  played++;
  const now = clock[CLOCK];
  if (!running && (ac === null || now >= clock[START_UNTIL])) {
    // Pas de contexte, ou contexte verrouillé : la demande est comptée, rien n'est joué. (Un contexte qu'un geste
    // vient de CRÉER et qui démarre accepte déjà les départs pendant AUDIO.startGrace secondes.)
    muted++;
    return;
  }
  // 0. Fichiers en cours de chargement (correction du 14/11/2026, § Z nonies) : le son attend ses fichiers en silence.
  //    Avant, le repli synthétisé (l'ANCIEN son, remplacé par les fichiers de Femz) partait pendant ce temps — mesuré
  //    dans Firefox : au premier affichage de l'écran titre, 10 à 13 sons sur 38 seulement avaient leurs fichiers, pour
  //    ≈ 0,2 s. Le repli synthétisé ne sert plus que si les fichiers ont échoué (ou si le manifeste est illisible).
  if (fileState[id] === FILE_LOADING || manifestState === MAN_LOADING) {
    dropped++;
    droppedById[id]++;
    droppedLoading++;
    return;
  }
  if (id === SFX.GEM) {
    // Série des gemmes : elle retombe après resetAfter secondes sans collecte (une collecte refusée compte).
    if (now - clock[GEM_LAST] > AUDIO.gem.resetAfter) gemNext = 0;
    clock[GEM_LAST] = now;
  }
  // 1. Intervalle minimal entre deux départs du même son — en premier, avant tout calcul de distance.
  if (now - lastStart[id] < cfgInterval[id]) {
    dropped++;
    droppedById[id]++;
    droppedInterval++;
    return;
  }
  // 2. Atténuation avec la distance au joueur ; au-delà de la distance maximale le son n'est pas joué. Sans
  //    position (x ou z absent, undefined ou null) : plein gain. Position non finie (NaN) : distance inconnue,
  //    le son n'est pas joué — les deux comparaisons sont écrites pour qu'un NaN tombe du côté du refus.
  //    L'atténuation elle-même n'est calculée qu'une fois les voix accordées (étape 3) : avec les fichiers, longs,
  //    la plupart des demandes d'une horde sont refusées faute de voix, et ce calcul en flottants leur coûtait
  //    une allocation chacune (535 octets par image mesurés en scène D, contre 102 avec les tampons synthétisés).
  const fromFile = useFile[id] === 1 && !(synthOnly === 1 && buffers[id] !== null);
  let full = 1; // 1 : plein gain (sans position, ou à moins de AUDIO.distance.ref)
  if (pos === 1) {
    const dx = x - P.x;
    const dz = z - P.z;
    const d2 = dx * dx + dz * dz;
    if (!(d2 <= DIST_REF_SQ)) {
      if (!(d2 < DIST_MAX_SQ)) {
        dropped++;
        droppedById[id]++;
        droppedDistance++;
        return;
      }
      full = 0;
      dist2[0] = d2;
    }
  }
  // 3. Voix simultanées de ce son, puis budget de voix de sa priorité (une horde ne fait taire ni une arme, ni une
  //    alarme : les bruits de combat ont leur plafond, les armes et les explosions le leur).
  if (activeById[id] >= cfgMaxVoices[id]) {
    dropped++;
    droppedById[id]++;
    droppedVoices++;
    return;
  }
  const priority = cfgPriority[id];
  if (
    activeVoices >= V ||
    (priority === 0 && activeByPriority[0] >= CHATTER_VOICES) ||
    (priority < 2 && activeByPriority[0] + activeByPriority[1] >= COMMON_VOICES)
  ) {
    dropped++;
    droppedById[id]++;
    droppedPool++;
    return;
  }
  let gain = (fromFile ? fileGain[id] : cfgGain[id]) * extraGain[0];
  if (full === 0) gain *= Math.pow((DIST_MAX - Math.sqrt(dist2[0])) * DIST_INV_SPAN, DIST_EXPONENT);
  let v = 0;
  while (v < V && voiceSound[v] >= 0) v++;
  if (v >= V) {
    dropped++;
    droppedById[id]++;
    droppedPool++;
    return;
  }
  // 4. Hauteur : série montante des gemmes (repliée au sommet, voir GEM_LOOP), sinon ± pitchVar demi-tons tirés
  //    par le générateur privé.
  let rate = 1;
  if (id === SFX.GEM) {
    rate = gemRate[gemNext];
    gemNext = gemNext < GEM_MAX ? gemNext + 1 : GEM_LOOP;
  } else if ((fromFile ? filePitch[id] : cfgPitch[id]) > 0) {
    // mulberry32 privé, écrit sur place : une fonction qui renverrait le flottant coûterait un nombre alloué (§ V)
    const s = (rng[PITCH] + 0x6d2b79f5) | 0;
    rng[PITCH] = s;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0, 1)
    rate = Math.exp((u * 2 - 1) * (fromFile ? filePitch[id] : cfgPitch[id]) * SEMITONE);
  }
  if (extraRate[0] !== 1) rate *= extraRate[0]; // § E3.A : playPitch
  // 5. Départ : un seul nœud créé, l'AudioBufferSourceNode (il ne sert qu'une fois, l'API l'impose). Fichiers : la
  //    variante suivante, à tour de rôle ; § E5.G : pour AUDIO.files.hasard, tirée au hasard parmi les autres que la
  //    dernière jouée (générateur privé, entiers seulement).
  let variant = 0;
  if (fromFile) {
    const nv = fileBuffers[id].length;
    if (isRandom[id] === 1 && nv > 1) {
      const s = (rng[VARIANT] + 0x6d2b79f5) | 0;
      rng[VARIANT] = s;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const prev = fileLast[id];
      const avant = prev >= 0 && prev < nv ? 1 : 0;
      let k = ((t ^ (t >>> 14)) >>> 0) % (nv - avant);
      if (avant === 1 && k >= prev) k++;
      variant = k;
    } else variant = fileNext[id] % nv;
  }
  const buffer = fromFile ? fileBuffers[id][variant] : buffers[id];
  if (buffer === null) {
    // (cas impossible : un son sans fichier prêt a toujours son tampon synthétisé une fois le contexte créé)
    startErrors++;
    dropped++;
    droppedById[id]++;
    return;
  }
  try {
    const src = ac.createBufferSource();
    src.buffer = buffer;
    if (rate !== 1) src.playbackRate.value = rate;
    const g = voiceGains[v];
    g.gain.value = gain;
    src.connect(g);
    src.start();
  } catch (e) {
    startErrors++;
    dropped++;
    droppedById[id]++;
    return;
  }
  if (fromFile) {
    fileNext[id] = variant + 1;
    fileLast[id] = variant;
  }
  seqFromFile[id] = fromFile ? SEQ_FILE : SEQ_SYNTH;
  voiceSound[v] = id;
  voiceEnd[v] = now + (fromFile ? fileSeconds[id][variant] : bufferSeconds[id]) / rate + AUDIO.voiceRelease;
  activeById[id]++;
  activeByPriority[priority]++;
  activeVoices++;
  lastStart[id] = now;
  startedById[id]++;
  started++;
}

/**
 * Rappel d'une séquence déjà lancée par play (« 2 », « 1 » du compte à rebours, éclat suivant de la mèche d'un
 * kamikaze). Si le dernier départ de ce son était son FICHIER, la séquence y est déjà : la demande est comptée
 * (playedById) et refusée pour cette raison (droppedBy.sequence). Si c'était son tampon synthétisé, le rappel rejoue
 * ce TAMPON (un tic par chiffre), même si le fichier est arrivé entre-temps. Hors séquence : un play().
 */
export function playStep(id, x, z) {
  if (!(id >= 0 && id < N) || (id | 0) !== id) return;
  if (isSequence[id] === 1 && seqFromFile[id] === SEQ_FILE) {
    playedById[id]++;
    played++;
    if (!running && (ac === null || clock[CLOCK] >= clock[START_UNTIL])) {
      muted++;
      return;
    }
    dropped++;
    droppedById[id]++;
    droppedSequence++;
    return;
  }
  let pos = 0;
  if (x != null && z != null) {
    ARGF[F_X] = x;
    ARGF[F_Z] = z;
    pos = 1;
  }
  startSound(id, pos, isSequence[id] === 1 && seqFromFile[id] === SEQ_SYNTH ? 1 : 0);
}

/**
 * Écran titre (§ Z octies) : play sans position, au gain du son × k (k ≥ 0, « gain du moment » de la scène du menu,
 * MENU.son). Mêmes règles que play (écart minimal, voix, priorité, comptage dans playedById).
 */
export function playGain(id, k) {
  extraGain[0] = k >= 0 && Number.isFinite(k) ? k : 1;
  startSound(id, 0, 0);
  extraGain[0] = 1;
}

/**
 * § E4.P : play positionné (ARGF[F_X], ARGF[F_Z]), au gain du son × ARGF[F_V] et à la vitesse de lecture × ARGF[F_T]
 * (impact atténué sur un bouclier, tôle de la fissure). Aucun flottant en argument (appels par coup, § Z nonies).
 */
export function playGainRateF(id) {
  const k = ARGF[F_V];
  const r = ARGF[F_T];
  extraGain[0] = k >= 0 && k < 16 ? k : 1;
  extraRate[0] = r > 0.05 && r < 20 ? r : 1;
  startSound(id, 1, 0);
  extraGain[0] = 1;
  extraRate[0] = 1;
}

/** § E3.A : play sans position, transposé de `semis` demi-tons (arpège du gros lot, pluie de fragments ; hors combat). */
export function playPitch(id, semis) {
  extraRate[0] = Math.pow(2, semis / 12);
  startSound(id, 0, 0);
  extraRate[0] = 1;
}

/**
 * Niveau de la nappe d'ambiance (gain avant le volume général), atteint en douceur (constante de temps = seconds / 3).
 * Écran titre : MENU.son.ambiance ; partie : AUDIO.ambiance.gain. Sans contexte (avant le premier geste) le niveau est
 * retenu et la nappe démarre directement à ce niveau. Ne crée aucun nœud.
 */
export function setAmbiance(gain, seconds) {
  if (!(gain >= 0) || !Number.isFinite(gain)) return;
  ambianceLevel[0] = gain;
  ambianceLevel[1] = seconds > 0 ? seconds / 3 : 0.001;
  if (ambianceGain === null || ac === null) return;
  try {
    ambianceGain.gain.cancelScheduledValues(ac.currentTime);
    ambianceGain.gain.setTargetAtTime(gain, ac.currentTime, ambianceLevel[1]);
  } catch (e) {
    /* contexte fermé : rien à régler */
  }
}

/**
 * Piste de musique voulue (un nom de AUDIO.musique.pistes, ou null : silence en fondu). Même piste : rien ne change
 * (elle continue). Autre piste : fondu enchaîné, la nouvelle part de son début. Avant le contexte : retenue, elle
 * démarre avec lui. À appeler seulement quand la piste change (main.js le fait).
 */
export function setMusique(nom) {
  const p = nom == null ? -1 : MUS_NOMS.indexOf(nom);
  if (p === musPiste) return;
  musPiste = p;
  if (ac === null || ambianceGain === null) return;
  if (p >= 0) lancerPiste(p, MUS.fondu);
  else if (musLecteur >= 0) {
    eteindre(musLecteur, MUS.fondu);
    musLecteur = -1;
  }
}

/** Tests (debug.js, musiqueBoucle) : la piste courante repart comme à sa fin, fondue sur son autre lecteur. */
export function debugBoucle() {
  if (ac === null || musPiste < 0 || musLecteur < 0) return false;
  musRelance = 1;
  lancerPiste(musPiste, MUS.fonduBoucle);
  return true;
}

/** Avance (s) du son id : le « lead » de son fichier quand il joue son fichier, 0 sinon (tampon synthétisé). */
export function lead(id) {
  return id >= 0 && id < N && useFile[id] === 1 ? fileLead[id] : 0;
}

/** Volume général, de 0 à 1 (gain général = volume × AUDIO.busGain). */
export function setMasterVolume(v) {
  if (!Number.isFinite(v)) return;
  masterVolume = v < 0 ? 0 : v > 1 ? 1 : v;
  if (master !== null) master.gain.value = masterVolume * AUDIO.busGain;
}

export function getMasterVolume() {
  return masterVolume;
}

/** Volume des effets sonores (toutes les voix), de 0 à 1 — réglages. Sans contexte : retenu. */
export function setSfxVolume(v) {
  if (!Number.isFinite(v)) return;
  sfxVolume = v < 0 ? 0 : v > 1 ? 1 : v;
  if (sfxBus !== null) sfxBus.gain.value = sfxVolume;
}

/** Volume de la musique, de 0 à 1 — réglages. Sans contexte : retenu. */
export function setMusiqueVolume(v) {
  if (!Number.isFinite(v)) return;
  musiqueVolume = v < 0 ? 0 : v > 1 ? 1 : v;
  if (musiqueBus !== null) musiqueBus.gain.value = musiqueVolume;
}

export function inspect(out) {
  out.unlocked = ac !== null && ac.state === 'running';
  out.voices = activeVoices;
  out.masterVolume = masterVolume;
  out.sfxVolume = sfxVolume; // réglages de Femz (21/11)
  out.musiqueVolume = musiqueVolume;
  out.played = played;
  out.dropped = dropped;
  out.playedById = Array.from(playedById);
  // Au-delà du contrat (les tests du lot s'en servent) :
  out.started = started;
  out.muted = muted;
  out.startedById = Array.from(startedById);
  out.droppedById = Array.from(droppedById);
  out.droppedBy = { interval: droppedInterval, distance: droppedDistance, voices: droppedVoices, pool: droppedPool, error: startErrors, sequence: droppedSequence, loading: droppedLoading };
  out.gemStep = gemNext;
  out.voicesByPriority = Array.from(activeByPriority);
  out.contexts = contexts;
  out.state = ac !== null ? ac.state : failed ? 'failed' : 'none';
  out.sampleRate = ac !== null ? ac.sampleRate : 0;
  out.bufferRate = ac !== null ? SR : 0;
  out.buildMs = buildMs;
  out.synthMs = synthMs;
  out.clock = clock[CLOCK];
  out.starting = ac !== null && ac.state !== 'running' && clock[CLOCK] < clock[START_UNTIL];
  out.settling = settling;
  // Fichiers (intégration des sons) : état du manifeste, fichiers attendus / décodés / refusés, son par son.
  out.files = {
    manifest: MAN_NAMES[manifestState],
    expected: filesExpected,
    decoded: filesDecoded,
    failed: filesFailed,
    ambiance: AMB_NAMES[ambianceState],
    ambianceGain: ambianceGain !== null ? ambianceGain.gain.value : 0,
    ambianceTarget: ambianceLevel[0], // niveau visé (setAmbiance)
    loadMs: loadMs[1] > 0 ? loadMs[1] - loadMs[0] : -1, // durée du téléchargement et du décodage des sons
  };
  out.musique = {
    piste: musPiste >= 0 ? MUS_NOMS[musPiste] : null,
    lecteur: musLecteur,
    actifs: Array.from(musActif),
    temps: musLecteur >= 0 && musEl[musLecteur] !== null ? musEl[musLecteur].currentTime : 0,
    duree: musLecteur >= 0 && musEl[musLecteur] !== null ? musEl[musLecteur].duration : 0,
    gains: musGain.map((g) => (g !== null ? g.gain.value : 0)),
    premierPlan,
    focus: focusGain !== null ? focusGain.gain.value : 0,
  };
  out.fileById = Array.from(useFile);
  out.leadById = Array.from(fileLead, (v, i) => (useFile[i] === 1 ? v : 0));
}
