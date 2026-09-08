// LightingSystem regression test — device-adaptive lighting uniform
// budget (the "PixiJS Error: Could not initialize shader" /
// "FRAGMENT shader uniforms count exceeds MAX_FRAGMENT_UNIFORM_VECTORS"
// fix).
//
// Verifies, with a fake PIXI + fake WebGL context standing in for the
// real renderer:
//  1. A constrained device (reporting the guaranteed WebGL1 minimum,
//     1024 fragment uniform vectors) no longer fails to build the
//     filter at all — LightingSystem constructs successfully and
//     _filterBroken stays false, where the old fixed-size shader would
//     have thrown a GLSL compile error and disabled lighting entirely.
//  2. A generous/typical-dev-machine budget still gets the original
//     default caps (no regression for the common case).
//  3. update() runs without throwing and fills uniform arrays sized to
//     the RESOLVED (device-scaled) caps, not the old fixed defaults —
//     including for a scene with more lights than the constrained
//     device's resolved MAX_LIGHTS, exercising the "extra lights
//     ignored with a console.warn" path against the new device-
//     dependent cap.

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

function fakePixiApp(gl) {
  return {
    renderer: {
      gl,
      resolution: 1,
      screen: { width: 800, height: 600 },
      render() {},
    },
    stage: { addChild() {}, removeChild() {} },
  };
}

// Minimal fake PIXI — just enough surface for LightingSystem/
// LightTextureShaderSource/LightGlowFilter/SpriteLightFilter to run
// without throwing, since this test only needs to exercise the JS-side
// wiring (uniform sizing, caps propagation), not actually rasterize
// anything.
class FakeFilter {
  constructor(vertexSrc, fragmentSrc, uniforms) {
    this.vertexSrc = vertexSrc;
    this.fragmentSrc = fragmentSrc;
    this.uniforms = uniforms || {};
  }
}
class FakeGraphics {
  constructor() {}
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
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
  }
}
class FakeRenderTexture {
  static create(opts) {
    return { width: opts.width, height: opts.height, resolution: opts.resolution, destroy() {} };
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
const { SHADOW_CASTER, ShadowCaster } = await import("../components/ShadowCaster.js");

function assert(cond, message) {
  if (!cond) throw new Error("FAIL: " + message);
  console.log("PASS: " + message);
}

function addLight(world, { x = 0, y = 0, type = LightType.POINT } = {}) {
  const e = world.createEntity("Light");
  e.addComponent(TRANSFORM, new Transform({ x, y }));
  e.addComponent(LIGHT, new Light({ type }));
  return e;
}

function addOccluder(world, { x = 0, y = 0 } = {}) {
  const e = world.createEntity("Occluder");
  e.addComponent(TRANSFORM, new Transform({ x, y }));
  e.addComponent(SHADOW_CASTER, new ShadowCaster({ width: 32, height: 32 }));
  return e;
}

// --- Test 1: constrained device (1024, the guaranteed WebGL1 min from
// the bug report) builds successfully instead of disabling lighting ---
{
  const gl = fakeGl(1024);
  const pixiApp = fakePixiApp(gl);
  const system = new LightingSystem(new FakeContainer(), null, pixiApp);

  assert(system._filterBroken === false, "constrained device (1024) does not set _filterBroken");
  assert(!!system._lightTextureFilter, "constrained device (1024) still produces a light-texture filter");
  assert(!!system._lightingCaps, "constrained device (1024) resolves a lightingCaps object");
  assert(system._lightingCaps.MAX_LIGHTS >= 4, "resolved MAX_LIGHTS is usable (>=4) at budget 1024");
  console.log("  resolved caps at budget=1024:", JSON.stringify(system._lightingCaps));
}

// --- Test 2: generous budget keeps the original defaults ---
{
  const gl = fakeGl(16384);
  const pixiApp = fakePixiApp(gl);
  const system = new LightingSystem(new FakeContainer(), null, pixiApp);

  assert(system._lightingCaps.MAX_LIGHTS === 32, "generous device keeps default MAX_LIGHTS=32");
  assert(system._lightingCaps.MAX_OCCLUDERS === 24, "generous device keeps default MAX_OCCLUDERS=24");
  assert(system._lightingCaps.MAX_FREEFORM_POINTS === 16, "generous device keeps default MAX_FREEFORM_POINTS=16");
}

// --- Test 3: update() runs end-to-end on a constrained device, fills
// uniforms sized to the resolved caps, and warns (not throws) when a
// scene exceeds the resolved MAX_LIGHTS ---
{
  const gl = fakeGl(1024);
  const pixiApp = fakePixiApp(gl);
  const system = new LightingSystem(new FakeContainer(), null, pixiApp);
  const resolvedMaxLights = system._lightingCaps.MAX_LIGHTS;

  const world = new World();
  // One more light than the resolved cap, to exercise the "extra
  // lights ignored" warning path against the DEVICE-RESOLVED number
  // (not the old fixed MAX_LIGHTS=32).
  for (let i = 0; i < resolvedMaxLights + 1; i++) {
    addLight(world, { x: i * 10, y: 0 });
  }
  addOccluder(world, { x: 5, y: 5 });

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    system.update(world, 1 / 60);
  } finally {
    console.warn = originalWarn;
  }

  assert(system._filterBroken === false, "update() does not break the filter on a constrained device");
  const u = system._lightTextureFilter.uniforms;
  assert(u.uLightPos.length === resolvedMaxLights * 2, "uLightPos buffer sized to resolved MAX_LIGHTS");
  assert(u.uLightCount === resolvedMaxLights, "uLightCount clamped to resolved MAX_LIGHTS, not the old fixed 32");
  assert(
    warnings.some((w) => w.includes("active lights but this device's shader only supports")),
    "update() warns (not throws) when scene exceeds the resolved per-device MAX_LIGHTS"
  );
  console.log("  uLightCount after update():", u.uLightCount, "/ resolved MAX_LIGHTS:", resolvedMaxLights);
}

console.log("\nAll LightingSystem device-adaptive uniform-budget tests passed.");
