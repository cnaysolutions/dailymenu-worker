// ============================================================
// DailyMenu Worker — V1 (Images + Music, No Video)
// ============================================================
const fs = require("fs");
const path = require("path");

require("dotenv").config();
const express = require("express");
const cron = require("node-cron");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

// ---- ENV ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const WORKER_API_KEY = process.env.WORKER_API_KEY; // simple auth
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 5 * * *"; // 5:00 AM daily

// ---- Validate required env ----
const required = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLAUDE_API_KEY, REPLICATE_API_TOKEN };
for (const [key, val] of Object.entries(required)) {
  if (!val) throw new Error(`Missing required env var: ${key}`);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================
// Auth middleware
// ============================================================
function authMiddleware(req, res, next) {
  // Skip auth for health check
  if (req.path === "/") return next();
  // Skip auth for cron (internal calls)
  if (req.headers["x-cron-internal"] === "true" && req.ip === "127.0.0.1") return next();

  if (!WORKER_API_KEY) return next(); // no key set = no auth (dev mode)

  const provided = req.headers["x-api-key"];
  if (provided !== WORKER_API_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}
app.use(authMiddleware);

// ============================================================
// Helpers
// ============================================================
const FORBIDDEN = [
  // pork
  "pork", "bacon", "ham", "lard", "prosciutto", "pepperoni", "salami",
  "pancetta", "domuz", "jambon",
  // alcohol
  "wine", "beer", "vodka", "whiskey", "rum", "brandy", "gin",
  "champagne", "alcohol", "şarap", "bira", "rakı", "viski",
];

function assertNoForbidden(menuObj) {
  // Only scan actual dish content (titles, descriptions, ingredients)
  // NOT the rules_confirmed or allergen_notes which naturally mention "pork"
  const menu = menuObj?.menu;
  if (!menu) return;

  for (const dish of ["soup", "main", "salad", "side"]) {
    const d = menu[dish];
    if (!d) continue;
    const parts = [
      d.title_en, d.title_tr,
      d.description_en, d.description_tr,
      ...(d.ingredients || []).map((i) => `${i.name_en} ${i.name_tr}`),
    ];
    const text = parts.join(" ").toLowerCase();
    // Use word boundary matching to avoid false positives (e.g. "drumstick" matching "rum")
    const hit = FORBIDDEN.find((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
    if (hit) throw new Error(`Forbidden item in ${dish}: ${hit}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================
// Claude Menu Generation (EN + TR bilingual)
// ============================================================
async function callClaudeMenu(dateISO) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      temperature: 0.7,
      tools: [
        {
          name: "submit_menu",
          description:
            "Submit a Muslim-friendly daily menu with both English and Turkish translations.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              date: { type: "string" },
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
              allergen_notes_tr: { type: "string" },
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
            required: ["date", "rules_confirmed", "allergen_notes_en", "allergen_notes_tr", "menu"],
            $defs: {
              ingredient: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name_en: { type: "string" },
                  name_tr: { type: "string" },
                  quantity: { type: "number" },
                  unit: { type: "string" },
                },
                required: ["name_en", "name_tr", "quantity", "unit"],
              },
              dish: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title_en: { type: "string" },
                  title_tr: { type: "string" },
                  description_en: { type: "string" },
                  description_tr: { type: "string" },
                  ingredients: {
                    type: "array",
                    items: { $ref: "#/$defs/ingredient" },
                    minItems: 3,
                  },
                  steps_en: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 4,
                    description: "Step-by-step cooking instructions in English, each step is one clear sentence",
                  },
                  steps_tr: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 4,
                    description: "Step-by-step cooking instructions in Turkish, each step is one clear sentence",
                  },
                  serving_size_g: { type: "number" },
                  diet_tags: { type: "array", items: { type: "string" } },
                  image_prompt: { type: "string" },
                },
                required: [
                  "title_en", "title_tr",
                  "description_en", "description_tr",
                  "ingredients",
                  "steps_en", "steps_tr",
                  "serving_size_g", "diet_tags", "image_prompt",
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
            `Generate a delicious Muslim-friendly daily menu for date ${dateISO}.\n\n` +
            `HARD RULES:\n` +
            `- Absolutely no pork or pork products (no bacon, ham, lard, prosciutto, pepperoni, salami, pancetta)\n` +
            `- Absolutely no alcohol or alcohol-based ingredients\n` +
            `- Do NOT mention the word "pork" anywhere, not even as "pork-free"\n\n` +
            `REQUIREMENTS:\n` +
            `- Provide both English and Turkish names/descriptions for everything\n` +
            `- For each dish, provide detailed step-by-step cooking instructions in BOTH English (steps_en) and Turkish (steps_tr)\n` +
            `- Steps should be written like a home cook explaining to a friend — warm, clear, practical\n` +
            `- Each step should be one clear action (e.g. "Chop the onions finely and sauté in olive oil for 3 minutes")\n` +
            `- Include cooking times, temperatures, and practical tips in the steps\n` +
            `- Each dish needs a detailed image_prompt for AI food photography (describe the dish plated beautifully, top-down or 45-degree angle, natural lighting, restaurant quality)\n` +
            `- Make the menu varied and interesting — use different cuisines (Turkish, Mediterranean, Middle Eastern, Asian, etc.)\n` +
            `- Include seasonal ingredients when possible\n\n` +
            `Return by calling the submit_menu tool.`,
        },
      ],
    }),
  });

  const raw = await resp.text();
  if (!resp.ok) throw new Error(`Claude API ${resp.status}: ${raw}`);

  const json = JSON.parse(raw);
  const toolUse = (json.content || []).find(
    (c) => c.type === "tool_use" && c.name === "submit_menu"
  );
  if (!toolUse?.input) throw new Error("Claude did not return submit_menu tool output");

  return toolUse.input;
}

// ============================================================
// Replicate Flux Image Generation
// ============================================================
async function generateImage(prompt) {
  // Start prediction
  const createResp = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Flux Schnell — fast + cheap (~$0.003/image)
      version: "black-forest-labs/flux-schnell",
      input: {
        prompt: prompt,
        num_outputs: 1,
        aspect_ratio: "4:3",
        output_format: "webp",
        output_quality: 90,
      },
    }),
  });

  const createText = await createResp.text();
  if (!createResp.ok) throw new Error(`Replicate create failed: ${createResp.status} ${createText}`);

  let prediction = JSON.parse(createText);

  // Poll until complete (Flux Schnell is usually <5s)
  let attempts = 0;
  while (prediction.status !== "succeeded" && prediction.status !== "failed") {
    if (attempts++ > 60) throw new Error("Image generation timed out");
    await sleep(1000);

    const pollResp = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
    });
    prediction = await pollResp.json();
  }

  if (prediction.status === "failed") {
    throw new Error(`Image generation failed: ${prediction.error}`);
  }

  // Flux returns array of URLs
  const imageUrl = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;

  if (!imageUrl) throw new Error("No image URL in prediction output");
  return imageUrl;
}

async function generateAndUploadImage(prompt, menuDate, dishName) {
  console.log(`  📸 Generating image for ${dishName}...`);

  // Generate with Replicate
  const tempUrl = await generateImage(prompt);

  // Download the image
  const imgResp = await fetch(tempUrl);
  if (!imgResp.ok) throw new Error(`Failed to download image: ${imgResp.status}`);
  const buffer = new Uint8Array(await imgResp.arrayBuffer());

  // Upload to Supabase Storage
  const storagePath = `${menuDate}/${dishName}/photo.webp`;
  const { error: upErr } = await supabase.storage
    .from("menu-media")
    .upload(storagePath, buffer, {
      contentType: "image/webp",
      upsert: true,
    });

  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  // Get public URL
  const { data: pub } = supabase.storage.from("menu-media").getPublicUrl(storagePath);
  console.log(`  ✅ ${dishName} image uploaded`);
  return pub.publicUrl;
}

// ============================================================
// Routes
// ============================================================

// Health check
app.get("/", (req, res) =>
  res.json({ ok: true, service: "dailymenu-worker", version: "1.0.0" })
);

// --- Step 1: Generate menu (Claude) ---
app.post("/menu/generate", async (req, res) => {
  try {
    const dateISO = req.body?.date || todayISO();
    console.log(`\n🍽️  Generating menu for ${dateISO}...`);

    let menuObj = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`  Attempt ${attempt}/3...`);
        menuObj = await callClaudeMenu(dateISO);

        const menu = menuObj?.menu;
        if (!menu?.soup || !menu?.main || !menu?.salad || !menu?.side) {
          throw new Error("Missing menu.soup/main/salad/side");
        }

        assertNoForbidden(menuObj);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        menuObj = null;
        console.warn(`  ⚠️ Attempt ${attempt} failed: ${e.message}`);
      }
    }

    if (!menuObj) {
      throw new Error(`Menu generation failed: ${lastErr?.message}`);
    }

    console.log(`  ✅ Menu generated: ${menuObj.menu.main.title_en}`);

    // Upsert into Supabase
    const { error } = await supabase.from("daily_menus").upsert(
      {
        menu_date: dateISO,
        status: "draft",
        language: "en+tr",
        menu_json: menuObj,
      },
      { onConflict: "menu_date" }
    );

    if (error) throw error;
    return res.json({ ok: true, menu_date: dateISO, status: "draft", menu: menuObj });
  } catch (e) {
    console.error("❌ /menu/generate error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Step 2: Generate images (Replicate Flux) ---
app.post("/images/generate", async (req, res) => {
  try {
    const dateISO = req.body?.date || todayISO();
    console.log(`\n📸 Generating images for ${dateISO}...`);

    // Get the draft menu
    const { data: menuRow, error } = await supabase
      .from("daily_menus")
      .select("id, menu_date, menu_json, media_json")
      .eq("menu_date", dateISO)
      .maybeSingle();

    if (error) throw error;
    if (!menuRow) return res.status(404).json({ ok: false, error: "No menu found for this date" });

    const menu = menuRow.menu_json?.menu;
    if (!menu) return res.status(400).json({ ok: false, error: "menu_json.menu is missing" });

    const mediaJson = menuRow.media_json || {};
    const results = {};

    for (const dish of ["soup", "main", "salad", "side"]) {
      try {
        const prompt = menu[dish]?.image_prompt;
        if (!prompt) {
          results[dish] = { skipped: true, reason: "no image_prompt" };
          continue;
        }

        const publicUrl = await generateAndUploadImage(prompt, dateISO, dish);
        mediaJson[dish] = mediaJson[dish] || {};
        mediaJson[dish].images = [publicUrl];
        results[dish] = { ok: true, url: publicUrl };

        // Wait between requests to avoid Replicate rate limits
        await sleep(12000);
      } catch (e) {
        console.error(`  ❌ ${dish} image failed:`, e.message);
        results[dish] = { error: e.message };
        // Wait before retrying next dish
        await sleep(12000);
      }
    }

    // Update media_json
    const { error: saveErr } = await supabase
      .from("daily_menus")
      .update({ media_json: mediaJson })
      .eq("id", menuRow.id);

    if (saveErr) throw saveErr;

    console.log(`  ✅ Images done for ${dateISO}`);
    return res.json({ ok: true, menu_date: dateISO, results });
  } catch (e) {
    console.error("❌ /images/generate error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Step 3: Publish menu ---
app.post("/menu/publish", async (req, res) => {
  try {
    const dateISO = req.body?.date || todayISO();

    const { data, error } = await supabase
      .from("daily_menus")
      .update({ status: "published" })
      .eq("menu_date", dateISO)
      .eq("status", "draft")
      .select("menu_date, status")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, error: "No draft menu for that date" });

    console.log(`  ✅ Published menu for ${dateISO}`);
    return res.json({ ok: true, menu_date: data.menu_date, status: data.status });
  } catch (e) {
    console.error("❌ /menu/publish error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Full Pipeline (generate → images → publish) ---
app.post("/pipeline/run", async (req, res) => {
  try {
    const dateISO = req.body?.date || todayISO();
    console.log(`\n🚀 Running full pipeline for ${dateISO}...`);

    // Step 1: Generate menu
    console.log("  Step 1/3: Generating menu...");
    let menuObj = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        menuObj = await callClaudeMenu(dateISO);
        const menu = menuObj?.menu;
        if (!menu?.soup || !menu?.main || !menu?.salad || !menu?.side) {
          throw new Error("Missing dishes");
        }
        assertNoForbidden(menuObj);
        break;
      } catch (e) {
        lastErr = e;
        menuObj = null;
      }
    }
    if (!menuObj) throw new Error(`Menu generation failed: ${lastErr?.message}`);

    // Save draft
    const { error: upsertErr } = await supabase.from("daily_menus").upsert(
      {
        menu_date: dateISO,
        status: "draft",
        language: "en+tr",
        menu_json: menuObj,
      },
      { onConflict: "menu_date" }
    );
    if (upsertErr) throw upsertErr;
    console.log(`  ✅ Menu saved: ${menuObj.menu.main.title_en}`);

    // Step 2: Generate images
    console.log("  Step 2/3: Generating images...");
    const menu = menuObj.menu;
    const mediaJson = {};
    const imageResults = {};

    for (const dish of ["soup", "main", "salad", "side"]) {
      try {
        const prompt = menu[dish]?.image_prompt;
        if (!prompt) {
          imageResults[dish] = { skipped: true };
          continue;
        }
        const publicUrl = await generateAndUploadImage(prompt, dateISO, dish);
        mediaJson[dish] = { images: [publicUrl] };
        imageResults[dish] = { ok: true, url: publicUrl };

        // Wait between requests to avoid Replicate rate limits
        await sleep(12000);
      } catch (e) {
        console.error(`  ❌ ${dish} image failed:`, e.message);
        imageResults[dish] = { error: e.message };
        await sleep(12000);
      }
    }

    // Update media_json
    const { error: mediaErr } = await supabase
      .from("daily_menus")
      .update({ media_json: mediaJson })
      .eq("menu_date", dateISO);
    if (mediaErr) throw mediaErr;

    // Step 3: Publish
    console.log("  Step 3/3: Publishing...");
    const { error: pubErr } = await supabase
      .from("daily_menus")
      .update({ status: "published" })
      .eq("menu_date", dateISO);
    if (pubErr) throw pubErr;

    console.log(`\n🎉 Pipeline complete for ${dateISO}!\n`);
    return res.json({
      ok: true,
      menu_date: dateISO,
      status: "published",
      main_dish: menuObj.menu.main.title_en,
      images: imageResults,
    });
  } catch (e) {
    console.error("❌ /pipeline/run error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Get current menu (for debugging) ---
app.get("/menu/current", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("daily_menus")
      .select("*")
      .eq("status", "published")
      .order("menu_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// Cron Job — Auto-generate daily menu
// ============================================================
if (process.env.ENABLE_CRON !== "false") {
  cron.schedule(CRON_SCHEDULE, async () => {
    const dateISO = todayISO();
    console.log(`\n⏰ CRON: Starting daily pipeline for ${dateISO}...`);

    try {
      const resp = await fetch(`http://127.0.0.1:${port}/pipeline/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-internal": "true",
        },
        body: JSON.stringify({ date: dateISO }),
      });

      const result = await resp.json();
      console.log("⏰ CRON result:", JSON.stringify(result, null, 2));
    } catch (e) {
      console.error("⏰ CRON failed:", e.message);
    }
  });

  console.log(`⏰ Cron scheduled: "${CRON_SCHEDULE}"`);
}

// ============================================================
// Start
// ============================================================
const port = process.env.PORT || 3001;
app.listen(port, "0.0.0.0", () => {
  console.log(`\n🚀 Worker listening on port ${port}`);
  console.log(`   Model: ${CLAUDE_MODEL}`);
  console.log(`   Cron: ${CRON_SCHEDULE}`);
  console.log(`   Auth: ${WORKER_API_KEY ? "enabled" : "disabled (set WORKER_API_KEY)"}\n`);
});
