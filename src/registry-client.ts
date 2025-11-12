import fetch from 'node-fetch';
import { ProviderHealth } from '@x402apis/protocol';
import { RegistryError } from './errors';

/**
 * Client for interacting with the registry
 */
export class RegistryClient {
    private registryUrl: string;
    private providerId: string;
    private heartbeatInterval?: NodeJS.Timeout;

    constructor(registryUrl: string, providerId: string) {
        this.registryUrl = registryUrl;
        this.providerId = providerId;
    }

    /**
     * Register provider with registry
     */
    async register(data: {
        apis: string[];
        url: string;
        prices: Record<string, number>;
        chains: string[];
    }): Promise<void> {
        try {
            const response = await fetch(`${this.registryUrl}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerId: this.providerId,
                    ...data,
                }),
            });

            if (!response.ok) {
                const error = await response.text();
                throw new RegistryError(`Registration failed: ${error}`);
            }

            // Start heartbeat
            this.startHeartbeat();
        } catch (error) {
            throw new RegistryError(`Failed to register: ${error}`);
        }
    }

    /**
     * Send heartbeat to registry
     */
    async heartbeat(health: Omit<ProviderHealth, 'providerId' | 'timestamp'>): Promise<void> {
        try {
            await fetch(`${this.registryUrl}/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerId: this.providerId,
                    ...health,
                    timestamp: new Date().toISOString(),
                }),
            });
        } catch (error) {
            // Don't throw - heartbeat failures shouldn't stop the server
            console.error('Heartbeat failed:', error);
        }
    }

    /**
     * Unregister provider
     */
    async unregister(): Promise<void> {
        this.stopHeartbeat();

        try {
            await fetch(`${this.registryUrl}/unregister`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId: this.providerId }),
            });
        } catch (error) {
            console.error('Failed to unregister:', error);
        }
    }

    /**
     * Start periodic heartbeat
     */
    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            this.heartbeat({
                latency: 0,
                requestsServed: 0,
                errors: 0,
            });
        }, 60000); // Every minute
    }

    /**
     * Stop heartbeat
     */
    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
    }
}