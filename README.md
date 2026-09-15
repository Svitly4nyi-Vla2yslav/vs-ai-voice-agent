# VS Web Studio AI Voice Agent

AI-powered voice assistant for VS Web Studio.

## Current status

Phase 2B – The Express backend now serves a minimal browser WebRTC voice test and creates short-lived Realtime client credentials. Tools and external integrations are not implemented yet.

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

## OpenAI API setup

1. Create `.env` from `.env.example`.
2. Add your server-side `OPENAI_API_KEY` to `.env`.
3. Verify API connectivity and authentication:

```bash
npm run check:openai
```

The check reads the existing environment configuration and OpenAI client. It does not generate a response or start a Realtime session.

## Development

```bash
npm run dev
```

The server starts on the configured `PORT` (default: `3001`). Check it at `GET /health`.

## Browser voice test

1. Start the server with `npm run dev`.
2. Open `http://localhost:3001` in a WebRTC-capable browser.
3. Select **Start conversation** and allow microphone access.
4. Speak in German, then select **End conversation** to close the session.

The permanent OpenAI API key remains on the server. The browser receives only a short-lived Realtime client credential and does not persist it.

## Type checking

```bash
npm run typecheck
```

## Build

```bash
npm run build
```

Run the compiled server with `npm start`.
