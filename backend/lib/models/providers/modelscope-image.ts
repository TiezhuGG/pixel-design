import { buildImageGenerationEndpoint, normalizeEndpointBase } from "@/lib/models/endpoint-url"
import { normalizeProviderModelId } from "@/lib/models/runtime-id"
import { normalizeModelImageInputUrl } from "@/lib/server/model-image-input"

export type ModelScopeImageGenerationOptions = Record<string, any>

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isModelScopeImageProvider(provider: any, baseUrl?: string) {
  const providerKey = String(provider?.key || provider?.providerKey || "").trim().toLowerCase()
  const providerName = String(provider?.name || "").trim().toLowerCase()
  const url = String(baseUrl || provider?.baseUrl || provider?.base_url || provider?.imageEndpoint || "").trim().toLowerCase()
  return providerKey.includes("modelscope") || providerName.includes("modelscope") || url.includes("api-inference.modelscope.")
}

function buildTaskEndpoint(endpointBase: string, taskId: string) {
  const base = normalizeEndpointBase(endpointBase, "https://api-inference.modelscope.cn/v1")
  const apiBase = base
    .replace(/\/v1\/images\/generations$/, "/v1")
    .replace(/\/images\/generations$/, "")
  return /\/v1$/.test(apiBase)
    ? `${apiBase}/tasks/${encodeURIComponent(taskId)}`
    : `${apiBase}/v1/tasks/${encodeURIComponent(taskId)}`
}

function extractErrors(payload: any) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : []
  const firstError = errors[0]
  if (typeof firstError === "string") return firstError.trim()
  return String(
    firstError?.message ||
      firstError?.detail ||
      firstError?.reason ||
      firstError?.code ||
      firstError?.field ||
      payload?.error?.message ||
      payload?.error?.code ||
      payload?.message ||
      payload?.msg ||
      ""
  ).trim()
}

function summarizeErrors(payload: any) {
  const rawErrors = payload?.errors
  if (!Array.isArray(rawErrors)) {
    if (rawErrors && typeof rawErrors === "object") {
      return [
        {
          type: "object",
          keys: Object.keys(rawErrors).slice(0, 20),
          value: JSON.stringify(rawErrors).slice(0, 500),
        },
      ]
    }
    return rawErrors ? [{ type: typeof rawErrors, value: String(rawErrors).slice(0, 500) }] : []
  }
  const errors = rawErrors
  return errors.slice(0, 3).map((error: any) => {
    if (typeof error === "string") return error
    if (!error || typeof error !== "object") return String(error || "")
    return {
      code: error.code || "",
      field: error.field || "",
      message: error.message || error.detail || error.reason || "",
    }
  })
}

function extractTaskId(payload: any) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : null
  return String(payload?.task_id || payload?.taskId || data?.task_id || data?.taskId || "").trim()
}

function extractUrlFromCandidate(candidate: any): string {
  if (!candidate) return ""
  if (typeof candidate === "string") return candidate.trim()
  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      const url = extractUrlFromCandidate(item)
      if (url) return url
    }
    return ""
  }
  if (typeof candidate !== "object") return ""

  const direct = String(
    candidate.url ||
      candidate.image_url ||
      candidate.imageUrl ||
      candidate.output_url ||
      candidate.outputUrl ||
      candidate.result_url ||
      candidate.resultUrl ||
      candidate.oss_url ||
      candidate.ossUrl ||
      ""
  ).trim()
  if (direct) return direct

  return (
    extractUrlFromCandidate(candidate.images) ||
    extractUrlFromCandidate(candidate.output_images) ||
    extractUrlFromCandidate(candidate.results) ||
    extractUrlFromCandidate(candidate.result) ||
    extractUrlFromCandidate(candidate.task_output) ||
    extractUrlFromCandidate(candidate.taskOutput)
  )
}

function extractImageUrl(payload: any) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : null
  const output = payload?.output && typeof payload.output === "object" ? payload.output : data?.output
  const outputs = payload?.outputs && typeof payload.outputs === "object" ? payload.outputs : data?.outputs || output

  const outputImages = Array.isArray(payload?.output_images)
    ? payload.output_images
    : Array.isArray(data?.output_images)
      ? data.output_images
      : Array.isArray(outputs?.output_images)
        ? outputs.output_images
        : Array.isArray(outputs?.images)
          ? outputs.images
      : []
  if (outputImages[0]) return String(outputImages[0]).trim()

  const nestedUrl =
    extractUrlFromCandidate(payload?.output) ||
    extractUrlFromCandidate(data?.output) ||
    extractUrlFromCandidate(payload?.results) ||
    extractUrlFromCandidate(data?.results)
  if (nestedUrl) return nestedUrl

  const images = Array.isArray(payload?.images) ? payload.images : Array.isArray(data?.images) ? data.images : []
  const firstImage = images[0]
  const firstImageUrl = String(firstImage?.url || firstImage?.image_url || firstImage || "").trim()
  if (firstImageUrl) return firstImageUrl

  return String(
    payload?.image_url ||
      payload?.imageUrl ||
      payload?.url ||
      data?.image_url ||
      data?.imageUrl ||
      data?.url ||
      outputs?.image_url ||
      outputs?.imageUrl ||
      outputs?.url ||
      outputs?.output_url ||
      outputs?.result_url ||
      ""
  ).trim()
}

function normalizeTaskStatus(payload: any) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : null
  return String(payload?.task_status || payload?.status || data?.task_status || data?.status || "").trim().toUpperCase()
}

function isCompletedStatus(status: string) {
  return ["SUCCEED", "SUCCESS", "COMPLETED", "COMPLETE", "DONE", "FINISHED"].includes(status)
}

function isFailedStatus(status: string) {
  return ["FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED"].includes(status)
}

function summarizePayload(payload: any) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : null
  const output = payload?.output && typeof payload.output === "object" ? payload.output : data?.output
  const outputs = payload?.outputs && typeof payload.outputs === "object" ? payload.outputs : data?.outputs || output
  return {
    keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 20) : [],
    dataKeys: data ? Object.keys(data).slice(0, 20) : [],
    outputKeys: outputs && typeof outputs === "object" ? Object.keys(outputs).slice(0, 20) : [],
    taskId: extractTaskId(payload),
    status: normalizeTaskStatus(payload),
    hasImageUrl: Boolean(extractImageUrl(payload)),
    outputImagesCount: Array.isArray(payload?.output_images)
      ? payload.output_images.length
      : Array.isArray(data?.output_images)
        ? data.output_images.length
        : Array.isArray(outputs?.output_images)
          ? outputs.output_images.length
          : Array.isArray(outputs?.images)
            ? outputs.images.length
        : 0,
    error: extractErrors(payload),
  }
}

async function normalizeImageUrlForModelScope(rawUrl: string, requestOrigin?: string) {
  const normalized = await normalizeModelImageInputUrl(rawUrl, requestOrigin)
  return String(normalized || rawUrl || "").trim()
}

function normalizeModelScopePrompt(prompt: string) {
  const maxLength = Math.max(200, Number(process.env.MODELSCOPE_IMAGE_PROMPT_MAX_LENGTH || 1900))
  const normalized = String(prompt || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
  if (normalized.length <= maxLength) return normalized

  const hardLimit = Math.max(1, maxLength - 80)
  const sliced = normalized.slice(0, hardLimit)
  const paragraphBoundary = Math.max(sliced.lastIndexOf("\n\n"), sliced.lastIndexOf("\n- "), sliced.lastIndexOf("\n"))
  const compact = paragraphBoundary > Math.floor(hardLimit * 0.72)
    ? sliced.slice(0, paragraphBoundary)
    : sliced

  return `${compact.trim()}\n\nKeep all reference product identity, layout intent, material fidelity, and commercial e-commerce quality.`
}

async function buildRequestBody(params: {
  modelId: string
  prompt: string
  options: ModelScopeImageGenerationOptions
}) {
  const referenceImages = Array.isArray(params.options?.referenceImages)
    ? params.options.referenceImages.map((item: any) => String(item || "").trim()).filter(Boolean)
    : []
  const imageUrl = await Promise.all(
    referenceImages.map((image) => normalizeImageUrlForModelScope(image, params.options?.requestOrigin))
  )

  const body: Record<string, unknown> = {
    model: normalizeProviderModelId(params.modelId),
    prompt: params.prompt,
  }
  if (imageUrl.length > 0) {
    body.image_url = imageUrl
  }

  return body
}

async function pollTask(params: {
  endpointBase: string
  apiKey: string
  taskId: string
}) {
  const startedAt = Date.now()
  const intervalMs = Number(process.env.MODELSCOPE_IMAGE_POLL_INTERVAL_MS || 5_000)
  const timeoutMs = Number(process.env.MODELSCOPE_IMAGE_POLL_TIMEOUT_MS || 600_000)

  while (Date.now() - startedAt < timeoutMs) {
    const result = await checkModelScopeImageTask(params)
    if (result.imageUrl) return result.imageUrl

    await sleep(intervalMs)
  }

  throw new Error(`ModelScope image task timeout: ${params.taskId}`)
}

export async function pollModelScopeImageTask(params: {
  endpointBase: string
  apiKey: string
  taskId: string
}) {
  return pollTask(params)
}

export async function checkModelScopeImageTask(params: {
  endpointBase: string
  apiKey: string
  taskId: string
}) {
  const taskEndpoint = buildTaskEndpoint(params.endpointBase, params.taskId)
  const response = await fetch(taskEndpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "X-ModelScope-Task-Type": "image_generation",
    },
  })
  const payload = await response.json().catch(() => ({}))
  const status = normalizeTaskStatus(payload)
  const imageUrl = extractImageUrl(payload)
  console.info("[modelscope-image] task response", {
    ok: response.ok,
    status: response.status,
    taskEndpoint,
    taskId: params.taskId,
    summary: summarizePayload(payload),
    pending: !imageUrl && !isFailedStatus(status),
  })

  if (!response.ok) {
    throw new Error(extractErrors(payload) || `ModelScope task query failed: HTTP ${response.status}`)
  }
  if (imageUrl && (!status || isCompletedStatus(status))) {
    return { imageUrl, pending: false, status }
  }
  if (isFailedStatus(status)) {
    throw new Error(extractErrors(payload) || "ModelScope image task failed")
  }

  return { imageUrl: "", pending: true, status }
}

export async function generateModelScopeImage(params: {
  prompt: string
  modelId: string
  apiKey: string
  endpointBase?: string
  options: ModelScopeImageGenerationOptions
  providerKey?: string
}) {
  if (!params.apiKey) throw new Error("未配置图片模型 API Key")

  const endpointBase = normalizeEndpointBase(params.endpointBase || "", "https://api-inference.modelscope.cn/v1")
  const endpoint = buildImageGenerationEndpoint(endpointBase, "https://api-inference.modelscope.cn/v1")
  const providerModelId = normalizeProviderModelId(params.modelId)
  const prompt = normalizeModelScopePrompt(params.prompt)
  const body = await buildRequestBody({
    modelId: providerModelId,
    prompt,
    options: params.options,
  })

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
      "X-ModelScope-Async-Mode": "true",
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  console.info("[modelscope-image] generation response", {
    ok: response.ok,
    status: response.status,
    endpoint,
    model: providerModelId,
    requestId: payload?.request_id || "",
    request: {
      hasImageUrl: Boolean((body as any).image_url),
      imageUrlIsArray: Array.isArray((body as any).image_url),
      imageUrlCount: Array.isArray((body as any).image_url) ? (body as any).image_url.length : (body as any).image_url ? 1 : 0,
      promptLength: prompt.length,
      originalPromptLength: params.prompt.length,
    },
    summary: summarizePayload(payload),
    errors: summarizeErrors(payload),
  })

  if (!response.ok) {
    const details = extractErrors(payload) || JSON.stringify(summarizeErrors(payload)).slice(0, 500)
    const requestId = String(payload?.request_id || "").trim()
    throw new Error(
      details
        ? `ModelScope image request failed: HTTP ${response.status}; request_id=${requestId || "unknown"}; ${details}`
        : `ModelScope image request failed: HTTP ${response.status}; request_id=${requestId || "unknown"}`
    )
  }

  const directImageUrl = extractImageUrl(payload)
  if (directImageUrl) {
    return {
      ...payload,
      imageUrl: directImageUrl,
      imageBase64: "",
      provider: "modelscope",
    }
  }

  const taskId = extractTaskId(payload)
  if (!taskId) {
    throw new Error("ModelScope 图片任务提交成功但未返回 task_id")
  }

  if (typeof params.options?.onTaskSubmitted === "function") {
    await Promise.resolve(
      params.options.onTaskSubmitted({
        taskId,
        endpointBase,
        modelId: providerModelId,
        provider: "modelscope",
      })
    )
  }

  return {
    ...payload,
    taskId,
    endpointBase,
    imageUrl: "",
    imageBase64: "",
    pendingTask: true,
    provider: "modelscope",
  }
}
