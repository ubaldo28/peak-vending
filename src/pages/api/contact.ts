import type { APIContext } from 'astro';

// Runs on the server (a Cloudflare Pages Function). Everything else on the
// site is static HTML, so this is the only route with a cold start.
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

  const rows: [string, string][] = [
    ['Name', d.name ?? ''],
    ['Email', d.email ?? ''],
    ['Business / site', d.business ?? ''],
    ['Type of site', d.locationType || '—'],
  ];
  const message = (d.message || '').trim();

  // ---------------------------------------------------------------------
  // Email markup is deliberately old-fashioned: nested tables, inline
  // styles, no flexbox, no grid, no <style> block that Outlook will bin.
  // Colours and type mirror the Summit look on the site.
  // ---------------------------------------------------------------------
  const PAPER = '#F1F3EF';
  const CARD = '#FFFFFF';
  const INK = '#2E322D';
  const MUTED = '#6B7169';
  const LINE = '#E2E5DE';
  const BLUE = '#1C72AF';
  const TINT = '#EDF4FA';
  const SANS =
    "'Helvetica Neue',Helvetica,Arial,'Segoe UI',Roboto,sans-serif";

  const cell = (label: string, value: string, last: boolean) => `
              <tr>
                <td style="padding:14px 0 ${last ? '2' : '14'}px;border-bottom:${
                  last ? 'none' : `1px solid ${LINE}`
                };font-family:${SANS};font-size:12px;line-height:16px;letter-spacing:.09em;text-transform:uppercase;color:${MUTED};width:150px;vertical-align:top">${escapeHtml(
                  label,
                )}</td>
                <td style="padding:14px 0 ${last ? '2' : '14'}px;border-bottom:${
                  last ? 'none' : `1px solid ${LINE}`
                };font-family:${SANS};font-size:16px;line-height:24px;color:${INK};font-weight:600;vertical-align:top">${escapeHtml(
                  value,
                )}</td>
              </tr>`;

  const messageBlock = message
    ? `
            <tr>
              <td style="padding:0 32px 8px">
                <div style="font-family:${SANS};font-size:12px;line-height:16px;letter-spacing:.09em;text-transform:uppercase;color:${MUTED};padding-bottom:8px">Message</div>
                <div style="font-family:${SANS};font-size:16px;line-height:26px;color:${INK};background:${TINT};border-left:3px solid ${BLUE};padding:16px 18px;border-radius:0 4px 4px 0">${escapeHtml(
                  message,
                ).replace(/\n/g, '<br>')}</div>
              </td>
            </tr>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>New enquiry from peak-vending.com</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(
    d.name ?? '',
  )} at ${escapeHtml(d.business ?? '')} — ${escapeHtml(
    d.locationType || 'enquiry',
  )}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER}">
    <tr>
      <td align="center" style="padding:32px 16px">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%">

          <tr>
            <td align="center" style="padding:0 0 24px">
              <img src="https://peak-vending.com/email-logo.png" width="220" height="115" alt="Peak Vending" style="display:block;border:0;width:220px;height:auto">
            </td>
          </tr>

          <tr>
            <td style="background:${CARD};border:1px solid ${LINE};border-radius:8px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                <tr>
                  <td style="padding:0;font-size:0;line-height:0">
                    <img src="https://peak-vending.com/email-band.png" width="598" height="110" alt="" style="display:block;border:0;width:100%;max-width:598px;height:auto;border-radius:7px 7px 0 0">
                  </td>
                </tr>

                <tr>
                  <td style="padding:26px 32px 0">
                    <div style="font-family:${SANS};font-size:12px;line-height:16px;letter-spacing:.11em;text-transform:uppercase;color:${BLUE};font-weight:700">New enquiry</div>
                    <div style="font-family:${SANS};font-size:24px;line-height:32px;color:${INK};font-weight:700;padding-top:6px">${escapeHtml(
                      d.business ?? 'A new site',
                    )}</div>
                  </td>
                </tr>

                <tr>
                  <td style="padding:20px 32px 0">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows
                      .map(([k, v], i) => cell(k, v, i === rows.length - 1))
                      .join('')}
                    </table>
                  </td>
                </tr>

                <tr><td style="height:20px;line-height:20px;font-size:0">&nbsp;</td></tr>
${messageBlock}
                <tr>
                  <td style="padding:20px 32px 28px">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background:${BLUE};border-radius:4px">
                          <a href="mailto:${encodeURIComponent(
                            d.email ?? '',
                          ).replace(/%40/g, '@')}?subject=${encodeURIComponent(
                            'Re: your vending enquiry',
                          )}" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none">Reply to ${escapeHtml(
                            (d.name ?? '').split(' ')[0] || 'them',
                          )}</a>
                        </td>
                      </tr>
                    </table>
                    <div style="font-family:${SANS};font-size:14px;line-height:20px;color:${MUTED};padding-top:14px">Or just hit reply — this email replies straight to them.</div>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:20px 8px 0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">
              Sent by the contact form at <a href="https://peak-vending.com" style="color:${BLUE};text-decoration:none">peak-vending.com</a><br>
              Dundee, Angus, Fife and Perthshire
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    'NEW ENQUIRY — peak-vending.com',
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(message ? ['', 'Message:', message] : []),
    '',
    'Reply to this email to answer them directly.',
  ].join('\n');

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
      text,
    }),
  });

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
async function sendAck(env: Env, d: Fields) {
  const from = env.CONTACT_ACK_FROM || env.CONTACT_FROM;
  if (!env.RESEND_API_KEY || !from || !d.email) return;

  const PAPER = '#F1F3EF';
  const CARD = '#FFFFFF';
  const INK = '#2E322D';
  const MUTED = '#6B7169';
  const LINE = '#E2E5DE';
  const BLUE = '#1C72AF';
  const SANS =
    "'Helvetica Neue',Helvetica,Arial,'Segoe UI',Roboto,sans-serif";

  const firstName = (d.name ?? '').trim().split(/\s+/)[0] || 'there';
  const steps = [
    ['We read it properly', 'Not an auto-sorted queue. A person looks at where you are and what you have asked for.'],
    ['We come and have a look', 'Free, no obligation. We check the space, the power, and where folk actually walk.'],
    ['You get it in writing', 'Machine, range and prices, agreed before anything is ordered.'],
  ];

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thanks for getting in touch</title></head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">We have got your enquiry and will come back to you shortly.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER}">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%">

        <tr><td align="center" style="padding:0 0 24px">
          <img src="https://peak-vending.com/email-logo.png" width="220" height="115" alt="Peak Vending" style="display:block;border:0;width:220px;height:auto">
        </td></tr>

        <tr><td style="background:${CARD};border:1px solid ${LINE};border-radius:8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

            <tr><td style="padding:32px 32px 0">
              <div style="font-family:${SANS};font-size:24px;line-height:32px;color:${INK};font-weight:700">Thanks, ${escapeHtml(firstName)} — we have got it.</div>
              <div style="font-family:${SANS};font-size:16px;line-height:26px;color:${MUTED};padding-top:12px">
                Your enquiry about ${escapeHtml(d.business || 'your site')} has come through. We will come back to you shortly, usually the same working day.
              </div>
            </td></tr>

            <tr><td style="padding:24px 32px 0">
              <div style="font-family:${SANS};font-size:12px;line-height:16px;letter-spacing:.11em;text-transform:uppercase;color:${BLUE};font-weight:700;padding-bottom:12px">What happens next</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${steps
                  .map(
                    ([t, b], i) => `
                <tr>
                  <td width="34" style="padding:0 0 ${i === steps.length - 1 ? '0' : '16'}px;font-family:${SANS};font-size:13px;line-height:22px;font-weight:700;color:${BLUE};vertical-align:top">${String(i + 1).padStart(2, '0')}</td>
                  <td style="padding:0 0 ${i === steps.length - 1 ? '0' : '16'}px;vertical-align:top">
                    <div style="font-family:${SANS};font-size:16px;line-height:22px;color:${INK};font-weight:600">${t}</div>
                    <div style="font-family:${SANS};font-size:15px;line-height:23px;color:${MUTED};padding-top:3px">${b}</div>
                  </td>
                </tr>`,
                  )
                  .join('')}
              </table>
            </td></tr>

            <tr><td style="padding:26px 32px 30px">
              <div style="font-family:${SANS};font-size:15px;line-height:23px;color:${MUTED};border-top:1px solid ${LINE};padding-top:18px">
                Remembered something you meant to say? Just reply to this email — it comes straight to us.
              </div>
            </td></tr>

          </table>
        </td></tr>

        <tr><td align="center" style="padding:20px 8px 0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">
          <a href="https://peak-vending.com" style="color:${BLUE};text-decoration:none">peak-vending.com</a><br>
          Full-service vending across Dundee, Angus, Fife and Perthshire
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Thanks, ${firstName} - we have got it.`,
    '',
    `Your enquiry about ${d.business || 'your site'} has come through. We will come back to you shortly, usually the same working day.`,
    '',
    'WHAT HAPPENS NEXT',
    ...steps.map(([t, b], i) => `${String(i + 1).padStart(2, '0')}  ${t} - ${b}`),
    '',
    'Remembered something you meant to say? Just reply to this email.',
    '',
    'peak-vending.com',
  ].join('\n');

  const endpoint = env.RESEND_ENDPOINT || 'https://api.resend.com/emails';
  await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [d.email],
      ...(env.CONTACT_TO ? { reply_to: env.CONTACT_TO } : {}),
      subject: 'Thanks — we have got your vending enquiry',
      html,
      text,
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

  // The enquiry is safely in the inbox by this point. The acknowledgement to
  // the sender is a nicety — never let it fail the request.
  try {
    await sendAck(env, data);
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
