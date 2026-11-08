export const GEMINI_MODELS_LIST = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.0-flash',
] as const

export interface GeminiCallOptions {
  apiKey?: string
  parts: unknown[]
  totalBudgetMs?: number
  temperature?: number
  responseMimeType?: string | null
  models?: readonly string[]
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
}

export interface GeminiCallResult {
  ok: boolean
  model: string | null
  rawText: string
  parsedData: any
  apiErrorData: any
  usageMetadata: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  } | null
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

export function extractGeminiJson(rawText: string): any {
  const cleaned = String(rawText || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()
  return JSON.parse(cleaned)
}

export async function callGeminiApi(options: GeminiCallOptions): Promise<GeminiCallResult> {
  const {
    apiKey,
    parts,
    totalBudgetMs = 110_000,
    temperature = 0.2,
    responseMimeType = 'application/json',
    models = GEMINI_MODELS_LIST,
    fetchImpl = fetch,
    sleepImpl = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options

  if (!apiKey) {
    return {
      ok: false,
      model: null,
      rawText: '',
      parsedData: {
        parse_error: 'GEMINI_API_KEY fehlt',
        raw_text: '',
      },
      apiErrorData: { error: { code: 500, message: 'GEMINI_API_KEY not configured' } },
      usageMetadata: null,
    }
  }

  const isFastInteractive = totalBudgetMs <= 35_000
  const maxAttemptsPerModel = isFastInteractive ? 1 : 2
  const perAttemptTimeoutMs = isFastInteractive ? Math.min(12_000, Math.max(4_000, Math.floor(totalBudgetMs * 0.6))) : 18_000
  const startedAt = Date.now()

  let geminiRes: Response | null = null
  let geminiData: any = null
  let usedModel: string | null = null

  modelLoop:
  for (let m = 0; m < models.length; m++) {
    const modelName = models[m]
    const modelUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`
    const supportsThinkingConfig = /gemini-2\.5|gemini-flash-latest|gemini-flash-lite-latest/i.test(modelName)

    const generationConfig: Record<string, unknown> = {
      temperature,
      ...(responseMimeType ? { responseMimeType } : {}),
      ...(isFastInteractive && supportsThinkingConfig ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    }

    const requestBody = JSON.stringify({
      contents: [{ parts }],
      generationConfig,
    })

    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      const remaining = totalBudgetMs - (Date.now() - startedAt)
      if (remaining < 2_500) break modelLoop

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.min(perAttemptTimeoutMs, remaining))
      let retryAfterMs = 0

      try {
        usedModel = modelName
        geminiRes = await fetchImpl(modelUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
          signal: controller.signal,
        })
        geminiData = await geminiRes.json().catch(() => ({
          error: { code: geminiRes!.status, message: 'Invalid JSON from Gemini' },
        }))

        if (geminiRes.ok && geminiData?.candidates?.length) break modelLoop
        if (!RETRYABLE_STATUS.has(geminiRes.status) && geminiRes.ok) {
          break modelLoop
        }
        if (!geminiRes.ok && !RETRYABLE_STATUS.has(geminiRes.status)) {
          if (geminiRes.status === 404 || geminiRes.status === 400) continue modelLoop
          break modelLoop
        }
        if (geminiRes.status === 429) {
          const errText = JSON.stringify(geminiData)
          const delayMatch = errText.match(/"retryDelay":"(\d+)s"/)
          const retryDelaySec = delayMatch ? Number(delayMatch[1]) : 0
          if (/PerDay|FreeTier|quota/i.test(errText) || retryDelaySec > 30) {
            console.warn(`Gemini model "${modelName}": quota exhausted (retryDelay ${retryDelaySec}s) – switching model`)
            continue modelLoop
          }
        }
        const ra = Number(geminiRes.headers.get('retry-after'))
        if (Number.isFinite(ra) && ra > 0) retryAfterMs = ra * 1000
        if (retryAfterMs > 30_000) continue modelLoop
        console.warn(`Gemini model "${modelName}" attempt ${attempt} failed with ${geminiRes.status}, retrying...`)
      } catch (err) {
        console.warn(`Gemini model "${modelName}" attempt ${attempt} network/timeout error:`, String(err))
        geminiRes = null
        geminiData = { error: { code: 504, message: `Network/timeout error: ${String(err)}` } }
      } finally {
        clearTimeout(timer)
      }

      if (attempt < maxAttemptsPerModel) {
        const backoff = Math.max(retryAfterMs, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400)
        const remainingAfter = totalBudgetMs - (Date.now() - startedAt)
        if (backoff > remainingAfter - 4_000) break
        await sleepImpl(backoff)
      }
    }
  }

  let parsedData: any = {
    document_type: 'unknown',
    should_create_order: false,
    supplier_name: 'Unbekannter Lieferant (KI)',
    items: [],
  }
  let rawText = ''
  let ok = false

  if (geminiRes?.ok && geminiData?.candidates?.[0]?.content?.parts?.[0]?.text) {
    rawText = geminiData.candidates[0].content.parts[0].text
    if (responseMimeType === 'application/json') {
      try {
        parsedData = extractGeminiJson(rawText)
        ok = true
      } catch (e) {
        console.error(`Failed to parse Gemini JSON output (model=${usedModel}):`, rawText, e)
        parsedData = {
          parse_error: String(e),
          raw_text: rawText.substring(0, 1000),
          gemini_api_error: geminiData,
        }
      }
    } else {
      parsedData = { text: rawText.trim() }
      ok = true
    }
  } else {
    console.error('Gemini API returned invalid structure or error:', JSON.stringify(geminiData))
    parsedData = {
      parse_error: geminiData?.error?.message || 'Ungültige oder leere Gemini-Antwort',
      raw_text: JSON.stringify(geminiData).substring(0, 1000),
      gemini_api_error: geminiData,
    }
  }

  return {
    ok,
    model: ok ? usedModel : null,
    rawText,
    parsedData,
    apiErrorData: geminiData,
    usageMetadata: geminiData?.usageMetadata ?? null,
  }
}
