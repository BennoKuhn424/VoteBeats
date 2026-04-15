export function getPublicBaseUrl() {
  const envUrl = (import.meta.env?.VITE_PUBLIC_URL ?? '').trim();

  const hasHttpScheme = /^https?:\/\//i.test(envUrl);
  const looksLikePlaceholder = /^vite_public_url$/i.test(envUrl) || /^VITE_PUBLIC_URL$/i.test(envUrl);

  const fallback =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';

  const chosen = envUrl && hasHttpScheme && !looksLikePlaceholder ? envUrl : fallback;

  return String(chosen).replace(/\/$/, '');
}

export function buildVotingUrl(venueCode) {
  const base = getPublicBaseUrl();
  const code = String(venueCode || '').trim();
  return `${base}/v/${code}`;
}
