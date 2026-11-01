// 3D model viewer for 3D-printing orders: shows the uploaded part (triangles from the server) in the
// chosen material colour. Drag to rotate, scroll to zoom. three.js is loaded on demand.

const COLOURS = {
  White: ['#f1f1ee', 0.45, 0], Black: ['#2a2a2c', 0.5, 0], Grey: ['#8d939c', 0.6, 0], Transparent: ['#cfe6ff', 0.15, 0, 0.55],
  Translucent: ['#e8eef5', 0.2, 0, 0.75], Amber: ['#d8962a', 0.3, 0, 0.85], 'Off-white': ['#ebe5d3', 0.7, 0], Metallic: ['#b9bdc4', 0.35, 0.85],
  Red: ['#d0302b', 0.45, 0], Blue: ['#2a62d4', 0.45, 0], Yellow: ['#f0c419', 0.45, 0], Green: ['#2f9a4a', 0.45, 0], Orange: ['#f07a1a', 0.45, 0],
  'Full colour (from file)': ['#c86bd8', 0.4, 0],
};
export const colourSwatch = (name) => (COLOURS[name] || COLOURS.Grey)[0];

/** @param {HTMLElement} el @param {string} meshB64 Float32 triangle positions (mm) */
export async function mountModel3d(el, meshB64, { colour = 'Grey' } = {}) {
  const THREE = await import('/vendor/three.js');
  const bin = atob(meshB64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pos = new Float32Array(bytes.buffer);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.rotateX(-Math.PI / 2);                 // CAD files are Z-up; three.js is Y-up
  geo.computeVertexNormals(); geo.computeBoundingBox();
  const bb = geo.boundingBox; const c = new THREE.Vector3(); bb.getCenter(c); geo.translate(-c.x, -bb.min.y, -c.z);
  const size = new THREE.Vector3(); bb.getSize(size); const R = Math.max(size.x, size.y, size.z) || 1;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.innerHTML = ''; el.appendChild(renderer.domElement);
  const cv = renderer.domElement; cv.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, R / 100, R * 80);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(1, 2, 1.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(-1.5, 0.5, -1); scene.add(rim);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8d939c, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  const grid = new THREE.GridHelper(R * 2.4, 24, 0x7c6cf0, 0xb9b4e6); grid.material.transparent = true; grid.material.opacity = 0.45;
  const group = new THREE.Group(); group.add(mesh, grid); group.position.y = -size.y / 2; scene.add(group);
  const setColour = (name) => {
    const [hex, rough, metal, opacity = 1] = COLOURS[name] || COLOURS.Grey;
    mat.color.set(hex); mat.roughness = rough; mat.metalness = metal; mat.transparent = opacity < 1; mat.opacity = opacity; mat.needsUpdate = true;
  };
  setColour(colour);

  const fit = (size.length() / 2) / Math.sin((35 / 2) * Math.PI / 180) * 1.2;   // whole part in view
  let dist = fit; let rx = 0.45; let ry = 0.7; let auto = true; let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY, rx, ry]; auto = false; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; ry = drag[3] + (e.clientX - drag[0]) * 0.01; rx = Math.max(-1.5, Math.min(1.5, drag[2] + (e.clientY - drag[1]) * 0.01)); });
  cv.addEventListener('pointerup', () => { drag = null; cv.style.cursor = 'grab'; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.min(fit * 4, Math.max(fit * 0.3, dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });

  let raf = 0; let alive = true;
  const frame = () => {
    if (!alive) return;
    if (!document.body.contains(el)) { destroy(); return; }
    const w = el.clientWidth || 400; const h = el.clientHeight || 300; const pr = renderer.getPixelRatio();
    if (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr)) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    if (auto) ry += 0.004;
    camera.position.set(dist * Math.cos(rx) * Math.sin(ry), dist * Math.sin(rx), dist * Math.cos(rx) * Math.cos(ry)); camera.lookAt(0, 0, 0);
    renderer.render(scene, camera); raf = requestAnimationFrame(frame);
  };
  frame();
  function destroy() { alive = false; cancelAnimationFrame(raf); geo.dispose(); renderer.dispose(); }
  const views = { front: [0.05, 0], top: [1.5, 0], side: [0.05, Math.PI / 2], iso: [0.45, 0.7] };
  return { setColour, destroy, view: (n) => { [rx, ry] = views[n] || views.iso; auto = false; }, spin: () => { auto = true; } };
}
