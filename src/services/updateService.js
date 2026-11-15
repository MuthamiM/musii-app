const https = require('https');
const env = require('../config/env');

class UpdateService {
  constructor() {
    this.cachedRelease = null;
    this.cacheTime = 0;
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  }

  compareSemver(v1, v2) {
    if (!v1 || !v2) return 0;
    const clean1 = v1.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const clean2 = v2.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(clean1.length, clean2.length); i++) {
      const num1 = clean1[i] || 0;
      const num2 = clean2[i] || 0;
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }
    return 0;
  }

  async fetchLatestGitHubRelease() {
    return new Promise((resolve) => {
      const options = {
        hostname: 'api.github.com',
        path: '/repos/MuthamiM/musii-app/releases/latest',
        method: 'GET',
        headers: {
          'User-Agent': 'MUSII-InApp-UpdateEngine/1.9.5',
          'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 6000
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const data = JSON.parse(body);
              resolve({ success: true, data });
            } else {
              resolve({ success: false, statusCode: res.statusCode });
            }
          } catch (e) {
            resolve({ success: false, error: e.message });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'GitHub API timeout' });
      });

      req.end();
    });
  }

  async getUpdateInfo(clientVersion) {
    const now = Date.now();
    const currentVersion = clientVersion || env.VERSION;

    if (!this.cachedRelease || (now - this.cacheTime) > this.CACHE_TTL) {
      const ghRes = await this.fetchLatestGitHubRelease();
      if (ghRes.success && ghRes.data && ghRes.data.tag_name) {
        const tag = ghRes.data.tag_name;
        const versionStr = tag.replace(/^v/, '');
        const apkAsset = Array.isArray(ghRes.data.assets)
          ? ghRes.data.assets.find(a => a.name && a.name.endsWith('.apk'))
          : null;

        const downloadUrl = apkAsset
          ? apkAsset.browser_download_url
          : `https://github.com/MuthamiM/musii-app/releases/download/${tag}/musii-${tag}.apk`;

        this.cachedRelease = {
          latestVersion: versionStr,
          tag: tag,
          downloadUrl: downloadUrl,
          releaseUrl: ghRes.data.html_url || `https://github.com/MuthamiM/musii-app/releases/tag/${tag}`,
          releaseNotes: ghRes.data.body || 'New features, improvements, and bug fixes.',
          publishedAt: ghRes.data.published_at || new Date().toISOString()
        };
        this.cacheTime = now;
      }
    }

    const latest = this.cachedRelease || {
      latestVersion: env.VERSION,
      tag: `v${env.VERSION}`,
      downloadUrl: `https://github.com/MuthamiM/musii-app/releases/download/v${env.VERSION}/musii-v${env.VERSION}.apk`,
      releaseUrl: `https://github.com/MuthamiM/musii-app/releases/tag/v${env.VERSION}`,
      releaseNotes: 'Performance enhancements and bug fixes.',
      publishedAt: new Date().toISOString()
    };

    const updateAvailable = this.compareSemver(latest.latestVersion, currentVersion) > 0;

    return {
      currentVersion,
      serverVersion: env.VERSION,
      latestVersion: latest.latestVersion,
      updateAvailable,
      downloadUrl: latest.downloadUrl,
      releaseUrl: latest.releaseUrl,
      releaseNotes: latest.releaseNotes,
      publishedAt: latest.publishedAt
    };
  }
}

module.exports = new UpdateService();

