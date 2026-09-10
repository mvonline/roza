# Roza — Product and Technical Specification

## 1. Purpose

Roza is a privacy-first Progressive Web App (PWA) for live transcription in Swedish and English. It is initially being developed as a calm study companion for the owner's wife during her studies at YH Textile Borås. She can create a session for a lecture, lesson, workshop, or study discussion, see live subtitles, and keep the transcript on her own device.

The first release must be deployable as a static site on GitHub Pages, require no paid LLM API, and remain usable for meetings lasting multiple hours.

### Primary user and use cases

The first user is a Swedish learner studying textiles. The design should therefore favor clarity, readable captions, and an easy way to return to a lesson later. It must not assume technical knowledge or require the user to manage files during a lecture.

- Start a **Lecture** session before class and read live Swedish subtitles while listening.
- Record a workshop or group discussion in Swedish or English and review the transcript afterward.
- Give each session a familiar, editable title such as `Textile materials — 10 Sep`.
- Export a lesson transcript for personal study or safekeeping.

The app name shown in the interface, web manifest, install prompt, and page title is **Roza**.

## 2. Scope

### Version 1: included

- Installable PWA for modern Android and iOS browsers.
- A recognizable Roza icon when installed on an iPhone, iPad, Android phone, or desktop.
- Create, pause, resume, and finish transcription sessions.
- Swedish (`sv-SE`) and English (`en-US`) transcription selection.
- Live interim text and durable final transcript segments.
- Live-caption view: large, readable subtitles while speech is happening.
- Safe corrections: recognition can revise interim captions; users can edit finalized text.
- A ChatGPT-like meeting history/sidebar: one in-app tab/session per meeting.
- Automatic session names based on date and time, with optional approximate location.
- Rename, search, open, delete, and export sessions.
- Add simple labels to organize sessions, such as `Lecture`, `Workshop`, `Exam prep`, or `Textile materials`.
- Local-first storage in IndexedDB.
- Passwordless sign-in and private cloud sync across iPhone, iPad, and laptop.
- Optional audio recording, stored as short chunks rather than one large file.
- Clear status and recovery after browser/recognition interruption.

### Explicitly not in version 1

- Translation.
- Summaries, notes, action items, or chat with a meeting.
- Shared workspaces or multi-user collaboration.
- A guarantee that recording continues when the device is locked or the app is backgrounded.
- A guaranteed fully-offline transcription engine.

## 3. Product principles

1. **Local first.** Meetings stay on the device unless the user exports them or later explicitly uses a cloud provider.
2. **Never lose a long meeting because of memory usage.** Persist completed work continuously.
3. **No vendor lock-in.** Transcription, translation, and summarization are replaceable providers.
4. **Progressive enhancement.** A device without a capability gets a clear fallback message, not a broken screen.
5. **No secrets in the frontend.** A static site must never contain an API key, GitHub token, or private credential.
6. **Simple on every screen.** The recording/caption experience takes priority over controls and settings.
7. **Private by default.** A signed-in user can access only their own cloud data.

## 4. User experience

### App layout

Use an in-app sidebar/history rather than actual browser tabs. Keep the visual language warm, calm, and uncluttered—more like a study notebook than an engineering dashboard.

```text
+--------------------------+----------------------------------------+
| + New session            |  Session title                  Rename |
| Search meetings          |  Recording / Paused / Complete         |
|                          |  01:24:18                              |
| Today                    |                                        |
| • 10 Sep, 14:05          |  live/interim text                     |
| • Product planning       |  final timestamped transcript segments |
|                          |                                        |
| Yesterday                |                                        |
| • 09 Sep, 16:30          |                                        |
+--------------------------+----------------------------------------+
```

### Responsive behavior

The interface must be mobile-first and work well on phones, iPads/tablets, and desktops.

| Screen | Layout behavior |
| --- | --- |
| Phone | One main screen. History opens in a slide-over drawer. Recording controls remain reachable at the bottom; live captions are the primary content. |
| Tablet/iPad | Two-column layout when landscape has sufficient room; otherwise use the phone drawer layout. |
| Desktop | Persistent, resizable history sidebar and main meeting panel. |

The app must work with touch, keyboard, screen readers, and common portrait/landscape rotations. Avoid dense toolbars, hidden critical actions, and hover-only interactions.

### Theme

- Support light and dark themes from the first release.
- Default to the operating-system preference (`prefers-color-scheme`).
- Provide an explicit Light / Dark / System choice in settings.
- Persist the choice locally.
- Use semantic color tokens rather than hard-coded colors so all screens, captions, status/error states, and future features adapt consistently.
- Meet accessible contrast targets, especially for large live captions and recording/error indicators.

### Installed app icon

Roza appears on the home screen/app launcher with its own icon and name. Provide a simple, original Roza mark in these formats:

- `192×192` PNG and `512×512` PNG for the web manifest.
- `180×180` PNG Apple touch icon for iPhone and iPad.
- A maskable icon with safe padding so Android does not crop the mark.
- Light/dark icon variants only if the mark needs them; otherwise use one high-contrast icon.

The initial purple microphone mark is a placeholder. Choose the final Roza icon before public launch.

### Live captions and corrections

"Live transcribe" means the user sees subtitle-like text while somebody speaks, not only a transcript after the meeting ends.

1. **Interim caption:** show the browser's provisional recognition result immediately in a prominent caption area. It may change as more audio is recognized.
2. **Final segment:** when the recognition engine declares text final, append it to the durable transcript and save it to IndexedDB.
3. **User correction:** tapping/clicking a final segment opens simple inline editing. Save the correction immediately and retain the original recognized text for recovery/audit/export options.
4. **No invented correction:** version 1 must not silently use an LLM to rewrite or change what was said. Basic display cleanup such as whitespace normalization is acceptable; semantic corrections remain user edits.

The caption view should keep only the most recent one or two lines large and easy to read. The complete transcript remains below it or in the session detail view.

### New session flow

1. User selects **New session**.
2. User chooses Swedish or English and whether to record audio.
3. App creates and saves a session *before* requesting the microphone.
4. Default title is `10 Sep 2026, 14:05`.
5. If the user has enabled optional location naming, append a manually chosen or approximate location label: `10 Sep 2026, 14:05 — Stockholm`.
6. User presses **Start recording**; microphone permission is requested.
7. App shows live interim transcription and saves finalized segments immediately.

### Sign-in and sync

- The first screen offers **Continue with email**. Use a passwordless email code or magic link.
- Roza writes locally to IndexedDB first and syncs in the background when online.
- The same email account on iPhone, iPad, and laptop sees the same sessions, labels, transcripts, and optional audio.
- Show `Saved on this device`, `Syncing`, `Synced`, or `Needs attention`.
- A user can sign out, which clears the local Roza database on that device after confirmation. Cloud data remains available after signing in again.
- A user can choose **Use on this device only** before sign-in and connect it to an account later.

### Session actions

- Rename title inline.
- Add, remove, and filter by simple colored-text labels. Labels are optional and user-defined.
- Pause/resume transcription and audio recording.
- Finish session; mark it complete without deleting data.
- Export transcript as Markdown, plain text, or JSON.
- Export audio only when audio recording was enabled.
- Delete with a confirmation that specifies whether audio will also be deleted.

### Location

Location is optional and off by default. Browser geolocation gives coordinates, not a reliable city name. Version 1 should either use a user-entered location label or no location label. Reverse-geocoding coordinates into a city is deferred because it adds a network/privacy dependency.

## 5. Functional requirements

### Transcription

- Use the Web Speech API (`SpeechRecognition` or `webkitSpeechRecognition`) as the initial transcription provider.
- Configure `continuous: true` and `interimResults: true` when supported.
- Set language per session (`sv-SE` or `en-US`). Do not auto-detect/switch languages in version 1.
- Display interim results but do not persist them as final content.
- Render interim text as live captions in a large, high-contrast area.
- Persist every finalized result as a timestamped segment.
- Permit inline edits to final segments; user text takes precedence over recognized text everywhere in the UI and standard export.
- Handle `end`, permission, network, and language errors. Attempt a controlled restart only while the meeting is marked recording and the microphone permission remains available.
- Do not promise offline transcription: browser implementations may use a vendor service.

### Long-session reliability and memory

- Never retain the complete audio history, all `Blob`s, or all transcript records in application memory.
- Write each finalized transcript event in a short IndexedDB transaction.
- If audio is enabled, use `MediaRecorder` chunks of approximately 15 seconds. Persist each chunk and release its in-memory reference immediately.
- Render only a bounded recent transcript window; fetch older segments on demand or virtualize the list.
- Create a durable checkpoint after each final transcript segment/audio chunk.
- Track `lastPersistedSequence` so recovery can avoid duplicate segments after a recognizer restart.
- Query `navigator.storage.estimate()` and show a storage warning before recording when space is low.
- Call `navigator.storage.persist()` after explaining why persistent device storage is useful. The browser may decline it; handle that outcome.
- Store text and optional audio separately. Text is the default; audio needs explicit opt-in.

### Interruptions

- Detect browser recognition/recording end events and update the UI immediately.
- Preserve every saved segment if the page reloads, OS interrupts, battery dies, or the browser restarts recognition.
- On reopening an incomplete meeting, show **Resume**, **Finish**, and **Export saved transcript**.
- Request a screen wake lock while actively recording where supported; release it on pause/finish.
- Tell users that iOS/Android can interrupt microphone capture when the screen locks, the app is backgrounded, a call arrives, or the OS reclaims resources.

### Meeting history and search

- Sidebar initially loads the newest 50 meeting metadata records, ordered by most recent activity.
- Load a further page only when the user reaches the end of the history list. Do not load transcripts or audio merely to render history.
- Opening a meeting loads transcript pages/chunks on demand. The visible transcript also uses virtualization so long meetings do not create thousands of page elements.
- Search both meeting titles and the contents of every saved transcript locally, including sessions that have not been opened during this app launch.
- Build/update a small local search index when a title, label, or final transcript segment is saved. Search must not require a network request or load every audio file/transcript into memory.
- Search results show matching meeting title, date, labels, and a short matching text excerpt. Selecting a result opens the meeting at that segment.
- Labels are searchable and can be used as a filter.
- Group history by date in the UI.

### Audio playback

When the user enables optional audio recording, Roza can play the audio captured for that session. The session view provides play/pause, elapsed time, and a jump from a transcript segment to its related audio position.

- Playback reads only the required audio chunk(s); it must not combine an entire multi-hour recording into one in-memory `Blob`.
- Audio remains local unless the user explicitly exports it.
- Audio playback is an optional enhancement. The transcript-only flow remains complete and simple.
- Clearly show **Audio recording on** before capture begins.

### Phone and video calls

Roza can record and replay sound that reaches the selected microphone, such as an in-person lecture or a speakerphone call. A normal mobile PWA cannot directly access the protected audio stream of an iPhone/Android telephone call, so it cannot reliably record both call participants. Do not promise phone-call recording.

For remote classes/calls, use the conferencing platform's recording/captions where allowed, or place the call on speaker and understand that microphone quality will be limited. Always inform participants/lecturers and get the relevant permission before recording. In Sweden, being a participant is significant to the criminal eavesdropping rule, but school policies, privacy obligations, and sharing recordings still matter; this is not legal advice.

### Privacy and retention

- Show a concise consent notice before first microphone use.
- State that browser speech recognition may send audio to the browser/vendor recognition service.
- No analytics by default.
- Never upload audio/transcripts automatically.
- Provide clear local deletion and export.
- Clearly warn that private/incognito browsing does not provide durable local storage.
- Keep cloud data in private tables and a private file bucket; do not use public meeting or audio URLs.

## 6. Data model

All records are stored in IndexedDB. IDs are UUIDs; timestamps are epoch milliseconds.

```ts
type MeetingStatus = "recording" | "paused" | "interrupted" | "complete";

type Meeting = {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  updatedAt: number;
  language: "sv-SE" | "en-US";
  status: MeetingStatus;
  audioEnabled: boolean;
  locationLabel?: string;
  labels: string[];
  lastPersistedSequence: number;
  deletedAt?: number;
};

type TranscriptSegment = {
  id: string;
  meetingId: string;
  sequence: number;
  startMs?: number;
  endMs?: number;
  text: string; // current displayed/exported text
  recognizedText: string; // original final speech-recognition result
  editedAt?: number;
  createdAt: number;
  source: "browser-speech" | "local-model" | "import";
  updatedAt: number;
  deletedAt?: number;
};

type AudioChunk = {
  id: string;
  meetingId: string;
  sequence: number;
  startMs: number;
  endMs: number;
  mimeType: string;
  blob: Blob;
  uploadedAt?: number;
};

type SearchEntry = {
  id: string;
  meetingId: string;
  segmentId?: string;
  source: "title" | "label" | "transcript";
  normalizedText: string;
};

type SyncOperation = {
  id: string;
  entity: "meeting" | "segment" | "audio" | "label";
  entityId: string;
  action: "upsert" | "delete";
  createdAt: number;
  attempts: number;
};
```

Required indexes:

- `Meeting.updatedAt`
- `TranscriptSegment.[meetingId+sequence]` (unique)
- `TranscriptSegment.meetingId`
- `AudioChunk.[meetingId+sequence]` (unique)
- `AudioChunk.meetingId`
- `SearchEntry.meetingId`
- `SearchEntry.normalizedText`
- `SyncOperation.createdAt`

The sequence constraint makes restarts idempotent and prevents duplicate finalized segments.

## 7. Architecture

### Recommended stack

| Concern | Choice | Reason |
| --- | --- | --- |
| UI | React + TypeScript + Vite | Small static build and good maintainability. |
| Styling | CSS modules or Tailwind CSS | Choose one; avoid a second component framework initially. |
| PWA | vite-plugin-pwa / Workbox | Installability and cached app shell. |
| Local database | Dexie over IndexedDB | Indexed queries, transactions, and migrations. |
| Sign-in, cloud database, file storage | Supabase | Passwordless email sign-in, Postgres, private audio storage, and row-level access rules. |
| Audio | MediaRecorder | Browser-native chunked recording. |
| Transcription v1 | Web Speech API adapter | No paid LLM API and fast live interim results. |
| Heavy future work | Web Worker | Keeps model/processing work off the UI thread. |
| Validation | Zod | Validate imports and stored/exported records. |
| Testing | Vitest + Playwright | Unit tests and real browser flow coverage. |

### Provider boundaries

Do not let UI components call browser APIs directly. Define interfaces behind adapters.

```ts
interface TranscriptionProvider {
  start(options: { language: "sv-SE" | "en-US" }): Promise<void>;
  stop(): Promise<void>;
  onInterim(callback: (text: string) => void): () => void;
  onFinal(callback: (result: { text: string; startMs?: number; endMs?: number }) => void): () => void;
  onState(callback: (state: "running" | "ended" | "error") => void): () => void;
}

interface TranslationProvider {
  translate(input: { text: string; sourceLanguage: string; targetLanguage: string }): Promise<string>;
}

interface SummaryProvider {
  summarize(input: { transcript: string; language: "sv" | "en" }): Promise<string>;
}
```

Version 1 implements only `BrowserSpeechTranscriptionProvider`. Translation and summary interfaces are present but have no enabled provider or UI action yet.

### Cloud sync architecture

Use Supabase Auth, Postgres, and Storage. GitHub Pages hosts only the static frontend.

```text
iPhone / iPad / laptop
  Roza UI
    ↕
  IndexedDB + durable sync outbox
    ↕ when online and signed in
  Supabase Auth + Postgres + private Storage
```

- Email magic-link or one-time-code sign-in is the only version 1 auth method.
- The frontend may contain Supabase's publishable project key. It must never contain a Supabase `service_role` key, database password, or other secret.
- Every cloud record contains `user_id` equal to the authenticated user ID.
- Enable Row Level Security on every exposed table. For read, create, edit, and delete, allow only `auth.uid() = user_id`.
- Store optional audio in a private `roza-audio` bucket under `<user-id>/<meeting-id>/<sequence>`. Storage policies must require the first path component to equal the authenticated user ID.
- Upload audio chunks one at a time only after they are safely saved locally.

### Sync rules

- Each local write commits to IndexedDB and adds a `SyncOperation` in the same transaction.
- Sync sends the outbox oldest first and retries with backoff. Recording never waits for network sync.
- On another device, fetch changed records by `updated_at` and update the local database/search index.
- Transcript segments are append-only unless edited. Concurrent edits use last-write-wins and show a conflict notice when a remote edit replaces a local unsynced edit.
- Use `deletedAt` tombstones so deletes sync safely before later cleanup.
- Audio chunks are immutable after upload.
- Support **Sync now** and automatically sync on app open, online event, and when recording stops.

### Future model processing

Local model work must run in a dedicated Web Worker. Possible later adapters include an in-browser Whisper transcription model and local translation/summarization models via Transformers.js/ONNX Runtime Web. These features need capability checks, model-download progress, cancellation, and low-memory fallbacks.

Do not assume that every phone can run a local model well. A future cloud provider must be opt-in and must use a backend proxy or a user-supplied key kept out of the static build.

## 8. Hosting and deployment

### Version 1 hosting

Deploy the Vite static output to GitHub Pages using GitHub Actions. Supabase is the only cloud service required for sign-in and sync; no custom backend is needed.

- Use HTTPS (required for microphone and many PWA capabilities).
- Set the Vite base path correctly for the GitHub Pages repository path.
- Configure the service worker to cache the application shell, not unlimited audio/model assets.
- Use cache versioning so deploys update the app safely.
- Add a custom domain early if one is planned.

### Origin warning

IndexedDB is tied to the exact site origin. Moving from `username.github.io/project` to another domain does not move local meetings. Implement export/import from the first release and prefer a stable custom domain if the project will move later.

### Render

Render is not necessary for version 1. If used later for a backend, treat it as stateless; do not store meeting files on its local filesystem. The free tier is suitable for experiments, not durable production data: free web services spin down after inactivity and their local files are ephemeral; free Postgres has a limited lifetime.

### Supabase setup required before sync development

1. Create one Supabase project.
2. Enable email OTP or magic-link authentication.
3. Set `https://roza.vafa.one` as the site URL and allowed redirect URL.
4. Create protected meeting/segment/label tables and a private `roza-audio` bucket.
5. Apply and test Row Level Security policies using two separate test accounts.
6. Add only the project URL and publishable key as GitHub Actions build variables.

### Firebase alternative

Firebase can provide email authentication and Firestore sync, but it is not the recommended provider for Roza. Firebase Storage is required for cloud audio playback/sync, and as of February 2026 Firebase Storage requires the pay-as-you-go Blaze plan, including for access to the default bucket. That means a billing account is required even when usage remains within a no-cost allowance.

Use Firebase only if accepting a linked billing account and Google Cloud storage pricing is preferable. Supabase remains the simpler default for Roza because its Postgres model suits meetings, segments, labels, local search metadata, and strict per-user access policies.

### GitHub Models

GitHub Models must not be part of this plan. GitHub retired its Models catalog, playground, and inference API in July 2026. GitHub Copilot model access is not a public inference API for this application.

## 9. Browser support and fallbacks

Target current Chrome on Android and Safari on iOS first. Feature-detect all APIs.

| Capability | Main path | Fallback |
| --- | --- | --- |
| Microphone | `getUserMedia` | Explain unsupported/denied state. |
| Live transcription | Web Speech API | Explain that browser/device is unsupported; allow no-transcription session only if useful. |
| Audio capture | MediaRecorder | Transcript-only session. |
| Persistent storage | Storage API | Store normally and show export reminder. |
| Wake lock | Screen Wake Lock API | Tell user to keep screen awake. |
| Local models later | WebGPU/WebAssembly | Disable local model option or use an opted-in remote provider. |

Test real devices. Browser support does not guarantee identical language accuracy, continuous-session behavior, or background behavior.

## 10. Export and import

- Markdown: readable meeting title, metadata, and timestamped transcript.
- Plain text: simple transcript for sharing.
- JSON: full portable backup of meeting metadata and transcript segments.
- Audio export: optional and explicit; package chunks only when feasible, otherwise export individual chunks with a manifest.
- Import JSON with schema validation and collision-safe new IDs.

## 11. Security checklist

- HTTPS only.
- Require authenticated access for every cloud meeting, transcript, search entry, and audio object.
- Test data isolation with two accounts: account A must receive an authorization failure for every attempted account B read, write, or delete.
- Never expose a service-role key, database connection string, or email-provider secret to GitHub Pages.
- Strict Content Security Policy compatible with required model/CDN assets if added later.
- No API secrets or private tokens in source, GitHub Pages variables, or browser storage.
- Validate imports before writing them to IndexedDB.
- Escape/render transcript text safely; never inject transcript HTML.
- Keep third-party scripts to a minimum.
- Ask for microphone/location only after a user action and only for the selected feature.

## 12. Development phases

### Phase A — foundation

1. Create Vite/React/TypeScript app and GitHub Pages deployment.
2. Add PWA manifest, service worker, and capability detection screen.
3. Implement Dexie schema, migrations, export/import baseline, and durable sync outbox.
4. Set up Supabase email sign-in, private storage, and tested Row Level Security policies.

### Phase B — sessions and transcription

1. Build sidebar/history and session creation/rename/delete.
2. Implement browser speech adapter with Swedish/English selection.
3. Persist final segments continuously and recover interrupted meetings.
4. Add labels, a virtualized transcript view, and local indexed title/content search.

### Phase C — long-recording hardening

1. Add optional 15-second audio chunks.
2. Add quota monitoring, persistent-storage request, recovery and error states.
3. Test one-, two-, and three-hour meetings on real Android and iOS devices.
4. Add export and delete-audio flows.

### Phase D — future AI features

1. Add translation data model and provider selection, without modifying source transcript records.
2. Add a local-worker model proof of concept and device capability checks.
3. Add summaries/notes as derived, versioned artifacts.
4. Only then consider an opt-in backend/provider for devices that cannot run local models.

## 13. Version 1 acceptance criteria

- A user can install the PWA and create a Swedish or English session.
- A signed-in user sees the same synced meeting data on iPhone, iPad, and laptop.
- A second account cannot read, search, change, download, or delete the first account's data.
- Recording remains usable while offline; the app indicates when locally saved changes still need sync.
- The interface is usable on a phone, iPad/tablet, and desktop in portrait and landscape orientations.
- The interface follows the system light/dark preference and allows the user to override it.
- Session metadata appears in history before microphone capture begins.
- Renaming persists across reloads.
- Meeting history loads incrementally, and a local search finds text in both session titles and saved transcript segments without loading all audio into memory.
- A user can add labels and filter/search sessions by them.
- During recording, the most recent recognized words appear as large live captions; provisional captions can change without creating duplicate final transcript text.
- A user can correct a final transcript segment inline, and the correction persists after reload/export.
- Final transcript text survives reload, interruption, and app restart.
- A two-hour transcript-only test does not grow JavaScript memory proportionally to transcript length.
- With audio enabled, chunks are persisted incrementally and no full recording is held in RAM.
- The app shows an actionable state when microphone permission is denied, speech recognition ends, storage is low, or an API is unsupported.
- A user can export and later import a transcript on the same or a different device.
- The deployed GitHub Pages build contains no credentials and works without a backend.

## 14. Decisions to make before implementation

1. Should version 1 include optional audio recording, or transcript-only first?
2. Should the initial visual style be minimal/utilitarian or resemble a familiar chat application?
3. Will a custom domain be used from the first deploy?
4. Is English/Swedish manual selection sufficient, or should each meeting allow a second language selection later?
