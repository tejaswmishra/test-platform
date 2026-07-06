import { NextRequest, NextResponse } from 'next/server';

// Dedicated upload route — bypasses the generic proxy entirely.
// The generic proxy corrupts multipart streams because it buffers
// the body as a blob before re-sending, which breaks busboy/multer's
// streaming parser on the Express side ("Unexpected end of form").
//
// This route reads the cookie directly (same as the proxy does),
// then pipes the raw FormData to Express using the original
// Request body as a ReadableStream — no buffering, no corruption.

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const expressRes = await fetch(
      `${process.env.API_URL}/admin/questions/parse-upload`,
      {
        method: 'POST',
        headers: {
          // Forward the original Content-Type EXACTLY as-is — it includes
          // the boundary string (e.g. multipart/form-data; boundary=----xyz)
          // that multer uses to split the parts. Never override this.
          'content-type': req.headers.get('content-type') || '',
          Authorization: `Bearer ${token}`,
        },
        body: req.body,
        // @ts-ignore — duplex required for streaming request bodies
        duplex: 'half',
      }
    );

    const data = await expressRes.json();
    return NextResponse.json(data, { status: expressRes.status });

  } catch (err) {
    console.error('Upload proxy error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}