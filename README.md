# VS Web Studio AI Voice Agent

AI-powered voice assistant for VS Web Studio.

## Current status

Phase 1 – Project Foundation. This repository currently provides the typed Express backend foundation and OpenAI client configuration. Voice sessions and integrations are not implemented yet.

## Architecture roadmap

1. **Phase 1:** Backend foundation
2. **Phase 2:** Browser voice MVP using OpenAI Realtime + WebRTC
3. **Phase 3:** Agent tools / function calling
4. **Phase 4:** Google Calendar + LeadFlow integration
5. **Phase 5:** Twilio / SIP telephone sandbox
6. **Phase 6:** Human handoff and controlled consented callbacks

## Installation

```bash
npm install
```

## Environment setup

Copy `.env.example` to `.env`, then provide your server-side OpenAI API key.

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead.

Never commit `.env` or expose its values to client-side code.

## Development

```bash
npm run dev
```

The server starts on the configured `PORT` (default: `3001`). Check it at `GET /health`.

## Type checking

```bash
npm run typecheck
```

## Build

```bash
npm run build
```

Run the compiled server with `npm start`.
