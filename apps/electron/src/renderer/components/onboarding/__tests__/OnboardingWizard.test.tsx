import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RoxConnectCodes } from '../RoxConnectStep'
import type {
  OnboardingState,
  OnboardingWizard as OnboardingWizardComponent,
} from '../OnboardingWizard'

// Onboarding imports the UI package, whose PDF viewer uses Vite's ?url suffix.
// Mock that browser-only asset before importing the wizard under Bun.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

let OnboardingWizard: typeof OnboardingWizardComponent

beforeAll(async () => {
  // This test must dynamically import after the Vite-only asset mock above.
  ({ OnboardingWizard } = await import('../OnboardingWizard'))
})

const roxConnectState: OnboardingState = {
  step: 'rox-connect',
  loginStatus: 'idle',
  credentialStatus: 'idle',
  completionStatus: 'saving',
  apiSetupMethod: null,
  isExistingUser: false,
}

const roxConnectCodes: RoxConnectCodes = {
  userCode: 'ABCD-1234',
  verificationUri: 'https://rox.one/connect',
  verificationUriComplete: 'https://rox.one/connect?code=ABCD-1234',
}

function renderRoxConnect({
  codes = null,
  status = 'idle',
  error,
}: {
  codes?: RoxConnectCodes | null
  status?: 'idle' | 'starting' | 'waiting' | 'success' | 'error'
  error?: string
} = {}) {
  return renderToStaticMarkup(
    <OnboardingWizard
      state={roxConnectState}
      onContinue={() => {}}
      onBack={() => {}}
      onSelectApiSetupMethod={() => {}}
      onSubmitCredential={() => {}}
      onFinish={() => {}}
      roxConnectCodes={codes}
      roxConnectStatus={status}
      roxConnectError={error}
      onStartRoxConnect={() => {}}
      onOpenRoxConnectBrowser={() => {}}
    />,
  )
}

describe('OnboardingWizard', () => {
  test('renders the Rox Connect gate', () => {
    const html = renderRoxConnect()

    expect(html).toContain('onboarding.roxConnect.title')
    expect(html).toContain('onboarding.roxConnect.connect')
  })

  test('renders a waiting Rox device flow with its approval controls', () => {
    const html = renderRoxConnect({ codes: roxConnectCodes, status: 'waiting' })

    expect(html).toContain('ABCD-1234')
    expect(html).toContain('onboarding.roxConnect.openBrowser')
    expect(html).toContain('onboarding.roxConnect.waiting')
    expect(html).toContain('onboarding.roxConnect.restart')
  })

  test('renders Rox connection completion', () => {
    const html = renderRoxConnect({ status: 'success' })

    expect(html).toContain('onboarding.roxConnect.success')
  })

  test('renders an error with a recovery action', () => {
    const html = renderRoxConnect({
      status: 'error',
      error: 'Unable to start Rox Connect',
    })

    expect(html).toContain('Unable to start Rox Connect')
    expect(html).toContain('onboarding.roxConnect.connect')
  })

  test('renders the OMP first-run credential step with the typed code', () => {
    const html = renderToStaticMarkup(
      <OnboardingWizard
        state={{
          ...roxConnectState,
          step: 'omp-credential',
        }}
        onContinue={() => {}}
        onBack={() => {}}
        onSelectApiSetupMethod={() => {}}
        onSubmitCredential={() => {}}
        onSubmitOmpCredential={() => {}}
        onFinish={() => {}}
      />,
    )

    expect(html).toContain('errors.omp.noModels.title')
    expect(html).toContain('errors.omp.noModels.message')
    expect(html).toContain('OMP_NO_MODELS')
  })

  test('in-chat OMP_AUTH_REQUIRED uses error-code i18n copy', async () => {
    const { OmpCredentialStep } = await import('../OmpCredentialStep')
    const html = renderToStaticMarkup(
      <OmpCredentialStep compact typedCode="OMP_AUTH_REQUIRED" onSubmit={() => {}} />,
    )

    expect(html).toContain('errors.omp.authRequired.title')
    expect(html).toContain('errors.omp.authRequired.message')
    expect(html).toContain('OMP_AUTH_REQUIRED')
  })
})
