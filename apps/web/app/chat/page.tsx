"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "@/lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Source {
  n: number;
  source_file: string;
  year: number;
  section: string;
  page_start: number;
  page_end: number;
  score: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: Source[];
  model?: string;
  streaming?: boolean;
  error?: string;
}

function newId() {
  return Math.random().toString(36).slice(2);
}

// Parse a single SSE block ("event: X\ndata: {...}") into [event, parsedData].
function parseSseBlock(block: string): [string, unknown] | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
  }
  if (dataLines.length === 0) return null;
  try {
    return [event, JSON.parse(dataLines.join("\n"))];
  } catch {
    return null;
  }
}

export default function ChatPage() {
  const { data: session, isPending } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const user = session?.user as
    | { name?: string; email: string; tier?: string | null }
    | undefined;
  const isPro = user?.tier === "PREMIUM";

  async function send() {
    const query = input.trim();
    if (!query || streaming) return;
    setInput("");

    const userMsg: Message = { id: newId(), role: "user", text: query };
    const assistantId = newId();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      text: "",
      streaming: true,
    };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
        );
      }
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          const parsed = parseSseBlock(block);
          if (!parsed) continue;
          const [event, data] = parsed;
          if (event === "meta") {
            const d = data as { model: string; sources: Source[] };
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, model: d.model, sources: d.sources }
                  : msg,
              ),
            );
          } else if (event === "delta") {
            const d = data as { text: string };
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, text: msg.text + d.text }
                  : msg,
              ),
            );
          } else if (event === "error") {
            const d = data as { message: string };
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, error: d.message, streaming: false }
                  : msg,
              ),
            );
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId
            ? { ...msg, error: message, streaming: false }
            : msg,
        ),
      );
    } finally {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId ? { ...msg, streaming: false } : msg,
        ),
      );
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (isPending) {
    return (
      <div className="min-h-screen bg-[#090d18] text-text flex items-center justify-center">
        <div className="text-muted/60 text-sm">Loading…</div>
      </div>
    );
  }

  if (!isPro) {
    return (
      <div className="min-h-screen bg-[#090d18] text-text flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-[#0d1628] border border-[#1e2c44] rounded-2xl p-7 shadow-2xl">
          <h1 className="text-[18px] font-bold mb-1">Pro subscription required</h1>
          <p className="text-[12px] text-muted/70 mb-5">
            The Wind Energy chatbot is available to Pro accounts only.
          </p>
          <p className="text-[12px] text-muted/60">
            Signed in as <span className="text-text">{user?.email}</span> (tier:{" "}
            <span className="text-text">{user?.tier ?? "FREE"}</span>)
          </p>
          <button
            onClick={() => signOut()}
            className="mt-5 w-full px-3 py-2 rounded-lg bg-[#07090f] border border-[#1e2c44] text-[13px] text-muted hover:text-text hover:border-orange/50 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#090d18] text-text">
      <header className="border-b border-[#1e2c44] px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-[12px] text-muted/60 hover:text-text">
            ← Home
          </Link>
          <span className="text-muted/30">|</span>
          <h1 className="text-[13px] font-bold tracking-wide">
            Wind Energy Chatbot
          </h1>
          <span className="text-[10px] uppercase tracking-wider text-orange/80 bg-orange/10 border border-orange/30 rounded px-1.5 py-0.5">
            Pro
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted/60">
          <span>{user?.email}</span>
          <button
            onClick={() => signOut()}
            className="hover:text-text transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {messages.length === 0 && (
            <div className="text-center text-muted/60 text-[13px] py-12">
              Ask anything about 25 years of Indian wind-energy directories.
              <div className="mt-4 grid gap-2 max-w-md mx-auto text-left">
                {[
                  "Which states had the highest installed wind capacity in 2025?",
                  "What was India's total installed wind capacity in 2025?",
                  "Top wind turbine manufacturers operating in India",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="text-[12px] text-left px-3 py-2 bg-[#0d1628] border border-[#1e2c44] rounded-lg hover:border-orange/40 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <MessageView key={m.id} message={m} />
          ))}
        </div>
      </div>

      <div className="border-t border-[#1e2c44] px-4 py-3">
        <div className="max-w-3xl mx-auto flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about wind capacity, manufacturers, state breakdowns…"
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none px-3 py-2 rounded-lg bg-[#07090f] border border-[#1e2c44] text-[13px] text-text placeholder:text-muted/40 focus:outline-none focus:border-orange/50 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="px-4 py-2 rounded-lg bg-orange text-[#07090f] text-[13px] font-bold hover:bg-orange/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {streaming ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageView({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] px-3 py-2 rounded-lg bg-[#152238] border border-[#1e2c44] text-[13px] whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] w-full">
        <div className="px-3 py-2 rounded-lg bg-[#0d1628] border border-[#1e2c44] text-[13px] whitespace-pre-wrap text-text">
          {message.text || (
            <span className="text-muted/40 italic">thinking…</span>
          )}
          {message.streaming && message.text && (
            <span className="inline-block w-2 h-3 ml-0.5 bg-orange/70 animate-pulse" />
          )}
          {message.error && (
            <div className="mt-2 text-[11px] text-[#e85c5c] bg-[#1c0d0d]/60 border border-[#3a1515]/60 rounded px-2 py-1">
              {message.error}
            </div>
          )}
        </div>
        {message.sources && message.sources.length > 0 && (
          <details className="mt-2 text-[11px]">
            <summary className="text-muted/60 cursor-pointer hover:text-text">
              {message.sources.length} sources
              {message.model && (
                <span className="ml-2 text-muted/40">· {message.model}</span>
              )}
            </summary>
            <ol className="mt-2 space-y-1 pl-1">
              {message.sources.map((s) => (
                <li
                  key={s.n}
                  className="px-2 py-1 bg-[#07090f] border border-[#1e2c44] rounded"
                >
                  <span className="text-orange/80 font-bold">[{s.n}]</span>{" "}
                  <span className="text-text">{s.source_file}</span>{" "}
                  <span className="text-muted/60">
                    · {s.year}
                    {s.page_start > 0 && ` · pp.${s.page_start}–${s.page_end}`}
                    {" · "}score {s.score.toFixed(3)}
                  </span>
                  <div className="text-muted/70 text-[10px] mt-0.5">
                    {s.section}
                  </div>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}
