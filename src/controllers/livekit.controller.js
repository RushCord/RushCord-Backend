const { AccessToken } = require("livekit-server-sdk");
const { assertUserInConversation } = require("../services/conversationService");

function requireEnv(name) {
  const v = process.env[name];
  if (typeof v !== "string" || v.trim() === "") {
    const err = new Error(`Missing ${name}`);
    err.code = "CONFIG_MISSING";
    err.envName = name;
    throw err;
  }
  return v.trim();
}

async function mintToken(req, res) {
  try {
    const userId = req.cognitoSub;
    const roomNameRaw = req.body?.roomName;
    const roomName = typeof roomNameRaw === "string" ? roomNameRaw.trim() : "";

    if (!roomName) {
      return res.status(400).json({
        message: "roomName is required",
        code: "INVALID_INPUT",
      });
    }

    await assertUserInConversation({ conversationId: roomName, userId });

    const apiKey = requireEnv("LIVEKIT_API_KEY");
    const apiSecret = requireEnv("LIVEKIT_API_SECRET");
    const url = requireEnv("LIVEKIT_URL");

    const at = new AccessToken(apiKey, apiSecret, {
      identity: String(userId),
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    return res.status(200).json({ url, token });
  } catch (e) {
    if (e?.code === "NOT_IN_CONVERSATION" || e?.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ message: "Not allowed", code: "FORBIDDEN" });
    }
    if (e?.code === "CONFIG_MISSING") {
      return res.status(500).json({
        message: `Server misconfigured: ${e.envName}`,
        code: "SERVER_CONFIG_ERROR",
      });
    }
    console.error("mintToken error:", e);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { mintToken };

