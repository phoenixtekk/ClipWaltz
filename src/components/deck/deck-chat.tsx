"use client";
// "Edit with AI": a chat with the deck's editor. The owner says what to change ("make scene 3 punchier", "try a
// warmer look", "add a scene about pricing"); the deck worker answers and edits the storyboard (worker/deck/jobs.mjs
// chatEdit → planner.mjs editDeck). The editor polls while it's thinking; the changes show up in the storyboard.
import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquareText, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { unwrap } from "@/lib/action-result";
import { askDeckAi, clearDeckChat } from "@/lib/deck-actions";
import { chatThinking, type DeckChat } from "@/lib/deck/types";

const SUGGESTIONS = [
  "Give it a completely different look",
  "Make the opening punchier",
  "Shorten the voiceover lines",
  "Add a real filmed shot to the opening",
  "Turn the features into a before / after",
];

export function DeckChatPanel({ projectId, chat, canEdit, hasScenes, onChanged, onRender }: {
  projectId: string; chat: DeckChat; canEdit: boolean; hasScenes: boolean;
  onChanged: () => Promise<void> | void; onRender: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const thinking = chatThinking(chat) || sending;
  const msgs = chat.messages ?? [];
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [msgs.length, thinking, open]);

  const send = async (msg: string) => {
    const m = msg.trim();
    if (!m || thinking) return;
    setSending(true);
    try {
      unwrap(await askDeckAi(projectId, m));
      setText("");
      await onChanged();
    } catch (e) { toast.error((e as Error).message || "Couldn't send that."); }
    setSending(false);
  };
  const last = msgs[msgs.length - 1];

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={!hasScenes}
        title={hasScenes ? "Tell the AI what to change" : "Plan the video first"}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-xl transition hover:brightness-110 disabled:opacity-50">
        <MessageSquareText className="size-4" /> Edit with AI
        {thinking ? <Loader2 className="size-3.5 animate-spin" /> : null}
      </button>
    );
  }
  return (
    <section aria-label="Edit with AI" className="fixed bottom-5 right-5 z-40 flex h-[min(560px,calc(100vh-6rem))] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="size-4 text-primary" />
        <p className="flex-1 text-sm font-semibold">Edit with AI</p>
        {msgs.length && canEdit ? (
          <button type="button" className="rounded-md p-1 text-muted-foreground hover:text-foreground" title="Start the chat over (your video isn't changed)"
            onClick={async () => { try { unwrap(await clearDeckChat(projectId)); await onChanged(); } catch (e) { toast.error((e as Error).message); } }}>
            <RotateCcw className="size-4" />
          </button>
        ) : null}
        <button type="button" className="rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label="Close" onClick={() => setOpen(false)}><X className="size-4" /></button>
      </header>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {!msgs.length ? (
          <div className="space-y-2 text-muted-foreground">
            <p>Tell me what to change — the words, the voiceover, the order, the scenes, the look. I&apos;ll edit the storyboard; then render again.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" disabled={!canEdit || thinking} onClick={() => void send(s)}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground hover:border-primary/60 disabled:opacity-50">{s}</button>
              ))}
            </div>
          </div>
        ) : null}
        {msgs.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-3 py-2", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.changes?.length ? (
                <ul className="mt-1.5 space-y-0.5 border-t border-border/60 pt-1.5 text-xs text-muted-foreground">
                  {m.changes.map((c, i) => <li key={i}>• {c}</li>)}
                </ul>
              ) : null}
            </div>
          </div>
        ))}
        {thinking ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Working on it…</div>
        ) : null}
        {!thinking && last?.role === "assistant" && last.changes?.length ? (
          <Button size="sm" variant="secondary" onClick={onRender}>Render the new version</Button>
        ) : null}
      </div>
      <form className="flex items-end gap-2 border-t border-border p-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={!canEdit} rows={2} maxLength={600}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
          placeholder={canEdit ? "e.g. Make scene 2 about saving time, and use a warmer look" : "You can view this deck but not edit it."}
          className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        <Button type="submit" size="icon" disabled={!canEdit || thinking || !text.trim()} aria-label="Send"><Send className="size-4" /></Button>
      </form>
    </section>
  );
}
