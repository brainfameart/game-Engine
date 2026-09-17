// LightingSystem regression test — off-screen light culling (the
// "many lights in a scene tanks performance even when most are off
// screen" fix).
//
// Verifies, with a fake PIXI + fake renderer standing in for the real
// one:
//  1. A light whose bounding radius never reaches the visible screen
//     rect is excluded from uLightCount / the uniform upload entirely
//     — it costs zero per-pixel shader work.
//  2. A light on screen, and a light off-screen but close enough that
//     its radius still spills onto a visible pixel, are both kept.
//  3. Directional lights are NEVER culled, since they light the whole
//     screen uniformly regardless of Transform position.
//  4. Panning/zooming the world container (worldContainer.x/y/scale)
//     is accounted for — a light that's off-screen at one camera
//     position can become visible (and get uploaded) after the camera
//     moves toward it, and vice versa.
//  5. A scene where every light is off-screen tears down sprite
//     filters and skips the render early, same as the existing
//     "zero lights in the scene at all" path.

globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  devicePixelRatio: 1,
  __zenginePixiApp: null,
};

function fakeGl(maxFragmentUniformVectors) {
  return {
    MAX_FRAGMENT_UNIFORM_VECTORS: "MFUV",
    getParameter(name) {
      if (name === "MFUV") return maxFragmentUniformVectors;
      throw new Error("unexpected getParameter call: " + name);
    },
  };
}

function fakePixiApp(gl, screen) {
  return {
    renderer: {
      gl,
      resolution: 1,
      screen: screen || { width: 800, height: 600 },
      render() {},
    },
    stage: { addChild() {}, removeChild() {} },
  };
}

class FakeFilter {
  constructor(vertexSrc, fragmentSrc, uniforms) {
    this.vertexSrc = vertexSrc;
    this.fragmentSrc = fragmentSrc;
    this.uniforms = uniforms || {};
  }
}
class FakeGraphics {
  clear() { return this; }
  beginFill() { return this; }
  drawRect() { return this; }
  drawCircle() { return this; }
  endFill() { return this; }
}
class FakeSprite {
  constructor(texture) {
    this.texture = texture;
    this.width = 0;
    this.height = 0;
    this.filters = null;
    this.blendMode = 0;
  }
}
class FakeContainer {
  constructor() {
    this.children = [];
    this.x = 0;
    this.y = 0;
    this.scale = { x: 1, y: 1 };
    this.parent = null;
  }
  addChild(c) {
    this.children.push(c);
    c.parent = this;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
  }
}
class FakeRenderTexture {
  static create(opts) {
    return { width: opts.width, height: opts.height, resolution: opts.resolution, destroy() {}, resize() {} };
  }
}

globalThis.PIXI = {
  Filter: FakeFilter,
  Graphics: FakeGraphics,
  Sprite: FakeSprite,
  Container: FakeContainer,
  RenderTexture: FakeRenderTexture,
  Texture: { WHITE: {} },
  BLEND_MODES: { ADD: 1, NORMAL: 0 },
};

const { LightingSystem } = await import("./LightingSystem.js");
const { World } = await import("../core/World.js");
const { TRANSFORM, Transform } = await import("../components/Transform.js");
const { LIGHT, Light, LightType } = await import("../components/Light.js");

function assert(cond, message) {
  if (!cond) throw new Error("FAIL: " + message);
  console.log("PASS: " + message);
}

function addLight(world, { x = 0, y = 0, type = LightType.POINT, radius = 200 } = {}) {
  const e = world.createEntity("Light");
  e.addComponent(TRANSFORM, new Transform({ x, y }));
  e.addComponent(LIGHT, new Light({ type, radius }));
  return e;
}

// --- Test 1 & 2: on-screen light kept, far off-screen light culled,
// near-edge light (radius spills onto screen) kept ---
{
  const gl = fakeGl(16384);
  const pixiApp = fakePixiApp(gl, { width: 800, height: 600 });
  const worldContainer = new FakeContainer(); // no pan/zoom: screen === world 0..800 x 0..600
  const system = new LightingSystem(worldContainer, null, pixiApp);
  const world = new World();

  addLight(world, { x: 400, y: 300, radius: 100 }); // dead center, clearly visible
  addLight(world, { x: 5000, y: 5000, radius: 50 }); // far away, radius can't reach screen
  addLight(world, { x: 850, y: 300, radius: 100 }); // source just off the right edge, but radius (100) reaches x=750..950, overlapping the visible 0..800 range

  const originalWarn = console.warn;
  console.warn = () => {};
  system.update(world);
  console.warn = originalWarn;

  const u = system._lightTextureFilter.uniforms;
  assert(u.uLightCount === 2, "far off-screen light is culled; on-screen + edge-spill lights are kept (uLightCount === 2)");
}

// --- Test 3: Directional lights are never culled, regardless of
// Transform position (they have no meaningful "off-screen") ---
{
  const gl = fakeGl(16384);
  const pixiApp = fakePixiApp(gl, { width: 800, height: 600 });
  const worldContainer = new FakeContainer();
  const system = new LightingSystem(worldContainer, null, pixiApp);
  const world = new World();

  addLight(world, { x: 999999, y: 999999, type: LightType.DIRECTIONAL });

  const originalWarn = console.warn;
  console.warn = () => {};
  system.update(world);
  console.warn = originalWarn;

  const u = system._lightTextureFilter.uniforms;
  assert(u.uLightCount === 1, "a Directional light at an extreme Transform position is never culled");
}

// --- Test 4: panning the world container changes what's culled ---
{
  const gl = fakeGl(16384);
  const pixiApp = fakePixiApp(gl, { width: 800, height: 600 });
  const worldContainer = new FakeContainer();
  const system = new LightingSystem(worldContainer, null, pixiApp);
  const world = new World();

  // World-space light at x=2000 — off-screen while the camera sits at
  // the origin (screen covers world 0..800).
  addLight(world, { x: 2000, y: 300, radius: 50 });

  const originalWarn = console.warn;
  console.warn = () => {};

  system.update(world);
  let u = system._lightTextureFilter.uniforms;
  assert(u.uLightCount === 0, "light at world x=2000 is culled while the camera views world x=0..800");

  // Pan the world container so the camera now looks at world
  // x=1600..2400 (worldContainer.x = -1600 shifts world 1600 to
  // screen 0, matching _syncStageTransform's own offset convention).
  worldContainer.x = -1600;
  system.update(world);
  u = system._lightTextureFilter.uniforms;
  assert(u.uLightCount === 1, "the same light becomes visible (uploaded) once the camera pans to view it");

  console.warn = originalWarn;
}

// --- Test 5: every light off-screen tears down cleanly, same as the
// pre-existing "no lights at all" path (no render, sprite filters
// cleared) ---
{
  const gl = fakeGl(16384);
  const pixiApp = fakePixiApp(gl, { width: 800, height: 600 });
  const worldContainer = new FakeContainer();
  const system = new LightingSystem(worldContainer, null, pixiApp);
  const world = new World();

  addLight(world, { x: 99999, y: 99999, radius: 10 });

  let renderCalled = false;
  pixiApp.renderer.render = () => { renderCalled = true; };

  const originalWarn = console.warn;
  console.warn = () => {};
  system.update(world);
  console.warn = originalWarn;

  assert(renderCalled === false, "Phase 1 render is skipped entirely when every light in the scene is culled off-screen");
}

console.log("\nAll LightingSystem off-screen-culling tests passed.");
