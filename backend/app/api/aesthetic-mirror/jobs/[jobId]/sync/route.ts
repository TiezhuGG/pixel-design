import { NextRequest, NextResponse } from "next/server"
import { getLocalUserScope } from "@/lib/local-user"
import { getAestheticMirrorJobForUser, updateAestheticMirrorJob } from "@/lib/aesthetic-mirror-job-store"
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
    const job = await getAestheticMirrorJobForUser(jobId, scope.userId)
    if (!job) {
      return NextResponse.json({ error: "浠诲姟涓嶅瓨鍦ㄦ垨鏃犳潈璁块棶" }, { status: 404 })
    }
    if (job.status !== "processing") {
      return NextResponse.json(job)
    }

    const providerMeta = job.provider_meta as {
      task_id?: unknown
      endpoint_base?: unknown
      source?: unknown
      model?: unknown
    } | null
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
      ? (await checkModelScopeImageTask({
          endpointBase,
          apiKey: credentials.apiKey,
          taskId,
        })).imageUrl
      : await pollApimartImageTask({
          endpointBase,
          apiKey: credentials.apiKey,
          taskId,
        })
    if (!imageUrl) {
      return NextResponse.json(job)
    }

    const completedAt = new Date().toISOString()
    const updated = await updateAestheticMirrorJob(job.id, (current) => ({
      ...current,
      status: "success",
      updated_at: completedAt,
      duration_ms: Math.max(0, Date.now() - Date.parse(current.created_at || completedAt)),
      result_url: imageUrl,
      result_data: {
        unit: null,
        count: "1",
        result: [imageUrl],
        status: 2,
        message: "",
        task_id: taskId,
      },
      provider_meta: {
        ...(current.provider_meta || {}),
        model: String(providerMeta?.model || current.payload.model || "").trim(),
        source: isModelScopeTask ? "modelscope" : String(providerMeta?.source || "apimart").trim(),
        provider_chain_tried: [isModelScopeTask ? "modelscope" : String(providerMeta?.source || "apimart").trim()],
        image_count: 1,
      },
    }))

    return NextResponse.json(updated || job)
  } catch (error: any) {
    console.error("[api/aesthetic-mirror/jobs/:jobId/sync] failed:", error)
    return NextResponse.json({ error: error?.message || "鍚屾浠诲姟缁撴灉澶辫触" }, { status: 500 })
  }
}
