// Pass image layout as SVG (rendered to PNG with resvg): SDG strip, logo QR, name, pass code, team, SDG strip.
// Matches the browser's qrPng() in js/app.js so downloads and emails look the same.
const SDG = ["#E5243B", "#DDA63A", "#4C9F38", "#C5192D", "#FF3A21", "#26BDE2", "#FCC30B", "#A21942", "#FD6925",
  "#DD1367", "#FD9D24", "#BF8B2E", "#3F7E44", "#0A97D9", "#56C02B", "#00689D", "#19486A"];

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Shrink the font until an average-width estimate fits; cut with an ellipsis if even the minimum is too wide.
function fitText(text: string, size: number, min: number, emWidth: number, maxWidth: number) {
  let s = size;
  while (s > min && text.length * s * emWidth > maxWidth) s--;
  let t = text;
  while (t.length > 1 && t.length * s * emWidth > maxWidth) t = t.slice(0, -1);
  return { text: t === text ? text : `${t.trimEnd()}…`, size: s };
}

export function passSvg(qrPngBase64: string, qrSize: number, name: string, code: string, team: string): string {
  const W = qrSize, strip = 8, info = 128, H = strip + W + info + strip;
  const y0 = strip + W - 26, max = W - 36;
  const bar = (y: number) => SDG.map((c, i) =>
    `<rect x="${Math.floor((i * W) / 17)}" y="${y}" width="${Math.ceil(W / 17) + 1}" height="${strip}" fill="${c}"/>`).join("");
  const n = fitText(name, 32, 14, 0.6, max);
  const t = fitText(team, 20, 12, 0.56, max);
  const spaced = code.replace(/(.{4})(?=.)/g, "$1 ");
  const codeW = Math.round(spaced.length * 26 * 0.6 + 36);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  ${bar(0)}
  <image href="data:image/png;base64,${qrPngBase64}" x="0" y="${strip}" width="${W}" height="${W}"/>
  <text x="${W / 2}" y="${y0 + 30}" text-anchor="middle" font-family="Plus Jakarta Sans" font-weight="800" font-size="${n.size}" fill="#141b3a">${esc(n.text)}</text>
  <rect x="${(W - codeW) / 2}" y="${y0 + 48}" width="${codeW}" height="42" rx="21" fill="#eef4fb"/>
  <text x="${W / 2}" y="${y0 + 78}" text-anchor="middle" font-family="JetBrains Mono" font-weight="700" font-size="26" fill="#1f78c1">${esc(spaced)}</text>
  ${team ? `<text x="${W / 2}" y="${y0 + 124}" text-anchor="middle" font-family="Plus Jakarta Sans" font-weight="600" font-size="${t.size}" fill="#64708a">${esc(t.text)}</text>` : ""}
  ${bar(H - strip)}
</svg>`;
}
