// 글칸: 직접 입력 / 버튼칸: 좌우로 골라 Enter
export type Field = { title: string; type: 'text' | 'choice'; options?: string[]; hint?: string }
export type Template = { id: string; name: string; fields: Field[] }
export type HistoryItem = { at: number; template: string; text: string }
export type Mode = 'fill' | 'edit' | 'history'

declare module 'claude-code' {
  interface PluginState {
    'prompt-template': {
      isOpen: boolean
      mode: Mode
      step: number
      // 가장 멀리 간 칸: 앞 칸을 고치고 Enter하면 여기로 돌아온다
      reached: number
      // 화면에 그리는 값 (대화별)
      drafts: string[]
      // 타이핑 중인 값: 그리지 않으므로 입력할 때마다 다시 그리지 않음
      live: string[]
      templateId: string
      templates: Template[]
      history: HistoryItem[]
      editing: Template | null
      editBuf: Template | null
    }
  }
}
