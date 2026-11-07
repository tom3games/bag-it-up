// 任意の支援リンク。結果画面の「もう一回」のある所に1本だけ足す
// 使い方: </body> の直前に <script src="support.js?v=1" data-ja="肉まん" data-en="a pork bun"></script>
(function () {
  var URL = 'https://ofuse.me/ktomo_dev'
  var script = document.currentScript
  var ja = '作者に' + script.getAttribute('data-ja') + 'をおごる（任意）'
  var en = 'Buy the dev ' + script.getAttribute('data-en') + ' (optional)'
  var again = document.getElementById('bAgain') || document.getElementById('btnAgain')
  if (!again || document.getElementById('tmSupport')) return

  var a = document.createElement('a')
  a.id = 'tmSupport'
  a.href = URL
  a.target = '_blank'
  a.rel = 'noopener'
  a.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;align-self:center;flex:none;width:fit-content;max-width:100%;min-height:34px;margin:6px auto 0;padding:0 14px;border:1px solid rgba(255,255,255,.4);border-radius:99px;background:rgba(20,18,24,.74);color:#fff;font-family:inherit;font-size:13px;font-weight:700;line-height:1.2;text-align:center;text-decoration:none;position:relative;z-index:2;pointer-events:auto'

  function setText() { a.textContent = /[ぁ-んァ-ヶ一-龠]/.test(again.textContent) || !again.textContent.trim() ? ja : en }
  setText()
  new MutationObserver(setText).observe(again, { childList: true, characterData: true, subtree: true })

  // ボタンが3つ以上ある所はそこがボタンの置き場。2つまでなら横並びの列なので、ひとつ外の末尾に置く
  var row = again.parentElement
  var view = row.closest('main,section,[id="result"],[id="vResult"],[id="vEnd"]')
  var count = row.querySelectorAll(':scope > button, :scope > a').length
  if (row === view || count >= 3) row.appendChild(a)
  else row.parentElement.appendChild(a)
})()
