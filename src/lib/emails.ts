/**
 * The two transactional emails the contact form sends.
 *
 * Kept out of the route so `api/contact.ts` stays about handling a request.
 * Each builder is pure — fields in, `{ subject, html, text }` out — which
 * means they can be rendered and eyeballed without standing up a server.
 *
 * The markup is deliberately old-fashioned: nested tables, inline styles, no
 * flexbox, no grid, no <style> block. That is not carelessness; it is what
 * Outlook and Gmail actually render reliably. Colours and type mirror the
 * Summit look on the site.
 */

export interface EnquiryFields {
  name?: string;
  email?: string;
  business?: string;
  locationType?: string;
  message?: string;
}

export interface Email {
  subject: string;
  html: string;
  text: string;
}

/** Shared palette. Defined once so the two emails cannot drift apart. */
const PAPER = '#F1F3EF';
const CARD = '#FFFFFF';
const INK = '#2E322D';
const MUTED = '#6B7169';
const LINE = '#E2E5DE';
const TINT = '#EDF4FA';
const BLUE = '#1C72AF';
const SANS = "'Helvetica Neue',Helvetica,Arial,'Segoe UI',Roboto,sans-serif";

/** Emails are HTML built by string concatenation, so every value is escaped. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** Sent to the business: the enquiry itself. */
export function enquiryNotification(d: EnquiryFields): Email {
  const rows: [string, string][] = [
    ['Name', d.name ?? ''],
    ['Email', d.email ?? ''],
    ['Business / site', d.business ?? ''],
    ['Type of site', d.locationType || '—'],
  ];
  const message = (d.message || '').trim();


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

  return {
    subject: `Vending enquiry — ${d.business}`,
    html,
    text,
  };
}

/** Sent to the enquirer: confirmation that it arrived, and what happens next. */
export function enquiryAcknowledgement(d: EnquiryFields): Email {
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

  return {
    subject: 'Thanks — we have got your vending enquiry',
    html,
    text,
  };
}
