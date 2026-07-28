import { describe, expect, it } from 'vitest'
import { routeQuery } from '@/lib/services/query-intent'

describe('query intent router', () => {
  const cases: Array<[string, string]> = [
    ['Who is Narendra Modi?', 'GENERAL_WEB'], ['Who is José Andrés?', 'GENERAL_WEB'], ['Wer ist Tomáš Baťa?', 'GENERAL_WEB'],
    ['What is happening with Siemens this week?', 'GENERAL_WEB'], ['Latest news about Company X', 'GENERAL_WEB'],
    ['Who in my network works in manufacturing?', 'NETWORK_SEARCH'], ['Find investors in my contacts', 'NETWORK_SEARCH'],
    ['Who in my network has experience with AI startups in Germany?', 'NETWORK_SEARCH'], ['Welche meiner Kontakte sind Gründer?', 'NETWORK_SEARCH'],
    ['Who can introduce me to Narendra Modi?', 'INTRODUCTION_PATH'], ['Connect me with Acme GmbH', 'INTRODUCTION_PATH'], ['Intro to José Álvarez', 'INTRODUCTION_PATH'],
    ['Research Company X and tell me who in my network is relevant', 'MIXED_RESEARCH'], ['Look up Siemens and show contacts in my network', 'MIXED_RESEARCH'],
    ['What is happening with Acme this week and who in my network can help?', 'MIXED_RESEARCH'],
    ['Who have I not contacted recently?', 'RECONNECT'], ['Which relationships have gone cold?', 'RECONNECT'], ['Reconnect with people I have not contacted', 'RECONNECT'],
    ['Find Tomáš Dubois.', 'CONTACT_LOOKUP'], ['What does Tomáš Dubois do?', 'CONTACT_LOOKUP'], ['Look up Tomáš Dubois in my contacts', 'CONTACT_LOOKUP'],
    ['Write a short LinkedIn message asking about AI investment.', 'MESSAGE_DRAFT'],
    ['Tea or coffee?', 'UNKNOWN'], ['Help me think', 'UNKNOWN'],
  ]
  it.each(cases)('%s → %s', (query, intent) => expect(routeQuery(query).intent).toBe(intent))
  it('keeps Unicode names intact', () => expect(routeQuery('Who is José Tomáš Gründer?').targetName).toBe('José Tomáš Gründer'))
  it('requires explicit paths for named introductions', () => expect(routeQuery('Who can introduce me to Narendra Modi?').requiresVerifiedPath).toBe(true))
  it('parses explicit reconnect durations', () => expect(routeQuery('Who have I not contacted in more than two years?').inactiveDays).toBe(730))
  it('parses reconnect months', () => expect(routeQuery('Who have I not contacted in over six months?').inactiveDays).toBe(180))
  it('defaults vague reconnect requests to 90 days', () => expect(routeQuery('Who have I not contacted recently?').inactiveDays).toBe(90))
  it('parses since dates', () => expect(routeQuery('Who have I not contacted since January 2025?').staleBefore).toBe('2025-01-01T00:00:00.000Z'))

  const mixedParaphrases = [
    'Research AI startup investment activity in Germany and show me which people in my network may be relevant.',
    'Find current healthcare trends and people in my network who may care.',
    'Research French manufacturing and identify contacts who could help.',
    'What is happening in climate technology, and who do I know in the field?',
    'Look into fundraising activity and show investors in my network.',
    'Research German AI funding, then find relevant contacts.',
    'Latest healthcare market activity plus people I know.',
    'Investigate manufacturing in France and show my contacts.',
    'What is happening with AI investment in Berlin and who do I know?',
    'Look up climate tech news and relevant people in my network.',
    'Research startup funding in Germany; show contacts who may help.',
    'Find current AI investmnt activity in Germany and ppl in my network.',
    'Look into healthtech trends + contacts who may care.',
    'Research French industrial market and show network people.',
    'Current fundraising activity and investors in my contacts.',
    'What is happening in German AI startups and who can I ask?',
    'Research climate funding and show folks in my network.',
    'Investigate healthcare investments, then identify contacts.',
    'Look up manufacturing market activity and sales contacts.',
    'Research AI startups in Germany, also who do I know there?',
  ]
  it.each(mixedParaphrases)('routes mixed request: %s', (query) => {
    const plan = routeQuery(query)
    expect(plan.intent).toBe('MIXED_RESEARCH')
    expect(plan.executionOrder).toEqual(['WEB_SEARCH', 'NETWORK_SEARCH'])
    expect(plan.publicResearch?.enabled).toBe(true)
    expect(plan.networkSearch?.enabled).toBe(true)
  })

  it('extracts AI investment concepts for mixed private-network search', () => {
    const plan = routeQuery('Research AI startup investment activity in Germany and show me which people in my network may be relevant.')
    expect(plan.intent).toBe('MIXED_RESEARCH')
    expect(plan.publicResearch?.topic).toBe('AI startup investment activity in Germany')
    expect(plan.networkSearch?.concepts).toEqual(expect.arrayContaining(['ai', 'artificial intelligence', 'machine learning', 'startup', 'venture capital', 'investor', 'investment']))
    expect(plan.locations).toContain('Germany')
  })

  it.each([
    ['find John Smith', 'CONTACT_LOOKUP'],
    ['find me John Smith', 'CONTACT_LOOKUP'],
    ['show Priya Becker', 'CONTACT_LOOKUP'],
    ['find people in sales', 'NETWORK_SEARCH'],
    ['find me frnds in sales', 'NETWORK_SEARCH'],
    ['show sales professionals', 'NETWORK_SEARCH'],
    ['anyone in business development?', 'NETWORK_SEARCH'],
    ['who do I know in revenue?', 'NETWORK_SEARCH'],
  ])('routes exact/category query %s → %s', (query, intent) => expect(routeQuery(query).intent).toBe(intent))

  it('keeps additional exact lookups and plural categories separated', () => {
    expect(routeQuery('open Hannah Taylor').intent).toBe('CONTACT_LOOKUP')
    expect(routeQuery('show me "Rahul Joshi"').intent).toBe('CONTACT_LOOKUP')
    expect(routeQuery('people in digital health').intent).toBe('NETWORK_SEARCH')
  })

  it('expands informal sales category queries', () => {
    const plan = routeQuery('find me frnds in sales')
    expect(plan.domainConcepts).toEqual(expect.arrayContaining(['sales', 'business development', 'account executive', 'revenue', 'go-to-market', 'partnerships']))
    expect(plan.exactNameTerms).toEqual([])
  })
})
