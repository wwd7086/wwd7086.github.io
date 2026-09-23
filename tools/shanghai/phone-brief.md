# Phone pass for the Shanghai skyscape: brief for Claude Design

Paste this into the Claude Design project (Shanghai skyscape redesign). It asks the design to take over, natively, what wendawang.me currently patches on top of each import for phones. **Keep the desktop experience exactly as it is.** Everything below applies to touch screens and phone-shaped viewports.

## Where things stand

The site measured the scene on an M4 iMac at iPhone resolution (589×1278 canvas). Every frame draws the city twice, once for the screen and once for the river reflection. Each pass is about 5.8 M triangles and up to about 420 draw calls, with 561 materials and 69 shader programs overall. A frame takes about 42 ms when timed on its own, so a phone will run at a low frame rate and get warm. The existing auto-quality fallback only lowers the pixel ratio and the shadow-map size, which saved about 8%.

The site currently adds the following for phones. Please build these into the design so they're composed at the source:

1. **Street trees.** About 19,000 instances × 260 triangles make 4.8 M of the 5.8 M triangles per pass. They sit in three `InstancedMesh`es with `frustumCulled = false`. The site swaps in a 70-triangle tree (the same trunk plus three crowns, at icosahedron detail 0 with smoothed normals). It splits the trees into 640 m blocks with frustum culling, and uses a one-octahedron crown for blocks farther than about 1.3 km away.
2. **Reflection.** The mirror pass re-renders nearly the whole scene. On phones the site leaves trees, cars, pedestrians and any instanced prop under 12 m tall out of the reflection, and redraws the reflection every other frame. Rendering the reflection from a reduced layer (landmarks, lit facades, the sky) would be the native version.
3. **Draw calls.** This is the biggest remaining win and only the design can do it. Merge static meshes that share a material (per district is fine), and consolidate the 561 materials where they differ only in colour. Instance colour or a small palette texture can carry the variety.
4. **A phone tier.** Detect it as `(pointer: coarse)` with the screen's short side under 600 px. On that tier, start at quality 'low' with a pixel ratio of 1.25 (not 1.0) and 2048 shadows, and use about 1,400 cars and 1,000 pedestrians instead of 2,600 each.
5. **Loading.** Building the city and drawing the first frame block the main thread for about 3.4 s on the M4, and longer on phones. Please build in stages, yielding between districts, and update the loading line with progress. Compile the shaders with `renderer.compileAsync` before lifting the loading screen.
6. **Hidden tabs.** While `document.hidden` is true, keep the clock running but skip drawing. Today the page renders full frames four times a second in the background.

## Portrait framing

The tour cameras are composed for a wide screen. With a 42° vertical field of view, a 9:19.5 phone sees only about 26° across, where a laptop sees 60–70°. The opening shot loses the three supertalls, and subjects sit under the caption, which fills roughly the lower 40% of a phone screen.

For now the site widens the view per chapter and lifts the subject with an off-axis projection shift:

| Chapter | Portrait treatment |
|---|---|
| 01 序 Approach | widen to a 1.2-aspect horizontal view, lift 8% |
| 02 陆家嘴 Lujiazui | keep the tight crop: Shanghai Tower fills the frame |
| 03 东方明珠 The Pearl | widen to 1.0, lift 4% |
| 04 外滩 The Bund | widen to 1.0, lift 4% |
| 05 苏州河 Suzhou Creek | widen to 1.0, lift 4% |
| 06 渡轮 River traffic | widen to 1.2, lift 8% |
| 07 浦西 Puxi at night | widen to 1.2, lift 8% |
| 08 终 Finale | widen to 1.2, lift 6% (sky left for the fireworks) |

The native version: give each chapter optional portrait keyframes (`portrait: { from, to, fov }`), composed for a tall screen with the subject above the caption band.

## Landscape phones

A sideways phone is often a little over 720 px wide (734×343 on an iPhone 15), so it gets the desktop HUD and everything collides. The site adds a layout for `(orientation: landscape) and (max-height: 500px)`:

1. The title is compact (26 px) with no hint or compass, and the clock is 22 px.
2. The chapter list stays a column on the right, English names included, centred between the clock and the timeline.
3. The caption and card sit bottom-left, at most 46vw wide.
4. There is no keyboard legend or “?” button on touch screens.

## Touch interaction

1. **Tap vs drag.** A tap on a tower pauses the tour and opens its card (the card is allowed during the tour); closing it carries on. A tap on empty sky does nothing. Only a real drag (over 10 px) or a pinch leaves the tour, and the same gesture keeps orbiting. The drag doesn't have to be repeated.
2. **Resume.** On phones, a floating “Resume tour” pill appears whenever the tour isn't running. The one at the end of the horizontal chapter strip is off-screen.
3. **Hit areas.** Make every hit area at least 44 px without changing the look: chapter chips, play, the card's ×, and the home link. On phones the eight timeline marks sit 4–7 px apart, so they take no taps there; a tap sets the time instead.
4. **Gestures.** Use `touch-action: none` on the page, so a pinch on the text doesn't zoom it, and `pan-x` on the chapter strip. The caption lets drags through to the city.
5. **Tilt to look.** A small toggle in the timeline row drives the tour's existing mouse parallax (`par`) from device orientation. iOS asks for permission once. The parallax drifts back to however the phone is held.

## Please keep these hooks

The site's import tool (`tools/shanghai_import.py`) anchors on a few exact lines and fails loudly if they move, so a redesign is never shipped half-patched. The hooks are `window.__sky` plus the `sky:ready` event before `boot()`, `userData.tree` on the tree meshes, and the `window.__skyTier`, `__skyOnChapter` and `__skyDrawHidden` checks. If you implement any of the above natively, say which, so the site can drop its version. Please also keep `window.__step`, `__city`, `__cam`, `__scene`, `__THREE` and `__post`: the video and test tools use them.
