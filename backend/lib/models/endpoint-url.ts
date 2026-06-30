export function normalizeEndpointBase(value: string, fallback: string) {
  const raw = String(value || "").trim()
  const fallbackBase = String(fallback || "").trim().replace(/\/+$/, "")
  if (!raw) return fallbackBase
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "")

  const path = raw.startsWith("/") ? raw : `/${raw}`
  return `${fallbackBase}${path}`.replace(/\/+$/, "")
}

export function buildImageGenerationEndpoint(endpointBase: string, fallbackBase: string) {
  const base = normalizeEndpointBase(endpointBase, fallbackBase)
  if (/\/images\/generations$/.test(base)) return base
  if (/\/v1$/.test(base)) return `${base}/images/generations`
  return `${base}/v1/images/generations`
}
