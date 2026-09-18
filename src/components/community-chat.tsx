"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Send, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { ChatMessage } from "@/lib/chat";

function initials(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function CommunityChat({
  initialMessages,
  currentUserId,
}: {
  initialMessages: ChatMessage[];
  currentUserId: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, start] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll for new messages.
  useEffect(() => {
    let alive = true;
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/chat", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { messages: ChatMessage[] };
        if (alive) setMessages(j.messages);
      } catch {
        /* transient */
      }
    }, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Keep the view pinned to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function send() {
    const body = text.trim();
    if (!body) return;
    start(async () => {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body }),
        });
        if (!res.ok) throw new Error();
        const j = (await res.json()) as { messages: ChatMessage[] };
        setMessages(j.messages);
        setText("");
      } catch {
        toast.error("Could not send your message.");
      }
    });
  }

  return (
    <div className="cw-glass flex h-[26rem] flex-col rounded-2xl p-3">
      <h3 className="flex items-center gap-1.5 px-1 pb-2 text-sm font-semibold">
        <MessageCircle className="size-4 text-[color:var(--cw-violet)]" /> Community chat
      </h3>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="cw-subtle px-1 py-6 text-center text-xs">
            No messages yet — say hi to the community 👋
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.authorId === currentUserId;
            return (
              <div key={m.id} className={cn("flex gap-2", mine && "flex-row-reverse")}>
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium">
                  {initials(m.authorName)}
                </span>
                <div className={cn("max-w-[80%] rounded-2xl px-3 py-1.5", mine ? "bg-primary/15" : "bg-card")}>
                  {!mine ? <p className="text-[11px] font-medium text-muted-foreground">{m.authorName}</p> : null}
                  <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          maxLength={500}
          placeholder="Message the community…"
          className="h-9 flex-1 rounded-full border border-border bg-background px-3.5 text-sm outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          aria-label="Send"
          className="cw-gradient grid size-9 shrink-0 place-items-center rounded-full text-white disabled:opacity-50"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}
