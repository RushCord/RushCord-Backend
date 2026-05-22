const { assertUserInConversation } = require("../services/conversationService");
const {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
} = require("../services/channelsService");

const listChannelsHandler = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;
    await assertUserInConversation({ conversationId, userId });
    const channels = await listChannels({ conversationId, userId });
    return res.status(200).json(channels);
  } catch (e) {
    if (e.code === "NOT_IN_CONVERSATION" || e.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ error: "Not in conversation" });
    }
    if (e.code === "CONVERSATION_NOT_FOUND") {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (e.code === "NOT_A_GROUP") {
      return res.status(400).json({ error: "Not a group conversation" });
    }
    console.error("listChannelsHandler error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const createChannelHandler = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;
    const member = await assertUserInConversation({ conversationId, userId });
    const { channelType, name } = req.body ?? {};
    const created = await createChannel({
      conversationId,
      actorMember: member,
      channelType,
      name,
    });
    return res.status(201).json(created);
  } catch (e) {
    if (e.code === "NOT_IN_CONVERSATION" || e.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ error: "Not in conversation" });
    }
    if (e.code === "NOT_ALLOWED") {
      return res.status(403).json({ error: "Not allowed" });
    }
    if (e.code === "INVALID_CHANNEL_TYPE") {
      return res.status(400).json({ error: "Invalid channel type" });
    }
    if (e.code === "INVALID_NAME") {
      return res.status(400).json({ error: "Invalid name" });
    }
    if (e.code === "NOT_A_GROUP") {
      return res.status(400).json({ error: "Not a group conversation" });
    }
    console.error("createChannelHandler error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const patchChannelHandler = async (req, res) => {
  try {
    const { conversationId, channelId } = req.params;
    const userId = req.user._id;
    const member = await assertUserInConversation({ conversationId, userId });
    const { name } = req.body ?? {};
    const updated = await updateChannel({
      conversationId,
      actorMember: member,
      channelId,
      name,
    });
    return res.status(200).json(updated);
  } catch (e) {
    if (e.code === "NOT_IN_CONVERSATION" || e.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ error: "Not in conversation" });
    }
    if (e.code === "NOT_ALLOWED") {
      return res.status(403).json({ error: "Not allowed" });
    }
    if (e.code === "CHANNEL_NOT_FOUND") {
      return res.status(404).json({ error: "Channel not found" });
    }
    if (e.code === "INVALID_NAME") {
      return res.status(400).json({ error: "Invalid name" });
    }
    console.error("patchChannelHandler error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const deleteChannelHandler = async (req, res) => {
  try {
    const { conversationId, channelId } = req.params;
    const userId = req.user._id;
    const member = await assertUserInConversation({ conversationId, userId });
    const out = await deleteChannel({
      conversationId,
      actorMember: member,
      channelId,
    });
    return res.status(200).json(out);
  } catch (e) {
    if (e.code === "NOT_IN_CONVERSATION" || e.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ error: "Not in conversation" });
    }
    if (e.code === "NOT_ALLOWED") {
      return res.status(403).json({ error: "Not allowed" });
    }
    if (e.code === "CHANNEL_NOT_FOUND") {
      return res.status(404).json({ error: "Channel not found" });
    }
    if (e.code === "LAST_CHANNEL_OF_TYPE") {
      return res.status(400).json({ error: "Cannot delete the last channel of this type" });
    }
    console.error("deleteChannelHandler error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  listChannelsHandler,
  createChannelHandler,
  patchChannelHandler,
  deleteChannelHandler,
};
