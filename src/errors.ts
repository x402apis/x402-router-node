/**
 * Base provider node error
 */
export class ProviderNodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProviderNodeError';
    }
}

/**
 * API not found error
 */
export class APINotFoundError extends ProviderNodeError {
    constructor(api: string) {
        super(`API not found: ${api}`);
        this.name = 'APINotFoundError';
    }
}

/**
 * Payment error
 */
export class PaymentError extends ProviderNodeError {
    constructor(message: string) {
        super(message);
        this.name = 'PaymentError';
    }
}

/**
 * Registry error
 */
export class RegistryError extends ProviderNodeError {
    constructor(message: string) {
        super(message);
        this.name = 'RegistryError';
    }
}