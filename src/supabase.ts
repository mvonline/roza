import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { db, rebuildMeetingSearch } from "./db";
import type { Meeting, TranscriptSegment } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

export async function sendSignInLink(email: string) {
  if (!supabase) throw new Error("Cloud sync is not configured yet.");
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  if (error) throw error;
}

export async function verifySignInCode(email: string, token: string) {
  if (!supabase) throw new Error("Cloud sync is not configured yet.");
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
  return data.user;
}

export async function currentUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export type CloudProvider = "openai" | "anthropic" | "gemini" | "openrouter";

export async function translateWithCloud(provider: CloudProvider, model: string, texts: string[], sourceLanguage: "Swedish" | "English") {
  if (!supabase) throw new Error("Cloud translation is not configured yet.");
  const { data, error } = await supabase.functions.invoke("translate", {
    body: { provider, model, texts, sourceLanguage }
  });
  if (error) {
    const context = (error as Error & { context?: Response }).context;
    const detail = context ? await context.json().catch(() => null) as { error?: string } | null : null;
    throw new Error(detail?.error || error.message);
  }
  if (!Array.isArray(data?.translations) || data.translations.some((text: unknown) => typeof text !== "string")) {
    throw new Error("The translation service returned an invalid response.");
  }
  return data.translations as string[];
}

export async function claimLocalMeetings(userId: string) {
  const meetings = await db.meetings.filter((meeting) => !meeting.userId).toArray();
  for (const meeting of meetings) {
    await db.meetings.put({ ...meeting, userId, updatedAt: Date.now() });
    await db.syncOperations.add({ id: crypto.randomUUID(), entity: "meeting", entityId: meeting.id, action: "upsert", createdAt: Date.now(), attempts: 0 });
  }
}

function toCloudMeeting(meeting: Meeting, userId: string) {
  return {
    id: meeting.id,
    user_id: userId,
    title: meeting.title,
    created_at: meeting.createdAt,
    updated_at: meeting.updatedAt,
    started_at: meeting.startedAt ?? null,
    ended_at: meeting.endedAt ?? null,
    language: meeting.language,
    status: meeting.status,
    labels: meeting.labels,
    last_persisted_sequence: meeting.lastPersistedSequence,
    deleted_at: meeting.deletedAt ?? null
  };
}

function toCloudSegment(segment: TranscriptSegment, userId: string) {
  return {
    id: segment.id,
    meeting_id: segment.meetingId,
    user_id: userId,
    sequence: segment.sequence,
    text: segment.text,
    recognized_text: segment.recognizedText,
    translated_text: segment.translatedText ?? null,
    created_at: segment.createdAt,
    updated_at: segment.updatedAt,
    edited_at: segment.editedAt ?? null,
    deleted_at: segment.deletedAt ?? null
  };
}

export async function sync(user: User) {
  if (!supabase || !navigator.onLine) return;
  await claimLocalMeetings(user.id);
  const operations = await db.syncOperations.orderBy("createdAt").toArray();
  for (const operation of operations) {
    let error: Error | null = null;
    if (operation.entity === "meeting") {
      const meeting = await db.meetings.get(operation.entityId);
      if (meeting) {
        const result = await supabase.from("meetings").upsert(toCloudMeeting(meeting, user.id));
        error = result.error;
      }
    } else {
      const segment = await db.segments.get(operation.entityId);
      if (segment) {
        const result = await supabase.from("transcript_segments").upsert(toCloudSegment(segment, user.id), { onConflict: "meeting_id,sequence" });
        error = result.error;
      }
    }
    if (error) {
      await db.syncOperations.update(operation.id, { attempts: operation.attempts + 1 });
      throw error;
    }
    await db.syncOperations.delete(operation.id);
  }
  const lastSync = Number((await db.settings.get("last-sync"))?.value || "0");
  const [meetingsResult, segmentsResult] = await Promise.all([
    supabase.from("meetings").select("*").eq("user_id", user.id).gt("updated_at", lastSync),
    supabase.from("transcript_segments").select("*").eq("user_id", user.id).gt("updated_at", lastSync)
  ]);
  if (meetingsResult.error) throw meetingsResult.error;
  if (segmentsResult.error) throw segmentsResult.error;
  for (const row of meetingsResult.data ?? []) {
    const incoming: Meeting = {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at ?? undefined,
      endedAt: row.ended_at ?? undefined,
      language: row.language,
      status: row.status,
      labels: row.labels ?? [],
      lastPersistedSequence: row.last_persisted_sequence,
      deletedAt: row.deleted_at ?? undefined
    };
    const local = await db.meetings.get(incoming.id);
    if (!local || incoming.updatedAt >= local.updatedAt) {
      await db.meetings.put(incoming);
      await rebuildMeetingSearch(incoming);
    }
  }
  for (const row of segmentsResult.data ?? []) {
    const incoming: TranscriptSegment = {
      id: row.id,
      meetingId: row.meeting_id,
      sequence: row.sequence,
      text: row.text,
      recognizedText: row.recognized_text,
      translatedText: row.translated_text ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      editedAt: row.edited_at ?? undefined,
      deletedAt: row.deleted_at ?? undefined
    };
    const local = await db.segments.get(incoming.id);
    if (!local || incoming.updatedAt >= local.updatedAt) await db.segments.put(incoming);
  }
  await db.settings.put({ key: "last-sync", value: String(Date.now()) });
}
