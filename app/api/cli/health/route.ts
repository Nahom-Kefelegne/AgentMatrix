import { NextResponse } from 'next/server';
import { checkAllHealth } from '@/lib/cli';

export async function GET() {
  try {
    const clis = checkAllHealth();
    return NextResponse.json({ clis });
  } catch (error) {
    console.error('[cli/health]', error);
    return NextResponse.json({ clis: [], error: 'Failed to check CLI health' }, { status: 500 });
  }
}
