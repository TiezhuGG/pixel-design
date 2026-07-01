import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "PixelDesign",
  description: "AI电商图片生成平台",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
