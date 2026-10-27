import type { Field, Template } from '../types'

const text = (title: string, hint?: string): Field => ({ title, type: 'text', hint })
const choice = (title: string, options: string[]): Field => ({ title, type: 'choice', options })

// 글칸은 핵심만, 판단이 필요한 항목은 Enter 한 번으로 끝나는 버튼칸
export const DEFAULT_TEMPLATES: Template[] = [
  {
    id: 'problem',
    name: '문제 해결',
    fields: [
      text('문제 정의', '증상 · 오류 메시지'),
      text('재현 방법', '언제, 어떻게 발생 · 없으면 Enter'),
      text('기대 결과', '정상 동작 · 완료 기준'),
      text('관련 위치', '파일 · 함수 · 화면'),
      text('제약·금지', '건드리면 안 되는 것 · 없으면 Enter'),
      choice('우선순위', ['긴급', '높음', '보통']),
      choice('변경 범위', ['최소 수정', '관련 부분까지', '구조 개선 포함']),
      choice('진행 방식', ['바로 수정', '계획 먼저 보고', '원인만 분석']),
      choice('작업 후 검증', ['테스트·검증 후 보고', '간단 확인', '생략']),
    ],
  },
  {
    id: 'idea',
    name: '아이디어 기획',
    fields: [
      text('주제', '무엇에 대한 아이디어'),
      text('목표·성공 기준', '무엇이 되면 성공인가'),
      text('대상 사용자', '누가, 어떤 상황에서'),
      text('배경·문제의식', '왜 필요한가 · 없으면 Enter'),
      text('제약 조건', '예산 · 기간 · 기술 · 없으면 Enter'),
      choice('아이디어 수', ['3개', '5개', '10개 이상']),
      choice('방향', ['현실적', '균형', '파격적']),
      choice('평가', ['장단점 비교', '실현 가능성 점수', '생략']),
      choice('결과 형태', ['목록', '기획서 초안', '비교표', '로드맵']),
    ],
  },
  {
    id: 'document',
    name: '문서 제작',
    fields: [
      text('문서 종류', '보고서 · 기획서 · 매뉴얼 · 메일'),
      text('제목·주제'),
      text('독자', '직급 · 배경지식'),
      text('목적·기대 행동', '읽은 뒤 할 일'),
      text('필수 내용', '핵심 메시지 · 데이터'),
      text('참고 자료', '파일 경로 · 링크 · 없으면 Enter'),
      choice('형식', ['Markdown', 'Word', 'PDF', '슬라이드', '엑셀']),
      choice('분량', ['1쪽 요약', '2~5쪽', '상세']),
      choice('문체', ['보고체 (~함)', '격식체 (~습니다)', '친근체 (~요)']),
      choice('작업 후 검증', ['오탈자·사실 검토 후 보고', '생략']),
    ],
  },
  {
    id: 'study',
    name: '정보·공부 수집',
    fields: [
      text('학습 주제', '주제 · 질문'),
      text('목적·용도', '어디에 쓰는가'),
      text('이미 아는 것', '없으면 Enter'),
      text('핵심 질문', '꼭 답을 얻어야 할 것'),
      text('범위·제외', '포함할 것 · 뺄 것 · 없으면 Enter'),
      choice('수준', ['입문', '기초', '중급', '전문가']),
      choice('정리 방식', ['핵심 요약', '비교표', '단계별 학습', 'Q&A', '예제 중심']),
      choice('출처', ['공식·최신 출처 표기', '상관없음']),
      choice('분량', ['한 화면', 'A4 1~2쪽', '상세']),
    ],
  },
]

export const DEFAULT_TEMPLATE_ID = 'problem'
export const DEFAULT_IDS = new Set(DEFAULT_TEMPLATES.map(t => t.id))

// 예전 형식(칸 제목 문자열 목록)도 새 형식으로 읽는다
export function normalizeTemplate(t: { id?: unknown; name?: unknown; fields?: unknown }): Template | null {
  if (typeof t.id !== 'string' || !Array.isArray(t.fields)) return null
  const fields = t.fields
    .map((f: unknown): Field | null => {
      if (typeof f === 'string') return text(f)
      if (f && typeof f === 'object' && typeof (f as Field).title === 'string') {
        const field = f as Field
        return field.type === 'choice' && Array.isArray(field.options) && field.options.length > 0
          ? choice(field.title, field.options.map(String))
          : { title: field.title, type: 'text', hint: typeof field.hint === 'string' ? field.hint : undefined }
      }
      return null
    })
    .filter((f): f is Field => f !== null)
  if (fields.length === 0) return null
  return { id: t.id, name: typeof t.name === 'string' ? t.name : '이름 없음', fields }
}
