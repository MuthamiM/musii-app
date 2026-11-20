import { haptics } from '../middleware/hapticMiddleware.js';
import { errorHandler } from '../errors/clientErrorHandler.js';
import { audioController } from './AudioController.js';
import { apiUrl } from '../constants/api.js';

class AuthController {
  constructor() {
    this.overlay = null;
    this.stepEmail = null;
    this.stepCode = null;
    this.inputEmail = null;
    this.inputCode = null;
    this.currentEmail = '';
    this.token = localStorage.getItem('musii_token') || null;
  }

  async init() {
    this.overlay = document.getElementById('authOverlay');
    this.stepEmail = document.getElementById('authStepEmail');
    this.stepCode = document.getElementById('authStepCode');
    this.stepUsername = document.getElementById('authStepUsername');
    this.inputEmail = document.getElementById('authInputEmail');
    this.inputCode = document.getElementById('authInputCode');
    this.inputUsername = document.getElementById('authInputUsername');
    this.greetingName = document.getElementById('authGreetingName');

    // Restore greeting name from cached user
    const cachedUser = localStorage.getItem('musii_user');
    if (cachedUser) {
      try {
        const u = JSON.parse(cachedUser);
        if (this.greetingName && u.name) {
          this.greetingName.textContent = u.name;
        }
      } catch (e) {}
    }

    this.bindEvents();

    // Check existing session
    if (this.token) {
      document.documentElement.classList.add('user-authenticated');
      this.hideAuth();
      if (cachedUser) {
        try {
          const user = JSON.parse(cachedUser);
          this.updateProfileUI(user);
          window.dispatchEvent(new CustomEvent('musii:user-updated', { detail: { user } }));
        } catch (e) {}
      }
      this.validateSession();
    } else {
      document.documentElement.classList.remove('user-authenticated');
      this.showAuth();
    }
  }

  bindEvents() {
    const btnSend = document.getElementById('btnAuthSendCode');
    const btnVerify = document.getElementById('btnAuthVerify');
    const btnResend = document.getElementById('btnAuthResend');
    const btnChangeEmail = document.getElementById('btnAuthChangeEmail');
    const btnSetUsername = document.getElementById('btnAuthSetUsername');
    const btnSignOut = document.getElementById('btnProfileSignOut');
    const btnForgot = document.getElementById('btnAuthForgot');
    const inputPassword = document.getElementById('authInputPassword');

    if (btnForgot) {
      btnForgot.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleForgotPassword();
      });
    }

    if (inputPassword) {
      inputPassword.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.handleSendCode();
      });
    }

    if (btnSetUsername) {
      btnSetUsername.addEventListener('click', () => this.handleSetUsername());
    }

    if (this.inputUsername) {
      this.inputUsername.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.handleSetUsername();
      });
    }

    if (btnSend) {
      btnSend.addEventListener('click', () => this.handleSendCode());
    }

    if (this.inputEmail) {
      this.inputEmail.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.handleSendCode();
      });
    }

    if (btnVerify) {
      btnVerify.addEventListener('click', () => this.handleVerifyCode());
    }

    if (this.inputCode) {
      this.inputCode.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.handleVerifyCode();
      });
      // Auto-submit when 6 digits are typed
      this.inputCode.addEventListener('input', e => {
        if (this.inputCode.value.trim().length === 6) {
          this.handleVerifyCode();
        }
      });
    }

    if (btnResend) {
      btnResend.addEventListener('click', () => this.handleResendCode());
    }

    if (btnChangeEmail) {
      btnChangeEmail.addEventListener('click', () => this.showEmailStep());
    }

    if (btnSignOut) {
      btnSignOut.addEventListener('click', () => this.signOut());
    }

    const tabPassword = document.getElementById('tabAuthPassword');
    const tabCode = document.getElementById('tabAuthCode');
    const passwordGroup = document.getElementById('authPasswordGroup');
    const forgotLink = document.getElementById('btnAuthForgot');
    const btnLabel = document.getElementById('btnAuthSendCodeLabel');

    if (tabPassword && tabCode) {
      tabPassword.addEventListener('click', () => {
        haptics.trigger('light');
        tabPassword.classList.add('is-active');
        tabCode.classList.remove('is-active');
        if (passwordGroup) passwordGroup.style.display = 'block';
        if (forgotLink) forgotLink.style.display = 'block';
        if (btnLabel) btnLabel.textContent = 'Sign In';
      });

      tabCode.addEventListener('click', () => {
        haptics.trigger('light');
        tabCode.classList.add('is-active');
        tabPassword.classList.remove('is-active');
        if (passwordGroup) passwordGroup.style.display = 'none';
        if (forgotLink) forgotLink.style.display = 'none';
        if (btnLabel) btnLabel.textContent = 'Send Magic Code';
      });
    }

    const btnGuest = document.getElementById('btnAuthGuest');
    if (btnGuest) {
      btnGuest.addEventListener('click', () => this.continueAsGuest());
    }
  }

  continueAsGuest() {
    haptics.trigger('heavy');
    const guestUser = {
      id: 'guest_' + Date.now(),
      name: 'BitChord Listener',
      email: 'guest@bitchord.audio',
      role: 'guest',
      avatar: 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'
    };
    this.token = 'guest_token_' + Date.now();
    localStorage.setItem('musii_token', this.token);
    localStorage.setItem('musii_user', JSON.stringify(guestUser));
    this.updateProfileUI(guestUser);
    this.hideAuth();
    errorHandler.showToast('Welcome to BitChord!');
    window.dispatchEvent(new CustomEvent('musii:user-updated', { detail: { user: guestUser } }));
    setTimeout(() => {
      if (!audioController.isPlaying) {
        audioController.play();
      }
    }, 400);
  }

  showAuth() {
    document.documentElement.classList.remove('user-authenticated');
    if (this.overlay) {
      this.overlay.classList.remove('auth-hidden');
    }
    this.showEmailStep();
  }

  hideAuth() {
    document.documentElement.classList.add('user-authenticated');
    if (this.overlay) {
      this.overlay.classList.add('auth-hidden');
    }
  }

  showEmailStep() {
    if (this.stepEmail) this.stepEmail.classList.add('active');
    if (this.stepCode) this.stepCode.classList.remove('active');
    if (this.inputEmail) {
      setTimeout(() => this.inputEmail.focus(), 150);
    }
  }

  showCodeStep(email, isExistingUser = false) {
    this.currentEmail = email;
    if (this.stepEmail) this.stepEmail.classList.remove('active');
    if (this.stepCode) this.stepCode.classList.add('active');
    
    const badge = document.getElementById('authTargetEmail');
    if (badge) badge.textContent = email;

    const titleEl = document.getElementById('authCodeStepTitle');
    const subtitleEl = document.getElementById('authCodeStepSubtitle');
    if (titleEl) {
      titleEl.textContent = isExistingUser ? 'Recover Account' : 'Verify Email';
    }
    if (subtitleEl) {
      subtitleEl.textContent = isExistingUser
        ? 'Enter the code sent to restore your saved profile and library.'
        : 'Enter the 6-digit code sent to your email to start listening.';
    }

    if (this.inputCode) {
      this.inputCode.value = '';
      setTimeout(() => this.inputCode.focus(), 150);
    }
  }

  showUsernameStep(user) {
    if (this.stepEmail) this.stepEmail.classList.remove('active');
    if (this.stepCode) this.stepCode.classList.remove('active');
    if (this.stepUsername) this.stepUsername.classList.add('active');

    if (this.inputUsername) {
      this.inputUsername.value = user?.name || '';
      setTimeout(() => this.inputUsername.focus(), 150);
    }
  }

  handleForgotPassword() {
    haptics.trigger('light');
    const email = this.inputEmail ? this.inputEmail.value.trim() : '';
    if (!email || !email.includes('@')) {
      errorHandler.showToast('Enter your email to receive a password recovery code');
      if (this.inputEmail) {
        this.inputEmail.focus();
      }
      return;
    }
    errorHandler.showToast('Sending recovery code to ' + email);
    this.handleSendCode();
  }

  async handleSetUsername() {
    const rawUsername = this.inputUsername ? this.inputUsername.value.trim() : '';
    const clean = rawUsername.replace(/^@/, '');
    if (!clean || clean.length < 3) {
      haptics.trigger('heavy');
      errorHandler.showToast('Please enter at least 3 characters for your username');
      return;
    }

    const btn = document.getElementById('btnAuthSetUsername');
    if (btn) btn.disabled = true;

    haptics.trigger('medium');

    try {
      const res = await fetch(apiUrl('/api/auth/set-username'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ username: clean })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem('musii_user', JSON.stringify(data.data.user));
        this.updateProfileUI(data.data.user);
        this.hideAuth();
        haptics.trigger('heavy');
        errorHandler.showToast(`Welcome to MUSII, @${clean}!`);

        window.dispatchEvent(new CustomEvent('musii:user-updated', { detail: { user: data.data.user } }));

        // Start playing music
        setTimeout(() => {
          if (!audioController.isPlaying) {
            audioController.play();
          }
        }, 400);
      } else {
        throw new Error(data.error?.message || 'Failed to set username');
      }
    } catch (err) {
      haptics.trigger('heavy');
      errorHandler.showToast(err.message || 'Error updating username');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async handleSendCode() {
    const email = this.inputEmail ? this.inputEmail.value.trim() : '';
    if (!email || !email.includes('@')) {
      haptics.trigger('heavy');
      errorHandler.showToast('Please enter a valid email address');
      return;
    }

    const btn = document.getElementById('btnAuthSendCode');
    if (btn) btn.disabled = true;

    haptics.trigger('medium');

    try {
      const res = await fetch(apiUrl('/api/auth/send-code'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.data && data.data.isExistingUser) {
          errorHandler.showToast('Account found. Recovery code sent to your email.');
        } else {
          errorHandler.showToast('Verification code sent to your email');
        }
        this.showCodeStep(email, Boolean(data.data && data.data.isExistingUser));
      } else {
        throw new Error(data.error?.message || 'Failed to send code');
      }
    } catch (err) {
      haptics.trigger('heavy');
      errorHandler.showToast(err.message || 'Error sending code');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async handleResendCode() {
    if (!this.currentEmail) return;
    haptics.trigger('medium');

    try {
      const res = await fetch(apiUrl('/api/auth/send-code'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.currentEmail })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        errorHandler.showToast('New code sent to ' + this.currentEmail);
      } else {
        throw new Error(data.error?.message || 'Failed to resend');
      }
    } catch (err) {
      errorHandler.showToast(err.message || 'Resend failed');
    }
  }

  async handleVerifyCode() {
    const code = this.inputCode ? this.inputCode.value.trim() : '';
    if (!code || code.length < 6) {
      haptics.trigger('heavy');
      errorHandler.showToast('Please enter the 6-digit code');
      return;
    }

    const btn = document.getElementById('btnAuthVerify');
    if (btn) btn.disabled = true;

    haptics.trigger('medium');

    try {
      const res = await fetch(apiUrl('/api/auth/verify-code'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.currentEmail, code })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.token = data.data.token;
        localStorage.setItem('musii_token', this.token);
        localStorage.setItem('musii_user', JSON.stringify(data.data.user));

        this.updateProfileUI(data.data.user);
        window.dispatchEvent(new CustomEvent('musii:user-updated', { detail: { user: data.data.user } }));

        if (data.data.isRecovered || !data.data.requiresUsername) {
          // Existing account: Instant Recovery!
          this.hideAuth();
          haptics.trigger('heavy');
          const name = data.data.user.name || 'Member';
          errorHandler.showToast(`Account recovered: Welcome back, ${name}!`);

          setTimeout(() => {
            if (!audioController.isPlaying) {
              audioController.play();
            }
          }, 350);
        } else {
          // Brand new user: prompt to choose custom username
          haptics.trigger('medium');
          this.showUsernameStep(data.data.user);
        }
      } else {
        throw new Error(data.error?.message || 'Invalid code');
      }
    } catch (err) {
      haptics.trigger('heavy');
      errorHandler.showToast(err.message || 'Verification failed');
      if (this.inputCode) this.inputCode.value = '';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async validateSession() {
    if (!this.token) return;
    try {
      const res = await fetch(apiUrl('/api/auth/session'), {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.data && data.data.valid) {
          this.updateProfileUI(data.data.user);
          localStorage.setItem('musii_user', JSON.stringify(data.data.user));
          window.dispatchEvent(new CustomEvent('musii:user-updated', { detail: { user: data.data.user } }));
          this.hideAuth();
        }
      }
    } catch (e) {
      console.warn('[AuthController] Session background check error (kept offline):', e);
    }
  }

  updateProfileUI(user) {
    if (!user) return;
    const nameEl = document.getElementById('profileUserName');
    const handleEl = document.getElementById('profileUserHandle');
    const initialEl = document.getElementById('profileUserInitial');
    const emailEl = document.getElementById('profileUserEmail');
    const greetEl = document.getElementById('authGreetingName');

    if (nameEl) nameEl.textContent = user.name || 'MUSII Member';
    if (handleEl) handleEl.textContent = `${user.handle || '@user'} • Audiophile Lossless`;
    if (initialEl) initialEl.textContent = user.avatar_initial || 'M';
    if (emailEl && user.email) {
      emailEl.textContent = user.email;
    }
    if (greetEl && user.name) {
      greetEl.textContent = user.name;
    }
  }

  async signOut() {
    haptics.trigger('heavy');
    try {
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        }
      });
    } catch (e) {}

    document.documentElement.classList.remove('user-authenticated');
    this.clearSession();
    this.showAuth();
    errorHandler.showToast('Signed out. Your playlists and history are saved.');
  }

  clearSession() {
    this.token = null;
    localStorage.removeItem('musii_token');
    // Note: User profile, playlists, cache, and history are preserved in storage
  }
}

export const authController = new AuthController();
