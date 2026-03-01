// --- Node deps ---
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const tmp = require("tmp");

// --- App deps ---
require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

// --- ENV ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const LUMA_API_KEY = process.env.LUMA_API_KEY;

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-6";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
if (!LUMA_API_KEY) {
  throw new Error("Missing LUMA_API_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------
function assertNoForbidden(text) {
  const t = (text || "").toLowerCase();
  const forbidden = [
    // pork family
    "pork",
    "bacon",
    "ham",
    "lard",
    "prosciutto",
    "pepperoni",
    "salami",
    "pancetta",
    "domuz",
    "jambon",
    // alcohol
    "wine",
    "beer",
    "vodka",
    "whiskey",
    "rum",
    "brandy",
    "gin",
    "champagne",
    "alcohol",
  ];
  const hit = forbidden.find((w) => t.includes(w));
  if (hit) throw new Error(`Forbidden item detected: ${hit}`);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, "bin", "ffmpeg"), args, (err, stdout, stderr) => {
      if (err) return reject(new Error(`ffmpeg failed: ${stderr || err.message}`));
      resolve({ stdout, stderr });
    });
  });
}

function getStatusToUse(req) {
  return req.body?.status || "draft"; // default draft (safe)
}

// ---- Claude tool-output menu generation
async function callClaudeMenuWithTool(dateISO) {
  if (!CLAUDE_API_KEY) throw new Error("Missing CLAUDE_API_KEY in Render env vars");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2500,
      temperature: 0.7,
      tools: [
        {
          name: "submit_menu",
          description: "Submit a Muslim-friendly daily menu in strict structured JSON.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              date: { type: "string" },
              language: { type: "string", enum: ["en"] },
              rules_confirmed: {
                type: "object",
                additionalProperties: false,
                properties: {
                  no_pork: { type: "boolean" },
                  no_alcohol: { type: "boolean" },
                },
                required: ["no_pork", "no_alcohol"],
              },
              allergen_notes_en: { type: "string" },
              menu: {
                type: "object",
                additionalProperties: false,
                properties: {
                  soup: { $ref: "#/$defs/dish" },
                  main: { $ref: "#/$defs/dish" },
                  salad: { $ref: "#/$defs/dish" },
                  side: { $ref: "#/$defs/dish" },
                },
                required: ["soup", "main", "salad", "side"],
              },
            },
            required: ["date", "language", "rules_confirmed", "allergen_notes_en", "menu"],
            $defs: {
              ingredient: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  quantity: { type: "number" },
                  unit: { type: "string" },
                },
                required: ["name", "quantity", "unit"],
              },
              dish: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title_en: { type: "string" },
                  description_en: { type: "string" },
                  ingredients: { type: "array", items: { $ref: "#/$defs/ingredient" }, minItems: 3 },
                  steps: { type: "array", items: { type: "string" }, minItems: 6 },
                  serving_size_g: { type: "number" },
                  diet_tags: { type: "array", items: { type: "string" } },
                  image_prompts: { type: "array", items: { type: "string" }, minItems: 1 },
                },
                required: [
                  "title_en",
                  "description_en",
                  "ingredients",
                  "steps",
                  "serving_size_g",
                  "diet_tags",
                  "image_prompts",
                ],
              },
            },
          },
        },
      ],
      tool_choice: { type: "tool", name: "submit_menu" },
      messages: [
        {
          role: "user",
          content:
            `Generate a Muslim-friendly daily menu for date ${dateISO}. ` +
            `Hard rules: no pork, no alcohol ingredients, English only. ` +
            `Also: do NOT mention the word "pork" anywhere (not even "pork-free"). ` +
            `Return by calling the submit_menu tool.`,
        },
      ],
    }),
  });

  const raw = await resp.text();
  if (!resp.ok) throw new Error(`Claude API failed: ${resp.status} ${raw}`);

  const json = JSON.parse(raw);
  const toolUse = (json.content || []).find((c) => c.type === "tool_use" && c.name === "submit_menu");
  if (!toolUse || !toolUse.input) throw new Error("Claude did not return submit_menu tool output");

  return toolUse.input; // structured object
}

// ---- Luma
async function createLumaVideo(prompt) {
  const resp = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LUMA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, model: "ray-2" }),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`Luma create failed: ${resp.status} ${text}`);
  return JSON.parse(text);
}

async function getLumaJob(jobId) {
  const resp = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${jobId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${LUMA_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`Luma get failed: ${resp.status} ${text}`);
  return JSON.parse(text);
}

// ----------------------------------------------------
// Routes
// ----------------------------------------------------
app.get("/", (req, res) => res.json({ ok: true, service: "dailymenu-worker" }));

// Generate menu (draft)
app.post("/menu/generate", async (req, res) => {
  try {
    const dateISO = req.body?.date || new Date().toISOString().slice(0, 10);

    let menuObj = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        menuObj = await callClaudeMenuWithTool(dateISO);

        // Validate structure exists
        const menu = menuObj?.menu;
        if (!menu?.soup || !menu?.main || !menu?.salad || !menu?.side) {
          throw new Error("Claude output missing menu.soup/main/salad/side");
        }

        // Safety scan
        assertNoForbidden(JSON.stringify(menuObj));

        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        menuObj = null;
      }
    }

    if (!menuObj) {
      throw new Error(`Menu generation failed after retries: ${lastErr?.message || lastErr}`);
    }

    const { error } = await supabase
      .from("daily_menus")
      .upsert(
        {
          menu_date: dateISO,
          status: "draft",
          language: "en",
          menu_json: menuObj,
        },
        { onConflict: "menu_date" }
      );

    if (error) throw error;

    return res.json({ ok: true, menu_date: dateISO, status: "draft" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});
// Publish: draft -> published (same date)
app.post("/menu/publish", async (req, res) => {
  try {
    const dateISO = req.body?.date || new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("daily_menus")
      .update({ status: "published" })
      .eq("menu_date", dateISO)
      .eq("status", "draft")
      .select("menu_date,status")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, error: "No draft menu found for that date." });

    return res.json({ ok: true, menu_date: data.menu_date, status: data.status });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// Start Luma jobs (draft or published)
app.post("/jobs/start", async (req, res) => {
  try {
    const { date } = req.body || {};
    const statusToUse = getStatusToUse(req);

    let query = supabase
      .from("daily_menus")
      .select("id, menu_date, status, menu_json")
      .eq("status", statusToUse)
      .order("menu_date", { ascending: false })
      .limit(1);

    if (date) query = query.eq("menu_date", date);

    const { data: menuRow, error } = await query.maybeSingle();
    if (error) throw error;
    if (!menuRow) return res.status(404).json({ ok: false, error: `No ${statusToUse} menu found.` });

    // ✅ Support both shapes:
    // - menu_json = { date, ..., menu: {soup,...} }
    // - menu_json = {soup,...} (rare)
    const root = menuRow.menu_json || {};
    const menu = root.menu || root;

    if (!menu?.soup || !menu?.main || !menu?.salad || !menu?.side) {
      return res.status(400).json({ ok: false, error: "Menu structure missing soup/main/salad/side" });
    }

    const prompts = {
      soup: `Hands-only cooking video: ${menu.soup.title_en}. Close-up chopping and stirring. No faces. No narration.`,
      main: `Hands-only cooking video: ${menu.main.title_en}. Mixing, shaping, cooking, plating. No faces. No narration.`,
      salad: `Hands-only cooking video: ${menu.salad.title_en}. Chopping vegetables, mixing bowl, plating. No faces. No narration.`,
      side: `Hands-only cooking video: ${menu.side.title_en}. Rinsing, simmering, fluffing, serving. No faces. No narration.`,
    };

    const jobs = {
      soup: await createLumaVideo(prompts.soup),
      main: await createLumaVideo(prompts.main),
      salad: await createLumaVideo(prompts.salad),
      side: await createLumaVideo(prompts.side),
    };

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

    return res.json({ ok: true, status: statusToUse, menu_date: menuRow.menu_date, jobs });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// Poll Luma jobs
app.post("/jobs/poll", async (req, res) => {
  try {
    const { date } = req.body || {};
    const statusToUse = getStatusToUse(req);

    let query = supabase
      .from("daily_menus")
      .select("id, menu_date, status, luma_jobs")
      .eq("status", statusToUse)
      .order("menu_date", { ascending: false })
      .limit(1);

    if (date) query = query.eq("menu_date", date);

    const { data: menuRow, error } = await query.maybeSingle();
    if (error) throw error;
    if (!menuRow) return res.status(404).json({ ok: false, error: `No ${statusToUse} menu found.` });

    const jobs = menuRow.luma_jobs?.jobs;
    if (!jobs) return res.status(400).json({ ok: false, error: "luma_jobs.jobs missing. Run /jobs/start first." });

    const result = {};
    for (const dish of ["soup", "main", "salad", "side"]) {
      const jobId = jobs[dish]?.id;
      if (!jobId) {
        result[dish] = { state: "missing_job_id" };
        continue;
      }
      result[dish] = await getLumaJob(jobId);
    }

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

    return res.json({ ok: true, status: statusToUse, menu_date: menuRow.menu_date, result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// Attach finished Luma videos to Supabase Storage + update media_json
app.post("/jobs/attach-videos", async (req, res) => {
  try {
    const { date } = req.body || {};
    const statusToUse = getStatusToUse(req);

    let query = supabase
      .from("daily_menus")
      .select("id, menu_date, status, luma_jobs, media_json")
      .eq("status", statusToUse)
      .order("menu_date", { ascending: false })
      .limit(1);

    if (date) query = query.eq("menu_date", date);

    const { data: menuRow, error } = await query.maybeSingle();
    if (error) throw error;
    if (!menuRow) return res.status(404).json({ ok: false, error: `No ${statusToUse} menu found.` });

    const poll = menuRow.luma_jobs?.last_poll_result;
    if (!poll) return res.status(400).json({ ok: false, error: "No last_poll_result found. Run /jobs/poll first." });

    const menuDate = menuRow.menu_date;
    const bucket = "menu-media";
    const updatedMedia = menuRow.media_json || {};
    const uploaded = {};

    for (const dish of ["soup", "main", "salad", "side"]) {
      const info = poll[dish];
      const state = info?.state;
      const videoUrl = info?.assets?.video;

      if (state !== "completed" || !videoUrl) {
        uploaded[dish] = { skipped: true, state, videoUrl: videoUrl || null };
        continue;
      }

      const r = await fetch(videoUrl);
      if (!r.ok) {
        uploaded[dish] = { error: `Download failed ${r.status}` };
        continue;
      }

      const bytes = new Uint8Array(await r.arrayBuffer());
      const storagePath = `${menuDate}/${dish}/final.mp4`;

      const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, bytes, {
        contentType: "video/mp4",
        upsert: true,
      });

      if (upErr) {
        uploaded[dish] = { error: `Upload failed: ${upErr.message}` };
        continue;
      }

      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storagePath);
      const publicUrl = pub.publicUrl;

      updatedMedia[dish] = updatedMedia[dish] || {};
      updatedMedia[dish].video = publicUrl;

      uploaded[dish] = { ok: true, publicUrl };
    }

    const { error: saveErr } = await supabase
      .from("daily_menus")
      .update({ media_json: updatedMedia })
      .eq("id", menuRow.id);

    if (saveErr) throw saveErr;

    return res.json({ ok: true, status: statusToUse, menu_date: menuDate, uploaded });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// Bake music into MP4 and update media_json videos to final_music.mp4
app.post("/jobs/mix-music", async (req, res) => {
  try {
    const { date, lang } = req.body || {};
    const useLang = lang || "tr";
    const statusToUse = getStatusToUse(req);

    let query = supabase
      .from("daily_menus")
      .select("id, menu_date, status, media_json, music_json")
      .eq("status", statusToUse)
      .order("menu_date", { ascending: false })
      .limit(1);

    if (date) query = query.eq("menu_date", date);

    const { data: menuRow, error } = await query.maybeSingle();
    if (error) throw error;
    if (!menuRow) return res.status(404).json({ ok: false, error: `No ${statusToUse} menu found.` });

    const menuDate = menuRow.menu_date;
    const media = menuRow.media_json || {};
    const musicUrl = menuRow.music_json?.[useLang];
    if (!musicUrl) return res.status(400).json({ ok: false, error: `music_json.${useLang} missing` });

    const bucket = "menu-media";
    const results = {};

    for (const dish of ["soup", "main", "salad", "side"]) {
      const videoUrl = media?.[dish]?.video;
      if (!videoUrl) {
        results[dish] = { skipped: true, reason: "no videoUrl in media_json" };
        continue;
      }

      const tmpDir = tmp.dirSync({ unsafeCleanup: true });
      const inVideo = path.join(tmpDir.name, "in.mp4");
      const inMusic = path.join(tmpDir.name, "music.mp3");
      const outVideo = path.join(tmpDir.name, "out.mp4");

      const vr = await fetch(videoUrl);
      if (!vr.ok) {
        results[dish] = { error: `Video download failed ${vr.status}` };
        tmpDir.removeCallback();
        continue;
      }
      fs.writeFileSync(inVideo, Buffer.from(await vr.arrayBuffer()));

      const mr = await fetch(musicUrl);
      if (!mr.ok) {
        results[dish] = { error: `Music download failed ${mr.status}` };
        tmpDir.removeCallback();
        continue;
      }
      fs.writeFileSync(inMusic, Buffer.from(await mr.arrayBuffer()));

      const ffArgs = [
        "-y",
        "-i",
        inVideo,
        "-stream_loop",
        "-1",
        "-i",
        inMusic,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        outVideo,
      ];

      await runFfmpeg(ffArgs);

      const outBytes = fs.readFileSync(outVideo);
      const outPath = `${menuDate}/${dish}/final_music.mp4`;

      const { error: upErr } = await supabase.storage.from(bucket).upload(outPath, outBytes, {
        contentType: "video/mp4",
        upsert: true,
      });

      if (upErr) {
        results[dish] = { error: `Upload failed: ${upErr.message}` };
        tmpDir.removeCallback();
        continue;
      }

      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(outPath);
      const publicUrl = pub.publicUrl;

      media[dish] = media[dish] || {};
      media[dish].video = publicUrl;

      results[dish] = { ok: true, publicUrl };
      tmpDir.removeCallback();
    }

    const { error: saveErr } = await supabase
      .from("daily_menus")
      .update({ media_json: media })
      .eq("id", menuRow.id);

    if (saveErr) throw saveErr;

    return res.json({ ok: true, status: statusToUse, menu_date: menuDate, lang: useLang, results });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// ----------------------------------------------------
const port = process.env.PORT || 3001;
app.listen(port, "0.0.0.0", () => console.log(`Worker listening on ${port}`));