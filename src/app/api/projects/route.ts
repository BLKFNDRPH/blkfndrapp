import { NextResponse } from 'next/server';
import { getProjects } from '@/lib/data/projects';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const projects = await getProjects();
    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json([], { status: 500 });
  }
}