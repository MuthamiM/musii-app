export const API_BASE = (window.location.hostname === 'musii.mftechnologies.org')
  ? ''
  : 'https://musii.mftechnologies.org';

export function apiUrl(path) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${cleanPath}`;
}
