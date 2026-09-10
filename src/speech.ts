import type { Language } from "./types";

type ResultItem = { transcript: string };
type ResultList = { length: number; [index: number]: { isFinal: boolean; 0: ResultItem } };
type RecognitionEvent = { resultIndex: number; results: ResultList };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};
type RecognitionCtor = new () => Recognition;

export function hasSpeechRecognition() {
  const browser = window as typeof window & { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return Boolean(browser.SpeechRecognition || browser.webkitSpeechRecognition);
}

export function permissionSettingsHint() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "Allow Microphone for this browser in iPad Settings, then try again.";
  if (/iPhone/.test(ua)) return "Allow Microphone for this browser in iPhone Settings, then try again.";
  if (/Android/.test(ua)) return "Allow Microphone for this browser in Android Settings, then try again.";
  return "Allow microphone access for this site in your browser settings, then try again.";
}

export async function requestMicrophoneAccess() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("microphone-unavailable");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

export function speechErrorMessage(error: string) {
  if (error === "not-allowed" || error === "service-not-allowed") return `${permissionSettingsHint()} If it still fails in Chrome on iPhone/iPad, open Roza in Safari.`;
  if (error === "network") return "Live transcription needs an internet connection in this browser.";
  if (error === "audio-capture") return "No microphone is available. Disconnect Bluetooth audio and try again.";
  return `Transcription stopped: ${error}`;
}

export function createRecognizer(language: Language, onInterim: (text: string) => void, onFinal: (text: string) => void, onEnd: () => void, onError: (message: string) => void) {
  const browser = window as typeof window & { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition;
  if (!Constructor) return null;
  const recognition = new Constructor();
  recognition.lang = language;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0].transcript.trim();
      if (result.isFinal) onFinal(text);
      else interim += `${text} `;
    }
    onInterim(interim.trim());
  };
  recognition.onend = onEnd;
  recognition.onerror = (event) => onError(event.error);
  return recognition;
}
