import assert from "node:assert/strict";
import { test } from "node:test";
import history from "../.test-build/lib/chatHistory.js";

const { createHistory, parseHistory, queueAnswer, completePending, startConversation, deleteConversation, THINKING_DELAY_MS } = history;
const response = { answer: "15 V DC.", matched: true, context: { experiment: "KCL", lastMatchedId: 287 } };

test("refresh preserves messages, active conversation, theme and context", () => {
  let state = createHistory("dark");
  state = queueAnswer(state, state.activeId, "What is the supply rating?", response, 1000);
  state = completePending(state, 1000 + THINKING_DELAY_MS);
  const restored = parseHistory(JSON.stringify(state));
  assert.deepEqual(restored, state);
  assert.equal(restored.theme, "dark");
  assert.equal(restored.conversations[0].messages.length, 2);
  assert.equal(restored.conversations[0].context.lastMatchedId, 287);
});

test("refresh during thinking recovers the pending answer exactly once", () => {
  let state = createHistory();
  state = queueAnswer(state, state.activeId, "Supply rating?", response, 1000);
  assert.equal(state.conversations[0].messages.length, 1);
  const restored = parseHistory(JSON.stringify(state));
  assert.equal(completePending(restored, 1000 + THINKING_DELAY_MS - 1).conversations[0].messages.length, 1);
  const completed = completePending(restored, 1000 + THINKING_DELAY_MS);
  assert.equal(completed.conversations[0].messages[1].content, "15 V DC.");
  assert.equal(completed.conversations[0].pending, undefined);
  assert.deepEqual(completePending(completed, 100000), completed);
});

test("new chat preserves old history and pending replies stay in their own conversation", () => {
  let state = createHistory();
  const oldId = state.activeId;
  state = queueAnswer(state, oldId, "First question", response, 1000);
  state = startConversation(state);
  const newId = state.activeId;
  assert.notEqual(newId, oldId);
  state = completePending(state, 1000 + THINKING_DELAY_MS);
  assert.equal(state.conversations.find(item => item.id === oldId).messages.length, 2);
  assert.equal(state.conversations.find(item => item.id === newId).messages.length, 0);
  const restored = parseHistory(JSON.stringify({ ...state, activeId: oldId }));
  assert.equal(restored.activeId, oldId);
});

test("corrupt or malformed storage is rejected without crashing", () => {
  for (const input of ["not json", "null", "{}", '{"version":99}', '{"version":1,"conversations":[null]}']) assert.equal(parseHistory(input), null);
  const state = createHistory();
  assert.equal(parseHistory(JSON.stringify({ ...state, activeId: "missing" })), null);
  assert.equal(parseHistory(JSON.stringify({ ...state, conversations: [{ ...state.conversations[0], messages: [{ role: "system", id: "bad", content: "bad" }] }] })), null);
});

test("duplicate submits cannot replace an answer while thinking", () => {
  let state = createHistory();
  state = queueAnswer(state, state.activeId, "First question", response, 1000);
  const duplicate = queueAnswer(state, state.activeId, "Second question", { ...response, answer: "Wrong reply" }, 1100);
  assert.deepEqual(duplicate.conversations, state.conversations);
});

test("new conversations have fresh context while drafts remain in saved chats", () => {
  const state = createHistory("dark");
  state.conversations[0].draft = "I need the KVL procedure";
  state.conversations[0].context = { experiment: "KCL", walkthroughStep: 4 };
  const next = startConversation(state);
  const restored = parseHistory(JSON.stringify(next));
  assert.equal(restored.conversations.find(item => item.id === state.activeId).draft, "I need the KVL procedure");
  assert.deepEqual(restored.conversations.find(item => item.id === next.activeId).context, {});
  assert.equal(restored.theme, "dark");
});

test("deleting a saved chat persists without changing the active conversation", () => {
  let state = createHistory();
  const oldId = state.activeId;
  state = completePending(queueAnswer(state, oldId, "Old question", response, 1000), 1000 + THINKING_DELAY_MS);
  state = startConversation(state);
  const activeId = state.activeId;
  const active = state.conversations.find(item => item.id === activeId);
  const restored = parseHistory(JSON.stringify(deleteConversation(state, oldId)));
  assert.equal(restored.activeId, activeId);
  assert.deepEqual(restored.conversations, [active]);
  assert.equal(state.conversations.length, 2);
});

test("deleting the active chat selects the latest remaining chat and cancels its pending reply", () => {
  let state = createHistory();
  const firstId = state.activeId;
  state = completePending(queueAnswer(state, firstId, "First question", response, 1000), 1000 + THINKING_DELAY_MS);
  state = startConversation(state);
  const secondId = state.activeId;
  state = queueAnswer(state, secondId, "Second question", response, 4000);
  state = startConversation(state);
  const deletedId = state.activeId;
  state = queueAnswer(state, deletedId, "Delete this pending question", response, 5000);
  const deleted = deleteConversation(state, deletedId);
  assert.equal(deleted.activeId, secondId);
  const completed = completePending(parseHistory(JSON.stringify(deleted)), 10000);
  assert.equal(completed.conversations.length, 2);
  assert.ok(completed.conversations.every(item => item.id !== deletedId));
  assert.equal(completed.conversations.find(item => item.id === secondId).messages.length, 2);
});

test("deleting the last chat starts fresh and preserves theme and sidebar preference", () => {
  let state = { ...createHistory("dark"), sidebarOpen: false };
  const deletedId = state.activeId;
  state = queueAnswer(state, deletedId, "Delete my only chat", response, 1000);
  const restored = parseHistory(JSON.stringify(deleteConversation(state, deletedId)));
  assert.equal(restored.conversations.length, 1);
  assert.notEqual(restored.activeId, deletedId);
  assert.deepEqual(restored.conversations[0].messages, []);
  assert.deepEqual(restored.conversations[0].context, {});
  assert.equal(restored.conversations[0].pending, undefined);
  assert.equal(restored.theme, "dark");
  assert.equal(restored.sidebarOpen, false);
  assert.equal(completePending(restored, 10000).conversations[0].messages.length, 0);
  assert.ok(parseHistory(JSON.stringify(createHistory())));
});
