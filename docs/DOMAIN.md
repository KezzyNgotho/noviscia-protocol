# Custom domain — noviscia.com

Canonical production URL: **https://noviscia.com**

## Vercel (recommended)

1. Open the Vercel project for `app/web` (root directory: `noviscia-protocal/app/web`).
2. **Settings → Domains** → Add `noviscia.com` and `www.noviscia.com`.
3. At your registrar, set DNS per Vercel’s instructions:
   - **Apex (`noviscia.com`)** — A record → `76.76.21.21` (or CNAME flattening if your registrar supports it).
   - **`www`** — CNAME → `cname.vercel-dns.com`.
4. Wait for SSL provisioning (usually minutes).
5. Set environment variable on Vercel (all environments):

   ```bash
   NEXT_PUBLIC_SITE_URL=https://noviscia.com
   ```

6. Redeploy. `vercel.json` redirects `www` → apex.

## Keeper / indexer

Point callbacks at the live site:

```bash
# services/keeper/.env
NOVISCIA_WEB_URL=https://noviscia.com
```

## Email (optional)

Support currently uses `keziengotho18@gmail.com` until `support@noviscia.com` is configured.

For `support@noviscia.com` and `security@noviscia.com` (future):

- Google Workspace, Zoho, or registrar email forwarding
- Add MX records at your DNS host

## Verify

```bash
curl -sI https://noviscia.com | head -5
curl -s https://noviscia.com/api/keeper/status | head -c 200
```

## Staging

Use a Vercel preview URL or `staging.noviscia.com` (separate Vercel project or branch alias). Do not point staging at production program admin keys.
