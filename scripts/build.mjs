import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { version } = manifest;

rmSync("dist", { recursive: true, force: true });

// copies the extension files into dist/<name>, adjusts the manifest for
// that browser, and zips the folder with manifest.json at the zip's root
function stage(name, adjust) {
  const dir = `dist/${name}`;
  mkdirSync(dir, { recursive: true });
  cpSync("icons", `${dir}/icons`, { recursive: true });
  cpSync("src", `${dir}/src`, { recursive: true });

  const m = structuredClone(manifest);
  adjust(m);
  writeFileSync(`${dir}/manifest.json`, JSON.stringify(m, null, 2) + "\n");

  execFileSync("zip", ["-r", "-q", `../haloframe-${name}-${version}.zip`, "."], { cwd: dir });
  console.log(`built dist/haloframe-${name}-${version}.zip`);
}

stage("firefox", () => {});
stage("chrome", (m) => { delete m.browser_specific_settings; });