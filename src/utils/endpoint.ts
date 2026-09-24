export type EndpointCheck =
  | { ok: true; url: string }
  | { ok: false; reason: string };

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'metadata.google.internal' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1'
  ) {
    return true;
  }
  const ipv4 = host.startsWith('::ffff:') ? host.slice('::ffff:'.length) : host;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ipv4);
  if (!match) return false;
  const parts = match.slice(1).map(part => Number(part));
  if (parts.some(part => part > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

export function assertPublicHttpsEndpoint(raw: string): EndpointCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'jev_endpoint is not a valid URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'jev_endpoint must use HTTPS' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'jev_endpoint must not include credentials' };
  }
  if (isBlockedHost(url.hostname)) {
    return { ok: false, reason: 'jev_endpoint host is not allowed' };
  }
  return { ok: true, url: url.toString() };
}

const MODEL_ID = /^[A-Za-z0-9_./:-]{1,128}$/;

export function assertModelId(model: string): boolean {
  return MODEL_ID.test(model);
}
