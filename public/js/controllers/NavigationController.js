import { haptics } from '../middleware/hapticMiddleware.js';

class NavigationController {
  constructor() {
    this.currentTab = 'home';
    this.tabs = ['home', 'playlist', 'profile'];
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

    if (index === null) {
      index = this.tabs.indexOf(tabName);
    }

    this.currentTab = tabName;

    // Slide bottom nav indicator
    if (this.indicator) {
      this.indicator.style.transform = `translateX(${index * 100}%)`;
    }

    // Toggle button active classes
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.tab === tabName);
    });

    // Toggle view sections
    document.querySelectorAll('.view-section').forEach(sec => {
      sec.classList.toggle('active', sec.id === `view-${tabName}`);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

export const navigationController = new NavigationController();

