function normalizeJoinPolicy(raw) {
  const v = String(raw || "OPEN").trim().toUpperCase();
  return v === "INVITE_ONLY" ? "INVITE_ONLY" : "OPEN";
}

function getEffectiveJoinPolicy(meta) {
  return normalizeJoinPolicy(meta?.joinPolicy);
}

module.exports = {
  normalizeJoinPolicy,
  getEffectiveJoinPolicy,
};
