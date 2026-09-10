type TranslateRequest = { type: "translate"; id: string; text: string; source: "swe_Latn" | "eng_Latn" };
let translator: Promise<any> | null = null;

async function loadTranslator() {
  if (!translator) {
    // transformers.js downloads several files (config, tokenizer, weight shards) in
    // parallel, each reporting its own 0-100% progress. Track bytes per file and report
    // one combined percentage, otherwise the displayed number jumps around as files interleave.
    const filesInFlight = new Map<string, { loaded: number; total: number }>();
    translator = import("@huggingface/transformers")
      .then(({ pipeline }) => pipeline("translation", "Xenova/nllb-200-distilled-600M", {
        device: "wasm",
        dtype: "q4",
        progress_callback: (info: { status?: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
          if (info.status !== "progress" && info.status !== "initiate") return;
          const key = info.file ?? "default";
          if (info.status === "initiate") {
            filesInFlight.set(key, { loaded: 0, total: 0 });
          } else if (info.total) {
            filesInFlight.set(key, { loaded: info.loaded ?? 0, total: info.total });
          }
          let loaded = 0;
          let total = 0;
          for (const file of filesInFlight.values()) {
            loaded += file.loaded;
            total += file.total;
          }
          const progress = total ? (loaded / total) * 100 : 0;
          postMessage({ type: "progress", progress });
        }
      }))
      .catch((error) => {
        translator = null;
        throw error;
      });
  }
  return translator;
}

self.onmessage = async (event: MessageEvent<{ type: "load" } | TranslateRequest>) => {
  try {
    if (event.data.type === "load") {
      await loadTranslator();
      postMessage({ type: "ready" });
      return;
    }
    const pipe = await loadTranslator();
    const output = await pipe(event.data.text, { src_lang: event.data.source, tgt_lang: "pes_Arab" });
    postMessage({ type: "translated", id: event.data.id, text: output[0]?.translation_text ?? "" });
  } catch (error) {
    postMessage({ type: "error", message: error instanceof Error ? error.message : "Translation could not start." });
  }
};
