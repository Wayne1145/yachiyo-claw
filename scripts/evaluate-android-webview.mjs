const port = process.env.YACHIYO_WEBVIEW_PORT || '9222'
const expression = process.env.YACHIYO_WEBVIEW_EXPRESSION

if (!expression) throw new Error('YACHIYO_WEBVIEW_EXPRESSION is required')

const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
const page = targets.find((target) => target.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable Android WebView found')

const socket = new WebSocket(page.webSocketDebuggerUrl)
const response = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('WebView evaluation timed out')), 15_000)
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }))
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id !== 1) return
    clearTimeout(timer)
    resolve(message)
  })
  socket.addEventListener('error', reject)
})

socket.close()
console.log(JSON.stringify(response, null, 2))
