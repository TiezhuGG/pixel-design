import { NextRequest, NextResponse } from "next/server"
import { getLocalUserScope } from "@/lib/local-user"
import { getStudioGenesisAnalysisJob, completeStudioGenesisImageJob } from "@/lib/studio-genesis-analysis-jobs"
import { pollApimartImageTask } from "@/lib/models/providers/apimart-image"
import { pollModelScopeImageTask } from "@/lib/models/providers/modelscope-image"

export const dynamic = "force-dynamic"

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const scope = await getLocalUserScope()
    const { jobId } = await context.params
    const job = getStudioGenesisAnalysisJob(jobId, scope.userId)
    if (!job) {
      return NextResponse.json({ error: "任务不存在或无权访问" }, { status: 404 })
    }
    if (job.type !== "IMAGE_GEN") {
      return NextResponse.json({ error: "只支持同步图片生成任务" }, { status: 400 })
    }
    if (job.status !== "processing") {
      return NextResponse.json(job)
    }

    const providerMeta = job.provider_meta as { task_id?: unknown; endpoint_base?: unknown; source?: unknown; model?: unknown } | null
    const taskId = String(providerMeta?.task_id || "").trim()
    if (!taskId) {
      return NextResponse.json(job)
    }

    const apiKey = String(process.env.STUDIO_GENESIS_IMAGE_API_KEY || process.env.OPENAI_API_KEY || "").trim()
    if (!apiKey) {
      return NextResponse.json({ error: "未配置图片模型 API Key" }, { status: 500 })
    }

    const source = String(providerMeta?.source || "").trim().toLowerCase()
    const metaEndpointBase = String(providerMeta?.endpoint_base || "").trim()
    const isModelScopeTask = source.includes("modelscope") || metaEndpointBase.toLowerCase().includes("api-inference.modelscope.")
    const endpointBase = String(
      metaEndpointBase ||
        process.env.STUDIO_GENESIS_IMAGE_ENDPOINT ||
        (isModelScopeTask ? "https://api-inference.modelscope.cn/v1" : "https://api.apimart.ai")
    ).trim()
    const imageUrl = isModelScopeTask
      ? await pollModelScopeImageTask({
          endpointBase,
          apiKey,
          taskId,
        })
      : await pollApimartImageTask({
          endpointBase,
          apiKey,
          taskId,
        })

    completeStudioGenesisImageJob({
      jobId: job.id,
      resultUrl: imageUrl,
      prompt: job.payload.prompt,
      modelId: String(providerMeta?.model || job.payload.model || "").trim(),
      provider: isModelScopeTask ? "modelscope" : String(providerMeta?.source || "apimart").trim(),
    })

    const updated = getStudioGenesisAnalysisJob(job.id, scope.userId)
    return NextResponse.json(updated || job)
  } catch (error: any) {
    console.error("[api/studio-genesis/jobs/:jobId/sync] failed:", error)
    return NextResponse.json({ error: error?.message || "同步任务结果失败" }, { status: 500 })
  }
}
