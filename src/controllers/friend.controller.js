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
