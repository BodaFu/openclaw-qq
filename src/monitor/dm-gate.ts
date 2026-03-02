/**
 * 私聊 dispatch 状态管理：debounce 合并 + 发送前打断。
 *
 * 机制：
 * 1. 用户连发多条消息时，debounce 合并为一次 dispatch
 * 2. agent 正在生成回复期间用户又发了新消息 → abort 当前 dispatch，
 *    新消息重新进入 debounce 流程，触发全新的 agent 思考
 */

export type DmPendingMessage = {
  senderName: string;
  text: string;
  timestamp: number;
  messageId: number;
};

type DmDispatchState = {
  pendingMessages: DmPendingMessage[];
  debounceTimer: NodeJS.Timeout | null;
  dispatchAbort: AbortController | null;
  dispatching: boolean;
};

const dmStates = new Map<string, DmDispatchState>();

export const DM_DEBOUNCE_MS_DEFAULT = 1500;

function getState(senderId: string): DmDispatchState {
  let state = dmStates.get(senderId);
  if (!state) {
    state = {
      pendingMessages: [],
      debounceTimer: null,
      dispatchAbort: null,
      dispatching: false,
    };
    dmStates.set(senderId, state);
  }
  return state;
}

/**
 * 入队一条私聊消息。
 * - 重置 debounce 计时器
 * - 如果当前有 dispatch 在执行，abort 它（用户补充了新内容，应重新思考）
 */
export function enqueueDmMessage(
  senderId: string,
  message: DmPendingMessage,
  debounceMs: number,
  onReady: (messages: DmPendingMessage[]) => void,
): void {
  const state = getState(senderId);
  state.pendingMessages.push(message);

  if (state.dispatching && state.dispatchAbort) {
    state.dispatchAbort.abort();
    state.dispatchAbort = null;
    state.dispatching = false;
  }

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
  }

  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    const messages = [...state.pendingMessages];
    state.pendingMessages = [];
    if (messages.length > 0) {
      onReady(messages);
    }
  }, debounceMs);
}

/**
 * 开始一次 dispatch，返回 AbortController 供 deliver 回调检查。
 */
export function startDmDispatch(senderId: string): AbortController {
  const state = getState(senderId);
  const abort = new AbortController();
  state.dispatchAbort = abort;
  state.dispatching = true;
  return abort;
}

/**
 * dispatch 完成后清理状态。
 */
export function endDmDispatch(senderId: string): void {
  const state = getState(senderId);
  state.dispatchAbort = null;
  state.dispatching = false;
}

/**
 * deliver 前调用：检查该用户是否有新的待处理消息。
 * 如果有，说明用户在 agent 思考期间补充了内容，当前回复应被放弃。
 */
export function hasPendingDmMessages(senderId: string): boolean {
  const state = dmStates.get(senderId);
  if (!state) return false;
  return state.pendingMessages.length > 0;
}
