import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://roza.vafa.one",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

type Provider = "openai" | "anthropic" | "gemini" | "openrouter";
type RequestBody = { provider: Provider; model: string; texts: string[]; sourceLanguage: "Swedish" | "English" };

const allowedModels: Record<Provider, string[]> = {
  openai: ["gpt-4.1-mini", "gpt-4.1"],
  anthropic: ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  openrouter: ["openrouter/free", "google/gemini-2.5-flash", "anthropic/claude-sonnet-4", "openai/gpt-4.1"]
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function extractJsonArray(text: string) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Provider did not return a JSON array.");
  const translations = JSON.parse(match[0]);
  if (!Array.isArray(translations) || translations.some((item) => typeof item !== "string")) throw new Error("Provider returned invalid translations.");
  return translations;
}

async function requestProvider(provider: Provider, model: string, prompt: string) {
  if (provider === "openai") {
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) throw new Error("OpenAI is not enabled by the owner.");
    const result = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0 }) });
    if (!result.ok) throw new Error(`OpenAI request failed (${result.status}).`);
    return (await result.json()).choices?.[0]?.message?.content ?? "";
  }
  if (provider === "anthropic") {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) throw new Error("Anthropic is not enabled by the owner.");
    const result = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model, max_tokens: 4096, temperature: 0, messages: [{ role: "user", content: prompt }] }) });
    if (!result.ok) throw new Error(`Anthropic request failed (${result.status}).`);
    return (await result.json()).content?.[0]?.text ?? "";
  }
  if (provider === "gemini") {
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) throw new Error("Gemini is not enabled by the owner.");
    const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }) });
    if (!result.ok) throw new Error(`Gemini request failed (${result.status}).`);
    return (await result.json()).candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw new Error("OpenRouter is not enabled by the owner.");
  const result = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://roza.vafa.one", "X-Title": "Roza" }, body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0, response_format: { type: "json_object" } }) });
  if (!result.ok) throw new Error(`OpenRouter request failed (${result.status}).`);
  const content = (await result.json()).choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(content);
  return JSON.stringify(parsed.translations ?? parsed);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  try {
    const token = request.headers.get("Authorization");
    if (!token) return response({ error: "Sign in is required." }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: token } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return response({ error: "Sign in is required." }, 401);
    const allowedEmails = (Deno.env.get("CLOUD_TRANSLATION_ALLOWED_EMAILS") || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (!user.email || !allowedEmails.includes(user.email.toLowerCase())) return response({ error: "Cloud translation is not enabled for this account." }, 403);
    const body = await request.json() as RequestBody;
    if (!allowedModels[body.provider]?.includes(body.model) || !Array.isArray(body.texts) || body.texts.length < 1 || body.texts.length > 20 || body.texts.some((text) => typeof text !== "string") || !["Swedish", "English"].includes(body.sourceLanguage)) return response({ error: "Invalid translation request." }, 400);
    const texts = body.texts.map((text) => text.trim());
    if (texts.join("").length > 24000) return response({ error: "Translation batch is too long." }, 400);
    const prompt = `Translate each ${body.sourceLanguage} transcript part below into natural Persian. Preserve names, textile terminology, and the array order. Return only a JSON array of Persian strings, with exactly ${texts.length} entries.\n\n${JSON.stringify(texts)}`;
    const translations = extractJsonArray(await requestProvider(body.provider, body.model, prompt));
    if (translations.length !== texts.length) throw new Error("Provider returned the wrong number of translations.");
    return response({ translations });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Translation failed." }, 500);
  }
});
