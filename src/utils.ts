import { Keypair } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';

/**
 * Load wallet from file
 */
export function loadWallet(path: string): Keypair {
    try {
        const secretKey = JSON.parse(readFileSync(path, 'utf-8'));
        return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    } catch (error) {
        throw new Error(`Failed to load wallet from ${path}: ${error}`);
    }
}

/**
 * Generate unique request ID
 */
export function generateRequestId(): string {
    return randomBytes(16).toString('hex');
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}