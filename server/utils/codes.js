// Helpers for generating short codes used inside SKUs and internal barcodes.
// Codes are conservative (uppercase, ASCII, no special chars) so they always
// round-trip through human-readable barcodes and forms.

function codeFromName(name, fallback = 'GEN', length = 3) {
  if (!name) return fallback;
  const words = String(name)
    .replace(/&/g, ' ')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/);

  let code = '';
  if (words.length >= 2) {
    code = words
      .map((w) => w[0])
      .join('')
      .slice(0, length)
      .toUpperCase();
  } else {
    // Take the first `length` consonants (then any chars) of the single word.
    const w = words[0] || '';
    const vowels = /[AEIOU]/;
    const upper = w.toUpperCase();
    const filtered = upper.split('').filter((ch, i) => i === 0 || !vowels.test(ch));
    code = filtered.join('').slice(0, length);
  }
  if (!code) return fallback;
  return code.padEnd(length, 'X').slice(0, length);
}

function pad(num, width = 6) {
  const s = String(num);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

function randomDigits(width = 6) {
  let s = '';
  for (let i = 0; i < width; i++) {
    s += Math.floor(Math.random() * 10);
  }
  return s;
}

module.exports = { codeFromName, pad, randomDigits };
