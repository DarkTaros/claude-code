const MODEL_EMAIL_MAP: Array<{ keywords: string[]; email: string }> = [
  { keywords: ['claude'], email: 'noreply@anthropic.com' },
  // 由于找不到他们的邮箱和头像, 所以改为了使用我们的邮箱先记录, 后续官方有 github 能用的邮箱可以替换
  // github 组织是不能用 co author 的
  {
    keywords: ['gpt', 'dall-e', 'o1-', 'o3-', 'o4-'],
    email: 'openai@ahcode.win',
  },
  { keywords: ['gemini'], email: 'google-gemini@ahcode.win' },
  { keywords: ['grok'], email: 'xai-org@ahcode.win' },
  { keywords: ['glm'], email: 'zai-org@ahcode.win' },
  { keywords: ['deepseek'], email: 'deepseek-ai@ahcode.win' },
  { keywords: ['qwen'], email: 'QwenLM@ahcode.win' },
  { keywords: ['minimax'], email: 'MiniMax-AI@ahcode.win' },
  { keywords: ['mimo'], email: 'XiaomiMiMo@ahcode.win' },
  { keywords: ['kimi'], email: 'MoonshotAI@ahcode.win' },
]

export function getAttributionEmail(modelName: string): string {
  const lower = modelName.toLowerCase()
  for (const { keywords, email } of MODEL_EMAIL_MAP) {
    if (keywords.some(kw => lower.includes(kw))) {
      return email
    }
  }
  return 'noreply@anthropic.com'
}
