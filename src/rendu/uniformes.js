// RENDU — envoi des uniformes de three SANS allocation (correction du 14/11/2026, ARCHITECTURE.md § Z nonies).
//
// Mesuré (scène D du critère 2, profileur de tas de Chromium, three r170) : three allouait ≈ 17 Ko par image, dont
// 12 Ko dans ses fonctions d'envoi d'uniformes : setValueM4 ≈ 7,2 Ko, setValueV3f ≈ 4,3 Ko, setValueM3 ≈ 1,6 Ko,
// setValueV2f / V4f ≈ 1,4 Ko, setValueM4Array ≈ 0,5 Ko. Deux causes, prouvées par une copie modifiée de three servie
// à la place de l'originale (essais : sortie d'une fonction de son contexte, cache en tableau typé) :
//   1. les `copyArray` / `arraysEqual` partagés par TOUTES les fonctions d'envoi voient des dizaines de formes de
//      tableaux : leurs lectures `b[i]` sont mégamorphes, et V8 y emballe chaque flottant lu (12 octets) ;
//   2. le cache de chaque uniforme est un tableau `[]` né au même littéral que ceux des uniformes booléens : V8 le
//      range en éléments génériques, et chaque flottant qu'on y écrit est emballé.
// Correction : pour les uniformes flottants (float, vec2-4, mat3, mat4, tableaux de mat4), le cache devient un
// Float64Array (rempli de NaN : le premier envoi part toujours ; valeurs déjà connues de three recopiées), et les
// envois de vec3, mat3, mat4 et tableaux de mat4 passent par les fonctions de ce module, monomorphes, qui écrivent
// dans un Float32Array de travail. Même règle que three : on compare au cache en flottants 64 bits, on n'envoie que
// si une valeur a changé.
//
// Ce module touche à l'INTÉRIEUR de three r170 (épinglé dans index.html) : `renderer.info.programs`,
// `WebGLProgram.getUniforms()`, et les champs `seq`, `cache`, `type`, `addr`, `size`, `setValue` des uniformes.
// Chaque objet est contrôlé avant d'être modifié : une autre version de three, de forme différente, est laissée telle
// quelle (le jeu marche, il alloue seulement comme avant).
//
// Appel : render.beginFrame (F1), à chaque image ; ne fait rien tant que la liste des programmes ne change pas
// (comparaison d'un entier et d'une référence).

const FLOAT = 0x1406;
const VEC2 = 0x8b50;
const VEC3 = 0x8b51;
const VEC4 = 0x8b52;
const MAT3 = 0x8b5b;
const MAT4 = 0x8b5c;

const f2 = new Float32Array(2);
const f3 = new Float32Array(3);
const f4 = new Float32Array(4);
const f9 = new Float32Array(9);
const f16 = new Float32Array(16);

const traites = new WeakSet(); // programmes déjà parcourus
let vus = 0;
let dernier = null;
let remplaces = 0; // uniformes modifiés (inspect)

// vec2 / vec3 / vec4 : la nature de la valeur (vecteur x y z w, couleur r g b, tableau) est reconnue au premier envoi
// de CHAQUE uniforme, qui prend alors la fonction propre à cette nature. Une seule fonction pour toutes les natures
// voyait plus de quatre formes d'objets à la lecture de `v.x` : lecture mégamorphe, et V8 emballe alors chaque
// flottant lu (mesuré : 2,6 Ko par image dans la scène D).
function choisir(u, v, n) {
  if (v.x !== undefined) u.setValue = n === 2 ? v2Vec : n === 3 ? v3Vec : v4Vec;
  else if (v.r !== undefined) u.setValue = n === 3 ? v3Col : v4Col;
  else u.setValue = n === 2 ? v2Tab : n === 3 ? v3Tab : v4Tab;
}
function envoyerV2(gl, v) {
  choisir(this, v, 2);
  this.setValue(gl, v);
}
function envoyerV3(gl, v) {
  choisir(this, v, 3);
  this.setValue(gl, v);
}
function envoyerV4(gl, v) {
  choisir(this, v, 4);
  this.setValue(gl, v);
}
function v2Vec(gl, v) {
  if (v.x === undefined) return envoyerV2.call(this, gl, v);
  const c = this.cache;
  if (c[0] === v.x && c[1] === v.y) return;
  c[0] = v.x;
  c[1] = v.y;
  f2[0] = c[0];
  f2[1] = c[1];
  gl.uniform2fv(this.addr, f2);
}
function v2Tab(gl, v) {
  if (v.x !== undefined) return envoyerV2.call(this, gl, v);
  const c = this.cache;
  if (c[0] === v[0] && c[1] === v[1]) return;
  c[0] = v[0];
  c[1] = v[1];
  f2[0] = c[0];
  f2[1] = c[1];
  gl.uniform2fv(this.addr, f2);
}
function v3Vec(gl, v) {
  if (v.x === undefined) return envoyerV3.call(this, gl, v);
  const c = this.cache;
  if (c[0] === v.x && c[1] === v.y && c[2] === v.z) return;
  c[0] = v.x;
  c[1] = v.y;
  c[2] = v.z;
  f3[0] = c[0];
  f3[1] = c[1];
  f3[2] = c[2];
  gl.uniform3fv(this.addr, f3);
}
function v3Col(gl, v) {
  if (v.r === undefined) return envoyerV3.call(this, gl, v);
  const c = this.cache;
  if (c[0] === v.r && c[1] === v.g && c[2] === v.b) return;
  c[0] = v.r;
  c[1] = v.g;
  c[2] = v.b;
  f3[0] = c[0];
  f3[1] = c[1];
  f3[2] = c[2];
  gl.uniform3fv(this.addr, f3);
}
function v3Tab(gl, v) {
  if (v.x !== undefined || v.r !== undefined) return envoyerV3.call(this, gl, v);
  const c = this.cache;
  if (c[0] === v[0] && c[1] === v[1] && c[2] === v[2]) return;
  c[0] = v[0];
  c[1] = v[1];
  c[2] = v[2];
  f3[0] = c[0];
  f3[1] = c[1];
  f3[2] = c[2];
  gl.uniform3fv(this.addr, f3);
}
function v4Vec(gl, v) {
  if (v.x === undefined) return envoyerV4.call(this, gl, v);
  const c = this.cache;
  if (c[0] === v.x && c[1] === v.y && c[2] === v.z && c[3] === v.w) return;
  c[0] = v.x;
  c[1] = v.y;
  c[2] = v.z;
  c[3] = v.w;
  f4[0] = c[0];
  f4[1] = c[1];
  f4[2] = c[2];
  f4[3] = c[3];
  gl.uniform4fv(this.addr, f4);
}
function v4Col(gl, v) {
  if (v.r === undefined) return envoyerV4.call(this, gl, v);
  const c = this.cache;
  // three : une couleur dans un vec4 envoie (r, g, b, a)
  if (c[0] === v.r && c[1] === v.g && c[2] === v.b && c[3] === v.a) return;
  c[0] = v.r;
  c[1] = v.g;
  c[2] = v.b;
  c[3] = v.a;
  f4[0] = c[0];
  f4[1] = c[1];
  f4[2] = c[2];
  f4[3] = c[3];
  gl.uniform4fv(this.addr, f4);
}
function v4Tab(gl, v) {
  if (v.x !== undefined || v.r !== undefined) return envoyerV4.call(this, gl, v);
  const c = this.cache;
  if (c[0] === v[0] && c[1] === v[1] && c[2] === v[2] && c[3] === v[3]) return;
  c[0] = v[0];
  c[1] = v[1];
  c[2] = v[2];
  c[3] = v[3];
  f4[0] = c[0];
  f4[1] = c[1];
  f4[2] = c[2];
  f4[3] = c[3];
  gl.uniform4fv(this.addr, f4);
}

/** float : nombre (ou booléen, comme chez three). */
function envoyerV1(gl, v) {
  if (v === undefined) return; // three : rien n'était envoyé tant que la valeur manquait (cache vide)
  const c = this.cache;
  if (c[0] === v) return;
  c[0] = v;
  gl.uniform1f(this.addr, v);
}

/** mat3 : Matrix3 (elements) ou tableau de 9. */
function envoyerM3(gl, v) {
  const c = this.cache;
  const e = v.elements !== undefined ? v.elements : v;
  let change = false;
  for (let i = 0; i < 9; i++) {
    const x = e[i];
    if (c[i] !== x) {
      c[i] = x;
      change = true;
    }
  }
  if (!change) return;
  for (let i = 0; i < 9; i++) f9[i] = c[i];
  gl.uniformMatrix3fv(this.addr, false, f9);
}

/** mat4 : Matrix4 (elements) ou tableau de 16. */
function envoyerM4(gl, v) {
  const c = this.cache;
  const e = v.elements !== undefined ? v.elements : v;
  let change = false;
  for (let i = 0; i < 16; i++) {
    const x = e[i];
    if (c[i] !== x) {
      c[i] = x;
      change = true;
    }
  }
  if (!change) return;
  for (let i = 0; i < 16; i++) f16[i] = c[i];
  gl.uniformMatrix4fv(this.addr, false, f16);
}

/** Tableau de mat4 (matrices d'ombre…) : tableau de Matrix4, ou tableau plat de nombres. */
function envoyerM4Tableau(gl, v) {
  const c = this.cache;
  const f = this.srF32;
  const n = this.size;
  let change = false;
  if (v[0] !== undefined && v[0].elements !== undefined) {
    for (let k = 0; k < n; k++) {
      const e = v[k].elements;
      const o = k * 16;
      for (let j = 0; j < 16; j++) {
        const x = e[j];
        if (c[o + j] !== x) {
          c[o + j] = x;
          change = true;
        }
      }
    }
  } else {
    const m = n * 16;
    for (let i = 0; i < m; i++) {
      const x = v[i];
      if (c[i] !== x) {
        c[i] = x;
        change = true;
      }
    }
  }
  if (!change) return;
  const m = n * 16;
  for (let i = 0; i < m; i++) f[i] = c[i];
  gl.uniformMatrix4fv(this.addr, false, f);
}

function cacheType(u, n) {
  const a = new Float64Array(n).fill(NaN);
  const old = u.cache;
  if (Array.isArray(old)) {
    for (let i = 0; i < n && i < old.length; i++) if (typeof old[i] === 'number') a[i] = old[i];
  }
  u.cache = a;
}

function formeOk(u) {
  return u !== null && typeof u === 'object' && typeof u.setValue === 'function' && Array.isArray(u.cache) && typeof u.type === 'number' && u.addr !== undefined;
}

function patcher(conteneur) {
  const seq = conteneur && conteneur.seq;
  if (!Array.isArray(seq)) return;
  for (let k = 0; k < seq.length; k++) {
    const u = seq[k];
    if (u && Array.isArray(u.seq) && u.cache === undefined) {
      patcher(u); // structure (lumières, etc.)
      continue;
    }
    if (!formeOk(u)) continue;
    const tableau = typeof u.size === 'number';
    if (!tableau) {
      if (u.type === FLOAT) {
        cacheType(u, 1);
        u.setValue = envoyerV1;
      } else if (u.type === VEC2) {
        cacheType(u, 2);
        u.setValue = envoyerV2;
      } else if (u.type === VEC4) {
        cacheType(u, 4);
        u.setValue = envoyerV4;
      } else if (u.type === VEC3) {
        cacheType(u, 3);
        u.setValue = envoyerV3;
      } else if (u.type === MAT3) {
        cacheType(u, 9);
        u.setValue = envoyerM3;
      } else if (u.type === MAT4) {
        cacheType(u, 16);
        u.setValue = envoyerM4;
      } else continue;
      remplaces++;
    } else if (u.type === MAT4 && u.size > 0) {
      cacheType(u, u.size * 16);
      u.srF32 = new Float32Array(u.size * 16);
      u.setValue = envoyerM4Tableau;
      remplaces++;
    }
  }
}

/** F1 : parcourt les programmes nouveaux depuis la dernière image (aucun en régime établi). */
export function suivre(renderer) {
  const progs = renderer.info.programs;
  if (!progs) return;
  const n = progs.length;
  if (n === vus && (n === 0 || progs[n - 1] === dernier)) return;
  for (let i = 0; i < n; i++) {
    const p = progs[i];
    if (traites.has(p) || typeof p.getUniforms !== 'function') continue;
    traites.add(p);
    patcher(p.getUniforms());
  }
  vus = n;
  dernier = n > 0 ? progs[n - 1] : null;
}

export function inspect(out) {
  out.uniformesSansAlloc = remplaces;
}
