import type { ChatContext, ChatResponse } from "../types/chatbot";

export const HISTORY_KEY = "virtual-lab-chat-history-v1";
export const THINKING_DELAY_MS = 2200;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  context: ChatContext;
  draft: string;
  pending?: { id: string; answer: string; context: ChatContext; dueAt: number };
}

export interface ChatHistory {
  version: 1;
  theme: "light" | "dark";
  sidebarOpen?: boolean;
  activeId: string;
  conversations: Conversation[];
}

function id(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createConversation(now = Date.now()): Conversation {
  return { id: id(), title: "New chat", updatedAt: now, messages: [], context: {}, draft: "" };
}

export function createHistory(theme: "light" | "dark" = "light"): ChatHistory {
  const conversation = createConversation();
  return { version: 1, theme, activeId: conversation.id, conversations: [conversation] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validContext(value: unknown): value is ChatContext {
  if (!isObject(value)) return false;
  return (value.experiment === undefined || value.experiment === "KCL" || value.experiment === "KVL") &&
    (value.lastMatchedId === undefined || (Number.isInteger(value.lastMatchedId) && Number(value.lastMatchedId) > 0)) &&
    (value.walkthroughStep === undefined || (Number.isInteger(value.walkthroughStep) && Number(value.walkthroughStep) >= 1 && Number(value.walkthroughStep) <= 12));
}

export function parseHistory(serialized: string): ChatHistory | null {
  try {
    const history: unknown = JSON.parse(serialized);
    if (!isObject(history) || history.version !== 1 || !["light", "dark"].includes(String(history.theme)) ||
        typeof history.activeId !== "string" || !Array.isArray(history.conversations) || !history.conversations.length ||
        (history.sidebarOpen !== undefined && typeof history.sidebarOpen !== "boolean")) return null;
    const seen = new Set<string>();
    for (const conversation of history.conversations) {
      if (!isObject(conversation) || typeof conversation.id !== "string" || !conversation.id || seen.has(conversation.id) ||
          typeof conversation.title !== "string" || !Number.isFinite(conversation.updatedAt) ||
          typeof conversation.draft !== "string" || !validContext(conversation.context) || !Array.isArray(conversation.messages)) return null;
      seen.add(conversation.id);
      const messageIds = new Set<string>();
      for (const message of conversation.messages) {
        if (!isObject(message) || typeof message.id !== "string" || messageIds.has(message.id) ||
            !["user", "assistant"].includes(String(message.role)) || typeof message.content !== "string") return null;
        messageIds.add(message.id);
      }
      if (conversation.pending !== undefined) {
        const pending = conversation.pending;
        if (!isObject(pending) || typeof pending.id !== "string" || messageIds.has(pending.id) ||
            typeof pending.answer !== "string" || !validContext(pending.context) || !Number.isFinite(pending.dueAt) ||
            conversation.messages.at(-1)?.role !== "user") return null;
      }
    }
    if (!seen.has(history.activeId)) return null;
    return history as unknown as ChatHistory;
  } catch {
    return null;
  }
}

export function queueAnswer(history: ChatHistory, conversationId: string, question: string, response: ChatResponse, now = Date.now()): ChatHistory {
  if (!question.trim()) return history;
  return {
    ...history,
    conversations: history.conversations.map((conversation) => {
      if (conversation.id !== conversationId || conversation.pending) return conversation;
      return {
        ...conversation,
        title: conversation.messages.length ? conversation.title : question.trim().slice(0, 70),
        messages: [...conversation.messages, { id: id(), role: "user" as const, content: question.trim() }],
        draft: "",
        updatedAt: now,
        // Save the pending answer immediately so refresh cannot lose a reply.
        pending: { id: id(), answer: response.answer, context: response.context, dueAt: now + THINKING_DELAY_MS },
      };
    }),
  };
}

export function completePending(history: ChatHistory, now = Date.now()): ChatHistory {
  if (!history.conversations.some((conversation) => conversation.pending && conversation.pending.dueAt <= now)) return history;
  return {
    ...history,
    conversations: history.conversations.map((conversation) => {
      if (!conversation.pending || conversation.pending.dueAt > now) return conversation;
      const { pending, ...rest } = conversation;
      return {
        ...rest,
        context: pending.context,
        updatedAt: now,
        messages: [...conversation.messages, { id: pending.id, role: "assistant" as const, content: pending.answer }],
      };
    }),
  };
}

export function startConversation(history: ChatHistory): ChatHistory {
  const empty = history.conversations.find((conversation) => !conversation.messages.length && !conversation.draft);
  if (empty) return { ...history, activeId: empty.id };
  const conversation = createConversation();
  return { ...history, activeId: conversation.id, conversations: [conversation, ...history.conversations] };
}

export function deleteConversation(history: ChatHistory, conversationId: string): ChatHistory {
  const remaining = history.conversations.filter((conversation) => conversation.id !== conversationId);
  if (remaining.length === history.conversations.length) return history;
  if (!remaining.length) {
    const conversation = createConversation();
    return { ...history, activeId: conversation.id, conversations: [conversation] };
  }
  const activeId = history.activeId === conversationId
    ? remaining.reduce((latest, conversation) => conversation.updatedAt > latest.updatedAt ? conversation : latest).id
    : history.activeId;
  return { ...history, activeId, conversations: remaining };
}
