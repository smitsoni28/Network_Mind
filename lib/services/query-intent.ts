import { z } from 'zod'
import { normalizeSearch, tokens } from '@/lib/services/normalization'

export const queryIntentSchema = z.enum([
  'GENERAL_WEB', 'NETWORK_SEARCH', 'CONTACT_LOOKUP', 'INTRODUCTION_PATH',
  'MIXED_RESEARCH', 'MIXED_WEB_NETWORK', 'RECONNECT', 'MESSAGE_DRAFT', 'UNKNOWN',
])
export type QueryIntent = z.infer<typeof queryIntentSchema>

const researchPlanSchema = z.object({
  enabled: z.boolean(),
  topic: z.string(),
  geography: z.string().nullable(),
  timeframe: z.enum(['current', 'recent', 'unspecified']),
})
const networkSearchPlanSchema = z.object({
  enabled: z.boolean(),
  topic: z.string(),
  geography: z.string().nullable(),
  concepts: z.array(z.string()),
})

export const queryPlanSchema = z.object({
  intent: queryIntentSchema,
  originalQuery: z.string().min(1).max(1000),
  targetName: z.string().nullable(),
  targetType: z.enum(['PERSON', 'COMPANY', 'TOPIC']).nullable(),
  concepts: z.array(z.string()),
  domainConcepts: z.array(z.string()),
  exactNameTerms: z.array(z.string()),
  roleTerms: z.array(z.string()),
  companyTerms: z.array(z.string()),
  locations: z.array(z.string()),
  temporalRequirement: z.enum(['CURRENT', 'RECENT', 'STALE', 'NONE']),
  inactiveDays: z.number().int().positive().nullable(),
  staleBefore: z.string().datetime().nullable(),
  requiresCurrentWebData: z.boolean(),
  requiresVerifiedPath: z.boolean(),
  publicResearch: researchPlanSchema.nullable(),
  networkSearch: networkSearchPlanSchema.nullable(),
  executionOrder: z.array(z.enum(['WEB_SEARCH', 'NETWORK_SEARCH', 'CONTACT_LOOKUP', 'VERIFIED_PATH', 'DRAFT'])),
  confidence: z.number().min(0).max(1),
})
export type QueryPlan = z.infer<typeof queryPlanSchema>

const NETWORK = /\b(my network|my contacts?|people i know|who do i know|in my rolodex|mein(?:em)? netzwerk|mein(?:e|er|en)? kontakte)\b/iu
const INTRO = /\b(introduce|introduction|connect me|intro to|vorstellen|kontakt herstellen)\b/iu
const RECONNECT = /\b(reconnect|not contacted|haven't contacted|have not contacted|gone cold|follow up|wieder kontakt|lange nicht)\b/iu
const CURRENT_RESEARCH = /\b(research|investigate|look up|look into|latest|current|this week|news|what is happening|what's happening|happening|trends?|activity|market)\b/iu
const MESSAGE = /\b(?:write|draft|compose|create)\b[\s\S]{0,80}\b(?:message|email|e-mail|linkedin message|sms|text)\b|\b(?:draft|compose)\s+(?:a\s+)?(?:linkedin|email|sms|message)\b/iu
const PERSON_QUESTION = /^\s*(who is|wer ist|qui est|quién es|quem é)\s+(.+?)[?!.]*$/iu
const COMPANY_QUESTION = /^(?:what is|tell me about|what(?:'s| is) happening (?:with|at)|latest (?:on|about))\s+(.+?)[?!.]*$/iu
const LOCATION_MAP = ['Germany', 'German', 'Austria', 'Switzerland', 'DACH', 'UK', 'USA', 'Europe', 'Berlin', 'Vienna', 'London', 'München', 'Munich', 'Zürich', 'Prague', 'France', 'French']
const ROLE_MAP = ['founder', 'entrepreneur', 'investor', 'investment', 'venture capital', 'vc', 'advisor', 'consultant', 'engineer', 'manufacturing', 'industrial', 'fundraising', 'angel', 'sales', 'business development', 'account executive', 'account manager', 'sales director', 'sales manager', 'commercial', 'revenue', 'go-to-market', 'gtm', 'partnerships']
const STOP = new Set(['who','what','where','which','can','could','would','should','does','do','the','this','that','with','from','into','about','tell','show','find','help','people','person','contact','contacts','friends','friend','professionals','professional','folks','anyone','network','my','me','i','in','to','a','an','is','are','of','and','or','has','have','experience','current','latest','research','activity','activities','may','relevant','more','than','over','not','contacted','recently','years','year','months','month','days','day','write','draft','compose','short','message','email','linkedin','sms','asking','look','into','up','happening','trends','trend','market','field','local'])
const FUNDRAISING = /\b(fundrais\w*|investment|investor|venture capital|\bvc\b|angel|startup financ\w*|funding)\b/iu
const FUNDRAISING_CONCEPTS = ['fundraising', 'investor', 'investment', 'venture capital', 'venture', 'vc', 'angel investor', 'angel', 'fund', 'funding', 'startup financing']
const AI_CONCEPTS = ['artificial intelligence', 'ai', 'machine learning', 'ml', 'generative ai', 'genai', 'llm', 'large language model']
const STARTUP_CONCEPTS = ['startup', 'startups', 'founder', 'founders', 'entrepreneur', 'venture capital', 'vc', 'investor', 'angel investor', 'investment', 'fund']
const SALES_CONCEPTS = ['sales', 'business development', 'bd', 'account executive', 'account manager', 'sales director', 'sales manager', 'commercial', 'revenue', 'go-to-market', 'gtm', 'partnerships', 'customer acquisition']
const HEALTHCARE_CONCEPTS = ['healthcare', 'health tech', 'healthtech', 'medical', 'clinical', 'biotech', 'pharma', 'hospital', 'patient']
const MANUFACTURING_CONCEPTS = ['manufacturing', 'industrial', 'factory', 'operations', 'supply chain', 'production']
const CLIMATE_CONCEPTS = ['climate technology', 'climate tech', 'cleantech', 'energy', 'carbon', 'sustainability']
const CATEGORY_WORDS = new Set(['people', 'person', 'contacts', 'contact', 'friends', 'friend', 'professionals', 'professional', 'founders', 'founder', 'investors', 'investor', 'salespeople', 'engineers', 'engineer', 'anyone', 'folks'])
const CATEGORY_SIGNAL = /\b(people|ppl|friends?|frnds|contacts?|professionals?|founders?|investors?|salespeople|engineers?|anyone|folks|who do i know)\b/iu
const DOMAIN_SIGNAL = /\b(ai|artificial intelligence|machine learning|ml|startup|startups|investment|investor|venture capital|\bvc\b|funding|fundraising|healthcare|healthtech|digital health|manufacturing|industrial|climate|sales|business development|revenue|commercial|partnerships|engineer|engineering|marketing|germany|german|berlin|munich|france|french)\b/iu
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }

function cleanTarget(value: string): string {
  return value.replace(/^\s*me\s+/iu, '').replace(/\b(?:this week|today|right now|in my network|in my contacts|from my contacts)\b/giu, '').replace(/[?.!]+$/u, '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/gu, '').trim()
}

function planningText(query: string): string {
  return query
    .replace(/\bfrnds\b/giu, 'friends')
    .replace(/\bppl\b/giu, 'people')
    .replace(/\bfolks\b/giu, 'people')
    .replace(/\bsales\s+people\b/giu, 'sales contacts')
    .replace(/\bsales\s+ppl\b/giu, 'sales contacts')
}

function hasPluralCategory(value: string): boolean {
  const normalized = normalizeSearch(planningText(value))
  return tokens(normalized).some((token) => CATEGORY_WORDS.has(token)) || /\bwho do i know\b/u.test(normalized)
}

function lookupTarget(query: string): string | null {
  const patterns = [
    /^\s*(?:find|find me|show|show me)\s+(.+?)[?.!]*$/iu,
    /^\s*(?:open|open up)\s+(.+?)[?.!]*$/iu,
    /^\s*what does\s+(.+?)\s+do[?.!]*$/iu,
    /^\s*tell me about\s+(.+?)[?.!]*$/iu,
    /^\s*look up\s+(.+?)(?:\s+in my contacts?)?[?.!]*$/iu,
  ]
  const candidate = patterns.map((pattern) => query.match(pattern)?.[1]).find(Boolean)
  if (!candidate) return null
  const cleaned = cleanTarget(candidate)
  if (hasPluralCategory(cleaned)) return null
  const parts = tokens(cleaned)
  if (parts.length < 2 || parts.length > 6) return null
  const genericTargets = new Set(['contact','contacts','people','person','friends','friend','professional','professionals','investor','investors','founder','founders','client','clients','partner','partners','advisor','advisors','consultant','consultants','industrial','manufacturing','startup','startups','sales','revenue'])
  if (parts.some((part) => genericTargets.has(part))) return null
  return cleaned
}

function mixedResearchTopic(query: string): string | null {
  const patterns = [
    /\b(?:research|investigate|look up|look into)\s+(.+?)(?:\s+(?:and|then)\s+(?:show|find|identify|tell)|,\s*(?:and\s+)?(?:show|find|identify|who)|;)/iu,
    /\bfind\s+current\s+(.+?)(?:\s+(?:and|then)\s+(?:people|contacts|who)|,\s*(?:and\s+)?(?:people|contacts|who)|;)/iu,
    /\bwhat(?:'s| is)\s+happening\s+(?:in|with|around)\s+(.+?)(?:,\s*(?:and\s+)?who|\s+and\s+who|[?.!]*$)/iu,
  ]
  const found = patterns.map((pattern) => query.match(pattern)?.[1]).find(Boolean)
  if (found) return cleanTarget(found)
  return null
}

function categoryTopic(query: string): string | null {
  const normalized = planningText(query)
  const match = normalized.match(/\b(?:people|friends|contacts|professionals|founders|investors|engineers|anyone)\s+(?:in|with|working in|who work in|around)\s+(.+?)[?!.]*$/iu)
    ?? normalized.match(/\b(?:find|show)\s+(?:me\s+)?(.+?)\s+(?:people|friends|contacts|professionals)[?!.]*$/iu)
    ?? normalized.match(/\bwho\s+do\s+i\s+know\s+(?:in|with|around)\s+(.+?)[?!.]*$/iu)
  return match ? cleanTarget(match[1]) : null
}

function controlledConcepts(normalized: string, rawConcepts: string[], roleTerms: string[]): string[] {
  const concepts = new Set([...rawConcepts, ...roleTerms])
  if (/\b(ai|artificial intelligence|machine learning|ml|generative ai|llm)\b/u.test(normalized)) AI_CONCEPTS.forEach((item) => concepts.add(item))
  if (/\b(startup|startups|founder|founders|venture|vc|investor|investment|funding|fundraising|angel)\b/u.test(normalized)) STARTUP_CONCEPTS.forEach((item) => concepts.add(item))
  if (FUNDRAISING.test(normalized)) FUNDRAISING_CONCEPTS.forEach((item) => concepts.add(item))
  if (/\b(sales|business development|bd|account executive|account manager|commercial|revenue|go-to-market|gtm|partnerships|customer acquisition)\b/u.test(normalized)) SALES_CONCEPTS.forEach((item) => concepts.add(item))
  if (/\b(healthcare|health tech|healthtech|medical|clinical|biotech|pharma|hospital|patient)\b/u.test(normalized)) HEALTHCARE_CONCEPTS.forEach((item) => concepts.add(item))
  if (/\b(manufacturing|industrial|factory|operations|supply chain|production)\b/u.test(normalized)) MANUFACTURING_CONCEPTS.forEach((item) => concepts.add(item))
  if (/\b(climate|cleantech|clean tech|energy|carbon|sustainability)\b/u.test(normalized)) CLIMATE_CONCEPTS.forEach((item) => concepts.add(item))
  return [...concepts].map(normalizeSearch).filter((item) => item.length > 1 && !STOP.has(item))
}

function reconnectWindow(query: string): { inactiveDays: number; staleBefore: string | null } {
  const duration = query.match(/\b(?:more than|over)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(years?|months?|days?)\b/iu)
  if (duration) {
    const amount = Number(duration[1]) || NUMBER_WORDS[normalizeSearch(duration[1])] || 0
    const unit = normalizeSearch(duration[2])
    return { inactiveDays: unit.startsWith('year') ? amount * 365 : unit.startsWith('month') ? amount * 30 : amount, staleBefore: null }
  }
  const since = query.match(/\bsince\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/iu)
  if (since) {
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december']
    return { inactiveDays: 90, staleBefore: new Date(Date.UTC(Number(since[2]), months.indexOf(normalizeSearch(since[1])), 1)).toISOString() }
  }
  return { inactiveDays: 90, staleBefore: null }
}

export function routeQuery(originalQuery: string): QueryPlan {
  const query = originalQuery.normalize('NFKC').trim()
  const normalizedPlanning = normalizeSearch(planningText(query))
  const personMatch = query.match(PERSON_QUESTION)
  const companyMatch = query.match(COMPANY_QUESTION)
  const hasNetwork = NETWORK.test(query) || /\bwho do i know\b/iu.test(normalizedPlanning)
  const hasIntro = INTRO.test(query)
  const reconnect = RECONNECT.test(query)
  const current = CURRENT_RESEARCH.test(query)
  const lookup = lookupTarget(query)
  const hasCategory = CATEGORY_SIGNAL.test(query)
  const hasDomain = DOMAIN_SIGNAL.test(normalizedPlanning)
  const wantsPrivateContacts = hasNetwork || hasCategory || /\bwho\s+(?:can|could|should)\s+i\s+(?:ask|contact|talk to)\b/iu.test(query)
  const wantsPublicResearch = current
  let intent: QueryIntent = 'UNKNOWN'
  let targetName: string | null = null
  let targetType: QueryPlan['targetType'] = null
  let confidence = 0.62

  if (MESSAGE.test(query)) { intent = 'MESSAGE_DRAFT'; confidence = 0.99 }
  else if (reconnect) { intent = 'RECONNECT'; confidence = 0.98 }
  else if (hasIntro) {
    intent = 'INTRODUCTION_PATH'; confidence = 0.99
    const match = query.match(/(?:introduce me to|introduction to|connect me (?:with|to)|intro to|vorstellen)\s+(.+?)[?!.]*$/iu)
    targetName = cleanTarget(match?.[1] ?? query)
    targetType = /\b(company|gmbh|inc\.?|ltd\.?|corp\.?|ag|startup)\b/iu.test(targetName) ? 'COMPANY' : 'PERSON'
  } else if (lookup) { intent = 'CONTACT_LOOKUP'; targetName = lookup; targetType = 'PERSON'; confidence = 0.97 }
  else if (wantsPublicResearch && wantsPrivateContacts) { intent = 'MIXED_RESEARCH'; confidence = 0.97 }
  else if (/\b(?:research|look up|investigate|look into)\b/iu.test(query) && /\b(?:my network|who|contacts?|people|friends?|professionals?|investors?|founders?)\b/iu.test(planningText(query))) { intent = 'MIXED_RESEARCH'; confidence = 0.95 }
  else if (hasNetwork) { intent = 'NETWORK_SEARCH'; confidence = 0.98 }
  else if (hasCategory && hasDomain) { intent = 'NETWORK_SEARCH'; confidence = 0.9 }
  else if (personMatch) { intent = 'GENERAL_WEB'; targetName = cleanTarget(personMatch[2]); targetType = 'PERSON'; confidence = 0.98 }
  else if (companyMatch || current) { intent = 'GENERAL_WEB'; targetName = cleanTarget(companyMatch?.[1] ?? query); targetType = 'COMPANY'; confidence = 0.9 }

  if (intent === 'MIXED_RESEARCH' && !targetName) {
    const mixedTarget = mixedResearchTopic(query)
    if (mixedTarget) { targetName = cleanTarget(mixedTarget); targetType = /\b(?:company|gmbh|inc\.?|ltd\.?|corp\.?|ag)\b/iu.test(mixedTarget) ? 'COMPANY' : 'TOPIC' }
  }
  if (intent === 'NETWORK_SEARCH' && !targetName) targetName = categoryTopic(query)

  const locations = LOCATION_MAP.filter((location) => normalizedPlanning.includes(normalizeSearch(location)))
  const locationTokens = new Set(locations.flatMap((location) => tokens(location)))
  const roleTerms = ROLE_MAP.filter((role) => normalizedPlanning.includes(role))
  const rawConcepts = [...new Set(tokens(planningText(query)).filter((token) => token.length > 2 && !STOP.has(token) && !locationTokens.has(token)))]
  const domainConcepts = controlledConcepts(normalizedPlanning, FUNDRAISING.test(query) ? [...rawConcepts, ...FUNDRAISING_CONCEPTS] : rawConcepts, roleTerms)
  const window = reconnectWindow(query)
  const mixed = intent === 'MIXED_RESEARCH'
  const geography = locations[0] ?? null
  const publicTopic = mixed ? (targetName ?? mixedResearchTopic(query) ?? query) : null
  const networkTopic = intent === 'NETWORK_SEARCH' ? (targetName ?? categoryTopic(query) ?? query) : publicTopic
  const publicResearch = mixed && publicTopic ? { enabled: true, topic: publicTopic, geography, timeframe: current ? 'current' as const : 'unspecified' as const } : null
  const networkSearch = (mixed || intent === 'NETWORK_SEARCH' || intent === 'RECONNECT') ? { enabled: true, topic: networkTopic ?? query, geography, concepts: domainConcepts } : null
  const executionOrder = intent === 'MIXED_RESEARCH' ? ['WEB_SEARCH' as const, 'NETWORK_SEARCH' as const]
    : intent === 'CONTACT_LOOKUP' ? ['CONTACT_LOOKUP' as const]
      : intent === 'INTRODUCTION_PATH' ? ['VERIFIED_PATH' as const]
        : intent === 'NETWORK_SEARCH' || intent === 'RECONNECT' ? ['NETWORK_SEARCH' as const]
          : intent === 'MESSAGE_DRAFT' ? ['DRAFT' as const]
            : intent === 'GENERAL_WEB' ? ['WEB_SEARCH' as const]
              : []
  return queryPlanSchema.parse({
    intent, originalQuery: query, targetName, targetType,
    concepts: domainConcepts, domainConcepts,
    exactNameTerms: targetName && intent === 'CONTACT_LOOKUP' ? tokens(targetName) : [],
    roleTerms, companyTerms: [], locations,
    temporalRequirement: reconnect ? 'STALE' : current ? 'CURRENT' : 'NONE',
    inactiveDays: reconnect ? window.inactiveDays : null,
    staleBefore: reconnect ? window.staleBefore : null,
    requiresCurrentWebData: intent === 'GENERAL_WEB' || intent === 'MIXED_RESEARCH',
    requiresVerifiedPath: intent === 'INTRODUCTION_PATH', confidence,
    publicResearch, networkSearch, executionOrder,
  })
}
