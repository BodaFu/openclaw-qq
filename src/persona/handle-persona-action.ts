import { jsonResult, readStringParam } from "openclaw/plugin-sdk";
import { savePersona } from "../store/persona-store.js";

const MAX_PERSONA_LENGTH = 500;

export async function handlePersonaUpdate(params: Record<string, unknown>) {
  const userId = readStringParam(params, "userId", { required: true });
  const persona = readStringParam(params, "persona", { required: true });
  const reason = readStringParam(params, "reason", { required: true });
  const nickname = readStringParam(params, "nickname");
  const likoNickname = readStringParam(params, "likoNickname");

  const rawTraits = params.traits;
  const traits = Array.isArray(rawTraits)
    ? rawTraits.filter((t): t is string => typeof t === "string")
    : undefined;

  if (persona.length > MAX_PERSONA_LENGTH) {
    return jsonResult({
      ok: false,
      error: `人格描述超过 ${MAX_PERSONA_LENGTH} 字限制（当前 ${persona.length} 字），请精简后重试`,
    });
  }

  const saved = await savePersona(userId, {
    persona,
    nickname,
    likoNickname,
    traits,
    reason,
  });

  return jsonResult({
    ok: true,
    userId: saved.userId,
    version: saved.version,
    nickname: saved.nickname,
    likoNickname: saved.likoNickname,
    traits: saved.traits,
  });
}
