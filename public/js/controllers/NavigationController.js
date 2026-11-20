import { haptics } from '../middleware/hapticMiddleware.js';

class NavigationController {
  constructor() {
    this.currentTab = 'home';
    this.previousTab = 'home';
    this.tabs = ['home', 'explore', 'playlist', 'search', 'settings'];
    this.bottomTabs = ['home', 'explore', 'playlist'];
    this.indicator = null;
    this.lastScrollY = 0;
    this.scrollTicking = false;
  }

  init() {
    this.indicator = document.getElementById('navPillIndicator');
    const tabButtons = document.querySelectorAll('.nav-tab-btn');

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        const index = parseInt(btn.dataset.idx, 10);
        this.goTo(target, index);
      });
    });

    // Profile buttons across headers go to Settings
    const profileBtns = [
      document.getElementById('btnHeaderProfile'),
      document.getElementById('btnLibraryProfile'),
      document.getElementById('btnExploreProfile'),
      document.getElementById('searchProfileBtn')
    ];
    profileBtns.forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          this.goTo('settings');
        });
      }
    });

    this.bindScrollAutoHide();
    this.bindKeyboardAvoidance();
  }

  bindKeyboardAvoidance() {
    const navIsland = document.getElementById('navIslandWrapper');
    const miniPlayer = document.getElementById('floatingMiniPlayer');

    const hideBars = () => {
      document.documentElement.classList.add('keyboard-visible');
      if (navIsland) navIsland.classList.add('nav-hidden');
      if (miniPlayer) miniPlayer.classList.add('mini-hidden');
    };

    const restoreBars = () => {
      document.documentElement.classList.remove('keyboard-visible');
      const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
      if (currentScrollY <= 40) {
        if (navIsland) navIsland.classList.remove('nav-hidden');
        if (miniPlayer) miniPlayer.classList.remove('mini-hidden');
      }
    };

    document.addEventListener('focusin', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        hideBars();
      }
    });

    document.addEventListener('focusout', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        setTimeout(() => {
          const active = document.activeElement;
          if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
            restoreBars();
          }
        }, 120);
      }
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        const isKeyboard = window.visualViewport.height < window.innerHeight - 100;
        if (isKeyboard) {
          hideBars();
        } else {
          const active = document.activeElement;
          if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
            restoreBars();
          }
        }
      });
    }
  }

  bindScrollAutoHide() {
    const navIsland = document.getElementById('navIslandWrapper');
    const miniPlayer = document.getElementById('floatingMiniPlayer');
    const scrollThreshold = 12;

    const onScroll = () => {
      if (!this.scrollTicking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;

          // Always reveal bar when near the top
          if (currentScrollY <= 40) {
            if (navIsland) navIsland.classList.remove('nav-hidden');
            if (miniPlayer) miniPlayer.classList.remove('mini-hidden');
            this.lastScrollY = currentScrollY;
            this.scrollTicking = false;
            return;
          }

          const diff = currentScrollY - this.lastScrollY;
          if (Math.abs(diff) > scrollThreshold) {
            if (diff > 0) {
              // Scrolling down: auto-hide bar
              if (navIsland) navIsland.classList.add('nav-hidden');
              if (miniPlayer) miniPlayer.classList.remove('mini-hidden');
            } else {
              // Scrolling up: reveal bar
              if (navIsland) navIsland.classList.remove('nav-hidden');
              if (miniPlayer) miniPlayer.classList.remove('mini-hidden');
            }
            this.lastScrollY = currentScrollY;
          }

          this.scrollTicking = false;
        });
        this.scrollTicking = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });

    // Show bars immediately if user touches near the bottom
    document.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0] && e.touches[0].clientY > window.innerHeight - 120) {
        if (navIsland) navIsland.classList.remove('nav-hidden');
        if (miniPlayer) miniPlayer.classList.remove('mini-hidden');
      }
    }, { passive: true });
  }

  goTo(tabName, index = null) {
    if (!this.tabs.includes(tabName)) return;
    haptics.trigger('light');

    if (this.currentTab !== 'settings' && this.currentTab !== 'search') {
      this.previousTab = this.currentTab;
    }

    // Reveal navigation bar and mini player when changing tabs
    const navIsland = document.getElementById('navIslandWrapper');
    const miniPlayer = document.getElementById('floatingMiniPlayer');
    if (navIsland) navIsland.classList.remove('nav-hidden');
    if (miniPlayer) miniPlayer.classList.remove('mini-hidden');

    this.currentTab = tabName;
    const btnQuickSearch = document.getElementById('btnQuickSearch');

    if (tabName === 'search') {
      if (this.indicator) this.indicator.style.opacity = '0';
      if (btnQuickSearch) btnQuickSearch.classList.add('is-active');

      document.querySelectorAll('.nav-tab-btn').forEach(btn => {
        btn.classList.remove('is-active');
      });

      document.querySelectorAll('.view-section').forEach(sec => {
        sec.classList.toggle('active', sec.id === 'view-search');
      });
    } else if (tabName === 'settings') {
      if (this.indicator) this.indicator.style.opacity = '0';
      if (btnQuickSearch) btnQuickSearch.classList.remove('is-active');

      document.querySelectorAll('.nav-tab-btn').forEach(btn => {
        btn.classList.remove('is-active');
      });

      document.querySelectorAll('.view-section').forEach(sec => {
        sec.classList.toggle('active', sec.id === 'view-settings');
      });
    } else {
      if (btnQuickSearch) btnQuickSearch.classList.remove('is-active');
      const bottomIdx = this.bottomTabs.indexOf(tabName);
      if (this.indicator) {
        this.indicator.style.opacity = '1';
        const finalIdx = index !== null ? index : (bottomIdx !== -1 ? bottomIdx : 0);
        this.indicator.style.transform = `translateX(${finalIdx * 100}%)`;
      }

      document.querySelectorAll('.nav-tab-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.tab === tabName);
      });

      document.querySelectorAll('.view-section').forEach(sec => {
        sec.classList.toggle('active', sec.id === `view-${tabName}`);
      });
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  switchTab(tabName, index = null) {
    this.goTo(tabName, index);
  }

  goBack() {
    this.goTo(this.previousTab || 'home');
  }
}

export const navigationController = new NavigationController();
