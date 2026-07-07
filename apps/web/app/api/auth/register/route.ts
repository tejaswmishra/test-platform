import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();

  try {
    const expressRes = await fetch(`${process.env.API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await expressRes.json();

    if (!expressRes.ok) {
      return NextResponse.json(data, { status: expressRes.status });
    }

    // Set the httpOnly cookie exactly like the login route does
    const response = NextResponse.json({ user: data.user });
    response.cookies.set('token', data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8,
      path: '/',
    });

    return response;

  } catch (err) {
    console.error('Register proxy error:', err);
    return NextResponse.json({ error: 'Unable to reach the server' }, { status: 500 });
  }
}