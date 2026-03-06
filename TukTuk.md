# 🛺 Tuktuk Hire Manager - PWA Development Guide

Meka drivers lata thamange daily hires saha income eka track karaganna puluwan simple PWA (Progressive Web App) ekak. HTML, CSS, saha JavaScript (PWA features ekka) mekata use karala thiyenawa.

## 📁 Project Structure (File Piliwela)
Meka thamai oyage folder eka athule thiyenna ona file structure eka:
- `index.html` (Main UI eka)
- `style.css` (Design eka)
- `app.js` (Logic saha Database eka)
- `sw.js` (Service Worker - Offline wada karanna)
- `manifest.json` (Phone ekata install karaganna)
- `icon.png` (App icon eka - 512x512 size ekakin danna)

---

## 1️⃣ Web Manifest (`manifest.json`)
Meka thamai phone ekata kiyanne meka "App" ekak kiyala.

```json
{
  "name": "Tuktuk Hire Manager",
  "short_name": "TukHelper",
  "start_url": "index.html",
  "display": "standalone",
  "background_color": "#ffcc00",
  "theme_color": "#ffcc00",
  "icons": [
    {
      "src": "icon.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}