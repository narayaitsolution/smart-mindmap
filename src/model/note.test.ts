import { describe, expect, it } from 'vitest';
import { cleanNote, MAX_NOTE_BYTES, noteImageBytes, notePreview, noteToPlainText, noteToXhtml, renderNote, sanitizeNote } from './note';

describe('sanitizeNote', () => {
  it('keeps the allowlisted markup unchanged', () => {
    const html =
      '<p>Hi <b>b</b> <i>i</i> <u>u</u> <s>s</s></p><ul><li>a</li></ul><ol><li>b</li></ol><h1>t</h1><h2>t</h2><h3>t</h3><blockquote>q</blockquote><code>c</code><br>';
    expect(sanitizeNote(html)).toBe(html);
  });

  it('removes scripts, styles, frames, svg and event handler attributes', () => {
    const dirty =
      '<p onclick="x()" style="color:red" class="a" id="b">Hi</p><script>alert(1)</script><style>p{}</style><iframe src="https://e.com"></iframe><svg onload="x()"><circle/></svg><object data="x"></object>';
    expect(sanitizeNote(dirty)).toBe('<p>Hi</p>');
  });

  it('unwraps unknown elements and maps equivalent tags', () => {
    expect(sanitizeNote('<span>a</span><font color="red">b</font>')).toBe('ab');
    expect(sanitizeNote('<strong>a</strong><em>b</em><strike>c</strike>')).toBe('<b>a</b><i>b</i><s>c</s>');
  });

  it('keeps only http, https and mailto links and unwraps the rest', () => {
    for (const ok of ['http://a.com/x', 'https://a.com/?q=1&r=2', 'mailto:a@b.com']) {
      expect(sanitizeNote(`<a href="${ok.replace(/&/g, '&amp;')}">t</a>`)).toBe(`<a href="${ok.replace(/&/g, '&amp;')}">t</a>`);
    }
    for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java&#9;script:alert(1)', 'data:text/html,x', 'vbscript:x', '/relative', '//evil.com', 'file:///etc/passwd']) {
      expect(sanitizeNote(`<a href="${bad}">t</a>`)).toBe('t');
    }
  });

  it('turns remote https images into plain links so nothing loads automatically', () => {
    expect(sanitizeNote('<img src="https://a.com/p.png" alt="foto">')).toBe('<a href="https://a.com/p.png">foto</a>');
    expect(sanitizeNote('<img src="https://a.com/p.png">')).toBe('<a href="https://a.com/p.png">image</a>');
    expect(sanitizeNote('<a href="https://x.com"><img src="https://a.com/p.png" alt="p"></a>')).toBe('<a href="https://x.com">p</a>');
    const once = sanitizeNote('<p><img src="https://a.com/p.png" alt="p"></p>') as string;
    expect(sanitizeNote(once)).toBe(once);
    expect(renderNote('<img src="https://a.com/p.png" alt="p">')).not.toContain('<img');
  });

  it('allows strict data images only', () => {
    for (const type of ['png', 'jpeg', 'webp', 'gif']) {
      const src = `data:image/${type};base64,AAAA`;
      expect(sanitizeNote(`<img src="${src}">`)).toBe(`<img src="${src}">`);
    }
    for (const bad of [
      'http://a.com/p.png',
      'data:image/svg+xml;base64,AAAA',
      'data:image/svg+xml,%3Csvg%3E',
      'data:text/html;base64,AAAA',
      'data:image/png,AAAA',
      'javascript:alert(1)',
      'https://a.com/x.svg',
      '/local.png',
    ]) {
      expect(sanitizeNote(`<img src="${bad}">`)).toBeUndefined();
    }
  });

  it('limits each data image to 1 MB decoded', () => {
    const src = (chars: number) => `data:image/png;base64,${'A'.repeat(chars)}`;
    const fits = src(1_398_100); // 1,048,575 bytes
    expect(sanitizeNote(`<p>a</p><img src="${fits}">`)).toContain(fits);
    expect(sanitizeNote(`<p>a</p><img src="${src(1_398_104)}">`)).toBe('<p>a</p>');
  });

  it('keeps at most 5 data images per note', () => {
    const img = '<img src="data:image/png;base64,AAAA">';
    expect(sanitizeNote(img.repeat(6))).toBe(img.repeat(5));
  });

  it('keeps only href, src and alt attributes', () => {
    expect(sanitizeNote('<img src="data:image/png;base64,AAAA" alt="a" width="9" onerror="x" style="x">')).toBe('<img src="data:image/png;base64,AAAA" alt="a">');
    expect(sanitizeNote('<a href="https://a.com" target="_blank" onclick="x" rel="x">y</a>')).toBe('<a href="https://a.com">y</a>');
  });

  it('keeps escaped markup as text', () => {
    expect(sanitizeNote('&lt;img src=x onerror=alert(1)&gt; &amp; "q"')).toBe('&lt;img src=x onerror=alert(1)&gt; &amp; "q"');
  });

  it('is idempotent', () => {
    const dirty = '<div>a<span onclick="x">b</span><a href="javascript:x">c</a><img src=x></div><script>1</script><b>d';
    const once = sanitizeNote(dirty) as string;
    expect(sanitizeNote(once)).toBe(once);
  });

  it('returns undefined for empty or non-string input', () => {
    for (const v of ['', '   ', '<p><br></p>', '<script>x</script>', undefined, null, 5, {}]) {
      expect(sanitizeNote(v)).toBeUndefined();
    }
  });

  it('rejects markup over 100 KB but does not count data image payloads', () => {
    expect(cleanNote('a'.repeat(MAX_NOTE_BYTES))).toMatchObject({ tooLarge: false });
    expect(cleanNote('a'.repeat(MAX_NOTE_BYTES + 1))).toEqual({ html: undefined, tooLarge: true });
    expect(sanitizeNote('é'.repeat(MAX_NOTE_BYTES / 2 + 1))).toBeUndefined();
    const img = `<img src="data:image/png;base64,${'A'.repeat(500_000)}">`;
    expect(sanitizeNote(`<p>x</p>${img}`)).toContain('<p>x</p>');
    // Text that merely looks like a data image still counts as markup.
    expect(cleanNote(`src="data:image/png;base64,${'A'.repeat(MAX_NOTE_BYTES)}"`).tooLarge).toBe(true);
  });

  it('strips control characters that are invalid in XML', () => {
    expect(sanitizeNote('a\u0000b\u0008c\u001fd')).toBe('abcd');
  });

  it('survives very deep nesting without throwing', () => {
    const out = sanitizeNote('<b>'.repeat(2000) + 'x') as string;
    expect(out).toContain('x');
    expect(out.split('<b>').length - 1).toBeLessThanOrEqual(24);
    expect(sanitizeNote('<b>'.repeat(20000) + 'x')).toBeUndefined();
  });
});

describe('renderNote', () => {
  it('opens links safely and hardens images', () => {
    const out = renderNote('<p><a href="https://a.com">t</a><img src="data:image/png;base64,AAAA" alt="a"></p>');
    expect(out).toContain('<a href="https://a.com" target="_blank" rel="noopener noreferrer">t</a>');
    expect(out).toContain('referrerpolicy="no-referrer"');
  });

  it('sanitizes before rendering', () => {
    expect(renderNote('<img src=x onerror=alert(1)><script>1</script>ok')).toBe('ok');
  });
});

describe('note text helpers', () => {
  it('builds a short plain-text preview', () => {
    expect(notePreview('<p>Halo <b>dunia</b></p><p>dua</p>')).toBe('Halo dunia dua');
    expect(notePreview(`<p>${'x'.repeat(300)}</p>`, 20)).toHaveLength(20);
  });

  it('serializes to well-formed XHTML', () => {
    const xml = noteToXhtml('<p>a &amp; b<br><img src="data:image/png;base64,AAAA" alt="q&quot;"></p>');
    expect(xml).toBe('<p>a &amp; b<br/><img src="data:image/png;base64,AAAA" alt="q&quot;"/></p>');
    expect(new DOMParser().parseFromString(`<r>${xml}</r>`, 'application/xml').querySelector('parsererror')).toBeNull();
  });
});

describe('note image budget helpers', () => {
  it('counts decoded bytes of data images only', () => {
    expect(noteImageBytes('<p>x</p>')).toBe(0);
    expect(noteImageBytes('<img src="data:image/png;base64,AAAA">')).toBe(3);
    expect(noteImageBytes('<img src="data:image/png;base64,AAA="><img src="data:image/gif;base64,AAAA">')).toBe(2 + 3);
    expect(noteImageBytes('&lt;img src="data:image/png;base64,AAAA"&gt;')).toBe(0);
  });
});

describe('noteToPlainText', () => {
  it('keeps blocks, lists, links and image markers readable', () => {
    const text = noteToPlainText('<h1>Judul</h1><p>a <b>b</b><br>c</p><ul><li>satu</li><li>dua</li></ul><p><a href="https://a.com/x">tautan</a> <img src="data:image/png;base64,AAAA"></p>');
    expect(text).toBe('Judul\na b\nc\n• satu\n• dua\ntautan (https://a.com/x) [image]');
  });

  it('returns an empty string for empty notes', () => {
    expect(noteToPlainText('')).toBe('');
  });
});
