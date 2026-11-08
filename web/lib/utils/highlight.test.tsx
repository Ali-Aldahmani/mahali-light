// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { highlightText } from './highlight';

function html(text: string | null | undefined, query?: string) {
  return render(<div>{highlightText(text, query)}</div>).container;
}

describe('highlightText', () => {
  it('shows a dash only when there is no text', () => {
    expect(html(null, 'a').textContent).toBe('—');
    expect(html('', 'a').textContent).toBe('—');
  });

  it('adds nothing after a match at the end of the text', () => {
    const el = html('Smart LED', 'led');
    expect(el.textContent).toBe('Smart LED');
    expect(el.querySelector('mark')?.textContent).toBe('LED');
  });

  it('marks every match and keeps the original letter case', () => {
    const el = html('led LED bulb', 'led');
    expect(el.textContent).toBe('led LED bulb');
    expect([...el.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['led', 'LED']);
  });

  it('returns the text unchanged when lowercasing changes its length', () => {
    const el = html('İstanbul', 'stan');
    expect(el.textContent).toBe('İstanbul');
    expect(el.querySelector('mark')).toBeNull();
  });
});
