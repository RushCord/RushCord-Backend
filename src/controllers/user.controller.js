const {
  getProfileRaw,
  toPublicUserExplore,
  searchUsersForExplore,
} = require("../services/userService");

async function searchUsers(req, res) {
  try {
    const q = req.query.q ?? "";
    const limitRaw = parseInt(String(req.query.limit ?? "40"), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 40;
    const items = await searchUsersForExplore(req.user._id, q, limit);
    return res.status(200).json(items);
  } catch (e) {
    console.error("searchUsers error:", e?.message || e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function getUserPublic(req, res) {
  try {
    const { userId } = req.params;
    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "userId is required" });
    }
    const item = await getProfileRaw(userId);
    if (!item) {
      return res.status(404).json({ error: "User not found" });
    }
    const body = toPublicUserExplore(item);
    if (String(req.user._id) === String(userId)) {
      return res.status(200).json({ ...body, isSelf: true });
    }
    return res.status(200).json(body);
  } catch (e) {
    console.error("getUserPublic error:", e?.message || e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  searchUsers,
  getUserPublic,
};
