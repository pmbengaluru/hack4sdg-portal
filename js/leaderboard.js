// Public leaderboard (no login). Shows the ranking an admin published; refreshes every 30 seconds.
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js?v=20261025.0422";

const board = document.getElementById("board");
const sub = document.getElementById("sub");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null ? "" : String(Math.round(n * 100) / 100));
const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(t)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};
const medal = (rank) => ["🥇", "🥈", "🥉"][rank - 1] || "";

let last = null, query = "";

async function load() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/public_leaderboard`, {
    method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: "{}",
  });
  if (!res.ok) throw new Error(`Server error (${res.status})`);
  return res.json();
}

function message(title, text) {
  board.innerHTML = `<div class="lbp-msg"><div class="lbp-msg-icon">🏆</div><h2>${title}</h2><p>${text}</p></div>`;
}

function render(d) {
  const rows = d.rows || [];
  const ranked = rows.filter((r) => r.rank != null);
  const pts = d.show_points;
  const best = pts ? Math.max(d.scale || 0, ...ranked.map((r) => r.score || 0)) || 1 : 1;
  sub.innerHTML = `${esc(d.event || "")}${d.title ? ` · ${esc(d.title)}` : ""}${pts && d.scale ? ` · out of ${esc(d.scale)}` : ""}<br><span class="lbp-updated">Updated ${ago(d.updated_at)}</span>`;

  const top = ranked.slice(0, 3);
  const podium = top.length ? `<div class="lbp-podium">${top.map((r, i) => `
    <div class="lbp-pod lbp-pod-${i + 1}" style="--i:${i}">
      <div class="lbp-medal">${medal(r.rank) || `#${r.rank}`}</div>
      <div class="lbp-pod-team">${esc(r.team)}</div>
      <div class="lbp-pod-meta">${[r.table ? `Table ${esc(r.table)}` : "", esc(r.college || "")].filter(Boolean).join(" · ")}</div>
      ${pts ? `<div class="lbp-pod-score">${fmt(r.score)}</div>` : ""}
      <div class="lbp-pod-base">${r.rank}</div>
    </div>`).join("")}</div>` : "";

  const q = query.trim().toLowerCase();
  const list = rows.map((r, i) => {
    const hit = q && `${r.team} ${r.table || ""} ${r.college || ""}`.toLowerCase().includes(q);
    return `<li class="lbp-row ${r.rank && r.rank <= 3 ? "lbp-top" : ""} ${hit ? "lbp-hit" : ""} ${r.rank == null ? "lbp-none" : ""}" style="--i:${Math.min(i, 30)}">
      <span class="lbp-rank">${r.rank == null ? "–" : medal(r.rank) || r.rank}</span>
      <span class="lbp-team"><b>${esc(r.team)}</b><small>${[r.table ? `Table ${esc(r.table)}` : "", esc(r.college || "")].filter(Boolean).join(" · ") || "&nbsp;"}</small></span>
      ${pts ? (r.score == null ? '<span class="lbp-score lbp-muted">Not judged yet</span>'
        : `<span class="lbp-score"><span class="lbp-bar"><span style="width:${Math.max(3, (r.score / best) * 100)}%"></span></span><b>${fmt(r.score)}</b></span>`)
        : r.rank == null ? '<span class="lbp-score lbp-muted">Not judged yet</span>' : ""}
    </li>`;
  }).join("");

  board.innerHTML = `${podium}
    <div class="lbp-card">
      <div class="lbp-find"><input id="find" placeholder="Find your team…" value="${esc(query)}" autocomplete="off" aria-label="Find your team">
        <span>${ranked.length} team${ranked.length === 1 ? "" : "s"} ranked</span></div>
      <ol class="lbp-list">${list}</ol>
    </div>`;
  const find = document.getElementById("find");
  find.oninput = () => {
    query = find.value;
    const pos = find.selectionStart;
    render(d);
    const again = document.getElementById("find");
    again.focus(); again.setSelectionRange(pos, pos);
    document.querySelector(".lbp-hit")?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
}

async function tick() {
  try {
    const d = await load();
    if (d.status === "off") { last = null; sub.textContent = d.event || ""; return message("Results coming soon", "The leaderboard isn't public yet – check back in a little while."); }
    if (d.status !== "ok") { last = null; return message("Results coming soon", "The organisers haven't published the ranking yet."); }
    const sig = JSON.stringify([d.updated_at, d.show_points, d.rows]);
    if (sig !== last) { last = sig; render(d); }
    else sub.querySelector(".lbp-updated") && (sub.querySelector(".lbp-updated").textContent = `Updated ${ago(d.updated_at)}`);
  } catch (er) {
    if (!last) message("Can't load the leaderboard", `${esc(er.message)}. Check your connection – it will retry automatically.`);
  }
}
tick();
setInterval(tick, 30000);
