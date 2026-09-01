import { createGame } from "../runtime/index.js";
import { TRANSFORM, Transform } from "../runtime/components/Transform.js";
import { RIGIDBODY_2D, Rigidbody2D, BodyType } from "../runtime/components/Rigidbody2D.js";
import { COLLIDER_2D, Collider2D } from "../runtime/components/Collider2D.js";
import { CHARACTER_CONTROLLER, CharacterController, ControllerType } from "../runtime/components/CharacterController.js";

const CASES = [
  { id: "single-reset", title: "Single jump → land → single jump", status: "pending" },
  { id: "double-reset", title: "Double jump → land → jump again", status: "pending" },
  { id: "midair-limit", title: "Third jump while airborne is blocked", status: "pending" },
];

const els = {
  scene: document.getElementById("scene"),
  summary: document.getElementById("summary"),
  cases: document.getElementById("cases"),
  telemetry: document.getElementById("telemetry"),
};

function renderCases() {
  els.cases.innerHTML = CASES.map(c => `
    <div class="case ${c.status}">
      <h2>${c.title} — <span class="badge ${c.status}">${c.status.toUpperCase()}</span></h2>
      <p>${c.detail || ""}</p>
    </div>`).join("");
}

function summary(text, cls="pending") {
  els.summary.className = cls;
  els.summary.textContent = text;
}

function log(line) {
  els.telemetry.textContent += line + "\n";
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function spawn(world) {
  const floor = world.createEntity("JumpTestFloor", "Test");
  floor.addComponent(TRANSFORM, new Transform({ x: 240, y: 360 }));
  floor.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: BodyType.STATIC, simulated: true }));
  floor.addComponent(COLLIDER_2D, new Collider2D({ width: 480, height: 40 }));

  const player = world.createEntity("JumpTestPlayer", "Test");
  player.addComponent(TRANSFORM, new Transform({ x: 240, y: 280 }));
  const rb = new Rigidbody2D({
    bodyType: BodyType.DYNAMIC,
    simulated: true,
    lockRotation: true,
    gravityScale: 1,
    friction: 0,
    restitution: 0,
  });
  const cc = new CharacterController({
    controllerType: ControllerType.PLATFORMER,
    moveSpeed: 0,
    acceleration: 20,
    airControl: 0,
    canJump: true,
    jumpForce: 420,
    maxJumps: 2,
    useGravity: true,
    useDefaultInput: false,
  });
  player.addComponent(RIGIDBODY_2D, rb);
  player.addComponent(COLLIDER_2D, new Collider2D({ width: 32, height: 40 }));
  player.addComponent(CHARACTER_CONTROLLER, cc);
  return { floor, player, rb, cc };
}

async function bootGame() {
  const app = new PIXI.Application({ width: 520, height: 420, backgroundColor: 0x111822, antialias: true, resolution: 1 });
  els.scene.appendChild(app.view);
  const game = createGame({ pixiApp: app, followMainCamera: false });
  const physics = game.world.systems.find(s => s.constructor.name === "PhysicsSystem");
  await physics.physicsWorld.whenReady();
  return game;
}

async function run() {
  renderCases();
  const game = await bootGame();
  const world = game.world;
  world.clear();
  const { player, rb, cc } = spawn(world);
  const tf = player.getComponent(TRANSFORM);

  let elapsed = 0;
  let frame = 0;
  let lastT = performance.now();
  let state = "boot";
  let groundedFrames = 0;
  let airborneFrames = 0;

  const maxWait = 20;

  const step = (dt) => {
    dt = Math.min(1/30, Math.max(1/120, dt));
    world.update(dt);
    elapsed += dt;
    frame++;
    if (rb.grounded) { groundedFrames++; airborneFrames = 0; } else { airborneFrames++; groundedFrames = 0; }
    if (frame % 15 === 0) log(`t=${elapsed.toFixed(2)} y=${tf.y.toFixed(1)} vy=${rb.velocityY.toFixed(1)} grounded=${rb.grounded} jumps=${world.systems.find(s=>s.constructor.name==='ControllerSystem')?._jumpsUsed?.get(player.id) ?? "?"}`);
  };

  const waitUntil = async (predicate, timeout=6) => {
    return new Promise(resolve => {
      const started = elapsed;
      let last = performance.now();
      function tick(now) {
        const dt = (now-last)/1000; last=now;
        step(dt);
        if (predicate()) return resolve(true);
        if (elapsed-started >= timeout) return resolve(false);
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  };

  // Settle onto the floor.
  summary("Waiting for initial landing…");
  const initialLand = await waitUntil(() => rb.grounded && elapsed > 0.15, 5);
  if (!initialLand) throw new Error("Player never reached grounded state.");
  log("Initial landing confirmed.");

  const doJump = (label) => {
    cc.requestJump = true;
    // exactly one engine frame consumes the request
    let last = performance.now();
    return new Promise(resolve => requestAnimationFrame(now => {
      step((now-last)/1000);
      log(`${label}: requestJump consumed; vy=${rb.velocityY.toFixed(1)}`);
      resolve(rb.velocityY);
    }));
  };

  // CASE 1: one jump, land, one jump again.
  summary("Running case 1/3…");
  const vy1 = await doJump("single jump #1");
  const leftAir1 = await waitUntil(() => !rb.grounded && airborneFrames > 2, 2);
  const land1 = await waitUntil(() => rb.grounded && airborneFrames === 0, 5);
  const vy2 = await doJump("single jump #2 after landing");
  const pass1 = vy1 < -50 && leftAir1 && land1 && vy2 < -50;
  CASES[0].status = pass1 ? "pass" : "fail";
  CASES[0].detail = pass1
    ? `Both jumps launched (vy ${vy1.toFixed(0)} / ${vy2.toFixed(0)}) after a real landing reset.`
    : `Expected two launches with a landing between them; got vy ${vy1.toFixed(0)} then ${vy2.toFixed(0)}, landing=${land1}.`;
  renderCases();

  // Land before the double-jump test.
  await waitUntil(() => rb.grounded && airborneFrames === 0, 5);

  // CASE 2: double jump, land, then jump again.
  summary("Running case 2/3…");
  const d1 = await doJump("double jump #1");
  await waitUntil(() => !rb.grounded && airborneFrames > 2, 2);
  const d2 = await doJump("double jump #2 mid-air");
  const beforeLanding = !rb.grounded;
  const dland = await waitUntil(() => rb.grounded && airborneFrames === 0, 6);
  const d3 = await doJump("jump after double-jump landing");
  const pass2 = d1 < -50 && d2 < -50 && beforeLanding && dland && d3 < -50;
  CASES[1].status = pass2 ? "pass" : "fail";
  CASES[1].detail = pass2
    ? `Two airborne jumps worked, then the allowance reset on landing and a new jump launched (vy ${d3.toFixed(0)}).`
    : `Double-jump cycle failed: ${[d1,d2,d3].map(v=>v.toFixed(0)).join(" / ")}, landing=${dland}.`;
  renderCases();

  await waitUntil(() => rb.grounded && airborneFrames === 0, 6);

  // CASE 3: two jumps max while airborne; third is blocked.
  summary("Running case 3/3…");
  const m1 = await doJump("limit test #1");
  await waitUntil(() => !rb.grounded && airborneFrames > 2, 2);
  const m2 = await doJump("limit test #2");
  const yBeforeThird = tf.y;
  const vyBeforeThird = rb.velocityY;
  const m3 = await doJump("limit test #3 (must be blocked)");
  const yAfterThird = tf.y;
  const thirdBlocked = !(m3 < -50) && !(yAfterThird < yBeforeThird - 8);
  const pass3 = m1 < -50 && m2 < -50 && thirdBlocked && !rb.grounded;
  CASES[2].status = pass3 ? "pass" : "fail";
  CASES[2].detail = pass3
    ? `Third mid-air request was blocked; vertical state remained around vy ${vyBeforeThird.toFixed(0)} → ${m3.toFixed(0)}.`
    : `Third airborne jump was not blocked (vy ${vyBeforeThird.toFixed(0)} → ${m3.toFixed(0)}, y ${yBeforeThird.toFixed(1)} → ${yAfterThird.toFixed(1)}).`;
  renderCases();

  const failed = CASES.filter(c => c.status === "fail");
  summary(failed.length ? `${failed.length} TEST(S) FAILED` : "ALL 3 TESTS PASS", failed.length ? "fail" : "pass");
  window.__jumpRegression = { ok: failed.length === 0, cases: CASES };
  log(`RESULT: ${failed.length ? "FAIL" : "PASS"}`);
  log(`Tip: the important path is single → land → jump, and double → land → jump.`);
}

run().catch(err => {
  console.error(err);
  summary("TEST ERROR — see telemetry/console", "fail");
  log(String(err?.stack || err));
  window.__jumpRegression = { ok: false, error: String(err?.stack || err) };
});
