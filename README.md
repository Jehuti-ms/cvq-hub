# CVQ Hub

Offline-first trainee progress & teacher effort tracker for CVQ programmes.

## What it does

- **Trainee progress** — session log, evidence capture, marks, attendance
- **Teacher effort** — hours & sessions per class, per unit, per period
- **Works offline** — every change queues locally and syncs when back online
- **Built for phones** — one-handed use, native camera capture
- **CVQ-aligned** — logs against units and learning outcomes

## Stack

| Layer         | Technology                            |
| ------------- | ------------------------------------- |
| Frontend      | Vanilla JS (ES modules), no framework |
| Hosting       | GitHub Pages                          |
| Backend       | Google Apps Script Web App            |
| Database      | Google Sheets                         |
| Media storage | Google Drive                          |
| Auth          | Google Identity Services              |

## Local development

**Requirements:** Node.js 18+, any modern browser, git.

```bash
npm install        # one-time
npm run icons      # generate placeholder icons
npm run dev        # starts dev server at http://localhost:5173
```
