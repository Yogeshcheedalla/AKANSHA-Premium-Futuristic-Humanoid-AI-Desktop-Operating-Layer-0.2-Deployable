import { NextResponse } from 'next/server';
import { connectorManager } from '@/core/connectors/ConnectorManager';
import { authorize } from '@/core/auth/guard';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    const [definitions, connections] = await Promise.all([
      connectorManager.listDefinitions(),
      connectorManager.listConnections(),
    ]);
    return NextResponse.json({ ok: true, definitions, connections });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = authorize(request, 'admin');
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json();
    if (!body?.provider) return NextResponse.json({ ok: false, error: 'provider required' }, { status: 400 });

    const connection = await connectorManager.connect({
      provider: body.provider,
      account: body.account,
      scopes: body.scopes,
      secret: body.secret,
      enabled: body.enabled !== false,
    });

    if (!connection) {
      return NextResponse.json({ ok: false, error: 'Unknown connector provider' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, connection });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const guard = authorize(request, 'admin');
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json();
    if (!body?.connectionId) return NextResponse.json({ ok: false, error: 'connectionId required' }, { status: 400 });

    if (typeof body.enabled === 'boolean') {
      await connectorManager.setEnabled(body.connectionId, body.enabled);
    }
    if (body.health) {
      await connectorManager.setHealth(body.connectionId, body.health);
    }
    const connections = await connectorManager.listConnections();
    return NextResponse.json({
      ok: true,
      connection: connections.find((c) => c.connectionId === body.connectionId),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const guard = authorize(request, 'admin');
  if (!guard.ok) return guard.response;
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    if (!connectionId) return NextResponse.json({ ok: false, error: 'connectionId required' }, { status: 400 });
    await connectorManager.disconnect(connectionId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
