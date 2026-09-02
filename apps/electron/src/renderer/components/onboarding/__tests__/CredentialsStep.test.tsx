import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CredentialsStep as CredentialsStepComponent } from '../CredentialsStep'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

let CredentialsStep: typeof CredentialsStepComponent

beforeAll(async () => {
  ({ CredentialsStep } = await import('../CredentialsStep'))
})

const handlers = {
  onSubmit: () => {},
  onBack: () => {},
}

describe('CredentialsStep', () => {
  test('uses a localized description for provider API keys', () => {
    const html = renderToStaticMarkup(
      <CredentialsStep
        apiSetupMethod="pi_api_key"
        status="idle"
        {...handlers}
      />,
    )

    expect(html).toContain('onboarding.credentials.providerApiKeyDescription')
    expect(html).toContain('apiSetup.apiKeyLabel')
    expect(html).toContain('apiSetup.endpointLabel')
    expect(html).toContain('common.back')
    expect(html).toContain('common.continue')
    expect(html).not.toContain('Select a provider preset and enter the API key.')
    expect(html).not.toContain('>API Key<')
    expect(html).not.toContain('>Endpoint<')
  })

  test('uses a localized description for Anthropic-compatible API keys', () => {
    const html = renderToStaticMarkup(
      <CredentialsStep
        apiSetupMethod="anthropic_api_key"
        status="idle"
        {...handlers}
      />,
    )

    expect(html).toContain('onboarding.credentials.anthropicApiKeyDescription')
    expect(html).not.toContain('Enter your API key. Optionally configure a custom endpoint')
  })
})
