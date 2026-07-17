import type { SearchResult } from '@shared/types'
import { getSearchAcceptLanguage } from './accept-language'
import WebSearch from './base'

export class BingNewsSearch extends WebSearch {
  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const html = await this.fetchSerp(query, signal)
    const items = this.extractItems(html)
    return { items }
  }

  private async fetchSerp(query: string, signal?: AbortSignal) {
    const html = await this.fetch('https://www.bing.com/news/infinitescrollajax', {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': getSearchAcceptLanguage(),
      },
      query: { InfiniteScroll: '1', q: query },
      responseType: 'text',
      signal,
    })
    return html as string
  }

  private extractItems(html: string) {
    const dom = new DOMParser().parseFromString(html, 'text/html')
    const nodes = dom.querySelectorAll('.newsitem')
    return Array.from(nodes)
      .slice(0, 10)
      .map((node) => {
        const nodeA = node.querySelector('.title')
        if (!nodeA) return null
        const link = nodeA.getAttribute('href')
        if (!link) return null
        const title = nodeA.textContent || ''
        const nodeAbstract = node.querySelector('.snippet')
        const snippet = nodeAbstract?.textContent || ''
        return { title, link, snippet }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }
}
