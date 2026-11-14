import { haptics } from '../middleware/hapticMiddleware.js';

class NavigationController {
  constructor() {
    this.currentTab = 'home';
    this.tabs = ['home', 'playlist', 'profile', 'search'];
    this.indicator = null;
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
  }

  goTo(tabName, index = null) {
    if (!this.tabs.includes(tabName)) return;
    haptics.trigger('light');

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
    } else {
      if (btnQuickSearch) btnQuickSearch.classList.remove('is-active');
      if (this.indicator) {
        this.indicator.style.opacity = '1';
        if (index === null) index = this.tabs.indexOf(tabName);
        this.indicator.style.transform = `translateX(${index * 100}%)`;
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
}

export const navigationController = new NavigationController();

