// 依存ゼロの静的サーバ。node server.mjs で http://localhost:5310

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = import.meta.dirname
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.hdr': 'application/octet-stream',
  '.bin': 'application/octet-stream',
}

// URL パスを実ファイルへ解決する
function resolve(urlPath) {
  const p = normalize(decodeURIComponent(urlPath.split('?')[0]))
  if (p.includes('..')) return null
  return join(ROOT, p === '/' ? '/index.html' : p)
}

const PORT = Number(process.env.PORT ?? 5310)

createServer(async (req, res) => {
  const file = resolve(req.url)
  if (!file) { res.writeHead(400).end('bad path'); return }
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`))
