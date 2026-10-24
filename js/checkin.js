// Public attendance page (no login). Opened from the QR on the display screen:
// checkin.html?c=<checkpoint id>&k=<rotating code>
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js?v=20261024.0714";

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

function form(info) {
  box.className = "card ci-card";
  box.innerHTML = `
    <h1>Mark attendance</h1>
    <p class="muted" style="margin-top:0">${esc(info.event || "")} · ${esc(info.checkpoint)}</p>
    <form id="f" autocomplete="on">
      <div class="field float"><input id="team" name="team" list="teams" required maxlength="120" placeholder=" " autocomplete="off"><label for="team">Team name</label></div>
      <datalist id="teams">${(info.teams || []).map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
      <div class="field float"><input id="name" name="name" required maxlength="120" placeholder=" " autocomplete="name"><label for="name">Your full name</label></div>
      <button class="btn primary lg block">Mark me present</button>
      <p class="small muted" style="margin-bottom:0">Use the name you registered with. Start typing your team and pick it from the list.</p>
    </form>`;
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
        result("bad", "This QR code has expired", "Please scan the code on the screen again – it changes every 5 minutes.");
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
    if (info.status === "expired") return result("bad", "This QR code has expired", "Please scan the code on the screen again – it changes every 5 minutes.");
    return result("bad", "Attendance is closed", "Please ask a volunteer.");
  } catch (er) {
    result("bad", "Couldn't reach the server", `${esc(er.message)}. Check your connection and try again.`);
  }
}
start();
