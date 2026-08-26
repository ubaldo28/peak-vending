# Peak Vending

Marketing site for peak-vending.com. Astro, static output, deployed to Cloudflare
Workers. The only server-side route is the contact form endpoint; everything else
is HTML on a CDN, so traffic costs nothing and scales without configuration.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:4321
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Runs the **real** Worker bundle locally via Wrangler |
| `npm run deploy` | Builds, then deploys to Cloudflare |
| `npm run check` | Type-checks the project |

`npm run preview` is the one that matters before a deploy — `npm run dev` uses
Vite, `preview` runs the actual thing Cloudflare will execute.

---

## First deploy

```bash
npx wrangler login
npm run deploy
```

That publishes to `peak-vending.<your-subdomain>.workers.dev`. To put it on the
real domain, add `peak-vending.com` to Cloudflare, then in the dashboard:
**Workers & Pages → peak-vending → Settings → Domains & Routes → Add custom domain**.

Before going live, set the real URL in `astro.config.mjs` — `site` is what every
canonical tag, OG tag and the sitemap are built from.

---

## Turning the contact form on

The form works the moment three secrets exist. Until then it stays up and tells
visitors to call instead, rather than silently swallowing enquiries.

1. Create a [Resend](https://resend.com) account and verify `peak-vending.com` as
   a sending domain. The free tier is far more than this site will use.
2. Push the secrets:

```bash
npx wrangler secret put RESEND_API_KEY     # re_...
npx wrangler secret put CONTACT_TO         # where enquiries land
npx wrangler secret put CONTACT_FROM       # must be on the verified domain
```

3. Redeploy: `npm run deploy`

For local testing, copy `.env.example` to `.env` and fill in the same three
values.

### What the endpoint already handles

- Server-side validation with per-field error messages
- A honeypot field, plus rejection of anything submitted under three seconds
- Length caps on every field
- HTML escaping on everything that reaches the email body
- Works without JavaScript — falls back to a normal form post and a redirect
- Cross-origin posts are blocked by Astro's built-in origin check

### Optional: rate limiting

Uncomment the `kv_namespaces` block in `wrangler.jsonc` after running:

```bash
npx wrangler kv namespace create RATE_LIMIT
```

The endpoint detects the binding and switches rate limiting on (5 submissions per
IP per hour). Without it, everything else still works.

---

## Editing content

Nothing below needs a developer.

### Business details — `src/data/site.ts`

Phone, email, service area, hours, social links. Changing it here updates the
nav, footer, contact page, and the structured data Google reads, all at once.

**Before launch, replace the placeholder phone number `(000) 000-0000` and the
`areaServed` value.** Both appear in several places, including search results.

### Services — `content/services/*.md`

One file per service. Add a file, it appears on the homepage grid (if
`featured: true`), on `/services/`, and in the jump nav.

```markdown
---
title: "Coffee service"
summary: "One line, shown on cards."
icon: coffee          # layers | calendar | wrench | card | chart | shield | coffee | market
order: 70             # lower sorts first
featured: false       # true puts it on the homepage
bullets:
  - "Shown as a ticked list"
---

Body copy. Blank line between paragraphs.
```

### Locations — `content/locations/*.md`

One file per location type. Each one generates its own page at
`/locations/<filename>/`, and appears in the homepage grid, the footer, the
locations index, and the contact form dropdown. This is where local SEO comes
from — a page per type beats one page listing them all.

### Sponsors — `content/sponsors/sponsors.json`

```json
[
  {
    "id": "acme",
    "name": "Acme Drinks",
    "logo": "/sponsors/acme.svg",
    "url": "https://acme.example",
    "tier": "strip",
    "blurb": "Only shown on feature cards.",
    "order": 10,
    "active": true
  }
]
```

Put the logo file in `public/sponsors/`. SVG or transparent PNG.

- `tier: "strip"` — thin logo band near the bottom of the homepage
- `tier: "feature"` — also gets a card on the About page

Logos render desaturated and lift to full colour on hover, so a sponsor's brand
colours never fight the page. **If no sponsor has `active: true`, the whole
section disappears** — nothing to remove, nothing empty on the page. The file
ships with one inactive example so you can see the shape.

---

## How it's put together

```
src/
  data/site.ts          business details, nav, homepage proof points
  content.config.ts     schemas for services / locations / sponsors
  styles/
    tokens.css          every colour, size and space value
    base.css            resets, layout primitives, scroll reveal
    components.css      buttons, cards, tiles, splits, CTA band
  components/
    LogoDefs.astro      logo + machine SVG geometry, emitted once per page
    Logo.astro          <Logo variant="full|mark" />
    Icon.astro          icon set, sized by prop
    Nav / Footer / Sponsors / ContactForm / Machine
  layouts/Base.astro    head, meta, OG, JSON-LD, nav, footer, reveal script
  pages/                one file per route
content/                the editable stuff
public/                 favicon, logo, sponsor logos, robots.txt
```

### The logo

It was vectorised from the original JPEG into two colour groups, so it recolours
per section rather than being a fixed image. The blue and the charcoal come from
`--pv-blue` and `--pv-dark`, which the dark footer and CTA band override. There
is no raster logo anywhere on the site.

### Fonts

Barlow Semi Condensed (display) and Source Sans 3 (body), self-hosted via
`@fontsource`. No request to Google, nothing to block, no layout shift.

---

## Before you launch

- [ ] Real phone number and service area in `src/data/site.ts`
- [ ] Real domain in `astro.config.mjs` (`site`) and `public/robots.txt`
- [ ] Resend secrets pushed, then send yourself a test enquiry
- [ ] Add `public/og.png` (1200×630) — the social preview image is referenced but
      not yet supplied, so links currently share without an image
- [ ] Add `public/apple-touch-icon.png` (180×180)
- [ ] Have the privacy page reviewed. `src/pages/privacy.astro` is a draft that
      accurately describes what the site does today, but it is not legal advice
      and it will be wrong the moment you add analytics or a tracking pixel.
- [ ] Replace the placeholder body copy where the business details differ from
      the assumptions — the whole site is written on the premise that Peak
      places and services machines at no cost to the location.

---

## Adding a page

Drop a `.astro` file in `src/pages/`. It becomes a route, gets picked up by the
sitemap automatically, and inherits the layout:

```astro
---
import Base from '../layouts/Base.astro';
---
<Base title="Pricing" description="One sentence for search results.">
  <section class="section">
    <div class="wrap">
      <h1>Pricing</h1>
    </div>
  </section>
</Base>
```

Add it to the `nav` array in `src/data/site.ts` if it belongs in the header.
