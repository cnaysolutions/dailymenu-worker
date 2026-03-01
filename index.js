require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.https://hwuhwqmixioehvshmila.supabase.co;
const SUPABASE_SERVICE_ROLE_KEY = process.env.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3dWh3cW1peGlvZWh2c2htaWxhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjE3NjYyNywiZXhwIjoyMDg3NzUyNjI3fQ._whRwVn2macEGX1TS0tZuxPtYWhzMhm5sbcmmX3ZUK0;
const LUMA_API_KEY = process.env.luma-2f7dd6ab-91ae-4848-8b32-784052186974-e2721181-78c3-4a07-b1be-40995d0d63df;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
if (!LUMA_API_KEY) {
  throw new Error("Missing LUMA_API_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ✅ REAL Luma create call (Step 5)
async function createLumaVideo(prompt) {
  const resp = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LUMA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`Luma create failed: ${resp.status} ${text}`);

  return JSON.parse(text);
}

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true, service: "dailymenu-worker" });
});

// POST /jobs/start  (creates REAL Luma jobs in DB)
app.post("/jobs/start", async (req, res) => {
  try {
    const { date } = req.body || {};

    let query = supabase
      .from("daily_menus")
      .select("id, menu_date, status, menu_json, media_json, music_json")
      .eq("status", "published")
      .order("menu_date", { ascending: false })
      .limit(1);

    if (date) query = query.eq("menu_date", date);

    const { data: menuRow, error } = await query.maybeSingle();
    if (error) throw error;
    if (!menuRow) return res.status(404).json({ ok: false, error: "No published menu found." });

    const menu = menuRow.menu_json?.menu;
    if (!menu) return res.status(400).json({ ok: false, error: "menu_json.menu missing" });

    // Hands-only prompts
    const prompts = {
      soup: `Hands-only cooking video: ${menu.soup.title_en}. Close-up chopping and stirring. No faces. No narration.`,
      main: `Hands-only cooking video: ${menu.main.title_en}. Mixing, shaping, cooking, plating. No faces. No narration.`,
      salad: `Hands-only cooking video: ${menu.salad.title_en}. Chopping vegetables, mixing bowl, plating. No faces. No narration.`,
      side: `Hands-only cooking video: ${menu.side.title_en}. Rinsing, simmering, fluffing, serving. No faces. No narration.`,
    };

    // ✅ Step 5.3: REPLACE placeholder jobs with real Luma jobs
    const jobs = {
      soup: await createLumaVideo(prompts.soup),
      main: await createLumaVideo(prompts.main),
      salad: await createLumaVideo(prompts.salad),
      side: await createLumaVideo(prompts.side),
    };

    // Save job info into Supabase
    const { error: upErr } = await supabase
      .from("daily_menus")
      .update({
        job_status: "generating",
        luma_jobs: {
          created_at: new Date().toISOString(),
          provider: "luma",
          prompts,
          jobs,
        },
      })
      .eq("id", menuRow.id);

    if (upErr) throw upErr;

    return res.json({
      ok: true,
      menu_date: menuRow.menu_date,
      message: "Created REAL Luma jobs and saved to Supabase.",
      jobs,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, "0.0.0.0", () => console.log(`Worker listening on ${port}`));