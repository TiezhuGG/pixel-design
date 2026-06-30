import { normalizeProviderModelId } from "@/lib/models/runtime-id"
import { buildImageGenerationEndpoint as buildProviderImageGenerationEndpoint, normalizeEndpointBase } from "@/lib/models/endpoint-url"

export type ApimartImageGenerationOptions = Record<string, any>

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isApimartImageProvider(provider: any, baseUrl?: string) {
  const providerKey = String(provider?.key || provider?.providerKey || "").trim().toLowerCase()
  const providerName = String(provider?.name || "").trim().toLowerCase()
  const url = String(baseUrl || provider?.baseUrl || provider?.base_url || provider?.imageEndpoint || "").trim()
  if (providerKey.includes("apimart") || providerName.includes("apimart")) return true
  try {
    return new URL(url).hostname.toLowerCase().includes("api.apimart.ai")
  } catch {
    return url.toLowerCase().includes("api.apimart.ai")
  }
}

export function getApimartImageModelKind(modelId: string) {
  const normalized = normalizeProviderModelId(modelId).toLowerCase()
  if (normalized === "gpt-image-2") return "gpt-image-2"
  if (normalized === "gemini-3-pro-image-preview" || normalized === "gemini-3-pro-image-preview-official") {
    return "gemini-3-pro-image-preview"
  }
  if (normalized === "gemini-3.1-flash-image-preview" || normalized === "gemini-3.1-flash-image-preview-official") {
    return "gemini-3.1-flash-image-preview"
  }
  return ""
}

function buildImageGenerationEndpoint(endpointBase: string) {
  return buildProviderImageGenerationEndpoint(endpointBase, "https://api.apimart.ai")
}

function buildTaskEndpoint(endpointBase: string, taskId: string) {
  const base = normalizeEndpointBase(endpointBase, "https://api.apimart.ai")
  const apiBase = base
    .replace(/\/v1\/images\/generations$/, "/v1")
    .replace(/\/images\/generations$/, "")
  return /\/v1$/.test(apiBase)
    ? `${apiBase}/tasks/${encodeURIComponent(taskId)}`
    : `${apiBase}/v1/tasks/${encodeURIComponent(taskId)}`
}

function normalizeSize(options: ApimartImageGenerationOptions) {
  const aspectRatio = String(options?.aspectRatio || "").trim()
  if (aspectRatio) return aspectRatio
  const size = String(options?.size || "").trim()
  if (size && size !== "1024x1024") return size
  return "1:1"
}

function normalizeResolution(options: ApimartImageGenerationOptions, uppercase: boolean, allowHalfK = false) {
  const raw = String(options?.resolution || options?.imageSize || "").trim().toLowerCase()
  if (allowHalfK && (raw === "0.5k" || raw === ".5k" || raw === "512" || raw === "512px")) {
    return uppercase ? "0.5K" : "0.5k"
  }
  const value = raw === "4k" ? "4k" : raw === "2k" ? "2k" : "1k"
  return uppercase ? value.toUpperCase() : value
}

function normalizeReferenceImages(options: ApimartImageGenerationOptions, max: number) {
  return (Array.isArray(options?.referenceImages) ? options.referenceImages : [])
    .map((item: any) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, max)
}

function extractImageUrl(payload: any) {
  const body = payload?.data && !Array.isArray(payload.data) ? payload.data : payload
  const imageUrl = String(body?.imageUrl || body?.url || "").trim()
  if (imageUrl) return imageUrl

  const outputUrl = String(body?.output || body?.result_url || body?.image_url || body?.oss_url || "").trim()
  if (/^https?:\/\//i.test(outputUrl) || outputUrl.startsWith("data:image/")) return outputUrl

  const directImageUrls = Array.isArray(body?.image_urls) ? body.image_urls : []
  if (directImageUrls[0]) return String(directImageUrls[0]).trim()

  const resultUrls = Array.isArray(body?.result) ? body.result : []
  const firstResultUrl = String(resultUrls[0]?.url || resultUrls[0]?.imageUrl || resultUrls[0] || "").trim()
  if (firstResultUrl) return firstResultUrl

  const dataImages = Array.isArray(body?.result?.images) ? body.result.images : []
  const firstUrl = dataImages[0]?.url
  if (Array.isArray(firstUrl) && firstUrl[0]) return String(firstUrl[0]).trim()
  if (typeof firstUrl === "string") return firstUrl.trim()

  const dataList = Array.isArray(payload?.data) ? payload.data : []
  const first = dataList[0]
  const firstDirectUrl = String(first?.url || "").trim()
  if (firstDirectUrl) return firstDirectUrl
  const firstImageUrls = Array.isArray(first?.image_urls) ? first.image_urls : []
  return firstImageUrls[0] ? String(firstImageUrls[0]).trim() : ""
}

function summarizeImagePayload(payload: any) {
  const data = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : []
  const first = data[0]
  const body = payload?.data && !Array.isArray(payload.data) ? payload.data : payload
  return {
    keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 20) : [],
    bodyKeys: body && typeof body === "object" ? Object.keys(body).slice(0, 20) : [],
    dataCount: data.length,
    firstKeys: first && typeof first === "object" ? Object.keys(first).slice(0, 20) : [],
    status: body?.status || payload?.status || "",
    hasImageUrl: Boolean(body?.imageUrl || body?.url || first?.url),
    imageUrlsCount: Array.isArray(body?.image_urls) ? body.image_urls.length : 0,
    taskId: payload?.task_id || payload?.taskId || first?.task_id || first?.taskId || "",
  }
}

function extractTaskId(payload: any) {
  const data = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : []
  return String(payload?.task_id || payload?.taskId || data[0]?.task_id || data[0]?.taskId || "").trim()
}

function isCompletedStatus(status: string) {
  return ["completed", "complete", "success", "succeeded", "done", "finished"].includes(status)
}

function isFailedStatus(status: string) {
  return ["failed", "fail", "error", "cancelled", "canceled"].includes(status)
}

async function pollTask(params: {
  endpointBase: string
  apiKey: string
  taskId: string
}) {
  const startedAt = Date.now()
  const initialDelayMs = Number(process.env.APIMART_IMAGE_INITIAL_POLL_DELAY_MS || 10_000)
  const intervalMs = Number(process.env.APIMART_IMAGE_POLL_INTERVAL_MS || 4_000)
  const timeoutMs = Number(process.env.APIMART_IMAGE_POLL_TIMEOUT_MS || 180_000)
  const taskEndpoint = buildTaskEndpoint(params.endpointBase, params.taskId)

  if (initialDelayMs > 0) await sleep(initialDelayMs)

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(taskEndpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
      },
    })
    const payload = await response.json().catch(() => ({}))
    console.info("[apimart-image] task response", {
      ok: response.ok,
      status: response.status,
      taskEndpoint,
      taskId: params.taskId,
      summary: summarizeImagePayload(payload),
    })
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `APIMart task query failed: HTTP ${response.status}`)
    }

    const body = payload?.data && typeof payload.data === "object" ? payload.data : payload
    const status = String(body?.status || "").trim().toLowerCase()
    const imageUrl = extractImageUrl(payload)
    if (imageUrl && (!status || isCompletedStatus(status))) return imageUrl
    if (isFailedStatus(status)) {
      throw new Error(body?.error?.message || payload?.error?.message || "APIMart image task failed")
    }
    await sleep(intervalMs)
  }

  throw new Error(`APIMart image task timeout: ${params.taskId}`)
}

export async function pollApimartImageTask(params: {
  endpointBase: string
  apiKey: string
  taskId: string
}) {
  return pollTask(params)
}

function buildGptImage2Body(modelId: string, prompt: string, options: ApimartImageGenerationOptions) {
  const referenceImages = normalizeReferenceImages(options, 16)
  const providerModelId = normalizeProviderModelId(modelId)
  return {
    model: providerModelId,
    prompt,
    n: 1,
    size: normalizeSize(options),
    resolution: normalizeResolution(options, false),
    ...(referenceImages.length > 0 ? { image_urls: referenceImages } : {}),
    ...(typeof options?.officialFallback === "boolean" ? { official_fallback: options.officialFallback } : {}),
  }
}

function buildGeminiImageBody(modelId: string, prompt: string, options: ApimartImageGenerationOptions) {
  const referenceImages = normalizeReferenceImages(options, 14)
  const providerModelId = normalizeProviderModelId(modelId)
  return {
    model: providerModelId,
    prompt,
    n: 1,
    size: normalizeSize(options),
    resolution: normalizeResolution(options, true),
    ...(referenceImages.length > 0 ? { image_urls: referenceImages } : {}),
    ...(
      providerModelId === "gemini-3-pro-image-preview-official"
        ? {}
        : typeof options?.officialFallback === "boolean"
          ? { official_fallback: options.officialFallback }
          : {}
    ),
  }
}

function buildGeminiFlashImageBody(modelId: string, prompt: string, options: ApimartImageGenerationOptions) {
  const referenceImages = normalizeReferenceImages(options, 14)
  const googleSearch = Boolean(options?.googleSearch || options?.google_search)
  const googleImageSearch = Boolean(options?.googleImageSearch || options?.google_image_search)
  const providerModelId = normalizeProviderModelId(modelId)
  return {
    model: providerModelId,
    prompt,
    n: 1,
    size: normalizeSize(options),
    resolution: normalizeResolution(options, true, true),
    ...(referenceImages.length > 0 ? { image_urls: referenceImages } : {}),
    ...(
      providerModelId === "gemini-3.1-flash-image-preview-official"
        ? {}
        : typeof options?.officialFallback === "boolean"
          ? { official_fallback: options.officialFallback }
          : {}
    ),
    ...(googleSearch ? { google_search: true } : {}),
    ...(googleImageSearch ? { google_search: true, google_image_search: true } : {}),
  }
}

export async function generateApimartImage(params: {
  prompt: string
  modelId: string
  apiKey: string
  endpointBase?: string
  options: ApimartImageGenerationOptions
  providerKey?: string
}) {
  const providerModelId = normalizeProviderModelId(params.modelId)
  const modelKind = getApimartImageModelKind(providerModelId)
  if (!modelKind) {
    throw new Error(`APIMart image model not supported: ${params.modelId}`)
  }
  if (!params.apiKey) throw new Error("未配置图片模型 API Key")

  const endpointBase = String(params.endpointBase || "https://api.apimart.ai").trim()
  const endpoint = buildImageGenerationEndpoint(endpointBase)
  const body =
    modelKind === "gpt-image-2"
      ? buildGptImage2Body(providerModelId, params.prompt, params.options)
      : modelKind === "gemini-3.1-flash-image-preview"
        ? buildGeminiFlashImageBody(providerModelId, params.prompt, params.options)
        : buildGeminiImageBody(providerModelId, params.prompt, params.options)

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
    })
  } catch (error: any) {
    const cause = String(error?.cause?.message || error?.cause || "").trim()
    const message = cause || String(error?.message || "fetch failed").trim()
    console.error("[apimart-image] fetch failed", {
      endpoint,
      model: providerModelId,
      message: error?.message,
      cause: cause || null,
    })
    throw new Error(`APIMart image request failed before response: ${message}`)
  }
  const payload = await response.json().catch(() => ({}))
  console.info("[apimart-image] generation response", {
    ok: response.ok,
    status: response.status,
    endpoint,
    model: providerModelId,
    summary: summarizeImagePayload(payload),
  })
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `APIMart image request failed: HTTP ${response.status}`)
  }

  const directImageUrl = extractImageUrl(payload)
  if (directImageUrl) {
    return {
      ...payload,
      imageUrl: directImageUrl,
      imageBase64: "",
      provider: params.providerKey || "apimart",
    }
  }

  const taskId = extractTaskId(payload)
  if (!taskId) {
    throw new Error("APIMart 图片任务提交成功但未返回 task_id")
  }

  if (typeof params.options?.onTaskSubmitted === "function") {
    await Promise.resolve(
      params.options.onTaskSubmitted({
        taskId,
        endpointBase,
        modelId: providerModelId,
        provider: params.providerKey || "apimart",
      })
    )
  }

  const imageUrl = await pollTask({
    endpointBase,
    apiKey: params.apiKey,
    taskId,
  })

  return {
    ...payload,
    taskId,
    imageUrl,
    imageBase64: "",
    provider: params.providerKey || "apimart",
  }
}
