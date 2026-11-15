import { audioController } from './AudioController.js';
import { navigationController } from './NavigationController.js';
import { apiUrl } from '../constants/api.js';
import { haptics } from '../middleware/hapticMiddleware.js';

class SearchController {
  constructor() {
    this.searchInput = null;
    this.searchList = null;
    this.currentFilter = 'youtube';
    this.debounceTimer = null;
    this.recentSearches = [];
    this.currentQuery = '';
    this.activeSearchId = 0;
  }

  init() {
    this.searchInput = document.getElementById('mainSearchInput');
    this.searchList = document.getElementById('searchTracksList');
    const btnQuickSearch = document.getElementById('btnQuickSearch');
    const btnClear = document.getElementById('btnClearRecentSearches');
    const profileBtn = document.getElementById('searchProfileBtn');
    const filterPills = document.querySelectorAll('.search-pill-btn');

    this.loadRecentSearches();

    if (btnQuickSearch) {
      btnQuickSearch.addEventListener('click', () => {
        haptics.trigger('light');
        navigationController.goTo('search');
        if (this.searchInput) {
          setTimeout(() => this.searchInput.focus(), 150);
        }
      });
    }

    if (profileBtn) {
      profileBtn.addEventListener('click', () => {
        navigationController.goTo('profile');
      });
    }

    if (btnClear) {
      btnClear.addEventListener('click', () => {
        haptics.trigger('medium');
        this.recentSearches = [];
        this.saveRecentSearches();
        this.renderRecentSearches();
      });
    }

    filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        filterPills.forEach(p => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.currentFilter = pill.dataset.filter || 'youtube';
        haptics.trigger('light');
        if (this.searchInput && this.searchInput.value.trim()) {
          this.performSearch(this.searchInput.value.trim());
        }
      });
    });

    if (this.searchInput) {
      this.searchInput.addEventListener('input', e => {
        const query = e.target.value.trim();
        this.currentQuery = query;
        clearTimeout(this.debounceTimer);

        if (!query) {
          const header = document.getElementById('searchSectionHeader');
          if (header) header.textContent = 'Recent searches';
          this.renderRecentSearches();
          return;
        }

        const header = document.getElementById('searchSectionHeader');
        if (header) header.textContent = `Results for "${query}"`;

        // 1. Instant local results with ZERO debounce (< 1ms)
        this.renderInstantLocalResults(query);

        // 2. Debounced remote streaming search
        this.debounceTimer = setTimeout(() => {
          this.performSearch(query);
        }, 200);
      });
    }

    this.renderRecentSearches();
  }

  loadRecentSearches() {
    try {
      const stored = localStorage.getItem('musii_recent_searches');
      if (stored) {
        this.recentSearches = JSON.parse(stored);
      }
    } catch (e) {}

    if (!this.recentSearches || this.recentSearches.length === 0) {
      this.recentSearches = [
        {
          id: 5,
          title: 'Natural Mystic',
          artist: 'Bob Marley',
          album: 'Exodus',
          cover_art: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/f3/5a/67/f35a67ae-de94-1e98-8f3e-ab73358f9092/06UMGIM10554.rgb.jpg/600x600bb.jpg'
        },
        {
          id: 6,
          title: 'Around the World (La La La La)',
          artist: 'A Touch of Class',
          album: 'Planet Pop',
          cover_art: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/c2/a2/38/c2a2384d-8c55-8180-53ed-88b152f82db4/743217932756.jpg/600x600bb.jpg'
        },
        {
          id: 7,
          title: 'Walking On A Dream',
          artist: 'Empire Of The Sun',
          album: 'Walking On A Dream',
          cover_art: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/3e/42/a7/3e42a78d-57a3-fd69-6703-14d51205dd4c/13UMGIM24968.rgb.jpg/600x600bb.jpg'
        },
        {
          id: 1,
          title: 'Make No Sense',
          artist: 'YoungBoy Never Broke Again',
          album: 'AI YoungBoy 2',
          cover_art: 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'
        }
      ];
      this.saveRecentSearches();
    }
  }

  saveRecentSearches() {
    try {
      localStorage.setItem('musii_recent_searches', JSON.stringify(this.recentSearches));
    } catch (e) {}
  }

  renderRecentSearches() {
    if (!this.searchList) return;
    if (this.recentSearches.length === 0) {
      this.searchList.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--text-muted); font-size:14px;">
          No recent searches. Try searching for songs, artists, or lyrics.
        </div>
      `;
      return;
    }

    this.searchList.innerHTML = this.recentSearches.map(item => `
      <div class="search-row-item touch-spring" data-track-id="${item.id || ''}">
        <img class="search-row-cover" src="${item.cover_art}" alt="${item.title}" loading="lazy" onerror="this.src='https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'">
        <div class="search-row-info">
          <span class="search-row-title">${item.title}</span>
          <span class="search-row-artist">${item.artist}</span>
        </div>
        <button class="search-row-delete-btn" data-delete-id="${item.id}" aria-label="Remove from recent searches">
          <svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2.5;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join('');

    this.bindRowEvents();
  }

  bindRowEvents() {
    if (!this.searchList) return;

    this.searchList.querySelectorAll('.search-row-delete-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.deleteId, 10);
        this.recentSearches = this.recentSearches.filter(s => s.id !== id);
        this.saveRecentSearches();
        this.renderRecentSearches();
        haptics.trigger('light');
      });
    });

    this.searchList.querySelectorAll('.search-row-item').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.search-row-delete-btn')) return;
        const trackId = parseInt(row.dataset.trackId, 10);
        const selected = this.recentSearches.find(s => s.id === trackId);
        if (selected) {
          audioController.playSong(selected);
        }
      });
    });
  }

  // Feature 3: Instant Local Matches from in-memory tracks
  renderInstantLocalResults(query) {
    if (!this.searchList) return;
    const q = query.toLowerCase();

    const localMatches = (audioController.tracks || []).filter(t =>
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.artist && t.artist.toLowerCase().includes(q)) ||
      (t.album && t.album.toLowerCase().includes(q))
    ).slice(0, 4);

    if (localMatches.length === 0) {
      this.searchList.innerHTML = `
        <div class="search-skeleton-loader" style="padding:16px; display:flex; flex-direction:column; gap:12px;">
          <div style="height:48px; border-radius:12px; background:rgba(255,255,255,0.05); animation:pulse 1.2s infinite ease-in-out;"></div>
          <div style="height:48px; border-radius:12px; background:rgba(255,255,255,0.03); animation:pulse 1.2s infinite ease-in-out;"></div>
        </div>
      `;
      return;
    }

    const html = `
      <div style="padding:4px 8px; font-size:11px; text-transform:uppercase; letter-spacing:0.8px; color:var(--accent); font-weight:700;">
        From Your Library
      </div>
      ${localMatches.map(item => this.createRowHtml(item, true)).join('')}
      <div style="padding:12px 8px 4px; font-size:11px; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); font-weight:700;">
        Searching Online Catalog...
      </div>
      <div style="height:48px; border-radius:12px; margin:4px 0; background:rgba(255,255,255,0.04); animation:pulse 1.2s infinite ease-in-out;"></div>
    `;

    this.searchList.innerHTML = html;
    this.bindResultActions();
  }

  createRowHtml(item, isLocal = false) {
    const dataStr = JSON.stringify(item).replace(/'/g, "&apos;");
    const coverUrl = item.cover_art || item.thumbnail || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg';

    return `
      <div class="search-row-item touch-spring" data-play-item='${dataStr}'>
        <img class="search-row-cover" src="${coverUrl}" alt="${item.title}" loading="lazy" onerror="this.src='https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'">
        <div class="search-row-info">
          <span class="search-row-title">${item.title}</span>
          <span class="search-row-artist">${item.artist || 'Artist'}${isLocal ? ' • Instant' : ''}</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button class="btn-row-add-next" title="Play Next" style="background:rgba(255,255,255,0.06); border:none; color:var(--text-secondary); border-radius:50%; width:30px; height:30px; display:grid; place-items:center; cursor:pointer;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
          </button>
          <button class="btn-row-add-queue" title="Add to Queue" style="background:rgba(255,255,255,0.06); border:none; color:var(--text-secondary); border-radius:50%; width:30px; height:30px; display:grid; place-items:center; cursor:pointer;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
          <div class="btn-row-play-now" style="color:var(--accent); font-size:12px; font-weight:700; padding:6px 10px; border-radius:999px; background:rgba(230,57,70,0.12); cursor:pointer;">
            Play
          </div>
        </div>
      </div>
    `;
  }

  bindResultActions() {
    if (!this.searchList) return;

    this.searchList.querySelectorAll('.search-row-item').forEach(row => {
      const dataStr = row.getAttribute('data-play-item');
      if (!dataStr) return;
      const item = JSON.parse(dataStr);

      const btnQueue = row.querySelector('.btn-row-add-queue');
      if (btnQueue) {
        btnQueue.addEventListener('click', (e) => {
          e.stopPropagation();
          audioController.addToQueue(item);
        });
      }

      const btnNext = row.querySelector('.btn-row-add-next');
      if (btnNext) {
        btnNext.addEventListener('click', (e) => {
          e.stopPropagation();
          audioController.playNextInQueue(item);
        });
      }

      row.addEventListener('click', () => {
        this.addToRecent(item);
        audioController.playSong(item);
      });
    });
  }

  async performSearch(query) {
    if (!this.searchList) return;
    const thisSearchId = ++this.activeSearchId;

    try {
      // Use parallel fast search endpoint
      const res = await fetch(apiUrl(`/api/stream/search/fast?q=${encodeURIComponent(query)}`));
      if (thisSearchId !== this.activeSearchId) return; // Stale query superseded

      if (res.ok) {
        const json = await res.json();
        const results = Array.isArray(json.data) ? json.data : (json.data && json.data.results ? json.data.results : []);

        if (results.length === 0) {
          this.searchList.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:var(--text-muted); font-size:14px;">
              No tracks found matching "${query}".
            </div>
          `;
          return;
        }

        this.searchList.innerHTML = results.map(item => this.createRowHtml(item, Boolean(item.isLocal))).join('');
        this.bindResultActions();
      }
    } catch (e) {
      if (thisSearchId === this.activeSearchId) {
        this.searchList.innerHTML = `
          <div style="text-align:center; padding:40px 20px; color:var(--text-muted); font-size:14px;">
            Search catalog busy. Please try again.
          </div>
        `;
      }
    }
  }

  addToRecent(item) {
    this.recentSearches = this.recentSearches.filter(s => s.title !== item.title);
    this.recentSearches.unshift({
      id: Date.now(),
      title: item.title,
      artist: item.artist || 'Unknown Artist',
      album: item.album || 'MUSII Stream',
      cover_art: item.cover_art || item.thumbnail || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'
    });
    if (this.recentSearches.length > 20) this.recentSearches.pop();
    this.saveRecentSearches();
  }
}

export const searchController = new SearchController();
