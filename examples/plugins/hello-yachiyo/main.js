yachiyo.registerTool('increment', async function (args) {
  var current = await yachiyo.host.call('storage.get', { key: 'count' })
  var next = Number(current || 0) + 1
  await yachiyo.host.call('storage.set', { key: 'count', value: String(next) })
  return {
    schemaVersion: 1,
    children: [
      { type: 'heading', key: 'title', content: 'Hello Yachiyo', level: 2 },
      { type: 'text', key: 'count', content: 'Count: ' + next },
      { type: 'button', key: 'again', label: 'Increment', action: { type: 'invoke', handler: 'increment' } },
    ],
  }
})

yachiyo.registerTool('hello-yachiyo_echo', function (args) {
  yachiyo.log('log', 'hello-yachiyo_echo invoked')
  return { echoed: args }
})
