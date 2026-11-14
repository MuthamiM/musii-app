/**
 * Client Storage & Offline Cache Service
 */
class StorageService {
  constructor() {
    this.prefix = 'bitchord_';
  }

  get(key, fallback = null) {
    try {
      const data = localStorage.getItem(this.prefix + key);
      return data ? JSON.parse(data) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  set(key, value) {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (e) {}
  }

  remove(key) {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch (e) {}
  }
}

export const storage = new StorageService();

