require("dotenv").config();
const express = require("express");

const app = express();
app.use(express.json());

// Health check (Render uses this)
app.get("/", (req, res) => {
  res.json({ ok: true, service: "dailymenu-worker" });
});

// We'll add real endpoints in Step 3
app.post("/jobs/test", async (req, res) => {
  res.json({ ok: true, message: "Worker is running", body: req.body });
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Worker listening on ${port}`));