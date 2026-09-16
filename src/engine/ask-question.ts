export const MAX_ASK_QUESTION_LENGTH = 512

export function isValidAskQuestion(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' && value.length <= MAX_ASK_QUESTION_LENGTH && /\S/u.test(value))
  )
}
