// テストで音を出さない（本人の指示 2026-10-31「自分でプレイしてテストするときに音を出さないで」）
// launch(bt, opts) で起動すると、chromium は --mute-audio、全コンテキストで AudioContext を止めたまま・メディアは muted
export const MUTE_JS = () => {
  for (const k of ['AudioContext', 'webkitAudioContext']) {
    const C = window[k]; if (!C) continue
    C.prototype.resume = function () { return Promise.resolve() }
    const M = class extends C { constructor(...a) { super(...a); try { C.prototype.suspend.call(this) } catch (e) {} } }
    window[k] = M
  }
  if (window.AudioNode && window.AudioDestinationNode && !AudioNode.prototype.connect.__muted) {
    // WebKit は --mute-audio が無いので、スピーカーへの接続を音量0の箱に差し替える（2026-11-02 WebKit から漏れた）
    const conn = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (t, ...a) {
      if (t instanceof AudioDestinationNode) { const c = this.context; if (!c.__silent) { c.__silent = c.createGain(); c.__silent.gain.value = 0; conn.call(c.__silent, t) } return conn.call(this, c.__silent, ...a) }
      return conn.call(this, t, ...a)
    }
    AudioNode.prototype.connect.__muted = true
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
