const {
  effectiveAdminGrantedAt,
  pickLongestTenuredAdmin,
} = require("../../src/services/conversationsService");

describe("conversationsService admin helpers", () => {
  test("effectiveAdminGrantedAt prefers adminGrantedAt", () => {
    expect(
      effectiveAdminGrantedAt({
        adminGrantedAt: "2024-01-01",
        joinedAt: "2020-01-01",
      }),
    ).toBe("2024-01-01");
    expect(
      effectiveAdminGrantedAt({
        updatedAt: "2023-06-01",
        joinedAt: "2020-01-01",
      }),
    ).toBe("2023-06-01");
    expect(effectiveAdminGrantedAt({ joinedAt: "2020-01-01" })).toBe(
      "2020-01-01",
    );
  });

  test("pickLongestTenuredAdmin returns earliest granted admin", () => {
    const admin = pickLongestTenuredAdmin([
      { userId: "b", role: "ADMIN", status: "ACCEPTED", adminGrantedAt: "2024-02-01" },
      { userId: "a", role: "ADMIN", status: "ACCEPTED", adminGrantedAt: "2024-01-01" },
    ]);
    expect(admin.userId).toBe("a");
  });

  test("pickLongestTenuredAdmin ignores non-accepted admins", () => {
    expect(() =>
      pickLongestTenuredAdmin([
        { userId: "a", role: "ADMIN", status: "PENDING" },
      ]),
    ).toThrow("NO_ELIGIBLE_SUCCESSOR");
  });

  test("pickLongestTenuredAdmin throws when no admins", () => {
    expect(() => pickLongestTenuredAdmin([])).toThrow("NO_ELIGIBLE_SUCCESSOR");
    expect(() =>
      pickLongestTenuredAdmin([{ userId: "x", role: "MEMBER", status: "ACCEPTED" }]),
    ).toThrow("NO_ELIGIBLE_SUCCESSOR");
  });
});
