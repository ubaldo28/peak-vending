# Peak Vending

Marketing site for [peak-vending.com](https://peak-vending.com) — a full-service
vending operator covering Dundee, Angus, Fife and Perthshire.

Astro with static output, deployed to Cloudflare Workers. Every page is HTML on
a CDN; the single server route is the contact endpoint. No client framework, no
CSS framework, no analytics, no cookies.

---

## Why it is built this way

**Static by default, dynamic only where it must be.** A vending firm's brochure
site has one interactive feature: a contact form. Making that one route
server-rendered and leaving the other fourteen pages as static HTML means the
site costs nothing to serve, survives a traffic spike without configuration, and
has almost no attack surface.

**No framework on the client.** Total JavaScript shipped is a few kilobytes: a
class toggle for no-JS fallbacks, an `IntersectionObserver` for reveal
animations, and the form's submit handler. React would have been more code than
the site itself.

**Plain CSS with custom properties.** `src/styles/tokens.css` holds the type
scale, spacing scale and palette; components consume the tokens. Astro scopes
component styles automatically, so there is no naming convention to enforce and
no specificity arms race.

**Content in Markdown, business facts in one file.** Services and locations are
content collections, so adding a page means adding a Markdown file. Every phone
number, address and service area lives in `src/data/site.ts` — change it once
and the nav, footer, contact page, structured data and email templates all
follow.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:4321
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production build, then generates the security headers |
| `npm run preview` | Runs the **real** Worker bundle locally via Wrangler |
| `npm run deploy` | Builds and deploys to Cloudflare |
| `npm run check` | Type-checks the project |
| `npm run audit:a11y` | Runs the accessibility suite against `dist/` |

`npm run preview` is the one that matters before a deploy. `npm run dev` runs
Vite; `preview` runs the actual bundle Cloudflare will execute, including the
contact endpoint against local KV.

---

## Layout

```
content/          Markdown for services and locations, plus sponsors.json
scripts/
  security-headers.mjs   Generates dist/client/_headers after each build
  audit-a11y.mjs         axe-core + manual WCAG checks; exits non-zero on failure
src/
  components/     Nav, Footer, ContactForm, Logo, Icon, Machine, Sponsors
  data/site.ts    Single source of truth for every business fact
  layouts/        Base.astro — head, structured data, skip link
  pages/
    api/contact.ts    The only server route
  styles/         tokens.css, base.css, components.css
public/           Favicons, OG image, email artwork, robots.txt
```

---

## Security

**Content-Security-Policy is generated, not hand-written.** Astro emits inline
`<script>` and `<style>` blocks whose contents change with the source. A
hand-maintained policy drifts and starts blocking the site's own JavaScript, so
`scripts/security-headers.mjs` hashes every inline block after each build and
writes the policy from that. The result carries **no `unsafe-inline`** for
either scripts or styles. If a `style="..."` attribute ever creeps in — which
cannot be hashed — the build fails rather than quietly weakening the policy.

Also set: HSTS with preload, `X-Content-Type-Options`, `Referrer-Policy`,
a `Permissions-Policy` denying every sensor and payment API, `frame-ancestors
'none'`, `base-uri 'none'`, and `no-store` on `/api/*`.

**The contact endpoint** ([`src/pages/api/contact.ts`](src/pages/api/contact.ts))
defends on several fronts:

| Risk | Mitigation |
| --- | --- |
| CSRF via form POST | `Origin`/`Referer` must match the host; cross-origin gets 403 |
| Email header injection | Control characters stripped from every field before it reaches a subject or address |
| HTML injection in the email | All interpolated values escaped |
| Spam and abuse | Honeypot field, a three-second timing trap, and 5 submissions per IP per hour in KV |
| Oversized payloads | Every field length-capped before processing |
| Error leakage | Provider errors go to logs; the client gets a generic message |

Secrets are Cloudflare Workers secrets, never files. `.dev.vars` and `.env` are
gitignored.

---

## Accessibility

WCAG 2.2 AA, enforced by a script rather than a claim:

```bash
npm run build && npm run audit:a11y
# audit-a11y: 15 pages, 2 widths, 0 violations.
```

[`scripts/audit-a11y.mjs`](scripts/audit-a11y.mjs) runs axe-core over every
page at 1440px and 390px, then adds the checks automation usually skips. It
exits non-zero on any finding, so it works as a CI gate. What it covers:

- Every interactive element reachable by keyboard with a visible focus ring
- `prefers-reduced-motion` honoured; all transitions disabled
- No horizontal scrolling at 320px (reflow, 1.4.10)
- One `<h1>` per page and no skipped heading levels

Plus, by construction: a skip link as the first tab stop, and form errors tied
to their inputs with `aria-describedby` so a screen reader says what is wrong
rather than only that something is.

---

## Deploying

```bash
npx wrangler login
npm run deploy
```

The custom domains in `wrangler.jsonc` are created by Wrangler on deploy. Set
the four secrets once (see `.env.example`); they persist across deploys.

---

## Licence

The code is available for reading and reference. The Peak Vending name, logo and
copy belong to the client and are not covered.
