import { NextResponse } from 'next/server';
import { checkAllHealth, checkAgencyHealth } from '@/lib/cli';

export async function GET() {
  try {
    const clis = checkAllHealth();
    const agency = checkAgencyHealth();
    return NextResponse.json({ clis, agency });
  } catch (error) {
    console.error('[cli/health]', error);
    return NextResponse.json({ clis: [], agency: { installed: false, version: null, binaryPath: null }, error: 'Failed to check CLI health' }, { status: 500 });
  }
}
