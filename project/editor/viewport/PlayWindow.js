/**
 * editor/viewport/PlayWindow.js
 *
 * "Play" opens a real, independent runtime instance in a separate
 * browser popup window (editor/viewport/play-popup.html +
 * play-popup.js), sized to the Main Camera's exact export resolution
 * via runtime/core/CameraUtils.js — the SAME function the editor's
 * CameraGizmo.js uses to draw the camera frame, so the gizmo's edges in
 * the Scene view are exactly what play mode (and a real export) shows.
 *
 * The popup boots its own PIXI Application + World + createGame() from
 * runtime/index.js and loads the CURRENT in-editor scene (read straight
 * off the live game instance via getSceneData(), which is backed by
 * runtime/scene/SceneSerializer.js — no duplicate serialization logic
 * here, per RULES.txt section 6). No editor grid, no gizmos — exactly
 * the game, as it will play/export.
 */

import { CAMERA } from "../../runtime/components/Camera.js";
import { TRANSFORM } from "../../runtime/components/Transform.js";
import { getCameraResolution } from "../../runtime/core/CameraUtils.js";
import { getAllSpriteAssets, getAllFrameAssets, getAllAudioAssets } from "../../runtime/assets/AssetRegistry.js";
import { editorState, pushLog } from "../state/EditorState.js";
import { getAllScenesData } from "../../runtime/scene/SceneManager.js";
import { notifyPlayWindowChanged } from "../state/FocusScheduler.js";
import { getEngineSettings } from "../state/EngineSettings.js";
import { getNavAreaNames } from "../state/NavAreas.js";

let playWin = null;

export function isPlayWindowOpen() {
  return !!(playWin && !playWin.closed);
}

/**
 * Raw popup window reference, for FocusScheduler.js's focus polling.
 * A thin getter rather than exporting `playWin` directly so callers
 * always see the current value (a plain re-exported binding would work
 * too under ES modules' live-binding semantics, but a function makes
 * that intent explicit and matches the () => Window|null shape
 * initFocusScheduler() expects).
 * @returns {Window|null}
 */
export function getPlayWindow() {
  return playWin;
}

/**
 * Pauses/resumes the popup's own live game loop. Safe to call whether
 * or not the popup is open — a no-op if it's closed or hasn't finished
 * booting yet (window.__zengineGame is set at the very end of
 * play-popup.js's boot, right before game.loop.start()).
 *
 * Reaches directly into playWin.__zengineGame.loop rather than going
 * through postMessage: the popup is opened with a plain relative URL
 * (./viewport/play-popup.html), so it's always same-origin and this
 * window already holds a live reference to it — no message round-trip
 * needed, and it takes effect the same tick the toolbar Pause button is
 * clicked instead of waiting a frame for a message to be delivered.
 * @param {boolean} paused
 */
export function setPlayWindowPaused(paused) {
  if (!isPlayWindowOpen()) return;
  const game = playWin.__zengineGame;
  if (!game || !game.loop) return;
  if (paused) game.loop.pause();
  else game.loop.resume();
}

export function closePlayWindow() {
  if (playWin && !playWin.closed) playWin.close();
  playWin = null;
  notifyPlayWindowChanged();
}

/**
 * Opens (or refocuses) the play popup, sized exactly to the scene's
 * Main Camera resolution, and boots an independent runtime game inside
 * it running the current scene data.
 *
 * @param {ReturnType<import('../../runtime/index.js').createGame>} game
 *   the editor's live game instance (used only to read scene data via
 *   its public getSceneData() — never mutated).
 */
export function openPlayWindow(game) {
  const world = editorState.world;
  if (!world || !game) return;

  const mainCameraEntity = world.query(TRANSFORM, CAMERA).find((e) => e.getComponent(CAMERA).isMain);
  if (!mainCameraEntity) {
    pushLog("error", "Cannot enter Play mode: scene has no Main Camera.");
    return;
  }
  const camera = mainCameraEntity.getComponent(CAMERA);
  const { width, height } = getCameraResolution(camera);
  // Save the active scene first so its data slot in SceneManager is
  // current, then capture ALL scenes (with data) — the play popup needs
  // the full list so scene.load('Name') can find scenes by name.
  game.saveActiveScene();
  const sceneData = game.getSceneData();
  const allScenes = getAllScenesData(); // [{id,name,data}] — full payloads

  // The popup boots a completely separate JS module realm (its own
  // <script type="module"> import graph), so AssetManager.js's texture
  // cache there starts EMPTY — it never sees the textures the editor
  // registered. sceneData only carries spriteKey strings, not pixels,
  // so without this the popup falls back to the pink "missing texture"
  // marker for every imported sprite. Bundling the imported assets'
  // dataUrls here lets the popup rebuild real textures from the same
  // source bytes before it loads the scene.
  const spriteAssets = [...getAllSpriteAssets(), ...getAllFrameAssets()];

  // Same reasoning as spriteAssets above: the popup's AssetManager.js
  // module realm starts with an empty audio cache, so any imported
  // audio clip must be handed over as raw dataUrls here too, or every
  // AudioSource in the popup would silently resolve to nothing and
  // never play.
  const audioAssets = getAllAudioAssets();

  // Hand the payload off through window.__ZENGINE_PLAY_PAYLOAD__ so the
  // popup (a separate document/context) can read it on load, regardless
  // of open/reuse timing. gameFps travels the same way — see
  // EngineSettings.js; play-popup.js applies it to GameLoop's
  // targetFps so the game's own frame rate is never coupled to
  // whatever the editor happens to be doing. navAreaNames is the Edit →
  // Nav Areas… name registry (see editor/state/NavAreas.js) — passed
  // through so nav.areaIndex()/nav.areaMask() resolve the same names
  // in Play mode that the editor shows everywhere else.
  window.__ZENGINE_PLAY_PAYLOAD__ = { sceneData, allScenes, width, height, spriteAssets, audioAssets, gameFps: getEngineSettings().gameFps, navAreaNames: getNavAreaNames() };

  if (isPlayWindowOpen()) {
    playWin.location.reload();
    playWin.focus();
    notifyPlayWindowChanged();
    return;
  }

  const availW = Math.max(320, (window.screen.availWidth || 1280) - 80);
  const availH = Math.max(320, (window.screen.availHeight || 800) - 120);
  const fitScale = Math.min(1, availW / width, availH / height);
  const winW = Math.round(width * fitScale);
  const winH = Math.round(height * fitScale);

  const features =
    "width=" + winW + ",height=" + winH + ",resizable=yes,scrollbars=no,status=no,toolbar=no,menubar=no,location=no";

  playWin = window.open("./viewport/play-popup.html", "zengine_play", features);
  if (!playWin) {
    pushLog("error", "Play window was blocked by the browser's popup blocker. Allow popups for this site and press Play again.");
    notifyPlayWindowChanged();
    return;
  }
  notifyPlayWindowChanged();
  // window.open() does NOT reliably hand keyboard focus to the new
  // window on every platform — on ChromeOS in particular the popup can
  // open fully rendered and running, but with focus silently left on
  // the editor window. Since ScriptAPI's keydown/keyup listeners are
  // attached to the popup's own `window`, an unfocused popup means
  // every key press is delivered to the editor instead, and scripts
  // see nothing — input.keyDown()/keyPressed() never go true even
  // though nothing is actually broken. Explicitly focus it here so
  // the very first Play press works, not just the reload path below.
  playWin.focus();

  pushLog("log", "Entered Play mode (" + camera.aspectMode + ", " + width + "x" + height + ").");
}
