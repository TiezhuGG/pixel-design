import { readFile } from "node:fs/promises"
import path from "node:path"

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
}

function isLoopbackHost(hostname: string) {
  const host = String(hostname || "").trim().toLowerCase()
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"
}

function hostFromUrl(value?: string) {
  try {
    return value ? new URL(value).hostname.toLowerCase() : ""
  } catch {
    return ""
  }
}

function decodeSafePathPart(part: string) {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

function resolveLocalUploadPath(rawUrl: string, requestOrigin?: string) {
  const input = String(rawUrl || "").trim()
  if (!input || input.startsWith("data:")) return null

  let pathname = ""
  let filename = ""
  const requestHost = hostFromUrl(requestOrigin)
  const publicHost = hostFromUrl(process.env.PUBLIC_BASE_URL)

  if (input.startsWith("/uploads/")) {
    pathname = input
  } else if (input.startsWith("uploads/")) {
    pathname = `/${input}`
  } else if (input.startsWith("/api/upload")) {
    try {
      filename = new URL(input, requestOrigin || "http://localhost").searchParams.get("file") || ""
    } catch {
      return null
    }
  } else if (/^https?:\/\//i.test(input)) {
    let parsed: URL
    try {
      parsed = new URL(input)
    } catch {
      return null
    }
    const host = parsed.hostname.toLowerCase()
    const isKnownLocalUploadHost =
      isLoopbackHost(host) ||
      (requestHost && host === requestHost) ||
      (publicHost && host === publicHost)

    if (!isKnownLocalUploadHost) return null
    if (parsed.pathname.startsWith("/uploads/")) {
      pathname = parsed.pathname
    } else if (parsed.pathname === "/api/upload") {
      filename = parsed.searchParams.get("file") || ""
    } else {
      return null
    }
  } else {
    return null
  }

  const relative = filename || pathname.replace(/^\/uploads\/?/, "").split("?")[0].split("#")[0]
  const safeParts = relative
    .split("/")
    .map((part) => decodeSafePathPart(part).trim())
    .filter((part) => part && part !== "." && part !== ".." && !part.includes("/") && !part.includes("\\"))

  if (safeParts.length === 0) return null

  const uploadDir = path.resolve(process.cwd(), process.env.STUDIO_GENESIS_UPLOAD_DIR || "uploads")
  const filePath = path.resolve(uploadDir, ...safeParts)
  if (!filePath.startsWith(`${uploadDir}${path.sep}`)) return null
  return filePath
}

export async function normalizeModelImageInputUrl(rawUrl: string, requestOrigin?: string) {
  const input = String(rawUrl || "").trim()
  if (!input) return ""
  if (input.startsWith("data:")) return input

  const localPath = resolveLocalUploadPath(input, requestOrigin)
  if (!localPath) return input

  const file = await readFile(localPath)
  const mimeType = IMAGE_CONTENT_TYPES[path.extname(localPath).toLowerCase()] || "image/png"
  return `data:${mimeType};base64,${file.toString("base64")}`
}

export async function normalizeModelImageInputUrls(
  images: string[],
  options?: {
    requestOrigin?: string
    max?: number
  }
) {
  const seen = new Set<string>()
  const input = (Array.isArray(images) ? images : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)

  const output: string[] = []
  for (const image of input) {
    const normalized = await normalizeModelImageInputUrl(image, options?.requestOrigin)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
    if (options?.max && output.length >= options.max) break
  }
  return output
}

export function summarizeModelImageInputs(images: string[]) {
  const values = Array.isArray(images) ? images : []
  return {
    count: values.length,
    dataUrls: values.filter((item) => String(item || "").startsWith("data:")).length,
    remoteUrls: values.filter((item) => /^https?:\/\//i.test(String(item || ""))).length,
  }
}
