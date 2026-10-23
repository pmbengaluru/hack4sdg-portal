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
  // blank rows are kept (as []) so warnings can quote real spreadsheet row numbers
  return rows.map((r) => (r.some((f) => f.trim() !== "") ? r : []));
}

const norm = (h) => h.toLowerCase().replace(/[_\-.:()/]+/g, " ").replace(/\s+/g, " ").trim();
const isEmail = (h) => /e ?mail|mail id|gmail/.test(h);
const isPhone = (h) => /phone|mobile|contact|whatsapp/.test(h);
const isName = (h) => /name/.test(h);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function analyzeCSV(text) {
  const rows = parseCSV(text);
  if (!rows.slice(1).some((r) => r.length)) throw new Error("The file has no data rows.");
  const headers = rows[0].map((h) => h.trim());
  const H = headers.map(norm);
  const warnings = [];

  let teamCol = H.findIndex((h) => /team/.test(h) && /name/.test(h) && !/leader|lead|captain|member|participant/.test(h));
  if (teamCol < 0) teamCol = H.findIndex((h) => /^team( id| no| number)?$/.test(h));
  const sizeCol = H.findIndex((h) =>
    /team size|^size$|(no|number) of (team )?(members|participants)|member count|members count|team strength/.test(h));
  const collegeCol = H.findIndex((h) => /college|institut|university|school|organi[sz]ation/.test(h));

  // Numbered member slots ("Member 2 Email", "Team Member Name 3", "2nd member name"; "Team Leader Email" -> slot 0).
  // Google Forms that branch on team size repeat the same question per section ("Team Member Name 2 3"),
  // so a slot can have several columns; each row fills only one of them.
  const slots = {};
  H.forEach((h, i) => {
    if (i === teamCol || i === sizeCol || i === collegeCol) return;
    let slot = null;
    const m = h.match(/(?:member|participant|teammate|person)\s*(?:name\s*|no\s*|#\s*)?(\d+)|(\d+)\s*(?:st|nd|rd|th)?\s*(?:member|participant|teammate)/);
    if (m) slot = parseInt(m[1] ?? m[2], 10);
    else if (/leader|captain|\blead\b/.test(h)) slot = 0;
    if (slot === null) return;
    const f = isEmail(h) ? "email" : isPhone(h) ? "phone"
      : (isName(h) || /^(member|participant|teammate) ?#?\d+$/.test(h)) ? "name" : null;
    if (!f) return;
    slots[slot] ??= {};
    (slots[slot][f] ??= []).push(i);
    // "Team Member Name 1 (Leader)" is the same person as the "Team Leader ..." columns
    if (slot > 0 && /leader|captain|\blead\b/.test(h)) slots[slot].isLeader = true;
  });
  const slotKeys = Object.keys(slots).map(Number).filter((k) => slots[k].name).sort((a, b) => a - b);

  const teams = new Map();
  const seenEmails = new Map(); // email -> { team, row }
  const getTeam = (name, size, college) => {
    const key = name.toLowerCase();
    if (!teams.has(key)) teams.set(key, { name, size: size || null, college: college || "", members: [] });
    const t = teams.get(key);
    if (size && !t.size) t.size = size;
    if (college && !t.college) t.college = college;
    return t;
  };
  const addMember = (team, m, rowNo) => {
    const clean = (v) => String(v || "").replace(/[​-‏‪-‮⁦-⁩﻿]/g, "").replace(/\s+/g, " ").trim();
    m.name = clean(m.name);
    m.email = clean(m.email).toLowerCase();
    m.phone = clean(m.phone).replace(/\.0$/, ""); // Excel number cells
    if (!m.name && !m.email) return;
    if (!m.name) m.name = m.email.split("@")[0];
    if (m.email && !EMAIL_RE.test(m.email)) {
      warnings.push(`Row ${rowNo}: "${m.email}" doesn't look like an email (${m.name}).`);
    }
    const sameName = team.members.find((x) => x.name.toLowerCase() === m.name.toLowerCase());
    if (sameName && (!m.email || !sameName.email || sameName.email === m.email)) {
      sameName.email ||= m.email;
      sameName.phone ||= m.phone;
      return; // listed twice in the same team
    }
    if (m.email && seenEmails.has(m.email)) {
      const prev = seenEmails.get(m.email);
      if (prev.team !== team.name) {
        warnings.push(`Rows ${prev.row} and ${rowNo} both list ${m.email} (${m.name}), under teams "${prev.team}" and "${team.name}" – ` +
          `probably the same team submitted twice with a different name. ${m.name} was kept in "${prev.team}"; delete the wrong row from the sheet and upload again.`);
      }
      return; // same person listed twice
    }
    if (m.email) seenEmails.set(m.email, { team: team.name, row: rowNo });
    team.members.push(m);
  };

  let mode;
  if (slotKeys.length) {
    mode = "wide";
    if (teamCol < 0) warnings.push('No "Team Name" column found – teams are named after their first member.');
    const teamRow = new Map();
    rows.slice(1).forEach((r, idx) => {
      if (!r.length) return;
      const rowNo = idx + 2;
      const one = (i) => (i == null ? "" : String(r[i] ?? "").trim());
      const cell = (cols) => (cols || []).map(one).find((v) => v) || "";
      let members = slotKeys.map((k) => ({
        slot: k, name: cell(slots[k].name), email: cell(slots[k].email), phone: cell(slots[k].phone), leader: k === 0,
      })).filter((m) => m.name || m.email);
      // fold "Member 1 (Leader)" into the Team Leader entry
      const lead = members.find((m) => m.slot === 0);
      members = members.filter((m) => {
        if (!lead || m === lead || !slots[m.slot].isLeader) return true;
        lead.name ||= m.name; lead.email ||= m.email; lead.phone ||= m.phone;
        return false;
      });
      if (!members.length) return;
      if (!members.some((m) => m.leader)) members[0].leader = true;
      let tname = one(teamCol);
      if (!tname) {
        tname = `${members[0].name}'s team`;
        if (teamCol >= 0) warnings.push(`Row ${rowNo}: empty team name – using "${tname}".`);
      }
      const key = tname.toLowerCase();
      if (teamRow.has(key)) {
        // the form was submitted again for this team: keep the latest submission
        warnings.push(`Team "${tname}" was submitted twice (rows ${teamRow.get(key)} and ${rowNo}) – using row ${rowNo}.`);
        const t = teams.get(key);
        t.members.forEach((m) => m.email && seenEmails.delete(m.email));
        teams.delete(key);
      }
      teamRow.set(key, rowNo);
      const size = parseInt(one(sizeCol), 10) || null;
      const team = getTeam(tname, size, one(collegeCol));
      members.forEach(({ slot, ...m }) => addMember(team, m, rowNo));
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
      if (!r.length) return;
      const rowNo = idx + 2;
      const cell = (i) => (i < 0 ? "" : (r[i] ?? "").trim());
      const tname = cell(teamCol);
      if (!tname) { warnings.push(`Row ${rowNo}: no team name – skipped.`); return; }
      const lv = cell(leaderCol).toLowerCase();
      addMember(getTeam(tname, parseInt(cell(sizeCol), 10) || null, cell(collegeCol)), {
        name: cell(nameCol), email: cell(emailCol), phone: cell(phoneCol),
        leader: /^(yes|y|true|1|leader|captain|team leader)$/.test(lv),
      }, rowNo);
    });
  }

  const list = [...teams.values()].filter((t) => t.members.length);
  for (const t of list) {
    if (!t.members.some((m) => m.leader)) t.members[0].leader = true;
    if (!t.members.some((m) => m.email)) warnings.push(`Team "${t.name}" has no email address at all – its QR codes can't be mailed.`);
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
