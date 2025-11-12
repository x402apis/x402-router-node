# @x402apis/node

Provider node software for earning money by serving APIs through the x402 network.

## Installation

```bash
npm install @x402apis/node
```

## Quick Start

```typescript
import { createProviderServer } from "@x402apis/node";

const server = createProviderServer({
  wallet: "./wallet.json",
  port: 9000,
});

// Add your API
server.addAPI(
  "openai.chat",
  async (params) => {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    return response.json();
  },
  {
    price: 0.045, // $0.045 per request
  },
);

await server.start();
```

## Examples

See `/examples` for ready-to-use templates:

- `openai.ts` - OpenAI GPT
- `deepgram.ts` - Speech-to-text
- `elevenlabs.ts` - Text-to-speech
- `custom-api.ts` - Generic template

## Configuration

```typescript
interface ServerConfig {
  wallet: string; // Path to wallet keypair
  port?: number; // Server port (default: 9000)
  publicUrl?: string; // Public URL (for NAT/proxy)
  registry?: string; // Registry URL (default: x402apis.io/api)
  chains?: Chain[]; // Supported chains (default: ['solana'])
  defaultPrice?: number; // Default price (default: 0.01)
  logging?: boolean; // Enable logs (default: true)
}
```

## How It Works

1. You run a node with your API keys
2. Node registers with central registry
3. Clients discover your node
4. They pay via x402 → you proxy their request → you keep the USDC

## License

MIT
