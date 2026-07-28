/**
 * Synthetic, LLM-free tests for the grounding pipeline.
 *
 * Covers retrieval, enrichment, the relationship/recommendation split, target
 * extraction, and relationship-path verification (the hallucinated-path fix).
 * Run with:  npx tsx scripts/test-pipeline.ts
 */
import type { AnalyzeContactInput, WebEvidence } from '../lib/ai/types'
import { searchContacts } from '../lib/tools/contact-search'
import { scoreRecommendation } from '../lib/tools/enrichment'
import { extractTarget } from '../lib/tools/entity-extraction'
import { verifyIntroductionPath } from '../lib/tools/relationship-verification'
import { __setWebSearchProvider, type WebSearchProvider } from '../lib/tools/web-search'
import { gatherEvidence } from '../lib/ai/pipeline'
import {
  buildIntroductionAnswer,
  NO_PATH_MESSAGE,
  ADJACENT_MESSAGE,
} from '../lib/ai/answer-builder'

const baseContacts: AnalyzeContactInput[] = [
  {
    id: 'c1',
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    company: 'Analytical Engines',
    role: 'VP of AI Research',
    location: 'London, UK',
    relationship: { strength: 'Strong', lastContact: '2 weeks ago', howYouMet: 'Former colleague', mutualConnections: 14 },
    known: ['Worked together on an ML platform'],
    insights: ['Leads applied AI hiring this quarter', 'Knows many AI founders'],
  },
  {
    id: 'c2',
    name: 'Grace Hopper',
    email: 'grace@example.test',
    company: 'Compiler Works',
    role: 'Head of Engineering',
    location: 'New York, USA',
    relationship: { strength: 'Warm', lastContact: '5 months ago', howYouMet: 'Conference', mutualConnections: 3 },
    known: ['Met once at a systems conference'],
    insights: ['Recently spoke about scaling backend teams'],
  },
  {
    id: 'c3',
    name: 'Alan Turing',
    email: 'alan@example.test',
    company: 'Enigma Labs',
    role: 'Founder',
    location: 'Manchester, UK',
    relationship: { strength: 'Warm', lastContact: '1 month ago', howYouMet: 'Intro by a mutual', mutualConnections: 7 },
    known: ['Building an AI startup'],
    insights: ['Looking for AI advisors'],
  },
]

// A contact with EXPLICIT evidence of a path to Elon Musk.
const danaWithPath: AnalyzeContactInput = {
  id: 'c4',
  name: 'Dana Reed',
  email: 'dana@example.test',
  company: 'Orbital Dynamics',
  role: 'Operations Lead',
  location: 'Austin, USA',
  relationship: { strength: 'Cold', lastContact: '8 months ago', howYouMet: 'Worked directly with Elon Musk at Tesla', mutualConnections: 2 },
  known: ['Reported into the exec team alongside Elon Musk'],
  insights: ['Still in touch with former Tesla leadership'],
}

class NullProvider implements WebSearchProvider {
  readonly name = 'null-test'
  async search(): Promise<WebEvidence[]> {
    return []
  }
}

let passed = 0
let failed = 0
function assert(label: string, condition: boolean) {
  const status = condition ? 'PASS' : 'FAIL'
  if (condition) passed += 1
  else failed += 1
  console.log(`[${status}] ${label}`)
  if (!condition) process.exitCode = 1
}

async function main() {
  __setWebSearchProvider(new NullProvider())

  console.log('=== Target entity extraction ===')
  const tElon = extractTarget('Who can introduce me to Elon Musk?')
  const tTopicIntro = extractTarget('Who can introduce me to startup founders in Germany?')
  const tHelp = extractTarget('Who can help me enter AI startups?')
  console.log(`  "Elon Musk"        -> type=${tElon.type} requiresVerifiedPath=${tElon.requiresVerifiedPath}`)
  console.log(`  "startup founders" -> type=${tTopicIntro.type} requiresVerifiedPath=${tTopicIntro.requiresVerifiedPath}`)
  console.log(`  "help me enter"    -> type=${tHelp.type} isIntro=${tHelp.isIntroductionRequest}`)
  assert('Elon Musk detected as a named person requiring a verified path', tElon.type === 'person' && tElon.requiresVerifiedPath)
  assert('"startup founders" treated as topic (no path required)', tTopicIntro.type === 'topic' && !tTopicIntro.requiresVerifiedPath)
  assert('"help me enter AI startups" is not an introduction request', tHelp.type === 'none' && !tHelp.isIntroductionRequest)

  console.log('\n=== Path verification (no inference from topical similarity) ===')
  const adaPath = verifyIntroductionPath(baseContacts[0], tElon)
  const danaPath = verifyIntroductionPath(danaWithPath, tElon)
  assert('Ada ("knows AI founders") is NOT a verified path to Elon Musk', adaPath.verified === false)
  assert('Dana (explicit Tesla/Musk evidence) IS a verified path', danaPath.verified === true && !!danaPath.pathEvidence)

  console.log('\n=== Relationship strength vs recommendation confidence (separated) ===')
  const unverified = scoreRecommendation({ relationshipStrength: 'Warm', relevance: 0.8, externalValidation: false, requiresVerifiedPath: true, introductionVerified: false })
  const verified = scoreRecommendation({ relationshipStrength: 'Cold', relevance: 0.5, externalValidation: false, requiresVerifiedPath: true, introductionVerified: true })
  console.log(`  Warm relationship + unverified path => recommendation ${unverified.label} (${unverified.score})`)
  console.log(`  Cold relationship + verified path   => recommendation ${verified.label} (${verified.score})`)
  assert('Warm relationship but UNVERIFIED path => Cold recommendation', unverified.label === 'Cold')
  assert('Verified path lifts recommendation to at least Warm', verified.label !== 'Cold')

  console.log('\n=== Query 1: "Who can introduce me to Elon Musk?" (no evidence) ===')
  const bundle1 = await gatherEvidence({ query: 'Who can introduce me to Elon Musk?', contacts: baseContacts })
  const answer1 = buildIntroductionAnswer(bundle1)
  console.log(`  hasVerifiedPath=${bundle1.hasVerifiedPath}`)
  console.log(`  summary: ${answer1.summary}`)
  assert('No verified path exists in the base network', bundle1.hasVerifiedPath === false)
  assert('Summary returns the exact "No verified introduction path found." message', answer1.summary.includes(NO_PATH_MESSAGE))
  assert('Summary includes the adjacent-contacts disclaimer', answer1.summary.includes(ADJACENT_MESSAGE))
  assert('Irrelevant adjacent contacts are not surfaced', answer1.cards.length === 0)
  assert('Every adjacent card is marked as NOT a verified connection', answer1.cards.every((c) => c.via === 'Not a verified connection'))

  console.log('\n=== Query 1b: same query, WITH a contact that has a verified path ===')
  const bundle1b = await gatherEvidence({ query: 'Who can introduce me to Elon Musk?', contacts: [...baseContacts, danaWithPath] })
  const answer1b = buildIntroductionAnswer(bundle1b)
  console.log(`  hasVerifiedPath=${bundle1b.hasVerifiedPath}`)
  console.log(`  summary: ${answer1b.summary}`)
  const danaCard = answer1b.cards.find((c) => c.name === 'Dana Reed')
  assert('A verified path is detected when evidence exists', bundle1b.hasVerifiedPath === true)
  assert('Summary reports a verified introduction path', answer1b.summary.toLowerCase().includes('verified introduction'))
  assert('Only the evidenced contact (Dana) is presented as a path', !!danaCard && danaCard.via.startsWith('Verified path'))
  assert('Contacts without evidence are NOT presented as Elon Musk connections', !answer1b.cards.some((c) => c.name !== 'Dana Reed' && c.via.startsWith('Verified path')))

  console.log('\n=== Query 2: "Who can help me enter AI startups?" (ecosystem) ===')
  const bundle2 = await gatherEvidence({ query: 'Who can help me enter AI startups?', contacts: baseContacts })
  console.log(`  target.type=${bundle2.target.type} requiresVerifiedPath=${bundle2.target.requiresVerifiedPath}`)
  const ranked2 = bundle2.contacts.filter((c) => c.relevance > 0.15)
  console.log(`  relevant contacts: ${ranked2.map((c) => `${c.contact.name}(${c.relevance.toFixed(2)})`).join(', ')}`)
  assert('Ecosystem query does not require a verified path', bundle2.target.requiresVerifiedPath === false)
  assert('Relevant contacts are returned for the ecosystem query', ranked2.length > 0)

  console.log('\n=== Sanity: retrieval still ranks relevant contacts first ===')
  const ranked = searchContacts('AI startups advisors', baseContacts, { limit: 3 })
  assert('AI-relevant contacts outrank the backend engineer', ranked[0].contact.id !== 'c2')

  __setWebSearchProvider(null)
  console.log(`\n${failed === 0 ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'} (${passed} passed, ${failed} failed)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
