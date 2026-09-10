export type Language = "sv-SE" | "en-US";

export type MeetingStatus = "recording" | "paused" | "interrupted" | "complete";

export type Meeting = {
  id: string;
  userId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  language: Language;
  status: MeetingStatus;
  labels: string[];
  lastPersistedSequence: number;
  deletedAt?: number;
};

export type TranscriptSegment = {
  id: string;
  meetingId: string;
  sequence: number;
  text: string;
  recognizedText: string;
  translatedText?: string;
  createdAt: number;
  updatedAt: number;
  editedAt?: number;
  deletedAt?: number;
};

export type SearchEntry = {
  id: string;
  meetingId: string;
  segmentId?: string;
  source: "title" | "label" | "transcript";
  normalizedText: string;
  preview: string;
};

export type SyncOperation = {
  id: string;
  entity: "meeting" | "segment";
  entityId: string;
  action: "upsert" | "delete";
  createdAt: number;
  attempts: number;
};
