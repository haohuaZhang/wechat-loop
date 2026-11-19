/**
 * 微信公众号图片有防盗链：Referer 不是 mp.weixin.qq.com 时，微信会返回
 * 「此图片来自微信公众平台 未经允许不可引用」的占位图。
 * 统一把这类图片换成后端代理地址，由后端带 Referer 去取（并落盘缓存）。
 */

// 需要走代理的域名
const PROXY_HOST_RE = /(^|\.)(qpic\.cn|qlogo\.cn|wx\.qq\.com|weixin\.qq\.com|gtimg\.com|qq\.com)(\/|$)/i

/**
 * @param {string} url
 * @returns {string} 可直接放进 <img src> 的地址
 */
export function proxiedImage(url) {
  if (!url) return ""
  if (!/^https?:\/\//i.test(url)) return url
  try {
    const host = new URL(url).hostname
    if (!PROXY_HOST_RE.test(host)) return url
  } catch {
    return url
  }
  const b64 = btoa(unescape(encodeURIComponent(url)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return `/api/image-proxy?u=${b64}`
}
