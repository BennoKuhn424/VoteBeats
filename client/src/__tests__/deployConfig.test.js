import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Regression tests for vercel.json headers.
 *
 * Today's mobile playback outage was caused by CSP and Permissions-Policy
 * headers that were too restrictive for MusicKit v3 on iOS Safari. These
 * tests lock in the required allowlists so a future CSP tightening cannot
 * silently break iOS playback or screen-wake-lock again.
 *
 * If one of these fails, DO NOT relax the test — fix the header instead.
 * Desktop browsers tolerate a narrower CSP but iOS Safari strictly enforces
 * media-src / connect-src for HLS segments and FairPlay license fetches.
 */
describe('vercel.json deploy config', () => {
  const vercelJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8')
  );
  const headerBlock = vercelJson.headers?.find((h) => h.source === '/(.*)');
  const getHeader = (key) =>
    headerBlock?.headers?.find((h) => h.key === key)?.value || '';

  describe('Content-Security-Policy — Apple Music domains', () => {
    const csp = getHeader('Content-Security-Policy');

    it('media-src allows Apple Music audio CDNs (HLS segments)', () => {
      const mediaSrc = csp.match(/media-src[^;]*/)?.[0] || '';
      // Apple Music audio segments live on mzstatic + itunes, NOT *.apple.com.
      // Missing these silently breaks iOS Safari playback with MKError MEDIA_SESSION.
      expect(mediaSrc).toMatch(/\*\.mzstatic\.com/);
      expect(mediaSrc).toMatch(/\*\.itunes\.apple\.com/);
      expect(mediaSrc).toMatch(/\*\.music\.apple\.com/);
      expect(mediaSrc).toMatch(/blob:/);
    });

    it('connect-src allows MusicKit API + FairPlay license endpoints', () => {
      const connectSrc = csp.match(/connect-src[^;]*/)?.[0] || '';
      expect(connectSrc).toMatch(/\*\.music\.apple\.com/);
      expect(connectSrc).toMatch(/\*\.itunes\.apple\.com/);
      expect(connectSrc).toMatch(/\*\.mzstatic\.com/);
    });

    it('frame-src allows MusicKit auth iframe', () => {
      const frameSrc = csp.match(/frame-src[^;]*/)?.[0] || '';
      expect(frameSrc).toMatch(/\*\.apple\.com|\*\.music\.apple\.com/);
    });

    it('worker-src allows MusicKit SDK workers', () => {
      const workerSrc = csp.match(/worker-src[^;]*/)?.[0] || '';
      expect(workerSrc).toMatch(/blob:/);
    });

    it('script-src allows MusicKit SDK bundle', () => {
      const scriptSrc = csp.match(/script-src[^;]*/)?.[0] || '';
      expect(scriptSrc).toMatch(/js-cdn\.music\.apple\.com/);
    });

    it('img-src allows Apple Music artwork', () => {
      const imgSrc = csp.match(/img-src[^;]*/)?.[0] || '';
      expect(imgSrc).toMatch(/\*\.mzstatic\.com/);
    });
  });

  describe('Permissions-Policy', () => {
    const policy = getHeader('Permissions-Policy');

    it('allows screen-wake-lock (keeps phone screen on during playback)', () => {
      // Without an explicit allow, iOS Safari treats wake-lock as denied.
      expect(policy).toMatch(/screen-wake-lock=\*/);
    });

    it('allows autoplay (MusicKit playback)', () => {
      expect(policy).toMatch(/autoplay=\*/);
    });

    it('allows fullscreen (media element fullscreen)', () => {
      expect(policy).toMatch(/fullscreen=\*/);
    });
  });

  // ── Production API surface ─────────────────────────────────────────────────
  // These pin the production API host into the CSP and make sure the SPA
  // fallback stays present. Without them, swapping VITE_API_URL on Vercel can
  // silently break the app: the request leaves the page, fails CSP, login
  // dies, and our test suite reports green.
  //
  // If the API host changes (e.g. switching to a new domain), update BOTH the
  // vercel.json CSP AND this test in the same commit. Do not loosen.
  describe('Content-Security-Policy — Speeldit API surface', () => {
    const csp = getHeader('Content-Security-Policy');
    const connectSrc = csp.match(/connect-src[^;]*/)?.[0] || '';

    it('connect-src allows api.speeldit.com (canonical API host)', () => {
      expect(connectSrc).toMatch(/https:\/\/api\.speeldit\.com/);
    });

    it('connect-src allows wss://api.speeldit.com (Socket.IO)', () => {
      expect(connectSrc).toMatch(/wss:\/\/api\.speeldit\.com/);
    });
  });

  describe('SPA fallback rewrite', () => {
    // The /api/* → Render rewrite was removed 2026-05-07; the SPA now relies
    // on VITE_API_URL being absolute. The remaining rewrite must keep
    // serving /index.html for any path that isn't a static asset, otherwise
    // direct deep-links like /venue/login return 404.
    it('keeps an index.html fallback for non-asset paths', () => {
      const rewrites = vercelJson.rewrites || [];
      const fallback = rewrites.find((r) => r.destination === '/index.html');
      expect(fallback).toBeTruthy();
      expect(fallback.source).toMatch(/index\.html|assets/);
    });
  });
});
