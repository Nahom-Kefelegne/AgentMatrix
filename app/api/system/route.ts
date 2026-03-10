import { NextResponse } from 'next/server';
import { homedir } from 'os';

export async function GET() {
  return NextResponse.json({
    homedir: homedir(),
    platform: process.platform,
  });
}
