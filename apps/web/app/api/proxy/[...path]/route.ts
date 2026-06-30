import { NextRequest, NextResponse } from 'next/server';

// Catch-all proxy: forwards any /api/proxy/* request to Express,
// attaching the JWT from the httpOnly cookie as a Bearer header.
//
// IMPORTANT: not every Express response is JSON. The Excel export
// route returns raw binary file bytes (.xlsx), so we check the
// Content-Type header and handle binary responses differently —
// streaming the raw bytes through instead of trying to JSON.parse them.

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

    const contentType = expressRes.headers.get('content-type') || '';

    // Binary / file responses (Excel, PDF, images, etc.) — stream raw bytes
    // through unchanged, preserving headers like Content-Disposition so the
    // browser still knows to trigger a file download with the right filename.
    const isBinary = !contentType.includes('application/json');

    if (isBinary) {
      const arrayBuffer = await expressRes.arrayBuffer();
      const responseHeaders = new Headers();

      // Forward the headers that matter for file downloads
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

    // Normal JSON response — same behavior as before
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