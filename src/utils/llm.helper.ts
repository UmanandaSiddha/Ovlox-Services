import OpenAI from "openai";
import { configDotenv } from "dotenv";

configDotenv();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

type LlmOptions = {
    model?: string;
    temperature?: number;
    maxTokens?: number;
};

export class LlmHelper {
    private static defaultModel = "gpt-4o-mini";
    private static timeoutMs = 45_000;

    static async generateText(
        systemPrompt: string,
        userPrompt: string,
        options: LlmOptions = {}
    ): Promise<string> {
        const {
            model = this.defaultModel,
            temperature = 0.3,
            maxTokens = 600,
        } = options;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const res = await openai.chat.completions.create(
                {
                    model,
                    temperature,
                    max_tokens: maxTokens,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt },
                    ],
                },
                { signal: controller.signal }
            );

            return res.choices[0]?.message?.content?.trim() ?? "";
        } finally {
            clearTimeout(timeout);
        }
    }

    static async generateJson<T>(
        systemPrompt: string,
        userPrompt: string,
        options: LlmOptions = {}
    ): Promise<T> {
        const raw = await this.generateText(systemPrompt, userPrompt, {
            temperature: 0,
            maxTokens: options.maxTokens ?? 800,
        });

        try {
            return extractJson(raw) as T;
        } catch (err) {
            console.error("Invalid JSON from LLM:", raw);
            throw new Error("LLM returned invalid JSON");
        }
    }

}

function extractJson(text: string): any {
    if (!text || typeof text !== "string") {
        throw new Error("LLM returned empty response");
    }

    const cleaned = text
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch { }

    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
        throw new Error("No JSON object found in LLM output");
    }

    return JSON.parse(match[0]);
}

export async function summarizeCodeChange(input: {
    title: string;
    description?: string;
    files: Array<{
        filename: string;
        patch?: string | null;
    }>;
}) {
    const systemPrompt = `
    You are a senior software engineer.
    Summarize code changes clearly and concisely.
    Focus on intent, impact, and risk.
    Do NOT repeat code verbatim.
    Just give a 3-4 lines summary.
    `;

    const userPrompt = `
    TITLE:
    ${input.title}

    FILES CHANGED:
    ${input.files
            .map(
                f =>
                    `File: ${f.filename}\nChanges:\n${f.patch ?? "Diff too large"}`
            )
            .join("\n\n")}

    Explain:
    1. What changed
    2. Why it matters
    3. Any risks
    `;

    return LlmHelper.generateText(systemPrompt, userPrompt, {
        maxTokens: 400,
    });
}

export async function analyzeCodeQuality(input: {
    files: { filename: string; patch?: string | null }[];
}) {
    const systemPrompt = `
    You are a senior code reviewer.

    Return JSON ONLY in this exact format:

    {
    "score": number,
    "summary": string,
    "issues": [
        {
        "type": string,
        "severity": "low" | "medium" | "high",
        "description": string
        }
    ],
    "suggestions": string[]
    }

    Rules:
    - score must be 0–100
    - issues may be empty
    - suggestions may be empty
    - DO NOT add markdown
    - DO NOT wrap in \`\`\`
    `;

    const userPrompt = `
    FILES CHANGED:
    ${input.files
            .map(f => `File: ${f.filename}\n${f.patch ?? "Diff omitted"}`)
            .join("\n\n")}
    `;

    return LlmHelper.generateJson<{
        score: number;
        summary: string;
        issues: any[];
        suggestions: string[];
    }>(systemPrompt, userPrompt, { maxTokens: 600 });
}


export async function analyzeIssue(input: {
    title: string;
    body?: string;
}) {
    const systemPrompt = `
    You are a debugging assistant.
    Analyze the issue and propose a fix.
    `;

    const userPrompt = `
    ISSUE TITLE:
    ${input.title}

    ISSUE DESCRIPTION:
    ${input.body ?? "No description"}

    Provide:
    1. Root cause hypothesis
    2. Suggested fix
    3. Risk level
    `;

    return LlmHelper.generateText(systemPrompt, userPrompt, {
        maxTokens: 400,
    });
}

export async function generateDebugFix(input: {
    issueTitle?: string;
    issueBody?: string;
    recentDiffs?: string;
}) {
    const systemPrompt = `
    You are a senior backend engineer.
    Generate safe, production-ready fix suggestions.
    DO NOT auto-commit.
    `;

    const userPrompt = `
    ISSUE:
    ${input.issueTitle ?? ""}
    ${input.issueBody ?? ""}

    RECENT CODE CHANGES:
    ${input.recentDiffs ?? "N/A"}

    Return:
    - Explanation
    - Improved code snippet
    `;

    return LlmHelper.generateText(systemPrompt, userPrompt, {
        temperature: 0.25,
        maxTokens: 700,
    });
}

export async function analyzeSecurityRisk(params: {
    files: { filename: string; patch?: string | null }[];
}) {
    const systemPrompt = `
    You are a security-focused code reviewer.

    Return JSON ONLY in this format:

    {
    "risk": "none" | "low" | "medium" | "high",
    "summary": string,
    "findings": [
        {
        "type": string,
        "severity": "low" | "medium" | "high",
        "file": string,
        "description": string
        }
    ],
    "canAutoFix": boolean
    }

    Rules:
    - If no issues, risk = "none" and findings = []
    - DO NOT include markdown
    - DO NOT wrap in \`\`\`
    `;

    const userPrompt = `
    CODE CHANGES:
    ${params.files
            .map(f => `File: ${f.filename}\n${f.patch ?? "Diff omitted"}`)
            .join("\n\n")}
    `;

    return LlmHelper.generateJson<{
        risk: string;
        summary: string;
        findings: any[];
        canAutoFix: boolean;
    }>(systemPrompt, userPrompt, { maxTokens: 700 });
}




