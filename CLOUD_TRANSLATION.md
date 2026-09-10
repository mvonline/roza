# Cloud translation setup

Roza keeps provider keys out of the GitHub Pages app. The selected provider receives transcript text only after the user presses **Translate with AI**.

Deploy the Supabase Edge Function:

```bash
supabase functions deploy translate
```

Set only the providers you want to offer:

```bash
supabase secrets set OPENAI_API_KEY=...
supabase secrets set ANTHROPIC_API_KEY=...
supabase secrets set GEMINI_API_KEY=...
supabase secrets set OPENROUTER_API_KEY=...
supabase secrets set CLOUD_TRANSLATION_ALLOWED_EMAILS="you@example.com,wife@example.com"
```

The app offers OpenAI, Anthropic, Gemini, and OpenRouter. OpenRouter provides access to additional models without adding each provider separately. Missing provider keys result in a clear “not enabled” message and do not expose any secret to the browser.

`CLOUD_TRANSLATION_ALLOWED_EMAILS` is required. It prevents anyone else with a Supabase account from spending your provider credits.
