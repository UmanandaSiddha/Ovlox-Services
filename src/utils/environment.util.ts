/**
 * Environment utility functions
 * Provides helpers for checking environment and enabling dev mode features
 */

export function isDevelopment(): boolean {
    return process.env.NODE_ENV !== 'production';
}

export function isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
}

/**
 * In dev, we mock external paid services (Stripe, etc.)
 */
export function shouldMockPayments(): boolean {
    return isDevelopment();
}

/**
 * In dev, we can skip/relax credit checks
 */
export function shouldSkipCreditChecks(): boolean {
    return isDevelopment();
}
