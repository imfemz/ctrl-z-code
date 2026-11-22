// MENU PRINCIPAL — chaîne d'image du « hero shot » : scène (demi-flottant + profondeur) → profondeur de champ légère
// (les boss au loin un peu flous) → bloom multi-niveaux du prototype (src/rendu/bloom.js, BloomPeint) → passe finale du
// prototype (src/rendu/post.js, creerPasseFinale : exposition, courbe ACES, contraste, ombres bleuies, vignettage),
// dont le shader est repris tel quel avec la composition du flou en tête (aucun rendu plein écran de plus).
// Profondeur de champ : le flou (au quart de la définition) n'additionne que les pixels flous (poids = cercle de
// confusion) : le héros net ne bave pas sur le fond flou. Rendus par image : scène, 3 petits rendus de flou, bloom
// (1 extraction + 8 petits), passe finale. Aucune allocation par image.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { BloomPeint } from '../rendu/bloom.js';
import { appliquerCrt, creerPasseFinale, crtDuChargement } from '../rendu/post.js';
import { MENU } from './reglages-menu.js';

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;
const COC = `
uniform vec4 uDof; uniform vec3 uPres; uniform vec2 uCam;
float srProfVue( float d ) { return uCam.x * uCam.y / ( ( uCam.y - uCam.x ) * d - uCam.y ); } // = perspectiveDepthToViewZ
float srCoc( float d ) {
  float z = - srProfVue( d );
  float loin = smoothstep( uDof.y, uDof.z, z ) * uDof.w;
  float pres = smoothstep( uPres.x, uPres.y, z ) * uPres.z;
  return max( loin, pres );
}`;
const REDUIRE = `uniform sampler2D tCouleur; uniform sampler2D tProf; uniform vec2 uTexel; varying vec2 vUv;${COC}
void main() {
  vec4 s = vec4( 0.0 );
  for ( int i = 0; i < 4; i ++ ) {
    vec2 o = vec2( i == 0 || i == 2 ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0 ) * uTexel;
    float w = srCoc( texture2D( tProf, vUv + o ).x );
    w = w * w;
    s += vec4( texture2D( tCouleur, vUv + o ).rgb * w, w );
  }
  gl_FragColor = s * 0.25;
}`;
const MOYENNE = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec4 s = texture2D( tSrc, vUv + uTexel * vec2( -1.0, -1.0 ) ) + texture2D( tSrc, vUv + uTexel * vec2( 1.0, -1.0 ) )
         + texture2D( tSrc, vUv + uTexel * vec2( -1.0, 1.0 ) ) + texture2D( tSrc, vUv + uTexel * vec2( 1.0, 1.0 ) );
  gl_FragColor = s * 0.25;
}`;
const FLOU = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec4 s = texture2D( tSrc, vUv ) * 0.2;
  for ( int i = 0; i < 8; i ++ ) {
    float a = float( i ) * 0.785398;
    vec2 o = vec2( cos( a ), sin( a ) ) * uTexel * ( i < 4 ? 1.6 : 2.6 );
    s += texture2D( tSrc, vUv + o ) * 0.1;
  }
  gl_FragColor = s;
}`;

export function creerPost(renderer) {
  const D = MENU.dof;
  const half = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
  const rtScene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  rtScene.depthTexture = new THREE.DepthTexture(1, 1);
  rtScene.depthTexture.minFilter = THREE.NearestFilter;
  rtScene.depthTexture.magFilter = THREE.NearestFilter;
  const rtA = new THREE.WebGLRenderTarget(1, 1, half);
  const rtB = new THREE.WebGLRenderTarget(1, 1, half);
  const rtC = new THREE.WebGLRenderTarget(1, 1, half);
  const dofU = { uDof: { value: new THREE.Vector4(D.mise, D.debutLoin, D.finLoin, D.maxLoin) }, uPres: { value: new THREE.Vector3(D.debutPres, D.finPres, 0.6) }, uCam: { value: new THREE.Vector2(0.1, 1000) } };
  const mat = (frag, u) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
  const mReduire = mat(REDUIRE, { tCouleur: { value: rtScene.texture }, tProf: { value: rtScene.depthTexture }, uTexel: { value: new THREE.Vector2() }, ...dofU });
  const mMoyenne = mat(MOYENNE, { tSrc: { value: rtA.texture }, uTexel: { value: new THREE.Vector2() } });
  const mFlou = mat(FLOU, { tSrc: { value: rtB.texture }, uTexel: { value: new THREE.Vector2() } });
  const bloom = new BloomPeint();
  // passe finale du prototype, avec la composition du flou de profondeur en tête
  const def = creerPasseFinale(1);
  const fin = new THREE.ShaderMaterial({
    name: 'MenuFinal',
    uniforms: THREE.UniformsUtils.clone(def.uniforms),
    vertexShader: def.vertexShader,
    fragmentShader: def.fragmentShader
      .replace('uniform sampler2D tDiffuse;', `uniform sampler2D tDiffuse; uniform sampler2D tProf; uniform sampler2D tFlou; uniform vec4 uBrume; uniform vec3 uBrumeCouleur; uniform vec4 uBrumeVue; uniform vec3 uBrumeHaut;${COC}\n`)
      // le flou de profondeur se compose sur l'image déjà lue aux coordonnées CRT (uv : bombé, gros pixels) et après
      // l'aberration, juste avant le diorama : l'écran titre reçoit le même effet CRT / pixel que le jeu
      .replace(
        '      if ( uDiorama.x > 0.0 ) {',
        `      { vec4 f = texture2D( tFlou, uv ); float pz = texture2D( tProf, uv ).x;
        // look-cel : le ciel (dessiné à l'infini, profondeur 1) reste NET — ses cellules pixel ne sont pas floutées
        float k = srCoc( pz ) * smoothstep( 0.0, 0.04, f.a ) * ( 1.0 - step( 0.99999, pz ) );
        c.rgb = mix( c.rgb, f.rgb / max( f.a, 1e-4 ), k ); }
      if ( uBrume.z > 0.0 ) { // look-cel : brume de profondeur, les boss reculent derrière le héros
        float zb = - srProfVue( texture2D( tProf, uv ).x );
        float kb = smoothstep( uBrume.x, uBrume.y, zb );
        if ( zb > uBrume.w ) {
          // ciel : brume d'horizon selon la hauteur du rayon au-dessus de l'horizon — pleine au ras du sol (même valeur
          // que le sol lointain : pas de ligne de partage), effacée au-dessus de uBrumeVue.z (sinus de l'angle)
          vec3 rb = normalize( vec3( ( uv * 2.0 - 1.0 ) * uBrumeVue.xy, - 1.0 ) );
          kb = 1.0 - smoothstep( 0.0, uBrumeVue.z, dot( rb, uBrumeHaut ) );
        }
        c.rgb = mix( c.rgb, uBrumeCouleur, kb * uBrume.z ); }
      if ( uDiorama.x > 0.0 ) {`,
      ),
    depthTest: false,
    depthWrite: false,
  });
  if (fin.fragmentShader.indexOf('tFlou, uv') < 0) throw new Error('post-menu : passe finale inattendue (post.js a changé)');
  fin.uniforms.tProf = { value: rtScene.depthTexture };
  fin.uniforms.tFlou = { value: rtC.texture };
  fin.uniforms.uDof = dofU.uDof;
  fin.uniforms.uPres = dofU.uPres;
  fin.uniforms.uCam = dofU.uCam;
  // look-cel : brume de profondeur (MENU.brume), variante du chargement (?brume=N, sinon MENU.brume.actif)
  const qb = new URLSearchParams(location.search).get('brume');
  const vb = MENU.brume.variantes[qb === null ? MENU.brume.actif : Number(qb) | 0] || null;
  fin.uniforms.uBrume = { value: new THREE.Vector4(vb ? vb.debut : 0, vb ? vb.fin : 1, vb ? vb.force : 0, vb ? vb.ciel : 0) };
  fin.uniforms.uBrumeCouleur = { value: new THREE.Color(vb ? vb.couleur : 0).multiplyScalar(vb ? vb.gain : 1) };
  // x, y : tangentes des demi-angles de vue (posées à chaque image), z : bande d'horizon du ciel (?horizon= l'emporte)
  const qh = new URLSearchParams(location.search).get('horizon');
  fin.uniforms.uBrumeVue = { value: new THREE.Vector4(1, 1, qh !== null ? Number(qh) : (vb && vb.horizon) || 0.12, 0) };
  fin.uniforms.uBrumeHaut = { value: new THREE.Vector3(0, 1, 0) }; // verticale du monde dans le repère de la caméra
  fin.uniforms.tDiffuse.value = rtScene.texture;
  fin.uniforms.tBloom0.value = bloom.texture;
  fin.uniforms.uBloom.value.set(MENU.bloomForce, 0, 0, 0);
  fin.uniforms.uExposure.value = MENU.exposition;
  fin.uniforms.uVignette.value = MENU.vignette;
  fin.uniforms.uVignetteStart.value = MENU.vignetteDebut;
  appliquerCrt(fin.uniforms, crtDuChargement()); // branche shader-crt : mêmes réglages que le jeu
  const quad = new FullScreenQuad(null);
  let W = 0;
  let Hh = 0;

  function setSize(w, h) {
    W = w;
    Hh = h;
    rtScene.setSize(w, h);
    rtScene.depthTexture.image.width = w;
    rtScene.depthTexture.image.height = h;
    const hw = Math.max(1, w >> 1);
    const hh = Math.max(1, h >> 1);
    const qw = Math.max(1, w >> 2);
    const qh = Math.max(1, h >> 2);
    rtA.setSize(hw, hh);
    rtB.setSize(qw, qh);
    rtC.setSize(qw, qh);
    mReduire.uniforms.uTexel.value.set(1 / w, 1 / h);
    mMoyenne.uniforms.uTexel.value.set(1 / hw, 1 / hh);
    mFlou.uniforms.uTexel.value.set(1 / qw, 1 / qh);
    bloom.setSize(w, h);
    fin.uniforms.tBloom0.value = bloom.texture;
    fin.uniforms.uCrtRes.value.set(w, h);
    fin.uniforms.uCrtDpr.value = renderer.getPixelRatio();
  }

  const lecture = { texture: null };
  function rendre(scene, camera) {
    if (fin.uniforms.uBrume.value.z > 0) {
      const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) / camera.zoom;
      fin.uniforms.uBrumeVue.value.x = ty * camera.aspect;
      fin.uniforms.uBrumeVue.value.y = ty;
      fin.uniforms.uBrumeHaut.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    }
    dofU.uCam.value.set(camera.near, camera.far);
    renderer.setRenderTarget(rtScene);
    renderer.clear();
    renderer.render(scene, camera);
    quad.material = mReduire;
    renderer.setRenderTarget(rtA);
    quad.render(renderer);
    quad.material = mMoyenne;
    renderer.setRenderTarget(rtB);
    quad.render(renderer);
    quad.material = mFlou;
    renderer.setRenderTarget(rtC);
    quad.render(renderer);
    lecture.texture = rtScene.texture;
    bloom.render(renderer, null, lecture);
    quad.material = fin;
    renderer.setRenderTarget(null);
    quad.render(renderer);
  }

  /** Libère les cibles (la mémoire lourde) ; setSize les recrée. */
  function vider() {
    for (const rt of [rtScene, rtA, rtB, rtC, ...bloom.desc, ...bloom.mont]) rt.dispose();
    rtScene.depthTexture.dispose();
  }
  function liberer() {
    vider();
    for (const m of [mReduire, mMoyenne, mFlou, fin, bloom.mExtraire, ...bloom.mDesc, ...bloom.mMont]) m.dispose();
    quad.dispose();
    bloom.quad.dispose();
  }
  return { setSize, rendre, vider, liberer, fin, taille: () => [W, Hh] };
}
