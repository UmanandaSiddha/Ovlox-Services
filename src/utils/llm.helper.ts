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
    private static defaultModel = "gpt-4o-mini"; // fast + cheap
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
        const timeout = setTimeout(
            () => controller.abort(),
            this.timeoutMs
        );

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
        } catch (err: any) {
            if (err.name === "AbortError") {
                throw new Error("LLM request timed out");
            }
            throw err;
        } finally {
            clearTimeout(timeout);
        }
    }
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
    files: Array<{
        filename: string;
        patch?: string | null;
    }>;
}) {
    const systemPrompt = `
    You are a code reviewer and security expert.
    Return structured feedback in 4-5 lines.
    `;

    const userPrompt = `
    Review the following changes.

    For each category give bullet points:
    - Code Quality (score 0–100)
    - Security Risk (Low/Medium/High)
    - Improvements

    FILES:
    ${input.files
            .map(f => `File: ${f.filename}\n${f.patch ?? ""}`)
            .join("\n\n")}
    `;

    return LlmHelper.generateText(systemPrompt, userPrompt, {
        temperature: 0.2,
        maxTokens: 500,
    });
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


