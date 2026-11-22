// MENU PRINCIPAL — particules d'ambiance : poussière en suspension (plus claire à contre-jour), braises qui volent au
// vent, bouffées de poussière aux pas des boss et à l'atterrissage du héros. Trois appels de dessin, aucune texture,
// aucune allocation par image (positions dans des tableaux typés, hasard par hachage).
import * as THREE from 'three';
import { MENU, ORIENTATION } from './reglages-menu.js';

function hash(n) {
  let x = (n * 0x27d4eb2d) | 0;
  x = (x ^ (x >>> 15)) | 0;
  x = Math.imul(x, 0x85ebca6b);
  x = (x ^ (x >>> 13)) | 0;
  x = Math.imul(x, 0xc2b2ae35);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

const POINTS_VERT = `attribute float aTaille; attribute float aLum; uniform float uEchelle; varying float vLum; varying float vFace;
uniform vec3 uSun;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aTaille * uEchelle / max( 0.5, - mv.z );
  vec3 w = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  vec3 vd = normalize( w - cameraPosition );
  vFace = pow( max( dot( vd, uSun ), 0.0 ), 4.0 ); // diffusion vers l'avant : à contre-jour, la poussière s'allume
  vLum = aLum;
}`;
const POINTS_FRAG = `uniform vec3 uCouleur; uniform float uGain; uniform float uContre; varying float vLum; varying float vFace;
void main() {
  vec2 q = gl_PointCoord - 0.5; float r = length( q ) * 2.0;
  float a = smoothstep( 1.0, 0.2, r );
  gl_FragColor = vec4( uCouleur * a * vLum * uGain * ( 0.35 + uContre * vFace ), 1.0 );
}`;

export function creerEffets({ scene, dirSoleil, solY }) {
  const P = MENU.poussiere;
  const Bz = MENU.braises;
  const objets = [];

  // ----- poussière en suspension : boîte autour du héros, dérive au vent, enroulée sur la boîte
  const N = P.nombre;
  const pos = new Float32Array(N * 3);
  const taille = new Float32Array(N);
  const lum = new Float32Array(N);
  const ox = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (hash(i * 3 + 1) - 0.5) * P.boite[0];
    pos[i * 3 + 1] = hash(i * 3 + 2) * P.boite[1];
    pos[i * 3 + 2] = -hash(i * 3 + 3) * P.boite[2] + 8;
    taille[i] = P.taille * (0.5 + hash(i * 7 + 5) * 1.4);
    lum[i] = 0.4 + hash(i * 5 + 9) * 0.6;
    ox[i] = hash(i * 11) * 6.28;
  }
  const gp = new THREE.BufferGeometry();
  gp.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  gp.setAttribute('aTaille', new THREE.BufferAttribute(taille, 1));
  gp.setAttribute('aLum', new THREE.BufferAttribute(lum, 1));
  const matP = new THREE.ShaderMaterial({
    uniforms: { uCouleur: { value: new THREE.Color(P.couleur) }, uGain: { value: P.gain }, uEchelle: { value: 900 }, uSun: { value: dirSoleil.clone().negate() }, uContre: { value: 2.6 } },
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  // uSun = direction de VISÉE qui regarde le soleil : la caméra regarde vers −dirSoleil… on veut dot(vd, dirSoleil)
  matP.uniforms.uSun.value.copy(dirSoleil);
  const poussiere = new THREE.Points(gp, matP);
  poussiere.name = 'menu-poussiere';
  poussiere.frustumCulled = false;
  poussiere.renderOrder = 7;
  poussiere.rotation.y = ORIENTATION;
  scene.add(poussiere);
  objets.push(poussiere);

  // ----- braises : naissent bas, montent et filent au vent, scintillent
  const NB = Bz.nombre;
  const bpos = new Float32Array(NB * 3);
  const bvel = new Float32Array(NB * 3);
  const bage = new Float32Array(NB);
  const bvie = new Float32Array(NB);
  const btaille = new Float32Array(NB);
  const blum = new Float32Array(NB);
  let bn = 0;
  const naitre = (i, t) => {
    const k = bn++;
    bpos[i * 3] = 6 + (hash(k * 5 + 1) - 0.3) * 26;
    bpos[i * 3 + 1] = 0.2 + hash(k * 5 + 2) * 6;
    bpos[i * 3 + 2] = -hash(k * 5 + 3) * 34 + 6;
    bvel[i * 3] = -1.5 - hash(k * 5 + 4) * 2.5;
    bvel[i * 3 + 1] = 0.4 + hash(k * 7 + 1) * 0.9;
    bvel[i * 3 + 2] = (hash(k * 7 + 2) - 0.5) * 0.8;
    bage[i] = 0;
    bvie[i] = Bz.vie[0] + hash(k * 7 + 3) * (Bz.vie[1] - Bz.vie[0]);
    btaille[i] = Bz.taille * (0.6 + hash(k * 7 + 4));
    void t;
  };
  for (let i = 0; i < NB; i++) {
    naitre(i, 0);
    bage[i] = hash(i * 13) * bvie[i];
  }
  const gb = new THREE.BufferGeometry();
  gb.setAttribute('position', new THREE.BufferAttribute(bpos, 3).setUsage(THREE.DynamicDrawUsage));
  gb.setAttribute('aTaille', new THREE.BufferAttribute(btaille, 1));
  gb.setAttribute('aLum', new THREE.BufferAttribute(blum, 1).setUsage(THREE.DynamicDrawUsage));
  const matB = new THREE.ShaderMaterial({
    uniforms: { uCouleur: { value: new THREE.Color(Bz.couleur) }, uGain: { value: Bz.gain }, uEchelle: { value: 900 }, uSun: { value: dirSoleil.clone() }, uContre: { value: 0.0 } },
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  // braises : pas de diffusion à contre-jour — vFace retirée des DEUX shaders (intégration, § Z octies : une sortie du
  // vertex shader que le fragment ne lit pas fait écrire un avertissement de programme dans Firefox)
  matB.fragmentShader = matB.fragmentShader.replace('( 0.35 + uContre * vFace )', '1.0').replace(' varying float vFace;', '');
  matB.vertexShader = matB.vertexShader.replace(' varying float vFace;', '').replace(/\n  vFace = [^\n]*/, '');
  if (matB.vertexShader.indexOf('vFace') >= 0 || matB.fragmentShader.indexOf('vFace') >= 0) throw new Error('effets-menu : shader des braises inattendu');
  const braises = new THREE.Points(gb, matB);
  braises.name = 'menu-braises';
  braises.frustumCulled = false;
  braises.renderOrder = 8;
  braises.rotation.y = ORIENTATION;
  scene.add(braises);
  objets.push(braises);

  // ----- bouffées de poussière (pas des boss, atterrissage) : quads tournés vers la caméra, mélange normal
  const NPF = 96;
  const fpos = new Float32Array(NPF * 3);
  const fvel = new Float32Array(NPF * 3);
  const fage = new Float32Array(NPF).fill(1e3);
  const fvie = new Float32Array(NPF).fill(1);
  const ftaille = new Float32Array(NPF);
  let fn = 0;
  const gq = new THREE.PlaneGeometry(1, 1);
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(NPF * 4), 4).setUsage(THREE.DynamicDrawUsage);
  gq.setAttribute('aP', aP);
  const matF = new THREE.ShaderMaterial({
    uniforms: { uCouleur: { value: new THREE.Color(0xc89670) } },
    vertexShader: `attribute vec4 aP; varying vec4 vP; varying vec2 vUv;
      void main() { vP = aP; vUv = position.xy + 0.5; vec4 mv = modelViewMatrix * vec4( instanceMatrix[3].xyz, 1.0 ); mv.xy += position.xy * aP.x; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uCouleur; varying vec4 vP; varying vec2 vUv;
      void main() { vec2 q = vUv - 0.5; float a = atan( q.y, q.x ); float r = length( q ) * 2.0;
        float lobe = 0.85 + 0.1 * sin( a * 3.0 + vP.w * 6.28 ); float m = smoothstep( lobe, 0.0, r ); m *= m;
        gl_FragColor = vec4( uCouleur * ( 0.8 + 0.3 * vUv.y ), m * vP.y ); }`,
    transparent: true,
    depthWrite: false,
  });
  const bouffees = new THREE.InstancedMesh(gq, matF, NPF);
  bouffees.name = 'menu-bouffees';
  bouffees.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bouffees.frustumCulled = false;
  bouffees.count = 0;
  bouffees.renderOrder = 4;
  scene.add(bouffees);
  objets.push(bouffees);

  /** Bouffée de n grains de poussière en (x, y, z), d'échelle k (taille et vitesse). */
  function bouffee(x, y, z, n, k) {
    for (let j = 0; j < n; j++) {
      const i = fn % NPF;
      const id = fn++;
      const a = hash(id * 3 + 1) * 6.283;
      const v = (1.2 + hash(id * 3 + 2) * 2.2) * k;
      fpos[i * 3] = x + Math.cos(a) * 0.3 * k;
      fpos[i * 3 + 1] = y + 0.1 * k;
      fpos[i * 3 + 2] = z + Math.sin(a) * 0.3 * k;
      fvel[i * 3] = Math.cos(a) * v;
      fvel[i * 3 + 1] = (0.3 + hash(id * 3 + 3) * 0.9) * k;
      fvel[i * 3 + 2] = Math.sin(a) * v;
      fage[i] = 0;
      fvie[i] = 1.2 + hash(id * 5) * 1.3;
      ftaille[i] = (0.6 + hash(id * 7) * 0.7) * k;
    }
  }

  const VX = MENU.vent.base * 0.35;
  function update(dt, t, vent) {
    // poussière : dérive au vent (−X), lente oscillation verticale, enroulée sur la boîte
    const bx = P.boite[0] / 2;
    const vx = vent * 0.12;
    for (let i = 0; i < N; i++) {
      let x = pos[i * 3] + (vx + 0.05 * Math.sin(t * 0.3 + ox[i])) * dt;
      if (x < -bx) x += 2 * bx;
      else if (x > bx) x -= 2 * bx;
      pos[i * 3] = x;
      pos[i * 3 + 1] += 0.05 * Math.sin(t * 0.5 + ox[i] * 2) * dt;
    }
    gp.attributes.position.needsUpdate = true;
    // braises
    for (let i = 0; i < NB; i++) {
      bage[i] += dt;
      if (bage[i] >= bvie[i]) naitre(i, t);
      const u = bage[i] / bvie[i];
      bvel[i * 3] += (vent * 0.55 - bvel[i * 3]) * dt * 0.6;
      bvel[i * 3 + 1] += (0.25 * Math.sin(t * 2.1 + i) - 0.1) * dt;
      bpos[i * 3] += bvel[i * 3] * dt;
      bpos[i * 3 + 1] += bvel[i * 3 + 1] * dt;
      bpos[i * 3 + 2] += (bvel[i * 3 + 2] + 0.4 * Math.sin(t * 1.3 + i * 0.7)) * dt;
      const sc = 0.55 + 0.45 * Math.sin(t * 17 + i * 3.1);
      blum[i] = Math.sin(Math.PI * Math.min(1, u * 1.2)) * sc;
    }
    gb.attributes.position.needsUpdate = true;
    gb.attributes.aLum.needsUpdate = true;
    // bouffées
    const m = bouffees.instanceMatrix.array;
    const a = aP.array;
    let c = 0;
    for (let i = 0; i < NPF; i++) {
      if (fage[i] >= fvie[i]) continue;
      fage[i] += dt;
      const u = fage[i] / fvie[i];
      if (u >= 1) continue;
      const dr = Math.exp(-dt * 2.2);
      fvel[i * 3] = fvel[i * 3] * dr + VX * dt * 0.5;
      fvel[i * 3 + 1] *= dr;
      fvel[i * 3 + 2] *= dr;
      fpos[i * 3] += fvel[i * 3] * dt;
      fpos[i * 3 + 1] += fvel[i * 3 + 1] * dt;
      fpos[i * 3 + 2] += fvel[i * 3 + 2] * dt;
      const o = c * 16;
      m[o] = 1;
      m[o + 5] = 1;
      m[o + 10] = 1;
      m[o + 12] = fpos[i * 3];
      m[o + 13] = fpos[i * 3 + 1];
      m[o + 14] = fpos[i * 3 + 2];
      m[o + 15] = 1;
      a[c * 4] = ftaille[i] * (0.8 + 2.4 * u);
      a[c * 4 + 1] = 0.55 * (1 - u) * (1 - u) * Math.min(1, u * 8);
      a[c * 4 + 3] = (i * 0.618) % 1;
      c++;
    }
    bouffees.count = c;
    if (c) {
      bouffees.instanceMatrix.needsUpdate = true;
      aP.needsUpdate = true;
    }
  }

  /** Échelle des points (pixels du tampon de dessin par mètre à 1 m) : à donner au redimensionnement. */
  function echelle(hauteurPx, fovDeg) {
    const k = hauteurPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    matP.uniforms.uEchelle.value = k;
    matB.uniforms.uEchelle.value = k;
  }

  function liberer() {
    for (const o of objets) {
      scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
  }
  void solY;
  return { update, bouffee, echelle, liberer };
}
