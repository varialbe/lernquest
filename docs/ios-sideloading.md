# LernQuest aufs iPhone bringen

Es gibt zwei Wege. **Empfehlung: die Web-App (PWA)**: kein Ablaufdatum, Push-Erinnerungen funktionieren, Updates kommen automatisch.

## Weg 1: PWA (empfohlen, 1 Minute)
1. Auf dem iPhone in **Safari** `https://lern.varialbe.xyz` öffnen und einloggen.
2. Teilen-Symbol → **„Zum Home-Bildschirm“** → Hinzufügen.
3. LernQuest jetzt **vom Home-Bildschirm** öffnen (nicht aus Safari).
4. Profil → Einstellungen → **Streak-Erinnerung** einschalten und „Erlauben“ tippen.
   Web Push gibt es auf iOS (ab 16.4) nur für installierte Web-Apps, deshalb geht das nur so.

## Weg 2: Native App (unsignierte IPA, Sideloading)
Die IPA wird von GitHub Actions gebaut (`.github/workflows/ios-ipa.yml`, manuell per „Run workflow“ oder bei Tags `v*`).
Sie ist **unsigniert**. Du signierst sie beim Installieren mit deiner **eigenen, kostenlosen Apple-ID**.

**Wichtig zu wissen**
- Mit einer kostenlosen Apple-ID läuft die App **7 Tage**, danach muss sie neu signiert („refresht“) werden. Deine Daten bleiben erhalten, die liegen auf dem Server.
- Höchstens **3 selbst signierte Apps** gleichzeitig pro Apple-ID.
- **Keine Push-Benachrichtigungen** in der nativen App (APNs braucht einen bezahlten Developer-Account). Für Streak-Erinnerungen zusätzlich die PWA nutzen.
- Ab iOS 16 muss der **Entwicklermodus** aktiv sein: Einstellungen → Datenschutz & Sicherheit → Entwicklermodus.

### Variante A: Sideloadly (Windows/macOS, am einfachsten)
1. IPA herunterladen: GitHub → `varialbe/lernquest` → Actions → „iOS IPA (unsigned)“ → letzter Lauf → Artifact `LernQuest-unsigned-ipa` (oder unter Releases).
2. [Sideloadly](https://sideloadly.io) installieren (Windows: zusätzlich iTunes und iCloud von apple.com, **nicht** aus dem Microsoft Store).
3. iPhone per Kabel verbinden, „Diesem Computer vertrauen“.
4. IPA in Sideloadly ziehen, Apple-ID eintragen → **Start**.
5. Auf dem iPhone: Einstellungen → Allgemein → VPN & Geräteverwaltung → deine Apple-ID → **Vertrauen**.
6. Alle 7 Tage: in Sideloadly erneut auf Start (oder „Automatic refresh“ aktivieren, solange der PC im selben WLAN ist).

### Variante B: SideStore (ohne PC-Zwang, refresht auf dem iPhone selbst)
1. Einmalig SideStore nach der Anleitung auf [sidestore.io](https://sidestore.io) installieren (braucht einmal einen PC und die „Pairing File“).
2. Die IPA in der Dateien-App speichern → in SideStore „+“ → IPA wählen.
3. SideStore refresht die App alle 7 Tage per Tippen auf „Refresh All“ (oder per Kurzbefehl-Automation).

## Für Freunde
- Jede Person braucht **ihre eigene Apple-ID** zum Signieren und einen **Einladungscode** für LernQuest. Den Code bekommst du im Admin-Bereich → Einladungen → „Code erzeugen“ (der Link wird gleich kopiert).
- Wem Sideloading zu umständlich ist: Weg 1 (PWA) reicht völlig.
