import { MongoClient, type Db, type Collection } from "mongodb";
import type { ChatDocument, ChatArchive } from "./types.js";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(uri: string, dbName: string): Promise<Db> {
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  await ensureIndexes(db);
  return db;
}

export async function disconnectMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

export function getDb(): Db {
  if (!db) throw new Error("MongoDB not connected. Call connectMongo() first.");
  return db;
}

export function chatMessages(): Collection<ChatDocument> {
  return getDb().collection<ChatDocument>("chat_messages");
}

export function chatArchives(): Collection<ChatArchive> {
  return getDb().collection<ChatArchive>("chat_archives");
}

async function ensureIndexes(database: Db): Promise<void> {
  await database
    .collection("chat_messages")
    .createIndex({ chatKey: 1 }, { unique: true });
  await database
    .collection("chat_archives")
    .createIndex({ chatKey: 1, compactIndex: 1 });
  await database
    .collection("qq_user_personas")
    .createIndex({ userId: 1 }, { unique: true });
}
