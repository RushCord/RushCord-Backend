const { toPublicUser, toPublicUserExplore } = require("../../src/services/userService");

describe("userService mappers", () => {
  const item = {
    userId: "u1",
    fullName: "Alice",
    email: "alice@example.com",
    avatarUrl: "https://cdn/a.jpg",
    coverImageUrl: "https://cdn/c.jpg",
    dateOfBirth: "1990-01-01",
    gender: "FEMALE",
    createdAt: "2020-01-01T00:00:00.000Z",
  };

  test("toPublicUser returns null for missing item", () => {
    expect(toPublicUser(null)).toBeNull();
  });

  test("toPublicUser maps profile fields", () => {
    expect(toPublicUser(item)).toEqual({
      _id: "u1",
      fullName: "Alice",
      email: "alice@example.com",
      profilePic: "https://cdn/a.jpg",
      coverPic: "https://cdn/c.jpg",
      dateOfBirth: "1990-01-01",
      gender: "FEMALE",
      createdAt: "2020-01-01T00:00:00.000Z",
    });
  });

  test("toPublicUserExplore omits email", () => {
    const explore = toPublicUserExplore(item);
    expect(explore.email).toBeUndefined();
    expect(explore._id).toBe("u1");
    expect(explore.fullName).toBe("Alice");
  });
});
