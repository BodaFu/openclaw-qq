import {
  jsonResult,
  readStringParam,
  readNumberParam,
  readReactionParams,
  type ChannelMessageActionAdapter,
  type ChannelMessageActionName,
} from "openclaw/plugin-sdk";
import { getActiveClient } from "./monitor/client-ref.js";
import { handlePersonaUpdate } from "./persona/handle-persona-action.js";

const PERSONA_UPDATE_ACTION = "persona_update" as ChannelMessageActionName;

export const qqMessageActions: ChannelMessageActionAdapter = {
  listActions: () => {
    const actions: ChannelMessageActionName[] = ["send", "react", "delete", PERSONA_UPDATE_ACTION];
    return actions;
  },

  supportsAction: ({ action }) => action !== "send",

  handleAction: async ({ action, params, toolContext }) => {
    if (action === PERSONA_UPDATE_ACTION) {
      return handlePersonaUpdate(params);
    }

    const client = getActiveClient();
    if (!client) {
      throw new Error("QQ client not connected");
    }

    if (action === "react") {
      const messageId =
        readNumberParam(params, "messageId", { integer: true }) ??
        (toolContext?.currentMessageId ? Number(toolContext.currentMessageId) : undefined);
      if (!messageId) {
        throw new Error("messageId is required for QQ react");
      }
      const { emoji } = readReactionParams(params, {
        removeErrorMessage: "Cannot remove QQ emoji reactions",
      });
      if (!emoji) {
        throw new Error("emoji is required for QQ react");
      }
      await client.setMsgEmojiLike(messageId, emoji);
      return jsonResult({ ok: true, emoji });
    }

    if (action === "delete") {
      const messageId = readNumberParam(params, "messageId", {
        required: true,
        integer: true,
      });
      if (typeof messageId !== "number") {
        throw new Error("messageId is required for QQ delete");
      }
      await client.deleteMsg(messageId);
      return jsonResult({ ok: true, deleted: true });
    }

    throw new Error(`Unsupported QQ action: ${action}`);
  },
};
