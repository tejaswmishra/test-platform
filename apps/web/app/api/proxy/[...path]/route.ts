import { NextRequest, NextResponse } from 'next/server';

// Catch-all proxy: forwards any /api/proxy/* request to Express,
// attaching the JWT from the httpOnly cookie as a Bearer header.
// This is the bridge between "cookie-based auth in the browser"
// and "Bearer-token auth on the Express API."

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const token = req.cookies.get('token')?.value;
  const targetPath = path.join('/');
  const queryString = req.nextUrl.search;

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text();

  try {
    const expressRes = await fetch(`${process.env.API_URL}/${targetPath}${queryString}`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    });

    const data = await expressRes.json();
    return NextResponse.json(data, { status: expressRes.status });

  } catch (err) {
    console.error('Proxy error:', err);
    return NextResponse.json({ error: 'Unable to reach the server' }, { status: 500 });
  }
}

export {
  handler as GET,
  handler as POST,
  handler as PATCH,
  handler as PUT,
  handler as DELETE,
};