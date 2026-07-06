import { NextRequest, NextResponse } from 'next/server';

// Catch-all proxy: forwards any /api/proxy/* request to Express,
// attaching the JWT from the httpOnly cookie as a Bearer header.
//
// File uploads (multipart) are handled by a dedicated route at
// /api/admin/questions/parse-upload — NOT through this proxy,
// since buffering multipart streams here corrupts them.
//
// Binary file RESPONSES (e.g. Excel export) are still handled here —
// we check the response Content-Type and stream raw bytes through
// instead of trying to JSON.parse them.

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const token = req.cookies.get('token')?.value;
  const targetPath = path.join('/');
  const queryString = req.nextUrl.search;

  // All requests through this proxy are JSON — multipart uploads
  // have their own dedicated route and never reach here
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

    const responseContentType = expressRes.headers.get('content-type') || '';

    // Binary responses (Excel, PDF, etc.) — stream raw bytes through unchanged,
    // preserving Content-Disposition so the browser triggers a file download
    const isBinary = !responseContentType.includes('application/json');

    if (isBinary) {
      const arrayBuffer = await expressRes.arrayBuffer();
      const responseHeaders = new Headers();

      const passthroughHeaders = ['content-type', 'content-disposition', 'content-length'];
      for (const key of passthroughHeaders) {
        const value = expressRes.headers.get(key);
        if (value) responseHeaders.set(key, value);
      }

      return new NextResponse(arrayBuffer, {
        status: expressRes.status,
        headers: responseHeaders,
      });
    }

    // Normal JSON response
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