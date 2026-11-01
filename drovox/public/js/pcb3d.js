// PCB preview: recolours the Gerber SVGs to the chosen mask/finish and shows a rotatable 3D board.
// three.js is loaded only when the 3D view is opened.

const MASK = {
  green: '#0d5a2a', red: '#a3161c', yellow: '#d6b40f', blue: '#123f8f', white: '#f2f2f2', black: '#141414',
  purple: '#4b2378', matte_black: '#202020', matte_green: '#1e4d2b',
};

/** Recolour a pcb-stackup SVG: solder mask, finish (gold for ENIG), silkscreen. */
export function tintSvg(svg, { colour = 'green', finish = 'hasl' } = {}) {
  const sm = MASK[colour] || MASK.green;
  const ss = colour === 'white' || colour === 'yellow' ? '#111111' : '#ffffff';
  const cf = finish === 'enig' ? '#d9b44a' : '#c8c8c8';
  return svg
    .replace(/(_fr4 \{color: )[^;]+;/, '$1#b9a36a;')
    .replace(/(_sm \{color: )[^;]+; opacity: [^;]+;/, `$1${sm}; opacity: ${colour.startsWith('matte') ? 0.95 : 0.88};`)
    .replace(/(_cf \{color: )[^;]+;/, `$1${cf};`)
    .replace(/(_ss \{color: )[^;]+;/, `$1${ss};`);
}

export const svgUrl = (svg) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

async function raster(svg, w, h) {
  const img = new Image(); img.src = svgUrl(svg); await img.decode();
  const k = 2048 / Math.max(w, h); const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w * k)); c.height = Math.max(2, Math.round(h * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Mount a 3D board in `el`. Returns {update(opts), destroy()}.
 * gerber: {width_mm, height_mm, outline_mm, top_svg, bottom_svg}; opts: {colour, finish, thickness}
 */
export async function mountPcb3d(el, gerber, opts) {
  const THREE = await import('/vendor/three.js');
  const W = gerber.width_mm; const H = gerber.height_mm;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.innerHTML = ''; el.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(0.6, 1, 1.4); scene.add(sun);
  const back = new THREE.DirectionalLight(0xffffff, 1.2); back.position.set(-0.5, -0.8, -1.2); scene.add(back);

  const pts = (gerber.outline_mm?.length > 2 ? gerber.outline_mm : [[0, 0], [W, 0], [W, H], [0, H]]);
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x - W / 2, y - H / 2)));
  const board = new THREE.Group(); scene.add(board);
  const mapUv = (geo, mirror) => {
    const p = geo.attributes.position; const uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) { const u = (p.getX(i) + W / 2) / W; uv.setXY(i, mirror ? 1 - u : u, (p.getY(i) + H / 2) / H); }
    uv.needsUpdate = true;
  };
  const capMat = () => new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.4, roughness: 0.55, metalness: 0.05, side: THREE.FrontSide });
  const topGeo = new THREE.ShapeGeometry(shape, 24); mapUv(topGeo, false);
  const botGeo = new THREE.ShapeGeometry(shape, 24); mapUv(botGeo, true); botGeo.rotateY(Math.PI);
  // after rotateY the x positions are mirrored, which matches the mirrored bottom image
  const top = new THREE.Mesh(topGeo, capMat()); const bottom = new THREE.Mesh(botGeo, capMat());
  const sideMat = new THREE.MeshStandardMaterial({ color: 0xcdbb84, roughness: 0.8 });
  let sides = null;
  board.add(top, bottom);

  async function update(o) {
    const t = Math.max(0.4, Number(o.thickness) || 1.6);
    if (sides) { board.remove(sides); sides.geometry.dispose(); }
    sides = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 24 }), [new THREE.MeshBasicMaterial({ visible: false }), sideMat]);
    sides.position.z = -t / 2; board.add(sides);
    top.position.z = t / 2 + 0.01; bottom.position.z = -t / 2 - 0.01;
    const [tc, bc] = await Promise.all([raster(tintSvg(gerber.top_svg, o), W, H), raster(tintSvg(gerber.bottom_svg, o), W, H)]);
    for (const [mesh, c] of [[top, tc], [bottom, bc]]) {
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      mesh.material.map?.dispose(); mesh.material.map = tex; mesh.material.needsUpdate = true;
    }
  }
  await update(opts);

  // simple orbit: drag to rotate, wheel / pinch to zoom
  const size = Math.max(W, H); let dist = size * 2.2; let rx = -0.75; let ry = 0.35; let auto = true;
  const view = { top: [0, 0], bottom: [Math.PI, 0], iso: [-0.75, 0.35] };
  let drag = null;
  const c = renderer.domElement;
  c.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY, rx, ry]; auto = false; c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing'; });
  c.addEventListener('pointermove', (e) => { if (!drag) return; ry = drag[3] + (e.clientX - drag[0]) * 0.01; rx = drag[2] + (e.clientY - drag[1]) * 0.01; });
  c.addEventListener('pointerup', () => { drag = null; c.style.cursor = 'grab'; });
  c.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.min(size * 6, Math.max(size * 0.6, dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });

  let raf = 0; let alive = true;
  const frame = () => {
    if (!alive) return;
    if (!document.body.contains(el)) { destroy(); return; }
    const w = el.clientWidth || 400; const h = el.clientHeight || 300;
    if (c.width !== Math.round(w * renderer.getPixelRatio()) || c.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    if (auto) ry += 0.004;
    board.rotation.set(rx, ry, 0);
    camera.position.set(0, 0, dist); camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  frame();
  function destroy() { alive = false; cancelAnimationFrame(raf); renderer.dispose(); }
  return { update, destroy, view: (name) => { [rx, ry] = view[name] || view.iso; auto = false; }, spin: () => { auto = true; } };
}
