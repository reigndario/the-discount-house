const TAU = Math.PI * 2;
const TRANSITION_MS = 8200;
const BUILD_ID = window.TDH_BUILD_ID || "dev";
const CACHE_FLAG = window.TDH_CACHE_FLAG || `${BUILD_ID}-${Date.now().toString(36)}`;
const DEFAULT_WELCOME_CONFIG = {
  root: null,
  assetBaseUrl: "assets/",
  autoStart: true,
  initialFullscreen: true,
  initialLore: true,
  cacheBust: true,
  eventPrefix: "tdh",
};
const WELCOME_CONFIG = normalizeWelcomeConfig(window.TDH_WELCOME_CONFIG);
const EFFECT_PROFILE = resolveEffectProfile();
const rootNode = resolveTDHRoot(WELCOME_CONFIG.root);
const canvas = queryTDHElement("[data-tdh-scene-canvas]", "#tdh-bg");
if (!canvas) {
  throw new Error("TDH welcome scene requires a canvas with data-tdh-scene-canvas or #tdh-bg.");
}
const ctx = canvas.getContext("2d", { alpha: false });
if (!ctx) {
  throw new Error("TDH welcome scene could not create a 2D canvas context.");
}
const ambientCanvas = queryTDHElement("[data-tdh-ambient-canvas]", "#ambient-bg");
const ambientCtx = ambientCanvas ? ambientCanvas.getContext("2d", { alpha: true }) : null;
const vibeSwitch = queryTDHElement("[data-tdh-vibe-switch]", "#vibe-switch");
const vibeFrame = queryTDHElement("[data-tdh-vibe-frame]", ".vibe-switch__frame");
const appShell = queryTDHElement("[data-tdh-demo-shell]");
const privateActionButton = queryTDHElement("[data-tdh-private-action]", "#privateAction");
const SOURCE_SIZE = { w: 1672, h: 941 };
const MAX_CANVAS_PIXELS = EFFECT_PROFILE.maxCanvasPixels;
const VIBE_SWITCH_EXPAND_MS = 1040;
const TRANSITION_START_DELAY_MS = VIBE_SWITCH_EXPAND_MS + 120;
const VIBE_PIXEL_ZOOM = {
  startPixelSize: 2.25,
  endPixelSize: 11,
  minLowResWidth: 96,
  maxLowResWidth: 420,
  liveFadeMs: 220,
};
const PRIVATE_BURST_MS = 3200;
const PRIVATE_AUDIO_DELAY_MS = 250;
const PRIVATE_BURST_PARTICLE_MULTIPLIER = 8;
const PRIVATE_BURST_FORCE_MULTIPLIER = 2.55;
const PRIVATE_LORE_DISMISS_MS = 420;
const INITIAL_LORE_PROMPT_DELAY_MS = 0;
const RICK_ASTLEY_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const RED_BURST_VERTICAL_DISPERSION_MULTIPLIER = 1.67;
const BLUE_BURST_HORIZONTAL_FORCE_MULTIPLIER = 1.1;
const RED_IDLE_HORIZONTAL_SPEED_MULTIPLIER = 0.9;
const ASSET_MANIFEST = Object.freeze({
  components: Object.freeze({
    background: "components/background-field.png",
    blueDragon: "components/blue-dragon.png",
    redDragon: "components/red-dragon.png",
    maskClosed: "components/mask-closed.png",
    maskLeft: "components/mask-left.png",
    maskRight: "components/mask-right.png",
    maskEyesClosed: "components/mask-eyes-closed.png",
    maskEyesLeft: "components/mask-eyes-left.png",
    maskEyesRight: "components/mask-eyes-right.png",
  }),
  materials: Object.freeze({
    horn: "material-horn-frame-imagegen-v1.png",
    hornFill: "material-horn-neutral.png",
    hornThumb: "control-horn-strip-thumb.png",
    eye: "material-eye-amber.png",
    void: "material-void-cosmos.png",
  }),
  audio: Object.freeze({
    gojira: "gojira.wav",
  }),
});
const MIXED_PARTICLE_INTERFERENCE = {
  radiusScale: 0.052,
  minRadius: 18,
  maxRadius: 46,
  minClosingSpeed: 18,
  horizontalDamping: 0.46,
  verticalTransfer: 0.2,
  blueMass: 2,
  redMass: 1,
  maxPairsPerFrame: 240,
};
const AMBIENT_BREATH = {
  maxParticles: scaledEffectCount(520, EFFECT_PROFILE.ambientScale),
  spawnRate: {
    blue: scaledEffectRate(24, EFFECT_PROFILE.ambientScale),
    red: scaledEffectRate(30, EFFECT_PROFILE.ambientScale),
  },
  burstSpawnLimit: scaledEffectCount(34, EFFECT_PROFILE.ambientScale),
  idleSpawnLimit: scaledEffectCount(5, EFFECT_PROFILE.ambientScale),
};
const DRAGON_VISUALS = {
  activeAlpha: 1,
  inactiveAlpha: 0.13,
  inactiveGlowAlpha: 0.05,
};
const TRANSITION_CHOREOGRAPHY = {
  suckedSide: "left",
  shards: {
    start: 0.12,
    fullTakeover: 0.18,
    end: 0.58,
    stagger: 0.16,
    cols: 9,
    rows: 7,
    shrinkTo: 0.1,
    verticalPull: 0.24,
    swirl: 34,
    spritePadding: 4,
  },
  particles: {
    stopSpawnAt: 0,
    pullStart: 0.08,
    pullStrength: 10.5,
    fadeBorder: 1.08,
    fadeCore: 0.5,
    visualPullStart: 0.27,
    visualPullFull: 0.52,
    visualPullFadeStart: 0.54,
    visualPullEnd: 0.66,
  },
  cleanup: {
    clearParticlesAt: 0.5,
  },
  blackout: {
    start: 0.5,
    full: 0.72,
    liftStart: 0.78,
    end: 1,
  },
  incomingDragon: {
    start: 0.73,
    full: 0.98,
  },
  eyeReveal: {
    start: 0.68,
    full: 0.78,
    fadeStart: 0.84,
    end: 0.97,
  },
  dragonEyeReveal: {
    fadeStart: 0.73,
    fadeEnd: 0.88,
    fadeGamma: 1.45,
    minDrawAlpha: 0.000001,
  },
};
const MASK_EYE_FLASH_SOURCE_OFFSET_Y = 28;
const MASK_EYE_FLASH_SOURCE_SPREAD_X = 16;
const MASK_EYE_REVEAL_ENABLED = false;
const MASK_EYE_FLASH_SHAPES = {
  left: {
    layer: "maskEyesLeft",
    points: [
      [88, 224],
      [120, 206],
      [176, 218],
      [154, 242],
      [105, 244],
    ],
  },
  right: {
    layer: "maskEyesRight",
    points: [
      [20, 218],
      [76, 206],
      [108, 224],
      [91, 244],
      [42, 242],
    ],
  },
};
const LAYERS = {
  background: {
    src: ASSET_MANIFEST.components.background,
    x: 0,
    y: 0,
    w: 1672,
    h: 941,
  },
  blueDragon: {
    src: ASSET_MANIFEST.components.blueDragon,
    x: 0,
    y: 0,
    w: 836,
    h: 941,
  },
  redDragon: {
    src: ASSET_MANIFEST.components.redDragon,
    x: 836,
    y: 0,
    w: 836,
    h: 941,
  },
  maskClosed: {
    src: ASSET_MANIFEST.components.maskClosed,
    x: 650,
    y: 200,
    w: 372,
    h: 540,
  },
  maskLeft: {
    src: ASSET_MANIFEST.components.maskLeft,
    x: 650,
    y: 200,
    w: 196,
    h: 540,
  },
  maskRight: {
    src: ASSET_MANIFEST.components.maskRight,
    x: 826,
    y: 200,
    w: 196,
    h: 540,
  },
  maskEyesClosed: {
    src: ASSET_MANIFEST.components.maskEyesClosed,
    x: 650,
    y: 200 + MASK_EYE_FLASH_SOURCE_OFFSET_Y,
    w: 372,
    h: 540,
  },
  maskEyesLeft: {
    src: ASSET_MANIFEST.components.maskEyesLeft,
    x: 650,
    y: 200 + MASK_EYE_FLASH_SOURCE_OFFSET_Y,
    w: 196,
    h: 540,
  },
  maskEyesRight: {
    src: ASSET_MANIFEST.components.maskEyesRight,
    x: 826,
    y: 200 + MASK_EYE_FLASH_SOURCE_OFFSET_Y,
    w: 196,
    h: 540,
  },
};
const SIDES = {
  red: {
    key: "red",
    color: [255, 62, 22],
    accent: "rgba(255, 70, 16, ",
    glow: "rgba(255, 112, 22, ",
    particle: ["#ff2d12", "#ff7a18", "#ffd083"],
  },
  blue: {
    key: "blue",
    color: [38, 160, 255],
    accent: "rgba(36, 154, 255, ",
    glow: "rgba(112, 210, 255, ",
    particle: ["#1ba4ff", "#70d5ff", "#e8fbff"],
  },
};
const DRAGON_SLOTS = {
  left: {
    x: 0,
    y: 0,
    w: 836,
    h: 941,
  },
  right: {
    x: 836,
    y: 0,
    w: 836,
    h: 941,
  },
};
const DRAGON_MASK_CLEARANCE_OFFSETS = {
  blue: { left: -126, right: 125 },
  red: { left: -57, right: 56 },
};
const INITIAL_DRAGON_LAYOUT = {
  blue: "left",
  red: "right",
};
const DRAGON_SHARD_BOUNDS = {
  blue: { x: 0, y: 74, w: 830, h: 780 },
  red: { x: 0, y: 130, w: 790, h: 710 },
};
const DRAGON_EYE_FLASH = {
  blue: {
    x: 554,
    y: 457,
    w: 66,
    h: 30,
    rotation: 0.14,
  },
  red: {
    x: 455,
    y: 409,
    w: 73,
    h: 34,
    rotation: 0.2,
  },
};
const DRAGON_EYE_FLASH_ROTATION_OFFSET = Math.PI;
const DRAGON_EYE_FLASH_CLOCKWISE_TILT = (5 * Math.PI) / 180;

let width = 1;
let height = 1;
let dpr = 1;
let ambientWidth = 1;
let ambientHeight = 1;
let ambientDpr = 1;
let currentSide = "blue";
let vibeMode = "mixed";
let dragonLayout = { ...INITIAL_DRAGON_LAYOUT };
let transition = null;
let lastFrame = 0;
let frameRequest = null;
let running = true;
let assetsReady = false;
let shardSpritesReady = false;
let privateBurstUntil = 0;
let privateAudio = null;
let privateAudioAvailable = false;
let privateAudioTimer = null;
let privateLoreModal = null;
let privateLorePromptActive = false;
let privateLoreDismissTimer = null;
let privateLoreFlowMode = "privateAction";
let privateLoreDetailModal = null;
let privateLoreYesBurstPrimed = false;
let initialLoreFlowStarted = false;
let vibeOverlay = null;
let vibeOverlayPixelCanvas = null;
let vibeOverlayPixelSource = null;
let vibeOverlayPixelFrame = null;
let vibeOverlayLiveTimer = null;
let ambientSpawnCarry = {
  blue: 0,
  red: 0,
};
const ambientParticles = [];
const ambientParticlePool = [];
const ambientRnd = random(665544);

const perfStats = {
  frameMs: 0,
  avgFrameMs: 0,
  shardMs: 0,
  avgShardMs: 0,
  shardDraws: 0,
};

document.documentElement.dataset.tdhFx = EFFECT_PROFILE.name;
document.body?.setAttribute("data-tdh-fx", EFFECT_PROFILE.name);
applyAssetCssVariables();
const assets = loadLayerImages();
const dragonParticles = {
  blue: makeDragonParticleSystem("blue"),
  red: makeDragonParticleSystem("red"),
};
const mixedParticleInterferenceGrid = new Map();
const mixedParticleInterferenceStats = {
  pairs: 0,
  radius: 0,
};
const dragonShards = {
  blue: makeDragonShards("blue"),
  red: makeDragonShards("red"),
};
const pullParticles = makePullParticles(scaledEffectCount(420, EFFECT_PROFILE.pullParticleScale));
const stars = makeStars(scaledEffectCount(220, EFFECT_PROFILE.starScale));

const DRAGON_EMITTERS = {
  blue: {
    layer: "blueDragon",
    sourceX: 700,
    sourceY: 570,
    phase: 0.45,
    jet: 112,
    jetVariance: 146,
    billow: 20,
    billowVariance: 70,
    spawnRate: scaledEffectRate(21, EFFECT_PROFILE.dragonParticleScale),
    maxParticles: scaledEffectCount(1200, EFFECT_PROFILE.dragonParticleScale),
  },
  red: {
    layer: "redDragon",
    sourceX: 590,
    sourceY: 600,
    phase: 3.1,
    jet: 138,
    jetVariance: 168,
    billow: 24,
    billowVariance: 76,
    spawnRate: scaledEffectRate(44, EFFECT_PROFILE.dragonParticleScale),
    maxParticles: scaledEffectCount(1600, EFFECT_PROFILE.dragonParticleScale),
  },
};

function withCacheFlag(src) {
  if (WELCOME_CONFIG.cacheBust === false) return src;
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}v=${encodeURIComponent(CACHE_FLAG)}`;
}

function normalizeWelcomeConfig(config) {
  const userConfig = config && typeof config === "object" ? config : {};
  return {
    ...DEFAULT_WELCOME_CONFIG,
    ...userConfig,
  };
}

function resolveEffectProfile() {
  const profiles = {
    full: {
      name: "full",
      dragonParticleScale: 1,
      ambientScale: 1,
      pullParticleScale: 1,
      starScale: 1,
      particleInterference: true,
      maxCanvasPixels: 3200000,
    },
    lite: {
      name: "lite",
      dragonParticleScale: 0.24,
      ambientScale: 0.22,
      pullParticleScale: 0.35,
      starScale: 0.45,
      particleInterference: false,
      maxCanvasPixels: 1800000,
    },
    off: {
      name: "off",
      dragonParticleScale: 0,
      ambientScale: 0,
      pullParticleScale: 0,
      starScale: 0.2,
      particleInterference: false,
      maxCanvasPixels: 1400000,
    },
  };
  const mode = normalizeEffectMode(readEffectMode()) ?? "lite";
  return profiles[mode] ?? profiles.full;
}

function readEffectMode() {
  const query = new URLSearchParams(window.location.search);
  const explicit = query.get("cvc_fx") ?? query.get("fx") ?? query.get("particles") ?? query.get("particleProfile");
  if (explicit) return explicit;

  try {
    return window.localStorage?.getItem("cvc.fx") ?? window.localStorage?.getItem("tdh.fx") ?? null;
  } catch {
    return null;
  }
}

function normalizeEffectMode(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["lite", "low", "reduced", "reduce"].includes(normalized)) return "lite";
  if (["off", "none", "no", "false", "0", "disabled", "disable"].includes(normalized)) return "off";
  if (["full", "on", "true", "1", "normal"].includes(normalized)) return "full";
  return null;
}

function scaledEffectCount(value, scale) {
  if (scale <= 0) return 0;
  return Math.max(1, Math.round(value * scale));
}

function scaledEffectRate(value, scale) {
  if (scale <= 0) return 0;
  return value * scale;
}

function resolveTDHRoot(root) {
  if (!root) return document;
  if (typeof root === "string") return document.querySelector(root) || document;
  if (root.querySelector) return root;
  return document;
}

function queryTDHElement(dataSelector, fallbackSelector) {
  return (
    rootNode.querySelector(dataSelector) ||
    rootNode.querySelector(fallbackSelector) ||
    document.querySelector(dataSelector) ||
    document.querySelector(fallbackSelector)
  );
}

function isExternalAssetUrl(path) {
  return (
    /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path) ||
    path.startsWith("/") ||
    path.startsWith("data:") ||
    path.startsWith("blob:")
  );
}

function joinAssetUrl(baseUrl, path) {
  if (!baseUrl) return path;
  return `${String(baseUrl).replace(/\/?$/, "/")}${path.replace(/^\/+/, "")}`;
}

function assetUrl(path) {
  const cleanPath = String(path).replace(/^assets\//, "");
  if (isExternalAssetUrl(cleanPath)) return cleanPath;
  return joinAssetUrl(WELCOME_CONFIG.assetBaseUrl, cleanPath);
}

function cssAssetUrl(path) {
  return `url("${withCacheFlag(assetUrl(path)).replace(/"/g, "%22")}")`;
}

function applyAssetCssVariables() {
  const style = document.documentElement.style;
  style.setProperty("--material-horn", cssAssetUrl(ASSET_MANIFEST.materials.horn));
  style.setProperty("--material-horn-fill", cssAssetUrl(ASSET_MANIFEST.materials.hornFill));
  style.setProperty("--material-horn-thumb", cssAssetUrl(ASSET_MANIFEST.materials.hornThumb));
  style.setProperty("--material-eye", cssAssetUrl(ASSET_MANIFEST.materials.eye));
  style.setProperty("--material-void", cssAssetUrl(ASSET_MANIFEST.materials.void));
}

function emitTDHEvent(type, detail = {}) {
  const eventName = `${WELCOME_CONFIG.eventPrefix}:${type}`;
  const payload = {
    buildId: BUILD_ID,
    mode: vibeMode,
    side: currentSide,
    ...detail,
  };
  window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  if (rootNode !== document && rootNode.dispatchEvent) {
    rootNode.dispatchEvent(new CustomEvent(eventName, { detail: payload, bubbles: true }));
  }
}

function publicWelcomeConfig() {
  return {
    assetBaseUrl: WELCOME_CONFIG.assetBaseUrl,
    autoStart: WELCOME_CONFIG.autoStart,
    initialFullscreen: WELCOME_CONFIG.initialFullscreen,
    initialLore: WELCOME_CONFIG.initialLore,
    cacheBust: WELCOME_CONFIG.cacheBust,
    eventPrefix: WELCOME_CONFIG.eventPrefix,
  };
}

function getAssetManifest() {
  return JSON.parse(JSON.stringify(ASSET_MANIFEST));
}

function loadLayerImages() {
  const entries = Object.entries(LAYERS);
  let loaded = 0;
  const nextAssets = {};

  for (const [key, layer] of entries) {
    const img = new Image();
    img.addEventListener("load", () => {
      loaded += 1;
      assetsReady = loaded === entries.length;
      if (assetsReady) {
        prepareDragonShardSprites();
        resize();
        scheduleFrame();
        emitTDHEvent("ready", { assets: getAssetManifest() });
      }
    });
    img.src = withCacheFlag(assetUrl(layer.src));
    nextAssets[key] = img;
  }

  return nextAssets;
}

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDragonParticleSystem(side) {
  return {
    side,
    particles: [],
    pool: [],
    spawnCarry: 0,
    rnd: random(side === "red" ? 8192 : 4096),
  };
}

function makeDragonShards(side) {
  const bounds = DRAGON_SHARD_BOUNDS[side];
  const { cols, rows } = TRANSITION_CHOREOGRAPHY.shards;
  const rnd = random(side === "red" ? 271828 : 314159);
  const shards = [];
  const cellW = bounds.w / cols;
  const cellH = bounds.h / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x0 = bounds.x + col * cellW;
      const y0 = bounds.y + row * cellH;
      const x1 = x0 + cellW;
      const y1 = y0 + cellH;
      const slashForward = (row + col) % 2 === 0;
      const tris = slashForward
        ? [
            [
              [x0, y0],
              [x1, y0],
              [x1, y1],
            ],
            [
              [x0, y0],
              [x1, y1],
              [x0, y1],
            ],
          ]
        : [
            [
              [x0, y0],
              [x1, y0],
              [x0, y1],
            ],
            [
              [x1, y0],
              [x1, y1],
              [x0, y1],
            ],
          ];

      for (const points of tris) {
        const cx = (points[0][0] + points[1][0] + points[2][0]) / 3;
        const cy = (points[0][1] + points[1][1] + points[2][1]) / 3;
        const nx = clamp((cx - bounds.x) / bounds.w);
        const ny = clamp((cy - bounds.y) / bounds.h);
        shards.push({
          points,
          cx,
          cy,
          delay: clamp(0.58 - nx * 0.46 + rnd() * 0.24 + Math.abs(ny - 0.5) * 0.12),
          phase: rnd() * TAU,
          drift: rnd() - 0.5,
          spin: (rnd() - 0.5) * 0.52,
          pullBoost: 0.82 + rnd() * 0.46,
        });
      }
    }
  }

  return shards;
}

function prepareDragonShardSprites() {
  if (!assetsReady) return;

  for (const sideKey of Object.keys(dragonShards)) {
    buildDragonShardSprites(sideKey);
  }
  shardSpritesReady = true;
}

function buildDragonShardSprites(sideKey) {
  const key = sideKey === "red" ? "redDragon" : "blueDragon";
  const image = assets[key];
  const layer = LAYERS[key];
  if (!image || !image.complete || !image.naturalWidth) return;

  const padding = TRANSITION_CHOREOGRAPHY.shards.spritePadding;
  for (const shard of dragonShards[sideKey]) {
    const expandedPoints = expandedShardPoints(shard, padding);
    const xs = expandedPoints.map((point) => point[0]);
    const ys = expandedPoints.map((point) => point[1]);
    const spriteX = Math.max(0, Math.floor(Math.min(...xs) - padding));
    const spriteY = Math.max(0, Math.floor(Math.min(...ys) - padding));
    const right = Math.min(layer.w, Math.ceil(Math.max(...xs) + padding));
    const bottom = Math.min(layer.h, Math.ceil(Math.max(...ys) + padding));
    const spriteW = Math.max(1, right - spriteX);
    const spriteH = Math.max(1, bottom - spriteY);
    const sprite = document.createElement("canvas");
    const spriteCtx = sprite.getContext("2d");
    if (!spriteCtx) continue;

    sprite.width = spriteW;
    sprite.height = spriteH;
    spriteCtx.save();
    spriteCtx.beginPath();
    spriteCtx.moveTo(expandedPoints[0][0] - spriteX, expandedPoints[0][1] - spriteY);
    spriteCtx.lineTo(expandedPoints[1][0] - spriteX, expandedPoints[1][1] - spriteY);
    spriteCtx.lineTo(expandedPoints[2][0] - spriteX, expandedPoints[2][1] - spriteY);
    spriteCtx.closePath();
    spriteCtx.clip();
    spriteCtx.drawImage(image, -spriteX, -spriteY, layer.w, layer.h);
    spriteCtx.restore();

    shard.sprite = sprite;
    shard.spriteX = spriteX;
    shard.spriteY = spriteY;
    shard.spriteW = spriteW;
    shard.spriteH = spriteH;
  }
}

function expandedShardPoints(shard, overlap) {
  return shard.points.map(([x, y]) => {
    const dx = x - shard.cx;
    const dy = y - shard.cy;
    const length = Math.hypot(dx, dy) || 1;
    return [x + (dx / length) * overlap, y + (dy / length) * overlap];
  });
}

function makePullParticles(count) {
  const rnd = random(12345);
  return Array.from({ length: count }, () => ({
    rx: rnd(),
    ry: rnd(),
    spreadX: (rnd() - 0.5) * 0.52,
    spreadY: (rnd() - 0.5) * 0.68,
    tx: (rnd() - 0.5) * 0.17,
    ty: (rnd() - 0.5) * 0.23,
    size: 0.7 + rnd() * 3.8,
    delay: rnd() * 0.34,
    curve: (rnd() - 0.5) * 0.6,
    orbit: rnd() * TAU,
    life: 0.55 + rnd() * 0.45,
    hot: rnd() > 0.66,
  }));
}

function makeStars(count) {
  const rnd = random(223344);
  return Array.from({ length: count }, () => ({
    x: rnd(),
    y: rnd(),
    r: 0.5 + rnd() * 1.8,
    a: 0.22 + rnd() * 0.65,
    p: rnd() * TAU,
  }));
}

function resize() {
  const previousWidth = width;
  const previousHeight = height;
  const previousZoom = getParticleStageZoom();
  const previousRect =
    previousWidth > 1 && previousHeight > 1
      ? stageRectForDimensions(previousWidth, previousHeight, previousZoom)
      : null;
  const rect = canvas.getBoundingClientRect();
  width = Math.max(1, Math.round(rect.width || window.innerWidth));
  height = Math.max(1, Math.round(rect.height || window.innerHeight));
  dpr = getCappedDpr(width, height);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (previousRect && (previousWidth !== width || previousHeight !== height)) {
    transformDragonParticlesToStageRect(previousRect, stageRectForDimensions(width, height, previousZoom));
  }
  resizeAmbientCanvas();
}

function resizeAmbientCanvas() {
  if (!ambientCanvas || !ambientCtx) return;

  ambientWidth = Math.max(1, Math.round(window.innerWidth));
  ambientHeight = Math.max(1, Math.round(window.innerHeight));
  ambientDpr = getCappedDpr(ambientWidth, ambientHeight);
  ambientCanvas.width = Math.floor(ambientWidth * ambientDpr);
  ambientCanvas.height = Math.floor(ambientHeight * ambientDpr);
  ambientCtx.setTransform(ambientDpr, 0, 0, ambientDpr, 0, 0);
}

function getParticleStageZoom(now = performance.now()) {
  const perspective = getParticlePerspective(now);
  return 1.025 + perspective.pressure * 0.015;
}

function transformDragonParticlesToStageRect(previousRect, nextRect) {
  if (!previousRect || !nextRect || previousRect.w <= 0 || previousRect.h <= 0) return;

  const scale = nextRect.w / previousRect.w;
  for (const system of Object.values(dragonParticles)) {
    for (const particle of system.particles) {
      const sourceX = (particle.x - previousRect.x) / previousRect.w;
      const sourceY = (particle.y - previousRect.y) / previousRect.h;
      particle.x = nextRect.x + sourceX * nextRect.w;
      particle.y = nextRect.y + sourceY * nextRect.h;
      particle.vx *= scale;
      particle.vy *= scale;
      particle.ay *= scale;
      particle.radius *= scale;
      particle.grow *= scale;
      particle.turbulence *= scale;
      particle.heatRise *= scale;
    }
  }
}

function getCappedDpr(nextWidth, nextHeight) {
  const raw = Math.min(window.devicePixelRatio || 1, 2);
  const pixelRatio = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, nextWidth * nextHeight));
  return Math.max(1, Math.min(raw, pixelRatio));
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smooth(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - clamp(value), 3);
}

function recordPerf(key, value) {
  const averageKey = `avg${key[0].toUpperCase()}${key.slice(1)}`;
  perfStats[key] = value;
  perfStats[averageKey] = perfStats[averageKey] ? perfStats[averageKey] * 0.88 + value * 0.12 : value;
}

function coverRect(imgW, imgH, boxW, boxH, zoom = 1) {
  const scale = Math.max(boxW / imgW, boxH / imgH) * zoom;
  const w = imgW * scale;
  const h = imgH * scale;
  return {
    x: (boxW - w) * 0.5,
    y: (boxH - h) * 0.5,
    w,
    h,
  };
}

function stageRectForDimensions(boxW, boxH, zoom = 1.025) {
  return coverRect(SOURCE_SIZE.w, SOURCE_SIZE.h, boxW, boxH, zoom);
}

function stageRect(zoom = 1.025) {
  return stageRectForDimensions(width, height, zoom);
}

function sourcePixels(value, zoom = 1.025) {
  return (value * stageRect(zoom).w) / SOURCE_SIZE.w;
}

function drawLayer(key, options = {}) {
  const img = assets[key];
  const layer = LAYERS[key];
  if (!img || !img.complete || !img.naturalWidth || !layer) return;

  const {
    alpha = 1,
    screenShiftX = 0,
    screenShiftY = 0,
    zoom = 1.025,
    scale = 1,
    rotate = 0,
    anchorX = 0.5,
    anchorY = 0.5,
    flipX = false,
    composite = "source-over",
  } = options;
  const rect = stageRect(zoom);
  const unit = rect.w / SOURCE_SIZE.w;
  const x = rect.x + layer.x * unit + screenShiftX;
  const y = rect.y + layer.y * unit + screenShiftY;
  const w = layer.w * unit * scale;
  const h = layer.h * unit * scale;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = composite;
  ctx.translate(x + w * anchorX, y + h * anchorY);
  ctx.rotate(rotate);
  ctx.scale(flipX ? -1 : 1, 1);
  ctx.drawImage(img, -w * anchorX, -h * anchorY, w, h);
  ctx.restore();
}

function cloneDragonLayout(layout) {
  return {
    blue: layout.blue,
    red: layout.red,
  };
}

function swappedDragonLayout(layout) {
  return {
    blue: layout.blue === "left" ? "right" : "left",
    red: layout.red === "left" ? "right" : "left",
  };
}

function getDragonSlot(sideKey, layout = dragonLayout) {
  return layout[sideKey] === "right" ? "right" : "left";
}

function getDragonSideSign(sideKey, layout = dragonLayout) {
  return getDragonSlot(sideKey, layout) === "right" ? 1 : -1;
}

function getLeftDragonSide(layout = dragonLayout) {
  return getDragonSlot("blue", layout) === "left" ? "blue" : "red";
}

function getRightDragonSide(layout = dragonLayout) {
  return getDragonSlot("blue", layout) === "right" ? "blue" : "red";
}

function getSuckedSide(layout = dragonLayout) {
  const configured = TRANSITION_CHOREOGRAPHY.suckedSide;
  if (configured === "red" || configured === "blue") return configured;
  return getLeftDragonSide(layout);
}

function normalizeVibeMode(mode) {
  return mode === "red" || mode === "blue" || mode === "mixed" ? mode : "blue";
}

function isDragonActiveForMode(sideKey, mode = vibeMode) {
  const normalized = normalizeVibeMode(mode);
  return normalized === "mixed" || normalized === sideKey;
}

function getDragonFocusForMode(sideKey, mode = vibeMode) {
  return isDragonActiveForMode(sideKey, mode) ? 1 : 0;
}

function getTransitionSuckedSides(nextTransition = transition) {
  if (!nextTransition) return [getSuckedSide()];
  if (Array.isArray(nextTransition.suckedSides) && nextTransition.suckedSides.length) {
    return nextTransition.suckedSides.filter((side) => side === "red" || side === "blue");
  }
  return [nextTransition.suckedSide || getSuckedSide(nextTransition.fromLayout || dragonLayout)];
}

function layoutForActiveSide(sideKey) {
  return sideKey === "red" ? swappedDragonLayout(INITIAL_DRAGON_LAYOUT) : cloneDragonLayout(INITIAL_DRAGON_LAYOUT);
}

function setPageVibe(mode) {
  const normalized = normalizeVibeMode(mode);
  const previous = document.body.dataset.vibe;
  document.body.dataset.vibe = normalized;
  if (previous && previous !== normalized) {
    emitTDHEvent("mode-change", { mode: normalized, previousMode: previous });
  }
}

function setVibeSwitchFocus(active, options = {}) {
  document.body.classList.toggle("vibe-transitioning", active);
  if (active) {
    openVibeOverlay(options);
    emitTDHEvent("fullscreen-open", { instant: Boolean(options.instant) });
    return;
  }

  closeVibeOverlay();
  emitTDHEvent("fullscreen-close");
}

function setOverlayBox(element, rect) {
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

function captureCanvasFrame() {
  try {
    if (!canvas.width || !canvas.height) return null;
    const source = document.createElement("canvas");
    source.width = canvas.width;
    source.height = canvas.height;
    const sourceCtx = source.getContext("2d");
    if (!sourceCtx) return null;
    sourceCtx.drawImage(canvas, 0, 0);
    return source;
  } catch {
    return null;
  }
}

function clearVibeOverlayPixelCanvas() {
  if (vibeOverlayPixelFrame !== null) {
    cancelAnimationFrame(vibeOverlayPixelFrame);
    vibeOverlayPixelFrame = null;
  }
  if (vibeOverlayPixelCanvas) {
    vibeOverlayPixelCanvas.remove();
    vibeOverlayPixelCanvas = null;
  }
  vibeOverlayPixelSource = null;
}

function startVibePixelZoom() {
  if (!vibeOverlay || !vibeOverlayPixelCanvas || !vibeOverlayPixelSource) return;

  const startedAt = performance.now();
  const render = (now) => {
    if (!vibeOverlay || !vibeOverlayPixelCanvas || !vibeOverlayPixelSource) return;
    renderVibePixelFrame(clamp((now - startedAt) / VIBE_SWITCH_EXPAND_MS));
    if (now - startedAt < VIBE_SWITCH_EXPAND_MS + VIBE_PIXEL_ZOOM.liveFadeMs) {
      vibeOverlayPixelFrame = requestAnimationFrame(render);
    } else {
      vibeOverlayPixelFrame = null;
    }
  };

  vibeOverlayPixelFrame = requestAnimationFrame(render);
}

function renderVibePixelFrame(progress) {
  const rect = vibeOverlay.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const pixelSize = lerp(VIBE_PIXEL_ZOOM.startPixelSize, VIBE_PIXEL_ZOOM.endPixelSize, smooth(0, 1, progress));
  const lowWidth = Math.round(
    clamp(cssWidth / pixelSize, VIBE_PIXEL_ZOOM.minLowResWidth, VIBE_PIXEL_ZOOM.maxLowResWidth),
  );
  const lowHeight = Math.max(1, Math.round((lowWidth * cssHeight) / cssWidth));

  if (vibeOverlayPixelCanvas.width !== lowWidth || vibeOverlayPixelCanvas.height !== lowHeight) {
    vibeOverlayPixelCanvas.width = lowWidth;
    vibeOverlayPixelCanvas.height = lowHeight;
  }

  const pixelCtx = vibeOverlayPixelCanvas.getContext("2d");
  if (!pixelCtx) return;
  pixelCtx.imageSmoothingEnabled = false;
  pixelCtx.clearRect(0, 0, lowWidth, lowHeight);
  drawImageCover(pixelCtx, vibeOverlayPixelSource, 0, 0, lowWidth, lowHeight);
}

function drawImageCover(targetCtx, source, x, y, targetWidth, targetHeight) {
  const sourceAspect = source.width / source.height;
  const targetAspect = targetWidth / targetHeight;
  let sx = 0;
  let sy = 0;
  let sw = source.width;
  let sh = source.height;

  if (sourceAspect > targetAspect) {
    sw = source.height * targetAspect;
    sx = (source.width - sw) * 0.5;
  } else {
    sh = source.width / targetAspect;
    sy = (source.height - sh) * 0.5;
  }

  targetCtx.drawImage(source, sx, sy, sw, sh, x, y, targetWidth, targetHeight);
}

function revealLiveVibeCanvas() {
  if (!vibeOverlay) return;

  vibeOverlay.appendChild(canvas);
  resize();
  scheduleFrame();
  requestAnimationFrame(() => {
    if (!vibeOverlay) return;
    vibeOverlay.classList.add("is-live");
    if (vibeOverlayPixelCanvas) {
      vibeOverlayPixelCanvas.classList.add("is-fading");
      window.setTimeout(clearVibeOverlayPixelCanvas, VIBE_PIXEL_ZOOM.liveFadeMs);
    }
  });
}

function openVibeOverlay(options = {}) {
  if (!vibeSwitch || !vibeFrame || vibeOverlay) return;

  const instant = Boolean(options.instant);
  const rect = vibeSwitch.getBoundingClientRect();
  const fullscreenRect = {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  const pixelSource = instant ? null : captureCanvasFrame();
  vibeOverlay = document.createElement("div");
  vibeOverlay.className = instant ? "vibe-overlay is-open is-live is-instant" : "vibe-overlay";
  vibeOverlay.addEventListener("click", handleVibeOverlayChoice);
  setOverlayBox(vibeOverlay, instant ? fullscreenRect : rect);
  if (pixelSource) {
    vibeOverlayPixelSource = pixelSource;
    vibeOverlayPixelCanvas = document.createElement("canvas");
    vibeOverlayPixelCanvas.className = "vibe-overlay__pixel";
    vibeOverlay.appendChild(vibeOverlayPixelCanvas);
  }
  document.body.appendChild(vibeOverlay);
  vibeSwitch.classList.add("is-expanded");
  if (instant) {
    vibeOverlay.appendChild(canvas);
    resize();
    scheduleFrame();
    requestAnimationFrame(() => {
      if (vibeOverlay) vibeOverlay.classList.remove("is-instant");
    });
    return;
  }

  if (vibeOverlayPixelCanvas) {
    renderVibePixelFrame(0);
    startVibePixelZoom();
  }
  if (vibeOverlayLiveTimer !== null) {
    window.clearTimeout(vibeOverlayLiveTimer);
  }
  vibeOverlayLiveTimer = window.setTimeout(
    () => {
      vibeOverlayLiveTimer = null;
      revealLiveVibeCanvas();
    },
    pixelSource ? VIBE_SWITCH_EXPAND_MS + 40 : 0,
  );
  requestAnimationFrame(() => {
    if (vibeOverlay) {
      vibeOverlay.classList.add("is-open");
      setOverlayBox(vibeOverlay, {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }
  });
}

function closeVibeOverlay() {
  if (!vibeSwitch || !vibeFrame || !vibeOverlay) {
    if (vibeSwitch) {
      vibeSwitch.classList.remove("is-expanded");
    }
    return;
  }

  if (vibeOverlayLiveTimer !== null) {
    window.clearTimeout(vibeOverlayLiveTimer);
    vibeOverlayLiveTimer = null;
  }

  const overlay = vibeOverlay;
  const rect = vibeSwitch.getBoundingClientRect();
  const pixelSource = captureCanvasFrame();
  clearVibeOverlayPixelCanvas();
  if (pixelSource) {
    vibeOverlayPixelSource = pixelSource;
    vibeOverlayPixelCanvas = document.createElement("canvas");
    vibeOverlayPixelCanvas.className = "vibe-overlay__pixel";
    overlay.appendChild(vibeOverlayPixelCanvas);
    renderVibePixelFrame(0);
    startVibePixelZoom();
  }

  vibeSwitch.classList.remove("is-expanded");
  if (pixelSource) {
    overlay.classList.remove("is-live");
  }
  requestAnimationFrame(() => {
    if (vibeOverlay !== overlay) return;
    setOverlayBox(overlay, rect);
    overlay.classList.remove("is-open");
  });
  window.setTimeout(() => {
    if (vibeOverlay !== overlay) return;
    vibeFrame.appendChild(canvas);
    canvas.style.opacity = "";
    clearVibeOverlayPixelCanvas();
    overlay.remove();
    vibeOverlay = null;
    resize();
    scheduleFrame();
  }, VIBE_SWITCH_EXPAND_MS + 60);
}

function getTransitionStartTime() {
  return performance.now() + (vibeSwitch && !vibeOverlay ? TRANSITION_START_DELAY_MS : 0);
}

function handleVibeOverlayChoice(event) {
  if (privateLorePromptActive || transition || event.defaultPrevented) return;
  if (event.target.closest(".private-lore-modal")) return;

  event.preventDefault();
  event.stopPropagation();
  const chosenSide = getChosenSideFromViewport(event.clientX);
  emitTDHEvent("choice", { chosenSide });
  toggleTransition(chosenSide);
}

function getTransitionProgress(now = performance.now()) {
  if (!transition) return null;
  return clamp((now - transition.start) / TRANSITION_MS);
}

function getVoidCenter() {
  return {
    x: width * 0.5,
    y: height * 0.51,
  };
}

function getVoidRadius(open) {
  return Math.min(width, height) * (0.12 + open * 0.22);
}

function getDragonLayerMetrics(sideKey, perspective) {
  const key = sideKey === "red" ? "redDragon" : "blueDragon";
  const sourceLayer = LAYERS[key];
  const layout = perspective.layout || dragonLayout;
  const slot = getDragonSlot(sideKey, layout);
  const slotLayer = DRAGON_SLOTS[slot];
  const maskClearanceOffset = DRAGON_MASK_CLEARANCE_OFFSETS[sideKey]?.[slot] || 0;
  const zoom = 1.025 + perspective.pressure * 0.015;
  const rect = stageRect(zoom);
  const baseUnit = rect.w / SOURCE_SIZE.w;
  const scale = 1 + perspective.pressure * 0.012;
  const unit = baseUnit * scale;
  const centerPull = perspective.pressure * width * 0.012 * -getDragonSideSign(sideKey, layout);

  return {
    key,
    image: assets[key],
    layer: sourceLayer,
    slot,
    flipX: slot === "right",
    x: rect.x + (slotLayer.x + maskClearanceOffset) * baseUnit + perspective.shift + centerPull,
    y: rect.y + slotLayer.y * baseUnit,
    w: slotLayer.w * unit,
    h: slotLayer.h * unit,
    unit,
  };
}

function dragonLocalToScreen(metrics, localX, localY) {
  return {
    x: metrics.x + (metrics.flipX ? metrics.layer.w - localX : localX) * metrics.unit,
    y: metrics.y + localY * metrics.unit,
  };
}

function dragonLocalRectToScreen(metrics, localX, localY, localW, localH) {
  return {
    x: metrics.x + (metrics.flipX ? metrics.layer.w - localX - localW : localX) * metrics.unit,
    y: metrics.y + localY * metrics.unit,
    w: localW * metrics.unit,
    h: localH * metrics.unit,
  };
}

function getPerspectiveState(sideKey, alpha = 1, transitionPressure = 0, layout = dragonLayout, mode = vibeMode) {
  const normalizedMode = normalizeVibeMode(mode);
  const activeSideForShift = normalizedMode === "mixed" ? sideKey : normalizedMode;
  const inactiveSign = normalizedMode === "mixed" ? 0 : -getDragonSideSign(activeSideForShift, layout);
  const shift = transitionPressure * width * 0.018 * inactiveSign;
  return {
    sideKey,
    alpha,
    pressure: transitionPressure,
    layout,
    mode: normalizedMode,
    shift,
    redFocus: getDragonFocusForMode("red", normalizedMode),
    blueFocus: getDragonFocusForMode("blue", normalizedMode),
  };
}

function drawPerspective(sideKey, alpha, time, transitionPressure = 0, options = {}) {
  const state = getPerspectiveState(
    sideKey,
    alpha,
    transitionPressure,
    options.layout || dragonLayout,
    options.mode || vibeMode,
  );
  const { shift, redFocus, blueFocus } = state;
  const sideAlpha = options.sideAlpha || {};

  ctx.save();
  ctx.globalAlpha = alpha;
  drawLayer("background", {
    screenShiftX: shift * 0.25,
    zoom: 1.025 + transitionPressure * 0.015,
  });
  drawDragonLayer("blue", blueFocus, time, shift, transitionPressure, sideAlpha.blue ?? 1, state.layout, state.mode);
  drawDragonLayer("red", redFocus, time, shift, transitionPressure, sideAlpha.red ?? 1, state.layout, state.mode);
  drawLayer("maskClosed", {
    alpha: 0.98,
    screenShiftX: shift * 0.08,
    zoom: 1.025 + transitionPressure * 0.015,
  });
  drawAtmosphericGrade(sideKey, time, transitionPressure, state.layout, state.mode);
  ctx.restore();
}

function drawDragonLayer(
  sideKey,
  focus,
  time,
  shift,
  pressure,
  alphaScale = 1,
  layout = dragonLayout,
  mode = vibeMode,
) {
  if (alphaScale <= 0.01) return;
  const active = isDragonActiveForMode(sideKey, mode);

  const metrics = getDragonLayerMetrics(sideKey, {
    pressure,
    shift,
    layout,
  });

  drawDragonImage(metrics, {
    alpha: (active ? DRAGON_VISUALS.activeAlpha : DRAGON_VISUALS.inactiveAlpha) * alphaScale,
    composite: "source-over",
  });

  if (active && focus > 0.5) {
    drawDragonImage(metrics, {
      alpha: (0.08 + pressure * 0.08) * alphaScale,
      scale: 1.01 / (1 + pressure * 0.012),
      composite: "lighter",
    });
  } else if (!active) {
    drawDragonImage(metrics, {
      alpha: DRAGON_VISUALS.inactiveGlowAlpha * alphaScale,
      scale: 1.006,
      composite: "lighter",
    });
  }
}

function drawDragonImage(metrics, options = {}) {
  if (!metrics.image || !metrics.image.complete || !metrics.image.naturalWidth) return;

  const { alpha = 1, scale = 1, composite = "source-over" } = options;
  const w = metrics.w * scale;
  const h = metrics.h * scale;
  const x = metrics.x + (metrics.w - w) * 0.5;
  const y = metrics.y + (metrics.h - h) * 0.5;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = composite;
  if (metrics.flipX) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(metrics.image, 0, 0, w, h);
  } else {
    ctx.drawImage(metrics.image, x, y, w, h);
  }
  ctx.restore();
}

function drawSuckedDragonShards(sideKey, t, now, perspective, takeover) {
  const config = TRANSITION_CHOREOGRAPHY.shards;
  if (takeover <= 0.01 || t < config.start || t > config.end + config.stagger + 0.18) return;
  if (!shardSpritesReady) {
    prepareDragonShardSprites();
  }

  const metrics = getDragonLayerMetrics(sideKey, perspective);
  if (!metrics.image || !metrics.image.complete || !metrics.image.naturalWidth) return;

  const voidCenter = getVoidCenter();
  const voidRadius = getVoidRadius(smooth(0.1, 0.34, t));
  const particleTiming = TRANSITION_CHOREOGRAPHY.particles;
  const focus = sideKey === "red" ? perspective.redFocus : perspective.blueFocus;
  const layerAlpha = 0.38 + focus * 0.62;
  const perfStart = performance.now();
  let drawn = 0;

  ctx.save();
  for (const shard of dragonShards[sideKey]) {
    if (!shard.sprite) continue;

    const local = clamp((t - config.start - shard.delay * config.stagger) / (config.end - config.start));
    const center = dragonLocalToScreen(metrics, shard.cx, shard.cy);
    const pull = Math.min(1, local * local * shard.pullBoost + local * 0.18);
    const verticalMix = config.verticalPull + (1 - config.verticalPull) * smooth(0.52, 1, local);
    const wave = Math.sin(local * Math.PI);
    const xShift = (voidCenter.x - center.x) * pull;
    const yShift =
      (voidCenter.y - center.y) * pull * verticalMix +
      Math.sin(local * TAU + shard.phase + now * 0.001) * config.swirl * shard.drift * wave;
    const movedX = center.x + xShift;
    const movedY = center.y + yShift;
    const dist = Math.hypot(voidCenter.x - movedX, voidCenter.y - movedY);
    const borderFade = smooth(voidRadius * particleTiming.fadeCore, voidRadius * particleTiming.fadeBorder, dist);
    const alpha = perspective.alpha * layerAlpha * takeover * borderFade;

    if (alpha <= 0.01) continue;

    const scale = 1 - (1 - config.shrinkTo) * easeOutCubic(local);
    const spin = shard.spin * local * wave;
    const spriteRect = dragonLocalRectToScreen(metrics, shard.spriteX, shard.spriteY, shard.spriteW, shard.spriteH);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(movedX, movedY);
    ctx.rotate(spin);
    ctx.scale(scale, scale);
    ctx.translate(-center.x, -center.y);
    ctx.globalCompositeOperation = "source-over";
    drawShardSprite(metrics, shard, spriteRect);
    ctx.restore();
    drawn += 1;
  }
  ctx.restore();
  perfStats.shardDraws = drawn;
  recordPerf("shardMs", performance.now() - perfStart);
}

function drawShardSprite(metrics, shard, rect) {
  if (metrics.flipX) {
    ctx.save();
    ctx.translate(rect.x + rect.w, rect.y);
    ctx.scale(-1, 1);
    ctx.drawImage(shard.sprite, 0, 0, rect.w, rect.h);
    ctx.restore();
    return;
  }

  ctx.drawImage(shard.sprite, rect.x, rect.y, rect.w, rect.h);
}

function drawAtmosphericGrade(sideKey, time, pressure, layout = dragonLayout, mode = vibeMode) {
  const normalizedMode = normalizeVibeMode(mode);

  if (normalizedMode !== "mixed") {
    const activeLeft = getDragonSlot(normalizedMode, layout) === "left";
    const inactiveStart = activeLeft ? width * 0.54 : width * 0.46;
    const inactiveEnd = activeLeft ? width : 0;

    const gradient = ctx.createLinearGradient(inactiveStart, 0, inactiveEnd, 0);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.02)");
    gradient.addColorStop(0.58, "rgba(0, 0, 0, 0.42)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.74)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  const center = ctx.createLinearGradient(width * 0.48, 0, width * 0.52, 0);
  center.addColorStop(0, "rgba(255, 196, 77, 0)");
  center.addColorStop(0.5, "rgba(255, 236, 176, 0.24)");
  center.addColorStop(1, "rgba(255, 196, 77, 0)");
  ctx.fillStyle = center;
  ctx.fillRect(width * 0.47, 0, width * 0.06, height);

  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    height * 0.08,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.74,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(0.7, "rgba(0, 0, 0, 0.18)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.78)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

function emitterRate(sideKey, time) {
  const config = DRAGON_EMITTERS[sideKey];
  return 0.5 + Math.sin(time * 0.00142 + config.phase) * 0.5;
}

function getParticlePerspective(now) {
  if (!transition) {
    return getPerspectiveState(currentSide, 1, 0, dragonLayout, vibeMode);
  }

  const elapsed = now - transition.start;
  const t = clamp(elapsed / TRANSITION_MS);
  const fromAlpha = 1 - smooth(0.44, 0.62, t);
  const toAlpha = incomingDragonAlpha(t);
  const pressure = smooth(0.16, 0.5, t);
  const fromMode = transition.fromMode || transition.from;
  const toMode = transition.toMode || transition.to;

  if (toAlpha > fromAlpha && toAlpha > 0.01) {
    return getPerspectiveState(transition.to, toAlpha, 1 - toAlpha, transition.toLayout, toMode);
  }

  return getPerspectiveState(transition.from, fromAlpha, pressure, transition.fromLayout, fromMode);
}

function getEmitterState(sideKey, perspective, time) {
  const config = DRAGON_EMITTERS[sideKey];
  const metrics = getDragonLayerMetrics(sideKey, perspective);
  const origin = dragonLocalToScreen(metrics, config.sourceX, config.sourceY);
  const active = isDragonActiveForMode(sideKey, perspective.mode);

  return {
    origin,
    unit: metrics.unit,
    direction: metrics.flipX ? -1 : 1,
    active,
    focus: sideKey === "red" ? perspective.redFocus : perspective.blueFocus,
    alpha: perspective.alpha,
    pressureFade: 1 - perspective.pressure * 0.25,
    burst: getPrivateBurstFactor(sideKey, perspective.mode, time),
  };
}

function getVoidParticleState(sideKey, now) {
  if (!transition || !getTransitionSuckedSides(transition).includes(sideKey)) return null;

  const t = getTransitionProgress(now);
  const timing = TRANSITION_CHOREOGRAPHY.particles;
  if (t === null || t < timing.pullStart) return null;

  return {
    t,
    pull: smooth(timing.pullStart, TRANSITION_CHOREOGRAPHY.shards.end, t),
    open: smooth(0.1, 0.34, t),
  };
}

function updateDragonParticles(now, deltaMs) {
  if (EFFECT_PROFILE.dragonParticleScale <= 0) {
    clearDragonParticles();
    return;
  }

  const deltaSeconds = deltaMs / 1000;
  const perspective = getParticlePerspective(now);
  const blueEmitter = getEmitterState("blue", perspective, now);
  const redEmitter = getEmitterState("red", perspective, now);

  updateDragonParticleSystem(dragonParticles.blue, blueEmitter, now, deltaSeconds);
  updateDragonParticleSystem(dragonParticles.red, redEmitter, now, deltaSeconds);

  if (EFFECT_PROFILE.particleInterference && shouldInterfereDragonParticles(perspective, blueEmitter, redEmitter)) {
    resolveMixedParticleInterference(now, deltaSeconds);
  } else {
    mixedParticleInterferenceStats.pairs = 0;
    mixedParticleInterferenceStats.radius = 0;
  }
}

function updateDragonParticleSystem(system, emitter, now, deltaSeconds) {
  const config = DRAGON_EMITTERS[system.side];
  const transitionT = getTransitionProgress(now);
  const stopSpawning = transitionT !== null && transitionT >= TRANSITION_CHOREOGRAPHY.particles.stopSpawnAt;

  if (!emitter.active) {
    recycleParticleSystem(system);
    return;
  }

  if (stopSpawning) {
    system.spawnCarry = 0;
  } else {
    const spawnAlpha = emitter.focus * emitter.alpha * emitter.pressureFade;
    const burstMultiplier = 1 + emitter.burst * (PRIVATE_BURST_PARTICLE_MULTIPLIER - 1);
    const waveRate = emitterRate(system.side, now);
    const rateFloor = emitter.burst > 0 ? 0.78 : 0;
    const rate = config.spawnRate * burstMultiplier * Math.max(waveRate, rateFloor) * spawnAlpha;
    system.spawnCarry += rate * deltaSeconds;

    const spawnCount = Math.min(emitter.burst > 0 ? 80 : 10, Math.floor(system.spawnCarry));
    if (spawnCount > 0) {
      system.spawnCarry -= spawnCount;
      for (let i = 0; i < spawnCount && system.particles.length < config.maxParticles; i += 1) {
        const particle = system.pool.pop() || {};
        resetDragonParticle(particle, system, emitter);
        system.particles.push(particle);
      }
    }
  }

  const voidState = getVoidParticleState(system.side, now);
  let writeIndex = 0;
  for (const particle of system.particles) {
    if (voidState) {
      updateVoidPulledDragonParticle(particle, now, deltaSeconds, voidState);
    } else {
      updateDragonParticle(particle, now, deltaSeconds);
    }
    if (isParticleExpired(particle)) {
      if (system.pool.length < config.maxParticles) {
        system.pool.push(particle);
      }
    } else {
      system.particles[writeIndex] = particle;
      writeIndex += 1;
    }
  }
  system.particles.length = writeIndex;
}

function resetDragonParticle(particle, system, emitter) {
  const rnd = system.rnd;
  const isRed = system.side === "red";
  const direction = emitter.direction;
  const unit = emitter.unit;
  const speed = 0.35 + rnd() * 0.95;
  const spread = rnd();
  const baseRadius = isRed ? 0.45 + rnd() * 1.65 : 0.5 + rnd() * 1.9;
  const sourceJitterX = (rnd() - 0.5) * (isRed ? 18 : 12) * unit;
  const sourceJitterY = (rnd() - 0.5) * (isRed ? 24 : 16) * unit;
  const config = DRAGON_EMITTERS[system.side];
  const jet = config.jet + speed * config.jetVariance;
  const burst = emitter.burst || 0;
  const blueBurstBoost = isRed ? 1 : 1 + burst * (BLUE_BURST_HORIZONTAL_FORCE_MULTIPLIER - 1);
  const forwardMultiplier = (1 + burst * (PRIVATE_BURST_FORCE_MULTIPLIER - 1)) * blueBurstBoost;
  const idleHorizontalMultiplier = isRed
    ? RED_IDLE_HORIZONTAL_SPEED_MULTIPLIER + (1 - RED_IDLE_HORIZONTAL_SPEED_MULTIPLIER) * burst
    : 1;
  const redVerticalSpread = 58 * (1 + burst * (RED_BURST_VERTICAL_DISPERSION_MULTIPLIER - 1));
  const energyMultiplier = 1 + burst * 0.22;

  particle.side = system.side;
  particle.x = emitter.origin.x + sourceJitterX;
  particle.y = emitter.origin.y + sourceJitterY;
  particle.vx =
    (direction * unit * jet * forwardMultiplier + (rnd() - 0.5) * unit * (isRed ? 34 : 26)) * idleHorizontalMultiplier;
  particle.vy = unit * (isRed ? (rnd() - 0.5) * redVerticalSpread - 4 : (rnd() - 0.5) * 34 + 16);
  particle.ay = isRed ? 0 : unit * (12 + rnd() * 24);
  particle.drag = isRed ? 0.998 : 0.995;
  particle.radius = baseRadius * unit * (isRed ? 2.18 : 2.65) * energyMultiplier;
  particle.grow = unit * (isRed ? 0.1 + rnd() * 0.34 : 0.04 + rnd() * 0.14);
  particle.alpha = Math.min(1, (isRed ? 0.35 + rnd() * 0.45 : 0.42 + rnd() * 0.48) * energyMultiplier);
  particle.spread = spread;
  particle.speed = speed;
  particle.phase = rnd() * TAU;
  particle.windRate = isRed ? 0.0022 + rnd() * 0.0016 : 0.001 + rnd() * 0.0012;
  particle.turbulence = unit * (isRed ? 18 + rnd() * 34 : 10 + rnd() * 28);
  particle.heatRise = unit * (isRed ? 14 + rnd() * 12 : 3 + rnd() * 5);
  particle.age = 0;
  particle.maxAge = 10000;
  particle.spin = rnd() * TAU;
  particle.spinRate = (rnd() - 0.5) * (isRed ? 2.2 : 4.8);
  particle.sharp = isRed ? false : rnd() > 0.18;
  particle.hot = isRed ? rnd() > 0.54 : false;
  particle.voidAlpha = 1;
  particle.interference = 0;
}

function updateDragonParticle(particle, now, deltaSeconds) {
  const isRed = particle.side === "red";
  const wind = Math.sin(now * particle.windRate + particle.phase) * particle.turbulence;

  if (isRed) {
    const gust = Math.sin(now * particle.windRate * 0.37 + particle.phase * 1.7) * particle.turbulence * 0.45;
    particle.vy -= (particle.heatRise || 0) * deltaSeconds;
    particle.x += (particle.vx + wind + gust) * deltaSeconds;
    particle.y += particle.vy * deltaSeconds;
  } else {
    const drag = Math.pow(particle.drag, deltaSeconds * 60);
    particle.vx = (particle.vx + wind * deltaSeconds) * drag;
    particle.vy = (particle.vy + (particle.ay - (particle.heatRise || 0)) * deltaSeconds) * drag;
    particle.x += particle.vx * deltaSeconds;
    particle.y += particle.vy * deltaSeconds;
  }

  particle.radius += particle.grow * deltaSeconds;
  particle.spin += particle.spinRate * deltaSeconds;
  particle.age += deltaSeconds * 1000;
  particle.interference = (particle.interference || 0) * Math.pow(0.88, deltaSeconds * 60);

  if (isRed) {
    particle.alpha *= Math.pow(0.998, deltaSeconds * 60);
  }
}

function shouldInterfereDragonParticles(perspective, blueEmitter, redEmitter) {
  return (
    !transition &&
    perspective.mode === "mixed" &&
    blueEmitter.active &&
    redEmitter.active &&
    dragonParticles.blue.particles.length > 0 &&
    dragonParticles.red.particles.length > 0
  );
}

function resolveMixedParticleInterference(now, deltaSeconds) {
  const blueParticles = dragonParticles.blue.particles;
  const redParticles = dragonParticles.red.particles;
  const config = MIXED_PARTICLE_INTERFERENCE;
  const interactionRadius = Math.max(
    config.minRadius,
    Math.min(config.maxRadius, Math.min(width, height) * config.radiusScale),
  );
  const radiusSq = interactionRadius * interactionRadius;
  const cellSize = interactionRadius;
  const grid = mixedParticleInterferenceGrid;

  grid.clear();
  mixedParticleInterferenceStats.pairs = 0;
  mixedParticleInterferenceStats.radius = interactionRadius;

  for (const particle of redParticles) {
    if (!isParticleInteractionCandidate(particle)) continue;
    const cellX = Math.floor(particle.x / cellSize);
    const cellY = Math.floor(particle.y / cellSize);
    const key = `${cellX}:${cellY}`;
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(particle);
    } else {
      grid.set(key, [particle]);
    }
  }

  const frameScale = Math.min(1, deltaSeconds * 18);
  let pairs = 0;

  for (const blue of blueParticles) {
    if (!isParticleInteractionCandidate(blue)) continue;
    const cellX = Math.floor(blue.x / cellSize);
    const cellY = Math.floor(blue.y / cellSize);

    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const bucket = grid.get(`${cellX + ox}:${cellY + oy}`);
        if (!bucket) continue;

        for (const red of bucket) {
          const dx = red.x - blue.x;
          const dy = red.y - blue.y;
          if (Math.abs(dx) > interactionRadius || Math.abs(dy) > interactionRadius) continue;

          const distanceSq = dx * dx + dy * dy;
          if (distanceSq <= 0.001 || distanceSq > radiusSq) continue;

          const closingDirection = Math.sign(dx) || 1;
          const closingSpeed = (blue.vx - red.vx) * closingDirection;
          if (closingSpeed < config.minClosingSpeed || Math.sign(blue.vx) === Math.sign(red.vx)) continue;

          const distance = Math.sqrt(distanceSq);
          const proximity = 1 - distance / interactionRadius;
          transferParticleMomentum(blue, red, proximity, closingSpeed, frameScale, now);
          pairs += 1;

          if (pairs >= config.maxPairsPerFrame) {
            mixedParticleInterferenceStats.pairs = pairs;
            return;
          }
        }
      }
    }
  }

  mixedParticleInterferenceStats.pairs = pairs;
}

function isParticleInteractionCandidate(particle) {
  return (
    particle.age > 120 &&
    particle.voidAlpha !== 0 &&
    Math.abs(particle.vx) > MIXED_PARTICLE_INTERFERENCE.minClosingSpeed * 0.28
  );
}

function transferParticleMomentum(blue, red, proximity, closingSpeed, frameScale, now) {
  const config = MIXED_PARTICLE_INTERFERENCE;
  const impact = smooth(0.08, 0.82, proximity) * frameScale;
  if (impact <= 0.001) return;
  const blueMass = config.blueMass;
  const redMass = config.redMass;
  const responseScale = 2 / (1 / blueMass + 1 / redMass);
  const blueResponse = responseScale / blueMass;
  const redResponse = responseScale / redMass;

  const blueDamping = Math.max(0.42, 1 - config.horizontalDamping * impact * blueResponse);
  const redDamping = Math.max(0.42, 1 - config.horizontalDamping * impact * redResponse);
  blue.vx *= blueDamping;
  red.vx *= redDamping;

  const phase = Math.sin(now * 0.004 + blue.phase - red.phase) * 0.16;
  const transfer = closingSpeed * config.verticalTransfer * impact;
  blue.vy += transfer * (0.86 + phase) * blueResponse;
  red.vy -= transfer * (0.9 - phase) * redResponse;

  const maxVertical = Math.max(80, Math.min(width, height) * 0.62);
  blue.vy = clamp(blue.vy, -maxVertical, maxVertical);
  red.vy = clamp(red.vy, -maxVertical, maxVertical);
  blue.interference = Math.min(1, (blue.interference || 0) + impact * 0.72);
  red.interference = Math.min(1, (red.interference || 0) + impact * 0.72);
}

function updateVoidPulledDragonParticle(particle, now, deltaSeconds, voidState) {
  const timing = TRANSITION_CHOREOGRAPHY.particles;
  const center = getVoidCenter();
  const dx = center.x - particle.x;
  const dy = center.y - particle.y;
  const pull = 0.45 + voidState.pull * 1.85;
  const horizontalBias = 1 + Math.abs(dx) / Math.max(width, 1);

  particle.vx += dx * timing.pullStrength * pull * horizontalBias * deltaSeconds;
  particle.vy += dy * timing.pullStrength * 0.26 * pull * deltaSeconds;

  const maxSpeed = Math.max(width, height) * 3.2;
  const speed = Math.hypot(particle.vx, particle.vy);
  if (speed > maxSpeed) {
    const limit = maxSpeed / speed;
    particle.vx *= limit;
    particle.vy *= limit;
  }

  const wind = Math.sin(now * particle.windRate * 1.4 + particle.phase) * particle.turbulence * 0.28;
  particle.x += (particle.vx + wind) * deltaSeconds;
  particle.y += particle.vy * deltaSeconds;
  particle.spin += particle.spinRate * deltaSeconds * (1 + voidState.pull);
  particle.age += deltaSeconds * 1000;

  const voidRadius = getVoidRadius(voidState.open);
  const distance = Math.hypot(center.x - particle.x, center.y - particle.y);
  particle.voidAlpha = smooth(voidRadius * timing.fadeCore, voidRadius * timing.fadeBorder, distance);

  if (particle.voidAlpha <= 0.03 || distance < voidRadius * timing.fadeCore * 0.72) {
    particle.age = particle.maxAge + 1;
  }
}

function isParticleExpired(particle) {
  if (particle.age > particle.maxAge) return true;

  const margin = Math.max(80, particle.radius * 12);
  return particle.x < -margin || particle.x > width + margin || particle.y < -margin || particle.y > height + margin;
}

function drawDragonParticles(now) {
  if (EFFECT_PROFILE.dragonParticleScale <= 0) return;

  const perspective = getParticlePerspective(now);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  drawDragonParticleSystem(dragonParticles.blue, getEmitterState("blue", perspective, now));
  drawDragonParticleSystem(dragonParticles.red, getEmitterState("red", perspective, now));
  ctx.restore();
}

function drawDragonParticleSystem(system, emitter) {
  if (!emitter.active) return;

  const visibility = emitter.focus * emitter.alpha * emitter.pressureFade;
  if (visibility <= 0.01) return;

  const side = SIDES[system.side];
  for (const particle of system.particles) {
    const fadeIn = smooth(0, 180, particle.age);
    const interference = particle.interference || 0;
    const alpha = Math.min(
      1,
      particle.alpha * visibility * fadeIn * (particle.voidAlpha ?? 1) * (1 + interference * 0.24),
    );
    if (alpha <= 0.01) continue;
    const radius = particle.radius * (1 + interference * 0.34);

    if (system.side === "red") {
      drawCinder(particle.x, particle.y, radius, alpha, side, particle);
    } else {
      drawSnowParticle(particle.x, particle.y, radius, particle.spin, alpha, particle);
    }
  }
}

function recycleParticleSystem(system) {
  const config = DRAGON_EMITTERS[system.side];
  for (const particle of system.particles) {
    if (system.pool.length < config.maxParticles) {
      system.pool.push(particle);
    }
  }
  system.particles.length = 0;
  system.spawnCarry = 0;
}

function clearDragonParticles() {
  for (const system of Object.values(dragonParticles)) {
    recycleParticleSystem(system);
  }
}

function drawCinder(x, y, radius, alpha, side, particle) {
  const color = side.particle[particle.hot ? 2 : particle.speed > 0.78 ? 1 : 0];
  const glowRadius = radius * (3.1 + particle.spread * 1.8);

  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(4, radius * 3.2);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
  glow.addColorStop(0, side.glow + "0.92)");
  glow.addColorStop(0.38, side.accent + "0.3)");
  glow.addColorStop(1, "rgba(255, 40, 0, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, TAU);
  ctx.fill();

  ctx.shadowBlur = Math.max(1.5, radius * 1.2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.55, radius * 0.78), 0, TAU);
  ctx.fill();
}

function drawSnowParticle(x, y, radius, spin, alpha, particle) {
  const glowRadius = radius * (1.8 + particle.spread * 1.2);

  ctx.globalAlpha = alpha * 0.24;
  ctx.shadowColor = "rgba(142, 223, 255, 0.85)";
  ctx.shadowBlur = Math.max(6, glowRadius);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
  glow.addColorStop(0, "rgba(215, 250, 255, 0.72)");
  glow.addColorStop(0.42, "rgba(93, 190, 255, 0.2)");
  glow.addColorStop(1, "rgba(93, 190, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, TAU);
  ctx.fill();

  ctx.shadowBlur = 0;
  if (particle.sharp) {
    ctx.globalAlpha = 1;
    drawSnowflake(x, y, Math.max(2, radius * 2.1), spin, alpha);
    return;
  }

  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(219, 250, 255, 0.96)";
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.8, radius * 0.85), 0, TAU);
  ctx.fill();
}

function drawSnowflake(x, y, radius, spin, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.strokeStyle = `rgba(190, 238, 255, ${alpha})`;
  ctx.lineWidth = Math.max(0.8, radius * 0.12);
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i += 1) {
    ctx.rotate(TAU / 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radius, 0);
    ctx.moveTo(radius * 0.55, 0);
    ctx.lineTo(radius * 0.74, radius * 0.16);
    ctx.moveTo(radius * 0.55, 0);
    ctx.lineTo(radius * 0.74, -radius * 0.16);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAmbientBackground(now, deltaMs) {
  if (!ambientCanvas || !ambientCtx) return;

  const deltaSeconds = deltaMs / 1000;
  ambientCtx.clearRect(0, 0, ambientWidth, ambientHeight);
  drawAmbientDarkness();
  if (EFFECT_PROFILE.ambientScale > 0) {
    updateAmbientParticles(now, deltaSeconds);
    drawAmbientParticles();
  } else if (ambientParticles.length) {
    clearAmbientParticles();
  }
}

function drawAmbientDarkness() {
  ambientCtx.save();
  ambientCtx.globalCompositeOperation = "source-over";
  ambientCtx.fillStyle = "#020205";
  ambientCtx.fillRect(0, 0, ambientWidth, ambientHeight);

  const vertical = ambientCtx.createLinearGradient(0, 0, 0, ambientHeight);
  vertical.addColorStop(0, "rgba(3, 4, 10, 0.82)");
  vertical.addColorStop(0.48, "rgba(8, 7, 14, 0.72)");
  vertical.addColorStop(1, "rgba(0, 0, 0, 0.94)");
  ambientCtx.fillStyle = vertical;
  ambientCtx.fillRect(0, 0, ambientWidth, ambientHeight);

  const center = ambientCtx.createRadialGradient(
    ambientWidth * 0.5,
    ambientHeight * 0.5,
    0,
    ambientWidth * 0.5,
    ambientHeight * 0.5,
    Math.max(ambientWidth, ambientHeight) * 0.78,
  );
  center.addColorStop(0, "rgba(19, 14, 34, 0.34)");
  center.addColorStop(0.55, "rgba(4, 4, 10, 0.14)");
  center.addColorStop(1, "rgba(0, 0, 0, 0)");
  ambientCtx.fillStyle = center;
  ambientCtx.fillRect(0, 0, ambientWidth, ambientHeight);

  ambientCtx.restore();
}

function updateAmbientParticles(now, deltaSeconds) {
  const activeSides = getAmbientActiveSides();

  for (const side of activeSides) {
    emitAmbientParticles(side, now, deltaSeconds);
  }

  let writeIndex = 0;
  for (const particle of ambientParticles) {
    updateAmbientParticle(particle, now, deltaSeconds);
    if (isAmbientParticleExpired(particle)) {
      if (ambientParticlePool.length < AMBIENT_BREATH.maxParticles) {
        ambientParticlePool.push(particle);
      }
    } else {
      ambientParticles[writeIndex] = particle;
      writeIndex += 1;
    }
  }
  ambientParticles.length = writeIndex;
}

function clearAmbientParticles() {
  while (ambientParticles.length) {
    const particle = ambientParticles.pop();
    if (ambientParticlePool.length < AMBIENT_BREATH.maxParticles) {
      ambientParticlePool.push(particle);
    }
  }
  ambientSpawnCarry.blue = 0;
  ambientSpawnCarry.red = 0;
  if (ambientCtx) {
    ambientCtx.clearRect(0, 0, ambientWidth, ambientHeight);
  }
}

function emitAmbientParticles(sideKey, now, deltaSeconds) {
  const mode = getAmbientMode();
  const burst = getPrivateBurstFactor(sideKey, mode, now);
  const wave = emitterRate(sideKey, now);
  const rateFloor = burst > 0 ? 0.78 : 0.08;
  const rate =
    AMBIENT_BREATH.spawnRate[sideKey] *
    (1 + burst * (PRIVATE_BURST_PARTICLE_MULTIPLIER - 1)) *
    Math.max(wave, rateFloor);

  ambientSpawnCarry[sideKey] += rate * deltaSeconds;
  const spawnLimit = burst > 0 ? AMBIENT_BREATH.burstSpawnLimit : AMBIENT_BREATH.idleSpawnLimit;
  const spawnCount = Math.min(spawnLimit, Math.floor(ambientSpawnCarry[sideKey]));
  if (spawnCount <= 0) return;

  ambientSpawnCarry[sideKey] -= spawnCount;
  for (let i = 0; i < spawnCount && ambientParticles.length < AMBIENT_BREATH.maxParticles; i += 1) {
    const particle = ambientParticlePool.pop() || {};
    resetAmbientParticle(particle, sideKey, burst);
    ambientParticles.push(particle);
  }
}

function resetAmbientParticle(particle, sideKey, burst = 0) {
  const rnd = ambientRnd;
  const slot = getAmbientDragonSlot(sideKey);
  const fromLeft = slot === "left";
  const direction = fromLeft ? 1 : -1;
  const isRed = sideKey === "red";
  const originX = fromLeft ? -ambientWidth * 0.05 : ambientWidth * 1.05;
  const originY = ambientHeight * (isRed ? 0.78 : 0.18) + (rnd() - 0.5) * ambientHeight * (isRed ? 0.16 : 0.14);
  const burstForce = 1 + burst * (PRIVATE_BURST_FORCE_MULTIPLIER - 1);
  const scale = Math.max(0.72, Math.min(1.4, Math.min(ambientWidth, ambientHeight) / 780));
  const speed = isRed ? 150 + rnd() * 210 : 180 + rnd() * 250;

  particle.side = sideKey;
  particle.x = originX + (rnd() - 0.5) * 28 * scale;
  particle.y = originY;
  particle.vx = direction * speed * burstForce * (isRed ? 0.92 : 1.08);
  particle.vy = isRed ? (-44 - rnd() * 88) * (1 + burst * 0.32) : (18 + rnd() * 52) * (1 - burst * 0.18);
  particle.radius = (isRed ? 1.4 + rnd() * 4.2 : 1.2 + rnd() * 4.8) * scale * (1 + burst * 0.16);
  particle.grow = (isRed ? 0.28 + rnd() * 0.62 : 0.12 + rnd() * 0.32) * scale;
  particle.alpha = isRed ? 0.52 + rnd() * 0.44 : 0.48 + rnd() * 0.5;
  particle.age = 0;
  particle.maxAge = 7600 + rnd() * 2600;
  particle.phase = rnd() * TAU;
  particle.windRate = isRed ? 0.002 + rnd() * 0.0014 : 0.0011 + rnd() * 0.001;
  particle.turbulence = (isRed ? 18 + rnd() * 42 : 10 + rnd() * 34) * scale;
  particle.spin = rnd() * TAU;
  particle.spinRate = (rnd() - 0.5) * (isRed ? 2.2 : 4.5);
  particle.spread = rnd();
  particle.speed = rnd();
  particle.hot = isRed && rnd() > 0.52;
  particle.sharp = !isRed && rnd() > 0.24;
}

function updateAmbientParticle(particle, now, deltaSeconds) {
  const isRed = particle.side === "red";
  const wind = Math.sin(now * particle.windRate + particle.phase) * particle.turbulence;
  const lift = isRed ? 22 : -8;

  particle.x += (particle.vx + wind) * deltaSeconds;
  particle.y += (particle.vy - lift) * deltaSeconds;
  particle.vx *= Math.pow(isRed ? 0.998 : 0.996, deltaSeconds * 60);
  particle.radius += particle.grow * deltaSeconds;
  particle.spin += particle.spinRate * deltaSeconds;
  particle.age += deltaSeconds * 1000;
  particle.alpha *= Math.pow(isRed ? 0.997 : 0.998, deltaSeconds * 60);
}

function isAmbientParticleExpired(particle) {
  if (particle.age > particle.maxAge || particle.alpha <= 0.012) return true;
  const margin = Math.max(80, particle.radius * 18);
  return (
    particle.x < -margin ||
    particle.x > ambientWidth + margin ||
    particle.y < -margin ||
    particle.y > ambientHeight + margin
  );
}

function drawAmbientParticles() {
  if (!ambientCtx) return;

  ambientCtx.save();
  ambientCtx.globalCompositeOperation = "lighter";
  for (const particle of ambientParticles) {
    const alpha = particle.alpha * smooth(0, 220, particle.age);
    if (alpha <= 0.01) continue;
    if (particle.side === "red") {
      drawAmbientCinder(particle, alpha);
    } else {
      drawAmbientSnow(particle, alpha);
    }
  }
  ambientCtx.restore();
}

function drawAmbientCinder(particle, alpha) {
  const side = SIDES.red;
  const color = side.particle[particle.hot ? 2 : particle.speed > 0.62 ? 1 : 0];
  const glowRadius = particle.radius * (4.2 + particle.spread * 2.1);
  const glowAlpha = Math.min(1, alpha * 1.18);

  ambientCtx.globalAlpha = glowAlpha;
  ambientCtx.shadowColor = color;
  ambientCtx.shadowBlur = Math.max(8, particle.radius * 5.2);
  const glow = ambientCtx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, glowRadius);
  glow.addColorStop(0, side.glow + "1)");
  glow.addColorStop(0.42, side.accent + "0.42)");
  glow.addColorStop(1, "rgba(255, 40, 0, 0)");
  ambientCtx.fillStyle = glow;
  ambientCtx.beginPath();
  ambientCtx.arc(particle.x, particle.y, glowRadius, 0, TAU);
  ambientCtx.fill();

  ambientCtx.globalAlpha = Math.min(1, alpha * 1.28);
  ambientCtx.shadowBlur = Math.max(3, particle.radius * 1.8);
  ambientCtx.fillStyle = color;
  ambientCtx.beginPath();
  ambientCtx.arc(particle.x, particle.y, Math.max(1, particle.radius * 0.82), 0, TAU);
  ambientCtx.fill();
}

function drawAmbientSnow(particle, alpha) {
  const glowRadius = particle.radius * (2.8 + particle.spread * 1.8);

  ambientCtx.globalAlpha = Math.min(1, alpha * 0.46);
  ambientCtx.shadowColor = "rgba(177, 239, 255, 0.96)";
  ambientCtx.shadowBlur = Math.max(10, glowRadius * 1.25);
  const glow = ambientCtx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, glowRadius);
  glow.addColorStop(0, "rgba(232, 253, 255, 1)");
  glow.addColorStop(0.46, "rgba(105, 205, 255, 0.42)");
  glow.addColorStop(1, "rgba(85, 187, 255, 0)");
  ambientCtx.fillStyle = glow;
  ambientCtx.beginPath();
  ambientCtx.arc(particle.x, particle.y, glowRadius, 0, TAU);
  ambientCtx.fill();

  ambientCtx.shadowBlur = 0;
  ambientCtx.globalAlpha = Math.min(1, alpha * 1.18);
  if (particle.sharp) {
    drawAmbientSnowflake(
      particle.x,
      particle.y,
      Math.max(2.4, particle.radius * 2),
      particle.spin,
      Math.min(1, alpha * 1.14),
    );
    return;
  }

  ambientCtx.fillStyle = "rgba(235, 253, 255, 1)";
  ambientCtx.beginPath();
  ambientCtx.arc(particle.x, particle.y, Math.max(0.95, particle.radius * 0.84), 0, TAU);
  ambientCtx.fill();
}

function drawAmbientSnowflake(x, y, radius, spin, alpha) {
  ambientCtx.save();
  ambientCtx.translate(x, y);
  ambientCtx.rotate(spin);
  ambientCtx.strokeStyle = `rgba(190, 238, 255, ${alpha})`;
  ambientCtx.lineWidth = Math.max(0.8, radius * 0.11);
  ambientCtx.lineCap = "round";
  for (let i = 0; i < 6; i += 1) {
    ambientCtx.rotate(TAU / 6);
    ambientCtx.beginPath();
    ambientCtx.moveTo(0, 0);
    ambientCtx.lineTo(radius, 0);
    ambientCtx.moveTo(radius * 0.55, 0);
    ambientCtx.lineTo(radius * 0.72, radius * 0.15);
    ambientCtx.moveTo(radius * 0.55, 0);
    ambientCtx.lineTo(radius * 0.72, -radius * 0.15);
    ambientCtx.stroke();
  }
  ambientCtx.restore();
}

function getAmbientMode() {
  if (!transition) return vibeMode;
  const progress = getTransitionProgress();
  return progress !== null && progress > 0.68
    ? transition.toMode || transition.to
    : transition.fromMode || transition.from;
}

function getAmbientActiveSides() {
  const mode = normalizeVibeMode(getAmbientMode());
  return mode === "mixed" ? ["blue", "red"] : [mode];
}

function getAmbientDragonSlot(sideKey) {
  const layout = transition && getTransitionProgress() > 0.68 ? transition.toLayout : dragonLayout;
  return getDragonSlot(sideKey, layout);
}

function drawTransition(now) {
  const elapsed = now - transition.start;
  const t = clamp(elapsed / TRANSITION_MS);
  const from = transition.from;
  const to = transition.to;
  const suckedSides = getTransitionSuckedSides(transition);
  const fromMode = transition.fromMode || from;
  const toMode = transition.toMode || to;
  const fromAlpha = 1 - smooth(0.44, 0.62, t);
  const toAlpha = incomingDragonAlpha(t);
  const pressure = smooth(0.16, 0.5, t);
  const shardTakeover = smooth(TRANSITION_CHOREOGRAPHY.shards.start, TRANSITION_CHOREOGRAPHY.shards.fullTakeover, t);
  const sideAlpha = {};
  for (const side of suckedSides) {
    sideAlpha[side] = 1 - shardTakeover;
  }

  drawPerspective(from, fromAlpha, now, pressure, {
    sideAlpha,
    layout: transition.fromLayout,
    mode: fromMode,
  });

  if (toAlpha > 0.01) {
    drawPerspective(to, toAlpha, now, 0, {
      layout: transition.toLayout,
      mode: toMode,
    });
  }

  if (!transition.particlesCleared && t >= TRANSITION_CHOREOGRAPHY.cleanup.clearParticlesAt) {
    clearDragonParticles();
    transition.particlesCleared = true;
  }

  for (const side of suckedSides) {
    const sideState = getPerspectiveState(side, fromAlpha, pressure, transition.fromLayout, fromMode);
    drawSuckedDragonShards(side, t, now, sideState, shardTakeover);
  }
  drawDragonParticles(now);
  drawTransitionEnergy(t, from, to, now, suckedSides);

  const blackoutTiming = TRANSITION_CHOREOGRAPHY.blackout;
  const blackout =
    smooth(blackoutTiming.start, blackoutTiming.full, t) *
    (1 - smooth(blackoutTiming.liftStart, blackoutTiming.end, t));
  if (blackout > 0.01) {
    ctx.save();
    ctx.globalAlpha = blackout;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  drawEyeReveal(t, to, now);

  if (t >= 1) {
    dragonLayout = cloneDragonLayout(transition.toLayout);
    currentSide = transition.to;
    vibeMode = toMode;
    setPageVibe(vibeMode);
    transition = null;
    setVibeSwitchFocus(false);
  }
}

function drawTransitionEnergy(t, from, to, now, suckedSides = [getSuckedSide()]) {
  const open = smooth(0.1, 0.34, t);
  const voidAlpha = smooth(0.12, 0.32, t) * (1 - smooth(0.59, 0.73, t));
  const particleTiming = TRANSITION_CHOREOGRAPHY.particles;
  const pull =
    smooth(particleTiming.visualPullStart, particleTiming.visualPullFull, t) *
    (1 - smooth(particleTiming.visualPullFadeStart, particleTiming.visualPullEnd, t));

  if (voidAlpha > 0.01) {
    drawMaskAperture(open, voidAlpha);
    drawVoid(open, voidAlpha, now);
  }

  drawMask(open, 1 - smooth(0.57, 0.68, t), now);

  if (pull > 0.01) {
    for (const side of suckedSides) {
      drawPull(side, pull, now);
    }
  }

  const flash = smooth(0.35, 0.48, t) * (1 - smooth(0.48, 0.58, t));
  if (flash > 0.01) {
    const flashAlpha = suckedSides.length > 1 ? flash * 0.72 : flash;
    for (const side of suckedSides) {
      drawConvergenceFlash(flashAlpha, SIDES[side], now);
    }
  }
}

function drawMaskAperture(open, alpha) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const mh = Math.min(height * 0.58, width * 0.34, 480);
  const mw = mh * 0.58;
  const spread = 0.82 + open * 0.38;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowColor = `rgba(104, 42, 255, ${0.38 + open * 0.22})`;
  ctx.shadowBlur = 34 + open * 40;

  const voidSkin = ctx.createRadialGradient(cx, cy, 0, cx, cy, mh * 0.72);
  voidSkin.addColorStop(0, "rgba(18, 4, 38, 0.98)");
  voidSkin.addColorStop(0.45, "rgba(3, 2, 15, 0.96)");
  voidSkin.addColorStop(1, "rgba(0, 0, 0, 0.18)");
  ctx.fillStyle = voidSkin;
  ctx.beginPath();
  ctx.moveTo(cx, cy - mh * 0.56 * spread);
  ctx.lineTo(cx + mw * 0.62 * spread, cy - mh * 0.18 * spread);
  ctx.lineTo(cx + mw * 0.64 * spread, cy + mh * 0.24 * spread);
  ctx.lineTo(cx, cy + mh * 0.55 * spread);
  ctx.lineTo(cx - mw * 0.64 * spread, cy + mh * 0.24 * spread);
  ctx.lineTo(cx - mw * 0.62 * spread, cy - mh * 0.18 * spread);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(197, 120, 255, ${0.18 + open * 0.24})`;
  ctx.lineWidth = Math.max(1, mh * 0.006);
  ctx.beginPath();
  ctx.ellipse(cx, cy, mw * 0.5 * spread, mh * 0.46 * spread, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawVoid(open, alpha, now) {
  const { x: cx, y: cy } = getVoidCenter();
  const size = getVoidRadius(open);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "lighter";

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.28);
  core.addColorStop(0, "rgba(255, 255, 255, 0.92)");
  core.addColorStop(0.08, "rgba(178, 83, 255, 0.95)");
  core.addColorStop(0.28, "rgba(74, 28, 168, 0.86)");
  core.addColorStop(0.62, "rgba(14, 10, 42, 0.8)");
  core.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * 0.82, size * 1.08, 0, 0, TAU);
  ctx.fill();

  ctx.lineWidth = Math.max(1, size * 0.012);
  for (let i = 0; i < 6; i += 1) {
    const radius = size * (0.25 + i * 0.14);
    const angle = now * 0.00045 * (i % 2 ? -1 : 1) + i;
    ctx.strokeStyle = `rgba(${90 + i * 20}, ${36 + i * 16}, 255, ${0.34 - i * 0.03})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 1.28, radius * 0.72, angle, 0, TAU);
    ctx.stroke();
  }

  for (const star of stars) {
    const angle = star.x * TAU + now * 0.00018;
    const r = size * (0.08 + star.y * 1.05);
    const x = cx + Math.cos(angle) * r * 0.82;
    const y = cy + Math.sin(angle) * r * 1.08;
    ctx.globalAlpha = alpha * star.a * (0.62 + Math.sin(now * 0.003 + star.p) * 0.38);
    ctx.fillStyle = "#f3e9ff";
    ctx.beginPath();
    ctx.arc(x, y, star.r, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

function drawMask(open, alpha, now) {
  if (alpha <= 0.01) return;
  const mh = Math.min(height * 0.58, width * 0.34, 480);
  const mw = mh * 0.58;
  const gap = open * mw * 0.88;
  const tilt = open * 0.18;
  const glowPulse = 0.76 + Math.sin(now * 0.003) * 0.24;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = `rgba(255, 178, 38, ${0.35 + glowPulse * 0.24})`;
  ctx.shadowBlur = 24 + open * 44;

  if (open < 0.02) {
    drawLayer("maskClosed", { alpha: 1 });
  } else {
    drawLayer("maskLeft", {
      alpha: 1,
      screenShiftX: -gap,
      rotate: -tilt,
      anchorX: 1,
      anchorY: 0.5,
    });
    drawLayer("maskRight", {
      alpha: 1,
      screenShiftX: gap,
      rotate: tilt,
      anchorX: 0,
      anchorY: 0.5,
    });
    drawMaskSplitLight(open, gap);
  }

  ctx.shadowBlur = 0;

  if (open < 0.25) {
    const eyeAlpha = (1 - open / 0.25) * alpha;
    drawMaskEyes(open, gap, tilt, eyeAlpha, now);
  }
  ctx.restore();
}

function drawMaskSplitLight(open, gap) {
  const rect = stageRect();
  const unit = rect.w / SOURCE_SIZE.w;
  const left = LAYERS.maskLeft;
  const right = LAYERS.maskRight;
  const leftX = rect.x + (left.x + left.w) * unit - gap;
  const rightX = rect.x + right.x * unit + gap;
  const y = rect.y + left.y * unit;
  const h = left.h * unit;
  const glowWidth = Math.max(8, unit * 34);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.24 + open * 0.38;

  let edge = ctx.createLinearGradient(leftX - glowWidth, 0, leftX + glowWidth, 0);
  edge.addColorStop(0, "rgba(255, 210, 72, 0)");
  edge.addColorStop(0.5, "rgba(255, 242, 176, 0.9)");
  edge.addColorStop(1, "rgba(255, 210, 72, 0)");
  ctx.fillStyle = edge;
  ctx.fillRect(leftX - glowWidth, y, glowWidth * 2, h);

  edge = ctx.createLinearGradient(rightX - glowWidth, 0, rightX + glowWidth, 0);
  edge.addColorStop(0, "rgba(255, 210, 72, 0)");
  edge.addColorStop(0.5, "rgba(255, 242, 176, 0.9)");
  edge.addColorStop(1, "rgba(255, 210, 72, 0)");
  ctx.fillStyle = edge;
  ctx.fillRect(rightX - glowWidth, y, glowWidth * 2, h);
  ctx.restore();
}

function drawMaskEyes(open, gap, tilt, alpha, now) {
  const pulse = 0.7 + Math.sin(now * 0.004) * 0.3;
  const flashAlpha = alpha * (0.72 + pulse * 0.28);
  const splitActive = open >= 0.02;
  const spread = sourcePixels(MASK_EYE_FLASH_SOURCE_SPREAD_X);

  if (!splitActive) {
    drawMaskEyePair(flashAlpha, spread);
    return;
  }

  drawLayer("maskEyesLeft", {
    alpha: flashAlpha,
    screenShiftX: -gap - spread,
    rotate: -tilt,
    anchorX: 1,
    anchorY: 0.5,
    composite: "lighter",
  });
  drawLayer("maskEyesRight", {
    alpha: flashAlpha,
    screenShiftX: gap + spread,
    rotate: tilt,
    anchorX: 0,
    anchorY: 0.5,
    composite: "lighter",
  });
}

function drawMaskEyePair(alpha, spread, options = {}) {
  const { scale = 1 } = options;

  drawLayer("maskEyesLeft", {
    alpha,
    screenShiftX: -spread,
    scale,
    composite: "lighter",
  });
  drawLayer("maskEyesRight", {
    alpha,
    screenShiftX: spread,
    scale,
    composite: "lighter",
  });
}

function maskEyeShapePoints(shapeKey, spread) {
  const shape = MASK_EYE_FLASH_SHAPES[shapeKey];
  const layer = LAYERS[shape.layer];
  const rect = stageRect();
  const unit = rect.w / SOURCE_SIZE.w;
  const screenShiftX = shapeKey === "left" ? -spread : spread;

  return shape.points.map(([x, y]) => ({
    x: rect.x + (layer.x + x) * unit + screenShiftX,
    y: rect.y + (layer.y + y) * unit,
  }));
}

function drawCleanMaskEyePair(alpha, spread, now) {
  drawCleanMaskEye("left", alpha, spread, now);
  drawCleanMaskEye("right", alpha, spread, now);
}

function drawCleanMaskEye(shapeKey, alpha, spread, now) {
  const points = maskEyeShapePoints(shapeKey, spread);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const eyeW = maxX - minX;
  const eyeH = maxY - minY;
  const pulse = 0.82 + Math.sin(now * 0.006) * 0.18;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha;

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, eyeW * 1.02);
  glow.addColorStop(0, "rgba(255, 247, 166, 0.48)");
  glow.addColorStop(0.42, "rgba(255, 205, 58, 0.18)");
  glow.addColorStop(1, "rgba(255, 152, 12, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(cx, cy, eyeW * 0.96, eyeH * (1.16 + pulse * 0.22), 0, 0, TAU);
  ctx.fill();

  const core = ctx.createRadialGradient(cx - eyeW * 0.08, cy - eyeH * 0.08, 0, cx, cy, eyeW * 0.88);
  core.addColorStop(0, "#fffde7");
  core.addColorStop(0.42, "#ffe36d");
  core.addColorStop(0.74, "#ffad24");
  core.addColorStop(1, "rgba(147, 59, 0, 0.18)");
  ctx.fillStyle = core;
  ctx.shadowColor = "rgba(255, 211, 68, 0.84)";
  ctx.shadowBlur = Math.max(10, eyeW * 0.18) * pulse;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 246, 179, 0.62)";
  ctx.lineWidth = Math.max(1, eyeH * 0.09);
  ctx.stroke();

  ctx.globalAlpha *= 0.55;
  ctx.strokeStyle = "rgba(255, 255, 224, 0.78)";
  ctx.lineWidth = Math.max(0.8, eyeH * 0.05);
  ctx.beginPath();
  ctx.moveTo(minX + eyeW * 0.16, cy - eyeH * 0.08);
  ctx.quadraticCurveTo(cx, minY + eyeH * 0.16, maxX - eyeW * 0.18, cy - eyeH * 0.04);
  ctx.stroke();

  ctx.restore();
}

function eyeRevealAlpha(t) {
  const timing = TRANSITION_CHOREOGRAPHY.eyeReveal;
  return smooth(timing.start, timing.full, t) * (1 - smooth(timing.fadeStart, timing.end, t));
}

function incomingDragonAlpha(t) {
  const timing = TRANSITION_CHOREOGRAPHY.incomingDragon;
  return smooth(timing.start, timing.full, t);
}

function dragonEyeReturnRemaining(t) {
  const timing = TRANSITION_CHOREOGRAPHY.dragonEyeReveal;
  return 1 - clamp((t - timing.fadeStart) / (timing.fadeEnd - timing.fadeStart));
}

function dragonEyeRevealAlpha(t) {
  const timing = TRANSITION_CHOREOGRAPHY.dragonEyeReveal;
  const reveal = eyeRevealOpen(t);
  const remaining = Math.pow(dragonEyeReturnRemaining(t), timing.fadeGamma);
  return reveal * remaining;
}

function getEyeRevealDebug(t) {
  if (t === null || t === undefined) return null;
  return {
    open: eyeRevealOpen(t),
    veilAlpha: eyeRevealAlpha(t) * dragonEyeReturnRemaining(t),
    dragonEyeAlpha: dragonEyeRevealAlpha(t),
    incomingDragonAlpha: incomingDragonAlpha(t),
    returnRemaining: dragonEyeReturnRemaining(t),
  };
}

function eyeRevealOpen(t) {
  const timing = TRANSITION_CHOREOGRAPHY.eyeReveal;
  return smooth(timing.start, timing.full, t);
}

function drawMaskEyeReveal(alpha, now) {
  const spread = sourcePixels(MASK_EYE_FLASH_SOURCE_SPREAD_X);

  drawCleanMaskEyePair(alpha, spread, now);
}

function drawDragonEyeFlash(sideKey, alpha, open, now) {
  const config = DRAGON_EYE_FLASH[sideKey];
  if (!config) return;

  const layout = transition ? transition.toLayout : dragonLayout;
  const mode = transition ? transition.toMode || sideKey : vibeMode;
  const perspective = getPerspectiveState(sideKey, 1, 0, layout, mode);
  const metrics = getDragonLayerMetrics(sideKey, perspective);
  const center = dragonLocalToScreen(metrics, config.x, config.y);
  const unit = metrics.unit;
  const direction = metrics.flipX ? -1 : 1;
  const pulse = 0.82 + Math.sin(now * 0.006) * 0.18;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  drawDragonEyeFlashShape({
    x: center.x,
    y: center.y,
    w: config.w * unit,
    h: config.h * unit,
    rotation: config.rotation * direction + DRAGON_EYE_FLASH_ROTATION_OFFSET + DRAGON_EYE_FLASH_CLOCKWISE_TILT,
    open,
    pulse,
    alpha,
  });

  ctx.restore();
}

function drawDragonEyeFlashShape({ x, y, w, h, rotation, open, pulse, alpha }) {
  const aperture = 0.08 + easeOutCubic(open) * 0.92;
  const visibleH = h * aperture;
  const coreAlpha = Math.pow(alpha, 1.75) * 0.36;
  const rimAlpha = Math.pow(alpha, 1.45) * 0.48;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  const glowRadius = w * (0.96 + pulse * 0.26);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
  glow.addColorStop(0, "rgba(255, 252, 184, 0.82)");
  glow.addColorStop(0.36, "rgba(255, 197, 54, 0.24)");
  glow.addColorStop(1, "rgba(255, 156, 16, 0)");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(0, 0, glowRadius, glowRadius * (0.16 + aperture * 0.42), 0, 0, TAU);
  ctx.fill();

  if (coreAlpha <= 0.001) {
    ctx.restore();
    return;
  }

  ctx.globalAlpha = coreAlpha;
  ctx.shadowColor = "rgba(255, 205, 66, 0.92)";
  ctx.shadowBlur = (5 + aperture * 7) * pulse;
  const eye = ctx.createRadialGradient(-w * 0.08, -visibleH * 0.05, 0, -w * 0.02, 0, w * 0.68);
  eye.addColorStop(0, "#fffce0");
  eye.addColorStop(0.38, "#ffd958");
  eye.addColorStop(0.72, "#f49b20");
  eye.addColorStop(1, "rgba(184, 76, 0, 0.1)");
  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.moveTo(-w * 0.58, visibleH * 0.08);
  ctx.quadraticCurveTo(-w * 0.18, -visibleH * 0.86, w * 0.55, -visibleH * 0.28);
  ctx.lineTo(w * 0.68, -visibleH * 0.04);
  ctx.quadraticCurveTo(w * 0.18, visibleH * 0.72, -w * 0.62, visibleH * 0.2);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.globalAlpha = rimAlpha;
  ctx.strokeStyle = "rgba(255, 242, 166, 0.66)";
  ctx.lineWidth = Math.max(1, h * (0.035 + aperture * 0.045));
  ctx.stroke();

  ctx.globalAlpha = rimAlpha * 0.62;
  ctx.strokeStyle = "rgba(255, 255, 223, 0.72)";
  ctx.lineWidth = Math.max(0.8, h * (0.02 + aperture * 0.025));
  ctx.beginPath();
  ctx.moveTo(-w * 0.35, visibleH * 0.02);
  ctx.quadraticCurveTo(-w * 0.04, -visibleH * 0.38, w * 0.32, -visibleH * 0.12);
  ctx.stroke();

  ctx.restore();
}

function drawPull(sideKey, progress, now) {
  const side = SIDES[sideKey];
  const layout = transition ? transition.fromLayout : dragonLayout;
  const isRight = getDragonSlot(sideKey, layout) === "right";
  const originX = width * (isRight ? 0.75 : 0.25);
  const originY = height * 0.52;
  const targetX = width * 0.5;
  const targetY = height * 0.51;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of pullParticles) {
    const local = clamp((progress - p.delay) / p.life);
    if (local <= 0 || local >= 1) continue;
    const eased = easeOutCubic(local);
    const spiral = Math.sin(eased * TAU * 1.4 + p.orbit) * p.curve;
    const sx = originX + p.spreadX * width * (isRight ? 0.55 : 0.48);
    const sy = originY + p.spreadY * height * 0.45;
    const tx = targetX + p.tx * width + Math.cos(p.orbit + now * 0.004) * 12;
    const ty = targetY + p.ty * height + Math.sin(p.orbit + now * 0.004) * 12;
    const x = sx + (tx - sx) * eased + spiral * width * 0.05 * (isRight ? -1 : 1);
    const y = sy + (ty - sy) * eased + Math.sin(eased * Math.PI) * height * 0.08;
    const fade = Math.sin(local * Math.PI);
    const size = p.size * (1 - eased * 0.55);
    const color = side.particle[p.hot ? 2 : p.rx > 0.42 ? 1 : 0];

    ctx.globalAlpha = fade * 0.92;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 + size * 4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = fade * 0.26;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.8, size * 0.44);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - (tx - sx) * 0.025, y - (ty - sy) * 0.025);
    ctx.stroke();
  }
  ctx.restore();
}

function drawConvergenceFlash(alpha, side, now) {
  const cx = width * 0.5;
  const cy = height * 0.51;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha;
  const rayCount = 24;
  for (let i = 0; i < rayCount; i += 1) {
    const angle = (i / rayCount) * TAU + now * 0.00025;
    const length = Math.min(width, height) * (0.22 + (i % 5) * 0.045);
    ctx.strokeStyle = i % 2 ? side.glow + "0.56)" : "rgba(174, 91, 255, 0.44)";
    ctx.lineWidth = i % 3 === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * 18, cy + Math.sin(angle) * 18);
    ctx.lineTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
    ctx.stroke();
  }
  const flash = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(width, height) * 0.36);
  flash.addColorStop(0, "rgba(255, 255, 236, 0.9)");
  flash.addColorStop(0.18, "rgba(192, 79, 255, 0.5)");
  flash.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = flash;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(width, height) * 0.36, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawEyeReveal(t, sideKey, now) {
  const alpha = eyeRevealAlpha(t);
  const open = eyeRevealOpen(t);
  const veilAlpha = alpha * dragonEyeReturnRemaining(t);
  const dragonEyeAlpha = dragonEyeRevealAlpha(t);
  const minEyeAlpha = TRANSITION_CHOREOGRAPHY.dragonEyeReveal.minDrawAlpha;

  if (veilAlpha <= 0.002 && dragonEyeAlpha <= minEyeAlpha) return;

  if (veilAlpha > 0.002) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = veilAlpha;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  if (MASK_EYE_REVEAL_ENABLED) {
    drawMaskEyeReveal(veilAlpha, now);
  }
  if (dragonEyeAlpha > minEyeAlpha) {
    drawDragonEyeFlash(sideKey, dragonEyeAlpha * 0.94, open, now);
  }
}

function drawIdle(now) {
  drawPerspective(currentSide, 1, now, 0, { mode: vibeMode });
  drawDragonParticles(now);
}

function scheduleFrame() {
  if (frameRequest === null) {
    frameRequest = requestAnimationFrame(frame);
  }
}

function frame(now) {
  const frameStart = performance.now();
  frameRequest = null;
  const deltaMs = lastFrame ? Math.min(50, Math.max(0, now - lastFrame)) : 16.67;
  lastFrame = now;
  drawAmbientBackground(now, deltaMs);
  ctx.clearRect(0, 0, width, height);

  if (!assetsReady) {
    ctx.fillStyle = "#020205";
    ctx.fillRect(0, 0, width, height);
    return;
  }

  updateDragonParticles(now, deltaMs);

  if (transition) {
    drawTransition(now);
  } else {
    drawIdle(now);
  }

  if (running || transition) {
    scheduleFrame();
  }
  recordPerf("frameMs", performance.now() - frameStart);
}

function toggleTransition(chosenSide = null) {
  completeExpiredTransition();

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const fromSide = currentSide;
    const fromMode = vibeMode;
    let completedSuckedSides = [];
    if (vibeMode === "mixed") {
      const nextSide = chosenSide === "red" || chosenSide === "blue" ? chosenSide : getLeftDragonSide(dragonLayout);
      dragonLayout = layoutForActiveSide(nextSide);
      currentSide = nextSide;
      vibeMode = nextSide;
      completedSuckedSides = ["blue", "red"];
      setPageVibe(vibeMode);
    } else {
      completedSuckedSides = [getSuckedSide(dragonLayout)];
      dragonLayout = swappedDragonLayout(dragonLayout);
      currentSide = getLeftDragonSide(dragonLayout);
      vibeMode = currentSide;
      setPageVibe(vibeMode);
    }
    transition = null;
    setVibeSwitchFocus(false);
    emitTDHEvent("transition-end", {
      from: fromSide,
      to: currentSide,
      fromMode,
      toMode: vibeMode,
      suckedSides: completedSuckedSides,
    });
    scheduleFrame();
    return;
  }

  if (transition) return;

  if (vibeMode === "mixed") {
    const nextSide = chosenSide === "red" || chosenSide === "blue" ? chosenSide : getLeftDragonSide(dragonLayout);
    const fromLayout = cloneDragonLayout(dragonLayout);
    const toLayout = layoutForActiveSide(nextSide);
    transition = {
      from: currentSide,
      to: nextSide,
      fromMode: "mixed",
      toMode: nextSide,
      fromLayout,
      toLayout,
      suckedSides: ["blue", "red"],
      particlesCleared: false,
      start: getTransitionStartTime(),
    };
    emitTDHEvent("transition-start", {
      from: transition.from,
      to: transition.to,
      fromMode: transition.fromMode,
      toMode: transition.toMode,
      suckedSides: [...transition.suckedSides],
    });
    running = true;
    setVibeSwitchFocus(true);
    scheduleFrame();
    return;
  }

  const fromLayout = cloneDragonLayout(dragonLayout);
  const toLayout = swappedDragonLayout(fromLayout);
  const nextSide = getLeftDragonSide(toLayout);
  transition = {
    from: currentSide,
    to: nextSide,
    fromMode: vibeMode,
    toMode: nextSide,
    fromLayout,
    toLayout,
    suckedSides: [getSuckedSide(fromLayout)],
    particlesCleared: false,
    start: getTransitionStartTime(),
  };
  emitTDHEvent("transition-start", {
    from: transition.from,
    to: transition.to,
    fromMode: transition.fromMode,
    toMode: transition.toMode,
    suckedSides: [...transition.suckedSides],
  });
  running = true;
  setVibeSwitchFocus(true);
  scheduleFrame();
}

function completeExpiredTransition(now = performance.now()) {
  if (!transition || now - transition.start < TRANSITION_MS) return false;

  const completedTransition = transition;
  clearDragonParticles();
  dragonLayout = cloneDragonLayout(transition.toLayout);
  currentSide = transition.to;
  vibeMode = transition.toMode || transition.to;
  setPageVibe(vibeMode);
  transition = null;
  setVibeSwitchFocus(false);
  emitTDHEvent("transition-end", {
    from: completedTransition.from,
    to: completedTransition.to,
    fromMode: completedTransition.fromMode,
    toMode: completedTransition.toMode,
    suckedSides: [...completedTransition.suckedSides],
  });
  return true;
}

function getChosenSideFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const slot = event.clientX - rect.left < rect.width * 0.5 ? "left" : "right";
  return slot === "left" ? getLeftDragonSide(dragonLayout) : getRightDragonSide(dragonLayout);
}

function getChosenSideFromViewport(clientX) {
  const slot = clientX < window.innerWidth * 0.5 ? "left" : "right";
  return slot === "left" ? getLeftDragonSide(dragonLayout) : getRightDragonSide(dragonLayout);
}

function getPrivateBurstFactor(sideKey, mode, now) {
  if (now >= privateBurstUntil || !isDragonActiveForMode(sideKey, mode)) return 0;
  const remaining = clamp((privateBurstUntil - now) / PRIVATE_BURST_MS);
  return Math.min(1, remaining * 3);
}

function startInitialLoreFlow() {
  if (initialLoreFlowStarted) return;

  initialLoreFlowStarted = true;
  emitTDHEvent("welcome-start", { flowMode: "initial" });
  startPrivateLorePrompt("initial", {
    fullscreen: WELCOME_CONFIG.initialFullscreen !== false,
    instant: WELCOME_CONFIG.initialFullscreen !== false,
    promptDelayMs: INITIAL_LORE_PROMPT_DELAY_MS,
  });
}

function startPrivateLorePrompt(mode = "privateAction", options = {}) {
  if (transition || privateLorePromptActive) return;

  privateLoreFlowMode = mode;
  if (mode === "initial") {
    currentSide = "blue";
    vibeMode = "mixed";
    dragonLayout = cloneDragonLayout(INITIAL_DRAGON_LAYOUT);
    clearDragonParticles();
    setPageVibe(vibeMode);
  }

  running = true;
  if (options.fullscreen !== false) {
    setVibeSwitchFocus(true, { instant: Boolean(options.instant) });
  }
  scheduleFrame();
  if (mode === "initial" && WELCOME_CONFIG.initialLore === false) return;
  window.setTimeout(showPrivateLorePrompt, options.promptDelayMs ?? 180);
}

function showPrivateLorePrompt() {
  if (privateLorePromptActive) return;

  if (privateLoreDismissTimer !== null) {
    window.clearTimeout(privateLoreDismissTimer);
    privateLoreDismissTimer = null;
  }

  removePrivateLorePrompt();
  privateLoreYesBurstPrimed = false;
  privateLorePromptActive = true;
  if (privateLoreFlowMode === "initial") {
    ensurePrivateAudio();
  }
  privateLoreModal = document.createElement("div");
  privateLoreModal.className = "private-lore-modal";
  privateLoreModal.innerHTML = `
    <div class="private-lore-dialog horn-panel" role="dialog" aria-modal="true" aria-labelledby="private-lore-title">
      <p id="private-lore-title">Connect your wallet to learn more dragon lore?</p>
      <p class="private-lore-status" aria-live="polite"></p>
      <div class="private-lore-actions">
        <button class="private-lore-choice private-lore-choice--yes" type="button">Yes</button>
        <button class="private-lore-choice private-lore-choice--no" type="button">No</button>
      </div>
    </div>
  `;

  for (const eventName of ["click", "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
    privateLoreModal.addEventListener(eventName, consumePrivateLoreEvent);
  }

  const yesButton = privateLoreModal.querySelector(".private-lore-choice--yes");
  const noButton = privateLoreModal.querySelector(".private-lore-choice--no");
  yesButton.addEventListener("pointerdown", primePrivateLoreYesBurst);
  yesButton.addEventListener("click", handlePrivateLoreYes);
  noButton.addEventListener("click", handlePrivateLoreNo);

  document.body.appendChild(privateLoreModal);
  emitTDHEvent("lore-prompt-open", { flowMode: privateLoreFlowMode, step: "wallet" });
  requestAnimationFrame(() => {
    if (!privateLoreModal) return;
    privateLoreModal.classList.add("is-visible");
    yesButton.focus({ preventScroll: true });
  });
}

function consumePrivateLoreEvent(event) {
  event.stopPropagation();
}

function primePrivateLoreYesBurst() {
  if (privateLoreFlowMode !== "initial" || privateLoreYesBurstPrimed) return;
  privateLoreYesBurstPrimed = true;
  startPrivateBurst({ immediateAudio: true });
}

async function handlePrivateLoreYes(event) {
  event.preventDefault();
  event.stopPropagation();
  if (privateLoreFlowMode === "initial") {
    if (!privateLoreYesBurstPrimed) {
      privateLoreYesBurstPrimed = true;
      startPrivateBurst({ immediateAudio: true });
    }
    const yesButton = privateLoreModal?.querySelector(".private-lore-choice--yes");
    const status = privateLoreModal?.querySelector(".private-lore-status");
    if (yesButton) {
      yesButton.disabled = true;
      yesButton.textContent = "Connecting...";
    }
    if (status) status.textContent = "";

    const connected = await requestDragonWalletConnection(status);
    if (!connected) {
      if (yesButton) {
        yesButton.disabled = false;
        yesButton.textContent = "Yes";
        yesButton.focus({ preventScroll: true });
      }
      privateLoreYesBurstPrimed = false;
      return;
    }

    dismissPrivateLorePrompt(showDragonLorePrompt);
    return;
  }

  dismissPrivateLorePrompt();
  startPrivateBurst();
}

function handlePrivateLoreNo(event) {
  event.preventDefault();
  event.stopPropagation();
  dismissPrivateLorePrompt(() => {
    window.location.assign(RICK_ASTLEY_URL);
  });
}

async function requestDragonWalletConnection(status) {
  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  try {
    const connector = window.CVCDragonApp?.connectWalletForDragon;
    if (typeof connector !== "function") {
      setStatus("Wallet gate is still loading. Try again.");
      return false;
    }

    const connected = await connector();
    if (!connected) {
      setStatus("Wallet connection is required before entering.");
      return false;
    }
    return true;
  } catch (error) {
    setStatus(error?.shortMessage ?? error?.message ?? "Wallet connection failed.");
    return false;
  }
}

function dismissPrivateLorePrompt(afterDismiss = null) {
  if (!privateLoreModal) {
    privateLorePromptActive = false;
    if (afterDismiss) afterDismiss();
    return;
  }

  const modal = privateLoreModal;
  const dialog = modal.querySelector(".private-lore-dialog");
  privateLorePromptActive = true;
  modal.classList.add("is-dismissing");
  if (dialog) {
    tessellatePrivateLoreDialog(dialog);
  }

  if (privateLoreDismissTimer !== null) {
    window.clearTimeout(privateLoreDismissTimer);
  }
  privateLoreDismissTimer = window.setTimeout(() => {
    privateLoreDismissTimer = null;
    if (privateLoreModal === modal) {
      removePrivateLorePrompt();
    } else {
      modal.remove();
    }
    privateLorePromptActive = false;
    emitTDHEvent("lore-prompt-close", { flowMode: privateLoreFlowMode });
    if (afterDismiss) afterDismiss();
  }, PRIVATE_LORE_DISMISS_MS);
}

function removePrivateLorePrompt() {
  privateLoreYesBurstPrimed = false;
  if (privateLoreDetailModal) {
    privateLoreDetailModal.remove();
    privateLoreDetailModal = null;
  }
  if (privateLoreModal) {
    privateLoreModal.remove();
    privateLoreModal = null;
  }
}

function tessellatePrivateLoreDialog(dialog) {
  const rect = dialog.getBoundingClientRect();
  const modalRect = privateLoreModal.getBoundingClientRect();
  const cols = 4;
  const rows = 3;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const shard = document.createElement("span");
      shard.className = "private-lore-shard";
      shard.style.left = `${rect.left - modalRect.left + (rect.width * col) / cols}px`;
      shard.style.top = `${rect.top - modalRect.top + (rect.height * row) / rows}px`;
      shard.style.width = `${rect.width / cols}px`;
      shard.style.height = `${rect.height / rows}px`;
      shard.style.setProperty("--tx", `${(col - (cols - 1) / 2) * 28}px`);
      shard.style.setProperty("--ty", `${(row - (rows - 1) / 2) * 24 - 14}px`);
      shard.style.setProperty("--rot", `${(col - row) * 5}deg`);
      privateLoreModal.appendChild(shard);
    }
  }
}

function showDragonLorePrompt() {
  if (privateLoreDismissTimer !== null) {
    window.clearTimeout(privateLoreDismissTimer);
    privateLoreDismissTimer = null;
  }

  removePrivateLorePrompt();
  privateLorePromptActive = true;
  privateLoreModal = document.createElement("div");
  privateLoreModal.className = "private-lore-modal private-lore-modal--dragon-choice";
  privateLoreModal.innerHTML = `
    <div class="private-lore-dialog private-lore-dialog--lore horn-panel" role="dialog" aria-modal="true" aria-labelledby="dragon-lore-title">
      <p id="dragon-lore-title" class="dragon-lore-title">Inside you there are two dragons. But it is time to choose.</p>
      <div class="dragon-lore-grid">
        <section class="dragon-lore-card dragon-lore-card--red" aria-label="Red dragon lore" title="You want to borrow eUSD against your vesting tokens.">
          <span>Red Dragon</span>
          <strong>High time preference</strong>
          <p>Fiery. You know what you want and you want it right now. Borrow eUSD against vesting tokens.</p>
        </section>
        <section class="dragon-lore-card dragon-lore-card--blue" aria-label="Blue dragon lore" title="You want to lend eUSD against vesting-token collateral and gain exposure.">
          <span>Blue Dragon</span>
          <strong>Low time preference</strong>
          <p>You are cool and want exposure. Lend eUSD against vesting-token collateral and let time work.</p>
        </section>
      </div>
      <div class="dragon-lore-cta">
        <button class="private-lore-choice private-lore-choice--wtaf" type="button" title="Red borrows eUSD now. Blue lends eUSD for exposure.">WTAF</button>
        <button class="private-lore-choice private-lore-choice--choose" type="button">Choose</button>
      </div>
    </div>
  `;

  for (const eventName of ["click", "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
    privateLoreModal.addEventListener(eventName, consumePrivateLoreEvent);
  }

  const wtafButton = privateLoreModal.querySelector(".private-lore-choice--wtaf");
  const chooseButton = privateLoreModal.querySelector(".private-lore-choice--choose");
  wtafButton.addEventListener("click", showDragonLoreDetailsModal);
  chooseButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dismissPrivateLorePrompt();
  });

  document.body.appendChild(privateLoreModal);
  emitTDHEvent("lore-choice-open", { flowMode: privateLoreFlowMode });
  requestAnimationFrame(() => {
    if (!privateLoreModal) return;
    privateLoreModal.classList.add("is-visible");
    wtafButton.focus({ preventScroll: true });
  });
}

function showDragonLoreDetailsModal(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!privateLoreModal || privateLoreDetailModal) return;

  privateLoreDetailModal = document.createElement("div");
  privateLoreDetailModal.className = "dragon-lore-detail-modal";
  privateLoreDetailModal.innerHTML = `
    <div class="dragon-lore-detail-dialog horn-panel" role="dialog" aria-modal="true" aria-labelledby="dragon-lore-detail-title">
      <p id="dragon-lore-detail-title">WTAF</p>
      <div class="dragon-lore-detail-copy">
        <p>Ha Ha Ha! Well met traveler! We know learning dragon lore can be a bit much, so here's a translation to mortal human language:</p>
        <p class="dragon-lore-detail-line"><span class="dragon-lore-icon" aria-hidden="true">🔑</span><span>This is a lending protocol, but a bit different than what is out there already.</span></p>
        <p class="dragon-lore-detail-line"><span class="dragon-lore-icon dragon-lore-red" aria-hidden="true">‼️</span><span>For the first time your loan terms and negotiating preferences are completely private thanks to Zama FHE technology: TokenOps, ERC-7984 and confidential smart contracts!</span></p>
        <p class="dragon-lore-detail-line"><span class="dragon-lore-icon" aria-hidden="true">➡️</span><span>The idea is that a Borrower (Red Dragon) having vesting tokens can submit a confidential offer to borrow against them, from a Lender (Blue Dragon) and if the Borrower defaults the Lender gets the tokens.</span></p>
        <p class="dragon-lore-detail-line"><span class="dragon-lore-icon" aria-hidden="true">ℹ️</span><span>The main use case is illiquid vesting tokens, think internet capital markets startups, but people want to access the value behind this equity, and others want to access exposure to this equity. It's really a borrower's market, where sophisticated lenders choose terms, to adequately compensate for no price-based liquidation since loan terms are fully agreed upon beforehand.</span></p>
        <p class="dragon-lore-detail-line"><span class="dragon-lore-icon" aria-hidden="true">ℹ️</span><span>Offers and Loans are created with Confidential Bundles of conditions, that each user configures as a negotiating strategy. A matching engine considers potential matches before finding a game-theoretic Nash-equilibrium confidential loan agreement and executing it.</span></p>
        <div class="dragon-lore-detail-flow">
          <span class="dragon-lore-icon" aria-hidden="true">🛠️</span>
          <div>
            <strong>Demo Flow:</strong>
            <ol>
              <li>Onboard some demo capital as either Borrower or Lender in the Demo Utils section of the page.</li>
              <li>Use the Builder page to create and publish a Private Offer by configuring a bundle of negotiation preferences.</li>
              <li>Execute your deal offer against counterparties, confidentially, using the Loans section.</li>
            </ol>
          </div>
        </div>
        <p class="dragon-lore-detail-line"><span class="dragon-lore-icon" aria-hidden="true">❓</span><span><strong>Other notes:</strong> The dragon picture controls transitions between Borrower and Lender perspectives.</span></p>
      </div>
      <button class="private-lore-choice private-lore-choice--close" type="button">Dismiss</button>
    </div>
  `;

  for (const eventName of ["click", "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
    privateLoreDetailModal.addEventListener(eventName, consumePrivateLoreEvent);
  }

  const closeButton = privateLoreDetailModal.querySelector(".private-lore-choice--close");
  closeButton.addEventListener("click", closeDragonLoreDetailsModal);
  privateLoreModal.appendChild(privateLoreDetailModal);
  emitTDHEvent("lore-details-open");
  requestAnimationFrame(() => {
    if (!privateLoreDetailModal) return;
    privateLoreDetailModal.classList.add("is-visible");
    closeButton.focus({ preventScroll: true });
  });
}

function closeDragonLoreDetailsModal(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!privateLoreDetailModal) return;

  const modal = privateLoreDetailModal;
  modal.classList.remove("is-visible");
  window.setTimeout(() => {
    if (privateLoreDetailModal === modal) {
      modal.remove();
      privateLoreDetailModal = null;
      emitTDHEvent("lore-details-close");
    }
  }, 180);
}

function ensurePrivateAudio() {
  if (!privateAudio) {
    privateAudio = new Audio(withCacheFlag(assetUrl(ASSET_MANIFEST.audio.gojira)));
    privateAudio.preload = "auto";
    privateAudio.addEventListener(
      "canplaythrough",
      () => {
        privateAudioAvailable = true;
      },
      { once: true },
    );
    privateAudio.addEventListener("error", () => {
      privateAudioAvailable = false;
    });
    privateAudio.load();
  }
  return privateAudio;
}

function startPrivateBurst(options = {}) {
  ensurePrivateAudio();
  privateBurstUntil = performance.now() + PRIVATE_BURST_MS;
  emitTDHEvent("private-burst-start", { durationMs: PRIVATE_BURST_MS });
  if (privateAudioTimer !== null) {
    window.clearTimeout(privateAudioTimer);
  }
  const playPrivateAudio = () => {
    privateAudioTimer = null;
    privateAudio.currentTime = 0;
    privateAudio.play().catch(() => {});
  };
  if (options.immediateAudio) {
    playPrivateAudio();
  } else {
    privateAudioTimer = window.setTimeout(playPrivateAudio, PRIVATE_AUDIO_DELAY_MS);
  }
  if (privateActionButton) {
    privateActionButton.classList.add("is-firing");
    window.setTimeout(() => privateActionButton.classList.remove("is-firing"), PRIVATE_BURST_MS);
  }
  running = true;
  scheduleFrame();
}

function triggerPrivateAction() {
  startPrivateLorePrompt();
}

function setInteractive(enabled) {
  if (vibeSwitch) {
    vibeSwitch.style.pointerEvents = enabled ? "auto" : "none";
  }
}

function enableWorkspaceDragScroll() {
  if (!appShell) return;

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startScrollLeft = 0;
  let startScrollTop = 0;
  let dragging = false;

  appShell.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target !== appShell) return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startScrollLeft = appShell.scrollLeft;
    startScrollTop = appShell.scrollTop;
    dragging = false;
    appShell.setPointerCapture(pointerId);
  });

  appShell.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > 4) {
      dragging = true;
      appShell.classList.add("is-dragging");
    }
    if (!dragging) return;

    appShell.scrollLeft = startScrollLeft - dx;
    appShell.scrollTop = startScrollTop - dy;
    event.preventDefault();
  });

  const endDrag = (event) => {
    if (pointerId !== event.pointerId) return;
    if (appShell.hasPointerCapture(pointerId)) {
      appShell.releasePointerCapture(pointerId);
    }
    pointerId = null;
    dragging = false;
    appShell.classList.remove("is-dragging");
  };

  appShell.addEventListener("pointerup", endDrag);
  appShell.addEventListener("pointercancel", endDrag);
}

function handleWindowResize() {
  resize();
  scheduleFrame();
}

function handleVibeSwitchClick(event) {
  const chosenSide = getChosenSideFromPointer(event);
  emitTDHEvent("choice", { chosenSide, source: "thumbnail" });
  toggleTransition(chosenSide);
}

function handleVibeSwitchKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;

  event.preventDefault();
  const chosenSide = getLeftDragonSide(dragonLayout);
  emitTDHEvent("choice", { chosenSide, source: "keyboard" });
  toggleTransition(chosenSide);
}

function handleCanvasClick(event) {
  const chosenSide = getChosenSideFromPointer(event);
  emitTDHEvent("choice", { chosenSide, source: "canvas" });
  toggleTransition(chosenSide);
}

function handlePrivateActionClick() {
  triggerPrivateAction();
}

function handleVisibilityChange() {
  running = document.visibilityState === "visible";
  if (running) scheduleFrame();
}

function onTDHEvent(name, handler) {
  const eventName = name.includes(":") ? name : `${WELCOME_CONFIG.eventPrefix}:${name}`;
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}

function offTDHEvent(name, handler) {
  const eventName = name.includes(":") ? name : `${WELCOME_CONFIG.eventPrefix}:${name}`;
  window.removeEventListener(eventName, handler);
}

function openWelcome(options = {}) {
  startPrivateLorePrompt("initial", {
    fullscreen: options.fullscreen !== false,
    instant: options.instant !== false,
    promptDelayMs: options.promptDelayMs ?? INITIAL_LORE_PROMPT_DELAY_MS,
  });
}

function mountWelcome(options = {}) {
  if (options.mode) {
    window.TDHTransition.setMode(options.mode);
  }
  if (options.fullscreen) {
    setVibeSwitchFocus(true, { instant: Boolean(options.instant) });
  }
  if (options.showIntroLore) {
    openWelcome({
      fullscreen: options.fullscreen !== false,
      instant: options.instant !== false,
      promptDelayMs: options.promptDelayMs,
    });
  }
  emitTDHEvent("mount", { config: publicWelcomeConfig() });
  return window.TDHWelcome;
}

function destroyTDHWelcome() {
  running = false;
  transition = null;
  clearDragonParticles();
  clearAmbientParticles();
  removePrivateLorePrompt();
  clearVibeOverlayPixelCanvas();
  if (frameRequest !== null) {
    cancelAnimationFrame(frameRequest);
    frameRequest = null;
  }
  if (privateAudioTimer !== null) {
    window.clearTimeout(privateAudioTimer);
    privateAudioTimer = null;
  }
  if (privateLoreDismissTimer !== null) {
    window.clearTimeout(privateLoreDismissTimer);
    privateLoreDismissTimer = null;
  }
  if (vibeOverlayLiveTimer !== null) {
    window.clearTimeout(vibeOverlayLiveTimer);
    vibeOverlayLiveTimer = null;
  }
  if (privateAudio) {
    privateAudio.pause();
    privateAudio.currentTime = 0;
  }
  if (vibeOverlay) {
    if (vibeFrame && canvas.parentElement !== vibeFrame) {
      vibeFrame.appendChild(canvas);
    }
    vibeOverlay.remove();
    vibeOverlay = null;
    if (vibeSwitch) vibeSwitch.classList.remove("is-expanded");
  }
  document.body.classList.remove("vibe-transitioning");
  if (resizeObserver) resizeObserver.disconnect();
  window.removeEventListener("resize", handleWindowResize);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  if (vibeSwitch) {
    vibeSwitch.removeEventListener("click", handleVibeSwitchClick);
    vibeSwitch.removeEventListener("keydown", handleVibeSwitchKeydown);
  } else {
    canvas.removeEventListener("click", handleCanvasClick);
  }
  if (privateActionButton) {
    privateActionButton.removeEventListener("click", handlePrivateActionClick);
  }
  emitTDHEvent("destroy");
}

window.TDHTransition = {
  buildId: BUILD_ID,
  timing: TRANSITION_CHOREOGRAPHY,
  transitionMs: TRANSITION_MS,
  toggle: toggleTransition,
  getState() {
    completeExpiredTransition();
    const progress = transition ? clamp((performance.now() - transition.start) / TRANSITION_MS) : null;
    return {
      side: currentSide,
      mode: vibeMode,
      layout: cloneDragonLayout(dragonLayout),
      leftSide: getLeftDragonSide(dragonLayout),
      rightSide: getRightDragonSide(dragonLayout),
      isTransitioning: Boolean(transition),
      targetSide: transition ? transition.to : currentSide,
      targetLayout: transition ? cloneDragonLayout(transition.toLayout) : cloneDragonLayout(dragonLayout),
      progress,
      eyeReveal: getEyeRevealDebug(progress),
      suckedSides: transition ? getTransitionSuckedSides(transition) : [getSuckedSide(dragonLayout)],
      particlesCleared: transition ? transition.particlesCleared : false,
      particleCounts: {
        blue: dragonParticles.blue.particles.length,
        red: dragonParticles.red.particles.length,
      },
      particleInterference: {
        pairs: mixedParticleInterferenceStats.pairs,
        radius: mixedParticleInterferenceStats.radius,
      },
      privateLorePromptActive,
      privateBurstActive: performance.now() < privateBurstUntil,
      privateAudioAvailable,
    };
  },
  sampleEyeFade(steps = 12) {
    const count = Math.max(2, Math.min(32, Math.floor(steps)));
    return Array.from({ length: count }, (_, index) => {
      const progress = index / (count - 1);
      return {
        progress,
        ...getEyeRevealDebug(progress),
      };
    });
  },
  getPerf() {
    return {
      ...perfStats,
      effectProfile: EFFECT_PROFILE.name,
      dragonParticleScale: EFFECT_PROFILE.dragonParticleScale,
      ambientParticleScale: EFFECT_PROFILE.ambientScale,
      particleInterference: EFFECT_PROFILE.particleInterference,
      dpr,
      canvasPixels: canvas.width * canvas.height,
      ambientDpr,
      ambientCanvasPixels: ambientCanvas ? ambientCanvas.width * ambientCanvas.height : 0,
      ambientParticleCount: ambientParticles.length,
      pullParticleCount: pullParticles.length,
      starCount: stars.length,
      shardSpritesReady,
      blueShardSprites: dragonShards.blue.filter((shard) => shard.sprite).length,
      redShardSprites: dragonShards.red.filter((shard) => shard.sprite).length,
    };
  },
  setEffectProfile(mode) {
    const normalized = normalizeEffectMode(mode);
    if (!normalized) return false;
    try {
      window.localStorage?.setItem("cvc.fx", normalized);
    } catch {
      return false;
    }
    window.location.reload();
    return true;
  },
  clearEffectProfile() {
    try {
      window.localStorage?.removeItem("cvc.fx");
      window.localStorage?.removeItem("tdh.fx");
    } catch {
      return false;
    }
    window.location.reload();
    return true;
  },
  setSide(side) {
    if (side === "red" || side === "blue") {
      currentSide = side;
      vibeMode = side;
      dragonLayout = layoutForActiveSide(side);
      transition = null;
      clearDragonParticles();
      setPageVibe(vibeMode);
      scheduleFrame();
    }
  },
  setMode(mode) {
    if (mode === "mixed") {
      vibeMode = "mixed";
      dragonLayout = cloneDragonLayout(INITIAL_DRAGON_LAYOUT);
      currentSide = "blue";
      transition = null;
      clearDragonParticles();
      setPageVibe(vibeMode);
      scheduleFrame();
      return;
    }
    window.TDHTransition.setSide(mode);
  },
  setLayout(layout) {
    if (
      layout &&
      (layout.blue === "left" || layout.blue === "right") &&
      (layout.red === "left" || layout.red === "right") &&
      layout.blue !== layout.red
    ) {
      dragonLayout = cloneDragonLayout(layout);
      currentSide = getLeftDragonSide(dragonLayout);
      vibeMode = currentSide;
      transition = null;
      clearDragonParticles();
      setPageVibe(vibeMode);
      scheduleFrame();
    }
  },
  privateAction: triggerPrivateAction,
  setInteractive,
};

window.TDHWelcome = {
  buildId: BUILD_ID,
  version: BUILD_ID,
  config: publicWelcomeConfig(),
  assets: getAssetManifest(),
  mount: mountWelcome,
  destroy: destroyTDHWelcome,
  openWelcome,
  openFullscreen(options = {}) {
    setVibeSwitchFocus(true, { instant: Boolean(options.instant) });
    scheduleFrame();
  },
  closeFullscreen() {
    setVibeSwitchFocus(false);
  },
  choose(side) {
    emitTDHEvent("choice", { chosenSide: side, source: "api" });
    toggleTransition(side);
  },
  privateAction: triggerPrivateAction,
  blast: startPrivateBurst,
  setMode(mode) {
    window.TDHTransition.setMode(mode);
  },
  setSide(side) {
    window.TDHTransition.setSide(side);
  },
  setLayout(layout) {
    window.TDHTransition.setLayout(layout);
  },
  getState() {
    return window.TDHTransition.getState();
  },
  getPerf() {
    return window.TDHTransition.getPerf();
  },
  on: onTDHEvent,
  off: offTDHEvent,
};

const resizeTarget = vibeSwitch || canvas;
const resizeObserver =
  "ResizeObserver" in window
    ? new ResizeObserver(() => {
        resize();
        scheduleFrame();
      })
    : null;

if (resizeObserver) {
  resizeObserver.observe(resizeTarget);
}

window.addEventListener("resize", handleWindowResize);

if (vibeSwitch) {
  vibeSwitch.addEventListener("click", handleVibeSwitchClick);
  vibeSwitch.addEventListener("keydown", handleVibeSwitchKeydown);
} else {
  canvas.addEventListener("click", handleCanvasClick);
}

if (privateActionButton) {
  privateActionButton.addEventListener("click", handlePrivateActionClick);
}

enableWorkspaceDragScroll();
setPageVibe(vibeMode);

document.addEventListener("visibilitychange", handleVisibilityChange);

resize();
if (WELCOME_CONFIG.autoStart !== false) {
  startInitialLoreFlow();
}
