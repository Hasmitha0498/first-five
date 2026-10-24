import type { AppConfig } from "./config";

export interface PlanDefinition {
  key: string;
  name: string;
  studyCredits: number;
  maxParticipantsPerStudy: number;
}

/**
 * Offer catalogue. Both paid and complimentary access issue the same kind of
 * entitlement (study credits); values are configuration, not code.
 */
export function getPlans(config: AppConfig): Record<string, PlanDefinition> {
  return {
    single_study: {
      key: "single_study",
      name: "One study",
      studyCredits: config.PAID_STUDY_CREDITS,
      maxParticipantsPerStudy: config.PAID_PARTICIPANT_CAP,
    },
    complimentary: {
      key: "complimentary",
      name: "Complimentary access",
      studyCredits: config.DEFAULT_CODE_STUDY_CREDITS,
      maxParticipantsPerStudy: config.DEFAULT_CODE_PARTICIPANT_CAP,
    },
  };
}

export function getPlan(config: AppConfig, key: string): PlanDefinition {
  const plan = getPlans(config)[key];
  if (!plan) throw new Error(`Unknown plan: ${key}`);
  return plan;
}
