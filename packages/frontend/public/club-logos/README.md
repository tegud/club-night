# Club logos

Drop each club's logo image in here, then set that club's `logoUrl` to its root-relative
path. Vite copies everything under `public/` to the build root, so a file here:

```
packages/frontend/public/club-logos/northern-warlords.png
```

is served at `/club-logos/northern-warlords.png` (same CloudFront origin as the app), and
the Club record's `logoUrl` should be exactly:

```
/club-logos/northern-warlords.png
```

Notes:

- **Use the club slug as the filename** (`<slug>.png`) to keep them easy to find.
- A root-relative path (no domain) keeps logos host-agnostic — they resolve against
  whatever origin serves the app.
- These ship with the frontend build, so they survive the deploy's `aws s3 sync … --delete`
  (which would wipe anything uploaded straight into the site bucket).
- Changing a logo requires a commit + redeploy. If that becomes painful, migrate to a
  dedicated assets bucket (Option 2) so logos can be uploaded without a deploy.
- Square images render best — the header shows them at 48×48 with `object-fit: contain`.
```
