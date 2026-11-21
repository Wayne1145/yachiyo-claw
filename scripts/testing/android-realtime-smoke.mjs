import assert from 'node:assert/strict'

// A scoped, credential-free CDP smoke check for an ADB-forwarded debug WebView.
const port = Number(process.argv[2] || 9230)
async function evaluate(expression) {
  const pages = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) }).then(r => r.json())
  const page = pages.find(p => p.url.startsWith('https://localhost/'))
  assert.ok(page, 'App WebView is unavailable')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebView evaluation timed out')), 8000)
      socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })))
      socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data))
        if (message.id !== 1) return
        clearTimeout(timer)
        if (message.result.exceptionDetails) reject(new Error('WebView evaluation failed'))
        else resolve(message.result.result.value)
      })
      socket.addEventListener('error', reject)
    })
  } finally { socket.close() }
}
async function waitFor(expression) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const result = await evaluate(expression)
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 120))
  }
  throw new Error('UI condition timed out')
}
if (!(await evaluate(`location.hash==='#/settings/realtime'`))) {
  await waitFor('!!document.querySelector("nav")')
  await evaluate(`(()=>{[...document.querySelectorAll('button')].find(e=>['Later','稍后处理'].includes(e.textContent.trim()))?.click();[...document.querySelectorAll('nav button')].find(e=>['Settings','设置'].includes(e.textContent.trim()))?.click();return true})()`)
  await waitFor(`!!document.querySelector('a[href="/#/settings/realtime"]')`)
  await evaluate(`(()=>{document.querySelector('a[href="/#/settings/realtime"]').click();return true})()`)
}
await waitFor(`location.hash==='#/settings/realtime'&&!!document.querySelector('label')`)
await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(e=>['Protocol','协议'].includes(e.textContent));document.getElementById(l?.htmlFor)?.click();return true})()`)
await waitFor(`!![...document.querySelectorAll('[role="option"]')].find(e=>e.textContent==='DashScope / Qwen Omni Realtime')`)
await evaluate(`(()=>{[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent==='DashScope / Qwen Omni Realtime').click();return true})()`)
const result = await waitFor(`(()=>{const field=names=>{const l=[...document.querySelectorAll('label')].find(e=>names.includes(e.textContent));return document.getElementById(l?.htmlFor)?.value};const model=field(['Model ID','模型 ID']);if(model!=='qwen3.8-omni-flash-realtime')return false;return {model,voice:field(['Voice','音色']),horizontalOverflow:document.documentElement.scrollWidth>innerWidth,saveButton:!![...document.querySelectorAll('button')].find(e=>['Save','保存'].includes(e.textContent.trim()))}})()`)
assert.equal(result.voice, 'Tina')
assert.equal(result.horizontalOverflow, false)
assert.equal(result.saveButton, true)
console.log(JSON.stringify({ passed: true, ...result }))
