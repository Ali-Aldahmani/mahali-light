"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { Transition, Variants } from "motion/react";
import { Check, ChevronRight, CornerDownRight, SmilePlus, X } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./comment-thread.module.css";

export interface CommentAuthor {
  id: string;
  name: string;
  /** Square image URL. Initials are shown without one. */
  avatar?: string;
}

export interface CommentReaction {
  emoji: string;
  /** Ids of the people who reacted. */
  users: string[];
}

export interface ThreadComment {
  id: string;
  author: CommentAuthor;
  /** Plain text. "@Full Name" mentions of known people are highlighted. */
  body: string;
  /** Display label such as "2h" or "Sep 18". */
  createdAt: string;
  parentId?: string | null;
  edited?: boolean;
  /** A deleted comment that still has replies keeps its place as a quiet placeholder. */
  deleted?: boolean;
  reactions?: CommentReaction[];
  replies?: ThreadComment[];
}

/** What changed, for syncing to a server. Comments are immutable; only reply and react are supported. */
export type CommentThreadEvent =
  | { type: "reply"; comment: ThreadComment; parentId: string | null }
  | { type: "react"; id: string; emoji: string; added: boolean };

/** Every word the thread shows or announces. */
export interface CommentThreadLabels {
  thread?: string;
  commentCount?: (count: number) => string;
  peopleCount?: (count: number) => string;
  empty?: string;
  reply?: string;
  cancel?: string;
  send?: string;
  replyingTo?: (name: string) => string;
  cancelReply?: string;
  showReplies?: (count: number) => string;
  hideReplies?: string;
  addReaction?: string;
  closeReactions?: string;
  reactions?: string;
  reactWith?: (emoji: string) => string;
  reactionCount?: (emoji: string, count: number, includesYou: boolean) => string;
  mentions?: string;
  noPermissionToComment?: string;
}

const DEFAULT_LABELS: Required<CommentThreadLabels> = {
  thread: "Discussion & Comments",
  commentCount: count => `${count} ${count === 1 ? "comment" : "comments"}`,
  peopleCount: count => `${count} ${count === 1 ? "person" : "people"}`,
  empty: "No comments yet. Start the conversation below.",
  reply: "Reply",
  cancel: "Cancel",
  send: "Send",
  replyingTo: name => `Replying to ${name}`,
  cancelReply: "Cancel reply",
  showReplies: count => `Show ${count} ${count === 1 ? "reply" : "replies"}`,
  hideReplies: "Hide replies",
  addReaction: "Add reaction",
  closeReactions: "Close reactions",
  reactions: "Reactions",
  reactWith: emoji => `React with ${emoji}`,
  reactionCount: (emoji, count, includesYou) => `${emoji} ${count}${includesYou ? ", including you" : ""}`,
  mentions: "People",
  noPermissionToComment: "You do not have permission to post comments on this purchase order.",
};

const withDefaults = <T extends object>(defaults: Required<T>, given?: T): Required<T> =>
  ({ ...defaults, ...Object.fromEntries(Object.entries(given ?? {}).filter(([, value]) => value !== undefined)) });

export interface CommentThreadProps {
  comments?: ThreadComment[];
  defaultComments?: ThreadComment[];
  onCommentsChange?: (comments: ThreadComment[], event: CommentThreadEvent) => void;
  /** Callback specifically invoked when a comment is submitted to the backend */
  onSubmitComment?: (body: string, parentId: string | null) => Promise<void> | void;
  /** Callback specifically invoked when a reaction is toggled */
  onToggleReaction?: (commentId: string, emoji: string, added: boolean) => Promise<void> | void;
  /** The person writing. */
  currentUser: CommentAuthor;
  /** People who can be mentioned. Preserved for future mention activation. */
  people?: CommentAuthor[];
  /** Feature flag: mentions disabled by default per POS specifications. */
  mentionsEnabled?: boolean;
  /** What the thread is about, shown in its header. */
  title?: ReactNode;
  /** Emoji offered by the reaction picker. */
  reactions?: string[];
  placeholder?: string;
  /** Replies deeper than this attach to the deepest allowed parent. Defaults to 2. */
  maxDepth?: number;
  /** Label for comments written now. */
  nowLabel?: string;
  /** Words for localization. */
  labels?: CommentThreadLabels;
  className?: string;
  /** Whether the user has permission to create comments. */
  canCreate?: boolean;
  /** Whether the user has permission to react to comments. */
  canReact?: boolean;
  /** Whether a submission is in flight. */
  isSubmitting?: boolean;
}

type Bezier = [number, number, number, number];
const enter = [...motionTokens.ease.enter] as Bezier;
const standard = [...motionTokens.ease.standard] as Bezier;
const physical = (visualDuration: number, bounce: number): Transition => {
  const root = 2 * Math.PI / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1 };
};
const HEIGHT = physical(.42, 0);
const DEFAULT_REACTIONS = ["👍", "❤️", "🎉", "👀", "🚀", "✅"];

const subscribe = () => () => {};
function useReducedFlag() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

/* Tree helpers. */
const mapTree = (list: ThreadComment[], id: string, fn: (comment: ThreadComment) => ThreadComment | null): ThreadComment[] =>
  list.flatMap(comment => {
    if (comment.id === id) { const next = fn(comment); return next ? [next] : []; }
    return comment.replies?.length ? [{ ...comment, replies: mapTree(comment.replies, id, fn) }] : [comment];
  });
const countTree = (list: ThreadComment[]): number => list.reduce((sum, comment) => sum + (comment.deleted ? 0 : 1) + countTree(comment.replies ?? []), 0);
const authorsOf = (list: ThreadComment[], into = new Map<string, CommentAuthor>()) => {
  list.forEach(comment => { if (!comment.deleted) into.set(comment.author.id, comment.author); authorsOf(comment.replies ?? [], into); });
  return into;
};
const pathTo = (list: ThreadComment[], id: string, trail: string[] = []): string[] | null => {
  for (const comment of list) {
    if (comment.id === id) return [...trail, id];
    const found = pathTo(comment.replies ?? [], id, [...trail, comment.id]);
    if (found) return found;
  }
  return null;
};
const find = (list: ThreadComment[], id: string): ThreadComment | null => {
  for (const comment of list) {
    if (comment.id === id) return comment;
    const found = find(comment.replies ?? [], id);
    if (found) return found;
  }
  return null;
};
const highlight = (text: string, part: string, className?: string): ReactNode => {
  const at = part ? text.indexOf(part) : -1;
  return at < 0 ? text : <>{text.slice(0, at)}<span className={className}>{part}</span>{text.slice(at + part.length)}</>;
};
const initials = (name: string) => (name || "?").split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
let serial = 0;
const newId = () => `c-${Date.now().toString(36)}-${(serial++).toString(36)}`;

function Avatar({ author, size = 28 }: { author: CommentAuthor; size?: number }) {
  return author.avatar
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className={styles.avatar} src={author.avatar} alt="" width={size} height={size} style={{ width: size, height: size }} />
    : <span className={styles.avatar} style={{ width: size, height: size, fontSize: Math.round(size * .38) }} aria-hidden="true">{initials(author.name)}</span>;
}

/** Highlights "@Full Name" for known people. */
function Body({ text, people }: { text: string; people: CommentAuthor[] }) {
  const parts = useMemo(() => {
    const names = people.map(person => person.name).sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!names.length) return [text];
    return text.split(new RegExp(`(@(?:${names.join("|")}))`, "g"));
  }, [people, text]);
  return <p className={styles.body}>{parts.map((part, index) => index % 2 ? <span key={index} className={styles.mention}>{part}</span> : part)}</p>;
}

const roll: Variants = {
  hidden: (dir: number) => ({ y: `${dir * 70}%`, opacity: 0 }),
  shown: { y: 0, opacity: 1 },
  gone: (dir: number) => ({ y: `${dir * -70}%`, opacity: 0 }),
};
const rollReduced: Variants = { hidden: { opacity: 0 }, shown: { opacity: 1 }, gone: { opacity: 0 } };

function Count({ value, reduced }: { value: number; reduced: boolean }) {
  const [last, setLast] = useState(value);
  const [dir, setDir] = useState(1);
  if (value !== last) { setDir(value > last ? 1 : -1); setLast(value); }
  return <span className={styles.count}>
    <AnimatePresence mode="popLayout" initial={false} custom={dir}>
      <motion.span key={value} custom={dir} variants={reduced ? rollReduced : roll} initial="hidden" animate="shown" exit="gone"
        transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}>{value}</motion.span>
    </AnimatePresence>
  </span>;
}

function AutoHeight({ children, reduced, morphKey }: { children: ReactNode; reduced: boolean; morphKey: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const height = useMotionValue(0);
  const [measured, setMeasured] = useState(false);
  const morphing = useRef(false);
  const lastKey = useRef(morphKey);
  useLayoutEffect(() => {
    if (lastKey.current !== morphKey) { lastKey.current = morphKey; morphing.current = true; }
  }, [morphKey]);
  useLayoutEffect(() => {
    const node = inner.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight;
      if (morphing.current && !reduced) {
        morphing.current = false;
        animate(height, next, HEIGHT);
        return;
      }
      if (height.isAnimating()) { animate(height, next, HEIGHT); return; }
      height.jump(next);
      setMeasured(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [height, reduced]);
  return <motion.div className={styles.autoHeight} style={{ height: measured ? height : "auto" }}><div ref={inner} className={styles.autoInner}>{children}</div></motion.div>;
}

interface ComposerProps {
  people: CommentAuthor[];
  mentionsEnabled?: boolean;
  initial?: string;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  focusKey?: number;
  isSubmitting?: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  leading?: ReactNode;
  compact?: boolean;
  cancelLabel: string;
  mentionsLabel: string;
}

function Composer({
  people,
  mentionsEnabled = false,
  initial = "",
  placeholder,
  submitLabel,
  autoFocus,
  focusKey,
  isSubmitting = false,
  onSubmit,
  onCancel,
  leading,
  compact,
  cancelLabel,
  mentionsLabel,
}: ComposerProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const reduced = useReducedFlag();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  const [query, setQuery] = useState<{ start: number; term: string } | null>(null);
  const [active, setActive] = useState(0);

  // Mentions logic preserved for future activation; inactive by default
  const suggestions = useMemo(() => {
    if (!mentionsEnabled || !query) return [];
    const term = query.term.toLowerCase();
    return people.filter(person => person.name.toLowerCase().split(" ").some(part => part.startsWith(term)) || person.name.toLowerCase().startsWith(term)).slice(0, 5);
  }, [mentionsEnabled, people, query]);
  const open = mentionsEnabled && !!query && suggestions.length > 0;

  useEffect(() => {
    if (!autoFocus && !focusKey) return;
    const node = field.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    node.setSelectionRange(node.value.length, node.value.length);
  }, [autoFocus, focusKey]);

  const readQuery = (value: string, caret: number) => {
    if (!mentionsEnabled) return;
    const match = /(^|\s)@([\p{L}]*)$/u.exec(value.slice(0, caret));
    setQuery(match ? { start: caret - match[2]!.length - 1, term: match[2]! } : null);
    setActive(0);
  };

  const insert = (person: CommentAuthor) => {
    const node = field.current;
    if (!node || !query) return;
    const caret = node.selectionStart ?? text.length;
    const next = `${text.slice(0, query.start)}@${person.name} ${text.slice(caret)}`;
    const at = query.start + person.name.length + 2;
    setText(next);
    setQuery(null);
    requestAnimationFrame(() => { node.focus(); node.setSelectionRange(at, at); });
  };

  const send = () => {
    const body = text.trim();
    if (!body || isSubmitting) return;
    onSubmit(body);
    setText("");
    setQuery(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); insert(suggestions[active]!); return; }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setQuery(null); return; }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(); return; }
    if (event.key === "Escape" && onCancel) { event.preventDefault(); event.stopPropagation(); onCancel(); }
  };

  return <div className={styles.composer} data-compact={compact || undefined}>
    {leading}
    <div className={styles.fieldWrap}>
      <textarea ref={field} className={styles.field} value={text} placeholder={placeholder} rows={2} aria-label={placeholder}
        role={mentionsEnabled ? "combobox" : undefined} aria-autocomplete={mentionsEnabled ? "list" : undefined}
        aria-expanded={open} aria-controls={open ? `${uid}-people` : undefined} aria-activedescendant={open ? `${uid}-person-${active}` : undefined}
        onChange={event => { setText(event.target.value); readQuery(event.target.value, event.target.selectionStart); }}
        onSelect={event => readQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => setQuery(null)} onKeyDown={onKeyDown} />
      <AnimatePresence>
        {open && <motion.ul key="people" id={`${uid}-people`} role="listbox" aria-label={mentionsLabel} className={styles.suggestions}
          initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, transition: { duration: motionTokens.duration.instant, ease: standard } }} transition={reduced ? { duration: 0 } : { height: HEIGHT, opacity: { duration: motionTokens.duration.fast, ease: enter } }}>
          {suggestions.map((person, index) => <li key={person.id} id={`${uid}-person-${index}`} role="option" aria-selected={index === active} className={styles.suggestion}
            onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => insert(person)}>
            <Avatar author={person} size={20} />{person.name}
          </li>)}
        </motion.ul>}
      </AnimatePresence>
    </div>
    <div className={styles.composerActions}>
      {onCancel && <button type="button" className={styles.ghost} onClick={onCancel}>{cancelLabel}</button>}
      <button type="button" className={styles.send} disabled={!text.trim() || isSubmitting} onClick={send}>
        {isSubmitting ? "Sending..." : submitLabel}
      </button>
    </div>
  </div>;
}

type Ui = { picker: string | null; collapsed: Record<string, boolean> };

export const CommentThread = forwardRef<HTMLElement, CommentThreadProps>(function CommentThread({
  comments,
  defaultComments = [],
  onCommentsChange,
  onSubmitComment,
  onToggleReaction,
  currentUser,
  people,
  mentionsEnabled = false,
  title,
  reactions = DEFAULT_REACTIONS,
  placeholder = "Add a comment to this purchase order...",
  maxDepth = 2,
  nowLabel = "Just now",
  labels,
  className,
  canCreate = true,
  canReact = true,
  isSubmitting = false,
}, forwardedRef) {
  const t = withDefaults(DEFAULT_LABELS, labels);
  const reduced = useReducedFlag();
  const rootRef = useRef<HTMLElement>(null);
  useImperativeHandle(forwardedRef, () => rootRef.current as HTMLElement);
  const [internal, setInternal] = useState(defaultComments);
  const list = comments ?? internal;
  const [ui, setUi] = useState<Ui>({ picker: null, collapsed: {} });
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [focusKey, setFocusKey] = useState(0);

  const mentionable = useMemo(() => people ?? [...authorsOf(list, new Map([[currentUser.id, currentUser]])).values()], [currentUser, list, people]);
  const total = countTree(list);

  // The list scrolls inside a fixed height and opens on the latest comment.
  // New comments keep it pinned to the bottom unless the reader scrolled up.
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const onListScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [total]);
  // A new comment grows from zero height, so measuring once falls short and
  // leaves it below the fold. Follow the list's size while pinned.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
    Array.from(el.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [total]);

  const commit = useCallback((next: ThreadComment[], event: CommentThreadEvent) => {
    if (comments === undefined) setInternal(next);
    onCommentsChange?.(next, event);
  }, [comments, onCommentsChange]);

  const addReply = async (body: string) => {
    const comment: ThreadComment = { id: newId(), author: currentUser, body, createdAt: nowLabel, reactions: [] };
    let parentId: string | null = null;
    if (replyTo) {
      const path = pathTo(list, replyTo.id) ?? [];
      parentId = path[Math.min(path.length, maxDepth) - 1] ?? null;
    }
    const next = parentId ? mapTree(list, parentId, parent => ({ ...parent, replies: [...(parent.replies ?? []), comment] })) : [...list, comment];
    if (parentId) setUi(current => ({ ...current, collapsed: { ...current.collapsed, [parentId!]: false } }));
    else pinnedRef.current = true;
    commit(next, { type: "reply", comment, parentId });
    setReplyTo(null);

    if (onSubmitComment) {
      await onSubmitComment(body, parentId);
    }
  };

  const react = async (id: string, emoji: string) => {
    if (!canReact) return;
    const target = find(list, id);
    if (!target) return;
    const existing = target.reactions?.find(reaction => reaction.emoji === emoji);
    const added = !existing?.users.includes(currentUser.id);
    const nextReactions = existing
      ? (target.reactions ?? []).map(reaction => reaction.emoji !== emoji ? reaction : { ...reaction, users: added ? [...reaction.users, currentUser.id] : reaction.users.filter(user => user !== currentUser.id) }).filter(reaction => reaction.users.length)
      : [...(target.reactions ?? []), { emoji, users: [currentUser.id] }];
    commit(mapTree(list, id, comment => ({ ...comment, reactions: nextReactions })), { type: "react", id, emoji, added });
    setUi(current => ({ ...current, picker: null }));

    if (onToggleReaction) {
      await onToggleReaction(id, emoji, added);
    }
  };

  const grow = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: motionTokens.duration.instant } }
    : { initial: { height: 0, opacity: 0 }, animate: { height: "auto", opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { height: HEIGHT, opacity: { duration: motionTokens.duration.standard, ease: enter } } };

  const renderComment = (comment: ThreadComment, depth: number): ReactNode => {
    const replies = comment.replies ?? [];
    const collapsed = !!ui.collapsed[comment.id];
    const picking = ui.picker === comment.id;

    return <motion.li key={comment.id} className={styles.item} {...grow}>
      <article className={styles.comment} aria-label={`${comment.author.name}, ${comment.createdAt}`}>
        <Avatar author={comment.author} />
        <div className={styles.main}>
          <header className={styles.meta}>
            <span className={styles.name}>{comment.author.name}</span>
            <span className={styles.time}>{comment.createdAt}</span>
          </header>

          <Body text={comment.body} people={mentionable} />

          <div className={styles.footer}>
            {(comment.reactions ?? []).length > 0 && <div className={styles.reactions}>
              <AnimatePresence initial={false} mode="popLayout">
                {(comment.reactions ?? []).map(reaction => {
                  const pressed = reaction.users.includes(currentUser.id);
                  return <motion.button key={reaction.emoji} type="button" layout={!reduced} className={styles.reaction} aria-pressed={pressed}
                    disabled={!canReact}
                    aria-label={t.reactionCount(reaction.emoji, reaction.users.length, pressed)} onClick={() => react(comment.id, reaction.emoji)}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .7 }} animate={{ opacity: 1, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, scale: .7 }}
                    transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}>
                    <span aria-hidden="true">{reaction.emoji}</span><Count value={reaction.users.length} reduced={reduced} />
                  </motion.button>;
                })}
              </AnimatePresence>
            </div>}

            <AnimatePresence mode="wait" initial={false}>
              {picking
                ? <motion.div key="picker" role="group" aria-label={t.reactions} className={styles.actions} data-open=""
                  onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setUi(current => ({ ...current, picker: null })); } }}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : motionTokens.duration.instant, ease: standard } }} transition={{ duration: reduced ? 0 : motionTokens.duration.fast, ease: enter }}>
                  {reactions.map((emoji, index) => <motion.button key={emoji} type="button" className={styles.emoji} autoFocus={index === 0} aria-label={t.reactWith(emoji)}
                    aria-pressed={!!comment.reactions?.find(reaction => reaction.emoji === emoji)?.users.includes(currentUser.id)} onClick={() => react(comment.id, emoji)}
                    initial={reduced ? false : { opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} transition={reduced ? { duration: 0 } : { ...motionTokens.spring.snappy, delay: index * motionTokens.stagger.item }}>{emoji}</motion.button>)}
                  <button type="button" className={styles.iconAction} aria-label={t.closeReactions} onClick={() => setUi(current => ({ ...current, picker: null }))}><X size={14} strokeWidth={1.75} aria-hidden="true" /></button>
                </motion.div>
                : <motion.div key="actions" className={styles.actions} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : motionTokens.duration.instant, ease: standard }}>
                  {canReact && (
                    <button type="button" className={styles.iconAction} aria-label={t.addReaction} onClick={() => setUi(current => ({ ...current, picker: comment.id }))}>
                      <SmilePlus size={15} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  )}
                  {canCreate && (
                    <button type="button" className={styles.action} onClick={() => { setReplyTo({ id: comment.id, name: comment.author.name }); setFocusKey(key => key + 1); }}>{t.reply}</button>
                  )}
                </motion.div>}
            </AnimatePresence>
          </div>

          {replies.length > 0 && <button type="button" className={styles.toggle} aria-expanded={!collapsed}
            onClick={() => setUi(current => ({ ...current, collapsed: { ...current.collapsed, [comment.id]: !collapsed } }))}>
            <motion.span className={styles.toggleIcon} initial={false} animate={{ rotate: collapsed ? 0 : 90 }} transition={reduced ? { duration: 0 } : motionTokens.spring.snappy} aria-hidden="true">
              <ChevronRight size={13} strokeWidth={1.75} />
            </motion.span>
            {collapsed ? t.showReplies(countTree(replies)) : t.hideReplies}
            {collapsed && <span className={styles.stack} aria-hidden="true">{[...authorsOf(replies).values()].slice(0, 3).map(author => <Avatar key={author.id} author={author} size={18} />)}</span>}
          </button>}
        </div>
      </article>

      <AnimatePresence initial={false}>
        {replies.length > 0 && !collapsed && <motion.div key="replies" className={styles.repliesWrap} {...grow}>
          <ul className={styles.replies} data-depth={depth + 1}>
            <AnimatePresence initial={false}>{replies.map(reply => renderComment(reply, depth + 1))}</AnimatePresence>
          </ul>
        </motion.div>}
      </AnimatePresence>
    </motion.li>;
  };

  const face = { initial: reduced ? { opacity: 0 } : { opacity: 0, filter: `blur(${motionTokens.blur.subtle}px)` }, animate: { opacity: 1, filter: "blur(0px)" }, exit: { opacity: 0, filter: reduced ? "blur(0px)" : `blur(${motionTokens.blur.subtle}px)` }, transition: { duration: reduced ? 0 : motionTokens.duration.standard, ease: enter } };

  return <section ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} aria-label={t.thread}>
    <AutoHeight reduced={reduced} morphKey="thread">
      <div className={styles.thread}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <h3 className={styles.title}>{title || t.thread}</h3>
            <span className={styles.subtitle}>{t.commentCount(total)}</span>
          </div>
        </header>

        {list.length > 0
          ? <div ref={scrollRef} className={styles.scroll} data-testid="comment-scroll" onScroll={onListScroll}>
            <ul className={styles.list}><AnimatePresence initial={false}>{list.map(comment => renderComment(comment, 0))}</AnimatePresence></ul>
          </div>
          : <p className={styles.empty}>{t.empty}</p>}

        {canCreate ? (
          <div className={styles.composerArea}>
            <AnimatePresence initial={false}>
              {replyTo && <motion.div key="replying" className={styles.replying} {...grow}>
                <span className={styles.replyingInner}>
                  <CornerDownRight size={13} strokeWidth={1.75} aria-hidden="true" />
                  <span>{highlight(t.replyingTo(replyTo.name), replyTo.name, styles.replyingName)}</span>
                  <button type="button" className={styles.iconAction} aria-label={t.cancelReply} onClick={() => setReplyTo(null)}><X size={14} strokeWidth={1.75} aria-hidden="true" /></button>
                </span>
              </motion.div>}
            </AnimatePresence>
            <Composer
              people={mentionable}
              mentionsEnabled={mentionsEnabled}
              placeholder={placeholder}
              submitLabel={t.send}
              cancelLabel={t.cancel}
              mentionsLabel={t.mentions}
              focusKey={focusKey}
              isSubmitting={isSubmitting}
              onSubmit={addReply}
              onCancel={replyTo ? () => setReplyTo(null) : undefined}
              leading={<Avatar author={currentUser} />}
            />
          </div>
        ) : (
          <div className="rounded-input bg-surface-2 p-3 text-xs text-ink-muted text-center border border-border">
            {t.noPermissionToComment}
          </div>
        )}
      </div>
    </AutoHeight>
  </section>;
});

export default CommentThread;
