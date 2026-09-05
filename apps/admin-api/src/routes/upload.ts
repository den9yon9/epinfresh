import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'

import { ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { type AdminPlugins } from '../plugins'

// 上传目录(相对进程 cwd; 生产容器通过 volume 持久化)
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads'
const MAX_FILE_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export interface UploadResponse {
  url: string
}

export function createUploadRoutes(plugins: AdminPlugins) {
  return new Elysia({ name: 'upload-admin' })
    .use(plugins.dbPlugin)
    .use(plugins.sessionPlugin)
    .post(
      '/admin/upload',
      async ({ request }) => {
        const form = await request.formData()
        const file = form.get('file')
        if (!(file instanceof File)) {
          return status(400, { error: 'INVALID_FILE', message: 'Missing file field' })
        }
        if (!ALLOWED_MIME.has(file.type)) {
          return status(400, {
            error: 'UNSUPPORTED_TYPE',
            message: 'Only image/jpeg, image/png, image/webp allowed',
          })
        }
        if (file.size > MAX_FILE_BYTES) {
          return status(400, { error: 'FILE_TOO_LARGE', message: 'File exceeds 5MB limit' })
        }
        const ext = MIME_EXT[file.type] ?? 'bin'
        const name = `${randomUUID()}.${ext}`
        const dir = join(UPLOAD_DIR, 'images')
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()))
        return { url: `/uploads/images/${name}` }
      },
      {
        isAdmin: true,
        response: {
          200: t.Object({ url: t.String() }),
          400: ErrorResponse,
        },
        detail: {
          tags: ['Admin/Upload'],
          summary: '上传商品图片',
          description:
            'multipart/form-data 上传图片, 限制 image/jpeg|png|webp、5MB, 返回可访问的相对 URL。\n\n- 需要 admin 角色',
        },
      },
    )
    .get(
      '/uploads/images/:name',
      async ({ params }) => {
        // normalize 防路径穿越: 仅放行纯文件名
        const safe = normalize(params.name)
        if (safe.includes('..') || safe.includes(':')) {
          return status(404, { error: 'NOT_FOUND', message: 'Not found' })
        }
        try {
          const data = await readFile(join(UPLOAD_DIR, 'images', safe))
          return new Response(new Uint8Array(data), {
            headers: { 'Content-Type': 'image/*', 'Cache-Control': 'public, max-age=31536000' },
          })
        } catch {
          return status(404, { error: 'NOT_FOUND', message: 'Not found' })
        }
      },
      {
        params: t.Object({ name: t.String({ pattern: '^[a-zA-Z0-9-_.]+$' }) }),
        detail: {
          tags: ['Admin/Upload'],
          summary: '图片静态访问',
          description: '访问上传的图片文件(nginx 可直接接管 /uploads/ 前缀)。',
        },
      },
    )
}
