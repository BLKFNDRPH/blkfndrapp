import { NextRequest, NextResponse } from 'next/server';
import { getProjectById } from '@/lib/data';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const project = await getProjectById(id);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error('Error fetching project by id:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}