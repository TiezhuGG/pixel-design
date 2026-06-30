import { NextRequest, NextResponse } from "next/server"
import { getLocalUserScope } from "@/lib/local-user"
import { completeClothingStudioImageProviderTask, getClothingStudioJob } from "@/lib/clothing-studio-jobs"
import { pollApimartImageTask } from "@/lib/models/providers/apimart-image"
import { checkModelScopeImageTask } from "@/lib/models/providers/modelscope-image"
import { resolveImageTaskCredentials } from "@/lib/models/provider-task-credentials"

export const dynamic = "force-dynamic"

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const scope = await getLocalUserScope()
    const { jobId } = await context.params
    const job = getClothingStudioJob(jobId, scope.userId)
    if (!job) {
      return NextResponse.json({ error: "浠诲姟涓嶅瓨鍦ㄦ垨鏃犳潈璁块棶" }, { status: 404 })
    }
    if (job.type !== "IMAGE_GEN" || job.status !== "processing") {
      return NextResponse.json(job)
    }

    const providerMeta = job.provider_meta as { task_id?: unknown; endpoint_base?: unknown; source?: unknown; model?: unknown } | null
    const taskId = String(providerMeta?.task_id || "").trim()
    if (!taskId) {
      return NextResponse.json(job)
    }

    const source = String(providerMeta?.source || "").trim().toLowerCase()
    const metaEndpointBase = String(providerMeta?.endpoint_base || "").trim()
    const isModelScopeTask = source.includes("modelscope") || metaEndpointBase.toLowerCase().includes("api-inference.modelscope.")
    const endpointBase = String(
      metaEndpointBase ||
        process.env.STUDIO_GENESIS_IMAGE_ENDPOINT ||
        (isModelScopeTask ? "https://api-inference.modelscope.cn/v1" : "https://api.apimart.ai")
    ).trim()
    const credentials = resolveImageTaskCredentials({
      source: providerMeta?.source,
      model: providerMeta?.model || job.payload.model,
      endpointBase,
    })
    if (!credentials.apiKey) {
      return NextResponse.json({ error: "鏈厤缃浘鐗囨ā鍨?API Key" }, { status: 500 })
    }

    const imageUrl = isModelScopeTask
      ? (await checkModelScopeImageTask({ endpointBase, apiKey: credentials.apiKey, taskId })).imageUrl
      : await pollApimartImageTask({ endpointBase, apiKey: credentials.apiKey, taskId })
    if (!imageUrl) {
      return NextResponse.json(job)
    }

    const updated = await completeClothingStudioImageProviderTask({
      jobId: job.id,
      resultUrl: imageUrl,
      modelId: String(providerMeta?.model || job.payload.model || "").trim(),
      provider: isModelScopeTask ? "modelscope" : String(providerMeta?.source || "apimart").trim(),
    })

    return NextResponse.json(updated || job)
  } catch (error: any) {
    console.error("[api/clothing-studio/jobs/:jobId/sync] failed:", error)
    return NextResponse.json({ error: error?.message || "鍚屾浠诲姟缁撴灉澶辫触" }, { status: 500 })
  }
}
