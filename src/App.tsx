import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { db, normalize, queueSync, rebuildMeetingSearch } from "./db";
import { createRecognizer, hasSpeechRecognition } from "./speech";
import { currentUser, sendSignInLink, supabase, sync } from "./supabase";
import type { Language, Meeting, TranscriptSegment } from "./types";

type Theme = "system" | "light" | "dark";
const pageSize = 50;
const translationLockKey = "roza-persian-translation-lock";
const dateTitle = () =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
const clock = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);

export default function App() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("roza-theme") as Theme) || "system",
  );
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [language, setLanguage] = useState<Language>("sv-SE");
  const [interim, setInterim] = useState("");
  const [message, setMessage] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [syncState, setSyncState] = useState(
    supabase ? "Sign in to sync" : "Saved on this device",
  );
  const [toast, setToast] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [translationState, setTranslationState] = useState<"off" | "loading" | "ready">("off");
  const [translationProgress, setTranslationProgress] = useState(0);
  const [persianModelSaved, setPersianModelSaved] = useState(() => localStorage.getItem("roza-persian-model") === "saved");
  const recognizer = useRef<ReturnType<typeof createRecognizer>>(null);
  const activeRef = useRef<string | null>(null);
  const stopped = useRef(false);
  const translationWorker = useRef<Worker | null>(null);
  const tabId = useRef(crypto.randomUUID());

  const loadMeetings = useCallback(async () => {
    const term = normalize(search);
    if (!term && labelFilter) {
      const filtered = await db.meetings.where("labels").equals(labelFilter).filter((meeting) => !meeting.deletedAt).toArray();
      return setMeetings(filtered.sort((a, b) => b.createdAt - a.createdAt).slice(0, page * pageSize));
    }
    if (!term)
      return setMeetings(
        await db.meetings
          .orderBy("createdAt")
          .reverse()
          .filter((m) => !m.deletedAt)
          .limit(page * pageSize)
          .toArray(),
      );
    const hits = await db.searchEntries
      .filter((entry) => entry.normalizedText.includes(term))
      .toArray();
    const found = (
      await db.meetings.bulkGet([...new Set(hits.map((hit) => hit.meetingId))])
    ).filter((m): m is Meeting => Boolean(m && !m.deletedAt && (!labelFilter || m.labels.includes(labelFilter))));
    setMeetings(found.sort((a, b) => b.createdAt - a.createdAt));
  }, [labelFilter, page, search]);
  const loadSegments = useCallback(async (id: string | null) => {
    if (!id) return setSegments([]);
    const rows = await db.segments
      .where("meetingId")
      .equals(id)
      .filter((segment) => !segment.deletedAt)
      .toArray();
    setSegments(
      rows.sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence),
    );
  }, []);
  const runSync = useCallback(
    async (account: User) => {
      try {
        setSyncState("Syncing");
        setToast("Syncing your sessions…");
        await sync(account);
        setSyncState("Synced");
        setToast("Sync complete");
        await loadMeetings();
        await loadSegments(activeRef.current);
      } catch {
        setSyncState("Needs attention");
        setToast("Sync failed. Your changes remain saved on this device.");
      }
    },
    [loadMeetings, loadSegments],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("roza-theme", theme);
  }, [theme]);
  useEffect(() => () => {
    translationWorker.current?.terminate();
    const lock = localStorage.getItem(translationLockKey);
    if (lock && JSON.parse(lock).tabId === tabId.current) localStorage.removeItem(translationLockKey);
  }, []);
  useEffect(() => {
    if (!toast || toast.startsWith("Syncing")) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    void loadMeetings();
  }, [loadMeetings]);
  useEffect(() => {
    void db.meetings.filter((meeting) => !meeting.deletedAt).toArray().then((items) => setLabels([...new Set(items.flatMap((meeting) => meeting.labels))].sort((a, b) => a.localeCompare(b))));
  }, [meetings]);
  useEffect(() => {
    activeRef.current = activeId;
    void loadSegments(activeId);
  }, [activeId, loadSegments]);
  useEffect(() => {
    void currentUser().then((account) => {
      setUser(account);
      if (account) void runSync(account);
    });
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) void runSync(session.user);
    });
    return () => data.subscription.unsubscribe();
  }, [runSync]);
  useEffect(() => {
    const online = () => user && void runSync(user);
    addEventListener("online", online);
    return () => removeEventListener("online", online);
  }, [runSync, user]);

  const active = meetings.find((m) => m.id === activeId) || null;
  async function saveTranslation(id: string, translatedText: string) {
    const segment = await db.segments.get(id);
    if (!segment) return;
    await db.segments.put({ ...segment, translatedText, updatedAt: Date.now() });
    if (user) { await queueSync("segment", id, "upsert"); void runSync(user); }
    await loadSegments(segment.meetingId);
  }
  function requestTranslation(segment: TranscriptSegment, source: Language) {
    if (translationState === "ready") translationWorker.current?.postMessage({ type: "translate", id: segment.id, text: segment.text, source: source === "sv-SE" ? "swe_Latn" : "eng_Latn" });
  }
  function claimTranslationLock() {
    const raw = localStorage.getItem(translationLockKey);
    const current = raw ? JSON.parse(raw) as { tabId: string; expiresAt: number } : null;
    if (current && current.tabId !== tabId.current && current.expiresAt > Date.now()) return false;
    localStorage.setItem(translationLockKey, JSON.stringify({ tabId: tabId.current, expiresAt: Date.now() + 30 * 60 * 1000 }));
    return JSON.parse(localStorage.getItem(translationLockKey) || "{}").tabId === tabId.current;
  }
  function releaseTranslationLock() {
    const raw = localStorage.getItem(translationLockKey);
    if (raw && JSON.parse(raw).tabId === tabId.current) localStorage.removeItem(translationLockKey);
  }
  async function enableTranslation() {
    if (translationState !== "off") return;
    if (!persianModelSaved && !window.confirm("Download the offline Persian model? This one-time download is large, so Wi-Fi is recommended.")) return;
    if (!claimTranslationLock()) {
      setToast("Persian translation is active in another Roza tab. Close that tab first.");
      return;
    }
    const worker = new Worker(new URL("./translation.worker.ts", import.meta.url), { type: "module" });
    translationWorker.current = worker;
    setTranslationState("loading");
    worker.onmessage = (event: MessageEvent<{ type: string; id?: string; text?: string; progress?: number; message?: string }>) => {
      if (event.data.type === "progress") setTranslationProgress(Math.round(event.data.progress ?? 0));
      if (event.data.type === "translated" && event.data.id) void saveTranslation(event.data.id, event.data.text ?? "");
      if (event.data.type === "error") {
        setTranslationState("off");
        releaseTranslationLock();
        localStorage.removeItem("roza-persian-model");
        setPersianModelSaved(false);
        setToast(event.data.message ?? "Translation failed.");
      }
      if (event.data.type === "ready") {
        setTranslationState("ready");
        localStorage.setItem("roza-persian-model", "saved");
        setPersianModelSaved(true);
        setToast("Persian translation is ready");
        if (activeRef.current) {
          void Promise.all([
            db.meetings.get(activeRef.current),
            db.segments.where("meetingId").equals(activeRef.current).toArray(),
          ]).then(([meeting, rows]) => {
            const source = meeting?.language === "en-US" ? "eng_Latn" : "swe_Latn";
            rows
              .filter((row) => !row.translatedText && !row.deletedAt)
              .forEach((row) => worker.postMessage({ type: "translate", id: row.id, text: row.text, source }));
          });
        }
      }
    };
    worker.postMessage({ type: "load" });
  }
  async function createMeeting() {
    const now = Date.now();
    const meeting: Meeting = {
      id: crypto.randomUUID(),
      userId: user?.id,
      title: dateTitle(),
      createdAt: now,
      updatedAt: now,
      language,
      status: "paused",
      labels: [],
      lastPersistedSequence: 0,
    };
    await db.transaction(
      "rw",
      db.meetings,
      db.searchEntries,
      db.syncOperations,
      async () => {
        await db.meetings.add(meeting);
        await rebuildMeetingSearch(meeting);
        if (user) await queueSync("meeting", meeting.id, "upsert");
      },
    );
    setSearch("");
    setPage(1);
    setActiveId(meeting.id);
    setSidebarOpen(false);
    await loadMeetings();
    if (user) void runSync(user);
  }
  async function saveMeeting(changes: Partial<Meeting>) {
    if (!active) return;
    const next = { ...active, ...changes, updatedAt: Date.now() };
    setMeetings((current) =>
      current
        .map((meeting) => (meeting.id === next.id ? next : meeting))
        .sort((a, b) => b.createdAt - a.createdAt),
    );
    await db.transaction(
      "rw",
      db.meetings,
      db.searchEntries,
      db.syncOperations,
      async () => {
        await db.meetings.put(next);
        await rebuildMeetingSearch(next);
        if (user) await queueSync("meeting", next.id, "upsert");
      },
    );
    await loadMeetings();
    if (user) void runSync(user);
  }
  async function saveFinal(text: string) {
    const meetingId = activeRef.current;
    if (!meetingId || !text) return;
    let saved: TranscriptSegment | undefined;
    let source: Language = "sv-SE";
    await db.transaction(
      "rw",
      db.meetings,
      db.segments,
      db.searchEntries,
      db.syncOperations,
      async () => {
        const meeting = await db.meetings.get(meetingId);
        if (!meeting) return;
        source = meeting.language;
        const now = Date.now();
        const segment: TranscriptSegment = {
          id: crypto.randomUUID(),
          meetingId,
          sequence: meeting.lastPersistedSequence + 1,
          text,
          recognizedText: text,
          createdAt: now,
          updatedAt: now,
        };
        const updated = {
          ...meeting,
          lastPersistedSequence: segment.sequence,
          updatedAt: now,
        };
        await db.meetings.put(updated);
        await db.segments.add(segment);
        saved = segment;
        await db.searchEntries.put({
          id: `segment:${segment.id}`,
          meetingId,
          segmentId: segment.id,
          source: "transcript",
          normalizedText: normalize(text),
          preview: text,
        });
        if (user) {
          await queueSync("meeting", meetingId, "upsert");
          await queueSync("segment", segment.id, "upsert");
        }
      },
    );
    setInterim("");
    await loadSegments(meetingId);
    await loadMeetings();
    if (saved) requestTranslation(saved, source);
    if (user) void runSync(user);
  }
  async function start() {
    if (!active) return;
    if (!hasSpeechRecognition())
      return setMessage(
        "Try Safari on iPhone/iPad or Chrome on Android for live transcription.",
      );
    stopped.current = false;
    await saveMeeting({
      status: "recording",
      startedAt: active.startedAt || Date.now(),
    });
    recognizer.current = createRecognizer(
      active.language,
      setInterim,
      (text) => void saveFinal(text),
      () => {
        if (!stopped.current)
          setTimeout(() => {
            void db.meetings.get(activeRef.current || "").then((m) => {
              if (m?.status === "recording") void start();
            });
          }, 400);
      },
      (error) => setMessage(`Transcription stopped: ${error}`),
    );
    try {
      recognizer.current?.start();
      setMessage("");
    } catch {
      setMessage("Roza is already listening.");
    }
  }
  async function stop(status: "paused" | "complete") {
    stopped.current = true;
    recognizer.current?.stop();
    recognizer.current = null;
    setInterim("");
    await saveMeeting({
      status,
      endedAt: status === "complete" ? Date.now() : undefined,
    });
  }
  async function edit(segment: TranscriptSegment, text: string) {
    const next = {
      ...segment,
      text,
      editedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.transaction(
      "rw",
      db.segments,
      db.searchEntries,
      db.syncOperations,
      async () => {
        await db.segments.put(next);
        await db.searchEntries.put({
          id: `segment:${segment.id}`,
          meetingId: segment.meetingId,
          segmentId: segment.id,
          source: "transcript",
          normalizedText: normalize(text),
          preview: text,
        });
        if (user) await queueSync("segment", segment.id, "upsert");
      },
    );
    await loadSegments(segment.meetingId);
    if (user) void runSync(user);
  }
  async function deleteMeeting() {
    if (!active || !window.confirm(`Delete “${active.title}”?`)) return;
    const now = Date.now();
    const meeting = { ...active, deletedAt: now, updatedAt: now };
    const meetingSegments = await db.segments
      .where("meetingId")
      .equals(active.id)
      .toArray();
    await db.transaction(
      "rw",
      db.meetings,
      db.segments,
      db.syncOperations,
      async () => {
        await db.meetings.put(meeting);
        for (const segment of meetingSegments) {
          await db.segments.put({ ...segment, deletedAt: now, updatedAt: now });
          if (user) await queueSync("segment", segment.id, "delete");
        }
        if (user) await queueSync("meeting", meeting.id, "delete");
      },
    );
    stopped.current = true;
    recognizer.current?.stop();
    recognizer.current = null;
    setActiveId(null);
    await loadMeetings();
    if (user) void runSync(user);
  }
  async function exportMeeting() {
    if (!active) return;
    const filename = `${active.title.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "roza-session"}.md`;
    const rows = segments.flatMap((segment) => [
      `### ${clock(segment.createdAt)}`,
      "",
      segment.text,
      ...(segment.translatedText ? ["", `> ${segment.translatedText}`] : []),
      "",
    ]);
    const content = [
      `# ${active.title}`,
      "",
      `- Date: ${new Date(active.createdAt).toLocaleString()}`,
      `- Language: ${active.language === "sv-SE" ? "Swedish" : "English"}`,
      ...(active.labels.length ? [`- Labels: ${active.labels.join(", ")}`] : []),
      "",
      "## Transcript",
      "",
      ...rows,
    ].join("\n");
    const file = new File([content], filename, { type: "text/markdown;charset=utf-8" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ title: active.title, files: [file] });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setToast("Transcript exported");
  }
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    try {
      await sendSignInLink(email);
      setMessage("Check your email for the sign-in link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    }
  }

  const signOut = () => supabase?.auth.signOut();
  async function resetAppCache() {
    if (!window.confirm("Reset Roza's app cache and reload? Your saved sessions will stay on this device.")) return;
    setToast("Resetting app cache…");
    const registrations = await navigator.serviceWorker?.getRegistrations();
    await Promise.all(registrations?.map((registration) => registration.unregister()) ?? []);
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    window.location.reload();
  }
  const statusLabel: Record<Meeting["status"], string> = {
    recording: "Recording",
    paused: "Paused",
    interrupted: "Interrupted",
    complete: "Complete",
  };
  return (
    <main className="app-shell">
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div>
            <p className="eyebrow">Study companion</p>
            <h1>Roza</h1>
          </div>
          <div className="brand-actions">
            <button onClick={() => void createMeeting()}>+ New</button>
            <button
              type="button"
              className="icon-btn sidebar-close"
              aria-label="Close sessions"
              onClick={() => setSidebarOpen(false)}
            >
              ✕
            </button>
          </div>
        </div>
        <input
          className="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search lessons"
        />
        <section className={`translation-panel ${persianModelSaved ? "translation-ready" : ""}`}>
          <div>
            <p className="eyebrow">Offline translation</p>
            <strong>Persian</strong>
          </div>
          <button type="button" onClick={() => void enableTranslation()} disabled={translationState !== "off"}>
            {translationState === "loading" ? `Downloading ${translationProgress}%` : persianModelSaved ? "✓ Persian model ready" : "Download Persian model"}
          </button>
          <small>{persianModelSaved ? "Saved on this device" : "Optional · no paid API"}</small>
        </section>
        <section className="label-section">
          <p className="eyebrow">Labels</p>
          <div className="label-list">
            <button className={!labelFilter ? "label-active" : ""} onClick={() => { setLabelFilter(null); setPage(1); }}>All sessions</button>
            {labels.map((label) => <button key={label} className={labelFilter === label ? "label-active" : ""} onClick={() => { setLabelFilter(label); setPage(1); }}>{label}</button>)}
          </div>
        </section>
        <nav className="meeting-list" onScroll={(event) => {
          const list = event.currentTarget;
          if (!search && meetings.length >= page * pageSize && list.scrollTop + list.clientHeight >= list.scrollHeight - 24) setPage((value) => value + 1);
        }}>
          {meetings.map((m) => (
            <button
              key={m.id}
              className={`meeting-item ${m.id === activeId ? "selected" : ""}`}
              onClick={() => {
                setActiveId(m.id);
                setSidebarOpen(false);
              }}
            >
              <strong>{m.title}</strong>
              <span>
                {clock(m.createdAt)} ·{" "}
                {m.language === "sv-SE" ? "Svenska" : "English"}
              </span>
              {m.labels.length > 0 && <small>{m.labels.join(" · ")}</small>}
            </button>
          ))}
        </nav>
        <div className="account-panel">
          {supabase ? (
            user ? (
              <>
                <span>{user.email}</span>
                <button onClick={() => void signOut()}>Sign out</button>
                <button className="quiet cache-reset" onClick={() => void resetAppCache()}>Reset app cache</button>
              </>
            ) : (
              <form onSubmit={signIn}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email for sync"
                  required
                />
                <button>Sign in</button>
              </form>
            )
          ) : (
            <span>Cloud sync awaits Supabase setup.</span>
          )}
          <small>{syncState}</small>
        </div>
      </aside>
      <section className="content">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-toggle"
            aria-label="Open sessions"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <span className="topbar-title">{active ? active.title : "Roza"}</span>
          <div className="topbar-actions">
            {user && (
              <button
                className="quiet sync-btn"
                disabled={syncState === "Syncing"}
                onClick={() => void runSync(user)}
              >
                {syncState === "Syncing" ? "Syncing…" : "Sync now"}
              </button>
            )}
            <label className="theme-select">
              <span className="sr-only">Theme</span>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as Theme)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>
        </header>
        {active ? (
          <section className="meeting-view">
            <div className="title-row">
              <input
                className="title-input"
                value={active.title}
                onChange={(e) => void saveMeeting({ title: e.target.value })}
              />
              <span className={`status-badge status-${active.status}`}>
                {active.status === "recording" && <span className="status-dot" />}
                {statusLabel[active.status]}
              </span>
            </div>
            <div className="meeting-options">
              <select
                value={active.language}
                onChange={(e) =>
                  void saveMeeting({ language: e.target.value as Language })
                }
              >
                <option value="sv-SE">Svenska</option>
                <option value="en-US">English</option>
              </select>
              <input
                value={active.labels.join(", ")}
                onChange={(e) =>
                  void saveMeeting({
                    labels: e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Labels, separated by commas"
              />
            </div>
            {active.labels.length > 0 && <div className="applied-labels">{active.labels.map((label) => <span key={label}>{label}</span>)}</div>}
            <div className="caption-card">
              <p className="eyebrow">
                {active.status === "recording"
                  ? "Live subtitles"
                  : active.status}
              </p>
              <div className="caption">
                {interim || "Press Start to show live subtitles."}
              </div>
            </div>
            <div className="controls">
              <div className="controls-primary">
                {active.status === "recording" ? (
                  <button className="pause-btn" onClick={() => void stop("paused")}>
                    <span className="btn-icon">⏸</span> Pause
                  </button>
                ) : (
                  <button className="record-btn" onClick={() => void start()}>
                    <span className="btn-icon">●</span>
                    {active.status === "complete" ? "Resume" : "Start"}
                  </button>
                )}
                <button className="quiet" onClick={() => void stop("complete")}>
                  Finish
                </button>
                <button className="quiet" onClick={() => void exportMeeting()}>
                  Export
                </button>
              </div>
              <button className="danger" onClick={() => void deleteMeeting()}>
                Delete session
              </button>
            </div>
            {message && <p className="message">{message}</p>}
            <div className="transcript">
              <h2>Transcript</h2>
              {segments.length ? (
                segments.map((s) => (
                  <article key={s.id}>
                    <time>{clock(s.createdAt)}</time>
                    <textarea
                      value={s.text}
                      onChange={(e) => void edit(s, e.target.value)}
                    />
                    {s.translatedText && <p className="translated-text" dir="rtl" lang="fa">{s.translatedText}</p>}
                  </article>
                ))
              ) : (
                <p className="empty">
                  Final subtitles save here automatically.
                </p>
              )}
            </div>
          </section>
        ) : (
          <section className="empty-state">
            <div className="empty-state-icon" aria-hidden="true">🎙️</div>
            <p className="eyebrow">Swedish and English live subtitles</p>
            <h2>Start a lesson when you are ready.</h2>
            <p className="empty-state-hint">
              Your captions and transcript stay on this device, and sync privately
              when you sign in.
            </p>
            <button onClick={() => void createMeeting()}>New session</button>
          </section>
        )}
      </section>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
