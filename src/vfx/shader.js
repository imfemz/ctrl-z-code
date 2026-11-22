// VFX DES PROJECTILES « toon » — un seul programme pour tous les styles (formes en champs de distance, aucune texture).
//
// Instance = 12 flottants entrelacés : iA (x, y, z, R), iB (dx, dy, dz, L), iC (style, graine, f | naissance, marge).
//   Ruban (style < 20) : quad face à la caméra construit dans l'espace VUE (caméra orthographique : 1 unité = 1 m), de la
//     tête (iA.xyz) vers l'arrière le long de −iB.xyz sur L m, demi-largeur `marge` ; vP = (s, q) en mètres d'écran :
//     s depuis la tête vers l'arrière, q en travers. Les formes rondes restent rondes à l'écran quel que soit le cap.
//   Couché (style ≥ 20) : quad dans le plan XZ centré sur iA.xyz, axe local x = iB.xz, demi-côté `marge`.
//   Datés (10-19, ≥ 30) : iC.z = instant de naissance (horloge uTemps, temps SIMULÉ) ; hors de leur vie, les quatre
//     sommets sortent du volume de vue (aucun fragment).
// Sortie prémultipliée (rgb, a) : mélange ONE, ONE_MINUS_SRC_ALPHA. a = 0 → additif pur ; a > 0 → assombrit le fond
// (contour sombre des tirs ennemis, fumée, cœur saturé des halos sur le sable clair).
import { COULEURS, ROBOTS, VIE } from './reglages.js';
import { COMBOS as M_COMBOS } from '../config.js'; // § E3.M : couleurs et vies des traînées de lame
import { REPARATEUR_VOL } from '../config.js'; // § E5.D : réticule du réparateur visé (style REPARATEUR_VOL.reticule.style)
import { ONDE_BOND } from '../config.js'; // § E5.F : onde bleue du bond du Bastion (style ONDE_BOND.style)
import { ECLATS } from '../config.js'; // § E5.Y : fragment des Éclats en vol (style 9)
import { EMP_VISU } from '../config.js'; // § E5.EMP : variantes visuelles du champ EMP (rayon vide autour du héros)

const v3 = (c) => `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;
const table = (nom, liste) =>
  `vec3 ${nom}(int i) {\n` + liste.map((c, i) => `  if (i == ${i}) return ${v3(c)};`).join('\n') + `\n  return ${v3(liste[liste.length - 1])};\n}`;

export const VERT = /* glsl */ `
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
uniform float uTemps;
//#region e5:P-lisibilite-guide
uniform vec4 uHeros; // centre du héros (x, hauteur, z) ; w inutilisé — § E5.P (B1)
varying vec2 vEc; // position du fragment dans le plan de l'écran (espace vue, m)
varying vec2 vHe; // centre du héros dans le même plan
//#endregion e5:P-lisibilite-guide
varying vec2 vP;
varying vec4 vA; // style, R, L (m d'écran pour un ruban, iB.w sinon), graine
varying vec4 vB; // f | âge, abscisse monde de la tête, rapport écran / monde, iC.z brut
varying vec2 vM; // marge (m), longueur du quad le long (m d'écran ; 0 pour un quad couché)
varying float vVie; // durée de vie (s) d'un effet daté (look pixel : l'âge arrondi par paliers ne la dépasse pas)

float vie(int st) {
  if (st == 10) return ${VIE[10].toFixed(3)};
  if (st == 11) return ${VIE[11].toFixed(3)};
  if (st == 12) return ${VIE[12].toFixed(3)};
  if (st == 13) return ${VIE[13].toFixed(3)};
  if (st == 14) return ${VIE[14].toFixed(3)};
  if (st == 31) return ${VIE[31].toFixed(3)};
  if (st == 33) return ${M_COMBOS.trainee.vieIaido.toFixed(3)}; // § E3.M (la plus longue des deux : arc ou trait)
  if (st == 34) return ${VIE[34].toFixed(3)};
  if (st == ${ONDE_BOND.style}) return ${ONDE_BOND.vie.toFixed(3)}; // § E5.F
  return ${VIE[30].toFixed(3)};
}

void main() {
  int st = int(iC.x + 0.5);
  float f = iC.z;
  bool date = (st >= 10 && st < 20) || st >= 30;
  if (date) {
    f = uTemps - iC.z; // âge
    if (f < 0.0 || f > vie(st)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
  }
  float m = iC.w;
  vHe = (viewMatrix * vec4(uHeros.xyz, 1.0)).xy; // § E5.P (B1)
  vA = vec4(float(st), iA.w, iB.w, iC.y);
  vB = vec4(f, 0.0, 1.0, iC.z);
  vVie = date ? vie(st) : 1e6;
  vM = vec2(m, 0.0);
  if (st < 20) {
    vec3 dV = mat3(viewMatrix) * iB.xyz;
    float pl = length(dV.xy);
    vec2 dir = pl > 1e-4 ? dV.xy / pl : vec2(0.0, 1.0);
    float Ls = iB.w * pl;
    vec4 Bv = viewMatrix * vec4(iA.xyz, 1.0);
    vec2 cote = vec2(-dir.y, dir.x);
    float bout = st == 4 ? 0.0 : m; // segments de traînée : pas de débord (le suivant prend la suite)
    float s = mix(-bout, Ls + bout, position.x * 0.5 + 0.5);
    float q = position.y * m;
    vec3 pv = Bv.xyz;
    pv.xy += -dir * s + cote * q;
    pv.z -= dV.z * iB.w * clamp(s / max(Ls, 1e-4), 0.0, 1.0);
    if (st == 5) pv.z += ${'ORBE_AVANCE'}; // orbe EMP : dessiné devant le plastron (le héros ne le coupe pas)
    gl_Position = projectionMatrix * vec4(pv, 1.0);
    vEc = pv.xy; // § E5.P (B1)
    vP = vec2(s, q);
    vec2 h = iB.xz;
    float lh = length(h);
    vA.z = Ls;
    vM.y = st == 4 ? -1.0 : Ls; // segments de traînée : pas de fenêtre le long (ils se raccordent)
    vB.y = lh > 1e-5 ? dot(iA.xz, h / lh) : 0.0;
    vB.z = max(pl, 0.05);
  } else {
    vec2 ax = length(iB.xz) > 1e-5 ? normalize(iB.xz) : vec2(1.0, 0.0);
    vec2 az = vec2(-ax.y, ax.x);
    vec2 loc = position.xy * m;
    vec3 w = iA.xyz + vec3(ax.x * loc.x + az.x * loc.y, 0.0, ax.y * loc.x + az.y * loc.y);
    vec4 wv = viewMatrix * vec4(w, 1.0);
    gl_Position = projectionMatrix * wv;
    vEc = wv.xy; // § E5.P (B1)
    vP = loc;
    vB.y = iB.y; // § E5.F : paramètre libre des styles couchés (teinte de soin de l'anneau des tourelles)
  }
}`;

export const FRAG = /* glsl */ `
uniform float uTemps;
// Look « pixel + deep glow » (17/11, src/vfx/look.js) — uPix : x côté du gros pixel (px du tampon, ≤ 1 = coupé),
// y trois tons (1/0), z pas d'animation des datés (s, 0 = continu), w part de blanc du cœur ; uPixS : seuils des tons
// (x, y, z) et de l'alpha (w) ; uPixG : gains des tons (x, y, z) et alpha gardé (w). uTempsPix = horloge par paliers.
uniform float uTempsPix;
uniform vec4 uPix;
uniform vec4 uPixS;
uniform vec4 uPixG;
uniform float uTaille; // 17/11 : échelle des TIRS (projectiles, impacts, éclairs de bouche) ; zones et explosions : 1
//#region e5:P-lisibilite-guide
// § E5.P (B1) : effets alliés atténués autour du héros — x r0, y r1 (m d'écran), z part gardée sous r0, w actif (1/0 ;
// 0 pour le lot des tirs ennemis)
uniform vec4 uAutour;
varying vec2 vEc;
varying vec2 vHe;
//#endregion e5:P-lisibilite-guide
#define uTemps uTempsPix
varying vec2 vP;
varying vec4 vA;
varying vec4 vB;
varying vec2 vM;
varying float vVie;

${table('cBord', COULEURS.bord)}
${table('cChaud', COULEURS.chaud)}
${table('cFin', COULEURS.fin)}

const float PI = 3.14159265;
const float TAU = 6.28318531;
float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float bruit(float x) { float i = floor(x); float f = fract(x); return mix(h11(i), h11(i + 1.0), f * f * (3.0 - 2.0 * f)); }
float brise(float x) { float i = floor(x); return mix(h11(i), h11(i + 1.0), fract(x)); } // linéaire par morceaux : ligne brisée
float gauss(float x, float w) { return exp(-(x * x) / (w * w)); }

// Étincelles semées le long du trajet, FIXES dans le monde : a = abscisse monde du point (m), q = écart en travers (m).
// Une cellule de « pas » m porte au plus une étincelle (probabilité proba), décalée en travers jusqu'à ±ecart, qui scintille.
float etincelles(float a, float q, float pas, float graine, float ecart, float taille, float proba) {
  float c = floor(a / pas);
  float acc = 0.0;
  for (int k = -1; k <= 1; k++) {
    float cc = c + float(k);
    float r = h21(vec2(cc, graine));
    if (r > proba) continue;
    float a0 = (cc + 0.15 + 0.7 * h11(cc * 7.13 + graine)) * pas;
    float q0 = (h11(cc * 3.71 + graine * 1.7) * 2.0 - 1.0) * ecart;
    float d = length(vec2(a - a0, q - q0));
    float tw = 0.6 + 0.4 * sin(uTemps * 37.0 + r * 61.0);
    acc += smoothstep(taille, taille * 0.15, d) * tw;
  }
  return acc;
}

// Éclat d'étoile : x = âge / vie (0..1), R = rayon final, w = indice d'arme, g = graine (rotation, étincelles).
vec4 etoile(vec2 p, float R, float x, int w, float g, float branches) {
  float d = length(p);
  float ang = atan(p.y, p.x) + g * TAU;
  float Rs = R * (0.5 + 0.9 * (1.0 - pow(1.0 - x, 3.0)));
  float b1 = pow(abs(cos(ang * branches * 0.5)), 16.0);
  float b2 = pow(abs(cos(ang * branches + 0.5)), 28.0) * 0.5;
  float prof = 0.16 + 0.84 * max(b1, b2);
  float pleine = smoothstep(Rs * prof, Rs * prof * 0.45, d);
  float coeur = gauss(d, Rs * mix(0.12, 0.2, step(branches, 5.0)));
  float eclat = pow(1.0 - x, 1.5);
  float petit = branches < 6.0 ? 1.0 : 0.0;
  vec3 col = (vec3(1.0) * coeur * mix(2.5, 6.0, petit) + mix(cChaud(w), cBord(w), 0.35) * pleine * mix(1.6, 3.2, petit) + cBord(w) * gauss(d, Rs * 0.6) * 0.8 * petit) * eclat;
  col += cBord(w) * gauss(d - Rs * 1.15, 0.035 + 0.05 * x) * 2.2 * (1.0 - x); // anneau fin
  float et = 0.0;
  for (int j = 0; j < 6; j++) {
    float a = h11(g * 13.0 + float(j)) * TAU;
    float dist = Rs * (0.5 + 1.5 * x) * (0.7 + 0.6 * h11(g * 7.0 + float(j) * 3.1));
    et += gauss(length(p - dist * vec2(cos(a), sin(a))), 0.04);
  }
  col += mix(vec3(1.0), cBord(w), 0.5) * et * 3.5 * (1.0 - x);
  return vec4(col, 0.18 * pleine * eclat);
}

vec4 comete(vec2 p, float R, float Lq, float f, float g, float le, float k) {
  float s = p.x, q = p.y;
  float Rh = R * mix(0.35, 1.0, f);
  float L = Lq / ${'COMETE_QUAD'};
  float d = length(vec2(s > 0.0 ? s * 0.5 : s, q));
  float coeur = smoothstep(Rh * 0.62, Rh * 0.12, d);
  float liser = gauss(d - Rh * 0.7, Rh * 0.22);
  float halo = gauss(d, Rh * 1.15);
  vec3 col = vec3(1.0) * coeur * 6.0 + cBord(0) * (liser * 1.5 + halo * 0.7);
  float a = 0.45 * max(liser, halo * 0.6);
  if (s > 0.0 && L > 1e-3) {
    float t = s / L;
    if (t < 1.0) {
      float u = 1.0 - t;
      float w = Rh * 0.6 * pow(u, 1.6) + 0.004;
      float corps = gauss(q, w) * pow(u, 1.3);
      float fil = gauss(q, w * 0.3) * u * u;
      col += mix(cBord(0), cFin(0), t) * corps * 1.5 + vec3(1.0) * fil * 3.6;
      a = max(a, 0.4 * corps);
    }
    float tt = clamp(s / Lq, 0.0, 1.0);
    float e = etincelles(le - s / k, q, 0.3, g, 0.05 + tt * Rh * 2.4, 0.05, 0.55) * (1.0 - tt);
    col += mix(vec3(1.0), cBord(0), tt) * e * 4.5 * f;
  }
  return vec4(col * mix(0.5, 1.0, f), a);
}

vec4 plomb(vec2 p, float R, float L, float f, float g, float le, float k) {
  float s = p.x, q = p.y;
  float Rh = R * mix(0.4, 1.0, f);
  float d = length(vec2(s > 0.0 ? s * 0.65 : s, q));
  float ang = atan(q, s);
  float bord = Rh * (0.8 + 0.3 * bruit(ang * 2.5 + uTemps * 20.0 + g * 40.0));
  // corps de la boule de feu COUVRANT (alpha fort, intensité modérée) : l'orange reste saturé sur le sable clair
  // (un orange additif très fort vire au jaune pâle à la courbe de tons) ; seul le petit cœur dépasse le seuil du bloom
  float feu = smoothstep(bord, bord * 0.55, d);
  float coeur = smoothstep(Rh * 0.42, 0.0, d);
  vec3 col = cBord(2) * feu * 1.25 + cChaud(2) * coeur * 5.0 + cBord(2) * gauss(d - Rh, Rh * 0.3) * 0.6;
  float a = 0.78 * feu;
  if (s > 0.0 && L > 1e-3) {
    float t = s / L;
    if (t < 1.0) {
      float u = 1.0 - t;
      float corps = gauss(q, Rh * 0.55 * u + 0.005) * u * u;
      col += mix(cBord(2), cFin(2), t) * corps * 1.1;
      a = max(a, 0.5 * corps);
    }
    float tt = clamp(t, 0.0, 1.0);
    float e = etincelles(le - s / k, q, 0.14, g, 0.04 + tt * 0.22, 0.045, 0.65) * (1.0 - tt);
    col += mix(cChaud(2), cFin(2), tt) * e * 4.0 * f;
  }
  return vec4(col * mix(0.5, 1.0, f), a);
}

vec4 roquette(vec2 p, float R, float L, float g) {
  float s = p.x, q = p.y;
  float d = length(p);
  float coeur = smoothstep(R * 0.8, R * 0.15, d);
  vec3 col = cChaud(5) * coeur * 5.5 + cBord(5) * (gauss(d - R * 0.75, R * 0.2) * 2.6 + gauss(d, R * 1.1) * 1.0);
  float a = 0.3 * gauss(d, R * 1.0);
  if (s > 0.0 && L > 1e-3) {
    float t = s / L;
    if (t < 1.0) {
      float u = 1.0 - t;
      float w = R * 0.75 * pow(u, 0.7) * (1.0 + 0.18 * sin(uTemps * 55.0 + s * 9.0 + g * 20.0));
      float fl = gauss(q, w) * u;
      col += mix(vec3(1.0, 0.98, 0.8), cBord(5), smoothstep(0.0, 0.6, t)) * fl * 3.2;
    }
  }
  return vec4(col, a);
}

vec4 ennemi(vec2 p, float R, float L, float g) {
  // Lisibilité d'abord (« lents et esquivables ») : une pastille PLEINE et nette — contour sombre opaque, corps rouge
  // couvrant, cœur blanc rosé — plutôt qu'un halo : dans la horde, un halo rouge se fond dans les yeux rouges des robots.
  float s = p.x, q = p.y;
  float d = length(vec2(s > 0.0 ? s * 0.85 : s, q));
  float sil = smoothstep(R * 1.42, R * 1.3, d);
  float corps = smoothstep(R * 1.08, R * 0.98, d);
  float coeur = smoothstep(R * 0.5, R * 0.2, d);
  float pouls = 0.75 + 0.25 * sin(uTemps * 14.0 + g * 30.0);
  vec3 col = vec3(0.05, 0.0, 0.01) * sil * (1.0 - corps) + cBord(${ROBOTS}) * corps * (1.0 - coeur) * 1.35 + cChaud(${ROBOTS}) * coeur * 4.5;
  col += cBord(${ROBOTS}) * gauss(d - R * 1.55, 0.04) * 0.9 * pouls; // liseré extérieur fin qui palpite
  float a = max(0.9 * sil, corps);
  if (s > 0.0 && L > 1e-3) {
    float t = s / L;
    if (t < 1.0) {
      float u = 1.0 - t;
      float w = R * 0.7 * u + 0.01;
      float tr = smoothstep(w, w * 0.6, abs(q)) * (1.0 - corps);
      col += mix(cBord(${ROBOTS}), cFin(${ROBOTS}), t) * tr * 0.9 * u;
      a = max(a, tr * 0.7 * u);
    }
  }
  return vec4(col, a);
}

vec4 traine(vec2 p, float L, float nArriere, float nAvant, float g, float le, float k) {
  float s = p.x, q = p.y;
  float t = clamp(s / max(L, 1e-4), 0.0, 1.0);
  float age = max(uTemps - mix(nAvant, nArriere, t), 0.0);
  float aw = le - s / k;
  float flamme = exp(-age / 0.07);
  float vieF = clamp(age / ${'FUMEE'}, 0.0, 1.0);
  float wf = 0.15 * (0.4 + flamme);
  float ws = min(0.1 + age * 0.85, 0.6) * (0.75 + 0.5 * bruit(aw * 2.5 + g * 10.0 + age * 2.0));
  float fum = gauss(q, ws) * (1.0 - vieF) * (1.0 - vieF) * smoothstep(0.02, 0.14, age);
  vec3 col = mix(vec3(1.0, 1.0, 0.85), cBord(5), smoothstep(0.0, 0.06, age)) * gauss(q, wf) * flamme * 3.6;
  col += cBord(5) * gauss(q, wf * 2.2) * flamme * 0.9;
  float a = fum * 0.62; // fumée couvrante et assez sombre : elle se lit sur le sable clair
  col += vec3(0.22, 0.23, 0.22) * a;
  if (age < 0.35) {
    float e = etincelles(aw, q, 0.2, g, 0.05 + age * 1.3, 0.045, 0.55) * (1.0 - age / 0.35);
    col += mix(cChaud(5), cBord(5), age * 2.5) * e * 4.0;
  }
  return vec4(col, a);
}

vec4 orbeEmp(vec2 p, float R, float pulse) {
  float d = length(p);
  float ang = atan(p.y, p.x);
  float rim = gauss(d - R, 0.05) * (0.8 + 0.7 * bruit(ang * 6.0 + uTemps * 13.0));
  float fill = smoothstep(R, R * 0.3, d) * 0.14;
  float arc = 0.0;
  for (int i = 0; i < 4; i++) {
    float tq = floor(uTemps * 16.0 + float(i) * 0.37);
    float th = h11(tq * 1.7 + float(i) * 13.0) * TAU;
    float rho = d / R;
    float off = (brise(rho * 5.0 + tq * 3.1 + float(i) * 9.0) - 0.5) * 1.1;
    float da = abs(mod(ang - th - off + PI, TAU) - PI) * d;
    arc += gauss(da, 0.02) * step(d, R) * smoothstep(0.05 * R, 0.25 * R, d);
  }
  float boost = 1.0 + pulse * 1.6;
  vec3 col = (cBord(3) * (rim * 2.0 + fill + arc * 1.6) + vec3(1.0) * (arc * 2.6 + rim * 0.7) + cChaud(3) * gauss(d, R * 0.2) * 2.0) * boost;
  return vec4(col, fill * 0.3);
}

vec4 rail(vec2 p, float W, float L, float age, float g, float le, float k) {
  float s = p.x, q = p.y;
  float x = age / ${VIE[10].toFixed(3)};
  float u = s / max(L, 1e-3); // 0 bout, 1 canon
  float retrait = smoothstep(0.06, 0.85, x);
  float vis = smoothstep(1.0 - retrait + 0.01, 1.0 - retrait - 0.07, u) * smoothstep(-W * 0.6, 0.0, s);
  float kk = 1.0 - smoothstep(0.3, 1.0, x);
  float coeur = gauss(q, W * 0.15 * (1.0 - 0.5 * x));
  float lueur = gauss(q, W * 0.65);
  float aw = le - s / k;
  float ph = aw * 4.2 - age * 32.0 + g * TAU;
  float rad = W * (0.85 + x * 1.6);
  float ligne = 0.0;
  for (int j = 0; j < 2; j++) {
    float phj = ph + float(j) * PI;
    float qh = rad * sin(phj);
    ligne += gauss(q - qh, 0.035 + 0.025 * x) * (0.3 + 0.7 * (0.5 + 0.5 * cos(phj)));
  }
  // étincelles qui se détachent du rayon et s'en éloignent
  float et = 0.0;
  float c = floor(aw / 0.4);
  for (int j = -1; j <= 1; j++) {
    float cc = c + float(j);
    float r = h21(vec2(cc, g));
    if (r > 0.6) continue;
    float cote = h11(cc * 5.3 + g) > 0.5 ? 1.0 : -1.0;
    float a0 = (cc + 0.5) * 0.4 + (h11(cc * 2.9 + g) - 0.5) * 0.3;
    float q0 = cote * (W * 0.7 + (0.4 + h11(cc * 8.1 + g)) * age * ${'RAIL_VIT'});
    et += gauss(length(vec2(aw - a0, q - q0)), 0.045);
  }
  vec3 col = (cChaud(4) * coeur * 5.0 + cBord(4) * lueur * 1.9 + mix(cBord(4), vec3(1.0), 0.35) * ligne * 3.0) * kk * vis;
  col += mix(vec3(1.0), cBord(4), 0.4) * et * 4.0 * (1.0 - x) * step(0.0, s) * step(s, L);
  return vec4(col, 0.22 * lueur * kk * vis);
}

vec4 arcEmp(vec2 p, float L, float age, float g) {
  float s = p.x, q = p.y;
  if (s < -0.04 || s > L + 0.04) return vec4(0.0);
  float x = age / ${VIE[11].toFixed(3)};
  float tq = floor(age * 26.0); // 26 nouvelles brisures par seconde : l'éclair scintille
  float u = clamp(s / max(L, 1e-3), 0.0, 1.0);
  float env = sin(PI * u);
  float amp = 0.2 + L * 0.05;
  float q0 = (brise(u * 7.0 + g * 31.0 + tq * 5.3) - 0.5) * 2.0 * amp * env;
  float q1 = (brise(u * 11.0 + g * 17.0 + tq * 3.7 + 50.0) - 0.5) * 2.4 * amp * env;
  float on = step(0.22, h11(tq + g * 91.0));
  float k = pow(1.0 - x, 1.2) * mix(0.2, 1.0, on);
  float l0 = gauss(q - q0, 0.026);
  float g0 = gauss(q - q0, 0.14);
  float l1 = gauss(q - q1, 0.016) * 0.6;
  vec3 col = (vec3(1.0) * (l0 * 5.0 + l1 * 3.0) + cBord(3) * (g0 * 2.4 + l1 * 1.5)) * k;
  return vec4(col, 0.0);
}

vec4 disque(vec2 p, float R) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float saw = fract(ang * 8.0 / TAU);
  float rDent = R * (0.8 + 0.22 * (1.0 - saw));
  float lame = smoothstep(rDent + 0.02, rDent - 0.02, r) * smoothstep(R * 0.5, R * 0.6, r);
  float sombre = smoothstep(R * 0.62, R * 0.5, r);
  float bord = gauss(r - R * 0.72, R * 0.05);
  float moyeu = gauss(r, R * 0.2);
  float rayons = pow(max(cos(ang * 3.0), 0.0), 16.0) * smoothstep(R * 0.55, R * 0.22, r);
  float dent = smoothstep(0.55, 1.0, 1.0 - saw) * lame; // l'arête de chaque dent, plus chaude
  vec3 col = cBord(1) * lame * 2.6 + cChaud(1) * dent * 2.2 + vec3(1.0) * (bord * 2.2 + moyeu * 5.0) + cChaud(1) * rayons * 2.4;
  col += cBord(1) * gauss(r - R * 0.85, R * 0.18) * 0.7;
  col += vec3(0.14, 0.07, 0.0) * sombre;
  return vec4(col, max(lame * 0.5, sombre * 0.5));
}

vec4 traineDisques(vec2 p, float orbite, float Rd, float sg) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float n = max(abs(sg), 1.0);
  float sens = sg < 0.0 ? -1.0 : 1.0;
  float tranche = TAU / n;
  float rel = mod(-sens * ang, tranche);
  float arcL = min(tranche * 0.85, 2.4);
  float t = rel / arcL;
  if (t >= 1.0) return vec4(0.0);
  float u = 1.0 - t;
  float w = Rd * 0.7 * pow(u, 0.7) + 0.01;
  float dr = r - orbite;
  float corps = gauss(dr, w) * pow(u, 1.6);
  float fil = gauss(dr, w * 0.22) * u * u;
  vec3 col = mix(cBord(1), cFin(1), t) * corps * 2.4 + vec3(1.0, 0.95, 0.8) * fil * 2.8;
  return vec4(col, corps * 0.18);
}

vec4 auraEmp(vec2 p, float Ra, float pulse) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float tq = floor(uTemps * 20.0);
  float j = (brise(ang * 9.0 + tq * 2.3) - 0.5) * 0.16;
  float bord = gauss(r - Ra - j, 0.035);
  float halo = gauss(r - Ra, 0.28);
  float course = pow(0.5 + 0.5 * cos(ang * 3.0 - uTemps * 4.0), 12.0);
  float prog = 1.0 - pulse;
  float onde = gauss(r - Ra * pow(prog, 0.55), 0.12 + 0.12 * prog) * pulse;
  float fond = smoothstep(Ra, Ra - 0.4, r) * 0.08 * pulse;
  vec3 col = cBord(3) * (bord * (1.4 + course * 2.4 + pulse * 3.0) + halo * 0.3 * (1.0 + pulse * 2.0) + onde * 2.6 + fond);
  col += vec3(1.0) * (bord * course * 1.4 + onde * 1.2);
  return vec4(col, 0.0);
}

// ----- § E5.EMP : variantes visuelles du champ EMP (graine de l'instance d'aura = 1 à 4 ; 0 = auraEmp ci-dessus) ------
// Toutes couchées au sol, bleu électrique de l'EMP (cBord(3)) ; rien à moins de EMP_VIDE m du centre du héros ; seuls
// les pics d'impulsion (pulse² : un tiers du temps au niveau 5) passent le ton « cœur », donc le seuil du bloom.
const float EMP_VIDE = ${EMP_VISU.vide.toFixed(3)};

// 'a' clôture : tirets nets au rayon qui tournent lentement, cernés d'un liseré sombre continu (alpha : il se lit sur le
// sol clair sans ajouter de lumière) ; à l'impulsion, les tirets s'allument et des étincelles sautent dans des trous.
vec4 empCloture(float r, float ang, float Ra, float pulse) {
  float n = max(8.0, floor(Ra * 2.4));
  float s = (ang + uTemps * 0.22) * n / TAU;
  float seg = fract(s);
  float tiret = step(0.18, seg) * step(seg, 0.82);
  float dr = r - Ra;
  float ligne = gauss(dr, 0.05);
  float tq = floor(uTemps * 20.0);
  float on = step(0.5, h11(floor(s) * 7.3 + tq * 1.7));
  float zig = (brise(seg * 9.0 + tq * 3.1 + floor(s)) - 0.5) * 0.24;
  float etin = gauss(dr - zig, 0.03) * (1.0 - tiret) * on * pulse;
  float k = 1.0 + pulse * pulse * 1.6;
  vec3 col = cBord(3) * (ligne * tiret * 1.15 * k + etin * 1.5) + vec3(1.0) * (ligne * tiret * pulse * pulse * 0.8 + etin * 2.2);
  return vec4(col, gauss(dr, 0.16) * 0.55);
}

// 'b' sol électrisé : bord fin et sourd ; cinq éclairs brisés rampent au sol dans la couronne extérieure (de 0,6 × Ra
// au bord), changent de place 10 fois par seconde ; à l'impulsion, ils partent de plus près (0,45 × Ra) et brillent.
vec4 empSol(float r, float ang, float Ra, float pulse) {
  float dr = r - Ra;
  vec3 col = cBord(3) * gauss(dr, 0.035) * (0.95 + pulse * 0.5);
  float r0 = max(EMP_VIDE, Ra * mix(0.6, 0.45, pulse));
  if (r < r0 || r > Ra) return vec4(col, 0.0);
  float rho = (r - r0) / max(Ra - r0, 0.1);
  float tq = floor(uTemps * 10.0);
  float arcs = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float th = (fi + h11(tq * 1.7 + fi * 13.0)) * TAU / 5.0;
    float off = (brise(rho * 6.0 + tq * 3.1 + fi * 9.0) - 0.5) * 0.8 / r;
    float da = abs(mod(ang - th - off + PI, TAU) - PI) * r;
    arcs += gauss(da, 0.035);
  }
  arcs *= mix(0.45, 1.0, rho);
  float k = 1.1 + pulse * pulse * 1.5;
  col += cBord(3) * arcs * k + vec3(1.0) * arcs * pulse * pulse * 1.1;
  return vec4(col, 0.0);
}

// 'c' bobines : six nœuds en losange posés sur le cercle (repères de portée, liseré sombre), qui tournent lentement,
// reliés par un arc électrique qui court le long du bord (immobile aux nœuds) ; à l'impulsion, les nœuds flashent.
vec4 empBobines(float r, float ang, float Ra, float pulse) {
  float a = ang - uTemps * 0.35;
  float s = a * 6.0 / TAU;
  float id = floor(s + 0.5);
  float qx = (s - id) * TAU / 6.0 * Ra; // m le long du cercle jusqu'au nœud le plus proche
  float dr = r - Ra;
  float los = abs(qx) + abs(dr);
  float noeud = step(los, 0.26);
  float coeur = step(los, 0.11);
  float tq = floor(uTemps * 20.0);
  float j = (brise(a * Ra * 1.6 + tq * 2.3) - 0.5) * 0.3 * smoothstep(0.3, 0.7, abs(qx));
  float arc = gauss(dr - j, 0.03) * (1.0 - noeud);
  float flick = 0.75 + 0.25 * h11(tq + id * 3.0);
  float k = pulse * pulse;
  vec3 col = cBord(3) * (arc * flick * (1.0 + k * 0.7) + noeud * (1.3 + k * 1.6)) + vec3(1.0) * coeur * (0.5 + k * 1.8);
  return vec4(col, step(los, 0.36) * 0.5);
}

// 'd' pointillé + onde : cercle en pointillés sourds au repos ; à chaque impulsion, une onde fine part de EMP_VIDE (jamais
// du héros) jusqu'au bord, où elle finit en éclat.
vec4 empOnde(float r, float ang, float Ra, float pulse) {
  float n = floor(Ra * TAU / 0.45);
  float seg = fract(ang * n / TAU);
  float dr = r - Ra;
  float bord = gauss(dr, 0.04) * step(abs(seg - 0.5), 0.17);
  float prog = 1.0 - pulse;
  float rw = mix(EMP_VIDE, Ra, pow(prog, 0.6));
  float onde = gauss(r - rw, 0.05 + 0.07 * prog) * pulse * step(r, Ra + 0.05);
  float eclat = gauss(dr, 0.06) * smoothstep(0.35, 0.05, pulse) * step(0.01, pulse);
  vec3 col = cBord(3) * (bord * 0.95 + onde * 1.6 + eclat * 2.2) + vec3(1.0) * eclat * 0.6;
  return vec4(col, 0.0);
}

vec4 auraVariante(vec2 p, float Ra, float pulse, float g) {
  float r = length(p);
  if (r < EMP_VIDE || r > Ra + 0.6) return vec4(0.0);
  float ang = atan(p.y, p.x);
  if (g < 1.5) return empCloture(r, ang, Ra, pulse);
  if (g < 2.5) return empSol(r, ang, Ra, pulse);
  if (g < 3.5) return empBobines(r, ang, Ra, pulse);
  return empOnde(r, ang, Ra, pulse);
}

// ----- Correctif de l'étape 3 (§ E3.Z.12) : champ de force d'une tourelle (sentinelle) ---------------------------------
// Bulle FUI couchée au sol, bleu ciel de la sentinelle (indice 8) : bord fin à six tirets qui tournent lentement, filet
// intérieur, voile très léger, onde qui part du centre à chaque poussée (onde : 1 → 0). ouvert : 0 → 1 (ouverture/repli).
// § E5.F : soin (0 → 1) — l'anneau soigne le Bastion : il vire au vert-bleu et pulse, l'onde passe au vert.
vec4 champ(vec2 p, float Ra, float ouvert, float onde, float g, float soin) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float seg = fract((ang + uTemps * 0.55 + g * 2.1) * 6.0 / TAU);
  float tiret = smoothstep(0.0, 0.05, seg) * smoothstep(0.66, 0.6, seg);
  float bord = gauss(r - Ra, 0.035) * (0.3 + 0.7 * tiret);
  float fil = gauss(r - Ra * 0.9, 0.014) * 0.45;
  float voile = smoothstep(Ra, Ra * 0.15, r) * 0.06;
  float x = 1.0 - onde;
  float o = gauss(r - Ra * (0.2 + 0.8 * x), 0.05 + 0.1 * x) * onde;
  float sn = clamp(soin, 0.0, 1.0);
  vec3 teinte = mix(cBord(8), vec3(0.25, 1.0, 0.72), sn * (0.8 + 0.2 * sin(uTemps * 8.0)));
  vec3 col = teinte * (bord * (2.2 + 1.2 * sn) + fil + voile * (1.0 + 2.0 * sn) + o * 1.8) + vec3(1.0) * (bord * tiret * 0.6 + o * 0.5);
  return vec4(col * ouvert, (bord * 0.2 + voile * (1.0 + sn)) * ouvert);
}

// ----- Étape 2, chantier B (§ E2.B) : boomerang, flacon, nappe corrosive, mine logique ---------------------------------
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// Boomerang : deux pales en V qui tournent, fil clair, voile de rotation derrière les pointes. R = taille (rayon).
// La hauteur d'écran est étirée : l'objet tourne à plat, vu par une caméra inclinée.
vec4 boomerang(vec2 p, float R, float g) {
  vec2 pp = vec2(p.x, p.y * 1.4);
  float a = uTemps * ${'BOOM_SPIN'} + g * TAU;
  float ca = cos(a), sa = sin(a);
  vec2 q = vec2(ca * pp.x + sa * pp.y, -sa * pp.x + ca * pp.y);
  vec2 coude = vec2(-0.3 * R, 0.0);
  float d = min(sdSeg(q, coude, vec2(0.4 * R, 0.76 * R)), sdSeg(q, coude, vec2(0.4 * R, -0.76 * R)));
  float corps = smoothstep(R * 0.2, R * 0.13, d);
  float fil = gauss(d, R * 0.07);
  float r = length(pp);
  float ang = atan(q.y, q.x);
  float voile = gauss(r - R * 0.78, R * 0.17) * (0.3 + 0.7 * pow(0.5 + 0.5 * cos(ang * 2.0 + 1.3), 3.0));
  vec3 col = cBord(10) * (corps * 1.8 + voile * 1.0 + gauss(r, R * 1.05) * 0.3) + cChaud(10) * fil * 2.4 + vec3(1.0) * gauss(d, R * 0.035) * 2.2;
  return vec4(col, max(0.6 * corps, 0.14 * voile));
}

// Flacon de la nappe corrosive : fiole qui tournoie (corps rond, goulot, liquide), gouttes derrière elle.
vec4 flacon(vec2 p, float R, float L, float g) {
  float s = p.x, q = p.y;
  float a = uTemps * 13.0 + g * TAU;
  float ca = cos(a), sa = sin(a);
  vec2 r2 = vec2(ca * s + sa * q, -sa * s + ca * q);
  float corps = smoothstep(R, R * 0.82, length(vec2(r2.x * 0.85, r2.y)));
  float goulot = smoothstep(R * 0.4, R * 0.28, abs(r2.y)) * smoothstep(R * 1.7, R * 1.5, r2.x) * step(0.0, r2.x);
  float forme = max(corps, goulot);
  float liquide = smoothstep(R * 0.74, R * 0.5, length(r2 + vec2(R * 0.08, 0.0)));
  float reflet = gauss(length(r2 - vec2(-R * 0.3, R * 0.32)), R * 0.2);
  vec3 col = cBord(9) * (liquide * 2.4 + gauss(length(p), R * 1.7) * 0.6) + cChaud(9) * (forme - liquide * 0.55) * 1.0 + vec3(1.0) * reflet * 2.6;
  float al = 0.7 * forme;
  if (s > 0.0 && L > 1e-3) {
    float t = s / L;
    if (t < 1.0) {
      float u = 1.0 - t;
      float gt = gauss(q + sin(s * 13.0 + g * 30.0) * R * 0.4, R * 0.24 * u + 0.012) * u * (0.55 + 0.45 * sin(s * 21.0 - uTemps * 28.0));
      col += mix(cBord(9), cFin(9), t) * max(gt, 0.0) * 1.8;
    }
  }
  return vec4(col, al);
}

// Nappe corrosive : flaque au sol. R = rayon, f = présence (0..1 : elle s'étale puis s'évapore), pulse = éclair de la
// dernière morsure (1 → 0), g = graine. Bord dentelé qui ondule, voile intérieur, bulles qui montent et éclatent.
vec4 nappe(vec2 p, float R, float f, float pulse, float g) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float Rb = R * (0.94 + 0.045 * sin(ang * 5.0 + uTemps * 1.7 + g * 9.0) + 0.025 * sin(ang * 11.0 - uTemps * 2.3 + g * 4.0)) * mix(0.5, 1.0, f);
  float dans = smoothstep(Rb, Rb - 0.25, r);
  float bord = gauss(r - Rb, 0.055);
  vec2 c = p * 1.7 + vec2(g * 7.0, g * 3.0);
  vec2 ci = floor(c);
  vec2 cf = fract(c) - 0.5;
  float h = h21(ci);
  float ph = fract(uTemps * (0.45 + 0.6 * h) + h * 7.0);
  vec2 o = (vec2(h11(h * 91.0), h11(h * 57.0)) - 0.5) * 0.45;
  float bulle = gauss(length(cf - o) - 0.2 * ph, 0.045) * (1.0 - ph) * step(0.4, h);
  float voile = 0.5 + 0.5 * sin(p.x * 2.3 + uTemps * 1.3 + g * 5.0) * sin(p.y * 2.9 - uTemps * 1.1);
  vec3 col = cFin(9) * dans * (0.55 + 0.3 * voile) + cBord(9) * (bord * (1.5 + pulse * 3.2) + bulle * dans * 1.7 + dans * pulse * 0.45) + cChaud(9) * bord * pulse * 1.5;
  return vec4(col, dans * 0.4) * f;
}

// Mine logique : pastille au sol. R = rayon de détection, T = rayon de la pastille (0 : éteinte), f = armement
// (0..1 ; 1 = armée : le cœur clignote, le cercle de détection apparaît en pointillés).
vec4 mineLogique(vec2 p, float R, float T, float f, float g) {
  if (T < 1e-3) return vec4(0.0);
  float r = length(p);
  float ang = atan(p.y, p.x) + g * TAU;
  float arme = step(0.999, f);
  float sombre = smoothstep(T * 0.84, T * 0.66, r);
  float corps = smoothstep(T, T * 0.84, r);
  float anneau = gauss(r - T * 0.9, T * 0.1);
  float ergots = pow(max(cos(ang * 3.0), 0.0), 10.0) * gauss(r - T * 1.12, T * 0.14);
  float clig = arme * (0.55 + 0.45 * pow(0.5 + 0.5 * sin(uTemps * 9.0 + g * 40.0), 4.0)) + (1.0 - arme) * 0.12 * f;
  float coeur = gauss(r, T * 0.34);
  float tirets = step(0.5, fract(ang * 14.0 / TAU + uTemps * 0.25));
  float detect = gauss(r - R, 0.03) * tirets * arme * 0.5;
  vec3 col = vec3(0.02, 0.05, 0.04) * sombre + cBord(11) * (anneau * 2.6 + ergots * 1.8 + detect + coeur * clig * 2.2) + vec3(1.0) * coeur * clig * 2.0 * arme;
  return vec4(col, max(sombre * 0.85, corps * 0.55));
}

// Trait en losange à la couleur de l'arme w (étape 2, § E2.A) : ricochet, tirs des sentinelles. Tête en pointe de
// diamant cernée, deux filets qui se rejoignent derrière elle (pas la longue traînée effilée de la comète du blaster).
vec4 losange(vec2 p, float R, float L, float f, float g, int w) {
  float s = p.x, q = p.y;
  float Rh = R * mix(0.4, 1.0, f);
  float d = abs(s > 0.0 ? s * 0.55 : s * 0.9) + abs(q) * 1.25; // distance « losange », allongée vers l'arrière
  float coeur = smoothstep(Rh * 0.55, Rh * 0.12, d);
  float corps = smoothstep(Rh * 1.02, Rh * 0.8, d);
  float liser = gauss(d - Rh * 0.95, Rh * 0.16);
  float halo = gauss(length(p), Rh * 1.3);
  vec3 col = vec3(1.0) * coeur * 5.5 + cChaud(w) * corps * 1.1 + cBord(w) * (liser * 2.4 + halo * 0.8);
  float a = max(0.55 * corps, 0.3 * liser);
  if (s > 0.0 && L > 1e-3) {
    float t = s / L;
    if (t < 1.0) {
      float u = 1.0 - t;
      float ec = Rh * 0.55 * u; // les deux filets partent des pointes latérales et se rejoignent au bout
      float fil = (gauss(q - ec, 0.022 + 0.02 * u) + gauss(q + ec, 0.022 + 0.02 * u)) * u;
      float voile = gauss(q, ec + 0.03) * u * u;
      col += mix(cBord(w), cFin(w), t) * (fil * 2.6 + voile * 0.7) + vec3(1.0) * fil * 0.9 * u;
      a = max(a, 0.25 * voile);
    }
  }
  return vec4(col * mix(0.5, 1.0, f), a);
}

//#region e5:Y-eclats
// § E5.Y : fragment métallique des Éclats en vol. Ruban : tête = centre du fragment, s vers l'arrière (traînée), q en
// travers. Le fragment (triangle irrégulier, pointe à R) tournoie autour de la tête (uTemps × tour + graine) ; deux
// facettes (claire, ombre) séparées par l'arête pointe → milieu de la base, liseré acier bleu saturé, petit reflet vers la
// pointe (SEUL au-dessus du seuil du bloom : ECLATS.reflet). Traînée fine en acier bleu, qui s'efface vers le bout.
float ligneE5Y(vec2 p, vec2 a, vec2 b) { vec2 e = b - a; vec2 n = normalize(vec2(e.y, -e.x)); return dot(p - a, n); }
vec4 eclatE5Y(vec2 p, float R, float L, float f, float g) {
  vec3 metal = ${v3(ECLATS.metal)};
  vec3 ombre = ${v3(ECLATS.ombre)};
  vec3 lis = ${v3(ECLATS.liser)};
  vec3 tr = ${v3(ECLATS.traineCouleur)};
  float an = uTemps * ${ECLATS.tour.toFixed(3)} + g * TAU;
  float c = cos(an), sn = sin(an);
  vec2 u = vec2(c * p.x - sn * p.y, sn * p.x + c * p.y) / max(R, 1e-4);
  vec2 A = vec2(1.0, 0.05), B = vec2(-0.62, 0.6), C = vec2(-0.48, -0.52);
  float d = max(max(ligneE5Y(u, A, B), ligneE5Y(u, B, C)), ligneE5Y(u, C, A)); // < 0 dedans (sommets dans le sens trigonométrique)
  float dedans = step(d, 0.0);
  float bord = step(d, 0.3) * (1.0 - dedans);
  float cote = step(0.0, ligneE5Y(u, A, (B + C) * 0.5)); // une facette de chaque côté de l'arête
  vec3 col = mix(metal, ombre, cote) * dedans + lis * bord;
  col += mix(lis, vec3(1.0), 0.5) * gauss(length(u - A * 0.45), 0.28) * ${ECLATS.reflet.toFixed(3)} * dedans; // reflet
  float a = max(0.6 * dedans, 0.5 * bord);
  float s = p.x, q = p.y;
  if (s > R * 0.3 && L > 1e-3) {
    float t = (s - R * 0.3) / L;
    if (t < 1.0) {
      float k = 1.0 - t;
      float fil = gauss(q, 0.04 + 0.05 * k) * k * f;
      col += tr * fil * 1.8 * (1.0 - dedans - bord);
      a = max(a, 0.4 * fil);
    }
  }
  return vec4(col, a * f);
}
//#endregion e5:Y-eclats

// Croissant de la lame de phase (étape 2, § E2.A) : quad couché centré sur la bouche, axe local x = visée. R = portée,
// arc = ouverture (rad), sens = ±1 (balayages alternés). Le fil de la lame court d'un bout de l'arc à l'autre pendant la
// première moitié de la vie ; derrière lui, le croissant s'éteint.
vec4 croissant(vec2 p, float R, float arc, float age, float g) {
  float x = age / ${VIE[31].toFixed(3)};
  float sens = floor(g) < 0.5 ? 1.0 : -1.0;
  float r = length(p);
  float ang = atan(p.y, p.x) * sens; // 0 = axe de visée
  float demi = arc * 0.5;
  float u = (ang + demi) / max(arc, 1e-3); // 0 = départ du balayage, 1 = arrivée
  if (u < -0.05 || u > 1.05) return vec4(0.0);
  float tete = clamp(x / 0.5, 0.0, 1.0); // avancement du fil
  float derriere = smoothstep(tete + 0.02, tete - 0.04, u); // seulement ce que le fil a déjà balayé
  float queue = clamp(1.0 - (tete - u) * 1.6, 0.0, 1.0); // plus on est loin derrière le fil, plus c'est éteint
  float fin = 1.0 - smoothstep(0.45, 1.0, x);
  float bouts = smoothstep(0.0, 0.14, u) * smoothstep(1.0, 0.86, u); // pointes effilées du croissant
  float rin = R * mix(0.8, ${'CROISSANT_INT'}, bouts); // bord intérieur : le croissant s'amincit vers ses pointes
  float lame = smoothstep(rin - 0.04, rin + 0.1, r) * smoothstep(R + 0.03, R - 0.05, r);
  float fil = gauss(r - R * 0.97, 0.045) * bouts;
  float front = gauss((u - tete) * arc * r, 0.09) * lame * step(x, 0.55);
  float k = derriere * queue * fin;
  vec3 col = cBord(7) * lame * bouts * 1.5 * k + cChaud(7) * fil * 3.4 * k + vec3(1.0) * (front * 4.5 + fil * 1.6 * k * queue);
  col += cFin(7) * gauss(r - R, 0.22) * 0.5 * k * bouts;
  return vec4(col, 0.2 * lame * bouts * k);
}

// § E3.M : traînée orange d'un coup de lame (accent du Shinobi 0xEF9628). Mode arc (partie entière de la graine 0 ou 1 =
// sens) : fil fin qui court d'un bout de l'arc à l'autre en un tiers de la vie, éteint derrière lui ; vrille (arc ≥ 2π) :
// le fil fait le tour ; mode trait (partie entière 2) : trait long et fin du dégainé, de la tête jusqu'à R le long de x.
vec4 traineeLame(vec2 p, float R, float arc, float age, float g, float vieA) {
  float e = floor(g);
  vec3 bord = ${v3(M_COMBOS.trainee.bord)};
  vec3 chaud = ${v3(M_COMBOS.trainee.chaud)};
  if (e > 1.5) {
    float x = age / ${M_COMBOS.trainee.vieIaido.toFixed(3)};
    if (x > 1.0) return vec4(0.0);
    float u = p.x / max(R, 1e-3);
    if (u < -0.02 || u > 1.02) return vec4(0.0);
    float tete = clamp(x / 0.18, 0.0, 1.0);
    float dej = smoothstep(tete + 0.02, tete - 0.02, u);
    float fin = 1.0 - smoothstep(0.3, 1.0, x);
    float w = mix(0.05, 0.015, x) * (0.4 + 0.6 * smoothstep(0.0, 0.25, u));
    float fil = gauss(p.y, w) * dej * fin;
    float halo = gauss(p.y, w * 5.0) * dej * fin;
    vec3 col = vec3(1.0) * fil * 3.6 + chaud * fil * 2.0 + bord * halo * 1.6;
    return vec4(col, 0.12 * halo);
  }
  float x = age / vieA;
  if (x > 1.0) return vec4(0.0);
  float sens = e < 0.5 ? 1.0 : -1.0;
  float r = length(p);
  bool tour = arc > 6.2;
  float ang = atan(p.y, p.x) * sens;
  float u = tour ? fract((ang + 3.14159265) / 6.2831853) : (ang + arc * 0.5) / max(arc, 1e-3);
  if (!tour && (u < -0.05 || u > 1.05)) return vec4(0.0);
  float tete = clamp(x / 0.34, 0.0, 1.0) * (tour ? 1.0 : 1.0);
  float derriere = smoothstep(tete + 0.02, tete - 0.03, u);
  float queue = clamp(1.0 - (tete - u) * (tour ? 1.1 : 2.2), 0.0, 1.0);
  float fin = 1.0 - smoothstep(0.35, 1.0, x);
  float bouts = tour ? 1.0 : smoothstep(0.0, 0.1, u) * smoothstep(1.0, 0.9, u);
  float ep = R * (tour ? 0.2 : 0.26) * queue;
  float bande = smoothstep(R - ep - 0.05, R - ep + 0.06, r) * smoothstep(R + 0.03, R - 0.04, r);
  float fil = gauss(r - R * 0.985, 0.03) * bouts;
  float front = gauss((u - tete) * max(arc, 1.0) * r, 0.08) * bande * step(x, 0.4);
  float k = derriere * queue * fin;
  vec3 col = bord * bande * bouts * 2.6 * k + chaud * fil * 4.2 * k + vec3(1.0) * (front * 4.5 + fil * 1.8 * k * queue);
  return vec4(col, 0.22 * bande * bouts * k);
}

vec4 onde(vec2 p, float R, float age, int w) {
  float x = age / ${VIE[30].toFixed(3)};
  float r = length(p);
  float rad = R * (1.0 - pow(1.0 - x, 3.0));
  float an = gauss(r - rad, 0.08 + 0.3 * x) * pow(1.0 - x, 1.5);
  float fil = gauss(r - rad, 0.03) * (1.0 - x);
  vec3 col = cBord(w) * an * 2.4 + vec3(1.0) * fil * 2.0;
  return vec4(col, an * 0.1);
}

// § E5.F : onde du bond du Bastion (référence de Femz du 17/11) — l'anneau s'ouvre d'un coup (« splash »), le disque est
// rempli d'un dégradé qui monte vers le bord puis s'efface, le liseré fin reste et s'émiette en s'éteignant.
float hashE5F(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
vec4 ondeBond(vec2 p, float R, float age) {
  float x = age / ${ONDE_BOND.vie.toFixed(3)};
  if (x > 1.0) return vec4(0.0);
  float o = clamp(x / ${ONDE_BOND.ouverture.toFixed(3)}, 0.0, 1.0);
  float rad = R * (${ONDE_BOND.depart.toFixed(3)} + ${(1 - ONDE_BOND.depart).toFixed(3)} * (1.0 - pow(1.0 - o, 3.0)));
  float r = length(p);
  float ang = atan(p.y, p.x);
  float n = hashE5F(floor((ang + 3.14159) * 9.0)) * 0.6 + hashE5F(floor((ang + 3.14159) * 23.0) + 7.0) * 0.4;
  float miette = 1.0 - smoothstep(${ONDE_BOND.emiette.toFixed(3)}, 1.0, x + (1.0 - n) * 0.25 * step(${ONDE_BOND.emiette.toFixed(3)}, x));
  float vit = pow(1.0 - x, 1.3);
  float ep = mix(0.12, 0.035, smoothstep(0.0, 0.6, x));
  float lis = gauss(r - rad, ep) * vit * miette;
  float coeurL = gauss(r - rad, ep * 0.35) * vit * miette;
  float dedans = step(r, rad) * pow(clamp(r / max(rad, 1e-3), 0.0, 1.0), 2.5);
  float rempli = dedans * (1.0 - smoothstep(0.0, ${ONDE_BOND.remplissage.toFixed(3)}, x));
  vec3 col = ${v3(ONDE_BOND.bord)} * (lis * 2.6 + rempli * 0.9) + ${v3(ONDE_BOND.coeur)} * coeurL * 2.2;
  return vec4(col, (lis + rempli * 0.5) * 0.12);
}

// § E5.D : réticule autour du réparateur visé — couché, à la hauteur de son centre ; quatre crochets qui tournent, une
// dent vers l'intérieur au milieu de chacun, un fil extérieur ; pouls léger. R = rayon (m), fo = fondu (0..1, dans la
// graine : iC.z reste 0 pour que src/rendu/lumieres.js n'en fasse pas une tache de lumière).
vec4 cible(vec2 p, float R, float fo) {
  float r = length(p);
  float ang = atan(p.y, p.x) + uTemps * ${REPARATEUR_VOL.reticule.tour.toFixed(3)};
  float sect = fract(ang * 4.0 / TAU);
  float arc = smoothstep(0.0, 0.03, sect) * smoothstep(0.38, 0.35, sect);
  float bord = gauss(r - R, R * 0.06) * arc;
  float coeur = gauss(r - R, R * 0.022) * arc;
  float dent = gauss(sect - 0.19, 0.028) * smoothstep(R * 0.66, R * 0.76, r) * smoothstep(R * 1.02, R * 0.92, r);
  float fil = gauss(r - R * 1.2, R * 0.018) * 0.4;
  float pouls = 0.85 + 0.15 * sin(uTemps * 7.0);
  vec3 col = (${v3(REPARATEUR_VOL.reticule.bord)} * (bord * 2.2 + dent * 1.8 + fil) + ${v3(REPARATEUR_VOL.reticule.coeur)} * coeur * 2.4) * pouls;
  return vec4(col * fo, bord * 0.3 * fo);
}

vec4 effet(int st, vec2 pp, float R, float L, float f, float g) {
  vec4 c = vec4(0.0);
  // tirs plus petits (look des VFX) : tête, largeur et traînée des projectiles ; jamais les zones de dégâts (aura,
  // nappe, champ, onde, balayage), dont la taille EST la portée, ni les tirs ennemis (lisibilité du danger)
  if (st <= 2 || (st >= 5 && st <= 8) || st == 12 || st == 14 || st == 20) {
    R *= uTaille;
    if (st <= 1) L *= uTaille;
  } else if (st == 10) pp.y /= uTaille; // rayon du rail : toute la coupe (cœur, spirale, étincelles) rétrécit, pas sa longueur
  if (st == 0) c = comete(pp, R, L, f, g, vB.y, vB.z);
  else if (st == 1) c = plomb(pp, R, L, f, g, vB.y, vB.z);
  else if (st == 2) c = roquette(pp, R, L, g);
  else if (st == 3) c = ennemi(pp, R, L, g);
  else if (st == 4) c = traine(pp, L, R, vB.w, g, vB.y, vB.z);
  else if (st == 5) c = orbeEmp(pp, R, f);
  else if (st == 6) c = losange(pp, R, L, f, fract(g), int(floor(g)));
  else if (st == 7) c = boomerang(pp, R, g);
  else if (st == 8) c = flacon(pp, R, L, g);
  else if (st == 9) c = eclatE5Y(pp, R, L, f, g); // § E5.Y
  else if (st == 10) c = rail(pp, R, L, f, g, vB.y, vB.z);
  else if (st == 11) c = arcEmp(pp, L, f, g);
  else if (st == 12) c = etoile(pp, R, f / ${VIE[12].toFixed(3)}, int(floor(g)), fract(g), 4.0);
  else if (st == 13) c = etoile(pp, R, f / ${VIE[13].toFixed(3)}, int(floor(g)), fract(g), 8.0);
  else if (st == 14) c = etoile(pp, R, f / ${VIE[14].toFixed(3)}, int(floor(g)), fract(g), 4.0);
  else if (st == 20) c = disque(pp, R);
  else if (st == 21) c = traineDisques(pp, R, L, g);
  else if (st == 22) c = g < 0.5 ? auraEmp(pp, R, f) : auraVariante(pp, R, f, g); // § E5.EMP : variante dans la graine
  else if (st == 23) c = nappe(pp, R, f, L, g);
  else if (st == 24) c = mineLogique(pp, R, L, f, g);
  else if (st == 25) c = champ(pp, R, f, L, g, vB.y); // § E5.F : 6e argument « soin » (anneau du Bastion)
  else if (st == ${REPARATEUR_VOL.reticule.style}) c = cible(pp, R, g); // § E5.D (reporté à la fusion de vfx-pixel-glow)
  else if (st == 30) c = onde(pp, R, f, int(floor(g)));
  else if (st == ${ONDE_BOND.style}) c = ondeBond(pp, R, f); // § E5.F (reporté à la fusion de vfx-pixel-glow)
  else if (st == 31) c = croissant(pp, R, L, f, g);
  else if (st == 33) c = traineeLame(pp, R, L, f, g, ${VIE[33].toFixed(3)});
  else if (st == 34) c = traineeLame(pp, R, 6.2831853, f, g, ${VIE[34].toFixed(3)});
  if (st == 10) c.rgb *= uTaille; // rail : rayons longs et nombreux — leur éclat suit leur taille, sinon le glow noie l'écran
  // fenêtre du quad : tout halo tombe à 0 avant le bord (aucun carré visible, même additionné cent fois)
  float m = vM.x;
  float e = min(m * 0.3, 0.3);
  float fen = smoothstep(m, m - e, abs(pp.y));
  if (st >= 20) fen *= smoothstep(m, m - e, abs(pp.x));
  else if (vM.y >= 0.0) fen *= smoothstep(-m, -m + e, pp.x) * smoothstep(vM.y + m, vM.y + m - e, pp.x);
  c *= fen;
  return c;
}

void main() {
  int st = int(vA.x + 0.5);
  float R = vA.y, L = vA.z, g = vA.w;
  float f = vB.x;
  vec4 c;
  if (uPix.x > 1.0) {
    // look pixel : l'effet est lu dans la cellule de gros pixel (vP est linéaire sur le quad : exact). Sur-échantillonné
    // 2 × 2 (maximum) : un trait plus fin qu'un gros pixel allume quand même sa cellule — lignes continues d'un pixel.
    vec2 dx = dFdx(vP), dy = dFdy(vP);
    vec2 ctr = (floor(gl_FragCoord.xy / uPix.x) + 0.5) * uPix.x - gl_FragCoord.xy;
    vec2 p0 = vP + dx * ctr.x + dy * ctr.y;
    if (uPix.z > 0.0 && ((st >= 10 && st < 20) || st >= 30)) f = min(ceil(f / uPix.z) * uPix.z, vVie); // datés : par paliers (vers le haut : un effet bref se voit dès sa 1re image) ; jamais au-delà de sa vie (fusion du 17/11 : au-delà, pow(1 − x) d'un x > 1 rendait NaN, étalé par le bloom en gros trous bleu nuit)
    float o = uPix.x * 0.25;
    c = max(max(effet(st, p0 + dx * o + dy * o, R, L, f, g), effet(st, p0 - dx * o + dy * o, R, L, f, g)),
            max(effet(st, p0 + dx * o - dy * o, R, L, f, g), effet(st, p0 - dx * o - dy * o, R, L, f, g)));
  } else c = effet(st, vP, R, L, f, g);
  if (uPix.y > 0.5) {
    // fusion du 17/11 : composantes négatives retirées AVANT les tons — divisées par I (h = c / I), elles explosaient,
    // débordaient le tampon en demi-flottants et le bloom étalait le NaN en gros trous bleu nuit (marteau, grosse
    // tourelle, mines, explosions de l'Éclaireur : sonde tests/f1711-trous.mjs du clone de fusion)
    c = max(c, vec4(0.0));
    // trois tons durs : sombre saturé, couleur, cœur. Le cœur garde sa teinte à forte intensité : la courbe de tons
    // le blanchit, le bloom le garde coloré (principe du « deep glow » : centre blanc, halo saturé).
    float I = max(c.r, max(c.g, c.b));
    vec3 h = c.rgb / max(I, 1e-4);
    if (I < uPixS.x) c.rgb = vec3(0.0);
    else if (I < uPixS.y) c.rgb = (max(h.r, max(h.g, h.b)) - min(h.r, min(h.g, h.b)) < 0.35) ? vec3(0.0) : h * h * uPixG.x; // ton sombre : seulement s'il a une couleur (les étincelles blanches qui s'éteignent n'y laissent pas de gris)
    else if (I < uPixS.z) c.rgb = h * uPixG.y;
    else c.rgb = mix(h, vec3(1.0), uPix.w) * uPixG.z;
    c.a = c.a < uPixS.w ? 0.0 : uPixG.w;
  }
  //#region e5:P-lisibilite-guide
  // § E5.P (B1) : rien d'allié sur le héros — sortie prémultipliée : rgb et alpha baissent ensemble (le réticule du
  // réparateur visé est une information sur un ROBOT : jamais atténué)
  if (uAutour.w > 0.5 && st != ${REPARATEUR_VOL.reticule.style}) {
    float dh = length(vEc - vHe);
    c *= mix(uAutour.z, 1.0, clamp((dh - uAutour.x) / max(uAutour.y - uAutour.x, 1e-3), 0.0, 1.0));
  }
  //#endregion e5:P-lisibilite-guide
  if (c.a <= 0.002 && max(c.r, max(c.g, c.b)) <= 0.002) discard;
  gl_FragColor = c;
}`;

/** Remplace les jetons ${'NOM'} des sources par les réglages (une fois, à l'init). */
export function sources(v) {
  const r = (s) =>
    s
      .replace('ORBE_AVANCE', v.orbe.avance.toFixed(3))
      .replace('COMETE_QUAD', v.comete.quad.toFixed(3))
      .replace('FUMEE', v.traine.fumee.toFixed(3))
      .replace('RAIL_VIT', v.rail.vitesseEtincelles.toFixed(3))
      .replace('CROISSANT_INT', v.croissant.interieur.toFixed(3))
      .replace('BOOM_SPIN', v.boomerang.spin.toFixed(3));
  return { vertexShader: r(VERT), fragmentShader: r(FRAG) };
}
