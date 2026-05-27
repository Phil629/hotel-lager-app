# Supabase Setup Context (Hotel Inventory App / Bestell-App)

**WICHTIG FÜR DEN KI-ASSISTENTEN (Antigravity):**
Wenn du diesen Text in einem neuen Chat liest, weißt du, dass die Supabase-Kommandozeile auf diesem PC bereits fertig eingerichtet ist.

- **Lokaler Projekt-Ordner:** `C:\Users\phdeh\.gemini\antigravity\hotel-inventory-app`
- **Supabase CLI Status:** Erfolgreich global eingeloggt (Access Token ist hinterlegt).
- **Test-Umgebung:** `tfsqkzjvonuzmspgqaby`
- **Live-Umgebung:** `owofhbbrywryehlnqmfj`

**Wichtige Regeln für die Ausführung:**
1. Der lokale Ordner hat bereits einen `supabase` Ordner.
2. Führe CLI-Befehle immer mit `npx.cmd` anstelle von `npx` aus, um PowerShell-Blockaden unter Windows zu umgehen (z.B. `npx.cmd supabase db push`).
3. Datenbank-Änderungen machst du standardmäßig über Migrationen (im Ordner `supabase/migrations/`) und pushst sie auf die Testumgebung.
4. Wenn ein Push auf die Live-Umgebung angefordert wird, nutze `npx.cmd supabase db push --project-ref owofhbbrywryehlnqmfj` (der User wird dann im Terminal einmalig nach dem Live-Passwort gefragt).
