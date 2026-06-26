"use client";

/**
 * Wind Energy Chatbot — Pro RAG assistant over 25 years of Indian wind-energy
 * directories. Streams answers from /api/chat over SSE and renders markdown
 * with collapsible source citations.
 *
 * This is the embeddable core: it fills its parent (a flex column) rather than
 * owning the full viewport, so it can live inside the Research section's
 * sidebar layout. The portal TopBar already provides logo / account chrome.
 */

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSession } from "@/lib/auth-client";

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

export default function ChatBot() {
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
      <div className="flex-1 min-h-0 flex items-center justify-center text-muted/60 text-sm">
        Loading…
      </div>
    );
  }

  if (!isPro) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full bg-[#0d1628] border border-[#1e2c44] rounded-2xl p-7 shadow-2xl">
          <h1 className="text-[18px] font-bold mb-1">Pro subscription required</h1>
          <p className="text-[12px] text-muted/70 mb-5">
            The Wind Energy chatbot is available to Pro accounts only.
          </p>
          <p className="text-[12px] text-muted/60">
            Signed in as <span className="text-text">{user?.email ?? "—"}</span> (tier:{" "}
            <span className="text-text">{user?.tier ?? "FREE"}</span>)
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#090d18] text-text">
      <header className="flex-none border-b border-[#1e2c44] px-5 py-3 flex items-center gap-3">
        <h1 className="text-[13px] font-bold tracking-wide">Wind Energy Chatbot</h1>
        <span className="text-[10px] uppercase tracking-wider text-orange/80 bg-orange/10 border border-orange/30 rounded px-1.5 py-0.5">
          Pro
        </span>
      </header>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
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

      <div className="flex-none border-t border-[#1e2c44] bg-[#090d18] px-4 py-3">
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
        <div className="px-3 py-2 rounded-lg bg-[#0d1628] border border-[#1e2c44] text-[13px] text-text">
          {message.text ? (
            <AssistantMarkdown text={message.text} />
          ) : (
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

function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="assistant-md text-[13px] leading-[1.55] text-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="my-2 first:mt-0 last:mb-0 whitespace-pre-wrap">{children}</p>
          ),
          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 text-[15px] font-bold tracking-tight text-text">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-4 mb-2 text-[14px] font-bold tracking-tight text-text">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 mb-1.5 text-[13px] font-bold tracking-tight text-text">{children}</h3>
          ),
          ul: ({ children }) => <ul className="my-2 pl-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 pl-5 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-[1.5]">{children}</li>,
          strong: ({ children }) => <strong className="font-bold text-text">{children}</strong>,
          em: ({ children }) => <em className="italic text-text/90">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange/85 hover:text-orange underline underline-offset-2"
            >
              {children}
            </a>
          ),
          code: ({ children, ...props }) => {
            const inline = !(props as { className?: string }).className;
            return inline ? (
              <code className="px-1 py-0.5 rounded bg-[#07090f] border border-[#1e2c44] text-[11.5px] font-mono text-orange/90">
                {children}
              </code>
            ) : (
              <code className="block whitespace-pre overflow-x-auto p-3 rounded-lg bg-[#07090f] border border-[#1e2c44] text-[11.5px] font-mono text-text">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="my-2 not-prose">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 pl-3 border-l-2 border-orange/40 text-muted/85">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-0 border-t border-[#1e2c44]" />,
          // GFM tables: wrap in a horizontally scrollable container so wide
          // tables (e.g. mast directories with 15+ columns) don't blow out
          // the message bubble. Tight padding + small font keeps them readable.
          table: ({ children }) => (
            <div className="my-3 -mx-1 overflow-x-auto rounded-lg border border-[#1e2c44]">
              <table className="min-w-full text-[11.5px] border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[#07090f] text-muted/85">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-[#1e2c44] last:border-b-0">{children}</tr>
          ),
          th: ({ children, style }) => (
            <th
              style={style}
              className="px-2 py-1.5 text-left font-bold tracking-tight whitespace-nowrap"
            >
              {children}
            </th>
          ),
          td: ({ children, style }) => (
            <td
              style={style}
              className="px-2 py-1.5 align-top text-text/90 whitespace-nowrap tabular-nums"
            >
              {children}
            </td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
