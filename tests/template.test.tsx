import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const BAND = {
  plugin: 'prompt-template',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 40,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const
const P = 'prompt-template'

// 테스트에서는 엔진 대신 이 훅들이 답한다
function engineBeneath(on: On, store: Record<string, unknown> = {}) {
  mock.store(on, store)
  mock.clock(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.focus', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  // 띠를 그리지 않을 때 엔진이 원래 그리는 것
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

function captureFill(on: On) {
  const box = { text: '' }
  on('prompt.fill', (_, e) => {
    box.text = e.text
    return { isFilled: true }
  })
  return box
}

const runCommand = ($: Engine, command: string) =>
  $.command.run({
    command,
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })

type Found = { key: string | undefined; props: Record<string, unknown>; text: string } | undefined
type Ui = { find: (q: { key?: string; type?: string; text?: string | RegExp }) => Promise<Found> }

// 제목 줄 오른쪽의 "템플릿 · n/m"에서 n/m만
const position = async (ui: Ui) =>
  (await ui.find({ type: 'Text', text: / · \d+\/\d+$/ }))?.text.split(' · ').pop() ?? ''
const selected = async (ui: Ui) => (await ui.find({ key: 'tpl-select' }))?.props.value

test('문제 해결 9칸: 빈칸은 없음, 버튼칸은 골라 넘기고, 끝나면 채운 뒤 1번 칸으로 남는다', async ($, on) => {
  engineBeneath(on)
  const filled = captureFill(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'vscode', 'terminal'] as const) {
    filled.text = ''
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await selected(ui)).toBe('problem')
    expect(await position(ui)).toBe('1/9')
    await $.ui.input({ plugin: P, key: 'step-0', text: '왼쪽바가 불편함', surface })
    expect(await position(ui)).toBe('2/9')
    for (const [i, text] of [[1, ''], [2, '대화창 안 팝업'], [3, ''], [4, '']] as const) {
      await $.ui.input({ plugin: P, key: `step-${i}`, text, surface })
    }

    // 버튼칸: 첫 선택지가 미리 골라져(autoFocus) Enter 한 번이면 선택
    const first = await ui.find({ key: 'opt-5-0' })
    expect(first?.props.label).toBe('긴급')
    expect(first?.props.autoFocus).toBe(true)
    await $.ui.press({ plugin: P, key: 'opt-5-2', surface })
    await $.ui.press({ plugin: P, key: 'opt-6-0', surface })
    await $.ui.press({ plugin: P, key: 'opt-7-1', surface })
    expect(filled.text).toBe('')
    await $.ui.press({ plugin: P, key: 'opt-8-0', surface })

    expect(filled.text).toBe(
      [
        '## 문제 정의\n왼쪽바가 불편함',
        '## 재현 방법\n없음',
        '## 기대 결과\n대화창 안 팝업',
        '## 관련 위치\n없음',
        '## 제약·금지\n없음',
        '## 우선순위\n보통',
        '## 변경 범위\n최소 수정',
        '## 진행 방식\n계획 먼저 보고',
        '## 작업 후 검증\n테스트·검증 후 보고',
      ].join('\n\n'),
    )
    // 채운 뒤에도 사라지지 않고 1번 칸부터
    expect(await ui.find({ key: 'expand' })).toBeUndefined()
    expect(await position(ui)).toBe('1/9')
    await ui.unmount()
  }
})

test('템플릿 이름을 누르면 목록에서 고른다', async ($, on) => {
  engineBeneath(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  const options = (await ui.find({ key: 'tpl-select' }))?.props.options as { value: string; label: string }[]
  expect(options.map(o => o.label)).toEqual(['문제 해결', '아이디어 기획', '문서 제작', '정보·공부 수집', '+ 새 템플릿 만들기'])

  await $.ui.select({ plugin: P, key: 'tpl-select', value: 'study' })
  expect(await selected(ui)).toBe('study')
  expect(await ui.find({ type: 'Text', text: '학습 주제' })).toBeDefined()
  await ui.unmount()
})

test('목록의 "새 템플릿 만들기"로 버튼칸이 있는 템플릿을 만들어 쓴다', async ($, on) => {
  engineBeneath(on)
  const filled = captureFill(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  // 편집 칸의 key에는 템플릿 id가 들어가므로 보이는 글자로 찾는다
  const keyOf = async (text: string) => (await ui.find({ type: 'Input', text }))?.key ?? ''

  await $.ui.select({ plugin: P, key: 'tpl-select', value: '__new__' })
  await $.ui.input({ plugin: P, key: await keyOf('새 템플릿'), text: '회의', kind: 'change' })
  await $.ui.input({ plugin: P, key: await keyOf('첫 번째 칸'), text: '안건', kind: 'change' })
  await $.ui.press({ plugin: P, key: 'add-choice' })
  await $.ui.input({ plugin: P, key: await keyOf('새 선택'), text: '긴급도', kind: 'change' })
  await $.ui.input({ plugin: P, key: await keyOf('예, 아니오'), text: '높음, 보통, 낮음', kind: 'change' })
  await $.ui.press({ plugin: P, key: 'save' })

  const options = (await ui.find({ key: 'tpl-select' }))?.props.options as { label: string }[]
  expect(options.map(o => o.label)).toContain('회의')
  await $.ui.input({ plugin: P, key: 'step-0', text: '예산' })
  expect((await ui.find({ key: 'opt-1-2' }))?.props.label).toBe('낮음')
  await $.ui.press({ plugin: P, key: 'opt-1-0' })
  expect(filled.text).toBe('## 안건\n예산\n\n## 긴급도\n높음')
  await ui.unmount()
})

test('/pt를 여러 번 입력해도 사라지지 않고, [접기]로만 접힌다', async ($, on) => {
  engineBeneath(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await $.ui.input({ plugin: P, key: 'step-0', text: '쓰는 중', kind: 'change' })

  await runCommand($, 'pt')
  await runCommand($, 'pt')
  expect((await ui.find({ key: 'step-0' }))?.props.value).toBe('쓰는 중')

  await $.ui.press({ plugin: P, key: 'close' })
  expect((await ui.find({ key: 'expand' }))?.text).toContain('문제 해결 · 1/9')
  await runCommand($, 'pt')
  expect((await ui.find({ key: 'step-0' }))?.props.value).toBe('쓰는 중')
  await ui.unmount()
})

test('대화를 새로 시작(/clear)하면 접혀 있던 템플릿이 다시 펼쳐지고, ↑로 넘긴다', async ($, on) => {
  engineBeneath(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await $.ui.input({ plugin: P, key: 'step-0', text: '쓰던 것', kind: 'change' })
  await $.ui.press({ plugin: P, key: 'close' })
  expect(await ui.find({ key: 'expand' })).toBeDefined()

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(await ui.find({ key: 'expand' })).toBeUndefined()
  expect((await ui.find({ key: 'step-0' }))?.props.value).toBe('')
  expect(await ui.find({ type: 'Text', text: '문제 정의' })).toBeDefined()

  await $.ui.input({ plugin: P, key: 'step-0', text: '새 문제' })
  expect(await ui.find({ type: 'Text', text: '재현 방법' })).toBeDefined()
  expect(await position(ui)).toBe('2/9')
  await ui.unmount()
})

test('작성한 칸은 위에 내용과 함께 쌓이고, 누르면 그 칸으로 돌아간다', async ($, on) => {
  engineBeneath(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await $.ui.input({ plugin: P, key: 'step-0', text: '버튼이 겹침' })
  await $.ui.input({ plugin: P, key: 'step-1', text: '' })

  expect((await ui.find({ key: 'done-0' }))?.text).toContain('버튼이 겹침')
  expect((await ui.find({ key: 'done-1' }))?.text).toContain('없음')
  expect(await position(ui)).toBe('3/9')

  await $.ui.press({ plugin: P, key: 'done-0' })
  expect(await position(ui)).toBe('1/9')
  expect((await ui.find({ key: 'step-0' }))?.props.value).toBe('버튼이 겹침')
  await ui.unmount()
})

test('앞 칸을 눌러 고치고 Enter하면 쓰던 칸으로 바로 돌아온다', async ($, on) => {
  engineBeneath(on)

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  for (const [i, text] of [[0, '첫 내용'], [1, ''], [2, '셋째'], [3, '넷째']] as const) {
    await $.ui.input({ plugin: P, key: `step-${i}`, text })
  }
  expect(await position(ui)).toBe('5/9')

  await $.ui.press({ plugin: P, key: 'done-0' })
  expect(await position(ui)).toBe('1/9')
  await $.ui.input({ plugin: P, key: 'step-0', text: '고친 내용' })
  // 2, 3, 4번을 다시 지나지 않고 5번으로
  expect(await position(ui)).toBe('5/9')
  expect((await ui.find({ key: 'done-0' }))?.text).toContain('고친 내용')
  expect((await ui.find({ key: 'done-3' }))?.text).toContain('넷째')
  await ui.unmount()
})

test('접힌 줄을 누르면 펼쳐진다', async ($, on) => {
  engineBeneath(on)

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await $.ui.press({ plugin: P, key: 'close' })
  expect(await ui.find({ key: 'step-0' })).toBeUndefined()
  await $.ui.press({ plugin: P, key: 'expand' })
  expect(await ui.find({ key: 'step-0' })).toBeDefined()
  await ui.unmount()
})

// 오류 검증: 모든 화면을 세 곳에서 그려, 화면이 거부하는 요소·속성이 없는지 (mount가 거부하면 실패)
test('작성·버튼칸·편집·기록·접힌 줄 화면이 데스크톱·VS Code·터미널에서 모두 그려진다', async ($, on) => {
  engineBeneath(on)
  on('prompt.fill', () => ({ isFilled: true }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['desktop', 'vscode', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'step-0' })).toBeDefined()

    for (const i of [0, 1, 2, 3, 4]) await $.ui.input({ plugin: P, key: `step-${i}`, text: `값${i}`, surface })
    expect(await ui.find({ key: 'opt-5-0' })).toBeDefined()

    await $.ui.press({ plugin: P, key: 'edit', surface })
    expect(await ui.find({ key: 'save' })).toBeDefined()
    await $.ui.press({ plugin: P, key: 'add-choice', surface })
    expect(await ui.find({ type: 'Input', text: '예, 아니오' })).toBeDefined()

    await $.ui.press({ plugin: P, key: 'history', surface })
    expect(await ui.find({ key: 'back' })).toBeDefined()
    await $.ui.press({ plugin: P, key: 'back', surface })
    await $.ui.press({ plugin: P, key: 'cancel', surface })

    await $.ui.press({ plugin: P, key: 'close', surface })
    expect(await ui.find({ key: 'expand' })).toBeDefined()
    await $.ui.press({ plugin: P, key: 'expand', surface })
    expect(await ui.find({ key: 'opt-5-0' })).toBeDefined()
    await ui.unmount()
    // 다음 화면은 새 대화에서 시작
    await $.session.end({ reason: 'clear', sessionId: surface, resume: { id: surface } })
  }
})

test('대화가 시작되면 /pt 없이도 띠를 다시 그리게 한다', async ($, on) => {
  engineBeneath(on)
  const invalidated: string[] = []
  on('ui.invalidate', (_, e) => {
    invalidated.push(e.event)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  expect(invalidated).toContain('ui.render')
})

test('앞 버전의 10칸 기본 템플릿은 새 구성으로 바뀌고, 직접 만든 템플릿은 남는다', async ($, on) => {
  engineBeneath(on, {
    templates2: [
      { id: 'problem', name: '문제 해결', fields: Array.from({ length: 10 }, (_, i) => ({ title: `칸${i}`, type: 'text' })) },
      { id: 't1', name: '내 템플릿', fields: [{ title: '하나', type: 'text' }] },
    ],
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await position(ui)).toBe('1/9')
  const options = (await ui.find({ key: 'tpl-select' }))?.props.options as { value: string }[]
  expect(options.map(o => o.value)).toEqual(['problem', 'idea', 'document', 'study', 't1', '__new__'])
  await ui.unmount()
})
