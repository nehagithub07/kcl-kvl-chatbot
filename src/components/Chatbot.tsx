"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { getBotResponse } from "@/lib/chatbot";
import {
  HISTORY_KEY, completePending, createHistory, deleteConversation, parseHistory, queueAnswer, startConversation,
  type ChatHistory,
} from "@/lib/chatHistory";

// Keep this breakpoint in sync with the drawer styles in globals.css.
const COMPACT_SCREEN = "(max-width: 1023px)";

export default function Chatbot() {
  const [history, setHistory] = useState<ChatHistory | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const [storageError, setStorageError] = useState("");
  const historyRef = useRef<ChatHistory | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyToggleRef = useRef<HTMLButtonElement>(null);
  const appRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const ready = history !== null;

  const commit = useCallback((next: ChatHistory) => {
    historyRef.current = next;
    setHistory(next);
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      setStorageError("");
    } catch {
      setStorageError("Changes to your chat history could not be saved in this browser. They may be lost on refresh.");
    }
  }, []);

  useEffect(() => {
    // Hydrate after the server-rendered loading state; never overwrite storage
    // with an empty conversation before the saved history has been read.
    const timer = window.setTimeout(() => {
      let restored: ChatHistory | null = null;
      try {
        const serialized = window.localStorage.getItem(HISTORY_KEY);
        if (serialized) {
          restored = parseHistory(serialized);
          if (!restored) setStorageError("Saved history could not be read. New messages will start a new saved history.");
        }
      } catch {
        setStorageError("Saved history is unavailable in this browser. Chats may not survive a refresh.");
      }
      const next = restored ?? createHistory(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const compact = window.matchMedia(COMPACT_SCREEN).matches;
      next.sidebarOpen ??= !compact;
      setIsCompact(compact);
      historyRef.current = next;
      setHistory(next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_SCREEN);
    const update = () => setIsCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const app = appRef.current;
    const viewport = window.visualViewport;
    const update = () => {
      // Fit above the on-screen keyboard without interfering with pinch zoom.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      app?.style.setProperty("--lab-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
    };
    update();
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      app?.style.removeProperty("--lab-viewport-height");
    };
  }, [ready]);

  useEffect(() => {
    if (!history) return;
    const due = history.conversations.flatMap((conversation) => conversation.pending ? [conversation.pending.dueAt] : []);
    if (!due.length) return;
    const timer = window.setTimeout(() => {
      if (historyRef.current) commit(completePending(historyRef.current));
    }, Math.max(0, Math.min(...due) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [history, commit]);

  const conversation = history?.conversations.find((item) => item.id === history.activeId);
  const thinking = Boolean(conversation?.pending);
  const drawerOpen = isCompact && Boolean(history?.sidebarOpen);

  useEffect(() => {
    if (!drawerOpen) return;
    sidebarRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (historyRef.current) commit({ ...historyRef.current, sidebarOpen: false });
      }
      if (event.key !== "Tab") return;
      const buttons = sidebarRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!sidebarRef.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      historyToggleRef.current?.focus({ preventScroll: true });
    };
  }, [drawerOpen, commit]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [conversation?.id, conversation?.messages.length, thinking]);

  function ask() {
    const current = historyRef.current;
    const active = current?.conversations.find((item) => item.id === current.activeId);
    if (!current || !active || active.pending || !active.draft.trim()) return;
    commit(queueAnswer(current, active.id, active.draft, getBotResponse(active.draft, active.context)));
    inputRef.current?.focus();
  }

  function changeDraft(draft: string) {
    const current = historyRef.current;
    if (!current) return;
    commit({ ...current, conversations: current.conversations.map((item) => item.id === current.activeId ? { ...item, draft } : item) });
  }

  function newChat() {
    if (!historyRef.current) return;
    const next = startConversation(historyRef.current);
    if (window.matchMedia(COMPACT_SCREEN).matches) next.sidebarOpen = false;
    commit(next);
    inputRef.current?.focus();
  }

  function selectChat(id: string) {
    if (!historyRef.current) return;
    commit({ ...historyRef.current, activeId: id,
      sidebarOpen: window.matchMedia(COMPACT_SCREEN).matches ? false : historyRef.current.sidebarOpen });
  }

  function toggleHistory() {
    if (!historyRef.current) return;
    commit({ ...historyRef.current, sidebarOpen: !historyRef.current.sidebarOpen });
    historyToggleRef.current?.focus();
  }

  function deleteChat(id: string) {
    if (!historyRef.current) return;
    commit(deleteConversation(historyRef.current, id));
    if (drawerOpen) sidebarRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    else historyToggleRef.current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask();
  }

  if (!history || !conversation) {
    return <main className="lab-loading" role="status">Loading your conversations…</main>;
  }

  return (
    <main ref={appRef} className="lab-app" data-theme={history.theme}>
      <section className={`lab-shell ${history.sidebarOpen ? "history-open" : ""}`} aria-label="Virtual Lab Assistant">
        {drawerOpen && <button className="history-backdrop" type="button" tabIndex={-1} aria-label="Close chat history" onClick={toggleHistory} />}
        <aside ref={sidebarRef} id="chat-history" className="lab-sidebar" role={drawerOpen ? "dialog" : undefined} aria-modal={drawerOpen || undefined} aria-label="Chat history">
          <div className="sidebar-heading">
            <span className="lab-mark" aria-hidden="true">VL</span>
            <div><strong>Virtual Lab</strong><p>Your learning space</p></div>
            <button className="sidebar-close icon-button" type="button" aria-label="Hide chat history" title="Hide chat history" onClick={toggleHistory}>×</button>
          </div>
          <button className="new-chat-button" type="button" onClick={newChat}><span aria-hidden="true">＋</span> New chat</button>
          <p className="sidebar-label">CHAT HISTORY</p>
          <nav className="history-list" aria-label="Saved conversations">
            {[...history.conversations].sort((a, b) => b.updatedAt - a.updatedAt).map((item) => (
              <div key={item.id} className={`history-row ${item.id === history.activeId ? "is-active" : ""}`}>
                <button type="button" onClick={() => selectChat(item.id)} aria-current={item.id === history.activeId ? "page" : undefined} className="history-item">
                  <span className="history-title">{item.title}</span>
                  <span className="history-date">{item.pending ? "Thinking…" : new Date(item.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                </button>
                <button type="button" className="delete-chat-button" aria-label={`Delete chat: ${item.title}`} title="Delete chat" onClick={() => deleteChat(item.id)}>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
                  </svg>
                </button>
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">Your conversations stay in this browser.</div>
        </aside>

        <div className="lab-chat" inert={drawerOpen}>
          <header className="chat-heading">
            <div className="chat-heading-title">
              <button ref={historyToggleRef} className="history-toggle icon-button" type="button" aria-label={history.sidebarOpen ? "Hide chat history" : "Show chat history"} title={history.sidebarOpen ? "Hide chat history" : "Show chat history"} aria-controls="chat-history" aria-expanded={Boolean(history.sidebarOpen)} onClick={toggleHistory}>⋯</button>
              <div><h1>Virtual Lab Assistant</h1><p>KCL &amp; KVL · One conversation</p></div>
            </div>
            <div className="header-actions">
              <button className="icon-button" type="button" aria-label="New chat" title="New chat" onClick={newChat}>＋</button>
              <button type="button" className="theme-button" onClick={() => commit({ ...history, theme: history.theme === "light" ? "dark" : "light" })} aria-label={`Switch to ${history.theme === "light" ? "dark" : "light"} mode`}>
                <span aria-hidden="true">{history.theme === "light" ? "☾" : "☀"}</span><span>{history.theme === "light" ? "Dark mode" : "Light mode"}</span>
              </button>
            </div>
          </header>

          {storageError && <p className="storage-warning" role="alert">{storageError}</p>}

          <div ref={listRef} role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions" className="chat-messages">
            {conversation.messages.length === 0 && (
              <div className="chat-welcome">
                <div className="welcome-mark" aria-hidden="true">VL</div>
                <p className="welcome-eyebrow">KIRCHHOFF’S LAWS</p>
                <p>Ask about KCL, KVL, experiment procedures, circuit connections, or your readings.</p>
              </div>
            )}
            {conversation.messages.map((message) => (
              <div key={message.id} className={`chat-message-row ${message.role}`}>
                {message.role === "assistant" && <div className="message-avatar" aria-hidden="true">VL</div>}
                <div className="chat-bubble">
                  <span className="sr-only">{message.role === "user" ? "You: " : "Assistant: "}</span>
                  <p>{message.content}</p>
                </div>
              </div>
            ))}
            {thinking && (
              <div className="chat-message-row assistant">
                <div className="message-avatar" aria-hidden="true">VL</div>
                <div className="chat-bubble thinking-bubble" role="status"><span>Thinking</span><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span></div>
              </div>
            )}
          </div>

          <form className="chat-composer" onSubmit={submit}>
            <div className="composer-field">
              <label htmlFor="chat-question" className="sr-only">Your question</label>
              <textarea id="chat-question" ref={inputRef} value={conversation.draft} onChange={(event) => changeDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(); }
                }} rows={2} maxLength={4000} autoComplete="off" readOnly={thinking}
                placeholder={thinking ? "Your answer is on its way…" : "Ask your question about the experiment…"} />
              <button type="submit" className="send-button" disabled={thinking || !conversation.draft.trim()} aria-label="Send message">↑</button>
            </div>
            <p className="composer-note">Enter to send · Shift + Enter for a new line</p>
          </form>
        </div>
      </section>
    </main>
  );
}
