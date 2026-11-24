import { useEffect } from 'react'
import { getLang, translateText, useLang } from '@/lib/i18n'

/**
 * A restrained runtime translation layer.
 *
 * It translates interface copy, labels and date/count patterns. It deliberately
 * does NOT touch:
 *   - author-written bodies (`[data-i18n-skip]`, `.markdown-body`)
 *   - editors and code (`input`, `textarea`, `pre`, `code`, contenteditable)
 *   - user names, handles, URLs
 *
 * Switching back to Chinese restores the exact source nodes; nothing is
 * overwritten in the database and no machine translation is presented as the
 * author's words.
 */

const originalText = new WeakMap<Text, string>()
const originalAttrs = new WeakMap<Element, Map<string, string>>()
const ownWrite = new WeakSet<Text>()
const ownAttrWrite = new WeakSet<Element>()

const SKIP_SELECTOR = [
  '[data-i18n-skip]',
  '.markdown-body',
  '.manuscript-body',
  'a[href*="/catalog/"]',
  'a[href*="/forum/"]',
  'a[href*="/u/"]',
  '[contenteditable="true"]',
  'script',
  'style',
  'textarea',
  'input',
  'code',
  'pre',
  'kbd',
  'samp',
  'svg',
].join(',')

function shouldSkip(node: Node): boolean {
  const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
  if (!parent) return true
  // A control or metadata label inside a content link can opt back in; the
  // surrounding title and author copy stay skipped.
  if (parent.closest('[data-i18n-allow]')) return false
  if (parent.closest(SKIP_SELECTOR)) return true
  if (parent.closest('[aria-hidden="true"]')) return true
  return false
}

function translateNode(node: Text) {
  if (shouldSkip(node)) return
  const current = node.data
  if (!current) return
  const translated = translateText(current, 'en')
  if (translated === current) return
  if (!originalText.has(node)) originalText.set(node, current)
  ownWrite.add(node)
  node.data = translated
}

function restoreNode(node: Text) {
  const source = originalText.get(node)
  if (source === undefined) return
  if (node.data !== source) {
    ownWrite.add(node)
    node.data = source
  }
}

function translateAttr(el: Element, attr: string) {
  const value = el.getAttribute(attr)
  if (!value || !/[\u4e00-\u9fff]/.test(value)) return
  const translated = translateText(value, 'en')
  if (translated === value) return
  const map = originalAttrs.get(el) ?? new Map<string, string>()
  if (!map.has(attr)) map.set(attr, value)
  originalAttrs.set(el, map)
  ownAttrWrite.add(el)
  el.setAttribute(attr, translated)
}

function translateAttrs(el: Element) {
  const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
  if (isField) {
    // Placeholders are interface copy; values are user input. Fields are in
    // the skip selector for text nodes, so handle their attributes first.
    translateAttr(el, 'placeholder')
  } else if (shouldSkip(el)) {
    return
  }
  for (const attr of ['aria-label', 'title', 'alt']) translateAttr(el, attr)
}

function restoreAttrs(el: Element) {
  const map = originalAttrs.get(el)
  if (!map) return
  ownAttrWrite.add(el)
  for (const [attr, value] of map) el.setAttribute(attr, value)
}

function walk(root: Node, fn: (node: Text) => void) {
  if (root.nodeType === Node.TEXT_NODE) {
    fn(root as Text)
    return
  }
  const doc = root.ownerDocument ?? document
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    fn(node as Text)
    node = walker.nextNode()
  }
}

function translateSubtree(root: Node) {
  if (!(root instanceof Element) && root.nodeType !== Node.TEXT_NODE) return
  if (root.nodeType === Node.TEXT_NODE) {
    translateNode(root as Text)
    return
  }
  const el = root as Element
  translateAttrs(el)
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return
  }
  for (const child of Array.from(el.querySelectorAll('*'))) translateAttrs(child)
  walk(el, translateNode)
}

let originalTitle: string | null = null

function translateDocumentTitle() {
  const title = document.title
  if (!title || !/[\u4e00-\u9fff]/.test(title)) return
  // Keep the latest Chinese title so a switch back restores the current page,
  // not the page that happened to be open first.
  originalTitle = title
  const translated = title
    .split(/(\s+·\s+|\s+—\s+)/)
    .map((part) => translateText(part, 'en'))
    .join('')
  if (translated !== title) document.title = translated
}

function restoreDocumentTitle() {
  if (originalTitle) document.title = originalTitle
}

function translateAll() {
  translateDocumentTitle()
  for (const el of Array.from(document.body.querySelectorAll('*'))) translateAttrs(el)
  walk(document.body, translateNode)
}

function restoreAll() {
  walk(document.body, restoreNode)
  for (const el of Array.from(document.body.querySelectorAll('*'))) restoreAttrs(el)
}

let observer: MutationObserver | null = null
let queued = false

function schedule(mutated: MutationRecord[]) {
  if (queued) return
  queued = true
  queueMicrotask(() => {
    queued = false
    for (const record of mutated) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        if (ownAttrWrite.has(record.target)) continue
        translateAttrs(record.target)
        continue
      }
      if (record.type === 'characterData' && record.target instanceof Text) {
        const node = record.target
        if (ownWrite.has(node)) {
          ownWrite.delete(node)
          continue
        }
        // React rewrote the text with fresh Chinese source: replace the stored
        // source so switching back restores the newest copy, then translate.
        if (originalText.has(node)) originalText.delete(node)
        translateNode(node)
        continue
      }
      for (const added of Array.from(record.addedNodes)) {
        if (added.nodeType === Node.TEXT_NODE) {
          if (!ownWrite.has(added as Text)) translateNode(added as Text)
        } else if (added.nodeType === Node.ELEMENT_NODE) {
          translateSubtree(added)
        }
      }
    }
  })
}

function startObserver() {
  if (observer) return
  observer = new MutationObserver(schedule)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'aria-label', 'title', 'alt'],
  })
}

function stopObserver() {
  observer?.disconnect()
  observer = null
}

export function I18nRuntime() {
  const lang = useLang()

  useEffect(() => {
    if (lang === 'en') {
      translateAll()
      startObserver()
      const titleObserver = new MutationObserver(translateDocumentTitle)
      const titleEl = document.querySelector('title')
      if (titleEl) titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true })
      return () => {
        stopObserver()
        titleObserver.disconnect()
      }
    }
    stopObserver()
    restoreAll()
    restoreDocumentTitle()
    return undefined
  }, [lang])

  // First frame can render before the effect above; keep the English boot path
  // explicit so a shared `?lang=en` link never shows a Chinese flash longer
  // than a single paint.
  useEffect(() => {
    if (getLang() === 'en') {
      const id = window.requestAnimationFrame(() => translateAll())
      return () => window.cancelAnimationFrame(id)
    }
    return undefined
  }, [])

  return null
}
