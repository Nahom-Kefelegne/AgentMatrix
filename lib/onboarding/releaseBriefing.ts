import releaseBriefingConfig from '@/config/release-briefing.json';

export const WELCOME_COMPLETION_STORAGE_KEY = 'agentmatrix-intro-v2';
export const RELEASE_BRIEFING_STORAGE_KEY = 'agentmatrix-release-briefing-v1';

export interface ReleaseBriefingCampaign {
  id: string;
  title: string;
  startPage: number;
}

export type IntroBriefingVariant = 'welcome' | 'release' | 'replay';

export interface IntroBriefingLaunch {
  variant: IntroBriefingVariant;
  initialPage: number;
  releaseTitle?: string;
}

export const CURRENT_RELEASE_BRIEFING: ReleaseBriefingCampaign = releaseBriefingConfig;

interface ResolveIntroBriefingOptions {
  forced: boolean;
  forceRelease?: boolean;
  welcomeCompleted: boolean;
  acknowledgedCampaignId: string | null;
}

export function resolveIntroBriefing(
  options: ResolveIntroBriefingOptions,
  campaign: ReleaseBriefingCampaign = CURRENT_RELEASE_BRIEFING,
): IntroBriefingLaunch | null {
  if (options.forceRelease) {
    return {
      variant: 'release',
      initialPage: campaign.startPage,
      releaseTitle: campaign.title,
    };
  }
  if (options.forced) {
    return { variant: 'replay', initialPage: 0 };
  }
  if (!options.welcomeCompleted) {
    return { variant: 'welcome', initialPage: 0 };
  }
  if (options.acknowledgedCampaignId !== campaign.id) {
    return {
      variant: 'release',
      initialPage: campaign.startPage,
      releaseTitle: campaign.title,
    };
  }
  return null;
}
