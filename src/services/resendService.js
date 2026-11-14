const https = require('https');
const env = require('../config/env');

class ResendService {
  constructor() {
    this.apiKey = env.RESEND_API_KEY;
    this.defaultFrom = env.EMAIL_FROM || 'MUSII <noreply@mftechnologies.org>';
  }

  async sendEmail({ to, subject, html, text, from }) {
    const payload = JSON.stringify({
      from: from || this.defaultFrom,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text
    });

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        family: 4,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let responseBody = '';
        res.on('data', chunk => { responseBody += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseBody);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true, data: parsed });
            } else {
              console.warn('[Resend] API returned non-200:', res.statusCode, parsed);
              resolve({ success: false, statusCode: res.statusCode, error: parsed });
            }
          } catch (e) {
            resolve({ success: false, error: responseBody });
          }
        });
      });

      req.on('error', (err) => {
        console.error('[Resend] Network error:', err.message);
        resolve({ success: false, error: err.message });
      });

      req.setTimeout(8000, () => {
        req.destroy();
        resolve({ success: false, error: 'Request timeout' });
      });

      req.write(payload);
      req.end();
    });
  }

  generateEmailHtml(code) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Your MUSII Verification Code</title>
</head>
<body style="margin:0; padding:0; background-color:#050508; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#ffffff;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#050508; padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:440px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); border-radius:24px; padding:36px 28px; text-align:center;">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:48px; height:48px; border-radius:14px; background:linear-gradient(135deg, #f0443a, #ff6b4a); display:inline-block; line-height:48px; font-size:24px; font-weight:800; color:#ffffff;">
                M
              </div>
              <h1 style="margin:16px 0 6px; font-size:24px; font-weight:700; letter-spacing:-0.5px; color:#ffffff;">MUSII</h1>
              <p style="margin:0; font-size:14px; color:rgba(255,255,255,0.55);">Minimalist Liquid Glass Music</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 0;">
              <p style="margin:0 0 20px; font-size:15px; color:rgba(255,255,255,0.85); line-height:1.5;">
                Enter this 6-digit verification code to sign in and start listening.
              </p>
              <div style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.18); border-radius:16px; padding:18px 24px; display:inline-block; letter-spacing:10px; font-size:32px; font-weight:800; color:#f0443a;">
                ${code}
              </div>
              <p style="margin:20px 0 0; font-size:12px; color:rgba(255,255,255,0.45);">
                This code will expire in 10 minutes. If you did not request this code, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px; border-top:1px solid rgba(255,255,255,0.08); font-size:11px; color:rgba(255,255,255,0.35);">
              MUSII Music App -- Audiophile Lossless Edge Audio
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }
}

module.exports = new ResendService();

