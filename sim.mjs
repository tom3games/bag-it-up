// 物理の判定を数値で見る（別窓で PORT=5425 node server.mjs を立ててから node sim.mjs）
import { chromium } from 'playwright'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const b = await chromium.launch(MUTE_LAUNCH), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' }); await muteContext(ctx); const p = await ctx.newPage()
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto('http://localhost:5425/'); await p.waitForFunction(() => window.__biReady && BI.charsReady)
const cases = [
  ['eggs alone gentle', [['egg', 0, 0.4]]],
  ['eggs dropped from rim', [['egg', 0, 2.2]]],
  ['eggs thrown from high', [['egg', 0, 5.0]]],
  ['bottle on eggs (placed)', [['egg', 0, 0.3], ['bottle', 0, 1.2, 1.57]]],
  ['milk on eggs', [['egg', 0, 0.3], ['milk', 0, 1.0]]],
  ['bread on eggs', [['egg', 0, 0.3], ['bread', 0, 0.8]]],
  ['cabbage on eggs from rim', [['egg', 0, 0.3], ['cabbage', 0, 2.4]]],
  ['rice on eggs', [['egg', 0, 0.3], ['rice', 0, 1.0]]],
  ['bottle on bread', [['bread', 0, 0.3], ['bottle', 0, 1.2, 1.57]]],
  ['milk on chips', [['chips', 0, 0.45], ['milk', 0, 1.6]]],
  ['can on bread', [['bread', 0, 0.3], ['can', 0, 1.0]]],
  ['tofu flat', [['tofu', 0, 0.3]]],
  ['tofu tilted', [['tofu', 0, 1.0, 1.2]]],
  ['eggs on bottle', [['bottle', 0, 0.3, 1.57], ['egg', 0, 1.0]]],
  ['bowling on eggs', [['egg', 0, 0.3], ['bowling', 0, 2.5]]],
  ['egg1 gentle', [['egg1', 0, 0.3]]],
]
for (const [name, list] of cases) {
  const r = await p.evaluate(async (list) => {
    BI.dbg.start(9); BI.dbg.noSpawn(); BI.dbg.pause(true)
    for (const [k, x, y, a] of list) { BI.dbg.give(k, x, y, a || 0); BI.dbg.step(40) }
    BI.dbg.step(120)
    const s = BI.state(); return { dmg: s.dmg, items: s.items.map(i => `${i.kind}:${i.broken}/${i.spilled}/${i.sq}@${i.y}`).join(' ') }
  }, list)
  console.log(name.padEnd(28), JSON.stringify(r.dmg), r.items)
}
console.log(errs); await b.close()
