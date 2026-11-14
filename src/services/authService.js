const crypto = require('crypto');
const db = require('../db/database');
const resendService = require('./resendService');

class AuthService {
  async requestCode(email) {
    if (!email || !email.includes('@')) {
      throw new Error('Valid email address is required');
    }

    const cleanEmail = email.trim().toLowerCase();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Delete any existing codes for this email
    db.prepare('DELETE FROM auth_codes WHERE email = ?').run(cleanEmail);

    // Save code
    db.prepare(`
      INSERT INTO auth_codes (email, code, expires_at)
      VALUES (?, ?, ?)
    `).run(cleanEmail, code, expiresAt);

    // Send via Resend
    const html = resendService.generateEmailHtml(code);
    const text = `Your MUSII verification code is: ${code}. Valid for 10 minutes.`;

    const sendRes = await resendService.sendEmail({
      to: cleanEmail,
      subject: `MUSII Verification Code: ${code}`,
      html,
      text
    });

    console.log(`[Auth] Verification code for ${cleanEmail}: ${code} (Sent: ${sendRes.success})`);

    return {
      success: true,
      email: cleanEmail,
      message: 'Verification code sent to email',
      sent: sendRes.success
    };
  }

  async verifyCode(email, code) {
    if (!email || !code) {
      throw new Error('Email and 6-digit code are required');
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();

    const record = db.prepare(`
      SELECT * FROM auth_codes
      WHERE email = ? AND code = ? AND expires_at > ?
    `).get(cleanEmail, cleanCode, Date.now());

    if (!record) {
      return {
        success: false,
        error: 'Invalid or expired verification code. Please request a new one.'
      };
    }

    // Clean up code after successful use
    db.prepare('DELETE FROM auth_codes WHERE email = ?').run(cleanEmail);

    // Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare(`
      INSERT INTO auth_sessions (token, email)
      VALUES (?, ?)
    `).run(token, cleanEmail);

    // Get or update user profile
    const username = cleanEmail.split('@')[0];
    const initial = (username[0] || 'M').toUpperCase();

    db.prepare(`
      UPDATE user_profile
      SET name = ?, handle = ?, avatar_initial = ?
      WHERE id = 'usr-1'
    `).run(username, `@${username}`, initial);

    const user = db.prepare('SELECT * FROM user_profile WHERE id = ?').get('usr-1');

    return {
      success: true,
      token,
      user: {
        email: cleanEmail,
        name: user.name,
        handle: user.handle,
        avatar_initial: user.avatar_initial
      }
    };
  }

  async validateSession(token) {
    if (!token) return { valid: false };

    const session = db.prepare('SELECT * FROM auth_sessions WHERE token = ?').get(token);
    if (!session) return { valid: false };

    db.prepare('UPDATE auth_sessions SET last_active = CURRENT_TIMESTAMP WHERE token = ?').run(token);
    const user = db.prepare('SELECT * FROM user_profile WHERE id = ?').get('usr-1');

    return {
      valid: true,
      email: session.email,
      user
    };
  }

  async logout(token) {
    if (token) {
      db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
    }
    return { success: true, message: 'Logged out successfully' };
  }
}

module.exports = new AuthService();
