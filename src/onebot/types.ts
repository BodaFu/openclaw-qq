// OneBot v11 Message Segment types
export type OneBotSegment =
  | { type: "text"; data: { text: string } }
  | { type: "face"; data: { id: string } }
  | { type: "image"; data: { file: string; url?: string; summary?: string } }
  | { type: "record"; data: { file: string; url?: string } }
  | { type: "video"; data: { file: string; url?: string } }
  | { type: "at"; data: { qq: string } }
  | { type: "reply"; data: { id: string } }
  | { type: "forward"; data: { id: string } }
  | { type: "json"; data: { data: string } }
  | { type: "file"; data: { file: string; name?: string; url?: string } }
  | { type: "node"; data: Record<string, unknown> }
  | { type: string; data: Record<string, unknown> };

// Sender info attached to message events
export type OneBotSender = {
  user_id: number;
  nickname: string;
  card?: string;
  sex?: "male" | "female" | "unknown";
  age?: number;
  area?: string;
  level?: string;
  role?: "owner" | "admin" | "member";
  title?: string;
};

// Private message event
export type OneBotPrivateMessageEvent = {
  time: number;
  self_id: number;
  post_type: "message";
  message_type: "private";
  sub_type: "friend" | "group" | "other";
  message_id: number;
  user_id: number;
  message: OneBotSegment[];
  raw_message: string;
  font: number;
  sender: OneBotSender;
};

// Group message event
export type OneBotGroupMessageEvent = {
  time: number;
  self_id: number;
  post_type: "message";
  message_type: "group";
  sub_type: "normal" | "anonymous" | "notice";
  message_id: number;
  group_id: number;
  user_id: number;
  message: OneBotSegment[];
  raw_message: string;
  font: number;
  sender: OneBotSender;
  anonymous?: { id: number; name: string; flag: string } | null;
};

export type OneBotMessageEvent = OneBotPrivateMessageEvent | OneBotGroupMessageEvent;

// Notice events
export type OneBotNoticeEvent = {
  time: number;
  self_id: number;
  post_type: "notice";
  notice_type: string;
  sub_type?: string;
  group_id?: number;
  user_id?: number;
  operator_id?: number;
  message_id?: number;
  target_id?: number;
  [key: string]: unknown;
};

// Request events
export type OneBotRequestEvent = {
  time: number;
  self_id: number;
  post_type: "request";
  request_type: "friend" | "group";
  sub_type?: string;
  user_id: number;
  group_id?: number;
  comment?: string;
  flag: string;
};

// Meta events (heartbeat, lifecycle)
export type OneBotMetaEvent = {
  time: number;
  self_id: number;
  post_type: "meta_event";
  meta_event_type: "heartbeat" | "lifecycle";
  sub_type?: string;
  status?: { online: boolean; good: boolean };
  interval?: number;
};

export type OneBotEvent =
  | OneBotMessageEvent
  | OneBotNoticeEvent
  | OneBotRequestEvent
  | OneBotMetaEvent;

// API response
export type OneBotApiResponse<T = unknown> = {
  status: "ok" | "failed";
  retcode: number;
  data: T;
  echo?: string;
  message?: string;
  wording?: string;
};

// API data types
export type OneBotGroupInfo = {
  group_id: number;
  group_name: string;
  member_count: number;
  max_member_count: number;
};

export type OneBotGroupMemberInfo = {
  group_id: number;
  user_id: number;
  nickname: string;
  card: string;
  sex: string;
  age: number;
  area: string;
  join_time: number;
  last_sent_time: number;
  level: string;
  role: "owner" | "admin" | "member";
  title: string;
};

export type OneBotLoginInfo = {
  user_id: number;
  nickname: string;
};

export type OneBotStrangerInfo = {
  user_id: number;
  nickname: string;
  sex: string;
  age: number;
};

export type OneBotFriendInfo = {
  user_id: number;
  nickname: string;
  remark: string;
};

export type OneBotSendMsgResponse = {
  message_id: number;
};
