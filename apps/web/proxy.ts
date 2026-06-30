import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// Runs before any matching page renders. Checks for a valid token cookie;
// redirects to the appropriate login page if missing or invalid.
// We use 'jose' here (not jsonwebtoken) because Next.js middleware runs
// on the Edge runtime, which jsonwebtoken's Node-specific APIs don't support.
export async function proxy(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const { pathname } = req.nextUrl;

  const isAdminRoute = pathname.startsWith('/admin') && pathname !== '/admin/login';
  const isDashboardRoute = pathname.startsWith('/dashboard') || pathname.startsWith('/test');

  if (!isAdminRoute && !isDashboardRoute) {
    return NextResponse.next(); // public route, no check needed
  }

  if (!token) {
    const loginPath = isAdminRoute ? '/admin/login' : '/login';
    return NextResponse.redirect(new URL(loginPath, req.url));
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    // Admin routes specifically require role === 'admin'
    if (isAdminRoute && payload.role !== 'admin') {
      return NextResponse.redirect(new URL('/login', req.url));
    }

    return NextResponse.next();

  } catch (err) {
    // Token invalid or expired — clear it and send back to login
    const loginPath = isAdminRoute ? '/admin/login' : '/login';
    const response = NextResponse.redirect(new URL(loginPath, req.url));
    response.cookies.delete('token');
    return response;
  }
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/test/:path*'],
};