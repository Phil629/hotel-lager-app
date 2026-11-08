import { describe, it, expect } from 'vitest'
import { GEMINI_MODELS_LIST, callGeminiApi, extractGeminiJson } from './gemini'

describe('gemini shared router', () => {
  it('uses active supported models and excludes deprecated 1.5 models', () => {
    expect(GEMINI_MODELS_LIST[0]).toBe('gemini-2.5-flash')
    expect(GEMINI_MODELS_LIST).toContain('gemini-2.5-flash-lite')
    expect(GEMINI_MODELS_LIST.some((m) => m.includes('1.5'))).toBe(false)
  })

  it('fails cleanly when GEMINI_API_KEY is missing without mock fallback', async () => {
    const res = await callGeminiApi({ apiKey: '', parts: [{ text: 'hi' }] })
    expect(res.ok).toBe(false)
    expect(res.model).toBeNull()
    expect(res.parsedData.parse_error).toContain('GEMINI_API_KEY')
  })

  it('extracts JSON wrapped in markdown code fences', () => {
    const parsed = extractGeminiJson('```json\n{"results":[{"id":"1"}]}\n```')
    expect(parsed.results).toEqual([{ id: '1' }])
  })

  it('immediately switches model on PerDay quota 429 and returns winning model', async () => {
    const calledModels: string[] = []
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input)
      calledModels.push(url)
      if (url.includes('gemini-2.5-flash:')) {
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier quota exceeded',
            },
          }),
          { status: 429 },
        )
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"results":[{"id":"p1","category":"Hygiene"}]}' }] } }],
        }),
        { status: 200 },
      )
    }

    const res = await callGeminiApi({
      apiKey: 'test-key',
      parts: [{ text: 'analyze' }],
      totalBudgetMs: 25_000,
      fetchImpl: mockFetch,
      sleepImpl: async () => {},
    })

    expect(res.ok).toBe(true)
    expect(res.model).toBe('gemini-2.5-flash-lite')
    expect(calledModels.length).toBe(2)
    expect(res.parsedData.results[0].category).toBe('Hygiene')
  })

  it('supports plain-text responses and omits thinkingConfig for gemini-2.0-flash', async () => {
    const bodies: any[] = []
    const mockFetch: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body || '{}')))
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '  Kopierpapier A4  ' }] } }],
        }),
        { status: 200 },
      )
    }

    const res = await callGeminiApi({
      apiKey: 'test-key',
      parts: [{ text: 'search term' }],
      models: ['gemini-2.0-flash'],
      responseMimeType: null,
      totalBudgetMs: 20_000,
      fetchImpl: mockFetch,
      sleepImpl: async () => {},
    })

    expect(res.ok).toBe(true)
    expect(res.parsedData.text).toBe('Kopierpapier A4')
    expect(bodies[0].generationConfig.thinkingConfig).toBeUndefined()
    expect(bodies[0].generationConfig.responseMimeType).toBeUndefined()
  })

  it('returns ok: false when all models fail (no unrequested fallback items)', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: 503, message: 'Overloaded' } }), { status: 503 })

    const res = await callGeminiApi({
      apiKey: 'test-key',
      parts: [{ text: 'test' }],
      totalBudgetMs: 20_000,
      fetchImpl: mockFetch,
      sleepImpl: async () => {},
    })

    expect(res.ok).toBe(false)
    expect(res.model).toBeNull()
    expect(res.parsedData.items).toBeUndefined()
  })
})
