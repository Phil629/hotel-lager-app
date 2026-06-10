# 🏗️ Checkout Automation Architecture

Dieses Dokument beschreibt die hochkomplexe B2B-Automatisierungs-Architektur des Hotel-Inventory-Projekts. **Jeder KI-Agent muss dies wissen, um den vollen Kontext des "Warenkorb-Packers" zu verstehen.**

## 1. Das Konzept: Hybrid-Architektur
Die App kann Hotel-Einkäufe (z.B. bei Kaiserkraft, Gaerner, Lusini) vollautomatisch durchführen. Dafür gibt es zwei Handoff-Strategien:
- **Cloud (`strategy: 'cloud'`):** Ein Headless-Browser (via Browserless.io) wird auf einem Server gestartet. Die Supabase Edge Function steuert den Browser, loggt sich ein, packt den Warenkorb und übergibt die finale Session-URL.
- **Extension (`strategy: 'extension'`):** Ein Service Worker in einer lokalen Chrome Extension (Ordner `chrome-extension/`) übernimmt den Browser des Nutzers. Die React-App sendet über ein lokales Event (`HOTEL_CHECKOUT_START`) ein Token an die Extension, welche dann die Arbeit verrichtet.

## 2. Die Supabase Edge Functions ("Das Gehirn")
- **`trigger-checkout`**: Der Einstiegspunkt. Validiert Nutzer, ruft sichere Credentials ab, erstellt eine `checkout_sessions` Tabellenzeile. Wenn Cloud-Strategie gewählt ist, sendet es das Playwright-Skript an Browserless.
- **`_playwright_script.ts`**: Ein dynamisch generiertes Skript, das in der Cloud ausgeführt wird. Es enthält die Logik für Login, Suchen, Befüllen (mit speziellen Fallbacks für React- und WebComponents-Felder) und **Preis-Prüfungen**.
- **`self-heal-selector`**: Die Vision-KI-Rettung. Schlägt ein Klick in Playwright fehl (z.B. Button-ID hat sich geändert), wird ein Screenshot + HTML an diese Funktion gesendet. Eine GPT-4o ähnliche KI sucht den neuen Selektor, speichert ihn in die Datenbank und das Skript versucht es direkt erneut.
- **`start-learning`**: Automatisiertes Lernen von unbekannten Shop-Layouts.

## 3. Sicherheit (Supabase Vault)
- **`pgcrypto`**: Passwörter für Lieferanten-Webshops (`user_supplier_credentials`) werden niemals im Klartext gespeichert. Sie sind mit AES-256 über Supabase Vault verschlüsselt und werden nur kurz in der sicheren Edge Function (via RPC `get_supplier_credentials`) entschlüsselt, um an den Browser übergeben zu werden.

## 4. Lokale Logfiles & Tests
Im Root-Verzeichnis befinden sich diverse Node-Skripte (`.cjs`, `.mjs`) und `.log`-Dateien (z.B. `kaiserkraft_flawless.log`, `run_10_shops.log`). Diese beweisen, dass die Automatisierung für zahlreiche große Shops bereits fehlerfrei entwickelt und getestet wurde.

---
*Erstellt am 10. Juni 2026 zur Kontext-Bewahrung über Chat-Grenzen hinweg.*
