import { Chain } from '@x402apis/protocol';
import { Express } from 'express';
import { Server as HttpServer } from 'http'; // Import with an alias to avoid name conflicts

/**
 * Provider server configuration
 */
export interface ServerConfig {
    /** Wallet keypair path */
    wallet: string;

    /** Server port */
    port?: number;

    /** Public URL for this node */
    publicUrl?: string;

    /** Registry URL */
    registry?: string;

    /** Supported chains */
    chains?: Chain[];

    /** Default price per request */
    defaultPrice?: number;

    /** Enable logging */
    logging?: boolean;
}

/**
 * API handler function
 */
export type APIHandler = (params: Record<string, unknown>) => Promise<unknown>;

/**
 * API configuration
 */
export interface APIConfig {
    /** Price per request in USDC */
    price: number;

    /** Optional timeout override */
    timeout?: number;

    /** Optional rate limit */
    rateLimit?: number;
}

/**
 * Provider server instance
 */
export interface ProviderServer {
    /** Add API handler */
    addAPI: (name: string, handler: APIHandler, config?: APIConfig) => void;

    /** Start server */
    start: () => Promise<HttpServer>;
    /** Stop server */
    stop: () => Promise<void>;

    /** Get server stats */
    getStats: () => ServerStats;

    getExpressApp: () => Express
}

/**
 * Server statistics
 */
export interface ServerStats {
    uptime: number;
    requestsServed: number;
    totalEarnings: number;
    averageLatency: number;
    errorRate: number;
}

/**
 * Request context
 */
export interface RequestContext {
    /** Payment details */
    payment: {
        amount: number;
        from: string;
        signature: string;
        chain: Chain;
    };

    /** Request timestamp */
    timestamp: Date;

    /** Request ID */
    requestId: string;
}