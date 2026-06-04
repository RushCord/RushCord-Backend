const {
  isAllowedTopicId,
  assertAllowedTopic,
  normalizeGroupDescription,
  MAX_GROUP_DESCRIPTION_LENGTH,
} = require("../../src/constants/groupTopics");

describe("groupTopics", () => {
  test("isAllowedTopicId", () => {
    expect(isAllowedTopicId("gaming")).toBe(true);
    expect(isAllowedTopicId("")).toBe(false);
    expect(isAllowedTopicId("unknown")).toBe(false);
  });

  test("assertAllowedTopic returns id for valid topic", () => {
    expect(assertAllowedTopic("  music ")).toBe("music");
  });

  test("assertAllowedTopic throws INVALID_TOPIC", () => {
    expect(() => assertAllowedTopic("bad")).toThrow("INVALID_TOPIC");
    try {
      assertAllowedTopic("bad");
    } catch (e) {
      expect(e.code).toBe("INVALID_TOPIC");
    }
  });

  test("normalizeGroupDescription", () => {
    expect(normalizeGroupDescription(null)).toBe("");
    expect(normalizeGroupDescription("  hello  ")).toBe("hello");
  });

  test("normalizeGroupDescription throws when too long", () => {
    const long = "a".repeat(MAX_GROUP_DESCRIPTION_LENGTH + 1);
    expect(() => normalizeGroupDescription(long)).toThrow("INVALID_DESCRIPTION");
  });
});
