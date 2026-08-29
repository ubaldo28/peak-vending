import type { APIContext } from 'astro';

// Runs on the server (a Cloudflare Pages Function). Everything else on the
// site is static HTML, so this is the only route with a cold start.
export const prerender = false;

interface Env {
  RESEND_API_KEY?: string;
  CONTACT_TO?: string;
  CONTACT_FROM?: string;
  /** Override only for testing or a self-hosted Resend-compatible endpoint. */
  RESEND_ENDPOINT?: string;
  /** Optional KV binding. Rate limiting turns itself on when it exists. */
  RATE_LIMIT?: { get(k: string): Promise<string | null>; put(k: string, v: string, o?: any): Promise<void> };
}

/**
 * Secrets come from the Cloudflare Workers runtime in production and from
 * .env locally. `cloudflare:workers` only resolves inside the Workers build,
 * so the import is lazy and failure is not fatal.
 */
async function readEnv(): Promise<Env> {
  let runtime: Record<string, any> = {};
  try {
    runtime = ((await import('cloudflare:workers')) as any).env ?? {};
  } catch {
    // Not running on Cloudflare — fall through to .env values.
  }
  return {
    RESEND_API_KEY: runtime.RESEND_API_KEY ?? import.meta.env.RESEND_API_KEY,
    CONTACT_TO: runtime.CONTACT_TO ?? import.meta.env.CONTACT_TO,
    CONTACT_FROM: runtime.CONTACT_FROM ?? import.meta.env.CONTACT_FROM,
    RESEND_ENDPOINT: runtime.RESEND_ENDPOINT ?? import.meta.env.RESEND_ENDPOINT,
    RATE_LIMIT: runtime.RATE_LIMIT,
  };
}

const MAX = { name: 120, email: 200, business: 200, locationType: 80, message: 4000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Fields = Record<string, string>;

function clean(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function validate(raw: Fields) {
  const data = {
    name: clean(raw.name, MAX.name),
    email: clean(raw.email, MAX.email),
    business: clean(raw.business, MAX.business),
    locationType: clean(raw.locationType, MAX.locationType),
    message: clean(raw.message, MAX.message),
  };

  const errors: Record<string, string> = {};
  if (!data.name) errors.name = 'Tell us who you are.';
  if (!data.email) errors.email = 'We need an email to reply to.';
  else if (!EMAIL_RE.test(data.email)) errors.email = 'That email address does not look right.';
  if (!data.business) errors.business = 'Which business or site is this for?';

  return { data, errors };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

async function rateLimited(env: Env, ip: string): Promise<boolean> {
  // Optional. Bind a KV namespace called RATE_LIMIT to switch this on.
  if (!env.RATE_LIMIT || !ip) return false;
  const key = `contact:${ip}`;
  const hits = Number((await env.RATE_LIMIT.get(key)) ?? '0');
  if (hits >= 5) return true;
  await env.RATE_LIMIT.put(key, String(hits + 1), { expirationTtl: 3600 });
  return false;
}

async function sendEmail(env: Env, d: Fields) {
  const to = env.CONTACT_TO;
  const from = env.CONTACT_FROM;
  if (!env.RESEND_API_KEY || !to || !from) {
    return { ok: false, reason: 'unconfigured' as const };
  }

  const rows = [
    ['Name', d.name],
    ['Email', d.email],
    ['Business / site', d.business],
    ['Type of site', d.locationType || '—'],
    ['Message', d.message || '—'],
  ];

  const html = `
    <h2 style="font-family:system-ui,sans-serif;color:#2E322D">New enquiry from peak-vending.com</h2>
    <table style="font-family:system-ui,sans-serif;border-collapse:collapse">
      ${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 16px 6px 0;color:#6B7169;vertical-align:top">${k}</td>` +
            `<td style="padding:6px 0"><strong>${escapeHtml(v)}</strong></td></tr>`,
        )
        .join('')}
    </table>`;

  const endpoint = env.RESEND_ENDPOINT || 'https://api.resend.com/emails';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: d.email,
      subject: `Vending enquiry — ${d.business}`,
      html,
      text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
    }),
  });

  if (!res.ok) {
    return { ok: false as const, reason: 'provider', detail: await res.text() };
  }
  return { ok: true as const };
}

export async function POST(ctx: APIContext): Promise<Response> {
  const env = await readEnv();
  const contentType = ctx.request.headers.get('content-type') ?? '';
  const wantsJson = contentType.includes('application/json');

  const reply = (status: number, body: Record<string, unknown>, redirect?: string) => {
    if (wantsJson) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    // No-JS fallback: plain form post, so send them to a real page.
    return new Response(null, { status: 303, headers: { Location: redirect ?? '/contact/?error=1' } });
  };

  let raw: Fields = {};
  try {
    if (wantsJson) {
      raw = (await ctx.request.json()) as Fields;
    } else {
      const form = await ctx.request.formData();
      raw = Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)]));
    }
  } catch {
    return reply(400, { ok: false, message: 'We could not read that. Try again.' });
  }

  // Honeypot: a field hidden from people but filled in by most bots.
  if (clean(raw.company_website, 200)) {
    return reply(200, { ok: true }, '/thanks/');
  }

  // Anything submitted under three seconds after page load is not a human.
  const started = Number(raw.t);
  if (Number.isFinite(started) && Date.now() - started < 3000) {
    return reply(200, { ok: true }, '/thanks/');
  }

  const { data, errors } = validate(raw);
  if (Object.keys(errors).length) {
    return reply(422, { ok: false, errors, message: 'Please check the highlighted fields.' });
  }

  const ip = ctx.request.headers.get('cf-connecting-ip') ?? ctx.clientAddress ?? '';
  if (await rateLimited(env, ip)) {
    return reply(429, {
      ok: false,
      message: 'That is a few too many tries. Email us directly and we will pick it up.',
    });
  }

  const sent = await sendEmail(env, data);

  if (!sent.ok && sent.reason === 'unconfigured') {
    console.warn('[contact] Email is not configured — set RESEND_API_KEY, CONTACT_TO and CONTACT_FROM.');
    return reply(503, {
      ok: false,
      message: 'The form is not hooked up yet. Please email or ring us in the meantime.',
    });
  }

  if (!sent.ok) {
    console.error('[contact] Provider rejected the send:', (sent as any).detail);
    return reply(502, {
      ok: false,
      message: 'We could not send that just now. Try again, or give us a ring.',
    });
  }

  return reply(200, { ok: true, message: 'Cheers — we will be in touch shortly.' }, '/thanks/');
}

/** Anything other than POST gets a clear answer rather than a stack trace. */
export const GET = () =>
  new Response(JSON.stringify({ ok: false, message: 'Send this form with POST.' }), {
    status: 405,
    headers: { 'content-type': 'application/json', allow: 'POST' },
  });
