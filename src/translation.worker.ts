type TranslateRequest = { type: "translate"; id: string; text: string; source: "swe_Latn" | "eng_Latn" };
let translator: Promise<any> | null = null;

async function loadTranslator() {
  if (!translator) {
    translator = import("@huggingface/transformers")
      .then(({ pipeline }) => pipeline("translation", "Xenova/nllb-200-distilled-600M", {
        device: "wasm",
        dtype: "q8",
        progress_callback: (info: { status?: string; progress?: number }) => {
          if (info.status === "progress_total") postMessage({ type: "progress", progress: info.progress ?? 0 });
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
