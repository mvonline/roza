import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { db, normalize, queueSync, rebuildMeetingSearch } from "./db";
import { createRecognizer, hasSpeechRecognition } from "./speech";
import { currentUser, sendSignInLink, supabase, sync } from "./supabase";
import type { Language, Meeting, TranscriptSegment } from "./types";

type Theme = "system" | "light" | "dark";
const pageSize = 50;
const dateTitle = () => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date());
const clock = (value: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(value);

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("roza-theme") as Theme) || "system");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [language, setLanguage] = useState<Language>("sv-SE");
  const [interim, setInterim] = useState("");
  const [message, setMessage] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [syncState, setSyncState] = useState(supabase ? "Sign in to sync" : "Saved on this device");
  const recognizer = useRef<ReturnType<typeof createRecognizer>>(null);
  const activeRef = useRef<string | null>(null);
  const stopped = useRef(false);

  const loadMeetings = useCallback(async () => {
    const term = normalize(search);
    if (!term) return setMeetings(await db.meetings.orderBy("updatedAt").reverse().filter((m) => !m.deletedAt).limit(page * pageSize).toArray());
    const hits = await db.searchEntries.filter((entry) => entry.normalizedText.includes(term)).toArray();
    const found = (await db.meetings.bulkGet([...new Set(hits.map((hit) => hit.meetingId))])).filter((m): m is Meeting => Boolean(m && !m.deletedAt));
    setMeetings(found.sort((a, b) => b.updatedAt - a.updatedAt));
  }, [page, search]);
  const loadSegments = useCallback(async (id: string | null) => {
    if (!id) return setSegments([]);
    const rows = await db.segments.where("meetingId").equals(id).filter((segment) => !segment.deletedAt).toArray();
    setSegments(rows.sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence));
  }, []);
  const runSync = useCallback(async (account: User) => { try { setSyncState("Syncing"); await sync(account); setSyncState("Synced"); await loadMeetings(); await loadSegments(activeRef.current); } catch { setSyncState("Needs attention"); } }, [loadMeetings, loadSegments]);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("roza-theme", theme); }, [theme]);
  useEffect(() => { void loadMeetings(); }, [loadMeetings]);
  useEffect(() => { activeRef.current = activeId; void loadSegments(activeId); }, [activeId, loadSegments]);
  useEffect(() => { void currentUser().then((account) => { setUser(account); if (account) void runSync(account); }); if (!supabase) return; const { data } = supabase.auth.onAuthStateChange((_e, session) => { setUser(session?.user ?? null); if (session?.user) void runSync(session.user); }); return () => data.subscription.unsubscribe(); }, [runSync]);
  useEffect(() => { const online = () => user && void runSync(user); addEventListener("online", online); return () => removeEventListener("online", online); }, [runSync, user]);

  const active = meetings.find((m) => m.id === activeId) || null;
  async function createMeeting() {
    const now = Date.now();
    const meeting: Meeting = { id: crypto.randomUUID(), userId: user?.id, title: dateTitle(), createdAt: now, updatedAt: now, language, status: "paused", labels: [], lastPersistedSequence: 0 };
    await db.transaction("rw", db.meetings, db.searchEntries, db.syncOperations, async () => { await db.meetings.add(meeting); await rebuildMeetingSearch(meeting); if (user) await queueSync("meeting", meeting.id, "upsert"); });
    setSearch(""); setPage(1); setActiveId(meeting.id); await loadMeetings(); if (user) void runSync(user);
  }
  async function saveMeeting(changes: Partial<Meeting>) {
    if (!active) return;
    const next = { ...active, ...changes, updatedAt: Date.now() };
    setMeetings((current) => current.map((meeting) => meeting.id === next.id ? next : meeting).sort((a, b) => b.updatedAt - a.updatedAt));
    await db.transaction("rw", db.meetings, db.searchEntries, db.syncOperations, async () => { await db.meetings.put(next); await rebuildMeetingSearch(next); if (user) await queueSync("meeting", next.id, "upsert"); });
    await loadMeetings(); if (user) void runSync(user);
  }
  async function saveFinal(text: string) {
    const meetingId = activeRef.current;
    if (!meetingId || !text) return;
    await db.transaction("rw", db.meetings, db.segments, db.searchEntries, db.syncOperations, async () => {
      const meeting = await db.meetings.get(meetingId);
      if (!meeting) return;
      const now = Date.now();
      const segment: TranscriptSegment = { id: crypto.randomUUID(), meetingId, sequence: meeting.lastPersistedSequence + 1, text, recognizedText: text, createdAt: now, updatedAt: now };
      const updated = { ...meeting, lastPersistedSequence: segment.sequence, updatedAt: now };
      await db.meetings.put(updated);
      await db.segments.add(segment);
      await db.searchEntries.put({ id: `segment:${segment.id}`, meetingId, segmentId: segment.id, source: "transcript", normalizedText: normalize(text), preview: text });
      if (user) { await queueSync("meeting", meetingId, "upsert"); await queueSync("segment", segment.id, "upsert"); }
    });
    setInterim(""); await loadSegments(meetingId); await loadMeetings(); if (user) void runSync(user);
  }
  async function start() {
    if (!active) return;
    if (!hasSpeechRecognition()) return setMessage("Try Safari on iPhone/iPad or Chrome on Android for live transcription.");
    stopped.current = false; await saveMeeting({ status: "recording", startedAt: active.startedAt || Date.now() });
    recognizer.current = createRecognizer(active.language, setInterim, (text) => void saveFinal(text), () => { if (!stopped.current) setTimeout(() => { void db.meetings.get(activeRef.current || "").then((m) => { if (m?.status === "recording") void start(); }); }, 400); }, (error) => setMessage(`Transcription stopped: ${error}`));
    try { recognizer.current?.start(); setMessage(""); } catch { setMessage("Roza is already listening."); }
  }
  async function stop(status: "paused" | "complete") { stopped.current = true; recognizer.current?.stop(); recognizer.current = null; setInterim(""); await saveMeeting({ status, endedAt: status === "complete" ? Date.now() : undefined }); }
  async function edit(segment: TranscriptSegment, text: string) { const next = { ...segment, text, editedAt: Date.now(), updatedAt: Date.now() }; await db.transaction("rw", db.segments, db.searchEntries, db.syncOperations, async () => { await db.segments.put(next); await db.searchEntries.put({ id: `segment:${segment.id}`, meetingId: segment.meetingId, segmentId: segment.id, source: "transcript", normalizedText: normalize(text), preview: text }); if (user) await queueSync("segment", segment.id, "upsert"); }); await loadSegments(segment.meetingId); if (user) void runSync(user); }
  async function deleteMeeting() {
    if (!active || !window.confirm(`Delete “${active.title}”?`)) return;
    const now = Date.now();
    const meeting = { ...active, deletedAt: now, updatedAt: now };
    const meetingSegments = await db.segments.where("meetingId").equals(active.id).toArray();
    await db.transaction("rw", db.meetings, db.segments, db.syncOperations, async () => {
      await db.meetings.put(meeting);
      for (const segment of meetingSegments) {
        await db.segments.put({ ...segment, deletedAt: now, updatedAt: now });
        if (user) await queueSync("segment", segment.id, "delete");
      }
      if (user) await queueSync("meeting", meeting.id, "delete");
    });
    stopped.current = true;
    recognizer.current?.stop();
    recognizer.current = null;
    setActiveId(null);
    await loadMeetings();
    if (user) void runSync(user);
  }
  async function signIn(event: React.FormEvent) { event.preventDefault(); try { await sendSignInLink(email); setMessage("Check your email for the sign-in link."); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not sign in."); } }

  const signOut = () => supabase?.auth.signOut();
  return <main className="app-shell"><aside className="sidebar"><div className="brand-row"><div><p className="eyebrow">Study companion</p><h1>Roza</h1></div><button onClick={() => void createMeeting()}>+ New</button></div><input className="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search lessons" /> <nav className="meeting-list">{meetings.map((m) => <button key={m.id} className={`meeting-item ${m.id === activeId ? "selected" : ""}`} onClick={() => setActiveId(m.id)}><strong>{m.title}</strong><span>{clock(m.updatedAt)} · {m.language === "sv-SE" ? "Svenska" : "English"}</span>{m.labels.length > 0 && <small>{m.labels.join(" · ")}</small>}</button>)}{!search && meetings.length >= page * pageSize && <button onClick={() => setPage((n) => n + 1)}>Load more</button>}</nav><div className="account-panel">{supabase ? user ? <><span>{user.email}</span><button onClick={() => void signOut()}>Sign out</button></> : <form onSubmit={signIn}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email for sync" required /><button>Sign in</button></form> : <span>Cloud sync awaits Supabase setup.</span>}<small>{syncState}</small></div></aside><section className="content"><header className="topbar"><label>Theme <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>{user && <button onClick={() => void runSync(user)}>Sync now</button>}</header>{active ? <section className="meeting-view"><input className="title-input" value={active.title} onChange={(e) => void saveMeeting({ title: e.target.value })} /><div className="meeting-options"><select value={active.language} onChange={(e) => void saveMeeting({ language: e.target.value as Language })}><option value="sv-SE">Svenska</option><option value="en-US">English</option></select><input value={active.labels.join(", ")} onChange={(e) => void saveMeeting({ labels: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="Labels, separated by commas" /></div><div className="caption-card"><p className="eyebrow">{active.status === "recording" ? "Live subtitles" : active.status}</p><div className="caption">{interim || "Press Start to show live subtitles."}</div></div><div className="controls">{active.status === "recording" ? <button onClick={() => void stop("paused")}>Pause</button> : <button onClick={() => void start()}>{active.status === "complete" ? "Resume" : "Start"}</button>}<button className="quiet" onClick={() => void stop("complete")}>Finish</button></div>{message && <p className="message">{message}</p>}<div className="transcript"><h2>Transcript</h2>{segments.length ? segments.map((s) => <article key={s.id}><time>{clock(s.createdAt)}</time><textarea value={s.text} onChange={(e) => void edit(s, e.target.value)} /></article>) : <p className="empty">Final subtitles save here automatically.</p>}</div></section> : <section className="empty-state"><p className="eyebrow">Swedish and English live subtitles</p><h2>Start a lesson when you are ready.</h2><button onClick={() => void createMeeting()}>New session</button></section>}</section></main>;
}
