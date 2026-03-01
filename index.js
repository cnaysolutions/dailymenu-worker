require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LUMA_API_KEY = process.env.LUMA_API_KEY;

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
    body: JSON.stringify({
  prompt,
  model: "ray-2"
}),
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
async function getLumaJob(jobId) {
  const resp = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${jobId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.LUMA_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`Luma get failed: ${resp.status} ${text}`);
  return JSON.parse(text);
}
app.post("/jobs/poll", async (req, res) => {
  try {
    const { date } = req.body || {};

    // Get the menu row (latest published OR by date)
    let query = supabase
      .from("daily_menus")
      .select("id, menu_date, status, luma_jobs, media_json")
      .eq("status", "published")
      .order("menu_date", { ascending: false })
      .limit(1);

    if (date) query = query.eq("menu_date", date);

    const { data: menuRow, error } = await query.maybeSingle();
    if (error) throw error;
    if (!menuRow) return res.status(404).json({ ok: false, error: "No published menu found." });

    const jobs = menuRow.luma_jobs?.jobs;
    if (!jobs) return res.status(400).json({ ok: false, error: "luma_jobs.jobs missing. Run /jobs/start first." });

    // Poll each job
    const result = {};
    for (const dish of ["soup", "main", "salad", "side"]) {
      const jobObj = jobs[dish];
      const jobId = jobObj?.id;
      if (!jobId) {
        result[dish] = { status: "missing_job_id" };
        continue;
      }

      const info = await getLumaJob(jobId);

      // Save whole info for debugging
      result[dish] = info;
    }

    // Save poll result back to Supabase (optional but helpful)
    const { error: upErr } = await supabase
      .from("daily_menus")
      .update({
        luma_jobs: {
          ...(menuRow.luma_jobs || {}),
          last_polled_at: new Date().toISOString(),
          last_poll_result: result,
        },
      })
      .eq("id", menuRow.id);

    if (upErr) throw upErr;

    return res.json({ ok: true, menu_date: menuRow.menu_date, result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});