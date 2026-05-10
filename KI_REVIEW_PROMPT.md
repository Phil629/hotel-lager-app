# Claude Code Review Prompt

Kopiere den folgenden Textblock und füge ihn in dein Claude Code Terminal ein:

---

```text
Bitte lade den gesamten Code dieses Projekts und führe ein umfassendes, tiefgehendes Audit der Software durch.

Es handelt sich um eine B2B SaaS-Applikation ("Bestellwesen" für Gastronomie/Hotellerie). 
Tech-Stack: React (Vite), TypeScript, Supabase (Auth, Datenbank, RLS, Realtime).
Features: Multi-Tenancy (Unternehmen mit Admins & Mitarbeitern), Inventar- & Lieferantenverwaltung, Bestellabwicklung (via E-Mail/Webshop).

Dein Auftrag:
Bitte lies dich vollkommen selbstständig in die GESAMTE Software ein. Die Software ist exakt wie folgt strukturiert und du MUSST all diese Bereiche lesen:
- **Frontend Quellcode:** Befindet sich komplett im Ordner `src/`. Analysiere hier ALLE Dateien in den Unterordnern `src/pages/`, `src/components/`, `src/services/` und `src/types/`.
- **Datenbank & Backend (Supabase):** Befindet sich im Root-Verzeichnis in den `supabase_*.sql` Dateien (insbesondere `supabase_schema_full.sql`, `supabase_saas_policies.sql`, `supabase_admin_setup.sql` und `supabase_team_audit_schema.sql`).
- **Konfiguration:** `package.json`, `vite.config.ts` und `netlify.toml` im Root-Verzeichnis.

Verschaffe dir ein vollständiges Bild des kompletten Quellcodes anhand dieser spezifischen Pfade.

Tauche tief in diese Codebase ein und analysiere die gesamte Software extrem kritisch. Es geht bald live! Ich erwarte, dass du jeden Winkel der Architektur durchleuchtest. 

Bitte prüfe folgende Aspekte tiefgehend:
1. Sicherheit & Multi-Tenancy: Sind die Supabase SQL-Regeln (RLS), Policies und Security-Definer Funktionen absolut sicher und manipulationssicher? Gibt es Schwachstellen im Anmelde- oder Einladungsprozess?
2. Geschäftslogik & Datenfluss: Wie stabil und fehlerfrei ist der Kern der App (Bestellungen erstellen, Status-Updates, automatischer Verbrauch, Realtime-Synchronisation)? Wo könnte die Logik kaputtgehen?
3. Code-Qualität & React-Best-Practices: Findest du Performance-Probleme, Memory Leaks, unsaubere Abhängigkeiten oder unhandliche State-Verwaltung?
4. Design & UX: Ist das Konzept für den User überall durchdacht? Gibt es fehlende Fallbacks (z.B. Offline-Handling) oder logische Lücken in der Benutzeroberfläche?

Gib mir am Ende einen detaillierten, ungeschönten Bericht mit konkreten Verbesserungsvorschlägen, priorisiert nach "Kritisch", "Warnung" und "Optimierung".
```
