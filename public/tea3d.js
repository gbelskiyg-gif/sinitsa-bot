// Главная: 3D-пиала с чаем. Пиала следит за курсором, над ней пар, вокруг кружат листья.
// При прокрутке меняется вид чая: цвет настоя, листьев и свечения фона.
// Без WebGL или при «уменьшить движение» показываем обычное фото.
import * as THREE from "three";
import { RoomEnvironment } from "/vendor/RoomEnvironment.js";

const KINDS = {
  intro: { tea: "#9a5410", glow: "#c88abb", leaf: "#5f6e30", turn: 0 },
  gaba: { tea: "#8a3f0c", glow: "#d9923e", leaf: "#4b3a1d", turn: 0.55 },
  oolong: { tea: "#b8901c", glow: "#93b45c", leaf: "#6c8a36", turn: 1.1 },
  red: { tea: "#8a2608", glow: "#df5a38", leaf: "#3d2414", turn: 1.65 },
  puer: { tea: "#3a1405", glow: "#b0743e", leaf: "#2e1b10", turn: 2.2 },
};

function start() {
  const canvas = document.getElementById("tea3d");
  if (!canvas) return;
  const stage = canvas.closest(".exp-stage");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    stage.classList.add("no3d");
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.35, 6.4);
  camera.lookAt(0, 0.35, 0);

  // свет: тёплый основной и цветной контровой (меняется с видом чая)
  const key = new THREE.DirectionalLight("#ffe6c8", 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.PointLight("#c88abb", 30, 12, 1.6);
  rim.position.set(-2.6, 1.8, -2.4);
  scene.add(rim);

  const rig = new THREE.Group(); // всё, что крутится вслед за курсором
  scene.add(rig);
  const cup = new THREE.Group();
  rig.add(cup);

  // ---------- пиала: профиль, повёрнутый вокруг оси ----------
  const bez = (a, c, b, t) => new THREE.Vector2((1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y);
  const V = (x, y) => new THREE.Vector2(x, y);
  const prof = [V(0, 0), V(0.3, 0), V(0.325, 0.015), V(0.325, 0.07), V(0.31, 0.095)];
  for (let i = 0; i <= 24; i++) prof.push(bez(V(0.34, 0.1), V(0.97, 0.16), V(1.0, 0.8), i / 24));
  prof.push(V(1.018, 0.825), V(1.005, 0.848), V(0.975, 0.842));
  const inner = [];
  for (let i = 0; i <= 24; i++) inner.push(bez(V(0.968, 0.82), V(0.9, 0.2), V(0.06, 0.17), i / 24));
  prof.push(...inner, V(0, 0.17));
  const porcelain = new THREE.MeshPhysicalMaterial({ color: "#f4efe6", roughness: 0.26, clearcoat: 0.7, clearcoatRoughness: 0.18, side: THREE.DoubleSide });
  cup.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 120), porcelain));
  // золотой ободок
  const gold = new THREE.MeshStandardMaterial({ color: "#e8b56f", metalness: 1, roughness: 0.25 });
  const rimRing = new THREE.Mesh(new THREE.TorusGeometry(1.004, 0.009, 12, 160), gold);
  rimRing.rotation.x = Math.PI / 2;
  rimRing.position.y = 0.846;
  cup.add(rimRing);

  // ---------- настой: поверхность с лёгкой рябью ----------
  const level = 0.6;
  let r = 0.9;
  for (let i = 1; i < inner.length; i++) if (inner[i].y <= level) { r = inner[i - 1].x; break; }
  const liquidGeo = new THREE.RingGeometry(0.0001, r - 0.004, 96, 18);
  liquidGeo.rotateX(-Math.PI / 2);
  const base = liquidGeo.attributes.position.array.slice();
  // Настой: тёмный и насыщенный, отражения приглушены, иначе чай выглядит как молоко
  const teaMat = new THREE.MeshPhongMaterial({ color: KINDS.intro.tea, specular: "#4a4038", shininess: 120, emissive: KINDS.intro.tea, emissiveIntensity: 0.35 });
  const liquid = new THREE.Mesh(liquidGeo, teaMat);
  liquid.position.y = level;
  cup.add(liquid);
  // блеск поверх настоя: только отражения и рябь, цвет чая не разбавляет
  const gloss = new THREE.Mesh(liquidGeo, new THREE.MeshStandardMaterial({ color: "#000", roughness: 0.14, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 0.8 }));
  gloss.position.y = level + 0.002;
  cup.add(gloss);

  // мягкая тень под пиалой
  const sh = document.createElement("canvas");
  sh.width = sh.height = 128;
  const g = sh.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.01;
  cup.add(shadow);

  // ---------- пар ----------
  const steamMat = (seed) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { t: { value: 0 }, seed: { value: seed }, amount: { value: 1 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
    fragmentShader: `
      varying vec2 vUv; uniform float t, seed, amount;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a*n(p); p *= 2.03; a *= .5; } return s; }
      void main(){
        vec2 uv = vUv;
        uv.x += sin(uv.y*5. + t*.9 + seed*6.) * .09 * uv.y;
        float w = smoothstep(.5, .08, abs(uv.x - .5) * (1.2 - uv.y*.5));
        float v = smoothstep(0., .25, uv.y) * smoothstep(1., .45, uv.y);
        float s = fbm(vec2(uv.x*2.6 + seed*9., uv.y*3. - t*.35));
        float a = smoothstep(.42, .85, s) * w * v * .55 * amount;
        gl_FragColor = vec4(vec3(1., .97, .93), a);
      }`,
  });
  const steam = new THREE.Group();
  const puffs = [0.1, 0.45, 0.8].map((seed, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.1), steamMat(seed));
    m.position.set((i - 1) * 0.22, 1.82 + i * 0.06, 0); // низ пара — над краем пиалы, чтобы не мутить настой
    steam.add(m);
    return m;
  });
  scene.add(steam);

  // ---------- чайные листья ----------
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.13, 0.17, 0, 0.42);
  leafShape.quadraticCurveTo(-0.13, 0.17, 0, 0);
  const leafGeo = new THREE.ShapeGeometry(leafShape, 14);
  const lp = leafGeo.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i), y = lp.getY(i);
    lp.setZ(i, x * x * 2.2 + Math.sin(y * 7) * 0.012); // лист чуть свернут
  }
  leafGeo.translate(0, -0.21, 0);
  leafGeo.computeVertexNormals();
  const leafMat = new THREE.MeshStandardMaterial({ color: KINDS.intro.leaf, roughness: 0.55, side: THREE.DoubleSide });
  const leaves = Array.from({ length: 9 }, (_, i) => {
    const m = new THREE.Mesh(leafGeo, leafMat);
    m.userData = { a: (i / 9) * Math.PI * 2, rad: 1.55 + (i % 3) * 0.32, y: 0.2 + ((i * 37) % 10) / 10, sp: 0.12 + (i % 4) * 0.03, spin: 0.4 + (i % 5) * 0.15, s: 0.7 + (i % 3) * 0.18 };
    m.scale.setScalar(m.userData.s);
    rig.add(m);
    return m;
  });

  // ---------- размеры: на компьютере пиала справа, на телефоне сверху ----------
  let mobile = false;
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    mobile = w < 760;
    camera.fov = mobile ? 38 : 30;
    camera.updateProjectionMatrix();
    // половина видимой ширины сцены на уровне пиалы — ставим пиалу в правую половину экрана
    const halfW = Math.tan((camera.fov * Math.PI) / 360) * camera.position.length() * camera.aspect;
    rig.position.set(mobile ? 0 : halfW * 0.5, mobile ? 0.62 : 0.05, 0);
    rig.scale.setScalar(mobile ? 0.8 : Math.min(1, halfW / 2.6));
    stage.style.setProperty("--gx", mobile ? "50%" : "70%");
    stage.style.setProperty("--gy", mobile ? "30%" : "50%");
  }
  addEventListener("resize", resize);
  resize();

  // ---------- курсор и прокрутка ----------
  const mouse = { x: 0, y: 0 };
  addEventListener("pointermove", (e) => {
    mouse.x = e.clientX / innerWidth - 0.5;
    mouse.y = e.clientY / innerHeight - 0.5;
  }, { passive: true });

  const panels = [...document.querySelectorAll(".exp-panel")];
  let current = "intro";
  const counter = document.querySelector(".exp-count b");
  function onScroll() {
    let best = panels[0], d = Infinity;
    for (const p of panels) {
      const r = p.getBoundingClientRect();
      const dd = Math.abs(r.top + r.height / 2 - innerHeight / 2);
      if (dd < d) { d = dd; best = p; }
    }
    current = best.dataset.kind || "intro";
    panels.forEach((p) => p.classList.toggle("on", p === best));
    if (counter) counter.textContent = String(panels.indexOf(best) + 1).padStart(2, "0");
  }
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---------- анимация ----------
  const target = { tea: new THREE.Color(), glow: new THREE.Color(), leaf: new THREE.Color() };
  const glow = new THREE.Color(KINDS.intro.glow);
  let turn = 0, visible = true, t0 = performance.now(), last = t0;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(); }).observe(stage);

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    const k = KINDS[current] || KINDS.intro;
    const ease = 1 - Math.pow(0.02, dt); // плавная смена цвета ~1 с

    target.tea.set(k.tea); target.glow.set(k.glow); target.leaf.set(k.leaf);
    teaMat.color.lerp(target.tea, ease);
    teaMat.emissive.copy(teaMat.color);
    leafMat.color.lerp(target.leaf, ease);
    glow.lerp(target.glow, ease);
    rim.color.copy(glow);
    stage.style.setProperty("--glow", "#" + glow.getHexString());
    turn += (k.turn - turn) * ease;

    // пиала поворачивается к курсору и слегка покачивается
    const sway = reduce ? 0 : Math.sin(t * 0.5) * 0.06;
    const rx = 0.32 + mouse.y * 0.32;
    const ry = turn + mouse.x * 0.7 + sway;
    rig.rotation.x += (rx - rig.rotation.x) * 0.06;
    rig.rotation.y += (ry - rig.rotation.y) * 0.06;
    cup.position.y = reduce ? 0 : Math.sin(t * 0.8) * 0.03;

    // рябь на настое
    const pos = liquidGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      const d = Math.hypot(x, z);
      pos.setY(i, reduce ? 0 : Math.sin(d * 18 - t * 2.2) * 0.004 * (1 - d / r) + Math.sin(x * 6 + t) * 0.002);
    }
    pos.needsUpdate = true;
    liquidGeo.computeVertexNormals();

    // пар всегда смотрит в камеру и поднимается из пиалы
    steam.position.copy(rig.position).add(new THREE.Vector3(0, cup.position.y * rig.scale.x, 0));
    steam.scale.setScalar(rig.scale.x);
    steam.quaternion.copy(camera.quaternion);
    puffs.forEach((p) => (p.material.uniforms.t.value = reduce ? 0 : t));

    // листья кружат вокруг
    for (const l of leaves) {
      const u = l.userData;
      const a = u.a + (reduce ? 0 : t * u.sp);
      l.position.set(Math.cos(a) * u.rad, u.y + Math.sin(t * 0.7 + u.a) * 0.12, Math.sin(a) * u.rad * 0.75);
      l.rotation.set(t * u.spin * 0.6 + u.a, t * u.spin + u.a * 2, Math.sin(t * 0.5 + u.a) * 0.6);
    }

    renderer.render(scene, camera);
  }

  let raf = 0;
  function loop() {
    cancelAnimationFrame(raf);
    const tick = (now) => {
      frame(now);
      if (visible) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  loop();
  stage.classList.add("ready");
}

try {
  start();
} catch (e) {
  console.error("[tea3d]", e);
  document.querySelector(".exp-stage")?.classList.add("no3d");
}
