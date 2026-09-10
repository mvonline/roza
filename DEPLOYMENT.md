# Deploy Roza

1. Push this repository to GitHub on the `main` branch.
2. In GitHub, open **Settings → Pages** and select **GitHub Actions** as the source.
3. In your DNS provider, create a `CNAME` record for `roza` pointing to `<your-github-username>.github.io`.
4. In **Settings → Pages**, set the custom domain to `roza.vafa.one` and enable HTTPS after GitHub verifies it.
5. The workflow deploys Roza after every push to `main`.

The app needs no Google account, API key, backend, or database for its first version.
