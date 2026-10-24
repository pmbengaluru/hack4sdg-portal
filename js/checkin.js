// Public attendance page (no login). Opened from the QR on the display screen:
// checkin.html?c=<checkpoint id>&k=<rotating code>
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js?v=20261024.1829";

const box = document.getElementById("ci");
const params = new URLSearchParams(location.search);
const cp = Number(params.get("c"));
const code = params.get("k") || "";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tick = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const alertIco = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const device = store.get("ci-device") || (() => { const d = crypto.randomUUID?.() || String(Math.random()).slice(2); store.set("ci-device", d); return d; })();

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`Server error (${res.status})`);
  return res.json();
}

function result(kind, title, sub, extra = "") {
  box.className = `card ci-card result-card ${kind}`;
  box.innerHTML = `<div class="result ${kind} pop"><div>
    <div class="result-ico">${kind === "ok" ? tick : alertIco}</div>
    <div class="big">${title}</div><div class="sub">${sub}</div></div></div>${extra}`;
}

function showDone(r, again = false) {
  result("ok", again ? `You're already marked present, ${esc(r.name.split(" ")[0])}!` : `Thanks, ${esc(r.name.split(" ")[0])}!`,
    `You're marked present${window.CI_INFO?.checkpoint ? ` for <b>${esc(window.CI_INFO.checkpoint)}</b>` : ""} · ${esc(r.team)}`,
    `${r.table_no ? `<div class="ci-table"><small>Your table</small>${esc(r.table_no)}</div>` : ""}
     <button class="btn block" id="another" style="margin-top:14px">Mark someone else present</button>`);
  document.getElementById("another").onclick = () => form(window.CI_INFO);
}

// Team search box: as people type, a dropdown lists matching teams (ignores case, spaces and punctuation).
const squash = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
function teamSearch(teams) {
  const input = document.getElementById("team");
  const list = document.getElementById("team-list");
  let shown = [], active = -1;

  // highlight the typed letters inside the team name, even when spaces/punctuation differ
  const mark = (name, q) => {
    const qs = squash(q);
    if (!qs) return esc(name);
    const map = [];
    let flat = "";
    [...name].forEach((ch, i) => { const c = squash(ch); if (c) { flat += c; map.push(i); } });
    const at = flat.indexOf(qs);
    if (at < 0) return esc(name);
    const from = map[at], to = map[at + qs.length - 1] + 1;
    return `${esc(name.slice(0, from))}<mark>${esc(name.slice(from, to))}</mark>${esc(name.slice(to))}`;
  };
  const open = (on) => { list.hidden = !on; input.setAttribute("aria-expanded", String(on)); };
  const render = () => {
    const q = input.value.trim(), qs = squash(q);
    shown = (qs ? teams.filter((t) => squash(t).includes(qs)) : teams)
      .sort((a, b) => (qs ? squash(b).startsWith(qs) - squash(a).startsWith(qs) : 0) || a.localeCompare(b))
      .slice(0, 50);
    active = shown.length && qs ? 0 : -1;
    list.innerHTML = shown.length
      ? shown.map((t, i) => `<li role="option" id="team-opt-${i}" data-i="${i}" aria-selected="${i === active}">${mark(t, q)}</li>`).join("")
      : `<li class="combo-empty">No team matches “${esc(q)}”. Check the spelling, or keep typing your full team name.</li>`;
    input.setAttribute("aria-activedescendant", active >= 0 ? `team-opt-${active}` : "");
    open(true);
  };
  const move = (d) => {
    if (!shown.length) return;
    active = (active + d + shown.length) % shown.length;
    [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
    list.children[active]?.scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", `team-opt-${active}`);
  };
  const choose = (i) => {
    input.value = shown[i];
    open(false);
    document.getElementById("name").focus();
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); list.hidden ? render() : move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter" && !list.hidden && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") open(false);
  });
  // pointerdown so the tap lands before the input loses focus
  list.addEventListener("pointerdown", (e) => {
    const li = e.target.closest("[data-i]");
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.i));
  });
  input.addEventListener("blur", () => setTimeout(() => open(false), 120));
}

function form(info) {
  box.className = "card ci-card";
  box.innerHTML = `
    <h1>Mark attendance</h1>
    <p class="muted" style="margin-top:0">${esc(info.event || "")} · ${esc(info.checkpoint)}</p>
    <form id="f" autocomplete="on">
      <div class="field float combo">
        <input id="team" name="team" required maxlength="120" placeholder=" " autocomplete="off" autocapitalize="off" spellcheck="false"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="team-list">
        <label for="team">Search your team</label>
        <ul id="team-list" class="combo-list" role="listbox" hidden></ul>
      </div>
      <div class="field float"><input id="name" name="name" required maxlength="120" placeholder=" " autocomplete="name"><label for="name">Your full name</label></div>
      <button class="btn primary lg block">Mark me present</button>
      <p class="small muted" style="margin-bottom:0">Start typing your team name and tap it in the list. Use the name you registered with.</p>
    </form>`;
  teamSearch(info.teams || []);
  const last = store.get(`ci-team-${cp}`);
  if (last) document.getElementById("team").value = last;
  document.getElementById(last ? "name" : "team").focus();
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const team = document.getElementById("team").value.trim();
    const name = document.getElementById("name").value.trim();
    const btn = e.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const r = await rpc("self_checkin", { p_checkpoint: cp, p_code: code, p_team: team, p_name: name, p_device: device });
      store.set(`ci-team-${cp}`, team);
      if (r.status === "ok" || r.status === "already") {
        store.set(`ci-done-${cp}`, { name: r.name, team: r.team, table_no: r.table_no });
        navigator.vibrate?.(60);
        showDone(r, r.status === "already");
      } else if (r.status === "pending") {
        result("dup", "Almost there",
          `We couldn't match <b>${esc(name)}</b>${r.team_found ? "" : ` in <b>${esc(team)}</b>`} to the registration list. A volunteer will confirm you – no need to do anything else.`,
          `<button class="btn block" id="retry" style="margin-top:14px">Fix a typo and try again</button>`);
        document.getElementById("retry").onclick = () => form(info);
      } else if (r.status === "invalid") {
        btn.disabled = false; btn.textContent = "Mark me present";
        alert(r.message);
      } else if (r.status === "expired") {
        result("bad", "This QR code has expired", "Please scan the code on the screen again – it changes every 10 minutes.");
      } else {
        result("bad", "Attendance is closed", "Please ask a volunteer.");
      }
    } catch (er) {
      btn.disabled = false; btn.textContent = "Try again";
      result("bad", "Couldn't reach the server", `${esc(er.message)}. Check your connection and scan the code again.`);
    }
  };
}

async function start() {
  if (!cp || !code) return result("bad", "Scan the QR code on the screen", "This page opens from the attendance QR code.");
  const done = store.get(`ci-done-${cp}`);
  try {
    const info = await rpc("self_checkin_info", { p_checkpoint: cp, p_code: code });
    window.CI_INFO = info;
    if (info.status === "ok") return done ? showDone(done, true) : form(info);
    if (done) return showDone(done, true);
    if (info.status === "expired") return result("bad", "This QR code has expired", "Please scan the code on the screen again – it changes every 10 minutes.");
    return result("bad", "Attendance is closed", "Please ask a volunteer.");
  } catch (er) {
    result("bad", "Couldn't reach the server", `${esc(er.message)}. Check your connection and try again.`);
  }
}
start();
