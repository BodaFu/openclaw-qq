export type ChatMessage = {
  messageId: string;
  sender: string;
  senderId: string;
  content: string;
  timestamp: number;
  role: "user" | "bot";
  mediaUrls?: string[];
  quotedContent?: string;
};

export type CompactSummary = {
  summary: string;
  archivedAt: Date;
  messageCount: number;
};

export type ChatDocument = {
  chatKey: string;
  messages: ChatMessage[];
  tokenCount: number;
  compactCount: number;
  latestCompact?: CompactSummary;
  updatedAt: Date;
};

export type ChatArchive = {
  chatKey: string;
  compactIndex: number;
  messages: ChatMessage[];
  summary: string;
  archivedAt: Date;
};

export type ChatStoreConfig = {
  mongoUri: string;
  dbName: string;
  tokenThreshold: number;
  compactKeepRecent: number;
  compactModel: string;
  compactApiUrl: string;
  compactApiKey: string;
};

export type PersonaEvolutionEntry = {
  trigger: string;
  change: string;
  timestamp: Date;
};

export type UserPersona = {
  userId: string;
  persona: string;
  nickname: string;
  likoNickname: string;
  traits: string[];
  createdAt: Date;
  updatedAt: Date;
  version: number;
  evolutionLog: PersonaEvolutionEntry[];
};
