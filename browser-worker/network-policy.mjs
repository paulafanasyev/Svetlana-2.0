import net from 'node:net';

export function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const p = address.split('.').map(Number);
    const [a, b, c] = p;
    // Deny non-global, special-purpose, documentation, benchmarking and multicast ranges.
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113)
      || a === 255;
  }
  if (family === 6) {
    const v = address.toLowerCase().split('%')[0];
    const first = parseInt(v.split(':')[0] || '0', 16);
    const isGlobalUnicast = first >= 0x2000 && first <= 0x3fff; // 2000::/3
    const isDocumentation = /^2001:db8(?::|$)/i.test(v);
    const isMappedOrCompatible = v.startsWith('::ffff:') || v.startsWith('::');
    return !isGlobalUnicast || isDocumentation || isMappedOrCompatible;
  }
  return true;
}

export function isBlockedHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  return !host || host === 'localhost'
    || ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.test',
      '.example', '.invalid', '.home.arpa', '.onion', '.localdomain'].some(suffix => host.endsWith(suffix));
}
