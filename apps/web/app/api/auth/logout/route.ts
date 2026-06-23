import { NextResponse } from 'next/server';

// Logout just deletes the cookie — no need to call Express for this,
// since JWTs are stateless (the server doesn't track active sessions).
export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete('token');
  return response;
}