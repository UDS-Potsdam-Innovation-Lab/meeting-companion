import type { ComponentType } from "react";
import type { MessageKey } from "../../i18n";

export type HelpTab = "help" | "legal";
export const TABS: readonly HelpTab[] = ["help", "legal"];

export interface PageSection {
  /** Stable element id: other jobs and the "On this page" list link to it. */
  id: string;
  title: MessageKey;
}

export const SECTIONS: Record<HelpTab, readonly PageSection[]> = {
  help: [
    { id: "how-it-works", title: "help.how.title" },
    { id: "shortcuts", title: "help.shortcuts.title" },
    { id: "troubleshooting", title: "help.trouble.title" },
  ],
  legal: [
    { id: "privacy", title: "legal.privacy.title" },
    { id: "consent-texts", title: "legal.consent.title" },
    { id: "organisation", title: "legal.org.title" },
    { id: "licences", title: "legal.licences.title" },
  ],
};

/**
 * Paragraphs of the privacy notice that later features add, each under its own stable id inside
 * "Privacy notice": 010-voice-profiles registers `privacy-voice-profiles` (what is stored, where, how
 * to delete a voice profile), 011-language-model-engine registers `privacy-language-model` (that
 * transcript text goes to Anthropic when the Claude engine is chosen). Until a feature exists its slot
 * renders nothing: the notice only describes what the app does today.
 */
export const PRIVACY_SLOTS = ["privacy-voice-profiles", "privacy-language-model"] as const;
export type PrivacySlot = (typeof PRIVACY_SLOTS)[number];
export const PRIVACY_PARAGRAPHS: Partial<Record<PrivacySlot, ComponentType>> = {};
