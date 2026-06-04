const {
  userPk,
  PROFILE_SK,
  emailPk,
  EMAIL_REF_SK,
  EMAIL_CHANGE_SK,
  emailChangeTokenPk,
  convPk,
  META_SK,
  memberSk,
  userConvSk,
  dmConversationId,
  messageSk,
  channelMessageSk,
  channelMessageSkPrefix,
  channelSk,
  groupVoiceRoomName,
  conversationChannelSocketRoom,
  gsi1MessagePk,
  gsi1MessageSk,
  gsi1MessageSkForRow,
  gsi2Pk,
  gsi2InboxSk,
  inviteSk,
  inviteLookupPk,
} = require("../../src/lib/keys");

describe("keys", () => {
  test("userPk and gsi2Pk", () => {
    expect(userPk("u1")).toBe("USER#u1");
    expect(gsi2Pk("u1")).toBe("USER#u1");
  });

  test("constants", () => {
    expect(PROFILE_SK).toBe("PROFILE");
    expect(EMAIL_REF_SK).toBe("REF");
    expect(EMAIL_CHANGE_SK).toBe("EMAIL_CHANGE");
    expect(META_SK).toBe("META");
  });

  test("emailPk normalizes email", () => {
    expect(emailPk("  User@Example.COM ")).toBe("EMAIL#user@example.com");
  });

  test("emailChangeTokenPk and convPk", () => {
    expect(emailChangeTokenPk("abc123")).toBe("EMAIL_CHANGE_TOKEN#abc123");
    expect(convPk("DM#a#b")).toBe("CONV#DM#a#b");
  });

  test("memberSk and userConvSk", () => {
    expect(memberSk("u1")).toBe("MEMBER#u1");
    expect(userConvSk("c1")).toBe("CONV#c1");
  });

  test("dmConversationId is stable regardless of argument order", () => {
    expect(dmConversationId("z", "a")).toBe("DM#a#z");
    expect(dmConversationId("a", "z")).toBe("DM#a#z");
  });

  test("messageSk and channelMessageSk", () => {
    expect(messageSk("2020-01-01T00:00:00.000Z", "m1")).toBe(
      "MSG#2020-01-01T00:00:00.000Z#m1",
    );
    expect(channelMessageSk("ch1", "2020-01-01T00:00:00.000Z", "m1")).toBe(
      "MSG#CH#ch1#2020-01-01T00:00:00.000Z#m1",
    );
    expect(channelMessageSkPrefix("ch1")).toBe("MSG#CH#ch1#");
  });

  test("channelSk uppercases type", () => {
    expect(channelSk("voice", "ch1")).toBe("CHANNEL#VOICE#ch1");
  });

  test("groupVoiceRoomName and conversationChannelSocketRoom", () => {
    expect(groupVoiceRoomName("GROUP#g1", "v1")).toBe("GROUP#g1#VOICE#v1");
    expect(conversationChannelSocketRoom("GROUP#g1", "ch1")).toBe(
      "GROUP#g1#CH#ch1",
    );
  });

  test("gsi1 keys", () => {
    expect(gsi1MessagePk("m1")).toBe("MSG#m1");
    expect(gsi1MessageSk("c1", "2020-01-01T00:00:00.000Z", "m1")).toBe(
      "CONV#c1#SK#MSG#2020-01-01T00:00:00.000Z#m1",
    );
    expect(gsi1MessageSkForRow("c1", "MSG#x")).toBe("CONV#c1#SK#MSG#x");
  });

  test("gsi2InboxSk and invite keys", () => {
    expect(gsi2InboxSk("2020-01-01T00:00:00.000Z", "c1")).toBe(
      "INBOX#2020-01-01T00:00:00.000Z#CONV#c1",
    );
    expect(inviteSk("inv1")).toBe("INVITE#inv1");
    expect(inviteLookupPk("hash1")).toBe("INVITE#hash1");
  });
});
