const {
  listFriends,
  listFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  deleteFriendRequest,
  unfriend,
} = require("../services/friendService");

function mapServiceError(res, e) {
  const code = e?.code || e?.message;
  if (code === "CANNOT_FRIEND_SELF") {
    return res.status(400).json({ error: "Cannot friend yourself", code });
  }
  if (code === "INVALID_USER") {
    return res.status(400).json({ error: "Invalid user", code });
  }
  if (code === "ALREADY_FRIENDS" || code === "FRIEND_REQUEST_EXISTS") {
    return res.status(409).json({ error: code, code });
  }
  if (code === "FRIEND_REQUEST_NOT_FOUND") {
    return res.status(404).json({ error: "Friend request not found", code });
  }
  return null;
}

async function getFriends(req, res) {
  try {
    const userId = req.user._id;
    const items = await listFriends(userId);
    return res.json(items);
  } catch (e) {
    console.error("getFriends error:", e?.message || e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function getFriendRequests(req, res) {
  try {
    const userId = req.user._id;
    const typeRaw = String(req.query.type || "incoming").toLowerCase();
    const type = typeRaw === "outgoing" ? "outgoing" : "incoming";
    const items = await listFriendRequests(userId, type);
    return res.json(items);
  } catch (e) {
    console.error("getFriendRequests error:", e?.message || e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function postFriendRequest(req, res) {
  try {
    const userId = req.user._id;
    const otherUserId = req.body?.otherUserId;
    const out = await sendFriendRequest({ userId, otherUserId });
    return res.status(201).json(out);
  } catch (e) {
    const mapped = mapServiceError(res, e);
    if (mapped) return mapped;
    console.error("postFriendRequest error:", e?.message || e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function acceptRequest(req, res) {
  try {
    const userId = req.user._id;
    const otherUserId = req.params.otherUserId;
    const out = await acceptFriendRequest({ userId, otherUserId });
    return res.json(out);
  } catch (e) {
    const mapped = mapServiceError(res, e);
    if (mapped) return mapped;
    console.error("acceptRequest error:", e?.message || e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function deleteRequest(req, res) {
  try {
    const userId = req.user._id;
    const otherUserId = req.params.otherUserId;
    const out = await deleteFriendRequest({ userId, otherUserId });
    return res.json(out);
  } catch (e) {
    const mapped = mapServiceError(res, e);
    if (mapped) return mapped;
    console.error("deleteRequest error:", e?.message || e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function deleteFriend(req, res) {
  try {
    const userId = req.user._id;
    const otherUserId = req.params.otherUserId;
    const out = await unfriend({ userId, otherUserId });
    return res.json(out);
  } catch (e) {
    console.error("deleteFriend error:", e?.message || e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  getFriends,
  getFriendRequests,
  postFriendRequest,
  acceptRequest,
  deleteRequest,
  deleteFriend,
};

