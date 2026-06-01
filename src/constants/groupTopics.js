/** Chủ đề nhóm — id cố định; đồng bộ với frontend `groupTopics.js`. */
const ALLOWED_GROUP_TOPIC_IDS = [
  "gaming",
  "music",
  "entertainment",
  "education",
];

const ALLOWED_SET = new Set(ALLOWED_GROUP_TOPIC_IDS);

const MAX_GROUP_DESCRIPTION_LENGTH = 280;

function assertAllowedTopic(topic) {
  const id = typeof topic === "string" ? topic.trim() : "";
  if (!id || !ALLOWED_SET.has(id)) {
    const err = new Error("INVALID_TOPIC");
    err.code = "INVALID_TOPIC";
    throw err;
  }
  return id;
}

function normalizeGroupDescription(description) {
  if (description === undefined || description === null) return "";
  const s = String(description).trim();
  if (s.length > MAX_GROUP_DESCRIPTION_LENGTH) {
    const err = new Error("INVALID_DESCRIPTION");
    err.code = "INVALID_DESCRIPTION";
    throw err;
  }
  return s;
}

function isAllowedTopicId(topic) {
  const id = typeof topic === "string" ? topic.trim() : "";
  return id ? ALLOWED_SET.has(id) : false;
}

module.exports = {
  ALLOWED_GROUP_TOPIC_IDS,
  MAX_GROUP_DESCRIPTION_LENGTH,
  assertAllowedTopic,
  isAllowedTopicId,
  normalizeGroupDescription,
};
