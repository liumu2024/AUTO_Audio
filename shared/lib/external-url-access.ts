export type ExternalUrlAccessKind =
  | 'external_https'
  | 'external_http'
  | 'empty'
  | 'invalid'
  | 'unsupported_protocol'
  | 'local_host'
  | 'private_network'

export interface ExternalUrlAccessReport {
  ok: boolean
  kind: ExternalUrlAccessKind
  reason: string
  hostname?: string
  protocol?: string
  normalizedUrl?: string
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function isPrivateIpv6(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return (
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  )
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
}

export function classifyExternalUrlAccess(value: string | undefined | null): ExternalUrlAccessReport {
  const raw = value?.trim()
  if (!raw) {
    return {
      ok: false,
      kind: 'empty',
      reason: 'URL is empty.',
    }
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return {
      ok: false,
      kind: 'invalid',
      reason: 'URL is not parseable.',
    }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      kind: 'unsupported_protocol',
      protocol: url.protocol,
      hostname: url.hostname,
      normalizedUrl: url.toString(),
      reason: 'Only http(s) URLs can be passed to external generation providers.',
    }
  }

  if (isLocalHostname(url.hostname)) {
    return {
      ok: false,
      kind: 'local_host',
      protocol: url.protocol,
      hostname: url.hostname,
      normalizedUrl: url.toString(),
      reason: 'The URL points to a local hostname and cannot be fetched by an external provider.',
    }
  }

  if (isPrivateIpv4(url.hostname) || isPrivateIpv6(url.hostname)) {
    return {
      ok: false,
      kind: 'private_network',
      protocol: url.protocol,
      hostname: url.hostname,
      normalizedUrl: url.toString(),
      reason: 'The URL points to a private network address and cannot be fetched by an external provider.',
    }
  }

  return {
    ok: true,
    kind: url.protocol === 'https:' ? 'external_https' : 'external_http',
    protocol: url.protocol,
    hostname: url.hostname,
    normalizedUrl: url.toString(),
    reason:
      url.protocol === 'https:'
        ? 'The URL is likely reachable by an external provider.'
        : 'The URL is public-looking HTTP; HTTPS is preferred for external providers.',
  }
}

export function isLikelyExternallyReachableUrl(value: string | undefined | null): boolean {
  return classifyExternalUrlAccess(value).ok
}
