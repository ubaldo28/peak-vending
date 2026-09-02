import type { APIContext } from 'astro';
import { enquiryNotification, enquiryAcknowledgement } from '../../lib/emails';

// The only server-rendered route. Everything else on the site is static HTML
// served straight from the CDN, so this is the one path that reaches the
// Worker at all.
export const prerender = false;

interface Env {
  RESEND_API_KEY?: string;
  CONTACT_TO?: string;
  CONTACT_FROM?: string;
  /** Friendly address the acknowledgement to the enquirer comes from. Falls back to CONTACT_FROM. */
  CONTACT_ACK_FROM?: string;
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
    CONTACT_ACK_FROM: runtime.CONTACT_ACK_FROM ?? import.meta.env.CONTACT_ACK_FROM,
    RESEND_ENDPOINT: runtime.RESEND_ENDPOINT ?? import.meta.env.RESEND_ENDPOINT,
    RATE_LIMIT: runtime.RATE_LIMIT,
  };
}

const MAX = { name: 120, email: 200, business: 200, locationType: 80, message: 4000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Fields = Record<string, string>;

/**
 * Control characters are stripped before anything else happens to a field.
 * The subject line and the From/Reply-To addresses are built from this data,
 * and a stray CR or LF in any of them is the classic header-injection route
 * into someone else's mailbox. `keepNewlines` is only for the message body,
 * which is rendered into HTML (escaped) rather than into a header.
 */
function clean(value: unknown, limit: number, keepNewlines = false): string {
  if (typeof value !== 'string') return '';
  const stripped = keepNewlines
    ? value.replace(/\r\n?/g, '\n').replace(/[^\S\n]*[\u0000-\u0009\u000B-\u001F\u007F]+/g, ' ')
    : value.replace(/[\u0000-\u001F\u007F]+/g, ' ');
  return stripped.trim().slice(0, limit);
}

function validate(raw: Fields) {
  const data = {
    name: clean(raw.name, MAX.name),
    email: clean(raw.email, MAX.email),
    business: clean(raw.business, MAX.business),
    locationType: clean(raw.locationType, MAX.locationType),
    message: clean(raw.message, MAX.message, true),
  };

  const errors: Record<string, string> = {};
  if (!data.name) errors.name = 'Tell us who you are.';
  if (!data.email) errors.email = 'We need an email to reply to.';
  else if (!EMAIL_RE.test(data.email)) errors.email = 'That email address does not look right.';
  if (!data.business) errors.business = 'Which business or site is this for?';

  return { data, errors };
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

/**
 * Delivers the enquiry to the business. The only failure the caller can do
 * anything about is "unconfigured", which means a secret is missing.
 */
async function sendEnquiry(env: Env, d: Fields) {
  const to = env.CONTACT_TO;
  const from = env.CONTACT_FROM;
  if (!env.RESEND_API_KEY || !to || !from) {
    return { ok: false, reason: 'unconfigured' as const };
  }

  const { subject, html, text } = enquiryNotification(d);
  const res = await send(env, { from, to, replyTo: d.email, subject, html, text });

  if (!res.ok) {
    return { ok: false as const, reason: 'provider', detail: await res.text() };
  }
  return { ok: true as const };
}

/**
 * Acknowledgement to the person who filled the form. Best-effort: if this
 * fails the enquiry has still reached the inbox, which is the part that
 * matters, so the caller ignores the result.
 */
async function sendAcknowledgement(env: Env, d: Fields) {
  const from = env.CONTACT_ACK_FROM || env.CONTACT_FROM;
  if (!env.RESEND_API_KEY || !from || !d.email) return;

  const { subject, html, text } = enquiryAcknowledgement(d);
  await send(env, { from, to: d.email, replyTo: env.CONTACT_TO, subject, html, text });
}

/** One place that knows how to talk to Resend. */
function send(
  env: Env,
  msg: { from: string; to: string; replyTo?: string; subject: string; html: string; text: string },
) {
  const endpoint = env.RESEND_ENDPOINT || 'https://api.resend.com/emails';
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: msg.from,
      to: [msg.to],
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
}

/**
 * A JSON POST from another origin is stopped by CORS preflight, but a plain
 * form POST is a "simple request" and sails straight through — that is CSRF,
 * and here it would mean a stranger's site firing enquiries into the client's
 * inbox. Same-origin requests carry Origin (or at least Referer) matching the
 * host, so anything that disagrees is refused. A request with neither header
 * is allowed: that is curl or an old client, not a browser being used as a
 * weapon against someone.
 */
function sameOrigin(request: Request): boolean {
  const host = request.headers.get('host');
  if (!host) return true;

  const stated = request.headers.get('origin') ?? request.headers.get('referer');
  if (!stated) return true;

  try {
    return new URL(stated).host === host;
  } catch {
    return false;
  }
}

export async function POST(ctx: APIContext): Promise<Response> {
  if (!sameOrigin(ctx.request)) {
    return new Response(JSON.stringify({ ok: false, message: 'Bad request.' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

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

  const sent = await sendEnquiry(env, data);

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

  // The enquiry is safely in the inbox by this point. The acknowledgement to
  // the sender is a nicety — never let it fail the request.
  try {
    await sendAcknowledgement(env, data);
  } catch (err) {
    console.warn('[contact] Acknowledgement to the enquirer failed:', err);
  }

  return reply(200, { ok: true, message: 'Cheers — we will be in touch shortly.' }, '/thanks/');
}

/** Anything other than POST gets a clear answer rather than a stack trace. */
export const GET = () =>
  new Response(JSON.stringify({ ok: false, message: 'Send this form with POST.' }), {
    status: 405,
    headers: { 'content-type': 'application/json', allow: 'POST' },
  });
