import {
  generateApimartImage,
  getApimartImageModelKind,
  isApimartImageProvider,
} from "@/lib/models/providers/apimart-image"
import {
  generateModelScopeImage,
  isModelScopeImageProvider,
} from "@/lib/models/providers/modelscope-image"
import { buildImageGenerationEndpoint, normalizeEndpointBase } from "@/lib/models/endpoint-url"
import { normalizeProviderModelId } from "@/lib/models/runtime-id"
import { normalizeModelImageInputUrl } from "@/lib/server/model-image-input"
import { parseDataUri } from "@/lib/utils"

function normalizeReferenceImages(options: Record<string, any>) {
  return Array.isArray(options?.referenceImages)
    ? options.referenceImages.map((item: any) => String(item || "").trim()).filter(Boolean)
    : []
}

function isOfficialGoogleGeminiEndpoint(provider: any, baseUrl: string, modelId: string) {
  const providerKey = String(provider?.key || provider?.providerKey || provider?.name || "").trim().toLowerCase()
  const normalizedBaseUrl = String(baseUrl || "").trim().toLowerCase()
  const normalizedModel = normalizeProviderModelId(modelId).toLowerCase()
  const isThirdParty = Boolean(provider?.isThirdParty)
  if (!normalizedModel.startsWith("gemini-")) return false
  if (normalizedBaseUrl.includes("generativelanguage.googleapis.com") || normalizedBaseUrl.includes(".googleapis.com")) {
    return true
  }
  if (isThirdParty) return false
  return providerKey.includes("google") || providerKey.includes("gemini")
}

function extractGeminiImageBase64(payload: any) {
  const parts = payload?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ""
  for (const part of parts) {
    const inlineData = part?.inlineData || part?.inline_data
    const data = String(inlineData?.data || "").trim()
    if (data) return data
  }
  return ""
}

async function generateOfficialGoogleGeminiImage(params: {
  prompt: string
  modelId: string
  provider: any
  apiKey: string
  baseUrl: string
  options: Record<string, any>
}) {
  const normalizedBaseUrl = normalizeEndpointBase(params.baseUrl, "https://generativelanguage.googleapis.com")
    .replace(/\/images\/generations$/, "")
    .replace(/\/v1$/, "")
    .replace(/\/v1beta$/, "")
  const endpointUrl = new URL(`${normalizedBaseUrl}/v1beta/models/${encodeURIComponent(normalizeProviderModelId(params.modelId))}:generateContent`)
  endpointUrl.searchParams.set("key", params.apiKey)

  const parts: Array<Record<string, unknown>> = [{ text: params.prompt }]
  for (const image of normalizeReferenceImages(params.options)) {
    const modelInput = await normalizeModelImageInputUrl(image, params.options?.requestOrigin)
    const parsed = parseDataUri(modelInput)
    if (!parsed?.base64Data) continue
    parts.push({
      inlineData: {
        mimeType: parsed.mime || "image/png",
        data: parsed.base64Data,
      },
    })
  }

  const body = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  }

  let response: Response
  try {
    response = await fetch(endpointUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch (error: any) {
    const cause = String(error?.cause?.message || error?.cause || "").trim()
    const message = cause || String(error?.message || "fetch failed").trim()
    console.error("[models/router] official gemini fetch failed", {
      endpoint: endpointUrl.toString().replace(/key=[^&]+/, "key=<redacted>"),
      model: normalizeProviderModelId(params.modelId),
      message: error?.message,
      cause: cause || null,
    })
    throw new Error(`无法连接 Google Gemini 生图接口：${message}。请确认当前后端机器可访问 generativelanguage.googleapis.com，或改用可访问的 OpenAI-compatible/APIMart/ModelScope 生图服务。`)
  }

  const payload = await response.json().catch(() => ({}))
  const imageBase64 = extractGeminiImageBase64(payload)
  console.info("[models/router] official gemini image response", {
    ok: response.ok,
    status: response.status,
    endpoint: endpointUrl.toString().replace(/key=[^&]+/, "key=<redacted>"),
    model: normalizeProviderModelId(params.modelId),
    hasImageBase64: Boolean(imageBase64),
    keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 20) : [],
  })

  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Google Gemini image request failed: HTTP ${response.status}`)
  }

  return {
    ...payload,
    imageBase64,
    imageUrl: "",
    provider: params.provider?.key || "google-gemini",
  }
}

function summarizeImagePayload(payload: any) {
  const data = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : []
  const first = data[0]
  return {
    keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 20) : [],
    dataCount: data.length,
    firstKeys: first && typeof first === "object" ? Object.keys(first).slice(0, 20) : [],
    hasImageUrl: Boolean(payload?.imageUrl || payload?.url || first?.url),
    hasB64: Boolean(payload?.imageBase64 || first?.b64_json),
    imageUrlsCount: Array.isArray(payload?.image_urls) ? payload.image_urls.length : 0,
  }
}

async function generateOpenAICompatibleImage(params: {
  prompt: string
  modelId: string
  provider: any
  apiKey: string
  endpointBase: string
  options: Record<string, any>
}) {
  const endpoint = buildImageGenerationEndpoint(params.endpointBase, "https://api.openai.com/v1")
  const referenceImages = normalizeReferenceImages(params.options)
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: normalizeProviderModelId(params.modelId),
      prompt: params.prompt,
      n: 1,
      size: String(params.options?.imageSize || params.options?.size || "1024x1024"),
      response_format: "url",
      reference_images: referenceImages,
      image_urls: referenceImages,
      aspect_ratio: params.options?.aspectRatio,
      quality: params.options?.quality,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  console.info("[models/router] image response", {
    ok: response.ok,
    status: response.status,
    endpoint,
    model: normalizeProviderModelId(params.modelId),
    summary: summarizeImagePayload(payload),
  })
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Image model request failed: HTTP ${response.status}`)
  }
  const first = Array.isArray(payload?.data) ? payload.data[0] : null
  const dataObject = payload?.data && !Array.isArray(payload.data) ? payload.data : null
  return {
    ...payload,
    imageUrl:
      payload?.imageUrl ||
      payload?.url ||
      first?.url ||
      dataObject?.imageUrl ||
      dataObject?.url ||
      dataObject?.image_urls?.[0] ||
      payload?.data?.image_urls?.[0] ||
      payload?.image_urls?.[0] ||
      "",
    imageBase64: payload?.imageBase64 || first?.b64_json || dataObject?.b64_json || dataObject?.imageBase64 || "",
    provider: params.provider?.key || "env",
  }
}

function resolveImageRuntime(provider: any) {
  const apiKey = String(provider?.apiKey || provider?.api_key || process.env.STUDIO_GENESIS_IMAGE_API_KEY || process.env.OPENAI_API_KEY || "").trim()
  const explicitEndpoint = String(provider?.imageEndpoint || process.env.STUDIO_GENESIS_IMAGE_ENDPOINT || "").trim()
  const defaultBaseUrl = isApimartImageProvider(provider, provider?.baseUrl || provider?.base_url || explicitEndpoint)
    ? "https://api.apimart.ai"
    : "https://api.openai.com/v1"
  const baseUrl = normalizeEndpointBase(
    String(provider?.baseUrl || process.env.STUDIO_GENESIS_IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || ""),
    defaultBaseUrl
  )
  return {
    apiKey,
    endpointBase: explicitEndpoint ? normalizeEndpointBase(explicitEndpoint, baseUrl) : baseUrl,
    baseUrl,
  }
}

export const modelRouter = {
  async generateWithDbCredentials(
    prompt: string,
    modelId: string,
    provider: any,
    options: Record<string, any>,
    _type?: string
  ) {
    const runtime = resolveImageRuntime(provider)
    if (!runtime.apiKey) throw new Error("未配置图片模型 API Key")

    const providerModelId = normalizeProviderModelId(modelId)

    if (isOfficialGoogleGeminiEndpoint(provider, runtime.baseUrl, providerModelId)) {
      console.info("[models/router] route image generation", {
        route: "official-google-gemini",
        model: providerModelId,
        baseUrl: runtime.baseUrl,
        providerKey: provider?.key || provider?.providerKey || "",
      })
      return generateOfficialGoogleGeminiImage({
        prompt,
        modelId: providerModelId,
        provider,
        apiKey: runtime.apiKey,
        baseUrl: runtime.baseUrl,
        options,
      })
    }

    if (isModelScopeImageProvider(provider, runtime.endpointBase)) {
      console.info("[models/router] route image generation", {
        route: "modelscope",
        model: providerModelId,
        endpointBase: runtime.endpointBase,
        providerKey: provider?.key || provider?.providerKey || "",
      })
      return generateModelScopeImage({
        prompt,
        modelId: providerModelId,
        apiKey: runtime.apiKey,
        endpointBase: runtime.endpointBase,
        options,
        providerKey: provider?.key || "modelscope",
      })
    }

    if (isApimartImageProvider(provider, runtime.endpointBase) && getApimartImageModelKind(providerModelId)) {
      console.info("[models/router] route image generation", {
        route: "apimart",
        model: providerModelId,
        endpointBase: runtime.endpointBase,
        providerKey: provider?.key || provider?.providerKey || "",
      })
      return generateApimartImage({
        prompt,
        modelId: providerModelId,
        apiKey: runtime.apiKey,
        endpointBase: runtime.endpointBase,
        options,
        providerKey: provider?.key || "apimart",
      })
    }

    console.info("[models/router] route image generation", {
      route: "openai-compatible",
      model: providerModelId,
      endpointBase: runtime.endpointBase,
      providerKey: provider?.key || provider?.providerKey || "",
    })
    return generateOpenAICompatibleImage({
      prompt,
      modelId: providerModelId,
      provider,
      apiKey: runtime.apiKey,
      endpointBase: runtime.endpointBase,
      options,
    })
  },
  async generate(prompt: string, modelId: string, options: Record<string, any>) {
    return this.generateWithDbCredentials(prompt, modelId, {}, options)
  },
  getProvider(_providerKey: string) {
    return {
      editImage: async (imageUrls: string[], prompt: string, modelId: string, options: Record<string, any>) => {
        const result = await this.generateWithDbCredentials(prompt, modelId, {}, {
          ...options,
          referenceImages: imageUrls,
        })
        return result?.imageUrl || result?.url || ""
      },
    }
  },
}
