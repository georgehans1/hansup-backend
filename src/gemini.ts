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
      "Use ISO YYYY-MM-DD dates. Include recovery days implicitly, not as sessions.",
      "Tailor every distance to the selected goal distance and the runner's current benchmark. Longer aerobic runs may exceed goal distance only conservatively.",
      "Give every session a realistic target pace range in seconds per kilometre and concise pacing guidance. Use even-split guidance unless the session is progression or intervals."
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
                  required: ["scheduledDate", "type", "title", "purpose", "effort", "targetPaceMinSecondsPerKm", "targetPaceMaxSecondsPerKm", "pacingGuidance"],
                  properties: {
                    scheduledDate: { type: "STRING" },
                    type: { type: "STRING", enum: ["easy", "recovery", "tempo", "intervals", "longRun", "progression", "timeTrial"] },
                    title: { type: "STRING" },
                    purpose: { type: "STRING" },
                    distanceMeters: { type: "NUMBER" },
                    durationSeconds: { type: "INTEGER" },
                    targetPaceMinSecondsPerKm: { type: "INTEGER" },
                    targetPaceMaxSecondsPerKm: { type: "INTEGER" },
                    pacingGuidance: { type: "STRING" },
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

export async function generateGeminiSessionAnalysis(config: ProductionConfig, context: Record<string, unknown>): Promise<{
  summary: string; observations: string[]; recommendation: string;
}> {
  if (!config.geminiApiKey) throw new Error("AI coaching is not configured");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel ?? "gemini-2.5-flash")}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: JSON.stringify({
              context,
              instructions: [
                "Analyse this completed run only in relation to its prescribed training session.",
                "Be concise, supportive, and specific to the supplied pace, split, heart-rate, and effort facts.",
                "Do not diagnose injury or provide medical treatment.",
                "Return JSON only. Provide a short summary, two to five observations, and one practical recommendation for the next session."
              ]
            })
          }]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            required: ["summary", "observations", "recommendation"],
            properties: {
              summary: { type: "STRING" },
              observations: { type: "ARRAY", items: { type: "STRING" } },
              recommendation: { type: "STRING" }
            }
          }
        }
      })
    }
  );
  if (!response.ok) throw new Error(`Session analysis failed (${response.status})`);
  const payload = await response.json() as any;
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Coach returned no session analysis");
  const result = JSON.parse(text);
  if (!result.summary || !Array.isArray(result.observations) || !result.recommendation) throw new Error("Coach returned an incomplete session analysis");
  return result;
}

function validatePlan(plan: PlanDraft) {
  if (!plan.summary || !plan.gapExplanation || !plan.recoveryGuidance || !plan.caution || !Array.isArray(plan.sessions)) {
    throw new Error("Coach returned an incomplete plan");
  }
  if (plan.sessions.length > 28) throw new Error("Coach returned too many sessions");
  const validTypes = new Set(["easy", "recovery", "tempo", "intervals", "longRun", "progression", "timeTrial"]);
  for (const session of plan.sessions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session.scheduledDate) || !validTypes.has(session.type) || !session.title || !session.purpose || !session.effort
      || !session.targetPaceMinSecondsPerKm || !session.targetPaceMaxSecondsPerKm || !session.pacingGuidance) {
      throw new Error("Coach returned an invalid session");
    }
  }
}
