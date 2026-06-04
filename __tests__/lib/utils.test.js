const { getFileName } = require("../../src/lib/utils");

describe("getFileName", () => {
  test("extracts filename from URL without query", () => {
    expect(getFileName("https://cdn.example.com/path/photo.jpg")).toBe("photo.jpg");
  });

  test("strips query string", () => {
    expect(getFileName("https://cdn.example.com/a/b.png?token=abc")).toBe("b.png");
  });

  test("returns file on invalid input", () => {
    expect(getFileName(null)).toBe("file");
  });
});
