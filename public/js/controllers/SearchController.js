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
        clearTimeout(this.debounceTimer);
        if (!query) {
          document.getElementById('searchSectionHeader').textContent = 'Recent searches';
          this.renderRecentSearches();
          return;
        }

        document.getElementById('searchSectionHeader').textContent = `Results for "${query}"`;
        this.debounceTimer = setTimeout(() => {
          this.performSearch(query);
        }, 320);
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

    // Default screenshot matches if empty
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
          id: 8,
          title: 'Walking On A Dream (Myd Remix)',
          artist: 'Empire Of The Sun',
          album: 'Walking On A Dream Remixes',
          cover_art: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/3e/42/a7/3e42a78d-57a3-fd69-6703-14d51205dd4c/13UMGIM24968.rgb.jpg/600x600bb.jpg'
        },
        {
          id: 9,
          title: 'Naksh Naksh',
          artist: 'Ali Kiba',
          album: 'Best of Tanzania Bongo Classics',
          cover_art: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/12/1f/93/121f9359-f134-8d0d-887d-ef61ac31a280/859741415228_cover.jpg/600x600bb.jpg'
        },
        {
          id: 10,
          title: 'Mile High Club',
          artist: 'Vybz Kartel',
          album: 'King of the Dancehall',
          cover_art: 'https://is1-ssl.mzstatic.com/image/thumb/Music62/v4/cb/87/fb/cb87fb96-c983-e481-5d7e-9e5e1699b9dd/889326493617.jpg/600x600bb.jpg'
        },
        {
          id: 11,
          title: 'Goth',
          artist: 'Sidewalks and Skeletons',
          album: 'White Light',
          cover_art: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/4a/cb/ae/4acbae53-2ca7-194f-2595-a1ec80d7b4d4/889211443277.jpg/600x600bb.jpg'
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

  async performSearch(query) {
    if (!this.searchList) return;
    this.searchList.innerHTML = `
      <div style="text-align:center; padding:30px 20px; color:var(--text-muted); font-size:14px;">
        Searching streaming catalog...
      </div>
    `;

    try {
      const res = await fetch(apiUrl(`/api/stream/search?q=${encodeURIComponent(query)}`));
      if (res.ok) {
        const json = await res.json();
        const results = json.data && json.data.results ? json.data.results : [];
        if (results.length === 0) {
          this.searchList.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:var(--text-muted); font-size:14px;">
              No tracks found matching "${query}".
            </div>
          `;
          return;
        }

        this.searchList.innerHTML = results.map(item => `
          <div class="search-row-item touch-spring" data-play-item='${JSON.stringify(item).replace(/'/g, "&apos;")}'>
            <img class="search-row-cover" src="${item.cover_art || item.thumbnail}" alt="${item.title}" loading="lazy" onerror="this.src='https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'">
            <div class="search-row-info">
              <span class="search-row-title">${item.title}</span>
              <span class="search-row-artist">${item.artist || 'Artist'}</span>
            </div>
            <div style="color:var(--accent); font-size:13px; font-weight:600; padding:6px 10px;">
              Play
            </div>
          </div>
        `).join('');

        this.searchList.querySelectorAll('.search-row-item').forEach(row => {
          row.addEventListener('click', () => {
            const dataStr = row.getAttribute('data-play-item');
            if (dataStr) {
              const item = JSON.parse(dataStr);
              this.addToRecent(item);
              audioController.playSong(item);
            }
          });
        });
      }
    } catch (e) {
      this.searchList.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--accent); font-size:14px;">
          Failed to search streams. Direct playback ready.
        </div>
      `;
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

