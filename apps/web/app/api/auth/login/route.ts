import { NextRequest, NextResponse } from 'next/server';

// This Next.js API route sits between the login form and your Express backend.
// It calls Express, gets the JWT back, and sets it as an httpOnly cookie —
// something only a server can do. The browser's JavaScript never gets
// direct access to the raw token, which protects against XSS token theft.
export async function POST(req: NextRequest) {
  const body = await req.json();

  try {
    const expressRes = await fetch(`${process.env.API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await expressRes.json();

    if (!expressRes.ok) {
      // Pass through Express's error message and status code as-is
      return NextResponse.json(data, { status: expressRes.status });
    }

    // Build the response first, then attach the cookie to it
    const response = NextResponse.json({ user: data.user });

    response.cookies.set('token', data.token, {
      httpOnly: true,        // JS on the page can never read this cookie
      secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
      sameSite: 'lax',       // CSRF protection
      maxAge: 60 * 60 * 8,   // 8 hours — matches your JWT's own expiry
      path: '/',
    });

    return response;

  } catch (err) {
    console.error('Login proxy error:', err);
    return NextResponse.json({ error: 'Unable to reach the server' }, { status: 500 });
  }
}