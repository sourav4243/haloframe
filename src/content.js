const api = globalThis.browser ?? globalThis.chrome;

// fixed values and not user-tunable
const CONFIG = {
  sampleW: 320,
  sampleH: 180,
  fps: 10,
  backingScale: 0.25, // glow canvas resolution relative to the viewport
  tileRange: 2,       // mirrored copies drawn on each side
  fadeStart: 55,      // % of the mask radius that stays fully visible
  fadeReach: 0.9,     // mask radius as a multiple of the video size
};

// user-tunable values, kept in sync with the popup
let settings = { ...HALOFRAME_DEFAULTS };

function applySettings() {
  const root = document.documentElement;
  root.classList.toggle("haloframe-on", settings.enabled);
  root.classList.toggle("haloframe-glass", settings.glass);
  root.style.setProperty("--hf-far-blur", settings.farBlur + "px");
  root.style.setProperty("--hf-near-blur", settings.nearBlur + "px");
  root.style.setProperty("--hf-dim", settings.dim);
  root.style.setProperty("--hf-glass-blur", settings.glassBlur + "px");
  root.style.setProperty("--hf-glass-tint", settings.glassTint);
}

async function loadSettings() {
  try {
    const stored = await api.storage.local.get(HALOFRAME_DEFAULTS);
    settings = { ...HALOFRAME_DEFAULTS, ...stored};
  } catch (err) {
    console.warn("[HaloFrame] could not load settings, using defaults", err);
  }
  applySettings();
}

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [key, change] of Object.entries(changes)) {
    settings[key] = change.newValue;
  }
  applySettings();
});

function findVideo() {
  return document.querySelector("video.html5-main-video");
}

function waitForVideo(callback) {
  const existing = findVideo();
  if (existing) return callback(existing);

  const observer = new MutationObserver(() => {
    const video = findVideo();
    if (video) {
      observer.disconnect();
      callback(video);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function injectStyles() {
  const style = document.createElement("style");
  style.id = "haloframe-style";
  style.textContent = `
    html.haloframe-on { background: var(--yt-spec-base-background, #0f0f0f) !important; }
    html.haloframe-on body,
    html.haloframe-on ytd-app,
    html.haloframe-on ytd-page-manager,
    html.haloframe-on ytd-watch-flexy,
    html.haloframe-on #page-manager {
      background: transparent !important;
    }
    html.haloframe-on #cinematics, 
    html.haloframe-on #cinematics-container, 
    html.haloframe-on ytd-cinematic-container-renderer {
      display: none !important;
    }
    #haloframe-far, #haloframe-near {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
    }
    html:not(.haloframe-on) #haloframe-far,
    html:not(.haloframe-on) #haloframe-near {
      display: none;
    }
    #haloframe-far {
      z-index: -2;
      filter: blur(var(--hf-far-blur)) saturate(1.4) brightness(var(--hf-dim));
      opacity: 0.85;
    }
    #haloframe-near {
      z-index: -1;
      filter: blur(var(--hf-near-blur)) saturate(1.3) brightness(var(--hf-dim));
    }
    html.haloframe-on.haloframe-glass ytd-watch-flexy #secondary-inner,
    html.haloframe-on.haloframe-glass ytd-watch-flexy ytd-watch-metadata #description,
    html.haloframe-on.haloframe-glass ytd-watch-flexy ytd-comments#comments {
      background: rgba(15, 15, 15, var(--hf-glass-tint)) !important;
      -webkit-backdrop-filter: blur(var(--hf-glass-blur)) saturate(1.5);
      backdrop-filter: blur(var(--hf-glass-blur)) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 16px;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.22),
        0 8px 32px rgba(0, 0, 0, 0.25);
    }
    html.haloframe-on.haloframe-glass ytd-watch-flexy #secondary-inner {
      padding: 12px;
      box-sizing: border-box;
    }
    html.haloframe-on.haloframe-glass:not([dark]) ytd-watch-flexy #secondary-inner,
    html.haloframe-on.haloframe-glass:not([dark]) ytd-watch-flexy ytd-watch-metadata #description,
    html.haloframe-on.haloframe-glass:not([dark]) ytd-watch-flexy ytd-comments#comments {
      background: rgba(255, 255, 255, calc(var(--hf-glass-tint) + 0.2)) !important;
    }
  `;
  document.head.appendChild(style);
}

function drawTiles(ctx, source, rect) {
  const k = CONFIG.backingScale;
  const w = rect.width * k;
  const h = rect.height * k;
  const r = CONFIG.tileRange;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const cx = (rect.left + rect.width / 2 + dx * rect.width) * k;
      const cy = (rect.top + rect.height / 2 + dy * rect.height) * k;

      ctx.save();
      ctx.translate(cx, cy);
      // odd tiles are mirrored so neighboring edges match exactly
      ctx.scale(Math.abs(dx) % 2 === 1 ? -1 : 1, Math.abs(dy) % 2 === 1 ? -1 : 1);
      ctx.drawImage(source, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
}

function updateMask(near, rect) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const rx = rect.width * CONFIG.fadeReach;
  const ry = rect.height * CONFIG.fadeReach;
  const mask =
    `radial-gradient(ellipse ${rx}px ${ry}px at ${cx}px ${cy}px, ` +
    `#000 ${CONFIG.fadeStart}%, transparent 100%)`;
  near.style.maskImage = mask;
  near.style.webkitMaskImage = mask;
}

function isWatchPage() {
  return location.pathname === "/watch";
}

function startRendering(video) {
  // small hidden canvas: the video is copied here once per frame
  const sample = document.createElement("canvas");
  sample.width = CONFIG.sampleW;
  sample.height = CONFIG.sampleH;
  const sampleCtx = sample.getContext("2d");

  // far layer: heavy blur, always visible
  const far = document.createElement("canvas");
  far.id = "haloframe-far";
  document.body.appendChild(far);
  const farCtx = far.getContext("2d");

  // near layer: light blur, faded out with distance from the player
  const near = document.createElement("canvas");
  near.id = "haloframe-near";
  document.body.appendChild(near);
  const nearCtx = near.getContext("2d");

  let lastFrame = 0;
  let lastKey = "";
  let shown = true;

  function clearAll() {
    farCtx.clearRect(0, 0, far.width, far.height);
    nearCtx.clearRect(0, 0, near.width, near.height);
    lastKey = "";
  }

  function setVisible(visible) {
    far.style.display = near.style.display = visible ? "" : "none";
  }

  video.addEventListener("seeked", () => { lastKey = ""; });

  // YouTube fires these when switching pages without a reload
  document.addEventListener("yt-navigate-start", clearAll);
  document.addEventListener("yt-navigate-finish", () => { lastKey = ""; });

  function tick(now) {
    requestAnimationFrame(tick);
    if (now - lastFrame < 1000 / CONFIG.fps) return;
    lastFrame = now;

    // glow only exists when enabled, on the watch page, and not in fullscreen
    const active = settings.enabled && isWatchPage() && !document.fullscreenElement;
    if (!active) {
      if (shown) {
        clearAll();
        setVisible(false);
        shown = false;
      }
      return;
    }

    if (!shown) {
      setVisible(true);
      shown = true;
    }

    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || video.readyState < 2) return;

    const gw = Math.round(innerWidth * CONFIG.backingScale);
    const gh = Math.round(innerHeight * CONFIG.backingScale);
    const resized = far.width !== gw || far.height !== gh;
    if (resized) {
      far.width = near.width = gw;
      far.height = near.height = gh;
    }

    // when paused, only redraw if the layout changed (scroll, resize, seek)
    const key = [rect.left, rect.top, rect.width, rect.height].join(",");
    const playing = !video.paused && !video.ended;
    if (!playing && !resized && key === lastKey) return;
    lastKey = key;

    sampleCtx.drawImage(video, 0, 0, CONFIG.sampleW, CONFIG.sampleH);
    drawTiles(farCtx, sample, rect);

    // the near layer is a cheap copy of the far one at the same small size
    nearCtx.clearRect(0, 0, near.width, near.height);
    nearCtx.drawImage(far, 0, 0);

    updateMask(near, rect);
  }
  requestAnimationFrame(tick);
}

injectStyles();
loadSettings().then(() => waitForVideo(startRendering));