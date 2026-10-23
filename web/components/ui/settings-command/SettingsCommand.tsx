"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CornerDownLeft, LoaderCircle, Search } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import { inert } from "@/lib/inert";
import { Select } from "@/components/ui/select-field/SelectField";
import PhoneField from "@/components/ui/PhoneField";
import styles from "./settings-command.module.css";

/**
 * Settings command: every setting on one scrolling page, with a sticky section nav,
 * a search field that grows into a palette that flies you to any setting, and an
 * unsaved-changes bar. Built to the published API of Arc's "Settings command" block.
 */

export type SettingKind = "switch" | "segmented" | "select" | "text" | "phone";
export type SettingValue = string | boolean;
export type SettingsValues = Record<string, SettingValue>;

export interface SettingsSection {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
}

export interface SettingDef {
  id: string;
  /** Id of the section the setting belongs to. */
  section: string;
  label: string;
  description?: string;
  kind: SettingKind;
  /** For segmented and select. */
  options?: { value: string; label: string }[];
  /** Extra words that find this setting in search. */
  keywords?: string[];
  placeholder?: string;
  /** Fixed text before a text field's value, such as "https://". */
  prefix?: string;
  /** Returns an error message for an invalid value. Invalid fields block saving. */
  validate?: (value: SettingValue) => string | null;
}

export interface SettingsCommandProps {
  sections: SettingsSection[];
  settings: SettingDef[];
  /** Saved values keyed by setting id, used to count unsaved changes. */
  defaultValues: SettingsValues;
  /** Setting ids shown in the palette before anything is typed. */
  suggested?: string[];
  /** Persists the draft. Reject to show Retry. Without it, saving is simulated. */
  onSave?: (values: SettingsValues, changedIds: string[]) => Promise<void> | void;
  /** Called on every edit. */
  onValuesChange?: (values: SettingsValues) => void;
  title?: string;
  className?: string;
}

type SaveState = "idle" | "saving" | "error";

const enter = [...motionTokens.ease.enter] as [number, number, number, number];
const standard = [...motionTokens.ease.standard] as [number, number, number, number];

function matches(setting: SettingDef, section: SettingsSection | undefined, words: string[]) {
  const options = (setting.options ?? []).map((o) => o.label).join(" ");
  const hay = `${setting.label} ${setting.description ?? ""} ${section?.label ?? ""} ${options} ${(setting.keywords ?? []).join(" ")}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/* ---------------------------------------------------------------------------------------------- */

function Switch({ id, checked, onChange, describedBy }: { id: string; checked: boolean; onChange: (next: boolean) => void; describedBy?: string }) {
  return (
    <button id={id} type="button" role="switch" aria-checked={checked} aria-describedby={describedBy} className={styles.switch} onClick={() => onChange(!checked)}>
      <span className={styles.knob} aria-hidden="true" />
    </button>
  );
}

function Segmented({ id, value, options, onChange, describedBy, labelledBy }: { id: string; value: string; options: { value: string; label: string }[]; onChange: (next: string) => void; describedBy?: string; labelledBy: string }) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  }
  return (
    <div id={id} role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} className={styles.segmented} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          className={styles.segment}
          onClick={() => onChange(o.value)}
        >
          {i === index && <motion.span layoutId={`${id}-thumb`} className={styles.thumb} transition={motionTokens.spring.snappy} />}
          <span className={styles.segmentLabel}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

export function SettingsCommand({ sections, settings, defaultValues, suggested = [], onSave, onValuesChange, title = "Settings", className }: SettingsCommandProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const reduced = !!useReducedMotion();
  const [baseline, setBaseline] = useState<SettingsValues>(defaultValues);
  const [values, setValues] = useState<SettingsValues>(defaultValues);
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [announcement, setAnnouncement] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const spyFrame = useRef(0);

  const sectionById = useMemo(() => Object.fromEntries(sections.map((s) => [s.id, s])), [sections]);
  const controlId = (settingId: string) => `${uid}-${settingId}`;

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of settings) {
      const message = s.validate?.(values[s.id] ?? "");
      if (message) out[s.id] = message;
    }
    return out;
  }, [settings, values]);
  const changedIds = useMemo(() => settings.filter((s) => values[s.id] !== baseline[s.id]).map((s) => s.id), [settings, values, baseline]);
  const invalid = Object.keys(errors).length > 0;

  const setValue = (id: string, next: SettingValue) => {
    setValues((current) => {
      const updated = { ...current, [id]: next };
      onValuesChange?.(updated);
      return updated;
    });
    if (saveState === "error") setSaveState("idle");
  };

  /* Search ------------------------------------------------------------------------------------- */

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = useMemo(() => {
    if (!words.length) return suggested.map((id) => settings.find((s) => s.id === id)).filter(Boolean) as SettingDef[];
    return settings.filter((s) => matches(s, sectionById[s.section], words));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, settings, suggested, sectionById]);
  const safeCursor = Math.min(cursor, Math.max(results.length - 1, 0));

  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery("");
    setCursor(0);
  }, []);
  const closePalette = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, [open]);

  /** Scrolls a setting into view, flashes its row and focuses its control. */
  const jumpTo = useCallback(
    (setting: SettingDef) => {
      closePalette(false);
      const row = document.getElementById(`${controlId(setting.id)}-row`);
      row?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      setFlash(setting.id);
      window.setTimeout(() => setFlash((f) => (f === setting.id ? null : f)), 1400);
      setAnnouncement(`${setting.label}, in ${sectionById[setting.section]?.label ?? "settings"}`);
      // Focus once the palette is gone; the radiogroup hands focus to its checked option.
      window.setTimeout(() => {
        const el = document.getElementById(controlId(setting.id));
        const target = el?.getAttribute("role") === "radiogroup" ? el.querySelector<HTMLElement>('[aria-checked="true"]') : el;
        target?.focus({ preventScroll: true });
      }, reduced ? 0 : 260);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closePalette, reduced, sectionById, uid],
  );

  function onPaletteKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setCursor(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setCursor(Math.max(results.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = results[safeCursor];
      if (target) jumpTo(target);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePalette();
    }
  }

  // Ctrl/Cmd+K, or "/" outside a text field, opens search while focus is inside the block.
  function onRootKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (open) return;
    const target = event.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
    const combo = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k";
    if (combo || (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      openPalette();
    }
  }

  /* Scroll spy (one read per frame) ------------------------------------------------------------ */

  const onScroll = useCallback(() => {
    if (spyFrame.current) return;
    spyFrame.current = requestAnimationFrame(() => {
      spyFrame.current = 0;
      const box = scrollRef.current;
      if (!box) return;
      const top = box.scrollTop + 24;
      const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
      let current = sections[0]?.id ?? "";
      for (const s of sections) {
        const el = sectionRefs.current[s.id];
        if (el && el.offsetTop <= top) current = s.id;
      }
      if (atEnd) current = sections[sections.length - 1]?.id ?? current;
      setActive(current);
    });
  }, [sections]);
  useEffect(() => () => cancelAnimationFrame(spyFrame.current), []);

  function goToSection(id: string) {
    const el = sectionRefs.current[id];
    const box = scrollRef.current;
    if (!el || !box) return;
    box.scrollTo({ top: el.offsetTop - 8, behavior: reduced ? "auto" : "smooth" });
    setActive(id);
  }

  /* Save --------------------------------------------------------------------------------------- */

  async function save() {
    if (invalid || !changedIds.length || saveState === "saving") {
      if (invalid) setAnnouncement(`Fix ${Object.keys(errors).length === 1 ? "the highlighted field" : "the highlighted fields"} before saving.`);
      return;
    }
    setSaveState("saving");
    const ids = changedIds;
    try {
      if (onSave) await onSave(values, ids);
      else await new Promise((r) => setTimeout(r, 700));
      setBaseline(values);
      setSaveState("idle");
      // The bar (and the focused Save button) goes away; keep focus inside the block.
      requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
      setAnnouncement(`Saved ${ids.length} ${ids.length === 1 ? "change" : "changes"}.`);
    } catch {
      setSaveState("error");
      setAnnouncement("Couldn't save. Try again.");
    }
  }

  function discard() {
    setValues(baseline);
    onValuesChange?.(baseline);
    setSaveState("idle");
    setAnnouncement("Changes discarded.");
  }

  /* Render ------------------------------------------------------------------------------------- */

  function control(s: SettingDef) {
    const id = controlId(s.id);
    const describedBy = [s.description ? `${id}-hint` : "", errors[s.id] ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
    const value = values[s.id];
    if (s.kind === "switch") return <Switch id={id} checked={!!value} describedBy={describedBy} onChange={(v) => setValue(s.id, v)} />;
    if (s.kind === "segmented") return <Segmented id={id} labelledBy={`${id}-label`} describedBy={describedBy} value={String(value ?? "")} options={s.options ?? []} onChange={(v) => setValue(s.id, v)} />;
    if (s.kind === "select")
      return (
        <Select
          id={id}
          containerClassName={styles.selectWrap}
          value={String(value ?? "")}
          onValueChange={(v: string) => setValue(s.id, v)}
          options={s.options ?? []}
        />
      );
    if (s.kind === "phone")
      return (
        <div className={styles.phoneWrap}>
          <PhoneField id={id} label={s.label} hideLabel value={String(value ?? "")} onChange={(v) => setValue(s.id, v)} />
        </div>
      );
    return (
      <span className={styles.textWrap} data-invalid={errors[s.id] ? "" : undefined}>
        {s.prefix && <span className={styles.prefix}>{s.prefix}</span>}
        <input
          id={id}
          className={styles.text}
          value={String(value ?? "")}
          placeholder={s.placeholder}
          aria-describedby={describedBy}
          aria-invalid={!!errors[s.id] || undefined}
          onChange={(e) => setValue(s.id, e.target.value)}
        />
      </span>
    );
  }

  const count = changedIds.length;

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")} onKeyDown={onRootKeyDown}>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <motion.button
          ref={searchRef}
          type="button"
          layoutId={`${uid}-search`}
          className={styles.searchTrigger}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={openPalette}
          transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}
          style={{ visibility: open ? "hidden" : "visible" }}
        >
          <Search size={15} strokeWidth={1.75} aria-hidden="true" />
          <span>Search settings</span>
          <kbd className={styles.kbd}>Ctrl K</kbd>
        </motion.button>
      </header>

      <div className={styles.body} {...inert(open)}>
        <nav className={styles.nav} aria-label={`${title} sections`}>
          {sections.map((s) => (
            <button key={s.id} type="button" className={styles.navItem} aria-current={active === s.id ? "true" : undefined} onClick={() => goToSection(s.id)}>
              {active === s.id && <motion.span layoutId={`${uid}-nav`} className={styles.navMark} transition={reduced ? { duration: 0 } : motionTokens.spring.snappy} />}
              <span className={styles.navIcon} aria-hidden="true">{s.icon}</span>
              <span className={styles.navLabel}>{s.label}</span>
            </button>
          ))}
        </nav>

        <div ref={scrollRef} className={styles.scroll} onScroll={onScroll}>
          {sections.map((section) => (
            <section
              key={section.id}
              ref={(el) => {
                sectionRefs.current[section.id] = el;
              }}
              className={styles.section}
              aria-labelledby={`${uid}-${section.id}-heading`}
            >
              <h3 id={`${uid}-${section.id}-heading`} className={styles.sectionTitle}>{section.label}</h3>
              {section.description && <p className={styles.sectionHint}>{section.description}</p>}
              <div className={styles.rows}>
                {settings
                  .filter((s) => s.section === section.id)
                  .map((s) => {
                    const id = controlId(s.id);
                    const edited = changedIds.includes(s.id);
                    return (
                      <div key={s.id} id={`${id}-row`} className={styles.row} data-flash={flash === s.id || undefined} data-kind={s.kind}>
                        <div className={styles.rowCopy}>
                          <label id={`${id}-label`} htmlFor={s.kind === "segmented" ? undefined : id} className={styles.rowLabel}>
                            {s.label}
                            {edited && (
                              <>
                                <span className={styles.editedDot} aria-hidden="true" />
                                <span className={styles.srOnly}> (edited)</span>
                              </>
                            )}
                          </label>
                          {s.description && <p id={`${id}-hint`} className={styles.rowHint}>{s.description}</p>}
                          {errors[s.id] && <p id={`${id}-error`} className={styles.rowError} role="alert">{errors[s.id]}</p>}
                        </div>
                        <div className={styles.rowControl}>{control(s)}</div>
                      </div>
                    );
                  })}
              </div>
            </section>
          ))}
          <div className={styles.bottomSpace} aria-hidden="true" />
        </div>
      </div>

      {/* Unsaved changes bar */}
      <AnimatePresence>
        {(count > 0 || saveState === "saving") && (
          <motion.div
            className={styles.saveBar}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, transition: { duration: motionTokens.duration.fast, ease: standard } }}
            transition={reduced ? { duration: motionTokens.duration.fast } : motionTokens.spring.smooth}
            {...inert(open)}
          >
            <span className={styles.saveText} data-error={saveState === "error" || undefined}>
              {saveState === "error" ? (
                "Couldn't save your changes."
              ) : invalid ? (
                "Fix the highlighted field to save."
              ) : (
                <>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={count}
                      className={styles.count}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.4em" }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, y: "-0.4em" }}
                      transition={{ duration: motionTokens.duration.fast, ease: enter }}
                    >
                      {count}
                    </motion.span>
                  </AnimatePresence>
                  unsaved {count === 1 ? "change" : "changes"}
                </>
              )}
            </span>
            <button type="button" className={styles.ghostBtn} onClick={discard} disabled={saveState === "saving"}>
              Discard
            </button>
            <button type="button" className={styles.primaryBtn} onClick={save} disabled={saveState === "saving" || invalid} aria-busy={saveState === "saving" || undefined}>
              {saveState === "saving" && <LoaderCircle size={14} className={styles.spin} aria-hidden="true" />}
              {saveState === "saving" ? "Saving" : saveState === "error" ? "Retry" : "Save"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Palette: a modal combobox over the block */}
      <AnimatePresence>
        {open && (
          <motion.div key="scrim" className={styles.scrim} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: motionTokens.duration.fast }} onMouseDown={() => closePalette()} />
        )}
        {open && (
          <motion.div
            key="palette"
            layoutId={`${uid}-search`}
            className={styles.palette}
            role="dialog"
            aria-modal="true"
            aria-label="Search settings"
            transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}
          >
            <div className={styles.paletteSearch}>
              <Search size={16} strokeWidth={1.75} aria-hidden="true" />
              <input
                ref={inputRef}
                role="combobox"
                aria-expanded="true"
                aria-controls={`${uid}-results`}
                aria-autocomplete="list"
                aria-activedescendant={results[safeCursor] ? `${uid}-opt-${results[safeCursor]!.id}` : undefined}
                className={styles.paletteInput}
                placeholder="Search settings"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={onPaletteKeyDown}
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className={styles.kbd}>Esc</kbd>
            </div>
            <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: motionTokens.duration.fast, delay: reduced ? 0 : 0.08 }}>
              <div className={styles.paletteHeading}>{words.length ? `${results.length} ${results.length === 1 ? "result" : "results"}` : "Suggested"}</div>
              <ul id={`${uid}-results`} role="listbox" aria-label="Settings" className={styles.results}>
                {results.map((s, i) => (
                  <li
                    key={s.id}
                    id={`${uid}-opt-${s.id}`}
                    role="option"
                    aria-selected={i === safeCursor}
                    className={styles.result}
                    onMouseMove={() => setCursor(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => jumpTo(s)}
                  >
                    <span className={styles.resultIcon} aria-hidden="true">{sectionById[s.section]?.icon}</span>
                    <span className={styles.resultCopy}>
                      <span className={styles.resultLabel}>{s.label}</span>
                      <span className={styles.resultPath}>{sectionById[s.section]?.label}{s.description ? ` · ${s.description}` : ""}</span>
                    </span>
                    {i === safeCursor && <CornerDownLeft size={14} className={styles.enterHint} aria-hidden="true" />}
                  </li>
                ))}
                {!results.length && <li className={styles.noResults}>No settings match “{query.trim()}”.</li>}
              </ul>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <span className={styles.srOnly} role="status" aria-live="polite">{announcement}</span>
    </div>
  );
}

export default SettingsCommand;
