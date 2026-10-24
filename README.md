# HACK4SDG Event Portal

QR entry passes, check-in scanning and team judging for the hackathon.

- **Admins** import the registration CSV (members grouped under their team), view/print/download every participant's QR, email all QR codes in one click, add admins / volunteers / mentors, create checkpoints, and see results.
- **Volunteers** scan participant QR codes at *scan* checkpoints (check-in, lunch, swag…). Duplicates are flagged, and there's a manual search fallback.
- **Mentors / judges** scan any team member's QR (or pick the team) at *judging* checkpoints and grade the team against the criteria the admin set.

Stack: a static site (GitHub Pages), Supabase (Postgres + Auth + row-level security), and one Supabase Edge Function (`admin`) that sends emails over Gmail SMTP and creates staff logins.

```
index.html, css/, js/       the web app (no build step)
config.js                   Supabase URL + publishable key
supabase/schema.sql         tables, security rules, scan/import functions
supabase/functions/admin/   edge function: QR emails + staff accounts
samples/                    example CSVs in both supported layouts
```

## One-time setup

### 1. Database
Supabase Dashboard → **SQL Editor** → paste all of `supabase/schema.sql` → **Run**.

### 2. Auth settings
Dashboard → **Authentication → Sign In / Providers**:
- Email provider: **on**
- **Allow new users to sign up: off** (only admins create logins from the portal)

### 3. Gmail app password (for sending the QR emails)
On the Google account that should send the emails (e.g. pm.bengaluru@aiesecmember.in):
1. Turn on 2-Step Verification.
2. Go to <https://myaccount.google.com/apppasswords>, create an app password named "HACK4SDG", and copy the 16 characters.
   (If the option is missing, the Workspace admin has disabled app passwords. Use another Gmail account instead.)

Gmail limits: about 2,000 emails/day on Workspace and 500/day on personal Gmail. All 398 fit in one go.

### 4. Edge function
**Option A: dashboard.** Go to **Edge Functions → Deploy a new function → Via editor**, name it `admin`, paste `supabase/functions/admin/index.ts`, and deploy. Then open the function's **Details** and turn **Enforce JWT verification off**. The function checks the signed-in admin itself.

**Option B: CLI.**
```bash
npx supabase login
```
```bash
npx supabase functions deploy admin --project-ref kokdabbyzhdlwhwfxopf --no-verify-jwt
```

Then go to **Edge Functions → Secrets** and add:

| Name | Value |
|---|---|
| `SMTP_USER` | the Gmail address |
| `SMTP_PASS` | the 16-character app password |
| `SMTP_FROM` | e.g. `HACK4SDG <pm.bengaluru@aiesecmember.in>` |
| `APP_URL` | the site URL from step 6 (added to staff login emails) |

### 5. First admin
1. **Authentication → Users → Add user → Create new user**: enter your email and a password, and tick *Auto confirm*.
2. In the SQL Editor, run:
   ```sql
   insert into public.staff (email, name, role) values ('pm.bengaluru@aiesecmember.in', 'Your Name', 'admin')
   on conflict (email) do update set role = 'admin';
   ```
You add everyone else from the portal's **Staff** page.

### 6. Host the site
Push this folder to GitHub. In the repository go to **Settings → Pages → Deploy from a branch → `main` / root**. The site is served at `https://<user>.github.io/<repo>/`.
The camera scanner needs **https**, which GitHub Pages provides.

## Using it on event day

1. **Import.** Upload the Google Form responses as **.xlsx** or **.csv**. Two layouts are detected automatically:
   - one row per team, as in the Hack4SDG registration form: `College Name, Team Name, Team Leader Name, Team Leader Email ID, Team Size, Team Member Name 2, Team Member 2 Phone Number, …`.
     Forms that branch by team size repeat columns (`Team Member Name 2 3`); these are handled, and `Team Member Name 1 (Leader)` is merged with the leader.
   - one row per person: `Team Name, Name, Email, Phone, Role`

   The preview shows every team with its members before anything is saved. It warns about teams that submitted twice (the latest row is used), the same leader listed under two team names, team-size mismatches and teams with no email. Re-importing updates people and keeps their QR codes.
2. **Checkpoints.** Create each one as a **QR scan** checkpoint (volunteers) or a **Judging** checkpoint (mentors, with grading criteria and max marks). Open or close them as the day goes on.
3. **Staff.** Add admins, volunteers and mentors one at a time, or paste many as `name, email, role`. Their login details are emailed to them and also shown to you once.
4. **Send QR emails.** In **Per team** mode (the default), each team leader gets one email with every member's QR, shown inline and attached as separate images to forward. Any member with their own email is cc'd. **Per person** mode emails only people who have their own address. Click **Send to all not yet mailed**. Progress is saved, so you can stop and resume. Failed sends can be retried.
5. **Scan.** Volunteers open the site on their phone, pick the checkpoint and scan. A green screen means checked in; a yellow screen means already scanned (it shows when and by whom).
5b. **Self check-in (no volunteer scanning).** Open **Self check-in**, pick a scan checkpoint such as Check-in, switch it on, and click **Open display screen**. Put that screen on a projector or TV and press **Full screen**.
   - **On the participant's phone:** they scan the big QR, pick their team from the suggestions, type their name and tap **Check in**. This records the same attendance as a volunteer scan. They also see their table number if it's set.
   - **Stopping remote check-ins:** the QR changes every 30 seconds and a scanned link stops working after about 3 minutes, so a photo of the code shared online soon stops working.
   - **Names that can't be matched** (typos, nicknames, or a first name shared by two teammates) appear under **Needs review**. Pick the right person to check them in.
6. **Table numbers & judge assignments (optional).**
   - **Table numbers at check-in:** tick **Collect table numbers here** on the Check-in checkpoint. When a volunteer scans *anyone* from a team that has no table number, the scan screen asks for it once. Every later scan of that team shows "Table 12". Or open **Teams & QR → ✎ Table numbers**. Every team is listed with a number box: type a number and press Enter to save and jump to the next team. **Auto-number…** is there too.
   - **Settings → Assign mentors to teams**, or the switch on **Assign judges**:
     - **Off:** any mentor can judge any team.
     - **On:** each mentor can only judge the teams assigned to them. The database enforces this.
   - Assignments are separate for each judging round. On **Assign judges**, pick the round, then assign by hand:
     - **By team:** choose a mentor for each team from its dropdown.
     - **By mentor:** pick a mentor and tick their teams.
   - **Auto-assign** (collapsed, optional) shares teams out evenly, and you can still change any team by hand afterwards. You can also copy assignments from another round.
   - With assignments on, a team that has no judge in a round can only be scored by an admin.
7. **Judge.** Mentors scan any team member's QR, enter scores and comments, and save. They can edit their own scores later.
8. **Results.** The leaderboard shows each team's average across judges and per-criterion averages. You can export scores and attendance as CSV.

## Publishing changes
Run `npm run bump` before each commit that changes the site. It stamps a new version on the CSS and JS URLs and writes `version.json`. Open portals check that file and reload themselves, so no one keeps using a cached old version. GitHub Pages lets browsers cache files for 10 minutes.

Check the email function's pass renderer:
```bash
curl "https://kokdabbyzhdlwhwfxopf.supabase.co/functions/v1/admin?selftest"
```

## Local preview
```bash
npm run dev
```
Then open http://localhost:5173. The camera works on localhost too.
