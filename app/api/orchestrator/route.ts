import { NextResponse } from 'next/server';

/** Transcript-search orchestrator is intentionally disabled for now. */
export async function POST() {
  return NextResponse.json({
    error: 'AgentMatrix transcript search is temporarily disabled.',
  }, { status: 410 });
}
