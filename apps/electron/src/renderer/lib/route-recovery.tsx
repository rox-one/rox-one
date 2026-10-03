import * as React from 'react'

const RouteRecoveryContext = React.createContext<object>({})

/** Cache across suspended renders; replace the promise only for a new attempt. */
export function lazyRoutePage<Component extends React.ComponentType<any>>(loadPage: () => Promise<{ default: Component }>) {
  const attempts = new WeakMap<object, React.LazyExoticComponent<Component>>()
  return function LazyRoutePage(props: React.ComponentProps<Component>) {
    const scope = React.useContext(RouteRecoveryContext)
    let LazyPage = attempts.get(scope)
    if (!LazyPage) {
      LazyPage = React.lazy(loadPage)
      attempts.set(scope, LazyPage)
    }
    const Page = LazyPage as React.ComponentType<React.ComponentProps<Component>>
    return <Page {...props} />
  }
}

export class RouteErrorBoundary extends React.Component<{
  children: React.ReactNode
  fallback: (retry: () => void) => React.ReactNode
}, { failed: boolean; attempt: number; scope: object }> {
  state = { failed: false, attempt: 0, scope: {} }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  private retry = () => {
    this.setState(({ attempt }) => ({ failed: false, attempt: attempt + 1, scope: {} }))
  }

  render() {
    if (this.state.failed) return this.props.fallback(this.retry)
    return (
      <RouteRecoveryContext.Provider value={this.state.scope}>
        <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>
      </RouteRecoveryContext.Provider>
    )
  }
}
