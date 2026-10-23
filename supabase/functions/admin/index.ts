// Admin-only actions that need secrets: sending QR emails and managing staff logins.
// Secrets required (Dashboard -> Edge Functions -> Secrets):
//   SMTP_USER, SMTP_PASS (Gmail app password), optional SMTP_HOST, SMTP_PORT, SMTP_FROM, APP_URL
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.16";
import QRCode from "npm:qrcode@1.5.4";
import { PNG } from "npm:pngjs@7.0.0";
import { Buffer } from "node:buffer";
import { BADGE_PNG_B64, LOGO_JPG_B64 } from "./logo.ts";
import { JAKARTA_600, JAKARTA_800, MONO_700 } from "./fonts.ts";
import { passSvg } from "./pass.ts";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? 465);
const transporter = nodemailer.createTransport({
  host: Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com",
  port: smtpPort,
  secure: smtpPort === 465,
  auth: { user: Deno.env.get("SMTP_USER"), pass: Deno.env.get("SMTP_PASS") },
});
const FROM = Deno.env.get("SMTP_FROM") ?? Deno.env.get("SMTP_USER");
const APP_URL = Deno.env.get("APP_URL") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function getSettings() {
  const { data } = await db.from("settings").select("key,value");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value ?? ""]));
}

// Inline logo used in every email header (<img src="cid:logo">)
const LOGO_ATTACHMENT = { filename: "hack4sdg.jpg", content: Buffer.from(LOGO_JPG_B64, "base64"), cid: "logo" };
const SDG_STRIP = ["#E5243B", "#DDA63A", "#4C9F38", "#C5192D", "#FF3A21", "#26BDE2", "#FCC30B", "#A21942", "#FD6925",
  "#DD1367", "#FD9D24", "#BF8B2E", "#3F7E44", "#0A97D9", "#56C02B", "#00689D", "#19486A"]
  .map((c) => `<td style="background:${c};height:6px;font-size:0;line-height:0">&nbsp;</td>`).join("");

function shell(event: string, inner: string) {
  return `<div style="background:#f3f5f9;padding:24px 12px;font-family:'Segoe UI',Arial,sans-serif;color:#1f2937">
    <div style="max-width:580px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(20,27,58,.08)">
      <table role="presentation" style="width:100%;border-collapse:collapse"><tr>${SDG_STRIP}</tr></table>
      <div style="text-align:center;padding:22px 24px 6px"><img src="cid:logo" alt="${esc(event)}" width="200" style="max-width:200px;height:auto"></div>
      <div style="padding:8px 28px 28px">${inner}</div>
      <div style="background:#141b3a;color:#cbd5e1;text-align:center;font-size:12px;padding:12px">${esc(event)} · Ideas today, impact tomorrow</div>
    </div></div>`;
}

// QR PNG with the HACK4SDG badge in the centre. Error correction "H" recovers 30% of the code;
// the badge covers far less than that.
const BADGE = PNG.sync.read(Buffer.from(BADGE_PNG_B64, "base64"));
function qrPng(text: string): Buffer {
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  const n = qr.modules.size, mods = qr.modules.data, margin = 4;
  const scale = Math.max(6, Math.floor(440 / (n + margin * 2)));
  const W = (n + margin * 2) * scale;
  const png = new PNG({ width: W, height: W });
  png.data.fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!mods[r * n + c]) continue;
      for (let y = 0; y < scale; y++) {
        const row = ((r + margin) * scale + y) * W;
        for (let x = 0; x < scale; x++) {
          const i = (row + (c + margin) * scale + x) * 4;
          png.data[i] = 20; png.data[i + 1] = 27; png.data[i + 2] = 58; // brand navy
        }
      }
    }
  }
  if (BADGE.width <= n * scale * 0.3) {
    const off = Math.floor((W - BADGE.width) / 2);
    for (let y = 0; y < BADGE.height; y++) {
      for (let x = 0; x < BADGE.width; x++) {
        const s = (y * BADGE.width + x) * 4, a = BADGE.data[s + 3] / 255;
        if (!a) continue;
        const d = ((off + y) * W + off + x) * 4;
        for (let k = 0; k < 3; k++) png.data[d + k] = Math.round(BADGE.data[s + k] * a + png.data[d + k] * (1 - a));
      }
    }
  }
  return PNG.sync.write(png);
}

// Full pass image (logo QR + name + pass code + team). The SVG renderer loads once per function instance;
// if it can't load, the plain logo QR is sent instead so emails still go out.
const RESVG_WASM = "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";
const FONT_BUFFERS = [JAKARTA_800, JAKARTA_600, MONO_700].map((b) => new Uint8Array(Buffer.from(b, "base64")));
let resvgReady: Promise<boolean> | null = null;
let selftest: Promise<Record<string, unknown>> | null = null;
function ensureResvg() {
  resvgReady ??= initWasm(fetch(RESVG_WASM)).then(() => true, (e) => {
    console.error("resvg init failed", e);
    resvgReady = null;
    return false;
  });
  return resvgReady;
}
async function passPng(token: string, name: string, team: string): Promise<Buffer> {
  const qr = qrPng(token);
  if (!(await ensureResvg())) return qr;
  try {
    const svg = passSvg(qr.toString("base64"), qr.readUInt32BE(16), name, token, team);
    const png = new Resvg(svg, { font: { fontBuffers: FONT_BUFFERS, loadSystemFonts: false, defaultFontFamily: "Plus Jakarta Sans" } })
      .render().asPng();
    return Buffer.from(png);
  } catch (e) {
    console.error("pass render failed", e);
    return qr;
  }
}

async function sendQr(ids: number[]) {
  const s = await getSettings();
  const event = s.event_name || "Hackathon";
  const { data: people, error } = await db
    .from("participants")
    .select("id,name,email,token,teams(name)")
    .in("id", ids);
  if (error) throw error;

  const results = [];
  for (const p of people ?? []) {
    if (!p.email) {
      results.push({ id: p.id, ok: false, error: "No email address" });
      continue;
    }
    try {
      const team = (p as any).teams?.name ?? "";
      const vars = { name: p.name, team, event, code: p.token };
      const png = await passPng(p.token, p.name, team);
      const message = esc(fill(s.email_message || "", vars)).replace(/\n/g, "<br>");
      const html = shell(event, `
        <p style="font-size:15px;line-height:1.55">${message}</p>
        <div style="text-align:center;margin:24px 0">
          <img src="cid:qr" width="260" alt="QR pass for ${esc(p.name)} – code ${esc(p.token)}" style="width:260px;max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:12px">
        </div>`);
      await transporter.sendMail({
        from: FROM,
        to: p.email,
        subject: fill(s.email_subject || "Your event pass", vars),
        html,
        text: `${fill(s.email_message || "", vars)}\n\nPass code: ${p.token}\nTeam: ${team}`,
        attachments: [
          LOGO_ATTACHMENT,
          { filename: "qr.png", content: png, cid: "qr" },
          { filename: `${p.name.replace(/[^\w]+/g, "_")}_QR.png`, content: png },
        ],
      });
      await db.from("participants")
        .update({ email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null })
        .eq("id", p.id);
      results.push({ id: p.id, ok: true });
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 300);
      await db.from("participants").update({ email_status: "failed", email_error: msg }).eq("id", p.id);
      results.push({ id: p.id, ok: false, error: msg });
    }
  }
  return results;
}

// One email per team to the leader (cc any other member with an email) carrying every member's QR.
// Used when the registration form only collected the leader's email.
async function sendTeams(teamIds: number[]) {
  const s = await getSettings();
  const event = s.event_name || "Hackathon";
  const { data: teams, error } = await db
    .from("teams")
    .select("id,name,participants(id,name,email,token,is_leader)")
    .in("id", teamIds);
  if (error) throw error;

  const results = [];
  for (const t of teams ?? []) {
    const members = [...(t.participants ?? [])].sort((a, b) => Number(b.is_leader) - Number(a.is_leader) || a.name.localeCompare(b.name));
    const ids = members.map((m) => m.id);
    const lead = members.find((m) => m.is_leader && m.email) ?? members.find((m) => m.email);
    if (!lead) {
      await db.from("participants").update({ email_status: "failed", email_error: "No email address in team" }).in("id", ids);
      results.push({ team_id: t.id, ok: false, error: "No email address in team" });
      continue;
    }
    try {
      const cc = [...new Set(members.map((m) => m.email).filter((e) => e && e !== lead.email))];
      const vars = { name: lead.name, team: t.name, event, code: lead.token };
      const attachments: { filename: string; content: Uint8Array; cid?: string }[] = [LOGO_ATTACHMENT];
      const blocks: string[] = [];
      for (const [i, m] of members.entries()) {
        const png = await passPng(m.token, m.name, t.name);
        attachments.push({ filename: `qr${i}.png`, content: png, cid: `qr${i}` });
        attachments.push({ filename: `${m.name.replace(/[^\w]+/g, "_")}_QR.png`, content: png });
        blocks.push(`<td style="text-align:center;padding:10px;vertical-align:top;width:50%">
          <img src="cid:qr${i}" width="200" alt="QR pass for ${esc(m.name)} – code ${esc(m.token)}" style="width:200px;max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:12px">
          ${m.is_leader ? '<div style="font-size:12px;color:#6b7280;margin-top:4px">Team leader</div>' : ""}</td>`);
      }
      const rows = [];
      for (let i = 0; i < blocks.length; i += 2) rows.push(`<tr>${blocks[i]}${blocks[i + 1] ?? "<td></td>"}</tr>`);
      const message = esc(fill(s.email_message || "", vars)).replace(/\n/g, "<br>");
      const html = shell(event, `
        <p style="font-size:15px;line-height:1.55">${message}</p>
        <p style="font-size:14px;background:#fef3c7;color:#92400e;padding:10px 12px;border-radius:8px">
          This email has the entry QR codes for all <b>${members.length}</b> members of <b>${esc(t.name)}</b>.
          <b>Every member must show their own QR</b> – please forward each person their image (also attached separately below).</p>
        <table style="width:100%;border-collapse:collapse">${rows.join("")}</table>`);
      await transporter.sendMail({
        from: FROM,
        to: lead.email,
        cc: cc.length ? cc : undefined,
        subject: fill(s.email_subject || "Your event passes", vars),
        html,
        text: `${fill(s.email_message || "", vars)}\n\nQR pass codes for ${t.name}:\n` +
          members.map((m) => `- ${m.name}: ${m.token}`).join("\n"),
        attachments,
      });
      await db.from("participants")
        .update({ email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null })
        .in("id", ids);
      results.push({ team_id: t.id, ok: true, to: lead.email, count: members.length });
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 300);
      await db.from("participants").update({ email_status: "failed", email_error: msg }).in("id", ids);
      results.push({ team_id: t.id, ok: false, error: msg });
    }
  }
  return results;
}

async function findAuthUser(email: string) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function mailCredentials(name: string, email: string, role: string, password: string) {
  const s = await getSettings();
  const event = s.event_name || "Hackathon";
  const link = APP_URL ? `<p><a href="${esc(APP_URL)}" style="background:#1f78c1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open the event portal</a></p>` : "";
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `${event} – your ${role} login`,
    html: shell(event, `<p>Hi ${esc(name)},</p>
      <p>You've been added as a <b>${esc(role)}</b> for ${esc(event)}.</p>
      <p>Email: <b>${esc(email)}</b><br>Password: <b style="font-family:monospace;font-size:15px">${esc(password)}</b></p>
      ${link}<p style="color:#6b7280;font-size:13px">You can change your password after signing in.</p>`),
    text: `You've been added as a ${role} for ${event}.\nEmail: ${email}\nPassword: ${password}\n${APP_URL}`,
    attachments: [LOGO_ATTACHMENT],
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // Unauthenticated health check: renders one sample pass (no data involved), cached per instance.
  if (new URL(req.url).searchParams.has("selftest")) {
    selftest ??= passPng("SAMPLE12CODE", "Sample Name", "Sample team").then(async (png) => ({
      renderer: (await ensureResvg()) && png.readUInt32BE(20) > png.readUInt32BE(16) ? "full pass" : "plain QR fallback",
      width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length,
    }));
    return json(await selftest);
  }
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(jwt);
    const email = auth?.user?.email?.toLowerCase();
    if (!email) return json({ error: "Not signed in" }, 401);
    const { data: me } = await db.from("staff").select("role,name").eq("email", email).maybeSingle();
    if (me?.role !== "admin") return json({ error: "Admins only" }, 403);

    const body = await req.json();
    switch (body.action) {
      case "send_qr": {
        const ids = (body.ids ?? []).slice(0, 25).map(Number);
        return json({ results: await sendQr(ids) });
      }

      case "send_team": {
        const ids = (body.team_ids ?? []).slice(0, 5).map(Number);
        return json({ results: await sendTeams(ids) });
      }

      case "test_email": {
        const s = await getSettings();
        await transporter.sendMail({
          from: FROM,
          to: body.to || email,
          subject: `${s.event_name || "Event"} – test email`,
          html: shell(s.event_name || "Event", `<p style="text-align:center">Email sending is working ✅</p>
            <div style="text-align:center"><img src="cid:qr" width="240" alt="Sample QR pass" style="width:240px;max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:12px">
            <div style="font-size:12px;color:#6b7280">Sample QR – this is how passes will look</div></div>`),
          attachments: [LOGO_ATTACHMENT, { filename: "sample.png", content: await passPng("SAMPLE12CODE", me.name || "Your Name", "Sample team"), cid: "qr" }],
        });
        return json({ ok: true });
      }

      case "create_staff": {
        const name = String(body.name ?? "").trim();
        const target = String(body.email ?? "").trim().toLowerCase();
        const role = String(body.role ?? "");
        if (!name || !target.includes("@") || !["admin", "volunteer", "mentor"].includes(role)) {
          return json({ error: "Name, valid email and role are required" }, 400);
        }
        const password = randomPassword();
        let user = await findAuthUser(target);
        if (user) {
          const { error } = await db.auth.admin.updateUserById(user.id, { password, email_confirm: true });
          if (error) throw error;
        } else {
          const { data, error } = await db.auth.admin.createUser({ email: target, password, email_confirm: true });
          if (error) throw error;
          user = data.user;
        }
        const { error: se } = await db.from("staff")
          .upsert({ email: target, name, role, user_id: user!.id }, { onConflict: "email" });
        if (se) throw se;
        let mailed = false, mailError = null;
        if (body.notify) {
          try { await mailCredentials(name, target, role, password); mailed = true; }
          catch (e) { mailError = String((e as Error).message ?? e); }
        }
        return json({ ok: true, password, mailed, mailError });
      }

      case "reset_password": {
        const target = String(body.email ?? "").toLowerCase();
        const { data: st } = await db.from("staff").select("name,role").eq("email", target).maybeSingle();
        const user = await findAuthUser(target);
        if (!st || !user) return json({ error: "Staff member not found" }, 404);
        const password = randomPassword();
        const { error } = await db.auth.admin.updateUserById(user.id, { password });
        if (error) throw error;
        let mailed = false, mailError = null;
        if (body.notify) {
          try { await mailCredentials(st.name, target, st.role, password); mailed = true; }
          catch (e) { mailError = String((e as Error).message ?? e); }
        }
        return json({ ok: true, password, mailed, mailError });
      }

      case "delete_staff": {
        const target = String(body.email ?? "").toLowerCase();
        if (target === email) return json({ error: "You can't remove yourself" }, 400);
        await db.from("staff").delete().eq("email", target);
        const user = await findAuthUser(target);
        if (user) await db.auth.admin.deleteUser(user.id);
        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
