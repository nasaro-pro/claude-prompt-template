import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Field, HistoryItem, Mode, Template } from '../types'
import { DEFAULT_IDS, DEFAULT_TEMPLATE_ID, DEFAULT_TEMPLATES, normalizeTemplate } from './templates'

const HISTORY_MAX = 30
const EMPTY_VALUE = '없음'
const NEW_TEMPLATE = '__new__'
const STORE_KEY = 'templates5'
// 예전 저장본: 직접 만든 템플릿만 옮겨 온다 (새 것부터)
const OLD_STORE_KEYS = ['templates4', 'templates3', 'templates2', 'templates']

// 새 대화는 펼친 상태로 시작한다 (대화별 값)
const isOpen = atom({ plugin: 'prompt-template', key: 'isOpen' } as const, true)
const mode = atom({ plugin: 'prompt-template', key: 'mode' } as const, 'fill' as Mode)
const step = atom({ plugin: 'prompt-template', key: 'step' } as const, 0)
const reached = atom({ plugin: 'prompt-template', key: 'reached' } as const, 0)
const drafts = atom({ plugin: 'prompt-template', key: 'drafts' } as const, [] as string[])
const live = atom({ plugin: 'prompt-template', key: 'live' } as const, [] as string[])
const templateId = atom({ plugin: 'prompt-template', key: 'templateId' } as const, DEFAULT_TEMPLATE_ID)
const templates = atom({ plugin: 'prompt-template', key: 'templates' } as const, DEFAULT_TEMPLATES)
const history = atom({ plugin: 'prompt-template', key: 'history' } as const, [] as HistoryItem[])
const editing = atom({ plugin: 'prompt-template', key: 'editing' } as const, null as Template | null)
const editBuf = atom({ plugin: 'prompt-template', key: 'editBuf' } as const, null as Template | null)

const pick = (list: Template[], id: string) =>
  list.find(t => t.id === id) ?? list.find(t => t.id === DEFAULT_TEMPLATE_ID) ?? list[0] ?? DEFAULT_TEMPLATES[0]!

const setAt = (list: string[], i: number, value: string) => {
  const next = [...list]
  while (next.length <= i) next.push('')
  next[i] = value
  return next
}

const optionsOf = (field: Field) => (field.options && field.options.length > 0 ? field.options : ['예', '아니오'])

const buildPrompt = (tpl: Template, values: string[]) =>
  tpl.fields.map((field, i) => `## ${field.title}\n${(values[i] ?? '').trim() || EMPTY_VALUE}`).join('\n\n')

const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

const stamp = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const templateOptions = (list: Template[]) => [
  ...list.map(t => ({ value: t.id, label: t.name })),
  { value: NEW_TEMPLATE, label: '+ 새 템플릿 만들기' },
]

// 칸마다 다른 key를 써서, 다음 칸이 그려지면 그 칸에 바로 포커스가 간다
const stepKey = (i: number) => `step-${i}`
const optionKey = (i: number, j: number) => `opt-${i}-${j}`

let bandId: string | undefined

// 템플릿·기록은 모든 대화가 공유($.store), 작성 중 내용은 대화별($.state)
async function saveTemplates($: EngineInterface, list: Template[]) {
  await update($, templates, () => list)
  await $.store.set(STORE_KEY, list)
}

async function loadTemplates($: EngineInterface) {
  const saved = await $.store.get(STORE_KEY)
  if (Array.isArray(saved)) {
    const list = saved.map(normalizeTemplate).filter((t): t is Template => t !== null)
    if (list.length > 0) await update($, templates, () => list)
    return
  }
  // 처음 한 번: 새 기본 템플릿에 예전 버전에서 직접 만든 템플릿만 이어 붙인다
  let older: unknown
  for (const key of OLD_STORE_KEYS) {
    older = await $.store.get(key)
    if (Array.isArray(older)) break
  }
  const custom = (Array.isArray(older) ? older : [])
    .map(normalizeTemplate)
    .filter((t): t is Template => t !== null && t.id !== 'default' && !DEFAULT_IDS.has(t.id))
  await saveTemplates($, [...DEFAULT_TEMPLATES, ...custom])
}

// 새 대화는 항상 펼친 작성 화면, 1번 칸부터
async function resetForNewChat($: EngineInterface) {
  await resetDraft($)
  await update($, mode, () => 'fill' as Mode)
  await update($, isOpen, () => true)
  // 화면이 이 mod가 준비되기 전에 띠를 물어 "없음"을 기억했을 수 있어 다시 그리게 한다
  $.ui.invalidate('ui.render')
}

async function resetDraft($: EngineInterface) {
  await update($, drafts, () => [])
  await update($, live, () => [])
  await update($, step, () => 0)
  await update($, reached, () => 0)
}

function focusBand($: EngineInterface, key: string) {
  if (!bandId) return
  $.ui.focus({ requestId: bandId, key }).catch(() => {})
}

// 글칸은 입력칸에, 버튼칸은 지금 고른(없으면 첫) 버튼에 포커스
function focusStep($: EngineInterface, tpl: Template, values: string[], i: number) {
  const field = tpl.fields[i]
  if (!field) return
  if (field.type === 'text') {
    focusBand($, stepKey(i))
    return
  }
  focusBand($, optionKey(i, Math.max(0, optionsOf(field).indexOf(values[i] ?? ''))))
}

async function setMode($: EngineInterface, next: Mode) {
  // 화면을 바꿀 때 타이핑하던 내용이 사라지지 않도록 live를 그린다
  const typed = await read($, live)
  await update($, drafts, () => typed)
  await update($, mode, () => next)
}

async function goStep($: EngineInterface, tpl: Template, i: number) {
  const typed = await read($, live)
  await update($, drafts, () => typed)
  await update($, step, () => i)
  focusStep($, tpl, typed, i)
}

async function expand($: EngineInterface) {
  await setMode($, 'fill')
  await update($, isOpen, () => true)
  $.ui.invalidate('ui.render')
  const tpl = pick(await read($, templates), await read($, templateId))
  focusStep($, tpl, await read($, live), await read($, step))
}

async function collapse($: EngineInterface) {
  // 접힌 줄의 진행 표시가 타이핑 중인 내용까지 세도록
  const typed = await read($, live)
  await update($, drafts, () => typed)
  await update($, isOpen, () => false)
  $.ui.invalidate('ui.render')
}

// /pt는 템플릿을 띄우기만 한다 (접는 것은 [접기])
async function show($: EngineInterface) {
  await expand($)
  return { text: '템플릿 표시' }
}

async function startEdit($: EngineInterface, tpl: Template) {
  await update($, editing, () => tpl)
  await update($, editBuf, () => tpl)
  await setMode($, 'edit')
}

async function startNewTemplate($: EngineInterface) {
  const tpl: Template = { id: `t${await $.clock.now()}`, name: '새 템플릿', fields: [{ title: '첫 번째 칸', type: 'text' }] }
  await startEdit($, tpl)
  focusBand($, `edit-name-${tpl.id}`)
}

async function useTemplate($: EngineInterface, list: Template[], id: string) {
  if (id === NEW_TEMPLATE) {
    await startNewTemplate($)
    return
  }
  const tpl = pick(list, id)
  await update($, templateId, () => tpl.id)
  await $.store.set('lastTemplateId', tpl.id)
  await resetDraft($)
  await update($, mode, () => 'fill' as Mode)
  focusStep($, tpl, [], 0)
}

// 마지막 칸까지 끝나면 입력창에 채우고, 템플릿은 그대로 둔 채 1번 칸부터 다시
async function fillPrompt($: EngineInterface, tpl: Template) {
  const text = buildPrompt(tpl, await read($, live))
  const filled = await $.prompt.fill({ text, mode: 'replace' })
  if (!filled.isFilled) {
    $.ui.toast('입력창에 넣지 못함 · 열린 대화 상자 확인')
    return
  }
  const item: HistoryItem = { at: await $.clock.now(), template: tpl.name, text }
  const nextHistory = [item, ...(await read($, history))].slice(0, HISTORY_MAX)
  await update($, history, () => nextHistory)
  await $.store.set('history', nextHistory)
  await resetDraft($)
  $.ui.toast('입력창에 넣음 · Esc → Enter로 전송')
}

export const register: Register = on => {
  // 새 대화(/clear, 대화 전환 포함)는 session.start 없이 이어지기도 해서 끝날 때도 되돌린다
  on('session.end', async ($, e, next) => {
    await resetForNewChat($)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await resetForNewChat($)
    await loadTemplates($)
    const storedHistory = (await $.store.get('history')) as HistoryItem[] | undefined
    if (Array.isArray(storedHistory)) await update($, history, () => storedHistory)
    const lastId = (await $.store.get('lastTemplateId')) as string | undefined
    if (typeof lastId === 'string') await update($, templateId, () => lastId)

    // 하나가 거부돼도(이름 충돌 등) 나머지는 등록되도록 따로 처리
    for (const [name, description] of [
      ['template', '프롬프트 템플릿 띄우기'],
      ['pt', '프롬프트 템플릿 띄우기 (짧게)'],
    ] as const) {
      await $.command.register({ name, description, immediate: true }).catch(() => {})
    }

    const started = await next(e)
    $.ui.invalidate('ui.render')
    return started
  })

  on('command.run', { command: 'template' }, async $ => show($))
  on('command.run', { command: 'pt' }, async $ => show($))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const elements = $.ui.resolve(e)
    // 입력칸이 없는 화면(모바일)에서는 띄우지 않는다
    if (!('Input' in elements) || !('Select' in elements)) return next(e)
    const { Box, Text, Button, Input, Select } = elements
    bandId = e.requestId

    const list = (await read($, templates)).map(normalizeTemplate).filter((t): t is Template => t !== null)
    const tpl = pick(list, await read($, templateId))
    const values = await read($, drafts)
    const count = tpl.fields.length
    const at = Math.min(await read($, step), count - 1)
    const room = Math.max(10, e.props.bodyColumns - 6)

    // 접힌 상태: 입력창 위 한 줄. 글자 뒤를 빈칸으로 채워 바 전체가 눌리게 한다
    if (!(await read($, isOpen))) {
      const written = values.filter(v => v.trim()).length
      const label = `▲  템플릿 · ${tpl.name}${written > 0 ? ` · ${written}/${count} 작성 중` : ''}`
      return (
        <Button
          key="expand"
          hotkey="t"
          label={label.padEnd(Math.max(label.length, e.props.bodyColumns - 2), ' ')}
          onPress={() => expand($)}
        />
      )
    }

    const current = await read($, mode)

    if (current === 'edit') {
      const ed = (await read($, editing)) ?? tpl
      const isNew = !list.some(t => t.id === ed.id)

      // 칸 추가·종류 변경 때는 타이핑 중인 값(editBuf)을 기준으로 다시 그린다
      const reshape = (fn: (t: Template) => Template) => async () => {
        const changed = fn((await read($, editBuf)) ?? ed)
        await update($, editBuf, () => changed)
        await update($, editing, () => changed)
      }
      const patchField = (i: number, patch: (f: Field) => Field) => (t: Template) => ({
        ...t,
        fields: t.fields.map((f, j) => (j === i ? patch(f) : f)),
      })
      const setName = (value: string) => update($, editBuf, b => ({ ...(b ?? ed), name: value }))
      const setTitle = (i: number) => (value: string) => update($, editBuf, b => patchField(i, f => ({ ...f, title: value }))(b ?? ed))
      const setOptions = (i: number) => (value: string) =>
        update($, editBuf, b =>
          patchField(i, f => ({ ...f, options: value.split(',').map(o => o.trim()).filter(Boolean) }))(b ?? ed),
        )
      const toggleType = (i: number) =>
        reshape(
          patchField(i, f =>
            f.type === 'text' ? { title: f.title, type: 'choice', options: ['예', '아니오'] } : { title: f.title, type: 'text' },
          ),
        )

      const openForEdit = async (id: string) => {
        if (id === NEW_TEMPLATE) {
          await startNewTemplate($)
          return
        }
        const t = pick(list, id)
        await update($, editing, () => t)
        await update($, editBuf, () => t)
      }

      const save = async () => {
        const buf = (await read($, editBuf)) ?? ed
        // 제목을 비운 칸은 지운다
        const cleaned: Template = {
          ...buf,
          name: buf.name.trim() || '이름 없음',
          fields: buf.fields
            .map(f => ({ ...f, title: f.title.trim() }))
            .filter(f => f.title)
            .map(f => (f.type === 'choice' ? { ...f, options: optionsOf(f) } : f)),
        }
        if (cleaned.fields.length === 0) {
          $.ui.toast('칸 최소 1개 필요')
          return
        }
        const exists = list.some(t => t.id === cleaned.id)
        await saveTemplates($, exists ? list.map(t => (t.id === cleaned.id ? cleaned : t)) : [...list, cleaned])
        await useTemplate($, [...list.filter(t => t.id !== cleaned.id), cleaned], cleaned.id)
        $.ui.toast(`'${cleaned.name}' 저장됨`)
      }

      const remove = async () => {
        if (list.length <= 1) {
          $.ui.toast('템플릿 최소 1개 필요')
          return
        }
        const rest = list.filter(t => t.id !== ed.id)
        await saveTemplates($, rest)
        const nextTpl = pick(rest, tpl.id)
        await update($, templateId, () => nextTpl.id)
        await update($, editing, () => nextTpl)
        await update($, editBuf, () => nextTpl)
        $.ui.toast(`'${ed.name}' 삭제됨`)
      }

      return (
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="row" columnGap={2}>
            <Select
              key="edit-select"
              options={isNew ? [{ value: ed.id, label: '새 템플릿' }, ...templateOptions(list)] : templateOptions(list)}
              value={ed.id}
              onSelect={openForEdit}
            />
            <Text dimColor>템플릿 편집</Text>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>이름</Text>
            <Input key={`edit-name-${ed.id}`} value={ed.name} onInput={setName} onSubmit={setName} />
          </Box>

          {ed.fields.map((field, i) => (
            <Box key={`row-${ed.id}-${i}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row" columnGap={2}>
                <Text dimColor>
                  {i + 1} · {field.type === 'text' ? '글칸' : '버튼칸'}
                </Text>
                <Button key={`type-${i}`} label={field.type === 'text' ? '버튼칸으로' : '글칸으로'} onPress={toggleType(i)} />
              </Box>
              <Input key={`edit-f-${ed.id}-${i}-${ed.fields.length}-${field.type}`} value={field.title} onInput={setTitle(i)} onSubmit={setTitle(i)} />
              {field.type === 'choice' && (
                <Input
                  key={`edit-o-${ed.id}-${i}`}
                  label="선택지 "
                  placeholder="쉼표로 구분 · 예, 아니오"
                  value={optionsOf(field).join(', ')}
                  onInput={setOptions(i)}
                  onSubmit={setOptions(i)}
                />
              )}
            </Box>
          ))}

          <Box flexDirection="row" columnGap={2} marginTop={1}>
            <Box flexDirection="row" columnGap={2}>
              <Button key="add-text" label="+ 글칸" onPress={reshape(t => ({ ...t, fields: [...t.fields, { title: '새 칸', type: 'text' }] }))} />
              <Button
                key="add-choice"
                label="+ 버튼칸"
                onPress={reshape(t => ({ ...t, fields: [...t.fields, { title: '새 선택', type: 'choice', options: ['예', '아니오'] }] }))}
              />
            </Box>
            <Box flexDirection="row" columnGap={2}>
              <Button key="history" label="기록" onPress={() => setMode($, 'history')} />
              {!isNew && <Button key="delete-tpl" label="삭제" onPress={remove} />}
              <Button key="cancel" label="닫기" onPress={() => setMode($, 'fill')} />
              <Button key="save" label="저장" onPress={save} />
            </Box>
          </Box>
          <Text dimColor>제목을 비우고 저장하면 칸 삭제</Text>
        </Box>
      )
    }

    if (current === 'history') {
      const items = await read($, history)
      const reuse = (item: HistoryItem) => async () => {
        const filled = await $.prompt.fill({ text: item.text, mode: 'replace' })
        if (!filled.isFilled) {
          $.ui.toast('입력창에 넣지 못함')
          return
        }
        await update($, mode, () => 'fill' as Mode)
      }
      return (
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="row" columnGap={2}>
            <Text bold>보낸 기록</Text>
            <Text dimColor>모든 대화 공유 · 최근 {HISTORY_MAX}개</Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {items.length === 0 && <Text dimColor>기록 없음</Text>}
            {items.slice(0, 10).map((item, i) => (
              <Button key={`h-${item.at}-${i}`} onPress={reuse(item)}>
                <Text dimColor>{stamp(item.at)} · {item.template} · </Text>
                {firstLine(item.text.replace(/^## .*\n/, '')).slice(0, Math.max(10, room - 26))}
              </Button>
            ))}
          </Box>
          <Box flexDirection="row" columnGap={2} marginTop={1}>
            {items.length > 0 && (
              <Button
                key="clear-history"
                label="기록 지우기"
                onPress={async () => {
                  await update($, history, () => [])
                  await $.store.set('history', [])
                }}
              />
            )}
            <Button key="back" label="뒤로" onPress={() => setMode($, 'edit')} />
          </Box>
        </Box>
      )
    }

    // 작성 모드
    const field = tpl.fields[at]!
    const isLast = at === count - 1

    // 칸 하나를 마치면 다음 칸으로, 마지막 칸이면 입력창에 채운다
    // 앞 칸을 고친 경우에는 쓰던 칸(reached)으로 바로 돌아간다
    const finishStep = async (value: string) => {
      await update($, live, l => setAt(l, at, value.trim() ? value : EMPTY_VALUE))
      const frontier = await read($, reached)
      if (at < frontier) {
        await goStep($, tpl, frontier)
        return
      }
      if (isLast) {
        await fillPrompt($, tpl)
        return
      }
      await update($, reached, () => at + 1)
      await goStep($, tpl, at + 1)
    }

    const options = field.type === 'choice' ? optionsOf(field) : []
    const chosen = values[at] ?? ''

    const preselect = Math.max(0, options.indexOf(chosen))

    // 데스크톱 앱은 테두리 하나로 감싸고, VS Code 계열은 입력칸이 이미 틀을 가져서 바깥 테두리를 빼 균형을 맞춘다
    const frame =
      e.surface === 'vscode'
        ? ({ paddingX: 1 } as const)
        : ({ borderStyle: 'round', borderDimColor: true, paddingX: 1 } as const)

    // 입력 바 모양: 작성한 칸이 위에 쌓이고, 제목 줄, 입력 영역, 도구 줄
    // 폭은 고정하지 않고(가로 스크롤 방지) 빈 Box가 남는 공간을 채운다
    return (
      <Box flexDirection="column" rowGap={0}>
        {at > 0 && (
          <Box flexDirection="column" paddingX={1} marginBottom={1}>
            {tpl.fields.slice(0, at).map((f, i) => (
              // 누르거나 입력칸에서 ↑ → Enter로 그 칸을 다시 고친다
              <Button key={`done-${i}`} onPress={() => goStep($, tpl, i)}>
                <Text bold>{f.title}</Text>
                {`   ${(values[i] ?? '').trim().replace(/\n+/g, ' ⏎ ') || EMPTY_VALUE}`}
              </Button>
            ))}
          </Box>
        )}
        <Box flexDirection="row" columnGap={2} paddingX={1}>
          <Text bold>{field.title}</Text>
          <Box flexGrow={1} />
          <Text dimColor>
            {tpl.name} · {at + 1}/{count}
          </Text>
        </Box>
        <Box flexDirection="column" {...frame}>
          {field.type === 'text' ? (
            <Input
              key={stepKey(at)}
              placeholder={field.hint ? `${field.hint}` : '내용 입력'}
              value={values[at] ?? ''}
              rows={3}
              autoFocus
              submitLabel="↵"
              onInput={value => update($, live, l => setAt(l, at, value))}
              onSubmit={finishStep}
            />
          ) : (
            <Box flexDirection="row" columnGap={3} paddingY={1}>
              {options.map((option, j) => (
                <Button
                  key={optionKey(at, j)}
                  label={option === chosen ? `✓ ${option}` : option}
                  hotkey={j < 9 ? String(j + 1) : undefined}
                  autoFocus={j === preselect ? true : undefined}
                  onPress={() => finishStep(option)}
                />
              ))}
            </Box>
          )}
          <Box flexDirection="row" columnGap={2} alignItems="center" marginTop={1}>
            <Select key="tpl-select" options={templateOptions(list)} value={tpl.id} onSelect={id => useTemplate($, list, id)} />
            <Button key="new" label="새로" onPress={() => startNewTemplate($)} />
            <Button key="edit" label="편집" onPress={() => startEdit($, tpl)} />
            {at > 0 && <Button key="prev" label="이전" onPress={() => goStep($, tpl, at - 1)} />}
            <Box flexGrow={1} />
            <Text dimColor>
              {field.type === 'text' ? "Enter 다음 · ↑ 이전 항목 · 비우면 '없음'" : 'Enter 선택 · ←/→ · 숫자'}
            </Text>
            <Button key="close" label="접기" onPress={() => collapse($)} />
          </Box>
        </Box>
      </Box>
    )
  })
}
