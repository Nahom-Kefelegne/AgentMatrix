import { NextResponse } from 'next/server';
import { getSettings, updateSettings, type AppSettings } from '@/lib/state/appSettings';

function withEffectiveDashboardV2(settings: AppSettings) {
  const envDefault = process.env.AM_DASHBOARD_V2 === '0' ? false : true;
  return {
    ...settings,
    dashboardV2: settings.dashboardV2 ?? envDefault,
  };
}

export async function GET() {
  return NextResponse.json(withEffectiveDashboardV2(getSettings()));
}

export async function POST(request: Request) {
  try {
    const partial = await request.json() as Partial<AppSettings>;
    const updated = updateSettings(partial);
    return NextResponse.json(withEffectiveDashboardV2(updated));
  } catch (error) {
    console.error('[settings]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
