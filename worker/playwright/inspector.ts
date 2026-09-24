import type { Frame } from 'playwright'
import type { ElementSelector, ElementSnapshot } from '../protocol.ts'

type InspectorPayload = Omit<ElementSnapshot, 'frame'>

const OUTER_HTML_LIMIT = 50_000
const TEXT_LIMIT = 2_000
const ATTRIBUTE_LIMIT = 2_000

function stringWithin(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

function selectors(value: unknown): ElementSelector[] {
  if (!Array.isArray(value)) return []
  const types = new Set<ElementSelector['type']>(['testId', 'id', 'role', 'label', 'placeholder', 'css'])
  return value.slice(0, 12).flatMap((item): ElementSelector[] => {
    if (typeof item !== 'object' || item === null) return []
    const candidate = item as Record<string, unknown>
    if (!types.has(candidate.type as ElementSelector['type'])
      || typeof candidate.value !== 'string'
      || typeof candidate.playwright !== 'string'
      || typeof candidate.unique !== 'boolean') return []
    return [{
      type: candidate.type as ElementSelector['type'],
      value: candidate.value.slice(0, 2_000),
      playwright: candidate.playwright.slice(0, 4_000),
      unique: candidate.unique,
    }]
  })
}

export function normalizeElementSnapshot(value: unknown, frame: Frame): ElementSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const payload = value as Partial<InspectorPayload>
  if (typeof payload.tagName !== 'string' || typeof payload.outerHTML !== 'string') return null
  const attributes = Array.isArray(payload.attributes)
    ? payload.attributes.slice(0, 100).flatMap((item): Array<{ name: string; value: string }> => {
      if (typeof item !== 'object' || item === null) return []
      const attribute = item as Record<string, unknown>
      if (typeof attribute.name !== 'string' || typeof attribute.value !== 'string') return []
      return [{ name: attribute.name.slice(0, 200), value: attribute.value.slice(0, ATTRIBUTE_LIMIT) }]
    })
    : []
  const outerHTML = stringWithin(payload.outerHTML, OUTER_HTML_LIMIT)
  return {
    tagName: payload.tagName.slice(0, 100).toLowerCase(),
    outerHTML,
    outerHTMLTruncated: payload.outerHTML.length > OUTER_HTML_LIMIT || payload.outerHTMLTruncated === true,
    text: stringWithin(payload.text, TEXT_LIMIT),
    attributes,
    selectors: selectors(payload.selectors),
    frame: {
      url: frame.url(),
      name: frame.name() || null,
      isMainFrame: frame === frame.page().mainFrame(),
    },
  }
}

// Playwright serializes this function and runs it in every document, including iframes.
// Keep it self-contained: values from the Node.js module scope are not available there.
export function installElementInspector(bindingName: string): void {
  const marker = 'data-behavior-element-highlight'
  let selected: Element | null = null
  let overlay: HTMLDivElement | null = null

  const quote = (value: string) => JSON.stringify(value)
  const normalizedText = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 2_000)
  const uniqueCss = (selector: string) => {
    try { return document.querySelectorAll(selector).length === 1 } catch { return false }
  }
  const inferredRole = (element: Element): string | null => {
    const explicit = element.getAttribute('role')
    if (explicit) return explicit
    const tag = element.tagName.toLowerCase()
    if (tag === 'button') return 'button'
    if (tag === 'a' && element.hasAttribute('href')) return 'link'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'select') return 'combobox'
    if (tag === 'img') return 'img'
    if (tag === 'input') {
      const inputType = (element.getAttribute('type') ?? 'text').toLowerCase()
      if (['button', 'submit', 'reset'].includes(inputType)) return 'button'
      if (inputType === 'checkbox') return 'checkbox'
      if (inputType === 'radio') return 'radio'
      if (!['hidden', 'file'].includes(inputType)) return 'textbox'
    }
    return null
  }
  const accessibleName = (element: Element) => {
    const ariaLabel = element.getAttribute('aria-label')?.trim()
    if (ariaLabel) return ariaLabel
    const labelledBy = element.getAttribute('aria-labelledby')
    if (labelledBy) {
      const value = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim()
      if (value) return value.slice(0, 500)
    }
    return (element.getAttribute('alt') || element.getAttribute('title') || normalizedText(element)).slice(0, 500)
  }
  const labelText = (element: Element) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return ''
    return Array.from(element.labels ?? []).map((label) => normalizedText(label)).filter(Boolean).join(' ').slice(0, 500)
  }
  const cssPath = (element: Element) => {
    const parts: string[] = []
    let current: Element | null = element
    while (current && current !== document.documentElement) {
      let part = current.tagName.toLowerCase()
      if (current.id) {
        const idSelector = `#${CSS.escape(current.id)}`
        if (uniqueCss(idSelector)) {
          parts.unshift(idSelector)
          break
        }
      }
      const parent = current.parentElement
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current?.tagName)
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
      }
      parts.unshift(part)
      const candidate = parts.join(' > ')
      if (uniqueCss(candidate)) break
      current = parent
    }
    return parts.join(' > ')
  }
  const selectorCandidates = (element: Element) => {
    const result: Array<{ type: 'testId' | 'id' | 'role' | 'label' | 'placeholder' | 'css'; value: string; playwright: string; unique: boolean }> = []
    for (const attribute of ['data-testid', 'data-test', 'data-cy']) {
      const value = element.getAttribute(attribute)
      if (!value) continue
      const selector = `[${attribute}=${CSS.escape(value)}]`
      result.push({ type: 'testId', value, playwright: attribute === 'data-testid' ? `page.getByTestId(${quote(value)})` : `page.locator(${quote(selector)})`, unique: uniqueCss(selector) })
    }
    if (element.id) {
      const selector = `#${CSS.escape(element.id)}`
      result.push({ type: 'id', value: element.id, playwright: `page.locator(${quote(selector)})`, unique: uniqueCss(selector) })
    }
    const role = inferredRole(element)
    const name = accessibleName(element)
    if (role && name) {
      const matches = Array.from(document.querySelectorAll('*')).filter((candidate) => inferredRole(candidate) === role && accessibleName(candidate) === name)
      result.push({ type: 'role', value: `${role}: ${name}`, playwright: `page.getByRole(${quote(role)}, { name: ${quote(name)} })`, unique: matches.length === 1 })
    }
    const label = labelText(element)
    if (label) {
      const matches = Array.from(document.querySelectorAll('input, textarea, select')).filter((candidate) => labelText(candidate) === label)
      result.push({ type: 'label', value: label, playwright: `page.getByLabel(${quote(label)})`, unique: matches.length === 1 })
    }
    const placeholder = element.getAttribute('placeholder')
    if (placeholder) {
      const selector = `[placeholder=${CSS.escape(placeholder)}]`
      result.push({ type: 'placeholder', value: placeholder, playwright: `page.getByPlaceholder(${quote(placeholder)})`, unique: uniqueCss(selector) })
    }
    const css = cssPath(element)
    if (css) result.push({ type: 'css', value: css, playwright: `page.locator(${quote(css)})`, unique: uniqueCss(css) })
    return result.slice(0, 12)
  }
  const updateOverlay = () => {
    if (!selected?.isConnected) {
      overlay?.remove()
      overlay = null
      selected = null
      return
    }
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.setAttribute(marker, '')
      Object.assign(overlay.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
        border: '2px solid #7c3aed', background: 'rgba(124, 58, 237, 0.10)',
        boxSizing: 'border-box', borderRadius: '3px',
      })
      document.documentElement.appendChild(overlay)
    }
    const rect = selected.getBoundingClientRect()
    Object.assign(overlay.style, {
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    })
    overlay.title = selected.tagName.toLowerCase()
  }
  document.addEventListener('click', (event) => {
    if (event.button !== 0) return
    const element = event.composedPath().find((item): item is Element => item instanceof Element && !item.hasAttribute(marker))
    if (!element) return
    selected = element
    const fullOuterHTML = element.outerHTML
    const payload: InspectorPayload = {
      tagName: element.tagName.toLowerCase(),
      outerHTML: fullOuterHTML.slice(0, 50_000),
      outerHTMLTruncated: fullOuterHTML.length > 50_000,
      text: normalizedText(element),
      attributes: Array.from(element.attributes).slice(0, 100).map((attribute) => ({ name: attribute.name, value: attribute.value.slice(0, 2_000) })),
      selectors: selectorCandidates(element),
    }
    const binding = (window as unknown as Record<string, unknown>)[bindingName]
    if (typeof binding === 'function') void (binding as (value: InspectorPayload) => Promise<void>)(payload)
    updateOverlay()
  }, true)
  window.addEventListener('resize', updateOverlay)
  document.addEventListener('scroll', updateOverlay, true)
}
