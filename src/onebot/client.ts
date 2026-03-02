import { EventEmitter } from "events";
import WebSocket from "ws";
import type {
  OneBotEvent,
  OneBotApiResponse,
  OneBotSegment,
  OneBotSendMsgResponse,
  OneBotLoginInfo,
  OneBotGroupInfo,
  OneBotGroupMemberInfo,
  OneBotStrangerInfo,
  OneBotFriendInfo,
} from "./types.js";

const RECONNECT_DELAY_MS = 3000;
const API_TIMEOUT_MS = 15000;

type PendingCall = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class OneBotClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private pendingCalls = new Map<string, PendingCall>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private callId = 0;
  private connected = false;
  private shouldReconnect = true;
  private log: (msg: string) => void;

  constructor(
    private url: string,
    private token?: string,
    log?: (msg: string) => void,
  ) {
    super();
    this.log = log ?? console.log;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.shouldReconnect = true;
      const wsUrl = this.token
        ? `${this.url}?access_token=${encodeURIComponent(this.token)}`
        : this.url;

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        reject(new Error(`Failed to create WebSocket: ${String(err)}`));
        return;
      }

      const onOpen = () => {
        cleanup();
        this.connected = true;
        this.log("[QQ/OneBot] WebSocket connected");
        this.emit("connected");
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        this.connected = false;
        reject(new Error(`WebSocket connection failed: ${err.message}`));
      };

      const cleanup = () => {
        this.ws?.removeListener("open", onOpen);
        this.ws?.removeListener("error", onError);
        this.setupListeners();
      };

      this.ws.once("open", onOpen);
      this.ws.once("error", onError);
    });
  }

  private setupListeners() {
    if (!this.ws) return;

    this.ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const data = JSON.parse(raw.toString());
        this.handleMessage(data);
      } catch {
        this.log(`[QQ/OneBot] Failed to parse message: ${raw.toString().slice(0, 200)}`);
      }
    });

    this.ws.on("close", (code, reason) => {
      this.connected = false;
      this.log(`[QQ/OneBot] WebSocket closed: ${code} ${reason.toString()}`);
      this.rejectAllPending("WebSocket closed");
      this.emit("disconnected");
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      this.log(`[QQ/OneBot] WebSocket error: ${err.message}`);
    });
  }

  private handleMessage(data: OneBotApiResponse | OneBotEvent) {
    // API response (has echo field)
    if ("echo" in data && data.echo != null) {
      const resp = data as OneBotApiResponse;
      const pending = this.pendingCalls.get(String(resp.echo));
      if (pending) {
        this.pendingCalls.delete(String(resp.echo));
        clearTimeout(pending.timer);
        if (resp.status === "ok" || resp.retcode === 0) {
          pending.resolve(resp.data);
        } else {
          pending.reject(
            new Error(`OneBot API error: retcode=${resp.retcode} ${resp.message ?? ""}`),
          );
        }
      }
      return;
    }

    // Event
    const event = data as OneBotEvent;
    if (event.post_type === "meta_event") {
      // Heartbeat or lifecycle - ignore silently
      return;
    }

    this.emit("event", event);

    if (event.post_type === "message") {
      this.emit("message", event);
    } else if (event.post_type === "notice") {
      this.emit("notice", event);
    } else if (event.post_type === "request") {
      this.emit("request", event);
    }
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) return;

    this.log(`[QQ/OneBot] Reconnecting in ${RECONNECT_DELAY_MS}ms...`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        this.log(`[QQ/OneBot] Reconnect failed: ${String(err)}`);
        this.scheduleReconnect();
      }
    }, RECONNECT_DELAY_MS);
  }

  private rejectAllPending(reason: string) {
    for (const [id, pending] of this.pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingCalls.delete(id);
    }
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectAllPending("Client disconnecting");
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  async callApi<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.isConnected()) {
      throw new Error("OneBot WebSocket not connected");
    }
    const echo = String(++this.callId);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(echo);
        reject(new Error(`OneBot API timeout: ${action}`));
      }, API_TIMEOUT_MS);

      this.pendingCalls.set(echo, {
        resolve: resolve as (data: unknown) => void,
        reject,
        timer,
      });

      this.ws!.send(JSON.stringify({ action, params, echo }));
    });
  }

  // ── Convenience API methods ──

  async sendPrivateMsg(
    userId: number,
    message: OneBotSegment[],
  ): Promise<OneBotSendMsgResponse> {
    return this.callApi<OneBotSendMsgResponse>("send_private_msg", {
      user_id: userId,
      message,
    });
  }

  async sendGroupMsg(
    groupId: number,
    message: OneBotSegment[],
  ): Promise<OneBotSendMsgResponse> {
    return this.callApi<OneBotSendMsgResponse>("send_group_msg", {
      group_id: groupId,
      message,
    });
  }

  async sendMsg(
    messageType: "private" | "group",
    targetId: number,
    message: OneBotSegment[],
  ): Promise<OneBotSendMsgResponse> {
    const params: Record<string, unknown> = { message_type: messageType, message };
    if (messageType === "private") params.user_id = targetId;
    else params.group_id = targetId;
    return this.callApi<OneBotSendMsgResponse>("send_msg", params);
  }

  async getMsg(messageId: number): Promise<{
    message_id: number;
    real_id: number;
    sender: { user_id: number; nickname: string };
    time: number;
    message: OneBotSegment[];
    raw_message: string;
  }> {
    return this.callApi("get_msg", { message_id: messageId });
  }

  async deleteMsg(messageId: number): Promise<void> {
    await this.callApi("delete_msg", { message_id: messageId });
  }

  async getLoginInfo(): Promise<OneBotLoginInfo> {
    return this.callApi<OneBotLoginInfo>("get_login_info");
  }

  async getGroupList(): Promise<OneBotGroupInfo[]> {
    return this.callApi<OneBotGroupInfo[]>("get_group_list");
  }

  async getGroupInfo(groupId: number): Promise<OneBotGroupInfo> {
    return this.callApi<OneBotGroupInfo>("get_group_info", { group_id: groupId });
  }

  async getGroupMemberInfo(
    groupId: number,
    userId: number,
    noCache = false,
  ): Promise<OneBotGroupMemberInfo> {
    return this.callApi<OneBotGroupMemberInfo>("get_group_member_info", {
      group_id: groupId,
      user_id: userId,
      no_cache: noCache,
    });
  }

  async setMsgEmojiLike(messageId: number, emojiId: string): Promise<void> {
    await this.callApi("set_msg_emoji_like", { message_id: messageId, emoji_id: emojiId });
  }

  async setInputStatus(userId: number, eventType: number = 1): Promise<void> {
    await this.callApi("set_input_status", { user_id: userId, event_type: eventType });
  }

  async markMsgAsRead(messageId: number): Promise<void> {
    await this.callApi("mark_msg_as_read", { message_id: messageId });
  }

  async getStrangerInfo(userId: number, noCache = false): Promise<OneBotStrangerInfo> {
    return this.callApi<OneBotStrangerInfo>("get_stranger_info", {
      user_id: userId,
      no_cache: noCache,
    });
  }

  async getFriendList(): Promise<OneBotFriendInfo[]> {
    return this.callApi<OneBotFriendInfo[]>("get_friend_list");
  }

  async getGroupMsgHistory(
    groupId: number,
    messageSeq?: number,
    count = 20,
  ): Promise<{ messages: OneBotEvent[] }> {
    return this.callApi<{ messages: OneBotEvent[] }>("get_group_msg_history", {
      group_id: groupId,
      message_seq: messageSeq ?? 0,
      count,
    });
  }

  async getFriendMsgHistory(
    userId: number,
    messageSeq?: number,
    count = 20,
  ): Promise<{ messages: OneBotEvent[] }> {
    return this.callApi<{ messages: OneBotEvent[] }>("get_friend_msg_history", {
      user_id: userId,
      message_seq: messageSeq ?? 0,
      count,
    });
  }

  async getFile(fileId: string): Promise<{
    file: string;
    url: string;
    file_size: string;
    file_name: string;
    base64: string;
  }> {
    return this.callApi("get_file", { file_id: fileId });
  }
}
