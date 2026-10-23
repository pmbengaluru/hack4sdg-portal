import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js?v=20261023.2233";
import { analyzeCSV, toCSV } from "./csv.js?v=20261023.2233";

const APP_VERSION = "20261023.2233"; // set by scripts/bump-version.mjs
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById("app");

const state = { user: null, me: null, settings: {}, scanner: null };

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
async function readSpreadsheet(file) {
  if (!/\.(xlsx|xls|ods)$/i.test(file.name)) return file.text();
  sheetJs ??= new Promise((ok, fail) => {
    const s = Object.assign(document.createElement("script"), { src: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" });
    s.onload = () => ok(window.XLSX);
    s.onerror = () => fail(new Error("Couldn't load the Excel reader – check your connection or upload a CSV."));
    document.head.appendChild(s);
  });
  const XLSX = await sheetJs;
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
const getTeams = async () =>
  must(await sb.from("teams").select("id,name,declared_size,college,participants(id,name,email,phone,is_leader,token,email_status,email_sent_at,email_error)").order("name"));
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
  judge: { label: "Judge", icon: "judge", roles: ["admin", "mentor"], view: viewJudge },
  results: { label: "Results", icon: "results", roles: ["admin"], view: viewResults },
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
        <td style="min-width:160px"><div class="progress"><div style="width:${pct}%"></div></div><span class="small muted">${n} / ${parts.length} people</span></td></tr>`;
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

async function viewTeams(main) {
  const teams = await getTeams();
  const total = teams.reduce((n, t) => n + t.participants.length, 0);
  main.innerHTML = `
    <div class="page-head"><div><h1>Teams & QR codes</h1><p class="muted">${teams.length} teams · ${total} participants</p></div>
      <div class="row"><button class="btn" id="add-team">+ Team</button><button class="btn" id="add-p" ${teams.length ? "" : "disabled"}>+ Participant</button>
      <button class="btn" id="exp">Export CSV</button><a class="btn" href="#/print">Print badges</a></div></div>
    <div class="row" style="margin-bottom:14px"><input class="grow" id="q" placeholder="Search team, college, name, email, phone or code…">
      <select id="filter" style="width:auto"><option value="">All</option><option value="pending">Not mailed</option><option value="sent">Mailed</option><option value="failed">Mail failed</option><option value="noemail">No email</option></select></div>
    <div id="list"></div>`;

  const draw = () => {
    const q = $("#q").value.trim().toLowerCase(), fl = $("#filter").value;
    const match = (p) => (!fl || (fl === "noemail" ? !p.email : p.email && p.email_status === fl));
    const rows = teams.map((t) => {
      const teamHit = !q || `${t.name} ${t.college || ""}`.toLowerCase().includes(q);
      const ms = t.participants.filter((p) => match(p) && (teamHit || [p.name, p.email, p.phone, p.token].some((v) => (v || "").toLowerCase().includes(q))));
      return { t, ms };
    }).filter((x) => x.ms.length || (!fl && (!q || x.t.name.toLowerCase().includes(q))));
    $("#list").innerHTML = rows.length ? rows.map(({ t, ms }) => {
      const sent = t.participants.filter((p) => p.email_status === "sent").length;
      const sorted = [...ms].sort((a, b) => b.is_leader - a.is_leader || a.name.localeCompare(b.name));
      return `<details class="team" ${q || fl ? "open" : ""}>
        <summary><span class="name">${esc(t.name)}${t.college ? ` <span class="small muted" style="font-weight:400">· ${esc(t.college)}</span>` : ""}</span>
          <span class="badge">${t.participants.length} member${t.participants.length === 1 ? "" : "s"}</span>
          ${t.declared_size && t.declared_size !== t.participants.length ? `<span class="badge warn">size ${t.declared_size}</span>` : ""}
          <span class="badge ${sent === t.participants.length && sent ? "ok" : ""}">${sent}/${t.participants.length} mailed</span>
          <button class="btn sm primary" data-team-mail="${t.id}" title="Email every member's QR to the team leader">✉ Email QRs</button>
          <button class="btn sm" data-team-edit="${t.id}">Rename</button>
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

  const findP = (id) => { for (const t of teams) for (const p of t.participants) if (p.id === id) return [p, t]; return []; };
  $("#list").onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    e.preventDefault();
    if (b.dataset.qr) { const [p, t] = findP(Number(b.dataset.qr)); showQr(p, t); }
    if (b.dataset.edit) { const [p, t] = findP(Number(b.dataset.edit)); editParticipant({ ...p, team_id: t.id }, teams); }
    if (b.dataset.teamEdit) {
      const t = teams.find((x) => x.id === Number(b.dataset.teamEdit));
      const name = prompt("Team name", t.name);
      if (name && name.trim() !== t.name) {
        try { must(await sb.from("teams").update({ name: name.trim() }).eq("id", t.id)); route(); } catch (er) { toast(er.message, "bad"); }
      }
    }
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
    ["Team", "Name", "Email", "Phone", "Leader", "QR code", "Email status"],
    ...teams.flatMap((t) => t.participants.map((p) => [t.name, p.name, p.email, p.phone, p.is_leader ? "yes" : "", p.token, p.email_status])),
  ]));
}

async function viewPrint(main) {
  const teams = await getTeams();
  main.innerHTML = `
    <div class="page-head no-print"><div><h1>Print badges</h1><p class="muted">One QR per participant, grouped by team. Use your browser's print (Ctrl+P).</p></div>
      <div class="row"><a class="btn" href="#/teams">Back</a><button class="btn primary" onclick="print()">Print</button></div></div>
    <div class="badges">${teams.flatMap((t) => t.participants.map((p) => `
      <div class="badge-card">${qrSvg(p.token)}<div class="n">${esc(p.name)}</div><div class="t">${esc(t.name)}</div><div class="t code">${esc(p.token)}</div></div>`)).join("")}</div>`;
}

// ------------------------------------------------------------------ checkpoints
function editCheckpoint(c) {
  const isNew = !c.id;
  const crit = c.criteria?.length ? c.criteria : [{ name: "Innovation", max: 10 }, { name: "Impact on SDGs", max: 10 }, { name: "Technical execution", max: 10 }, { name: "Presentation", max: 10 }];
  modal(`
    <h2>${isNew ? "New checkpoint" : "Edit checkpoint"}</h2>
    <form id="cf">
      <div class="field"><label>Name</label><input name="name" required value="${esc(c.name)}" placeholder="e.g. Check-in, Lunch Day 1, Round 1 Judging"></div>
      <div class="field"><label>What happens here?</label>
        <label class="check"><input type="radio" name="type" value="scan" ${c.type !== "judging" ? "checked" : ""}> <span><b>QR scan</b> – volunteers scan each participant (check-in, meals, swag…)</span></label>
        <label class="check"><input type="radio" name="type" value="judging" ${c.type === "judging" ? "checked" : ""}> <span><b>Judging</b> – mentors grade each team against criteria</span></label></div>
      <div class="field"><label>Description (optional)</label><input name="description" value="${esc(c.description)}"></div>
      <div class="field" id="crit-wrap"><label>Grading criteria</label><div id="crit"></div>
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
    const addRow = (x = { name: "", max: 10 }) => {
      const d = document.createElement("div");
      d.className = "row"; d.style.marginBottom = "6px";
      d.innerHTML = `<input class="grow" data-cn placeholder="Criterion" value="${esc(x.name)}"><input type="number" data-cm min="1" style="width:80px" value="${x.max}" title="Max score"><button type="button" class="btn sm danger">✕</button>`;
      $("button", d).onclick = () => d.remove();
      critEl.appendChild(d);
    };
    crit.forEach(addRow);
    $("#add-crit", m).onclick = () => addRow();
    const sync = () => ($("#crit-wrap", m).style.display = $('input[name=type]:checked', m).value === "judging" ? "" : "none");
    $$('input[name=type]', m).forEach((r) => (r.onchange = sync));
    sync();
    $("#cf", m).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const type = f.get("type");
      const criteria = type === "judging"
        ? $$(".row", critEl).map((r) => ({ name: $("[data-cn]", r).value.trim(), max: Number($("[data-cm]", r).value) || 10 })).filter((x) => x.name)
        : [];
      if (type === "judging" && !criteria.length) return toast("Add at least one grading criterion", "bad");
      const starts_at = fromLocalInput(f.get("starts_at")), ends_at = fromLocalInput(f.get("ends_at"));
      if (starts_at && ends_at && ends_at <= starts_at) return toast("End time must be after the start time", "bad");
      const row = { name: f.get("name").trim(), type, description: f.get("description").trim() || null, criteria, sort_order: Number(f.get("sort_order")) || 0, active: f.get("active") === "on", starts_at, ends_at };
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
    <td>${c.type === "scan" ? '<span class="badge info">QR scan · volunteers</span>' : '<span class="badge warn">Judging · mentors</span>'}</td>
    <td class="small">${c.type === "judging" ? c.criteria.map((x) => `${esc(x.name)} (${x.max})`).join(", ") : "—"}</td>
    <td><button class="btn sm" data-toggle="${c.id}">${c.active ? "✓ Open" : "Closed"}</button></td>
    <td><button class="btn sm" data-edit="${c.id}">Edit</button></td></tr>`;
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
          { name: "Check-in", type: "scan", sort_order: 1 },
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
  const handle = async (code) => {
    show("", "Checking…", "");
    try {
      const r = must(await sb.rpc("scan_participant", { p_checkpoint: cp.id, p_code: code }));
      if (r.status === "ok") {
        beep(true);
        done++;
        $("#done").textContent = done;
        $("#bar").style.width = `${(done / total) * 100}%`;
        show("ok", esc(r.participant.name), `Team <b>${esc(r.team.name)}</b> · ${r.team_checked}/${r.team_size} of team scanned here`);
        recent();
      } else if (r.status === "duplicate") {
        beep(false);
        show("dup", `Already scanned – ${esc(r.participant.name)}`, `Team ${esc(r.team.name)} · ${fmtTime(r.scanned_at)}${r.scanned_by ? " by " + esc(r.scanned_by) : ""}`);
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

// ------------------------------------------------------------------ judging
async function viewJudge(main, cpId, teamId) {
  const cps = (await getCheckpoints()).filter((c) => c.type === "judging" && c.active);
  if (!cps.length) {
    main.innerHTML = `<h1>Judging</h1><div class="card empty">No judging rounds are open.${state.me.role === "admin" ? ' <a href="#/checkpoints">Create one</a>.' : " Ask an admin to open one."}</div>`;
    return;
  }
  const cp = pickCheckpoint(cps, cpId);
  if (teamId) return judgeTeam(main, cp, Number(teamId));

  const [teams, mine] = await Promise.all([
    sb.from("teams").select("id,name,participants(count)").order("name").then(must),
    sb.from("scores").select("team_id,total").eq("checkpoint_id", cp.id).eq("judge_id", state.user.id).then(must),
  ]);
  const scored = new Map(mine.map((s) => [s.team_id, s.total]));
  const max = cp.criteria.reduce((n, c) => n + Number(c.max), 0);

  main.innerHTML = `
    <div class="page-head"><div><h1>Judging</h1><p class="muted">You've graded ${scored.size} of ${teams.length} teams</p></div>
      <select id="cp" style="width:auto;min-width:200px">${cps.map((c) => cpOption(c, cp)).join("")}</select></div>
    <div class="scan-layout">
      <div class="card"><h3>Scan any team member's QR</h3><div id="reader"></div>
        <div class="row" style="margin-top:10px"><button class="btn" id="cam">Start camera</button><span class="small muted" id="cam-st"></span></div></div>
      <div class="card"><div class="row" style="margin-bottom:10px"><h3 style="margin:0;flex:1">Or pick a team</h3><input id="q" placeholder="Filter…" style="max-width:200px"></div>
        <div class="team-pick" id="tp"></div></div>
    </div>`;
  const draw = () => {
    const q = $("#q").value.toLowerCase();
    $("#tp").innerHTML = teams.filter((t) => t.name.toLowerCase().includes(q)).map((t) => `<button class="btn" data-t="${t.id}" style="justify-content:space-between">
      <span>${esc(t.name)}</span>${scored.has(t.id) ? `<span class="badge ok">${scored.get(t.id)}/${max}</span>` : '<span class="badge">—</span>'}</button>`).join("");
  };
  draw();
  $("#q").oninput = draw;
  $("#tp").onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) location.hash = `#/judge/${cp.id}/${b.dataset.t}`; };
  $("#cp").onchange = (e) => (location.hash = `#/judge/${e.target.value}`);
  $("#cam").onclick = async () => {
    if (state.scanner) { await stopScanner(); $("#cam").textContent = "Start camera"; return; }
    try {
      await startScanner(async (code) => {
        const tok = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const { data } = await sb.from("participants").select("team_id").eq("token", tok).maybeSingle();
        if (!data) { beep(false); toast("QR not recognised", "bad"); return; }
        beep(true);
        location.hash = `#/judge/${cp.id}/${data.team_id}`;
      });
      $("#cam").textContent = "Stop camera";
    } catch (e) { $("#cam-st").textContent = `Camera unavailable: ${e?.message || e}`; }
  };
}

async function judgeTeam(main, cp, teamId) {
  const [team, existing] = await Promise.all([
    sb.from("teams").select("id,name,college,participants(name,is_leader)").eq("id", teamId).single().then(must),
    sb.from("scores").select("*").eq("checkpoint_id", cp.id).eq("team_id", teamId).eq("judge_id", state.user.id).maybeSingle().then(must),
  ]);
  const vals = existing?.scores || {};
  const max = cp.criteria.reduce((n, c) => n + Number(c.max), 0);
  main.innerHTML = `
    <div class="page-head"><div><a href="#/judge/${cp.id}" class="small">← All teams</a><h1>${esc(team.name)}</h1>
      <p class="muted">${esc(cp.name)}${team.college ? " · " + esc(team.college) : ""} · ${team.participants.map((p) => esc(p.name) + (p.is_leader ? " (lead)" : "")).join(", ")}</p></div></div>
    <form class="card" id="sf" style="max-width:640px">
      ${cp.criteria.map((c, i) => `<div class="crit"><div><label>${esc(c.name)} <span class="muted">/ ${c.max}</span></label>
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
    } catch (er) { toast(er.message, "bad"); }
  };
}

// ------------------------------------------------------------------ results
async function viewResults(main, cpId) {
  const cps = await getCheckpoints();
  const judging = cps.filter((c) => c.type === "judging");
  const scanCps = cps.filter((c) => c.type === "scan");
  const cp = judging.find((c) => c.id === Number(cpId)) || judging[0];
  const [teams, scores] = await Promise.all([
    sb.from("teams").select("id,name").order("name").then(must),
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
    board = `<div class="table-wrap"><table><thead><tr><th>#</th><th>Team</th><th>Avg total / ${max}</th><th>Judges</th>
      ${cp.criteria.map((c) => `<th>${esc(c.name)}</th>`).join("")}<th></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${r.avg == null ? "" : i + 1}</td><td><b>${esc(r.t.name)}</b></td>
        <td>${r.avg == null ? '<span class="muted">not graded</span>' : `<b>${r.avg.toFixed(2)}</b>`}</td><td>${r.s.length}</td>
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
      ${s.comments ? `<p class="small" style="margin-bottom:0">${esc(s.comments)}</p>` : ""}</div>`).join("")}
      <div class="actions"><button class="btn primary" data-close>Close</button></div>`);
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
    <form class="card" id="sf" style="max-width:720px">
      <div class="field"><label>Event name</label><input name="event_name" value="${esc(s.event_name)}"></div>
      <div class="field"><label>QR email subject</label><input name="email_subject" value="${esc(s.email_subject)}"></div>
      <div class="field"><label>QR email message</label><textarea name="email_message" style="min-height:180px">${esc(s.email_message)}</textarea>
        <p class="small muted">Placeholders: <code>{{name}}</code> <code>{{team}}</code> <code>{{event}}</code> <code>{{code}}</code>. The QR image and pass code are added below the message automatically.</p></div>
      <button class="btn primary">Save</button>
    </form>`;
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
