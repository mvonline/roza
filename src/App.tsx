import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { db, normalize, queueSync, rebuildMeetingSearch } from "./db";
import { createRecognizer, hasSpeechRecognition, permissionSettingsHint, requestMicrophoneAccess, speechErrorMessage } from "./speech";
import { currentUser, sendSignInLink, supabase, sync, translateWithCloud, verifySignInCode, type CloudProvider } from "./supabase";
import type { Language, Meeting, TranscriptSegment } from "./types";

type Theme = "system" | "light" | "dark";
type SegmentTranslationStatus = { message: string; retryable?: boolean };
type TranslationEngine = "cloud" | "local";
const pageSize = 50;
const translationLockKey = "roza-persian-translation-lock";
const localModelVersion = "nllb-q4-v1";
const cloudModels: Record<CloudProvider, { value: string; label: string }[]> = {
  openai: [{ value: "gpt-4.1-mini", label: "GPT-4.1 mini" }, { value: "gpt-4.1", label: "GPT-4.1" }],
  anthropic: [{ value: "claude-sonnet-4-20250514", label: "Claude Sonnet" }, { value: "claude-haiku-4-5-20251001", label: "Claude Haiku" }],
  gemini: [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }],
  openrouter: [{ value: "openrouter/free", label: "Free model router" }, { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet" }, { value: "openai/gpt-4.1", label: "GPT-4.1" }]
};
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
  const [speechLog, setSpeechLog] = useState<string[]>([]);
  const [translationLog, setTranslationLog] = useState<string[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [signInCode, setSignInCode] = useState("");
  const [signInState, setSignInState] = useState<"idle" | "sending" | "sent" | "verifying">("idle");
  const [signInMessage, setSignInMessage] = useState("");
  const [syncState, setSyncState] = useState(
    supabase ? "Sign in to sync" : "Saved on this device",
  );
  const [toast, setToast] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [translationState, setTranslationState] = useState<"off" | "loading" | "ready">("off");
  const [translationProgress, setTranslationProgress] = useState(0);
  const [persianModelSaved, setPersianModelSaved] = useState(() => localStorage.getItem("roza-persian-model") === localModelVersion);
  const [cloudProvider, setCloudProvider] = useState<CloudProvider>(() => (localStorage.getItem("roza-cloud-provider") as CloudProvider) || "openrouter");
  const [cloudModel, setCloudModel] = useState(() => localStorage.getItem("roza-cloud-model") || "openrouter/free");
  const [cloudTranslating, setCloudTranslating] = useState(false);
  const [cloudAutoTranslate, setCloudAutoTranslate] = useState(() => localStorage.getItem("roza-cloud-auto-translate") !== "false");
  const [translationEngine, setTranslationEngine] = useState<TranslationEngine>(() => (localStorage.getItem("roza-translation-engine") as TranslationEngine) || "cloud");
  const [segmentTranslationStatus, setSegmentTranslationStatus] = useState<Record<string, SegmentTranslationStatus>>({});
  const [showDiagnostics, setShowDiagnostics] = useState(() => localStorage.getItem("roza-show-diagnostics") === "true");
  const recognizer = useRef<ReturnType<typeof createRecognizer>>(null);
  const activeRef = useRef<string | null>(null);
  const stopped = useRef(false);
  const recognitionStarting = useRef(false);
  const translationWorker = useRef<Worker | null>(null);
  const tabId = useRef(crypto.randomUUID());
  const syncInFlight = useRef<Promise<void> | null>(null);
  const syncRequested = useRef(false);
  const meetingSaveInFlight = useRef<Promise<void>>(Promise.resolve());
  const cloudTranslationQueue = useRef<Promise<void>>(Promise.resolve());
  const pausingRecordings = useRef<Promise<void> | null>(null);
  const pauseOpenRecordingsRef = useRef<(reason: string) => Promise<void>>(async () => undefined);
  const diagnosticsEnabled = useRef(showDiagnostics);

  const traceSpeech = useCallback((event: string) => {
    if (!diagnosticsEnabled.current) return;
    const entry = `${new Date().toLocaleTimeString()} — ${event}`;
    console.info("[Roza speech]", entry);
    setSpeechLog((items) => [entry, ...items].slice(0, 16));
  }, []);
  const traceTranslation = useCallback((event: string) => {
    if (!diagnosticsEnabled.current) return;
    const entry = `${new Date().toLocaleTimeString()} — ${event}`;
    console.info("[Roza translation]", entry);
    setTranslationLog((items) => [entry, ...items].slice(0, 16));
  }, []);

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
    (account: User) => {
      syncRequested.current = true;
      if (syncInFlight.current) return syncInFlight.current;
      const task = (async () => {
      try {
        do {
          syncRequested.current = false;
          setSyncState("Syncing");
          setToast("Syncing your sessions…");
          await sync(account);
        } while (syncRequested.current);
        setSyncState("Synced");
        setToast("Sync complete");
        await loadMeetings();
        await loadSegments(activeRef.current);
      } catch {
        setSyncState("Needs attention");
        setToast("Sync failed. Your changes remain saved on this device.");
      } finally {
        syncInFlight.current = null;
      }
      })();
      syncInFlight.current = task;
      return task;
    },
    [loadMeetings, loadSegments],
  );
  const pauseOpenRecordings = useCallback(async (reason: string) => {
    if (pausingRecordings.current) return pausingRecordings.current;
    const task = (async () => {
      stopped.current = true;
      recognitionStarting.current = false;
      recognizer.current?.stop();
      recognizer.current = null;
      setInterim("");
      const recordings = await db.meetings.where("status").equals("recording").filter((meeting) => !meeting.deletedAt).toArray();
      if (!recordings.length) return;
      const updatedAt = Date.now();
      await db.transaction("rw", db.meetings, db.syncOperations, async () => {
        for (const meeting of recordings) {
          await db.meetings.put({ ...meeting, status: "paused", updatedAt });
          await queueSync("meeting", meeting.id, "upsert");
        }
      });
      traceSpeech(`Recording paused: ${reason}`);
      await loadMeetings();
      await loadSegments(activeRef.current);
      if (user) void runSync(user);
    })();
    pausingRecordings.current = task.catch(() => undefined);
    try {
      await task;
    } finally {
      pausingRecordings.current = null;
    }
  }, [loadMeetings, loadSegments, runSync, traceSpeech, user]);
  useEffect(() => {
    pauseOpenRecordingsRef.current = pauseOpenRecordings;
  }, [pauseOpenRecordings]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("roza-theme", theme);
  }, [theme]);
  useEffect(() => {
    diagnosticsEnabled.current = showDiagnostics;
  }, [showDiagnostics]);
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
    void pauseOpenRecordingsRef.current("Roza was reopened");
    const pauseForPageExit = () => void pauseOpenRecordingsRef.current("Roza was closed or reloaded");
    addEventListener("pagehide", pauseForPageExit);
    return () => {
      removeEventListener("pagehide", pauseForPageExit);
    };
  }, []);
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
  function selectTranslationEngine(engine: TranslationEngine) {
    if (engine === "cloud") {
      translationWorker.current?.terminate();
      translationWorker.current = null;
      setTranslationState("off");
      releaseTranslationLock();
    }
    setTranslationEngine(engine);
    localStorage.setItem("roza-translation-engine", engine);
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
        localStorage.setItem("roza-persian-model", localModelVersion);
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
    const meetingId = activeRef.current;
    if (!meetingId) return;
    const task = meetingSaveInFlight.current.then(async () => {
      const current = await db.meetings.get(meetingId);
      if (!current || current.deletedAt) return;
      const next = { ...current, ...changes, updatedAt: Date.now() };
      setMeetings((items) => items.map((meeting) => (meeting.id === next.id ? next : meeting)).sort((a, b) => b.createdAt - a.createdAt));
      await db.transaction("rw", db.meetings, db.searchEntries, db.syncOperations, async () => {
        await db.meetings.put(next);
        await rebuildMeetingSearch(next);
        if (user) await queueSync("meeting", next.id, "upsert");
      });
      await loadMeetings();
      if (user) void runSync(user);
    });
    meetingSaveInFlight.current = task.catch(() => undefined);
    await task;
  }
  async function saveFinal(text: string) {
    const meetingId = activeRef.current;
    if (!meetingId || !text) return;
    traceSpeech(`Final text received (${text.length} characters)`);
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
    if (saved) {
      if (translationEngine === "cloud" && cloudAutoTranslate && user) scheduleCloudTranslation(saved, source);
      if (translationEngine === "local") requestTranslation(saved, source);
    }
    if (user) void runSync(user);
  }
  function beginRecognition(language: Language) {
    if (stopped.current || recognitionStarting.current) return;
    recognitionStarting.current = true;
    traceSpeech("Creating recognizer");
    const next = createRecognizer(
      language,
      (text) => {
        if (text) traceSpeech(`Interim text received (${text.length} characters)`);
        setInterim(text);
      },
      (text) => void saveFinal(text),
      () => {
        recognitionStarting.current = false;
        traceSpeech("Recognizer ended");
        if (!stopped.current) window.setTimeout(() => beginRecognition(language), 400);
      },
      (error) => {
        traceSpeech(`Recognizer error: ${error}`);
        setMessage(speechErrorMessage(error));
        if (["not-allowed", "service-not-allowed", "audio-capture"].includes(error)) {
          stopped.current = true;
          void saveMeeting({ status: "paused" });
        }
      },
    );
    if (!next) {
      recognitionStarting.current = false;
      return;
    }
    recognizer.current = next;
    try {
      next.start();
      traceSpeech("Recognizer start requested");
      setMessage("");
    } catch (error) {
      recognitionStarting.current = false;
      traceSpeech(`Recognizer start threw: ${error instanceof Error ? error.name : "unknown error"}`);
      setMessage("Could not start transcription. Try Start once more.");
    }
  }
  async function start() {
    traceSpeech("Start pressed");
    if (!active) {
      traceSpeech("Stopped: no active session");
      return;
    }
    if (!hasSpeechRecognition()) {
      traceSpeech("Stopped: speech recognition API unavailable");
      return setMessage(
        /CriOS/.test(navigator.userAgent)
          ? "Chrome on iPhone/iPad does not provide reliable live transcription. Open Roza in Safari and allow the microphone."
          : "Live transcription is unavailable in this browser. Try Safari on iPhone/iPad, or Chrome on Android/desktop.",
      );
    }
    try {
      traceSpeech("Requesting microphone permission");
      await requestMicrophoneAccess();
      traceSpeech("Microphone permission granted");
    } catch (error) {
      traceSpeech(`Microphone permission failed: ${error instanceof Error ? error.name : "unknown error"}`);
      return setMessage(permissionSettingsHint());
    }
    stopped.current = false;
    await saveMeeting({ status: "recording", startedAt: active.startedAt || Date.now() });
    traceSpeech("Session marked as recording");
    beginRecognition(active.language);
  }
  async function stop(status: "paused" | "complete") {
    stopped.current = true;
    recognitionStarting.current = false;
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
  async function translateSessionWithCloud() {
    if (!active || !user) return setToast("Sign in before using cloud translation.");
    const pending = segments.filter((segment) => !segment.deletedAt && segment.text.trim() && !segment.translatedText);
    if (!pending.length) return setToast("This session is already translated.");
    if (!window.confirm(`Send ${pending.length} transcript parts to ${cloudProvider} for Persian translation? This uses that provider's account and privacy policy.`)) return;
    traceTranslation(`Manual translation started for ${pending.length} rows with ${cloudProvider}/${cloudModel}`);
    setCloudTranslating(true);
    try {
      const translations: string[] = [];
      for (let index = 0; index < pending.length; index += 20) {
        const batch = pending.slice(index, index + 20);
        translations.push(...await translateWithCloud(cloudProvider, cloudModel, batch.map((segment) => segment.text), active.language === "sv-SE" ? "Swedish" : "English"));
      }
      if (translations.length !== pending.length) throw new Error("Some transcript parts were not translated.");
      await db.transaction("rw", db.segments, db.syncOperations, async () => {
        for (const [index, segment] of pending.entries()) {
          await db.segments.put({ ...segment, translatedText: translations[index], updatedAt: Date.now() });
          await queueSync("segment", segment.id, "upsert");
        }
      });
      await loadSegments(active.id);
      void runSync(user);
      traceTranslation(`Manual translation saved for ${pending.length} rows`);
      setToast("Cloud translation complete");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Cloud translation failed.";
      traceTranslation(`Manual translation failed — ${detail}`);
      setToast(detail);
    } finally {
      setCloudTranslating(false);
    }
  }
  function scheduleCloudTranslation(segment: TranscriptSegment, source: Language) {
    requestAnimationFrame(() => {
      window.setTimeout(() => queueCloudTranslation(segment, source), 0);
    });
  }
  function queueCloudTranslation(segment: TranscriptSegment, source: Language) {
    traceTranslation(`Queued row ${segment.sequence} with ${cloudProvider}/${cloudModel}`);
    setSegmentTranslationStatus((current) => ({ ...current, [segment.id]: { message: "Queued for Persian translation…" } }));
    const task = cloudTranslationQueue.current.then(async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          traceTranslation(`Row ${segment.sequence}: attempt ${attempt + 1} started`);
          setSegmentTranslationStatus((current) => ({
            ...current,
            [segment.id]: { message: attempt === 0 ? "Translating to Persian…" : "Retrying translation…" },
          }));
          const [translatedText] = await Promise.race([
            translateWithCloud(cloudProvider, cloudModel, [segment.text], source === "sv-SE" ? "Swedish" : "English"),
            new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Translation timed out.")), 45_000)),
          ]);
          if (!translatedText) throw new Error("The provider returned an empty translation.");
          await saveTranslation(segment.id, translatedText);
          traceTranslation(`Row ${segment.sequence}: Persian translation saved`);
          setSegmentTranslationStatus((current) => {
            const next = { ...current };
            delete next[segment.id];
            return next;
          });
          return;
        } catch (error) {
          lastError = error;
          traceTranslation(`Row ${segment.sequence}: attempt ${attempt + 1} failed — ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
      const detail = lastError instanceof Error ? lastError.message : "Cloud translation failed.";
      traceTranslation(`Row ${segment.sequence}: stopped after retry — manual retry available`);
      setSegmentTranslationStatus((current) => ({ ...current, [segment.id]: { message: `Translation failed: ${detail}`, retryable: true } }));
      setToast(detail);
    });
    cloudTranslationQueue.current = task.catch(() => undefined);
  }
  async function retryCloudTranslation(segment: TranscriptSegment) {
    traceTranslation(`Manual retry requested for row ${segment.sequence}`);
    const meeting = await db.meetings.get(segment.meetingId);
    queueCloudTranslation(segment, meeting?.language ?? "sv-SE");
  }
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setSignInState("sending");
    setSignInMessage("");
    setToast("Sending sign-in email…");
    try {
      await sendSignInLink(email.trim());
      setSignInState("sent");
      setSignInMessage(`Sign-in email sent to ${email.trim()}.`);
      setToast("Sign-in email sent. Check your inbox.");
    } catch (error) {
      setSignInState("idle");
      const text = error instanceof Error ? error.message : "Could not send the sign-in email.";
      setSignInMessage(text);
      setToast(text);
    }
  }
  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setSignInState("verifying");
    setSignInMessage("");
    try {
      const account = await verifySignInCode(email.trim(), signInCode.trim());
      setUser(account);
      setSignInMessage("Signed in. Syncing your sessions…");
      if (account) void runSync(account);
    } catch (error) {
      setSignInState("sent");
      setSignInMessage(error instanceof Error ? error.message : "That code could not be verified.");
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
    localStorage.removeItem("roza-persian-model");
    localStorage.removeItem(translationLockKey);
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
        <details className="settings-panel">
          <summary>Settings</summary>
          <section className="translation-engine-setting">
            <label>
              Translation engine
              <select value={translationEngine} onChange={(event) => selectTranslationEngine(event.target.value as TranslationEngine)}>
                <option value="cloud">Cloud AI</option>
                <option value="local">Local / offline AI</option>
              </select>
            </label>
            <small>{translationEngine === "cloud" ? "Uses your selected cloud provider. The offline model is inactive." : "Runs only on this device. Cloud AI is inactive."}</small>
          </section>
          {translationEngine === "local" && <section className={`translation-panel ${persianModelSaved ? "translation-ready" : ""}`}>
            <div>
              <p className="eyebrow">Offline translation</p>
              <strong>Persian</strong>
            </div>
            <button type="button" onClick={() => void enableTranslation()} disabled={translationState !== "off"}>
              {translationState === "loading" ? `Downloading ${translationProgress}%` : persianModelSaved ? "✓ Persian model ready" : "Download Persian model"}
            </button>
            <small>{persianModelSaved ? "Saved on this device" : "Optional · no paid API"}</small>
          </section>}
          {translationEngine === "cloud" && <section className="cloud-translation">
            <div>
              <p className="eyebrow">High-quality cloud translation</p>
              <strong>Translate the current session to Persian</strong>
            </div>
            <div className="cloud-controls">
              <select value={cloudProvider} onChange={(event) => {
                const provider = event.target.value as CloudProvider;
                const model = cloudModels[provider][0].value;
                setCloudProvider(provider);
                setCloudModel(model);
                localStorage.setItem("roza-cloud-provider", provider);
                localStorage.setItem("roza-cloud-model", model);
              }}>
                <option value="openrouter">OpenRouter</option>
                <option value="openai">OpenAI / ChatGPT</option>
                <option value="anthropic">Anthropic / Claude</option>
                <option value="gemini">Google Gemini</option>
              </select>
              <select value={cloudModel} onChange={(event) => { setCloudModel(event.target.value); localStorage.setItem("roza-cloud-model", event.target.value); }}>
                {cloudModels[cloudProvider].map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
              </select>
              <label className="auto-translate-toggle">
                <input type="checkbox" checked={cloudAutoTranslate} disabled={!user} onChange={(event) => {
                  setCloudAutoTranslate(event.target.checked);
                  localStorage.setItem("roza-cloud-auto-translate", String(event.target.checked));
                }} />
                Translate each new chunk
              </label>
              <button type="button" onClick={() => void translateSessionWithCloud()} disabled={cloudTranslating}>
                {cloudTranslating ? "Translating…" : !user ? "Sign in to use AI" : !active ? "Open a session to translate" : "Translate with AI"}
              </button>
            </div>
            <small>{!user ? "Sign in first so Roza can securely call your selected provider." : cloudAutoTranslate ? "Each finalized new chunk is sent to the selected provider." : !active ? "Select or create a session first." : "Only when you press Translate with AI is this session sent to the selected provider."}</small>
          </section>}
          <section className="diagnostics-setting">
            <label>
              <input type="checkbox" checked={showDiagnostics} onChange={(event) => {
                setShowDiagnostics(event.target.checked);
                localStorage.setItem("roza-show-diagnostics", String(event.target.checked));
              }} />
              Show diagnostics
            </label>
            <small>Show temporary transcription and translation logs while troubleshooting.</small>
          </section>
        </details>
        <div className="account-panel">
          {supabase ? (
            user ? (
              <>
                <span>{user.email}</span>
                <button onClick={() => void signOut()}>Sign out</button>
                <button className="quiet cache-reset" onClick={() => void resetAppCache()}>Reset app cache</button>
              </>
            ) : (
              <>
                <form onSubmit={signIn}>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email for sync"
                    autoComplete="email"
                    required
                  />
                  <button type="submit" disabled={signInState === "sending" || signInState === "verifying"}>{signInState === "sending" ? "Sending…" : "Send sign-in email"}</button>
                </form>
                {signInState === "sent" && <form className="sign-in-code" onSubmit={verifyCode}>
                  <input value={signInCode} onChange={(e) => setSignInCode(e.target.value)} placeholder="Email code (if provided)" inputMode="numeric" autoComplete="one-time-code" />
                  <button className="quiet" disabled={!signInCode}>Verify code</button>
                </form>}
                {signInMessage && <p className="sign-in-message">{signInMessage} {signInState === "sent" && "Open the email on this device. On iPad, Safari is more reliable than the installed app for magic links."}</p>}
              </>
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
            {showDiagnostics && <>
              <details className="speech-debug">
                <summary>Transcription diagnostic</summary>
                <p>This log stays only in this browser until the page is refreshed.</p>
                {speechLog.length === 0 ? <p>No speech activity yet.</p> : <ol>{speechLog.map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol>}
              </details>
              <details className="speech-debug">
                <summary>Translation diagnostic</summary>
                <p>This log stays only in this browser until the page is refreshed.</p>
                {translationLog.length === 0 ? <p>No translation activity yet.</p> : <ol>{translationLog.map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol>}
              </details>
            </>}
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
                    {!s.translatedText && segmentTranslationStatus[s.id] && (
                      <div className="translation-status">
                        <span>{segmentTranslationStatus[s.id].message}</span>
                        {segmentTranslationStatus[s.id].retryable && <button type="button" onClick={() => void retryCloudTranslation(s)}>Retry</button>}
                      </div>
                    )}
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
