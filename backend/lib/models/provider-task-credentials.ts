import { listEnvModelConfigs } from "@/lib/models/fetcher"
import { normalizeProviderModelId } from "@/lib/models/runtime-id"

export function resolveImageTaskCredentials(params: {
  source?: unknown
  model?: unknown
  endpointBase?: unknown
}) {
  const source = String(params.source || "").trim().toLowerCase()
  const model = normalizeProviderModelId(String(params.model || "").trim()).toLowerCase()
  const endpointBase = String(params.endpointBase || "").trim().toLowerCase()

  const matched = listEnvModelConfigs("IMAGE").find((config) => {
    const provider = config.provider || {}
    const providerKey = String(provider.key || config.providerId || "").trim().toLowerCase()
    const providerName = String(provider.name || "").trim().toLowerCase()
    const configModel = normalizeProviderModelId(String(config.modelId || "").trim()).toLowerCase()
    const configEndpoint = String(provider.imageEndpoint || provider.baseUrl || "").trim().toLowerCase()

    const sourceMatches =
      !source ||
      providerKey === source ||
      providerKey.includes(source) ||
      source.includes(providerKey) ||
      providerName.includes(source) ||
      source.includes(providerName)
    const modelMatches = !model || configModel === model
    const endpointMatches =
      !endpointBase ||
      configEndpoint.includes(endpointBase) ||
      endpointBase.includes(configEndpoint) ||
      (endpointBase.includes("api-inference.modelscope.") && configEndpoint.includes("api-inference.modelscope.")) ||
      (endpointBase.includes("api.apimart.ai") && configEndpoint.includes("api.apimart.ai"))

    return sourceMatches && modelMatches && endpointMatches
  })

  return {
    apiKey: String(
      matched?.provider?.apiKey ||
        matched?.provider?.api_key ||
        process.env.STUDIO_GENESIS_IMAGE_API_KEY ||
        process.env.OPENAI_API_KEY ||
        ""
    ).trim(),
    providerKey: String(matched?.provider?.key || matched?.providerId || source || "").trim(),
    modelId: String(matched?.modelId || params.model || "").trim(),
  }
}
