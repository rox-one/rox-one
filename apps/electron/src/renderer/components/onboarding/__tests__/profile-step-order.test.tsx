/**
 * Wizard placement of the «profile» step: it renders as its own step between
 * welcome and the Rox/git-bash gates.
 *
 * Static markup only; the parallel-task permissions column is mocked.
 */
import { beforeAll, describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { OnboardingState, OnboardingWizard as OnboardingWizardComponent } from '../OnboardingWizard'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }) }))
// The wizard switch is what this suite guards; sibling steps load their own
// (still changing) graphs, so stub the welcome/identity/questionnaire screens out.
mock.module('../WelcomeStep', () => ({
  WelcomeStep: () => React.createElement('div', null, 'welcome-step'),
}))
mock.module('../IdentityStep', () => ({
  IdentityStep: () => React.createElement('div', null, 'identity-step'),
}))
mock.module('../QuestionnaireStep', () => ({
  QuestionnaireStep: () => React.createElement('div', null, 'questionnaire-step'),
  DEFAULT_QUESTIONNAIRE_REWARD_STEPS: [],
}))

let OnboardingWizard: typeof OnboardingWizardComponent

beforeAll(async () => {
  // Must load after the browser-only asset and permissions mocks above.
  ;({ OnboardingWizard } = await import('../OnboardingWizard'))
})

function state(step: OnboardingState['step']): OnboardingState {
  return {
    step,
    loginStatus: 'idle',
    credentialStatus: 'idle',
    completionStatus: 'saving',
    apiSetupMethod: null,
    isExistingUser: false,
  }
}

function render(step: OnboardingState['step']): string {
  return renderToStaticMarkup(
    <OnboardingWizard
      state={state(step)}
      onContinue={() => {}}
      onBack={() => {}}
      onSelectApiSetupMethod={() => {}}
      onSubmitCredential={() => {}}
      onFinish={() => {}}
      onStartRoxConnect={() => {}}
      onOpenRoxConnectBrowser={() => {}}
    />,
  )
}

describe('OnboardingWizard profile step', () => {
  test('renders the profile questionnaire when the step is profile', () => {
    const html = render('profile')
    expect(html).toContain('onboarding.profile.title')
    expect(html).toContain('onboarding.profile.continue')
    expect(html).toContain('onboarding.profile.skip')
    expect(html).toContain('onboarding.profile.suggest')
  })

  test('does not render the profile questionnaire on the welcome screen', () => {
    expect(render('welcome')).not.toContain('onboarding.profile.title')
  })

  test('does not render the profile questionnaire on the Rox connect gate', () => {
    expect(render('rox-connect')).not.toContain('onboarding.profile.title')
  })
})