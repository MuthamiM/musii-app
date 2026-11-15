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

    // Check if account already exists for recovery
    let isExistingUser = false;
    try {
      const existing = db.prepare('SELECT * FROM user_accounts WHERE email = ?').get(cleanEmail);
      isExistingUser = Boolean(existing);
    } catch (e) {
      isExistingUser = false;
    }

    // Send via Resend
    const html = resendService.generateEmailHtml(code, isExistingUser);
    const text = isExistingUser
      ? `Your MUSII verification code to recover your account is: ${code}. Valid for 10 minutes.`
      : `Your MUSII verification code is: ${code}. Valid for 10 minutes.`;

    const subject = isExistingUser
      ? `Recover Your MUSII Account: ${code}`
      : `MUSII Verification Code: ${code}`;

    const sendRes = await resendService.sendEmail({
      to: cleanEmail,
      subject,
      html,
      text
    });

    console.log(`[Auth] Code for ${cleanEmail}: ${code} (Recover: ${isExistingUser}, Sent: ${sendRes.success})`);

    return {
      success: true,
      email: cleanEmail,
      isExistingUser,
      message: isExistingUser
        ? 'Verification code sent to recover your account'
        : 'Verification code sent to email',
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

    // Check if user account exists (Account Recovery)
    let account = null;
    let isRecovered = false;

    try {
      account = db.prepare('SELECT * FROM user_accounts WHERE email = ?').get(cleanEmail);
    } catch (e) {}

    if (account) {
      // Existing user: RECOVER ACCOUNT AND RESTORE PROGRESS
      isRecovered = true;
      try {
        db.prepare(`
          UPDATE user_accounts
          SET last_login = CURRENT_TIMESTAMP
          WHERE email = ?
        `).run(cleanEmail);

        db.prepare(`
          UPDATE user_profile
          SET name = ?, handle = ?, avatar_initial = ?
          WHERE id = 'usr-1'
        `).run(account.name, account.handle, account.avatar_initial);
      } catch (e) {}
    } else {
      // New user registration
      const baseName = cleanEmail.split('@')[0];
      const initial = (baseName[0] || 'M').toUpperCase();
      const defaultHandle = `@${baseName}`;

      try {
        db.prepare(`
          INSERT INTO user_accounts (email, name, handle, avatar_initial)
          VALUES (?, ?, ?, ?)
        `).run(cleanEmail, baseName, defaultHandle, initial);

        db.prepare(`
          UPDATE user_profile
          SET name = ?, handle = ?, avatar_initial = ?
          WHERE id = 'usr-1'
        `).run(baseName, defaultHandle, initial);
      } catch (e) {}

      account = {
        email: cleanEmail,
        name: baseName,
        handle: defaultHandle,
        avatar_initial: initial
      };
    }

    return {
      success: true,
      token,
      isRecovered,
      requiresUsername: !isRecovered,
      user: {
        email: cleanEmail,
        name: account.name,
        handle: account.handle,
        avatar_initial: account.avatar_initial
      }
    };
  }

  async setUsername(token, rawUsername) {
    if (!rawUsername) {
      throw new Error('Username is required');
    }

    const clean = rawUsername.trim().replace(/^@/, '');
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(clean)) {
      throw new Error('Username must be 3-24 characters (letters, numbers, underscores)');
    }

    const session = await this.validateSession(token);
    if (!session.valid) {
      throw new Error('Unauthorized or session expired');
    }

    const initial = clean[0].toUpperCase();
    const handle = `@${clean}`;

    // Update active profile
    db.prepare(`
      UPDATE user_profile
      SET name = ?, handle = ?, avatar_initial = ?
      WHERE id = 'usr-1'
    `).run(clean, handle, initial);

    // Update persisted account for this email
    try {
      db.prepare(`
        UPDATE user_accounts
        SET name = ?, handle = ?, avatar_initial = ?
        WHERE email = ?
      `).run(clean, handle, initial, session.email);
    } catch (e) {}

    return {
      success: true,
      user: {
        email: session.email,
        name: clean,
        handle: handle,
        avatar_initial: initial
      }
    };
  }

  async validateSession(token) {
    if (!token) return { valid: false };

    const session = db.prepare('SELECT * FROM auth_sessions WHERE token = ?').get(token);
    if (!session) return { valid: false };

    db.prepare('UPDATE auth_sessions SET last_active = CURRENT_TIMESTAMP WHERE token = ?').run(token);

    let account = null;
    try {
      account = db.prepare('SELECT * FROM user_accounts WHERE email = ?').get(session.email);
    } catch (e) {}

    if (!account) {
      const user = db.prepare('SELECT * FROM user_profile WHERE id = ?').get('usr-1');
      account = {
        name: user ? user.name : 'MUSII Member',
        handle: user ? user.handle : '@user',
        avatar_initial: user ? user.avatar_initial : 'M'
      };
    }

    return {
      valid: true,
      email: session.email,
      user: {
        email: session.email,
        name: account.name,
        handle: account.handle,
        avatar_initial: account.avatar_initial
      }
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

