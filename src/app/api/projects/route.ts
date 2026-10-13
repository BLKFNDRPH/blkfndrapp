import { NextResponse } from 'next/server';
import { readProjectsForVisitor } from '@/lib/data/public-reads';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Shared between signed-out visitors; their own session for anyone signed in.
    const projects = await readProjectsForVisitor();
    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json([], { status: 500 });
  }
}