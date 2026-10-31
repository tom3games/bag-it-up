// テストで音を出さない（本人の指示 2026-10-31「自分でプレイしてテストするときに音を出さないで」）
// launch(bt, opts) で起動すると、chromium は --mute-audio、全コンテキストで AudioContext を止めたまま・メディアは muted
export const MUTE_JS = () => {
  for (const k of ['AudioContext', 'webkitAudioContext']) {
    const C = window[k]; if (!C) continue
    C.prototype.resume = function () { return Promise.resolve() }
    const M = class extends C { constructor(...a) { super(...a); try { C.prototype.suspend.call(this) } catch (e) {} } }
    window[k] = M
  }
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...a) { this.muted = true; this.volume = 0; return play.apply(this, a) }
}
export async function launch(bt, o = {}) {
  const b = await bt.launch(bt.name() === 'chromium' ? { ...o, args: [...(o.args || []), '--mute-audio'] } : o)
  const nc = b.newContext.bind(b)
  b.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(MUTE_JS); return c }
  b.newPage = async (...a) => (await b.newContext(...a)).newPage()
  return b
}
