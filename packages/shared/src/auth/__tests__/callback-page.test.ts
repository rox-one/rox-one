import { describe, expect, it } from 'bun:test';
import { generateCallbackPage } from '../callback-page.ts';

describe('generateCallbackPage', () => {
  it('escapes script payloads in errorDetail so they stay inert text', () => {
    const html = generateCallbackPage({
      title: 'Authorization Failed',
      isSuccess: false,
      errorDetail: '<script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('does not emit a javascript: deeplink in href or auto-close script', () => {
    const html = generateCallbackPage({
      title: 'Authorization Complete',
      isSuccess: true,
      deeplinkUrl: 'javascript:alert(1)',
    });

    expect(html).not.toContain('javascript:alert(1)');
    expect(html).not.toContain("window.location.href = 'javascript:");
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it('keeps an internal craftagents deeplink on success', () => {
    const html = generateCallbackPage({
      title: 'Authorization Complete',
      isSuccess: true,
      deeplinkUrl: 'craftagents://oauth/callback?code=abc',
    });

    expect(html).toContain('href="craftagents://oauth/callback?code=abc"');
    expect(html).toContain('window.location.href = "craftagents://oauth/callback?code=abc"');
  });
});
