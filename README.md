# Evaluation Form + Certificates

A small web app for event evaluations, like a Google Form — but every participant gets their certificate **right after they submit**.

- **Participants** open the link you share (e.g. `https://your-app.up.railway.app/f/project-77-evaluation`), answer the evaluation, and instantly see and download their certificate (image or PDF). They also get a personal certificate link to download it again later.
- **Admins** sign in at `/admin` to edit everything: title, description, questions, email rules, certificate design, name font/size/color/position, thank-you message — and to view responses, see rating averages with interpretation, export CSV for Excel, fix misspelled names, and download all certificates as one PDF for printing.

The first form (“Project 77: Let Go, Let God” Evaluation Form) is already set up with the questions from your Google Form and your certificate (with “Student Name” removed so each participant's name can be printed on it).

No npm packages are needed. It runs on Node.js 22.13 or newer and stores everything in one SQLite file.

---

## Deploy on Railway (recommended)

1. Put this folder in a GitHub repository (upload the files, or `git init && git add . && git commit -m "init"` and push).
2. In Railway: **New Project → Deploy from GitHub repo** → pick the repo. Railway finds the `Dockerfile` and builds it.
3. **Add a Volume** to the service and set its mount path to **`/data`**.
   ⚠️ Without a volume, all forms and responses are erased on every redeploy.
4. Open the service's **Variables** and add:
   | Variable | Value |
   |---|---|
   | `ADMIN_USERNAME` | the admin username you want (default `admin`) |
   | `ADMIN_PASSWORD` | a strong password (used only on the very first start) |
   | `TIMEZONE` | optional, default `Asia/Manila` (used for CSV timestamps) |
5. **Settings → Networking → Generate Domain**.
6. Open `https://<your-domain>/admin` and sign in.

If you skip `ADMIN_PASSWORD`, the first login is `admin` / `admin123` and the app will ask you to change it — do that immediately.

Other hosts work the same way (Render, Fly.io, a VPS): run the Dockerfile, mount persistent storage at `/data`, expose port `3000` (or set `PORT`).

## Run on your own computer

```bash
node --version        # must be 22.13 or newer
npm start             # then open http://localhost:3000/admin
```

Data is saved in `./data/app.db`.

---

## Using it

**Share the form:** Admin → open the form → **Share**. Copy the link or download the QR code to show at the venue.

**Certificate tab**
- Upload your certificate design **without a name on it** (PNG/JPG, landscape, 2000 px wide or more).
- Drag the sample name on the preview to position it; adjust font, color, size and maximum width. Long names shrink automatically to fit.
- Choose one of the built-in script/serif fonts, or upload the exact font file (.ttf/.otf/.woff) from your design.
- *Name capitalization → Auto-fix* turns “JUAN DELA CRUZ” or “juan dela cruz” into “Juan Dela Cruz” (keeps suffixes like III).
- Use **Test image / Test PDF** to check the result, then **Save changes**.

**Settings tab**
- Close or reopen the form (certificate links keep working when closed).
- *Allowed email domains*: e.g. `g.batstate-u.edu.ph` to accept only BatState-U G-Suite accounts.
- *One response per email* prevents duplicate submissions.
- Theme color, thank-you message, closed message, optional consent checkbox.
- **Duplicate for a new event** copies questions, certificate and settings (not responses).

**Responses tab**
- Total responses, mean per rating question and overall, with the 5-point interpretation (Outstanding → Poor).
- **Export CSV (Excel)**, **All certificates (PDF)** (one page per participant, A–Z), per-person certificate download/link, fix a name, delete.

**Preview:** the eye icon opens the form in preview mode — submissions there are not saved, so you can test the certificate safely.

## Backups

Download everything any time with **Export CSV**. For a full backup, copy `/data/app.db` from the volume.

## Files

```
server.js          web server + API
lib/forms.js       default questions, validation
lib/store.js       SQLite storage (node:sqlite)
lib/sniff.js       checks uploaded images/fonts
public/            pages, styles and browser code (form, certificate, admin)
seed/              your blank certificate, loaded on first start
Dockerfile
```
