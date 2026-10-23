// CSV parsing + team detection. Supports two layouts:
//  1. Wide: one row per team  -> Team Name, Team Size, Member 1 Name, Member 1 Email, Member 2 Name, ...
//  2. Long: one row per person -> Team Name, Name, Email, (Phone)

export function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const norm = (h) => h.toLowerCase().replace(/[_\-.:()/]+/g, " ").replace(/\s+/g, " ").trim();
const isEmail = (h) => /e ?mail|mail id|gmail/.test(h);
const isPhone = (h) => /phone|mobile|contact|whatsapp/.test(h);
const isName = (h) => /name/.test(h);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function analyzeCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("The CSV has no data rows.");
  const headers = rows[0].map((h) => h.trim());
  const H = headers.map(norm);
  const warnings = [];

  let teamCol = H.findIndex((h) => /team/.test(h) && /name/.test(h) && !/leader|lead|captain|member|participant/.test(h));
  if (teamCol < 0) teamCol = H.findIndex((h) => /^team( id| no| number)?$/.test(h));
  const sizeCol = H.findIndex((h) =>
    /team size|^size$|(no|number) of (team )?(members|participants)|member count|members count|team strength/.test(h));

  // Numbered member slots ("Member 2 Email", "2nd member name", "Team Leader Email" -> slot 0)
  const slots = {};
  H.forEach((h, i) => {
    if (i === teamCol || i === sizeCol) return;
    let slot = null;
    const m = h.match(/(?:member|participant|teammate|person)\s*(?:no\s*)?#?\s*(\d+)|(\d+)\s*(?:st|nd|rd|th)?\s*(?:member|participant|teammate)/);
    if (m) slot = parseInt(m[1] ?? m[2], 10);
    else if (/leader|captain|\blead\b/.test(h)) slot = 0;
    if (slot === null) return;
    const f = isEmail(h) ? "email" : isPhone(h) ? "phone"
      : (isName(h) || /^(member|participant|teammate) ?#?\d+$/.test(h)) ? "name" : null;
    if (!f) return;
    slots[slot] ??= {};
    slots[slot][f] ??= i;
  });
  const slotKeys = Object.keys(slots).map(Number).filter((k) => slots[k].name != null).sort((a, b) => a - b);

  const teams = new Map();
  const seenEmails = new Map();
  const getTeam = (name, size) => {
    const key = name.toLowerCase();
    if (!teams.has(key)) teams.set(key, { name, size: size || null, members: [] });
    const t = teams.get(key);
    if (size && !t.size) t.size = size;
    return t;
  };
  const addMember = (team, m, rowNo) => {
    m.name = m.name.trim();
    m.email = (m.email || "").trim().toLowerCase();
    m.phone = (m.phone || "").trim();
    if (!m.name && !m.email) return;
    if (!m.name) m.name = m.email.split("@")[0];
    if (m.email && !EMAIL_RE.test(m.email)) {
      warnings.push(`Row ${rowNo}: "${m.email}" doesn't look like an email (${m.name}).`);
    }
    if (!m.email) warnings.push(`Row ${rowNo}: ${m.name} (${team.name}) has no email – QR can't be mailed.`);
    if (m.email && seenEmails.has(m.email)) {
      const prev = seenEmails.get(m.email);
      if (prev !== team.name) warnings.push(`Row ${rowNo}: ${m.email} already appears in team "${prev}" – skipped.`);
      return; // same person listed twice (e.g. leader also as member 1)
    }
    if (m.email) seenEmails.set(m.email, team.name);
    team.members.push(m);
  };

  let mode;
  if (slotKeys.length) {
    mode = "wide";
    if (teamCol < 0) warnings.push('No "Team Name" column found – teams are named after their first member.');
    rows.slice(1).forEach((r, idx) => {
      const rowNo = idx + 2;
      const cell = (i) => (i == null ? "" : (r[i] ?? "").trim());
      const members = slotKeys.map((k) => ({
        name: cell(slots[k].name), email: cell(slots[k].email), phone: cell(slots[k].phone), leader: k === 0,
      })).filter((m) => m.name || m.email);
      if (!members.length) return;
      if (!members.some((m) => m.leader)) members[0].leader = true;
      let tname = cell(teamCol);
      if (!tname) {
        tname = `${members[0].name}'s team`;
        if (teamCol >= 0) warnings.push(`Row ${rowNo}: empty team name – using "${tname}".`);
      }
      const size = parseInt(cell(sizeCol), 10) || null;
      const team = getTeam(tname, size);
      members.forEach((m) => addMember(team, m, rowNo));
    });
  } else {
    mode = "long";
    const nameCol = H.findIndex((h, i) => i !== teamCol && isName(h) && !isEmail(h) && !/team|college|institute|university/.test(h));
    const emailCol = H.findIndex((h) => isEmail(h));
    const phoneCol = H.findIndex((h) => isPhone(h));
    const leaderCol = H.findIndex((h) => /leader|captain|role/.test(h) && !isName(h) && !isEmail(h));
    if (teamCol < 0) throw new Error('Couldn\'t find a "Team Name" column. Rename the team column to "Team Name".');
    if (nameCol < 0 && emailCol < 0) throw new Error('Couldn\'t find member "Name"/"Email" columns.');
    rows.slice(1).forEach((r, idx) => {
      const rowNo = idx + 2;
      const cell = (i) => (i < 0 ? "" : (r[i] ?? "").trim());
      const tname = cell(teamCol);
      if (!tname) { warnings.push(`Row ${rowNo}: no team name – skipped.`); return; }
      const lv = cell(leaderCol).toLowerCase();
      addMember(getTeam(tname, parseInt(cell(sizeCol), 10) || null), {
        name: cell(nameCol), email: cell(emailCol), phone: cell(phoneCol),
        leader: /^(yes|y|true|1|leader|captain|team leader)$/.test(lv),
      }, rowNo);
    });
    for (const t of teams.values()) if (t.members.length && !t.members.some((m) => m.leader)) t.members[0].leader = true;
  }

  const list = [...teams.values()].filter((t) => t.members.length);
  for (const t of list) {
    if (t.size && t.size !== t.members.length) {
      warnings.push(`Team "${t.name}": team size says ${t.size} but ${t.members.length} member(s) found.`);
    }
  }
  return {
    mode,
    headers,
    teams: list,
    warnings,
    memberCount: list.reduce((n, t) => n + t.members.length, 0),
  };
}

export function toCSV(rows) {
  return rows.map((r) => r.map((v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
}
