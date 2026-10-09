const api = globalThis.browser ?? globalThis.chrome;

const SLIDERS = ["farBlur", "nearBlur", "dim", "glassTint"];
const TOGGLES = ["enabled", "glass"];

function updateGlassRow(glassOn) {
  document.getElementById("glassTint").closest(".slider").hidden = !glassOn;
}

async function load() {
  const stored = await api.storage.local.get(HALOFRAME_DEFAULTS);
  return { ...HALOFRAME_DEFAULTS, ...stored };
}

function show(settings) {
  for (const id of SLIDERS) {
    document.getElementById(id).value = settings[id];
    document.getElementById(id + "Val").textContent = settings[id];
  }

  for (const id of TOGGLES) {
    document.getElementById(id).checked = settings[id];
  }
  updateGlassRow(settings.glass);
}

async function init() {
  show(await load());

  for (const id of SLIDERS) {
    const input = document.getElementById(id);
    const out = document.getElementById(id + "Val");
    input.addEventListener("input", () => {
      out.textContent = input.value;
      api.storage.local.set({ [id]: Number(input.value) });
    });
  }

  for (const id of TOGGLES) {
    const input = document.getElementById(id);
    input.addEventListener("change", () => {
      api.storage.local.set({ [id]: input.checked });
      if (id === "glass") updateGlassRow(input.checked);
    });
  }

  document.getElementById("reset").addEventListener("click", async () => {
    await api.storage.local.set(HALOFRAME_DEFAULTS);
    show(HALOFRAME_DEFAULTS);
  });
}

init();
