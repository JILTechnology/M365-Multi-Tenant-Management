# M365 Multi Tenant Management

A desktop application for Managed Service Providers (MSPs) to manage multiple Microsoft 365 tenant accounts simultaneously using isolated browser sessions.

## Features (Planned)

- Isolated Chromium sessions per tenant (no cookie/session bleed)
- Sidebar for quick tenant switching
- Persistent sessions across app restarts
- Auto-open admin portals (Entra, Admin Center, Intune, Exchange)
- Windows desktop app (.exe installer)

## Tech Stack

- **Electron** - Desktop application framework (Chromium + Node.js)
- **React** - User interface
- **TypeScript** - Type safety
- **Vite** - Build tooling (via Electron Forge)

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+ (LTS recommended)
- npm 10+

### Getting Started

```bash
# Install dependencies
npm install

# Start the app in development mode
npm start
```

### Building

```bash
# Package the app (no installer)
npm run package

# Build a distributable installer (.exe on Windows)
npm run make
```

## License

MIT
