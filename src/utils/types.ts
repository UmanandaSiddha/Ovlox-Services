export type SecurityRisk = "none" | "low" | "medium" | "high";

export type DebugFixResponse = {
    explanation: string;
    patches?: {
        filename: string;
        diff: string;
    }[];
    suggestedCode?: string | null;
    risk: SecurityRisk;
    confidence: number;
    safeToApply: boolean;
};