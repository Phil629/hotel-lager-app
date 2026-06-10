# 🚀 AGENT RULES & DEVELOPER GUIDELINES

**WICHTIG:** Jeder KI-Agent MUSS diese Datei zu Beginn einer neuen Konversation oder bei der Übernahme von Aufgaben in diesem Repository lesen und sich strikt an diese Regeln halten. 
Diese Vorgaben sichern die Qualität und Stabilität des Projekts auf dem Niveau eines professionellen Software-Startups.

---

## 1. 🌿 Git-Flow & Branching-Strategie
- **Niemals direkt auf `main` pushen:** Der `main`-Branch ist heilig und spiegelt 1:1 die Live-Umgebung wider. Direkte Commits oder Pushes dorthin sind absolut verboten.
- **Feature-Branches nutzen:** Für jede neue Funktion, Bugfix oder UX-Überarbeitung MUSS ein separater Branch erstellt werden (z. B. `feature/ux-bestellung`, `fix/login-bug`).
- **Staging für Tests:** Feature-Branches werden zuerst in den `staging`-Branch gemerged oder gepusht. Die Testumgebung (Staging) dient der Validierung durch den Nutzer.
- **Merge auf Main nur nach Freigabe:** Erst wenn der Nutzer die Änderungen auf `staging` ausdrücklich abnimmt, darf (meist per Pull Request oder sauberem Merge) auf `main` übertragen werden.

## 2. 📝 Planning Mode & Freigabeprozesse
- **Keine eigenmächtigen Umbauten:** Bevor signifikante Änderungen am Code vorgenommen werden (Architektur, UI/UX-Flows, neue Libraries), MUSS ein `implementation_plan.md` erstellt werden.
- **Auf Bestätigung warten:** Nach Vorlage eines Konzepts oder Plans stoppt der Agent seine Arbeit und wartet auf ein explizites "Go" des Nutzers.
- **Anweisungen exakt befolgen:** Wenn der Nutzer um einen *Entwurf*, ein *Konzept* oder einen *Prompt für eine andere KI (z. B. Claude)* bittet, wird **NUR** dies geliefert. Es wird nicht voreilig Code geschrieben oder gar unaufgefordert gepusht.

## 3. 🎨 UX/UI Excellence & Code-Qualität
- **Frictionless Design:** Neue Features müssen im Hotel-Alltag extrem schnell und fehlerfrei bedienbar sein. Jeder unnötige Klick ist einer zu viel.
- **Clean Code:** Keine "Quick & Dirty" Hacks. Typescript-Typisierungen sind strikt einzuhalten. Build-Errors (z. B. durch `npm run build`) müssen VOR jedem Commit gelöst sein.
- **Best Practices:** Achte auf moderne, gut lesbare React-Strukturen, sinnvolles State-Management und wiederverwendbare Komponenten.

## 4. 🚨 Fehlerkultur & Sicherheit
- **Im Zweifel nachfragen:** Bei unklaren Anforderungen wird nicht geraten, sondern eine klärende Frage gestellt.
- **Lokale Tests:** Code muss vor dem Commit immer lokal verifiziert werden (z. B. durch `npm run build` oder den TypeScript-Compiler).
- **Hooks respektieren:** Vorhandene Git-Hooks (wie `pre-push`) dürfen nicht ohne ausdrücklichen Grund mit `--no-verify` umgangen werden, es sei denn, es handelt sich um ein bewusstes Live-Deployment nach Freigabe.

---
*Hinweis für den Agenten: Bestätige dem Nutzer kurz, dass du diese Regeln gelesen und verinnerlicht hast, sobald du diesen Text siehst.*
