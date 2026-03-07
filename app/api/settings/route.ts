import { NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/state/appSettings';

export async function GET() {
  return NextResponse.json(getSettings());
}

export async function POST(request: Request) {
  try {
    const partial = await request.json();
    const updated = updateSettings(partial);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('[settings]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
