const {
  normalizeJoinPolicy,
  getEffectiveJoinPolicy,
} = require("../../src/constants/groupJoinPolicy");

describe("groupJoinPolicy", () => {
  test("normalizeJoinPolicy defaults to OPEN", () => {
    expect(normalizeJoinPolicy()).toBe("OPEN");
    expect(normalizeJoinPolicy("")).toBe("OPEN");
    expect(normalizeJoinPolicy("open")).toBe("OPEN");
  });

  test("normalizeJoinPolicy accepts INVITE_ONLY", () => {
    expect(normalizeJoinPolicy("INVITE_ONLY")).toBe("INVITE_ONLY");
    expect(normalizeJoinPolicy(" invite_only ")).toBe("INVITE_ONLY");
  });

  test("normalizeJoinPolicy maps unknown values to OPEN", () => {
    expect(normalizeJoinPolicy("PRIVATE")).toBe("OPEN");
  });

  test("getEffectiveJoinPolicy reads meta.joinPolicy", () => {
    expect(getEffectiveJoinPolicy({ joinPolicy: "INVITE_ONLY" })).toBe(
      "INVITE_ONLY",
    );
    expect(getEffectiveJoinPolicy({})).toBe("OPEN");
    expect(getEffectiveJoinPolicy(null)).toBe("OPEN");
  });
});
