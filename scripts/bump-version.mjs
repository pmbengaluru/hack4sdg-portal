// Stamps a new version on every asset URL so browsers fetch fresh files after a deploy.
// Usage: npm run bump   (then commit and push)
import fs from "node:fs";

const v = new Date().toISOString().replace(/[-:]/g, "").replace("T", ".").slice(0, 13); // e.g. 20261024.0315
const files = ["index.html", "js/app.js"];
for (const f of files) {
  const before = fs.readFileSync(f, "utf8");
  const after = before
    .replace(/(css\/style\.css|js\/app\.js|config\.js|csv\.js)(\?v=[\w.]+)?(["'])/g, `$1?v=${v}$3`)
    .replace(/(const APP_VERSION = ")[^"]*(")/, `$1${v}$2`);
  fs.writeFileSync(f, after);
}
fs.writeFileSync("version.json", JSON.stringify({ version: v }) + "\n");
console.log("version", v);
