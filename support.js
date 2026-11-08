// 任意の支援リンク。結果画面の「もう一回」のある所に1本だけ足す
// 使い方: </body> の直前に <script src="support.js?v=1" data-ja="肉まん" data-en="a pork bun"></script>
(function () {
  var URL = 'https://ofuse.me/ktomo_dev'
  var script = document.currentScript
  var ja = '作者に' + script.getAttribute('data-ja') + 'をおごる'
  var en = 'Buy the dev ' + script.getAttribute('data-en')
  var again = document.getElementById('bAgain') || document.getElementById('btnAgain')
  if (!again || document.getElementById('tmSupport')) return

  var a = document.createElement('a')
  a.id = 'tmSupport'
  a.href = URL
  a.target = '_blank'
  a.rel = 'noopener'
  // 2026-11-08 本人「もう少しだけ目立つように。やりすぎない感じで」: 金の細い縁・小さな贈り物の線画・一度だけふわっと出る（くり返す動きはしない）
  a.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:7px;align-self:center;flex:none;width:fit-content;max-width:100%;min-height:40px;margin:8px auto 0;padding:0 16px;border:1.5px solid rgba(232,194,106,.9);border-radius:99px;background:rgba(28,22,14,.84);color:#FFE7A6;font-family:inherit;font-size:14px;font-weight:700;line-height:1.2;text-align:center;text-decoration:none;position:relative;z-index:2;pointer-events:auto;box-shadow:0 2px 12px rgba(232,194,106,.22);opacity:0;transform:translateY(6px);transition:opacity .5s ease .35s,transform .5s ease .35s'
  var ico = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style="flex:none"><g fill="none" stroke="#E8C26A" stroke-width="1.4" stroke-linejoin="round"><rect x="2" y="6.5" width="12" height="7.5" rx="1"/><path d="M1.5 4.5h13v2h-13zM8 4.5v9.5"/><path d="M8 4.5C6.6 2 4.4 2.2 4.6 3.6 4.8 4.6 8 4.5 8 4.5zM8 4.5c1.4-2.5 3.6-2.3 3.4-.9C11.2 4.6 8 4.5 8 4.5z"/></g></svg>'
  var label = document.createElement('span')
  a.innerHTML = ico; a.appendChild(label)
  function show() {
    function on() { a.style.opacity = '1'; a.style.transform = 'none' }
    if (!('IntersectionObserver' in window)) return on()
    // 結果画面が開いて見えた時に1回だけ
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting })) { io.disconnect(); requestAnimationFrame(on) } })
    io.observe(a)
    setTimeout(on, 8000)   // 見えないまま判定が来ない時の保険（透明のまま残さない）
  }

  function setText() { label.textContent = /[ぁ-んァ-ヶ一-龠]/.test(again.textContent) || !again.textContent.trim() ? ja : en }
  setText()
  new MutationObserver(setText).observe(again, { childList: true, characterData: true, subtree: true })

  // ボタンが3つ以上ある所はそこがボタンの置き場。2つまでなら横並びの列なので、ひとつ外の末尾に置く
  var row = again.parentElement
  var view = row.closest('main,section,[id="result"],[id="vResult"],[id="vEnd"]')
  var count = row.querySelectorAll(':scope > button, :scope > a').length
  if (row === view || count >= 3) row.appendChild(a)
  else row.parentElement.appendChild(a)
  show()
})()
