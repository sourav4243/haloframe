const api = globalThis.browser ?? globalThis.chrome;

// everything that depends on YouTube's page structure lives here,
// so a YouTube redesign only needs edits in this one place
const YT = {
  video: "video.html5-main-video",
  transparent: ["body", "ytd-app", "ytd-page-manager", "ytd-watch-flexy", "#page-manager"],
  cinematics: ["#cinematics", "#cinematics-container", "ytd-cinematic-container-renderer"],
  glass: ["#secondary-inner", "ytd-watch-metadata #description", "ytd-comments#comments"],
};

// fixed values and not user-tunable
const CONFIG = {
  tileRange: 2,       // mirrored copies drawn on each side
  fadeStart: 55,      // % of the mask radius that stays fully visible
  fadeReach: 0.9,     // mask radius as a multiple of the video size
  barLuma: 14,        // a row or column darker than this (0-255 average) counts as a black bar
  barMax: 0.25,       // never treat more than 25% of any side as a bar
  barHistory: 5,      // detections kept; the smallest bar size seen is used
  barEvery: 500,      // ms between detections
};

// performance presets, chosen in the popup
const PRESETS = {
  quality:  { fps: 24, backingScale: 0.35, sampleW: 320, sampleH: 180 },
  balanced: { fps: 15, backingScale: 0.25, sampleW: 320, sampleH: 180 },
  saver:    { fps: 8, backingScale: 0.15, sampleW: 160, sampleH: 90 },
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
  return document.querySelector(YT.video);
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

// builds "prefix a, prefix b, prefix c" for a list of selectors
function scoped(prefix, list) {
  return list.map((s) => `${prefix} ${s}`).join(",\n");
}

function injectStyles() {
  const style = document.createElement("style");
  style.id = "haloframe-style";
  style.textContent = `
    html.haloframe-on { background: var(--yt-spec-base-background, #0f0f0f) !important; }
    ${scoped("html.haloframe-on", YT.transparent)} {
      background: transparent !important;
    }
    ${scoped("html.haloframe-on", YT.cinematics)} {
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
    ${scoped("html.haloframe-on.haloframe-glass ytd-watch-flexy", YT.glass)} {
      background: rgba(15, 15, 15, var(--hf-glass-tint)) !important;
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
    ${scoped("html.haloframe-on.haloframe-glass:not([dark]) ytd-watch-flexy", YT.glass)}{
      background: rgba(255, 255, 255, calc(var(--hf-glass-tint) + 0.2)) !important;
    }
  `;
  document.head.appendChild(style);
}

// measures how much of each edge of the sampled frame is near-black
function detectBars(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  const rowSum = new Float64Array(h);
  const colSum = new Float64Array(w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const luma = (data[i] + data[i + 1] + data[i + 2]) / 3;
      rowSum[y] += luma;
      colSum[x] += luma;
    }
  }

  // averages (not maximums) so burned-in subtitles inside a bar don't break it
  const isDark = (sum, count) => sum / count <= CONFIG.barLuma;

  let top = 0;
  while (top < h && isDark(rowSum[top], w)) top++;
  let bottom = 0;
  while (bottom < h - top && isDark(rowSum[h - 1 - bottom], w)) bottom++;
  let left = 0;
  while (left < w && isDark(colSum[left], h)) left++;
  let right = 0;
  while (right < w - left && isDark(colSum[w - 1 - right], h)) right++;

  const cap = (value, total) => Math.min(value / total, CONFIG.barMax);
  return {
    top: cap(top, h),
    bottom: cap(bottom, h),
    left: cap(left, w),
    right: cap(right, w),
  };
}

// "pic" is the picture's rectangle on the page (the player minus any black
// bars), and "crop" is the matching region of the sampled frame
function drawTiles(ctx, source, pic, k, crop) {
  const w = pic.width * k;
  const h = pic.height * k;
  const r = CONFIG.tileRange;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const cx = (pic.left + pic.width / 2 + dx * pic.width) * k;
      const cy = (pic.top + pic.height / 2 + dy * pic.height) * k;

      ctx.save();
      ctx.translate(cx, cy);
      // odd tiles are mirrored so neighboring edges match exactly
      ctx.scale(Math.abs(dx) % 2 === 1 ? -1 : 1, Math.abs(dy) % 2 === 1 ? -1 : 1);
      ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, -w / 2, -h / 2, w, h);
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
  sample.width = PRESETS.balanced.sampleW;
  sample.height = PRESETS.balanced.sampleH;
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

  // black bar state: current crop plus the recent detections it comes from
  let bars = { top: 0, bottom: 0, left: 0, right: 0 };
  let barHistory = [];
  let lastBarCheck = 0;

  function resetBars() {
    bars = { top: 0, bottom: 0, left: 0, right: 0 };
    barHistory = [];
    lastBarCheck = 0;
  }

  function updateBars(now) {
    if (now - lastBarCheck < CONFIG.barEvery) return;
    lastBarCheck = now;

    barHistory.push(detectBars(sampleCtx, sample.width, sample.height));
    if (barHistory.length > CONFIG.barHistory) barHistory.shift();

    // the smallest bar seen recently: shrinks at once, grows only when
    // several checks agree, so a dark scene can't fake a big bar
    const next = {};
    for (const side of ["top", "bottom", "left", "right"]) {
      next[side] = Math.min(...barHistory.map((b) => b[side]));
    }
    bars = next;
  }

  function clearAll() {
    farCtx.clearRect(0, 0, far.width, far.height);
    nearCtx.clearRect(0, 0, near.width, near.height);
    lastKey = "";
    resetBars();
  }

  function setVisible(visible) {
    far.style.display = near.style.display = visible ? "" : "none";
  }

  video.addEventListener("seeked", () => { lastKey = ""; });
  video.addEventListener("loadstart", resetBars); // a new video starts: forget old bars

  // YouTube fires these when switching pages without a reload
  document.addEventListener("yt-navigate-start", clearAll);
  document.addEventListener("yt-navigate-finish", () => { lastKey = ""; });

  function tick(now) {
    requestAnimationFrame(tick);

    const preset = PRESETS[settings.quality] ?? PRESETS.balanced;
    if (now - lastFrame < 1000 / preset.fps) return;
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

    // follow the selected preset: resizing a canvas clears it, so a change
    // in preset triggers a redraw through the "resized" flag below
    if (sample.width !== preset.sampleW) {
      sample.width = preset.sampleW;
      sample.height = preset.sampleH;
    }

    const gw = Math.round(innerWidth * preset.backingScale);
    const gh = Math.round(innerHeight * preset.backingScale);
    const resized = far.width !== gw || far.height !== gh;
    if (resized) {
      far.width = near.width = gw;
      far.height = near.height = gh;
    }

    // when paused, only redraw if the layout or the bar setting changed
    const key = [rect.left, rect.top, rect.width, rect.height, settings.cropBars].join(",");
    const playing = !video.paused && !video.ended;
    if (!playing && !resized && key === lastKey) return;
    lastKey = key;

    sampleCtx.drawImage(video, 0, 0, preset.sampleW, preset.sampleH);

    // by default the whole frame is used; with "ignore black bars" on, only
    // the picture inside the bars is tiled around the player
    let crop = { x: 0, y: 0, w: sample.width, h: sample.height };
    let pic = rect;
    if (settings.cropBars) {
      updateBars(now);
      const kw = 1 - bars.left - bars.right;
      const kh = 1 - bars.top - bars.bottom;
      crop = {
        x: bars.left * sample.width,
        y: bars.top * sample.height,
        w: kw * sample.width,
        h: kh * sample.height,
      };
      pic = {
        left: rect.left + bars.left * rect.width,
        top: rect.top + bars.top * rect.height,
        width: kw * rect.width,
        height: kh * rect.height,
      };
    } else if (barHistory.length) {
      resetBars();
    }

    drawTiles(farCtx, sample, pic, preset.backingScale, crop);

    // the near layer is a cheap copy of the far one at the same small size
    nearCtx.clearRect(0, 0, near.width, near.height);
    nearCtx.drawImage(far, 0, 0);

    updateMask(near, rect);
  }
  requestAnimationFrame(tick);
}

injectStyles();
loadSettings().then(() => waitForVideo(startRendering));