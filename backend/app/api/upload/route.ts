import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"])
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
}

function getUploadDir() {
  return path.resolve(process.cwd(), process.env.STUDIO_GENESIS_UPLOAD_DIR || "uploads")
}

function resolveUploadPath(filename: string) {
  const uploadDir = getUploadDir()
  const absolutePath = path.resolve(uploadDir, filename)
  const normalizedUploadDir = uploadDir.toLowerCase()
  const normalizedPath = absolutePath.toLowerCase()
  const isInsideUploadDir =
    normalizedPath === normalizedUploadDir || normalizedPath.startsWith(`${normalizedUploadDir}${path.sep}`)

  if (!isInsideUploadDir) return null
  return absolutePath
}

function extensionForType(type: string) {
  if (type === "image/png") return ".png"
  if (type === "image/webp") return ".webp"
  if (type === "image/gif") return ".gif"
  if (type === "image/avif") return ".avif"
  return ".jpg"
}

export async function GET(request: NextRequest) {
  try {
    const filename = request.nextUrl.searchParams.get("file") || ""
    const filePath = resolveUploadPath(filename)
    if (!filename || !filePath) {
      return NextResponse.json({ error: "Invalid upload path" }, { status: 400 })
    }

    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    const body = await readFile(filePath)
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream"

    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileStat.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }
    console.error("[api/upload] read failed:", error)
    return NextResponse.json({ error: error?.message || "读取上传图片失败" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少上传文件" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "仅支持 JPG、PNG、WebP、GIF 或 AVIF 图片" }, { status: 400 })
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "图片不能超过 12MB" }, { status: 400 })
    }

    const uploadDir = getUploadDir()
    await mkdir(uploadDir, { recursive: true })

    const filename = `${randomUUID()}${extensionForType(file.type)}`
    const absolutePath = path.join(uploadDir, filename)
    const bytes = Buffer.from(await file.arrayBuffer())
    await writeFile(absolutePath, bytes)

    const url = `/api/upload?file=${encodeURIComponent(filename)}`
    return NextResponse.json({ url, localUrl: url })
  } catch (error: any) {
    console.error("[api/upload] failed:", error)
    return NextResponse.json({ error: error?.message || "上传失败" }, { status: 500 })
  }
}
