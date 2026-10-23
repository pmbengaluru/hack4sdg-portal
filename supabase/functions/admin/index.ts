// Admin-only actions that need secrets: sending QR emails and managing staff logins.
// Secrets required (Dashboard -> Edge Functions -> Secrets):
//   SMTP_USER, SMTP_PASS (Gmail app password), optional SMTP_HOST, SMTP_PORT, SMTP_FROM, APP_URL
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.16";
import QRCode from "npm:qrcode@1.5.4";

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

function shell(event: string, inner: string) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
    <div style="background:#0f766e;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0;font-size:20px;font-weight:700">${esc(event)}</div>
    <div style="border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 12px 12px">${inner}</div></div>`;
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
      const png = await QRCode.toBuffer(p.token, { width: 420, margin: 2, errorCorrectionLevel: "M" });
      const message = esc(fill(s.email_message || "", vars)).replace(/\n/g, "<br>");
      const html = shell(event, `
        <p style="font-size:15px;line-height:1.55">${message}</p>
        <div style="text-align:center;margin:24px 0">
          <img src="cid:qr" width="240" height="240" alt="QR code" style="border:1px solid #e5e7eb;border-radius:8px">
          <div style="margin-top:10px;font-size:13px;color:#6b7280">Pass code: <b style="letter-spacing:2px;color:#111">${esc(p.token)}</b></div>
          <div style="font-size:13px;color:#6b7280">Team: <b style="color:#111">${esc(team)}</b></div>
        </div>`);
      await transporter.sendMail({
        from: FROM,
        to: p.email,
        subject: fill(s.email_subject || "Your event pass", vars),
        html,
        text: `${fill(s.email_message || "", vars)}\n\nPass code: ${p.token}\nTeam: ${team}`,
        attachments: [
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
  const link = APP_URL ? `<p><a href="${esc(APP_URL)}" style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open the event portal</a></p>` : "";
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `${event} – your ${role} login`,
    html: shell(event, `<p>Hi ${esc(name)},</p>
      <p>You've been added as a <b>${esc(role)}</b> for ${esc(event)}.</p>
      <p>Email: <b>${esc(email)}</b><br>Password: <b style="font-family:monospace;font-size:15px">${esc(password)}</b></p>
      ${link}<p style="color:#6b7280;font-size:13px">You can change your password after signing in.</p>`),
    text: `You've been added as a ${role} for ${event}.\nEmail: ${email}\nPassword: ${password}\n${APP_URL}`,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
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

      case "test_email": {
        const s = await getSettings();
        await transporter.sendMail({
          from: FROM,
          to: body.to || email,
          subject: `${s.event_name || "Event"} – test email`,
          html: shell(s.event_name || "Event", "<p>Email sending is working ✅</p>"),
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
