"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { MessageCircle, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { CommentItem } from "@/lib/comments";
import { addRenderComment, deleteRenderComment } from "@/lib/comments-actions";

function initials(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}
function when(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

export function RenderComments({
  renderId,
  initialComments,
  currentUserId,
  isAdmin = false,
}: {
  renderId: string;
  initialComments: CommentItem[];
  currentUserId: string | null;
  isAdmin?: boolean;
}) {
  const [comments, setComments] = useState<CommentItem[]>(initialComments);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  function add() {
    const body = text.trim();
    if (!body) return;
    start(async () => {
      try {
        const next = await addRenderComment(renderId, body);
        setComments(next);
        setText("");
      } catch (e) {
        toast.error((e as Error).message || "Could not post your comment.");
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      try {
        setComments(await deleteRenderComment(id));
      } catch {
        toast.error("Could not delete the comment.");
      }
    });
  }

  return (
    <div className="cw-glass mt-8 w-full max-w-2xl rounded-2xl p-5 text-left">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <MessageCircle className="size-4 text-[color:var(--cw-violet)]" /> Comments
        <span className="cw-subtle font-normal">({comments.length})</span>
      </h2>

      <div className="mt-4 space-y-4">
        {comments.length === 0 ? (
          <p className="cw-subtle text-sm">Be the first to comment.</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="group flex gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium">
                {initials(c.authorName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <Link href={`/u/${c.authorId}`} className="font-medium hover:underline">
                    {c.authorName}
                  </Link>{" "}
                  <span className="cw-subtle text-xs">· {when(c.createdAt)}</span>
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
              </div>
              {currentUserId && (c.authorId === currentUserId || isAdmin) ? (
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  disabled={pending}
                  aria-label="Delete comment"
                  className="cw-subtle opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>

      {currentUserId ? (
        <div className="mt-5 flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                add();
              }
            }}
            maxLength={1000}
            placeholder="Add a comment…"
            className="h-10 flex-1 rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={add}
            disabled={pending || !text.trim()}
            aria-label="Post comment"
            className="cw-gradient grid size-10 shrink-0 place-items-center rounded-full text-white disabled:opacity-50"
          >
            <Send className="size-4" />
          </button>
        </div>
      ) : (
        <p className="cw-subtle mt-5 text-sm">
          <Link href="/sign-in" className="font-medium text-[color:var(--cw-violet)] hover:underline">
            Sign in
          </Link>{" "}
          to join the conversation.
        </p>
      )}
    </div>
  );
}
