import { readFile, writeFile } from 'node:fs/promises'

interface MemoryDecisionSource {
  version: string
  domains: Array<{
    id: string
    split: 'dev' | 'holdout'
    user: string
    userFact: string
    draft: string
    draftFact: string
    candidate: string
    candidateFact: string
  }>
}

export async function writeMemoryDecisionSuite(input: { sourceFile: string; outputFile: string }) {
  const source = JSON.parse(await readFile(input.sourceFile, 'utf8')) as MemoryDecisionSource
  const suite = {
    version: `${source.version}.expanded`,
    cases: source.domains.map((domain) => {
      const { userFact, draftFact, candidateFact } = domain
      return {
      id: `memory_${domain.split}_${domain.id}`,
      category: `creative_memory_${domain.split}`,
      fixture: 'draft',
      turns: [
        {
          prompt: `请把这条明确保存为跨项目长期创作偏好：${domain.user}。不要创建或修改视频草稿。`,
          expected: {
            tools: [], kind: 'discussion', draftChange: false,
            memoryAction: { operation: 'add', scopeType: 'user', status: 'active', requiredFacts: [userFact] },
          },
        },
        {
          prompt: `请把这条明确保存为仅适用于当前草稿的创作知识：${domain.draft}。不要执行其他动作。`,
          expected: {
            tools: [], kind: 'discussion', draftChange: false,
            memoryAction: { operation: 'add', scopeType: 'draft', status: 'active', requiredFacts: [draftFact] },
          },
        },
        {
          prompt: `${domain.candidate}，但我还不确定它是不是稳定偏好；请明确把它沉淀为当前草稿的候选观察，不能直接参与创作。`,
          expected: {
            tools: [], kind: 'discussion', draftChange: false,
            memoryAction: { operation: 'add', scopeType: 'draft', status: 'candidate', requiredFacts: [candidateFact] },
          },
        },
        {
          prompt: '顺便问一句，你能简单说明当前是讨论模式吗？不要记录任何偏好，也不要修改草稿。',
          expected: {
            tools: [], kind: 'discussion', draftChange: false,
            memoryAction: { operation: 'none' },
          },
        },
        {
          prompt: `只根据已保存知识回答：关于“${domain.user}”的跨项目偏好，以及“${domain.draft}”的当前草稿规则分别是什么？不要新增或修改记忆。`,
          expected: {
            tools: [], kind: 'discussion', draftChange: false,
            memoryAction: { operation: 'none' },
            retrievedActiveMemoryFacts: [userFact, draftFact],
            memoryReplyFacts: [userFact, draftFact],
            forbiddenMemoryReplyFacts: [candidateFact],
          },
        },
      ],
    }}),
  }
  await writeFile(input.outputFile, `${JSON.stringify(suite, null, 2)}\n`, 'utf8')
  return { suite, samples: source.domains.length * 5, holdoutCases: source.domains.filter((item) => item.split === 'holdout').length }
}
