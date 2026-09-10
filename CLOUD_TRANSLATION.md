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

## Free OpenRouter option

OpenRouter is the simplest no-cost cloud option for Roza:

1. Create an OpenRouter account and create an API key in its dashboard.
2. Set it only as the Supabase secret shown above; never put it in GitHub Pages variables or the Roza app.
3. In Roza, open **Settings → High-quality cloud translation**, select **OpenRouter**, then select **Free model router**.

The `openrouter/free` route automatically selects a currently available free model. It is useful for personal study and testing, but the selected model, speed, quality, and availability can vary. OpenRouter documents a free-tier limit of 50 free-model requests per day without purchased credits; the limit increases to 1,000 daily after purchasing at least $10 in credits. Check the OpenRouter dashboard for the current limit before relying on it for long meetings.

OpenRouter references: [Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router), [FAQ and rate limits](https://openrouter.ai/docs/faq), and [API quickstart](https://openrouter.ai/docs/quickstart).
