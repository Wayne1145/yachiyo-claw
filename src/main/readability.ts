// import { Readability } from '@mozilla/readability'
// import { parseHTML } from 'linkedom'
// import { fetch } from 'ofetch'
// import { sliceTextWithEllipsis } from './util'

// // linkedom 只能在 Node.js 环境，且在网页中 fetch 其他 URL 很容易出现 CORS 问题

// export async function readability(url: string, options: { maxLength?: number } = {}) {
//     const userAgents = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36`
//     const documentString = await fetch(url, {
//         headers: {
//             'User-Agent': userAgents,
//         },
//     }).then((res) => res.text())
//     const { document } = parseHTML(documentString)
//     const reader = new Readability(document, {})
//     const title = document.querySelector('title')?.textContent || undefined
//     const result = reader.parse()

//     const ret = {
//         title,
//         text: (result?.textContent || '').trim(),
//     }
//     if (options.maxLength) {
//         ret.text = sliceTextWithEllipsis(ret.text, options.maxLength)
//     }
//     return ret
// }
