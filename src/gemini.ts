import type { PerformanceGoalDetail, TrainingPlan, TrainingSession } from "./domain.js";
import type { ProductionConfig } from "./config.js";

export type PlanDraft = Omit<TrainingPlan, "id" | "performanceGoalId" | "version" | "model" | "generatedAt" | "sessions"> & {
  sessions: Array<Omit<TrainingSession, "id" | "planId" | "status">>;
};

export async function generateGeminiPlan(config: ProductionConfig, detail: PerformanceGoalDetail): Promise<PlanDraft> {
  if (!config.geminiApiKey) throw new Error("AI coaching is not configured");
  const prompt = {
    goal: {
      distanceMeters: detail.goal.distanceMeters,
      targetSeconds: detail.goal.targetSeconds,
      targetDate: detail.goal.targetDate,
      trainingDaysPerWeek: detail.goal.trainingDaysPerWeek,
      preferredLongRunDay: detail.goal.preferredLongRunDay
    },
    analysis: detail.goal.analysis,
    trajectory: detail.trajectory,
    instructions: [
      "Create a conservative running plan based only on the supplied facts.",
      "Do not diagnose injuries or provide medical treatment.",
      "Return JSON only. Create one rolling block covering no more than the next 28 days.",
      "Session type must be exactly one of easy, recovery, tempo, intervals, longRun, progression, or timeTrial.",
      "Use ISO YYYY-MM-DD dates. Include recovery days implicitly, not as sessions."
    ]
  };
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel ?? "gemini-2.5-flash")}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: JSON.stringify(prompt) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            required: ["summary", "gapExplanation", "recoveryGuidance", "caution", "sessions"],
            properties: {
              summary: { type: "STRING" },
              gapExplanation: { type: "STRING" },
              recoveryGuidance: { type: "STRING" },
              caution: { type: "STRING" },
              sessions: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  required: ["scheduledDate", "type", "title", "purpose", "effort"],
                  properties: {
                    scheduledDate: { type: "STRING" },
                    type: { type: "STRING", enum: ["easy", "recovery", "tempo", "intervals", "longRun", "progression", "timeTrial"] },
                    title: { type: "STRING" },
                    purpose: { type: "STRING" },
                    distanceMeters: { type: "NUMBER" },
                    durationSeconds: { type: "INTEGER" },
                    effort: { type: "STRING" }
                  }
                }
              }
            }
          }
        }
      })
    }
  );
  if (!response.ok) throw new Error(`Coach generation failed (${response.status})`);
  const payload = await response.json() as any;
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Coach returned no plan");
  const draft = JSON.parse(text) as PlanDraft;
  validatePlan(draft);
  return draft;
}

function validatePlan(plan: PlanDraft) {
  if (!plan.summary || !plan.gapExplanation || !plan.recoveryGuidance || !plan.caution || !Array.isArray(plan.sessions)) {
    throw new Error("Coach returned an incomplete plan");
  }
  if (plan.sessions.length > 28) throw new Error("Coach returned too many sessions");
  const validTypes = new Set(["easy", "recovery", "tempo", "intervals", "longRun", "progression", "timeTrial"]);
  for (const session of plan.sessions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session.scheduledDate) || !validTypes.has(session.type) || !session.title || !session.purpose || !session.effort) {
      throw new Error("Coach returned an invalid session");
    }
  }
}
