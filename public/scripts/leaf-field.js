(() => {
  const canvas = document.getElementById('leafCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // ── Mobile field flag ──
  // Tracked for perf gating only (DPR cap, leaf-leaf collision skip).
  // Wind sources are identical to desktop.
  const _leafFieldMQ = window.matchMedia('(max-width: 900px), (max-aspect-ratio: 4/5)');
  let IS_MOBILE_FIELD = _leafFieldMQ.matches;
  const _onLeafMQ = () => { IS_MOBILE_FIELD = _leafFieldMQ.matches; };
  if (_leafFieldMQ.addEventListener) _leafFieldMQ.addEventListener('change', _onLeafMQ);
  else if (_leafFieldMQ.addListener) _leafFieldMQ.addListener(_onLeafMQ);
  window.addEventListener('orientationchange', _onLeafMQ);

  // ── Wind cone — gentle, mostly omnidirectional puff with a slight
  //    forward boost so cursor movement still has direction. Soft. ──
  // Cursor "leaf blower" strength. Bumped from 380/280 → 480/520 so
  // moving the cursor near the falling leaves visibly shoves them
  // around — feels like a real blower jet, not a faint breeze.
  const WIND_RADIUS       = 480;
  const WIND_BASE_POWER   = 520;
  const WIND_FALLOFF_POW  = 1.4;

  // ── Cursor smoothing ──
  const CURSOR_VEL_SMOOTH = 10;
  const CURSOR_VEL_DECAY  = 1.3;
  const DIR_LATCH_SPEED   = 25;

  // ── Ambient breeze ──
  // The always-on layered-sine swirl. Tuned to be felt but never dominant —
  // strong enough to make leaves drift sideways and slow their fall, but
  // unable to lift them on its own. Real lift comes from gusts.
  const AMBIENT_LEAF_GAIN_BASE = 32;

  // ── Leaves ──
  // Target on-screen population. As leaves blow off the page they're
  // despawned and replacements drift in from a random edge, so the count
  // hovers around this number rather than ever-growing.
  // Population is policed each frame: if it drops below MIN, an emergency
  // gust fires and tops the count back up to TARGET. The entry sequence
  // takes the page from 0 → ENTRY_TARGET in soft batches; only after that
  // does the watchdog take over.
  // Mobile gets a much denser pile + heavier gravity so leaves rain down
  // faster and fill the small canvas. Per-leaf cost is already trimmed on
  // mobile (no multiply blend, no ambient sine, no leaf-leaf collisions),
  // so the higher count fits the frame budget.
  // Mobile counts trimmed: walls now keep leaves on-page (no blow-off
  // attrition) so the high counts that compensated are no longer needed.
  // Lighter pile = more frame budget for realistic flutter physics.
  const MIN_LEAVES        = IS_MOBILE_FIELD ? 80  : 100;
  const TARGET_LEAVES     = IS_MOBILE_FIELD ? 110 : 135;
  const MAX_LEAVES        = IS_MOBILE_FIELD ? 140 : 160;
  const ENTRY_TARGET      = IS_MOBILE_FIELD ? 120 : 145;
  const ESCAPE_MARGIN     = 120;
  const LEAF_SCALE_MIN    = 0.055;
  const LEAF_SCALE_MAX    = 0.095;
  // Higher drag → leaves catch the air properly. Without enough drag, gusts
  // can't lift them and the descent has no flutter — it's a stone, not a
  // leaf. With drag this high, terminal velocity is set by g/k below.
  const LEAF_DRAG         = 2.2;
  const LEAF_WIND_GAIN    = 4.2;
  const LEAF_REST_SPEED   = 3;
  const LEAF_MASS_MIN     = 0.7;
  const LEAF_MASS_MAX     = 1.5;
  // Per-leaf angular drag — some leaves spin lazily, others snap quickly
  const LEAF_ANG_DRAG_MIN = 0.8;
  const LEAF_ANG_DRAG_MAX = 2.5;
  // Gravity — the dominant ever-present force. With LEAF_DRAG=2.2 this
  // sets terminal velocity at ~73 px/s: a clearly visible falling leaf
  // that flutters rather than plummets. Wind doesn't fight gravity by
  // standing still against it; it arrives in gusts that briefly overcome
  // it, then leaves fall again. No constant updraft — that's not how
  // air works.
  // Mobile gravity matches desktop now — the previous 2.4× boost was
  // there to push the high mobile pile down faster, but it produced a
  // streaky "rain" effect rather than realistic falling-leaf physics.
  // With the trimmed mobile counts and added flutter, normal gravity
  // gives a believable terminal velocity (~73 px/s).
  const LEAF_GRAVITY      = 160;

  // ── Ground physics — leaves rest at the bottom and visually flatten ──
  // GROUND_INSET sets where the floor sits (px above the very bottom).
  // GROUND_FLATTEN is the y-scale reduction at full landing — leaves squash
  // to ~45% of their height to read as "lying flat from a top-down angle".
  const GROUND_INSET      = 22;
  const GROUND_FLATTEN    = 0.55;
  const GROUND_LAND_TIME  = 0.45;
  const GROUND_FRICTION   = 2.5;
  const GROUND_ROT_DAMP   = 4.0;

  // ── Ground-skimming gust — every 10–22s a horizontal gust scoots along
  //    the floor, lifting nearby resting leaves into the air. Only affects
  //    leaves within GROUND_GUST_REACH px of the floor. ──
  const GROUND_GUST_INTERVAL_MIN = 10000;
  const GROUND_GUST_INTERVAL_MAX = 22000;
  const GROUND_GUST_REACH        = 90;
  const GROUND_GUST_HORIZ        = 130;
  const GROUND_GUST_LIFT         = 90;
  const GROUND_GUST_DECAY_RATE   = 0.5;

  // ── Walls (stage edges) ──
  const WALL_RESTITUTION = 0.40;
  const WALL_FRICTION    = 0.18;
  const WALL_SPIN_GAIN   = 0.0008;
  const WALL_PILE_RANGE  = 28;
  const WALL_PILE_DAMP   = 0.85;

  // ── Periodic gusts — gentle pulse every 7–13s, each spawning a small
  //    batch at the upwind edge. New leaves drift in slowly, not streak. ──
  const GUST_INTERVAL_MIN = 7000;
  const GUST_INTERVAL_MAX = 13000;
  // Powers tuned against LEAF_GRAVITY=160 + LEAF_DRAG=2.2 — a peak gust
  // produces enough acceleration to clearly overcome gravity and lift
  // leaves into a swirl, then decays so they fall back.
  const GUST_POWER_MIN    = 200;
  const GUST_POWER_MAX    = 360;
  const GUST_DECAY_RATE   = 0.6;
  const GUST_SPAWN_COUNT  = 8;
  const GUST_SPAWN_VEL_MIN = 18;
  const GUST_SPAWN_VEL_MAX = 45;

  // ── Continuous "weather wind" — a soft global breeze, drifting in
  //    direction and strength every 8–18s. Quiet, naturalistic. ──
  const WEATHER_SHIFT_MIN  = 8000;
  const WEATHER_SHIFT_MAX  = 18000;
  // Stronger baseline so the "always-on breeze" is felt as real wind
  // rather than a faint drift. Still well under gravity, so it can't
  // levitate a leaf — it just shapes the trajectory.
  const WEATHER_SPEED_MIN  = 8;
  const WEATHER_SPEED_MAX  = 28;
  const WEATHER_LERP_DIR   = 0.4;
  const WEATHER_LERP_SPD   = 0.3;

  // ── BIG horizontal gust — every ~30–60s, a moderate left→right or
  //    right→left sweep. Long-lasting but not violent. ──
  const BIG_GUST_INTERVAL_MIN = 30000;
  const BIG_GUST_INTERVAL_MAX = 60000;
  // The big-gust event needs to clearly toss leaves up against gravity.
  // At full power against g=160/k=2.2 it lifts at ~170 px/s — a real
  // whoosh — then decays slowly so leaves swirl down through the air.
  const BIG_GUST_POWER_MIN    = 320;
  const BIG_GUST_POWER_MAX    = 520;
  const BIG_GUST_DECAY_RATE   = 0.22;
  const BIG_GUST_SPAWN_COUNT  = 14;
  const BIG_GUST_SPAWN_VEL_MIN = 30;
  const BIG_GUST_SPAWN_VEL_MAX = 70;

  // ── Leaf-on-leaf collisions ──
  const LEAF_LEAF_BOUNCE = 0.5;
  const LEAF_RADIUS_FACT = 0.30;   // collision radius = max(w,h) × this

  // ── Edge fade ──
  const EDGE_FADE_PX     = 24;

  // ── Drop shadow under each leaf ──
  const SHADOW_OFFSET_X  = 3;
  const SHADOW_OFFSET_Y  = 5;
  const SHADOW_ALPHA     = 0.13;

  // ── Orientation flip (periodic edge-on collapse) ──
  const FLIP_RATE_MIN    = 0.4;    // rad/s
  const FLIP_RATE_MAX    = 1.6;
  const FLIP_MIN_SCALE   = 0.15;

  // ── Per-page weather (scales ambient — gusts now fire on every page) ──
  const PAGE_WEATHER = {
    'home':       { ambient: 1.0,  gustChance: 1.0 },
    'about':      { ambient: 0.85, gustChance: 1.0 },
    'services':   { ambient: 0.9,  gustChance: 1.0 },
    'contact':    { ambient: 0.7,  gustChance: 1.0 },
    'shop':       { ambient: 0.85, gustChance: 1.0 },
    'blog':       { ambient: 0.85, gustChance: 1.0 },
    'podcast':    { ambient: 0.8,  gustChance: 1.0 },
    'latelier':   { ambient: 0.85, gustChance: 1.0 },
    'generator':  { ambient: 0.9,  gustChance: 1.0 },
    'map':        { ambient: 0.9,  gustChance: 1.0 },
  };

  // ── Autumn palette PER SPECIES (oak, maple, rowan, fig, flower) ──
  const SPECIES_PALETTES = [
    // ── Palette index aligned to leafImages index — was the root cause
    //    of the "no variety" issue: the silhouettes in leafImages are
    //    [maple, oak, fig, flower] but this list used to start with
    //    "oak" then "maple", so the maple silhouette was being tinted
    //    with oak russet, fig with rowan yellow, etc. The colours were
    //    fighting the shapes and the species blurred together. Fixed
    //    order matches leafImages exactly so each leaf shape gets its
    //    intended palette and the four species read as clearly distinct.
    // 0 — maple (leaf 1.png) — scarlet/orange
    ['#a83320', '#8a2018', '#c25a2a', '#d27b30', '#7a3018'],
    // 1 — oak (leaf 2.png) — russet/burgundy
    ['#8a3a1c', '#6a2618', '#a3502a', '#5a2218', '#7a4a22'],
    // 2 — fig (leaf 4.png) — mossy green-brown
    ['#4a4a22', '#6a5a2a', '#3a3a18', '#5a4a22', '#6a4a18'],
    // 3 — flower (Screenshot copy) — pinkish/cream
    ['#c98591', '#a37a6a', '#8a5a4a', '#b09a8a', '#9a6a7a'],
  ];

  // Mobile palette — single moss green (with tight tonal variation so the
  // pile doesn't read as a flat sticker). Replaces the per-species autumn
  // palettes on phones so every leaf reads as one species.
  const MOSS_PALETTE = ['#2F4030', '#374A35', '#28391F', '#3F5640', '#1F2E1F'];

  // Canvas covers the full viewport (sibling of stage-shell). W/H are the
  // viewport pixel dimensions; the only "wall" is the screen edge.
  let W = innerWidth, H = innerHeight;
  // Cap DPR at 2 on mobile — iPhone runs at 3, which triples fillrate cost
  // for no perceptible quality gain on alpha-blended leaf silhouettes.
  const _isMobileDpr = window.matchMedia('(max-width: 900px), (max-aspect-ratio: 4/5)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, _isMobileDpr ? 2 : 3);

  function resize() {
    W = innerWidth;
    H = innerHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Cursor uses raw client coords — canvas is full-viewport so no scaling.
  const cursor = {
    x: innerWidth / 2,  y: innerHeight / 2,
    lastX: innerWidth / 2, lastY: innerHeight / 2,
    vx: 0, vy: 0,
    speed: 0,
    dirX: 1, dirY: 0,
    active: true,
  };

  addEventListener('pointermove', (e) => {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
  });

  // Click-to-spawn — drops a leaf at the cursor and lets gravity pull it
  // straight down to the bottom of the page. pureGravity skips ambient
  // breeze / weather / gusts so the click reads as "pluck a leaf and let
  // it fall". Each click cycles to the NEXT leaf species (leaf 1 → 2 →
  // 4 → 1 → …), so the user can see the variance build up as they click.
  // Cycle skips the flower species so the deployer is leaves-only.
  const CLICK_LEAF_SPECIES = [0, 1, 2];
  let clickLeafCursor = 0;

  // Ambient / edge / gust leaves cycle through the same three real leaves
  // (skipping the flower silhouette) so they're equally present on the
  // page. Round-robin distribution, not random — random selection over
  // an array of three is too clumpy on a population of ~150 leaves, and
  // the user reads the result as "all one type". We also skip any species
  // whose silhouette image hasn't decoded yet, otherwise its leaves would
  // render invisibly until upgrade() runs.
  const AMBIENT_LEAF_SPECIES = [0, 1, 2];
  let ambientCursor = 0;
  function pickAmbientSpecies() {
    for (let i = 0; i < AMBIENT_LEAF_SPECIES.length; i++) {
      const candidate = AMBIENT_LEAF_SPECIES[(ambientCursor + i) % AMBIENT_LEAF_SPECIES.length];
      if (leafImages[candidate]) {
        ambientCursor = (AMBIENT_LEAF_SPECIES.indexOf(candidate) + 1) % AMBIENT_LEAF_SPECIES.length;
        return candidate;
      }
    }
    return AMBIENT_LEAF_SPECIES[0];
  }
  function spawnClickLeafAt(x, y) {
    // Find the next species in the cycle whose silhouette has loaded.
    // (A leaf with an unloaded image renders as nothing.)
    let speciesIdx = -1;
    for (let i = 0; i < CLICK_LEAF_SPECIES.length; i++) {
      const candidate = CLICK_LEAF_SPECIES[(clickLeafCursor + i) % CLICK_LEAF_SPECIES.length];
      if (leafImages[candidate]) {
        speciesIdx = candidate;
        clickLeafCursor = (CLICK_LEAF_SPECIES.indexOf(candidate) + 1) % CLICK_LEAF_SPECIES.length;
        break;
      }
    }
    if (speciesIdx < 0) return;

    const leaf = new Leaf(speciesIdx);
    leaf.x = x + (Math.random() - 0.5) * 6;
    leaf.y = y + (Math.random() - 0.5) * 4;
    leaf.vx = 0;
    leaf.vy = 0;
    leaf.scale = LEAF_SCALE_MIN +
                 Math.random() * (LEAF_SCALE_MAX - LEAF_SCALE_MIN);
    // pureGravity: ignore ambient breeze, weather wind, and gusts so the
    // leaf falls straight down to the bottom of the page where it lands
    // on the virtual floor. Cursor wind still applies (the leaf blower
    // can shoo it around mid-fall).
    leaf.pureGravity = true;
    leaves.push(leaf);
    if (leaves.length > MAX_LEAVES + 8) leaves.shift();
  }

  // ~80ms between drops feels like a steady stream without flooding the
  // screen. Tracked per active pointer so multi-touch (or stray pointers)
  // doesn't desync.
  const STREAM_INTERVAL_MS = 80;
  const activeStreams = new Map(); // pointerId → intervalId

  function isLeafSpawnTarget(t) {
    if (!t || !t.closest) return false;
    return !t.closest(
      'a, button, input, textarea, select, label, [role="button"], [data-link]'
    );
  }

  // Click-to-drop and hold-for-stream were turned off — they read as a
  // gimmick that gets in the way of taps on real interactive elements.
  // The ambient/gust/wind leaf system below is still active.
  function endStream(e) {
    const id = activeStreams.get(e.pointerId);
    if (id != null) {
      clearInterval(id);
      activeStreams.delete(e.pointerId);
    }
  }
  addEventListener('blur', () => {
    for (const id of activeStreams.values()) clearInterval(id);
    activeStreams.clear();
  });

  // ── Modal / popup detection ──
  // While a modal is open, the cursor wind is suppressed so the popup
  // contents don't get rained on.
  function isModalOpen() {
    const cls = document.body.className || '';
    return /\b(blog-popup-open|ios-popup-open|popup-open|modal-open)\b/.test(cls);
  }

  // ── Active page detection ──
  function getActivePageId() {
    const active = document.querySelector('.page.active');
    return active ? active.id : 'home';
  }
  function getPageWeather() {
    return PAGE_WEATHER[getActivePageId()] || { ambient: 0.8, gustChance: 0.6 };
  }

  // ── UI catch zones — disabled. Leaves pass freely through every UI
  //    element (menu, logo, footer). The list stays empty so the per-leaf
  //    collision loop is a no-op. ──
  let uiRects = [];
  function refreshUIRects() { uiRects = []; }

  // Layered-sine ambient breeze field — sampled per leaf at its position
  function ambientWindAt(x, y, t) {
    const ax =
      Math.sin(x * 0.0036 + t * 0.45) +
      Math.sin(x * 0.0017 + t * 0.71 + 1.7) +
      Math.sin(t * 0.13 + y * 0.001);
    const ay =
      Math.sin(y * 0.0042 + t * 0.50 + 2.1) +
      Math.sin(y * 0.0019 + t * 0.33) +
      Math.cos(t * 0.11 + x * 0.0008 + 1.2);
    return { x: ax * 0.45, y: ay * 0.45 };
  }

  // Cursor wind — like a real leaf blower jet.
  //   • Force is applied IN the cursor's travel direction (not radially
  //     outward) — so leaves get pushed forward, not radiating in a circle.
  //   • Strength curve: forwardDot³ — a sharp directional cone. Forward
  //     gets full power, sides drop off fast, behind gets a tiny baseline.
  // Suppressed while a modal/popup is open.
  let cursorDisabled = false;
  function windAt(x, y) {
    if (!cursor.active || cursorDisabled) return { fx: 0, fy: 0 };
    const dx = x - cursor.x;
    const dy = y - cursor.y;
    const dist = Math.hypot(dx, dy);
    if (dist > WIND_RADIUS || dist < 0.5) return { fx: 0, fy: 0 };
    const invD = 1 / dist;
    const ndx = dx * invD;
    const ndy = dy * invD;
    const fwdDot = ndx * cursor.dirX + ndy * cursor.dirY;
    // Mostly radial outward, with a gentle forward boost. Sides/back still
    // get ~70% of the strength so the cursor reads as "pushing air all
    // around it" rather than a tight directional jet.
    const directional = 0.7 + 0.3 * Math.max(0, fwdDot);
    const tt = 1 - dist / WIND_RADIUS;
    const falloff = Math.pow(tt, WIND_FALLOFF_POW);
    const magnitude = WIND_BASE_POWER * directional * falloff;
    // Force RADIALLY OUTWARD from the cursor (every direction) — air
    // dispersing, not a directed jet.
    return { fx: ndx * magnitude, fy: ndy * magnitude };
  }

  // (Shake + pull-to-refresh gusts are wired up further down — see the
  // MOBILE SENSORY LAYER block near the bottom of this script.)

  // ── Continuous weather wind state ──
  let weatherAngle       = Math.random() * Math.PI * 2;
  let weatherSpeed       = WEATHER_SPEED_MIN;
  let weatherTargetAngle = weatherAngle;
  let weatherTargetSpeed = WEATHER_SPEED_MIN + Math.random() *
                           (WEATHER_SPEED_MAX - WEATHER_SPEED_MIN);
  let nextWeatherShift   = performance.now() + 4000;

  function updateWeather(now, dt) {
    if (now >= nextWeatherShift) {
      // Pick a new prevailing-wind target — direction and strength
      weatherTargetAngle = Math.random() * Math.PI * 2;
      weatherTargetSpeed = WEATHER_SPEED_MIN +
                           Math.random() * (WEATHER_SPEED_MAX - WEATHER_SPEED_MIN);
      nextWeatherShift = now + WEATHER_SHIFT_MIN +
                         Math.random() * (WEATHER_SHIFT_MAX - WEATHER_SHIFT_MIN);
    }
    // Smoothly interpolate angle the short way around the circle
    let angDelta = weatherTargetAngle - weatherAngle;
    while (angDelta >  Math.PI) angDelta -= Math.PI * 2;
    while (angDelta < -Math.PI) angDelta += Math.PI * 2;
    weatherAngle += angDelta * Math.min(1, dt * WEATHER_LERP_DIR);
    weatherSpeed += (weatherTargetSpeed - weatherSpeed) *
                     Math.min(1, dt * WEATHER_LERP_SPD);
  }

  // ── Periodic gust ──
  let gustVx = 0, gustVy = 0, gustDecay = 0;
  let nextGustTime = performance.now() + GUST_INTERVAL_MIN;

  // ── Big horizontal gust ──
  let bigGustVx    = 0;
  let bigGustDecay = 0;
  let nextBigGustTime = performance.now() + 8000;

  // ── Ground-skimming gust ──
  let groundGustVx     = 0;
  let groundGustDecay  = 0;
  let nextGroundGustTime = performance.now() + 6000;
  function maybeStartGroundGust(now) {
    if (now < nextGroundGustTime) return;
    const dir = Math.random() < 0.5 ? -1 : 1;
    groundGustVx    = dir * GROUND_GUST_HORIZ;
    groundGustDecay = 1.0;
    nextGroundGustTime = now + GROUND_GUST_INTERVAL_MIN +
                         Math.random() * (GROUND_GUST_INTERVAL_MAX - GROUND_GUST_INTERVAL_MIN);
  }
  function maybeStartBigGust(now) {
    if (now < nextBigGustTime) return;
    const dir = Math.random() < 0.5 ? -1 : 1;       // L←R  or  L→R
    const power = BIG_GUST_POWER_MIN +
                  Math.random() * (BIG_GUST_POWER_MAX - BIG_GUST_POWER_MIN);
    bigGustVx    = dir * power;
    bigGustDecay = 1.0;
    // Dump fresh leaves at the upwind edge so they visibly ride across
    const upwindX = dir > 0 ? -ESCAPE_MARGIN * 0.4 : W + ESCAPE_MARGIN * 0.4;
    for (let i = 0; i < BIG_GUST_SPAWN_COUNT; i++) {
      if (leaves.length >= MAX_LEAVES) break;
      const speciesIdx = pickAmbientSpecies();
      const leaf = new Leaf(speciesIdx);
      leaf.x = upwindX;
      leaf.y = Math.random() * H;
      leaf.vx = dir * (BIG_GUST_SPAWN_VEL_MIN +
                       Math.random() * (BIG_GUST_SPAWN_VEL_MAX - BIG_GUST_SPAWN_VEL_MIN));
      leaf.vy = (Math.random() - 0.5) * 20;
      leaves.push(leaf);
    }
    nextBigGustTime = now + BIG_GUST_INTERVAL_MIN +
                      Math.random() * (BIG_GUST_INTERVAL_MAX - BIG_GUST_INTERVAL_MIN);
  }

  // ── Entry sequence ──
  // On site open, leaves blow in INDIVIDUALLY from random edges every few
  // frames — no synchronised batches. Probabilistic spawn at ~ENTRY_RATE
  // leaves/sec means arrivals are randomly distributed in time. Reaches
  // ENTRY_TARGET in ~3–4 seconds and starts immediately.
  const ENTRY_RATE   = 140;           // leaves per second on average — fills the page in well under 1s
  let imagesReady    = false;
  let entryActive    = true;
  function maybeEntrySpawn(now, dt) {
    if (!entryActive || !imagesReady) return;
    if (leaves.length >= ENTRY_TARGET) { entryActive = false; return; }
    // Expected spawns this frame; integer part + probabilistic remainder.
    const expected = ENTRY_RATE * dt;
    let n = Math.floor(expected);
    if (Math.random() < expected - n) n++;
    for (let i = 0; i < n; i++) {
      if (leaves.length >= ENTRY_TARGET) { entryActive = false; break; }
      const fresh = spawnEdgeLeaf();
      if (fresh) leaves.push(fresh);
    }
  }

  // ── Pre-emptive population gust ──
  // Whenever the on-screen count drops below MIN_LEAVES, fire a gust from
  // a random direction (favouring horizontal sweeps) and dump enough fresh
  // leaves at the upwind edge to bring the count back to TARGET_LEAVES.
  // Gated on imagesReady AND off during the entry sequence so the entry
  // never gets short-circuited.
  let nextEmergencyAllowed = 0;
  function triggerEmergencyGust(now) {
    if (!imagesReady) return;
    if (entryActive) return;
    if (now < nextEmergencyAllowed) return;
    if (leaves.length >= MIN_LEAVES) return;
    const need = TARGET_LEAVES - leaves.length;
    if (need <= 0) return;

    // Pick a horizontal-dominant direction (gust sweeps across the page)
    const horizontal = Math.random() < 0.78;
    let cx, cy;
    if (horizontal) {
      cx = Math.random() < 0.5 ? -1 : 1;
      cy = (Math.random() - 0.5) * 0.4;
    } else {
      cx = (Math.random() - 0.5) * 0.6;
      cy = -1;     // top-down (so leaves fall in with gravity)
    }
    const len = Math.hypot(cx, cy) || 1;
    cx /= len; cy /= len;
    const power = 110 + Math.random() * 80;
    gustVx = cx * power;
    gustVy = cy * power;
    gustDecay = 1.0;

    for (let i = 0; i < need; i++) {
      if (leaves.length >= MAX_LEAVES) break;
      const speciesIdx = pickAmbientSpecies();
      const leaf = new Leaf(speciesIdx);
      if (Math.abs(cx) > Math.abs(cy)) {
        if (cx > 0) { leaf.x = -ESCAPE_MARGIN * 0.4; leaf.y = Math.random() * H * 0.6; }
        else        { leaf.x = W + ESCAPE_MARGIN * 0.4; leaf.y = Math.random() * H * 0.6; }
      } else {
        leaf.x = Math.random() * W;
        leaf.y = -ESCAPE_MARGIN * 0.4;
      }
      // Slow drift in — gentle, gardener's-page pace
      const v = 25 + Math.random() * 45;
      leaf.vx = cx * v;
      leaf.vy = cy * v;
      leaves.push(leaf);
    }
    nextEmergencyAllowed = now + 800;   // small cooldown
  }
  function maybeStartGust(now) {
    if (now < nextGustTime) return;
    const weather = getPageWeather();
    if (Math.random() < weather.gustChance) {
      const ang = Math.random() * Math.PI * 2;
      const cx = Math.cos(ang), cy = Math.sin(ang);
      const power = GUST_POWER_MIN + Math.random() * (GUST_POWER_MAX - GUST_POWER_MIN);
      gustVx = cx * power;
      gustVy = cy * power;
      gustDecay = 1.0;
      // Spawn a fresh batch at the upwind edge so the gust visibly carries
      // new leaves into the page (and the wind pushes some old ones off).
      for (let i = 0; i < GUST_SPAWN_COUNT; i++) {
        if (leaves.length >= MAX_LEAVES) break;
        const speciesIdx = pickAmbientSpecies();
        const leaf = new Leaf(speciesIdx);
        // Pick the edge most opposite the gust direction
        if (Math.abs(cx) > Math.abs(cy)) {
          if (cx > 0) { leaf.x = -ESCAPE_MARGIN * 0.4; leaf.y = Math.random() * H; }
          else        { leaf.x = W + ESCAPE_MARGIN * 0.4; leaf.y = Math.random() * H; }
        } else {
          if (cy > 0) { leaf.x = Math.random() * W; leaf.y = -ESCAPE_MARGIN * 0.4; }
          else        { leaf.x = Math.random() * W; leaf.y = H + ESCAPE_MARGIN * 0.4; }
        }
        const v = GUST_SPAWN_VEL_MIN +
                  Math.random() * (GUST_SPAWN_VEL_MAX - GUST_SPAWN_VEL_MIN);
        leaf.vx = cx * v;
        leaf.vy = cy * v;
        leaves.push(leaf);
      }
    }
    nextGustTime = now + GUST_INTERVAL_MIN +
                   Math.random() * (GUST_INTERVAL_MAX - GUST_INTERVAL_MIN);
  }

  // Leaf source PNGs — transparent-bg versions provided by Gary
  const LEAF_FILES = [
    'leaf 1.png',                                    // maple
    'leaf 2.png',                                    // oak
    'leaf 4.png',                                    // fig
    'Screenshot 2026-05-02 at 14.49.32 copy.png',    // flower
  ];
  const leafImages = [];

  // Build a line-art alpha mask from the source PNG.
  // Each pixel's alpha = how DARK it was (inverse of brightness).
  //   pure black   → fully opaque (line work shows through tint)
  //   pure white   → fully transparent (interior is EMPTY — nothing rendered)
  //   anti-aliased grey → partial alpha (smooth edges, no halo)
  // RGB normalised to white so 'destination-in' tinting can recolour freely.
  function processSilhouette(img) {
    const oc = document.createElement('canvas');
    oc.width  = img.naturalWidth;
    oc.height = img.naturalHeight;
    const octx = oc.getContext('2d');
    octx.drawImage(img, 0, 0);
    try {
      const w = oc.width, h = oc.height;
      const data = octx.getImageData(0, 0, w, h);
      const px = data.data;
      // Brightness above this is treated as fully transparent. Lower = more
      // line detail kept; higher = thinner-looking strokes.
      const WHITE_CUTOFF = 215;
      const inv = 1 / WHITE_CUTOFF;
      for (let i = 0, p = 0; i < w * h; i++, p += 4) {
        const minrgb = Math.min(px[p], px[p + 1], px[p + 2]);
        // Combine inverse-brightness with the SOURCE alpha — handles both
        // already-transparent PNGs and white-bg PNGs in one pass.
        const srcAlpha = px[p + 3] / 255;
        let a = (1 - minrgb * inv) * srcAlpha;
        if (a < 0) a = 0;
        px[p]     = 255;
        px[p + 1] = 255;
        px[p + 2] = 255;
        px[p + 3] = (a * 255) | 0;
      }
      octx.putImageData(data, 0, 0);
      return { silhouette: oc, w, h, processed: true };
    } catch (e) {
      // CORS-tainted: keep the raw image; renderer will use multiply-blend
      return { silhouette: img, w: img.naturalWidth, h: img.naturalHeight, processed: false };
    }
  }

  // Generate a per-leaf coloured canvas by stamping a colour into the
  // silhouette via 'destination-in' compositing.
  function tintSilhouette(entry, color) {
    if (!entry.processed) return entry.silhouette;
    const oc = document.createElement('canvas');
    oc.width  = entry.w;
    oc.height = entry.h;
    const octx = oc.getContext('2d');
    octx.fillStyle = color;
    octx.fillRect(0, 0, entry.w, entry.h);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(entry.silhouette, 0, 0);
    return oc;
  }

  function loadImage(src) {
    // First try the eager preloads kicked off in <head> — those have
    // typically finished by the time this script runs.
    const decoded = decodeURIComponent(src);
    const cached = (window.__leafPreloaded || {})[decoded];
    if (cached && cached.complete && cached.naturalWidth > 0) {
      return Promise.resolve(processSilhouette(cached));
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload  = () => resolve(processSilhouette(img));
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  class Leaf {
    constructor(speciesIdx) {
      this.species = speciesIdx;
      // Mobile uses the single moss palette — every leaf reads as one
      // species. Desktop keeps the per-species autumn variety.
      const palette = IS_MOBILE_FIELD
        ? MOSS_PALETTE
        : SPECIES_PALETTES[speciesIdx % SPECIES_PALETTES.length];
      this.color = palette[Math.floor(Math.random() * palette.length)];
      // Image may not be loaded yet — attach lazily. Until then we use
      // placeholder dimensions so physics/collisions still work.
      const sil = leafImages[speciesIdx];
      if (sil) {
        this.img = tintSilhouette(sil, this.color);
        this.imgW = sil.w;
        this.imgH = sil.h;
        this.usesMultiply = !sil.processed;
      } else {
        this.img = null;
        this.imgW = 220;
        this.imgH = 220;
        this.usesMultiply = false;
      }

      // Bottom-biased: ~80% of leaves start in the lower 35% of the page
      this.x = Math.random() * W;
      this.y = (Math.random() < 0.8)
        ? H * (0.65 + Math.random() * 0.35)
        : Math.random() * H * 0.65;
      this.vx = 0; this.vy = 0;
      this.rot = Math.random() * Math.PI * 2;
      this.av  = 0;
      this.scale = LEAF_SCALE_MIN + Math.random() * (LEAF_SCALE_MAX - LEAF_SCALE_MIN);
      this.mass  = LEAF_MASS_MIN  + Math.random() * (LEAF_MASS_MAX - LEAF_MASS_MIN);
      this.angDrag = LEAF_ANG_DRAG_MIN +
                     Math.random() * (LEAF_ANG_DRAG_MAX - LEAF_ANG_DRAG_MIN);
      // Periodic edge-on flip cycle — independent rate per leaf
      this.flipPhase = Math.random() * Math.PI * 2;
      this.flipRate  = FLIP_RATE_MIN +
                       Math.random() * (FLIP_RATE_MAX - FLIP_RATE_MIN);
      // Per-leaf flutter — sideways oscillation as the leaf falls. Each
      // leaf has its own phase + rate so the pile reads as many leaves
      // doing their own thing rather than one synchronised swarm.
      // Period ~0.5–1.0s = real falling-leaf bob frequency.
      this.flutterOffset = Math.random() * Math.PI * 2;
      this.flutterRate   = 6 + Math.random() * 5;
      // 0..1 — how "flat on the ground" the leaf is. Ramps up while resting
      // at the floor, ramps down if it gets blown back up by wind.
      this.groundT = 0;
    }

    get radius() {
      return Math.max(this.imgW, this.imgH) * this.scale * LEAF_RADIUS_FACT;
    }

    attachImage() {
      if (this.img) return;
      const sil = leafImages[this.species] || leafImages[0];
      if (!sil) return;
      this.img = tintSilhouette(sil, this.color);
      this.imgW = sil.w;
      this.imgH = sil.h;
      this.usesMultiply = !sil.processed;
    }

    update(dt, t, ambientMul) {
      const invM = 1 / this.mass;

      // Cursor wind ("leaf blower") — applied to EVERY leaf, including
      // click-spawned pureGravity ones. The blower is the user's main
      // tactile feedback and must never go quiet, even mid leaf-stream.
      const wind = windAt(this.x, this.y);
      const windMag = Math.hypot(wind.fx, wind.fy);
      this.vx += wind.fx * LEAF_WIND_GAIN * invM * dt;
      this.vy += wind.fy * LEAF_WIND_GAIN * invM * dt;

      // Click-spawned leaves carry pureGravity: they ignore ambient
      // breeze, weather wind, and random gusts so the click reads as
      // "pluck a leaf and let it fall straight down". Cursor wind above
      // still applies, so the leaf blower works on them too.
      if (!this.pureGravity) {
        // Ambient sine-field is the heaviest per-leaf calc (6 trig calls).
        // Skip it on mobile — weather wind + gusts already give plenty of
        // motion variety, and on a small canvas the per-cell variation is
        // imperceptible.
        if (!IS_MOBILE_FIELD) {
          const amb = ambientWindAt(this.x, this.y, t);
          this.vx += amb.x * AMBIENT_LEAF_GAIN_BASE * ambientMul * invM * dt;
          this.vy += amb.y * AMBIENT_LEAF_GAIN_BASE * ambientMul * invM * dt;
        }
        // Continuous weather wind (always on, slowly drifting direction)
        this.vx += Math.cos(weatherAngle) * weatherSpeed * dt;
        this.vy += Math.sin(weatherAngle) * weatherSpeed * dt;
        // Periodic gust pulse
        this.vx += gustVx * gustDecay * dt;
        this.vy += gustVy * gustDecay * dt;
        // Big horizontal gust — strong sustained sweep across the page
        this.vx += bigGustVx * bigGustDecay * dt;

        // Ground-skimming gust — only affects leaves within reach of the
        // floor, kicking them sideways AND lifting them into the air. Reads
        // as wind disturbing the dead-leaf pile.
        if (groundGustDecay > 0.01) {
          const groundY = H - GROUND_INSET;
          const groundDist = groundY - this.y;
          if (groundDist >= 0 && groundDist < GROUND_GUST_REACH) {
            const proximity = 1 - groundDist / GROUND_GUST_REACH;
            const factor = groundGustDecay * proximity;
            this.vx += groundGustVx * factor * dt;
            this.vy -= GROUND_GUST_LIFT * factor * dt;
          }
        }

        // Mobile flutter — sideways oscillation that gives leaves the
        // characteristic "swaying as they fall" motion. Always on (no
        // groundT gate) so leaves caught at the bottom or in corners
        // keep getting pushed sideways and don't settle.
        if (IS_MOBILE_FIELD) {
          this.vx += Math.sin(t * this.flutterRate + this.flutterOffset) * 28 * dt;
        }
      }

      // Gravity — applied every frame for every leaf, never cancelled.
      this.vy += LEAF_GRAVITY * dt;

      this.av += (Math.random() - 0.5) * windMag * 0.0002;
      this.av += (Math.random() - 0.5) * 0.0008;

      const drag    = Math.exp(-LEAF_DRAG    * dt);
      const angDrag = Math.exp(-this.angDrag * dt);
      this.vx *= drag; this.vy *= drag;
      this.av *= angDrag;

      this.x   += this.vx * dt;
      this.y   += this.vy * dt;
      this.rot += this.av * dt;
      this.flipPhase += this.flipRate * dt;

      // ── Ground physics — leaves rest on a virtual floor near the bottom
      //    of the page. While resting, they slide with friction, stop
      //    spinning, and visually flatten via groundT (handled in draw). A
      //    strong upward force can still lift them off again. ──
      // Ground-resting physics — desktop only. On mobile the bottom is
      // a wall (handled below), not a settling floor, so leaves never
      // stack or stick.
      if (!IS_MOBILE_FIELD) {
        const groundY = H - GROUND_INSET;
        if (this.y >= groundY) {
          this.y = groundY;
          if (this.vy > 0) this.vy = 0;
          this.vx *= Math.exp(-GROUND_FRICTION * dt);
          this.av *= Math.exp(-GROUND_ROT_DAMP * dt);
          this.groundT = Math.min(1, this.groundT + dt / GROUND_LAND_TIME);
        } else {
          this.groundT *= Math.exp(-3 * dt);
        }
      }

      // ── Mobile walls — all four page edges are solid on phones so
      //    leaves can't escape the canvas. Only enforced when the leaf
      //    is heading OUT (vx/vy points outward), so spawn-from-edge
      //    entry still passes through cleanly. The wall-parallel
      //    friction term is intentionally omitted: previously a leaf
      //    sliding down a side wall kept losing vy on every micro-bounce
      //    and stuck in the corner. Now bounces only flip the
      //    perpendicular component, so leaves keep falling under gravity
      //    along the wall and gusts can carry them back up and across.
      if (IS_MOBILE_FIELD) {
        const wr = Math.max(this.imgW, this.imgH) * this.scale * 0.18;
        if (this.x < wr && this.vx < 0) {
          this.x = wr;
          this.vx = -this.vx * WALL_RESTITUTION;
          this.av += (Math.random() - 0.5) * 1.2;
        } else if (this.x > W - wr && this.vx > 0) {
          this.x = W - wr;
          this.vx = -this.vx * WALL_RESTITUTION;
          this.av += (Math.random() - 0.5) * 1.2;
        }
        if (this.y < wr && this.vy < 0) {
          this.y = wr;
          this.vy = -this.vy * WALL_RESTITUTION;
          this.av += (Math.random() - 0.5) * 1.2;
        } else if (this.y > H - wr && this.vy > 0) {
          // Bottom wall — bounce instead of rest. Slightly bouncier than
          // the side walls so leaves visibly rebound off the floor and
          // get a fresh chance to be picked up by wind, rather than
          // dribbling along the bottom edge.
          this.y = H - wr;
          this.vy = -this.vy * (WALL_RESTITUTION + 0.15);
          this.av += (Math.random() - 0.5) * 1.2;
        }
        // Keep the ground-flatten visual disabled on mobile (no resting).
        this.groundT = 0;
      }

      // Page edges are open on desktop — leaves blow off-screen and get
      // despawned by the tick loop. UI rect collisions stay so leaves
      // still bounce off the logo, sidenav and footer.
      const r = this.radius;
      for (const u of uiRects) {
        const cx = Math.max(u.x, Math.min(this.x, u.x + u.w));
        const cy = Math.max(u.y, Math.min(this.y, u.y + u.h));
        const dx = this.x - cx, dy = this.y - cy;
        const d2 = dx*dx + dy*dy;
        if (d2 < r * r) {
          const d = Math.sqrt(Math.max(d2, 0.0001));
          const nx = dx / d, ny = dy / d;
          const overlap = r - d;
          this.x += nx * overlap;
          this.y += ny * overlap;
          const vn = this.vx * nx + this.vy * ny;
          if (vn < 0) {
            this.vx -= (1 + WALL_RESTITUTION) * vn * nx;
            this.vy -= (1 + WALL_RESTITUTION) * vn * ny;
            this.vx *= (1 - WALL_FRICTION);
            this.vy *= (1 - WALL_FRICTION);
            this.av += (Math.random() - 0.5) * 1.5;
          }
        }
      }

      // Rest-speed damping is desktop-only. On mobile we want leaves
      // to keep their tiny residual motion so flutter + gusts can act
      // on them, instead of being snapped to zero when slow.
      if (!IS_MOBILE_FIELD) {
        const sp = Math.hypot(this.vx, this.vy);
        if (sp < LEAF_REST_SPEED) {
          this.vx *= 0.7;
          this.vy *= 0.7;
        }
      }
    }

    draw(ctx) {
      if (!this.img) return;     // image not yet loaded — skip this frame
      const w = this.imgW * this.scale;
      const h = this.imgH * this.scale;
      const edgeDist = Math.min(this.x, this.y, W - this.x, H - this.y);
      const edgeAlpha = Math.max(0, Math.min(1, edgeDist / EDGE_FADE_PX));

      const flip = Math.cos(this.flipPhase);
      const sx = (Math.abs(flip) < FLIP_MIN_SCALE
                    ? FLIP_MIN_SCALE
                    : Math.abs(flip)) * Math.sign(flip || 1);

      // Ground squash — when groundT ramps to 1, the leaf's y-axis scale
      // collapses, so it reads as lying flat on the ground from above.
      const flatY = 1 - this.groundT * GROUND_FLATTEN;

      ctx.save();
      ctx.globalAlpha = edgeAlpha;
      // Multiply blend is a per-draw GPU state change — fine on desktop,
      // a hot-spot on mobile GPUs where it kills batching. Skip on mobile.
      if (this.usesMultiply && !IS_MOBILE_FIELD) ctx.globalCompositeOperation = 'multiply';
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot);
      ctx.scale(sx, flatY);
      ctx.drawImage(this.img, -w/2, -h/2, w, h);
      ctx.restore();
    }
  }

  // ── Leaf-on-leaf collisions (O(n²) but fine at n≤200) ──
  function leafLeafCollisions() {
    const n = leaves.length;
    for (let i = 0; i < n; i++) {
      const a = leaves[i];
      const ar = a.radius;
      for (let j = i + 1; j < n; j++) {
        const b = leaves[j];
        const br = b.radius;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minD = ar + br;
        const d2 = dx*dx + dy*dy;
        if (d2 < minD * minD && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          const overlap = (minD - d) * 0.5;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b.x += nx * overlap; b.y += ny * overlap;
          const va = a.vx * nx + a.vy * ny;
          const vb = b.vx * nx + b.vy * ny;
          if (vb < va) {
            const m1 = a.mass, m2 = b.mass;
            const jImpulse = -(1 + LEAF_LEAF_BOUNCE) * (vb - va) / (1/m1 + 1/m2);
            a.vx -= (jImpulse * nx) / m1;
            a.vy -= (jImpulse * ny) / m1;
            b.vx += (jImpulse * nx) / m2;
            b.vy += (jImpulse * ny) / m2;
            a.av += (Math.random() - 0.5) * 0.6;
            b.av += (Math.random() - 0.5) * 0.6;
          }
        }
      }
    }
  }

  const leaves = [];

  // Spawn a leaf just outside a random page edge, with velocity carrying it
  // INTO the page — replacements for leaves that have blown off-screen.
  function spawnEdgeLeaf() {
    // Pick a species slot; Leaf gracefully falls back to placeholder if
    // the silhouette image hasn't loaded yet.
    const speciesIdx = pickAmbientSpecies();
    const leaf = new Leaf(speciesIdx);
    const side = Math.floor(Math.random() * 4);
    // Faster inward velocity so leaves visibly traverse the page on
    // entry, instead of just being dragged down by gravity.
    const inward  = 70 + Math.random() * 100;     // 70–170 px/s
    const lateral = (Math.random() - 0.5) * 80;   // ±40 px/s
    if (side === 0) {                      // top edge
      leaf.x = Math.random() * W;
      leaf.y = -ESCAPE_MARGIN * 0.4;
      leaf.vx = lateral;
      leaf.vy = inward * 0.6;
    } else if (side === 1) {               // right edge
      leaf.x = W + ESCAPE_MARGIN * 0.4;
      leaf.y = Math.random() * H * 0.95;
      leaf.vx = -inward;
      leaf.vy = lateral;
    } else if (side === 2) {               // bottom edge — kicks UP into view
      leaf.x = Math.random() * W;
      leaf.y = H + ESCAPE_MARGIN * 0.4;
      leaf.vx = lateral;
      leaf.vy = -inward;
    } else {                                // left edge
      leaf.x = -ESCAPE_MARGIN * 0.4;
      leaf.y = Math.random() * H * 0.95;
      leaf.vx = inward;
      leaf.vy = lateral;
    }
    return leaf;
  }

  function spawnInitialCluster() {
    if (leaves.length > 0) return;
    // Scatter the WHOLE field across the entire viewport so the page is
    // covered in leaves from the moment it loads.
    for (let i = 0; i < TARGET_LEAVES; i++) {
      const speciesIdx = pickAmbientSpecies();
      const leaf = new Leaf(speciesIdx);
      leaf.x = Math.random() * W;
      leaf.y = Math.random() * H;
      leaf.vx = (Math.random() - 0.5) * 18;
      leaf.vy = (Math.random() - 0.5) * 18;
      leaves.push(leaf);
    }
  }

  // Load leaf silhouettes directly from the in-DOM <img> tags. Way more
  // reliable than the script-created Image() route — the HTML parser is
  // already loading them by the time this runs, and decode() resolves as
  // soon as the bitmap is ready.
  async function loadAllLeavesFromDOM() {
    const ids = ['leafSrc1', 'leafSrc2', 'leafSrc4', 'leafSrcF'];
    const out = [];
    for (const id of ids) {
      const img = document.getElementById(id);
      if (!img) continue;
      try {
        if (!img.complete) await img.decode();
      } catch (e) { /* swallow — fall through to fallback */ }
      if (img.complete && img.naturalWidth > 0) {
        const sil = processSilhouette(img);
        if (sil) out.push(sil);
      }
    }
    return out;
  }

  // Cheap silhouette stand-in: skips getImageData entirely. The renderer
  // uses 'multiply' blend on the raw image (usesMultiply=true), which
  // looks correct against the cream background and costs zero CPU.
  function rawSilhouette(img) {
    return { silhouette: img, w: img.naturalWidth, h: img.naturalHeight, processed: false };
  }

  function fireKickoff() {
    if (leafImages.length === 0) return;
    for (let i = 0; i < 70; i++) {
      const fresh = spawnEdgeLeaf();
      if (!fresh) continue;
      fresh.x += (Math.random() - 0.5) * W * 0.4;
      fresh.y += (Math.random() - 0.5) * H * 0.4;
      fresh.vx *= 1.6;
      fresh.vy *= 1.6;
      leaves.push(fresh);
    }
  }

  function init() {
    resize();
    refreshUIRects();

    // Non-negotiable: leaves must be visibly blowing onto the page within
    // ~1s of load. Strategy:
    //   1. Synchronously seed leafImages with raw <img> elements as-is —
    //      no getImageData, no async decode wait.
    //   2. Fire the kickoff burst and start the tick loop on this frame.
    //   3. Upgrade to processed silhouettes in the background on idle.
    const ids = ['leafSrc1', 'leafSrc2', 'leafSrc4', 'leafSrcF'];
    for (const id of ids) {
      const img = document.getElementById(id);
      if (img && img.complete && img.naturalWidth > 0) {
        leafImages.push(rawSilhouette(img));
      }
    }

    if (leafImages.length > 0) {
      imagesReady = true;
      fireKickoff();
      requestAnimationFrame(tick);
    } else {
      const tags = ids.map(id => document.getElementById(id)).filter(Boolean);
      requestAnimationFrame(tick);
      const seedFrom = (img) => {
        if (imagesReady || !img || !img.complete || img.naturalWidth === 0) return;
        leafImages.push(rawSilhouette(img));
        imagesReady = true;
        fireKickoff();
      };
      for (const img of tags) {
        if (img.complete) { seedFrom(img); if (imagesReady) break; }
      }
      if (!imagesReady) {
        for (const img of tags) {
          img.addEventListener('load', () => seedFrom(img), { once: true });
        }
      }
    }

    // Background upgrade — process crisper silhouettes off the critical
    // path. New leaves spawned after this completes use the upgraded
    // (line-art) silhouettes. Existing leaves get re-tinted in place so
    // mobile's moss palette applies from the moment processing finishes
    // (otherwise the kickoff burst would hold raw photo colours until
    // each leaf naturally got recycled).
    const upgrade = () => {
      for (let i = 0; i < ids.length; i++) {
        const img = document.getElementById(ids[i]);
        if (!img || !img.complete || img.naturalWidth === 0) continue;
        const sil = processSilhouette(img);
        if (sil && sil.processed) leafImages[i] = sil;
        else if (sil && !leafImages[i]) leafImages[i] = sil;
      }
      // Re-tint any leaves already on the page so they pick up the
      // processed silhouette (and on mobile, the moss palette) instead
      // of waiting to be recycled.
      for (const l of leaves) {
        const sil = leafImages[l.species];
        if (!sil) continue;
        l.img = tintSilhouette(sil, l.color);
        l.imgW = sil.w;
        l.imgH = sil.h;
        l.usesMultiply = !sil.processed;
      }
    };
    // Mobile: run the upgrade synchronously so the kickoff leaves render
    // moss-tinted on the first paint instead of flashing raw photo
    // colours for ~100ms (mobile skips multiply blend, so raw silhouettes
    // would show as full-colour leaf photos until processing landed).
    // Desktop keeps the idle-time path — its multiply-blend rendering of
    // raw silhouettes already looks tinted, so there's no flash.
    if (IS_MOBILE_FIELD) {
      upgrade();
    } else if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(upgrade, { timeout: 2000 });
    } else {
      setTimeout(upgrade, 250);
    }
  }

  let lastT = performance.now();
  let uiRefreshT = 0;
  function tick(now) {
    let dt = (now - lastT) / 1000;
    if (dt > 0.05) dt = 0.05;
    lastT = now;
    const t = now / 1000;

    // Suppress cursor wind while a modal is open
    cursorDisabled = isModalOpen();

    // Refresh UI rects every ~250ms (handles page changes + window resize)
    uiRefreshT += dt;
    if (uiRefreshT > 0.25) { refreshUIRects(); uiRefreshT = 0; }

    // Cursor velocity (frame-paced delta + EMA smoothing)
    if (dt > 0) {
      const ivx = (cursor.x - cursor.lastX) / dt;
      const ivy = (cursor.y - cursor.lastY) / dt;
      const a = Math.min(1, dt * CURSOR_VEL_SMOOTH);
      cursor.vx = cursor.vx * (1 - a) + ivx * a;
      cursor.vy = cursor.vy * (1 - a) + ivy * a;
    }
    cursor.lastX = cursor.x;
    cursor.lastY = cursor.y;

    const rawSpeed = Math.hypot(cursor.vx, cursor.vy);
    if (rawSpeed > DIR_LATCH_SPEED) {
      cursor.dirX = cursor.vx / rawSpeed;
      cursor.dirY = cursor.vy / rawSpeed;
    }

    const decay = Math.exp(-CURSOR_VEL_DECAY * dt);
    cursor.vx *= decay;
    cursor.vy *= decay;
    cursor.speed = Math.hypot(cursor.vx, cursor.vy);

    // Continuous weather wind — slow direction/speed drift
    updateWeather(now, dt);

    // Periodic gust update
    maybeStartGust(now);
    gustDecay *= Math.exp(-GUST_DECAY_RATE * dt);

    // Big horizontal sweep
    maybeStartBigGust(now);
    bigGustDecay *= Math.exp(-BIG_GUST_DECAY_RATE * dt);

    // Ground-skimming gust — lifts dead leaves off the floor periodically
    maybeStartGroundGust(now);
    groundGustDecay *= Math.exp(-GROUND_GUST_DECAY_RATE * dt);

    // Per-page weather
    const weather = getPageWeather();

    ctx.clearRect(0, 0, W, H);
    for (const l of leaves) l.update(dt, t, weather.ambient);

    // Despawn leaves that have blown well past any page edge.
    // Bottom edge is excluded — leaves rest on the ground there.
    for (let i = leaves.length - 1; i >= 0; i--) {
      const l = leaves[i];
      if (l.x < -ESCAPE_MARGIN || l.x > W + ESCAPE_MARGIN ||
          l.y < -ESCAPE_MARGIN) {
        leaves.splice(i, 1);
      }
    }
    // First the entry-sequence drift-in (only at start of session), then
    // the population watchdog takes over.
    maybeEntrySpawn(now, dt);
    triggerEmergencyGust(now);

    // Skip the O(n²) leaf-leaf collision pass on mobile — it's the single
    // biggest CPU sink and the visual difference (leaves stacking vs. lightly
    // overlapping) is invisible at phone scale.
    if (!IS_MOBILE_FIELD) leafLeafCollisions();
    for (const l of leaves) l.draw(ctx);

    requestAnimationFrame(tick);
  }

  addEventListener('resize', resize);
  init();

  // ════════════════════════════════════════════════════════════════════════
  // MOBILE SENSORY LAYER — shake, pull-to-refresh, haptics
  // Pure no-op on desktop (events never fire). On iOS 13+ the motion API
  // needs explicit permission, granted via the first user tap.
  // ════════════════════════════════════════════════════════════════════════

  // ── Shake detection ──
  // Track the change in accelerationIncludingGravity each event; a sharp
  // spike = shake. Cooldown stops a single shake from firing repeatedly.
  let lastAcc = { x: 0, y: 0, z: 0, init: false };
  const SHAKE_THRESHOLD = 22;
  let nextShakeAllowed = 0;
  function handleMotion(e) {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null) return;
    if (!lastAcc.init) {
      lastAcc = { x: a.x, y: a.y, z: a.z, init: true };
      return;
    }
    const dx = a.x - lastAcc.x;
    const dy = a.y - lastAcc.y;
    const dz = a.z - lastAcc.z;
    const mag = Math.sqrt(dx*dx + dy*dy + dz*dz);
    lastAcc.x = a.x; lastAcc.y = a.y; lastAcc.z = a.z;
    const now = performance.now();
    if (mag > SHAKE_THRESHOLD && now > nextShakeAllowed) {
      nextShakeAllowed = now + 700;
      // Strong gust in a random direction
      const ang = Math.random() * Math.PI * 2;
      const power = 230 + Math.random() * 110;
      gustVx = Math.cos(ang) * power;
      gustVy = Math.sin(ang) * power;
      gustDecay = 1.3;
      if (navigator.vibrate) navigator.vibrate(40);
    }
  }

  // ── Permission gate (iOS 13+ requires user-gesture) ──
  // Non-iOS browsers fire deviceorientation freely, so wire the listeners
  // up immediately. On iOS we only attach them once permission is granted,
  // and we keep retrying on subsequent taps if the first prompt was denied
  // or dismissed.
  let sensorsAttached = false;
  let sensorsInFlight = false;
  function attachSensors() {
    if (sensorsAttached) return;
    sensorsAttached = true;
    window.addEventListener('devicemotion', handleMotion);
  }
  async function enableMotionSensors() {
    if (sensorsAttached || sensorsInFlight) return;
    const needsPerm = typeof DeviceOrientationEvent !== 'undefined' &&
                      typeof DeviceOrientationEvent.requestPermission === 'function';
    if (!needsPerm) { attachSensors(); return; }
    sensorsInFlight = true;
    try {
      const p = await DeviceOrientationEvent.requestPermission();
      if (p === 'granted') {
        attachSensors();
        if (typeof DeviceMotionEvent !== 'undefined' &&
            typeof DeviceMotionEvent.requestPermission === 'function') {
          try { await DeviceMotionEvent.requestPermission(); } catch (e) {}
        }
      }
    } catch (e) { /* user dismissed — let next tap retry */ }
    sensorsInFlight = false;
  }
  // Try on every early gesture until sensors are attached.
  window.addEventListener('pointerdown', enableMotionSensors);
  window.addEventListener('touchstart',  enableMotionSensors);

  // ── Pull-to-refresh wind gust ──
  // When the user pulls down past the top of the page and releases, fire
  // a strong downward gust that brings a fresh wave of leaves with it.
  let ptrStartY = null;
  let ptrAmount = 0;
  window.addEventListener('touchstart', (e) => {
    if ((window.scrollY || 0) <= 0 && e.touches[0]) {
      ptrStartY = e.touches[0].clientY;
      ptrAmount = 0;
    } else {
      ptrStartY = null;
    }
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (ptrStartY == null || !e.touches[0]) return;
    const dy = e.touches[0].clientY - ptrStartY;
    if (dy > 0) ptrAmount = Math.min(180, dy);
  }, { passive: true });
  window.addEventListener('touchend', () => {
    if (ptrAmount > 60) {
      const power = 180 + ptrAmount;
      gustVx = (Math.random() - 0.5) * 60;
      gustVy = power;
      gustDecay = 1.4;
      // Pump in a fresh wave from the top
      for (let i = 0; i < 12 && leaves.length < MAX_LEAVES; i++) {
        const speciesIdx = pickAmbientSpecies();
        const leaf = new Leaf(speciesIdx);
        leaf.x = Math.random() * W;
        leaf.y = -ESCAPE_MARGIN * 0.4;
        leaf.vx = (Math.random() - 0.5) * 60;
        leaf.vy = 60 + Math.random() * 80;
        leaves.push(leaf);
      }
      if (navigator.vibrate) navigator.vibrate(60);
    }
    ptrStartY = null;
    ptrAmount = 0;
  }, { passive: true });

  // ── Haptic taps for the existing interactions ──
  // Subtle 10ms buzz when the user clicks/taps to spawn a leaf.
  window.addEventListener('pointerdown', (e) => {
    if (!navigator.vibrate) return;
    const t = e.target;
    if (t && t.closest && t.closest(
      'a, button, input, textarea, select, label, [role="button"], [data-link]'
    )) return;
    navigator.vibrate(10);
  });

  // ── Haptics on big horizontal sweeps ──
  // Wrap maybeStartBigGust so a big sweep also triggers a longer buzz.
  const _origBigGust = maybeStartBigGust;
  maybeStartBigGust = function (now) {
    const before = bigGustDecay;
    _origBigGust(now);
    if (bigGustDecay > before + 0.5 && navigator.vibrate) {
      navigator.vibrate(80);
    }
  };
})();
