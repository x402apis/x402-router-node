import express, { Express, Request, Response } from 'express';
import { Keypair } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { Chain, DEFAULT_REGISTRY_URL } from '@x402apis/protocol';
import { paymentMiddleware } from './middleware';
import { RegistryClient } from './registry-client';
import { ServerConfig, APIHandler, APIConfig, ProviderServer, ServerStats } from './types';
import { ProviderNodeError, APINotFoundError } from './errors';
import { generateRequestId, loadWallet } from './utils';
import { Server as HttpServer } from 'http'; // Import with an alias to avoid name conflicts
import cors from 'cors'; // --- IMPORT CORS ---

/**
 * Create a new provider server
 */
export function createProviderServer(config: ServerConfig): ProviderServer {
    const {
        wallet: walletPath,
        port = 9000,
        publicUrl,
        registry = 'http://localhost:3000/api',// DEFAULT_REGISTRY_URL,
        chains = ['solana'],
        defaultPrice = 0,
        logging = true,
    } = config;

    // Initialize
    const app: Express = express();
    app.use(cors()); // For development, a simple cors() is fine.

    const wallet = loadWallet(walletPath);
    const registryClient = new RegistryClient(registry, wallet.publicKey.toString());
    const handlers = new Map<string, { handler: APIHandler; config: APIConfig }>();

    // Stats tracking
    const stats: ServerStats = {
        uptime: 0,
        requestsServed: 0,
        totalEarnings: 0,
        averageLatency: 0,
        errorRate: 0,
    };
    const startTime = Date.now();
    let totalLatency = 0;
    let errorCount = 0;


    // Middleware
    app.use(express.json({ limit: '10mb' }));

    // Logging middleware
    if (logging) {
        app.use((req, res, next) => {
            const start = Date.now();
            res.on('finish', () => {
                const duration = Date.now() - start;
                console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
            });
            next();
        });
    }

    // Payment verification
    app.use(paymentMiddleware(wallet, chains));

    // Health check endpoint
    app.get('/health', (req: Request, res: Response) => {
        res.json({
            status: 'ok',
            apis: Array.from(handlers.keys()),
            wallet: wallet.publicKey.toString(),
            chains,
            stats: {
                uptime: Date.now() - startTime,
                requestsServed: stats.requestsServed,
                totalEarnings: stats.totalEarnings,
            },
        });
    });

    // API call endpoint
    app.post('/call', async (req: Request, res: Response) => {
        const requestId = generateRequestId();
        const startTime = Date.now();

        try {
            const { api, params } = req.body;

            if (!api || typeof api !== 'string') {
                return res.status(400).json({ error: 'Missing or invalid API name' });
            }

            if (!params || typeof params !== 'object') {
                return res.status(400).json({ error: 'Missing or invalid params' });
            }

            // Get handler
            const handlerConfig = handlers.get(api);
            if (!handlerConfig) {
                errorCount++;
                throw new APINotFoundError(api);
            }

            const { handler, config: apiConfig } = handlerConfig;

            // Verify payment amount matches price
            const payment = (req as any).payment;
            if (payment.amount < apiConfig.price) {
                return res.status(402).json({
                    error: 'Insufficient payment',
                    required: apiConfig.price,
                    received: payment.amount,
                });
            }

            // Execute handler with timeout
            const timeout = apiConfig.timeout || 30000;
            const result = await Promise.race([
                handler(params),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Handler timeout')), timeout)
                ),
            ]);

            // Update stats
            const latency = Date.now() - startTime;
            stats.requestsServed++;
            stats.totalEarnings += apiConfig.price;
            totalLatency += latency;
            stats.averageLatency = totalLatency / stats.requestsServed;
            stats.errorRate = errorCount / stats.requestsServed;

            // Send heartbeat to registry
            await registryClient.heartbeat({
                latency,
                requestsServed: stats.requestsServed,
                errors: errorCount,
            });

            res.json({
                data: result,
                requestId,
                latency,
                cost: apiConfig.price,
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            errorCount++;
            const latency = Date.now() - startTime;

            if (logging) {
                console.error(`Error handling request ${requestId}:`, error);
            }

            res.status(500).json({
                error: error instanceof Error ? error.message : 'Internal server error',
                requestId,
                latency,
            });
        }
    });

    // Server instance
    let server: any;

    return {
        /**
         * Add API handler
         */
        addAPI(name: string, handler: APIHandler, config?: Partial<APIConfig>): void {
            const apiConfig: APIConfig = {
                price: config?.price ?? defaultPrice,
                timeout: config?.timeout,
                rateLimit: config?.rateLimit,
            };

            handlers.set(name, { handler, config: apiConfig });

            if (logging) {
                console.log(`✅ Registered API: ${name} (price: $${apiConfig.price})`);
            }
        },

        /**
         * Start server and register with registry
         */
        async start(): Promise<HttpServer> { // <-- Ensure the return type here matches the interface
            return new Promise(async (resolve, reject) => {
                try {
                    // Register with the registry first
                    const url = publicUrl || `http://localhost:${port}`;
                    await registryClient.register({
                        apis: Array.from(handlers.keys()),
                        url,
                        // You'll need to adjust this part to pass prices correctly if needed
                        prices: Object.fromEntries(
                            Array.from(handlers.entries()).map(([name, { config }]) => [name, config.price])
                        ),
                        chains,
                    });

                    if (logging) {
                        console.log(`✅ Registered with registry: ${registry}`);
                    }

                    // Start the Express server and store the instance
                    server = app.listen(port, () => {
                        if (logging) {
                            console.log(`✅ Provider node running on port ${port}`);
                            console.log(`💰 Earnings wallet: ${wallet.publicKey.toString()}`);
                        }
                        // Resolve the promise with the server instance
                        resolve(server);
                    });

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : "Unknown error";
                    reject(new ProviderNodeError(`Failed to start server: ${errorMessage}`));
                }
            });
        },
        /**
         * Stop server and unregister
         */
        async stop(): Promise<void> {
            if (server) {
                await registryClient.unregister();
                server.close();

                if (logging) {
                    console.log('✅ Server stopped');
                }
            }
        },

        /**
         * Get server statistics
         */
        getStats(): ServerStats {
            return {
                ...stats,
                uptime: Date.now() - startTime,
            };
        },

        /**
 * Returns the underlying Express application instance.
 * Useful for attaching custom middleware or other servers (like WebSockets).
 */
        getExpressApp(): Express {
            return app;
        }
    };
}