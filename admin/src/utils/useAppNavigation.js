import { useEffect, useState } from 'react'
import { createNavigationController, isBrowseRoutePathname } from './navigationState'
import { getInitialPageFromPathname, getPathForPage } from './seo'

export function useAppNavigation() {
  const [route, setRoute] = useState(() => ({
    url: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    restoreKey: 0,
    focusKey: 0,
    fromHistory: false,
  }))
  const [controller] = useState(() => createNavigationController(window, (url, focus, restore) => {
    setRoute(current => ({ url, fromHistory: false,
      restoreKey: current.restoreKey + (restore ? 1 : 0),
      focusKey: current.focusKey + (restore && focus ? 1 : 0),
    }))
  }))
  const pathname = new URL(route.url, window.location.origin).pathname.toLowerCase()
  const page = pathname === '/quality' ? 'diagnostics' : getInitialPageFromPathname(pathname)

  useEffect(() => {
    controller.remember(page, route.url)
  }, [controller, page, route.url])

  useEffect(() => {
    const pop = () => setRoute(current => ({ url: controller.currentUrl(), restoreKey: current.restoreKey + 1,
      focusKey: current.focusKey + 1, fromHistory: true }))
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [controller])

  useEffect(() => {
    if (!route.focusKey) return undefined
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('main-content')?.focus({ preventScroll: true })
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [route.focusKey])

  return {
    route,
    page,
    navigateUrl: controller.navigate,
    hrefFor: nextPage => nextPage === page && (page !== 'search' || isBrowseRoutePathname(pathname))
      ? route.url : controller.recalled(nextPage, getPathForPage(nextPage)),
  }
}
