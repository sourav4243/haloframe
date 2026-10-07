const CONFIG = {
  sampleW: 320,
  sampleH: 180,
  fps: 60,
  backingScale: 0.25, // glow canvas resolution relative to the viewport
  tileRange: 2,       // mirrored copies drawn on each side
  farBlur: 42,        // px, the soft layer
  nearBlur: 6,        // px, the detailed layer next to the player
  fadeStart: 55,      // % of the mask radius that stays fully visible
  fadeReach: 0.9,     // mask radius as a multiple of the video size
  dim: 0.8,
};

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
    html { background: var(--yt-spec-base-background, #0f0f0f) !important; }
    body, ytd-app, ytd-page-manager, ytd-watch-flexy, #page-manager {
      background: transparent !important;
    }
    #cinematics, #cinematics-container, ytd-cinematic-container-renderer {
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
    #haloframe-far {
      z-index: -2;
      filter: blur(${CONFIG.farBlur}px) saturate(1.4) brightness(${CONFIG.dim});
      opacity: 0.85;
    }
    #haloframe-near {
      z-index: -1;
      filter: blur(${CONFIG.nearBlur}px) saturate(1.3) brightness(${CONFIG.dim});
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

  video.addEventListener("seeked", () => { lastKey = ""; });

  function tick(now) {
    requestAnimationFrame(tick);
    if (now - lastFrame < 1000 / CONFIG.fps) return;
    lastFrame = now;

    const hidden = !!document.fullscreenElement;
    far.style.display = near.style.display = hidden ? "none" : "";
    if (hidden) return;

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
waitForVideo(startRendering);