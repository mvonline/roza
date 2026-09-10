import Dexie, { type Table } from "dexie";
import type { Meeting, SearchEntry, SyncOperation, TranscriptSegment } from "./types";

class RozaDatabase extends Dexie {
  meetings!: Table<Meeting, string>;
  segments!: Table<TranscriptSegment, string>;
  searchEntries!: Table<SearchEntry, string>;
  syncOperations!: Table<SyncOperation, string>;
  settings!: Table<{ key: string; value: string }, string>;

  constructor() {
    super("roza");
    this.version(1).stores({
      meetings: "id, updatedAt, userId, status, *labels",
      segments: "id, meetingId, [meetingId+sequence], updatedAt",
      searchEntries: "id, meetingId, segmentId, source, normalizedText",
      syncOperations: "id, createdAt",
      settings: "key"
    });
    this.version(2).stores({
      meetings: "id, createdAt, updatedAt, userId, status, *labels",
      segments: "id, meetingId, [meetingId+sequence], updatedAt",
      searchEntries: "id, meetingId, segmentId, source, normalizedText",
      syncOperations: "id, createdAt",
      settings: "key"
    });
  }
}

export const db = new RozaDatabase();

export function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

export async function rebuildMeetingSearch(meeting: Meeting) {
  await db.searchEntries.where("meetingId").equals(meeting.id).and((entry) => entry.source !== "transcript").delete();
  const entries: SearchEntry[] = [
    {
      id: `meeting:${meeting.id}`,
      meetingId: meeting.id,
      source: "title",
      normalizedText: normalize(meeting.title),
      preview: meeting.title
    },
    ...meeting.labels.map((label) => ({
      id: `label:${meeting.id}:${normalize(label)}`,
      meetingId: meeting.id,
      source: "label" as const,
      normalizedText: normalize(label),
      preview: label
    }))
  ];
  await db.searchEntries.bulkPut(entries);
}

export async function queueSync(entity: SyncOperation["entity"], entityId: string, action: SyncOperation["action"]) {
  await db.syncOperations.put({
    id: `${entity}:${entityId}`,
    entity,
    entityId,
    action,
    createdAt: Date.now(),
    attempts: 0
  });
}
