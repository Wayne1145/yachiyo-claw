import { describe, expect, it } from 'vitest'
import { parsePluginView, PluginViewError, VIEW_LIMITS, type ViewNode } from './view-schema'

function view(children: unknown[]): unknown {
  return { schemaVersion: 1, children }
}

describe('parsePluginView', () => {
  it('accepts a representative settings-page view', () => {
    const parsed = parsePluginView(
      view([
        { type: 'heading', key: 'h', content: '天气插件设置' },
        {
          type: 'card',
          key: 'c',
          title: 'API 配置',
          children: [
            {
              type: 'textInput',
              key: 'city',
              label: '城市',
              value: '东京',
              onChange: { type: 'invoke', handler: 'setCity' },
            },
            {
              type: 'switch',
              key: 'auto',
              label: '自动刷新',
              checked: true,
              onChange: { type: 'invoke', handler: 'toggleAuto' },
            },
            {
              type: 'button',
              key: 'save',
              label: '保存',
              action: { type: 'invoke', handler: 'save', payload: { from: 'settings' } },
            },
          ],
        },
        { type: 'codeBlock', key: 'log', content: 'ready.' },
      ]),
    )
    expect(parsed.children).toHaveLength(3)
  })

  it('rejects style/className/html escape hatches via strict schemas', () => {
    expect(() => parsePluginView(view([{ type: 'text', key: 't', content: 'x', style: { color: 'red' } }]))).toThrow()
    expect(() => parsePluginView(view([{ type: 'text', key: 't', content: 'x', className: 'evil' }]))).toThrow()
    expect(() => parsePluginView(view([{ type: 'custom', key: 't', html: '<script>1</script>' }]))).toThrow()
  })

  it('rejects non-declarative actions', () => {
    expect(() =>
      parsePluginView(view([{ type: 'button', key: 'b', label: 'x', action: { type: 'invoke', handler: 'a b' } }])),
    ).toThrow()
    expect(() =>
      parsePluginView(view([{ type: 'button', key: 'b', label: 'x', action: { type: 'eval', code: '1' } }])),
    ).toThrow()
  })

  it('keeps injection payloads as inert strings (validation passes; rendering is plain text)', () => {
    const parsed = parsePluginView(
      view([
        { type: 'text', key: 't', content: '<script>alert(1)</script>' },
        { type: 'codeBlock', key: 'c', content: '<img onerror="x" src=x>' },
      ]),
    )
    const first = parsed.children[0]
    expect(first.type === 'text' && first.content).toContain('<script>')
  })

  it('rejects a view over the depth limit', () => {
    let node: ViewNode = { type: 'text', key: 'leaf', content: 'x' }
    for (let index = 0; index < VIEW_LIMITS.maxDepth + 1; index++) {
      node = { type: 'card', key: `card-${index}`, children: [node] }
    }
    expect(() => parsePluginView(view([node]))).toThrow(PluginViewError)
  })

  it('rejects a view over the node-count limit', () => {
    const children = Array.from({ length: VIEW_LIMITS.maxNodes + 1 }, (_, index) => ({
      type: 'text',
      key: `t${index}`,
      content: 'x',
    }))
    expect(() => parsePluginView(view(children))).toThrow(/node count/)
  })

  it('rejects duplicate sibling keys', () => {
    expect(() =>
      parsePluginView(
        view([
          { type: 'text', key: 'dup', content: 'a' },
          { type: 'text', key: 'dup', content: 'b' },
        ]),
      ),
    ).toThrow(/Duplicate sibling key/)
  })

  it('rejects unknown node types at parse time', () => {
    expect(() => parsePluginView(view([{ type: 'iframe', key: 'i', src: 'https://evil' }]))).toThrow()
  })
})
