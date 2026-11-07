// 手早く撮る: node shot.mjs [w] [h] [name] [script]
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium } from 'playwright'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
import { spawn } from 'node:child_process'
const PORT = 5431
const srv = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const [w = 390, h = 844, name = 'quick'] = process.argv.slice(2)
const b = await chromium.launch(MUTE_LAUNCH), ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: +w, height: +h } }); await muteContext(ctx); const p = await ctx.newPage()
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__biReady, null, { timeout: 10000 }).catch(e => { console.log("NOT READY", errs); })
await p.waitForFunction(() => window.BI.charsReady, null, { timeout: 10000 }).catch(() => errs.push('chars timeout'))
await p.waitForTimeout(800)
await p.screenshot({ path: `shots/${name}-title.png` })
await p.evaluate(() => { BI.dbg.start(3) }); await p.waitForTimeout(3500)
await p.screenshot({ path: `shots/${name}-play.png` })
console.log(JSON.stringify(await p.evaluate(() => BI.state())), errs)
await b.close(); srv.kill()
