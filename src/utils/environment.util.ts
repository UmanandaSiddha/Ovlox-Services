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

export function shouldSkipPayments(): boolean {
    return isDevelopment();
}

export function shouldSkipCreditChecks(): boolean {
    return isDevelopment();
}
