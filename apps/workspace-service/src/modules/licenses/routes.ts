/**
 * License audit command and license component routes.
 * W1-03 (#1500): moved out of `http.ts`; same pipeline as the identity routes.
 */

import { defineRoute } from '../../routing.ts'
import { handleDomainRoute, type DomainRouteMatch } from '../identity/routes.ts'

export const licenseRoute = defineRoute<DomainRouteMatch>({
  name: 'licenses.domain',
  match(path) {
    const matched = /^\/v1\/workspaces\/([^/]+)\/(commands\/audit\.releaseLicense|licenses(?:\/([^/]+)(\/events)?)?)$/.exec(path)
    return matched ? { workspaceSegment: matched[1], routeSegment: matched[2], projectSegment: undefined, licenseSegment: matched[3], licenseEventSegment: matched[4] } : null
  },
  handle: handleDomainRoute,
})

export const LICENSE_ROUTES = [licenseRoute] as const
