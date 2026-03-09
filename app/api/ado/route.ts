import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getAdoConfig, saveAdoConfig } from '@/lib/state/adoConfig';

/** Check if az CLI is available */
function hasAzCli(): boolean {
  try {
    execSync('az --version', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

/** Validate an organization by trying to list projects */
function validateOrg(org: string): boolean {
  try {
    const orgUrl = getOrgUrl(org);
    execSync(
      `az devops project list --org "${orgUrl}" --top 1 -o json`,
      { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' },
    );
    return true;
  } catch { return false; }
}

/** Build org URL — supports both dev.azure.com and visualstudio.com */
function getOrgUrl(org: string): string {
  // If user pasted a full URL, use it directly
  if (org.startsWith('https://')) return org.replace(/\/+$/, '');
  // Check if it looks like a visualstudio.com org
  if (org.includes('.visualstudio.com')) return `https://${org}`.replace(/\/+$/, '');
  // Default to dev.azure.com
  return `https://dev.azure.com/${org}`;
}

/** List projects in an organization */
function listProjects(org: string): string[] {
  try {
    const orgUrl = getOrgUrl(org);
    const output = execSync(
      `az devops project list --org "${orgUrl}" --query "value[].name" -o tsv`,
      { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' },
    );
    return output.trim().split('\n').filter(Boolean);
  } catch { return []; }
}

/** Fetch work items assigned to current user */
function fetchMyWorkItems(org: string, project: string): Record<string, unknown>[] {
  try {
    const orgUrl = getOrgUrl(org);
    const query = `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [Microsoft.VSTS.Common.Priority], [System.Description] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] <> 'Closed' AND [System.State] <> 'Removed' ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC`;
    const output = execSync(
      `az boards query --wiql "${query.replace(/"/g, '\\"')}" --org "${orgUrl}" --project "${project}" -o json`,
      { encoding: 'utf-8', timeout: 30000, stdio: 'pipe' },
    );
    return JSON.parse(output) || [];
  } catch { return []; }
}

/** Fetch work item details */
function fetchWorkItemDetails(org: string, id: number): Record<string, unknown> | null {
  try {
    const orgUrl = getOrgUrl(org);
    const output = execSync(
      `az boards work-item show --id ${id} --org "${orgUrl}" -o json`,
      { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' },
    );
    return JSON.parse(output);
  } catch { return null; }
}

/** Fetch comments for a work item via REST API */
function fetchComments(org: string, project: string, id: number): { author: string; text: string; timestamp: number }[] {
  try {
    const orgUrl = getOrgUrl(org);
    const output = execSync(
      `az rest --method get --url "${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workItems/${id}/comments?api-version=7.0-preview.3" --resource "499b84ac-1321-427f-aa17-267ca6975798" -o json`,
      { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' },
    );
    const data = JSON.parse(output);
    return (data.comments || []).map((c: Record<string, unknown>) => ({
      author: (c.createdBy as Record<string, unknown>)?.displayName || 'Unknown',
      text: String(c.text || '').replace(/<[^>]*>/g, '').trim(),
      timestamp: new Date(String(c.createdDate || '')).getTime() || Date.now(),
    }));
  } catch { return []; }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'check') {
    return NextResponse.json({
      hasAzCli: hasAzCli(),
      config: getAdoConfig(),
    });
  }

  if (action === 'validate-org') {
    const org = searchParams.get('org');
    if (!org) return NextResponse.json({ error: 'Missing org' }, { status: 400 });
    return NextResponse.json({ valid: validateOrg(org) });
  }

  if (action === 'projects') {
    const org = searchParams.get('org');
    if (!org) return NextResponse.json({ error: 'Missing org' }, { status: 400 });
    return NextResponse.json({ projects: listProjects(org) });
  }

  if (action === 'tasks') {
    const config = getAdoConfig();
    if (!config.configured) return NextResponse.json({ error: 'ADO not configured' }, { status: 400 });

    const items = fetchMyWorkItems(config.organization, config.project);
    const tasks = items.map((item: Record<string, unknown>) => {
      const fields = (item as any).fields || {};
      return {
        adoId: (item as any).id,
        title: fields['System.Title'] || '',
        state: fields['System.State'] || '',
        type: fields['System.WorkItemType'] || '',
        priority: fields['Microsoft.VSTS.Common.Priority']?.toString() || '',
        description: (fields['System.Description'] || '').replace(/<[^>]*>/g, '').slice(0, 500),
      };
    });
    return NextResponse.json({ tasks });
  }

  if (action === 'details') {
    const config = getAdoConfig();
    const id = searchParams.get('id');
    if (!config.configured || !id) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    const details = fetchWorkItemDetails(config.organization, parseInt(id));
    const comments = fetchComments(config.organization, config.project, parseInt(id));
    return NextResponse.json({ details, comments });
  }

  if (action === 'comments') {
    const config = getAdoConfig();
    const id = searchParams.get('id');
    if (!config.configured || !id) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    const comments = fetchComments(config.organization, config.project, parseInt(id));
    return NextResponse.json({ comments });
  }

  if (action === 'sync') {
    const config = getAdoConfig();
    const id = searchParams.get('id');
    if (!config.configured || !id) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    const details = fetchWorkItemDetails(config.organization, parseInt(id));
    const comments = fetchComments(config.organization, config.project, parseInt(id));
    if (!details) return NextResponse.json({ error: 'Work item not found' }, { status: 404 });
    const fields = (details as any).fields || {};
    return NextResponse.json({
      title: fields['System.Title'] || '',
      state: fields['System.State'] || '',
      type: fields['System.WorkItemType'] || '',
      priority: fields['Microsoft.VSTS.Common.Priority']?.toString() || '',
      description: (fields['System.Description'] || '').replace(/<[^>]*>/g, '').slice(0, 500),
      comments,
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.action === 'configure') {
      saveAdoConfig({
        organization: body.organization,
        project: body.project,
        configured: true,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'update') {
      const config = getAdoConfig();
      if (!config.configured) return NextResponse.json({ error: 'Not configured' }, { status: 400 });
      try {
        const orgUrl = getOrgUrl(config.organization);
        const args: string[] = [`--id ${body.id}`, `--org "${orgUrl}"`];
        if (body.state) args.push(`--state "${body.state}"`);
        if (body.title) args.push(`--title "${body.title.replace(/"/g, '\\"')}"`);
        execSync(
          `az boards work-item update ${args.join(' ')} -o json`,
          { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' },
        );
        return NextResponse.json({ ok: true });
      } catch {
        return NextResponse.json({ error: 'Update failed' }, { status: 500 });
      }
    }

    if (body.action === 'comment') {
      const config = getAdoConfig();
      if (!config.configured) return NextResponse.json({ error: 'Not configured' }, { status: 400 });
      try {
        const orgUrl = getOrgUrl(config.organization);
        // Add comment via discussion field update
        const escaped = body.text.replace(/"/g, '\\"').replace(/\n/g, '<br>');
        execSync(
          `az boards work-item update --id ${body.id} --discussion "${escaped}" --org "${orgUrl}" -o json`,
          { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' },
        );
        return NextResponse.json({ ok: true });
      } catch {
        return NextResponse.json({ error: 'Comment failed' }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
