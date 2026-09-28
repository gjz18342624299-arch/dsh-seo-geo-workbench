export const NAMESPACE = 'dsh-seo-geo';
export const PLATFORMS = [
  { id: 'chatgpt', name: 'ChatGPT', region: '海外', phase: 1 }, { id: 'gemini', name: 'Gemini', region: '海外', phase: 2 },
  { id: 'claude', name: 'Claude', region: '海外', phase: 2 }, { id: 'grok', name: 'Grok', region: '海外', phase: 2 },
  { id: 'perplexity', name: 'Perplexity', region: '海外', phase: 2 }, { id: 'deepseek', name: 'DeepSeek', region: '国内', phase: 1 },
  { id: 'kimi', name: 'Kimi', region: '国内', phase: 1 }, { id: 'doubao', name: '豆包', region: '国内', phase: 1 },
  { id: 'yuanbao', name: '元宝', region: '国内', phase: 2 }, { id: 'qwen', name: '通义', region: '国内', phase: 2 }
];
export const QUESTIONS = [
  { id: 'CAT01', group: '品类', text: '有哪些适合普通用户使用的 AI 桌面客户端？' },
  { id: 'BRAND01', group: '品牌', text: 'DSH Desktop 是什么？它适合哪些用户？' },
  { id: 'COMPARE01', group: '对比', text: 'DSH Desktop 和其他 AI 桌面客户端相比有什么特点？' },
  { id: 'USE01', group: '场景', text: '如何在一个桌面客户端里使用多个 AI 模型？' },
  { id: 'TRUST01', group: '信任', text: '开源 AI 桌面客户端应该如何选择？' },
  { id: 'INSTALL01', group: '安装', text: 'Windows 上如何安装 DSH Desktop？' }
];
export const DEFAULT_ADAPTERS = Object.fromEntries(PLATFORMS.map(platform => [platform.id, { status: 'planned', loginStatus: 'unknown', searchMode: true, lastCheckedAt: 0 }]));
export function normalizeState(value = {}) { return { adapters: { ...DEFAULT_ADAPTERS, ...(value.adapters || {}) }, tasks: Array.isArray(value.tasks) ? value.tasks : [], samples: Array.isArray(value.samples) ? value.samples : [] }; }
export function createSamplingTasks({ platformIds, questionIds, repeat = 1, locale = 'zh-CN', searchMode = true, now = Date.now, id = () => crypto.randomUUID() }) {
  const validPlatforms = new Set(PLATFORMS.map(item => item.id)); const validQuestions = new Set(QUESTIONS.map(item => item.id));
  const count = Math.max(1, Math.min(5, Number(repeat) || 1)); const createdAt = now();
  return platformIds.filter(item => validPlatforms.has(item)).flatMap(platformId => questionIds.filter(item => validQuestions.has(item)).flatMap(questionId => Array.from({ length: count }, (_, index) => ({ id: id(), platformId, questionId, repeatIndex: index + 1, locale, searchMode, status: 'queued', createdAt, updatedAt: createdAt, errorCode: '', error: '' }))));
}
export function summarizeTasks(tasks = []) { return tasks.reduce((summary, task) => { summary.total += 1; summary[task.status] = (summary[task.status] || 0) + 1; return summary; }, { total: 0, queued: 0, running: 0, completed: 0, needs_login: 0, blocked: 0, failed: 0 }); }
export function hasCompleteEvidence(sample) { return Boolean(sample && sample.answer?.trim() && sample.sampledAt && sample.evidence?.screenshotPath); }
