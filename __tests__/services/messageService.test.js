const { messageToLegacy } = require("../../src/services/messageService");

describe("messageToLegacy", () => {
  test("returns null for missing item", () => {
    expect(messageToLegacy(null, "u1")).toBeNull();
  });

  test("hides content when recalled for all", () => {
    const dto = messageToLegacy(
      {
        messageId: "m1",
        conversationId: "DM#a#b",
        senderId: "a",
        receiverId: "b",
        recallScope: "ALL",
        createdAt: "2020-01-01T00:00:00.000Z",
        text: "secret",
        mediaItems: [{ publicUrl: "https://x/img.png", contentType: "image/png" }],
      },
      "a",
    );
    expect(dto.isRecalled).toBe(true);
    expect(dto.text).toBeUndefined();
    expect(dto.image).toBeUndefined();
  });

  test("isDeletedForMe with hiddenFor Set and Array", () => {
    const base = {
      messageId: "m1",
      conversationId: "DM#a#b",
      senderId: "a",
      receiverId: "b",
      createdAt: "2020-01-01T00:00:00.000Z",
      text: "hi",
    };
    const fromSet = messageToLegacy({ ...base, hiddenFor: new Set(["b"]) }, "b");
    expect(fromSet.isDeletedForMe).toBe(true);
    expect(fromSet.text).toBeUndefined();

    const fromArr = messageToLegacy({ ...base, hiddenFor: ["b"] }, "b");
    expect(fromArr.isDeletedForMe).toBe(true);
  });

  test("maps single image and file attachments", () => {
    const imageDto = messageToLegacy(
      {
        messageId: "m1",
        conversationId: "DM#a#b",
        senderId: "a",
        receiverId: "b",
        createdAt: "2020-01-01T00:00:00.000Z",
        type: "IMAGE",
        mediaItems: [
          {
            publicUrl: "https://cdn/a.png",
            contentType: "image/png",
            fileName: "a.png",
          },
        ],
      },
      "a",
    );
    expect(imageDto.image).toBe("https://cdn/a.png");

    const fileDto = messageToLegacy(
      {
        messageId: "m2",
        conversationId: "DM#a#b",
        senderId: "a",
        receiverId: "b",
        createdAt: "2020-01-01T00:00:00.000Z",
        type: "FILE",
        mediaItems: [
          {
            publicUrl: "https://cdn/f.pdf",
            contentType: "application/pdf",
            fileName: "f.pdf",
          },
        ],
      },
      "a",
    );
    expect(fileDto.file).toBe("https://cdn/f.pdf");
    expect(fileDto.fileName).toBe("f.pdf");
  });

  test("maps multiple images", () => {
    const dto = messageToLegacy(
      {
        messageId: "m1",
        conversationId: "DM#a#b",
        senderId: "a",
        receiverId: "b",
        createdAt: "2020-01-01T00:00:00.000Z",
        type: "IMAGES",
        mediaItems: [
          { publicUrl: "https://cdn/1.png", contentType: "image/png" },
          { publicUrl: "https://cdn/2.png", contentType: "image/png" },
        ],
      },
      "a",
    );
    expect(dto.images).toEqual(["https://cdn/1.png", "https://cdn/2.png"]);
  });

  test("reactionCounts from Set and Array", () => {
    const dto = messageToLegacy(
      {
        messageId: "m1",
        conversationId: "DM#a#b",
        senderId: "a",
        receiverId: "b",
        createdAt: "2020-01-01T00:00:00.000Z",
        reactionsByEmoji: {
          "👍": new Set(["u1", "u2"]),
          "❤️": ["u3"],
        },
      },
      "a",
    );
    expect(dto.reactionCounts).toEqual({ "👍": 2, "❤️": 1 });
  });

  test("includes flags isSystem isForwarded isEdited", () => {
    const dto = messageToLegacy(
      {
        messageId: "m1",
        conversationId: "DM#a#b",
        senderId: "a",
        receiverId: "b",
        createdAt: "2020-01-01T00:00:00.000Z",
        isSystem: true,
        isForwarded: true,
        editHistory: [{ text: "old", at: "2020-01-01T00:00:00.000Z" }],
        editedAt: "2020-01-02T00:00:00.000Z",
        text: "edited",
      },
      "a",
    );
    expect(dto.isSystem).toBe(true);
    expect(dto.isForwarded).toBe(true);
    expect(dto.isEdited).toBe(true);
    expect(dto.editHistory).toHaveLength(1);
  });

  test("shows text when viewer not in hiddenFor", () => {
    const dto = messageToLegacy(
      {
        messageId: "m1",
        conversationId: "DM#a#b",
        senderId: "a",
        receiverId: "b",
        createdAt: "2020-01-01T00:00:00.000Z",
        text: "visible",
        hiddenFor: ["other"],
      },
      "b",
    );
    expect(dto.isDeletedForMe).toBe(false);
    expect(dto.text).toBe("visible");
  });

  test("maps type IMAGES with single media item to images array", () => {
    const dto = messageToLegacy(
      {
        messageId: "m1",
        conversationId: "DM#a#b",
        senderId: "a",
        receiverId: "b",
        createdAt: "2020-01-01T00:00:00.000Z",
        type: "IMAGES",
        mediaItems: [{ publicUrl: "https://cdn/1.png", contentType: "image/png" }],
      },
      "a",
    );
    expect(dto.images).toEqual(["https://cdn/1.png"]);
  });
});
