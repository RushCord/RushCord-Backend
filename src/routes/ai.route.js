const express = require("express");
const { protectRoute } = require("../middleware/auth.middleware");

const router = express.Router();

function getAiConfig() {
  const rawBase = process.env.AI_API_BASE_URL || "https://rushcord-ai.rushcord.click";
  const baseURL = String(rawBase).trim().replace(/\/+$/, "");
  const apiKey = String(process.env.AI_API_KEY || "").trim();
  return { baseURL, apiKey };
}

async function forwardJson(req, res, path) {
  const { baseURL, apiKey } = getAiConfig();
  if (!baseURL) return res.status(500).json({ message: "AI_API_BASE_URL is missing" });
  if (!apiKey) return res.status(500).json({ message: "AI_API_KEY is missing" });

  try {
    const url = `${baseURL}${path}`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(req.body || {}),
    });

    const contentType = upstream.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const data = isJson ? await upstream.json() : await upstream.text();

    if (!upstream.ok) {
      return res.status(upstream.status).send(data);
    }

    return res.status(200).send(data);
  } catch (err) {
    return res.status(502).json({ message: err?.message || "AI upstream request failed" });
  }
}

router.post("/chat", protectRoute, async (req, res) => forwardJson(req, res, "/v1/chat"));
router.post("/summarize", protectRoute, async (req, res) => forwardJson(req, res, "/v1/summarize"));

module.exports = router;

