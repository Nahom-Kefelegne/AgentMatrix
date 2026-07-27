import { NextResponse } from 'next/server';
import {
  DASHBOARD_V2_PREFERENCE_VERSION,
  getSettings,
  resolveDashboardV2Preference,
  updateSettings,
  type AppSettings,
} from '@/lib/state/appSettings';

function withEffectiveDashboardV2(settings: AppSettings) {
  return {
    ...settings,
    dashboardV2: resolveDashboardV2Preference(settings, true),
    dashboardV2PreferenceVersion: DASHBOARD_V2_PREFERENCE_VERSION,
  };
}

export async function GET() {
  return NextResponse.json(withEffectiveDashboardV2(getSettings()));
}

export async function POST(request: Request) {
  try {
    const partial = await request.json() as Partial<AppSettings>;
    const updated = updateSettings(
      typeof partial.dashboardV2 === 'boolean'
        ? {
            ...partial,
            dashboardV2PreferenceVersion: DASHBOARD_V2_PREFERENCE_VERSION,
          }
        : partial,
    );
    return NextResponse.json(withEffectiveDashboardV2(updated));
  } catch (error) {
    console.error('[settings]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
