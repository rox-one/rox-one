import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ENVIRONMENT_QUESTIONNAIRE_VERSION,
  answerChoice,
  finishQuestionnaire,
  getDefaultEnvironmentPrefs,
  loadEnvironmentPrefs,
  pendingQuestionIds,
  saveEnvironmentPrefs,
} from '../index.ts'

describe('environment questionnaire', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function tmp() {
    const dir = mkdtempSync(join(tmpdir(), 'rox-env-'))
    dirs.push(dir)
    return dir
  }

  it('treats a new profile as unseen so every current question is pending', () => {
    const prefs = getDefaultEnvironmentPrefs()
    expect(prefs.seenVersion).toBe(0)
    expect(pendingQuestionIds(prefs)).toEqual([
      'modelPlacement',
      'sttTts',
      'wakeWord',
      'browserImport',
      'syncPurposes',
      'notifications',
      'agentRules',
    ])
  })

  it('lets the user skip optional voice and browser import without losing prior answers', () => {
    const dir = tmp()
    const saved = saveEnvironmentPrefs({
      modelPlacement: answerChoice('local'),
      notifications: answerChoice(false),
      completeQuestionnaire: true,
    }, dir)
    expect(saved.modelPlacement).toEqual({ status: 'answered', value: 'local' })
    expect(saved.notifications).toEqual({ status: 'answered', value: false })
    expect(saved.wakeWord.status).toBe('skipped')
    expect(saved.browserImport.status).toBe('skipped')
    expect(saved.sttEngine.status).toBe('skipped')
    expect(saved.seenVersion).toBe(ENVIRONMENT_QUESTIONNAIRE_VERSION)
    expect(pendingQuestionIds(saved)).toEqual([])

    const reloaded = loadEnvironmentPrefs(dir)
    expect(reloaded.modelPlacement.value).toBe('local')
    expect(reloaded.notifications.value).toBe(false)
    expect(reloaded.wakeWord.status).toBe('skipped')
  })

  it('shows existing users only questions newer than the version they already finished', () => {
    const prefs = finishQuestionnaire({
      ...getDefaultEnvironmentPrefs(),
      seenVersion: 1,
      modelPlacement: answerChoice('cloud'),
    })
    expect(pendingQuestionIds(prefs, 1)).toEqual([])
    expect(pendingQuestionIds(prefs, 2, {
      modelPlacement: 1,
      sttTts: 1,
      wakeWord: 1,
      browserImport: 1,
      syncPurposes: 1,
      notifications: 1,
      agentRules: 2,
    })).toEqual(['agentRules'])
  })

  it('keeps Settings edits from wiping skipped optional choices', () => {
    const dir = tmp()
    saveEnvironmentPrefs({
      modelPlacement: answerChoice('mixed'),
      completeQuestionnaire: true,
    }, dir)
    const updated = saveEnvironmentPrefs({
      wakeWord: answerChoice(true),
    }, dir)
    expect(updated.modelPlacement.value).toBe('mixed')
    expect(updated.wakeWord).toEqual({ status: 'answered', value: true })
    expect(updated.seenVersion).toBe(ENVIRONMENT_QUESTIONNAIRE_VERSION)
  })
})
