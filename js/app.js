import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js?v=20261025.0410";
import { analyzeCSV, toCSV } from "./csv.js?v=20261025.0410";

const APP_VERSION = "20261025.0410"; // set by scripts/bump-version.mjs
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById("app");

const state = { user: null, me: null, settings: {}, scanner: null, timers: [] };

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmtTime = (t) => (t ? new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === "bad" ? "alert" : "check")}<span></span>`;
  el.lastChild.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, kind === "bad" ? 6000 : 3000);
}

function must({ data, error }) {
  if (error) throw error;
  return data;
}

function modal(html, onMount) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal">${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-close]")) close(); });
  document.body.appendChild(bg);
  onMount?.(bg.firstElementChild, close);
  return close;
}

function confirmBox(message, okLabel = "Confirm", danger = false) {
  return new Promise((resolve) => {
    modal(`<p>${message}</p><div class="actions"><button class="btn" data-close>Cancel</button>
      <button class="btn ${danger ? "danger" : "primary"}" id="cf-ok">${esc(okLabel)}</button></div>`, (m, close) => {
      $("#cf-ok", m).onclick = () => { close(); resolve(true); };
      m.parentElement.addEventListener("click", (e) => { if (e.target === m.parentElement || e.target.closest("[data-close]")) resolve(false); });
    });
  });
}

function download(filename, text, type = "text/csv") {
  const blob = new Blob([text], { type });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// QR helpers (qrcode-generator global). Level "H" so the centre logo doesn't affect scanning.
const QR_BADGE = Object.assign(new Image(), { src: "assets/qr-badge.png" });
const QR_INK = "#141b3a";
function qrMatrix(text) {
  const q = window.qrcode(0, "H");
  q.addData(text);
  q.make();
  return q;
}
// badge size in modules: ~29% of the code width, as tested for the email version
const badgeModules = (n) => Math.round(n * 0.29);
function qrSvg(text) {
  const q = qrMatrix(text);
  const n = q.getModuleCount(), m = 2, size = n + m * 2, b = badgeModules(n), o = (size - b) / 2;
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${c + m},${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/>
    <path d="${path}" fill="${QR_INK}"/><image href="assets/qr-badge.png" x="${o}" y="${o}" width="${b}" height="${b}"/></svg>`;
}
const SDG_COLOURS = ["#E5243B", "#DDA63A", "#4C9F38", "#C5192D", "#FF3A21", "#26BDE2", "#FCC30B", "#A21942", "#FD6925",
  "#DD1367", "#FD9D24", "#BF8B2E", "#3F7E44", "#0A97D9", "#56C02B", "#00689D", "#19486A"];
// Pass image: SDG strip, QR with logo, then name, pass code and team (PNG download).
// The email function draws the same layout in supabase/functions/admin/pass.ts.
async function qrPng(text, name, team) {
  if (!QR_BADGE.complete) await new Promise((r) => { QR_BADGE.onload = QR_BADGE.onerror = r; });
  try { await document.fonts?.load("800 32px 'Plus Jakarta Sans'"); } catch { /* fallback font */ }
  const q = qrMatrix(text);
  const n = q.getModuleCount(), cell = 14, m = 4, w = (n + m * 2) * cell;
  const strip = 8, top = strip, info = name ? 128 : 0, h = top + w + info + (name ? strip : 0);
  const cv = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  const bar = (y) => SDG_COLOURS.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor((i * w) / 17), y, Math.ceil(w / 17) + 1, strip); });
  bar(0);
  ctx.fillStyle = QR_INK;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect((c + m) * cell, top + (r + m) * cell, cell, cell);
  if (QR_BADGE.naturalWidth) {
    const b = badgeModules(n) * cell;
    ctx.drawImage(QR_BADGE, (w - b) / 2, top + (w - b) / 2, b, b);
  }
  if (name) {
    const fit = (txt, weight, size, family, maxW) => {
      let s = size;
      do { ctx.font = `${weight} ${s}px ${family}`; s -= 1; } while (ctx.measureText(txt).width > maxW && s > 12);
    };
    const y0 = top + w - 26, max = w - 36;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = QR_INK;
    fit(name, 800, 32, "'Plus Jakarta Sans', Arial", max);
    ctx.fillText(name, w / 2, y0 + 30);
    // pass code in a pill
    const code = text.replace(/(.{4})(?=.)/g, "$1 ");
    ctx.font = "700 26px ui-monospace, Consolas, 'Courier New', monospace";
    const cw = ctx.measureText(code).width + 36, ch = 42, cx = (w - cw) / 2, cy = y0 + 48;
    ctx.fillStyle = "#eef4fb";
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx, cy, cw, ch, 21) : ctx.rect(cx, cy, cw, ch); ctx.fill();
    ctx.fillStyle = "#1f78c1"; ctx.fillText(code, w / 2, cy + 30);
    if (team) {
      ctx.fillStyle = "#64708a";
      fit(team, 600, 20, "'Plus Jakarta Sans', Arial", max);
      ctx.fillText(team, w / 2, y0 + 124);
    }
    bar(h - strip);
  }
  return cv.toDataURL("image/png");
}

let audioCtx;
function beep(ok = true) {
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.15;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + (ok ? 0.12 : 0.35));
    navigator.vibrate?.(ok ? 80 : [80, 60, 80]);
  } catch { /* audio not available */ }
}

let sheetJs;
function loadSheetJs() {
  sheetJs ??= new Promise((ok, fail) => {
    const s = Object.assign(document.createElement("script"), { src: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" });
    s.onload = () => ok(window.XLSX);
    s.onerror = () => { sheetJs = null; fail(new Error("Couldn't load the Excel library – check your connection.")); };
    document.head.appendChild(s);
  });
  return sheetJs;
}
async function readSpreadsheet(file) {
  if (!/\.(xlsx|xls|ods)$/i.test(file.name)) return file.text();
  const XLSX = await loadSheetJs();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { blankrows: true });
}

async function callAdmin(body) {
  const { data, error } = await sb.functions.invoke("admin", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ------------------------------------------------------------------ data
async function loadSettings() {
  const rows = must(await sb.from("settings").select("key,value"));
  state.settings = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));
  document.title = `${state.settings.event_name || "Event"} Portal`;
}
const getCheckpoints = async () =>
  must(await sb.from("checkpoints").select("*").order("starts_at", { ascending: true, nullsFirst: false }).order("sort_order").order("id"));

// checkpoint timings
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
function cpWindow(c) {
  if (!c.starts_at && !c.ends_at) return "";
  const day = (d) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const tm = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const a = c.starts_at && new Date(c.starts_at), b = c.ends_at && new Date(c.ends_at);
  if (a && b) return day(a) === day(b) ? `${day(a)}, ${tm(a)} – ${tm(b)}` : `${day(a)} ${tm(a)} – ${day(b)} ${tm(b)}`;
  return a ? `From ${day(a)} ${tm(a)}` : `Until ${day(b)} ${tm(b)}`;
}
function cpTimeState(c) {
  const now = Date.now();
  if (c.starts_at && now < new Date(c.starts_at)) return "upcoming";
  if (c.ends_at && now > new Date(c.ends_at)) return "over";
  return c.starts_at || c.ends_at ? "live" : null;
}
function cpTimeBadge(c) {
  const st = cpTimeState(c);
  if (!st) return "";
  const mins = (t) => Math.round((new Date(t) - Date.now()) / 60000);
  const rel = (m) => (Math.abs(m) >= 120 ? `${Math.round(Math.abs(m) / 60)} h` : `${Math.abs(m)} min`);
  if (st === "upcoming") return `<span class="badge">starts in ${rel(mins(c.starts_at))}</span>`;
  if (st === "over") return '<span class="badge">time over</span>';
  return `<span class="badge ok">now${c.ends_at ? ` · ${rel(mins(c.ends_at))} left` : ""}</span>`;
}
// default checkpoint on scan/judge pages: the one happening now, else the last one used, else the first
const pickCheckpoint = (list, wanted) =>
  list.find((c) => c.id === Number(wanted)) || list.find((c) => cpTimeState(c) === "live") ||
  list.find((c) => { try { return c.id === Number(localStorage.getItem("cp")); } catch { return false; } }) || list.find((c) => cpTimeState(c) === "upcoming") || list[0];
const cpOption = (c, sel) => `<option value="${c.id}" ${c.id === sel.id ? "selected" : ""}>${esc(c.name)}${cpWindow(c) ? ` (${esc(cpWindow(c))})` : ""}</option>`;
// table / team numbers: natural order ("2" before "10"), unnumbered teams last
const byTable = (a, b) =>
  (a.table_no || "\uffff").localeCompare(b.table_no || "\uffff", undefined, { numeric: true }) || a.name.localeCompare(b.name);
const tableTag = (t, cls = "badge info") => (t.table_no ? `<span class="${cls}">Table ${esc(t.table_no)}</span>` : "");
const getTeams = async () =>
  must(await sb.from("teams").select("id,name,declared_size,college,table_no,participants(id,name,email,phone,is_leader,token,email_status,email_sent_at,email_error)").order("name"));
const getParticipants = async () =>
  must(await sb.from("participants").select("id,name,email,phone,token,email_status,email_error,team_id,teams(name)").order("name"));

// ------------------------------------------------------------------ routing
// line icons (24px grid, stroke = currentColor)
const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  teams: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  import: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  checkpoints: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.33 2q2 0 3.67-.8a.5.5 0 0 1 .67.47v10.3a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.53"/>',
  staff: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  emails: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="4" height="4" rx="1"/><path d="M17 7v4M7 17h4M14 14h3v3"/>',
  judge: '<path d="M11.52 2.3a.53.53 0 0 1 .96 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.13a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z"/>',
  results: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  account: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  assign: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  podium: '<path d="M8 21V11H3v10h5zM21 21v-7h-5v7h5zM16 21V7H8v14h8z"/><path d="m12 2 .9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z"/>',
  attendance: '<path d="M16 3h5v5M21 3l-7 7"/><path d="M8 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="m9 15 2 2 4-4"/><path d="M14 21h5a2 2 0 0 0 2-2v-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
};
const icon = (name, cls = "") => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
const SDG = ["#E5243B", "#DDA63A", "#4C9F38", "#C5192D", "#FF3A21", "#26BDE2", "#FCC30B", "#A21942", "#FD6925", "#DD1367", "#FD9D24", "#BF8B2E", "#3F7E44", "#0A97D9", "#56C02B", "#00689D", "#19486A"];
const sdgStrip = (cls = "") => `<div class="sdg-strip ${cls}">${SDG.map((c, i) => `<i style="background:${c};--i:${i}"></i>`).join("")}</div>`;

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// stagger cards in and count numbers up, after each page render
function animatePage(root) {
  [...root.querySelectorAll(".page-head, .card, .stat, .team, .notice")].slice(0, 40)
    .forEach((el, i) => el.style.setProperty("--d", `${Math.min(i, 14) * 35}ms`));
  if (reduceMotion()) return;
  root.querySelectorAll(".stat .v").forEach((el) => {
    const m = el.textContent.trim().match(/^(\d+)(.*)$/);
    if (!m || Number(m[1]) < 2) return;
    const to = Number(m[1]), rest = m[2], t0 = performance.now(), dur = 700;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = `${Math.round(to * e)}${rest}`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

const ROUTES = {
  dashboard: { label: "Dashboard", icon: "dashboard", roles: ["admin"], view: viewDashboard },
  teams: { label: "Teams & QR", icon: "teams", roles: ["admin"], view: viewTeams },
  import: { label: "Import", icon: "import", roles: ["admin"], view: viewImport },
  checkpoints: { label: "Checkpoints", icon: "checkpoints", roles: ["admin"], view: viewCheckpoints },
  staff: { label: "Staff", icon: "staff", roles: ["admin"], view: viewStaff },
  emails: { label: "QR emails", icon: "emails", roles: ["admin"], view: viewEmails },
  scan: { label: "Scan", icon: "scan", roles: ["admin", "volunteer"], view: viewScan },
  selfcheckin: { label: "Attendance QR", icon: "phone", roles: ["admin", "volunteer"], view: viewSelfCheckin },
  display: { label: "Attendance screen", roles: ["admin", "volunteer"], view: viewDisplay, hidden: true, fullscreen: true },
  judge: { label: "Judge", icon: "judge", roles: ["admin", "mentor"], view: viewJudge },
  assign: { label: "Assign judges", icon: "assign", roles: ["admin"], view: viewAssign },
  attendance: { label: "Attendance", icon: "attendance", roles: ["admin", "volunteer"], view: viewAttendance },
  results: { label: "Results", icon: "results", roles: ["admin"], view: viewResults },
  leaderboard: { label: "Leaderboard", icon: "podium", roles: ["admin"], view: viewLeaderboard },
  settings: { label: "Settings", icon: "settings", roles: ["admin"], view: viewSettings },
  account: { label: "Account", icon: "account", roles: ["admin", "volunteer", "mentor"], view: viewAccount },
  print: { label: "Print badges", roles: ["admin"], view: viewPrint, hidden: true },
};
const homeFor = (role) => ({ admin: "dashboard", volunteer: "scan", mentor: "judge" }[role]);

const SKELETON = `<div class="skeleton"><div class="sk sk-title"></div><div class="sk sk-line"></div>
  <div class="grid stats">${'<div class="sk sk-card"></div>'.repeat(4)}</div><div class="sk sk-block"></div></div>`;

async function route() {
  if (!state.me) return;
  await stopScanner();
  let [name, ...args] = location.hash.replace(/^#\/?/, "").split("/");
  const r = ROUTES[name];
  if (!r || !r.roles.includes(state.me.role)) {
    location.hash = `#/${homeFor(state.me.role)}`;
    return;
  }
  $$(".nav a, .mnav a").forEach((a) => a.classList.toggle("active", a.dataset.r === name));
  $(".mnav a.active")?.scrollIntoView({ inline: "center", block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
  $("#viz-tip")?.classList.remove("on");
  state.timers.forEach(clearInterval);
  state.timers = [];
  document.body.classList.toggle("display-mode", !!r.fullscreen);
  const main = $("#main");
  main.classList.remove("page-in");
  main.innerHTML = SKELETON;
  try {
    await r.view(main, ...args);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
  void main.offsetWidth; // restart the enter animation
  main.classList.add("page-in");
  animatePage(main);
}
window.addEventListener("hashchange", route);

function renderShell() {
  const links = Object.entries(ROUTES).filter(([, r]) => !r.hidden && r.roles.includes(state.me.role));
  const nav = links.map(([k, r]) => `<a href="#/${k}" data-r="${k}">${icon(r.icon)}<span>${r.label}</span></a>`).join("");
  const initials = state.me.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  app.innerHTML = `
    <div class="bg-orbs" aria-hidden="true"><i></i><i></i><i></i></div>
    <header class="topbar"><img src="assets/logo.png" alt="${esc(state.settings.event_name)}" class="topbar-logo">
      <span class="badge brand">${state.me.role}</span>
      <button class="icon-btn" id="logout2" title="Sign out">${icon("logout")}</button></header>
    <nav class="mnav">${nav}</nav>
    <div class="shell">
      <aside class="side">
        <a class="side-logo" href="#/${homeFor(state.me.role)}"><img src="assets/logo.png" alt="${esc(state.settings.event_name)}"></a>
        ${sdgStrip()}
        <nav class="nav">${nav}</nav>
        <div class="me">
          <div class="avatar">${esc(initials)}</div>
          <div class="me-info"><b>${esc(state.me.name)}</b><span>${state.me.role}</span></div>
          <button class="icon-btn" id="logout" title="Sign out">${icon("logout")}</button>
        </div>
      </aside>
      <main class="main" id="main"></main>
    </div>`;
  const out = async () => { await stopScanner(); await sb.auth.signOut(); location.hash = ""; boot(); };
  $("#logout").onclick = out;
  $("#logout2").onclick = out;
}

// ------------------------------------------------------------------ auth
function viewLogin(message = "") {
  app.innerHTML = `
    <div class="bg-orbs" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="login">
      <section class="login-hero">
        <div class="logo-stage"><div class="ring" aria-hidden="true"></div>
          <img src="assets/logo-transparent.png" alt="HACK4SDG – Ideas today, impact tomorrow" class="login-logo"></div>
        <h2 class="hero-line">One portal for <span class="c1">QR passes</span>, <span class="c2">check-ins</span> &amp; <span class="c3">judging</span></h2>
        ${sdgStrip("big")}
      </section>
      <form class="card login-card" id="login-form">
        <h1>Welcome back</h1>
        <p class="muted small">Sign in as an admin, volunteer or mentor. Ask an admin if you don't have a login yet.</p>
        ${message ? `<div class="notice">${message}</div>` : ""}
        <div class="field float"><input type="email" name="email" required autocomplete="username" placeholder=" " id="li-e"><label for="li-e">Email</label></div>
        <div class="field float"><input type="password" name="password" required autocomplete="current-password" placeholder=" " id="li-p"><label for="li-p">Password</label></div>
        <button class="btn primary lg block">Sign in</button>
      </form>
    </div>`;

  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = $("button", e.target);
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.get("email").trim(), password: f.get("password") });
    btn.disabled = false;
    if (error) return toast(error.message, "bad");
    boot();
  };
}

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return viewLogin();
  state.user = session.user;
  const { data: me, error } = await sb.from("staff").select("*").eq("email", session.user.email.toLowerCase()).maybeSingle();
  if (error || !me) {
    await sb.auth.signOut();
    return viewLogin(error ? esc(error.message) : "This account isn't registered as staff for the event. Ask an admin to add you.");
  }
  state.me = me;
  await loadSettings();
  renderShell();
  route();
}

// ------------------------------------------------------------------ dashboard
async function viewDashboard(main) {
  const [parts, cps, staff, scans, scores, teams] = await Promise.all([
    sb.from("participants").select("id,email_status").then(must),
    getCheckpoints(),
    sb.from("staff").select("role").then(must),
    sb.from("scans").select("checkpoint_id").then(must),
    sb.from("scores").select("checkpoint_id,team_id").then(must),
    sb.from("teams").select("id,name").order("name").then(must),
  ]);
  const count = (arr, f) => arr.filter(f).length;
  const judgingCps = cps.filter((c) => c.type === "judging");
  const stat = (v, l) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const cpRows = cps.map((c) => {
    if (c.type === "scan") {
      const n = count(scans, (s) => s.checkpoint_id === c.id);
      const pct = parts.length ? Math.round((n / parts.length) * 100) : 0;
      return `<tr><td><b>${esc(c.name)}</b>${cpWindow(c) ? `<br><span class="small muted">${esc(cpWindow(c))}</span> ${cpTimeBadge(c)}` : ""}</td><td><span class="badge info">Scan</span></td>
        <td>${c.active ? '<span class="badge ok">Open</span>' : '<span class="badge">Closed</span>'}</td>
        <td style="min-width:160px"><div class="progress"><div style="width:${pct}%"></div></div><span class="small muted">${n} / ${parts.length} people · <a href="#/attendance/${c.id}">see list</a></span></td></tr>`;
    }
    const n = new Set(scores.filter((s) => s.checkpoint_id === c.id).map((s) => s.team_id)).size;
    const pct = teams.length ? Math.round((n / teams.length) * 100) : 0;
    return `<tr><td><b>${esc(c.name)}</b>${cpWindow(c) ? `<br><span class="small muted">${esc(cpWindow(c))}</span> ${cpTimeBadge(c)}` : ""}</td><td><span class="badge warn">Judging</span></td>
      <td>${c.active ? '<span class="badge ok">Open</span>' : '<span class="badge">Closed</span>'}</td>
      <td><div class="progress"><div style="width:${pct}%"></div></div><span class="small muted">${n} / ${teams.length} teams graded</span></td></tr>`;
  }).join("");

  main.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><p class="muted">${esc(state.settings.event_name)} at a glance</p></div>
      <div class="row"><a class="btn" href="#/import">Import CSV</a><a class="btn primary" href="#/emails">Send QR emails</a></div></div>
    <div class="grid stats" style="margin-bottom:16px">
      ${stat(teams.length, "Teams")}
      ${stat(parts.length, "Participants")}
      ${stat(count(parts, (p) => p.email_status === "sent"), "QR emails sent")}
      ${stat(count(parts, (p) => p.email_status === "failed"), "Emails failed")}
      ${stat(count(staff, (s) => s.role === "volunteer"), "Volunteers")}
      ${stat(count(staff, (s) => s.role === "mentor"), "Mentors / judges")}
    </div>
    <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:4px"><h2>Judging progress</h2>
      <a class="btn sm" href="#/results">Results</a></div>
      ${judgingCps.length && teams.length
        ? `<div class="donut-grid">${judgingCps.map((c) => judgingDonut(c, teams, scores)).join("")}</div>`
        : `<div class="empty">${teams.length ? 'No judging rounds yet. <a href="#/checkpoints">Add a judging checkpoint</a> to track it here.' : "Import teams to see judging progress."}</div>`}
    </div>
    <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>Checkpoints</h2>
      <a class="btn sm" href="#/checkpoints">Manage</a></div>
      ${cps.length ? `<div class="table-wrap"><table><thead><tr><th>Checkpoint</th><th>Type</th><th>Status</th><th>Progress</th></tr></thead><tbody>${cpRows}</tbody></table></div>`
        : `<div class="empty">No checkpoints yet. <a href="#/checkpoints">Create check-in, meals, judging rounds…</a></div>`}
    </div>
    ${!parts.length ? `<div class="notice info">Start by importing the registration CSV under <a href="#/import">Import CSV</a>.</div>` : ""}`;
  mountDonuts(main);
}

// Donut: teams judged vs not judged yet in one judging round (2-part share, so a donut reads fine).
const DONUT_R = 62, DONUT_C = 2 * Math.PI * DONUT_R, DONUT_GAP = 3;
function judgingDonut(cp, teams, scores) {
  const mine = scores.filter((s) => s.checkpoint_id === cp.id);
  const judged = new Set(mine.map((s) => s.team_id));
  const total = teams.length, done = teams.filter((t) => judged.has(t.id)).length, left = total - done;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  const waiting = teams.filter((t) => !judged.has(t.id));
  const avgJudges = done ? (mine.length / done).toFixed(1) : "0";
  // arcs in circumference units; a small surface gap separates the two parts when both exist
  const gap = done && left ? DONUT_GAP : 0;
  const doneLen = Math.max(0, (done / total) * DONUT_C - gap);
  const leftLen = Math.max(0, (left / total) * DONUT_C - gap);
  const seg = (cls, len, offset, tip) => len > 0
    ? `<circle class="donut-seg ${cls}" r="${DONUT_R}" cx="80" cy="80" data-dash="${len.toFixed(2)}" stroke-dasharray="0 ${DONUT_C.toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}"></circle>` : "";
  return `<div class="donut-panel">
    <div class="donut-title"><b>${esc(cp.name)}</b> ${cp.active ? '<span class="badge ok">Open</span>' : '<span class="badge">Closed</span>'}</div>
    <div class="donut-body">
      <div class="donut" role="img" aria-label="${esc(cp.name)}: ${done} of ${total} teams judged">
        <svg viewBox="0 0 160 160">
          <g transform="rotate(-90 80 80)">
            ${seg("done", doneLen, gap / 2, `Judged: ${done} team${done === 1 ? "" : "s"} (${pct(done)}%)`)}
            ${seg("left", leftLen, doneLen + gap * 1.5, `Not judged yet: ${left} team${left === 1 ? "" : "s"} (${pct(left)}%)`)}
          </g>
        </svg>
        <div class="donut-center"><span class="donut-num">${pct(done)}%</span><span class="donut-sub">${done} / ${total} teams</span></div>
      </div>
      <div class="donut-legend">
        <div class="lg-row"><i class="sw done"></i><span>Judged</span><b>${done}</b><span class="muted">${pct(done)}%</span></div>
        <div class="lg-row"><i class="sw left"></i><span>Not judged yet</span><b>${left}</b><span class="muted">${pct(left)}%</span></div>
        <div class="small muted" style="margin-top:6px">${mine.length} score${mine.length === 1 ? "" : "s"} · avg ${avgJudges} judge${avgJudges === "1.0" ? "" : "s"} per judged team</div>
      </div>
    </div>
    ${waiting.length && done ? `<details class="small" style="margin-top:8px"><summary>Teams still waiting (${waiting.length})</summary>
      <div class="waiting">${waiting.map((t) => `<span class="badge">${esc(t.name)}</span>`).join(" ")}</div></details>` : ""}
  </div>`;
}

// Animate arcs in and attach the hover tooltip.
function mountDonuts(root) {
  const segs = root.querySelectorAll(".donut-seg");
  if (!segs.length) return;
  requestAnimationFrame(() => requestAnimationFrame(() => segs.forEach((c) =>
    c.setAttribute("stroke-dasharray", `${c.dataset.dash} ${DONUT_C.toFixed(2)}`))));
  let tip = $("#viz-tip");
  if (!tip) {
    tip = Object.assign(document.createElement("div"), { id: "viz-tip", className: "viz-tip" });
    document.body.appendChild(tip);
  }
  const show = (c, x, y) => {
    tip.textContent = c.dataset.tip;
    tip.style.left = `${x + 14}px`;
    tip.style.top = `${y + 14}px`;
    tip.classList.add("on");
    c.closest(".donut").classList.add("hovering");
    c.classList.add("hot");
  };
  const hide = (c) => {
    tip.classList.remove("on");
    c.closest(".donut")?.classList.remove("hovering");
    c.classList.remove("hot");
  };
  segs.forEach((c) => {
    c.addEventListener("pointermove", (e) => show(c, e.clientX, e.clientY));
    c.addEventListener("pointerleave", () => hide(c));
    c.addEventListener("focus", () => { const r = c.getBoundingClientRect(); show(c, r.left + r.width / 2, r.top + r.height / 2); });
    c.addEventListener("blur", () => hide(c));
  });
}

// ------------------------------------------------------------------ import
function viewImport(main) {
  main.innerHTML = `
    <div class="page-head"><div><h1>Import participants</h1>
      <p class="muted">Upload the registration CSV. Members are grouped under their team automatically and each person gets a unique QR code.</p></div></div>
    <div class="card">
      <div class="dropzone" id="drop"><b>Drop the registration sheet here</b> or click to choose a file<br>
        <span class="small muted">Excel (.xlsx) or CSV – e.g. the Google Form responses download</span>
        <input type="file" id="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></div>
      <details style="margin-top:14px"><summary class="small"><b>Which CSV layouts work?</b></summary>
        <div class="small muted" style="margin-top:8px">
          <p><b>One row per team</b> (typical Google Form): <code>Team Name, Team Size, Team Leader Name, Team Leader Email, Team Member Name 2, Team Member 2 Phone Number, …</code>.
          Forms that branch by team size (repeated columns like "Team Member Name 2 3") are handled, and "Member 1 (Leader)" is merged with the leader.
          If a team submitted twice, the latest row is used.</p>
          <p><b>One row per person</b>: <code>Team Name, Name, Email, Phone, Role</code> (Role "Leader" marks the leader)</p>
          <p>Column names are matched loosely ("Member 1 Mail ID", "2nd member name", "Email Address" all work). Extra columns are ignored.
          Re-importing updates existing people (matched by email) and keeps their QR codes.</p>
          <div class="row"><button class="btn sm" id="tpl-wide">Download team-row template</button>
          <button class="btn sm" id="tpl-long">Download person-row template</button></div>
        </div></details>
    </div>
    <div id="preview"></div>`;
  const drop = $("#drop"), file = $("#file");
  drop.onclick = () => file.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); };
  file.onchange = () => file.files[0] && handle(file.files[0]);
  $("#tpl-wide").onclick = () => download("teams_template.csv", toCSV([
    ["Team Name", "Team Size", "Team Leader Name", "Team Leader Email", "Team Leader Phone", "Member 2 Name", "Member 2 Email", "Member 3 Name", "Member 3 Email", "Member 4 Name", "Member 4 Email"],
    ["Code Crusaders", 3, "Asha Rao", "asha@example.com", "9876543210", "Ravi K", "ravi@example.com", "Meena S", "meena@example.com", "", ""],
  ]));
  $("#tpl-long").onclick = () => download("participants_template.csv", toCSV([
    ["Team Name", "Name", "Email", "Phone", "Role"],
    ["Code Crusaders", "Asha Rao", "asha@example.com", "9876543210", "Leader"],
    ["Code Crusaders", "Ravi K", "ravi@example.com", "", ""],
  ]));

  async function handle(f) {
    let res;
    try { res = analyzeCSV(await readSpreadsheet(f)); } catch (e) {
      $("#preview").innerHTML = `<div class="card"><div class="notice">${esc(e.message)}</div></div>`;
      return;
    }
    const sizes = {};
    res.teams.forEach((t) => (sizes[t.members.length] = (sizes[t.members.length] || 0) + 1));
    $("#preview").innerHTML = `
      <div class="card">
        <h2>Preview – ${esc(f.name)}</h2>
        <div class="grid stats" style="margin:12px 0">
          <div class="stat"><div class="v">${res.teams.length}</div><div class="l">Teams</div></div>
          <div class="stat"><div class="v">${res.memberCount}</div><div class="l">Participants</div></div>
          <div class="stat"><div class="v">${res.teams.filter((t) => t.members.some((m) => m.email)).length}</div><div class="l">Teams with an email</div></div>
        </div>
        ${res.teams.some((t) => t.members.some((m) => !m.email)) ? `<div class="notice info">${res.teams.flatMap((t) => t.members).filter((m) => !m.email).length} people have no email of their own –
          their QR codes are emailed to their <b>team leader</b> (one email per team with every member's QR).</div>` : ""}
        <p class="small muted">Detected layout: <b>${res.mode === "wide" ? "one row per team" : "one row per person"}</b> ·
          Team sizes: ${Object.entries(sizes).map(([k, v]) => `${v} team(s) of ${k}`).join(", ")}</p>
        ${res.warnings.length ? `<div class="notice"><b>${res.warnings.length} warning(s)</b><ul class="warnings">${res.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
        <div class="table-wrap" style="max-height:380px;overflow:auto;border:1px solid var(--line);border-radius:8px">
          <table><thead><tr><th>Team</th><th>Size</th><th>Members</th></tr></thead><tbody>
          ${res.teams.map((t) => `<tr><td><b>${esc(t.name)}</b>${t.college ? `<br><span class="small muted">${esc(t.college)}</span>` : ""}</td><td>${t.members.length}${t.size && t.size !== t.members.length ? ` <span class="badge warn">says ${t.size}</span>` : ""}</td>
            <td>${t.members.map((m) => `${esc(m.name)}${m.leader ? ' <span class="badge brand">Lead</span>' : ""} <span class="muted small">${esc(m.email || m.phone || "")}</span>`).join("<br>")}</td></tr>`).join("")}
          </tbody></table></div>
        <div style="margin-top:16px">
          <label class="check"><input type="radio" name="mode" value="merge" checked> Add / update (keeps existing teams, scans and QR codes)</label>
          <label class="check"><input type="radio" name="mode" value="replace"> Replace everything (deletes all current teams, participants, scans and scores)</label>
        </div>
        <div class="row" style="margin-top:14px"><button class="btn primary lg" id="do-import">Import ${res.teams.length} teams · ${res.memberCount} people</button></div>
      </div>`;
    $("#do-import").onclick = async () => {
      const replace = $('input[name=mode]:checked').value === "replace";
      if (replace && !(await confirmBox("This deletes <b>all</b> existing teams, participants, scans and scores before importing. Continue?", "Replace all", true))) return;
      const btn = $("#do-import");
      btn.disabled = true; btn.textContent = "Importing…";
      try {
        const out = must(await sb.rpc("import_teams", { p_data: res.teams, p_replace: replace }));
        toast(`Imported: ${out.teams_created} new teams, ${out.members_created} new people, ${out.members_updated} updated`, "ok");
        location.hash = "#/teams";
      } catch (e) {
        toast(e.message, "bad");
        btn.disabled = false; btn.textContent = "Try again";
      }
    };
  }
}

// ------------------------------------------------------------------ teams
function emailBadge(p) {
  const via = p.email ? "" : ' <span class="badge info" title="No own email – QR goes to the team leader">via leader</span>';
  if (p.email_status === "sent") return `<span class="badge ok" title="${esc(fmtTime(p.email_sent_at))}">Mailed</span>${via}`;
  if (p.email_status === "failed") return `<span class="badge bad" title="${esc(p.email_error)}">Mail failed</span>${via}`;
  return `<span class="badge">Not mailed</span>${via}`;
}
function showQr(p, team) {
  const leader = team.participants.find((x) => x.is_leader && x.email) || team.participants.find((x) => x.email);
  modal(`
    <h2>${esc(p.name)}</h2><p class="muted small" style="margin:0 0 12px">${esc(team.name)} · ${esc(p.email || p.phone || "")}</p>
    <div class="qr-box">${qrSvg(p.token)}</div>
    <p style="text-align:center">Pass code <span class="code">${esc(p.token)}</span></p>
    <div class="actions">
      <button class="btn" data-close>Close</button>
      <button class="btn" id="qr-dl">Download PNG</button>
      ${p.email && p.email !== leader?.email ? `<button class="btn" id="qr-mail">Email only ${esc(p.name.split(" ")[0])}</button>` : ""}
      ${leader ? `<button class="btn primary" id="qr-team" title="One email to ${esc(leader.email)} with all ${team.participants.length} QR codes">Email team's QRs to leader</button>` : ""}
    </div>`, (m, close) => {
    $("#qr-dl", m).onclick = async () => {
      const a = Object.assign(document.createElement("a"), { href: await qrPng(p.token, p.name, team.name), download: `${p.name.replace(/\W+/g, "_")}_QR.png` });
      a.click();
    };
    const send = async (btn, body, done) => {
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        const { results } = await callAdmin(body);
        if (results[0]?.ok) { toast(done, "ok"); close(); route(); }
        else throw new Error(results[0]?.error || "Failed");
      } catch (e) { toast(e.message, "bad"); btn.disabled = false; btn.textContent = label; }
    };
    const one = $("#qr-mail", m);
    if (one) one.onclick = () => send(one, { action: "send_qr", ids: [p.id] }, `QR sent to ${p.email}`);
    const all = $("#qr-team", m);
    if (all) all.onclick = () => send(all, { action: "send_team", team_ids: [team.id] }, `${team.participants.length} QR codes sent to ${leader.email}`);
  });
}

async function emailTeam(t, btn) {
  const leader = t.participants.find((x) => x.is_leader && x.email) || t.participants.find((x) => x.email);
  if (!leader) return toast(`${t.name} has no email address – add one to the leader first`, "bad");
  const again = t.participants.some((p) => p.email_status === "sent") ? " <b>They were already mailed once</b> – this sends again." : "";
  if (!(await confirmBox(`Email all <b>${t.participants.length}</b> QR codes of <b>${esc(t.name)}</b> to <b>${esc(leader.email)}</b>?${again}`, "Send"))) return;
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
  try {
    const { results } = await callAdmin({ action: "send_team", team_ids: [t.id] });
    if (!results[0]?.ok) throw new Error(results[0]?.error || "Failed");
    toast(`${t.participants.length} QR codes sent to ${leader.email}`, "ok");
    route();
  } catch (e) {
    toast(e.message, "bad");
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

function editParticipant(p, teams) {
  const isNew = !p.id;
  modal(`
    <h2>${isNew ? "Add participant" : "Edit participant"}</h2>
    <form id="pf">
      <div class="field"><label>Name</label><input name="name" required value="${esc(p.name)}"></div>
      <div class="field"><label>Email</label><input name="email" type="email" value="${esc(p.email)}"></div>
      <div class="field"><label>Phone</label><input name="phone" value="${esc(p.phone)}"></div>
      <div class="field"><label>Team</label><select name="team_id">${teams.map((t) => `<option value="${t.id}" ${t.id === p.team_id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
      <label class="check"><input type="checkbox" name="is_leader" ${p.is_leader ? "checked" : ""}> Team leader</label>
      <div class="actions">
        ${isNew ? "" : '<button type="button" class="btn danger" id="p-del">Delete</button><button type="button" class="btn" id="p-regen">New QR code</button>'}
        <button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`, (m, close) => {
    $("#pf", m).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const row = {
        name: f.get("name").trim(), email: f.get("email").trim().toLowerCase() || null, phone: f.get("phone").trim() || null,
        team_id: Number(f.get("team_id")), is_leader: f.get("is_leader") === "on",
      };
      try {
        must(isNew ? await sb.from("participants").insert(row) : await sb.from("participants").update(row).eq("id", p.id));
        toast("Saved", "ok"); close(); route();
      } catch (er) { toast(er.message.includes("participants_email_key") ? "That email is already registered" : er.message, "bad"); }
    };
    if (!isNew) {
      $("#p-del", m).onclick = async () => {
        if (!(await confirmBox(`Delete ${esc(p.name)}? Their scans are removed too.`, "Delete", true))) return;
        try { must(await sb.from("participants").delete().eq("id", p.id)); toast("Deleted"); close(); route(); } catch (er) { toast(er.message, "bad"); }
      };
      $("#p-regen", m).onclick = async () => {
        if (!(await confirmBox("Issue a new QR code? The old one stops working and the person needs the new email.", "New code"))) return;
        const token = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
        try { must(await sb.from("participants").update({ token, email_status: "pending" }).eq("id", p.id)); toast("New QR issued", "ok"); close(); route(); } catch (er) { toast(er.message, "bad"); }
      };
    }
  });
}

function editTeam(t, teams) {
  modal(`
    <h2>Edit team</h2>
    <form id="tf">
      <div class="field"><label>Team name</label><input name="name" required value="${esc(t.name)}"></div>
      <div class="row"><div class="grow"><label>Table / team number</label><input name="table_no" value="${esc(t.table_no)}" placeholder="e.g. 12 or A-07"></div>
        <div class="grow"><label>College</label><input name="college" value="${esc(t.college)}"></div></div>
      <p class="small muted" id="tf-warn"></p>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`, (m, close) => {
    const tno = $("[name=table_no]", m);
    tno.oninput = () => {
      const clash = teams.find((x) => x.id !== t.id && x.table_no && x.table_no.toLowerCase() === tno.value.trim().toLowerCase());
      $("#tf-warn", m).textContent = clash ? `Table ${tno.value.trim()} is already used by ${clash.name}.` : "";
    };
    $("#tf", m).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const row = { name: f.get("name").trim(), table_no: f.get("table_no").trim() || null, college: f.get("college").trim() || null };
      try { must(await sb.from("teams").update(row).eq("id", t.id)); toast("Team saved", "ok"); close(); route(); }
      catch (er) { toast(er.message.includes("teams_name_key") ? "Another team already has that name" : er.message, "bad"); }
    };
  });
}

function numberTables(teams) {
  const numbered = teams.filter((t) => t.table_no).length;
  modal(`
    <h2>Table numbers</h2>
    <p class="small muted" style="margin-top:0">Give every team a table / team number. Judges see it next to the team name. You can still change single teams with <b>Edit</b>.</p>
    <form id="nf">
      <div class="field"><label>Order</label><select name="order">
        <option value="name">Team name A→Z</option><option value="college">College, then team name</option><option value="table">Keep current table order</option></select></div>
      <div class="row"><div class="grow"><label>Start at</label><input name="start" type="number" min="0" value="1"></div>
        <div class="grow"><label>Prefix (optional)</label><input name="prefix" placeholder="e.g. T-"></div>
        <div class="grow"><label>Digits</label><select name="pad"><option value="0">1, 2 … 93</option><option value="2">01, 02 …</option><option value="3">001, 002 …</option></select></div></div>
      <label class="check"><input type="checkbox" name="only_missing" ${numbered ? "checked" : ""}> Only teams without a number (${teams.length - numbered} of ${teams.length})</label>
      <p class="small muted" id="nf-preview"></p>
      <div class="actions">${numbered ? '<button type="button" class="btn danger" id="nf-clear">Clear all numbers</button>' : ""}
        <button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Apply</button></div>
    </form>`, (m, close) => {
    const form = $("#nf", m);
    const plan = () => {
      const f = new FormData(form);
      const order = f.get("order");
      const list = [...teams].sort(order === "table" ? byTable
        : order === "college" ? (a, b) => (a.college || "").localeCompare(b.college || "") || a.name.localeCompare(b.name)
        : (a, b) => a.name.localeCompare(b.name));
      const used = new Set(teams.filter((t) => t.table_no).map((t) => t.table_no.toLowerCase()));
      const onlyMissing = f.get("only_missing") === "on";
      let n = Number(f.get("start")) || 0;
      const label = () => `${f.get("prefix").trim()}${String(n).padStart(Number(f.get("pad")), "0")}`;
      const out = [];
      for (const t of list) {
        if (onlyMissing && t.table_no) continue;
        if (onlyMissing) while (used.has(label().toLowerCase())) n++;
        out.push({ t, no: label() });
        n++;
      }
      return out;
    };
    const preview = () => {
      const p = plan();
      $("#nf-preview", m).textContent = p.length
        ? `${p.length} team(s): ${p.slice(0, 3).map((x) => `${x.t.name} → ${x.no}`).join(", ")}${p.length > 3 ? " …" : ""}`
        : "Nothing to number.";
    };
    form.oninput = preview;
    preview();
    const save = async (rows, btn) => {
      btn.disabled = true;
      try {
        for (let i = 0; i < rows.length; i += 10) {
          await Promise.all(rows.slice(i, i + 10).map(({ id, table_no }) => sb.from("teams").update({ table_no }).eq("id", id).then(must)));
          btn.textContent = `Saving ${Math.min(i + 10, rows.length)}/${rows.length}…`;
        }
        toast(`Updated ${rows.length} team(s)`, "ok"); close(); route();
      } catch (er) { toast(er.message, "bad"); btn.disabled = false; btn.textContent = "Retry"; }
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const p = plan();
      if (!p.length) return toast("Nothing to number", "bad");
      save(p.map(({ t, no }) => ({ id: t.id, table_no: no })), $("button.primary", form));
    };
    const clr = $("#nf-clear", m);
    if (clr) clr.onclick = async () => {
      if (!(await confirmBox("Remove the table number from every team?", "Clear all", true))) return;
      save(teams.filter((t) => t.table_no).map((t) => ({ id: t.id, table_no: null })), clr);
    };
  });
}

async function viewTeams(main) {
  const teams = await getTeams();
  const total = teams.reduce((n, t) => n + t.participants.length, 0);
  main.innerHTML = `
    <div class="page-head"><div><h1>Teams & QR codes</h1><p class="muted">${teams.length} teams · ${total} participants</p></div>
      <div class="row"><button class="btn" id="add-team">+ Team</button><button class="btn" id="add-p" ${teams.length ? "" : "disabled"}>+ Participant</button>
      <button class="btn" id="tmode">✎ Table numbers</button>
      <button class="btn" id="exp">Export CSV</button><a class="btn" href="#/print">Print badges</a></div></div>
    <div class="row" style="margin-bottom:14px"><input class="grow" id="q" placeholder="Search team, table, college, name, email, phone or code…">
      <select id="sort" style="width:auto"><option value="name">Sort: name</option><option value="table">Sort: table no.</option></select>
      <select id="filter" style="width:auto"><option value="">All</option><option value="pending">Not mailed</option><option value="sent">Mailed</option><option value="failed">Mail failed</option><option value="noemail">No email</option></select></div>
    <div id="list"></div>`;

  let tableMode = false;
  // Quick entry: every team in one table with a number box; Enter saves and moves to the next team.
  const drawTables = (q) => {
    const shown = teams.filter((t) => !q || `${t.name} ${t.college || ""} ${t.table_no || ""}`.toLowerCase().includes(q));
    const numbered = teams.filter((t) => t.table_no).length;
    $("#list").innerHTML = `<div class="card tbl-entry">
      <div class="row" style="margin-bottom:10px">
        <div class="grow"><b>Table numbers</b> <span class="badge ${numbered === teams.length ? "ok" : ""}">${numbered} / ${teams.length} numbered</span><br>
          <span class="small muted">Type a number and press <b>Enter</b> – it saves and jumps to the next team. ↑/↓ move between rows, Esc undoes.</span></div>
        <button class="btn sm" id="auto-num">Auto-number…</button><button class="btn sm primary" id="tdone">Done</button></div>
      <div class="table-wrap"><table><thead><tr><th style="width:140px">Table</th><th>Team</th><th>College</th><th style="width:80px">Members</th><th style="width:170px"></th></tr></thead><tbody>
      ${shown.map((t) => `<tr><td><input class="tno-input" data-tno="${t.id}" value="${esc(t.table_no)}" maxlength="20" autocomplete="off" enterkeyhint="next" placeholder="—" aria-label="Table number for ${esc(t.name)}"></td>
        <td><b>${esc(t.name)}</b></td><td class="small muted">${esc(t.college || "")}</td><td>${t.participants.length}</td>
        <td class="small" data-st="${t.id}"></td></tr>`).join("") || '<tr><td colspan="5" class="empty">No matching teams</td></tr>'}
      </tbody></table></div></div>`;
    markDuplicates();
  };
  const markDuplicates = () => {
    const seen = new Map();
    teams.forEach((t) => t.table_no && seen.set(t.table_no.toLowerCase(), [...(seen.get(t.table_no.toLowerCase()) || []), t]));
    $$(".tno-input").forEach((inp) => {
      const t = teams.find((x) => x.id === Number(inp.dataset.tno));
      const same = t.table_no ? seen.get(t.table_no.toLowerCase()).filter((x) => x.id !== t.id) : [];
      inp.classList.toggle("dup", same.length > 0);
      const st = $(`[data-st="${t.id}"]`);
      if (same.length) st.innerHTML = `<span style="color:var(--warn)">Same as ${esc(same.map((x) => x.name).join(", "))}</span>`;
      else if (st.dataset.saved !== "1") st.innerHTML = "";
    });
  };
  const saveTable = async (inp) => {
    const t = teams.find((x) => x.id === Number(inp.dataset.tno));
    const v = inp.value.trim() || null;
    // Enter saves and moves focus, which also fires "change": skip the second call
    if ((t.table_no || null) === v || inp.dataset.pending === (v ?? "")) return;
    inp.dataset.pending = v ?? "";
    const st = $(`[data-st="${t.id}"]`);
    st.innerHTML = '<span class="muted">Saving…</span>';
    try {
      must(await sb.from("teams").update({ table_no: v }).eq("id", t.id));
      t.table_no = v;
      st.dataset.saved = "1";
      st.innerHTML = `<span style="color:var(--ok)">✓ Saved</span>`;
      setTimeout(() => { st.dataset.saved = ""; markDuplicates(); }, 1800);
      markDuplicates();
      const numbered = teams.filter((x) => x.table_no).length;
      const badge = $(".tbl-entry .badge");
      if (badge) { badge.textContent = `${numbered} / ${teams.length} numbered`; badge.classList.toggle("ok", numbered === teams.length); }
    } catch (er) {
      st.innerHTML = `<span style="color:var(--bad)">Not saved</span>`;
      toast(er.message, "bad");
    } finally {
      delete inp.dataset.pending;
    }
  };

  const draw = () => {
    const q = $("#q").value.trim().toLowerCase(), fl = $("#filter").value;
    teams.sort($("#sort").value === "table" ? byTable : (a, b) => a.name.localeCompare(b.name));
    if (tableMode) return drawTables(q);
    const match = (p) => (!fl || (fl === "noemail" ? !p.email : p.email && p.email_status === fl));
    const rows = teams.map((t) => {
      const teamHit = !q || `${t.name} ${t.college || ""} table ${t.table_no || "-"}`.toLowerCase().includes(q);
      const ms = t.participants.filter((p) => match(p) && (teamHit || [p.name, p.email, p.phone, p.token].some((v) => (v || "").toLowerCase().includes(q))));
      return { t, ms };
    }).filter((x) => x.ms.length || (!fl && (!q || x.t.name.toLowerCase().includes(q))));
    $("#list").innerHTML = rows.length ? rows.map(({ t, ms }) => {
      const sent = t.participants.filter((p) => p.email_status === "sent").length;
      const sorted = [...ms].sort((a, b) => b.is_leader - a.is_leader || a.name.localeCompare(b.name));
      return `<details class="team" ${q || fl ? "open" : ""}>
        <summary><span class="name">${esc(t.name)}${t.college ? ` <span class="small muted" style="font-weight:400">· ${esc(t.college)}</span>` : ""}</span>
          ${tableTag(t)}
          <span class="badge">${t.participants.length} member${t.participants.length === 1 ? "" : "s"}</span>
          ${t.declared_size && t.declared_size !== t.participants.length ? `<span class="badge warn">size ${t.declared_size}</span>` : ""}
          <span class="badge ${sent === t.participants.length && sent ? "ok" : ""}">${sent}/${t.participants.length} mailed</span>
          <button class="btn sm primary" data-team-mail="${t.id}" title="Email every member's QR to the team leader">✉ Email QRs</button>
          <button class="btn sm" data-team-edit="${t.id}">Edit</button>
          <button class="btn sm danger" data-team-del="${t.id}">Delete</button></summary>
        <div class="members">${sorted.map((p) => `
          <div class="member"><div class="who"><b>${esc(p.name)}</b> ${p.is_leader ? '<span class="badge brand">Lead</span>' : ""}<br>
            <span class="small muted">${esc(p.email || "—")} ${p.phone ? "· " + esc(p.phone) : ""} · <span class="code">${esc(p.token)}</span></span></div>
            ${emailBadge(p)}
            <button class="btn sm" data-qr="${p.id}">QR</button><button class="btn sm" data-edit="${p.id}">Edit</button></div>`).join("") || '<div class="empty">No members</div>'}
        </div></details>`;
    }).join("") : `<div class="empty">${teams.length ? "No matches" : 'No teams yet – <a href="#/import">import a CSV</a>.'}</div>`;
  };
  draw();
  $("#q").oninput = draw;
  $("#filter").onchange = draw;
  $("#sort").onchange = draw;
  const setMode = (on) => {
    tableMode = on;
    $("#tmode").classList.toggle("primary", on);
    $("#filter").style.display = on ? "none" : "";
    draw();
    if (on) $(".tno-input")?.focus();
  };
  $("#tmode").onclick = () => setMode(!tableMode);
  $("#list").addEventListener("click", (e) => {
    if (e.target.id === "tdone") setMode(false);
    if (e.target.id === "auto-num") numberTables(teams);
  });
  $("#list").addEventListener("change", (e) => { if (e.target.matches(".tno-input")) saveTable(e.target); });
  $("#list").addEventListener("keydown", (e) => {
    const inp = e.target.closest(".tno-input");
    if (!inp) return;
    const all = $$(".tno-input"), i = all.indexOf(inp);
    const go = (j) => { const n = all[j]; if (n) { n.focus(); n.select(); } };
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); saveTable(inp); go(e.shiftKey ? i - 1 : i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); saveTable(inp); go(i - 1); }
    else if (e.key === "Escape") { const t = teams.find((x) => x.id === Number(inp.dataset.tno)); inp.value = t.table_no || ""; inp.blur(); }
  });

  const findP = (id) => { for (const t of teams) for (const p of t.participants) if (p.id === id) return [p, t]; return []; };
  $("#list").onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b || tableMode) return;
    e.preventDefault();
    if (b.dataset.qr) { const [p, t] = findP(Number(b.dataset.qr)); showQr(p, t); }
    if (b.dataset.edit) { const [p, t] = findP(Number(b.dataset.edit)); editParticipant({ ...p, team_id: t.id }, teams); }
    if (b.dataset.teamEdit) editTeam(teams.find((x) => x.id === Number(b.dataset.teamEdit)), teams);
    if (b.dataset.teamMail) await emailTeam(teams.find((x) => x.id === Number(b.dataset.teamMail)), b);
    if (b.dataset.teamDel) {
      const t = teams.find((x) => x.id === Number(b.dataset.teamDel));
      if (!(await confirmBox(`Delete team <b>${esc(t.name)}</b> and its ${t.participants.length} member(s)? Their QR codes stop working and their scans and scores are removed. This can't be undone.`, "Delete team", true))) return;
      try { must(await sb.from("teams").delete().eq("id", t.id)); toast("Team deleted"); route(); } catch (er) { toast(er.message, "bad"); }
    }
  };
  $("#add-team").onclick = async () => {
    const name = prompt("New team name");
    if (!name?.trim()) return;
    try { must(await sb.from("teams").insert({ name: name.trim() })); toast("Team created – now add participants", "ok"); route(); }
    catch (er) { toast(er.message.includes("teams_name_key") ? "A team with that name exists" : er.message, "bad"); }
  };
  $("#add-p").onclick = () => editParticipant({ name: "", email: "", phone: "", team_id: teams[0]?.id }, teams);
  $("#exp").onclick = () => download("participants_qr.csv", toCSV([
    ["Table", "Team", "Name", "Email", "Phone", "Leader", "QR code", "Email status"],
    ...teams.flatMap((t) => t.participants.map((p) => [t.table_no, t.name, p.name, p.email, p.phone, p.is_leader ? "yes" : "", p.token, p.email_status])),
  ]));
}

async function viewPrint(main) {
  const teams = await getTeams();
  main.innerHTML = `
    <div class="page-head no-print"><div><h1>Print badges</h1><p class="muted">One QR per participant, grouped by team. Use your browser's print (Ctrl+P).</p></div>
      <div class="row"><a class="btn" href="#/teams">Back</a><button class="btn primary" onclick="print()">Print</button></div></div>
    <div class="badges">${teams.flatMap((t) => t.participants.map((p) => `
      <div class="badge-card">${qrSvg(p.token)}<div class="n">${esc(p.name)}</div><div class="t">${esc(t.name)}${t.table_no ? ` · Table ${esc(t.table_no)}` : ""}</div><div class="t code">${esc(p.token)}</div></div>`)).join("")}</div>`;
}

// ------------------------------------------------------------------ checkpoints
function editCheckpoint(c) {
  const isNew = !c.id;
  const crit = c.criteria?.length ? c.criteria : [
    { name: "Innovation", max: 10, desc: "How original is the idea? Is it a new approach rather than a copy of an existing solution?" },
    { name: "Impact on SDGs", max: 10, desc: "Which Sustainable Development Goal does it address, and how much real difference could it make?" },
    { name: "Technical execution", max: 10, desc: "Does the prototype work? Quality of the build, use of technology and data." },
    { name: "Presentation", max: 10, desc: "Clarity of the pitch and demo, and how well the team answers questions." },
  ];
  modal(`
    <h2>${isNew ? "New checkpoint" : "Edit checkpoint"}</h2>
    <form id="cf">
      <div class="field"><label>Name</label><input name="name" required value="${esc(c.name)}" placeholder="e.g. Check-in, Lunch Day 1, Round 1 Judging"></div>
      <div class="field"><label>What happens here?</label>
        <label class="check"><input type="radio" name="type" value="scan" ${c.type !== "judging" ? "checked" : ""}> <span><b>QR scan</b> – volunteers scan each participant (check-in, meals, swag…)</span></label>
        <label class="check"><input type="radio" name="type" value="judging" ${c.type === "judging" ? "checked" : ""}> <span><b>Judging</b> – mentors grade each team against criteria</span></label></div>
      <div class="field"><label>Description (optional)</label><input name="description" value="${esc(c.description)}"></div>
      <label class="check" id="ask-wrap"><input type="checkbox" name="ask_table" ${c.ask_table ? "checked" : ""}>
        <span><b>Collect table numbers here</b> – when a volunteer scans anyone from a team without a table number, they're asked to enter it (use this for check-in)</span></label>
      <div class="field" id="crit-wrap"><label>Grading criteria</label>
        <p class="small muted" style="margin:0 0 8px">Give each criterion a maximum score and, optionally, a description – judges see it while scoring.</p><div id="crit"></div>
        <button type="button" class="btn sm" id="add-crit">+ Criterion</button></div>
      <div class="row" style="margin-bottom:12px">
        <div class="grow"><label>Starts</label><input name="starts_at" type="datetime-local" value="${toLocalInput(c.starts_at)}"></div>
        <div class="grow"><label>Ends</label><input name="ends_at" type="datetime-local" value="${toLocalInput(c.ends_at)}"></div></div>
      <p class="small muted" style="margin-top:-6px">Optional. Shown to volunteers/judges and used to pick the current checkpoint automatically. Scanning is only blocked when you mark it Closed.</p>
      <div class="row"><div class="grow"><label>Order (if no time)</label><input name="sort_order" type="number" value="${c.sort_order ?? 0}"></div>
        <label class="check" style="margin-top:20px"><input type="checkbox" name="active" ${c.active !== false ? "checked" : ""}> Open (can be scanned / graded now)</label></div>
      <div class="actions">${isNew ? "" : '<button type="button" class="btn danger" id="c-del">Delete</button>'}
        <button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`, (m, close) => {
    const critEl = $("#crit", m);
    const addRow = (x = { name: "", max: 10, desc: "" }) => {
      const d = document.createElement("div");
      d.className = "crit-edit";
      d.innerHTML = `<div class="row"><input class="grow" data-cn placeholder="Criterion, e.g. Innovation" value="${esc(x.name)}" aria-label="Criterion name">
          <label class="crit-max">Max <input type="number" data-cm min="1" value="${x.max}" aria-label="Maximum score"></label>
          <button type="button" class="btn sm danger" title="Remove criterion">✕</button></div>
        <textarea data-cd rows="2" maxlength="500" placeholder="Description for judges (optional) – what should they look for?" aria-label="Criterion description">${esc(x.desc || "")}</textarea>`;
      $("button", d).onclick = () => d.remove();
      critEl.appendChild(d);
    };
    crit.forEach(addRow);
    $("#add-crit", m).onclick = () => addRow();
    const sync = () => {
      const judging = $('input[name=type]:checked', m).value === "judging";
      $("#crit-wrap", m).style.display = judging ? "" : "none";
      $("#ask-wrap", m).style.display = judging ? "none" : "";
    };
    $$('input[name=type]', m).forEach((r) => (r.onchange = sync));
    sync();
    $("#cf", m).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const type = f.get("type");
      const criteria = type === "judging"
        ? $$(".crit-edit", critEl).map((r) => {
            const desc = $("[data-cd]", r).value.trim();
            return { name: $("[data-cn]", r).value.trim(), max: Number($("[data-cm]", r).value) || 10, ...(desc ? { desc } : {}) };
          }).filter((x) => x.name)
        : [];
      if (type === "judging" && !criteria.length) return toast("Add at least one grading criterion", "bad");
      const starts_at = fromLocalInput(f.get("starts_at")), ends_at = fromLocalInput(f.get("ends_at"));
      if (starts_at && ends_at && ends_at <= starts_at) return toast("End time must be after the start time", "bad");
      const row = { name: f.get("name").trim(), type, description: f.get("description").trim() || null, criteria, sort_order: Number(f.get("sort_order")) || 0, active: f.get("active") === "on", starts_at, ends_at,
        ask_table: type === "scan" && f.get("ask_table") === "on" };
      try {
        must(isNew ? await sb.from("checkpoints").insert(row) : await sb.from("checkpoints").update(row).eq("id", c.id));
        toast("Checkpoint saved", "ok"); close(); route();
      } catch (er) { toast(er.message, "bad"); }
    };
    if (!isNew) $("#c-del", m).onclick = async () => {
      if (!(await confirmBox(`Delete <b>${esc(c.name)}</b>? All its scans/scores are deleted.`, "Delete", true))) return;
      try { must(await sb.from("checkpoints").delete().eq("id", c.id)); toast("Deleted"); close(); route(); } catch (er) { toast(er.message, "bad"); }
    };
  });
}

async function viewCheckpoints(main) {
  const cps = await getCheckpoints();
  const row = (c) => `<tr>
    <td><b>${esc(c.name)}</b>${c.description ? `<br><span class="small muted">${esc(c.description)}</span>` : ""}</td>
    <td class="small">${cpWindow(c) ? `${esc(cpWindow(c))}<br>${cpTimeBadge(c)}` : '<span class="muted">—</span>'}</td>
    <td>${c.type === "scan" ? '<span class="badge info">QR scan · volunteers</span>' : '<span class="badge warn">Judging · mentors</span>'}${c.ask_table ? '<br><span class="badge">collects table no.</span>' : ""}</td>
    <td class="small">${c.type === "judging" ? c.criteria.map((x) => `<span ${x.desc ? `title="${esc(x.desc)}" class="has-desc"` : ""}>${esc(x.name)} (${x.max})</span>`).join(", ") : "—"}</td>
    <td><button class="btn sm" data-toggle="${c.id}">${c.active ? "✓ Open" : "Closed"}</button></td>
    <td class="row">${c.type === "judging" ? `<a class="btn sm" href="#/assign/${c.id}">Assign judges</a>` : `<a class="btn sm" href="#/selfcheckin/${c.id}">Attendance QR</a>`}<button class="btn sm" data-edit="${c.id}">Edit</button></td></tr>`;
  main.innerHTML = `
    <div class="page-head"><div><h1>Checkpoints</h1><p class="muted">Mark each checkpoint as a <b>QR scan</b> (volunteers) or <b>judging</b> round (mentors grade teams).</p></div>
      <button class="btn primary" id="new">+ New checkpoint</button></div>
    <div class="card">${cps.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>When</th><th>Type</th><th>Criteria (max)</th><th>Status</th><th></th></tr></thead>
      <tbody>${cps.map(row).join("")}</tbody></table></div>` : `<div class="empty">No checkpoints yet.<br><br>
      <button class="btn" id="quick">Add suggested set: Check-in, Lunch, Dinner, Final judging</button></div>`}</div>`;
  $("#new").onclick = () => editCheckpoint({ type: "scan", sort_order: cps.length + 1 });
  $(".card").onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.edit) editCheckpoint(cps.find((c) => c.id === Number(b.dataset.edit)));
    if (b.dataset.toggle) {
      const c = cps.find((x) => x.id === Number(b.dataset.toggle));
      try { must(await sb.from("checkpoints").update({ active: !c.active }).eq("id", c.id)); route(); } catch (er) { toast(er.message, "bad"); }
    }
    if (b.id === "quick") {
      try {
        must(await sb.from("checkpoints").insert([
          { name: "Check-in", type: "scan", sort_order: 1, ask_table: true },
          { name: "Lunch", type: "scan", sort_order: 2 },
          { name: "Dinner", type: "scan", sort_order: 3 },
          { name: "Final judging", type: "judging", sort_order: 4, criteria: [{ name: "Innovation", max: 10 }, { name: "Impact on SDGs", max: 10 }, { name: "Technical execution", max: 10 }, { name: "Presentation", max: 10 }] },
        ]));
        route();
      } catch (er) { toast(er.message, "bad"); }
    }
  };
}

// ------------------------------------------------------------------ staff
function showCredentials(list) {
  modal(`<h2>Login details</h2>
    <p class="small muted">Share these if the email didn't go through. Passwords are shown only once.</p>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Password</th><th>Mail</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${x.password ? `<span class="pw">${esc(x.password)}</span>` : `<span class="badge bad">${esc(x.error)}</span>`}</td>
      <td>${x.mailed ? '<span class="badge ok">Sent</span>' : x.mailError ? `<span class="badge bad" title="${esc(x.mailError)}">Failed</span>` : "—"}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="actions"><button class="btn" id="cp">Copy all</button><button class="btn primary" data-close>Done</button></div>`, (m) => {
    $("#cp", m).onclick = () => {
      navigator.clipboard.writeText(list.filter((x) => x.password).map((x) => `${x.name} – ${x.email} – ${x.password}`).join("\n"));
      toast("Copied");
    };
  });
}

async function viewStaff(main) {
  const staff = must(await sb.from("staff").select("*").order("role").order("name"));
  const roleLabel = { admin: "Admin", volunteer: "Volunteer (scans QR)", mentor: "Mentor / judge" };
  main.innerHTML = `
    <div class="page-head"><div><h1>Staff</h1><p class="muted">Admins manage everything · Volunteers scan QR codes · Mentors grade teams</p></div></div>
    <div class="grid two">
      <form class="card" id="one">
        <h2>Add one person</h2>
        <div class="field"><label>Name</label><input name="name" required></div>
        <div class="field"><label>Email</label><input name="email" type="email" required></div>
        <div class="field"><label>Role</label><select name="role"><option value="volunteer">Volunteer (scans QR)</option><option value="mentor">Mentor / judge</option><option value="admin">Admin</option></select></div>
        <label class="check"><input type="checkbox" name="notify" checked> Email them their login details</label>
        <div style="margin-top:12px"><button class="btn primary">Add</button></div>
      </form>
      <form class="card" id="bulk">
        <h2>Add many</h2>
        <p class="small muted" style="margin-top:0">One per line: <code>name, email, role</code> (role = admin / volunteer / mentor)</p>
        <textarea name="lines" placeholder="Priya S, priya@example.com, volunteer&#10;Dr. Rao, rao@example.com, mentor"></textarea>
        <label class="check" style="margin-top:8px"><input type="checkbox" name="notify" checked> Email them their login details</label>
        <div style="margin-top:12px"><button class="btn primary">Add all</button> <span class="small muted" id="bulk-st"></span></div>
      </form>
    </div>
    <div class="card" id="staff-list"><h2>Current staff (${staff.length})</h2><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
      ${staff.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.email)}</td>
        <td><select data-role="${esc(s.email)}" style="width:auto" ${s.email === state.me.email ? "disabled" : ""}>${Object.entries(roleLabel).map(([k, v]) => `<option value="${k}" ${k === s.role ? "selected" : ""}>${v}</option>`).join("")}</select></td>
        <td class="row"><button class="btn sm" data-reset="${esc(s.email)}">Reset password</button>
          ${s.email === state.me.email ? "" : `<button class="btn sm danger" data-del="${esc(s.email)}">Remove</button>`}</td></tr>`).join("")}
      </tbody></table></div></div>`;

  const create = async (name, email, role, notify) => {
    try {
      const r = await callAdmin({ action: "create_staff", name, email, role, notify });
      return { name, email, ...r };
    } catch (e) { return { name, email, error: e.message }; }
  };
  $("#one").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const b = $("button", e.target); b.disabled = true;
    const r = await create(f.get("name").trim(), f.get("email").trim().toLowerCase(), f.get("role"), f.get("notify") === "on");
    b.disabled = false;
    if (r.error) return toast(r.error, "bad");
    showCredentials([r]);
    route();
  };
  $("#bulk").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const lines = f.get("lines").split(/\n/).map((l) => l.split(/[,\t;]/).map((x) => x.trim())).filter((x) => x[0] || x[1]);
    const bad = lines.filter((l) => !l[1]?.includes("@") || !["admin", "volunteer", "mentor"].includes((l[2] || "").toLowerCase()));
    if (bad.length) return toast(`Check line: "${bad[0].join(", ")}" – needs name, email, role`, "bad");
    const out = [];
    for (const [i, l] of lines.entries()) {
      $("#bulk-st").textContent = `${i + 1} / ${lines.length}…`;
      out.push(await create(l[0], l[1].toLowerCase(), l[2].toLowerCase(), f.get("notify") === "on"));
    }
    $("#bulk-st").textContent = "";
    showCredentials(out);
    route();
  };
  $("#staff-list").onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.reset) {
      const notify = await confirmBox(`Generate a new password for ${esc(b.dataset.reset)} and email it to them?`, "Reset & email");
      if (!notify) return;
      try { const r = await callAdmin({ action: "reset_password", email: b.dataset.reset, notify: true }); showCredentials([{ name: "", email: b.dataset.reset, ...r }]); }
      catch (er) { toast(er.message, "bad"); }
    }
    if (b.dataset.del) {
      if (!(await confirmBox(`Remove ${esc(b.dataset.del)}? Their login is deleted.`, "Remove", true))) return;
      try { await callAdmin({ action: "delete_staff", email: b.dataset.del }); toast("Removed"); route(); } catch (er) { toast(er.message, "bad"); }
    }
  };
  $$("select[data-role]").forEach((s) => (s.onchange = async () => {
    try { must(await sb.from("staff").update({ role: s.value }).eq("email", s.dataset.role)); toast("Role updated", "ok"); } catch (er) { toast(er.message, "bad"); }
  }));
}

// ------------------------------------------------------------------ emails
const mailJob = { running: false, cancel: false };

async function viewEmails(main, modeArg) {
  const teams = await getTeams();
  const mode = modeArg === "person" ? "person" : "team";
  const people = teams.flatMap((t) => t.participants.map((p) => ({ ...p, team: t })));
  const noOwnEmail = people.filter((p) => !p.email).length;

  // team mode: one email per team to the leader with every member's QR
  const teamStatus = (t) => {
    if (!t.participants.some((p) => p.email)) return "noemail";
    if (t.participants.some((p) => p.email_status === "failed")) return "failed";
    return t.participants.every((p) => p.email_status === "sent") ? "sent" : "pending";
  };
  const leaderOf = (t) => t.participants.find((p) => p.is_leader && p.email) || t.participants.find((p) => p.email);
  const byStatus = (st) => teams.filter((t) => teamStatus(t) === st);
  const personList = (st) => people.filter((p) => p.email && (st === "all" || p.email_status === st));
  const lists = mode === "team"
    ? { pending: byStatus("pending"), failed: byStatus("failed"), all: teams.filter((t) => teamStatus(t) !== "noemail") }
    : { pending: personList("pending"), failed: personList("failed"), all: personList("all") };
  const unit = mode === "team" ? "team" : "person";
  const plural = (n) => `${n} ${unit === "team" ? (n === 1 ? "team" : "teams") : (n === 1 ? "person" : "people")}`;
  const peopleIn = (list) => (mode === "team" ? list.reduce((n, t) => n + t.participants.length, 0) : list.length);
  const failedRows = mode === "team"
    ? byStatus("failed").map((t) => [t.name, leaderOf(t)?.email, t.participants.find((p) => p.email_error)?.email_error])
    : personList("failed").map((p) => [`${p.name} (${p.team.name})`, p.email, p.email_error]);
  const noEmailTeams = byStatus("noemail");

  main.innerHTML = `
    <div class="page-head"><div><h1>Send QR emails</h1>
      <p class="muted">${mode === "team"
        ? "One email per team to the team leader, containing every member's QR code (inline + attached). Other members with an email are cc'd."
        : "One email per person, only for people who have their own email address."}</p></div>
      <div class="row"><a class="btn ${mode === "team" ? "primary" : ""}" href="#/emails/team">Per team</a><a class="btn ${mode === "person" ? "primary" : ""}" href="#/emails/person">Per person</a></div></div>
    <div class="grid stats" style="margin-bottom:16px">
      <div class="stat"><div class="v">${people.filter((p) => p.email_status === "sent").length}</div><div class="l">People whose QR was mailed</div></div>
      <div class="stat"><div class="v">${plural(lists.pending.length)}</div><div class="l">Not mailed yet</div></div>
      <div class="stat"><div class="v">${plural(lists.failed.length)}</div><div class="l">Failed</div></div>
      <div class="stat"><div class="v">${noOwnEmail}</div><div class="l">People without own email${mode === "team" ? " (sent via leader)" : " (skipped)"}</div></div>
    </div>
    ${mode === "person" && noOwnEmail ? `<div class="notice">${noOwnEmail} people have no email of their own and are skipped in this mode. Use <a href="#/emails/team">Per team</a> to send their QR codes to their team leader.</div>` : ""}
    ${noEmailTeams.length ? `<div class="notice">${noEmailTeams.length} team(s) have no email address at all: ${noEmailTeams.map((t) => `<b>${esc(t.name)}</b>`).join(", ")}. Add an email under <a href="#/teams">Teams</a> or print their badges.</div>` : ""}
    ${mode === "team" ? `<div class="card"><h3>Send to one team</h3>
      <div class="row"><input class="grow" id="one-team" list="team-list" placeholder="Type a team name…">
        <datalist id="team-list">${teams.map((t) => `<option value="${esc(t.name)}">`).join("")}</datalist>
        <button class="btn primary" id="one-send">✉ Send this team's QRs</button></div>
      <p class="small muted" id="one-info" style="margin-bottom:0"></p></div>` : ""}
    <div class="card">
      <div class="row">
        <button class="btn primary lg" data-send="pending" ${lists.pending.length ? "" : "disabled"}>✉ Send to all not yet mailed (${plural(lists.pending.length)}${mode === "team" ? ` · ${peopleIn(lists.pending)} QRs` : ""})</button>
        <button class="btn" data-send="failed" ${lists.failed.length ? "" : "disabled"}>Retry failed (${lists.failed.length})</button>
        <button class="btn" data-send="all" ${lists.all.length ? "" : "disabled"}>Resend to all (${lists.all.length})</button>
        <button class="btn" id="test">Send test email to me</button>
      </div>
      <div id="job" style="margin-top:16px;display:none">
        <div class="progress"><div id="bar"></div></div>
        <div class="row" style="justify-content:space-between;margin-top:6px"><span class="small" id="job-st"></span><button class="btn sm danger" id="stop">Stop</button></div>
      </div>
      <p class="small muted" style="margin-bottom:0">Emails go out in small batches from the Gmail account set up on the server (Gmail allows ~2,000/day on Workspace, 500 on personal accounts).
        Progress is saved, so you can close this tab and click "Send to all not yet mailed" again later. Edit the subject and message under <a href="#/settings">Settings</a>.</p>
    </div>
    ${failedRows.length ? `<div class="card"><h2>Failed</h2><div class="table-wrap"><table><thead><tr><th>${mode === "team" ? "Team" : "Name"}</th><th>Email</th><th>Error</th></tr></thead><tbody>
      ${failedRows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="small muted">${esc(r[2])}</td></tr>`).join("")}</tbody></table></div></div>` : ""}`;

  $("#test").onclick = async (e) => {
    e.target.disabled = true;
    try {
      await callAdmin({ action: "test_email", to: state.me.email });
      toast(`Test email sent to ${state.me.email}`, "ok");
    } catch (er) { toast(`Email not working: ${er.message}`, "bad"); }
    e.target.disabled = false;
  };
  $("#stop").onclick = () => { mailJob.cancel = true; $("#job-st").textContent = "Stopping after this batch…"; };
  if (mode === "team") {
    const pick = () => teams.find((t) => t.name.toLowerCase() === $("#one-team").value.trim().toLowerCase());
    $("#one-team").oninput = () => {
      const t = pick();
      const lead = t && leaderOf(t);
      $("#one-info").innerHTML = t ? `${t.participants.length} members · goes to ${esc(lead?.email || "no email!")} · ${
        { sent: "already mailed", pending: "not mailed yet", failed: "last attempt failed", noemail: "no email in team" }[teamStatus(t)]}` : "";
    };
    $("#one-send").onclick = (e) => {
      const t = pick();
      if (!t) return toast("Pick a team from the list", "bad");
      emailTeam(t, e.target);
    };
  }

  $$("[data-send]").forEach((b) => (b.onclick = async () => {
    const list = lists[b.dataset.send];
    const what = mode === "team" ? `${plural(list.length)} (${peopleIn(list)} QR codes, one email per team leader)` : plural(list.length);
    if (!(await confirmBox(`Send QR emails to <b>${what}</b>?`, "Send now"))) return;
    if (mailJob.running) return toast("Already sending", "bad");
    Object.assign(mailJob, { running: true, cancel: false });
    $$("[data-send], #test").forEach((x) => (x.disabled = true));
    $("#job").style.display = "";
    let ok = 0, bad = 0;
    const BATCH = mode === "team" ? 3 : 8;
    for (let i = 0; i < list.length && !mailJob.cancel; i += BATCH) {
      const ids = list.slice(i, i + BATCH).map((x) => x.id);
      try {
        const body = mode === "team" ? { action: "send_team", team_ids: ids } : { action: "send_qr", ids };
        const { results } = await callAdmin(body);
        results.forEach((r) => (r.ok ? ok++ : bad++));
      } catch (er) {
        bad += ids.length;
        toast(er.message, "bad");
        if (/admins only|not signed in|smtp|auth|invalid login/i.test(er.message)) break;
        await sleep(3000);
      }
      const done = Math.min(i + BATCH, list.length);
      if ($("#bar")) {
        $("#bar").style.width = `${(done / list.length) * 100}%`;
        $("#job-st").textContent = `${done} / ${list.length} ${unit === "team" ? "teams" : "people"} processed · ${ok} sent · ${bad} failed`;
      }
    }
    mailJob.running = false;
    toast(`Done: ${ok} sent, ${bad} failed`, bad ? "bad" : "ok");
    if (location.hash.startsWith("#/emails")) route();
  }));
}

// ------------------------------------------------------------------ scanning
async function stopScanner() {
  if (state.scanner) {
    try { await state.scanner.stop(); } catch { /* already stopped */ }
    try { state.scanner.clear(); } catch { /* ignore */ }
    state.scanner = null;
  }
}

async function startScanner(onCode) {
  await stopScanner();
  const scanner = new window.Html5Qrcode("reader", { formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
  state.scanner = scanner;
  let last = "", lastAt = 0, busy = false;
  await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s }; } },
    async (text) => {
      const now = Date.now();
      if (busy || (text === last && now - lastAt < 4000)) return;
      last = text; lastAt = now; busy = true;
      try { await onCode(text); } finally { busy = false; }
    }, () => {});
}

async function viewScan(main, cpId) {
  const cps = (await getCheckpoints()).filter((c) => c.type === "scan");
  const open = cps.filter((c) => c.active);
  if (!open.length) {
    main.innerHTML = `<h1>Scan</h1><div class="card empty">No open QR-scan checkpoints.${state.me.role === "admin" ? ' <a href="#/checkpoints">Create or open one</a>.' : " Ask an admin to open one."}</div>`;
    return;
  }
  const cp = pickCheckpoint(open, cpId);
  try { localStorage.setItem("cp", cp.id); } catch { /* storage unavailable */ }
  const { count: total } = await sb.from("participants").select("id", { count: "exact", head: true });
  let { count: done } = await sb.from("scans").select("id", { count: "exact", head: true }).eq("checkpoint_id", cp.id);

  main.innerHTML = `
    <div class="page-head"><div><h1>Scan</h1></div>
      <select id="cp" style="width:auto;min-width:200px">${open.map((c) => cpOption(c, cp)).join("")}</select></div>
    ${cpTimeState(cp) === "upcoming" || cpTimeState(cp) === "over" ? `<div class="notice">${esc(cp.name)} is scheduled for <b>${esc(cpWindow(cp))}</b> ${cpTimeBadge(cp)} – double-check you've picked the right checkpoint.</div>` : ""}
    <div class="scan-layout">
      <div>
        <div id="reader"></div>
        <div class="row" style="margin-top:10px"><button class="btn" id="cam">Start camera</button><span class="small muted" id="cam-st"></span></div>
      </div>
      <div>
        <div class="result idle" id="res"><div><div class="result-ico">${icon("scan")}</div><div class="big">Ready to scan</div><div class="sub muted">Point the camera at a participant's QR</div></div></div>
        <div class="card" style="margin-top:12px">
          <div class="row" style="justify-content:space-between"><span><b>${esc(cp.name)}</b> ${cpTimeBadge(cp)}</span><span><b id="done">${done}</b> / ${total} scanned</span></div>
          <div class="progress" style="margin-top:6px"><div id="bar" style="width:${total ? (done / total) * 100 : 0}%"></div></div>
        </div>
        <div class="card"><h3>Manual entry</h3><p class="small muted" style="margin-top:0">No QR? Search by name, email or pass code.</p>
          <input id="ms" placeholder="Search…"><div id="ms-res"></div></div>
        <div class="card"><h3>Recent at this checkpoint</h3><div id="recent" class="small"></div></div>
      </div>
    </div>`;
  $("#cp").onchange = (e) => (location.hash = `#/scan/${e.target.value}`);

  const recent = async () => {
    const rows = must(await sb.from("scans").select("scanned_at,scanner_name,participants(name,teams(name))").eq("checkpoint_id", cp.id).order("scanned_at", { ascending: false }).limit(8));
    if ($("#recent")) $("#recent").innerHTML = rows.map((r) => `<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)">
      <span><b>${esc(r.participants?.name)}</b> <span class="muted">${esc(r.participants?.teams?.name)}</span></span><span class="muted">${fmtTime(r.scanned_at)}</span></div>`).join("") || '<span class="muted">None yet</span>';
  };
  recent();

  const show = (kind, title, sub) => {
    const ic = { ok: "check", dup: "alert", bad: "x" }[kind];
    const el = $("#res");
    el.className = `result ${kind}`;
    el.innerHTML = `<div>${ic ? `<div class="result-ico">${icon(ic)}</div>` : kind === "" ? '<div class="spinner"></div>' : ""}
      <div class="big">${title}</div><div class="sub">${sub || ""}</div></div>`;
    if (kind) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
  };
  // Team has no table number yet and this checkpoint collects them: ask once, pause the camera meanwhile.
  const askTable = (r) => {
    const box = document.createElement("form");
    box.className = "table-ask";
    box.innerHTML = `<label>Table number for <b>${esc(r.team.name)}</b></label>
      <div class="row"><input name="t" class="grow" autocomplete="off" placeholder="e.g. 12" maxlength="20" required>
        <button class="btn primary">Save</button><button type="button" class="btn" data-skip>Skip</button></div>
      <div class="small muted">Asked once per team – everyone else in the team will see it.</div>`;
    $("#res").firstElementChild.appendChild(box);
    try { state.scanner?.pause(true); } catch { /* not running */ }
    const resume = () => { try { state.scanner?.resume(); } catch { /* not paused */ } };
    const input = $("input", box);
    setTimeout(() => input.focus(), 60);
    $("[data-skip]", box).onclick = () => { box.remove(); resume(); };
    box.onsubmit = async (e) => {
      e.preventDefault();
      const v = input.value.trim();
      try {
        let res = must(await sb.rpc("set_table_no", { p_team: r.team.id, p_table: v }));
        if (res.status === "taken") {
          if (!(await confirmBox(`Table <b>${esc(v)}</b> is already given to <b>${esc(res.team)}</b>. Use it for ${esc(r.team.name)} as well?`, "Use anyway"))) return;
          res = must(await sb.rpc("set_table_no", { p_team: r.team.id, p_table: v, p_force: true }));
        }
        if (res.status !== "ok") throw new Error(res.message || "Could not save");
        box.outerHTML = `<div class="table-saved">${icon("check")} Table <b>${esc(res.table_no)}</b> saved for ${esc(r.team.name)}</div>`;
        resume();
      } catch (er) { toast(er.message, "bad"); }
    };
  };
  const tableBit = (r) => (r.team.table_no ? ` · Table <b>${esc(r.team.table_no)}</b>` : "");

  const handle = async (code) => {
    show("", "Checking…", "");
    try {
      const r = must(await sb.rpc("scan_participant", { p_checkpoint: cp.id, p_code: code }));
      if (r.status === "ok") {
        beep(true);
        done++;
        $("#done").textContent = done;
        $("#bar").style.width = `${(done / total) * 100}%`;
        show("ok", esc(r.participant.name), `Team <b>${esc(r.team.name)}</b>${tableBit(r)} · ${r.team_checked}/${r.team_size} of team scanned here`);
        if (r.ask_table) askTable(r);
        recent();
      } else if (r.status === "duplicate") {
        beep(false);
        show("dup", `Already scanned – ${esc(r.participant.name)}`, `Team ${esc(r.team.name)}${tableBit(r)} · ${fmtTime(r.scanned_at)}${r.scanned_by ? " by " + esc(r.scanned_by) : ""}`);
        if (r.ask_table) askTable(r);
      } else {
        beep(false);
        show("bad", esc(r.message), "");
      }
    } catch (e) { beep(false); show("bad", "Error", esc(e.message)); }
  };

  $("#cam").onclick = async () => {
    if (state.scanner) { await stopScanner(); $("#cam").textContent = "Start camera"; return; }
    try {
      $("#cam-st").textContent = "Starting…";
      await startScanner(handle);
      $("#cam").textContent = "Stop camera";
      $("#cam-st").textContent = "";
    } catch (e) {
      $("#cam-st").textContent = `Camera unavailable: ${e?.message || e}. The site must be opened over https.`;
    }
  };
  $("#cam").click();

  let t;
  $("#ms").oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = $("#ms").value.trim().replace(/[,%()]/g, " ");
      if (q.length < 2) { $("#ms-res").innerHTML = ""; return; }
      const rows = must(await sb.from("participants").select("id,name,email,token,teams(name)")
        .or(`name.ilike.%${q}%,email.ilike.%${q}%,token.ilike.%${q.replace(/\s+/g, "")}%`).limit(8));
      $("#ms-res").innerHTML = rows.map((p) => `<div class="member"><div class="who"><b>${esc(p.name)}</b><br><span class="small muted">${esc(p.teams?.name)} · ${esc(p.email || "")}</span></div>
        <button class="btn sm primary" data-tok="${esc(p.token)}">Mark</button></div>`).join("") || '<div class="small muted" style="padding:8px">No match</div>';
    }, 250);
  };
  $("#ms-res").onclick = (e) => { const b = e.target.closest("[data-tok]"); if (b) handle(b.dataset.tok); };
}

// ------------------------------------------------------------------ attendance (who was marked at each checkpoint)
const fmtFull = (t) => (t ? new Date(t).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const safeName = (s) => String(s).replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "sheet";

async function attendanceData(cpId) {
  const [scans, people] = await Promise.all([
    sb.from("scans").select("id,participant_id,scanned_at,scanner_name").eq("checkpoint_id", cpId).order("scanned_at", { ascending: false }).then(must),
    sb.from("participants").select("id,name,email,phone,is_leader,teams(name,table_no,college)").order("name").then(must),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const seen = new Set();
  const present = scans.filter((s) => byId.has(s.participant_id)).map((s) => {
    seen.add(s.participant_id);
    return { ...byId.get(s.participant_id), scan_id: s.id, at: s.scanned_at, by: s.scanner_name || "Volunteer" };
  });
  const absent = people.filter((p) => !seen.has(p.id));
  return { present, absent, total: people.length };
}

// worksheet with bold-ish header widths sized to the content
function sheetFrom(XLSX, header, rows) {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws["!cols"] = header.map((h, i) => ({ wch: Math.min(45, Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? "").length)) + 2) }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
  return ws;
}
// scans made through the attendance QR are stored as "Self check-in" / "Self check-in (confirmed)"
const markedBy = (by) => (/self check-in \(confirmed\)/i.test(by) ? "Attendance QR (confirmed by staff)" : /self check-in/i.test(by) ? "Attendance QR" : by);
const presentRow = (p, i) => [i + 1, p.name, p.teams?.name || "", p.teams?.table_no || "", p.teams?.college || "", p.email || "", p.phone || "", fmtFull(p.at), markedBy(p.by)];
const PRESENT_HEAD = ["#", "Name", "Team", "Table", "College", "Email", "Phone", "Marked at", "Marked by"];
const absentRow = (p, i) => [i + 1, p.name, p.teams?.name || "", p.teams?.table_no || "", p.teams?.college || "", p.email || "", p.phone || "", p.is_leader ? "Leader" : ""];
const ABSENT_HEAD = ["#", "Name", "Team", "Table", "College", "Email", "Phone", "Role"];

async function downloadAttendance(cp) {
  const XLSX = await loadSheetJs();
  const { present, absent } = await attendanceData(cp.id);
  const byTeam = (a, b) => (a.teams?.name || "").localeCompare(b.teams?.name || "") || a.name.localeCompare(b.name);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, PRESENT_HEAD, [...present].sort(byTeam).map(presentRow)), "Present");
  XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, ABSENT_HEAD, [...absent].sort(byTeam).map(absentRow)), "Not marked");
  XLSX.writeFile(wb, `${safeName(state.settings.event_name || "Event")}_${safeName(cp.name)}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  return present.length;
}

async function downloadAllAttendance(cps) {
  const XLSX = await loadSheetJs();
  const data = await Promise.all(cps.map((c) => attendanceData(c.id)));
  const people = [...data[0].present, ...data[0].absent]
    .sort((a, b) => (a.teams?.name || "").localeCompare(b.teams?.name || "") || a.name.localeCompare(b.name));
  const marks = data.map((d) => new Map(d.present.map((p) => [p.id, p.at])));
  const summary = people.map((p) => [p.name, p.teams?.name || "", p.teams?.table_no || "", p.teams?.college || "",
    ...marks.map((m) => (m.has(p.id) ? `✓ ${fmtFull(m.get(p.id))}` : "")), marks.filter((m) => m.has(p.id)).length]);
  const totals = ["Total present", "", "", "", ...marks.map((m) => m.size), ""];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, ["Name", "Team", "Table", "College", ...cps.map((c) => c.name), "Checkpoints attended"], [...summary, [], totals]), "Summary");
  const used = new Set(["Summary"]);
  cps.forEach((c, i) => {
    let name = c.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
    while (used.has(name)) name = `${name.slice(0, 28)} ${i}`;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, PRESENT_HEAD, data[i].present.map(presentRow)), name);
  });
  XLSX.writeFile(wb, `${safeName(state.settings.event_name || "Event")}_attendance_all_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function viewAttendance(main, cpId, tabArg) {
  const isAdmin = state.me.role === "admin";
  const cps = (await getCheckpoints()).filter((c) => c.type === "scan");
  if (!cps.length) {
    main.innerHTML = `<h1>Attendance</h1><div class="card empty">No check-in or attendance checkpoints yet.${isAdmin ? ' <a href="#/checkpoints">Create one</a>.' : ""}</div>`;
    return;
  }
  const cp = cps.find((c) => c.id === Number(cpId)) || cps[0];
  let tab = tabArg === "absent" ? "absent" : "present";
  const { present, absent, total } = await attendanceData(cp.id);
  const viaQr = present.filter((p) => /self check-in/i.test(p.by)).length;

  main.innerHTML = `
    <div class="page-head"><div><h1>Attendance</h1><p class="muted">Who has been marked at each checkpoint – by volunteers scanning passes or by the attendance QR.</p></div>
      <div class="row"><select id="cp" style="width:auto;min-width:210px">${cps.map((c) => `<option value="${c.id}" ${c.id === cp.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
        <button class="btn primary" id="xl">⬇ Download Excel</button>
        ${cps.length > 1 ? '<button class="btn" id="xl-all">⬇ Excel: all checkpoints</button>' : ""}</div></div>
    <div class="grid stats" style="margin-bottom:16px">
      <div class="stat"><div class="v">${present.length}</div><div class="l">Present at ${esc(cp.name)}</div></div>
      <div class="stat"><div class="v">${absent.length}</div><div class="l">Not marked yet</div></div>
      <div class="stat"><div class="v">${total ? Math.round((present.length / total) * 100) : 0}%</div><div class="l">of ${total} participants</div></div>
      <div class="stat"><div class="v">${viaQr}</div><div class="l">Marked via attendance QR</div></div>
    </div>
    <div class="card">
      <div class="row" style="margin-bottom:12px">
        <div class="seg" role="tablist"><button type="button" data-tab="present">Present (${present.length})</button><button type="button" data-tab="absent">Not marked (${absent.length})</button></div>
        <input id="q" class="grow" placeholder="Search name, team, table or college…">
        <select id="sort" style="width:auto"><option value="time">Newest first</option><option value="team">By team</option><option value="table">By table</option><option value="name">By name</option></select>
      </div>
      <div id="att"></div>
    </div>`;

  const draw = () => {
    $$(".seg [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $("#sort").querySelector('[value="time"]').disabled = tab === "absent";
    const q = $("#q").value.trim().toLowerCase(), sort = tab === "absent" && $("#sort").value === "time" ? "team" : $("#sort").value;
    const list = (tab === "present" ? present : absent)
      .filter((p) => !q || `${p.name} ${p.teams?.name || ""} ${p.teams?.table_no || ""} ${p.teams?.college || ""}`.toLowerCase().includes(q));
    const cmp = {
      time: (a, b) => new Date(b.at) - new Date(a.at),
      team: (a, b) => (a.teams?.name || "").localeCompare(b.teams?.name || "") || a.name.localeCompare(b.name),
      table: (a, b) => byTable({ table_no: a.teams?.table_no, name: a.teams?.name || "" }, { table_no: b.teams?.table_no, name: b.teams?.name || "" }) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
    }[sort];
    list.sort(cmp);
    $("#att").innerHTML = !list.length ? `<div class="empty">${q ? "No matches" : tab === "present" ? "Nobody has been marked here yet." : "Everyone has been marked 🎉"}</div>`
      : `<div class="table-wrap"><table><thead><tr><th>#</th><th>Name</th><th>Team</th><th>Table</th>${tab === "present" ? "<th>Marked at</th><th>Marked by</th>" : "<th>Phone</th>"}${isAdmin && tab === "present" ? "<th></th>" : ""}</tr></thead><tbody>
        ${list.map((p, i) => `<tr><td class="muted">${i + 1}</td><td><b>${esc(p.name)}</b>${p.is_leader ? ' <span class="badge brand">Lead</span>' : ""}</td>
          <td>${esc(p.teams?.name || "")}${p.teams?.college ? `<br><span class="small muted">${esc(p.teams.college)}</span>` : ""}</td><td>${esc(p.teams?.table_no || "—")}</td>
          ${tab === "present" ? `<td class="small">${fmtFull(p.at)}</td><td>${/self check-in/i.test(p.by) ? `<span class="badge info">${esc(markedBy(p.by))}</span>` : `<span class="small">${esc(p.by)}</span>`}</td>`
            : `<td class="small">${p.phone ? `<a href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">${esc(p.phone)}</a>` : "—"}</td>`}
          ${isAdmin && tab === "present" ? `<td><button class="btn sm danger" data-undo="${p.scan_id}" title="Remove this check-in">Remove</button></td>` : ""}</tr>`).join("")}
        </tbody></table></div>`;
  };
  draw();
  $("#q").oninput = draw;
  $("#sort").onchange = draw;
  $(".seg").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; draw(); } };
  $("#cp").onchange = (e) => (location.hash = `#/attendance/${e.target.value}`);
  $("#att").onclick = async (e) => {
    const b = e.target.closest("[data-undo]");
    if (!b) return;
    const p = present.find((x) => x.scan_id === Number(b.dataset.undo));
    if (!(await confirmBox(`Remove <b>${esc(p.name)}</b> from ${esc(cp.name)}? They'll show as not marked.`, "Remove", true))) return;
    try { must(await sb.from("scans").delete().eq("id", p.scan_id)); toast("Removed"); route(); } catch (er) { toast(er.message, "bad"); }
  };
  const busy = async (btn, fn) => {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Preparing…";
    try { await fn(); toast("Excel file downloaded", "ok"); } catch (er) { toast(er.message, "bad"); }
    btn.disabled = false; btn.textContent = label;
  };
  $("#xl").onclick = (e) => busy(e.target, () => downloadAttendance(cp));
  const all = $("#xl-all");
  if (all) all.onclick = (e) => busy(e.target, () => downloadAllAttendance(cps));
}

// ------------------------------------------------------------------ self check-in (display screen + review)
// Same code as public.self_code_ok(): first 10 hex chars of sha256(secret + ":" + 10-minute window).
const QR_WINDOW = 600;
async function selfCode(secret, at = Date.now()) {
  const win = Math.floor(at / 1000 / QR_WINDOW);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}:${win}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 10);
}
const selfUrl = (cp, code) => new URL(`checkin.html?c=${cp.id}&k=${code}`, document.baseURI).href;
const pageTimer = (fn, ms) => state.timers.push(setInterval(fn, ms));

async function viewDisplay(main, cpId) {
  const cp = must(await sb.from("checkpoints").select("*").eq("id", Number(cpId)).maybeSingle());
  if (!cp || cp.type !== "scan") {
    main.innerHTML = `<div class="display-msg"><h1>Checkpoint not found</h1><a class="btn" href="#/selfcheckin">Back</a></div>`;
    return;
  }
  if (!cp.self_checkin || !cp.active) {
    main.innerHTML = `<div class="display-msg"><img src="assets/logo.png" alt="" class="display-logo"><h1>The attendance QR is off for ${esc(cp.name)}</h1>
      <p class="muted">${cp.active ? "Turn it on from the Attendance QR page." : "This sheet is closed."}</p><a class="btn primary" href="#/selfcheckin/${cp.id}">Open Attendance QR</a></div>`;
    return;
  }
  const { count: total } = await sb.from("participants").select("id", { count: "exact", head: true });
  main.innerHTML = `
    <div class="display">
      <div class="display-top">
        <img src="assets/logo.png" alt="HACK4SDG" class="display-logo">
        <div class="display-tools"><button class="btn sm" id="fs">⛶ Full screen</button><a class="btn sm" href="#/selfcheckin/${cp.id}">Exit</a></div>
      </div>
      <div class="display-grid">
        <div class="display-qr">
          <div class="qr-frame" id="qr"></div>
          <div class="qr-timer"><div class="qr-timer-bar" id="qbar"></div></div>
          <p class="small muted" style="text-align:center;margin:8px 0 0">New code in <b id="qleft">10:00</b> · changes every 10 minutes</p>
        </div>
        <div class="display-info">
          <span class="badge info">${esc(cp.name)}</span>
          <h1 class="display-title">Scan to mark your attendance</h1>
          <ol class="display-steps"><li>Open your phone camera and scan the code</li><li>Pick your <b>team</b> and type your <b>name</b></li><li>Tap <b>Mark me present</b> – done!</li></ol>
          <div class="display-count"><span id="dc">0</span><small>/ ${total} present</small></div>
          <div class="progress" style="height:14px"><div id="dbar"></div></div>
          <h3 style="margin-top:22px">Just marked present</h3>
          <div id="recent" class="display-recent"></div>
        </div>
      </div>
    </div>`;

  const drawQr = async () => {
    const code = await selfCode(cp.self_secret);
    $("#qr") && ($("#qr").innerHTML = qrSvg(selfUrl(cp, code)));
  };
  const tickBar = () => {
    const left = QR_WINDOW - (Math.floor(Date.now() / 1000) % QR_WINDOW);
    const bar = $("#qbar");
    if (bar) bar.style.width = `${(left / QR_WINDOW) * 100}%`;
    const t = $("#qleft");
    if (t) t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    if (left === QR_WINDOW) drawQr();
  };
  const stats = async () => {
    const [{ count }, rows] = await Promise.all([
      sb.from("scans").select("id", { count: "exact", head: true }).eq("checkpoint_id", cp.id),
      sb.from("scans").select("scanned_at,participants(name,teams(name))").eq("checkpoint_id", cp.id).order("scanned_at", { ascending: false }).limit(6).then(must),
    ]);
    if (!$("#dc")) return;
    $("#dc").textContent = count ?? 0;
    $("#dbar").style.width = `${total ? ((count ?? 0) / total) * 100 : 0}%`;
    $("#recent").innerHTML = rows.map((r) => `<div class="arrival"><b>${esc((r.participants?.name || "").split(" ")[0])}</b>
      <span>${esc(r.participants?.teams?.name || "")}</span><time>${fmtTime(r.scanned_at).split(", ").pop()}</time></div>`).join("") || '<p class="muted">Waiting for the first person…</p>';
  };
  await drawQr();
  tickBar();
  stats();
  pageTimer(tickBar, 1000);
  pageTimer(stats, 8000);
  $("#fs").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
}

// One click: a new scan checkpoint used as an attendance sheet, with the attendance QR already on.
function newAttendanceSheet() {
  const hh = new Date().getHours();
  const guess = hh < 12 ? "Morning attendance" : hh < 17 ? "Mid-day attendance" : "Evening attendance";
  modal(`<h2>New attendance sheet</h2>
    <form id="nas"><div class="field"><label>Name</label><input name="name" required value="${guess}"></div>
      <p class="small muted">Creates a separate attendance list (it doesn't touch check-in) and turns the attendance QR on.</p>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Create &amp; open</button></div></form>`, (m, close) => {
    $("input", m).select();
    $("#nas", m).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const row = must(await sb.from("checkpoints").insert({ name: new FormData(e.target).get("name").trim(), type: "scan", self_checkin: true, active: true, sort_order: 50 }).select().single());
        close();
        toast("Attendance sheet created", "ok");
        location.hash = `#/selfcheckin/${row.id}`;
      } catch (er) { toast(er.message, "bad"); }
    };
  });
}

async function viewSelfCheckin(main, cpId) {
  const isAdmin = state.me.role === "admin";
  const cps = (await getCheckpoints()).filter((c) => c.type === "scan");
  if (!cps.length) {
    main.innerHTML = `<h1>Attendance QR</h1><div class="card empty">No attendance sheets yet.
      ${isAdmin ? '<br><br><button class="btn primary" id="new-sheet">+ New attendance sheet</button>' : " Ask an admin to create one."}</div>`;
    const ns = $("#new-sheet");
    if (ns) ns.onclick = () => newAttendanceSheet();
    return;
  }
  const cp = cps.find((c) => c.id === Number(cpId)) || cps.find((c) => c.self_checkin) || cps[0];
  const [log, people] = await Promise.all([
    sb.from("self_checkins").select("*").eq("checkpoint_id", cp.id).order("created_at", { ascending: false }).limit(300).then(must),
    sb.from("participants").select("id,name,team_id,teams(name,table_no)").order("name").then(must),
  ]);
  const pending = log.filter((r) => r.status === "unmatched");
  const label = { matched: ["ok", "Present"], already: ["", "Already marked"], unmatched: ["warn", "Needs review"], resolved: ["ok", "Confirmed"], dismissed: ["", "Dismissed"] };

  main.innerHTML = `
    <div class="page-head"><div><h1>Attendance QR</h1><p class="muted">Take attendance during the event: show a QR on the screen, participants scan it and enter their name and team. No volunteer scanning.</p></div>
      <div class="row"><select id="cp" style="width:auto;min-width:200px">${cps.map((c) => `<option value="${c.id}" ${c.id === cp.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
        ${isAdmin ? '<button class="btn" id="new-sheet">+ New attendance sheet</button>' : ""}</div></div>
    <div class="card assign-mode ${cp.self_checkin ? "on" : ""}">
      ${isAdmin ? `<label class="switch"><input type="checkbox" id="mode" ${cp.self_checkin ? "checked" : ""}><span class="slider"></span></label>` : ""}
      <div style="flex:1"><b>Attendance QR is ${cp.self_checkin ? "ON" : "OFF"} for ${esc(cp.name)}</b><br><span class="small muted">${cp.self_checkin
        ? "Open the display screen on a projector or TV. The QR changes every 10 minutes, so a photo shared outside the room stops working."
        : isAdmin ? "Switch on, then open the display screen." : "Ask an admin to switch it on."}${cp.active ? "" : " This sheet is closed, so nobody can mark attendance."}</span></div>
      ${cp.self_checkin ? `<a class="btn primary" href="#/display/${cp.id}" target="_blank" rel="noopener">Open display screen ↗</a>` : ""}
    </div>
    <div class="card"><h2>Needs review <span class="badge ${pending.length ? "warn" : "ok"}">${pending.length}</span></h2>
      <p class="small muted" style="margin-top:0">Names we couldn't match to the registration list (typos, nicknames, wrong team). Pick the right person to mark them present.</p>
      <div id="review">${pending.length ? pending.map((r) => {
        const sameTeam = r.team_id ? people.filter((p) => p.team_id === r.team_id) : [];
        return `<div class="review-row" data-id="${r.id}">
          <div class="review-typed"><b>${esc(r.name_text)}</b><span class="small muted">typed team: ${esc(r.team_text)} · ${fmtTime(r.created_at)}</span></div>
          <select data-pick="${r.id}" class="grow">
            <option value="">Who is this?</option>
            ${sameTeam.length ? `<optgroup label="${esc(sameTeam[0].teams?.name)}">${sameTeam.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</optgroup>` : ""}
            <optgroup label="Everyone">${people.map((p) => `<option value="${p.id}">${esc(p.name)} – ${esc(p.teams?.name || "")}</option>`).join("")}</optgroup>
          </select>
          <button class="btn sm primary" data-ok="${r.id}">Mark present</button><button class="btn sm" data-dismiss="${r.id}">Dismiss</button>
        </div>`;
      }).join("") : '<div class="empty">Nothing to review 🎉</div>'}</div>
    </div>
    <div class="card"><h2>Recent entries</h2>
      ${log.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Typed name</th><th>Typed team</th><th>Matched to</th><th>Status</th></tr></thead><tbody>
      ${log.slice(0, 60).map((r) => {
        const p = people.find((x) => x.id === r.participant_id);
        const [cls, txt] = label[r.status] || ["", r.status];
        return `<tr><td class="small">${fmtTime(r.created_at)}</td><td>${esc(r.name_text)}</td><td>${esc(r.team_text)}</td>
          <td>${p ? `${esc(p.name)} <span class="small muted">· ${esc(p.teams?.name || "")}</span>` : "—"}</td><td><span class="badge ${cls}">${txt}</span></td></tr>`;
      }).join("")}</tbody></table></div>` : '<div class="empty">Nobody has marked attendance yet.</div>'}
    </div>`;

  $("#cp").onchange = (e) => (location.hash = `#/selfcheckin/${e.target.value}`);
  const ns = $("#new-sheet");
  if (ns) ns.onclick = () => newAttendanceSheet();
  const mode = $("#mode");
  if (mode) mode.onchange = async () => {
    try { must(await sb.from("checkpoints").update({ self_checkin: mode.checked }).eq("id", cp.id)); toast(mode.checked ? "Attendance QR on" : "Attendance QR off", "ok"); route(); }
    catch (er) { toast(er.message, "bad"); mode.checked = !mode.checked; }
  };
  $("#review").onclick = async (e) => {
    const ok = e.target.closest("[data-ok]"), dis = e.target.closest("[data-dismiss]");
    try {
      if (ok) {
        const pid = Number($(`[data-pick="${ok.dataset.ok}"]`).value);
        if (!pid) return toast("Pick who this is first", "bad");
        const r = must(await sb.rpc("resolve_self_checkin", { p_id: Number(ok.dataset.ok), p_participant: pid }));
        if (r.status !== "ok") throw new Error(r.message || "Could not confirm");
        toast(`${r.name} marked present`, "ok"); route();
      }
      if (dis) {
        must(await sb.from("self_checkins").update({ status: "dismissed" }).eq("id", Number(dis.dataset.dismiss)));
        toast("Dismissed"); route();
      }
    } catch (er) { toast(er.message, "bad"); }
  };
}

// ------------------------------------------------------------------ judging
// Which teams may the signed-in person judge in this round? (mirrors public.can_judge in the database)
async function judgeScope(cp) {
  await loadSettings();
  const on = state.settings.assign_mentors === "on";
  const rows = on ? must(await sb.from("judge_assignments").select("team_id,judge_email").eq("checkpoint_id", cp.id)) : [];
  const restricted = on && state.me.role === "mentor";
  const allowed = restricted ? new Set(rows.filter((r) => r.judge_email === state.me.email).map((r) => r.team_id)) : null;
  return { on, rows, restricted, allowed };
}

async function viewJudge(main, cpId, teamId) {
  const cps = (await getCheckpoints()).filter((c) => c.type === "judging" && c.active);
  if (!cps.length) {
    main.innerHTML = `<h1>Judging</h1><div class="card empty">No judging rounds are open.${state.me.role === "admin" ? ' <a href="#/checkpoints">Create one</a>.' : " Ask an admin to open one."}</div>`;
    return;
  }
  const cp = pickCheckpoint(cps, cpId);
  const scope = await judgeScope(cp);
  if (teamId) return judgeTeam(main, cp, Number(teamId), scope);

  const [allTeams, mine, staff, judged] = await Promise.all([
    sb.from("teams").select("id,name,table_no,college,participants(count)").then(must),
    sb.from("scores").select("team_id,total").eq("checkpoint_id", cp.id).eq("judge_id", state.user.id).then(must),
    scope.on && state.me.role === "admin" ? sb.from("staff").select("email,name").then(must) : [],
    sb.rpc("judged_teams", { p_checkpoint: cp.id }).then(must),
  ]);
  // other judges who already scored each team in this round (names only)
  const othersOf = new Map((judged || []).map((j) => [j.team_id, (j.judges || []).filter((x) => x.id !== state.user.id).map((x) => x.name)]));
  const others = (id) => othersOf.get(id) || [];
  const teams = (scope.restricted ? allTeams.filter((t) => scope.allowed.has(t.id)) : allTeams).sort(byTable);
  const scored = new Map(mine.map((s) => [s.team_id, s.total]));
  const max = cp.criteria.reduce((n, c) => n + Number(c.max), 0);
  const names = new Map(staff.map((s) => [s.email, s.name]));
  const judgesOf = (id) => scope.rows.filter((r) => r.team_id === id).map((r) => names.get(r.judge_email) || r.judge_email);
  const doneCount = teams.filter((t) => scored.has(t.id)).length;

  main.innerHTML = `
    <div class="page-head"><div><h1>Judging</h1>
      <p class="muted">${esc(cp.name)} · you've graded <b>${doneCount}</b> of ${teams.length} ${scope.restricted ? "teams assigned to you" : "teams"}</p></div>
      <div class="row"><select id="cp" style="width:auto;min-width:200px">${cps.map((c) => cpOption(c, cp)).join("")}</select>
        ${state.me.role === "admin" ? `<a class="btn" href="#/assign/${cp.id}">Assign judges</a>` : ""}</div></div>
    ${scope.restricted ? `<div class="notice info">You can judge the <b>${teams.length}</b> team${teams.length === 1 ? "" : "s"} assigned to you in this round. Go to the table number shown on each card.</div>` : ""}
    ${scope.restricted && !teams.length ? `<div class="card empty">No teams are assigned to you in ${esc(cp.name)} yet. Ask an admin.</div>` : `
    <div class="scan-layout ${scope.restricted ? "list-first" : ""}">
      <div class="card"><h3>Scan any team member's QR</h3><div id="reader"></div>
        <div class="row" style="margin-top:10px"><button class="btn" id="cam">Start camera</button><span class="small muted" id="cam-st"></span></div></div>
      <div class="card"><div class="row" style="margin-bottom:10px"><h3 style="margin:0;flex:1">${scope.restricted ? "Your teams" : "Or pick a team"}</h3>
        <select id="show" style="width:auto"><option value="">All</option><option value="todo">Not judged by me</option><option value="nobody">Not judged by anyone</option><option value="done">Judged by me</option></select>
        <input id="q" placeholder="Table or team…" style="max-width:170px"></div>
        <div class="judge-grid" id="tp"></div></div>
    </div>`}`;
  if (!$("#tp")) { $("#cp").onchange = (e) => (location.hash = `#/judge/${e.target.value}`); return; }
  const draw = () => {
    const q = $("#q").value.trim().toLowerCase(), show = $("#show").value;
    $("#tp").innerHTML = teams
      .filter((t) => `${t.table_no || ""} ${t.name} ${t.college || ""}`.toLowerCase().includes(q))
      .filter((t) => !show || (show === "nobody" ? !scored.has(t.id) && !others(t.id).length : (show === "done") === scored.has(t.id)))
      .map((t) => {
        const js = scope.on && state.me.role === "admin" ? judgesOf(t.id) : [];
        return `<button class="judge-card ${scored.has(t.id) ? "is-done" : ""}" data-t="${t.id}">
          <span class="tno ${!scored.has(t.id) && others(t.id).length ? "by-other" : ""}">${t.table_no ? `<small>Table</small>${esc(t.table_no)}` : "<small>Table</small>—"}</span>
          <span class="jt"><b>${esc(t.name)}</b><span class="small muted">${t.college ? esc(t.college) + " · " : ""}${t.participants[0]?.count ?? 0} members</span>
            ${js.length ? `<span class="small muted">Judges: ${js.map(esc).join(", ")}</span>` : scope.on && state.me.role === "admin" ? '<span class="small" style="color:var(--warn)">No judge assigned</span>' : ""}
            ${others(t.id).length ? `<span class="small already">✓ Judged by ${esc(others(t.id).join(", "))}</span>` : ""}</span>
          ${scored.has(t.id) ? `<span class="badge ok">${scored.get(t.id)}/${max}</span>`
            : others(t.id).length ? `<span class="badge warn" title="Already judged by ${esc(others(t.id).join(", "))}">Already judged</span>` : '<span class="badge">To judge</span>'}</button>`;
      }).join("") || '<div class="empty">No matching teams</div>';
  };
  draw();
  $("#q").oninput = draw;
  $("#show").onchange = draw;
  $("#tp").onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) location.hash = `#/judge/${cp.id}/${b.dataset.t}`; };
  $("#cp").onchange = (e) => (location.hash = `#/judge/${e.target.value}`);
  $("#cam").onclick = async () => {
    if (state.scanner) { await stopScanner(); $("#cam").textContent = "Start camera"; return; }
    try {
      await startScanner(async (code) => {
        const tok = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const { data } = await sb.from("participants").select("team_id").eq("token", tok).maybeSingle();
        if (!data) { beep(false); toast("QR not recognised", "bad"); return; }
        if (scope.restricted && !scope.allowed.has(data.team_id)) { beep(false); toast("This team isn't assigned to you in this round", "bad"); return; }
        beep(true);
        location.hash = `#/judge/${cp.id}/${data.team_id}`;
      });
      $("#cam").textContent = "Stop camera";
    } catch (e) { $("#cam-st").textContent = `Camera unavailable: ${e?.message || e}`; }
  };
}

async function judgeTeam(main, cp, teamId, scope) {
  if (scope.restricted && !scope.allowed.has(teamId)) {
    main.innerHTML = `<div class="page-head"><div><a href="#/judge/${cp.id}" class="small">← Your teams</a><h1>Not your team</h1></div></div>
      <div class="card empty">This team isn't assigned to you in ${esc(cp.name)}. Ask an admin if that's wrong.</div>`;
    return;
  }
  const [team, existing, judged] = await Promise.all([
    sb.from("teams").select("id,name,college,table_no,participants(name,is_leader)").eq("id", teamId).single().then(must),
    sb.from("scores").select("*").eq("checkpoint_id", cp.id).eq("team_id", teamId).eq("judge_id", state.user.id).maybeSingle().then(must),
    sb.rpc("judged_teams", { p_checkpoint: cp.id }).then(must),
  ]);
  const otherJudges = ((judged || []).find((j) => j.team_id === teamId)?.judges || []).filter((x) => x.id !== state.user.id).map((x) => x.name);
  const vals = existing?.scores || {};
  const max = cp.criteria.reduce((n, c) => n + Number(c.max), 0);
  main.innerHTML = `
    <div class="page-head"><div><a href="#/judge/${cp.id}" class="small">← All teams</a>
      <h1>${team.table_no ? `<span class="h-tno">Table ${esc(team.table_no)}</span> ` : ""}${esc(team.name)}</h1>
      <p class="muted">${esc(cp.name)}${team.college ? " · " + esc(team.college) : ""} · ${team.participants.map((p) => esc(p.name) + (p.is_leader ? " (lead)" : "")).join(", ")}</p></div></div>
    ${otherJudges.length ? `<div class="notice" style="max-width:640px"><b>Already judged</b> in ${esc(cp.name)} by ${esc(otherJudges.join(", "))}.
      ${existing ? "" : "You can still add your own score – the leaderboard averages all judges."}</div>` : ""}
    <form class="card" id="sf" style="max-width:640px">
      ${cp.criteria.map((c, i) => `<div class="crit"><div><label>${esc(c.name)} <span class="muted">/ ${c.max}</span></label>
        ${c.desc ? `<p class="crit-desc">${esc(c.desc)}</p>` : ""}
        <input type="range" min="0" max="${c.max}" step="0.5" value="${vals[c.name] ?? 0}" data-i="${i}"></div>
        <input type="number" min="0" max="${c.max}" step="0.5" value="${vals[c.name] ?? 0}" data-n="${i}"></div>`).join("")}
      <div class="row" style="justify-content:space-between;margin:14px 0"><b>Total</b><span style="font-size:1.4rem;font-weight:700"><span id="tot">0</span> / ${max}</span></div>
      <div class="field"><label>Comments / feedback</label><textarea name="comments">${esc(existing?.comments)}</textarea></div>
      <div class="row"><button class="btn primary lg">${existing ? "Update score" : "Submit score"}</button>
        ${existing ? `<span class="small muted">Last saved ${fmtTime(existing.updated_at)}</span>` : ""}</div>
    </form>`;
  const sync = () => {
    let t = 0;
    cp.criteria.forEach((c, i) => (t += Number($(`[data-n="${i}"]`).value) || 0));
    $("#tot").textContent = Math.round(t * 10) / 10;
  };
  $$("[data-i]").forEach((r) => (r.oninput = () => { $(`[data-n="${r.dataset.i}"]`).value = r.value; sync(); }));
  $$("[data-n]").forEach((n) => (n.oninput = () => {
    const c = cp.criteria[n.dataset.n];
    if (Number(n.value) > c.max) n.value = c.max;
    $(`[data-i="${n.dataset.n}"]`).value = n.value; sync();
  }));
  sync();
  $("#sf").onsubmit = async (e) => {
    e.preventDefault();
    const scores = {};
    let total = 0;
    cp.criteria.forEach((c, i) => { const v = Math.min(Number($(`[data-n="${i}"]`).value) || 0, c.max); scores[c.name] = v; total += v; });
    try {
      must(await sb.from("scores").upsert({
        checkpoint_id: cp.id, team_id: teamId, judge_id: state.user.id, judge_name: state.me.name,
        scores, total, comments: new FormData(e.target).get("comments").trim() || null, updated_at: new Date().toISOString(),
      }, { onConflict: "checkpoint_id,team_id,judge_id" }));
      toast(`Saved ${team.name}: ${total}/${max}`, "ok");
      location.hash = `#/judge/${cp.id}`;
    } catch (er) {
      toast(/row-level security/i.test(er.message) ? "You can't score this team in this round (not assigned, or the round is closed)" : er.message, "bad");
    }
  };
}

// ------------------------------------------------------------------ judge assignments (admin)
async function setAssignMode(on) {
  must(await sb.from("settings").upsert({ key: "assign_mentors", value: on ? "on" : "off" }));
  state.settings.assign_mentors = on ? "on" : "off";
}

async function viewAssign(main, cpId) {
  await loadSettings();
  const cps = (await getCheckpoints()).filter((c) => c.type === "judging");
  if (!cps.length) {
    main.innerHTML = `<h1>Assign judges</h1><div class="card empty">No judging rounds yet. <a href="#/checkpoints">Create a judging checkpoint</a> first.</div>`;
    return;
  }
  const cp = cps.find((c) => c.id === Number(cpId)) || cps[0];
  const [teams, mentors, all] = await Promise.all([
    sb.from("teams").select("id,name,table_no,college").then(must),
    sb.from("staff").select("email,name").eq("role", "mentor").order("name").then(must),
    sb.from("judge_assignments").select("id,checkpoint_id,team_id,judge_email").then(must),
  ]);
  teams.sort(byTable);
  let here = all.filter((r) => r.checkpoint_id === cp.id);
  const on = state.settings.assign_mentors === "on";
  const nameOf = (e) => mentors.find((m) => m.email === e)?.name || e;
  const others = cps.filter((c) => c.id !== cp.id && all.some((r) => r.checkpoint_id === c.id));
  let tab = sessionStorage.getItem("assign-tab") === "mentor" ? "mentor" : "team";
  let mentor = mentors[0]?.email || "";

  main.innerHTML = `
    <div class="page-head"><div><h1>Assign judges</h1><p class="muted">Choose which mentors judge which teams – separately for each judging round.</p></div>
      <select id="cp" style="width:auto;min-width:200px">${cps.map((c) => `<option value="${c.id}" ${c.id === cp.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    <div class="card assign-mode ${on ? "on" : ""}">
      <label class="switch"><input type="checkbox" id="mode" ${on ? "checked" : ""}><span class="slider"></span></label>
      <div><b>${on ? "Assignments are ON" : "Assignments are OFF"}</b><br><span class="small muted">${on
        ? "Mentors can only judge the teams assigned to them in each round. Teams with no judge can only be scored by admins."
        : "Any mentor can judge any team. Assignments below are saved but not enforced until you switch this on."}</span></div>
    </div>
    ${!mentors.length ? `<div class="notice">No mentors yet – add people with the Mentor role under <a href="#/staff">Staff</a>.</div>` : ""}
    <div class="card">
      <div class="row" style="margin-bottom:12px">
        <h2 style="margin:0;flex:1">Assign manually <span class="muted small" id="summary"></span></h2>
        <div class="seg" role="tablist"><button type="button" data-tab="team">By team</button><button type="button" data-tab="mentor">By mentor</button></div>
      </div>
      <div class="chips" id="load" style="margin-bottom:12px"></div>
      <div id="pane"></div>
    </div>
    <details class="card" id="auto-box">
      <summary><h2 style="display:inline">Auto-assign <span class="muted small">(optional)</span></h2></summary>
      <div class="grid two" style="margin-top:14px">
        <form id="auto">
          <div class="field"><label>Mentors to use</label><div class="chips">${mentors.map((m) =>
            `<label class="chip"><input type="checkbox" name="m" value="${esc(m.email)}" checked><span>${esc(m.name)}</span></label>`).join("")}</div></div>
          <div class="row"><div class="grow"><label>Judges per team</label><input type="number" name="k" min="1" max="${Math.max(1, mentors.length)}" value="${Math.min(2, Math.max(1, mentors.length))}"></div>
            <label class="check" style="margin-top:20px"><input type="checkbox" name="only" checked> Only teams with no judge yet</label></div>
          <p class="small muted">Shares teams out in table order so each mentor gets about the same number. You can still change any team by hand afterwards.</p>
          <button class="btn primary" ${mentors.length ? "" : "disabled"}>Distribute</button>
        </form>
        <div>
          ${others.length ? `<label>Copy from another round</label><div class="row" style="margin-bottom:12px"><select id="copy-from" class="grow">${others.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
            <button class="btn" id="copy">Copy here</button></div>` : '<p class="small muted">Once another round has assignments you can copy them into this one.</p>'}
          <button class="btn danger" id="clear" ${here.length ? "" : "disabled"}>Clear all assignments in ${esc(cp.name)}</button>
        </div>
      </div>
    </details>`;

  const byTeam = () => {
    const m = new Map();
    here.forEach((r) => m.set(r.team_id, [...(m.get(r.team_id) || []), r]));
    return m;
  };
  const addOne = async (teamId, email) => {
    const row = must(await sb.from("judge_assignments").insert({ checkpoint_id: cp.id, team_id: teamId, judge_email: email }).select().single());
    here.push(row);
  };
  const removeOne = async (id) => {
    must(await sb.from("judge_assignments").delete().eq("id", id));
    here = here.filter((r) => r.id !== id);
  };

  const drawTeamTab = (filter) => {
    const map = byTeam();
    return `<div class="row" style="margin-bottom:10px"><input id="q" class="grow" placeholder="Table or team…" value="${esc(filter.q)}">
        <select id="show" style="width:auto"><option value="">All teams</option><option value="none" ${filter.show === "none" ? "selected" : ""}>No judge yet</option></select></div>
      <div class="table-wrap"><table><thead><tr><th>Table</th><th>Team</th><th>Judges in ${esc(cp.name)}</th><th>Add judge</th></tr></thead><tbody>
      ${teams.filter((t) => `${t.table_no || ""} ${t.name} ${t.college || ""}`.toLowerCase().includes(filter.q.toLowerCase()))
        .filter((t) => filter.show !== "none" || !map.has(t.id))
        .map((t) => {
          const rs = map.get(t.id) || [];
          const free = mentors.filter((m) => !rs.some((r) => r.judge_email === m.email));
          return `<tr><td><b>${esc(t.table_no || "—")}</b></td><td><b>${esc(t.name)}</b>${t.college ? `<br><span class="small muted">${esc(t.college)}</span>` : ""}</td>
            <td><div class="chips">${rs.map((r) => `<span class="chip static">${esc(nameOf(r.judge_email))}<button type="button" data-del="${r.id}" title="Remove">×</button></span>`).join("")
              || '<span class="small" style="color:var(--warn)">No judge</span>'}</div></td>
            <td>${free.length ? `<select data-add="${t.id}" style="width:auto;min-width:150px"><option value="">Choose mentor…</option>${free.map((m) => `<option value="${esc(m.email)}">${esc(m.name)}</option>`).join("")}</select>` : '<span class="small muted">All mentors added</span>'}</td></tr>`;
        }).join("") || '<tr><td colspan="4" class="empty">No matching teams</td></tr>'}
      </tbody></table></div>`;
  };
  const drawMentorTab = (filter) => {
    if (!mentors.length) return '<div class="empty">No mentors yet.</div>';
    const mine = new Set(here.filter((r) => r.judge_email === mentor).map((r) => r.team_id));
    const shown = teams.filter((t) => `${t.table_no || ""} ${t.name} ${t.college || ""}`.toLowerCase().includes(filter.q.toLowerCase()));
    return `<div class="row" style="margin-bottom:10px">
        <select id="mentor" style="width:auto;min-width:200px">${mentors.map((m) => `<option value="${esc(m.email)}" ${m.email === mentor ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>
        <input id="q" class="grow" placeholder="Table or team…" value="${esc(filter.q)}">
        <button type="button" class="btn sm" id="all-on">Tick all shown</button><button type="button" class="btn sm" id="all-off">Untick all shown</button></div>
      <p class="small muted" style="margin-top:0"><b>${esc(nameOf(mentor))}</b> judges <b>${mine.size}</b> team${mine.size === 1 ? "" : "s"} in ${esc(cp.name)}. Tick or untick teams – changes save straight away.</p>
      <div class="pick-grid">${shown.map((t) => {
        const co = (byTeam().get(t.id) || []).filter((r) => r.judge_email !== mentor).map((r) => nameOf(r.judge_email));
        return `<label class="pick ${mine.has(t.id) ? "on" : ""}"><input type="checkbox" data-pick="${t.id}" ${mine.has(t.id) ? "checked" : ""}>
          <span class="tno-s">${esc(t.table_no || "—")}</span><span class="pick-t"><b>${esc(t.name)}</b>
          <span class="small muted">${co.length ? `also: ${co.map(esc).join(", ")}` : "no other judge"}</span></span></label>`;
      }).join("") || '<div class="empty">No matching teams</div>'}</div>`;
  };

  const filter = { q: "", show: "" };
  const draw = () => {
    const map = byTeam();
    const none = teams.filter((t) => !map.has(t.id)).length;
    $("#summary").textContent = `· ${teams.length - none} of ${teams.length} teams have a judge`;
    const load = new Map(mentors.map((m) => [m.email, 0]));
    here.forEach((r) => load.set(r.judge_email, (load.get(r.judge_email) || 0) + 1));
    $("#load").innerHTML = mentors.map((m) => `<span class="chip static"><span>${esc(m.name)}</span><b>${load.get(m.email)}</b></span>`).join("");
    $$(".seg [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    const focused = document.activeElement?.id === "q";
    $("#pane").innerHTML = tab === "team" ? drawTeamTab(filter) : drawMentorTab(filter);
    if (focused) { const q = $("#q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  };
  draw();

  $(".seg").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    tab = b.dataset.tab;
    try { sessionStorage.setItem("assign-tab", tab); } catch { /* storage unavailable */ }
    draw();
  };
  $("#pane").oninput = (e) => { if (e.target.id === "q") { filter.q = e.target.value; draw(); } };
  $("#pane").onchange = async (e) => {
    const t = e.target;
    try {
      if (t.id === "show") { filter.show = t.value; draw(); return; }
      if (t.id === "mentor") { mentor = t.value; draw(); return; }
      if (t.dataset.add && t.value) { await addOne(Number(t.dataset.add), t.value); draw(); return; }
      if (t.dataset.pick) {
        const teamId = Number(t.dataset.pick);
        if (t.checked) await addOne(teamId, mentor);
        else { const r = here.find((x) => x.team_id === teamId && x.judge_email === mentor); if (r) await removeOne(r.id); }
        draw();
      }
    } catch (er) { toast(er.message, "bad"); draw(); }
  };
  $("#pane").onclick = async (e) => {
    const del = e.target.closest("[data-del]");
    const bulk = e.target.closest("#all-on, #all-off");
    try {
      if (del) { await removeOne(Number(del.dataset.del)); draw(); }
      if (bulk) {
        const boxes = $$("[data-pick]", $("#pane"));
        const want = bulk.id === "all-on";
        const changes = boxes.filter((b) => b.checked !== want).map((b) => Number(b.dataset.pick));
        if (!changes.length) return;
        if (want) {
          const rows = must(await sb.from("judge_assignments").insert(changes.map((id) => ({ checkpoint_id: cp.id, team_id: id, judge_email: mentor }))).select());
          here.push(...rows);
        } else {
          const ids = here.filter((r) => r.judge_email === mentor && changes.includes(r.team_id)).map((r) => r.id);
          must(await sb.from("judge_assignments").delete().in("id", ids));
          here = here.filter((r) => !ids.includes(r.id));
        }
        draw();
      }
    } catch (er) { toast(er.message, "bad"); draw(); }
  };

  $("#cp").onchange = (e) => (location.hash = `#/assign/${e.target.value}`);
  $("#mode").onchange = async (e) => {
    try { await setAssignMode(e.target.checked); toast(e.target.checked ? "Assignments switched on" : "Assignments switched off", "ok"); route(); }
    catch (er) { toast(er.message, "bad"); e.target.checked = !e.target.checked; }
  };
  const replaceRound = async (rows, keepExisting) => {
    if (!keepExisting) must(await sb.from("judge_assignments").delete().eq("checkpoint_id", cp.id));
    for (let i = 0; i < rows.length; i += 200) must(await sb.from("judge_assignments").insert(rows.slice(i, i + 200)));
  };
  $("#auto").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const pool = f.getAll("m");
    const k = Math.min(Number(f.get("k")) || 1, pool.length);
    const only = f.get("only") === "on";
    if (!pool.length) return toast("Pick at least one mentor", "bad");
    const map = byTeam();
    const targets = teams.filter((t) => !only || !map.has(t.id));
    if (!targets.length) return toast("Every team already has a judge", "bad");
    if (!only && here.length && !(await confirmBox(`Replace all ${here.length} existing assignments in <b>${esc(cp.name)}</b>?`, "Replace", true))) return;
    // least-loaded first; ties go round-robin so neighbouring tables share mentors
    const load = new Map(pool.map((m) => [m, 0]));
    if (only) here.forEach((r) => load.has(r.judge_email) && load.set(r.judge_email, load.get(r.judge_email) + 1));
    let turn = 0;
    const rows = [];
    for (const t of targets) {
      const order = pool.map((m, i) => ({ m, l: load.get(m), r: (i - turn + pool.length) % pool.length })).sort((a, b) => a.l - b.l || a.r - b.r);
      order.slice(0, k).forEach(({ m }) => { rows.push({ checkpoint_id: cp.id, team_id: t.id, judge_email: m }); load.set(m, load.get(m) + 1); });
      turn = (turn + k) % pool.length;
    }
    const btn = $("button.primary", e.target);
    btn.disabled = true;
    try { await replaceRound(rows, only); toast(`Assigned ${targets.length} teams (${rows.length} assignments)`, "ok"); route(); }
    catch (er) { toast(er.message, "bad"); btn.disabled = false; }
  };
  const copy = $("#copy");
  if (copy) copy.onclick = async () => {
    const from = Number($("#copy-from").value);
    const src = all.filter((r) => r.checkpoint_id === from);
    if (!(await confirmBox(`Copy ${src.length} assignments into <b>${esc(cp.name)}</b>? ${here.length ? "Existing ones in this round are replaced." : ""}`, "Copy"))) return;
    try { await replaceRound(src.map((r) => ({ checkpoint_id: cp.id, team_id: r.team_id, judge_email: r.judge_email })), false); toast("Copied", "ok"); route(); }
    catch (er) { toast(er.message, "bad"); }
  };
  $("#clear").onclick = async () => {
    if (!(await confirmBox(`Remove all ${here.length} assignments in <b>${esc(cp.name)}</b>?`, "Clear", true))) return;
    try { must(await sb.from("judge_assignments").delete().eq("checkpoint_id", cp.id)); toast("Cleared"); route(); }
    catch (er) { toast(er.message, "bad"); }
  };
}

// ------------------------------------------------------------------ leaderboard (combine judging rounds)
// A team's score in a round = average of its judges' totals. Rounds are then combined:
//  avg: weighted average of each round's percentage (score / round max), scaled to `scale`
//  sum: weighted sum of round scores divided by the weighted sum of round maxima, scaled to `scale`
// Rounds a team wasn't judged in count as 0, or (missing: "skip") are left out of that team's calculation.
function computeLeaderboard(teams, rounds, scores, cfg) {
  const used = rounds.filter((r) => cfg.rounds.includes(r.id));
  const roundMax = (r) => r.criteria.reduce((n, c) => n + Number(c.max || 0), 0) || 1;
  const w = (r) => Math.max(0, Number(cfg.weights[r.id] ?? 1));
  const rows = teams.map((t) => {
    const per = used.map((r) => {
      const s = scores.filter((x) => x.checkpoint_id === r.id && x.team_id === t.id);
      const avg = s.length ? s.reduce((n, x) => n + Number(x.total), 0) / s.length : null;
      return { round: r, avg, judges: s.length, max: roundMax(r), judgeNames: s.map((x) => x.judge_name || "Judge") };
    });
    const counted = per.filter((p) => w(p.round) > 0 && (p.avg != null || cfg.missing === "zero"));
    let score = null;
    if (counted.length && per.some((p) => p.avg != null)) {
      if (cfg.mode === "sum") {
        const got = counted.reduce((n, p) => n + w(p.round) * (p.avg ?? 0), 0);
        const best = counted.reduce((n, p) => n + w(p.round) * p.max, 0);
        score = best ? (got / best) * cfg.scale : 0;
      } else {
        const tw = counted.reduce((n, p) => n + w(p.round), 0);
        score = tw ? (counted.reduce((n, p) => n + w(p.round) * ((p.avg ?? 0) / p.max), 0) / tw) * cfg.scale : 0;
      }
    }
    return { t, per, score, judged: per.filter((p) => p.avg != null).length };
  });
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.judged - a.judged || a.t.name.localeCompare(b.t.name));
  // standard competition ranking: equal scores share a rank (1, 2, 2, 4)
  let prev = null, rank = 0;
  rows.forEach((r, i) => {
    if (r.score == null) { r.rank = null; return; }
    const key = r.score.toFixed(4);
    if (key !== prev) { rank = i + 1; prev = key; }
    r.rank = rank;
  });
  return { rows, used };
}

const LB_DEFAULT = { rounds: null, weights: {}, mode: "avg", scale: 100, missing: "zero" };

async function viewLeaderboard(main) {
  await loadSettings();
  const rounds = (await getCheckpoints()).filter((c) => c.type === "judging");
  if (!rounds.length) {
    main.innerHTML = `<h1>Leaderboard</h1><div class="card empty">No judging rounds yet. <a href="#/checkpoints">Create a judging checkpoint</a> first.</div>`;
    return;
  }
  const [teams, scoreLists] = await Promise.all([
    sb.from("teams").select("id,name,table_no,college").order("name").then(must),
    Promise.all(rounds.map((r) => sb.from("scores").select("checkpoint_id,team_id,total,judge_name").eq("checkpoint_id", r.id).then(must))),
  ]);
  const scores = scoreLists.flat();
  let saved = {};
  try { saved = JSON.parse(state.settings.leaderboard_config || "{}"); } catch { /* ignore bad JSON */ }
  const cfg = { ...LB_DEFAULT, ...saved, weights: { ...(saved.weights || {}) } };
  cfg.rounds = (cfg.rounds || rounds.map((r) => r.id)).filter((id) => rounds.some((r) => r.id === id));
  if (!cfg.rounds.length) cfg.rounds = rounds.map((r) => r.id);
  const maxOf = (r) => r.criteria.reduce((n, c) => n + Number(c.max || 0), 0);
  const fmt = (n, d = 2) => (n == null ? "—" : Number(n).toFixed(d).replace(/\.?0+$/, "") || "0");

  main.innerHTML = `
    <div class="page-head"><div><h1>Leaderboard</h1><p class="muted">Choose which judging rounds count and how they're combined. The ranking updates as you change the options.</p></div>
      <div class="row"><button class="btn" id="lb-save">Save as default</button><button class="btn primary" id="lb-xl">⬇ Excel</button></div></div>
    <div class="lb-layout">
      <form class="card lb-opts" id="lb-form">
        <h2>1 · Rounds to include</h2>
        <div class="lb-rounds">${rounds.map((r) => `
          <div class="lb-round">
            <label class="check" style="margin:0;flex:1"><input type="checkbox" name="round" value="${r.id}" ${cfg.rounds.includes(r.id) ? "checked" : ""}>
              <span><b>${esc(r.name)}</b><br><span class="small muted">out of ${maxOf(r)} · ${new Set(scores.filter((s) => s.checkpoint_id === r.id).map((s) => s.team_id)).size} teams judged</span></span></label>
            <label class="lb-weight" title="How much this round counts compared with the others">Weight
              <input type="number" name="w-${r.id}" min="0" step="0.5" value="${cfg.weights[r.id] ?? 1}"></label>
          </div>`).join("")}</div>
        <h2 style="margin-top:18px">2 · Combine rounds by</h2>
        <label class="lb-mode"><input type="radio" name="mode" value="avg" ${cfg.mode !== "sum" ? "checked" : ""}>
          <span><b>Average</b><br><span class="small muted">Each round becomes a percentage of its own maximum, then the percentages are averaged (using the weights). Every round counts equally, whatever its maximum score.</span></span></label>
        <label class="lb-mode"><input type="radio" name="mode" value="sum" ${cfg.mode === "sum" ? "checked" : ""}>
          <span><b>Sum, scaled down</b><br><span class="small muted">Round scores are added up (× weight), then scaled so the best possible total equals the number below. Rounds with more marks count for more.</span></span></label>
        <div class="row" style="margin-top:8px"><label style="margin:0">Final score out of</label>
          <input type="number" name="scale" min="1" step="1" value="${cfg.scale}" style="width:110px"></div>
        <h2 style="margin-top:18px">3 · Team missed a round?</h2>
        <label class="check"><input type="radio" name="missing" value="zero" ${cfg.missing !== "skip" ? "checked" : ""}> <span>Count it as <b>0</b> for that round</span></label>
        <label class="check"><input type="radio" name="missing" value="skip" ${cfg.missing === "skip" ? "checked" : ""}> <span><b>Leave it out</b> – use only the rounds the team was judged in</span></label>
        <p class="small muted" style="margin-bottom:0">Within a round, a team's score is always the average of its judges' totals.</p>
      </form>
      <div class="lb-main">
        <div class="card pub-card" id="pub"></div>
        <div id="lb-podium" class="podium"></div>
        <div class="card"><div class="row" style="margin-bottom:8px"><h2 style="margin:0;flex:1" id="lb-title"></h2>
          <input id="lb-q" placeholder="Find a team…" style="max-width:200px"></div>
          <div id="lb-table"></div></div>
      </div>
    </div>`;

  const form = $("#lb-form");
  const readCfg = () => {
    const f = new FormData(form);
    cfg.rounds = f.getAll("round").map(Number);
    rounds.forEach((r) => { cfg.weights[r.id] = Number(f.get(`w-${r.id}`)) || 0; });
    cfg.mode = f.get("mode");
    cfg.scale = Math.max(1, Number(f.get("scale")) || 100);
    cfg.missing = f.get("missing");
  };
  let current;
  const draw = () => {
    readCfg();
    current = computeLeaderboard(teams, rounds, scores, cfg);
    const { rows, used } = current;
    const ranked = rows.filter((r) => r.score != null);
    $("#lb-title").textContent = used.length
      ? `${ranked.length} ranked team${ranked.length === 1 ? "" : "s"} · ${cfg.mode === "sum" ? "sum" : "average"} of ${used.map((r) => r.name).join(" + ")}, out of ${cfg.scale}`
      : "Tick at least one round";
    const medals = ["🥇", "🥈", "🥉"];
    $("#lb-podium").innerHTML = ranked.slice(0, 3).map((r, i) => `
      <div class="pod pod-${i + 1}"><div class="pod-medal">${medals[r.rank - 1] || "🏅"}</div>
        <div class="pod-name">${esc(r.t.name)}</div><div class="small muted">${r.t.table_no ? `Table ${esc(r.t.table_no)}` : ""}${r.t.college ? ` · ${esc(r.t.college)}` : ""}</div>
        <div class="pod-score">${fmt(r.score)}<small>/ ${cfg.scale}</small></div></div>`).join("");
    const q = $("#lb-q").value.trim().toLowerCase();
    const list = rows.filter((r) => !q || `${r.t.name} ${r.t.table_no || ""} ${r.t.college || ""}`.toLowerCase().includes(q));
    $("#lb-table").innerHTML = !used.length ? '<div class="empty">Tick at least one round on the left.</div>' : `<div class="table-wrap"><table class="lb-table">
      <thead><tr><th>Rank</th><th>Team</th>${used.map((r) => `<th>${esc(r.name)}<br><span class="small muted" style="text-transform:none;letter-spacing:0">/ ${maxOf(r)}${Number(cfg.weights[r.id] ?? 1) !== 1 ? ` · ×${cfg.weights[r.id]}` : ""}</span></th>`).join("")}<th>Final / ${cfg.scale}</th></tr></thead>
      <tbody>${list.map((r) => `<tr class="${r.rank && r.rank <= 3 ? "top" : ""}"><td><b>${r.rank ?? "—"}</b></td>
        <td><b>${esc(r.t.name)}</b>${r.t.table_no ? ` <span class="small muted">· Table ${esc(r.t.table_no)}</span>` : ""}${r.t.college ? `<br><span class="small muted">${esc(r.t.college)}</span>` : ""}</td>
        ${r.per.map((p) => `<td title="${p.judges ? esc(p.judgeNames.join(", ")) : "Not judged"}">${p.avg == null ? '<span class="muted">—</span>' : `<b>${fmt(p.avg)}</b><div class="lb-judges">${p.judgeNames.map((n) => `<span>${esc(n)}</span>`).join("")}</div>`}</td>`).join("")}
        <td><b class="lb-final">${fmt(r.score)}</b></td></tr>`).join("") || `<tr><td colspan="${used.length + 3}" class="empty">No matching teams</td></tr>`}</tbody></table></div>`;
  };
  draw();
  form.addEventListener("input", draw);
  form.addEventListener("change", draw);
  $("#lb-q").oninput = draw;

  // ---- public leaderboard: participants scan a QR, no login; shows the last published snapshot
  const publicUrl = new URL("leaderboard.html", document.baseURI).href;
  let snap = null;
  try { snap = JSON.parse(state.settings.public_leaderboard_data || "null"); } catch { /* none yet */ }
  const setSetting = async (key, value) => {
    must(await sb.from("settings").upsert({ key, value }));
    state.settings[key] = value;
  };
  const publish = async () => {
    readCfg();
    const { rows, used } = computeLeaderboard(teams, rounds, scores, cfg);
    snap = {
      updated_at: new Date().toISOString(),
      title: `${cfg.mode === "sum" ? "Total" : "Average"} of ${used.map((r) => r.name).join(" + ")}`,
      scale: cfg.scale,
      rows: rows.map((r) => ({ rank: r.rank, team: r.t.name, table: r.t.table_no || null, college: r.t.college || null,
        ...(r.score == null ? {} : { score: Math.round(r.score * 100) / 100 }) })),
    };
    await setSetting("public_leaderboard_data", JSON.stringify(snap));
  };
  const drawPublic = () => {
    const on = state.settings.public_leaderboard === "on", pts = state.settings.public_show_points === "on";
    $("#pub").innerHTML = `
      <div class="pub-head">
        <div class="pub-switches">
          <div class="pub-sw"><label class="switch"><input type="checkbox" id="pub-on" ${on ? "checked" : ""}><span class="slider"></span></label>
            <div><b>Public leaderboard ${on ? "ON" : "OFF"}</b><br><span class="small muted">${on ? "Anyone with the link or QR can see the ranking – no login." : "Participants can't see the ranking yet."}</span></div></div>
          <div class="pub-sw"><label class="switch"><input type="checkbox" id="pub-pts" ${pts ? "checked" : ""}><span class="slider"></span></label>
            <div><b>Show points</b><br><span class="small muted">${pts ? "Scores are shown next to each team." : "Only the ranking is shown, no scores."}</span></div></div>
        </div>
        <div class="pub-qr" title="Scan to open the public leaderboard">${qrSvg(publicUrl)}</div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="pub-publish">${snap ? "Update public ranking" : "Publish current ranking"}</button>
        <button class="btn" id="pub-big">Show QR full screen</button>
        <a class="btn" href="${esc(publicUrl)}" target="_blank" rel="noopener">Open public page ↗</a>
        <button class="btn" id="pub-copy">Copy link</button>
        <span class="small muted">${snap ? `Public page shows the ranking published ${fmtTime(snap.updated_at)} (${esc(snap.title)}).` : "Nothing published yet."}</span>
      </div>`;
    $("#pub-on").onchange = async (e) => {
      try {
        if (e.target.checked && !snap) await publish();
        await setSetting("public_leaderboard", e.target.checked ? "on" : "off");
        toast(e.target.checked ? "Public leaderboard is live" : "Public leaderboard hidden", "ok");
      } catch (er) { toast(er.message, "bad"); }
      drawPublic();
    };
    $("#pub-pts").onchange = async (e) => {
      try { await setSetting("public_show_points", e.target.checked ? "on" : "off"); toast(e.target.checked ? "Points are now public" : "Points hidden", "ok"); }
      catch (er) { toast(er.message, "bad"); }
      drawPublic();
    };
    $("#pub-publish").onclick = async () => {
      try { await publish(); toast("Public ranking updated", "ok"); } catch (er) { toast(er.message, "bad"); }
      drawPublic();
    };
    $("#pub-copy").onclick = () => { navigator.clipboard?.writeText(publicUrl); toast("Link copied"); };
    $("#pub-big").onclick = () => modal(`<div class="pub-big"><img src="assets/logo.png" alt="" class="pub-big-logo">
        <h1>Scan for the leaderboard</h1><div class="qr-frame">${qrSvg(publicUrl)}</div><p class="muted small">${esc(publicUrl)}</p>
        <div class="actions" style="justify-content:center"><button class="btn" id="pb-fs">⛶ Full screen</button><button class="btn primary" data-close>Close</button></div></div>`,
      (m) => { $("#pb-fs", m).onclick = () => m.requestFullscreen?.(); });
  };
  drawPublic();

  $("#lb-save").onclick = async () => {
    readCfg();
    try {
      must(await sb.from("settings").upsert({ key: "leaderboard_config", value: JSON.stringify(cfg) }));
      state.settings.leaderboard_config = JSON.stringify(cfg);
      toast("Saved – the leaderboard will open with these options", "ok");
    } catch (er) { toast(er.message, "bad"); }
  };
  $("#lb-xl").onclick = async (e) => {
    const btn = e.target; btn.disabled = true;
    try {
      const XLSX = await loadSheetJs();
      const { rows, used } = current;
      const head = ["Rank", "Team", "Table", "College", ...used.flatMap((r) => [`${r.name} (avg / ${maxOf(r)})`, `${r.name} – judged by`]), `Final score / ${cfg.scale}`];
      const body = rows.map((r) => [r.rank ?? "", r.t.name, r.t.table_no || "", r.t.college || "",
        ...r.per.flatMap((p) => [p.avg == null ? "" : Number(p.avg.toFixed(2)), p.judgeNames.join(", ")]), r.score == null ? "" : Number(r.score.toFixed(2))]);
      const how = [["Method", cfg.mode === "sum" ? `Sum of round scores scaled to ${cfg.scale}` : `Average of round percentages, scaled to ${cfg.scale}`],
        ["Rounds", used.map((r) => `${r.name} (weight ${cfg.weights[r.id] ?? 1})`).join(", ")],
        ["Missing rounds", cfg.missing === "skip" ? "Left out for that team" : "Counted as 0"],
        ["Within a round", "Average of the judges' totals"], ["Generated", fmtFull(new Date().toISOString())]];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, head, body), "Leaderboard");
      XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, ["Setting", "Value"], how), "How it was calculated");
      XLSX.writeFile(wb, `${safeName(state.settings.event_name || "Event")}_leaderboard_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast("Excel file downloaded", "ok");
    } catch (er) { toast(er.message, "bad"); }
    btn.disabled = false;
  };
}

// ------------------------------------------------------------------ results
async function viewResults(main, cpId) {
  const cps = await getCheckpoints();
  const judging = cps.filter((c) => c.type === "judging");
  const scanCps = cps.filter((c) => c.type === "scan");
  const cp = judging.find((c) => c.id === Number(cpId)) || judging[0];
  const [teams, scores] = await Promise.all([
    sb.from("teams").select("id,name,table_no,college").order("name").then(must),
    cp ? sb.from("scores").select("*").eq("checkpoint_id", cp.id).then(must) : [],
  ]);
  let board = "";
  if (cp) {
    const max = cp.criteria.reduce((n, c) => n + Number(c.max), 0);
    const rows = teams.map((t) => {
      const s = scores.filter((x) => x.team_id === t.id);
      const avg = s.length ? s.reduce((n, x) => n + Number(x.total), 0) / s.length : null;
      const per = cp.criteria.map((c) => (s.length ? s.reduce((n, x) => n + Number(x.scores?.[c.name] || 0), 0) / s.length : null));
      return { t, s, avg, per };
    }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
    board = `<div class="table-wrap"><table><thead><tr><th>#</th><th>Team</th><th>Avg total / ${max}</th><th>Judged by</th>
      ${cp.criteria.map((c) => `<th>${esc(c.name)}</th>`).join("")}<th></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${r.avg == null ? "" : i + 1}</td><td><b>${esc(r.t.name)}</b>${r.t.table_no ? ` <span class="small muted">· Table ${esc(r.t.table_no)}</span>` : ""}${r.t.college ? `<br><span class="small muted">${esc(r.t.college)}</span>` : ""}</td>
        <td>${r.avg == null ? '<span class="muted">not graded</span>' : `<b>${r.avg.toFixed(2)}</b>`}</td>
        <td>${r.s.length ? `<div class="judged-by">${[...r.s].sort((a, b) => (a.judge_name || "").localeCompare(b.judge_name || ""))
          .map((x) => `<span class="jb" title="${esc(x.judge_name || "Judge")} gave ${x.total}${x.updated_at ? ` · ${fmtTime(x.updated_at)}` : ""}">${esc(x.judge_name || "Judge")} <b>${x.total}</b></span>`).join("")}</div>` : '<span class="muted">—</span>'}</td>
        ${r.per.map((v) => `<td>${v == null ? "" : v.toFixed(1)}</td>`).join("")}
        <td>${r.s.length ? `<button class="btn sm" data-detail="${r.t.id}">Details</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>`;
    main._rows = rows;
  }

  main.innerHTML = `
    <div class="page-head"><div><h1>Results</h1><p class="muted">Leaderboard is the average of all judges' totals.</p></div>
      <div class="row">${judging.length ? `<select id="cp" style="width:auto">${judging.map((c) => `<option value="${c.id}" ${c.id === cp?.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <button class="btn" id="exp-scores">Export scores CSV</button>` : ""}<button class="btn" id="exp-att">Export attendance CSV</button></div></div>
    <div class="card"><h2>${cp ? esc(cp.name) : "Leaderboard"}</h2>${cp ? board : '<div class="empty">No judging checkpoints yet.</div>'}</div>
    <div class="card"><h2>Attendance</h2><div id="att" class="small muted">Loading…</div></div>`;

  $("#cp") && ($("#cp").onchange = (e) => (location.hash = `#/results/${e.target.value}`));
  main.querySelector(".card").onclick = (e) => {
    const b = e.target.closest("[data-detail]");
    if (!b) return;
    const r = main._rows.find((x) => x.t.id === Number(b.dataset.detail));
    modal(`<h2>${esc(r.t.name)}</h2>${r.s.map((s) => `<div class="card"><div class="row" style="justify-content:space-between"><b>${esc(s.judge_name || "Judge")}</b><b>${s.total}</b></div>
      <div class="small muted">${cp.criteria.map((c) => `${esc(c.name)}: ${s.scores?.[c.name] ?? 0}/${c.max}`).join(" · ")}</div>
      ${s.comments ? `<p class="small" style="margin-bottom:0">${esc(s.comments)}</p>` : ""}
      <div class="row" style="justify-content:space-between;margin-top:10px"><span class="small muted">${s.updated_at ? `Saved ${fmtTime(s.updated_at)}` : ""}</span>
        <button type="button" class="btn sm danger" data-del-score="${s.id}">Delete score</button></div></div>`).join("")}
      <div class="actions"><button class="btn primary" data-close>Close</button></div>`, (m, close) => {
      m.addEventListener("click", async (ev) => {
        const del = ev.target.closest("[data-del-score]");
        if (!del) return;
        const s = r.s.find((x) => x.id === Number(del.dataset.delScore));
        if (!(await confirmBox(`Delete <b>${esc(s.judge_name || "this judge")}</b>'s score (${s.total}) for <b>${esc(r.t.name)}</b> in ${esc(cp.name)}? The judge can score this team again afterwards. This can't be undone.`, "Delete score", true))) return;
        try {
          const gone = must(await sb.from("scores").delete().eq("id", s.id).select("id"));
          if (!gone.length) throw new Error("Only admins can delete scores");
          toast(`Deleted ${s.judge_name || "judge"}'s score for ${r.t.name}`, "ok");
          close();
          route();
        } catch (er) { toast(er.message, "bad"); }
      });
    });
  };
  $("#exp-scores") && ($("#exp-scores").onclick = () => download(`scores_${cp.name.replace(/\W+/g, "_")}.csv`, toCSV([
    ["Team", "Judge", ...cp.criteria.map((c) => `${c.name} (/${c.max})`), "Total", "Comments", "Updated"],
    ...scores.map((s) => [teams.find((t) => t.id === s.team_id)?.name, s.judge_name, ...cp.criteria.map((c) => s.scores?.[c.name] ?? 0), s.total, s.comments, s.updated_at]),
  ])));

  const [parts, scans] = await Promise.all([getParticipants(), sb.from("scans").select("checkpoint_id,participant_id,scanned_at").then(must)]);
  const hit = new Map(scans.map((s) => [`${s.checkpoint_id}:${s.participant_id}`, s.scanned_at]));
  $("#att").innerHTML = scanCps.length ? `<div class="table-wrap"><table><thead><tr><th>Checkpoint</th><th>Scanned</th><th>Missing</th></tr></thead><tbody>
    ${scanCps.map((c) => {
      const missing = parts.filter((p) => !hit.has(`${c.id}:${p.id}`));
      return `<tr><td><b>${esc(c.name)}</b></td><td>${parts.length - missing.length} / ${parts.length}</td>
        <td>${missing.length ? `<details><summary>${missing.length} people</summary>${missing.map((p) => `${esc(p.name)} <span class="muted">(${esc(p.teams?.name)})</span>`).join("<br>")}</details>` : "—"}</td></tr>`;
    }).join("")}</tbody></table></div>` : "No scan checkpoints.";
  $("#exp-att").onclick = () => download("attendance.csv", toCSV([
    ["Team", "Name", "Email", "Code", ...scanCps.map((c) => c.name)],
    ...parts.map((p) => [p.teams?.name, p.name, p.email, p.token, ...scanCps.map((c) => hit.get(`${c.id}:${p.id}`) || "")]),
  ]));
}

// ------------------------------------------------------------------ settings & account
async function viewSettings(main) {
  await loadSettings();
  const s = state.settings;
  main.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1></div></div>
    <div class="card assign-mode ${s.assign_mentors === "on" ? "on" : ""}" style="max-width:720px">
      <label class="switch"><input type="checkbox" id="mode" ${s.assign_mentors === "on" ? "checked" : ""}><span class="slider"></span></label>
      <div style="flex:1"><b>Assign mentors to teams</b><br><span class="small muted">${s.assign_mentors === "on"
        ? "On – each mentor can only judge the teams assigned to them, set separately for every judging round."
        : "Off – any mentor can judge any team."}</span></div>
      <a class="btn sm" href="#/assign">Assign judges</a>
    </div>
    <form class="card" id="sf" style="max-width:720px">
      <div class="field"><label>Event name</label><input name="event_name" value="${esc(s.event_name)}"></div>
      <div class="field"><label>QR email subject</label><input name="email_subject" value="${esc(s.email_subject)}"></div>
      <div class="field"><label>QR email message</label><textarea name="email_message" style="min-height:180px">${esc(s.email_message)}</textarea>
        <p class="small muted">Placeholders: <code>{{name}}</code> <code>{{team}}</code> <code>{{event}}</code> <code>{{code}}</code>. The QR image and pass code are added below the message automatically.</p></div>
      <button class="btn primary">Save</button>
    </form>`;
  $("#mode").onchange = async (e) => {
    try { await setAssignMode(e.target.checked); toast(e.target.checked ? "Mentor assignments on" : "Mentor assignments off", "ok"); route(); }
    catch (er) { toast(er.message, "bad"); e.target.checked = !e.target.checked; }
  };
  $("#sf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      must(await sb.from("settings").upsert(["event_name", "email_subject", "email_message"].map((key) => ({ key, value: f.get(key) }))));
      toast("Settings saved", "ok");
      await loadSettings();
      renderShell(); route();
    } catch (er) { toast(er.message, "bad"); }
  };
}

function viewAccount(main) {
  main.innerHTML = `
    <div class="page-head"><div><h1>My account</h1><p class="muted">${esc(state.me.name)} · ${esc(state.me.email)} · ${state.me.role}</p></div></div>
    <form class="card" id="pw" style="max-width:420px"><h2>Change password</h2>
      <div class="field"><label>New password</label><input type="password" name="p1" minlength="8" required autocomplete="new-password"></div>
      <div class="field"><label>Repeat</label><input type="password" name="p2" minlength="8" required autocomplete="new-password"></div>
      <button class="btn primary">Update password</button></form>`;
  $("#pw").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get("p1") !== f.get("p2")) return toast("Passwords don't match", "bad");
    const { error } = await sb.auth.updateUser({ password: f.get("p1") });
    if (error) return toast(error.message, "bad");
    toast("Password updated", "ok");
    e.target.reset();
  };
}

// GitHub Pages lets browsers cache files for 10 minutes. If a newer version is published,
// reload once with a fresh URL so the new index.html (and its versioned assets) load.
async function checkVersion() {
  if (APP_VERSION === "dev") return;
  try {
    const { version } = await (await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" })).json();
    if (version && version !== APP_VERSION && !location.search.includes(`v=${version}`)) {
      location.replace(`${location.pathname}?v=${version}${location.hash}`);
    }
  } catch { /* offline or missing – keep running */ }
}
checkVersion();
setInterval(checkVersion, 5 * 60 * 1000);

boot();
