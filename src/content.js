const SAMPLE_W = 320;
const SAMPLE_H = 180;
const FPS = 10;
const BACKING_SCALE = 0.25;   // glow canvas resolution relative to the viewport
const TILE_RANGE = 2;         // how many mirrored copies to draw on each side

function findVideo(){
  return document.querySelector("video.html5-main-video");
}

function waitForVideo(callback){
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
    #haloframe-canvas {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: -1;
      pointer-events: none;
      filter: blur(24px) saturate(1.4);
      opacity: 0.9;
    }
  `;
  document.head.appendChild(style);
}

function drawTiles(ctx, source, rect){
  const k = BACKING_SCALE;
  const w = rect.width * k;
  const h = rect.height * k;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let dy = -TILE_RANGE; dy <= TILE_RANGE; dy++) {
    for (let dx = -TILE_RANGE; dx <= TILE_RANGE; dx++) {
      const cx = (rect.left + rect.width / 2 + dx * rect.width) * k;
      const cy = (rect.top + rect.height / 2 + dy * rect.height) * k;

      ctx.save();
      ctx.translate(cx, cy);
      // old tiles are mirrored so neighboring edges match exactly
      ctx.scale(Math.abs(dx) % 2 == 1 ? -1 : 1, Math.abs(dy) % 2 === 1 ? -1 : 1);
      ctx.drawImage(source, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
}

function startRendering(video) {
  // small hidden canvas: the video is copied here once per frame
  const sample = document.createElement("canvas");
  sample.width = SAMPLE_W;
  sample.height = SAMPLE_H;
  const sampleCtx = sample.getContext("2d");

  // full-page canvas behind everything: the mirrored tiles are drawn here
  const glow = document.createElement("canvas");
  glow.id = "haloframe-canvas";
  document.body.appendChild(glow);
  const glowCtx = glow.getContext("2d");

  let lastFrame = 0;
  let lastKey = "";

  video.addEventListener("seeked", () => { lastKey = ""; });

  function tick(now){
    requestAnimationFrame(tick);
    if (now - lastFrame < 1000 / FPS) return;
    lastFrame = now;

    if (document.fullscreenElement) {
      glow.style.display = "none";
      return;
    }
    glow.style.display = "";

    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || video.readyState < 2) return;

    const gw = Math.round(innerWidth * BACKING_SCALE);
    const gh = Math.round(innerHeight * BACKING_SCALE);
    const resized = glow.width !== gw || glow.height !== gh;
    if (resized) {
      glow.width = gw;
      glow.height = gh;
    }

    // when paused, only redraw if the layout changed (scroll, resize, seek)
    const key = [rect.left, rect.top, rect.width, rect.height].join(",");
    const playing = !video.paused && !video.ended;
    if (!playing && !resized && key === lastKey) return;
    lastKey = key;
    
    sampleCtx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
    drawTiles(glowCtx, sample, rect);
  }
  requestAnimationFrame(tick);
}

injectStyles();
waitForVideo(startSampling);
