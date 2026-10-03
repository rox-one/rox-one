import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface TourErrorBoundaryProps {
  readonly children: ReactNode
  readonly onError?: (error: Error) => void
  readonly fallback?: ReactNode
}

function ErrorFallback() {
  const { t } = useTranslation()
  return <div role="status" className="fixed bottom-4 right-4 z-dropdown max-w-80 rounded-lg bg-background p-4 shadow-lg">
    <p className="font-medium">{t('productTour.error.title')}</p>
    <p className="mt-1 text-sm text-muted-foreground">{t('productTour.error.body')}</p>
  </div>
}

/** A tour rendering failure never takes down the user's workspace. */
export class TourErrorBoundary extends Component<TourErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, _info: ErrorInfo) { this.props.onError?.(error) }
  render() { return this.state.failed ? this.props.fallback ?? <ErrorFallback /> : this.props.children }
}
