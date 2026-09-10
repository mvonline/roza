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
