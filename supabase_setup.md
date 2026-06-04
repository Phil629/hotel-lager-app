# CLI Setup Context (Hotel Inventory App / Bestell-App)

**WICHTIG FÜR DEN KI-ASSISTENTEN (Antigravity & Claude Code):**
Wenn du diesen Text in einem neuen Chat liest, weißt du, dass die Kommandozeilen-Tools (Supabase & Netlify) auf diesem PC fertig eingerichtet sind.

- **Lokaler Projekt-Ordner:** `C:\Users\phdeh\.gemini\antigravity\hotel-inventory-app`
- **Umgebung:** Windows PowerShell

## Supabase CLI
- **Status:** Erfolgreich global eingeloggt.
- **Test-Umgebung:** `tfsqkzjvonuzmspgqaby` (Lokal verknüpft)
- **Live-Umgebung:** `owofhbbrywryehlnqmfj`
- **Wichtig:** Führe Befehle immer mit `npx.cmd supabase` (statt `npx`) aus.
- **Workflow:** Push auf Test (`npx.cmd supabase db push`), Push auf Live (`npx.cmd supabase db push --project-ref owofhbbrywryehlnqmfj`).

## Netlify CLI
- **Status:** Erfolgreich eingeloggt und verknüpft (Lager Hotel / kunden.bestellwesen.com).
- **Wichtig:** Führe Befehle immer mit `npx.cmd netlify` aus.
- **Workflow:** Für ein Live-Deployment nutze z.B. `npx.cmd netlify deploy --prod`.
