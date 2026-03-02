import { getDb } from "./connection.js";
import type { Collection } from "mongodb";
import type { UserPersona, PersonaEvolutionEntry } from "./types.js";

const COLLECTION = "qq_user_personas";
const MAX_EVOLUTION_LOG = 20;
const MAX_PERSONA_LENGTH = 500;

function collection(): Collection<UserPersona> {
  return getDb().collection<UserPersona>(COLLECTION);
}

export async function loadPersona(userId: string): Promise<UserPersona | null> {
  return collection().findOne({ userId });
}

export async function savePersona(
  userId: string,
  update: {
    persona: string;
    nickname?: string;
    likoNickname?: string;
    traits?: string[];
    reason: string;
  },
): Promise<UserPersona> {
  const truncatedPersona = update.persona.slice(0, MAX_PERSONA_LENGTH);

  const evolutionEntry: PersonaEvolutionEntry = {
    trigger: update.reason,
    change: truncatedPersona.slice(0, 100),
    timestamp: new Date(),
  };

  const existing = await collection().findOne({ userId });

  if (existing) {
    const newVersion = existing.version + 1;
    const newLog = [...existing.evolutionLog, evolutionEntry].slice(-MAX_EVOLUTION_LOG);

    await collection().updateOne(
      { userId },
      {
        $set: {
          persona: truncatedPersona,
          ...(update.nickname !== undefined && { nickname: update.nickname }),
          ...(update.likoNickname !== undefined && { likoNickname: update.likoNickname }),
          ...(update.traits !== undefined && { traits: update.traits }),
          version: newVersion,
          evolutionLog: newLog,
          updatedAt: new Date(),
        },
      },
    );

    return {
      ...existing,
      persona: truncatedPersona,
      nickname: update.nickname ?? existing.nickname,
      likoNickname: update.likoNickname ?? existing.likoNickname,
      traits: update.traits ?? existing.traits,
      version: newVersion,
      evolutionLog: newLog,
      updatedAt: new Date(),
    };
  }

  const doc: UserPersona = {
    userId,
    persona: truncatedPersona,
    nickname: update.nickname ?? "",
    likoNickname: update.likoNickname ?? "",
    traits: update.traits ?? [],
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    evolutionLog: [evolutionEntry],
  };

  await collection().insertOne(doc);
  return doc;
}

export async function ensurePersonaIndexes(): Promise<void> {
  await getDb()
    .collection(COLLECTION)
    .createIndex({ userId: 1 }, { unique: true });
}
