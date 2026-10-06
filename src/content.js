const SAMPLE_W = 320;
const SAMPLE_H = 180;
const FPS = 10;

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

function startSampling(video) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const ctx = canvas.getContext("2d");

  // TEMPORARY debug preview so we can see the samples
  canvas.style.cssText = 
    "position:fixed;right:16px;bottom:16px;width:320px;height:180px;" +
    "z-index:99999;border:2px solid #fff;border-radius:8px;pointer-events:none";
  document.body.appendChild(canvas);

  let lastFrame = 0;
  function tick(now){
    if (now - lastFrame >= 1000 / FPS) {
      lastFrame = now;
      if (!video.paused && !video.ended && video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

waitForVideo(startSampling);
