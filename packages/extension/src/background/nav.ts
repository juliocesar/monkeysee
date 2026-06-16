/**
 * Per-tab navigation readiness. Tracks loading via webNavigation and lets callers
 * await the next settle (onCompleted / SPA history update) with a timeout.
 */

const loading = new Map<number, boolean>()
const waiters = new Map<number, Array<() => void>>()

function settle(tabId: number): void {
  loading.set(tabId, false)
  const w = waiters.get(tabId)
  if (w) {
    waiters.delete(tabId)
    for (const fn of w) fn()
  }
}

export function initNav(): void {
  chrome.webNavigation.onBeforeNavigate.addListener(d => {
    if (d.frameId === 0) loading.set(d.tabId, true)
  })
  chrome.webNavigation.onCommitted.addListener(d => {
    if (d.frameId === 0) loading.set(d.tabId, true)
  })
  chrome.webNavigation.onCompleted.addListener(d => {
    if (d.frameId === 0) settle(d.tabId)
  })
  chrome.webNavigation.onHistoryStateUpdated.addListener(d => {
    if (d.frameId === 0) settle(d.tabId)
  })
  chrome.webNavigation.onErrorOccurred.addListener(d => {
    if (d.frameId === 0) settle(d.tabId)
  })
}

export function isLoading(tabId: number): boolean {
  return loading.get(tabId) ?? false
}

/** Resolve when the tab next settles, or after timeoutMs. */
export function onceSettled(tabId: number, timeoutMs: number): Promise<'settled' | 'timeout'> {
  if (!isLoading(tabId)) return Promise.resolve('settled')
  return new Promise(resolve => {
    const arr = waiters.get(tabId) ?? []
    const timer = setTimeout(() => {
      const list = waiters.get(tabId)
      if (list)
        waiters.set(
          tabId,
          list.filter(fn => fn !== onSettle),
        )
      resolve('timeout')
    }, timeoutMs)
    const onSettle = () => {
      clearTimeout(timer)
      resolve('settled')
    }
    arr.push(onSettle)
    waiters.set(tabId, arr)
  })
}
