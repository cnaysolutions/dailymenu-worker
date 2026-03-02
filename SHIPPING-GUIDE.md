# 🚀 DailyMenuForAll — Shipping Guide

## Do These Steps IN ORDER

---

### Step 1: Sign up for Replicate (if not done yet)
1. Go to https://replicate.com → Sign up
2. Go to https://replicate.com/account/api-tokens → Create token
3. Save the token (starts with `r8_...`)

---

### Step 2: Run Supabase SQL Setup
1. Go to your Supabase Dashboard → SQL Editor
2. Paste the contents of `supabase-setup.sql` (included in this package)
3. Click "Run"
4. Verify: you should see the `daily_menus` table columns listed

Also verify storage:
1. Go to Storage → check `menu-media` bucket exists and is PUBLIC
2. Go to Storage → check `menu-music` bucket exists and is PUBLIC
3. If either doesn't exist, create it (toggle "Public bucket" ON)

---

### Step 3: Update Worker GitHub Repo
Replace ALL files in your `cnaysolutions/dailymenu-worker` repo with:
- `index.js` (the new one — completely rewritten)
- `package.json` (updated — added node-cron, removed unused deps)
- `render-build.sh` (simplified — no ffmpeg needed for V1)
- `.env.example` (for reference)
- `.gitignore`

You can do this by:
```bash
# Clone your repo locally
git clone https://github.com/cnaysolutions/dailymenu-worker.git
cd dailymenu-worker

# Delete old files
rm -f index.js package.json render-build.sh

# Copy in the new files (from the package I gave you)
# Then commit and push:
git add -A
git commit -m "V1.1: Flux images, bilingual EN+TR, cron, no video"
git push
```

---

### Step 4: Set Render Environment Variables for Worker
Go to Render Dashboard → your dailymenu-worker service → Environment

Add/update these variables:
```
SUPABASE_URL          = https://hwuhwqmixioehvshmila.supabase.co
SUPABASE_SERVICE_ROLE_KEY = (your service role key from Supabase → Settings → API)
CLAUDE_API_KEY        = sk-ant-... (your Anthropic key)
CLAUDE_MODEL          = claude-sonnet-4-5-20250929
REPLICATE_API_TOKEN   = r8_... (from Step 1)
WORKER_API_KEY        = (generate a random string, e.g. run: openssl rand -hex 32)
CRON_SCHEDULE         = 0 5 * * *
ENABLE_CRON           = true
```

Render settings:
- Build Command: `bash render-build.sh`
- Start Command: `npm start`

---

### Step 5: Update Frontend GitHub Repo
Replace these files in your `cnaysolutions/dailymenuforall` repo:
- `app/page.tsx` (completely rewritten — bilingual, beautiful design)
- `app/globals.css` (new warm food-themed design)
- `app/layout.tsx` (proper SEO metadata)
- `next.config.ts` (added Replicate image domains)

```bash
git clone https://github.com/cnaysolutions/dailymenuforall.git
cd dailymenuforall

# Replace the files, then:
git add -A
git commit -m "V1.1: Bilingual design, Flux image support, SEO"
git push
```

---

### Step 6: Set Render Environment Variables for Frontend
Go to Render → your dailymenuforall service → Environment:
```
NEXT_PUBLIC_SUPABASE_URL      = https://hwuhwqmixioehvshmila.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = (your anon key from Supabase → Settings → API)
```

Render settings:
- Build Command: `npm run build`
- Start Command: `npm start`

---

### Step 7: Deploy Both Services
1. Push both repos → Render auto-deploys (or trigger manual deploy)
2. Wait for both to finish building
3. Check worker health: visit `https://your-worker-url.onrender.com/`
   - Should return: `{"ok":true,"service":"dailymenu-worker","version":"1.0.0"}`

---

### Step 8: Test the Pipeline! 🎉
Run your first menu generation:

```bash
# Replace with your actual worker URL and API key
WORKER_URL="https://your-worker-url.onrender.com"
API_KEY="your-worker-api-key"

# Generate today's menu (takes ~30 seconds)
curl -X POST "$WORKER_URL/pipeline/run" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"date": "2026-03-02"}'
```

Expected response:
```json
{
  "ok": true,
  "menu_date": "2026-03-02",
  "status": "published",
  "main_dish": "Lamb Kofta with Yogurt Sauce",
  "images": {
    "soup": {"ok": true, "url": "..."},
    "main": {"ok": true, "url": "..."},
    "salad": {"ok": true, "url": "..."},
    "side": {"ok": true, "url": "..."}
  }
}
```

Then visit your frontend URL — you should see the beautiful menu with images!

---

### Step 9: Verify Cron
The worker will auto-generate a new menu every day at 5:00 AM UTC.
Check the Render logs next morning to verify it ran.

To change the time, update `CRON_SCHEDULE` in Render env vars.
Examples:
- `0 5 * * *` = 5:00 AM UTC (8:00 AM Turkey time)
- `0 4 * * *` = 4:00 AM UTC (7:00 AM Turkey time)
- `30 6 * * *` = 6:30 AM UTC

---

## What's Next (V2 features)
- [ ] Add Luma video generation back
- [ ] Mix background music into videos
- [ ] Multi-language toggle on frontend (EN/TR switch)
- [ ] Admin dashboard to preview/edit before publishing
- [ ] Custom domain + SSL
- [ ] Email/push notifications when menu is ready
- [ ] Recipe detail pages with full cooking steps
